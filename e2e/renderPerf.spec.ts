/**
 * Rendering cost check: 300 mutants + 80 soldiers on screen at night with heavy combat effects
 * (200 shots and 10 explosions per second, about 2.5 shots per soldier per second). The game is paused and the extra entities are cloned into the state from the test
 * (test-only; the simulation is not stepped), so this measures the client's frame cost alone.
 * The end-to-end performance acceptance with a live simulation is Task 6's.
 */
import { expect, test } from '@playwright/test';
import { startGame } from './support';

test('300 mutants + 80 soldiers at night render at >= 50 fps', async ({ page }) => {
  await startGame(page, { seed: 'render-perf', origin: 'militia' });

  const result = await page.evaluate(async () => {
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
    const fire = setInterval(() => {
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
    await new Promise((r) => setTimeout(r, 500));
    const times: number[] = [];
    const sections: Record<string, number> = {};
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const start = last;
      const step = (t: number) => {
        times.push(t - last);
        last = t;
        const p = window.scraphold!.profile();
        for (const [k, v] of Object.entries({ ...p.loop, ...p.render })) sections[k] = (sections[k] ?? 0) + v;
        if (t - start < 4000) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    clearInterval(fire);
    for (const k of Object.keys(sections)) sections[k] = Math.round(((sections[k] as number) / times.length) * 100) / 100;
    return { times, sections };
  });
  const { times: frames, sections } = result;

  const sorted = [...frames].sort((a, b) => a - b);
  const avgMs = frames.reduce((a, b) => a + b, 0) / frames.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] as number;
  const fps = 1000 / avgMs;
  console.log(`render perf: ${frames.length} frames, avg ${avgMs.toFixed(1)} ms (${fps.toFixed(1)} fps), p95 ${p95.toFixed(1)} ms`);
  console.log(`avg ms per frame by section: ${JSON.stringify(sections)}`);
  await page.screenshot({ path: 'e2e/screenshots/10-render-stress-night.png' });
  expect(fps).toBeGreaterThanOrEqual(50);
});
