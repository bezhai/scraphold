/**
 * Construction sites and training queues: placing (cost, unlock, limits, then
 * world/placement.ts checkPlacement), build progress, cancel/demolish refunds, training that
 * consumes a survivor and food/scrap/fuel, spawning the soldier and sending it to the rally point.
 * Building stats (max hp from hpPct, vision once finished) are kept current here too.
 * Owner: Task 2.
 *
 * Sites build on their own at 1 tick of progress per tick x (1 + buildSpeedPct), plus
 * builderSpeedPct for each survivor helping at the site (repair task, up to maxBuilders). Their
 * hp starts at startHpPct and grows with progress; damage taken meanwhile is kept.
 *
 * Training takes its recruit when the order is queued: the nearest survivor under automatic
 * control, idle ones first (survivorAi.ts nearestAutoSurvivor), leaves the map, so the queue never
 * stalls for lack of people and the cost of an army shows at once in the worker count. Survivors
 * the player commands are never taken. Cancelling an order, or demolishing the building, gives the
 * recruit and the cost back. Only the head of a queue progresses.
 */
import { SIGNAL_TEXT } from '../data/signal';
import { signalMessage } from '../signal/signal';
import { isRemote } from '../world/remote';
import { OK, reject, type CommandHandler, type CommandResult } from '../commands';
import { SOLDIERS, SOLDIER_TYPES, type SoldierType } from '../data/combat';
import { BUILDINGS, CONSTRUCTION, TRAINING, type BuildingType } from '../data/economy';
import { emit } from '../events';
import type { Game } from '../game';
import type { Building, Survivor } from '../state';
import { secondsToTicks } from '../time';
import { addBuilding, removeEntity, spawnSoldier, spawnSurvivor } from '../world/entities';
import { moveUnitTo } from '../world/movement';
import { checkPlacement } from '../world/placement';
import { buildingById, pointBeside } from './buildings';
import { idleTask } from './model';
import { buildingCost, canAfford, pay, refund, trainingCost } from './resources';
import { nearestAutoSurvivor } from './survivorAi';
import { helpersByBuilding, onsiteWorkerCount, releaseWorkers } from './workers';

/** Whether `type` can be placed at all right now (build menu): placeable, unlocked, under its limit, affordable. */
export function checkBuildable(game: Game, type: BuildingType): CommandResult {
  const def = BUILDINGS[type];
  if (type === 'signalTower' && game.state.signal.stage === 'decoding') return reject('signalNotDecoded');
  if (def.allowedTerrain.length === 0) return reject('notPlaceable');
  if (!game.modifiers.unlockedBuildings.has(type)) return reject('locked');
  if (def.maxCount !== null) {
    let count = 0;
    for (const e of game.state.entities.values()) if (e.kind === 'building' && e.type === type) count++;
    if (count >= def.maxCount) return reject('limitReached');
  }
  if (!canAfford(game.state.economy.resources, buildingCost(game.modifiers, type))) return reject('insufficientResources');
  return OK;
}

/** Max hp from hpPct (current hp keeps its share), vision of a finished building. */
export function refreshBuildingStats(game: Game, b: Building): void {
  const def = BUILDINGS[b.type];
  const maxHp = def.hp * (1 + game.modifiers.building[b.type].hpPct + (isRemote(game.state, b) ? game.modifiers.global.remoteBuildingHpPct : 0));
  if (maxHp !== b.maxHp) {
    b.hp = (b.hp * maxHp) / b.maxHp;
    b.maxHp = maxHp;
  }
  if (b.construction === null) b.vision = Math.max(0, def.vision + game.modifiers.building[b.type].visionAdd);
}

function isMilitary(type: BuildingType): boolean {
  return SOLDIER_TYPES.some((s) => SOLDIERS[s].trainedAt === type);
}

function returnRecruit(game: Game, b: Building): void {
  const at = pointBeside(game, b);
  spawnSurvivor(game, at.x, at.y);
}

function advanceSite(game: Game, b: Building, helpers: number): void {
  const site = b.construction;
  if (!site) return;
  const builders = Math.min(helpers, CONSTRUCTION.maxBuilders);
  const staffed = b.type === 'signalTower' ? onsiteWorkerCount(game, b) : 1;
  const speed = game.modifiers.global.buildSpeedPct + game.modifiers.building[b.type].buildSpeedPct + (isRemote(game.state, b) ? game.modifiers.global.remoteBuildSpeedPct : 0);
  const rate = staffed * Math.max(0, 1 + speed + (b.type === 'signalTower' ? 0 : builders * CONSTRUCTION.builderSpeedPct));
  const step = Math.min(rate, site.total - site.progress);
  site.progress += step;
  b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * (1 - CONSTRUCTION.startHpPct) * step) / site.total);
  if (site.progress < site.total) return;
  b.construction = null;
  // The finished tower's crew is done: back to idle under automatic control.
  if (b.type === 'signalTower') for (const s of releaseWorkers(game, b, b.workers.length)) {
    s.task = idleTask();
    s.control = 'auto';
  }
  refreshBuildingStats(game, b);
  game.state.stats.buildingsBuilt[b.type]++;
  emit(game, { type: 'buildingCompleted', buildingId: b.id, building: b.type });
}

