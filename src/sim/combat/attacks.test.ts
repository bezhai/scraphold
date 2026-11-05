import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commandHandlers';
import { DAMAGE_MULTIPLIER, MUTANTS, PROMOTIONS, SOLDIERS, TOWER_WEAPONS } from '../data/combat';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { createTestGame } from '../testing';
import { clockAt, DAY_TICKS, secondsToTicks } from '../time';
import { addBuilding, spawnMutant, spawnSoldier } from '../world/entities';
import { rebuildSpatialIndex } from '../world/spatial';
import { combatSystem } from './attacks';

const ROWS = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '....................CCC.',
  '....................CCC.',
  '....................CCC.',
];

/** Runs only the combat system, `n` times. */
function fight(game: Game, n = 1): void {
  for (let k = 0; k < n; k++) {
    rebuildSpatialIndex(game.spatial, game.state);
    combatSystem(game);
    game.state.tick++;
  }
}

function atNight(game: Game): void {
  game.state.tick = DAY_TICKS + 10;
  game.state.clock = clockAt(game.state.tick);
}

describe('combat system', () => {
  it('fires at the engaged target once per cooldown', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 1.5);
    const m = spawnMutant(game, 'wanderer', 5.5, 1.5, { mode: 'assault' });
    s.attack.targetId = m.id;
    const dmg = SOLDIERS.rifleman.weapon.damage;
    const cd = secondsToTicks(SOLDIERS.rifleman.weapon.cooldownSeconds);
    fight(game);
    expect(m.hp).toBeCloseTo(MUTANTS.wanderer.hp - dmg);
    fight(game, cd - 1);
    expect(m.hp).toBeCloseTo(MUTANTS.wanderer.hp - dmg);
    fight(game);
    expect(m.hp).toBeCloseTo(MUTANTS.wanderer.hp - 2 * dmg);
    expect(drainEvents(game).filter((e) => e.type === 'shot')).toHaveLength(2);
  });

  it('does not fire at targets out of range', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 1.5);
    const m = spawnMutant(game, 'wanderer', 1.5 + 0.62 + SOLDIERS.rifleman.weapon.range + 0.1, 1.5, { mode: 'assault' });
    s.attack.targetId = m.id;
    fight(game, 5);
    expect(m.hp).toBe(MUTANTS.wanderer.hp);
  });

  it('never lets a grenadier fire inside its minimum range', () => {
    const game = createTestGame(ROWS);
    const g = spawnSoldier(game, 'grenadier', 1.5, 1.5);
    const close = spawnMutant(game, 'wanderer', 3.0, 1.5, { mode: 'assault' });
    g.attack.targetId = close.id;
    g.order = { type: 'hold' };
    fight(game, 60);
    expect(close.hp).toBe(MUTANTS.wanderer.hp);
    const far = spawnMutant(game, 'wanderer', 6.5, 1.5, { mode: 'assault' });
    fight(game, 1);
    expect(far.hp).toBeLessThan(MUTANTS.wanderer.hp);
    expect(close.hp).toBe(MUTANTS.wanderer.hp);
  });

  it('splashes grenades over every mutant near the impact, never friendly units', () => {
    const game = createTestGame(ROWS);
    const g = spawnSoldier(game, 'grenadier', 1.5, 1.5);
    const a = spawnMutant(game, 'wanderer', 6.5, 1.5, { mode: 'assault' });
    const b = spawnMutant(game, 'wanderer', 7.4, 1.5, { mode: 'assault' });
    const c = spawnMutant(game, 'wanderer', 9.5, 1.5, { mode: 'assault' });
    const ally = spawnSoldier(game, 'rifleman', 6.5, 2.3);
    ally.order = { type: 'move', x: 6.5, y: 2.3 }; // keeps it from shooting too
    g.attack.targetId = a.id;
    fight(game);
    const hit = MUTANTS.wanderer.hp - SOLDIERS.grenadier.weapon.damage * DAMAGE_MULTIPLIER.explosive.none;
    expect(a.hp).toBeCloseTo(hit);
    expect(b.hp).toBeCloseTo(hit);
    expect(c.hp).toBe(MUTANTS.wanderer.hp);
    expect(ally.hp).toBe(SOLDIERS.rifleman.hp);
    expect(drainEvents(game)).toContainEqual({ type: 'explosion', x: a.x, y: a.y, radius: SOLDIERS.grenadier.weapon.splashRadius, damageType: 'explosive' });
  });

  it('burns everything in the flamethrower cone and nothing beside or behind it', () => {
    const game = createTestGame(ROWS);
    const f = spawnSoldier(game, 'flamethrower', 5.5, 3.5);
    const front = spawnMutant(game, 'runner', 7.0, 3.5, { mode: 'assault' });
    const frontSide = spawnMutant(game, 'runner', 7.5, 3.9, { mode: 'assault' });
    const beside = spawnMutant(game, 'runner', 5.5, 5.5, { mode: 'assault' });
    const behind = spawnMutant(game, 'runner', 4.0, 3.5, { mode: 'assault' });
    f.attack.targetId = front.id;
    fight(game);
    expect(front.hp).toBeLessThan(MUTANTS.runner.hp);
    expect(frontSide.hp).toBeLessThan(MUTANTS.runner.hp);
    expect(beside.hp).toBe(MUTANTS.runner.hp);
    expect(behind.hp).toBe(MUTANTS.runner.hp);
  });

  it('blows a boomer up on its target, hurting buildings and units around it', () => {
    const game = createTestGame(ROWS);
    const wall = addBuilding(game, 'barricade', 5, 3, { complete: true });
    const boomer = spawnMutant(game, 'boomer', 4.62, 3.5, { mode: 'assault' });
    const s = spawnSoldier(game, 'shieldGuard', 4.5, 4.4);
    boomer.attack.targetId = wall.id;
    fight(game);
    const w = MUTANTS.boomer.weapon;
    expect(boomer.hp).toBe(0);
    expect(wall.hp).toBeCloseTo(wall.maxHp - w.damage * DAMAGE_MULTIPLIER.explosive.structure);
    expect(s.hp).toBeCloseTo(SOLDIERS.shieldGuard.hp - w.damage * DAMAGE_MULTIPLIER.explosive.heavy);
    expect(drainEvents(game)).toContainEqual({ type: 'explosion', x: boomer.x, y: boomer.y, radius: w.splashRadius, damageType: 'explosive' });
  });

  it('lets mutants hit their target with difficulty damage scaling', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 1.5);
    const m = spawnMutant(game, 'wanderer', 2.1, 1.5, { mode: 'assault' });
    m.ai.damagePct = 0.15;
    m.attack.targetId = s.id;
    fight(game);
    expect(s.hp).toBeCloseTo(SOLDIERS.rifleman.hp - MUTANTS.wanderer.weapon.damage * 1.15);
  });

  it('keeps retreating mutants and force-moving soldiers from attacking', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 1.5);
    const m = spawnMutant(game, 'wanderer', 2.1, 1.5, { mode: 'retreat' });
    s.order = { type: 'move', x: 10, y: 1 };
    s.attack.targetId = m.id;
    m.attack.targetId = s.id;
    fight(game, 30);
    expect(s.hp).toBe(SOLDIERS.rifleman.hp);
    expect(m.hp).toBe(MUTANTS.wanderer.hp);
  });

  it('fires machine-gun towers for free by day and for fuel at night, silent without fuel', () => {
    const game = createTestGame(ROWS);
    addBuilding(game, 'machineGunTower', 3, 3, { complete: true });
    const m = spawnMutant(game, 'crawler', 7.5, 3.5, { mode: 'assault' });
    const w = TOWER_WEAPONS.machineGunTower!;
    game.state.economy.resources.fuel = 0;
    fight(game);
    expect(m.hp).toBeCloseTo(MUTANTS.crawler.hp - w.damage * DAMAGE_MULTIPLIER.normal.heavy);
    atNight(game);
    const hp = m.hp;
    fight(game, 40);
    expect(m.hp).toBe(hp);
    game.state.economy.resources.fuel = 1;
    fight(game, 1);
    expect(m.hp).toBeLessThan(hp);
    expect(game.state.economy.resources.fuel).toBeCloseTo(1 - w.fuelPerShot);
  });

  it('counts a tower kill', () => {
    const game = createTestGame(ROWS);
    addBuilding(game, 'machineGunTower', 3, 3, { complete: true });
    const m = spawnMutant(game, 'runner', 5.5, 3.5, { mode: 'assault' });
    m.hp = 1;
    fight(game);
    expect(game.state.stats.towerKills).toBe(1);
    expect(game.state.stats.kills.runner).toBe(1);
  });
});

