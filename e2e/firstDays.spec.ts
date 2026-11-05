/**
 * The first days as a player who has read nothing, through the real mouse and keyboard: the
 * opening checklist ticks off as the steps are done (including hovering the fog calendar), F1 and
 * the 帮助 button open the help with time stopped, a greenhouse goes on fertile soil, survivors are
 * put to work, a barracks trains soldiers, the dusk report shows where tonight's attack comes
 * from, soldiers are moved that way, and the game runs through nights 1 and 2 to day 3. Incident
 * cards that pop up on the way (this seed has events on days 2 and 3) are answered like a player
 * does, by clicking an available choice; the checklist then ticks off the incident step. Also
 * checks the old pitfall that a soldier right-clicking a damaged own building only walks there and
 * never repairs it. The ?debug hook only tells the test where things are on screen and what the
 * state is (plus one setup step that damages a building). Screenshots go to e2e/screenshots/.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { answerIncidentCard, collectErrors, playUntil, startGame } from './support';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** Screen area not covered by the HUD at 1440x900 (top bar, event log, guide, bottom panels). */
const SAFE = { x0: 380, y0: 110, x1: 1060, y1: 620 };

type DebugEntity = { id: number; kind: string; type: string; sx: number; sy: number; hp: number; task: string | null; insideId: number | null; constructing: boolean | null };

async function entities(page: Page, kind?: string): Promise<DebugEntity[]> {
  return page.evaluate((k) => window.scraphold!.entities(k) as DebugEntity[], kind);
}

async function guideDone(page: Page, step: string): Promise<boolean> {
  return (await page.getByTestId(`guide-${step}`).getAttribute('class'))?.includes('done') ?? false;
}

