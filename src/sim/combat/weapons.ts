/**
 * Effective weapons and the distances they are measured with. Data-table weapons are adjusted by
 * the soldier type's tech modifiers, the chosen promotion and hunger (soldiers), by difficulty and
 * boss scaling through MutantAi.damagePct (mutants), and by the tower modifiers (towers).
 * Pure functions of the current state; nothing here is stored. Owner: Task 3.
 */
import { isRemote } from '../world/remote';
import { HUNGER, MUTANTS, PROMOTIONS, SOLDIERS, TOWER_WEAPONS, type DamageType, type WeaponDef } from '../data/combat';
import type { BuildingType } from '../data/economy';
import type { Game } from '../game';
import { distanceToRect } from '../map/grid';
import type { UnitStat } from '../modifiers';
import type { Building, Entity, Mutant, Soldier } from '../state';
import { secondsToTicks } from '../time';
import type { Attacker } from './damage';

export interface WeaponProfile {
  damage: number;
  damageType: DamageType;
  range: number;
  minRange: number;
  cooldownTicks: number;
  splashRadius: number;
  coneCos: number;
  selfDestruct: boolean;
  fuelPerShot: number;
}

function profile(w: WeaponDef, damagePct: number, rangeAdd: number, cooldownPct: number, splashAdd: number): WeaponProfile {
  return {
    damage: w.damage * Math.max(0, 1 + damagePct),
    damageType: w.damageType,
    range: w.range + rangeAdd,
    minRange: w.minRange,
    cooldownTicks: Math.max(1, secondsToTicks(w.cooldownSeconds * Math.max(0.1, 1 + cooldownPct))),
    splashRadius: w.splashRadius > 0 ? w.splashRadius + splashAdd : 0,
    coneCos: w.coneCos,
    selfDestruct: w.selfDestruct,
    fuelPerShot: w.fuelPerShot,
  };
}

/** What a soldier's weapon and stats depend on besides the game: its type and promotion. Read-only views fit. */
export type SoldierLoadout = Pick<Soldier, 'type' | 'veterancy' | 'x' | 'y' | 'deploymentGoal'>;

/** A soldier's unit stat: type modifiers (techs) + its promotion + hunger. */
export function soldierStat(game: Game, s: SoldierLoadout, stat: UnitStat): number {
  let v = game.modifiers.unit[s.type][stat];
  const g = game.modifiers.global;
  if (isRemote(game.state, s)) {
    if (stat === 'hpPct') v += g.remoteSoldierHpPct;
    if (stat === 'damagePct') v += g.remoteSoldierDamagePct;
  }
  if (stat === 'visionAdd' && game.state.clock.phase === 'night') v += g.nightSoldierVisionAdd;
  if (stat === 'speedPct' && s.deploymentGoal) v += g.rallySpeedPct;
  const p = s.veterancy.promotion;
  if (p) for (const e of PROMOTIONS[p].effects) if (e.stat === stat) v += e.value;
  if (game.state.economy.upkeep.hungry) {
    if (stat === 'damagePct') v += HUNGER.damagePct * Math.max(0, 1 - g.hungerPenaltyReduction);
    if (stat === 'speedPct') v += HUNGER.speedPct * Math.max(0, 1 - g.hungerPenaltyReduction);
  }
  return v;
}

export function soldierWeapon(game: Game, s: SoldierLoadout): WeaponProfile {
  const stat = (k: UnitStat) => soldierStat(game, s, k);
  return profile(SOLDIERS[s.type].weapon, stat('damagePct'), stat('rangeAdd'), stat('cooldownPct'), stat('splashAdd'));
}

export function mutantWeapon(m: Pick<Mutant, 'type' | 'ai'>): WeaponProfile {
  return profile(MUTANTS[m.type].weapon, m.ai.damagePct, 0, 0, 0);
}

/** The weapon a finished building of this type has with the current modifiers, null for types without one. */
export function towerWeaponOfType(game: Game, type: BuildingType): WeaponProfile | null {
  const def = TOWER_WEAPONS[type];
  if (!def) return null;
  const g = game.modifiers.global;
  const w = profile(def, g.towerDamagePct, g.towerRangeAdd, 0, 0);
  w.fuelPerShot = def.fuelPerShot * Math.max(0, 1 + g.towerFuelCostPct);
  return w;
}

/** The weapon of a finished defense building, null for buildings without one. */
export function towerWeapon(game: Game, b: Pick<Building, 'type' | 'construction'>): WeaponProfile | null {
  return b.construction !== null ? null : towerWeaponOfType(game, b.type);
}

export function weaponOf(game: Game, a: Attacker): WeaponProfile | null {
  if (a.kind === 'soldier') return soldierWeapon(game, a);
  if (a.kind === 'mutant') return mutantWeapon(a);
  return towerWeapon(game, a);
}

function isStructure(e: Entity): e is Extract<Entity, { tileX: number }> {
  return e.kind === 'building' || e.kind === 'nest';
}

/** Edge-to-edge distance: unit bodies are circles, structures their footprint rectangles. */
export function gapBetween(a: Entity, b: Entity): number {
  if (isStructure(a)) {
    if (isStructure(b)) return 0;
    return Math.max(0, distanceToRect(a.tileX, a.tileY, a.size, b.x, b.y) - b.radius);
  }
  if (isStructure(b)) return Math.max(0, distanceToRect(b.tileX, b.tileY, b.size, a.x, a.y) - a.radius);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.max(0, Math.sqrt(dx * dx + dy * dy) - a.radius - b.radius);
}
