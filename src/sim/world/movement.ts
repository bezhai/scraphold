/**
 * Unit movement: path following (A*), flow-field following (mutants), separation between all
 * units, and sliding collision against blocked tiles. Owner: Task 1.
 *
 * Other systems only set intent through moveUnitTo / followFlowField / stopUnit (or by editing
 * Motion directly); this system is the only place that changes unit positions each tick
 * (factories and enter/exitBuilding place units explicitly).
 */
import type { Game } from '../game';
import { tileAtPoint, tileCenter } from '../map/grid';
import { assaultFlow, ensureNav, type NavGrid } from '../nav/navGrid';
import { findPath, smoothPath } from '../nav/pathfind';
import type { Motion, Soldier, Unit } from '../state';
import { TICKS_PER_SECOND } from '../time';
import { forEachInRadius, isOnMap } from './spatial';

/** A unit stops when this close to its final goal (tiles). */
export const ARRIVE_DISTANCE = 0.08;
const WAYPOINT_REACHED = 0.3;
/** Collision body used against blocked tiles (capped so big units still fit through 1-tile gaps). */
const MAX_COLLISION_RADIUS = 0.34;
/** Largest unit radius (behemoth); separation queries widen by it. */
const MAX_UNIT_RADIUS = 0.8;
/** Max separation displacement per tick. */
const MAX_PUSH = 0.12;
/** Stuck handling: stop when stuck close to the goal, repath periodically, give up eventually. */
const STUCK_NEAR_GOAL_TICKS = 20;
const STUCK_REPATH_TICKS = 60;
const STUCK_GIVE_UP_TICKS = 200;
/** Mass multiplier for soldiers on hold so they keep their position. */
const HOLD_MASS = 10;

/** Sends a unit along an A* path to (x, y); if unreachable, to the closest reachable tile. */
export function moveUnitTo(game: Game, unit: Unit, x: number, y: number): void {
  const nav = ensureNav(game);
  const gx = Math.min(nav.width - 0.01, Math.max(0.01, x));
  const gy = Math.min(nav.height - 0.01, Math.max(0.01, y));
  const result = findPath(nav, unit.x, unit.y, gx, gy);
  const m = unit.motion;
  let goal = { x: gx, y: gy };
  let tiles = result.tiles;
  if (!result.reached) {
    const last = tiles[tiles.length - 1];
    goal = last === undefined ? { x: unit.x, y: unit.y } : tileCenter(nav, last);
  }
  // The final tile is replaced by the exact goal point.
  if (tiles.length > 0) tiles = tiles.slice(0, -1);
  m.mode = 'path';
  m.goal = goal;
  m.path = smoothPath(nav, unit.x, unit.y, tiles, Math.min(unit.radius, MAX_COLLISION_RADIUS));
  m.pathNavVersion = nav.version;
  m.blockedBy = 0;
  m.stuckTicks = 0;
}

/** Mutants: walk the shared flow field toward the core. */
export function followFlowField(unit: Unit): void {
  const m = unit.motion;
  m.mode = 'flow';
  m.goal = null;
  m.path = [];
  m.stuckTicks = 0;
}

export function stopUnit(unit: Unit): void {
  const m = unit.motion;
  m.mode = 'stand';
  m.goal = null;
  m.path = [];
  m.vx = 0;
  m.vy = 0;
  m.blockedBy = 0;
  m.stuckTicks = 0;
}

function isUnit(e: { kind: string }): e is Unit {
  return e.kind === 'survivor' || e.kind === 'soldier' || e.kind === 'mutant';
}

function effectiveMass(u: Unit): number {
  return u.kind === 'soldier' && (u as Soldier).order.type === 'hold' ? u.motion.mass * HOLD_MASS : u.motion.mass;
}

function cornerBlocked(nav: NavGrid, x: number, y: number): boolean {
  const t = tileAtPoint(nav, x, y);
  return t === -1 || nav.blocked[t] !== 0;
}

/** Any corner of the r-box around (x, y) is off the map or on a blocked tile. */
function blockedAt(nav: NavGrid, x: number, y: number, r: number): boolean {
  return cornerBlocked(nav, x - r, y - r) || cornerBlocked(nav, x + r, y - r) || cornerBlocked(nav, x - r, y + r) || cornerBlocked(nav, x + r, y + r);
}

