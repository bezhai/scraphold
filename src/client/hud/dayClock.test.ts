import { describe, expect, it } from 'vitest';
import { clockAt } from '../../sim';
import { CYCLE_TICKS, DAY_TICKS, TOTAL_NIGHTS } from '../../sim/time';
import { buildTestWorld } from '../testWorld';
import { dayClockModel } from './dayClock';

describe('dayClockModel', () => {
  it('retains an explicit unknown-direction forecast in dense fog', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(950);
    game.state.night.forecast = { night: 1, directionsKnown: false, precise: false, groups: [] };
    expect(dayClockModel(game.state).forecast).toEqual({ night: 1, directionsKnown: false, precise: false, groups: [] });
  });

  it('reports day 1 daytime with the time until dusk', () => {
    const { game } = buildTestWorld();
    const m = dayClockModel(game.state);
    expect(m).toMatchObject({ day: 1, totalNights: TOTAL_NIGHTS, phase: 'day', phaseName: '白天', secondsLeft: 45, nextLabel: '黄昏' });
    expect(m.phaseProgress).toBe(0);
  });

  it('dusk counts down to nightfall and night to dawn', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(900 + 100);
    expect(dayClockModel(game.state)).toMatchObject({ phase: 'dusk', phaseName: '黄昏', secondsLeft: 10, nextLabel: '入夜' });
    game.state.clock = clockAt(1200);
    expect(dayClockModel(game.state)).toMatchObject({ phase: 'night', phaseName: '夜晚', secondsLeft: 50, nextLabel: '天亮' });
  });

  it('the final night ends in victory', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt((TOTAL_NIGHTS - 1) * CYCLE_TICKS + DAY_TICKS);
    expect(dayClockModel(game.state)).toMatchObject({ day: TOTAL_NIGHTS, phase: 'night', nextLabel: '胜利' });
  });

  it('shows tonight’s forecast from dusk on, with counts only when precise', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(950);
    expect(dayClockModel(game.state).forecast).toBeNull();
    game.state.night.forecast = {
      night: 1,
      directionsKnown: true,
      precise: false,
      groups: [{ direction: 'NE', size: 'large', counts: null, boss: null }],
    };
    expect(dayClockModel(game.state).forecast).toEqual({
      night: 1,
      directionsKnown: true,
      precise: false,
      groups: [{ direction: 'NE', directionName: '东北', sizeName: '大群', detail: null, boss: null }],
    });
    game.state.night.forecast = {
      night: 1,
      directionsKnown: true,
      precise: true,
      groups: [{ direction: 'S', size: 'small', counts: { wanderer: 6, runner: 2 }, boss: true }],
    };
    expect(dayClockModel(game.state).forecast?.groups[0]).toEqual({
      direction: 'S',
      directionName: '南',
      sizeName: '小股',
      detail: '游荡者 ×6、疾行者 ×2',
      boss: true,
    });
  });

  it('ignores a stale forecast from an earlier night', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(2200 + 950);
    game.state.night.forecast = { night: 1, directionsKnown: true, precise: false, groups: [] };
    expect(dayClockModel(game.state).forecast).toBeNull();
  });
});
