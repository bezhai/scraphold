/**
 * Splitting survivors between workplaces for a bot (Task 5). A strategy states the share of the
 * workforce it wants on each line (a production resource, or `support` for dispatch hubs); idle
 * survivors join the line furthest below its share, and recruits for training leave the line
 * furthest above it. By day a worker also moves now and then from the line furthest above its
 * share to the one furthest below it, so new workplaces and changed shares get staffed even when
 * nobody is idle. Within a line the building with the best local bonus is staffed first and
 * emptied last.
 */
import { placementBonusPct, workerSlots, type Building } from '../../sim';
import { BUILDINGS, RESOURCES, type BuildingType, type Resource } from '../../sim/data/economy';
import type { Context } from './strategy';

export type Line = Resource | 'support';
export const LINES: readonly Line[] = [...RESOURCES, 'support'];
export type WorkforceShares = Partial<Record<Line, number>>;

export function lineOf(type: BuildingType): Line | null {
  if (type === 'signalTower') return null;
  const def = BUILDINGS[type];
  if (def.production) return def.production.resource;
  return def.workerSlots > 0 ? 'support' : null;
}

/** Workers inside plus survivors walking there (and those assigned this decision). */
function staffed(ctx: Context, b: Building): number {
  let n = b.workers.length + (ctx.assigned.get(b.id) ?? 0);
  for (const s of ctx.snap.survivors) if (s.insideId === 0 && s.task.type === 'work' && s.task.buildingId === b.id) n++;
  return n;
}

function freeSlots(ctx: Context, b: Building): number {
  if (b.construction !== null) return 0;
  return workerSlots(ctx.game.modifiers, b) - staffed(ctx, b);
}

