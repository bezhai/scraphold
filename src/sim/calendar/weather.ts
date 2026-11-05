/** Rust corrosion and outdoor exposure, using the common damage/death bookkeeping. */
import { applyEnvironmentalDamage } from '../combat/damage';
import { WEATHER } from '../data/calendar';
import type { Game } from '../game';
import { TICKS_PER_SECOND } from '../time';
import { nightType } from './calendar';

export function weatherVisionMultiplier({ state, modifiers }: Pick<Game, 'state' | 'modifiers'>): number {
  if (state.clock.phase === 'night' && nightType(state) === 'denseFog') return WEATHER.denseFogVisionMultiplier;
  const immune = modifiers.global.postStormVisionImmunity > 0;
  return !immune && state.tick < state.calendar.reducedVisionUntilTick ? WEATHER.postStormVisionMultiplier : 1;
}

export function weatherSystem(game: Game): void {
  const { state, modifiers } = game;
  if (state.clock.phase !== 'night' || nightType(state) !== 'rustStorm') return;
  for (const entity of state.entities.values()) {
    if (entity.hp <= 0) continue;
    let damage = 0;
    if (entity.kind === 'building') {
      damage = entity.maxHp * WEATHER.buildingDamagePerSecond / TICKS_PER_SECOND * Math.max(0, 1 + modifiers.global.stormBuildingDamageTakenPct) * modifiers.factor.stormBuildingDamage;
      if (entity.id === state.coreId) damage = Math.min(damage * WEATHER.coreDamageMultiplier, Math.max(0, entity.hp - WEATHER.coreMinimumHp));
    } else if (entity.kind === 'survivor' && entity.insideId === 0) {
      damage = WEATHER.outdoorDamagePerSecond / TICKS_PER_SECOND * Math.max(0, 1 + modifiers.global.stormOutdoorDamageTakenPct);
    }
    if (damage > 0) applyEnvironmentalDamage(game, entity, damage);
  }
}
