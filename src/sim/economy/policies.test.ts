import { describe, expect, it } from 'vitest';
import { START, type PolicyId } from '../data/economy';
import { applyCommand, validateCommand } from '../commandHandlers';
import { refreshModifiers, type Game } from '../game';
import { createTestGame } from '../testing';
import { DAY_TICKS, DUSK_TICKS, clockAt } from '../time';
import { usablePolicySlots } from './policies';

const ROWS = ['..........', '...CCC....', '...CCC....', '...CCC....', '..........'];

function at(game: Game, tick: number): void {
  game.state.tick = tick;
  game.state.clock = clockAt(tick);
}

describe('setPolicy', () => {
  it('slots a policy during the day and its effects reach the modifiers', () => {
    const game = createTestGame(ROWS, { origin: 'militia' });
    expect(applyCommand(game, { type: 'setPolicy', slot: 0, policy: 'salvageDrive' })).toEqual({ ok: true });
    expect(game.state.economy.policies.slots).toEqual(['salvageDrive', null, null]);
    expect(game.modifiers.global.scrapYieldPct).toBeCloseTo(0.2);
    expect(applyCommand(game, { type: 'setPolicy', slot: 0, policy: null })).toEqual({ ok: true });
    expect(game.modifiers.global.scrapYieldPct).toBe(0);
  });

  it('is rejected at night, including emptying a slot, and allowed again at dusk and dawn', () => {
    const game = createTestGame(ROWS);
    applyCommand(game, { type: 'setPolicy', slot: 0, policy: 'curfew' });
    at(game, DAY_TICKS);
    expect(validateCommand(game, { type: 'setPolicy', slot: 1, policy: 'salvageDrive' })).toEqual({ ok: false, reason: 'policyNightLocked' });
    expect(validateCommand(game, { type: 'setPolicy', slot: 0, policy: null })).toEqual({ ok: false, reason: 'policyNightLocked' });
    at(game, DAY_TICKS - DUSK_TICKS);
    expect(validateCommand(game, { type: 'setPolicy', slot: 1, policy: 'salvageDrive' })).toEqual({ ok: true });
    at(game, DAY_TICKS + 1000);
    expect(validateCommand(game, { type: 'setPolicy', slot: 1, policy: 'salvageDrive' })).toEqual({ ok: true });
  });

  it('opens the third slot only with policySlots from techs', () => {
    const game = createTestGame(ROWS);
    expect(usablePolicySlots(game.modifiers)).toBe(START.policySlots);
    expect(validateCommand(game, { type: 'setPolicy', slot: 2, policy: 'salvageDrive' })).toEqual({ ok: false, reason: 'slotLocked' });
    game.state.economy.tech.researched.push('lookoutNetwork', 'civicCenter');
    refreshModifiers(game);
    expect(usablePolicySlots(game.modifiers)).toBe(3);
    expect(validateCommand(game, { type: 'setPolicy', slot: 2, policy: 'salvageDrive' })).toEqual({ ok: true });
  });

  it('rejects unknown slots, locked policies and a policy slotted elsewhere', () => {
    const game = createTestGame(ROWS);
    const set = (slot: number, policy: PolicyId | null) => validateCommand(game, { type: 'setPolicy', slot, policy });
    expect(set(-1, 'curfew')).toEqual({ ok: false, reason: 'invalidSlot' });
    expect(set(START.maxPolicySlots, 'curfew')).toEqual({ ok: false, reason: 'invalidSlot' });
    expect(set(0.5, 'curfew')).toEqual({ ok: false, reason: 'invalidSlot' });
    expect(set(0, 'harvestFestival')).toEqual({ ok: false, reason: 'locked' });
    applyCommand(game, { type: 'setPolicy', slot: 0, policy: 'curfew' });
    expect(set(1, 'curfew')).toEqual({ ok: false, reason: 'policyAlreadySlotted' });
    expect(set(0, 'curfew')).toEqual({ ok: true });
  });
});
