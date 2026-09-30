require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');

const accountsRouter = require('./routes/accounts');
const transactionsRouter = require('./routes/transactions');
const settingsRouter = require('./routes/settings');
const hasilRouter = require('./routes/hasil');
const kategoriPerbelanjaanRouter = require('./routes/kategori-perbelanjaan');
const kumpulanRouter = require('./routes/kumpulan');
const belanjawanRouter = require('./routes/belanjawan');
const perbelanjaanRouter = require('./routes/perbelanjaan');
const waranPindahRouter = require('./routes/waran-pindah');
const danaLuarBiasaRouter = require('./routes/dana-luar-biasa');
const pintasanRouter = require('./routes/pintasan');
const authRouter = require('./routes/auth');
const { requireAuth } = require('./middleware/requireAuth');

const app = express();

// Render (dan kebanyakan hosting cloud) letak app kau di belakang reverse proxy.
// Baris ni bagitahu Express untuk percayakan header HTTPS dari proxy tu,
// supaya cookie "secure" berfungsi betul.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Session — simpan status "loggedIn" dalam cookie yang disahkan (signed),
// supaya user tak perlu login setiap kali buka page baharu.
app.use(session({
  secret: process.env.SESSION_SECRET || 'ubah-ni-di-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 hari
  }
}));

// Logging asas — setiap request yang masuk akan tercatat dalam Render Logs
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Route login/logout — TAK dilindungi (sebab macam mana nak login kalau dah dikunci?)
app.use('/api/auth', authRouter);

// API routes — DILINDUNGI, kena login dulu
app.use('/api/accounts', requireAuth, accountsRouter);
app.use('/api/transactions', requireAuth, transactionsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/hasil', requireAuth, hasilRouter);
app.use('/api/kategori-perbelanjaan', requireAuth, kategoriPerbelanjaanRouter);
app.use('/api/kumpulan', requireAuth, kumpulanRouter);
app.use('/api/belanjawan', requireAuth, belanjawanRouter);
app.use('/api/perbelanjaan', requireAuth, perbelanjaanRouter);
app.use('/api/waran-pindah', requireAuth, waranPindahRouter);
app.use('/api/dana-luar-biasa', requireAuth, danaLuarBiasaRouter);
app.use('/api/pintasan', requireAuth, pintasanRouter);

// Semak pelayan hidup ke tak — DevOps akan guna route macam ni untuk "health check"
// Sengaja TAK dilindungi supaya UptimeRobot boleh check tanpa login.
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Servekan frontend (fail statik dari folder ../../public) dari server yang sama.
const publicDir = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Global error handler — SEMUA error yang tak ditangkap akan sampai sini.
// Server tak crash lagi; user dapat mesej bersih, kau dapat log yang jelas.
app.use((err, req, res, next) => {
  console.error('ERROR:', err.message);
  res.status(500).json({ error: 'Ralat pelayan. Cuba lagi.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dana Kecemasan server berjalan di http://localhost:${PORT}`);
});
