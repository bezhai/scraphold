/**
 * Procedural building and nest art in tile units. Each building is a roof seen from above plus a
 * darker south wall strip that hints at its height, in its category's materials: patched
 * corrugated tin and planks for the economy, olive canvas and sandbags for the military, concrete
 * and barbed wire for defenses. The static body (paintBuildingBody) is cached by the renderer;
 * the live layer (paintBuildingLive) moves what moves: the pumpjack, crane and dish while staffed,
 * chimney smoke and lit windows when someone works inside, turret aim, searchlight heads, damage
 * smoke and fire, construction scaffolding over a blueprint that fills from the bottom up.
 * Nests and the hive are pulsing organic growths.
 */
import type { BuildingType } from '../../sim/data/economy';
import { COLORS, outlinePx } from './palette';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export interface BuildingSprite {
  type: BuildingType;
  tileX: number;
  tileY: number;
  size: number;
  /** 0..1 build progress, 1 when complete. */
  built: number;
  workers: number;
  slots: number;
  /** Turret aim in radians (towers), null when idle. */
  aim: number | null;
  /** hp / maxHp; 1 when omitted. */
  hp?: number;
}

/** Height of the building mass in tiles: its south wall strip and the length of its shadow. */
const HEIGHT: Record<BuildingType, number> = {
  core: 0.36,
  shack: 0.24,
  salvageYard: 0.2,
  greenhouse: 0.2,
  oilWell: 0.14,
  researchStation: 0.28,
  dispatchHub: 0.22,
  barracks: 0.26,
  armory: 0.3,
  workshop: 0.33,
  barricade: 0.22,
  machineGunTower: 0.22,
  watchtower: 0.34,
  signalTower: 0.34,
};

/** How tall the whole silhouette stands (props, towers) for the shadow length, in tiles. */
const SHADOW_HEIGHT: Record<BuildingType, number> = {
  core: 0.9,
  shack: 0.5,
  salvageYard: 0.6,
  greenhouse: 0.42,
  oilWell: 0.75,
  researchStation: 0.7,
  dispatchHub: 0.55,
  barracks: 0.55,
  armory: 0.6,
  workshop: 0.65,
  barricade: 0.32,
  machineGunTower: 0.42,
  watchtower: 1.5,
  signalTower: 1.5,
};

export function buildingShadowHeight(type: BuildingType): number {
  return SHADOW_HEIGHT[type];
}

/** 0 intact, 1 cracked, 2 smoking, 3 burning. */
export function damageStage(hpFraction: number): 0 | 1 | 2 | 3 {
  return hpFraction > 0.66 ? 0 : hpFraction > 0.4 ? 1 : hpFraction > 0.2 ? 2 : 3;
}

interface Pen {
  g: Ctx;
  /** Outline width in tiles. */
  ol: number;
}

function shape(p: Pen, fill: string | CanvasGradient, path: (g: Ctx) => void, stroke = true): void {
  const g = p.g;
  g.beginPath();
  path(g);
  g.fillStyle = fill;
  g.fill();
  if (!stroke) return;
  g.lineWidth = p.ol;
  g.strokeStyle = COLORS.outline;
  g.lineJoin = 'round';
  g.stroke();
}

const rect = (x: number, y: number, w: number, h: number, r = 0) => (g: Ctx) => (r > 0 ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));
const circle = (x: number, y: number, r: number) => (g: Ctx) => g.arc(x, y, r, 0, TAU);
const ellipse = (x: number, y: number, rx: number, ry: number, rot = 0) => (g: Ctx) => g.ellipse(x, y, rx, ry, rot, 0, TAU);

function lines(g: Ctx, color: string, width: number, draw: () => void): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  draw();
  g.stroke();
}

/** Corrugated sheet: base color with light / dark ribs. */
function corrugated(p: Pen, x: number, y: number, w: number, h: number, base: string, vertical = true): void {
  shape(p, base, rect(x, y, w, h));
  const g = p.g;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const n = Math.ceil((vertical ? w : h) / 0.09);
  for (let k = 0; k < n; k++) {
    g.fillStyle = k % 2 === 0 ? 'rgba(255,250,235,0.16)' : 'rgba(20,14,8,0.16)';
    if (vertical) g.fillRect(x + k * 0.09, y, 0.045, h);
    else g.fillRect(x, y + k * 0.09, w, 0.045);
  }
  g.restore();
}

function patch(p: Pen, x: number, y: number, w: number, h: number, color: string): void {
  shape(p, color, rect(x, y, w, h));
  p.g.fillStyle = 'rgba(20,14,8,0.6)';
  for (const [px, py] of [
    [x + 0.04, y + 0.04],
    [x + w - 0.04, y + 0.04],
    [x + 0.04, y + h - 0.04],
    [x + w - 0.04, y + h - 0.04],
  ] as const) {
    p.g.beginPath();
    p.g.arc(px, py, 0.018, 0, TAU);
    p.g.fill();
  }
}

/** The south face under a roof: darker, with vertical boards / ribs. */
function wallStrip(p: Pen, x: number, y: number, w: number, h: number, color: string, ribs = 0.12): void {
  shape(p, color, rect(x, y, w, h));
  const g = p.g;
  lines(g, 'rgba(15,10,5,0.28)', p.ol * 0.7, () => {
    for (let bx = x + ribs; bx < x + w - 0.02; bx += ribs) {
      g.moveTo(bx, y);
      g.lineTo(bx, y + h);
    }
  });
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x, y, w, h * 0.25);
}

function canvasRoof(p: Pen, x: number, y: number, w: number, h: number, color: string): void {
  const g = p.g;
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, color);
  grad.addColorStop(0.48, '#8e9a58');
  grad.addColorStop(0.52, COLORS.oliveDark);
  grad.addColorStop(1, color);
  shape(p, grad, rect(x, y, w, h, 0.05));
  lines(g, 'rgba(30,35,15,0.55)', p.ol, () => {
    g.moveTo(x + 0.04, y + h / 2);
    g.lineTo(x + w - 0.04, y + h / 2);
  });
  lines(g, 'rgba(30,35,15,0.25)', p.ol * 0.7, () => {
    for (let bx = x + 0.2; bx < x + w - 0.1; bx += 0.3) {
      g.moveTo(bx, y + 0.04);
      g.lineTo(bx + 0.04, y + h / 2);
      g.lineTo(bx, y + h - 0.04);
    }
  });
}

function sandbagRow(p: Pen, x0: number, x1: number, y: number, bag = 0.2): void {
  for (let bx = x0 + bag / 2; bx <= x1 - bag / 2 + 0.01; bx += bag * 0.92) {
    shape(p, COLORS.sandbag, ellipse(bx, y, bag / 2, bag / 3.1));
    p.g.fillStyle = 'rgba(255,250,230,0.3)';
    p.g.beginPath();
    p.g.ellipse(bx - bag * 0.12, y - bag * 0.08, bag * 0.22, bag * 0.1, 0, 0, TAU);
    p.g.fill();
  }
}

function sandbagColumn(p: Pen, x: number, y0: number, y1: number, bag = 0.2): void {
  for (let by = y0 + bag / 2; by <= y1 - bag / 2 + 0.01; by += bag * 0.85) shape(p, COLORS.sandbag, ellipse(x, by, bag / 3.1, bag / 2));
}

