import { describe, it } from "node:test";
import * as assert from "node:assert";
import { ChunkCalculator } from "../modules/payment/chunk-calculator";
import { TokenBucketRateLimiter } from "../modules/rate-limiter/token-bucket";
import { FraudDetectionEngine } from "../modules/fraud-detection/fraud-engine";
import { DelayCalculator } from "../modules/delay/delay-calculator";

describe("Chunks Money Core Modules", () => {
  describe("ChunkCalculator", () => {
    it("should correctly split ₹5,000 into ₹1,999 + ₹1,999 + ₹1,002", () => {
      const chunks = ChunkCalculator.calculateChunks(5000, 1999);
      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0].amount, 1999);
      assert.strictEqual(chunks[1].amount, 1999);
      assert.strictEqual(chunks[2].amount, 1002);

      const totalSum = chunks.reduce((acc, c) => acc + c.amount, 0);
      assert.strictEqual(totalSum, 5000);
    });

    it("should keep amounts under ₹1,999 as a single chunk", () => {
      const chunks = ChunkCalculator.calculateChunks(1500, 1999);
      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].amount, 1500);
    });

    it("should split exact multiple ₹3,998 into two ₹1,999 chunks", () => {
      const chunks = ChunkCalculator.calculateChunks(3998, 1999);
      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0].amount, 1999);
      assert.strictEqual(chunks[1].amount, 1999);
    });

    it("should handle large amount ₹20,000 without precision drift", () => {
      const chunks = ChunkCalculator.calculateChunks(20000, 1999);
      // 20000 / 1999 = 10 full chunks (19990) + 1 chunk of 10
      assert.strictEqual(chunks.length, 11);
      const totalSum = chunks.reduce((acc, c) => acc + c.amount, 0);
      assert.strictEqual(totalSum, 20000);
      assert.strictEqual(chunks[chunks.length - 1].amount, 10);
    });
  });

  describe("DelayCalculator", () => {
    it("should give 0ms delay for chunk 1", () => {
      const delay = DelayCalculator.calculateDelayMs(1, 10);
      assert.strictEqual(delay, 0);
    });

    it("should give staggered delay for chunk 2 and 3", () => {
      const delay2 = DelayCalculator.calculateDelayMs(2, 10);
      const delay3 = DelayCalculator.calculateDelayMs(3, 10);
      assert.ok(delay2 > 2500, `Delay2 (${delay2}) should be > 2500`);
      assert.ok(delay3 > delay2, `Delay3 (${delay3}) should be > Delay2 (${delay2})`);
    });
  });

  describe("TokenBucketRateLimiter", () => {
    it("should allow consuming tokens up to capacity", () => {
      const limiter = new TokenBucketRateLimiter(5, 60); // 5 tokens, 1 per second
      for (let i = 0; i < 5; i++) {
        const res = limiter.consume("upi:test@oksbi");
        assert.strictEqual(res.allowed, true);
      }
      // 6th consumption should be throttled
      const throttled = limiter.consume("upi:test@oksbi");
      assert.strictEqual(throttled.allowed, false);
      assert.ok(throttled.waitMs > 0);
    });
  });

  describe("FraudDetectionEngine", () => {
    it("should rate normal ₹5,000 transaction as LOW risk", () => {
      const evalResult = FraudDetectionEngine.evaluate({
        payeeUpi: "normal@oksbi",
        totalAmount: 5000,
        totalChunks: 3,
        recentTransactionsCount: 0,
        timestamp: new Date(2026, 8, 19, 14, 0, 0), // 2 PM
      });
      assert.strictEqual(evalResult.riskTier, "LOW");
      assert.strictEqual(evalResult.recommendation, "PROCEED");
    });

    it("should flag high velocity transactions", () => {
      const evalResult = FraudDetectionEngine.evaluate({
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
