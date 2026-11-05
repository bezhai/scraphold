/**
 * Draws visual effects (see effects.ts). Ground marks (scorches, acid pools, mutant stains, rubble)
 * go under units; the bright part of a fight goes over the night grading so it reads in the dark:
 * tracers (sniper rounds longer and brighter), muzzle flashes, lobbed grenades, acid globs, claw
 * swipes, flame particles, explosions with a flash, a shock ring, flying debris and lingering
 * smoke, acid splashes, building dust and order markers. Also lists the light the strongest
 * effects in view cast.
 *
 * Big fights put hundreds of these on screen, and browsers without a GPU rasterize the canvas in
 * software, where cost follows filtered pixels and path complexity. So marks, soft particles and
 * claws are 1:1 copies of sprites painted at their on-screen pixel size (effectSprites.ts), tracers
 * are rotated rectangle fills, and the muzzle flashes share one simple filled path.
 */
import {
  beginEffectSpriteFrame,
  CLAW_EXTENT,
  clawSprite,
  exactClaw,
  exactMark,
  exactParticle,
  MARK_EXTENT,
  MARK_VARIANTS,
  markSprite,
  particleSide,
  particleSprite,
  type MarkKind,
  type ParticleKind,
} from './effectSprites';
import { hash2 } from './noise';
import type { LightSource } from './lighting';
import { devicePoint, deviceTransformOf, type DeviceTransform } from './pixelSprites';
import { bucketAngle, facingBucket } from './unitPose';
import type { VisualEffect } from './effects';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

const progress = (e: VisualEffect, now: number) => Math.min(1, Math.max(0, (now - e.born) / e.life));
/** Stable per-effect random number. */
const rnd = (e: VisualEffect, k: number) => hash2(Math.floor(e.born * 7) + k * 31, Math.floor(e.x * 97 + e.y * 13), k);

/**
 * Draws a ground mark of radius `r` (tiles) centered on (x, y), with the context in device pixels:
 * a 1:1 copy of the mark painted at its on-screen size, or the fixed-size mark scaled while that
 * is not painted yet.
 */
function mark(g: Ctx, t: DeviceTransform, kind: MarkKind, e: VisualEffect, r: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const variant = Math.floor(rnd(e, 1) * MARK_VARIANTS);
  const side = Math.max(2, Math.round(r * MARK_EXTENT * t.k) * 2);
  const p = devicePoint(t, e.x, e.y);
  g.globalAlpha = alpha;
  const exact = exactMark(kind, variant, side);
  if (exact) g.drawImage(exact, p.x - side / 2, p.y - side / 2);
  else g.drawImage(markSprite(kind, variant), p.x - side / 2, p.y - side / 2, side, side);
}

/** A soft particle or claw swipe to draw this frame, in world tiles. */
interface Dot {
  kind: ParticleKind | 'claw';
  x: number;
  y: number;
  /** Radius in tiles. */
  r: number;
  alpha: number;
  /** Claw direction (radians). */
  angle: number;
}
const dots: Dot[] = [];

/** Queues a soft particle of radius `r` centered on (x, y); see drawDots. */
function particle(kind: ParticleKind, x: number, y: number, r: number, alpha: number): void {
  if (alpha <= 0.01 || r <= 0) return;
  dots.push({ kind, x, y, r, alpha: Math.min(1, alpha), angle: 0 });
}

/**
 * Draws the queued particles and claws with the context in device pixels, each a 1:1 copy of a
 * sprite painted at its pixel size (or a scaled stand-in while that is not painted yet). They go
 * over the frame's other air effects.
 */
