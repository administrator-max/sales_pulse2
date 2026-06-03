// =============================================================================
// check-connection.js — diagnosa koneksi ke Google Sheets.
// Jalankan: node check-connection.js
// Memverifikasi: kredensial → auth → akses spreadsheet → baca tiap tab.
// =============================================================================

const path = require('path');
const fs   = require('fs');

(function loadEnv() {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) { require('dotenv').config({ path: p }); console.log(`[env] loaded ${p}`); return; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
})();

const repo = require('./sheetsRepo');

(async () => {
  console.log('Spreadsheet ID :', repo.SPREADSHEET_ID || '(BELUM DI-SET)');
  try {
    // 1) Auth + identitas service account
    const sheets = await repo.getSheets();
    console.log('Auth           : ✅ kredensial service account ter-load');

    // 2) Akses metadata spreadsheet
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: repo.SPREADSHEET_ID,
      fields: 'properties.title,sheets.properties.title',
    });
    console.log('Spreadsheet    : ✅ "' + meta.data.properties.title + '"');
    const tabs = meta.data.sheets.map(s => s.properties.title);
    console.log('Tabs ditemukan :', tabs.join(', '));

    // 3) Baca tiap tabel yang dipakai aplikasi + hitung baris
    console.log('\nCek baca tiap tabel aplikasi:');
    let allOk = true;
    for (const name of Object.keys(repo.TABLES)) {
      try {
        const rows = await repo.getTable(name);
        const present = tabs.includes(name);
        console.log(`  ${present ? '✅' : '⚠️ '} ${name.padEnd(16)} : ${rows.length} baris${present ? '' : '  (tab tidak ada di spreadsheet)'}`);
        if (!present) allOk = false;
      } catch (e) {
        allOk = false;
        console.log(`  ❌ ${name.padEnd(16)} : ${e.message}`);
      }
    }

    console.log(allOk
      ? '\n✅ KONEKSI OK — semua tab terbaca. Siap dijalankan: npm start'
      : '\n⚠️  Terhubung, tapi ada tab yang hilang/bermasalah (lihat di atas).');
  } catch (err) {
    console.error('\n❌ GAGAL konek:', err.message);
    const hint = {
      'does not have permission': 'Spreadsheet belum di-share ke email service account (client_email) sebagai Editor.',
      'has not been used': 'Google Sheets API belum di-enable di project Google Cloud.',
      'not found': 'SPREADSHEET_ID salah / spreadsheet tidak ada.',
      'tidak ditemukan': 'File service-account.json tidak ditemukan — cek path GOOGLE_SERVICE_ACCOUNT_JSON.',
    };
    for (const [k, v] of Object.entries(hint)) if (err.message.toLowerCase().includes(k.toLowerCase())) console.error('   → ' + v);
    process.exit(1);
  }
})();
