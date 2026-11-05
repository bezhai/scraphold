import { describe, expect, it } from 'vitest';
import type { Command } from './commands';
import { applyCommand, createGame, drainEvents, hashState, stepGame } from './index';
import type { Game } from './game';
import { spawnMutant } from './world/entities';
import { followFlowField } from './world/movement';

/** A scripted session: commands keyed by the tick before which they are applied (as if paused). */
function script(game: Game): Map<number, Command[]> {
  const soldiers = [...game.state.entities.values()].filter((e) => e.kind === 'soldier').map((e) => e.id);
  const survivors = [...game.state.entities.values()].filter((e) => e.kind === 'survivor').map((e) => e.id);
  const core = game.state.map.coreTile;
  return new Map<number, Command[]>([
    [0, [{ type: 'attackMove', unitIds: soldiers, x: core.x + 8, y: core.y + 1 }, { type: 'move', unitIds: survivors.slice(0, 3), x: core.x - 4, y: core.y }]],
    [40, [{ type: 'placeBuilding', building: 'shack', tileX: core.x + 5, tileY: core.y + 4 }]],
    [120, [{ type: 'move', unitIds: soldiers.slice(0, 2), x: core.x, y: core.y - 5 }, { type: 'hold', unitIds: soldiers.slice(2) }]],
    [300, [{ type: 'stop', unitIds: soldiers }, { type: 'setPolicy', slot: 0, policy: 'salvageDrive' }]],
    [301, [{ type: 'attackMove', unitIds: [...soldiers, ...survivors], x: core.x + 1, y: core.y + 6 }]],
  ]);
}

function run(seed: string, ticks: number): string {
  const game = createGame({ seed, origin: 'militia', difficulty: 'normal' });
  // A pack of mutants walking the flow field from the first nest exercises flow, separation and collision.
  const nest = [...game.state.entities.values()].find((e) => e.kind === 'nest')!;
  for (let k = 0; k < 25; k++) followFlowField(spawnMutant(game, k % 3 === 0 ? 'crawler' : 'runner', nest.x + (k % 5) * 0.3, nest.y + 2, { mode: 'assault' }));
  const commands = script(game);
  for (let t = 0; t < ticks; t++) {
    for (const cmd of commands.get(t) ?? []) applyCommand(game, cmd);
    stepGame(game);
    drainEvents(game);
  }
  return hashState(game);
}

describe('determinism', () => {
  it('produces the same state hash for the same seed and command sequence', () => {
    const a = run('replay-seed', 1500);
    const b = run('replay-seed', 1500);
    expect(a).toBe(b);
  });

  it('produces different hashes for different seeds', () => {
    expect(run('replay-seed', 200)).not.toBe(run('replay-other', 200));
  });

  it('hashes a structured clone of the state identically', () => {
    const game = createGame({ seed: 'clone', origin: 'scholars', difficulty: 'easy' });
    for (let t = 0; t < 50; t++) stepGame(game);
    expect(hashState({ ...game, state: structuredClone(game.state) })).toBe(hashState(game));
  });
});
