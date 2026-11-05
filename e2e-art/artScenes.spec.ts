/**
 * Fixed scenes for reviewing the art pass, with fixed seeds: an early and a developed day base,
 * dusk, a night battle with many unit and mutant types, the placement ghost, and close-ups of
 * every soldier and mutant type (day, night, and grayscale to check silhouettes without color).
 * Each scene is saved with the HUD and as a world-only shot (HUD hidden).
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, startGame } from '../e2e/support';

const SHOTS = 'e2e-art/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function start(page: Page, seed: string): Promise<void> {
  await startGame(page, { seed, origin: 'militia' });
  await page.evaluate(() => {
    window.scraphold!.session.paused = true;
  });
}

async function shot(page: Page, name: string, worldOnly = true): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  if (!worldOnly) return;
  const style = await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas.world { visibility: visible !important; }' });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/${name}-world.png` });
  await style.evaluate((el) => (el as HTMLStyleElement).remove());
}

async function camera(page: Page, x: number | null, y: number | null, zoom: number): Promise<void> {
  await page.evaluate(
    ({ x, y, zoom }) => {
      const s = window.scraphold!.session;
      const st = s.game.state;
      const core = st.entities.get(st.coreId)!;
      s.camera = { ...s.camera, zoom };
      s.centerOn(x ?? core.x, y ?? core.y);
    },
    { x, y, zoom },
  );
}

test('day base, early', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'art-day');
  await page.evaluate(() => window.scraphold!.advance(160));
  await camera(page, null, null, 44);
  await shot(page, 'a01-day-early');
  await camera(page, null, null, 26);
  await shot(page, 'a02-day-early-wide', false);
  expect(errors).toEqual([]);
});

test('developed base: day, dusk, night battle', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await start(page, 'art-base');
  await page.evaluate(async () => {
    const hook = window.scraphold!;
    await hook.autopilot('economy');
    hook.advance(2200 * 3 + 380);
    // Fast-forwarding piles three nights of corpses into one moment; start the day clean.
    hook.session.effects = [];
  });
  await camera(page, null, null, 44);
  await shot(page, 'a03-day-developed');
  await camera(page, null, null, 28);
  await shot(page, 'a04-day-developed-wide', false);
  await page.evaluate(() => window.scraphold!.advance(2200 * 3 + 900 + 220 - window.scraphold!.session.game.state.tick));
  await camera(page, null, null, 34);
  await shot(page, 'a05-dusk');
  // Night: reinforce both sides so the fight shows every type, then let it run in real time.
  const placed = await page.evaluate(async () => {
    const hook = window.scraphold!;
    const s = hook.session;
    s.autopilot = null;
    await hook.stress({ soldiers: 34, mutants: 80, night: 4 });
    s.advanceTicks(260, performance.now());
    s.setSpeed(1);
    return hook.onScreen();
  });
  expect(placed.mutants).toBeGreaterThan(0);
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    window.scraphold!.session.paused = true;
  });
  await camera(page, null, null, 30);
  await shot(page, 'a06-night-battle');
  await camera(page, null, null, 46);
  await shot(page, 'a07-night-battle-close');
  expect(errors).toEqual([]);
});

test('placement ghost', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'art-day');
  await camera(page, null, null, 44);
  await page.evaluate(() => {
    const hook = window.scraphold!;
    const s = hook.session;
    s.startPlacing('greenhouse');
    const best = hook.bestPlacement('greenhouse', { x0: 380, y0: 120, x1: 1300, y1: 640 });
    if (best) s.hover = { x: best.tileX + 1, y: best.tileY + 1 };
  });
  await shot(page, 'a08-placement-ghost');
  await page.evaluate(() => {
    const s = window.scraphold!.session;
    const st = s.game.state;
    const core = st.entities.get(st.coreId)!;
    s.startPlacing('barracks');
    s.hover = { x: core.x + 0.5, y: core.y };
  });
  await shot(page, 'a09-placement-blocked', false);
  expect(errors).toEqual([]);
});

/** Lines up every soldier type facing every mutant type near the core (paused, fog cleared). */
async function roster(page: Page, night: boolean): Promise<void> {
  await page.evaluate((night) => {
    const s = window.scraphold!.session;
    const st = s.game.state as any;
    const template = [...st.entities.values()].find((e: any) => e.kind === 'soldier');
    const core = st.entities.get(st.coreId);
    const soldierTypes = ['shieldGuard', 'rifleman', 'sniper', 'grenadier', 'scout', 'flamethrower', 'pickup'];
    const mutantTypes = ['wanderer', 'runner', 'crawler', 'spitter', 'boomer', 'behemoth'];
    const radius: Record<string, number> = { wanderer: 0.32, runner: 0.26, crawler: 0.45, spitter: 0.32, boomer: 0.36, behemoth: 0.8, pickup: 0.5 };
    let id = st.nextId + 20_000;
    const ids: number[] = [];
    const baseX = core.x - 5.5;
    const baseY = core.y + 3.2;
    soldierTypes.forEach((type, k) => {
      const u = structuredClone(template);
      Object.assign(u, { id: id++, type, x: baseX + k * 1.6, y: baseY });
      u.radius = radius[type] ?? 0.3;
      u.motion.vx = 0;
      u.motion.vy = -0.0001;
      u.hp = k % 3 === 1 ? u.maxHp * 0.55 : u.maxHp;
      u.attack.targetId = 0;
      st.entities.set(u.id, u);
      ids.push(u.id);
    });
    mutantTypes.forEach((type, k) => {
      const m = structuredClone(template);
      Object.assign(m, { id: id++, kind: 'mutant', faction: 'mutant', type, x: baseX + 0.6 + k * 1.75, y: baseY + 2.4 + (type === 'behemoth' ? 0.4 : 0) });
      delete m.order;
      delete m.veterancy;
      m.ai = { mode: 'assault', homeNestId: 0, boss: type === 'behemoth', damagePct: 0 };
      m.radius = radius[type];
      m.motion.vx = 0;
      m.motion.vy = -0.0001;
      m.attack.targetId = 0;
      m.hp = k % 2 === 0 ? m.maxHp * 0.4 : m.maxHp;
      st.entities.set(m.id, m);
    });
    st.fog.fill(2);
    if (night) st.clock = { day: 3, phase: 'night', phaseTick: 400, phaseTicks: 1000 };
    s.select(ids.slice(0, 2));
    s.camera = { ...s.camera, zoom: 80 };
    s.centerOn(baseX + 4.8, baseY + 1.4);
  }, night);
}

