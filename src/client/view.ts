/**
 * Read-only entity types of the game view and the visibility rules the client needs to decide
 * what it may show or pick: mutants only on visible tiles, nests once discovered.
 */
import { FOG_VISIBLE, type GameView } from '../sim';

export type EntityView = GameView['entities'] extends ReadonlyMap<number, infer E> ? E : never;
export type SoldierView = Extract<EntityView, { kind: 'soldier' }>;
export type SurvivorView = Extract<EntityView, { kind: 'survivor' }>;
export type MutantView = Extract<EntityView, { kind: 'mutant' }>;
export type BuildingView = Extract<EntityView, { kind: 'building' }>;
export type NestView = Extract<EntityView, { kind: 'nest' }>;
export type PlayerUnitView = SoldierView | SurvivorView;

export function isPlayerUnit(e: EntityView): e is PlayerUnitView {
  return e.kind === 'soldier' || e.kind === 'survivor';
}

/** Alive and physically on the map (survivors working inside a building are not). */
export function isOnMap(e: EntityView): boolean {
  return e.hp > 0 && !(e.kind === 'survivor' && e.insideId !== 0);
}

export function isTileVisible(view: GameView, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const { width, height } = view.map;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false;
  return view.fog[ty * width + tx] === FOG_VISIBLE;
}

export function isFootprintVisible(view: GameView, tileX: number, tileY: number, size: number): boolean {
  for (let y = tileY; y < tileY + size; y++) for (let x = tileX; x < tileX + size; x++) if (isTileVisible(view, x, y)) return true;
  return false;
}

/** Nests are shown once discovered (also under explored fog) or while in sight. */
export function isNestKnown(view: GameView, nest: NestView): boolean {
  return nest.discovered || isFootprintVisible(view, nest.tileX, nest.tileY, nest.size);
}

/** Whether the player may currently see / select this entity. */
export function isKnownToPlayer(view: GameView, e: EntityView): boolean {
  if (e.hp <= 0) return false;
  if (e.kind === 'mutant') return isTileVisible(view, e.x, e.y);
  if (e.kind === 'nest') return isNestKnown(view, e);
  return isOnMap(e);
}
