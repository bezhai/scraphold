/**
 * Running the base for a bot (Task 5): research, policies, construction, training, repairs and
 * ruin visits (staffing is in workforce.ts). The strategy (strategy.ts) decides what it wants; this file turns the
 * wishes into valid commands through the Turn's bookkeeping.
 */
import { buildingCost, trainingCost, usablePolicySlots, validateCommand, type Building } from '../../sim';
import { SOLDIERS, SOLDIER_TYPES, type SoldierType } from '../../sim/data/combat';
import { TECHS, TRAINING } from '../../sim/data/economy';
import { findSite } from './sites';
import type { Context, Strategy } from './strategy';
import { distance, knownRuins, ruinPoint } from './view';
import { adjustToStock, expendableWorkplace } from './workforce';

export function chooseResearch(ctx: Context, strategy: Strategy): void {
  const { tech } = ctx.game.state.economy;
  if (tech.current !== null) return;
  for (const t of strategy.research) {
    if (tech.researched.includes(t)) continue;
    if (!TECHS[t].requires.every((r) => tech.researched.includes(r))) continue;
    ctx.researchPending = true;
    ctx.turn.issue({ type: 'setResearch', tech: t });
    return;
  }
}

/** Release finished research staffing before another decision reallocates these survivors. */
export function releaseResearchers(ctx: Context): boolean {
  if (ctx.researchPending) return false;
  let released = false;
  const stations = new Set(ctx.snap.buildings.filter(b => b.type === 'researchStation').map(b => b.id));
  for (const building of ctx.snap.buildings) {
    if (!stations.has(building.id) || building.workers.length === 0) continue;
    const command = { type: 'unassignWork' as const, buildingId: building.id, count: building.workers.length };
    if (validateCommand(ctx.game, command).ok) {
      ctx.turn.issue(command);
      released = true;
    }
  }
  const incoming = ctx.snap.survivors.filter(s => s.insideId === 0 && s.task.type === 'work' && stations.has(s.task.buildingId));
  if (incoming.length) {
    const command = { type: 'stop' as const, unitIds: incoming.map(s => s.id) };
    if (validateCommand(ctx.game, command).ok) {
      ctx.turn.issue(command);
      released = true;
    }
  }
  return released;
}

export function choosePolicies(ctx: Context, strategy: Strategy): void {
  const { game, turn } = ctx;
  if (game.state.clock.phase === 'night') return;
  const wanted = strategy.policies(ctx).filter((p) => game.modifiers.unlockedPolicies.has(p));
  const slots = game.state.economy.policies.slots;
  const usable = usablePolicySlots(game.modifiers);
  const target = wanted.slice(0, usable);
  // Empty slots that hold something unwanted first, so a card can move between slots.
  for (let k = 0; k < usable; k++) {
    const p = slots[k] ?? null;
    if (p !== null && !target.includes(p)) turn.issue({ type: 'setPolicy', slot: k, policy: null });
  }
  const placed = new Set(slots.filter((p, k) => p !== null && k < usable && target.includes(p)));
  let k = 0;
  for (const p of target) {
    if (placed.has(p)) continue;
    while (k < usable && slots[k] !== null && target.includes(slots[k] as never)) k++;
    if (k >= usable) break;
    turn.issue({ type: 'setPolicy', slot: k, policy: p });
    k++;
  }
}

export function construct(ctx: Context, strategy: Strategy): void {
  const { game, turn } = ctx;
  const order = strategy.build(ctx);
  if (!order || (order.type === 'researchStation' && !ctx.researchPending)) return;
  if (!game.modifiers.unlockedBuildings.has(order.type)) return;
  const cost = buildingCost(game.modifiers, order.type);
  if (!turn.canAfford(cost)) return;
  const site = 'site' in order ? order.site : findSite(game, order.type, order.rules);
  if (!site) return;
  if (!validateCommand(game, { type: 'placeBuilding', building: order.type, tileX: site.tileX, tileY: site.tileY }).ok) return;
  turn.place(order.type, site.tileX, site.tileY);
}

/** Missing share of the wanted army above which training goes before construction. */
const BEHIND_SHARE = 0.5;

/** The army is missing more than BEHIND_SHARE of the soldiers the strategy wants. */
export function armyBehind(ctx: Context, strategy: Strategy): boolean {
  const want = strategy.army(ctx);
  let wanted = 0;
  let missing = 0;
  for (const t of SOLDIER_TYPES) {
    const w = want[t] ?? 0;
    wanted += w;
    missing += Math.max(0, w - ctx.soldiers(t));
  }
  return wanted > 0 && missing / wanted > BEHIND_SHARE;
}

function queued(ctx: Context, unit: SoldierType): number {
  let n = 0;
  for (const b of ctx.snap.buildings) for (const o of b.trainQueue) if (o.unit === unit) n++;
  return n;
}

