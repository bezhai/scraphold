/**
 * The selection panel: details of what is selected and the actions it offers. Every action's
 * enabled state and reason comes from validateCommand (see availability.ts).
 */
import {
  SIGNAL_STAGE_NAMES,
  buildingHousing,
  buildingYieldPerDay,
  hiveDamageReduction,
  onsiteWorkerCount,
  ordinaryNestsLeft,
  perDayToPerMinute,
  soldierWeapon,
  trainingCost,
  veteranThreshold,
  workerSlots,
  type EntityId,
  type Game,
  type GameView,
} from '../../sim';
import {
  ARMOR_TYPE_NAMES,
  DAMAGE_MULTIPLIER,
  DAMAGE_TYPES,
  DAMAGE_TYPE_NAMES,
  HIVE,
  HIVE_SHIELD,
  MUTANTS,
  NEST,
  PROMOTIONS,
  SOLDIERS,
  SOLDIER_TYPES,
  type ArmorType,
  type MutantType,
  type PromotionId,
  type SoldierType,
} from '../../sim/data/combat';
import { BUILDINGS, RESOURCES, RESOURCE_NAMES, TECHS, type BuildingType, type Resource } from '../../sim/data/economy';
import { TICKS_PER_SECOND } from '../../sim/time';
import { trainsSoldiers } from '../input/rightClick';
import { isOnMap, type BuildingView, type EntityView, type MutantView, type NestView, type SoldierView, type SurvivorView } from '../view';
import { availabilityOf, costItems, unavailable, type Availability, type CostItem } from './availability';
import { formatPercent } from './format';

export interface PromotionOption {
  id: PromotionId;
  name: string;
  description: string;
  availability: Availability;
}

export interface SoldierDetails {
  id: EntityId;
  type: SoldierType;
  name: string;
  role: string;
  description: string;
  hp: number;
  maxHp: number;
  armorName: string;
  weapon: string;
  order: string;
  kills: number;
  veteranKills: number;
  promotion: string | null;
  promotions: PromotionOption[] | null;
  hungry: boolean;
}

export interface SurvivorDetails {
  id: EntityId;
  hp: number;
  maxHp: number;
  task: string;
}

export interface GroupEntry {
  key: string;
  name: string;
  count: number;
  ids: EntityId[];
  /** Average hp fraction. */
  health: number;
}

export interface TrainOption {
  unit: SoldierType;
  name: string;
  role: string;
  /** What it is good and bad against. */
  description: string;
  cost: CostItem[];
  seconds: number;
  lockedBy: string | null;
  availability: Availability;
}

export interface QueueEntry {
  index: number;
  unit: SoldierType;
  name: string;
  progress: number;
  cancel: Availability;
}

export interface SignalDetails {
  /** The relay project's stage (SIGNAL_STAGE_NAMES): 修建中 / 可以广播 / 广播中. */
  stage: string;
  /** "广播中 · 已守住 1/3 晚" while broadcasting (shown instead of the stage), otherwise null. */
  progress: string | null;
  /** 开始广播, while the finished tower is not broadcasting yet. */
  start: Availability | null;
  /** Hover text of the start button. */
  startTip: string;
}

export interface BuildingDetails {
  id: EntityId;
  type: BuildingType;
  name: string;
  description: string;
  isCore: boolean;
  hp: number;
  maxHp: number;
  /** secondsLeft is null for the signal tower: its pace depends on the crew on site. */
  construction: { progress: number; secondsLeft: number | null } | null;
  /** Workers on site and slots, while the building takes workers (a finished workplace, the signal tower under construction). */
  workers: { count: number; slots: number } | null;
  addWorker: Availability | null;
  removeWorker: Availability | null;
  /** Repair, or help build a site (not the signal tower: only its crew builds it). */
  repair: Availability | null;
  demolish: Availability | null;
  cancelConstruction: Availability | null;
  signal: SignalDetails | null;
  training: { options: TrainOption[]; queue: QueueEntry[]; hasRally: boolean } | null;
  /** Name of the resource a production building makes. */
  production: string | null;
  /** What it yields per game minute right now: the core's floor, a production building's staffed output. */
  output: OutputLine[];
  housing: number | null;
}

