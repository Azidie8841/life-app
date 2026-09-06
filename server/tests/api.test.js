// Test automatik — jalankan SEMUA senario yang kita test manual tadi
// (login, tambah, edit, padam, tolak baki negatif) secara automatik.
//
// Guna "node:test" — built-in dalam Node.js sejak versi 18, jadi TAK
// perlu install package tambahan (contoh: Jest, Mocha) untuk test asas.
//
// PENTING: test yang UBAH DUIT di sini cipta AKAUN SEMENTARA sendiri
// (bukan guna akaun sebenar Adi) dan padam balik lepas siap — supaya
// data kewangan sebenar Adi dalam local dev langsung tak tersentuh,
// dan keputusan test boleh dipercayai tak kira apa data sedia ada
// dalam akaun-akaun lain.
//
// Cara jalan: npm test (dalam folder server/)

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

let testAccountId, txnAddId, txnWithdrawId;

test('health check boleh diakses tanpa login', async () => {
  const { status, data } = await api('/api/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(data.ok, true);
});

test('akses akaun TANPA login ditolak (401)', async () => {
  const { status } = await api('/api/accounts');
  assert.strictEqual(status, 401);
});

test('login dengan password SALAH ditolak (401)', async () => {
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'password-yang-salah' })
  });
  assert.strictEqual(status, 401);
});

test('login dengan password BETUL berjaya', async () => {
  const { status, data } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD })
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.ok, true);
});

// Cipta akaun KHAS untuk test ni — nama unik guna timestamp supaya tak
// pernah bertembung dengan akaun sebenar Adi walaupun test run berkali-kali.
test('cipta akaun sementara untuk ujian (diasingkan dari data sebenar)', async () => {
  const { status, data } = await api('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'TEST_AUTOMATED_' + Date.now() })
  });
  assert.strictEqual(status, 201);
  assert.strictEqual(data.balance, '0.00');
  testAccountId = data.id;
});

test('tambah dana menaikkan baki (akaun ujian, mula dari 0)', async () => {
  const { status, data } = await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ accountId: testAccountId, type: 'add', amount: 1000, reason: 'test add' })
  });
  if (data && data.id) txnAddId = data.id; // simpan ID DULU, sebelum assert — elak cascading failure
  assert.strictEqual(status, 201);
  assert.strictEqual(data.balance_after, '1000.00');
});

test('keluar TANPA sebab ditolak (400)', async () => {
  const { status } = await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ accountId: testAccountId, type: 'withdraw', amount: 100 })
  });
  assert.strictEqual(status, 400);
});

test('keluar LEBIH dari baki ditolak (400)', async () => {
  const { status } = await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ accountId: testAccountId, type: 'withdraw', amount: 99999, reason: 'test' })
  });
  assert.strictEqual(status, 400);
});

test('keluar yang sah berjaya dan kurangkan baki', async () => {
  const { status, data } = await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ accountId: testAccountId, type: 'withdraw', amount: 600, reason: 'test withdraw' })
  });
  if (data && data.id) txnWithdrawId = data.id; // simpan ID DULU, sebelum assert
  assert.strictEqual(status, 201);
  assert.strictEqual(data.balance_after, '400.00');
});

test('padam transaksi yang menyebabkan baki negatif DITOLAK', async () => {
  const { status } = await api('/api/transactions/' + txnAddId, { method: 'DELETE' });
  assert.strictEqual(status, 400);
});

test('padam transaksi terkini BERJAYA dan kira semula baki', async () => {
  const { status } = await api('/api/transactions/' + txnWithdrawId, { method: 'DELETE' });
  assert.strictEqual(status, 200);

  const { data } = await api('/api/accounts');
  const acc = data.find(a => a.id === testAccountId);
  assert.strictEqual(acc.balance, '1000.00');
});

test('edit transaksi kira semula baki dengan betul', async () => {
  const { status } = await api('/api/transactions/' + txnAddId, {
    method: 'PATCH',
    body: JSON.stringify({ amount: 500, reason: 'sudah diedit' })
  });
  assert.strictEqual(status, 200);

  const { data } = await api('/api/accounts');
  const acc = data.find(a => a.id === testAccountId);
  assert.strictEqual(acc.balance, '500.00');
});

// Bersihkan — kosongkan baki (padam transaksi terakhir) dan padam akaun ujian,
// supaya senarai "Tempat simpanan" Adi tak berselerak dengan akaun test.
test('bersihkan: kosongkan baki dan padam akaun ujian', async () => {
  await api('/api/transactions/' + txnAddId, { method: 'DELETE' });

  const { status } = await api('/api/accounts/' + testAccountId, { method: 'DELETE' });
  assert.strictEqual(status, 204);
});

test('logout menutup akses semula', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  const { status } = await api('/api/accounts');
  assert.strictEqual(status, 401);
});
