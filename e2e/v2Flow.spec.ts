/**
 * Version 2 of the client through the real controls. Flows: read the fog calendar; send a rifleman
 * to the K-7 relay with a click and a right-click; meet the first daytime incident on a seed whose
 * schedule has one on day 2 (time stops, Esc returns to the player's own pause state, the event
 * log keeps it reopenable, Tab and a digit key answer it, the history records it); reload the page
 * and continue from the autosave; retreat a soldier to the core with the 撤退 button and with K.
 * Layout: the top bar is one row at 1440x900 and 1280x800, and the share of the screen the HUD
 * covers (opening guide included) is measured. Screens for review: incident targets undecided and
 * accepted, the two special ruins, the signal tower being built and broadcasting, a rust storm
 * night and a dense fog night, and the three victories and the defeat.
 *
 * Seeds are found in Node from the simulation itself (incident schedule, calendar plan, the first
 * incident of a game nobody touches), so the tests keep working when the generators change. The
 * ?debug hook tells the test where things are and fast-forwards time; a few screenshot scenes also
 * use it to finish research, add materials and speed up construction, and a victory is set up by
 * meeting its condition (hive destroyed, nights held) and letting the simulation end the game.
 * Expected texts are copied from docs/narrative.md and the coordinator's copy, not from the code.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { AUTOSAVE_STORAGE_KEY } from '../src/client/storage/autoSave';
import { createGame, restoreGame, stepGame, type Game, type NightType } from '../src/sim';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS } from '../src/sim/time';
import { collectErrors, startGame } from './support';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Origin = 'scavengers' | 'militia' | 'scholars';

/** docs/narrative.md「夜晚类型」: name on the calendar, one-line description in its hover card. */
const NIGHTS: Record<NightType, [string, string]> = {
  calm: ['平静', '雾很薄，边缘不会来怪；巢穴还是会派出自己的那队。'],
  raid: ['夜袭', '变异体会从几个方向摸过来。'],
  rustStorm: ['锈风暴', '不来怪，但锈蚀的风会腐蚀建筑，待在外面的人会受伤。'],
  denseFog: ['浓雾', '照常来怪，可雾太浓，看不清它们从哪边来。'],
  surge: ['大潮', '雾潮涨起来了，今晚的怪会比平时多得多。'],
};

/** docs/narrative.md「地图上的特殊遗迹」. */
const SPECIAL_RUINS = {
  supplyPod: { name: '坠落的补给舱', description: '旧时代的轨道补给舱，砸进沙地里，还没被人翻过。' },
  warehouse: { name: '旧时代仓库', description: '一扇厚重的金属门，门牌上印着仓库编号。' },
} as const;

/** docs/narrative.md「结局」titles and epilogues; subtitles from the coordinator's copy. */
const ENDINGS = {
  survived: {
    title: '第二十一个早晨',
    subtitle: () => '守到了第 21 天',
    epilogue: '太阳出来的时候，雾退得比以往任何一天都远。小满在墙上刻下第二十一道痕，然后把刀递给了你。锈原还是锈原，但这里已经是一个家了。',
  },
  hiveDestroyed: {
    title: '雾散了',
    subtitle: (day: number) => `第 ${day} 天摧毁了母巢`,
    epilogue: '母巢塌下去的那一刻，整片锈原的雾都晃了一下。那天下午，大家第一次在没有炉心的地方摘下了面罩。老顾说，北边应该也能看到这片天。',
  },
  signal: {
    title: '长明城的车队',
    subtitle: (day: number) => `第 ${day} 天，长明城的车队到了`,
    epilogue: "车队是在正午到的，车头漆着一盏灯。接线员本人跳下车，跟每个人握了手。'我们以为北线已经没有人了。'小满哭了，老顾假装在检查轮胎。你回头看了一眼炉心，它还亮着。",
  },
  coreDestroyed: {
    title: '炉心熄灭',
    subtitle: (day: number) => `炉心在第 ${day} 天熄灭`,
    epilogue: '炉心熄灭以后，雾在一刻钟里漫过了围墙。有人往北跑，有人留下来。很多年以后，路过的拾荒者会在这片废墟里找到一面刻满痕迹的墙。',
  },
} as const;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/** First tick of day `day`'s dusk and of its night. */
const duskStart = (day: number) => (day - 1) * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS;
const nightStart = (day: number) => (day - 1) * CYCLE_TICKS + DAY_TICKS;

// ---------------------------------------------------------------------------------------------
// Seeds, found in Node with the simulation (nobody issues commands in these games)

/** The first seed `${prefix}-1`, `-2`, … whose new game satisfies `want`. */
function findSeed(prefix: string, origin: Origin, want: (game: Game) => boolean, tries = 80): string {
  for (let i = 1; i <= tries; i++) {
    const seed = `${prefix}-${i}`;
    if (want(createGame({ seed, origin, difficulty: 'normal' }))) return seed;
  }
  throw new Error(`none of the seeds ${prefix}-1..${tries} fits`);
}

/** The incident schedule is drawn on the first tick. */
function eventDays(game: Game): readonly number[] {
  stepGame(game);
  return game.state.incidents.eventDays;
}

/** Steps with no commands until the first incident is pending (or day 3 begins, or the undefended base falls). */
function firstIncident(game: Game) {
  while (game.state.incidents.pending === null && game.state.clock.day < 3 && game.state.outcome.status === 'playing') stepGame(game);
  return game.state.incidents.pending;
}

