"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert"));
const mock_gateway_1 = require("../modules/gateway/mock-gateway");
const token_bucket_1 = require("../modules/rate-limiter/token-bucket");
const payout_queue_1 = require("../modules/payout-queue/payout-queue");
const payment_service_1 = require("../modules/payment/payment.service");
(0, node_test_1.describe)("E2E Split Payment Simulation (Person A -> Chunks -> Person B)", () => {
    let gateway;
    let rateLimiter;
    let queueManager;
    let paymentService;
    (0, node_test_1.before)(() => {
        gateway = new mock_gateway_1.MockGateway();
        rateLimiter = new token_bucket_1.TokenBucketRateLimiter(10, 10);
        queueManager = new payout_queue_1.PayoutQueueManager(gateway, rateLimiter);
        paymentService = new payment_service_1.PaymentService(queueManager, gateway);
    });
    (0, node_test_1.it)("should initialize a ₹5,000 payment and break it down into 3 chunks (1999 + 1999 + 1002)", async () => {
        const initResult = await paymentService.initializePayment({
            payerName: "Aarav Sharma",
            payerEmail: "aarav@example.com",
            payerPhone: "+919876543210",
            payeeUpi: "rohan@oksbi",
            amount: 5000,
            chunkLimit: 1999,
        });
        assert.ok(initResult.collectionId);
        assert.strictEqual(initResult.totalAmount, 5000);
        assert.strictEqual(initResult.totalChunks, 3);
        assert.strictEqual(initResult.chunksBreakdown.length, 3);
        assert.strictEqual(initResult.chunksBreakdown[0].amount, 1999);
        assert.strictEqual(initResult.chunksBreakdown[1].amount, 1999);
        assert.strictEqual(initResult.chunksBreakdown[2].amount, 1002);
        assert.strictEqual(initResult.fraudScore, 0);
        assert.strictEqual(initResult.fraudRiskTier, "LOW");
    });
    (0, node_test_1.it)("should confirm collection from Person A and process chunks with intelligent staggered delays", async () => {
        const initResult = await paymentService.initializePayment({
            payerName: "Aarav Sharma",
            payerEmail: "aarav@example.com",
            payerPhone: "+919876543210",
            payeeUpi: "rohan@oksbi",
            amount: 5000,
            chunkLimit: 1999,
        });
        const confirmResult = await paymentService.confirmCollectionAndTriggerPayouts(initResult.collectionId, "mock_pay_12345");
        assert.strictEqual(confirmResult.status, "PROCESSING_CHUNKS");
        assert.strictEqual(confirmResult.queuedChunks, 3);
        await new Promise((resolve) => setTimeout(resolve, 300));
        let status = paymentService.getStatus(initResult.collectionId);
        assert.strictEqual(status.chunks.length, 3);
        const chunk1 = status.chunks.find((c) => c.chunkNumber === 1);
        assert.strictEqual(chunk1?.status, "SUCCESS");
        assert.ok(chunk1?.payoutReference?.startsWith("UTR-"));
        const chunk2 = status.chunks.find((c) => c.chunkNumber === 2);
        assert.ok(chunk2?.status === "DELAYING" || chunk2?.status === "PROCESSING" || chunk2?.status === "QUEUED");
        const chunk3 = status.chunks.find((c) => c.chunkNumber === 3);
        assert.ok(chunk3?.status === "DELAYING" || chunk3?.status === "QUEUED");
    });
    (0, node_test_1.it)("should enforce idempotency and prevent double payouts", async () => {
        const payout1 = await gateway.executePayoutChunk({
            chunkId: "chunk-abc-1",
            collectionId: "coll-123",
            chunkNumber: 1,
            totalChunks: 1,
            amount: 1999,
            currency: "INR",
            payeeUpi: "rohan@oksbi",
            idempotencyKey: "coll-123_chunk_1_v1",
        });
        const payout2 = await gateway.executePayoutChunk({
            chunkId: "chunk-abc-1",
            collectionId: "coll-123",
            chunkNumber: 1,
            totalChunks: 1,
            amount: 1999,
            currency: "INR",
            payeeUpi: "rohan@oksbi",
            idempotencyKey: "coll-123_chunk_1_v1",
        });
        assert.strictEqual(payout1.payoutReference, payout2.payoutReference);
        assert.strictEqual(payout1.gatewayPayoutId, payout2.gatewayPayoutId);
    });
});
//# sourceMappingURL=e2e.test.js.map