const path = require('path');
const fs   = require('fs');

// Load .env: cari di worktree dulu, lalu di parent dirs (root project).
// Penting buat git worktree — .env biasanya cuma ada di root.
(function loadEnv() {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p });
      console.log(`[env] loaded ${p}`);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  console.warn('[env] .env not found — relying on process env only');
})();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Anti-crawl / Anti-indexing middleware ─────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, nocache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Disallow: /',
    '',
    'User-agent: Googlebot',
    'Disallow: /',
    '',
    'User-agent: Bingbot',
    'Disallow: /',
    '',
    'User-agent: GPTBot',
    'Disallow: /',
    '',
    'User-agent: CCBot',
    'Disallow: /',
    '',
    'User-agent: anthropic-ai',
    'Disallow: /',
    '',
    'User-agent: Claude-Web',
    'Disallow: /',
  ].join('\n'));
});

// Block known AI / SEO crawlers
app.use((req, res, next) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const blockedBots = [
    'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
    'yandexbot', 'sogou', 'exabot', 'facebot', 'ia_archiver',
    'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'rogerbot',
    'screaming frog', 'gptbot', 'ccbot', 'anthropic-ai', 'claude-web',
    'bytespider', 'petalbot', 'applebot', 'archive.org_bot',
  ];
  if (blockedBots.some(bot => ua.includes(bot))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

// ── Page routes (BEFORE static so / is not intercepted by index.html) ─────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'executive.html'));
});
app.get('/executive', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'executive.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  // JS/CSS sering berubah saat audit dashboard, jadi revalidate agar UI tidak stale.
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// ── Postgres pool ────────────────────────────────────────────────────────────
// pg library auto-pickup: PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT
// SSL: PGSSL=require → on (Neon), PGSSL=disable → off (localhost)
const sslMode = (process.env.PGSSL || 'require').toLowerCase();

const pool = new Pool({
  // Pakai DATABASE_URL kalau ada; kalau tidak, jatuh ke PGHOST/PGUSER/dst
  connectionString: process.env.DATABASE_URL || undefined,
  ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false },
  max: parseInt(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  // Neon serverless suspend setelah ~5 min idle, wake-up bisa makan ~5-10s
  connectionTimeoutMillis: 30_000,
  // TCP keepalive supaya pooler tidak drop koneksi long-lived
  keepAlive: true,
});

console.log(`[pg] host=${process.env.PGHOST || '(from DATABASE_URL)'}  db=${process.env.PGDATABASE || '?'}  ssl=${sslMode}`);

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err);
});

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const COLORS = ['#f59e0b', '#a78bfa', '#22d3ee', '#4ade80', '#fb923c', '#818cf8', '#38bdf8'];

// ── Internal group companies (PS-issuing SPVs) ────────────────────────────────
// Sumber: config/company-rank-exclusions.json. Saat salah satu entitas ini muncul
// sebagai "customer", itu leg intercompany (bukan end-customer asli), jadi tidak
// dihitung di ranking customer — project di-roll-up ke customer eksternal (konsolidasi).
const normCompany = (s) =>
  String(s || '').toLowerCase().replace(/\bpt\.?\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const INTERNAL_COMPANIES = (() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'company-rank-exclusions.json'), 'utf8'));
    const names = (cfg.companies || []).map(c => normCompany(c.companyName)).filter(Boolean);
    console.log(`[config] loaded ${names.length} internal companies for customer roll-up`);
    return names;
  } catch (e) {
    console.warn('[config] company-rank-exclusions.json not loaded:', e.message);
    return [];
  }
})();

function isInternalCompany(name) {
  const n = normCompany(name);
  return !!n && INTERNAL_COMPANIES.some(inm => n === inm || n.includes(inm));
}

// End-customer dari nama project. Konvensi: "{Project} - Del. {Bulan Tahun} - {Customer}".
// Dipakai saat semua header leg customer-nya internal (mis. Amber → SPV grup), tapi
// end-customer asli tertulis di ekor nama project.
function endCustomerFromName(projectName) {
  const parts = String(projectName || '').split(' - ');
  if (parts.length < 2) return '';
  const tail = parts[parts.length - 1].trim();
  return /[a-z]/i.test(tail) ? tail : '';   // harus mengandung huruf (bukan token tanggal/angka)
}

