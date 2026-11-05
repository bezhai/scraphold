/**
 * Browser event wiring: turns mouse, wheel and keyboard events on the game canvas into Session
 * calls (with screen-to-world conversion), tracks held pan keys and the cursor for edge panning.
 * All decisions live in the pure input modules and Session; this file only translates events.
 */
import { EDGE_PAN_MARGIN, edgePanDirection, screenToWorld } from '../camera';
import type { Session } from '../session';
import { actionForKey, isPanKey, panDirectionFromKeys } from './keymap';

const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MS = 320;

export interface DomInput {
  /** Applies keyboard and edge panning for this frame. */
  pan(dtMs: number): void;
  detach(): void;
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

export function attachInput(canvas: HTMLCanvasElement, session: Session, now: () => number): DomInput {
  const held = new Set<string>();
  let cursor: { x: number; y: number } | null = null;
  let press: { x: number; y: number; box: boolean } | null = null;
  let middle: { x: number; y: number } | null = null;
  let lastClick: { x: number; y: number; at: number } | null = null;

  const local = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const world = (p: { x: number; y: number }) => screenToWorld(session.camera, p.x, p.y);

  const onMouseDown = (e: MouseEvent) => {
    const p = local(e);
    if (e.button === 0) {
      press = { x: p.x, y: p.y, box: false };
    } else if (e.button === 2) {
      const w = world(p);
      session.rightClick(w.x, w.y, { ctrl: e.ctrlKey || e.metaKey }, now());
    } else if (e.button === 1) {
      middle = p;
      e.preventDefault();
    }
  };

  // On the window, not the canvas: a middle-button drag goes on while the cursor crosses HUD panels.
  const onWindowMouseMove = (e: MouseEvent) => {
    cursor = local(e);
    if (middle) {
      const cam = session.camera;
      session.centerOn(cam.x - (cursor.x - middle.x) / cam.zoom, cam.y - (cursor.y - middle.y) / cam.zoom);
      middle = cursor;
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    const p = local(e);
    session.hover = world(p);
    if (press && !session.placing) {
      if (!press.box && Math.abs(p.x - press.x) + Math.abs(p.y - press.y) > DRAG_THRESHOLD_PX) press.box = true;
      if (press.box) session.dragBox = { x0: press.x, y0: press.y, x1: p.x, y1: p.y };
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 1) middle = null;
    if (e.button !== 0 || !press) return;
    const p = local(e);
    const start = press;
    press = null;
    session.dragBox = null;
    if (start.box) {
      const a = world(start);
      const b = world(p);
      session.boxSelect({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }, e.shiftKey);
      lastClick = null;
      return;
    }
    const t = now();
    const double = lastClick !== null && t - lastClick.at < DOUBLE_CLICK_MS && Math.abs(lastClick.x - p.x) + Math.abs(lastClick.y - p.y) < 8;
    lastClick = double ? null : { x: p.x, y: p.y, at: t };
    const w = world(p);
    session.leftClick(w.x, w.y, { shift: e.shiftKey, double }, t);
  };

  const onLeave = () => {
    session.hover = null;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    session.zoom(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTextInput(e.target)) return;
    // A HUD button keeps focus after a click; Space would also "press" it on key up.
    if (e.target instanceof HTMLButtonElement) e.target.blur();
    if (isPanKey(e.code)) {
      held.add(e.code);
      e.preventDefault();
      return;
    }
    const action = actionForKey(e, { modal: session.modalCard });
    if (!action) return;
    // Also on repeats: a held Tab would otherwise move the browser focus between HUD buttons.
    e.preventDefault();
    if (!e.repeat) session.handleKey(action, now());
  };

  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code);
  };

  const onBlur = () => {
    held.clear();
    press = null;
    middle = null;
    session.dragBox = null;
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    pan(dtMs) {
      // A modal card (intro, incident) holds the camera until it is closed.
      if (session.modalCard) return;
      const keys = panDirectionFromKeys(held);
      let dx = keys.dx;
      let dy = keys.dy;
      if (cursor && document.hasFocus()) {
        const inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x < session.camera.viewW && cursor.y < session.camera.viewH;
        if (inside) {
          const edge = edgePanDirection(cursor.x, cursor.y, session.camera.viewW, session.camera.viewH, EDGE_PAN_MARGIN);
          dx = Math.sign(dx + edge.dx);
          dy = Math.sign(dy + edge.dy);
        }
      }
      session.pan(dx, dy, dtMs);
    },
    detach() {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
