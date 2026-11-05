/**
 * The daytime incident card. Time stands still while it is open (Session.incidentModalOpen), so
 * it shows no countdown; at dusk it says that nightfall settles the incident with the last
 * choice. 查看地图 (Esc) closes it and leaves the incident pending at the top of the event log.
 * Whether a choice can be taken comes from validateCommand (hud/incidents.ts).
 */
import { incidentChoiceAvailability, pendingIncidentNotice } from '../hud/incidents';
import type { Session } from '../session';

export function IncidentModal({ session }: { session: Session }) {
  const pending = session.game.state.incidents.pending;
  const notice = pendingIncidentNotice(session.game.state);
  if (!pending || !notice) return null;
  return (
    <div class="modal-back" data-testid="incident-modal">
      <div class="panel incident-panel">
        <div class="incident-head">
          <span class="incident-kicker">白天事件</span>
          <button class="btn small" data-testid="close-incident" onClick={() => session.closeIncidentModal()}>
            查看地图 <span class="key">Esc</span>
          </button>
        </div>
        <div class="incident-title" data-testid="incident-title">
          {pending.title}
        </div>
        <div class="incident-desc">{pending.description}</div>
        {notice.secondsToNight !== null && <div class="incident-dusk">天黑前不处理，会按最后一个选项结算</div>}
        <div class="incident-choices">
          {pending.choices.map((choice, i) => {
            const availability = incidentChoiceAvailability(session.game, pending.id, choice.id);
            return (
              <button
                key={choice.id}
                class="choice-card"
                data-testid={`choice-${choice.id}`}
                disabled={!availability.ok}
                onClick={() => session.resolveIncidentChoice(choice.id, performance.now())}
              >
                <div class="choice-head">
                  <span class="key">{i + 1}</span>
                  <span class="choice-label">{choice.label}</span>
                  {!availability.ok && <span class="choice-reason">{availability.reason}</span>}
                </div>
                <div class="choice-desc">{choice.description}</div>
              </button>
            );
          })}
        </div>
        <div class="incident-foot">
          按 <span class="key">1</span>–<span class="key">3</span> 选择，按 <span class="key">Esc</span> 先去看地图
        </div>
      </div>
    </div>
  );
}
