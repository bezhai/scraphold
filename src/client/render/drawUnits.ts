/**
 * Procedural unit art in tile units, centered on the unit and facing +x; unitSprites.ts rotates
 * and caches it. Every part has the shared dark outline, round parts get a highlight toward the
 * light (top-left on screen, passed in local coordinates), and silhouettes differ by shape, not
 * color: the shield guard's big curved shield, the rifleman's standard rifle, the sniper's very
 * long scoped rifle and shaggy hood, the grenadier's ammo pack and stubby drum launcher, the
 * scout's long thin motorbike, the flamethrower's twin tanks and lit nozzle, and the pickup's cab,
 * bed and mounted gun. Player units wear teal helmets and shoulder pads. Mutants: the hunched
 * wanderer with dangling arms, the thin four-legged runner, the plated crawler, the spitter's
 * swollen glowing throat sac, the boomer's glowing flesh ball, the huge tusked, spiked behemoth.
 */
import type { MutantType, SoldierType } from '../../sim/data/combat';
import { COLORS } from './palette';

type Ctx = CanvasRenderingContext2D;

export type UnitFrame = 'idle' | 'stepA' | 'stepB' | 'recoil' | 'dead';

export interface UnitPen {
  g: Ctx;
  /** Outline width in tiles. */
  ol: number;
  /** Unit vector toward the light, in the unit's local (rotated) coordinates. */
  lx: number;
  ly: number;
}

const TAU = Math.PI * 2;

function shape(p: UnitPen, fill: string, path: (g: Ctx) => void): void {
  const g = p.g;
  g.beginPath();
  path(g);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = p.ol;
  g.strokeStyle = COLORS.outline;
  g.lineJoin = 'round';
  g.stroke();
}

const ellipse = (x: number, y: number, rx: number, ry: number, rot = 0) => (g: Ctx) => g.ellipse(x, y, rx, ry, rot, 0, TAU);
const circle = (x: number, y: number, r: number) => (g: Ctx) => g.arc(x, y, r, 0, TAU);
const box = (x: number, y: number, w: number, h: number, r = 0) => (g: Ctx) => (r > 0 ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));

/** A soft highlight on a round part, offset toward the light. */
function highlight(p: UnitPen, x: number, y: number, r: number, alpha = 0.35): void {
  const g = p.g;
  g.fillStyle = `rgba(255,248,225,${alpha})`;
  g.beginPath();
  g.ellipse(x + p.lx * r * 0.35, y + p.ly * r * 0.35, r * 0.5, r * 0.38, Math.atan2(p.ly, p.lx), 0, TAU);
  g.fill();
}

function feet(p: UnitPen, frame: UnitFrame, spread = 0.11, color = '#2c241b'): void {
  const fwd = frame === 'stepA' ? [0.15, -0.1] : frame === 'stepB' ? [-0.1, 0.15] : [0.04, 0.04];
  shape(p, color, ellipse(fwd[0] as number, -spread, 0.075, 0.05));
  shape(p, color, ellipse(fwd[1] as number, spread, 0.075, 0.05));
}

function helmet(p: UnitPen, x = 0.0, r = 0.145): void {
  shape(p, COLORS.tealDark, circle(x + 0.012, 0, r));
  shape(p, COLORS.teal, circle(x - 0.008, 0, r * 0.8));
  highlight(p, x - 0.008, 0, r * 0.8, 0.55);
}

function shoulders(p: UnitPen, uniform: string, rx = 0.15, ry = 0.27): void {
  shape(p, uniform, ellipse(0, 0, rx, ry));
  highlight(p, 0, 0, Math.min(rx, ry) * 1.4, 0.18);
  // teal shoulder straps: the side's identity color on every soldier
  const g = p.g;
  g.strokeStyle = COLORS.teal;
  g.lineWidth = 0.045;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-0.11, -ry * 0.62);
  g.lineTo(0.08, -ry * 0.5);
  g.moveTo(-0.11, ry * 0.62);
  g.lineTo(0.08, ry * 0.5);
  g.stroke();
  g.lineCap = 'butt';
}

function hand(p: UnitPen, x: number, y: number): void {
  shape(p, COLORS.skin, circle(x, y, 0.042));
}

