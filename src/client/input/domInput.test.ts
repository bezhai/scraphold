// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { raiseIncident } from '../../sim/incidents/incidents';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { attachInput, type DomInput } from './domInput';

let input: DomInput | null = null;

afterEach(() => {
  input?.detach();
  input = null;
});

function setup(options: { showIntro?: boolean } = {}) {
  const w = buildTestWorld();
  const session = new Session(w.game, { viewW: 1280, viewH: 720 }, options);
  input = attachInput(document.createElement('canvas'), session, () => 0);
  return { ...w, session };
}

function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { code, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('attachInput keyboard', () => {
  it('Tab never moves the browser focus: its default is prevented, also when the key repeats', () => {
    setup();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(press('Tab', { repeat: true }).defaultPrevented).toBe(true);
  });

  it('while the incident card is open only its keys work: T, P, build keys, K and the pan keys do nothing', () => {
    const w = setup();
    raiseIncident(w.game, 'caravan');
    w.session.openIncidentModal();
    expect(w.session.incidentModalOpen).toBe(true);
    const camera = { ...w.session.camera };
    w.session.select([w.rifle1.id]);
    for (const code of ['KeyT', 'KeyP', 'KeyQ', 'KeyK', 'KeyW', 'Space']) press(code);
    input?.pan(500);
    expect(w.session).toMatchObject({ techOpen: false, policiesOpen: false, placing: null, paused: false });
    expect(w.session.camera).toMatchObject({ x: camera.x, y: camera.y });
    expect(w.rifle1.order).toEqual({ type: 'idle' });

    expect(press('Tab').defaultPrevented).toBe(true);
    expect(w.session.incidentModalOpen).toBe(true);
    press('Escape');
    expect(w.session.incidentModalOpen).toBe(false);
    press('KeyT');
    expect(w.session.techOpen).toBe(true);
  });

  it('while the intro card is open only its close keys work: game shortcuts, control groups and the pan keys do nothing', () => {
    const w = setup({ showIntro: true });
    expect(w.session.introCardOpen).toBe(true);
    w.session.select([w.rifle1.id]);
    w.session.handleKey({ type: 'assignGroup', index: 0 }, 0);
    w.session.select([]);
    w.session.toasts = [];
    const camera = { ...w.session.camera };
    for (const code of ['KeyT', 'KeyP', 'KeyQ', 'KeyO', 'F1', 'Equal', 'Tab', 'Digit1', 'KeyW', 'ArrowLeft']) press(code);
    input?.pan(500);
    expect(w.session).toMatchObject({ introCardOpen: true, techOpen: false, policiesOpen: false, objectivesOpen: false, helpOpen: false, placing: null, speed: 1, selection: [], toasts: [] });
    expect(w.session.camera).toMatchObject({ x: camera.x, y: camera.y });

    press('Escape');
    expect(w.session.introCardOpen).toBe(false);
    expect(w.session).toMatchObject({ paused: false, menuOpen: false });
    press('KeyT');
    expect(w.session.techOpen).toBe(true);
  });

  it('Space and Enter close the intro card too, without pausing the game', () => {
    for (const code of ['Space', 'Enter']) {
      const w = setup({ showIntro: true });
      expect(press(code).defaultPrevented, code).toBe(true);
      expect(w.session, code).toMatchObject({ introCardOpen: false, paused: false });
      input?.detach();
      input = null;
    }
  });
});