// Base project family: buang " - Del. {bulan} {tahun} - {customer}" → cuma nama proyek inti.
// Dipakai untuk resolve leg internal ke end-customer kanonik dari PS sibling se-family
// (mis. "Arsen 57 - … - PTJ" → ambil "PT. Pilar Teknindo Jaya" dari sibling "Arsen 57").
function projectFamilyKey(projectName) {
  return String(projectName || '').split(/\s-\s*del\b/i)[0].trim().toLowerCase().replace(/\s+/g, ' ');
}

// Consolidated end-customer untuk satu project group:
//  1) customer EKSTERNAL paling sering di antara header-nya;
//  2) semua internal → kalau family-nya punya TEPAT 1 customer eksternal, pakai itu (kanonik);
//  3) ambigu (mis. "X dan Y") → end-customer verbatim dari ekor nama project;
//  4) fallback ke header yang paling sering.
function pickEndCustomer(headers, projectName, familyExternal) {
  const tally = (rows) => {
    const m = {};
    rows.forEach(h => { if (h.customer_name) m[h.customer_name] = (m[h.customer_name] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  const external = headers.filter(h => !isInternalCompany(h.customer_name));
  if (external.length) return tally(external);
  const fam = familyExternal && familyExternal[projectFamilyKey(projectName)];
  if (fam && fam.size === 1) return [...fam][0];
  const fromName = endCustomerFromName(projectName);
  if (fromName && !isInternalCompany(fromName)) return fromName;
  return tally(headers) || (headers[0] && headers[0].customer_name) || '';
}

function parseProjectSheetDate(value) {
  if (value == null || value === '') return { date: null, monthIdx: null };

  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!Number.isNaN(d.getTime())) {
        return {
          date: d.toISOString().slice(0, 10),
          monthIdx: d.getUTCMonth()
        };
      }
    }
  }

  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const yyyy = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
    const mm = dmy[2].padStart(2, '0');
    const dd = dmy[1].padStart(2, '0');
    return { date: `${yyyy}-${mm}-${dd}`, monthIdx: parseInt(mm, 10) - 1 };
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return {
      date: d.toISOString().slice(0, 10),
      monthIdx: d.getUTCMonth()
    };
  }

  return { date: null, monthIdx: null };
}

