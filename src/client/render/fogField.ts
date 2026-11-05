/**
 * Per-tile explored / visible levels behind the soft fog of war. They ease toward the
 * simulation's fog state over a short fade instead of popping, and report which tiles changed so
 * the fog image is only rebuilt where needed.
 */
import { FOG_UNEXPLORED, FOG_VISIBLE } from '../../sim';

/** Time for a tile to fade fully in or out of sight. */
export const FOG_FADE_MS = 280;

export interface FogLevels {
  /** 0 never seen, 1 explored (only grows). */
  explored: Float32Array;
  /** 0 out of sight, 1 in sight. */
  visible: Float32Array;
}

const exploredTarget = (f: number) => (f === FOG_UNEXPLORED ? 0 : 1);
const visibleTarget = (f: number) => (f === FOG_VISIBLE ? 1 : 0);

export function createFogLevels(fog: ArrayLike<number>): FogLevels {
  const explored = new Float32Array(fog.length);
  const visible = new Float32Array(fog.length);
  for (let i = 0; i < fog.length; i++) {
    explored[i] = exploredTarget(fog[i] as number);
    visible[i] = visibleTarget(fog[i] as number);
  }
  return { explored, visible };
}

/** Changed tile rectangle (inclusive), or null when every level already sits on its target. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

/** Moves every level toward its target by dtMs / FOG_FADE_MS. */
export function easeFogLevels(levels: FogLevels, fog: ArrayLike<number>, width: number, dtMs: number): TileRect | null {
  const step = Math.max(0, dtMs) / FOG_FADE_MS;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const { explored, visible } = levels;
  for (let i = 0; i < fog.length; i++) {
    const f = fog[i] as number;
    const e = explored[i] as number;
    const v = visible[i] as number;
    const te = exploredTarget(f);
    const tv = visibleTarget(f);
    if (e === te && v === tv) continue;
    explored[i] = approach(e, te, step);
    visible[i] = approach(v, tv, step);
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
