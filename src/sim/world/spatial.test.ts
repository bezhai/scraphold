import { describe, expect, it } from 'vitest';
import { createTestGame } from '../testing';
import type { Entity } from '../state';
import { addBuilding, enterBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from './entities';
import { edgeDistance, findNearest, forEachInRadius, rebuildSpatialIndex } from './spatial';

const ROWS = ['....................', '....................', '.......CCC..........', '.......CCC..........', '.......CCC..........', '....................'];

describe('spatial index', () => {
  it('finds exactly the entities whose edge is within the radius, structures included', () => {
    const game = createTestGame(ROWS);
    const near = spawnMutant(game, 'wanderer', 2.0, 1.0, { mode: 'assault' });
    const edge = spawnMutant(game, 'wanderer', 4.99 + near.radius, 1.0, { mode: 'assault' });
    const far = spawnMutant(game, 'wanderer', 15, 1, { mode: 'assault' });
    rebuildSpatialIndex(game.spatial, game.state);
    const found: Entity[] = [];
    forEachInRadius(game.spatial, 2, 1, 3, (e) => found.push(e));
    const ids = found.map((e) => e.id);
    expect(ids).toContain(near.id);
    expect(ids).toContain(edge.id);
    expect(ids).not.toContain(far.id);
    // The core footprint spans x 7..10: edge distance from (5, 3) is 2.
    const core = game.state.entities.get(game.state.coreId)!;
    expect(edgeDistance(core, 5, 3)).toBeCloseTo(2);
    const aroundCore: number[] = [];
    forEachInRadius(game.spatial, 5, 3, 2.01, (e) => aroundCore.push(e.id));
    expect(aroundCore).toContain(core.id);
  });

  it('skips survivors inside buildings and dead entities', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 1, 3, { complete: true });
    const inside = spawnSurvivor(game, 0.5, 3.5);
    enterBuilding(game, inside, yard);
    const dead = spawnSoldier(game, 'rifleman', 1, 1);
    dead.hp = 0;
    rebuildSpatialIndex(game.spatial, game.state);
    const ids: number[] = [];
    forEachInRadius(game.spatial, 2, 3, 6, (e) => ids.push(e.id));
    expect(ids).toContain(yard.id);
    expect(ids).not.toContain(inside.id);
    expect(ids).not.toContain(dead.id);
  });

  it('returns the nearest accepted entity, breaking ties by lower id', () => {
    const game = createTestGame(ROWS);
    const a = spawnMutant(game, 'wanderer', 14, 1, { mode: 'assault' });
    const b = spawnMutant(game, 'wanderer', 18, 1, { mode: 'assault' });
    const s = spawnSoldier(game, 'rifleman', 15.5, 1);
    rebuildSpatialIndex(game.spatial, game.state);
    expect(findNearest(game.spatial, 16, 1, 10, (e) => e.faction === 'mutant')!.id).toBe(a.id);
    expect(findNearest(game.spatial, 16, 1, 10, (e) => e.id === s.id)!.id).toBe(s.id);
    expect(findNearest(game.spatial, 16, 1, 0.5, (e) => e.id === b.id)).toBeNull();
    // Equidistant: lower id wins.
    const c = spawnMutant(game, 'wanderer', 16, 4, { mode: 'assault' });
    const d = spawnMutant(game, 'wanderer', 16, 4, { mode: 'assault' });
    rebuildSpatialIndex(game.spatial, game.state);
    expect(findNearest(game.spatial, 16, 4, 1, (e) => e.id === c.id || e.id === d.id)!.id).toBe(c.id);
  });
});
