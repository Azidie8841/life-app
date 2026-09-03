# Dana Kecemasan — Nur' (Teras Kewangan)

Aplikasi tracking Dana Kecemasan, dengan backend API (Node.js + Express),
pangkalan data (PostgreSQL), containerization (Docker), dan CI (GitHub Actions).

## Struktur folder

```
dana-kecemasan-app/
├── public/              ← frontend (HTML/CSS/JS statik)
│   └── index.html
├── server/              ← backend API
│   ├── src/
│   │   ├── app.js       ← entry point
│   │   ├── db.js        ← sambungan Postgres
│   │   └── routes/
│   │       ├── accounts.js
│   │       └── transactions.js
│   ├── schema.sql       ← struktur jadual database
│   ├── package.json
│   └── .env.example
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Jalankan di komputer sendiri (local)

Cara paling senang — guna Docker Compose (tak perlu install Postgres sendiri):

```bash
docker compose up --build
```

Buka http://localhost:3000 — app akan sambung terus ke Postgres yang
dijalankan sekali dalam container `db`.

## Sediakan tanpa Docker (opsyenal)

1. Install Node.js 20+ dan Postgres.
2. `cd server && npm install`
3. Salin `.env.example` kepada `.env`, isikan `DATABASE_URL`.
4. Jalankan `schema.sql` pada database kau.
5. `npm run dev`

## Deploy ke production (percuma)

Lihat perbualan dengan Claude untuk panduan penuh langkah demi langkah —
ringkasannya:

1. Push kod ni ke GitHub.
2. Buat pangkalan data Postgres percuma di Supabase.
3. Jalankan `schema.sql` pada Supabase melalui SQL Editor.
4. Deploy ke Render.com (Web Service, guna Docker), sambungkan ke repo GitHub.
5. Set environment variable `DATABASE_URL` di Render kepada connection string Supabase.
