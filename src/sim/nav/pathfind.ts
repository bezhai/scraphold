/**
 * A* on the tile grid for individual units, plus line-of-sight smoothing. Owner: Task 1.
 * 8-directional with integer costs, no corner cutting; structures and impassable terrain block.
 * If the goal cannot be reached, the path ends at the explored tile closest to the goal (fewest
 * octile steps, then cheapest to reach).
 *
 * Performance: the search buffers of a grid are allocated once and reused (entries count only
 * where their stamp equals the current search's), and a search toward a blocked goal (a nest or a
 * building center) stops as soon as it has popped a tile as close to the goal as any open tile can
 * be. With a consistent heuristic that tile is the one the exhaustive search would end at, so the
 * result is the same; the search just no longer floods the whole map.
 */
import { NEIGHBORS_8, tileAtPoint } from '../map/grid';
import { MinHeap, TILE_KEY } from './heap';
import type { NavGrid } from './navGrid';

export interface PathResult {
  /** Tiles to walk through, excluding the start tile, ending at the goal (or closest) tile. */
  tiles: number[];
  /** False when the goal tile is blocked or unreachable. */
  reached: boolean;
}

function octile(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  const dx = Math.abs(ax - bx);
  const dy = Math.abs((a - ax) / width - (b - bx) / width);
  return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
}

function clampTile(nav: NavGrid, x: number, y: number): number {
  const cx = Math.min(nav.width - 0.001, Math.max(0, x));
  const cy = Math.min(nav.height - 0.001, Math.max(0, y));
  return tileAtPoint(nav, cx, cy);
}

/** Reusable buffers of one grid's searches; g, parent and closed count only where stamped. */
interface SearchScratch {
  stamp: number;
  seen: Uint32Array;
  g: Int32Array;
  parent: Int32Array;
  closed: Uint32Array;
  heap: MinHeap;
}

const scratchByGrid = new WeakMap<NavGrid, SearchScratch>();

function scratchFor(nav: NavGrid): SearchScratch {
  let s = scratchByGrid.get(nav);
  const n = nav.width * nav.height;
  if (!s || s.seen.length !== n) {
    s = { stamp: 0, seen: new Uint32Array(n), g: new Int32Array(n), parent: new Int32Array(n), closed: new Uint32Array(n), heap: new MinHeap() };
    scratchByGrid.set(nav, s);
  }
  if (s.stamp === 0xffffffff) {
    s.stamp = 0;
    s.seen.fill(0);
    s.closed.fill(0);
  }
  s.stamp++;
  s.heap.clear();
  return s;
}

/** The smallest octile distance from `goal` to any open tile (rings outward until none can be closer). */
function closestOpenH(nav: NavGrid, goal: number): number {
  const { width, height, blocked } = nav;
  const gx = goal % width;
  const gy = (goal - gx) / width;
  let best = Infinity;
  for (let r = 1; r < Math.max(width, height) && 10 * r < best; r++) {
    for (let y = gy - r; y <= gy + r; y++) {
      if (y < 0 || y >= height) continue;
      const edgeRow = y === gy - r || y === gy + r;
      for (let x = gx - r; x <= gx + r; x += edgeRow ? 1 : 2 * r) {
        if (x < 0 || x >= width || blocked[y * width + x]) continue;
        best = Math.min(best, octile(width, y * width + x, goal));
      }
    }
  }
  return best;
}

export function findPath(nav: NavGrid, sx: number, sy: number, gx: number, gy: number): PathResult {
  const { width, height, blocked } = nav;
  const start = clampTile(nav, sx, sy);
  const goal = clampTile(nav, gx, gy);
  if (start === goal) return { tiles: [], reached: blocked[goal] === 0 };

  const { stamp, seen, g, parent, closed, heap } = scratchFor(nav);
  const gOf = (i: number) => (seen[i] === stamp ? (g[i] as number) : -1);
  const floorH = blocked[goal] ? closestOpenH(nav, goal) : -1;
  seen[start] = stamp;
  g[start] = 0;
  parent[start] = -1;
  heap.push(octile(width, start, goal) * TILE_KEY + start);
  let best = start;
  let bestH = octile(width, start, goal);
  let reached = false;

  while (heap.size > 0) {
    const cur = heap.pop() % TILE_KEY;
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    if (cur === goal) {
      reached = true;
      break;
    }
    const h = octile(width, cur, goal);
    if (h < bestH || (h === bestH && gOf(cur) < gOf(best))) {
      best = cur;
      bestH = h;
    }
    // Later pops cost at least as much: nothing can be closer to a blocked goal than floorH.
    if (bestH <= floorH) break;
    const gCur = g[cur] as number;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const d of NEIGHBORS_8) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nb = ny * width + nx;
      if (blocked[nb] || closed[nb] === stamp) continue;
      if (d.dx !== 0 && d.dy !== 0 && (blocked[cy * width + nx] || blocked[ny * width + cx])) continue;
      const ng = gCur + d.cost;
      const old = gOf(nb);
      if (old !== -1 && old <= ng) continue;
      seen[nb] = stamp;
      g[nb] = ng;
      parent[nb] = cur;
      heap.push((ng + octile(width, nb, goal)) * TILE_KEY + nb);
    }
  }

  const end = reached ? goal : best;
  const tiles: number[] = [];
  for (let t = end; t !== start && t !== -1; t = parent[t] as number) tiles.push(t);
  tiles.reverse();
  return { tiles, reached };
}

/** True if a body of `radius` can move in a straight line between the points without touching a blocked tile. */
export function lineClear(nav: NavGrid, x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 0.2));
  for (let s = 0; s <= steps; s++) {
    const px = x0 + (dx * s) / steps;
    const py = y0 + (dy * s) / steps;
    for (const [ox, oy] of [
      [-radius, -radius],
      [radius, -radius],
      [-radius, radius],
      [radius, radius],
    ] as const) {
      const t = tileAtPoint(nav, px + ox, py + oy);
      if (t === -1 || nav.blocked[t]) return false;
    }
  }
  return true;
}

/** Drops waypoints that can be skipped in a straight line (string pulling). */
export function smoothPath(nav: NavGrid, sx: number, sy: number, tiles: readonly number[], radius: number): number[] {
  const out: number[] = [];
  let fromX = sx;
  let fromY = sy;
  let i = 0;
  while (i < tiles.length) {
    let far = i;
    for (let k = tiles.length - 1; k > i; k--) {
      const t = tiles[k] as number;
      if (lineClear(nav, fromX, fromY, (t % nav.width) + 0.5, Math.floor(t / nav.width) + 0.5, radius)) {
        far = k;
        break;
      }
    }
    const t = tiles[far] as number;
    out.push(t);
    fromX = (t % nav.width) + 0.5;
    fromY = Math.floor(t / nav.width) + 0.5;
    i = far + 1;
  }
  return out;
}
