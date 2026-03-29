require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Anti-crawl / Anti-indexing middleware ─────────────────────────────────────
app.use((req, res, next) => {
  // Block semua crawler dan spider
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, nocache');
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Serve robots.txt yang melarang semua crawler
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

// Deny AI crawlers by checking User-Agent
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

app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  ssl: { rejectUnauthorized: false }
});

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const COLORS = ['#f59e0b', '#a78bfa', '#22d3ee', '#4ade80', '#fb923c', '#818cf8', '#38bdf8'];

// ── Detect product category from material code ──────────────────────────────
// Dipake saat build QTY_DATA supaya chart bisa map MT per kategori
// dari material aktual di ps_items, bukan dari nama project saja.
function detectCategory(materialCode) {
  const m = (materialCode || '').toLowerCase().trim();
  const prefix = m.includes('-') ? m.split('-')[0].trim() : '';

  // Prioritas 1: prefix kode material (paling reliable)
  if (prefix === 'sp' || prefix === 'sh')               return 'sheetPile';
  if (prefix.startsWith('gi'))                          return 'gi';
  if (prefix.startsWith('gl') && prefix !== 'gla')      return 'gl';
  if (prefix.startsWith('ppgl'))                        return 'ppgl';
  if (prefix.startsWith('erw'))                         return 'erwPipe';

  // Prioritas 2: keyword dalam deskripsi material
  if (m.includes('sheet pile') || m.includes('sy295') || m.includes('sy390')) return 'sheetPile';
  if (m.includes('ppgl') || m.includes('sssc'))         return 'ppgl';
  if (m.includes('az100') || m.includes('galvalume'))   return 'ppgl';
  if (m.includes('galvanized'))                         return 'gi';
  if (m.includes('erw'))                                return 'erwPipe';
  if (m.includes('sni 2013') || m.includes('seamless') || m.includes('pipe')) return 'weldedPipe';

  return null; // unknown — fallback ke name-match di frontend
}

