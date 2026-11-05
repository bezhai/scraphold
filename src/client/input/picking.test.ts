import { describe, expect, it } from 'vitest';
import { buildTestWorld, revealAll } from '../testWorld';
import { pickEntity, playerUnitsInRect } from './picking';

describe('pickEntity', () => {
  it('picks a unit under the cursor, within its radius plus slack', () => {
    const w = buildTestWorld();
    expect(pickEntity(w.game.state, 2.5, 8.5, 0.1)?.id).toBe(w.rifle1.id);
    expect(pickEntity(w.game.state, 2.5, 8.85, 0.1)?.id).toBe(w.rifle1.id);
    expect(pickEntity(w.game.state, 2.5, 9.3, 0.1)).toBeNull();
  });

  it('picks the nearest of overlapping units', () => {
    const w = buildTestWorld();
    expect(pickEntity(w.game.state, 3.1, 8.5, 0.3)?.id).toBe(w.rifle2.id);
  });

  it('picks buildings by footprint, preferring units standing over them', () => {
    const w = buildTestWorld();
    expect(pickEntity(w.game.state, 9.9, 3.9, 0.1)?.id).toBe(w.greenhouse.id);
    w.rifle1.x = 9.5;
    w.rifle1.y = 3.5;
    expect(pickEntity(w.game.state, 9.5, 3.5, 0.1)?.id).toBe(w.rifle1.id);
  });

  it('only picks mutants on currently visible tiles', () => {
    const w = buildTestWorld();
    expect(pickEntity(w.game.state, 18.5, 9.5, 0.1)).toBeNull();
    revealAll(w.game);
    expect(pickEntity(w.game.state, 18.5, 9.5, 0.1)?.id).toBe(w.mutant.id);
  });

  it('picks discovered nests even under explored fog, never undiscovered ones', () => {
    const w = buildTestWorld();
    expect(pickEntity(w.game.state, 20, 6, 0.1)).toBeNull();
    (w.nest as { discovered: boolean }).discovered = true;
    expect(pickEntity(w.game.state, 20, 6, 0.1)?.id).toBe(w.nest.id);
  });

  it('ignores survivors working inside buildings', () => {
    const w = buildTestWorld();
    w.survivor1.insideId = w.greenhouse.id;
    expect(pickEntity(w.game.state, 2.5, 10.5, 0.1)).toBeNull();
  });
});

describe('playerUnitsInRect', () => {
  it('returns own soldiers and survivors whose centers are inside, in id order', () => {
    const w = buildTestWorld();
    revealAll(w.game);
    w.mutant.x = 3;
    w.mutant.y = 9;
    const ids = playerUnitsInRect(w.game.state, { x0: 3, y0: 8, x1: 1, y1: 11 }).map((e) => e.id);
    expect(ids).toEqual([w.rifle1.id, w.survivor1.id]);
  });
});
