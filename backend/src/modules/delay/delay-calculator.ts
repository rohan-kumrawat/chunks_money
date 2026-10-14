export interface DelayOptions {
  baseDelayMs?: number; // default: 2500ms
  minJitterMs?: number; // default: 500ms
  maxJitterMs?: number; // default: 2000ms
  riskMultiplier?: number; // 1.0 (low risk) to 2.5 (high risk)
}

export class DelayCalculator {
  /**
   * Calculates intelligent, staggered delays for successive chunk payouts.
   * Chunk 1 executes immediately (0ms).
   * Chunk 2+ executes with progressive base delays + randomized jitter to avoid
   * triggering NPCI/bank UPI velocity anti-spam blocks.
   */
  static calculateDelayMs(chunkNumber: number, riskScore: number = 0, options?: DelayOptions): number {
    if (chunkNumber <= 1) {
      return 0; // First chunk goes out immediately
    }

    const baseDelay = options?.baseDelayMs ?? 2500;
    const minJitter = options?.minJitterMs ?? 500;
    const maxJitter = options?.maxJitterMs ?? 2000;

    // Risk multiplier: higher risk score stretches the delay to stay off bank radars
    let riskMultiplier = 1.0;
    if (riskScore >= 70) {
      riskMultiplier = 2.2;
    } else if (riskScore >= 40) {
      riskMultiplier = 1.5;
    }

    const jitter = Math.floor(Math.random() * (maxJitter - minJitter + 1)) + minJitter;
    const progressiveDelay = (chunkNumber - 1) * baseDelay;

    return Math.round((progressiveDelay + jitter) * riskMultiplier);
  }
}
