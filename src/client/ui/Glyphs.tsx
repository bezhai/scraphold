/** Small inline glyphs for HUD states (drawn in code, no image assets); they take currentColor. */

export function LockGlyph() {
  return (
    <svg class="glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.6 5.2V3.9a2.4 2.4 0 0 1 4.8 0v1.3" fill="none" stroke="currentColor" stroke-width="1.3" />
      <rect x="2.4" y="5.2" width="7.2" height="5.4" rx="1" fill="currentColor" />
    </svg>
  );
}

/** Points right when closed, down when open. */
export function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg class={`glyph chevron ${open ? 'open' : ''}`} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 2.8 7.7 6l-3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function PauseGlyph() {
  return (
    <svg class="glyph" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="3" y="2.5" width="2.1" height="7" rx="0.5" fill="currentColor" />
      <rect x="6.9" y="2.5" width="2.1" height="7" rx="0.5" fill="currentColor" />
    </svg>
  );
}

export function PlayGlyph() {
  return (
    <svg class="glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.6 2.4v7.2L9.6 6z" fill="currentColor" />
    </svg>
  );
}

/** Four corners pointing out (enter fullscreen) or in (leave fullscreen). */
export function FullscreenGlyph({ exit }: { exit: boolean }) {
  const corners = exit ? 'M2 4.5h2.5V2M7.5 2v2.5H10M10 7.5H7.5V10M4.5 10V7.5H2' : 'M2 4.5V2h2.5M7.5 2H10v2.5M10 7.5V10H7.5M4.5 10H2V7.5';
  return (
    <svg class="glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d={corners} fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** A pennant on a pole: the mark the map draws over units under the player's command (render/overlays.ts). */
export function CommandFlagGlyph() {
  return (
    <svg class="glyph" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 11V1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <path d="M3.6 1.6 10 4.1 3.6 6.6z" fill="currentColor" />
    </svg>
  );
}
