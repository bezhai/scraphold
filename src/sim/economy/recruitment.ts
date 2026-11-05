/** Free survivors from exploration and incidents share placement and accounting. */
import { emit, type GameEvent } from '../events';
import type { Game } from '../game';
import type { Point } from '../state';
import { spawnSurvivor } from '../world/entities';
type Source = Extract<GameEvent, {
  type: 'survivorJoined';
}>['source'];
export function recruitSurvivors(game: Game, at: Point, count: number, source: Source): void {
  for (let k = 0; k < count; k++) {
    const survivor = spawnSurvivor(game, at.x + k % 2 * 0.6 - 0.3, at.y + Math.floor(k / 2) * 0.6);
    game.state.stats.survivorsRecruited++;
    emit(game, {
      type: 'survivorJoined',
      unitId: survivor.id,
      source
    });
  }
}
