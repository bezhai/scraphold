import { describe, expect, it } from 'vitest';
import type { Game } from '../../sim';
import type { Building } from '../../sim/state';
import { createTestGame } from '../../sim/testing';
import { addBuilding, enterBuilding, spawnSurvivor } from '../../sim/world/entities';
import { estimateThreat } from './intel';
import { createMemory, makeContext, type Context, type Memory } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';
import { rebalance, needsWorkplace } from './workforce';

const ROWS = ['................', '................', '................', '......CCC.......', '......CCC.......', '......CCC.......', '................', '................'];

function staff(game: Game, b: Building, count: number): void {
  for (let k = 0; k < count; k++) enterBuilding(game, spawnSurvivor(game, b.x, b.y + 2), b);
}

function contextOf(game: Game, memory: Memory = createMemory()): Context {
  const snap = snapshot(game);
  return makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
}

/** A full salvage yard and an empty research station. */
function lopsided(): { game: Game; yard: Building; station: Building } {
  const game = createTestGame(ROWS);
  const yard = addBuilding(game, 'salvageYard', 1, 1, { complete: true });
  const station = addBuilding(game, 'researchStation', 11, 1, { complete: true });
  staff(game, yard, 3);
  return { game, yard, station };
}

describe('rebalance', () => {
  it('sends a worker out of the line furthest above its share when another line is well below it', () => {
    const { game, yard } = lopsided();
    const ctx = contextOf(game);
    rebalance(ctx, { scrap: 0.5, research: 0.5 });
    expect(ctx.turn.commands()).toEqual([{ type: 'unassignWork', buildingId: yard.id, count: 1 }]);
  });

  it('leaves the workforce alone when one move would not bring it closer to the shares', () => {
    const { game, yard, station } = lopsided();
    const third = game.state.entities.get(yard.workers[2] as number);
    if (third?.kind !== 'survivor') throw new Error('expected a worker');
    enterBuilding(game, third, station);
    // 2 scrap and 1 research against shares of 0.5 each: moving anyone back only flips the imbalance.
    const ctx = contextOf(game);
    rebalance(ctx, { scrap: 0.5, research: 0.5 });
    expect(ctx.turn.commands()).toEqual([]);
  });

  it('waits while idle survivors can fill the gap, at night, and for a while after a move', () => {
    const idle = lopsided();
    spawnSurvivor(idle.game, 8, 7);
    const withIdle = contextOf(idle.game);
    rebalance(withIdle, { scrap: 0.5, research: 0.5 });
    expect(withIdle.turn.commands()).toEqual([]);

    const night = lopsided();
    night.game.state.clock.phase = 'night';
    const atNight = contextOf(night.game);
    rebalance(atNight, { scrap: 0.5, research: 0.5 });
    expect(atNight.turn.commands()).toEqual([]);

    const again = lopsided();
    const memory = createMemory();
    rebalance(contextOf(again.game, memory), { scrap: 0.5, research: 0.5 });
    again.game.state.tick += 20;
    const soon = contextOf(again.game, memory);
    rebalance(soon, { scrap: 0.5, research: 0.5 });
    expect(soon.turn.commands()).toEqual([]);
  });
});

it('replaces finished research capacity with useful workplaces', () => {
  const game = createTestGame(ROWS);
  addBuilding(game, 'greenhouse', 1, 1, { complete: true });
  for (let i = 0; i < 4; i++) spawnSurvivor(game, 8, 7);
  const ctx = contextOf(game);
  ctx.researchPending = false;
  expect(needsWorkplace(ctx, { food: .5, research: .5 }, 'food', 0)).toBe(true);
});
