/**
 * Shared steps for the end-to-end suites (e2e/ and e2e-art/): starting a game from the start
 * screen through the real controls, closing the day-1 intro card (it stops time), collecting
 * console errors, and answering an incident card like a player would. Not a spec file.
 */
import { expect, type Page } from '@playwright/test';

export interface StartOptions {
  /** Custom seed typed into the start screen; 'daily' picks the daily seed instead. */
  seed: string;
  origin?: 'scavengers' | 'militia' | 'scholars';
  difficulty?: 'normal' | 'hard';
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Picks seed, origin and difficulty on the start screen and starts; the debug hook is installed once the game screen is up. */
export async function startFromMenu(page: Page, opts: StartOptions): Promise<void> {
  await page.goto('/?debug');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  if (opts.seed === 'daily') await page.getByTestId('seed-daily').click();
  else {
    await page.getByTestId('seed-custom').click();
    await page.locator('.seed-row input').fill(opts.seed);
  }
  if (opts.origin) await page.getByTestId(`origin-${opts.origin}`).click();
  if (opts.difficulty) await page.getByTestId(`difficulty-${opts.difficulty}`).click();
  await page.getByTestId('start').click();
  await page.waitForFunction(() => window.scraphold !== undefined);
}

/** A new game opens with the day-1 intro card, which stops time until it is closed. */
export async function closeIntroCard(page: Page): Promise<void> {
  await expect(page.getByTestId('intro-card')).toBeVisible();
  await page.getByTestId('intro-enter').click();
  await expect(page.getByTestId('intro-card')).toBeHidden();
}

/** Starts a new game and closes the intro card: the usual opening of a test. */
export async function startGame(page: Page, opts: StartOptions): Promise<void> {
  await startFromMenu(page, opts);
  await closeIntroCard(page);
}

/**
 * If an incident card is open, answers it the way a player does: clicks the first choice the
 * card offers as available. Returns the incident title, or null when no card was open.
 */
export async function answerIncidentCard(page: Page): Promise<string | null> {
  const open = await page.evaluate(() => window.scraphold!.session.incidentModalOpen);
  if (!open) return null;
  const modal = page.getByTestId('incident-modal');
  await expect(modal).toBeVisible();
  const title = (await page.getByTestId('incident-title').textContent()) ?? '';
  await modal.locator('.choice-card:not([disabled])').first().click();
  await expect(modal).toBeHidden();
  return title;
}

export interface Clock {
  day: number;
  phase: string;
  outcome: string;
}

/**
 * Lets the game run in real time until `done(clock)` (or the game ends), answering any incident
 * card that opens on the way. Returns the clock it stopped at.
 */
export async function playUntil(page: Page, done: (c: Clock) => boolean, timeout = 120_000): Promise<Clock & { incidents: string[] }> {
  const deadline = Date.now() + timeout;
  const incidents: string[] = [];
  for (;;) {
    const answered = await answerIncidentCard(page);
    if (answered) incidents.push(answered);
    const s = await page.evaluate(() => window.scraphold!.summary());
    const c = { ...s.clock, outcome: s.outcome };
    if (done(c) || c.outcome !== 'playing') return { ...c, incidents };
    if (Date.now() > deadline) throw new Error(`timed out on day ${c.day} ${c.phase}`);
    await page.waitForTimeout(250);
  }
}
