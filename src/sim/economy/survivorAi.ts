/**
 * Survivor manager: what survivors under automatic control (Survivor.control === 'auto') do.
 * Owner: v3 Task 2. Survivors under player control and survivors isolated by an incident are never
 * moved; they still fill the worker slots they occupy. The manager decides every
 * SURVIVOR_AI.intervalTicks from what the player can see: own buildings and stockpiles, tonight's
 * published weather, and mutants on currently visible tiles. Nobody is sent to a building with a
 * visible mutant within enemyClearance of it, nor until none has been seen there for
 * enemyCalmSeconds, so a mutant at the edge of sight does not send survivors back and forth.
 *
 * - Rust-storm dusk and night: everyone outdoors who is not on the way to work goes into the
 *   nearest building with a free worker slot, whatever it makes. Nothing else happens.
 * - Upkeep jobs come first, filled by the nearest idle survivors: repairing finished buildings
 *   below repairBelowPct (core first, then the most damaged; one repairer per hpPerRepairer
 *   missing, at most CONSTRUCTION.maxBuilders), the crew of a signal tower site, and helping other
 *   construction sites (up to maxBuilders each). By day repairs (while fewer than repairShare of
 *   the managed survivors repair) and the tower crew also take workers out of production; sites
 *   never do, since they build on their own. Repairers whose building came near a visible mutant,
 *   or who ran out of scrap, are called back.
 * - Everyone else works in production. The managed workforce is split between the lines (food,
 *   scrap, fuel, research while a research is selected, dispatch hubs) in proportion to weights:
 *   1 per line, times up to (1 + shortageBoost) as a stockpile falls below its target, halved
 *   above its glut level, and no line above the slots it has. Idle survivors join the line furthest
 *   below its share, at its best-placed building. By day one worker per transferSeconds may move
 *   from the line furthest above its share to the one furthest below, once the two are transferGap
 *   workers apart: walking costs output, so small differences and wobbling stockpiles leave
 *   everyone where they are.
 */
import { nightType } from '../calendar/calendar';
import { BUILDINGS, CONSTRUCTION, RESOURCES, SURVIVOR_AI, type Resource } from '../data/economy';
import type { Game } from '../game';
import { isIsolated } from '../incidents/model';
import { tileAtPoint } from '../map/grid';
import { zeroRecord } from '../record';
import { FOG_VISIBLE, type Building, type EntityId, type GameState, type Point, type Survivor } from '../state';
import { secondsToTicks } from '../time';
import { edgeDistance, forEachInRadius } from '../world/spatial';
import { buildingById } from './buildings';
import { placementBonusPct } from './production';
import { assignTask, goIdle, workerSlots } from './workers';

/** A production line: the resource a building makes, or support for dispatch hubs. */
type Line = Resource | 'support';
const LINES: readonly Line[] = [...RESOURCES, 'support'];
const STOCKED = ['food', 'scrap', 'fuel'] as const;

/** Survivors the manager may move: under automatic control, alive, not isolated by an incident. */
export function isManaged(state: Pick<GameState, 'incidents'>, s: Survivor): boolean {
  return s.control === 'auto' && s.hp > 0 && !isIsolated(state.incidents, s.id);
}

/**
 * The survivor a training order or a "send a survivor here" button takes for building `at`: the
 * managed survivor nearest to it that is not already working at or repairing it, idle ones first.
 */
export function nearestAutoSurvivor(state: Pick<GameState, 'entities' | 'incidents'>, at: { readonly id: EntityId; readonly x: number; readonly y: number }): Survivor | null {
  let best: Survivor | null = null;
  let bestIdle = false;
  let bestD = Infinity;
  for (const e of state.entities.values()) {
    if (e.kind !== 'survivor' || !isManaged(state, e)) continue;
    if ((e.task.type === 'work' || e.task.type === 'repair') && e.task.buildingId === at.id) continue;
    const idle = e.task.type === 'idle';
    const d = (e.x - at.x) * (e.x - at.x) + (e.y - at.y) * (e.y - at.y);
    if ((idle && !bestIdle) || (idle === bestIdle && d < bestD)) {
      best = e;
      bestIdle = idle;
      bestD = d;
    }
  }
  return best;
}

/** A building with worker slots the manager can send people into. */
interface Workplace {
  b: Building;
  /** null: a signal tower site, which only takes its crew. */
  line: Line | null;
  slots: number;
  /** Workers inside plus survivors on their way, whoever controls them. */
  occupants: number;
  /** Managed survivors working there or on their way. */
  managed: Survivor[];
  bonus: number;
}