/** An incident on day 2, so the first one comes right after the first night. */
const flowSeed = () => findSeed('v2-flow', 'militia', (g) => eventDays(g).includes(2));
/** No incident before day 4: nothing interrupts a scene that runs over days 1-3. */
const quietSeed = () => findSeed('v2-quiet', 'militia', (g) => (eventDays(g)[0] ?? 99) >= 4);

// ---------------------------------------------------------------------------------------------
// Page helpers

type DebugEntity = { id: number; kind: string; type: string; x: number; y: number; sx: number; sy: number; insideId: number | null };

async function entities(page: Page, kind?: string): Promise<DebugEntity[]> {
  return page.evaluate((k) => window.scraphold!.entities(k) as DebugEntity[], kind);
}

async function tickNow(page: Page): Promise<number> {
  return page.evaluate(() => window.scraphold!.summary().tick);
}

/** Fast-forwards to `tick` through the same stepping path as the frame loop (nothing when it has passed). */
async function advanceTo(page: Page, tick: number): Promise<void> {
  await page.evaluate((t) => window.scraphold!.advance(t - window.scraphold!.summary().tick), tick);
}

async function centerOn(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate((q) => {
    window.scraphold!.session.centerOn(q.x, q.y);
    return window.scraphold!.toScreen(q.x, q.y);
  }, p);
}

/** Centers the camera on the entity and left-clicks it, as a player selecting it. */
async function selectByClick(page: Page, id: number): Promise<void> {
  const e = (await entities(page)).find((x) => x.id === id)!;
  const at = await centerOn(page, e);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => [...window.scraphold!.session.selection])).toEqual([id]);
}

async function guideDone(page: Page, step: string): Promise<boolean> {
  return (await page.getByTestId(`guide-${step}`).getAttribute('class'))?.includes('done') ?? false;
}

/** Screenshot for review, never with the pause menu over the field. */
async function shot(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId('pause-menu')).toHaveCount(0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function relaySite(page: Page): Promise<{ tileX: number; tileY: number; size: number; x: number; y: number }> {
  return page.evaluate(() => {
    const r = window.scraphold!.session.game.state.map.relaySite!;
    return { ...r, x: r.tileX + r.size / 2, y: r.tileY + r.size / 2 };
  });
}

/** Selects the first rifleman with a click, right-clicks the middle of the relay site and plays at 3x until a unit has been there. */
async function sendRiflemanToRelay(page: Page): Promise<void> {
  const relay = await relaySite(page);
  const rifleman = (await entities(page, 'soldier'))[0]!;
  await selectByClick(page, rifleman.id);
  const at = await centerOn(page, relay);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  expect(await page.evaluate((id) => (window.scraphold!.session.game.state.entities.get(id) as { order: { type: string } }).order.type, rifleman.id)).toBe('attackMove');
  await page.getByTestId('speed-3').click();
  await expect.poll(() => page.evaluate(() => window.scraphold!.session.game.state.signal.visited), { timeout: 60_000 }).toBe(true);
}

async function readAutoSave(page: Page): Promise<Game> {
  const text = await page.evaluate((key) => localStorage.getItem(key), AUTOSAVE_STORAGE_KEY);
  expect(text, 'an autosave in localStorage').not.toBeNull();
  const game = restoreGame(text!);
  expect(game, 'the autosave restores').not.toBeNull();
  return game!;
}

async function expectEnding(page: Page, reason: keyof typeof ENDINGS, day: number): Promise<void> {
  const ending = ENDINGS[reason];
  const end = page.getByTestId('end-screen');
  await expect(end).toBeVisible();
  await expect(end.locator('.headline')).toHaveText(ending.title);
  await expect(end.locator('.reason')).toHaveText(new RegExp(`^${ending.subtitle(day)} · 种子 `));
  await expect(page.getByTestId('end-epilogue')).toHaveText(ending.epilogue);
  // A real victory is always scored by the simulation; a defeat has no score.
  await expect(end.locator('.score-total')).toHaveCount(reason === 'coreDestroyed' ? 0 : 1);
}

/** Leaves the end screen for the start screen: a finished game left no save to continue. */
async function quitToStartWithoutSave(page: Page): Promise<void> {
  await page.getByTestId('end-quit').click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(page.getByTestId('continue-game')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), AUTOSAVE_STORAGE_KEY)).toBeNull();
}

// ---------------------------------------------------------------------------------------------
// Flows

