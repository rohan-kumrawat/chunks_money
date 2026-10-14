import { FraudEvaluation } from "../fraud-detection/fraud-engine";
import { PayoutQueueManager } from "../payout-queue/payout-queue";
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
export declare class PaymentService {
    private collections;
    private queueManager;
    private gateway;
    constructor(queueManager: PayoutQueueManager, gateway: IPaymentGateway);
    initializePayment(dto: InitializePaymentDto): Promise<{
        collectionId: string;
        totalAmount: number;
        chunkLimit: number;
        totalChunks: number;
        status: "INITIALIZED" | "COLLECTED" | "PROCESSING_CHUNKS" | "COMPLETED" | "PARTIALLY_FAILED";
        fraudScore: number;
        fraudRiskTier: "LOW" | "MEDIUM" | "HIGH";
        fraudRecommendation: "PROCEED" | "DELAY_STRETCH" | "MANUAL_REVIEW";
        chunksBreakdown: {
            chunkNumber: number;
            amount: number;
            currency: string;
            estimatedDelaySec: number;
            delayMs: number;
        }[];
        gatewayOrder: CollectionOrderResult;
        upiIntent: string;
        qrCodeUrl: string;
    }>;
    confirmCollectionAndTriggerPayouts(collectionId: string, gatewayPaymentId?: string): Promise<{
        collectionId: string;
        status: "PROCESSING_CHUNKS";
        message: string;
        queuedChunks: number;
    }>;
    getStatus(collectionId: string): {
        collectionId: string;
        payerName: string;
        payeeUpi: string;
        totalAmount: number;
        totalChunks: number;
        completedChunks: number;
        failedChunks: number;
        disbursedAmount: number;
        remainingAmount: number;
        status: "INITIALIZED" | "COLLECTED" | "PROCESSING_CHUNKS" | "COMPLETED" | "PARTIALLY_FAILED";
        fraudEvaluation: FraudEvaluation;
        chunks: {
            chunkId: string;
            chunkNumber: number;
            amount: number;
            status: "SUCCESS" | "PROCESSING" | "FAILED" | "QUEUED" | "DELAYING" | "RETRYING";
            scheduledAt: Date;
            executedAt: Date;
            delayMs: number;
            payoutReference: string;
            idempotencyKey: string;
            retryCount: number;
            error: string;
        }[];
    };
    getAllCollections(): {
        collectionId: string;
        payerName: string;
        payeeUpi: string;
        totalAmount: number;
        totalChunks: number;
        completedChunks: number;
        failedChunks: number;
        disbursedAmount: number;
        remainingAmount: number;
        status: "INITIALIZED" | "COLLECTED" | "PROCESSING_CHUNKS" | "COMPLETED" | "PARTIALLY_FAILED";
        fraudEvaluation: FraudEvaluation;
        chunks: {
            chunkId: string;
            chunkNumber: number;
            amount: number;
            status: "SUCCESS" | "PROCESSING" | "FAILED" | "QUEUED" | "DELAYING" | "RETRYING";
            scheduledAt: Date;
            executedAt: Date;
            delayMs: number;
            payoutReference: string;
            idempotencyKey: string;
            retryCount: number;
            error: string;
        }[];
    }[];
}
