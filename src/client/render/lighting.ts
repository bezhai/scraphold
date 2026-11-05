/**
 * Day, dusk and night grading plus light sources. The tint of the hour (white by day, orange-red
 * at dusk, cold blue at night) is laid over the world as a translucent shade whose color and
 * opacity reproduce multiplying warm ground by the tint; light sources (core reactor, building
 * lamps, watchtower searchlights, muzzle flashes, fire, explosions) cut soft holes into it and add
 * colored halos. Fog, shade and halos share one quarter-resolution layer laid over the world in a
 * single full-screen pass: a true multiply blend, or bilinear-filtering a whole screen, is several
 * times slower on software-rendered canvases. The sun direction and shadow strength of the hour
 * come from here too, so every shadow agrees. A rust storm night swaps the cold blue for a rust-red
 * tone of the same brightness budget, eases in with nightfall and out over the next dawn, and sets
 * how thick the blowing sand is.
 */
import { nightType, type ClockState, type GameView, type NightType } from '../../sim';
import type { Camera } from '../camera';
import { mixRgb, rgbString, type Rgb } from './color';

/** Ticks for night to fall completely after dusk, and for dawn to clear it. */
export const NIGHTFALL_TICKS = 100;
export const DAWN_TICKS = 160;

const DAY: Rgb = { r: 1, g: 1, b: 1 };
const DUSK: Rgb = { r: 1, g: 0.72, b: 0.54 };
/** About 37% of the day luminance: dark and cold, but units stay readable. */
const NIGHT: Rgb = { r: 0.29, g: 0.37, b: 0.64 };
/** Rust storm night: rust red at about 38% of the day luminance, as readable as a clear night. */
const STORM_NIGHT: Rgb = { r: 0.66, g: 0.32, b: 0.18 };
/** How much the lights matter at the end of dusk (lamps come on as the sun sets). */
const DUSK_NIGHT = 0.45;

export interface Ambient {
  /** Light map base color, channels 0..1 (1 = unchanged). */
  tint: Rgb;
  /** 0 by day, 1 at full night: strength of lamps, glows and glowing eyes. */
  night: number;
}

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** The night types the light of the hour depends on: tonight's, and last night's for the dawn after it. */
export interface NightWeather {
  tonight: NightType | null;
  lastNight: NightType | null;
}

const NO_WEATHER: NightWeather = { tonight: null, lastNight: null };

/** Published types of tonight and last night (null when unknown or before night 1). */
export function nightWeather(v: Pick<GameView, 'calendar' | 'clock'>): NightWeather {
  return { tonight: nightType(v), lastNight: nightType(v, v.clock.day - 1) };
}

const nightTint = (type: NightType | null): Rgb => (type === 'rustStorm' ? STORM_NIGHT : NIGHT);

export function ambientAt(clock: ClockState, weather: NightWeather = NO_WEATHER): Ambient {
  switch (clock.phase) {
    case 'day': {
      if (clock.day <= 1 || clock.phaseTick >= DAWN_TICKS) return { tint: { ...DAY }, night: 0 };
      const t = smooth(clock.phaseTick / DAWN_TICKS);
      return { tint: mixRgb(nightTint(weather.lastNight), DAY, t), night: 1 - t };
    }
    case 'dusk': {
      const t = smooth(clock.phaseTick / clock.phaseTicks);
      return { tint: mixRgb(DAY, DUSK, t), night: DUSK_NIGHT * t };
    }
    case 'night': {
      const t = smooth(clock.phaseTick / NIGHTFALL_TICKS);
      return { tint: mixRgb(DUSK, nightTint(weather.tonight), t), night: DUSK_NIGHT + (1 - DUSK_NIGHT) * t };
    }
  }
}

/** How thick the blowing sand of a rust storm is (0..1): it rises with nightfall and dies down over the next dawn. */
export function stormLevel(clock: ClockState, weather: NightWeather): number {
  if (clock.phase === 'night') return weather.tonight === 'rustStorm' ? smooth(clock.phaseTick / NIGHTFALL_TICKS) : 0;
  if (clock.phase === 'day' && clock.phaseTick < DAWN_TICKS && weather.lastNight === 'rustStorm') return 1 - smooth(clock.phaseTick / DAWN_TICKS);
  return 0;
}

export interface Sun {
  /** Shadow offset per tile of object height (tiles, screen axes). */
  dx: number;
  dy: number;
  /** Shadow opacity. */
  alpha: number;
}

const SUN_DAY: Sun = { dx: 0.5, dy: 0.62, alpha: 0.34 };
/** Low sun in the west: long shadows toward the east. */
const SUN_DUSK: Sun = { dx: 1.55, dy: 0.5, alpha: 0.3 };
/** Faint moon shadows. */
const SUN_NIGHT: Sun = { dx: 0.4, dy: 0.55, alpha: 0.14 };