function drawDots(g: Ctx, t: DeviceTransform): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  for (const d of dots) {
    const side = particleSide(d.r * 2 * t.k);
    if (side < 2) continue;
    const x = Math.round(d.x * t.k + t.ox - side / 2);
    const y = Math.round(d.y * t.k + t.oy - side / 2);
    g.globalAlpha = d.alpha;
    if (d.kind === 'claw') {
      const bucket = facingBucket(d.angle);
      const exact = exactClaw(bucket, bucketAngle(bucket), side);
      if (exact) g.drawImage(exact, x, y);
      else {
        g.setTransform(Math.cos(d.angle), Math.sin(d.angle), -Math.sin(d.angle), Math.cos(d.angle), x + side / 2, y + side / 2);
        g.drawImage(clawSprite(), -side / 2, -side / 2, side, side);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
      continue;
    }
    const exact = exactParticle(d.kind, side);
    if (exact) g.drawImage(exact, x, y);
    else g.drawImage(particleSprite(d.kind), x, y, side, side);
  }
  g.restore();
  dots.length = 0;
}

/** Ground marks drawn under units, each a 1:1 sprite copy. `g` draws in world tiles. */
export function drawGroundEffects(g: Ctx, effects: readonly VisualEffect[], now: number): void {
  const t = deviceTransformOf(g);
  beginEffectSpriteFrame();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  for (const e of effects) {
    const p = progress(e, now);
    const fade = p > 0.7 ? (1 - p) / 0.3 : 1;
    switch (e.kind) {
      case 'scorch':
        mark(g, t, 'scorch', e, e.radius, 0.42 * fade);
        break;
      case 'acidPool': {
        const r = e.radius * (0.6 + 0.4 * Math.min(1, (now - e.born) / 250));
        mark(g, t, 'acidPool', e, r, 0.7 * fade);
        // A couple of rising bubbles keep the pool alive.
        for (let k = 0; k < 2; k++) {
          const ph = (now / 600 + rnd(e, 3 + k)) % 1;
          if (ph > 0.6) continue;
          const a = rnd(e, 9 + k) * TAU;
          const x = (e.x + Math.cos(a) * r * 0.5) * t.k + t.ox;
          const y = (e.y + Math.sin(a) * r * 0.4) * t.k + t.oy;
          const side = particleSide((0.1 + ph * 0.12) * t.k);
          g.globalAlpha = 0.7 * fade;
          g.drawImage(exactParticle('spark', side) ?? particleSprite('spark'), Math.round(x - side / 2), Math.round(y - side / 2), side, side);
        }
        break;
      }
      case 'splat':
        mark(g, t, 'splat', e, e.radius * 1.25, 0.5 * fade);
        break;
      case 'rubble':
        mark(g, t, 'rubble', e, e.radius, 0.9 * fade);
        break;
      default:
        break;
    }
  }
  g.restore();
}

/** Point along a lobbed arc from (x, y) to (x2, y2): lifted toward the viewer (up the screen). */
function arcPoint(e: VisualEffect, t: number, lift: number): { x: number; y: number } {
  const dx = e.x2 - e.x;
  const dy = e.y2 - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return { x: e.x + dx * t, y: e.y + dy * t - Math.sin(t * Math.PI) * d * lift };
}

/**
 * Tracers as thin rotated rectangles: a wide soft pass, then a bright core. (Stroking many
 * segments as one path is very slow on software rasterizers; a rotated rectangle fill is cheap.)
 */
function drawTracers(g: Ctx, t: DeviceTransform, effects: readonly VisualEffect[], now: number, px: number, heavy: boolean, passes: readonly [string, number][]): void {
  for (const [color, width] of passes) {
    g.fillStyle = color;
    for (const e of effects) {
      if (e.kind !== 'tracer' || !e.heavy !== !heavy) continue;
      const p = progress(e, now);
      const head = Math.min(1, p * (heavy ? 1.6 : 2.2));
      const tail = Math.max(0, head - (heavy ? 0.75 : 0.4));
      const dx = e.x2 - e.x;
      const dy = e.y2 - e.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01 || head <= tail) continue;
      const cos = dx / len;
      const sin = dy / len;
      const w = Math.max(width * px, width * 0.018);
      g.setTransform(t.k * cos, t.k * sin, -t.k * sin, t.k * cos, e.x * t.k + t.ox, e.y * t.k + t.oy);
      g.fillRect(tail * len, -w / 2, (head - tail) * len, w);
    }
  }
  g.setTransform(t.k, 0, 0, t.k, t.ox, t.oy);
}

