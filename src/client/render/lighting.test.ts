import { describe, expect, it } from 'vitest';
import { clockAt, type NightType } from '../../sim';
import { createTestGame } from '../../sim/testing';
import { luminance } from './color';
import { DAWN_TICKS, NIGHTFALL_TICKS, ambientAt, nightWeather, shadeOverlay, stormLevel, sunAt, type NightWeather } from './lighting';

const DAY_TICKS = 2200;
const DUSK_START = 900;
const NIGHT_START = 1200;

describe('ambientAt', () => {
  it('is untinted and has no night through the first day', () => {
    for (const tick of [0, 300, 899]) {
      const a = ambientAt(clockAt(tick));
      expect(a.tint).toEqual({ r: 1, g: 1, b: 1 });
      expect(a.night).toBe(0);
    }
  });

  it('turns orange-red through dusk', () => {
    const a = ambientAt(clockAt(DUSK_START + 200));
    expect(a.tint.r).toBeGreaterThan(0.95);
    expect(a.tint.r - a.tint.g).toBeGreaterThan(0.12);
    expect(a.tint.g - a.tint.b).toBeGreaterThan(0.05);
    expect(a.night).toBeGreaterThan(0);
    expect(a.night).toBeLessThan(1);
  });

  it('settles into a cold blue night that keeps 35-45% of the day brightness', () => {
    const a = ambientAt(clockAt(NIGHT_START + NIGHTFALL_TICKS + 10));
    expect(a.tint.b).toBeGreaterThan(a.tint.r);
    expect(luminance(a.tint)).toBeGreaterThanOrEqual(0.35);
    expect(luminance(a.tint)).toBeLessThanOrEqual(0.45);
    expect(a.night).toBe(1);
  });

  it('brightens back to the day tint over the dawn of the next day', () => {
    expect(ambientAt(clockAt(DAY_TICKS)).night).toBe(1);
    expect(ambientAt(clockAt(DAY_TICKS + DAWN_TICKS / 2)).night).toBeGreaterThan(0);
    const later = ambientAt(clockAt(DAY_TICKS + DAWN_TICKS));
    expect(later.tint).toEqual({ r: 1, g: 1, b: 1 });
    expect(later.night).toBe(0);
  });

  it('changes smoothly: no jump between consecutive ticks over two full days', () => {
    let prev = ambientAt(clockAt(0));
    for (let tick = 1; tick < DAY_TICKS * 2; tick++) {
      const a = ambientAt(clockAt(tick));
      expect(Math.abs(a.tint.r - prev.tint.r)).toBeLessThan(0.02);
      expect(Math.abs(a.tint.g - prev.tint.g)).toBeLessThan(0.02);
      expect(Math.abs(a.tint.b - prev.tint.b)).toBeLessThan(0.02);
      expect(Math.abs(a.night - prev.night)).toBeLessThan(0.03);
      prev = a;
    }
  });
});

/** Night 1 is a rust storm, night 2 a raid: the weather the renderer reads at `tick`. */
function stormFirstNight(tick: number): NightWeather {
  const day = clockAt(tick).day;
  const type = (night: number): NightType | null => (night === 1 ? 'rustStorm' : night === 2 ? 'raid' : null);
  return { tonight: type(day), lastNight: type(day - 1) };
}

