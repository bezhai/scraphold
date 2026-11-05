/**
 * The contract between the shared bot machinery and a strategy (Task 5, v3 Task 4).
 *
 * A strategy only states wishes about macro decisions: which techs and policies, what to build next
 * and where, which army to keep, how many survivors to keep out of the army, whether to raid nests
 * and how many scouts to keep. The machinery (base.ts, army.ts, bot.ts) turns them into commands
 * every decision. Who works where and how the base is defended are left to the built-in AI
 * (sim economy/survivorAi.ts, combat/soldierAi.ts), as for a player who gives no orders.
 */
import { populationCount, type Building, type Game, type Phase, type Point } from '../../sim';
import type { PromotionId, SoldierType } from '../../sim/data/combat';
import type { BuildingType, PolicyId, ResourceAmounts, TechId } from '../../sim/data/economy';
import { createSightings, type Sightings, type ThreatEstimate } from './intel';
import type { Site, SiteRules } from './sites';
import type { Turn } from './turn';
import type { WorkplaceShares } from './workplaces';
import { coreOf, type Snapshot } from './view';

export type BuildOrder = { type: BuildingType; rules: SiteRules } | { type: BuildingType; site: Site };

export type ArmyWish = Partial<Record<SoldierType, number>>;

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
  /** Training never takes a survivor when this many or fewer are left to work (see Turn.spareSurvivors). */
  minWorkers(ctx: Context): number;
  /** Wanted share of worker slots per line (production resource, or dispatch-hub support); see workplaces.ts. */
  workplaces(ctx: Context): WorkplaceShares;
  /** Resources training leaves alone (unless the army is far behind), kept for the buildings the strategy is saving up for. */
  reserve(ctx: Context): ResourceAmounts;
  raids: RaidPlan | null;
  /** Scouts kept exploring by day. */
  scouts: number;
  promotion(unit: SoldierType): PromotionId | null;
}

/** 'garrison': left to the soldier AI, free for the next raid, mission or escort. */
export type Role = 'garrison' | 'raid' | 'scout' | 'incident';

/** What a bot remembers between decisions. */
export interface Memory {
  incidentAttempts: Set<number>;
  incidentMission: { targetId: number; unitIds: number[] } | null;
  roles: Map<number, Role>;
  sightings: Sightings;
  raid: { targetId: number; startPower: number } | null;
  scoutGoals: Map<number, Point>;
  ruinVisitor: number;
}

export function createMemory(): Memory {
  return { incidentAttempts: new Set(), incidentMission: null, roles: new Map(), sightings: createSightings(), raid: null, scoutGoals: new Map(), ruinVisitor: 0 };
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
  population: number;
  housingCap: number;
  /** Food income minus soldier upkeep, per day. */
  foodBalance: number;
  researched(tech: TechId): boolean;
  /** Active or newly selected work from this strategy's research plan. */
  researchPending: boolean;
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
    population: populationCount(game.state),
    housingCap: economy.housingCap,
    foodBalance: economy.incomePerDay.food - economy.expensePerDay.food,
    researched: (t) => economy.tech.researched.includes(t),
    researchPending: economy.tech.current !== null,
    queuedHere: new Map(),
  };
}
