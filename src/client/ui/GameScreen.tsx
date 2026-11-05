/**
 * The running game: world canvas plus HUD. Owns the animation-frame loop (input pan, simulation
 * frame, world and minimap drawing), refreshes the Preact HUD at most ~20 times per second,
 * tells the renderer where the HUD panels are after every refresh (edge markers keep clear of
 * them), and writes the autosave when the page is hidden or closed. The objectives card and the
 * banners share one column below the top bar's middle, so they stack instead of overlapping.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createGame, type Game, type GameOptions } from '../../sim';
import type { ScreenRect } from '../camera';
import { installDebugHook, type FrameProfile } from '../debugHook';
import { bestScoreEntry } from '../hud/endScreen';
import { terrainHint } from '../hud/terrainHint';
import { attachInput } from '../input/domInput';
import { createMinimap } from '../render/minimap';
import { createRenderer, type Renderer } from '../render/renderer';
import { Session } from '../session';
import { recordBestScore, saveBestScores, type BestScores } from '../storage/bestScores';
import { browserStorage } from '../storage/browserStorage';
import { BuildPanel } from './BuildPanel';
import { EndScreen } from './EndScreen';
import { EventLog } from './EventLog';
import { GuidePanel } from './GuidePanel';
import { HelpOverlay } from './HelpOverlay';
import { IncidentModal } from './IncidentModal';
import { IntroCard } from './IntroCard';
import { MinimapPanel } from './MinimapPanel';
import { ObjectivesCard } from './ObjectivesPanel';
import { PauseMenu } from './PauseMenu';
import { PolicyModal } from './PolicyPanel';
import { SelectionPanel } from './SelectionPanel';
import { TechTreeModal } from './TechTree';
import { TopBar } from './TopBar';
import { BUILDINGS } from '../../sim/data/economy';

const HUD_MIN_MS = 50;
const HUD_MAX_MS = 200;

export interface GameScreenProps {
  options: GameOptions;
  initialGame?: Game;
  best: BestScores;
  onBest: (scores: BestScores) => void;
  onRestart: () => void;
  onQuit: () => void;
}

/**
 * Writes the autosave when the page goes away: closed or navigated off (pagehide), or hidden
 * (visibilitychange to hidden; becoming visible again writes nothing). Returns the detach.
 */
export function saveOnPageHide(session: Pick<Session, 'autoSave'>, win: EventTarget, doc: EventTarget & { readonly visibilityState: DocumentVisibilityState }): () => void {
  const onPageHide = () => session.autoSave();
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') session.autoSave();
  };
  win.addEventListener('pagehide', onPageHide);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('pagehide', onPageHide);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * HUD panels that edge markers keep clear of: the top bar with tonight's forecast, the event log,
 * the banners and the objectives card, and everything along the bottom edge. Toasts are left out;
 * they come and go within seconds.
 */
const HUD_PANELS = '.topbar, .forecast, .eventlog > *, .banners > *, .map-col > *, .selection-panel, .dock-col > *';

/** Screen rects of the HUD panels showing now, relative to `hud` (the HUD layer over the world canvas). */
export function measureHudPanels(hud: Element): ScreenRect[] {
  const origin = hud.getBoundingClientRect();
  const rects: ScreenRect[] = [];
  for (const el of hud.querySelectorAll(HUD_PANELS)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push({ x0: r.left - origin.left, y0: r.top - origin.top, x1: r.right - origin.left, y1: r.bottom - origin.top });
  }
  return rects;
}

