import { describe, expect, it } from 'vitest';
import { blurTiles, sampleBilinear } from './tileField';

describe('blurTiles', () => {
  it('keeps a constant field constant, including at the map border', () => {
    const src = new Float32Array(20).fill(0.7);
    const out = new Float32Array(20);
    blurTiles(src, 5, 4, out);
    for (const v of out) expect(v).toBeCloseTo(0.7, 5);
  });
});

/** The x where a row of the sampled field crosses 0.5 (scanning in small steps). */
function crossing(field: Float32Array, w: number, h: number, y: number): number {
  let prev = sampleBilinear(field, w, h, 0, y);
  for (let x = 0.02; x < w; x += 0.02) {
    const v = sampleBilinear(field, w, h, x, y);
    if ((prev - 0.5) * (v - 0.5) <= 0) return x;
    prev = v;
  }
  return NaN;
}

describe('soft fog edges', () => {
  it('a straight edge becomes a ramp more than a tile wide', () => {
    const w = 12;
    const h = 6;
    const src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = x < 6 ? 1 : 0;
    const out = new Float32Array(w * h);
    blurTiles(src, w, h, out);
    expect(sampleBilinear(out, w, h, 6, 3)).toBeCloseTo(0.5, 5);
    expect(sampleBilinear(out, w, h, 5.5, 3)).toBeLessThan(0.9);
    expect(sampleBilinear(out, w, h, 6.5, 3)).toBeGreaterThan(0.1);
  });

  it('a diagonal staircase of tiles gives a nearly straight contour (no visible tile steps)', () => {
    const n = 24;
    const src = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) src[y * n + x] = x + y < n ? 1 : 0;
    const out = new Float32Array(n * n);
    blurTiles(src, n, n, out);
    // Along a 45 degree edge the contour should be x = c - y; measure the wobble around it.
    const offsets: number[] = [];
    for (let y = 6; y < n - 6; y += 0.125) offsets.push(crossing(out, n, n, y) + y);
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const wobble = Math.max(...offsets.map((o) => Math.abs(o - mean)));
    expect(wobble).toBeLessThan(0.05);
  });
});
