import { describe, expect, it } from 'vitest';
import { MAX_EFFECT_LIGHTS, effectLights } from './drawEffects';
import type { VisualEffect } from './effects';
import type { LightSource } from './lighting';

const fx = (kind: VisualEffect['kind'], x: number, extra: Partial<VisualEffect> = {}): VisualEffect => ({ kind, x, y: 0, x2: x + 1, y2: 0, radius: 1.2, born: 0, life: 1000, hostile: false, ...extra });
const everywhere = () => true;

describe('effectLights', () => {
  it('a big fight lights only the strongest effects (strength times radius), at most MAX_EFFECT_LIGHTS', () => {
    const effects = [
      ...Array.from({ length: 30 }, (_, k) => fx('flash', k, { radius: 0.35 })),
      ...Array.from({ length: 5 }, (_, k) => fx('blast', 100 + k)),
      ...Array.from({ length: 6 }, (_, k) => fx('acidPool', 200 + k, { radius: 0.9 })),
    ];
    const out: LightSource[] = [];
    effectLights(effects, 0, everywhere, out);
    expect(MAX_EFFECT_LIGHTS).toBe(16);
    expect(out).toHaveLength(MAX_EFFECT_LIGHTS);
    // every blast outshines every flash, which outshines every acid pool
    expect(out.filter((l) => l.x >= 100 && l.x < 200)).toHaveLength(5);
    expect(out.filter((l) => l.color === 'flash')).toHaveLength(MAX_EFFECT_LIGHTS - 5);
    expect(out.some((l) => l.x >= 200)).toBe(false);
  });

  it('keeps the brightest when effects of one kind fade differently', () => {
    const effects = Array.from({ length: 20 }, (_, k) => fx('burn', k, { born: -k * 40 }));
    const out: LightSource[] = [];
    effectLights(effects, 0, everywhere, out);
    expect(out).toHaveLength(MAX_EFFECT_LIGHTS);
    expect(out.map((l) => l.x).sort((a, b) => a - b)).toEqual(Array.from({ length: MAX_EFFECT_LIGHTS }, (_, k) => k));
  });

  it('effects off screen take no light', () => {
    const effects = [...Array.from({ length: 20 }, (_, k) => fx('blast', 100 + k)), fx('flash', 1), fx('flash', 2)];
    const out: LightSource[] = [];
    effectLights(effects, 0, (x) => x < 50, out);
    expect(out.map((l) => l.x)).toEqual([1, 2]);
  });

  it('asks whether an effect is in view with the reach of its light as margin', () => {
    const margins: number[] = [];
    effectLights([fx('blast', 0, { radius: 1 })], 0, (_x, _y, m) => (margins.push(m), true), []);
    expect(margins).toEqual([3.2]);
  });

  it('adds to the lights already collected and leaves them alone', () => {
    const lamp: LightSource = { x: 0, y: 0, radius: 8, strength: 1, color: 'core' };
    const out: LightSource[] = [lamp];
    effectLights(Array.from({ length: 40 }, (_, k) => fx('blast', k)), 0, everywhere, out);
    expect(out[0]).toBe(lamp);
    expect(out).toHaveLength(1 + MAX_EFFECT_LIGHTS);
  });
});
