export interface BucketState {
  tokens: number;
  lastRefill: number; // timestamp in ms
}

export class TokenBucketRateLimiter {
  private buckets: Map<string, BucketState> = new Map();
  private maxTokens: number;
  private refillRatePerSec: number;

  constructor(maxTokens: number = 10, refillRatePerMin: number = 10) {
    this.maxTokens = maxTokens;
    this.refillRatePerSec = refillRatePerMin / 60; // 0.1667 tokens/sec
  }

  /**
   * Refills the bucket based on elapsed time since last request.
   */
  private refill(state: BucketState, now: number): void {
    const elapsedSec = (now - state.lastRefill) / 1000;
    const tokensToAdd = elapsedSec * this.refillRatePerSec;
    state.tokens = Math.min(this.maxTokens, state.tokens + tokensToAdd);
    state.lastRefill = now;
  }

  /**
   * Attempts to consume 1 token for a given key (e.g. beneficiary UPI or merchant ID).
   * Returns: { allowed: boolean, remainingTokens: number, waitMs: number }
   */
  consume(key: string, tokensToConsume: number = 1): { allowed: boolean; remainingTokens: number; waitMs: number } {
    const now = Date.now();
    let state = this.buckets.get(key);

    if (!state) {
      state = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, state);
    } else {
      this.refill(state, now);
    }

    if (state.tokens >= tokensToConsume) {
      state.tokens -= tokensToConsume;
      return { allowed: true, remainingTokens: state.tokens, waitMs: 0 };
    } else {
      // Calculate how long until enough tokens are refilled
      const needed = tokensToConsume - state.tokens;
      const waitSec = needed / this.refillRatePerSec;
      return { allowed: false, remainingTokens: state.tokens, waitMs: Math.ceil(waitSec * 1000) };
    }
  }

  getBucket(key: string): { tokens: number; maxTokens: number } {
    const now = Date.now();
    let state = this.buckets.get(key);
    if (!state) {
      return { tokens: this.maxTokens, maxTokens: this.maxTokens };
    }
    this.refill(state, now);
    return { tokens: Math.round(state.tokens * 100) / 100, maxTokens: this.maxTokens };
  }
}
