/**
 * Daytime incidents for the HUD: whether a choice can be taken (validateCommand and its reason
 * text, never a client-side rule), and the reminder of the pending incident in the event log,
 * which at dusk counts the game seconds left before nightfall settles it (deadlineTick).
 */
import { TICKS_PER_SECOND, type Game, type GameView } from '../../sim';
import { availabilityOf, type Availability } from './availability';

/** The dusk countdown blinks over its last this many seconds. */
const URGENT_SECONDS = 10;

export function incidentChoiceAvailability(game: Game, incidentId: number, choiceId: string): Availability {
  return availabilityOf(game, { type: 'resolveIncident', incidentId, choiceId });
}

export interface PendingIncidentNotice {
  title: string;
  /** Game seconds until nightfall settles the incident; null outside dusk. */
  secondsToNight: number | null;
  urgent: boolean;
}

export function pendingIncidentNotice(view: GameView): PendingIncidentNotice | null {
  const pending = view.incidents.pending;
  if (!pending) return null;
  const secondsToNight = view.clock.phase === 'dusk' ? Math.ceil(Math.max(0, pending.deadlineTick - view.tick) / TICKS_PER_SECOND) : null;
  return { title: pending.title, secondsToNight, urgent: secondsToNight !== null && secondsToNight <= URGENT_SECONDS };
}
