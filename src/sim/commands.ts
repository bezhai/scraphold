/**
 * Player commands: the only way the client (and bots) change the game. Owner: Task 1 / main session.
 *
 * Every command has a handler with two parts (see commandHandlers.ts for the table):
 * - validate(game, cmd): pure check, returns why it would be rejected. The UI uses it through
 *   validateCommand() to grey out buttons and preview placement without changing anything.
 * - execute(game, cmd): applies an already validated command.
 * Commands may be applied while the client is paused; they take effect immediately.
 *
 * Client-only actions (selection, control groups, camera, pause, game speed, jump to alert) are not
 * commands: the simulation has no wall clock, and pausing simply means not calling stepGame.
 */
import type { PromotionId, SoldierType } from './data/combat';
import type { BuildingType, PolicyId, TechId } from './data/economy';
import type { Game } from './game';
import type { EntityId } from './state';

export type Command =
  // Unit orders (Task 1 handlers; Task 3 executes the fighting behavior)
  /** Right-click ground with soldiers selected; survivors in the selection simply move. */
  | { type: 'attackMove'; unitIds: EntityId[]; x: number; y: number }
  /** Ctrl + right-click: forced move, soldiers ignore enemies on the way. Survivors: plain move. */
  | { type: 'move'; unitIds: EntityId[]; x: number; y: number }
  /** Right-click an enemy (mutant or discovered nest): focus fire. */
  | { type: 'attackTarget'; unitIds: EntityId[]; targetId: EntityId }
  | { type: 'stop'; unitIds: EntityId[] }
  /** Hold position: attack in range, never move or chase. */
  | { type: 'hold'; unitIds: EntityId[] }
  /** Rally point of a training building (Task 1 handler). */
  | { type: 'setRally'; buildingId: EntityId; x: number; y: number }
  // Survivors (Task 2)
  /** Right-click a production/support building with survivors selected. */
  | { type: 'assignWork'; unitIds: EntityId[]; buildingId: EntityId }
  /** Building panel: send `count` workers out of the building. */
  | { type: 'unassignWork'; buildingId: EntityId; count: number }
  /** Right-click a damaged building (or a construction site) with survivors selected. */
  | { type: 'repair'; unitIds: EntityId[]; buildingId: EntityId }
  // Construction and training (Task 2)
  | { type: 'placeBuilding'; building: BuildingType; tileX: number; tileY: number }
  /** Cancel a construction site (refund). */
  | { type: 'cancelConstruction'; buildingId: EntityId }
  /** Tear down a finished building (partial refund). Never the core. */
  | { type: 'demolish'; buildingId: EntityId }
  | { type: 'train'; buildingId: EntityId; unit: SoldierType }
  | { type: 'cancelTraining'; buildingId: EntityId; index: number }
  // Development (Task 2)
  /** null = stop researching. */
  | { type: 'setResearch'; tech: TechId | null }
  /** null = empty the slot. Rejected at night. */
  | { type: 'setPolicy'; slot: number; policy: PolicyId | null }
  // Veterancy (Task 3)
  | { type: 'choosePromotion'; unitId: EntityId; promotion: PromotionId }
  // Daytime incidents (v2 Task 3) and relay project (v2 Task 4).
  | { type: 'resolveIncident'; incidentId: number; choiceId: string }
  | { type: 'startSignalBroadcast' };

export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export type RejectReason =
  | 'noUndiscoveredNests' | 'incidentTargetUnavailable'
  | 'incidentNotPending' | 'unknownIncidentChoice' | 'incidentExpired' | 'insufficientSoldiers' | 'insufficientWorkers' | 'noCurrentResearch' | 'workersIsolated' | 'incidentReserved'
  | 'gameOver'
  | 'noValidUnits'
  | 'unknownTarget'
  | 'invalidTarget'
  | 'targetNotVisible'
  | 'outOfBounds'
  // placement
  | 'signalNotDecoded'
  | 'wrongRelaySite'
  | 'signalNotReady'
  | 'signalTowerComplete'
  | 'notPlaceable'
  | 'wrongTerrain'
  | 'blockedTerrain'
  | 'occupied'
  | 'unitsInTheWay'
  | 'unexplored'
  | 'limitReached'
  // resources and unlocks
  | 'insufficientResources'
  | 'locked'
  // buildings, workers, training
  | 'notWorkplace'
  | 'buildingFull'
  | 'noWorkers'
  | 'notDamaged'
  | 'underConstruction'
  | 'notUnderConstruction'
  | 'cannotDemolishCore'
  | 'notMilitary'
  | 'notTrainable'
  | 'queueFull'
  | 'noIdleSurvivor'
  | 'invalidIndex'
  // research and policies
  | 'alreadyResearched'
  | 'prerequisitesMissing'
  | 'policyNightLocked'
  | 'invalidSlot'
  | 'slotLocked'
  | 'policyAlreadySlotted'
  // veterancy
  | 'noPromotionPending'
  | 'invalidPromotion';

