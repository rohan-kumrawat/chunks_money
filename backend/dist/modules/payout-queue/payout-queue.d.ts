import { EventEmitter } from "events";
import { IPaymentGateway } from "../gateway/gateway.interface";
import { TokenBucketRateLimiter } from "../rate-limiter/token-bucket";
export interface PayoutJob {
    chunkId: string;
    collectionId: string;
    chunkNumber: number;
    totalChunks: number;
    amount: number;
    currency: string;
    payeeUpi: string;
    idempotencyKey: string;
    delayMs: number;
    scheduledAt: Date;
    status: "QUEUED" | "DELAYING" | "PROCESSING" | "SUCCESS" | "FAILED" | "RETRYING";
    executedAt?: Date;
    payoutReference?: string;
    gatewayPayoutId?: string;
    retryCount: number;
    error?: string;
}
export declare class PayoutQueueManager extends EventEmitter {
    private jobs;
    private gateway;
    private rateLimiter;
    private activeTimers;
    constructor(gateway: IPaymentGateway, rateLimiter: TokenBucketRateLimiter);
    enqueueJob(job: PayoutJob): void;
    private processJob;
    getJob(chunkId: string): PayoutJob | undefined;
    getJobsByCollection(collectionId: string): PayoutJob[];
}
