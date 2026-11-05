/**
 * Resource amount arithmetic shared by the economy handlers: costs after modifiers, paying,
 * refunding and granting. Costs are whole numbers; stockpiles are floats because production
 * accrues per tick. Owner: Task 2.
 */
import { SOLDIERS, type SoldierType } from '../data/combat';
import { BUILDINGS, RESOURCES, type BuildingType, type Resource, type ResourceAmounts } from '../data/economy';
import type { GameStats } from '../state';
import type { Modifiers } from '../modifiers';

/** amounts x (1 + pct), rounded to whole units; a pct at or below -100% makes it free. */
export function scaleAmounts(amounts: ResourceAmounts, pct: number): ResourceAmounts {
  const out: ResourceAmounts = {};
  const factor = Math.max(0, 1 + pct);
  for (const r of RESOURCES) {
    const a = amounts[r];
    if (a !== undefined) out[r] = Math.round(a * factor);
  }
  return out;
}

/** What placing a building costs right now (buildCostPct). */
export function buildingCost(modifiers: Modifiers, type: BuildingType): ResourceAmounts {
  return scaleAmounts(BUILDINGS[type].cost, modifiers.global.buildCostPct + modifiers.building[type].buildCostPct);
}

/** What queueing a soldier costs right now (trainCostPct); training also takes one survivor. */
export function trainingCost(modifiers: Modifiers, unit: SoldierType): ResourceAmounts {
  return scaleAmounts(SOLDIERS[unit].cost, modifiers.global.trainCostPct);
}

export function canAfford(resources: Record<Resource, number>, cost: ResourceAmounts): boolean {
  return RESOURCES.every((r) => resources[r] >= (cost[r] ?? 0));
}

export function pay(resources: Record<Resource, number>, cost: ResourceAmounts): void {
  for (const r of RESOURCES) resources[r] -= cost[r] ?? 0;
}

/** Gives back `share` of an amount paid earlier, rounded down. Refunds are not "gathered". */
export function refund(resources: Record<Resource, number>, paid: ResourceAmounts, share: number): void {
  for (const r of RESOURCES) resources[r] += Math.floor((paid[r] ?? 0) * share);
}

/** New resources entering the economy (production, ruins): also counted in stats.resourcesGathered. */
export function gain(resources: Record<Resource, number>, stats: GameStats, resource: Resource, amount: number): void {
  resources[resource] += amount;
  stats.resourcesGathered[resource] += amount;
}
