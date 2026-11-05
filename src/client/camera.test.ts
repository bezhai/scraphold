import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  cameraRectOnMinimap,
  centerOn,
  clampCamera,
  edgeAnchor,
  edgePanDirection,
  minimapToWorld,
  panByScreen,
  screenToWorld,
  visibleTileBounds,
  worldToScreen,
  zoomAt,
  type Camera,
} from './camera';

const cam: Camera = { x: 32, y: 24, zoom: 20, viewW: 800, viewH: 600 };
const MAP = { width: 64, height: 48 };

describe('camera transforms', () => {
  it('maps the camera center to the middle of the view', () => {
    expect(worldToScreen(cam, 32, 24)).toEqual({ x: 400, y: 300 });
  });

  it('scales world distances by zoom (px per tile)', () => {
    expect(worldToScreen(cam, 33, 25)).toEqual({ x: 420, y: 320 });
  });

  it('screenToWorld inverts worldToScreen', () => {
    const s = worldToScreen(cam, 10.25, 40.5);
    const w = screenToWorld(cam, s.x, s.y);
    expect(w.x).toBeCloseTo(10.25);
    expect(w.y).toBeCloseTo(40.5);
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const before = screenToWorld(cam, 100, 80);
    const z = zoomAt(cam, 100, 80, 1.5);
    expect(z.zoom).toBeCloseTo(30);
    const after = screenToWorld(z, 100, 80);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('follows the art direction: about 44 px per tile by default, 20 to 80 px per tile range', () => {
    expect(DEFAULT_ZOOM).toBe(44);
    expect(MIN_ZOOM).toBe(20);
    expect(MAX_ZOOM).toBe(80);
  });

  it('clamps zoom to [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(zoomAt(cam, 400, 300, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(cam, 400, 300, 0.001).zoom).toBe(MIN_ZOOM);
  });
});

describe('panning and clamping', () => {
  it('panByScreen moves the center by screen pixels converted to tiles', () => {
    const p = panByScreen(cam, 40, -20);
    expect(p.x).toBeCloseTo(34);
    expect(p.y).toBeCloseTo(23);
  });

  it('clampCamera keeps the center inside the map', () => {
    expect(clampCamera({ ...cam, x: -10, y: 100 }, MAP)).toMatchObject({ x: 0, y: 48 });
    expect(clampCamera(cam, MAP)).toMatchObject({ x: 32, y: 24 });
  });

  it('centerOn moves the center and clamps', () => {
    expect(centerOn(cam, 70, 10, MAP)).toMatchObject({ x: 64, y: 10 });
  });

  it('edgePanDirection points toward the edge the cursor touches', () => {
    expect(edgePanDirection(2, 300, 800, 600, 10)).toEqual({ dx: -1, dy: 0 });
    expect(edgePanDirection(799, 599, 800, 600, 10)).toEqual({ dx: 1, dy: 1 });
    expect(edgePanDirection(400, 300, 800, 600, 10)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('visible bounds and minimap', () => {
  it('visibleTileBounds covers the view, clamped to the map, with a margin tile', () => {
    // view spans 40 x 30 tiles around (32, 24) => x 12..52, y 9..39
    expect(visibleTileBounds(cam, MAP)).toEqual({ x0: 11, y0: 8, x1: 53, y1: 40 });
    expect(visibleTileBounds({ ...cam, x: 0, y: 0 }, MAP)).toEqual({ x0: 0, y0: 0, x1: 21, y1: 16 });
  });

  it('minimapToWorld scales minimap pixels to tiles', () => {
    expect(minimapToWorld(96, 72, 192, 144, MAP)).toEqual({ x: 32, y: 24 });
  });

  it('cameraRectOnMinimap gives the view rectangle in minimap pixels', () => {
    // 40 x 30 tiles at 3 px per tile
    expect(cameraRectOnMinimap(cam, 192, 144, MAP)).toEqual({ x: 36, y: 27, w: 120, h: 90 });
  });
});

describe('edgeAnchor', () => {
  // 800x600 view, camera center at screen (400, 300); markers stay 20 px inside the screen edges and
  // off two bottom-corner panels (a minimap on the left, a dock on the right).
  const bounds = { x0: 20, y0: 20, x1: 780, y1: 580 };
  const minimap = { x0: 0, y0: 420, x1: 200, y1: 600 };
  const dock = { x0: 560, y0: 300, x1: 800, y1: 600 };
  const area = { bounds, blocked: [minimap, dock] };

  it('pins a marker on the point itself while it lies in the free area', () => {
    expect(edgeAnchor(cam, 33, 25, area)).toMatchObject({ onScreen: true, x: 420, y: 320 });
  });

  it('puts an off-screen point at the screen edge on the line from the screen center, pointing at it', () => {
    const north = edgeAnchor(cam, 32, 0, area);
    expect(north).toMatchObject({ onScreen: false, x: 400, y: 20 });
    expect(north.angle).toBeCloseTo(-Math.PI / 2);
    const west = edgeAnchor(cam, 0, 24, area);
    expect(west).toMatchObject({ onScreen: false, x: 20, y: 300 });
    expect(west.angle).toBeCloseTo(Math.PI);
  });

  it('a point due south, between the bottom panels, gets its marker right at the bottom edge, not halfway up the screen', () => {
    expect(edgeAnchor(cam, 32, 60, area)).toMatchObject({ onScreen: false, x: 400, y: 580 });
  });

  it('stops at the edge of a HUD panel in the way', () => {
    // Screen (1000, 900), down-right at 45 degrees: the line enters the dock at x 560.
    const a = edgeAnchor(cam, 62, 54, area);
    expect(a.onScreen).toBe(false);
    expect(a.x).toBeCloseTo(560);
    expect(a.y).toBeCloseTo(460);
    expect(a.angle).toBeCloseTo(Math.PI / 4);
  });

  it('treats a point on screen but under a panel as hidden: the marker sits at the panel edge toward it', () => {
    // Screen (700, 500) is under the dock.
    const a = edgeAnchor(cam, 47, 34, area);
    expect(a.onScreen).toBe(false);
    expect(a.x).toBeCloseTo(560);
    expect(a.y).toBeCloseTo(300 + (160 * 200) / 300);
  });

  it('ignores a panel over the screen center (a tiny window) instead of pinning every marker to the center', () => {
    const center = { x0: 300, y0: 200, x1: 500, y1: 400 };
    expect(edgeAnchor(cam, 32, 0, { bounds, blocked: [center] })).toMatchObject({ onScreen: false, x: 400, y: 20 });
  });
});
