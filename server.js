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
const repo = require('./sheetsRepo');

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

// ── Data store: Google Sheets ─────────────────────────────────────────────────
// Ganti Neon Postgres. Semua "tabel" = tab di spreadsheet (lihat sheetsRepo.js).
// Pola: baca seluruh tab → olah/agregasi di JS → tulis balik seluruh tab (writes
// diserialisasi lewat repo.withWriteLock untuk ganti transaksi).
console.log(`[sheets] spreadsheet=${repo.SPREADSHEET_ID || '(SPREADSHEET_ID belum di-set)'}`);

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const COLORS = ['#f59e0b', '#a78bfa', '#22d3ee', '#4ade80', '#fb923c', '#818cf8', '#38bdf8'];

const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };
// Canonical product dengan fallback 'Projects' (ganti COALESCE(NULLIF(product,''),'Projects'))
const prodKey = (p) => { const s = (p == null ? '' : String(p)).trim(); return s === '' ? 'Projects' : s; };

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

// Consolidated end-customer untuk satu project group: customer EKSTERNAL paling
// sering muncul di antara header-nya; fallback ke yang paling sering kalau semua internal.
function pickEndCustomer(headers) {
  const tally = (rows) => {
    const m = {};
    rows.forEach(h => { if (h.customer_name) m[h.customer_name] = (m[h.customer_name] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  const external = headers.filter(h => !isInternalCompany(h.customer_name));
  return tally(external.length ? external : headers) || (headers[0] && headers[0].customer_name) || '';
}

// Normalisasi nama company tanpa spasi (untuk matching "Eka Mulia" ≈ "Ekamulia").
const normNoSpace = (s) => normCompany(s).replace(/\s+/g, '');

// End-customer dari ekor nama project: "{Project} - Del. {Bulan Tahun} - {Customer(s)}".
function endCustomerFromName(projectName) {
  const parts = String(projectName || '').split(' - ');
  if (parts.length < 2) return '';
  const tail = parts[parts.length - 1].trim();
  return /[a-z]/i.test(tail) ? tail : '';
}

// Base project family: buang " - Del. {bulan} {tahun} - {customer}" → nama proyek inti.
// Dipakai untuk menemukan leg "anak" (parallel) dari satu parent yang melayani >1 customer.
function projectFamilyKey(projectName) {
  return String(projectName || '').split(/\s-\s*del\b/i)[0].trim().toLowerCase().replace(/\s+/g, ' ');
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

// ── Helper agregasi (ganti GROUP BY SQL → JS) ─────────────────────────────────
// Group array by key fn, jalankan reducer untuk tiap grup.
function groupReduce(rows, keyFn, seed, reducer) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { key: k, acc: typeof seed === 'function' ? seed() : { ...seed } });
    reducer(map.get(k).acc, r);
  }
  return [...map.values()];
}

// ============================================================================
// 1. GET DATA — fetch all dashboard data
// ============================================================================
app.get('/api/data', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || 2026;

    // Ambil tab mentah secara paralel, lalu filter + agregasi di JS.
    const [actualsAll, plansAll, budgetAll, headersAll, itemsAll] = await Promise.all([
      repo.getTable('monthly_actuals'),
      repo.getTable('plan_revisions'),
      repo.getTable('budget_lines'),
      repo.getTable('ps_headers'),
      repo.getTable('ps_items'),
    ]);

    const budgetRows  = budgetAll.filter(r => r.year === year);
    const headerRows  = headersAll.filter(h => h.dashboard_year === year);
    const psNumbersInYear = new Set(headerRows.map(h => h.ps_number));
    const itemRows    = itemsAll.filter(i => psNumbersInYear.has(i.ps_number));
    const actualRows  = actualsAll.filter(r => r.year === year).sort((a, b) => a.month_idx - b.month_idx);
    const planRows    = plansAll.filter(r => r.year === year)
                                .sort((a, b) => (a.month_idx - b.month_idx) || ((a.id || 0) - (b.id || 0)));

    // Map item → header (untuk JOIN volume) & by ps_number
    const headerByPs = {};
    headerRows.forEach(h => { headerByPs[h.ps_number] = h; });
    const itemsByPs = {};
    itemRows.forEach(it => { (itemsByPs[it.ps_number] = itemsByPs[it.ps_number] || []).push(it); });

    // 1. BUDGET — total margin/revenue dalam MIDR (juta), detail per canonical product
    const BUDGET = {
      margin:  Array(12).fill(0),   // MIDR
      revenue: Array(12).fill(0),   // MIDR
      products: {},   // { 'Sheet Pile': { volume:[12], revenue:[12], margin:[12] }, ... }
    };

    // budgetMonthly: GROUP BY month_idx
    groupReduce(budgetRows, r => r.month_idx,
      () => ({ margin: 0, revenue: 0, volume: 0 }),
      (a, r) => { a.margin += num(r.margin_idr); a.revenue += num(r.revenue_idr); a.volume += num(r.volume_mt); }
    ).forEach(g => {
      BUDGET.margin[g.key]  = g.acc.margin  / 1e6;
      BUDGET.revenue[g.key] = g.acc.revenue / 1e6;
    });

    // budgetByProduct: GROUP BY (month_idx, product)
    groupReduce(budgetRows, r => `${r.month_idx}__${r.product}`,
      () => ({ month_idx: null, product: null, volume: 0, revenue: 0, margin: 0 }),
      (a, r) => { a.month_idx = r.month_idx; a.product = r.product; a.volume += num(r.volume_mt); a.revenue += num(r.revenue_idr); a.margin += num(r.margin_idr); }
    ).forEach(g => {
      const p = g.acc.product;
      if (!BUDGET.products[p]) {
        BUDGET.products[p] = { volume: Array(12).fill(0), revenue: Array(12).fill(0), margin: Array(12).fill(0) };
      }
      BUDGET.products[p].volume[g.acc.month_idx]  = g.acc.volume;
      BUDGET.products[p].revenue[g.acc.month_idx] = g.acc.revenue / 1e6;
      BUDGET.products[p].margin[g.acc.month_idx]  = g.acc.margin  / 1e6;
    });

    // 2. ACTUAL
    const ACTUAL = { margin: Array(12).fill(null), plan: Array(12).fill(null), revenue: Array(12).fill(null), notes: Array(12).fill('') };
    actualRows.forEach(r => {
      ACTUAL.margin[r.month_idx]  = r.actual_margin != null ? num(r.actual_margin) : null;
      ACTUAL.plan[r.month_idx]    = r.plan_margin   != null ? num(r.plan_margin)   : null;
      ACTUAL.revenue[r.month_idx] = r.revenue       != null ? num(r.revenue)       : null;
      ACTUAL.notes[r.month_idx]   = r.notes || '';
    });

    // 2b. ACTUAL_PRODUCTS — actual margin/revenue/volume per canonical product per bulan
    const ACTUAL_PRODUCTS = {};
    const ensureProd = (p) => {
      if (!ACTUAL_PRODUCTS[p]) {
        ACTUAL_PRODUCTS[p] = { volume: Array(12).fill(0), revenue: Array(12).fill(0), margin: Array(12).fill(0) };
      }
      return ACTUAL_PRODUCTS[p];
    };
    // actualByProduct: dari ps_headers GROUP BY (month_idx, product) SUM(margin), SUM(sales_revenue)
    groupReduce(headerRows.filter(h => h.dashboard_month_idx != null && h.dashboard_month_idx >= 0 && h.dashboard_month_idx <= 11),
      h => `${h.dashboard_month_idx}__${prodKey(h.product)}`,
      () => ({ month_idx: null, product: null, margin: 0, revenue: 0 }),
      (a, h) => { a.month_idx = h.dashboard_month_idx; a.product = prodKey(h.product); a.margin += num(h.margin); a.revenue += num(h.sales_revenue); }
    ).forEach(g => {
      const p = ensureProd(g.acc.product);
      p.margin[g.acc.month_idx]  = g.acc.margin  / 1e6;
      p.revenue[g.acc.month_idx] = g.acc.revenue / 1e6;
    });
    // actualVolumeByProduct: ps_items JOIN ps_headers GROUP BY (month_idx, product) SUM(weight)/1000
    const volRows = itemRows.map(it => {
      const h = headerByPs[it.ps_number];
      return h && h.dashboard_month_idx != null && h.dashboard_month_idx >= 0 && h.dashboard_month_idx <= 11
        ? { month_idx: h.dashboard_month_idx, product: prodKey(h.product), kg: num(it.total_weight_kg) }
        : null;
    }).filter(Boolean);
    groupReduce(volRows, r => `${r.month_idx}__${r.product}`,
      () => ({ month_idx: null, product: null, kg: 0 }),
      (a, r) => { a.month_idx = r.month_idx; a.product = r.product; a.kg += r.kg; }
    ).forEach(g => {
      const p = ensureProd(g.acc.product);
      p.volume[g.acc.month_idx] = g.acc.kg / 1000.0;
    });

    // 3. PLAN_REVISIONS
    const PLAN_REVISIONS = Array.from({length: 12}, () => []);
    planRows.forEach(r => {
      if (r.month_idx == null || r.month_idx < 0 || r.month_idx > 11) return;
      PLAN_REVISIONS[r.month_idx].push({
        id: r.id,
        name: r.name,
        margin:  r.margin  != null ? num(r.margin)  : '',
        revenue: r.revenue != null ? num(r.revenue) : '',
        notes: r.notes,
        qty: r.qty || {},
        ts: r.ts
      });
    });

    // 4. PS_CHAINS + QTY_DATA
    const PS_CHAINS = {};
    const QTY_DATA  = {};
    MONTH_KEYS.forEach(m => { PS_CHAINS[m] = []; QTY_DATA[m] = []; });

    // ps_headers ordered by po_date asc nulls last, ps_number asc
    const orderedHeaders = [...headerRows].sort((a, b) => {
      const da = a.po_date || '￿';
      const db = b.po_date || '￿';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.ps_number).localeCompare(String(b.ps_number));
    });

    // Group ps_headers by (project_name, dashboard_month_idx) → consolidate
    const projectGroups = {};
    orderedHeaders.forEach(header => {
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

    // Family → { customerNoSpace: { name, volumeMT } } untuk leg "anak" eksternal.
    const familyChildren = {};
    headerRows.forEach(h => {
      if (isInternalCompany(h.customer_name) || !h.customer_name) return;
      const fk  = projectFamilyKey(h.project_name);
      const key = normNoSpace(h.customer_name);
      const vol = (itemsByPs[h.ps_number] || []).reduce((s, it) => s + num(it.total_weight_kg), 0) / 1000;
      if (!familyChildren[fk]) familyChildren[fk] = {};
      if (!familyChildren[fk][key]) familyChildren[fk][key] = { name: h.customer_name, volumeMT: 0 };
      familyChildren[fk][key].volumeMT += vol;
    });

    let colorIdx = 0;
    Object.values(projectGroups).forEach(group => {
      const { mKey, projectName, headers } = group;
      // Customer = end-customer eksternal (roll-up intercompany), bukan leg internal.
      let customer = pickEndCustomer(headers);
      let customerInternal = isInternalCompany(customer);

      // Parallel-parent: leg internal yang namanya menyebut >1 end-customer ("A dan B").
      let customerSplit = null;
      if (customerInternal) {
        const names = endCustomerFromName(projectName).split(/\s+dan\s+/i).map(s => s.trim()).filter(Boolean);
        if (names.length >= 2) {
          const children = familyChildren[projectFamilyKey(projectName)] || {};
          const parts = names.map(nm => {
            const child = children[normNoSpace(nm)];
            return { customer: child ? child.name : nm, volumeMT: child ? child.volumeMT : 0 };
          });
          const totalVol = parts.reduce((s, p) => s + p.volumeMT, 0);
          customerSplit = parts.map(p => ({
            customer: p.customer,
            weight: totalVol > 0 ? p.volumeMT / totalVol : 1 / parts.length,
          }));
          customer = endCustomerFromName(projectName);  // tampilkan nama gabungan di modal
          customerInternal = false;                      // sudah ditangani via split
        }
      }

      const totalMarginIDR  = headers.reduce((s, h) => s + num(h.margin), 0);
      const totalRevenueIDR = headers.reduce((s, h) => s + num(h.sales_revenue), 0);
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
        customerInternal,
        customerSplit,
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
          fxRate:       num(h.fx_rate || 1),
          marginNative: num(h.net_margin_native != null ? h.net_margin_native : (h.margin || 0)),
          marginIDR:    num(h.margin || 0),
          marginMIDR:   parseFloat((num(h.margin || 0) / 1e6).toFixed(3)),
          pct:          num(h.margin_percentage || 0),
        })),
      });

      // QTY_DATA
      let totalKg = 0, totalQty = 0, unit = 'pcs';
      const allProducts = [];

      headers.forEach(header => {
        const items = itemsByPs[header.ps_number] || [];
        items.forEach(item => {
          totalKg  += num(item.total_weight_kg);
          totalQty += num(item.qty_val);
          if (item.qty_unit) unit = String(item.qty_unit).trim();
          allProducts.push({
            name:   (item.material + (item.size ? ' (' + item.size + ')' : '')).trim(),
            qty:    num(item.qty_val).toLocaleString('id-ID') + ' ' + (item.qty_unit || ''),
            weight: num(item.total_weight_kg).toLocaleString('id-ID') + ' KG'
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

    // Browser cache pendek + revalidate. /api/data dipanggil tiap ganti tahun/bulan.
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
    res.status(500).json({ error: 'Sheets read failed: ' + err.message });
  }
});

// ============================================================================
// 2. PRODUCT MASTER — list canonical products + alias map
// ============================================================================
app.get('/api/products', async (req, res) => {
  try {
    const [prodRows, aliasRows] = await Promise.all([
      repo.getTable('products'),
      repo.getTable('product_aliases'),
    ]);
    const products = prodRows
      .filter(r => r.canonical_name)
      .map(r => ({ canonical_name: r.canonical_name, macro_category: r.macro_category, display_order: r.display_order }))
      .sort((a, b) => ((a.display_order || 100) - (b.display_order || 100)) || String(a.canonical_name).localeCompare(String(b.canonical_name)));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      products,
      aliases:  Object.fromEntries(aliasRows.filter(r => r.alias).map(r => [r.alias, r.canonical_name])),
    });
  } catch (err) {
    console.error('GET /api/products error:', err);
    res.status(500).json({ error: 'Failed to load products: ' + err.message });
  }
});

// ============================================================================
// 3. IMPORT BUDGET — upsert budget_lines from parsed Excel
// Body: { year, lines: [{ month_idx, segment, product, volume_mt, revenue_idr, margin_idr }] }
// Tahun yang di-import DI-REPLACE penuh (delete + insert) supaya idempotent.
// ============================================================================
app.post('/api/budget/import', async (req, res) => {
  const { year, lines } = req.body || {};
  if (!Number.isInteger(year) || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'Invalid payload — expect { year:int, lines:array }' });
  }
  if (lines.length === 0) {
    return res.status(400).json({ error: 'No lines to import' });
  }

  try {
    const result = await repo.withWriteLock(async () => {
      // Validasi product harus exist di master
      const prodRows = await repo.getTable('products');
      const validProducts = new Set(prodRows.map(r => r.canonical_name).filter(Boolean));
      const unknown = [...new Set(lines.map(l => l.product))].filter(p => !validProducts.has(p));
      if (unknown.length > 0) {
        throw new Error(`Unknown product(s): ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`);
      }

      const all = await repo.getTable('budget_lines');
      // Buang tahun ini (replace penuh), pertahankan tahun lain.
      const kept = all.filter(r => r.year !== year);

      // UPSERT-sum per (year, month_idx, segment, product) untuk tahun ini.
      const merged = new Map();
      for (const l of lines) {
        const mIdx = parseInt(l.month_idx, 10);
        if (mIdx < 0 || mIdx > 11 || Number.isNaN(mIdx)) continue;
        const segment = String(l.segment || 'Unknown').trim();
        const product = String(l.product).trim();
        const k = `${mIdx}__${segment}__${product}`;
        if (!merged.has(k)) merged.set(k, { year, month_idx: mIdx, segment, product, volume_mt: 0, revenue_idr: 0, margin_idr: 0, updated_at: new Date().toISOString() });
        const row = merged.get(k);
        row.volume_mt   += num(l.volume_mt);
        row.revenue_idr += num(l.revenue_idr);
        row.margin_idr  += num(l.margin_idr);
      }
      const newRows = [...merged.values()];
      const written = await repo.replaceTable('budget_lines', [...kept, ...newRows]);
      return written.filter(r => r.year === year).length;
    });
    res.json({ success: true, year, rowsInserted: result });
  } catch (err) {
    console.error('POST /api/budget/import error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// ============================================================================
// 4. DELETE BUDGET — wipe budget_lines for a given year
// ============================================================================
app.delete('/api/budget/:year', async (req, res) => {
  const year = parseInt(req.params.year);
  if (!Number.isInteger(year)) {
    return res.status(400).json({ error: 'Invalid year' });
  }
  try {
    const deleted = await repo.withWriteLock(async () => {
      const all = await repo.getTable('budget_lines');
      const kept = all.filter(r => r.year !== year);
      await repo.replaceTable('budget_lines', kept);
      return all.length - kept.length;
    });
    res.json({ success: true, year, rowsDeleted: deleted });
  } catch (err) {
    console.error('DELETE /api/budget error:', err);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

// ============================================================================
// 5. POST DATA — save actuals + plan revisions for a given year
// ============================================================================
app.post('/api/data', async (req, res) => {
  const { ACTUAL, PLAN_REVISIONS } = req.body;
  if (!ACTUAL || !PLAN_REVISIONS) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const aYear = parseInt(req.body.year) || 2026;
  try {
    await repo.withWriteLock(async () => {
      const now = new Date().toISOString();

      // monthly_actuals: upsert 12 baris untuk tahun ini, pertahankan tahun lain.
      const actualsAll = await repo.getTable('monthly_actuals');
      const keptActuals = actualsAll.filter(r => r.year !== aYear);
      const newActuals = [];
      for (let i = 0; i < 12; i++) {
        newActuals.push({
          month_idx: i, year: aYear,
          actual_margin: ACTUAL.margin[i],
          plan_margin:   ACTUAL.plan[i],
          revenue:       ACTUAL.revenue[i],
          notes:         ACTUAL.notes[i] || '',
          updated_at:    now,
        });
      }
      await repo.replaceTable('monthly_actuals', [...keptActuals, ...newActuals]);

      // plan_revisions: hapus tahun ini, insert ulang. Tahun lain dipertahankan.
      const plansAll = await repo.getTable('plan_revisions');
      const keptPlans = plansAll.filter(r => r.year !== aYear);
      const newPlans = [];
      for (let i = 0; i < 12; i++) {
        for (const rev of PLAN_REVISIONS[i] || []) {
          newPlans.push({
            month_idx: i, year: aYear,
            name: rev.name,
            margin:  rev.margin  !== '' && rev.margin  != null ? num(rev.margin)  : null,
            revenue: rev.revenue !== '' && rev.revenue != null ? num(rev.revenue) : null,
            notes: rev.notes,
            qty: rev.qty || {},
            ts: rev.ts,
            created_at: now,
          });
        }
      }
      await repo.replaceTable('plan_revisions', [...keptPlans, ...newPlans]);
    });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/data error:', err);
    res.status(500).json({ error: 'Sheets write failed: ' + err.message });
  }
});

// ── Re-aggregate monthly_actuals untuk satu (month, year) dari ps_headers ──────
// Dipakai setelah PS di-upsert/dihapus. Mengembalikan array monthly_actuals baru.
function reaggregateActuals(actualsAll, headersAll, monthIdx, psYear) {
  const inBucket = headersAll.filter(h => h.dashboard_month_idx === monthIdx && h.dashboard_year === psYear);
  const idx = actualsAll.findIndex(r => r.month_idx === monthIdx && r.year === psYear);
  const now = new Date().toISOString();
  if (inBucket.length > 0) {
    const m = inBucket.reduce((s, h) => s + num(h.margin), 0) / 1e6;
    const r = inBucket.reduce((s, h) => s + num(h.sales_revenue), 0) / 1e6;
    if (idx >= 0) {
      actualsAll[idx] = { ...actualsAll[idx], actual_margin: m, revenue: r, updated_at: now };
    } else {
      actualsAll.push({ month_idx: monthIdx, year: psYear, actual_margin: m, plan_margin: null, revenue: r, notes: '', updated_at: now });
    }
    return { mMIDR: m, rMIDR: r, remaining: inBucket.length };
  }
  // Tidak ada PS tersisa → kosongkan actual_margin/revenue (kalau barisnya ada)
  if (idx >= 0) {
    actualsAll[idx] = { ...actualsAll[idx], actual_margin: null, revenue: null, updated_at: now };
  }
  return { mMIDR: 0, rMIDR: 0, remaining: 0 };
}

// ============================================================================
// 6. POST PROJECT SHEET — save one PS, FX-convert margin → IDR, re-aggregate
// ============================================================================
app.post('/api/project-sheet', async (req, res) => {
  const { header, items } = req.body;
  if (!header || !header.psNumber) {
    return res.status(400).json({ error: 'Missing header.psNumber' });
  }
  try {
    const out = await repo.withWriteLock(async () => {
      const parsedPoDate = parseProjectSheetDate(header.poDate);
      let monthIdx = parsedPoDate.monthIdx == null ? 0 : parsedPoDate.monthIdx;
      if (monthIdx < 0 || monthIdx > 11) monthIdx = 0;

      const psYear = parseInt(header.dashboardYear) ||
        (parsedPoDate.date ? parseInt(parsedPoDate.date.slice(0, 4), 10) : new Date().getFullYear());

      // Detect canonical product dari material/project name pakai product_aliases
      let detectedProduct = null;
      let detectedSegment = null;
      if (Array.isArray(items) && items.length > 0) {
        const aliasRows = await repo.getTable('product_aliases');
        const aliases = aliasRows
          .filter(r => r.alias)
          .map(r => ({ alias: String(r.alias).toLowerCase(), canonical: r.canonical_name }))
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

      const now = new Date().toISOString();

      // ps_headers: upsert (by ps_number)
      const headersAll = await repo.getTable('ps_headers');
      const hIdx = headersAll.findIndex(h => h.ps_number === header.psNumber);
      const newHeader = {
        ps_number:           header.psNumber,
        dashboard_month_idx: monthIdx,
        dashboard_year:      psYear,
        project_code:        header.projectCode,
        project_name:        header.projectName,
        subsidiary:          header.subsidiary,
        customer_name:       header.customerName,
        supplier_name:       header.supplierName,
        po_date:             parsedPoDate.date,
        currency:            header.currency || 'IDR',
        fx_rate:             header.fxToIDR  || 1,
        net_margin_native:   header.netMarginNative != null ? header.netMarginNative : header.margin,
        sales_revenue:       header.salesIDR != null ? header.salesIDR : header.sales,
        purchase_cost:       header.purchase,
        margin:              header.marginIDR != null ? header.marginIDR : header.margin,
        margin_percentage:   header.marginPct,
        product:             detectedProduct,
        segment:             detectedSegment,
        notes:               hIdx >= 0 ? headersAll[hIdx].notes : null,
        created_at:          hIdx >= 0 ? headersAll[hIdx].created_at : now,
      };
      if (hIdx >= 0) headersAll[hIdx] = newHeader; else headersAll.push(newHeader);
      await repo.replaceTable('ps_headers', headersAll);

      // ps_items: hapus item lama PS ini, insert ulang.
      const itemsAll = await repo.getTable('ps_items');
      const keptItems = itemsAll.filter(i => i.ps_number !== header.psNumber);
      const newItems = (items || []).map(item => ({
        ps_number:         header.psNumber,
        dashboard_year:    psYear,
        dashboard_month_idx: monthIdx,
        project_name:      header.projectName,
        item_no:           item.no,
        material:          item.material,
        size:              item.size,
        length:            item.length,
        qty_val:           item.qtyVal,
        qty_unit:          item.qtyUnit,
        total_weight_kg:   item.totalWeight,
        purchase_price_kg: item.purchasePrice,
        created_at:        now,
      }));
      await repo.replaceTable('ps_items', [...keptItems, ...newItems]);

      // Re-aggregate monthly_actuals untuk (year, month) ini saja
      const actualsAll = await repo.getTable('monthly_actuals');
      const agg = reaggregateActuals(actualsAll, headersAll, monthIdx, psYear);
      await repo.replaceTable('monthly_actuals', actualsAll);

      return { monthIdx, year: psYear, mMIDR: agg.mMIDR, rMIDR: agg.rMIDR };
    });
    res.json({ success: true, message: `Imported ${header.psNumber}.`, ...out });
  } catch (err) {
    console.error('POST /api/project-sheet error:', err);
    res.status(500).json({ error: 'Failed to import Project Sheet: ' + err.message });
  }
});

// ============================================================================
// 7. DELETE PROJECT SHEET — hapus PS & re-aggregate untuk (month, year)-nya
// ============================================================================
app.delete('/api/project-sheet/:psNumber', async (req, res) => {
  const psNumber = decodeURIComponent(req.params.psNumber);
  try {
    const out = await repo.withWriteLock(async () => {
      const headersAll = await repo.getTable('ps_headers');
      const target = headersAll.find(h => h.ps_number === psNumber);
      if (!target) return { notFound: true };

      const monthIdx = target.dashboard_month_idx;
      const psYear   = target.dashboard_year;

      const remainingHeaders = headersAll.filter(h => h.ps_number !== psNumber);
      await repo.replaceTable('ps_headers', remainingHeaders);

      const itemsAll = await repo.getTable('ps_items');
      await repo.replaceTable('ps_items', itemsAll.filter(i => i.ps_number !== psNumber));

      const actualsAll = await repo.getTable('monthly_actuals');
      const agg = reaggregateActuals(actualsAll, remainingHeaders, monthIdx, psYear);
      await repo.replaceTable('monthly_actuals', actualsAll);

      return { monthIdx, year: psYear, remaining: agg.remaining };
    });
    if (out.notFound) return res.status(404).json({ error: 'PS not found' });
    res.json({ success: true, message: `${psNumber} deleted.`, ...out });
  } catch (err) {
    console.error('DELETE /api/project-sheet error:', err);
    res.status(500).json({ error: 'Failed to delete Project Sheet: ' + err.message });
  }
});

// ── Health check (buat uptime monitor) ────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await repo.ping();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Listen — taruh paling akhir biar semua route sudah terdaftar ──────────────
// Hanya listen saat dijalankan langsung (`node server.js`); saat di-require untuk
// test, app cukup diekspor tanpa membuka port.
if (require.main === module) {
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = app;
