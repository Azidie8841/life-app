const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/transactions — senarai semua transaksi, terbaru dulu
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, account_id, account_name, type, amount, reason, balance_after, created_at
     FROM transactions
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
}));

// Kira SEMULA baki satu akaun dari awal — guna lepas edit/padam transaksi,
// sebab lajur "balance_after" setiap transaksi adalah running total yang
// bergantung kepada turutan. Kalau satu baris berubah, semua baris SELEPAS
// dia (dalam akaun yang sama) perlu dikira semula.
//
// Kalau baki jadi NEGATIF pada mana-mana titik dalam sejarah (contoh: padam
// "tambah RM500" yang sebenarnya dah "dibelanjakan" oleh withdrawal lepas
// tu), kita THROW error dan seluruh operasi di-ROLLBACK — elak data jadi
// tak masuk akal.
async function recalcAccountBalance(client, accountId) {
  const txns = await client.query(
    `SELECT id, type, amount FROM transactions
     WHERE account_id = $1
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [accountId]
  );

  let balance = 0;
  for (const t of txns.rows) {
    balance = t.type === 'add' ? balance + parseFloat(t.amount) : balance - parseFloat(t.amount);
    if (balance < -0.001) {
      const err = new Error(
        'Perubahan ini menyebabkan baki jadi negatif pada satu titik dalam sejarah transaksi akaun ini. Padam/edit transaksi lain dulu.'
      );
      err.statusCode = 400;
      throw err;
    }
    await client.query('UPDATE transactions SET balance_after = $1 WHERE id = $2', [balance, t.id]);
  }

  await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [balance, accountId]);
  return balance;
}

// POST /api/transactions — tambah atau keluarkan dana
router.post('/', asyncHandler(async (req, res) => {
  const { accountId, type, amount, reason } = req.body;
  const amt = parseFloat(amount);

  if (!accountId || !['add', 'withdraw'].includes(type)) {
    return res.status(400).json({ error: 'Data transaksi tidak lengkap.' });
  }
  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'Jumlah mesti lebih daripada 0.' });
  }
  if (type === 'withdraw' && !(reason || '').trim()) {
    return res.status(400).json({ error: 'Sebab pengeluaran diperlukan.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const accResult = await client.query(
      'SELECT id, name, balance FROM accounts WHERE id = $1 FOR UPDATE',
      [accountId]
    );
    if (!accResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Akaun tidak dijumpai.' });
    }

    const acc = accResult.rows[0];
    const currentBalance = parseFloat(acc.balance);
    const newBalance = type === 'add' ? currentBalance + amt : currentBalance - amt;

    if (type === 'withdraw' && newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Jumlah melebihi baki akaun ini.' });
    }

    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [newBalance, acc.id]);

    const txnResult = await client.query(
      `INSERT INTO transactions (account_id, account_name, type, amount, reason, balance_after)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, account_id, account_name, type, amount, reason, balance_after, created_at`,
      [acc.id, acc.name, type, amt, (reason || '').trim(), newBalance]
    );

    await client.query('COMMIT');
    res.status(201).json(txnResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /api/transactions/:id — edit jumlah/sebab transaksi sedia ada
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const amt = parseFloat(req.body.amount);
  const reason = (req.body.reason || '').trim();

  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'Jumlah mesti lebih daripada 0.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT account_id, type FROM transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaksi tidak dijumpai.' });
    }
    const { account_id: accountId, type } = existing.rows[0];

    if (type === 'withdraw' && !reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sebab pengeluaran diperlukan.' });
    }

    // kunci akaun juga, supaya tiada operasi lain ubah baki serentak semasa kita kira semula
    await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);

    await client.query(
      'UPDATE transactions SET amount = $1, reason = $2 WHERE id = $3',
      [amt, reason, id]
    );

    await recalcAccountBalance(client, accountId);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  } finally {
    client.release();
  }
}));

// DELETE /api/transactions/:id — padam satu transaksi
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT account_id FROM transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaksi tidak dijumpai.' });
    }
    const accountId = existing.rows[0].account_id;

    await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    await client.query('DELETE FROM transactions WHERE id = $1', [id]);

    await recalcAccountBalance(client, accountId);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
