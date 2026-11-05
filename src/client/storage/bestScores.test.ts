import { describe, expect, it } from 'vitest';
import { BEST_SCORES_KEY, loadBestScores, parseBestScores, recordBestScore, saveBestScores, type BestScore } from './bestScores';

const entry = (score: number): BestScore => ({ score, seed: 'abc', origin: 'militia', day: 11, at: '2026-10-30T10:00:00.000Z' });

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('parseBestScores', () => {
  it('returns no scores for missing, non-JSON or non-object data', () => {
    expect(parseBestScores(null)).toEqual({});
    expect(parseBestScores('{oops')).toEqual({});
    expect(parseBestScores('[1,2]')).toEqual({});
    expect(parseBestScores('42')).toEqual({});
    expect(parseBestScores('null')).toEqual({});
  });

  it('keeps valid entries per difficulty and drops malformed ones', () => {
    const raw = JSON.stringify({
      easy: entry(500),
      normal: { ...entry(900), score: 'lots' },
      hard: { ...entry(1200), origin: 'aliens' },
      nightmare: entry(3000),
    });
    expect(parseBestScores(raw)).toEqual({ easy: entry(500) });
  });

  it('rejects negative, non-finite and fractional garbage', () => {
    expect(parseBestScores(JSON.stringify({ easy: { ...entry(-5) } }))).toEqual({});
    expect(parseBestScores(JSON.stringify({ easy: { ...entry(1), day: 'x' } }))).toEqual({});
    expect(parseBestScores(JSON.stringify({ easy: { ...entry(1), seed: 7 } }))).toEqual({});
  });
});

describe('recordBestScore', () => {
  it('sets the first score and only replaces it with a higher one', () => {
    const first = recordBestScore({}, 'normal', entry(800));
    expect(first).toEqual({ scores: { normal: entry(800) }, improved: true });
    expect(recordBestScore(first.scores, 'normal', entry(700))).toEqual({ scores: first.scores, improved: false });
    expect(recordBestScore(first.scores, 'normal', entry(900)).scores.normal?.score).toBe(900);
    expect(recordBestScore(first.scores, 'hard', entry(100)).scores).toEqual({ normal: entry(800), hard: entry(100) });
  });
});

describe('load/save', () => {
  it('uses a versioned key and round-trips', () => {
    expect(BEST_SCORES_KEY).toMatch(/v\d+$/);
    const storage = memoryStorage();
    saveBestScores(storage, { hard: entry(1500) });
    expect(loadBestScores(storage)).toEqual({ hard: entry(1500) });
  });

  it('discards malformed stored data', () => {
    const storage = memoryStorage({ [BEST_SCORES_KEY]: '{broken' });
    expect(loadBestScores(storage)).toEqual({});
    expect(storage.data.has(BEST_SCORES_KEY)).toBe(false);
  });

  it('survives storage that throws (private mode, quota)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(loadBestScores(throwing)).toEqual({});
    expect(() => saveBestScores(throwing, { easy: entry(1) })).not.toThrow();
  });
});
