export interface DelayOptions {
    baseDelayMs?: number;
    minJitterMs?: number;
    maxJitterMs?: number;
    riskMultiplier?: number;
}
export declare class DelayCalculator {
    static calculateDelayMs(chunkNumber: number, riskScore?: number, options?: DelayOptions): number;
}
