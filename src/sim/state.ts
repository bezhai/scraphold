import type { RuinKind } from './data/ruins';
/**
 * The canonical game state. Owner: Task 1 / main session (shared contract).
 *
 * Everything that defines a game lives in GameState and is plain data (objects, arrays, Map,
 * typed arrays): it is hashed for determinism tests and can be structuredClone'd. Derived caches
 * (navigation grid, flow field, spatial index, aggregated modifiers) live beside it in `Game`.
 *
 * Domain-owned sub-shapes live in economy/model.ts, combat/model.ts and the v2 calendar,
 * incidents and signal model modules. See ARCHITECTURE.md for current ownership.
 *
 * Coordinates: tile (tx, ty) covers [tx, tx+1) x [ty, ty+1); entity x/y are float tile units,
 * so a tile center is (tx + 0.5, ty + 0.5). Tile index = ty * width + tx.
 */
import type { CalendarState } from './calendar/model';
import type { IncidentState } from './incidents/model';
import type { SignalState } from './signal/model';
import type { AttackState, MutantAi, NestGrowth, NightState, Outcome, Veterancy } from './combat/model';
import { MUTANT_TYPES, SOLDIER_TYPES, type ArmorType, type Difficulty, type MutantType, type SoldierType } from './data/combat';
import { BUILDING_TYPES, RESOURCES, type BuildingType, type OriginId, type Resource, type RuinReward } from './data/economy';
import { TERRAIN_LIST, type Direction, type Terrain } from './data/map';
import type { Construction, EconomyState, SurvivorTask, TrainOrder } from './economy/model';
import { zeroRecord } from './record';
import type { RngStreams } from './rng';
import type { ClockState } from './time';

/** Positive integer, unique for the whole game, never reused. 0 means "none". */
export type EntityId = number;
export const NO_ENTITY: EntityId = 0;

export interface Point {
  x: number;
  y: number;
}

export interface GameOptions {
  /** Any string; daily seeds are the date, e.g. "2026-10-30". */
  seed: string;
  origin: OriginId;
  difficulty: Difficulty;
}

// ---------------------------------------------------------------------------------------------
// Map and fog

export interface Ruin {
  kind: RuinKind;
  id: number;
  tile: number;
  reward: RuinReward;
  explored: boolean;
}

/** Reachable border tile per compass direction, used for night attacks from the map edge. */
export interface SpawnPoint {
  direction: Direction;
  tile: number;
}

export interface RelaySite {
  tileX: number;
  tileY: number;
  size: number;
}

export interface MapState {
  width: number;
  height: number;
  /** Terrain code per tile (see data/map.ts TERRAIN_LIST). Terrain never changes after generation. */
  terrain: Uint8Array;
  /** Top-left tile of the core footprint. */
  coreTile: { x: number; y: number };
  ruins: Ruin[];
  spawnPoints: SpawnPoint[];
  /** Reserved footprint for the old relay; null in test maps without one. */
  relaySite: RelaySite | null;
}

/** Fog per tile: never seen / seen before (terrain + nests remembered) / currently visible. */
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;
export type FogValue = typeof FOG_UNEXPLORED | typeof FOG_EXPLORED | typeof FOG_VISIBLE;

// ---------------------------------------------------------------------------------------------
// Entities

export type EntityKind = 'survivor' | 'soldier' | 'mutant' | 'building' | 'nest';
export type Faction = 'player' | 'mutant';

export interface EntityBase {
  id: EntityId;
  kind: EntityKind;
  faction: Faction;
  /** Center position in tile units. */
  x: number;
  y: number;
  /** Body radius (units) or half footprint side (structures); ranges are measured edge to edge. */
  radius: number;
  hp: number;
  maxHp: number;
  armor: ArmorType;
  /** Current vision radius in tiles (player entities reveal fog). Owners keep it up to date. */
  vision: number;
  /** Last tick this entity took damage, -1 if never (alerts, UI flash). */
  lastDamagedTick: number;
}

/** Movement intent of a mobile unit, executed by the movement system (world/movement.ts). */
export interface Motion {
  /**
   * stand: no self-propelled movement (separation can still push).
   * path: follow `path` waypoints, then walk to `goal` and switch to stand.
   * flow: follow the shared flow field toward the core (mutants).
   */
  mode: 'stand' | 'path' | 'flow';
  goal: Point | null;
  /** Remaining waypoints as tile indices, next first. */
  path: number[];
  /** Nav version `path` was computed for; the movement system repaths when it changes. */
  pathNavVersion: number;
  /** Velocity applied last tick, tiles per tick (rendering facing, separation). */
  vx: number;
  vy: number;
  /** Current max speed in tiles per second. Owners apply modifiers/hunger/promotions to it. */
  speed: number;
  /** Separation weight; heavier units are pushed less. */
  mass: number;
  /** Structure blocking the next step (flow field or path), 0 = none. Mutant AI attacks it. */
  blockedBy: EntityId;
  /** Consecutive ticks with almost no progress while trying to move. */
  stuckTicks: number;
}

export interface Survivor extends EntityBase {
  kind: 'survivor';
  faction: 'player';
  motion: Motion;
  task: SurvivorTask;
  /** Building the survivor works inside; 0 = on the map. Inside survivors are not moved, seen or hit. */
  insideId: EntityId;
}

