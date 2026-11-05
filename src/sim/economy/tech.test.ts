import { describe, expect, it } from 'vitest';
import { INSPIRATION_BOOST, TECHS, type Inspiration, type TechId } from '../data/economy';
import { applyCommand, validateCommand } from '../commandHandlers';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { createTestGame } from '../testing';
import { addBuilding, spawnSoldier, spawnSurvivor } from '../world/entities';
import { inspirationProgress, techSystem } from './tech';

const ROWS = ['..........', '..........', '...CCC....', '...CCC....', '...CCC....', '..........'];

function withInspiration(tech: TechId, inspiration: Inspiration, test: () => void): void {
  const def = TECHS[tech];
  const saved = def.inspiration;
  def.inspiration = inspiration;
  try {
    test();
  } finally {
    def.inspiration = saved;
  }
}

function progressOf(game: Game, tech: TechId, inspiration: Inspiration) {
  let out = { value: 0, target: 0 };
  withInspiration(tech, inspiration, () => (out = inspirationProgress(game.state, tech)));
  return out;
}

describe('setResearch', () => {
  it('selects a tech whose prerequisites are researched, or none', () => {
    const game = createTestGame(ROWS);
    expect(applyCommand(game, { type: 'setResearch', tech: 'scavengingTools' })).toEqual({ ok: true });
    expect(game.state.economy.tech.current).toBe('scavengingTools');
    expect(applyCommand(game, { type: 'setResearch', tech: null })).toEqual({ ok: true });
    expect(game.state.economy.tech.current).toBeNull();
  });

  it('rejects missing prerequisites and finished techs', () => {
    const game = createTestGame(ROWS);
    expect(validateCommand(game, { type: 'setResearch', tech: 'hydroponics' })).toEqual({ ok: false, reason: 'prerequisitesMissing' });
    game.state.economy.tech.researched.push('scavengingTools');
    expect(validateCommand(game, { type: 'setResearch', tech: 'hydroponics' })).toEqual({ ok: true });
    expect(validateCommand(game, { type: 'setResearch', tech: 'scavengingTools' })).toEqual({ ok: false, reason: 'alreadyResearched' });
  });
});

describe('research progress', () => {
  it('moves banked research into the current tech and completes it', () => {
    const game = createTestGame(ROWS);
    const { tech, resources } = game.state.economy;
    resources.research = 30;
    applyCommand(game, { type: 'setResearch', tech: 'armory' });
    techSystem(game);
    expect(tech.progress.armory).toBe(30);
    expect(resources.research).toBe(0);
    resources.research = TECHS.armory.cost;
    drainEvents(game);
    techSystem(game);
    expect(tech.researched).toEqual(['armory']);
    expect(tech.current).toBeNull();
    expect(tech.progress.armory).toBe(TECHS.armory.cost);
    expect(resources.research).toBe(30);
    expect(drainEvents(game)).toContainEqual({ type: 'researchCompleted', tech: 'armory' });
    expect(game.modifiers.unlockedBuildings.has('armory')).toBe(true);
  });

  it('banks research while nothing is selected and keeps progress when switching', () => {
    const game = createTestGame(ROWS);
    const { tech, resources } = game.state.economy;
    resources.research = 12;
    techSystem(game);
    expect(resources.research).toBe(12);
    applyCommand(game, { type: 'setResearch', tech: 'machineGuns' });
    techSystem(game);
    applyCommand(game, { type: 'setResearch', tech: 'scavengingTools' });
    resources.research = 5;
    techSystem(game);
    expect(tech.progress).toMatchObject({ machineGuns: 12, scavengingTools: 5 });
  });
});

