/**
 * What a bot expects of the coming night (Task 5), from what a player would know: the dusk
 * forecast (sizes per direction, exact counts with a watchtower), the mutants it saw during the
 * previous nights, the nests it discovered, and that nights grow harder (the data tables).
 * The real night plan in the state is never read.
 */
import { FORECAST, MUTANTS, MUTANT_TYPES, NIGHTS, type MutantType } from '../../sim/data/combat';
import { DIRECTIONS, type Direction } from '../../sim/data/map';
import { nightType, nestNightThreat, edgeNightBudget, type Game, type Point } from '../../sim';
import { coreOf, type Snapshot } from './view';

export type Counts = Record<MutantType, number>;

export function zeroCounts(): Counts {
  return Object.fromEntries(MUTANT_TYPES.map((m) => [m, 0])) as Counts;
}

/** Sightings remembered across ticks. */
export interface Sightings {
  /** Ids seen during the current night, by type. */
  tonight: Map<number, MutantType>;
  /** Counts seen during the previous night. */
  lastNight: Counts | null;
}

export function createSightings(): Sightings {
  return { tonight: new Map(), lastNight: null };
}

/** Call every decision: records visible mutants at night and closes the record at dawn. */
export function recordSightings(game: Game, snap: Snapshot, s: Sightings): void {
  const { phase } = game.state.clock;
  if (phase === 'night') {
    for (const m of snap.visibleMutants) s.tonight.set(m.id, m.type);
  } else if (s.tonight.size > 0) {
    const counts = zeroCounts();
    for (const t of s.tonight.values()) counts[t]++;
    s.lastNight = counts;
    s.tonight.clear();
  }
}

export interface ThreatEstimate {
  night: number;
  /** Expected threat points (1 = one wanderer) of the coming night. */
  threat: number;
  /** Share of the threat by mutant type (sums to 1). */
  mix: Record<MutantType, number>;
  boss: boolean;
  /** Forecast directions weighted by size (empty before dusk). */
  directions: { direction: Direction; weight: number }[];
}

const SIZE_THREAT = { small: FORECAST.mediumThreat / 2, medium: (FORECAST.mediumThreat + FORECAST.largeThreat) / 2, large: FORECAST.largeThreat * 1.5 };

/** Unit vector of a compass direction (y grows southward). */
export function directionVector(d: Direction): Point {
  const k = DIRECTIONS.indexOf(d);
  const diag = Math.SQRT1_2;
  const table: Point[] = [
    { x: 0, y: -1 },
    { x: diag, y: -diag },
    { x: 1, y: 0 },
    { x: diag, y: diag },
    { x: 0, y: 1 },
    { x: -diag, y: diag },
    { x: -1, y: 0 },
    { x: -diag, y: -diag },
  ];
  return table[k] as Point;
}

function threatOf(counts: Partial<Counts>): number {
  let t = 0;
  for (const m of MUTANT_TYPES) t += (counts[m] ?? 0) * MUTANTS[m].threat;
  return t;
}

/** The night the bot prepares for: tonight from dusk on, otherwise the coming one. */
export function comingNight(game: Game): number {
  return game.state.clock.day;
}

export function estimateThreat(game: Game, snap: Snapshot, s: Sightings): ThreatEstimate {
  const night = comingNight(game);
  const def = NIGHTS[Math.min(night, NIGHTS.length) - 1];
  // Experience: the edge budget grows every night, and every known nest above level 1 sends its own group.
  const type = nightType(game.state);
  let prior = edgeNightBudget(night, game.state.options.difficulty, type);
  if (type !== 'rustStorm') for (const n of snap.discoveredNests) prior += nestNightThreat(n, night, game.state.options.difficulty);
  const mix = zeroCounts();
  const forecast = game.state.night.forecast;
  const directions: ThreatEstimate['directions'] = [];
  let forecastThreat = 0;
  let precise: Partial<Counts> | null = null;
  let boss = type === 'surge' && def?.boss != null;
  let preciseBoss = false;
  if (forecast && forecast.night === night && forecast.directionsKnown) {
    for (const g of forecast.groups) {
      const t = g.counts ? threatOf(g.counts) : SIZE_THREAT[g.size];
      forecastThreat += t;
      directions.push({ direction: g.direction, weight: t });
      if (g.counts) {
        precise ??= {};
        for (const m of MUTANT_TYPES) precise[m] = (precise[m] ?? 0) + (g.counts[m] ?? 0);
      }
      if (g.boss) preciseBoss = true;
    }
  }
  if (precise) boss = preciseBoss;
  const seen = precise ?? s.lastNight;
  if (seen && threatOf(seen) > 0) {
    const total = threatOf(seen);
    for (const m of MUTANT_TYPES) mix[m] = ((seen[m] ?? 0) * MUTANTS[m].threat) / total;
  } else {
    mix.wanderer = 1;
  }
  const threat = precise ? Math.max(threatOf(precise), forecastThreat) : Math.max(prior, forecastThreat);
  return { night, threat, mix, boss, directions };
}

/** Where the garrison waits for the night: toward the heaviest forecast directions. */
export function rallyPoint(game: Game, est: ThreatEstimate, distanceFromCore: number): Point {
  const core = coreOf(game);
  let vx = 0;
  let vy = 0;
  for (const d of est.directions) {
    const v = directionVector(d.direction);
    vx += v.x * d.weight;
    vy += v.y * d.weight;
  }
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len < 1e-6) return { x: core.x, y: core.y + core.size / 2 + 1.5 };
  return { x: core.x + (vx / len) * distanceFromCore, y: core.y + (vy / len) * distanceFromCore };
}
