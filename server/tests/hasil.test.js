// Test automatik untuk modul Hasil — sama pola dengan api.test.js
const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.APP_PASSWORD || 'P@ssw0rd';

let sessionCookie = '';

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {})
    },
    ...options
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';')[0];
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

let hasilId;
const BULAN_TEST = '2026-09';

test('login dahulu untuk sesi ujian Hasil', async () => {
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD })
  });
  assert.strictEqual(status, 200);
});

test('akses /api/hasil tanpa login ditolak', async () => {
  const savedCookie = sessionCookie;
  sessionCookie = '';
  const { status } = await api('/api/hasil');
  sessionCookie = savedCookie;
  assert.strictEqual(status, 401);
});

test('tambah rekod hasil TANPA sumber ditolak (400)', async () => {
  const { status } = await api('/api/hasil', {
    method: 'POST',
    body: JSON.stringify({ kategori: 'Gaji', jumlah: 100, tarikh: `${BULAN_TEST}-01` })
  });
  assert.strictEqual(status, 400);
});

test('tambah rekod hasil dengan jumlah 0 ditolak (400)', async () => {
  const { status } = await api('/api/hasil', {
    method: 'POST',
    body: JSON.stringify({ sumber: 'Test', kategori: 'Gaji', jumlah: 0, tarikh: `${BULAN_TEST}-01` })
  });
  assert.strictEqual(status, 400);
});

test('tambah rekod hasil yang sah berjaya', async () => {
  const { status, data } = await api('/api/hasil', {
    method: 'POST',
    body: JSON.stringify({
      sumber: 'Syarikat Ujian',
      kategori: 'Gaji',
      jumlah: 4000,
      tarikh: `${BULAN_TEST}-01`,
      nota: 'test automatik'
    })
  });
  assert.strictEqual(status, 201);
  assert.strictEqual(data.jumlah, '4000.00');
  hasilId = data.id;
});

test('senarai hasil mengandungi rekod yang baru ditambah', async () => {
  const { status, data } = await api('/api/hasil');
  assert.strictEqual(status, 200);
  assert.ok(data.some(h => h.id === hasilId));
});

test('ringkasan bulan mengira jumlah dengan betul', async () => {
  const { status, data } = await api('/api/hasil/ringkasan?bulan=' + BULAN_TEST);
  assert.strictEqual(status, 200);
  assert.strictEqual(data.bulan, BULAN_TEST);
  assert.ok(data.jumlah_keseluruhan >= 4000);
  assert.ok(data.mengikut_kategori.some(k => k.kategori === 'Gaji'));
});

test('edit rekod hasil berjaya dan kemas kini nilai', async () => {
  const { status, data } = await api('/api/hasil/' + hasilId, {
    method: 'PATCH',
    body: JSON.stringify({
      sumber: 'Syarikat Ujian',
      kategori: 'Gaji',
      jumlah: 4500,
      tarikh: `${BULAN_TEST}-01`,
      nota: 'sudah diedit'
    })
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.jumlah, '4500.00');
});

test('padam rekod hasil berjaya', async () => {
  const { status } = await api('/api/hasil/' + hasilId, { method: 'DELETE' });
  assert.strictEqual(status, 204);
});

test('rekod yang dipadam tiada lagi dalam senarai', async () => {
  const { data } = await api('/api/hasil');
  assert.ok(!data.some(h => h.id === hasilId));
});
