/**
 * Right-click to commands. Decides only which command the player means (intent); whether it is
 * allowed is the simulation's validateCommand/applyCommand. Mixed selections are split by kind:
 * survivors and soldiers can receive different commands for the same click.
 */
import { SOLDIERS, SOLDIER_TYPES } from '../../sim/data/combat';
import { BUILDINGS, type BuildingType } from '../../sim/data/economy';
import type { Command, EntityId, GameView } from '../../sim';
import { isOnMap, type BuildingView, type EntityView } from '../view';
import type { Selection } from './selection';

export interface RightClickTarget {
  /** World point under the cursor. */
  x: number;
  y: number;
  /** Entity under the cursor (from pickEntity), null for ground. */
  entity: EntityView | null;
}

export interface RightClickModifiers {
  /** Ctrl held: forced move, ignore enemies and buildings. */
  forceMove: boolean;
}

export function trainsSoldiers(type: BuildingType): boolean {
  return SOLDIER_TYPES.some((t) => SOLDIERS[t].trainedAt === type);
}

/**
 * What a survivor right-clicking this building means: help build / repair, work, or walk there.
 * The signal tower is the exception: its own crew builds it (repair helpers add nothing there),
 * and once it stands it takes no workers.
 */
function survivorIntent(building: BuildingView, unitIds: EntityId[], x: number, y: number): Command {
  const tower = building.type === 'signalTower';
  if (tower && building.construction !== null) return { type: 'assignWork', unitIds, buildingId: building.id };
  if (building.construction !== null || building.hp < building.maxHp) return { type: 'repair', unitIds, buildingId: building.id };
  if (!tower && BUILDINGS[building.type].workerSlots > 0) return { type: 'assignWork', unitIds, buildingId: building.id };
  return { type: 'move', unitIds, x, y };
}

export function commandsForRightClick(view: GameView, selection: Selection, target: RightClickTarget, mods: RightClickModifiers): Command[] {
  const { x, y, entity } = target;
  const selected = selection.map((id) => view.entities.get(id)).filter((e): e is EntityView => e !== undefined && e.hp > 0);
  const first = selected[0];
  if (first?.kind === 'building') {
    return selected.length === 1 && trainsSoldiers(first.type) ? [{ type: 'setRally', buildingId: first.id, x, y }] : [];
  }
  const units = selected.filter((e) => (e.kind === 'soldier' || e.kind === 'survivor') && isOnMap(e));
  if (units.length === 0) return [];
  const all = units.map((u) => u.id);
  const soldiers = units.filter((u) => u.kind === 'soldier').map((u) => u.id);
  const survivors = units.filter((u) => u.kind === 'survivor').map((u) => u.id);

  if (mods.forceMove) return [{ type: 'move', unitIds: all, x, y }];

  if (entity && entity.faction === 'mutant') {
    const out: Command[] = [];
    if (soldiers.length > 0) out.push({ type: 'attackTarget', unitIds: soldiers, targetId: entity.id });
    if (survivors.length > 0) out.push({ type: 'move', unitIds: survivors, x, y });
    return out;
  }
  if (entity && entity.kind === 'building') {
    const out: Command[] = [];
    if (survivors.length > 0) out.push(survivorIntent(entity, survivors, x, y));
    if (soldiers.length > 0) out.push({ type: 'move', unitIds: soldiers, x, y });
    return out;
  }
  return soldiers.length > 0 ? [{ type: 'attackMove', unitIds: all, x, y }] : [{ type: 'move', unitIds: all, x, y }];
}
