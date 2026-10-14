"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const mock_gateway_1 = require("./modules/gateway/mock-gateway");
const token_bucket_1 = require("./modules/rate-limiter/token-bucket");
const payout_queue_1 = require("./modules/payout-queue/payout-queue");
const payment_service_1 = require("./modules/payment/payment.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3080;
app.use((0, cors_1.default)({ origin: "*" }));
app.use(express_1.default.json());
const gateway = new mock_gateway_1.MockGateway();
const rateLimiter = new token_bucket_1.TokenBucketRateLimiter(10, 10);
const queueManager = new payout_queue_1.PayoutQueueManager(gateway, rateLimiter);
const paymentService = new payment_service_1.PaymentService(queueManager, gateway);
const sseClients = [];
function broadcastSSE(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
        try {
            sseClients[i].write(payload);
        }
        catch {
            sseClients.splice(i, 1);
        }
    }
}
queueManager.on("job:enqueued", (job) => broadcastSSE("chunk_enqueued", job));
queueManager.on("job:delaying", (job) => broadcastSSE("chunk_delaying", job));
queueManager.on("job:processing", (job) => broadcastSSE("chunk_processing", job));
queueManager.on("job:success", (job) => broadcastSSE("chunk_success", job));
queueManager.on("job:retry", (job) => broadcastSSE("chunk_retry", job));
queueManager.on("job:throttled", (job) => broadcastSSE("chunk_throttled", job));
queueManager.on("job:failed", (job) => broadcastSSE("chunk_failed", job));
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        service: "Chunks Money Split Payment Backend",
        timestamp: new Date().toISOString(),
        chunkLimit: 1999.00,
    });
});
app.post("/api/payments/initialize", async (req, res) => {
    try {
        const { payerName, payerEmail, payerPhone, payeeUpi, payeeName, amount, chunkLimit } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Valid payment amount is required" });
        }
        if (!payeeUpi) {
            return res.status(400).json({ error: "Payee UPI address is required" });
        }
        const result = await paymentService.initializePayment({
            payerName: payerName || "Anonymous Payer",
            payerEmail: payerEmail || "payer@example.com",
            payerPhone: payerPhone || "+919876543210",
            payeeUpi,
            payeeName,
            amount: Number(amount),
            chunkLimit: chunkLimit ? Number(chunkLimit) : 1999.00,
        });
        res.status(201).json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/api/payments/:id/confirm-collection", async (req, res) => {
    try {
        const { id } = req.params;
        const { gatewayPaymentId } = req.body;
        const result = await paymentService.confirmCollectionAndTriggerPayouts(id, gatewayPaymentId);
        broadcastSSE("collection_confirmed", result);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get("/api/payments/:id/status", (req, res) => {
    try {
        const { id } = req.params;
        const status = paymentService.getStatus(id);
        res.json(status);
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
app.get("/api/payments", (req, res) => {
    res.json(paymentService.getAllCollections());
});
app.get("/api/rate-limiter/:upi", (req, res) => {
    const { upi } = req.params;
    const bucket = rateLimiter.getBucket(`upi:${upi}`);
    res.json({ upi, ...bucket });
});
app.get("/api/payments/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    sseClients.push(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    req.on("close", () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1)
            sseClients.splice(idx, 1);
    });
});
const frontendDistPath = path_1.default.join(__dirname, "../../frontend/dist");
if (fs_1.default.existsSync(frontendDistPath)) {
    app.use(express_1.default.static(frontendDistPath));
    app.get("*", (req, res) => {
        if (!req.path.startsWith("/api")) {
            res.sendFile(path_1.default.join(frontendDistPath, "index.html"));
        }
    });
}
const server = app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`[Chunks Money Backend] Running on http://127.0.0.1:${PORT}`);
    console.log(`[Chunks Money Backend] Max chunk limit set to ₹1,999.00`);
});
server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.log(`Port ${PORT} is busy, starting on fallback port 38000...`);
        app.listen(38000, "127.0.0.1", () => {
            console.log(`[Chunks Money Backend] Running on http://127.0.0.1:38000`);
            console.log(`[Chunks Money Backend] Max chunk limit set to ₹1,999.00`);
        });
    }
    else {
        console.error("Server error:", err);
    }
});
//# sourceMappingURL=main.js.map