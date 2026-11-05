import { describe, expect, it } from 'vitest';
import { TECHS } from '../../sim/data/economy';
import { buildTestWorld } from '../testWorld';
import { expectMirrors } from './expectMirrors';
import { techTreeModel } from './techTree';

describe('techTreeModel', () => {
  it('has three expanded lines of techs ordered by tier', () => {
    const { game } = buildTestWorld();
    const m = techTreeModel(game);
    expect(m.lines.map((l) => l.name)).toEqual(['生存线', '军工线', '工事线']);
    expect(m.lines.map(l => l.nodes.length)).toEqual([10, 8, 7]);
    for (const l of m.lines) {
      expect(l.nodes.map((n) => n.tier)).toEqual([...l.nodes.map((n) => n.tier)].sort((a, b) => a - b));
    }
    expect(m.total).toBe(25);
  });

  it('derives status, progress and inspiration from the tech state', () => {
    const { game } = buildTestWorld();
    const tech = game.state.economy.tech;
    tech.researched.push('scavengingTools');
    tech.current = 'refinery';
    tech.progress.refinery = TECHS.refinery.cost / 2;
    tech.inspired.push('refinery');
    const nodes = techTreeModel(game).lines.flatMap((l) => l.nodes);
    const byId = (id: string) => nodes.find((n) => n.id === id);
    expect(byId('scavengingTools')?.status).toBe('researched');
    expect(byId('refinery')).toMatchObject({ status: 'current', progress: 0.5, inspired: true, inspirationText: TECHS.refinery.inspirationText });
    expect(byId('hydroponics')?.requires).toEqual(['拾荒工具']);
    expect(techTreeModel(game).current?.id).toBe('refinery');
    expect(techTreeModel(game).researchedCount).toBe(1);
  });

  it('mirrors setResearch for availability', () => {
    const { game } = buildTestWorld();
    const node = techTreeModel(game).lines[1]?.nodes[0];
    expectMirrors(node?.availability, game, { type: 'setResearch', tech: 'armory' });
    const other = techTreeModel(game).lines[0]?.nodes[0];
    expect(other?.status === 'available').toBe(other?.availability.ok);
  });

  it('shows the simulation’s inspiration progress, capped at the target', () => {
    const w = buildTestWorld();
    w.game.state.stats.kills.wanderer = 10;
    w.game.state.stats.kills.runner = 5;
    w.game.state.stats.exploredTerrain.oil = 3;
    const nodes = techTreeModel(w.game).lines.flatMap((l) => l.nodes);
    const need = (id: 'demolitions' | 'scavengingTools' | 'refinery') => {
      const c = TECHS[id].inspiration;
      return c.kind === 'repairHp' ? c.amount : c.count;
    };
    expect(nodes.find((n) => n.id === 'demolitions')?.inspirationProgress).toEqual({ have: Math.min(15, need('demolitions')), need: need('demolitions') });
    expect(nodes.find((n) => n.id === 'scavengingTools')?.inspirationProgress).toEqual({ have: Math.min(1, need('scavengingTools')), need: need('scavengingTools') });
    expect(nodes.find((n) => n.id === 'refinery')?.inspirationProgress).toEqual({ have: Math.min(3, need('refinery')), need: need('refinery') });
  });
});