function mixSun(a: Sun, b: Sun, t: number): Sun {
  return { dx: a.dx + (b.dx - a.dx) * t, dy: a.dy + (b.dy - a.dy) * t, alpha: a.alpha + (b.alpha - a.alpha) * t };
}

export function sunAt(clock: ClockState): Sun {
  switch (clock.phase) {
    case 'day':
      if (clock.day <= 1 || clock.phaseTick >= DAWN_TICKS) return { ...SUN_DAY };
      return mixSun(SUN_NIGHT, SUN_DAY, smooth(clock.phaseTick / DAWN_TICKS));
    case 'dusk':
      return mixSun(SUN_DAY, SUN_DUSK, smooth(clock.phaseTick / clock.phaseTicks));
    case 'night':
      return mixSun(SUN_DUSK, SUN_NIGHT, smooth(clock.phaseTick / NIGHTFALL_TICKS));
  }
}

export type LightColor = 'lamp' | 'core' | 'fire' | 'flash' | 'acid' | 'teal' | 'nest';

const LIGHT_RGB: Record<LightColor, Rgb> = {
  lamp: { r: 255, g: 214, b: 150 },
  core: { r: 255, g: 190, b: 110 },
  fire: { r: 255, g: 140, b: 60 },
  flash: { r: 255, g: 236, b: 180 },
  acid: { r: 184, g: 240, b: 74 },
  teal: { r: 110, g: 230, b: 210 },
  nest: { r: 255, g: 90, b: 138 },
};

export interface LightSource {
  x: number;
  y: number;
  /** Radius in tiles. */
  radius: number;
  /** 0..1 */
  strength: number;
  color: LightColor;
}

/** A searchlight beam: a wedge from (x, y) toward `angle`. */
export interface LightCone {
  x: number;
  y: number;
  angle: number;
  /** Tiles. */
  length: number;
  strength: number;
}

/** The warm mid-tone ground the shade is matched on (most of the screen is sand). */
const REFERENCE: Rgb = { r: 200, g: 170, b: 120 };

export interface Shade {
  /** 0..255 channels. */
  color: Rgb;
  alpha: number;
}

/**
 * A translucent color that, laid over the reference ground, gives exactly the reference times
 * `tint` (and close to it for other colors): keep the darkest channel's share of the world, fill
 * the rest with the color that makes up each channel.
 */
export function shadeOverlay(tint: Rgb): Shade {
  const keep = Math.min(tint.r, tint.g, tint.b, 1);
  const alpha = Math.max(0, 1 - keep);
  if (alpha < 0.002) return { color: { r: 0, g: 0, b: 0 }, alpha: 0 };
  const fill = (ref: number, t: number) => Math.max(0, Math.min(255, (ref * (t - keep)) / alpha));
  return { color: { r: fill(REFERENCE.r, tint.r), g: fill(REFERENCE.g, tint.g), b: fill(REFERENCE.b, tint.b) }, alpha };
}

const sprites = new Map<string, HTMLCanvasElement>();
/** Light sprites are big enough to be drawn unfiltered at the layer's scale without visible steps. */
const SPRITE = 128;

