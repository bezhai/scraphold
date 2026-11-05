/**
 * Start screen: camp origin (营地特性), difficulty, seed (random / daily / custom), local best
 * scores, and a live preview of the terrain around the core of the chosen seed.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createGame, type Game, type GameOptions } from '../../sim';
import { DIFFICULTIES, DIFFICULTY_IDS, SOLDIERS, type Difficulty } from '../../sim/data/combat';
import { BUILDINGS, ORIGINS, ORIGIN_IDS, RESOURCE_NAMES, RESOURCES, type OriginId } from '../../sim/data/economy';
import { drawBuilding } from '../render/drawBuildings';
import { TILE_PX, renderTerrain } from '../render/terrainLayer';
import { dailySeed, randomSeed, seedForChoice, type SeedMode } from '../seeds';
import type { BestScores } from '../storage/bestScores';
import { clearAutoSave, loadAutoSave, peekAutoSaveSummary, type AutoSaveSummary } from '../storage/autoSave';

const ORIGIN_QUOTES: Record<OriginId, string> = {
  scavengers: '“我们在锈原的废墟里长大，知道哪块铁能用、哪块铁会要命。”',
  militia: '“旧驻军的番号早就没人记得了，枪还在，规矩也还在。”',
  scholars: '“避难所的门开了以后，我们带出来的不只是书，还有怎么读懂旧时代的办法。”',
};

function originStart(id: OriginId): string {
  const s = ORIGINS[id].start;
  const parts: string[] = [];
  for (const b of s.buildings) parts.push(`开局一座${BUILDINGS[b].name}`);
  for (const u of s.soldiers) parts.push(`${u.count} 名${SOLDIERS[u.type].name}`);
  for (const r of RESOURCES) if ((s.extraResources[r] ?? 0) > 0) parts.push(`${RESOURCE_NAMES[r]} +${s.extraResources[r]}`);
  if (s.revealRuins) parts.push('揭示所有遗迹');
  return parts.join(' · ');
}

function difficultyNote(d: Difficulty): string {
  const def = DIFFICULTIES[d];
  return `夜袭规模 ×${def.nightBudgetPct} · 怪物生命 ×${def.mutantHpPct} · 巢穴成长 ×${def.nestGrowthPct} · 得分 ×${def.scoreMultiplier}`;
}

const PREVIEW_W = 30;
const PREVIEW_H = 20;

function paintPreview(canvas: HTMLCanvasElement, seed: string, origin: OriginId, difficulty: Difficulty): void {
  const game = createGame({ seed, origin, difficulty });
  const view = game.state;
  const terrain = renderTerrain(view, (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });
  const g = canvas.getContext('2d');
  if (!g) return;
  const core = view.map.coreTile;
  const x0 = Math.max(0, Math.min(view.map.width - PREVIEW_W, core.x + 1.5 - PREVIEW_W / 2));
  const y0 = Math.max(0, Math.min(view.map.height - PREVIEW_H, core.y + 1.5 - PREVIEW_H / 2));
  const scale = canvas.width / PREVIEW_W;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(terrain, x0 * TILE_PX, y0 * TILE_PX, PREVIEW_W * TILE_PX, PREVIEW_H * TILE_PX, 0, 0, canvas.width, canvas.height);
  g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  for (const e of view.entities.values()) {
    if (e.kind === 'building') drawBuilding(g, { type: e.type, tileX: e.tileX, tileY: e.tileY, size: e.size, built: 1, workers: 0, slots: 0, aim: null }, 0);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

export function StartScreen({ best, onStart, onContinue }: { best: BestScores; onStart: (options: GameOptions) => void; onContinue?: (game: Game) => void }) {
  const [origin, setOrigin] = useState<OriginId>('scavengers');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [mode, setMode] = useState<SeedMode>('random');
  const [custom, setCustom] = useState('');
  const [code, setCode] = useState(() => randomSeed());
  const [saveSummary, setSaveSummary] = useState<AutoSaveSummary | null>(() => peekAutoSaveSummary());
  const preview = useRef<HTMLCanvasElement>(null);
  const seed = mode === 'random' ? code : seedForChoice({ mode, custom }, new Date());

  useEffect(() => {
    if (!seed || !preview.current) return;
    const canvas = preview.current;
    const t = setTimeout(() => paintPreview(canvas, seed, origin, difficulty), 120);
    return () => clearTimeout(t);
  }, [seed]);

  const start = () => {
    if (seed) onStart({ seed, origin, difficulty });
  };

  const handleContinue = () => {
    if (!onContinue) return;
    const game = loadAutoSave();
    if (game) onContinue(game);
  };

  const handleDeleteSave = (e: MouseEvent) => {
    e.stopPropagation();
    clearAutoSave();
    setSaveSummary(null);
  };

  return (
    <div class="start" data-testid="start-screen">
      <div class="start-backdrop">
        <canvas ref={preview} width={1500} height={1000} />
      </div>
      <div class="start-inner">
        <div>
          <div class="title-block">
            <div class="kicker">
              <span class="hazard" />
              废土守家 · 二十个昼夜
            </div>
            <h1>
              锈土<span class="dot">·</span>据点
            </h1>
            <div class="latin">SCRAPHOLD</div>
            <div class="pitch" data-testid="pitch">
              白天派幸存者拾荒、种地、炼油、做研究，把据点建起来；夜里变异体从雾里摸过来，守住炉心。撑过二十夜、修好 K-7 中继站向长明城求救、找到母巢把它端掉，三条路都能赢。
            </div>
          </div>

          {saveSummary && onContinue && (
            <div class="autosave-section" data-testid="autosave-section">
              <div class="autosave-bar">
                <button class="btn primary autosave-btn" data-testid="continue-game" onClick={handleContinue}>
                  继续游戏（第 {saveSummary.day} 天 · {ORIGINS[saveSummary.origin].name}）
                </button>
                <button class="btn small danger delete-save-btn" data-testid="delete-save" onClick={handleDeleteSave} title="删除这台电脑上的自动存档">
                  删除存档
                </button>
              </div>
            </div>
          )}

          <div class="form-section">
            <div class="label">营地特性</div>
            <div class="origins">
              {ORIGIN_IDS.map((id, i) => (
                <button key={id} class={`origin ${origin === id ? 'on' : ''}`} data-testid={`origin-${id}`} onClick={() => setOrigin(id)}>
                  <span class="o-tag">0{i + 1}</span>
                  <span class="o-name">{ORIGINS[id].name}</span>
                  <span class="o-desc">{ORIGINS[id].description}</span>
                  <div class="o-quote">{ORIGIN_QUOTES[id]}</div>
                  <span class="o-start">{originStart(id)}</span>
                </button>
              ))}
            </div>
          </div>

          <div class="form-section">
            <div class="label">难度</div>
            <div class="seg">
              {DIFFICULTY_IDS.map((d) => (
                <button key={d} class={difficulty === d ? 'on' : ''} data-testid={`difficulty-${d}`} onClick={() => setDifficulty(d)}>
                  {DIFFICULTIES[d].name}
                </button>
              ))}
            </div>
            <div class="seg-note">{difficultyNote(difficulty)}</div>
          </div>

          <div class="form-section">
            <div class="label">地图种子</div>
            <div class="seg">
              <button class={mode === 'random' ? 'on' : ''} data-testid="seed-random" onClick={() => setMode('random')}>
                随机
              </button>
              <button class={mode === 'daily' ? 'on' : ''} data-testid="seed-daily" onClick={() => setMode('daily')}>
                每日
              </button>
              <button class={mode === 'custom' ? 'on' : ''} data-testid="seed-custom" onClick={() => setMode('custom')}>
                自定义
              </button>
            </div>
            <div class="seed-row">
              {mode === 'custom' ? (
                <input value={custom} placeholder="输入任意文字作为种子" maxLength={32} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
              ) : (
                <>
                  <span class="seed-value" data-testid="seed-value">
                    {seed}
                  </span>
                  {mode === 'random' ? (
                    <button class="btn small" onClick={() => setCode(randomSeed())}>
                      换一个
                    </button>
                  ) : (
                    <span class="seed-note">今天所有人都是同一张图（{dailySeed(new Date())}）</span>
                  )}
                </>
              )}
            </div>
          </div>

          <div class="start-cta">
            <button class={`btn primary ${seed ? '' : 'is-disabled'}`} data-testid="start" onClick={start}>
              进入废土
            </button>
            <span class="seed-note">同一个种子加同样的操作，结果完全一致</span>
          </div>
        </div>

        <div class="side">
          <div class="panel">
            <div class="label">本地最佳</div>
            <table class="best-table">
              <tbody>
                {DIFFICULTY_IDS.map((d) => {
                  const b = best[d];
                  return (
                    <tr key={d}>
                      <td>{DIFFICULTIES[d].name}</td>
                      <td class="muted">{b ? `${ORIGINS[b.origin].name} · ${b.seed}` : ''}</td>
                      <td class="v">{b ? b.score : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="panel">
            <div class="label">据点周边</div>
            <div class="map-caption">
              背景是这个种子下炉心附近的地形。沃土适合温室，残骸适合拆解站，黑色油渍只能建油井；更远的地方藏着遗迹和巢穴。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
