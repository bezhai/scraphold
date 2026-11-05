import { describe, expect, it } from 'vitest';
import { createPixelSprites, devicePoint, type DeviceTransform } from './pixelSprites';

/** Stand-in canvases for the node test environment: the painter only sees a context object. */
function fakeCanvas(width: number, height: number) {
  const ctx = {};
  return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe('devicePoint', () => {
  const t: DeviceTransform = { k: 44, ox: 100.4, oy: -20.2 };

  it('maps world tiles to whole device pixels', () => {
    expect(devicePoint(t, 0, 0)).toEqual({ x: 100, y: -20 });
    expect(devicePoint(t, 1.5, 2)).toEqual({ x: Math.round(1.5 * 44 + 100.4), y: Math.round(2 * 44 - 20.2) });
  });

  it('lands neighbouring points on neighbouring pixels (no drift)', () => {
    for (let x = 0; x < 3; x += 0.013) {
      const p = devicePoint(t, x, 0);
      expect(Math.abs(p.x - (x * t.k + t.ox))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('createPixelSprites', () => {
  it('paints a sprite once at the asked size and reuses it', () => {
    let painted = 0;
    const sprites = createPixelSprites({ maxEntries: 10, perFrame: 5, makeCanvas: fakeCanvas });
    sprites.beginFrame();
    const a = sprites.get('splat:0:40', 40, 30, () => painted++);
    const b = sprites.get('splat:0:40', 40, 30, () => painted++);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(painted).toBe(1);
    expect(a!.width).toBe(40);
    expect(a!.height).toBe(30);
  });

  it('paints at most `perFrame` new sprites per frame, then returns null until the next frame', () => {
    const sprites = createPixelSprites({ maxEntries: 100, perFrame: 2, makeCanvas: fakeCanvas });
    sprites.beginFrame();
    expect(sprites.get('a', 4, 4, () => {})).not.toBeNull();
    expect(sprites.get('b', 4, 4, () => {})).not.toBeNull();
    expect(sprites.get('c', 4, 4, () => {})).toBeNull();
    // cached ones stay available
    expect(sprites.get('a', 4, 4, () => {})).not.toBeNull();
    sprites.beginFrame();
    expect(sprites.get('c', 4, 4, () => {})).not.toBeNull();
  });

  it('starts over when full, so sizes left behind by zooming do not pile up', () => {
    let painted = 0;
    const sprites = createPixelSprites({ maxEntries: 3, perFrame: 10, makeCanvas: fakeCanvas });
    sprites.beginFrame();
    for (const k of ['a', 'b', 'c']) sprites.get(k, 2, 2, () => painted++);
    sprites.get('d', 2, 2, () => painted++);
    expect(sprites.size()).toBe(1);
    sprites.get('a', 2, 2, () => painted++);
    expect(painted).toBe(5);
  });

  it('never paints an empty canvas', () => {
    const sprites = createPixelSprites({ maxEntries: 3, perFrame: 10, makeCanvas: fakeCanvas });
    sprites.beginFrame();
    expect(sprites.get('tiny', 0, 3, () => {})?.width).toBe(1);
  });
});
