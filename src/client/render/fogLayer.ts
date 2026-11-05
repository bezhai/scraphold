/**
 * Fog of war as a small map-aligned image (FOG_PX pixels per tile) stretched over the world with
 * smoothing (painted into the shared low-resolution shade layer, see lighting.ts). Per-tile levels fade in and out (fogField.ts) and are blurred before sampling, with a
 * little noise on the edge, so the fog has soft organic borders and no tile steps. Never-explored
 * ground is near-black with a slowly drifting mist; explored ground out of sight is covered by a
 * translucent cold grey that darkens and desaturates it while keeping terrain and remembered
 * buildings readable. Only the tiles whose levels changed are recomputed; fog and mist are composed
 * into one image (when the fog changed, and every few frames for the slow drift), so the shade
 * layer draws a single image.
 */
import { nightType, type GameView } from '../../sim';
import { createFogLevels, easeFogLevels, type FogLevels } from './fogField';
import { hash2, noiseGrid, sampleNoise, seedSalt } from './noise';
import { blurTiles, sampleBilinear } from './tileField';

const FOG_PX = 4;
/** Never explored: near-black. */
const UNEXPLORED = { r: 11, g: 11, b: 15, a: 0.95 };
/** Explored, out of sight: cold grey over the terrain (mixing toward grey desaturates). */
const MEMORY = { r: 52, g: 56, b: 70, a: 0.52 };
/** Mist drift in fog pixels per ms, two layers. */
const DRIFT = [
  { x: 0.0021, y: 0.0009, alpha: 0.34 },
  { x: -0.0013, y: 0.0016, alpha: 0.24 },
];
const MIST_TILE = 128;
/** The mist drifts a fraction of a pixel per frame: recomposing it every few frames looks the same. */
const MIST_EVERY_FRAMES = 4;
/** Fading tiles are re-rasterized at most every other frame (a 280 ms fade still looks smooth). */
const REBUILD_EVERY_FRAMES = 2;

export interface FogLayer {
  /** Advances the fade and draws the fog in world tiles into `g` (its transform maps tiles to pixels). */
  paint(g: CanvasRenderingContext2D, view: GameView, now: number): void;
}

/** A tileable mist texture: light wisps of value noise with wrap-around. */
function mistTexture(makeCanvas: (w: number, h: number) => HTMLCanvasElement, salt: number): HTMLCanvasElement {
  const c = makeCanvas(MIST_TILE, MIST_TILE);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(MIST_TILE, MIST_TILE);
  const cells = [8, 16];
  for (let y = 0; y < MIST_TILE; y++)
    for (let x = 0; x < MIST_TILE; x++) {
      let v = 0;
      cells.forEach((n, k) => {
        const cell = MIST_TILE / n;
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const h = (ix: number, iy: number) => hash2(((ix % n) + n) % n, ((iy % n) + n) % n, salt + k);
        const a = h(x0, y0);
        const b = h(x0 + 1, y0);
        const cc = h(x0, y0 + 1);
        const d = h(x0 + 1, y0 + 1);
        v += (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy) * (k === 0 ? 0.65 : 0.35);
      });
      const wisp = Math.max(0, (v - 0.45) * 2.2);
      const i = (y * MIST_TILE + x) * 4;
      img.data[i] = 150;
      img.data[i + 1] = 146;
      img.data[i + 2] = 165;
      img.data[i + 3] = Math.min(255, wisp * wisp * 160);
    }
  g.putImageData(img, 0, 0);
  return c;
}

