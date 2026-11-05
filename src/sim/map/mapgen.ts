import { SPECIAL_RUINS } from '../data/ruins';
import { isRemote } from '../world/remote';
/**
 * Map generation from a seed. Owner: Task 1.
 *
 * Steps: core near the center -> impassable blockers (lakes, rock blobs, broken walls) kept out of
 * the core area -> connectivity repair (small pockets filled, large ones get a carved corridor) ->
 * reserved relay site -> resource patches (fertile, wreckage, oil) with near-core guarantees and enforced totals -> ruins
 * -> hive (farthest by walking distance) and 6-9 nests far from the core -> one edge spawn point
 * per compass direction.
 *
 * Every structure footprint is surrounded by a passable one-tile ring, so placing it can never
 * disconnect the map: every passable tile stays reachable from the core.
 * Uses only its own RNG derived from the seed, so the map depends on nothing but the seed.
 */
import { RUIN_REWARD_TABLE, type RuinReward } from '../data/economy';
import { DIRECTIONS, MAP_GEN, TERRAIN, type Direction, type ResourcePatchConfig, type Terrain } from '../data/map';
import { chance, nextFloat, nextInt, pick, pickWeighted, rngFor, shuffle, type Rng } from '../rng';
import type { MapState, RelaySite, Ruin, SpawnPoint } from '../state';
import { NEIGHBORS_4, PASSABLE_BY_CODE, inBounds } from './grid';

export interface NestSite {
  tileX: number;
  tileY: number;
  isHive: boolean;
}

export interface GeneratedMap {
  map: MapState;
  nests: NestSite[];
}

const CODE = (t: Terrain): number => TERRAIN[t].code;

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
const WASTELAND = CODE('wasteland');

class Generator {
  readonly width = MAP_GEN.width;
  readonly height = MAP_GEN.height;
  readonly w = MAP_GEN.width;
  readonly h = MAP_GEN.height;
  readonly terrain = new Uint8Array(MAP_GEN.width * MAP_GEN.height);
  /** Tiles reserved for structures (core, relay, nests, hive). */
  readonly structure = new Uint8Array(MAP_GEN.width * MAP_GEN.height);
  readonly coreTile: { x: number; y: number };
  readonly ccx: number;
  readonly ccy: number;

  readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
    const cx = Math.floor(this.w / 2) + nextInt(rng, -MAP_GEN.coreJitter.x, MAP_GEN.coreJitter.x);
    const cy = Math.floor(this.h / 2) + nextInt(rng, -MAP_GEN.coreJitter.y, MAP_GEN.coreJitter.y);
    const half = Math.floor(MAP_GEN.coreSize / 2);
    this.coreTile = { x: cx - half, y: cy - half };
    this.ccx = this.coreTile.x + MAP_GEN.coreSize / 2;
    this.ccy = this.coreTile.y + MAP_GEN.coreSize / 2;
    this.markStructure(this.coreTile.x, this.coreTile.y, MAP_GEN.coreSize);
  }

  x(i: number): number {
    return i % this.w;
  }

  y(i: number): number {
    return Math.floor(i / this.w);
  }

  coreDistance(i: number): number {
    const dx = this.x(i) + 0.5 - this.ccx;
    const dy = this.y(i) + 0.5 - this.ccy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  passable(i: number): boolean {
    return PASSABLE_BY_CODE[this.terrain[i] as number] === true;
  }

  isTerrain(i: number, t: Terrain): boolean {
    return this.terrain[i] === CODE(t);
  }

  count(t: Terrain): number {
    let n = 0;
    for (let i = 0; i < this.terrain.length; i++) if (this.terrain[i] === CODE(t)) n++;
    return n;
  }

  allTiles(predicate: (i: number) => boolean): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.terrain.length; i++) if (predicate(i)) out.push(i);
    return out;
  }

  neighbors4(i: number, fn: (n: number) => void): void {
    const x = this.x(i);
    const y = this.y(i);
    for (const d of NEIGHBORS_4) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (inBounds(this, nx, ny)) fn(ny * this.w + nx);
    }
  }

  markStructure(tx: number, ty: number, size: number): void {
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) this.structure[y * this.w + x] = 1;
  }

  /** Grows a random 4-connected blob of `code` from `start` over tiles accepted by canUse. Returns tiles set. */
  blob(start: number, size: number, code: number, canUse: (i: number) => boolean): number {
    if (!canUse(start)) return 0;
    const inBlob = new Uint8Array(this.terrain.length);
    const frontier: number[] = [start];
    let placed = 0;
    while (placed < size && frontier.length > 0) {
      const k = Math.floor(nextFloat(this.rng) * frontier.length);
      const i = frontier[k] as number;
      frontier[k] = frontier[frontier.length - 1] as number;
      frontier.pop();
      if (inBlob[i] || !canUse(i)) continue;
      inBlob[i] = 1;
      this.terrain[i] = code;
      placed++;
      this.neighbors4(i, (n) => {
        if (!inBlob[n]) frontier.push(n);
      });
    }
    return placed;
  }

  /** 4-connected BFS over passable, non-structure tiles. Returns walking distance per tile (-1 = unreachable). */
  distancesFromCore(): Int32Array {
    const dist = new Int32Array(this.terrain.length).fill(-1);
    const queue: number[] = [];
    const t = this.coreTile;
    for (let y = t.y - 1; y <= t.y + MAP_GEN.coreSize; y++) {
      for (let x = t.x - 1; x <= t.x + MAP_GEN.coreSize; x++) {
        if (!inBounds(this, x, y)) continue;
        const i = y * this.w + x;
        if (this.structure[i] || !this.passable(i)) continue;
        dist[i] = 0;
        queue.push(i);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head] as number;
      const d = (dist[i] as number) + 1;
      this.neighbors4(i, (n) => {
        if (dist[n] !== -1 || this.structure[n] || !this.passable(n)) return;
        dist[n] = d;
        queue.push(n);
      });
    }
    return dist;
  }
}

