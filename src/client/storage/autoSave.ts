/**
 * The automatic save: one game in progress in localStorage (Session decides when to write it).
 * Measured sizes are about 54 KB on day 1 and 125–195 KB around days 14–20, well within the
 * localStorage quota. A save is only usable if restoreGame accepts it (same format version,
 * intact data, matching state hash) and the game in it is still being played; anything else is
 * deleted, so the start screen never offers a "continue" that cannot be loaded.
 */
import { restoreGame, serializeGame, type Game } from '../../sim';
import type { Difficulty } from '../../sim/data/combat';
import type { OriginId } from '../../sim/data/economy';
import { browserStorage, type KeyValueStorage } from './browserStorage';

export const AUTOSAVE_STORAGE_KEY = 'scraphold.autosave.v2';

export interface AutoSaveSummary {
  day: number;
  origin: OriginId;
  difficulty: Difficulty;
}

/** Writes the save; a finished game is never saved (it cannot be continued). */
export function saveAutoSave(game: Pick<Game, 'state'>, storage: KeyValueStorage = browserStorage()): boolean {
  if (game.state.outcome.status !== 'playing') return false;
  try {
    storage.setItem(AUTOSAVE_STORAGE_KEY, serializeGame(game));
    return true;
  } catch {
    return false;
  }
}

/** The saved game in progress, or null; a save that cannot be continued is deleted. */
export function loadAutoSave(storage: KeyValueStorage = browserStorage()): Game | null {
  let text: string | null;
  try {
    text = storage.getItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  const game = restoreGame(text);
  if (game && game.state.outcome.status === 'playing') return game;
  clearAutoSave(storage);
  return null;
}

export function clearAutoSave(storage: KeyValueStorage = browserStorage()): void {
  try {
    storage.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); there is nothing to delete then.
  }
}

/** What the start screen shows for "continue", validated the same way as loading it. */
export function peekAutoSaveSummary(storage: KeyValueStorage = browserStorage()): AutoSaveSummary | null {
  const game = loadAutoSave(storage);
  if (!game) return null;
  const { clock, options } = game.state;
  return { day: clock.day, origin: options.origin, difficulty: options.difficulty };
}
