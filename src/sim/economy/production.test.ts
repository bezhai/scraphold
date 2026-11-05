import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/economy';
import type { Game } from '../game';
import { refreshModifiers } from '../game';
import type { Building } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, TICKS_PER_SECOND } from '../time';
import { addBuilding, enterBuilding, spawnSurvivor } from '../world/entities';
import { bonusTerrainTiles, buildingYieldPerDay, perDayToPerMinute, placementBonusPct, productionSystem, terrainBonusPct } from './production';

// Salvage yard footprint (2..3, 2..3): six wreckage tiles in its ring, one wreckage tile outside it.
const WRECKAGE = [
  '............',
  '.www........',
  '.w..w.......',
  '.w..........',
  '......CCC...',
  '......CCC..w',
  '......CCC...',
  '............',
];

const YARD_RATE = BUILDINGS.salvageYard.production?.perWorkerPerSecond ?? 0;
const STATION_RATE = BUILDINGS.researchStation.production?.perWorkerPerSecond ?? 0;

function staff(game: Game, b: Building, count: number): void {
  for (let k = 0; k < count; k++) enterBuilding(game, spawnSurvivor(game, b.x, b.y + 2), b);
}

/** Resources gained by one production tick. */
function oneTick(game: Game) {
  const before = { ...game.state.economy.resources };
  productionSystem(game);
  const after = game.state.economy.resources;
  return { scrap: after.scrap - before.scrap, food: after.food - before.food, fuel: after.fuel - before.fuel, research: after.research - before.research };
}

describe('terrain placement bonus', () => {
  it('counts bonus terrain in the ring around the footprint', () => {
    const game = createTestGame(WRECKAGE);
    expect(terrainBonusPct(game.state.map, 'salvageYard', 2, 2)).toBeCloseTo(6 * 0.1);
    expect(terrainBonusPct(game.state.map, 'salvageYard', 8, 0)).toBe(0);
  });

  it('caps adjacent tiles at maxTiles', () => {
    const game = createTestGame(['wwww......', 'w..w......', 'w..w.CCC..', 'wwww.CCC..', '.....CCC..']);
    // 12 wreckage tiles around the 2x2 footprint, capped at 8.
    expect(terrainBonusPct(game.state.map, 'salvageYard', 1, 1)).toBeCloseTo(8 * 0.1);
  });

  it('adds fertile tiles under a greenhouse and water around it', () => {
    const game = createTestGame(['..~.......', '.ff.......', '.f..CCC...', '....CCC...', '....CCC...']);
    // Footprint (1..2, 1..2): three fertile tiles; ring touches one water tile at (2,0).
    expect(terrainBonusPct(game.state.map, 'greenhouse', 1, 1)).toBeCloseTo(3 * 0.1 + 0.08);
  });

  it('lists the tiles that count toward the bonus (ring tiles, footprint tiles), each once', () => {
    const game = createTestGame(['..~.......', '.ff.......', '.f..CCC...', '....CCC...', '....CCC...']);
    const m = game.state.map;
    const at = (x: number, y: number) => y * m.width + x;
    expect(bonusTerrainTiles(m, 'greenhouse', 1, 1).sort((a, b) => a - b)).toEqual([at(2, 0), at(1, 1), at(2, 1), at(1, 2)]);
    expect(bonusTerrainTiles(game.state.map, 'shack', 1, 1)).toEqual([]);
  });

  it('gives research stations a bonus next to ruins and nothing for buildings without bonuses', () => {
    const game = createTestGame(['r.........', '..........', '....CCC...', '....CCC...', '....CCC...']);
    expect(terrainBonusPct(game.state.map, 'researchStation', 1, 0)).toBeCloseTo(0.3);
    expect(terrainBonusPct(game.state.map, 'shack', 1, 0)).toBe(0);
  });
});

