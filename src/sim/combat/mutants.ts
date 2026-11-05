import { INCIDENT_RULES } from '../data/incidents';
/**
 * Mutant behavior per MutantDef.behavior: assault along the flow field (world/movement.ts
 * followFlowField) and attack Motion.blockedBy when walled in, aggro on nearby player entities,
 * boomers path to buildings, spitters keep range, boss smashes buildings, guards stay home,
 * retreat at dawn. Owner: Task 3.
 *
 * Like soldiers.ts this only sets attack.targetId and the movement intent; attacks.ts fires.
 * assault, by behavior:
 * - melee / ranged: a player unit within vision (ranged: the best clump to splash); else the
 *   structure blocking the way (Motion.blockedBy: a barricade when walled in, the core on arrival)
 *   or the core once in range; else follow the flow field. Units that can only be reached through
 *   a wall are ignored, so walled-in mutants hit the wall instead of waiting behind it.
 * - bomber: the best building within vision (nearest, or where the blast hits most), walked to by
 *   A*; else as melee without units.
 * - boss: buildings within vision first, then units, then as melee.
 * guard: engage player units near the home nest, walk back to it otherwise; nestless guards retreat.
 * retreat: walk to the home (else nearest) nest without attacking; nests.ts absorbs arrivals.
 */
import { ENGAGEMENT, MUTANTS, type MutantDef } from '../data/combat';
import type { Game } from '../game';
import { distanceToRect } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import { lineClear } from '../nav/pathfind';
import type { Entity, Mutant, Nest } from '../state';
import { followFlowField, moveUnitTo, stopUnit } from '../world/movement';
import { isOnMap } from '../world/spatial';
import { canHit, chooseTarget, liveEntity } from './targeting';
import { gapBetween, mutantWeapon, type WeaponProfile } from './weapons';
import { nestDef } from './nests';

/** Mutants look for new targets this often (staggered by id); blocking structures every tick. */
const SCAN_TICKS = 5;
/** At most this many retreating mutants get an A* path per tick (lowest ids first), so a dawn with hundreds of survivors costs a bounded amount per tick. */
const RETREAT_PATHS_PER_TICK = 8;
/** Collision radius used for wall checks (as in world/movement.ts). */
const MAX_COLLISION_RADIUS = 0.34;

const isPlayerUnit = (e: Entity) => (e.kind === 'soldier' || e.kind === 'survivor') && isOnMap(e);
const isPlayerBuilding = (e: Entity) => e.kind === 'building';

function scanDue(game: Game, m: Mutant): boolean {
  return (game.state.tick + m.id) % SCAN_TICKS === 0;
}

function reachableDirectly(game: Game, m: Mutant, t: Entity): boolean {
  return lineClear(ensureNav(game), m.x, m.y, t.x, t.y, Math.min(m.radius, MAX_COLLISION_RADIUS));
}

/** Direct pursuit of a moving unit: walk straight at it (the movement system re-paths when stuck). */
function steerAt(game: Game, m: Mutant, t: Entity): void {
  const motion = m.motion;
  if (motion.mode !== 'path' || motion.path.length > 0 || motion.goal === null) {
    motion.mode = 'path';
    motion.path = [];
    motion.stuckTicks = 0;
  }
  motion.goal = { x: t.x, y: t.y };
  motion.pathNavVersion = ensureNav(game).version;
}

/** A player unit worth chasing: hittable now, or reachable in a straight line. */
function unitTarget(game: Game, m: Mutant, w: WeaponProfile, radius: number, accept: (e: Entity) => boolean): Entity | null {
  const t = chooseTarget(game, m, w, radius, (e) => isPlayerUnit(e) && accept(e));
  if (!t) return null;
  return canHit(w, gapBetween(m, t)) || reachableDirectly(game, m, t) ? t : null;
}

/** The structure in the way (walled in, or the core on arrival), or the core once in range. */
function blockingTarget(game: Game, m: Mutant, w: WeaponProfile): Entity | null {
  const blocker = liveEntity(game, m.motion.blockedBy);
  if (blocker && blocker.kind === 'building') return blocker;
  const core = liveEntity(game, m.ai.assaultTargetId) ?? liveEntity(game, game.state.coreId);
  return core && canHit(w, gapBetween(m, core)) ? core : null;
}

function pickAssaultTarget(game: Game, m: Mutant, def: MutantDef, w: WeaponProfile, scan: boolean): Entity | null {
  if (scan) {
    const anyUnit = () => true;
    if (def.behavior === 'bomber' || def.behavior === 'boss') {
      const b = chooseTarget(game, m, w, def.vision, isPlayerBuilding);
      if (b) return b;
    }
    if (def.behavior !== 'bomber') {
      const u = unitTarget(game, m, w, def.vision, anyUnit);
      if (u) return u;
    }
  }
  return blockingTarget(game, m, w);
}

/**
 * Whether to keep attacking the current target this tick. Units out of reach are re-checked for a
 * clear line on scan ticks (a target that slipped behind a wall is dropped).
 */
function keepAssaultTarget(game: Game, m: Mutant, def: MutantDef, w: WeaponProfile, t: Entity, scan: boolean): boolean {
  const gap = gapBetween(m, t);
  if (canHit(w, gap)) return t.kind === 'building' || isPlayerUnit(t);
  if (t.kind === 'building') {
    // Bombers and the boss walk to the buildings they picked; others only hit what blocks them.
    return (def.behavior === 'bomber' || def.behavior === 'boss') && gap <= def.vision + ENGAGEMENT.mutantChaseLeash;
  }
  return isPlayerUnit(t) && gap <= def.vision + ENGAGEMENT.mutantChaseLeash && (!scan || reachableDirectly(game, m, t));
}

