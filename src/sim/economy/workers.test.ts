import { describe, expect, it } from 'vitest';
import { BUILDINGS, REPAIR } from '../data/economy';
import { applyCommand, validateCommand } from '../commandHandlers';
import { refreshModifiers, type Game } from '../game';
import { stepGame } from '../pipeline';
import type { Building, Survivor } from '../state';
import { createTestGame } from '../testing';
import { TICKS_PER_SECOND } from '../time';
import { addBuilding, enterBuilding, removeEntity, spawnSoldier, spawnSurvivor } from '../world/entities';
import { workerSystem } from './workers';

const ROWS = [
  '................',
  '................',
  '................',
  '......CCC.......',
  '......CCC.......',
  '......CCC.......',
  '................',
  '................',
  '................',
];

function steps(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepGame(game);
}

function survivorsAt(game: Game, points: readonly [number, number][]): Survivor[] {
  return points.map(([x, y]) => spawnSurvivor(game, x, y));
}

describe('assignWork', () => {
  it('sends survivors to the building, where they enter as workers', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 12, 6, { complete: true });
    const [a, b] = survivorsAt(game, [
      [1.5, 7.5],
      [2.5, 7.5],
    ]);
    expect(applyCommand(game, { type: 'assignWork', unitIds: [a!.id, b!.id], buildingId: yard.id })).toEqual({ ok: true });
    expect(a!.task).toEqual({ type: 'work', buildingId: yard.id });
    expect(a!.motion.mode).toBe('path');
    steps(game, 20 * 10);
    expect([...yard.workers].sort((x, y) => x - y)).toEqual([a!.id, b!.id]);
    expect(a!.insideId).toBe(yard.id);
    expect(a!.task).toEqual({ type: 'work', buildingId: yard.id });
  });

  it('only sends as many survivors as there are free slots, nearest first, counting those on the way', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 12, 6, { complete: true });
    const units = survivorsAt(game, [
      [1.5, 0.5],
      [10.5, 7.5],
      [11.5, 8.5],
      [9.5, 8.5],
    ]);
    applyCommand(game, { type: 'assignWork', unitIds: units.map((u) => u.id), buildingId: yard.id });
    expect(units.map((u) => u.task.type)).toEqual(['idle', 'work', 'work', 'work']);
    const extra = spawnSurvivor(game, 14.5, 4.5);
    expect(validateCommand(game, { type: 'assignWork', unitIds: [extra.id], buildingId: yard.id })).toEqual({ ok: false, reason: 'buildingFull' });
    // Re-sending survivors already on their way is fine.
    expect(validateCommand(game, { type: 'assignWork', unitIds: [units[1]!.id], buildingId: yard.id })).toEqual({ ok: true });
  });

  it('uses workerSlotsAdd from techs', () => {
    const game = createTestGame(ROWS);
    const greenhouse = addBuilding(game, 'greenhouse', 12, 6, { complete: true });
    for (let k = 0; k < BUILDINGS.greenhouse.workerSlots; k++) enterBuilding(game, spawnSurvivor(game, 1.5, 1.5), greenhouse);
    const extra = spawnSurvivor(game, 1.5, 7.5);
    expect(validateCommand(game, { type: 'assignWork', unitIds: [extra.id], buildingId: greenhouse.id })).toEqual({ ok: false, reason: 'buildingFull' });
    game.state.economy.tech.researched.push('scavengingTools', 'hydroponics');
    refreshModifiers(game);
    expect(validateCommand(game, { type: 'assignWork', unitIds: [extra.id], buildingId: greenhouse.id })).toEqual({ ok: true });
  });

  it('rejects buildings without slots, sites, unknown targets and selections without survivors', () => {
    const game = createTestGame(ROWS);
    const [s] = survivorsAt(game, [[1.5, 7.5]]);
    const shack = addBuilding(game, 'shack', 0, 0, { complete: true });
    const site = addBuilding(game, 'greenhouse', 12, 6, { complete: false });
    const soldier = spawnSoldier(game, 'rifleman', 2.5, 7.5);
    const yard = addBuilding(game, 'salvageYard', 3, 0, { complete: true });
    const assign = (unitIds: number[], buildingId: number) => validateCommand(game, { type: 'assignWork', unitIds, buildingId });
    expect(assign([s!.id], shack.id)).toEqual({ ok: false, reason: 'notWorkplace' });
    expect(assign([s!.id], site.id)).toEqual({ ok: false, reason: 'underConstruction' });
    expect(assign([s!.id], 999)).toEqual({ ok: false, reason: 'unknownTarget' });
    expect(assign([soldier.id], yard.id)).toEqual({ ok: false, reason: 'noValidUnits' });
  });

  it('turns survivors idle when the building is full on arrival or gone', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'dispatchHub', 12, 6, { complete: true });
    const [walker, other] = survivorsAt(game, [
      [1.5, 7.5],
      [1.5, 0.5],
    ]);
    applyCommand(game, { type: 'assignWork', unitIds: [walker!.id], buildingId: yard.id });
    expect(walker!.task.type).toBe('work');
    enterBuilding(game, spawnSurvivor(game, 14.5, 8.5), yard);
    steps(game, 20 * 10);
    expect(walker!.insideId).toBe(0);
    expect(walker!.task).toEqual({ type: 'idle' });

    const yard2 = addBuilding(game, 'salvageYard', 3, 0, { complete: true });
    applyCommand(game, { type: 'assignWork', unitIds: [other!.id], buildingId: yard2.id });
    expect(other!.task.type).toBe('work');
    removeEntity(game, yard2);
    stepGame(game);
    expect(other!.task).toEqual({ type: 'idle' });
  });
});