// -----------------------------------------------------------------------------------------------

function placeBlockers(g: Generator): void {
  const keepClear = (i: number): boolean => g.coreDistance(i) <= MAP_GEN.coreClearRadius + 0.75;
  const free = (i: number): boolean => g.isTerrain(i, 'wasteland') && !keepClear(i);
  const interior = (i: number): boolean => g.x(i) >= 2 && g.y(i) >= 2 && g.x(i) < g.w - 2 && g.y(i) < g.h - 2;

  const lakes = nextInt(g.rng, MAP_GEN.lakes.count[0], MAP_GEN.lakes.count[1]);
  for (let n = 0, attempts = 0; n < lakes && attempts < 40; attempts++) {
    const start = pick(g.rng, g.allTiles((i) => free(i) && interior(i)));
    const size = nextInt(g.rng, MAP_GEN.lakes.size[0], MAP_GEN.lakes.size[1]);
    if (g.blob(start, size, CODE('water'), free) > 0) n++;
  }

  const rocks = nextInt(g.rng, MAP_GEN.rocks.count[0], MAP_GEN.rocks.count[1]);
  for (let n = 0; n < rocks; n++) {
    const start = pick(g.rng, g.allTiles(free));
    g.blob(start, nextInt(g.rng, MAP_GEN.rocks.size[0], MAP_GEN.rocks.size[1]), CODE('rock'), free);
  }

  const walls = nextInt(g.rng, MAP_GEN.walls.count[0], MAP_GEN.walls.count[1]);
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const;
  for (let n = 0; n < walls; n++) {
    const start = pick(g.rng, g.allTiles(free));
    const [dx, dy] = pick(g.rng, dirs);
    const length = nextInt(g.rng, MAP_GEN.walls.length[0], MAP_GEN.walls.length[1]);
    let x = g.x(start);
    let y = g.y(start);
    for (let k = 0; k < length; k++, x += dx, y += dy) {
      if (!inBounds(g, x, y)) break;
      const i = y * g.w + x;
      if (keepClear(i)) break;
      if (chance(g.rng, MAP_GEN.walls.gapChance)) continue;
      if (g.isTerrain(i, 'wasteland')) g.terrain[i] = CODE('wall');
    }
  }
}

