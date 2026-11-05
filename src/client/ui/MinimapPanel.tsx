/** Minimap (click or drag to move the camera, right-click to order there) and control groups. */
import type { Ref } from 'preact';
import { minimapToWorld } from '../camera';
import type { Session } from '../session';

/** CSS size of the minimap (the map is 4:3); the canvas is drawn at twice this for sharpness. */
export const MINIMAP_W = 216;
export const MINIMAP_H = 162;

export function MinimapPanel({ session, canvasRef }: { session: Session; canvasRef: Ref<HTMLCanvasElement> }) {
  const toWorld = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    return minimapToWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height, session.mapSize);
  };
  const onDown = (e: MouseEvent) => {
    const w = toWorld(e);
    if (e.button === 2) {
      session.commandAt(w.x, w.y, { ctrl: e.ctrlKey || e.metaKey }, performance.now());
      return;
    }
    if (e.button !== 0) return;
    session.centerOn(w.x, w.y);
    const el = e.currentTarget as HTMLCanvasElement;
    const move = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const p = minimapToWorld(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height, session.mapSize);
      session.centerOn(p.x, p.y);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div class="panel minimap-panel" data-testid="minimap-panel">
      <canvas ref={canvasRef} width={MINIMAP_W * 2} height={MINIMAP_H * 2} data-testid="minimap" onMouseDown={onDown} onContextMenu={(e) => e.preventDefault()} />
      <div class="groups">
        {session.groups.map((g, i) => {
          const alive = g.filter((id) => session.game.state.entities.has(id)).length;
          return (
            <button
              key={i}
              class={`slot ${alive > 0 ? 'filled' : ''}`}
              title={`编队 ${i + 1}：左键选中，右键设为当前选择（Ctrl+${i + 1}）`}
              onClick={(e) => session.handleKey({ type: e.ctrlKey || e.metaKey || alive === 0 ? 'assignGroup' : 'recallGroup', index: i }, performance.now())}
              onContextMenu={(e) => {
                e.preventDefault();
                session.handleKey({ type: 'assignGroup', index: i }, performance.now());
              }}
            >
              <span class="n num">{i + 1}</span>
              <span class="c num">{alive > 0 ? alive : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
