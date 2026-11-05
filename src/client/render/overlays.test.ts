import { describe, expect, it } from 'vitest';
import { edgeAnchor, type Camera, type ScreenRect } from '../camera';
import { commandFlags, markerArea, unitBarRect, type UnitMark } from './overlays';

// The HUD at 1440x900 as it stands in e2e/screenshots/v2-14-night-rustStorm.png: top bar, tonight's
// forecast, the pause banner, the event log, the minimap, the opening guide and the build dock.
const PANELS: ScreenRect[] = [
  { x0: 8, y0: 8, x1: 1432, y1: 48 },
  { x0: 956, y0: 55, x1: 1037, y1: 78 },
  { x0: 585, y0: 57, x1: 855, y1: 87 },
  { x0: 8, y0: 57, x1: 160, y1: 77 },
  { x0: 8, y0: 82, x1: 195, y1: 189 },
  { x0: 8, y0: 693, x1: 235, y1: 891 },
  { x0: 1113, y0: 619, x1: 1431, y1: 737 },
  { x0: 1093, y0: 744, x1: 1431, y1: 891 },
];
const cam: Camera = { x: 50, y: 50, zoom: 44, viewW: 1440, viewH: 900 };
/** The arrow reaches about this far from its anchor (the threat marker's double chevron). */
const ARROW = 20;

/** World point at screen (sx, sy). */
const world = (sx: number, sy: number) => ({ x: cam.x + (sx - cam.viewW / 2) / cam.zoom, y: cam.y + (sy - cam.viewH / 2) / cam.zoom });

function clearOfHud(p: { x: number; y: number }): boolean {
  const onScreen = p.x - ARROW >= 0 && p.y - ARROW >= 0 && p.x + ARROW <= cam.viewW && p.y + ARROW <= cam.viewH;
  return onScreen && PANELS.every((r) => p.x + ARROW <= r.x0 || p.x - ARROW >= r.x1 || p.y + ARROW <= r.y0 || p.y - ARROW >= r.y1);
}

describe('markerArea', () => {
  it('an off-screen relay below the core gets its arrow at the bottom edge of the screen, not on the buildings next to the core', () => {
    const relay = world(735, 960);
    const a = edgeAnchor(cam, relay.x, relay.y, markerArea(cam, PANELS));
    expect(a.onScreen).toBe(false);
    expect(a.y).toBeGreaterThanOrEqual(cam.viewH - 40);
    expect(clearOfHud(a)).toBe(true);
  });

  it('in every direction the arrow stays on screen and clear of every HUD panel', () => {
    const area = markerArea(cam, PANELS);
    for (let k = 0; k < 72; k++) {
      const angle = (k / 72) * 2 * Math.PI;
      const target = world(cam.viewW / 2 + Math.cos(angle) * 3000, cam.viewH / 2 + Math.sin(angle) * 3000);
      const a = edgeAnchor(cam, target.x, target.y, area);
      expect(a.onScreen).toBe(false);
      expect(clearOfHud(a), `direction ${k * 5} degrees: (${a.x.toFixed(0)}, ${a.y.toFixed(0)})`).toBe(true);
    }
  });

  it('a target on screen in the free area keeps its marker on the spot', () => {
    const p = world(735, 640);
    expect(edgeAnchor(cam, p.x, p.y, markerArea(cam, PANELS))).toMatchObject({ onScreen: true });
  });
});

describe('commandFlags', () => {
  const DEFAULT_PX = 1 / 44;
  const MIN_PX = 1 / 10.9;
  const rifleman = (x: number, commanded: boolean): UnitMark => ({ x, y: 5, d: 0.62, player: true, commanded });

  it('flags only the units under player command', () => {
    const flags = commandFlags([rifleman(1, false), rifleman(2, true), { x: 3, y: 5, d: 0.7, player: false, commanded: false }], DEFAULT_PX);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.x).toBeLessThan(2);
  });

  it('stands at the upper left of the unit, clear of its health bar and of the veteran star at the upper right', () => {
    for (const px of [DEFAULT_PX, MIN_PX]) {
      const m = rifleman(2, true);
      const f = commandFlags([m], px)[0]!;
      const bar = unitBarRect(m, px);
      const pennant = { x0: Math.min(f.x, f.tipX), x1: Math.max(f.x, f.tipX), y0: f.topY, y1: f.lowY };
      const pole = { x0: f.x, x1: f.x, y0: f.topY, y1: f.baseY };
      for (const part of [pennant, pole]) {
        const overlaps = part.x0 < bar.x + bar.w + px && part.x1 > bar.x - px && part.y0 < bar.y + bar.h + px && part.y1 > bar.y - px;
        expect(overlaps, `zoom ${Math.round(1 / px)}`).toBe(false);
      }
      expect(pennant.x1).toBeLessThan(m.x + m.d * 0.42 - 0.13);
    }
  });

  it('keeps a readable size in screen pixels when zoomed all the way out', () => {
    const atDefault = commandFlags([rifleman(2, true)], DEFAULT_PX)[0]!;
    const atMin = commandFlags([rifleman(2, true)], MIN_PX)[0]!;
    expect((atDefault.baseY - atDefault.topY) / DEFAULT_PX).toBeGreaterThanOrEqual(10);
    expect((atMin.baseY - atMin.topY) / MIN_PX).toBeGreaterThanOrEqual(7);
    expect(Math.abs(atMin.tipX - atMin.x) / MIN_PX).toBeGreaterThanOrEqual(4);
  });
});
