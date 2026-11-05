/**
 * Fullscreen toggle for the top bar and the pause menu: puts the whole page in fullscreen through
 * the Fullscreen API. The label follows `fullscreenchange`, so it is right also after the browser
 * leaves fullscreen by itself (Esc, F11). Not rendered where the API is missing or not allowed.
 * `glyph` shows corner marks with the label as tooltip instead of the words: the top bar is one
 * row and at 1440 px wide has no room for 退出全屏.
 */
import { useEffect, useState } from 'preact/hooks';
import { FullscreenGlyph } from './Glyphs';

export function FullscreenButton({ class: className, glyph = false }: { class: string; glyph?: boolean }) {
  const [active, setActive] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  if (!document.fullscreenEnabled) return null;
  const toggle = () => {
    // A refused request (no user gesture, permissions policy) changes nothing, and the label stays as it is.
    const done = active ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done.catch(() => {});
  };
  const label = active ? '退出全屏' : '全屏';
  return (
    <button class={className} data-testid="fullscreen" onClick={toggle} title={glyph ? label : undefined} aria-label={label}>
      {glyph ? <FullscreenGlyph exit={active} /> : label}
    </button>
  );
}