// ============================================================================
// 1. GET DATA: Fetch everything for the dashboard from PostgreSQL
// ============================================================================
app.get('/api/data', async (req, res) => {
  try {
    // Filter by year — default 2026 jika tidak ada query param
    const year = parseInt(req.query.year) || 2026;

    const budgetsRes  = await pool.query('SELECT * FROM monthly_budgets  WHERE year = $1 ORDER BY month_idx ASC', [year]);
    const actualsRes  = await pool.query('SELECT * FROM monthly_actuals  WHERE year = $1 ORDER BY month_idx ASC', [year]);
    const plansRes    = await pool.query('SELECT * FROM plan_revisions   WHERE year = $1 ORDER BY month_idx ASC, id ASC', [year]);
    const psHeadersRes= await pool.query('SELECT * FROM ps_headers WHERE dashboard_year = $1 ORDER BY po_date ASC', [year]);
    const psItemsRes  = await pool.query('SELECT * FROM ps_items ORDER BY id ASC');

    // 1. Build BUDGET
    const BUDGET = {
      margin: Array(12).fill(0), revenue: Array(12).fill(0),
      qty: { sheetPile: Array(12).fill(0), weldedPipe: Array(12).fill(0), erwPipe: Array(12).fill(0), gl: Array(12).fill(0), gi: Array(12).fill(0), ppgl: Array(12).fill(0) }
    };
    budgetsRes.rows.forEach(r => {
      BUDGET.margin[r.month_idx] = r.margin ? parseFloat(r.margin) : 0;
      BUDGET.revenue[r.month_idx] = r.revenue ? parseFloat(r.revenue) : 0;
      if (r.qty) {
        Object.keys(BUDGET.qty).forEach(k => {
          BUDGET.qty[k][r.month_idx] = r.qty[k] ? parseFloat(r.qty[k]) : 0;
        });
      }
    });

    // 2. Build ACTUAL
    const ACTUAL = { margin: Array(12).fill(null), plan: Array(12).fill(null), revenue: Array(12).fill(null), notes: Array(12).fill('') };
    actualsRes.rows.forEach(r => {
      ACTUAL.margin[r.month_idx] = r.actual_margin ? parseFloat(r.actual_margin) : null;
      ACTUAL.plan[r.month_idx] = r.plan_margin ? parseFloat(r.plan_margin) : null;
      ACTUAL.revenue[r.month_idx] = r.revenue ? parseFloat(r.revenue) : null;
      ACTUAL.notes[r.month_idx] = r.notes || '';
    });

    // 3. Build PLAN_REVISIONS (Pipeline)
    const PLAN_REVISIONS = Array.from({length: 12}, () => []);
    plansRes.rows.forEach(r => {
      PLAN_REVISIONS[r.month_idx].push({
        id: r.id, name: r.name, margin: r.margin ? parseFloat(r.margin) : '',
        revenue: r.revenue ? parseFloat(r.revenue) : '', notes: r.notes,
        qty: r.qty || {}, ts: r.ts
      });
    });

    // 4. Build PS_CHAINS and QTY_DATA
    // PS dengan project_name + dashboard_month_idx sama dikonsolidasi jadi SATU chain.
    // Margin tiap PS sudah tersimpan dalam IDR (konversi FX dilakukan saat upload).
    const PS_CHAINS = {};
    const QTY_DATA = {};
    MONTH_KEYS.forEach(m => { PS_CHAINS[m] = []; QTY_DATA[m] = []; });

    // Group ps_headers by (project_name, dashboard_month_idx)
    const projectGroups = {};
    psHeadersRes.rows.forEach(header => {
      const mIdx = header.dashboard_month_idx;
      if (mIdx < 0 || mIdx > 11) return;
      const groupKey = (header.project_name || header.ps_number) + '__' + mIdx;
      if (!projectGroups[groupKey]) {
        projectGroups[groupKey] = {
          mIdx, mKey: MONTH_KEYS[mIdx],
          projectName: header.project_name || header.ps_number,
          customer: header.customer_name,
          headers: []
        };
      }
      projectGroups[groupKey].headers.push(header);
    });

    let colorIdx = 0;
    Object.values(projectGroups).forEach(group => {
      const { mIdx, mKey, projectName, customer, headers } = group;

      // Consolidated: SUM margin & revenue dari semua PS dalam group
      const totalMarginIDR  = headers.reduce((s, h) => s + parseFloat(h.margin || 0), 0);
      const totalRevenueIDR = headers.reduce((s, h) => s + parseFloat(h.sales_revenue || 0), 0);
      const totalPct = totalRevenueIDR > 0
        ? parseFloat((totalMarginIDR / totalRevenueIDR * 100).toFixed(4)) : 0;

      PS_CHAINS[mKey].push({
        name:     projectName,
        ps:       headers.map(h => h.ps_number).join(' · '),
        customer: customer,
        revenue:  parseFloat((totalRevenueIDR / 1000000).toFixed(3)),
        margin:   parseFloat((totalMarginIDR  / 1000000).toFixed(3)),
        pct:      totalPct,
        note:     headers.map(h => h.notes).filter(Boolean).join(' | '),
        // Subsidiaries breakdown untuk ditampilkan di modal detail
        subsidiaries: headers.map(h => ({
          ps:           h.ps_number,
          sub:          h.subsidiary || '',
          currency:     h.currency   || 'IDR',
          fxRate:       parseFloat(h.fx_rate || 1),
          marginNative: parseFloat(h.net_margin_native || h.margin || 0),
          marginIDR:    parseFloat(h.margin || 0),
          marginMIDR:   parseFloat((h.margin / 1000000).toFixed(3)),
          pct:          parseFloat(h.margin_percentage || 0),
        })),
      });

      // QTY_DATA: gabungkan items dari semua PS dalam group ini
      let totalKg = 0, totalQty = 0, unit = 'pcs';
      let detectedCategory = null;
      const allProducts = [];

      headers.forEach(header => {
        const items = psItemsRes.rows.filter(i => i.ps_number === header.ps_number);
        items.forEach(item => {
          totalKg  += parseFloat(item.total_weight_kg || 0);
          totalQty += parseFloat(item.qty_val || 0);
          if (item.qty_unit) unit = item.qty_unit.trim();
          if (!detectedCategory) detectedCategory = detectCategory(item.material);
          allProducts.push({
            name:   (item.material + (item.size ? ' ('+item.size+')' : '')).trim(),
            qty:    parseFloat(item.qty_val).toLocaleString('id-ID') + ' ' + item.qty_unit,
            weight: parseFloat(item.total_weight_kg).toLocaleString('id-ID') + ' KG'
          });
        });
      });

      QTY_DATA[mKey].push({
        name:        projectName,
        color:       COLORS[colorIdx++ % COLORS.length],
        customer:    customer,
        totalQty:    totalQty.toLocaleString('id-ID') + ' ' + unit,
        totalWeight: totalKg.toLocaleString('id-ID') + ' KG (' + Math.round(totalKg/1000).toLocaleString('id-ID') + ' MT)',
        category:    detectedCategory,
        products:    allProducts,
      });
    });

    res.json({ BUDGET, ACTUAL, PLAN_REVISIONS, PS_CHAINS, QTY_DATA });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database read failed' });
  }
});

