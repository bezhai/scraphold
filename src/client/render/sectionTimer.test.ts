import { describe, expect, it } from 'vitest';
import { createSectionTimer } from './sectionTimer';

/** A canvas that logs pixel reads, and a clock that logs its readings and moves on 2 ms per reading. */
function rig() {
  const log: string[] = [];
  let t = 100;
  const canvas = {
    getImageData(x: number, y: number, w: number, h: number) {
      log.push(`read ${x},${y} ${w}x${h}`);
      return undefined as unknown as ImageData;
    },
  };
  const clock = () => {
    log.push('clock');
    return (t += 2);
  };
  return { log, timer: createSectionTimer(canvas, clock) };
}

describe('createSectionTimer', () => {
  it('times each section from the end of the previous one', () => {
    const { timer } = rig();
    timer.start();
    timer.lap('terrain');
    timer.lap('units');
    expect(timer.timings).toEqual({ terrain: 2, units: 2 });
  });

  it('by default leaves rasterizing to the browser: no pixel is read back', () => {
    const { log, timer } = rig();
    timer.start();
    timer.lap('terrain');
    expect(log).toEqual(['clock', 'clock']);
  });

  it('with rasterize on, reads one pixel back before every clock reading, so each section pays for its own pixels', () => {
    const { log, timer } = rig();
    timer.rasterize = true;
    timer.start();
    timer.lap('terrain');
    timer.lap('units');
    expect(log).toEqual(['read 0,0 1x1', 'clock', 'read 0,0 1x1', 'clock', 'read 0,0 1x1', 'clock']);
    expect(timer.timings).toEqual({ terrain: 2, units: 2 });
  });
});
