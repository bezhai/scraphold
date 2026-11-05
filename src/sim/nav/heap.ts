/**
 * Binary min-heap of non-negative numbers. Callers encode (priority, tile) into one number as
 * priority * TILE_KEY + tile, which gives a deterministic tie-break by tile index.
 */
export const TILE_KEY = 65536;

export class MinHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  push(value: number): void {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((a[p] as number) <= value) break;
      a[i] = a[p] as number;
      i = p;
    }
    a[i] = value;
  }

  pop(): number {
    const a = this.items;
    const top = a[0] as number;
    const last = a.pop() as number;
    if (a.length > 0) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (a[r] as number) < (a[l] as number) ? r : l;
        if ((a[c] as number) >= last) break;
        a[i] = a[c] as number;
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}
