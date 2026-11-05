/**
 * Unit art cached as bitmaps: each (unit type, facing, animation frame, scale) is painted once
 * with the procedural painters in drawUnits.ts and then blitted. Painting happens at device
 * resolution with a screen-space light pass (lit top-left, darker bottom-right) laid over the
 * rotated art, so shading stays consistent whichever way a unit faces. While the zoom moves,
 * sprites are painted at shared zoom steps (about 9% apart) and drawn slightly scaled; once it
 * holds still they are repainted at the exact scale and copied 1:1 at whole device pixels, which
 * is both crisper and several times cheaper on software rasterizers. At most
 * MAX_NEW_SPRITES_PER_FRAME sprites are painted per frame; the rest borrow the nearest cached
 * scale until their turn comes.
 */
import type { MutantType, SoldierType } from '../../sim/data/combat';
import { paintMutant, paintSoldier, paintSurvivor, type UnitFrame } from './drawUnits';
import { outlinePx } from './palette';
import type { DeviceTransform } from './pixelSprites';
import { bucketAngle } from './unitPose';

export type SpriteSubject = { kind: 'survivor' } | { kind: 'soldier'; type: SoldierType } | { kind: 'mutant'; type: MutantType };

/** Drawn body diameter in tiles (art direction sizes; the painters are designed at this size). */
const SOLDIER_DIAMETER: Record<SoldierType, number> = {
  shieldGuard: 0.74,
  rifleman: 0.7,
  sniper: 0.7,
  grenadier: 0.7,
  scout: 0.7,
  flamethrower: 0.7,
  pickup: 1.2,
};
const MUTANT_DIAMETER: Record<MutantType, number> = {
  runner: 0.6,
  wanderer: 0.7,
  spitter: 0.8,
  boomer: 0.9,
  crawler: 1.1,
  behemoth: 2.0,
};
const SURVIVOR_DIAMETER = 0.56;

/** Half the sprite side in tiles: room for barrels, limbs and dust, no more. */
const SOLDIER_EXTENT: Record<SoldierType, number> = {
  shieldGuard: 0.52,
  rifleman: 0.6,
  sniper: 0.93,
  grenadier: 0.52,
  scout: 0.8,
  flamethrower: 0.66,
  pickup: 0.85,
};
const MUTANT_EXTENT: Record<MutantType, number> = {
  runner: 0.46,
  wanderer: 0.54,
  spitter: 0.5,
  boomer: 0.52,
  crawler: 0.7,
  behemoth: 1.22,
};
const SURVIVOR_EXTENT = 0.36;

export function drawDiameter(subject: SpriteSubject): number {
  if (subject.kind === 'soldier') return SOLDIER_DIAMETER[subject.type];
  return subject.kind === 'mutant' ? MUTANT_DIAMETER[subject.type] : SURVIVOR_DIAMETER;
}

function extentOf(subject: SpriteSubject): number {
  if (subject.kind === 'soldier') return SOLDIER_EXTENT[subject.type];
  return subject.kind === 'mutant' ? MUTANT_EXTENT[subject.type] : SURVIVOR_EXTENT;
}

/** Device pixels per tile rounded to steps of about 9%, so zooming does not repaint every frame. */
export function zoomStep(pxPerTile: number): number {
  return Math.pow(2, Math.round(Math.log2(pxPerTile) * 8) / 8);
}

/** Frames the zoom must hold still before sprites are painted at its exact scale. */
export const SETTLE_FRAMES = 12;

/** The scale (device px per tile) to paint sprites at, given how many frames the zoom has held still. */
export function spriteScale(devicePx: number, stillFrames: number): number {
  return stillFrames >= SETTLE_FRAMES ? Math.round(devicePx * 100) / 100 : zoomStep(devicePx);
}

function subjectId(subject: SpriteSubject): string {
  return subject.kind === 'survivor' ? 'survivor' : `${subject.kind}:${subject.type}`;
}

/** Cache key of a sprite at every scale: the unit type, facing and animation frame. */
export function spriteKey(subject: SpriteSubject, bucket: number, frame: UnitFrame): string {
  return `${subjectId(subject)}:${bucket}:${frame}`;
}

