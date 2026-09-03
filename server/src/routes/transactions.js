const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// GET /api/transactions — senarai semua transaksi, terbaru dulu
router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, account_id, account_name, type, amount, reason, balance_after, created_at
     FROM transactions
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

// POST /api/transactions — tambah atau keluarkan dana
router.post('/', async (req, res) => {
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
    console.error(err);
    res.status(500).json({ error: 'Ralat pelayan. Cuba lagi.' });
  } finally {
    client.release();
  }
});

module.exports = router;