describe('dispatch hub bonus', () => {
  const ROWS = ['..............', '..............', '..............', '..........CCC.', '..........CCC.', '..........CCC.', '..............'];

  it('adds the hub percentage to production buildings touching a staffed, finished hub', () => {
    const game = createTestGame(ROWS);
    const hub = addBuilding(game, 'dispatchHub', 2, 2, { complete: true });
    expect(placementBonusPct(game, 'salvageYard', 4, 2)).toBe(0);
    staff(game, hub, 1);
    expect(placementBonusPct(game, 'salvageYard', 4, 2)).toBeCloseTo(BUILDINGS.dispatchHub.adjacentProductionPct);
    // Diagonal contact counts, one tile of gap does not.
    expect(placementBonusPct(game, 'salvageYard', 4, 4)).toBeCloseTo(0.2);
    expect(placementBonusPct(game, 'salvageYard', 5, 2)).toBe(0);
    // Only production buildings benefit.
    expect(placementBonusPct(game, 'shack', 4, 2)).toBe(0);
  });

  it('stacks hubs and ignores hubs under construction', () => {
    const game = createTestGame(ROWS);
    staff(game, addBuilding(game, 'dispatchHub', 2, 2, { complete: true }), 1);
    staff(game, addBuilding(game, 'dispatchHub', 6, 2, { complete: true }), 1);
    addBuilding(game, 'dispatchHub', 4, 0, { complete: false });
    expect(placementBonusPct(game, 'salvageYard', 4, 2)).toBeCloseTo(0.4);
  });
});

describe('productionSystem', () => {
  it('gives the core baseline income without workers', () => {
    const game = createTestGame(WRECKAGE, { origin: 'militia' });
    const gained = oneTick(game);
    const base = BUILDINGS.core.baseYieldPerSecond;
    expect(gained.scrap).toBeCloseTo((base.scrap ?? 0) / TICKS_PER_SECOND);
    expect(gained.food).toBeCloseTo((base.food ?? 0) / TICKS_PER_SECOND);
    expect(gained.research).toBeCloseTo((base.research ?? 0) / TICKS_PER_SECOND);
    expect(gained.fuel).toBe(0);
  });

  it('scales staffed production by workers, terrain bonus and global modifiers, but not the core', () => {
    const game = createTestGame(WRECKAGE, { origin: 'scavengers' });
    const yard = addBuilding(game, 'salvageYard', 2, 2, { complete: true });
    staff(game, yard, 2);
    const coreScrap = (BUILDINGS.core.baseYieldPerSecond.scrap ?? 0) / TICKS_PER_SECOND;
    const yardScrap = (2 * YARD_RATE * (1 + 0.6) * (1 + 0.25)) / TICKS_PER_SECOND;
    expect(oneTick(game).scrap).toBeCloseTo(coreScrap + yardScrap, 10);
  });

  it('applies productionPct and per-building yieldPct to staffed buildings and coreYieldPct to the core', () => {
    const game = createTestGame(WRECKAGE, { origin: 'militia' });
    const yard = addBuilding(game, 'salvageYard', 8, 0, { complete: true });
    staff(game, yard, 1);
    game.state.economy.policies.slots[0] = 'rationing';
    refreshModifiers(game);
    game.modifiers.building.salvageYard.yieldPct = 0.1;
    game.modifiers.global.coreYieldPct = 0.5;
    const coreScrap = ((BUILDINGS.core.baseYieldPerSecond.scrap ?? 0) * 1.5) / TICKS_PER_SECOND;
    const yardScrap = (YARD_RATE * (1 - 0.15 + 0.1)) / TICKS_PER_SECOND;
    expect(oneTick(game).scrap).toBeCloseTo(coreScrap + yardScrap, 10);
  });

  it('applies origin yield bonuses to their resource only', () => {
    const game = createTestGame(['r...........', ...WRECKAGE.slice(1)], { origin: 'scholars' });
    const station = addBuilding(game, 'researchStation', 1, 0, { complete: true });
    staff(game, station, 2);
    const coreResearch = (BUILDINGS.core.baseYieldPerSecond.research ?? 0) / TICKS_PER_SECOND;
    const gained = oneTick(game);
    expect(gained.research).toBeCloseTo(coreResearch + (2 * STATION_RATE * (1 + 0.3) * (1 + 0.3)) / TICKS_PER_SECOND, 10);
    expect(gained.scrap).toBeCloseTo((BUILDINGS.core.baseYieldPerSecond.scrap ?? 0) / TICKS_PER_SECOND, 10);
  });

  it('applies the dispatch hub bonus to staffed production', () => {
    const game = createTestGame(WRECKAGE, { origin: 'militia' });
    const yard = addBuilding(game, 'salvageYard', 8, 0, { complete: true });
    staff(game, yard, 3);
    staff(game, addBuilding(game, 'dispatchHub', 10, 0, { complete: true }), 1);
    const coreScrap = (BUILDINGS.core.baseYieldPerSecond.scrap ?? 0) / TICKS_PER_SECOND;
    expect(oneTick(game).scrap).toBeCloseTo(coreScrap + (3 * YARD_RATE * 1.2) / TICKS_PER_SECOND, 10);
  });

  it('produces nothing from empty buildings or construction sites', () => {
    const game = createTestGame(WRECKAGE, { origin: 'militia' });
    addBuilding(game, 'salvageYard', 8, 0, { complete: true });
    const site = addBuilding(game, 'greenhouse', 2, 2, { complete: false });
    // A site cannot hold workers through commands; even if it did, it must not produce.
    staff(game, site, 2);
    const gained = oneTick(game);
    expect(gained.scrap).toBeCloseTo((BUILDINGS.core.baseYieldPerSecond.scrap ?? 0) / TICKS_PER_SECOND);
    expect(gained.food).toBeCloseTo((BUILDINGS.core.baseYieldPerSecond.food ?? 0) / TICKS_PER_SECOND);
  });

  it('projects per-day income and counts gathered resources', () => {
    const game = createTestGame(WRECKAGE, { origin: 'militia' });
    staff(game, addBuilding(game, 'greenhouse', 8, 0, { complete: true }), 2);
    productionSystem(game);
    const perDay = (perSecond: number) => (perSecond * CYCLE_TICKS) / TICKS_PER_SECOND;
    const { incomePerDay } = game.state.economy;
    expect(incomePerDay.food).toBeCloseTo(perDay((BUILDINGS.core.baseYieldPerSecond.food ?? 0) + 2 * (BUILDINGS.greenhouse.production?.perWorkerPerSecond ?? 0)));
    expect(incomePerDay.scrap).toBeCloseTo(perDay(BUILDINGS.core.baseYieldPerSecond.scrap ?? 0));
    expect(incomePerDay.fuel).toBe(0);
    expect(game.state.stats.resourcesGathered.food).toBeCloseTo(incomePerDay.food / CYCLE_TICKS);
  });
});

