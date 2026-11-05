/**
 * Night cycle: at dusk build the NightPlan (night RNG stream, NIGHTS, difficulty, nest levels)
 * and publish the forecast (precise with a watchtower); during the night spawn PendingSpawns from
 * map spawn points and nests; at dawn send survivors of the night back to the nearest nest and
 * strengthen it. Owner: Task 3.
 *
 * Plan: NIGHTS[n].directions distinct map-edge directions share the night budget (x difficulty),
 * each with a random weight; every nest above level 1 adds its own group of
 * nightThreatPerLevel x (level - 1) (x difficulty) threat, spawned beside it. Mutants are bought
 * by mix weight among the types the remaining threat affords, runners in packs. The boss joins
 * one edge group. Every group trickles in over NIGHT_SPAWN.spreadSeconds from the night start.
 */
import { CALENDAR, RADIO_BROADCASTS, FINAL_RADIO_BROADCAST, type NightType } from '../data/calendar';
import {
  DIFFICULTIES,
  FORECAST,
  MUTANTS,
  MUTANT_TYPES,
  NIGHTS,
  NIGHT_SPAWN,
  type MutantType,
} from '../data/combat';
import { DIRECTIONS, type Direction } from '../data/map';
import { emit } from '../events';
import type { Game } from '../game';
import { nextInt, nextRange, pick, pickWeighted, shuffle, type Rng } from '../rng';
import type { Mutant, Nest } from '../state';
import { secondsToTicks, TOTAL_NIGHTS } from '../time';
import { openTilesAround, spawnMutant } from '../world/entities';
import { followFlowField } from '../world/movement';
import type { AttackGroup, ForecastGroup, ForecastSize, NightForecast, NightPlan, PendingSpawn } from './model';
import { nestNightThreat } from './nests';
import { edgeNightBudget } from './nightBudget';
import { liveEntity } from './targeting';

/** tan(22.5 deg): splits the compass into eight 45 degree sectors without trigonometry. */
const TAN_22_5 = 0.41421356;

/** Compass direction of (dx, dy) as seen from the core (y grows southward). */
export function compassDirection(dx: number, dy: number): Direction {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay <= ax * TAN_22_5) return dx >= 0 ? 'E' : 'W';
  if (ax <= ay * TAN_22_5) return dy >= 0 ? 'S' : 'N';
  if (dy < 0) return dx >= 0 ? 'NE' : 'NW';
  return dx >= 0 ? 'SE' : 'SW';
}

/** Buys mutants with `budget` threat: weighted by `mix` among the types it affords, whole packs only. */
function buyMutants(rng: Rng, mix: Partial<Record<MutantType, number>>, budget: number): Partial<Record<MutantType, number>> {
  const counts: Partial<Record<MutantType, number>> = {};
  const types = MUTANT_TYPES.filter((t) => (mix[t] ?? 0) > 0);
  let left = budget + 1e-9;
  for (;;) {
    const affordable = types.filter((t) => MUTANTS[t].threat * MUTANTS[t].packSize <= left);
    if (affordable.length === 0) break;
    const t = pickWeighted(rng, affordable, (x) => mix[x] ?? 0);
    const def = MUTANTS[t];
    counts[t] = (counts[t] ?? 0) + def.packSize;
    left -= def.packSize * def.threat;
  }
  return counts;
}

