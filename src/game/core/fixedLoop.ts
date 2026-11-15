/**
 * FIXED-TIMESTEP LOOP
 * -------------------
 * The game simulates in equal slices (1/120 s) no matter how fast the screen
 * refreshes. Each rendered frame we:
 *   1. add the real elapsed time to an accumulator,
 *   2. run as many whole simulation steps as fit,
 *   3. keep the left-over fraction as `alpha` (0..1).
 * Rendering then draws everything at  previous + (current - previous) * alpha,
 * which gives perfectly smooth motion on 60 / 90 / 120 / 144 Hz displays.
 *
 * Pure TypeScript - no Phaser - so it can be unit tested.
 */
export class FixedStepLoop {
  readonly stepSeconds: number;
  /** Fraction of a step left over after the last advance(): 0 = at `current`'s predecessor, 1 = at current. */
  alpha = 1;
  /** Steps run by the most recent advance() (shown in the debug overlay). */
  lastSteps = 0;
  /** Total steps since start. */
  totalSteps = 0;

  private accumulator = 0;
  private readonly maxFrameSeconds: number;

  /**
   * @param hz              simulation rate
   * @param maxFrameSeconds longest frame we will try to catch up on. Longer
   *                        hitches (tab switch, GC pause) are simply dropped,
   *                        which prevents the "spiral of death".
   */
  constructor(hz: number, maxFrameSeconds = 0.1) {
    this.stepSeconds = 1 / hz;
    this.maxFrameSeconds = maxFrameSeconds;
  }

  /** Feed real elapsed seconds; calls `step(dt)` zero or more times. Returns the step count. */
  advance(elapsedSeconds: number, step: (dt: number) => void): number {
    if (!(elapsedSeconds > 0)) elapsedSeconds = 0;
    this.accumulator += Math.min(elapsedSeconds, this.maxFrameSeconds);
    let steps = 0;
    // The tiny epsilon stops floating point error from skipping a step on
    // displays whose refresh is an exact multiple of the sim rate.
    while (this.accumulator >= this.stepSeconds - 1e-9) {
      step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    this.alpha = this.accumulator / this.stepSeconds;
    this.lastSteps = steps;
    this.totalSteps += steps;
    return steps;
  }

  /** Forget any banked time (after loading, pausing, tab switches). */
  reset(): void {
    this.accumulator = 0;
    this.alpha = 1;
  }
}