test('look at the calendar, find the relay, handle the first incident', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  const seed = flowSeed();
  const plan = createGame({ seed, origin: 'militia', difficulty: 'normal' }).calendarPlan;
  await startGame(page, { seed, origin: 'militia' });

  await test.step('the calendar shows tonight and the next 3 nights; its hover card has the narrative lines', async () => {
    for (let night = 1; night <= 4; night++) {
      const cell = page.getByTestId(`cal-night-${night}`);
      await expect(cell.locator('.cal-label')).toHaveText(night === 1 ? '今晚' : `第${night}夜`);
      await expect(cell.locator('.cal-type')).toHaveText(NIGHTS[plan[night - 1]!][0]);
    }
    await expect(page.getByTestId('cal-night-1')).toHaveClass(/is-tonight/);
    await expect(page.getByTestId('cal-night-5')).toHaveCount(0);
    await page.getByTestId('calendar-strip').hover();
    const tip = page.getByTestId('calendar-tip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('b').first()).toHaveText('雾情日历');
    const rows = tip.locator('.cal-tip-row');
    await expect(rows).toHaveCount(4);
    for (let night = 1; night <= 4; night++) {
      const [name, line] = NIGHTS[plan[night - 1]!];
      await expect(rows.nth(night - 1).locator('.night-name')).toHaveText(night === 1 ? `今晚（第 1 夜）· ${name}` : `第 ${night} 夜 · ${name}`);
      await expect(rows.nth(night - 1).locator('.night-desc')).toHaveText(line);
    }
    await expect.poll(() => guideDone(page, 'calendar')).toBe(true);
    await shot(page, 'v2-01-calendar');
  });

  await test.step('the objectives card (O) lists the three routes and keeps the calendar card closed', async () => {
    await page.mouse.move(720, 450);
    await page.keyboard.press('KeyO');
    const card = page.getByTestId('objectives-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.title')).toHaveText('胜利目标');
    await expect(page.getByTestId('objective-survive')).toContainText('撑过二十夜');
    await expect(page.getByTestId('objective-survive')).toContainText('守到第 21 天天亮。现在是第 1 天。');
    await expect(page.getByTestId('objective-hive')).toContainText('母巢藏在远处的雾里，还没找到。');
    await expect(page.getByTestId('objective-signal')).toContainText('找到 K-7 中继站，并研究"旧频段破译"。');
    await page.getByTestId('calendar-strip').hover();
    await expect(page.getByTestId('calendar-tip')).toHaveCount(0);
    await page.mouse.move(720, 450);
    await page.keyboard.press('KeyO');
    await expect(card).toBeHidden();
  });

  await test.step('a rifleman sent with a click and a right-click finds the K-7 relay', async () => {
    const relay = await relaySite(page);
    await sendRiflemanToRelay(page);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.scraphold!.session.game.state.signal.discovered)).toBe(true);
    await expect.poll(() => guideDone(page, 'relay')).toBe(true);
    const at = await centerOn(page, relay);
    await page.mouse.move(at.x + 5, at.y + 5);
    await expect(page.getByTestId('terrain-hint')).toContainText('K-7 中继站：');
    await shot(page, 'v2-02-relay-found');
    await page.getByTestId('log-toggle').click();
    await expect(page.getByTestId('event-log')).toContainText('那座铁塔！是中继站！');
    await page.getByTestId('log-toggle').click();
    await page.keyboard.press('Space');
  });

  await test.step('day 2: the incident card opens by itself and stops time; only its own keys work', async () => {
    expect(await page.evaluate(() => window.scraphold!.session.game.state.incidents.eventDays.includes(2))).toBe(true);
    await advanceTo(page, CYCLE_TICKS);
    await page.getByTestId('speed-3').click();
    const modal = page.getByTestId('incident-modal');
    await expect(modal).toBeVisible({ timeout: 30_000 });
    const pending = await page.evaluate(() => window.scraphold!.session.game.state.incidents.pending!);
    await expect(page.getByTestId('incident-title')).toHaveText(pending.title);
    await expect(modal.locator('.incident-kicker')).toHaveText('白天事件');
    await expect(page.getByTestId('close-incident')).toHaveText(/^查看地图\s*Esc$/);
    await expect(modal.locator('.incident-foot')).toHaveText('按 1–3 选择，按 Esc 先去看地图');
    for (const c of pending.choices) await expect(page.getByTestId(`choice-${c.id}`)).toContainText(c.label);
    expect(await modal.textContent()).not.toMatch(/\p{Extended_Pictographic}/u);
    const stopped = await tickNow(page);
    await page.keyboard.press('KeyT');
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    expect(await tickNow(page)).toBe(stopped);
    await expect(page.getByTestId('tech-modal')).toHaveCount(0);
    expect(await page.evaluate(() => window.scraphold!.session.paused)).toBe(false);
    await shot(page, 'v2-03-incident-card');
  });

  await test.step('Esc goes back to the map and time runs again; the event log keeps the incident on top', async () => {
    const title = await page.getByTestId('incident-title').textContent();
    const before = await tickNow(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('incident-modal')).toBeHidden();
    await expect.poll(() => tickNow(page)).toBeGreaterThan(before);
    await expect(page.getByTestId('pending-incident')).toHaveText(`待处理：${title}（点击或按 Tab 打开）`);
  });

  await test.step('paused by the player: Tab opens the card, Esc closes it and the game stays paused; a click on the log reopens it', async () => {
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('incident-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('incident-modal')).toBeHidden();
    const paused = await tickNow(page);
    await page.waitForTimeout(600);
    expect(await tickNow(page)).toBe(paused);
    await expect(page.getByTestId('paused-banner')).toBeVisible();
    await page.getByTestId('pending-incident').click();
    await expect(page.getByTestId('incident-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('incident-modal')).toBeHidden();
  });

  await test.step('at dusk the log counts down to nightfall and blinks over the last 10 s', async () => {
    const day = await page.evaluate(() => window.scraphold!.session.game.state.clock.day);
    const deadline = await page.evaluate(() => window.scraphold!.session.game.state.incidents.pending!.deadlineTick);
    const item = page.getByTestId('pending-incident');
    await advanceTo(page, duskStart(day) + 40);
    const left = Math.ceil((deadline - (await tickNow(page))) / 20);
    await expect(item).toContainText(`· 天黑还剩 ${left} 秒`);
    await expect(item).not.toHaveClass(/urgent/);
    await shot(page, 'v2-04-pending-incident-dusk');
    await advanceTo(page, deadline - 8 * 20);
    await expect(item).toContainText('· 天黑还剩 8 秒');
    await expect(item).toHaveClass(/urgent/);
  });

  await test.step('Tab and a digit answer it; the history and the event log record the choice', async () => {
    await page.keyboard.press('Tab');
    const modal = page.getByTestId('incident-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.incident-dusk')).toHaveText('天黑前不处理，会按最后一个选项结算');
    const pending = await page.evaluate(() => window.scraphold!.session.game.state.incidents.pending!);
    const index = await modal.locator('.choice-card').evaluateAll((cards) => cards.findIndex((c) => !(c as HTMLButtonElement).disabled));
    expect(index).toBeGreaterThanOrEqual(0);
    const choice = pending.choices[index]!;
    await page.keyboard.press(`Digit${index + 1}`);
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('pending-incident')).toHaveCount(0);
    const last = await page.evaluate(() => window.scraphold!.session.game.state.incidents.history.at(-1)!);
    expect(last).toMatchObject({ id: pending.id, definitionId: pending.definitionId, choiceId: choice.id, automatic: false });
    await page.getByTestId('log-toggle').click();
    await expect(page.getByTestId('event-log')).toContainText(choice.feedback ?? `${pending.title}：目标点已经标在地图上`);
    await page.getByTestId('log-toggle').click();
    await expect.poll(() => guideDone(page, 'incident')).toBe(true);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeHidden();
  });

  expect(errors, 'console errors').toEqual([]);
});

