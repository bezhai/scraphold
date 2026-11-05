/**
 * Combat and night data: soldiers, mutants, damage-type x armor-type matrix, promotions, tower
 * weapons, nests and the hive, night composition, difficulty, hunger, score, forecast.
 * Owner: Task 3 (tuning by Task 5). First-pass numbers.
 *
 * Units: durations in seconds, speeds in tiles per second, ranges in tiles measured edge to edge
 * (center distance minus both radii).
 */
import type { UnitStat } from '../modifiers';
import type { BuildingType, ResourceAmounts, TechId } from './economy';

// ---------------------------------------------------------------------------------------------
// Damage and armor

export type DamageType = 'normal' | 'pierce' | 'explosive' | 'fire';
export type ArmorType = 'none' | 'heavy' | 'giant' | 'structure';
export const DAMAGE_TYPES: readonly DamageType[] = ['normal', 'pierce', 'explosive', 'fire'];
export const ARMOR_TYPES: readonly ArmorType[] = ['none', 'heavy', 'giant', 'structure'];
export const DAMAGE_TYPE_NAMES: Record<DamageType, string> = { normal: '普通', pierce: '穿甲', explosive: '爆炸', fire: '火焰' };
export const ARMOR_TYPE_NAMES: Record<ArmorType, string> = { none: '无甲', heavy: '重甲', giant: '巨型', structure: '建筑' };

/** Final damage = weapon damage x DAMAGE_MULTIPLIER[damageType][armor]. */
export const DAMAGE_MULTIPLIER: Record<DamageType, Record<ArmorType, number>> = {
  normal: { none: 1.0, heavy: 0.5, giant: 0.6, structure: 0.7 },
  pierce: { none: 0.9, heavy: 1.75, giant: 1.4, structure: 0.5 },
  explosive: { none: 1.2, heavy: 1.3, giant: 1.1, structure: 1.6 },
  fire: { none: 1.5, heavy: 0.4, giant: 0.6, structure: 0.3 },
};

export interface WeaponDef {
  damage: number;
  damageType: DamageType;
  /** Max attack distance, edge to edge. */
  range: number;
  /** Cannot fire at targets closer than this (grenadier). */
  minRange: number;
  cooldownSeconds: number;
  /** Splash radius around the impact point; 0 = single target. */
  splashRadius: number;
  /** Cone weapons (flamethrower): cosine of the cone half angle; 0 = not a cone. */
  coneCos: number;
  /** The attacker dies when it attacks (boomer). */
  selfDestruct: boolean;
  /** Fuel consumed per attack (machine-gun tower). */
  fuelPerShot: number;
}

function weapon(w: Partial<WeaponDef> & Pick<WeaponDef, 'damage' | 'damageType' | 'range' | 'cooldownSeconds'>): WeaponDef {
  return { minRange: 0, splashRadius: 0, coneCos: 0, selfDestruct: false, fuelPerShot: 0, ...w };
}

// ---------------------------------------------------------------------------------------------
// Soldiers

export type SoldierType = 'shieldGuard' | 'rifleman' | 'sniper' | 'grenadier' | 'scout' | 'flamethrower' | 'pickup';
export const SOLDIER_TYPES: readonly SoldierType[] = ['shieldGuard', 'rifleman', 'sniper', 'grenadier', 'scout', 'flamethrower', 'pickup'];

export type PromotionId =
  | 'ironWall'
  | 'bulwarkStrike'
  | 'marksman'
  | 'quickHands'
  | 'deadeye'
  | 'longBarrel'
  | 'demolisher'
  | 'steadyArm'
  | 'outrider'
  | 'skirmisher'
  | 'inferno'
  | 'fireproof'
  | 'turretUpgrade'
  | 'armorPlating';

export interface SoldierDef {
  name: string;
  role: string;
  description: string;
  hp: number;
  armor: ArmorType;
  speed: number;
  radius: number;
  /** Separation weight: heavier units are pushed less (shield guards hold a line). */
  mass: number;
  vision: number;
  weapon: WeaponDef;
  /** Resource cost; training also consumes one survivor. */
  cost: ResourceAmounts;
  trainSeconds: number;
  upkeepFoodPerDay: number;
  trainedAt: BuildingType;
  tech: TechId | null;
  /** Kills needed to become a veteran (before veterancyKillsPct). */
  veteranKills: number;
  /** The player chooses one of these two on promotion. */
  promotions: readonly [PromotionId, PromotionId];
}

