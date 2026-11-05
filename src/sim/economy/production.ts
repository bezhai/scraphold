/**
 * Resource production: staffed production buildings with terrain and dispatch-hub adjacency
 * bonuses, the core's unstaffed baseline, modifiers; projected income for the UI.
 * Owner: Task 2.
 *
 * Staffed yield per second = workers x perWorkerPerSecond x (1 + placement bonus) x
 * (1 + <resource>YieldPct + productionPct + building yieldPct). The placement bonus is local
 * (terrain under/around the footprint plus touching staffed dispatch hubs) and is what the
 * placement preview shows; the second factor is the sum of global modifiers. The core yields
 * baseYieldPerSecond x (1 + coreYieldPct) and ignores the other modifiers, so it stays a floor.
 * Production runs every tick, day and night.
 *
 * Rates in the state and the HUD are "per day": one full day-night cycle (RATE_PERIOD_SECONDS),
 * the period over which upkeep is settled. perDayToPerMinute is the HUD's conversion.
 */
import { nightType } from '../calendar/calendar';
import { BUILDINGS, RESOURCES, type BuildingType, type Resource } from '../data/economy';
import type { Game } from '../game';
import { forEachFootprintTile, forEachRingTile, terrainAt } from '../map/grid';
import type { GlobalStat, Modifiers } from '../modifiers';
import { zeroRecord } from '../record';
import type { Building, EntityId, MapState } from '../state';
import { CYCLE_TICKS, TICKS_PER_SECOND, perSecondToPerTick } from '../time';
import { gain } from './resources';

const YIELD_STAT: Record<Resource, GlobalStat> = {
  scrap: 'scrapYieldPct',
  food: 'foodYieldPct',
  fuel: 'fuelYieldPct',
  research: 'researchYieldPct',
};

/** Game seconds one per-day figure covers: a full day-night cycle. */
export const RATE_PERIOD_SECONDS = CYCLE_TICKS / TICKS_PER_SECOND;

/** A per-day figure (incomePerDay, expensePerDay, buildingYieldPerDay) as a rate per game minute. */
export function perDayToPerMinute(perDay: number): number {
  return (perDay * 60) / RATE_PERIOD_SECONDS;
}

/** What production reads from a building; read-only views of the state fit. */
export interface Producer {
  readonly type: BuildingType;
  readonly tileX: number;
  readonly tileY: number;
  readonly construction: Building['construction'];
  readonly workers: readonly EntityId[];
}

/** Footprint of a finished, staffed dispatch hub and the bonus it hands out. */
interface Hub {
  tileX: number;
  tileY: number;
  size: number;
  pct: number;
}

/** Tiles of each data bonus that count at this footprint: matching terrain in the ring (adjacent) or under it. */
function bonusTilesByRule(map: MapState, type: BuildingType, tileX: number, tileY: number): number[][] {
  const def = BUILDINGS[type];
  return def.bonuses.map((bonus) => {
    const tiles: number[] = [];
    const visit = (i: number) => {
      if (terrainAt(map, i) === bonus.terrain) tiles.push(i);
    };
    if (bonus.kind === 'adjacentTerrain') forEachRingTile(map, tileX, tileY, def.size, visit);
    else forEachFootprintTile(map, tileX, tileY, def.size, visit);
    return tiles;
  });
}

/** Terrain bonus of a footprint from the building's data bonuses (ring tiles capped at maxTiles, footprint tiles). */
export function terrainBonusPct(map: MapState, type: BuildingType, tileX: number, tileY: number): number {
  const bonuses = BUILDINGS[type].bonuses;
  let pct = 0;
  bonusTilesByRule(map, type, tileX, tileY).forEach((tiles, k) => {
    const bonus = bonuses[k] as (typeof bonuses)[number];
    pct += (bonus.kind === 'adjacentTerrain' ? Math.min(tiles.length, bonus.maxTiles) : tiles.length) * bonus.pctPerTile;
  });
  return pct;
}

/** The tiles that give this footprint its terrain bonus, each once (the placement preview highlights them). */
export function bonusTerrainTiles(map: MapState, type: BuildingType, tileX: number, tileY: number): number[] {
  return [...new Set(bonusTilesByRule(map, type, tileX, tileY).flat())];
}