function desiredVelocity(game: Game, nav: NavGrid, u: Unit): void {
  const m: Motion = u.motion;
  const step = m.speed / TICKS_PER_SECOND;
  m.vx = 0;
  m.vy = 0;
  m.blockedBy = 0;
  if (m.mode === 'path') {
    if (m.goal && m.pathNavVersion !== nav.version) moveUnitTo(game, u, m.goal.x, m.goal.y);
    while (m.path.length > 0) {
      const w = tileCenter(nav, m.path[0] as number);
      if (Math.abs(w.x - u.x) + Math.abs(w.y - u.y) > WAYPOINT_REACHED) break;
      m.path.shift();
    }
    const next = m.path.length > 0 ? m.path[0] : undefined;
    const target = next !== undefined ? tileCenter(nav, next) : m.goal;
    if (!target) {
      m.mode = 'stand';
      return;
    }
    if (next !== undefined && nav.blocked[next]) m.blockedBy = nav.structureAt[next] as number;
    const dx = target.x - u.x;
    const dy = target.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (next === undefined && d <= ARRIVE_DISTANCE) {
      stopUnit(u);
      return;
    }
    const s = Math.min(step, d) / (d || 1);
    m.vx = dx * s;
    m.vy = dy * s;
    return;
  }
  if (m.mode === 'flow') {
    const t = tileAtPoint(nav, u.x, u.y);
    if (t === -1) return;
    const field = u.kind === 'mutant' && u.ai.assaultTargetId !== 0 ? assaultFlow(game, u.ai.assaultTargetId) : nav.flowNext;
    const next = field[t] as number;
    if (next === -1) return;
    if (nav.blocked[next]) m.blockedBy = nav.structureAt[next] as number;
    const c = tileCenter(nav, next);
    const dx = c.x - u.x;
    const dy = c.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    m.vx = (dx / d) * step;
    m.vy = (dy / d) * step;
  }
}

export function movementSystem(game: Game): void {
  const nav = ensureNav(game);
  const units: Unit[] = [];
  for (const e of game.state.entities.values()) if (isUnit(e) && isOnMap(e)) units.push(e);
  const slot = new Map<number, number>();
  units.forEach((u, i) => slot.set(u.id, i));

  for (const u of units) desiredVelocity(game, nav, u);

  // Separation: each overlapping pair once (lower id first), split by mass.
  const pushX = new Float64Array(units.length);
  const pushY = new Float64Array(units.length);
  units.forEach((a, i) => {
    forEachInRadius(game.spatial, a.x, a.y, a.radius + MAX_UNIT_RADIUS, (e) => {
      if (!isUnit(e) || e.id <= a.id) return;
      const j = slot.get(e.id);
      if (j === undefined) return;
      let dx = e.x - a.x;
      let dy = e.y - a.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      const overlap = a.radius + e.radius - d;
      if (overlap <= 0) return;
      if (d < 1e-6) {
        // Deterministic split direction for coincident units.
        dx = (a.id + e.id) % 2 === 0 ? 1 : 0;
        dy = 1 - dx;
        d = 1;
      }
      const ma = effectiveMass(a);
      const mb = effectiveMass(e);
      const nx = dx / d;
      const ny = dy / d;
      const shareA = mb / (ma + mb);
      const shareB = ma / (ma + mb);
      pushX[i]! -= nx * overlap * shareA;
      pushY[i]! -= ny * overlap * shareA;
      pushX[j]! += nx * overlap * shareB;
      pushY[j]! += ny * overlap * shareB;
    }, MAX_UNIT_RADIUS);
  });

  units.forEach((u, i) => {
    const m = u.motion;
    let px = pushX[i] as number;
    let py = pushY[i] as number;
    const pl = Math.sqrt(px * px + py * py);
    if (pl > MAX_PUSH) {
      px *= MAX_PUSH / pl;
      py *= MAX_PUSH / pl;
    }
    const r = Math.min(u.radius, MAX_COLLISION_RADIUS);
    const free = blockedAt(nav, u.x, u.y, r); // already overlapping a blocked tile: let it escape
    const ox = u.x;
    const oy = u.y;
    const nx = u.x + m.vx + px;
    const ny = u.y + m.vy + py;
    if (free || !blockedAt(nav, nx, u.y, r)) u.x = nx;
    if (free || !blockedAt(nav, u.x, ny, r)) u.y = ny;
    u.x = Math.min(nav.width - r, Math.max(r, u.x));
    u.y = Math.min(nav.height - r, Math.max(r, u.y));

    if (m.mode === 'path' && m.goal) {
      const step = m.speed / TICKS_PER_SECOND;
      const moved = Math.abs(u.x - ox) + Math.abs(u.y - oy);
      m.stuckTicks = moved < step * 0.2 ? m.stuckTicks + 1 : 0;
      const gd = Math.abs(m.goal.x - u.x) + Math.abs(m.goal.y - u.y);
      if (m.stuckTicks > STUCK_NEAR_GOAL_TICKS && m.path.length === 0 && gd < 1.5) stopUnit(u);
      else if (m.stuckTicks > STUCK_GIVE_UP_TICKS) stopUnit(u);
      else if (m.stuckTicks > 0 && m.stuckTicks % STUCK_REPATH_TICKS === 0) {
        const stuck = m.stuckTicks;
        moveUnitTo(game, u, m.goal.x, m.goal.y);
        m.stuckTicks = stuck;
      }
    }
  });
}