test('reload the page and continue from the autosave', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: quietSeed(), origin: 'militia' });

  await test.step('the game saves itself at the first dusk and at the next dawn', async () => {
    await advanceTo(page, duskStart(1) + 5);
    expect((await readAutoSave(page)).state.clock).toMatchObject({ day: 1, phase: 'dusk', phaseTick: 0 });
    await advanceTo(page, CYCLE_TICKS + 5);
    expect((await readAutoSave(page)).state.clock).toMatchObject({ day: 2, phase: 'day', phaseTick: 0 });
  });

  const before = await test.step('play on a little, pause, and reload: leaving the page saves that moment', async () => {
    await page.waitForTimeout(1500);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('paused-banner')).toBeVisible();
    const state = await page.evaluate(() => ({ day: window.scraphold!.summary().clock.day, tick: window.scraphold!.summary().tick, hash: window.scraphold!.hash() }));
    expect(state.tick).toBeGreaterThan(CYCLE_TICKS + 5);
    await page.reload();
    return state;
  });

  await test.step('继续游戏 picks up the same game: same day, tick and state hash', async () => {
    await expect(page.getByTestId('start-screen')).toBeVisible();
    const cont = page.getByTestId('continue-game');
    await expect(cont).toHaveText(`继续游戏（第 ${before.day} 天 · 民兵哨所）`);
    await expect(page.getByTestId('delete-save')).toHaveAttribute('title', '删除这台电脑上的自动存档');
    await shot(page, 'v2-05-continue');
    await cont.click();
    await page.waitForFunction(() => window.scraphold !== undefined);
    expect(await page.evaluate(() => window.scraphold!.loaded)).toEqual(before);
    await expect(page.getByTestId('intro-card')).toHaveCount(0);
    await expect(page.getByTestId('day')).toContainText(`第${before.day}天`);
    await expect.poll(() => tickNow(page)).toBeGreaterThan(before.tick);
  });

  expect(errors, 'console errors').toEqual([]);
});

test('retreat: a selected soldier runs back to the core with the 撤退 button and with K', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: quietSeed(), origin: 'militia' });
  const core = await page.evaluate(() => {
    const st = window.scraphold!.session.game.state;
    const c = st.entities.get(st.coreId)!;
    return { x: c.x, y: c.y };
  });
  const distance = (id: number) =>
    page.evaluate(
      ({ id, core }) => {
        const e = window.scraphold!.session.game.state.entities.get(id)!;
        return Math.hypot(e.x - core.x, e.y - core.y);
      },
      { id, core },
    );
  const riflemen = (await entities(page, 'soldier')).slice(0, 2);
  expect(riflemen).toHaveLength(2);
  await page.getByTestId('speed-3').click();
  const settled: number[] = [];
  for (const [k, r] of riflemen.entries()) {
    await selectByClick(page, r.id);
    // Send it out with Ctrl+right-click (forced move), 10 tiles west of the core.
    await centerOn(page, { x: core.x - 5, y: core.y });
    const away = await page.evaluate((p) => window.scraphold!.toScreen(p.x, p.y), { x: core.x - 10, y: core.y + (k === 0 ? -2 : 2) });
    await page.keyboard.down('Control');
    await page.mouse.click(away.x, away.y, { button: 'right' });
    await page.keyboard.up('Control');
    await expect.poll(() => distance(r.id), { timeout: 30_000 }).toBeGreaterThan(8);
    if (k === 0) {
      const button = page.getByTestId('retreat-btn');
      await expect(button).toContainText('撤退回炉心');
      await button.hover();
      await expect(button.locator('.tip')).toHaveText('选中的士兵不再交战，直接跑回炉心附近。想撤到别处，用 Ctrl+右键点位置。');
      await button.click();
    } else {
      await page.keyboard.press('KeyK');
    }
    await expect.poll(() => distance(r.id), { timeout: 30_000 }).toBeLessThan(3);
    await page.waitForTimeout(1500);
    settled.push(await distance(r.id));
  }
  console.log(`retreat: soldiers settled ${settled.map((d) => d.toFixed(2)).join(' and ')} tiles from the core center`);
  test.info().annotations.push({ type: 'retreat', description: settled.map((d) => d.toFixed(2)).join(', ') });
  for (const d of settled) expect(d).toBeLessThan(3);
  await page.keyboard.press('Space');
  await centerOn(page, core);
  await shot(page, 'v2-06-retreat');
  expect(errors, 'console errors').toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Layout