interface Round {
  game: Game;
  day: boolean;
  managed: Survivor[];
  buildings: Building[];
  workplaces: Map<EntityId, Workplace>;
  /** Survivors on a repair task per building (helpers on sites included), whoever controls them. */
  repairers: Map<EntityId, number>;
  unsafe: Map<EntityId, boolean>;
}

function lineOf(b: Building): Line {
  return BUILDINGS[b.type].production?.resource ?? 'support';
}

function survey(game: Game): Round {
  const { state } = game;
  const managed: Survivor[] = [];
  const buildings: Building[] = [];
  for (const e of state.entities.values()) {
    if (e.kind === 'building' && e.hp > 0) buildings.push(e);
    else if (e.kind === 'survivor' && isManaged(state, e)) managed.push(e);
  }
  const workplaces = new Map<EntityId, Workplace>();
  for (const b of buildings) {
    const slots = workerSlots(game.modifiers, b);
    const tower = b.type === 'signalTower';
    if (slots === 0 || (tower ? b.construction === null : b.construction !== null)) continue;
    const bonus = tower ? 0 : placementBonusPct(game, b.type, b.tileX, b.tileY);
    workplaces.set(b.id, { b, line: tower ? null : lineOf(b), slots, occupants: b.workers.length, managed: [], bonus });
  }
  const repairers = new Map<EntityId, number>();
  for (const e of state.entities.values()) {
    if (e.kind !== 'survivor' || e.hp <= 0 || (e.task.type !== 'work' && e.task.type !== 'repair')) continue;
    if (e.task.type === 'repair') {
      repairers.set(e.task.buildingId, (repairers.get(e.task.buildingId) ?? 0) + 1);
      continue;
    }
    const w = workplaces.get(e.task.buildingId);
    if (!w) continue;
    if (e.insideId === 0) w.occupants++;
    if (isManaged(state, e)) w.managed.push(e);
  }
  return { game, day: state.clock.phase === 'day', managed, buildings, workplaces, repairers, unsafe: new Map() };
}

/** A visible mutant stands within enemyClearance of the building. */
function enemyInSight(round: Round, b: Building): boolean {
  const { fog, map } = round.game.state;
  const reach = SURVIVOR_AI.enemyClearance;
  let seen = false;
  forEachInRadius(round.game.spatial, b.x, b.y, reach + b.size, (e) => {
    if (seen || e.kind !== 'mutant' || edgeDistance(b, e.x, e.y) - e.radius > reach) return;
    seen = fog[tileAtPoint(map, e.x, e.y)] === FOG_VISIBLE;
  });
  return seen;
}

/** A mutant is in sight near the building, or was within enemyCalmSeconds (sightings older than that are gone). */
function unsafe(round: Round, b: Building): boolean {
  const known = round.unsafe.get(b.id);
  if (known !== undefined) return known;
  const { state } = round.game;
  const sightings = state.economy.survivorAi.enemySightings;
  const last = sightings.find((r) => r.buildingId === b.id);
  const seen = enemyInSight(round, b);
  if (seen && last) last.tick = state.tick;
  else if (seen) sightings.push({ buildingId: b.id, tick: state.tick });
  round.unsafe.set(b.id, seen || last !== undefined);
  return seen || last !== undefined;
}

