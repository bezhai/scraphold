import { signalStrategy } from './signal';
import { createMemory, makeContext } from './strategy';
import { snapshot } from './view';
import { Turn } from './turn';
import { estimateThreat } from './intel';
import { CYCLE_TICKS, clockAt } from '../../sim/time';
import { expect, it } from 'vitest';
import { createController, BOT_NAMES } from './index';
import { applyCommand, createGame, hashState } from '../../sim';
import { addBuilding, spawnSoldier, removeEntity } from '../../sim/world/entities';
it('registers signal as a standard controller and plans without mutating simulation state', () => {
  expect(BOT_NAMES).toContain('signal');
  const game = createGame({ seed: 'signal-strategy', origin: 'scholars', difficulty: 'normal' });
  const before = hashState(game);
  const commands = createController('signal')(game, []);
  expect(commands.some(c => c.type === 'setResearch')).toBe(true);
  expect(hashState(game)).toBe(before);
});

function readyTower() {
  const g = createGame({ seed: 'signal-ready', origin: 'scavengers', difficulty: 'normal' });
  const site = g.state.map.relaySite!;
  const tower = addBuilding(g, 'signalTower', site.tileX, site.tileY, { complete: true });
  Object.assign(g.state.signal, { stage: 'ready', site, discovered: true, visited: true, buildingId: tower.id });
  return { g, tower };
}
it('waits to broadcast until a healthy tower has an escort and the core retains defenders', () => {
  const { g } = readyTower();
  const commands = createController('signal')(g, []);
  expect(commands.some(command => command.type === 'startSignalBroadcast')).toBe(false);
});
it('starts broadcasting on a calm day with guards in position', () => {
  const { g, tower } = readyTower();
  g.state.calendar.nights[0]!.type = 'calm';
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 4; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  for (let i = 0; i < 3; i++) spawnSoldier(g, 'rifleman', tower.x - 2, tower.y);
  const commands = createController('signal')(g, []);
  expect(commands.some(command => command.type === 'startSignalBroadcast')).toBe(true);
});
it('holds the escort at the tower, out of the soldier AI\'s reach, until it is released', () => {
  const { g, tower } = readyTower();
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 4; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  const guards = Array.from({ length: 3 }, () => spawnSoldier(g, 'rifleman', tower.x - 2, tower.y));
  const commands = createController('signal')(g, []);
  expect(commands).toContainEqual({ type: 'hold', unitIds: guards.map(soldier => soldier.id) });
  expect(commands.some(c => c.type === 'attackMove')).toBe(false);
});
it('hands its surviving escort back to automatic control if the tower is destroyed', () => {
  const { g, tower } = readyTower();
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 4; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  const guards = Array.from({ length: 3 }, () => spawnSoldier(g, 'rifleman', tower.x - 2, tower.y));
  const bot = createController('signal');
  for (const command of bot(g, [])) expect(applyCommand(g, command).ok).toBe(true);
  expect(guards.map(soldier => soldier.control)).toEqual(['player', 'player', 'player']);
  removeEntity(g, tower);
  g.state.signal.buildingId = 0;
  g.state.tick = 10;
  expect(bot(g, [])).toContainEqual({ type: 'stop', unitIds: guards.map(soldier => soldier.id) });
});

it('leaves the tower crew to the survivor AI', () => {
  const g = createGame({ seed: 'signal-ready', origin: 'scavengers', difficulty: 'normal' });
  const site = g.state.map.relaySite!;
  const tower = addBuilding(g, 'signalTower', site.tileX, site.tileY, { complete: false });
  Object.assign(g.state.signal, { stage: 'repair', site, discovered: true, visited: true, buildingId: tower.id });
  const commands = createController('signal')(g, []);
  expect(commands.filter(c => c.type === 'assignWork' || c.type === 'unassignWork')).toEqual([]);
});

it.each([1, 2])('keeps defenders home and defers broadcasting with a surge %i nights ahead', offset => {
  const { g, tower } = readyTower();
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 4; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  for (let i = 0; i < 3; i++) spawnSoldier(g, 'rifleman', tower.x - 2, tower.y);
  g.state.calendar.nights[0]!.type = 'calm';
  g.state.calendar.nights[offset]!.type = 'surge';
  const commands = createController('signal')(g, []);
  expect(commands.some(c => c.type === 'startSignalBroadcast')).toBe(false);
  expect(commands.some(c => c.type === 'hold' || (c.type === 'attackMove' && c.x === g.state.signal.site!.tileX - 1))).toBe(false);
});

it('does not reserve tower resources before its construction day', () => {
  const g = createGame({ seed: 'signal-reserve', origin: 'scholars', difficulty: 'normal' });
  g.state.signal.stage = 'repair';
  g.state.tick = 5 * CYCLE_TICKS;
  g.state.clock = clockAt(g.state.tick);
  const snap = snapshot(g);
  const memory = createMemory();
  const ctx = makeContext(g, snap, new Turn(g, snap, new Set()), memory, estimateThreat(g, snap, memory.sightings));
  expect(signalStrategy().reserve(ctx)).toEqual({});
});

it('keeps an existing broadcast escort without sending more defenders before a surge', () => {
  const { g, tower } = readyTower();
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 4; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  for (let i = 0; i < 3; i++) spawnSoldier(g, 'rifleman', tower.x - 2, tower.y);
  const bot = createController('signal');
  bot(g, []);
  g.state.signal.stage = 'broadcast';
  g.state.calendar.nights[1]!.type = 'surge';
  for (let i = 0; i < 10; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  g.state.tick = 100;
  const commands = bot(g, []);
  const escorted = commands.flatMap(c => c.type === 'hold' || (c.type === 'attackMove' && c.x === g.state.signal.site!.tileX - 1) ? c.unitIds : []);
  expect(escorted).toHaveLength(3);
});