/**
 * Trains toward the strategy's army, largest relative shortfall first. Recruits come from idle
 * survivors, then from workers while the workforce stays above strategy.minWorkers.
 */
export function train(ctx: Context, strategy: Strategy): void {
  const { game, turn, snap } = ctx;
  const want = strategy.army(ctx);
  const have = new Map<SoldierType, number>();
  for (const t of SOLDIER_TYPES) have.set(t, queued(ctx, t));
  for (const s of snap.soldiers) have.set(s.type, (have.get(s.type) ?? 0) + 1);
  let workforce = ctx.workers;
  const minWorkers = strategy.minWorkers(ctx);
  // Never spend the food the soldiers eat at the next dusk (hungry soldiers fight much worse),
  // nor what the strategy saves for its next buildings unless the army is far behind its wish.
  const saved = armyBehind(ctx, strategy) ? {} : strategy.reserve(ctx);
  let upkeepReserve = game.state.economy.expensePerDay.food * 1.2 + 4;
  for (let round = 0; round < 6; round++) {
    // New survivors must first replace missing workers; otherwise repeated recruitment
    // can keep a damaged economy permanently below the strategy's workforce floor.
    if (workforce + turn.spareIdle <= minWorkers) return;
    let best: SoldierType | null = null;
    let bestGap = 0;
    for (const t of SOLDIER_TYPES) {
      const w = want[t] ?? 0;
      const gap = (w - (have.get(t) ?? 0)) / Math.max(1, w);
      if (w > (have.get(t) ?? 0) && gap > bestGap && game.modifiers.unlockedUnits.has(t)) {
        best = t;
        bestGap = gap;
      }
    }
    if (!best) return;
    const at = snap.buildings
      .filter((b) => b.type === SOLDIERS[best].trainedAt && b.construction === null && b.trainQueue.length + (ctx.queuedHere.get(b.id) ?? 0) < Math.min(2, TRAINING.queueLimit))
      .sort((a, b) => a.trainQueue.length - b.trainQueue.length || a.id - b.id)[0];
    if (!at || !turn.canAfford(trainingCost(game.modifiers, best), { ...saved, food: upkeepReserve + (saved.food ?? 0) })) {
      have.set(best, want[best] ?? 0);
      continue;
    }
    let freeWorker: Building | null = null;
    if (turn.spareIdle <= 0) {
      if (workforce <= minWorkers) return;
      freeWorker = expendableWorkplace(ctx, adjustToStock(ctx, strategy.workforce(ctx)));
      if (!freeWorker) return;
      workforce--;
    }
    turn.train(at, best, freeWorker);
    upkeepReserve += SOLDIERS[best].upkeepFoodPerDay;
    ctx.queuedHere.set(at.id, (ctx.queuedHere.get(at.id) ?? 0) + 1);
    have.set(best, (have.get(best) ?? 0) + 1);
  }
}

/** Survivors from the Turn (idle first) patch damaged buildings by day; repairers already on the job keep going. */
export function repair(ctx: Context, maxRepairers: number, minHpShare: number): void {
  const { turn, snap, game } = ctx;
  if (game.state.economy.resources.scrap < 20) return;
  let busy = snap.survivors.filter((s) => s.task.type === 'repair').length;
  const damaged = snap.buildings.filter((b) => b.construction === null && b.hp < b.maxHp * minHpShare).sort((a, b) => Number(b.type === 'core') - Number(a.type === 'core') || Number(a.type === 'barricade') - Number(b.type === 'barricade') || a.hp / a.maxHp - b.hp / b.maxHp);
  for (const b of damaged) {
    if (busy >= maxRepairers) return;
    if (snap.survivors.some((s) => s.task.type === 'repair' && s.task.buildingId === b.id)) continue;
    const s = turn.takeSurvivor(b.x, b.y);
    if (!s) return;
    turn.issue({ type: 'repair', unitIds: [s.id], buildingId: b.id });
    busy++;
  }
}

/** Sends a survivor from the Turn (idle first) to the nearest known ruin within reach, by day, away from known nests. */
export function visitRuins(ctx: Context, maxDistance: number): void {
  const { game, turn, snap, memory } = ctx;
  if (game.state.clock.phase !== 'day') return;
  const visitor = snap.survivors.find((s) => s.id === memory.ruinVisitor);
  if (visitor && visitor.task.type === 'idle' && visitor.motion.mode === 'path') return;
  memory.ruinVisitor = 0;
  const target = knownRuins(game)
    .map((r) => ruinPoint(game, r))
    .filter((p) => distance(p, ctx.core) <= maxDistance && snap.discoveredNests.every((n) => distance(n, p) > 10))
    .sort((a, b) => distance(a, ctx.core) - distance(b, ctx.core))[0];
  if (!target) return;
  const s = turn.takeSurvivor(target.x, target.y);
  if (!s) return;
  memory.ruinVisitor = s.id;
  turn.issue({ type: 'move', unitIds: [s.id], x: target.x, y: target.y });
}
