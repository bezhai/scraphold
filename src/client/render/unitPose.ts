/**
 * How a unit is posed on screen: which of the 16 cached facings it shows (toward its movement,
 * or toward its target while firing) and which animation frame (walk steps, recoil). Facing
 * keeps the current direction until the new one is clearly in another bucket, so crowd jostling
 * does not make sprites flicker between two directions.
 */

export const FACING_BUCKETS = 16;
const WIDTH = (Math.PI * 2) / FACING_BUCKETS;
/** A new direction must be this many bucket widths from the current one to turn. */
const TURN_HYSTERESIS = 0.75;
/** A shot shows the recoil frame for this long. */
export const RECOIL_MS = 90;

export function facingBucket(angle: number): number {
  const turn = angle / (Math.PI * 2);
  return ((Math.round(turn * FACING_BUCKETS) % FACING_BUCKETS) + FACING_BUCKETS) % FACING_BUCKETS;
}

export function bucketAngle(bucket: number): number {
  return bucket * WIDTH;
}

/** Smallest absolute difference between two angles. */
function angleGap(a: number, b: number): number {
  const d = (((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2);
  return Math.abs(d - Math.PI);
}

export function steadyBucket(current: number | null, angle: number): number {
  if (current === null) return facingBucket(angle);
  return angleGap(angle, bucketAngle(current)) > WIDTH * TURN_HYSTERESIS ? facingBucket(angle) : current;
}

export type PoseFrame = 'idle' | 'stepA' | 'stepB' | 'recoil';
export const POSE_FRAMES: readonly PoseFrame[] = ['idle', 'stepA', 'stepB', 'recoil'];

const WALK_CYCLE: readonly PoseFrame[] = ['stepA', 'idle', 'stepB', 'idle'];

/**
 * `sinceShotMs`: time since the unit last fired (null if not recently); `walkClock`: a per-unit
 * running clock in ms; `stepMs`: duration of one walk frame for this unit type.
 */
export function poseFrame(moving: boolean, sinceShotMs: number | null, walkClock: number, stepMs: number): PoseFrame {
  if (sinceShotMs !== null && sinceShotMs >= 0 && sinceShotMs < RECOIL_MS) return 'recoil';
  if (!moving) return 'idle';
  return WALK_CYCLE[Math.floor(walkClock / stepMs) % WALK_CYCLE.length] as PoseFrame;
}
