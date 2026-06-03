// =============================================================================
// sheetsRepo.js — Google Sheets sebagai data store (pengganti Neon Postgres).
//
// Setiap "tabel" Postgres = satu tab (sheet) di spreadsheet. Baris 1 = header
// (nama kolom), baris berikutnya = data. Karena Sheets tidak punya transaksi,
// pola tulis di sini adalah "read-modify-write seluruh tab" yang diserialisasi
// lewat satu write-lock global per proses — cukup untuk dashboard single-node.
//
// Auth: service account. Kredensial dibaca dari env:
//   - GOOGLE_SERVICE_ACCOUNT_JSON  → bisa inline JSON, atau path ke file .json
//   - GOOGLE_APPLICATION_CREDENTIALS → path file (fallback standar google-auth)
//   - SPREADSHEET_ID               → ID spreadsheet target
// Spreadsheet WAJIB di-share (Editor) ke email service account.
// =============================================================================

const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ── Skema tab: urutan kolom + tipe. Dipakai untuk coerce baca & tulis. ─────────
// Tipe: 'int' | 'float' | 'string' | 'date' | 'json'
// Kolom ber-id ('int' bernama 'id') akan di-autoincrement saat tulis bila kosong.
const TABLES = {
  // Urutan kolom mengikuti spreadsheet existing (year sebelum month_idx).
  monthly_actuals: {
    columns: [
      ['year', 'int'], ['month_idx', 'int'],
      ['actual_margin', 'float'], ['plan_margin', 'float'], ['revenue', 'float'],
      ['notes', 'string'], ['updated_at', 'string'],
    ],
  },
  plan_revisions: {
    columns: [
      ['id', 'int'], ['year', 'int'], ['month_idx', 'int'],
      ['name', 'string'], ['margin', 'float'], ['revenue', 'float'],
      ['notes', 'string'], ['qty', 'json'], ['ts', 'string'], ['created_at', 'string'],
    ],
    autoId: 'id',
  },
  budget_lines: {
    columns: [
      ['id', 'int'], ['year', 'int'], ['month_idx', 'int'],
      ['segment', 'string'], ['product', 'string'],
      ['volume_mt', 'float'], ['revenue_idr', 'float'], ['margin_idr', 'float'],
      ['updated_at', 'string'],
    ],
    autoId: 'id',
  },
  products: {
    columns: [
      ['canonical_name', 'string'], ['macro_category', 'string'], ['display_order', 'int'],
    ],
  },
  product_aliases: {
    columns: [
      ['alias', 'string'], ['canonical_name', 'string'],
    ],
  },
  ps_headers: {
    columns: [
      ['ps_number', 'string'], ['dashboard_year', 'int'], ['dashboard_month_idx', 'int'],
      ['project_code', 'string'], ['project_name', 'string'], ['subsidiary', 'string'],
      ['customer_name', 'string'], ['supplier_name', 'string'], ['po_date', 'date'],
      ['currency', 'string'], ['fx_rate', 'float'], ['net_margin_native', 'float'],
      ['sales_revenue', 'float'], ['purchase_cost', 'float'],
      ['margin', 'float'], ['margin_percentage', 'float'],
      ['product', 'string'], ['segment', 'string'], ['notes', 'string'],
      ['created_at', 'string'],
    ],
  },
  // ps_items menyimpan kolom denormalisasi (dashboard_year/month_idx/project_name)
  // agar tab enak dibaca manusia — diisi otomatis saat PS disimpan.
  ps_items: {
    columns: [
      ['id', 'int'], ['ps_number', 'string'],
      ['dashboard_year', 'int'], ['dashboard_month_idx', 'int'], ['project_name', 'string'],
      ['item_no', 'int'],
      ['material', 'string'], ['size', 'string'], ['length', 'string'],
      ['qty_val', 'float'], ['qty_unit', 'string'],
      ['total_weight_kg', 'float'], ['purchase_price_kg', 'float'],
      ['created_at', 'string'],
    ],
    autoId: 'id',
  },
};

// ── Auth & client (lazy singleton) ────────────────────────────────────────────
let _sheets = null;

