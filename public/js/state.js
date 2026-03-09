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
  { key:'sheetPile',  label:'Sheet Pile', color:'#4ade80', rgba:'rgba(74,222,128,0.85)', match: n => n.includes('mlion')||n.includes('sheet pile') },
  { key:'weldedPipe', label:'Pipe',       color:'#22d3ee', rgba:'rgba(34,211,238,0.85)', match: n => n.includes('youfa')||n.includes('welded')||(n.includes('pipe')&&!n.includes('erw'))||n.includes('seamless') },
  { key:'erwPipe',    label:'ERW Pipe',   color:'#67e8f9', rgba:'rgba(103,232,249,0.85)', match: n => n.includes('erw') },
  { key:'gl',         label:'GL',         color:'#818cf8', rgba:'rgba(129,140,248,0.85)', match: n => n.includes('gl')||n.includes('galvalume') },
  { key:'gi',         label:'GI',         color:'#38bdf8', rgba:'rgba(56,189,248,0.85)', match: n => n.includes('gi ')||n.includes('galvanized')||n.includes(' gi') },
  { key:'ppgl',       label:'PPGL',       color:'#f59e0b', rgba:'rgba(245,158,11,0.85)', match: n => n.includes('sssc')||n.includes('ppgl')||n.includes('coil') },
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

// ── INIT & FETCH FROM DATABASE ──
async function initApp() {
  try {
    const res = await fetch('/api/data');
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
      body: JSON.stringify({ ACTUAL, PLAN_REVISIONS })
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
    const res = {};
    PROD_CATS.forEach(c => {
        res[c.key] = {
            label: c.label,
            color: c.color,
            budgetMT: (BUDGET.qty[c.key] || []).reduce((a,b) => a+b, 0)
        };
    });
    return res;
}

function getActualQtyMT() {
  let res = {};
  PROD_CATS.forEach(c => res[c.key] = 0);
  MONTH_KEYS.forEach(mk => {
      (QTY_DATA[mk] || []).forEach(p => {
          const mt = weightToMT(p.totalWeight);
          const n = p.name.toLowerCase();
          const match = PROD_CATS.find(c => c.match(n));
          if(match) res[match.key] += mt;
      })
  });
  return res;
}

function refreshAll() { 
  buildChart(); buildTable(); buildWaterfall(); updateKPIs(); buildQtyPanel(); buildAnalytics(); 
}