export interface OutputLine {
  resource: Resource;
  name: string;
  perMinute: number;
}

export interface MutantDetails {
  id: EntityId;
  type: MutantType;
  name: string;
  description: string;
  hp: number;
  maxHp: number;
  armorName: string;
  weakness: string;
  boss: boolean;
}

export interface NestDetails {
  id: EntityId;
  name: string;
  isHive: boolean;
  level: number;
  hp: number;
  maxHp: number;
  description: string;
}

export type SelectionPanelModel =
  | { kind: 'none' }
  | { kind: 'soldier'; unit: SoldierDetails }
  | { kind: 'survivor'; unit: SurvivorDetails }
  | { kind: 'group'; entries: GroupEntry[]; total: number; soldiers: number; survivors: number }
  | { kind: 'building'; building: BuildingDetails }
  | { kind: 'mutant'; mutant: MutantDetails }
  | { kind: 'nest'; nest: NestDetails };

const ORDER_NAMES = { idle: '待命', move: '移动', attackMove: '攻击移动', attackTarget: '集火', hold: '原地坚守' } as const;

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function soldierDetails(game: Game, s: SoldierView): SoldierDetails {
  const def = SOLDIERS[s.type];
  const w = soldierWeapon(game, s);
  const rangeText = w.minRange > 0 ? `${trim(w.minRange)}–${trim(w.range)}` : trim(w.range);
  return {
    id: s.id,
    type: s.type,
    name: def.name,
    role: def.role,
    description: def.description,
    hp: Math.ceil(s.hp),
    maxHp: Math.ceil(s.maxHp),
    armorName: ARMOR_TYPE_NAMES[s.armor],
    weapon: `${DAMAGE_TYPE_NAMES[w.damageType]}伤害 · 射程 ${rangeText}`,
    order: ORDER_NAMES[s.order.type],
    kills: s.veterancy.kills,
    veteranKills: veteranThreshold(game, s),
    promotion: s.veterancy.promotion ? PROMOTIONS[s.veterancy.promotion].name : null,
    promotions: s.veterancy.pending
      ? def.promotions.map((p) => ({
          id: p,
          name: PROMOTIONS[p].name,
          description: PROMOTIONS[p].description,
          availability: availabilityOf(game, { type: 'choosePromotion', unitId: s.id, promotion: p }),
        }))
      : null,
    hungry: game.state.economy.upkeep.hungry,
  };
}

function buildingName(view: GameView, id: EntityId): string {
  const b = view.entities.get(id);
  return b && b.kind === 'building' ? BUILDINGS[b.type].name : '建筑';
}

function survivorDetails(view: GameView, s: SurvivorView): SurvivorDetails {
  let task = '空闲';
  if (s.task.type === 'work') task = s.insideId !== 0 ? `在${buildingName(view, s.task.buildingId)}工作` : `前往${buildingName(view, s.task.buildingId)}工作`;
  else if (s.task.type === 'repair') task = `维修${buildingName(view, s.task.buildingId)}`;
  return { id: s.id, hp: Math.ceil(s.hp), maxHp: Math.ceil(s.maxHp), task };
}

function groupEntries(units: readonly (SoldierView | SurvivorView)[]): GroupEntry[] {
  const keys = [...SOLDIER_TYPES.map((t) => `soldier:${t}`), 'survivor'];
  const out: GroupEntry[] = [];
  for (const key of keys) {
    const members = units.filter((u) => (u.kind === 'survivor' ? 'survivor' : `soldier:${u.type}`) === key);
    if (members.length === 0) continue;
    const first = members[0] as SoldierView | SurvivorView;
    out.push({
      key,
      name: first.kind === 'soldier' ? SOLDIERS[first.type].name : '幸存者',
      count: members.length,
      ids: members.map((m) => m.id),
      health: members.reduce((sum, m) => sum + m.hp / m.maxHp, 0) / members.length,
    });
  }
  return out;
}

