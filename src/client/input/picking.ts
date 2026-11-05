/**
 * Hit testing in world coordinates: which entity is under the cursor, which own units lie in a
 * selection box. Only things the player can see are pickable.
 */
import type { GameView } from '../../sim';
import { isKnownToPlayer, isOnMap, isPlayerUnit, type EntityView, type PlayerUnitView } from '../view';

/** Units within (radius + slack) of the point win over structures; the nearest unit wins. */
export function pickEntity(view: GameView, wx: number, wy: number, slack: number): EntityView | null {
  let unit: EntityView | null = null;
  let unitDistance = Infinity;
  let structure: EntityView | null = null;
  for (const e of view.entities.values()) {
    if (!isKnownToPlayer(view, e)) continue;
    if (e.kind === 'building' || e.kind === 'nest') {
      if (wx >= e.tileX && wx < e.tileX + e.size && wy >= e.tileY && wy < e.tileY + e.size) structure = e;
      continue;
    }
    const d = Math.sqrt((e.x - wx) * (e.x - wx) + (e.y - wy) * (e.y - wy));
    if (d <= e.radius + slack && d < unitDistance) {
      unit = e;
      unitDistance = d;
    }
  }
  return unit ?? structure;
}

export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normalizeRect(r: WorldRect): WorldRect {
  return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
}

export function isInRect(r: WorldRect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Own soldiers and survivors on the map whose centers lie in the (unnormalized) rectangle. */
export function playerUnitsInRect(view: GameView, rect: WorldRect): PlayerUnitView[] {
  const r = normalizeRect(rect);
  const out: PlayerUnitView[] = [];
  for (const e of view.entities.values()) {
    if (isPlayerUnit(e) && isOnMap(e) && isInRect(r, e.x, e.y)) out.push(e);
  }
  return out;
}
