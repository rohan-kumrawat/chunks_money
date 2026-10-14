"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenBucketRateLimiter = void 0;
class TokenBucketRateLimiter {
    constructor(maxTokens = 10, refillRatePerMin = 10) {
        this.buckets = new Map();
        this.maxTokens = maxTokens;
        this.refillRatePerSec = refillRatePerMin / 60;
    }
    refill(state, now) {
        const elapsedSec = (now - state.lastRefill) / 1000;
        const tokensToAdd = elapsedSec * this.refillRatePerSec;
        state.tokens = Math.min(this.maxTokens, state.tokens + tokensToAdd);
        state.lastRefill = now;
    }
    consume(key, tokensToConsume = 1) {
        const now = Date.now();
        let state = this.buckets.get(key);
        if (!state) {
            state = { tokens: this.maxTokens, lastRefill: now };
            this.buckets.set(key, state);
        }
        else {
            this.refill(state, now);
        }
        if (state.tokens >= tokensToConsume) {
            state.tokens -= tokensToConsume;
            return { allowed: true, remainingTokens: state.tokens, waitMs: 0 };
        }
        else {
            const needed = tokensToConsume - state.tokens;
            const waitSec = needed / this.refillRatePerSec;
            return { allowed: false, remainingTokens: state.tokens, waitMs: Math.ceil(waitSec * 1000) };
        }
    }
    getBucket(key) {
        const now = Date.now();
        let state = this.buckets.get(key);
        if (!state) {
            return { tokens: this.maxTokens, maxTokens: this.maxTokens };
        }
        this.refill(state, now);
        return { tokens: Math.round(state.tokens * 100) / 100, maxTokens: this.maxTokens };
    }
}
exports.TokenBucketRateLimiter = TokenBucketRateLimiter;
//# sourceMappingURL=token-bucket.js.map