/** Makes every passable tile reachable from the core: fills small pockets, carves corridors to large ones. */
function repairConnectivity(g: Generator): void {
  for (let iteration = 0; iteration < 64; iteration++) {
    const dist = g.distancesFromCore();
    const pocketStart = g.allTiles((i) => g.passable(i) && !g.structure[i] && dist[i] === -1)[0];
    if (pocketStart === undefined) return;

    // Collect the pocket.
    const pocket: number[] = [pocketStart];
    const inPocket = new Uint8Array(g.terrain.length);
    inPocket[pocketStart] = 1;
    for (let head = 0; head < pocket.length; head++) {
      g.neighbors4(pocket[head] as number, (n) => {
        if (inPocket[n] || !g.passable(n) || g.structure[n]) return;
        inPocket[n] = 1;
        pocket.push(n);
      });
    }

    if (pocket.length < MAP_GEN.pocketMinSize) {
      for (const i of pocket) g.terrain[i] = CODE('rock');
      continue;
    }

    // 0-1 BFS (bucket queue) from the pocket: crossing a blocker costs 1, passable costs 0.
    // Stops at the first tile of the reachable region and carves the blockers on the way.
    const cost = new Int32Array(g.terrain.length).fill(-1);
    const parent = new Int32Array(g.terrain.length).fill(-1);
    const buckets: number[][] = [[...pocket]];
    for (const i of pocket) cost[i] = 0;
    let target = -1;
    for (let c = 0; c < buckets.length && target === -1; c++) {
      const bucket = buckets[c] as number[];
      for (let k = 0; k < bucket.length && target === -1; k++) {
        const i = bucket[k] as number;
        if (cost[i] !== c) continue;
        if ((dist[i] as number) >= 0) {
          target = i;
          break;
        }
        g.neighbors4(i, (n) => {
          if (g.structure[n]) return;
          const nc = c + (g.passable(n) ? 0 : 1);
          if (cost[n] !== -1 && (cost[n] as number) <= nc) return;
          cost[n] = nc;
          parent[n] = i;
          (buckets[nc] ??= []).push(n);
        });
      }
    }
    if (target === -1) {
      for (const i of pocket) g.terrain[i] = CODE('rock');
      continue;
    }
    for (let i = target; i !== -1 && !inPocket[i]; i = parent[i] as number) {
      if (!g.passable(i)) g.terrain[i] = WASTELAND;
    }
  }
  throw new Error('mapgen: connectivity repair did not converge');
}

function placeResource(g: Generator, terrain: Terrain, cfg: ResourcePatchConfig, startBias: (i: number) => boolean): void {
  const code = CODE(terrain);
  const target = nextInt(g.rng, cfg.total[0], cfg.total[1]);
  const usable = (i: number): boolean => g.isTerrain(i, 'wasteland') && !g.structure[i] && g.coreDistance(i) > MAP_GEN.coreFreeRadius;
  let placed = 0;
  const patch = (): number => Math.min(nextInt(g.rng, cfg.patchSize[0], cfg.patchSize[1]), target - placed);

  // Near-core guarantee first.
  const nearOk = (i: number): boolean => usable(i) && g.coreDistance(i) <= cfg.nearCore.radius;
  let near = 0;
  for (let attempts = 0; near < cfg.nearCore.minTiles && placed < target && attempts < 20; attempts++) {
    const starts = g.allTiles(nearOk);
    if (starts.length === 0) break;
    const n = g.blob(pick(g.rng, starts), patch(), code, nearOk);
    near += n;
    placed += n;
  }

  // Remaining patches anywhere, optionally biased (fertile next to water).
  for (let attempts = 0; placed < target && attempts < 60; attempts++) {
    const biased = g.allTiles((i) => usable(i) && startBias(i));
    const starts = biased.length > 0 && chance(g.rng, MAP_GEN.fertileNearWaterChance) ? biased : g.allTiles(usable);
    if (starts.length === 0) break;
    placed += g.blob(pick(g.rng, starts), patch(), code, usable);
  }

  // Fallback: grow existing patches one tile at a time so the total always reaches the target.
  while (placed < target) {
    const edge = g.allTiles((i) => {
      if (!usable(i)) return false;
      let touches = false;
      g.neighbors4(i, (n) => {
        if (g.terrain[n] === code) touches = true;
      });
      return touches;
    });
    const candidates = edge.length > 0 ? edge : g.allTiles(usable);
    if (candidates.length === 0) throw new Error(`mapgen: no room for ${terrain}`);
    g.terrain[pick(g.rng, candidates)] = code;
    placed++;
  }
}

