/**
 * Economy-owned parts of the state model. Owner: Task 2.
 * Task 2 may extend these shapes; fields marked (UI) are read by the client, keep their meaning.
 */
import type { SoldierType } from '../data/combat';
import { RESOURCES, START, TECH_IDS, type PolicyId, type Resource, type ResourceAmounts, type TechId } from '../data/economy';
import { zeroRecord } from '../record';
import type { EntityId } from '../state';

/** What a survivor is doing. Movement itself lives in Survivor.motion. */
export type SurvivorTask =
  | { type: 'idle' }
  /** Walking to (or, when Survivor.insideId is set, working inside) a production/support building. */
  | { type: 'work'; buildingId: EntityId }
  /** Repairing a damaged building or helping a construction site. */
  | { type: 'repair'; buildingId: EntityId };

/** Construction site progress, in ticks. Building.construction is null once complete. */
export interface Construction {
  progress: number;
  total: number;
  /** What placeBuilding charged, refunded on cancel. Empty on sites made directly with addBuilding. */
  paid: ResourceAmounts;
}

/**
 * One entry of a military building's training queue, progress in ticks. The recruit (one
 * survivor) is taken when the order is queued and given back if it is cancelled.
 */
export interface TrainOrder {
  unit: SoldierType;
  progress: number;
  total: number;
  /** Resources charged when queued, refunded in full on cancel. */
  paid: ResourceAmounts;
}

export interface TechState {
  /** Tech currently receiving research points (UI). */
  current: TechId | null;
  /** Accumulated research points per tech; kept when switching (UI). */
  progress: Record<TechId, number>;
  /** Completed techs in completion order (UI). */
  researched: TechId[];
  /** Techs whose inspiration has fired (UI). */
  inspired: TechId[];
}

export interface PolicyState {
  /** Fixed length START.maxPolicySlots; only the first (START.policySlots + modifiers.global.policySlots) are usable (UI). */
  slots: (PolicyId | null)[];
}

export interface EconomyState {
  resources: Record<Resource, number>;
  /** Projected gross production per day at the current staffing (UI). */
  incomePerDay: Record<Resource, number>;
  /** Projected spending per day: soldier food, tower fuel ... (UI). */
  expensePerDay: Record<Resource, number>;
  /** Housing capacity from the core and shacks (UI). */
  housingCap: number;
  /** Growth meter: a new survivor is born at the core when progress reaches threshold (UI). */
  growth: { progress: number; threshold: number };
  /** hungry: soldiers were not fully fed and fight weaker tonight (UI). */
  upkeep: { hungry: boolean; lastSettledDay: number };
  tech: TechState;
  policies: PolicyState;
}

export function createEconomyState(): EconomyState {
  const progress = zeroRecord(TECH_IDS);
  return {
    resources: { ...START.resources },
    incomePerDay: zeroRecord(RESOURCES),
    expensePerDay: zeroRecord(RESOURCES),
    housingCap: 0,
    growth: { progress: 0, threshold: 0 },
    upkeep: { hungry: false, lastSettledDay: 0 },
    tech: { current: null, progress, researched: [], inspired: [] },
    policies: { slots: Array.from({ length: START.maxPolicySlots }, () => null) },
  };
}

export function idleTask(): SurvivorTask {
  return { type: 'idle' };
}
