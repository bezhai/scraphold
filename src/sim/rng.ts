/**
 * Seeded pseudo-random numbers (mulberry32). The only randomness source the simulation may use.
 *
 * A generator is a plain `{ s }` object so it can live inside GameState, be hashed and cloned.
 * Each concern draws from its own named stream, all derived from the game seed, so that e.g.
 * changing combat code (which consumes `combat`) never shifts night composition (`night`).
 * Map generation uses a private generator derived from the seed, so the map depends only on the seed.
 */

export interface Rng {
  /** Internal 32-bit state. */
  s: number;
}

/** Named streams stored in GameState.rng; v2 calendar and incidents draw independently. */
export type RngStream = 'night' | 'combat' | 'ai' | 'economy' | 'calendar' | 'incidents';
export type RngStreams = Record<RngStream, Rng>;

export const RNG_STREAMS: readonly RngStream[] = ['night', 'combat', 'ai', 'economy', 'calendar', 'incidents'];

/** FNV-1a over UTF-16 code units followed by a murmur3 finalizer. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  return { s: seed | 0 };
}

/** Generator for a labelled purpose derived from the game seed (e.g. 'map', 'night'). */
export function rngFor(seed: string, label: string): Rng {
  return makeRng(seedFromString(`${seed}#${label}`));
}

export function createRngStreams(seed: string): RngStreams {
  return {
    calendar: rngFor(seed, 'calendar'),
    incidents: rngFor(seed, 'incidents'),
    night: rngFor(seed, 'night'),
    combat: rngFor(seed, 'combat'),
    ai: rngFor(seed, 'ai'),
    economy: rngFor(seed, 'economy'),
  };
}

export function nextU32(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: Rng): number {
  return nextU32(rng) / 4294967296;
}

/** Uniform integer in [min, max] (inclusive). */
export function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

/** Uniform float in [min, max). */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

export function chance(rng: Rng, probability: number): boolean {
  return nextFloat(rng) < probability;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[Math.floor(nextFloat(rng) * items.length)] as T;
}

/** Picks by non-negative weight; items with weight 0 are never chosen. */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) throw new Error('pickWeighted: all weights are zero');
  let roll = nextFloat(rng) * total;
  for (const item of items) {
    const w = Math.max(0, weight(item));
    if (w === 0) continue;
    if (roll < w) return item;
    roll -= w;
  }
  // Floating point leftovers: return the last item with positive weight.
  for (let i = items.length - 1; i >= 0; i--) if (weight(items[i] as T) > 0) return items[i] as T;
  throw new Error('unreachable');
}

/** Fisher-Yates in place; returns the same array. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
