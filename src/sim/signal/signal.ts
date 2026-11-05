/** Relay discovery, automatic decoding and broadcast lifecycle. Construction/workers stay in economy. */
import { OK, reject, type CommandHandler } from '../commands';
import { SIGNAL, SIGNAL_TEXT } from '../data/signal';
import { onsiteWorkerCount } from '../economy/workers';
import { emit } from '../events';
import type { Game } from '../game';
import { distanceToRect } from '../map/grid';
import type { Building } from '../state';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS, secondsToTicks } from '../time';
import { isOnMap } from '../world/spatial';

export function signalMessage(game: Game, text: string): void {
  emit(game, { type: 'signalMessage', text });
}

/** Called for any removal; voluntary removal refunds but never retains progress. */
export function removeSignalTower(game: Game, b: Building): void {
  const s = game.state.signal;
  if (b.id !== s.buildingId) return;
  s.retainedProgress = b.hp <= 0 ? (b.construction ? b.construction.progress / b.construction.total : 1) * SIGNAL.retainProgress : 0;
  s.buildingId = 0; s.stage = 'repair'; s.nightsHeld = 0; s.broadcastStartedTick = -1; s.constructionStaffed = false; s.unmannedSinceTick = -1;
  if (b.hp <= 0) signalMessage(game, SIGNAL_TEXT.destroyed);
}

/** Damage protection is conditional on actual construction/broadcast, including environmental damage. */
export function signalDamageFactor(game: Game, b: Building): number {
  return b.type === 'signalTower' && (b.construction !== null || game.state.signal.stage === 'broadcast')
    ? Math.max(0, 1 + game.modifiers.global.signalDamageTakenPct) : 1;
}

export function signalSystem(game: Game): void {
  const { state } = game; const s = state.signal; const site = s.site;
  if (!site) return;
  if (!s.discovered) {
    for (let y = site.tileY; y < site.tileY + site.size; y++) for (let x = site.tileX; x < site.tileX + site.size; x++) {
      if (!s.discovered && state.fog[y * state.map.width + x]! > 0) { s.discovered = true; signalMessage(game, SIGNAL_TEXT.discovered); }
    }
  }
  if (!s.visited) for (const e of state.entities.values()) {
    if ((e.kind === 'soldier' || e.kind === 'survivor') && isOnMap(e) && distanceToRect(site.tileX, site.tileY, site.size, e.x, e.y) <= SIGNAL.arrivalReach) { s.visited = true; break; }
  }
  if (s.stage === 'decoding' && s.visited && game.modifiers.researched.has('oldFrequency')) {
    s.stage = 'repair'; signalMessage(game, SIGNAL_TEXT.decoded);
  }
  s.nightsRequired = Math.max(1, SIGNAL.broadcastNights + game.modifiers.global.signalNightsAdd);
  const b = state.entities.get(s.buildingId);
  if (!b || b.kind !== 'building') return;
  if (b.hp <= 0) { removeSignalTower(game, b); return; }
  if (b.construction) {
    if (onsiteWorkerCount(game, b) > 0) {
      s.constructionStaffed = true;
      s.unmannedSinceTick = -1;
      return;
    }
    // Initial travel is not unattended construction. Once work has begun, an absence counts
    // until somebody actually returns, even when replacements are on their way.
    const initialTravel = !s.constructionStaffed && [...state.entities.values()].some(e =>
      e.kind === 'survivor' && e.hp > 0 && e.insideId === 0 && e.task.type === 'work' && e.task.buildingId === b.id);
    if (initialTravel) {
      s.unmannedSinceTick = -1;
      return;
    }
    if (s.unmannedSinceTick < 0) s.unmannedSinceTick = state.tick;
    if (state.tick - s.unmannedSinceTick >= secondsToTicks(SIGNAL.unmannedDelaySeconds) && s.lastUnmannedDay !== state.clock.day) {
      signalMessage(game, SIGNAL_TEXT.paused);
      s.lastUnmannedDay = state.clock.day;
    }
    return;
  }
  if (s.stage === 'repair') { s.stage = 'ready'; signalMessage(game, SIGNAL_TEXT.ready); }
  if (s.stage !== 'broadcast' || state.clock.phase !== 'day' || state.clock.phaseTick !== 0) return;
  const night = state.clock.day - 1;
  if (night <= s.lastHeldNight) return;
  s.lastHeldNight = night;
  // Only nights whose planning occurred after activation count, including storm nights.
  const plannedTick = (night - 1) * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS;
  if (s.broadcastStartedTick <= plannedTick) s.nightsHeld++;
  const remaining = Math.max(0, s.nightsRequired - s.nightsHeld);
  if (remaining === 0) return;
  const firstDawn = night === Math.floor(s.broadcastStartedTick / CYCLE_TICKS) + 1;
  signalMessage(game, (firstDawn ? SIGNAL_TEXT.dawn : SIGNAL_TEXT.convoy).replace('N', String(remaining)));
}

export const startSignalBroadcastHandler: CommandHandler<'startSignalBroadcast'> = {
  validate(game) {
    const s = game.state.signal; const b = game.state.entities.get(s.buildingId);
    return s.stage === 'ready' && b?.kind === 'building' && b.hp > 0 && b.construction === null ? OK : reject('signalNotReady');
  },
  execute(game) {
    const s = game.state.signal;
    s.stage = 'broadcast'; s.broadcastStartedTick = game.state.tick; s.nightsHeld = 0; s.lastHeldNight = Math.floor(game.state.tick / CYCLE_TICKS);
    signalMessage(game, SIGNAL_TEXT.broadcast);
  },
};
