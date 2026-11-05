import { describe, expect, it } from 'vitest';
import { createRngStreams, makeRng, nextFloat, nextInt, pickWeighted, seedFromString, shuffle } from './rng';

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = makeRng(seedFromString('alpha'));
    const b = makeRng(seedFromString('alpha'));
    const seqA = Array.from({ length: 20 }, () => nextFloat(a));
    const seqB = Array.from({ length: 20 }, () => nextFloat(b));
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(seedFromString('alpha'));
    const b = makeRng(seedFromString('beta'));
    expect(nextFloat(a)).not.toEqual(nextFloat(b));
  });

  it('keeps floats in [0, 1) and ints within inclusive bounds', () => {
    const r = makeRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const f = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = nextInt(r, 3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('gives each named stream an independent sequence derived from the seed', () => {
    const s1 = createRngStreams('seed-x');
    const s2 = createRngStreams('seed-x');
    // Consuming the combat stream must not shift the night stream.
    for (let i = 0; i < 100; i++) nextFloat(s1.combat);
    expect(nextFloat(s1.night)).toEqual(nextFloat(s2.night));
    expect(s1.combat.s).not.toEqual(s1.night.s);
  });

  it('shuffles deterministically and keeps all elements', () => {
    const a = shuffle(makeRng(1), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = shuffle(makeRng(1), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('picks weighted items proportionally and never picks zero weight', () => {
    const r = makeRng(99);
    const counts = { a: 0, b: 0, z: 0 };
    const items = [
      { k: 'a' as const, w: 3 },
      { k: 'b' as const, w: 1 },
      { k: 'z' as const, w: 0 },
    ];
    for (let i = 0; i < 4000; i++) counts[pickWeighted(r, items, (x) => x.w).k]++;
    expect(counts.z).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.4);
    expect(counts.a / counts.b).toBeLessThan(3.6);
  });
});
