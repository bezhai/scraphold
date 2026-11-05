import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commandHandlers';
import { MUTANTS, SOLDIER_AI } from '../data/combat';
import type { Direction } from '../data/map';
import type { Game } from '../game';
import { stepGame } from '../pipeline';
import { tileAtPoint } from '../map/grid';
import { FOG_VISIBLE, type Building, type Mutant, type Point, type Soldier } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS, TICKS_PER_SECOND, clockAt } from '../time';
import { addBuilding, removeEntity, spawnMutant, spawnSoldier } from '../world/entities';
import { edgeDistance } from '../world/spatial';
import type { ForecastSize } from './model';
import { inBaseArea } from './soldierAi';
import { acquireRadius } from './soldiers';
import { soldierWeapon } from './weapons';

// 44 x 26, the core on tiles 20-22 x 11-13 (center 21.5, 12.5).
const ROWS = Array.from({ length: 26 }, (_, y) => (y >= 11 && y <= 13 ? '.'.repeat(20) + 'CCC' + '.'.repeat(21) : '.'.repeat(44)));

function seconds(game: Game, s: number): void {
  for (let t = 0; t < s * TICKS_PER_SECOND; t++) stepGame(game);
}

function coreOf(game: Game): Building {
  return game.state.entities.get(game.state.coreId) as Building;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A mutant that stands still and never attacks: retreating with no nest on the map. */
function dummy(game: Game, x: number, y: number): Mutant {
  return spawnMutant(game, 'wanderer', x, y, { mode: 'retreat' });
}

function riflemen(game: Game, n: number, y = 19.5): Soldier[] {
  return Array.from({ length: n }, (_, k) => spawnSoldier(game, 'rifleman', 17.5 + k, y));
}

/** Just past the first tick of today's dusk, so the night system does not publish its own forecast. */
function atDusk(game: Game): void {
  game.state.tick = (game.state.clock.day - 1) * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS + 1;
  game.state.clock = clockAt(game.state.tick);
}

function forecast(game: Game, groups: [Direction, ForecastSize][], directionsKnown = true): void {
  game.state.night.forecast = {
    night: game.state.clock.day,
    directionsKnown,
    precise: false,
    groups: groups.map(([direction, size]) => ({ direction, size, counts: null, boss: null })),
  };
}

function trainAt(game: Game, b: Building): Soldier {
  b.trainQueue.push({ unit: 'rifleman', progress: 0, total: 1, paid: {} });
  const before = new Set(game.state.entities.keys());
  stepGame(game);
  return [...game.state.entities.values()].find((e): e is Soldier => e.kind === 'soldier' && !before.has(e.id)) as Soldier;
}

describe('soldier AI: night posts', () => {
  it("moves auto soldiers toward tonight's forecast direction before the night falls", () => {
    const game = createTestGame(ROWS);
    const army = riflemen(game, 3);
    seconds(game, 2);
    atDusk(game);
    forecast(game, [['E', 'medium']]);
    seconds(game, 10);
    expect(game.state.clock.phase).toBe('dusk');
    const core = coreOf(game);
    for (const s of army) {
      expect(s.x - core.x).toBeGreaterThan(SOLDIER_AI.postDistance - 2);
      expect(Math.abs(s.y - core.y)).toBeLessThan(2);
    }
  });

  it("splits soldiers between directions only when each direction's share makes a squad", () => {
    const sides = (sizes: [Direction, ForecastSize][], n: number) => {
      const game = createTestGame(ROWS);
      const army = riflemen(game, n);
      atDusk(game);
      forecast(game, sizes);
      seconds(game, 12);
      const core = coreOf(game);
      const atCore = army.filter((s) => edgeDistance(core, s.x, s.y) < 3).length;
      return { east: army.filter((s) => s.x > core.x + 3).length, west: army.filter((s) => s.x < core.x - 3).length, atCore };
    };
    // A small group beside a large one: everyone meets the large one.
    expect(sides([['E', 'large'], ['W', 'small']], 9)).toEqual({ east: 9, west: 0, atCore: 0 });
    // Two equal groups: split, the remainder to the first direction.
    expect(sides([['E', 'medium'], ['W', 'medium']], 9)).toEqual({ east: 5, west: 4, atCore: 0 });
    // Too few soldiers to meet more than half of the threat where it comes from: they wait at the core, where it all heads.
    expect(sides([['W', 'medium'], ['E', 'medium']], 2)).toEqual({ east: 0, west: 0, atCore: 2 });
    expect(sides([['N', 'small'], ['E', 'small'], ['S', 'small'], ['W', 'small'], ['NW', 'small']], 5)).toEqual({ east: 0, west: 0, atCore: 5 });
  });

  it('gathers around the core when dense fog hides the directions, and keeps the day post on a quiet night', () => {
    for (const [known, expectCore] of [[false, true], [true, false]] as const) {
      const game = createTestGame(ROWS);
      const barracks = addBuilding(game, 'barracks', 3, 3, { complete: true });
      barracks.rally = { x: 6.5, y: 21.5 };
      const army = riflemen(game, 3);
      seconds(game, 12);
      for (const s of army) expect(dist(s, barracks.rally)).toBeLessThan(2);
      atDusk(game);
      forecast(game, [], known);
      seconds(game, 12);
      const core = coreOf(game);
      for (const s of army) {
        if (expectCore) expect(edgeDistance(core, s.x, s.y)).toBeLessThan(3);
        else expect(dist(s, barracks.rally)).toBeLessThan(2);
      }
    }
  });
});

describe('soldier AI: day posts', () => {
  it("trained soldiers wait at their barracks' rally point by day, beside the barracks without one", () => {
    const game = createTestGame(ROWS);
    const flagged = addBuilding(game, 'barracks', 3, 3, { complete: true });
    flagged.rally = { x: 8.5, y: 21.5 };
    const plain = addBuilding(game, 'barracks', 36, 20, { complete: true });
    const a = trainAt(game, flagged);
    const b = trainAt(game, plain);
    expect(a.homeId).toBe(flagged.id);
    expect(b.homeId).toBe(plain.id);
    expect(a.control).toBe('auto');
    expect(a.order).toEqual({ type: 'idle' });
    seconds(game, 15);
    expect(dist(a, flagged.rally)).toBeLessThan(1.5);
    expect(edgeDistance(plain, b.x, b.y)).toBeLessThan(1.5);
  });

  it('soldiers without a barracks join the nearest one, and wait by the core when there is none', () => {
    const game = createTestGame(ROWS);
    const near = addBuilding(game, 'barracks', 4, 18, { complete: true });
    addBuilding(game, 'barracks', 38, 2, { complete: true });
    const [starter] = riflemen(game, 1, 22.5);
    seconds(game, 12);
    expect(starter!.homeId).toBe(near.id);
    expect(edgeDistance(near, starter!.x, starter!.y)).toBeLessThan(1.5);
    for (const e of [...game.state.entities.values()]) if (e.kind === 'building' && e.type === 'barracks') removeEntity(game, e);
    seconds(game, 12);
    expect(edgeDistance(coreOf(game), starter!.x, starter!.y)).toBeLessThan(2);
  });
});

describe('soldier AI: engaging', () => {
  /** A lone soldier standing at its post by the core (no barracks), and that post. */
  function posted(game: Game, type: Soldier['type'] = 'rifleman'): { s: Soldier; post: Point } {
    const s = spawnSoldier(game, type, 17.5, 16.5);
    seconds(game, 6);
    const post = { x: s.attack.post!.x, y: s.attack.post!.y };
    expect(dist(s, post)).toBeLessThan(0.6);
    return { s, post };
  }

  it('meets a visible mutant inside the base area beyond its own sight, then walks back to its post', () => {
    const game = createTestGame(ROWS);
    const { s, post } = posted(game);
    addBuilding(game, 'greenhouse', 31, 12, { complete: true });
    const m = dummy(game, 31.5, 15.5);
    expect(dist(s, m)).toBeGreaterThan(s.vision);
    seconds(game, 15);
    expect(game.state.entities.has(m.id)).toBe(false);
    expect(dist(s, post)).toBeLessThan(1);
  });

  it('walks back to its post when the mutant it chases is killed by someone else', () => {
    const game = createTestGame(ROWS);
    const { s, post } = posted(game, 'shieldGuard');
    const m = dummy(game, post.x + 4, post.y + 2);
    seconds(game, 1);
    expect(s.attack.targetId).toBe(m.id);
    expect(dist(s, post)).toBeGreaterThan(0.5);
    m.hp = 0;
    seconds(game, 4);
    expect(dist(s, post)).toBeLessThan(0.6);
  });

  it('leaves mutants in the base area alone beyond its response radius', () => {
    const game = createTestGame(ROWS);
    const { s, post } = posted(game);
    addBuilding(game, 'greenhouse', 38, 12, { complete: true });
    const m = dummy(game, 37.5, 15.5);
    expect(inBaseArea(game, m.x, m.y)).toBe(true);
    expect(edgeDistance(m, post.x, post.y)).toBeGreaterThan(SOLDIER_AI.responseRadius);
    seconds(game, 4);
    expect(game.state.fog[tileAtPoint(game.state.map, m.x, m.y)]).toBe(FOG_VISIBLE);
    expect(s.attack.targetId).toBe(0);
    expect(dist(s, post)).toBeLessThan(0.6);
  });

  it('does not chase a mutant outside the base area, even within its acquire radius', () => {
    const game = createTestGame(ROWS);
    const { s, post } = posted(game, 'scout');
    // Beyond scout range, within its acquire radius, more than baseMargin from the core.
    const m = dummy(game, s.x + s.radius + 5.8 + MUTANTS.wanderer.radius, s.y);
    expect(acquireRadius(s, soldierWeapon(game, s))).toBeGreaterThan(5.8);
    expect(edgeDistance(coreOf(game), Math.floor(m.x) + 0.5, Math.floor(m.y) + 0.5)).toBeGreaterThan(SOLDIER_AI.baseMargin);
    seconds(game, 4);
    expect(m.hp).toBe(m.maxHp);
    expect(dist(s, post)).toBeLessThan(0.6);
    // A barricade beside it brings it inside the base area.
    addBuilding(game, 'barricade', Math.floor(m.x), Math.floor(m.y) + 3, { complete: true });
    seconds(game, 4);
    expect(m.hp).toBeLessThan(m.maxHp);
  });

  it('ignores mutants in the fog, and reacts once they come into sight', () => {
    const game = createTestGame(ROWS);
    const { s, post } = posted(game);
    addBuilding(game, 'greenhouse', 34, 12, { complete: true });
    const m = dummy(game, 31, 16.5);
    expect(inBaseArea(game, m.x, m.y)).toBe(true);
    seconds(game, 4);
    expect(game.state.fog[tileAtPoint(game.state.map, m.x, m.y)]).not.toBe(FOG_VISIBLE);
    expect(m.hp).toBe(m.maxHp);
    expect(dist(s, post)).toBeLessThan(0.6);
    addBuilding(game, 'watchtower', 31, 19, { complete: true });
    seconds(game, 10);
    expect(game.state.entities.has(m.id)).toBe(false);
  });

  it('never attacks a nest on its own, but shoots a nest guard in the base area', () => {
    const rows = ROWS.map((r, y) => (y === 12 || y === 13 ? r.slice(0, 27) + 'NN' + r.slice(29) : r));
    const game = createTestGame(rows);
    // Past the first tick of the day, so the nest does not raise its day guards.
    game.state.tick = 1;
    const nest = [...game.state.entities.values()].find((e) => e.kind === 'nest')!;
    const { s } = posted(game);
    expect(edgeDistance(nest, s.x, s.y)).toBeLessThan(6.5);
    seconds(game, 5);
    expect(nest.hp).toBe(nest.maxHp);
    const guard = spawnMutant(game, 'wanderer', nest.x - 2, nest.y + 2.5, { mode: 'guard', homeNestId: nest.id });
    seconds(game, 8);
    expect(game.state.entities.has(guard.id)).toBe(false);
    expect(nest.hp).toBe(nest.maxHp);
  });
});

describe('soldier AI: wounded soldiers', () => {
  it('retreat to the core without stopping to fight, hold there, and stay there by day', () => {
    const game = createTestGame(ROWS);
    const barracks = addBuilding(game, 'barracks', 3, 3, { complete: true });
    barracks.rally = { x: 6.5, y: 21.5 };
    const [hurt, fit] = riflemen(game, 2);
    hurt!.homeId = fit!.homeId = barracks.id;
    atDusk(game);
    forecast(game, [['E', 'medium']]);
    seconds(game, 12);
    const core = coreOf(game);
    expect(hurt!.x - core.x).toBeGreaterThan(SOLDIER_AI.postDistance - 2);
    fit!.hp = 0;
    hurt!.hp = hurt!.maxHp * (SOLDIER_AI.retreatBelowPct - 0.05);
    // A mutant in range, too tough to kill on the way: the soldier keeps walking.
    const passer = spawnMutant(game, 'wanderer', hurt!.x + 2.5, hurt!.y, { mode: 'retreat', hpPct: 10 });
    seconds(game, 4);
    expect(passer.hp).toBeGreaterThan(0);
    expect(edgeDistance(core, hurt!.x, hurt!.y)).toBeLessThan(2);
    // From the core it fires at what comes in range, and does not leave to chase.
    const close = dummy(game, hurt!.x, hurt!.y + 4);
    const far = dummy(game, core.x - 7.5, core.y);
    seconds(game, 8);
    expect(game.state.entities.has(close.id)).toBe(false);
    expect(far.hp).toBe(far.maxHp);
    expect(edgeDistance(core, hurt!.x, hurt!.y)).toBeLessThan(2);
    // Nothing heals soldiers, so it stays with the core by day too.
    game.state.tick = CYCLE_TICKS + 1;
    game.state.clock = clockAt(game.state.tick);
    seconds(game, 10);
    expect(edgeDistance(core, hurt!.x, hurt!.y)).toBeLessThan(2);
  });
});

describe('soldier AI: player control', () => {
  it('never moves held soldiers or soldiers on a player order; a stop hands them back', () => {
    const game = createTestGame(ROWS);
    const [held, sent] = riflemen(game, 2);
    applyCommand(game, { type: 'hold', unitIds: [held!.id] });
    applyCommand(game, { type: 'attackMove', unitIds: [sent!.id], x: 41.5, y: 24.5 });
    atDusk(game);
    forecast(game, [['E', 'medium']]);
    const from = { x: held!.x, y: held!.y };
    seconds(game, 3);
    expect(sent!.order).toMatchObject({ type: 'attackMove' });
    expect(sent!.x).toBeGreaterThan(from.x + 4);
    expect(sent!.y).toBeGreaterThan(from.y);
    seconds(game, 7);
    expect(dist(held!, from)).toBeLessThan(0.01);
    applyCommand(game, { type: 'stop', unitIds: [held!.id] });
    seconds(game, 9);
    expect(held!.x - coreOf(game).x).toBeGreaterThan(SOLDIER_AI.postDistance - 2);
  });
});
