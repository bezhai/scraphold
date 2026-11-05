/**
 * Event log under the resources. On top, while an incident is pending, a reminder that reopens
 * its card (at dusk with the game seconds left before nightfall settles it, blinking over the
 * last ones). Collapsed the log is a feed: only fresh lines, fading out with game time
 * (hud/eventLog.ts logFeed); expanded it lists the recent history. The dusk radio broadcast comes
 * from the state and sits among the lines at its dusk. Clicking a line with a position jumps the
 * camera there.
 */
import { useState } from 'preact/hooks';
import { clockAt } from '../../sim';
import { PHASE_NAMES } from '../hud/dayClock';
import { HISTORY_LINES, logFeed, withBroadcast } from '../hud/eventLog';
import { pendingIncidentNotice } from '../hud/incidents';
import type { Session } from '../session';
import { ChevronGlyph } from './Glyphs';

export function EventLog({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);
  const view = session.game.state;
  const feed = logFeed(withBroadcast(session.log, view), view.tick, expanded);
  const notice = pendingIncidentNotice(view);
  const alerts = session.alerts.length;
  return (
    <div class={`eventlog ${expanded ? 'expanded' : ''}`} data-testid="event-log">
      <div class="log-head">
        <button class="log-toggle" data-testid="log-toggle" onClick={() => setExpanded(!expanded)} title={expanded ? '收起事件记录' : `展开最近 ${HISTORY_LINES} 条事件`}>
          <ChevronGlyph open={expanded} />
          事件
        </button>
        {alerts > 0 && (
          <button class="alert-btn" onClick={() => session.jumpToAlert(performance.now())} title="跳到最近的警报（F）">
            <i class="pulse" />
            警报 <span class="num">{alerts}</span> <span class="key">F</span>
          </button>
        )}
      </div>
      {notice && (
        <button class={`pending-incident ${notice.urgent ? 'urgent' : ''}`} data-testid="pending-incident" onClick={() => session.openIncidentModal()}>
          待处理：{notice.title}（点击或按 <span class="key">Tab</span> 打开）
          {notice.secondsToNight !== null && (
            <span class="countdown">
              {' '}
              · 天黑还剩 <span class="num">{notice.secondsToNight}</span> 秒
            </span>
          )}
        </button>
      )}
      {feed.length > 0 && (
        <div class="log-lines">
          {feed.map(({ entry: e, opacity }) => {
            const c = clockAt(e.tick);
            return (
              <div key={e.id} class={`entry ${e.tone} ${e.at ? 'clickable' : ''}`} style={{ opacity }} onClick={() => e.at && session.centerOn(e.at.x, e.at.y)}>
                <span class="t num">
                  D{c.day}·{PHASE_NAMES[c.phase]}
                </span>
                <span>{e.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