export const SOLDIERS: Record<SoldierType, SoldierDef> = {
  shieldGuard: {
    name: '盾卫',
    role: '前排',
    description: '近战，血厚有护甲，挡住疾行者。怕喷吐者的溅射和甲壳兽。',
    hp: 240,
    armor: 'heavy',
    speed: 1.6,
    radius: 0.34,
    mass: 4,
    vision: 6,
    weapon: weapon({ damage: 14, damageType: 'normal', range: 0.45, cooldownSeconds: 1.0 }),
    cost: { food: 40, scrap: 12 },
    trainSeconds: 12,
    upkeepFoodPerDay: 3,
    trainedAt: 'barracks',
    tech: null,
    veteranKills: 12,
    promotions: ['ironWall', 'bulwarkStrike'],
  },
  rifleman: {
    name: '步枪手',
    role: '远程',
    description: '远程主力，单体伤害。克制游荡者和疾行者，怕甲壳兽。',
    hp: 100,
    armor: 'none',
    speed: 1.9,
    radius: 0.3,
    mass: 1,
    vision: 7,
    weapon: weapon({ damage: 12, damageType: 'normal', range: 6.5, cooldownSeconds: 0.8 }),
    cost: { food: 35, scrap: 8 },
    trainSeconds: 10,
    upkeepFoodPerDay: 2,
    trainedAt: 'barracks',
    tech: null,
    veteranKills: 10,
    promotions: ['marksman', 'quickHands'],
  },
  sniper: {
    name: '狙击手',
    role: '破甲',
    description: '超远射程，慢速穿甲。克制甲壳兽和喷吐者，怕成群的疾行者。',
    hp: 70,
    armor: 'none',
    speed: 1.6,
    radius: 0.3,
    mass: 1,
    vision: 9,
    weapon: weapon({ damage: 48, damageType: 'pierce', range: 9.5, cooldownSeconds: 2.6 }),
    cost: { food: 40, scrap: 25 },
    trainSeconds: 15,
    upkeepFoodPerDay: 2,
    trainedAt: 'armory',
    tech: 'armory',
    veteranKills: 8,
    promotions: ['deadeye', 'longBarrel'],
  },
  grenadier: {
    name: '掷弹兵',
    role: '范围',
    description: '爆炸范围伤害，有最小射程。克制成群的游荡者和疾行者，怕贴身的怪物。',
    hp: 85,
    armor: 'none',
    speed: 1.7,
    radius: 0.3,
    mass: 1,
    vision: 7,
    weapon: weapon({ damage: 26, damageType: 'explosive', range: 6.5, minRange: 2.2, splashRadius: 1.4, cooldownSeconds: 2.2 }),
    cost: { food: 40, scrap: 22 },
    trainSeconds: 14,
    upkeepFoodPerDay: 2,
    trainedAt: 'armory',
    tech: 'demolitions',
    veteranKills: 12,
    promotions: ['demolisher', 'steadyArm'],
  },
  scout: {
    name: '摩托斥候',
    role: '侦察',
    description: '高速，大视野，伤害低。用来探索和半路截杀爆囊，不适合正面战斗。',
    hp: 80,
    armor: 'none',
    speed: 4.0,
    radius: 0.34,
    mass: 1.5,
    vision: 11,
    weapon: weapon({ damage: 6, damageType: 'normal', range: 4, cooldownSeconds: 0.8 }),
    cost: { food: 30, scrap: 15 },
    trainSeconds: 8,
    upkeepFoodPerDay: 2,
    trainedAt: 'barracks',
    tech: null,
    veteranKills: 10,
    promotions: ['outrider', 'skirmisher'],
  },
  flamethrower: {
    name: '火焰兵',
    role: '燃料·范围',
    description: '短距离锥形火焰。克制大群无甲怪物，怕甲壳兽和喷吐者。',
    hp: 140,
    armor: 'none',
    speed: 1.7,
    radius: 0.32,
    mass: 1.5,
    vision: 6,
    weapon: weapon({ damage: 6, damageType: 'fire', range: 2.8, coneCos: 0.8, cooldownSeconds: 0.25 }),
    cost: { food: 35, scrap: 18, fuel: 15 },
    trainSeconds: 14,
    upkeepFoodPerDay: 2,
    trainedAt: 'workshop',
    tech: 'fuelPower',
    veteranKills: 15,
    promotions: ['inferno', 'fireproof'],
  },
  pickup: {
    name: '武装皮卡',
    role: '燃料·机动',
    description: '快速机动火力，适合快速支援和清巢穴。怕甲壳兽和首领。',
    hp: 280,
    armor: 'heavy',
    speed: 3.6,
    radius: 0.5,
    mass: 6,
    vision: 9,
    weapon: weapon({ damage: 8, damageType: 'normal', range: 5.5, cooldownSeconds: 0.35 }),
    cost: { food: 35, scrap: 40, fuel: 30 },
    trainSeconds: 18,
    upkeepFoodPerDay: 3,
    trainedAt: 'workshop',
    tech: 'armoredPickup',
    veteranKills: 15,
    promotions: ['turretUpgrade', 'armorPlating'],
  },
};

