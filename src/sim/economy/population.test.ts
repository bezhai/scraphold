import { describe, expect, it } from 'vitest';
import { SOLDIERS } from '../data/combat';
import { BUILDINGS, GROWTH } from '../data/economy';
import { drainEvents } from '../events';
import { refreshModifiers, type Game } from '../game';
import { stepGame } from '../pipeline';
import type { Building } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS, clockAt, type Phase } from '../time';
import { addBuilding, spawnSoldier } from '../world/entities';
import { buildingHousing, dailyUpkeep, housingCapacity, populationCount, populationSystem } from './population';

const ROWS = ['............', '............', '............', '....CCC.....', '....CCC.....', '....CCC.....', '............', '............'];

function setPhase(game: Game, day: number, phase: Phase): void {
  const offset = phase === 'day' ? 0 : phase === 'dusk' ? DAY_TICKS - DUSK_TICKS : DAY_TICKS;
  game.state.tick = (day - 1) * CYCLE_TICKS + offset;
  game.state.clock = clockAt(game.state.tick);
}

function soldiers(game: Game, count: number, type: 'rifleman' | 'shieldGuard' = 'rifleman'): void {
  for (let k = 0; k < count; k++) spawnSoldier(game, type, 0.5 + k, 7.5);
}

function survivorCount(game: Game): number {
  return [...game.state.entities.values()].filter((e) => e.kind === 'survivor').length;
}

describe('housing and population', () => {
  it('gives the housing one finished building of a type provides, with tech bonuses', () => {
    const game = createTestGame(ROWS);
    expect(buildingHousing(game, 'shack')).toBe(BUILDINGS.shack.housing);
    expect(buildingHousing(game, 'barracks')).toBe(0);
    game.state.economy.tech.researched.push('communityPlan');
    refreshModifiers(game);
    expect(buildingHousing(game, 'shack')).toBe(BUILDINGS.shack.housing + 2);
  });

  it('sums housing of the core and finished shacks, with tech housing bonuses', () => {
    const game = createTestGame(ROWS);
    expect(housingCapacity(game)).toBe(BUILDINGS.core.housing);
    addBuilding(game, 'shack', 0, 0, { complete: true });
    addBuilding(game, 'shack', 8, 0, { complete: false });
    expect(housingCapacity(game)).toBe(BUILDINGS.core.housing + BUILDINGS.shack.housing);
    game.state.economy.tech.researched.push('communityPlan');
    refreshModifiers(game);
    expect(housingCapacity(game)).toBe(BUILDINGS.core.housing + BUILDINGS.shack.housing + 2);
  });

  it('counts survivors, soldiers and recruits waiting in training queues', () => {
    const game = createTestGame(ROWS, { survivors: 3 });
    soldiers(game, 2);
    const barracks = addBuilding(game, 'barracks', 0, 0, { complete: true });
    barracks.trainQueue.push({ unit: 'rifleman', progress: 0, total: 200, paid: {} });
    expect(populationCount(game.state)).toBe(6);
  });

  it('publishes housing, the growth threshold and the daily food upkeep for the UI', () => {
    const game = createTestGame(ROWS, { survivors: 4, origin: 'scholars' });
    soldiers(game, 2, 'shieldGuard');
    populationSystem(game);
    const { economy } = game.state;
    expect(economy.housingCap).toBe(BUILDINGS.core.housing);
    expect(economy.growth.threshold).toBe(GROWTH.baseThreshold + GROWTH.thresholdPerPerson * 6);
    expect(economy.expensePerDay.food).toBe(2 * SOLDIERS.shieldGuard.upkeepFoodPerDay);
  });
});

