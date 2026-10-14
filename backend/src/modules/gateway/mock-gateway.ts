import { IPaymentGateway, CreateOrderParams, CollectionOrderResult, PayoutChunkParams, PayoutChunkResult } from "./gateway.interface";
import crypto from "crypto";

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
    baseUrl?: string; // https://payout-api.cashfree.com or sandbox
  };
}

export class MockGateway implements IPaymentGateway {
  readonly name = "MOCK";
  private processedIdempotencyKeys: Map<string, PayoutChunkResult> = new Map();

  async createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult> {
    const gatewayOrderId = `order_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const upiIntent = `upi://pay?pa=merchant@icici&pn=ChunksMoneyPortal&am=${params.amount}&tr=${gatewayOrderId}&cu=INR&tn=PaymentToPersonB`;

    // Generate clean QR code data URI using an encoded SVG or public QR image URL
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiIntent)}`;

    return {
      gatewayOrderId,
      gatewayName: this.name,
      paymentUrl: `https://checkout.chunks.money/pay/${gatewayOrderId}?amount=${params.amount}`,
      status: "CREATED",
    };
  }

  async verifyCollection(orderId: string, paymentId: string): Promise<boolean> {
    return Boolean(orderId && paymentId);
  }

  async executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult> {
    // Problem #3: Deterministic Idempotency Enforcement
    if (this.processedIdempotencyKeys.has(params.idempotencyKey)) {
      return this.processedIdempotencyKeys.get(params.idempotencyKey)!;
    }

    // Realistic banking latency simulation (150ms)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Simulated 12-digit Indian Bank UTR / RRN (Retrieval Reference Number)
    const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
    const result: PayoutChunkResult = {
      success: true,
      gatewayPayoutId: `payout_mock_${Date.now()}_chunk${params.chunkNumber}`,
      payoutReference: `UTR-${utr}`,
      status: "SUCCESS",
    };

    this.processedIdempotencyKeys.set(params.idempotencyKey, result);
    return result;
  }
}

export class RazorpayGateway implements IPaymentGateway {
  readonly name = "RAZORPAY";
  private keyId: string;
  private keySecret: string;
  private accountNumber: string;

  constructor(keyId: string, keySecret: string, accountNumber: string) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.accountNumber = accountNumber;
  }

  async createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult> {
    const gatewayOrderId = `order_rzp_${Date.now()}`;
    return {
      gatewayOrderId,
      gatewayName: this.name,
      paymentUrl: `https://api.razorpay.com/v1/checkout/embedded?order_id=${gatewayOrderId}`,
      status: "CREATED",
    };
  }

  async verifyCollection(orderId: string, paymentId: string): Promise<boolean> {
    return Boolean(orderId && paymentId);
  }

  async executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult> {
    const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
    return {
      success: true,
      gatewayPayoutId: `pout_rzp_${params.chunkId.slice(0, 8)}`,
      payoutReference: `RZP-UTR-${utr}`,
      status: "SUCCESS",
    };
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return expected === signature;
  }
}

export class CashfreeGateway implements IPaymentGateway {
  readonly name = "CASHFREE";
  private appId: string;
  private secretKey: string;
  private baseUrl: string;

  constructor(appId: string, secretKey: string, isProduction: boolean = false) {
    this.appId = appId;
    this.secretKey = secretKey;
    this.baseUrl = isProduction 
      ? "https://payout-api.cashfree.com/payout/v1"
      : "https://payout-gamma.cashfree.com/payout/v1";
  }

  async createCollectionOrder(params: CreateOrderParams): Promise<CollectionOrderResult> {
    const gatewayOrderId = `order_cf_${Date.now()}`;
    return {
      gatewayOrderId,
      gatewayName: this.name,
      paymentUrl: `https://sandbox.cashfree.com/pay/${gatewayOrderId}`,
      status: "CREATED",
    };
  }

  async verifyCollection(orderId: string, paymentId: string): Promise<boolean> {
    return Boolean(orderId && paymentId);
  }

  async executePayoutChunk(params: PayoutChunkParams): Promise<PayoutChunkResult> {
    const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
    return {
      success: true,
      gatewayPayoutId: `cf_pout_${params.chunkId.slice(0, 8)}`,
      payoutReference: `CF-UTR-${utr}`,
      status: "SUCCESS",
    };
  }

  verifyWebhookSignature(signature: string, rawBody: string, timestamp: string): boolean {
    const data = timestamp + rawBody;
    const expected = crypto.createHmac("sha256", this.secretKey).update(data).digest("base64");
    return expected === signature;
  }
}
