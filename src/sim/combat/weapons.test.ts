import { describe, expect, it } from 'vitest';
import { HUNGER, MUTANTS, SOLDIERS, TOWER_WEAPONS } from '../data/combat';
import { refreshModifiers } from '../game';
import { createTestGame } from '../testing';
import { secondsToTicks } from '../time';
import { addBuilding, spawnMutant, spawnSoldier } from '../world/entities';
import { gapBetween, mutantWeapon, soldierStat, soldierWeapon, towerWeapon, towerWeaponOfType } from './weapons';

const ROWS = ['............', '............', '....CCC.....', '....CCC.....', '....CCC.....', '............'];

describe('weapon profiles', () => {
  it('starts from the data table', () => {
    const game = createTestGame(ROWS);
    const w = soldierWeapon(game, spawnSoldier(game, 'grenadier', 0.5, 0.5));
    const def = SOLDIERS.grenadier.weapon;
    expect(w).toEqual({
      damage: def.damage,
      damageType: def.damageType,
      range: def.range,
      minRange: def.minRange,
      cooldownTicks: secondsToTicks(def.cooldownSeconds),
      splashRadius: def.splashRadius,
      coneCos: 0,
      selfDestruct: false,
      fuelPerShot: 0,
    });
  });

  it('adds promotions to the soldier type modifiers', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'sniper', 0.5, 0.5);
    s.veterancy.promotion = 'longBarrel';
    expect(soldierWeapon(game, s).range).toBe(SOLDIERS.sniper.weapon.range + 2);
    const r = spawnSoldier(game, 'rifleman', 0.5, 0.5);
    r.veterancy.promotion = 'quickHands';
    expect(soldierWeapon(game, r).cooldownTicks).toBe(secondsToTicks(SOLDIERS.rifleman.weapon.cooldownSeconds * 0.8));
    const g = spawnSoldier(game, 'grenadier', 0.5, 0.5);
    g.veterancy.promotion = 'demolisher';
    expect(soldierWeapon(game, g).splashRadius).toBeCloseTo(SOLDIERS.grenadier.weapon.splashRadius + 0.6);
    g.veterancy.promotion = 'steadyArm';
    expect(soldierStat(game, g, 'cooldownPct')).toBeCloseTo(-0.2);
  });

  it('reads unit techs from modifiers and weakens hungry soldiers', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('veteranDoctrine');
    refreshModifiers(game);
    const s = spawnSoldier(game, 'rifleman', 0.5, 0.5);
    expect(soldierStat(game, s, 'hpPct')).toBeCloseTo(0.1);
    s.veterancy.promotion = 'marksman';
    expect(soldierWeapon(game, s).damage).toBeCloseTo(SOLDIERS.rifleman.weapon.damage * 1.25);
    game.state.economy.upkeep.hungry = true;
    expect(soldierWeapon(game, s).damage).toBeCloseTo(SOLDIERS.rifleman.weapon.damage * (1.25 + HUNGER.damagePct));
    expect(soldierStat(game, s, 'speedPct')).toBeCloseTo(HUNGER.speedPct);
  });

  it('scales mutant damage by ai.damagePct', () => {
    const game = createTestGame(ROWS);
    const m = spawnMutant(game, 'crawler', 0.5, 0.5, { mode: 'assault' });
    m.ai.damagePct = 0.15;
    expect(mutantWeapon(m).damage).toBeCloseTo(MUTANTS.crawler.weapon.damage * 1.15);
  });

  it('applies tower modifiers and has no weapon on other buildings', () => {
    const game = createTestGame(ROWS, { origin: 'scavengers' });
    game.state.economy.tech.researched.push('lookoutNetwork', 'steelLine');
    game.state.economy.policies.slots[0] = 'fuelRationing';
    refreshModifiers(game);
    const tower = addBuilding(game, 'machineGunTower', 0, 0, { complete: true });
    const def = TOWER_WEAPONS.machineGunTower!;
    const w = towerWeapon(game, tower)!;
    expect(w.range).toBe(def.range + 1);
    expect(w.damage).toBeCloseTo(def.damage * 1.3);
    expect(w.fuelPerShot).toBeCloseTo(def.fuelPerShot * 0.7);
    expect(towerWeapon(game, addBuilding(game, 'shack', 9, 0, { complete: true }))).toBeNull();
    expect(towerWeapon(game, addBuilding(game, 'machineGunTower', 9, 4, { complete: false }))).toBeNull();
  });

  it('gives the weapon a tower type would have before it is placed (placement preview)', () => {
    const game = createTestGame(ROWS, { origin: 'scavengers' });
    const def = TOWER_WEAPONS.machineGunTower!;
    expect(towerWeaponOfType(game, 'machineGunTower')?.range).toBe(def.range);
    game.state.economy.tech.researched.push('lookoutNetwork');
    refreshModifiers(game);
    expect(towerWeaponOfType(game, 'machineGunTower')?.range).toBe(def.range + 1);
    expect(towerWeaponOfType(game, 'watchtower')).toBeNull();
  });

  it('measures gaps edge to edge for units and footprints', () => {
    const game = createTestGame(ROWS);
    const a = spawnSoldier(game, 'rifleman', 0.5, 0.5);
    const b = spawnMutant(game, 'wanderer', 3.5, 0.5, { mode: 'assault' });
    expect(gapBetween(a, b)).toBeCloseTo(3 - a.radius - b.radius);
    const core = game.state.entities.get(game.state.coreId)!;
    const c = spawnMutant(game, 'wanderer', 3.5, 3.5, { mode: 'assault' });
    expect(gapBetween(c, core)).toBeCloseTo(0.5 - c.radius);
    const tower = addBuilding(game, 'machineGunTower', 0, 5, { complete: true });
    const d = spawnMutant(game, 'wanderer', 4.5, 5.5, { mode: 'assault' });
    expect(gapBetween(tower, d)).toBeCloseTo(3.5 - d.radius);
    expect(gapBetween(d, tower)).toBeCloseTo(3.5 - d.radius);
  });
});
