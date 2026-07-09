-- ============================================================
-- Argos & Igoine Continental Exchange — database schema
-- Run once: psql -U postgres -d your_db -f schema.sql
-- ============================================================

-- Single-row table holding the live market state (companies array,
-- index history, currency modifiers, event log).  Serialised as JSON
-- so the tick engine can load/save the whole object atomically.
CREATE TABLE IF NOT EXISTS market_state (
  id          INTEGER PRIMARY KEY DEFAULT 1,         -- always row 1
  state_json  JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Broker accounts
CREATE TABLE IF NOT EXISTS accounts (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,              -- display name / login key
  pin_hash        TEXT NOT NULL,                     -- bcrypt hash
  currency        TEXT NOT NULL DEFAULT 'OStar',     -- preferred display currency
  cash_usd        DOUBLE PRECISION NOT NULL DEFAULT 50000.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Long positions
CREATE TABLE IF NOT EXISTS holdings (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker          TEXT NOT NULL,
  shares          INTEGER NOT NULL DEFAULT 0,
  avg_cost_usd    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  UNIQUE (account_id, ticker)
);

-- Short positions
CREATE TABLE IF NOT EXISTS shorts (
  id               SERIAL PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker           TEXT NOT NULL,
  shares           INTEGER NOT NULL DEFAULT 0,
  entry_price_usd  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  UNIQUE (account_id, ticker)
);

-- Pending limit orders (buy or sell, not yet filled)
CREATE TABLE IF NOT EXISTS pending_orders (
  id              TEXT PRIMARY KEY,                  -- uuid
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker          TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('buy','sell')),
  qty             INTEGER NOT NULL,
  limit_usd       DOUBLE PRECISION NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transaction ledger
CREATE TABLE IF NOT EXISTS transactions (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,                     -- buy | sell | short | cover | dividend | delist
  ticker          TEXT NOT NULL,
  qty             INTEGER NOT NULL DEFAULT 0,
  price_usd       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  total_usd       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  settle_currency TEXT NOT NULL DEFAULT 'OStar',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Market event log (dispatches submitted by users, AI-priced)
CREATE TABLE IF NOT EXISTS market_events (
  id          SERIAL PRIMARY KEY,
  event_text  TEXT NOT NULL,
  effects     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_shorts_account   ON shorts(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_account   ON pending_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_account       ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_events_time      ON market_events(created_at DESC);
