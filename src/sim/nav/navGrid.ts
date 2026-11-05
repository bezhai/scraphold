/**
 * Navigation grid derived from the state: which tiles are blocked, which structure occupies each
 * tile, and the shared flow field toward the core. Owner: Task 1.
 *
 * Derived data (not hashed). It is rebuilt lazily by ensureNav whenever state.navVersion changes,
 * i.e. after any structure is added or removed (world/entities.ts bumps the version).
 */
import type { Game } from '../game';
import { PASSABLE_BY_CODE, forEachFootprintTile } from '../map/grid';
import type { GameState } from '../state';
import { computeFlowField } from './flowField';
import { TILE_BUILDING, TILE_CORE, TILE_NEST, TILE_OPEN, TILE_TERRAIN } from './tileClass';

export interface NavGrid {
  /** state.navVersion this grid was built for (-1 = never built). */
  version: number;
  width: number;
  height: number;
  /** TILE_* class per tile (nav/tileClass.ts). */
  tileClass: Uint8Array;
  /** Structure (building or nest) entity id per tile, 0 = none. */
  structureAt: Int32Array;
  /** 1 where no unit may stand: impassable terrain or any structure. */
  blocked: Uint8Array;
  /**
   * Flow field toward the core (Dijkstra from the core footprint). Player building tiles are
   * passable at a large extra cost, so mutants detour while any open route exists and otherwise
   * path through the cheapest blocking building (which they must attack). Nests are impassable.
   * flowCost: accumulated cost, -1 = cannot reach the core. flowNext: next tile, -1 on core tiles.
   */
  flowCost: Int32Array;
  flowNext: Int32Array;
  targetFlow: { id: number; version: number; cost: Int32Array; next: Int32Array } | null;
}

export function createNavGrid(width: number, height: number): NavGrid {
  const n = width * height;
  return {
    version: -1,
    width,
    height,
    tileClass: new Uint8Array(n),
    structureAt: new Int32Array(n),
    blocked: new Uint8Array(n),
    flowCost: new Int32Array(n),
    flowNext: new Int32Array(n),
    targetFlow: null,
  };
}

export function rebuildNav(nav: NavGrid, state: GameState): void {
  const { terrain } = state.map;
  for (let i = 0; i < terrain.length; i++) {
    nav.tileClass[i] = PASSABLE_BY_CODE[terrain[i] as number] ? TILE_OPEN : TILE_TERRAIN;
    nav.structureAt[i] = 0;
  }
  for (const e of state.entities.values()) {
    if (e.kind !== 'building' && e.kind !== 'nest') continue;
    const cls = e.kind === 'nest' ? TILE_NEST : e.id === state.coreId ? TILE_CORE : TILE_BUILDING;
    forEachFootprintTile(nav, e.tileX, e.tileY, e.size, (i) => {
      nav.tileClass[i] = cls;
      nav.structureAt[i] = e.id;
    });
  }
  for (let i = 0; i < terrain.length; i++) nav.blocked[i] = nav.tileClass[i] === TILE_OPEN ? 0 : 1;
  computeFlowField(nav);
  nav.version = state.navVersion;
}

/** Returns the navigation grid, rebuilding it first if structures changed. */
export function ensureNav(game: Game): NavGrid {
  if (game.nav.version !== game.state.navVersion) rebuildNav(game.nav, game.state);
  return game.nav;
}

/** Reuses the same Dijkstra and obstruction rules for tower-directed assault groups. */
export function assaultFlow(game: Game, targetId: number): Int32Array {
  const nav = ensureNav(game);
  const target = game.state.entities.get(targetId);
  if (!target || target.hp <= 0 || target.kind !== 'building') return nav.flowNext;
  if (nav.targetFlow?.id !== targetId || nav.targetFlow.version !== nav.version) {
    const cost = new Int32Array(nav.flowCost.length); const next = new Int32Array(cost.length);
    computeFlowField(nav, targetId, cost, next);
    nav.targetFlow = { id: targetId, version: nav.version, cost, next };
  }
  return nav.targetFlow.next;
}
