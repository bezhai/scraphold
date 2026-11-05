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
        <div class="intro-kicker">废土开拓 · 序章</div>
        <div class="intro-title">锈原，第 1 天</div>
        <div class="intro-body">
          <p>炉心点着了，雾往后退了一圈。小满在调无线电，老顾在拆车上的废铁。远处的雾里，隐约有一座铁塔的影子。</p>
          <p>先把吃的和用的弄起来。今晚应该还算安静。</p>
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
