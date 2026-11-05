/**
 * A complete game in the real client at 3x speed. Nobody touches the mouse: the economy bot plays
 * through the ?debug autopilot hook, which asks it for commands before every tick exactly like the
 * headless runner does (it answers the incident cards itself, so they do not open), and the page's
 * own frame loop advances the simulation in real time (about 37 s of wall time per day at 3x, so
 * some 13 minutes for the 20 nights). The test watches the clock, takes screenshots on day 1,
 * during nights 5, 10 and 15 and on the end screen, and checks that the page logged no errors,
 * that the end screen shows a result, and that the final state hash equals a headless run of the
 * same bot and seed (handed over at the same tick), i.e. the client added nothing to the
 * simulation and dropped nothing.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createController } from '../src/headless/bots';
import { runHeadless } from '../src/headless/run';
import { TOTAL_NIGHTS } from '../src/sim/time';
import { collectErrors, startGame } from './support';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const SEED = 'full-game-01';
const ORIGIN = 'militia';
const BOT = 'economy';

type Clock = { day: number; phase: string; phaseTick: number };

test('a full game at 3x speed, played by the economy bot through the client, ends with a result', async ({ page }) => {
  test.setTimeout(32 * 60_000);
  const errors = collectErrors(page);

  await startGame(page, { seed: SEED, origin: ORIGIN });
  // Pause, hand the game to the bot, then play at 3x. The first few ticks already ran without
  // commands; the headless reference does the same and starts its own fresh bot at that tick.
  await page.keyboard.press('Space');
  await page.evaluate((bot) => window.scraphold!.autopilot(bot), BOT);
  const handover = await page.evaluate(() => window.scraphold!.summary().tick);
  const bot = createController(BOT);
  const expected = runHeadless({ seed: SEED, origin: ORIGIN, difficulty: 'normal', days: TOTAL_NIGHTS + 1, controller: (game, events) => (game.state.tick < handover ? [] : bot(game, events)) });
  await page.getByTestId('speed-3').click();

  const shots: { name: string; when: (c: Clock) => boolean; done?: boolean }[] = [
    { name: '11-full-game-day1', when: (c) => c.day === 1 && c.phase === 'day' && c.phaseTick >= 500 },
    { name: '12-full-game-night5', when: (c) => c.day === 5 && c.phase === 'night' && c.phaseTick >= 500 },
    { name: '13-full-game-night10', when: (c) => c.day === 10 && c.phase === 'night' && c.phaseTick >= 500 },
    { name: '13b-full-game-night15', when: (c) => c.day === 15 && c.phase === 'night' && c.phaseTick >= 500 },
  ];
  const started = Date.now();
  const timeline: string[] = [];
  let lastDay = 0;
  for (;;) {
    const s = await page.evaluate(() => window.scraphold!.summary());
    if (s.clock.day !== lastDay) {
      lastDay = s.clock.day;
      timeline.push(`day ${s.clock.day} at ${Math.round((Date.now() - started) / 1000)} s`);
    }
    for (const shot of shots) {
      if (shot.done || !shot.when(s.clock)) continue;
      shot.done = true;
      await page.screenshot({ path: `${SHOTS}/${shot.name}.png` });
    }
    if (s.outcome !== 'playing') break;
    expect(Date.now() - started, `game still running on day ${s.clock.day}`).toBeLessThan(30 * 60_000);
    await page.waitForTimeout(500);
  }
  const wallSeconds = Math.round((Date.now() - started) / 1000);

  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.locator('.end .headline')).toHaveText(/\S/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/14-full-game-end.png` });

  const final = await page.evaluate(() => ({ ...window.scraphold!.summary(), hash: window.scraphold!.hash(), headline: document.querySelector('.end .headline')?.textContent ?? '' }));
  console.log(`full game: ${final.outcome} (${final.headline}) on day ${final.clock.day} ${final.clock.phase}, tick ${final.tick}, ${wallSeconds} s wall time at 3x`);
  console.log(`timeline: ${timeline.join(', ')}`);
  console.log(`headless: ${expected.outcome} on day ${expected.clock.day}, tick ${expected.ticks}, score ${expected.score ?? '-'}`);
  test.info().annotations.push({ type: 'full-game', description: `${final.outcome} on day ${final.clock.day}, ${wallSeconds} s at 3x` });

  expect(final.outcome).toBe(expected.outcome);
  expect(final.tick).toBe(expected.ticks);
  expect(final.hash).toBe(expected.hash);
  expect(errors, 'console errors').toEqual([]);
});
