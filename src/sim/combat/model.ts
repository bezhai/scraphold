/**
 * Combat/night-owned parts of the state model. Owner: Task 3.
 * Task 3 may extend these shapes; fields marked (UI) are read by the client, keep their meaning.
 */
import type { NightType } from '../data/calendar';
import type { MutantType, PromotionId } from '../data/combat';
import type { Direction } from '../data/map';
import type { EntityId } from '../state';

/** Weapon state of anything that attacks: soldiers, mutants, towers. */
export interface AttackState {
  /** Current target (0 = none). Ids may dangle after deaths: always look the entity up. */
  targetId: EntityId;
  /** Ticks until the next attack is allowed. */
  cooldown: number;
  /** Soldiers only: where to go once no enemy is engaged (null = not chosen yet). */
  post: SoldierPost | null;
}

/**
 * guard: the spot an idle soldier walks back to after chasing an enemy.
 * destination: the soldier's own goal of an attack-move toward (orderX, orderY); it resumes
 * walking there after each fight. A new attack-move to another point replaces it.
 */
export type SoldierPost = { kind: 'guard'; x: number; y: number } | { kind: 'destination'; x: number; y: number; orderX: number; orderY: number };

export interface Veterancy {
  kills: number;
  /** Chosen promotion (UI). */
  promotion: PromotionId | null;
  /** Kill threshold reached and the player has not chosen yet (UI). */
  pending: boolean;
}

/** guard: stays near home nest by day. assault: night attack toward the core. retreat: dawn return to a nest. */
export type MutantMode = 'guard' | 'assault' | 'retreat';

export interface MutantAi {
  mode: MutantMode;
  /** Nest this mutant guards or retreats to (0 = none). */
  homeNestId: EntityId;
  guardPoint: { x: number; y: number } | null;
  /** Strategic assault objective (0 = core); the tower id directs a group through its own shared flow field. */
  assaultTargetId: EntityId;
  /** Boss flag for UI and score (UI). */
  boss: boolean;
  /** Damage scaling from difficulty/boss, as a fraction added to 1. */
  damagePct: number;
}

export interface NestGrowth {
  /** Current level, grows each night and from dawn retreats (UI). */
  level: number;
  /** Strength points banked from retreating mutants toward the next extra level. */
  points: number;
}

export type ForecastSize = 'small' | 'medium' | 'large';

/** Published at dusk (UI). Precise when a watchtower stands or forecastPrecise > 0. */
export interface NightForecast {
  night: number;
  /** false in dense fog: groups is empty and precise is false, even with a watchtower. */
  directionsKnown: boolean;
  precise: boolean;
  groups: ForecastGroup[];
}

export interface ForecastGroup {
  direction: Direction;
  size: ForecastSize;
  /** Exact counts, only when precise. */
  counts: Partial<Record<MutantType, number>> | null;
  /** Whether the boss comes this way, only when precise. */
  boss: boolean | null;
}

/** The real composition of the coming night, generated at dusk from the `night` RNG stream. */
export interface NightPlan {
  night: number;
  groups: AttackGroup[];
}

export interface AttackGroup {
  baseBudget: number;
  direction: Direction;
  /** Spawn tile (a map spawn point or a tile next to the source nest). */
  tile: number;
  /** Source nest (0 = map edge). */
  nestId: EntityId;
  /** Strategic target carried through scheduled spawns; 0 = core. */
  assaultTargetId: EntityId;
  mutants: Partial<Record<MutantType, number>>;
  boss: { type: MutantType; hpPct: number } | null;
}

/** A mutant scheduled to appear during the current night. */
export interface PendingSpawn {
  tick: number;
  type: MutantType;
  tile: number;
  nestId: EntityId;
  /** Strategic target carried through scheduled spawns; 0 = core. */
  assaultTargetId: EntityId;
  hpPct: number;
  boss: boolean;
}

export interface NightState {
  broadcast: { night: number; type: NightType; text: string } | null;
  forecast: NightForecast | null;
  plan: NightPlan | null;
  pending: PendingSpawn[];
}

export interface ScoreBreakdown {
  victory: number;
  earlyDays: number;
  hive: number;
  nests: number;
  survivors: number;
  buildingsLost: number;
  multiplier: number;
  total: number;
}

export type VictoryMethod = 'survived' | 'hiveDestroyed' | 'signal';

export interface Outcome {
  status: 'playing' | 'won' | 'lost';
  reason: VictoryMethod | 'coreDestroyed' | null;
  /** Tick at which the game ended (-1 while playing). */
  endTick: number;
  /** Only victories score (UI). */
  score: ScoreBreakdown | null;
}

export function createAttackState(): AttackState {
  return { targetId: 0, cooldown: 0, post: null };
}

export function createVeterancy(): Veterancy {
  return { kills: 0, promotion: null, pending: false };
}

export function createMutantAi(mode: MutantMode, homeNestId: EntityId, boss: boolean, assaultTargetId: EntityId): MutantAi {
  return { mode, homeNestId, guardPoint: null, boss, assaultTargetId, damagePct: 0 };
}

export function createNestGrowth(): NestGrowth {
  return { level: 1, points: 0 };
}

export function createNightState(): NightState {
  return { broadcast: null, forecast: null, plan: null, pending: [] };
}

export function createOutcome(): Outcome {
  return { status: 'playing', reason: null, endTick: -1, score: null };
}
