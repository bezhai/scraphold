import { describe, expect, it } from 'vitest';
import { applyCommand, validateCommand } from '../commandHandlers';
import type { Command } from '../commands';
import { hashValue } from '../hash';
import { FOG_UNEXPLORED } from '../state';
import { createTestGame } from '../testing';
import { addBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from './entities';

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

function setup() {
  const game = createTestGame(ROWS);
  const r1 = spawnSoldier(game, 'rifleman', 1.5, 1.5);
  const r2 = spawnSoldier(game, 'rifleman', 2.5, 1.5);
  const g = spawnSoldier(game, 'shieldGuard', 1.5, 2.5);
  const v = spawnSurvivor(game, 3.5, 6.5);
  const m = spawnMutant(game, 'wanderer', 17.5, 6.5, { mode: 'assault' });
  return { game, r1, r2, g, v, m };
}

describe('unit orders', () => {
  it('rejects commands without any controllable unit', () => {
    const { game, m } = setup();
    expect(applyCommand(game, { type: 'move', unitIds: [m.id, 999], x: 5, y: 5 })).toEqual({ ok: false, reason: 'noValidUnits' });
    expect(applyCommand(game, { type: 'hold', unitIds: [] })).toEqual({ ok: false, reason: 'noValidUnits' });
  });

  it('rejects targets outside the map', () => {
    const { game, r1 } = setup();
    expect(applyCommand(game, { type: 'move', unitIds: [r1.id], x: 25, y: 5 })).toEqual({ ok: false, reason: 'outOfBounds' });
  });

  it('forced move sets the move order, a path, and spreads a group over distinct goals', () => {
    const { game, r1, r2, g, v } = setup();
    expect(applyCommand(game, { type: 'move', unitIds: [r1.id, r2.id, g.id, v.id], x: 15.5, y: 1.5 })).toEqual({ ok: true });
    expect(r1.order).toEqual({ type: 'move', x: 15.5, y: 1.5 });
    expect(v.task).toEqual({ type: 'idle' });
    const goals = [r1, r2, g, v].map((u) => u.motion.goal!);
    for (const goal of goals) expect(Math.hypot(goal.x - 15.5, goal.y - 1.5)).toBeLessThan(2.5);
    expect(new Set(goals.map((p) => `${p.x},${p.y}`)).size).toBe(4);
    for (const u of [r1, r2, g, v]) expect(u.motion.mode).toBe('path');
  });

  it('attack-move orders soldiers and plainly moves survivors in the same selection', () => {
    const { game, r1, v } = setup();
    expect(applyCommand(game, { type: 'attackMove', unitIds: [r1.id, v.id], x: 12.5, y: 7.5 }).ok).toBe(true);
    expect(r1.order).toEqual({ type: 'attackMove', x: 12.5, y: 7.5 });
    expect(v.task).toEqual({ type: 'idle' });
    expect(v.motion.mode).toBe('path');
  });

  it('focus fire validates the target', () => {
    const { game, r1, r2, m, v } = setup();
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [r1.id], targetId: 12345 })).toEqual({ ok: false, reason: 'unknownTarget' });
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [r1.id], targetId: r2.id })).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [r1.id], targetId: m.id })).toEqual({ ok: false, reason: 'targetNotVisible' });
    game.state.fog[Math.floor(m.y) * game.state.map.width + Math.floor(m.x)] = 2;
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [v.id], targetId: m.id })).toEqual({ ok: false, reason: 'noValidUnits' });
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [r1.id, v.id], targetId: m.id })).toEqual({ ok: true });
    expect(r1.order).toEqual({ type: 'attackTarget', targetId: m.id });
  });

  it('stop and hold clear movement', () => {
    const { game, r1, r2 } = setup();
    applyCommand(game, { type: 'move', unitIds: [r1.id, r2.id], x: 15.5, y: 1.5 });
    expect(applyCommand(game, { type: 'stop', unitIds: [r1.id] })).toEqual({ ok: true });
    expect(r1.order).toEqual({ type: 'idle' });
    expect(r1.motion.mode).toBe('stand');
    expect(applyCommand(game, { type: 'hold', unitIds: [r2.id] })).toEqual({ ok: true });
    expect(r2.order).toEqual({ type: 'hold' });
    expect(r2.motion.mode).toBe('stand');
  });

  it('sets rally points only on buildings that train units', () => {
    const { game } = setup();
    const barracks = addBuilding(game, 'barracks', 1, 5, { complete: true });
    const shack = addBuilding(game, 'shack', 14, 5, { complete: true });
    expect(applyCommand(game, { type: 'setRally', buildingId: shack.id, x: 3, y: 3 })).toEqual({ ok: false, reason: 'notMilitary' });
    expect(applyCommand(game, { type: 'setRally', buildingId: barracks.id, x: 30, y: 3 })).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(applyCommand(game, { type: 'setRally', buildingId: barracks.id, x: 6.5, y: 7.5 })).toEqual({ ok: true });
    expect(barracks.rally).toEqual({ x: 6.5, y: 7.5 });
  });
});

