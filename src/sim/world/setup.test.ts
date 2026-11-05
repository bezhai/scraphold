import { describe, expect, it } from 'vitest';
import { BUILDINGS, ORIGINS, ORIGIN_IDS, START } from '../data/economy';
import { TERRAIN_LIST } from '../data/map';
import { hashValue } from '../hash';
import { generateMap } from '../map/mapgen';
import { distanceToRect, tileIndex } from '../map/grid';
import { FOG_UNEXPLORED, FOG_VISIBLE, type Building, type Entity } from '../state';
import { createGame } from './setup';

const ofKind = <K extends Entity['kind']>(es: Iterable<Entity>, kind: K) => [...es].filter((e) => e.kind === kind) as Extract<Entity, { kind: K }>[];

describe('createGame', () => {
  it.each(ORIGIN_IDS)('publishes housing capacity at tick zero for %s', origin => {
    const game = createGame({ seed: 'initial-housing', origin, difficulty: 'normal' });
    expect(game.state.tick).toBe(0);
    expect(game.state.economy.housingCap).toBe(BUILDINGS.core.housing + game.modifiers.building.core.housingAdd);
    expect(game.state.economy.housingCap).toBeGreaterThan(0);
  });
  it('places the core, starting survivors, resources and every nest from the map', () => {
    const game = createGame({ seed: 'setup-1', origin: 'scavengers', difficulty: 'normal' });
    const { state } = game;
    const core = state.entities.get(state.coreId) as Building;
    expect(core).toMatchObject({ kind: 'building', type: 'core', tileX: state.map.coreTile.x, tileY: state.map.coreTile.y, construction: null });
    expect(ofKind(state.entities.values(), 'survivor')).toHaveLength(START.survivors);
    expect(state.economy.resources).toEqual(START.resources);
    const nests = ofKind(state.entities.values(), 'nest');
    expect(nests).toHaveLength(generateMap('setup-1').nests.length);
    expect(nests.filter((n) => n.isHive)).toHaveLength(1);
    expect(nests.every((n) => n.growth.level === 1 && !n.discovered)).toBe(true);
    expect(state.fog[tileIndex(state.map, state.map.coreTile.x + 1, state.map.coreTile.y + 1)]).toBe(FOG_VISIBLE);
    for (const n of nests) expect(state.fog[tileIndex(state.map, n.tileX, n.tileY)]).toBe(FOG_UNEXPLORED);
  });

  it('keeps the map independent of the origin and difficulty', () => {
    const a = createGame({ seed: 'setup-2', origin: 'scavengers', difficulty: 'easy' });
    const b = createGame({ seed: 'setup-2', origin: 'militia', difficulty: 'hard' });
    expect(hashValue(a.state.map)).toBe(hashValue(b.state.map));
  });

  it('gives scavengers a finished salvage yard near the core, clear of the core ring', () => {
    for (const seed of ['sc-1', 'sc-2', 'sc-3']) {
      const game = createGame({ seed, origin: 'scavengers', difficulty: 'normal' });
      const yards = ofKind(game.state.entities.values(), 'building').filter((b) => b.type === 'salvageYard');
      expect(yards).toHaveLength(1);
      const y = yards[0]!;
      expect(y.construction).toBeNull();
      const core = game.state.map.coreTile;
      const gap = distanceToRect(core.x, core.y, 3, y.x, y.y) - y.size / 2;
      expect(gap).toBeGreaterThanOrEqual(1);
      expect(gap).toBeLessThan(12);
      for (let dy = 0; dy < y.size; dy++)
        for (let dx = 0; dx < y.size; dx++) {
          const t = TERRAIN_LIST[game.state.map.terrain[tileIndex(game.state.map, y.tileX + dx, y.tileY + dy)]!]!;
          expect(BUILDINGS.salvageYard.allowedTerrain).toContain(t);
        }
    }
  });

  it('gives the militia a barracks and its starting riflemen', () => {
    const game = createGame({ seed: 'setup-3', origin: 'militia', difficulty: 'normal' });
    const buildings = ofKind(game.state.entities.values(), 'building');
    expect(buildings.filter((b) => b.type === 'barracks' && b.construction === null)).toHaveLength(1);
    const soldiers = ofKind(game.state.entities.values(), 'soldier');
    const riflemen = ORIGINS.militia.start.soldiers.find((g) => g.type === 'rifleman')?.count ?? 0;
    expect(riflemen).toBeGreaterThan(0);
    expect(soldiers.map((s) => s.type)).toEqual(Array.from({ length: riflemen }, () => 'rifleman'));
    expect(ofKind(game.state.entities.values(), 'survivor')).toHaveLength(START.survivors);
  });

  it('reveals every ruin location for the scholars', () => {
    const game = createGame({ seed: 'setup-4', origin: 'scholars', difficulty: 'normal' });
    for (const r of game.state.map.ruins) expect(game.state.fog[r.tile]).not.toBe(FOG_UNEXPLORED);
    expect(game.state.economy.resources.research).toBe(START.resources.research + 20);
    const other = createGame({ seed: 'setup-4', origin: 'militia', difficulty: 'normal' });
    expect(other.state.map.ruins.some((r) => other.state.fog[r.tile] === FOG_UNEXPLORED)).toBe(true);
  });

  it('puts starting units on distinct open tiles', () => {
    const game = createGame({ seed: 'setup-5', origin: 'militia', difficulty: 'normal' });
    const units = [...game.state.entities.values()].filter((e) => e.kind === 'survivor' || e.kind === 'soldier');
    const tiles = units.map((u) => tileIndex(game.state.map, Math.floor(u.x), Math.floor(u.y)));
    expect(new Set(tiles).size).toBe(units.length);
  });
});
