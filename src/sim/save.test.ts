import { raiseIncident } from './incidents/incidents';
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, drainEvents, hashState, restoreGame, SAVE_VERSION, serializeGame, stepGame } from './index';
import { DAY_TICKS, DUSK_TICKS } from './time';

function activeGame() {
  const game = createGame({ seed: 'v2-save', origin: 'militia', difficulty: 'normal' });
  const soldier = [...game.state.entities.values()].find((e) => e.kind === 'soldier')!;
  applyCommand(game, { type: 'move', unitIds: [soldier.id], x: soldier.x + 12, y: soldier.y + 4 });
  for (let i = 0; i < DAY_TICKS - DUSK_TICKS + 3; i++) stepGame(game);
  return game;
}

describe('automatic save format', () => {
  it('round trips the complete state, preserves numeric bits and rebuilds caches', () => {
    const original = activeGame();
    const soldier = [...original.state.entities.values()].find((e) => e.kind === 'soldier')!;
    if (soldier.kind === 'soldier') soldier.motion.vx = -0;
    original.state.calendar.nights[0]!.type = 'raid';
    original.state.calendar.revealedThroughNight = 4;
    raiseIncident(original, 'caravan');
    original.state.incidents.history.push({ id: 2, definitionId: 'refugees', raisedTick: 50, resolvedTick: 60, choiceId: 'decline', automatic: false });
    original.state.incidents.targets.push({
      id: 3, incidentId: 2, kind: 'rescue', title: '救援', tile: 10, nestId: 0,  splitTile: -1,
      createdTick: 60, expiresTick: 8000, status: 'active', guardIds: [],
    });
    original.state.incidents.nextId = 4;
    original.state.incidents.modifiers.push({ incidentId: 2, effects: [{ kind: 'global', stat: 'repairCostPct', value: -0.1 }], startsTick: 60, expiresTick: null });
    original.state.signal.stage = 'repair';
    original.state.signal.retainedProgress = 0.25;
    const saved = serializeGame(original);
    expect(JSON.parse(saved).version).toBe(SAVE_VERSION);
    const restored = restoreGame(saved)!;
    expect(restored).not.toBeNull();
    expect(restored.state.map.terrain).toBeInstanceOf(Uint8Array);
    expect(restored.state.fog).toBeInstanceOf(Uint8Array);
    expect(restored.state.entities).toBeInstanceOf(Map);
    expect([...restored.state.entities.keys()]).toEqual([...original.state.entities.keys()]);
    expect(hashState(restored)).toBe(hashState(original));
    expect(restored.events).toEqual([]);
    drainEvents(original);
    for (let i = 0; i < 400; i++) {
      stepGame(original);
      stepGame(restored);
      expect(drainEvents(restored)).toEqual(drainEvents(original));
    }
    expect(hashState(restored)).toBe(hashState(original));
    restored.state.map.terrain[0] = 255;
    expect(original.state.map.terrain[0]).not.toBe(255);
  });

  it('rejects other versions and corrupt saves without throwing', () => {
    const data = JSON.parse(serializeGame(activeGame()));
    data.version = 10;
    expect(restoreGame(JSON.stringify(data))).toBeNull();
    data.version = SAVE_VERSION + 1;
    expect(restoreGame(JSON.stringify(data))).toBeNull();
    for (const text of ['', '{', 'null', '{}', '[]']) expect(restoreGame(text)).toBeNull();
    data.version = SAVE_VERSION;
    data.state.tick++;
    expect(restoreGame(JSON.stringify(data))).toBeNull();
  });
});
