// Test automatik untuk ciri Fasa 2 Perbelanjaan (port dari prototaip):
// Kumpulan + bajet peratus, gate "bajet belum lengkap", dialog kategori tak
// cukup, dan Pintasan. Guna kategori/kumpulan/bulan unik supaya tak bertindih
// dengan tests/perbelanjaan.test.js.
//
// PENTING: gate "bajet belum lengkap" semak SEMUA kategori dalam pangkalan
// data (bukan setakat kategori test ni) bagi bulan berkenaan — jadi fail ni
// paling selamat dijalankan bersendirian selepas reset pangkalan data (lihat
// arahan reset di README/nota commit), bukan bercampur dengan kategori
// tertinggal dari tests/perbelanjaan.test.js pada bulan yang sama.

const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.APP_PASSWORD || 'P@ssw0rd';
const BULAN = '2027-01';
const suffix = Date.now();

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

// Gate "bajet belum lengkap" semak SEMUA kategori dalam pangkalan data bagi
// SATU bulan — kategori tertinggal dari tests/perbelanjaan.test.js (bulan
// lain) tiada kesan sebab gate scoped ikut bulan, tapi utk elak sebarang
// tindanan kalau susunan/concurrency ujian berubah, "prima" kategori lain
// (bukan A/B/C) untuk BULAN ni supaya gate hanya bergantung pada A/B/C.
async function isiSemuaKotakLain(bulan, kecuali) {
  const { data } = await api('/api/kategori-perbelanjaan');
  const senarai = data.filter(k => !kecuali.includes(k.id)).sort((a, b) => (a.jenis === 'wajib' ? -1 : 1) - (b.jenis === 'wajib' ? -1 : 1));
  for (const k of senarai) {
    await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: k.id, bulan, jumlah: 1 }) });
  }
}

let kumId, katAId, katBId, katCId, pintasanId;

test('login', async () => {
  const { status } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  assert.strictEqual(status, 200);
});

test('set Hasil bulan ni RM4000 supaya bajet kumpulan ada asas kira', async () => {
  const { status } = await api('/api/hasil', {
    method: 'POST',
    body: JSON.stringify({ sumber: `TEST_HASIL_${suffix}`, kategori: 'Gaji', jumlah: 4000, tarikh: `${BULAN}-01` })
  });
  assert.strictEqual(status, 201);
});

test('cipta kumpulan 50%', async () => {
  const { status, data } = await api('/api/kumpulan', {
    method: 'POST', body: JSON.stringify({ nama: `TEST_KUM_${suffix}`, peratus: 50 })
  });
  assert.strictEqual(status, 201);
  assert.strictEqual(data.peratus, 50);
  kumId = data.id;
});

test('nama kumpulan "Belum Berkumpulan" ditolak', async () => {
  const { status } = await api('/api/kumpulan', {
    method: 'POST', body: JSON.stringify({ nama: 'Belum Berkumpulan', peratus: 10 })
  });
  assert.strictEqual(status, 400);
});

test('cipta 2 kategori ahli kumpulan (A wajib, B laras) + 1 kategori tiada kumpulan (C laras)', async () => {
  const kum = `TEST_KUM_${suffix}`;
  const a = await api('/api/kategori-perbelanjaan', { method: 'POST', body: JSON.stringify({ nama: `TEST_A_${suffix}`, jenis: 'wajib', kumpulan: kum }) });
  const b = await api('/api/kategori-perbelanjaan', { method: 'POST', body: JSON.stringify({ nama: `TEST_B_${suffix}`, jenis: 'boleh_laras', kumpulan: kum }) });
  const c = await api('/api/kategori-perbelanjaan', { method: 'POST', body: JSON.stringify({ nama: `TEST_C_${suffix}`, jenis: 'boleh_laras' }) });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 201);
  assert.strictEqual(c.status, 201);
  assert.strictEqual(a.data.kumpulanId, kumId);
  assert.strictEqual(b.data.kumpulanId, kumId);
  assert.strictEqual(c.data.kumpulanId, null);
  katAId = a.data.id; katBId = b.data.id; katCId = c.data.id;
});

