/**
 * Camera math for the top-down map. World units are tiles; the camera stores the world point at
 * the center of the view and the zoom in CSS pixels per tile. All functions return new cameras.
 */

export interface Camera {
  /** World point (tiles) at the center of the view. */
  x: number;
  y: number;
  /** CSS pixels per tile. */
  zoom: number;
  /** View size in CSS pixels. */
  viewW: number;
  viewH: number;
}

export interface MapSize {
  width: number;
  height: number;
}

/** CSS pixels per tile: units read clearly at the default, the whole fight fits at the minimum. */
export const MIN_ZOOM = 20;
export const MAX_ZOOM = 80;
export const DEFAULT_ZOOM = 44;
/** Keyboard / edge pan speed in CSS pixels per second (independent of zoom). */
export const PAN_SPEED_PX = 900;
export const EDGE_PAN_MARGIN = 8;

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom + cam.viewW / 2, y: (wy - cam.y) * cam.zoom + cam.viewH / 2 };
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.viewW / 2) / cam.zoom + cam.x, y: (sy - cam.viewH / 2) / cam.zoom + cam.y };
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Multiplies the zoom by `factor`, keeping the world point under (sx, sy) where it is on screen. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const anchor = screenToWorld(cam, sx, sy);
  const zoom = clampZoom(cam.zoom * factor);
  return {
    ...cam,
    zoom,
    x: anchor.x - (sx - cam.viewW / 2) / zoom,
    y: anchor.y - (sy - cam.viewH / 2) / zoom,
  };
}

export function panByScreen(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { ...cam, x: cam.x + dxPx / cam.zoom, y: cam.y + dyPx / cam.zoom };
}

/** Keeps the view center on the map. */
export function clampCamera(cam: Camera, map: MapSize): Camera {
  return { ...cam, x: Math.min(map.width, Math.max(0, cam.x)), y: Math.min(map.height, Math.max(0, cam.y)) };
}

export function centerOn(cam: Camera, wx: number, wy: number, map: MapSize): Camera {
  return clampCamera({ ...cam, x: wx, y: wy }, map);
}

export function resizeView(cam: Camera, viewW: number, viewH: number): Camera {
  return { ...cam, viewW, viewH };
}

/** -1/0/1 per axis when the cursor is within `margin` pixels of a view edge. */
export function edgePanDirection(sx: number, sy: number, viewW: number, viewH: number, margin: number): { dx: number; dy: number } {
  const dx = sx <= margin ? -1 : sx >= viewW - 1 - margin ? 1 : 0;
  const dy = sy <= margin ? -1 : sy >= viewH - 1 - margin ? 1 : 0;
  return { dx, dy };
}

/** Tile rectangle (inclusive) to draw, with one tile of margin, clamped to the map. */
export function visibleTileBounds(cam: Camera, map: MapSize): { x0: number; y0: number; x1: number; y1: number } {
  const halfW = cam.viewW / 2 / cam.zoom;
  const halfH = cam.viewH / 2 / cam.zoom;
  return {
    x0: Math.max(0, Math.floor(cam.x - halfW) - 1),
    y0: Math.max(0, Math.floor(cam.y - halfH) - 1),
    x1: Math.min(map.width - 1, Math.ceil(cam.x + halfW) + 1),
    y1: Math.min(map.height - 1, Math.ceil(cam.y + halfH) + 1),
  };
}

/** World rectangle currently on screen. */
export function viewWorldRect(cam: Camera): { x0: number; y0: number; x1: number; y1: number } {
  const halfW = cam.viewW / 2 / cam.zoom;
  const halfH = cam.viewH / 2 / cam.zoom;
  return { x0: cam.x - halfW, y0: cam.y - halfH, x1: cam.x + halfW, y1: cam.y + halfH };
}

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface EdgeAnchor {
  /** Screen point to draw the marker at. */
  x: number;
  y: number;
  /** The target itself lies in the free area: the marker sits on it. */
  onScreen: boolean;
  /** Direction from the screen center to the target (radians, screen axes). */
  angle: number;
}

/** Where on the screen a marker may sit: inside `bounds`, outside every `blocked` rect (HUD panels). */
export interface MarkerArea {
  bounds: ScreenRect;
  blocked: readonly ScreenRect[];
}

const inRect = (r: ScreenRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Along the ray o + t·d (o inside `r`), the t at which it leaves `r`. */
function rayExit(ox: number, oy: number, dx: number, dy: number, r: ScreenRect): number {
  const tx = dx > 0 ? (r.x1 - ox) / dx : dx < 0 ? (r.x0 - ox) / dx : Infinity;
  const ty = dy > 0 ? (r.y1 - oy) / dy : dy < 0 ? (r.y0 - oy) / dy : Infinity;
  return Math.max(0, Math.min(tx, ty));
}

/** Along the ray o + t·d (o outside `r`), the t at which it enters `r`; Infinity if it misses. */
function rayEntry(ox: number, oy: number, dx: number, dy: number, r: ScreenRect): number {
  let enter = 0;
  let leave = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, r.x0, r.x1],
    [oy, dy, r.y0, r.y1],
  ] as const) {
    if (d === 0) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    enter = Math.max(enter, Math.min(t1, t2));
    leave = Math.min(leave, Math.max(t1, t2));
  }
  return enter <= leave ? enter : Infinity;
}

/**
 * Where to pin a marker for the world point (wx, wy): on the point while it lies in the free area
 * (inside `bounds` and outside every blocked rect); otherwise on the line from the screen center
 * toward the point, as far out as that line stays free, so the marker sits at the screen edge, or
 * at the edge of the HUD panel in the way. A blocked rect over the screen center is ignored.
 */
export function edgeAnchor(cam: Camera, wx: number, wy: number, area: MarkerArea): EdgeAnchor {
  const p = worldToScreen(cam, wx, wy);
  const ox = cam.viewW / 2;
  const oy = cam.viewH / 2;
  const dx = p.x - ox;
  const dy = p.y - oy;
  const angle = Math.atan2(dy, dx);
  if (inRect(area.bounds, p.x, p.y) && !area.blocked.some((r) => inRect(r, p.x, p.y))) return { x: p.x, y: p.y, onScreen: true, angle };
  let t = rayExit(ox, oy, dx, dy, area.bounds);
  for (const r of area.blocked) if (!inRect(r, ox, oy)) t = Math.min(t, rayEntry(ox, oy, dx, dy, r));
  return { x: ox + dx * t, y: oy + dy * t, onScreen: false, angle };
}

export function minimapToWorld(mx: number, my: number, miniW: number, miniH: number, map: MapSize): { x: number; y: number } {
  return { x: (mx / miniW) * map.width, y: (my / miniH) * map.height };
}

export function cameraRectOnMinimap(cam: Camera, miniW: number, miniH: number, map: MapSize): { x: number; y: number; w: number; h: number } {
  const r = viewWorldRect(cam);
  const sx = miniW / map.width;
  const sy = miniH / map.height;
  return { x: r.x0 * sx, y: r.y0 * sy, w: (r.x1 - r.x0) * sx, h: (r.y1 - r.y0) * sy };
}
