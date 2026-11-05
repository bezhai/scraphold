/**
 * Entity creation and removal primitives. Owner: Task 1.
 *
 * These apply no game rules (no costs, no unlock checks): Tasks 2/3 call them after validating.
 * Stats come from the data tables at their base values; owners of modifiers (techs, promotions,
 * hunger, difficulty) adjust the entity fields afterwards.
 * Anything that changes structure occupancy goes through here so state.navVersion stays correct.
 */
import { createAttackState, createMutantAi, createNestGrowth, createVeterancy, type MutantMode } from '../combat/model';
import { removeSignalTower } from '../signal/signal';
import { HIVE, nestMaxHp, MUTANTS, NEST, SOLDIERS, type MutantType, type SoldierType } from '../data/combat';
import { BUILDINGS, CONSTRUCTION, SURVIVOR, type BuildingType } from '../data/economy';
import { idleTask } from '../economy/model';
import type { Game } from '../game';
import { footprintCenter, inBounds } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import { stopUnit } from './movement';
import type { Building, Entity, EntityId, Motion, Mutant, Nest, Soldier, Structure, Survivor } from '../state';
import { secondsToTicks } from '../time';

export function createMotion(speed: number, mass: number): Motion {
  return { mode: 'stand', goal: null, path: [], pathNavVersion: -1, vx: 0, vy: 0, speed, mass, blockedBy: 0, stuckTicks: 0 };
}

function register<T extends Entity>(game: Game, entity: T): T {
  game.state.entities.set(entity.id, entity);
  return entity;
}

function newId(game: Game): EntityId {
  return game.state.nextId++;
}

export function spawnSurvivor(game: Game, x: number, y: number): Survivor {
  return register(game, {
    id: newId(game),
    kind: 'survivor',
    faction: 'player',
    x,
    y,
    radius: SURVIVOR.radius,
    hp: SURVIVOR.hp,
    maxHp: SURVIVOR.hp,
    armor: 'none',
    vision: SURVIVOR.vision,
    lastDamagedTick: -1,
    motion: createMotion(SURVIVOR.speed, SURVIVOR.mass),
    task: idleTask(),
    control: 'auto',
    insideId: 0,
  });
}

export function spawnSoldier(game: Game, type: SoldierType, x: number, y: number): Soldier {
  const def = SOLDIERS[type];
  return register(game, {
    id: newId(game),
    kind: 'soldier',
    faction: 'player',
    type,
    x,
    y,
    radius: def.radius,
    hp: def.hp,
    maxHp: def.hp,
    armor: def.armor,
    vision: def.vision,
    lastDamagedTick: -1,
    motion: createMotion(def.speed, def.mass),
    order: { type: 'idle' },
    control: 'auto',
    deploymentGoal: null,
    attack: createAttackState(),
    veterancy: createVeterancy(),
  });
}

export interface MutantSpawnOptions {
  mode: MutantMode;
  homeNestId?: EntityId;
  guardPoint?: { x: number; y: number };
  assaultTargetId?: EntityId;
  boss?: boolean;
  /** Max hp multiplier (difficulty, boss scaling). Default 1. */
  hpPct?: number;
}

export function spawnMutant(game: Game, type: MutantType, x: number, y: number, opts: MutantSpawnOptions): Mutant {
  const def = MUTANTS[type];
  const hp = def.hp * (opts.hpPct ?? 1);
  return register(game, {
    id: newId(game),
    kind: 'mutant',
    faction: 'mutant',
    type,
    x,
    y,
    radius: def.radius,
    hp,
    maxHp: hp,
    armor: def.armor,
    vision: def.vision,
    lastDamagedTick: -1,
    motion: createMotion(def.speed, def.mass),
    attack: createAttackState(),
    ai: { ...createMutantAi(opts.mode, opts.homeNestId ?? 0, opts.boss ?? false, opts.assaultTargetId ?? 0), guardPoint: opts.guardPoint ? {...opts.guardPoint} : null },
  });
}

/** Adds a building occupying size x size tiles from (tileX, tileY). Does not check placement. */
export function addBuilding(game: Game, type: BuildingType, tileX: number, tileY: number, opts: { complete: boolean }): Building {
  const def = BUILDINGS[type];
  const c = footprintCenter(tileX, tileY, def.size);
  const building = register(game, {
    id: newId(game),
    kind: 'building',
    faction: 'player',
    type,
    x: c.x,
    y: c.y,
    radius: def.size / 2,
    hp: opts.complete ? def.hp : Math.max(1, Math.round(def.hp * CONSTRUCTION.startHpPct)),
    maxHp: def.hp,
    armor: 'structure',
    vision: opts.complete ? def.vision : 1,
    lastDamagedTick: -1,
    tileX,
    tileY,
    size: def.size,
    construction: opts.complete ? null : { progress: 0, total: Math.max(1, secondsToTicks(def.buildSeconds)), paid: {} },
    workers: [],
    trainQueue: [],
    rally: null,
    attack: createAttackState(),
  });
  game.state.navVersion++;
  return building;
}