// ============================================================================
// 1. GET DATA — fetch all dashboard data in PARALLEL
// ============================================================================
app.get('/api/data', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || 2026;

    // Aggregate budget dari `budget_lines` (granular per produk):
    //  - Total margin/revenue per bulan (untuk KPI strip + chart utama)
    //  - Volume/revenue/margin per canonical product (ranking, chart, dropdown)
    // Plus aktualnya per canonical product (untuk achievement % per produk).
    const [budgetMonthlyRes, budgetByProductRes,
           actualByProductRes, actualVolumeByProductRes,
           actualsRes, plansRes, psHeadersRes, psItemsRes] = await Promise.all([
      pool.query(`
        SELECT month_idx,
               COALESCE(SUM(margin_idr),0)  AS margin_raw,
               COALESCE(SUM(revenue_idr),0) AS revenue_raw,
               COALESCE(SUM(volume_mt),0)   AS volume_mt
          FROM budget_lines
         WHERE year = $1
         GROUP BY month_idx
         ORDER BY month_idx ASC
      `, [year]),
      pool.query(`
        SELECT month_idx, product,
               COALESCE(SUM(volume_mt),0)   AS volume_mt,
               COALESCE(SUM(revenue_idr),0) AS revenue_idr,
               COALESCE(SUM(margin_idr),0)  AS margin_idr
          FROM budget_lines
         WHERE year = $1
         GROUP BY month_idx, product
         ORDER BY month_idx, product
      `, [year]),
      // Actual margin/revenue per (product, month) dari ps_headers
      pool.query(`
        SELECT dashboard_month_idx AS month_idx,
               COALESCE(NULLIF(product, ''), 'Projects') AS product,
               COALESCE(SUM(margin),0)        AS margin,
               COALESCE(SUM(sales_revenue),0) AS revenue
          FROM ps_headers
         WHERE dashboard_year = $1
         GROUP BY dashboard_month_idx, COALESCE(NULLIF(product, ''), 'Projects')
      `, [year]),
      // Actual volume MT per (product, month) dari ps_items JOIN ps_headers
      pool.query(`
        SELECT h.dashboard_month_idx AS month_idx,
               COALESCE(NULLIF(h.product, ''), 'Projects') AS product,
               COALESCE(SUM(i.total_weight_kg),0) / 1000.0 AS volume_mt
          FROM ps_headers h
          JOIN ps_items   i ON i.ps_number = h.ps_number
         WHERE h.dashboard_year = $1
         GROUP BY h.dashboard_month_idx, COALESCE(NULLIF(h.product, ''), 'Projects')
      `, [year]),
      pool.query('SELECT * FROM monthly_actuals WHERE year = $1 ORDER BY month_idx ASC', [year]),
      pool.query('SELECT * FROM plan_revisions  WHERE year = $1 ORDER BY month_idx ASC, id ASC', [year]),
      pool.query('SELECT * FROM ps_headers      WHERE dashboard_year = $1 ORDER BY po_date ASC NULLS LAST, ps_number ASC', [year]),
      pool.query(`
        SELECT i.*
          FROM ps_items i
          JOIN ps_headers h ON h.ps_number = i.ps_number
         WHERE h.dashboard_year = $1
         ORDER BY i.id ASC
      `, [year]),
    ]);

    // 1. BUDGET — total margin/revenue dalam MIDR (juta), detail per canonical product
    const BUDGET = {
      margin:  Array(12).fill(0),   // MIDR
      revenue: Array(12).fill(0),   // MIDR
      products: {},   // { 'Sheet Pile': { volume:[12], revenue:[12], margin:[12] }, ... }
    };

    // Konversi raw IDR → MIDR (juta IDR) untuk konsisten dengan dashboard lama
    budgetMonthlyRes.rows.forEach(r => {
      BUDGET.margin[r.month_idx]  = parseFloat(r.margin_raw)  / 1e6;
      BUDGET.revenue[r.month_idx] = parseFloat(r.revenue_raw) / 1e6;
    });

    budgetByProductRes.rows.forEach(r => {
      if (!BUDGET.products[r.product]) {
        BUDGET.products[r.product] = {
          volume:  Array(12).fill(0),
          revenue: Array(12).fill(0),  // MIDR
          margin:  Array(12).fill(0),  // MIDR
        };
      }
      BUDGET.products[r.product].volume[r.month_idx]  = parseFloat(r.volume_mt);
      BUDGET.products[r.product].revenue[r.month_idx] = parseFloat(r.revenue_idr) / 1e6;
      BUDGET.products[r.product].margin[r.month_idx]  = parseFloat(r.margin_idr)  / 1e6;
    });

    // 2. ACTUAL
    const ACTUAL = { margin: Array(12).fill(null), plan: Array(12).fill(null), revenue: Array(12).fill(null), notes: Array(12).fill('') };
    actualsRes.rows.forEach(r => {
      ACTUAL.margin[r.month_idx]  = r.actual_margin != null ? parseFloat(r.actual_margin) : null;
      ACTUAL.plan[r.month_idx]    = r.plan_margin   != null ? parseFloat(r.plan_margin)   : null;
      ACTUAL.revenue[r.month_idx] = r.revenue       != null ? parseFloat(r.revenue)       : null;
      ACTUAL.notes[r.month_idx]   = r.notes || '';
    });

    // 2b. ACTUAL_PRODUCTS — actual margin/revenue/volume per canonical product per bulan
    // Dipakai frontend untuk: chart filter dropdown + ranking achievement % real
    const ACTUAL_PRODUCTS = {};
    const ensureProd = (p) => {
      if (!ACTUAL_PRODUCTS[p]) {
        ACTUAL_PRODUCTS[p] = {
          volume:  Array(12).fill(0),
          revenue: Array(12).fill(0), // MIDR
          margin:  Array(12).fill(0), // MIDR
        };
      }
      return ACTUAL_PRODUCTS[p];
    };
    actualByProductRes.rows.forEach(r => {
      const p = ensureProd(r.product);
      p.margin[r.month_idx]  = parseFloat(r.margin)  / 1e6;
      p.revenue[r.month_idx] = parseFloat(r.revenue) / 1e6;
    });
    actualVolumeByProductRes.rows.forEach(r => {
      const p = ensureProd(r.product);
      p.volume[r.month_idx] = parseFloat(r.volume_mt);
    });

    // 3. PLAN_REVISIONS
    const PLAN_REVISIONS = Array.from({length: 12}, () => []);
    plansRes.rows.forEach(r => {
      PLAN_REVISIONS[r.month_idx].push({
        id: r.id,
        name: r.name,
        margin:  r.margin  != null ? parseFloat(r.margin)  : '',
        revenue: r.revenue != null ? parseFloat(r.revenue) : '',
        notes: r.notes,
        qty: r.qty || {},
        ts: r.ts
      });
    });

    // 4. PS_CHAINS + QTY_DATA
    // Build O(1) lookup ps_number → items[] (sebelumnya O(N²) filter dalam loop).
    const itemsByPs = {};
    psItemsRes.rows.forEach(it => {
      (itemsByPs[it.ps_number] = itemsByPs[it.ps_number] || []).push(it);
    });

    const PS_CHAINS = {};
    const QTY_DATA  = {};
    MONTH_KEYS.forEach(m => { PS_CHAINS[m] = []; QTY_DATA[m] = []; });

    // Group ps_headers by (project_name, dashboard_month_idx) → consolidate
    const projectGroups = {};
    psHeadersRes.rows.forEach(header => {
      const mIdx = header.dashboard_month_idx;
      if (mIdx == null || mIdx < 0 || mIdx > 11) return;
      const groupKey = (header.project_name || header.ps_number) + '__' + mIdx;
      if (!projectGroups[groupKey]) {
        projectGroups[groupKey] = {
          mIdx, mKey: MONTH_KEYS[mIdx],
          projectName: header.project_name || header.ps_number,
          headers: []
        };
      }
      projectGroups[groupKey].headers.push(header);
    });

    // Family → set customer eksternal (lintas bulan/leg) untuk resolve leg internal
    // ke nama customer kanonik (mis. "KEM"/"PTJ" → nama penuh dari PS sibling).
    const familyExternal = {};
    psHeadersRes.rows.forEach(h => {
      if (isInternalCompany(h.customer_name) || !h.customer_name) return;
      const k = projectFamilyKey(h.project_name);
      (familyExternal[k] = familyExternal[k] || new Set()).add(h.customer_name);
    });

    let colorIdx = 0;
    Object.values(projectGroups).forEach(group => {
      const { mKey, projectName, headers } = group;
      // Customer = end-customer eksternal (roll-up intercompany), bukan leg internal.
      const customer = pickEndCustomer(headers, projectName, familyExternal);

      const totalMarginIDR  = headers.reduce((s, h) => s + parseFloat(h.margin || 0), 0);
      const totalRevenueIDR = headers.reduce((s, h) => s + parseFloat(h.sales_revenue || 0), 0);
      const totalPct = totalRevenueIDR > 0
        ? parseFloat((totalMarginIDR / totalRevenueIDR * 100).toFixed(4)) : 0;

      // Canonical product dari ps_headers.product (consensus dari subsidiaries)
      const productCounts = {};
      headers.forEach(h => {
        if (h.product) productCounts[h.product] = (productCounts[h.product] || 0) + 1;
      });
      const canonicalProduct = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Projects';
      const segmentVal = headers.find(h => h.segment)?.segment || null;

      PS_CHAINS[mKey].push({
        name:     projectName,
        ps:       headers.map(h => h.ps_number).join(' · '),
        customer,
        customerInternal: isInternalCompany(customer),
        product:  canonicalProduct,
        segment:  segmentVal,
        revenue:  parseFloat((totalRevenueIDR / 1e6).toFixed(3)),
        margin:   parseFloat((totalMarginIDR  / 1e6).toFixed(3)),
        pct:      totalPct,
        note:     headers.map(h => h.notes).filter(Boolean).join(' | '),
        subsidiaries: headers.map(h => ({
          ps:           h.ps_number,
          sub:          h.subsidiary || '',
          currency:     h.currency   || 'IDR',
          fxRate:       parseFloat(h.fx_rate || 1),
          marginNative: parseFloat(h.net_margin_native != null ? h.net_margin_native : (h.margin || 0)),
          marginIDR:    parseFloat(h.margin || 0),
          marginMIDR:   parseFloat(((h.margin || 0) / 1e6).toFixed(3)),
          pct:          parseFloat(h.margin_percentage || 0),
        })),
      });

      // QTY_DATA
      let totalKg = 0, totalQty = 0, unit = 'pcs';
      const allProducts = [];

      headers.forEach(header => {
        const items = itemsByPs[header.ps_number] || [];
        items.forEach(item => {
          totalKg  += parseFloat(item.total_weight_kg || 0);
          totalQty += parseFloat(item.qty_val || 0);
          if (item.qty_unit) unit = item.qty_unit.trim();
          allProducts.push({
            name:   (item.material + (item.size ? ' (' + item.size + ')' : '')).trim(),
            qty:    parseFloat(item.qty_val).toLocaleString('id-ID') + ' ' + (item.qty_unit || ''),
            weight: parseFloat(item.total_weight_kg).toLocaleString('id-ID') + ' KG'
          });
        });
      });

      if (totalKg > 0) {
        QTY_DATA[mKey].push({
          name:        projectName,
          color:       COLORS[colorIdx++ % COLORS.length],
          customer,
          customerInternal: isInternalCompany(customer),
          totalQty:    totalQty.toLocaleString('id-ID') + ' ' + unit,
          totalWeight: totalKg.toLocaleString('id-ID') + ' KG (' + Math.round(totalKg/1000).toLocaleString('id-ID') + ' MT)',
          product:     canonicalProduct,                  // new canonical product
          segment:     segmentVal,
          products:    allProducts,
        });
      }
    });

    // Browser cache pendek + revalidate. /api/data dipanggil tiap ganti tahun/bulan,
    // ini bantu kalau user bolak-balik filter yang sama.
    res.setHeader('Cache-Control', 'private, max-age=5, must-revalidate');
    res.json({
      BUDGET,
      ACTUAL,
      ACTUAL_PRODUCTS,
      PLAN_REVISIONS,
      PS_CHAINS,
      QTY_DATA,
    });
  } catch (err) {
    console.error('GET /api/data error:', err);
    res.status(500).json({ error: 'Database read failed: ' + err.message });
  }
});

