require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
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
    const budgetsRes = await pool.query('SELECT * FROM monthly_budgets ORDER BY month_idx ASC');
    const actualsRes = await pool.query('SELECT * FROM monthly_actuals ORDER BY month_idx ASC');
    const plansRes = await pool.query('SELECT * FROM plan_revisions ORDER BY month_idx ASC, id ASC');
    const psHeadersRes = await pool.query('SELECT * FROM ps_headers ORDER BY po_date ASC');
    const psItemsRes = await pool.query('SELECT * FROM ps_items ORDER BY id ASC');

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
    const PS_CHAINS = {};
    const QTY_DATA = {};
    MONTH_KEYS.forEach(m => { PS_CHAINS[m] = []; QTY_DATA[m] = []; });

    psHeadersRes.rows.forEach((header, index) => {
      const mIdx = header.dashboard_month_idx;
      if (mIdx < 0 || mIdx > 11) return;
      const mKey = MONTH_KEYS[mIdx];
      
      PS_CHAINS[mKey].push({
        name: header.project_name || header.ps_number,
        ps: header.ps_number, customer: header.customer_name,
        revenue: parseFloat((header.sales_revenue / 1000000).toFixed(3)), 
        margin: parseFloat((header.margin / 1000000).toFixed(3)),
        pct: parseFloat(header.margin_percentage), note: header.notes
      });

      const items = psItemsRes.rows.filter(i => i.ps_number === header.ps_number);
      let totalKg = 0, totalQty = 0, unit = 'pcs';

      // Deteksi kategori dari material pertama yang berhasil dikenali
      let detectedCategory = null;

      const products = items.map(item => {
        totalKg += parseFloat(item.total_weight_kg || 0);
        totalQty += parseFloat(item.qty_val || 0);
        if(item.qty_unit) unit = item.qty_unit.trim();

        // Coba detect dari material code item
        if (!detectedCategory) {
          detectedCategory = detectCategory(item.material);
        }

        return {
          name: `${item.material} ${item.size ? '('+item.size+')' : ''}`.trim(),
          qty: `${parseFloat(item.qty_val).toLocaleString('id-ID')} ${item.qty_unit}`,
          weight: `${parseFloat(item.total_weight_kg).toLocaleString('id-ID')} KG`
        };
      });

      QTY_DATA[mKey].push({
        name: header.project_name || header.ps_number,
        color: COLORS[index % COLORS.length], customer: header.customer_name,
        totalQty: `${totalQty.toLocaleString('id-ID')} ${unit}`,
        totalWeight: `${totalKg.toLocaleString('id-ID')} KG (${Math.round(totalKg/1000).toLocaleString('id-ID')} MT)`,
        // 'category' dipakai buildChart() di frontend sebagai override
        // supaya project seperti 'Arsen 55' (GI) tetap masuk kategori yang benar
        // meski nama projectnya tidak mengandung keyword 'gi'
        category: detectedCategory,
        products: products
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
      
      await client.query(`
        INSERT INTO monthly_budgets (month_idx, margin, revenue, qty)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (month_idx) DO UPDATE SET
          margin = EXCLUDED.margin, revenue = EXCLUDED.revenue, 
          qty = EXCLUDED.qty, updated_at = CURRENT_TIMESTAMP
      `, [i, BUDGET.margin[i], BUDGET.revenue[i], qtyJson]);
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
      await client.query(`
        INSERT INTO monthly_actuals (month_idx, actual_margin, plan_margin, revenue, notes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (month_idx) DO UPDATE SET
          actual_margin = EXCLUDED.actual_margin, plan_margin = EXCLUDED.plan_margin,
          revenue = EXCLUDED.revenue, notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP
      `, [i, ACTUAL.margin[i], ACTUAL.plan[i], ACTUAL.revenue[i], ACTUAL.notes[i]]);
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
app.post('/api/project-sheet', async (req, res) => {
  const { header, items } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let monthIdx = 0;
    if (header.poDate) {
      const parts = header.poDate.split('/');
      if (parts.length >= 2) monthIdx = parseInt(parts[1]) - 1; 
    }

    await client.query(`
      INSERT INTO ps_headers (
        ps_number, dashboard_month_idx, project_code, project_name, subsidiary, 
        customer_name, supplier_name, currency, sales_revenue, purchase_cost, margin, margin_percentage
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (ps_number) DO UPDATE SET
        dashboard_month_idx = EXCLUDED.dashboard_month_idx, project_name = EXCLUDED.project_name,
        customer_name = EXCLUDED.customer_name, sales_revenue = EXCLUDED.sales_revenue,
        margin = EXCLUDED.margin, margin_percentage = EXCLUDED.margin_percentage
    `, [
      header.psNumber, monthIdx, header.projectCode, header.projectName, header.subsidiary,
      header.customerName, header.supplierName, header.currency, 
      header.sales, header.purchase, header.margin, header.marginPct
    ]);

    await client.query('DELETE FROM ps_items WHERE ps_number = $1', [header.psNumber]);
    for (const item of items) {
      await client.query(`
        INSERT INTO ps_items (
          ps_number, item_no, material, size, length, qty_val, qty_unit, total_weight_kg, purchase_price_kg
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        header.psNumber, item.no, item.material, item.size, item.length, 
        item.qtyVal, item.qtyUnit, item.totalWeight, item.purchasePrice
      ]);
    }

    // ── AUTO-AGGREGATE: Sum semua PS di bulan ini → update monthly_actuals ──
    // ps_headers.margin disimpan dalam IDR (raw).
    // monthly_actuals.actual_margin pakai satuan MIDR (juta IDR).
    // Jadi kita bagi 1,000,000 saat aggregate.
    const aggRes = await client.query(`
      SELECT
        COALESCE(SUM(margin), 0)        AS total_margin,
        COALESCE(SUM(sales_revenue), 0) AS total_revenue
      FROM ps_headers
      WHERE dashboard_month_idx = $1
    `, [monthIdx]);

    const totalMarginMIDR  = parseFloat(aggRes.rows[0].total_margin)  / 1_000_000;
    const totalRevenueMIDR = parseFloat(aggRes.rows[0].total_revenue) / 1_000_000;

    await client.query(`
      INSERT INTO monthly_actuals (month_idx, actual_margin, revenue)
      VALUES ($1, $2, $3)
      ON CONFLICT (month_idx) DO UPDATE SET
        actual_margin = EXCLUDED.actual_margin,
        revenue       = EXCLUDED.revenue,
        updated_at    = CURRENT_TIMESTAMP
    `, [monthIdx, totalMarginMIDR, totalRevenueMIDR]);

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Imported ${header.psNumber} successfully.`,
      aggregated: { monthIdx, totalMarginMIDR, totalRevenueMIDR }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to import Project Sheet' });
  } finally {
    client.release();
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));