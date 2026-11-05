import { describe, expect, it } from 'vitest';
import { clockAt, createGame, type Game } from '../../sim';
import { INCIDENTS } from '../../sim/data/incidents';
import { DAY_TICKS, DUSK_TICKS } from '../../sim/time';
import { incidentChoiceAvailability, pendingIncidentNotice } from './incidents';

function withCaravan(game: Game, deadlineTick: number): void {
  const def = INCIDENTS.caravan;
  game.state.incidents.pending = {
    id: 101,
    definitionId: 'caravan',
    raisedTick: 100,
    deadlineTick,
    title: def.title,
    description: def.description,
    choices: def.choices.map((c) => ({ ...c, description: '效果描述' })),
    target: null,
  };
}

describe('incidentChoiceAvailability', () => {
  it('asks validateCommand and shows its reason, without rewriting the rules', () => {
    const game = createGame({ seed: 'test-inc-1', origin: 'scavengers', difficulty: 'normal' });
    withCaravan(game, DAY_TICKS);
    expect(incidentChoiceAvailability(game, 101, 'fuel').ok).toBe(true);
    expect(incidentChoiceAvailability(game, 101, 'decline').ok).toBe(true);
    game.state.economy.resources.scrap = 10;
    expect(incidentChoiceAvailability(game, 101, 'fuel')).toMatchObject({ ok: false, reason: '资源不足' });
  });
});

describe('pendingIncidentNotice', () => {
  it('nothing pending, no notice', () => {
    const game = createGame({ seed: 'test-inc-2', origin: 'militia', difficulty: 'normal' });
    expect(pendingIncidentNotice(game.state)).toBeNull();
  });

  it('in the day: just the title, no countdown', () => {
    const game = createGame({ seed: 'test-inc-2', origin: 'militia', difficulty: 'normal' });
    withCaravan(game, DAY_TICKS);
    game.state.tick = 200;
    game.state.clock = clockAt(200);
    expect(pendingIncidentNotice(game.state)).toEqual({ title: INCIDENTS.caravan.title, secondsToNight: null, urgent: false });
  });

  it('at dusk: game seconds left before nightfall settles it (from deadlineTick), urgent in the last 10 s', () => {
    const game = createGame({ seed: 'test-inc-3', origin: 'militia', difficulty: 'normal' });
    withCaravan(game, DAY_TICKS);
    const duskStart = DAY_TICKS - DUSK_TICKS;
    game.state.tick = duskStart;
    game.state.clock = clockAt(duskStart);
    expect(game.state.clock.phase).toBe('dusk');
    expect(pendingIncidentNotice(game.state)).toMatchObject({ secondsToNight: 15, urgent: false });
    game.state.tick = DAY_TICKS - 201;
    game.state.clock = clockAt(game.state.tick);
    expect(pendingIncidentNotice(game.state)).toMatchObject({ secondsToNight: 11, urgent: false });
    game.state.tick = DAY_TICKS - 200;
    game.state.clock = clockAt(game.state.tick);
    expect(pendingIncidentNotice(game.state)).toMatchObject({ secondsToNight: 10, urgent: true });
    game.state.tick = DAY_TICKS - 1;
    game.state.clock = clockAt(game.state.tick);
    expect(pendingIncidentNotice(game.state)).toMatchObject({ secondsToNight: 1, urgent: true });
  });
});
