/**
 * Soldier AI: where soldiers under automatic control stand. Owner: v3 Task 3.
 *
 * A soldier is under automatic control exactly while it has the idle order (world/control.ts);
 * soldiers on a player order or holding are never moved. This system picks each one's post
 * (AttackState.post, kind 'guard') every SOLDIER_AI.intervalTicks and walks it there; what it
 * fights from the post is soldiers.ts (idle order). It uses what the player can see: own buildings
 * and soldiers, tonight's dusk forecast (the scout report) and the data tables.
 *
 * - Wounded soldiers (below retreatBelowPct of max hp) go to the core, day and night, without
 *   stopping to fight (soldiers.ts), and hold there. Nothing heals soldiers, so they stay until the
 *   player commands them; the hp share never rises, so none flips back and forth at the threshold.
 * - From dusk, when the forecast shows where attacks come from: squads stand postDistance from the
 *   core center toward their directions. Directions count heaviest first by expected threat (exact
 *   with a watchtower, else typical for the size), and only while their proportional share of the
 *   soldiers is at least minSquad, so a small army meets the main attack together instead of
 *   spreading thin; groups left out are met by the soldiers' base-area response. The soldiers are
 *   split by threat (largest remainder), each squad taking those whose day posts lie nearest to it.
 *   Nests attack under their compass direction in the same forecast, so they are covered alike.
 *   When the directions the squads would face carry no more than half of the expected threat (many
 *   similar groups, few soldiers), or dense fog hides the directions, everyone gathers around the
 *   core instead, where every attack heads. A forecast without attacks keeps the day posts.
 * - By day: the rally point of the soldier's home training building (Soldier.homeId), or beside it
 *   on the side facing the core without one. A soldier without a living home (starting soldiers,
 *   ruin and event recruits, a destroyed barracks) joins the training building nearest to it, or
 *   waits by the core when there is none.
 * Each group stands in formation around its point (world/orders.ts formationSlots), lower ids
 * nearer. A soldier is re-sent only when its post moves more than repostSlack, so soldiers joining
 * or leaving a group do not shuffle the rest; one in a fight finishes it first (unless wounded).
 */
import { SOLDIER_AI, trainsSoldiers } from '../data/combat';
import { DIRECTIONS, DIRECTION_VECTORS, type Direction } from '../data/map';
import { pointBeside } from '../economy/buildings';
import type { Game } from '../game';
import { tileAtPoint } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import type { Building, EntityId, Point, Soldier } from '../state';
import { moveUnitTo } from '../world/movement';
import { formationSlots } from '../world/orders';
import type { NightForecast } from './model';
import { expectedThreat } from './night';

export function isWounded(s: Soldier): boolean {
  return s.hp < s.maxHp * SOLDIER_AI.retreatBelowPct;
}

/** The point lies in the base area: within SOLDIER_AI.baseMargin of a player building (nav/navGrid.ts). */
export function inBaseArea(game: Game, x: number, y: number): boolean {
  const nav = ensureNav(game);
  const t = tileAtPoint(nav, x, y);
  return t !== -1 && nav.baseArea[t] === 1;
}

interface Group {
  at: Point;
  members: Soldier[];
  /** Soldiers at their day post keep the rally speed bonus of their first walk there. */
  dayPost: boolean;
}

function distance2(a: Point, b: Point): number {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

/** The soldier's living home training building, after assigning the nearest one if it has none. */
function homeOf(s: Soldier, homes: readonly Building[]): Building | null {
  const home = homes.find((h) => h.id === s.homeId);
  if (home) return home;
  let best: Building | null = null;
  for (const h of homes) if (!best || distance2(h, s) < distance2(best, s)) best = h;
  s.homeId = best?.id ?? 0;
  return best;
}

function dayPoint(game: Game, home: Building, core: Building): Point {
  return home.rally ?? pointBeside(game, home, core.x, core.y);
}

function nightPoint(game: Game, core: Building, direction: Direction): Point {
  const nav = ensureNav(game);
  const h = DIRECTION_VECTORS[direction];
  const x = core.x + h.x * SOLDIER_AI.postDistance;
  const y = core.y + h.y * SOLDIER_AI.postDistance;
  return { x: Math.min(nav.width - 0.5, Math.max(0.5, x)), y: Math.min(nav.height - 0.5, Math.max(0.5, y)) };
}

/** Night squads toward the forecast directions (see the header), or null to gather at the core; `soldiers` in id order. */
function squads(game: Game, core: Building, forecast: NightForecast, soldiers: readonly Soldier[], dayPoints: ReadonlyMap<EntityId, Point>): Group[] | null {
  const dirs = forecast.groups
    .map((g) => ({ direction: g.direction, threat: expectedThreat(g) }))
    .sort((a, b) => b.threat - a.threat || DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction));
  const all = dirs.reduce((sum, d) => sum + d.threat, 0);
  let total = all;
  while (dirs.length > 1 && (soldiers.length * (dirs.at(-1)?.threat ?? 0)) / total < SOLDIER_AI.minSquad) total -= dirs.pop()?.threat ?? 0;
  if (total * 2 <= all) return null;
  const exact = dirs.map((d) => (soldiers.length * d.threat) / total);
  const counts = exact.map((x) => Math.floor(x));
  let left = soldiers.length - counts.reduce((sum, n) => sum + n, 0);
  const byRemainder = dirs.map((_, k) => k).sort((a, b) => exact[b]! - counts[b]! - (exact[a]! - counts[a]!) || a - b);
  for (const k of byRemainder) if (left-- > 0) counts[k]!++;
  const free = [...soldiers];
  return dirs.map((d, k) => {
    const at = nightPoint(game, core, d.direction);
    const from = (s: Soldier) => distance2(dayPoints.get(s.id) ?? s, at);
    free.sort((a, b) => from(a) - from(b) || a.id - b.id);
    return { at, members: free.splice(0, counts[k]!).sort((a, b) => a.id - b.id), dayPost: false };
  });
}