// ============================================================================
// 2. PRODUCT MASTER — list canonical products + alias map
// Dipakai frontend untuk dropdown filter & saat parse Budget Excel
// ============================================================================
app.get('/api/products', async (req, res) => {
  try {
    const [prodRes, aliasRes] = await Promise.all([
      pool.query('SELECT canonical_name, macro_category, display_order FROM products ORDER BY display_order ASC, canonical_name ASC'),
      pool.query('SELECT alias, canonical_name FROM product_aliases ORDER BY alias ASC'),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      products: prodRes.rows,
      aliases:  Object.fromEntries(aliasRes.rows.map(r => [r.alias, r.canonical_name])),
    });
  } catch (err) {
    console.error('GET /api/products error:', err);
    res.status(500).json({ error: 'Failed to load products: ' + err.message });
  }
});

// ============================================================================
// 3. IMPORT BUDGET — upsert budget_lines from parsed Excel
// Body: { year: number, lines: [{ month_idx, segment, product, volume_mt, revenue_idr, margin_idr }, ...] }
// Tahun yang di-import akan DI-REPLACE penuh (delete + insert) supaya idempotent.
// ============================================================================
app.post('/api/budget/import', async (req, res) => {
  const { year, lines } = req.body || {};
  if (!Number.isInteger(year) || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'Invalid payload — expect { year:int, lines:array }' });
  }
  if (lines.length === 0) {
    return res.status(400).json({ error: 'No lines to import' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validasi product harus exist di master (semua canonical sudah seeded)
    const prodRes = await client.query('SELECT canonical_name FROM products');
    const validProducts = new Set(prodRes.rows.map(r => r.canonical_name));
    const unknown = [...new Set(lines.map(l => l.product))].filter(p => !validProducts.has(p));
    if (unknown.length > 0) {
      throw new Error(`Unknown product(s): ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`);
    }

    // Replace penuh untuk tahun ini
    await client.query('DELETE FROM budget_lines WHERE year = $1', [year]);

    // Insert batch — idempotent: kalau ada duplikat (year,month,segment,product), UPSERT sum
    for (const l of lines) {
      const mIdx = parseInt(l.month_idx);
      if (mIdx < 0 || mIdx > 11) continue;
      await client.query(`
        INSERT INTO budget_lines (year, month_idx, segment, product, volume_mt, revenue_idr, margin_idr)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (year, month_idx, segment, product) DO UPDATE SET
          volume_mt   = budget_lines.volume_mt   + EXCLUDED.volume_mt,
          revenue_idr = budget_lines.revenue_idr + EXCLUDED.revenue_idr,
          margin_idr  = budget_lines.margin_idr  + EXCLUDED.margin_idr,
          updated_at  = CURRENT_TIMESTAMP
      `, [
        year, mIdx,
        String(l.segment || 'Unknown').trim(),
        String(l.product).trim(),
        parseFloat(l.volume_mt)   || 0,
        parseFloat(l.revenue_idr) || 0,
        parseFloat(l.margin_idr)  || 0,
      ]);
    }

    const cnt = await client.query('SELECT COUNT(*) FROM budget_lines WHERE year = $1', [year]);
    await client.query('COMMIT');
    res.json({ success: true, year, rowsInserted: parseInt(cnt.rows[0].count) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/budget/import error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 4. DELETE BUDGET — wipe budget_lines for a given year (so user can re-upload)
// ============================================================================
app.delete('/api/budget/:year', async (req, res) => {
  const year = parseInt(req.params.year);
  if (!Number.isInteger(year)) {
    return res.status(400).json({ error: 'Invalid year' });
  }
  try {
    const result = await pool.query('DELETE FROM budget_lines WHERE year = $1', [year]);
    res.json({ success: true, year, rowsDeleted: result.rowCount });
  } catch (err) {
    console.error('DELETE /api/budget error:', err);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

// ============================================================================
// 3. POST DATA — save actuals + plan revisions for a given year
// ============================================================================
app.post('/api/data', async (req, res) => {
  const { ACTUAL, PLAN_REVISIONS } = req.body;
  if (!ACTUAL || !PLAN_REVISIONS) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const aYear = parseInt(req.body.year) || 2026;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < 12; i++) {
      await client.query(`
        INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (month_idx, year) DO UPDATE SET
          actual_margin = EXCLUDED.actual_margin,
          plan_margin   = EXCLUDED.plan_margin,
          revenue       = EXCLUDED.revenue,
          notes         = EXCLUDED.notes,
          updated_at    = CURRENT_TIMESTAMP
      `, [i, aYear, ACTUAL.margin[i], ACTUAL.plan[i], ACTUAL.revenue[i], ACTUAL.notes[i]]);
    }

    // Hanya hapus plan_revisions untuk tahun ini — bukan semua tahun.
    await client.query('DELETE FROM plan_revisions WHERE year = $1', [aYear]);
    for (let i = 0; i < 12; i++) {
      for (const rev of PLAN_REVISIONS[i] || []) {
        await client.query(`
          INSERT INTO plan_revisions (month_idx, year, name, margin, revenue, notes, qty, ts)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          i,
          aYear,
          rev.name,
          rev.margin  !== '' && rev.margin  != null ? rev.margin  : null,
          rev.revenue !== '' && rev.revenue != null ? rev.revenue : null,
          rev.notes,
          rev.qty || {},
          rev.ts
        ]);
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/data error:', err);
    res.status(500).json({ error: 'Database write failed: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 4. POST PROJECT SHEET — save one PS, FX-convert margin → IDR, re-aggregate
// ============================================================================
app.post('/api/project-sheet', async (req, res) => {
  const { header, items } = req.body;
  if (!header || !header.psNumber) {
    return res.status(400).json({ error: 'Missing header.psNumber' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const parsedPoDate = parseProjectSheetDate(header.poDate);
    let monthIdx = parsedPoDate.monthIdx == null ? 0 : parsedPoDate.monthIdx;
    if (monthIdx < 0 || monthIdx > 11) monthIdx = 0;

    const psYear = parseInt(header.dashboardYear) ||
      (parsedPoDate.date ? parseInt(parsedPoDate.date.slice(0, 4), 10) : new Date().getFullYear());

    // Detect canonical product dari material/project name pakai product_aliases
    let detectedProduct = null;
    let detectedSegment = null;
    if (Array.isArray(items) && items.length > 0) {
      const aliasRes = await client.query('SELECT alias, canonical_name FROM product_aliases');
      const aliases = aliasRes.rows
        .map(r => ({ alias: r.alias.toLowerCase(), canonical: r.canonical_name }))
        .sort((a, b) => b.alias.length - a.alias.length); // longest alias first
      const haystack = (
        (header.projectName || '') + ' ' +
        items.slice(0, 5).map(it => (it.material || '') + ' ' + (it.size || '')).join(' ')
      ).toLowerCase();
      for (const { alias, canonical } of aliases) {
        if (haystack.includes(alias)) { detectedProduct = canonical; break; }
      }
    }
    // Segment heuristic dari canonical product
    if (detectedProduct) {
      const segMap = {
        'Sheet Pile':'Long', 'ERW Pipe':'Long', 'Seamless Pipe':'Long', 'Angle':'Long',
        'Bar':'Long', 'Beam':'Long', 'Channel':'Long', 'As Steel':'Long', 'Hollow':'Long',
        'HRC':'Flat', 'HRPO':'Flat', 'Plate':'Flat', 'Chequered Plate':'Flat', 'Wear Plate':'Flat',
        'Galvalume':'Coated', 'Galvanized':'Coated', 'PPGL':'Coated', 'Wiremesh':'Coated',
        'Slab':'Semi-Finished', 'Billet':'Semi-Finished',
        'HBI':'Raw Material', 'Scrap':'Raw Material',
        'Projects':'Projects',
      };
      detectedSegment = segMap[detectedProduct] || null;
    }

    await client.query(`
      INSERT INTO ps_headers (
        ps_number, dashboard_month_idx, dashboard_year,
        project_code, project_name, subsidiary,
        customer_name, supplier_name,
        po_date,
        currency, fx_rate, net_margin_native,
        sales_revenue, purchase_cost,
        margin, margin_percentage,
        product, segment
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (ps_number) DO UPDATE SET
        dashboard_month_idx  = EXCLUDED.dashboard_month_idx,
        dashboard_year       = EXCLUDED.dashboard_year,
        project_code         = EXCLUDED.project_code,
        project_name         = EXCLUDED.project_name,
        subsidiary           = EXCLUDED.subsidiary,
        customer_name        = EXCLUDED.customer_name,
        supplier_name        = EXCLUDED.supplier_name,
        po_date              = EXCLUDED.po_date,
        currency             = EXCLUDED.currency,
        fx_rate              = EXCLUDED.fx_rate,
        net_margin_native    = EXCLUDED.net_margin_native,
        sales_revenue        = EXCLUDED.sales_revenue,
        purchase_cost        = EXCLUDED.purchase_cost,
        margin               = EXCLUDED.margin,
        margin_percentage    = EXCLUDED.margin_percentage,
        product              = EXCLUDED.product,
        segment              = EXCLUDED.segment
    `, [
      header.psNumber,
      monthIdx,
      psYear,
      header.projectCode,
      header.projectName,
      header.subsidiary,
      header.customerName,
      header.supplierName,
      parsedPoDate.date,
      header.currency || 'IDR',
      header.fxToIDR  || 1,
      header.netMarginNative != null ? header.netMarginNative : header.margin,
      header.salesIDR != null ? header.salesIDR : header.sales,
      header.purchase,
      header.marginIDR != null ? header.marginIDR : header.margin,
      header.marginPct,
      detectedProduct,
      detectedSegment,
    ]);

    await client.query('DELETE FROM ps_items WHERE ps_number = $1', [header.psNumber]);
    for (const item of (items || [])) {
      await client.query(`
        INSERT INTO ps_items (
          ps_number, item_no, material, size, length,
          qty_val, qty_unit, total_weight_kg, purchase_price_kg
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        header.psNumber,
        item.no, item.material, item.size, item.length,
        item.qtyVal, item.qtyUnit, item.totalWeight, item.purchasePrice
      ]);
    }

    // Re-aggregate monthly_actuals untuk (year, month) ini saja
    const agg = await client.query(`
      SELECT COALESCE(SUM(margin),0)        AS m,
             COALESCE(SUM(sales_revenue),0) AS r
        FROM ps_headers
       WHERE dashboard_month_idx = $1 AND dashboard_year = $2
    `, [monthIdx, psYear]);
    const mMIDR = parseFloat(agg.rows[0].m) / 1e6;
    const rMIDR = parseFloat(agg.rows[0].r) / 1e6;
    await client.query(`
      INSERT INTO monthly_actuals (month_idx, year, actual_margin, revenue)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (month_idx, year) DO UPDATE SET
        actual_margin = EXCLUDED.actual_margin,
        revenue       = EXCLUDED.revenue,
        updated_at    = CURRENT_TIMESTAMP
    `, [monthIdx, psYear, mMIDR, rMIDR]);

    await client.query('COMMIT');
    res.json({ success: true, message: `Imported ${header.psNumber}.`, monthIdx, year: psYear, mMIDR, rMIDR });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/project-sheet error:', err);
    res.status(500).json({ error: 'Failed to import Project Sheet: ' + err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 5. DELETE PROJECT SHEET — hapus PS & re-aggregate untuk (month, year)-nya
// ============================================================================
app.delete('/api/project-sheet/:psNumber', async (req, res) => {
  const psNumber = decodeURIComponent(req.params.psNumber);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cari (month, year) dari PS yang akan dihapus
    const findRes = await client.query(
      'SELECT dashboard_month_idx, dashboard_year FROM ps_headers WHERE ps_number = $1',
      [psNumber]
    );
    if (findRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PS not found' });
    }
    const monthIdx = findRes.rows[0].dashboard_month_idx;
    const psYear   = findRes.rows[0].dashboard_year;

    await client.query('DELETE FROM ps_items   WHERE ps_number = $1', [psNumber]);
    await client.query('DELETE FROM ps_headers WHERE ps_number = $1', [psNumber]);

    // Re-aggregate hanya untuk (month, year) ini
    const remainingRes = await client.query(
      'SELECT COUNT(*) FROM ps_headers WHERE dashboard_month_idx = $1 AND dashboard_year = $2',
      [monthIdx, psYear]
    );
    const remaining = parseInt(remainingRes.rows[0].count);

    if (remaining > 0) {
      const agg = await client.query(`
        SELECT COALESCE(SUM(margin),0) AS m, COALESCE(SUM(sales_revenue),0) AS r
          FROM ps_headers
         WHERE dashboard_month_idx = $1 AND dashboard_year = $2
      `, [monthIdx, psYear]);
      await client.query(`
        UPDATE monthly_actuals
           SET actual_margin = $1, revenue = $2, updated_at = CURRENT_TIMESTAMP
         WHERE month_idx = $3 AND year = $4
      `, [parseFloat(agg.rows[0].m)/1e6, parseFloat(agg.rows[0].r)/1e6, monthIdx, psYear]);
    } else {
      await client.query(`
        UPDATE monthly_actuals
           SET actual_margin = NULL, revenue = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE month_idx = $1 AND year = $2
      `, [monthIdx, psYear]);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `${psNumber} deleted.`, monthIdx, year: psYear, remaining });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/project-sheet error:', err);
    res.status(500).json({ error: 'Failed to delete Project Sheet: ' + err.message });
  } finally {
    client.release();
  }
});

// ── Health check (buat uptime monitor) ────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Listen — taruh paling akhir biar semua route sudah terdaftar ──────────────
app.listen(port, () => console.log(`Server running on port ${port}`));
