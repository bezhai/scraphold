/**
 * Population: housing cap, the growth meter fed by food surplus (new survivor at the core),
 * soldier food upkeep once per day and the hunger flag for the next night.
 * Owner: Task 2.
 *
 * Population is everyone housed: survivors, soldiers and recruits waiting in training queues.
 * Housing only limits births; ruins and nests may still bring people beyond it.
 *
 * Growth: every tick the meter gains the projected daily food surplus (incomePerDay.food from the
 * production system earlier in the tick, minus the daily upkeep) spread over a cycle, times
 * surplusShare and (1 + growthPct). The meter does not consume food from the stockpile. A full
 * meter waits (capped at the threshold) while housing is full.
 *
 * Upkeep: at the start of dusk (UPKEEP.settlePhase) soldiers eat their daily ration from the
 * stockpile. If it is short they eat what is left and stay hungry until the next settlement, so
 * the coming night is fought hungry (Task 3 reads upkeep.hungry).
 */
import { isRemote } from '../world/remote';
import { SOLDIERS } from '../data/combat';
import { BUILDINGS, GROWTH, UPKEEP, type BuildingType } from '../data/economy';
import { emit } from '../events';
import type { Game } from '../game';
import type { Building, GameState } from '../state';
import { CYCLE_TICKS } from '../time';
import { spawnSurvivor } from '../world/entities';
import { pointBeside } from './buildings';

export function populationCount(state: GameState): number {
  let n = 0;
  for (const e of state.entities.values()) {
    if (e.kind === 'survivor' || e.kind === 'soldier') n++;
    else if (e.kind === 'building') n += e.trainQueue.length;
  }
  return n;
}

/** Housing one finished building of this type provides (core, shacks), including housingAdd; 0 for the rest. */
export function buildingHousing(game: Game, type: BuildingType): number {
  const housing = BUILDINGS[type].housing;
  return housing > 0 ? housing + game.modifiers.building[type].housingAdd : 0;
}

/** Housing of all finished buildings. */
export function housingCapacity(game: Game): number {
  let cap = 0;
  for (const e of game.state.entities.values()) if (e.kind === 'building' && e.construction === null) cap += buildingHousing(game, e.type);
  return cap;
}

/** Food all current soldiers eat per day after soldierUpkeepPct. */
export function dailyUpkeep(game: Game): number {
  let food = 0;
  for (const e of game.state.entities.values()) if (e.kind === 'soldier') food += SOLDIERS[e.type].upkeepFoodPerDay * (isRemote(game.state, e) ? Math.max(0, 1 + game.modifiers.global.remoteUpkeepPct) : 1);
  return food * Math.max(0, 1 + game.modifiers.global.soldierUpkeepPct);
}

function growthThreshold(state: GameState): number {
  return GROWTH.baseThreshold + GROWTH.thresholdPerPerson * populationCount(state);
}

function settleUpkeep(game: Game, upkeep: number): void {
  const { economy, clock } = game.state;
  const wasHungry = economy.upkeep.hungry;
  const hungry = economy.resources.food < upkeep;
  economy.resources.food = hungry ? 0 : economy.resources.food - upkeep;
  economy.upkeep = { hungry, lastSettledDay: clock.day };
  if (hungry || wasHungry) emit(game, { type: 'hunger', hungry });
}

function birth(game: Game): void {
  const at = pointBeside(game, game.state.entities.get(game.state.coreId) as Building);
  const survivor = spawnSurvivor(game, at.x, at.y);
  game.state.stats.survivorsBorn++;
  emit(game, { type: 'survivorJoined', unitId: survivor.id, source: 'growth' });
}

export function populationSystem(game: Game): void {
  const { economy, clock } = game.state;
  const upkeep = dailyUpkeep(game);
  if (clock.phase === UPKEEP.settlePhase && clock.day > economy.upkeep.lastSettledDay) settleUpkeep(game, upkeep);

  economy.expensePerDay.food = upkeep;
  economy.housingCap = housingCapacity(game);
  const growth = economy.growth;
  const surplus = economy.incomePerDay.food - upkeep;
  if (surplus > 0) growth.progress += (surplus / CYCLE_TICKS) * GROWTH.surplusShare * Math.max(0, 1 + game.modifiers.global.growthPct);
  growth.threshold = growthThreshold(game.state);
  if (growth.progress < growth.threshold) return;
  if (populationCount(game.state) >= economy.housingCap) {
    growth.progress = growth.threshold;
    return;
  }
  growth.progress -= growth.threshold;
  birth(game);
  growth.threshold = growthThreshold(game.state);
}
