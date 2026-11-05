/**
 * Economy and development data: resources, buildings, survivors, growth/upkeep, ruins, techs,
 * policies, origins. Owner: Task 2 (tuning by Task 5). First-pass numbers.
 *
 * Units: durations in seconds, rates per second, distances in tiles. Convert with time.ts helpers.
 */
import { SIGNAL } from './signal';
import { CYCLE_TICKS, TICKS_PER_SECOND } from '../time';
import type { Effect } from '../modifiers';
import type { MutantType, SoldierType } from './combat';
import type { Terrain } from './map';

// ---------------------------------------------------------------------------------------------
// Resources

export type Resource = 'scrap' | 'food' | 'fuel' | 'research';
export const RESOURCES: readonly Resource[] = ['scrap', 'food', 'fuel', 'research'];
export const RESOURCE_NAMES: Record<Resource, string> = { scrap: '废料', food: '食物', fuel: '燃料', research: '科研' };
export type ResourceAmounts = Partial<Record<Resource, number>>;

export const START = {
  resources: { scrap: 200, food: 100, fuel: 15, research: 0 } as Record<Resource, number>,
  survivors: 6,
  policySlots: 2,
  maxPolicySlots: 3,
};

// ---------------------------------------------------------------------------------------------
// Survivors, growth, upkeep, repair, construction

export const SURVIVOR = {
  name: '幸存者',
  hp: 40,
  /** tiles per second */
  speed: 2.0,
  radius: 0.28,
  mass: 1,
  vision: 4,
};

export const GROWTH = {
  /** Food surplus needed for the first new survivor. */
  baseThreshold: 15,
  /** Extra threshold per person housed: survivors, soldiers and recruits in training queues. */
  thresholdPerPerson: 1.5,
  /** Share of the per-day food surplus that feeds the growth meter. */
  surplusShare: 1,
};

export const UPKEEP = {
  /** Soldiers eat their upkeepFoodPerDay (combat data) once per day at this phase start. */
  settlePhase: 'dusk' as const,
};

export const REPAIR = {
  scrapPerHp: 0.15,
  hpPerSecondPerWorker: 12,
};

export const CONSTRUCTION = {
  /** A new construction site starts with this share of max hp (Task 2 grows it with progress). */
  startHpPct: 0.1,
  /** Share of the cost refunded when a construction site is cancelled. */
  cancelRefund: 1,
  /** Share of the cost refunded when a finished building is demolished. */
  demolishRefund: 0.4,
  /** Construction progresses without builders; each repairing survivor adds this share of the base rate. */
  builderSpeedPct: 0.5,
  /** Helpers beyond this many on one site add nothing. */
  maxBuilders: 3,
};

export const TRAINING = {
  queueLimit: 5,
};

/** The survivor manager (economy/survivorAi.ts): survivors under automatic control. */
export const SURVIVOR_AI = {
  /** Ticks between two decisions. */
  intervalTicks: 20,
  /** By day, at most one worker per this many seconds moves between production lines. */
  transferSeconds: 5,
  /** A worker moves only when the two lines are together at least this many workers off their shares. */
  transferGap: 2,
  /** Finished buildings below this share of max hp get repairers; a started repair runs to full hp. */
  repairBelowPct: 0.9,
  /** One repairer per this much missing hp, up to CONSTRUCTION.maxBuilders per building. */
  hpPerRepairer: 150,
  /** Repairs start only with at least this much scrap in stock. */
  repairMinScrap: 20,
  /** By day, repairs take workers out of production while fewer than this share of the managed survivors repair. */
  repairShare: 0.25,
  /** Nobody is sent to a building with a visible mutant this close to it (tiles); repairers there are called back. */
  enemyClearance: 10,
  /** ...nor until no mutant has been seen that close for this many seconds (a mutant at the edge of sight comes and goes). */
  enemyCalmSeconds: 5,
  /** A line's weight is 1, times up to (1 + shortageBoost) as its stock falls from target to 0, halved above glut. */
  shortageBoost: 3,
  stock: {
    food: { target: 60, glut: 300 },
    scrap: { target: 80, glut: 400 },
    fuel: { target: 30, glut: 150 },
  } as Record<'food' | 'scrap' | 'fuel', { target: number; glut: number }>,
  /** The food target also covers this many days of soldier upkeep. */
  upkeepDays: 1.5,
};

// ---------------------------------------------------------------------------------------------
// Buildings

