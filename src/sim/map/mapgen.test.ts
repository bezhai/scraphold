import { describe, expect, it } from 'vitest';
import { MAP_GEN, TERRAIN, TERRAIN_LIST, type Terrain } from '../data/map';
import { hashValue } from '../hash';
import type { MapState } from '../state';
import { isRemote } from '../world/remote';
import { generateMap } from './mapgen';
import { createGame } from '../world/setup';
import { ensureNav } from '../nav/navGrid';

const SEEDS = Array.from({ length: 100 }, (_, i) => `map-check-${i}`);

function terrainOf(map: MapState, i: number): Terrain {
  return TERRAIN_LIST[map.terrain[i]!]!;
}

function count(map: MapState, t: Terrain): number {
  let n = 0;
  for (let i = 0; i < map.terrain.length; i++) if (terrainOf(map, i) === t) n++;
  return n;
}

function footprint(map: MapState, x: number, y: number, size: number): number[] {
  const out: number[] = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push((y + dy) * map.width + (x + dx));
  return out;
}

function ring(map: MapState, x: number, y: number, size: number): number[] {
  const out: number[] = [];
  for (let ty = y - 1; ty <= y + size; ty++)
    for (let tx = x - 1; tx <= x + size; tx++) {
      if (tx >= x && tx < x + size && ty >= y && ty < y + size) continue;
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      out.push(ty * map.width + tx);
    }
  return out;
}

/** Independent 4-connected BFS over passable terrain, treating structure tiles as walls. */
function reachableFrom(map: MapState, starts: number[], walls: Set<number>, distances?: Int32Array): Uint8Array {
  const seen = new Uint8Array(map.width * map.height);
  const queue: number[] = [];
  for (const s of starts) {
    if (!walls.has(s) && TERRAIN[terrainOf(map, s)].passable) {
      seen[s] = 1;
      if (distances) distances[s] = 0;
      queue.push(s);
    }
  }
  while (queue.length) {
    const i = queue.shift()!;
    const x = i % map.width;
    const y = (i - x) / map.width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const n = ny * map.width + nx;
      if (seen[n] || walls.has(n) || !TERRAIN[terrainOf(map, n)].passable) continue;
      seen[n] = 1;
      if (distances) distances[n] = distances[i]! + 1;
      queue.push(n);
    }
  }
  return seen;
}

