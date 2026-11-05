import { SIGNAL, type SignalStage } from '../data/signal';
import type { EntityId, RelaySite } from '../state';

export interface SignalState {
  site: RelaySite | null;
  discovered: boolean;
  /** Once any living player unit has reached the relay, survives leaving and saves. */
  visited: boolean;
  researchAnnounced: boolean;
  stage: SignalStage;
  buildingId: EntityId;
  /** Fraction restored on the next paid placement; active progress lives in construction. */
  retainedProgress: number;
  /** True after the current construction attempt has had an onsite worker. */
  constructionStaffed: boolean;
  /** -1 while staffed or during initial worker travel. */
  unmannedSinceTick: number;
  /** Last day the empty-site warning was emitted, including earlier construction attempts. */
  lastUnmannedDay: number;
  nightsHeld: number;
  nightsRequired: number;
  broadcastStartedTick: number;
  /** Last broadcast dawn processed, including nights too late to qualify. */
  lastHeldNight: number;
}
export function createSignalState(site: RelaySite | null): SignalState {
  return { site: site ? { ...site } : null, discovered: false, visited: false, researchAnnounced: false,
    stage: 'decoding', buildingId: 0, retainedProgress: 0, constructionStaffed: false, unmannedSinceTick: -1, lastUnmannedDay: 0,
    nightsHeld: 0, nightsRequired: SIGNAL.broadcastNights, broadcastStartedTick: -1, lastHeldNight: 0 };
}