describe('per-building output', () => {
  it('is the staffed yield of one building per day, with its local bonus and global modifiers', () => {
    const game = createTestGame(WRECKAGE, { origin: 'scavengers' });
    const yard = addBuilding(game, 'salvageYard', 2, 2, { complete: true });
    const perDay = (perSecond: number) => (perSecond * CYCLE_TICKS) / TICKS_PER_SECOND;
    expect(buildingYieldPerDay(game, yard)).toEqual({ scrap: 0, food: 0, fuel: 0, research: 0 });
    staff(game, yard, 2);
    expect(buildingYieldPerDay(game, yard).scrap).toBeCloseTo(perDay(2 * YARD_RATE * (1 + 0.6) * (1 + 0.25)));
    expect(buildingYieldPerDay(game, addBuilding(game, 'shack', 8, 0, { complete: true }))).toEqual({ scrap: 0, food: 0, fuel: 0, research: 0 });
  });

  it('gives the core its baseline output, and the buildings add up to the projected income', () => {
    const game = createTestGame(WRECKAGE, { origin: 'scavengers' });
    staff(game, addBuilding(game, 'salvageYard', 2, 2, { complete: true }), 3);
    const core = game.state.entities.get(game.state.coreId) as Building;
    const perDay = (perSecond: number) => (perSecond * CYCLE_TICKS) / TICKS_PER_SECOND;
    expect(buildingYieldPerDay(game, core).food).toBeCloseTo(perDay(BUILDINGS.core.baseYieldPerSecond.food ?? 0));
    productionSystem(game);
    let scrap = 0;
    for (const e of game.state.entities.values()) if (e.kind === 'building') scrap += buildingYieldPerDay(game, e).scrap;
    expect(scrap).toBeCloseTo(game.state.economy.incomePerDay.scrap);
  });

  it('converts per-day figures to a rate per game minute (a day is one full day-night cycle)', () => {
    const cycleSeconds = CYCLE_TICKS / TICKS_PER_SECOND;
    expect(perDayToPerMinute(cycleSeconds)).toBeCloseTo(60);
    expect(perDayToPerMinute(0)).toBe(0);
  });
});
