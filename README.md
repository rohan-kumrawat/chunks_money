# 💸 Chunks Money - Max ₹1,999 Split Payment Portal

> Accept a single payment from **Person A** (e.g., ₹5,000) and automatically disburse it to **Person B** in chunks of max **₹1,999** (e.g., ₹1,999 + ₹1,999 + ₹1,002) with intelligent delays, queue processing, rate limiting, and fraud prevention.

---

## 🎯 Architecture & Problem Solutions

### 1. Payment Splitting Flow
```
Person A (Payer)
      │
      ▼ Single Lump Sum Payment (e.g. ₹5,000)
Payment Gateway Collection (Razorpay / Cashfree / Mock)
      │
      ▼ Payment Confirmed Webhook
Chunks Money Backend Orchestrator
      │
      ├─► Chunk Calculator: [₹1,999, ₹1,999, ₹1,002]
      ├─► Fraud Risk Scoring: Score 0-100 (Safe)
      └─► Token Bucket Rate Limiter: 10 tokens/min
            │
            ▼ Enqueue with Staggered Delays
      Payout Queue (BullMQ / In-Memory Worker)
            │
            ├─► Delay 0.0s  ──► Chunk #1: ₹1,999 ──► UPI Credit 1 to Person B
            ├─► Delay 3.2s  ──► Chunk #2: ₹1,999 ──► UPI Credit 2 to Person B
            └─► Delay 6.8s  ──► Chunk #3: ₹1,002 ──► UPI Credit 3 to Person B
```

### 2. Solutions to the 3 Core Problems
1. **Gateway Rate Limiting**:
   - Implemented via a **Token Bucket Algorithm** (10 payouts/min capacity with 0.1667 tokens/sec refill).
   - If gateway limits are approached, jobs pause gracefully and retry with exponential backoff and jitter instead of failing.
2. **Bank Velocity Limits & Fraud Detection**:
   - **Intelligent Staggered Delays ($2.5\text{s} - 8.5\text{s}$)** between consecutive transfers prevent NPCI & bank anti-spam filters from locking the receiver's UPI VPA.
   - Built-in **Fraud Detection Engine** scores transactions based on hourly velocity, amount thresholds, off-hours execution, and VPA formats.
3. **Double-Spending & Network Failures**:
   - Deterministic **Idempotency Keys** (`${collectionId}_chunk_${chunkNumber}_v1`) ensure duplicate calls never credit the beneficiary twice.
   - Automatic retry mechanism with up to 3 attempts on transient network drops.

---

## 🚀 Quick Start

### 1. Backend & Unit Tests
```bash
cd backend
npm install
npm run build
npm test
```
*All 12 automated unit and E2E integration tests will run and pass.*

### 2. Run the Full Stack
Start the backend server (serves the API and the built frontend UI):
```bash
cd backend
npm start
```
Open **[http://localhost:3001](http://localhost:3001)** in your browser.

Or run the frontend in hot-reloading dev mode:
```bash
cd frontend
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)**.

### 3. Docker Infrastructure (PostgreSQL & Redis)
For persistent production infrastructure:
```bash
docker-compose up -d
```
Runs PostgreSQL 16 on port 5432 (auto-initializing `split-payment-schema.sql`) and Redis 7 on port 6379.

---

## 📁 Repository Structure

```
chunks_money/
├── split-payment-schema.sql        # PostgreSQL DDL (users, collections, chunks, rate limits, fraud)
├── docker-compose.yml              # PostgreSQL + Redis containers
├── docs/
│   ├── api-documentation.md        # API reference, DTOs, and algorithm formulas
│   └── troubleshooting-and-deployment.md # Ops guide, queue tuning, edge cases
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── payment/            # Chunk calculator & payment orchestrator
│   │   │   ├── delay/              # Intelligent staggered delay calculator
│   │   │   ├── rate-limiter/       # Token bucket rate limiter
│   │   │   ├── fraud-detection/    # Fraud scoring & risk engine
│   │   │   ├── gateway/            # Mock Sandbox, Razorpay, Cashfree adapters
│   │   │   └── payout-queue/       # Delayed queue worker & retry logic
│   │   ├── tests/                  # Unit and E2E integration tests
│   │   └── main.ts                 # Express REST + SSE stream server
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.tsx                 # Payer card, Live Queue Visualizer, Payee phone simulator
    │   └── main.tsx
    ├── package.json
    └── vite.config.ts
```
