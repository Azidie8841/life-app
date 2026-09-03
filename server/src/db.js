// Fail ini menguruskan sambungan ke pangkalan data Postgres.
const { Pool } = require('pg');

// NODE_ENV=production di-set dalam Dockerfile (untuk Render).
// docker-compose.yml (local) TAK set NODE_ENV, jadi ia undefined —
// ini cara paling tepat bezakan "kita di local" vs "kita di production",
// berbanding cuba teka dari nama hostname database.
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

module.exports = { pool };