import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { MockGateway } from "./modules/gateway/mock-gateway";
import { TokenBucketRateLimiter } from "./modules/rate-limiter/token-bucket";
import { PayoutQueueManager } from "./modules/payout-queue/payout-queue";
import { PaymentService } from "./modules/payment/payment.service";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3080;

app.use(cors({ origin: "*" }));
app.use(express.json());

// Initialize Core Singletons
const gateway = new MockGateway();
const rateLimiter = new TokenBucketRateLimiter(10, 10); // 10 tokens capacity, 10/min refill
const queueManager = new PayoutQueueManager(gateway, rateLimiter);
const paymentService = new PaymentService(queueManager, gateway);

// SSE Clients Registry
const sseClients: Response[] = [];

function broadcastSSE(eventType: string, data: any) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// Forward Queue Events to Live SSE Stream
queueManager.on("job:enqueued", (job) => broadcastSSE("chunk_enqueued", job));
queueManager.on("job:delaying", (job) => broadcastSSE("chunk_delaying", job));
queueManager.on("job:processing", (job) => broadcastSSE("chunk_processing", job));
queueManager.on("job:success", (job) => broadcastSSE("chunk_success", job));
queueManager.on("job:retry", (job) => broadcastSSE("chunk_retry", job));
queueManager.on("job:throttled", (job) => broadcastSSE("chunk_throttled", job));
queueManager.on("job:failed", (job) => broadcastSSE("chunk_failed", job));

// --- API Routes ---

// 1. Health Check
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Chunks Money Split Payment Backend",
    timestamp: new Date().toISOString(),
    chunkLimit: 1999.00,
  });
});

// 2. Initialize Payment
app.post("/api/payments/initialize", async (req: Request, res: Response) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Confirm Collection from Person A and Kick Off Chunk Payouts
app.post("/api/payments/:id/confirm-collection", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { gatewayPaymentId } = req.body;
    const result = await paymentService.confirmCollectionAndTriggerPayouts(id, gatewayPaymentId);
    broadcastSSE("collection_confirmed", result);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Get Status of a Split Payment
app.get("/api/payments/:id/status", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const status = paymentService.getStatus(id);
    res.json(status);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// 5. Get All Payment Records
app.get("/api/payments", (req: Request, res: Response) => {
  res.json(paymentService.getAllCollections());
});

// 6. Inspect Rate Limiter Bucket
app.get("/api/rate-limiter/:upi", (req: Request, res: Response) => {
  const { upi } = req.params;
  const bucket = rateLimiter.getBucket(`upi:${upi}`);
  res.json({ upi, ...bucket });
});

// 7. Server-Sent Events (SSE) Stream for Live Frontend Visualizer
app.get("/api/payments/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.push(res);

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);

  req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// Serve Frontend static assets if built
const frontendDistPath = path.join(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get("*", (req: Request, res: Response) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(frontendDistPath, "index.html"));
    }
  });
}

// Start Server with auto-fallback if port is busy
const server = app.listen(Number(PORT), "127.0.0.1", () => {
  console.log(`[Chunks Money Backend] Running on http://127.0.0.1:${PORT}`);
  console.log(`[Chunks Money Backend] Max chunk limit set to ₹1,999.00`);
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} is busy, starting on fallback port 38000...`);
    app.listen(38000, "127.0.0.1", () => {
      console.log(`[Chunks Money Backend] Running on http://127.0.0.1:38000`);
      console.log(`[Chunks Money Backend] Max chunk limit set to ₹1,999.00`);
    });
  } else {
    console.error("Server error:", err);
  }
});
