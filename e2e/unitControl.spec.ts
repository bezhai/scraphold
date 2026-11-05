/**
 * Third version: units are under automatic control until the player commands them. Through the
 * real mouse and keyboard: a soldier given a move carries the command flag on the map and the
 * selection panel says 由你指挥 until the order ends or X hands it back; holding (H) stays until X;
 * a survivor pulled out of a building waits for orders, G selects them, and one sent to work stays
 * there. The ?debug hook only tells the test where things are and who controls them. Screenshots of
 * the flag and of the panel line for every ownership state go to /tmp/v3shots/, along with the
 * opening guide and the help page.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, startGame } from './support';

const SHOTS = '/tmp/v3shots';
mkdirSync(SHOTS, { recursive: true });

type DebugEntity = { id: number; kind: string; type: string; x: number; y: number; sx: number; sy: number; task: string | null; insideId: number | null; control: 'auto' | 'player' | null };

async function entities(page: Page, kind?: string): Promise<DebugEntity[]> {
  return page.evaluate((k) => window.scraphold!.entities(k) as DebugEntity[], kind);
}

async function entity(page: Page, id: number): Promise<DebugEntity> {
  const found = (await entities(page)).find((e) => e.id === id);
  if (!found) throw new Error(`entity ${id} is gone`);
  return found;
}

/** Centers the camera on a world point and returns its screen position. */
async function centerOn(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate((q) => {
    window.scraphold!.session.centerOn(q.x, q.y);
    return window.scraphold!.toScreen(q.x, q.y);
  }, p);
}

async function selectByClick(page: Page, id: number): Promise<void> {
  const at = await centerOn(page, await entity(page, id));
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => [...window.scraphold!.session.selection])).toEqual([id]);
}

const controlLine = (page: Page) => page.getByTestId('control-line');

async function panelShot(page: Page, name: string): Promise<void> {
  await page.mouse.move(720, 300);
  await page.waitForTimeout(250);
  await page.getByTestId('selection-panel').screenshot({ path: `${SHOTS}/${name}.png` });
}