interface TopBarLayout {
  width: number;
  height: number;
  /** Everything wrong with the bar: overflow, wrapped or cut text, items outside its one row, buttons off screen. */
  problems: string[];
}

async function topBarLayout(page: Page): Promise<TopBarLayout> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.topbar')!;
    const r = bar.getBoundingClientRect();
    const problems: string[] = [];
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').trim().slice(0, 14)}"`;
    if (bar.scrollWidth > bar.clientWidth + 1) problems.push(`bar overflows: scrollWidth ${bar.scrollWidth} > clientWidth ${bar.clientWidth}`);
    const items = [...bar.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
    if (Math.max(...items.map((b) => b.top)) >= Math.min(...items.map((b) => b.bottom))) problems.push('the bar items sit on more than one row');
    for (const el of bar.querySelectorAll<HTMLElement>('*')) {
      // Hover cards and tonight's forecast hang below the bar by design.
      if (el.closest('.tip, .forecast')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const cs = getComputedStyle(el);
      if (b.top < r.top - 1 || b.bottom > r.bottom + 1) problems.push(`${name(el)} sticks out of the bar: ${b.top.toFixed(0)}–${b.bottom.toFixed(0)} vs ${r.top.toFixed(0)}–${r.bottom.toFixed(0)}`);
      if (b.left < r.left - 1 || b.right > r.right + 1) problems.push(`${name(el)} is outside the bar horizontally: ${b.left.toFixed(0)}–${b.right.toFixed(0)}`);
      if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1) problems.push(`${name(el)} is cut: content ${el.scrollWidth} px in ${el.clientWidth} px`);
    }
    // Wrapped text: a text node whose line boxes start at more than one height.
    const texts = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
    for (let n = texts.nextNode(); n; n = texts.nextNode()) {
      const el = n.parentElement!;
      if (!(n.textContent ?? '').trim() || el.closest('.tip, .forecast')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tops = [...range.getClientRects()].filter((b) => b.width > 0).map((b) => b.top);
      if (tops.length > 0 && Math.max(...tops) - Math.min(...tops) > 4) problems.push(`${name(el)} wraps: "${(n.textContent ?? '').trim()}" on ${new Set(tops.map((t) => Math.round(t))).size} lines`);
    }
    for (const button of bar.querySelectorAll('button')) {
      const b = button.getBoundingClientRect();
      if (b.left < 0 || b.right > window.innerWidth) problems.push(`${name(button)} is off screen: ${b.left.toFixed(0)}–${b.right.toFixed(0)}`);
    }
    return { width: r.width, height: r.height, problems };
  });
}

test('the top bar is one row, about 40 px high, at 1440x900 and 1280x800, by day and at dusk', async ({ page }) => {
  const errors = collectErrors(page);
  await startGame(page, { seed: quietSeed(), origin: 'militia' });
  await page.keyboard.press('Space');
  await page.mouse.move(720, 450);
  const lines: string[] = [];
  for (const moment of ['day', 'dusk'] as const) {
    if (moment === 'dusk') {
      await advanceTo(page, duskStart(1) + 60);
      await expect(page.getByTestId('forecast')).toBeVisible();
    }
    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
      const layout = await topBarLayout(page);
      lines.push(`${size.width}x${size.height} ${moment}: ${layout.width.toFixed(0)}x${layout.height.toFixed(1)} px, ${layout.problems.length} problems`);
      await page.screenshot({ path: `${SHOTS}/v2-07-topbar-${size.width}-${moment}.png`, clip: { x: 0, y: 0, width: size.width, height: 140 } });
      expect(layout.problems, `${size.width}x${size.height} ${moment}`).toEqual([]);
      expect(layout.height).toBeLessThanOrEqual(48);
    }
  }
  console.log(`top bar: ${lines.join('; ')}`);
  test.info().annotations.push({ type: 'top-bar', description: lines.join('; ') });
  // The check itself catches the old fault, calendar cells squeezed until their text wraps one character a line.
  const squeeze = await page.addStyleTag({ content: '.cal-cell { width: 11px !important; min-width: 0 !important; white-space: normal !important; }' });
  await page.waitForTimeout(200);
  expect((await topBarLayout(page)).problems.filter((p) => p.includes('wraps')).length).toBeGreaterThan(0);
  await squeeze.evaluate((el) => (el as HTMLStyleElement).remove());
  expect(errors, 'console errors').toEqual([]);
});

interface Coverage {
  ratio: number;
  /** Area share of each panel on its own (overlaps counted in each). */
  parts: Record<string, number>;
}

