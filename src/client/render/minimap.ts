/**
 * The minimap: terrain at one pixel per tile, fog (one pixel per tile, smoothed when stretched),
 * structures, units in the side colors (teal player, magenta mutants, only when seen), recent
 * alerts, the discovered relay, incident targets (accepted: a solid orange dot; undecided: a
 * dashed cream ring), tonight's attack directions and the camera rectangle.
 */
import { FOG_EXPLORED, FOG_UNEXPLORED, type GameView } from '../../sim';
import { TERRAIN_LIST, type Terrain } from '../../sim/data/map';
import { cameraRectOnMinimap } from '../camera';
import { forecastView } from '../hud/dayClock';
import type { Session } from '../session';
import { isNestKnown, isTileVisible } from '../view';
import { objectiveMarkers } from './objectiveMarkers';
import { COLORS } from './palette';
import { MINIMAP_TERRAIN } from './terrainLayer';

export interface Minimap {
  draw(session: Session, now: number): void;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Fog at one pixel per tile: opaque where unexplored, dimmed where explored, clear in sight. */
function createTileFog(view: GameView): { canvas: HTMLCanvasElement; update(v: GameView): void } {
  const { width, height } = view.map;
  const canvas = makeCanvas(width, height);
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = g.createImageData(width, height);
  const last = new Uint8Array(width * height).fill(255);
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = 11;
    image.data[i * 4 + 1] = 11;
    image.data[i * 4 + 2] = 15;
  }
  return {
    canvas,
    update(v) {
      let changed = false;
      for (let i = 0; i < v.fog.length; i++) {
        const f = v.fog[i] as number;
        if (f === last[i]) continue;
        last[i] = f;
        changed = true;
        image.data[i * 4 + 3] = f === FOG_UNEXPLORED ? 255 : f === FOG_EXPLORED ? 135 : 0;
      }
      if (changed) g.putImageData(image, 0, 0);
    },
  };
}

/** An accepted incident target: a solid orange dot with a dark rim and a pulsing ring (`k` canvas px per tile). */
function drawTargetDot(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, pulse: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 1.4 * k, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 0.55 * k;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, (2.4 + pulse * 0.8) * k, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(240,138,60,${0.4 + 0.5 * pulse})`;
  ctx.lineWidth = 0.5 * k;
  ctx.stroke();
}

/** The target of a card still waiting for a decision: a hollow, dashed, translucent cream ring. */
function drawPendingRing(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, now: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 2 * k, 0, Math.PI * 2);
  ctx.setLineDash([1.1 * k, 0.9 * k]);
  ctx.lineDashOffset = -now / 120;
  ctx.strokeStyle = 'rgba(26,21,16,0.5)';
  ctx.lineWidth = 1 * k;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(244,234,210,0.85)';
  ctx.lineWidth = 0.5 * k;
  ctx.stroke();
  ctx.setLineDash([]);
}

export function createMinimap(canvas: HTMLCanvasElement, view: GameView): Minimap {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const { width, height } = view.map;
  const terrain = makeCanvas(width, height);
  const tg = terrain.getContext('2d') as CanvasRenderingContext2D;
  const img = tg.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = MINIMAP_TERRAIN[TERRAIN_LIST[view.map.terrain[i] as number] as Terrain];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  tg.putImageData(img, 0, 0);
  const fog = createTileFog(view);

  return {
    draw(session, now) {
      const v: GameView = session.game.state;
      const W = canvas.width;
      const H = canvas.height;
      const sx = W / width;
      const sy = H / height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrain, 0, 0, W, H);
      for (const e of v.entities.values()) {
        if (e.hp <= 0) continue;
        if (e.kind === 'building') {
          ctx.fillStyle = e.type === 'core' ? '#ffd27a' : '#f1e6c8';
          ctx.fillRect(e.tileX * sx, e.tileY * sy, Math.max(2, e.size * sx), Math.max(2, e.size * sy));
        } else if (e.kind === 'nest') {
          if (!isNestKnown(v, e)) continue;
          ctx.fillStyle = e.isHive ? COLORS.nestGlow : COLORS.flesh;
          ctx.fillRect(e.tileX * sx - 1, e.tileY * sy - 1, e.size * sx + 2, e.size * sy + 2);
        }
      }
      fog.update(v);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fog.canvas, 0, 0, W, H);
      const dot = Math.max(2, sx * 0.9);
      for (const e of v.entities.values()) {
        if (e.hp <= 0) continue;
        if (e.kind === 'soldier') ctx.fillStyle = COLORS.teal;
        else if (e.kind === 'survivor') {
          if (e.insideId !== 0) continue;
          ctx.fillStyle = COLORS.tealLight;
        } else if (e.kind === 'mutant') {
          if (!isTileVisible(v, e.x, e.y)) continue;
          ctx.fillStyle = '#e0508a';
        } else continue;
        ctx.fillRect(e.x * sx - dot / 2, e.y * sy - dot / 2, dot, dot);
      }
      const tick = v.tick;
      for (const a of session.alerts) {
        const age = (tick - a.tick) / 60;
        if (age > 1 || age < 0) continue;
        ctx.strokeStyle = `rgba(234,74,54,${1 - age})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x * sx, a.y * sy, 4 + age * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      const site = v.signal.site;
      if (v.signal.discovered && site) {
        ctx.fillStyle = `rgba(127,216,240,${0.6 + 0.4 * pulse})`;
        ctx.fillRect((site.tileX + 0.5) * sx, (site.tileY + 0.5) * sy, (site.size - 1) * sx, (site.size - 1) * sy);
      }
      for (const m of objectiveMarkers(v)) {
        if (m.kind === 'target') drawTargetDot(ctx, m.x * sx, m.y * sy, sx, pulse);
        else if (m.kind === 'pendingTarget') drawPendingRing(ctx, m.x * sx, m.y * sy, sx, now);
      }

      const f = forecastView(v);
      if (f) {
        ctx.fillStyle = `rgba(234,74,54,${0.5 + 0.5 * pulse})`;
        for (const group of f.groups) {
          const sp = v.map.spawnPoints.find((p) => p.direction === group.direction);
          if (!sp) continue;
          ctx.beginPath();
          ctx.arc(((sp.tile % width) + 0.5) * sx, (Math.floor(sp.tile / width) + 0.5) * sy, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const r = cameraRectOnMinimap(session.camera, W, H, v.map);
      ctx.strokeStyle = 'rgba(241,230,200,0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    },
  };
}
