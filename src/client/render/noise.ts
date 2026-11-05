/**
 * Deterministic hash noise for procedural art (stable per map, unrelated to the simulation RNG):
 * integer hashes, smooth value noise, and value-noise grids sampled many times per pixel when the
 * terrain is painted.
 */

/** 0..1 from integer coordinates and a salt. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth value noise in 0..1 with the given cell size. */
export function valueNoise(x: number, y: number, cell: number, salt = 0): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, salt);
  const b = hash2(x0 + 1, y0, salt);
  const c = hash2(x0, y0 + 1, salt);
  const d = hash2(x0 + 1, y0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function seedSalt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % 100003;
}

/** Lattice values of value noise over an area, so sampling it is a few array reads. */
export interface NoiseGrid {
  cols: number;
  rows: number;
  cell: number;
  data: Float32Array;
}

/** Noise covering width x height (same units as `cell`, e.g. pixels). */
export function noiseGrid(width: number, height: number, cell: number, salt: number): NoiseGrid {
  const cols = Math.ceil(width / cell) + 2;
  const rows = Math.ceil(height / cell) + 2;
  const data = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) data[y * cols + x] = hash2(x, y, salt);
  return { cols, rows, cell, data };
}

/** Same value as valueNoise(x, y, grid.cell, salt) inside the grid's area. */
export function sampleNoise(n: NoiseGrid, x: number, y: number): number {
  const gx = x / n.cell;
  const gy = y / n.cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const i = y0 * n.cols + x0;
  const a = n.data[i] as number;
  const b = n.data[i + 1] as number;
  const c = n.data[i + n.cols] as number;
  const d = n.data[i + n.cols + 1] as number;
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