/** Share of the screen under HUD panels, sampled every 4 px. */
async function hudCoverage(page: Page): Promise<Coverage> {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const selectors = ['.topbar', '.eventlog .log-head', '.eventlog .pending-incident', '.eventlog .entry', '.banners > *', '.toasts > *', '.minimap-panel', '.terrain-hint', '.selection-panel', '[data-testid="guide"]', '.build-dock'];
    const rects: DOMRect[] = [];
    const parts: Record<string, number> = {};
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        rects.push(b);
        parts[sel] = (parts[sel] ?? 0) + (b.width * b.height) / (W * H);
      }
    }
    let covered = 0;
    let total = 0;
    for (let y = 2; y < H; y += 4)
      for (let x = 2; x < W; x += 4) {
        total++;
        if (rects.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom)) covered++;
      }
    for (const k of Object.keys(parts)) parts[k] = Math.round((parts[k] as number) * 1000) / 10;
    return { ratio: covered / total, parts };
  });
}

test('the HUD covers a measured share of the screen at 1440x900, opening guide included', async ({ page }) => {
  const errors = collectErrors(page);
  // The first moments of a game, running at 1x as a player sees them (no pause banner).
  await startGame(page, { seed: quietSeed(), origin: 'militia' });
  await page.mouse.move(720, 450);
  await expect(page.getByTestId('guide')).toBeVisible();
  await expect(page.getByTestId('guide')).not.toHaveClass(/collapsed/);
  const idle = await hudCoverage(page);
  const core = await page.evaluate(() => window.scraphold!.session.game.state.coreId);
  await selectByClick(page, core);
  await expect(page.getByTestId('selection-panel')).toBeVisible();
  await page.mouse.move(720, 300);
  const selected = await hudCoverage(page);
  const pct = (c: Coverage) => `${(c.ratio * 100).toFixed(1)}% ${JSON.stringify(c.parts)}`;
  console.log(`HUD coverage, nothing selected: ${pct(idle)}`);
  console.log(`HUD coverage, core selected: ${pct(selected)}`);
  test.info().annotations.push({ type: 'hud-coverage', description: `idle ${(idle.ratio * 100).toFixed(1)}%, core selected ${(selected.ratio * 100).toFixed(1)}%` });
  await shot(page, 'v2-08-hud-coverage');
  // Measured 21.5% and 26.0% (the opening guide alone is 9% of the screen); the bounds leave about 2 points above that.
  expect(idle.ratio).toBeLessThanOrEqual(0.235);
  expect(selected.ratio).toBeLessThanOrEqual(0.28);
  expect(errors, 'console errors').toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Screens for review

test('screens: an incident target, undecided on the card and accepted on the map', async ({ page }) => {
  const errors = collectErrors(page);
  const seed = findSeed('v2-flow', 'militia', (g) => eventDays(g).includes(2) && firstIncident(g)?.target != null && g.state.clock.day === 2);
  await startGame(page, { seed, origin: 'militia' });
  await advanceTo(page, CYCLE_TICKS);
  await page.getByTestId('speed-3').click();
  const modal = page.getByTestId('incident-modal');
  await expect(modal).toBeVisible({ timeout: 30_000 });
  const pending = await page.evaluate(() => {
    const st = window.scraphold!.session.game.state;
    const p = st.incidents.pending!;
    const tile = p.target!.tile;
    return { title: p.title, at: { x: (tile % st.map.width) + 0.5, y: Math.floor(tile / st.map.width) + 0.5 }, targetChoice: p.choices.findIndex((c) => c.effects.some((e) => e.kind === 'target')) };
  });
  expect(pending.targetChoice).toBeGreaterThanOrEqual(0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('pending-incident')).toBeVisible();
  await centerOn(page, pending.at);
  await shot(page, 'v2-09-target-undecided');

  await page.keyboard.press('Tab');
  await expect(modal).toBeVisible();
  await page.keyboard.press(`Digit${pending.targetChoice + 1}`);
  await expect(modal).toBeHidden();
  const active = await page.evaluate(() => window.scraphold!.session.game.state.incidents.targets.filter((t) => t.status === 'active').length);
  expect(active).toBe(1);
  await expect(page.getByTestId('event-log')).toContainText(new RegExp(`${pending.title}：目标点已经标在地图上，\\d+ 天内到达`));
  await centerOn(page, pending.at);
  await shot(page, 'v2-10-target-active');
  // From the core the target is off screen: an arrow on the edge points at it.
  await page.evaluate(() => {
    const st = window.scraphold!.session.game.state;
    const c = st.entities.get(st.coreId)!;
    window.scraphold!.session.centerOn(c.x, c.y);
  });
  await shot(page, 'v2-10b-target-offscreen');
  expect(errors, 'console errors').toEqual([]);
});

test('screens: the two special ruins look their own and name themselves on hover', async ({ page }) => {
  const errors = collectErrors(page);
  // Scholars start with every ruin revealed (the tile itself; the land around stays in the fog).
  await startGame(page, { seed: 'v2-ruins-1', origin: 'scholars' });
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const s = window.scraphold!.session;
    s.camera = { ...s.camera, zoom: 60 };
  });
  const ruinAt = (kind: string) =>
    page.evaluate((k) => {
      const st = window.scraphold!.session.game.state;
      const core = st.map.coreTile;
      const r = st.map.ruins.filter((x) => x.kind === k).sort((a, b) => Math.hypot((a.tile % st.map.width) - core.x, Math.floor(a.tile / st.map.width) - core.y) - Math.hypot((b.tile % st.map.width) - core.x, Math.floor(b.tile / st.map.width) - core.y))[0]!;
      return { x: (r.tile % st.map.width) + 0.5, y: Math.floor(r.tile / st.map.width) + 0.5 };
    }, kind);
  for (const kind of ['supplyPod', 'warehouse'] as const) {
    const at = await centerOn(page, await ruinAt(kind));
    await page.mouse.move(at.x, at.y);
    await expect(page.getByTestId('terrain-hint')).toHaveText(`${SPECIAL_RUINS[kind].name}：${SPECIAL_RUINS[kind].description}`);
    await shot(page, `v2-11-ruin-${kind}-revealed`);
  }
  // In plain sight (fog lifted for the picture), next to an ordinary ruin for comparison.
  await page.evaluate(() => window.scraphold!.session.game.state.fog.fill(2));
  await page.waitForTimeout(1200);
  for (const kind of ['supplyPod', 'warehouse', 'ordinary'] as const) {
    const at = await centerOn(page, await ruinAt(kind));
    await page.mouse.move(at.x, at.y);
    if (kind !== 'ordinary') await expect(page.getByTestId('terrain-hint')).toHaveText(`${SPECIAL_RUINS[kind].name}：${SPECIAL_RUINS[kind].description}`);
    else await expect(page.getByTestId('terrain-hint')).toContainText('遗迹：');
    await shot(page, `v2-11-ruin-${kind}`);
  }
  expect(errors, 'console errors').toEqual([]);
});

