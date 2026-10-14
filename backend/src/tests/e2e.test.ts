import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import http from "node:http";
import { MockGateway } from "../modules/gateway/mock-gateway";
import { TokenBucketRateLimiter } from "../modules/rate-limiter/token-bucket";
import { PayoutQueueManager } from "../modules/payout-queue/payout-queue";
import { PaymentService } from "../modules/payment/payment.service";

describe("E2E Split Payment Simulation (Person A -> Chunks -> Person B)", () => {
  let gateway: MockGateway;
  let rateLimiter: TokenBucketRateLimiter;
  let queueManager: PayoutQueueManager;
  let paymentService: PaymentService;

  before(() => {
    gateway = new MockGateway();
    rateLimiter = new TokenBucketRateLimiter(10, 10);
    queueManager = new PayoutQueueManager(gateway, rateLimiter);
    paymentService = new PaymentService(queueManager, gateway);
  });

  it("should initialize a ₹5,000 payment and break it down into 3 chunks (1999 + 1999 + 1002)", async () => {
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
    assert.strictEqual(initResult.fraudScore, 0); // Safe
    assert.strictEqual(initResult.fraudRiskTier, "LOW");
  });

  it("should confirm collection from Person A and process chunks with intelligent staggered delays", async () => {
    const initResult = await paymentService.initializePayment({
      payerName: "Aarav Sharma",
      payerEmail: "aarav@example.com",
      payerPhone: "+919876543210",
      payeeUpi: "rohan@oksbi",
      amount: 5000,
      chunkLimit: 1999,
    });

    // Person A pays lump sum
    const confirmResult = await paymentService.confirmCollectionAndTriggerPayouts(
      initResult.collectionId,
      "mock_pay_12345"
    );

    assert.strictEqual(confirmResult.status, "PROCESSING_CHUNKS");
    assert.strictEqual(confirmResult.queuedChunks, 3);

    // Initial status: Chunk 1 runs immediately, Chunk 2 & 3 are delaying
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

  it("should enforce idempotency and prevent double payouts", async () => {
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

    // Must return the exact same payout reference and ID without charging twice
    assert.strictEqual(payout1.payoutReference, payout2.payoutReference);
    assert.strictEqual(payout1.gatewayPayoutId, payout2.gatewayPayoutId);
  });
});
