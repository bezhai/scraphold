/**
 * Blowing sand on a rust storm night, drawn in screen space over the shaded world: pale streaks
 * and darker gusts slanting down to the left, blown at a fixed screen speed whatever the zoom.
 * Each streak is a copy of one of a few pre-painted streak sprites (a line fading toward its
 * tail, painted at the device pixel ratio) placed at whole device pixels: a few hundred cheap
 * image copies per frame instead of stroking paths, which measurably cost frames at 3x speed.
 * Streak positions are kept as fractions of the view, so a resize keeps them spread out; how many
 * are drawn follows the view area and the storm level (lighting.ts `stormLevel`).
 */

type Ctx = CanvasRenderingContext2D;

/** Wind in CSS pixels per second: mostly sideways, falling to the lower left. */
const WIND = { x: -340, y: 150 };
const WIND_LEN = Math.sqrt(WIND.x * WIND.x + WIND.y * WIND.y);
const UX = WIND.x / WIND_LEN;
const UY = WIND.y / WIND_LEN;

/** Screen area (CSS px²) per streak at full strength, and the pool size. */
const PX_PER_STREAK = 5600;
const MAX_STREAKS = 700;

interface Layer {
  /** Share of the streaks in this layer. */
  share: number;
  /** CSS pixels. */
  width: number;
  rgb: string;
  /** Opacity of each of the layer's buckets. */
  alphas: readonly number[];
  /** Streak lengths in CSS pixels, one sprite each. */
  lengths: readonly number[];
  speed: readonly [number, number];
}

/** Pale sand streaks read on the dark ground, darker rust gusts on the lit ground around lamps. */
const LAYERS: readonly Layer[] = [
  { share: 0.8, width: 1.8, rgb: '255,228,188', alphas: [0.55, 0.75, 0.95], lengths: [24, 34, 46], speed: [0.85, 1.3] },
  { share: 0.2, width: 3.8, rgb: '120,52,22', alphas: [0.22, 0.32, 0.42], lengths: [44, 60], speed: [0.6, 0.9] },
];

interface Streak {
  /** Head position as a fraction of the view. */
  x: number;
  y: number;
  speed: number;
  layer: number;
  bucket: number;
  sprite: number;
}

interface StreakSprite {
  canvas: HTMLCanvasElement;
  /** Head of the streak inside the sprite, device pixels. */
  hx: number;
  hy: number;
}

export interface SandStorm {
  /**
   * Blows the sand on to `now` (ms) and draws it over the whole view (CSS size `cssW` x `cssH`,
   * `dpr` device pixels per CSS pixel); `level` 0..1, nothing at 0. Sets its own transform.
   */
  draw(ctx: Ctx, cssW: number, cssH: number, dpr: number, now: number, level: number): void;
}

const wrap = (v: number) => v - Math.floor(v);

function defaultCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** A streak from its head (lower left) up to its tail (upper right), fading toward the tail. */
function paintStreak(makeCanvas: (w: number, h: number) => HTMLCanvasElement, l: Layer, len: number, dpr: number): StreakSprite {
  const pad = l.width + 1;
  const tx = -UX * len;
  const ty = -UY * len;
  const canvas = makeCanvas(Math.ceil((tx + pad * 2) * dpr), Math.ceil((-ty + pad * 2) * dpr));
  const hx = pad;
  const hy = pad - ty;
  const g = canvas.getContext('2d');
  if (g) {
    g.scale(dpr, dpr);
    const grad = g.createLinearGradient(hx, hy, hx + tx, hy + ty);
    grad.addColorStop(0, `rgba(${l.rgb},1)`);
    grad.addColorStop(1, `rgba(${l.rgb},0)`);
    g.strokeStyle = grad;
    g.lineWidth = l.width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(hx + tx, hy + ty);
    g.stroke();
  }
  return { canvas, hx: hx * dpr, hy: hy * dpr };
}

export function createSandStorm(random: () => number = Math.random, makeCanvas: (w: number, h: number) => HTMLCanvasElement = defaultCanvas): SandStorm {
  const between = (r: readonly [number, number]) => r[0] + random() * (r[1] - r[0]);
  const streaks: Streak[] = Array.from({ length: MAX_STREAKS }, () => {
    const layer = random() < (LAYERS[0] as Layer).share ? 0 : 1;
    const l = LAYERS[layer] as Layer;
    return { x: random(), y: random(), speed: between(l.speed), layer, bucket: Math.floor(random() * l.alphas.length), sprite: Math.floor(random() * l.lengths.length) };
  });
  let sprites: StreakSprite[][] = [];
  let spritesDpr = 0;
  let last = -1;

  return {
    draw(ctx, w, h, dpr, now, level) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, now - last) / 1000);
      last = level > 0 ? now : -1;
      if (level <= 0 || w <= 0 || h <= 0) return;
      if (spritesDpr !== dpr) {
        sprites = LAYERS.map((l) => l.lengths.map((len) => paintStreak(makeCanvas, l, len, dpr)));
        spritesDpr = dpr;
      }
      for (const s of streaks) {
        s.x = wrap(s.x + (WIND.x * s.speed * dt) / w);
        s.y = wrap(s.y + (WIND.y * s.speed * dt) / h);
      }
      const n = Math.min(MAX_STREAKS, Math.round(((w * h) / PX_PER_STREAK) * level));
      const fade = 0.5 + 0.5 * level;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      LAYERS.forEach((l, layer) => {
        l.alphas.forEach((alpha, bucket) => {
          ctx.globalAlpha = alpha * fade;
          for (let i = 0; i < n; i++) {
            const s = streaks[i] as Streak;
            if (s.layer !== layer || s.bucket !== bucket) continue;
            const sp = (sprites[layer] as StreakSprite[])[s.sprite] as StreakSprite;
            ctx.drawImage(sp.canvas, Math.round(s.x * w * dpr - sp.hx), Math.round(s.y * h * dpr - sp.hy));
          }
        });
      });
      ctx.restore();
    },
  };
}
