import { describe, expect, it } from 'vitest';
import { noiseGrid, sampleNoise, valueNoise } from './noise';

describe('noiseGrid / sampleNoise', () => {
  it('samples the same smooth value noise as valueNoise, from precomputed lattice values', () => {
    const grid = noiseGrid(200, 120, 16, 42);
    for (const [x, y] of [
      [0, 0],
      [7.5, 3.25],
      [150, 100],
      [199, 119],
    ] as const)
      expect(sampleNoise(grid, x, y)).toBeCloseTo(valueNoise(x, y, 16, 42), 5);
  });
});