/** Gives `s` the post `at` unless its current one is within repostSlack, and walks it there. */
function assign(game: Game, s: Soldier, at: Point, dayPost: boolean): void {
  const p = s.attack.post;
  if (p && p.kind === 'guard' && distance2(p, at) <= SOLDIER_AI.repostSlack * SOLDIER_AI.repostSlack) return;
  s.attack.post = { kind: 'guard', x: at.x, y: at.y };
  s.deploymentGoal = dayPost && s.deploymentGoal ? { x: at.x, y: at.y } : null;
  // A fight is finished first; soldiers.ts walks the soldier to its new post afterwards.
  if (s.attack.targetId !== 0 && !isWounded(s)) return;
  s.attack.targetId = 0;
  moveUnitTo(game, s, at.x, at.y);
}

export function soldierAiSystem(game: Game): void {
  const { state } = game;
  // Phases change on multiples of the interval; deciding halfway between keeps the soldiers' new
  // paths at dusk and dawn off the tick of the dawn's mass retreat (night.ts).
  if (state.tick % SOLDIER_AI.intervalTicks !== SOLDIER_AI.intervalTicks / 2) return;
  const core = state.entities.get(state.coreId);
  if (!core || core.kind !== 'building') return;
  const soldiers: Soldier[] = [];
  const homes: Building[] = [];
  for (const e of state.entities.values()) {
    if (e.kind === 'soldier' && e.hp > 0 && e.control === 'auto' && e.order.type === 'idle') soldiers.push(e);
    else if (e.kind === 'building' && e.hp > 0 && e.construction === null && trainsSoldiers(e.type)) homes.push(e);
  }
  if (soldiers.length === 0) return;

  const groups = new Map<string, Group>();
  const join = (key: string, at: Point, s: Soldier, dayPost: boolean) => {
    const g = groups.get(key) ?? { at, members: [], dayPost };
    g.members.push(s);
    groups.set(key, g);
  };
  const coreAt = { x: core.x, y: core.y };
  const homePoints = new Map<EntityId, Point>([[0, coreAt]]);
  const dayPoints = new Map<EntityId, Point>();
  const healthy: Soldier[] = [];
  for (const s of soldiers) {
    const home = homeOf(s, homes);
    if (home && !homePoints.has(home.id)) homePoints.set(home.id, dayPoint(game, home, core));
    dayPoints.set(s.id, homePoints.get(s.homeId) as Point);
    if (isWounded(s)) join('core', coreAt, s, false);
    else healthy.push(s);
  }
  const forecast = state.clock.phase !== 'day' ? state.night.forecast : null;
  const night = forecast && forecast.directionsKnown && forecast.groups.length > 0 ? squads(game, core, forecast, healthy, dayPoints) : null;
  if (night) {
    night.forEach((g, k) => groups.set(`squad${k}`, g));
  } else if (forecast && (!forecast.directionsKnown || forecast.groups.length > 0)) {
    for (const s of healthy) join('core', coreAt, s, false);
  } else {
    for (const s of healthy) join(s.homeId === 0 ? 'core' : `home${s.homeId}`, dayPoints.get(s.id) as Point, s, s.homeId !== 0);
  }
  for (const g of groups.values()) {
    // formationSlots puts a lone unit on the point itself even when it is blocked (the core).
    const slots = formationSlots(game, g.at.x, g.at.y, Math.max(2, g.members.length));
    g.members.forEach((s, k) => assign(game, s, slots[k] as Point, g.dayPost));
  }
}