describe('ambientAt on a rust storm night', () => {
  it('settles into a rust-red night that keeps 35-45% of the day brightness', () => {
    const a = ambientAt(clockAt(NIGHT_START + NIGHTFALL_TICKS + 10), stormFirstNight(NIGHT_START + NIGHTFALL_TICKS + 10));
    expect(a.tint.r).toBeGreaterThan(a.tint.g);
    expect(a.tint.g).toBeGreaterThan(a.tint.b);
    expect(luminance(a.tint)).toBeGreaterThanOrEqual(0.35);
    expect(luminance(a.tint)).toBeLessThanOrEqual(0.45);
    expect(a.night).toBe(1);
  });

  it('shades the warm ground rust red, not cold blue', () => {
    const tick = NIGHT_START + 500;
    const o = shadeOverlay(ambientAt(clockAt(tick), stormFirstNight(tick)).tint);
    const sand = { r: 200, g: 170, b: 120 };
    const shaded = { r: sand.r * (1 - o.alpha) + o.color.r * o.alpha, b: sand.b * (1 - o.alpha) + o.color.b * o.alpha };
    expect(shaded.r - shaded.b).toBeGreaterThan(60);
  });

  it('starts the next dawn from the storm tint and brightens without a jump', () => {
    const lastOfNight = ambientAt(clockAt(DAY_TICKS - 1), stormFirstNight(DAY_TICKS - 1)).tint;
    const firstOfDawn = ambientAt(clockAt(DAY_TICKS), stormFirstNight(DAY_TICKS)).tint;
    for (const c of ['r', 'g', 'b'] as const) expect(firstOfDawn[c]).toBeCloseTo(lastOfNight[c], 6);
    let prev = ambientAt(clockAt(0), stormFirstNight(0));
    for (let tick = 1; tick < DAY_TICKS * 2; tick++) {
      const a = ambientAt(clockAt(tick), stormFirstNight(tick));
      expect(Math.abs(a.tint.r - prev.tint.r)).toBeLessThan(0.02);
      expect(Math.abs(a.tint.g - prev.tint.g)).toBeLessThan(0.02);
      expect(Math.abs(a.tint.b - prev.tint.b)).toBeLessThan(0.02);
      prev = a;
    }
    expect(ambientAt(clockAt(DAY_TICKS + DAWN_TICKS), stormFirstNight(DAY_TICKS + DAWN_TICKS)).tint).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('keeps the cold blue night on other night types', () => {
    const tick = DAY_TICKS + NIGHT_START + 500;
    const a = ambientAt(clockAt(tick), stormFirstNight(tick));
    expect(a.tint).toEqual(ambientAt(clockAt(tick)).tint);
    expect(a.tint.b).toBeGreaterThan(a.tint.r);
  });
});

describe('stormLevel', () => {
  it('is 0 by day, at dusk and on nights without a storm', () => {
    for (const tick of [300, DUSK_START + 100, NIGHT_START - 1, DAY_TICKS + NIGHT_START + 500]) expect(stormLevel(clockAt(tick), stormFirstNight(tick))).toBe(0);
  });

  it('rises with nightfall on a storm night, holds through it and dies down over the next dawn', () => {
    expect(stormLevel(clockAt(NIGHT_START), stormFirstNight(NIGHT_START))).toBe(0);
    const rising = stormLevel(clockAt(NIGHT_START + NIGHTFALL_TICKS / 2), stormFirstNight(NIGHT_START + NIGHTFALL_TICKS / 2));
    expect(rising).toBeGreaterThan(0.2);
    expect(rising).toBeLessThan(0.8);
    expect(stormLevel(clockAt(DAY_TICKS - 1), stormFirstNight(DAY_TICKS - 1))).toBe(1);
    expect(stormLevel(clockAt(DAY_TICKS), stormFirstNight(DAY_TICKS))).toBe(1);
    expect(stormLevel(clockAt(DAY_TICKS + DAWN_TICKS), stormFirstNight(DAY_TICKS + DAWN_TICKS))).toBe(0);
    let prev = 0;
    for (let tick = 1; tick < DAY_TICKS * 2; tick++) {
      const level = stormLevel(clockAt(tick), stormFirstNight(tick));
      expect(Math.abs(level - prev)).toBeLessThan(0.03);
      prev = level;
    }
  });
});

describe('nightWeather', () => {
  it("reads tonight's published type and last night's", () => {
    const game = createTestGame(['CCC', 'CCC', 'CCC']);
    game.state.calendar.nights[0]!.type = 'rustStorm';
    game.state.calendar.nights[1]!.type = 'denseFog';
    game.state.clock = clockAt(DAY_TICKS + 10);
    expect(nightWeather(game.state)).toEqual({ tonight: 'denseFog', lastNight: 'rustStorm' });
    game.state.clock = clockAt(10);
    expect(nightWeather(game.state)).toEqual({ tonight: 'rustStorm', lastNight: null });
  });
});

describe('sunAt', () => {
  it('casts shadows toward the bottom right by day', () => {
    const s = sunAt(clockAt(300));
    expect(s.dx).toBeGreaterThan(0);
    expect(s.dy).toBeGreaterThan(0);
  });

  it('stretches shadows at dusk and fades them at night', () => {
    const day = sunAt(clockAt(300));
    const dusk = sunAt(clockAt(NIGHT_START - 1));
    const night = sunAt(clockAt(NIGHT_START + 500));
    expect(Math.hypot(dusk.dx, dusk.dy)).toBeGreaterThan(Math.hypot(day.dx, day.dy) * 1.8);
    expect(night.alpha).toBeLessThan(day.alpha * 0.6);
  });

  it('moves continuously', () => {
    let prev = sunAt(clockAt(0));
    for (let tick = 1; tick < DAY_TICKS * 2; tick++) {
      const s = sunAt(clockAt(tick));
      expect(Math.abs(s.dx - prev.dx)).toBeLessThan(0.03);
      expect(Math.abs(s.dy - prev.dy)).toBeLessThan(0.03);
      expect(Math.abs(s.alpha - prev.alpha)).toBeLessThan(0.02);
      prev = s;
    }
  });
});

describe('shadeOverlay', () => {
  /** Laying the overlay over a color: color * (1 - alpha) + overlay * alpha. */
  const over = (c: { r: number; g: number; b: number }, o: ReturnType<typeof shadeOverlay>) => ({
    r: c.r * (1 - o.alpha) + o.color.r * o.alpha,
    g: c.g * (1 - o.alpha) + o.color.g * o.alpha,
    b: c.b * (1 - o.alpha) + o.color.b * o.alpha,
  });
  const sand = { r: 200, g: 170, b: 120 };

  it('is clear by day', () => {
    expect(shadeOverlay({ r: 1, g: 1, b: 1 }).alpha).toBe(0);
  });

  it('approximates multiplying the warm ground by the night tint: as dark, and cold', () => {
    const tint = ambientAt(clockAt(NIGHT_START + 500)).tint;
    const shaded = over(sand, shadeOverlay(tint));
    const target = luminance({ r: (sand.r * tint.r) / 255, g: (sand.g * tint.g) / 255, b: (sand.b * tint.b) / 255 });
    expect(Math.abs(luminance({ r: shaded.r / 255, g: shaded.g / 255, b: shaded.b / 255 }) - target)).toBeLessThan(0.05);
    expect(shaded.b).toBeGreaterThan(shaded.r);
  });

  it('turns the ground orange at dusk', () => {
    const shaded = over(sand, shadeOverlay(ambientAt(clockAt(NIGHT_START - 1)).tint));
    expect(shaded.r - shaded.g).toBeGreaterThan(sand.r - sand.g + 15);
    expect(shaded.r).toBeGreaterThan(170);
  });
});
