export interface BucketState {
    tokens: number;
    lastRefill: number;
}
export declare class TokenBucketRateLimiter {
    private buckets;
    private maxTokens;
    private refillRatePerSec;
    constructor(maxTokens?: number, refillRatePerMin?: number);
    private refill;
    consume(key: string, tokensToConsume?: number): {
        allowed: boolean;
        remainingTokens: number;
        waitMs: number;
    };
    getBucket(key: string): {
        tokens: number;
        maxTokens: number;
    };
}
