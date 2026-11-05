/**
 * Effects and the aggregated modifier table. Owner: Task 1 (shared mechanism).
 *
 * Techs, policies and origins carry `Effect` lists in the data tables; computeModifiers sums
 * them into one `Modifiers` table that every system reads (via game.modifiers). Conventions:
 * - `...Pct` values are fractions added together: +0.2 means +20%; apply as base * (1 + pct).
 * - `...Add` values and `policySlots` are flat additions.
 * - `forecastPrecise` > 0 means the dusk forecast shows exact counts.
 * Unlocks are not effects: a building/unit/policy is unlocked when its def's `tech` is researched.
 */
import { SOLDIERS, SOLDIER_TYPES, type SoldierType } from './data/combat';
import {
  BUILDINGS,
  BUILDING_TYPES,
  ORIGINS,
  POLICIES,
  POLICY_IDS,
  TECHS,
  type BuildingType,
  type OriginId,
  type PolicyId,
  type TechId,
} from './data/economy';
import { zeroRecord } from './record';

export type GlobalStat =
  // read by economy systems (Task 2)
  | 'scrapYieldPct'
  | 'foodYieldPct'
  | 'fuelYieldPct'
  | 'researchYieldPct'
  /** All staffed production (not the core baseline). */
  | 'productionPct'
  | 'coreYieldPct'
  | 'growthPct'
  | 'buildSpeedPct'
  | 'buildCostPct'
  | 'repairCostPct'
  | 'repairSpeedPct'
  | 'trainSpeedPct'
  | 'trainCostPct'
  | 'soldierUpkeepPct'
  | 'policySlots'
  | 'ruinRewardPct'
  | 'nestRewardPct'
  // read by combat/night systems (Task 3)
  | 'nightBuildingDamageTakenPct'
  | 'towerDamagePct'
  | 'towerRangeAdd'
  | 'towerFuelCostPct'
  | 'visionAdd'
  | 'veterancyKillsPct'
  | 'forecastPrecise'
  | 'stormBuildingDamageTakenPct'
  | 'stormOutdoorDamageTakenPct'
  | 'postStormVisionImmunity'
  | 'hungerPenaltyReduction'
  | 'nightSoldierVisionAdd'
  | 'rallySpeedPct'
  | 'remoteSoldierHpPct'
  | 'remoteSoldierDamagePct'
  | 'remoteBuildingHpPct'
  | 'remoteBuildSpeedPct'
  | 'remoteUpkeepPct'
  | 'stormProductionPct'
  | 'signalDamageTakenPct'
  | 'signalNightsAdd';

export const GLOBAL_STATS: readonly GlobalStat[] = [
  'scrapYieldPct',
  'foodYieldPct',
  'fuelYieldPct',
  'researchYieldPct',
  'productionPct',
  'coreYieldPct',
  'growthPct',
  'buildSpeedPct',
  'buildCostPct',
  'repairCostPct',
  'repairSpeedPct',
  'trainSpeedPct',
  'trainCostPct',
  'soldierUpkeepPct',
  'policySlots',
  'ruinRewardPct',
  'nestRewardPct',
  'nightBuildingDamageTakenPct',
  'towerDamagePct',
  'towerRangeAdd',
  'towerFuelCostPct',
  'visionAdd',
  'veterancyKillsPct',
  'forecastPrecise',
  'stormBuildingDamageTakenPct',
  'stormOutdoorDamageTakenPct',
  'postStormVisionImmunity',
  'hungerPenaltyReduction',
  'nightSoldierVisionAdd',
  'rallySpeedPct',
  'remoteSoldierHpPct',
  'remoteSoldierDamagePct',
  'remoteBuildingHpPct',
  'remoteBuildSpeedPct',
  'remoteUpkeepPct',
  'stormProductionPct',
  'signalDamageTakenPct',
  'signalNightsAdd',

];

/** Per soldier type stats (also used by veterancy promotions). */
export type UnitStat = 'damagePct' | 'hpPct' | 'rangeAdd' | 'speedPct' | 'cooldownPct' | 'visionAdd' | 'splashAdd';
export const UNIT_STATS: readonly UnitStat[] = ['damagePct', 'hpPct', 'rangeAdd', 'speedPct', 'cooldownPct', 'visionAdd', 'splashAdd'];

