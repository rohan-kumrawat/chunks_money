# Chunks Money - API Documentation & Architecture

## Overview
Chunks Money is a high-throughput payment splitting portal designed to accept a single lump-sum payment from Person A (e.g., ₹5,000) and disburse it to Person B (the beneficiary) in discrete payout chunks capped at **₹1,999** (e.g., ₹1,999 + ₹1,999 + ₹1,002).

---

## 1. Core Architectural Solutions

### Problem #1: Gateway Rate Limiting & Throttling
Payment gateways (Razorpay, Cashfree, Decentro) impose strict requests-per-minute (RPM) quotas on automated payout endpoints (typically 10 payouts/minute per account or beneficiary).

**Solution: Token Bucket Algorithm with Exponential Backoff**
- Beneficiary tokens: Up to 10 tokens bucket capacity.
- Refill Rate: 0.1667 tokens/sec (10 per minute).
- When a payout chunk job fires, it requests a token from the bucket.
- If tokens are exhausted, the job does not fail; it automatically re-schedules itself into the queue after `refill_wait_ms` plus a randomized jitter.
- On HTTP 429 / Rate Limit from the gateway:
  $$\text{backoffMs} = 2^{\text{attempt}} \times 1000 + \text{random}(200, 800)\text{ms}$$

### Problem #2: Bank Velocity & Anti-Fraud Algorithms
NPCI (National Payments Corporation of India) and member banks monitor UPI VPAs for rapid-fire credit spam. Sending 3 consecutive UPI transactions to the same VPA within 2 seconds will trigger **UPI Velocity Limits**, leading to temporary VPA locks, failed payouts, or merchant account investigation.

**Solution: Intelligent Staggered Delays & Risk Scoring**
- **Dynamic Jitter Algorithm**:
  $$\text{chunkDelay} = (\text{chunkNumber} - 1) \times 2500\text{ms} + \text{random}(500, 2000)\text{ms}$$
  - Chunk 1: Dispatched immediately (0ms delay)
  - Chunk 2: Dispatched after $\approx 3.2\text{s}$
  - Chunk 3: Dispatched after $\approx 6.8\text{s}$
- **Fraud Scoring Engine (0 - 100 Score)**:
  - Base score: 0
  - High Velocity (> 10 chunks to same VPA in last 60 mins): +35 points
  - Unusual Hours (12:00 AM – 5:00 AM IST): +15 points
  - Large Total Amount (> ₹50,000 split across 25+ chunks): +25 points
  - Unverified / New VPA: +15 points
  - **Action Matrix**:
    - `Score < 40`: Safe $\rightarrow$ Normal dynamic delay ($2.5\text{s} - 4\text{s}$).
    - `40 <= Score < 70`: Elevated $\rightarrow$ Stretched delay ($5\text{s} - 8.5\text{s}$) to bypass bank velocity filters.
    - `Score >= 70`: Critical $\rightarrow$ Flagged for manual review or secondary OTP verification.

### Problem #3: Network Failures & Double-Spending
Network drops or gateway timeouts can lead to ambiguous payout status (e.g. gateway processed payout but response timed out).

**Solution: Strict Idempotency & Two-Phase Reconciliation**
- **Deterministic Idempotency Key**:
  $$\text{idempotencyKey} = \text{SHA256}(\text{collectionId} + \text{"_chunk_"} + \text{chunkNumber} + \text{"_"} + \text{amount})$$
- Gateways reject duplicate attempts bearing the same idempotency key, preventing double-crediting.
- BullMQ Redis Queue with exponential backoff: Up to 3 retries on transient network errors.
- Webhook reconciliation listener for asynchronous gateway confirmations.

---

## 2. API Endpoints

### 1. Initialize Split Payment
Initiates collection from Person A and plans the chunk allocation for Person B.

- **Method**: `POST`
- **Route**: `/api/payments/initialize`
- **Headers**: `Content-Type: application/json`

#### Request Body
```json
{
  "payerName": "Aarav Sharma",
  "payerEmail": "aarav@example.com",
  "payerPhone": "+919876543210",
  "payeeUpi": "rohan@oksbi",
  "payeeName": "Rohan Verma",
  "amount": 5000.00,
  "chunkLimit": 1999.00
}
```

#### Response (201 Created)
```json
{
  "collectionId": "4f26b52c-88bf-4c59-a548-cf9f6580f129",
  "totalAmount": 5000.00,
  "chunkLimit": 1999.00,
  "totalChunks": 3,
  "status": "INITIALIZED",
  "fraudScore": 15,
  "chunksBreakdown": [
    { "chunkNumber": 1, "amount": 1999.00, "estimatedDelaySec": 0 },
    { "chunkNumber": 2, "amount": 1999.00, "estimatedDelaySec": 3.2 },
    { "chunkNumber": 3, "amount": 1002.00, "estimatedDelaySec": 6.8 }
  ],
  "collectionGateway": {
    "gateway": "MOCK",
    "orderId": "order_mock_4f26b52c",
    "paymentLink": "https://gateway.mock/pay/4f26b52c"
  }
}
```

---

### 2. Confirm Collection & Trigger Payouts
Called when Person A completes the payment (or triggered automatically by payment gateway collection webhook).

- **Method**: `POST`
- **Route**: `/api/payments/:id/confirm-collection`
- **Request Body**:
```json
{
  "gatewayPaymentId": "pay_mock_98234123"
}
```

#### Response (200 OK)
```json
{
  "collectionId": "4f26b52c-88bf-4c59-a548-cf9f6580f129",
  "status": "PROCESSING_CHUNKS",
  "message": "Payment collected from Person A. 3 payout chunks queued for Person B.",
  "queuedChunks": 3
}
```

---

### 3. Get Live Splitting Status
Polled or streamed via Server-Sent Events (SSE) / WebSocket to track real-time progress.

- **Method**: `GET`
- **Route**: `/api/payments/:id/status`

#### Response (200 OK)
```json
{
  "collectionId": "4f26b52c-88bf-4c59-a548-cf9f6580f129",
  "status": "PROCESSING_CHUNKS",
  "totalAmount": 5000.00,
  "totalChunks": 3,
  "completedChunks": 1,
  "disbursedAmount": 1999.00,
  "remainingAmount": 3001.00,
  "chunks": [
    {
      "chunkNumber": 1,
      "amount": 1999.00,
      "status": "SUCCESS",
      "payoutReference": "payout_mock_chunk_1",
      "executedAt": "2026-09-19T21:55:00.120Z",
      "delayMs": 0
    },
    {
      "chunkNumber": 2,
      "amount": 1999.00,
      "status": "PROCESSING",
      "payoutReference": null,
      "scheduledAt": "2026-09-19T21:55:03.410Z",
      "delayMs": 3290
    },
    {
      "chunkNumber": 3,
      "amount": 1002.00,
      "status": "QUEUED",
      "payoutReference": null,
      "scheduledAt": "2026-09-19T21:55:07.150Z",
      "delayMs": 7030
    }
  ]
}
```

---

### 4. Gateway Webhook Endpoint
Inbound listener for real Razorpay / Cashfree asynchronous callbacks.

- **Method**: `POST`
- **Route**: `/api/webhooks/gateway/:provider`
- Verifies signature, updates chunk status to `SUCCESS` or triggers automated retry.