/** Veterancy promotions: per-unit stat modifiers (same stat names as unit Effects). */
export interface PromotionDef {
  name: string;
  description: string;
  effects: readonly { stat: UnitStat; value: number }[];
}

export const PROMOTIONS: Record<PromotionId, PromotionDef> = {
  ironWall: { name: '铁壁', description: '生命 +40%', effects: [{ stat: 'hpPct', value: 0.4 }] },
  bulwarkStrike: { name: '盾击', description: '伤害 +35%', effects: [{ stat: 'damagePct', value: 0.35 }] },
  marksman: { name: '神射', description: '伤害 +25%', effects: [{ stat: 'damagePct', value: 0.25 }] },
  quickHands: { name: '快手', description: '攻击间隔 -20%', effects: [{ stat: 'cooldownPct', value: -0.2 }] },
  deadeye: { name: '致命一击', description: '伤害 +30%', effects: [{ stat: 'damagePct', value: 0.3 }] },
  longBarrel: { name: '长枪管', description: '射程 +2', effects: [{ stat: 'rangeAdd', value: 2 }] },
  demolisher: { name: '爆破专家', description: '爆炸范围 +0.6', effects: [{ stat: 'splashAdd', value: 0.6 }] },
  steadyArm: { name: '稳定投掷', description: '攻击间隔 -20%', effects: [{ stat: 'cooldownPct', value: -0.2 }] },
  outrider: {
    name: '先遣',
    description: '速度 +20%，视野 +2',
    effects: [
      { stat: 'speedPct', value: 0.2 },
      { stat: 'visionAdd', value: 2 },
    ],
  },
  skirmisher: { name: '游击', description: '伤害 +40%', effects: [{ stat: 'damagePct', value: 0.4 }] },
  inferno: { name: '烈焰', description: '伤害 +30%', effects: [{ stat: 'damagePct', value: 0.3 }] },
  fireproof: { name: '防火服', description: '生命 +40%', effects: [{ stat: 'hpPct', value: 0.4 }] },
  turretUpgrade: { name: '炮塔升级', description: '攻击间隔 -25%', effects: [{ stat: 'cooldownPct', value: -0.25 }] },
  armorPlating: { name: '加装装甲', description: '生命 +35%', effects: [{ stat: 'hpPct', value: 0.35 }] },
};

/** Applied while GameState.economy.upkeep.hungry is true. */
export const HUNGER = { damagePct: -0.3, speedPct: -0.15 };

/** Weapons mounted on defense buildings. */
export const TOWER_WEAPONS: Partial<Record<BuildingType, WeaponDef>> = {
  machineGunTower: weapon({ damage: 8, damageType: 'normal', range: 7.5, cooldownSeconds: 0.3, fuelPerShot: 0.025 }),
};

// ---------------------------------------------------------------------------------------------
// Mutants

export type MutantType = 'wanderer' | 'runner' | 'crawler' | 'spitter' | 'boomer' | 'behemoth';
export const MUTANT_TYPES: readonly MutantType[] = ['wanderer', 'runner', 'crawler', 'spitter', 'boomer', 'behemoth'];

