/**
 * Local best scores, one per difficulty, in localStorage under a versioned key. Anything that
 * does not parse into the expected shape is discarded (entry by entry, or the whole key).
 */
import { DIFFICULTY_IDS, type Difficulty } from '../../sim/data/combat';
import { ORIGIN_IDS, type OriginId } from '../../sim/data/economy';

export const BEST_SCORES_KEY = 'scraphold.bestScores.v1';

export interface BestScore {
  score: number;
  seed: string;
  origin: OriginId;
  /** Day on which the game was won (11 = survived all ten nights). */
  day: number;
  /** ISO timestamp. */
  at: string;
}

export type BestScores = Partial<Record<Difficulty, BestScore>>;

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEntry(v: unknown): BestScore | null {
  if (!isRecord(v)) return null;
  const { score, seed, origin, day, at } = v;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return null;
  if (typeof seed !== 'string' || typeof at !== 'string') return null;
  if (typeof origin !== 'string' || !(ORIGIN_IDS as readonly string[]).includes(origin)) return null;
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1) return null;
  return { score, seed, origin: origin as OriginId, day, at };
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseBestScores(raw: string | null): BestScores {
  if (raw === null) return {};
  const data = tryParse(raw);
  if (!isRecord(data)) return {};
  const out: BestScores = {};
  for (const d of DIFFICULTY_IDS) {
    const entry = parseEntry(data[d]);
    if (entry) out[d] = entry;
  }
  return out;
}

export function recordBestScore(scores: BestScores, difficulty: Difficulty, entry: BestScore): { scores: BestScores; improved: boolean } {
  const old = scores[difficulty];
  if (old && old.score >= entry.score) return { scores, improved: false };
  return { scores: { ...scores, [difficulty]: entry }, improved: true };
}

export function loadBestScores(storage: KeyValueStorage): BestScores {
  let raw: string | null;
  try {
    raw = storage.getItem(BEST_SCORES_KEY);
  } catch {
    return {};
  }
  const scores = parseBestScores(raw);
  if (raw !== null && Object.keys(scores).length === 0) {
    try {
      storage.removeItem(BEST_SCORES_KEY);
    } catch {
      // ignore: nothing else to do with unusable storage
    }
  }
  return scores;
}

export function saveBestScores(storage: KeyValueStorage, scores: BestScores): void {
  try {
    storage.setItem(BEST_SCORES_KEY, JSON.stringify(scores));
  } catch {
    // Storage full or disabled: the score just is not remembered.
  }
}