export function createFogLayer(view: GameView, makeCanvas: (w: number, h: number) => HTMLCanvasElement): FogLayer {
  const { width, height } = view.map;
  const W = width * FOG_PX;
  const H = height * FOG_PX;
  const salt = seedSalt(view.options.seed);
  const base = makeCanvas(W, H);
  const baseCtx = base.getContext('2d') as CanvasRenderingContext2D;
  const baseImg = baseCtx.createImageData(W, H);
  const mask = makeCanvas(W, H);
  const maskCtx = mask.getContext('2d') as CanvasRenderingContext2D;
  const maskImg = maskCtx.createImageData(W, H);
  const scratch = makeCanvas(W, H);
  const scratchCtx = scratch.getContext('2d') as CanvasRenderingContext2D;
  const mist = scratchCtx.createPattern(mistTexture(makeCanvas, salt), 'repeat');
  const edge = noiseGrid(W, H, FOG_PX * 1.2, salt + 77);
  const edgeNoise = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) edgeNoise[y * W + x] = sampleNoise(edge, x, y) - 0.5;
  const levels: FogLevels = createFogLevels(view.fog);
  const unexplored = new Float32Array(width * height);
  const memory = new Float32Array(width * height);
  const unexploredSoft = new Float32Array(width * height);
  const memorySoft = new Float32Array(width * height);
  let last = -1;
  let frames = 0;
  let pendingDt = 0;
  /** The fog changed since `scratch` was composed. */
  let stale = true;

  function rebuild(x0: number, y0: number, x1: number, y1: number): void {
    for (let i = 0; i < width * height; i++) {
      const e = levels.explored[i] as number;
      unexplored[i] = 1 - e;
      memory[i] = e * (1 - (levels.visible[i] as number));
    }
    blurTiles(unexplored, width, height, unexploredSoft);
    blurTiles(memory, width, height, memorySoft);
    const px0 = Math.max(0, (x0 - 2) * FOG_PX);
    const py0 = Math.max(0, (y0 - 2) * FOG_PX);
    const px1 = Math.min(W, (x1 + 3) * FOG_PX);
    const py1 = Math.min(H, (y1 + 3) * FOG_PX);
    const d = baseImg.data;
    const m = maskImg.data;
    const isDense = levels.visible.length > 0 && lastDenseFog;
    const memAlpha = isDense ? 0.75 : MEMORY.a;
    for (let py = py0; py < py1; py++) {
      const ty = (py + 0.5) / FOG_PX;
      for (let px = px0; px < px1; px++) {
        const tx = (px + 0.5) / FOG_PX;
        // Noise roughens the edges only; the inside of each region stays even.
        const n = edgeNoise[py * W + px] as number;
        const su = sampleBilinear(unexploredSoft, width, height, tx, ty);
        const u = Math.min(1, Math.max(0, (su + n * 1.4 * su * (1 - su) - 0.08) * 1.25));
        const au = u * u * (3 - 2 * u) * UNEXPLORED.a;
        const sm = sampleBilinear(memorySoft, width, height, tx, ty);
        const mm = Math.min(1, Math.max(0, sm + n * 1.2 * sm * (1 - sm)));
        const am = mm * memAlpha * (1 - au);
        const a = au + am;
        const i = (py * W + px) * 4;
        if (a <= 0.002) {
          d[i + 3] = 0;
          m[i + 3] = 0;
          continue;
        }
        d[i] = (UNEXPLORED.r * au + MEMORY.r * am) / a;
        d[i + 1] = (UNEXPLORED.g * au + MEMORY.g * am) / a;
        d[i + 2] = (UNEXPLORED.b * au + MEMORY.b * am) / a;
        d[i + 3] = a * 255;
        m[i + 3] = au * 255;
      }
    }
    baseCtx.putImageData(baseImg, 0, 0, px0, py0, px1 - px0, py1 - py0);
    maskCtx.putImageData(maskImg, 0, 0, px0, py0, px1 - px0, py1 - py0);
  }

  let lastDenseFog = false;
  rebuild(0, 0, width - 1, height - 1);

  return {
    paint(g, v, now) {
      pendingDt += last < 0 ? 0 : Math.min(100, now - last);
      last = now;
      const isDense = v.clock.phase === 'night' && nightType(v) === 'denseFog';
      if (isDense !== lastDenseFog) {
        lastDenseFog = isDense;
        rebuild(0, 0, width - 1, height - 1);
        stale = true;
      }
      const frame = frames++;
      if (frame % REBUILD_EVERY_FRAMES === 0) {
        const changed = easeFogLevels(levels, v.fog, width, pendingDt);
        pendingDt = 0;
        if (changed) {
          rebuild(changed.x0, changed.y0, changed.x1, changed.y1);
          stale = true;
        }
      }
      if (stale || frame % MIST_EVERY_FRAMES === 0) {
        compose(now);
        stale = false;
      }
      g.drawImage(scratch, 0, 0, width, height);
    },
  };

  /** Into `scratch`: two drifting mist layers kept only where the ground is unexplored, over the fog. */
  function compose(now: number): void {
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.clearRect(0, 0, W, H);
    for (const layer of DRIFT) {
      if (!mist) break;
      const ox = (now * layer.x) % MIST_TILE;
      const oy = (now * layer.y) % MIST_TILE;
      scratchCtx.save();
      scratchCtx.globalAlpha = layer.alpha;
      scratchCtx.translate(ox, oy);
      scratchCtx.fillStyle = mist;
      scratchCtx.fillRect(-ox, -oy, W, H);
      scratchCtx.restore();
    }
    scratchCtx.globalCompositeOperation = 'destination-in';
    scratchCtx.drawImage(mask, 0, 0);
    scratchCtx.globalCompositeOperation = 'destination-over';
    scratchCtx.drawImage(base, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
  }
}
