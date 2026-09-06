// Helper kongsi untuk modul Perbelanjaan — dipanggil dari belanjawan.js,
// waran-pindah.js, dan dana-luar-biasa.js. Semua fungsi terima `client`
// (bukan `pool`) supaya boleh dipanggil DALAM satu database transaction
// yang sedang berjalan (BEGIN...COMMIT), pastikan semakan konsisten
// dengan perubahan yang belum commit dalam transaction yang sama.

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

module.exports = { wajibBelumTerisi, pinjamanAktifDalamKotak };
