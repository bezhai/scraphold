import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, createGame, hashState, serializeGame, type Game } from '../../sim';
import { AUTOSAVE_STORAGE_KEY, clearAutoSave, loadAutoSave, peekAutoSaveSummary, saveAutoSave } from './autoSave';
import type { KeyValueStorage } from './browserStorage';

function memoryStorage(): KeyValueStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function newGame(): Game {
  return createGame({ seed: 'save-test-1', origin: 'scholars', difficulty: 'hard' });
}

/** A real save of `game` with one top-level field of the save format changed. */
function tamperedSave(game: Game, change: (data: { version: number; hash: string; state: { tick: number } }) => void): string {
  const data = JSON.parse(serializeGame(game));
  change(data);
  return JSON.stringify(data);
}

describe('autoSave', () => {
  it('saves and restores the canonical state', () => {
    const storage = memoryStorage();
    const game = newGame();
    expect(saveAutoSave(game, storage)).toBe(true);
    const restored = loadAutoSave(storage);
    expect(restored).not.toBeNull();
    expect(hashState(restored!)).toBe(hashState(game));
  });

  it('a save that differs only in its format version is refused, and the summary deletes it', () => {
    const game = newGame();
    const storage = memoryStorage();
    // Control: the very same save, untouched apart from the round trip, is accepted.
    storage.setItem(AUTOSAVE_STORAGE_KEY, tamperedSave(game, () => {}));
    expect(loadAutoSave(storage)).not.toBeNull();
    expect(peekAutoSaveSummary(storage)).not.toBeNull();

    for (const version of [SAVE_VERSION - 1, SAVE_VERSION + 1]) {
      storage.setItem(AUTOSAVE_STORAGE_KEY, tamperedSave(game, (d) => (d.version = version)));
      expect(loadAutoSave(storage), `version ${version}`).toBeNull();
      expect(peekAutoSaveSummary(storage), `version ${version}`).toBeNull();
      expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);
    }
  });

  it('a save whose state no longer matches its hash, or that does not parse, is refused and deleted', () => {
    const storage = memoryStorage();
    storage.setItem(AUTOSAVE_STORAGE_KEY, tamperedSave(newGame(), (d) => (d.state.tick += 1)));
    expect(loadAutoSave(storage)).toBeNull();
    expect(peekAutoSaveSummary(storage)).toBeNull();
    expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);

    storage.setItem(AUTOSAVE_STORAGE_KEY, 'invalid json {[');
    expect(peekAutoSaveSummary(storage)).toBeNull();
    expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);
  });

  it('the summary of a valid save has its day, origin and difficulty and leaves the save in place', () => {
    const storage = memoryStorage();
    expect(peekAutoSaveSummary(storage)).toBeNull();
    const game = newGame();
    saveAutoSave(game, storage);
    expect(peekAutoSaveSummary(storage)).toEqual({ day: game.state.clock.day, origin: 'scholars', difficulty: 'hard' });
    expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(true);
  });

  it('a finished game is never saved, and a stored finished game cannot be continued', () => {
    const storage = memoryStorage();
    const game = newGame();
    game.state.outcome.status = 'lost';
    expect(saveAutoSave(game, storage)).toBe(false);
    expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);

    // Saves written before this rule existed.
    storage.setItem(AUTOSAVE_STORAGE_KEY, serializeGame(game));
    expect(loadAutoSave(storage)).toBeNull();
    storage.setItem(AUTOSAVE_STORAGE_KEY, serializeGame(game));
    expect(peekAutoSaveSummary(storage)).toBeNull();
    expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);
  });

  it('clears the save', () => {
    const storage = memoryStorage();
    storage.setItem(AUTOSAVE_STORAGE_KEY, 'data');
    clearAutoSave(storage);
    expect(storage.items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);
  });
});
