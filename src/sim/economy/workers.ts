/**
 * Survivor work: walking to assigned buildings, entering as workers (slot limits), repairing
 * damaged buildings and helping construction sites (paying scrap per hp), leaving buildings.
 * Owner: Task 2. Uses world/entities.ts enterBuilding/exitBuilding and world/movement.ts moveUnitTo.
 *
 * Survivors on a task walk to the open tile beside the building nearest to them. Once within
 * WORK_REACH a worker enters if a slot is free (otherwise goes idle); a repairer on a finished
 * building restores hp each tick for scrap, as far as the stockpile pays, until it is intact; a
 * repairer on a construction site helps build for free (construction.ts counts helpers). Targets
 * that vanish or cannot be reached turn the survivor idle. Slots count survivors on their way.
 */
import { OK, reject, type CommandHandler } from '../commands';
import { BUILDINGS, REPAIR } from '../data/economy';
import type { Game } from '../game';
import type { Modifiers } from '../modifiers';
import type { Building, EntityId, Survivor } from '../state';
import { TICKS_PER_SECOND } from '../time';
import { enterBuilding, exitBuilding } from '../world/entities';
import { moveUnitTo, stopUnit } from '../world/movement';
import { ownUnits } from '../world/orders';
import { edgeDistance, isOnMap } from '../world/spatial';
import { buildingById, pointBeside } from './buildings';
import { idleTask } from './model';

/** A survivor whose center is this close to a footprint can work, repair or build there. */
export const WORK_REACH = 1.2;

export function isAtBuilding(s: Survivor, b: Building): boolean {
  return edgeDistance(b, s.x, s.y) <= WORK_REACH;
}

/** Worker slots of a building type after workerSlotsAdd (0 for buildings without workplaces). */
export function workerSlots(modifiers: Modifiers, b: Pick<Building, 'type'>): number {
  const base = BUILDINGS[b.type].workerSlots;
  return base > 0 ? base + modifiers.building[b.type].workerSlotsAdd : 0;
}

/** Living workers physically inside a building, capped by its current workstation capacity. */
export function onsiteWorkers(game: Game, b: Building): Survivor[] {
  return b.workers.map(id => game.state.entities.get(id)).filter((e): e is Survivor => e?.kind === 'survivor' && e.hp > 0 && e.insideId === b.id).slice(0, workerSlots(game.modifiers, b));
}
export function onsiteWorkerCount(game: Game, b: Building): number { return onsiteWorkers(game, b).length; }

/** Survivors on a repair task standing at their target, per target building id. */
export function helpersByBuilding(game: Game): Map<EntityId, number> {
  const out = new Map<EntityId, number>();
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'survivor' || e.task.type !== 'repair' || !isOnMap(e)) continue;
    const b = game.state.entities.get(e.task.buildingId);
    if (b && b.kind === 'building' && isAtBuilding(e, b)) out.set(b.id, (out.get(b.id) ?? 0) + 1);
  }
  return out;
}

function survivorsOf(game: Game, ids: readonly EntityId[]): Survivor[] {
  return ownUnits(game, ids).filter((u): u is Survivor => u.kind === 'survivor');
}

function heading(s: Survivor, taskType: 'work' | 'repair', b: Building): boolean {
  return s.task.type === taskType && s.task.buildingId === b.id;
}

/** Workers inside plus survivors on their way to work there. */
function reservedSlots(game: Game, b: Building): number {
  let n = b.workers.length;
  for (const e of game.state.entities.values()) if (e.kind === 'survivor' && e.insideId === 0 && heading(e, 'work', b)) n++;
  return n;
}

function goIdle(s: Survivor): void {
  s.task = idleTask();
  stopUnit(s);
}

/** Walks to the open tile beside `b` nearest to the survivor; goes idle if `b` cannot be reached. */
function walkTo(game: Game, s: Survivor, b: Building): void {
  const goal = pointBeside(game, b, s.x, s.y);
  moveUnitTo(game, s, goal.x, goal.y);
  const end = s.motion.goal ?? s;
  if (edgeDistance(b, end.x, end.y) > WORK_REACH) goIdle(s);
}

function needsRepair(b: Building): boolean {
  return b.construction !== null || b.hp < b.maxHp;
}