function barbedWire(p: Pen, x0: number, y0: number, x1: number, y1: number): void {
  const g = p.g;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 0.12));
  lines(g, '#3a3632', p.ol * 0.9, () => {
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      g.moveTo(x0 + (x1 - x0) * t + 0.06, y0 + (y1 - y0) * t);
      g.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.06, 0, TAU);
    }
  });
  lines(g, 'rgba(220,220,210,0.5)', p.ol * 0.5, () => {
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      g.moveTo(x0 + (x1 - x0) * t - 0.03, y0 + (y1 - y0) * t - 0.05);
      g.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.06, Math.PI * 1.1, Math.PI * 1.5);
    }
  });
}

function crate(p: Pen, x: number, y: number, w: number, h: number, color: string = COLORS.wood): void {
  shape(p, '#5e4129', rect(x, y + h, w, 0.07));
  shape(p, color, rect(x, y, w, h));
  lines(p.g, 'rgba(40,25,10,0.55)', p.ol * 0.8, () => {
    p.g.moveTo(x, y);
    p.g.lineTo(x + w, y + h);
    p.g.moveTo(x + w, y);
    p.g.lineTo(x, y + h);
  });
  p.g.fillStyle = 'rgba(255,240,210,0.3)';
  p.g.fillRect(x + 0.02, y + 0.02, w - 0.04, 0.03);
}

function lampFixture(p: Pen, x: number, y: number): void {
  shape(p, '#2b2622', circle(x, y, 0.06));
  shape(p, '#f3e2b0', circle(x, y, 0.035), false);
}

// ---------------------------------------------------------------------------------------------
// Bodies (static, cached)

function paintCore(p: Pen, s: number): void {
  const g = p.g;
  const c = s / 2;
  const h = HEIGHT.core;
  const oct = (r: number, dy = 0) => (gg: Ctx) => {
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      const x = c + Math.cos(a) * r;
      const y = c - h / 2 + Math.sin(a) * r * 0.94 + dy;
      if (k === 0) gg.moveTo(x, y);
      else gg.lineTo(x, y);
    }
    gg.closePath();
  };
  // concrete bastion: front wall then top
  shape(p, COLORS.concreteDark, oct(c * 0.98, h));
  shape(p, COLORS.concreteDark, (gg) => gg.rect(c - c * 0.9, c - h / 2, c * 1.8, h));
  shape(p, COLORS.concrete, oct(c * 0.98));
  // hazard band around the rim
  g.save();
  g.beginPath();
  oct(c * 0.98)(g);
  g.clip();
  g.lineWidth = 0.12;
  g.strokeStyle = COLORS.hazard;
  g.beginPath();
  oct(c * 0.9)(g);
  g.stroke();
  g.setLineDash([0.14, 0.14]);
  g.strokeStyle = '#2a2520';
  g.stroke();
  g.setLineDash([]);
  g.restore();
  shape(p, '#8e897e', oct(c * 0.78));
  // pipes from the pylons to the reactor
  lines(g, COLORS.outline, 0.11, () => {
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      g.moveTo(c + dx * c * 0.62, c - h / 2 + dy * c * 0.58);
      g.lineTo(c, c - h / 2);
    }
  });
  lines(g, COLORS.steel, 0.07, () => {
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      g.moveTo(c + dx * c * 0.62, c - h / 2 + dy * c * 0.58);
      g.lineTo(c, c - h / 2);
    }
  });
  // four cooling pylons with teal caps
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const x = c + dx * c * 0.66;
    const y = c - h / 2 + dy * c * 0.62;
    shape(p, COLORS.steelDark, circle(x, y + 0.08, 0.2));
    shape(p, COLORS.steel, circle(x, y, 0.2));
    shape(p, COLORS.tealDark, circle(x, y, 0.1));
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.arc(x - 0.06, y - 0.06, 0.06, 0, TAU);
    g.fill();
  }
  // reactor housing; the glowing core itself is live
  shape(p, COLORS.steelDark, circle(c, c - h / 2 + 0.1, 0.62));
  shape(p, COLORS.steel, circle(c, c - h / 2, 0.62));
  g.strokeStyle = 'rgba(20,16,12,0.5)';
  g.lineWidth = p.ol;
  g.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    g.moveTo(c + Math.cos(a) * 0.42, c - h / 2 + Math.sin(a) * 0.42);
    g.lineTo(c + Math.cos(a) * 0.58, c - h / 2 + Math.sin(a) * 0.58);
  }
  g.stroke();
  shape(p, '#2b2622', circle(c, c - h / 2, 0.38));
  g.fillStyle = 'rgba(255,250,235,0.35)';
  g.beginPath();
  g.arc(c - 0.2, c - h / 2 - 0.25, 0.18, Math.PI, Math.PI * 1.7);
  g.arc(c - 0.2, c - h / 2 - 0.25, 0.12, Math.PI * 1.7, Math.PI, true);
  g.fill();
  // flag pole (teal flag) and antenna
  lines(g, COLORS.outline, 0.05, () => {
    g.moveTo(s - 0.42, 0.62);
    g.lineTo(s - 0.42, -0.05);
    g.moveTo(0.45, s - 0.95);
    g.lineTo(0.3, s - 1.8);
  });
  shape(p, COLORS.teal, (gg) => {
    gg.moveTo(s - 0.42, -0.05);
    gg.lineTo(s - 0.02, 0.06);
    gg.lineTo(s - 0.42, 0.2);
    gg.closePath();
  });
}

function paintShack(p: Pen, s: number): void {
  const h = HEIGHT.shack;
  const x0 = 0.12;
  const y0 = 0.16;
  const x1 = s - 0.12;
  const y1 = s - 0.12 - h;
  // tin roof on the left, patched; canvas lean-to on the right
  wallStrip(p, x0, y1, x1 - x0, h, COLORS.woodDark);
  corrugated(p, x0, y0, (x1 - x0) * 0.62, y1 - y0, COLORS.tin);
  patch(p, x0 + 0.12, y0 + 0.18, 0.34, 0.26, COLORS.rust);
  patch(p, x0 + 0.5, y0 + 0.75, 0.3, 0.22, '#7d8a8a');
  canvasRoof(p, x0 + (x1 - x0) * 0.6, y0 + 0.08, (x1 - x0) * 0.4, y1 - y0 - 0.08, '#b8a77a');
  // door, lamp, stovepipe
  shape(p, '#3b2d20', rect(s / 2 - 0.16, y1 + 0.04, 0.26, h - 0.04));
  lampFixture(p, s / 2 + 0.22, y1 + 0.08);
  shape(p, '#3d3a36', circle(x0 + 0.24, y0 + 0.62, 0.08));
}

