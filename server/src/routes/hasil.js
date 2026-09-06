const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function validateHasilInput(body) {
  const sumber = (body.sumber || '').trim();
  const kategori = (body.kategori || '').trim();
  const jumlah = parseFloat(body.jumlah);
  const tarikh = (body.tarikh || '').trim();
  const nota = (body.nota || '').trim();

  if (!sumber) return { error: 'Sumber diperlukan.' };
  if (!kategori) return { error: 'Kategori diperlukan.' };
  if (!jumlah || jumlah <= 0) return { error: 'Jumlah mesti lebih daripada 0.' };
  if (!tarikh || isNaN(Date.parse(tarikh))) return { error: 'Tarikh tidak sah.' };

  return { data: { sumber, kategori, jumlah, tarikh, nota } };
}

// GET /api/hasil — senarai semua rekod, terbaharu dahulu (ikut tarikh, bukan bila di-key-in)
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, sumber, kategori, jumlah, tarikh, nota, dicipta_pada
     FROM hasil
     ORDER BY tarikh DESC, dicipta_pada DESC`
  );
  res.json(result.rows);
}));

// GET /api/hasil/ringkasan?bulan=YYYY-MM — jumlah keseluruhan + pecahan ikut kategori
// Guna medan "tarikh" (bila hasil diterima), BUKAN "dicipta_pada" (bila di-key-in) —
// supaya rekod yang lewat di-key-in tetap dikira pada bulan yang betul.
router.get('/ringkasan', asyncHandler(async (req, res) => {
  let bulan = (req.query.bulan || '').trim();
  if (!/^\d{4}-\d{2}$/.test(bulan)) {
    const now = new Date();
    bulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const kategoriResult = await pool.query(
    `SELECT kategori, SUM(jumlah) AS jumlah
     FROM hasil
     WHERE to_char(tarikh, 'YYYY-MM') = $1
     GROUP BY kategori
     ORDER BY SUM(jumlah) DESC`,
    [bulan]
  );

  const jumlahKeseluruhan = kategoriResult.rows.reduce(
    (sum, row) => sum + parseFloat(row.jumlah), 0
  );

  res.json({
    bulan,
    jumlah_keseluruhan: jumlahKeseluruhan,
    mengikut_kategori: kategoriResult.rows
  });
}));

// POST /api/hasil — cipta rekod baharu
router.post('/', asyncHandler(async (req, res) => {
  const { error, data } = validateHasilInput(req.body);
  if (error) return res.status(400).json({ error });

  const result = await pool.query(
    `INSERT INTO hasil (sumber, kategori, jumlah, tarikh, nota)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sumber, kategori, jumlah, tarikh, nota, dicipta_pada`,
    [data.sumber, data.kategori, data.jumlah, data.tarikh, data.nota]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH /api/hasil/:id — kemas kini rekod sedia ada
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { error, data } = validateHasilInput(req.body);
  if (error) return res.status(400).json({ error });

  const result = await pool.query(
    `UPDATE hasil SET sumber = $1, kategori = $2, jumlah = $3, tarikh = $4, nota = $5
     WHERE id = $6
     RETURNING id, sumber, kategori, jumlah, tarikh, nota, dicipta_pada`,
    [data.sumber, data.kategori, data.jumlah, data.tarikh, data.nota, id]
  );
  if (!result.rows.length) {
    return res.status(404).json({ error: 'Rekod tidak dijumpai.' });
  }
  res.json(result.rows[0]);
}));

// DELETE /api/hasil/:id — padam rekod
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('DELETE FROM hasil WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) {
    return res.status(404).json({ error: 'Rekod tidak dijumpai.' });
  }
  res.status(204).send();
}));

module.exports = router;
