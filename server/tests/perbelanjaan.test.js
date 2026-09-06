// Test automatik untuk modul Perbelanjaan — kategori sementara nama unik,
// dan Dana Luar Biasa dibersihkan (semua pinjaman sedia ada dibayar dulu)
// sebelum test khusus DLB jalan, sebab ia sumber GLOBAL berkekalan yang
// boleh ada baki daripada sesi manual/test lain.

const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.APP_PASSWORD || 'P@ssw0rd';
const BULAN = '2026-09';

let sessionCookie = '';

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
    ...options
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';')[0];
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

let katWajibId, katLarasId, txnId, waranId, pinjamanId;
const suffix = Date.now();

test('login', async () => {
  const { status } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.strictEqual(status, 200);
});

test('bersihkan Dana Luar Biasa sedia ada (bayar semua pinjaman tertunggak dari sesi lain)', async () => {
  const { data } = await api('/api/dana-luar-biasa');
  for (const p of data.senaraiBelumDibayar) {
    await api(`/api/dana-luar-biasa/${p.id}/bayar`, { method: 'POST', body: JSON.stringify({ bulan: BULAN }) });
  }
  const { data: after } = await api('/api/dana-luar-biasa');
  assert.strictEqual(after.bakiBelumDibayar, 0);
});

test('cipta kategori WAJIB sementara', async () => {
  const { status, data } = await api('/api/kategori-perbelanjaan', {
    method: 'POST', body: JSON.stringify({ nama: `TEST_WAJIB_${suffix}`, jenis: 'wajib' })
  });
  assert.strictEqual(status, 201);
  katWajibId = data.id;
});

test('cipta kategori BOLEH LARAS sementara', async () => {
  const { status, data } = await api('/api/kategori-perbelanjaan', {
    method: 'POST', body: JSON.stringify({ nama: `TEST_LARAS_${suffix}`, jenis: 'boleh_laras' })
  });
  assert.strictEqual(status, 201);
  katLarasId = data.id;
});