export type BuildingType =
  | 'core'
  | 'shack'
  | 'salvageYard'
  | 'greenhouse'
  | 'oilWell'
  | 'researchStation'
  | 'dispatchHub'
  | 'barracks'
  | 'armory'
  | 'workshop'
  | 'barricade'
  | 'machineGunTower'
  | 'watchtower'
  | 'signalTower';

export const BUILDING_TYPES: readonly BuildingType[] = [
  'core',
  'shack',
  'salvageYard',
  'greenhouse',
  'oilWell',
  'researchStation',
  'dispatchHub',
  'barracks',
  'armory',
  'workshop',
  'barricade',
  'machineGunTower',
  'watchtower',
  'signalTower',
];

export type BuildingCategory = 'core' | 'housing' | 'production' | 'support' | 'military' | 'defense';

export interface ProductionDef {
  resource: Resource;
  perWorkerPerSecond: number;
}

export type ProductionBonus =
  /** Counts tiles of `terrain` in the one-tile ring around the footprint. */
  | { kind: 'adjacentTerrain'; terrain: Terrain; pctPerTile: number; maxTiles: number }
  /** Counts tiles of `terrain` under the footprint (terrain recorded at placement). */
  | { kind: 'footprintTerrain'; terrain: Terrain; pctPerTile: number };

export interface BuildingDef {
  name: string;
  description: string;
  category: BuildingCategory;
  /** Square footprint side in tiles. */
  size: number;
  hp: number;
  cost: ResourceAmounts;
  buildSeconds: number;
  /** Tech required to build; null = available from the start. */
  tech: TechId | null;
  /** Every footprint tile must be one of these. Empty = cannot be placed by the player. */
  allowedTerrain: readonly Terrain[];
  vision: number;
  housing: number;
  workerSlots: number;
  production: ProductionDef | null;
  bonuses: readonly ProductionBonus[];
  /** Dispatch hub: bonus granted to each staffed production building it touches. */
  adjacentProductionPct: number;
  /** Core only: output per second that needs no workers. */
  baseYieldPerSecond: ResourceAmounts;
  maxCount: number | null;
}

const BUILDABLE: readonly Terrain[] = ['wasteland', 'fertile'];

