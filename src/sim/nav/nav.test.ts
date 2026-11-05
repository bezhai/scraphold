import { describe, expect, it } from 'vitest';
import { NEIGHBORS_8, tileIndex, tileXOf, tileYOf } from '../map/grid';
import { makeRng, pick } from '../rng';
import { createTestGame } from '../testing';
import { addBuilding, removeEntity } from '../world/entities';
import { createGame } from '../world/setup';
import { MinHeap, TILE_KEY } from './heap';
import { ensureNav, type NavGrid } from './navGrid';
import { findPath } from './pathfind';

function followFlow(game: ReturnType<typeof createTestGame>, from: number, maxSteps = 500): number[] {
  const nav = ensureNav(game);
  const visited = [from];
  let t = from;
  for (let k = 0; k < maxSteps && nav.flowNext[t]! !== -1; k++) {
    t = nav.flowNext[t]!;
    visited.push(t);
  }
  return visited;
}

describe('navigation grid', () => {
  it('marks terrain blockers and structure footprints as blocked and records structure ids', () => {
    const game = createTestGame([
      '..#.......',
      '..........',
      '...CCC....',
      '...CCC....',
      '...CCC..NN',
      '........NN',
      '..........',
    ]);
    const nav = ensureNav(game);
    const m = game.state.map;
    expect(nav.blocked[tileIndex(m, 2, 0)]).toBe(1);
    expect(nav.blocked[tileIndex(m, 0, 0)]).toBe(0);
    expect(nav.structureAt[tileIndex(m, 4, 3)]).toBe(game.state.coreId);
    expect(nav.blocked[tileIndex(m, 8, 4)]).toBe(1);
  });

  it('rebuilds lazily when the nav version changes', () => {
    const game = createTestGame(['..........', '...CCC....', '...CCC....', '...CCC....', '..........']);
    const t = tileIndex(game.state.map, 8, 0);
    expect(ensureNav(game).blocked[t]).toBe(0);
    const b = addBuilding(game, 'barricade', 8, 0, { complete: true });
    expect(ensureNav(game).blocked[t]).toBe(1);
    expect(ensureNav(game).structureAt[t]).toBe(b.id);
    removeEntity(game, b);
    expect(ensureNav(game).blocked[t]).toBe(0);
  });

  it('gives two open tiles the same region exactly when a path connects them', () => {
    // A walled pocket at (2..3, 2), and (0, 6) only touches the rest diagonally past two blockers.
    const game = createTestGame([
      '..........',
      '.####.....',
      '.#..#.....',
      '.####.CCC.',
      '......CCC.',
      '#.....CCC.',
      '.#........',
    ]);
    const nav = ensureNav(game);
    const open: number[] = [];
    for (let i = 0; i < nav.blocked.length; i++) if (nav.blocked[i]) expect(nav.region[i]).toBe(-1);
    else open.push(i);
    const center = (t: number) => [(t % nav.width) + 0.5, Math.floor(t / nav.width) + 0.5] as const;
    for (const a of open) for (const b of open) expect(nav.region[a] === nav.region[b]).toBe(findPath(nav, ...center(a), ...center(b)).reached);
    expect(new Set(open.map((i) => nav.region[i])).size).toBe(3);
  });
});

describe('findPath', () => {
  const rows = [
    '..............',
    '..............',
    '.....#........',
    '.....#........',
    '.....#....CCC.',
    '.....#....CCC.',
    '.....#....CCC.',
    '..............',
  ];

  it('walks around a wall without cutting corners', () => {
    const game = createTestGame(rows);
    const m = game.state.map;
    const path = findPath(ensureNav(game), 1.5, 4.5, 8.5, 4.5);
    expect(path.reached).toBe(true);
    expect(path.tiles.at(-1)).toBe(tileIndex(m, 8, 4));
    const nav = ensureNav(game);
    let prev = tileIndex(m, 1, 4);
    for (const t of path.tiles) {
      expect(nav.blocked[t]).toBe(0);
      const dx = tileXOf(m, t) - tileXOf(m, prev);
      const dy = tileYOf(m, t) - tileYOf(m, prev);
      expect(Math.abs(dx) <= 1 && Math.abs(dy) <= 1).toBe(true);
      if (dx !== 0 && dy !== 0) {
        expect(nav.blocked[tileIndex(m, tileXOf(m, prev) + dx, tileYOf(m, prev))]).toBe(0);
        expect(nav.blocked[tileIndex(m, tileXOf(m, prev), tileYOf(m, prev) + dy)]).toBe(0);
      }
      prev = t;
    }
  });

  it('goes to the nearest reachable tile when the goal is blocked', () => {
    const game = createTestGame(rows);
    const m = game.state.map;
    // Goal inside the core footprint: stop next to it.
    const path = findPath(ensureNav(game), 1.5, 4.5, 11.5, 5.5);
    expect(path.reached).toBe(false);
    const last = path.tiles.at(-1)!;
    expect(tileXOf(m, last)).toBe(9);
  });

  it('returns an empty path when already on the goal tile', () => {
    const game = createTestGame(rows);
    expect(findPath(ensureNav(game), 1.5, 1.5, 1.2, 1.8)).toEqual({ tiles: [], reached: true });
  });

  it('finds the same paths as a plain search, query after query, also toward blocked goals', () => {
    for (const seed of ['nav-a', 'nav-b']) {
      const game = createGame({ seed, origin: 'scholars', difficulty: 'normal' });
      const nav = ensureNav(game);
      const open: number[] = [];
      for (let i = 0; i < nav.blocked.length; i++) if (!nav.blocked[i]) open.push(i);
      const structures = [...game.state.entities.values()].filter((e) => e.kind === 'nest' || e.kind === 'building');
      const rng = makeRng(5);
      const center = (t: number) => [(t % nav.width) + 0.5, Math.floor(t / nav.width) + 0.5] as const;
      for (let k = 0; k < 120; k++) {
        const [sx, sy] = center(pick(rng, open));
        const goal = k % 3 === 0 ? pick(rng, structures) : null;
        const [gx, gy] = goal ? [goal.x, goal.y] : center(pick(rng, open));
        expect(findPath(nav, sx, sy, gx, gy)).toEqual(plainSearch(nav, sx, sy, gx, gy));
      }
    }
  });
});

