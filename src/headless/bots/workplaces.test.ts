import { expect, it } from 'vitest';
import { createTestGame } from '../../sim/testing';
import { addBuilding, spawnSurvivor } from '../../sim/world/entities';
import { estimateThreat } from './intel';
import { createMemory, makeContext, type Context } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';
import { needsWorkplace } from './workplaces';
import type { Game } from '../../sim';

const ROWS = ['................', '................', '................', '......CCC.......', '......CCC.......', '......CCC.......', '................', '................'];

function contextOf(game: Game): Context {
  const snap = snapshot(game);
  const memory = createMemory();
  return makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
}

it('asks for another workplace of a line whose slots fall short of its share of the survivors', () => {
  const game = createTestGame(ROWS);
  addBuilding(game, 'greenhouse', 1, 1, { complete: true });
  for (let i = 0; i < 8; i++) spawnSurvivor(game, 8, 7);
  const ctx = contextOf(game);
  expect(needsWorkplace(ctx, { food: 0.5, scrap: 0.5 }, 'food', 0)).toBe(true);
  expect(needsWorkplace(ctx, { food: 0.3, scrap: 0.7 }, 'food', 0)).toBe(false);
});

it('replaces finished research capacity with useful workplaces', () => {
  const game = createTestGame(ROWS);
  addBuilding(game, 'greenhouse', 1, 1, { complete: true });
  for (let i = 0; i < 4; i++) spawnSurvivor(game, 8, 7);
  const ctx = contextOf(game);
  ctx.researchPending = false;
  expect(needsWorkplace(ctx, { food: 0.5, research: 0.5 }, 'food', 0)).toBe(true);
  expect(needsWorkplace(ctx, { food: 0.5, research: 0.5 }, 'research', 0)).toBe(false);
});
