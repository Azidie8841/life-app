-- Skema pangkalan data untuk Dana Kecemasan
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_name   TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('add', 'withdraw')),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason         TEXT,
  balance_after  NUMERIC(14,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);

INSERT INTO accounts (name, balance)
SELECT 'ASB 1', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts);

INSERT INTO accounts (name, balance)
SELECT 'KWSP Akaun 3', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'KWSP Akaun 3');