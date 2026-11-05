/**
 * Browser flow: pick an origin → start → place a building → assign a worker → train a unit →
 * reach night 1, with no console errors. Inputs go through the real mouse and keyboard; the
 * `?debug` hook only tells the test where things are on screen and what the state is.
 * Screenshots go to e2e/screenshots/.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { closeIntroCard, collectErrors, startFromMenu, startGame } from './support';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

/**
 * Screen area not covered by the HUD at 1440x900 while nothing is selected: below the top bar,
 * right of the event log, left of the guide and build dock; the bottom middle stays free because
 * the selection panel only appears once something is selected.
 */
const SAFE = { x0: 380, y0: 90, x1: 1080, y1: 840 };

type DebugEntity = { id: number; kind: string; type: string; sx: number; sy: number; task: string | null; insideId: number | null; constructing: boolean | null; queue: number | null };

async function entities(page: Page, kind?: string): Promise<DebugEntity[]> {
  return page.evaluate((k) => window.scraphold!.entities(k) as DebugEntity[], kind);
}

async function entity(page: Page, id: number): Promise<DebugEntity> {
  const found = (await entities(page)).find((e) => e.id === id);
  if (!found) throw new Error(`entity ${id} is gone`);
  return found;
}

async function centerOn(page: Page, id: number): Promise<DebugEntity> {
  await page.evaluate((target) => {
    const s = window.scraphold!;
    const e = s.session.game.state.entities.get(target)!;
    s.session.centerOn(e.x, e.y);
  }, id);
  return entity(page, id);
}

async function selection(page: Page): Promise<number[]> {
  return page.evaluate(() => [...window.scraphold!.session.selection]);
}

test('origin → start → build → assign → train → night 1', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');

  await test.step('pick an origin and start', async () => {
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await page.getByTestId('seed-custom').click();
    await page.locator('.seed-row input').fill('e2e-wasteland-01');
    await page.getByTestId('origin-militia').click();
    await page.getByTestId('origin-scavengers').click();
    await expect(page.getByTestId('origin-scavengers')).toHaveClass(/on/);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/01-start-screen.png` });
    await page.getByTestId('start').click();
    await expect(page.getByTestId('world')).toBeVisible();
    await page.waitForFunction(() => window.scraphold !== undefined);
    await closeIntroCard(page);
    await expect(page.getByTestId('day')).toContainText('第1天');
  });

  let barracksId = 0;
  await test.step('place a building (barracks via hotkey B)', async () => {
    const spot = await page.evaluate((safe) => window.scraphold!.findPlacement('barracks', safe), SAFE);
    expect(spot, 'a valid barracks spot near the core').not.toBeNull();
    await page.keyboard.press('KeyB');
    await page.mouse.move(spot!.sx, spot!.sy);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/02-placement-ghost.png` });
    await page.mouse.click(spot!.sx, spot!.sy);
    await expect.poll(async () => (await entities(page, 'building')).filter((b) => b.type === 'barracks').length).toBe(1);
    barracksId = (await entities(page, 'building')).find((b) => b.type === 'barracks')!.id;
  });

  await test.step('assign a worker (select survivor, right-click salvage yard)', async () => {
    const yardId = (await entities(page, 'building')).find((b) => b.type === 'salvageYard')!.id;
    const yard = await centerOn(page, yardId);
    const survivor = (await entities(page, 'survivor'))
      .filter((s) => s.task === 'idle' && s.insideId === 0 && s.sx > SAFE.x0 && s.sx < SAFE.x1 && s.sy > SAFE.y0 && s.sy < SAFE.y1)
      .sort((a, b) => Math.hypot(a.sx - yard.sx, a.sy - yard.sy) - Math.hypot(b.sx - yard.sx, b.sy - yard.sy))[0];
    expect(survivor, 'an idle survivor on screen').toBeTruthy();
    await page.mouse.click(survivor!.sx, survivor!.sy);
    await expect.poll(() => selection(page)).toEqual([survivor!.id]);
    await page.mouse.click(yard.sx, yard.sy, { button: 'right' });
    await expect.poll(async () => (await entity(page, survivor!.id)).task).toBe('work');
  });

  await test.step('train a unit (barracks → rifleman)', async () => {
    await page.getByTestId('speed-3').click();
    await expect.poll(async () => (await entity(page, barracksId)).constructing, { timeout: 30_000 }).toBe(false);
    const barracks = await centerOn(page, barracksId);
    await page.mouse.click(barracks.sx, barracks.sy);
    await expect.poll(() => selection(page)).toEqual([barracksId]);
    const soldiersBefore = (await entities(page, 'soldier')).length;
    await page.getByTestId('train-rifleman').click();
    await expect.poll(async () => (await entity(page, barracksId)).queue).toBe(1);
    await page.getByTestId('speed-1').click();
    await page.mouse.move(barracks.sx + 160, barracks.sy + 40);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/03-day-hud.png` });
    await page.getByTestId('speed-3').click();
    await expect.poll(async () => (await entities(page, 'soldier')).length, { timeout: 30_000 }).toBe(soldiersBefore + 1);
  });

  await test.step('reach night 1 (3x speed)', async () => {
    await page.getByTestId('speed-3').click();
    await expect(page.getByTestId('phase')).toHaveText('夜晚', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const s = window.scraphold!.session;
      const core = s.game.state.entities.get(s.game.state.coreId)!;
      s.centerOn(core.x, core.y);
    });
    await page.mouse.move(720, 420);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/04-night.png` });
  });

  await test.step('night 1 combat (screenshot when mutants reach the base; depends on Task 3)', async () => {
    const near = () =>
      page.evaluate(() => {
        const st = window.scraphold!.session.game.state;
        const core = st.entities.get(st.coreId)!;
        for (const e of st.entities.values()) {
          const visible = st.fog[Math.floor(e.y) * st.map.width + Math.floor(e.x)] === 2;
          if (e.kind === 'mutant' && visible) return { x: (e.x + core.x) / 2, y: (e.y + core.y) / 2 };
        }
        return null;
      });
    const deadline = Date.now() + 30_000;
    let spot = await near();
    while (!spot && Date.now() < deadline && (await page.evaluate(() => window.scraphold!.session.game.state.clock.phase)) === 'night') {
      await page.waitForTimeout(250);
      spot = await near();
    }
    if (spot) {
      await page.getByTestId('speed-1').click();
      await page.evaluate((p) => window.scraphold!.session.centerOn(p.x, p.y), spot);
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: `${SHOTS}/05-night-combat.png` });
    test.info().annotations.push({ type: 'night-combat', description: spot ? 'mutants reached the base' : 'no mutants near the base during night 1' });
  });

  expect(errors, 'console errors').toEqual([]);
});