describe('unassignWork', () => {
  it('sends the most recent workers out beside the building, idle', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 12, 6, { complete: true });
    const workers = survivorsAt(game, [
      [11.5, 7.5],
      [11.5, 6.5],
      [11.5, 5.5],
    ]);
    for (const w of workers) {
      enterBuilding(game, w, yard);
      w.task = { type: 'work', buildingId: yard.id };
    }
    expect(applyCommand(game, { type: 'unassignWork', buildingId: yard.id, count: 2 })).toEqual({ ok: true });
    expect(yard.workers).toEqual([workers[0]!.id]);
    for (const w of workers.slice(1)) {
      expect(w).toMatchObject({ insideId: 0, task: { type: 'idle' } });
      expect(Math.abs(w.x - yard.x)).toBeLessThan(2.5);
    }
  });

  it('rejects buildings without workers and non-positive counts', () => {
    const game = createTestGame(ROWS);
    const yard = addBuilding(game, 'salvageYard', 12, 6, { complete: true });
    expect(validateCommand(game, { type: 'unassignWork', buildingId: yard.id, count: 1 })).toEqual({ ok: false, reason: 'noWorkers' });
    enterBuilding(game, spawnSurvivor(game, 1.5, 1.5), yard);
    expect(validateCommand(game, { type: 'unassignWork', buildingId: yard.id, count: 0 })).toEqual({ ok: false, reason: 'noValidUnits' });
    expect(validateCommand(game, { type: 'unassignWork', buildingId: 999, count: 1 })).toEqual({ ok: false, reason: 'unknownTarget' });
  });
});

describe('repair', () => {
  function damagedWall(game: Game, missing: number): Building {
    const wall = addBuilding(game, 'barricade', 4, 7, { complete: true });
    wall.hp = wall.maxHp - missing;
    return wall;
  }

  it('accepts damaged buildings and sites, rejects intact buildings', () => {
    const game = createTestGame(ROWS);
    const [s] = survivorsAt(game, [[1.5, 7.5]]);
    const intact = addBuilding(game, 'shack', 0, 0, { complete: true });
    const site = addBuilding(game, 'shack', 12, 6, { complete: false });
    const wall = damagedWall(game, 50);
    const repair = (buildingId: number) => validateCommand(game, { type: 'repair', unitIds: [s!.id], buildingId });
    expect(repair(intact.id)).toEqual({ ok: false, reason: 'notDamaged' });
    expect(repair(site.id)).toEqual({ ok: true });
    expect(repair(wall.id)).toEqual({ ok: true });
    expect(repair(999)).toEqual({ ok: false, reason: 'unknownTarget' });
  });

  it('walks to the building and repairs it for scrap per hp, then goes idle', () => {
    const game = createTestGame(ROWS);
    const wall = damagedWall(game, 30);
    const [s] = survivorsAt(game, [[1.5, 7.5]]);
    applyCommand(game, { type: 'repair', unitIds: [s!.id], buildingId: wall.id });
    steps(game, 20 * 6);
    expect(wall.hp).toBe(wall.maxHp);
    expect(s!.task).toEqual({ type: 'idle' });
    expect(game.state.stats.hpRepaired).toBeCloseTo(30);
  });

  it('repairs hpPerSecondPerWorker per worker and charges scrapPerHp', () => {
    const game = createTestGame(ROWS);
    const wall = damagedWall(game, 200);
    const repairers = survivorsAt(game, [
      [3.5, 7.5],
      [3.5, 8.5],
    ]);
    for (const r of repairers) r.task = { type: 'repair', buildingId: wall.id };
    const scrap = game.state.economy.resources.scrap;
    workerSystem(game);
    const hp = (2 * REPAIR.hpPerSecondPerWorker) / TICKS_PER_SECOND;
    expect(wall.hp).toBeCloseTo(wall.maxHp - 200 + hp);
    expect(game.state.economy.resources.scrap).toBeCloseTo(scrap - hp * REPAIR.scrapPerHp);
  });

  it('applies repairSpeedPct and repairCostPct, and repairs only what scrap pays for', () => {
    const game = createTestGame(ROWS);
    const wall = damagedWall(game, 200);
    const [r] = survivorsAt(game, [[3.5, 7.5]]);
    r!.task = { type: 'repair', buildingId: wall.id };
    game.modifiers.global.repairSpeedPct = 0.5;
    game.modifiers.global.repairCostPct = -0.5;
    game.state.economy.resources.scrap = 100;
    workerSystem(game);
    const hp = (REPAIR.hpPerSecondPerWorker * 1.5) / TICKS_PER_SECOND;
    expect(wall.hp).toBeCloseTo(wall.maxHp - 200 + hp);
    expect(game.state.economy.resources.scrap).toBeCloseTo(100 - hp * REPAIR.scrapPerHp * 0.5);
    game.state.economy.resources.scrap = 0.03;
    const before = wall.hp;
    workerSystem(game);
    expect(wall.hp).toBeCloseTo(before + 0.03 / (REPAIR.scrapPerHp * 0.5));
    expect(game.state.economy.resources.scrap).toBeCloseTo(0);
    expect(r!.task.type).toBe('repair');
  });

  it('keeps helping a construction site until it is finished and intact', () => {
    const game = createTestGame(ROWS);
    const site = addBuilding(game, 'barricade', 4, 7, { complete: false });
    const [r] = survivorsAt(game, [[3.5, 7.5]]);
    applyCommand(game, { type: 'repair', unitIds: [r!.id], buildingId: site.id });
    const scrap = game.state.economy.resources.scrap;
    workerSystem(game);
    expect(r!.task.type).toBe('repair');
    expect(game.state.economy.resources.scrap).toBe(scrap);
    steps(game, 200);
    expect(site.construction).toBeNull();
    expect(r!.task).toEqual({ type: 'idle' });
  });
});
