/**
 * Soldier behavior from Soldier.order: target selection rules, attack-move engages on the way,
 * forced move ignores enemies, focus fire chases, hold never moves, idle soldiers defend in place.
 * Also keeps soldier stats current (modifiers, promotions, hunger) and offers the promotion when a
 * lowered veterancy threshold is already met. Owner: Task 3.
 *
 * This system only decides what to engage (attack.targetId) and how to move; combat (attacks.ts)
 * fires after movement. Per order:
 * - move: no target; becomes idle when the movement ends.
 * - attackMove: engages mutants (and discovered nests) within the acquire radius, standing to fire
 *   or chasing; with nothing to fight it walks on to its own destination (AttackState.post) and
 *   becomes idle there.
 * - attackTarget: only the focus target, chased until it dies; then idle.
 * - hold: never moves; fires at the best target in range.
 * - idle: engages mutants within the acquire radius that are in range or close to its guard spot,
 *   walks back to the spot when the fight ends. Standing still makes the current place the spot.
 *   A mutant that is attacking the base (the core, any building, a survivor) is answered from
 *   farther away: anywhere close to the guard spot, as long as the player can see it. So soldiers
 *   never stand by while the base is hit within their reach. Fights with other soldiers do not
 *   pull them away (those soldiers fight back; chasing every skirmish broke up formations).
 * Acquire radius: min(vision, range + ENGAGEMENT.soldierAcquireExtra), at least the range.
 */
import { ENGAGEMENT, SOLDIERS } from '../data/combat';
import type { Game } from '../game';
import { tileAtPoint } from '../map/grid';
import { FOG_VISIBLE, type Entity, type Point, type Soldier } from '../state';
import { moveUnitTo, stopUnit } from '../world/movement';
import { edgeDistance } from '../world/spatial';
import { checkVeterancy } from './damage';
import { canHit, chooseTarget, liveEntity } from './targeting';
import { gapBetween, soldierStat, soldierWeapon, type WeaponProfile } from './weapons';

/** A kept target is re-evaluated against the alternatives this often (staggered by id). */
const RESCAN_TICKS = 10;
/** A chase is re-pathed at most this often while the target keeps moving. */
const CHASE_REPATH_TICKS = 10;
/** A chase path is kept while its goal is this close to the target. */
const CHASE_GOAL_SLACK = 1;
/** An attack-move ends when the soldier stands this close to its destination. */
const DESTINATION_SLACK = 1.5;
/** An idle soldier farther than this from its guard spot after a fight walks back. */
const GUARD_SLACK = 0.4;
/** A kept target may drift this much beyond the acquire radius before it is dropped. */
const KEEP_SLACK = 1;

/** Max hp, speed and vision from the type's tech modifiers, the promotion and hunger. */
export function refreshSoldierStats(game: Game, s: Soldier): void {
  const dx = s.x - (s.deploymentGoal?.x ?? s.x); const dy = s.y - (s.deploymentGoal?.y ?? s.y);
  if (s.deploymentGoal && (s.order.type !== 'attackMove' || dx * dx + dy * dy <= DESTINATION_SLACK * DESTINATION_SLACK)) s.deploymentGoal = null;
  const def = SOLDIERS[s.type];
  const maxHp = def.hp * Math.max(0.1, 1 + soldierStat(game, s, 'hpPct'));
  if (maxHp !== s.maxHp) {
    // All max-HP changes preserve health fraction, including promotions and remote bonuses.
    // Repeatedly crossing an outpost boundary cannot restore lost health.
    s.hp = s.hp * maxHp / s.maxHp;
    s.maxHp = maxHp;
  }
  s.motion.speed = def.speed * Math.max(0.1, 1 + soldierStat(game, s, 'speedPct'));
  s.vision = def.vision + soldierStat(game, s, 'visionAdd');
}

