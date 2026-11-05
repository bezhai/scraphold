import { describe, expect, it } from 'vitest';
import { FOG_UNEXPLORED } from '../state';
import { createTestGame } from '../testing';
import { spawnSoldier } from './entities';
import { checkPlacement } from './placement';

const ROWS = [
  '............',
  '..oo....~~..',
  '............',
  '...CCC......',
  '...CCC....w.',
  '...CCC......',
  '............',
];

describe('checkPlacement', () => {
  it('reserves the relay footprint for the signal project while keeping it walkable', () => {
    const game = createTestGame(ROWS);
    game.state.map.relaySite = { tileX: 7, tileY: 3, size: 3 };
    expect(checkPlacement(game, 'shack', 6, 2)).toEqual({ ok: false, reason: 'occupied' });
    expect(checkPlacement(game, 'barricade', 6, 3)).toEqual({ ok: true });
  });

  it('accepts open wasteland and rejects the core type', () => {
    const game = createTestGame(ROWS);
    expect(checkPlacement(game, 'shack', 7, 5)).toEqual({ ok: true });
    expect(checkPlacement(game, 'core', 7, 5)).toEqual({ ok: false, reason: 'notPlaceable' });
  });

  it('restricts oil wells to oil and rejects wrong or impassable terrain', () => {
    const game = createTestGame(ROWS);
    expect(checkPlacement(game, 'oilWell', 2, 1)).toEqual({ ok: true });
    expect(checkPlacement(game, 'oilWell', 4, 1)).toEqual({ ok: false, reason: 'wrongTerrain' });
    expect(checkPlacement(game, 'shack', 2, 0)).toEqual({ ok: false, reason: 'wrongTerrain' });
    expect(checkPlacement(game, 'shack', 7, 0)).toEqual({ ok: false, reason: 'blockedTerrain' });
    expect(checkPlacement(game, 'shack', 9, 4)).toEqual({ ok: false, reason: 'wrongTerrain' });
  });

  it('rejects overlap, out of bounds, unexplored tiles and units in the way', () => {
    const game = createTestGame(ROWS);
    expect(checkPlacement(game, 'shack', 5, 5)).toEqual({ ok: false, reason: 'occupied' });
    expect(checkPlacement(game, 'shack', 11, 6)).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(checkPlacement(game, 'shack', -1, 0)).toEqual({ ok: false, reason: 'outOfBounds' });
    game.state.fog[0] = FOG_UNEXPLORED;
    expect(checkPlacement(game, 'barricade', 0, 0)).toEqual({ ok: false, reason: 'unexplored' });
    spawnSoldier(game, 'rifleman', 8.1, 6.1);
    expect(checkPlacement(game, 'shack', 7, 5)).toEqual({ ok: false, reason: 'unitsInTheWay' });
  });
});
