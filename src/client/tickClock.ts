/**
 * Wall-clock to simulation ticks. The simulation has no clock of its own: every animation frame
 * the client turns elapsed time into a whole number of stepGame calls and keeps the remainder,
 * which doubles as the interpolation factor between the last two ticks.
 */
import { TICKS_PER_SECOND } from '../sim';

export type Speed = 1 | 2 | 3;
export const SPEEDS: readonly Speed[] = [1, 2, 3];

/** A slow frame never runs more than this many ticks; the rest of the backlog is dropped. */
export const MAX_STEPS_PER_FRAME = 12;
/** Frames longer than this (tab in background) count as this long. */
const MAX_FRAME_MS = 250;

export function ticksPerSecondAt(speed: Speed): number {
  return TICKS_PER_SECOND * speed;
}

export interface TickAdvance {
  steps: number;
  /** Fraction of the next tick already elapsed, carried to the next frame. */
  carry: number;
  /** Interpolation factor between the previous and the current tick (0..1). */
  alpha: number;
}

export function advanceTicks(carry: number, dtMs: number, speed: Speed, paused: boolean): TickAdvance {
  if (paused) return { steps: 0, carry, alpha: carry };
  const total = carry + (Math.min(dtMs, MAX_FRAME_MS) * ticksPerSecondAt(speed)) / 1000;
  let steps = Math.floor(total);
  let rest = total - steps;
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    rest = 0;
  }
  return { steps, carry: rest, alpha: rest };
}

export function nextSpeed(speed: Speed, delta: 1 | -1): Speed {
  const i = SPEEDS.indexOf(speed) + delta;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))] as Speed;
}
