/** Victory / defeat screen with score breakdown, stats and the local best score. */
import { DIFFICULTIES } from '../../sim/data/combat';
import { endSummary } from '../hud/endScreen';
import type { Session } from '../session';
import type { BestScores } from '../storage/bestScores';
import { ResourceIcon } from './ResourceIcon';

export function EndScreen({ session, best, newBest, onRestart, onQuit }: { session: Session; best: BestScores; newBest: boolean; onRestart: () => void; onQuit: () => void }) {
  const view = session.game.state;
  const s = endSummary(view);
  const difficulty = view.options.difficulty;
  const record = best[difficulty];
  return (
    <div class="modal-back">
      <div class={`panel end ${s.won ? 'won' : 'lost'}`} data-testid="end-screen">
        <div class={`headline ${s.won ? 'won' : 'lost'}`}>{s.headline}</div>
        <div class="reason">
          {s.reason} · 种子 <span class="num">{view.options.seed}</span> · {DIFFICULTIES[difficulty].name}
        </div>
        <p class="epilogue" data-testid="end-epilogue">
          {s.epilogue}
        </p>
        <div class="end-grid">
          <div>
            <div class="label">得分</div>
            {s.total !== null && (
              <>
                <table class="score-table">
                  <tbody>
                    {s.scoreRows.map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td>{v}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>难度倍率</td>
                      <td>×{s.multiplier}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="score-total">
                  <span>
                    总分{newBest && <span class="new-best">新纪录</span>}
                  </span>
                  <b>{s.total}</b>
                </div>
              </>
            )}
            {!s.won && <div class="hint end-note">只有获胜才产生成绩。下一局试试更早建防线，或者先清掉离据点最近的巢穴。</div>}
            <div class="hint end-note">
              本地最佳（{DIFFICULTIES[difficulty].name}）：{record ? <span class="num">{record.score}</span> : '暂无'}
            </div>
          </div>
          <div>
            <div class="label">战报</div>
            <table class="score-table">
              <tbody>
                {s.stats.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
                <tr>
                  <td>累计收集</td>
                  <td>
                    <span class="gathered">
                      {s.gathered.map((g) => (
                        <span key={g.resource} class={`res-${g.resource}`} title={g.name}>
                          <ResourceIcon resource={g.resource} />
                          {g.amount}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            {s.killDetail && <div class="hint end-note">{s.killDetail}</div>}
          </div>
        </div>
        <div class="end-actions">
          <button class="btn primary" onClick={onRestart} data-testid="end-restart">
            再来一局
          </button>
          <button class="btn" onClick={onQuit} data-testid="end-quit">
            返回主菜单
          </button>
        </div>
      </div>
    </div>
  );
}
