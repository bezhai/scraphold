/**
 * Units crossing dense bases through 1-tile lanes between buildings: corners must not snag a
 * unit's collision body, and two units jammed against each other must not freeze for good.
 */
import { describe, expect, it } from 'vitest';
import type { Game } from '../game';
import { applyCommand, stepGame } from '../index';
import { createTestGame } from '../testing';
import { DAY_TICKS } from '../time';
import { addBuilding, spawnMutant, spawnSoldier } from './entities';
import { followFlowField } from './movement';

/** size x size map, core in the bottom-left corner, 2x2 shacks every 3 tiles (1-tile lanes between them). */
function laneGrid(size: number): Game {
  const rows = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x < 3 && y >= size - 3 ? 'C' : '.')).join(''));
  const game = createTestGame(rows);
  for (let ty = 3; ty + 2 <= size - 3; ty += 3) for (let tx = 3; tx + 2 <= size - 3; tx += 3) addBuilding(game, 'shack', tx, ty, { complete: true });
  return game;
}

describe('moving through 1-tile lanes between buildings', () => {
  it('a group crossing the lanes all arrive (none gives up halfway)', () => {
    const game = laneGrid(24);
    const units = Array.from({ length: 6 }, (_, k) => spawnSoldier(game, 'rifleman', 1 + (k % 2) * 0.8, 1 + Math.floor(k / 2) * 0.8));
    expect(applyCommand(game, { type: 'move', unitIds: units.map((u) => u.id), x: 22.5, y: 22.5 }).ok).toBe(true);
    const goals = units.map((u) => ({ ...u.motion.goal! }));
    // Arrived units go back under automatic control and walk on to their posts, so arrival is recorded as it happens.
    const arrived = new Set<number>();
    for (let t = 0; t < 1200; t++) {
      stepGame(game);
      units.forEach((u, i) => {
        if (Math.hypot(u.x - goals[i]!.x, u.y - goals[i]!.y) <= 1) arrived.add(u.id);
      });
    }
    const short = units.filter((u) => !arrived.has(u.id)).map((u) => [u.id, +u.x.toFixed(2), +u.y.toFixed(2)]);
    expect(short).toEqual([]);
  });

  it('two units reaching a 1-tile corridor side by side both get through', () => {
    const game = createTestGame([
      '....######......',
      '....######......',
      '................',
      '....######......',
      '....######..CCC.',
      '....######..CCC.',
      '....######..CCC.',
    ]);
    // Symmetric about the corridor's centre line: each one's way in is the other's push out.
    const a = spawnSoldier(game, 'rifleman', 2.5, 2.2);
    const b = spawnSoldier(game, 'rifleman', 2.5, 2.8);
    expect(applyCommand(game, { type: 'move', unitIds: [a.id, b.id], x: 13.5, y: 2.5 }).ok).toBe(true);
    for (let t = 0; t < 400; t++) stepGame(game);
    expect([a.x > 10, b.x > 10]).toEqual([true, true]);
  });

  it('a lone unit turning lane corners is never wedged on a corner', () => {
    const game = laneGrid(36);
    const s = spawnSoldier(game, 'shieldGuard', 1.5, 1.5);
    applyCommand(game, { type: 'move', unitIds: [s.id], x: 34.5, y: 34.5 });
    let worst = 0;
    for (let t = 0; t < 1200 && s.motion.mode === 'path'; t++) {
      stepGame(game);
      worst = Math.max(worst, s.motion.stuckTicks);
    }
    expect(Math.hypot(s.x - 34.5, s.y - 34.5)).toBeLessThan(0.2);
    expect(worst).toBeLessThanOrEqual(3);
  });

  it('flow-field mutants entering the lanes in pairs never freeze', () => {
    const rows = Array.from({ length: 72 }, (_, y) => Array.from({ length: 96 }, (_, x) => (x >= 47 && x < 50 && y >= 35 && y < 38 ? 'C' : '.')).join(''));
    const game = createTestGame(rows);
    game.state.tick = DAY_TICKS + 100;
    game.state.entities.get(game.state.coreId)!.hp = 1e9;
    for (let ty = 4; ty <= 66; ty += 3) for (let tx = 10; tx <= 84; tx += 3) if (tx < 40 || tx > 56 || ty < 28 || ty > 44) addBuilding(game, 'shack', tx, ty, { complete: true });
    const ms = Array.from({ length: 40 }, (_, k) => spawnMutant(game, 'crawler', 1.5 + (k % 8) * 0.9, 1.5 + Math.floor(k / 8) * 0.9, { mode: 'assault' }));
    for (const m of ms) followFlowField(m);
    // Longest time a mutant away from the core stays within 0.3 tiles of one spot.
    const anchor = new Map<number, { x: number; y: number; t: number }>();
    let worst = 0;
    for (let t = 0; t < 900; t++) {
      stepGame(game);
      for (const m of ms) {
        const a = anchor.get(m.id);
        if (!a || Math.hypot(a.x - m.x, a.y - m.y) > 0.3) anchor.set(m.id, { x: m.x, y: m.y, t });
        else if (Math.hypot(m.x - 48.5, m.y - 36.5) > 6) worst = Math.max(worst, t - a.t);
      }
    }
    expect(worst).toBeLessThan(300);
  });
});
