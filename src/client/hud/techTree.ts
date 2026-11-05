/**
 * Tech tree modal model: three lines, status and progress per tech, inspiration condition and
 * the simulation's inspirationProgress.
 */
import { inspirationProgress, type Game } from '../../sim';
import { TECHS, TECH_IDS, TECH_LINE_NAMES, type TechId, type TechLine } from '../../sim/data/economy';
import { availabilityOf, type Availability } from './availability';

export type TechStatus = 'researched' | 'current' | 'available' | 'locked';

export interface TechNodeModel {
  id: TechId;
  name: string;
  description: string;
  line: TechLine;
  tier: number;
  cost: number;
  points: number;
  /** 0..1 */
  progress: number;
  status: TechStatus;
  inspired: boolean;
  inspirationText: string;
  inspirationProgress: { have: number; need: number } | null;
  requires: string[];
  availability: Availability;
}

export interface TechTreeModel {
  lines: { line: TechLine; name: string; nodes: TechNodeModel[] }[];
  current: TechNodeModel | null;
  researchedCount: number;
  total: number;
}

const LINES: readonly TechLine[] = ['survival', 'military', 'fortification'];

function nodeModel(game: Game, id: TechId): TechNodeModel {
  const def = TECHS[id];
  const tech = game.state.economy.tech;
  const points = tech.progress[id];
  const availability = availabilityOf(game, { type: 'setResearch', tech: id });
  const status: TechStatus = tech.researched.includes(id) ? 'researched' : tech.current === id ? 'current' : availability.ok ? 'available' : 'locked';
  const insp = inspirationProgress(game.state, id);
  return {
    id,
    name: def.name,
    description: def.description,
    line: def.line,
    tier: def.tier,
    cost: def.cost,
    points,
    progress: status === 'researched' ? 1 : Math.min(1, points / def.cost),
    status,
    inspired: tech.inspired.includes(id),
    inspirationText: def.inspirationText,
    inspirationProgress: { have: Math.min(insp.target, Math.floor(insp.value)), need: insp.target },
    requires: def.requires.map((r) => TECHS[r].name),
    availability,
  };
}

export function techTreeModel(game: Game): TechTreeModel {
  const nodes = TECH_IDS.map((id) => nodeModel(game, id));
  return {
    lines: LINES.map((line) => ({
      line,
      name: TECH_LINE_NAMES[line],
      nodes: nodes.filter((n) => n.line === line).sort((a, b) => a.tier - b.tier),
    })),
    current: nodes.find((n) => n.status === 'current') ?? null,
    researchedCount: game.state.economy.tech.researched.length,
    total: TECH_IDS.length,
  };
}
