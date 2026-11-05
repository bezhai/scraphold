import { describe, expect, it } from 'vitest';
import { drainEvents } from './events';
import { PIPELINE, stepGame } from './pipeline';
import { createTestGame } from './testing';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS } from './time';
import { spawnMutant, spawnSoldier } from './world/entities';

const ROWS = ['..........', '..........', '...CCC....', '...CCC....', '...CCC....', '..........'];

describe('pipeline', () => {
  it('runs the systems in the documented order', () => {
    expect(PIPELINE.map((s) => `${s.owner}:${s.name}`)).toEqual([
      'task1:clock',
      'task2:calendar',
      'task2:incidents',
      'task1:modifiers',
      'task1:nav',
      'task1:spatial',
      'task3:night',
      'task3:nests',
      'task3:mutantAi',
      'task3:soldierAi',
      'task3:soldiers',
      'task2:control',
      'task2:survivorAi',
      'task2:workers',
      'task2:weather',
      'task1:movement',
      'task1:spatialAfterMove',
      'task1:fog',
      'task2:exploration',
      'task3:combat',
      'task2:construction',
      'task2:production',
      'task2:population',
      'task2:tech',
      'task2:signal',
      'task2:incidentTargets',
      'task3:outcome',
      'task1:cleanup',
    ]);
  });

  it('advances one tick per step and announces every phase change', () => {
    const game = createTestGame(ROWS);
    stepGame(game);
    expect(game.state.tick).toBe(1);
    expect(game.state.clock).toMatchObject({ day: 1, phase: 'day', phaseTick: 0 });
    expect(drainEvents(game)).toContainEqual({ type: 'phaseChanged', day: 1, phase: 'day' });
    while (game.state.tick < CYCLE_TICKS + 1) stepGame(game);
    const phases = drainEvents(game).filter((e) => e.type === 'phaseChanged');
    expect(phases).toEqual([
      { type: 'phaseChanged', day: 1, phase: 'dusk' },
      { type: 'phaseChanged', day: 1, phase: 'night' },
      { type: 'phaseChanged', day: 2, phase: 'day' },
    ]);
    expect(DAY_TICKS - DUSK_TICKS).toBeGreaterThan(0);
  });

  it('does nothing once the game is over', () => {
    const game = createTestGame(ROWS);
    game.state.outcome.status = 'won';
    stepGame(game);
    expect(game.state.tick).toBe(0);
  });

  it('removes dead entities at the end of the tick with a died event, but never the core', () => {
    const game = createTestGame(ROWS);
    const m = spawnMutant(game, 'runner', 8.5, 0.5, { mode: 'assault' });
    const s = spawnSoldier(game, 'rifleman', 0.5, 0.5);
    m.hp = 0;
    game.state.entities.get(game.state.coreId)!.hp = 0;
    stepGame(game);
    expect(game.state.entities.has(m.id)).toBe(false);
    expect(game.state.entities.has(s.id)).toBe(true);
    expect(game.state.entities.has(game.state.coreId)).toBe(true);
    expect(drainEvents(game)).toContainEqual({ type: 'died', entityId: m.id, kind: 'mutant', subtype: 'runner', faction: 'mutant', x: 8.5, y: 0.5 });
  });
});
