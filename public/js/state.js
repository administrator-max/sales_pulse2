// ── STATE VARIABLES & CONSTANTS ──
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NOW_MONTH = new Date().getMonth();

const PRODUCT_COLORS = [
  '#373896', '#2077BD', '#0A6A36', '#2AB675', '#6D6E71', '#231F20',
  '#7C3AED', '#D97706', '#0F766E', '#BE123C', '#4B5563', '#2563EB'
];

const LEGACY_PRODUCT_KEY_TO_CANONICAL = {
  sheetPile: 'Sheet Pile',
  weldedPipe: 'ERW Pipe',
  erwPipe: 'ERW Pipe',
  gl: 'Galvalume',
  gi: 'Galvanized',
  ppgl: 'PPGL'
};

// Dynamic State (Fetched exclusively from DB)
let BUDGET = {
  margin: Array(12).fill(0),
  revenue: Array(12).fill(0),
  products: {}   // canonical_product → { volume:[12], revenue:[12], margin:[12] }
};
let ACTUAL = { margin: Array(12).fill(null), plan: Array(12).fill(null), revenue: Array(12).fill(null), notes: Array(12).fill('') };
let ACTUAL_PRODUCTS = {};   // canonical_product → { volume:[12], revenue:[12], margin:[12] }
let PLAN_REVISIONS = Array.from({length:12}, ()=>[]);
let PS_CHAINS = {};
let QTY_DATA = {};
let selectedMonth = NOW_MONTH <= 11 ? NOW_MONTH : 11;
let SP_ACTIVE_REV = Array(12).fill(0);
let ANALYTICS_PERIOD_MODE = 'ytd'; // ytd = Jan..anchor, mtd = anchor month only

// Chart filter: '__all__' (aggregate) atau canonical product name
let CHART_PRODUCT = '__all__';
function setChartProduct(p) {
  CHART_PRODUCT = p;
  if (typeof buildChart === 'function') buildChart();
}

// ── Dashboard filter state ───────────────────────────────────────────────────
let FILTER_YEAR  = new Date().getFullYear();
let FILTER_MONTH = -1; // -1 = all months, 0-11 = specific month
const _MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _MF = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function shiftFilterYear(delta) {
  FILTER_YEAR += delta;
  _syncYearLabels();
  _updateFilterBadge();
  // Re-fetch data dari server dengan tahun baru
  initApp();
}

function _syncYearLabels() {
  ['filter-year-label', 'h-title-year', 'footer-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = FILTER_YEAR;
  });
}

function setFilterMonth(month) {
  FILTER_MONTH = month;
  // Update dropdown item active state
  document.querySelectorAll('.month-dd-item').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.month) === month);
  });
  // Update button label
  const lbl = document.getElementById('filter-month-label');
  if (lbl) lbl.textContent = month === -1 ? 'All Months' : _MF[month];
  // Close dropdown
  const dd = document.getElementById('filter-month-dropdown');
  if (dd) dd.style.display = 'none';
  _updateFilterBadge();
  refreshAll();
}

function getReportedMonthIndices() {
  const seen = new Set();

  ACTUAL.margin.forEach((v, i) => {
    if (v != null || ACTUAL.revenue[i] != null || ACTUAL.plan[i] != null) seen.add(i);
  });
  Object.values(ACTUAL_PRODUCTS || {}).forEach(product => {
    ['volume', 'revenue', 'margin'].forEach(metric => {
      (product[metric] || []).forEach((v, i) => { if (toNum(v) !== 0) seen.add(i); });
    });
  });
  MONTH_KEYS.forEach((mk, i) => {
    if ((PS_CHAINS[mk] || []).length > 0 || (QTY_DATA[mk] || []).length > 0) seen.add(i);
  });

  return Array.from(seen).sort((a, b) => a - b);
}

function getAnalyticsAnchorMonthIndex() {
  const fm = (typeof FILTER_MONTH !== 'undefined') ? FILTER_MONTH : -1;
  if (fm >= 0 && fm <= 11) return fm;
  const reported = getReportedMonthIndices();
  return reported.length ? reported[reported.length - 1] : Math.min(NOW_MONTH, 11);
}

function getAnalyticsMonthIndices(mode = ANALYTICS_PERIOD_MODE) {
  const anchor = getAnalyticsAnchorMonthIndex();
  if (mode === 'mtd') return [anchor];
  return Array.from({ length: anchor + 1 }, (_, i) => i);
}

function getAnalyticsPeriodLabel(mode = ANALYTICS_PERIOD_MODE) {
  const anchor = getAnalyticsAnchorMonthIndex();
  if (mode === 'mtd') return `${_MS[anchor]} ${FILTER_YEAR}`;
  return `YTD Jan-${_MS[anchor]} ${FILTER_YEAR}`;
}

function setAnalyticsPeriodMode(mode) {
  ANALYTICS_PERIOD_MODE = mode === 'mtd' ? 'mtd' : 'ytd';
  document.querySelectorAll('.analytics-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === ANALYTICS_PERIOD_MODE);
  });
  if (typeof updateKPIs === 'function') updateKPIs();
  if (typeof buildAnalytics === 'function') buildAnalytics();
}

function toggleDataMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('data-action-dropdown');
  if (!menu) return;
  menu.classList.toggle('open');

  if (menu.classList.contains('open')) {
    setTimeout(() => {
      const handler = (e) => {
        if (!menu.contains(e.target) && !e.target.closest('.header-action-menu')) {
          closeDataMenu();
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 0);
  }
}

function closeDataMenu() {
  const menu = document.getElementById('data-action-dropdown');
  if (menu) menu.classList.remove('open');
}

function toggleMonthDropdown() {
  const dd = document.getElementById('filter-month-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  // Close on outside click
  if (dd.style.display === 'block') {
    setTimeout(() => {
      const handler = (e) => {
        if (!dd.contains(e.target) && e.target.id !== 'filter-month-btn' && !document.getElementById('filter-month-btn').contains(e.target)) {
          dd.style.display = 'none';
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 0);
  }
}

function _updateFilterBadge() {
  const badge     = document.getElementById('filter-active-badge');
  const resetBtn  = document.getElementById('filter-reset-btn');
  const tableTag  = document.getElementById('table-filter-label');
  const filterBtn = document.getElementById('filter-month-btn');

  const isFiltered = FILTER_MONTH !== -1;
  const labelText  = isFiltered ? (_MS[FILTER_MONTH] + ' ' + FILTER_YEAR) : ('All · ' + FILTER_YEAR);

  if (badge)    { badge.style.display = isFiltered ? 'inline-block' : 'none'; badge.textContent = labelText; }
  if (resetBtn) { resetBtn.style.display = isFiltered ? 'block' : 'none'; }
  if (tableTag) { tableTag.textContent = isFiltered ? (_MF[FILTER_MONTH] + ' ' + FILTER_YEAR) : ('All ' + FILTER_YEAR); }
  // Highlight the button when filtered (header is dark blue, so use white tint)
  if (filterBtn) {
    filterBtn.style.borderColor = isFiltered ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)';
    filterBtn.style.background  = isFiltered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)';
  }
}

function openProductSummaryModal() {
  const el = document.getElementById('product-summary-overlay');
  if (el) el.style.display = 'flex';
}

function closeProductSummaryModal() {
  const el = document.getElementById('product-summary-overlay');
  if (el) el.style.display = 'none';
}

// ── INIT & FETCH FROM DATABASE ──
async function initApp() {
  _syncYearLabels();
  try {
    const res = await fetch('/api/data?year=' + (typeof FILTER_YEAR !== 'undefined' ? FILTER_YEAR : new Date().getFullYear()));
    if (res.ok) {
      const data = await res.json();
      BUDGET = data.BUDGET || BUDGET;
      ACTUAL = data.ACTUAL || ACTUAL;
      ACTUAL_PRODUCTS = data.ACTUAL_PRODUCTS || {};
      PLAN_REVISIONS = data.PLAN_REVISIONS || PLAN_REVISIONS;
      PS_CHAINS = data.PS_CHAINS || {};
      QTY_DATA = data.QTY_DATA || {};

      // Ensure month keys exist in dynamic dictionaries
      MONTH_KEYS.forEach(m => {
         if (!PS_CHAINS[m]) PS_CHAINS[m] = [];
         if (!QTY_DATA[m]) QTY_DATA[m] = [];
      });

      // Populate chart product dropdown from canonical product pipeline.
      const dd = document.getElementById('chart-product-filter');
      if (dd) {
        const products = getCanonicalProductNames();
        dd.innerHTML = '<option value="__all__">Semua Produk (aggregate)</option>'
          + products.map(p => `<option value="${p}">${p}</option>`).join('');
        if (CHART_PRODUCT !== '__all__' && !products.includes(CHART_PRODUCT)) CHART_PRODUCT = '__all__';
        dd.value = CHART_PRODUCT;
      }

      refreshAll();
    }
  } catch (e) {
    showToast("Error connecting to database", true);
  }
}

async function persist() {
  try {
    await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ACTUAL, PLAN_REVISIONS, year: FILTER_YEAR })
    });
    showToast("Saved to Database ✓");
  } catch (e) {
    showToast("Error saving data", true);
  }
}