// Cari file kredensial: absolut → pakai; relatif → coba dari cwd lalu telusuri
// folder induk dari __dirname (penting untuk git worktree — file ada di root project).
function resolveCredPath(p) {
  const path = require('path');
  if (path.isAbsolute(p)) return fs.existsSync(p) ? p : null;
  const fromCwd = path.resolve(process.cwd(), p);
  if (fs.existsSync(fromCwd)) return fromCwd;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, p);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    const trimmed = raw.trim();
    // Inline JSON?
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    // Else: perlakukan sebagai path file (relatif/absolut)
    const resolved = resolveCredPath(trimmed);
    if (resolved) return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid dan file tidak ditemukan: ${trimmed}`);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const resolved = resolveCredPath(credPath);
    if (resolved) return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }
  throw new Error('Kredensial service account tidak ditemukan. Set GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON atau path file).');
}

async function getSheets() {
  if (_sheets) return _sheets;
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID belum di-set di environment.');
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  _sheets = google.sheets({ version: 'v4', auth: client });
  return _sheets;
}

// ── Coercion ──────────────────────────────────────────────────────────────────
function parseCell(value, type) {
  if (value === undefined || value === null || value === '') {
    return type === 'json' ? {} : null;
  }
  switch (type) {
    case 'int': {
      const n = parseInt(value, 10);
      return Number.isNaN(n) ? null : n;
    }
    case 'float': {
      const n = parseFloat(value);
      return Number.isNaN(n) ? null : n;
    }
    case 'json':
      try { return typeof value === 'string' ? JSON.parse(value) : value; }
      catch { return {}; }
    case 'date':
    case 'string':
    default:
      return String(value);
  }
}

function serializeCell(value, type) {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'json') {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return ''; }
  }
  if (type === 'int' || type === 'float') {
    const n = Number(value);
    return Number.isNaN(n) ? '' : n;            // tulis sebagai angka asli di Sheets
  }
  if (type === 'date') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);          // 'YYYY-MM-DD'
  }
  return value; // string tetap string (valueInputOption RAW → tidak di-parse Sheets)
}

// ── Low-level read/write ──────────────────────────────────────────────────────
function colLetter(n) {
  // 1 → A, 26 → Z, 27 → AA ...
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Baca seluruh tab → array of row objects (sudah di-coerce sesuai skema).
 * Mapping kolom berdasarkan HEADER di baris 1 (toleran urutan/kolom ekstra),
 * fallback ke urutan skema bila header tidak cocok.
 */
async function getTable(name) {
  const schema = TABLES[name];
  if (!schema) throw new Error(`Tabel tidak dikenal: ${name}`);
  const sheets = await getSheets();
  const lastCol = colLetter(schema.columns.length + 5); // sedikit buffer
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A1:${lastCol}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = res.data.values || [];
  if (values.length === 0) return [];
  const headerRow = values[0].map(h => String(h || '').trim());
  const typeByCol = Object.fromEntries(schema.columns.map(([c, t]) => [c, t]));

  // Index kolom → nama field, berdasarkan header sheet.
  const fieldByIdx = headerRow.map(h => (typeByCol[h] !== undefined ? h : null));
  // Jika header kosong/tidak cocok sama sekali, pakai urutan skema.
  const useSchemaOrder = fieldByIdx.every(f => f === null);

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    if (row.every(c => c === '' || c === null || c === undefined)) continue; // skip baris kosong
    const obj = {};
    if (useSchemaOrder) {
      schema.columns.forEach(([col, type], i) => { obj[col] = parseCell(row[i], type); });
    } else {
      fieldByIdx.forEach((col, i) => { if (col) obj[col] = parseCell(row[i], typeByCol[col]); });
      // pastikan semua kolom skema ada (null kalau absen)
      schema.columns.forEach(([col, type]) => { if (!(col in obj)) obj[col] = type === 'json' ? {} : null; });
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Tulis SELURUH tab (header + semua baris). Clear dulu lalu update — sehingga
 * baris sisa dari data lama tidak tertinggal. Untuk tab ber-autoId, baris tanpa
 * id akan diberi id berurutan (max id existing + 1).
 */
async function replaceTable(name, rows) {
  const schema = TABLES[name];
  if (!schema) throw new Error(`Tabel tidak dikenal: ${name}`);
  const sheets = await getSheets();

  // Autoincrement id bila perlu
  let working = rows;
  if (schema.autoId) {
    let maxId = 0;
    rows.forEach(r => { const v = parseInt(r[schema.autoId], 10); if (!Number.isNaN(v) && v > maxId) maxId = v; });
    working = rows.map(r => {
      const cur = parseInt(r[schema.autoId], 10);
      if (Number.isNaN(cur)) return { ...r, [schema.autoId]: ++maxId };
      return r;
    });
  }

  const header = schema.columns.map(([c]) => c);
  const matrix = [header];
  working.forEach(r => {
    matrix.push(schema.columns.map(([col, type]) => serializeCell(r[col], type)));
  });

  const lastCol = colLetter(schema.columns.length);
  // Clear range data (sampai banyak baris) lalu tulis ulang.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A1:${lastCol}`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: matrix },
  });
  return working;
}

// ── Write lock (serialisasi tulis, ganti transaksi) ───────────────────────────
let _writeChain = Promise.resolve();
function withWriteLock(fn) {
  const run = _writeChain.then(fn, fn);
  _writeChain = run.then(() => {}, () => {}); // jangan biarkan rejection memutus chain
  return run;
}

// ── Bootstrap: pastikan semua tab ada (dipakai migrasi) ───────────────────────
async function ensureTabs() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set((meta.data.sheets || []).map(s => s.properties.title));
  const toAdd = Object.keys(TABLES).filter(t => !existing.has(t));
  if (toAdd.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: toAdd.map(title => ({ addSheet: { properties: { title } } })) },
    });
  }
  return toAdd;
}

async function ping() {
  const sheets = await getSheets();
  await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'spreadsheetId' });
  return true;
}

module.exports = {
  TABLES,
  SPREADSHEET_ID,
  getTable,
  replaceTable,
  withWriteLock,
  ensureTabs,
  ping,
  getSheets,
};