/**
 * melee: walk the flow field to the core, fight what blocks or attacks it.
 * ranged: like melee but stops at range and prefers clumped targets (spitter).
 * bomber: paths to the nearest building or barricade and self-destructs (boomer).
 * boss: high HP, smashes buildings on its way (behemoth).
 */
export type MutantBehavior = 'melee' | 'ranged' | 'bomber' | 'boss';

export interface MutantDef {
  name: string;
  description: string;
  hp: number;
  armor: ArmorType;
  speed: number;
  radius: number;
  mass: number;
  /** Aggro radius: notices player units/buildings within this distance. */
  vision: number;
  weapon: WeaponDef;
  /** Night budget cost. */
  threat: number;
  /** Bought for the night in groups of this many (runner packs). */
  packSize: number;
  behavior: MutantBehavior;
}

export const MUTANTS: Record<MutantType, MutantDef> = {
  wanderer: {
    name: '游荡者',
    description: '基础怪物，慢，数量多。',
    hp: 70,
    armor: 'none',
    speed: 1.0,
    radius: 0.32,
    mass: 1,
    vision: 5,
    weapon: weapon({ damage: 8, damageType: 'normal', range: 0.4, cooldownSeconds: 1.2 }),
    threat: 1,
    packSize: 1,
    behavior: 'melee',
  },
  runner: {
    name: '疾行者',
    description: '快，血少，成群出现。',
    hp: 32,
    armor: 'none',
    speed: 2.6,
    radius: 0.26,
    mass: 0.7,
    vision: 6,
    weapon: weapon({ damage: 5, damageType: 'normal', range: 0.35, cooldownSeconds: 0.7 }),
    threat: 1,
    packSize: 4,
    behavior: 'melee',
  },
  crawler: {
    name: '甲壳兽',
    description: '重甲，高血，慢。',
    hp: 340,
    armor: 'heavy',
    speed: 0.8,
    radius: 0.45,
    mass: 4,
    vision: 5,
    weapon: weapon({ damage: 22, damageType: 'pierce', range: 0.5, cooldownSeconds: 1.6 }),
    threat: 6,
    packSize: 1,
    behavior: 'melee',
  },
  spitter: {
    name: '喷吐者',
    description: '远程酸液溅射，专打扎堆的单位。',
    hp: 80,
    armor: 'none',
    speed: 0.95,
    radius: 0.32,
    mass: 1,
    vision: 7,
    weapon: weapon({ damage: 14, damageType: 'pierce', range: 5, splashRadius: 1.3, cooldownSeconds: 2.6 }),
    threat: 4,
    packSize: 1,
    behavior: 'ranged',
  },
  boomer: {
    name: '爆囊',
    description: '冲向建筑和路障，自爆伤害很高。',
    hp: 55,
    armor: 'none',
    speed: 1.5,
    radius: 0.36,
    mass: 1.2,
    vision: 8,
    weapon: weapon({ damage: 140, damageType: 'explosive', range: 0.3, splashRadius: 1.8, cooldownSeconds: 1, selfDestruct: true }),
    threat: 4,
    packSize: 1,
    behavior: 'bomber',
  },
  behemoth: {
    name: '巨躯',
    description: '首领。极高血量，砸建筑。',
    hp: 2400,
    armor: 'giant',
    speed: 0.8,
    radius: 0.8,
    mass: 12,
    vision: 6,
    weapon: weapon({ damage: 90, damageType: 'explosive', range: 0.6, splashRadius: 1.2, cooldownSeconds: 2.2 }),
    threat: 40,
    packSize: 1,
    behavior: 'boss',
  },
};

// ---------------------------------------------------------------------------------------------
// Nests and hive

export interface NestDef {
  name: string;
  size: number;
  hp: number;
  hpPerLevel: number;
  maxLevel: number;
  /** Day guards kept near the nest: guardsBase + guardsPerLevel x level, drawn from guardMix. */
  guardsBase: number;
  guardsPerLevel: number;
  guardMix: Partial<Record<MutantType, number>>;
  /** Guards stay within this radius of the nest. */
  guardRadius: number;
  /** Extra threat this nest sends at night, per level. */
  nightThreatPerLevel: number;
  /** Threat of mutants retreating into the nest at dawn needed for one extra level. */
  growthPointsPerLevel: number;
  reward: { fuel: number; research: number; fuelPerLevel: number; researchPerLevel: number; survivors: number };
}

