import { describe, expect, it } from 'vitest';
import { BUILD_HOTKEYS, actionForKey, panDirectionFromKeys } from './keymap';

const key = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('actionForKey', () => {
  it('maps game controls', () => {
    expect(actionForKey(key('Space'))).toEqual({ type: 'togglePause' });
    expect(actionForKey(key('Escape'))).toEqual({ type: 'cancel' });
    expect(actionForKey(key('KeyH'))).toEqual({ type: 'hold' });
    expect(actionForKey(key('KeyX'))).toEqual({ type: 'stop' });
    expect(actionForKey(key('KeyK'))).toEqual({ type: 'retreat' });
    expect(actionForKey(key('KeyF'))).toEqual({ type: 'jumpToAlert' });
    expect(actionForKey(key('KeyT'))).toEqual({ type: 'toggleTech' });
    expect(actionForKey(key('KeyP'))).toEqual({ type: 'togglePolicies' });
    expect(actionForKey(key('KeyG'))).toEqual({ type: 'selectIdleSurvivors' });
    expect(actionForKey(key('KeyO'))).toEqual({ type: 'toggleObjectives' });
    expect(actionForKey(key('KeyJ'))).toBeNull();
    expect(actionForKey(key('Tab'))).toEqual({ type: 'reopenIncident' });
    expect(actionForKey(key('Equal'))).toEqual({ type: 'speed', delta: 1 });
    expect(actionForKey(key('Minus'))).toEqual({ type: 'speed', delta: -1 });
  });

  it('opens the help with F1 and with ? (Shift+/, or / alone)', () => {
    expect(actionForKey(key('F1'))).toEqual({ type: 'toggleHelp' });
    expect(actionForKey(key('Slash', { shiftKey: true }))).toEqual({ type: 'toggleHelp' });
    expect(actionForKey(key('Slash'))).toEqual({ type: 'toggleHelp' });
  });

  it('maps control groups: digit recalls, Ctrl+digit assigns, Shift+digit adds', () => {
    expect(actionForKey(key('Digit1'))).toEqual({ type: 'recallGroup', index: 0 });
    expect(actionForKey(key('Digit5', { ctrlKey: true }))).toEqual({ type: 'assignGroup', index: 4 });
    expect(actionForKey(key('Digit3', { metaKey: true }))).toEqual({ type: 'assignGroup', index: 2 });
    expect(actionForKey(key('Digit2', { shiftKey: true }))).toEqual({ type: 'addToGroup', index: 1 });
    expect(actionForKey(key('Digit6'))).toBeNull();
  });

  it('maps every build hotkey to its building and none collides with other controls', () => {
    for (const [code, building] of Object.entries(BUILD_HOTKEYS)) {
      expect(actionForKey(key(code))).toEqual({ type: 'build', building });
    }
    const reserved = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyH', 'KeyX', 'KeyK', 'KeyF', 'KeyT', 'KeyP', 'KeyG', 'KeyO'];
    expect(Object.keys(BUILD_HOTKEYS).filter((c) => reserved.includes(c))).toEqual([]);
  });

  it('while the incident card is open, 1-3 pick a choice (never a control group), Esc and Tab still work, every other key does nothing', () => {
    const open = { modal: 'incident' } as const;
    expect(actionForKey(key('Digit1'), open)).toEqual({ type: 'chooseIncidentChoice', index: 0 });
    expect(actionForKey(key('Digit2'), open)).toEqual({ type: 'chooseIncidentChoice', index: 1 });
    expect(actionForKey(key('Digit3'), open)).toEqual({ type: 'chooseIncidentChoice', index: 2 });
    expect(actionForKey(key('Escape'), open)).toEqual({ type: 'cancel' });
    expect(actionForKey(key('Tab'), open)).toEqual({ type: 'reopenIncident' });
    for (const code of ['Digit4', 'Digit5', 'KeyT', 'KeyP', 'KeyK', 'KeyH', 'KeyX', 'KeyF', 'KeyG', 'KeyO', 'Space', 'F1', 'Slash', 'Equal', 'Minus', ...Object.keys(BUILD_HOTKEYS)]) {
      expect(actionForKey(key(code), open), code).toBeNull();
    }
    expect(actionForKey(key('Digit1', { ctrlKey: true }), open)).toBeNull();
    expect(actionForKey(key('Digit2', { shiftKey: true }), open)).toBeNull();
  });

  it('while the intro card is open, Esc, Space and Enter close it and every other key does nothing', () => {
    const open = { modal: 'intro' } as const;
    for (const code of ['Escape', 'Space', 'Enter']) expect(actionForKey(key(code), open), code).toEqual({ type: 'closeIntroCard' });
    for (const code of ['Digit1', 'Digit3', 'Digit5', 'KeyT', 'KeyP', 'KeyK', 'KeyH', 'KeyX', 'KeyF', 'KeyG', 'KeyO', 'Tab', 'F1', 'Slash', 'Equal', 'Minus', ...Object.keys(BUILD_HOTKEYS)]) {
      expect(actionForKey(key(code), open), code).toBeNull();
    }
    expect(actionForKey(key('Digit1', { ctrlKey: true }), open)).toBeNull();
    expect(actionForKey(key('Digit2', { shiftKey: true }), open)).toBeNull();
  });

  it('leaves Ctrl/Alt letter combinations to the browser and ignores pan keys', () => {
    expect(actionForKey(key('KeyQ', { ctrlKey: true }))).toBeNull();
    expect(actionForKey(key('KeyQ', { altKey: true }))).toBeNull();
    expect(actionForKey(key('KeyW'))).toBeNull();
    expect(actionForKey(key('ArrowLeft'))).toBeNull();
  });
});

describe('panDirectionFromKeys', () => {
  it('combines held WASD and arrow keys', () => {
    expect(panDirectionFromKeys(new Set(['KeyW']))).toEqual({ dx: 0, dy: -1 });
    expect(panDirectionFromKeys(new Set(['KeyD', 'ArrowDown']))).toEqual({ dx: 1, dy: 1 });
    expect(panDirectionFromKeys(new Set(['KeyA', 'KeyD']))).toEqual({ dx: 0, dy: 0 });
    expect(panDirectionFromKeys(new Set())).toEqual({ dx: 0, dy: 0 });
  });
});
