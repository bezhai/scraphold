/**
 * Overlays that explain the game state on top of the world: identity and selection rings under
 * units, selection corners on structures, weapon and vision ranges, HP bars (only when damaged
 * or selected), the rally flag, the placement ghost with its bonus tiles and label, where
 * tonight's attack comes from or is now, incident targets, the relay and the hive, the drag box,
 * veteran / boss marks, the flag over units under the player's command and the rings of a
 * broadcasting signal tower.
 */
import { mutantWeapon, soldierWeapon, towerWeapon, towerWeaponOfType, visionRadius, type GameView } from '../../sim';
import { BUILDINGS } from '../../sim/data/economy';
import { edgeAnchor, worldToScreen, type Camera, type EdgeAnchor, type MarkerArea, type ScreenRect } from '../camera';
import { placementPreview } from '../hud/buildMenu';
import { threatMarkers } from '../hud/threatMarkers';
import type { Session } from '../session';
import { isNestKnown, isTileVisible, type EntityView } from '../view';
import { drawBuilding } from './drawBuildings';
import type { ObjectiveKind, ObjectiveMarker } from './objectiveMarkers';
import { COLORS, hpColor } from './palette';
import { devicePoint, deviceTransformOf, createPixelSprites } from './pixelSprites';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

const FONT = '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

export interface UnitMark {
  x: number;
  y: number;
  /** Drawn body diameter in tiles. */
  d: number;
  player: boolean;
  /** A player unit under the player's command (its `control` is 'player'): it gets the command flag. */
  commanded: boolean;
}

const identityRings = createPixelSprites({ maxEntries: 120, perFrame: 12 });

function paintIdentityRing(g: Ctx, w: number, h: number, rx: number, ry: number, lineWidth: number): void {
  g.strokeStyle = COLORS.teal;
  g.lineWidth = lineWidth;
  g.beginPath();
  g.ellipse(w / 2, h / 2, rx, ry, 0, 0, TAU);
  g.stroke();
}

/**
 * Faint teal identity rings under every player unit (one sprite per body size at the exact zoom,
 * copied 1:1), bright accent rings under the selected ones (player) or danger red (a selected
 * mutant). `g` draws in world tiles.
 */