function building(def: Partial<BuildingDef> & Pick<BuildingDef, 'name' | 'description' | 'category' | 'size' | 'hp'>): BuildingDef {
  return {
    cost: {},
    buildSeconds: 10,
    tech: null,
    allowedTerrain: BUILDABLE,
    vision: 3,
    housing: 0,
    workerSlots: 0,
    production: null,
    bonuses: [],
    adjacentProductionPct: 0,
    baseYieldPerSecond: {},
    maxCount: null,
    ...def,
  };
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  core: building({
    name: '据点核心',
    description: '被摧毁即失败。提供住房、保底产出和视野。',
    category: 'core',
    size: 3,
    hp: 2000,
    allowedTerrain: [],
    vision: 9,
    housing: 6,
    baseYieldPerSecond: { scrap: 0.5, food: 0.45, research: 0.15 },
    maxCount: 1,
  }),
  shack: building({
    name: '棚屋',
    description: '提供住房上限。',
    category: 'housing',
    size: 2,
    hp: 220,
    cost: { scrap: 35 },
    buildSeconds: 8,
    housing: 4,
  }),
  salvageYard: building({
    name: '拆解站',
    description: '派幸存者拆解废料；相邻残骸越多产出越高。',
    category: 'production',
    size: 2,
    hp: 300,
    cost: { scrap: 45 },
    buildSeconds: 10,
    workerSlots: 3,
    production: { resource: 'scrap', perWorkerPerSecond: 0.26 },
    bonuses: [{ kind: 'adjacentTerrain', terrain: 'wreckage', pctPerTile: 0.1, maxTiles: 8 }],
  }),
  greenhouse: building({
    name: '温室',
    description: '产食物；建在沃土上或挨着水源有加成。',
    category: 'production',
    size: 2,
    hp: 260,
    cost: { scrap: 50 },
    buildSeconds: 10,
    workerSlots: 3,
    production: { resource: 'food', perWorkerPerSecond: 0.24 },
    bonuses: [
      { kind: 'footprintTerrain', terrain: 'fertile', pctPerTile: 0.1 },
      { kind: 'adjacentTerrain', terrain: 'water', pctPerTile: 0.08, maxTiles: 5 },
    ],
  }),
  oilWell: building({
    name: '油井',
    description: '只能建在油渍上，产燃料。',
    category: 'production',
    size: 1,
    hp: 240,
    cost: { scrap: 60 },
    buildSeconds: 12,
    allowedTerrain: ['oil'],
    workerSlots: 2,
    production: { resource: 'fuel', perWorkerPerSecond: 0.1 },
  }),
  researchStation: building({
    name: '研究站',
    description: '产科研；挨着遗迹有加成。',
    category: 'production',
    size: 2,
    hp: 240,
    cost: { scrap: 70 },
    buildSeconds: 14,
    workerSlots: 2,
    production: { resource: 'research', perWorkerPerSecond: 0.35 },
    bonuses: [{ kind: 'adjacentTerrain', terrain: 'ruin', pctPerTile: 0.3, maxTiles: 2 }],
  }),
  dispatchHub: building({
    name: '调度站',
    description: '需要一名幸存者值守，给相邻的生产建筑提供产出加成。',
    category: 'support',
    size: 2,
    hp: 260,
    cost: { scrap: 80 },
    buildSeconds: 14,
    workerSlots: 1,
    adjacentProductionPct: 0.2,
  }),
  barracks: building({
    name: '兵营',
    description: '训练盾卫、步枪手、摩托斥候。',
    category: 'military',
    size: 2,
    hp: 450,
    cost: { scrap: 80 },
    buildSeconds: 15,
  }),
  armory: building({
    name: '军械厂',
    description: '训练狙击手、掷弹兵。',
    category: 'military',
    size: 2,
    hp: 450,
    cost: { scrap: 110 },
    buildSeconds: 18,
    tech: 'armory',
  }),
  workshop: building({
    name: '改装车间',
    description: '训练火焰兵、武装皮卡。',
    category: 'military',
    size: 2,
    hp: 500,
    cost: { scrap: 120, fuel: 20 },
    buildSeconds: 20,
    tech: 'fuelPower',
  }),
  barricade: building({
    name: '路障',
    description: '便宜的挡路建筑，可以引导怪物走向。',
    category: 'defense',
    size: 1,
    hp: 380,
    cost: { scrap: 10 },
    buildSeconds: 3,
    vision: 1,
  }),
  machineGunTower: building({
    name: '机枪塔',
    description: '自动射击，夜里开火消耗燃料。',
    category: 'defense',
    size: 1,
    hp: 650,
    cost: { scrap: 60, fuel: 5 },
    buildSeconds: 14,
    tech: 'machineGuns',
    vision: 7,
  }),
  watchtower: building({
    name: '瞭望塔',
    description: '大范围视野，黄昏预报精确到每个方向的数量和首领。',
    category: 'defense',
    size: 1,
    hp: 200,
    cost: { scrap: 50 },
    buildSeconds: 10,
    vision: 11,
  }),
  signalTower: building({
    name: '信号塔',
    description: '在 K-7 中继站原址修建，工人在场时才有进度；建成后可以开始向长明城广播。',
    category: 'support',
    size: 3,
    hp: 2400,
    cost: { scrap: 400, fuel: 80 },
    buildSeconds: SIGNAL.repairDays * CYCLE_TICKS / TICKS_PER_SECOND * SIGNAL.workerSlots,
    tech: 'oldFrequency',
    allowedTerrain: ['wasteland'],
    vision: 9,
    workerSlots: SIGNAL.workerSlots,
    maxCount: 1,
  }),
};

// ---------------------------------------------------------------------------------------------
// Ruins (旧时代遗迹): reward rolled at map generation, granted once when a unit reaches the ruin.

export type RuinReward =
  | { kind: 'resources'; amounts: ResourceAmounts }
  | { kind: 'resource'; resource: Resource; amount: number }
  | { kind: 'survivors'; count: number }
  | { kind: 'reveal'; radius: number }
  | { kind: 'unit'; unit: SoldierType };

export const RUIN_REWARD_TABLE: readonly { weight: number; reward: RuinReward }[] = [
  { weight: 3, reward: { kind: 'resource', resource: 'scrap', amount: 70 } },
  { weight: 2, reward: { kind: 'resource', resource: 'food', amount: 60 } },
  { weight: 2, reward: { kind: 'resource', resource: 'fuel', amount: 25 } },
  { weight: 2, reward: { kind: 'resource', resource: 'research', amount: 40 } },
  { weight: 2, reward: { kind: 'survivors', count: 2 } },
  { weight: 1, reward: { kind: 'reveal', radius: 12 } },
  { weight: 1, reward: { kind: 'unit', unit: 'rifleman' } },
  { weight: 1, reward: { kind: 'unit', unit: 'scout' } },
];

