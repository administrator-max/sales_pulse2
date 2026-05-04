// ============================================================================
// BUDGET IMPORT — parse Excel (Volume / Revenue / Margin sections) →
// kirim per-line ke /api/budget/import → reload dashboard.
// Excel structure (mirror Budget - 2026.xlsx):
//   Row 0: YEAR | <year>
//   Section header: row dengan col[0] = "VOLUME" / "REVENUE" / "MARGIN"
//   2 rows below: column headers (Salesperson, Segment, Product, Import/Local, [12 months], Total)
//   Data rows: ~22 baris per section
//   Section closer: "Total Volume (MT)" / "Total Revenue (IDR)" / "Total Margin (IDR)"
// ============================================================================

let _budgetParsed = null;       // { year, lines: [...], stats: {...} }
let _budgetProductMap = null;   // { alias_lowercase: canonical_name }

// ── Year stepper: target import + delete ──────────────────────────────────
// Default = FILTER_YEAR (year aktif di dashboard). Bisa di-override user.
function _getBudgetImportYear() {
  const inp = document.getElementById('bi-year-input');
  const v = inp ? parseInt(inp.value) : NaN;
  if (Number.isInteger(v) && v >= 2000 && v <= 2100) return v;
  return (typeof FILTER_YEAR !== 'undefined') ? FILTER_YEAR : new Date().getFullYear();
}
function _setBudgetImportYear(y) {
  const inp = document.getElementById('bi-year-input');
  if (inp) inp.value = String(y);
}
function shiftBudgetImportYear(delta) {
  _setBudgetImportYear(_getBudgetImportYear() + delta);
  onBudgetImportYearChange();
}
function onBudgetImportYearChange() {
  // Sync ke parsed payload kalau ada — supaya preview total/year konsisten
  if (_budgetParsed) {
    _budgetParsed.year = _getBudgetImportYear();
    renderBudgetPreview(_budgetParsed);
  }
}

// ── Open / Close modal ──────────────────────────────────────────────────────
async function openBudgetImportModal() {
  // Pre-load product mapping (sekali per session)
  if (!_budgetProductMap) {
    try {
      const r = await fetch('/api/products');
      const d = await r.json();
      _budgetProductMap = {};
      Object.entries(d.aliases || {}).forEach(([alias, canonical]) => {
        _budgetProductMap[alias.toLowerCase().trim()] = canonical;
      });
    } catch (e) {
      showToast('Gagal load product mapping: ' + e.message, true);
      return;
    }
  }
  resetBudgetImport();
  // Default tahun = year aktif di dashboard
  _setBudgetImportYear((typeof FILTER_YEAR !== 'undefined') ? FILTER_YEAR : new Date().getFullYear());
  document.getElementById('budget-import-overlay').classList.add('open');
}

function closeBudgetImportModal(e, force) {
  if (!force && e && e.target !== document.getElementById('budget-import-overlay')) return;
  document.getElementById('budget-import-overlay').classList.remove('open');
}

function resetBudgetImport() {
  _budgetParsed = null;
  document.getElementById('bi-dropzone').style.display = 'block';
  document.getElementById('bi-preview').style.display  = 'none';
  document.getElementById('bi-warn').style.display     = 'none';
  document.getElementById('bi-file-info').textContent  = 'Belum ada file dipilih';
  document.getElementById('bi-submit').disabled = true;
  document.getElementById('bi-submit').classList.remove('ready');
  const inp = document.getElementById('bi-file-input');
  if (inp) inp.value = '';
}

// ── File pickers ────────────────────────────────────────────────────────────
function handleBudgetDrop(event) {
  event.preventDefault();
  document.getElementById('bi-dropzone').classList.remove('upload-dz-hover');
  const f = event.dataTransfer.files[0];
  if (f) processBudgetFile(f);
}
function handleBudgetSelect(event) {
  const f = event.target.files[0];
  if (f) processBudgetFile(f);
}

