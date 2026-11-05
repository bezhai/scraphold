/**
 * Smooth fields over the tile grid: a small blur and bilinear sampling between tile centers.
 * Blurring a per-tile value before sampling turns the staircase of tile edges into smooth
 * contours, so fog and terrain transitions show no tile grid at any zoom.
 */

/** Separable [1 2 1] / 4 blur over the tile grid; borders repeat the edge tile. */
export function blurTiles(src: Float32Array, width: number, height: number, out: Float32Array): void {
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const l = src[row + Math.max(0, x - 1)] as number;
      const r = src[row + Math.min(width - 1, x + 1)] as number;
      tmp[row + x] = (l + 2 * (src[row + x] as number) + r) / 4;
    }
  }
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = ((tmp[up + x] as number) + 2 * (tmp[row + x] as number) + (tmp[down + x] as number)) / 4;
  }
}

/** Field value at world point (x, y) in tiles, interpolated between tile centers. */
export function sampleBilinear(field: Float32Array, width: number, height: number, x: number, y: number): number {
  const gx = Math.min(width - 1, Math.max(0, x - 0.5));
  const gy = Math.min(height - 1, Math.max(0, y - 0.5));
  const ix = Math.min(width - 2, Math.floor(gx));
  const iy = Math.min(height - 2, Math.floor(gy));
  const fx = gx - Math.max(0, ix);
  const fy = gy - Math.max(0, iy);
  const i = Math.max(0, iy) * width + Math.max(0, ix);
  const a = field[i] as number;
  const b = width > 1 ? (field[i + 1] as number) : a;
  const c = height > 1 ? (field[i + width] as number) : a;
  const d = width > 1 && height > 1 ? (field[i + width + 1] as number) : c;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