export function drawUnitRings(g: Ctx, marks: readonly UnitMark[], selected: readonly UnitMark[], px: number, night: number): void {
  const t = deviceTransformOf(g);
  identityRings.beginFrame();
  const lineWidth = Math.max(1.5, 0.035 * t.k);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.55 + 0.25 * night;
  for (const m of marks) {
    if (!m.player) continue;
    const rx = (m.d * 0.5 + 0.04) * t.k;
    const ry = rx * 0.72;
    const side = Math.ceil(rx * 2 + lineWidth + 2);
    const p = devicePoint(t, m.x, m.y + m.d * 0.12);
    const ring = identityRings.get(`${m.d}:${Math.round(t.k * 100)}`, side, side, (c, w, h) => paintIdentityRing(c, w, h, rx, ry, lineWidth));
    if (ring) g.drawImage(ring, p.x - side / 2, p.y - side / 2);
    else {
      g.translate(p.x - side / 2, p.y - side / 2);
      paintIdentityRing(g, side, side, rx, ry, lineWidth);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  g.restore();
  for (const m of selected) {
    const r = m.d * 0.5 + 0.08;
    g.lineWidth = Math.max(3.5 * px, 0.06);
    g.strokeStyle = COLORS.outline;
    g.beginPath();
    g.ellipse(m.x, m.y + m.d * 0.12, r, r * 0.72, 0, 0, TAU);
    g.stroke();
    g.lineWidth = Math.max(2 * px, 0.04);
    g.strokeStyle = m.player ? COLORS.accent : COLORS.danger;
    g.stroke();
  }
}

/** Height of a health bar in screen pixels. */
const BAR_PX = 4;

/** The health bar over a unit, in tiles. */
export function unitBarRect(m: UnitMark, px: number): { x: number; y: number; w: number; h: number } {
  const w = Math.max(0.5, m.d * 0.85);
  return { x: m.x - w / 2, y: m.y - m.d * 0.5 - 0.2, w, h: BAR_PX * px };
}

/**
 * A pennant on a short pole beside a unit under the player's command, in tiles: the pole stands at
 * the unit's left, just outside its health bar, and the pennant flies away from the unit, so neither
 * covers the bar nor the veteran star at the upper right.
 */
export interface CommandFlag {
  /** The pole. */
  x: number;
  baseY: number;
  topY: number;
  /** The pennant: from the top of the pole to its tip, back to the pole at lowY. */
  tipX: number;
  tipY: number;
  lowY: number;
}

/** Flag size unit in tiles at the default zoom; never under FLAG_MIN_PX screen pixels when zoomed out. */
const FLAG_UNIT = 0.19;
const FLAG_MIN_PX = 5.5;

export function commandFlags(marks: readonly UnitMark[], px: number): CommandFlag[] {
  const s = Math.max(FLAG_UNIT, FLAG_MIN_PX * px);
  const flags: CommandFlag[] = [];
  for (const m of marks) {
    if (!m.commanded) continue;
    const x = Math.min(m.x - m.d * 0.5, unitBarRect(m, px).x - 2 * px);
    const baseY = m.y - m.d * 0.05;
    const topY = baseY - 2 * s;
    flags.push({ x, baseY, topY, tipX: x - 1.3 * s, tipY: topY + 0.42 * s, lowY: topY + 0.85 * s });
  }
  return flags;
}

/** The command flags, batched: dark poles, then orange pennants with the shared outline. Drawn over the light map, like the health bars. */
export function drawCommandFlags(g: Ctx, flags: readonly CommandFlag[], px: number): void {
  if (flags.length === 0) return;
  g.lineCap = 'round';
  g.strokeStyle = COLORS.outline;
  g.lineWidth = Math.max(2 * px, 0.045);
  g.beginPath();
  for (const f of flags) {
    g.moveTo(f.x, f.baseY);
    g.lineTo(f.x, f.topY);
  }
  g.stroke();
  g.lineCap = 'butt';
  g.beginPath();
  for (const f of flags) {
    g.moveTo(f.x, f.topY);
    g.lineTo(f.tipX, f.tipY);
    g.lineTo(f.x, f.lowY);
    g.closePath();
  }
  g.fillStyle = COLORS.accent;
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(0.8 * px, 0.025);
  g.stroke();
}

export function drawBossRing(g: Ctx, x: number, y: number, d: number, now: number): void {
  g.strokeStyle = `rgba(234,74,54,${0.55 + 0.3 * Math.sin(now / 200)})`;
  g.lineWidth = d * 0.05;
  g.beginPath();
  g.arc(x, y, d * 0.62, 0, TAU);
  g.stroke();
}

export function drawVeteranMark(g: Ctx, x: number, y: number, d: number, pending: boolean, now: number): void {
  const pulse = pending ? 0.6 + 0.4 * Math.sin(now / 160) : 1;
  const cx = x + d * 0.42;
  const cy = y - d * 0.42;
  g.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5;
    const px = cx + Math.cos(a) * 0.13;
    const py = cy + Math.sin(a) * 0.13;
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = `rgba(255,216,74,${pulse})`;
  g.fill();
  g.strokeStyle = COLORS.outline;
  g.lineWidth = 0.025;
  g.stroke();
}

export function drawPlacementGrid(g: Ctx, hx: number, hy: number, v: GameView, px: number): void {
  const r = 7;
  const cx = Math.floor(hx);
  const cy = Math.floor(hy);
  g.lineWidth = px;
  for (let x = cx - r; x <= cx + r + 1; x++) {
    if (x < 0 || x > v.map.width) continue;
    g.strokeStyle = `rgba(255,245,220,${0.22 * (1 - Math.abs(x - hx) / (r + 1))})`;
    g.beginPath();
    g.moveTo(x, Math.max(0, cy - r));
    g.lineTo(x, Math.min(v.map.height, cy + r + 1));
    g.stroke();
  }
  for (let y = cy - r; y <= cy + r + 1; y++) {
    if (y < 0 || y > v.map.height) continue;
    g.strokeStyle = `rgba(255,245,220,${0.22 * (1 - Math.abs(y - hy) / (r + 1))})`;
    g.beginPath();
    g.moveTo(Math.max(0, cx - r), y);
    g.lineTo(Math.min(v.map.width, cx + r + 1), y);
    g.stroke();
  }
}

export function drawRally(g: Ctx, session: Session, v: GameView, px: number, now: number): void {
  if (session.selection.length !== 1) return;
  const b = v.entities.get(session.selection[0] as number);
  if (!b || b.kind !== 'building' || !b.rally) return;
  g.strokeStyle = 'rgba(143,230,216,0.85)';
  g.lineWidth = 2 * px;
  g.setLineDash([6 * px, 5 * px]);
  g.lineDashOffset = -now / 40;
  g.beginPath();
  g.moveTo(b.x, b.y);
  g.lineTo(b.rally.x, b.rally.y);
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = COLORS.outline;
  g.lineWidth = 2.5 * px;
  g.beginPath();
  g.moveTo(b.rally.x, b.rally.y);
  g.lineTo(b.rally.x, b.rally.y - 0.7);
  g.stroke();
  g.fillStyle = COLORS.teal;
  g.beginPath();
  g.moveTo(b.rally.x, b.rally.y - 0.7);
  g.lineTo(b.rally.x + 0.42, b.rally.y - 0.56);
  g.lineTo(b.rally.x, b.rally.y - 0.42);
  g.closePath();
  g.fill();
  g.lineWidth = 1.2 * px;
  g.stroke();
}

function corners(g: Ctx, x: number, y: number, s: number, len: number): void {
  g.beginPath();
  g.moveTo(x, y + len);
  g.lineTo(x, y);
  g.lineTo(x + len, y);
  g.moveTo(x + s - len, y);
  g.lineTo(x + s, y);
  g.lineTo(x + s, y + len);
  g.moveTo(x + s, y + s - len);
  g.lineTo(x + s, y + s);
  g.lineTo(x + s - len, y + s);
  g.moveTo(x + len, y + s);
  g.lineTo(x, y + s);
  g.lineTo(x, y + s - len);
  g.stroke();
}

export function drawStructureMarks(g: Ctx, v: GameView, selected: ReadonlySet<number>, hovered: EntityView | null, px: number): void {
  for (const id of selected) {
    const e = v.entities.get(id);
    if (!e || (e.kind !== 'building' && e.kind !== 'nest')) continue;
    const len = Math.min(0.5, e.size * 0.3);
    g.strokeStyle = COLORS.outline;
    g.lineWidth = 4.5 * px;
    corners(g, e.tileX - 0.08, e.tileY - 0.08, e.size + 0.16, len);
    g.strokeStyle = e.faction === 'player' ? COLORS.accent : COLORS.danger;
    g.lineWidth = 2.5 * px;
    corners(g, e.tileX - 0.08, e.tileY - 0.08, e.size + 0.16, len);
  }
  if (hovered && !selected.has(hovered.id) && (hovered.kind === 'building' || hovered.kind === 'nest')) {
    g.strokeStyle = 'rgba(240,138,60,0.6)';
    g.lineWidth = 1.5 * px;
    corners(g, hovered.tileX - 0.05, hovered.tileY - 0.05, hovered.size + 0.1, Math.min(0.4, hovered.size * 0.3));
  }
}

/** Range circles for at most this many selected units (plus the hovered one). */
const MAX_RANGE_PREVIEWS = 6;

function rangeCircle(g: Ctx, x: number, y: number, r: number, px: number, color: string, dashed: boolean): void {
  g.strokeStyle = color;
  g.lineWidth = 1.5 * px;
  if (dashed) g.setLineDash([5 * px, 4 * px]);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.stroke();
  g.setLineDash([]);
}

export function drawRanges(
  g: Ctx,
  session: Session,
  v: GameView,
  selected: ReadonlySet<number>,
  hovered: EntityView | null,
  unitPos: ReadonlyMap<number, { x: number; y: number }>,
  px: number,
): void {
  const targets: EntityView[] = [];
  if (selected.size <= MAX_RANGE_PREVIEWS) for (const id of selected) targets.push(v.entities.get(id) as EntityView);
  if (hovered && !selected.has(hovered.id)) targets.push(hovered);
  const game = session.game;
  for (const e of targets) {
    if (!e) continue;
    // Ranges are edge to edge: the circle around a unit's center adds its radius.
    if (e.kind === 'soldier') {
      const p = unitPos.get(e.id) ?? e;
      const w = soldierWeapon(game, e);
      const range = w.range + e.radius;
      g.fillStyle = 'rgba(255,245,220,0.05)';
      g.beginPath();
      g.arc(p.x, p.y, range, 0, TAU);
      g.fill();
      rangeCircle(g, p.x, p.y, range, px, 'rgba(255,245,220,0.6)', true);
      if (w.minRange > 0) rangeCircle(g, p.x, p.y, w.minRange + e.radius, px, 'rgba(234,74,54,0.6)', true);
    } else if (e.kind === 'mutant') {
      const p = unitPos.get(e.id) ?? e;
      rangeCircle(g, p.x, p.y, mutantWeapon(e).range + e.radius, px, 'rgba(234,74,54,0.55)', true);
    } else if (e.kind === 'building') {
      const w = towerWeapon(game, e);
      if (w) rangeCircle(g, e.x, e.y, w.range + e.size / 2, px, 'rgba(255,245,220,0.6)', true);
      if (e.type === 'watchtower' && e.construction === null) rangeCircle(g, e.x, e.y, visionRadius(game, e), px, 'rgba(143,230,216,0.45)', true);
    }
  }
}

interface Bar {
  x: number;
  y: number;
  w: number;
  fraction: number;
  color: string;
}

/** HP / progress bars batched into one path per color (hundreds of bars in a big fight). */
function drawBars(g: Ctx, bars: readonly Bar[], h: number, px: number): void {
  if (bars.length === 0) return;
  g.fillStyle = 'rgba(26,21,16,0.85)';
  g.beginPath();
  for (const b of bars) g.rect(b.x - px, b.y - px, b.w + 2 * px, h + 2 * px);
  g.fill();
  const byColor = new Map<string, Bar[]>();
  for (const b of bars) {
    const list = byColor.get(b.color);
    if (list) list.push(b);
    else byColor.set(b.color, [b]);
  }
  for (const [color, list] of byColor) {
    g.fillStyle = color;
    g.beginPath();
    for (const b of list) g.rect(b.x, b.y, b.w * Math.max(0, Math.min(1, b.fraction)), h);
    g.fill();
  }
}

export function drawHealthBars(
  g: Ctx,
  v: GameView,
  selected: ReadonlySet<number>,
  hovered: EntityView | null,
  units: ReadonlyMap<number, UnitMark>,
  bounds: { x0: number; y0: number; x1: number; y1: number },
  px: number,
): void {
  const h = BAR_PX * px;
  const bars: Bar[] = [];
  for (const e of v.entities.values()) {
    if (e.hp <= 0) continue;
    const always = selected.has(e.id) || hovered?.id === e.id;
    if (e.kind === 'building' || e.kind === 'nest') {
      if (e.tileX > bounds.x1 + 1 || e.tileY > bounds.y1 + 1 || e.tileX + e.size < bounds.x0 || e.tileY + e.size < bounds.y0) continue;
      if (e.kind === 'nest' && !isNestKnown(v, e)) continue;
      if (e.kind === 'building' && e.construction) {
        bars.push({ x: e.tileX + 0.15, y: e.tileY + e.size + 0.08, w: e.size - 0.3, fraction: e.construction.progress / Math.max(1, e.construction.total), color: COLORS.blueprint });
        continue;
      }
      if (e.hp < e.maxHp || always) bars.push({ x: e.tileX + 0.1, y: e.tileY - 0.26, w: e.size - 0.2, fraction: e.hp / e.maxHp, color: e.faction === 'player' ? hpColor(e.hp / e.maxHp) : COLORS.danger });
      continue;
    }
    const m = units.get(e.id);
    if (!m) continue;
    if (!(e.hp < e.maxHp || always)) continue;
    const r = unitBarRect(m, px);
    bars.push({ x: r.x, y: r.y, w: r.w, fraction: e.hp / e.maxHp, color: e.faction === 'player' ? hpColor(e.hp / e.maxHp) : COLORS.danger });
  }
  drawBars(g, bars, h, px);
}

const GHOST_TINT = { valid: COLORS.valid, unavailable: COLORS.unavailable, blocked: COLORS.blocked } as const;

export function drawGhost(g: Ctx, session: Session, px: number, now: number): void {
  const type = session.placing;
  const hover = session.hover;
  if (!type || !hover) return;
  const p = placementPreview(session.game, type, hover.x, hover.y);
  const tint = GHOST_TINT[p.status];
  for (const i of p.bonusTiles) {
    const tx = i % session.game.state.map.width;
    const ty = Math.floor(i / session.game.state.map.width);
    g.fillStyle = 'rgba(127,211,106,0.26)';
    g.fillRect(tx + 0.08, ty + 0.08, 0.84, 0.84);
    g.strokeStyle = 'rgba(127,211,106,0.9)';
    g.lineWidth = 1.5 * px;
    g.strokeRect(tx + 0.08, ty + 0.08, 0.84, 0.84);
  }
  g.fillStyle = tint;
  g.globalAlpha = 0.2;
  g.fillRect(p.tileX, p.tileY, p.size, p.size);
  g.globalAlpha = 0.72;
  drawBuilding(g, { type, tileX: p.tileX, tileY: p.tileY, size: p.size, built: 1, workers: 0, slots: 0, aim: null }, now);
  g.globalAlpha = 1;
  g.strokeStyle = COLORS.outline;
  g.lineWidth = 4 * px;
  g.strokeRect(p.tileX, p.tileY, p.size, p.size);
  g.strokeStyle = tint;
  g.lineWidth = 2 * px;
  g.setLineDash([7 * px, 4 * px]);
  g.lineDashOffset = -now / 60;
  g.strokeRect(p.tileX, p.tileY, p.size, p.size);
  g.setLineDash([]);
  const tower = towerWeaponOfType(session.game, type);
  if (tower) rangeCircle(g, p.tileX + p.size / 2, p.tileY + p.size / 2, tower.range + p.size / 2, px, 'rgba(255,245,220,0.6)', true);
}

export function drawGhostLabel(g: Ctx, session: Session): void {
  const type = session.placing;
  const hover = session.hover;
  if (!type || !hover) return;
  const p = placementPreview(session.game, type, hover.x, hover.y);
  const s = worldToScreen(session.camera, p.tileX + p.size / 2, p.tileY + p.size);
  const lines: { text: string; color: string }[] = [{ text: BUILDINGS[type].name, color: '#f4ead2' }];
  if (p.bonusPct !== null) lines.push({ text: `产出加成 +${Math.round(p.bonusPct * 100)}%`, color: p.bonusPct > 0 ? '#a8e88a' : '#c9bda0' });
  if (!p.availability.ok) lines.push({ text: p.availability.reason, color: p.status === 'blocked' ? '#ff9a80' : '#f5cf72' });
  g.font = `600 13px ${FONT}`;
  const w = Math.max(...lines.map((l) => g.measureText(l.text).width)) + 18;
  const h = lines.length * 18 + 8;
  const x = s.x - w / 2;
  const y = s.y + 10;
  g.fillStyle = 'rgba(20,17,13,0.78)';
  g.beginPath();
  g.roundRect(x, y, w, h, 4);
  g.fill();
  g.strokeStyle = 'rgba(240,138,60,0.35)';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = GHOST_TINT[p.status];
  g.fillRect(x, y + 3, 3, h - 6);
  lines.forEach((l, i) => {
    g.fillStyle = l.color;
    g.fillText(l.text, x + 10, y + 18 + i * 18);
  });
}

/**
 * Edge arrows keep their center this far (CSS pixels) from the screen edges and from every HUD
 * panel: the arrow reaches about 20 px from its center, plus a small gap.
 */
const MARKER_CLEARANCE = 24;

/**
 * Where edge markers may sit: the screen less MARKER_CLEARANCE, outside the HUD panels (`panels`,
 * measured from the page by ui/GameScreen.tsx) grown by the same clearance.
 */
export function markerArea(cam: Camera, panels: readonly ScreenRect[]): MarkerArea {
  const c = MARKER_CLEARANCE;
  return {
    bounds: { x0: c, y0: c, x1: cam.viewW - c, y1: cam.viewH - c },
    blocked: panels.map((r) => ({ x0: r.x0 - c, y0: r.y0 - c, x1: r.x1 + c, y1: r.y1 + c })),
  };
}

interface TagStyle {
  bg: string;
  text: string;
  /** Accent bar on the left edge. */
  bar?: string;
  border?: string;
  dashed?: boolean;
}

const TAG_H = 22;

function tagWidth(g: Ctx, text: string): number {
  return g.measureText(text).width + 16;
}

/** A label tag centered on `cx` with its top at `y` (CSS pixels, the font already set). */
function drawTag(g: Ctx, text: string, cx: number, y: number, style: TagStyle): void {
  const w = tagWidth(g, text);
  g.fillStyle = style.bg;
  g.beginPath();
  g.roundRect(cx - w / 2, y, w, TAG_H, 4);
  g.fill();
  if (style.border) {
    g.strokeStyle = style.border;
    g.lineWidth = 1;
    if (style.dashed) g.setLineDash([4, 3]);
    g.stroke();
    g.setLineDash([]);
  }
  if (style.bar) {
    g.fillStyle = style.bar;
    g.fillRect(cx - w / 2, y + 3, 3, TAG_H - 6);
  }
  g.fillStyle = style.text;
  g.fillText(text, cx - w / 2 + 8, y + 16);
}

/**
 * Center x and top of the label (`w` wide) of an edge arrow at `a` pointing along `a.angle`:
 * beside the arrow on the side toward the middle of the screen, away from the screen edge or the
 * HUD panel the arrow sits against.
 */
function edgeTagPlace(a: EdgeAnchor, w: number): { cx: number; top: number } {
  return { cx: a.x - Math.cos(a.angle) * (w / 2 + 20), top: a.y - Math.sin(a.angle) * (TAG_H / 2 + 22) - TAG_H / 2 };
}

/** Bold single chevron pointing along +x at the origin (callers translate and rotate). */
function chevronPath(g: Ctx): void {
  g.beginPath();
  g.moveTo(-12, -13);
  g.lineTo(4, 0);
  g.lineTo(-12, 13);
  g.lineTo(-4, 13);
  g.lineTo(12, 0);
  g.lineTo(-4, -13);
  g.closePath();
}

const THREAT_TAG: TagStyle = { bg: 'rgba(30,12,10,0.8)', text: '#ffb8a6' };

/**
 * Tonight's threat (hud/threatMarkers): at dusk where each forecast group will appear, at night
 * where the attackers are now. A target in the free screen area (`area`, see markerArea) gets its
 * marker on the spot (live attackers only while they are hidden in the fog); others get an arrow
 * at the screen edge, or at the edge of the HUD panel in the way, pointing at them, labeled on
 * its inner side. Drawn in CSS pixels.
 */
export function drawThreatMarkers(g: Ctx, v: GameView, cam: Camera, area: MarkerArea, now: number): void {
  const markers = threatMarkers(v);
  if (markers.length === 0) return;
  const pulse = 0.72 + 0.28 * Math.sin(now / 260);
  g.font = `700 13px ${FONT}`;
  for (const m of markers) {
    const a = edgeAnchor(cam, m.x, m.y, area);
    if (a.onScreen && m.kind === 'live' && isTileVisible(v, m.x, m.y)) continue;
    g.save();
    g.translate(a.x, a.y);
    if (a.onScreen) {
      g.strokeStyle = COLORS.outline;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(0, 0, 13, 0, TAU);
      g.stroke();
      g.strokeStyle = `rgba(234,74,54,${pulse})`;
      g.lineWidth = 3;
      g.stroke();
    } else {
      g.rotate(a.angle);
      g.fillStyle = `rgba(234,74,54,${pulse})`;
      g.strokeStyle = COLORS.outline;
      g.lineWidth = 1.5;
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        g.moveTo(-14 + k * 12, -12);
        g.lineTo(-2 + k * 12, 0);
        g.lineTo(-14 + k * 12, 12);
        g.lineTo(-8 + k * 12, 12);
        g.lineTo(4 + k * 12, 0);
        g.lineTo(-8 + k * 12, -12);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    g.restore();
    const tag = a.onScreen ? { cx: a.x, top: a.y + 18 } : edgeTagPlace(a, tagWidth(g, m.label));
    drawTag(g, m.label, tag.cx, tag.top, THREAT_TAG);
  }
}

/** Colors per objective kind: accepted targets solid orange, undecided ones a translucent dashed cream. */
const OBJECTIVE_STYLE: Record<ObjectiveKind, { rgb: string; tag: TagStyle }> = {
  target: { rgb: '240,138,60', tag: { bg: 'rgba(20,17,13,0.86)', text: '#ffd9b8', bar: COLORS.accent } },
  pendingTarget: { rgb: '244,234,210', tag: { bg: 'rgba(20,17,13,0.5)', text: 'rgba(244,234,210,0.92)', border: 'rgba(244,234,210,0.65)', dashed: true } },
  relay: { rgb: '255,210,122', tag: { bg: 'rgba(20,17,13,0.8)', text: '#ffdca8' } },
  hive: { rgb: '234,74,54', tag: { bg: 'rgba(30,12,10,0.8)', text: '#ffb8a6' } },
};

/**
 * Ring around an incident target on screen (CSS pixels, radius `r`): accepted targets get a solid
 * pulsing orange ring with four notches and a faint fill, undecided ones only a dashed,
 * translucent cream ring, so the two never read alike.
 */
function drawTargetRing(g: Ctx, x: number, y: number, r: number, pending: boolean, pulse: number, now: number): void {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  if (pending) {
    g.setLineDash([7, 5]);
    g.lineDashOffset = -now / 90;
    g.strokeStyle = 'rgba(26,21,16,0.45)';
    g.lineWidth = 3.5;
    g.stroke();
    g.strokeStyle = 'rgba(244,234,210,0.75)';
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);
  } else {
    g.fillStyle = `rgba(240,138,60,${0.1 + 0.06 * pulse})`;
    g.fill();
    g.strokeStyle = COLORS.outline;
    g.lineWidth = 4.5;
    g.stroke();
    g.strokeStyle = `rgba(240,138,60,${0.75 + 0.25 * pulse})`;
    g.lineWidth = 2.5;
    g.stroke();
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const c = Math.cos((k * Math.PI) / 2);
      const sn = Math.sin((k * Math.PI) / 2);
      g.moveTo(c * (r + 7), sn * (r + 7));
      g.lineTo(c * (r - 5), sn * (r - 5));
    }
    g.strokeStyle = COLORS.outline;
    g.lineWidth = 4.5;
    g.stroke();
    g.strokeStyle = COLORS.accent;
    g.lineWidth = 2.5;
    g.stroke();
  }
  g.restore();
}

/**
 * Objectives (objectiveMarkers.ts) in CSS pixels. In the free screen area (`area`), an incident
 * target gets a ring just outside its reach with the label below it; the relay and the hive only
 * get their label above the footprint, pointing down at it, so nothing covers the structure.
 * Otherwise each gets an arrow at the screen edge (or the edge of the HUD panel in the way), like
 * the threat markers, labeled on its inner side: solid for accepted targets, a dashed outline for
 * undecided ones.
 */
export function drawObjectiveMarkers(g: Ctx, markers: readonly ObjectiveMarker[], cam: Camera, area: MarkerArea, now: number): void {
  if (markers.length === 0) return;
  const pulse = 0.5 + 0.5 * Math.sin(now / 280);
  g.font = `700 12px ${FONT}`;
  for (const m of markers) {
    const style = OBJECTIVE_STYLE[m.kind];
    const a = edgeAnchor(cam, m.x, m.y, area);
    const pending = m.kind === 'pendingTarget';
    if (a.onScreen) {
      const r = m.reach * cam.zoom;
      if (m.kind === 'target' || pending) {
        drawTargetRing(g, a.x, a.y, r + 4, pending, pulse, now);
        drawTag(g, m.label, a.x, a.y + r + 14, style.tag);
      } else {
        const top = a.y - r - 10 - TAG_H;
        drawTag(g, m.label, a.x, top, style.tag);
        g.fillStyle = `rgba(${style.rgb},0.9)`;
        g.strokeStyle = COLORS.outline;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(a.x - 6, top + TAG_H);
        g.lineTo(a.x + 6, top + TAG_H);
        g.lineTo(a.x, top + TAG_H + 7);
        g.closePath();
        g.fill();
        g.stroke();
      }
      continue;
    }
    g.save();
    g.translate(a.x, a.y);
    g.rotate(a.angle);
    chevronPath(g);
    if (pending) {
      g.fillStyle = 'rgba(244,234,210,0.3)';
      g.fill();
      g.strokeStyle = 'rgba(26,21,16,0.55)';
      g.lineWidth = 3.5;
      g.stroke();
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(244,234,210,0.95)';
      g.lineWidth = 2;
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = `rgba(${style.rgb},${m.kind === 'target' ? 0.8 + 0.2 * pulse : 0.75 + 0.25 * pulse})`;
      g.fill();
      g.strokeStyle = COLORS.outline;
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.restore();
    const tag = edgeTagPlace(a, tagWidth(g, m.label));
    drawTag(g, m.label, tag.cx, tag.top, style.tag);
  }
}

export function drawDragBox(g: Ctx, b: { x0: number; y0: number; x1: number; y1: number }): void {
  g.fillStyle = 'rgba(240,138,60,0.08)';
  g.strokeStyle = 'rgba(240,138,60,0.9)';
  g.lineWidth = 1;
  const x = Math.min(b.x0, b.x1);
  const y = Math.min(b.y0, b.y1);
  g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
}

export function drawBroadcastPulseRings(g: Ctx, v: GameView, now: number): void {
  const site = v.signal.site;
  if (v.signal.stage !== 'broadcast' || !site) return;
  const cx = site.tileX + site.size / 2;
  const cy = site.tileY + site.size / 2;
  const period = 2500;
  const rings = 3;

  for (let i = 0; i < rings; i++) {
    const phase = ((now + i * (period / rings)) % period) / period; // 0..1
    const radius = 4 + phase * 6; // 4 to 10 tiles
    const alpha = (1 - phase) * 0.7;

    g.beginPath();
    g.arc(cx, cy, radius, 0, TAU);
    g.strokeStyle = `rgba(127, 216, 240, ${alpha})`;
    g.lineWidth = 0.14;
    g.stroke();

    g.beginPath();
    g.arc(cx, cy, radius * 0.98, 0, TAU);
    g.strokeStyle = `rgba(234, 74, 54, ${alpha * 0.5})`;
    g.lineWidth = 0.08;
    g.stroke();
  }
}
