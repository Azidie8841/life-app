const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { wajibBelumTerisi, bajetBelumLengkap, semakHadKumpulan } = require('../utils/perbelanjaanHelpers');

const router = express.Router();

async function getHad(client) {
  const result = await client.query("SELECT value FROM settings WHERE key = 'dana_luar_biasa_had'");
  return result.rows.length ? parseFloat(result.rows[0].value) : 1000;
}

// GET /api/dana-luar-biasa
router.get('/', asyncHandler(async (req, res) => {
  const bulan = (req.query.bulan || '').trim();
  const had = await getHad(pool);

  const belumBayarResult = await pool.query(
    `SELECT id, kategori_nama, bulan_pinjam, jumlah, sebab, dicipta_pada
     FROM pinjaman_luar_biasa WHERE status = 'belum_dibayar' ORDER BY bulan_pinjam ASC`
  );
  const senaraiBelumDibayar = belumBayarResult.rows;
  const bakiBelumDibayar = senaraiBelumDibayar.reduce((s, p) => s + parseFloat(p.jumlah), 0);

  const adaTunggakanSebelumBulan = /^\d{4}-\d{2}$/.test(bulan)
    ? senaraiBelumDibayar.some(p => p.bulan_pinjam < bulan)
    : false;

  res.json({
    had,
    bakiBelumDibayar,
    bakiTersedia: had - bakiBelumDibayar,
    adaTunggakanSebelumBulan,
    senaraiBelumDibayar
  });
}));

// PUT /api/dana-luar-biasa/had — sunting had
router.put('/had', asyncHandler(async (req, res) => {
  const had = parseFloat(req.body.had);
  if (isNaN(had) || had < 0) return res.status(400).json({ error: 'Had mesti nombor 0 atau lebih.' });

  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('dana_luar_biasa_had', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [had]
  );
  res.json({ had });
}));

// POST /api/dana-luar-biasa/pinjam
router.post('/pinjam', asyncHandler(async (req, res) => {
  const { kategoriId, bulan, jumlah, sebab } = req.body;
  const jml = parseFloat(jumlah);
  const sebabTrim = (sebab || '').trim();

  if (!kategoriId) return res.status(400).json({ error: 'Kategori diperlukan.' });
  if (!/^\d{4}-\d{2}$/.test(bulan || '')) return res.status(400).json({ error: 'Bulan (YYYY-MM) diperlukan.' });
  if (!jml || jml <= 0) return res.status(400).json({ error: 'Jumlah mesti lebih daripada 0.' });
  if (!sebabTrim) return res.status(400).json({ error: 'Sebab wajib dinyatakan.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Kunci semua rekod pinjaman belum dibayar dulu, untuk elak race condition
    const tunggakanResult = await client.query(
      `SELECT id, bulan_pinjam, jumlah FROM pinjaman_luar_biasa WHERE status = 'belum_dibayar' FOR UPDATE`
    );
    const tunggakanSebelumBulan = tunggakanResult.rows.filter(p => p.bulan_pinjam < bulan);
    if (tunggakanSebelumBulan.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ada pinjaman tertunggak dari bulan lepas — bayar dulu sebelum pinjam baharu.' });
    }

    const had = await getHad(client);
    const bakiBelumDibayar = tunggakanResult.rows.reduce((s, p) => s + parseFloat(p.jumlah), 0);
    const bakiTersedia = had - bakiBelumDibayar;
    if (jml > bakiTersedia) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Baki tersedia cuma RM${bakiTersedia.toFixed(2)}.` });
    }

    // Gate: semua kategori kena ada bajet diisi dulu untuk bulan ni sebelum Pinjam dibenarkan
    const belumLengkap = await bajetBelumLengkap(client, bulan);
    if (belumLengkap.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Isi bajet semua kategori dulu untuk bulan ni: ${belumLengkap.map(k => k.nama).join(', ')}.`
      });
    }

    const kategoriResult = await client.query(
      'SELECT id, nama, jenis FROM kategori_perbelanjaan WHERE id = $1 FOR UPDATE', [kategoriId]
    );
    if (!kategoriResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
    }
    const kategori = kategoriResult.rows[0];

    if (kategori.jenis === 'boleh_laras') {
      const belum = await wajibBelumTerisi(client, bulan);
      if (belum.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Isi kategori Wajib dulu sebelum pinjam untuk Boleh Laras: ${belum.map(k => k.nama).join(', ')}.`
        });
      }
    }

    // Naikkan kotak kategori destinasi
    const kotakResult = await client.query(
      'SELECT jumlah_belanjawan FROM belanjawan WHERE kategori_id = $1 AND bulan = $2 FOR UPDATE',
      [kategoriId, bulan]
    );
    const bakiSebelum = kotakResult.rows.length ? parseFloat(kotakResult.rows[0].jumlah_belanjawan) : 0;

    // Had kumpulan — pinjaman naikkan kotak kategori destinasi, jadi tertakluk
    // sama macam Edit Bajet & Pindah silang-kumpulan.
    const ralatKumpulan = await semakHadKumpulan(client, kategoriId, bakiSebelum + jml, bulan);
    if (ralatKumpulan) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: ralatKumpulan });
    }

    await client.query(
      `INSERT INTO belanjawan (kategori_id, bulan, jumlah_belanjawan)
       VALUES ($1, $2, $3)
       ON CONFLICT (kategori_id, bulan) DO UPDATE SET jumlah_belanjawan = $3, kemaskini_pada = now()`,
      [kategoriId, bulan, bakiSebelum + jml]
    );

    // Keluarkan Waran (siri berasingan, jenis='pinjaman')
    const siriResult = await client.query("SELECT nextval('waran_pinjaman_siri_seq') AS n");
    const nomborSiri = parseInt(siriResult.rows[0].n, 10);

    const waranResult = await client.query(
      `INSERT INTO waran_pindah
         (jenis, nombor_siri, bulan, kategori_dari_id, kategori_dari_nama, kategori_ke_id, kategori_ke_nama, jumlah, sebab)
       VALUES ('pinjaman', $1, $2, NULL, 'Dana Luar Biasa', $3, $4, $5, $6)
       RETURNING id`,
      [nomborSiri, bulan, kategoriId, kategori.nama, jml, sebabTrim]
    );

    const pinjamanResult = await client.query(
      `INSERT INTO pinjaman_luar_biasa (waran_id, kategori_id, kategori_nama, bulan_pinjam, jumlah, sebab)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kategori_id, kategori_nama, bulan_pinjam, jumlah, sebab, status, dicipta_pada`,
      [waranResult.rows[0].id, kategoriId, kategori.nama, bulan, jml, sebabTrim]
    );

    await client.query('COMMIT');
    res.status(201).json(pinjamanResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /api/dana-luar-biasa/:id/bayar — tandakan sudah dibayar
router.post('/:id/bayar', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const bulanSemasa = (req.body.bulan || '').trim();
  if (!/^\d{4}-\d{2}$/.test(bulanSemasa)) return res.status(400).json({ error: 'Bulan (YYYY-MM) diperlukan.' });

  const result = await pool.query(
    `UPDATE pinjaman_luar_biasa
     SET status = 'sudah_dibayar', bulan_dibayar = $1, dibayar_pada = now()
     WHERE id = $2 AND status = 'belum_dibayar'
     RETURNING id, status, bulan_dibayar, dibayar_pada`,
    [bulanSemasa, id]
  );
  if (!result.rows.length) return res.status(400).json({ error: 'Pinjaman tidak dijumpai atau sudah dibayar.' });
  res.json(result.rows[0]);
}));

module.exports = router;