describe('flow field', () => {
  it('leads from every reachable tile to a tile next to the core', () => {
    const game = createTestGame([
      '....................',
      '....~~~~~~..........',
      '..........#.........',
      '..........#..CCC....',
      '..........#..CCC....',
      '..........#..CCC....',
      '....................',
    ]);
    const m = game.state.map;
    const nav = ensureNav(game);
    for (const start of [tileIndex(m, 0, 0), tileIndex(m, 0, 6), tileIndex(m, 19, 3)]) {
      const route = followFlow(game, start);
      const last = route.at(-1)!;
      expect(nav.structureAt[last], 'ends on the core').toBe(game.state.coreId);
      for (const t of route.slice(0, -1)) expect(nav.blocked[t]).toBe(0);
    }
  });

  it('detours around buildings while a path exists', () => {
    const game = createTestGame([
      '..........',
      '..........',
      '..........',
      '...CCC....',
      '...CCC....',
      '...CCC....',
      '..........',
    ]);
    for (let x = 2; x <= 6; x++) addBuilding(game, 'barricade', x, 2, { complete: true });
    const m = game.state.map;
    const route = followFlow(game, tileIndex(m, 4, 0));
    const nav = ensureNav(game);
    for (const t of route.slice(0, -1)) expect(nav.structureAt[t]).toBe(0);
  });

  it('routes through a barricade when the core is fully enclosed', () => {
    const game = createTestGame([
      '..........',
      '..........',
      '..........',
      '...CCC....',
      '...CCC....',
      '...CCC....',
      '..........',
      '..........',
    ]);
    const ids = new Set<number>();
    for (let x = 2; x <= 6; x++)
      for (let y = 2; y <= 6; y++) {
        if (x >= 3 && x <= 5 && y >= 3 && y <= 5) continue;
        ids.add(addBuilding(game, 'barricade', x, y, { complete: true }).id);
      }
    const m = game.state.map;
    const nav = ensureNav(game);
    const route = followFlow(game, tileIndex(m, 9, 0));
    expect(nav.structureAt[route.at(-1)!]).toBe(game.state.coreId);
    const crossed = route.filter((t) => ids.has(nav.structureAt[t]!));
    expect(crossed).toHaveLength(1);
  });

  it('never routes through nests', () => {
    const game = createTestGame([
      '..........',
      '...NN.....',
      '...NN.....',
      '..........',
      '...CCC....',
      '...CCC....',
      '...CCC....',
    ]);
    const nav = ensureNav(game);
    const m = game.state.map;
    for (let i = 0; i < m.width * m.height; i++) {
      if (nav.structureAt[i] && game.state.entities.get(nav.structureAt[i]!)!.kind === 'nest') {
        expect(nav.flowCost[i]).toBe(-1);
      }
    }
    const route = followFlow(game, tileIndex(m, 4, 0));
    expect(nav.structureAt[route.at(-1)!]).toBe(game.state.coreId);
  });
});

/** The straightforward A* (fresh buffers, explores until the goal or exhaustion): the oracle for findPath. */
function plainSearch(nav: NavGrid, sx: number, sy: number, gx: number, gy: number): { tiles: number[]; reached: boolean } {
  const { width, height, blocked } = nav;
  const clamp = (x: number, y: number) => Math.floor(Math.min(height - 0.001, Math.max(0, y))) * width + Math.floor(Math.min(width - 0.001, Math.max(0, x)));
  const octile = (a: number, b: number) => {
    const dx = Math.abs((a % width) - (b % width));
    const dy = Math.abs(Math.floor(a / width) - Math.floor(b / width));
    return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
  };
  const start = clamp(sx, sy);
  const goal = clamp(gx, gy);
  if (start === goal) return { tiles: [], reached: blocked[goal] === 0 };
  const g = new Int32Array(width * height).fill(-1);
  const parent = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(octile(start, goal) * TILE_KEY + start);
  let best = start;
  let bestH = octile(start, goal);
  let reached = false;
  while (heap.size > 0) {
    const cur = heap.pop() % TILE_KEY;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      reached = true;
      break;
    }
    const h = octile(cur, goal);
    if (h < bestH || (h === bestH && g[cur]! < g[best]!)) {
      best = cur;
      bestH = h;
    }
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const d of NEIGHBORS_8) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nb = ny * width + nx;
      if (blocked[nb] || closed[nb]) continue;
      if (d.dx !== 0 && d.dy !== 0 && (blocked[cy * width + nx] || blocked[ny * width + cx])) continue;
      const ng = g[cur]! + d.cost;
      if (g[nb] !== -1 && g[nb]! <= ng) continue;
      g[nb] = ng;
      parent[nb] = cur;
      heap.push((ng + octile(nb, goal)) * TILE_KEY + nb);
    }
  }
  const tiles: number[] = [];
  for (let t = reached ? goal : best; t !== start && t !== -1; t = parent[t]!) tiles.push(t);
  return { tiles: tiles.reverse(), reached };
}
