import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commandHandlers';
import { createGame, type Game } from '../index';
import { stepGame } from '../pipeline';
import { FOG_VISIBLE, type Soldier, type Survivor } from '../state';
import { createTestGame } from '../testing';
import { addBuilding, removeEntity, spawnMutant, spawnSoldier, spawnSurvivor } from './entities';

const ROWS = [
  '....................',
  '....................',
  '....................',
  '........CCC.........',
  '........CCC.........',
  '........CCC.........',
  '....................',
  '....................',
];

function steps(game: Game, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepGame(game);
}

/** Steps until `done` holds (at most `limit` ticks); returns whether it did. */
function stepUntil(game: Game, done: () => boolean, limit = 400): boolean {
  for (let t = 0; t < limit && !done(); t++) stepGame(game);
  return done();
}

function setup() {
  const game = createTestGame(ROWS);
  const rifle = spawnSoldier(game, 'rifleman', 1.5, 1.5);
  const survivor = spawnSurvivor(game, 3.5, 6.5);
  return { game, rifle, survivor };
}

describe('unit control', () => {
  it('starts every new unit under automatic control, whatever spawned it', () => {
    const game = createGame({ seed: 'control', origin: 'militia', difficulty: 'normal' });
    const units = [...game.state.entities.values()].filter((e): e is Survivor | Soldier => e.kind === 'survivor' || e.kind === 'soldier');
    expect(units.some((u) => u.kind === 'soldier')).toBe(true);
    for (const u of units) expect(u.control).toBe('auto');
    expect(spawnSurvivor(game, 1.5, 1.5).control).toBe('auto');
    expect(spawnSoldier(game, 'rifleman', 1.5, 1.5).control).toBe('auto');
    const barracks = [...game.state.entities.values()].find((e) => e.kind === 'building' && e.type === 'barracks')!;
    expect(applyCommand(game, { type: 'setRally', buildingId: barracks.id, x: 10.5, y: 10.5 }).ok).toBe(true);
    expect(applyCommand(game, { type: 'train', buildingId: barracks.id, unit: 'rifleman' }).ok).toBe(true);
    const before = new Set(game.state.entities.keys());
    expect(stepUntil(game, () => [...game.state.entities.values()].some((e) => e.kind === 'soldier' && !before.has(e.id)), 2000)).toBe(true);
    const recruit = [...game.state.entities.values()].find((e) => e.kind === 'soldier' && !before.has(e.id)) as Soldier;
    expect(recruit.control).toBe('auto');
  });

  it('puts commanded units under player control and hands them back when a move arrives', () => {
    const { game, rifle, survivor } = setup();
    expect(applyCommand(game, { type: 'move', unitIds: [rifle.id, survivor.id], x: 5.5, y: 1.5 }).ok).toBe(true);
    expect(rifle.control).toBe('player');
    expect(survivor.control).toBe('player');
    steps(game, 10);
    expect(rifle.control).toBe('player');
    expect(survivor.control).toBe('player');
    expect(stepUntil(game, () => rifle.control === 'auto' && survivor.control === 'auto')).toBe(true);
    expect(rifle.motion.mode).toBe('stand');
    expect(survivor.motion.mode).toBe('stand');
  });

  it('hands an attack-move back once the soldier reaches its destination', () => {
    const { game, rifle } = setup();
    applyCommand(game, { type: 'attackMove', unitIds: [rifle.id], x: 4.5, y: 7.5 });
    expect(rifle.control).toBe('player');
    expect(stepUntil(game, () => rifle.control === 'auto')).toBe(true);
    expect(Math.hypot(rifle.x - 4.5, rifle.y - 7.5)).toBeLessThan(2);
  });

  it('hands a retreat to the core (a move to its center) back on arrival', () => {
    const { game, rifle } = setup();
    const core = game.state.entities.get(game.state.coreId)!;
    applyCommand(game, { type: 'move', unitIds: [rifle.id], x: core.x, y: core.y });
    expect(rifle.control).toBe('player');
    expect(stepUntil(game, () => rifle.control === 'auto')).toBe(true);
  });

  it('hands focus fire back when the target is gone', () => {
    const { game, rifle } = setup();
    const m = spawnMutant(game, 'wanderer', 6.5, 1.5, { mode: 'guard' });
    game.state.fog.fill(FOG_VISIBLE);
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [rifle.id], targetId: m.id }).ok).toBe(true);
    expect(rifle.control).toBe('player');
    steps(game, 2);
    expect(rifle.control).toBe('player');
    m.hp = 0;
    expect(stepUntil(game, () => rifle.control === 'auto', 20)).toBe(true);
  });

  it('keeps holding under player control until stop hands the soldier back', () => {
    const { game, rifle } = setup();
    applyCommand(game, { type: 'hold', unitIds: [rifle.id] });
    steps(game, 300);
    expect(rifle.order).toEqual({ type: 'hold' });
    expect(rifle.control).toBe('player');
    applyCommand(game, { type: 'stop', unitIds: [rifle.id] });
    expect(rifle.control).toBe('auto');
  });

  it('stop hands a moving unit back at once', () => {
    const { game, rifle, survivor } = setup();
    applyCommand(game, { type: 'move', unitIds: [rifle.id, survivor.id], x: 18.5, y: 7.5 });
    applyCommand(game, { type: 'stop', unitIds: [rifle.id, survivor.id] });
    expect(rifle.control).toBe('auto');
    expect(survivor.control).toBe('auto');
  });

  it('keeps an assigned worker under player control until a new command', () => {
    const { game, survivor } = setup();
    const yard = addBuilding(game, 'salvageYard', 14, 5, { complete: true });
    applyCommand(game, { type: 'assignWork', unitIds: [survivor.id], buildingId: yard.id });
    expect(survivor.control).toBe('player');
    steps(game, 600);
    expect(survivor.insideId).toBe(yard.id);
    expect(survivor.control).toBe('player');
  });

  it('keeps a survivor pulled out with unassignWork waiting under player control until X', () => {
    const { game, survivor } = setup();
    const yard = addBuilding(game, 'salvageYard', 14, 5, { complete: true });
    applyCommand(game, { type: 'assignWork', unitIds: [survivor.id], buildingId: yard.id });
    expect(stepUntil(game, () => survivor.insideId === yard.id)).toBe(true);
    applyCommand(game, { type: 'unassignWork', buildingId: yard.id, count: 1 });
    expect(survivor.task).toEqual({ type: 'wait' });
    expect(survivor.control).toBe('player');
    // The yard has free slots, yet nobody puts the waiting survivor back to work.
    steps(game, 600);
    expect(survivor).toMatchObject({ task: { type: 'wait' }, control: 'player', insideId: 0 });
    applyCommand(game, { type: 'stop', unitIds: [survivor.id] });
    expect(survivor.control).toBe('auto');
    steps(game, 40);
    expect(survivor.task).toEqual({ type: 'work', buildingId: yard.id });
  });

  it('hands a survivor pulled out with unassignWork back once a new order with an end is done', () => {
    const { game, survivor } = setup();
    const yard = addBuilding(game, 'salvageYard', 14, 5, { complete: true });
    applyCommand(game, { type: 'assignWork', unitIds: [survivor.id], buildingId: yard.id });
    expect(stepUntil(game, () => survivor.insideId === yard.id)).toBe(true);
    applyCommand(game, { type: 'unassignWork', buildingId: yard.id, count: 1 });
    applyCommand(game, { type: 'move', unitIds: [survivor.id], x: 4.5, y: 7.5 });
    expect(survivor).toMatchObject({ task: { type: 'idle' }, control: 'player' });
    expect(stepUntil(game, () => survivor.control === 'auto')).toBe(true);
  });

  it('hands the crew of a finished signal tower back to automatic control', () => {
    const { game, survivor } = setup();
    const tower = addBuilding(game, 'signalTower', 14, 4, { complete: false });
    applyCommand(game, { type: 'assignWork', unitIds: [survivor.id], buildingId: tower.id });
    expect(stepUntil(game, () => survivor.insideId === tower.id)).toBe(true);
    tower.construction!.progress = tower.construction!.total - 1;
    steps(game, 1);
    expect(tower.construction).toBeNull();
    expect(survivor).toMatchObject({ task: { type: 'idle' }, control: 'auto', insideId: 0 });
  });

  it('hands an assigned worker back when its workplace is destroyed', () => {
    const { game, survivor } = setup();
    const yard = addBuilding(game, 'salvageYard', 14, 5, { complete: true });
    applyCommand(game, { type: 'assignWork', unitIds: [survivor.id], buildingId: yard.id });
    expect(stepUntil(game, () => survivor.insideId === yard.id)).toBe(true);
    removeEntity(game, yard);
    steps(game, 1);
    expect(survivor.control).toBe('auto');
  });

  it('hands a manual repair back when the building is repaired', () => {
    const { game, survivor } = setup();
    const yard = addBuilding(game, 'salvageYard', 4, 1, { complete: true });
    yard.hp = yard.maxHp - 30;
    applyCommand(game, { type: 'repair', unitIds: [survivor.id], buildingId: yard.id });
    expect(survivor.control).toBe('player');
    expect(stepUntil(game, () => yard.hp >= yard.maxHp)).toBe(true);
    steps(game, 1);
    expect(survivor.control).toBe('auto');
  });

  it('hands a failed repair back when its target vanishes', () => {
    const { game, survivor } = setup();
    const yard = addBuilding(game, 'salvageYard', 16, 0, { complete: true });
    yard.hp = yard.maxHp - 30;
    applyCommand(game, { type: 'repair', unitIds: [survivor.id], buildingId: yard.id });
    steps(game, 5);
    removeEntity(game, yard);
    steps(game, 2);
    expect(survivor.control).toBe('auto');
  });
});
