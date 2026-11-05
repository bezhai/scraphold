/**
 * Nests and the hive: level up every night, day guards (guardMix) kept near the nest, growth from
 * retreating mutants. Destruction rewards are granted where the killing blow lands (damage.ts
 * calls destroyNest). Owner: Task 3.
 *
 * Every dawn each nest gains a level (up to maxLevel); nestMaxHp gives its new maximum, and
 * the increase is also added to current hp. At the start of
 * every day (including day 1) each nest tops its guards up to guardsBase + guardsPerLevel x level;
 * guards lost during the day are not replaced before the next dawn. A retreating mutant that
 * reaches its nest is absorbed: its threat (x difficulty nestGrowthPct) is banked as growth
 * points, and every growthPointsPerLevel points give one extra level.
 */
import { DIFFICULTIES, ENGAGEMENT, HIVE, MUTANTS, MUTANT_TYPES, NEST, NIGHTS, nestMaxHp, type Difficulty, type NestDef } from '../data/combat';
import type { ResourceAmounts } from '../data/economy';
import { emit } from '../events';
import type { Game } from '../game';
import { distanceToRect } from '../map/grid';
import { ordinaryNestsLeft } from './hiveShield';
import { pickWeighted } from '../rng';
import type { Building, Mutant, Nest } from '../state';
import { freeTileAround, openTilesAround, removeEntity, spawnMutant, spawnSurvivor } from '../world/entities';
import { rebuildSpatialIndex } from '../world/spatial';

export function nestDef(nest: Nest): NestDef {
  return nest.isHive ? HIVE : NEST;
}

/** Shared by night planning and the bot's public-data threat estimate. */
export function nestNightThreat(nest: Nest, night: number, difficulty: Difficulty): number {
  return nestDef(nest).nightThreatPerLevel * Math.max(0, nest.growth.level - 1) * DIFFICULTIES[difficulty].nightBudgetPct * (NIGHTS[night - 1]?.nestBudgetPct ?? 0);
}

/** What destroying this nest gives, at its current level (nestRewardPct applied). */
export function nestReward(game: Game, nest: Nest): { resources: ResourceAmounts; survivors: number } {
  const r = nestDef(nest).reward;
  const scale = 1 + game.modifiers.global.nestRewardPct;
  const levels = nest.growth.level - 1;
  const resources: ResourceAmounts = {};
  const fuel = Math.round((r.fuel + r.fuelPerLevel * levels) * scale);
  const research = Math.round((r.research + r.researchPerLevel * levels) * scale);
  if (fuel > 0) resources.fuel = fuel;
  if (research > 0) resources.research = research;
  return { resources, survivors: r.survivors };
}

/** Called once when the player's hit brings a nest to 0 hp (cleanup removes it). */
export function destroyNest(game: Game, nest: Nest): void {
  const { state } = game;
  if (nest.isHive) state.stats.hiveDestroyed = true;
  else state.stats.nestsDestroyed++;
  const { resources, survivors } = nestReward(game, nest);
  for (const [res, amount] of Object.entries(resources) as [keyof typeof resources, number][]) {
    state.economy.resources[res] += amount;
    state.stats.resourcesGathered[res] += amount;
  }
  emit(game, { type: 'nestDestroyed', nestId: nest.id, isHive: nest.isHive, nestsLeft: ordinaryNestsLeft(state), reward: resources, survivors });
  const core = state.entities.get(state.coreId) as Building;
  for (let k = 0; k < survivors; k++) {
    const tile = freeTileAround(game, core);
    const x = tile === -1 ? core.x : (tile % state.map.width) + 0.5;
    const y = tile === -1 ? core.y + core.size : Math.floor(tile / state.map.width) + 0.5;
    const s = spawnSurvivor(game, x, y);
    state.stats.survivorsRecruited++;
    emit(game, { type: 'survivorJoined', unitId: s.id, source: 'nest' });
  }
}

function levelUp(game: Game, nest: Nest): void {
  const def = nestDef(nest);
  if (nest.growth.level >= def.maxLevel) return;
  nest.growth.level++;
  const nextHp = nestMaxHp(nest.isHive, nest.growth.level, game.state.options.difficulty);
  nest.hp += nextHp - nest.maxHp;
  nest.maxHp = nextHp;
  emit(game, { type: 'nestLevelUp', nestId: nest.id, level: nest.growth.level });
}

function topUpGuards(game: Game, nest: Nest, guards: number): void {
  const { state } = game;
  const def = nestDef(nest);
  const missing = def.guardsBase + def.guardsPerLevel * nest.growth.level - guards;
  if (missing <= 0) return;
  const diff = DIFFICULTIES[state.options.difficulty];
  const types = MUTANT_TYPES.filter((t) => (def.guardMix[t] ?? 0) > 0);
  const tiles = openTilesAround(game, nest, missing);
  if (tiles.length === 0 || types.length === 0) return;
  for (let k = 0; k < missing; k++) {
    const tile = tiles[k % tiles.length] as number;
    const type = pickWeighted(state.rng.ai, types, (t) => def.guardMix[t] ?? 0);
    const x = (tile % state.map.width) + 0.5;
    const y = Math.floor(tile / state.map.width) + 0.5;
    const m = spawnMutant(game, type, x, y, { mode: 'guard', homeNestId: nest.id, hpPct: diff.mutantHpPct });
    m.ai.damagePct = diff.mutantDamagePct - 1;
  }
}

function absorb(game: Game, nest: Nest, m: Mutant): void {
  const def = nestDef(nest);
  const g = nest.growth;
  g.points += MUTANTS[m.type].threat * DIFFICULTIES[game.state.options.difficulty].nestGrowthPct;
  while (g.points >= def.growthPointsPerLevel && g.level < def.maxLevel) {
    g.points -= def.growthPointsPerLevel;
    levelUp(game, nest);
  }
  if (g.level >= def.maxLevel) g.points = Math.min(g.points, def.growthPointsPerLevel);
  removeEntity(game, m);
}

export function nestSystem(game: Game): void {
  const { state } = game;
  const { phase, phaseTick, day } = state.clock;
  const startOfDay = phase === 'day' && phaseTick === 0;
  const guards = new Map<number, number>();
  const arrived: { nest: Nest; m: Mutant }[] = [];
  for (const e of state.entities.values()) {
    if (e.kind !== 'mutant' || e.hp <= 0) continue;
    if (e.ai.mode === 'guard') guards.set(e.ai.homeNestId, (guards.get(e.ai.homeNestId) ?? 0) + 1);
    if (e.ai.mode !== 'retreat') continue;
    const nest = state.entities.get(e.ai.homeNestId);
    if (!nest || nest.kind !== 'nest' || nest.hp <= 0) continue;
    if (distanceToRect(nest.tileX, nest.tileY, nest.size, e.x, e.y) - e.radius <= ENGAGEMENT.retreatMergeDistance) arrived.push({ nest, m: e });
  }
  for (const { nest, m } of arrived) absorb(game, nest, m);
  if (startOfDay) {
    for (const e of state.entities.values()) {
      if (e.kind !== 'nest' || e.hp <= 0) continue;
      if (day > 1) levelUp(game, e);
      topUpGuards(game, e, guards.get(e.id) ?? 0);
    }
  }
  // Absorbed mutants must not be found by the systems that still run this tick.
  if (arrived.length > 0) rebuildSpatialIndex(game.spatial, state);
}
