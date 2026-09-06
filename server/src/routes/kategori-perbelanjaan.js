const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/kategori-perbelanjaan — senarai semua kategori
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, nama, jenis FROM kategori_perbelanjaan ORDER BY created_at ASC'
  );
  res.json(result.rows);
}));

// POST /api/kategori-perbelanjaan — tambah kategori baharu
router.post('/', asyncHandler(async (req, res) => {
  const nama = (req.body.nama || '').trim();
  const jenis = req.body.jenis === 'wajib' ? 'wajib' : 'boleh_laras';
  if (!nama) return res.status(400).json({ error: 'Nama kategori diperlukan.' });

  const dup = await pool.query(
    'SELECT id FROM kategori_perbelanjaan WHERE LOWER(nama) = LOWER($1)', [nama]
  );
  if (dup.rows.length) return res.status(400).json({ error: 'Nama ini sudah digunakan.' });

  const result = await pool.query(
    'INSERT INTO kategori_perbelanjaan (nama, jenis) VALUES ($1, $2) RETURNING id, nama, jenis',
    [nama, jenis]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH /api/kategori-perbelanjaan/:id — kemas kini nama/jenis
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const nama = (req.body.nama || '').trim();
  const jenis = req.body.jenis === 'wajib' ? 'wajib' : 'boleh_laras';
  if (!nama) return res.status(400).json({ error: 'Nama kategori diperlukan.' });

  const dup = await pool.query(
    'SELECT id FROM kategori_perbelanjaan WHERE LOWER(nama) = LOWER($1) AND id != $2', [nama, id]
  );
  if (dup.rows.length) return res.status(400).json({ error: 'Nama ini sudah digunakan.' });

  const result = await pool.query(
    'UPDATE kategori_perbelanjaan SET nama = $1, jenis = $2 WHERE id = $3 RETURNING id, nama, jenis',
    [nama, jenis, id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });

  // kemas kini nama snapshot pada rekod sejarah supaya kekal konsisten
  await pool.query('UPDATE perbelanjaan SET kategori_nama = $1 WHERE kategori_id = $2', [nama, id]);
  await pool.query(
    'UPDATE waran_pindah SET kategori_dari_nama = $1 WHERE kategori_dari_id = $2', [nama, id]
  );
  await pool.query(
    'UPDATE waran_pindah SET kategori_ke_nama = $1 WHERE kategori_ke_id = $2', [nama, id]
  );
  await pool.query(
    'UPDATE pinjaman_luar_biasa SET kategori_nama = $1 WHERE kategori_id = $2', [nama, id]
  );

  res.json(result.rows[0]);
}));

// DELETE /api/kategori-perbelanjaan/:id — padam (kalau tiada apa-apa bersandar)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const checks = await Promise.all([
    pool.query('SELECT 1 FROM perbelanjaan WHERE kategori_id = $1 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM belanjawan WHERE kategori_id = $1 AND jumlah_belanjawan > 0 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM waran_pindah WHERE kategori_dari_id = $1 OR kategori_ke_id = $1 LIMIT 1', [id]),
    pool.query('SELECT 1 FROM pinjaman_luar_biasa WHERE kategori_id = $1 LIMIT 1', [id])
  ]);
  if (checks.some(r => r.rows.length)) {
    return res.status(400).json({ error: 'Ada rekod/kotak/waran/pinjaman bersandar pada kategori ini — tak boleh padam.' });
  }

  const result = await pool.query('DELETE FROM kategori_perbelanjaan WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
  res.status(204).send();
}));

module.exports = router;
