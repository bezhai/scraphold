/**
 * One balance game: a bot plays a full game and the result is measured for the balance tables
 * (Task 5). Shared by the batch runner (balance.ts) and the smoke test (balance.test.ts).
 *
 * Measured beside the run summary: losses per night (soldiers, survivors and buildings lost
 * between a night's first tick and the next dawn), the final army and buildings, what was
 * trained and built, and the stockpile left at the end.
 */
import type { Difficulty, SoldierType } from '../sim/data/combat';
import { TECHS, TECH_IDS, type TechId, type BuildingType, type OriginId, type Resource } from '../sim/data/economy';
import { TICKS_PER_SECOND, TOTAL_NIGHTS } from '../sim/time';
import { createController, type BotName } from './bots';
import type { Game, GameStats } from '../sim';
import type { ScoreBreakdown } from '../sim/combat/model';
import { runHeadless, type Controller } from './run';

export interface BalanceJob {
  bot: BotName;
  seed: string;
  origin: OriginId;
  difficulty: Difficulty;
}

export interface NightLosses {
  night: number;
  soldiers: number;
  survivors: number;
  buildings: number;
}

export interface BalanceResult extends BalanceJob {
  outcome: 'won' | 'lost' | 'playing';
  reason: string | null;
  /** Day on which the game ended (TOTAL_NIGHTS + 1 = survived every night); on a loss also the night it fell. */
  endDay: number;
  endPhase: string;
  ticks: number;
  /** Game minutes at 1x speed. */
  minutes: number;
  score: number | null;
  army: Partial<Record<SoldierType, number>>;
  trained: Partial<Record<SoldierType, number>>;
  buildings: Partial<Record<BuildingType, number>>;
  built: Partial<Record<BuildingType, number>>;
  resources: Record<Resource, number>;
  gathered: Record<Resource, number>;
  survivors: number;
  nestsDestroyed: number;
  hiveDestroyed: boolean;
  nights: NightLosses[];
  rejected: Record<string, number>;
  firstSurgeNight: number;
  nightsStarted: number;
  edgeAttackNights: number[];
  researched: TechId[];
  researchCostShare: number;
  specialRuinsExplored: { supplyPod: number; warehouse: number };
  scoreParts: ScoreBreakdown | null;
  wallMs: number;
}

type LossCounters = Pick<GameStats, 'soldiersLost' | 'survivorsLost' | 'buildingsLost'>;

/** Losses per night, recorded by watching the stats from a controller wrapper. */
class NightLog {
  readonly nights: NightLosses[] = [];
  private open: { night: number; at: LossCounters } | null = null;

  watch(inner: Controller): Controller {
    return (game, events) => {
      const { clock, stats } = game.state;
      if (clock.phase === 'night' && !this.open) this.open = { night: clock.day, at: { ...stats } };
      else if (clock.phase !== 'night') this.finish(stats);
      return inner(game, events);
    };
  }

  /** Closes the night in progress (also when the game ends during it). */
  finish(stats: LossCounters): void {
    if (!this.open) return;
    const { night, at } = this.open;
    this.nights.push({
      night,
      soldiers: stats.soldiersLost - at.soldiersLost,
      survivors: stats.survivorsLost - at.survivorsLost,
      buildings: stats.buildingsLost - at.buildingsLost,
    });
    this.open = null;
  }
}

function positive<K extends string>(record: Record<K, number>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const [k, v] of Object.entries(record) as [K, number][]) if (v > 0) out[k] = v;
  return out;
}

export function playBalanceGame(job: BalanceJob): BalanceResult {
  const started = performance.now();
  const log = new NightLog();
  // The runner includes the final dawn for a complete game.
  const inner = log.watch(createController(job.bot));
  let final!: Game;
  let nextId = 1;
  let nightsStarted = 0;
  const edgeNights = new Set<number>();
  const summary = runHeadless({ ...job, days: TOTAL_NIGHTS, controller: (game, events) => {
    final = game;
    if (game.state.clock.phase === 'night') nightsStarted = game.state.clock.day;
    for (; nextId < game.state.nextId; nextId++) {
      const e = game.state.entities.get(nextId);
      if (e?.kind === 'mutant' && e.ai.mode === 'assault' && e.ai.homeNestId === 0) edgeNights.add(game.state.clock.day);
    }
    return inner(game, events);
  } });
  log.finish(summary.stats);
  const nights = log.nights;
  const r1 = (n: number) => Math.round(n);
  return {
    ...job,
    outcome: summary.outcome as BalanceResult['outcome'],
    reason: summary.reason,
    endDay: summary.clock.day,
    endPhase: summary.clock.phase,
    ticks: summary.ticks,
    minutes: Math.round((summary.ticks / TICKS_PER_SECOND / 60) * 10) / 10,
    score: summary.score,
    army: summary.units.soldiers as Partial<Record<SoldierType, number>>,
    trained: positive(summary.stats.soldiersTrained),
    buildings: summary.buildings as Partial<Record<BuildingType, number>>,
    built: positive(summary.stats.buildingsBuilt),
    resources: Object.fromEntries(Object.entries(summary.resources).map(([k, v]) => [k, r1(v)])) as Record<Resource, number>,
    gathered: Object.fromEntries(Object.entries(summary.stats.resourcesGathered).map(([k, v]) => [k, r1(v)])) as Record<Resource, number>,
    survivors: summary.units.survivors,
    nestsDestroyed: summary.stats.nestsDestroyed,
    hiveDestroyed: summary.stats.hiveDestroyed,
    nights,
    rejected: summary.commands.rejected as Record<string, number>,
    firstSurgeNight: final.calendarPlan.indexOf('surge') + 1,
    nightsStarted,
    edgeAttackNights: [...edgeNights],
    researched: [...final.state.economy.tech.researched],
    researchCostShare: final.state.economy.tech.researched.reduce((sum, id) => sum + TECHS[id].cost, 0) / TECH_IDS.reduce((sum, id) => sum + TECHS[id].cost, 0),
    specialRuinsExplored: {
      supplyPod: final.state.map.ruins.filter(r => r.kind === 'supplyPod' && r.explored).length,
      warehouse: final.state.map.ruins.filter(r => r.kind === 'warehouse' && r.explored).length,
    },
    scoreParts: final.state.outcome.score,
    wallMs: Math.round(performance.now() - started),
  };
}

/** Total losses of nights `from`..`to` (inclusive). */
export function lossesBetween(r: BalanceResult, from: number, to: number): number {
  return r.nights.filter((n) => n.night >= from && n.night <= to).reduce((sum, n) => sum + n.soldiers + n.survivors + n.buildings, 0);
}