/** Both arms reaching from the shoulders to the grip points of a weapon. */
function arms(p: UnitPen, sleeve: string, front: [number, number], rear: [number, number]): void {
  limb(p, [[0.02, -0.22], [front[0] * 0.6, front[1] - 0.1], front], 0.065, sleeve);
  limb(p, [[0.0, 0.22], [rear[0] * 0.5, rear[1] + 0.06], rear], 0.065, sleeve);
  hand(p, front[0], front[1]);
  hand(p, rear[0], rear[1]);
}

function gun(p: UnitPen, from: number, to: number, y: number, w: number, color = '#2a2622'): void {
  shape(p, color, box(from, y - w / 2, to - from, w, w * 0.3));
}

function infantry(p: UnitPen, frame: UnitFrame, uniform: string, back: () => void, weapon: () => void, head: () => void): void {
  feet(p, frame);
  back();
  shoulders(p, uniform);
  weapon();
  head();
}

function paintShieldGuard(p: UnitPen, frame: UnitFrame): void {
  feet(p, frame, 0.12);
  // short blade at the hip
  gun(p, -0.05, 0.28, 0.22, 0.05, '#8d9496');
  shoulders(p, COLORS.steelDark, 0.17, 0.29);
  shape(p, COLORS.steel, ellipse(-0.02, 0, 0.1, 0.17));
  limb(p, [[0.02, -0.24], [0.18, -0.2], [0.27, -0.12]], 0.075, COLORS.steelDark);
  helmet(p, -0.03, 0.15);
  // a big riot shield across the front, wider than the body
  const g = p.g;
  shape(p, COLORS.steelLight, (gg) => {
    gg.moveTo(0.27, -0.44);
    gg.quadraticCurveTo(0.4, 0, 0.27, 0.44);
    gg.lineTo(0.39, 0.44);
    gg.quadraticCurveTo(0.52, 0, 0.39, -0.44);
    gg.closePath();
  });
  // viewport slit and teal band
  g.fillStyle = '#2a3236';
  g.fillRect(0.355, -0.1, 0.05, 0.2);
  g.strokeStyle = COLORS.teal;
  g.lineWidth = 0.05;
  g.beginPath();
  g.moveTo(0.33, -0.3);
  g.quadraticCurveTo(0.4, -0.22, 0.43, -0.16);
  g.moveTo(0.33, 0.3);
  g.quadraticCurveTo(0.4, 0.22, 0.43, 0.16);
  g.stroke();
  g.strokeStyle = 'rgba(255,250,235,0.6)';
  g.lineWidth = 0.025;
  g.beginPath();
  g.moveTo(0.3, -0.38);
  g.quadraticCurveTo(0.41, -0.05, 0.36, 0.1);
  g.stroke();
}

function paintRifleman(p: UnitPen, frame: UnitFrame): void {
  infantry(
    p,
    frame,
    COLORS.olive,
    () => shape(p, COLORS.khakiDark, ellipse(-0.17, 0, 0.09, 0.16)),
    () => {
      gun(p, -0.04, 0.58, 0.07, 0.07);
      gun(p, -0.06, 0.13, 0.07, 0.09, COLORS.woodDark);
      shape(p, '#3a352e', box(0.2, 0.09, 0.06, 0.08));
      arms(p, COLORS.olive, [0.32, 0.07], [0.1, 0.1]);
    },
    () => helmet(p),
  );
}

function paintSniper(p: UnitPen, frame: UnitFrame): void {
  feet(p, frame);
  // shaggy ghillie cloak: a jagged outline that no other soldier has
  shape(p, '#55603a', (g) => {
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      const r = k % 2 === 0 ? 0.33 : 0.26;
      const x = Math.cos(a) * r * 0.75 - 0.04;
      const y = Math.sin(a) * r;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  });
  // very long rifle with scope and muzzle brake
  gun(p, -0.08, 0.88, 0.06, 0.055);
  shape(p, '#1c1a17', box(0.82, 0.03, 0.07, 0.06));
  shape(p, '#3b3833', box(0.14, -0.005, 0.22, 0.07, 0.02));
  shape(p, 'rgba(140,210,230,0.95)', circle(0.36, 0.03, 0.025));
  arms(p, '#55603a', [0.42, 0.06], [0.12, 0.09]);
  // hooded head with a teal band
  shape(p, '#47522f', circle(0.0, 0, 0.13));
  p.g.strokeStyle = COLORS.teal;
  p.g.lineWidth = 0.04;
  p.g.beginPath();
  p.g.arc(0, 0, 0.1, -1.2, 1.2);
  p.g.stroke();
}

