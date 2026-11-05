import { describe, expect, it } from 'vitest';
import { SOLDIERS } from '../data/combat';
import { BUILDINGS, CONSTRUCTION, START, TRAINING } from '../data/economy';
import { applyCommand, validateCommand } from '../commandHandlers';
import { drainEvents } from '../events';
import { refreshModifiers, type Game } from '../game';
import type { Building, Soldier, Survivor } from '../state';
import { stepGame } from '../pipeline';
import { createTestGame } from '../testing';
import { secondsToTicks } from '../time';
import { addBuilding, enterBuilding, spawnSurvivor } from '../world/entities';
import { constructionSystem } from './construction';

const START_SCRAP = START.resources.scrap;
const START_FOOD = START.resources.food;
const YARD_SCRAP = BUILDINGS.salvageYard.cost.scrap ?? 0;
const BARRACKS_SCRAP = BUILDINGS.barracks.cost.scrap ?? 0;

const ROWS = [
  '................',
  '................',
  '................',
  '......CCC.......',
  '......CCC.......',
  '......CCC....oo.',
  '..ww.........oo.',
  '..ww............',
];

function run(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) constructionSystem(game);
}

function entitiesOf<K extends 'survivor' | 'soldier' | 'building'>(game: Game, kind: K) {
  return [...game.state.entities.values()].filter((e) => e.kind === kind) as Extract<Survivor | Soldier | Building, { kind: K }>[];
}

function placeSite(game: Game, type: keyof typeof BUILDINGS, tileX: number, tileY: number): Building {
  const result = applyCommand(game, { type: 'placeBuilding', building: type, tileX, tileY });
  expect(result).toEqual({ ok: true });
  return entitiesOf(game, 'building').at(-1)!;
}

describe('placeBuilding', () => {
  it('charges the cost and starts a construction site', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'shack', 0, 0);
    expect(game.state.economy.resources.scrap).toBe(START_SCRAP - (BUILDINGS.shack.cost.scrap ?? 0));
    expect(site).toMatchObject({ type: 'shack', tileX: 0, tileY: 0 });
    expect(site.construction).toEqual({ progress: 0, total: secondsToTicks(BUILDINGS.shack.buildSeconds), paid: BUILDINGS.shack.cost });
    expect(drainEvents(game)).toContainEqual({ type: 'buildingPlaced', buildingId: site.id, building: 'shack' });
  });

  it('applies buildCostPct to the cost', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('civicCenter');
    game.state.economy.policies.slots[0] = 'engineeringCorps';
    refreshModifiers(game);
    const site = placeSite(game, 'salvageYard', 0, 0);
    expect(site.construction?.paid).toEqual({ scrap: Math.round(YARD_SCRAP * 1.1) });
    expect(game.state.economy.resources.scrap).toBe(START_SCRAP - Math.round(YARD_SCRAP * 1.1));
  });

  it('rejects the core, locked buildings, missing resources, count limits and bad geometry', () => {
    const game = createTestGame(ROWS);
    const cmd = (building: keyof typeof BUILDINGS, tileX = 0, tileY = 0) => validateCommand(game, { type: 'placeBuilding', building, tileX, tileY });
    expect(cmd('core')).toEqual({ ok: false, reason: 'notPlaceable' });
    expect(cmd('armory')).toEqual({ ok: false, reason: 'locked' });
    expect(cmd('oilWell', 13, 5)).toEqual({ ok: true });
    expect(cmd('oilWell', 0, 0)).toEqual({ ok: false, reason: 'wrongTerrain' });
    expect(cmd('shack', 6, 3)).toEqual({ ok: false, reason: 'occupied' });
    game.state.economy.resources.scrap = 20;
    expect(cmd('shack')).toEqual({ ok: false, reason: 'insufficientResources' });
    game.state.economy.resources.scrap = 1000;
    const def = BUILDINGS.watchtower;
    const saved = def.maxCount;
    def.maxCount = 1;
    try {
      placeSite(game, 'watchtower', 0, 0);
      expect(cmd('watchtower', 3, 0)).toEqual({ ok: false, reason: 'limitReached' });
    } finally {
      def.maxCount = saved;
    }
  });
});