// ── UTILITIES ──
const fmt = (v, d=2) => v == null ? '—' : Number(v).toLocaleString('id-ID', {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtP = v => v == null ? '—' : v.toFixed(2) + '%';
const sum = arr => arr.filter(v => v != null).reduce((a,b)=>a+b,0);
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function showToast(msg, isErr=false){
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-dot').className = 'toast-dot' + (isErr ? ' err' : '');
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
}

function weightToMT(tw) { 
  const kgPart = String(tw || '').split('(')[0].replace(/kg/i, '');
  return parseLocaleNumber(kgPart) / 1000;
}

function parseLocaleNumber(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;

  let s = String(raw).trim().replace(/\s/g, '');
  const match = s.match(/-?[\d.,]+/);
  if (!match) return 0;
  s = match[0];

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length <= 3
      ? parts[0] + '.' + parts[1]
      : s.replace(/,/g, '');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) {
      s = parts.join('');
    } else {
      s = parts[1].length === 3 && parts[0].length <= 3
        ? parts.join('')
        : s;
    }
  }

  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getActiveMonthIndices() {
  const fm = (typeof FILTER_MONTH !== 'undefined') ? FILTER_MONTH : -1;
  return fm === -1 ? Array.from({ length: 12 }, (_, i) => i) : [fm];
}

function getMetricValue(source, productName, metric, monthIdx) {
  return toNum(source?.[productName]?.[metric]?.[monthIdx]);
}

function sumProductMetric(source, productName, metric, indices) {
  return indices.reduce((s, i) => s + getMetricValue(source, productName, metric, i), 0);
}

function getPlanQtyValue(qty, productName) {
  if (!qty) return 0;
  const direct = parseFloat(qty[productName]);
  if (Number.isFinite(direct)) return direct;
  return Object.entries(LEGACY_PRODUCT_KEY_TO_CANONICAL)
    .filter(([, canonical]) => canonical === productName)
    .reduce((s, [legacyKey]) => s + (parseFloat(qty[legacyKey]) || 0), 0);
}

function getCanonicalProductNames(options = {}) {
  const { includeEmpty = false } = options;
  const names = [];
  const seen = new Set();
  const add = (name) => {
    const label = String(name || '').trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    names.push(label);
  };

  Object.keys(BUDGET.products || {}).forEach(add);
  Object.keys(ACTUAL_PRODUCTS || {}).forEach(add);
  PLAN_REVISIONS.forEach(revs => (revs || []).forEach(rev => {
    Object.keys(rev.qty || {}).forEach(key => add(LEGACY_PRODUCT_KEY_TO_CANONICAL[key] || key));
  }));
  Object.values(QTY_DATA || {}).forEach(projects => (projects || []).forEach(p => add(p.product)));

  if (includeEmpty) return names;

  return names.filter(product => {
    const hasBudget = ['volume', 'revenue', 'margin']
      .some(metric => (BUDGET.products?.[product]?.[metric] || []).some(v => toNum(v) !== 0));
    const hasActual = ['volume', 'revenue', 'margin']
      .some(metric => (ACTUAL_PRODUCTS?.[product]?.[metric] || []).some(v => toNum(v) !== 0));
    const hasPlan = PLAN_REVISIONS.some(revs => (revs || []).some(rev => getPlanQtyValue(rev.qty, product) > 0));
    return hasBudget || hasActual || hasPlan;
  });
}

function getProductColor(productName, fallbackIndex = 0) {
  const names = getCanonicalProductNames({ includeEmpty: true });
  const idx = names.indexOf(productName);
  const colorIndex = idx >= 0 ? idx : fallbackIndex;
  return PRODUCT_COLORS[((colorIndex % PRODUCT_COLORS.length) + PRODUCT_COLORS.length) % PRODUCT_COLORS.length];
}

function getProductRgba(productName, fallbackIndex = 0, alpha = 0.90) {
  const hex = getProductColor(productName, fallbackIndex).replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getActualProductVolume(productName, monthIdx) {
  if (ACTUAL_PRODUCTS?.[productName]) {
    return getMetricValue(ACTUAL_PRODUCTS, productName, 'volume', monthIdx);
  }
  const mk = MONTH_KEYS[monthIdx];
  return (QTY_DATA[mk] || [])
    .filter(project => project.product === productName)
    .reduce((s, project) => s + weightToMT(project.totalWeight), 0);
}

function productDomId(productName) {
  return String(productName || 'product').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'product';
}

function getBudgetQtyMonthly() {
  const arr = Array(12).fill(0);
  Object.values(BUDGET.products || {}).forEach(prod => (prod.volume || []).forEach((v, i) => arr[i] += toNum(v)));
  return arr;
}

function getPlanQtyByProduct(){
  const result = {};
  getCanonicalProductNames().forEach(product => {
    result[product] = Array(12).fill(0);
    for(let i=0;i<12;i++){
      result[product][i] = (PLAN_REVISIONS[i]||[]).reduce((s,r)=>s+getPlanQtyValue(r.qty, product),0);
    }
  });
  return result;
}

function getBudgetQty(indices = getAnalyticsMonthIndices()) {
  const res = {};
  getCanonicalProductNames().forEach((product, idx) => {
    res[product] = {
      label: product,
      color: getProductColor(product, idx),
      budgetMT: sumProductMetric(BUDGET.products || {}, product, 'volume', indices)
    };
  });
  return res;
}

function getActualQtyMT(indices = getAnalyticsMonthIndices()) {
  const res = {};
  getCanonicalProductNames().forEach(product => {
    res[product] = indices.reduce((s, i) => s + getActualProductVolume(product, i), 0);
  });
  return res;
}

function refreshAll() { 
  buildChart(); buildTable(); buildWaterfall(); updateKPIs(); buildQtyPanel(); buildAnalytics(); 
}