function paintGrenadier(p: UnitPen, frame: UnitFrame): void {
  infantry(
    p,
    frame,
    COLORS.olive,
    () => {
      // big boxy ammo pack with grenades
      shape(p, COLORS.pack, box(-0.36, -0.2, 0.22, 0.4, 0.05));
      for (const y of [-0.11, 0, 0.11]) shape(p, '#6c7a3a', circle(-0.25, y, 0.045));
    },
    () => {
      // short, chunky launcher with a drum
      gun(p, 0.0, 0.46, 0.07, 0.15, '#34302a');
      shape(p, '#1d1b18', box(0.4, -0.01, 0.07, 0.16, 0.02));
      shape(p, '#4a4438', circle(0.14, 0.07, 0.09));
      arms(p, COLORS.olive, [0.32, 0.0], [0.08, 0.16]);
      // bandolier
      p.g.strokeStyle = COLORS.rust;
      p.g.lineWidth = 0.05;
      p.g.beginPath();
      p.g.moveTo(-0.1, -0.24);
      p.g.lineTo(0.08, 0.2);
      p.g.stroke();
    },
    () => helmet(p),
  );
}

function paintFlamethrower(p: UnitPen, frame: UnitFrame): void {
  infantry(
    p,
    frame,
    '#7b6a42',
    () => {
      // twin fuel tanks on the back, hazard banded
      for (const y of [-0.1, 0.1]) {
        shape(p, '#b8442c', ellipse(-0.25, y, 0.12, 0.085));
        p.g.fillStyle = COLORS.hazard;
        p.g.fillRect(-0.27, y - 0.085, 0.04, 0.17);
        highlight(p, -0.25, y, 0.09, 0.4);
      }
      p.g.strokeStyle = '#23201c';
      p.g.lineWidth = 0.035;
      p.g.beginPath();
      p.g.moveTo(-0.2, 0.12);
      p.g.quadraticCurveTo(0, 0.24, 0.12, 0.1);
      p.g.stroke();
    },
    () => {
      gun(p, 0.02, 0.44, 0.08, 0.07, '#3a352d');
      shape(p, '#2a2622', (g) => {
        g.moveTo(0.42, 0.04);
        g.lineTo(0.52, 0.01);
        g.lineTo(0.52, 0.15);
        g.lineTo(0.42, 0.12);
        g.closePath();
      });
      // pilot flame
      p.g.fillStyle = 'rgba(255,140,40,0.95)';
      p.g.beginPath();
      p.g.ellipse(0.57, 0.08, 0.06, 0.04, 0, 0, TAU);
      p.g.fill();
      p.g.fillStyle = 'rgba(255,236,150,1)';
      p.g.beginPath();
      p.g.arc(0.555, 0.08, 0.022, 0, TAU);
      p.g.fill();
      arms(p, '#7b6a42', [0.3, 0.08], [0.1, 0.1]);
    },
    () => {
      helmet(p);
      // gas mask
      shape(p, '#2e2b26', ellipse(0.11, 0, 0.04, 0.06));
    },
  );
}

function paintScout(p: UnitPen, frame: UnitFrame): void {
  const g = p.g;
  const moving = frame === 'stepA' || frame === 'stepB';
  if (moving) {
    g.fillStyle = 'rgba(200,175,130,0.35)';
    g.beginPath();
    g.ellipse(-0.62, frame === 'stepA' ? 0.03 : -0.03, 0.14, 0.09, 0, 0, TAU);
    g.fill();
  }
  // wheels, long thin frame, tank, handlebar
  shape(p, '#1d1b18', box(0.32, -0.05, 0.22, 0.1, 0.04));
  shape(p, '#1d1b18', box(-0.54, -0.06, 0.24, 0.12, 0.04));
  shape(p, COLORS.rust, box(-0.4, -0.085, 0.78, 0.17, 0.07));
  shape(p, COLORS.rustLight, ellipse(0.12, 0, 0.1, 0.075));
  highlight(p, 0.12, 0, 0.08, 0.45);
  g.strokeStyle = COLORS.outline;
  g.lineWidth = 0.045;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0.27, -0.21);
  g.lineTo(0.27, 0.21);
  g.stroke();
  g.lineCap = 'butt';
  shape(p, '#fff2b0', circle(0.42, 0, 0.035));
  // rider
  shape(p, COLORS.olive, ellipse(-0.06, 0, 0.13, 0.2));
  limb(p, [[-0.04, -0.17], [0.12, -0.2], [0.25, -0.18]], 0.06, COLORS.olive);
  limb(p, [[-0.04, 0.17], [0.12, 0.2], [0.25, 0.18]], 0.06, COLORS.olive);
  hand(p, 0.25, -0.18);
  hand(p, 0.25, 0.18);
  helmet(p, -0.05, 0.125);
}

