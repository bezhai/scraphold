import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, hashState, validateCommand, type Command } from './index';
import { CALENDAR } from './data/calendar';
import { MAP_GEN } from './data/map';
import { CYCLE_TICKS, GAME_END_TICK, TOTAL_NIGHTS } from './time';

const options = { seed: 'v2-foundation', origin: 'scholars', difficulty: 'normal' } as const;

describe('v2 shared foundation', () => {
  it('uses the twenty-night, 96 by 72 contract', () => {
    expect(TOTAL_NIGHTS).toBe(20);
    expect(GAME_END_TICK).toBe(20 * CYCLE_TICKS);
    expect([MAP_GEN.width, MAP_GEN.height]).toEqual([96, 72]);
  });

  it('initializes independent calendar, incident and signal state without running future rules', () => {
    const a = createGame(options);
    const b = createGame(options);
    expect(a.state.calendar.nights).toHaveLength(TOTAL_NIGHTS);
    expect(a.state.calendar.nights.slice(1 + CALENDAR.previewNights).every((n) => n.type === null)).toBe(true);
    expect(a.state.calendar.revealedThroughNight).toBe(1 + CALENDAR.previewNights);
    expect(a.state.incidents.pending).toBeNull();
    expect(a.state.incidents.history).toEqual([]);
    expect(a.state.incidents.targets).toEqual([]);
    expect(a.state.signal).toMatchObject({ stage: 'decoding', discovered: false, buildingId: 0, retainedProgress: 0, nightsHeld: 0 });
    expect(a.state.signal.site).not.toBeNull();
    const site = a.state.signal.site!;
    expect(a.state.fog[site.tileY * a.state.map.width + site.tileX]).toBe(0);
    expect(hashState(a)).toBe(hashState(b));
    a.state.calendar.nights[0]!.type = 'raid';
    expect(b.state.calendar.nights[0]!.type).toBe('calm');
  });

  it('rejects missing incident cards without mutation', () => {
    const game = createGame(options);
    const commands: Command[] = [
      { type: 'resolveIncident', incidentId: 1, choiceId: 'accept' },
    ];
    const before = hashState(game);
    for (const command of commands) {
      expect(validateCommand(game, command)).toEqual({ ok: false, reason: 'incidentNotPending' });
      expect(applyCommand(game, command)).toEqual({ ok: false, reason: 'incidentNotPending' });
    }
    expect(hashState(game)).toBe(before);
  });
});