test('prima kotak kategori LAIN (dari fail test lain) untuk bulan ni supaya gate tak bertindih', async () => {
  await isiSemuaKotakLain(BULAN, [katAId, katBId, katCId]);
});

test('gate: SEMUA kotak masih 0 -> Tambah Perbelanjaan ditolak (400)', async () => {
  const { status, data } = await api('/api/perbelanjaan', {
    method: 'POST', body: JSON.stringify({ kategoriId: katCId, jumlah: 10, tarikh: `${BULAN}-05` })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.toLowerCase().includes('bajet'));
});

test('gate: SEMUA kotak masih 0 -> Waran Pindah ditolak (400)', async () => {
  const { status, data } = await api('/api/waran-pindah', {
    method: 'POST', body: JSON.stringify({ bulan: BULAN, kategoriDariId: katAId, kategoriKeId: katBId, jumlah: 10, sebab: 'test gate' })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.toLowerCase().includes('bajet'));
});

test('gate: SEMUA kotak masih 0 -> Pinjam Dana Luar Biasa ditolak (400)', async () => {
  const { status, data } = await api('/api/dana-luar-biasa/pinjam', {
    method: 'POST', body: JSON.stringify({ kategoriId: katCId, bulan: BULAN, jumlah: 10, sebab: 'test gate' })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.toLowerCase().includes('bajet'));
});

// Bajet kumpulan = 50% x RM4000 = RM2000. Kotak PUT sendiri TIDAK digate oleh
// "bajet belum lengkap" (Edit Bajet ialah cara MENGISI bajet, bukan aktiviti
// lepas-isi) — cuma tertakluk kepada wajib-dulu + had kumpulan.
test('kotak kategori A (wajib) = RM1500 -> berjaya', async () => {
  const { status } = await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: katAId, bulan: BULAN, jumlah: 1500 }) });
  assert.strictEqual(status, 200);
});

test('kotak kategori B = RM600 (jumlah kumpulan jadi RM2100 > had RM2000) -> ditolak (400)', async () => {
  const { status, data } = await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: katBId, bulan: BULAN, jumlah: 600 }) });
  assert.strictEqual(status, 400);
  assert.ok(data.error.includes('kumpulan'));
});

test('kotak kategori B = RM500 (jumlah kumpulan jadi RM2000 = had, tepat) -> berjaya', async () => {
  const { status } = await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: katBId, bulan: BULAN, jumlah: 500 }) });
  assert.strictEqual(status, 200);
});

test('kotak kategori C (tiada kumpulan) = RM300 -> berjaya', async () => {
  const { status } = await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: katCId, bulan: BULAN, jumlah: 300 }) });
  assert.strictEqual(status, 200);
});

test('gate lengkap sekarang (semua kotak > 0) -> Tambah Perbelanjaan berjaya', async () => {
  const { status } = await api('/api/perbelanjaan', {
    method: 'POST', body: JSON.stringify({ kategoriId: katCId, jumlah: 50, tarikh: `${BULAN}-05` })
  });
  assert.strictEqual(status, 201);
});