describe('generateMap', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(hashValue(generateMap('same'))).toBe(hashValue(generateMap('same')));
    expect(hashValue(generateMap('same').map.terrain)).not.toBe(hashValue(generateMap('other').map.terrain));
  });

  it.each(SEEDS)('produces a valid, fully connected map for seed %s', (seed) => {
    const { map, nests } = generateMap(seed);
    expect(map.width).toBe(MAP_GEN.width);
    expect(map.height).toBe(MAP_GEN.height);
    expect(map.terrain).toHaveLength(map.width * map.height);

    // Resource tile counts within designed ranges.
    for (const t of ['fertile', 'wreckage', 'oil'] as const) {
      const [lo, hi] = MAP_GEN[t].total;
      const n = count(map, t);
      expect(n, `${t} count`).toBeGreaterThanOrEqual(lo);
      expect(n, `${t} count`).toBeLessThanOrEqual(hi);
    }
    const water = count(map, 'water');
    expect(water).toBeGreaterThanOrEqual(MAP_GEN.checks.water[0]);
    expect(water).toBeLessThanOrEqual(MAP_GEN.checks.water[1]);
    const blockers = count(map, 'rock') + count(map, 'wall');
    expect(blockers).toBeGreaterThanOrEqual(MAP_GEN.checks.blockers[0]);
    expect(blockers).toBeLessThanOrEqual(MAP_GEN.checks.blockers[1]);

    // Ruins: count in range, terrain matches, spaced apart.
    expect(map.ruins.filter(r => r.kind === 'ordinary').length).toBeGreaterThanOrEqual(MAP_GEN.ruins.count[0]);
    expect(map.ruins.filter(r => r.kind === 'ordinary').length).toBeLessThanOrEqual(MAP_GEN.ruins.count[1]);
    expect(count(map, 'ruin')).toBe(map.ruins.length);
    for (const r of map.ruins) {
      expect(terrainOf(map, r.tile)).toBe('ruin');
      expect(r.explored).toBe(false);
      expect(r.reward).toBeDefined();
    }

    expect(map.ruins.filter(r => r.kind === 'supplyPod')).toHaveLength(2);
    expect(map.ruins.filter(r => r.kind === 'warehouse')).toHaveLength(1);

    // Core: footprint and clear radius passable, near the map center.
    const core = map.coreTile;
    const ccx = core.x + MAP_GEN.coreSize / 2;
    const ccy = core.y + MAP_GEN.coreSize / 2;
    expect(Math.abs(ccx - map.width / 2)).toBeLessThanOrEqual(MAP_GEN.coreJitter.x + 1);
    expect(Math.abs(ccy - map.height / 2)).toBeLessThanOrEqual(MAP_GEN.coreJitter.y + 1);
    for (const i of footprint(map, core.x, core.y, MAP_GEN.coreSize)) expect(terrainOf(map, i)).toBe('wasteland');
    for (let i = 0; i < map.terrain.length; i++) {
      const x = (i % map.width) + 0.5;
      const y = Math.floor(i / map.width) + 0.5;
      if (Math.hypot(x - ccx, y - ccy) <= MAP_GEN.coreClearRadius) expect(TERRAIN[terrainOf(map, i)].passable).toBe(true);
    }

    // Nests: configured count plus exactly one hive, far from the core, footprints and rings passable, no overlaps.
    const normal = nests.filter((n) => !n.isHive);
    const hives = nests.filter((n) => n.isHive);
    expect(normal.length).toBeGreaterThanOrEqual(MAP_GEN.nests.count[0]);
    expect(normal.length).toBeLessThanOrEqual(MAP_GEN.nests.count[1]);
    expect(hives).toHaveLength(1);
    const walls = new Set<number>(footprint(map, core.x, core.y, MAP_GEN.coreSize));
    const structures: { x: number; y: number; size: number }[] = [{ x: core.x, y: core.y, size: MAP_GEN.coreSize }];
    for (const n of nests) {
      const size = n.isHive ? MAP_GEN.hive.size : MAP_GEN.nests.size;
      const d = Math.hypot(n.tileX + size / 2 - ccx, n.tileY + size / 2 - ccy);
      expect(d).toBeGreaterThanOrEqual(n.isHive ? MAP_GEN.hive.minCoreDistance : MAP_GEN.nests.minCoreDistance);
      for (const i of footprint(map, n.tileX, n.tileY, size)) {
        expect(TERRAIN[terrainOf(map, i)].passable).toBe(true);
        expect(walls.has(i), 'structures overlap').toBe(false);
        walls.add(i);
      }
      structures.push({ x: n.tileX, y: n.tileY, size });
    }
    for (const s of structures) for (const i of ring(map, s.x, s.y, s.size)) expect(walls.has(i)).toBe(false);

    // Connectivity: from the core ring every passable non-structure tile is reachable,
    // which covers every nest ring, ruin, resource tile and spawn point.
    const reach = reachableFrom(map, ring(map, core.x, core.y, MAP_GEN.coreSize), walls);
    for (let i = 0; i < map.terrain.length; i++) {
      if (walls.has(i) || !TERRAIN[terrainOf(map, i)].passable) continue;
      expect(reach[i], `tile ${i % map.width},${Math.floor(i / map.width)} unreachable`).toBe(1);
    }
    for (const r of map.ruins) {
      expect(reach[r.tile]).toBe(1);
      if (r.kind !== 'ordinary') expect(isRemote({ coreId: 0, entities: new Map([[0, { x: ccx, y: ccy }]]) }, { x: r.tile % map.width + 0.5, y: Math.floor(r.tile / map.width) + 0.5 })).toBe(true);
    }
    for (const n of nests) {
      const size = n.isHive ? MAP_GEN.hive.size : MAP_GEN.nests.size;
      expect(ring(map, n.tileX, n.tileY, size).some((i) => reach[i] === 1)).toBe(true);
    }

    // The relay occupies a reserved clear footprint, remains reachable and starts in fog.
    const relay = map.relaySite!;
    expect(relay).not.toBeNull();
    const relayDistance = Math.hypot(relay.tileX + relay.size / 2 - ccx, relay.tileY + relay.size / 2 - ccy);
    expect(relayDistance).toBeGreaterThanOrEqual(MAP_GEN.relay.minCoreDistance);
    expect(relayDistance).toBeLessThanOrEqual(MAP_GEN.relay.maxCoreDistance);
    for (const i of footprint(map, relay.tileX, relay.tileY, relay.size)) {
      expect(terrainOf(map, i)).toBe('wasteland');
      expect(walls.has(i)).toBe(false);
      expect(reach[i]).toBe(1);
    }
    const withRelay = new Set([...walls, ...footprint(map, relay.tileX, relay.tileY, relay.size)]);
    const afterTower = reachableFrom(map, ring(map, core.x, core.y, MAP_GEN.coreSize), withRelay);
    for (let i = 0; i < map.terrain.length; i++) {
      if (!withRelay.has(i) && TERRAIN[terrainOf(map, i)].passable) expect(afterTower[i]).toBe(1);
    }

    // Independently reproduce pre-nest walking distances and enumerate all legal hive sites.
    const reserved = new Set([...footprint(map, core.x, core.y, MAP_GEN.coreSize), ...footprint(map, relay.tileX, relay.tileY, relay.size)]);
    const distances = new Int32Array(map.terrain.length).fill(-1);
    reachableFrom(map, ring(map, core.x, core.y, MAP_GEN.coreSize), reserved, distances);
    let farthest = { x: -1, y: -1, d: -1 };
    const hs = MAP_GEN.hive.size;
    for (let y = 1; y < map.height - hs; y++) {
      for (let x = 1; x < map.width - hs; x++) {
        if (Math.hypot(x + hs / 2 - ccx, y + hs / 2 - ccy) < MAP_GEN.hive.minCoreDistance) continue;
        const inside = footprint(map, x, y, hs);
        if (!inside.every((i) => terrainOf(map, i) === 'wasteland' && !reserved.has(i))) continue;
        if (!ring(map, x, y, hs).every((i) => TERRAIN[terrainOf(map, i)].passable && !reserved.has(i))) continue;
        const d = distances[(y + 1) * map.width + x + 1]!;
        if (d > farthest.d) farthest = { x, y, d };
      }
    }
    expect(hives[0]).toMatchObject({ tileX: farthest.x, tileY: farthest.y });

    // The most revealing origin still leaves the relay hidden; real caches use actual dimensions.
    const game = createGame({ seed, origin: 'scholars', difficulty: 'normal' });
    for (const i of footprint(map, relay.tileX, relay.tileY, relay.size)) expect(game.state.fog[i]).toBe(0);
    const nav = ensureNav(game);
    expect(nav.blocked).toHaveLength(map.width * map.height);
    expect(nav.flowCost).toHaveLength(map.width * map.height);
    for (const spawn of map.spawnPoints) expect(nav.flowCost[spawn.tile]).toBeGreaterThan(0);

    // Near-core resource guarantees.
    for (const t of ['fertile', 'wreckage', 'oil'] as const) {
      const { minTiles, radius } = MAP_GEN[t].nearCore;
      let near = 0;
      for (let i = 0; i < map.terrain.length; i++) {
        if (terrainOf(map, i) !== t) continue;
        const x = (i % map.width) + 0.5;
        const y = Math.floor(i / map.width) + 0.5;
        if (Math.hypot(x - ccx, y - ccy) <= radius) near++;
      }
      expect(near, `${t} near core`).toBeGreaterThanOrEqual(minTiles);
    }

    // Spawn points: one per compass direction on the map border, reachable.
    expect(map.spawnPoints.map((s) => s.direction).sort()).toEqual(['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
    for (const s of map.spawnPoints) {
      const x = s.tile % map.width;
      const y = Math.floor(s.tile / map.width);
      expect(x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1).toBe(true);
      expect(reach[s.tile]).toBe(1);
    }
  });
});
