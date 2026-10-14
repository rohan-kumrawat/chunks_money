-- ==========================================================
-- CHUNKS MONEY: PostgreSQL Database Schema
-- Architecture for max ₹1,999 Split Payment Portal
-- ==========================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table (Payers & Payees)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    upi_id VARCHAR(100) UNIQUE,
    bank_account_number VARCHAR(30),
    bank_ifsc VARCHAR(15),
    kyc_status VARCHAR(20) DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    kyc_tier INT DEFAULT 1 CHECK (kyc_tier IN (1, 2, 3)), -- Tier 1: ₹10k/day, Tier 2: ₹50k/day, Tier 3: ₹2L/day
    daily_limit NUMERIC(12, 2) DEFAULT 10000.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Payment Collections Table (Parent Transaction from Person A)
CREATE TABLE IF NOT EXISTS payment_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    payee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    payer_upi VARCHAR(100),
    payee_upi VARCHAR(100) NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
    currency VARCHAR(3) DEFAULT 'INR',
    chunk_size_limit NUMERIC(12, 2) DEFAULT 1999.00,
    total_chunks INT NOT NULL,
    successful_chunks INT DEFAULT 0,
    failed_chunks INT DEFAULT 0,
    status VARCHAR(30) DEFAULT 'INITIALIZED' CHECK (
        status IN ('INITIALIZED', 'COLLECTION_PENDING', 'COLLECTED', 'PROCESSING_CHUNKS', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED')
    ),
    gateway_order_id VARCHAR(100),
    gateway_payment_id VARCHAR(100),
    gateway_name VARCHAR(50) DEFAULT 'MOCK' CHECK (gateway_name IN ('MOCK', 'RAZORPAY', 'CASHFREE')),
    fraud_score INT DEFAULT 0, -- 0 (safe) to 100 (high risk)
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Payout Chunks Table (Individual sub-₹2,000 transfers to Person B)
CREATE TABLE IF NOT EXISTS payout_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES payment_collections(id) ON DELETE CASCADE,
    chunk_number INT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 1999.00),
    currency VARCHAR(3) DEFAULT 'INR',
    payee_upi VARCHAR(100) NOT NULL,
    status VARCHAR(30) DEFAULT 'QUEUED' CHECK (
        status IN ('QUEUED', 'DELAYING', 'PROCESSING', 'SUCCESS', 'RETRYING', 'FAILED')
    ),
    idempotency_key VARCHAR(150) UNIQUE NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE,
    payout_reference VARCHAR(150),
    gateway_payout_id VARCHAR(150),
    gateway_error_code VARCHAR(100),
    gateway_error_message TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    delay_ms INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Rate Limiter Tracker (Token Bucket for Beneficiary UPIs)
CREATE TABLE IF NOT EXISTS rate_limit_tracker (
    key VARCHAR(150) PRIMARY KEY, -- e.g. "upi:receiver@oksbi" or "user:uuid"
    tokens NUMERIC(8, 2) NOT NULL,
    last_refill_at TIMESTAMP WITH TIME ZONE NOT NULL,
    max_tokens INT DEFAULT 10,
    refill_rate_per_sec NUMERIC(8, 4) DEFAULT 0.1667, -- 10 tokens per minute
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Fraud Detection Rules & Alerts
CREATE TABLE IF NOT EXISTS fraud_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID REFERENCES payment_collections(id) ON DELETE CASCADE,
    payee_upi VARCHAR(100) NOT NULL,
    risk_score INT NOT NULL,
    triggered_rules JSONB NOT NULL, -- e.g. ["HIGH_HOURLY_VELOCITY", "UNUSUAL_HOURS", "RAPID_FIRE_SAME_VPA"]
    action_taken VARCHAR(50) NOT NULL CHECK (action_taken IN ('ALLOWED', 'DELAY_INCREASED', 'FLAGGED_MANUAL_REVIEW', 'BLOCKED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Webhook Audit Logs
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gateway VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    signature VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    processed_status VARCHAR(30) DEFAULT 'PENDING' CHECK (processed_status IN ('PENDING', 'PROCESSED', 'IGNORED', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- INDEXES FOR HIGH-THROUGHPUT QUEUING AND LOOKUPS
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_chunks_collection_id ON payout_chunks(collection_id);
CREATE INDEX IF NOT EXISTS idx_chunks_status_scheduled ON payout_chunks(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_chunks_idempotency ON payout_chunks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_collections_payer_payee ON payment_collections(payer_id, payee_id);
CREATE INDEX IF NOT EXISTS idx_collections_status ON payment_collections(status);
CREATE INDEX IF NOT EXISTS idx_fraud_payee ON fraud_alerts(payee_upi, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_processed ON webhook_logs(processed_status, created_at);
