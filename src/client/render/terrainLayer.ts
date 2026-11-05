/**
 * Static terrain, painted once per game into an offscreen canvas (TILE_PX pixels per tile) and
 * blitted every frame. The ground is computed per pixel: warm sand varied by layered noise, with
 * soil, scrap ground, ruin paving, oil and water blended in through blurred coverage fields whose
 * edges are broken up by noise, so terrain types melt into each other instead of forming tile
 * squares (wet sand and foam around water, dark stains around oil). On top go sparse decals
 * (cracks, pebbles, dry grass, tire tracks, bones, tires, barrels), sprout rows on soil, scrap
 * plates, pipes and car wrecks on wreckage, ruins by kind (old foundations; a crashed orbital
 * supply pod in its crater; a heavy steel warehouse door in a concrete frame), and rock outcrops
 * and broken walls drawn with a lit top, a darker south face and a soft shadow toward the bottom
 * right.
 */
import type { GameView, RuinKind } from '../../sim';
import { TERRAIN_LIST, type Terrain } from '../../sim/data/map';
import { mixRgb, parseHex, type Rgb } from './color';
import { hash2, noiseGrid, sampleNoise, seedSalt } from './noise';
import { COLORS } from './palette';
import { blurTiles, sampleBilinear } from './tileField';

export const TILE_PX = 32;
/** Resolution of the per-pixel ground pass; upscaled to TILE_PX with smoothing (the ground is soft). */
const GROUND_PX = 16;

type Ctx = CanvasRenderingContext2D;
type TerrainAt = (x: number, y: number) => Terrain | null;

function terrainGrid(view: GameView): TerrainAt {
  const { width, height, terrain } = view.map;
  return (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? null : (TERRAIN_LIST[terrain[y * width + x] as number] as Terrain));
}

/** Blurred per-tile coverage of each ground class (0..1), the source of all soft transitions. */
export interface TerrainFields {
  soil: Float32Array;
  scrap: Float32Array;
  oil: Float32Array;
  water: Float32Array;
  paving: Float32Array;
  rocky: Float32Array;
}

const CLASS_OF: Partial<Record<Terrain, keyof TerrainFields>> = {
  fertile: 'soil',
  wreckage: 'scrap',
  oil: 'oil',
  water: 'water',
  ruin: 'paving',
  rock: 'rocky',
  wall: 'rocky',
};

/** Field level where oil and water begin to show as a pool (the shore sits just outside it). */
export const POOL_LEVEL = 0.46;
/**
 * A pool tile keeps at least this much of itself through the blur, so a lone oil or water tile is
 * still a small puddle rather than a smudge that never reaches POOL_LEVEL.
 */
const POOL_CORE = 0.62;

export function terrainFields(view: GameView): TerrainFields {
  const { width, height, terrain } = view.map;
  const n = width * height;
  const raw: TerrainFields = {
    soil: new Float32Array(n),
    scrap: new Float32Array(n),
    oil: new Float32Array(n),
    water: new Float32Array(n),
    paving: new Float32Array(n),
    rocky: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const cls = CLASS_OF[TERRAIN_LIST[terrain[i] as number] as Terrain];
    if (cls) raw[cls][i] = 1;
  }
  // A crashed supply pod lies in open sand, not on old paving.
  for (const ruin of view.map.ruins) if (ruin.kind === 'supplyPod') raw.paving[ruin.tile] = 0;
  const out = {} as TerrainFields;
  for (const key of Object.keys(raw) as (keyof TerrainFields)[]) {
    out[key] = new Float32Array(n);
    blurTiles(raw[key], width, height, out[key]);
  }
  for (const key of ['oil', 'water'] as const) {
    const f = out[key];
    const r = raw[key];
    for (let i = 0; i < n; i++) f[i] = Math.max(f[i] as number, (r[i] as number) * POOL_CORE);
  }
  return out;
}

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

const C = {
  sandDark: parseHex(COLORS.sandDark),
  sand: parseHex(COLORS.sand),
  sandLight: parseHex(COLORS.sandLight),
  sandRed: parseHex('#c39a62'),
  sandGrey: parseHex('#ad9e80'),
  wetSand: parseHex(COLORS.wetSand),
  fertile: parseHex(COLORS.fertile),
  fertileDark: parseHex(COLORS.fertileDark),
  soilClod: parseHex('#9a7448'),
  scrap: parseHex(COLORS.wreckGround),
  rustDark: parseHex(COLORS.rustDark),
  paving: parseHex(COLORS.ruinFloor),
  pavingDark: parseHex('#9a8b6c'),
  rockDust: parseHex('#8f7c62'),
  stain: parseHex('#3e3024'),
  oil: parseHex(COLORS.oil),
  sheenA: parseHex(COLORS.oilSheen),
  sheenB: parseHex(COLORS.oilSheen2),
  sheenC: parseHex('#c9a24a'),
  foam: parseHex(COLORS.foam),
  waterLight: parseHex(COLORS.waterLight),
  water: parseHex(COLORS.water),
  waterDeep: parseHex(COLORS.waterDeep),
};

function blend(c: Rgb, d: Rgb, t: number): void {
  c.r += (d.r - c.r) * t;
  c.g += (d.g - c.g) * t;
  c.b += (d.b - c.b) * t;
}

/** Which classes have any coverage in a tile's 3x3 neighborhood, so most pixels skip them. */
function nearMask(fields: TerrainFields, width: number, height: number): Uint8Array {
  const keys = Object.keys(fields) as (keyof TerrainFields)[];
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          keys.forEach((k, bit) => {
            if ((fields[k][ny * width + nx] as number) > 0) m |= 1 << bit;
          });
        }
      mask[y * width + x] = m;
    }
  return mask;
}

const BIT = { soil: 1, scrap: 2, oil: 4, water: 8, paving: 16, rocky: 32 } as const;