function paintSalvageYard(p: Pen, s: number): void {
  const h = HEIGHT.salvageYard;
  // dark work pad with a low fence
  shape(p, '#6e6658', rect(0.06, 0.06, s - 0.12, s - 0.12, 0.05));
  p.g.fillStyle = 'rgba(30,20,10,0.25)';
  p.g.fillRect(0.06, 0.06, s - 0.12, s - 0.12);
  // shed at the back right
  wallStrip(p, s - 0.86, 0.62 - 0.0, 0.72, h, COLORS.woodDark);
  corrugated(p, s - 0.86, 0.14, 0.72, 0.48, COLORS.tin, false);
  patch(p, s - 0.6, 0.24, 0.24, 0.18, COLORS.rust);
  // scrap heaps in rust and steel
  for (const [x, y, r] of [
    [0.55, s - 0.55, 0.36],
    [1.25, s - 0.42, 0.28],
  ] as const) {
    shape(p, COLORS.rustDark, ellipse(x, y + 0.05, r, r * 0.75));
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3;
      const px = x + Math.cos(a) * r * 0.45;
      const py = y + Math.sin(a) * r * 0.32;
      shape(p, k % 2 ? COLORS.steel : COLORS.rust, rect(px - 0.1, py - 0.05, 0.2, 0.1), true);
    }
    p.g.fillStyle = COLORS.rustLight;
    p.g.fillRect(x - 0.08, y - r * 0.5, 0.16, 0.05);
  }
  // crane base; the boom is live
  shape(p, '#2d2a26', circle(0.48, 0.5, 0.2));
  shape(p, COLORS.hazard, circle(0.48, 0.5, 0.12));
}

function paintGreenhouse(p: Pen, s: number): void {
  const h = HEIGHT.greenhouse;
  const x0 = 0.1;
  const y0 = 0.1;
  const w = s - 0.2;
  const rh = s - 0.2 - h;
  wallStrip(p, x0, y0 + rh, w, h, '#5f6b55', 0.2);
  // soil bed with crop rows, seen through the glass
  shape(p, COLORS.fertile, rect(x0, y0, w, rh));
  const g = p.g;
  for (let row = 0; row < 4; row++) {
    const y = y0 + 0.2 + row * ((rh - 0.3) / 3);
    for (let k = 0; k < 6; k++) {
      const x = x0 + 0.16 + k * ((w - 0.3) / 5);
      g.fillStyle = COLORS.sproutDark;
      g.beginPath();
      g.arc(x, y, 0.09, 0, TAU);
      g.fill();
      g.fillStyle = COLORS.sprout;
      g.beginPath();
      g.arc(x - 0.02, y - 0.02, 0.06, 0, TAU);
      g.fill();
    }
  }
  // glass panes and steel frame
  g.fillStyle = 'rgba(190,235,230,0.32)';
  g.fillRect(x0, y0, w, rh);
  lines(g, '#c9d4d0', 0.04, () => {
    for (let k = 1; k < 4; k++) {
      g.moveTo(x0 + (k * w) / 4, y0);
      g.lineTo(x0 + (k * w) / 4, y0 + rh);
    }
    g.moveTo(x0, y0 + rh / 2);
    g.lineTo(x0 + w, y0 + rh / 2);
  });
  g.strokeStyle = COLORS.outline;
  g.lineWidth = p.ol;
  g.strokeRect(x0, y0, w, rh);
  // reflections
  g.fillStyle = 'rgba(255,255,255,0.38)';
  g.beginPath();
  g.moveTo(x0 + 0.1, y0 + rh * 0.55);
  g.lineTo(x0 + 0.45, y0 + 0.05);
  g.lineTo(x0 + 0.6, y0 + 0.05);
  g.lineTo(x0 + 0.25, y0 + rh * 0.55);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.beginPath();
  g.moveTo(x0 + 0.8, y0 + rh * 0.95);
  g.lineTo(x0 + 1.2, y0 + rh * 0.4);
  g.lineTo(x0 + 1.28, y0 + rh * 0.4);
  g.lineTo(x0 + 0.88, y0 + rh * 0.95);
  g.closePath();
  g.fill();
}