/** Player-issued order of a soldier. Task 1 sets it from commands; Task 3 executes the fighting part. */
export type SoldierOrder =
  | { type: 'idle' }
  /** Forced move: ignore enemies until arrival. */
  | { type: 'move'; x: number; y: number }
  /** Move, engaging enemies met on the way, then idle at the destination. */
  | { type: 'attackMove'; x: number; y: number }
  /** Focus fire on one target, chasing it. */
  | { type: 'attackTarget'; targetId: EntityId }
  /** Stay in place, attack anything in range, never chase. */
  | { type: 'hold' };

export interface Soldier extends EntityBase {
  kind: 'soldier';
  faction: 'player';
  type: SoldierType;
  motion: Motion;
  order: SoldierOrder;
  /** Initial rally destination; cleared on arrival or a new player order. */
  deploymentGoal: Point | null;
  attack: AttackState;
  veterancy: Veterancy;
}

export interface Mutant extends EntityBase {
  kind: 'mutant';
  faction: 'mutant';
  type: MutantType;
  motion: Motion;
  attack: AttackState;
  ai: MutantAi;
}

export interface Building extends EntityBase {
  kind: 'building';
  faction: 'player';
  type: BuildingType;
  /** Top-left footprint tile; footprint is size x size. */
  tileX: number;
  tileY: number;
  size: number;
  /** Construction site progress; null once complete. Sites block movement but do not work. */
  construction: Construction | null;
  /** Survivors working inside (their insideId is this building). */
  workers: EntityId[];
  trainQueue: TrainOrder[];
  /** Where newly trained units walk to (military buildings). */
  rally: Point | null;
  /** Tower weapon state (unused by buildings without a weapon). */
  attack: AttackState;
}

export interface Nest extends EntityBase {
  kind: 'nest';
  faction: 'mutant';
  isHive: boolean;
  tileX: number;
  tileY: number;
  size: number;
  /** Seen by the player at least once; the client keeps drawing it under explored fog. */
  discovered: boolean;
  growth: NestGrowth;
}

export type Entity = Survivor | Soldier | Mutant | Building | Nest;
export type Unit = Survivor | Soldier | Mutant;
export type Structure = Building | Nest;

// ---------------------------------------------------------------------------------------------
// Statistics: counters written by several systems, read by inspirations, score and summaries.

export interface GameStats {
  /** Mutants killed by the player, by type. (Task 3) */
  kills: Record<MutantType, number>;
  /** Of those, killed by towers. (Task 3) */
  towerKills: number;
  /** Soldiers trained, by type (origin soldiers excluded). (Task 2) */
  soldiersTrained: Record<SoldierType, number>;
  soldiersLost: number;
  survivorsLost: number;
  /** Survivors born from the growth meter. (Task 2) */
  survivorsBorn: number;
  /** Survivors gained from ruins and nests. (Task 2 / Task 3) */
  survivorsRecruited: number;
  /** Buildings completed, by type. (Task 2) */
  buildingsBuilt: Record<BuildingType, number>;
  /** Buildings destroyed by mutants (demolition excluded). (Task 3) */
  buildingsLost: number;
  /** Buildings destroyed during the current night; reset when a night starts. (Task 3) */
  buildingsLostTonight: number;
  /** Nights that ended without losing a building. (Task 3) */
  nightsWithoutBuildingLoss: number;
  nightsSurvived: number;
  ruinsExplored: number;
  /** Normal nests destroyed (hive excluded). (Task 3) */
  nestsDestroyed: number;
  hiveDestroyed: boolean;
  /** Tiles ever explored, by terrain. (Task 1 fog) */
  exploredTerrain: Record<Terrain, number>;
  hpRepaired: number;
  promotions: number;
  /** Gross resources gained from all sources. (Task 2 / Task 3) */
  resourcesGathered: Record<Resource, number>;
}

export function createStats(): GameStats {
  return {
    kills: zeroRecord(MUTANT_TYPES),
    towerKills: 0,
    soldiersTrained: zeroRecord(SOLDIER_TYPES),
    soldiersLost: 0,
    survivorsLost: 0,
    survivorsBorn: 0,
    survivorsRecruited: 0,
    buildingsBuilt: zeroRecord(BUILDING_TYPES),
    buildingsLost: 0,
    buildingsLostTonight: 0,
    nightsWithoutBuildingLoss: 0,
    nightsSurvived: 0,
    ruinsExplored: 0,
    nestsDestroyed: 0,
    hiveDestroyed: false,
    exploredTerrain: zeroRecord(TERRAIN_LIST),
    hpRepaired: 0,
    promotions: 0,
    resourcesGathered: zeroRecord(RESOURCES),
  };
}

// ---------------------------------------------------------------------------------------------
// Root

export interface GameState {
  options: GameOptions;
  /** Number of completed ticks. */
  tick: number;
  /** Clock of the tick being / last processed (clockAt(tick) before any step). */
  clock: ClockState;
  rng: RngStreams;
  nextId: number;
  /** Bumped whenever structure occupancy changes (build, destroy); navigation rebuilds lazily. */
  navVersion: number;
  map: MapState;
  /** FogValue per tile. */
  fog: Uint8Array;
  /** All entities in creation (= id) order. Entities with hp <= 0 are removed at the end of the tick. */
  entities: Map<EntityId, Entity>;
  coreId: EntityId;
  economy: EconomyState;
  night: NightState;
  calendar: CalendarState;
  incidents: IncidentState;
  signal: SignalState;
  stats: GameStats;
  outcome: Outcome;
}
