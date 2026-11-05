import { expect, it } from 'vitest';
import { createGame } from '../../sim';
import { refreshModifiers } from '../../sim/game';
import { addBuilding } from '../../sim/world/entities';
import { fortress } from './fortress';
import { findSite } from './sites';
import { createMemory, makeContext } from './strategy';
import { snapshot } from './view';
import { Turn } from './turn';
import { estimateThreat } from './intel';

it('does not count unfueled towers as replacements for the garrison', () => {
  const game = createGame({ seed: 'fortress-fuel', origin: 'scavengers', difficulty: 'hard' });
  game.state.economy.tech.researched.push('armory');
  refreshModifiers(game);
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.est.threat = 200;
  ctx.done = type => type === 'machineGunTower' ? 8 : 1;
  const strategy = fortress();
  const size = () => Object.values(strategy.army(ctx)).reduce((a, b) => a + b, 0);
  game.state.economy.resources.fuel = 100;
  const fueled = size();
  game.state.economy.resources.fuel = 0;
  expect(size()).toBeGreaterThan(fueled);
});

it('extends tower coverage to a remote oil well instead of leaving it undefended', () => {
  const game = createGame({ seed: 'fortress-oil', origin: 'scavengers', difficulty: 'normal' });
  game.state.fog.fill(2);
  game.state.economy.resources = { scrap: 1000, food: 1000, fuel: 100, research: 0 };
  game.state.economy.tech.researched.push('machineGuns');
  refreshModifiers(game);
  const core = game.state.entities.get(game.state.coreId)!;
  const oil = addBuilding(game, 'oilWell', Math.floor(core.x + 16), Math.floor(core.y), { complete: true });
  for (const [type, y] of [['greenhouse', 0], ['salvageYard', 3], ['researchStation', 6], ['barracks', 9], ['shack', 12]] as const) addBuilding(game, type, 2, y, { complete: true });
  const production = ['greenhouse', 'salvageYard', 'researchStation'] as const;
  for (const [row, type] of production.entries()) {
    for (let i = 0; i < 3; i++) addBuilding(game, type, 6 + i * 3, 2 + row * 3, { complete: true });
  }
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.housingCap = 100;
  const order = fortress().build(ctx);
  expect(order?.type).toBe('machineGunTower');
  expect(order && 'site' in order && Math.hypot(order.site.tileX + .5 - oil.x, order.site.tileY + .5 - oil.y)).toBeLessThanOrEqual(5);
});

it('builds an armory for its researched late-game support troops', () => {
  const game = createGame({ seed: 'fortress-support', origin: 'scavengers', difficulty: 'normal' });
  game.state.economy.tech.researched.push('machineGuns', 'armory');
  game.state.economy.resources = { scrap: 1000, food: 1000, fuel: 100, research: 0 };
  refreshModifiers(game);
  addBuilding(game, 'barracks', 2, 12, { complete: true });
  const production = ['greenhouse', 'salvageYard', 'researchStation'] as const;
  for (const [row, type] of production.entries()) {
    for (let i = 0; i < 3; i++) addBuilding(game, type, 6 + i * 3, 2 + row * 3, { complete: true });
  }
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.day = 8;
  ctx.housingCap = 100;
  game.state.fog.fill(2);
  // A developed core can exhaust every nearby footprint. Search beyond its occupied ring.
  for (let y = Math.floor(ctx.core.y - 9); y <= ctx.core.y + 9; y++) {
    for (let x = Math.floor(ctx.core.x - 9); x <= ctx.core.x + 9; x++) {
      const distance = Math.hypot(x + .5 - ctx.core.x, y + .5 - ctx.core.y);
      if (distance >= 3 && distance <= 9) addBuilding(game, 'barricade', x, y, { complete: true });
    }
  }
  const order = fortress().build(ctx);
  expect(order?.type).toBe('armory');
  if (!order || !('rules' in order)) throw new Error('expected an armory site search');
  expect(findSite(game, order.type, order.rules)).not.toBeNull();
});

it('prepares fuel and rebuilds a missing well two nights before the second published surge', () => {
  const game = createGame({ seed: 'fortress-fuel-reserve', origin: 'scavengers', difficulty: 'hard' });
  game.state.fog.fill(2);
  game.state.economy.resources = { scrap: 1000, food: 1000, fuel: 20, research: 0 };
  for (const [row, type] of (['greenhouse', 'salvageYard'] as const).entries()) {
    for (let i = 0; i < 2; i++) addBuilding(game, type, 2 + 3 * i, 2 + 3 * row, { complete: true });
  }
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.day = 7;
  ctx.housingCap = 100;
  ctx.count = type => type === 'oilWell' ? 0 : 3;
  game.state.calendar.nights[4]!.type = 'surge';
  const strategy = fortress();
  game.state.calendar.nights[8]!.type = 'calm';
  const ordinaryFuelShare = strategy.workforce(ctx).fuel!;
  game.state.calendar.nights[8]!.type = 'surge';
  expect(strategy.workforce(ctx).fuel).toBeGreaterThan(ordinaryFuelShare);
  expect(strategy.build(ctx)?.type).toBe('oilWell');
  expect(strategy.policies(ctx).slice(0, 2)).toContain('fuelRationing');
});

it('does not divert early defense production into the second-surge fuel reserve before the first surge', () => {
  const game = createGame({ seed: 'fortress-first-surge', origin: 'scavengers', difficulty: 'hard' });
  game.state.economy.resources.fuel = 20;
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  ctx.day = 3;
  ctx.count = type => type === 'machineGunTower' ? 3 : 0;
  for (const night of game.state.calendar.nights) night.type = 'calm';
  const strategy = fortress();
  const baseline = strategy.workforce(ctx).fuel;
  game.state.calendar.nights[4]!.type = 'surge';
  expect(strategy.workforce(ctx).fuel).toBe(baseline);
});
