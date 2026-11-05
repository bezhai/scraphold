/**
 * Build menu entries and the placement ghost. Menu availability is the simulation's
 * checkBuildable (unlock, limit, cost); the ghost validates the full placeBuilding command at the
 * cursor and shows the production bonus the spot would get (placementBonusPct).
 */
import { REJECT_REASON_TEXT, bonusTerrainTiles, buildingCost, checkBuildable, checkPlacement, placementBonusPct, type Game } from '../../sim';
import { BUILDINGS, BUILDING_TYPES, TECHS, type BuildingCategory, type BuildingType } from '../../sim/data/economy';
import { buildHotkeyLabel } from '../input/keymap';
import { availabilityOf, costItems, type Availability, type CostItem } from './availability';

export type MenuAvailability = { ok: true } | { ok: false; reason: string };

export interface BuildMenuEntry {
  type: BuildingType;
  name: string;
  description: string;
  hotkey: string | null;
  cost: CostItem[];
  buildSeconds: number;
  lockedBy: string | null;
  availability: MenuAvailability;
}

export interface BuildMenuSection {
  label: string;
  entries: BuildMenuEntry[];
}

const SECTIONS: readonly { label: string; categories: readonly BuildingCategory[] }[] = [
  { label: '经济', categories: ['housing', 'production', 'support'] },
  { label: '军事', categories: ['military'] },
  { label: '防御', categories: ['defense'] },
];

/** Why a building cannot be chosen right now; a tech lock names the tech. */
export function buildChoice(game: Game, type: BuildingType): { availability: MenuAvailability; lockedBy: string | null } {
  const r = checkBuildable(game, type);
  if (r.ok) return { availability: { ok: true }, lockedBy: null };
  const tech = BUILDINGS[type].tech;
  const lockedBy = r.reason === 'locked' && tech ? TECHS[tech].name : null;
  return { availability: { ok: false, reason: lockedBy ? `需要科技：${lockedBy}` : REJECT_REASON_TEXT[r.reason] }, lockedBy };
}

export function buildMenuModel(game: Game): BuildMenuSection[] {
  const stock = game.state.economy.resources;
  return SECTIONS.map((s) => ({
    label: s.label,
    entries: BUILDING_TYPES.filter((t) => BUILDINGS[t].allowedTerrain.length > 0 && s.categories.includes(BUILDINGS[t].category)).map((t) => {
      const def = BUILDINGS[t];
      return {
        type: t,
        name: def.name,
        description: def.description,
        hotkey: buildHotkeyLabel(t),
        cost: costItems(buildingCost(game.modifiers, t), stock),
        buildSeconds: def.buildSeconds,
        ...buildChoice(game, t),
      };
    }),
  }));
}

/** Footprint top-left tile so that the footprint is centered on the cursor. */
export function footprintAt(type: BuildingType, wx: number, wy: number): { tileX: number; tileY: number; size: number } {
  const size = BUILDINGS[type].size;
  return { tileX: Math.round(wx - size / 2), tileY: Math.round(wy - size / 2), size };
}

export type PlacementStatus = 'valid' | 'unavailable' | 'blocked';

export interface PlacementPreview {
  type: BuildingType;
  tileX: number;
  tileY: number;
  size: number;
  /** The spot itself is fine (checkPlacement). */
  geometryOk: boolean;
  availability: Availability;
  /** valid: can build; unavailable: good spot but the command is rejected (cost, unlock); blocked: bad spot. */
  status: PlacementStatus;
  /** Highlighted terrain tiles that count toward the bonus. */
  bonusTiles: number[];
  /** Production bonus at this spot (terrain + staffed dispatch hubs), null for non-producers. */
  bonusPct: number | null;
}

export function placementPreview(game: Game, type: BuildingType, wx: number, wy: number): PlacementPreview {
  const { tileX, tileY, size } = footprintAt(type, wx, wy);
  const geometryOk = checkPlacement(game, type, tileX, tileY).ok;
  const availability = availabilityOf(game, { type: 'placeBuilding', building: type, tileX, tileY });
  const status: PlacementStatus = availability.ok ? 'valid' : geometryOk ? 'unavailable' : 'blocked';
  const bonusPct = BUILDINGS[type].production ? placementBonusPct(game, type, tileX, tileY) : null;
  return { type, tileX, tileY, size, geometryOk, availability, status, bonusTiles: bonusTerrainTiles(game.state.map, type, tileX, tileY), bonusPct };
}
