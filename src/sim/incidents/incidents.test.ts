import { describe, expect, it } from 'vitest';
import { createGame, applyCommand, validateCommand } from '../index';
import { INCIDENTS } from '../data/incidents';
import { incidentSystem, raiseIncident } from './incidents';
import { clockAt, CYCLE_TICKS, DAY_TICKS } from '../time';
function game(seed = 'incident-test') {
  return createGame({
    seed,
    origin: 'scavengers',
    difficulty: 'normal'
  });
}
function at(g: ReturnType<typeof game>, tick: number) {
  g.state.tick = tick;
  g.state.clock = clockAt(tick);
  incidentSystem(g);
}
describe('daytime incidents', () => {
  it('defines thirteen narrative events', () => {
    expect(Object.keys(INCIDENTS)).toHaveLength(13);
  });
  it.each(Array.from({ length: 40 }, (_, i) => `schedule-${i}`))('%s obeys scheduled frequency, weather, northern reservation and adjacent-event caps', seed => {
    const g = game(seed);
    at(g, 0);
    const days = g.state.incidents.eventDays;
    expect(days.length).toBeGreaterThanOrEqual(9);
    expect(days.length).toBeLessThanOrEqual(11);
    let on = 0, off = 0;
    for (let day = 1; day <= 20; day++) {
      const scheduled = days.includes(day);
      on = scheduled ? on + 1 : 0;
      off = scheduled ? 0 : off + 1;
      expect(on).toBeLessThanOrEqual(2);
      expect(off).toBeLessThanOrEqual(3);
      at(g, (day - 1) * CYCLE_TICKS);
      const tick = g.state.incidents.nextIncidentTick;
      if (scheduled) {
        expect(tick! - (day - 1) * CYCLE_TICKS).toBeGreaterThanOrEqual(100);
        expect(tick! - (day - 1) * CYCLE_TICKS).toBeLessThanOrEqual(300);
      } else expect(tick).toBeNull();
      at(g, (day - 1) * CYCLE_TICKS + 400);
      const pending = g.state.incidents.pending;
      expect(Boolean(pending)).toBe(scheduled);
      if (scheduled) {
        const weather = g.calendarPlan[day - 1];
        if (pending!.definitionId === 'stormWarning') expect(weather).toBe('rustStorm');
        if (pending!.definitionId === 'surgeWarning') expect(weather).toBe('surge');
        const warning = weather === 'rustStorm' ? 'stormWarning' : weather === 'surge' ? 'surgeWarning' : null;
        const history = g.state.incidents.history;
        if (warning && day !== g.state.incidents.northernDay && history.at(-1)?.definitionId !== warning && history.filter(h => h.definitionId === warning).length < 2) expect(pending!.definitionId).toBe(warning);
      }
      at(g, (day - 1) * CYCLE_TICKS + DAY_TICKS);
    }
    const history = g.state.incidents.history;
    expect(history.map(h => clockAt(h.raisedTick).day)).toEqual(days);
    const ids = history.map(h => h.definitionId);
    ids.forEach((id, i) => {
      expect(ids.filter(x => x === id).length).toBeLessThanOrEqual(2);
      expect(id).not.toBe(ids[i - 1]);
    });
    const north = history.filter(h => h.definitionId === 'northernSignal');
    expect(north).toHaveLength(1);
    expect(clockAt(north[0]!.raisedTick).day).toBeGreaterThanOrEqual(3);
    expect(clockAt(north[0]!.raisedTick).day).toBeLessThanOrEqual(6);
    const replay = game(seed);
    at(replay, 0);
    expect(replay.state.incidents.eventDays).toEqual(days);
    expect(replay.state.incidents.northernDay).toBe(g.state.incidents.northernDay);
  });
  it('rejects unaffordable and stale choices, then emits exact feedback after selection', () => {
    const g = game();
    raiseIncident(g, 'caravan');
    const p = g.state.incidents.pending!;
    g.state.economy.resources.scrap = 0;
    expect(validateCommand(g, {
      type: 'resolveIncident',
      incidentId: p.id,
      choiceId: 'fuel'
    })).toEqual({
      ok: false,
      reason: 'insufficientResources'
    });
    expect(applyCommand(g, {
      type: 'resolveIncident',
      incidentId: p.id,
      choiceId: 'decline'
    }).ok).toBe(true);
    expect(g.events).toContainEqual(expect.objectContaining({
      type: 'incidentResolved',
      feedback: '商队离开了。'
    }));
    expect(validateCommand(g, {
      type: 'resolveIncident',
      incidentId: p.id,
      choiceId: 'decline'
    })).toEqual({
      ok: false,
      reason: 'incidentNotPending'
    });
  });
});
