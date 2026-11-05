import { describe, expect, it } from 'vitest';
import { applyCommand, validateCommand } from '../commandHandlers';
import { CONSTRUCTION, SURVIVOR_AI } from '../data/economy';
import type { Game } from '../game';
import { applyIncidentEffect } from '../incidents/effects';
import { stepGame } from '../pipeline';
import type { Building, Survivor } from '../state';
import { createTestGame } from '../testing';
import { DAY_TICKS, DUSK_TICKS, TICKS_PER_SECOND, clockAt } from '../time';
import { addBuilding, enterBuilding, spawnMutant, spawnSurvivor } from '../world/entities';

const ROWS = [
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '......CCC...............................',
  '......CCC...............................',
  '......CCC...............................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
];

function stepSeconds(game: Game, seconds: number): void {
  for (let t = 0; t < seconds * TICKS_PER_SECOND; t++) stepGame(game);
}

function survivors(game: Game, count: number): Survivor[] {
  return Array.from({ length: count }, (_, k) => spawnSurvivor(game, 6.5 + (k % 3), 8.5 + Math.floor(k / 3) * 0.6));
}

/** Survivors working at `b` or on their way there. */
function staff(game: Game, b: Building): Survivor[] {
  return [...game.state.entities.values()].filter((e): e is Survivor => e.kind === 'survivor' && e.task.type === 'work' && e.task.buildingId === b.id);
}

function repairers(game: Game, b: Building): Survivor[] {
  return [...game.state.entities.values()].filter((e): e is Survivor => e.kind === 'survivor' && e.task.type === 'repair' && e.task.buildingId === b.id);
}

function stock(game: Game, amounts: Partial<Game['state']['economy']['resources']>): void {
  Object.assign(game.state.economy.resources, amounts);
}

/** Moves the game to the first tick of today's dusk. */
function atDusk(game: Game): void {
  game.state.tick = DAY_TICKS - DUSK_TICKS;
  game.state.clock = clockAt(game.state.tick);
}

function stormTonight(game: Game): void {
  game.calendarPlan[0] = 'rustStorm';
  game.state.calendar.nights[0]!.type = 'rustStorm';
}

