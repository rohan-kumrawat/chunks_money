# Troubleshooting, Operations & Production Deployment

## 1. Docker Compose Stack
The system is packaged with PostgreSQL 16, Redis 7 (for BullMQ queue), the NestJS backend, and the React frontend.

### Running with Docker:
```bash
docker-compose up -d
```

---

## 2. Common Production Issues & Resolutions

### Issue 1: Chunks stuck in QUEUED or DELAYING status
- **Root Cause**: Redis connection dropped, or BullMQ worker stalled.
- **Diagnostics**:
  ```bash
  # Check Redis status
  redis-cli ping
  # Inspect BullMQ active jobs
  npx bull-arena
  ```
- **Resolution**: The backend includes an **Auto-Fallback In-Memory Job Scheduler**. If Redis connection fails, the system automatically runs the queue workers locally with native Node.js timers so payouts are never dropped.

### Issue 2: Bank Velocity / Gateway 429 Errors
- **Symptom**: Receiver bank rejects chunk 2 or 3 with error `LIMIT_EXCEEDED` or `SUSPECTED_VELOCITY_BREACH`.
- **Resolution**:
  - In `.env`, increase `MIN_CHUNK_DELAY_MS` from `2500` to `4500`.
  - Check the `rate_limit_tracker` table:
    ```sql
    SELECT * FROM rate_limit_tracker WHERE key = 'upi:receiver@oksbi';
    ```

### Issue 3: Duplicate Payouts (Double-Charging Risk)
- **Mitigation**:
  - The database enforces a `UNIQUE` constraint on `idempotency_key`.
  - Every payout chunk generates its key deterministically using SHA-256 before interacting with the gateway.
  - If a worker crashes mid-request, retrying with the same idempotency key ensures the gateway returns the already-created payout instead of charging twice.

### Issue 4: Webhook Delivery Drops
- **Mitigation**:
  - Fallback polling worker runs every 30 seconds for chunks in `PROCESSING` status for over 2 minutes.
  - Queries `GET /payouts/{payoutId}` from Cashfree / Razorpay to reconcile state.

---

## 3. Environment Variables Reference (.env)

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgres://chunks:chunks123@localhost:5432/chunks_money

# Redis Queue
REDIS_HOST=localhost
REDIS_PORT=6379
USE_REDIS=true # Set false for instant in-memory queue

# Splitting Rules
MAX_CHUNK_AMOUNT=1999.00
MIN_CHUNK_DELAY_MS=2500
MAX_CHUNK_DELAY_MS=5000

# Rate Limiter
RATE_LIMIT_TOKENS_PER_BENEFICIARY=10
RATE_LIMIT_REFILL_PER_MINUTE=10

# Gateway Credentials (defaults to MOCK mode for instant zero-dependency testing)
GATEWAY_PROVIDER=MOCK # MOCK | RAZORPAY | CASHFREE

# Razorpay (Optional if using MOCK)
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=xxxx
RAZORPAY_ACCOUNT_NUMBER=2323230000000000

# Cashfree (Optional if using MOCK)
CASHFREE_APP_ID=cf_app_xxxx
CASHFREE_SECRET_KEY=cf_sec_xxxx
```
