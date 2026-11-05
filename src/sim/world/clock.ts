/**
 * Clock system: derives state.clock from state.tick and announces phase changes. Owner: Task 1.
 * Systems detect "first tick of a phase" with state.clock.phaseTick === 0.
 */
import { emit } from '../events';
import type { Game } from '../game';
import { clockAt } from '../time';

export function clockSystem(game: Game): void {
  const clock = clockAt(game.state.tick);
  game.state.clock = clock;
  if (clock.phaseTick === 0) emit(game, { type: 'phaseChanged', day: clock.day, phase: clock.phase });
}