test('screens: the signal tower being built and broadcasting, then the signal victory', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startGame(page, { seed: quietSeed(), origin: 'militia' });
  const relay = await relaySite(page);

  await test.step('a rifleman finds the relay and steps off the site', async () => {
    await sendRiflemanToRelay(page);
    await page.keyboard.press('Space');
    await centerOn(page, relay);
    const aside = await page.evaluate((p) => window.scraphold!.toScreen(p.x, p.y), { x: relay.x, y: relay.y + relay.size / 2 + 2 });
    await page.mouse.click(aside.x, aside.y, { button: 'right' });
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scraphold!.advance(10));
        return page.evaluate((r) => {
          for (const e of window.scraphold!.session.game.state.entities.values()) {
            if (e.kind !== 'soldier' && e.kind !== 'survivor') continue;
            if (e.x > r.tileX - 1 && e.x < r.tileX + r.size + 1 && e.y > r.tileY - 1 && e.y < r.tileY + r.size + 1) return true;
          }
          return false;
        }, relay);
      })
      .toBe(false);
  });

  const towerId = await test.step('旧频段破译 researched and the materials there (debug): the tower goes up on the relay from the build dock', async () => {
    await page.evaluate(() => {
      const hook = window.scraphold!;
      hook.finishResearch('oldFrequency');
      const r = hook.session.game.state.economy.resources;
      r.scrap += 400;
      r.fuel += 80;
      hook.advance(2);
    });
    expect(await page.evaluate(() => window.scraphold!.session.game.state.signal.stage)).toBe('repair');
    await page.getByTestId('build-signalTower').click();
    const at = await centerOn(page, relay);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    const tower = (await entities(page, 'building')).find((b) => b.type === 'signalTower');
    expect(tower, 'a signal tower site on the relay').toBeTruthy();
    return tower!.id;
  });

  await test.step('idle survivors (G) right-click the site and build it; the card and panel show the progress', async () => {
    await page.keyboard.press('KeyG');
    const at = await centerOn(page, relay);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const crew = await page.evaluate((id) => [...window.scraphold!.session.game.state.entities.values()].filter((e) => e.kind === 'survivor' && e.task.type === 'work' && e.task.buildingId === id).length, towerId);
    expect(crew, 'survivors assigned to build the tower').toBe(3);
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.scraphold!.advance(20));
          return (await entities(page, 'survivor')).filter((s) => s.insideId === towerId).length;
        },
        { timeout: 60_000 },
      )
      .toBe(3);
    // Construction fast-forwarded to 45% (debug); the crew carries on from there.
    await page.evaluate((id) => {
      const b = window.scraphold!.session.game.state.entities.get(id) as { construction: { progress: number; total: number }; hp: number; maxHp: number };
      b.construction.progress = b.construction.total * 0.45;
      b.hp = Math.round(b.maxHp * 0.5);
    }, towerId);
    await selectByClick(page, towerId);
    await expect(page.getByTestId('signal-stage')).toHaveText('修建中');
    await page.keyboard.press('KeyO');
    await expect(page.getByTestId('objective-signal')).toContainText('修建进度 45%，在岗工人 3/3。');
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    await page.keyboard.press('Space');
    await shot(page, 'v2-12-signal-tower-building');
    await page.keyboard.press('KeyO');
  });

  await test.step('finished, it can broadcast; 开始广播 starts the broadcast', async () => {
    await page.evaluate((id) => {
      const b = window.scraphold!.session.game.state.entities.get(id) as { construction: { progress: number; total: number } };
      b.construction.progress = b.construction.total - 1;
      window.scraphold!.advance(3);
    }, towerId);
    expect(await page.evaluate(() => window.scraphold!.session.game.state.signal.stage)).toBe('ready');
    await expect(page.getByTestId('signal-stage')).toHaveText('可以广播');
    await page.getByTestId('start-broadcast').click();
    await expect(page.getByTestId('signal-stage')).toHaveText('广播中 · 已守住 0/3 晚');
    expect(await page.evaluate(() => window.scraphold!.session.game.state.signal.stage)).toBe('broadcast');
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Space');
    await shot(page, 'v2-13-signal-tower-broadcast');
  });

  await test.step('once the nights are held the simulation ends the game with the signal victory', async () => {
    const day = await page.evaluate(() => {
      const hook = window.scraphold!;
      const s = hook.session.game.state.signal;
      s.nightsHeld = s.nightsRequired;
      hook.advance(1);
      return hook.session.game.state.clock.day;
    });
    expect(await page.evaluate(() => window.scraphold!.session.game.state.outcome.reason)).toBe('signal');
    await expectEnding(page, 'signal', day);
    await shot(page, 'v2-16-end-signal');
    await quitToStartWithoutSave(page);
  });
  expect(errors, 'console errors').toEqual([]);
});