// ── Parse + preview ─────────────────────────────────────────────────────────
async function processBudgetFile(file) {
  document.getElementById('bi-file-info').textContent = `⏳ Memproses ${file.name}...`;
  try {
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const parsed = parseBudgetExcel(rows);
    parsed._fileName = file.name;
    _budgetParsed = parsed;

    // Auto-set tahun stepper dari Excel (kalau detected). User masih bisa override.
    if (parsed.year) _setBudgetImportYear(parsed.year);

    renderBudgetPreview(parsed);
    document.getElementById('bi-submit').disabled = false;
    document.getElementById('bi-submit').classList.add('ready');
  } catch (err) {
    showBudgetWarn('Gagal parse: ' + err.message);
  }
}

// ── Excel → { year, lines: [{month_idx, segment, product, volume_mt, revenue_idr, margin_idr}] }
function parseBudgetExcel(rows) {
  const get = (r, c) => (r && r.length > c) ? r[c] : '';
  const cleanNum = v => {
    if (v === '' || v == null) return 0;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/,/g, '').trim();
    return parseFloat(s) || 0;
  };

  // 1. Cari YEAR (row 0 col 1)
  let year = parseInt(get(rows[0], 1)) || new Date().getFullYear();

  // 2. Locate section starts
  const sections = {};
  rows.forEach((r, idx) => {
    const v = String(get(r, 0)).trim().toUpperCase();
    if (v === 'VOLUME')  sections.volume  = idx;
    if (v === 'REVENUE') sections.revenue = idx;
    if (v === 'MARGIN')  sections.margin  = idx;
  });
  if (!sections.volume || !sections.revenue || !sections.margin) {
    throw new Error('Format tidak dikenali — perlu section VOLUME, REVENUE, MARGIN');
  }

  // 3. Parse setiap section. Data row = section_start + 3 .. sampai "Total ..." row
  // Header row di section_start + 1 → kolom: 0=Salesperson, 1=Segment, 2=Product, 3=Import/Local, 4..15 = bulan Jan..Dec
  const parseSection = (startIdx, metricName) => {
    const out = [];   // { rowIdx, segment, product (canonical), monthIdx, value }
    for (let i = startIdx + 3; i < rows.length; i++) {
      const r = rows[i];
      const c0 = String(get(r, 0)).trim();
      // berhenti kalau ketemu Total row atau row kosong + header section berikutnya
      if (/^total/i.test(c0)) break;
      if (!c0) continue;

      const segment   = String(get(r, 1)).trim();
      const productRaw = String(get(r, 2)).trim();
      if (!productRaw) continue;

      // Map alias → canonical
      const canonical = _budgetProductMap[productRaw.toLowerCase()] || productRaw;

      // 12 monthly columns: index 4..15
      for (let m = 0; m < 12; m++) {
        const v = cleanNum(get(r, 4 + m));
        if (v !== 0) {
          out.push({ segment, product: canonical, monthIdx: m, value: v });
        }
      }
    }
    return out;
  };

  const volume  = parseSection(sections.volume,  'volume');
  const revenue = parseSection(sections.revenue, 'revenue');
  const margin  = parseSection(sections.margin,  'margin');

  // 4. Merge per (segment, product, monthIdx) → satu row dengan 3 metric
  const map = {};
  const upsert = (rec, metric) => {
    const key = `${rec.segment}|${rec.product}|${rec.monthIdx}`;
    if (!map[key]) {
      map[key] = {
        segment: rec.segment, product: rec.product, month_idx: rec.monthIdx,
        volume_mt: 0, revenue_idr: 0, margin_idr: 0,
      };
    }
    map[key][metric] += rec.value;
  };
  volume.forEach(r  => upsert(r, 'volume_mt'));
  revenue.forEach(r => upsert(r, 'revenue_idr'));
  margin.forEach(r  => upsert(r, 'margin_idr'));

  const lines = Object.values(map);

  // 5. Stats untuk preview
  const stats = {
    totalLines: lines.length,
    totalVolume:  lines.reduce((s, l) => s + l.volume_mt,   0),
    totalRevenue: lines.reduce((s, l) => s + l.revenue_idr, 0),
    totalMargin:  lines.reduce((s, l) => s + l.margin_idr,  0),
    products: [...new Set(lines.map(l => l.product))].sort(),
    segments: [...new Set(lines.map(l => l.segment))].sort(),
    monthsCovered: [...new Set(lines.map(l => l.month_idx))].sort((a,b)=>a-b),
  };

  return { year, lines, stats };
}