/** The cached step closest in scale (ratio) to `step`, or null. */
export function nearestStep(steps: Iterable<number>, step: number): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const s of steps) {
    const gap = Math.abs(Math.log(s / step));
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

const MAX_SPRITES = 3000;
const MAX_NEW_SPRITES_PER_FRAME = 40;
/** Light direction on screen (from the top-left). */
const LIGHT = { x: -0.6, y: -0.8 };

/** subject:bucket:frame -> scale -> sprite */
const cache = new Map<string, Map<number, HTMLCanvasElement>>();
let cached = 0;
let budget = MAX_NEW_SPRITES_PER_FRAME;
let lastDevicePx = 0;
let stillFrames = 0;
let frameScale = 1;

/** Call once per frame before drawing units, with the frame's device px per tile (zoom x dpr). */
export function beginSpriteFrame(devicePx: number): void {
  budget = MAX_NEW_SPRITES_PER_FRAME;
  stillFrames = devicePx === lastDevicePx ? stillFrames + 1 : 0;
  lastDevicePx = devicePx;
  frameScale = spriteScale(devicePx, stillFrames);
}

function paintSprite(subject: SpriteSubject, bucket: number, frame: UnitFrame, step: number): HTMLCanvasElement {
  const half = extentOf(subject) + 0.04;
  const size = Math.max(4, Math.ceil(half * 2 * step) + 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const a = bucketAngle(bucket);
  g.translate(size / 2, size / 2);
  g.scale(step, step);
  g.rotate(a);
  const cos = Math.cos(-a);
  const sin = Math.sin(-a);
  const pen = { g, ol: outlinePx(step) / step, lx: LIGHT.x * cos - LIGHT.y * sin, ly: LIGHT.x * sin + LIGHT.y * cos };
  const pose: UnitFrame = frame === 'dead' ? 'idle' : frame;
  if (subject.kind === 'soldier') paintSoldier(pen, subject.type, pose);
  else if (subject.kind === 'mutant') paintMutant(pen, subject.type, pose);
  else paintSurvivor(pen, pose);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, 0, size, size);
  shade.addColorStop(0, 'rgba(255,246,222,0.16)');
  shade.addColorStop(0.5, 'rgba(255,246,222,0)');
  shade.addColorStop(1, 'rgba(24,12,4,0.22)');
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);
  if (frame === 'dead') {
    g.fillStyle = 'rgba(46,34,28,0.55)';
    g.fillRect(0, 0, size, size);
  }
  return canvas;
}

/** The scale sprites are painted at this frame (see beginSpriteFrame). */
export function frameSpriteScale(): number {
  return frameScale;
}

/** The sprite for this frame's scale, or the nearest cached one while the paint budget is spent. */
export function unitSprite(subject: SpriteSubject, bucket: number, frame: UnitFrame): { canvas: HTMLCanvasElement; scale: number } {
  const base = spriteKey(subject, bucket, frame);
  let steps = cache.get(base);
  const hit = steps?.get(frameScale);
  if (hit) return { canvas: hit, scale: frameScale };
  const fallback = steps && budget <= 0 ? nearestStep(steps.keys(), frameScale) : null;
  if (fallback !== null) return { canvas: steps?.get(fallback) as HTMLCanvasElement, scale: fallback };
  if (cached >= MAX_SPRITES) {
    cache.clear();
    cached = 0;
  }
  const canvas = paintSprite(subject, bucket, frame, frameScale);
  budget--;
  cached++;
  steps = cache.get(base) ?? new Map();
  steps.set(frameScale, canvas);
  cache.set(base, steps);
  return { canvas, scale: frameScale };
}

/**
 * Draws the unit centered on world (x, y). The context must have the identity transform; `t` maps
 * world tiles to device pixels. A sprite at the exact scale is copied 1:1 at whole pixels.
 */
export function blitUnit(ctx: CanvasRenderingContext2D, t: DeviceTransform, subject: SpriteSubject, bucket: number, frame: UnitFrame, x: number, y: number): void {
  const { canvas, scale } = unitSprite(subject, bucket, frame);
  const cx = x * t.k + t.ox;
  const cy = y * t.k + t.oy;
  const ratio = t.k / scale;
  if (Math.abs(ratio - 1) < 0.001) {
    ctx.drawImage(canvas, Math.round(cx - canvas.width / 2), Math.round(cy - canvas.height / 2));
    return;
  }
  const side = canvas.width * ratio;
  ctx.drawImage(canvas, cx - side / 2, cy - side / 2, side, side);
}

/** Paints one sprite directly into `g` at the current transform (HUD portraits; not cached here). */
export function paintUnitPortrait(g: CanvasRenderingContext2D, subject: SpriteSubject, angle: number, pxPerTile: number): void {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  g.save();
  g.rotate(angle);
  const pen = { g, ol: outlinePx(pxPerTile) / pxPerTile, lx: LIGHT.x * cos - LIGHT.y * sin, ly: LIGHT.x * sin + LIGHT.y * cos };
  if (subject.kind === 'soldier') paintSoldier(pen, subject.type, 'idle');
  else if (subject.kind === 'mutant') paintMutant(pen, subject.type, 'idle');
  else paintSurvivor(pen, 'idle');
  g.restore();
}

/** Half sprite side in tiles, for portraits that need to fit the whole unit. */
export function spriteExtent(subject: SpriteSubject): number {
  return extentOf(subject);
}
