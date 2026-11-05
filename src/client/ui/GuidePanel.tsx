/**
 * The opening checklist (hud/guide.ts), right above the build dock. Steps wrap instead of being
 * cut off; done steps drop out of the list (the counter keeps the progress). It can be folded
 * down to the next step only, or closed for good. `calendarSeen`: the player has hovered the fog
 * calendar (kept by GameScreen).
 */
import { useState } from 'preact/hooks';
import { firstDayGuide } from '../hud/guide';
import type { Session } from '../session';
import { ChevronGlyph } from './Glyphs';

export function GuidePanel({ session, calendarSeen }: { session: Session; calendarSeen: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const guide = session.guideDismissed ? null : firstDayGuide(session.game.state, { calendarSeen });
  if (!guide) return null;
  return (
    <div class={`panel guide ${collapsed ? 'collapsed' : ''}`} data-testid="guide">
      <div class="guide-head">
        <button class="guide-toggle" data-testid="guide-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? '展开全部步骤' : '只看下一步'}>
          <ChevronGlyph open={!collapsed} />
          <span>开局指引</span>
          <span class="progress num">
            {guide.doneCount}/{guide.steps.length}
          </span>
        </button>
        <button class="icon-btn" title="关闭指引" data-testid="guide-close" onClick={() => session.dismissGuide()}>
          ×
        </button>
      </div>
      <ol>
        {guide.steps.map((s) => (
          <li key={s.id} class={`${s.done ? 'done' : ''} ${guide.next === s.id ? 'next' : ''}`} data-testid={`guide-${s.id}`}>
            <span class="mark">{guide.next === s.id ? '›' : '·'}</span>
            <span class="text">{s.text}</span>
          </li>
        ))}
      </ol>
      {!collapsed && (
        <div class="hint">
          完整说明按 <span class="key">F1</span> 或 <span class="key">?</span>
        </div>
      )}
    </div>
  );
}
