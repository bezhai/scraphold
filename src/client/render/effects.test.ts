import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../sim';
import { LINGER_CAP, MAX_EFFECTS, effectsForEvent, liveEffects, type ShooterLookup, type VisualEffect } from './effects';

const shot = (damageType: 'normal' | 'pierce' | 'explosive' | 'fire', from = { x: 1, y: 1 }, to = { x: 4, y: 5 }): GameEvent => ({
  type: 'shot',
  sourceId: 7,
  targetId: 2,
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  damageType,
});

const shooter =
  (kind: string, type?: string): ShooterLookup =>
  (id) =>
    id === 7 ? { kind, type } : undefined;

describe('effectsForEvent: shots', () => {
  it('a gunshot draws a tracer and a muzzle flash that remembers its shooter', () => {
    const fx = effectsForEvent(shot('normal'), 1000, 1, shooter('soldier', 'rifleman'));
    expect(fx.map((e) => e.kind)).toEqual(['tracer', 'flash']);
    expect(fx[0]).toMatchObject({ x: 1, y: 1, x2: 4, y2: 5, born: 1000 });
    expect(fx[1]?.entityId).toBe(7);
  });

  it('without a known shooter it falls back to the damage type', () => {
    expect(effectsForEvent(shot('normal'), 0, 1).map((e) => e.kind)).toEqual(['tracer', 'flash']);
    expect(effectsForEvent(shot('fire'), 0, 1).map((e) => e.kind)).toEqual(['flame']);
    expect(effectsForEvent(shot('pierce'), 0, 1).map((e) => e.kind)).toEqual(['tracer', 'flash']);
  });

  it('sniper rounds are heavy tracers: longer-lived than rifle tracers', () => {
    const rifle = effectsForEvent(shot('normal'), 0, 1, shooter('soldier', 'rifleman'))[0]!;
    const sniper = effectsForEvent(shot('pierce'), 0, 1, shooter('soldier', 'sniper'))[0]!;
    expect(sniper.kind).toBe('tracer');
    expect(sniper.heavy).toBe(true);
    expect(rifle.heavy).toBeFalsy();
    expect(sniper.life).toBeGreaterThan(rifle.life);
  });

  it('grenadiers lob a grenade; flamethrowers spray flame', () => {
    expect(effectsForEvent(shot('explosive'), 0, 1, shooter('soldier', 'grenadier')).map((e) => e.kind)).toEqual(['grenade', 'flash']);
    expect(effectsForEvent(shot('fire'), 0, 1, shooter('soldier', 'flamethrower')).map((e) => e.kind)).toEqual(['flame']);
  });

  it('spitters spit an acid glob and melee mutants claw at their target instead of firing tracers', () => {
    expect(effectsForEvent(shot('pierce'), 0, 1, shooter('mutant', 'spitter')).map((e) => e.kind)).toEqual(['spit']);
    const claw = effectsForEvent(shot('normal', { x: 1, y: 1 }, { x: 1.5, y: 1 }), 0, 1, shooter('mutant', 'wanderer'));
    expect(claw.map((e) => e.kind)).toEqual(['claw']);
    expect(claw[0]).toMatchObject({ x: 1.5, y: 1, entityId: 7 });
    expect(effectsForEvent(shot('pierce'), 0, 1, shooter('mutant', 'spitter'))[0]?.entityId).toBe(7);
  });

  it('machine gun towers fire tracers', () => {
    expect(effectsForEvent(shot('normal'), 0, 1, shooter('building', 'machineGunTower')).map((e) => e.kind)).toEqual(['tracer', 'flash']);
  });
});

describe('effectsForEvent: explosions and deaths', () => {
  it('explosions depend on the damage type and leave marks on the ground', () => {
    const at = (damageType: 'explosive' | 'pierce' | 'fire', radius: number) =>
      effectsForEvent({ type: 'explosion', x: 3, y: 3, radius, damageType }, 0, 1).map((e) => e.kind);
    expect(at('explosive', 1.4)).toEqual(['blast', 'scorch']);
    expect(at('pierce', 1.3)).toEqual(['acid', 'acidPool']);
    expect(at('fire', 1)).toEqual(['burn']);
    expect(effectsForEvent({ type: 'explosion', x: 3, y: 3, radius: 1.2, damageType: 'explosive' }, 0, 1)[0]?.radius).toBe(1.2);
  });

  it('acid pools linger for seconds', () => {
    const pool = effectsForEvent({ type: 'explosion', x: 3, y: 3, radius: 1.3, damageType: 'pierce' }, 0, 1)[1]!;
    expect(pool.life).toBeGreaterThanOrEqual(3000);
  });

  it('dead units leave a fading corpse of their type; buildings leave debris and rubble', () => {
    const died = (kind: 'mutant' | 'soldier' | 'building' | 'survivor', subtype: string, faction: 'mutant' | 'player') =>
      effectsForEvent({ type: 'died', entityId: 9, kind, subtype: subtype as never, faction, x: 0, y: 0 }, 0, 1);
    const mutant = died('mutant', 'crawler', 'mutant');
    expect(mutant.map((e) => e.kind)).toEqual(['corpse', 'splat']);
    expect(mutant[0]).toMatchObject({ entityId: 9, subtype: 'crawler', hostile: true });
    expect(mutant[0]!.life).toBeGreaterThanOrEqual(3000);
    expect(died('soldier', 'sniper', 'player').map((e) => e.kind)).toEqual(['corpse', 'puff']);
    expect(died('survivor', 'survivor', 'player')[0]).toMatchObject({ kind: 'corpse', subtype: 'survivor', hostile: false });
    expect(died('building', 'shack', 'player').map((e) => e.kind)).toEqual(['debris', 'rubble']);
  });

  it('other events have no visual effect', () => {
    expect(effectsForEvent({ type: 'hunger', hungry: true }, 0, 1)).toEqual([]);
  });
});

