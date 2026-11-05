/**
 * What a player can see, read from the public state for the bots (Task 5).
 *
 * Bots play by the fog rules: mutants count only while they stand on a currently visible tile,
 * nests only once discovered, ruins only once their tile has been explored. Own entities,
 * resources, the dusk forecast and the data tables are what the HUD shows anyway.
 */
import { FOG_UNEXPLORED, FOG_VISIBLE, type Building, type Game, type Mutant, type Nest, type Point, type Ruin, type Soldier, type Survivor } from '../../sim';
import type { BuildingType } from '../../sim/data/economy';
import { tileAtPoint, tileCenter } from '../../sim/map/grid';

export function coreOf(game: Game): Building {
  return game.state.entities.get(game.state.coreId) as Building;
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function isVisibleAt(game: Game, x: number, y: number): boolean {
  const t = tileAtPoint(game.state.map, x, y);
  return t !== -1 && game.state.fog[t] === FOG_VISIBLE;
}

export function isExploredTile(game: Game, tile: number): boolean {
  return game.state.fog[tile] !== FOG_UNEXPLORED;
}

/** Everything the bots look at in one pass over the entities. */
export interface Snapshot {
  survivors: Survivor[];
  soldiers: Soldier[];
  buildings: Building[];
  visibleMutants: Mutant[];
  discoveredNests: Nest[];
}

export function snapshot(game: Game): Snapshot {
  const out: Snapshot = { survivors: [], soldiers: [], buildings: [], visibleMutants: [], discoveredNests: [] };
  for (const e of game.state.entities.values()) {
    if (e.hp <= 0) continue;
    switch (e.kind) {
      case 'survivor':
        out.survivors.push(e);
        break;
      case 'soldier':
        out.soldiers.push(e);
        break;
      case 'building':
        out.buildings.push(e);
        break;
      case 'mutant':
        if (isVisibleAt(game, e.x, e.y)) out.visibleMutants.push(e);
        break;
      case 'nest':
        if (e.discovered) out.discoveredNests.push(e);
        break;
    }
  }
  return out;
}

/**
 * Free for any job: idle on the map under automatic control (an idle survivor under player control
 * is still walking), or pulled out of a building by the bot and waiting for its orders.
 */
export function isIdle(s: Survivor): boolean {
  return s.insideId === 0 && (s.task.type === 'wait' || (s.task.type === 'idle' && s.control === 'auto'));
}

export function ofType(buildings: readonly Building[], type: BuildingType): Building[] {
  return buildings.filter((b) => b.type === type);
}

export function finished(buildings: readonly Building[], type: BuildingType): Building[] {
  return buildings.filter((b) => b.type === type && b.construction === null);
}

/** Ruins the player knows about (tile explored) and nobody has visited yet. */
export function knownRuins(game: Game): Ruin[] {
  return game.state.map.ruins.filter((r) => !r.explored && isExploredTile(game, r.tile));
}

export function ruinPoint(game: Game, r: Ruin): Point {
  return tileCenter(game.state.map, r.tile);
}