const TRACER_PASSES: readonly [string, number][] = [
  ['rgba(255,200,110,0.35)', 4],
  ['rgba(255,244,200,0.95)', 1.6],
];
const HEAVY_TRACER_PASSES: readonly [string, number][] = [
  ['rgba(140,220,255,0.45)', 6],
  ['rgba(255,255,255,1)', 2.4],
];

/** Bright, fast effects drawn above the night grading. `px` is one screen pixel in tiles. */
export function drawAirEffects(g: Ctx, effects: readonly VisualEffect[], now: number, px: number): void {
  const dt = deviceTransformOf(g);
  drawTracers(g, dt, effects, now, px, false, TRACER_PASSES);
  drawTracers(g, dt, effects, now, px, true, HEAVY_TRACER_PASSES);
  // Muzzle flashes: a star burst at the barrel tip, batched.
  g.fillStyle = 'rgba(255,236,170,0.95)';
  g.beginPath();
  for (const e of effects) {
    if (e.kind !== 'flash') continue;
    const fade = 1 - progress(e, now);
    const dx = e.x2 - e.x;
    const dy = e.y2 - e.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const fx = e.x + ux * 0.55;
    const fy = e.y + uy * 0.55;
    const len = e.radius * (0.5 + fade * 0.7);
    const w = len * 0.35;
    g.moveTo(fx - ux * len * 0.2, fy - uy * len * 0.2);
    g.lineTo(fx - uy * w, fy + ux * w);
    g.lineTo(fx + ux * len, fy + uy * len);
    g.lineTo(fx + uy * w, fy - ux * w);
    g.closePath();
  }
  g.fill();
  for (const e of effects) {
    const t = progress(e, now);
    const fade = 1 - t;
    switch (e.kind) {
      case 'flame': {
        const dx = e.x2 - e.x;
        const dy = e.y2 - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        for (let k = 0; k < 9; k++) {
          const s = ((k / 9 + t * 0.9) % 1) * 1.05;
          const wob = (rnd(e, k) - 0.5) * 0.5 * s;
          const r = (0.06 + 0.24 * s) * 1.4;
          const x = e.x + dx * s - (dy / d) * wob;
          const y = e.y + dy * s + (dx / d) * wob;
          if (s < 0.35) particle('flameCore', x, y, r, 0.95 * fade);
          else if (s < 0.8) particle('fire', x, y, r, 0.9 * fade);
          else particle('smoke', x, y - (s - 0.8) * 0.4, r * 1.1, 0.5 * fade);
        }
        break;
      }
      case 'grenade': {
        const p = arcPoint(e, t, 0.3);
        g.fillStyle = '#2a2a22';
        g.beginPath();
        g.arc(p.x, p.y, e.radius, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(255,220,150,0.6)';
        g.lineWidth = Math.max(0.02, px);
        g.beginPath();
        const q = arcPoint(e, Math.max(0, t - 0.15), 0.3);
        g.moveTo(q.x, q.y);
        g.lineTo(p.x, p.y);
        g.stroke();
        break;
      }
      case 'spit': {
        const p = arcPoint(e, t, 0.22);
        particle('acid', p.x, p.y, e.radius * 2.4, 0.7);
        for (let k = 1; k <= 3; k++) {
          const q = arcPoint(e, Math.max(0, t - k * 0.06), 0.22);
          particle('acid', q.x, q.y, e.radius * (1.2 - k * 0.25), 0.6);
        }
        particle('spark', p.x, p.y, e.radius * 0.8, 1);
        break;
      }
      case 'claw':
        if (fade > 0.01) dots.push({ kind: 'claw', x: e.x, y: e.y, r: CLAW_EXTENT * (e.radius / 0.28), alpha: fade, angle: Math.atan2(e.y - e.y2, e.x - e.x2) });
        break;
      case 'blast': {
        const r = e.radius;
        // flash and fireball
        if (t < 0.18) particle('flameCore', e.x, e.y, r * (0.8 + 0.5 * (t / 0.18)), 1 - t / 0.18);
        if (t < 0.45) particle('fire', e.x, e.y, r * (0.55 + 0.6 * Math.sqrt(t / 0.45)), 1 - t / 0.45);
        // lingering smoke
        for (let k = 0; k < 5; k++) {
          const a = rnd(e, 30 + k) * TAU;
          const d = r * 0.4 * rnd(e, 40 + k);
          particle('smoke', e.x + Math.cos(a) * d + t * 0.25, e.y + Math.sin(a) * d - t * 0.5, r * (0.35 + 0.6 * t), 0.6 * fade * Math.min(1, t * 5));
        }
        g.globalAlpha = 1;
        // shock ring
        if (t < 0.4) {
          const f = t / 0.4;
          g.strokeStyle = `rgba(255,230,180,${0.75 * (1 - f)})`;
          g.lineWidth = Math.max(0.03, 0.1 * (1 - f));
          g.beginPath();
          g.arc(e.x, e.y, r * (0.3 + f * 1.1), 0, TAU);
          g.stroke();
        }
        // debris flying out
        g.fillStyle = `rgba(50,40,30,${Math.min(1, fade * 1.6)})`;
        for (let k = 0; k < 8; k++) {
          const a = rnd(e, k) * TAU;
          const d = r * (0.2 + Math.min(1, t * 2.4) * (0.7 + rnd(e, 10 + k) * 0.6));
          const lift = Math.sin(Math.min(1, t * 2.4) * Math.PI) * 0.3 * rnd(e, 20 + k);
          g.fillRect(e.x + Math.cos(a) * d - 0.04, e.y + Math.sin(a) * d - lift - 0.04, 0.08, 0.08);
        }
        break;
      }
      case 'acid': {
        const r = e.radius * (0.4 + 0.6 * Math.sqrt(t));
        particle('acid', e.x, e.y, r * 1.3, 0.45 * fade);
        for (let k = 0; k < 9; k++) {
          const a = rnd(e, k) * TAU;
          const d = r * (0.5 + rnd(e, 10 + k) * 0.6);
          particle('acid', e.x + Math.cos(a) * d, e.y + Math.sin(a) * d - Math.sin(t * Math.PI) * 0.15, 0.1 + rnd(e, 20 + k) * 0.08, 0.95 * fade);
        }
        break;
      }
      case 'burn': {
        for (let k = 0; k < 8; k++) {
          const a = rnd(e, k) * TAU;
          const rr = e.radius * (0.3 + 0.6 * t);
          particle(k % 3 === 0 ? 'flameCore' : 'fire', e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr - t * 0.3, 0.24, 0.85 * fade);
        }
        break;
      }
      case 'puff': {
        for (let k = 0; k < 3; k++) {
          const a = rnd(e, k) * TAU;
          particle('dust', e.x + Math.cos(a) * 0.15 * t, e.y + Math.sin(a) * 0.15 * t - t * 0.3, e.radius * (0.6 + t * 0.9), 0.6 * fade);
        }
        break;
      }
      case 'debris': {
        // dust cloud
        for (let k = 0; k < 7; k++) {
          const a = rnd(e, k) * TAU;
          const d = e.radius * (0.3 + t * 0.9) * rnd(e, 10 + k);
          particle('dust', e.x + Math.cos(a) * d, e.y + Math.sin(a) * d - t * 0.4, e.radius * (0.5 + t * 0.8), 0.6 * fade);
        }
        g.globalAlpha = 1;
        // chunks
        for (let k = 0; k < 10; k++) {
          const a = rnd(e, 30 + k) * TAU;
          const d = e.radius * Math.min(1, t * 2) * (0.6 + rnd(e, 40 + k) * 0.8);
          const lift = Math.sin(Math.min(1, t * 2) * Math.PI) * 0.5 * rnd(e, 50 + k);
          g.fillStyle = k % 3 === 0 ? `rgba(164,83,43,${fade})` : `rgba(90,82,70,${fade})`;
          g.fillRect(e.x + Math.cos(a) * d - 0.06, e.y + Math.sin(a) * d - lift - 0.06, 0.12, 0.1);
        }
        break;
      }
      case 'order': {
        const r = e.radius * (1 - t * 0.6);
        g.strokeStyle = e.hostile ? `rgba(234,74,54,${fade})` : `rgba(143,230,216,${fade})`;
        g.lineWidth = 2 * px;
        g.beginPath();
        g.arc(e.x, e.y, r, 0, TAU);
        g.stroke();
        g.beginPath();
        g.moveTo(e.x - r * 0.5, e.y);
        g.lineTo(e.x + r * 0.5, e.y);
        g.moveTo(e.x, e.y - r * 0.5);
        g.lineTo(e.x, e.y + r * 0.5);
        g.stroke();
        break;
      }
      default:
        break;
    }
    g.globalAlpha = 1;
  }
  drawDots(g, dt);
}

/**
 * Effect lights per frame. A big fight has well over a hundred flashes, blasts, flames and acid
 * splashes at once, and each light is two sprite copies in the shade layer; past this many only
 * the strongest in view cast light.
 */
export const MAX_EFFECT_LIGHTS = 16;

const strongerFirst = (a: LightSource, b: LightSource) => b.strength * b.radius - a.strength * a.radius;

/**
 * Light cast by effects this frame, appended to `out`: of the lights that reach the screen
 * (`inView(x, y, radius)`), the MAX_EFFECT_LIGHTS strongest by strength times radius.
 */
export function effectLights(effects: readonly VisualEffect[], now: number, inView: (x: number, y: number, margin: number) => boolean, out: LightSource[]): void {
  const lit: LightSource[] = [];
  for (const e of effects) {
    const light = effectLight(e, now);
    if (light && inView(light.x, light.y, light.radius)) lit.push(light);
  }
  if (lit.length > MAX_EFFECT_LIGHTS) lit.sort(strongerFirst).length = MAX_EFFECT_LIGHTS;
  for (const light of lit) out.push(light);
}

function effectLight(e: VisualEffect, now: number): LightSource | null {
  const t = progress(e, now);
  const fade = 1 - t;
  switch (e.kind) {
    case 'flash':
      return { x: e.x, y: e.y, radius: 1.8, strength: 0.7 * fade, color: 'flash' };
    case 'blast':
      return { x: e.x, y: e.y, radius: e.radius * 3.2, strength: Math.max(0, 1 - t * 2.2), color: 'fire' };
    case 'burn':
      return { x: e.x, y: e.y, radius: e.radius * 2.6, strength: fade, color: 'fire' };
    case 'flame':
      return { x: (e.x + e.x2) / 2, y: (e.y + e.y2) / 2, radius: 2.4, strength: 0.8 * fade, color: 'fire' };
    case 'acid':
      return { x: e.x, y: e.y, radius: e.radius * 1.5, strength: 0.4 * fade, color: 'acid' };
    case 'acidPool':
      return { x: e.x, y: e.y, radius: e.radius * 1.3, strength: 0.22 * Math.min(1, fade * 3), color: 'acid' };
    case 'spit':
      return { x: e.x + (e.x2 - e.x) * t, y: e.y + (e.y2 - e.y) * t, radius: 0.9, strength: 0.6, color: 'acid' };
    default:
      return null;
  }
}
