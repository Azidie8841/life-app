const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/settings/target — baca sasaran semasa
router.get('/target', asyncHandler(async (req, res) => {
  const result = await pool.query(
    "SELECT value FROM settings WHERE key = 'emergency_fund_target'"
  );
  const target = result.rows.length ? parseFloat(result.rows[0].value) : 0;
  res.json({ target });
}));

// PUT /api/settings/target — kemaskini sasaran
router.put('/target', asyncHandler(async (req, res) => {
  const target = parseFloat(req.body.target);
  if (isNaN(target) || target < 0) {
    return res.status(400).json({ error: 'Sasaran mesti nombor 0 atau lebih.' });
  }

  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('emergency_fund_target', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [target]
  );
  res.json({ target });
}));

module.exports = router;