/** The composition of night `night` (1-based), drawn from the night stream. */
export function planNight(game: Game, night: number): NightPlan {
  const { state } = game;
  const def = NIGHTS[night - 1];
  const groups: AttackGroup[] = [];
  const type = game.calendarPlan[night - 1];
  if (!def || !type || type === 'rustStorm') return { night, groups };
  const rng = state.rng.night;

  const directions = def.directions + (type === 'surge' ? CALENDAR.surgeExtraDirections : 0);
  const points = type === 'calm' ? [] : shuffle(rng, [...state.map.spawnPoints]).slice(0, directions);
  const weights = points.map(() => nextRange(rng, 1 - NIGHT_SPAWN.shareJitter, 1 + NIGHT_SPAWN.shareJitter));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const budget = edgeNightBudget(night, state.options.difficulty, type);
  points.forEach((p, k) => {
    const share = (budget * (weights[k] as number)) / weightSum;
    groups.push({ baseBudget: share, direction: p.direction, tile: p.tile, nestId: 0, assaultTargetId: 0, mutants: buyMutants(rng, def.mix, share), boss: null });
  });
  if (type === 'surge' && def.boss && groups.length > 0) (groups[nextInt(rng, 0, groups.length - 1)] as AttackGroup).boss = { ...def.boss };

  const core = state.entities.get(state.coreId);
  for (const e of state.entities.values()) {
    if (e.kind !== 'nest' || e.hp <= 0 || e.growth.level <= 1) continue;
    const threat = nestNightThreat(e, night, state.options.difficulty);
    const tile = openTilesAround(game, e, 1, core?.x ?? e.x, core?.y ?? e.y)[0];
    if (tile === undefined) continue;
    const direction = compassDirection(e.x - (core?.x ?? e.x), e.y - (core?.y ?? e.y));
    groups.push({ baseBudget: threat, direction, tile, nestId: e.id, assaultTargetId: 0, mutants: buyMutants(rng, def.mix, threat), boss: null });
  }
  if (state.signal.stage === 'broadcast' && groups[0]) groups[0].assaultTargetId = state.signal.buildingId;
  const plan = { night, groups };
  repriceIncidentNight(game, plan, false);
  return plan;
}

/** Rebuy only edge groups; nest attacks, directions and bosses keep their original plan. */
export function repriceIncidentNight(game: Game, plan: NightPlan, publish = true): void {
  const extra = game.state.incidents.nightBudgetAdjustments.filter(a => a.night === plan.night).reduce((s,a) => s+a.budgetPct,0);
  if (!extra) return;
  for (const group of plan.groups) if (!group.nestId) group.mutants = buyMutants(game.state.rng.night, NIGHTS[plan.night-1]!.mix, group.baseBudget*(1+extra));
  if (publish) publishForecast(game,plan);
}

function forecastPrecise(game: Game): boolean {
  if (game.modifiers.global.forecastPrecise > 0) return true;
  for (const e of game.state.entities.values()) {
    if (e.kind === 'building' && e.type === 'watchtower' && e.construction === null && e.hp > 0) return true;
  }
  return false;
}

function sizeOf(threat: number): ForecastSize {
  if (threat >= FORECAST.largeThreat) return 'large';
  return threat >= FORECAST.mediumThreat ? 'medium' : 'small';
}

/** The plan as the player sees it: per direction, exact only when precise. */
export function forecastFor(plan: NightPlan, precise: boolean, type: NightType): NightForecast {
  if (type === 'denseFog') return { night: plan.night, directionsKnown: false, precise: false, groups: [] };
  const groups: ForecastGroup[] = [];
  for (const direction of DIRECTIONS) {
    const here = plan.groups.filter((g) => g.direction === direction);
    if (here.length === 0) continue;
    let threat = 0;
    const counts: Partial<Record<MutantType, number>> = {};
    let boss = false;
    for (const g of here) {
      for (const t of MUTANT_TYPES) {
        const n = g.mutants[t] ?? 0;
        if (n === 0) continue;
        counts[t] = (counts[t] ?? 0) + n;
        threat += n * MUTANTS[t].threat;
      }
      if (g.boss) {
        boss = true;
        threat += MUTANTS[g.boss.type].threat;
      }
    }
    if (threat === 0) continue;
    groups.push({ direction, size: sizeOf(threat), counts: precise ? counts : null, boss: precise ? boss : null });
  }
  return { night: plan.night, directionsKnown: true, precise, groups };
}

function publishForecast(game: Game, plan: NightPlan): void {
  game.state.night.forecast = forecastFor(plan, forecastPrecise(game), game.calendarPlan[plan.night - 1]!);
  emit(game, { type: 'forecastReady', night: plan.night });
}