describe('survivor manager: production', () => {
  it('sends idle survivors into production buildings', () => {
    const game = createTestGame(ROWS);
    const farm = addBuilding(game, 'greenhouse', 14, 2, { complete: true });
    const yard = addBuilding(game, 'salvageYard', 14, 8, { complete: true });
    const people = survivors(game, 4);
    stepSeconds(game, 1);
    expect(people.every((s) => s.task.type === 'work')).toBe(true);
    stepSeconds(game, 10);
    expect(people.every((s) => s.insideId === farm.id || s.insideId === yard.id)).toBe(true);
    expect(staff(game, farm).length + staff(game, yard).length).toBe(4);
  });

  it('puts more workers on food while food is short, and on scrap while scrap is short', () => {
    for (const [short, plenty] of [['food', 'scrap'], ['scrap', 'food']] as const) {
      const game = createTestGame(ROWS);
      const farms = [addBuilding(game, 'greenhouse', 14, 1, { complete: true }), addBuilding(game, 'greenhouse', 17, 1, { complete: true })];
      const yards = [addBuilding(game, 'salvageYard', 14, 8, { complete: true }), addBuilding(game, 'salvageYard', 17, 8, { complete: true })];
      survivors(game, 6);
      stock(game, { [short]: 5, [plenty]: 200 });
      stepSeconds(game, 1);
      const onFood = farms.reduce((n, b) => n + staff(game, b).length, 0);
      const onScrap = yards.reduce((n, b) => n + staff(game, b).length, 0);
      expect(onFood + onScrap).toBe(6);
      expect(short === 'food' ? onFood : onScrap).toBeGreaterThanOrEqual(4);
    }
  });

  it('moves workers toward the line that runs short, one at a time and only by day', () => {
    const game = createTestGame(ROWS);
    const farm = addBuilding(game, 'greenhouse', 14, 1, { complete: true });
    const yards = [addBuilding(game, 'salvageYard', 14, 8, { complete: true }), addBuilding(game, 'salvageYard', 17, 8, { complete: true })];
    survivors(game, 6);
    stock(game, { food: 200, scrap: 5 });
    stepSeconds(game, 15);
    expect(staff(game, farm).length).toBeLessThanOrEqual(1);
    stock(game, { food: 0, scrap: 400 });
    const counts: number[] = [];
    for (let s = 0; s < 12; s++) {
      stepSeconds(game, 1);
      counts.push(staff(game, farm).length);
    }
    // At most one worker moves per transferSeconds.
    for (let k = 1; k < counts.length; k++) expect(counts[k]! - counts[k - 1]!).toBeLessThanOrEqual(1);
    expect(counts.at(-1)! - counts[0]!).toBeLessThanOrEqual(Math.ceil(12 / SURVIVOR_AI.transferSeconds));
    stepSeconds(game, 20);
    expect(staff(game, farm).length).toBe(3);
    expect(yards.reduce((n, b) => n + staff(game, b).length, 0)).toBe(3);
  });

  it('leaves workers in place while the stockpiles only wobble around their targets', () => {
    const game = createTestGame(ROWS);
    const farm = addBuilding(game, 'greenhouse', 14, 1, { complete: true });
    const yard = addBuilding(game, 'salvageYard', 14, 8, { complete: true });
    const people = survivors(game, 4);
    stepSeconds(game, 12);
    const placed = people.map((s) => s.insideId);
    expect(placed.every((id) => id === farm.id || id === yard.id)).toBe(true);
    for (let s = 0; s < 30; s++) {
      stock(game, s % 2 === 0 ? { food: SURVIVOR_AI.stock.food.target - 10, scrap: SURVIVOR_AI.stock.scrap.target + 10 } : { food: SURVIVOR_AI.stock.food.target + 10, scrap: SURVIVOR_AI.stock.scrap.target - 10 });
      stepSeconds(game, 1);
    }
    expect(people.map((s) => s.insideId)).toEqual(placed);
  });

  it('sends researchers only while a research is in progress', () => {
    const game = createTestGame(ROWS);
    const lab = addBuilding(game, 'researchStation', 14, 1, { complete: true });
    const people = survivors(game, 2);
    stepSeconds(game, 3);
    expect(people.map((s) => s.task.type)).toEqual(['idle', 'idle']);
    expect(applyCommand(game, { type: 'setResearch', tech: 'scavengingTools' }).ok).toBe(true);
    stepSeconds(game, 1);
    expect(staff(game, lab)).toHaveLength(2);
  });

  it('never moves survivors the player assigned, nor one walking under a player order', () => {
    const game = createTestGame(ROWS);
    const lab = addBuilding(game, 'researchStation', 14, 1, { complete: true });
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const [a, b, walker] = survivors(game, 3);
    applyCommand(game, { type: 'assignWork', unitIds: [a!.id, b!.id], buildingId: lab.id });
    applyCommand(game, { type: 'move', unitIds: [walker!.id], x: 35.5, y: 10.5 });
    stock(game, { food: 0 });
    stepSeconds(game, 2);
    expect(walker!.task).toEqual({ type: 'idle' });
    expect(walker!.control).toBe('player');
    stepSeconds(game, 40);
    // No research is selected and food is short, yet the player's researchers stay.
    expect(a!.insideId).toBe(lab.id);
    expect(b!.insideId).toBe(lab.id);
    expect([a!.control, b!.control]).toEqual(['player', 'player']);
    // The walker arrived, is the manager's again, and went to the farm.
    expect(walker!.control).toBe('auto');
    expect(walker!.task).toEqual({ type: 'work', buildingId: farm.id });
  });
});

