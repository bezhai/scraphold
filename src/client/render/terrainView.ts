/**
 * The terrain as shown at the current zoom: the visible region plus a margin, cached pre-scaled
 * to exactly the device pixels per tile, so each frame copies it 1:1 without filtering (a filtered
 * full-screen stretch costs several times more on software-rendered canvases). The cache is
 * rebuilt when the view leaves it or the zoom settles at a new value; while the zoom is changing
 * the terrain is stretched directly.
 */
import type { Camera, MapSize } from '../camera';
import { viewWorldRect } from '../camera';
import { TILE_PX } from './terrainLayer';

export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Whole-tile rectangle covering `view` plus `margin` x its size on each side, inside the map. */
export function coverRect(view: TileRect, map: MapSize, margin: number): TileRect {
  const mx = (view.x1 - view.x0) * margin;
  const my = (view.y1 - view.y0) * margin;
  return {
    x0: Math.max(0, Math.floor(view.x0 - mx)),
    y0: Math.max(0, Math.floor(view.y0 - my)),
    x1: Math.min(map.width, Math.ceil(view.x1 + mx)),
    y1: Math.min(map.height, Math.ceil(view.y1 + my)),
  };
}

/** Whether `inner`, clamped to the map, lies inside `outer`. */
export function rectContains(outer: TileRect, inner: TileRect, map: MapSize): boolean {
  return (
    outer.x0 <= Math.max(0, inner.x0) &&
    outer.y0 <= Math.max(0, inner.y0) &&
    outer.x1 >= Math.min(map.width, inner.x1) &&
    outer.y1 >= Math.min(map.height, inner.y1)
  );
}

const MARGIN = 0.25;
/** The zoom must hold still this long before the cache is rebuilt at the new scale. */
const SETTLE_MS = 180;

export interface TerrainView {
  /** Draws the terrain behind everything (leaves the context transform at identity). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, now: number): void;
}

export function createTerrainView(terrain: HTMLCanvasElement, map: MapSize): TerrainView {
  const cache = document.createElement('canvas');
  const cg = cache.getContext('2d') as CanvasRenderingContext2D;
  let rect: TileRect | null = null;
  let scale = 0;
  let lastZoom = 0;
  let zoomedAt = -Infinity;

  return {
    draw(ctx, cam, dpr, now) {
      const devicePx = cam.zoom * dpr;
      if (cam.zoom !== lastZoom) {
        lastZoom = cam.zoom;
        zoomedAt = now;
      }
      const view = viewWorldRect(cam);
      const ox = (cam.viewW / 2 - cam.x * cam.zoom) * dpr;
      const oy = (cam.viewH / 2 - cam.y * cam.zoom) * dpr;
      if (now - zoomedAt < SETTLE_MS) {
        const r = coverRect(view, map, 0);
        ctx.setTransform(devicePx, 0, 0, devicePx, ox, oy);
        ctx.imageSmoothingEnabled = true;
        const w = r.x1 - r.x0;
        const h = r.y1 - r.y0;
        ctx.drawImage(terrain, r.x0 * TILE_PX, r.y0 * TILE_PX, w * TILE_PX, h * TILE_PX, r.x0, r.y0, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }
      if (!rect || scale !== devicePx || !rectContains(rect, view, map)) {
        rect = coverRect(view, map, MARGIN);
        scale = devicePx;
        const w = rect.x1 - rect.x0;
        const h = rect.y1 - rect.y0;
        cache.width = Math.ceil(w * devicePx);
        cache.height = Math.ceil(h * devicePx);
        cg.imageSmoothingEnabled = true;
        cg.drawImage(terrain, rect.x0 * TILE_PX, rect.y0 * TILE_PX, w * TILE_PX, h * TILE_PX, 0, 0, w * devicePx, h * devicePx);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cache, Math.round(rect.x0 * devicePx + ox), Math.round(rect.y0 * devicePx + oy));
    },
  };
}
