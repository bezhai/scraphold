import { describe, expect, it } from 'vitest';
import { FOG_VISIBLE, clockAt } from '../../sim';
import { spawnMutant } from '../../sim/world/entities';
import { buildTestWorld } from '../testWorld';
import { threatMarkers } from './threatMarkers';

const DUSK_DAY1 = 950;
const NIGHT_DAY1 = 1300;

describe('threatMarkers', () => {
  it('draws no directional markers for a dense-fog dusk', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(DUSK_DAY1);
    game.state.night.forecast = { night: 1, directionsKnown: false, precise: false, groups: [] };
    expect(threatMarkers(game.state)).toEqual([]);
  });

  it('shows nothing during the day', () => {
    const { game } = buildTestWorld();
    expect(threatMarkers(game.state)).toEqual([]);
  });

  it('at dusk points at the spawn point of every forecast direction', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(DUSK_DAY1);
    game.state.map.spawnPoints = [{ direction: 'E', tile: 5 * 24 + 23 }];
    game.state.night.forecast = { night: 1, directionsKnown: true, precise: false, groups: [{ direction: 'E', size: 'medium', counts: null, boss: null }] };
    expect(threatMarkers(game.state)).toEqual([{ kind: 'forecast', x: 23.5, y: 5.5, label: '东 · 成群' }]);
  });

  it('at night points at where the attackers are now, one marker per compass sector around the core', () => {
    const { game, mutant } = buildTestWorld();
    game.state.clock = clockAt(NIGHT_DAY1);
    // The forecast still names the spawn side; the markers follow the mutants instead.
    game.state.night.forecast = { night: 1, directionsKnown: true, precise: false, groups: [{ direction: 'W', size: 'small', counts: null, boss: null }] };
    // Core center (8.5, 5.5). The test world's wanderer stands at (18.5, 9.5): east.
    const second = spawnMutant(game, 'runner', 20.5, 7.5, { mode: 'assault' });
    const boss = spawnMutant(game, 'behemoth', 8.5, 11.4, { mode: 'assault', boss: true });
    spawnMutant(game, 'wanderer', 1.5, 1.5, { mode: 'guard' });
    const markers = threatMarkers(game.state);
    expect(markers).toEqual([
      { kind: 'live', x: (mutant.x + second.x) / 2, y: (mutant.y + second.y) / 2, label: '东 · 2 只' },
      { kind: 'live', x: boss.x, y: boss.y, label: '南 · 1 只 · 首领' },
    ]);
  });

  it('on a dense-fog night counts only the attackers the player can see right now', () => {
    const { game, mutant } = buildTestWorld();
    game.state.clock = clockAt(NIGHT_DAY1);
    game.state.calendar.nights[0]!.type = 'denseFog';
    // East sector: the test world's wanderer (18.5, 9.5) is in sight, a runner at (20.5, 7.5) is not.
    spawnMutant(game, 'runner', 20.5, 7.5, { mode: 'assault' });
    // South: hidden in the fog, so no marker at all.
    spawnMutant(game, 'behemoth', 8.5, 11.4, { mode: 'assault', boss: true });
    game.state.fog[9 * game.state.map.width + 18] = FOG_VISIBLE;
    expect(threatMarkers(game.state)).toEqual([{ kind: 'live', x: mutant.x, y: mutant.y, label: '东 · 1 只' }]);
  });

  it('on other nights still counts every attacker, seen or not', () => {
    const { game } = buildTestWorld();
    game.state.clock = clockAt(NIGHT_DAY1);
    game.state.calendar.nights[0]!.type = 'raid';
    spawnMutant(game, 'runner', 20.5, 7.5, { mode: 'assault' });
    expect(threatMarkers(game.state).map((m) => m.label)).toEqual(['东 · 2 只']);
  });

  it('drops dead attackers and shows nothing once they are all gone', () => {
    const { game, mutant } = buildTestWorld();
    game.state.clock = clockAt(NIGHT_DAY1);
    mutant.hp = 0;
    expect(threatMarkers(game.state)).toEqual([]);
  });
});