function paintPickup(p: UnitPen, frame: UnitFrame): void {
  const g = p.g;
  const moving = frame === 'stepA' || frame === 'stepB';
  if (moving) {
    g.fillStyle = 'rgba(200,175,130,0.32)';
    for (const y of [-0.26, 0.26]) {
      g.beginPath();
      g.ellipse(-0.68, y + (frame === 'stepA' ? 0.02 : -0.02), 0.13, 0.08, 0, 0, TAU);
      g.fill();
    }
  }
  // wheels
  for (const [x, y] of [
    [-0.36, -0.34],
    [-0.36, 0.34],
    [0.34, -0.34],
    [0.34, 0.34],
  ] as const)
    shape(p, '#1a1816', box(x - 0.12, y - 0.06, 0.24, 0.12, 0.03));
  // body
  shape(p, '#7a5a34', box(-0.58, -0.33, 1.16, 0.66, 0.1));
  // hood with teal stripe
  shape(p, '#8a6a40', box(0.26, -0.29, 0.29, 0.58, 0.08));
  g.fillStyle = COLORS.teal;
  g.fillRect(0.3, -0.06, 0.24, 0.12);
  // cab roof and windshield
  shape(p, '#5c4326', box(-0.06, -0.28, 0.32, 0.56, 0.06));
  shape(p, 'rgba(150,200,210,0.9)', box(0.2, -0.24, 0.06, 0.48, 0.02));
  highlight(p, 0.1, 0, 0.25, 0.25);
  // bed with mounted machine gun
  shape(p, '#4b3820', box(-0.55, -0.28, 0.46, 0.56, 0.04));
  shape(p, '#3a3a36', circle(-0.3, 0, 0.13));
  gun(p, -0.3, 0.22, 0, 0.065, '#1d1c1a');
  shape(p, '#2a2826', box(-0.1, -0.05, 0.1, 0.1, 0.02));
  highlight(p, -0.3, 0, 0.12, 0.4);
}

function paintSurvivorBody(p: UnitPen, frame: UnitFrame): void {
  feet(p, frame, 0.09);
  shape(p, COLORS.pack, ellipse(-0.15, 0, 0.09, 0.14));
  shape(p, COLORS.canvas, ellipse(0, 0, 0.14, 0.23));
  highlight(p, 0, 0, 0.18, 0.2);
  // teal scarf: the player's side
  shape(p, COLORS.teal, ellipse(0.02, 0, 0.07, 0.15));
  shape(p, COLORS.skin, circle(0.05, 0, 0.1));
  shape(p, '#6b4b2c', (g) => g.arc(0.03, 0, 0.1, Math.PI * 0.55, Math.PI * 1.45));
  hand(p, 0.12, -0.19);
  hand(p, 0.12, 0.19);
}

export function paintSoldier(p: UnitPen, type: SoldierType, frame: UnitFrame): void {
  const g = p.g;
  g.save();
  if (frame === 'recoil') g.translate(-0.045, 0);
  switch (type) {
    case 'shieldGuard':
      paintShieldGuard(p, frame);
      break;
    case 'rifleman':
      paintRifleman(p, frame);
      break;
    case 'sniper':
      paintSniper(p, frame);
      break;
    case 'grenadier':
      paintGrenadier(p, frame);
      break;
    case 'scout':
      paintScout(p, frame);
      break;
    case 'flamethrower':
      paintFlamethrower(p, frame);
      break;
    case 'pickup':
      paintPickup(p, frame);
      break;
  }
  g.restore();
}

export function paintSurvivor(p: UnitPen, frame: UnitFrame): void {
  paintSurvivorBody(p, frame);
}

// ---------------------------------------------------------------------------------------------
// Mutants

function eyes(p: UnitPen, list: readonly MutantEye[]): void {
  for (const e of list) {
    p.g.fillStyle = COLORS.eye;
    p.g.beginPath();
    p.g.arc(e.x, e.y, e.r, 0, TAU);
    p.g.fill();
  }
}

