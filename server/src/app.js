require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const accountsRouter = require('./routes/accounts');
const transactionsRouter = require('./routes/transactions');

const app = express();

app.use(cors());
app.use(express.json());

// Logging asas — setiap request yang masuk akan tercatat dalam Render Logs
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// API routes
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);

// Semak pelayan hidup ke tak — DevOps akan guna route macam ni untuk "health check"
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Servekan frontend (fail statik dari folder ../../public) dari server yang sama.
// Ini bermakna satu sahaja perkhidmatan (service) perlu di-deploy — lebih senang untuk pemula.
const publicDir = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dana Kecemasan server berjalan di http://localhost:${PORT}`);
});
