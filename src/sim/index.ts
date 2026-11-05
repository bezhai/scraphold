/**
 * Public simulation API for the browser client (Task 4) and headless runners/bots (Task 5).
 * Owner: main session.
 *
 * The client may read game.state (typed as GameView), call the functions below, and import data
 * tables (sim/data/*) and pure helpers (sim/time.ts, sim/map/grid.ts) for display. It must not
 * mutate state or call systems or world primitives directly; all changes go through commands.
 */
import type { Game } from './game';
import { hashValue } from './hash';
import type { GameState } from './state';

export { applyCommand, validateCommand } from './commandHandlers';
export { REJECT_REASON_TEXT, type Command, type CommandResult, type CommandType, type RejectReason } from './commands';
export { drainEvents, type GameEvent } from './events';
export type { Game } from './game';
export { PIPELINE, stepGame } from './pipeline';
export * from './state';
export { nightType } from './calendar/calendar';
export { weatherVisionMultiplier } from './calendar/weather';
export type { CalendarState, CalendarNight } from './calendar/model';
export type { IncidentState, PendingIncident, IncidentHistory, IncidentTarget } from './incidents/model';
export type { SignalState } from './signal/model';
export type { VictoryMethod, NightForecast } from './combat/model';
export * from './data/calendar';
export * from './data/incidents';
export * from './data/ruins';
export * from './data/signal';
export { SAVE_VERSION, serializeGame, restoreGame } from './save';
export { TICKS_PER_SECOND, TOTAL_NIGHTS, GAME_END_TICK, CYCLE_TICKS, clockAt, type ClockState, type Phase } from './time';
export { checkPlacement } from './world/placement';
export { createGame } from './world/setup';
export { isRemote } from './world/remote';
export { visionRadius } from './world/fog';
// Economy read-outs for the HUD (build menu availability, costs, bonuses, output, slots, research).
export { checkBuildable } from './economy/construction';
export { RATE_PERIOD_SECONDS, bonusTerrainTiles, buildingYieldPerDay, perDayToPerMinute, placementBonusPct, terrainBonusPct } from './economy/production';
export { buildingCost, trainingCost } from './economy/resources';
export { onsiteWorkerCount, workerSlots } from './economy/workers';
export { nearestAutoSurvivor } from './economy/survivorAi';
export { usablePolicySlots } from './economy/policies';
export { inspirationProgress } from './economy/tech';
export { buildingHousing, populationCount } from './economy/population';
// Combat read-outs for the HUD (effective weapons for range previews, veterancy threshold).
export { mutantWeapon, soldierWeapon, towerWeapon, towerWeaponOfType, type WeaponProfile } from './combat/weapons';
export { veteranThreshold } from './combat/damage';
export { hiveDamageReduction, ordinaryNestsLeft, type NestCensus } from './combat/hiveShield';
export { compassDirection } from './combat/night';

/** Hash of the canonical state: equal for equal seed + commands. */
export function hashState(game: Pick<Game, 'state'>): string {
  return hashValue(game.state);
}

export type DeepReadonly<T> = T extends Uint8Array | Int32Array | Float32Array | Float64Array
  ? T
  : T extends (infer R)[]
    ? ReadonlyArray<DeepReadonly<R>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<K, DeepReadonly<V>>
      : T extends Set<infer V>
        ? ReadonlySet<DeepReadonly<V>>
        : T extends object
          ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
          : T;

/** Read-only view of the state for the client. */
export type GameView = DeepReadonly<GameState>;

export function viewState(game: Game): GameView {
  return game.state;
}

export { nestNightThreat } from './combat/nests';
export { edgeNightBudget } from './combat/nightBudget';
