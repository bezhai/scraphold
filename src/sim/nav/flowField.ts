/**
 * Shared flow field toward the core, used by every assaulting mutant. Owner: Task 1.
 * Integer costs (10 orthogonal / 14 diagonal) keep it exactly deterministic.
 */
import { NEIGHBORS_8 } from '../map/grid';
import { MinHeap, TILE_KEY } from './heap';
import type { NavGrid } from './navGrid';
import { TILE_BUILDING, TILE_CORE, TILE_OPEN } from './tileClass';

/** Extra cost of stepping onto a player building tile: larger than any realistic detour. */
export const BUILDING_STEP_COST = 5000;

function walkable(cls: number): boolean {
  return cls === TILE_OPEN || cls === TILE_BUILDING;
}

export function computeFlowField(nav: NavGrid, targetId = 0, flowCost = nav.flowCost, flowNext = nav.flowNext): void {
  const { width, height, tileClass } = nav;
  flowCost.fill(-1);
  flowNext.fill(-1);
  const heap = new MinHeap();
  for (let i = 0; i < tileClass.length; i++) {
    if (targetId === 0 ? tileClass[i] === TILE_CORE : nav.structureAt[i] === targetId) {
      flowCost[i] = 0;
      heap.push(i);
    }
  }
  while (heap.size > 0) {
    const key = heap.pop();
    const cur = key % TILE_KEY;
    const cost = (key - cur) / TILE_KEY;
    if (cost !== flowCost[cur]) continue;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const d of NEIGHBORS_8) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      const cls = tileClass[n] as number;
      if (!walkable(cls)) continue;
      // No corner cutting: a diagonal step needs both orthogonal tiles open.
      if (d.dx !== 0 && d.dy !== 0) {
        if (tileClass[cy * width + nx] !== TILE_OPEN || tileClass[ny * width + cx] !== TILE_OPEN) continue;
      }
      const nc = cost + d.cost + (cls === TILE_BUILDING ? BUILDING_STEP_COST : 0);
      const old = flowCost[n] as number;
      if (old !== -1 && old <= nc) continue;
      flowCost[n] = nc;
      flowNext[n] = cur;
      heap.push(nc * TILE_KEY + n);
    }
  }
}
