import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, MUTANTS, NEST, NIGHTS, NIGHT_SPAWN, type Difficulty, type MutantType } from '../data/combat';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { tileIndex } from '../map/grid';
import { stepGame } from '../pipeline';
import type { Mutant, Nest } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS, secondsToTicks } from '../time';
import { addBuilding, spawnMutant } from '../world/entities';
import { followFlowField } from '../world/movement';
import type { AttackGroup } from './model';
import { planNight, forecastFor } from './night';

const W = 40;
const H = 30;

function rows(withNest: boolean): string[] {
  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      if (x >= 18 && x <= 20 && y >= 13 && y <= 15) row += 'C';
      else if (withNest && x >= 2 && x <= 3 && y >= 2 && y <= 3) row += 'N';
      else row += '.';
    }
    out.push(row);
  }
  return out;
}

function game(opts: { seed?: string; difficulty?: Difficulty; nest?: boolean } = {}): Game {
  const g = createTestGame(rows(opts.nest ?? false), { seed: opts.seed ?? 'night-test', difficulty: opts.difficulty ?? 'normal' });
  // These legacy combat tests exercise ordinary raids; calendar constraints have separate tests.
  g.calendarPlan.fill('raid');
  for (const night of g.state.calendar.nights) if (night.type !== null) night.type = 'raid';
  g.state.map.spawnPoints = [
    { direction: 'N', tile: tileIndex(g.state.map, 19, 0) },
    { direction: 'E', tile: tileIndex(g.state.map, W - 1, 14) },
    { direction: 'S', tile: tileIndex(g.state.map, 19, H - 1) },
    { direction: 'W', tile: tileIndex(g.state.map, 0, 14) },
  ];
  return g;
}

/** Steps to `tick`, healing the core after every step so multi-night runs never end early. */
function runUntil(g: Game, tick: number): void {
  const core = g.state.entities.get(g.state.coreId)!;
  while (g.state.tick < tick) {
    stepGame(g);
    if (g.state.outcome.status !== 'playing') throw new Error('game ended');
    core.hp = core.maxHp;
  }
}

const DUSK_START = DAY_TICKS - DUSK_TICKS;
const NIGHT_START = DAY_TICKS;

function threatOf(group: AttackGroup): number {
  let t = 0;
  for (const [type, n] of Object.entries(group.mutants)) t += MUTANTS[type as MutantType].threat * (n ?? 0);
  return t;
}

function mutants(g: Game): Mutant[] {
  return [...g.state.entities.values()].filter((e): e is Mutant => e.kind === 'mutant');
}

describe('dusk plan and forecast', () => {
  it('plans the coming night at dusk from the night budget and announces it', () => {
    const g = game();
    runUntil(g, DUSK_START);
    expect(g.state.night.plan).toBeNull();
    runUntil(g, DUSK_START + 1);
    const plan = g.state.night.plan!;
    expect(plan.night).toBe(1);
    expect(plan.groups).toHaveLength(NIGHTS[0]!.directions);
    const total = plan.groups.reduce((sum, gr) => sum + threatOf(gr), 0);
    expect(total).toBeLessThanOrEqual(NIGHTS[0]!.budget);
    expect(total).toBeGreaterThan(NIGHTS[0]!.budget - 1.01);
    expect(drainEvents(g)).toContainEqual({ type: 'forecastReady', night: 1 });
    const f = g.state.night.forecast!;
    expect(f).toMatchObject({ night: 1, precise: false });
    expect(f.groups.map((x) => x.direction)).toEqual(plan.groups.map((x) => x.direction));
    expect(f.groups.every((x) => x.counts === null && x.boss === null)).toBe(true);
    expect(f.groups[0]!.size).toBe('small');
  });

  it('is deterministic per seed and varies between seeds', () => {
    const plans = (seed: string) => [3, 7].map((n) => planNight(game({ seed }), n));
    expect(plans('a')).toEqual(plans('a'));
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => JSON.stringify(plans(s)));
    expect(new Set(many).size).toBeGreaterThan(1);
  });

  it('gives exact counts and the boss with a finished watchtower', () => {
    const g = game();
    addBuilding(g, 'watchtower', 10, 10, { complete: true });
    runUntil(g, DUSK_START + 1);
    const f = g.state.night.forecast!;
    expect(f.precise).toBe(true);
    expect(f.groups[0]!.counts).toEqual(g.state.night.plan!.groups[0]!.mutants);
    expect(f.groups[0]!.boss).toBe(false);
  });

  it('upgrades the forecast when a watchtower is finished during the dusk', () => {
    const g = game();
    const tower = addBuilding(g, 'watchtower', 10, 10, { complete: false });
    tower.construction!.total = 1e9;
    runUntil(g, DUSK_START + 5);
    expect(g.state.night.forecast!.precise).toBe(false);
    tower.construction = null;
    stepGame(g);
    expect(g.state.night.forecast!.precise).toBe(true);
  });

  it('spawns exactly the bosses defined for all nights', () => {
    const g = game();
    const bosses = (n: number) => planNight(g, n).groups.flatMap((gr) => (gr.boss ? [gr.boss] : []));
    g.calendarPlan.fill('surge');
    NIGHTS.forEach((def, i) => expect(bosses(i + 1)).toEqual(def.boss ? [def.boss] : []));
  });

  it('scales the edge budget with difficulty', () => {
    const total = (d: Difficulty) => planNight(game({ difficulty: d }), 6).groups.reduce((s, gr) => s + threatOf(gr), 0);
    const budget = NIGHTS[5]!.budget;
    expect(total('hard')).toBeGreaterThan(budget * DIFFICULTIES.hard.nightBudgetPct - 6.01);
    expect(total('easy')).toBeLessThanOrEqual(budget * DIFFICULTIES.easy.nightBudgetPct);
  });

  it('buys runners in whole packs', () => {
    for (const seed of ['p1', 'p2', 'p3']) {
      for (const gr of planNight(game({ seed }), 7).groups) {
        const runners = gr.mutants.runner ?? 0;
        expect(runners % MUTANTS.runner.packSize).toBe(0);
      }
    }
  });

  it('sends extra mutants from every nest above level 1, from beside the nest', () => {
    const g = game({ nest: true });
    const nest = [...g.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    expect(planNight(g, 2).groups.some((gr) => gr.nestId === nest.id)).toBe(false);
    nest.growth.level = 3;
    const group = planNight(g, 2).groups.find((gr) => gr.nestId === nest.id)!;
    expect(threatOf(group)).toBeLessThanOrEqual(2 * NEST.nightThreatPerLevel);
    expect(threatOf(group)).toBeGreaterThan(2 * NEST.nightThreatPerLevel - 6.01);
    expect(group.direction).toBe('NW');
    const tx = group.tile % W;
    const ty = Math.floor(group.tile / W);
    expect(Math.max(Math.abs(tx - 2.5), Math.abs(ty - 2.5))).toBeLessThan(2);
  });
});