describe('survivor manager: construction and repairs', () => {
  it('sends idle survivors to help construction sites before filling production slots', () => {
    const game = createTestGame(ROWS);
    addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const site = addBuilding(game, 'barracks', 14, 1, { complete: false });
    const people = survivors(game, CONSTRUCTION.maxBuilders + 1);
    stepSeconds(game, 1);
    expect(repairers(game, site)).toHaveLength(CONSTRUCTION.maxBuilders);
    expect(people.filter((s) => s.task.type === 'work')).toHaveLength(1);
  });

  it('does not take workers out of production for a site, which builds on its own', () => {
    const game = createTestGame(ROWS);
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    survivors(game, 3);
    stepSeconds(game, 10);
    expect(farm.workers).toHaveLength(3);
    const site = addBuilding(game, 'barracks', 14, 1, { complete: false });
    stepSeconds(game, 3);
    expect(repairers(game, site)).toHaveLength(0);
    expect(farm.workers).toHaveLength(3);
  });

  it('takes workers out of production by day to repair a damaged building, then sends them back', () => {
    const game = createTestGame(ROWS);
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const people = survivors(game, 3);
    stepSeconds(game, 10);
    expect(farm.workers).toHaveLength(3);
    const yard = addBuilding(game, 'salvageYard', 18, 1, { complete: true });
    yard.hp = yard.maxHp * 0.5;
    stepSeconds(game, 1);
    expect(repairers(game, yard).length).toBeGreaterThanOrEqual(1);
    stepSeconds(game, 30);
    expect(yard.hp).toBe(yard.maxHp);
    expect(people.every((s) => s.task.type === 'work')).toBe(true);
  });

  it('repairs the core before other buildings', () => {
    const game = createTestGame(ROWS);
    const core = game.state.entities.get(game.state.coreId) as Building;
    const yard = addBuilding(game, 'salvageYard', 3, 1, { complete: true });
    yard.hp = yard.maxHp * 0.5;
    core.hp = core.maxHp * 0.85;
    const [s] = survivors(game, 1);
    stepSeconds(game, 1);
    expect(s!.task).toEqual({ type: 'repair', buildingId: core.id });
  });

  it('sends nobody to repair next to a visible enemy, and calls repairers back when one shows up', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 30, 5, { complete: true });
    yard.hp = yard.maxHp * 0.5;
    const [s] = survivors(game, 1);
    // A mutant in the fog is unknown to the player and changes nothing.
    const hidden = spawnMutant(game, 'wanderer', 37.5, 6.5, { mode: 'guard', guardPoint: { x: 37.5, y: 6.5 } });
    stepSeconds(game, 1);
    expect(s!.task).toEqual({ type: 'repair', buildingId: yard.id });
    hidden.hp = 0;
    spawnMutant(game, 'wanderer', 33.5, 5.5, { mode: 'guard', guardPoint: { x: 33.5, y: 5.5 } });
    stepSeconds(game, 1);
    expect(s!.task.type).toBe('idle');
    stepSeconds(game, 3);
    expect(s!.task.type).toBe('idle');
  });

  it('waits until no enemy has been seen near a building for a while before sending repairers back', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 30, 5, { complete: true });
    yard.hp = yard.maxHp * 0.5;
    const [s] = survivors(game, 1);
    stepSeconds(game, 1);
    expect(s!.task).toEqual({ type: 'repair', buildingId: yard.id });
    // A mutant at the edge of sight: seen for a moment, then gone again.
    const m = spawnMutant(game, 'wanderer', 33.5, 5.5, { mode: 'guard', guardPoint: { x: 33.5, y: 5.5 } });
    stepSeconds(game, 1);
    expect(s!.task.type).toBe('idle');
    m.hp = 0;
    expect(SURVIVOR_AI.enemyCalmSeconds).toBeGreaterThan(2);
    stepSeconds(game, 2);
    expect(s!.task.type).toBe('idle');
    stepSeconds(game, SURVIVOR_AI.enemyCalmSeconds);
    expect(s!.task).toEqual({ type: 'repair', buildingId: yard.id });
  });

  it('crews a signal tower site the player placed', () => {
    const game = createTestGame(ROWS);
    const tower = addBuilding(game, 'signalTower', 30, 4, { complete: false });
    survivors(game, 4);
    stepSeconds(game, 1);
    expect(staff(game, tower)).toHaveLength(3);
  });
});

