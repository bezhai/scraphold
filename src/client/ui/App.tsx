/** Screens: start → game (restart keeps the options) → back to start. */
import { useState } from 'preact/hooks';
import type { Game, GameOptions } from '../../sim';
import { loadBestScores, type BestScores } from '../storage/bestScores';
import { browserStorage } from '../storage/browserStorage';
import { GameScreen } from './GameScreen';
import { StartScreen } from './StartScreen';

type Screen = { kind: 'start' } | { kind: 'game'; options: GameOptions; initialGame?: Game; run: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'start' });
  const [best, setBest] = useState<BestScores>(() => loadBestScores(browserStorage()));
  if (screen.kind === 'start') {
    return (
      <StartScreen
        best={best}
        onStart={(options) => setScreen({ kind: 'game', options, run: 1 })}
        onContinue={(game) => setScreen({ kind: 'game', options: game.state.options, initialGame: game, run: 1 })}
      />
    );
  }
  return (
    <GameScreen
      key={screen.run}
      options={screen.options}
      initialGame={screen.initialGame}
      best={best}
      onBest={setBest}
      onRestart={() => setScreen({ ...screen, run: screen.run + 1, initialGame: undefined })}
      onQuit={() => setScreen({ kind: 'start' })}
    />
  );
}
