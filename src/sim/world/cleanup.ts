/**
 * End-of-tick cleanup: removes every entity whose hp reached 0 and emits a died event.
 * The core is never removed (the outcome system ends the game instead). Owner: Task 1.
 */
import { emit } from '../events';
import type { Game } from '../game';
import type { Entity } from '../state';
import { removeEntity } from './entities';

function subtypeOf(e: Entity) {
  switch (e.kind) {
    case 'survivor':
      return 'survivor' as const;
    case 'nest':
      return e.isHive ? ('hive' as const) : ('nest' as const);
    default:
      return e.type;
  }
}

export function cleanupSystem(game: Game): void {
  const dead: Entity[] = [];
  for (const e of game.state.entities.values()) if (e.hp <= 0 && e.id !== game.state.coreId) dead.push(e);
  for (const e of dead) {
    emit(game, { type: 'died', entityId: e.id, kind: e.kind, subtype: subtypeOf(e), faction: e.faction, x: e.x, y: e.y });
    removeEntity(game, e);
  }
}
