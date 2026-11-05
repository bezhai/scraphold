/**
 * Short-lived visual effects created from simulation events (shots, explosions, deaths) and from
 * player orders (click markers). Pure data here; drawn by render/drawEffects.ts. Who fired a shot
 * decides how it looks: rifle and tower tracers, long bright sniper tracers, lobbed grenades,
 * flame jets, acid globs from spitters and claw swipes from melee mutants. Deaths leave a fading
 * corpse; explosions and acid leave marks on the ground for a few seconds.
 *
 * Effects are timed in real milliseconds, but the ones that come from the simulation play out in
 * game time: at 3x speed a blast, a corpse or a scorch lasts a third as long on screen, as the
 * fight around it does. (Otherwise a fast fight piles up three times as many effects and lights.)
 */
import type { EntityId, GameEvent } from '../../sim';

export type EffectKind =
  | 'tracer'
  | 'flash'
  | 'flame'
  | 'grenade'
  | 'spit'
  | 'claw'
  | 'blast'
  | 'scorch'
  | 'acid'
  | 'acidPool'
  | 'burn'
  | 'splat'
  | 'corpse'
  | 'puff'
  | 'debris'
  | 'rubble'
  | 'order';

export interface VisualEffect {
  kind: EffectKind;
  x: number;
  y: number;
  /** Second point (tracer / flame / projectile end, muzzle flash aim). */
  x2: number;
  y2: number;
  /** Tiles. */
  radius: number;
  /** ms timestamps */
  born: number;
  life: number;
  /** Order markers: attack (red) or move (green); corpses: a mutant's. */
  hostile: boolean;
  /** Muzzle flash, claw, spit: the attacker; corpse: the dead entity (its last facing is the renderer's). */
  entityId?: number;
  /** Corpse: unit type ('survivor' for survivors). */
  subtype?: string;
  /** Tracer: a sniper round (longer, brighter). */
  heavy?: boolean;
}

/** Life (ms) of each kind at 1x speed. */
const LIFE: Record<EffectKind, number> = {
  tracer: 110,
  flash: 80,
  flame: 280,
  grenade: 260,
  spit: 320,
  claw: 220,
  blast: 1200,
  scorch: 7000,
  acid: 650,
  acidPool: 4200,
  burn: 650,
  splat: 6000,
  corpse: 4500,
  puff: 600,
  debris: 1600,
  rubble: 9000,
  order: 520,
};

const HEAVY_TRACER_LIFE = 240;

/** Shortest life (ms) a speed-up leaves an effect, so a sped-up flame or grenade still shows. */
const MIN_SPED_UP_LIFE = 120;

/** Real-time life at `speed` of an effect that lasts `life` ms at 1x; never cut below MIN_SPED_UP_LIFE. */
function lifeAtSpeed(life: number, speed: number): number {
  return Math.max(Math.min(life, MIN_SPED_UP_LIFE), life / speed);
}

/** Hard cap so a huge fight cannot grow the effect list without bound. */
export const MAX_EFFECTS = 900;

/** What the client knows about who fired a shot, if it is still around. */
export type ShooterLookup = (id: EntityId) => { kind: string; type?: string } | undefined;

const nobody: ShooterLookup = () => undefined;

function effect(kind: EffectKind, now: number, x: number, y: number, extra: Partial<VisualEffect> = {}): VisualEffect {
  return { kind, x, y, x2: x, y2: y, radius: 0.5, born: now, life: LIFE[kind], hostile: false, ...extra };
}

