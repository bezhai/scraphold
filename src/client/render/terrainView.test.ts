import { describe, expect, it } from 'vitest';
import { coverRect, rectContains } from './terrainView';

const MAP = { width: 64, height: 48 };

describe('coverRect', () => {
  it('covers the view with a margin, on whole tiles', () => {
    const r = coverRect({ x0: 10.3, y0: 8.6, x1: 30.2, y1: 20.1 }, MAP, 0.25);
    expect(r).toEqual({ x0: 5, y0: 5, x1: 36, y1: 23 });
    for (const v of [r.x0, r.y0, r.x1, r.y1]) expect(Number.isInteger(v)).toBe(true);
  });

  it('stays inside the map', () => {
    expect(coverRect({ x0: -5, y0: -3, x1: 70, y1: 60 }, MAP, 0.25)).toEqual({ x0: 0, y0: 0, x1: 64, y1: 48 });
  });
});

describe('rectContains', () => {
  it('is true when the inner rect (clamped to the map) lies inside the outer one', () => {
    const outer = { x0: 5, y0: 5, x1: 36, y1: 24 };
    expect(rectContains(outer, { x0: 6, y0: 6, x1: 30, y1: 20 }, MAP)).toBe(true);
    expect(rectContains(outer, { x0: 4, y0: 6, x1: 30, y1: 20 }, MAP)).toBe(false);
    expect(rectContains({ x0: 0, y0: 0, x1: 20, y1: 20 }, { x0: -3, y0: -2, x1: 18, y1: 19 }, MAP)).toBe(true);
  });
});
