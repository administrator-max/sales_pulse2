// ── STATE VARIABLES & CONSTANTS ──
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NOW_MONTH = new Date().getMonth();

const QTY_PROD_LABELS = [
  { key:'sheetPile', label:'Sheet Pile' },
  { key:'weldedPipe', label:'Pipe' },
  { key:'erwPipe', label:'ERW Pipe' },
  { key:'gl', label:'GL' },
  { key:'gi', label:'GI' },
  { key:'ppgl', label:'PPGL' }
];

const PROD_CATS = [
  { key:'sheetPile',  label:'Sheet Pile', color:'#2196f3', rgba:'rgba(33,150,243,0.85)',  match: n => n.includes('mlion')||n.includes('sheet pile') },
  { key:'weldedPipe', label:'Pipe',       color:'#43a047', rgba:'rgba(67,160,71,0.85)',   match: n => n.includes('youfa')||n.includes('welded')||(n.includes('pipe')&&!n.includes('erw'))||n.includes('seamless') },
  { key:'erwPipe',    label:'ERW Pipe',   color:'#0288d1', rgba:'rgba(2,136,209,0.85)',   match: n => n.includes('erw') },
  { key:'gl',         label:'GL',         color:'#00897b', rgba:'rgba(0,137,123,0.85)',   match: n => n.includes('gl')||n.includes('galvalume') },
  { key:'gi',         label:'GI',         color:'#66bb6a', rgba:'rgba(102,187,106,0.85)', match: n => n.includes('gi ')||n.includes('galvanized')||n.includes(' gi') },
  { key:'ppgl',       label:'PPGL',       color:'#1565c0', rgba:'rgba(21,101,192,0.85)',  match: n => n.includes('sssc')||n.includes('ppgl')||n.includes('coil') },
];

// Dynamic State (Fetched exclusively from DB)
let BUDGET = {
  margin: Array(12).fill(0),
  revenue: Array(12).fill(0),
  qty: { sheetPile: Array(12).fill(0), weldedPipe: Array(12).fill(0), erwPipe: Array(12).fill(0), gl: Array(12).fill(0), gi: Array(12).fill(0), ppgl: Array(12).fill(0) }
};
let ACTUAL = { margin: Array(12).fill(null), plan: Array(12).fill(null), revenue: Array(12).fill(null), notes: Array(12).fill('') };
let PLAN_REVISIONS = Array.from({length:12}, ()=>[]);
let PS_CHAINS = {}; 
let QTY_DATA = {};
let selectedMonth = NOW_MONTH <= 11 ? NOW_MONTH : 11;
let SP_ACTIVE_REV = Array(12).fill(0);

// ── Dashboard filter state ───────────────────────────────────────────────────
let FILTER_YEAR  = new Date().getFullYear();
let FILTER_MONTH = -1; // -1 = all months, 0-11 = specific month
const _MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _MF = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function shiftFilterYear(delta) {
  FILTER_YEAR += delta;
  const lbl = document.getElementById('filter-year-label');
  if (lbl) lbl.textContent = FILTER_YEAR;
  _updateFilterBadge();
  // Re-fetch data dari server dengan tahun baru
  initApp();
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
  // Highlight the button when filtered
  if (filterBtn) {
    filterBtn.style.borderColor = isFiltered ? 'rgba(34,211,238,0.5)' : 'var(--border2)';
    filterBtn.style.color       = isFiltered ? '#22d3ee' : 'var(--text)';
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
  try {
    const res = await fetch('/api/data?year=' + (typeof FILTER_YEAR !== 'undefined' ? FILTER_YEAR : new Date().getFullYear()));
    if (res.ok) {
      const data = await res.json();
      BUDGET = data.BUDGET || BUDGET;
      ACTUAL = data.ACTUAL || ACTUAL;
      PLAN_REVISIONS = data.PLAN_REVISIONS || PLAN_REVISIONS;
      PS_CHAINS = data.PS_CHAINS || {};
      QTY_DATA = data.QTY_DATA || {};
      
      // Ensure month keys exist in dynamic dictionaries
      MONTH_KEYS.forEach(m => {
         if (!PS_CHAINS[m]) PS_CHAINS[m] = [];
         if (!QTY_DATA[m]) QTY_DATA[m] = [];
      });

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

function showToast(msg, isErr=false){
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast-dot').className = 'toast-dot' + (isErr ? ' err' : '');
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
}

function weightToMT(tw) { 
  const numStr = (tw || '').split(' ')[0].replace(/[^0-9]/g, '');
  return (parseInt(numStr) || 0) / 1000; 
}

function getBudgetQtyMonthly() {
  const arr = Array(12).fill(0);
  Object.values(BUDGET.qty).forEach(prodArr => prodArr.forEach((v, i) => arr[i] += (parseFloat(v)||0)));
  return arr;
}

function getPlanQtyByProduct(){
  const result = {};
  QTY_PROD_LABELS.forEach(p => {
    result[p.key] = Array(12).fill(0);
    for(let i=0;i<12;i++){
      result[p.key][i] = (PLAN_REVISIONS[i]||[]).reduce((s,r)=>s+(parseFloat((r.qty||{})[p.key])||0),0);
    }
  });
  return result;
}

function getBudgetQty() {
    const fm  = (typeof FILTER_MONTH !== 'undefined') ? FILTER_MONTH : -1;
    const res = {};
    PROD_CATS.forEach(c => {
        const arr = BUDGET.qty[c.key] || [];
        const budgetMT = fm === -1
          ? arr.reduce((a,b) => a+b, 0)        // All months
          : (arr[fm] || 0);                     // Specific month
        res[c.key] = { label: c.label, color: c.color, budgetMT };
    });
    return res;
}

function getActualQtyMT() {
  let res = {};
  PROD_CATS.forEach(c => res[c.key] = 0);
  // Gunakan getActiveMonthKeys jika tersedia (dari ui.js), fallback ke semua bulan
  const keys = (typeof getActiveMonthKeys === 'function') ? getActiveMonthKeys() : MONTH_KEYS;
  keys.forEach(mk => {
      (QTY_DATA[mk] || []).forEach(p => {
          const mt = weightToMT(p.totalWeight);
          const match = p.category
            ? PROD_CATS.find(c => c.key === p.category)
            : PROD_CATS.find(c => c.match(p.name.toLowerCase()));
          if(match) res[match.key] += mt;
      });
  });
  return res;
}

function refreshAll() { 
  buildChart(); buildTable(); buildWaterfall(); updateKPIs(); buildQtyPanel(); buildAnalytics(); 
}