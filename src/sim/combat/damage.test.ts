import { describe, expect, it } from 'vitest';
import { ALERT_THROTTLE_SECONDS, DAMAGE_MULTIPLIER, NEST, SOLDIERS } from '../data/combat';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { refreshModifiers } from '../game';
import type { Building, Nest } from '../state';
import { createTestGame } from '../testing';
import { clockAt, DAY_TICKS, secondsToTicks } from '../time';
import { addBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from '../world/entities';
import { applyHit, damageMultiplier, hitDamage } from './damage';

const ROWS = [
  '....................',
  '....................',
  '........CCC.........',
  '........CCC.........',
  '........CCC......NN.',
  '.................NN.',
  '....................',
];

function setTick(game: Game, tick: number): void {
  game.state.tick = tick;
  game.state.clock = clockAt(tick);
}

describe('damage', () => {
  it('multiplies weapon damage by the damage type x armor table', () => {
    expect(damageMultiplier('pierce', 'heavy')).toBe(DAMAGE_MULTIPLIER.pierce.heavy);
    expect(damageMultiplier('pierce', 'heavy')).toBeGreaterThan(1.5);
    expect(damageMultiplier('normal', 'heavy')).toBeLessThan(1);
    expect(damageMultiplier('fire', 'none')).toBeGreaterThan(damageMultiplier('fire', 'heavy'));
  });

  it('makes a sniper hit a crawler far harder than a rifleman does', () => {
    const game = createTestGame(ROWS);
    const crawler = spawnMutant(game, 'crawler', 2.5, 5.5, { mode: 'assault' });
    const sniper = SOLDIERS.sniper.weapon;
    const rifle = SOLDIERS.rifleman.weapon;
    expect(hitDamage(game, crawler, sniper.damage, sniper.damageType)).toBeCloseTo(sniper.damage * 1.75);
    expect(hitDamage(game, crawler, rifle.damage, rifle.damageType)).toBeCloseTo(rifle.damage * 0.5);
  });

  it('applies building damage-taken modifiers, plus the night modifier only at night', () => {
    const game = createTestGame(ROWS, { origin: 'scavengers' });
    const wall = addBuilding(game, 'barricade', 1, 1, { complete: true });
    game.state.economy.policies.slots[0] = 'curfew';
    refreshModifiers(game);
    expect(hitDamage(game, wall, 100, 'normal')).toBeCloseTo(100 * DAMAGE_MULTIPLIER.normal.structure);
    setTick(game, DAY_TICKS + 5);
    expect(game.state.clock.phase).toBe('night');
    expect(hitDamage(game, wall, 100, 'normal')).toBeCloseTo(100 * DAMAGE_MULTIPLIER.normal.structure * 0.75);
  });

  it('records the hit tick and raises an alert only after a quiet period', () => {
    const game = createTestGame(ROWS);
    const wall = addBuilding(game, 'barricade', 1, 1, { complete: true });
    const m = spawnMutant(game, 'wanderer', 2.5, 1.5, { mode: 'assault' });
    setTick(game, 100);
    applyHit(game, m, wall, 10, 'normal');
    expect(wall.lastDamagedTick).toBe(100);
    setTick(game, 101);
    applyHit(game, m, wall, 10, 'normal');
    const quiet = secondsToTicks(ALERT_THROTTLE_SECONDS);
    setTick(game, 101 + quiet);
    applyHit(game, m, wall, 10, 'normal');
    const alerts = drainEvents(game).filter((e) => e.type === 'underAttack');
    expect(alerts).toEqual([
      { type: 'underAttack', entityId: wall.id, x: wall.x, y: wall.y, core: false },
      { type: 'underAttack', entityId: wall.id, x: wall.x, y: wall.y, core: false },
    ]);
    const core = game.state.entities.get(game.state.coreId)!;
    applyHit(game, m, core, 10, 'normal');
    expect(drainEvents(game)).toContainEqual({ type: 'underAttack', entityId: core.id, x: core.x, y: core.y, core: true });
  });

  it('counts player kills per mutant type, tower kills separately, and never twice', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 5.5);
    const tower = addBuilding(game, 'machineGunTower', 1, 1, { complete: true });
    const a = spawnMutant(game, 'runner', 3.5, 5.5, { mode: 'assault' });
    const b = spawnMutant(game, 'runner', 3.5, 6.5, { mode: 'assault' });
    applyHit(game, s, a, 1000, 'normal');
    applyHit(game, s, a, 1000, 'normal');
    applyHit(game, tower, b, 1000, 'normal');
    expect(game.state.stats.kills.runner).toBe(2);
    expect(game.state.stats.towerKills).toBe(1);
    expect(s.veterancy.kills).toBe(1);
  });

  it('counts player losses: soldiers, survivors and buildings (not the core)', () => {
    const game = createTestGame(ROWS);
    const m = spawnMutant(game, 'crawler', 5.5, 5.5, { mode: 'assault' });
    applyHit(game, m, spawnSoldier(game, 'rifleman', 4.5, 5.5), 1e6, 'normal');
    applyHit(game, m, spawnSurvivor(game, 4.5, 6.5), 1e6, 'normal');
    applyHit(game, m, addBuilding(game, 'shack', 1, 0, { complete: true }), 1e6, 'normal');
    applyHit(game, m, game.state.entities.get(game.state.coreId)!, 1e6, 'normal');
    expect(game.state.stats).toMatchObject({ soldiersLost: 1, survivorsLost: 1, buildingsLost: 1, buildingsLostTonight: 1 });
  });

  it('makes a soldier a veteran with a pending promotion at its kill threshold', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'sniper', 1.5, 5.5);
    const need = SOLDIERS.sniper.veteranKills;
    for (let k = 0; k < need; k++) applyHit(game, s, spawnMutant(game, 'wanderer', 3.5, 5.5, { mode: 'assault' }), 1e6, 'pierce');
    expect(s.veterancy).toEqual({ kills: need, promotion: null, pending: true });
    expect(drainEvents(game).filter((e) => e.type === 'promotionReady')).toEqual([{ type: 'promotionReady', unitId: s.id }]);
  });

  it('lowers the veterancy threshold with veterancyKillsPct', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('veteranDoctrine');
    refreshModifiers(game);
    const s = spawnSoldier(game, 'rifleman', 1.5, 5.5);
    const need = Math.round(SOLDIERS.rifleman.veteranKills * 0.7);
    for (let k = 0; k < need; k++) applyHit(game, s, spawnMutant(game, 'wanderer', 3.5, 5.5, { mode: 'assault' }), 1e6, 'normal');
    expect(s.veterancy.pending).toBe(true);
  });

  it('rewards fuel, research and survivors scaled by level when the player destroys a nest', () => {
    const game = createTestGame(ROWS);
    const nest = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    nest.growth.level = 3;
    const s = spawnSoldier(game, 'sniper', 14.5, 5.5);
    const before = { ...game.state.economy.resources };
    applyHit(game, s, nest, 1e6, 'pierce');
    const fuel = NEST.reward.fuel + 2 * NEST.reward.fuelPerLevel;
    const research = NEST.reward.research + 2 * NEST.reward.researchPerLevel;
    expect(game.state.economy.resources.fuel - before.fuel).toBe(fuel);
    expect(game.state.economy.resources.research - before.research).toBe(research);
    expect(game.state.stats.resourcesGathered).toMatchObject({ fuel, research });
    expect(game.state.stats.nestsDestroyed).toBe(1);
    expect(game.state.stats.survivorsRecruited).toBe(NEST.reward.survivors);
    const survivors = [...game.state.entities.values()].filter((e) => e.kind === 'survivor');
    expect(survivors).toHaveLength(NEST.reward.survivors);
    const events = drainEvents(game);
    expect(events).toContainEqual({ type: 'nestDestroyed', nestId: nest.id, isHive: false, nestsLeft: 0, reward: { fuel, research }, survivors: NEST.reward.survivors });
    expect(events).toContainEqual({ type: 'survivorJoined', unitId: survivors[0]!.id, source: 'nest' });
  });

  it('marks the hive destroyed', () => {
    const game = createTestGame(['.........', '.CCC..HHH', '.CCC..HHH', '.CCC..HHH']);
    const hive = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest' && e.isHive)!;
    applyHit(game, spawnSoldier(game, 'sniper', 0.5, 0.5), hive, 1e7, 'pierce');
    expect(game.state.stats.hiveDestroyed).toBe(true);
    expect(game.state.stats.nestsDestroyed).toBe(0);
  });

  it('scales nest rewards with nestRewardPct', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('lookoutNetwork');
    game.state.economy.policies.slots[0] = 'bountyHunters';
    refreshModifiers(game);
    const nest = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    const fuelBefore = game.state.economy.resources.fuel;
    applyHit(game, spawnSoldier(game, 'sniper', 14.5, 5.5), nest, 1e6, 'pierce');
    expect(game.state.economy.resources.fuel - fuelBefore).toBeCloseTo(NEST.reward.fuel * 1.5);
  });

  it('ignores hits on entities that are already dead', () => {
    const game = createTestGame(ROWS);
    const b = addBuilding(game, 'barricade', 1, 1, { complete: true }) as Building;
    const m = spawnMutant(game, 'wanderer', 2.5, 1.5, { mode: 'assault' });
    b.hp = 0;
    expect(applyHit(game, m, b, 10, 'normal')).toBe(0);
    expect(game.state.stats.buildingsLost).toBe(0);
  });
});
