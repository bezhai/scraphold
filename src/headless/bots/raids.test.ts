import { expect, it } from 'vitest';
import { createGame } from '../../sim';
import { removeEntity, spawnSoldier } from '../../sim/world/entities';
import { clockAt, CYCLE_TICKS, DAY_TICKS, DUSK_TICKS } from '../../sim/time';
import { assignRoles, raid, raidTargets } from './army';
import { createMemory, makeContext } from './strategy';
import { snapshot } from './view';
import { Turn } from './turn';
import { estimateThreat } from './intel';
import { nestRaider } from './nestRaider';
it('commits a sufficiently strong hive force through nightfall instead of requiring a round trip', () => {
  const game = createGame({ seed: 'hive-commit', origin: 'scavengers', difficulty: 'normal' });
  game.state.tick = 8 * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS - 20;
  game.state.clock = clockAt(game.state.tick);
  const hive = [...game.state.entities.values()].find(entity => entity.kind === 'nest' && entity.isHive)!;
  if (hive.kind === 'nest') hive.discovered = true;
  const core = game.state.entities.get(game.state.coreId)!;
  const memory = createMemory();
  for (let i = 0; i < 50; i++) {
    const soldier = spawnSoldier(game, 'rifleman', core.x, core.y + 3);
    memory.roles.set(soldier.id, 'garrison');
  }
  const snap = snapshot(game);
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  const strategy = nestRaider();
  strategy.raids = { fromDay: 2, homeGuard: 3, powerRatio: 1, hive: { fromDay: 6, minPower: 30, homeGuard: 3 } };
  raid(ctx, strategy);
  expect(memory.raid?.targetId).toBe(hive.id);
});

it('considers the hive by day eight and does not create a day-eleven army jump', () => {
  const game = createGame({ seed: 'hive-no-date-gate', origin: 'militia', difficulty: 'normal' });
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  const strategy = nestRaider();
  expect(strategy.raids!.hive!.fromDay).toBeLessThanOrEqual(8);
  ctx.day = 10;
  const before = strategy.army(ctx);
  ctx.day = 11;
  expect(strategy.army(ctx)).toEqual(before);
});


it('includes visible hive durability in the required assault power', () => {
  const game = createGame({ seed: 'hive-durability-estimate', origin: 'militia', difficulty: 'normal' });
  const hive = [...game.state.entities.values()].find(entity => entity.kind === 'nest' && entity.isHive)!;
  if (hive.kind !== 'nest') throw new Error('expected hive');
  hive.discovered = true;
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.day = 8;
  const plan = nestRaider().raids!;
  hive.hp = 1000;
  expect(raidTargets(ctx, plan, { combat: 40, structure: 40 })).toContain(hive);
  hive.hp = 400000;
  expect(raidTargets(ctx, plan, { combat: 40, structure: 40 })).not.toContain(hive);
});

it('keeps the larger home garrison during a sustained hive assault', () => {
  const game = createGame({ seed: 'hive-home-defense', origin: 'scavengers', difficulty: 'normal' });
  const hive = [...game.state.entities.values()].find(entity => entity.kind === 'nest' && entity.isHive)!;
  if (hive.kind === 'nest') hive.discovered = true;
  const core = game.state.entities.get(game.state.coreId)!;
  const memory = createMemory();
  for (let i = 0; i < 50; i++) {
    const soldier = spawnSoldier(game, 'rifleman', core.x, core.y + 3);
    memory.roles.set(soldier.id, 'garrison');
  }
  const snap = snapshot(game);
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.day = 8;
  const strategy = nestRaider();
  strategy.raids!.hive = { fromDay: 8, minPower: 0, homeGuard: 8 };
  raid(ctx, strategy);
  expect(memory.raid?.targetId).toBe(hive.id);
  expect([...memory.roles.values()].filter(role => role === 'garrison')).toHaveLength(8);
  const fallen = [...memory.roles].find(([, role]) => role === 'garrison')![0];
  removeEntity(game, game.state.entities.get(fallen)!);
  const replacement = spawnSoldier(game, 'rifleman', core.x, core.y + 3);
  ctx.snap = snapshot(game);
  assignRoles(ctx, strategy);
  expect(memory.roles.get(replacement.id)).toBe('garrison');
});

it('keeps a damaged hive assault fighting because returning home cannot heal soldiers', () => {
  const game = createGame({ seed: 'hive-wounded-commit', origin: 'militia', difficulty: 'hard' });
  const hive = [...game.state.entities.values()].find(entity => entity.kind === 'nest' && entity.isHive)!;
  if (hive.kind === 'nest') hive.discovered = true;
  const soldier = spawnSoldier(game, 'rifleman', hive.x + 4, hive.y);
  soldier.hp = soldier.maxHp * 0.2;
  const memory = createMemory();
  memory.roles.set(soldier.id, 'raid');
  memory.raid = { targetId: hive.id, startPower: 10 };
  const snap = snapshot(game);
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  raid(ctx, nestRaider());
  expect(memory.raid?.targetId).toBe(hive.id);
});

it.each([[0.5, true], [0.1, false]] as const)('checks hive firepower separately from guard survivability at %s health', (health, canAttack) => {
  const game = createGame({ seed: 'hive-wounded-firepower', origin: 'militia', difficulty: 'hard' });
  const hive = [...game.state.entities.values()].find(entity => entity.kind === 'nest' && entity.isHive)!;
  if (hive.kind === 'nest') hive.discovered = true;
  const core = game.state.entities.get(game.state.coreId)!;
  const memory = createMemory();
  for (let i = 0; i < 60; i++) {
    const soldier = spawnSoldier(game, 'rifleman', core.x, core.y + 3);
    soldier.hp = soldier.maxHp * health;
    memory.roles.set(soldier.id, 'garrison');
  }
  const snap = snapshot(game);
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.day = 8;
  raid(ctx, nestRaider());
  expect(memory.raid?.targetId === hive.id).toBe(canAttack);
});
