/**
 * Opening world intro card displayed once at the start of Day 1.
 * Narrative text is taken verbatim from docs/narrative.md.
 */
import type { Session } from '../session';

export function IntroCard({ session }: { session: Session }) {
  const close = () => {
    session.closeIntroCard();
  };

  return (
    <div class="modal-back intro-card-back" data-testid="intro-card">
      <div class="panel intro-card">
        <div class="intro-title">锈原，第 1 天</div>
        <div class="intro-body">
          <p>炉心已经启动，炉心被摧毁就算失败。地图上某个方向有一座旧时代的中继站，找到它可以向长明城求援。</p>
          <p>先派幸存者去采集食物和废料。第一晚最多只有少量变异体。</p>
        </div>
        <div class="intro-actions">
          <button class="btn primary intro-enter-btn" data-testid="intro-enter" onClick={close} autoFocus>
            进入据点 <span class="key">空格 / Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
}
