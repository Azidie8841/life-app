const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Cari kumpulan ikut nama (case-insensitive); cipta kalau belum wujud.
// Nama kosong => tiada kumpulan (kategori "Belum Berkumpulan").
async function cariAtauCiptaKumpulan(client, namaMentah) {
  const nama = (namaMentah || '').trim();
  if (!nama) return null;
  const sedia = await client.query('SELECT id FROM kumpulan_perbelanjaan WHERE LOWER(nama) = LOWER($1)', [nama]);
  if (sedia.rows.length) return sedia.rows[0].id;
  const dicipta = await client.query(
    'INSERT INTO kumpulan_perbelanjaan (nama, peratus) VALUES ($1, 0) RETURNING id',
    [nama]
  );
  return dicipta.rows[0].id;
}

// GET /api/kategori-perbelanjaan — senarai semua kategori
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, nama, jenis, kumpulan_id AS "kumpulanId" FROM kategori_perbelanjaan ORDER BY created_at ASC'
  );
  res.json(result.rows);
}));

// POST /api/kategori-perbelanjaan — tambah kategori baharu
router.post('/', asyncHandler(async (req, res) => {
  const nama = (req.body.nama || '').trim();
  const jenis = req.body.jenis === 'wajib' ? 'wajib' : 'boleh_laras';
  const kumpulanNama = req.body.kumpulan;
  if (!nama) return res.status(400).json({ error: 'Nama kategori diperlukan.' });

  const dup = await pool.query(
    'SELECT id FROM kategori_perbelanjaan WHERE LOWER(nama) = LOWER($1)', [nama]
  );
  if (dup.rows.length) return res.status(400).json({ error: 'Nama ini sudah digunakan.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kumpulanId = await cariAtauCiptaKumpulan(client, kumpulanNama);
    const result = await client.query(
      'INSERT INTO kategori_perbelanjaan (nama, jenis, kumpulan_id) VALUES ($1, $2, $3) RETURNING id, nama, jenis, kumpulan_id AS "kumpulanId"',
      [nama, jenis, kumpulanId]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /api/kategori-perbelanjaan/:id — kemas kini nama/jenis/kumpulan
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const nama = (req.body.nama || '').trim();
  const jenis = req.body.jenis === 'wajib' ? 'wajib' : 'boleh_laras';
  const kumpulanNama = req.body.kumpulan;
  if (!nama) return res.status(400).json({ error: 'Nama kategori diperlukan.' });

  const dup = await pool.query(
    'SELECT id FROM kategori_perbelanjaan WHERE LOWER(nama) = LOWER($1) AND id != $2', [nama, id]
  );
  if (dup.rows.length) return res.status(400).json({ error: 'Nama ini sudah digunakan.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kumpulanId = await cariAtauCiptaKumpulan(client, kumpulanNama);
    const result = await client.query(
      'UPDATE kategori_perbelanjaan SET nama = $1, jenis = $2, kumpulan_id = $3 WHERE id = $4 RETURNING id, nama, jenis, kumpulan_id AS "kumpulanId"',
      [nama, jenis, kumpulanId, id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
    }

    // kemas kini nama snapshot pada rekod sejarah supaya kekal konsisten
    await client.query('UPDATE perbelanjaan SET kategori_nama = $1 WHERE kategori_id = $2', [nama, id]);
    await client.query(
      'UPDATE waran_pindah SET kategori_dari_nama = $1 WHERE kategori_dari_id = $2', [nama, id]
    );
    await client.query(
      'UPDATE waran_pindah SET kategori_ke_nama = $1 WHERE kategori_ke_id = $2', [nama, id]
    );
    await client.query(
      'UPDATE pinjaman_luar_biasa SET kategori_nama = $1 WHERE kategori_id = $2', [nama, id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// DELETE /api/kategori-perbelanjaan/:id — padam (kalau tiada apa-apa bersandar)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const checks = await Promise.all([
    pool.query('SELECT 1 FROM perbelanjaan WHERE kategori_id = $1 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM belanjawan WHERE kategori_id = $1 AND jumlah_belanjawan > 0 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM waran_pindah WHERE kategori_dari_id = $1 OR kategori_ke_id = $1 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM pinjaman_luar_biasa WHERE kategori_id = $1 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM pintasan_perbelanjaan WHERE kategori_id = $1 LIMIT 1', [id])
  ]);
  if (checks.some(r => r.rows.length)) {
    return res.status(400).json({ error: 'Ada rekod/kotak/waran/pinjaman/pintasan bersandar pada kategori ini — tak boleh padam.' });
  }

  const result = await pool.query('DELETE FROM kategori_perbelanjaan WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
  res.status(204).send();
}));

module.exports = router;
