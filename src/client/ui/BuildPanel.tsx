/**
 * Build dock: the build menu (hotkeys, costs, lock reasons in the hover card) in two rows —
 * economy, then military and defense — plus the tech and policy shortcuts.
 */
import { TECHS } from '../../sim/data/economy';
import { buildMenuModel } from '../hud/buildMenu';
import { policyPanelModel } from '../hud/policies';
import { buildingIcon } from '../render/icons';
import type { Session } from '../session';
import { Cost } from './Cost';
import { LockGlyph } from './Glyphs';

export function BuildPanel({ session }: { session: Session }) {
  const sections = buildMenuModel(session.game);
  const tech = session.game.state.economy.tech;
  const current = tech.current;
  const progress = current ? Math.min(1, tech.progress[current] / TECHS[current].cost) : 0;
  const policies = policyPanelModel(session.game, null);
  const filled = policies.slots.filter((s) => s.usable && s.policy).length;
  return (
    <div class="panel build-dock" data-testid="build-dock">
      <div class="build-groups">
        {sections.map((s) => (
          <div class="build-group" key={s.label}>
            <span class="cat">{s.label}</span>
            {s.entries.map((e) => (
              <button
                key={e.type}
                class={`build-btn has-tip ${session.placing === e.type ? 'on' : ''} ${e.availability.ok ? '' : 'off'} ${e.lockedBy ? 'locked' : ''}`}
                data-testid={`build-${e.type}`}
                aria-label={e.name}
                onClick={() => session.startPlacing(e.type, performance.now())}
              >
                <img src={buildingIcon(e.type)} alt="" />
                {e.hotkey && <span class="key">{e.hotkey}</span>}
                {e.lockedBy && (
                  <span class="lock">
                    <LockGlyph />
                  </span>
                )}
                <span class="tip">
                  <span class="tip-title">
                    <b>{e.name}</b>
                    <span class="muted">建造 {e.buildSeconds} 秒</span>
                  </span>
                  {e.description}
                  <Cost items={e.cost} />
                  {!e.availability.ok && (
                    <span class={`reason ${e.lockedBy ? 'locked' : ''}`}>
                      {e.lockedBy && <LockGlyph />}
                      {e.availability.reason}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div class="dev-row">
        <button class={`dev-btn ${current ? '' : 'idle'}`} data-testid="open-tech" onClick={() => session.handleKey({ type: 'toggleTech' }, performance.now())}>
          <span class="dev-name">科技</span>
          <span class="dev-sub">
            {current ? (
              <>
                {TECHS[current].name} <span class="num">{Math.round(progress * 100)}%</span>
              </>
            ) : (
              '未选择研究'
            )}
          </span>
          <span class="key">T</span>
          <i class="dev-progress" style={{ width: `${progress * 100}%` }} />
        </button>
        <button
          class="dev-btn"
          data-testid="open-policies"
          title={policies.nightLocked ? '夜里不能更换政令，天亮后再调整' : undefined}
          onClick={() => session.handleKey({ type: 'togglePolicies' }, performance.now())}
        >
          <span class="dev-name">政令</span>
          <span class="dev-sub">
            已颁布 <span class="num">{filled}/{policies.usableSlots}</span>
            {policies.nightLocked && (
              <span class="night-locked">
                <LockGlyph />
              </span>
            )}
          </span>
          <span class="key">P</span>
        </button>
      </div>
    </div>
  );
}
