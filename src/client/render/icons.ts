/**
 * Small portraits for HUD buttons and panels, drawn once with the same procedural art as the map
 * and cached as data URLs.
 */
import type { MutantType, SoldierType } from '../../sim/data/combat';
import { BUILDINGS, type BuildingType } from '../../sim/data/economy';
import { drawBuilding, drawNest } from './drawBuildings';
import { paintUnitPortrait, spriteExtent, type SpriteSubject } from './unitSprites';

const cache = new Map<string, string>();
const SIZE = 96;

function icon(key: string, paint: (g: CanvasRenderingContext2D) => void): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    if (g) {
      paint(g);
      url = c.toDataURL();
    }
  } catch {
    url = '';
  }
  cache.set(key, url);
  return url;
}

export function buildingIcon(type: BuildingType): string {
  return icon(`b:${type}`, (g) => {
    const size = BUILDINGS[type].size;
    const scale = (SIZE * 0.8) / Math.max(size, 1.3);
    g.translate(SIZE / 2, SIZE / 2);
    g.scale(scale, scale);
    g.translate(-size / 2, -size / 2);
    drawBuilding(g, { type, tileX: 0, tileY: 0, size, built: 1, workers: 1, slots: 0, aim: -0.6 }, 0);
  });
}

/** A unit facing up-right, scaled so its whole sprite fits the portrait. */
function unitIcon(key: string, subject: SpriteSubject): string {
  return icon(key, (g) => {
    const scale = SIZE / (spriteExtent(subject) * 2.1);
    g.translate(SIZE / 2, SIZE / 2);
    g.scale(scale, scale);
    paintUnitPortrait(g, subject, -Math.PI / 4, scale);
  });
}

export function soldierIcon(type: SoldierType): string {
  return unitIcon(`s:${type}`, { kind: 'soldier', type });
}

export function survivorIcon(): string {
  return unitIcon('survivor', { kind: 'survivor' });
}

export function mutantIcon(type: MutantType): string {
  return unitIcon(`m:${type}`, { kind: 'mutant', type });
}

export function nestIcon(isHive: boolean): string {
  return icon(`n:${isHive}`, (g) => {
    const size = isHive ? 3 : 2;
    g.translate(SIZE / 2, SIZE / 2);
    g.scale((SIZE * 0.62) / size, (SIZE * 0.62) / size);
    g.translate(-size / 2, -size / 2);
    drawNest(g, 0, 0, size, isHive, 0, 0);
  });
}
