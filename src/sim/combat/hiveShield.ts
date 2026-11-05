/**
 * Hive shield: every ordinary nest still standing on the map cuts the damage the hive takes by
 * HIVE_SHIELD.reductionPerNest, up to HIVE_SHIELD.maxReduction; with no ordinary nest left the
 * hive takes full damage. Undiscovered nests and nests spawned by a split incident count, nests
 * at 0 hp (destroyed this tick, removed by cleanup at its end) do not. Ordinary nests never get
 * a reduction. combat/damage.ts:hitDamage applies it to every weapon hit, which is also what
 * target choice evaluates; the client and the bots read the same two functions through
 * sim/index.ts. Owner: Task 3.
 */
import { HIVE_SHIELD } from '../data/combat';
import type { Entity, EntityId } from '../state';

/** Anything with entities: GameState, or the client's read-only GameView. */
export interface NestCensus {
  readonly entities: ReadonlyMap<EntityId, { readonly kind: Entity['kind']; readonly hp: number; readonly isHive?: boolean }>;
}

/** Ordinary nests (not the hive) still standing, discovered or not. */
export function ordinaryNestsLeft(state: NestCensus): number {
  let n = 0;
  for (const e of state.entities.values()) if (e.kind === 'nest' && !e.isHive && e.hp > 0) n++;
  return n;
}

/** Share of every hit the hive shrugs off while `nestsLeft` ordinary nests stand (0 to the cap). */
export function hiveDamageReduction(nestsLeft: number): number {
  return Math.min(HIVE_SHIELD.maxReduction, HIVE_SHIELD.reductionPerNest * nestsLeft);
}
