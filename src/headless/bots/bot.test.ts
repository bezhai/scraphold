import { describe, expect, it } from 'vitest';
import { FOG_VISIBLE, applyCommand, type Command } from '../../sim';
import { createTestGame } from '../../sim/testing';
import { DAY_TICKS, clockAt } from '../../sim/time';
import { addBuilding, enterBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from '../../sim/world/entities';
import { runHeadless } from '../run';
import { scout } from './army';
import { createController, STRATEGY_BOTS } from './index';
import { estimateThreat } from './intel';
import { createMemory, makeContext } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';

const ROWS = ['................', '................', '................', '......CCC.......', '......CCC.......', '......CCC.......', '................', '................'];

/** Commands that staff, repair or pull survivors out of work: the survivor AI's job. */
const STAFFING = new Set<Command['type']>(['assignWork', 'unassignWork', 'repair']);

describe('the bots leave survivors and the home defence to the built-in AI', () => {
  it.each(STRATEGY_BOTS)('%s never staffs, repairs or pulls workers in the first days', (name) => {
    const bot = createController(name);
    const issued: Command[] = [];
    runHeadless({
      seed: 'bot-leaves-staffing',
      origin: 'scavengers',
      difficulty: 'normal',
      days: 3,
      controller: (game, events) => {
        const commands = bot(game, events);
        issued.push(...commands);
        return commands;
      },
    });
    expect(issued.filter((c) => STAFFING.has(c.type))).toEqual([]);
    expect(issued.some((c) => c.type === 'placeBuilding')).toBe(true);
  }, 60_000);

  it.each(STRATEGY_BOTS)('%s gives the garrison no orders while mutants come at the core by night', (name) => {
    const game = createTestGame(ROWS);
    game.state.fog.fill(FOG_VISIBLE);
    game.state.tick = DAY_TICKS + 100;
    game.state.clock = clockAt(game.state.tick);
    const core = game.state.entities.get(game.state.coreId)!;
    const garrison = [0, 1, 2].map((k) => spawnSoldier(game, 'rifleman', core.x + 3, core.y + k));
    spawnMutant(game, 'wanderer', core.x + 5, core.y, { mode: 'assault' });
    const commands = createController(name)(game, []);
    const ids = new Set(garrison.map((s) => s.id));
    expect(commands.filter((c) => 'unitIds' in c && c.unitIds.some((id) => ids.has(id)))).toEqual([]);
  });

  it('trains from survivors at work without taking them out first', () => {
    const game = createTestGame(ROWS);
    game.state.economy.resources = { scrap: 400, food: 400, fuel: 0, research: 0 };
    addBuilding(game, 'barracks', 1, 1, { complete: true });
    for (const tileY of [1, 5]) {
      const farm = addBuilding(game, 'greenhouse', 11, tileY, { complete: true });
      for (let k = 0; k < 3; k++) enterBuilding(game, spawnSurvivor(game, farm.x, farm.y), farm);
    }
    const commands = createController('raider')(game, []);
    expect(commands.some((c) => c.type === 'train')).toBe(true);
    expect(commands.filter((c) => c.type === 'stop' || STAFFING.has(c.type))).toEqual([]);
    for (const c of commands) expect(applyCommand(game, c), c.type).toEqual({ ok: true });
  });
});

it('hands scouts that are out exploring back to automatic control for the night', () => {
  const game = createTestGame(ROWS);
  game.state.calendar.nights[0]!.type = 'raid';
  game.state.tick = DAY_TICKS + 100;
  game.state.clock = clockAt(game.state.tick);
  const out = spawnSoldier(game, 'scout', 14.5, 7.5);
  out.control = 'player';
  out.order = { type: 'move', x: 15.5, y: 7.5 };
  const home = spawnSoldier(game, 'scout', 4.5, 7.5);
  const memory = createMemory();
  memory.roles.set(out.id, 'scout');
  memory.roles.set(home.id, 'scout');
  const snap = snapshot(game);
  const ctx = makeContext(game, snap, new Turn(game, snap, new Set()), memory, estimateThreat(game, snap, memory.sightings));
  scout(ctx);
  expect(ctx.turn.commands()).toEqual([{ type: 'stop', unitIds: [out.id] }]);
});