export const NEST: NestDef = {
  name: '巢穴',
  size: 2,
  hp: 600,
  hpPerLevel: 250,
  maxLevel: 12,
  guardsBase: 2,
  guardsPerLevel: 1,
  guardMix: { wanderer: 3, runner: 2, spitter: 1 },
  guardRadius: 4,
  nightThreatPerLevel: 2,
  growthPointsPerLevel: 12,
  reward: { fuel: 40, research: 40, fuelPerLevel: 10, researchPerLevel: 10, survivors: 2 },
};

export const HIVE: NestDef = {
  name: '母巢',
  size: 3,
  hp: 15800,
  hpPerLevel: 800,
  maxLevel: 20,
  guardsBase: 10,
  guardsPerLevel: 2,
  guardMix: { wanderer: 2, runner: 2, crawler: 2, spitter: 2, boomer: 1 },
  guardRadius: 5,
  nightThreatPerLevel: 1.5,
  growthPointsPerLevel: 20,
  reward: { fuel: 0, research: 0, fuelPerLevel: 0, researchPerLevel: 0, survivors: 0 },
};

/**
 * Hive shield (combat/hiveShield.ts): each ordinary nest left on the map, discovered or not, cuts
 * the damage the hive takes by reductionPerNest, up to maxReduction; none left, full damage.
 */
export const HIVE_SHIELD = {
  reductionPerNest: 0.1,
  maxReduction: 0.8,
};

// ---------------------------------------------------------------------------------------------
// Nights

export interface NightDef {
  /** Threat budget (normal difficulty) for edge attack groups, excluding nests' own contribution. */
  budget: number;
  /** Number of distinct attack directions. */
  directions: number;
  /** Early nights scale nest assault waves without changing daytime nest combat. */
  nestBudgetPct: number;
  /** Relative weights of mutant types bought with the budget. */
  mix: Partial<Record<MutantType, number>>;
  /** Candidate boss for a surge on this night; ignored on ordinary raids. */
  boss: { type: MutantType; hpPct: number } | null;
}

export const NIGHTS: readonly NightDef[] = [
  { budget: 6, directions: 1, nestBudgetPct: 1, mix: { wanderer: 1 }, boss: null },
  { budget: 22, directions: 1, nestBudgetPct: 0.25, mix: { wanderer: 3, runner: 1 }, boss: null },
  { budget: 43, directions: 2, nestBudgetPct: 1, mix: { wanderer: 3, runner: 2 }, boss: null },
  { budget: 46, directions: 2, nestBudgetPct: 1, mix: { wanderer: 3, runner: 2, crawler: 1, boomer: 0.5 }, boss: null },
  { budget: 52, directions: 2, nestBudgetPct: 1, mix: { wanderer: 3, runner: 2, crawler: 1, spitter: 1 }, boss: { type: 'behemoth', hpPct: 0.469 } },
  { budget: 62, directions: 2, nestBudgetPct: 1, mix: { wanderer: 3, runner: 2, crawler: 1, spitter: 1, boomer: 1 }, boss: { type: 'behemoth', hpPct: 0.538 } },
  { budget: 74, directions: 3, nestBudgetPct: 1, mix: { wanderer: 3, runner: 3, crawler: 1.5, spitter: 1, boomer: 1 }, boss: { type: 'behemoth', hpPct: 0.606 } },
  { budget: 88, directions: 3, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2, spitter: 1.5, boomer: 1 }, boss: { type: 'behemoth', hpPct: 0.675 } },
  { budget: 102, directions: 3, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2, spitter: 2, boomer: 1.5 }, boss: { type: 'behemoth', hpPct: 0.744 } },
  { budget: 125, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 0.812 } },
  { budget: 135, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 0.881 } },
  { budget: 145, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 0.95 } },
  { budget: 158, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.019 } },
  { budget: 170, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.087 } },
  { budget: 185, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.156 } },
  { budget: 200, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.225 } },
  { budget: 218, directions: 4, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.294 } },
  { budget: 236, directions: 5, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.363 } },
  { budget: 255, directions: 5, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.431 } },
  { budget: 280, directions: 5, nestBudgetPct: 1, mix: { wanderer: 2, runner: 3, crawler: 2.5, spitter: 2, boomer: 2 }, boss: { type: 'behemoth', hpPct: 1.5 } },
];

