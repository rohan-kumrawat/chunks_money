"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayoutQueueManager = void 0;
const events_1 = require("events");
class PayoutQueueManager extends events_1.EventEmitter {
    constructor(gateway, rateLimiter) {
        super();
        this.jobs = new Map();
        this.activeTimers = new Map();
        this.gateway = gateway;
        this.rateLimiter = rateLimiter;
    }
    enqueueJob(job) {
        this.jobs.set(job.chunkId, job);
        this.emit("job:enqueued", job);
        if (job.delayMs <= 0) {
            this.processJob(job.chunkId);
        }
        else {
            job.status = "DELAYING";
            this.emit("job:delaying", { ...job });
            const timer = setTimeout(() => {
                this.activeTimers.delete(job.chunkId);
                this.processJob(job.chunkId);
            }, job.delayMs);
            this.activeTimers.set(job.chunkId, timer);
        }
    }
    async processJob(chunkId) {
        const job = this.jobs.get(chunkId);
        if (!job)
            return;
        job.status = "PROCESSING";
        this.emit("job:processing", { ...job });
        const rateCheck = this.rateLimiter.consume(`upi:${job.payeeUpi}`);
        if (!rateCheck.allowed) {
            job.status = "RETRYING";
            job.retryCount++;
            job.error = `Rate limit exceeded. Waiting ${rateCheck.waitMs}ms for token refill.`;
            this.emit("job:throttled", { ...job, waitMs: rateCheck.waitMs });
            const retryDelay = rateCheck.waitMs + Math.floor(Math.random() * 300);
            const timer = setTimeout(() => {
                this.processJob(chunkId);
            }, retryDelay);
            this.activeTimers.set(chunkId, timer);
            return;
        }
        try {
            const payoutResult = await this.gateway.executePayoutChunk({
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
            }
            else {
                throw new Error(payoutResult.errorMessage || "Gateway payout rejected");
            }
        }
        catch (err) {
            job.error = err.message || "Payout execution error";
            if (job.retryCount < 3) {
                job.retryCount++;
                job.status = "RETRYING";
                const backoffMs = Math.pow(2, job.retryCount) * 1000 + Math.floor(Math.random() * 500);
                this.emit("job:retry", { ...job, backoffMs });
                const timer = setTimeout(() => {
                    this.processJob(chunkId);
                }, backoffMs);
                this.activeTimers.set(chunkId, timer);
            }
            else {
                job.status = "FAILED";
                this.emit("job:failed", { ...job });
            }
        }
    }
    getJob(chunkId) {
        return this.jobs.get(chunkId);
    }
    getJobsByCollection(collectionId) {
        const results = [];
        for (const job of this.jobs.values()) {
            if (job.collectionId === collectionId) {
                results.push(job);
            }
        }
        return results.sort((a, b) => a.chunkNumber - b.chunkNumber);
    }
}
exports.PayoutQueueManager = PayoutQueueManager;
//# sourceMappingURL=payout-queue.js.map