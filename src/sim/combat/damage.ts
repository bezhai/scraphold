/**
 * One hit and everything that follows from it: the damage type x armor multiplier, building
 * damage-taken modifiers (per building type, and at night), the hive shield (hiveShield.ts), hit
 * ticks and underAttack alerts, and on a kill the bookkeeping: kill and loss stats, veterancy,
 * nest and hive destruction. Removal of dead entities stays with world/cleanup.ts at the end of
 * the tick. Owner: Task 3.
 */
import { signalDamageFactor } from '../signal/signal';
import { ALERT_THROTTLE_SECONDS, DAMAGE_MULTIPLIER, SOLDIERS, type ArmorType, type DamageType } from '../data/combat';
import { emit } from '../events';
import type { Game } from '../game';
import type { Building, Entity, Mutant, Soldier } from '../state';
import { secondsToTicks } from '../time';
import { hiveDamageReduction, ordinaryNestsLeft } from './hiveShield';
import { destroyNest } from './nests';

/** Anything with a weapon: soldiers, mutants, towers. */
export type Attacker = Soldier | Mutant | Building;

const ALERT_QUIET_TICKS = secondsToTicks(ALERT_THROTTLE_SECONDS);

export function damageMultiplier(type: DamageType, armor: ArmorType): number {
  return DAMAGE_MULTIPLIER[type][armor];
}

/** Timed incident protection also applies to environmental building damage. */
function nightIncidentDamageFactor(game: Game): number {
  return game.state.clock.phase === 'night' ? game.modifiers.factor.nightBuildingDamage : 1;
}

/** Hp that `raw` weapon damage of `type` removes from `target` (the hive shield included). */
export function hitDamage(game: Game, target: Entity, raw: number, type: DamageType): number {
  let dmg = raw * damageMultiplier(type, target.armor);
  if (target.kind === 'building') {
    let taken = game.modifiers.building[target.type].damageTakenPct;
    if (game.state.clock.phase === 'night') taken += game.modifiers.global.nightBuildingDamageTakenPct;
    dmg *= Math.max(0, 1 + taken) * signalDamageFactor(game, target) * nightIncidentDamageFactor(game);
  } else if (target.kind === 'nest' && target.isHive) {
    dmg *= 1 - hiveDamageReduction(ordinaryNestsLeft(game.state));
  }
  return dmg;
}

/** Kills needed for this soldier's promotion (veterancyKillsPct applied, at least 1). */
export function veteranThreshold(game: Game, s: Pick<Soldier, 'type'>): number {
  return Math.max(1, Math.round(SOLDIERS[s.type].veteranKills * (1 + game.modifiers.global.veterancyKillsPct)));
}

/** Marks the promotion as pending once the soldier's kills reach its threshold (once per soldier). */
export function checkVeterancy(game: Game, s: Soldier): void {
  const v = s.veterancy;
  if (v.promotion !== null || v.pending || v.kills < veteranThreshold(game, s)) return;
  v.pending = true;
  emit(game, { type: 'promotionReady', unitId: s.id });
}

function creditKill(game: Game, s: Soldier): void {
  s.veterancy.kills++;
  checkVeterancy(game, s);
}

function onKilled(game: Game, attacker: Attacker | null, target: Entity): void {
  const stats = game.state.stats;
  switch (target.kind) {
    case 'mutant':
      if (attacker?.faction !== 'player') return;
      stats.kills[target.type]++;
      if (attacker.kind === 'building') stats.towerKills++;
      else if (attacker.kind === 'soldier') creditKill(game, attacker);
      return;
    case 'nest':
      if (attacker?.faction === 'player') destroyNest(game, target);
      return;
    case 'building':
      if (target.id === game.state.coreId || target.type === 'barricade') return;
      stats.buildingsLost++;
      stats.buildingsLostTonight++;
      return;
    case 'soldier':
      stats.soldiersLost++;
      return;
    case 'survivor':
      stats.survivorsLost++;
      return;
  }
}

/**
 * Applies one hit of `raw` weapon damage to a living target. Returns the hp removed (0 when the
 * target was already dead). Player entities alert when hit after a quiet period.
 */
export function applyHit(game: Game, attacker: Attacker | null, target: Entity, raw: number, type: DamageType): number {
  if (target.hp <= 0) return 0;
  const dmg = hitDamage(game, target, raw, type);
  return applyDamage(game, attacker, target, dmg);
}

/** Environmental damage bypasses weapon armor and weapon-specific reductions. */
export function applyEnvironmentalDamage(game: Game, target: Entity, damage: number): number {
  return applyDamage(game, null, target, damage * (target.kind === 'building' ? signalDamageFactor(game, target) * nightIncidentDamageFactor(game) : 1));
}

function applyDamage(game: Game, attacker: Attacker | null, target: Entity, dmg: number): number {
  if (target.hp <= 0 || dmg <= 0) return 0;
  const tick = game.state.tick;
  if (target.faction === 'player' && (target.lastDamagedTick < 0 || tick - target.lastDamagedTick >= ALERT_QUIET_TICKS)) {
    emit(game, { type: 'underAttack', entityId: target.id, x: target.x, y: target.y, core: target.id === game.state.coreId });
  }
  target.lastDamagedTick = tick;
  target.hp = Math.max(0, target.hp - dmg);
  if (target.hp <= 0) onKilled(game, attacker, target);
  return dmg;
}
