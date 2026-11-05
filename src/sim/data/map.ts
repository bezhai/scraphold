/**
 * Terrain definitions and map generation parameters. Owner: Task 1 (map) / main session.
 * Terrain is stored in MapState.terrain as the numeric `code` (index into TERRAIN_LIST).
 */

export type Terrain = 'wasteland' | 'fertile' | 'wreckage' | 'oil' | 'water' | 'rock' | 'wall' | 'ruin';

export interface TerrainDef {
  code: number;
  name: string;
  passable: boolean;
  description: string;
}

export const TERRAIN_LIST: readonly Terrain[] = ['wasteland', 'fertile', 'wreckage', 'oil', 'water', 'rock', 'wall', 'ruin'];

export const TERRAIN: Record<Terrain, TerrainDef> = {
  wasteland: { code: 0, name: '荒地', passable: true, description: '可建造大多数建筑' },
  fertile: { code: 1, name: '沃土', passable: true, description: '可建造；温室建在沃土上有加成' },
  wreckage: { code: 2, name: '残骸', passable: true, description: '不可建造；拆解站相邻残骸越多产出越高' },
  oil: { code: 3, name: '油渍', passable: true, description: '只能建油井' },
  water: { code: 4, name: '水源', passable: false, description: '不可通行；给相邻温室加成' },
  rock: { code: 5, name: '岩石', passable: false, description: '不可通行，天然屏障' },
  wall: { code: 6, name: '断墙', passable: false, description: '不可通行，天然屏障' },
  ruin: { code: 7, name: '旧时代遗迹', passable: true, description: '单位到达后一次性给奖励；研究站挨着遗迹有加成' },
};

export function terrainFromCode(code: number): Terrain {
  const t = TERRAIN_LIST[code];
  if (t === undefined) throw new Error(`unknown terrain code ${code}`);
  return t;
}

/** Compass direction of an attack or spawn point as seen from the core. */
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export const DIRECTIONS: readonly Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const DIRECTION_NAMES: Record<Direction, string> = {
  N: '北',
  NE: '东北',
  E: '东',
  SE: '东南',
  S: '南',
  SW: '西南',
  W: '西',
  NW: '西北',
};

const DIAGONAL = Math.SQRT1_2;
/** Unit vector of each compass direction (y grows southward). */
export const DIRECTION_VECTORS: Record<Direction, { readonly x: number; readonly y: number }> = {
  N: { x: 0, y: -1 },
  NE: { x: DIAGONAL, y: -DIAGONAL },
  E: { x: 1, y: 0 },
  SE: { x: DIAGONAL, y: DIAGONAL },
  S: { x: 0, y: 1 },
  SW: { x: -DIAGONAL, y: DIAGONAL },
  W: { x: -1, y: 0 },
  NW: { x: -DIAGONAL, y: -DIAGONAL },
};

type Range = readonly [min: number, max: number];

export interface ResourcePatchConfig {
  /** Total tile count the generator aims for (inclusive range; enforced). */
  total: Range;
  patchSize: Range;
  /** At least `minTiles` of this terrain within `radius` tiles of the core center. */
  nearCore: { minTiles: number; radius: number };
}

export const MAP_GEN = {
  width: 96,
  height: 72,
  coreSize: 3,
  /** Max offset of the core center from the map center. */
  coreJitter: { x: 3, y: 2 },
  /** No impassable terrain within this radius of the core center. */
  coreClearRadius: 6,
  /** No resources within this radius of the core center (keeps building space next to the core). */
  coreFreeRadius: 3.5,
  lakes: { count: [5, 9] as Range, size: [6, 18] as Range },
  rocks: { count: [14, 23] as Range, size: [4, 14] as Range },
  walls: { count: [9, 16] as Range, length: [4, 10] as Range, gapChance: 0.2 },
  /** Disconnected passable pockets smaller than this are filled with rock; larger ones get a corridor. */
  pocketMinSize: 8,
  fertile: { total: [81, 144], patchSize: [5, 12], nearCore: { minTiles: 6, radius: 12 } } as ResourcePatchConfig,
  wreckage: { total: [63, 117], patchSize: [3, 8], nearCore: { minTiles: 6, radius: 12 } } as ResourcePatchConfig,
  oil: { total: [18, 36], patchSize: [2, 4], nearCore: { minTiles: 2, radius: 18 } } as ResourcePatchConfig,
  /** Probability that a fertile patch is seeded next to water. */
  fertileNearWaterChance: 0.6,
  ruins: { count: [12, 16] as Range, minSpacing: 6, minCoreDistance: 7 },
  nests: { count: [6, 9] as Range, size: 2, minCoreDistance: 22, minSpacing: 11 },
  relay: { size: 3, minCoreDistance: 20, maxCoreDistance: 28 },
  hive: { size: 3, minCoreDistance: 39 },
  /** Sanity ranges checked by tests (blockers are not enforced by the generator, only bounded). */
  checks: { water: [20, 200] as Range, blockers: [90, 630] as Range },
} as const;
