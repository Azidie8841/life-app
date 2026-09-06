const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { wajibBelumTerisi, pinjamanAktifDalamKotak } = require('../utils/perbelanjaanHelpers');

const router = express.Router();

// GET /api/belanjawan?bulan=YYYY-MM — senarai kotak bulan tu
router.get('/', asyncHandler(async (req, res) => {
  const bulan = (req.query.bulan || '').trim();
  if (!/^\d{4}-\d{2}$/.test(bulan)) {
    return res.status(400).json({ error: 'Parameter bulan (YYYY-MM) diperlukan.' });
  }
  const result = await pool.query(
    `SELECT b.id, b.kategori_id, k.nama AS kategori_nama, k.jenis, b.jumlah_belanjawan
     FROM belanjawan b
     JOIN kategori_perbelanjaan k ON k.id = b.kategori_id
     WHERE b.bulan = $1`,
    [bulan]
  );
  res.json(result.rows);
}));

// PUT /api/belanjawan — upsert kotak (tetapkan/kemas kini jumlah)
router.put('/', asyncHandler(async (req, res) => {
  const { kategoriId, bulan, jumlah } = req.body;
  const jml = parseFloat(jumlah);

  if (!kategoriId || !/^\d{4}-\d{2}$/.test(bulan || '')) {
    return res.status(400).json({ error: 'kategoriId dan bulan (YYYY-MM) diperlukan.' });
  }
  if (isNaN(jml) || jml < 0) {
    return res.status(400).json({ error: 'Jumlah mesti nombor 0 atau lebih.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kategoriResult = await client.query(
      'SELECT id, nama, jenis FROM kategori_perbelanjaan WHERE id = $1 FOR UPDATE',
      [kategoriId]
    );
    if (!kategoriResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
    }
    const kategori = kategoriResult.rows[0];

    // Peraturan: Boleh Laras tak boleh diisi (jumlah > 0) sebelum semua Wajib terisi
    if (kategori.jenis === 'boleh_laras' && jml > 0) {
      const belum = await wajibBelumTerisi(client, bulan);
      if (belum.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Isi kategori Wajib dulu sebelum Boleh Laras: ${belum.map(k => k.nama).join(', ')}.`
        });
      }
    }

    // Elak kotak diset bawah jumlah pinjaman aktif belum dibayar pada kategori+bulan tu
    const pinjamanAktif = await pinjamanAktifDalamKotak(client, kategoriId, bulan);
    if (jml < pinjamanAktif) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Tak boleh set bawah RM${pinjamanAktif.toFixed(2)} — jumlah ni termasuk pinjaman Dana Luar Biasa yang belum dibayar. Bayar balik pinjaman dulu.`
      });
    }

    const result = await client.query(
      `INSERT INTO belanjawan (kategori_id, bulan, jumlah_belanjawan)
       VALUES ($1, $2, $3)
       ON CONFLICT (kategori_id, bulan)
       DO UPDATE SET jumlah_belanjawan = $3, kemaskini_pada = now()
       RETURNING id, kategori_id, bulan, jumlah_belanjawan`,
      [kategoriId, bulan, jml]
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

// GET /api/belanjawan/ringkasan?bulan=YYYY-MM — untuk grid kad kategori
router.get('/ringkasan', asyncHandler(async (req, res) => {
  const bulan = (req.query.bulan || '').trim();
  if (!/^\d{4}-\d{2}$/.test(bulan)) {
    return res.status(400).json({ error: 'Parameter bulan (YYYY-MM) diperlukan.' });
  }

  const kategoriResult = await pool.query(
    `SELECT k.id AS kategori_id, k.nama, k.jenis,
            COALESCE(b.jumlah_belanjawan, 0) AS belanjawan,
            COALESCE((
              SELECT SUM(p.jumlah) FROM perbelanjaan p
              WHERE p.kategori_id = k.id AND to_char(p.tarikh, 'YYYY-MM') = $1
            ), 0) AS dibelanjakan,
            COALESCE((
              SELECT SUM(pl.jumlah) FROM pinjaman_luar_biasa pl
              WHERE pl.kategori_id = k.id AND pl.bulan_pinjam = $1 AND pl.status = 'belum_dibayar'
            ), 0) AS pinjaman_aktif
     FROM kategori_perbelanjaan k
     LEFT JOIN belanjawan b ON b.kategori_id = k.id AND b.bulan = $1
     ORDER BY k.created_at ASC`,
    [bulan]
  );

  const kategori = kategoriResult.rows.map(r => ({
    kategoriId: r.kategori_id,
    nama: r.nama,
    jenis: r.jenis,
    belanjawan: parseFloat(r.belanjawan),
    dibelanjakan: parseFloat(r.dibelanjakan),
    baki: parseFloat(r.belanjawan) - parseFloat(r.dibelanjakan),
    pinjamanAktif: parseFloat(r.pinjaman_aktif)
  }));

  res.json({
    bulan,
    jumlah_belanjawan: kategori.reduce((s, k) => s + k.belanjawan, 0),
    jumlah_dibelanjakan: kategori.reduce((s, k) => s + k.dibelanjakan, 0),
    kategori
  });
}));

module.exports = router;