/** Message shown by the client for each rejection. Add the text together with a new reason. */
export const REJECT_REASON_TEXT: Record<RejectReason, string> = {
  noUndiscoveredNests: '已经没有未发现的巢穴可供交换情报',
  incidentTargetUnavailable: '目标已失效，或已没有安全的守卫出生位置',
  incidentNotPending: '该事件已经处理或尚未出现',
  unknownIncidentChoice: '该事件没有这个选项',
  incidentExpired: '事件已经到达自动结算时间',
  insufficientSoldiers: '士兵数量不足以选择该选项',
  insufficientWorkers: '在岗工人数量不足以选择该选项',
  noCurrentResearch: '当前没有正在进行的研究',
  workersIsolated: '隔离或调去维护炉心的工人尚未结束停工',
  incidentReserved: '该位置已预留给巢穴分裂目标',
  gameOver: '本局已经结束',
  noValidUnits: '没有可以执行该指令的单位',
  unknownTarget: '目标不存在',
  invalidTarget: '不能对这个目标下达该指令',
  targetNotVisible: '目标不在视野内',
  outOfBounds: '超出地图范围',
  signalNotDecoded: '须完成旧频段破译研究，并派单位到达中继站',
  wrongRelaySite: '信号塔只能修建在 K-7 中继站原址',
  signalTowerComplete: '信号塔已经建成，不再需要施工工人',
  signalNotReady: '信号塔尚未建成或已经在广播',
  notPlaceable: '该建筑不能由玩家建造',
  wrongTerrain: '地形不适合这种建筑',
  blockedTerrain: '地形不可建造',
  occupied: '位置已被占用',
  unitsInTheWay: '有单位挡住了建造位置',
  unexplored: '不能在未探索的区域建造',
  limitReached: '已达到这种建筑的数量上限',
  insufficientResources: '资源不足',
  locked: '尚未解锁',
  notWorkplace: '这座建筑没有工位',
  buildingFull: '工位已满',
  noWorkers: '这座建筑里没有工人',
  notDamaged: '建筑没有受损',
  underConstruction: '建筑尚未完工',
  notUnderConstruction: '建筑已经完工',
  cannotDemolishCore: '不能拆除据点核心',
  notMilitary: '这座建筑不能训练士兵',
  notTrainable: '这座建筑不能训练该兵种',
  queueFull: '训练队列已满',
  noIdleSurvivor: '没有空闲的幸存者可以训练',
  invalidIndex: '队列中没有这一项',
  alreadyResearched: '已经研究完成',
  prerequisitesMissing: '前置科技未完成',
  policyNightLocked: '夜里不能更换政令',
  invalidSlot: '没有这个政令卡槽',
  slotLocked: '这个政令卡槽尚未解锁',
  policyAlreadySlotted: '这张政令已经在使用中',
  noPromotionPending: '该单位没有待选的强化',
  invalidPromotion: '该单位不能选择这个强化',
};

export type CommandResult = { ok: true } | { ok: false; reason: RejectReason };

export const OK: CommandResult = { ok: true };

export function reject(reason: RejectReason): CommandResult {
  return { ok: false, reason };
}

export interface CommandHandler<T extends CommandType> {
  /** Must not modify the game. */
  validate(game: Game, cmd: CommandOf<T>): CommandResult;
  /** Called only after validate returned ok. */
  execute(game: Game, cmd: CommandOf<T>): void;
}
