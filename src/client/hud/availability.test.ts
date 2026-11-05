import { describe, expect, it } from 'vitest';
import { REJECT_REASON_TEXT, validateCommand } from '../../sim';
import { buildTestWorld } from '../testWorld';
import { availabilityOf, unavailable } from './availability';

describe('availabilityOf', () => {
  it('mirrors validateCommand and carries the command', () => {
    const w = buildTestWorld();
    const ok = { type: 'hold' as const, unitIds: [w.rifle1.id] };
    expect(availabilityOf(w.game, ok)).toEqual({ ok: true, command: ok });
    const bad = { type: 'hold' as const, unitIds: [w.survivor1.id] };
    const r = validateCommand(w.game, bad);
    expect(r.ok).toBe(false);
    expect(availabilityOf(w.game, bad)).toEqual({ ok: false, reason: REJECT_REASON_TEXT[r.ok ? 'gameOver' : r.reason], command: bad });
  });

  it('unavailable() is a client-side reason with no command', () => {
    expect(unavailable('没有空闲的幸存者')).toEqual({ ok: false, reason: '没有空闲的幸存者', command: null });
  });
});
