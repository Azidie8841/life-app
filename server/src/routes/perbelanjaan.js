const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function validateInput(body) {
  const kategoriId = body.kategoriId;
  const jumlah = parseFloat(body.jumlah);
  const tarikh = (body.tarikh || '').trim();
  const nota = (body.nota || '').trim();

  if (!kategoriId) return { error: 'Kategori diperlukan.' };
  if (!jumlah || jumlah <= 0) return { error: 'Jumlah mesti lebih daripada 0.' };
  if (!tarikh || isNaN(Date.parse(tarikh))) return { error: 'Tarikh tidak sah.' };

  return { data: { kategoriId, jumlah, tarikh, nota } };
}

// GET /api/perbelanjaan?bulan=YYYY-MM — senarai rekod bulan tu
router.get('/', asyncHandler(async (req, res) => {
  const bulan = (req.query.bulan || '').trim();
  let query = `SELECT id, kategori_id, kategori_nama, jumlah, tarikh, nota, dicipta_pada FROM perbelanjaan`;
  const params = [];
  if (/^\d{4}-\d{2}$/.test(bulan)) {
    query += ` WHERE to_char(tarikh, 'YYYY-MM') = $1`;
    params.push(bulan);
  }
  query += ' ORDER BY tarikh DESC, dicipta_pada DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
}));

// POST /api/perbelanjaan — tambah rekod
router.post('/', asyncHandler(async (req, res) => {
  const { error, data } = validateInput(req.body);
  if (error) return res.status(400).json({ error });

  const kategoriResult = await pool.query('SELECT nama FROM kategori_perbelanjaan WHERE id = $1', [data.kategoriId]);
  if (!kategoriResult.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });

  const result = await pool.query(
    `INSERT INTO perbelanjaan (kategori_id, kategori_nama, jumlah, tarikh, nota)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kategori_id, kategori_nama, jumlah, tarikh, nota, dicipta_pada`,
    [data.kategoriId, kategoriResult.rows[0].nama, data.jumlah, data.tarikh, data.nota]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH /api/perbelanjaan/:id — kemas kini rekod
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { error, data } = validateInput(req.body);
  if (error) return res.status(400).json({ error });

  const kategoriResult = await pool.query('SELECT nama FROM kategori_perbelanjaan WHERE id = $1', [data.kategoriId]);
  if (!kategoriResult.rows.length) return res.status(404).json({ error: 'Kategori tidak dijumpai.' });

  const result = await pool.query(
    `UPDATE perbelanjaan SET kategori_id = $1, kategori_nama = $2, jumlah = $3, tarikh = $4, nota = $5
     WHERE id = $6
     RETURNING id, kategori_id, kategori_nama, jumlah, tarikh, nota, dicipta_pada`,
    [data.kategoriId, kategoriResult.rows[0].nama, data.jumlah, data.tarikh, data.nota, id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Rekod tidak dijumpai.' });
  res.json(result.rows[0]);
}));

// DELETE /api/perbelanjaan/:id — padam rekod
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM perbelanjaan WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Rekod tidak dijumpai.' });
  res.status(204).send();
}));

module.exports = router;
