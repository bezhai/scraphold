/**
 * Draws one frame of the world for a Session, back to front: the cached terrain with water glints
 * and glowing unexplored ruins, ground marks and corpses, soft shadows cast by the sun of the hour,
 * structures (cached bodies plus their live layer), identity and selection rings, units posed by
 * facing and animation frame, the fog of war, the day / dusk / night light map with its lights,
 * glowing eyes and acid at night, combat effects, the overlays that explain the game state (among
 * them the flag over every unit under the player's command), and on a rust storm night the blowing
 * sand over everything but the screen markers.
 */
import { workerSlots, type GameView } from '../../sim';
import { MUTANTS, SOLDIERS, type MutantType, type SoldierType } from '../../sim/data/combat';
import { viewWorldRect, visibleTileBounds, type Camera, type ScreenRect } from '../camera';
import { pickEntity } from '../input/picking';
import { interpolatedPosition } from '../interpolation';
import type { Session } from '../session';
import { isNestKnown, isTileVisible, type EntityView } from '../view';
import { buildingLampSpots, buildingShadowHeight, damageStage, paintBuildingLive, paintBuildingSite, paintNestLive, searchlightAngle, type BuildingSprite } from './drawBuildings';
import { drawAirEffects, drawGroundEffects, effectLights } from './drawEffects';
import type { VisualEffect } from './effects';
import { createFogLayer, type FogLayer } from './fogLayer';
import { drawMutantGlow, type GlowingMutant } from './mutantGlow';
import { ambientAt, createShadeLayer, glowSprite, nightWeather, stormLevel, sunAt, type LightCone, type LightSource, type Sun } from './lighting';
import { objectiveMarkers } from './objectiveMarkers';
import {
  drawBossRing,
  commandFlags,
  drawBroadcastPulseRings,
  drawCommandFlags,
  drawDragBox,
  drawGhost,
  drawGhostLabel,
  drawHealthBars,
  drawObjectiveMarkers,
  drawPlacementGrid,
  drawRally,
  drawRanges,
  drawStructureMarks,
  drawThreatMarkers,
  drawUnitRings,
  drawVeteranMark,
  markerArea,
  type UnitMark,
} from './overlays';
import { createSectionTimer } from './sectionTimer';
import { createSandStorm } from './stormEffects';
import { COLORS } from './palette';
import { createPixelSprites, devicePoint, deviceTransformOf } from './pixelSprites';
import { sweptOutline } from './shadowShape';
import { beginStructureFrame, blitBuildingBody, blitNestBody } from './structureSprites';
import { renderTerrain, waterGlintSpots } from './terrainLayer';
import { createTerrainView } from './terrainView';
import { poseFrame, steadyBucket } from './unitPose';
import { beginSpriteFrame, blitUnit, drawDiameter, unitSprite, type SpriteSubject } from './unitSprites';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export interface Renderer {
  draw(session: Session, now: number): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  /** Milliseconds spent per section in the last frame (profiling; read by the debug hook). */
  readonly timings: Record<string, number>;
  /**
   * Profiling only, off by default: a one-pixel readback before every section's clock reading makes
   * the canvas rasterize what that section drew, so `timings` include the rasterizer's work (which
   * otherwise runs after draw() returns and shows in no section). The readbacks cost a few fps
   * (and stall a GPU canvas), so frame rates are measured with this off.
   */
  rasterizeSections: boolean;
  /**
   * Screen rectangles (CSS pixels) covered by HUD panels, measured by the game screen after every
   * HUD refresh; edge markers stay clear of them (overlays.ts markerArea).
   */
  hudPanels: readonly ScreenRect[];
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const SURVIVOR: SpriteSubject = { kind: 'survivor' };
const SOLDIER_SUBJECT = Object.fromEntries(Object.keys(SOLDIERS).map((t) => [t, { kind: 'soldier', type: t as SoldierType }])) as Record<SoldierType, SpriteSubject>;
const MUTANT_SUBJECT = Object.fromEntries(Object.keys(MUTANTS).map((t) => [t, { kind: 'mutant', type: t as MutantType }])) as Record<MutantType, SpriteSubject>;

function subjectOf(e: EntityView): SpriteSubject | null {
  if (e.kind === 'survivor') return SURVIVOR;
  if (e.kind === 'soldier') return SOLDIER_SUBJECT[e.type];
  if (e.kind === 'mutant') return MUTANT_SUBJECT[e.type];
  return null;
}

function subjectOfCorpse(subtype: string | undefined): SpriteSubject | null {
  if (subtype === 'survivor') return SURVIVOR;
  if (subtype && subtype in SOLDIER_SUBJECT) return SOLDIER_SUBJECT[subtype as SoldierType];
  if (subtype && subtype in MUTANT_SUBJECT) return MUTANT_SUBJECT[subtype as MutantType];
  return null;
}

/** Duration of one walk frame (ms): small quick things patter, big things lumber. */
function stepMs(subject: SpriteSubject): number {
  if (subject.kind === 'survivor') return 160;
  if (subject.kind === 'soldier') return subject.type === 'scout' || subject.type === 'pickup' ? 90 : 140;
  return { runner: 85, wanderer: 190, crawler: 160, spitter: 180, boomer: 150, behemoth: 260 }[subject.type];
}

/** A unit's current pose on screen, kept between frames (and for its corpse). */
interface Pose {
  bucket: number;
  seen: number;
}

/** Recent attack per attacker id: when, and the point it attacked. */
interface Attack {
  born: number;
  tx: number;
  ty: number;
}

/** How long after an attack a unit keeps facing its target. */
const AIM_HOLD_MS = 700;
const CORPSE_FALL_MS = 220;

export function createRenderer(canvas: HTMLCanvasElement, view: GameView): Renderer {
  const ctx = canvas.getContext('2d', { alpha: false }) as Ctx;
  const terrain = createTerrainView(renderTerrain(view, makeCanvas), view.map);
  const glints = waterGlintSpots(view);
  const fog: FogLayer = createFogLayer(view, makeCanvas);
  const shade = createShadeLayer();
  const storm = createSandStorm();
  const poses = new Map<number, Pose>();
  const attacks = new Map<number, Attack>();
  let dpr = 1;
  let frameNo = 0;
  let hudPanels: readonly ScreenRect[] = [];
  const sections = createSectionTimer(ctx);

  function resize(w: number, h: number, ratio: number): void {
    dpr = ratio;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    shade.resize(w, h);
  }

  function setWorldTransform(cam: Camera): void {
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, (cam.viewW / 2 - cam.x * cam.zoom) * dpr, (cam.viewH / 2 - cam.y * cam.zoom) * dpr);
  }

  function collectAttacks(effects: readonly VisualEffect[], now: number): void {
    attacks.clear();
    for (const fx of effects) {
      if (fx.entityId === undefined || now - fx.born > AIM_HOLD_MS) continue;
      if (fx.kind !== 'flash' && fx.kind !== 'claw' && fx.kind !== 'spit') continue;
      const prev = attacks.get(fx.entityId);
      if (prev && prev.born > fx.born) continue;
      // Claws are placed at the target with the attacker in (x2, y2).
      attacks.set(fx.entityId, fx.kind === 'claw' ? { born: fx.born, tx: fx.x, ty: fx.y } : { born: fx.born, tx: fx.x2, ty: fx.y2 });
    }
  }

  /** Facing bucket: toward the last attack, else movement, else a held target, else unchanged. */
  function poseOf(e: EntityView, x: number, y: number, v: GameView, now: number, moving: boolean): Pose {
    let pose = poses.get(e.id);
    let angle: number | null = null;
    const attack = attacks.get(e.id);
    if (attack) angle = Math.atan2(attack.ty - y, attack.tx - x);
    else if (moving && (e.kind === 'soldier' || e.kind === 'mutant' || e.kind === 'survivor')) angle = Math.atan2(e.motion.vy, e.motion.vx);
    else if (e.kind === 'soldier' || e.kind === 'mutant') {
      const t = e.attack.targetId ? v.entities.get(e.attack.targetId) : undefined;
      if (t && t.hp > 0) angle = Math.atan2(t.y - y, t.x - x);
    }
    if (!pose) {
      pose = { bucket: steadyBucket(null, angle ?? Math.PI / 2), seen: now };
      poses.set(e.id, pose);
    } else if (angle !== null) pose.bucket = steadyBucket(pose.bucket, angle);
    pose.seen = now;
    return pose;
  }

  function draw(session: Session, now: number): void {
    const v: GameView = session.game.state;
    const cam = session.camera;
    const px = 1 / cam.zoom;
    const devicePx = cam.zoom * dpr;
    const bounds = visibleTileBounds(cam, v.map);
    const selected = new Set(session.selection);
    const hovered = session.hover && !session.placing ? pickEntity(v, session.hover.x, session.hover.y, 6 * px) : null;
    const weather = nightWeather(v);
    const ambient = ambientAt(v.clock, weather);
    const sun = sunAt(v.clock);
    const lights: LightSource[] = [];
    const cones: LightCone[] = [];
    const inView = (x: number, y: number, m: number) => x > bounds.x0 - m && x < bounds.x1 + 1 + m && y > bounds.y0 - m && y < bounds.y1 + 1 + m;
    sections.start();
    frameNo++;
    collectAttacks(session.effects, now);
    beginSpriteFrame(devicePx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const seen = viewWorldRect(cam);
    if (seen.x0 < 0 || seen.y0 < 0 || seen.x1 > v.map.width || seen.y1 > v.map.height) {
      ctx.fillStyle = COLORS.void;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    terrain.draw(ctx, cam, dpr, now);
    setWorldTransform(cam);
    ctx.imageSmoothingEnabled = true;
    drawWaterGlints(ctx, glints, now, px, inView);
    drawRuinGlows(ctx, v, now, lights, inView);
    if (session.placing && session.hover) drawPlacementGrid(ctx, session.hover.x, session.hover.y, v, px);
    sections.lap('terrain');

    drawGroundEffects(ctx, session.effects, now);
    drawCorpses(ctx, session.effects, now, inView);
    sections.lap('ground');

    // Structures: the relay ruin until a signal tower stands on it, shadows, then bodies and their live layer.
    const relay = v.signal.site;
    if (relay && v.signal.buildingId === 0 && inView(relay.tileX + relay.size / 2, relay.tileY + relay.size / 2, relay.size)) {
      drawRelayRuins(ctx, relay.tileX, relay.tileY, relay.size, px);
    }

    const structures: EntityView[] = [];
    for (const e of v.entities.values()) {
      if (e.kind !== 'building' && e.kind !== 'nest') continue;
      if (e.tileX > bounds.x1 + 2 || e.tileY > bounds.y1 + 2 || e.tileX + e.size < bounds.x0 - 2 || e.tileY + e.size < bounds.y0 - 2) continue;
      if (e.kind === 'nest' && !isNestKnown(v, e)) continue;
      structures.push(e);
    }
    drawStructureShadows(ctx, structures, sun);
    beginStructureFrame();
    for (const e of structures) {
      if (e.kind === 'nest') {
        blitNestBody(ctx, e.size, e.isHive, e.tileX, e.tileY);
        ctx.save();
        ctx.translate(e.tileX, e.tileY);
        paintNestLive(ctx, e.size, e.isHive, now, e.id);
        ctx.restore();
        lights.push({ x: e.x, y: e.y, radius: e.size * 1.3, strength: 0.75, color: 'nest' });
        continue;
      }
      if (e.kind !== 'building') continue;
      const target = e.attack.targetId ? v.entities.get(e.attack.targetId) : undefined;
      const aim = target && target.hp > 0 ? Math.atan2(target.y - e.y, target.x - e.x) : null;
      const built = e.construction ? e.construction.progress / Math.max(1, e.construction.total) : 1;
      const sprite: BuildingSprite = {
        type: e.type,
        tileX: e.tileX,
        tileY: e.tileY,
        size: e.size,
        built,
        workers: e.workers.length,
        slots: workerSlots(session.game.modifiers, e),
        aim,
        hp: e.hp / e.maxHp,
      };
      ctx.save();
      if (e.construction) {
        ctx.translate(e.tileX, e.tileY);
        paintBuildingSite(ctx, sprite, devicePx, now);
      } else {
        blitBuildingBody(ctx, e.type, e.size, damageStage(sprite.hp ?? 1), e.tileX, e.tileY);
        ctx.translate(e.tileX, e.tileY);
        paintBuildingLive(ctx, sprite, now, devicePx, ambient.night);
        buildingLights(sprite, now, lights, cones);
      }
      ctx.restore();
    }
    sections.lap('structures');

    // Units: pose, shadow, rings, sprite.
    const x0 = bounds.x0 - 1;
    const x1 = bounds.x1 + 2;
    const y0 = bounds.y0 - 1;
    const y1 = bounds.y1 + 2;
    const marks = new Map<number, UnitMark>();
    const drawn: { e: EntityView; subject: SpriteSubject; x: number; y: number; bucket: number; moving: boolean }[] = [];
    for (const e of v.entities.values()) {
      if (e.kind === 'building' || e.kind === 'nest' || e.hp <= 0) continue;
      if (e.kind === 'survivor' && e.insideId !== 0) continue;
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      if (e.kind === 'mutant' && !isTileVisible(v, e.x, e.y)) continue;
      const subject = subjectOf(e);
      if (!subject) continue;
      const p = interpolatedPosition(session.history, e, session.alpha);
      const moving = e.motion.vx * e.motion.vx + e.motion.vy * e.motion.vy > 0.000004;
      const pose = poseOf(e, p.x, p.y, v, now, moving);
      const d = drawDiameter(subject);
      marks.set(e.id, { x: p.x, y: p.y, d, player: e.faction === 'player', commanded: (e.kind === 'soldier' || e.kind === 'survivor') && e.control === 'player' });
      drawn.push({ e, subject, x: p.x, y: p.y, bucket: pose.bucket, moving });
    }
    drawUnitShadows(ctx, drawn, sun);
    const selectedMarks: UnitMark[] = [];
    for (const id of selected) {
      const m = marks.get(id);
      if (m) selectedMarks.push(m);
    }
    drawUnitRings(ctx, [...marks.values()], selectedMarks, px, ambient.night);
    for (const u of drawn) if (u.e.kind === 'mutant' && u.e.ai.boss) drawBossRing(ctx, u.x, u.y, drawDiameter(u.subject), now);
    // Sprites are painted at device scale and copied at whole device pixels, unfiltered.
    const dt = deviceTransformOf(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const glowing: GlowingMutant[] = [];
    for (const u of drawn) {
      const e = u.e;
      const attack = attacks.get(e.id);
      const frame = poseFrame(u.moving, attack ? now - attack.born : null, now + e.id * 97, stepMs(u.subject));
      blitUnit(ctx, dt, u.subject, u.bucket, frame, u.x, u.y);
      if (u.subject.kind === 'mutant') glowing.push({ type: u.subject.type, x: u.x, y: u.y, bucket: u.bucket });
    }
    ctx.imageSmoothingEnabled = true;
    setWorldTransform(cam);
    for (const u of drawn) {
      const e = u.e;
      if (e.kind === 'soldier' && (e.veterancy.promotion || e.veterancy.pending)) drawVeteranMark(ctx, u.x, u.y, drawDiameter(u.subject), e.veterancy.pending, now);
    }
    sections.lap('units');

    // Fog, the shade of the hour and light halos in one pass, then glowing eyes.
    effectLights(session.effects, now, inView, lights);
    shade.apply(ctx, canvas.width, canvas.height, cam, (g) => fog.paint(g, v, now), ambient, lights, cones);
    if (ambient.night > 0.05) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawMutantGlow(ctx, dt, glowing, ambient.night, dpr);
    }
    setWorldTransform(cam);
    sections.lap('shade');

    drawAirEffects(ctx, session.effects, now, px);
    sections.lap('effects');

    // Overlays.
    drawRally(ctx, session, v, px, now);
    drawStructureMarks(ctx, v, selected, hovered, px);
    drawRanges(ctx, session, v, selected, hovered, marks, px);
    drawCommandFlags(ctx, commandFlags([...marks.values()], px), px);
    drawHealthBars(ctx, v, selected, hovered, marks, bounds, px);
    drawBroadcastPulseRings(ctx, v, now);
    if (session.placing && session.hover) drawGhost(ctx, session, px, now);

    // Screen space (CSS pixels): the storm, then the markers on top of it.
    storm.draw(ctx, cam.viewW, cam.viewH, dpr, now, stormLevel(v.clock, weather));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const area = markerArea(cam, hudPanels);
    drawThreatMarkers(ctx, v, cam, area, now);
    drawObjectiveMarkers(ctx, objectiveMarkers(v), cam, area, now);
    if (session.placing && session.hover) drawGhostLabel(ctx, session);
    if (session.dragBox) drawDragBox(ctx, session.dragBox);
    if (frameNo % 120 === 0) for (const [id, pose] of poses) if (now - pose.seen > 8000) poses.delete(id);
    sections.lap('overlays');
  }

  /** Dead units: their last pose, darkened, falling over briefly and fading out. */
  function drawCorpses(g: Ctx, effects: readonly VisualEffect[], now: number, inView: (x: number, y: number, m: number) => boolean): void {
    const dt = deviceTransformOf(g);
    g.save();
    g.imageSmoothingEnabled = false;
    for (const fx of effects) {
      if (fx.kind !== 'corpse' || !inView(fx.x, fx.y, 2)) continue;
      const subject = subjectOfCorpse(fx.subtype);
      if (!subject) continue;
      const age = now - fx.born;
      const t = age / fx.life;
      const bucket = (fx.entityId !== undefined ? poses.get(fx.entityId)?.bucket : undefined) ?? 4;
      g.globalAlpha = t > 0.6 ? Math.max(0, (1 - t) / 0.4) : 1;
      if (age < CORPSE_FALL_MS) {
        // keel over: a quick squash toward the ground
        const f = age / CORPSE_FALL_MS;
        const { canvas: img, scale } = unitSprite(subject, bucket, 'idle');
        const side = img.width / scale;
        g.setTransform(dt.k * (1 + 0.08 * f), 0, 0, dt.k * (1 - 0.1 * f), fx.x * dt.k + dt.ox, fx.y * dt.k + dt.oy);
        g.drawImage(img, -side / 2, -side / 2, side, side);
      } else {
        g.setTransform(1, 0, 0, 1, 0, 0);
        blitUnit(g, dt, subject, bucket, 'dead', fx.x, fx.y);
      }
    }
    g.restore();
  }

  return {
    draw,
    resize,
    timings: sections.timings,
    get rasterizeSections() {
      return sections.rasterize;
    },
    set rasterizeSections(on: boolean) {
      sections.rasterize = on;
    },
    get hudPanels() {
      return hudPanels;
    },
    set hudPanels(panels: readonly ScreenRect[]) {
      hudPanels = panels;
    },
  };
}

/** Lamps, the core reactor, searchlights and fires of a complete building. */
function buildingLights(b: BuildingSprite, now: number, lights: LightSource[], cones: LightCone[]): void {
  const cx = b.tileX + b.size / 2;
  const cy = b.tileY + b.size / 2;
  switch (b.type) {
    case 'core':
      lights.push({ x: cx, y: cy - 0.2, radius: 8, strength: 1, color: 'core' });
      break;
    case 'watchtower':
      lights.push({ x: cx, y: b.tileY + 0.3, radius: 2.2, strength: 0.7, color: 'lamp' });
      cones.push({ x: cx, y: b.tileY + 0.3, angle: searchlightAngle(b.tileX, b.tileY, now), length: 7.5, strength: 0.85 });
      break;
    case 'machineGunTower':
      lights.push({ x: cx, y: cy, radius: 1.8, strength: 0.6, color: 'lamp' });
      break;
    default: {
      const on = b.workers > 0 || b.type === 'shack' || b.type === 'barracks';
      if (on) for (const [x, y] of buildingLampSpots(b.type)) lights.push({ x: b.tileX + x, y: b.tileY + y, radius: 2.3, strength: 0.85, color: 'lamp' });
      break;
    }
  }
  if (damageStage(b.hp ?? 1) >= 3) lights.push({ x: b.tileX + b.size * 0.3, y: b.tileY + b.size * 0.5, radius: 1.6 + b.size, strength: 0.75 + 0.25 * Math.sin(now / 90 + b.tileX), color: 'fire' });
}

/** Outline of a structure's mass seen from above, for its shadow. */
function shadowOutline(e: EntityView): [number, number][] {
  if (e.kind !== 'building' && e.kind !== 'nest') return [];
  const cx = e.tileX + e.size / 2;
  const cy = e.tileY + e.size / 2;
  const ring = (rx: number, ry: number, n: number, phase: number) =>
    Array.from({ length: n }, (_, k): [number, number] => [cx + Math.cos(phase + (k / n) * TAU) * rx, cy + Math.sin(phase + (k / n) * TAU) * ry]);
  if (e.kind === 'nest') return ring(e.size * 0.42, e.size * 0.36, 12, 0);
  if (e.type === 'core') return ring(e.size * 0.5, e.size * 0.47, 8, Math.PI / 8);
  if (e.type === 'machineGunTower') return ring(0.42, 0.42, 10, 0);
  const inset = e.size === 1 ? 0.16 : 0.12;
  return [
    [e.tileX + inset, e.tileY + inset],
    [e.tileX + e.size - inset, e.tileY + inset],
    [e.tileX + e.size - inset, e.tileY + e.size - inset],
    [e.tileX + inset, e.tileY + e.size - inset],
  ];
}

/** Building and nest shadows: the outline swept along the sun by the structure's height, softened by a second, shorter pass. */
function drawStructureShadows(g: Ctx, structures: readonly EntityView[], sun: Sun): void {
  if (sun.alpha <= 0.01) return;
  for (const pass of [1, 0.55]) {
    g.fillStyle = `rgba(38,22,8,${sun.alpha * (pass === 1 ? 0.55 : 0.5)})`;
    g.beginPath();
    for (const e of structures) {
      if (e.kind !== 'building' && e.kind !== 'nest') continue;
      const h = (e.kind === 'nest' ? 0.35 : buildingShadowHeight(e.type)) * pass;
      const outline = shadowOutline(e);
      const swept = sweptOutline(outline, sun.dx * h, sun.dy * h);
      swept.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.closePath();
    }
    g.fill();
  }
}

let blob: HTMLCanvasElement | null = null;

/** A soft dark disc for unit shadows (cached). */
function shadowBlob(): HTMLCanvasElement {
  if (blob) return blob;
  blob = makeCanvas(64, 64);
  const g = blob.getContext('2d') as Ctx;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(30,16,4,1)');
  grad.addColorStop(0.55, 'rgba(30,16,4,0.75)');
  grad.addColorStop(1, 'rgba(30,16,4,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return blob;
}

/** Soft blob shadows offset by the sun; stretched along x when the sun is low at dusk. */
const unitShadows = createPixelSprites({ maxEntries: 200, perFrame: 20 });

/** Soft blob shadows under units, pushed away from the sun; each a 1:1 copy of a blob of that pixel size. */
function drawUnitShadows(g: Ctx, units: readonly { subject: SpriteSubject; x: number; y: number }[], sun: Sun): void {
  if (sun.alpha <= 0.01) return;
  const t = deviceTransformOf(g);
  unitShadows.beginFrame();
  const stretch = 1 + Math.max(0, sun.dx - 0.5) * 0.55;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.globalAlpha = Math.min(1, sun.alpha * 1.7);
  for (const u of units) {
    const d = drawDiameter(u.subject);
    const h = d * 0.32;
    const w = d * 1.05 * stretch;
    const hh = d * 0.82;
    const wp = Math.max(2, Math.round(w * t.k));
    const hp = Math.max(2, Math.round(hh * t.k));
    const p = devicePoint(t, u.x + sun.dx * h - w / 2 + (w - d) * 0.35, u.y + sun.dy * h - hh / 2);
    const img = unitShadows.get(`${wp}x${hp}`, wp, hp, (c, cw, ch) => c.drawImage(shadowBlob(), 0, 0, cw, ch));
    if (img) g.drawImage(img, p.x, p.y);
    else g.drawImage(shadowBlob(), p.x, p.y, wp, hp);
  }
  g.restore();
}

/** Glinting highlights drifting over open water. */
function drawWaterGlints(g: Ctx, glints: readonly { x: number; y: number; phase: number; len: number }[], now: number, px: number, inView: (x: number, y: number, m: number) => boolean): void {
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.2 * px, 0.03);
  g.strokeStyle = 'rgba(235,250,240,0.55)';
  g.beginPath();
  for (const s of glints) {
    if (!inView(s.x, s.y, 1)) continue;
    const w = Math.sin(now / 900 + s.phase);
    if (w < 0.2) continue;
    const dx = Math.sin(now / 2400 + s.phase) * 0.12;
    const len = s.len * (w - 0.2);
    g.moveTo(s.x + dx - len, s.y);
    g.quadraticCurveTo(s.x + dx, s.y - 0.04, s.x + dx + len, s.y);
  }
  g.stroke();
  g.lineCap = 'butt';
}

/** Unexplored ruins shimmer softly so they invite a visit; they also glow at night. */
function drawRuinGlows(g: Ctx, v: GameView, now: number, lights: LightSource[], inView: (x: number, y: number, m: number) => boolean): void {
  const img = glowSprite('lamp');
  for (const ruin of v.map.ruins) {
    if (ruin.explored || v.fog[ruin.tile] === 0) continue;
    const rx = (ruin.tile % v.map.width) + 0.5;
    const ry = Math.floor(ruin.tile / v.map.width) + 0.5;
    if (!inView(rx, ry, 2)) continue;
    const pulse = 0.5 + 0.5 * Math.sin(now / 520 + ruin.id);
    g.globalAlpha = 0.25 + 0.25 * pulse;
    g.globalCompositeOperation = 'lighter';
    g.drawImage(img, rx - 1.1, ry - 1.1, 2.2, 2.2);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // a few rising motes
    g.fillStyle = 'rgba(255,230,160,0.85)';
    for (let k = 0; k < 3; k++) {
      const t = (now / 1800 + k / 3 + ruin.id * 0.17) % 1;
      g.beginPath();
      g.arc(rx + Math.sin(t * 6 + k * 2) * 0.3, ry + 0.2 - t * 0.7, 0.035 * (1 - t) + 0.01, 0, TAU);
      g.fill();
    }
    lights.push({ x: rx, y: ry, radius: 1.6, strength: 0.6, color: 'lamp' });
  }
}

/** Pre-construction ruin state of K-7 relay site: rubble base, tilted lattice mast, broken antenna. */
function drawRelayRuins(g: Ctx, tx: number, ty: number, size: number, px: number): void {
  const c = size / 2;
  g.save();
  g.translate(tx, ty);
  // Rubble base
  g.fillStyle = '#3a342b';
  g.fillRect(0.2, 0.2, size - 0.4, size - 0.4);
  g.fillStyle = '#524b3f';
  g.fillRect(0.4, 0.4, size - 0.8, size - 0.8);
  // Broken concrete chunks
  g.fillStyle = '#6e6556';
  g.fillRect(0.6, 0.5, 0.8, 0.6);
  g.fillRect(1.5, 1.8, 0.9, 0.5);
  // Rusted tilted lattice mast
  g.lineWidth = Math.max(px * 1.5, 0.06);
  g.strokeStyle = COLORS.outline;
  g.beginPath();
  g.moveTo(0.5, size - 0.5);
  g.lineTo(c + 0.3, 0.4);
  g.moveTo(size - 0.5, size - 0.5);
  g.lineTo(c + 0.3, 0.4);
  g.moveTo(0.7, 1.8);
  g.lineTo(2.2, 1.8);
  g.moveTo(0.9, 1.1);
  g.lineTo(2.0, 1.1);
  // Snapped antenna tip lying on ground
  g.moveTo(c + 0.3, 0.4);
  g.lineTo(c + 0.9, 0.1);
  g.stroke();

  g.strokeStyle = '#8a4e30';
  g.lineWidth = Math.max(px, 0.04);
  g.stroke();
  g.restore();
}


