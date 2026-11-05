/**
 * Balance guard for the night content: a player who never issues a command survives night 1 with
 * any origin and loses the core before the first surge. Task 6 runs the full multi-seed version.
 */
import { describe, expect, it } from 'vitest';
import type { OriginId } from '../data/economy';
import { drainEvents } from '../events';
import { stepGame } from '../pipeline';
import { CYCLE_TICKS } from '../time';
import { createGame } from '../world/setup';

function doNothing(seed: string, origin: OriginId): { coreAliveAtDay2: boolean; lostOnDay: number | null; firstSurge: number } {
  const game = createGame({ seed, origin, difficulty: 'normal' });
  const firstSurge = game.calendarPlan.indexOf('surge') + 1;
  let coreAliveAtDay2 = false;
  while (game.state.outcome.status === 'playing' && game.state.tick < (firstSurge - 1) * CYCLE_TICKS) {
    stepGame(game);
    drainEvents(game);
    if (game.state.tick === CYCLE_TICKS + 1) coreAliveAtDay2 = game.state.outcome.status === 'playing';
  }
  return { coreAliveAtDay2, firstSurge, lostOnDay: game.state.outcome.status === 'lost' ? game.state.clock.day : null };
}

describe('doing nothing', () => {
  it.each([
    ['quiet-1', 'scavengers'],
    ['quiet-2', 'militia'],
    ['quiet-3', 'scholars'],
  ] as const)('seed %s (%s): survives night 1, the core falls before the first surge', (seed, origin) => {
    const result = doNothing(seed, origin);
    expect(result.coreAliveAtDay2).toBe(true);
    expect(result.lostOnDay).not.toBeNull();
    expect(result.lostOnDay).toBeLessThan(result.firstSurge);
  });
});
