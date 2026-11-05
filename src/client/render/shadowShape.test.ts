import { describe, expect, it } from 'vitest';
import { sweptOutline } from './shadowShape';

const square: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const sorted = (pts: [number, number][]) => [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe('sweptOutline', () => {
  it('without an offset is the outline itself', () => {
    expect(sorted(sweptOutline(square, 0, 0))).toEqual(sorted(square));
  });

  it('sweeping a square sideways gives a longer rectangle', () => {
    expect(sorted(sweptOutline(square, 1, 0))).toEqual(sorted([[0, 0], [2, 0], [2, 1], [0, 1]]));
  });

  it('sweeping a square diagonally gives a hexagon covering both squares', () => {
    const hex = sweptOutline(square, 0.5, 0.5);
    expect(sorted(hex)).toEqual(sorted([[0, 0], [1, 0], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0, 1]]));
  });
});
