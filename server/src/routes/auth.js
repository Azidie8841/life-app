const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// Bandingkan password guna "timing-safe compare" — cara biasa `a === b`
// sebenarnya boleh bocorkan maklumat (masa perbandingan sikit lebih lama
// bila lebih banyak huruf betul), yang secara teori boleh dieksploitasi.
// crypto.timingSafeEqual() ambil masa SAMA tak kira berapa banyak huruf betul.
function safeCompare(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) {
    // panjang tak sama = pasti salah, tapi kita still buat compare "palsu"
    // supaya masa respons konsisten (elak bocorkan panjang password sebenar)
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD || '';

  if (!correctPassword) {
    console.error('APP_PASSWORD tidak ditetapkan di server.');
    return res.status(500).json({ error: 'Ralat konfigurasi pelayan.' });
  }

  if (!password || !safeCompare(password, correctPassword)) {
    return res.status(401).json({ error: 'Kata laluan salah.' });
  }

  req.session.loggedIn = true;
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/session — frontend guna ni untuk semak status login semasa
router.get('/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.loggedIn) });
});

module.exports = router;