describe('survivor manager: storms and incidents', () => {
  it('shelters auto survivors in buildings on a rust-storm dusk, but not player-controlled ones', () => {
    const game = createTestGame(ROWS);
    const lab = addBuilding(game, 'researchStation', 14, 1, { complete: true });
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const core = game.state.entities.get(game.state.coreId) as Building;
    core.hp = core.maxHp * 0.5;
    stormTonight(game);
    atDusk(game);
    const [idle, repairing, walker] = survivors(game, 3);
    repairing!.task = { type: 'repair', buildingId: core.id };
    applyCommand(game, { type: 'move', unitIds: [walker!.id], x: 30.5, y: 10.5 });
    stepSeconds(game, 1);
    // Shelter is anywhere with a free slot, a research station without research included.
    for (const s of [idle!, repairing!]) expect(s.task.type).toBe('work');
    expect(walker!.task.type).toBe('idle');
    stepSeconds(game, 14);
    expect([idle!.insideId, repairing!.insideId].every((id) => id === lab.id || id === farm.id)).toBe(true);
  });

  it('leaves isolated survivors alone and manages them once the isolation ends', () => {
    const game = createTestGame(ROWS);
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const people = survivors(game, 2);
    applyCommand(game, { type: 'assignWork', unitIds: people.map((s) => s.id), buildingId: farm.id });
    stepSeconds(game, 10);
    expect(farm.workers).toHaveLength(2);
    applyIncidentEffect(game, { kind: 'isolate', count: 2, days: 1 }, 1);
    const core = game.state.coreId;
    expect(people.map((s) => s.insideId)).toEqual([core, core]);
    stepSeconds(game, 20);
    expect(people.map((s) => s.insideId)).toEqual([core, core]);
    expect(people.every((s) => s.task.type === 'idle')).toBe(true);
    game.state.incidents.isolatedSurvivors.forEach((r) => (r.expiresTick = game.state.tick));
    stepSeconds(game, 1);
    expect(people.map((s) => s.control)).toEqual(['auto', 'auto']);
    expect(people.every((s) => s.task.type === 'work')).toBe(true);
  });
});

describe('training', () => {
  it('takes the nearest auto survivor, idle ones first, and never one the player commands', () => {
    const game = createTestGame(ROWS);
    const barracks = addBuilding(game, 'barracks', 3, 1, { complete: true });
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const near = spawnSurvivor(game, 3.5, 4.5);
    const worker = spawnSurvivor(game, 14.5, 7.5);
    const far = spawnSurvivor(game, 30.5, 10.5);
    enterBuilding(game, worker, farm);
    worker.task = { type: 'work', buildingId: farm.id };
    const fixed = spawnSurvivor(game, 3.5, 3.5);
    applyCommand(game, { type: 'assignWork', unitIds: [fixed.id], buildingId: farm.id });
    stock(game, { scrap: 999, food: 999 });
    const train = () => applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' });
    expect(train().ok).toBe(true);
    expect(game.state.entities.has(near.id)).toBe(false);
    // An idle survivor far away goes before a nearer worker.
    expect(train().ok).toBe(true);
    expect(game.state.entities.has(far.id)).toBe(false);
    expect(train().ok).toBe(true);
    expect(game.state.entities.has(worker.id)).toBe(false);
    expect(farm.workers).not.toContain(worker.id);
    expect(validateCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' })).toEqual({ ok: false, reason: 'noAutoSurvivor' });
    expect(game.state.entities.has(fixed.id)).toBe(true);
  });

  it('never takes an isolated survivor', () => {
    const game = createTestGame(ROWS);
    const barracks = addBuilding(game, 'barracks', 3, 1, { complete: true });
    const farm = addBuilding(game, 'greenhouse', 14, 8, { complete: true });
    const [s] = survivors(game, 1);
    enterBuilding(game, s!, farm);
    s!.task = { type: 'work', buildingId: farm.id };
    applyIncidentEffect(game, { kind: 'isolate', count: 1, days: 1 }, 1);
    expect(validateCommand(game, { type: 'train', buildingId: barracks.id, unit: 'scout' })).toEqual({ ok: false, reason: 'noAutoSurvivor' });
  });
});