/** Arms or legs as thick round-capped strokes with an outline. */
function limb(p: UnitPen, pts: readonly (readonly [number, number])[], w: number, color: string): void {
  const g = p.g;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.strokeStyle = COLORS.outline;
  g.lineWidth = w + p.ol * 2;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  g.lineCap = 'butt';
}

const swing = (frame: UnitFrame, amount: number) => (frame === 'stepA' ? amount : frame === 'stepB' ? -amount : 0);

function paintWanderer(p: UnitPen, frame: UnitFrame): void {
  const s = swing(frame, 0.08);
  const lunge = frame === 'recoil' ? 0.08 : 0;
  // long dangling arms reaching forward
  limb(p, [[0.04, -0.22], [0.24 + s + lunge, -0.27], [0.4 + s + lunge, -0.2]], 0.075, COLORS.flesh);
  limb(p, [[0.04, 0.22], [0.24 - s + lunge, 0.27], [0.4 - s + lunge, 0.2]], 0.075, COLORS.flesh);
  for (const y of [-1, 1]) {
    const hx = 0.42 + (y < 0 ? s : -s) + lunge;
    shape(p, COLORS.fleshDark, circle(hx, 0.2 * y, 0.05));
  }
  // hunched torso with a spine ridge
  shape(p, COLORS.flesh, ellipse(-0.04, 0, 0.21, 0.26));
  highlight(p, -0.04, 0, 0.22, 0.22);
  p.g.fillStyle = COLORS.fleshDark;
  for (let k = 0; k < 4; k++) {
    p.g.beginPath();
    p.g.arc(-0.2 + k * 0.08, 0, 0.03, 0, TAU);
    p.g.fill();
  }
  // low, forward head
  shape(p, COLORS.fleshLight, circle(0.17 + lunge * 0.5, 0, 0.1));
  eyes(p, MUTANT_EYES.wanderer.map((e) => ({ ...e, x: e.x + lunge * 0.5 })));
}

function paintRunner(p: UnitPen, frame: UnitFrame): void {
  const s = swing(frame, 0.09);
  const lunge = frame === 'recoil' ? 0.08 : 0;
  // four thin limbs splayed like a spider, alternating
  limb(p, [[0.1, -0.06], [0.2 + s, -0.2], [0.32 + s, -0.22]], 0.045, COLORS.fleshDark);
  limb(p, [[0.1, 0.06], [0.2 - s, 0.2], [0.32 - s, 0.22]], 0.045, COLORS.fleshDark);
  limb(p, [[-0.12, -0.06], [-0.22 - s, -0.19], [-0.33 - s, -0.17]], 0.045, COLORS.fleshDark);
  limb(p, [[-0.12, 0.06], [-0.22 + s, 0.19], [-0.33 + s, 0.17]], 0.045, COLORS.fleshDark);
  // lean elongated body and a long narrow head
  shape(p, COLORS.fleshLight, ellipse(lunge * 0.5, 0, 0.25, 0.1));
  shape(p, COLORS.flesh, ellipse(0.27 + lunge, 0, 0.1, 0.065));
  highlight(p, 0, 0, 0.12, 0.25);
  // spine spikes
  shape(p, COLORS.fleshDark, (g) => {
    for (let k = 0; k < 3; k++) {
      const x = -0.16 + k * 0.1;
      g.moveTo(x, -0.02);
      g.lineTo(x - 0.06, 0);
      g.lineTo(x, 0.02);
      g.closePath();
    }
  });
  eyes(p, MUTANT_EYES.runner.map((e) => ({ ...e, x: e.x + lunge })));
}