describe('construction progress', () => {
  it('builds without workers in buildSeconds, growing hp with progress', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'shack', 0, 0);
    const total = secondsToTicks(BUILDINGS.shack.buildSeconds);
    const startHp = site.hp;
    run(game, total / 2);
    expect(site.construction?.progress).toBe(total / 2);
    expect(site.hp).toBeCloseTo(startHp + (site.maxHp * (1 - CONSTRUCTION.startHpPct)) / 2);
    drainEvents(game);
    run(game, total / 2);
    expect(site.construction).toBeNull();
    expect(site.hp).toBeCloseTo(site.maxHp);
    expect(site.vision).toBe(BUILDINGS.shack.vision);
    expect(game.state.stats.buildingsBuilt.shack).toBe(1);
    expect(drainEvents(game)).toEqual([{ type: 'buildingCompleted', buildingId: site.id, building: 'shack' }]);
  });

  it('keeps damage taken while under construction', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'shack', 0, 0);
    site.hp -= 15;
    run(game, secondsToTicks(BUILDINGS.shack.buildSeconds));
    expect(site.construction).toBeNull();
    expect(site.hp).toBeCloseTo(site.maxHp - 15);
  });

  it('builds faster with buildSpeedPct and with helping survivors, up to maxBuilders', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'shack', 0, 0);
    game.modifiers.global.buildSpeedPct = 0.5;
    constructionSystem(game);
    expect(site.construction?.progress).toBeCloseTo(1.5);
    const helpers = [0, 1, 2, 3, 4].map((k) => spawnSurvivor(game, 2.5, 0.5 + k * 0.3));
    for (const h of helpers) h.task = { type: 'repair', buildingId: site.id };
    constructionSystem(game);
    expect(site.construction?.progress).toBeCloseTo(1.5 + 1 + 0.5 + CONSTRUCTION.maxBuilders * CONSTRUCTION.builderSpeedPct);
  });

  it('ignores helpers that have not reached the site', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'shack', 0, 0);
    const far = spawnSurvivor(game, 12.5, 0.5);
    far.task = { type: 'repair', buildingId: site.id };
    constructionSystem(game);
    expect(site.construction?.progress).toBe(1);
  });
});

describe('cancelConstruction and demolish', () => {
  it('refunds a cancelled site in full and removes it', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'salvageYard', 0, 0);
    expect(applyCommand(game, { type: 'cancelConstruction', buildingId: site.id })).toEqual({ ok: true });
    expect(game.state.entities.has(site.id)).toBe(false);
    expect(game.state.economy.resources.scrap).toBe(START_SCRAP);
  });

  it('only cancels construction sites', () => {
    const game = createTestGame(ROWS);
    const done = addBuilding(game, 'shack', 0, 0, { complete: true });
    expect(validateCommand(game, { type: 'cancelConstruction', buildingId: done.id })).toEqual({ ok: false, reason: 'notUnderConstruction' });
    expect(validateCommand(game, { type: 'cancelConstruction', buildingId: 999 })).toEqual({ ok: false, reason: 'unknownTarget' });
  });

  it('demolishes finished buildings for a partial refund, ejecting the workers', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 0, 0, { complete: true });
    const worker = spawnSurvivor(game, 3.5, 0.5);
    enterBuilding(game, worker, yard);
    expect(applyCommand(game, { type: 'demolish', buildingId: yard.id })).toEqual({ ok: true });
    expect(game.state.entities.has(yard.id)).toBe(false);
    expect(game.state.economy.resources.scrap).toBe(START_SCRAP + Math.floor(YARD_SCRAP * CONSTRUCTION.demolishRefund));
    expect(worker).toMatchObject({ insideId: 0, task: { type: 'idle' } });
  });

  it('refuses to demolish the core or a construction site', () => {
    const game = createTestGame(ROWS);
    const site = placeSite(game, 'shack', 0, 0);
    expect(validateCommand(game, { type: 'demolish', buildingId: game.state.coreId })).toEqual({ ok: false, reason: 'cannotDemolishCore' });
    expect(validateCommand(game, { type: 'demolish', buildingId: site.id })).toEqual({ ok: false, reason: 'underConstruction' });
  });
});

