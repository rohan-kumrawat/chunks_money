export interface CreateOrderParams {
    collectionId: string;
    amount: number;
    currency: string;
    payerEmail: string;
    payerPhone: string;
}
export interface CollectionOrderResult {
    gatewayOrderId: string;
    gatewayName: string;
    paymentUrl?: string;
    status: "CREATED" | "PAID";
}
export interface PayoutChunkParams {
    chunkId: string;
    collectionId: string;
    chunkNumber: number;
    totalChunks: number;
    amount: number;
    currency: string;
    payeeUpi: string;
    idempotencyKey: string;
}
export interface PayoutChunkResult {
    success: boolean;
    gatewayPayoutId: string;
    payoutReference: string;
    status: "SUCCESS" | "PROCESSING" | "FAILED";
    errorCode?: string;
    errorMessage?: string;
}
export interface IPaymentGateway {
    readonly name: string;
    createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult>;
    verifyCollection(orderId: string, paymentId: string): Promise<boolean>;
    executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult>;
}