// ── Preview rendering ───────────────────────────────────────────────────────
function renderBudgetPreview(parsed) {
  document.getElementById('bi-dropzone').style.display = 'none';
  document.getElementById('bi-preview').style.display  = 'block';

  const { year, lines, stats } = parsed;
  const fmt = v => Math.round(v).toLocaleString('id-ID');
  const fmtB = v => (v / 1e9).toFixed(2) + ' B';

  document.getElementById('bi-file-info').textContent =
    `${parsed._fileName} · ${stats.totalLines} lines · year ${year}`;

  // Stats grid
  document.getElementById('bi-stats').innerHTML = `
    <div class="bi-stat">
      <div class="bi-stat-label">Tahun</div>
      <div class="bi-stat-val" style="color:var(--brand-dark)">${year}</div>
    </div>
    <div class="bi-stat">
      <div class="bi-stat-label">Total Volume</div>
      <div class="bi-stat-val">${fmt(stats.totalVolume)} MT</div>
    </div>
    <div class="bi-stat">
      <div class="bi-stat-label">Total Revenue</div>
      <div class="bi-stat-val" style="color:var(--brand-blue)">Rp ${fmtB(stats.totalRevenue)}</div>
    </div>
    <div class="bi-stat">
      <div class="bi-stat-label">Total Margin</div>
      <div class="bi-stat-val" style="color:var(--brand-green-dark)">Rp ${fmtB(stats.totalMargin)}</div>
    </div>
  `;

  // Product chips
  document.getElementById('bi-products').innerHTML = stats.products
    .map(p => `<span class="bi-chip">${p}</span>`)
    .join('');

  document.getElementById('bi-meta').innerHTML = `
    <div><strong>${stats.segments.length}</strong> segment(s) · <strong>${stats.products.length}</strong> product(s) · <strong>${stats.monthsCovered.length}</strong> bulan</div>
    <div style="font-size:11px;color:var(--muted);margin-top:4px;">Segments: ${stats.segments.join(', ')}</div>
  `;
}

function showBudgetWarn(msg) {
  const w = document.getElementById('bi-warn');
  w.textContent = '⚠️ ' + msg;
  w.style.display = 'block';
  document.getElementById('bi-submit').disabled = true;
  document.getElementById('bi-submit').classList.remove('ready');
}

// ── Submit ──────────────────────────────────────────────────────────────────
async function submitBudgetImport() {
  if (!_budgetParsed) return;
  const targetYear = _getBudgetImportYear();          // user-selected (override Excel)
  const btn = document.getElementById('bi-submit');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Mengimpor...';

  try {
    const res = await fetch('/api/budget/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: targetYear, lines: _budgetParsed.lines }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    showToast(`✓ Budget ${targetYear} berhasil di-import (${data.rowsInserted} baris)`);
    closeBudgetImportModal(null, true);
    // Switch dashboard ke tahun yang baru di-import biar langsung kelihatan
    if (typeof FILTER_YEAR !== 'undefined' && FILTER_YEAR !== targetYear) {
      FILTER_YEAR = targetYear;
      const lbl = document.getElementById('filter-year-label');
      if (lbl) lbl.textContent = FILTER_YEAR;
      if (typeof _updateFilterBadge === 'function') _updateFilterBadge();
    }
    if (typeof initApp === 'function') initApp();
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.classList.add('ready');
    btn.textContent = 'Import ke Database';
    showToast('Gagal: ' + err.message, true);
  }
}

// ── Delete budget for a year ────────────────────────────────────────────────
async function deleteBudgetForYear() {
  const year = _getBudgetImportYear();   // pakai stepper di modal, bukan FILTER_YEAR
  if (!confirm(`Hapus seluruh budget tahun ${year}?\nTindakan ini tidak bisa dibatalkan.`)) return;

  try {
    const res = await fetch(`/api/budget/${year}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`✓ Budget ${year} dihapus (${data.rowsDeleted} baris)`);
    if (typeof initApp === 'function') initApp();
  } catch (err) {
    showToast('Gagal hapus: ' + err.message, true);
  }
}
