/**
 * The contract between the shared bot machinery and a strategy (Task 5).
 *
 * A strategy only states wishes: which techs and policies, what to build next and where, which
 * army to keep, how many workers to protect, how to defend and whether to raid nests. The
 * machinery (base.ts, army.ts, bot.ts) turns them into commands every decision.
 */
import { populationCount, type Building, type Game, type Phase, type Point } from '../../sim';
import type { PromotionId, SoldierType } from '../../sim/data/combat';
import type { BuildingType, PolicyId, ResourceAmounts, TechId } from '../../sim/data/economy';
import { createSightings, type Sightings, type ThreatEstimate } from './intel';
import type { Site, SiteRules } from './sites';
import type { Turn } from './turn';
import type { WorkforceShares } from './workforce';
import { coreOf, type Snapshot } from './view';

export type BuildOrder = { type: BuildingType; rules: SiteRules } | { type: BuildingType; site: Site };

export type ArmyWish = Partial<Record<SoldierType, number>>;

export interface DefensePlan {
  /** Distance of the night rally point from the core center, toward the forecast directions. */
  rallyDistance: number;
  /** The garrison attacks visible mutants within this distance of the core center. */
  engageRadius: number;
}

export interface RaidPlan {
  fromDay: number;
  /** Soldiers that never leave the base. */
  homeGuard: number;
  /** A raid starts when the strike force's power is at least this many times the nest's strength. */
  powerRatio: number;
  /** Attack the hive from this day on with at least this much power (null: never). */
  hive: { fromDay: number; minPower: number; homeGuard: number } | null;
}

export type StrategyName = 'economy' | 'raider' | 'fortress' | 'signal';

export interface Strategy {
  name: StrategyName;
  /** Researched in this order (techs whose prerequisites are missing wait their turn). */
  research: readonly TechId[];
  /** Wanted policies, most important first; only unlocked ones in usable slots are set. */
  policies(ctx: Context): readonly PolicyId[];
  /** The next building to put up, or null. */
  build(ctx: Context): BuildOrder | null;
  /** Wanted soldiers by type (trained ones plus queued orders). */
  army(ctx: Context): ArmyWish;
  /** Training never takes survivors out of work below this many workers. */
  minWorkers(ctx: Context): number;
  /** Wanted share of the workforce per line (production resource, or dispatch-hub support). */
  workforce(ctx: Context): WorkforceShares;
  /** Resources training leaves alone (unless the army is far behind), kept for the buildings the strategy is saving up for. */
  reserve(ctx: Context): ResourceAmounts;
  /** Survivors that may repair at once, and the hp share below which a building gets repaired. */
  repairs: { crew: number; below: number };
  defense: DefensePlan;
  raids: RaidPlan | null;
  /** Scouts kept exploring by day. */
  scouts: number;
  promotion(unit: SoldierType): PromotionId | null;
}

export type Role = 'garrison' | 'raid' | 'scout' | 'incident';

/** What a bot remembers between decisions. */
export interface Memory {
  incidentAttempts: Set<number>;
  incidentMission: {targetId: number; unitIds: number[]; returning: boolean} | null;
  roles: Map<number, Role>;
  sightings: Sightings;
  raid: { targetId: number; startPower: number } | null;
  scoutGoals: Map<number, Point>;
  /** Last point the garrison was sent to and when. */
  garrisonOrder: { x: number; y: number; tick: number } | null;
  ruinVisitor: number;
  rally: Point | null;
  /** Tick of the last worker move between workplaces. */
  rebalancedAt: number;
}

export function createMemory(): Memory {
  return { incidentAttempts: new Set(), incidentMission: null, roles: new Map(), sightings: createSightings(), raid: null, scoutGoals: new Map(), garrisonOrder: null, ruinVisitor: 0, rally: null, rebalancedAt: -Infinity };
}

/** Everything a strategy looks at in one decision. */
export interface Context {
  game: Game;
  snap: Snapshot;
  turn: Turn;
  memory: Memory;
  est: ThreatEstimate;
  core: Building;
  day: number;
  phase: Phase;
  /** Buildings of a type, construction sites included. */
  count(type: BuildingType): number;
  /** Finished buildings of a type. */
  done(type: BuildingType): number;
  /** Soldiers of a type (all types when omitted), queued orders included. */
  soldiers(type?: SoldierType): number;
  /** Survivors working or walking to work. */
  workers: number;
  population: number;
  housingCap: number;
  /** Food income minus soldier upkeep, per day. */
  foodBalance: number;
  researched(tech: TechId): boolean;
  /** Active or newly selected work from this strategy's research plan. */
  researchPending: boolean;
  /** Worker slots filled this decision, per building id. */
  assigned: Map<number, number>;
  /** Training orders queued this decision, per building id. */
  queuedHere: Map<number, number>;
}

export function makeContext(game: Game, snap: Snapshot, turn: Turn, memory: Memory, est: ThreatEstimate): Context {
  const counts = new Map<BuildingType, number>();
  const done = new Map<BuildingType, number>();
  const soldiers = new Map<SoldierType, number>();
  let totalSoldiers = 0;
  for (const b of snap.buildings) {
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    if (b.construction === null) done.set(b.type, (done.get(b.type) ?? 0) + 1);
    for (const o of b.trainQueue) {
      soldiers.set(o.unit, (soldiers.get(o.unit) ?? 0) + 1);
      totalSoldiers++;
    }
  }
  for (const s of snap.soldiers) {
    soldiers.set(s.type, (soldiers.get(s.type) ?? 0) + 1);
    totalSoldiers++;
  }
  const workers = snap.survivors.filter((s) => s.insideId !== 0 || s.task.type === 'work').length;
  const { economy, clock } = game.state;
  return {
    game,
    snap,
    turn,
    memory,
    est,
    core: coreOf(game),
    day: clock.day,
    phase: clock.phase,
    count: (t) => counts.get(t) ?? 0,
    done: (t) => done.get(t) ?? 0,
    soldiers: (t) => (t ? (soldiers.get(t) ?? 0) : totalSoldiers),
    workers,
    population: populationCount(game.state),
    housingCap: economy.housingCap,
    foodBalance: economy.incomePerDay.food - economy.expensePerDay.food,
    researched: (t) => economy.tech.researched.includes(t),
    researchPending: economy.tech.current !== null,
    assigned: new Map(),
    queuedHere: new Map(),
  };
}
