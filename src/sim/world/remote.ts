import { REMOTE_DISTANCE } from '../data/economy';
import type { Point } from '../state';
/** All expedition/outpost rules use inclusive center-to-center distance to the live core. */
export function isRemote(state: { readonly coreId: number; readonly entities: ReadonlyMap<number, Readonly<Point>> }, point: Point): boolean {
  const core = state.entities.get(state.coreId);
  if (!core) return false;
  const dx = point.x - core.x; const dy = point.y - core.y;
  return dx * dx + dy * dy >= REMOTE_DISTANCE * REMOTE_DISTANCE;
}