/** Nearest idle survivor on the map (ties: lower id), the one the panel buttons send. */
export function nearestIdleSurvivor(view: GameView, x: number, y: number): SurvivorView | null {
  let best: SurvivorView | null = null;
  let bestD = Infinity;
  for (const e of view.entities.values()) {
    if (e.kind !== 'survivor' || !isOnMap(e) || e.task.type !== 'idle') continue;
    const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

const NO_IDLE_SURVIVOR = '没有空闲的幸存者';

function sendSurvivor(game: Game, b: BuildingView, type: 'assignWork' | 'repair'): Availability {
  const s = nearestIdleSurvivor(game.state, b.x, b.y);
  if (!s) return unavailable(NO_IDLE_SURVIVOR);
  return availabilityOf(game, { type, unitIds: [s.id], buildingId: b.id });
}

function trainingDetails(game: Game, b: BuildingView): BuildingDetails['training'] {
  if (!trainsSoldiers(b.type)) return null;
  const stock = game.state.economy.resources;
  const unlocked = game.modifiers.unlockedUnits;
  const options = SOLDIER_TYPES.filter((t) => SOLDIERS[t].trainedAt === b.type).map((t) => {
    const def = SOLDIERS[t];
    return {
      unit: t,
      name: def.name,
      role: def.role,
      description: def.description,
      cost: costItems(trainingCost(game.modifiers, t), stock),
      seconds: def.trainSeconds,
      lockedBy: def.tech && !unlocked.has(t) ? TECHS[def.tech].name : null,
      availability: availabilityOf(game, { type: 'train', buildingId: b.id, unit: t }),
    };
  });
  const queue = b.trainQueue.map((o, index) => ({
    index,
    unit: o.unit,
    name: SOLDIERS[o.unit].name,
    progress: o.total > 0 ? Math.min(1, o.progress / o.total) : 0,
    cancel: availabilityOf(game, { type: 'cancelTraining', buildingId: b.id, index }),
  }));
  return { options, queue, hasRally: b.rally !== null };
}

/** Resources the building yields now, plus its own product even while it is unstaffed (shown as 0). */
function outputLines(game: Game, b: BuildingView): OutputLine[] {
  const perDay = buildingYieldPerDay(game, b);
  const product = BUILDINGS[b.type].production?.resource;
  return RESOURCES.filter((r) => perDay[r] > 0 || r === product).map((r) => ({ resource: r, name: RESOURCE_NAMES[r], perMinute: perDayToPerMinute(perDay[r]) }));
}

/** Living workers inside, as the simulation counts them; it takes its own entity, of which the view is a read-only alias. */
function onsiteCount(game: Game, b: BuildingView): number {
  const e = game.state.entities.get(b.id);
  return e?.kind === 'building' ? onsiteWorkerCount(game, e) : 0;
}

function signalDetails(game: Game, b: BuildingView): SignalDetails {
  const { stage, nightsHeld, nightsRequired } = game.state.signal;
  const broadcasting = stage === 'broadcast';
  return {
    stage: SIGNAL_STAGE_NAMES[stage],
    progress: broadcasting ? `${SIGNAL_STAGE_NAMES.broadcast} · 已守住 ${nightsHeld}/${nightsRequired} 晚` : null,
    start: b.construction || broadcasting ? null : availabilityOf(game, { type: 'startSignalBroadcast' }),
    startTip: `开始向长明城广播。之后的夜里会有一队怪物专门来打信号塔，守住 ${nightsRequired} 晚，车队就会到。塔被毁会中断广播。`,
  };
}

function buildingDetails(game: Game, b: BuildingView): BuildingDetails {
  const def = BUILDINGS[b.type];
  const isCore = b.type === 'core';
  const damaged = b.hp < b.maxHp;
  const site = b.construction;
  // The signal tower is built by a crew working inside and takes nobody once it stands;
  // every other workplace takes workers once it is finished.
  const tower = b.type === 'signalTower';
  const slots = (tower ? site !== null : site === null) ? workerSlots(game.modifiers, b) : 0;
  const housing = buildingHousing(game, b.type);
  return {
    id: b.id,
    type: b.type,
    name: def.name,
    description: def.description,
    isCore,
    hp: Math.ceil(b.hp),
    maxHp: Math.ceil(b.maxHp),
    construction: site ? { progress: site.total > 0 ? site.progress / site.total : 0, secondsLeft: tower ? null : Math.ceil((site.total - site.progress) / TICKS_PER_SECOND) } : null,
    workers: slots > 0 ? { count: onsiteCount(game, b), slots } : null,
    addWorker: slots > 0 ? sendSurvivor(game, b, 'assignWork') : null,
    removeWorker: slots > 0 ? availabilityOf(game, { type: 'unassignWork', buildingId: b.id, count: 1 }) : null,
    // On a site "repair" means helping to build (sites are not repaired), which the tower ignores.
    repair: (site ? !tower : damaged) ? sendSurvivor(game, b, 'repair') : null,
    demolish: isCore || site ? null : availabilityOf(game, { type: 'demolish', buildingId: b.id }),
    cancelConstruction: site ? availabilityOf(game, { type: 'cancelConstruction', buildingId: b.id }) : null,
    signal: tower ? signalDetails(game, b) : null,
    training: trainingDetails(game, b),
    production: def.production ? RESOURCE_NAMES[def.production.resource] : null,
    output: site ? [] : outputLines(game, b),
    housing: housing > 0 ? housing : null,
  };
}

export function weaknessOf(armor: ArmorType): string {
  let best = DAMAGE_TYPES[0] as (typeof DAMAGE_TYPES)[number];
  for (const d of DAMAGE_TYPES) if (DAMAGE_MULTIPLIER[d][armor] > DAMAGE_MULTIPLIER[best][armor]) best = d;
  return `${DAMAGE_TYPE_NAMES[best]}伤害 ×${DAMAGE_MULTIPLIER[best][armor]}`;
}

function mutantDetails(m: MutantView): MutantDetails {
  const def = MUTANTS[m.type];
  return {
    id: m.id,
    type: m.type,
    name: def.name,
    description: def.description,
    hp: Math.ceil(m.hp),
    maxHp: Math.ceil(m.maxHp),
    armorName: ARMOR_TYPE_NAMES[m.armor],
    weakness: weaknessOf(m.armor),
    boss: m.ai.boss,
  };
}

/** The hive's line explains its shield with the ordinary nests left (sim/combat/hiveShield.ts). */
function nestDescription(view: GameView, n: NestView): string {
  if (!n.isHive) return '摧毁巢穴可以获得燃料、科研，有时还有幸存者。选中士兵后右键巢穴即可集火。';
  const rule = `地图上每剩一个普通巢穴，母巢受到的伤害降低 ${formatPercent(HIVE_SHIELD.reductionPerNest)}，最多降低 ${formatPercent(HIVE_SHIELD.maxReduction)}。`;
  const nests = ordinaryNestsLeft(view);
  return nests === 0 ? `${rule}普通巢穴已全部摧毁，母巢不再减伤。` : `${rule}现在还剩 ${nests} 个，减伤 ${formatPercent(hiveDamageReduction(nests))}。`;
}

function nestDetails(view: GameView, n: NestView): NestDetails {
  return {
    id: n.id,
    name: n.isHive ? HIVE.name : NEST.name,
    isHive: n.isHive,
    level: n.growth.level,
    hp: Math.ceil(n.hp),
    maxHp: Math.ceil(n.maxHp),
    description: nestDescription(view, n),
  };
}

export function selectionPanelModel(game: Game, selection: readonly EntityId[]): SelectionPanelModel {
  const view: GameView = game.state;
  const entities = selection.map((id) => view.entities.get(id)).filter((e): e is EntityView => e !== undefined && e.hp > 0);
  const first = entities[0];
  if (!first) return { kind: 'none' };
  switch (first.kind) {
    case 'building':
      return { kind: 'building', building: buildingDetails(game, first) };
    case 'mutant':
      return { kind: 'mutant', mutant: mutantDetails(first) };
    case 'nest':
      return { kind: 'nest', nest: nestDetails(view, first) };
    default: {
      const units = entities.filter((e): e is SoldierView | SurvivorView => e.kind === 'soldier' || e.kind === 'survivor');
      if (units.length > 1) {
        const soldiers = units.filter((u) => u.kind === 'soldier').length;
        return { kind: 'group', entries: groupEntries(units), total: units.length, soldiers, survivors: units.length - soldiers };
      }
      return first.kind === 'soldier' ? { kind: 'soldier', unit: soldierDetails(game, first) } : { kind: 'survivor', unit: survivorDetails(view, first as SurvivorView) };
    }
  }
}
