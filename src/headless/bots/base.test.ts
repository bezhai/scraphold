import { describe, expect, it } from 'vitest';
import { applyCommand, type Game } from '../../sim';
import { createTestGame } from '../../sim/testing';
import { addBuilding, enterBuilding, spawnSoldier, spawnSurvivor } from '../../sim/world/entities';
import { SPECIAL_RUINS } from '../../sim/data/ruins';
import { train, visitRuins, repair } from './base';
import { estimateThreat } from './intel';
import { createMemory, makeContext, type Context, type Strategy } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';

const ROWS = ['................', '................', '................', '......CCC.......', '......CCC.......', '......CCC.......', '................', '................'];

/** Wants four riflemen and saves more scrap than the game has for some building. */
const saver: Strategy = {
  name: 'economy',
  research: [],
  policies: () => [],
  build: () => null,
  army: () => ({ rifleman: 4 }),
  minWorkers: () => 0,
  workforce: () => ({}),
  reserve: () => ({ scrap: 1000 }),
  repairs: { crew: 0, below: 0 },
  defense: { rallyDistance: 3, engageRadius: 5 },
  raids: null,
  scouts: 0,
  promotion: () => null,
};

function contextOf(game: Game): Context {
  const snap = snapshot(game);
  const memory = createMemory();
  return makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
}

function withBarracks(soldiers: number): Game {
  const game = createTestGame(ROWS);
  addBuilding(game, 'barracks', 1, 1, { complete: true });
  for (let k = 0; k < 3; k++) spawnSurvivor(game, 8, 7);
  for (let k = 0; k < soldiers; k++) spawnSoldier(game, 'rifleman', 3, 7);
  game.state.economy.resources = { scrap: 200, food: 300, fuel: 0, research: 0 };
  return game;
}

const trainOrders = (ctx: Context) => ctx.turn.commands().filter((c) => c.type === 'train');

describe('train', () => {
  it('keeps the strategy reserve while the army is close to its wish', () => {
    const ctx = contextOf(withBarracks(3));
    train(ctx, saver);
    expect(trainOrders(ctx)).toEqual([]);
  });

  it('spends the reserve when the army is far behind its wish', () => {
    const ctx = contextOf(withBarracks(0));
    train(ctx, saver);
    expect(trainOrders(ctx).length).toBeGreaterThan(0);
  });
});


describe('special ruin visits', () => {
  it.each(['supplyPod', 'warehouse'] as const)('uses the ordinary exploration strategy for %s', kind => {
    const game = createTestGame(['..............', '............r.', '..............', '....CCC.......', '....CCC.......', '....CCC.......', '..............']);
    const ruin = game.state.map.ruins[0]!;
    ruin.kind = kind;
    ruin.reward = SPECIAL_RUINS[kind].reward;
    const visitor = spawnSurvivor(game, 8, 6);
    const ctx = contextOf(game);
    visitRuins(ctx, 30);
    expect(ctx.turn.commands()).toContainEqual({ type: 'move', unitIds: [visitor.id], x: 12.5, y: 1.5 });
  });
});

describe('survivors the built-in manager keeps busy', () => {
  const RUIN_ROWS = ['..............', '............r.', '..............', '....CCC.......', '....CCC.......', '....CCC.......', '..............'];

  it('sends an auto survivor helping a site to a ruin when nobody is idle, never one the player commands', () => {
    const game = createTestGame(RUIN_ROWS);
    const site = addBuilding(game, 'shack', 0, 0, { complete: false });
    const fixed = spawnSurvivor(game, 10, 6);
    fixed.task = { type: 'repair', buildingId: site.id };
    fixed.control = 'player';
    const helper = spawnSurvivor(game, 8, 6);
    helper.task = { type: 'repair', buildingId: site.id };
    const ctx = contextOf(game);
    visitRuins(ctx, 30);
    expect(ctx.turn.commands()).toContainEqual({ type: 'move', unitIds: [helper.id], x: 12.5, y: 1.5 });
  });

  it('takes an auto worker out of its building for a ruin when nobody is idle or helping', () => {
    const game = createTestGame(RUIN_ROWS);
    const farm = addBuilding(game, 'greenhouse', 0, 0, { complete: true });
    const fixed = spawnSurvivor(game, 1, 1);
    enterBuilding(game, fixed, farm);
    fixed.task = { type: 'work', buildingId: farm.id };
    fixed.control = 'player';
    const worker = spawnSurvivor(game, 1, 1);
    enterBuilding(game, worker, farm);
    worker.task = { type: 'work', buildingId: farm.id };
    const ctx = contextOf(game);
    visitRuins(ctx, 30);
    expect(ctx.turn.commands()).toEqual([{ type: 'move', unitIds: [worker.id], x: 12.5, y: 1.5 }]);
  });

  it('hands out survivors it pulled out of a building, who wait for its orders', () => {
    const game = createTestGame(RUIN_ROWS);
    const waiting = spawnSurvivor(game, 8, 6);
    waiting.task = { type: 'wait' };
    waiting.control = 'player';
    const ctx = contextOf(game);
    visitRuins(ctx, 30);
    expect(ctx.turn.commands()).toEqual([{ type: 'move', unitIds: [waiting.id], x: 12.5, y: 1.5 }]);
  });

  it('frees a worker it assigned so that training has a recruit', () => {
    const game = withBarracks(0);
    const farm = addBuilding(game, 'greenhouse', 4, 0, { complete: true });
    for (const s of [...game.state.entities.values()].filter((e) => e.kind === 'survivor')) {
      if (s.kind !== 'survivor') continue;
      enterBuilding(game, s, farm);
      s.task = { type: 'work', buildingId: farm.id };
      s.control = 'player';
    }
    const ctx = contextOf(game);
    train(ctx, saver);
    const orders = ctx.turn.commands();
    expect(orders.some((c) => c.type === 'train')).toBe(true);
    for (const c of orders) expect(applyCommand(game, c)).toEqual({ ok: true });
  });

  it('does not hand out an idle survivor walking under a player order', () => {
    const game = createTestGame(RUIN_ROWS);
    const walker = spawnSurvivor(game, 8, 6);
    walker.control = 'player';
    const ctx = contextOf(game);
    visitRuins(ctx, 30);
    expect(ctx.turn.commands()).toEqual([]);
  });
});

it('repairs the damaged core before expendable barricades', () => {
  const game = createTestGame(ROWS);
  const core = game.state.entities.get(game.state.coreId)!;
  core.hp = core.maxHp * .8;
  const wall = addBuilding(game, 'barricade', 1, 1, { complete: true });
  wall.hp = 1;
  spawnSurvivor(game, 8, 6);
  const ctx = contextOf(game);
  repair(ctx, 1, .95);
  expect(ctx.turn.commands().find(command => command.type === 'repair')).toMatchObject({ buildingId: core.id });
});

it('keeps idle recruits available to rebuild the minimum workforce after losses', () => {
  const ctx = contextOf(withBarracks(0));
  train(ctx, { ...saver, minWorkers: () => 2 });
  expect(trainOrders(ctx)).toHaveLength(1);
  expect(ctx.turn.spareIdle).toBe(2);
});
