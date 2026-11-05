/**
 * The fog calendar in the top bar's time cluster: tonight plus the next published nights, each a
 * small two-line cell coloured by its night type, with the narrative's one-line description in
 * the hover card. The hover card stays closed while the objectives card is open (both hang below
 * the top bar). Hovering reports to the first-day guide (onHover).
 */
import { calendarStripModel, type CalendarNightView } from '../hud/calendar';
import type { Session } from '../session';

export function CalendarStrip({ session, onHover }: { session: Session; onHover: () => void }) {
  const model = calendarStripModel(session.game);
  return (
    <div class="calendar-strip has-tip" data-testid="calendar-strip" onMouseEnter={onHover}>
      {model.nights.map((n) => (
        <NightCell key={n.night} night={n} />
      ))}
      {!session.objectivesOpen && (
        <div class="tip below cal-tip" data-testid="calendar-tip">
          <b>雾情日历</b>
          {model.nights.map((n) => (
            <div key={n.night} class="cal-tip-row">
              <span class={`night-name night-${n.type}`}>{n.title}</span>
              <span class="night-desc">{n.description}</span>
            </div>
          ))}
          {model.postStormVisionLossPct > 0 && <div class="tone-warn">锈风暴过后，今天白天视野降低 {model.postStormVisionLossPct}%。</div>}
        </div>
      )}
    </div>
  );
}

function NightCell({ night }: { night: CalendarNightView }) {
  return (
    <div class={`cal-cell night-${night.type} ${night.isTonight ? 'is-tonight' : ''}`} data-testid={`cal-night-${night.night}`}>
      <span class="cal-label">{night.label}</span>
      <span class="cal-type">{night.name}</span>
    </div>
  );
}
