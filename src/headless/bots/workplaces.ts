/**
 * How many workplaces of each kind a bot builds (v3 Task 4). Who works where is the built-in
 * survivor AI's job (sim economy/survivorAi.ts): it splits the survivors evenly between the
 * production lines that have room, leaning toward stockpiles that run low, and never puts more
 * people on a line than its buildings have slots. So the slots a strategy builds per line are its
 * lever on the workforce: a strategy states the share of slots it wants per line (a production
 * resource, or `support` for dispatch hubs), and builds another workplace of a line when its slots
 * fall short of that share of the survivors.
 */
import { workerSlots } from '../../sim';
import { BUILDINGS, RESOURCES, type BuildingType, type Resource } from '../../sim/data/economy';
import type { Context } from './strategy';

export type Line = Resource | 'support';
export const LINES: readonly Line[] = [...RESOURCES, 'support'];
export type WorkplaceShares = Partial<Record<Line, number>>;

export function lineOf(type: BuildingType): Line | null {
  if (type === 'signalTower') return null;
  const def = BUILDINGS[type];
  if (def.production) return def.production.resource;
  return def.workerSlots > 0 ? 'support' : null;
}

/** Worker slots per line in finished buildings and construction sites. */
export function slotsByLine(ctx: Context): Record<Line, number> {
  const out = Object.fromEntries(LINES.map((l) => [l, 0])) as Record<Line, number>;
  for (const b of ctx.snap.buildings) {
    const line = lineOf(b.type);
    if (line) out[line] += workerSlots(ctx.game.modifiers, b);
  }
  return out;
}

/** The shares without research once the plan has nothing left to research (the survivor AI leaves research stations then). */
function plannedShares(ctx: Context, shares: WorkplaceShares): WorkplaceShares {
  return ctx.researchPending ? shares : { ...shares, research: 0 };
}

function shareOf(shares: WorkplaceShares, line: Line): number {
  let total = 0;
  for (const l of LINES) total += shares[l] ?? 0;
  return total > 0 ? (shares[line] ?? 0) / total : 0;
}

/** A line needs another workplace when its slots fall short of its share of the survivors (plus `headroom` to come). */
export function needsWorkplace(ctx: Context, shares: WorkplaceShares, line: Line, headroom = 2): boolean {
  const planned = plannedShares(ctx, shares);
  if ((planned[line] ?? 0) <= 0) return false;
  return slotsByLine(ctx)[line] < shareOf(planned, line) * (ctx.snap.survivors.length + headroom);
}
