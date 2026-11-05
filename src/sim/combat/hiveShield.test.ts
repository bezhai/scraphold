/**
 * Hive shield: every ordinary nest still standing (discovered or not, split-offs included) cuts
 * the damage the hive takes, up to a cap; with no ordinary nest left the hive takes full damage.
 * Ordinary nests never get the reduction.
 */
import { describe, expect, it } from 'vitest';
import { HIVE_SHIELD, SOLDIER_TYPES, SOLDIERS, type SoldierType } from '../data/combat';
import { applyCommand } from '../commandHandlers';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { raiseIncident, incidentTargetSystem } from '../incidents/incidents';
import type { Nest } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, clockAt } from '../time';
import { removeEntity, spawnSoldier } from '../world/entities';
import { createGame } from '../world/setup';
import { rebuildSpatialIndex } from '../world/spatial';
import { combatSystem } from './attacks';
import { applyHit } from './damage';
import { hiveDamageReduction, ordinaryNestsLeft } from './hiveShield';

// Hive at tiles 9-11 x 2-4; three ordinary nests along the bottom, well out of every splash.
const ROWS = [
  '.........................',
  '.CCC.....................',
  '.CCC.....HHH.............',
  '.CCC.....HHH.............',
  '.........HHH.............',
  '.........................',
  '.........................',
  '.........................',
  'NN.........NN.........NN.',
  'NN.........NN.........NN.',
];

function nestsOf(game: Game): { hive: Nest; ordinary: Nest[] } {
  const all = [...game.state.entities.values()].filter((e): e is Nest => e.kind === 'nest');
  return { hive: all.find((n) => n.isHive)!, ordinary: all.filter((n) => !n.isHive) };
}

describe('hiveDamageReduction', () => {
  it('grows by the per-nest step and stops at the cap', () => {
    expect(hiveDamageReduction(0)).toBe(0);
    expect(hiveDamageReduction(1)).toBeCloseTo(HIVE_SHIELD.reductionPerNest, 10);
    expect(hiveDamageReduction(3)).toBeCloseTo(3 * HIVE_SHIELD.reductionPerNest, 10);
    const capAt = Math.ceil(HIVE_SHIELD.maxReduction / HIVE_SHIELD.reductionPerNest - 1e-9);
    expect(hiveDamageReduction(capAt)).toBeCloseTo(HIVE_SHIELD.maxReduction, 10);
    expect(hiveDamageReduction(capAt + 1)).toBe(HIVE_SHIELD.maxReduction);
    expect(hiveDamageReduction(20)).toBe(HIVE_SHIELD.maxReduction);
  });

  it('is a partial reduction: the cap never makes the hive immune', () => {
    expect(HIVE_SHIELD.reductionPerNest).toBeGreaterThan(0);
    expect(HIVE_SHIELD.maxReduction).toBeLessThan(1);
  });
});

describe('ordinaryNestsLeft', () => {
  it('counts every living ordinary nest on a generated map, undiscovered ones included, but not the hive', () => {
    const game = createGame({ seed: 'shield-count', origin: 'scavengers', difficulty: 'normal' });
    const { ordinary } = nestsOf(game);
    expect(ordinary.length).toBeGreaterThan(0);
    expect(ordinary.every((n) => !n.discovered)).toBe(true);
    expect(ordinaryNestsLeft(game.state)).toBe(ordinary.length);
  });

  it('drops a nest the moment it is destroyed, before cleanup removes it', () => {
    const game = createTestGame(ROWS);
    const { ordinary } = nestsOf(game);
    const sniper = spawnSoldier(game, 'sniper', 5.5, 6.5);
    expect(ordinaryNestsLeft(game.state)).toBe(3);
    applyHit(game, sniper, ordinary[0]!, 1e6, 'pierce');
    expect(game.state.entities.has(ordinary[0]!.id)).toBe(true);
    expect(ordinaryNestsLeft(game.state)).toBe(2);
    // The event log reads the count at the moment of destruction, not when it drains the events.
    expect(drainEvents(game)).toContainEqual(expect.objectContaining({ type: 'nestDestroyed', nestId: ordinary[0]!.id, isHive: false, nestsLeft: 2 }));
  });

  it('counts a nest that a split incident spawns', () => {
    const game = createGame({ seed: 'shield-split', origin: 'scavengers', difficulty: 'normal' });
    game.state.tick = CYCLE_TICKS + 200;
    game.state.clock = clockAt(game.state.tick);
    raiseIncident(game, 'nestSplit');
    const incidentId = game.state.incidents.pending!.id;
    expect(applyCommand(game, { type: 'resolveIncident', incidentId, choiceId: 'mark' }).ok).toBe(true);
    const before = ordinaryNestsLeft(game.state);
    const target = game.state.incidents.targets.at(-1)!;
    game.state.tick = target.expiresTick;
    game.state.clock = clockAt(game.state.tick);
    incidentTargetSystem(game);
    expect(target.status).toBe('expired');
    expect(ordinaryNestsLeft(game.state)).toBe(before + 1);
    expect(hiveDamageReduction(ordinaryNestsLeft(game.state))).toBeCloseTo(Math.min(HIVE_SHIELD.maxReduction, (before + 1) * HIVE_SHIELD.reductionPerNest), 10);
  });
});

