/**
 * Policy (政令) slots and cards. Usable slots come from the simulation's usablePolicySlots;
 * assigning and clearing mirror setPolicy validation (night lock).
 */
import { usablePolicySlots, type Game } from '../../sim';
import { POLICIES, POLICY_IDS, TECHS, type PolicyId } from '../../sim/data/economy';
import { availabilityOf, type Availability } from './availability';

export interface PolicySlotModel {
  index: number;
  usable: boolean;
  policy: { id: PolicyId; name: string; description: string } | null;
  clear: Availability | null;
}

export interface PolicyCardModel {
  id: PolicyId;
  name: string;
  description: string;
  unlocked: boolean;
  lockedBy: string | null;
  slottedIn: number | null;
  assign: Availability;
}

export interface PolicyPanelModel {
  slots: PolicySlotModel[];
  cards: PolicyCardModel[];
  usableSlots: number;
  targetSlot: number;
  nightLocked: boolean;
}

export function policyPanelModel(game: Game, chosenSlot: number | null): PolicyPanelModel {
  const slotted = game.state.economy.policies.slots;
  const usableSlots = usablePolicySlots(game.modifiers);
  const firstEmpty = slotted.findIndex((p, i) => i < usableSlots && p === null);
  const targetSlot = chosenSlot ?? (firstEmpty >= 0 ? firstEmpty : 0);
  const slots = slotted.map((p, index) => ({
    index,
    usable: index < usableSlots,
    policy: p ? { id: p, name: POLICIES[p].name, description: POLICIES[p].description } : null,
    clear: p ? availabilityOf(game, { type: 'setPolicy', slot: index, policy: null }) : null,
  }));
  const cards = POLICY_IDS.map((id) => {
    const def = POLICIES[id];
    const unlocked = game.modifiers.unlockedPolicies.has(id);
    const at = slotted.indexOf(id);
    return {
      id,
      name: def.name,
      description: def.description,
      unlocked,
      lockedBy: !unlocked && def.tech ? TECHS[def.tech].name : null,
      slottedIn: at >= 0 ? at : null,
      assign: availabilityOf(game, { type: 'setPolicy', slot: targetSlot, policy: id }),
    };
  });
  return { slots, cards, usableSlots, targetSlot, nightLocked: game.state.clock.phase === 'night' };
}