function isWorking(b: Producer): boolean {
  return b.construction === null && b.workers.length > 0;
}

function staffedHubs(game: Game): Hub[] {
  const hubs: Hub[] = [];
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'building' || !isWorking(e)) continue;
    const pct = BUILDINGS[e.type].adjacentProductionPct;
    if (pct > 0) hubs.push({ tileX: e.tileX, tileY: e.tileY, size: e.size, pct });
  }
  return hubs;
}

/** Footprints touch when one lies in the other's one-tile ring (diagonal contact counts). */
function touches(hub: Hub, tileX: number, tileY: number, size: number): boolean {
  return hub.tileX <= tileX + size && tileX <= hub.tileX + hub.size && hub.tileY <= tileY + size && tileY <= hub.tileY + hub.size;
}

function hubBonusPct(hubs: readonly Hub[], type: BuildingType, tileX: number, tileY: number): number {
  let pct = 0;
  for (const hub of hubs) if (touches(hub, tileX, tileY, BUILDINGS[type].size)) pct += hub.pct;
  return pct;
}

function localBonusPct(game: Game, hubs: readonly Hub[], type: BuildingType, tileX: number, tileY: number): number {
  if (!BUILDINGS[type].production) return 0;
  return terrainBonusPct(game.state.map, type, tileX, tileY) + hubBonusPct(hubs, type, tileX, tileY);
}

/** Local bonus a production building gets (or would get) at this footprint: terrain plus dispatch hubs. */
export function placementBonusPct(game: Game, type: BuildingType, tileX: number, tileY: number): number {
  return localBonusPct(game, staffedHubs(game), type, tileX, tileY);
}

function staffedYieldPerSecond(game: Game, hubs: readonly Hub[], b: Producer): number {
  const production = BUILDINGS[b.type].production;
  if (!production || !isWorking(b)) return 0;
  const m: Modifiers = game.modifiers;
  const local = 1 + localBonusPct(game, hubs, b.type, b.tileX, b.tileY);
  const global = Math.max(0, 1 + m.global[YIELD_STAT[production.resource]] + m.global.productionPct + m.building[b.type].yieldPct);
  const storm = game.state.clock.phase === 'night' && nightType(game.state) === 'rustStorm' ? Math.max(0, 1 + m.global.stormProductionPct) : 1;
  return b.workers.length * production.perWorkerPerSecond * local * global * storm;
}

/** Adds one finished building's per-second output (unstaffed baseline plus staffed production) to `out`. */
function addBuildingYield(game: Game, hubs: readonly Hub[], b: Producer, out: Record<Resource, number>): void {
  if (b.construction !== null) return;
  const def = BUILDINGS[b.type];
  const coreFactor = Math.max(0, 1 + game.modifiers.global.coreYieldPct) * game.modifiers.factor.coreYield;
  for (const r of RESOURCES) out[r] += (def.baseYieldPerSecond[r] ?? 0) * coreFactor;
  if (def.production) out[def.production.resource] += staffedYieldPerSecond(game, hubs, b);
}

/** Per-second output of every resource at the current staffing and modifiers. */
export function yieldPerSecond(game: Game): Record<Resource, number> {
  const out = zeroRecord(RESOURCES);
  const hubs = staffedHubs(game);
  for (const e of game.state.entities.values()) if (e.kind === 'building') addBuildingYield(game, hubs, e, out);
  return out;
}

/** What one building produces per day right now; the buildings' outputs add up to incomePerDay. */
export function buildingYieldPerDay(game: Game, b: Producer): Record<Resource, number> {
  const out = zeroRecord(RESOURCES);
  addBuildingYield(game, staffedHubs(game), b, out);
  for (const r of RESOURCES) out[r] *= RATE_PERIOD_SECONDS;
  return out;
}

export function productionSystem(game: Game): void {
  const { economy, stats } = game.state;
  const rates = yieldPerSecond(game);
  for (const r of RESOURCES) {
    economy.incomePerDay[r] = rates[r] * RATE_PERIOD_SECONDS;
    if (rates[r] > 0) gain(economy.resources, stats, r, perSecondToPerTick(rates[r]));
  }
}
