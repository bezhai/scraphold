/**
 * Uniform-grid spatial index over every entity on the map, for neighbor and target queries
 * (combat, mutant AI, separation, exploration). Owner: Task 1.
 *
 * Derived data, rebuilt by the pipeline (before AI and again after movement). Entities with
 * hp <= 0 and survivors inside buildings are not indexed. Queries use edge distance: for units
 * the center distance minus radius, for structures the distance to the footprint rectangle.
 */
import { distanceToRect } from '../map/grid';
import type { Entity, GameState } from '../state';

export const SPATIAL_CELL_SIZE = 2;
/** Max distance from an entity's center to its edge (hive half-diagonal); queries widen by it. */
const MAX_EXTENT = 2.2;

export interface SpatialIndex {
  cols: number;
  rows: number;
  /** cellStart[c]..cellStart[c+1] index into items for cell c. */
  cellStart: Int32Array;
  items: Entity[];
  cursor: Int32Array;
}

export function createSpatialIndex(width: number, height: number): SpatialIndex {
  const cols = Math.ceil(width / SPATIAL_CELL_SIZE);
  const rows = Math.ceil(height / SPATIAL_CELL_SIZE);
  return { cols, rows, cellStart: new Int32Array(cols * rows + 1), items: [], cursor: new Int32Array(cols * rows) };
}

/** Alive and physically on the map (not a survivor working inside a building). */
export function isOnMap(e: Entity): boolean {
  return e.hp > 0 && !(e.kind === 'survivor' && e.insideId !== 0);
}

export function edgeDistance(e: Entity, x: number, y: number): number {
  if (e.kind === 'building' || e.kind === 'nest') return distanceToRect(e.tileX, e.tileY, e.size, x, y);
  const dx = e.x - x;
  const dy = e.y - y;
  return Math.max(0, Math.sqrt(dx * dx + dy * dy) - e.radius);
}

function cellCoord(v: number, max: number): number {
  const c = Math.floor(v / SPATIAL_CELL_SIZE);
  return c < 0 ? 0 : c >= max ? max - 1 : c;
}

export function rebuildSpatialIndex(index: SpatialIndex, state: GameState): void {
  const { cols, rows, cellStart, cursor } = index;
  cellStart.fill(0);
  let total = 0;
  for (const e of state.entities.values()) {
    if (!isOnMap(e)) continue;
    const c = cellCoord(e.y, rows) * cols + cellCoord(e.x, cols);
    cellStart[c + 1]!++;
    total++;
  }
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1]! += cellStart[c] as number;
  cursor.set(cellStart.subarray(0, cols * rows));
  index.items.length = total;
  for (const e of state.entities.values()) {
    if (!isOnMap(e)) continue;
    const c = cellCoord(e.y, rows) * cols + cellCoord(e.x, cols);
    index.items[cursor[c]!++] = e;
  }
}

/**
 * Calls fn for every indexed entity whose edge is within `radius` of (x, y). `maxExtent` bounds the
 * center-to-edge size of the entities the caller cares about: a caller that only wants units can
 * pass the largest unit radius to search fewer cells (larger entities may then be missed).
 */
export function forEachInRadius(index: SpatialIndex, x: number, y: number, radius: number, fn: (e: Entity) => void, maxExtent = MAX_EXTENT): void {
  const { cols, rows, cellStart, items } = index;
  const reach = radius + maxExtent;
  const c0 = cellCoord(x - reach, cols);
  const c1 = cellCoord(x + reach, cols);
  const r0 = cellCoord(y - reach, rows);
  const r1 = cellCoord(y + reach, rows);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = r * cols + c;
      for (let k = cellStart[cell] as number; k < (cellStart[cell + 1] as number); k++) {
        const e = items[k] as Entity;
        if (edgeDistance(e, x, y) <= radius) fn(e);
      }
    }
  }
}

/** Nearest accepted entity by edge distance within `radius`; ties go to the lower id. */
export function findNearest(index: SpatialIndex, x: number, y: number, radius: number, accept: (e: Entity) => boolean): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  forEachInRadius(index, x, y, radius, (e) => {
    if (!accept(e)) return;
    const d = edgeDistance(e, x, y);
    if (d < bestD || (d === bestD && best !== null && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  });
  return best;
}