/** Workers per line (inside, walking there, or assigned this decision). */
export function workersByLine(ctx: Context): Record<Line, number> {
  const out = Object.fromEntries(LINES.map((l) => [l, 0])) as Record<Line, number>;
  for (const b of ctx.snap.buildings) {
    const line = lineOf(b.type);
    if (line) out[line] += staffed(ctx, b);
  }
  return out;
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

function shareOf(shares: WorkforceShares, line: Line): number {
  let total = 0;
  for (const l of LINES) total += shares[l] ?? 0;
  return total > 0 ? (shares[line] ?? 0) / total : 0;
}

/** How far a line is below its share of `total` workers (negative: above it). */
function deficit(shares: WorkforceShares, counts: Record<Line, number>, line: Line, total: number): number {
  return shareOf(shares, line) * total - counts[line];
}

function bonus(ctx: Context, b: Building): number {
  return placementBonusPct(ctx.game, b.type, b.tileX, b.tileY);
}

/** Idle survivors (beyond promised recruits) take free worker slots, line by line. */
export function staff(ctx: Context, shares: WorkforceShares): void {
  const { turn } = ctx;
  const counts = workersByLine(ctx);
  let total = LINES.reduce((n, l) => n + counts[l], 0);
  while (turn.spareIdle > 0) {
    const open = ctx.snap.buildings.filter((b) => lineOf(b.type) !== null && freeSlots(ctx, b) > 0);
    if (open.length === 0) return;
    const lines = LINES.filter((l) => open.some((b) => lineOf(b.type) === l) && (shares[l] ?? 0) > 0);
    if (lines.length === 0) return;
    lines.sort((a, b) => deficit(shares, counts, b, total + 1) - deficit(shares, counts, a, total + 1));
    const line = lines[0] as Line;
    const b = open.filter((x) => lineOf(x.type) === line).sort((p, q) => bonus(ctx, q) - bonus(ctx, p) || p.id - q.id)[0] as Building;
    const s = turn.takeIdle(b.x, b.y);
    if (!s) return;
    turn.issue({ type: 'assignWork', unitIds: [s.id], buildingId: b.id });
    ctx.assigned.set(b.id, (ctx.assigned.get(b.id) ?? 0) + 1);
    counts[line]++;
    total++;
  }
}

/** Ticks between two worker moves (walking to the new workplace costs production). */
const REBALANCE_TICKS = 200;

/**
 * By day, with nobody idle, sends one worker out of the line furthest above its share when the
 * line furthest below it (with a free slot) gains more than the first loses; staff() gives the
 * freed survivor the open slot on the next decision.
 */
export function rebalance(ctx: Context, shares: WorkforceShares): void {
  const { memory, turn } = ctx;
  const tick = ctx.game.state.tick;
  if (ctx.phase !== 'day' || turn.spareIdle > 0 || tick - memory.rebalancedAt < REBALANCE_TICKS) return;
  const counts = workersByLine(ctx);
  const total = LINES.reduce((n, l) => n + counts[l], 0);
  const open = LINES.filter((l) => (shares[l] ?? 0) > 0 && ctx.snap.buildings.some((b) => lineOf(b.type) === l && freeSlots(ctx, b) > 0));
  if (open.length === 0) return;
  const under = open.reduce((a, b) => (deficit(shares, counts, b, total) > deficit(shares, counts, a, total) ? b : a));
  const from = expendableWorkplace(ctx, shares);
  if (!from) return;
  const over = lineOf(from.type) as Line;
  // Moving one worker lowers the squared distance to the shares only if the gap exceeds 1.
  if (over === under || deficit(shares, counts, under, total) - deficit(shares, counts, over, total) <= 1) return;
  memory.rebalancedAt = tick;
  turn.issue({ type: 'unassignWork', buildingId: from.id, count: 1 });
}

/** The workplace that can best spare a worker: the line furthest above its share. */
export function expendableWorkplace(ctx: Context, shares: WorkforceShares): Building | null {
  const counts = workersByLine(ctx);
  const total = LINES.reduce((n, l) => n + counts[l], 0);
  const manned = ctx.snap.buildings.filter((b) => lineOf(b.type) !== null && b.workers.length > 0);
  const lines = LINES.filter((l) => manned.some((b) => lineOf(b.type) === l));
  if (lines.length === 0) return null;
  lines.sort((a, b) => deficit(shares, counts, a, total) - deficit(shares, counts, b, total));
  const line = lines[0] as Line;
  return manned.filter((b) => lineOf(b.type) === line).sort((p, q) => bonus(ctx, p) - bonus(ctx, q) || q.id - p.id)[0] ?? null;
}

/** A line needs another workplace when its slots fall short of its share of the coming workforce. */
export function needsWorkplace(ctx: Context, shares: WorkforceShares, line: Line, headroom = 2): boolean {
  if ((shares[line] ?? 0) <= 0 || (line === 'research' && !ctx.researchPending)) return false;
  const counts = workersByLine(ctx);
  const workers = LINES.reduce((n, l) => n + counts[l], 0) + ctx.turn.spareIdle + headroom;
  return slotsByLine(ctx)[line] < shareOf(plannedShares(ctx, shares), line) * workers;
}

/** Stockpiles above `glut` halve a line's share, below `short` they double it (scrap and food). */
const STOCK_LIMITS: Partial<Record<Resource, { short: number; glut: number }>> = {
  scrap: { short: 40, glut: 300 },
  food: { short: 60, glut: 300 },
};

function plannedShares(ctx: Context, shares: WorkforceShares): WorkforceShares {
  return ctx.researchPending ? shares : { ...shares, research: 0 };
}

/** The strategy's shares adjusted to the stockpiles, as a player moves workers off what piles up. */
export function adjustToStock(ctx: Context, shares: WorkforceShares): WorkforceShares {
  const out: WorkforceShares = { ...plannedShares(ctx, shares) };
  const stock = ctx.game.state.economy.resources;
  for (const [r, limits] of Object.entries(STOCK_LIMITS) as [Resource, { short: number; glut: number }][]) {
    const share = out[r];
    if (share === undefined) continue;
    if (stock[r] > limits.glut) out[r] = share / 2;
    else if (stock[r] < limits.short) out[r] = share * 2;
  }
  return out;
}

/** Storm shelter uses existing workplace slots, including workers returning from repairs/errands. */
export function shelterWorkers(ctx: Context): void {
  for (const survivor of ctx.snap.survivors) {
    if (survivor.insideId !== 0 || survivor.task.type === 'work') continue;
    const distance = (b: Building) => (b.x - survivor.x) * (b.x - survivor.x) + (b.y - survivor.y) * (b.y - survivor.y);
    const building = ctx.snap.buildings.filter((b) => freeSlots(ctx, b) > 0 && (b.type !== 'researchStation' || ctx.researchPending)).sort((a, b) => distance(a) - distance(b) || a.id - b.id)[0];
    if (!building) continue;
    ctx.turn.issue({ type: 'assignWork', unitIds: [survivor.id], buildingId: building.id });
    ctx.assigned.set(building.id, (ctx.assigned.get(building.id) ?? 0) + 1);
    if (ctx.memory.ruinVisitor === survivor.id) ctx.memory.ruinVisitor = 0;
  }
}
