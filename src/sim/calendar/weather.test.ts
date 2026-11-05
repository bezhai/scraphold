import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TECHS, POLICIES } from '../data/economy';
import { refreshModifiers } from '../game';
import { calendarSystem } from './calendar';
import { weatherSystem } from './weather';
import { WEATHER, RADIO_BROADCASTS, FINAL_RADIO_BROADCAST } from '../data/calendar';
import { NIGHTS, DIFFICULTIES, MUTANTS, type MutantType } from '../data/combat';
import { createTestGame } from '../testing';
import { DAY_TICKS, DUSK_TICKS, CYCLE_TICKS, TOTAL_NIGHTS, TICKS_PER_SECOND, clockAt } from '../time';
import { planNight, nightSystem } from '../combat/night';
import { addBuilding, spawnSurvivor, enterBuilding } from '../world/entities';
import { visionRadius } from '../world/fog';
import type { NightType } from '../data/calendar';

const ROWS = ['........................', '...CCC............NN....', '...CCC............NN....', '...CCC..................', '........................', '........................'];
function fixture(type: NightType, day = 6) {
  const g = createTestGame(ROWS);
  g.calendarPlan[day - 1] = type;
  g.state.tick = (day - 1) * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS;
  g.state.clock = clockAt(g.state.tick);
  calendarSystem(g);
  g.state.map.spawnPoints = [{ direction: 'E', tile: 23 }, { direction: 'W', tile: 0 }, { direction: 'N', tile: 10 }, { direction: 'S', tile: 130 }];
  const nest = [...g.state.entities.values()].find((e) => e.kind === 'nest')!;
  if (nest.kind === 'nest') nest.growth.level = 3;
  return g;
}

describe('night types and broadcast', () => {
  it('copies every radio line verbatim from the narrative source', () => {
    const narrative = readFileSync(new URL('../../../docs/narrative.md', import.meta.url), 'utf8');
    for (const text of [...Object.values(RADIO_BROADCASTS).flat(), FINAL_RADIO_BROADCAST]) expect(narrative).toContain(text);
  });

  it('keeps only nest groups on a calm night and none during a storm', () => {
    const calm = planNight(fixture('calm'), 6);
    expect(calm.groups.length).toBeGreaterThan(0);
    expect(calm.groups.every((g) => g.nestId !== 0)).toBe(true);
    expect(planNight(fixture('rustStorm'), 6).groups).toEqual([]);
  });
  it('keeps regular raids and makes surges larger, with more directions and a boss', () => {
    const raid = planNight(fixture('raid'), 6);
    const surge = planNight(fixture('surge'), 6);
    const edges = (plan: typeof raid) => plan.groups.filter((g) => g.nestId === 0);
    expect(edges(raid)).toHaveLength(NIGHTS[5]!.directions);
    expect(edges(surge).length).toBeGreaterThan(edges(raid).length);
    const threat = (plan: typeof raid) => edges(plan).reduce((sum, group) => sum + Object.entries(group.mutants).reduce((n, [type, count]) => n + MUTANTS[type as MutantType].threat * count, 0), 0);
    expect(threat(surge)).toBeGreaterThan(threat(raid) * 1.3);
    const hard = fixture('surge');
    hard.state.options.difficulty = 'hard';
    expect(threat(planNight(hard, 6))).toBeGreaterThan(threat(surge));
    expect(surge.groups.some((g) => g.boss !== null)).toBe(true);
    expect(planNight(fixture('raid', 5), 5).groups.every((g) => g.boss === null)).toBe(true);
    expect(planNight(fixture('surge', TOTAL_NIGHTS), TOTAL_NIGHTS).groups.some((g) => g.boss !== null)).toBe(true);
    expect(DIFFICULTIES.hard.surgeBudgetMultiplier).toBeGreaterThan(DIFFICULTIES.normal.surgeBudgetMultiplier);
  });
  it('conceals directions in dense fog even with a completed watchtower', () => {
    const g = fixture('denseFog');
    addBuilding(g, 'watchtower', 10, 3, { complete: true });
    nightSystem(g);
    expect(g.state.night.plan!.groups.length).toBeGreaterThan(0);
    expect(g.state.night.forecast).toMatchObject({ directionsKnown: false, precise: false, groups: [] });
    nightSystem(g);
    expect(g.state.night.forecast!.groups).toEqual([]);
    g.state.clock.phase = 'night';
    const core = g.state.entities.get(g.state.coreId)!;
    expect(visionRadius(g, core)).toBeCloseTo(core.vision * WEATHER.denseFogVisionMultiplier);
    g.state.clock.phase = 'dusk';
    expect(visionRadius(g, core)).toBe(core.vision);
  });
  it.each(['calm', 'raid', 'rustStorm', 'denseFog', 'surge'] as const)('selects exact narrative lines deterministically for %s', (type) => {
    const a = fixture(type), b = fixture(type);
    nightSystem(a); nightSystem(b);
    expect(a.state.night.broadcast).toEqual(b.state.night.broadcast);
    expect(RADIO_BROADCASTS[type]).toContain(a.state.night.broadcast!.text);
    expect(a.state.night.broadcast!.type).toBe(type);
  });
  it('uses the special final broadcast', () => {
    const g = fixture('surge', TOTAL_NIGHTS);
    nightSystem(g);
    expect(g.state.night.broadcast!.text).toBe(FINAL_RADIO_BROADCAST);
  });
});

