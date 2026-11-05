/**
 * Static building and nest bodies cached as bitmaps per (type, damage stage, scale), with a margin
 * around the footprint for props that stick out. The renderer blits these and draws only the live
 * layer (moving parts, smoke, lights) procedurally each frame. Scales follow the unit sprites
 * (unitSprites.ts): shared zoom steps while zooming, the exact zoom once it holds still, where the
 * body is copied 1:1 at whole device pixels. A few new bodies are painted per frame; the others
 * borrow the nearest cached scale meanwhile.
 */
import type { BuildingType } from '../../sim/data/economy';
import { paintBuildingBody, paintNestBody } from './drawBuildings';
import { frameSpriteScale, nearestStep } from './unitSprites';

/** Tiles of margin around a footprint in the cached bitmap. */
const MARGIN = 0.75;
const MAX_SPRITES = 400;
const MAX_NEW_PER_FRAME = 3;
/** body key -> scale -> bitmap */
const cache = new Map<string, Map<number, HTMLCanvasElement>>();
let cached = 0;
let budget = MAX_NEW_PER_FRAME;

/** Call once per frame before drawing structures. */
export function beginStructureFrame(): void {
  budget = MAX_NEW_PER_FRAME;
}

function cachedSprite(key: string, size: number, paint: (g: CanvasRenderingContext2D, scale: number) => void): { canvas: HTMLCanvasElement; scale: number } {
  const scale = frameSpriteScale();
  let scales = cache.get(key);
  const hit = scales?.get(scale);
  if (hit) return { canvas: hit, scale };
  const fallback = scales && budget <= 0 ? nearestStep(scales.keys(), scale) : null;
  if (fallback !== null) return { canvas: scales?.get(fallback) as HTMLCanvasElement, scale: fallback };
  if (cached >= MAX_SPRITES) {
    cache.clear();
    cached = 0;
    scales = undefined;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil((size + MARGIN * 2) * scale);
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.scale(scale, scale);
  g.translate(MARGIN, MARGIN);
  paint(g, scale);
  budget--;
  cached++;
  scales = scales ?? new Map();
  scales.set(scale, canvas);
  cache.set(key, scales);
  return { canvas, scale };
}

function blit(ctx: CanvasRenderingContext2D, sprite: { canvas: HTMLCanvasElement; scale: number }, tileX: number, tileY: number): void {
  const m = ctx.getTransform();
  if (Math.abs(m.a / sprite.scale - 1) < 0.001) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sprite.canvas, Math.round((tileX - MARGIN) * m.a + m.e), Math.round((tileY - MARGIN) * m.d + m.f));
    ctx.setTransform(m);
    return;
  }
  const side = sprite.canvas.width / sprite.scale;
  ctx.drawImage(sprite.canvas, tileX - MARGIN, tileY - MARGIN, side, side);
}

/** Draws a complete building's static body at its footprint (world transform set). */
export function blitBuildingBody(ctx: CanvasRenderingContext2D, type: BuildingType, size: number, stage: number, tileX: number, tileY: number): void {
  blit(ctx, cachedSprite(`b:${type}:${size}:${stage}`, size, (g, scale) => paintBuildingBody(g, type, size, stage, scale)), tileX, tileY);
}

export function blitNestBody(ctx: CanvasRenderingContext2D, size: number, isHive: boolean, tileX: number, tileY: number): void {
  blit(ctx, cachedSprite(`n:${isHive}:${size}`, size, (g, scale) => paintNestBody(g, size, isHive, scale)), tileX, tileY);
}
