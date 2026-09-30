const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/pintasan — senarai pintasan (ikut urutan)
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.label, p.kategori_id AS "kategoriId", k.nama AS "kategoriNama", p.urutan
     FROM pintasan_perbelanjaan p
     JOIN kategori_perbelanjaan k ON k.id = p.kategori_id
     ORDER BY p.urutan ASC, p.created_at ASC`
  );
  res.json(result.rows);
}));

// POST /api/pintasan — cipta pintasan baharu
router.post('/', asyncHandler(async (req, res) => {
  const label = (req.body.label || '').trim();
  const kategoriId = req.body.kategoriId;
  if (!label) return res.status(400).json({ error: 'Label pintasan diperlukan.' });
  if (!kategoriId) return res.status(400).json({ error: 'Kategori diperlukan.' });

  const kategoriResult = await pool.query('SELECT id FROM kategori_perbelanjaan WHERE id = $1', [kategoriId]);
  if (!kategoriResult.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });

  const urutanResult = await pool.query('SELECT COALESCE(MAX(urutan), -1) + 1 AS n FROM pintasan_perbelanjaan');
  const urutan = urutanResult.rows[0].n;

  const result = await pool.query(
    `INSERT INTO pintasan_perbelanjaan (label, kategori_id, urutan)
     VALUES ($1, $2, $3)
     RETURNING id, label, kategori_id AS "kategoriId", urutan`,
    [label, kategoriId, urutan]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH /api/pintasan/:id — kemas kini label/kategori
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const label = (req.body.label || '').trim();
  const kategoriId = req.body.kategoriId;
  if (!label) return res.status(400).json({ error: 'Label pintasan diperlukan.' });
  if (!kategoriId) return res.status(400).json({ error: 'Kategori diperlukan.' });

  const kategoriResult = await pool.query('SELECT id FROM kategori_perbelanjaan WHERE id = $1', [kategoriId]);
  if (!kategoriResult.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });

  const result = await pool.query(
    `UPDATE pintasan_perbelanjaan SET label = $1, kategori_id = $2 WHERE id = $3
     RETURNING id, label, kategori_id AS "kategoriId", urutan`,
    [label, kategoriId, id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Pintasan tidak dijumpai.' });
  res.json(result.rows[0]);
}));

// DELETE /api/pintasan/:id — padam pintasan
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM pintasan_perbelanjaan WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Pintasan tidak dijumpai.' });
  res.status(204).send();
}));

module.exports = router;