export function acquireRadius(s: Soldier, w: WeaponProfile): number {
  return Math.max(w.range, Math.min(s.vision, w.range + ENGAGEMENT.soldierAcquireExtra));
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function rescanDue(game: Game, s: Soldier): boolean {
  return (game.state.tick + s.id) % RESCAN_TICKS === 0;
}

function becomeIdle(s: Soldier): void {
  s.order = { type: 'idle' };
  s.attack.targetId = 0;
  s.attack.post = { kind: 'guard', x: s.x, y: s.y };
}

/** Walks toward a target; keeps the current path while it still leads there. */
function chase(game: Game, s: Soldier, t: Entity, sameTarget: boolean): void {
  const m = s.motion;
  if (m.mode === 'path' && m.goal) {
    if (edgeDistance(t, m.goal.x, m.goal.y) <= CHASE_GOAL_SLACK) return;
    if (sameTarget && (game.state.tick + s.id) % CHASE_REPATH_TICKS !== 0) return;
  }
  moveUnitTo(game, s, t.x, t.y);
}

/** Engages `t`: stands to fire when in range, otherwise closes in. */
function fightOrChase(game: Game, s: Soldier, w: WeaponProfile, t: Entity): void {
  const sameTarget = s.attack.targetId === t.id;
  s.attack.targetId = t.id;
  if (gapBetween(s, t) <= w.range) {
    if (s.motion.mode !== 'stand') stopUnit(s);
    return;
  }
  chase(game, s, t, sameTarget);
}

/** Walks to `post`; an unreachable post is replaced by the closest reachable point. */
function walkTo(game: Game, s: Soldier, post: Point): void {
  moveUnitTo(game, s, post.x, post.y);
  const goal = s.motion.goal;
  if (goal && distance(goal, post) > 0.01) {
    post.x = goal.x;
    post.y = goal.y;
  }
}

function walkingTo(s: Soldier, p: Point): boolean {
  const g = s.motion.goal;
  return s.motion.mode === 'path' && g !== null && distance(g, p) <= 0.01;
}

/**
 * The target to engage: the kept one while it stays valid (re-evaluated every RESCAN_TICKS),
 * else the best acceptable one within `radius`.
 */
function engagement(game: Game, s: Soldier, w: WeaponProfile, radius: number, accept: (e: Entity) => boolean): Entity | null {
  const kept = liveEntity(game, s.attack.targetId);
  const keep = kept !== null && accept(kept) && gapBetween(s, kept) <= radius + KEEP_SLACK && gapBetween(s, kept) >= w.minRange;
  if (keep && !rescanDue(game, s)) return kept;
  return chooseTarget(game, s, w, radius, accept) ?? (keep ? kept : null);
}

function holdPosition(game: Game, s: Soldier, w: WeaponProfile): void {
  s.attack.post = null;
  if (s.motion.mode !== 'stand') stopUnit(s);
  const t = engagement(game, s, w, w.range, (e) => e.kind === 'mutant');
  s.attack.targetId = t && canHit(w, gapBetween(s, t)) ? t.id : 0;
}

function focus(game: Game, s: Soldier, w: WeaponProfile, targetId: number): void {
  s.attack.post = null;
  const t = liveEntity(game, targetId);
  if (!t || t.faction === s.faction) {
    if (s.motion.mode !== 'stand') stopUnit(s);
    becomeIdle(s);
    return;
  }
  const sameTarget = s.attack.targetId === t.id;
  s.attack.targetId = t.id;
  const gap = gapBetween(s, t);
  if (gap <= w.range) {
    if (s.motion.mode !== 'stand') stopUnit(s);
  } else chase(game, s, t, sameTarget);
}

function attackMove(game: Game, s: Soldier, w: WeaponProfile, orderX: number, orderY: number): void {
  let post = s.attack.post;
  if (!post || post.kind !== 'destination' || post.orderX !== orderX || post.orderY !== orderY) {
    // A new attack-move: its own destination is the goal the command just gave the soldier.
    const g = s.motion.mode === 'path' && s.motion.goal ? s.motion.goal : { x: orderX, y: orderY };
    post = s.attack.post = { kind: 'destination', x: g.x, y: g.y, orderX, orderY };
    s.attack.targetId = 0;
  }
  const t = engagement(game, s, w, acquireRadius(s, w), (e) => e.kind === 'mutant' || (e.kind === 'nest' && e.discovered));
  if (t) {
    fightOrChase(game, s, w, t);
    return;
  }
  s.attack.targetId = 0;
  if (walkingTo(s, post)) return;
  if (s.motion.mode === 'stand' && distance(s, post) <= DESTINATION_SLACK) becomeIdle(s);
  else walkTo(game, s, post);
}

/** The mutant is hitting the base right now: a building (the core included) or a survivor. */
function attacksBase(game: Game, e: Entity): boolean {
  if (e.kind !== 'mutant') return false;
  const victim = liveEntity(game, e.attack.targetId);
  return victim !== null && (victim.kind === 'building' || victim.kind === 'survivor');
}

/**
 * For an idle soldier with nothing in its acquire radius: a visible mutant attacking the base
 * that passes `nearSpot`. The current target is kept while it still qualifies; a new one is looked
 * for every RESCAN_TICKS (staggered) within `reach` of the soldier.
 */
function attackerToAnswer(game: Game, s: Soldier, w: WeaponProfile, nearSpot: (e: Entity) => boolean, reach: number): Entity | null {
  const { fog, map } = game.state;
  const visible = (e: Entity) => fog[tileAtPoint(map, e.x, e.y)] === FOG_VISIBLE;
  const answers = (e: Entity) => attacksBase(game, e) && nearSpot(e) && visible(e);
  const kept = liveEntity(game, s.attack.targetId);
  if (kept && answers(kept)) return kept;
  return rescanDue(game, s) ? chooseTarget(game, s, w, reach, answers) : null;
}

function guard(game: Game, s: Soldier, w: WeaponProfile): void {
  let post = s.attack.post;
  if (!post || post.kind !== 'guard') {
    // Newly idle: guard where the soldier is headed (e.g. a rally point) or where it stands.
    const g = s.motion.mode === 'path' && s.motion.goal ? s.motion.goal : s;
    post = s.attack.post = { kind: 'guard', x: g.x, y: g.y };
  }
  const spot = post;
  const leash = ENGAGEMENT.idleLeash + w.range;
  const nearSpot = (e: Entity) => gapBetween(s, e) <= w.range || edgeDistance(e, spot.x, spot.y) - s.radius <= leash;
  const accept = (e: Entity) => e.kind === 'mutant' && nearSpot(e);
  const fought = s.attack.targetId !== 0;
  const t = engagement(game, s, w, acquireRadius(s, w), accept) ?? attackerToAnswer(game, s, w, nearSpot, leash + distance(s, spot));
  if (t) {
    fightOrChase(game, s, w, t);
    return;
  }
  s.attack.targetId = 0;
  if (fought) {
    // The fight just ended (target dead or out of reach): back to the spot.
    if (distance(s, spot) > GUARD_SLACK) walkTo(game, s, spot);
    else if (s.motion.mode !== 'stand') stopUnit(s);
    return;
  }
  if (s.motion.mode === 'path') {
    // Walking back, or sent somewhere without an order (e.g. a rally point): guard the goal.
    if (s.motion.goal && !walkingTo(s, spot)) {
      spot.x = s.motion.goal.x;
      spot.y = s.motion.goal.y;
    }
    return;
  }
  // Standing with nothing to fight: wherever it stands (stopped, pushed) is the spot now.
  spot.x = s.x;
  spot.y = s.y;
}

function decide(game: Game, s: Soldier): void {
  const order = s.order;
  switch (order.type) {
    case 'move':
      s.attack.targetId = 0;
      s.attack.post = null;
      if (s.motion.mode === 'stand') becomeIdle(s);
      return;
    case 'hold':
      return holdPosition(game, s, soldierWeapon(game, s));
    case 'attackTarget':
      return focus(game, s, soldierWeapon(game, s), order.targetId);
    case 'attackMove':
      return attackMove(game, s, soldierWeapon(game, s), order.x, order.y);
    case 'idle':
      return guard(game, s, soldierWeapon(game, s));
  }
}

export function soldierSystem(game: Game): void {
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'soldier' || e.hp <= 0) continue;
    refreshSoldierStats(game, e);
    checkVeterancy(game, e);
    decide(game, e);
  }
}
