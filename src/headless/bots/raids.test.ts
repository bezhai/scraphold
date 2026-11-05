import { expect, it } from 'vitest';
import { createGame, hiveDamageReduction, ordinaryNestsLeft, type Game, type Nest } from '../../sim';
import { removeEntity, spawnSoldier } from '../../sim/world/entities';
import { clockAt, CYCLE_TICKS, DAY_TICKS, DUSK_TICKS } from '../../sim/time';
import { assignRoles, hiveAssaultPower, raid, raidTargets } from './army';
import { createMemory, makeContext } from './strategy';
import { snapshot } from './view';
import { Turn } from './turn';
import { estimateThreat } from './intel';
import { nestRaider } from './nestRaider';

/** The bare hive: its shield is gone once the ordinary nests are. */
function clearOrdinaryNests(game: Game): void {
  for (const e of [...game.state.entities.values()]) if (e.kind === 'nest' && !e.isHive) removeEntity(game, e);
}
it('commits a sufficiently strong hive force through nightfall instead of requiring a round trip', () => {
  const game = createGame({ seed: 'hive-commit', origin: 'scavengers', difficulty: 'normal' });
  clearOrdinaryNests(game);
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
  clearOrdinaryNests(game);
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
  clearOrdinaryNests(game);
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

function hiveWorld(seed: string, riflemen: number) {
  const game = createGame({ seed, origin: 'militia', difficulty: 'normal' });
  const nests = [...game.state.entities.values()].filter((e): e is Nest => e.kind === 'nest');
  const hive = nests.find(n => n.isHive)!;
  const ordinary = nests.filter(n => !n.isHive);
  hive.discovered = true;
  const core = game.state.entities.get(game.state.coreId)!;
  const memory = createMemory();
  for (let i = 0; i < riflemen; i++) memory.roles.set(spawnSoldier(game, 'rifleman', core.x, core.y + 3).id, 'garrison');
  const context = () => {
    const snap = snapshot(game);
    const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
    ctx.day = 9;
    return ctx;
  };
  return { game, hive, ordinary, memory, context };
}

it('clears a discovered ordinary nest before the hive even when it could take both', () => {
  const { game, hive, ordinary, memory, context } = hiveWorld('hive-order', 60);
  for (const n of ordinary.slice(1)) removeEntity(game, n);
  ordinary[0]!.discovered = true;
  const ctx = context();
  const targets = raidTargets(ctx, nestRaider().raids!, { combat: 200, structure: 200 });
  expect(targets.map(n => n.id)).toEqual([ordinary[0]!.id, hive.id]);
  raid(ctx, nestRaider());
  expect(memory.raid?.targetId).toBe(ordinary[0]!.id);
});

it('weighs the hive shield from the ordinary nests left before attacking the hive', () => {
  const { game, hive, ordinary, context } = hiveWorld('hive-shield-plan', 0);
  const plan = nestRaider().raids!;
  // Enough firepower for the bare hive with a 25% margin, not for the hive behind its shield.
  const left = ordinaryNestsLeft(game.state);
  expect(hiveDamageReduction(left)).toBeGreaterThan(0.25);
  const bare = hiveAssaultPower(hive, 1);
  const power = { combat: 200, structure: bare * 1.25 };
  expect(raidTargets(context(), plan, power)).not.toContain(hive);
  for (const n of ordinary) removeEntity(game, n);
  expect(raidTargets(context(), plan, power)).toContain(hive);
});

it('sizes the raider army for the hive the nests no longer shield', () => {
  const { game, ordinary, context } = hiveWorld('hive-army-size', 0);
  game.state.economy.tech.researched.push('expeditionPack');
  const strategy = nestRaider();
  const shielded = strategy.army(context());
  for (const n of ordinary) removeEntity(game, n);
  expect(strategy.army(context())).toEqual(shielded);
});

it('hands the raiders back to automatic control when the raid ends, instead of walking them home', () => {
  const { game, ordinary, memory, context } = hiveWorld('raid-ends', 0);
  const nest = ordinary[0]!;
  const raiders = [0, 1, 2].map(k => spawnSoldier(game, 'rifleman', nest.x + 3, nest.y + k));
  for (const s of raiders) {
    s.control = 'player';
    s.order = { type: 'attackMove', x: nest.x, y: nest.y };
    memory.roles.set(s.id, 'raid');
  }
  // One raider's order already ended: the soldier AI has it, so it needs no command.
  raiders[2]!.control = 'auto';
  raiders[2]!.order = { type: 'idle' };
  memory.raid = { targetId: nest.id, startPower: 3 };
  removeEntity(game, nest);
  const ctx = context();
  raid(ctx, nestRaider());
  expect(ctx.turn.commands()).toEqual([{ type: 'stop', unitIds: [raiders[0]!.id, raiders[1]!.id] }]);
  expect(memory.raid).toBeNull();
  for (const s of raiders) expect(memory.roles.get(s.id)).toBe('garrison');
});
