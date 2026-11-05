import { describe, expect, it } from 'vitest';
import { COLORS, hpColor, outlinePx } from './palette';

describe('palette', () => {
  it('uses the art direction identity colors', () => {
    expect(COLORS.teal).toBe('#3ec1b0');
    expect(COLORS.flesh).toBe('#9c3a5a');
    expect(COLORS.acid).toBe('#b8f04a');
    expect(COLORS.eye).toBe('#ffd84a');
    expect(COLORS.accent).toBe('#f08a3c');
    expect(COLORS.danger).toBe('#ea4a36');
    expect(COLORS.outline).toBe('#1a1510');
    expect([COLORS.sandLight, COLORS.sand, COLORS.sandDark]).toEqual(['#d9bd84', '#b99a62', '#8a6f45']);
    expect([COLORS.scrap, COLORS.food, COLORS.fuel, COLORS.research]).toEqual(['#d0703a', '#8cc24a', '#6a5a9a', '#5fb2e6']);
  });

  it('hpColor goes from good to bad as hp drops', () => {
    expect(hpColor(1)).toBe(COLORS.hpGood);
    expect(hpColor(0.5)).toBe(COLORS.hpMid);
    expect(hpColor(0.1)).toBe(COLORS.hpBad);
  });
});

describe('outlinePx', () => {
  it('is 1.5 device px at the default 44 px per tile and never under 1 px', () => {
    expect(outlinePx(44)).toBeCloseTo(1.5, 5);
    expect(outlinePx(20)).toBe(1);
    expect(outlinePx(10)).toBe(1);
    expect(outlinePx(80)).toBeGreaterThan(1.5);
  });
});
