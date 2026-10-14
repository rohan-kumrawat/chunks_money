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
const chunk_calculator_1 = require("../modules/payment/chunk-calculator");
const token_bucket_1 = require("../modules/rate-limiter/token-bucket");
const fraud_engine_1 = require("../modules/fraud-detection/fraud-engine");
const delay_calculator_1 = require("../modules/delay/delay-calculator");
(0, node_test_1.describe)("Chunks Money Core Modules", () => {
    (0, node_test_1.describe)("ChunkCalculator", () => {
        (0, node_test_1.it)("should correctly split ₹5,000 into ₹1,999 + ₹1,999 + ₹1,002", () => {
            const chunks = chunk_calculator_1.ChunkCalculator.calculateChunks(5000, 1999);
            assert.strictEqual(chunks.length, 3);
            assert.strictEqual(chunks[0].amount, 1999);
            assert.strictEqual(chunks[1].amount, 1999);
            assert.strictEqual(chunks[2].amount, 1002);
            const totalSum = chunks.reduce((acc, c) => acc + c.amount, 0);
            assert.strictEqual(totalSum, 5000);
        });
        (0, node_test_1.it)("should keep amounts under ₹1,999 as a single chunk", () => {
            const chunks = chunk_calculator_1.ChunkCalculator.calculateChunks(1500, 1999);
            assert.strictEqual(chunks.length, 1);
            assert.strictEqual(chunks[0].amount, 1500);
        });
        (0, node_test_1.it)("should split exact multiple ₹3,998 into two ₹1,999 chunks", () => {
            const chunks = chunk_calculator_1.ChunkCalculator.calculateChunks(3998, 1999);
            assert.strictEqual(chunks.length, 2);
            assert.strictEqual(chunks[0].amount, 1999);
            assert.strictEqual(chunks[1].amount, 1999);
        });
        (0, node_test_1.it)("should handle large amount ₹20,000 without precision drift", () => {
            const chunks = chunk_calculator_1.ChunkCalculator.calculateChunks(20000, 1999);
            assert.strictEqual(chunks.length, 11);
            const totalSum = chunks.reduce((acc, c) => acc + c.amount, 0);
            assert.strictEqual(totalSum, 20000);
            assert.strictEqual(chunks[chunks.length - 1].amount, 10);
        });
    });
    (0, node_test_1.describe)("DelayCalculator", () => {
        (0, node_test_1.it)("should give 0ms delay for chunk 1", () => {
            const delay = delay_calculator_1.DelayCalculator.calculateDelayMs(1, 10);
            assert.strictEqual(delay, 0);
        });
        (0, node_test_1.it)("should give staggered delay for chunk 2 and 3", () => {
            const delay2 = delay_calculator_1.DelayCalculator.calculateDelayMs(2, 10);
            const delay3 = delay_calculator_1.DelayCalculator.calculateDelayMs(3, 10);
            assert.ok(delay2 > 2500, `Delay2 (${delay2}) should be > 2500`);
            assert.ok(delay3 > delay2, `Delay3 (${delay3}) should be > Delay2 (${delay2})`);
        });
    });
    (0, node_test_1.describe)("TokenBucketRateLimiter", () => {
        (0, node_test_1.it)("should allow consuming tokens up to capacity", () => {
            const limiter = new token_bucket_1.TokenBucketRateLimiter(5, 60);
            for (let i = 0; i < 5; i++) {
                const res = limiter.consume("upi:test@oksbi");
                assert.strictEqual(res.allowed, true);
            }
            const throttled = limiter.consume("upi:test@oksbi");
            assert.strictEqual(throttled.allowed, false);
            assert.ok(throttled.waitMs > 0);
        });
    });
    (0, node_test_1.describe)("FraudDetectionEngine", () => {
        (0, node_test_1.it)("should rate normal ₹5,000 transaction as LOW risk", () => {
            const evalResult = fraud_engine_1.FraudDetectionEngine.evaluate({
                payeeUpi: "normal@oksbi",
                totalAmount: 5000,
                totalChunks: 3,
                recentTransactionsCount: 0,
                timestamp: new Date(2026, 8, 19, 14, 0, 0),
            });
            assert.strictEqual(evalResult.riskTier, "LOW");
            assert.strictEqual(evalResult.recommendation, "PROCEED");
        });
        (0, node_test_1.it)("should flag high velocity transactions", () => {
            const evalResult = fraud_engine_1.FraudDetectionEngine.evaluate({
                payeeUpi: "velocity@oksbi",
                totalAmount: 60000,
                totalChunks: 31,
                recentTransactionsCount: 10,
            });
            assert.ok(evalResult.score >= 70, `Score (${evalResult.score}) should be >= 70`);
            assert.strictEqual(evalResult.riskTier, "HIGH");
        });
    });
});
//# sourceMappingURL=core.test.js.map