describe('growth', () => {
  it('fills the growth meter with the food surplus after soldier upkeep', () => {
    const game = createTestGame(ROWS, { survivors: 2, origin: 'scholars' });
    soldiers(game, 3);
    game.state.economy.incomePerDay.food = 50;
    populationSystem(game);
    const surplus = 50 - 3 * SOLDIERS.rifleman.upkeepFoodPerDay;
    expect(game.state.economy.growth.progress).toBeCloseTo((surplus / CYCLE_TICKS) * GROWTH.surplusShare);
  });

  it('applies growthPct and never shrinks the meter on a food deficit', () => {
    const game = createTestGame(ROWS, { survivors: 2, origin: 'scholars' });
    game.state.economy.policies.slots[0] = 'harvestFestival';
    refreshModifiers(game);
    game.state.economy.incomePerDay.food = 44;
    populationSystem(game);
    expect(game.state.economy.growth.progress).toBeCloseTo((44 / CYCLE_TICKS) * 1.4);
    soldiers(game, 30);
    const before = game.state.economy.growth.progress;
    populationSystem(game);
    expect(game.state.economy.growth.progress).toBe(before);
  });

  it('gives birth to a survivor at the core when the meter is full, carrying the excess', () => {
    const game = createTestGame(ROWS, { survivors: 2, origin: 'scholars' });
    const threshold = GROWTH.baseThreshold + GROWTH.thresholdPerPerson * 2;
    game.state.economy.growth.progress = threshold + 3;
    populationSystem(game);
    expect(survivorCount(game)).toBe(3);
    expect(game.state.stats.survivorsBorn).toBe(1);
    expect(game.state.economy.growth.progress).toBeCloseTo(3);
    const born = [...game.state.entities.values()].filter((e) => e.kind === 'survivor').at(-1)!;
    const core = game.state.entities.get(game.state.coreId) as Building;
    expect(Math.abs(born.x - core.x)).toBeLessThan(3);
    expect(Math.abs(born.y - core.y)).toBeLessThan(3);
    expect(drainEvents(game)).toContainEqual({ type: 'survivorJoined', unitId: born.id, source: 'growth' });
  });

  it('holds a full meter while housing is full and releases it once a shack is finished', () => {
    const game = createTestGame(ROWS, { survivors: BUILDINGS.core.housing, origin: 'scholars' });
    game.state.economy.growth.progress = 500;
    populationSystem(game);
    expect(survivorCount(game)).toBe(BUILDINGS.core.housing);
    expect(game.state.economy.growth.progress).toBe(game.state.economy.growth.threshold);
    addBuilding(game, 'shack', 0, 0, { complete: true });
    populationSystem(game);
    expect(survivorCount(game)).toBe(BUILDINGS.core.housing + 1);
  });
});

describe('soldier upkeep and hunger', () => {
  it('feeds soldiers once at dusk', () => {
    const game = createTestGame(ROWS, { origin: 'scholars' });
    soldiers(game, 3);
    game.state.economy.resources.food = 20;
    setPhase(game, 1, 'day');
    populationSystem(game);
    expect(game.state.economy.resources.food).toBe(20);
    setPhase(game, 1, 'dusk');
    populationSystem(game);
    const need = 3 * SOLDIERS.rifleman.upkeepFoodPerDay;
    expect(game.state.economy.resources.food).toBe(20 - need);
    expect(game.state.economy.upkeep).toEqual({ hungry: false, lastSettledDay: 1 });
    game.state.clock = clockAt(game.state.tick + 10);
    populationSystem(game);
    expect(game.state.economy.resources.food).toBe(20 - need);
  });

  it('makes soldiers hungry for the night when food runs short, and fed again next dusk', () => {
    const game = createTestGame(ROWS, { origin: 'scholars' });
    soldiers(game, 4, 'shieldGuard');
    game.state.economy.resources.food = 5;
    setPhase(game, 1, 'dusk');
    populationSystem(game);
    expect(game.state.economy.resources.food).toBe(0);
    expect(game.state.economy.upkeep.hungry).toBe(true);
    expect(drainEvents(game)).toContainEqual({ type: 'hunger', hungry: true });
    setPhase(game, 1, 'night');
    populationSystem(game);
    expect(game.state.economy.upkeep.hungry).toBe(true);
    game.state.economy.resources.food = 100;
    setPhase(game, 2, 'dusk');
    populationSystem(game);
    expect(game.state.economy.upkeep).toEqual({ hungry: false, lastSettledDay: 2 });
    expect(drainEvents(game)).toContainEqual({ type: 'hunger', hungry: false });
  });

  it('applies soldierUpkeepPct from origins and policies', () => {
    const militia = createTestGame(ROWS, { origin: 'militia' });
    soldiers(militia, 10);
    expect(dailyUpkeep(militia)).toBeCloseTo(10 * SOLDIERS.rifleman.upkeepFoodPerDay * 0.7);
    militia.state.economy.policies.slots[0] = 'rationing';
    refreshModifiers(militia);
    expect(dailyUpkeep(militia)).toBeCloseTo(10 * SOLDIERS.rifleman.upkeepFoodPerDay * 0.2);
  });

  it('turns a food shortage into hunger over a real day', () => {
    const game = createTestGame(ROWS, { origin: 'scholars' });
    soldiers(game, 12, 'shieldGuard');
    game.state.economy.resources.food = 0;
    // Through the first tick of dusk: the core's food since dawn was not enough for 12 shield guards.
    while (game.state.tick <= DAY_TICKS - DUSK_TICKS) stepGame(game);
    expect(game.state.clock.phase).toBe('dusk');
    expect(game.state.economy.resources.food).toBe(0);
    while (game.state.tick <= DAY_TICKS) stepGame(game);
    expect(game.state.clock.phase).toBe('night');
    expect(game.state.economy.upkeep.hungry).toBe(true);
  });
});