function finishTraining(game: Game, b: Building, unit: SoldierType): void {
  const at = pointBeside(game, b, b.rally?.x, b.rally?.y);
  const soldier = spawnSoldier(game, unit, at.x, at.y);
  if (b.rally) {
    soldier.deploymentGoal = { ...b.rally };
    soldier.order = { type: 'attackMove', x: b.rally.x, y: b.rally.y };
    moveUnitTo(game, soldier, b.rally.x, b.rally.y);
  }
  game.state.stats.soldiersTrained[unit]++;
  emit(game, { type: 'unitTrained', unitId: soldier.id, unit, buildingId: b.id });
}

function advanceTraining(game: Game, b: Building): void {
  const order = b.trainQueue[0];
  if (!order || b.construction !== null) return;
  order.progress += Math.max(0, 1 + game.modifiers.global.trainSpeedPct);
  if (order.progress < order.total) return;
  b.trainQueue.shift();
  finishTraining(game, b, order.unit);
}

export function constructionSystem(game: Game): void {
  const helpers = helpersByBuilding(game);
  const buildings: Building[] = [];
  for (const e of game.state.entities.values()) if (e.kind === 'building') buildings.push(e);
  for (const b of buildings) {
    if (b.hp <= 0) continue;
    refreshBuildingStats(game, b);
    if (b.construction) advanceSite(game, b, helpers.get(b.id) ?? 0);
    else advanceTraining(game, b);
  }
}

export const placeBuildingHandler: CommandHandler<'placeBuilding'> = {
  validate(game, cmd) {
    const buildable = checkBuildable(game, cmd.building);
    return buildable.ok ? checkPlacement(game, cmd.building, cmd.tileX, cmd.tileY) : buildable;
  },
  execute(game, cmd) {
    const paid = buildingCost(game.modifiers, cmd.building);
    pay(game.state.economy.resources, paid);
    const site = addBuilding(game, cmd.building, cmd.tileX, cmd.tileY, { complete: false });
    if (site.construction) site.construction.paid = paid;
    refreshBuildingStats(game, site);
    if (site.type === 'signalTower' && site.construction) {
      const signal = game.state.signal;
      signal.buildingId = site.id; signal.constructionStaffed = false; signal.unmannedSinceTick = -1;
      site.construction.progress = site.construction.total * signal.retainedProgress;
      site.hp = site.maxHp * (CONSTRUCTION.startHpPct + (1 - CONSTRUCTION.startHpPct) * signal.retainedProgress);
      signal.retainedProgress = 0;
      signalMessage(game, SIGNAL_TEXT.build);
    }
    emit(game, { type: 'buildingPlaced', buildingId: site.id, building: cmd.building });
  },
};

export const cancelConstructionHandler: CommandHandler<'cancelConstruction'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    return b.construction ? OK : reject('notUnderConstruction');
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    refund(game.state.economy.resources, b.construction?.paid ?? {}, CONSTRUCTION.cancelRefund);
    removeEntity(game, b);
  },
};

export const demolishHandler: CommandHandler<'demolish'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    if (b.id === game.state.coreId) return reject('cannotDemolishCore');
    return b.construction ? reject('underConstruction') : OK;
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    const { resources } = game.state.economy;
    refund(resources, BUILDINGS[b.type].cost, CONSTRUCTION.demolishRefund);
    for (const order of b.trainQueue) {
      refund(resources, order.paid, 1);
      returnRecruit(game, b);
    }
    b.trainQueue = [];
    removeEntity(game, b);
  },
};

export const trainHandler: CommandHandler<'train'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    if (!isMilitary(b.type)) return reject('notMilitary');
    if (SOLDIERS[cmd.unit].trainedAt !== b.type) return reject('notTrainable');
    if (b.construction) return reject('underConstruction');
    if (!game.modifiers.unlockedUnits.has(cmd.unit)) return reject('locked');
    if (b.trainQueue.length >= TRAINING.queueLimit) return reject('queueFull');
    if (!canAfford(game.state.economy.resources, trainingCost(game.modifiers, cmd.unit))) return reject('insufficientResources');
    return nearestAutoSurvivor(game.state, b) ? OK : reject('noAutoSurvivor');
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    const paid = trainingCost(game.modifiers, cmd.unit);
    pay(game.state.economy.resources, paid);
    removeEntity(game, nearestAutoSurvivor(game.state, b) as Survivor);
    b.trainQueue.push({ unit: cmd.unit, progress: 0, total: Math.max(1, secondsToTicks(SOLDIERS[cmd.unit].trainSeconds)), paid });
  },
};

export const cancelTrainingHandler: CommandHandler<'cancelTraining'> = {
  validate(game, cmd) {
    const b = buildingById(game, cmd.buildingId);
    if (!b) return reject('unknownTarget');
    return Number.isInteger(cmd.index) && cmd.index >= 0 && cmd.index < b.trainQueue.length ? OK : reject('invalidIndex');
  },
  execute(game, cmd) {
    const b = buildingById(game, cmd.buildingId) as Building;
    const [order] = b.trainQueue.splice(cmd.index, 1);
    if (order) refund(game.state.economy.resources, order.paid, 1);
    returnRecruit(game, b);
  },
};
