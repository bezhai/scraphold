/** Reproducible v2 stress measurements; fixture setup uses the simulation's debug scenarios. */
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createGame, drainEvents, stepGame } from '../sim';
import { deployArmy, releaseHorde } from '../sim/scenarios';
import { CYCLE_TICKS, DAY_TICKS } from '../sim/time';

function stress(seed: string) {
  const game = createGame({ seed, origin: 'scholars', difficulty: 'normal' });
  game.state.tick = DAY_TICKS + 100;
  const army = deployArmy(game, 80);
  for (const soldier of army) soldier.hp = soldier.maxHp = 1e6;
  const horde = releaseHorde(game, 300, { hpPct: 100, damagePct: -0.8 });
  game.state.entities.get(game.state.coreId)!.hp = 1e6;
  expect(army).toHaveLength(80);
  expect(horde).toHaveLength(300);
  return game;
}

it('measures large-map combat ticks and the mass-retreat dawn tick', { timeout: 30_000 }, () => {
  const warmup = stress('v2-perf-warmup');
  for (let i = 0; i < 100; i++) { stepGame(warmup); drainEvents(warmup); }
  const game = stress('v2-perf');
  const times: number[] = [];
  for (let i = 0; i < 300; i++) {
    const start = performance.now();
    stepGame(game);
    times.push(performance.now() - start);
    drainEvents(game);
  }
  expect(game.state.outcome.status).toBe('playing');
  const endMutants = [...game.state.entities.values()].filter((e) => e.kind === 'mutant').length;
  const dawnTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const dawn = stress(`v2-perf-dawn-${i}`);
    dawn.state.tick = CYCLE_TICKS - 1;
    stepGame(dawn);
    drainEvents(dawn);
    const attackers = [...dawn.state.entities.values()].filter((e) => e.kind === 'mutant' && e.ai.mode === 'assault').map((e) => e.id);
    expect(attackers).toHaveLength(300);
    const start = performance.now();
    stepGame(dawn);
    dawnTimes.push(performance.now() - start);
    // A retreating unit already beside its nest can be absorbed during this same tick.
    for (const id of attackers) {
      const mutant = dawn.state.entities.get(id);
      if (mutant?.kind === 'mutant') expect(mutant.ai.mode).toBe('retreat');
    }
  }
  const round = (n: number) => Number(n.toFixed(3));
  console.log(JSON.stringify({
    map: [game.state.map.width, game.state.map.height], samples: times.length,
    soldiers: 80, mutantsStart: 300, mutantsEnd: endMutants,
    averageMs: round(times.reduce((sum, n) => sum + n, 0) / times.length), maxMs: round(Math.max(...times)),
    dawnMs: dawnTimes.map(round), dawnMaxMs: round(Math.max(...dawnTimes)),
  }));
});
