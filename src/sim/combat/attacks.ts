/**
 * Attack resolution for soldiers, towers and mutants: cooldowns, range and minimum range,
 * DAMAGE_MULTIPLIER, splash and cones, tower fuel, building damage modifiers at night, kills and
 * stats, veterancy and promotions, nest/hive destruction rewards, underAttack alerts, shot and
 * explosion events. Entities reaching hp <= 0 are removed by world/cleanup.ts at the end of the tick.
 * Owner: Task 3.
 *
 * Attacks hit instantly (no projectiles in the state): `shot` events carry both ends so the client
 * draws tracers, `explosion` events mark area damage. The soldier and mutant systems choose what
 * to engage before movement; this system fires at that target once it is in range and the weapon
 * is ready. Soldiers that are not focusing a target also take any other enemy that is in range.
 */
import { OK, reject, type CommandHandler } from '../commands';
import { SOLDIERS } from '../data/combat';
import { emit } from '../events';
import type { Game } from '../game';
import type { Building, Entity, Mutant, Soldier } from '../state';
import { forEachInRadius } from '../world/spatial';
import { applyHit, type Attacker } from './damage';
import { refreshSoldierStats } from './soldiers';
import { aimPoint, canHit, chooseTarget, liveEntity } from './targeting';
import { gapBetween, mutantWeapon, soldierWeapon, towerWeapon, type WeaponProfile } from './weapons';

/** The engaged target if it is alive, hostile and hittable now. */
function engagedTarget(game: Game, a: Attacker, w: WeaponProfile): Entity | null {
  const t = liveEntity(game, a.attack.targetId);
  return t && t.faction !== a.faction && canHit(w, gapBetween(a, t)) ? t : null;
}

const anyMutant = (e: Entity) => e.kind === 'mutant';

function hitArea(game: Game, a: Attacker, w: WeaponProfile, x: number, y: number): void {
  const victims: Entity[] = [];
  forEachInRadius(game.spatial, x, y, w.splashRadius, (e) => {
    if (e.faction !== a.faction && e.hp > 0) victims.push(e);
  });
  for (const v of victims) applyHit(game, a, v, w.damage, w.damageType);
  emit(game, { type: 'explosion', x, y, radius: w.splashRadius, damageType: w.damageType });
}

function hitCone(game: Game, a: Attacker, w: WeaponProfile, target: Entity): void {
  const aim = aimPoint(a, target);
  const vx = aim.x - a.x;
  const vy = aim.y - a.y;
  const vl = Math.sqrt(vx * vx + vy * vy);
  const victims: Entity[] = [target];
  forEachInRadius(game.spatial, a.x, a.y, w.range + a.radius, (e) => {
    if (e === target || e.faction === a.faction || e.hp <= 0 || gapBetween(a, e) > w.range) return;
    const p = aimPoint(a, e);
    const ux = p.x - a.x;
    const uy = p.y - a.y;
    const ul = Math.sqrt(ux * ux + uy * uy);
    if (ul < 1e-6 || vl < 1e-6 || (vx * ux + vy * uy) / (vl * ul) >= w.coneCos) victims.push(e);
  });
  for (const v of victims) applyHit(game, a, v, w.damage, w.damageType);
}

function fire(game: Game, a: Attacker, w: WeaponProfile, target: Entity): void {
  a.attack.targetId = target.id;
  a.attack.cooldown = w.cooldownTicks;
  if (w.selfDestruct) {
    a.hp = 0;
    hitArea(game, a, w, a.x, a.y);
    return;
  }
  const aim = aimPoint(a, target);
  emit(game, { type: 'shot', sourceId: a.id, targetId: target.id, fromX: a.x, fromY: a.y, toX: aim.x, toY: aim.y, damageType: w.damageType });
  if (w.coneCos > 0) hitCone(game, a, w, target);
  else if (w.splashRadius > 0) hitArea(game, a, w, aim.x, aim.y);
  else applyHit(game, a, target, w.damage, w.damageType);
}

/** Counts the cooldown down; true when the weapon is ready this tick. */
function ready(a: Attacker): boolean {
  if (a.attack.cooldown > 0) a.attack.cooldown--;
  return a.attack.cooldown === 0;
}

function soldierAttack(game: Game, s: Soldier): void {
  if (!ready(s) || s.order.type === 'move') return;
  const w = soldierWeapon(game, s);
  const target = engagedTarget(game, s, w) ?? (s.order.type === 'attackTarget' ? null : chooseTarget(game, s, w, w.range, anyMutant));
  if (target) fire(game, s, w, target);
}

function mutantAttack(game: Game, m: Mutant): void {
  if (!ready(m) || m.ai.mode === 'retreat') return;
  const w = mutantWeapon(m);
  const target = engagedTarget(game, m, w);
  if (target) fire(game, m, w, target);
}

function towerAttack(game: Game, b: Building): void {
  const w = towerWeapon(game, b);
  if (!w || !ready(b)) return;
  const target = engagedTarget(game, b, w) ?? chooseTarget(game, b, w, w.range, anyMutant);
  if (!target) return;
  if (w.fuelPerShot > 0 && game.state.clock.phase === 'night') {
    const resources = game.state.economy.resources;
    if (resources.fuel < w.fuelPerShot) return;
    resources.fuel -= w.fuelPerShot;
  }
  fire(game, b, w, target);
}

export function combatSystem(game: Game): void {
  for (const e of game.state.entities.values()) {
    if (e.hp <= 0) continue;
    if (e.kind === 'soldier') soldierAttack(game, e);
    else if (e.kind === 'mutant') mutantAttack(game, e);
    else if (e.kind === 'building') towerAttack(game, e);
  }
}

export const choosePromotionHandler: CommandHandler<'choosePromotion'> = {
  validate(game, cmd) {
    const s = game.state.entities.get(cmd.unitId);
    if (!s || s.kind !== 'soldier' || s.hp <= 0) return reject('noValidUnits');
    if (!s.veterancy.pending) return reject('noPromotionPending');
    if (!SOLDIERS[s.type].promotions.includes(cmd.promotion)) return reject('invalidPromotion');
    return OK;
  },
  execute(game, cmd) {
    const s = game.state.entities.get(cmd.unitId) as Soldier;
    s.veterancy.promotion = cmd.promotion;
    s.veterancy.pending = false;
    game.state.stats.promotions++;
    refreshSoldierStats(game, s);
  },
};