function repairStep(game: Game, b: Building): void {
  const { global } = game.modifiers;
  const { resources } = game.state.economy;
  const scrapPerHp = REPAIR.scrapPerHp * Math.max(0, 1 + global.repairCostPct);
  const rate = (REPAIR.hpPerSecondPerWorker * Math.max(0, 1 + global.repairSpeedPct)) / TICKS_PER_SECOND;
  const affordable = scrapPerHp > 0 ? Math.max(0, resources.scrap) / scrapPerHp : Infinity;
  const hp = Math.min(rate, b.maxHp - b.hp, affordable);
  if (hp <= 0) return;
  b.hp += hp;
  resources.scrap -= hp * scrapPerHp;
  game.state.stats.hpRepaired += hp;
}

function doWork(game: Game, s: Survivor, b: Building): void {
  if ((b.construction !== null && b.type !== 'signalTower') || (b.type === 'signalTower' && b.construction === null)) return goIdle(s);
  if (!isAtBuilding(s, b)) {
    if (s.motion.mode === 'stand') walkTo(game, s, b);
    return;
  }
  if (b.workers.length < workerSlots(game.modifiers, b)) enterBuilding(game, s, b);
  else goIdle(s);
}

function doRepair(game: Game, s: Survivor, b: Building): void {
  if (!needsRepair(b)) return goIdle(s);
  if (!isAtBuilding(s, b)) {
    if (s.motion.mode === 'stand') walkTo(game, s, b);
    return;
  }
  if (b.construction !== null) return;
  repairStep(game, b);
  if (!needsRepair(b)) goIdle(s);
}

export function workerSystem(game: Game): void {
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'survivor' || e.task.type === 'idle' || !isOnMap(e)) continue;
    const b = buildingById(game, e.task.buildingId);
    if (!b) goIdle(e);
    else if (e.task.type === 'work') doWork(game, e, b);
    else doRepair(game, e, b);
  }
}

/** Selected survivors not already heading to work at `b`, nearest first. */
function newWorkers(game: Game, ids: readonly EntityId[], b: Building): Survivor[] {
  const dist = (s: Survivor) => (s.x - b.x) * (s.x - b.x) + (s.y - b.y) * (s.y - b.y);
  return survivorsOf(game, ids)
    .filter((s) => !heading(s, 'work', b))
    .sort((p, q) => dist(p) - dist(q) || p.id - q.id);
}

export const assignWorkHandler: CommandHandler<'assignWork'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    if (b.type === 'signalTower' && b.construction === null) return reject('signalTowerComplete');
    if (workerSlots(game.modifiers, b) === 0) return reject('notWorkplace');
    if (b.construction && b.type !== 'signalTower') return reject('underConstruction');
    if (survivorsOf(game, cmd.unitIds).length === 0) return reject('noValidUnits');
    const fresh = newWorkers(game, cmd.unitIds, b);
    if (fresh.length > 0 && reservedSlots(game, b) >= workerSlots(game.modifiers, b)) return reject('buildingFull');
    return OK;
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    const free = workerSlots(game.modifiers, b) - reservedSlots(game, b);
    for (const s of newWorkers(game, cmd.unitIds, b).slice(0, free)) {
      s.task = { type: 'work', buildingId: b.id };
      walkTo(game, s, b);
    }
  },
};

/** Both manual unassignment and a completed relay return workers to idle on the map. */
export function releaseWorkers(game: Game, b: Building, count: number): void {
  const leaving = b.workers.slice(Math.max(0, b.workers.length - Math.floor(count)));
  for (const id of leaving) {
    const s = game.state.entities.get(id);
    if (!s || s.kind !== 'survivor') continue;
    exitBuilding(game, s);
    goIdle(s);
  }
}

export const unassignWorkHandler: CommandHandler<'unassignWork'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    if (b.workers.length === 0) return reject('noWorkers');
    if (b.workers.slice(Math.max(0, b.workers.length - Math.floor(cmd.count))).some(id => game.state.incidents.isolatedSurvivors.some(s => s.unitId === id))) return reject('workersIsolated');
    return cmd.count >= 1 ? OK : reject('noValidUnits');
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    releaseWorkers(game, b, cmd.count);
  },
};

export const repairHandler: CommandHandler<'repair'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    if (!needsRepair(b)) return reject('notDamaged');
    return survivorsOf(game, cmd.unitIds).length > 0 ? OK : reject('noValidUnits');
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    for (const s of survivorsOf(game, cmd.unitIds)) {
      s.task = { type: 'repair', buildingId: b.id };
      walkTo(game, s, b);
    }
  },
};
