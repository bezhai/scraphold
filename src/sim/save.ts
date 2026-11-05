/** Versioned automatic saves. Only canonical state is stored, never caches or output events. */
import { TERRAIN_LIST } from './data/map';
import { gameFromState, type Game } from './game';
import { hashValue } from './hash';
import { ensureNav } from './nav/navGrid';
import type { Entity, GameState, MapState } from './state';
import { rebuildSpatialIndex } from './world/spatial';

/** Increment whenever the authoritative state or its interpretation changes incompatibly. */
export const SAVE_VERSION = 13;

type StoredState = Omit<GameState, 'map' | 'fog' | 'entities'> & {
  map: Omit<MapState, 'terrain'> & { terrain: number[] };
  fog: number[];
  entities: [number, Entity][];
};

interface SaveData {
  version: number;
  hash: string;
  state: StoredState;
}

/** JSON loses negative zero, which matters to the bit-exact state hash. */
function encodeNumber(_key: string, value: unknown): unknown {
  return typeof value === 'number' && Object.is(value, -0) ? { $number: '-0' } : value;
}

function decodeNumber(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && Object.keys(value).length === 1 && '$number' in value && value.$number === '-0') return -0;
  return value;
}

export function serializeGame(game: Pick<Game, 'state'>): string {
  const { state } = game;
  const data: SaveData = {
    version: SAVE_VERSION,
    hash: hashValue(state),
    state: { ...state, map: { ...state.map, terrain: Array.from(state.map.terrain) }, fog: Array.from(state.fog), entities: [...state.entities] },
  };
  return JSON.stringify(data, encodeNumber);
}

function bytes(value: unknown, length: number, max: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max);
}

/** Invalid, damaged or different-version saves are discarded; no migration or partial restore. */
export function restoreGame(text: string): Game | null {
  try {
    const data = JSON.parse(text, decodeNumber) as SaveData;
    if (!data || data.version !== SAVE_VERSION || typeof data.hash !== 'string' || !data.state) return null;
    const saved = data.state;
    const { width, height } = saved.map;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
    const length = width * height;
    if (!bytes(saved.map.terrain, length, TERRAIN_LIST.length - 1) || !bytes(saved.fog, length, 2) || !Array.isArray(saved.entities)) return null;
    if (!saved.calendar || !saved.incidents || !saved.signal || !saved.rng || !saved.outcome || !saved.stats) return null;
    let lastId = 0;
    for (const [id, entity] of saved.entities) {
      if (!Number.isInteger(id) || id <= lastId || entity.id !== id) return null;
      lastId = id;
    }
    const state: GameState = {
      ...saved, map: { ...saved.map, terrain: new Uint8Array(saved.map.terrain) },
      fog: new Uint8Array(saved.fog), entities: new Map(saved.entities),
    };
    if (hashValue(state) !== data.hash) return null;
    const game = gameFromState(state);
    ensureNav(game);
    rebuildSpatialIndex(game.spatial, state);
    return game;
  } catch {
    return null;
  }
}
