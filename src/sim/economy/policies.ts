/**
 * Policy cards: slot/unslot during the day (rejected at night), usable slot count
 * START.policySlots + modifiers.global.policySlots, unlocks from data. Effects reach the game
 * through modifiers.ts automatically. Owner: Task 2.
 *
 * "Night" is the phase of the last processed tick (state.clock, what the UI shows); dusk counts
 * as day. Every change is locked at night, emptying a slot included.
 */
import { OK, reject, type CommandHandler } from '../commands';
import { START } from '../data/economy';
import type { Modifiers } from '../modifiers';
import { isDaytime } from '../time';

export function usablePolicySlots(modifiers: Modifiers): number {
  return Math.min(START.maxPolicySlots, START.policySlots + modifiers.global.policySlots);
}

export const setPolicyHandler: CommandHandler<'setPolicy'> = {
  validate(game, cmd) {
    if (!isDaytime(game.state.clock.phase)) return reject('policyNightLocked');
    if (!Number.isInteger(cmd.slot) || cmd.slot < 0 || cmd.slot >= START.maxPolicySlots) return reject('invalidSlot');
    if (cmd.slot >= usablePolicySlots(game.modifiers)) return reject('slotLocked');
    if (cmd.policy === null) return OK;
    if (!game.modifiers.unlockedPolicies.has(cmd.policy)) return reject('locked');
    const slots = game.state.economy.policies.slots;
    return slots.some((p, i) => p === cmd.policy && i !== cmd.slot) ? reject('policyAlreadySlotted') : OK;
  },
  execute(game, cmd) {
    game.state.economy.policies.slots[cmd.slot] = cmd.policy;
  },
};