function placeRuins(g: Generator): Ruin[] {
  const want = nextInt(g.rng, MAP_GEN.ruins.count[0], MAP_GEN.ruins.count[1]);
  const candidates = shuffle(
    g.rng,
    g.allTiles((i) => g.isTerrain(i, 'wasteland') && !g.structure[i] && g.coreDistance(i) >= MAP_GEN.ruins.minCoreDistance && g.x(i) > 0 && g.y(i) > 0 && g.x(i) < g.w - 1 && g.y(i) < g.h - 1),
  );
  const chosen: number[] = [];
  for (let spacing = MAP_GEN.ruins.minSpacing; spacing >= 2 && chosen.length < want; spacing--) {
    for (const i of candidates) {
      if (chosen.length >= want) break;
      if (chosen.includes(i)) continue;
      if (chosen.every((c) => distance(g.x(c), g.y(c), g.x(i), g.y(i)) >= spacing)) chosen.push(i);
    }
  }
  return chosen.map((tile, id) => {
    g.terrain[tile] = CODE('ruin');
    const reward: RuinReward = { ...pickWeighted(g.rng, RUIN_REWARD_TABLE, (r) => r.weight).reward };
    return { id: id + 1, kind: 'ordinary', tile, reward, explored: false };
  });
}

/** Added after structures so remote candidates are reachable in the completed map. */
function placeSpecialRuins(g: Generator, ruins: Ruin[]): void {
  const reach = g.distancesFromCore();
  const core = { coreId: 0, entities: new Map([[0, { x: g.ccx, y: g.ccy }]]) };
  const candidates = shuffle(g.rng, g.allTiles(i =>
    g.isTerrain(i, 'wasteland') && !g.structure[i] && reach[i]! >= 0 &&
    g.x(i) > 0 && g.y(i) > 0 && g.x(i) < g.w - 1 && g.y(i) < g.h - 1 &&
    isRemote(core, { x: g.x(i) + 0.5, y: g.y(i) + 0.5 })
  ));
  for (const def of Object.values(SPECIAL_RUINS)) for (let n = 0; n < def.count; n++) {
    const tile = candidates.find(i => g.isTerrain(i, 'wasteland') && ruins.every(r => distance(g.x(r.tile), g.y(r.tile), g.x(i), g.y(i)) >= MAP_GEN.ruins.minSpacing));
    if (tile === undefined) throw new Error('mapgen: no reachable remote special ruin site');
    g.terrain[tile] = CODE('ruin');
    ruins.push({ id: ruins.length + 1, kind: def.kind, tile, explored: false,
      reward: def.reward.kind === 'resources' ? { ...def.reward, amounts: { ...def.reward.amounts } } : { ...def.reward } });
  }
}

function siteFits(g: Generator, tx: number, ty: number, size: number): boolean {
  if (tx < 1 || ty < 1 || tx + size > g.w - 1 || ty + size > g.h - 1) return false;
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      const i = y * g.w + x;
      if (g.structure[i] || !g.passable(i)) return false;
      const inside = x >= tx && x < tx + size && y >= ty && y < ty + size;
      if (inside && !g.isTerrain(i, 'wasteland')) return false;
    }
  }
  return true;
}

function placeRelay(g: Generator): RelaySite {
  const { size, minCoreDistance, maxCoreDistance } = MAP_GEN.relay;
  const candidates: RelaySite[] = [];
  for (let tileY = 1; tileY < g.h - size; tileY++) {
    for (let tileX = 1; tileX < g.w - size; tileX++) {
      const d = distance(tileX + size / 2, tileY + size / 2, g.ccx, g.ccy);
      if (d < minCoreDistance || d > maxCoreDistance || !siteFits(g, tileX, tileY, size)) continue;
      candidates.push({ tileX, tileY, size });
    }
  }
  if (candidates.length === 0) throw new Error('mapgen: no relay site');
  const site = pick(g.rng, candidates);
  g.markStructure(site.tileX, site.tileY, site.size);
  return site;
}

