import { describe, expect, it } from 'vitest';
import { distanceToRect, forEachFootprintTile, forEachRingTile, tileAtPoint, tileIndex } from './grid';

const map = { width: 10, height: 8 };

describe('grid helpers', () => {
  it('maps points to tile indices and rejects points outside the map', () => {
    expect(tileAtPoint(map, 3.2, 2.9)).toBe(tileIndex(map, 3, 2));
    expect(tileAtPoint(map, -0.1, 1)).toBe(-1);
    expect(tileAtPoint(map, 10, 1)).toBe(-1);
  });

  it('iterates a footprint and the one-tile ring around it, clipped to the map', () => {
    const fp: number[] = [];
    forEachFootprintTile(map, 2, 2, 2, (i) => fp.push(i));
    expect(fp.sort((a, b) => a - b)).toEqual([22, 23, 32, 33]);
    const ring: number[] = [];
    forEachRingTile(map, 2, 2, 2, (i) => ring.push(i));
    expect(ring).toHaveLength(12);
    const corner: number[] = [];
    forEachRingTile(map, 0, 0, 1, (i) => corner.push(i));
    expect(corner.sort((a, b) => a - b)).toEqual([1, 10, 11]);
  });

  it('measures distance from a point to a footprint rectangle', () => {
    expect(distanceToRect(2, 2, 2, 3, 3)).toBe(0);
    expect(distanceToRect(2, 2, 2, 5, 3)).toBe(1);
    expect(distanceToRect(2, 2, 2, 7, 8)).toBe(5);
  });
});
