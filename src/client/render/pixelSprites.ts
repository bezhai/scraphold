/**
 * Sprites painted at their exact size in device pixels and drawn 1:1 at whole device pixels. The
 * software rasterizer behind headless and GPU-less browsers copies such blits several times
 * faster than scaled or sub-pixel ones, which it filters pixel by pixel; ground marks, unit
 * shadows and identity rings are drawn this way. Each sprite is painted on first use, at most
 * `perFrame` new ones per frame (a zoom changes every size at once); once that is spent `get`
 * returns null and the caller draws its scaled fallback for that frame.
 */

/** World tiles to device pixels: device = tile * k + offset. */
export interface DeviceTransform {
  k: number;
  ox: number;
  oy: number;
}

/** The transform currently set on a context that draws in world tiles (no rotation or skew). */
export function deviceTransformOf(g: CanvasRenderingContext2D): DeviceTransform {
  const m = g.getTransform();
  return { k: m.a, ox: m.e, oy: m.f };
}

/** A world point on its whole device pixel. */
export function devicePoint(t: DeviceTransform, x: number, y: number): { x: number; y: number } {
  return { x: Math.round(x * t.k + t.ox), y: Math.round(y * t.k + t.oy) };
}

export interface PixelSprites {
  /** Resets the per-frame paint budget. */
  beginFrame(): void;
  /** The sprite for `key` (`w` x `h` device px, painted by `paint` on first use), or null when this frame's budget is spent. */
  get(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement | null;
  size(): number;
}

function documentCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function createPixelSprites(options: {
  maxEntries: number;
  perFrame: number;
  makeCanvas?: (width: number, height: number) => HTMLCanvasElement;
}): PixelSprites {
  const make = options.makeCanvas ?? documentCanvas;
  const cache = new Map<string, HTMLCanvasElement>();
  let budget = options.perFrame;
  return {
    beginFrame() {
      budget = options.perFrame;
    },
    get(key, w, h, paint) {
      const hit = cache.get(key);
      if (hit) return hit;
      if (budget <= 0) return null;
      budget--;
      if (cache.size >= options.maxEntries) cache.clear();
      const width = Math.max(1, Math.ceil(w));
      const height = Math.max(1, Math.ceil(h));
      const c = make(width, height);
      paint(c.getContext('2d') as CanvasRenderingContext2D, width, height);
      cache.set(key, c);
      return c;
    },
    size: () => cache.size,
  };
}