/** Dusk forecast: per-direction threat at or above these values is labelled medium / large. */
export const FORECAST = { mediumThreat: 15, largeThreat: 40 };

export const NIGHT_SPAWN = {
  /** Every group trickles in evenly over the first seconds of the night. */
  spreadSeconds: 12,
  /** Max random offset of a spawn from its tile center, per axis (stays inside the tile). */
  jitter: 0.4,
  /** Each direction's share of the edge budget is weighted by a random factor in [1 - x, 1 + x]. */
  shareJitter: 0.3,
};

/**
 * A player entity raises an `underAttack` alert when it is hit after at least this many seconds
 * without damage, so a sustained attack alerts once when it starts (and two alerts for the same
 * entity are always at least this far apart).
 */
export const ALERT_THROTTLE_SECONDS = 4;

// ---------------------------------------------------------------------------------------------
// Engagement: target acquisition, pursuit and retreat. Distances in tiles, edge to edge.

export const ENGAGEMENT = {
  /** Soldiers notice enemies within min(vision, range + this), and never less than their range. */
  soldierAcquireExtra: 2.5,
  /** Idle soldiers only chase enemies within this distance of their guard spot, then walk back. */
  idleLeash: 5,
  /** Assaulting mutants give up a chased unit farther than vision + this. */
  mutantChaseLeash: 3,
  /** Nest guards engage player units within guardRadius + this of their nest... */
  guardAggroExtra: 4,
  /** ...and chase them at most this far beyond guardRadius before walking home. */
  guardLeashExtra: 7,
  /** A retreating mutant this close to its nest is absorbed into it. */
  retreatMergeDistance: 1.2,
};

// ---------------------------------------------------------------------------------------------
// Difficulty and score

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY_IDS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface DifficultyDef {
  name: string;
  nightBudgetPct: number;
  /** Mother-hive durability; ordinary nests are unaffected. */
  hiveHpPct: number;
  mutantHpPct: number;
  mutantDamagePct: number;
  nestGrowthPct: number;
  scoreMultiplier: number;
  calmNights: number;
  stormNights: number;
  denseFogNights: number;
  surgeBudgetMultiplier: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: { name: '简单', hiveHpPct: 0.8, nightBudgetPct: 0.7, mutantHpPct: 0.85, mutantDamagePct: 0.85, nestGrowthPct: 0.7, scoreMultiplier: 0.6, calmNights: 6, stormNights: 2, denseFogNights: 2, surgeBudgetMultiplier: 1.3 },
  normal: { name: '普通', hiveHpPct: 1, nightBudgetPct: 1, mutantHpPct: 1, mutantDamagePct: 1, nestGrowthPct: 1, scoreMultiplier: 1, calmNights: 5, stormNights: 2, denseFogNights: 3, surgeBudgetMultiplier: 1.5 },
  hard: { name: '困难', hiveHpPct: 1.2, nightBudgetPct: 1.2, mutantHpPct: 1.1, mutantDamagePct: 1.1, nestGrowthPct: 1.2, scoreMultiplier: 1.6, calmNights: 4, stormNights: 3, denseFogNights: 4, surgeBudgetMultiplier: 1.7 },
};

/** Only a victory scores. Total = (sum of parts) x difficulty scoreMultiplier, floored at 0. */
export const SCORE = {
  victory: 1500,
  signalBonus: 500,
  /** Per full day remaining on a hive or signal victory before the last night ends. */
  perDayEarly: 50,
  hiveBonus: 250,
  perNestDestroyed: 80,
  perSurvivorAlive: 10,
  perBuildingLost: -10,
};

/** Durability at a level, shared by entity creation and daily/retreat growth. */
export function nestMaxHp(isHive: boolean, level: number, difficulty: Difficulty): number {
  const def = isHive ? HIVE : NEST;
  return (def.hp + (level - 1) * def.hpPerLevel) * (isHive ? DIFFICULTIES[difficulty].hiveHpPct : 1);
}
