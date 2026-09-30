const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { bajetBelumLengkap } = require('../utils/perbelanjaanHelpers');

const router = express.Router();

const fmt = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bulanKe = (tarikh) => (typeof tarikh === 'string' ? tarikh : new Date(tarikh).toISOString()).slice(0, 7);

// Semak baki kotak kategori (kotak - jumlah dah dibelanjakan bulan tu, TAK KIRA
// rekod sedia ada `abaikanId` kalau tengah edit rekod tu sendiri) cukup untuk
// jumlah yang cuba direkod. Pulangkan mesej ralat kalau tak cukup, null kalau ok.
async function semakBakiKategori(client, kategoriId, jumlah, tarikh, abaikanId) {
  const bulan = bulanKe(tarikh);
  const kotakResult = await client.query(
    'SELECT jumlah_belanjawan FROM belanjawan WHERE kategori_id = $1 AND bulan = $2',
    [kategoriId, bulan]
  );
  const kotak = kotakResult.rows.length ? parseFloat(kotakResult.rows[0].jumlah_belanjawan) : 0;

  const params = [kategoriId, bulan];
  let query = `SELECT COALESCE(SUM(jumlah), 0) AS jumlah FROM perbelanjaan WHERE kategori_id = $1 AND to_char(tarikh, 'YYYY-MM') = $2`;
  if (abaikanId) { params.push(abaikanId); query += ` AND id != $${params.length}`; }
  const dibelanjakanResult = await client.query(query, params);
  const dibelanjakanLain = parseFloat(dibelanjakanResult.rows[0].jumlah);

  const baki = kotak - dibelanjakanLain;
  if (jumlah > baki) {
    const kategoriResult = await client.query('SELECT nama FROM kategori_perbelanjaan WHERE id = $1', [kategoriId]);
    const nama = kategoriResult.rows.length ? kategoriResult.rows[0].nama : 'ni';
    return {
      error: `Kategori "${nama}" cuma ada baki ${fmt(baki)}, tapi kau cuba belanja ${fmt(jumlah)}. Pindahkan peruntukan dari kategori lain, atau pinjam dari Dana Luar Biasa, untuk teruskan.`,
      kategoriId,
      baki,
      jumlahCuba: jumlah
    };
  }
  return null;
}

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bulan = bulanKe(data.tarikh);
    const belumLengkap = await bajetBelumLengkap(client, bulan);
    if (belumLengkap.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Isi bajet semua kategori dulu untuk bulan ni: ${belumLengkap.map(k => k.nama).join(', ')}.`
      });
    }

    const kategoriResult = await client.query('SELECT nama FROM kategori_perbelanjaan WHERE id = $1 FOR UPDATE', [data.kategoriId]);
    if (!kategoriResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
    }

    const ralatBaki = await semakBakiKategori(client, data.kategoriId, data.jumlah, data.tarikh, null);
    if (ralatBaki) {
      await client.query('ROLLBACK');
      return res.status(400).json(ralatBaki);
    }

    const result = await client.query(
      `INSERT INTO perbelanjaan (kategori_id, kategori_nama, jumlah, tarikh, nota)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, kategori_id, kategori_nama, jumlah, tarikh, nota, dicipta_pada`,
      [data.kategoriId, kategoriResult.rows[0].nama, data.jumlah, data.tarikh, data.nota]
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

// PATCH /api/perbelanjaan/:id — kemas kini rekod (TAK digate — mengedit rekod
// sedia ada bukan "aktiviti baharu"; sama macam prototaip)
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { error, data } = validateInput(req.body);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kategoriResult = await client.query('SELECT nama FROM kategori_perbelanjaan WHERE id = $1 FOR UPDATE', [data.kategoriId]);
    if (!kategoriResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kategori tidak dijumpai.' });
    }

    const ralatBaki = await semakBakiKategori(client, data.kategoriId, data.jumlah, data.tarikh, id);
    if (ralatBaki) {
      await client.query('ROLLBACK');
      return res.status(400).json(ralatBaki);
    }

    const result = await client.query(
      `UPDATE perbelanjaan SET kategori_id = $1, kategori_nama = $2, jumlah = $3, tarikh = $4, nota = $5
       WHERE id = $6
       RETURNING id, kategori_id, kategori_nama, jumlah, tarikh, nota, dicipta_pada`,
      [data.kategoriId, kategoriResult.rows[0].nama, data.jumlah, data.tarikh, data.nota, id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rekod tidak dijumpai.' });
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// DELETE /api/perbelanjaan/:id — padam rekod
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM perbelanjaan WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Rekod tidak dijumpai.' });
  res.status(204).send();
}));

module.exports = router;
