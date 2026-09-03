const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/accounts — senaraikan semua tempat simpanan
router.get('/', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, balance FROM accounts ORDER BY created_at ASC'
  );
  res.json(result.rows);
}));

// POST /api/accounts — tambah tempat simpanan baharu
router.post('/', asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nama tempat simpanan diperlukan.' });
  }

  const dup = await pool.query(
    'SELECT id FROM accounts WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  if (dup.rows.length) {
    return res.status(400).json({ error: 'Nama ini sudah digunakan.' });
  }

  const result = await pool.query(
    'INSERT INTO accounts (name, balance) VALUES ($1, 0) RETURNING id, name, balance',
    [name]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH /api/accounts/:id — tukar nama akaun
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Nama tempat simpanan diperlukan.' });
  }

  const dup = await pool.query(
    'SELECT id FROM accounts WHERE LOWER(name) = LOWER($1) AND id != $2',
    [name, id]
  );
  if (dup.rows.length) {
    return res.status(400).json({ error: 'Nama ini sudah digunakan.' });
  }

  const result = await pool.query(
    'UPDATE accounts SET name = $1 WHERE id = $2 RETURNING id, name, balance',
    [name, id]
  );
  if (!result.rows.length) {
    return res.status(404).json({ error: 'Akaun tidak dijumpai.' });
  }

  await pool.query(
    'UPDATE transactions SET account_name = $1 WHERE account_id = $2',
    [name, id]
  );

  res.json(result.rows[0]);
}));

// DELETE /api/accounts/:id — padam akaun (hanya jika baki 0)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const countResult = await pool.query('SELECT COUNT(*) FROM accounts');
  if (parseInt(countResult.rows[0].count, 10) <= 1) {
    return res.status(400).json({ error: 'Sekurang-kurangnya satu tempat simpanan diperlukan.' });
  }

  const acc = await pool.query('SELECT balance FROM accounts WHERE id = $1', [id]);
  if (!acc.rows.length) {
    return res.status(404).json({ error: 'Akaun tidak dijumpai.' });
  }
  if (parseFloat(acc.rows[0].balance) !== 0) {
    return res.status(400).json({ error: 'Kosongkan baki sebelum padam akaun ini.' });
  }

  await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  res.status(204).send();
}));

module.exports = router;
