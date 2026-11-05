/**
 * Structural hash of plain simulation data (objects, arrays, Map, Set, typed arrays, primitives).
 * Used by determinism tests and the headless runner: same seed + same commands => same hash.
 *
 * Object keys are hashed in sorted order (construction order is irrelevant to game meaning);
 * Map/Set/array order is hashed as-is because iteration order drives system update order.
 * Numbers are hashed by their exact float64 bits.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

class Hasher {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;

  word(n: number): void {
    this.h1 = Math.imul(this.h1 ^ n, 2654435761);
    this.h2 = Math.imul(this.h2 ^ n, 1597334677);
  }

  number(n: number): void {
    f64[0] = n;
    this.word(u32[0] as number);
    this.word(u32[1] as number);
  }

  string(s: string): void {
    this.word(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
  }

  digest(): string {
    let h1 = this.h1;
    let h2 = this.h2;
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
}

const Tag = {
  Undefined: 1,
  Null: 2,
  False: 3,
  True: 4,
  Number: 5,
  String: 6,
  Array: 7,
  Object: 8,
  Map: 9,
  Set: 10,
  Typed: 11,
} as const;

function feed(h: Hasher, value: unknown): void {
  if (value === undefined) return h.word(Tag.Undefined);
  if (value === null) return h.word(Tag.Null);
  switch (typeof value) {
    case 'boolean':
      return h.word(value ? Tag.True : Tag.False);
    case 'number':
      h.word(Tag.Number);
      return h.number(value);
    case 'string':
      h.word(Tag.String);
      return h.string(value);
    case 'object':
      break;
    default:
      throw new Error(`hashValue: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    h.word(Tag.Array);
    h.word(value.length);
    for (const v of value) feed(h, v);
    return;
  }
  if (ArrayBuffer.isView(value)) {
    const arr = value as unknown as ArrayLike<number>;
    h.word(Tag.Typed);
    h.word(arr.length);
    for (let i = 0; i < arr.length; i++) h.number(arr[i] as number);
    return;
  }
  if (value instanceof Map) {
    h.word(Tag.Map);
    h.word(value.size);
    for (const [k, v] of value) {
      feed(h, k);
      feed(h, v);
    }
    return;
  }
  if (value instanceof Set) {
    h.word(Tag.Set);
    h.word(value.size);
    for (const v of value) feed(h, v);
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  h.word(Tag.Object);
  h.word(keys.length);
  for (const k of keys) {
    h.string(k);
    feed(h, obj[k]);
  }
}

export function hashValue(value: unknown): string {
  const h = new Hasher();
  feed(h, value);
  return h.digest();
}
