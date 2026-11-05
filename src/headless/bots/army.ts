/**
 * Commanding soldiers for a bot (Task 5): roles (garrison, raid, scout), exploring with scouts,
 * daytime nest raids, and defending the core.
 *
 * Defense: the garrison waits at a rally point toward the forecast directions and attack-moves at
 * the visible mutant nearest to the core whenever one is inside the strategy's engage radius.
 * Raids: by day a strike force (everything above the home guard) attack-moves to a discovered
 * ordinary nest when it can defeat the guards and return before night. A hive siege evaluates
 * guard survivability and structure firepower separately, keeps a larger home garrison, and persists across nights.
 */
import { nightType, type Game, type Mutant, type Nest, type Point, type Soldier } from '../../sim';
import { HIVE, NEST, SOLDIERS, type SoldierType } from '../../sim/data/combat';
import { TICKS_PER_SECOND, DAY_SECONDS, NIGHT_SECONDS } from '../../sim/time';
import { rallyPoint } from './intel';
import type { Context, Strategy } from './strategy';
import { distance, isExploredTile } from './view';

/** Rough fighting value per soldier, in "threat points it can handle". */
export const POWER: Record<SoldierType, number> = {
  shieldGuard: 1.2,
  rifleman: 1,
  sniper: 1.1,
  grenadier: 1.3,
  scout: 0.5,
  flamethrower: 1.4,
  pickup: 2,
};

export function powerOf(soldiers: readonly Soldier[]): number {
  let p = 0;
  for (const s of soldiers) p += POWER[s.type] * (s.hp / s.maxHp);
  return p;
}

/** A nest's day guards in the same units as POWER (normal nests keep mostly wanderers). */
export function guardStrength(n: Nest): number {
  const def = n.isHive ? HIVE : NEST;
  const guards = def.guardsBase + def.guardsPerLevel * n.growth.level;
  return guards * (n.isHive ? 1.6 : 0.6);
}

/** Rough structure damage per second per POWER point (most weapons do 0.5-0.7x to structures). */
const STRUCTURE_DPS_PER_POWER = 9;

function hiveGuardPower(nest: Nest): number {
  return guardStrength(nest) * 0.4;
}

function hiveDurabilityPower(nest: Nest): number {
  return nest.hp / (STRUCTURE_DPS_PER_POWER * 2.5 * (DAY_SECONDS + NIGHT_SECONDS));
}

/** Visible guards and remaining HP; budget the hive assault for two and a half day/night cycles. */
export function hiveAssaultPower(nest: Nest): number {
  return Math.max(hiveGuardPower(nest), hiveDurabilityPower(nest));
}

export interface RaidPower { combat: number; structure: number }

/** Wounds reduce survivability, but do not reduce a living soldier's weapon output. */
export function raidPowerOf(soldiers: readonly Soldier[]): RaidPower {
  return { combat: powerOf(soldiers), structure: soldiers.reduce((sum, soldier) => sum + POWER[soldier.type], 0) };
}

/** A raid may get home this long after nightfall: night groups need longer to reach the core. */
const RAID_HOME_GRACE_SECONDS = 10;

const RE_ORDER_TICKS = 20;
const SCOUT_WAYPOINT_STEP = 6;
const SCOUT_NEST_BERTH = 10;

function centroid(units: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / units.length, y: y / units.length };
}

/** Seconds until the night starts (0 at night). */
function secondsToNight(game: Game): number {
  const { phase, phaseTick, phaseTicks } = game.state.clock;
  const type = nightType(game.state);
  const quiet = type === 'calm' || type === 'rustStorm';
  if (phase === 'night') return quiet ? (phaseTicks - phaseTick) / TICKS_PER_SECOND : 0;
  const duskTicks = phase === 'day' ? 15 * TICKS_PER_SECOND : 0;
  return (phaseTicks - phaseTick + duskTicks) / TICKS_PER_SECOND + (quiet ? NIGHT_SECONDS : 0);
}

function slowest(units: readonly Soldier[]): number {
  let v = Infinity;
  for (const u of units) v = Math.min(v, u.motion.speed);
  return v === Infinity ? 1 : v;
}

function byRole(ctx: Context, role: 'garrison' | 'raid' | 'scout'): Soldier[] {
  return ctx.snap.soldiers.filter((s) => ctx.memory.roles.get(s.id) === role);
}

