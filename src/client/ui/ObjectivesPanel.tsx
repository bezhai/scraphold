/**
 * Victory objectives: a small 目标 (O) button in the middle of the top bar, and the card it opens
 * (hud/objectives.ts), which hangs below the top bar's middle above the banners.
 */
import { objectivesModel } from '../hud/objectives';
import type { Session } from '../session';

const toggle = (session: Session) => session.handleKey({ type: 'toggleObjectives' }, performance.now());

export function ObjectivesButton({ session }: { session: Session }) {
  return (
    <button
      class={`objectives-btn ${session.objectivesOpen ? 'on' : ''}`}
      data-testid="objectives-capsule"
      onClick={() => toggle(session)}
      title="三条胜利路线的进度（O）"
    >
      目标<span class="key">O</span>
    </button>
  );
}

export function ObjectivesCard({ session }: { session: Session }) {
  return (
    <div class="objectives-card" data-testid="objectives-card">
      <div class="card-head">
        <span class="title">胜利目标</span>
        <button class="icon-btn" data-testid="objectives-close" title="关闭（O 或 Esc）" onClick={() => toggle(session)}>
          ×
        </button>
      </div>
      {objectivesModel(session.game).map((r) => (
        <div class="route" key={r.id} data-testid={`objective-${r.id}`}>
          <div class="route-title">
            <span class="route-tag">{r.tag}</span>
            {r.title}
          </div>
          <div class="route-status">{r.status}</div>
        </div>
      ))}
    </div>
  );
}