function engage(game: Game, m: Mutant, w: WeaponProfile, t: Entity): void {
  const sameTarget = m.attack.targetId === t.id;
  m.attack.targetId = t.id;
  if (canHit(w, gapBetween(m, t))) {
    if (m.motion.mode !== 'stand') stopUnit(m);
    return;
  }
  if (t.kind === 'building') {
    // The flow field already leads into whatever blocks the way and into the core; only buildings
    // picked by sight (boomers, the boss) need a path of their own, computed once per target.
    if (t.id === m.motion.blockedBy || t.id === game.state.coreId || t.id === m.ai.assaultTargetId) {
      if (m.motion.mode !== 'flow') followFlowField(m);
    } else if (!sameTarget || m.motion.mode !== 'path') moveUnitTo(game, m, t.x, t.y);
    return;
  }
  steerAt(game, m, t);
}

function assault(game: Game, m: Mutant): void {
  const def = MUTANTS[m.type];
  const w = mutantWeapon(m);
  const scan = scanDue(game, m);
  const kept = liveEntity(game, m.attack.targetId);
  let t: Entity | null = kept && kept.faction === 'player' && keepAssaultTarget(game, m, def, w, kept, scan) ? kept : null;
  if (!t || scan) t = pickAssaultTarget(game, m, def, w, scan) ?? t;
  if (!t) {
    m.attack.targetId = 0;
    if (m.motion.mode !== 'flow') followFlowField(m);
    return;
  }
  engage(game, m, w, t);
}

/** Whether the unit is already walking to a point next to this nest. */
function headingTo(m: Mutant, nest: Nest): boolean {
  const g = m.motion.goal;
  return m.motion.mode === 'path' && g !== null && distanceToRect(nest.tileX, nest.tileY, nest.size, g.x, g.y) <= 1.5;
}

function guardNest(game: Game, m: Mutant): void {
  const home = liveEntity(game, m.ai.homeNestId);
  if ((!home || home.kind !== 'nest') && !m.ai.guardPoint) {
    m.ai.mode = 'retreat';
    m.ai.homeNestId = 0;
    return;
  }
  const def = MUTANTS[m.type];
  const w = mutantWeapon(m);
  const nest = home?.kind === 'nest' ? home : null;
  const anchor = m.ai.guardPoint ?? nest!;
  const radius = m.ai.guardPoint ? INCIDENT_RULES.guardRadius : nestDef(nest!).guardRadius;
  const nearNest = (e: Entity, extra: number) => (nest && !m.ai.guardPoint ? distanceToRect(nest.tileX, nest.tileY, nest.size, e.x, e.y) : Math.sqrt((anchor.x-e.x)*(anchor.x-e.x)+(anchor.y-e.y)*(anchor.y-e.y))) - e.radius <= radius + extra;
  const kept = liveEntity(game, m.attack.targetId);
  let t: Entity | null = kept && isPlayerUnit(kept) && nearNest(kept, ENGAGEMENT.guardLeashExtra) ? kept : null;
  if (!t || scanDue(game, m)) {
    const reach = Math.max(def.vision, radius + ENGAGEMENT.guardAggroExtra + (nest?.size ?? 0));
    t = unitTarget(game, m, w, reach, (e) => nearNest(e, ENGAGEMENT.guardAggroExtra)) ?? t;
  }
  if (t) return engage(game, m, w, t);
  m.attack.targetId = 0;
  if (nest && !m.ai.guardPoint ? headingTo(m, nest) : m.motion.mode === 'path' && m.motion.goal?.x === anchor.x && m.motion.goal?.y === anchor.y) return;
  const dx = m.x - anchor.x;
  const dy = m.y - anchor.y;
  if (dx * dx + dy * dy <= radius * radius) {
    if (m.motion.mode !== 'stand') stopUnit(m);
    return;
  }
  moveUnitTo(game, m, anchor.x, anchor.y);
}

function nearestNest(m: Mutant, nests: readonly Nest[]): Nest | null {
  let best: Nest | null = null;
  let bestD = Infinity;
  for (const n of nests) {
    const dx = n.x - m.x;
    const dy = n.y - m.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/** Path requests left this tick (RETREAT_PATHS_PER_TICK); reset by mutantAiSystem. */
interface PathBudget {
  left: number;
}

function retreat(game: Game, m: Mutant, nests: readonly Nest[], budget: PathBudget): void {
  m.attack.targetId = 0;
  let home = liveEntity(game, m.ai.homeNestId);
  if (!home || home.kind !== 'nest') {
    home = nearestNest(m, nests);
    m.ai.homeNestId = home?.id ?? 0;
  }
  if (!home) {
    if (m.motion.mode !== 'stand') stopUnit(m);
    return;
  }
  if (headingTo(m, home)) return;
  if (m.motion.mode !== 'stand') stopUnit(m);
  if (budget.left <= 0) return;
  budget.left--;
  moveUnitTo(game, m, home.x, home.y);
}

export function mutantAiSystem(game: Game): void {
  const nests: Nest[] = [];
  for (const e of game.state.entities.values()) if (e.kind === 'nest' && e.hp > 0) nests.push(e);
  const budget: PathBudget = { left: RETREAT_PATHS_PER_TICK };
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'mutant' || e.hp <= 0) continue;
    if (e.ai.mode === 'assault') assault(game, e);
    else if (e.ai.mode === 'guard') guardNest(game, e);
    if (e.ai.mode === 'retreat') retreat(game, e, nests, budget);
  }
}
