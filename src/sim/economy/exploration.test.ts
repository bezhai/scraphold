import { RUIN_FRAGMENTS } from '../data/fragments';
import { describe, expect, it } from 'vitest';
import { RUIN_EXPLORE_RADIUS, type RuinReward } from '../data/economy';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { refreshModifiers } from '../game';
import { FOG_UNEXPLORED } from '../state';
import { createTestGame } from '../testing';
import { addBuilding, enterBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from '../world/entities';
import { rebuildSpatialIndex } from '../world/spatial';
import { explorationSystem } from './exploration';

// One ruin at tile (12, 1); its center is (12.5, 1.5).
const ROWS = ['..............', '............r.', '..............', '....CCC.......', '....CCC.......', '....CCC.......', '..............'];

function explore(game: Game): void {
  rebuildSpatialIndex(game.spatial, game.state);
  explorationSystem(game);
}

function withReward(game: Game, reward: RuinReward) {
  const ruin = game.state.map.ruins[0]!;
  ruin.reward = reward;
  return ruin;
}

describe('ruin exploration', () => {
  it('grants the reward once when a unit reaches the ruin', () => {
    const game = createTestGame(ROWS);
    const ruin = game.state.map.ruins[0]!;
    const scrap = game.state.economy.resources.scrap;
    spawnSurvivor(game, 12.5, 2.3);
    explore(game);
    expect(ruin.explored).toBe(true);
    expect(game.state.economy.resources.scrap).toBe(scrap + 50);
    expect(game.state.stats.ruinsExplored).toBe(1);
    expect(game.state.stats.resourcesGathered.scrap).toBe(50);
    expect(drainEvents(game)).toEqual([{ type: 'ruinExplored', feedback: null, ruinId: ruin.id, tile: ruin.tile, reward: { kind: 'resource', resource: 'scrap', amount: 50 } }, { type: 'ruinFragment', index: 1, text: RUIN_FRAGMENTS[0] }]);
    explore(game);
    expect(game.state.economy.resources.scrap).toBe(scrap + 50);
    expect(game.state.stats.ruinsExplored).toBe(1);
  });

  it('ignores units out of reach, mutants and survivors working inside buildings', () => {
    const game = createTestGame(ROWS);
    spawnSoldier(game, 'rifleman', 12.5, 1.5 + RUIN_EXPLORE_RADIUS + 0.5);
    spawnMutant(game, 'crawler', 12.5, 1.5, { mode: 'guard' });
    const hut = addBuilding(game, 'shack', 10, 0, { complete: true });
    const inside = spawnSurvivor(game, 12.5, 1.5);
    enterBuilding(game, inside, hut);
    inside.x = 12.5;
    inside.y = 1.5;
    explore(game);
    expect(game.state.map.ruins[0]!.explored).toBe(false);
  });

  it('scales resource and survivor rewards by ruinRewardPct', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('ruinArchives');
    refreshModifiers(game);
    const food = game.state.economy.resources.food;
    withReward(game, { kind: 'resource', resource: 'food', amount: 60 });
    spawnSoldier(game, 'scout', 12.5, 1.5);
    explore(game);
    expect(game.state.economy.resources.food).toBe(food + 90);
    expect(drainEvents(game)[0]).toMatchObject({ type: 'ruinExplored', reward: { kind: 'resource', resource: 'food', amount: 90 } });
  });

  it('recruits survivors at the ruin', () => {
    const game = createTestGame(ROWS);
    withReward(game, { kind: 'survivors', count: 2 });
    const scout = spawnSoldier(game, 'scout', 12.5, 1.5);
    explore(game);
    const recruits = [...game.state.entities.values()].filter((e) => e.kind === 'survivor');
    expect(recruits).toHaveLength(2);
    for (const r of recruits) expect(Math.abs(r.x - 12.5) + Math.abs(r.y - 1.5)).toBeLessThan(3);
    expect(game.state.stats.survivorsRecruited).toBe(2);
    const joined = drainEvents(game).filter((e) => e.type === 'survivorJoined');
    expect(joined).toEqual(recruits.map((r) => ({ type: 'survivorJoined', unitId: r.id, source: 'ruin' })));
    expect(scout.hp).toBeGreaterThan(0);
  });

  it('reveals the map around the ruin', () => {
    const game = createTestGame(ROWS, { explored: false });
    withReward(game, { kind: 'reveal', radius: 4 });
    spawnSurvivor(game, 12.5, 1.5);
    explore(game);
    const { map, fog } = game.state;
    expect(fog[5 * map.width + 12]).not.toBe(FOG_UNEXPLORED);
    expect(fog[1 * map.width + 9]).not.toBe(FOG_UNEXPLORED);
    expect(fog[6 * map.width + 2]).toBe(FOG_UNEXPLORED);
  });

  it('gives a free soldier that does not count as trained', () => {
    const game = createTestGame(ROWS);
    withReward(game, { kind: 'unit', unit: 'rifleman' });
    spawnSurvivor(game, 12.5, 1.5);
    explore(game);
    const soldiers = [...game.state.entities.values()].filter((e) => e.kind === 'soldier');
    expect(soldiers.map((s) => s.type)).toEqual(['rifleman']);
    expect(game.state.stats.soldiersTrained.rifleman).toBe(0);
  });
});