/** The per-pixel ground image at GROUND_PX per tile. */
function paintGround(view: GameView, fields: TerrainFields, salt: number, makeCanvas: (w: number, h: number) => HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = view.map;
  const W = width * GROUND_PX;
  const H = height * GROUND_PX;
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d') as Ctx;
  const img = g.createImageData(W, H);
  const data = img.data;
  const n1 = noiseGrid(W, H, GROUND_PX * 7, salt + 1);
  const n2 = noiseGrid(W, H, GROUND_PX * 1.6, salt + 2);
  const n3 = noiseGrid(W, H, GROUND_PX * 0.32, salt + 3);
  const n4 = noiseGrid(W, H, GROUND_PX * 4.2, salt + 4);
  const near = nearMask(fields, width, height);
  const c: Rgb = { r: 0, g: 0, b: 0 };
  const field = (f: Float32Array, x: number, y: number) => sampleBilinear(f, width, height, x, y);
  for (let py = 0; py < H; py++) {
    const ty = (py + 0.5) / GROUND_PX;
    const tileRow = Math.min(height - 1, Math.floor(ty)) * width;
    for (let px = 0; px < W; px++) {
      const tx = (px + 0.5) / GROUND_PX;
      const a1 = sampleNoise(n1, px, py);
      const a2 = sampleNoise(n2, px, py);
      const a3 = sampleNoise(n3, px, py);
      // Sand: mostly between mid and light sand, darker drifts, slight red / grey hue patches.
      const s = Math.min(1, Math.max(0, 0.12 + 0.95 * (a1 * 0.6 + a2 * 0.4)));
      if (s < 0.45) {
        const t = s / 0.45;
        c.r = C.sandDark.r + (C.sand.r - C.sandDark.r) * t;
        c.g = C.sandDark.g + (C.sand.g - C.sandDark.g) * t;
        c.b = C.sandDark.b + (C.sand.b - C.sandDark.b) * t;
      } else {
        const t = (s - 0.45) / 0.55;
        c.r = C.sand.r + (C.sandLight.r - C.sand.r) * t;
        c.g = C.sand.g + (C.sandLight.g - C.sand.g) * t;
        c.b = C.sand.b + (C.sandLight.b - C.sand.b) * t;
      }
      const hue = sampleNoise(n4, px, py);
      if (hue > 0.62) blend(c, C.sandRed, (hue - 0.62) * 0.9);
      else if (hue < 0.38) blend(c, C.sandGrey, (0.38 - hue) * 0.8);
      const m = near[tileRow + Math.min(width - 1, Math.floor(tx))] as number;
      if (m !== 0) {
        // Edge noise roughens borders only where a class is present (never stray blots far from it).
        const edge = (a2 - 0.5) * 0.5 + (a3 - 0.5) * 0.24;
        const rough = (f: number, k: number) => f + edge * k * Math.min(1, f * 3);
        if (m & BIT.rocky) {
          const v = rough(field(fields.rocky, tx, ty), 1);
          blend(c, C.rockDust, smooth((v - 0.15) / 0.5) * 0.55);
        }
        if (m & BIT.scrap) {
          const v = rough(field(fields.scrap, tx, ty), 1);
          blend(c, C.rustDark, smooth((v - 0.12) / 0.3) * 0.12);
          const w = smooth((v - 0.34) / 0.3);
          if (w > 0) {
            const sc = mixRgb(C.scrap, C.rustDark, a3 * 0.45);
            blend(c, sc, w * 0.92);
          }
        }
        if (m & BIT.soil) {
          // Tilled soil: an even warm brown with broad damp patches and a few lighter clods, edged
          // by a faint darker rim (fine noise here reads as dirt smeared on the sand).
          const v = rough(field(fields.soil, tx, ty), 0.6);
          blend(c, C.fertileDark, smooth((v - 0.12) / 0.3) * 0.08);
          const w = smooth((v - SOIL_LEVEL + 0.06) / 0.2);
          if (w > 0) {
            const sc = mixRgb(C.fertile, C.fertileDark, 0.15 + 0.4 * smooth((a2 - 0.35) * 2.5));
            if (a3 > 0.68) blend(sc, C.soilClod, (a3 - 0.68) * 1.2);
            blend(c, sc, w);
          }
        }
        if (m & BIT.paving) {
          const v = rough(field(fields.paving, tx, ty), 0.7);
          const w = smooth((v - 0.3) / 0.3);
          if (w > 0) blend(c, mixRgb(C.paving, C.pavingDark, a3 * 0.6), w * 0.9);
        }
        if (m & BIT.oil) {
          const v = rough(field(fields.oil, tx, ty), 0.7);
          blend(c, C.stain, smooth((v - 0.12) / 0.32) * 0.55);
          const w = smooth((v - POOL_LEVEL + 0.02) / 0.1);
          if (w > 0) {
            // Glossy black with an iridescent sheen in noise bands and a lit top-left rim.
            const band = (a2 * 3.1 + a3 * 1.3 + tx * 0.21) % 1;
            const sheen = band < 0.33 ? mixRgb(C.sheenA, C.sheenB, band * 3) : band < 0.66 ? mixRgb(C.sheenB, C.sheenC, (band - 0.33) * 3) : mixRgb(C.sheenC, C.sheenA, (band - 0.66) * 3);
            const oil = mixRgb(C.oil, sheen, 0.16 + 0.14 * smooth((a3 - 0.45) * 3));
            const gx = field(fields.oil, tx + 0.25, ty) - field(fields.oil, tx - 0.25, ty);
            const gy = field(fields.oil, tx, ty + 0.25) - field(fields.oil, tx, ty - 0.25);
            const rim = Math.max(0, gx + gy) * (1 - smooth((v - 0.6) / 0.2));
            blend(oil, { r: 210, g: 200, b: 230 }, Math.min(0.35, rim * 0.6));
            blend(c, oil, w);
          }
        }
        if (m & BIT.water) {
          const v = rough(field(fields.water, tx, ty), 0.45);
          blend(c, C.wetSand, smooth((v - 0.16) / 0.3) * 0.7);
          const foam = 1 - Math.min(1, Math.abs(v - POOL_LEVEL - 0.015) / 0.035);
          if (foam > 0) blend(c, C.foam, foam * (0.45 + 0.4 * a3));
          const w = smooth((v - POOL_LEVEL - 0.02) / 0.05);
          if (w > 0) {
            const depth = smooth((v - 0.5) / 0.42);
            const wc = depth < 0.5 ? mixRgb(C.waterLight, C.water, depth * 2) : mixRgb(C.water, C.waterDeep, (depth - 0.5) * 2);
            blend(wc, C.waterDeep, (a2 - 0.5) * 0.4 + 0.1);
            blend(wc, C.waterLight, Math.max(0, a3 - 0.7) * 0.5);
            blend(c, wc, w);
          }
        }
      }
      const grain = (hash2(px, py, salt) - 0.5) * 9;
      const i = (py * W + px) * 4;
      data[i] = c.r + grain;
      data[i + 1] = c.g + grain;
      data[i + 2] = c.b + grain * 0.8;
      data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** A small tile of light and dark specks laid over the upscaled ground for crisp texture. */
function grainPattern(g: Ctx, salt: number, makeCanvas: (w: number, h: number) => HTMLCanvasElement): CanvasPattern | null {
  const S = 96;
  const c = makeCanvas(S, S);
  const cg = c.getContext('2d') as Ctx;
  for (let k = 0; k < 260; k++) {
    const x = hash2(k, 1, salt) * S;
    const y = hash2(k, 2, salt) * S;
    const light = hash2(k, 3, salt) > 0.55;
    cg.fillStyle = light ? 'rgba(255,240,205,0.16)' : 'rgba(50,35,18,0.16)';
    const r = 0.5 + hash2(k, 4, salt) * 1.1;
    cg.fillRect(x, y, r, r);
  }
  return g.createPattern(c, 'repeat');
}

/** Renders the terrain of `view` into a new canvas of width*TILE_PX x height*TILE_PX pixels. */
export function renderTerrain(view: GameView, makeCanvas: (w: number, h: number) => HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = view.map;
  const canvas = makeCanvas(width * TILE_PX, height * TILE_PX);
  const g = canvas.getContext('2d') as Ctx;
  const at = terrainGrid(view);
  const salt = seedSalt(view.options.seed);
  const fields = terrainFields(view);
  const ground = paintGround(view, fields, salt, makeCanvas);
  g.imageSmoothingEnabled = true;
  g.drawImage(ground, 0, 0, width * TILE_PX, height * TILE_PX);
  const grain = grainPattern(g, salt, makeCanvas);
  if (grain) {
    g.fillStyle = grain;
    g.fillRect(0, 0, width * TILE_PX, height * TILE_PX);
  }
  const soil = (tx: number, ty: number) => sampleBilinear(fields.soil, width, height, tx, ty);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = at(x, y);
      const px = x * TILE_PX;
      const py = y * TILE_PX;
      if (t === 'wasteland') drawWastelandDecals(g, px, py, x, y, salt, at);
      else if (t === 'fertile') drawSprouts(g, px, py, x, y, salt, soil);
      else if (t === 'oil') drawOilGloss(g, px, py, x, y, salt, at);
    }
  drawTireTracks(g, view, at, salt);
  drawWreckage(g, view, at, salt);
  drawRuins(g, view, at, salt);
  drawScree(g, view, at, salt);
  drawRockOutcrops(g, view, at, salt);
  drawWalls(g, view, at, salt);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Decals

const OUTLINE = 'rgba(26,21,16,0.85)';

function drawWastelandDecals(g: Ctx, px: number, py: number, x: number, y: number, salt: number, at: TerrainAt): void {
  const r = (k: number) => hash2(x, y, salt + k);
  const T = TILE_PX;
  // Keep the shoreline and rock bases clean.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === 'water') return;
  if (r(1) < 0.22) {
    // pebbles
    const n = 1 + Math.floor(r(2) * 3);
    for (let k = 0; k < n; k++) {
      const sx = px + 4 + r(10 + k) * (T - 8);
      const sy = py + 4 + r(20 + k) * (T - 8);
      const rr = 0.9 + r(30 + k) * 1.6;
      g.fillStyle = 'rgba(60,42,24,0.35)';
      g.beginPath();
      g.ellipse(sx + 0.8, sy + 1, rr, rr * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = r(40 + k) > 0.5 ? '#a08a6a' : '#8c7a62';
      g.beginPath();
      g.ellipse(sx, sy, rr, rr * 0.78, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,245,220,0.35)';
      g.beginPath();
      g.ellipse(sx - rr * 0.3, sy - rr * 0.3, rr * 0.45, rr * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (r(3) > 0.9) {
    // crack
    g.strokeStyle = 'rgba(70,50,28,0.42)';
    g.lineWidth = 1;
    g.beginPath();
    let cx = px + r(4) * T;
    let cy = py + r(5) * T;
    g.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      cx += (r(6 + k) - 0.5) * 16;
      cy += (r(12 + k) - 0.5) * 16;
      g.lineTo(cx, cy);
      if (k === 1) {
        g.moveTo(cx, cy);
        g.lineTo(cx + (r(50) - 0.5) * 10, cy + (r(51) - 0.5) * 10);
        g.moveTo(cx, cy);
      }
    }
    g.stroke();
  }
  if (r(7) > 0.9) {
    // dry grass tuft
    const bx = px + 6 + r(8) * (T - 12);
    const by = py + 8 + r(9) * (T - 14);
    g.strokeStyle = r(60) > 0.5 ? 'rgba(122,104,52,0.9)' : 'rgba(140,118,60,0.9)';
    g.lineWidth = 1;
    g.lineCap = 'round';
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (r(70 + k) - 0.5) * 2.2;
      const len = 3 + r(80 + k) * 5;
      g.moveTo(bx + (k - 3) * 0.6, by);
      g.lineTo(bx + (k - 3) * 0.6 + Math.cos(a) * len, by + Math.sin(a) * len);
    }
    g.stroke();
    g.lineCap = 'butt';
  }
  const rare = r(11);
  if (rare > 0.988) drawBarrel(g, px + 8 + r(12) * 16, py + 8 + r(13) * 16, r(14));
  else if (rare > 0.976) drawTire(g, px + 8 + r(12) * 16, py + 8 + r(13) * 16, 4 + r(14) * 1.5);
  else if (rare > 0.964) drawBones(g, px + 8 + r(12) * 16, py + 8 + r(13) * 16, r(14) * Math.PI);
}

function drawBarrel(g: Ctx, cx: number, cy: number, v: number): void {
  const r = 4.6;
  g.fillStyle = 'rgba(40,25,12,0.35)';
  g.beginPath();
  g.ellipse(cx + 2.2, cy + 2.8, r, r * 0.9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = v > 0.5 ? COLORS.rust : '#6a6f3a';
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = 'rgba(30,20,12,0.55)';
  g.beginPath();
  g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,220,170,0.3)';
  g.beginPath();
  g.ellipse(cx - 1.4, cy - 1.6, 1.8, 1.1, -0.6, 0, Math.PI * 2);
  g.fill();
}

function drawTire(g: Ctx, cx: number, cy: number, r: number): void {
  g.strokeStyle = 'rgba(40,25,12,0.3)';
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(cx + 1.4, cy + 1.8, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#2a2622';
  g.lineWidth = 2.8;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(160,150,140,0.35)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(cx, cy, r + 0.6, Math.PI, Math.PI * 1.6);
  g.stroke();
}

function drawBones(g: Ctx, cx: number, cy: number, a: number): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.strokeStyle = 'rgba(40,30,20,0.4)';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-4, 1);
  g.lineTo(4, 1);
  g.stroke();
  g.strokeStyle = COLORS.bone;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-4, 0);
  g.lineTo(4, 0);
  g.moveTo(-2, 3);
  g.lineTo(3, 4);
  g.stroke();
  g.fillStyle = COLORS.bone;
  for (const [x, y] of [
    [-4.5, -0.8],
    [-4.5, 0.8],
    [4.5, -0.8],
    [4.5, 0.8],
  ] as const) {
    g.beginPath();
    g.arc(x, y, 1, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'butt';
  g.restore();
}

/** Level of the blurred soil field where tilled soil shows (see paintGround). */
const SOIL_LEVEL = 0.42;

/** Rows of sprouts in the furrows of fertile soil, only where the soil shows (`soil` samples the field in tiles). */
function drawSprouts(g: Ctx, px: number, py: number, x: number, y: number, salt: number, soil: (tx: number, ty: number) => number): void {
  const T = TILE_PX;
  for (let row = 0; row < 3; row++) {
    const fy = py + (row + 0.5) * (T / 3);
    const ty = y + (row + 0.5) / 3;
    g.strokeStyle = 'rgba(30,18,8,0.32)';
    g.lineWidth = 1.4;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      if (soil(x + (k + 0.5) / 5, ty) < SOIL_LEVEL) continue;
      g.moveTo(px + (k * T) / 5, fy + 2.5);
      g.lineTo(px + ((k + 1) * T) / 5, fy + 2.5);
    }
    g.stroke();
    for (let k = 0; k < 5; k++) {
      const density = Math.min(1, (soil(x + (k + 0.5) / 5, ty) - SOIL_LEVEL) * 3);
      if (density <= 0 || hash2(x * 7 + k, y * 5 + row, salt + 300) > density * 0.95) continue;
      const sx = px + (k + 0.5) * (T / 5) + (hash2(x + k, y + row, salt + 301) - 0.5) * 2;
      const sz = 1.4 + hash2(x + k, y + row, salt + 302) * 1.3;
      g.fillStyle = COLORS.sproutDark;
      g.beginPath();
      g.ellipse(sx - sz * 0.55, fy, sz, sz * 0.55, -0.5, 0, Math.PI * 2);
      g.ellipse(sx + sz * 0.55, fy, sz, sz * 0.55, 0.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = COLORS.sprout;
      g.beginPath();
      g.ellipse(sx - sz * 0.5, fy - 0.5, sz * 0.75, sz * 0.4, -0.5, 0, Math.PI * 2);
      g.ellipse(sx + sz * 0.5, fy - 0.5, sz * 0.75, sz * 0.4, 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Specular streaks and a few bubbles on oil pools (the pool itself is in the ground image). */
function drawOilGloss(g: Ctx, px: number, py: number, x: number, y: number, salt: number, at: TerrainAt): void {
  const inner = at(x - 1, y) === 'oil' && at(x, y - 1) === 'oil';
  if (!inner && hash2(x, y, salt + 500) > 0.5) return;
  const cx = px + 8 + hash2(x, y, salt + 501) * 14;
  const cy = py + 8 + hash2(x, y, salt + 502) * 14;
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.beginPath();
  g.ellipse(cx, cy, 5, 1.4, -0.55, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  g.ellipse(cx - 2, cy - 1, 1.6, 0.6, -0.55, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(160,140,200,0.35)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(cx + 6, cy + 5, 1.4, 0, Math.PI * 2);
  g.stroke();
}

/** A few long, faint pairs of tire tracks over open sand. */
function drawTireTracks(g: Ctx, view: GameView, at: TerrainAt, salt: number): void {
  const { width, height } = view.map;
  const T = TILE_PX;
  const count = Math.round((width * height) / 900);
  for (let k = 0; k < count; k++) {
    const x0 = 2 + hash2(k, 1, salt + 700) * (width - 4);
    const y0 = 2 + hash2(k, 2, salt + 700) * (height - 4);
    const a = hash2(k, 3, salt + 700) * Math.PI * 2;
    const bend = (hash2(k, 4, salt + 700) - 0.5) * 0.8;
    const len = 5 + hash2(k, 5, salt + 700) * 6;
    const pts: { x: number; y: number }[] = [];
    let ok = true;
    for (let s = 0; s <= 12; s++) {
      const t = s / 12;
      const ang = a + bend * t;
      const p = { x: x0 + Math.cos(ang) * len * t, y: y0 + Math.sin(ang) * len * t };
      const terr = at(Math.floor(p.x), Math.floor(p.y));
      if (terr !== 'wasteland' && terr !== 'fertile') ok = false;
      pts.push(p);
    }
    if (!ok) continue;
    for (const side of [-1, 1]) {
      g.strokeStyle = 'rgba(80,58,32,0.16)';
      g.lineWidth = 2.6;
      g.beginPath();
      pts.forEach((p, i) => {
        const ang = a + bend * (i / 12);
        const ox = -Math.sin(ang) * 0.17 * side;
        const oy = Math.cos(ang) * 0.17 * side;
        if (i === 0) g.moveTo((p.x + ox) * T, (p.y + oy) * T);
        else g.lineTo((p.x + ox) * T, (p.y + oy) * T);
      });
      g.stroke();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Wreckage: rusted plates, pipes, tires and the odd car wreck, in rust orange and steel grey.

function metalPlate(g: Ctx, cx: number, cy: number, w: number, h: number, a: number, rust: boolean): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.fillStyle = 'rgba(40,25,12,0.35)';
  g.fillRect(-w / 2 + 1.5, -h / 2 + 2, w, h);
  g.fillStyle = rust ? COLORS.rust : COLORS.steel;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.fillStyle = rust ? COLORS.rustLight : COLORS.steelLight;
  g.fillRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, 1.2);
  if (rust) {
    g.fillStyle = 'rgba(70,30,12,0.45)';
    g.beginPath();
    g.ellipse(w * 0.15, h * 0.1, w * 0.18, h * 0.25, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = 'rgba(160,80,40,0.55)';
    g.fillRect(w * 0.1, -h / 2 + 1, w * 0.25, h * 0.4);
  }
  g.fillStyle = 'rgba(20,15,10,0.6)';
  g.fillRect(-w / 2 + 1.5, -h / 2 + 1.5, 1, 1);
  g.fillRect(w / 2 - 2.5, h / 2 - 2.5, 1, 1);
  g.restore();
}

function pipe(g: Ctx, x1: number, y1: number, x2: number, y2: number, rust: boolean): void {
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(40,25,12,0.35)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(x1 + 1.5, y1 + 2);
  g.lineTo(x2 + 1.5, y2 + 2);
  g.stroke();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 4.4;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.strokeStyle = rust ? COLORS.rust : COLORS.steel;
  g.lineWidth = 2.8;
  g.stroke();
  g.strokeStyle = rust ? COLORS.rustLight : COLORS.steelLight;
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(x1 - 0.6, y1 - 0.7);
  g.lineTo(x2 - 0.6, y2 - 0.7);
  g.stroke();
  g.lineCap = 'butt';
}

function carWreck(g: Ctx, cx: number, cy: number, a: number, rust: boolean): void {
  const L = TILE_PX * 1.3;
  const W = TILE_PX * 0.66;
  g.save();
  g.translate(cx, cy);
  g.save();
  g.translate(4, 5);
  g.rotate(a);
  g.fillStyle = 'rgba(40,25,12,0.38)';
  g.beginPath();
  g.roundRect(-L / 2, -W / 2, L, W, 5);
  g.fill();
  g.restore();
  g.rotate(a);
  const body = rust ? '#9a5a34' : '#77807f';
  g.fillStyle = body;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.2;
  g.beginPath();
  g.roundRect(-L / 2, -W / 2, L, W, 6);
  g.fill();
  g.stroke();
  // roof and broken windows
  g.fillStyle = rust ? '#7d4526' : '#5e6766';
  g.beginPath();
  g.roundRect(-L * 0.18, -W * 0.38, L * 0.42, W * 0.76, 3);
  g.fill();
  g.stroke();
  g.fillStyle = '#2b3234';
  g.fillRect(L * 0.24, -W * 0.34, L * 0.07, W * 0.68);
  g.fillRect(-L * 0.25, -W * 0.34, L * 0.06, W * 0.68);
  g.fillStyle = 'rgba(170,210,215,0.35)';
  g.fillRect(L * 0.25, -W * 0.32, L * 0.03, W * 0.3);
  // rust bloom, highlight
  g.fillStyle = 'rgba(150,62,22,0.55)';
  g.beginPath();
  g.ellipse(-L * 0.35, W * 0.15, L * 0.1, W * 0.2, 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,235,200,0.25)';
  g.fillRect(-L / 2 + 3, -W / 2 + 1.5, L - 6, 1.5);
  // wheels left behind
  g.fillStyle = '#211d1a';
  g.fillRect(-L * 0.36, -W / 2 - 1.5, L * 0.16, 3);
  g.fillRect(L * 0.22, W / 2 - 1.5, L * 0.16, 3);
  g.restore();
}

function drawWreckage(g: Ctx, view: GameView, at: TerrainAt, salt: number): void {
  const { width, height } = view.map;
  const T = TILE_PX;
  const cars: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (at(x, y) !== 'wreckage') continue;
      const r = (k: number) => hash2(x, y, salt + 900 + k);
      const px = x * T;
      const py = y * T;
      const neighbours = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter((t) => t === 'wreckage').length;
      if (neighbours >= 3 && r(0) < 0.5 && cars.every((c) => Math.abs(c.x - x) + Math.abs(c.y - y) > 3)) {
        cars.push({ x, y });
        continue;
      }
      const pieces = 1 + Math.floor(r(1) * 2.4);
      for (let k = 0; k < pieces; k++) {
        const cx = px + 5 + r(10 + k) * (T - 10);
        const cy = py + 5 + r(20 + k) * (T - 10);
        const rust = r(60 + k) > 0.4;
        if (r(70 + k) > 0.7) pipe(g, cx - 6, cy - 3, cx + 7, cy + 4 - r(80 + k) * 8, rust);
        else metalPlate(g, cx, cy, 6 + r(30 + k) * 9, 3 + r(40 + k) * 5, r(50 + k) * Math.PI, rust);
      }
      if (r(5) > 0.8) drawTire(g, px + 8 + r(6) * 16, py + 8 + r(7) * 16, 4);
      else if (r(5) > 0.72) drawBarrel(g, px + 8 + r(6) * 16, py + 8 + r(7) * 16, r(8));
    }
  for (const c of cars) carWreck(g, (c.x + 0.5) * T, (c.y + 0.5) * T, hash2(c.x, c.y, salt + 990) * Math.PI, hash2(c.x, c.y, salt + 991) > 0.4);
}

// ---------------------------------------------------------------------------------------------
// Ruins: cracked paving, foundation stubs and broken blocks of an old-world building.

function block(g: Ctx, x: number, y: number, w: number, h: number, height: number): void {
  g.fillStyle = 'rgba(40,25,12,0.35)';
  g.fillRect(x + height * 0.8, y + height, w, h);
  g.fillStyle = COLORS.concreteDark;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.fillRect(x, y + h - 0.5, w, height);
  g.strokeRect(x, y + h - 0.5, w, height);
  g.fillStyle = COLORS.ruinStone;
  g.fillRect(x, y, w, h);
  g.strokeRect(x, y, w, h);
  g.fillStyle = 'rgba(255,250,230,0.35)';
  g.fillRect(x + 0.5, y + 0.5, w - 1, 1.2);
}

function drawRuins(g: Ctx, view: GameView, at: TerrainAt, salt: number): void {
  for (const ruin of view.map.ruins) {
    const x = ruin.tile % view.map.width;
    const y = Math.floor(ruin.tile / view.map.width);
    if (at(x, y) !== 'ruin') continue;
    paintRuin(g, ruin.kind, x, y, salt);
  }
}

/** One ruin on tile (x, y), in terrain canvas pixels; each kind has its own look. */
export function paintRuin(g: Ctx, kind: RuinKind, x: number, y: number, salt: number): void {
  const r = (k: number) => hash2(x, y, salt + 1100 + k);
  const px = x * TILE_PX;
  const py = y * TILE_PX;
  if (kind === 'supplyPod') paintSupplyPod(g, px, py, r);
  else if (kind === 'warehouse') paintWarehouse(g, px, py, r);
  else paintFoundation(g, px, py, r);
}

/** Ordinary ruin: flagstones, a broken foundation outline, loose blocks and a column stump. */
function paintFoundation(g: Ctx, px: number, py: number, r: (k: number) => number): void {
  const T = TILE_PX;
  g.strokeStyle = 'rgba(70,58,40,0.45)';
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 1; k < 4; k++) {
    g.moveTo(px - 6 + k * 11, py - 4);
    g.lineTo(px - 6 + k * 11, py + T + 4);
    g.moveTo(px - 4, py - 6 + k * 11);
    g.lineTo(px + T + 4, py - 6 + k * 11);
  }
  g.stroke();
  // foundation outline around the footprint, broken in places
  const ox = px - T * 0.35;
  const oy = py - T * 0.35;
  const s = T * 1.7;
  const t = 4;
  const segments: [number, number, number, number][] = [
    [ox, oy, s * (0.45 + r(1) * 0.4), t],
    [ox, oy, t, s * (0.5 + r(2) * 0.5)],
    [ox + s - t, oy + s * r(3) * 0.4, t, s * 0.6],
    [ox + s * r(4) * 0.4, oy + s - t, s * 0.55, t],
  ];
  for (const [sx, sy, w, h] of segments) block(g, sx, sy, w, h, 3);
  // broken blocks and a column stump
  block(g, px + 4 + r(5) * 8, py + 6 + r(6) * 8, 7, 5, 3);
  block(g, px + 16 + r(7) * 6, py + 16 + r(8) * 6, 5, 4, 2.5);
  const cx = px + T * (0.25 + r(9) * 0.5);
  const cy = py + T * (0.25 + r(10) * 0.5);
  g.fillStyle = 'rgba(40,25,12,0.35)';
  g.beginPath();
  g.arc(cx + 3, cy + 4, 4.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.concreteDark;
  g.strokeStyle = OUTLINE;
  g.beginPath();
  g.arc(cx, cy + 2, 4.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = COLORS.ruinStone;
  g.beginPath();
  g.arc(cx, cy, 4.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,250,230,0.4)';
  g.beginPath();
  g.arc(cx - 1.2, cy - 1.2, 2, 0, Math.PI * 2);
  g.fill();
}

/** Weathered white paint of old-world hardware, and the charred heat shield. */
const POD_PAINT = '#d8d0bc';
const POD_SHIELD = '#4a2c1c';

/**
 * Supply pod: an old-world orbital capsule that came down from the upper left, ploughed a
 * scorched furrow and buried its heat shield in the sand at the bottom of a crater. White body
 * with a hazard band and a porthole, lit on its upper side, shadow to the lower right.
 */
function paintSupplyPod(g: Ctx, px: number, py: number, r: (k: number) => number): void {
  const T = TILE_PX;
  const cx = px + T * 0.5;
  const cy = py + T * 0.52;
  const a = 0.35 + r(1) * 0.4;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // furrow ploughed on the way in
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(62,48,36,0.4)';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(cx - ux * T * 1.15, cy - uy * T * 1.15);
  g.lineTo(cx - ux * T * 0.35, cy - uy * T * 0.35);
  g.stroke();
  g.strokeStyle = 'rgba(40,28,18,0.35)';
  g.lineWidth = 3;
  g.stroke();
  g.lineCap = 'butt';
  // crater: scorched bowl, inner wall in shade at the upper left, lit at the lower right, sand rim
  g.fillStyle = 'rgba(70,52,36,0.55)';
  g.beginPath();
  g.ellipse(cx, cy, T * 0.64, T * 0.52, a, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(30,20,12,0.3)';
  g.beginPath();
  g.ellipse(cx - 2, cy - 2, T * 0.5, T * 0.4, a, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,236,190,0.16)';
  g.beginPath();
  g.ellipse(cx + 3, cy + 3, T * 0.4, T * 0.3, a, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(236,214,160,0.75)';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(cx, cy, T * 0.66, T * 0.54, a, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(40,25,12,0.3)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(cx + 1, cy + 1.5, T * 0.69, T * 0.57, a, -0.2, Math.PI * 0.9);
  g.stroke();
  // debris thrown out of the crater
  metalPlate(g, cx - T * 0.55 + r(2) * 6, cy + T * 0.45, 5, 3, r(3) * Math.PI, false);
  metalPlate(g, cx + T * 0.62, cy - T * 0.38 + r(4) * 6, 4, 3, r(5) * Math.PI, true);
  // the capsule, along its axis: nose to the upper left, shield to the lower right
  const L = T * 0.86;
  const nose = T * 0.14;
  const shield = T * 0.3;
  const body = () => {
    g.beginPath();
    g.moveTo(-L / 2, -nose);
    g.lineTo(L / 2, -shield);
    g.lineTo(L / 2, shield);
    g.lineTo(-L / 2, nose);
    g.arc(-L / 2, 0, nose, Math.PI / 2, (Math.PI * 3) / 2);
    g.closePath();
  };
  g.save();
  g.translate(cx + 3, cy + 3.5);
  g.rotate(a);
  g.fillStyle = 'rgba(40,25,12,0.38)';
  body();
  g.fill();
  g.restore();
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.fillStyle = POD_PAINT;
  body();
  g.fill();
  // the lower side (away from the light) in shade
  g.fillStyle = 'rgba(60,44,30,0.28)';
  g.beginPath();
  g.moveTo(-L / 2, 0);
  g.lineTo(L / 2, 0);
  g.lineTo(L / 2, shield);
  g.lineTo(-L / 2, nose);
  g.arc(-L / 2, 0, nose, Math.PI / 2, Math.PI);
  g.closePath();
  g.fill();
  // hazard band with dark stripes
  const b0 = -L * 0.05;
  const b1 = L * 0.1;
  const half = (t: number) => nose + ((t + L / 2) / L) * (shield - nose);
  g.fillStyle = COLORS.hazard;
  g.beginPath();
  g.moveTo(b0, -half(b0));
  g.lineTo(b1, -half(b1));
  g.lineTo(b1, half(b1));
  g.lineTo(b0, half(b0));
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(26,21,16,0.75)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let k = -2; k <= 2; k++) {
    g.moveTo(b0, k * 3.4 - 1.6);
    g.lineTo(b1, k * 3.4 + 1.6);
  }
  g.stroke();
  // panel seams, scorch near the shield, porthole near the nose
  g.strokeStyle = 'rgba(26,21,16,0.45)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-L * 0.22, -half(-L * 0.22));
  g.lineTo(-L * 0.22, half(-L * 0.22));
  g.moveTo(L * 0.28, -half(L * 0.28));
  g.lineTo(L * 0.28, half(L * 0.28));
  g.stroke();
  g.strokeStyle = 'rgba(52,30,16,0.55)';
  g.lineWidth = 1.6;
  g.beginPath();
  for (const side of [-1, 1]) {
    g.moveTo(L / 2 - 1, side * shield * 0.55);
    g.lineTo(L / 2 - 8, side * shield * 0.4);
  }
  g.stroke();
  g.fillStyle = '#2a3438';
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(-L * 0.33, 0, 2.4, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(220,240,240,0.7)';
  g.beginPath();
  g.arc(-L * 0.33 - 0.8, -0.8, 0.8, 0, Math.PI * 2);
  g.fill();
  // lit upper edge, outline, charred heat shield
  g.strokeStyle = 'rgba(255,252,240,0.65)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-L / 2 + 1, -nose + 1.2);
  g.lineTo(L / 2 - 2, -shield + 1.4);
  g.stroke();
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  body();
  g.stroke();
  g.fillStyle = POD_SHIELD;
  g.beginPath();
  g.ellipse(L / 2, 0, 3, shield, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
  // sand heaped over the buried end
  const mx = cx + ux * (L / 2 + 2.5);
  const my = cy + uy * (L / 2 + 2.5);
  g.fillStyle = 'rgba(40,25,12,0.3)';
  g.beginPath();
  g.ellipse(mx + 1.5, my + 2, 5, shield + 2, a, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.sandLight;
  g.strokeStyle = 'rgba(26,21,16,0.5)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.ellipse(mx, my, 5, shield + 2, a, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,245,215,0.45)';
  g.beginPath();
  g.ellipse(mx - 1.2, my - 1.5, 2.4, shield * 0.7, a, 0, Math.PI * 2);
  g.fill();
}

/**
 * Warehouse: a heavy riveted steel door in a thick concrete frame, the warehouse number on a
 * plate above it, a hazard stripe along its foot and a vault wheel in the middle. Lit top and left
 * edges, a darker south face and a shadow to the lower right; sand drifted over one corner.
 */
function paintWarehouse(g: Ctx, px: number, py: number, r: (k: number) => number): void {
  const T = TILE_PX;
  const x0 = px - T * 0.28;
  const y0 = py - T * 0.22;
  const w = T * 1.56;
  const h = T * 1.3;
  const face = 4;
  // shadow, frame top, south face
  g.fillStyle = 'rgba(40,25,12,0.38)';
  g.fillRect(x0 + 4, y0 + 5, w, h + face);
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.fillStyle = COLORS.concreteDark;
  g.fillRect(x0, y0 + h, w, face);
  g.strokeRect(x0, y0 + h, w, face);
  g.fillStyle = COLORS.concrete;
  g.fillRect(x0, y0, w, h);
  g.strokeRect(x0, y0, w, h);
  g.fillStyle = 'rgba(255,250,230,0.4)';
  g.fillRect(x0 + 0.5, y0 + 0.5, w - 1, 1.4);
  g.fillRect(x0 + 0.5, y0 + 0.5, 1.4, h - 1);
  g.strokeStyle = 'rgba(70,58,40,0.5)';
  g.beginPath();
  g.moveTo(x0 + w * (0.7 + r(1) * 0.2), y0);
  g.lineTo(x0 + w * (0.75 + r(2) * 0.1), y0 + 5);
  g.lineTo(x0 + w * 0.8, y0 + 7);
  g.moveTo(x0, y0 + h * (0.6 + r(3) * 0.2));
  g.lineTo(x0 + 4, y0 + h * 0.7);
  g.stroke();
  // recess and the door leaf
  const dx = x0 + 6;
  const dy = y0 + 8;
  const dw = w - 12;
  const dh = h - 12;
  g.fillStyle = '#2a2622';
  g.fillRect(dx - 1, dy - 1, dw + 2, dh + 2);
  g.fillStyle = COLORS.steel;
  g.fillRect(dx + 1, dy + 1, dw - 1, dh - 1);
  g.fillStyle = COLORS.steelLight;
  g.fillRect(dx + 1, dy + 1, dw - 1, 1.2);
  g.fillRect(dx + 1, dy + 1, 1.2, dh - 1);
  g.fillStyle = COLORS.steelDark;
  g.fillRect(dx + 1, dy + dh - 1.2, dw - 1, 1.2);
  g.fillRect(dx + dw - 1.2, dy + 1, 1.2, dh - 1);
  // reinforcement ribs with rivets, rust running down from them
  g.strokeStyle = COLORS.steelDark;
  g.lineWidth = 2;
  g.beginPath();
  for (const f of [0.22, 0.5]) {
    g.moveTo(dx + 2, dy + dh * f);
    g.lineTo(dx + dw - 2, dy + dh * f);
  }
  g.stroke();
  g.strokeStyle = 'rgba(164,83,43,0.5)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const rx = dx + 4 + (k + r(4 + k) * 0.5) * (dw - 8) * 0.4;
    g.moveTo(rx, dy + dh * 0.22 + 1);
    g.lineTo(rx + 0.4, dy + dh * 0.22 + 4 + r(7 + k) * 4);
  }
  g.stroke();
  g.fillStyle = COLORS.steelLight;
  for (const f of [0.22, 0.5])
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.arc(dx + 3 + (k * (dw - 6)) / 4, dy + dh * f, 0.9, 0, Math.PI * 2);
      g.fill();
    }
  // hazard stripe along the foot of the door
  const sy = dy + dh - 6;
  g.save();
  g.beginPath();
  g.rect(dx + 1, sy, dw - 2, 4.5);
  g.clip();
  g.fillStyle = COLORS.hazard;
  g.fillRect(dx + 1, sy, dw - 2, 4.5);
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1.6;
  g.beginPath();
  for (let k = -1; k < dw / 4 + 1; k++) {
    g.moveTo(dx + k * 4, sy + 4.5);
    g.lineTo(dx + k * 4 + 4.5, sy);
  }
  g.stroke();
  g.restore();
  // vault wheel
  const wx = dx + dw / 2;
  const wy = dy + dh * 0.74 - 3;
  g.strokeStyle = OUTLINE;
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(wx, wy, 3.6, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = COLORS.steelLight;
  g.lineWidth = 1.2;
  g.stroke();
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const ang = (k * Math.PI) / 3 + r(10);
    g.moveTo(wx - Math.cos(ang) * 3.6, wy - Math.sin(ang) * 3.6);
    g.lineTo(wx + Math.cos(ang) * 3.6, wy + Math.sin(ang) * 3.6);
  }
  g.stroke();
  // door outline
  g.strokeStyle = OUTLINE;
  g.lineWidth = 1;
  g.strokeRect(dx, dy, dw, dh);
  // number plate on the frame above the door
  const nx = px + T * 0.5 - 6;
  const ny = y0 + 1.8;
  g.fillStyle = COLORS.foam;
  g.fillRect(nx, ny, 12, 4.6);
  g.strokeRect(nx, ny, 12, 4.6);
  g.strokeStyle = 'rgba(26,21,16,0.8)';
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(nx + 3, ny + 1.2);
  g.lineTo(nx + 3, ny + 3.4);
  g.moveTo(nx + 5.4, ny + 1.2);
  g.lineTo(nx + 5.4, ny + 3.4);
  g.moveTo(nx + 7.6, ny + 1.2);
  g.lineTo(nx + 9.4, ny + 1.2);
  g.lineTo(nx + 8.2, ny + 3.4);
  g.stroke();
  // sand drifted over a corner of the frame
  g.fillStyle = 'rgba(217,189,132,0.92)';
  g.beginPath();
  g.ellipse(x0 + 4 + r(11) * 4, y0 + h - 1, 7, 3.2, -0.2, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------------------------------------
// Rocks and walls: lit tops, darker south faces, soft shadows to the bottom right.

/** Small stones around the foot of rock outcrops and walls. */
function drawScree(g: Ctx, view: GameView, at: TerrainAt, salt: number): void {
  const { width, height } = view.map;
  const T = TILE_PX;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = at(x, y);
      if (t === 'rock' || t === 'wall' || t === 'water' || t === null) continue;
      let near = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        if (at(x + dx, y + dy) === 'rock' || at(x + dx, y + dy) === 'wall') near++;
      if (near === 0) continue;
      const n = 1 + Math.floor(hash2(x, y, salt + 1300) * 3);
      for (let k = 0; k < n; k++) {
        const sx = x * T + 3 + hash2(x, y, salt + 1310 + k) * (T - 6);
        const sy = y * T + 3 + hash2(x, y, salt + 1320 + k) * (T - 6);
        const rr = 1.2 + hash2(x, y, salt + 1330 + k) * 2;
        g.fillStyle = 'rgba(40,25,12,0.35)';
        g.beginPath();
        g.ellipse(sx + 1, sy + 1.4, rr, rr * 0.8, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hash2(x, y, salt + 1340 + k) > 0.5 ? COLORS.rock : COLORS.rockLight;
        g.beginPath();
        g.ellipse(sx, sy, rr, rr * 0.75, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
}

type Poly = [number, number][];

function polyPath(g: Ctx, polys: readonly Poly[], dx = 0, dy = 0): void {
  for (const p of polys) {
    p.forEach(([x, y], i) => (i === 0 ? g.moveTo(x + dx, y + dy) : g.lineTo(x + dx, y + dy)));
    g.closePath();
  }
}

/**
 * Draws extruded shapes: a soft shadow, a south face `height` px tall and a lit top. Each layer
 * is stroked with the outline and then filled, so only the outer edge of the merged shape keeps
 * an outline and neighboring tiles join into one mass.
 */
function extruded(g: Ctx, polys: readonly Poly[], height: number, top: string, side: string): void {
  const T = TILE_PX;
  g.beginPath();
  for (let k = 0; k <= 4; k++) polyPath(g, polys, 0, (height * k) / 4);
  g.save();
  g.shadowColor = 'rgba(48,30,12,0.5)';
  g.shadowBlur = T * 0.3;
  g.shadowOffsetX = T * 0.24;
  g.shadowOffsetY = T * 0.3;
  g.fillStyle = side;
  g.fill();
  g.restore();
  g.strokeStyle = COLORS.outline;
  g.lineWidth = 2.4;
  g.lineJoin = 'round';
  g.stroke();
  g.fillStyle = side;
  g.fill();
  g.beginPath();
  polyPath(g, polys);
  g.stroke();
  g.fillStyle = top;
  g.fill();
}

function rockPoly(x: number, y: number, salt: number, at: TerrainAt): Poly {
  const T = TILE_PX;
  const cx = (x + 0.5) * T + (hash2(x, y, salt + 1400) - 0.5) * 3;
  const cy = (y + 0.5) * T + (hash2(x, y, salt + 1401) - 0.5) * 3;
  const pts: Poly = [];
  const n = 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.2;
    const dx = Math.round(Math.cos(a) * 1.4);
    const dy = Math.round(Math.sin(a) * 1.4);
    const joined = at(x + dx, y + dy) === 'rock';
    const r = T * (joined ? 0.74 : 0.5 + hash2(x * 13 + k, y, salt + 1402) * 0.12);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92]);
  }
  return pts;
}

function drawRockOutcrops(g: Ctx, view: GameView, at: TerrainAt, salt: number): void {
  const { width, height } = view.map;
  const T = TILE_PX;
  const polys: Poly[] = [];
  const tiles: [number, number][] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (at(x, y) === 'rock') {
        polys.push(rockPoly(x, y, salt, at));
        tiles.push([x, y]);
      }
  if (polys.length === 0) return;
  extruded(g, polys, T * 0.3, COLORS.rock, COLORS.rockDark);
  // Lighting and facets inside the tops.
  g.save();
  g.beginPath();
  polyPath(g, polys);
  g.clip();
  for (const [x, y] of tiles) {
    const cx = (x + 0.5) * T;
    const cy = (y + 0.5) * T;
    const r = (k: number) => hash2(x, y, salt + 1450 + k);
    const hi = g.createRadialGradient(cx - T * 0.25, cy - T * 0.3, 1, cx - T * 0.2, cy - T * 0.25, T * 0.7);
    hi.addColorStop(0, 'rgba(235,215,185,0.45)');
    hi.addColorStop(1, 'rgba(235,215,185,0)');
    g.fillStyle = hi;
    g.fillRect(cx - T, cy - T, T * 2, T * 2);
    if (at(x, y + 1) !== 'rock') {
      // The south rim of the top falls away into shade: a soft band, one tile wide so a row of
      // rim tiles joins without seams.
      const rim = g.createLinearGradient(0, cy, 0, cy + T * 0.6);
      rim.addColorStop(0, 'rgba(40,28,18,0)');
      rim.addColorStop(1, 'rgba(40,28,18,0.24)');
      g.fillStyle = rim;
      g.fillRect(cx - T / 2, cy, T, T * 0.6);
    }
    // facets: a lit edge and a crack
    g.strokeStyle = 'rgba(245,230,205,0.45)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx - T * 0.3 + r(1) * 4, cy - T * 0.05);
    g.lineTo(cx - T * 0.05, cy - T * 0.3 + r(2) * 4);
    g.lineTo(cx + T * 0.22, cy - T * 0.18);
    g.stroke();
    g.strokeStyle = 'rgba(45,32,20,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - T * 0.1 + r(3) * 6, cy - T * 0.1);
    g.lineTo(cx + r(4) * 6, cy + T * 0.12);
    g.lineTo(cx + T * 0.18, cy + T * 0.2 + r(5) * 3);
    g.stroke();
  }
  g.restore();
}

function drawWalls(g: Ctx, view: GameView, at: TerrainAt, salt: number): void {
  const { width, height } = view.map;
  const T = TILE_PX;
  const thick = T * 0.42;
  const polys: Poly[] = [];
  const rebar: [number, number, number][] = [];
  const isWall = (x: number, y: number) => at(x, y) === 'wall';
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!isWall(x, y)) continue;
      const l = isWall(x - 1, y);
      const r = isWall(x + 1, y);
      const u = isWall(x, y - 1);
      const d = isWall(x, y + 1);
      const cx = (x + 0.5) * T;
      const cy = (y + 0.5) * T;
      const jag = (k: number) => (hash2(x, y, salt + 1500 + k) - 0.5) * 5;
      // Walls running diagonally: a slab from the center halfway toward each diagonal neighbor.
      let diagonal = false;
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        if (!isWall(x + dx, y + dy) || isWall(x + dx, y) || isWall(x, y + dy)) continue;
        diagonal = true;
        const ux = dx / Math.SQRT2;
        const uy = dy / Math.SQRT2;
        const nx = -uy * (thick / 2);
        const ny = ux * (thick / 2);
        const a = thick * 0.45;
        const b = T * 0.74;
        polys.push([
          [cx - ux * a + nx, cy - uy * a + ny],
          [cx + ux * b + nx, cy + uy * b + ny],
          [cx + ux * b - nx, cy + uy * b - ny],
          [cx - ux * a - nx, cy - uy * a - ny],
        ]);
      }
      if (l || r || !(u || d || diagonal)) {
        const x0 = l ? x * T - 1 : cx - T * 0.38;
        const x1 = r ? (x + 1) * T + 1 : cx + T * 0.38;
        polys.push([
          [x0, cy - thick / 2],
          [x1, cy - thick / 2 + (r ? 0 : jag(1))],
          [x1 + (r ? 0 : jag(2)), cy + thick / 2],
          [x0 + (l ? 0 : jag(3)), cy + thick / 2],
        ]);
        if (!r) rebar.push([x1, cy, 0]);
        if (!l) rebar.push([x0, cy, Math.PI]);
      }
      if (u || d) {
        const y0 = u ? y * T - 1 : cy - T * 0.38;
        const y1 = d ? (y + 1) * T + 1 : cy + T * 0.38;
        polys.push([
          [cx - thick / 2, y0],
          [cx + thick / 2 + (u ? 0 : jag(4)), y0],
          [cx + thick / 2, y1],
          [cx - thick / 2 + (d ? 0 : jag(5)), y1 + (d ? 0 : jag(6))],
        ]);
      }
    }
  if (polys.length === 0) return;
  extruded(g, polys, T * 0.36, COLORS.wall, COLORS.wallDark);
  g.save();
  g.beginPath();
  polyPath(g, polys);
  g.clip();
  for (const p of polys) {
    const [ax, ay] = p[0] as [number, number];
    const [bx, by] = p[2] as [number, number];
    g.fillStyle = 'rgba(255,250,235,0.3)';
    g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), 2);
    const k = hash2(Math.round(ax), Math.round(ay), salt + 1550);
    g.strokeStyle = 'rgba(50,45,38,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ax + (bx - ax) * k, ay);
    g.lineTo(ax + (bx - ax) * (k + 0.1), by);
    g.stroke();
    g.fillStyle = 'rgba(80,72,60,0.35)';
    g.beginPath();
    g.arc(ax + (bx - ax) * (1 - k), ay + (by - ay) * 0.5, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.strokeStyle = COLORS.rust;
  g.lineWidth = 1.3;
  g.lineCap = 'round';
  g.beginPath();
  for (const [x, y, a] of rebar) {
    g.moveTo(x, y - 3);
    g.lineTo(x + Math.cos(a) * 6, y - 7);
    g.moveTo(x, y + 2);
    g.lineTo(x + Math.cos(a) * 5, y + 1);
  }
  g.stroke();
  g.lineCap = 'butt';
}

// ---------------------------------------------------------------------------------------------

/** Animated glint positions on open water (drawn per frame by the renderer). */
export interface GlintSpot {
  x: number;
  y: number;
  phase: number;
  len: number;
}

export function waterGlintSpots(view: GameView): GlintSpot[] {
  const at = terrainGrid(view);
  const salt = seedSalt(view.options.seed);
  const spots: GlintSpot[] = [];
  for (let y = 0; y < view.map.height; y++)
    for (let x = 0; x < view.map.width; x++) {
      if (at(x, y) !== 'water') continue;
      const n = 1 + Math.floor(hash2(x, y, salt + 1600) * 2);
      for (let k = 0; k < n; k++)
        spots.push({
          x: x + 0.2 + hash2(x, y, salt + 1610 + k) * 0.6,
          y: y + 0.2 + hash2(x, y, salt + 1620 + k) * 0.6,
          phase: hash2(x, y, salt + 1630 + k) * Math.PI * 2,
          len: 0.12 + hash2(x, y, salt + 1640 + k) * 0.16,
        });
    }
  return spots;
}

/** One color per terrain for the minimap. */
export const MINIMAP_TERRAIN: Record<Terrain, [number, number, number]> = {
  wasteland: [200, 170, 115],
  fertile: [98, 72, 44],
  wreckage: [150, 108, 72],
  oil: [28, 24, 34],
  water: [58, 120, 110],
  rock: [110, 94, 76],
  wall: [150, 144, 130],
  ruin: [222, 200, 150],
};