export function addNest(game: Game, tileX: number, tileY: number, isHive: boolean): Nest {
  const def = isHive ? HIVE : NEST;
  const c = footprintCenter(tileX, tileY, def.size);
  const nest = register(game, {
    id: newId(game),
    kind: 'nest',
    faction: 'mutant',
    isHive,
    x: c.x,
    y: c.y,
    radius: def.size / 2,
    hp: nestMaxHp(isHive, 1, game.state.options.difficulty),
    maxHp: nestMaxHp(isHive, 1, game.state.options.difficulty),
    armor: 'structure',
    vision: 0,
    lastDamagedTick: -1,
    tileX,
    tileY,
    size: def.size,
    discovered: false,
    growth: createNestGrowth(),
  });
  game.state.navVersion++;
  return nest;
}

/**
 * Up to `count` open tiles around a structure, ring by ring outward (up to 8 rings), each ring
 * ordered by distance to (towardX, towardY) (default: the structure center), then tile index.
 */
export function openTilesAround(game: Game, s: Structure, count: number, towardX = s.x, towardY = s.y): number[] {
  const nav = ensureNav(game);
  const out: number[] = [];
  for (let ring = 1; ring <= 8 && out.length < count; ring++) {
    const found: { i: number; d: number }[] = [];
    for (let y = s.tileY - ring; y < s.tileY + s.size + ring; y++) {
      for (let x = s.tileX - ring; x < s.tileX + s.size + ring; x++) {
        const onRing = x === s.tileX - ring || y === s.tileY - ring || x === s.tileX + s.size + ring - 1 || y === s.tileY + s.size + ring - 1;
        if (!onRing || !inBounds(nav, x, y)) continue;
        const i = y * nav.width + x;
        if (nav.blocked[i]) continue;
        const dx = x + 0.5 - towardX;
        const dy = y + 0.5 - towardY;
        found.push({ i, d: dx * dx + dy * dy });
      }
    }
    found.sort((a, b) => a.d - b.d || a.i - b.i);
    for (const f of found) if (out.length < count) out.push(f.i);
  }
  return out;
}

/** Nearest open tile around a structure, -1 if none. */
export function freeTileAround(game: Game, s: Structure, towardX = s.x, towardY = s.y): number {
  return openTilesAround(game, s, 1, towardX, towardY)[0] ?? -1;
}

/** Puts a survivor inside a building as a worker. Slot limits are the caller's rule (Task 2). */
export function enterBuilding(game: Game, survivor: Survivor, building: Building): void {
  if (survivor.insideId !== 0) exitBuilding(game, survivor);
  survivor.insideId = building.id;
  survivor.x = building.x;
  survivor.y = building.y;
  stopUnit(survivor);
  building.workers.push(survivor.id);
}

/** Takes a survivor out of its building onto the nearest open tile next to it. */
export function exitBuilding(game: Game, survivor: Survivor): void {
  const building = game.state.entities.get(survivor.insideId);
  survivor.insideId = 0;
  if (!building || building.kind !== 'building') return;
  building.workers = building.workers.filter((id) => id !== survivor.id);
  const tile = freeTileAround(game, building);
  if (tile !== -1) {
    survivor.x = (tile % game.state.map.width) + 0.5;
    survivor.y = Math.floor(tile / game.state.map.width) + 0.5;
  }
}

/**
 * Removes an entity immediately. Buildings eject their workers (who become idle); structures bump
 * the nav version. Other entities' references to the id are left dangling: always look ids up.
 */
export function removeEntity(game: Game, entity: Entity): void {
  if (entity.kind === 'building' && entity.type === 'signalTower') removeSignalTower(game, entity);
  if (entity.kind === 'building') {
    for (const id of [...entity.workers]) {
      const s = game.state.entities.get(id);
      if (s && s.kind === 'survivor') {
        exitBuilding(game, s);
        s.task = idleTask();
      }
    }
    entity.workers = [];
  }
  if (entity.kind === 'survivor' && entity.insideId !== 0) {
    const b = game.state.entities.get(entity.insideId);
    if (b && b.kind === 'building') b.workers = b.workers.filter((id) => id !== entity.id);
  }
  game.state.entities.delete(entity.id);
  if (entity.kind === 'building' || entity.kind === 'nest') game.state.navVersion++;
}

export function getEntity(game: Game, id: EntityId): Entity | undefined {
  return id === 0 ? undefined : game.state.entities.get(id);
}