function paintCrawler(p: UnitPen, frame: UnitFrame): void {
  const s = swing(frame, 0.05);
  const lunge = frame === 'recoil' ? 0.06 : 0;
  // short legs along the sides
  for (const k of [-1, 0, 1]) {
    const o = k === 0 ? s : -s;
    limb(p, [[0.12 * k, -0.3], [0.12 * k + 0.06 + o, -0.47]], 0.06, COLORS.fleshDark);
    limb(p, [[0.12 * k, 0.3], [0.12 * k + 0.06 - o, 0.47]], 0.06, COLORS.fleshDark);
  }
  // mandibles
  limb(p, [[0.36, -0.12], [0.55 + lunge, -0.14], [0.6 + lunge, -0.04]], 0.05, COLORS.bone);
  limb(p, [[0.36, 0.12], [0.55 + lunge, 0.14], [0.6 + lunge, 0.04]], 0.05, COLORS.bone);
  // underbody, then overlapping shell plates back to front
  shape(p, COLORS.fleshDark, ellipse(0, 0, 0.48, 0.38));
  for (let k = 0; k < 4; k++) {
    const x = -0.3 + k * 0.17;
    const ry = 0.36 - Math.abs(k - 1.4) * 0.05;
    shape(p, k % 2 === 0 ? COLORS.chitin : COLORS.chitinLight, ellipse(x, 0, 0.15, ry));
    p.g.strokeStyle = 'rgba(255,230,240,0.3)';
    p.g.lineWidth = 0.025;
    p.g.beginPath();
    p.g.ellipse(x, 0, 0.11, ry * 0.8, 0, Math.PI * 1.1, Math.PI * 1.6);
    p.g.stroke();
  }
  shape(p, COLORS.flesh, ellipse(0.36 + lunge * 0.5, 0, 0.1, 0.15));
  eyes(p, MUTANT_EYES.crawler);
}

function paintSpitter(p: UnitPen, frame: UnitFrame): void {
  const swell = frame === 'stepA' ? 1.06 : frame === 'stepB' ? 0.96 : frame === 'recoil' ? 1.12 : 1;
  limb(p, [[0.02, -0.26], [0.14, -0.33]], 0.06, COLORS.flesh);
  limb(p, [[0.02, 0.26], [0.14, 0.33]], 0.06, COLORS.flesh);
  shape(p, COLORS.flesh, ellipse(-0.1, 0, 0.25, 0.29));
  highlight(p, -0.1, 0, 0.25, 0.2);
  // bulging, glowing throat sac
  const r = 0.18 * swell;
  shape(p, COLORS.acid, circle(0.16, 0, r));
  p.g.strokeStyle = COLORS.acidDark;
  p.g.lineWidth = 0.022;
  p.g.beginPath();
  p.g.moveTo(0.06, -0.08);
  p.g.quadraticCurveTo(0.16, -0.02, 0.26, -0.1);
  p.g.moveTo(0.05, 0.06);
  p.g.quadraticCurveTo(0.18, 0.04, 0.27, 0.11);
  p.g.stroke();
  highlight(p, 0.16, 0, r, 0.55);
  shape(p, COLORS.fleshDark, circle(0.36, 0, 0.075));
  eyes(p, MUTANT_EYES.spitter);
}

function paintBoomer(p: UnitPen, frame: UnitFrame): void {
  const swell = frame === 'stepA' ? 1.05 : frame === 'stepB' ? 0.97 : 1;
  const s = swing(frame, 0.04);
  for (const y of [-1, 1]) limb(p, [[-0.1, 0.3 * y], [-0.04 + s * y, 0.44 * y]], 0.07, COLORS.fleshDark);
  const R = 0.42 * swell;
  shape(p, COLORS.flesh, circle(0, 0, R));
  // stretched veins and glowing pustules
  p.g.strokeStyle = COLORS.fleshDark;
  p.g.lineWidth = 0.02;
  p.g.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = k * 1.25 + 0.3;
    p.g.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2);
    p.g.quadraticCurveTo(Math.cos(a + 0.4) * R * 0.6, Math.sin(a + 0.4) * R * 0.6, Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95);
  }
  p.g.stroke();
  for (const [x, y, r] of BOOMER_PUSTULES) {
    shape(p, COLORS.acid, circle(x * R, y * R, r * R));
    highlight(p, x * R, y * R, r * R, 0.6);
  }
  highlight(p, 0, 0, R, 0.18);
  shape(p, COLORS.fleshDark, circle(R * 0.92, 0, 0.07));
  eyes(p, MUTANT_EYES.boomer);
}

const BOOMER_PUSTULES: readonly (readonly [number, number, number])[] = [
  [0.35, -0.35, 0.2],
  [-0.4, 0.15, 0.24],
  [0.1, 0.45, 0.16],
  [-0.15, -0.5, 0.14],
  [0.5, 0.2, 0.13],
];

