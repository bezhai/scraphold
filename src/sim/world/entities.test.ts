import { describe, expect, it } from 'vitest';
import { MUTANTS, SOLDIERS } from '../data/combat';
import { BUILDINGS, SURVIVOR } from '../data/economy';
import { secondsToTicks } from '../time';
import { createTestGame } from '../testing';
import { addBuilding, enterBuilding, exitBuilding, removeEntity, spawnMutant, spawnSoldier, spawnSurvivor } from './entities';

const OPEN = [
  '..........',
  '..........',
  '..........',
  '...CCC....',
  '...CCC....',
  '...CCC....',
  '..........',
  '..........',
];

describe('entity factories', () => {
  it('records the intended assault objective separately from the current combat target', () => {
    const game = createTestGame(OPEN);
    const ordinary = spawnMutant(game, 'runner', 1.5, 1.5, { mode: 'assault' });
    const directed = spawnMutant(game, 'runner', 2.5, 1.5, { mode: 'assault', assaultTargetId: game.state.coreId });
    expect(ordinary.ai.assaultTargetId).toBe(0);
    expect(directed.ai.assaultTargetId).toBe(game.state.coreId);
    expect(directed.attack.targetId).toBe(0);
  });

  it('creates the core from the map and gives every new entity a fresh increasing id', () => {
    const game = createTestGame(OPEN);
    const core = game.state.entities.get(game.state.coreId)!;
    expect(core).toMatchObject({ kind: 'building', type: 'core', tileX: 3, tileY: 3, size: 3, x: 4.5, y: 4.5, construction: null });
    const a = spawnSoldier(game, 'rifleman', 1.5, 1.5);
    const b = spawnSurvivor(game, 2.5, 1.5);
    expect(b.id).toBe(a.id + 1);
    expect(game.state.entities.get(a.id)).toBe(a);
  });

  it('takes soldier, survivor and mutant stats from the data tables', () => {
    const game = createTestGame(OPEN);
    const s = spawnSoldier(game, 'shieldGuard', 1.5, 1.5);
    expect(s).toMatchObject({ hp: SOLDIERS.shieldGuard.hp, maxHp: SOLDIERS.shieldGuard.hp, armor: 'heavy', vision: SOLDIERS.shieldGuard.vision });
    expect(s.motion).toMatchObject({ mode: 'stand', speed: SOLDIERS.shieldGuard.speed, mass: SOLDIERS.shieldGuard.mass });
    expect(s.order).toEqual({ type: 'idle' });
    const v = spawnSurvivor(game, 1.5, 2.5);
    expect(v).toMatchObject({ hp: SURVIVOR.hp, insideId: 0, task: { type: 'idle' } });
    const m = spawnMutant(game, 'crawler', 8.5, 1.5, { mode: 'assault', hpPct: 1.5, boss: false });
    expect(m).toMatchObject({ faction: 'mutant', maxHp: MUTANTS.crawler.hp * 1.5, hp: MUTANTS.crawler.hp * 1.5 });
    expect(m.ai.mode).toBe('assault');
  });

  it('creates construction sites with progress from buildSeconds and bumps the nav version', () => {
    const game = createTestGame(OPEN);
    const before = game.state.navVersion;
    const site = addBuilding(game, 'shack', 7, 0, { complete: false });
    expect(site.construction).toEqual({ progress: 0, paid: {}, total: secondsToTicks(BUILDINGS.shack.buildSeconds) });
    expect(site.hp).toBeLessThan(site.maxHp);
    expect(site).toMatchObject({ x: 8, y: 1, size: 2, radius: 1 });
    expect(game.state.navVersion).toBe(before + 1);
    const done = addBuilding(game, 'barricade', 0, 0, { complete: true });
    expect(done.construction).toBeNull();
    expect(done.hp).toBe(BUILDINGS.barricade.hp);
  });

  it('moves survivors into and out of buildings, keeping the worker list in sync', () => {
    const game = createTestGame(OPEN);
    const yard = addBuilding(game, 'salvageYard', 7, 0, { complete: true });
    const v = spawnSurvivor(game, 6.5, 0.5);
    enterBuilding(game, v, yard);
    expect(v.insideId).toBe(yard.id);
    expect(yard.workers).toEqual([v.id]);
    expect([v.x, v.y]).toEqual([yard.x, yard.y]);
    exitBuilding(game, v);
    expect(v.insideId).toBe(0);
    expect(yard.workers).toEqual([]);
    // Placed on a free tile touching the footprint.
    const tx = Math.floor(v.x);
    const ty = Math.floor(v.y);
    expect(tx >= 6 && tx <= 9 && ty >= 0 && ty <= 2).toBe(true);
    expect(tx >= 7 && tx <= 8 && ty <= 1).toBe(false);
  });

  it('ejects workers when a building is removed and bumps the nav version', () => {
    const game = createTestGame(OPEN);
    const yard = addBuilding(game, 'salvageYard', 7, 0, { complete: true });
    const v = spawnSurvivor(game, 6.5, 0.5);
    enterBuilding(game, v, yard);
    v.task = { type: 'work', buildingId: yard.id };
    const before = game.state.navVersion;
    removeEntity(game, yard);
    expect(game.state.entities.has(yard.id)).toBe(false);
    expect(v.insideId).toBe(0);
    expect(v.task).toEqual({ type: 'idle' });
    expect(game.state.navVersion).toBe(before + 1);
  });

  it('removes a survivor working inside from its building worker list', () => {
    const game = createTestGame(OPEN);
    const yard = addBuilding(game, 'salvageYard', 7, 0, { complete: true });
    const v = spawnSurvivor(game, 6.5, 0.5);
    enterBuilding(game, v, yard);
    removeEntity(game, v);
    expect(yard.workers).toEqual([]);
    expect(game.state.entities.has(v.id)).toBe(false);
  });
});
