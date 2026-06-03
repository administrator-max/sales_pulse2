// =============================================================================
// migrate-to-sheets.js — migrasi SEKALI JALAN: Neon Postgres → Google Sheets.
//
// Membaca 7 tabel dari Postgres (pakai kredensial PG yang masih ada di .env),
// membuat tab yang belum ada di spreadsheet, lalu menulis seluruh isinya.
// Idempotent: aman dijalankan ulang (tab di-replace penuh tiap run).
//
// Jalankan:  node migrate-to-sheets.js
//
// Prasyarat env: PGHOST/PGDATABASE/PGUSER/PGPASSWORD (atau DATABASE_URL),
//                SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON.
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
  console.warn('[env] .env not found — relying on process env only');
})();

const { Pool } = require('pg');
const repo = require('./sheetsRepo');

// Tab → query sumber di Postgres. Urutan kolom mengikuti skema di sheetsRepo.
const SOURCES = {
  monthly_actuals: 'SELECT month_idx, year, actual_margin, plan_margin, revenue, notes, updated_at FROM monthly_actuals ORDER BY year, month_idx',
  plan_revisions:  'SELECT id, month_idx, year, name, margin, revenue, notes, qty, ts, created_at FROM plan_revisions ORDER BY id',
  budget_lines:    'SELECT id, year, month_idx, segment, product, volume_mt, revenue_idr, margin_idr, updated_at FROM budget_lines ORDER BY id',
  products:        'SELECT canonical_name, macro_category, display_order FROM products ORDER BY display_order, canonical_name',
  product_aliases: 'SELECT alias, canonical_name FROM product_aliases ORDER BY alias',
  ps_headers:      'SELECT ps_number, dashboard_month_idx, dashboard_year, project_code, project_name, subsidiary, customer_name, supplier_name, po_date, currency, fx_rate, net_margin_native, sales_revenue, purchase_cost, margin, margin_percentage, product, segment, notes, created_at FROM ps_headers ORDER BY ps_number',
  ps_items:        'SELECT id, ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg, created_at FROM ps_items ORDER BY id',
};

async function main() {
  // PENGAMAN: spreadsheet sudah berisi data live (lebih baru dari Neon).
  // Migrasi akan MENIMPA seluruh isi tab — hanya jalan jika diberi flag --force.
  if (!process.argv.includes('--force')) {
    console.error([
      '⛔ Migrasi DIBATALKAN.',
      '   Spreadsheet target kemungkinan sudah berisi data live yang lebih baru dari Neon.',
      '   Menjalankan migrasi akan MENIMPA seluruh isi tab di spreadsheet.',
      '   Jika kamu benar-benar yakin (mis. spreadsheet masih kosong), jalankan ulang dengan:',
      '       node migrate-to-sheets.js --force',
    ].join('\n'));
    process.exit(1);
  }

  const sslMode = (process.env.PGSSL || 'require').toLowerCase();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });

  console.log('[migrate] memastikan tab ada di spreadsheet…');
  const added = await repo.ensureTabs();
  if (added.length) console.log(`[migrate] tab dibuat: ${added.join(', ')}`);

  for (const [tab, sql] of Object.entries(SOURCES)) {
    process.stdout.write(`[migrate] ${tab} … `);
    let rows;
    try {
      const r = await pool.query(sql);
      rows = r.rows;
    } catch (e) {
      console.log(`SKIP (query gagal: ${e.message})`);
      continue;
    }
    // qty (JSONB) sudah jadi object dari pg; po_date jadi Date — sheetsRepo handle.
    await repo.replaceTable(tab, rows);
    console.log(`${rows.length} baris ✓`);
  }

  await pool.end();
  console.log('[migrate] selesai. Spreadsheet sekarang berisi seluruh data.');
}

main().catch(err => {
  console.error('[migrate] GAGAL:', err);
  process.exit(1);
});
