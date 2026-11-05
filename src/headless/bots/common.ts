/**
 * Building blocks the strategies share (Task 5): standard site rules, housing and food checks,
 * and turning a power target plus the expected mutant mix into soldier counts.
 */
import { FOG_UNEXPLORED, edgeNightBudget, nightType } from '../../sim';
import type { MutantType, SoldierType } from '../../sim/data/combat';
import { BUILDINGS, type BuildingType } from '../../sim/data/economy';
import { TERRAIN } from '../../sim/data/map';
import { POWER } from './army';
import type { ArmyWish, BuildOrder, Context } from './strategy';

/**
 * Production buildings take the best bonus within reach of the core (and may touch a dispatch
 * hub); everything else takes the closest free spot.
 */
export function nearCore(type: BuildingType, maxDistance = 13): BuildOrder {
  if (BUILDINGS[type].production) return { type, rules: { maxDistance, touching: (t) => t === 'dispatchHub' } };
  return { type, rules: { maxDistance, score: (_x, _y, d) => -d } };
}

/** A dispatch hub where it touches the most staffed-to-be producers. */
export function hubOrder(ctx: Context): BuildOrder {
  const producers = ctx.snap.buildings.filter((b) => BUILDINGS[b.type].production !== null && b.type !== 'oilWell');
  const size = BUILDINGS.dispatchHub.size;
  /** Producers sharing an edge or a corner with a hub at (tx, ty). */
  const touched = (tx: number, ty: number) =>
    producers.filter((p) => p.tileX <= tx + size && tx <= p.tileX + p.size && p.tileY <= ty + size && ty <= p.tileY + p.size).length;
  return {
    type: 'dispatchHub',
    rules: {
      maxDistance: 14,
      touching: (t) => BUILDINGS[t].production !== null,
      score: (tx, ty, d) => touched(tx, ty) * 10 - d * 0.1,
      accept: (tx, ty) => touched(tx, ty) >= 2,
    },
  };
}

/** True when a new shack should go up: housing nearly full and none being built. */
export function needsHousing(ctx: Context, slack = 1): boolean {
  const building = ctx.snap.buildings.some((b) => b.type === 'shack' && b.construction !== null);
  return !building && ctx.population + slack >= ctx.housingCap;
}

/** Share of the expected night threat by role it calls for. */
export function threatShares(mix: Record<MutantType, number>): { armored: number; swarm: number; runners: number; ranged: number } {
  return {
    armored: mix.crawler + mix.behemoth,
    swarm: mix.wanderer + mix.runner,
    runners: mix.runner,
    ranged: mix.spitter,
  };
}

/** Counts per soldier type for `power`, split by relative weights over the unlocked types. */
export function composeArmy(ctx: Context, power: number, weights: Partial<Record<SoldierType, number>>): ArmyWish {
  const unlocked = ctx.game.modifiers.unlockedUnits;
  let total = 0;
  for (const [t, w] of Object.entries(weights) as [SoldierType, number][]) if (unlocked.has(t) && w > 0) total += w;
  const out: ArmyWish = {};
  if (total <= 0) return out;
  for (const [t, w] of Object.entries(weights) as [SoldierType, number][]) {
    if (!unlocked.has(t) || w <= 0) continue;
    out[t] = Math.round((power * (w / total)) / POWER[t]);
  }
  return out;
}

const OIL = TERRAIN.oil.code;

/** Explored oil tiles exist: an oil well can go up somewhere. */
export function knowsOil(ctx: Context): boolean {
  const { map, fog } = ctx.game.state;
  for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === OIL && fog[i] !== FOG_UNEXPLORED) return true;
  return false;
}

/** Recruit ahead of published threats; never inspect the private calendar plan. */
export function preparationThreat(ctx: Context): number {
  let threat = ctx.est.threat;
  for (const [offset, weight] of [[1, .75], [2, .5]] as const) {
    const night = ctx.day + offset;
    const type = nightType(ctx.game.state, night);
    threat = Math.max(threat, edgeNightBudget(night, ctx.game.state.options.difficulty, type) * weight);
  }
  return threat;
}