test('an undefended base falls and the end screen shows the result', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: 'e2e-wasteland-01' });
  // Fast-forward up to six days through the debug hook (same stepping path as the frame loop).
  for (let i = 0; i < 60; i++) {
    const over = await page.evaluate(() => {
      const s = window.scraphold!;
      s.advance(220);
      return s.session.isOver;
    });
    if (over) break;
  }
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/09-end-screen.png` });
  expect(errors, 'console errors').toEqual([]);
});

test('HUD panels and menus open without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await startFromMenu(page, { seed: 'daily', origin: 'scholars', difficulty: 'hard' });

  await test.step('the intro card is modal: T and the pan keys do nothing behind it, Esc closes it', async () => {
    await expect(page.getByTestId('intro-card')).toBeVisible();
    const camera = () => page.evaluate(() => ({ x: window.scraphold!.session.camera.x, y: window.scraphold!.session.camera.y }));
    const before = await camera();
    await page.keyboard.press('KeyT');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    await expect(page.getByTestId('tech-modal')).toHaveCount(0);
    expect(await camera()).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('intro-card')).toBeHidden();
    await expect(page.getByTestId('pause-menu')).toHaveCount(0);
    expect(await page.evaluate(() => window.scraphold!.session.paused)).toBe(false);
  });

  await test.step('tech tree (T) and starting a research', async () => {
    await page.keyboard.press('KeyT');
    await expect(page.getByTestId('tech-modal')).toBeVisible();
    await page.getByTestId('tech-scavengingTools').click();
    await expect.poll(() => page.evaluate(() => window.scraphold!.session.game.state.economy.tech.current)).toBe('scavengingTools');
    await page.screenshot({ path: `${SHOTS}/06-tech-tree.png` });
    await page.keyboard.press('KeyT');
    await expect(page.getByTestId('tech-modal')).toBeHidden();
  });

  await test.step('policies (P) and slotting a card', async () => {
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('policy-modal')).toBeVisible();
    await page.getByTestId('policy-salvageDrive').click();
    await expect.poll(() => page.evaluate(() => window.scraphold!.session.game.state.economy.policies.slots[0])).toBe('salvageDrive');
    await page.screenshot({ path: `${SHOTS}/07-policies.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('policy-modal')).toBeHidden();
  });

  await test.step('box-select survivors, pause with Space, menu with Esc', async () => {
    await page.mouse.move(420, 120);
    await page.mouse.down();
    await page.mouse.move(1380, 620, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await selection(page)).length).toBeGreaterThan(1);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/08-pause-menu.png` });
  });

  expect(errors, 'console errors').toEqual([]);
});