test('set kotak BOLEH LARAS sebelum WAJIB diisi -> ditolak (400)', async () => {
  const { status, data } = await api('/api/belanjawan', {
    method: 'PUT', body: JSON.stringify({ kategoriId: katLarasId, bulan: BULAN, jumlah: 500 })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.includes('Wajib'));
});

test('set kotak WAJIB -> berjaya', async () => {
  const { status } = await api('/api/belanjawan', {
    method: 'PUT', body: JSON.stringify({ kategoriId: katWajibId, bulan: BULAN, jumlah: 700 })
  });
  assert.strictEqual(status, 200);
});

test('set kotak BOLEH LARAS SEKARANG (wajib dah terisi) -> berjaya', async () => {
  const { status } = await api('/api/belanjawan', {
    method: 'PUT', body: JSON.stringify({ kategoriId: katLarasId, bulan: BULAN, jumlah: 500 })
  });
  assert.strictEqual(status, 200);
});

test('tambah rekod perbelanjaan', async () => {
  const { status, data } = await api('/api/perbelanjaan', {
    method: 'POST',
    body: JSON.stringify({ kategoriId: katLarasId, jumlah: 45, tarikh: `${BULAN}-05`, nota: 'test' })
  });
  if (data && data.id) txnId = data.id;
  assert.strictEqual(status, 201);
});

test('ringkasan mengira dibelanjakan dengan betul', async () => {
  const { data } = await api(`/api/belanjawan/ringkasan?bulan=${BULAN}`);
  const kat = data.kategori.find(k => k.kategoriId === katLarasId);
  assert.strictEqual(kat.dibelanjakan, 45);
});

test('Waran Pindah: jumlah melebihi baki -> ditolak (400)', async () => {
  const { status } = await api('/api/waran-pindah', {
    method: 'POST',
    body: JSON.stringify({ bulan: BULAN, kategoriDariId: katLarasId, kategoriKeId: katWajibId, jumlah: 99999, sebab: 'test' })
  });
  assert.strictEqual(status, 400);
});

test('Waran Pindah: tanpa sebab -> ditolak (400)', async () => {
  const { status } = await api('/api/waran-pindah', {
    method: 'POST',
    body: JSON.stringify({ bulan: BULAN, kategoriDariId: katLarasId, kategoriKeId: katWajibId, jumlah: 10, sebab: '' })
  });
  assert.strictEqual(status, 400);
});

test('Waran Pindah yang sah -> berjaya, dapat nombor_siri', async () => {
  const { status, data } = await api('/api/waran-pindah', {
    method: 'POST',
    body: JSON.stringify({ bulan: BULAN, kategoriDariId: katLarasId, kategoriKeId: katWajibId, jumlah: 20, sebab: 'test pindah' })
  });
  if (data && data.id) waranId = data.id;
  assert.strictEqual(status, 201);
  assert.strictEqual(data.jenis, 'pindah');
  assert.ok(data.nombor_siri >= 1);
});

test('Dana Luar Biasa: pinjam ke kategori WAJIB (elak isu wajib-first) -> berjaya', async () => {
  const { status, data } = await api('/api/dana-luar-biasa/pinjam', {
    method: 'POST',
    body: JSON.stringify({ kategoriId: katWajibId, bulan: BULAN, jumlah: 100, sebab: 'test pinjam' })
  });
  if (data && data.id) pinjamanId = data.id;
  assert.strictEqual(status, 201);
  assert.strictEqual(data.status, 'belum_dibayar');
});

test('Dana Luar Biasa: pinjam lagi bulan SEBELUM ada tunggakan -> ditolak (400)', async () => {
  const { status } = await api('/api/dana-luar-biasa/pinjam', {
    method: 'POST',
    body: JSON.stringify({ kategoriId: katWajibId, bulan: '2026-10', jumlah: 10, sebab: 'test' })
  });
  assert.strictEqual(status, 400);
});

test('Dana Luar Biasa: pinjam LAGI dalam bulan SAMA (tunggakan bulan sama, bukan bulan lepas) -> dibenarkan', async () => {
  const { status } = await api('/api/dana-luar-biasa/pinjam', {
    method: 'POST',
    body: JSON.stringify({ kategoriId: katWajibId, bulan: BULAN, jumlah: 10, sebab: 'test kedua' })
  });
  assert.strictEqual(status, 201);
});

test('Kotak tak boleh diset bawah jumlah pinjaman aktif', async () => {
  const { status, data } = await api('/api/belanjawan', {
    method: 'PUT', body: JSON.stringify({ kategoriId: katWajibId, bulan: BULAN, jumlah: 50 })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.includes('pinjaman'));
});

test('Bayar balik pinjaman -> berjaya', async () => {
  const { status, data } = await api(`/api/dana-luar-biasa/${pinjamanId}/bayar`, {
    method: 'POST', body: JSON.stringify({ bulan: BULAN })
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.status, 'sudah_dibayar');
});

test('Bayar balik BUAT KALI KEDUA -> ditolak (400)', async () => {
  const { status } = await api(`/api/dana-luar-biasa/${pinjamanId}/bayar`, {
    method: 'POST', body: JSON.stringify({ bulan: BULAN })
  });
  assert.strictEqual(status, 400);
});

test('padam rekod perbelanjaan', async () => {
  const { status } = await api(`/api/perbelanjaan/${txnId}`, { method: 'DELETE' });
  assert.strictEqual(status, 204);
});

test('bersihkan: kosongkan kotak dan padam kategori sementara', async () => {
  // Kosongkan kotak dulu (kategori laras ada RM520 lepas waran pindah masuk 20 dari sebelum ni... betulkan ikut baki sebenar)
  await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: katLarasId, bulan: BULAN, jumlah: 0 }) });
  await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: katWajibId, bulan: BULAN, jumlah: 0 }) });

  const { status: s1 } = await api(`/api/kategori-perbelanjaan/${katLarasId}`, { method: 'DELETE' });
  const { status: s2 } = await api(`/api/kategori-perbelanjaan/${katWajibId}`, { method: 'DELETE' });
  // Nota: mungkin gagal (400) kalau masih ada Waran/pinjaman bersandar — ini
  // EXPECTED, sebab Waran memang sengaja kekal selama-lamanya (rekod audit).
  // Test ni hanya cuba bersihkan sebaik mungkin, bukan jamin kejayaan penuh.
  console.log(`Pembersihan kategori: laras=${s1}, wajib=${s2} (400 di sini OK — Waran kekal sengaja)`);
});
