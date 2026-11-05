import { describe, expect, it } from 'vitest';
import type { Game } from '../../sim';
import { createTestGame } from '../../sim/testing';
import { addBuilding, enterBuilding, spawnSoldier, spawnSurvivor } from '../../sim/world/entities';
import { SPECIAL_RUINS } from '../../sim/data/ruins';
import { train, visitRuins } from './base';
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
  workplaces: () => ({}),
  reserve: () => ({ scrap: 1000 }),
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

describe('survivors the survivor AI keeps busy', () => {
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

  it('does not hand out an idle survivor walking under a player order', () => {
    const game = createTestGame(RUIN_ROWS);
    const walker = spawnSurvivor(game, 8, 6);
    walker.control = 'player';
    const ctx = contextOf(game);
    visitRuins(ctx, 30);
    expect(ctx.turn.commands()).toEqual([]);
  });
});

it('keeps enough survivors out of the army to rebuild the minimum workforce after losses', () => {
  const ctx = contextOf(withBarracks(0));
  train(ctx, { ...saver, minWorkers: () => 2 });
  expect(trainOrders(ctx)).toHaveLength(1);
  expect(ctx.turn.spareSurvivors).toBe(2);
});
