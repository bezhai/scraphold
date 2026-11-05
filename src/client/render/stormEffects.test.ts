import { describe, expect, it } from 'vitest';
import { createSandStorm } from './stormEffects';

interface Blit {
  sprite: FakeCanvas;
  x: number;
  y: number;
  transform: number[];
}

/** Stand-in for the screen context: records the transform in force at every image copy. */
function recordingContext() {
  const blits: Blit[] = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const ctx = {
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    setTransform(...m: number[]) {
      transform = m;
    },
    drawImage(sprite: FakeCanvas, x: number, y: number) {
      blits.push({ sprite, x, y, transform: [...transform] });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, blits };
}

/** Stand-in for an offscreen canvas: records how its streak was painted. */
interface FakeCanvas {
  width: number;
  height: number;
  scale: number;
  lineWidth: number;
  points: number[][];
  getContext(): unknown;
}

function fakeCanvases() {
  const made: FakeCanvas[] = [];
  const makeCanvas = (width: number, height: number) => {
    const c: FakeCanvas = {
      width,
      height,
      scale: 1,
      lineWidth: 0,
      points: [],
      getContext: () => g,
    };
    const g = {
      strokeStyle: '' as unknown,
      lineCap: 'butt',
      set lineWidth(v: number) {
        c.lineWidth = v;
      },
      scale(k: number) {
        c.scale = k;
      },
      createLinearGradient: () => ({ addColorStop() {} }),
      beginPath() {},
      moveTo: (x: number, y: number) => c.points.push([x, y]),
      lineTo: (x: number, y: number) => c.points.push([x, y]),
      stroke() {},
    };
    made.push(c);
    return c as unknown as HTMLCanvasElement;
  };
  return { made, makeCanvas };
}

/** Deterministic stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const W = 1440;
const H = 900;

describe('createSandStorm', () => {
  it('copies its streaks at whole device pixels in screen space, whatever world transform the context had', () => {
    const { makeCanvas } = fakeCanvases();
    const storm = createSandStorm(seeded(1), makeCanvas);
    const { ctx, blits } = recordingContext();
    ctx.setTransform(44, 0, 0, 44, -1200, -800);
    storm.draw(ctx, W, H, 2, 1000, 1);
    expect(blits.length).toBeGreaterThan(150);
    for (const b of blits) {
      expect(b.transform).toEqual([1, 0, 0, 1, 0, 0]);
      expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
    }
  });

  it('keeps every streak on the screen, painted at the device ratio with line widths in screen pixels', () => {
    const { made, makeCanvas } = fakeCanvases();
    const storm = createSandStorm(seeded(2), makeCanvas);
    const { ctx, blits } = recordingContext();
    storm.draw(ctx, W, H, 2, 1000, 1);
    for (const b of blits) {
      expect(b.x + b.sprite.width).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(W * 2);
      expect(b.y + b.sprite.height).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(H * 2);
    }
    expect(made.length).toBeGreaterThan(0);
    for (const c of made) {
      expect(c.scale).toBe(2);
      expect(c.lineWidth).toBeGreaterThanOrEqual(1);
      expect(c.lineWidth).toBeLessThanOrEqual(4);
    }
  });

  it('slants the streaks down to the left and blows them that way over time', () => {
    const { made, makeCanvas } = fakeCanvases();
    const storm = createSandStorm(seeded(3), makeCanvas);
    const first = recordingContext();
    storm.draw(first.ctx, W, H, 1, 1000, 1);
    const later = recordingContext();
    storm.draw(later.ctx, W, H, 1, 1050, 1);
    expect(later.blits.length).toBe(first.blits.length);
    let leftDown = 0;
    first.blits.forEach((a, i) => {
      const b = later.blits[i] as Blit;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx < 0 && dy > 0 && dx > -100) leftDown++;
    });
    expect(leftDown).toBeGreaterThan(first.blits.length * 0.9);
    // each streak runs from its head up and to the right, toward where the wind comes from
    for (const c of made) {
      const [head, tail] = c.points as [number[], number[]];
      expect(tail[0]!).toBeGreaterThan(head[0]!);
      expect(tail[1]!).toBeLessThan(head[1]!);
    }
  });

  it('draws nothing without a storm and fewer streaks while it is building up', () => {
    const { makeCanvas } = fakeCanvases();
    const storm = createSandStorm(seeded(4), makeCanvas);
    const none = recordingContext();
    storm.draw(none.ctx, W, H, 1, 1000, 0);
    expect(none.blits).toEqual([]);
    const thin = recordingContext();
    storm.draw(thin.ctx, W, H, 1, 1016, 0.3);
    const full = recordingContext();
    storm.draw(full.ctx, W, H, 1, 1032, 1);
    expect(thin.blits.length).toBeGreaterThan(0);
    expect(thin.blits.length).toBeLessThan(full.blits.length);
  });

  it('paints its streak sprites once, again only when the device ratio changes', () => {
    const { made, makeCanvas } = fakeCanvases();
    const storm = createSandStorm(seeded(5), makeCanvas);
    storm.draw(recordingContext().ctx, W, H, 1, 1000, 1);
    const painted = made.length;
    storm.draw(recordingContext().ctx, W, H, 1, 1016, 1);
    expect(made.length).toBe(painted);
    storm.draw(recordingContext().ctx, W, H, 2, 1032, 1);
    expect(made.length).toBe(painted * 2);
  });
});
