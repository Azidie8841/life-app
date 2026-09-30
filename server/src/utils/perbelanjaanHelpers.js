// Helper kongsi untuk modul Perbelanjaan — dipanggil dari belanjawan.js,
// waran-pindah.js, dana-luar-biasa.js, dan perbelanjaan.js. Semua fungsi
// terima `client` (bukan `pool`) supaya boleh dipanggil DALAM satu database
// transaction yang sedang berjalan (BEGIN...COMMIT), pastikan semakan
// konsisten dengan perubahan yang belum commit dalam transaction yang sama.

// Pulangkan senarai kategori Wajib yang kotak dia masih 0 (atau tiada langsung) bagi bulan tu.
async function wajibBelumTerisi(client, bulan) {
  const result = await client.query(
    `SELECT k.id, k.nama
     FROM kategori_perbelanjaan k
     LEFT JOIN belanjawan b ON b.kategori_id = k.id AND b.bulan = $1
     WHERE k.jenis = 'wajib' AND COALESCE(b.jumlah_belanjawan, 0) <= 0`,
    [bulan]
  );
  return result.rows;
}

// Pulangkan senarai SEMUA kategori (Wajib + Boleh Laras) yang kotak dia
// masih 0 bagi bulan tu — dipakai untuk gate "isi bajet dulu" sebelum
// Tambah Perbelanjaan / Pindah / Pinjam dibenarkan untuk bulan tersebut.
async function bajetBelumLengkap(client, bulan) {
  const result = await client.query(
    `SELECT k.id, k.nama
     FROM kategori_perbelanjaan k
     LEFT JOIN belanjawan b ON b.kategori_id = k.id AND b.bulan = $1
     WHERE COALESCE(b.jumlah_belanjawan, 0) <= 0`,
    [bulan]
  );
  return result.rows;
}

// Jumlah pinjaman AKTIF (belum_dibayar) yang disalurkan ke satu kategori pada satu bulan.
async function pinjamanAktifDalamKotak(client, kategoriId, bulan) {
  const result = await client.query(
    `SELECT COALESCE(SUM(jumlah), 0) AS jumlah
     FROM pinjaman_luar_biasa
     WHERE kategori_id = $1 AND bulan_pinjam = $2 AND status = 'belum_dibayar'`,
    [kategoriId, bulan]
  );
  return parseFloat(result.rows[0].jumlah);
}

// Jumlah Hasil (pendapatan) direkodkan bagi satu bulan — guna medan "tarikh".
async function getHasilBulan(client, bulan) {
  const result = await client.query(
    `SELECT COALESCE(SUM(jumlah), 0) AS jumlah FROM hasil WHERE to_char(tarikh, 'YYYY-MM') = $1`,
    [bulan]
  );
  return parseFloat(result.rows[0].jumlah);
}

// Bajet kumpulan (RM) = peratus/100 * Hasil bulan tu.
async function getBajetKumpulan(client, kumpulanId, bulan) {
  const kumResult = await client.query('SELECT peratus FROM kumpulan_perbelanjaan WHERE id = $1', [kumpulanId]);
  if (!kumResult.rows.length) return 0;
  const hasil = await getHasilBulan(client, bulan);
  return (parseFloat(kumResult.rows[0].peratus) / 100) * hasil;
}

// Jumlah kotak (belanjawan) SEMUA kategori ahli kumpulan tu bagi bulan tu.
async function getTerperuntukKumpulan(client, kumpulanId, bulan) {
  const result = await client.query(
    `SELECT COALESCE(SUM(b.jumlah_belanjawan), 0) AS jumlah
     FROM kategori_perbelanjaan k
     LEFT JOIN belanjawan b ON b.kategori_id = k.id AND b.bulan = $2
     WHERE k.kumpulan_id = $1`,
    [kumpulanId, bulan]
  );
  return parseFloat(result.rows[0].jumlah);
}

// Semak had kumpulan: kalau kategori ni ahli sesebuah kumpulan, dan tetapkan
// kotak dia ke `jumlahBaharu` akan buatkan jumlah kotak SELURUH kumpulan
// melebihi bajet kumpulan (peratus x Hasil), pulangkan mesej ralat. Pulangkan
// null kalau tiada masalah (termasuk kategori tiada kumpulan langsung).
async function semakHadKumpulan(client, kategoriId, jumlahBaharu, bulan) {
  const kategoriResult = await client.query('SELECT kumpulan_id FROM kategori_perbelanjaan WHERE id = $1', [kategoriId]);
  if (!kategoriResult.rows.length) return null;
  const kumpulanId = kategoriResult.rows[0].kumpulan_id;
  if (!kumpulanId) return null;

  const kumResult = await client.query('SELECT nama FROM kumpulan_perbelanjaan WHERE id = $1', [kumpulanId]);
  if (!kumResult.rows.length) return null;

  const kotakSediaAdaResult = await client.query(
    'SELECT jumlah_belanjawan FROM belanjawan WHERE kategori_id = $1 AND bulan = $2',
    [kategoriId, bulan]
  );
  const kotakSediaAda = kotakSediaAdaResult.rows.length ? parseFloat(kotakSediaAdaResult.rows[0].jumlah_belanjawan) : 0;

  const terperuntuk = await getTerperuntukKumpulan(client, kumpulanId, bulan);
  const lainDalamKumpulan = terperuntuk - kotakSediaAda;
  const jumlahKumpulanBaharu = lainDalamKumpulan + jumlahBaharu;
  const bajetKumpulan = await getBajetKumpulan(client, kumpulanId, bulan);

  if (jumlahKumpulanBaharu > bajetKumpulan) {
    const fmt = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `Bajet kumpulan "${kumResult.rows[0].nama}" dah capai had (${fmt(bajetKumpulan)}) — jumlah ni buatkan kumpulan jadi ${fmt(jumlahKumpulanBaharu)}. Kurangkan jumlah, atau pindahkan peruntukan dari kategori lain dalam kumpulan yang sama dulu.`;
  }
  return null;
}

module.exports = {
  wajibBelumTerisi,
  bajetBelumLengkap,
  pinjamanAktifDalamKotak,
  getHasilBulan,
  getBajetKumpulan,
  getTerperuntukKumpulan,
  semakHadKumpulan
};
