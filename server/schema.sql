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

-- ===== Modul Perbelanjaan / Belanjawan =====

CREATE TABLE IF NOT EXISTS kategori_perbelanjaan (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        TEXT NOT NULL UNIQUE,
  jenis       TEXT NOT NULL DEFAULT 'boleh_laras' CHECK (jenis IN ('wajib','boleh_laras')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kotak peruntukan — satu per kategori per bulan
CREATE TABLE IF NOT EXISTS belanjawan (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kategori_id        UUID NOT NULL REFERENCES kategori_perbelanjaan(id) ON DELETE CASCADE,
  bulan              TEXT NOT NULL,
  jumlah_belanjawan  NUMERIC(14,2) NOT NULL CHECK (jumlah_belanjawan >= 0),
  dicipta_pada       TIMESTAMPTZ NOT NULL DEFAULT now(),
  kemaskini_pada     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kategori_id, bulan)
);

CREATE INDEX IF NOT EXISTS idx_belanjawan_bulan ON belanjawan (bulan);

-- Rekod perbelanjaan SEBENAR
CREATE TABLE IF NOT EXISTS perbelanjaan (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kategori_id    UUID NOT NULL REFERENCES kategori_perbelanjaan(id),
  kategori_nama  TEXT NOT NULL,
  jumlah         NUMERIC(14,2) NOT NULL CHECK (jumlah > 0),
  tarikh         DATE NOT NULL,
  nota           TEXT,
  dicipta_pada   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perbelanjaan_tarikh ON perbelanjaan (tarikh DESC);

-- Dua sequence berasingan — Waran Pindah dan Waran Pinjaman ada siri nombor sendiri
CREATE SEQUENCE IF NOT EXISTS waran_pindah_siri_seq;
CREATE SEQUENCE IF NOT EXISTS waran_pinjaman_siri_seq;

-- Rekod KEKAL setiap pergerakan peruntukan (Pindah antara kategori, ATAU Pinjaman dari Dana Luar Biasa)
CREATE TABLE IF NOT EXISTS waran_pindah (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jenis               TEXT NOT NULL CHECK (jenis IN ('pindah','pinjaman')),
  nombor_siri         BIGINT NOT NULL,
  bulan               TEXT NOT NULL,
  kategori_dari_id    UUID REFERENCES kategori_perbelanjaan(id),
  kategori_dari_nama  TEXT NOT NULL,
  kategori_ke_id      UUID NOT NULL REFERENCES kategori_perbelanjaan(id),
  kategori_ke_nama    TEXT NOT NULL,
  jumlah              NUMERIC(14,2) NOT NULL CHECK (jumlah > 0),
  sebab               TEXT NOT NULL,
  dicipta_pada        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (jenis, nombor_siri)
);

CREATE INDEX IF NOT EXISTS idx_waran_pindah_bulan ON waran_pindah (bulan);

-- Status hayat setiap pinjaman Dana Luar Biasa (berasingan dari Waran sebab status berubah, Waran kekal)
CREATE TABLE IF NOT EXISTS pinjaman_luar_biasa (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waran_id       UUID NOT NULL REFERENCES waran_pindah(id),
  kategori_id    UUID NOT NULL REFERENCES kategori_perbelanjaan(id),
  kategori_nama  TEXT NOT NULL,
  bulan_pinjam   TEXT NOT NULL,
  jumlah         NUMERIC(14,2) NOT NULL CHECK (jumlah > 0),
  sebab          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'belum_dibayar' CHECK (status IN ('belum_dibayar','sudah_dibayar')),
  bulan_dibayar  TEXT,
  dicipta_pada   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dibayar_pada   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pinjaman_status ON pinjaman_luar_biasa (status);

INSERT INTO settings (key, value)
VALUES ('dana_luar_biasa_had', '1000')
ON CONFLICT (key) DO NOTHING;

-- Data permulaan (boleh padam/ubah kalau tak nak)
INSERT INTO accounts (name, balance)
SELECT 'ASB 1', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts);

INSERT INTO accounts (name, balance)
SELECT 'KWSP Akaun 3', 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'KWSP Akaun 3');
