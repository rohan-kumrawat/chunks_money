import { IPaymentGateway, CreateOrderParams, CollectionOrderResult, PayoutChunkParams, PayoutChunkResult } from "./gateway.interface";
export interface GatewayConfig {
    provider: "MOCK" | "RAZORPAY" | "CASHFREE";
    razorpay?: {
        keyId: string;
        keySecret: string;
        accountNumber: string;
    };
    cashfree?: {
        appId: string;
        secretKey: string;
        baseUrl?: string;
    };
}
export declare class MockGateway implements IPaymentGateway {
    readonly name = "MOCK";
    private processedIdempotencyKeys;
    createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult>;
    verifyCollection(orderId: string, paymentId: string): Promise<boolean>;
    executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult>;
}
export declare class RazorpayGateway implements IPaymentGateway {
    readonly name = "RAZORPAY";
    private keyId;
    private keySecret;
    private accountNumber;
    constructor(keyId: string, keySecret: string, accountNumber: string);
    createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult>;
    verifyCollection(orderId: string, paymentId: string): Promise<boolean>;
    executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult>;
    verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
}
export declare class CashfreeGateway implements IPaymentGateway {
    readonly name = "CASHFREE";
    private appId;
    private secretKey;
    private baseUrl;
    constructor(appId: string, secretKey: string, isProduction?: boolean);
    createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult>;
    verifyCollection(orderId: string, paymentId: string): Promise<boolean>;
    executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult>;
    verifyWebhookSignature(signature: string, rawBody: string, timestamp: string): boolean;
}
