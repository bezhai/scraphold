/**
 * Render positions between two simulation ticks. Before each stepGame the client records where
 * every mobile entity was; drawing then blends the recorded and the current position by the
 * fraction of the next tick that has elapsed (alpha).
 */

interface Positioned {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Moving farther than this in one tick is a teleport (entering/leaving buildings): no blending. */
const SNAP_DISTANCE = 2;

interface Entry {
  x: number;
  y: number;
  stamp: number;
}

export interface PositionHistory {
  readonly entries: Map<number, Entry>;
  stamp: number;
  size(): number;
}

export function createPositionHistory(): PositionHistory {
  const entries = new Map<number, Entry>();
  return { entries, stamp: 0, size: () => entries.size };
}

/** Call right before stepGame with every entity that can move. */
export function recordPositions(history: PositionHistory, entities: Iterable<Positioned>): void {
  const stamp = ++history.stamp;
  for (const e of entities) {
    const entry = history.entries.get(e.id);
    if (entry) {
      entry.x = e.x;
      entry.y = e.y;
      entry.stamp = stamp;
    } else {
      history.entries.set(e.id, { x: e.x, y: e.y, stamp });
    }
  }
  for (const [id, entry] of history.entries) if (entry.stamp !== stamp) history.entries.delete(id);
}

export function interpolatedPosition(history: PositionHistory, e: Positioned, alpha: number): { x: number; y: number } {
  const prev = history.entries.get(e.id);
  if (!prev) return { x: e.x, y: e.y };
  const dx = e.x - prev.x;
  const dy = e.y - prev.y;
  if (dx * dx + dy * dy > SNAP_DISTANCE * SNAP_DISTANCE) return { x: e.x, y: e.y };
  return { x: prev.x + dx * alpha, y: prev.y + dy * alpha };
}
