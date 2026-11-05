import { describe, expect, it } from 'vitest';
import { luminance, mixColor, mixRgb, parseHex, rgbString, shade } from './color';

describe('parseHex / rgbString', () => {
  it('parses #rrggbb into channels and prints rgb()/rgba()', () => {
    expect(parseHex('#3ec1b0')).toEqual({ r: 0x3e, g: 0xc1, b: 0xb0 });
    expect(rgbString({ r: 1, g: 2, b: 3 })).toBe('rgb(1,2,3)');
    expect(rgbString({ r: 1, g: 2, b: 3 }, 0.5)).toBe('rgba(1,2,3,0.5)');
  });

  it('rounds and clamps channels when printing', () => {
    expect(rgbString({ r: -4, g: 300, b: 12.6 })).toBe('rgb(0,255,13)');
  });
});

describe('mixRgb / mixColor / shade', () => {
  it('interpolates channels linearly, t = 0 gives the first color', () => {
    const a = { r: 0, g: 100, b: 200 };
    const b = { r: 100, g: 100, b: 0 };
    expect(mixRgb(a, b, 0)).toEqual(a);
    expect(mixRgb(a, b, 1)).toEqual(b);
    expect(mixRgb(a, b, 0.25)).toEqual({ r: 25, g: 100, b: 150 });
  });

  it('mixColor works on hex strings and returns an rgb() string', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  });

  it('shade brightens toward white and darkens toward black', () => {
    expect(shade('#808080', 1)).toBe('rgb(255,255,255)');
    expect(shade('#808080', -1)).toBe('rgb(0,0,0)');
    expect(shade('#808080', 0)).toBe('rgb(128,128,128)');
  });
});

describe('luminance', () => {
  it('is the Rec. 709 weighted sum of 0..1 channels', () => {
    expect(luminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 5);
    expect(luminance({ r: 0, g: 1, b: 0 })).toBeCloseTo(0.7152, 4);
  });
});