describe('command plumbing', () => {
  it('has a handler for every command type that returns a result', () => {
    const { game, r1, m } = setup();
    const b = addBuilding(game, 'barracks', 1, 5, { complete: true });
    const all: Command[] = [
      { type: 'move', unitIds: [r1.id], x: 3, y: 3 },
      { type: 'attackMove', unitIds: [r1.id], x: 3, y: 3 },
      { type: 'attackTarget', unitIds: [r1.id], targetId: m.id },
      { type: 'stop', unitIds: [r1.id] },
      { type: 'hold', unitIds: [r1.id] },
      { type: 'assignWork', unitIds: [r1.id], buildingId: b.id },
      { type: 'unassignWork', buildingId: b.id, count: 1 },
      { type: 'repair', unitIds: [r1.id], buildingId: b.id },
      { type: 'setRally', buildingId: b.id, x: 3, y: 3 },
      { type: 'placeBuilding', building: 'shack', tileX: 14, tileY: 0 },
      { type: 'cancelConstruction', buildingId: b.id },
      { type: 'demolish', buildingId: b.id },
      { type: 'train', buildingId: b.id, unit: 'rifleman' },
      { type: 'cancelTraining', buildingId: b.id, index: 0 },
      { type: 'setResearch', tech: 'armory' },
      { type: 'setPolicy', slot: 0, policy: 'salvageDrive' },
      { type: 'choosePromotion', unitId: r1.id, promotion: 'marksman' },
    ];
    for (const cmd of all) expect(typeof applyCommand(game, cmd).ok, cmd.type).toBe('boolean');
  });

  it('validates without changing the state', () => {
    const { game, r1 } = setup();
    const before = hashValue(game.state);
    expect(validateCommand(game, { type: 'move', unitIds: [r1.id], x: 15.5, y: 1.5 })).toEqual({ ok: true });
    expect(hashValue(game.state)).toBe(before);
  });

  it('rejects every command once the game is over', () => {
    const { game, r1 } = setup();
    game.state.outcome.status = 'lost';
    expect(applyCommand(game, { type: 'stop', unitIds: [r1.id] })).toEqual({ ok: false, reason: 'gameOver' });
  });

  it('accepts focus fire on a discovered nest under explored fog', () => {
    const game = createTestGame(['NN..................', 'NN..................', '....................', '........CCC.........', '........CCC.........', '........CCC.........']);
    const nest = [...game.state.entities.values()].find((e) => e.kind === 'nest')!;
    const r = spawnSoldier(game, 'rifleman', 10.5, 1.5);
    game.state.fog.fill(1);
    game.state.fog[0] = FOG_UNEXPLORED;
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [r.id], targetId: nest.id })).toEqual({ ok: false, reason: 'targetNotVisible' });
    if (nest.kind === 'nest') nest.discovered = true;
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [r.id], targetId: nest.id })).toEqual({ ok: true });
  });
});