function paintBehemoth(p: UnitPen, frame: UnitFrame): void {
  const s = swing(frame, 0.08);
  const lunge = frame === 'recoil' ? 0.12 : 0;
  // massive arms with knuckles forward
  limb(p, [[0.05, -0.55], [0.4 + s + lunge, -0.72], [0.66 + s + lunge, -0.6]], 0.2, COLORS.fleshDark);
  limb(p, [[0.05, 0.55], [0.4 - s + lunge, 0.72], [0.66 - s + lunge, 0.6]], 0.2, COLORS.fleshDark);
  shape(p, COLORS.flesh, circle(0.7 + s + lunge, -0.6, 0.14));
  shape(p, COLORS.flesh, circle(0.7 - s + lunge, 0.6, 0.14));
  // bone spikes around the back and shoulders
  shape(p, COLORS.bone, (g) => {
    for (let k = 0; k < 9; k++) {
      const a = Math.PI * 0.55 + (k / 8) * Math.PI * 0.9;
      const bx = Math.cos(a) * 0.62;
      const by = Math.sin(a) * 0.72;
      const tx = Math.cos(a) * 0.98;
      const ty = Math.sin(a) * 1.04;
      const nx = -Math.sin(a) * 0.09;
      const ny = Math.cos(a) * 0.09;
      g.moveTo(bx - nx, by - ny);
      g.lineTo(tx, ty);
      g.lineTo(bx + nx, by + ny);
      g.closePath();
    }
  });
  shape(p, COLORS.fleshDark, ellipse(-0.05, 0, 0.66, 0.78));
  // armored back plates
  shape(p, COLORS.chitin, ellipse(-0.18, 0, 0.42, 0.58));
  shape(p, COLORS.chitinLight, ellipse(-0.1, 0, 0.26, 0.4));
  highlight(p, -0.12, 0, 0.5, 0.2);
  p.g.fillStyle = COLORS.bone;
  for (let k = 0; k < 4; k++) {
    p.g.beginPath();
    p.g.arc(-0.42 + k * 0.17, 0, 0.045, 0, TAU);
    p.g.fill();
  }
  // head with curving tusks
  limb(p, [[0.78, -0.12], [0.98 + lunge, -0.2], [1.04 + lunge, -0.08]], 0.07, COLORS.bone);
  limb(p, [[0.78, 0.12], [0.98 + lunge, 0.2], [1.04 + lunge, 0.08]], 0.07, COLORS.bone);
  shape(p, COLORS.flesh, ellipse(0.66 + lunge * 0.6, 0, 0.2, 0.22));
  eyes(p, MUTANT_EYES.behemoth.map((e) => ({ ...e, x: e.x + lunge * 0.6 })));
}

export interface MutantEye {
  x: number;
  y: number;
  r: number;
}

/** Eye positions per mutant type (local coordinates, facing +x); the renderer makes them glow at night. */
export const MUTANT_EYES: Record<MutantType, readonly MutantEye[]> = {
  wanderer: [
    { x: 0.22, y: -0.045, r: 0.024 },
    { x: 0.22, y: 0.045, r: 0.024 },
  ],
  runner: [
    { x: 0.32, y: -0.03, r: 0.02 },
    { x: 0.32, y: 0.03, r: 0.02 },
  ],
  crawler: [
    { x: 0.42, y: -0.06, r: 0.026 },
    { x: 0.42, y: 0.06, r: 0.026 },
    { x: 0.38, y: 0, r: 0.02 },
  ],
  spitter: [
    { x: 0.39, y: -0.035, r: 0.022 },
    { x: 0.39, y: 0.035, r: 0.022 },
  ],
  boomer: [
    { x: 0.4, y: -0.035, r: 0.02 },
    { x: 0.4, y: 0.035, r: 0.02 },
  ],
  behemoth: [
    { x: 0.78, y: -0.08, r: 0.04 },
    { x: 0.78, y: 0.08, r: 0.04 },
  ],
};

export function paintMutant(p: UnitPen, type: MutantType, frame: UnitFrame): void {
  switch (type) {
    case 'wanderer':
      paintWanderer(p, frame);
      break;
    case 'runner':
      paintRunner(p, frame);
      break;
    case 'crawler':
      paintCrawler(p, frame);
      break;
    case 'spitter':
      paintSpitter(p, frame);
      break;
    case 'boomer':
      paintBoomer(p, frame);
      break;
    case 'behemoth':
      paintBehemoth(p, frame);
      break;
  }
}
