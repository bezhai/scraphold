import { describe, expect, it } from 'vitest';
import { buildTestWorld } from '../testWorld';
import { CONTROL_GROUP_COUNT, addToGroup, assignGroup, createControlGroups, recallGroup } from './controlGroups';

describe('control groups', () => {
  it('starts with empty groups', () => {
    expect(createControlGroups()).toHaveLength(CONTROL_GROUP_COUNT);
    expect(createControlGroups().every((g) => g.length === 0)).toBe(true);
  });

  it('assign stores a copy of the selection in one group only', () => {
    const w = buildTestWorld();
    const groups = assignGroup(createControlGroups(), 1, [w.rifle1.id, w.guard.id]);
    expect(groups[1]).toEqual([w.rifle1.id, w.guard.id]);
    expect(groups[0]).toEqual([]);
    expect(assignGroup(groups, 1, [])[1]).toEqual([]);
  });

  it('add appends without duplicates', () => {
    const w = buildTestWorld();
    const groups = addToGroup(assignGroup(createControlGroups(), 0, [w.rifle1.id]), 0, [w.rifle1.id, w.rifle2.id]);
    expect(groups[0]).toEqual([w.rifle1.id, w.rifle2.id]);
  });

  it('recall returns the living members only', () => {
    const w = buildTestWorld();
    const groups = assignGroup(createControlGroups(), 2, [w.rifle1.id, w.rifle2.id, w.barracks.id]);
    w.rifle2.hp = 0;
    expect(recallGroup(w.game.state, groups, 2)).toEqual([w.rifle1.id, w.barracks.id]);
    expect(recallGroup(w.game.state, groups, 4)).toEqual([]);
  });
});
