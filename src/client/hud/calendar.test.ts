import { describe, expect, it } from 'vitest';
import { clockAt, createGame } from '../../sim';
import { NIGHT_TYPE_DESCRIPTIONS, NIGHT_TYPE_NAMES } from '../../sim/data/calendar';
import { CYCLE_TICKS, DAY_TICKS } from '../../sim/time';
import { calendarStripModel } from './calendar';

describe('calendarStripModel', () => {
  it('lists tonight plus the next 3 published nights with the hover card wording', () => {
    const game = createGame({ seed: 'test-cal-1', origin: 'scavengers', difficulty: 'normal' });
    const model = calendarStripModel(game);

    expect(model.nights.map((n) => n.night)).toEqual([1, 2, 3, 4]);
    expect(model.nights[0]).toMatchObject({
      isTonight: true,
      type: 'calm',
      name: NIGHT_TYPE_NAMES.calm,
      label: '今晚',
      title: `今晚（第 1 夜）· ${NIGHT_TYPE_NAMES.calm}`,
      description: NIGHT_TYPE_DESCRIPTIONS.calm,
    });
    const second = model.nights[1]!;
    expect(second.isTonight).toBe(false);
    expect(second.label).toBe('第2夜');
    expect(second.title).toBe(`第 2 夜 · ${NIGHT_TYPE_NAMES[second.type]}`);
  });

  it('stops at night 20', () => {
    const game = createGame({ seed: 'test-cal-20', origin: 'militia', difficulty: 'normal' });
    game.state.clock = clockAt(18 * CYCLE_TICKS);
    game.state.calendar.nights[18]!.type = 'raid';
    game.state.calendar.nights[19]!.type = 'surge';
    expect(calendarStripModel(game).nights.map((n) => n.night)).toEqual([19, 20]);
  });

  it('reports the vision lost after a rust storm from the simulation, and nothing once 雾气过滤 is researched', () => {
    const game = createGame({ seed: 'test-cal-storm', origin: 'scavengers', difficulty: 'normal' });
    expect(calendarStripModel(game).postStormVisionLossPct).toBe(0);
    game.state.calendar.reducedVisionUntilTick = game.state.tick + DAY_TICKS;
    expect(calendarStripModel(game).postStormVisionLossPct).toBe(20);
    game.modifiers.global.postStormVisionImmunity = 1;
    expect(calendarStripModel(game).postStormVisionLossPct).toBe(0);
  });
});