function shotEffects(event: Extract<GameEvent, { type: 'shot' }>, now: number, shooter: ShooterLookup): VisualEffect[] {
  const { fromX: x, fromY: y, toX: x2, toY: y2 } = event;
  const who = shooter(event.sourceId);
  if (event.damageType === 'fire') return [effect('flame', now, x, y, { x2, y2 })];
  if (who?.kind === 'mutant') {
    if (who.type === 'spitter') return [effect('spit', now, x, y, { x2, y2, radius: 0.12, entityId: event.sourceId })];
    return [effect('claw', now, x2, y2, { x2: x, y2: y, radius: 0.28, entityId: event.sourceId })];
  }
  const flash = effect('flash', now, x, y, { x2, y2, radius: 0.35, entityId: event.sourceId });
  if (who?.type === 'grenadier') return [effect('grenade', now, x, y, { x2, y2, radius: 0.09 }), flash];
  if (who?.type === 'sniper') return [effect('tracer', now, x, y, { x2, y2, radius: 0.07, heavy: true, life: HEAVY_TRACER_LIFE }), flash];
  return [effect('tracer', now, x, y, { x2, y2, radius: event.damageType === 'pierce' ? 0.06 : 0.04 }), flash];
}

/**
 * The effects an event shows, born at `now` (ms). `speed` is the game speed (game seconds per real
 * second): their lives are game time, so at 3x they last a third as long (see lifeAtSpeed).
 */
export function effectsForEvent(event: GameEvent, now: number, speed: number, shooter: ShooterLookup = nobody): VisualEffect[] {
  const list = effectsAtNormalSpeed(event, now, shooter);
  for (const e of list) e.life = lifeAtSpeed(e.life, speed);
  return list;
}

function effectsAtNormalSpeed(event: GameEvent, now: number, shooter: ShooterLookup): VisualEffect[] {
  switch (event.type) {
    case 'shot':
      return shotEffects(event, now, shooter);
    case 'explosion': {
      const r = event.radius;
      if (event.damageType === 'pierce') return [effect('acid', now, event.x, event.y, { radius: r }), effect('acidPool', now, event.x, event.y, { radius: r * 0.75 })];
      if (event.damageType === 'fire') return [effect('burn', now, event.x, event.y, { radius: r })];
      return [effect('blast', now, event.x, event.y, { radius: r }), effect('scorch', now, event.x, event.y, { radius: r * 0.6 })];
    }
    case 'died': {
      const { x, y } = event;
      if (event.kind === 'building' || event.kind === 'nest') {
        const radius = event.kind === 'nest' ? 1.6 : 1.1;
        return [effect('debris', now, x, y, { radius }), effect('rubble', now, x, y, { radius })];
      }
      const hostile = event.faction === 'mutant';
      const corpse = effect('corpse', now, x, y, { entityId: event.entityId, subtype: event.subtype, hostile });
      return [corpse, hostile ? effect('splat', now, x, y, { radius: 0.45 }) : effect('puff', now, x, y, { radius: 0.4 })];
    }
    default:
      return [];
  }
}

export function orderMarker(x: number, y: number, hostile: boolean, now: number): VisualEffect {
  return effect('order', now, x, y, { hostile, radius: 0.45 });
}

/** Lingering marks kept per kind; past these counts the oldest go first. */
export const LINGER_CAP: Partial<Record<EffectKind, number>> & Record<'corpse' | 'splat' | 'acidPool' | 'scorch' | 'rubble', number> = {
  corpse: 70,
  splat: 70,
  acidPool: 36,
  scorch: 36,
  rubble: 24,
};

/** Effects still alive at `now`, oldest first, within LINGER_CAP and MAX_EFFECTS. */
export function liveEffects(list: readonly VisualEffect[], now: number): VisualEffect[] {
  const kept: VisualEffect[] = [];
  const counts = new Map<EffectKind, number>();
  for (let i = list.length - 1; i >= 0 && kept.length < MAX_EFFECTS; i--) {
    const e = list[i] as VisualEffect;
    if (now - e.born >= e.life) continue;
    const cap = LINGER_CAP[e.kind];
    if (cap !== undefined) {
      const n = (counts.get(e.kind) ?? 0) + 1;
      if (n > cap) continue;
      counts.set(e.kind, n);
    }
    kept.push(e);
  }
  return kept.reverse();
}
