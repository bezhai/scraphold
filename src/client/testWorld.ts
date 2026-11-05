/**
 * Test-only world for client unit tests: a small hand-drawn map with the sim's own test builder
 * and entity factories. Not imported by the app.
 */
import { createTestGame } from '../sim/testing';
import { addBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from '../sim/world/entities';
import { FOG_VISIBLE, type Game } from '../sim';

export const TEST_ROWS = [
  '........................',
  '........................',
  '..ww....ff..............',
  '..ww....ff.....oo.......',
  '.......CCC..............',
  '.......CCC.........NN...',
  '.......CCC.........NN...',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
];

export function buildTestWorld() {
  const game: Game = createTestGame(TEST_ROWS);
  const rifle1 = spawnSoldier(game, 'rifleman', 2.5, 8.5);
  const rifle2 = spawnSoldier(game, 'rifleman', 3.5, 8.5);
  const guard = spawnSoldier(game, 'shieldGuard', 4.5, 8.5);
  const survivor1 = spawnSurvivor(game, 2.5, 10.5);
  const survivor2 = spawnSurvivor(game, 3.5, 10.5);
  const greenhouse = addBuilding(game, 'greenhouse', 8, 2, { complete: true });
  const site = addBuilding(game, 'shack', 12, 8, { complete: false });
  const shack = addBuilding(game, 'shack', 15, 8, { complete: true });
  const barracks = addBuilding(game, 'barracks', 12, 2, { complete: true });
  const damaged = addBuilding(game, 'salvageYard', 2, 0, { complete: true });
  damaged.hp = damaged.maxHp - 50;
  const mutant = spawnMutant(game, 'wanderer', 18.5, 9.5, { mode: 'assault' });
  const nest = [...game.state.entities.values()].find((e) => e.kind === 'nest')!;
  return { game, rifle1, rifle2, guard, survivor1, survivor2, greenhouse, site, shack, barracks, damaged, mutant, nest };
}

export function revealAll(game: Game): void {
  game.state.fog.fill(FOG_VISIBLE);
}