test('kategori tak cukup: belanja melebihi baki kategori C -> ditolak (400) dengan baki & jumlahCuba', async () => {
  // Kategori C: kotak RM300, dah belanja RM50 -> baki RM250. Cuba belanja RM400.
  const { status, data } = await api('/api/perbelanjaan', {
    method: 'POST', body: JSON.stringify({ kategoriId: katCId, jumlah: 400, tarikh: `${BULAN}-06` })
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(data.baki, 250);
  assert.strictEqual(data.jumlahCuba, 400);
  assert.strictEqual(data.kategoriId, katCId);
});

test('Pindah DALAM kumpulan sama (A -> B, neutral) tak disekat had kumpulan', async () => {
  const { status } = await api('/api/waran-pindah', {
    method: 'POST', body: JSON.stringify({ bulan: BULAN, kategoriDariId: katAId, kategoriKeId: katBId, jumlah: 200, sebab: 'test dalam kumpulan' })
  });
  assert.strictEqual(status, 201);
});

test('Pindah SILANG kumpulan yang buatkan kumpulan melebihi had -> ditolak (400)', async () => {
  // Kumpulan (A+B) masih tepat RM2000 (neutral lepas pindah dalam-kumpulan). Cuba tambah dari C.
  const { status, data } = await api('/api/waran-pindah', {
    method: 'POST', body: JSON.stringify({ bulan: BULAN, kategoriDariId: katCId, kategoriKeId: katAId, jumlah: 100, sebab: 'test silang kumpulan' })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.includes('kumpulan'));
});

test('Pinjam Dana Luar Biasa ke kategori dalam kumpulan yang dah penuh -> ditolak (400)', async () => {
  const { status, data } = await api('/api/dana-luar-biasa/pinjam', {
    method: 'POST', body: JSON.stringify({ kategoriId: katAId, bulan: BULAN, jumlah: 50, sebab: 'test pinjam kumpulan penuh' })
  });
  assert.strictEqual(status, 400);
  assert.ok(data.error.includes('kumpulan'));
});

test('Pinjam Dana Luar Biasa ke kategori C (tiada kumpulan) -> berjaya', async () => {
  const { status, data } = await api('/api/dana-luar-biasa/pinjam', {
    method: 'POST', body: JSON.stringify({ kategoriId: katCId, bulan: BULAN, jumlah: 50, sebab: 'test pinjam C' })
  });
  assert.strictEqual(status, 201);
  await api(`/api/dana-luar-biasa/${data.id}/bayar`, { method: 'POST', body: JSON.stringify({ bulan: BULAN }) });
});

test('kemas kini peratus kumpulan (PATCH) berjaya', async () => {
  const { status, data } = await api(`/api/kumpulan/${kumId}`, {
    method: 'PATCH', body: JSON.stringify({ nama: `TEST_KUM_${suffix}`, peratus: 10 })
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.peratus, 10);
});

test('padam kumpulan -> ahli dipindah ke Belum Berkumpulan', async () => {
  const { status } = await api(`/api/kumpulan/${kumId}`, { method: 'DELETE' });
  assert.strictEqual(status, 204);
  const { data } = await api('/api/kategori-perbelanjaan');
  const a = data.find(k => k.id === katAId);
  const b = data.find(k => k.id === katBId);
  assert.strictEqual(a.kumpulanId, null);
  assert.strictEqual(b.kumpulanId, null);
});

// ---- Pintasan ----
test('cipta pintasan', async () => {
  const { status, data } = await api('/api/pintasan', {
    method: 'POST', body: JSON.stringify({ label: `TEST_PINTASAN_${suffix}`, kategoriId: katCId })
  });
  assert.strictEqual(status, 201);
  pintasanId = data.id;
});

test('senarai pintasan mengandungi pintasan baharu', async () => {
  const { data } = await api('/api/pintasan');
  assert.ok(data.some(p => p.id === pintasanId));
});

test('edit pintasan', async () => {
  const { status, data } = await api(`/api/pintasan/${pintasanId}`, {
    method: 'PATCH', body: JSON.stringify({ label: `TEST_PINTASAN_EDIT_${suffix}`, kategoriId: katAId })
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.label, `TEST_PINTASAN_EDIT_${suffix}`);
});

test('padam pintasan', async () => {
  const { status } = await api(`/api/pintasan/${pintasanId}`, { method: 'DELETE' });
  assert.strictEqual(status, 204);
});

test('bersihkan: kosongkan kotak semua kategori test dan cuba padam', async () => {
  for (const id of [katAId, katBId, katCId]) {
    await api('/api/belanjawan', { method: 'PUT', body: JSON.stringify({ kategoriId: id, bulan: BULAN, jumlah: 0 }) });
  }
  // Mungkin gagal (400) kalau masih ada Waran/pinjaman bersandar — EXPECTED,
  // sama macam tests/perbelanjaan.test.js (Waran memang kekal sengaja).
  for (const id of [katAId, katBId, katCId]) {
    await api(`/api/kategori-perbelanjaan/${id}`, { method: 'DELETE' });
  }
});