/** A unit within this many tiles of a ruin tile center explores it. */
export const RUIN_EXPLORE_RADIUS = 0.9;

// ---------------------------------------------------------------------------------------------
// Techs

export type TechLine = 'survival' | 'military' | 'fortification';
export const TECH_LINE_NAMES: Record<TechLine, string> = { survival: '生存线', military: '军工线', fortification: '工事线' };

export type TechId =
  | 'scavengingTools'
  | 'hydroponics'
  | 'communityPlan'
  | 'refinery'
  | 'ruinArchives'
  | 'armory'
  | 'demolitions'
  | 'fuelPower'
  | 'armoredPickup'
  | 'veteranDoctrine'
  | 'machineGuns'
  | 'reinforcement'
  | 'lookoutNetwork'
  | 'civicCenter'
  | 'steelLine'
  | 'oldFrequency'
  | 'relayPower'
  | 'signalAmplification'
  | 'fogFiltration'
  | 'reserveGranary'
  | 'nightVision'
  | 'rapidDeployment'
  | 'expeditionPack'
  | 'windReinforcement'
  | 'outpostWorks';

export const TECH_IDS: readonly TechId[] = [
  'scavengingTools',
  'hydroponics',
  'communityPlan',
  'refinery',
  'ruinArchives',
  'armory',
  'demolitions',
  'fuelPower',
  'armoredPickup',
  'veteranDoctrine',
  'machineGuns',
  'reinforcement',
  'lookoutNetwork',
  'civicCenter',
  'steelLine',
  'oldFrequency',
  'relayPower',
  'signalAmplification',
  'fogFiltration',
  'reserveGranary',
  'nightVision',
  'rapidDeployment',
  'expeditionPack',
  'windReinforcement',
  'outpostWorks',
];

/**
 * Inspiration (灵感) condition: once met, the tech gains 50% of its cost as progress.
 * Evaluated by Task 2 from GameState.stats and current entities.
 */
export type Inspiration =
  | { kind: 'killMutants'; mutant: MutantType | 'any'; count: number }
  | { kind: 'exploreRuins'; count: number }
  | { kind: 'discoverTerrain'; terrain: Terrain; count: number }
  | { kind: 'nightsWithoutBuildingLoss'; count: number }
  | { kind: 'ownBuildings'; building: BuildingType; count: number }
  | { kind: 'population'; count: number }
  | { kind: 'trainSoldiers'; count: number }
  | { kind: 'destroyNests'; count: number }
  | { kind: 'promoteVeterans'; count: number }
  | { kind: 'repairHp'; amount: number }
  | { kind: 'researchTechs'; count: number };

export const INSPIRATION_BOOST = 0.5;

export interface TechDef {
  name: string;
  description: string;
  line: TechLine;
  tier: number;
  /** Research points. */
  cost: number;
  requires: readonly TechId[];
  effects: readonly Effect[];
  inspiration: Inspiration;
  inspirationText: string;
}

