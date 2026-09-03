// Fail ini menguruskan sambungan ke pangkalan data Postgres.
// "Pool" bermaksud kita simpan beberapa sambungan sedia-guna
// supaya tak perlu buka sambungan baru setiap kali ada request —
// ini konsep asas untuk performance di production.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Kebanyakan pembekal Postgres percuma (Supabase, Neon, Render) perlukan SSL.
  // NODE_ENV=production akan set ini automatik semasa deploy.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

module.exports = { pool };
