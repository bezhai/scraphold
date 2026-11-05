/**
 * Whether a HUD button can be used. Always derived from the simulation's validateCommand, so the
 * client never re-implements a rule; the reason text is the simulation's REJECT_REASON_TEXT.
 * Client-side reasons (no idle survivor to send) carry no command.
 */
import { REJECT_REASON_TEXT, validateCommand, type Command, type Game } from '../../sim';
import { RESOURCE_NAMES, RESOURCES, type Resource, type ResourceAmounts } from '../../sim/data/economy';

export type Availability = { ok: true; command: Command } | { ok: false; reason: string; command: Command | null };

export function availabilityOf(game: Game, command: Command): Availability {
  const r = validateCommand(game, command);
  return r.ok ? { ok: true, command } : { ok: false, reason: REJECT_REASON_TEXT[r.reason], command };
}

export function unavailable(reason: string): Availability {
  return { ok: false, reason, command: null };
}

export interface CostItem {
  resource: Resource;
  name: string;
  amount: number;
  /** Display hint only (base cost vs stock); the command validation decides. */
  affordable: boolean;
}

export function costItems(cost: ResourceAmounts, stock: Readonly<Record<Resource, number>>): CostItem[] {
  return RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map((r) => {
    const amount = cost[r] as number;
    return { resource: r, name: RESOURCE_NAMES[r], amount, affordable: stock[r] >= amount };
  });
}
