/**
 * Target choice shared by soldiers, towers and mutants. Owner: Task 3.
 *
 * Rules: an attacker prefers targets it can hit right now (inside [minRange, range]); among
 * those, the one its weapon hurts most (the armor multiplier; splash weapons add everything
 * hostile around the impact, each capped at its hp, so they pick clumps); ties go to the target
 * with the least hp left, so a group finishes wounded enemies instead of spreading its fire, then
 * to the nearer target, then the lower id. Targets it cannot hit yet (too far) come next, nearest
 * first. Targets inside the minimum range are never chosen.
 */
import type { Game } from '../game';
import type { Entity, EntityId, Point } from '../state';
import { forEachInRadius } from '../world/spatial';
import { hitDamage, type Attacker } from './damage';
import { gapBetween, type WeaponProfile } from './weapons';

/** How many hittable candidates get their (splash) damage evaluated; the rest only by distance. */
const MAX_SCORED = 12;

/** The living entity with this id, or null. */
export function liveEntity(game: Game, id: EntityId): Entity | null {
  if (id === 0) return null;
  const e = game.state.entities.get(id);
  return e && e.hp > 0 ? e : null;
}

/** Where an attack aimed from `from` lands: a unit's center, or the nearest point of a footprint. */
export function aimPoint(from: Point, target: Entity): Point {
  if (target.kind !== 'building' && target.kind !== 'nest') return { x: target.x, y: target.y };
  const x0 = target.tileX;
  const y0 = target.tileY;
  return {
    x: Math.min(x0 + target.size, Math.max(x0, from.x)),
    y: Math.min(y0 + target.size, Math.max(y0, from.y)),
  };
}

export function canHit(w: WeaponProfile, gap: number): boolean {
  return gap >= w.minRange && gap <= w.range;
}

/**
 * How much the next attack is worth: a single target's effective damage, or the hp everything
 * hostile in the splash would lose (each capped at its hp).
 */
export function expectedDamage(game: Game, attacker: Attacker, w: WeaponProfile, target: Entity): number {
  if (w.splashRadius <= 0) return hitDamage(game, target, w.damage, w.damageType);
  const p = aimPoint(attacker, target);
  let total = 0;
  forEachInRadius(game.spatial, p.x, p.y, w.splashRadius, (e) => {
    if (e.faction !== attacker.faction && e.hp > 0) total += Math.min(e.hp, hitDamage(game, e, w.damage, w.damageType));
  });
  return total;
}

interface Candidate {
  e: Entity;
  gap: number;
  hittable: boolean;
}

/**
 * Best target among hostile entities within `radius` (edge to edge) of the attacker that pass
 * `accept`, following the rules above.
 */
export function chooseTarget(game: Game, attacker: Attacker, w: WeaponProfile, radius: number, accept: (e: Entity) => boolean): Entity | null {
  const found: Candidate[] = [];
  const reach = radius + (attacker.kind === 'building' ? attacker.size * 0.71 : attacker.radius);
  forEachInRadius(game.spatial, attacker.x, attacker.y, reach, (e) => {
    if (e.faction === attacker.faction || e.hp <= 0 || !accept(e)) return;
    const gap = gapBetween(attacker, e);
    if (gap > radius || gap < w.minRange) return;
    found.push({ e, gap, hittable: gap <= w.range });
  });
  if (found.length === 0) return null;
  found.sort((a, b) => Number(b.hittable) - Number(a.hittable) || a.gap - b.gap || a.e.id - b.e.id);
  const first = found[0] as Candidate;
  if (!first.hittable || found.length === 1) return first.e;
  let best = first;
  let bestScore = expectedDamage(game, attacker, w, first.e);
  for (let k = 1; k < found.length && k < MAX_SCORED; k++) {
    const c = found[k] as Candidate;
    if (!c.hittable) break;
    const score = expectedDamage(game, attacker, w, c.e);
    if (score > bestScore + 1e-9 || (score > bestScore - 1e-9 && c.e.hp < best.e.hp - 1e-9)) {
      best = c;
      bestScore = score;
    }
  }
  return best.e;
}
