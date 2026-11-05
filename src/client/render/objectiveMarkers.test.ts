import { describe, expect, it } from 'vitest';
import { INCIDENT_RULES, type IncidentTarget, type PendingIncident } from '../../sim';
import { createTestGame } from '../../sim/testing';
import { objectiveMarkers, targetTimeLeft } from './objectiveMarkers';

const ROWS = [
  '....................',
  '..NN................',
  '..NN................',
  '.........CCC........',
  '.........CCC........',
  '.........CCC........',
  '....................',
  '.................HHH',
  '.................HHH',
  '.................HHH',
];
const W = ROWS[0]!.length;

function setup() {
  const game = createTestGame(ROWS);
  const nests = [...game.state.entities.values()].filter((e) => e.kind === 'nest');
  const nest = nests.find((e) => !e.isHive)!;
  const hive = nests.find((e) => e.isHive)!;
  return { game, nest, hive };
}

function target(over: Partial<IncidentTarget>): IncidentTarget {
  return { kind: 'rescue', tile: 2 * W + 15, nestId: 0, splitTile: -1, id: 7, incidentId: 3, title: '求救信号', createdTick: 0, expiresTick: 4400, status: 'active', guardIds: [], ...over };
}

function pending(over: Partial<PendingIncident>): PendingIncident {
  return { id: 3, definitionId: 'rescue', raisedTick: 0, deadlineTick: 1200, title: '求救信号', description: '', choices: [], target: null, ...over } as PendingIncident;
}

describe('targetTimeLeft', () => {
  it('formats the game time left as m:ss, rounding up to whole seconds and stopping at 0:00', () => {
    expect(targetTimeLeft(4400, 0)).toBe('3:40');
    expect(targetTimeLeft(1300, 0)).toBe('1:05');
    expect(targetTimeLeft(100, 99)).toBe('0:01');
    expect(targetTimeLeft(100, 100)).toBe('0:00');
    expect(targetTimeLeft(100, 160)).toBe('0:00');
  });
});

describe('objectiveMarkers: incident targets', () => {
  it('marks every active target with its title and the game time left, and none of the finished ones', () => {
    const { game } = setup();
    game.state.tick = 400;
    game.state.incidents.targets.push(
      target({ id: 7, tile: 2 * W + 15, expiresTick: 4400 }),
      target({ id: 8, tile: 6 * W + 1, status: 'completed' }),
      target({ id: 9, tile: 6 * W + 2, status: 'expired' }),
    );
    expect(objectiveMarkers(game.state)).toEqual([{ kind: 'target', x: 15.5, y: 2.5, reach: INCIDENT_RULES.targetReach, label: '求救信号 · 剩 3:20' }]);
  });

  it('rings a nest split target around the parent nest', () => {
    const { game, nest } = setup();
    game.state.incidents.targets.push(target({ kind: 'nestSplit', title: '巢穴分裂', tile: 1 * W + 2, nestId: nest.id, splitTile: 4 * W + 2 }));
    const [m] = objectiveMarkers(game.state);
    expect(m).toMatchObject({ kind: 'target', x: 2.5, y: 1.5, label: '巢穴分裂 · 剩 3:40' });
    expect(m!.reach).toBeGreaterThanOrEqual(nest.size / 2);
  });

  it('pre-marks the target of the card still waiting for a decision, as undecided', () => {
    const { game } = setup();
    game.state.incidents.pending = pending({ target: { kind: 'rescue', tile: 8 * W + 4, nestId: 0, splitTile: -1 } });
    expect(objectiveMarkers(game.state)).toEqual([{ kind: 'pendingTarget', x: 4.5, y: 8.5, reach: INCIDENT_RULES.targetReach, label: '求救信号（未决定）' }]);
  });

  it('marks nothing for a pending card without a target', () => {
    const { game } = setup();
    game.state.incidents.pending = pending({ title: '流浪商队', definitionId: 'caravan' });
    expect(objectiveMarkers(game.state)).toEqual([]);
  });
});

describe('objectiveMarkers: relay and hive', () => {
  it('names the K-7 relay with the simulation stage name once it is discovered', () => {
    const { game } = setup();
    game.state.signal.site = { tileX: 13, tileY: 0, size: 3 };
    expect(objectiveMarkers(game.state)).toEqual([]);
    game.state.signal.discovered = true;
    expect(objectiveMarkers(game.state)).toEqual([{ kind: 'relay', x: 14.5, y: 1.5, reach: 1.5, label: 'K-7 中继站 · 未破译' }]);
    game.state.signal.stage = 'broadcast';
    expect(objectiveMarkers(game.state)[0]!.label).toBe('K-7 中继站 · 广播中');
  });

  it('points at the hive once it is known, and not while it is still hidden', () => {
    const { game, hive } = setup();
    hive.discovered = false;
    expect(objectiveMarkers(game.state)).toEqual([]);
    hive.discovered = true;
    const [m] = objectiveMarkers(game.state);
    expect(m).toMatchObject({ kind: 'hive', x: hive.x, y: hive.y, label: '母巢' });
    expect(m!.reach).toBeGreaterThan(hive.size / 2);
    hive.hp = 0;
    expect(objectiveMarkers(game.state)).toEqual([]);
  });
});