describe('night spawning', () => {
  it('spawns every planned mutant during the first seconds of the night, assaulting', () => {
    const g = game();
    for (const e of g.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    runUntil(g, NIGHT_START);
    const plan = g.state.night.plan!;
    const planned = plan.groups.reduce((s, gr) => s + Object.values(gr.mutants).reduce((a, n) => a + (n ?? 0), 0), 0);
    expect(mutants(g)).toHaveLength(0);
    runUntil(g, NIGHT_START + secondsToTicks(NIGHT_SPAWN.spreadSeconds) + 1);
    const spawned = mutants(g);
    expect(spawned).toHaveLength(planned);
    expect(g.state.night.pending).toHaveLength(0);
    for (const m of spawned) {
      expect(m.ai.mode).toBe('assault');
      expect(m.maxHp).toBe(MUTANTS[m.type].hp);
    }
  });

  it('scales spawned mutants with difficulty', () => {
    const g = game({ difficulty: 'hard' });
    runUntil(g, NIGHT_START + secondsToTicks(NIGHT_SPAWN.spreadSeconds) + 1);
    const m = mutants(g)[0]!;
    expect(m.maxHp).toBeCloseTo(MUTANTS[m.type].hp * DIFFICULTIES.hard.mutantHpPct);
    expect(m.ai.damagePct).toBeCloseTo(DIFFICULTIES.hard.mutantDamagePct - 1);
  });

  it('does not spawn the groups of a nest destroyed before they appear', () => {
    const g = game({ nest: true });
    const nest = [...g.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    nest.growth.level = 4;
    runUntil(g, NIGHT_START);
    for (const e of g.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    nest.hp = 0;
    runUntil(g, NIGHT_START + secondsToTicks(NIGHT_SPAWN.spreadSeconds) + 1);
    expect(mutants(g).every((m) => m.ai.homeNestId !== nest.id)).toBe(true);
  });
});

describe('dawn', () => {
  it('sends the attackers that are left back to the nearest nest, which absorbs them and grows', () => {
    const g = game({ nest: true });
    const nest = [...g.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    runUntil(g, NIGHT_START + 5);
    for (const e of g.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    g.state.night.pending = [];
    stepGame(g);
    const late: Mutant[] = [];
    for (let k = 0; k < 6; k++) {
      const m = spawnMutant(g, 'crawler', 10.5 + k * 0.6, 8.5, { mode: 'assault' });
      followFlowField(m);
      late.push(m);
    }
    runUntil(g, CYCLE_TICKS + 1);
    for (const m of late) expect(m.ai).toMatchObject({ mode: 'retreat', homeNestId: nest.id });
    expect(g.state.night.pending).toEqual([]);
    const levelBefore = nest.growth.level;
    runUntil(g, CYCLE_TICKS + secondsToTicks(40));
    for (const m of late) expect(g.state.entities.has(m.id)).toBe(false);
    const gained = 6 * MUTANTS.crawler.threat;
    expect((nest.growth.level - levelBefore) * NEST.growthPointsPerLevel + nest.growth.points).toBeCloseTo(gained);
    expect(drainEvents(g).filter((e) => e.type === 'died' && e.kind === 'mutant' && late.some((m) => m.id === e.entityId))).toEqual([]);
  });

  it('counts the night as survived, and whether it cost a building', () => {
    const g = game();
    runUntil(g, NIGHT_START + 2);
    g.state.stats.buildingsLostTonight = 0;
    runUntil(g, CYCLE_TICKS + 1);
    expect(g.state.stats.nightsSurvived).toBe(1);
    expect(g.state.stats.nightsWithoutBuildingLoss).toBe(1);
    runUntil(g, CYCLE_TICKS + NIGHT_START + 2);
    expect(g.state.stats.buildingsLostTonight).toBe(0);
    g.state.stats.buildingsLostTonight = 1;
    runUntil(g, 2 * CYCLE_TICKS + 1);
    expect(g.state.stats.nightsSurvived).toBe(2);
    expect(g.state.stats.nightsWithoutBuildingLoss).toBe(1);
  });
});

it('omits empty attack groups from both precise and imprecise forecasts', () => {
  const empty: AttackGroup = { baseBudget: 0, direction: 'N', tile: 1, nestId: 0, assaultTargetId: 0, mutants: {}, boss: null };
  for (const precise of [false, true]) expect(forecastFor({ night: 2, groups: [empty] }, precise, 'raid').groups).toEqual([]);
});
