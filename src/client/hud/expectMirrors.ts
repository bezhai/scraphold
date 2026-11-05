/** Test-only assertion: a HUD availability mirrors what the simulation says about its command. */
import { expect } from 'vitest';
import { REJECT_REASON_TEXT, validateCommand, type Command, type Game } from '../../sim';
import type { Availability } from './availability';

export function expectMirrors(av: Availability | null | undefined, game: Game, cmd: Command): void {
  expect(av).toBeTruthy();
  const a = av as Availability;
  expect(a.command).toEqual(cmd);
  const r = validateCommand(game, cmd);
  expect(a.ok).toBe(r.ok);
  if (!r.ok && !a.ok) expect(a.reason).toBe(REJECT_REASON_TEXT[r.reason]);
}
