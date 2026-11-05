import { describe, expect, it } from 'vitest';
import { clockAt } from '../../sim';
import { buildTestWorld } from '../testWorld';
import { expectMirrors } from './expectMirrors';
import { policyPanelModel } from './policies';

describe('policyPanelModel', () => {
  it('two of the three slots are usable at the start', () => {
    const { game } = buildTestWorld();
    const m = policyPanelModel(game, null);
    expect(m.slots.map((s) => s.usable)).toEqual([true, true, false]);
    expect(m.targetSlot).toBe(0);
  });

  it('lists every card with its unlock tech', () => {
    const { game } = buildTestWorld();
    const cards = policyPanelModel(game, null).cards;
    expect(cards).toHaveLength(14);
    expect(cards.find((c) => c.id === 'salvageDrive')).toMatchObject({ name: '拾荒令', unlocked: true, lockedBy: null });
    expect(cards.find((c) => c.id === 'harvestFestival')).toMatchObject({ unlocked: false, lockedBy: '社区规划' });
  });

  it('shows slotted cards and mirrors setPolicy for clearing and assigning', () => {
    const { game } = buildTestWorld();
    game.state.economy.policies.slots[0] = 'salvageDrive';
    const m = policyPanelModel(game, null);
    expect(m.slots[0]?.policy?.name).toBe('拾荒令');
    expect(m.cards.find((c) => c.id === 'salvageDrive')?.slottedIn).toBe(0);
    expectMirrors(m.slots[0]?.clear, game, { type: 'setPolicy', slot: 0, policy: null });
    expect(m.targetSlot).toBe(1);
    expectMirrors(m.cards.find((c) => c.id === 'curfew')?.assign, game, { type: 'setPolicy', slot: 1, policy: 'curfew' });
    const chosen = policyPanelModel(game, 0);
    expectMirrors(chosen.cards.find((c) => c.id === 'curfew')?.assign, game, { type: 'setPolicy', slot: 0, policy: 'curfew' });
  });

  it('flags the night lock', () => {
    const { game } = buildTestWorld();
    expect(policyPanelModel(game, null).nightLocked).toBe(false);
    game.state.clock = clockAt(1300);
    expect(policyPanelModel(game, null).nightLocked).toBe(true);
  });
});
