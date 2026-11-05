import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, HIVE, MUTANTS, NEST } from '../data/combat';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { stepGame } from '../pipeline';
import type { Mutant, Nest } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS } from '../time';
import { spawnMutant } from '../world/entities';

const ROWS = [
  '...............................',
  '..NN...........................',
  '..NN...........................',
  '...............................',
  '...............................',
  '..............CCC..............',
  '..............CCC..............',
  '..............CCC..........HHH.',
  '...........................HHH.',
  '...........................HHH.',
  '...............................',
];

function nests(game: Game): { nest: Nest; hive: Nest } {
  const all = [...game.state.entities.values()].filter((e): e is Nest => e.kind === 'nest');
  return { nest: all.find((n) => !n.isHive)!, hive: all.find((n) => n.isHive)! };
}

function guardsOf(game: Game, n: Nest): Mutant[] {
  return [...game.state.entities.values()].filter((e): e is Mutant => e.kind === 'mutant' && e.ai.mode === 'guard' && e.ai.homeNestId === n.id);
}

/** Steps to `tick`, healing the core after every step so multi-night runs never end early. */
function runUntil(game: Game, tick: number): void {
  const core = game.state.entities.get(game.state.coreId)!;
  while (game.state.tick < tick) {
    stepGame(game);
    if (game.state.outcome.status !== 'playing') throw new Error('game ended');
    core.hp = core.maxHp;
  }
}

describe('nests', () => {
  it('post day guards at the start: base + per level, from the guard mix, near the nest', () => {
    const game = createTestGame(ROWS);
    stepGame(game);
    const { nest, hive } = nests(game);
    const guards = guardsOf(game, nest);
    expect(guards).toHaveLength(NEST.guardsBase + NEST.guardsPerLevel);
    expect(guardsOf(game, hive)).toHaveLength(HIVE.guardsBase + HIVE.guardsPerLevel);
    for (const g of guards) {
      expect(NEST.guardMix[g.type]).toBeGreaterThan(0);
      expect(Math.hypot(g.x - nest.x, g.y - nest.y)).toBeLessThanOrEqual(NEST.guardRadius);
    }
  });

  it('scales guards with difficulty', () => {
    const game = createTestGame(ROWS, { difficulty: 'hard' });
    stepGame(game);
    const g = guardsOf(game, nests(game).nest)[0]!;
    expect(g.maxHp).toBeCloseTo(MUTANTS[g.type].hp * DIFFICULTIES.hard.mutantHpPct);
    expect(g.ai.damagePct).toBeCloseTo(DIFFICULTIES.hard.mutantDamagePct - 1);
  });

  it('level up every dawn, gaining hp, and refill their guards', () => {
    const game = createTestGame(ROWS);
    stepGame(game);
    const { nest } = nests(game);
    guardsOf(game, nest)[0]!.hp = 0;
    nest.hp -= 100;
    drainEvents(game);
    runUntil(game, CYCLE_TICKS + 1);
    expect(nest.growth.level).toBe(2);
    expect(nest.maxHp).toBe(NEST.hp + NEST.hpPerLevel);
    expect(nest.hp).toBe(NEST.hp + NEST.hpPerLevel - 100);
    expect(drainEvents(game)).toContainEqual({ type: 'nestLevelUp', nestId: nest.id, level: 2 });
    expect(guardsOf(game, nest)).toHaveLength(NEST.guardsBase + 2 * NEST.guardsPerLevel);
  });

  it('stop at their max level', () => {
    const game = createTestGame(ROWS);
    stepGame(game);
    const { nest } = nests(game);
    nest.growth.level = NEST.maxLevel;
    runUntil(game, CYCLE_TICKS + 1);
    expect(nest.growth.level).toBe(NEST.maxLevel);
  });

  it('absorb retreating mutants that reach them, banking threat into extra levels', () => {
    const game = createTestGame(ROWS);
    stepGame(game);
    const { nest } = nests(game);
    const m = spawnMutant(game, 'crawler', nest.x + 1.6, nest.y, { mode: 'retreat', homeNestId: nest.id });
    const n = Math.ceil(NEST.growthPointsPerLevel / MUTANTS.crawler.threat);
    for (let k = 1; k < n; k++) spawnMutant(game, 'crawler', nest.x + 1.6, nest.y + 0.3 * k, { mode: 'retreat', homeNestId: nest.id });
    drainEvents(game);
    for (let t = 0; t < 60; t++) stepGame(game);
    expect(game.state.entities.has(m.id)).toBe(false);
    expect(nest.growth.level).toBe(2);
    expect(nest.growth.points).toBeCloseTo(n * MUTANTS.crawler.threat - NEST.growthPointsPerLevel);
    expect(drainEvents(game)).toContainEqual({ type: 'nestLevelUp', nestId: nest.id, level: 2 });
  });

  it('turn orphaned guards into retreaters heading for another nest', () => {
    const game = createTestGame(ROWS);
    stepGame(game);
    const { nest, hive } = nests(game);
    const guards = guardsOf(game, nest);
    nest.hp = 0;
    stepGame(game);
    stepGame(game);
    for (const g of guards) expect(g.ai).toMatchObject({ mode: 'retreat', homeNestId: hive.id });
  });
});