/** Soft disc of the given color (cached); 'hole' is white, for cutting light into the shade. */
function lightSprite(color: LightColor | 'hole'): HTMLCanvasElement {
  const hit = sprites.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const rgb = color === 'hole' ? { r: 255, g: 255, b: 255 } : LIGHT_RGB[color];
  const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  grad.addColorStop(0, rgbString(rgb, 1));
  grad.addColorStop(0.4, rgbString(rgb, color === 'hole' ? 0.85 : 0.55));
  grad.addColorStop(0.75, rgbString(rgb, color === 'hole' ? 0.35 : 0.16));
  grad.addColorStop(1, rgbString(rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  sprites.set(color, c);
  return c;
}

/** Searchlight wedge pointing along +x, origin at the left middle (cached). */
function coneSprite(): HTMLCanvasElement {
  const hit = sprites.get('cone');
  if (hit) return hit;
  const W = 128;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(0, H / 2, 0, 0, H / 2, W);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, H / 2 - 2);
  g.lineTo(W, 0);
  g.lineTo(W, H);
  g.lineTo(0, H / 2 + 2);
  g.closePath();
  g.fill();
  sprites.set('cone', c);
  return c;
}

const lampLevel = (a: Ambient) => Math.min(1, a.night * 1.4);
/** Lamps, the core and nests glow only as night falls; fire, flashes and acid at any hour. */
const isLamp = (c: LightColor) => c === 'lamp' || c === 'core' || c === 'teal' || c === 'nest';

export interface ShadeLayer {
  resize(cssW: number, cssH: number): void;
  /**
   * Lays fog, the shade of the hour and light halos over the world on `ctx` in one pass.
   * `paintFog` draws the fog in world tiles (the layer sets the transform); lights and cones are
   * in world tiles.
   */
  apply(
    ctx: CanvasRenderingContext2D,
    deviceW: number,
    deviceH: number,
    cam: Camera,
    paintFog: (g: CanvasRenderingContext2D) => void,
    ambient: Ambient,
    lights: readonly LightSource[],
    cones: readonly LightCone[],
  ): void;
}

/**
 * The layer runs at a quarter of the CSS resolution: fog edges and light falloff are soft anyway.
 * It is smoothed up to half resolution, then enlarged unfiltered to the screen; a filtered
 * full-screen enlargement costs about three times as much on a software rasterizer, and the 2x2
 * blocks of a smooth gradient do not show.
 */
const LAYER_SCALE = 0.25;

export function createShadeLayer(): ShadeLayer {
  const layer = document.createElement('canvas');
  const g = layer.getContext('2d') as CanvasRenderingContext2D;
  const half = document.createElement('canvas');
  const h = half.getContext('2d') as CanvasRenderingContext2D;
  return {
    resize(cssW, cssH) {
      layer.width = Math.max(1, Math.round(cssW * LAYER_SCALE));
      layer.height = Math.max(1, Math.round(cssH * LAYER_SCALE));
      half.width = layer.width * 2;
      half.height = layer.height * 2;
    },
    apply(ctx, deviceW, deviceH, cam, paintFog, ambient, lights, cones) {
      const W = layer.width;
      const H = layer.height;
      const k = cam.zoom * LAYER_SCALE;
      const ox = (cam.viewW / 2 - cam.x * cam.zoom) * LAYER_SCALE;
      const oy = (cam.viewH / 2 - cam.y * cam.zoom) * LAYER_SCALE;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      // The shade of the hour with light holes cut out of it, then the fog over it.
      const shade = shadeOverlay(ambient.tint);
      if (shade.alpha > 0) {
        g.globalCompositeOperation = 'copy';
        g.fillStyle = rgbString(shade.color, shade.alpha);
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'destination-out';
        g.imageSmoothingEnabled = false;
        const hole = lightSprite('hole');
        const level = lampLevel(ambient);
        for (const l of lights) {
          const x = l.x * k + ox;
          const y = l.y * k + oy;
          const r = l.radius * k;
          if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
          const a = l.strength * (isLamp(l.color) ? level : 1);
          if (a <= 0.01) continue;
          g.globalAlpha = Math.min(1, a);
          g.drawImage(hole, x - r, y - r, r * 2, r * 2);
        }
        if (level > 0.01) {
          const img = coneSprite();
          for (const c of cones) {
            const len = c.length * k;
            g.globalAlpha = Math.min(1, c.strength * level);
            g.setTransform(Math.cos(c.angle), Math.sin(c.angle), -Math.sin(c.angle), Math.cos(c.angle), c.x * k + ox, c.y * k + oy);
            g.drawImage(img, 0, -len * 0.3, len, len * 0.6);
          }
          g.setTransform(1, 0, 0, 1, 0, 0);
        }
        g.globalAlpha = 1;
      } else {
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, W, H);
      }
      g.globalCompositeOperation = 'source-over';
      g.setTransform(k, 0, 0, k, ox, oy);
      g.imageSmoothingEnabled = true;
      paintFog(g);
      g.setTransform(1, 0, 0, 1, 0, 0);
      paintGlows(g, lights, k, ox, oy, ambient);
      h.globalCompositeOperation = 'copy';
      h.imageSmoothingEnabled = true;
      h.drawImage(layer, 0, 0, half.width, half.height);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(half, 0, 0, deviceW, deviceH);
      ctx.restore();
    },
  };
}

const GLOW_ALPHA: Record<LightColor, number> = { lamp: 0.16, core: 0.3, fire: 0.32, flash: 0.3, acid: 0.26, teal: 0.14, nest: 0.24 };

/**
 * Colored halos added into the layer (world tiles map to layer pixels by `k`, `ox`, `oy`), so lamps
 * light warm pools and fire, flashes, acid and the core read as glowing.
 */
function paintGlows(g: CanvasRenderingContext2D, lights: readonly LightSource[], k: number, ox: number, oy: number, ambient: Ambient): void {
  const level = lampLevel(ambient);
  const day = Math.max(0.3, ambient.night);
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.globalCompositeOperation = 'lighter';
  g.imageSmoothingEnabled = false;
  for (const l of lights) {
    const a = GLOW_ALPHA[l.color] * l.strength * (isLamp(l.color) ? level : day);
    if (a < 0.01) continue;
    const x = l.x * k + ox;
    const y = l.y * k + oy;
    const r = l.radius * k * (l.color === 'lamp' ? 0.75 : 0.6);
    if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
    g.globalAlpha = Math.min(1, a);
    g.drawImage(lightSprite(l.color), x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = true;
}

/** Same additive halo sprite, for small emissive details drawn in world units (eyes, acid sacs). */
export function glowSprite(color: LightColor): HTMLCanvasElement {
  return lightSprite(color);
}
