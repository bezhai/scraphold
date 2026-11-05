/**
 * Hive strength under the nest shield (combat/hiveShield.ts): a day-9 force of 30 equipped soldiers
 * cannot take the hive in one day while the ordinary nests stand, but can once they are all gone.
 * Together the two keep the hive from being a pure hp sponge and from being a shortcut past the
 * nests. Real generated maps; the hive reaches day-9 strength through the nest system (level up
 * and guard top-up at dawn).
 */
import { describe, expect, it } from 'vitest';
import { ordinaryNestsLeft } from './hiveShield';
import { nestSystem } from './nests';
import { applyCommand } from '../commandHandlers';
import { nestMaxHp, type SoldierType } from '../data/combat';
import { refreshModifiers, type Game } from '../game';
import type { TechId } from '../data/economy';
import { stepGame } from '../pipeline';
import type { Nest } from '../state';
import { CYCLE_TICKS, DAY_TICKS, clockAt } from '../time';
import { openTilesAround, removeEntity, spawnSoldier } from '../world/entities';
import { createGame } from '../world/setup';

/** 30 soldiers and the seven military techs the raider researches first. */
const STRIKE_FORCE: readonly [SoldierType, number][] = [
  ['shieldGuard', 4], ['rifleman', 8], ['sniper', 6],
  ['grenadier', 6], ['flamethrower', 2], ['pickup', 4],
];
const MILITARY_TECH: readonly TechId[] = ['armory', 'fuelPower', 'armoredPickup', 'rapidDeployment', 'expeditionPack', 'demolitions', 'veteranDoctrine'];
const STRIKE_DAY = 9;

interface StrikeResult {
  seed: string;
  day: number;
  ordinaryNests: number;
  hiveLevel: number;
  hiveHp: number;
  hpLeft: number;
  guards: number;
  destroyed: boolean;
  seconds: number;
  soldiersLost: number;
}

function hiveOf(game: Game): Nest {
  for (const e of game.state.entities.values()) if (e.kind === 'nest' && e.isHive) return e;
  throw new Error('no hive');
}

/**
 * Sends the strike force from 14 tiles away at dawn of `day`; runs until the hive falls or night
 * comes. With `nestsCleared` every ordinary nest is gone before the strike.
 */
function strikeHive(seed: string, day: number, nestsCleared: boolean): StrikeResult {
  const game = createGame({ seed, origin: 'militia', difficulty: 'normal' });
  if (nestsCleared) for (const e of [...game.state.entities.values()]) if (e.kind === 'nest' && !e.isHive) removeEntity(game, e);
  game.state.economy.tech.researched = [...MILITARY_TECH];
  refreshModifiers(game);
  const hive = hiveOf(game);
  // Dawn of `day`: the nest system levels the hive (day - 2 times so far, once now) and tops up its guards.
  hive.growth.level = day - 1;
  hive.maxHp = nestMaxHp(true, day - 1, 'normal');
  hive.hp = hive.maxHp;
  game.state.tick = (day - 1) * CYCLE_TICKS;
  game.state.clock = clockAt(game.state.tick);
  stepGame(game);
  const guards = [...game.state.entities.values()].filter((e) => e.kind === 'mutant' && e.ai.homeNestId === hive.id).length;
  const core = game.state.entities.get(game.state.coreId)!;
  const dx = core.x - hive.x;
  const dy = core.y - hive.y;
  const len = Math.hypot(dx, dy);
  const startX = hive.x + (dx / len) * 14;
  const startY = hive.y + (dy / len) * 14;
  const count = STRIKE_FORCE.reduce((n, [, k]) => n + k, 0);
  const anchor = { ...hive, x: startX, y: startY, tileX: Math.floor(startX) - 1, tileY: Math.floor(startY) - 1, size: 2 };
  const tiles = openTilesAround(game, anchor, count);
  const ids: number[] = [];
  let k = 0;
  for (const [type, n] of STRIKE_FORCE) {
    for (let j = 0; j < n; j++, k++) {
      const t = tiles[k % tiles.length] as number;
      ids.push(spawnSoldier(game, type, (t % game.state.map.width) + 0.5, Math.floor(t / game.state.map.width) + 0.5).id);
    }
  }
  hive.discovered = true;
  expect(applyCommand(game, { type: 'attackMove', unitIds: ids, x: hive.x, y: hive.y }).ok).toBe(true);
  const start = game.state.tick;
  const nightfall = (day - 1) * CYCLE_TICKS + DAY_TICKS;
  while (game.state.tick < nightfall && hive.hp > 0 && game.state.outcome.status === 'playing') stepGame(game);
  const alive = ids.filter((id) => game.state.entities.has(id)).length;
  return {
    seed,
    day,
    ordinaryNests: ordinaryNestsLeft(game.state),
    hiveLevel: hive.growth.level,
    hiveHp: Math.round(hive.maxHp),
    hpLeft: Math.round(hive.hp),
    guards,
    destroyed: game.state.stats.hiveDestroyed,
    seconds: Math.round((game.state.tick - start) / 20),
    soldiersLost: ids.length - alive,
  };
}

