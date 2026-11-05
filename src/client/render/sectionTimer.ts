/**
 * Milliseconds per renderer section in the last frame, for profiling (read through the ?debug
 * hook). Canvas 2D calls mostly record drawing; the browser rasterizes it later, at the latest when
 * the frame is presented, so on a software rasterizer the clock between sections misses most of
 * the pixel work and puts it nowhere. With `rasterize` on, the timer reads one pixel back before
 * every clock reading, which makes the canvas rasterize everything queued so far: each section then
 * includes its own pixels. Off by default; the readbacks stall the pipeline, so only profiling
 * runs switch it on.
 */

export interface SectionTimer {
  /** Section name to milliseconds, rewritten every frame. */
  readonly timings: Record<string, number>;
  /** Rasterize the canvas before every clock reading (profiling only). */
  rasterize: boolean;
  /** Starts the frame's first section. */
  start(): void;
  /** Ends section `name` and starts the next one. */
  lap(name: string): void;
}

export function createSectionTimer(canvas: Pick<CanvasRenderingContext2D, 'getImageData'>, clock: () => number = () => performance.now()): SectionTimer {
  const timings: Record<string, number> = {};
  let mark = 0;
  const read = () => {
    if (timer.rasterize) canvas.getImageData(0, 0, 1, 1);
    return clock();
  };
  const timer: SectionTimer = {
    timings,
    rasterize: false,
    start() {
      mark = read();
    },
    lap(name) {
      const t = read();
      timings[name] = t - mark;
      mark = t;
    },
  };
  return timer;
}
