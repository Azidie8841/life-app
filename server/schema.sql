-- Skema pangkalan data untuk Dana Kecemasan
-- Jalankan fail ini SEKALI sahaja untuk sediakan jadual (tables).

-- Perlu untuk fungsi gen_random_uuid() di bawah
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Setiap "tempat simpanan" (ASB 1, KWSP Akaun 3, dll.)
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Setiap transaksi (tambah / keluar dana)
CREATE TABLE IF NOT EXISTS transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_name   TEXT NOT NULL,          -- disalin masa transaksi dibuat, supaya sejarah kekal walau nama akaun ditukar
  type           TEXT NOT NULL CHECK (type IN ('add', 'withdraw')),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason         TEXT,
  balance_after  NUMERIC(14,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);

-- Tetapan umum (key-value ringkas) — buat masa ni simpan sasaran Dana Kecemasan.
-- Jadual ni sengaja "generic" (bukan lajur khas "target_amount") supaya senang
-- tambah tetapan lain kemudian hari tanpa perlu ALTER TABLE lagi.
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO settings (key, value)
VALUES ('emergency_fund_target', '0')
ON CONFLICT (key) DO NOTHING;

-- Modul Hasil (KewanganKu) — rekod pendapatan, berdiri sendiri (tiada pautan
-- ke accounts/transactions Dana Kecemasan pada fasa ini).
CREATE TABLE IF NOT EXISTS hasil (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sumber        TEXT NOT NULL,
  kategori      TEXT NOT NULL,
  jumlah        NUMERIC(14,2) NOT NULL CHECK (jumlah > 0),
  tarikh        DATE NOT NULL,
  nota          TEXT,
  dicipta_pada  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hasil_tarikh ON hasil (tarikh DESC);

-- Data permulaan (boleh padam/ubah kalau tak nak)
INSERT INTO accounts (name, balance)
SELECT 'ASB 1', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts);

INSERT INTO accounts (name, balance)
SELECT 'KWSP Akaun 3', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'KWSP Akaun 3');