function paintOilWell(p: Pen, s: number): void {
  // black oil stain, concrete pad, small tank; the pumpjack is live
  const g = p.g;
  g.fillStyle = 'rgba(14,12,16,0.85)';
  g.beginPath();
  g.ellipse(s * 0.45, s * 0.66, s * 0.42, s * 0.24, 0.2, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(110,90,154,0.35)';
  g.beginPath();
  g.ellipse(s * 0.38, s * 0.6, s * 0.16, s * 0.05, 0.2, 0, TAU);
  g.fill();
  shape(p, COLORS.concreteDark, rect(0.16, 0.66, 0.68, 0.14, 0.03));
  shape(p, COLORS.concrete, rect(0.16, 0.54, 0.68, 0.12, 0.03));
  shape(p, COLORS.rustDark, ellipse(0.82, 0.3, 0.13, 0.12));
  shape(p, COLORS.rust, ellipse(0.82, 0.26, 0.13, 0.12));
  // A-frame
  lines(g, COLORS.outline, 0.075, () => {
    g.moveTo(0.36, 0.62);
    g.lineTo(0.5, 0.3);
    g.lineTo(0.64, 0.62);
  });
  lines(g, '#4b4640', 0.045, () => {
    g.moveTo(0.36, 0.62);
    g.lineTo(0.5, 0.3);
    g.lineTo(0.64, 0.62);
  });
}

function paintResearchStation(p: Pen, s: number): void {
  const h = HEIGHT.researchStation;
  wallStrip(p, 0.5, s - 0.18 - h, s - 0.66, h, COLORS.tinDark);
  corrugated(p, 0.5, 0.62, s - 0.66, s - 0.8 - h, '#8f9796');
  patch(p, s - 0.62, 0.78, 0.3, 0.22, '#6d7f8a');
  // solar panel
  shape(p, '#2c3c56', rect(0.12, s - 0.62, 0.34, 0.46));
  lines(p.g, 'rgba(140,180,230,0.6)', p.ol * 0.6, () => {
    p.g.moveTo(0.29, s - 0.62);
    p.g.lineTo(0.29, s - 0.16);
    p.g.moveTo(0.12, s - 0.39);
    p.g.lineTo(0.46, s - 0.39);
  });
  // dish mount and antenna base; dish and blinking lights are live
  shape(p, '#4b4a46', circle(0.62, 0.55, 0.12));
  shape(p, '#4b4a46', rect(s - 0.36, 0.1, 0.14, 0.14));
}

function paintDispatchHub(p: Pen, s: number): void {
  const h = HEIGHT.dispatchHub;
  // loading pad with hazard edge
  shape(p, '#7d7466', rect(0.06, 0.06, s - 0.12, s - 0.12, 0.04));
  const g = p.g;
  g.save();
  g.beginPath();
  g.rect(0.06, s - 0.2, s - 0.12, 0.1);
  g.clip();
  for (let k = 0; k < 14; k++) {
    g.fillStyle = k % 2 ? '#2a2520' : COLORS.hazard;
    g.beginPath();
    g.moveTo(k * 0.16, s - 0.2);
    g.lineTo(k * 0.16 + 0.08, s - 0.2);
    g.lineTo(k * 0.16, s - 0.1);
    g.lineTo(k * 0.16 - 0.08, s - 0.1);
    g.closePath();
    g.fill();
  }
  g.restore();
  // office hut
  wallStrip(p, 0.14, 0.62, 0.7, h, COLORS.woodDark);
  corrugated(p, 0.14, 0.14, 0.7, 0.48, COLORS.tin, false);
  // stacked crates
  crate(p, 1.02, 0.18, 0.36, 0.32);
  crate(p, 1.42, 0.22, 0.32, 0.3, '#86693f');
  crate(p, 1.2, 0.06, 0.3, 0.26, '#a37a4a');
  // parked truck with a teal stripe
  shape(p, '#1a1816', rect(0.32, 1.12, 0.12, 0.62, 0.03));
  shape(p, '#1a1816', rect(0.86, 1.12, 0.12, 0.62, 0.03));
  shape(p, '#6f5a3a', rect(0.24, 1.16, 0.84, 0.54, 0.06));
  shape(p, '#5a4628', rect(0.84, 1.18, 0.22, 0.5, 0.04));
  g.fillStyle = COLORS.teal;
  g.fillRect(0.3, 1.39, 0.5, 0.08);
  shape(p, 'rgba(150,200,210,0.9)', rect(1.0, 1.22, 0.05, 0.42));
}

function paintBarracks(p: Pen, s: number): void {
  const h = HEIGHT.barracks;
  // big olive tent with guy ropes, inside a sandbag wall
  const g = p.g;
  lines(g, 'rgba(60,50,30,0.7)', p.ol, () => {
    for (const [x, y] of [
      [0.12, 0.12],
      [s - 0.12, 0.12],
      [0.12, s - 0.4],
      [s - 0.12, s - 0.4],
    ] as const) {
      g.moveTo(s / 2 + (x < s / 2 ? -0.5 : 0.5), (y < s / 2 ? 0.42 : s - 0.6) - 0.05);
      g.lineTo(x, y);
    }
  });
  wallStrip(p, 0.3, s - 0.36 - h, s - 0.6, h, COLORS.oliveDark, 0.2);
  canvasRoof(p, 0.3, 0.24, s - 0.6, s - 0.6 - h, COLORS.olive);
  shape(p, '#2d3317', rect(s / 2 - 0.14, s - 0.36 - h + 0.04, 0.28, h - 0.04));
  sandbagRow(p, 0.06, s - 0.06, s - 0.14);
  sandbagColumn(p, 0.12, 0.08, s - 0.25);
  sandbagColumn(p, s - 0.12, 0.08, s - 0.25);
  lampFixture(p, s / 2 + 0.26, s - 0.3 - h);
}

function paintArmory(p: Pen, s: number): void {
  const h = HEIGHT.armory;
  // concrete store with a canvas awning over the workbench
  wallStrip(p, 0.12, 0.98, s - 0.24, h, COLORS.concreteDark, 0.25);
  shape(p, COLORS.concrete, rect(0.12, 0.12, s - 0.24, 0.86));
  const g = p.g;
  g.fillStyle = 'rgba(40,35,25,0.25)';
  g.fillRect(0.12, 0.12, s - 0.24, 0.06);
  canvasRoof(p, 0.18, 0.18, 0.8, 0.7, COLORS.olive);
  // ammo crates with stencils
  for (const [x, y] of [
    [1.08, 0.24],
    [1.08, 0.58],
    [1.45, 0.4],
  ] as const) {
    shape(p, '#5f6a34', rect(x, y, 0.34, 0.28, 0.02));
    g.fillStyle = COLORS.hazard;
    g.fillRect(x + 0.06, y + 0.11, 0.22, 0.06);
  }
  // workbench and rifle rack in front
  shape(p, COLORS.wood, rect(0.22, 1.42, 0.8, 0.22, 0.02));
  lines(g, '#2a2622', 0.05, () => {
    for (let k = 0; k < 4; k++) {
      g.moveTo(1.18 + k * 0.13, 1.36);
      g.lineTo(1.18 + k * 0.13, 1.72);
    }
  });
  shape(p, '#3d3a36', circle(0.42, 1.53, 0.06));
}

function paintWorkshop(p: Pen, s: number): void {
  const h = HEIGHT.workshop;
  // garage: tin roof at the back, open bay with a vehicle in front, hazard door frame
  wallStrip(p, 0.1, 0.72, s - 0.2, h, COLORS.tinDark);
  corrugated(p, 0.1, 0.1, s - 0.2, 0.62, '#868c8a', false);
  canvasRoof(p, 0.1, 0.1, 0.62, 0.62, COLORS.olive);
  const g = p.g;
  // bay floor
  shape(p, '#4d4944', rect(0.22, 0.72 + h, s - 0.44, s - 0.84 - h - 0.06));
  // vehicle in the bay (bonnet up)
  shape(p, '#1a1816', rect(0.48, 1.12, 0.1, 0.5));
  shape(p, '#1a1816', rect(1.42, 1.12, 0.1, 0.5));
  shape(p, '#7a5a34', rect(0.42, 1.14, 1.16, 0.46, 0.06));
  shape(p, '#a07a48', rect(1.22, 1.12, 0.3, 0.5, 0.04));
  g.fillStyle = COLORS.teal;
  g.fillRect(0.5, 1.33, 0.6, 0.06);
  // hazard striped door posts
  for (const x of [0.12, s - 0.22]) {
    g.save();
    g.beginPath();
    g.rect(x, 0.72, 0.1, s - 0.84);
    g.clip();
    for (let k = 0; k < 10; k++) {
      g.fillStyle = k % 2 ? '#2a2520' : COLORS.hazard;
      g.fillRect(x, 0.72 + k * 0.12, 0.1, 0.12);
    }
    g.restore();
    g.strokeStyle = COLORS.outline;
    g.lineWidth = p.ol;
    g.strokeRect(x, 0.72, 0.1, s - 0.84);
  }
  // gear sign
  const cx = s - 0.5;
  const cy = 0.4;
  shape(p, '#b9bdb8', (gg) => {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      gg.rect(cx + Math.cos(a) * 0.17 - 0.04, cy + Math.sin(a) * 0.17 - 0.04, 0.08, 0.08);
    }
  });
  shape(p, '#b9bdb8', circle(cx, cy, 0.15));
  shape(p, '#555a58', circle(cx, cy, 0.06));
}

function paintBarricade(p: Pen, s: number): void {
  const h = HEIGHT.barricade;
  // two concrete blocks with barbed wire along the front
  for (const [x, w] of [
    [0.08, 0.4],
    [0.52, 0.4],
  ] as const) {
    shape(p, COLORS.concreteDark, rect(x, 0.5, w, h));
    shape(p, COLORS.concrete, rect(x, 0.2, w, 0.3, 0.02));
    p.g.fillStyle = 'rgba(255,250,235,0.35)';
    p.g.fillRect(x + 0.03, 0.22, w - 0.06, 0.04);
    p.g.fillStyle = 'rgba(60,55,45,0.4)';
    p.g.beginPath();
    p.g.arc(x + w * 0.65, 0.36, 0.04, 0, TAU);
    p.g.fill();
  }
  p.g.fillStyle = COLORS.hazard;
  p.g.fillRect(0.12, 0.54, 0.32, 0.05);
  p.g.fillRect(0.56, 0.54, 0.32, 0.05);
  barbedWire(p, 0.08, s - 0.12, s - 0.08, s - 0.14);
  barbedWire(p, 0.1, 0.12, s - 0.1, 0.1);
}

