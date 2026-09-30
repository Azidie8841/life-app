const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const NAMA_DIKHASKAN = 'belum berkumpulan';

// pg pulangkan NUMERIC sebagai string ("50.00") — tukar ke nombor supaya
// konsisten dengan seluruh API lain (yang semua parseFloat sebelum hantar).
const toNumber = (row) => ({ ...row, peratus: parseFloat(row.peratus) });

// GET /api/kumpulan — senarai semua kumpulan
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, nama, peratus FROM kumpulan_perbelanjaan ORDER BY created_at ASC'
  );
  res.json(result.rows.map(toNumber));
}));

// POST /api/kumpulan — cipta kumpulan baharu
router.post('/', asyncHandler(async (req, res) => {
  const nama = (req.body.nama || '').trim();
  const peratus = parseFloat(req.body.peratus);
  if (!nama) return res.status(400).json({ error: 'Nama kumpulan diperlukan.' });
  if (nama.toLowerCase() === NAMA_DIKHASKAN) return res.status(400).json({ error: 'Nama ni dikhaskan sistem — guna nama lain.' });
  if (isNaN(peratus) || peratus < 0 || peratus > 100) return res.status(400).json({ error: 'Peratus mesti antara 0 hingga 100.' });

  const dup = await pool.query('SELECT id FROM kumpulan_perbelanjaan WHERE LOWER(nama) = LOWER($1)', [nama]);
  if (dup.rows.length) return res.status(400).json({ error: 'Nama kumpulan ini sudah digunakan.' });

  const result = await pool.query(
    'INSERT INTO kumpulan_perbelanjaan (nama, peratus) VALUES ($1, $2) RETURNING id, nama, peratus',
    [nama, peratus]
  );
  res.status(201).json(toNumber(result.rows[0]));
}));

// PATCH /api/kumpulan/:id — kemas kini nama/peratus
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const nama = (req.body.nama || '').trim();
  const peratus = parseFloat(req.body.peratus);
  if (!nama) return res.status(400).json({ error: 'Nama kumpulan diperlukan.' });
  if (nama.toLowerCase() === NAMA_DIKHASKAN) return res.status(400).json({ error: 'Nama ni dikhaskan sistem — guna nama lain.' });
  if (isNaN(peratus) || peratus < 0 || peratus > 100) return res.status(400).json({ error: 'Peratus mesti antara 0 hingga 100.' });

  const dup = await pool.query('SELECT id FROM kumpulan_perbelanjaan WHERE LOWER(nama) = LOWER($1) AND id != $2', [nama, id]);
  if (dup.rows.length) return res.status(400).json({ error: 'Nama kumpulan ini sudah digunakan.' });

  const result = await pool.query(
    'UPDATE kumpulan_perbelanjaan SET nama = $1, peratus = $2 WHERE id = $3 RETURNING id, nama, peratus',
    [nama, peratus, id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Kumpulan tidak dijumpai.' });
  res.json(toNumber(result.rows[0]));
}));

// DELETE /api/kumpulan/:id — padam kumpulan; ahli dipindah ke "Belum Berkumpulan" (kumpulan_id = NULL)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kumpulanResult = await client.query('SELECT id FROM kumpulan_perbelanjaan WHERE id = $1 FOR UPDATE', [id]);
    if (!kumpulanResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kumpulan tidak dijumpai.' });
    }
    await client.query('UPDATE kategori_perbelanjaan SET kumpulan_id = NULL WHERE kumpulan_id = $1', [id]);
    await client.query('DELETE FROM kumpulan_perbelanjaan WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
