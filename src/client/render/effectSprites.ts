/**
 * Effect art painted once and blitted: ground marks (mutant stains, scorches, acid pools, rubble)
 * in a few variants, soft round particles (fire, flame core, smoke, dust, acid, spark) and the claw
 * swipe. A big fight has hundreds of these on screen; one image blit each is far cheaper than
 * redrawing their shapes. Ground marks are also kept at their exact on-screen pixel size, so they
 * can be copied 1:1 (see pixelSprites.ts).
 */
import { hash2 } from './noise';
import { createPixelSprites } from './pixelSprites';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
/** Ground marks are painted in a box of this many pixels for a radius of 1. */
const MARK_PX = 96;
export const MARK_VARIANTS = 3;
/** A mark sprite spans this many radii on each side of its center. */
export const MARK_EXTENT = 1.6;

export type MarkKind = 'splat' | 'scorch' | 'acidPool' | 'rubble';
export type ParticleKind = 'fire' | 'flameCore' | 'smoke' | 'dust' | 'acid' | 'spark';

const cache = new Map<string, HTMLCanvasElement>();

function sprite(key: string, size: number, paint: (g: Ctx) => void): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as Ctx;
  paint(g);
  cache.set(key, c);
  return c;
}

/** Paints a mark of radius 1 centered in the box (after the caller's transform). */
function paintMark(g: Ctx, kind: MarkKind, v: number): void {
  const r = (k: number) => hash2(v * 31 + k, 7, 99);
  switch (kind) {
    case 'splat': {
      g.fillStyle = 'rgba(80,20,42,0.85)';
      g.beginPath();
      g.ellipse(0, 0, 0.95, 0.66, r(1) * 3, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(110,28,58,0.8)';
      for (let k = 0; k < 6; k++) {
        const a = r(2 + k) * TAU;
        const d = 0.75 + r(8 + k) * 0.6;
        g.beginPath();
        g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.1 + r(14 + k) * 0.14, 0, TAU);
        g.fill();
      }
      g.fillStyle = 'rgba(150,50,80,0.5)';
      g.beginPath();
      g.ellipse(-0.2, -0.15, 0.4, 0.25, r(20) * 3, 0, TAU);
      g.fill();
      break;
    }
    case 'scorch': {
      const grad = g.createRadialGradient(0, 0, 0.1, 0, 0, 1);
      grad.addColorStop(0, 'rgba(30,22,16,0.75)');
      grad.addColorStop(0.7, 'rgba(40,28,18,0.45)');
      grad.addColorStop(1, 'rgba(40,28,18,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, 1, 0.78, r(1) * 3, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(40,28,18,0.45)';
      for (let k = 0; k < 6; k++) {
        const a = r(2 + k) * TAU;
        g.beginPath();
        g.ellipse(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0.25, 0.09, a, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'acidPool': {
      g.fillStyle = 'rgba(110,150,30,0.8)';
      g.beginPath();
      g.ellipse(0, 0, 1, 0.8, r(1) * 3, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(184,240,74,0.75)';
      g.beginPath();
      g.ellipse(-0.1, -0.1, 0.7, 0.55, r(1) * 3, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(230,255,170,0.8)';
      for (let k = 0; k < 4; k++) {
        const a = r(3 + k) * TAU;
        g.beginPath();
        g.arc(Math.cos(a) * 0.45, Math.sin(a) * 0.35, 0.05 + r(9 + k) * 0.05, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'rubble': {
      g.fillStyle = 'rgba(60,50,40,0.6)';
      g.beginPath();
      g.ellipse(0, 0, 1.05, 0.85, 0, 0, TAU);
      g.fill();
      for (let k = 0; k < 12; k++) {
        const a = r(k) * TAU;
        const d = r(20 + k) * 0.95;
        const s = 0.08 + r(40 + k) * 0.14;
        g.fillStyle = k % 3 === 0 ? 'rgba(164,83,43,0.95)' : 'rgba(140,130,115,0.95)';
        g.fillRect(Math.cos(a) * d - s / 2, Math.sin(a) * d - s / 2, s, s * 0.7);
        g.fillStyle = 'rgba(26,21,16,0.5)';
        g.fillRect(Math.cos(a) * d - s / 2 + 0.02, Math.sin(a) * d + s * 0.35, s, 0.03);
      }
      break;
    }
  }
}

function paintMarkBox(g: Ctx, kind: MarkKind, variant: number, side: number): void {
  g.translate(side / 2, side / 2);
  g.scale(side / (MARK_EXTENT * 2), side / (MARK_EXTENT * 2));
  paintMark(g, kind, variant);
}

/** A mark at a fixed resolution, for drawing scaled. */
export function markSprite(kind: MarkKind, variant: number): HTMLCanvasElement {
  const v = variant % MARK_VARIANTS;
  return sprite(`mark:${kind}:${v}`, MARK_PX, (g) => paintMarkBox(g, kind, v, MARK_PX));
}

const exactMarks = createPixelSprites({ maxEntries: 400, perFrame: 24 });
const exactAir = createPixelSprites({ maxEntries: 1500, perFrame: 40 });

/** Call once per frame before drawing effects: resets the painting budgets. */
export function beginEffectSpriteFrame(): void {
  exactMarks.beginFrame();
  exactAir.beginFrame();
}

/** A mark painted `side` device pixels wide (side = 2 * radius * MARK_EXTENT), or null when this frame's painting budget is spent. */
export function exactMark(kind: MarkKind, variant: number, side: number): HTMLCanvasElement | null {
  const v = variant % MARK_VARIANTS;
  return exactMarks.get(`${kind}:${v}:${side}`, side, side, (g) => paintMarkBox(g, kind, v, side));
}

const PARTICLE_COLORS: Record<ParticleKind, [string, string]> = {
  fire: ['rgba(255,190,80,1)', 'rgba(230,90,30,0)'],
  flameCore: ['rgba(255,250,210,1)', 'rgba(255,200,90,0)'],
  smoke: ['rgba(70,64,58,0.9)', 'rgba(70,64,58,0)'],
  dust: ['rgba(190,172,140,0.85)', 'rgba(190,172,140,0)'],
  acid: ['rgba(214,255,120,1)', 'rgba(150,210,50,0)'],
  spark: ['rgba(255,255,240,1)', 'rgba(255,230,160,0)'],
};
/** Large enough that particles are rarely drawn bigger than painted (they are drawn unfiltered). */
const PARTICLE_PX = 64;

function paintParticle(g: Ctx, kind: ParticleKind, side: number): void {
  const [inner, outer] = PARTICLE_COLORS[kind];
  const c = side / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, inner.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.7})`));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, side, side);
}

/** Particle sides are rounded to whole pixels, coarser for big ones, so growing particles reuse sprites. */
export function particleSide(diameterPx: number): number {
  const q = diameterPx < 16 ? 1 : diameterPx < 48 ? 2 : 4;
  return Math.max(1, Math.round(diameterPx / q) * q);
}

/** A particle painted `side` device pixels wide, or null when this frame's painting budget is spent. */
export function exactParticle(kind: ParticleKind, side: number): HTMLCanvasElement | null {
  return exactAir.get(`p:${kind}:${side}`, side, side, (g) => paintParticle(g, kind, side));
}

/** A soft round particle at a fixed resolution, for drawing scaled; draw it 2r wide for radius r. */
export function particleSprite(kind: ParticleKind): HTMLCanvasElement {
  return sprite(`particle:${kind}`, PARTICLE_PX, (g) => paintParticle(g, kind, PARTICLE_PX));
}

/** The claw sprite spans CLAW_EXTENT tiles on each side of the target for the reference swipe radius 0.28. */
export const CLAW_EXTENT = 0.42;
const CLAW_PX = 64;

/** Three curved slashes across a target, the swipe moving along `angle`, in a `side` px box spanning 2 * CLAW_EXTENT tiles. */
function paintClaw(g: Ctx, side: number, angle: number): void {
  const s = side / (CLAW_EXTENT * 2);
  g.translate(side / 2, side / 2);
  g.rotate(angle);
  g.scale(s, s);
  g.strokeStyle = 'rgba(255,236,236,0.9)';
  g.lineCap = 'round';
  g.lineWidth = Math.max(0.035, 1.2 / s);
  const r = 0.28;
  g.beginPath();
  for (let k = -1; k <= 1; k++) {
    const o = k * 0.09;
    g.moveTo(-0.1, -(r + o));
    g.quadraticCurveTo(0.12 + o, 0, -0.1, r - o);
  }
  g.stroke();
}

/** The claw at a fixed resolution facing +x, for drawing rotated and scaled. */
export function clawSprite(): HTMLCanvasElement {
  return sprite('claw', CLAW_PX, (g) => paintClaw(g, CLAW_PX, 0));
}

/** The claw facing direction bucket `bucket` (16 directions), `side` device px wide, or null when the budget is spent. */
export function exactClaw(bucket: number, angle: number, side: number): HTMLCanvasElement | null {
  return exactAir.get(`c:${bucket}:${side}`, side, side, (g) => paintClaw(g, side, angle));
}