describe('building stats', () => {
  it('scales max hp with hpPct, keeping the damaged share, for finished buildings and sites', () => {
    const game = createTestGame(ROWS);
    const wall = addBuilding(game, 'barricade', 0, 0, { complete: true });
    wall.hp = wall.maxHp / 2;
    const site = placeSite(game, 'shack', 3, 0);
    const siteShare = site.hp / site.maxHp;
    game.state.economy.tech.researched.push('reinforcement', 'steelLine');
    refreshModifiers(game);
    constructionSystem(game);
    expect(wall.maxHp).toBeCloseTo(BUILDINGS.barricade.hp * (1 + 0.25 + 0.5));
    expect(wall.hp).toBeCloseTo(wall.maxHp / 2);
    expect(site.maxHp).toBeCloseTo(BUILDINGS.shack.hp * 1.25);
    expect(site.hp / site.maxHp).toBeGreaterThan(siteShare);
    expect(site.hp / site.maxHp).toBeLessThan(siteShare + 0.01);
  });

  it('places new sites with the current hp bonus', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('reinforcement');
    refreshModifiers(game);
    const site = placeSite(game, 'shack', 0, 0);
    expect(site.maxHp).toBeCloseTo(BUILDINGS.shack.hp * 1.25);
    expect(site.hp / site.maxHp).toBeCloseTo(Math.round(BUILDINGS.shack.hp * CONSTRUCTION.startHpPct) / BUILDINGS.shack.hp);
  });
});

