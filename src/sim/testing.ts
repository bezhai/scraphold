/**
 * Hand-drawn games for unit tests (any task) and bot experiments. Owner: Task 1.
 *
 * Legend: '.' wasteland, 'f' fertile, 'w' wreckage, 'o' oil, '~' water, '#' rock, '=' wall,
 * 'r' ruin (reward: 50 scrap), 'C' the 3x3 core (required), 'N' a 2x2 nest, 'H' the 3x3 hive.
 * Structures sit on wasteland. Origin start bonuses are NOT applied (origin effects still count
 * in modifiers); add what a test needs with world/entities.ts primitives.
 */
import type { Difficulty } from './data/combat';
import type { OriginId } from './data/economy';
import { TERRAIN, type Terrain } from './data/map';
import { assembleGame, type Game } from './game';
import type { NestSite } from './map/mapgen';
import { FOG_EXPLORED, type MapState, type Ruin } from './state';
import { spawnSurvivor } from './world/entities';
import { placeCoreAndNests } from './world/setup';

const LEGEND: Record<string, Terrain> = {
  '.': 'wasteland',
  f: 'fertile',
  w: 'wreckage',
  o: 'oil',
  '~': 'water',
  '#': 'rock',
  '=': 'wall',
  r: 'ruin',
  C: 'wasteland',
  N: 'wasteland',
  H: 'wasteland',
};

export function mapFromRows(rows: readonly string[]): { map: MapState; nests: NestSite[] } {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const terrain = new Uint8Array(width * height);
  const ruins: Ruin[] = [];
  const claimed = new Uint8Array(width * height);
  const nests: NestSite[] = [];
  let core: { x: number; y: number } | null = null;
  for (let y = 0; y < height; y++) {
    const row = rows[y] as string;
    if (row.length !== width) throw new Error(`row ${y} has length ${row.length}, expected ${width}`);
    for (let x = 0; x < width; x++) {
      const ch = row[x] as string;
      const t = LEGEND[ch];
      if (!t) throw new Error(`unknown map character '${ch}'`);
      const i = y * width + x;
      terrain[i] = TERRAIN[t].code;
      if (ch === 'r') ruins.push({ kind: 'ordinary', id: ruins.length + 1, tile: i, reward: { kind: 'resource', resource: 'scrap', amount: 50 }, explored: false });
      if (ch === 'C' && !core) core = { x, y };
      if ((ch === 'N' || ch === 'H') && !claimed[i]) {
        const size = ch === 'H' ? 3 : 2;
        for (let dy = 0; dy < size; dy++)
          for (let dx = 0; dx < size; dx++) {
            if (rows[y + dy]?.[x + dx] !== ch) throw new Error(`${ch} at ${x},${y} must be a ${size}x${size} block`);
            claimed[(y + dy) * width + x + dx] = 1;
          }
        nests.push({ tileX: x, tileY: y, isHive: ch === 'H' });
      }
    }
  }
  if (!core) throw new Error('test map needs a 3x3 core (C)');
  return { map: { width, height, terrain, coreTile: core, ruins, spawnPoints: [], relaySite: null }, nests };
}

export interface TestGameOptions {
  seed?: string;
  origin?: OriginId;
  difficulty?: Difficulty;
  /** Survivors spawned around the core (default 0). */
  survivors?: number;
  /** Mark the whole map explored so placement and targeting checks pass (default true). */
  explored?: boolean;
}

export function createTestGame(rows: readonly string[], opts: TestGameOptions = {}): Game {
  const { map, nests } = mapFromRows(rows);
  const game = assembleGame({ seed: opts.seed ?? 'test', origin: opts.origin ?? 'scavengers', difficulty: opts.difficulty ?? 'normal' }, map);
  placeCoreAndNests(game, nests);
  if (opts.explored !== false) game.state.fog.fill(FOG_EXPLORED);
  const core = map.coreTile;
  for (let k = 0; k < (opts.survivors ?? 0); k++) spawnSurvivor(game, core.x - 0.5, core.y + 0.5 + (k % 3));
  return game;
}
