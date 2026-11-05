/** Policy (政令) slots and cards. Pick a slot, then a card; cards can only change by day. */
import { useState } from 'preact/hooks';
import { policyPanelModel } from '../hud/policies';
import type { Session } from '../session';
import { act } from './actions';
import { LockGlyph } from './Glyphs';
import { TECHS } from '../../sim/data/economy';

export function PolicyModal({ session }: { session: Session }) {
  const [slot, setSlot] = useState<number | null>(null);
  const model = policyPanelModel(session.game, slot);
  const close = () => session.handleKey({ type: 'togglePolicies' }, performance.now());
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="panel modal" data-testid="policy-modal">
        <div class="modal-head">
          <div>
            <h2>政令</h2>
            <div class="sub">白天可以随时更换，夜里锁定。先选卡槽，再点一张政令放进去。</div>
          </div>
          <button class="btn small" onClick={close}>
            关闭 <span class="key">P</span>
          </button>
        </div>
        {model.nightLocked && <div class="night-lock">夜里不能更换政令，天亮后再调整。</div>}
        <div class="policy-slots">
          {model.slots.map((s) => (
            <button
              key={s.index}
              class={`policy-slot ${s.usable ? '' : 'locked'} ${s.policy ? 'filled' : ''} ${s.usable && model.targetSlot === s.index ? 'target' : ''}`}
              onClick={() => s.usable && setSlot(s.index)}
            >
              <span class="label">卡槽 {s.index + 1}</span>
              {s.policy ? (
                <>
                  <span class="s-name">{s.policy.name}</span>
                  <span class="s-desc">{s.policy.description}</span>
                </>
              ) : (
                <span class={`s-empty ${s.usable ? '' : 'locked'}`}>
                  {s.usable ? (model.targetSlot === s.index ? '空 · 点下方政令放进来' : '空') : <><LockGlyph />需要科技：{TECHS.civicCenter.name}</>}
                </span>
              )}
              {s.clear && (
                <span
                  class="btn small s-clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    act(session, s.clear);
                  }}
                >
                  撤下
                </span>
              )}
            </button>
          ))}
        </div>
        <div class="label section-label">政令卡</div>
        <div class="policy-cards">
          {model.cards.map((c) => (
            <button
              key={c.id}
              class={`policy-card has-tip ${c.slottedIn !== null ? 'slotted' : ''} ${c.unlocked ? '' : 'locked'}`}
              data-testid={`policy-${c.id}`}
              onClick={() => {
                act(session, c.assign);
                setSlot(null);
              }}
            >
              <span class="p-name">
                <span>{c.name}</span>
                {c.slottedIn !== null && <span class="p-slot">卡槽 {c.slottedIn + 1}</span>}
              </span>
              <span class="p-desc">{c.description}</span>
              {c.lockedBy && (
                <span class="p-lock">
                  <LockGlyph />
                  需要科技：{c.lockedBy}
                </span>
              )}
              {!c.assign.ok && c.unlocked && <span class="tip reason-tip">{c.assign.reason}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
