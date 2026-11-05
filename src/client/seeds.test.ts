import { describe, expect, it } from 'vitest';
import { MAX_SEED_LENGTH, dailySeed, normalizeSeedInput, randomSeed, seedForChoice } from './seeds';

describe('seeds', () => {
  it('daily seed is the local calendar date', () => {
    expect(dailySeed(new Date(2026, 9, 30, 23, 59))).toBe('2026-10-30');
    expect(dailySeed(new Date(2027, 0, 5))).toBe('2027-01-05');
  });

  it('random seed is a short code from the given random source', () => {
    const s = randomSeed(() => 0.5);
    expect(s).toMatch(/^[A-Z0-9]{6}$/);
    expect(randomSeed(() => 0.5)).toBe(s);
    expect(randomSeed(() => 0.1)).not.toBe(s);
  });

  it('custom seeds are trimmed and length-limited; empty means none', () => {
    expect(normalizeSeedInput('  废土 42 ')).toBe('废土 42');
    expect(normalizeSeedInput('   ')).toBeNull();
    expect(normalizeSeedInput('x'.repeat(100))).toHaveLength(MAX_SEED_LENGTH);
  });

  it('seedForChoice resolves each mode', () => {
    const now = new Date(2026, 9, 30);
    expect(seedForChoice({ mode: 'daily', custom: '' }, now, () => 0.5)).toBe('2026-10-30');
    expect(seedForChoice({ mode: 'custom', custom: ' my seed ' }, now, () => 0.5)).toBe('my seed');
    expect(seedForChoice({ mode: 'custom', custom: '' }, now, () => 0.5)).toBeNull();
    expect(seedForChoice({ mode: 'random', custom: 'ignored' }, now, () => 0.5)).toBe(randomSeed(() => 0.5));
  });
});