function paintMachineGunTower(p: Pen, s: number): void {
  const c = s / 2;
  shape(p, COLORS.concreteDark, circle(c, c + 0.1, 0.44));
  shape(p, COLORS.concrete, circle(c, c, 0.44));
  // ring of sandbags; the gun is live
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    shape(p, COLORS.sandbag, ellipse(c + Math.cos(a) * 0.38, c + Math.sin(a) * 0.38, 0.12, 0.075, a + Math.PI / 2));
  }
  shape(p, '#5e6a34', rect(c - 0.3, c + 0.08, 0.16, 0.12, 0.02));
}

function paintWatchtower(p: Pen, s: number): void {
  const g = p.g;
  // legs and cross bracing below the platform (tall wooden tower)
  lines(g, COLORS.outline, 0.09, () => {
    g.moveTo(0.14, s - 0.06);
    g.lineTo(0.26, 0.5);
    g.moveTo(s - 0.14, s - 0.06);
    g.lineTo(s - 0.26, 0.5);
    g.moveTo(0.16, s - 0.1);
    g.lineTo(s - 0.26, 0.55);
    g.moveTo(s - 0.16, s - 0.1);
    g.lineTo(0.26, 0.55);
  });
  lines(g, COLORS.wood, 0.05, () => {
    g.moveTo(0.14, s - 0.06);
    g.lineTo(0.26, 0.5);
    g.moveTo(s - 0.14, s - 0.06);
    g.lineTo(s - 0.26, 0.5);
    g.moveTo(0.16, s - 0.1);
    g.lineTo(s - 0.26, 0.55);
    g.moveTo(s - 0.16, s - 0.1);
    g.lineTo(0.26, 0.55);
  });
  // platform with railing, small roof
  shape(p, COLORS.woodDark, rect(0.16, 0.44, s - 0.32, 0.16));
  shape(p, COLORS.wood, rect(0.16, 0.08, s - 0.32, 0.36));
  lines(g, 'rgba(50,30,15,0.5)', p.ol * 0.7, () => {
    for (let x = 0.26; x < s - 0.2; x += 0.1) {
      g.moveTo(x, 0.08);
      g.lineTo(x, 0.44);
    }
  });
  shape(p, '#5a4128', (gg) => {
    gg.moveTo(0.12, 0.2);
    gg.lineTo(s / 2, 0.0);
    gg.lineTo(s - 0.12, 0.2);
    gg.lineTo(s - 0.12, 0.26);
    gg.lineTo(0.12, 0.26);
    gg.closePath();
  });
  shape(p, COLORS.teal, rect(s / 2 - 0.05, 0.03, 0.1, 0.06), false);
}

