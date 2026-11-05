// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { measureHudPanels, saveOnPageHide } from './GameScreen';

describe('saveOnPageHide', () => {
  it('writes the autosave when the page is hidden or closed, not when it becomes visible again', () => {
    const session = { autoSave: vi.fn() };
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const detach = saveOnPageHide(session, win, doc);

    doc.dispatchEvent(new Event('visibilitychange'));
    expect(session.autoSave).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(session.autoSave).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('pagehide'));
    expect(session.autoSave).toHaveBeenCalledTimes(2);

    detach();
    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(session.autoSave).toHaveBeenCalledTimes(2);
  });
});

describe('measureHudPanels', () => {
  /** An element of class `cls` laid out at (x, y, w, h) in page coordinates. */
  function box(cls: string, x: number, y: number, w: number, h: number, ...children: HTMLElement[]): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    el.append(...children);
    el.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}) });
    return el;
  }

  it('gives the screen rect of every HUD panel showing, relative to the HUD layer; hidden panels and toasts are left out', () => {
    const hud = box(
      'hud',
      10,
      5,
      1440,
      900,
      box('topbar', 18, 13, 1424, 40, box('tb-group', 18, 13, 600, 40), box('forecast', 966, 59, 80, 24)),
      box('eventlog', 18, 61, 360, 140, box('log-head', 18, 61, 150, 20), box('log-lines', 18, 85, 190, 110)),
      box('toasts', 600, 600, 200, 30, box('toast', 600, 600, 200, 30)),
      box('banners', 590, 61, 270, 31, box('banner pause', 590, 61, 270, 31)),
      box(
        'bottom',
        18,
        690,
        1424,
        207,
        box('map-col', 18, 690, 228, 207, box('terrain-hint', 18, 660, 150, 26), box('panel minimap-panel', 18, 698, 228, 199)),
        box('panel selection-panel', 380, 710, 600, 187),
        box('dock-col', 1100, 620, 340, 277, box('panel guide', 1120, 620, 320, 0), box('panel build-dock', 1100, 750, 340, 147)),
      ),
    );
    expect(measureHudPanels(hud)).toEqual([
      { x0: 8, y0: 8, x1: 1432, y1: 48 },
      { x0: 956, y0: 54, x1: 1036, y1: 78 },
      { x0: 8, y0: 56, x1: 158, y1: 76 },
      { x0: 8, y0: 80, x1: 198, y1: 190 },
      { x0: 580, y0: 56, x1: 850, y1: 87 },
      { x0: 8, y0: 655, x1: 158, y1: 681 },
      { x0: 8, y0: 693, x1: 236, y1: 892 },
      { x0: 370, y0: 705, x1: 970, y1: 892 },
      { x0: 1090, y0: 745, x1: 1430, y1: 892 },
    ]);
  });
});
