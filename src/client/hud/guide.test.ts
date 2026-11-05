import { describe, expect, it } from 'vitest';
import { clockAt } from '../../sim';
import { addBuilding } from '../../sim/world/entities';
import { buildTestWorld } from '../testWorld';
import { firstDayGuide } from './guide';

const NOT_SEEN = { calendarSeen: false };
const done = (game: ReturnType<typeof buildTestWorld>['game'], progress = NOT_SEEN) =>
  Object.fromEntries((firstDayGuide(game.state, progress)?.steps ?? []).map((s) => [s.id, s.done]));

describe('firstDayGuide', () => {
  it('lists the steps covering days 1 to 3; buildings the game started with do not count as built', () => {
    const w = buildTestWorld();
    const g = firstDayGuide(w.game.state, NOT_SEEN);
    expect(g?.steps.map((s) => s.id)).toEqual(['produce', 'staff', 'barracks', 'train', 'calendar', 'forecast', 'survive', 'incident', 'relay']);
    expect(done(w.game)).toEqual({ produce: false, staff: false, barracks: true, train: false, forecast: false, survive: false, calendar: false, incident: false, relay: false });
    expect(g?.next).toBe('produce');
    expect(g?.doneCount).toBe(1);
  });

  it('ticks steps off from the state as the player does them', () => {
    const w = buildTestWorld();
    addBuilding(w.game, 'salvageYard', 20, 0, { complete: false });
    w.survivor1.task = { type: 'work', buildingId: w.greenhouse.id };
    (w.barracks.trainQueue as unknown[]).push({ unit: 'rifleman', progress: 0, total: 100, paid: {} });
    expect(done(w.game)).toMatchObject({ produce: true, staff: true, train: true, forecast: false });
    expect(firstDayGuide(w.game.state, NOT_SEEN)?.next).toBe('calendar');
    expect(firstDayGuide(w.game.state, { calendarSeen: true })?.next).toBe('forecast');
    expect(firstDayGuide(w.game.state, NOT_SEEN)?.doneCount).toBe(4);
    w.game.state.clock = clockAt(1300);
    expect(done(w.game)).toMatchObject({ forecast: true, survive: false });
  });

  it('a completed production building or a trained soldier counts after the fact', () => {
    const w = buildTestWorld();
    w.game.state.stats.buildingsBuilt.greenhouse = 1;
    w.game.state.stats.soldiersTrained.rifleman = 1;
    expect(done(w.game)).toMatchObject({ produce: true, train: true });
  });

  it('the calendar step is done once the player has hovered the calendar, on day 1 already, and not by the night passing', () => {
    const w = buildTestWorld();
    expect(done(w.game, { calendarSeen: true }).calendar).toBe(true);
    w.game.state.clock = clockAt(2200 + 100); // Day 2
    expect(done(w.game)).toMatchObject({ survive: true, calendar: false });
  });

  it('new steps use the finalized wording, with no compass direction', () => {
    const w = buildTestWorld();
    const text = Object.fromEntries((firstDayGuide(w.game.state, NOT_SEEN)?.steps ?? []).map((s) => [s.id, s.text]));
    expect(text.calendar).toBe('顶栏的日历显示今晚和之后 3 晚是什么夜，悬停看每种夜的说明。');
    expect(text.incident).toBe('事件卡弹出时游戏会停住。天黑前没处理，会按最后一个选项结算。');
    expect(text.relay).toBe('派斥候探索迷雾，找到中继站；研究"旧频段破译"以后就能在那里修信号塔。');
    expect(Object.values(text).join('')).not.toMatch(/[东南西北]方|向[东南西北]/);
  });

  it('ticks day 2-3 steps: incident and relay exploration', () => {
    const w = buildTestWorld();
    w.game.state.clock = clockAt(2200 + 100); // Day 2

    w.game.state.incidents.history.push({ id: 1, definitionId: 'caravan', raisedTick: 100, resolvedTick: 200, choiceId: 'fuel', automatic: false });
    expect(done(w.game).incident).toBe(true);

    w.game.state.signal.discovered = true;
    expect(done(w.game).relay).toBe(true);
  });

  it('goes away once everything is done, and after day 3 in any case', () => {
    const w = buildTestWorld();
    w.game.state.clock = clockAt(2200 + 100);
    expect(firstDayGuide(w.game.state, { calendarSeen: true })).not.toBeNull();
    w.game.state.stats.buildingsBuilt.greenhouse = 1;
    w.game.state.stats.soldiersTrained.rifleman = 1;
    w.survivor1.task = { type: 'work', buildingId: w.greenhouse.id };
    w.game.state.incidents.history.push({ id: 1, definitionId: 'caravan', raisedTick: 100, resolvedTick: 200, choiceId: 'fuel', automatic: false });
    w.game.state.signal.discovered = true;
    expect(firstDayGuide(w.game.state, { calendarSeen: true })).toBeNull();

    const fresh = buildTestWorld();
    fresh.game.state.clock = clockAt(3 * 2200 + 100); // Day 4
    expect(firstDayGuide(fresh.game.state, NOT_SEEN)).toBeNull();
  });
});