function paintSignalTower(p: Pen, s: number): void {
  const g = p.g;
  const c = s / 2;
  // 3x3 concrete & steel footing base
  shape(p, '#34383a', rect(0.2, 0.2, s - 0.4, s - 0.4, 0.15));
  shape(p, '#464c50', rect(0.35, 0.35, s - 0.7, s - 0.7, 0.1));

  // Steel truss legs converging from 4 corners to center mast
  lines(g, COLORS.outline, p.ol * 1.5, () => {
    g.moveTo(0.3, s - 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(s - 0.3, s - 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(0.3, 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(s - 0.3, 0.3);
    g.lineTo(c, c - 0.4);
  });
  lines(g, COLORS.steel, p.ol * 0.9, () => {
    g.moveTo(0.3, s - 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(s - 0.3, s - 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(0.3, 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(s - 0.3, 0.3);
    g.lineTo(c, c - 0.4);
    g.moveTo(0.6, s - 0.6);
    g.lineTo(s - 0.6, s - 0.6);
    g.moveTo(0.6, 0.6);
    g.lineTo(s - 0.6, 0.6);
  });

  // Transmitter cabin at base
  shape(p, '#282b2d', rect(c - 0.55, c + 0.1, 1.1, 0.7, 0.05));
  shape(p, COLORS.rust, rect(c - 0.5, c + 0.15, 1.0, 0.6, 0.03));
  shape(p, COLORS.teal, rect(c - 0.4, c + 0.25, 0.2, 0.15), false);

  // Large parabolic dish antenna
  shape(p, '#2a2622', ellipse(c, c - 0.3, 0.65, 0.42));
  shape(p, '#d4cbb8', ellipse(c, c - 0.35, 0.58, 0.36));
  shape(p, '#b0a590', ellipse(c, c - 0.35, 0.36, 0.22));

  // Feed horn mast extending upward
  lines(g, COLORS.outline, p.ol * 1.2, () => {
    g.moveTo(c, c - 0.35);
    g.lineTo(c, c - 0.75);
  });
  lines(g, '#ffffff', p.ol * 0.7, () => {
    g.moveTo(c, c - 0.35);
    g.lineTo(c, c - 0.75);
  });
  shape(p, '#ffd27a', circle(c, c - 0.75, 0.06), false);
}

const BODY: Record<BuildingType, (p: Pen, s: number) => void> = {
  core: paintCore,
  shack: paintShack,
  salvageYard: paintSalvageYard,
  greenhouse: paintGreenhouse,
  oilWell: paintOilWell,
  researchStation: paintResearchStation,
  dispatchHub: paintDispatchHub,
  barracks: paintBarracks,
  armory: paintArmory,
  workshop: paintWorkshop,
  barricade: paintBarricade,
  machineGunTower: paintMachineGunTower,
  watchtower: paintWatchtower,
  signalTower: paintSignalTower,
};

/** Cracks and scorch marks for damage stages 1-3 (static, part of the cached body). */
function paintDamage(p: Pen, s: number, stage: number): void {
  if (stage <= 0) return;
  const g = p.g;
  const cracks = stage === 1 ? 2 : 4;
  for (let k = 0; k < cracks; k++) {
    const x = s * (0.25 + ((k * 0.37) % 0.55));
    const y = s * (0.2 + ((k * 0.29) % 0.45));
    lines(g, 'rgba(20,14,8,0.75)', p.ol * 1.1, () => {
      g.moveTo(x, y);
      g.lineTo(x + 0.12, y + 0.08);
      g.lineTo(x + 0.08, y + 0.2);
      g.moveTo(x + 0.12, y + 0.08);
      g.lineTo(x + 0.24, y + 0.06);
    });
  }
  if (stage >= 2) {
    g.fillStyle = 'rgba(25,18,12,0.55)';
    g.beginPath();
    g.ellipse(s * 0.62, s * 0.38, s * 0.16, s * 0.1, 0.4, 0, TAU);
    g.fill();
  }
  if (stage >= 3) {
    g.fillStyle = 'rgba(15,10,8,0.5)';
    g.beginPath();
    g.ellipse(s * 0.3, s * 0.55, s * 0.2, s * 0.14, -0.3, 0, TAU);
    g.fill();
  }
}

/** Static art of a complete building in local tile coordinates (0..size). */
export function paintBuildingBody(g: Ctx, type: BuildingType, size: number, stage: number, pxPerTile: number): void {
  const p: Pen = { g, ol: outlinePx(pxPerTile) / pxPerTile };
  BODY[type](p, size);
  paintDamage(p, size, stage);
}

// ---------------------------------------------------------------------------------------------
// Live layer

function smokePuffs(g: Ctx, x: number, y: number, now: number, seed: number, dark: boolean, scale = 1): void {
  for (let k = 0; k < 4; k++) {
    const t = ((now / 1600 + k / 4 + seed * 0.13) % 1 + 1) % 1;
    const r = (0.08 + t * 0.2) * scale;
    g.fillStyle = dark ? `rgba(45,40,38,${0.5 * (1 - t)})` : `rgba(215,210,200,${0.45 * (1 - t)})`;
    g.beginPath();
    g.arc(x + t * 0.35 * scale + Math.sin(t * 6 + seed) * 0.05, y - t * 0.7 * scale, r, 0, TAU);
    g.fill();
  }
}

function flames(g: Ctx, x: number, y: number, now: number, seed: number, scale: number): void {
  for (let k = 0; k < 5; k++) {
    const t = ((now / 520 + k / 5 + seed * 0.21) % 1 + 1) % 1;
    const r = (0.12 * (1 - t) + 0.03) * scale;
    g.fillStyle = k % 2 === 0 ? `rgba(255,${200 - t * 120},60,${0.9 * (1 - t)})` : `rgba(255,236,150,${0.8 * (1 - t)})`;
    g.beginPath();
    g.arc(x + Math.sin(t * 9 + k) * 0.06 * scale, y - t * 0.45 * scale, r, 0, TAU);
    g.fill();
  }
}

/** Where a building's live smoke rises from (local coordinates). */
const CHIMNEY: Partial<Record<BuildingType, [number, number]>> = {
  core: [0.55, 0.5],
  shack: [0.36, 0.78],
  salvageYard: [1.6, 0.25],
  armory: [1.5, 0.3],
  workshop: [1.55, 0.35],
  researchStation: [1.6, 0.85],
  dispatchHub: [0.4, 0.3],
};

/**
 * The moving parts of a building in local tile coordinates (0..size): animated props while
 * staffed, turret aim, smoke and fire from damage, worker pips. `night` (0..1) lights windows.
 */
export function paintBuildingLive(g: Ctx, b: BuildingSprite, now: number, pxPerTile: number, night: number): void {
  const p: Pen = { g, ol: outlinePx(pxPerTile) / pxPerTile };
  const s = b.size;
  const working = b.workers > 0;
  const seed = b.tileX * 7 + b.tileY * 13;
  switch (b.type) {
    case 'core': {
      const c = s / 2;
      const cy = c - HEIGHT.core / 2;
      const pulse = 0.5 + 0.5 * Math.sin(now / 420);
      const glow = g.createRadialGradient(c, cy, 0.02, c, cy, 0.36);
      glow.addColorStop(0, '#fff6c8');
      glow.addColorStop(0.45, `rgba(255,${190 + pulse * 30},90,1)`);
      glow.addColorStop(1, 'rgba(240,120,40,0.9)');
      shape(p, glow, circle(c, cy, 0.34));
      g.strokeStyle = `rgba(255,230,160,${0.35 + 0.35 * pulse})`;
      g.lineWidth = 0.035;
      g.beginPath();
      g.arc(c, cy, 0.22 + pulse * 0.06, 0, TAU);
      g.stroke();
      // pylon status lights blink teal in turn
      const lit = Math.floor(now / 500) % 4;
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].forEach(([dx, dy], k) => {
        g.fillStyle = k === lit ? COLORS.tealLight : COLORS.teal;
        g.beginPath();
        g.arc(c + (dx as number) * c * 0.66, cy + (dy as number) * c * 0.62, k === lit ? 0.07 : 0.05, 0, TAU);
        g.fill();
      });
      smokePuffs(g, 0.55, 0.45, now, seed, false, 0.8);
      break;
    }
    case 'oilWell': {
      // pumpjack: walking beam nods while staffed
      const phase = working ? Math.sin(now / 420) * 0.32 : 0.1;
      g.save();
      g.translate(0.5, 0.3);
      g.rotate(phase);
      shape(p, COLORS.rust, rect(-0.42, -0.055, 0.84, 0.11, 0.03));
      shape(p, '#2a2622', (gg) => {
        gg.moveTo(0.36, -0.12);
        gg.quadraticCurveTo(0.56, -0.02, 0.36, 0.12);
        gg.closePath();
      });
      shape(p, '#3a3632', rect(-0.5, -0.09, 0.14, 0.18, 0.03));
      shape(p, '#2a2622', circle(0, 0, 0.05));
      g.restore();
      break;
    }
    case 'salvageYard': {
      // crane boom swings slowly while staffed
      const a = 0.55 + (working ? Math.sin(now / 1500) * 0.5 : 0);
      g.save();
      g.translate(0.48, 0.5);
      g.rotate(a);
      shape(p, COLORS.hazard, rect(0, -0.055, 1.05, 0.11, 0.02));
      g.strokeStyle = 'rgba(30,25,20,0.6)';
      g.lineWidth = p.ol * 0.7;
      g.beginPath();
      for (let x = 0.1; x < 1.0; x += 0.14) {
        g.moveTo(x, -0.055);
        g.lineTo(x + 0.07, 0.055);
      }
      g.stroke();
      shape(p, '#3a3632', circle(1.05, 0, 0.1));
      shape(p, '#2d2a26', circle(0, 0, 0.12));
      g.restore();
      break;
    }
    case 'researchStation': {
      const a = -0.9 + (working ? Math.sin(now / 2200) * 0.6 : 0);
      g.save();
      g.translate(0.62, 0.55);
      g.rotate(a);
      shape(p, '#d9d4c6', ellipse(0, 0, 0.42, 0.26));
      shape(p, '#aaa496', ellipse(0, 0, 0.26, 0.16));
      lines(g, COLORS.outline, 0.04, () => {
        g.moveTo(0, 0);
        g.lineTo(0.34, 0);
      });
      shape(p, '#3a3833', circle(0.34, 0, 0.04));
      g.restore();
      // antenna with blinking research-blue lights
      lines(g, COLORS.outline, 0.04, () => {
        g.moveTo(s - 0.29, 0.17);
        g.lineTo(s - 0.29, -0.3);
      });
      const blink = working && Math.floor(now / 300 + seed) % 2 === 0;
      shape(p, blink ? '#bfe8ff' : '#355360', circle(s - 0.29, -0.3, 0.05));
      shape(p, working && !blink ? COLORS.research : '#355360', circle(s - 0.5, 1.12, 0.045));
      break;
    }
    case 'dispatchHub': {
      lines(g, COLORS.outline, 0.045, () => {
        g.moveTo(0.3, 0.3);
        g.lineTo(0.3, -0.35);
      });
      g.fillStyle = Math.floor(now / 600) % 2 === 0 ? '#ff5a3a' : '#7a2a1a';
      g.beginPath();
      g.arc(0.3, -0.35, 0.05, 0, TAU);
      g.fill();
      if (working) {
        const t = (now / 900) % 1;
        g.strokeStyle = `rgba(143,230,216,${1 - t})`;
        g.lineWidth = 0.03;
        g.beginPath();
        g.arc(0.3, -0.35, 0.12 + t * 0.5, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
      break;
    }
    case 'machineGunTower': {
      g.save();
      g.translate(s / 2, s / 2);
      g.rotate(b.aim ?? -Math.PI / 2);
      shape(p, '#26282a', rect(0.05, -0.04, 0.5, 0.08, 0.02));
      shape(p, '#1c1d1e', rect(0.48, -0.05, 0.08, 0.1));
      shape(p, COLORS.steel, circle(0, 0, 0.17));
      shape(p, COLORS.teal, rect(-0.14, -0.04, 0.1, 0.08), false);
      g.restore();
      break;
    }
    case 'watchtower': {
      // searchlight head (the beam itself is light, drawn by the renderer)
      const a = searchlightAngle(b.tileX, b.tileY, now);
      g.save();
      g.translate(s / 2, 0.3);
      g.rotate(a);
      shape(p, '#2e2b27', rect(-0.06, -0.08, 0.18, 0.16, 0.03));
      shape(p, night > 0.05 ? '#fffbe0' : '#c9c4b0', rect(0.1, -0.07, 0.04, 0.14), false);
      g.restore();
      break;
    }
    case 'signalTower': {
      const cx = s / 2;
      const cy = s / 2 - 0.35;
      // Pulsing red aviation beacon at the mast top
      const blink = (now % 1200) < 600;
      g.fillStyle = blink ? 'rgba(234, 74, 54, 0.95)' : 'rgba(120, 30, 20, 0.4)';
      g.beginPath();
      g.arc(cx, cy - 0.75, 0.08, 0, TAU);
      g.fill();
      if (blink) {
        const glow = g.createRadialGradient(cx, cy - 0.75, 0.02, cx, cy - 0.75, 0.45);
        glow.addColorStop(0, 'rgba(234, 74, 54, 0.85)');
        glow.addColorStop(1, 'rgba(234, 74, 54, 0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(cx, cy - 0.75, 0.45, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'barracks': {
      // teal flag flutters on its pole
      const wave = Math.sin(now / 260 + seed) * 0.05;
      lines(g, COLORS.outline, 0.04, () => {
        g.moveTo(s - 0.32, 0.5);
        g.lineTo(s - 0.32, -0.25);
      });
      shape(p, COLORS.teal, (gg) => {
        gg.moveTo(s - 0.32, -0.25);
        gg.quadraticCurveTo(s - 0.12, -0.2 + wave, s + 0.06, -0.16);
        gg.lineTo(s - 0.32, -0.02);
        gg.closePath();
      });
      break;
    }
    case 'workshop': {
      if (working && Math.floor(now / 90 + seed) % 5 < 2) {
        g.fillStyle = 'rgba(200,235,255,0.95)';
        g.beginPath();
        g.arc(1.3, 1.2, 0.05, 0, TAU);
        g.fill();
        lines(g, 'rgba(255,230,150,0.9)', 0.02, () => {
          for (let k = 0; k < 4; k++) {
            const a = k * 1.6 + now / 50;
            g.moveTo(1.3, 1.2);
            g.lineTo(1.3 + Math.cos(a) * 0.14, 1.2 + Math.sin(a) * 0.14);
          }
        });
      }
      break;
    }
    case 'greenhouse': {
      if (working && night > 0.05) {
        g.fillStyle = `rgba(200,120,255,${0.18 * night})`;
        g.fillRect(0.1, 0.1, s - 0.2, s - 0.2 - HEIGHT.greenhouse);
      }
      break;
    }
    default:
      break;
  }
  // lit windows / lamps at night when staffed (housing and the core always)
  if (night > 0.05 && (working || b.type === 'shack' || b.type === 'barracks')) {
    for (const [x, y] of LAMPS[b.type] ?? []) {
      g.fillStyle = `rgba(255,226,150,${0.85 * Math.min(1, night * 1.5)})`;
      g.beginPath();
      g.arc(x, y, 0.045, 0, TAU);
      g.fill();
    }
  }
  const chimney = CHIMNEY[b.type];
  if (chimney && working && b.type !== 'core') smokePuffs(g, chimney[0], chimney[1], now, seed, false, 0.7);
  const stage = damageStage(b.hp ?? 1);
  if (stage >= 2) smokePuffs(g, s * 0.62, s * 0.38, now, seed + 3, true, 0.6 + s * 0.25);
  if (stage >= 3) {
    flames(g, s * 0.3, s * 0.55, now, seed, 0.8 + s * 0.2);
    if (s > 1) flames(g, s * 0.7, s * 0.3, now, seed + 5, 0.7 + s * 0.2);
  }
  if (b.slots > 0) {
    for (let k = 0; k < b.slots; k++) {
      shape(p, k < b.workers ? COLORS.teal : 'rgba(20,18,14,0.7)', circle(0.18 + k * 0.17, s - 0.13, 0.06));
    }
  }
}

/** Window and lamp spots that light up at night (local coordinates). */
const LAMPS: Partial<Record<BuildingType, [number, number][]>> = {
  shack: [[1.22, 1.72]],
  barracks: [[1.26, 1.4]],
  salvageYard: [[1.5, 0.7]],
  greenhouse: [[0.4, 1.7]],
  researchStation: [[1.0, 1.65]],
  dispatchHub: [[0.5, 0.75]],
  armory: [[0.5, 1.2]],
  workshop: [[1.0, 1.1]],
};

/** Light spots of a building for the night light map (local coordinates, radius in tiles). */
export function buildingLampSpots(type: BuildingType): readonly [number, number][] {
  return LAMPS[type] ?? [];
}

/** Searchlight direction: a slow sweep, offset per tower so they do not move in lockstep. */
export function searchlightAngle(tileX: number, tileY: number, now: number): number {
  return Math.sin(now / 2600 + tileX * 0.7 + tileY * 1.3) * 1.5 + Math.PI / 2 + (((tileX + tileY) % 4) - 1.5) * 0.8;
}

// ---------------------------------------------------------------------------------------------
// Construction

/** A blueprint of the footprint with the real building rising from the bottom and scaffolding. */
function paintConstruction(g: Ctx, b: BuildingSprite, pxPerTile: number, now = 0): void {
  const p: Pen = { g, ol: outlinePx(pxPerTile) / pxPerTile };
  const s = b.size;
  g.fillStyle = 'rgba(127,216,240,0.16)';
  g.fillRect(0.05, 0.05, s - 0.1, s - 0.1);
  lines(g, 'rgba(127,216,240,0.35)', p.ol * 0.6, () => {
    for (let k = 0.25; k < s; k += 0.25) {
      g.moveTo(k, 0.05);
      g.lineTo(k, s - 0.05);
      g.moveTo(0.05, k);
      g.lineTo(s - 0.05, k);
    }
  });
  g.strokeStyle = COLORS.blueprint;
  g.lineWidth = p.ol * 1.3;
  g.setLineDash([0.16, 0.1]);
  g.strokeRect(0.05, 0.05, s - 0.1, s - 0.1);
  g.setLineDash([]);
  // the building itself, revealed from the bottom up
  const top = s * (1 - Math.max(0, Math.min(1, b.built)));
  g.save();
  g.beginPath();
  g.rect(-0.5, top, s + 1, s + 0.5 - top);
  g.clip();
  paintBuildingBody(g, b.type, s, 0, pxPerTile);
  g.restore();
  // scaffold poles and planks along the build line
  const y = Math.max(0.12, top);
  lines(g, COLORS.outline, 0.07, () => {
    for (const x of [0.12, s - 0.12]) {
      g.moveTo(x, s - 0.06);
      g.lineTo(x, y - 0.1);
    }
    g.moveTo(0.06, y);
    g.lineTo(s - 0.06, y);
  });
  lines(g, COLORS.wood, 0.04, () => {
    for (const x of [0.12, s - 0.12]) {
      g.moveTo(x, s - 0.06);
      g.lineTo(x, y - 0.1);
    }
    g.moveTo(0.06, y);
    g.lineTo(s - 0.06, y);
    if (s > 1) {
      g.moveTo(0.12, s - 0.1);
      g.lineTo(s - 0.12, y + 0.05);
    }
  });

  // Welding sparks if workers are present
  if (b.workers > 0 && now > 0) {
    const seed = b.tileX * 7 + b.tileY * 13;
    const sparkPhase = (now / 50 + seed) % 10;
    const sparkX = 0.2 + ((now * 0.0015 + seed * 0.1) % (s - 0.4));
    const sparkY = Math.max(0.1, y + Math.sin(now * 0.015 + seed) * 0.08);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(sparkX, sparkY, 0.05, 0, TAU);
    g.fill();
    for (let k = 0; k < 5; k++) {
      const a = k * 1.25 + sparkPhase;
      const dist = 0.06 + ((k * 0.03 + sparkPhase * 0.02) % 0.14);
      g.fillStyle = k % 2 === 0 ? '#ffd98a' : '#8fe6d8';
      g.fillRect(sparkX + Math.cos(a) * dist, sparkY + Math.sin(a) * dist, 0.025, 0.025);
    }
  }
}

/** Full procedural drawing (start screen preview, HUD icons, placement ghost) at tile position. */
export function drawBuilding(g: Ctx, b: BuildingSprite, now: number): void {
  const t = g.getTransform();
  const pxPerTile = Math.max(1, Math.hypot(t.a, t.b));
  g.save();
  g.translate(b.tileX, b.tileY);
  if (b.built < 1) paintConstruction(g, b, pxPerTile, now);
  else {
    paintBuildingBody(g, b.type, b.size, damageStage(b.hp ?? 1), pxPerTile);
    paintBuildingLive(g, b, now, pxPerTile, 0);
  }
  g.restore();
}

/** The construction view in local coordinates, for the renderer (not cached: sites change every tick). */
export function paintBuildingSite(g: Ctx, b: BuildingSprite, pxPerTile: number, now = 0): void {
  paintConstruction(g, b, pxPerTile, now);
}

// ---------------------------------------------------------------------------------------------
// Nests

/** Static organic growth of a nest or the hive in local coordinates (0..size). */
export function paintNestBody(g: Ctx, size: number, isHive: boolean, pxPerTile: number): void {
  const p: Pen = { g, ol: outlinePx(pxPerTile) / pxPerTile };
  const c = size / 2;
  const r = size / 2;
  // creeping tendrils over the ground
  const n = isHive ? 11 : 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.4;
    const pts: [number, number][] = [
      [c + Math.cos(a) * r * 0.5, c + Math.sin(a) * r * 0.45],
      [c + Math.cos(a + 0.35) * r * 0.95, c + Math.sin(a + 0.35) * r * 0.9],
      [c + Math.cos(a + 0.1) * r * 1.3, c + Math.sin(a + 0.1) * r * 1.25],
    ];
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(pts[0]![0], pts[0]![1]);
    g.quadraticCurveTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
    g.strokeStyle = COLORS.outline;
    g.lineWidth = 0.13 + p.ol * 2;
    g.stroke();
    g.strokeStyle = COLORS.fleshDark;
    g.lineWidth = 0.13;
    g.stroke();
    g.lineCap = 'butt';
  }
  // the mound: lumpy rings of flesh
  shape(p, COLORS.fleshDark, ellipse(c, c + 0.1, r * 0.95, r * 0.82));
  shape(p, COLORS.nest, ellipse(c, c, r * 0.92, r * 0.8, 0.2));
  const lumps = isHive ? 9 : 5;
  for (let k = 0; k < lumps; k++) {
    const a = k * 2.4 + 0.5;
    const lr = r * (0.16 + (k % 3) * 0.04);
    shape(p, k % 2 ? COLORS.nestLight : COLORS.flesh, circle(c + Math.cos(a) * r * 0.5, c + Math.sin(a) * r * 0.42, lr));
    g.fillStyle = 'rgba(255,220,235,0.3)';
    g.beginPath();
    g.arc(c + Math.cos(a) * r * 0.5 - lr * 0.3, c + Math.sin(a) * r * 0.42 - lr * 0.3, lr * 0.4, 0, TAU);
    g.fill();
  }
  // bone spurs on the hive
  if (isHive) {
    shape(p, COLORS.bone, (gg) => {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + 0.2;
        const bx = c + Math.cos(a) * r * 0.7;
        const by = c + Math.sin(a) * r * 0.62;
        gg.moveTo(bx - 0.08, by);
        gg.lineTo(bx + Math.cos(a) * 0.45, by + Math.sin(a) * 0.4 - 0.15);
        gg.lineTo(bx + 0.08, by);
        gg.closePath();
      }
    });
  }
  // the opening
  shape(p, '#2a0a18', ellipse(c, c, r * 0.3, r * 0.24));
}

/** The pulsing core of a nest (live): an acid-bright opening that throbs. */
export function paintNestLive(g: Ctx, size: number, isHive: boolean, now: number, seed: number): void {
  const c = size / 2;
  const r = size / 2;
  const pulse = 0.5 + 0.5 * Math.sin(now / (isHive ? 480 : 640) + seed);
  const glow = g.createRadialGradient(c, c, 0, c, c, r * 0.32);
  glow.addColorStop(0, `rgba(255,${200 + pulse * 40},120,${0.75 + 0.25 * pulse})`);
  glow.addColorStop(0.5, `rgba(255,90,138,${0.6 + 0.3 * pulse})`);
  glow.addColorStop(1, 'rgba(120,20,60,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.ellipse(c, c, r * (0.26 + pulse * 0.05), r * (0.2 + pulse * 0.04), 0, 0, TAU);
  g.fill();
}

/** Full procedural nest (HUD icons). */
export function drawNest(g: Ctx, tileX: number, tileY: number, size: number, isHive: boolean, _level: number, now: number): void {
  const t = g.getTransform();
  const pxPerTile = Math.max(1, Math.hypot(t.a, t.b));
  g.save();
  g.translate(tileX, tileY);
  paintNestBody(g, size, isHive, pxPerTile);
  paintNestLive(g, size, isHive, now, tileX);
  g.restore();
}
