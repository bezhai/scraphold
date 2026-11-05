/**
 * Building lookups shared by the economy systems: a building by id, and the spot beside a
 * structure where units appear (births, recruits, trained soldiers) or walk to (workers).
 * Owner: Task 2.
 */
import type { Game } from '../game';
import { tileCenter } from '../map/grid';
import type { Building, Entity, EntityId, Point, Structure } from '../state';
import { freeTileAround } from '../world/entities';

export function buildingById(game: Game, id: EntityId): Building | null {
  const e: Entity | undefined = game.state.entities.get(id);
  return e && e.kind === 'building' ? e : null;
}

/** Center of the nearest open tile next to `s`, toward (towardX, towardY); `s`'s center if boxed in. */
export function pointBeside(game: Game, s: Structure, towardX = s.x, towardY = s.y): Point {
  const tile = freeTileAround(game, s, towardX, towardY);
  return tile === -1 ? { x: s.x, y: s.y } : tileCenter(game.state.map, tile);
}