const SEEDS = ['hive-1', 'hive-2', 'hive-3', 'hive-4', 'hive-5'];

/**
 * One strike per test keeps every test well inside the default timeout when the whole suite runs
 * in parallel; the last test of each group judges the five maps together.
 */
describe(`day-${STRIKE_DAY} strike of 30 equipped soldiers while every ordinary nest stands`, () => {
  const results: StrikeResult[] = [];
  it.each(SEEDS)('%s', (seed) => {
    const r = strikeHive(seed, STRIKE_DAY, false);
    expect(r.ordinaryNests).toBeGreaterThan(0);
    results.push(r);
  });
  it('cannot take the hive before nightfall on more than one of the five maps', () => {
    if (process.env.HIVE_REPORT) console.table(results);
    expect(results.map((r) => r.seed)).toEqual(SEEDS);
    expect(results.filter((r) => r.destroyed).length).toBeLessThanOrEqual(1);
  });
});

describe(`day-${STRIKE_DAY} strike of 30 equipped soldiers once every ordinary nest is destroyed`, () => {
  const results: StrikeResult[] = [];
  it.each(SEEDS)('%s', (seed) => {
    const r = strikeHive(seed, STRIKE_DAY, true);
    expect(r.ordinaryNests).toBe(0);
    results.push(r);
  });
  it('takes the hive within one day on at least four of the five maps', () => {
    if (process.env.HIVE_REPORT) console.table(results);
    expect(results.map((r) => r.seed)).toEqual(SEEDS);
    expect(results.filter((r) => r.destroyed).length).toBeGreaterThanOrEqual(4);
  });
});

it('grows hive durability with days and difficulty without changing ordinary nest durability', () => {
  const games = ['normal', 'hard'].map(difficulty => createGame({ seed: 'hive-growth', origin: 'militia', difficulty: difficulty as 'normal' | 'hard' }));
  const initial = games.map(g => hiveOf(g).maxHp);
  expect(initial[1]).toBeGreaterThan(initial[0]!);
  for (const game of games) {
    for (let day = 1; day <= 13; day++) {
      game.state.tick = (day - 1) * CYCLE_TICKS;
      game.state.clock = clockAt(game.state.tick);
      nestSystem(game);
    }
  }
  expect(hiveOf(games[0]!).maxHp).toBeGreaterThan(initial[0]!);
  expect(hiveOf(games[1]!).maxHp).toBeGreaterThan(hiveOf(games[0]!).maxHp);
  const ordinary = games.map(g => [...g.state.entities.values()].find(e => e.kind === 'nest' && !e.isHive)!);
  expect(ordinary[0]!.maxHp).toBe(ordinary[1]!.maxHp);
});

