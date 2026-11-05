import { describe, expect, it } from 'vitest';
import { clockAt, INCIDENT_TARGETS, RADIO_BROADCASTS } from '../../sim';
import { HIVE_SHIELD } from '../../sim/data/combat';
import { tileCenter } from '../../sim/map/grid';
import { CYCLE_TICKS } from '../../sim/time';
import { buildTestWorld } from '../testWorld';
import { FEED_FADE_TICKS, FEED_HOLD_TICKS, FEED_LINES, HISTORY_LINES, alertFromEvent, broadcastEntry, logFeed, logLineForEvent, withBroadcast } from './eventLog';

const pct = (share: number) => `${Math.round(share * 100)}%`;

describe('logLineForEvent', () => {
  it('announces phases', () => {
    const { game } = buildTestWorld();
    expect(logLineForEvent(game.state, { type: 'phaseChanged', day: 3, phase: 'night' })).toMatchObject({ text: '第 3 夜开始', tone: 'danger' });
    expect(logLineForEvent(game.state, { type: 'phaseChanged', day: 3, phase: 'dusk' })).toMatchObject({ tone: 'warn' });
    expect(logLineForEvent(game.state, { type: 'phaseChanged', day: 4, phase: 'day' })).toMatchObject({ text: '第 4 天 · 天亮了', tone: 'info' });
    expect(logLineForEvent(game.state, { type: 'phaseChanged', day: 1, phase: 'day' })).toMatchObject({ text: '第 1 天', tone: 'info' });
  });

  it('reports construction and training at the building position', () => {
    const w = buildTestWorld();
    expect(logLineForEvent(w.game.state, { type: 'buildingCompleted', buildingId: w.greenhouse.id, building: 'greenhouse' })).toEqual({
      text: '温室 建造完成',
      tone: 'good',
      at: { x: 9, y: 3 },
    });
    expect(logLineForEvent(w.game.state, { type: 'unitTrained', unitId: w.rifle1.id, unit: 'rifleman', buildingId: w.barracks.id })).toMatchObject({
      text: '步枪手 训练完成',
      tone: 'good',
    });
  });

  it('reports own losses but not every dead mutant', () => {
    const { game } = buildTestWorld();
    expect(
      logLineForEvent(game.state, { type: 'died', entityId: 99, kind: 'soldier', subtype: 'sniper', faction: 'player', x: 1, y: 2 }),
    ).toEqual({ text: '狙击手 阵亡', tone: 'danger', at: { x: 1, y: 2 } });
    expect(
      logLineForEvent(game.state, { type: 'died', entityId: 98, kind: 'building', subtype: 'shack', faction: 'player', x: 1, y: 2 }),
    ).toMatchObject({ text: '棚屋 被摧毁' });
    expect(logLineForEvent(game.state, { type: 'died', entityId: 97, kind: 'mutant', subtype: 'runner', faction: 'mutant', x: 1, y: 2 })).toBeNull();
  });

  it('describes rewards, research, hunger, nests and the end', () => {
    const { game } = buildTestWorld();
    expect(logLineForEvent(game.state, { type: 'ruinExplored', feedback: null, ruinId: 1, tile: 0, reward: { kind: 'resource', resource: 'fuel', amount: 25 } })).toMatchObject({
      text: '探索遗迹：获得 燃料 25',
      tone: 'good',
    });
    expect(logLineForEvent(game.state, { type: 'ruinExplored', feedback: null, ruinId: 1, tile: 0, reward: { kind: 'unit', unit: 'scout' } })?.text).toBe(
      '探索遗迹：一名摩托斥候加入',
    );
    expect(logLineForEvent(game.state, { type: 'researchCompleted', tech: 'armory' })?.text).toBe('研究完成：军械制造');
    expect(logLineForEvent(game.state, { type: 'inspiration', tech: 'refinery' })?.text).toBe('灵感：炼油工艺 研究进度 +50%');
    expect(logLineForEvent(game.state, { type: 'hunger', hungry: true })).toMatchObject({ tone: 'danger' });
    expect(logLineForEvent(game.state, { type: 'hunger', hungry: false })).toMatchObject({ tone: 'good' });
    expect(logLineForEvent(game.state, { type: 'nestDestroyed', nestId: 5, isHive: false, nestsLeft: 2, reward: { fuel: 30, research: 30 }, survivors: 1 })).toMatchObject({
      text: `摧毁了一个巢穴，还剩 2 个，母巢减伤 ${pct(2 * HIVE_SHIELD.reductionPerNest)}。获得 燃料 30、科研 30，1 名幸存者加入。`,
      tone: 'good',
    });
    expect(logLineForEvent(game.state, { type: 'gameOver', status: 'lost', reason: 'coreDestroyed' })).toMatchObject({ tone: 'danger' });
  });

  it('tells the hive shield when the hive is found and as each ordinary nest falls', () => {
    const { game } = buildTestWorld();
    expect(logLineForEvent(game.state, { type: 'nestDiscovered', nestId: 5, isHive: true })?.text).toBe(
      `发现了母巢。地图上每剩一个巢穴，母巢受到的伤害降低 ${pct(HIVE_SHIELD.reductionPerNest)}。`,
    );
    expect(logLineForEvent(game.state, { type: 'nestDiscovered', nestId: 5, isHive: false })?.text).toBe('发现了一个怪物巢穴');
    const destroyed = { type: 'nestDestroyed' as const, nestId: 5, isHive: false, reward: {}, survivors: 0 };
    // The count rides on the event: two nests falling between two frames still read 3 and 2.
    expect(logLineForEvent(game.state, { ...destroyed, nestsLeft: 3 })?.text).toBe(`摧毁了一个巢穴，还剩 3 个，母巢减伤 ${pct(3 * HIVE_SHIELD.reductionPerNest)}。`);
    // Above the cap the reduction stays put; the line states the count and the reduction, not a drop.
    expect(logLineForEvent(game.state, { ...destroyed, nestsLeft: 12 })?.text).toBe(`摧毁了一个巢穴，还剩 12 个，母巢减伤 ${pct(HIVE_SHIELD.maxReduction)}。`);
    expect(logLineForEvent(game.state, { ...destroyed, nestsLeft: 0 })?.text).toBe('巢穴已全部摧毁，母巢不再减伤。');
    expect(logLineForEvent(game.state, { ...destroyed, nestsLeft: 0, reward: { fuel: 40, research: 40 }, survivors: 2 })?.text).toBe(
      '巢穴已全部摧毁，母巢不再减伤。获得 燃料 40、科研 40，2 名幸存者加入。',
    );
    expect(logLineForEvent(game.state, { ...destroyed, isHive: true, nestsLeft: 0 })?.text).toBe('母巢被摧毁！');
  });

  it('shows special ruin feedback verbatim and formats resource bundles', () => {
    const { game } = buildTestWorld();
    const event = { type: 'ruinExplored' as const, ruinId: 1, tile: 0,
      reward: { kind: 'resources' as const, amounts: { scrap: 80, fuel: 20 } }, feedback: null };
    expect(logLineForEvent(game.state, event)?.text).toBe('探索遗迹：获得 废料 80、燃料 20');
    expect(logLineForEvent(game.state, { ...event, feedback: '打开了仓库，得到 1 名狙击手。' })?.text).toBe('打开了仓库，得到 1 名狙击手。');
  });

  it('turns underAttack into an alert line', () => {
    const { game } = buildTestWorld();
    expect(logLineForEvent(game.state, { type: 'underAttack', entityId: 1, x: 8.5, y: 5.5, core: true })).toEqual({
      text: '炉心遭到攻击！',
      tone: 'danger',
      at: { x: 8.5, y: 5.5 },
    });
  });
});

