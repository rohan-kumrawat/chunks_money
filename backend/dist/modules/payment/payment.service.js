"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const uuid_1 = require("uuid");
const chunk_calculator_1 = require("./chunk-calculator");
const delay_calculator_1 = require("../delay/delay-calculator");
const fraud_engine_1 = require("../fraud-detection/fraud-engine");
class PaymentService {
    constructor(queueManager, gateway) {
        this.collections = new Map();
        this.queueManager = queueManager;
        this.gateway = gateway;
    }
    async initializePayment(dto) {
        const chunkLimit = dto.chunkLimit || 1999.00;
        const chunks = chunk_calculator_1.ChunkCalculator.calculateChunks(dto.amount, chunkLimit);
        const collectionId = (0, uuid_1.v4)();
        const fraudEvaluation = fraud_engine_1.FraudDetectionEngine.evaluate({
            payeeUpi: dto.payeeUpi,
            totalAmount: dto.amount,
            totalChunks: chunks.length,
        });
        const gatewayOrder = await this.gateway.createCollectionOrder({
            collectionId,
            amount: dto.amount,
            currency: "INR",
            payerEmail: dto.payerEmail,
            payerPhone: dto.payerPhone,
        });
        const collectionRecord = {
            id: collectionId,
            payerName: dto.payerName,
            payerEmail: dto.payerEmail,
            payerPhone: dto.payerPhone,
            payeeUpi: dto.payeeUpi,
            totalAmount: dto.amount,
            chunkLimit,
            totalChunks: chunks.length,
            status: "INITIALIZED",
            fraudEvaluation,
            gatewayOrder,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.collections.set(collectionId, collectionRecord);
        const breakdown = chunks.map((c) => {
            const delayMs = delay_calculator_1.DelayCalculator.calculateDelayMs(c.chunkNumber, fraudEvaluation.score);
            return {
                chunkNumber: c.chunkNumber,
                amount: c.amount,
                currency: c.currency,
                estimatedDelaySec: Math.round(delayMs / 100) / 10,
                delayMs,
            };
        });
        const upiIntent = `upi://pay?pa=chunks.merchant@icici&pn=${encodeURIComponent(dto.payeeName || "Merchant")}&am=${dto.amount.toFixed(2)}&tr=${collectionId}&cu=INR&tn=SplitPayment`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiIntent)}`;
        return {
            collectionId,
            totalAmount: dto.amount,
            chunkLimit,
            totalChunks: chunks.length,
            status: collectionRecord.status,
            fraudScore: fraudEvaluation.score,
            fraudRiskTier: fraudEvaluation.riskTier,
            fraudRecommendation: fraudEvaluation.recommendation,
            chunksBreakdown: breakdown,
            gatewayOrder,
            upiIntent,
            qrCodeUrl,
        };
    }
    async confirmCollectionAndTriggerPayouts(collectionId, gatewayPaymentId = "mock_pay_success") {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }
        const isValid = await this.gateway.verifyCollection(collection.gatewayOrder.gatewayOrderId, gatewayPaymentId);
        if (!isValid) {
            throw new Error("Payment verification failed with gateway");
        }
        collection.status = "PROCESSING_CHUNKS";
        collection.updatedAt = new Date();
        const chunks = chunk_calculator_1.ChunkCalculator.calculateChunks(collection.totalAmount, collection.chunkLimit);
        for (const c of chunks) {
            const delayMs = delay_calculator_1.DelayCalculator.calculateDelayMs(c.chunkNumber, collection.fraudEvaluation.score);
            const idempotencyKey = `${collectionId}_chunk_${c.chunkNumber}_v1`;
            const job = {
                chunkId: (0, uuid_1.v4)(),
                collectionId,
                chunkNumber: c.chunkNumber,
                totalChunks: chunks.length,
                amount: c.amount,
                currency: c.currency,
                payeeUpi: collection.payeeUpi,
                idempotencyKey,
                delayMs,
                scheduledAt: new Date(Date.now() + delayMs),
                status: "QUEUED",
                retryCount: 0,
            };
            this.queueManager.enqueueJob(job);
        }
        return {
            collectionId,
            status: collection.status,
            message: `Payment collected from Person A. ${chunks.length} payout chunks queued for Person B.`,
            queuedChunks: chunks.length,
        };
    }
    getStatus(collectionId) {
        const collection = this.collections.get(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }
        const jobs = this.queueManager.getJobsByCollection(collectionId);
        const completedChunks = jobs.filter((j) => j.status === "SUCCESS").length;
        const failedChunks = jobs.filter((j) => j.status === "FAILED").length;
        const disbursedAmount = jobs
            .filter((j) => j.status === "SUCCESS")
            .reduce((sum, j) => sum + j.amount, 0);
        let status = collection.status;
        if (completedChunks === collection.totalChunks && collection.totalChunks > 0) {
            status = "COMPLETED";
        }
        else if (failedChunks > 0 && completedChunks + failedChunks === collection.totalChunks) {
            status = "PARTIALLY_FAILED";
        }
        return {
            collectionId,
            payerName: collection.payerName,
            payeeUpi: collection.payeeUpi,
            totalAmount: collection.totalAmount,
            totalChunks: collection.totalChunks,
            completedChunks,
            failedChunks,
            disbursedAmount: Math.round(disbursedAmount * 100) / 100,
            remainingAmount: Math.max(0, Math.round((collection.totalAmount - disbursedAmount) * 100) / 100),
            status,
            fraudEvaluation: collection.fraudEvaluation,
            chunks: jobs.map((j) => ({
                chunkId: j.chunkId,
                chunkNumber: j.chunkNumber,
                amount: j.amount,
                status: j.status,
                scheduledAt: j.scheduledAt,
                executedAt: j.executedAt,
                delayMs: j.delayMs,
                payoutReference: j.payoutReference,
                idempotencyKey: j.idempotencyKey,
                retryCount: j.retryCount,
                error: j.error,
            })),
        };
    }
    getAllCollections() {
        return Array.from(this.collections.values()).map((c) => this.getStatus(c.id));
    }
}
exports.PaymentService = PaymentService;
//# sourceMappingURL=payment.service.js.map