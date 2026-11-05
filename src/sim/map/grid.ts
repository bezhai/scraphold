/**
 * Tile grid helpers shared by map generation, navigation, fog, placement and economy adjacency.
 * Owner: Task 1.
 */
import { TERRAIN, TERRAIN_LIST, type Terrain } from '../data/map';
import type { MapState, Point } from '../state';

export interface GridSize {
  width: number;
  height: number;
}

export function tileIndex(g: GridSize, x: number, y: number): number {
  return y * g.width + x;
}

export function tileXOf(g: GridSize, i: number): number {
  return i % g.width;
}

export function tileYOf(g: GridSize, i: number): number {
  return Math.floor(i / g.width);
}

export function inBounds(g: GridSize, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.width && y < g.height;
}

/** Tile index containing the point, or -1 outside the map. */
export function tileAtPoint(g: GridSize, px: number, py: number): number {
  const x = Math.floor(px);
  const y = Math.floor(py);
  return inBounds(g, x, y) ? y * g.width + x : -1;
}

export function tileCenter(g: GridSize, i: number): Point {
  return { x: (i % g.width) + 0.5, y: Math.floor(i / g.width) + 0.5 };
}

/** passable flag indexed by terrain code. */
export const PASSABLE_BY_CODE: readonly boolean[] = TERRAIN_LIST.map((t) => TERRAIN[t].passable);

export function terrainAt(map: MapState, i: number): Terrain {
  return TERRAIN_LIST[map.terrain[i] as number] as Terrain;
}

export function isTerrainPassable(map: MapState, i: number): boolean {
  return PASSABLE_BY_CODE[map.terrain[i] as number] === true;
}

/** Calls fn for each in-bounds tile of the size x size footprint whose top-left is (tx, ty). */
export function forEachFootprintTile(g: GridSize, tx: number, ty: number, size: number, fn: (i: number, x: number, y: number) => void): void {
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      if (inBounds(g, x, y)) fn(y * g.width + x, x, y);
    }
  }
}

/** Calls fn for each in-bounds tile touching the footprint (including diagonally), excluding the footprint. */
export function forEachRingTile(g: GridSize, tx: number, ty: number, size: number, fn: (i: number, x: number, y: number) => void): void {
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      if (x >= tx && x < tx + size && y >= ty && y < ty + size) continue;
      if (inBounds(g, x, y)) fn(y * g.width + x, x, y);
    }
  }
}

/** Euclidean distance from a point to the footprint rectangle (0 inside). */
export function distanceToRect(tx: number, ty: number, size: number, px: number, py: number): number {
  const dx = px < tx ? tx - px : px > tx + size ? px - (tx + size) : 0;
  const dy = py < ty ? ty - py : py > ty + size ? py - (ty + size) : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Center point of a footprint. */
export function footprintCenter(tx: number, ty: number, size: number): Point {
  return { x: tx + size / 2, y: ty + size / 2 };
}

/** 8-neighborhood with integer step costs (10 orthogonal, 14 diagonal). */
export const NEIGHBORS_8: readonly { dx: number; dy: number; cost: number }[] = [
  { dx: 1, dy: 0, cost: 10 },
  { dx: -1, dy: 0, cost: 10 },
  { dx: 0, dy: 1, cost: 10 },
  { dx: 0, dy: -1, cost: 10 },
  { dx: 1, dy: 1, cost: 14 },
  { dx: -1, dy: 1, cost: 14 },
  { dx: 1, dy: -1, cost: 14 },
  { dx: -1, dy: -1, cost: 14 },
];

export const NEIGHBORS_4: readonly { dx: number; dy: number }[] = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