export const TECHS: Record<TechId, TechDef> = {
  oldFrequency: {
    name: '旧频段破译',
    description: '信号塔第一阶段的前置条件。',
    line: 'survival',
    tier: 4,
    cost: 220,
    requires: ['ruinArchives'],
    effects: [],
    inspiration: { kind: 'exploreRuins', count: 3 },
    inspirationText: '探索 3 处遗迹',
  },
  relayPower: {
    name: '中继供能',
    description: '信号塔造价 -25%，修建速度 +30%。',
    line: 'survival',
    tier: 5,
    cost: 260,
    requires: ['oldFrequency'],
    effects: [
      { kind: 'building', building: 'signalTower', stat: 'buildCostPct', value: -0.25 },
      { kind: 'building', building: 'signalTower', stat: 'buildSpeedPct', value: 0.3 },
    ],
    inspiration: { kind: 'ownBuildings', building: 'oilWell', count: 1 },
    inspirationText: '拥有 1 座油井',
  },
  signalAmplification: {
    name: '信号增幅',
    description: '信号塔需要守住的广播晚数减少一晚。',
    line: 'survival',
    tier: 6,
    cost: 320,
    requires: ['relayPower'],
    effects: [
      { kind: 'global', stat: 'signalNightsAdd', value: -1 },
    ],
    inspiration: { kind: 'researchTechs', count: 8 },
    inspirationText: '完成 8 项科技',
  },
  fogFiltration: {
    name: '雾气过滤',
    description: '风暴户外幸存者伤害 -75%，取消风暴后的视野惩罚。',
    line: 'survival',
    tier: 2,
    cost: 180,
    requires: ['scavengingTools'],
    effects: [
      { kind: 'global', stat: 'stormOutdoorDamageTakenPct', value: -0.75 },
      { kind: 'global', stat: 'postStormVisionImmunity', value: 1 },
    ],
    inspiration: { kind: 'nightsWithoutBuildingLoss', count: 3 },
    inspirationText: '无建筑损失度过 3 晚',
  },
  reserveGranary: {
    name: '储备粮仓',
    description: '士兵口粮 -20%，饥饿惩罚减半。',
    line: 'survival',
    tier: 3,
    cost: 240,
    requires: ['hydroponics'],
    effects: [
      { kind: 'global', stat: 'soldierUpkeepPct', value: -0.2 },
      { kind: 'global', stat: 'hungerPenaltyReduction', value: 0.5 },
    ],
    inspiration: { kind: 'ownBuildings', building: 'greenhouse', count: 3 },
    inspirationText: '拥有 3 座温室',
  },
  nightVision: {
    name: '夜视镜',
    description: '夜晚士兵视野 +4（同样适用于浓雾夜）。',
    line: 'military',
    tier: 2,
    cost: 180,
    requires: ['armory'],
    effects: [
      { kind: 'global', stat: 'nightSoldierVisionAdd', value: 4 },
    ],
    inspiration: { kind: 'killMutants', mutant: 'any', count: 40 },
    inspirationText: '击杀 40 只怪物',
  },
  rapidDeployment: {
    name: '快速部署',
    description: '士兵移速 +15%，新兵首次前往集结点时额外 +35%。',
    line: 'military',
    tier: 2,
    cost: 220,
    requires: ['armory'],
    effects: [
      { kind: 'unit', unit: 'all', stat: 'speedPct', value: 0.15 },
      { kind: 'global', stat: 'rallySpeedPct', value: 0.35 },
    ],
    inspiration: { kind: 'trainSoldiers', count: 8 },
    inspirationText: '训练 8 名士兵',
  },
  expeditionPack: {
    name: '远征背包',
    description: '远离核心时士兵生命和伤害 +25%。',
    line: 'military',
    tier: 3,
    cost: 280,
    requires: ['rapidDeployment'],
    effects: [
      { kind: 'global', stat: 'remoteSoldierHpPct', value: 0.25 },
      { kind: 'global', stat: 'remoteSoldierDamagePct', value: 0.25 },
    ],
    inspiration: { kind: 'destroyNests', count: 2 },
    inspirationText: '摧毁 2 座巢穴',
  },
  windReinforcement: {
    name: '防风加固',
    description: '风暴建筑腐蚀伤害 -65%。',
    line: 'fortification',
    tier: 2,
    cost: 180,
    requires: ['reinforcement'],
    effects: [
      { kind: 'global', stat: 'stormBuildingDamageTakenPct', value: -0.65 },
    ],
    inspiration: { kind: 'repairHp', amount: 500 },
    inspirationText: '累计维修 500 点建筑生命',
  },
  outpostWorks: {
    name: '前哨工事',
    description: '远离核心的建筑生命 +40%、建造速度 +30%。',
    line: 'fortification',
    tier: 3,
    cost: 240,
    requires: ['windReinforcement'],
    effects: [
      { kind: 'global', stat: 'remoteBuildingHpPct', value: 0.4 },
      { kind: 'global', stat: 'remoteBuildSpeedPct', value: 0.3 },
    ],
    inspiration: { kind: 'ownBuildings', building: 'watchtower', count: 2 },
    inspirationText: '拥有 2 座瞭望塔',
  },
  // 生存线
  scavengingTools: {
    name: '拾荒工具',
    description: '废料产出 +15%。',
    line: 'survival',
    tier: 1,
    cost: 50,
    requires: [],
    effects: [{ kind: 'global', stat: 'scrapYieldPct', value: 0.15 }],
    inspiration: { kind: 'ownBuildings', building: 'salvageYard', count: 2 },
    inspirationText: '拥有 2 座拆解站',
  },
  hydroponics: {
    name: '水培温室',
    description: '食物产出 +20%，温室工位 +1。',
    line: 'survival',
    tier: 2,
    cost: 90,
    requires: ['scavengingTools'],
    effects: [
      { kind: 'global', stat: 'foodYieldPct', value: 0.2 },
      { kind: 'building', building: 'greenhouse', stat: 'workerSlotsAdd', value: 1 },
    ],
    inspiration: { kind: 'ownBuildings', building: 'greenhouse', count: 2 },
    inspirationText: '拥有 2 座温室',
  },
  communityPlan: {
    name: '社区规划',
    description: '棚屋住房 +2，人口增长 +25%。',
    line: 'survival',
    tier: 3,
    cost: 140,
    requires: ['hydroponics'],
    effects: [
      { kind: 'building', building: 'shack', stat: 'housingAdd', value: 2 },
      { kind: 'global', stat: 'growthPct', value: 0.25 },
    ],
    inspiration: { kind: 'population', count: 12 },
    inspirationText: '人口达到 12',
  },
  refinery: {
    name: '炼油工艺',
    description: '燃料产出 +35%。',
    line: 'survival',
    tier: 2,
    cost: 80,
    requires: ['scavengingTools'],
    effects: [{ kind: 'global', stat: 'fuelYieldPct', value: 0.35 }],
    inspiration: { kind: 'discoverTerrain', terrain: 'oil', count: 1 },
    inspirationText: '发现油渍地块',
  },
  ruinArchives: {
    name: '遗迹档案',
    description: '科研产出 +25%，遗迹奖励 +50%。',
    line: 'survival',
    tier: 3,
    cost: 130,
    requires: ['refinery'],
    effects: [
      { kind: 'global', stat: 'researchYieldPct', value: 0.25 },
      { kind: 'global', stat: 'ruinRewardPct', value: 0.5 },
    ],
    inspiration: { kind: 'exploreRuins', count: 3 },
    inspirationText: '探索 3 个遗迹',
  },
  // 军工线
  armory: {
    name: '军械制造',
    description: '解锁军械厂和狙击手。',
    line: 'military',
    tier: 1,
    cost: 60,
    requires: [],
    effects: [],
    inspiration: { kind: 'trainSoldiers', count: 4 },
    inspirationText: '训练 4 名士兵',
  },
  demolitions: {
    name: '爆破训练',
    description: '解锁掷弹兵。',
    line: 'military',
    tier: 2,
    cost: 90,
    requires: ['armory'],
    effects: [],
    inspiration: { kind: 'killMutants', mutant: 'any', count: 40 },
    inspirationText: '累计击杀 40 只怪物',
  },
  fuelPower: {
    name: '燃料动力',
    description: '解锁改装车间和火焰兵。',
    line: 'military',
    tier: 3,
    cost: 140,
    requires: ['armory'],
    effects: [],
    inspiration: { kind: 'ownBuildings', building: 'oilWell', count: 1 },
    inspirationText: '拥有 1 座油井',
  },
  armoredPickup: {
    name: '武装改装',
    description: '解锁武装皮卡。',
    line: 'military',
    tier: 4,
    cost: 190,
    requires: ['fuelPower'],
    effects: [],
    inspiration: { kind: 'destroyNests', count: 1 },
    inspirationText: '摧毁 1 个巢穴',
  },
  veteranDoctrine: {
    name: '老兵传承',
    description: '升为老兵所需击杀 -30%，全体士兵生命 +10%。',
    line: 'military',
    tier: 4,
    cost: 180,
    requires: ['demolitions'],
    effects: [
      { kind: 'global', stat: 'veterancyKillsPct', value: -0.3 },
      { kind: 'unit', unit: 'all', stat: 'hpPct', value: 0.1 },
    ],
    inspiration: { kind: 'promoteVeterans', count: 2 },
    inspirationText: '晋升 2 名老兵',
  },
  // 工事线
  machineGuns: {
    name: '机枪塔',
    description: '解锁机枪塔。',
    line: 'fortification',
    tier: 1,
    cost: 60,
    requires: [],
    effects: [],
    inspiration: { kind: 'nightsWithoutBuildingLoss', count: 1 },
    inspirationText: '某一夜没有损失建筑',
  },
  reinforcement: {
    name: '加固结构',
    description: '全部建筑生命 +25%，维修费用 -30%。',
    line: 'fortification',
    tier: 2,
    cost: 90,
    requires: ['machineGuns'],
    effects: [
      { kind: 'building', building: 'all', stat: 'hpPct', value: 0.25 },
      { kind: 'global', stat: 'repairCostPct', value: -0.3 },
    ],
    inspiration: { kind: 'repairHp', amount: 300 },
    inspirationText: '累计维修 300 点建筑生命',
  },
  lookoutNetwork: {
    name: '瞭望网络',
    description: '全部视野 +2，机枪塔射程 +1。',
    line: 'fortification',
    tier: 2,
    cost: 80,
    requires: [],
    effects: [
      { kind: 'global', stat: 'visionAdd', value: 2 },
      { kind: 'global', stat: 'towerRangeAdd', value: 1 },
    ],
    inspiration: { kind: 'ownBuildings', building: 'watchtower', count: 1 },
    inspirationText: '建造 1 座瞭望塔',
  },
  civicCenter: {
    name: '政令中枢',
    description: '政令卡槽 +1（共 3 个）。',
    line: 'fortification',
    tier: 3,
    cost: 140,
    requires: ['lookoutNetwork'],
    effects: [{ kind: 'global', stat: 'policySlots', value: 1 }],
    inspiration: { kind: 'researchTechs', count: 4 },
    inspirationText: '完成 4 项科技',
  },
  steelLine: {
    name: '钢铁防线',
    description: '机枪塔伤害 +30%，路障生命 +50%。',
    line: 'fortification',
    tier: 4,
    cost: 180,
    requires: ['reinforcement'],
    effects: [
      { kind: 'global', stat: 'towerDamagePct', value: 0.3 },
      { kind: 'building', building: 'barricade', stat: 'hpPct', value: 0.5 },
    ],
    inspiration: { kind: 'killMutants', mutant: 'boomer', count: 5 },
    inspirationText: '击杀 5 只爆囊',
  },
};