describe('hit damage on the hive', () => {
  it('a hit on the hive is cut by the reduction for the ordinary nests left', () => {
    const game = createTestGame(ROWS);
    const { hive, ordinary } = nestsOf(game);
    const sniper = spawnSoldier(game, 'sniper', 14.5, 3.5);
    const full = 1000 * 0.5; // pierce vs structure
    hive.hp = hive.maxHp;
    expect(applyHit(game, sniper, hive, 1000, 'pierce')).toBeCloseTo(full * (1 - hiveDamageReduction(3)), 6);
    applyHit(game, sniper, ordinary[0]!, 1e6, 'pierce');
    hive.hp = hive.maxHp;
    expect(applyHit(game, sniper, hive, 1000, 'pierce')).toBeCloseTo(full * (1 - hiveDamageReduction(2)), 6);
  });

  it('takes full damage once every ordinary nest is destroyed', () => {
    const game = createTestGame(ROWS);
    const { hive, ordinary } = nestsOf(game);
    const sniper = spawnSoldier(game, 'sniper', 14.5, 3.5);
    for (const n of ordinary) applyHit(game, sniper, n, 1e6, 'pierce');
    expect(ordinaryNestsLeft(game.state)).toBe(0);
    expect(applyHit(game, sniper, hive, 1000, 'explosive')).toBeCloseTo(1000 * 1.6, 6);
  });

  it('ordinary nests take full damage however many nests are left', () => {
    const game = createTestGame(ROWS);
    const { ordinary } = nestsOf(game);
    const sniper = spawnSoldier(game, 'sniper', 5.5, 6.5);
    expect(applyHit(game, sniper, ordinary[1]!, 100, 'explosive')).toBeCloseTo(100 * 1.6, 6);
  });
});

/** Gap from the hive's right edge that each weapon can fire at (inside [minRange, range]). */
function firingGap(type: SoldierType): number {
  const w = SOLDIERS[type].weapon;
  return Math.min(w.range - 0.05, Math.max(w.minRange + 0.3, 0.3));
}

/** Hp one real shot from a fresh soldier of `type` takes off the hive, through the combat system. */
function oneShot(game: Game, hive: Nest, type: SoldierType): number {
  const s = spawnSoldier(game, type, hive.tileX + hive.size + firingGap(type) + SOLDIERS[type].radius, hive.y);
  s.attack.targetId = hive.id;
  rebuildSpatialIndex(game.spatial, game.state);
  hive.hp = hive.maxHp;
  combatSystem(game);
  const taken = hive.maxHp - hive.hp;
  removeEntity(game, s);
  return taken;
}

describe('every soldier weapon goes through the shield', () => {
  it.each(SOLDIER_TYPES.map((t) => [t]))('%s: single shots, splash and cones are all reduced', (type) => {
    const game = createTestGame(ROWS);
    const { hive, ordinary } = nestsOf(game);
    const shielded = oneShot(game, hive, type);
    for (const n of ordinary) removeEntity(game, n);
    const full = oneShot(game, hive, type);
    expect(full).toBeGreaterThan(0);
    expect(shielded / full).toBeCloseTo(1 - hiveDamageReduction(ordinary.length), 6);
  });
});
