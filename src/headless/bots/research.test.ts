import { createGame } from '../../sim';
import { createMemory, makeContext } from './strategy';
import { snapshot } from './view';
import { Turn } from './turn';
import { estimateThreat } from './intel';
import { chooseResearch, construct } from './base';
import { needsWorkplace } from './workplaces';

import { expect, it } from 'vitest';
import { TECHS, type TechId } from '../../sim/data/economy';
import { economyFirst } from './economyFirst';
import { nestRaider } from './nestRaider';
import { signalStrategy } from './signal';
import { fortress } from './fortress';

it.each([economyFirst(), nestRaider(), fortress(), signalStrategy()])('$name research prerequisites precede every planned technology', strategy => {
  const available = new Set<TechId>();
  for (const tech of strategy.research) {
    expect(TECHS[tech].requires.filter(id => !available.has(id)), tech).toEqual([]);
    available.add(tech);
  }
});

it.each([economyFirst(), nestRaider(), fortress(), signalStrategy()])('$name builds no research workplace after completing its plan', strategy => {
  const game = createGame({ seed: 'research-finished', origin: 'scavengers', difficulty: 'normal' });
  game.state.economy.tech.researched = [...strategy.research];
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  chooseResearch(ctx, strategy);
  expect(ctx.researchPending).toBe(false);
  expect(needsWorkplace(ctx, strategy.workplaces(ctx), 'research', 0)).toBe(false);
  construct(ctx, { ...strategy, build: () => ({ type: 'researchStation', site: { tileX: 5, tileY: 2 } }) });
  expect(ctx.turn.commands().some(command => command.type === 'placeBuilding' && command.building === 'researchStation')).toBe(false);
});

it('builds no research workplace for a plan whose remaining prerequisites are unavailable', () => {
  const game = createGame({ seed: 'research-blocked', origin: 'scavengers', difficulty: 'normal' });
  const snap = snapshot(game);
  const memory = createMemory();
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  chooseResearch(ctx, { ...economyFirst(), research: ['windReinforcement'] });
  expect(ctx.researchPending).toBe(false);
  expect(needsWorkplace(ctx, { food: .5, research: .5 }, 'research', 0)).toBe(false);
});
