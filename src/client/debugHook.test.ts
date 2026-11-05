// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { installDebugHook, type FrameProfile } from './debugHook';
import { Session } from './session';
import { buildTestWorld } from './testWorld';

const profile = (): FrameProfile => ({ loop: {}, render: {}, hud: { renders: 0, totalMs: 0, maxMs: 0 } });

let unhook: (() => void) | null = null;

afterEach(() => {
  unhook?.();
  unhook = null;
  window.history.replaceState(null, '', '/');
});

function install(url: string) {
  window.history.replaceState(null, '', url);
  const session = new Session(buildTestWorld().game, { viewW: 1280, viewH: 720 });
  const renderer = { rasterizeSections: false };
  unhook = installDebugHook(session, profile(), renderer);
  return renderer;
}

describe('installDebugHook', () => {
  it('with ?debug, rasterizeSections(on) switches the renderer’s forced rasterization in the section timings on and off', () => {
    const renderer = install('/?debug');
    window.scraphold!.rasterizeSections(true);
    expect(renderer.rasterizeSections).toBe(true);
    window.scraphold!.rasterizeSections(false);
    expect(renderer.rasterizeSections).toBe(false);
  });

  it('without ?debug installs nothing, so normal play cannot switch it on', () => {
    install('/');
    expect(window.scraphold).toBeUndefined();
  });
});
