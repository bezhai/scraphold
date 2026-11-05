/**
 * Event stream from the simulation to the client (alerts, effects, notifications) and bots.
 * Owner: Task 1 / main session (shared contract). Events are output only: no system may read them
 * back to make decisions, and they are not part of the hashed state.
 *
 * The client calls drainEvents(game) once per frame. Each event lists the task that emits it.
 */
import type { Outcome } from './combat/model';
import type { MutantType, SoldierType, DamageType } from './data/combat';
import type { BuildingType, ResourceAmounts, RuinReward, TechId } from './data/economy';
import type { EntityId, EntityKind, Faction } from './state';
import type { Phase } from './time';
import type { Game } from './game';

export type GameEvent =
  | { type: 'incidentRaised'; incidentId: number }
  | { type: 'incidentResolved'; incidentId: number; choiceId: string; automatic: boolean; feedback: string | null }
  | { type: 'incidentTargetResolved'; targetId: number; status: 'completed' | 'expired'; text: string }
  | { type: 'ruinFragment'; index: number; text: string }
  | { type: 'signalMessage'; text: string }
  /** Task 1 clock: emitted on the first tick of every phase (including day 1). */
  | { type: 'phaseChanged'; day: number; phase: Phase }
  /** Task 3: dusk forecast for `night` is in state.night.forecast. */
  | { type: 'forecastReady'; night: number }
  /** Task 3: a player entity was hit; throttled per entity (ALERT_THROTTLE_SECONDS). */
  | { type: 'underAttack'; entityId: EntityId; x: number; y: number; core: boolean }
  /** Task 1 cleanup: an entity was removed because its hp reached 0. */
  | {
      type: 'died';
      entityId: EntityId;
      kind: EntityKind;
      subtype: SoldierType | MutantType | BuildingType | 'survivor' | 'nest' | 'hive';
      faction: Faction;
      x: number;
      y: number;
    }
  /** Task 3: an attack was fired (tracer / muzzle effect). */
  | { type: 'shot'; sourceId: EntityId; targetId: EntityId; fromX: number; fromY: number; toX: number; toY: number; damageType: DamageType }
  /** Task 3: area damage (grenade, acid, boomer, boss smash). */
  | { type: 'explosion'; x: number; y: number; radius: number; damageType: DamageType }
  /** Task 2 */
  | { type: 'buildingPlaced'; buildingId: EntityId; building: BuildingType }
  | { type: 'buildingCompleted'; buildingId: EntityId; building: BuildingType }
  | { type: 'unitTrained'; unitId: EntityId; unit: SoldierType; buildingId: EntityId }
  | { type: 'survivorJoined'; unitId: EntityId; source: 'growth' | 'ruin' | 'nest' | 'incident' }
  | { type: 'researchCompleted'; tech: TechId }
  | { type: 'inspiration'; tech: TechId }
  | { type: 'ruinExplored'; ruinId: number; tile: number; reward: RuinReward; feedback: string | null }
  | { type: 'hunger'; hungry: boolean }
  /** Task 1 fog: a nest or the hive became visible for the first time. */
  | { type: 'nestDiscovered'; nestId: EntityId; isHive: boolean }
  /** Task 3 */
  | { type: 'nestLevelUp'; nestId: EntityId; level: number }
  /** Task 3. nestsLeft: ordinary nests still standing right after this one fell (the hive shield's count). */
  | { type: 'nestDestroyed'; nestId: EntityId; isHive: boolean; nestsLeft: number; reward: ResourceAmounts; survivors: number }
  | { type: 'promotionReady'; unitId: EntityId }
  | { type: 'gameOver'; status: 'won' | 'lost'; reason: NonNullable<Outcome['reason']> };

export type GameEventType = GameEvent['type'];

/** Appends an event to the game's outbox. */
export function emit(game: Game, event: GameEvent): void {
  game.events.push(event);
}

/** Returns and clears all events emitted since the last call. */
export function drainEvents(game: Game): GameEvent[] {
  return game.events.splice(0, game.events.length);
}