test('first days as a new player: guide, help, build, staff, train, dusk report, nights 1 and 2', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await startGame(page, { seed: 'first-days-01' });

  await test.step('the opening checklist is there; F1 and the 帮助 button open the help with time stopped', async () => {
    await expect(page.getByTestId('guide')).toBeVisible();
    await expect(page.getByTestId('guide').locator('li')).toHaveCount(9);
    // Nothing is selected yet, so the bottom edge has no selection panel; the guide folds to its next step and back.
    await expect(page.getByTestId('selection-panel')).toBeHidden();
    await page.getByTestId('guide-toggle').click();
    await expect(page.getByTestId('guide')).toHaveClass(/collapsed/);
    await expect(page.getByTestId('guide-produce')).toBeVisible();
    await expect(page.getByTestId('guide-survive')).toBeHidden();
    await page.getByTestId('guide-toggle').click();
    await expect(page.getByTestId('guide-survive')).toBeVisible();
    await page.mouse.move(700, 300);
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-modal')).toBeVisible();
    const tick = (await page.evaluate(() => window.scraphold!.summary())).tick;
    await page.waitForTimeout(600);
    expect((await page.evaluate(() => window.scraphold!.summary())).tick).toBe(tick);
    await page.screenshot({ path: `${SHOTS}/21-help.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-modal')).toBeHidden();
    await page.getByTestId('help').click();
    await expect(page.getByTestId('help-modal')).toBeVisible();
    await page.getByTestId('help-modal').getByRole('button', { name: /关闭/ }).click();
    await expect(page.getByTestId('help-modal')).toBeHidden();
  });

  await test.step('hovering the fog calendar opens its card and ticks off the calendar step', async () => {
    await page.getByTestId('calendar-strip').hover();
    await expect(page.getByTestId('calendar-tip')).toBeVisible();
    await expect.poll(() => guideDone(page, 'calendar')).toBe(true);
    await page.mouse.move(700, 300);
    await expect(page.getByTestId('calendar-tip')).toBeHidden();
  });

  await test.step('pause, put a greenhouse on the best fertile spot (R), the hover hint names the terrain', async () => {
    await page.keyboard.press('Space');
    const spot = await page.evaluate((safe) => window.scraphold!.bestPlacement('greenhouse', safe), SAFE);
    expect(spot, 'a greenhouse spot on screen').not.toBeNull();
    expect(spot!.bonus).toBeGreaterThan(0);
    await page.mouse.move(spot!.sx, spot!.sy);
    await expect(page.getByTestId('terrain-hint')).toContainText('：');
    await page.keyboard.press('KeyR');
    await page.mouse.move(spot!.sx + 1, spot!.sy);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/20-first-day-guide.png` });
    await page.mouse.click(spot!.sx, spot!.sy);
    await expect.poll(() => guideDone(page, 'produce')).toBe(true);
  });

  await test.step('box-select the survivors and right-click the salvage yard: they go to work', async () => {
    const yard = (await entities(page, 'building')).find((b) => b.type === 'salvageYard')!;
    await page.evaluate((id) => {
      const s = window.scraphold!.session;
      const e = s.game.state.entities.get(id)!;
      s.centerOn(e.x, e.y + 4);
    }, yard.id);
    const idle = (await entities(page, 'survivor')).filter((s) => s.task === 'idle' && s.sx > SAFE.x0 && s.sx < SAFE.x1 && s.sy > SAFE.y0 && s.sy < SAFE.y1);
    expect(idle.length).toBeGreaterThan(0);
    const xs = idle.map((s) => s.sx);
    const ys = idle.map((s) => s.sy);
    await page.mouse.move(Math.min(...xs) - 20, Math.min(...ys) - 20);
    await page.mouse.down();
    await page.mouse.move(Math.max(...xs) + 20, Math.max(...ys) + 20, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('selection-panel')).toContainText('右键生产建筑：派去工作');
    const target = (await entities(page, 'building')).find((b) => b.id === yard.id)!;
    await page.mouse.click(target.sx, target.sy, { button: 'right' });
    await expect.poll(() => guideDone(page, 'staff')).toBe(true);
  });

  let barracksId = 0;
  await test.step('build a barracks (B), train a rifleman from its panel', async () => {
    const spot = await page.evaluate((safe) => window.scraphold!.findPlacement('barracks', safe), SAFE);
    expect(spot).not.toBeNull();
    await page.keyboard.press('KeyB');
    await page.mouse.move(spot!.sx, spot!.sy);
    await page.mouse.click(spot!.sx, spot!.sy);
    await expect.poll(() => guideDone(page, 'barracks')).toBe(true);
    barracksId = (await entities(page, 'building')).find((b) => b.type === 'barracks')!.id;
    await page.getByTestId('speed-3').click();
    await expect.poll(async () => (await entities(page, 'building')).find((b) => b.id === barracksId)!.constructing, { timeout: 60_000 }).toBe(false);
    const b = (await entities(page, 'building')).find((e) => e.id === barracksId)!;
    await page.mouse.click(b.sx, b.sy);
    await page.getByTestId('train-rifleman').hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/22-train-tooltip.png` });
    await page.getByTestId('train-rifleman').click();
    await expect.poll(() => guideDone(page, 'train')).toBe(true);
    await page.getByTestId('train-shieldGuard').click();
    await expect.poll(async () => (await entities(page, 'soldier')).length, { timeout: 60_000 }).toBeGreaterThan(0);
  });

  await test.step('pitfall: a soldier right-clicking a damaged own building walks there and never repairs it', async () => {
    await page.keyboard.press('Space');
    const yard = (await entities(page, 'building')).find((b) => b.type === 'salvageYard')!;
    await page.evaluate((id) => {
      const e = window.scraphold!.session.game.state.entities.get(id)!;
      e.hp = e.maxHp - 120;
    }, yard.id);
    const soldier = (await entities(page, 'soldier'))[0]!;
    await page.mouse.click(soldier.sx, soldier.sy);
    await expect.poll(() => page.evaluate(() => window.scraphold!.session.selection.length)).toBe(1);
    const y = (await entities(page, 'building')).find((b) => b.id === yard.id)!;
    await page.mouse.click(y.sx, y.sy, { button: 'right' });
    const order = await page.evaluate((id) => (window.scraphold!.session.game.state.entities.get(id) as { order: { type: string } }).order.type, soldier.id);
    expect(order).toBe('move');
    const hpBefore = (await entities(page, 'building')).find((b) => b.id === yard.id)!.hp;
    await page.keyboard.press('Space');
    await page.waitForTimeout(2500);
    const hpAfter = (await entities(page, 'building')).find((b) => b.id === yard.id)!.hp;
    expect(hpAfter).toBeLessThanOrEqual(hpBefore);
    await page.keyboard.press('Escape');
  });

  await test.step('dusk: the report is up top and the soldiers go toward the attack', async () => {
    const c = await playUntil(page, (s) => s.phase === 'dusk');
    expect(c.outcome).toBe('playing');
    await expect(page.getByTestId('forecast')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/23-dusk-report.png` });
    await sendSoldiersTowardForecast(page);
  });

  await test.step('night 1, then day 2: pause at dawn and queue more soldiers; the checklist is still up', async () => {
    let c = await playUntil(page, (s) => s.phase === 'night');
    await expect.poll(() => guideDone(page, 'forecast')).toBe(true);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${SHOTS}/24-night-1.png` });
    c = await playUntil(page, (s) => s.day >= 2);
    expect(c.outcome).toBe('playing');
    // Plan the day paused, as a player does; a card that opened before the pause is answered first.
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeVisible();
    await answerIncidentCard(page);
    // The checklist now runs into days 2-3: the incident and relay steps are still open.
    await expect(page.getByTestId('guide')).toBeVisible();
    await expect(page.getByTestId('guide-relay')).not.toHaveClass(/done/);
    const b = (await entities(page, 'building')).find((e) => e.id === barracksId)!;
    await page.evaluate((id) => {
      const s = window.scraphold!.session;
      const e = s.game.state.entities.get(id)!;
      s.centerOn(e.x, e.y);
    }, b.id);
    const bb = (await entities(page, 'building')).find((e) => e.id === barracksId)!;
    await page.mouse.click(bb.sx, bb.sy);
    for (const unit of ['rifleman', 'rifleman', 'shieldGuard', 'rifleman']) {
      await page.getByTestId(`train-${unit}`).click();
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: `${SHOTS}/25-day-2.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeHidden();
  });

  await test.step("day 2's incident card is answered by clicking a choice, and the checklist ticks it off", async () => {
    expect(await page.evaluate(() => window.scraphold!.session.game.state.incidents.eventDays.includes(2))).toBe(true);
    const c = await playUntil(page, (s) => s.day === 2 && s.phase === 'dusk');
    expect(c.outcome).toBe('playing');
    const history = await page.evaluate(() => window.scraphold!.session.game.state.incidents.history.map((h) => ({ automatic: h.automatic, raisedTick: h.raisedTick })));
    expect(history.length, 'the day-2 incident was answered before dusk').toBeGreaterThan(0);
    expect(history.every((h) => !h.automatic)).toBe(true);
    await expect.poll(() => guideDone(page, 'incident')).toBe(true);
    await page.getByTestId('guide-close').click();
    await expect(page.getByTestId('guide')).toBeHidden();
  });

  await test.step('night 2 with the soldiers placed toward the forecast, to day 3', async () => {
    let c = await playUntil(page, (s) => s.day === 2 && s.phase === 'dusk');
    if (c.outcome === 'playing') await sendSoldiersTowardForecast(page);
    c = await playUntil(page, (s) => s.day === 2 && s.phase === 'night');
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `${SHOTS}/26-night-2.png` });
    c = await playUntil(page, (s) => s.day >= 3);
    await page.screenshot({ path: `${SHOTS}/27-day-3.png` });
    test.info().annotations.push({ type: 'first-days', description: `${c.outcome} on day ${c.day} ${c.phase}` });
    console.log(`first days: ${c.outcome} on day ${c.day} ${c.phase}`);
  });

  expect(errors, 'console errors').toEqual([]);
});

