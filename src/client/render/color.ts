/**
 * Color math for the procedural art: hex parsing, channel mixing, printing to canvas color
 * strings, and luminance (used to keep the night ambient within its brightness budget).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const p = parseInt(hex.slice(1), 16);
  return { r: (p >> 16) & 255, g: (p >> 8) & 255, b: p & 255 };
}

const channel = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** `rgb(r,g,b)`, or `rgba(r,g,b,a)` when an alpha is given. Channels are rounded and clamped. */
export function rgbString(c: Rgb, alpha?: number): string {
  return alpha === undefined ? `rgb(${channel(c.r)},${channel(c.g)},${channel(c.b)})` : `rgba(${channel(c.r)},${channel(c.g)},${channel(c.b)},${alpha})`;
}

/** Linear mix of two colors; t = 0 gives a. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Mixes two #rrggbb colors into an rgb() string; t = 0 gives a. */
export function mixColor(a: string, b: string, t: number): string {
  return rgbString(mixRgb(parseHex(a), parseHex(b), t));
}

/** Brightens (amount > 0) or darkens (amount < 0) a #rrggbb color. */
export function shade(color: string, amount: number): string {
  return amount >= 0 ? mixColor(color, '#ffffff', amount) : mixColor(color, '#000000', -amount);
}

/** Relative luminance (Rec. 709 weights) of a color with channels in 0..1. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
