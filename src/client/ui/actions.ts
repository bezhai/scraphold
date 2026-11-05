/** Button handlers: run an Availability's command or explain why it is unavailable. */
import type { Availability } from '../hud/availability';
import type { Session } from '../session';

export function act(session: Session, av: Availability | null | undefined): void {
  if (!av) return;
  const now = performance.now();
  if (av.ok) session.issue([av.command], now);
  else session.toast(av.reason, now);
}

export function hpClass(fraction: number): string {
  return fraction > 0.6 ? '' : fraction > 0.3 ? 'mid' : 'low';
}

export function rateTone(n: number): string {
  return n > 0.5 ? 'tone-good' : n < -0.5 ? 'tone-danger' : 'muted';
}
