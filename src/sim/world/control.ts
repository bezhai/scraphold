/**
 * Who controls a player unit (Survivor.control, Soldier.control). Owner: v3 Task 2.
 *
 * Units start under automatic control. Every unit command puts the units it commands under
 * player control (world/orders.ts, economy/workers.ts); stop hands them back at once. Orders with an end hand the unit back here when they end, whether they finished or
 * failed: a soldier whose move, attack-move or focus fire is over has the idle order; a survivor
 * whose move, repair or job has ended stands idle on the map. Holding, assigned work and waiting
 * after unassignWork (task 'wait') have no end and stay under player control until the next
 * command; a finished signal tower hands its crew back itself (economy/construction.ts). A survivor
 * isolated by an incident sits in the core and is handed back when the isolation ends
 * (incidents/effects.ts).
 */
import type { Game } from '../game';
import type { Soldier, Survivor } from '../state';

/** The player's last order to this unit has nothing left to do. */
function orderEnded(u: Survivor | Soldier): boolean {
  if (u.kind === 'soldier') return u.order.type === 'idle';
  return u.task.type === 'idle' && u.insideId === 0 && u.motion.mode === 'stand';
}

export function controlSystem(game: Game): void {
  for (const e of game.state.entities.values()) {
    if ((e.kind === 'survivor' || e.kind === 'soldier') && e.control === 'player' && orderEnded(e)) e.control = 'auto';
  }
}
