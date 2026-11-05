import { expect, it } from 'vitest';
import { economyFirst } from './economyFirst';
import { createMemory, makeContext } from './strategy';
import { Turn } from './turn';
import { applyCommand, nightType, stepGame } from '../../sim';
import { createTestGame } from '../../sim/testing';
import { addBuilding, spawnSurvivor } from '../../sim/world/entities';
import { createController } from './index';
import { createSightings, estimateThreat } from './intel';
import { snapshot } from './view';
import { DAY_TICKS, DUSK_TICKS, clockAt } from '../../sim/time';

const ROWS = ['................', '................', '......CCC.......', '......CCC.......', '......CCC.......', '................', '................'];
it('sends outdoor workers into available workplaces before a storm', () => {
  const g = createTestGame(ROWS);
  g.calendarPlan[0] = 'rustStorm'; g.state.calendar.nights[0]!.type = 'rustStorm';
  g.state.tick = DAY_TICKS - DUSK_TICKS; g.state.clock = clockAt(g.state.tick);
  const yard = addBuilding(g, 'salvageYard', 1, 1, { complete: true });
  const worker = spawnSurvivor(g, 3.5, 2.5);
  worker.task = { type: 'repair', buildingId: g.state.coreId };
  const bot = createController('economy');
  const commands = bot(g, []);
  expect(commands).toContainEqual({ type: 'assignWork', unitIds: [worker.id], buildingId: yard.id });
  expect(commands.some((c) => c.type === 'unassignWork')).toBe(false);
  for (const command of commands) applyCommand(g, command);
  for (let i = 0; i < 30; i++) stepGame(g);
  expect(worker.insideId).toBe(yard.id);
});
it('estimates zero storm threat and retains nest threat on calm nights without inventing directions', () => {
  const g = createTestGame(ROWS);
  g.state.calendar.nights[0]!.type = 'rustStorm';
  expect(nightType(g.state)).toBe('rustStorm');
  const storm = estimateThreat(g, snapshot(g), createSightings());
  expect(storm.threat).toBe(0);
  expect(storm.boss).toBe(false);
  g.state.calendar.nights[0]!.type = 'denseFog';
  g.state.night.forecast = { night: 1, precise: false, directionsKnown: false, groups: [] };
  const fog = estimateThreat(g, snapshot(g), createSightings());
  expect(fog.threat).toBeGreaterThan(0);
  expect(fog.directions).toEqual([]);
});

it('uses a published upcoming surge to build an army during a quiet day', () => {
  const game = createTestGame(ROWS);
  const memory = createMemory();
  const snap = snapshot(game);
  game.state.calendar.nights[0]!.type = 'calm';
  game.state.calendar.nights[1]!.type = 'calm';
  game.state.calendar.nights[2]!.type = 'calm';
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  const strategy = economyFirst();
  const count = () => Object.values(strategy.army(ctx)).reduce((sum, n) => sum + n, 0);
  const quiet = count();
  game.state.calendar.nights[1]!.type = 'surge';
  expect(count()).toBeGreaterThan(quiet);
});
