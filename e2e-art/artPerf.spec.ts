/**
 * Frame cost of the new art in the two stress scenes of the main suite, set up the same way:
 * - render stress (e2e/renderPerf): the game paused at night with 300 mutants and 77 soldiers
 *   cloned on screen at the default zoom, all damaged (HP bars), 12 selected, 200 shots and 10
 *   explosions per second; 4 s.
 * - live stress (e2e/livePerf): about 80 soldiers around the core and 300 mutants assaulting from
 *   a ring 12-22 tiles out at night through the normal frame loop; 5 s at 1x, then 5 s at 3x. Run
 *   zoomed out as far as the camera goes (the whole map in view, as the main suite) and at the default zoom.
 * Results go to the console and e2e-art/screenshots/perf.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_ZOOM } from '../src/client/camera';
import { collectErrors, startGame } from '../e2e/support';

const SHOTS = 'e2e-art/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface Window5s {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  slowFrames: number;
  fps: number;
  sections: Record<string, number>;
  onScreen: { soldiers: number; mutants: number };
}

async function measure(page: Page, ms: number): Promise<Window5s> {
  return page.evaluate(async (duration) => {
    const hook = window.scraphold!;
    const times: number[] = [];
    const sections: Record<string, number> = {};
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const start = last;
      const step = (t: number) => {
        times.push(t - last);
        last = t;
        const p = hook.profile();
        for (const [k, v] of Object.entries({ ...p.loop, ...p.render })) sections[k] = (sections[k] ?? 0) + v;
        if (t - start < duration) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    for (const k of Object.keys(sections)) sections[k] = Math.round(((sections[k] as number) / times.length) * 100) / 100;
    const sorted = [...times].sort((a, b) => a - b);
    const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      frames: times.length,
      avgMs,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] as number,
      maxMs: sorted[sorted.length - 1] as number,
      slowFrames: times.filter((t) => t > 25).length,
      fps: 1000 / avgMs,
      sections,
      onScreen: hook.onScreen(),
    };
  }, ms);
}

function save(key: string, value: unknown): void {
  const file = `${SHOTS}/perf.json`;
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    all = {};
  }
  all[key] = value;
  writeFileSync(file, JSON.stringify(all, null, 2));
}

function report(label: string, w: Window5s): string {
  const line = `${label}: ${w.frames} frames, avg ${w.avgMs.toFixed(1)} ms (${w.fps.toFixed(1)} fps), p95 ${w.p95Ms.toFixed(1)} ms, max ${w.maxMs.toFixed(1)} ms, ${w.slowFrames} frames > 25 ms; on screen ${w.onScreen.mutants} mutants, ${w.onScreen.soldiers} soldiers`;
  console.log(line);
  console.log(`${label} avg ms per frame by section: ${JSON.stringify(w.sections)}`);
  return line;
}

test('render stress at night: 300 mutants + 77 soldiers, paused, heavy effects', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await startGame(page, { seed: 'render-perf', origin: 'militia' });
  await page.evaluate(() => {
    const s = window.scraphold!.session;
    s.paused = true;
    const st = s.game.state as any;
    const template = [...st.entities.values()].find((e: any) => e.kind === 'soldier');
    const core = st.entities.get(st.coreId);
    const mutantTypes = ['wanderer', 'runner', 'crawler', 'spitter', 'boomer', 'wanderer', 'runner'];
    const soldierTypes = ['shieldGuard', 'rifleman', 'sniper', 'grenadier', 'scout', 'flamethrower', 'pickup'];
    const radius: Record<string, number> = { wanderer: 0.32, runner: 0.26, crawler: 0.45, spitter: 0.32, boomer: 0.36 };
    let id = st.nextId + 10_000;
    const soldiers: number[] = [];
    const mutants: number[] = [];
    for (let i = 0; i < 300; i++) {
      const m = structuredClone(template);
      Object.assign(m, { id: id++, kind: 'mutant', faction: 'mutant', type: mutantTypes[i % mutantTypes.length] });
      delete m.order;
      delete m.veterancy;
      m.ai = { mode: 'assault', homeNestId: 0, boss: i === 0, damagePct: 0 };
      m.radius = radius[m.type];
      m.x = core.x - 19 + (i % 30) * 1.3;
      m.y = core.y - 11 + Math.floor(i / 30) * 1.1;
      m.hp = m.maxHp * 0.6;
      m.motion.vx = 0.02;
      m.motion.vy = 0.01;
      st.entities.set(m.id, m);
      mutants.push(m.id);
    }
    for (let i = 0; i < 77; i++) {
      const u = structuredClone(template);
      Object.assign(u, { id: id++, type: soldierTypes[i % soldierTypes.length] });
      u.x = core.x - 14 + (i % 20) * 1.4;
      u.y = core.y + 2.5 + Math.floor(i / 20) * 1.2;
      u.hp = u.maxHp * 0.8;
      st.entities.set(u.id, u);
      soldiers.push(u.id);
    }
    st.fog.fill(2);
    st.clock = { day: 3, phase: 'night', phaseTick: 300, phaseTicks: 1000 };
    s.select(soldiers.slice(0, 12));
    (window as any).__fire = setInterval(() => {
      const t = performance.now();
      for (let k = 0; k < 20; k++) {
        const a = st.entities.get(soldiers[(k * 7) % soldiers.length]);
        const b = st.entities.get(mutants[(k * 13 + Math.floor(t / 100)) % mutants.length]);
        s.effects.push({ kind: 'tracer', x: a.x, y: a.y, x2: b.x, y2: b.y, radius: 0.04, born: t, life: 110, hostile: false });
        s.effects.push({ kind: 'flash', x: a.x, y: a.y, x2: b.x, y2: b.y, radius: 0.35, born: t, life: 80, hostile: false });
      }
      const k = Math.floor(t / 100) % 3;
      s.effects.push({ kind: k === 0 ? 'acid' : 'blast', x: core.x - 8 + k * 6, y: core.y - 6, x2: 0, y2: 0, radius: 1.4, born: t, life: 560, hostile: false });
    }, 100);
  });
  await page.waitForTimeout(500);
  const w = await measure(page, 4000);
  await page.evaluate(() => clearInterval((window as any).__fire));
  const line = report(`render stress (zoom ${await page.evaluate(() => window.scraphold!.session.camera.zoom)})`, w);
  await page.screenshot({ path: `${SHOTS}/p-render-stress-night.png` });
  save('renderStress', { w, lines: [line] });
  expect(w.fps).toBeGreaterThanOrEqual(50);
  expect(errors).toEqual([]);
});

for (const zoom of ['min', DEFAULT_ZOOM] as const) {
  test(`live stress at night, zoom ${zoom}: 300 mutants + 80 soldiers`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startGame(page, { seed: 'perf-live', origin: 'militia' });
    const placed = await page.evaluate(async (z) => {
      const hook = window.scraphold!;
      const s = hook.session;
      await hook.stress({ soldiers: 80, mutants: 300, night: 3 });
      const core = s.game.state.entities.get(s.game.state.coreId)!;
      if (z === 'min') s.zoom(s.camera.viewW / 2, s.camera.viewH / 2, 0);
      else s.camera = { ...s.camera, zoom: z };
      s.centerOn(core.x, core.y);
      s.setSpeed(1);
      return { ...hook.onScreen(), clock: s.game.state.clock };
    }, zoom);
    expect(placed.clock.phase).toBe('night');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/p-live-night-zoom${zoom}.png` });
    const at1x = await measure(page, 5000);
    const l1 = report(`zoom ${zoom} 1x`, at1x);
    await page.evaluate(() => window.scraphold!.session.setSpeed(3));
    const at3x = await measure(page, 5000);
    const l3 = report(`zoom ${zoom} 3x`, at3x);
    await page.screenshot({ path: `${SHOTS}/p-live-night-zoom${zoom}-3x.png` });
    save(`zoom${zoom}`, { placed, at1x, at3x, lines: [l1, l3] });
    if (zoom === 'min') {
      expect(at1x.fps).toBeGreaterThanOrEqual(50);
      expect(at3x.fps).toBeGreaterThanOrEqual(50);
    }
    expect(errors).toEqual([]);
  });
}