describe('effectsForEvent: lifetimes follow game time', () => {
  const blast: GameEvent = { type: 'explosion', x: 3, y: 3, radius: 1.4, damageType: 'explosive' };
  const mutantDied: GameEvent = { type: 'died', entityId: 9, kind: 'mutant', subtype: 'crawler', faction: 'mutant', x: 0, y: 0 };
  const lives = (event: GameEvent, speed: number, who?: ShooterLookup) => effectsForEvent(event, 0, speed, who).map((e) => [e.kind, e.life] as const);

  it('at 1x an effect lives as long as its kind does', () => {
    expect(lives(blast, 1)).toEqual([
      ['blast', 1200],
      ['scorch', 7000],
    ]);
    expect(lives(mutantDied, 1)).toEqual([
      ['corpse', 4500],
      ['splat', 6000],
    ]);
    expect(lives(shot('pierce'), 1, shooter('soldier', 'sniper'))).toEqual([
      ['tracer', 240],
      ['flash', 80],
    ]);
  });

  it('at 3x explosions, marks and corpses play out in a third of the real time', () => {
    for (const event of [blast, mutantDied]) {
      const slow = effectsForEvent(event, 0, 1);
      const fast = effectsForEvent(event, 0, 3);
      fast.forEach((e, i) => expect(e.life).toBeCloseTo(slow[i]!.life / 3));
    }
    expect(effectsForEvent(blast, 0, 2)[0]!.life).toBeCloseTo(600);
  });

  it('a sped-up effect still shows for at least 120 ms; one already that short keeps its life', () => {
    expect(lives(shot('fire'), 3, shooter('soldier', 'flamethrower'))).toEqual([['flame', 120]]);
    expect(lives(shot('pierce'), 3, shooter('soldier', 'sniper'))).toEqual([
      ['tracer', 120],
      ['flash', 80],
    ]);
    expect(lives(shot('normal'), 3, shooter('soldier', 'rifleman'))).toEqual(lives(shot('normal'), 1, shooter('soldier', 'rifleman')));
  });
});

describe('liveEffects', () => {
  it('drops effects whose lifetime is over', () => {
    const list = effectsForEvent(shot('normal'), 0, 1);
    expect(liveEffects(list, 1)).toHaveLength(2);
    expect(liveEffects(list, 10_000)).toHaveLength(0);
  });

  it('keeps only the newest corpses, stains, pools, scorches and rubble once a kind is over its cap', () => {
    const mark = (kind: VisualEffect['kind'], born: number): VisualEffect => ({ kind, x: 0, y: 0, x2: 0, y2: 0, radius: 0.4, born, life: 1e9, hostile: false });
    const list: VisualEffect[] = [];
    for (let k = 0; k < LINGER_CAP.corpse + 30; k++) list.push(mark('corpse', k), mark('splat', k), mark('tracer', k));
    const live = liveEffects(list, 0);
    const corpses = live.filter((e) => e.kind === 'corpse');
    expect(corpses).toHaveLength(LINGER_CAP.corpse);
    expect(corpses[0]?.born).toBe(30);
    expect(live.filter((e) => e.kind === 'splat')).toHaveLength(Math.min(LINGER_CAP.splat, LINGER_CAP.corpse + 30));
    // other kinds are untouched, and the order stays oldest first
    expect(live.filter((e) => e.kind === 'tracer')).toHaveLength(LINGER_CAP.corpse + 30);
    expect(live.map((e) => e.born)).toEqual([...live.map((e) => e.born)].sort((a, b) => a - b));
  });

  it('keeps the newest effects when over the cap', () => {
    const many = Array.from({ length: MAX_EFFECTS + 10 }, (_, k) => ({ ...effectsForEvent(shot('normal'), k, 1)[0]!, life: 1e9 }));
    const live = liveEffects(many, 0);
    expect(live).toHaveLength(MAX_EFFECTS);
    expect(live[live.length - 1]).toBe(many[many.length - 1]);
  });
});