/** Select every soldier on screen (box) and right-click the ground 6 tiles from the core toward tonight's first forecast direction. */
async function sendSoldiersTowardForecast(page: Page): Promise<void> {
  const target = await page.evaluate(() => {
    const s = window.scraphold!.session;
    const st = s.game.state;
    const core = st.entities.get(st.coreId)!;
    s.centerOn(core.x, core.y);
    const g = st.night.forecast?.groups[0];
    const sp = g ? st.map.spawnPoints.find((p) => p.direction === g.direction) : undefined;
    if (!sp) return null;
    const sx = (sp.tile % st.map.width) + 0.5 - core.x;
    const sy = Math.floor(sp.tile / st.map.width) + 0.5 - core.y;
    const len = Math.hypot(sx, sy);
    return window.scraphold!.toScreen(core.x + (sx / len) * 6, core.y + (sy / len) * 6);
  });
  if (!target) return;
  await page.mouse.move(SAFE.x0, SAFE.y0);
  await page.mouse.down();
  await page.mouse.move(SAFE.x1, SAFE.y1, { steps: 6 });
  await page.mouse.up();
  // The box takes only soldiers when it catches any.
  const soldiersSelected = await page.evaluate(() => {
    const s = window.scraphold!.session;
    return s.selection.filter((id) => s.game.state.entities.get(id)?.kind === 'soldier').length;
  });
  if (soldiersSelected === 0) return;
  await page.mouse.click(target.x, target.y, { button: 'right' });
}