describe('choosePromotion', () => {
  it('requires a pending promotion and one of the two options of the unit type', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'shieldGuard', 1.5, 1.5);
    expect(applyCommand(game, { type: 'choosePromotion', unitId: 999, promotion: 'ironWall' })).toEqual({ ok: false, reason: 'noValidUnits' });
    expect(applyCommand(game, { type: 'choosePromotion', unitId: s.id, promotion: 'ironWall' })).toEqual({ ok: false, reason: 'noPromotionPending' });
    s.veterancy.pending = true;
    expect(applyCommand(game, { type: 'choosePromotion', unitId: s.id, promotion: 'marksman' })).toEqual({ ok: false, reason: 'invalidPromotion' });
    expect(applyCommand(game, { type: 'choosePromotion', unitId: s.id, promotion: SOLDIERS.shieldGuard.promotions[0] })).toEqual({ ok: true });
    expect(s.veterancy).toMatchObject({ promotion: 'ironWall', pending: false });
    expect(game.state.stats.promotions).toBe(1);
    expect(applyCommand(game, { type: 'choosePromotion', unitId: s.id, promotion: 'bulwarkStrike' })).toEqual({ ok: false, reason: 'noPromotionPending' });
  });

  it('applies the promotion to max hp right away, keeping the health fraction', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'shieldGuard', 1.5, 1.5);
    s.hp = SOLDIERS.shieldGuard.hp - 40;
    s.veterancy.pending = true;
    applyCommand(game, { type: 'choosePromotion', unitId: s.id, promotion: 'ironWall' });
    const pct = PROMOTIONS.ironWall.effects[0]!.value;
    expect(s.maxHp).toBeCloseTo(SOLDIERS.shieldGuard.hp * (1 + pct));
    expect(s.hp).toBeCloseTo(s.maxHp * (SOLDIERS.shieldGuard.hp - 40) / SOLDIERS.shieldGuard.hp);
  });
});