describe('alertFromEvent', () => {
  it('only underAttack events become jump targets', () => {
    expect(alertFromEvent({ type: 'underAttack', entityId: 3, x: 1, y: 2, core: false }, 40)).toEqual({ x: 1, y: 2, tick: 40, core: false });
    expect(alertFromEvent({ type: 'hunger', hungry: true }, 40)).toBeNull();
  });
});

describe('logFeed', () => {
  const entries = (ticks: number[]) => ticks.map((tick, id) => ({ id, tick }));

  it('collapsed: shows only fresh lines, fully visible while new, then fading out, then gone', () => {
    const now = 1000;
    const feed = logFeed(entries([now - FEED_HOLD_TICKS - FEED_FADE_TICKS, now - FEED_HOLD_TICKS - FEED_FADE_TICKS / 2, now - FEED_HOLD_TICKS, now]), now, false);
    expect(feed.map((f) => f.entry.id)).toEqual([1, 2, 3]);
    expect(feed.map((f) => f.opacity)).toEqual([0.5, 1, 1]);
  });

  it('collapsed: keeps at most FEED_LINES lines, the newest last', () => {
    const now = 500;
    const feed = logFeed(entries(Array.from({ length: FEED_LINES + 3 }, () => now)), now, false);
    expect(feed).toHaveLength(FEED_LINES);
    expect(feed.at(-1)?.entry.id).toBe(FEED_LINES + 2);
  });

  it('expanded: shows the last HISTORY_LINES lines at full opacity, however old', () => {
    const feed = logFeed(entries(Array.from({ length: HISTORY_LINES + 5 }, (_, i) => i)), 100_000, true);
    expect(feed).toHaveLength(HISTORY_LINES);
    expect(feed[0]?.entry.id).toBe(5);
    expect(feed.every((f) => f.opacity === 1)).toBe(true);
  });

  it('nothing fades while time stands still (paused game)', () => {
    const feed = logFeed(entries([200]), 200, false);
    expect(feed).toEqual([{ entry: { id: 0, tick: 200 }, opacity: 1 }]);
  });
});


