import { describe, expect, it } from 'vitest';
import { MAP_GEN } from '../sim/data/map';
import { ORIGINS } from '../sim/data/economy';
import { CYCLE_TICKS, GAME_END_TICK, TOTAL_NIGHTS } from '../sim/time';
import { runHeadless } from './run';

describe('runHeadless', () => {
  it('includes the final dawn when a full game is requested', () => {
    const summary = runHeadless({
      seed: 'final-dawn', origin: 'militia', difficulty: 'normal', days: TOTAL_NIGHTS,
      controller: (game) => {
        // Jump a controlled fixture to the final boundary, keeping the core alive.
        if (game.state.tick === 0) game.state.tick = GAME_END_TICK - 1;
        return [];
      },
    });
    expect(summary.outcome).toBe('won');
    expect(summary.ticks).toBe(GAME_END_TICK + 1);
    expect(summary.clock.day).toBe(TOTAL_NIGHTS + 1);
  });

  it('runs whole day-night cycles and summarizes the game deterministically', () => {
    const a = runHeadless({ seed: 'headless-1', origin: 'militia', difficulty: 'normal', days: 1 });
    const b = runHeadless({ seed: 'headless-1', origin: 'militia', difficulty: 'normal', days: 1 });
    expect(a).toEqual(b);
    expect(a.ticks).toBe(CYCLE_TICKS);
    expect(a.clock).toMatchObject({ day: 1, phase: 'night' });
    expect(a.outcome).toBe('playing');
    // Night 1 is meant to be survivable without orders: the militia's starting riflemen all live.
    const riflemen = ORIGINS.militia.start.soldiers.find((g) => g.type === 'rifleman')?.count ?? 0;
    expect(riflemen).toBeGreaterThan(0);
    expect(a.units.soldiers).toEqual({ rifleman: riflemen });
    expect(a.buildings.core).toBe(1);
    expect(a.buildings.barracks).toBe(1);
    expect(a.nests.total).toBeGreaterThanOrEqual(MAP_GEN.nests.count[0] + 1);
    expect(a.events.phaseChanged).toBe(3);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('lets a controller issue commands every tick, seeing the previous tick events', () => {
    let calls = 0;
    let sawPhase = false;
    const summary = runHeadless({
      seed: 'headless-2',
      origin: 'militia',
      difficulty: 'normal',
      days: 1,
      controller: (game, events) => {
        calls++;
        if (events.some((e) => e.type === 'phaseChanged')) sawPhase = true;
        if (game.state.tick === 10) {
          const ids = [...game.state.entities.values()].filter((e) => e.kind === 'soldier').map((e) => e.id);
          return [{ type: 'move', unitIds: ids, x: 2, y: 2 }];
        }
        return [];
      },
    });
    expect(calls).toBe(CYCLE_TICKS);
    expect(sawPhase).toBe(true);
    expect(summary.commands).toEqual({ accepted: 1, rejected: {} });
  });
});