test('a commanded soldier carries the flag and says 由你指挥 until its order ends or X hands it back', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: 'v3-control-1', origin: 'militia' });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('paused-banner')).toBeVisible();
  const [a, b] = await entities(page, 'soldier');
  expect(b, 'militia start with two riflemen').toBeTruthy();

  await test.step('both riflemen start under automatic control', async () => {
    expect([a!.control, b!.control]).toEqual(['auto', 'auto']);
    await selectByClick(page, a!.id);
    await expect(controlLine(page)).toHaveText('自动管理');
    await panelShot(page, 'panel-auto');
  });

  await test.step('a right-click on the ground puts the rifleman under player control', async () => {
    const goal = await page.evaluate((p) => window.scraphold!.toScreen(p.x + 4, p.y + 3), await entity(page, a!.id));
    await page.mouse.click(goal.x, goal.y, { button: 'right' });
    await expect.poll(async () => (await entity(page, a!.id)).control).toBe('player');
    expect((await entity(page, b!.id)).control).toBe('auto');
    await expect(controlLine(page)).toHaveText('由你指挥，命令完成后转回自动管理');
    await panelShot(page, 'panel-player-ending-order');
  });

  await test.step('the map flags the commanded rifleman and not the other one, at the default and the smallest zoom', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-panel')).toBeHidden();
    const pa = await entity(page, a!.id);
    const pb = await entity(page, b!.id);
    const mid = await centerOn(page, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    await page.mouse.move(mid.x + 300, mid.y + 200);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/marker-default-zoom.png`, clip: { x: mid.x - 160, y: mid.y - 110, width: 320, height: 220 } });
    await page.screenshot({ path: `${SHOTS}/marker-default-zoom-full.png` });
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(mid.x, mid.y);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(40);
    }
    const zoom = await page.evaluate(() => window.scraphold!.session.camera.zoom);
    expect(zoom).toBeLessThan(15);
    const at = await page.evaluate((p) => window.scraphold!.toScreen(p.x, p.y), { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    await page.mouse.move(at.x + 300, at.y + 200);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/marker-min-zoom.png`, clip: { x: at.x - 80, y: at.y - 55, width: 160, height: 110 } });
    await page.screenshot({ path: `${SHOTS}/marker-min-zoom-full.png` });
    await page.evaluate(() => {
      const s = window.scraphold!.session;
      s.camera = { ...s.camera, zoom: 44 };
    });
  });

  await test.step('H holds until X, and X hands the rifleman back', async () => {
    await selectByClick(page, a!.id);
    await page.keyboard.press('KeyH');
    await expect(controlLine(page)).toHaveText('由你指挥，原地坚守。按 X 转回自动管理');
    await panelShot(page, 'panel-player-holding');
    await page.keyboard.press('KeyX');
    await expect(controlLine(page)).toHaveText('自动管理');
    expect((await entity(page, a!.id)).control).toBe('auto');
  });

  await test.step('a mixed selection counts both sides', async () => {
    await page.keyboard.press('KeyH');
    const pb = await entity(page, b!.id);
    await page.keyboard.down('Shift');
    await page.mouse.click(pb.sx, pb.sy);
    await page.keyboard.up('Shift');
    await expect.poll(() => page.evaluate(() => window.scraphold!.session.selection.length)).toBe(2);
    await expect(controlLine(page)).toHaveText('1 个自动管理，1 个由你指挥');
    await panelShot(page, 'panel-mixed');
  });

  await test.step('the barracks panel says where its soldiers stand by day', async () => {
    const barracks = (await entities(page, 'building')).find((e) => e.type === 'barracks')!;
    await selectByClick(page, barracks.id);
    await expect(page.getByTestId('selection-panel')).toContainText('这个兵营训练的士兵白天在集结点待命。');
    await page.getByTestId('train-rifleman').hover();
    await expect(page.getByTestId('train-rifleman').locator('.tip')).toContainText('从自动管理的幸存者里调走一人');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/panel-barracks-tip.png`, clip: { x: 300, y: 560, width: 840, height: 340 } });
    await panelShot(page, 'panel-barracks');
  });

  await test.step('a move with an end hands the rifleman back once it arrives', async () => {
    await selectByClick(page, a!.id);
    const goal = await page.evaluate((p) => window.scraphold!.toScreen(p.x + 2, p.y), await entity(page, a!.id));
    await page.mouse.click(goal.x, goal.y, { button: 'right' });
    await expect(controlLine(page)).toHaveText('由你指挥，命令完成后转回自动管理');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeHidden();
    await expect.poll(async () => (await entity(page, a!.id)).control, { timeout: 30_000 }).toBe('auto');
    await expect(controlLine(page)).toHaveText('自动管理');
  });

  expect(errors, 'console errors').toEqual([]);
});

test('a survivor pulled out of a building waits for orders, G selects them, and one sent to work stays there', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: 'v3-control-2', origin: 'scavengers' });

  await test.step('the opening guide and the help page explain the new rules', async () => {
    await expect(page.getByTestId('guide')).toBeVisible();
    await expect(page.getByTestId('guide-train')).toHaveText(/每训练一名士兵，从自动管理的幸存者里调走一人/);
    await page.getByTestId('guide').screenshot({ path: `${SHOTS}/guide.png` });
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-modal')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/help.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-modal')).toBeHidden();
  });

  const yard = (await entities(page, 'building')).find((e) => e.type === 'salvageYard')!;
  await test.step('without any order the survivors go to work in the salvage yard', async () => {
    await page.getByTestId('speed-3').click();
    await expect.poll(async () => (await entities(page, 'survivor')).filter((s) => s.insideId === yard.id).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeVisible();
    expect((await entities(page, 'survivor')).filter((s) => s.insideId === yard.id).every((s) => s.control === 'auto')).toBe(true);
  });

  let waiting = 0;
  await test.step('撤出一人 leaves a survivor beside the yard, waiting for orders; G selects them', async () => {
    const inside = new Set((await entities(page, 'survivor')).filter((s) => s.insideId === yard.id).map((s) => s.id));
    await selectByClick(page, yard.id);
    await expect(page.getByTestId('add-worker')).toContainText('派一名幸存者');
    await panelShot(page, 'panel-yard');
    await page.getByTestId('remove-worker').click();
    const out = (await entities(page, 'survivor')).filter((s) => inside.has(s.id) && s.insideId === 0);
    expect(out).toHaveLength(1);
    waiting = out[0]!.id;
    expect(out[0]).toMatchObject({ task: 'wait', control: 'player' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyG');
    await expect.poll(() => page.evaluate(() => [...window.scraphold!.session.selection])).toContain(waiting);
    await selectByClick(page, waiting);
    await expect(controlLine(page)).toHaveText('由你指挥，等待命令。按 X 转回自动管理');
    await expect(page.getByTestId('selection-panel')).toContainText('等待命令');
    await panelShot(page, 'panel-player-waiting');
  });

  await test.step('a right-click on the yard sends them back to work there for good; X hands them back', async () => {
    const at = await centerOn(page, yard);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect.poll(async () => (await entity(page, waiting)).task).toBe('work');
    expect((await entity(page, waiting)).control).toBe('player');
    await expect(controlLine(page)).toHaveText('由你指挥，固定在这里工作。按 X 转回自动管理');
    await panelShot(page, 'panel-player-assigned');
    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await entity(page, waiting)).control).toBe('auto');
    await expect(controlLine(page)).toHaveText('自动管理');
  });

  expect(errors, 'console errors').toEqual([]);
});
