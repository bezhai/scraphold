/**
 * Fullscreen and the farthest zoom through the real controls: the top bar button puts the page in
 * fullscreen and its label follows, the pause menu button leaves fullscreen again; the mouse wheel
 * zooms out until the whole 96x72 map is in view, clear of the top bar.
 * Screenshots go to e2e/screenshots/.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FIT_MARGIN_PX, minZoom } from '../src/client/camera';
import { MAP_GEN } from '../src/sim/data/map';
import { collectErrors, startGame } from './support';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

test('the top bar button enters fullscreen, the pause menu button leaves it', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: 'e2e-camera-01' });
  const fullscreenOn = () => page.evaluate(() => document.fullscreenElement === document.documentElement);

  // In the top bar a glyph, labelled by its tooltip; in the pause menu the words.
  const inBar = page.locator('.topbar').getByTestId('fullscreen');
  await expect(inBar).toHaveAttribute('title', '全屏');
  await inBar.click();
  await expect.poll(fullscreenOn).toBe(true);
  await expect(inBar).toHaveAttribute('title', '退出全屏');

  await page.getByTestId('menu').click();
  const inMenu = page.getByTestId('pause-menu').getByTestId('fullscreen');
  await expect(inMenu).toHaveText('退出全屏');
  await inMenu.click();
  await expect.poll(fullscreenOn).toBe(false);
  await expect(inMenu).toHaveText('全屏');
  await expect(inBar).toHaveAttribute('title', '全屏');
  expect(errors, 'console errors').toEqual([]);
});

test('the mouse wheel zooms out until the whole map is in view', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: 'e2e-camera-01' });
  const viewport = page.viewportSize()!;
  const lowest = minZoom({ viewW: viewport.width, viewH: viewport.height }, MAP_GEN);

  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scraphold!.session.camera.zoom)).toBeCloseTo(lowest);

  const onScreen = await page.evaluate(
    ({ width, height }) => {
      const hook = window.scraphold!;
      return { topLeft: hook.toScreen(0, 0), bottomRight: hook.toScreen(width, height), topBarBottom: document.querySelector('.topbar')!.getBoundingClientRect().bottom };
    },
    { width: MAP_GEN.width, height: MAP_GEN.height },
  );
  expect(onScreen.topLeft.x).toBeGreaterThanOrEqual(FIT_MARGIN_PX - 0.5);
  expect(onScreen.topLeft.y).toBeGreaterThanOrEqual(FIT_MARGIN_PX - 0.5);
  expect(onScreen.bottomRight.x).toBeLessThanOrEqual(viewport.width - FIT_MARGIN_PX + 0.5);
  expect(onScreen.bottomRight.y).toBeLessThanOrEqual(viewport.height - FIT_MARGIN_PX + 0.5);
  expect(onScreen.topBarBottom).toBeLessThan(onScreen.topLeft.y);
  await page.screenshot({ path: `${SHOTS}/camera-min-zoom-${viewport.width}x${viewport.height}.png` });
  expect(errors, 'console errors').toEqual([]);
});
