/**
 * Fog of war: three states per tile (unexplored / explored / visible). Owner: Task 1.
 * Every tick visible tiles fall back to explored, then every player entity on the map with
 * vision > 0 reveals a disk (vision + modifiers.global.visionAdd). First-time exploration is
 * counted per terrain in stats.exploredTerrain; nests seen for the first time are marked
 * discovered and announced with a nestDiscovered event.
 */
import { weatherVisionMultiplier } from '../calendar/weather';
import { emit } from '../events';
import type { Game } from '../game';
import { forEachFootprintTile } from '../map/grid';
import { TERRAIN_LIST, type Terrain } from '../data/map';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, type Entity } from '../state';
import { isOnMap } from './spatial';

function markTiles(game: Game, x: number, y: number, radius: number, value: typeof FOG_EXPLORED | typeof FOG_VISIBLE): void {
  const { map, fog, stats } = game.state;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(map.width - 1, Math.floor(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(map.height - 1, Math.floor(y + radius));
  for (let ty = y0; ty <= y1; ty++) {
    const dy = ty + 0.5 - y;
    for (let tx = x0; tx <= x1; tx++) {
      const dx = tx + 0.5 - x;
      if (dx * dx + dy * dy > r2) continue;
      const i = ty * map.width + tx;
      const old = fog[i] as number;
      if (old === FOG_UNEXPLORED) stats.exploredTerrain[TERRAIN_LIST[map.terrain[i] as number] as Terrain]++;
      if (old < value) fog[i] = value;
    }
  }
}

function discoverNests(game: Game, minFog: number): void {
  const { fog, map } = game.state;
  for (const e of game.state.entities.values()) {
    if (e.kind !== 'nest' || e.discovered) continue;
    let seen = false;
    forEachFootprintTile(map, e.tileX, e.tileY, e.size, (i) => {
      if ((fog[i] as number) >= minFog) seen = true;
    });
    if (!seen) continue;
    e.discovered = true;
    emit(game, { type: 'nestDiscovered', nestId: e.id, isHive: e.isHive });
  }
}

/** How far a player entity sees: its own vision plus the global vision bonus. */
export function visionRadius(game: Game, e: Pick<Entity, 'vision'>): number {
  return Math.max(0, (e.vision + game.modifiers.global.visionAdd) * weatherVisionMultiplier(game));
}

export function updateFog(game: Game): void {
  const { fog } = game.state;
  for (let i = 0; i < fog.length; i++) if (fog[i] === FOG_VISIBLE) fog[i] = FOG_EXPLORED;
  for (const e of game.state.entities.values()) {
    if (e.faction !== 'player' || e.vision <= 0 || !isOnMap(e)) continue;
    markTiles(game, e.x, e.y, visionRadius(game, e), FOG_VISIBLE);
  }
  discoverNests(game, FOG_VISIBLE);
}

/** Marks a disk as explored (ruin "reveal" rewards); nests inside become discovered. */
export function revealCircle(game: Game, x: number, y: number, radius: number): void {
  markTiles(game, x, y, radius, FOG_EXPLORED);
  discoverNests(game, FOG_EXPLORED);
}

export function fogSystem(game: Game): void {
  updateFog(game);
}
