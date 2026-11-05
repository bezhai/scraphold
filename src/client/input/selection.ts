/**
 * Selection rules (client-only, not commands): click, Shift toggling, box select (a box that
 * catches soldiers takes only the soldiers, so dragging over the army near the core does not
 * drag survivors into the fight), double-click "same type on screen", and pruning ids that died
 * or went out of sight.
 * A selection is an ordered list of ids: own units (soldiers and survivors, any mix), or a single
 * building, or a single enemy (info only).
 */
import type { EntityId, GameView } from '../../sim';
import { isKnownToPlayer, isOnMap, isPlayerUnit, type EntityView } from '../view';
import { isInRect, normalizeRect, type WorldRect } from './picking';

export type Selection = readonly EntityId[];

function onlyPlayerUnits(view: GameView, ids: Selection): EntityId[] {
  return ids.filter((id) => {
    const e = view.entities.get(id);
    return e !== undefined && isPlayerUnit(e);
  });
}

export function selectionAfterClick(view: GameView, current: Selection, picked: EntityView | null, shift: boolean): EntityId[] {
  if (!picked) return shift ? [...current] : [];
  if (!isPlayerUnit(picked) || !shift) return [picked.id];
  const units = onlyPlayerUnits(view, current);
  if (units.length !== current.length) return [picked.id];
  return units.includes(picked.id) ? units.filter((id) => id !== picked.id) : [...units, picked.id];
}

/** The soldiers among the boxed units, or all of them when the box caught no soldier. */
function armyFirst(view: GameView, boxed: Selection): EntityId[] {
  const soldiers = boxed.filter((id) => view.entities.get(id)?.kind === 'soldier');
  return soldiers.length > 0 ? soldiers : [...boxed];
}

export function selectionAfterBox(view: GameView, current: Selection, caught: Selection, shift: boolean): EntityId[] {
  const boxed = armyFirst(view, caught);
  if (!shift) return boxed;
  if (boxed.length === 0) return [...current];
  const base = onlyPlayerUnits(view, current);
  return [...base, ...boxed.filter((id) => !base.includes(id))];
}

/** Double-click: own units of the same kind and soldier type within the view rectangle. */
export function sameTypeInRect(view: GameView, picked: EntityView, rect: WorldRect): EntityId[] {
  if (!isPlayerUnit(picked)) return [picked.id];
  const r = normalizeRect(rect);
  const out: EntityId[] = [];
  for (const e of view.entities.values()) {
    if (e.kind !== picked.kind || !isOnMap(e) || !isInRect(r, e.x, e.y)) continue;
    if (e.kind === 'soldier' && picked.kind === 'soldier' && e.type !== picked.type) continue;
    out.push(e.id);
  }
  return out;
}

/** Drops ids that no longer exist, died, went inside a building or are out of sight. */
export function pruneSelection(view: GameView, ids: Selection): EntityId[] {
  return ids.filter((id) => {
    const e = view.entities.get(id);
    return e !== undefined && isKnownToPlayer(view, e);
  });
}