describe('inspiration', () => {
  it('adds half of the cost once when the condition is met, even if not selected', () => {
    const game = createTestGame(ROWS);
    const { tech } = game.state.economy;
    game.state.stats.ruinsExplored = 2;
    techSystem(game);
    expect(tech.inspired).toEqual([]);
    game.state.stats.ruinsExplored = 3;
    techSystem(game);
    expect(tech.inspired).toContain('ruinArchives');
    expect(tech.progress.ruinArchives).toBe(TECHS.ruinArchives.cost * INSPIRATION_BOOST);
    expect(drainEvents(game)).toContainEqual({ type: 'inspiration', tech: 'ruinArchives' });
    techSystem(game);
    expect(tech.progress.ruinArchives).toBe(TECHS.ruinArchives.cost * INSPIRATION_BOOST);
  });

  it('halves the research still needed after the boost', () => {
    const game = createTestGame(ROWS);
    const { tech, resources } = game.state.economy;
    applyCommand(game, { type: 'setResearch', tech: 'scavengingTools' });
    addBuilding(game, 'salvageYard', 0, 0, { complete: true });
    addBuilding(game, 'salvageYard', 7, 0, { complete: true });
    resources.research = TECHS.scavengingTools.cost * INSPIRATION_BOOST;
    techSystem(game);
    expect(tech.researched).toEqual(['scavengingTools']);
    expect(resources.research).toBe(0);
  });

  it('completes a tech pushed over its cost by the boost, keeping the excess out', () => {
    const game = createTestGame(ROWS);
    const { tech } = game.state.economy;
    tech.progress.machineGuns = TECHS.machineGuns.cost * 0.8;
    game.state.stats.nightsWithoutBuildingLoss = 1;
    techSystem(game);
    expect(tech.researched).toEqual(['machineGuns']);
    expect(tech.progress.machineGuns).toBe(TECHS.machineGuns.cost);
  });

  it('does not inspire techs already researched', () => {
    const game = createTestGame(ROWS);
    game.state.economy.tech.researched.push('machineGuns');
    game.state.stats.nightsWithoutBuildingLoss = 1;
    techSystem(game);
    expect(game.state.economy.tech.inspired).toEqual([]);
  });

  it('measures every kind of condition from stats and current entities', () => {
    const game = createTestGame(ROWS, { survivors: 2 });
    const { stats } = game.state;
    stats.kills.crawler = 3;
    stats.kills.boomer = 2;
    stats.exploredTerrain.oil = 4;
    stats.nightsWithoutBuildingLoss = 2;
    stats.soldiersTrained.rifleman = 3;
    stats.soldiersTrained.scout = 1;
    stats.nestsDestroyed = 1;
    stats.promotions = 2;
    stats.hpRepaired = 120;
    game.state.economy.tech.researched.push('armory', 'machineGuns');
    addBuilding(game, 'watchtower', 0, 0, { complete: true });
    addBuilding(game, 'watchtower', 1, 0, { complete: false });
    spawnSoldier(game, 'rifleman', 8.5, 0.5);
    spawnSurvivor(game, 8.5, 1.5);
    const t: TechId = 'steelLine';
    expect(progressOf(game, t, { kind: 'killMutants', mutant: 'any', count: 40 })).toEqual({ value: 5, target: 40 });
    expect(progressOf(game, t, { kind: 'killMutants', mutant: 'boomer', count: 5 })).toEqual({ value: 2, target: 5 });
    expect(progressOf(game, t, { kind: 'exploreRuins', count: 3 })).toEqual({ value: 0, target: 3 });
    expect(progressOf(game, t, { kind: 'discoverTerrain', terrain: 'oil', count: 1 })).toEqual({ value: 4, target: 1 });
    expect(progressOf(game, t, { kind: 'nightsWithoutBuildingLoss', count: 1 })).toEqual({ value: 2, target: 1 });
    expect(progressOf(game, t, { kind: 'ownBuildings', building: 'watchtower', count: 1 })).toEqual({ value: 1, target: 1 });
    expect(progressOf(game, t, { kind: 'population', count: 12 })).toEqual({ value: 4, target: 12 });
    expect(progressOf(game, t, { kind: 'trainSoldiers', count: 4 })).toEqual({ value: 4, target: 4 });
    expect(progressOf(game, t, { kind: 'destroyNests', count: 1 })).toEqual({ value: 1, target: 1 });
    expect(progressOf(game, t, { kind: 'promoteVeterans', count: 2 })).toEqual({ value: 2, target: 2 });
    expect(progressOf(game, t, { kind: 'repairHp', amount: 300 })).toEqual({ value: 120, target: 300 });
    expect(progressOf(game, t, { kind: 'researchTechs', count: 4 })).toEqual({ value: 2, target: 4 });
  });
});