function distance2(a: Point, b: Point): number {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

function workplaceOf(round: Round, s: Survivor): Workplace | undefined {
  return s.task.type === 'work' ? round.workplaces.get(s.task.buildingId) : undefined;
}

/** Sends `s` to work or repair at `b`, keeping the round's counts current. */
function send(round: Round, s: Survivor, task: 'work' | 'repair', b: Building): void {
  const from = workplaceOf(round, s);
  if (from) {
    from.occupants--;
    from.managed.splice(from.managed.indexOf(s), 1);
  } else if (s.task.type === 'repair') round.repairers.set(s.task.buildingId, (round.repairers.get(s.task.buildingId) ?? 1) - 1);
  assignTask(round.game, s, task, b);
  if (s.task.type === 'idle') return;
  if (task === 'repair') round.repairers.set(b.id, (round.repairers.get(b.id) ?? 0) + 1);
  const to = round.workplaces.get(b.id);
  if (task === 'work' && to) {
    to.occupants++;
    to.managed.push(s);
  }
}

function hasRoom(round: Round, w: Workplace): boolean {
  return w.occupants < w.slots && !unsafe(round, w.b);
}

function nearest<T>(items: readonly T[], at: Point, pointOf: (item: T) => Point): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = distance2(pointOf(item), at);
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

function shelter(round: Round): void {
  const open = () => [...round.workplaces.values()].filter((w) => hasRoom(round, w));
  for (const s of round.managed) {
    if (s.insideId !== 0 || s.task.type === 'work') continue;
    const w = nearest(open(), s, (x) => x.b);
    if (w) send(round, s, 'work', w.b);
  }
}

/** Repairers at a building that is not safe (see unsafe), or with no scrap left to repair with, come back. */
function recallRepairers(round: Round): void {
  const scrap = round.game.state.economy.resources.scrap;
  for (const s of round.managed) {
    if (s.task.type !== 'repair') continue;
    const b = buildingById(round.game, s.task.buildingId);
    if (!b || (!unsafe(round, b) && (b.construction !== null || scrap > 0))) continue;
    round.repairers.set(b.id, (round.repairers.get(b.id) ?? 1) - 1);
    goIdle(s);
  }
}

interface UpkeepJob {
  b: Building;
  task: 'work' | 'repair';
  need: number;
  /** By day the job may take workers out of production. */
  pulls: boolean;
}

function upkeepJobs(round: Round): UpkeepJob[] {
  const { game } = round;
  const repairs: UpkeepJob[] = [];
  const crews: UpkeepJob[] = [];
  const sites: UpkeepJob[] = [];
  const canRepair = game.state.economy.resources.scrap >= SURVIVOR_AI.repairMinScrap;
  const helping = (b: Building) => round.repairers.get(b.id) ?? 0;
  for (const b of round.buildings) {
    if (b.type === 'signalTower' && b.construction !== null) {
      const w = round.workplaces.get(b.id);
      if (w) crews.push({ b, task: 'work', need: w.slots - w.occupants, pulls: true });
    } else if (b.construction !== null) sites.push({ b, task: 'repair', need: CONSTRUCTION.maxBuilders - helping(b), pulls: false });
    else if (canRepair && b.hp < b.maxHp * SURVIVOR_AI.repairBelowPct) {
      const crew = Math.min(CONSTRUCTION.maxBuilders, Math.ceil((b.maxHp - b.hp) / SURVIVOR_AI.hpPerRepairer));
      repairs.push({ b, task: 'repair', need: crew - helping(b), pulls: true });
    }
  }
  const core = game.state.coreId;
  repairs.sort((p, q) => Number(q.b.id === core) - Number(p.b.id === core) || p.b.hp / p.b.maxHp - q.b.hp / q.b.maxHp || p.b.id - q.b.id);
  return [...repairs, ...crews, ...sites].filter((job) => job.need > 0 && !unsafe(round, job.b));
}

/** Upkeep jobs from idle survivors, then (by day, where allowed) from production workers. */
function staffUpkeep(round: Round): void {
  const repairCap = Math.max(1, Math.ceil(round.managed.length * SURVIVOR_AI.repairShare));
  let repairing = round.managed.filter((s) => s.task.type === 'repair' && buildingById(round.game, s.task.buildingId)?.construction === null).length;
  for (const job of upkeepJobs(round)) {
    for (; job.need > 0; job.need--) {
      const idle = round.managed.filter((s) => s.task.type === 'idle' && s.insideId === 0);
      let s = nearest(idle, job.b, (x) => x);
      if (!s && job.pulls && round.day && (job.task === 'work' || repairing < repairCap)) {
        const workers = round.managed.filter((x) => workplaceOf(round, x)?.line);
        s = nearest(workers, job.b, (x) => x);
      }
      if (!s) break;
      send(round, s, job.task, job.b);
      if (job.task === 'repair' && job.b.construction === null && s.task.type === 'repair') repairing++;
    }
  }
}

/** Line weights from the stockpiles: shortage raises a line, glut halves it. */
function lineWeights(game: Game): Record<Line, number> {
  const { resources, expensePerDay, tech } = game.state.economy;
  const weights = zeroRecord(LINES);
  weights.research = tech.current !== null ? 1 : 0;
  weights.support = 1;
  for (const r of STOCKED) {
    const { target, glut } = SURVIVOR_AI.stock[r];
    const upkeep = r === 'food' ? SURVIVOR_AI.upkeepDays * expensePerDay.food : 0;
    const shortage = Math.min(1, Math.max(0, (target + upkeep - resources[r]) / (target + upkeep)));
    weights[r] = (1 + SURVIVOR_AI.shortageBoost * shortage) * (resources[r] > glut + upkeep ? 0.5 : 1);
  }
  return weights;
}

/** Splits `n` workers between lines in proportion to weight, no line above its cap. */
function shares(weights: Record<Line, number>, caps: Record<Line, number>, n: number): Record<Line, number> {
  const out = zeroRecord(LINES);
  let open = LINES.filter((l) => weights[l] > 0 && caps[l] > 0);
  let left = n;
  while (open.length > 0 && left > 0) {
    const total = open.reduce((sum, l) => sum + weights[l], 0);
    const full = open.filter((l) => (left * weights[l]) / total >= caps[l]);
    if (full.length === 0) {
      for (const l of open) out[l] = (left * weights[l]) / total;
      break;
    }
    for (const l of full) {
      out[l] = caps[l];
      left -= caps[l];
    }
    open = open.filter((l) => !full.includes(l));
  }
  return out;
}

/** The best open workplace of a line for `s`: highest local bonus, then nearest, then lowest id. */
function bestWorkplace(round: Round, line: Line, s: Survivor): Workplace | null {
  let best: Workplace | null = null;
  for (const w of round.workplaces.values()) {
    if (w.line !== line || !hasRoom(round, w)) continue;
    if (!best || w.bonus > best.bonus || (w.bonus === best.bonus && distance2(w.b, s) < distance2(best.b, s))) best = w;
  }
  return best;
}

function staffProduction(round: Round): void {
  const { game } = round;
  const weights = lineWeights(game);
  const caps = zeroRecord(LINES);
  const current = zeroRecord(LINES);
  for (const w of round.workplaces.values()) {
    if (!w.line) continue;
    caps[w.line] += w.slots - w.occupants + w.managed.length;
    current[w.line] += w.managed.length;
  }
  const idle = round.managed.filter((s) => s.task.type === 'idle' && s.insideId === 0);
  const desired = shares(weights, caps, idle.length + LINES.reduce((n, l) => n + current[l], 0));
  const deficit = (l: Line) => desired[l] - current[l];
  for (const s of idle) {
    let pick: Workplace | null = null;
    for (const l of LINES) {
      if (weights[l] <= 0 || (pick && deficit(l) <= deficit(pick.line as Line))) continue;
      pick = bestWorkplace(round, l, s) ?? pick;
    }
    if (!pick) continue;
    send(round, s, 'work', pick.b);
    if (s.task.type === 'work') current[pick.line as Line]++;
  }
  const memory = game.state.economy.survivorAi;
  if (!round.day || game.state.tick < memory.nextTransferTick) return;
  const under = LINES.filter((l) => weights[l] > 0 && [...round.workplaces.values()].some((w) => w.line === l && hasRoom(round, w))).sort((p, q) => deficit(q) - deficit(p))[0];
  const over = LINES.filter((l) => current[l] > 0).sort((p, q) => deficit(p) - deficit(q))[0];
  if (!under || !over || under === over || deficit(under) - deficit(over) < SURVIVOR_AI.transferGap) return;
  // The worker comes from the line's worst-placed workplace, one still on its way if there is one.
  const from = [...round.workplaces.values()].filter((w) => w.line === over && w.managed.length > 0).sort((p, q) => p.bonus - q.bonus || q.b.id - p.b.id)[0] as Workplace;
  const s = from.managed.find((x) => x.insideId === 0) ?? (from.managed.at(-1) as Survivor);
  const to = bestWorkplace(round, under, s);
  if (!to) return;
  send(round, s, 'work', to.b);
  memory.nextTransferTick = game.state.tick + secondsToTicks(SURVIVOR_AI.transferSeconds);
}

export function survivorAiSystem(game: Game): void {
  const { state } = game;
  if (state.tick % SURVIVOR_AI.intervalTicks !== 0) return;
  const memory = state.economy.survivorAi;
  const calm = secondsToTicks(SURVIVOR_AI.enemyCalmSeconds);
  memory.enemySightings = memory.enemySightings.filter((r) => state.tick - r.tick < calm);
  const round = survey(game);
  if (state.clock.phase !== 'day' && nightType(state) === 'rustStorm') return shelter(round);
  recallRepairers(round);
  staffUpkeep(round);
  staffProduction(round);
}
