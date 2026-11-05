/** Tech tree modal: three lines, progress, inspiration (灵感) condition and whether it fired. */
import { RESOURCE_NAMES } from '../../sim/data/economy';
import { techTreeModel, type TechNodeModel } from '../hud/techTree';
import { resourceReadouts } from '../hud/topBar';
import type { Session } from '../session';
import { act } from './actions';
import { LockGlyph } from './Glyphs';

function TechCard({ session, node }: { session: Session; node: TechNodeModel }) {
  return (
    <button class={`tech ${node.status}`} data-testid={`tech-${node.id}`} onClick={() => (node.status === 'researched' ? undefined : act(session, node.availability))}>
      <span class="t-name">
        <span>
          {node.status === 'locked' && <LockGlyph />}
          {node.name}
        </span>
        {node.status === 'researched' ? <span class="t-tag done">✓ 已完成</span> : node.status === 'current' ? <span class="t-tag">研究中</span> : <span class="t-cost num">{node.cost}</span>}
      </span>
      <span class="t-desc">{node.description}</span>
      {node.status !== 'researched' && (
        <div class="bar research">
          <i style={{ width: `${node.progress * 100}%` }} />
        </div>
      )}
      <span class={`t-insp ${node.inspired ? 'fired' : ''}`}>
        <span>灵感：{node.inspirationText}</span>
        <span class="num">{node.inspired ? '已触发' : node.inspirationProgress ? `${node.inspirationProgress.have}/${node.inspirationProgress.need}` : ''}</span>
      </span>
      {node.status === 'locked' ? (
        <span class="t-lock">{node.requires.length > 0 ? `需要先研究：${node.requires.join('、')}` : !node.availability.ok && node.availability.reason}</span>
      ) : (
        node.requires.length > 0 && <span class="t-req">前置：{node.requires.join('、')}</span>
      )}
    </button>
  );
}

export function TechTreeModal({ session }: { session: Session }) {
  const model = techTreeModel(session.game);
  const research = resourceReadouts(session.game.state).find((r) => r.resource === 'research');
  const close = () => session.handleKey({ type: 'toggleTech' }, performance.now());
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="panel modal" data-testid="tech-modal">
        <div class="modal-head">
          <div>
            <h2>科技</h2>
            <div class="sub">
              已完成 {model.researchedCount}/{model.total} · {RESOURCE_NAMES.research}收入 {Math.round(research?.incomePerMinute ?? 0)}/分 ·
              满足灵感条件后研究进度直接加一半。一局大约只能点出一半，挑一条路线。
            </div>
          </div>
          <div class="actions">
            {model.current && (
              <button class="btn small" onClick={() => session.issue([{ type: 'setResearch', tech: null }], performance.now())}>
                暂停研究
              </button>
            )}
            <button class="btn small" onClick={close}>
              关闭 <span class="key">T</span>
            </button>
          </div>
        </div>
        <div class="tech-cols">
          {model.lines.map((line) => {
            const tiers = [...new Set(line.nodes.map((n) => n.tier))];
            return (
              <div class="tech-col" key={line.line}>
                <h4>{line.name}</h4>
                {tiers.map((t) => (
                  <div class="tech-tier" key={t}>
                    {line.nodes
                      .filter((n) => n.tier === t)
                      .map((n) => (
                        <TechCard key={n.id} session={session} node={n} />
                      ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
