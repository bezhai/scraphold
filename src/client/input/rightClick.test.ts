import { describe, expect, it } from 'vitest';
import { addBuilding } from '../../sim/world/entities';
import { buildTestWorld, revealAll } from '../testWorld';
import { commandsForRightClick } from './rightClick';

const ground = (x: number, y: number) => ({ x, y, entity: null });

describe('right-click on the ground', () => {
  it('soldiers attack-move', () => {
    const w = buildTestWorld();
    const cmds = commandsForRightClick(w.game.state, [w.rifle1.id, w.guard.id], ground(5, 5), { forceMove: false });
    expect(cmds).toEqual([{ type: 'attackMove', unitIds: [w.rifle1.id, w.guard.id], x: 5, y: 5 }]);
  });

  it('Ctrl forces a plain move', () => {
    const w = buildTestWorld();
    const cmds = commandsForRightClick(w.game.state, [w.rifle1.id], ground(5, 5), { forceMove: true });
    expect(cmds).toEqual([{ type: 'move', unitIds: [w.rifle1.id], x: 5, y: 5 }]);
  });

  it('survivors alone move; a mixed group gets one attackMove (survivors walk, soldiers fight)', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.survivor1.id], ground(5, 5), { forceMove: false })).toEqual([
      { type: 'move', unitIds: [w.survivor1.id], x: 5, y: 5 },
    ]);
    expect(commandsForRightClick(w.game.state, [w.survivor1.id, w.rifle1.id], ground(5, 5), { forceMove: false })).toEqual([
      { type: 'attackMove', unitIds: [w.survivor1.id, w.rifle1.id], x: 5, y: 5 },
    ]);
  });

  it('right-clicking an own unit counts as the ground under it', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.rifle1.id], { x: 3.5, y: 8.5, entity: w.rifle2 }, { forceMove: false })).toEqual([
      { type: 'attackMove', unitIds: [w.rifle1.id], x: 3.5, y: 8.5 },
    ]);
  });

  it('ignores ids that are not own units on the map', () => {
    const w = buildTestWorld();
    w.survivor2.insideId = w.greenhouse.id;
    expect(commandsForRightClick(w.game.state, [w.survivor2.id, 9999], ground(5, 5), { forceMove: false })).toEqual([]);
  });
});

describe('right-click on enemies', () => {
  it('soldiers focus fire; survivors in the selection only move there', () => {
    const w = buildTestWorld();
    revealAll(w.game);
    const target = { x: 18.5, y: 9.5, entity: w.mutant };
    expect(commandsForRightClick(w.game.state, [w.rifle1.id, w.survivor1.id], target, { forceMove: false })).toEqual([
      { type: 'attackTarget', unitIds: [w.rifle1.id], targetId: w.mutant.id },
      { type: 'move', unitIds: [w.survivor1.id], x: 18.5, y: 9.5 },
    ]);
  });

  it('nests are attack targets too', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.guard.id], { x: 20, y: 6, entity: w.nest }, { forceMove: false })).toEqual([
      { type: 'attackTarget', unitIds: [w.guard.id], targetId: w.nest.id },
    ]);
  });

  it('Ctrl overrides focus fire with a forced move', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.rifle1.id], { x: 18.5, y: 9.5, entity: w.mutant }, { forceMove: true })).toEqual([
      { type: 'move', unitIds: [w.rifle1.id], x: 18.5, y: 9.5 },
    ]);
  });
});

describe('right-click on own buildings', () => {
  it('survivors are assigned to a finished workplace', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.survivor1.id, w.survivor2.id], { x: 9, y: 3, entity: w.greenhouse }, { forceMove: false })).toEqual([
      { type: 'assignWork', unitIds: [w.survivor1.id, w.survivor2.id], buildingId: w.greenhouse.id },
    ]);
  });

  it('survivors repair damaged buildings and help construction sites', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.survivor1.id], { x: 3, y: 1, entity: w.damaged }, { forceMove: false })).toEqual([
      { type: 'repair', unitIds: [w.survivor1.id], buildingId: w.damaged.id },
    ]);
    expect(commandsForRightClick(w.game.state, [w.survivor1.id], { x: 13, y: 9, entity: w.site }, { forceMove: false })).toEqual([
      { type: 'repair', unitIds: [w.survivor1.id], buildingId: w.site.id },
    ]);
  });

  it('survivors just walk to an intact building without workplaces', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.survivor1.id], { x: 16, y: 9, entity: w.shack }, { forceMove: false })).toEqual([
      { type: 'move', unitIds: [w.survivor1.id], x: 16, y: 9 },
    ]);
  });

  it('survivors join the signal tower’s building crew (assignWork), since the relay counts no repair helpers', () => {
    const w = buildTestWorld();
    const tower = addBuilding(w.game, 'signalTower', 19, 9, { complete: false });
    const at = { x: tower.x, y: tower.y, entity: tower };
    expect(commandsForRightClick(w.game.state, [w.survivor1.id, w.rifle1.id], at, { forceMove: false })).toEqual([
      { type: 'assignWork', unitIds: [w.survivor1.id], buildingId: tower.id },
      { type: 'move', unitIds: [w.rifle1.id], x: tower.x, y: tower.y },
    ]);
    // Finished, it takes no crew: damaged it gets repaired, intact the survivors just walk there.
    tower.construction = null;
    tower.hp = tower.maxHp - 100;
    expect(commandsForRightClick(w.game.state, [w.survivor1.id], at, { forceMove: false })).toEqual([{ type: 'repair', unitIds: [w.survivor1.id], buildingId: tower.id }]);
    tower.hp = tower.maxHp;
    expect(commandsForRightClick(w.game.state, [w.survivor1.id], at, { forceMove: false })).toEqual([{ type: 'move', unitIds: [w.survivor1.id], x: tower.x, y: tower.y }]);
  });

  it('soldiers only move next to own buildings, never repair; mixed selections split by kind', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.rifle1.id], { x: 3, y: 1, entity: w.damaged }, { forceMove: false })).toEqual([
      { type: 'move', unitIds: [w.rifle1.id], x: 3, y: 1 },
    ]);
    expect(commandsForRightClick(w.game.state, [w.rifle1.id, w.survivor1.id], { x: 9, y: 3, entity: w.greenhouse }, { forceMove: false })).toEqual([
      { type: 'assignWork', unitIds: [w.survivor1.id], buildingId: w.greenhouse.id },
      { type: 'move', unitIds: [w.rifle1.id], x: 9, y: 3 },
    ]);
  });
});

describe('right-click with a building selected', () => {
  it('a training building sets its rally point', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.barracks.id], ground(6, 9), { forceMove: false })).toEqual([
      { type: 'setRally', buildingId: w.barracks.id, x: 6, y: 9 },
    ]);
  });

  it('other buildings and enemy selections issue nothing', () => {
    const w = buildTestWorld();
    expect(commandsForRightClick(w.game.state, [w.greenhouse.id], ground(6, 9), { forceMove: false })).toEqual([]);
    expect(commandsForRightClick(w.game.state, [w.mutant.id], ground(6, 9), { forceMove: false })).toEqual([]);
    expect(commandsForRightClick(w.game.state, [], ground(6, 9), { forceMove: false })).toEqual([]);
  });
});