// ============================================================================
// 2. POST BUDGET: Save edited budget configuration
// ============================================================================
app.post('/api/budget', async (req, res) => {
  const { BUDGET } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < 12; i++) {
      const qtyJson = {};
      Object.keys(BUDGET.qty).forEach(k => { qtyJson[k] = BUDGET.qty[k][i]; });
      
      // budget_year dikirim dari frontend (BUDGET_YEAR dari modal)
      const bYear = req.body.year || 2026;
      await client.query(`
        INSERT INTO monthly_budgets (month_idx, year, margin, revenue, qty)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (month_idx, year) DO UPDATE SET
          margin = EXCLUDED.margin, revenue = EXCLUDED.revenue,
          qty = EXCLUDED.qty, updated_at = CURRENT_TIMESTAMP
      `, [i, bYear, BUDGET.margin[i], BUDGET.revenue[i], qtyJson]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Database write failed' });
  } finally {
    client.release();
  }
});

// ============================================================================
// 3. POST DATA: Save manual pipeline inputs & actuals
// ============================================================================
app.post('/api/data', async (req, res) => {
  const { ACTUAL, PLAN_REVISIONS } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < 12; i++) {
      const aYear = req.body.year || 2026;
      await client.query(`
        INSERT INTO monthly_actuals (month_idx, year, actual_margin, plan_margin, revenue, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (month_idx, year) DO UPDATE SET
          actual_margin = EXCLUDED.actual_margin, plan_margin = EXCLUDED.plan_margin,
          revenue = EXCLUDED.revenue, notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP
      `, [i, aYear, ACTUAL.margin[i], ACTUAL.plan[i], ACTUAL.revenue[i], ACTUAL.notes[i]]);
    }

    await client.query('DELETE FROM plan_revisions');
    for (let i = 0; i < 12; i++) {
      for (const rev of PLAN_REVISIONS[i]) {
        await client.query(`
          INSERT INTO plan_revisions (month_idx, name, margin, revenue, notes, qty, ts)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [i, rev.name, rev.margin !== '' ? rev.margin : null, rev.revenue !== '' ? rev.revenue : null, rev.notes, rev.qty, rev.ts]);
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database write failed' });
  } finally {
    client.release();
  }
});

// ============================================================================
// 4. POST PROJECT SHEET: Handle Parsed CSV Upload
// ============================================================================
// ============================================================================
// 4. POST PROJECT SHEET (single): simpan satu PS, FX-convert margin ke IDR
// ============================================================================
app.post('/api/project-sheet', async (req, res) => {
  const { header, items } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Hitung monthIdx dari PO Date
    let monthIdx = 0;
    if (header.poDate) {
      const parts = header.poDate.split('/');
      if (parts.length >= 2) monthIdx = parseInt(parts[1]) - 1;
    }

    // margin yang disimpan = Net Margin dalam IDR (sudah di-convert FX di frontend)
    // net_margin_native = nilai dalam currency asli file (USD/IDR/SGD)
    // fx_rate = kurs yang dipakai konversi
    await client.query(`
      INSERT INTO ps_headers (
        ps_number, dashboard_month_idx, project_code, project_name, subsidiary,
        customer_name, supplier_name, currency, fx_rate, net_margin_native,
        sales_revenue, purchase_cost, margin, margin_percentage, dashboard_year
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (ps_number) DO UPDATE SET
        dashboard_month_idx  = EXCLUDED.dashboard_month_idx,
        dashboard_year       = EXCLUDED.dashboard_year,
        project_name         = EXCLUDED.project_name,
        customer_name        = EXCLUDED.customer_name,
        sales_revenue        = EXCLUDED.sales_revenue,
        purchase_cost        = EXCLUDED.purchase_cost,
        currency             = EXCLUDED.currency,
        fx_rate              = EXCLUDED.fx_rate,
        net_margin_native    = EXCLUDED.net_margin_native,
        margin               = EXCLUDED.margin,
        margin_percentage    = EXCLUDED.margin_percentage
    `, [
      header.psNumber, monthIdx, header.projectCode, header.projectName, header.subsidiary,
      header.customerName, header.supplierName,
      header.currency    || 'IDR',
      header.fxToIDR     || 1,
      header.netMarginNative || header.margin,
      header.salesIDR    || header.sales,
      header.purchase,
      header.marginIDR   || header.margin,   // margin in IDR (after FX)
      header.marginPct,
      header.dashboardYear || new Date().getFullYear(),
    ]);

    await client.query('DELETE FROM ps_items WHERE ps_number = $1', [header.psNumber]);
    for (const item of items) {
      await client.query(`
        INSERT INTO ps_items (
          ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        header.psNumber, item.no, item.material, item.size, item.length,
        item.qtyVal, item.qtyUnit, item.totalWeight, item.purchasePrice
      ]);
    }

    // Re-aggregate monthly_actuals untuk bulan ini
    const psYear = header.dashboardYear || new Date().getFullYear();
    const agg = await client.query(`
      SELECT COALESCE(SUM(margin),0) AS m, COALESCE(SUM(sales_revenue),0) AS r
      FROM ps_headers WHERE dashboard_month_idx = $1 AND dashboard_year = $2
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
    res.json({ success: true, message: `Imported ${header.psNumber}.`, monthIdx, mMIDR, rMIDR });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to import Project Sheet: ' + err.message });
  } finally {
    client.release();
  }
});


app.listen(port, () => console.log(`Server running on port ${port}`));
// ============================================================================
// 5. DELETE PROJECT SHEET: Hapus PS & re-aggregate monthly_actuals
// ============================================================================
app.delete('/api/project-sheet/:psNumber', async (req, res) => {
  const psNumber = decodeURIComponent(req.params.psNumber);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cari bulan dari PS yang akan dihapus
    const findRes = await client.query(
      'SELECT dashboard_month_idx FROM ps_headers WHERE ps_number = $1',
      [psNumber]
    );
    if (findRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PS not found' });
    }
    const monthIdx = findRes.rows[0].dashboard_month_idx;

    // Hapus items & header
    await client.query('DELETE FROM ps_items WHERE ps_number = $1', [psNumber]);
    await client.query('DELETE FROM ps_headers WHERE ps_number = $1', [psNumber]);

    // Re-aggregate: SUM ulang semua PS yang tersisa di bulan ini
    const remaining = parseInt(
      (await client.query('SELECT COUNT(*) FROM ps_headers WHERE dashboard_month_idx = $1', [monthIdx]))
      .rows[0].count
    );

    if (remaining > 0) {
      const agg = await client.query(`
        SELECT COALESCE(SUM(margin),0) AS m, COALESCE(SUM(sales_revenue),0) AS r
        FROM ps_headers WHERE dashboard_month_idx = $1
      `, [monthIdx]);
      await client.query(`
        UPDATE monthly_actuals
        SET actual_margin = $1, revenue = $2, updated_at = CURRENT_TIMESTAMP
        WHERE month_idx = $3
      `, [parseFloat(agg.rows[0].m)/1e6, parseFloat(agg.rows[0].r)/1e6, monthIdx]);
    } else {
      // Tidak ada PS tersisa → kembalikan ke NULL (tampilkan "—" di dashboard)
      await client.query(`
        UPDATE monthly_actuals
        SET actual_margin = NULL, revenue = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE month_idx = $1
      `, [monthIdx]);
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `${psNumber} deleted.`, monthIdx, remaining });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to delete Project Sheet' });
  } finally {
    client.release();
  }
});