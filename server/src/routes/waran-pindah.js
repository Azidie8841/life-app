const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { wajibBelumTerisi } = require('../utils/perbelanjaanHelpers');

const router = express.Router();

// GET /api/waran-pindah?bulan=YYYY-MM&kategoriId=&jenis=
router.get('/', asyncHandler(async (req, res) => {
  const { bulan, kategoriId, jenis } = req.query;
  const conditions = [];
  const params = [];

  if (bulan) { params.push(bulan); conditions.push(`bulan = $${params.length}`); }
  if (jenis) { params.push(jenis); conditions.push(`jenis = $${params.length}`); }
  if (kategoriId) {
    params.push(kategoriId);
    conditions.push(`(kategori_dari_id = $${params.length} OR kategori_ke_id = $${params.length})`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  // Diurutkan ikut MASA sebenar (dicipta_pada) — bukan nombor_siri, sebab
  // Pindah dan Pinjaman ada DUA siri berasingan yang masing-masing mula dari 1.
  const result = await pool.query(
    `SELECT id, jenis, nombor_siri, bulan, kategori_dari_id, kategori_dari_nama,
            kategori_ke_id, kategori_ke_nama, jumlah, sebab, dicipta_pada
     FROM waran_pindah ${where}
     ORDER BY dicipta_pada DESC`,
    params
  );
  res.json(result.rows);
}));

// POST /api/waran-pindah — pindah peruntukan antara dua kategori
router.post('/', asyncHandler(async (req, res) => {
  const { bulan, kategoriDariId, kategoriKeId, jumlah, sebab } = req.body;
  const jml = parseFloat(jumlah);
  const sebabTrim = (sebab || '').trim();

  if (!/^\d{4}-\d{2}$/.test(bulan || '')) return res.status(400).json({ error: 'Bulan (YYYY-MM) diperlukan.' });
  if (!kategoriDariId || !kategoriKeId) return res.status(400).json({ error: 'Kategori asal dan destinasi diperlukan.' });
  if (kategoriDariId === kategoriKeId) return res.status(400).json({ error: 'Kategori asal dan destinasi mesti berbeza.' });
  if (!jml || jml <= 0) return res.status(400).json({ error: 'Jumlah mesti lebih daripada 0.' });
  if (!sebabTrim) return res.status(400).json({ error: 'Sebab wajib dinyatakan.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Kunci kedua-dua kategori (ikut turutan ID supaya konsisten, elak deadlock)
    const ids = [kategoriDariId, kategoriKeId].sort();
    const kategoriRows = await client.query(
      'SELECT id, nama, jenis FROM kategori_perbelanjaan WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [ids]
    );
    const kategoriDari = kategoriRows.rows.find(k => k.id === kategoriDariId);
    const kategoriKe = kategoriRows.rows.find(k => k.id === kategoriKeId);
    if (!kategoriDari || !kategoriKe) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
    }

    const kotakDariResult = await client.query(
      'SELECT jumlah_belanjawan FROM belanjawan WHERE kategori_id = $1 AND bulan = $2 FOR UPDATE',
      [kategoriDariId, bulan]
    );
    const bakiDari = kotakDariResult.rows.length ? parseFloat(kotakDariResult.rows[0].jumlah_belanjawan) : 0;
    if (jml > bakiDari) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Baki kotak asal cuma RM${bakiDari.toFixed(2)} — tak cukup untuk pindah RM${jml.toFixed(2)}.` });
    }

    // Peraturan Wajib-dulu — kalau destinasi Boleh Laras
    if (kategoriKe.jenis === 'boleh_laras') {
      const belum = await wajibBelumTerisi(client, bulan);
      if (belum.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Isi kategori Wajib dulu sebelum tambah ke Boleh Laras: ${belum.map(k => k.nama).join(', ')}.`
        });
      }
    }

    await client.query(
      `INSERT INTO belanjawan (kategori_id, bulan, jumlah_belanjawan)
       VALUES ($1, $2, $3)
       ON CONFLICT (kategori_id, bulan) DO UPDATE SET jumlah_belanjawan = $3, kemaskini_pada = now()`,
      [kategoriDariId, bulan, bakiDari - jml]
    );

    const kotakKeResult = await client.query(
      'SELECT jumlah_belanjawan FROM belanjawan WHERE kategori_id = $1 AND bulan = $2 FOR UPDATE',
      [kategoriKeId, bulan]
    );
    const bakiKeSebelum = kotakKeResult.rows.length ? parseFloat(kotakKeResult.rows[0].jumlah_belanjawan) : 0;
    await client.query(
      `INSERT INTO belanjawan (kategori_id, bulan, jumlah_belanjawan)
       VALUES ($1, $2, $3)
       ON CONFLICT (kategori_id, bulan) DO UPDATE SET jumlah_belanjawan = $3, kemaskini_pada = now()`,
      [kategoriKeId, bulan, bakiKeSebelum + jml]
    );

    const siriResult = await client.query("SELECT nextval('waran_pindah_siri_seq') AS n");
    const nomborSiri = parseInt(siriResult.rows[0].n, 10);

    const waranResult = await client.query(
      `INSERT INTO waran_pindah
         (jenis, nombor_siri, bulan, kategori_dari_id, kategori_dari_nama, kategori_ke_id, kategori_ke_nama, jumlah, sebab)
       VALUES ('pindah', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, jenis, nombor_siri, bulan, kategori_dari_id, kategori_dari_nama,
                 kategori_ke_id, kategori_ke_nama, jumlah, sebab, dicipta_pada`,
      [nomborSiri, bulan, kategoriDariId, kategoriDari.nama, kategoriKeId, kategoriKe.nama, jml, sebabTrim]
    );

    await client.query('COMMIT');
    res.status(201).json(waranResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
