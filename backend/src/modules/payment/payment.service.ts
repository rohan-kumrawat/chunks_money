import { v4 as uuidv4 } from "uuid";
import { ChunkCalculator } from "./chunk-calculator";
import { DelayCalculator } from "../delay/delay-calculator";
import { FraudDetectionEngine, FraudEvaluation } from "../fraud-detection/fraud-engine";
import { PayoutQueueManager, PayoutJob } from "../payout-queue/payout-queue";
import { IPaymentGateway, CollectionOrderResult } from "../gateway/gateway.interface";

export interface InitializePaymentDto {
  payerName: string;
  payerEmail: string;
  payerPhone: string;
  payeeUpi: string;
  payeeName?: string;
  amount: number;
  chunkLimit?: number;
}

export interface PaymentCollectionRecord {
  id: string;
  payerName: string;
  payerEmail: string;
  payerPhone: string;
  payeeUpi: string;
  totalAmount: number;
  chunkLimit: number;
  totalChunks: number;
  status: "INITIALIZED" | "COLLECTED" | "PROCESSING_CHUNKS" | "COMPLETED" | "PARTIALLY_FAILED";
  fraudEvaluation: FraudEvaluation;
  gatewayOrder: CollectionOrderResult;
  createdAt: Date;
  updatedAt: Date;
}

export class PaymentService {
  private collections: Map<string, PaymentCollectionRecord> = new Map();
  private queueManager: PayoutQueueManager;
  private gateway: IPaymentGateway;

  constructor(queueManager: PayoutQueueManager, gateway: IPaymentGateway) {
    this.queueManager = queueManager;
    this.gateway = gateway;
  }

  /**
   * Initializes split payment: calculates chunks, assesses fraud risk, pre-computes delays.
   */
  async initializePayment(dto: InitializePaymentDto) {
    const chunkLimit = dto.chunkLimit || 1999.00;
    const chunks = ChunkCalculator.calculateChunks(dto.amount, chunkLimit);
    const collectionId = uuidv4();

    // Problem #2: Fraud & Risk Evaluation
    const fraudEvaluation = FraudDetectionEngine.evaluate({
      payeeUpi: dto.payeeUpi,
      totalAmount: dto.amount,
      totalChunks: chunks.length,
    });

    // Create Collection Order via Gateway
    const gatewayOrder = await this.gateway.createCollectionOrder({
      collectionId,
      amount: dto.amount,
      currency: "INR",
      payerEmail: dto.payerEmail,
      payerPhone: dto.payerPhone,
    });

    const collectionRecord: PaymentCollectionRecord = {
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

    // Pre-calculate chunks breakdown with delay estimates
    const breakdown = chunks.map((c) => {
      const delayMs = DelayCalculator.calculateDelayMs(c.chunkNumber, fraudEvaluation.score);
      return {
        chunkNumber: c.chunkNumber,
        amount: c.amount,
        currency: c.currency,
        estimatedDelaySec: Math.round(delayMs / 100) / 10,
        delayMs,
      };
    });

    // Generate standard NPCI UPI Intent & QR Code
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

  /**
   * Called when Person A pays. Verifies collection and queues the chunks with delays.
   */
  async confirmCollectionAndTriggerPayouts(collectionId: string, gatewayPaymentId: string = "mock_pay_success") {
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

    const chunks = ChunkCalculator.calculateChunks(collection.totalAmount, collection.chunkLimit);

    // Schedule each chunk into the queue with its intelligent staggered delay
    for (const c of chunks) {
      const delayMs = DelayCalculator.calculateDelayMs(c.chunkNumber, collection.fraudEvaluation.score);
      // Problem #3: Deterministic Idempotency Key
      const idempotencyKey = `${collectionId}_chunk_${c.chunkNumber}_v1`;

      const job: PayoutJob = {
        chunkId: uuidv4(),
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

  /**
   * Retrieves aggregated live status of the collection and its child chunks.
   */
  getStatus(collectionId: string) {
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
    } else if (failedChunks > 0 && completedChunks + failedChunks === collection.totalChunks) {
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