function placeNests(g: Generator): NestSite[] {
  const dist = g.distancesFromCore();
  const centerDistance = (tx: number, ty: number, size: number): number => distance(tx + size / 2, ty + size / 2, g.ccx, g.ccy);

  // Hive: maximum walking distance; ties resolve by row, then column.
  const hs = MAP_GEN.hive.size;
  const hiveSites: { tx: number; ty: number; d: number }[] = [];
  for (let ty = 0; ty < g.h; ty++) {
    for (let tx = 0; tx < g.w; tx++) {
      if (!siteFits(g, tx, ty, hs) || centerDistance(tx, ty, hs) < MAP_GEN.hive.minCoreDistance) continue;
      const d = dist[(ty + 1) * g.w + tx + 1] as number;
      if (d >= 0) hiveSites.push({ tx, ty, d });
    }
  }
  if (hiveSites.length === 0) throw new Error('mapgen: no site for the hive');
  hiveSites.sort((a, b) => b.d - a.d || a.ty - b.ty || a.tx - b.tx);
  const hive = hiveSites[0]!;
  g.markStructure(hive.tx, hive.ty, hs);
  const sites: NestSite[] = [{ tileX: hive.tx, tileY: hive.ty, isHive: true }];

  const ns = MAP_GEN.nests.size;
  const want = nextInt(g.rng, MAP_GEN.nests.count[0], MAP_GEN.nests.count[1]);
  const candidates: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < g.h; ty++) {
    for (let tx = 0; tx < g.w; tx++) {
      if (centerDistance(tx, ty, ns) >= MAP_GEN.nests.minCoreDistance) candidates.push({ tx, ty });
    }
  }
  shuffle(g.rng, candidates);
  const center = (s: NestSite): { x: number; y: number } => {
    const size = s.isHive ? hs : ns;
    return { x: s.tileX + size / 2, y: s.tileY + size / 2 };
  };
  for (let spacing = MAP_GEN.nests.minSpacing; spacing >= 6 && sites.length - 1 < want; spacing -= 2) {
    for (const c of candidates) {
      if (sites.length - 1 >= want) break;
      if (!siteFits(g, c.tx, c.ty, ns)) continue;
      const cx = c.tx + ns / 2;
      const cy = c.ty + ns / 2;
      if (!sites.every((s) => distance(center(s).x, center(s).y, cx, cy) >= spacing)) continue;
      g.markStructure(c.tx, c.ty, ns);
      sites.push({ tileX: c.tx, tileY: c.ty, isHive: false });
    }
  }
  if (sites.length - 1 < MAP_GEN.nests.count[0]) throw new Error('mapgen: not enough nest sites');
  return sites;
}

const DIRECTION_VECTORS: Record<Direction, readonly [number, number]> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

function placeSpawnPoints(g: Generator): SpawnPoint[] {
  const dist = g.distancesFromCore();
  const border = g.allTiles((i) => dist[i]! >= 0 && (g.x(i) === 0 || g.y(i) === 0 || g.x(i) === g.w - 1 || g.y(i) === g.h - 1));
  if (border.length === 0) throw new Error('mapgen: no reachable border tile');
  return DIRECTIONS.map((direction) => {
    const [dx, dy] = DIRECTION_VECTORS[direction];
    // Walk from the core center in this direction until leaving the map: that is the ideal point.
    let px = g.ccx;
    let py = g.ccy;
    while (px + dx >= 0 && px + dx <= g.w && py + dy >= 0 && py + dy <= g.h) {
      px += dx;
      py += dy;
    }
    let best = border[0] as number;
    let bestD = Infinity;
    for (const i of border) {
      const ex = g.x(i) + 0.5 - px;
      const ey = g.y(i) + 0.5 - py;
      const d = ex * ex + ey * ey;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { direction, tile: best };
  });
}

export function generateMap(seed: string): GeneratedMap {
  const g = new Generator(rngFor(seed, 'map'));
  placeBlockers(g);
  repairConnectivity(g);
  const relaySite = placeRelay(g);
  const nextToWater = (i: number): boolean => {
    let touches = false;
    g.neighbors4(i, (n) => {
      if (g.isTerrain(n, 'water')) touches = true;
    });
    return touches;
  };
  placeResource(g, 'fertile', MAP_GEN.fertile, nextToWater);
  placeResource(g, 'wreckage', MAP_GEN.wreckage, () => false);
  placeResource(g, 'oil', MAP_GEN.oil, () => false);
  const ruins = placeRuins(g);
  const nests = placeNests(g);
  const spawnPoints = placeSpawnPoints(g);
  placeSpecialRuins(g, ruins);
  return {
    map: { width: g.w, height: g.h, terrain: g.terrain, coreTile: { ...g.coreTile }, ruins, spawnPoints, relaySite },
    nests,
  };
}