/** New soldiers join the garrison, scouts explore until the strategy has enough of them. */
export function assignRoles(ctx: Context, strategy: Strategy): void {
  const { roles } = ctx.memory;
  const alive = new Set(ctx.snap.soldiers.map((s) => s.id));
  for (const id of [...roles.keys()]) if (!alive.has(id)) roles.delete(id);
  let scouts = ctx.snap.soldiers.filter((s) => roles.get(s.id) === 'scout').length;
  const hiveRaid = ctx.snap.discoveredNests.some(nest => nest.isHive && nest.id === ctx.memory.raid?.targetId);
  const homeGuard = hiveRaid ? strategy.raids!.hive!.homeGuard : 0;
  let garrison = ctx.snap.soldiers.filter(soldier => roles.get(soldier.id) === 'garrison').length;
  for (const s of ctx.snap.soldiers) {
    if (roles.has(s.id)) continue;
    if (s.type === 'scout' && scouts < strategy.scouts) {
      roles.set(s.id, 'scout');
      scouts++;
    } else {
      const stayHome = !ctx.memory.raid || garrison < homeGuard;
      roles.set(s.id, stayHome ? 'garrison' : 'raid');
      if (stayHome) garrison++;
    }
  }
}

export function choosePromotions(ctx: Context, strategy: Strategy): void {
  for (const s of ctx.snap.soldiers) {
    if (!s.veterancy.pending) continue;
    const p = strategy.promotion(s.type) ?? SOLDIERS[s.type].promotions[0];
    ctx.turn.issue({ type: 'choosePromotion', unitId: s.id, promotion: p });
  }
}

