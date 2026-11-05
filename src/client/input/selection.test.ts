import { describe, expect, it } from 'vitest';
import { buildTestWorld, revealAll } from '../testWorld';
import { pruneSelection, selectionAfterBox, selectionAfterClick, sameTypeInRect } from './selection';

describe('selectionAfterClick', () => {
  it('replaces the selection with the clicked own unit', () => {
    const w = buildTestWorld();
    expect(selectionAfterClick(w.game.state, [w.rifle2.id], w.rifle1, false)).toEqual([w.rifle1.id]);
  });

  it('shift toggles units in and out of a unit selection', () => {
    const w = buildTestWorld();
    const added = selectionAfterClick(w.game.state, [w.rifle2.id], w.rifle1, true);
    expect(added).toEqual([w.rifle2.id, w.rifle1.id]);
    expect(selectionAfterClick(w.game.state, added, w.rifle2, true)).toEqual([w.rifle1.id]);
  });

  it('shift-clicking a unit while a building is selected starts a new unit selection', () => {
    const w = buildTestWorld();
    expect(selectionAfterClick(w.game.state, [w.barracks.id], w.rifle1, true)).toEqual([w.rifle1.id]);
  });

  it('buildings and enemies are selected alone', () => {
    const w = buildTestWorld();
    expect(selectionAfterClick(w.game.state, [w.rifle1.id], w.barracks, true)).toEqual([w.barracks.id]);
    expect(selectionAfterClick(w.game.state, [w.rifle1.id], w.mutant, false)).toEqual([w.mutant.id]);
  });

  it('clicking empty ground clears, unless shift is held', () => {
    const w = buildTestWorld();
    expect(selectionAfterClick(w.game.state, [w.rifle1.id], null, false)).toEqual([]);
    expect(selectionAfterClick(w.game.state, [w.rifle1.id], null, true)).toEqual([w.rifle1.id]);
  });
});

describe('selectionAfterBox', () => {
  it('replaces with the boxed units, or adds them with shift', () => {
    const w = buildTestWorld();
    expect(selectionAfterBox(w.game.state, [w.barracks.id], [w.rifle1.id, w.guard.id], false)).toEqual([w.rifle1.id, w.guard.id]);
    expect(selectionAfterBox(w.game.state, [w.rifle1.id], [w.rifle1.id, w.guard.id], true)).toEqual([w.rifle1.id, w.guard.id]);
  });

  it('a box that catches soldiers takes only the soldiers; survivors only when no soldier is in it', () => {
    const w = buildTestWorld();
    expect(selectionAfterBox(w.game.state, [], [w.survivor1.id, w.rifle1.id, w.survivor2.id, w.guard.id], false)).toEqual([w.rifle1.id, w.guard.id]);
    expect(selectionAfterBox(w.game.state, [], [w.survivor1.id, w.survivor2.id], false)).toEqual([w.survivor1.id, w.survivor2.id]);
    expect(selectionAfterBox(w.game.state, [w.survivor1.id], [w.survivor2.id, w.rifle1.id], true)).toEqual([w.survivor1.id, w.rifle1.id]);
  });

  it('shift-box over a building selection drops the building', () => {
    const w = buildTestWorld();
    expect(selectionAfterBox(w.game.state, [w.barracks.id], [w.guard.id], true)).toEqual([w.guard.id]);
  });

  it('an empty box clears the selection without shift', () => {
    const w = buildTestWorld();
    expect(selectionAfterBox(w.game.state, [w.rifle1.id], [], false)).toEqual([]);
    expect(selectionAfterBox(w.game.state, [w.rifle1.id], [], true)).toEqual([w.rifle1.id]);
  });
});

describe('sameTypeInRect (double-click)', () => {
  it('selects own units of the same soldier type inside the view', () => {
    const w = buildTestWorld();
    const view = { x0: 0, y0: 0, x1: 24, y1: 12 };
    expect(sameTypeInRect(w.game.state, w.rifle1, view)).toEqual([w.rifle1.id, w.rifle2.id]);
    expect(sameTypeInRect(w.game.state, w.rifle1, { x0: 3, y0: 0, x1: 24, y1: 12 })).toEqual([w.rifle2.id]);
  });

  it('works for survivors and falls back to the unit for other kinds', () => {
    const w = buildTestWorld();
    const view = { x0: 0, y0: 0, x1: 24, y1: 12 };
    expect(sameTypeInRect(w.game.state, w.survivor2, view)).toEqual([w.survivor1.id, w.survivor2.id]);
    expect(sameTypeInRect(w.game.state, w.barracks, view)).toEqual([w.barracks.id]);
  });
});

describe('pruneSelection', () => {
  it('drops dead entities, survivors that went inside and enemies out of sight', () => {
    const w = buildTestWorld();
    revealAll(w.game);
    w.rifle1.hp = 0;
    w.survivor1.insideId = w.greenhouse.id;
    expect(pruneSelection(w.game.state, [w.rifle1.id, w.survivor1.id, w.rifle2.id])).toEqual([w.rifle2.id]);
    expect(pruneSelection(w.game.state, [w.mutant.id])).toEqual([w.mutant.id]);
    w.game.state.fog.fill(1);
    expect(pruneSelection(w.game.state, [w.mutant.id])).toEqual([]);
    expect(pruneSelection(w.game.state, [9999])).toEqual([]);
  });
});
