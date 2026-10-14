import { EventEmitter } from "events";
import { IPaymentGateway, PayoutChunkResult } from "../gateway/gateway.interface";
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

export class PayoutQueueManager extends EventEmitter {
  private jobs: Map<string, PayoutJob> = new Map();
  private gateway: IPaymentGateway;
  private rateLimiter: TokenBucketRateLimiter;
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(gateway: IPaymentGateway, rateLimiter: TokenBucketRateLimiter) {
    super();
    this.gateway = gateway;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Enqueues a payout chunk job with its designated intelligent delay.
   */
  enqueueJob(job: PayoutJob): void {
    this.jobs.set(job.chunkId, job);
    this.emit("job:enqueued", job);

    if (job.delayMs <= 0) {
      // Execute immediately (Chunk 1)
      this.processJob(job.chunkId);
    } else {
      // Schedule with delay (Chunk 2, Chunk 3, etc.)
      job.status = "DELAYING";
      this.emit("job:delaying", { ...job });

      const timer = setTimeout(() => {
        this.activeTimers.delete(job.chunkId);
        this.processJob(job.chunkId);
      }, job.delayMs);

      this.activeTimers.set(job.chunkId, timer);
    }
  }

  /**
   * Processes an individual payout chunk job through rate limits & gateway.
   */
  private async processJob(chunkId: string): Promise<void> {
    const job = this.jobs.get(chunkId);
    if (!job) return;

    job.status = "PROCESSING";
    this.emit("job:processing", { ...job });

    // 1. Rate Limit Token Bucket Check (Problem #1)
    const rateCheck = this.rateLimiter.consume(`upi:${job.payeeUpi}`);
    if (!rateCheck.allowed) {
      job.status = "RETRYING";
      job.retryCount++;
      job.error = `Rate limit exceeded. Waiting ${rateCheck.waitMs}ms for token refill.`;
      this.emit("job:throttled", { ...job, waitMs: rateCheck.waitMs });

      // Re-schedule after waitMs with 200ms jitter
      const retryDelay = rateCheck.waitMs + Math.floor(Math.random() * 300);
      const timer = setTimeout(() => {
        this.processJob(chunkId);
      }, retryDelay);
      this.activeTimers.set(chunkId, timer);
      return;
    }

    // 2. Gateway Payout Execution with Idempotency Key (Problem #3)
    try {
      const payoutResult: PayoutChunkResult = await this.gateway.executePayoutChunk({
        chunkId: job.chunkId,
        collectionId: job.collectionId,
        chunkNumber: job.chunkNumber,
        totalChunks: job.totalChunks,
        amount: job.amount,
        currency: job.currency,
        payeeUpi: job.payeeUpi,
        idempotencyKey: job.idempotencyKey,
      });

      if (payoutResult.success) {
        job.status = "SUCCESS";
        job.executedAt = new Date();
        job.gatewayPayoutId = payoutResult.gatewayPayoutId;
        job.payoutReference = payoutResult.payoutReference;
        this.emit("job:success", { ...job });
      } else {
        throw new Error(payoutResult.errorMessage || "Gateway payout rejected");
      }
    } catch (err: any) {
      job.error = err.message || "Payout execution error";
      if (job.retryCount < 3) {
        job.retryCount++;
        job.status = "RETRYING";
        // Exponential backoff: 2^attempt * 1000 + random jitter
        const backoffMs = Math.pow(2, job.retryCount) * 1000 + Math.floor(Math.random() * 500);
        this.emit("job:retry", { ...job, backoffMs });
        const timer = setTimeout(() => {
          this.processJob(chunkId);
        }, backoffMs);
        this.activeTimers.set(chunkId, timer);
      } else {
        job.status = "FAILED";
        this.emit("job:failed", { ...job });
      }
    }
  }

  getJob(chunkId: string): PayoutJob | undefined {
    return this.jobs.get(chunkId);
  }

  getJobsByCollection(collectionId: string): PayoutJob[] {
    const results: PayoutJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.collectionId === collectionId) {
        results.push(job);
      }
    }
    return results.sort((a, b) => a.chunkNumber - b.chunkNumber);
  }
}
