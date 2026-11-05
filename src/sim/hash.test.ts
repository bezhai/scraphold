import { describe, expect, it } from 'vitest';
import { hashValue } from './hash';

describe('hashValue', () => {
  it('is equal for structurally equal values and ignores object key order', () => {
    const a = { x: 1, y: [1, 2, { z: 'q' }], m: new Map([[1, { hp: 3 }]]), t: new Uint8Array([1, 2]) };
    const b = { y: [1, 2, { z: 'q' }], x: 1, t: new Uint8Array([1, 2]), m: new Map([[1, { hp: 3 }]]) };
    expect(hashValue(a)).toBe(hashValue(b));
  });

  it('changes when any nested number, typed array element or map entry changes', () => {
    const base = () => ({ x: 1.5, arr: new Int32Array([5, 6]), m: new Map([[2, { hp: 10 }]]) });
    const h = hashValue(base());
    const v1 = base();
    v1.x = 1.5000000001;
    const v2 = base();
    v2.arr[1] = 7;
    const v3 = base();
    v3.m.get(2)!.hp = 11;
    const v4 = base();
    v4.m.set(3, { hp: 1 });
    for (const v of [v1, v2, v3, v4]) expect(hashValue(v)).not.toBe(h);
  });

  it('distinguishes map insertion order because iteration order drives simulation order', () => {
    const a = new Map([[1, 'a'], [2, 'b']]);
    const b = new Map([[2, 'b'], [1, 'a']]);
    expect(hashValue(a)).not.toBe(hashValue(b));
  });

  it('distinguishes types that stringify alike', () => {
    expect(hashValue('1')).not.toBe(hashValue(1));
    expect(hashValue(null)).not.toBe(hashValue(undefined));
    expect(hashValue([1, [2]])).not.toBe(hashValue([[1], 2]));
  });
});
