/**
 * Frame rate with the live simulation: about 80 soldiers around the core and 300 mutants assaulting
 * from a ring 12-22 tiles out, at night, all on screen. The scenario is built with the simulation's
 * own entity factories (sim/scenarios.ts through the ?debug hook) and then everything runs through
 * the normal frame loop: simulation steps, targeting, movement, combat, effects, rendering, HUD.
 * Mutants are sturdier and hit softer than normal so both sides last while frames are measured.
 * Measured for 5 s at 1x (the acceptance target, >= 50 fps) and 5 s at 3x.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MIN_ZOOM } from '../src/client/camera';
import { collectErrors, startGame } from './support';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

interface Window5s {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Frames longer than 25 ms (a missed vsync at 60 Hz shows as ~33 ms). */
  slowFrames: number;
  fps: number;
  sections: Record<string, number>;
  /** Longest single-frame time per section. */
  sectionMax: Record<string, number>;
  /** HUD (Preact) refreshes in the window: count, average and longest render. */
  hud: { renders: number; avgMs: number; maxMs: number };
  before: { soldiers: number; mutants: number };
  after: { soldiers: number; mutants: number };
}

async function measure(page: Page, ms: number): Promise<Window5s> {
  return page.evaluate(async (duration) => {
    const hook = window.scraphold!;
    const before = hook.onScreen();
    const hudBefore = hook.profile().hud;
    const times: number[] = [];
    const sections: Record<string, number> = {};
    const sectionMax: Record<string, number> = {};
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const start = last;
      const step = (t: number) => {
        times.push(t - last);
        last = t;
        const p = hook.profile();
        for (const [k, v] of Object.entries({ ...p.loop, ...p.render })) {
          sections[k] = (sections[k] ?? 0) + v;
          sectionMax[k] = Math.max(sectionMax[k] ?? 0, Math.round(v * 10) / 10);
        }
        if (t - start < duration) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    for (const k of Object.keys(sections)) sections[k] = Math.round(((sections[k] as number) / times.length) * 100) / 100;
    const sorted = [...times].sort((a, b) => a - b);
    const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
    const hudAfter = hook.profile().hud;
    const renders = hudAfter.renders - hudBefore.renders;
    return {
      hud: { renders, avgMs: renders > 0 ? Math.round(((hudAfter.totalMs - hudBefore.totalMs) / renders) * 100) / 100 : 0, maxMs: Math.round(hudAfter.maxMs * 10) / 10 },
      frames: times.length,
      avgMs,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] as number,
      maxMs: sorted[sorted.length - 1] as number,
      slowFrames: times.filter((t) => t > 25).length,
      fps: 1000 / avgMs,
      sections,
      sectionMax,
      before,
      after: hook.onScreen(),
    };
  }, ms);
}

function report(label: string, w: Window5s): void {
  console.log(
    `${label}: ${w.frames} frames, avg ${w.avgMs.toFixed(1)} ms (${w.fps.toFixed(1)} fps), p95 ${w.p95Ms.toFixed(1)} ms, max ${w.maxMs.toFixed(1)} ms, ${w.slowFrames} frames > 25 ms; on screen ${w.before.mutants}→${w.after.mutants} mutants, ${w.before.soldiers}→${w.after.soldiers} soldiers`,
  );
  console.log(`${label} avg ms per frame by section: ${JSON.stringify(w.sections)}`);
  console.log(`${label} max ms in one frame by section: ${JSON.stringify(w.sectionMax)}`);
  console.log(`${label} HUD refreshes: ${w.hud.renders}, avg ${w.hud.avgMs} ms, longest so far ${w.hud.maxMs} ms`);
}

test('live simulation: 300 mutants + 80 soldiers fighting at night stay >= 50 fps', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  // Militia starts with 2 riflemen; with 80 more the army is a bit over 80 even if one fell on nights 1-2.
  await startGame(page, { seed: 'perf-live', origin: 'militia' });

  // Zoomed out as far as the camera goes, so the whole fight is on screen.
  const placed = await page.evaluate(async (zoom) => {
    const hook = window.scraphold!;
    const s = hook.session;
    await hook.stress({ soldiers: 80, mutants: 300, night: 3 });
    const core = s.game.state.entities.get(s.game.state.coreId)!;
    s.camera = { ...s.camera, zoom };
    s.centerOn(core.x, core.y);
    s.setSpeed(1);
    return { ...hook.onScreen(), clock: s.game.state.clock };
  }, MIN_ZOOM);
  console.log(`scenario at day ${placed.clock.day} ${placed.clock.phase}: ${placed.mutants} mutants, ${placed.soldiers} soldiers on screen`);
  expect(placed.clock.phase).toBe('night');
  expect(placed.mutants).toBeGreaterThanOrEqual(300);
  expect(placed.soldiers).toBeGreaterThanOrEqual(80);

  // Let the horde close in so the fight is on when measuring.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/15-live-perf-night.png` });
  const at1x = await measure(page, 5000);
  report('live 1x', at1x);
  await page.evaluate(() => window.scraphold!.session.setSpeed(3));
  const at3x = await measure(page, 5000);
  report('live 3x', at3x);
  await page.screenshot({ path: `${SHOTS}/16-live-perf-night-3x.png` });

  expect(at1x.after.mutants, 'most of the horde still on screen at the end of the 1x window').toBeGreaterThanOrEqual(250);
  expect(at1x.fps).toBeGreaterThanOrEqual(50);
  expect(at3x.fps).toBeGreaterThanOrEqual(50);
  expect(errors, 'console errors').toEqual([]);
});
