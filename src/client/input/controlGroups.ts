/**
 * Control groups 1..5 (client-only): Ctrl+digit stores the selection, Shift+digit adds to it,
 * digit recalls the members that are still alive and selectable.
 */
import type { EntityId, GameView } from '../../sim';
import { pruneSelection, type Selection } from './selection';

export const CONTROL_GROUP_COUNT = 5;
export type ControlGroups = readonly Selection[];

export function createControlGroups(): ControlGroups {
  return Array.from({ length: CONTROL_GROUP_COUNT }, () => []);
}

export function assignGroup(groups: ControlGroups, index: number, selection: Selection): ControlGroups {
  return groups.map((g, i) => (i === index ? [...selection] : g));
}

export function addToGroup(groups: ControlGroups, index: number, selection: Selection): ControlGroups {
  return groups.map((g, i) => (i === index ? [...g, ...selection.filter((id) => !g.includes(id))] : g));
}

export function recallGroup(view: GameView, groups: ControlGroups, index: number): EntityId[] {
  return pruneSelection(view, groups[index] ?? []);
}
