import { describe, expect, it } from 'vitest';
import type { Game } from '../game';
import { tileAtPoint } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import type { Unit } from '../state';
import { createTestGame } from '../testing';
import { addBuilding, enterBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from './entities';
import { followFlowField, moveUnitTo, movementSystem } from './movement';
import { rebuildSpatialIndex } from './spatial';

function tick(game: Game, n: number, each?: () => void): void {
  for (let k = 0; k < n; k++) {
    rebuildSpatialIndex(game.spatial, game.state);
    movementSystem(game);
    each?.();
  }
}

function onBlockedTile(game: Game, u: Unit): boolean {
  const t = tileAtPoint(game.state.map, u.x, u.y);
  return t === -1 || ensureNav(game).blocked[t] === 1;
}

const OPEN = [
  '....................',
  '....................',
  '........#...........',
  '........#...........',
  '........#....CCC....',
  '........#....CCC....',
  '........#....CCC....',
  '........#...........',
  '....................',
];

describe('movement', () => {
  it('walks a unit to its goal at its speed and then stands', () => {
    const game = createTestGame(OPEN);
    const s = spawnSoldier(game, 'rifleman', 1.5, 0.5);
    moveUnitTo(game, s, 6.5, 0.5);
    // 5 tiles at 1.9 tiles/s = ~2.6 s = 53 ticks.
    tick(game, 45);
    expect(s.motion.mode).toBe('path');
    tick(game, 20);
    expect(s.motion.mode).toBe('stand');
    expect(Math.abs(s.x - 6.5)).toBeLessThan(0.15);
    expect(Math.abs(s.y - 0.5)).toBeLessThan(0.15);
  });

  it('routes around walls without ever standing on a blocked tile', () => {
    const game = createTestGame(OPEN);
    const s = spawnSoldier(game, 'scout', 4.5, 4.5);
    moveUnitTo(game, s, 11.5, 4.5);
    tick(game, 200, () => expect(onBlockedTile(game, s)).toBe(false));
    expect(s.motion.mode).toBe('stand');
    expect(Math.abs(s.x - 11.5) + Math.abs(s.y - 4.5)).toBeLessThan(0.3);
  });

  it('stops next to an unreachable goal', () => {
    const game = createTestGame(OPEN);
    const s = spawnSurvivor(game, 1.5, 4.5);
    moveUnitTo(game, s, 14.5, 5.5); // inside the core
    tick(game, 400);
    expect(s.motion.mode).toBe('stand');
    expect(onBlockedTile(game, s)).toBe(false);
    expect(Math.abs(s.x - 14.5) + Math.abs(s.y - 5.5)).toBeLessThan(3);
  });

  it('pushes overlapping units apart, heavier units less', () => {
    const game = createTestGame(OPEN);
    const light = spawnSoldier(game, 'rifleman', 3.5, 1.5);
    const heavy = spawnSoldier(game, 'shieldGuard', 3.55, 1.5);
    tick(game, 30);
    const d = Math.hypot(light.x - heavy.x, light.y - heavy.y);
    expect(d).toBeGreaterThanOrEqual((light.radius + heavy.radius) * 0.95);
    expect(Math.abs(heavy.x - 3.55)).toBeLessThan(Math.abs(light.x - 3.5));
  });

  it('separates units spawned on exactly the same point', () => {
    const game = createTestGame(OPEN);
    const a = spawnSoldier(game, 'rifleman', 3.5, 1.5);
    const b = spawnSoldier(game, 'rifleman', 3.5, 1.5);
    tick(game, 30);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
  });

  it('leads a flow-following mutant to the core and reports the core as the blocker', () => {
    const game = createTestGame(OPEN);
    const m = spawnMutant(game, 'runner', 0.5, 8.5, { mode: 'assault' });
    followFlowField(m);
    tick(game, 400, () => expect(onBlockedTile(game, m)).toBe(false));
    expect(m.motion.blockedBy).toBe(game.state.coreId);
    const core = game.state.entities.get(game.state.coreId)!;
    expect(Math.hypot(m.x - core.x, m.y - core.y)).toBeLessThan(2.6);
  });

  it('reports a barricade as the blocker when the core is fully enclosed', () => {
    const game = createTestGame(OPEN);
    const ring = new Set<number>();
    for (let x = 12; x <= 16; x++)
      for (let y = 3; y <= 7; y++) {
        if (x >= 13 && x <= 15 && y >= 4 && y <= 6) continue;
        ring.add(addBuilding(game, 'barricade', x, y, { complete: true }).id);
      }
    const m = spawnMutant(game, 'wanderer', 19.5, 0.5, { mode: 'assault' });
    followFlowField(m);
    tick(game, 600);
    expect(ring.has(m.motion.blockedBy)).toBe(true);
    expect(onBlockedTile(game, m)).toBe(false);
  });

  it('repaths when a building is placed on the route', () => {
    const game = createTestGame(OPEN);
    const s = spawnSoldier(game, 'rifleman', 9.5, 0.5);
    moveUnitTo(game, s, 9.5, 8.5);
    tick(game, 10);
    for (let x = 9; x <= 12; x++) addBuilding(game, 'barricade', x, 2, { complete: true });
    tick(game, 300, () => expect(onBlockedTile(game, s)).toBe(false));
    expect(s.motion.mode).toBe('stand');
    expect(Math.abs(s.x - 9.5) + Math.abs(s.y - 8.5)).toBeLessThan(0.3);
  });

  it('gives up on a reachable goal that units physically block', () => {
    const game = createTestGame([
      '....................',
      '####################',
      '....................',
      '####################',
      '.....CCC............',
      '.....CCC............',
      '.....CCC............',
    ]);
    // A heavy unit holding position plugs a one-tile corridor that A* considers open.
    const plug = spawnSoldier(game, 'pickup', 10.5, 2.5);
    plug.order = { type: 'hold' };
    const s = spawnSoldier(game, 'rifleman', 2.5, 2.5);
    moveUnitTo(game, s, 18.5, 2.5);
    tick(game, 400);
    expect(s.motion.mode).toBe('stand');
    expect(s.x).toBeLessThan(plug.x);
  });

  it('does not move survivors working inside a building', () => {
    const game = createTestGame(OPEN);
    const yard = addBuilding(game, 'salvageYard', 1, 6, { complete: true });
    const v = spawnSurvivor(game, 0.5, 6.5);
    enterBuilding(game, v, yard);
    const other = spawnSoldier(game, 'rifleman', yard.x, yard.y - 1.2);
    moveUnitTo(game, other, yard.x, yard.y - 1.2);
    tick(game, 20);
    expect([v.x, v.y]).toEqual([yard.x, yard.y]);
  });
});