/** The plan's mutants as timed spawns, each group spread evenly over the first seconds of the night. */
function scheduleSpawns(game: Game, plan: NightPlan): PendingSpawn[] {
  const { state } = game;
  const rng = state.rng.night;
  const hpPct = DIFFICULTIES[state.options.difficulty].mutantHpPct;
  const spread = secondsToTicks(NIGHT_SPAWN.spreadSeconds);
  const out: PendingSpawn[] = [];
  for (const g of plan.groups) {
    const types: MutantType[] = [];
    for (const t of MUTANT_TYPES) for (let k = 0; k < (g.mutants[t] ?? 0); k++) types.push(t);
    shuffle(rng, types);
    if (g.boss) out.push({ tick: state.tick, type: g.boss.type, tile: g.tile, nestId: g.nestId, assaultTargetId: g.assaultTargetId, hpPct: hpPct * g.boss.hpPct, boss: true });
    types.forEach((type, k) => {
      out.push({ tick: state.tick + Math.floor((k * spread) / types.length), type, tile: g.tile, nestId: g.nestId, assaultTargetId: g.assaultTargetId, hpPct, boss: false });
    });
  }
  // Stable sort keeps group order within a tick.
  return out.sort((a, b) => a.tick - b.tick);
}

function spawnPending(game: Game, p: PendingSpawn): Mutant | null {
  const { state } = game;
  if (p.nestId !== 0 && !liveEntity(game, p.nestId)) return null;
  const rng = state.rng.night;
  const j = NIGHT_SPAWN.jitter;
  const x = (p.tile % state.map.width) + 0.5 + nextRange(rng, -j, j);
  const y = Math.floor(p.tile / state.map.width) + 0.5 + nextRange(rng, -j, j);
  const m = spawnMutant(game, p.type, x, y, { mode: 'assault', homeNestId: p.nestId, assaultTargetId: p.assaultTargetId, boss: p.boss, hpPct: p.hpPct });
  m.ai.damagePct = DIFFICULTIES[state.options.difficulty].mutantDamagePct - 1;
  followFlowField(m);
  return m;
}

function spawnDue(game: Game): void {
  const pending = game.state.night.pending;
  let k = 0;
  while (k < pending.length && (pending[k] as PendingSpawn).tick <= game.state.tick) spawnPending(game, pending[k++] as PendingSpawn);
  if (k > 0) pending.splice(0, k);
}

function nearestNest(nests: readonly Nest[], x: number, y: number): Nest | null {
  let best: Nest | null = null;
  let bestD = Infinity;
  for (const n of nests) {
    const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/** Dawn: the night is over; whoever attacked and is still alive heads for the nearest nest. */
function dawn(game: Game): void {
  const { state } = game;
  state.stats.nightsSurvived++;
  if (state.stats.buildingsLostTonight === 0) state.stats.nightsWithoutBuildingLoss++;
  state.night.pending = [];
  state.night.plan = null;
  state.night.forecast = null;
  state.night.broadcast = null;
  const nests: Nest[] = [];
  for (const e of state.entities.values()) if (e.kind === 'nest' && e.hp > 0) nests.push(e);
  for (const e of state.entities.values()) {
    if (e.kind !== 'mutant' || e.ai.mode !== 'assault') continue;
    e.ai.mode = 'retreat';
    e.ai.homeNestId = nearestNest(nests, e.x, e.y)?.id ?? 0;
    e.attack.targetId = 0;
  }
}

export function nightSystem(game: Game): void {
  const { state } = game;
  const { phase, phaseTick, day } = state.clock;
  const night = state.night;
  if (phase === 'dusk' && phaseTick === 0) {
    const type = game.calendarPlan[day - 1]!;
    night.broadcast = { night: day, type, text: day === TOTAL_NIGHTS ? FINAL_RADIO_BROADCAST : pick(state.rng.calendar, RADIO_BROADCASTS[type]) };
    night.plan = planNight(game, day);
    publishForecast(game, night.plan);
  } else if (phase === 'night' && phaseTick === 0) {
    state.stats.buildingsLostTonight = 0;
    night.pending = night.plan ? scheduleSpawns(game, night.plan) : [];
  } else if (phase === 'day' && phaseTick === 0 && day > 1) {
    dawn(game);
  }
  if (phase === 'night') spawnDue(game);
  if (night.plan && night.forecast && night.forecast.directionsKnown && !night.forecast.precise && forecastPrecise(game)) publishForecast(game, night.plan);
}