/** Per building type stats. `yieldPct` multiplies staffed production of that building. */
export type FactorStat = 'coreYield' | 'stormBuildingDamage' | 'nightBuildingDamage';
export type BuildingStat = 'hpPct' | 'damageTakenPct' | 'yieldPct' | 'workerSlotsAdd' | 'housingAdd' | 'buildCostPct' | 'buildSpeedPct' | 'visionAdd';
export const BUILDING_STATS: readonly BuildingStat[] = ['hpPct', 'damageTakenPct', 'yieldPct', 'workerSlotsAdd', 'housingAdd', 'buildCostPct', 'buildSpeedPct', 'visionAdd'];

export type Effect =
  | { kind: 'factor'; stat: FactorStat; value: number }
  | { kind: 'global'; stat: GlobalStat; value: number }
  | { kind: 'unit'; unit: SoldierType | 'all'; stat: UnitStat; value: number }
  | { kind: 'building'; building: BuildingType | 'all'; stat: BuildingStat; value: number };

export interface Modifiers {
  factor: Record<FactorStat, number>;
  global: Record<GlobalStat, number>;
  unit: Record<SoldierType, Record<UnitStat, number>>;
  building: Record<BuildingType, Record<BuildingStat, number>>;
  unlockedBuildings: ReadonlySet<BuildingType>;
  unlockedUnits: ReadonlySet<SoldierType>;
  unlockedPolicies: ReadonlySet<PolicyId>;
  researched: ReadonlySet<TechId>;
}

/** What modifiers are computed from (a subset of GameState, so the UI can preview changes too). */
export interface ModifierSources {
  origin: OriginId;
  researched: readonly TechId[];
  /** Slotted policies; null = empty slot. Pass only usable slots. */
  policySlots: readonly (PolicyId | null)[];
}

function apply(m: Modifiers, effect: Effect): void {
  switch (effect.kind) {
    case 'factor': m.factor[effect.stat] *= effect.value; return;
    case 'global':
      m.global[effect.stat] += effect.value;
      return;
    case 'unit':
      for (const u of effect.unit === 'all' ? SOLDIER_TYPES : [effect.unit]) m.unit[u][effect.stat] += effect.value;
      return;
    case 'building':
      for (const b of effect.building === 'all' ? BUILDING_TYPES : [effect.building]) m.building[b][effect.stat] += effect.value;
      return;
  }
}

/** The single place where tech, policy and origin effects are combined. */
export function computeModifiers(sources: ModifierSources, incidentEffects: readonly Effect[] = []): Modifiers {
  const unit = {} as Record<SoldierType, Record<UnitStat, number>>;
  for (const u of SOLDIER_TYPES) unit[u] = zeroRecord(UNIT_STATS);
  const building = {} as Record<BuildingType, Record<BuildingStat, number>>;
  for (const b of BUILDING_TYPES) building[b] = zeroRecord(BUILDING_STATS);
  const researched = new Set(sources.researched);
  const unlocked = (tech: TechId | null): boolean => tech === null || researched.has(tech);
  const m: Modifiers = {
    global: zeroRecord(GLOBAL_STATS),
    factor: { coreYield: 1, stormBuildingDamage: 1, nightBuildingDamage: 1 },
    unit,
    building,
    unlockedBuildings: new Set(BUILDING_TYPES.filter((b) => unlocked(BUILDINGS[b].tech))),
    unlockedUnits: new Set(SOLDIER_TYPES.filter((u) => unlocked(SOLDIERS[u].tech))),
    unlockedPolicies: new Set(POLICY_IDS.filter((p) => unlocked(POLICIES[p].tech))),
    researched,
  };
  for (const e of ORIGINS[sources.origin].effects) apply(m, e);
  for (const t of sources.researched) for (const e of TECHS[t].effects) apply(m, e);
  for (const p of sources.policySlots) if (p) for (const e of POLICIES[p].effects) apply(m, e);
  for (const e of incidentEffects) apply(m, e);
  return m;
}