// ---------------------------------------------------------------------------------------------
// Policies (政令卡): slotted during the day, locked at night.

export type PolicyId =
  | 'salvageDrive'
  | 'martialLaw'
  | 'scholarsFirst'
  | 'curfew'
  | 'rationing'
  | 'harvestFestival'
  | 'fuelRationing'
  | 'rapidRepair'
  | 'bountyHunters'
  | 'veteranCorps'
  | 'engineeringCorps'
  | 'stormReadiness'
  | 'expeditionSupplies'
  | 'fullBroadcast';

export const POLICY_IDS: readonly PolicyId[] = [
  'salvageDrive',
  'martialLaw',
  'scholarsFirst',
  'curfew',
  'rationing',
  'harvestFestival',
  'fuelRationing',
  'rapidRepair',
  'bountyHunters',
  'veteranCorps',
  'engineeringCorps',
  'stormReadiness',
  'expeditionSupplies',
  'fullBroadcast',
];

export interface PolicyDef {
  name: string;
  description: string;
  tech: TechId | null;
  effects: readonly Effect[];
}

export const POLICIES: Record<PolicyId, PolicyDef> = {
  stormReadiness: {
    name: '风暴戒备',
    description: '风暴期间建筑腐蚀 -20%，生产 -10%。',
    tech: 'windReinforcement',
    effects: [
      { kind: 'global', stat: 'stormBuildingDamageTakenPct', value: -0.2 },
      { kind: 'global', stat: 'stormProductionPct', value: -0.1 },
    ],
  },
  expeditionSupplies: {
    name: '远征补给',
    description: '远离核心的士兵口粮减半。',
    tech: 'expeditionPack',
    effects: [
      { kind: 'global', stat: 'remoteUpkeepPct', value: -0.5 },
    ],
  },
  fullBroadcast: {
    name: '全频广播',
    description: '信号塔施工和广播期间受到的伤害 -35%。',
    tech: 'relayPower',
    effects: [
      { kind: 'global', stat: 'signalDamageTakenPct', value: -0.35 },
    ],
  },
  salvageDrive: {
    name: '拾荒令',
    description: '废料产出 +20%。',
    tech: null,
    effects: [{ kind: 'global', stat: 'scrapYieldPct', value: 0.2 }],
  },
  martialLaw: {
    name: '战时动员',
    description: '训练速度 +40%，废料产出 -10%。',
    tech: null,
    effects: [
      { kind: 'global', stat: 'trainSpeedPct', value: 0.4 },
      { kind: 'global', stat: 'scrapYieldPct', value: -0.1 },
    ],
  },
  scholarsFirst: {
    name: '学者优先',
    description: '科研产出 +30%，食物产出 -10%。',
    tech: null,
    effects: [
      { kind: 'global', stat: 'researchYieldPct', value: 0.3 },
      { kind: 'global', stat: 'foodYieldPct', value: -0.1 },
    ],
  },
  curfew: {
    name: '宵禁加固',
    description: '夜间建筑受到的伤害 -25%。',
    tech: null,
    effects: [{ kind: 'global', stat: 'nightBuildingDamageTakenPct', value: -0.25 }],
  },
  rationing: {
    name: '节衣缩食',
    description: '士兵食物消耗减半，所有生产 -15%。',
    tech: null,
    effects: [
      { kind: 'global', stat: 'soldierUpkeepPct', value: -0.5 },
      { kind: 'global', stat: 'productionPct', value: -0.15 },
    ],
  },
  harvestFestival: {
    name: '丰收庆典',
    description: '人口增长 +40%，食物产出 +10%。',
    tech: 'communityPlan',
    effects: [
      { kind: 'global', stat: 'growthPct', value: 0.4 },
      { kind: 'global', stat: 'foodYieldPct', value: 0.1 },
    ],
  },
  fuelRationing: {
    name: '燃料配给',
    description: '燃料产出 +25%，机枪塔燃料消耗 -30%。',
    tech: 'refinery',
    effects: [
      { kind: 'global', stat: 'fuelYieldPct', value: 0.25 },
      { kind: 'global', stat: 'towerFuelCostPct', value: -0.3 },
    ],
  },
  rapidRepair: {
    name: '快速修缮',
    description: '维修费用 -50%，维修速度 +50%。',
    tech: 'reinforcement',
    effects: [
      { kind: 'global', stat: 'repairCostPct', value: -0.5 },
      { kind: 'global', stat: 'repairSpeedPct', value: 0.5 },
    ],
  },
  bountyHunters: {
    name: '侦察悬赏',
    description: '遗迹奖励 +50%，摧毁巢穴奖励 +50%。',
    tech: 'lookoutNetwork',
    effects: [
      { kind: 'global', stat: 'ruinRewardPct', value: 0.5 },
      { kind: 'global', stat: 'nestRewardPct', value: 0.5 },
    ],
  },
  veteranCorps: {
    name: '老兵制度',
    description: '升为老兵所需击杀 -40%。',
    tech: 'veteranDoctrine',
    effects: [{ kind: 'global', stat: 'veterancyKillsPct', value: -0.4 }],
  },
  engineeringCorps: {
    name: '工程突击',
    description: '建造速度 +50%，建造费用 +10%。',
    tech: 'civicCenter',
    effects: [
      { kind: 'global', stat: 'buildSpeedPct', value: 0.5 },
      { kind: 'global', stat: 'buildCostPct', value: 0.1 },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Origins (营地特性)

export type OriginId = 'scavengers' | 'militia' | 'scholars';
export const ORIGIN_IDS: readonly OriginId[] = ['scavengers', 'militia', 'scholars'];

export interface OriginDef {
  name: string;
  description: string;
  effects: readonly Effect[];
  start: {
    /** Placed complete near the core at game start. */
    buildings: readonly BuildingType[];
    /** Free soldiers at game start (they do not consume survivors). */
    soldiers: readonly { type: SoldierType; count: number }[];
    extraSurvivors: number;
    extraResources: ResourceAmounts;
    /** Marks every ruin tile as explored in the fog at game start. */
    revealRuins: boolean;
  };
}

export const ORIGINS: Record<OriginId, OriginDef> = {
  scavengers: {
    name: '拾荒者营地',
    description: '废料产出 +25%，开局多一座拆解站。',
    effects: [{ kind: 'global', stat: 'scrapYieldPct', value: 0.25 }],
    start: { buildings: ['salvageYard'], soldiers: [], extraSurvivors: 0, extraResources: {}, revealRuins: false },
  },
  militia: {
    name: '民兵哨所',
    description: '开局送一座兵营和 2 名步枪手，士兵食物消耗 -30%。',
    effects: [{ kind: 'global', stat: 'soldierUpkeepPct', value: -0.3 }],
    start: {
      buildings: ['barracks'],
      soldiers: [{ type: 'rifleman', count: 2 }],
      extraSurvivors: 0,
      extraResources: {},
      revealRuins: false,
    },
  },
  scholars: {
    name: '避难所学者',
    description: '科研产出 +30%，开局多一座研究站，揭示所有遗迹位置。',
    effects: [{ kind: 'global', stat: 'researchYieldPct', value: 0.3 }],
    start: { buildings: ['researchStation'], soldiers: [], extraSurvivors: 0, extraResources: { research: 20 }, revealRuins: true },
  },
};

/** Center-to-center distance, inclusive. Shared by all expedition/outpost effects. */
export const REMOTE_DISTANCE = 16;
