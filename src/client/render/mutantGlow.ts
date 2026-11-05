/**
 * What of a mutant still shows in the dark: yellow eyes with a soft glow, and the faint glow of
 * the acid sac on spitters and boomers. Drawn over the night shade, one sprite per mutant (type,
 * facing, exact zoom; see pixelSprites.ts) copied 1:1, so a horde of three hundred costs three
 * hundred cheap copies instead of a thousand small fills.
 */
import type { MutantType } from '../../sim/data/combat';
import { MUTANT_EYES } from './drawUnits';
import { createPixelSprites, type DeviceTransform } from './pixelSprites';
import { bucketAngle } from './unitPose';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export interface GlowingMutant {
  type: MutantType;
  x: number;
  y: number;
  bucket: number;
}

/** Acid sac glow: offset forward from the body center, radius (tiles). */
const ACID: Partial<Record<MutantType, { off: number; r: number }>> = {
  spitter: { off: 0.16, r: 0.36 },
  boomer: { off: 0, r: 0.52 },
};

const sprites = createPixelSprites({ maxEntries: 600, perFrame: 16 });

/** Eye glow radius and pupil size in device px. `screenPx` is device px per CSS px. */
function eyeSizes(r: number, k: number, screenPx: number): { halo: number; pupil: number } {
  return { halo: Math.max(3.2 * screenPx, 0.065 * k, r * 3 * k), pupil: Math.max(1.4 * screenPx, 0.026 * k, r * 1.6 * k) };
}

function reach(type: MutantType, k: number, screenPx: number): number {
  let out = 0;
  for (const eye of MUTANT_EYES[type]) out = Math.max(out, Math.hypot(eye.x, eye.y) * k + eyeSizes(eye.r, k, screenPx).halo);
  const acid = ACID[type];
  if (acid) out = Math.max(out, (acid.off + acid.r) * k);
  return Math.ceil(out) + 1;
}

function paintGlow(g: Ctx, side: number, type: MutantType, bucket: number, k: number, screenPx: number): void {
  const a = bucketAngle(bucket);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const c = side / 2;
  const soft = (x: number, y: number, r: number, rgb: string, alpha: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(0.45, `rgba(${rgb},${alpha * 0.5})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const acid = ACID[type];
  if (acid) soft(c + cos * acid.off * k, c + sin * acid.off * k, acid.r * k, '184,240,74', 0.32);
  for (const eye of MUTANT_EYES[type]) {
    const x = c + (eye.x * cos - eye.y * sin) * k;
    const y = c + (eye.x * sin + eye.y * cos) * k;
    const { halo, pupil } = eyeSizes(eye.r, k, screenPx);
    soft(x, y, halo, '255,206,64', 0.5);
    g.fillStyle = 'rgb(255,236,150)';
    g.beginPath();
    g.arc(x, y, pupil / 2, 0, TAU);
    g.fill();
  }
}

/**
 * Draws the glow of every mutant in `units`, the context in device pixels (identity transform).
 * `night` (0..1) fades it in; `screenPx` is device px per CSS px.
 */
export function drawMutantGlow(g: Ctx, t: DeviceTransform, units: readonly GlowingMutant[], night: number, screenPx: number): void {
  sprites.beginFrame();
  g.globalAlpha = Math.min(1, night * 1.15);
  const zoomKey = Math.round(t.k * 100);
  const sides = new Map<MutantType, number>();
  for (const u of units) {
    let side = sides.get(u.type);
    if (side === undefined) {
      side = reach(u.type, t.k, screenPx) * 2;
      sides.set(u.type, side);
    }
    const w = side;
    const sprite = sprites.get(`${u.type}:${u.bucket}:${zoomKey}:${screenPx}`, w, w, (c) => paintGlow(c, w, u.type, u.bucket, t.k, screenPx));
    const cx = u.x * t.k + t.ox;
    const cy = u.y * t.k + t.oy;
    if (sprite) {
      g.drawImage(sprite, Math.round(cx - side / 2), Math.round(cy - side / 2));
      continue;
    }
    // Not painted yet (budget spent this frame): just the pupils.
    const a = bucketAngle(u.bucket);
    g.fillStyle = 'rgb(255,236,150)';
    for (const eye of MUTANT_EYES[u.type]) {
      const s = eyeSizes(eye.r, t.k, screenPx).pupil;
      g.fillRect(cx + (eye.x * Math.cos(a) - eye.y * Math.sin(a)) * t.k - s / 2, cy + (eye.x * Math.sin(a) + eye.y * Math.cos(a)) * t.k - s / 2, s, s);
    }
  }
  g.globalAlpha = 1;
}
