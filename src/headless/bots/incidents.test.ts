import { expect, it } from 'vitest';
import { createGame, hashState, applyCommand, restoreGame, serializeGame, type Game } from '../../sim';
import { createController } from './index';
import { raiseIncident } from '../../sim/incidents/incidents';
import { addNest, spawnSoldier, removeEntity } from '../../sim/world/entities';
import { createMemory, makeContext, type Memory } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';
import { estimateThreat } from './intel';
import { pursueIncident } from './incidents';
import { clockAt, DAY_TICKS } from '../../sim/time';
const make = () => createGame({
  seed: 'bot-incident',
  origin: 'scavengers',
  difficulty: 'normal'
});
function context(g: Game, m: Memory) {
  const snap = snapshot(g);
  return makeContext(g, snap, new Turn(g, snap, new Set()), m, estimateThreat(g, snap, m.sightings));
}
function targetGame(kind: 'rescue' | 'nestSplit' = 'rescue') {
  const g = make();
  const memory = createMemory();
  for (const e of [...g.state.entities.values()]) if (e.kind === 'soldier') removeEntity(g, e);
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 9; i++) {
    const s = spawnSoldier(g, 'rifleman', core.x + 4, core.y + 4);
    memory.roles.set(s.id, 'garrison');
  }
  const nest = addNest(g, 3, 3, false);
  nest.discovered = true;
  nest.growth.level = 8;
  g.state.incidents.targets.push({
    id: 50,
    incidentId: 49,
    kind,
    title: '目标',
    tile: 20 * g.state.map.width + 20,
    nestId: kind === 'nestSplit' ? nest.id : 0,
    splitTile: -1,
    createdTick: 0,
    expiresTick: 10000,
    status: 'active',
    guardIds: []
  });
  return {
    g,
    memory,
    nest
  };
}
it('does not skip ordinary decisions on the incident decision tick or mutate the game', () => {
  const g = make();
  const plain = createController('economy')(g, []);
  raiseIncident(g, 'caravan');
  const hash = hashState(g);
  const actual = createController('economy')(g, []);
  expect(actual[0]).toMatchObject({
    type: 'resolveIncident'
  });
  expect(actual.slice(1)).toEqual(plain);
  expect(hashState(g)).toBe(hash);
});
it('does not send three soldiers against an overpowering split nest', () => {
  const {
    g,
    memory
  } = targetGame('nestSplit');
  const ctx = context(g, memory);
  pursueIncident(ctx);
  expect(ctx.turn.commands()).toEqual([]);
  expect([...memory.roles.values()].includes('incident')).toBe(false);
});
it('dispatches at most one squad per target even after all three die', () => {
  const {
    g,
    memory
  } = targetGame();
  let ctx = context(g, memory);
  pursueIncident(ctx);
  const crew = ctx.snap.soldiers.filter(s => memory.roles.get(s.id) === 'incident');
  expect(crew).toHaveLength(3);
  for (const s of crew) removeEntity(g, s);
  ctx = context(g, memory);
  pursueIncident(ctx);
  expect(ctx.turn.commands()).toEqual([]);
  expect(ctx.snap.soldiers.filter(s => memory.roles.get(s.id) === 'incident')).toHaveLength(0);
});
it('hands incident squads back to automatic control before night and never redeploys them to the same target', () => {
  const {
    g,
    memory
  } = targetGame();
  let ctx = context(g, memory);
  pursueIncident(ctx);
  for (const command of ctx.turn.commands()) expect(applyCommand(g, command).ok).toBe(true);
  const crew = ctx.snap.soldiers.filter(s => memory.roles.get(s.id) === 'incident');
  expect(crew).toHaveLength(3);
  for (const s of crew) {
    s.x = 20;
    s.y = 20;
  }
  g.state.tick = DAY_TICKS - 100;
  g.state.clock = clockAt(g.state.tick);
  ctx = context(g, memory);
  pursueIncident(ctx);
  expect(ctx.turn.commands()).toEqual([{ type: 'stop', unitIds: crew.map(s => s.id) }]);
  expect(memory.incidentMission).toBeNull();
  for (const s of crew) expect(memory.roles.get(s.id)).toBe('garrison');
  g.state.tick = DAY_TICKS;
  g.state.clock = clockAt(g.state.tick);
  ctx = context(g, memory);
  pursueIncident(ctx);
  expect(ctx.turn.commands()).toEqual([]);
});
it('plans ordinary commands against the paid incident state in the same turn', () => {
  const g = make();
  g.state.economy.resources.fuel = 60;
  raiseIncident(g, 'overheat');
  const paid = restoreGame(serializeGame(g))!;
  const choice = {
    type: 'resolveIncident' as const,
    incidentId: paid.state.incidents.pending!.id,
    choiceId: 'fuel'
  };
  expect(applyCommand(paid, choice).ok).toBe(true);
  const expected = createController('economy')(paid, []);
  const actual = createController('economy')(g, []);
  expect(actual[0]).toEqual(choice);
  expect(actual.slice(1)).toEqual(expected);
  expect(g.state.economy.resources.fuel).toBe(60);
});

it('declines rescue when the available army cannot spare a healthy squad', () => {
  const g = make();
  raiseIncident(g, 'rescue');
  const bot = createController('economy');
  expect(bot(g, []).find(c => c.type === 'resolveIncident')).toMatchObject({ choiceId: 'decline' });
});
it('accepts rescue with a healthy squad and at least three defenders left home', () => {
  const g = make();
  const core = g.state.entities.get(g.state.coreId)!;
  for (let i = 0; i < 6; i++) spawnSoldier(g, 'rifleman', core.x, core.y + 4);
  raiseIncident(g, 'rescue');
  expect(createController('economy')(g, []).find(c => c.type === 'resolveIncident')).toMatchObject({ choiceId: 'rescue' });
});
it('keeps a construction reserve instead of paying raiders with nearly all scrap', () => {
  const game = make();
  game.state.economy.resources.scrap = 310;
  raiseIncident(game, 'raiders');
  expect(createController('economy')(game, []).find(command => command.type === 'resolveIncident')).toMatchObject({ choiceId: 'refuse' });
});
it('does not empty a low fuel stockpile to handle daytime overheat', () => {
  const game = make();
  game.state.economy.resources.fuel = 30;
  raiseIncident(game, 'overheat');
  expect(createController('fortress')(game, []).find(command => command.type === 'resolveIncident')).toMatchObject({ choiceId: 'power' });
});

it('uses the shared raid criteria to dispatch a viable squad against a split nest', () => {
  const { g, memory, nest } = targetGame('nestSplit');
  nest.growth.level = 1;
  const ctx = context(g, memory);
  pursueIncident(ctx);
  expect([...memory.roles.values()].filter(role => role === 'incident')).toHaveLength(6);
});
