import { describe, expect, it } from 'vitest';
import { drainEvents } from '../events';
import { refreshModifiers } from '../game';
import { tileIndex } from '../map/grid';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE } from '../state';
import { createTestGame } from '../testing';
import { spawnSoldier } from './entities';
import { revealCircle, updateFog, visionRadius } from './fog';

const ROWS = [
  '..............................',
  '..............................',
  '..............................',
  '....CCC....................NN.',
  '....CCC....................NN.',
  '....CCC.................ooo...',
  '..............................',
];

describe('fog of war', () => {
  it('sees as far as the entity vision plus the global vision bonus', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'scout', 1.5, 1.5);
    expect(visionRadius(game, s)).toBe(s.vision);
    game.modifiers.global.visionAdd = 2;
    expect(visionRadius(game, s)).toBe(s.vision + 2);
  });

  it('reveals around player entities and leaves far tiles unexplored', () => {
    const game = createTestGame(ROWS, { explored: false });
    updateFog(game);
    const m = game.state.map;
    expect(game.state.fog[tileIndex(m, 5, 4)]).toBe(FOG_VISIBLE);
    expect(game.state.fog[tileIndex(m, 12, 4)]).toBe(FOG_VISIBLE); // core vision 9 from center 5.5
    expect(game.state.fog[tileIndex(m, 20, 4)]).toBe(FOG_UNEXPLORED);
  });

  it('turns tiles that leave vision into explored, not unexplored', () => {
    const game = createTestGame(ROWS, { explored: false });
    const s = spawnSoldier(game, 'scout', 18.5, 1.5);
    updateFog(game);
    const t = tileIndex(game.state.map, 22, 1);
    expect(game.state.fog[t]).toBe(FOG_VISIBLE);
    s.x = 5.5;
    updateFog(game);
    expect(game.state.fog[t]).toBe(FOG_EXPLORED);
  });

  it('counts first-time explored tiles by terrain once', () => {
    const game = createTestGame(ROWS, { explored: false });
    updateFog(game);
    expect(game.state.stats.exploredTerrain.oil).toBe(0);
    const s = spawnSoldier(game, 'scout', 25.5, 5.5);
    updateFog(game);
    expect(game.state.stats.exploredTerrain.oil).toBe(3);
    s.x += 0.2;
    updateFog(game);
    expect(game.state.stats.exploredTerrain.oil).toBe(3);
  });

  it('discovers a nest when it becomes visible and emits one event', () => {
    const game = createTestGame(ROWS, { explored: false });
    updateFog(game);
    const nest = [...game.state.entities.values()].find((e) => e.kind === 'nest')!;
    expect(nest.kind === 'nest' && nest.discovered).toBe(false);
    spawnSoldier(game, 'scout', 25.5, 2.5);
    updateFog(game);
    updateFog(game);
    expect(nest.kind === 'nest' && nest.discovered).toBe(true);
    expect(drainEvents(game).filter((e) => e.type === 'nestDiscovered')).toEqual([{ type: 'nestDiscovered', nestId: nest.id, isHive: false }]);
  });

  it('extends vision by the visionAdd modifier', () => {
    const game = createTestGame(ROWS, { explored: false });
    const t = tileIndex(game.state.map, 15, 4); // 9.5 tiles from the core center
    updateFog(game);
    expect(game.state.fog[t]).toBe(FOG_UNEXPLORED);
    game.state.economy.tech.researched.push('lookoutNetwork');
    refreshModifiers(game);
    updateFog(game);
    expect(game.state.fog[t]).toBe(FOG_VISIBLE);
  });

  it('reveals a circle as explored and discovers nests inside it', () => {
    const game = createTestGame(ROWS, { explored: false });
    revealCircle(game, 27, 4, 2);
    expect(game.state.fog[tileIndex(game.state.map, 27, 4)]).toBe(FOG_EXPLORED);
    const nest = [...game.state.entities.values()].find((e) => e.kind === 'nest')!;
    expect(nest.kind === 'nest' && nest.discovered).toBe(true);
  });
});