describe('rust storm', () => {
  it('aggregates storm reductions from technology and policy through the normal modifier pipeline', () => {
    const techEffects = TECHS.reinforcement.effects;
    const policyEffects = POLICIES.salvageDrive.effects;
    try {
      TECHS.reinforcement.effects = [...techEffects, { kind: 'global', stat: 'stormBuildingDamageTakenPct', value: -0.25 }];
      POLICIES.salvageDrive.effects = [...policyEffects, { kind: 'global', stat: 'stormBuildingDamageTakenPct', value: -0.25 }, { kind: 'global', stat: 'stormOutdoorDamageTakenPct', value: -1 }];
      const g = fixture('rustStorm');
      const building = addBuilding(g, 'salvageYard', 10, 1, { complete: true });
      const worker = spawnSurvivor(g, 8.5, 4.5);
      g.state.economy.tech.researched.push('reinforcement');
      g.state.economy.policies.slots[0] = 'salvageDrive';
      refreshModifiers(g);
      g.state.clock.phase = 'night';
      weatherSystem(g);
      expect(g.modifiers.global.stormBuildingDamageTakenPct).toBe(-0.5);
      expect(building.maxHp - building.hp).toBeCloseTo(building.maxHp * WEATHER.buildingDamagePerSecond / TICKS_PER_SECOND / 2);
      expect(worker.hp).toBe(worker.maxHp);
    } finally {
      TECHS.reinforcement.effects = techEffects;
      POLICIES.salvageDrive.effects = policyEffects;
    }
  });

  it('damages buildings and outdoor survivors, protects indoor workers, and supports reductions', () => {
    const g = fixture('rustStorm');
    g.state.clock.phase = 'night';
    const building = addBuilding(g, 'salvageYard', 10, 1, { complete: true });
    const outside = spawnSurvivor(g, 8.5, 4.5), inside = spawnSurvivor(g, 9.5, 4.5);
    enterBuilding(g, inside, building);
    const hp = [building.hp, outside.hp, inside.hp];
    weatherSystem(g);
    const damage = [hp[0]! - building.hp, hp[1]! - outside.hp];
    expect(damage[0]).toBeGreaterThan(0); expect(damage[1]).toBeGreaterThan(0);
    expect(inside.hp).toBe(hp[2]);
    building.hp = hp[0]!; outside.hp = hp[1]!;
    g.modifiers.global.stormBuildingDamageTakenPct = -0.5;
    g.modifiers.global.stormOutdoorDamageTakenPct = -1;
    weatherSystem(g);
    expect(hp[0]! - building.hp).toBeCloseTo(damage[0]! / 2);
    expect(outside.hp).toBe(hp[1]);
    const core = g.state.entities.get(g.state.coreId)!;
    core.hp = 1;
    weatherSystem(g);
    expect(core.hp).toBe(1);
  });
  it('records environmental deaths and applies sight reduction for exactly the following day', () => {
    const g = fixture('rustStorm');
    g.state.clock.phase = 'night';
    const outside = spawnSurvivor(g, 8.5, 4.5);
    outside.hp = WEATHER.outdoorDamagePerSecond / TICKS_PER_SECOND / 2;
    weatherSystem(g);
    expect(outside.hp).toBe(0);
    expect(g.state.stats.survivorsLost).toBe(1);
    g.state.tick = 6 * CYCLE_TICKS; g.state.clock = clockAt(g.state.tick);
    calendarSystem(g);
    const core = g.state.entities.get(g.state.coreId)!;
    expect(visionRadius(g, core)).toBeCloseTo(core.vision * WEATHER.postStormVisionMultiplier);
    g.state.tick += DAY_TICKS; g.state.clock = clockAt(g.state.tick);
    g.state.calendar.nights[6]!.type = 'raid';
    expect(visionRadius(g, core)).toBe(core.vision);
  });
});
