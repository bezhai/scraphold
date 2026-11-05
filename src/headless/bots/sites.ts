/**
 * Where bots put buildings (Task 5). Candidates are scored from what the build preview shows
 * (placementBonusPct) and the distance to the core, then confirmed with validateCommand, so a
 * chosen site is always one the player could click.
 *
 * By default every new building keeps its one-tile ring free of other structures, so the base
 * never walls itself in; `touching` lets a dispatch hub sit against the producers it boosts.
 */
import { placementBonusPct, validateCommand, type Game } from '../../sim';
import { BUILDINGS, type BuildingType } from '../../sim/data/economy';
import { forEachFootprintTile, forEachRingTile, inBounds, terrainAt } from '../../sim/map/grid';
import { coreOf, isExploredTile } from './view';

export interface SiteRules {
  /** Footprint center within this distance of the core center. */
  maxDistance: number;
  minDistance?: number;
  /** Buildings whose footprint may touch the new one (the free ring rule is waived for them). */
  touching?: (type: BuildingType) => boolean;
  /** Extra score (higher is better); the default prefers the production bonus, then closeness. */
  score?: (tileX: number, tileY: number, distance: number) => number;
  /** Reject a candidate outright. */
  accept?: (tileX: number, tileY: number) => boolean;
}

export interface Site {
  tileX: number;
  tileY: number;
}

/** Structure entity id per tile (0 = free), from the state's buildings and nests. */
export function structureGrid(game: Game): Int32Array {
  const { map } = game.state;
  const grid = new Int32Array(map.width * map.height);
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'building' && e.kind !== 'nest') continue;
    forEachFootprintTile(map, e.tileX, e.tileY, e.size, (i) => {
      grid[i] = e.id;
    });
  }
  return grid;
}

const MAX_VALIDATED = 40;

export function findSite(game: Game, type: BuildingType, rules: SiteRules, grid = structureGrid(game)): Site | null {
  const { map } = game.state;
  const def = BUILDINGS[type];
  const core = coreOf(game);
  const half = def.size / 2;
  const r = Math.ceil(rules.maxDistance);
  const candidates: { tileX: number; tileY: number; score: number }[] = [];
  for (let ty = Math.floor(core.y - r); ty <= Math.ceil(core.y + r); ty++) {
    for (let tx = Math.floor(core.x - r); tx <= Math.ceil(core.x + r); tx++) {
      if (!inBounds(map, tx, ty) || !inBounds(map, tx + def.size - 1, ty + def.size - 1)) continue;
      const dx = tx + half - core.x;
      const dy = ty + half - core.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > rules.maxDistance || d < (rules.minDistance ?? 0)) continue;
      let ok = true;
      forEachFootprintTile(map, tx, ty, def.size, (i) => {
        if (grid[i] !== 0 || !isExploredTile(game, i) || !def.allowedTerrain.includes(terrainAt(map, i))) ok = false;
      });
      if (!ok) continue;
      forEachRingTile(map, tx, ty, def.size, (i) => {
        const id = grid[i] as number;
        if (id === 0) return;
        const other = game.state.entities.get(id);
        if (!other || other.kind !== 'building' || !rules.touching?.(other.type)) ok = false;
      });
      if (!ok || (rules.accept && !rules.accept(tx, ty))) continue;
      const score = rules.score ? rules.score(tx, ty, d) : placementBonusPct(game, type, tx, ty) * 10 - d * 0.1;
      candidates.push({ tileX: tx, tileY: ty, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.tileY - b.tileY || a.tileX - b.tileX);
  for (const c of candidates.slice(0, MAX_VALIDATED)) {
    if (validateCommand(game, { type: 'placeBuilding', building: type, tileX: c.tileX, tileY: c.tileY }).ok) return { tileX: c.tileX, tileY: c.tileY };
  }
  return null;
}
