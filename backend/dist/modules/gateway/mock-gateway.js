"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashfreeGateway = exports.RazorpayGateway = exports.MockGateway = void 0;
const crypto_1 = __importDefault(require("crypto"));
class MockGateway {
    constructor() {
        this.name = "MOCK";
        this.processedIdempotencyKeys = new Map();
    }
    async createCollectionOrder(params) {
        const gatewayOrderId = `order_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const upiIntent = `upi://pay?pa=merchant@icici&pn=ChunksMoneyPortal&am=${params.amount}&tr=${gatewayOrderId}&cu=INR&tn=PaymentToPersonB`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiIntent)}`;
        return {
            gatewayOrderId,
            gatewayName: this.name,
            paymentUrl: `https://checkout.chunks.money/pay/${gatewayOrderId}?amount=${params.amount}`,
            status: "CREATED",
        };
    }
    async verifyCollection(orderId, paymentId) {
        return Boolean(orderId && paymentId);
    }
    async executePayoutChunk(params) {
        if (this.processedIdempotencyKeys.has(params.idempotencyKey)) {
            return this.processedIdempotencyKeys.get(params.idempotencyKey);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
        const result = {
            success: true,
            gatewayPayoutId: `payout_mock_${Date.now()}_chunk${params.chunkNumber}`,
            payoutReference: `UTR-${utr}`,
            status: "SUCCESS",
        };
        this.processedIdempotencyKeys.set(params.idempotencyKey, result);
        return result;
    }
}
exports.MockGateway = MockGateway;
class RazorpayGateway {
    constructor(keyId, keySecret, accountNumber) {
        this.name = "RAZORPAY";
        this.keyId = keyId;
        this.keySecret = keySecret;
        this.accountNumber = accountNumber;
    }
    async createCollectionOrder(params) {
        const gatewayOrderId = `order_rzp_${Date.now()}`;
        return {
            gatewayOrderId,
            gatewayName: this.name,
            paymentUrl: `https://api.razorpay.com/v1/checkout/embedded?order_id=${gatewayOrderId}`,
            status: "CREATED",
        };
    }
    async verifyCollection(orderId, paymentId) {
        return Boolean(orderId && paymentId);
    }
    async executePayoutChunk(params) {
        const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
        return {
            success: true,
            gatewayPayoutId: `pout_rzp_${params.chunkId.slice(0, 8)}`,
            payoutReference: `RZP-UTR-${utr}`,
            status: "SUCCESS",
        };
    }
    verifyWebhookSignature(payload, signature, secret) {
        const expected = crypto_1.default.createHmac("sha256", secret).update(payload).digest("hex");
        return expected === signature;
    }
}
exports.RazorpayGateway = RazorpayGateway;
class CashfreeGateway {
    constructor(appId, secretKey, isProduction = false) {
        this.name = "CASHFREE";
        this.appId = appId;
        this.secretKey = secretKey;
        this.baseUrl = isProduction
            ? "https://payout-api.cashfree.com/payout/v1"
            : "https://payout-gamma.cashfree.com/payout/v1";
    }
    async createCollectionOrder(params) {
        const gatewayOrderId = `order_cf_${Date.now()}`;
        return {
            gatewayOrderId,
            gatewayName: this.name,
            paymentUrl: `https://sandbox.cashfree.com/pay/${gatewayOrderId}`,
            status: "CREATED",
        };
    }
    async verifyCollection(orderId, paymentId) {
        return Boolean(orderId && paymentId);
    }
    async executePayoutChunk(params) {
        const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
        return {
            success: true,
            gatewayPayoutId: `cf_pout_${params.chunkId.slice(0, 8)}`,
            payoutReference: `CF-UTR-${utr}`,
            status: "SUCCESS",
        };
    }
    verifyWebhookSignature(signature, rawBody, timestamp) {
        const data = timestamp + rawBody;
        const expected = crypto_1.default.createHmac("sha256", this.secretKey).update(data).digest("base64");
        return expected === signature;
    }
}
exports.CashfreeGateway = CashfreeGateway;
//# sourceMappingURL=mock-gateway.js.map