test('screens: a rust storm night and a dense fog night', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  const seed = findSeed('v2-weather', 'militia', (g) => {
    const storm = g.calendarPlan.indexOf('rustStorm') + 1;
    const fog = g.calendarPlan.indexOf('denseFog') + 1;
    return storm >= 2 && storm <= 4 && fog >= 2 && fog <= 4;
  });
  const plan = createGame({ seed, origin: 'militia', difficulty: 'normal' }).calendarPlan;
  await startGame(page, { seed, origin: 'militia' });
  // The economy bot keeps the base alive through the nights before (it answers incident cards itself).
  await page.evaluate(() => window.scraphold!.autopilot('economy'));
  const nights = (['rustStorm', 'denseFog'] as const).map((type) => ({ type, night: plan.indexOf(type) + 1 })).sort((a, b) => a.night - b.night);
  for (const { type, night } of nights) {
    await advanceTo(page, nightStart(night) + 300);
    await page.keyboard.press('Space');
    // Fast-forwarding drops every corpse of the skipped time at once; clear them for the picture.
    await page.evaluate(() => {
      window.scraphold!.session.effects = [];
    });
    const now = await page.evaluate(() => {
      const st = window.scraphold!.session.game.state;
      return { day: st.clock.day, phase: st.clock.phase, tonight: st.calendar.nights[st.clock.day - 1]!.type, outcome: st.outcome.status };
    });
    expect(now).toEqual({ day: night, phase: 'night', tonight: type, outcome: 'playing' });
    await expect(page.getByTestId(`cal-night-${night}`)).toHaveClass(/is-tonight/);
    await expect(page.getByTestId(`cal-night-${night}`).locator('.cal-type')).toHaveText(NIGHTS[type][0]);
    await page.evaluate(() => {
      const st = window.scraphold!.session.game.state;
      const c = st.entities.get(st.coreId)!;
      window.scraphold!.session.centerOn(c.x, c.y);
    });
    await shot(page, `v2-14-night-${type}`);
    await page.keyboard.press('Space');
  }
  expect(errors, 'console errors').toEqual([]);
});

test('screens: the survived and hive victories and the defeat; a finished game leaves no save', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);

  await test.step('survived: the economy bot holds out to the 21st dawn (the same game as fullGame.spec.ts)', async () => {
    await startGame(page, { seed: 'full-game-01', origin: 'militia' });
    await page.keyboard.press('Space');
    await page.evaluate(() => window.scraphold!.autopilot('economy'));
    for (let i = 0; i < 30 && !(await page.evaluate(() => window.scraphold!.session.isOver)); i++) await page.evaluate((n) => window.scraphold!.advance(n), CYCLE_TICKS);
    expect(await page.evaluate(() => window.scraphold!.session.game.state.outcome.reason)).toBe('survived');
    await expectEnding(page, 'survived', 21);
    await shot(page, 'v2-15-end-survived');
    await quitToStartWithoutSave(page);
  });

  await test.step('hive: once the hive is down the simulation ends and scores the game', async () => {
    await startGame(page, { seed: 'v2-hive-1', origin: 'militia' });
    const day = await page.evaluate(() => {
      const hook = window.scraphold!;
      hook.session.game.state.stats.hiveDestroyed = true;
      hook.advance(1);
      return hook.session.game.state.clock.day;
    });
    expect(await page.evaluate(() => window.scraphold!.session.game.state.outcome.reason)).toBe('hiveDestroyed');
    await expectEnding(page, 'hiveDestroyed', day);
    await shot(page, 'v2-17-end-hive');
    await quitToStartWithoutSave(page);
  });

  await test.step('defeat: an undefended base falls; its autosave is gone afterwards', async () => {
    await startGame(page, { seed: 'e2e-wasteland-01', origin: 'scavengers' });
    await advanceTo(page, CYCLE_TICKS + 5);
    await readAutoSave(page);
    for (let i = 0; i < 60 && !(await page.evaluate(() => window.scraphold!.session.isOver)); i++) await page.evaluate(() => window.scraphold!.advance(220));
    const day = await page.evaluate(() => window.scraphold!.session.game.state.clock.day);
    await expectEnding(page, 'coreDestroyed', day);
    await shot(page, 'v2-18-end-defeat');
    await quitToStartWithoutSave(page);
  });
  expect(errors, 'console errors').toEqual([]);
});