/** The unexplored waypoint nearest to `from`, keeping clear of discovered nests. */
function nextWaypoint(ctx: Context, from: Point, taken: readonly Point[]): Point | null {
  const { map } = ctx.game.state;
  let best: Point | null = null;
  let bestD = Infinity;
  for (let y = 2; y < map.height; y += SCOUT_WAYPOINT_STEP) {
    for (let x = 2; x < map.width; x += SCOUT_WAYPOINT_STEP) {
      if (isExploredTile(ctx.game, y * map.width + x)) continue;
      const p = { x: x + 0.5, y: y + 0.5 };
      if (ctx.snap.discoveredNests.some((n) => distance(n, p) < SCOUT_NEST_BERTH)) continue;
      if (taken.some((t) => distance(t, p) < SCOUT_WAYPOINT_STEP * 2)) continue;
      const d = distance(from, p);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  return best;
}

/** Scouts explore by day (forced moves, they avoid fights) and come home for the night. */
export function scout(ctx: Context): void {
  const { memory, turn, game } = ctx;
  const scouts = byRole(ctx, 'scout');
  const night = secondsToNight(game) < 8;
  const goals: Point[] = [];
  for (const s of scouts) {
    if (night) {
      memory.scoutGoals.delete(s.id);
      if (distance(s, ctx.core) > 6 && s.motion.mode !== 'path') turn.issue({ type: 'move', unitIds: [s.id], x: ctx.core.x, y: ctx.core.y + 3 });
      continue;
    }
    let goal = memory.scoutGoals.get(s.id);
    const reached = goal && (distance(s, goal) < 2 || isExploredTile(game, Math.floor(goal.y) * game.state.map.width + Math.floor(goal.x)));
    if (!goal || reached || s.motion.mode === 'stand') {
      const next = nextWaypoint(ctx, s, goals);
      if (!next) {
        memory.roles.set(s.id, 'garrison');
        memory.scoutGoals.delete(s.id);
        continue;
      }
      goal = next;
      memory.scoutGoals.set(s.id, goal);
      turn.issue({ type: 'move', unitIds: [s.id], x: goal.x, y: goal.y });
    }
    goals.push(goal);
  }
}

function endRaid(ctx: Context): void {
  const raiders = byRole(ctx, 'raid');
  for (const s of raiders) ctx.memory.roles.set(s.id, 'garrison');
  ctx.memory.raid = null;
  if (raiders.length > 0) ctx.turn.issue({ type: 'move', unitIds: raiders.map((s) => s.id), x: ctx.core.x, y: ctx.core.y + 3 });
}

function canOvercome(nest: Nest, plan: NonNullable<Strategy['raids']>, power: RaidPower): boolean {
  if (!nest.isHive) return power.combat >= plan.powerRatio * guardStrength(nest);
  return plan.hive !== null
    && power.combat >= Math.max(plan.hive.minPower, plan.powerRatio * hiveGuardPower(nest))
    && power.structure >= plan.powerRatio * hiveDurabilityPower(nest);
}

export function raidTargets(ctx: Context, plan: NonNullable<Strategy['raids']>, power: RaidPower): Nest[] {
  return ctx.snap.discoveredNests
    .filter((n) => {
      if (!n.isHive) return canOvercome(n, plan, power);
      return plan.hive !== null && ctx.day >= plan.hive.fromDay && canOvercome(n, plan, power);
    })
    .sort((a, b) => Number(b.isHive) - Number(a.isHive) || a.hp - b.hp || distance(a, ctx.core) - distance(b, ctx.core));
}

/** Starts, steers and ends daytime raids on discovered nests. */
export function raid(ctx: Context, strategy: Strategy): void {
  const plan = strategy.raids;
  const { memory, game, turn } = ctx;
  if (!plan) return;
  const left = secondsToNight(game);
  if (memory.raid) {
    const raiders = byRole(ctx, 'raid');
    const target = game.state.entities.get(memory.raid.targetId);
    const alive = target && target.kind === 'nest' && target.hp > 0;
    const home = raiders.length > 0 ? distance(centroid(raiders), ctx.core) / slowest(raiders) : 0;
    const ordinaryRetreat = alive && !target.isHive && (left + RAID_HOME_GRACE_SECONDS < home + 4 || powerOf(raiders) < memory.raid.startPower * 0.45);
    // A hive siege has a separate home garrison; going home does not heal its wounded soldiers.
    if (!alive || raiders.length === 0 || ordinaryRetreat) {
      endRaid(ctx);
      return;
    }
    const idle = raiders.filter((s) => s.order.type === 'idle' || (s.order.type === 'attackMove' && s.motion.mode === 'stand' && s.attack.targetId === 0));
    if (idle.length > 0) turn.issue({ type: 'attackMove', unitIds: idle.map((s) => s.id), x: target.x, y: target.y });
    return;
  }
  const type = nightType(game.state);
  if ((ctx.phase !== 'day' && type !== 'calm' && type !== 'rustStorm') || ctx.day < plan.fromDay) return;
  // The fastest go; the slowest (shield guards, snipers) make the home guard.
  const garrison = byRole(ctx, 'garrison').sort((a, b) => b.motion.speed - a.motion.speed || a.id - b.id);
  const available = garrison.slice(0, Math.max(0, garrison.length - plan.homeGuard));
  for (const n of raidTargets(ctx, plan, raidPowerOf(available))) {
    const strike = n.isHive ? garrison.slice(0, Math.max(0, garrison.length - plan.hive!.homeGuard)) : available;
    const power = raidPowerOf(strike);
    if (strike.length === 0 || !canOvercome(n, plan, power)) continue;
    const from = centroid(strike);
    const eta = distance(from, n) / slowest(strike);
    const killTime = n.hp / (power.combat * STRUCTURE_DPS_PER_POWER);
    if (!n.isHive && left + RAID_HOME_GRACE_SECONDS < eta * 2 + killTime + 6) continue;
    memory.raid = { targetId: n.id, startPower: power.combat };
    for (const s of strike) memory.roles.set(s.id, 'raid');
    turn.issue({ type: 'attackMove', unitIds: strike.map((s) => s.id), x: n.x, y: n.y });
    return;
  }
}

function threatNearCore(ctx: Context, radius: number): Mutant | null {
  let best: Mutant | null = null;
  let bestD = Infinity;
  for (const m of ctx.snap.visibleMutants) {
    const d = distance(m, ctx.core);
    if (d <= radius && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

/** Garrison: fight what comes near the core, otherwise wait at the rally point. */
export function defend(ctx: Context, strategy: Strategy): void {
  const { memory, turn, game } = ctx;
  const garrison = byRole(ctx, 'garrison');
  if (garrison.length === 0) return;
  const tick = game.state.tick;
  const last = memory.garrisonOrder;
  const send = (p: Point) => {
    if (last && distance(last, p) < 2.5 && tick - last.tick < RE_ORDER_TICKS * 6) return;
    if (last && tick - last.tick < RE_ORDER_TICKS) return;
    memory.garrisonOrder = { x: p.x, y: p.y, tick };
    turn.issue({ type: 'attackMove', unitIds: garrison.map((s) => s.id), x: p.x, y: p.y });
  };
  const threat = threatNearCore(ctx, strategy.defense.engageRadius);
  if (threat) {
    send(threat);
    return;
  }
  if (ctx.phase !== 'day' || !memory.rally) memory.rally = rallyPoint(game, ctx.est, strategy.defense.rallyDistance);
  const rally = memory.rally;
  const c = centroid(garrison);
  if (distance(c, rally) > 3 || (last && distance(last, rally) > 2.5)) send(rally);
}