test('close-up: every soldier and mutant type', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'art-day');
  await roster(page, false);
  await shot(page, 'a10-closeup-roster-day');
  const style = await page.addStyleTag({ content: 'canvas.world { filter: grayscale(1); }' });
  await shot(page, 'a11-closeup-roster-grayscale', false);
  await style.evaluate((el) => (el as HTMLStyleElement).remove());
  await page.evaluate(() => {
    const s = window.scraphold!.session;
    s.camera = { ...s.camera, zoom: 44 };
  });
  await shot(page, 'a12-roster-default-zoom', false);
  expect(errors).toEqual([]);
});

test('close-up at night', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'art-day');
  await roster(page, true);
  await shot(page, 'a13-closeup-roster-night');
  expect(errors).toEqual([]);
});

test('terrain tour: water, oil, wreckage, ruins, walls', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'art-base');
  const spots = await page.evaluate(() => {
    const st = window.scraphold!.session.game.state as any;
    st.fog.fill(1);
    const { width, height, terrain } = st.map;
    const core = st.map.coreTile;
    const want: Record<string, number> = { water: 4, oil: 3, wreckage: 2, ruin: 7, wall: 6 };
    const out: Record<string, { x: number; y: number }> = {};
    for (const [name, code] of Object.entries(want)) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let y = 2; y < height - 2; y++)
        for (let x = 2; x < width - 2; x++) {
          if (terrain[y * width + x] !== code) continue;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (terrain[(y + dy) * width + x + dx] === code) n++;
          const d = (x - core.x) ** 2 + (y - core.y) ** 2 - n * 40;
          if (!best || d < best.d) best = { x: x + 0.5, y: y + 0.5, d };
        }
      if (best) out[name] = { x: best.x, y: best.y };
    }
    return out;
  });
  let k = 14;
  for (const [name, p] of Object.entries(spots)) {
    await camera(page, p.x, p.y, 44);
    await page.evaluate(() => {
      (window.scraphold!.session.game.state as any).fog.fill(2);
    });
    await page.waitForTimeout(400);
    const style = await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas.world { visibility: visible !important; }' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/a${k++}-terrain-${name}.png` });
    await style.evaluate((el) => (el as HTMLStyleElement).remove());
  }
  expect(errors).toEqual([]);
});
