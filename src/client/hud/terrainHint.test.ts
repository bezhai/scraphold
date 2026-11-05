import { describe, expect, it } from 'vitest';
import { FOG_UNEXPLORED } from '../../sim';
import { TERRAIN } from '../../sim/data/map';
import { buildTestWorld } from '../testWorld';
import { terrainHint } from './terrainHint';

describe('terrainHint', () => {
  it('names the terrain under the cursor and what it is good for', () => {
    const { game } = buildTestWorld();
    expect(terrainHint(game.state, 8.5, 2.5)).toBe(`沃土：${TERRAIN.fertile.description}`);
    expect(terrainHint(game.state, 2.2, 3.9)).toBe(`残骸：${TERRAIN.wreckage.description}`);
    expect(terrainHint(game.state, 15.5, 3.5)).toBe(`油渍：${TERRAIN.oil.description}`);
    expect(terrainHint(game.state, 0.5, 11.5)).toBe(`荒地：${TERRAIN.wasteland.description}`);
  });

  it('says nothing about unexplored tiles or points off the map', () => {
    const { game } = buildTestWorld();
    game.state.fog[3 * game.state.map.width + 15] = FOG_UNEXPLORED;
    expect(terrainHint(game.state, 15.5, 3.5)).toBeNull();
    expect(terrainHint(game.state, -1, 3)).toBeNull();
  });

  it('names special ruins and relay site when explored', () => {
    const { game } = buildTestWorld();
    const w = game.state.map.width;
    game.state.map.ruins.push({
      id: 99,
      kind: 'supplyPod',
      tile: 5 * w + 5,
      reward: { kind: 'resources', amounts: { scrap: 80, fuel: 20 } },
      explored: false,
    });
    game.state.fog[5 * w + 5] = 2; // visible
    expect(terrainHint(game.state, 5.5, 5.5)).toContain('坠落的补给舱');

    game.state.map.relaySite = { tileX: 10, tileY: 10, size: 3 };
    game.state.fog[10 * w + 10] = 2;
    expect(terrainHint(game.state, 11, 11)).toContain('K-7 中继站');
  });
});