export function GameScreen({ options, initialGame, best, onBest, onRestart, onQuit }: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [session] = useState(() => new Session(initialGame ?? createGame(options), { viewW: window.innerWidth, viewH: window.innerHeight }, { showIntro: true }));
  const [, setHudTick] = useState(0);
  const [newBest, setNewBest] = useState(false);
  /** The player has hovered the fog calendar (a first-day guide step the game state does not record). */
  const [calendarSeen, setCalendarSeen] = useState(false);
  const profile = useRef<FrameProfile>({ loop: {}, render: {}, hud: { renders: 0, totalMs: 0, maxMs: 0 } });
  /** When the frame loop asked for the HUD refresh that is rendering now. */
  const hudAsked = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const mini = miniRef.current as HTMLCanvasElement;
    const renderer = createRenderer(canvas, session.game.state);
    rendererRef.current = renderer;
    renderer.hudPanels = measureHudPanels(hudRef.current as HTMLDivElement);
    const minimap = createMinimap(mini, session.game.state);
    const fit = () => {
      renderer.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
      session.resize(window.innerWidth, window.innerHeight);
    };
    fit();
    window.addEventListener('resize', fit);
    const detachSave = saveOnPageHide(session, window, document);
    const input = attachInput(canvas, session, () => performance.now());
    profile.current.render = renderer.timings;
    const unhook = installDebugHook(session, profile.current, renderer);
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    let lastVersion = -1;
    const loop = (t: number) => {
      const dt = Math.max(0, t - last);
      last = t;
      const t0 = performance.now();
      input.pan(dt);
      session.frame(dt, t);
      const t1 = performance.now();
      renderer.draw(session, t);
      const t2 = performance.now();
      minimap.draw(session, t);
      const t3 = performance.now();
      const since = t - lastHud;
      if ((session.version !== lastVersion && since >= HUD_MIN_MS) || since >= HUD_MAX_MS) {
        lastVersion = session.version;
        lastHud = t;
        hudAsked.current = performance.now();
        setHudTick((n) => n + 1);
      }
      const loopTimes = profile.current.loop;
      loopTimes.simulation = t1 - t0;
      loopTimes.world = t2 - t1;
      loopTimes.minimap = t3 - t2;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      rendererRef.current = null;
      cancelAnimationFrame(raf);
      input.detach();
      unhook();
      window.removeEventListener('resize', fit);
      detachSave();
    };
  }, [session]);

  // Runs right after each HUD commit: render + diff + commit time of the refresh the loop asked for.
  useLayoutEffect(() => {
    if (hudAsked.current === 0) return;
    const ms = performance.now() - hudAsked.current;
    const hud = profile.current.hud;
    hud.renders++;
    hud.totalMs += ms;
    hud.maxMs = Math.max(hud.maxMs, ms);
    hudAsked.current = 0;
  });

  // After every HUD commit (at least every HUD_MAX_MS, so also after a window resize): where the panels are now.
  useLayoutEffect(() => {
    const renderer = rendererRef.current;
    if (renderer && hudRef.current) renderer.hudPanels = measureHudPanels(hudRef.current);
  });

  const over = session.isOver;
  const terrain = session.hover && !session.placing ? terrainHint(session.game.state, session.hover.x, session.hover.y) : null;
  useEffect(() => {
    if (!over) return;
    const entry = bestScoreEntry(session.game.state, new Date());
    if (!entry) return;
    const result = recordBestScore(best, session.game.state.options.difficulty, entry);
    if (!result.improved) return;
    saveBestScores(browserStorage(), result.scores);
    onBest(result.scores);
    setNewBest(true);
  }, [over]);

  return (
    <div class="game">
      <canvas ref={canvasRef} class={`world ${session.placing ? 'placing' : ''}`} data-testid="world" />
      <div class="hud" ref={hudRef}>
        <TopBar session={session} onCalendarHover={() => setCalendarSeen(true)} />
        <EventLog session={session} />
        <div class="toasts">
          {session.toasts.map((t) => (
            <div class="toast" key={t.id}>
              {t.text}
            </div>
          ))}
        </div>
        <div class="banners">
          {session.objectivesOpen && <ObjectivesCard session={session} />}
          {session.paused && !session.menuOpen && !over && (
            <div class="banner pause" data-testid="paused-banner">
              已暂停 · 空格继续 · 仍可下达指令
            </div>
          )}
          {session.placing && (
            <div class="banner">
              放置 <b>{BUILDINGS[session.placing].name}</b> · 左键放置 · <span class="key">Shift</span> 连续放置 · 右键或 <span class="key">Esc</span> 取消
            </div>
          )}
        </div>
        <div class="bottom">
          <div class="map-col">
            {terrain && (
              <div class="terrain-hint" data-testid="terrain-hint">
                {terrain}
              </div>
            )}
            <MinimapPanel session={session} canvasRef={miniRef} />
          </div>
          <SelectionPanel session={session} />
          <div class="dock-col">
            {!over && <GuidePanel session={session} calendarSeen={calendarSeen} />}
            <BuildPanel session={session} />
          </div>
        </div>
        {session.introCardOpen && session.game.state.clock.day === 1 && <IntroCard session={session} />}
        {session.incidentModalOpen && <IncidentModal session={session} />}
        {session.techOpen && <TechTreeModal session={session} />}
        {session.policiesOpen && <PolicyModal session={session} />}
        {session.helpOpen && <HelpOverlay session={session} />}
        {session.menuOpen && !over && <PauseMenu session={session} onRestart={onRestart} onQuit={onQuit} />}
        {over && <EndScreen session={session} best={best} newBest={newBest} onRestart={onRestart} onQuit={onQuit} />}
      </div>
    </div>
  );
}