it('shows signal dialogue verbatim and distinguishes all victory log messages', () => {
  const { game } = buildTestWorld();
  expect(logLineForEvent(game.state, { type: 'signalMessage', text: '测试台词' })).toMatchObject({ text: '测试台词', tone: 'info' });
  const texts = (['survived', 'hiveDestroyed', 'signal'] as const).map(reason => logLineForEvent(game.state, { type: 'gameOver', status: 'won', reason })!.text);
  expect(new Set(texts).size).toBe(3);
  expect(texts[0]).toContain('20');
  expect(texts[2]).toContain('救援');
  expect(texts[1]).toBe('母巢被摧毁，获得胜利！');
});

describe('incident lines', () => {
  it('accepting a target option logs where it is and how many days are left; other feedback is shown verbatim', () => {
    const { game } = buildTestWorld();
    const tile = 3 * game.state.map.width + 20;
    game.state.incidents.targets.push({
      kind: 'rescue', tile, nestId: 0, splitTile: -1, id: 9, incidentId: 8, title: INCIDENT_TARGETS.rescue.title,
      createdTick: 300, expiresTick: 300 + INCIDENT_TARGETS.rescue.days * CYCLE_TICKS, status: 'active', guardIds: [],
    });
    expect(logLineForEvent(game.state, { type: 'incidentResolved', incidentId: 8, choiceId: 'rescue', automatic: false, feedback: null })).toEqual({
      text: `${INCIDENT_TARGETS.rescue.title}：目标点已经标在地图上，${INCIDENT_TARGETS.rescue.days} 天内到达`,
      tone: 'warn',
      at: tileCenter(game.state.map, tile),
    });
    expect(logLineForEvent(game.state, { type: 'incidentResolved', incidentId: 5, choiceId: 'fuel', automatic: false, feedback: '商队走了。' })).toEqual({ text: '商队走了。', tone: 'info' });
    expect(logLineForEvent(game.state, { type: 'incidentResolved', incidentId: 5, choiceId: 'x', automatic: true, feedback: null })).toBeNull();
  });

  it('the scouting line only appears when there are known directions to look at', () => {
    const { game } = buildTestWorld();
    game.state.night.forecast = { night: 1, directionsKnown: false, precise: false, groups: [] };
    expect(logLineForEvent(game.state, { type: 'forecastReady', night: 1 })).toBeNull();
    game.state.night.forecast = { night: 1, directionsKnown: true, precise: false, groups: [] };
    expect(logLineForEvent(game.state, { type: 'forecastReady', night: 1 })).toBeNull();
    game.state.night.forecast = { night: 1, directionsKnown: true, precise: false, groups: [{ direction: 'N', size: 'small', counts: null, boss: null }] };
    expect(logLineForEvent(game.state, { type: 'forecastReady', night: 1 })).toMatchObject({ tone: 'warn' });
  });
});

describe('dusk radio broadcast', () => {
  it('is a log entry from the state, dated at the first tick of that dusk', () => {
    const { game } = buildTestWorld();
    expect(broadcastEntry(game.state)).toBeNull();
    const text = RADIO_BROADCASTS.raid[0]!;
    game.state.night.broadcast = { night: 3, type: 'raid', text };
    const entry = broadcastEntry(game.state);
    expect(entry).toMatchObject({ text, tone: 'info' });
    expect(clockAt(entry!.tick)).toMatchObject({ day: 3, phase: 'dusk', phaseTick: 0 });
  });

  it('goes right after the dusk line, also when a frame that ran several ticks stamped that line a little later', () => {
    const { game } = buildTestWorld();
    const text = RADIO_BROADCASTS.calm[0]!;
    game.state.night.broadcast = { night: 1, type: 'calm', text };
    const at = broadcastEntry(game.state)!.tick;
    const log = (duskStamp: number) => [
      { id: 1, tick: at - 5, text: 'a', tone: 'info' as const },
      { id: 2, tick: duskStamp, text: '黄昏', tone: 'warn' as const },
      { id: 3, tick: duskStamp, text: '侦察报告', tone: 'warn' as const },
      { id: 4, tick: at + 40, text: 'b', tone: 'info' as const },
    ];
    expect(withBroadcast(log(at), game.state).map((e) => e.text)).toEqual(['a', '黄昏', text, '侦察报告', 'b']);
    expect(withBroadcast(log(at + 2), game.state).map((e) => e.text)).toEqual(['a', '黄昏', text, '侦察报告', 'b']);
    expect(withBroadcast(log(at).slice(0, 1), game.state).map((e) => e.text)).toEqual(['a', text]);
    game.state.night.broadcast = null;
    expect(withBroadcast(log(at), game.state)).toEqual(log(at));
  });
});