describe('training', () => {
  function barracksGame(survivors = 2) {
    const game = createTestGame(ROWS, { survivors });
    const barracks = addBuilding(game, 'barracks', 0, 0, { complete: true });
    return { game, barracks };
  }

  it('takes one idle survivor and the cost when queued', () => {
    const { game, barracks } = barracksGame(2);
    const cost = SOLDIERS.rifleman.cost;
    expect(applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' })).toEqual({ ok: true });
    expect(entitiesOf(game, 'survivor')).toHaveLength(1);
    expect(game.state.economy.resources.scrap).toBe(START_SCRAP - (cost.scrap ?? 0));
    expect(game.state.economy.resources.food).toBe(START_FOOD - (cost.food ?? 0));
    expect(barracks.trainQueue).toEqual([{ unit: 'rifleman', progress: 0, total: secondsToTicks(SOLDIERS.rifleman.trainSeconds), paid: cost }]);
  });

  it('takes the idle survivor nearest to the building before a busy one', () => {
    const game = createTestGame(ROWS);
    const barracks = addBuilding(game, 'barracks', 0, 0, { complete: true });
    const yard = addBuilding(game, 'salvageYard', 2, 6, { complete: false });
    const far = spawnSurvivor(game, 12.5, 1.5);
    const near = spawnSurvivor(game, 3.5, 1.5);
    const worker = spawnSurvivor(game, 2.5, 2.5);
    worker.task = { type: 'repair', buildingId: yard.id };
    game.state.economy.resources.food = 999;
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' });
    expect(game.state.entities.has(near.id)).toBe(false);
    expect(game.state.entities.has(far.id)).toBe(true);
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' });
    expect(game.state.entities.has(far.id)).toBe(false);
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' });
    expect(game.state.entities.has(worker.id)).toBe(false);
    expect(validateCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' })).toEqual({ ok: false, reason: 'noAutoSurvivor' });
  });

  it('rejects wrong buildings, locked units, full queues, missing resources and sites', () => {
    const { game, barracks } = barracksGame(8);
    const train = (buildingId: number, unit: keyof typeof SOLDIERS) => validateCommand(game, { type: 'train', buildingId, unit });
    const shack = addBuilding(game, 'shack', 3, 0, { complete: true });
    expect(train(shack.id, 'rifleman')).toEqual({ ok: false, reason: 'notMilitary' });
    expect(train(barracks.id, 'sniper')).toEqual({ ok: false, reason: 'notTrainable' });
    const armory = addBuilding(game, 'armory', 10, 0, { complete: true });
    expect(train(armory.id, 'sniper')).toEqual({ ok: false, reason: 'locked' });
    const site = addBuilding(game, 'barracks', 13, 0, { complete: false });
    expect(train(site.id, 'rifleman')).toEqual({ ok: false, reason: 'underConstruction' });
    game.state.economy.resources.food = 10;
    expect(train(barracks.id, 'rifleman')).toEqual({ ok: false, reason: 'insufficientResources' });
    game.state.economy.resources.food = 1000;
    game.state.economy.resources.scrap = 1000;
    for (let k = 0; k < TRAINING.queueLimit; k++) applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' });
    expect(train(barracks.id, 'rifleman')).toEqual({ ok: false, reason: 'queueFull' });
  });

  it('trains the head of the queue, spawns the soldier beside the building and counts it', () => {
    const { game, barracks } = barracksGame(2);
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' });
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' });
    drainEvents(game);
    const total = secondsToTicks(SOLDIERS.rifleman.trainSeconds);
    run(game, total - 1);
    expect(entitiesOf(game, 'soldier')).toHaveLength(0);
    expect(barracks.trainQueue[1]?.progress).toBe(0);
    run(game, 1);
    const [soldier] = entitiesOf(game, 'soldier');
    expect(soldier).toMatchObject({ type: 'rifleman', order: { type: 'idle' } });
    expect(Math.floor(soldier!.x)).toBeLessThanOrEqual(2);
    expect(Math.floor(soldier!.y)).toBeLessThanOrEqual(2);
    expect(barracks.trainQueue.map((o) => o.unit)).toEqual(['scout']);
    expect(game.state.stats.soldiersTrained.rifleman).toBe(1);
    expect(drainEvents(game)).toContainEqual({ type: 'unitTrained', unitId: soldier!.id, unit: 'rifleman', buildingId: barracks.id });
  });

  it('trained soldiers belong to the barracks and, under automatic control, go to wait at its rally point', () => {
    const { game, barracks } = barracksGame(1);
    applyCommand(game, { type: 'setRally', buildingId: barracks.id, x: 12.5, y: 1.5 });
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' });
    run(game, secondsToTicks(SOLDIERS.scout.trainSeconds));
    const [soldier] = entitiesOf(game, 'soldier');
    expect(soldier).toMatchObject({ homeId: barracks.id, control: 'auto', order: { type: 'idle' } });
    for (let t = 0; t < secondsToTicks(5); t++) stepGame(game);
    expect(Math.hypot(soldier!.x - 12.5, soldier!.y - 1.5)).toBeLessThan(0.5);
  });

  it('trains faster with trainSpeedPct', () => {
    const { game, barracks } = barracksGame(1);
    game.state.economy.policies.slots[0] = 'martialLaw';
    refreshModifiers(game);
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' });
    constructionSystem(game);
    expect(barracks.trainQueue[0]?.progress).toBeCloseTo(1.4);
  });

  it('cancels a queued order with a full refund and gives the survivor back', () => {
    const { game, barracks } = barracksGame(1);
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'shieldGuard' });
    expect(validateCommand(game, { type: 'cancelTraining', buildingId: barracks.id, index: 1 })).toEqual({ ok: false, reason: 'invalidIndex' });
    expect(applyCommand(game, { type: 'cancelTraining', buildingId: barracks.id, index: 0 })).toEqual({ ok: true });
    expect(barracks.trainQueue).toEqual([]);
    expect(game.state.economy.resources).toMatchObject({ scrap: START_SCRAP, food: START_FOOD });
    const [back] = entitiesOf(game, 'survivor');
    expect(back).toMatchObject({ task: { type: 'idle' }, insideId: 0 });
  });

  it('returns queued recruits and their cost when the building is demolished', () => {
    const { game, barracks } = barracksGame(2);
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' });
    applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' });
    applyCommand(game, { type: 'demolish', buildingId: barracks.id });
    expect(entitiesOf(game, 'survivor')).toHaveLength(2);
    expect(game.state.economy.resources.food).toBe(START_FOOD);
    expect(game.state.economy.resources.scrap).toBe(START_SCRAP + Math.floor(BARRACKS_SCRAP * CONSTRUCTION.demolishRefund));
  });
});
