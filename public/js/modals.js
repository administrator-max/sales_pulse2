// ── ANALYTICS MODAL LOGIC ──
function switchProdTab(tab) {
  document.getElementById('mini-prod-margin').style.display = tab==='margin' ? 'block' : 'none';
  document.getElementById('mini-prod-qty').style.display = tab==='qty' ? 'block' : 'none';
  document.getElementById('prod-tab-margin').classList.toggle('active', tab==='margin');
  document.getElementById('prod-tab-qty').classList.toggle('active', tab==='qty');
  document.getElementById('card-prod').onclick = ()=>openAnalyticsModal(tab==='margin' ? 'prod-margin' : 'prod-qty');
}

function switchCustTab(tab) {
  document.getElementById('mini-cust-margin').style.display = tab==='margin' ? 'block' : 'none';
  document.getElementById('mini-cust-qty').style.display = tab==='qty' ? 'block' : 'none';
  document.getElementById('cust-tab-margin').classList.toggle('active', tab==='margin');
  document.getElementById('cust-tab-qty').classList.toggle('active', tab==='qty');
  document.getElementById('card-cust').onclick = ()=>openAnalyticsModal(tab==='margin' ? 'cust-margin' : 'cust-qty');
}

function openAnalyticsModal(type) {
  const titles = { 'qty':'📦 Qty Actual vs Budget', 'prod-margin':'📊 Per Product · Margin', 'prod-qty':'📊 Per Product · Volume (MT)', 'cust-margin':'🏆 Top Customers · by Margin', 'cust-qty':'🏋 Top Customers · by Qty' };
  document.getElementById('analytics-modal-title').textContent = titles[type]||'';
  document.getElementById('analytics-modal-content').innerHTML = buildAnalyticsDetail(type);
  document.getElementById('analytics-modal-overlay').style.display = 'flex';
  document.getElementById('analytics-modal-overlay').style.pointerEvents = 'auto';
}

function closeAnalyticsModal() {
  document.getElementById('analytics-modal-overlay').style.display = 'none';
  document.getElementById('analytics-modal-overlay').style.pointerEvents = 'none';
}

function buildAnalyticsDetail(type) {
  const fmt2 = v => (v||0).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtN = v => Math.round(v||0).toLocaleString('id-ID');

  if(type==='qty') {
      const actual = getActualQtyMT();
      const bqt = getBudgetQty();
      let totalMT = Object.values(actual).reduce((a,b)=>a+b,0);
      const totalBudg = Object.values(bqt).reduce((s, b) => s + b.budgetMT, 0);
      const totPct = totalBudg > 0 ? (totalMT/totalBudg*100) : 0;
      const pctCol = totPct>=100?'var(--ok)':totPct>=50?'var(--warn)':'var(--over)';
      
      let h = `<div style="padding:16px 20px;border-bottom:1px solid var(--border2);">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;">
          <div><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Total YTD</div>
            <div style="font-family:Barlow Condensed,sans-serif;font-size:38px;font-weight:800;color:var(--actual);line-height:1">${fmtN(totalMT)} MT</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">of ${fmtN(totalBudg)} MT full year budget</div></div>
          <div style="text-align:right"><div style="font-family:Barlow Condensed,sans-serif;font-size:48px;font-weight:800;line-height:1;color:${pctCol}">${totPct.toFixed(1)}%</div>
            <div style="font-size:11px;color:var(--muted)">achievement</div></div>
        </div>
        </div>`;
      
      QTY_PROD_LABELS.forEach(bq => {
          const act=actual[bq.key]||0;
          const bgt = bqt[bq.key].budgetMT;
          const pct= bgt > 0 ? act/bgt*100 : 0;
          const col=pct>=100?'var(--ok)':pct>=50?'var(--warn)':'var(--over)';
          
          h+=`<div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${bq.label}</div>
            <div style="text-align:right"><div style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;color:var(--actual)">${fmtN(act)} MT</div>
              <div style="font-size:10px;color:var(--muted)">Budget: ${fmtN(bgt)} MT</div></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <div style="font-size:10px;color:var(--muted)">Progress</div>
            <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;background:${col}22;color:${col}">${pct.toFixed(1)}%</span>
          </div>
          <div style="height:8px;background:var(--s3);border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(pct,100)}%;background:var(--actual);border-radius:99px;"></div></div>
        </div>`;
      });
      return h;
  }

  if(type==='prod-margin'||type==='prod-qty') {
      const cats = getProdCategoryData();
      const totalMargin = cats.reduce((s,p)=>s+p.margin,0);
      const totalMT     = cats.reduce((s,p)=>s+p.mt,0);
      const maxM = Math.max(...cats.map(p=>p.margin), 1);
      const maxMT= Math.max(...cats.map(p=>p.mt), 1);
      const sortedCats = type==='prod-qty' ? [...cats].sort((a,b)=>b.mt-a.mt) : [...cats].sort((a,b)=>b.margin-a.margin);
      let h=`<div style="padding:16px 20px;border-bottom:1px solid var(--border2);">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;">
          <div>
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Total YTD</div>
            <div style="font-family:Barlow Condensed,sans-serif;font-size:36px;font-weight:800;color:var(--ok);line-height:1">${fmt2(totalMargin)} MIDR</div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">Margin dari ${fmtN(totalMT)} MT volume</div>
          </div>
        </div></div>`;
      sortedCats.forEach(p=>{
        const marginW=(p.margin/maxM*100).toFixed(1);
        const mtW=(p.mt/maxMT*100).toFixed(1);
        const avgPct=p.revenue>0?(p.margin/p.revenue*100).toFixed(2):0;
        const pc=avgPct>=12?'var(--ok)':avgPct>=8?'var(--warn)':'var(--over)';
        h+=`<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0;"></div>
              <div style="font-size:14px;font-weight:700;color:var(--text)">${p.label}</div>
            </div>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:5px;background:${pc}22;color:${pc}">${avgPct}% margin</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
            <div style="background:var(--s2);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">MARGIN</div>
              <div style="font-family:Barlow Condensed,sans-serif;font-size:20px;font-weight:800;color:var(--ok)">${fmt2(p.margin)}</div>
            </div>
            <div style="background:var(--s2);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">VOLUME</div>
              <div style="font-family:Barlow Condensed,sans-serif;font-size:20px;font-weight:800;color:${p.color}">${fmtN(p.mt)}</div>
            </div>
            <div style="background:var(--s2);border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">REVENUE</div>
              <div style="font-family:Barlow Condensed,sans-serif;font-size:20px;font-weight:800;color:var(--actual)">${fmt2(p.revenue)}</div>
            </div>
          </div>
          <div style="margin-bottom:5px;">
            <div style="height:6px;background:var(--s3);border-radius:99px;overflow:hidden;margin-bottom:6px;">
              <div style="height:100%;width:${marginW}%;background:linear-gradient(90deg,var(--ok),#059669);border-radius:99px;"></div></div>
            <div style="height:6px;background:var(--s3);border-radius:99px;overflow:hidden;">
              <div style="height:100%;width:${mtW}%;background:${p.color};border-radius:99px;"></div></div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:8px;">${p.projects.join(' · ')}</div>
        </div>`;
      });
      return h;
  }

  if(type==='cust-margin'||type==='cust-qty') {
      const custMap = getCustomerData();
      const totalMargin = Object.values(custMap).reduce((s,v)=>s+v.margin,0);
      const sorted = type==='cust-margin'
        ? Object.entries(custMap).sort((a,b)=>b[1].margin-a[1].margin)
        : Object.entries(custMap).filter(([,v])=>v.kg>0).sort((a,b)=>b[1].kg-a[1].kg);
      const rankColors=['#1e5aa8','#0f7343','#0288d1','#00897b','#1565c0'];
      const maxVal = type==='cust-margin' ? (sorted[0]?.[1].margin||1) : (sorted[0]?.[1].kg||1);
      
      let h=`<div style="padding:16px 20px;border-bottom:1px solid var(--border2);">
        <div style="display:flex;justify-content:space-between;">
          <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">${type==='cust-margin'?'Ranked by Margin':'Ranked by Qty (MT)'}</div>
            <div style="font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:800;color:var(--actual)">${sorted.length} Customers</div></div>
          <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">Total Margin YTD</div>
            <div style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;color:var(--ok)">${fmt2(totalMargin)} M</div></div>
        </div></div>`;
      sorted.forEach(([name,data],i)=>{
        const share=(data.margin/totalMargin*100).toFixed(1);
        const mt=data.kg>0?fmtN(data.kg/1000)+' MT':'—';
        const barVal = type==='cust-margin' ? data.margin : data.kg;
        const barW = (barVal/maxVal*100).toFixed(1);
        const rc = rankColors[i]||'var(--muted)';
        const sn = name;
        h+=`<div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="display:flex;gap:14px;align-items:flex-start;">
            <div style="font-family:Barlow Condensed,sans-serif;font-size:32px;font-weight:800;color:${rc};line-height:1;flex-shrink:0;width:28px;">${i+1}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;">${sn}</div>
              <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px;">
                <span style="font-size:11px;color:var(--muted2)">Margin: <strong style="color:var(--ok)">${fmt2(data.margin)} M</strong></span>
                <span style="font-size:11px;color:var(--muted2)">Share: <strong style="color:${rc}">${share}%</strong></span>
                <span style="font-size:11px;color:var(--muted2)">Qty: <strong>${mt}</strong></span>
              </div>
              <div style="height:5px;background:var(--s3);border-radius:99px;overflow:hidden;margin-bottom:4px;">
                <div style="height:100%;width:${barW}%;background:${rc};border-radius:99px;"></div></div>
              <div style="font-size:10px;color:var(--muted);">${data.projects.join(' · ')}</div>
            </div>
          </div></div>`;
      });
      return h;
  }
  return '';
}

// ── BUDGET EDIT LOGIC ──
let activeBudgetMonth = 0;

let BUDGET_YEAR = new Date().getFullYear();

function openBudgetModal() {
  activeBudgetMonth = 0;
  BUDGET_YEAR = typeof FILTER_YEAR !== 'undefined' ? FILTER_YEAR : new Date().getFullYear();
  const lbl = document.getElementById('budget-year-label');
  if (lbl) lbl.textContent = BUDGET_YEAR;
  renderBudgetForm();
  document.getElementById('budget-modal-overlay').classList.add('open');
}

async function shiftBudgetYear(delta) {
  BUDGET_YEAR += delta;

  // Update label di modal
  const lbl = document.getElementById('budget-year-label');
  if (lbl) lbl.textContent = BUDGET_YEAR;

  // Sync dengan filter dashboard
  if (typeof FILTER_YEAR !== 'undefined') {
    FILTER_YEAR = BUDGET_YEAR;
    const fl = document.getElementById('filter-year-label');
    if (fl) fl.textContent = FILTER_YEAR;
    if (typeof _updateFilterBadge === 'function') _updateFilterBadge();
  }

  // Tampilkan loading state di form
  const bgtMargin  = document.getElementById('bgt-margin');
  const bgtRevenue = document.getElementById('bgt-revenue');
  if (bgtMargin)  bgtMargin.style.opacity  = '0.4';
  if (bgtRevenue) bgtRevenue.style.opacity = '0.4';

  // Re-fetch budget data untuk tahun baru dari server
  try {
    const res  = await fetch('/api/data?year=' + BUDGET_YEAR);
    if (res.ok) {
      const data = await res.json();
      // Update BUDGET global state dengan data tahun baru
      if (data.BUDGET) {
        BUDGET.margin  = data.BUDGET.margin  || Array(12).fill(0);
        BUDGET.revenue = data.BUDGET.revenue || Array(12).fill(0);
        BUDGET.qty     = data.BUDGET.qty     || BUDGET.qty;
      } else {
        // Tahun baru belum ada data → reset ke nol
        BUDGET.margin  = Array(12).fill(0);
        BUDGET.revenue = Array(12).fill(0);
        Object.keys(BUDGET.qty).forEach(k => { BUDGET.qty[k] = Array(12).fill(0); });
      }
    }
  } catch(e) {
    console.warn('Budget fetch failed:', e);
  }

  // Restore opacity dan render form dengan data baru
  if (bgtMargin)  bgtMargin.style.opacity  = '1';
  if (bgtRevenue) bgtRevenue.style.opacity = '1';
  renderBudgetForm();
}

function closeBudgetModal(e, force) {
  if(!force && e && e.target !== document.getElementById('budget-modal-overlay')) return;
  document.getElementById('budget-modal-overlay').classList.remove('open');
}

function applyBudgetFormToState() {
  const idx = activeBudgetMonth;
  BUDGET.margin[idx] = parseFloat(document.getElementById('bgt-margin').value) || 0;
  BUDGET.revenue[idx] = parseFloat(document.getElementById('bgt-revenue').value) || 0;
  QTY_PROD_LABELS.forEach(p => {
    BUDGET.qty[p.key][idx] = parseFloat(document.getElementById(`bgt-qty-${p.key}`).value) || 0;
  });
}

function switchBudgetTab(idx) {
  applyBudgetFormToState();
  activeBudgetMonth = idx;
  renderBudgetForm();
}

function renderBudgetForm() {
  document.getElementById('budget-tabs-wrap').innerHTML = MONTHS.map((m, i) => 
    `<button class="qty-tab-btn ${i===activeBudgetMonth?'active':''}" onclick="switchBudgetTab(${i})">${m}</button>`
  ).join('');

  document.getElementById('bgt-margin').value = BUDGET.margin[activeBudgetMonth] || 0;
  document.getElementById('bgt-revenue').value = BUDGET.revenue[activeBudgetMonth] || 0;
  
  const grid = document.getElementById('bgt-qty-grid');
  grid.innerHTML = QTY_PROD_LABELS.map(p => {
    const val = BUDGET.qty[p.key][activeBudgetMonth] || 0;
    return `
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:8px;">
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">${p.label} (MT)</div>
        <input type="number" id="bgt-qty-${p.key}" value="${val}" style="width:100%;background:transparent;border:none;color:var(--text);font-weight:700;font-size:15px;font-family:'Barlow Condensed',sans-serif;outline:none;">
      </div>`;
  }).join('');
}

async function saveBudgetToDB() {
  applyBudgetFormToState();
  try {
    await fetch('/api/budget', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ BUDGET, year: BUDGET_YEAR })
    });
    showToast('Budget ' + BUDGET_YEAR + ' updated ✓');
    closeBudgetModal(null, true);
    refreshAll();
  } catch(e) {
    showToast('Error saving budget', true);
  }
}

// ── MODAL AND SAVE PLAN LOGIC ──
let modalMonthIdx=null;

function openModal(idx) {
  modalMonthIdx = idx;
  const m=MONTHS[idx], budget=BUDGET.margin[idx], actual=ACTUAL.margin[idx], plan=ACTUAL.plan[idx], rev=ACTUAL.revenue[idx];
  const mKey = m.toLowerCase();
  const chains = PS_CHAINS[mKey] || [];
  const isPS = chains.length > 0;
  const attPct=actual!=null && budget > 0 ?(actual/budget)*100:null;
  const gap=actual!=null?actual-budget:null;
  const marginP=actual!=null&&rev!=null?(actual/rev*100):null;
  const achColor=attPct==null?'var(--muted2)':attPct>=80?'var(--ok)':attPct>=30?'var(--warn)':'var(--over)';

  document.getElementById('modal-title').innerHTML=`${m} <span>2026</span>`;
  
  const psSection = document.getElementById('modal-ps-section');
  const psInner = document.getElementById('modal-ps-inner');
  
  if(isPS) {
    psSection.style.display = 'block';
    const monthLabel=`${m} 2026`;
    const totalMargin = chains.reduce((a,c)=>a+c.margin,0);
    const totalRev = chains.reduce((a,c)=>a+c.revenue,0);
    const totalPct = totalRev > 0 ? (totalMargin/totalRev*100).toFixed(2) : 0;
    
    const colors=['#1e5aa8','#0f7343','#0288d1','#00897b','#1565c0'];
    let html=`<div class="modal-ps-title">📋 PS Consolidated · ${monthLabel} · ${chains.length} Proyek</div>`;
    chains.forEach((c, i) => {
      const col  = colors[i%colors.length];
      const subs = c.subsidiaries || []; // per-PS breakdown untuk delete
      const isMulti = subs.length > 1;

      // Tombol delete: jika single PS pakai c.ps langsung,
      // jika multi (intercompany) render satu tombol per subsidiary
      const deleteButtons = isMulti
        ? subs.map(s => {
            const safePsNum  = s.ps.replace(/'/g, "\\'");
            const safePsName = c.name.replace(/'/g, "\\'");
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding:5px 8px;background:var(--s3);border-radius:6px;">
              <span style="font-size:10px;color:var(--muted2);flex:1;">${s.ps} · ${s.currency} · ${s.pct.toFixed(2)}%</span>
              <span style="font-size:11px;font-weight:700;color:var(--ok);">IDR ${s.marginMIDR.toFixed(2)} M</span>
              <button onclick="confirmDeletePS('${safePsNum}','${safePsName}',${idx})"
                title="Hapus ${s.ps}"
                style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);color:var(--over);cursor:pointer;"
                onmouseover="this.style.background='rgba(244,63,94,0.22)'"
                onmouseout="this.style.background='rgba(244,63,94,0.1)'">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>`;
          }).join('')
        : `<button onclick="confirmDeletePS('${c.ps.replace(/'/g,"\\'")}','${c.name.replace(/'/g,"\\'")}',${idx})"
             title="Hapus PS ini"
             style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);color:var(--over);cursor:pointer;flex-shrink:0;transition:all 0.15s;"
             onmouseover="this.style.background='rgba(244,63,94,0.22)'"
             onmouseout="this.style.background='rgba(244,63,94,0.1)'">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
           </button>`;

      html += `
        <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${col}">${c.name}${isMulti ? ' · 🔗 ' + subs.length + ' Sub' : ' · ' + c.ps}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="font-family:Barlow Condensed,sans-serif;font-size:14px;font-weight:700;color:var(--ok)">IDR ${c.margin.toFixed(2)} M · ${c.pct.toFixed(2)}%</div>
              ${!isMulti ? deleteButtons : ''}
            </div>
          </div>
          <div class="modal-ps-grid">
            <div class="modal-ps-item"><div class="modal-ps-label">Revenue</div><div class="modal-ps-val" style="color:var(--actual);font-size:13px">IDR ${c.revenue.toLocaleString('id-ID',{maximumFractionDigits:2})} M</div><div class="modal-ps-sub">${c.customer}</div></div>
            <div class="modal-ps-item"><div class="modal-ps-label">Net Margin</div><div class="modal-ps-val" style="color:var(--ok);font-size:13px">IDR ${c.margin.toFixed(2)} M</div><div class="modal-ps-sub">${c.pct.toFixed(2)}% consolidated</div></div>
          </div>
          ${isMulti ? '<div style="margin-top:6px;">' + deleteButtons + '</div>' : ''}
        </div>`;
    });
    html+=`<div style="background:#eaf3ff;border-radius:6px;padding:10px 12px;"><div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--actual);margin-bottom:8px;">Total ${monthLabel}</div><div class="modal-ps-grid"><div class="modal-ps-item"><div class="modal-ps-label">Total Revenue</div><div class="modal-ps-val" style="color:var(--actual)">IDR ${totalRev.toLocaleString('id-ID',{maximumFractionDigits:2})} M</div><div class="modal-ps-sub">${chains.length} proyek</div></div><div class="modal-ps-item"><div class="modal-ps-label">Total Net Margin</div><div class="modal-ps-val" style="color:var(--ok)">IDR ${totalMargin.toFixed(2)} M</div><div class="modal-ps-sub">${totalPct}% of revenue</div></div></div></div>`;
    psInner.innerHTML=html;
  } else {
    psSection.style.display = 'none';
  }

  // KPIs
  const totalMarginPctVal = isPS && chains.reduce((a,c)=>a+c.revenue,0) > 0 ? (chains.reduce((a,c)=>a+c.margin,0) / chains.reduce((a,c)=>a+c.revenue,0) * 100).toFixed(2) + '%' : '—';
  const mPctVal = marginP!=null?marginP.toFixed(2)+'%': (isPS?(totalMarginPctVal):'—');
  document.getElementById('modal-kpis').innerHTML=`
    <div class="modal-kpi"><div class="modal-kpi-l">Budget Margin</div><div class="modal-kpi-v" style="color:var(--budget)">${fmt(budget,2)}</div><div class="modal-kpi-s">MB 2026</div></div>
    <div class="modal-kpi"><div class="modal-kpi-l">Actual Margin${isPS?' (Consol.)':''}</div><div class="modal-kpi-v" style="color:${actual!=null?'var(--actual)':'var(--muted)'}">${actual!=null?fmt(actual,2):'—'}</div><div class="modal-kpi-s">${actual!=null?(isPS?'PS consolidated':'reported'):'Belum dientry'}</div></div>
    <div class="modal-kpi"><div class="modal-kpi-l">${isPS?'Margin %':'Plan Margin'}</div><div class="modal-kpi-v" style="color:${isPS?'var(--ok)':plan!=null?'var(--plan)':'var(--muted)'}">${isPS?mPctVal:plan!=null?fmt(plan,2):'—'}</div><div class="modal-kpi-s">${isPS?'of end sales':'pipeline'}</div></div>
  `;

  window._modalBudget=budget; window._modalActual=actual; window._modalPlan=plan; window._modalAchColor=achColor;
  setAchView('actual');

  document.getElementById('modal-ach-sub').textContent=attPct!=null?`Actual ${fmt(actual,2)} vs Budget ${fmt(budget,2)}`:'Belum ada data aktual';

  const gapEl=document.getElementById('modal-gap-val');
  if(gap==null){gapEl.textContent='—';gapEl.style.color='var(--muted2)';}
  else if(gap>=0){gapEl.textContent='+'+fmt(gap,2);gapEl.style.color='var(--ok)';}
  else{gapEl.textContent=fmt(gap,2);gapEl.style.color='var(--over)';}

  const printBtn = document.getElementById('modal-print-btn');
  if (printBtn) printBtn.style.display = isPS ? 'flex' : 'none';

  document.getElementById('modal-overlay').classList.add('open');
}

function printMonthReport() {
  const idx = modalMonthIdx;
  const mKey = MONTHS[idx].toLowerCase();
  const chains = PS_CHAINS[mKey] || [];
  if (chains.length === 0) return;

  const monthName = MONTHS[idx];
  const budget    = BUDGET.margin[idx];
  const actual    = ACTUAL.margin[idx];
  const attPct    = actual != null && budget > 0 ? (actual / budget * 100) : null;
  const gap       = actual != null ? actual - budget : null;
  const totalMargin = chains.reduce((a,c) => a + c.margin, 0);
  const totalRev    = chains.reduce((a,c) => a + c.revenue, 0);
  const totalConsolPct = totalRev > 0 ? (totalMargin / totalRev * 100).toFixed(2) : 0;

  const qtyData  = QTY_DATA[mKey] || [];

  const achLabelText = attPct == null ? '—' : attPct >= 80 ? 'ON TRACK' : attPct >= 30 ? 'BELOW TARGET' : 'CRITICAL';
  const achBgColor   = attPct == null ? '#64748b' : attPct >= 80 ? '#16a34a' : attPct >= 30 ? '#d97706' : '#dc2626';
  const gapText  = gap == null ? '—' : (gap >= 0 ? '+' : '') + gap.toFixed(2);
  const gapColor = gap == null ? '#64748b' : gap >= 0 ? '#16a34a' : '#dc2626';
  const now = new Date();
  const printDate = now.toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });

  let projectRowsHtml = '';
  let totalMT = 0;
  for (let i = 0; i < chains.length; i++) {
    const c = chains[i];
    let qtyMatch = null;
    const cNameLow = c.name.toLowerCase();
    for (let j = 0; j < qtyData.length; j++) {
      const qLow = qtyData[j].name.toLowerCase();
      const firstTwo = cNameLow.split(' ').slice(0,2).join(' ');
      if (qLow.indexOf(firstTwo) !== -1) { qtyMatch = qtyData[j]; break; }
    }
    const totalWeight = qtyMatch ? qtyMatch.totalWeight : '—';
    const mtMatch = totalWeight.match(/\(([0-9,.]+ MT)\)/);
    const mtOnly = mtMatch ? mtMatch[1] : totalWeight;
    if(mtMatch) totalMT += parseInt(mtMatch[1].replace(/,/g,''));

    const pctColor = c.pct >= 18 ? '#16a34a' : c.pct >= 12 ? '#d97706' : '#dc2626';
    projectRowsHtml +=
      '<tr>' +
        '<td class="td-project">' +
          '<div class="proj-name">' + c.name + '</div>' +
          '<div class="proj-ps">' + c.ps + '</div>' +
          '<div class="proj-customer">' + c.customer + '</div>' +
        '</td>' +
        '<td class="td-num">' +
          '<div class="num-main">IDR ' + c.margin.toFixed(2) + ' M</div>' +
          '<div class="num-sub">' + c.pct.toFixed(2) + '% of revenue</div>' +
        '</td>' +
        '<td class="td-num">' +
          '<div class="num-main">IDR ' + c.revenue.toFixed(2) + ' M</div>' +
        '</td>' +
        '<td class="td-num">' +
          '<div class="num-main">' + mtOnly + '</div>' +
        '</td>' +
        '<td class="td-pct" style="color:' + pctColor + '">' +
          '<div class="num-main" style="color:' + pctColor + '">' + c.pct.toFixed(2) + '%</div>' +
        '</td>' +
      '</tr>';
  }

  const totalMTDisplay = totalMT > 0 ? totalMT.toLocaleString('id-ID') + ' MT' : '—';

  const totalRowHtml =
    '<tr class="total-row">' +
      '<td class="td-project">' +
        '<div class="total-label">TOTAL ' + monthName.toUpperCase() + ' 2026</div>' +
        '<div style="font-size:9px;color:#94a3b8;margin-top:3px;">' + chains.length + ' proyek konsolidasi</div>' +
      '</td>' +
      '<td class="td-num">' +
        '<div class="total-val">IDR ' + totalMargin.toFixed(2) + ' M</div>' +
        '<div class="total-val-sub">' + totalConsolPct + '% of revenue</div>' +
      '</td>' +
      '<td class="td-num">' +
        '<div class="total-val">IDR ' + totalRev.toFixed(2) + ' M</div>' +
      '</td>' +
      '<td class="td-num">' +
        '<div class="total-val">' + totalMTDisplay + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="total-pct">' + totalConsolPct + '%</div>' +
      '</td>' +
    '</tr>';

  const progressWidth = attPct != null ? Math.min(attPct, 100).toFixed(1) : '0';
  const attPctDisplay = attPct != null ? attPct.toFixed(1) + '%' : '—';
  const actualDisplay = actual != null ? 'IDR ' + actual.toFixed(2) + ' M' : '—';
  const budgetDisplay = 'IDR ' + budget.toFixed(2) + ' M';

  const html = '<!DOCTYPE html>' +
    '<html lang="id"><head>' +
    '<meta charset="UTF-8">' +
    '<title>Laporan Margin ' + monthName + ' 2026</title>' +
    '<style>' +
    '@page{size:A4;margin:16mm 14mm 16mm 14mm;}' +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    'body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;background:#fff;}' +
    '.rh{border-bottom:3px solid #1a4480;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-end;}' +
    '.rtitle{font-size:20px;font-weight:700;color:#1a2f4a;letter-spacing:-0.5px;}' +
    '.rtitle span{color:#1e5aa8;}' +
    '.rsub{font-size:10px;color:#64748b;margin-top:3px;}' +
    '.rmeta{text-align:right;font-size:10px;color:#64748b;line-height:1.9;}' +
    '.rmeta strong{color:#0f172a;}' +
    '.section-lbl{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;margin-bottom:7px;margin-top:14px;}' +
    'table{width:100%;border-collapse:collapse;}' +
    'thead tr{background:#1a4480;}' +
    'thead th{color:#fff;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;padding:9px 10px;text-align:left;font-weight:600;}' +
    'thead th.r{text-align:right;}' +
    'thead th.c{text-align:center;}' +
    'tbody tr{border-bottom:1px solid #e2e8f0;}' +
    'tbody tr:nth-child(even){background:#f8fafc;}' +
    '.td-project{padding:10px;vertical-align:top;width:28%;}' +
    '.td-num{padding:10px;text-align:right;vertical-align:top;}' +
    '.td-pct{padding:10px;text-align:center;vertical-align:top;width:9%;}' +
    '.proj-name{font-size:12px;font-weight:700;color:#0f172a;margin-bottom:2px;}' +
    '.proj-ps{font-size:9px;color:#1e5aa8;margin-bottom:2px;}' +
    '.proj-customer{font-size:9px;color:#64748b;}' +
    '.num-main{font-size:11px;font-weight:600;color:#1e293b;}' +
    '.num-sub{font-size:9px;color:#94a3b8;margin-top:2px;}' +
    '.total-row{background:#1a4480!important;}' +
    '.total-row td{padding:11px 10px;border-bottom:none!important;}' +
    '.total-label{font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;}' +
    '.total-val{font-size:13px;font-weight:700;color:#ffffff;text-align:right;}' +
    '.total-val-sub{font-size:9px;color:#64748b;text-align:right;margin-top:2px;}' +
    '.total-pct{font-size:13px;font-weight:700;color:#a8d8ff;text-align:center;}' +
    '.ach{margin-top:20px;border:2px solid #1a4480;border-radius:8px;overflow:hidden;}' +
    '.ach-hdr{background:#1a4480;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;}' +
    '.ach-hdr-lbl{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;}' +
    '.ach-hdr-status{font-size:13px;font-weight:700;color:' + achBgColor + ';}' +
    '.ach-grid{display:grid;grid-template-columns:repeat(4,1fr);border-top:none;}' +
    '.ach-cell{padding:14px 16px;border-right:1px solid #e2e8f0;}' +
    '.ach-cell:last-child{border-right:none;}' +
    '.ach-lbl{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:7px;}' +
    '.ach-big{font-size:32px;font-weight:800;line-height:1;letter-spacing:-1.5px;color:' + achBgColor + ';}' +
    '.ach-val{font-size:22px;font-weight:700;line-height:1;letter-spacing:-0.5px;color:#0f172a;}' +
    '.ach-gap{font-size:22px;font-weight:700;color:' + gapColor + ';}' +
    '.ach-sub{font-size:10px;color:#64748b;margin-top:5px;}' +
    '.prog-wrap{padding:10px 16px 14px;}' +
    '.prog-lbl{display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;margin-bottom:5px;letter-spacing:1px;}' +
    '.prog-track{height:12px;background:#e2e8f0;border-radius:99px;overflow:hidden;}' +
    '.prog-fill{height:100%;background:' + achBgColor + ';border-radius:99px;width:' + progressWidth + '%;}' +
    '.rfooter{margin-top:20px;border-top:1px solid #e2e8f0;padding-top:9px;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;}' +
    '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
    '</style></head><body>' +
    '<div class="rh">' +
      '<div>' +
        '<div style="font-size:10px;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Group GP &bull; Laporan Margin Internal</div>' +
        '<div class="rtitle">LAPORAN MARGIN <span>' + monthName.toUpperCase() + ' 2026</span></div>' +
        '<div class="rsub">PS Consolidated Net Margin &bull; ' + chains.length + ' Proyek &bull; Setelah Semua Biaya</div>' +
      '</div>' +
      '<div class="rmeta">' +
        '<div>Dicetak: <strong>' + printDate + '</strong></div>' +
        '<div>Bulan: <strong>' + monthName + ' 2026</strong></div>' +
        '<div>Jumlah Proyek: <strong>' + chains.length + '</strong></div>' +
      '</div>' +
    '</div>' +
    '<div class="section-lbl">Detail Per Proyek</div>' +
    '<table>' +
      '<thead><tr>' +
        '<th>Nama Project</th>' +
        '<th class="r">Console Margin</th>' +
        '<th class="r">Revenue</th>' +
        '<th class="r">Volume (MT)</th>' +
        '<th class="c">Margin %</th>' +
      '</tr></thead>' +
      '<tbody>' +
        projectRowsHtml +
        totalRowHtml +
      '</tbody>' +
    '</table>' +
    '<div class="ach">' +
      '<div class="ach-hdr">' +
        '<div class="ach-hdr-lbl">Pencapaian vs Target Anggaran &mdash; ' + monthName + ' 2026</div>' +
        '<div class="ach-hdr-status">' + achLabelText + '</div>' +
      '</div>' +
      '<div class="ach-grid">' +
        '<div class="ach-cell">' +
          '<div class="ach-lbl">Pencapaian</div>' +
          '<div class="ach-big">' + attPctDisplay + '</div>' +
          '<div class="ach-sub">vs Budget ' + monthName + ' 2026</div>' +
        '</div>' +
        '<div class="ach-cell">' +
          '<div class="ach-lbl">Actual Margin</div>' +
          '<div class="ach-val">' + actualDisplay + '</div>' +
          '<div class="ach-sub">Net Consolidated</div>' +
        '</div>' +
        '<div class="ach-cell">' +
          '<div class="ach-lbl">Budget Margin</div>' +
          '<div class="ach-val">' + budgetDisplay + '</div>' +
          '<div class="ach-sub">MB 2026 &bull; ' + monthName + '</div>' +
        '</div>' +
        '<div class="ach-cell">' +
          '<div class="ach-lbl">Gap vs Budget</div>' +
          '<div class="ach-gap">' + gapText + '</div>' +
          '<div class="ach-sub">' + (gap != null && gap >= 0 ? 'Di atas target' : 'Di bawah target') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="prog-wrap">' +
        '<div class="prog-lbl"><span>PROGRESS PENCAPAIAN BULAN INI</span><span>' + attPctDisplay + ' dari budget</span></div>' +
        '<div class="prog-track"><div class="prog-fill"></div></div>' +
      '</div>' +
    '</div>' +
    '<div class="rfooter">' +
      '<span>Sales Pulse 2026 &bull; Group GP &bull; Dokumen Internal &bull; RAHASIA</span>' +
      '<span>Dicetak: ' + printDate + ' &bull; Data: PS Consolidated Net Margin After All Costs</span>' +
    '</div>' +
    '</body></html>';

  const win = window.open('', '_blank', 'width=860,height=720,scrollbars=yes');
  if (!win) { alert('Popup diblokir browser. Izinkan popup untuk domain ini lalu coba lagi.'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = function() { win.focus(); win.print(); };
}

function closeModal(e, force) {
  if(!force&&e&&e.target!==document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('open');
}

function setAchView(mode) {
  const budget=window._modalBudget,actual=window._modalActual,plan=window._modalPlan,achColor=window._modalAchColor||'var(--muted2)';
  const achEl=document.getElementById('modal-ach-pct'),barEl=document.getElementById('modal-ach-bar');
  const planBarEl=document.getElementById('modal-plan-bar'),combBarEl=document.getElementById('modal-combined-bar');
  const planWrap=document.getElementById('modal-plan-bar-wrap'),combWrap=document.getElementById('modal-combined-bar-wrap');
  const actualLbl=document.getElementById('modal-ach-actual-lbl'),planLbl=document.getElementById('modal-ach-plan-lbl'),combLbl=document.getElementById('modal-ach-combined-lbl');
  const mainPanel = document.getElementById('modal-ach-main');
  const savePanel = document.getElementById('modal-saveplan-panel');

  document.getElementById('ach-btn-actual').classList.toggle('ach-active', mode==='actual');
  document.getElementById('ach-btn-combined').classList.toggle('ach-active', mode==='combined');
  document.getElementById('ach-btn-saveplan').classList.toggle('ach-active', mode==='saveplan');

  const showMain = mode !== 'saveplan';
  mainPanel.style.display  = showMain ? 'block' : 'none';
  savePanel.style.display  = showMain ? 'none'  : 'block';

  if(mode==='saveplan'){
    loadPlanForm(modalMonthIdx);
    return;
  }

  const actPct=actual!=null && budget > 0 ?(actual/budget)*100:null;
  const planPct=plan!=null && budget > 0 ?(plan/budget)*100:null;
  const combVal=(actual||0)+(plan||0);
  const combPct=combVal>0 && budget > 0 ?(combVal/budget)*100:null;
  const combColor=combPct!=null?(combPct>=80?'var(--ok)':combPct>=30?'var(--warn)':'var(--over)'):'var(--muted2)';
  if(mode==='actual'){
    planWrap.style.display='none';combWrap.style.display='none';
    barEl.style.background=achColor;
    achEl.textContent=actPct!=null?actPct.toFixed(1)+'%':'—'; achEl.style.color=achColor;
    actualLbl.textContent=actPct!=null?actPct.toFixed(1)+'% of budget':'—';
    barEl.style.width='0%';
    setTimeout(()=>{barEl.style.width=actPct!=null?Math.min(actPct,100).toFixed(1)+'%':'0%';},60);
  }else{
    planWrap.style.display='block';combWrap.style.display='block';
    barEl.style.background=achColor;
    actualLbl.textContent=actPct!=null?actPct.toFixed(1)+'% of budget':'—';
    planLbl.textContent=planPct!=null?planPct.toFixed(1)+'% of budget':'—';
    combLbl.textContent=combPct!=null?combPct.toFixed(1)+'% of budget':'—';
    achEl.textContent=combPct!=null?combPct.toFixed(1)+'%':'—'; achEl.style.color=combColor;
    barEl.style.width='0%';planBarEl.style.width='0%';combBarEl.style.width='0%';
    setTimeout(()=>{
      barEl.style.width=actPct!=null?Math.min(actPct,100).toFixed(1)+'%':'0%';
      planBarEl.style.width=planPct!=null?Math.min(planPct,100).toFixed(1)+'%':'0%';
      combBarEl.style.width=combPct!=null?Math.min(combPct,100).toFixed(1)+'%':'0%';
    },60);
  }
}

function spTotals(idx){
  const revs = PLAN_REVISIONS[idx] || [];
  const totalMargin  = revs.reduce((s,r) => s + (parseFloat(r.margin)||0), 0);
  const totalRevenue = revs.reduce((s,r) => s + (parseFloat(r.revenue)||0), 0);
  const totalQty = {};
  QTY_PROD_LABELS.forEach(p => {
    totalQty[p.key] = revs.reduce((s,r) => s + (parseFloat((r.qty||{})[p.key])||0), 0);
  });
  return { margin: totalMargin, revenue: totalRevenue, qty: totalQty, count: revs.length };
}

function spRevLabel(i){ return 'Deal '+(i+1); }

function spBuildTabs(idx){
  const revs   = PLAN_REVISIONS[idx];
  const active = SP_ACTIVE_REV[idx];
  const container = document.getElementById('sp-rev-tabs');
  container.innerHTML = revs.length === 0
    ? `<span style="padding:7px 14px;font-size:11px;color:var(--muted);font-style:italic;">Belum ada deal — klik + untuk tambah</span>`
    : revs.map((r,i) => {
        const isActive = i === active;
        const label = r.name ? r.name.substring(0,12) : spRevLabel(i);
        const mv = parseFloat(r.margin);
        const pct = BUDGET.margin[idx] > 0 && !isNaN(mv) ? ' '+((mv/BUDGET.margin[idx])*100).toFixed(0)+'%' : '';
        return `<button onclick="spSelectRev(${i})"
          style="flex-shrink:0;padding:7px 12px;border:none;background:${isActive?'rgba(56,189,248,0.2)':'transparent'};
          color:${isActive?'#38bdf8':'var(--muted2)'};font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;
          cursor:pointer;border-right:1px solid var(--border2);letter-spacing:0.3px;transition:all 0.15s;white-space:nowrap;">
          ${label}<span style="font-size:10px;opacity:0.6;">${pct}</span>
        </button>`;
      }).join('');
  spUpdateTotalStrip(idx);
}

function spUpdateTotalStrip(idx){
  const t = spTotals(idx);
  const strip = document.getElementById('sp-total-strip');
  if(!strip) return;
  strip.style.display = t.count > 0 ? 'flex' : 'none';
  const budget = BUDGET.margin[idx];
  const pct    = budget > 0 ? (t.margin/budget*100) : 0;
  const pctColor = pct >= 100 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--over)';
  document.getElementById('sp-total-margin').textContent = t.margin.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' M IDR';
  document.getElementById('sp-total-pct').style.color = pctColor;
  document.getElementById('sp-total-pct').textContent  = pct.toFixed(1)+'% vs Budget';
  document.getElementById('sp-total-count').textContent = t.count + ' deal' + (t.count>1?'s':'');
}

function spSelectRev(i){
  SP_ACTIVE_REV[modalMonthIdx] = i;
  loadPlanForm(modalMonthIdx);
}

function spAddRevision() {
  const idx = modalMonthIdx;
  PLAN_REVISIONS[idx].push({ name:'', margin:'', revenue:'', notes:'', ts:'', qty:{} });
  SP_ACTIVE_REV[idx] = PLAN_REVISIONS[idx].length - 1;
  loadPlanForm(idx);
}

function spDeleteRevision(){
  const idx    = modalMonthIdx;
  const revs   = PLAN_REVISIONS[idx];
  if(revs.length === 0) return;
  const active = SP_ACTIVE_REV[idx];
  const label  = revs[active].name || spRevLabel(active);
  if(!confirm('Hapus "' + label + '"?')) return;
  revs.splice(active, 1);
  SP_ACTIVE_REV[idx] = Math.max(0, active - 1);
  const t = spTotals(idx);
  ACTUAL.plan[idx] = t.count > 0 ? t.margin : null;
  persist(); refreshAll();
  loadPlanForm(idx);
}

function spUpdatePct(){
  const idx    = modalMonthIdx;
  const budget = BUDGET.margin[idx];
  const v  = parseFloat(document.getElementById('sp-margin').value);
  const el = document.getElementById('sp-pct-display');
  if(!isNaN(v) && budget > 0){
    const pct = (v/budget*100);
    const color = pct>=100?'var(--ok)':pct>=60?'var(--warn)':'var(--over)';
    el.textContent = pct.toFixed(1)+'%';
    el.style.color = color;
  } else {
    el.textContent = '—';
    el.style.color = 'var(--muted2)';
  }
}

window.spUpdateQtyPct = function(key, budget, otherTotal, val){
  const el = document.getElementById('sp-qty-pct-'+key);
  if(!el) return;
  const v = parseFloat(val)||0;
  const combined = v + otherTotal;
  if(budget > 0){
    el.textContent = (combined/budget*100).toFixed(0)+'%';
    el.style.color  = combined >= budget ? 'var(--ok)' : 'var(--over)';
  } else { el.textContent = ''; }
};

function loadPlanForm(idx) {
  const revs = PLAN_REVISIONS[idx];
  const active = SP_ACTIVE_REV[idx];
  const d = revs[active] || null;

  spBuildTabs(idx);

  const formArea = document.getElementById('sp-form-area');
  const delBtn   = document.getElementById('sp-del-btn');
  formArea.style.opacity = revs.length === 0 ? '0.35' : '1';
  formArea.style.pointerEvents = revs.length === 0 ? 'none' : 'auto';
  if(delBtn) delBtn.style.display = revs.length > 0 ? 'block' : 'none';

  document.getElementById('sp-rev-badge').textContent = d ? (d.name || spRevLabel(active)) : '—';
  document.getElementById('sp-rev-ts').textContent    = d && d.ts ? '💾 '+d.ts : '';
  document.getElementById('sp-name').value = d ? d.name || '' : '';
  document.getElementById('sp-margin').value = d ? d.margin || '' : '';
  document.getElementById('sp-revenue').value = d ? d.revenue || '' : '';
  document.getElementById('sp-notes').value   = d ? d.notes || '' : '';
  spUpdatePct();
  
  const grid = document.getElementById('sp-qty-grid');
  const otherRevs = revs.filter((_,i) => i !== active);
  grid.innerHTML = QTY_PROD_LABELS.map(p => {
    const budgetVal  = BUDGET.qty[p.key][idx] || 0;
    const savedVal   = d && d.qty ? (d.qty[p.key] || '') : '';
    const otherTotal = otherRevs.reduce((s,r) => s + (parseFloat((r.qty||{})[p.key])||0), 0);
    const planNum    = parseFloat(savedVal) || 0;
    const combined   = planNum + otherTotal;
    const bgtPct     = budgetVal > 0 ? (combined/budgetVal*100).toFixed(0)+'%' : '';
    const pctColor   = budgetVal > 0 ? (combined>=budgetVal?'var(--ok)':'var(--over)') : 'var(--muted)';

    return '<div style="background:var(--s2);border-radius:6px;padding:8px;"><div style="font-size:10px;color:var(--muted);margin-bottom:4px;">'+p.label+'</div>'
        + '<input type="number" id="sp-qty-'+p.key+'" value="'+savedVal+'" style="width:100%;background:transparent;border:none;color:var(--text);font-weight:bold;outline:none;" oninput="spUpdateQtyPct(\''+p.key+'\','+budgetVal+','+otherTotal+',this.value)">'
        + '<div style="display:flex;justify-content:space-between;margin-top:4px;">'
        + '<span style="font-size:9px;color:var(--muted);">Bgt: '+budgetVal.toLocaleString('id-ID')+' MT</span>'
        + '<span id="sp-qty-pct-'+p.key+'" style="font-size:9px;font-weight:700;color:'+pctColor+';">'+bgtPct+'</span>'
        + '</div>'
        + (otherTotal > 0 ? '<div style="font-size:8px;color:var(--muted);margin-top:2px;">+'+otherTotal+' MT deal lain</div>' : '')
        + '</div>';
  }).join('');

  spBuildHistory(idx);
}

function spBuildHistory(idx){
  const revs     = PLAN_REVISIONS[idx];
  const histArea = document.getElementById('sp-history-area');
  const histTbl  = document.getElementById('sp-history-table');
  if(revs.length === 0){ histArea.style.display='none'; return; }
  histArea.style.display = 'block';
  const budget = BUDGET.margin[idx];
  const t = spTotals(idx);
  const totalPct = budget > 0 ? (t.margin/budget*100).toFixed(1)+'%' : '—';
  let html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">'
    + '<thead><tr style="border-bottom:1px solid var(--border2);">'
    + '<th style="text-align:left;padding:4px 8px;color:var(--muted);font-weight:600;">Deal</th>'
    + '<th style="text-align:right;padding:4px 8px;color:var(--muted);font-weight:600;">Margin</th>'
    + '<th style="text-align:right;padding:4px 8px;color:var(--muted);font-weight:600;">vs Bgt</th>'
    + '<th style="text-align:right;padding:4px 8px;color:var(--muted);font-weight:600;">Revenue</th>'
    + '<th style="text-align:left;padding:4px 8px;color:var(--muted);font-weight:600;">Notes</th>'
    + '</tr></thead><tbody>';
  revs.forEach((r,i) => {
    const mv   = parseFloat(r.margin);
    const pct  = !isNaN(mv) && budget>0 ? (mv/budget*100) : null;
    const pc   = pct==null ? '—' : pct.toFixed(1)+'%';
    const pcColor = pct==null?'var(--muted)':pct>=100?'var(--ok)':pct>=60?'var(--warn)':'var(--over)';
    const isActive = i === SP_ACTIVE_REV[idx];
    html += '<tr style="border-bottom:1px solid var(--border);background:'+(isActive?'rgba(56,189,248,0.05)':'transparent')+';cursor:pointer;" onclick="spSelectRev('+i+')">'
      + '<td style="padding:5px 8px;color:'+(isActive?'#38bdf8':'var(--text)')+';font-weight:'+(isActive?700:400)+';">'+(r.name||spRevLabel(i))+(isActive?' ●':'')+'</td>'
      + '<td style="padding:5px 8px;text-align:right;color:#fff;font-family:Barlow Condensed,sans-serif;">'+(!isNaN(mv)?mv.toLocaleString('id-ID',{minimumFractionDigits:2}):'—')+'</td>'
      + '<td style="padding:5px 8px;text-align:right;font-weight:700;color:'+pcColor+';">'+pc+'</td>'
      + '<td style="padding:5px 8px;text-align:right;color:var(--muted2);">'+(r.revenue||'—')+'</td>'
      + '<td style="padding:5px 8px;color:var(--muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(r.notes||'')+'</td>'
      + '</tr>';
  });
  const tpctColor = t.margin > 0 && budget > 0 ? ((t.margin/budget*100)>=100?'var(--ok)':(t.margin/budget*100)>=60?'var(--warn)':'var(--over)') : 'var(--muted)';
  html += '<tr style="border-top:1px solid var(--border2);background:rgba(255,255,255,0.03);">'
    + '<td style="padding:5px 8px;color:var(--muted2);font-weight:700;">TOTAL ('+revs.length+' deals)</td>'
    + '<td style="padding:5px 8px;text-align:right;color:#38bdf8;font-family:Barlow Condensed,sans-serif;font-weight:800;">'+t.margin.toLocaleString('id-ID',{minimumFractionDigits:2})+'</td>'
    + '<td style="padding:5px 8px;text-align:right;font-weight:800;color:'+tpctColor+';">'+totalPct+'</td>'
    + '<td style="padding:5px 8px;text-align:right;color:var(--muted2);">'+(t.revenue>0?t.revenue.toLocaleString('id-ID',{minimumFractionDigits:2}):'—')+'</td>'
    + '<td></td></tr>';
  html += '</tbody></table></div>';
  histTbl.innerHTML = html;
}

async function savePlanData() {
  const idx = modalMonthIdx;
  const revs = PLAN_REVISIONS[idx];
  if(revs.length === 0) return;
  
  const d = revs[SP_ACTIVE_REV[idx]];
  d.name = document.getElementById('sp-name').value;
  d.margin = document.getElementById('sp-margin').value;
  d.revenue = document.getElementById('sp-revenue').value;
  d.notes   = document.getElementById('sp-notes').value;
  QTY_PROD_LABELS.forEach(p => { d.qty[p.key] = document.getElementById('sp-qty-'+p.key).value; });
  const now = new Date();
  d.ts = now.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'2-digit'}) + ' ' + now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});

  const t = spTotals(idx);
  ACTUAL.plan[idx] = t.margin > 0 ? t.margin : null;
  ACTUAL.revenue[idx] = t.revenue > 0 ? t.revenue : null;
  ACTUAL.notes[idx] = revs.filter(r=>r.notes).map(r=>(r.name?r.name+': ':'')+r.notes).join(' | ');
  
  await persist(); 
  refreshAll();
  loadPlanForm(idx);
}

// ── QTY BREAKDOWN MODAL ──
let _qtyBdMonth = 0; 

function openQtyProductModal(monthIdx) {
  _qtyBdMonth = monthIdx;
  renderQtyBreakdown();
  const ov = document.getElementById('qty-breakdown-overlay');
  ov.style.display = 'flex';
  ov.style.pointerEvents = 'all';
  requestAnimationFrame(() => ov.style.opacity = '1');
}

function closeQtyBreakdown() {
  const ov = document.getElementById('qty-breakdown-overlay');
  ov.style.display = 'none';
  ov.style.pointerEvents = 'none';
}

function shiftQtyMonth(dir) {
  _qtyBdMonth = Math.max(0, Math.min(11, _qtyBdMonth + dir));
  renderQtyBreakdown();
}

function renderQtyBreakdown() {
  const mi = _qtyBdMonth;
  const monthKey = MONTH_KEYS[mi];
  const actualProjs = QTY_DATA[monthKey] || [];

  const actualMT = {};
  PROD_CATS.forEach(cat => {
    const mt = actualProjs
      .filter(p => cat.match(p.name.toLowerCase()))
      .reduce((s,p) => s + weightToMT(p.totalWeight), 0);
    actualMT[cat.key] = mt; 
  });

  const totalActual = Object.values(actualMT).reduce((s,v) => s + v, 0);
  const budgetQtyMonthly = getBudgetQtyMonthly();
  const totalBudget = budgetQtyMonthly[mi];
  const totalPct    = totalBudget > 0 ? (totalActual/totalBudget*100) : (totalActual > 0 ? Infinity : 0);
  const hasActual   = totalActual > 0;
  const achColor    = totalPct >= 100 ? 'var(--ok)' : totalPct >= 60 ? 'var(--warn)' : 'var(--over)';

  document.getElementById('qtybd-month-label').textContent = MONTHS[mi] + ' 2026  —  QTY Breakdown';
  document.getElementById('qtybd-subtitle').textContent    = 'Actual vs Budget per Produk';
  document.getElementById('qtybd-prev').disabled = mi === 0;
  document.getElementById('qtybd-next').disabled = mi === 11;

  const sumEl = document.getElementById('qtybd-summary');
  const fmtMT = v => Math.round(v).toLocaleString('id-ID') + ' MT';
  sumEl.innerHTML = `
    <div style="flex:1;padding:14px 20px;border-right:1px solid var(--border2);">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Actual Total</div>
      <div style="font-family:Barlow Condensed,sans-serif;font-size:24px;font-weight:800;color:${hasActual?'#fff':'var(--muted)'};">${fmtMT(totalActual)}</div>
    </div>
    <div style="flex:1;padding:14px 20px;border-right:1px solid var(--border2);">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Budget Total</div>
      <div style="font-family:Barlow Condensed,sans-serif;font-size:24px;font-weight:800;color:rgba(255,255,255,0.4);">${fmtMT(totalBudget)}</div>
    </div>
    <div style="flex:1;padding:14px 20px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Achievement</div>
      <div style="font-family:Barlow Condensed,sans-serif;font-size:24px;font-weight:800;color:${hasActual?achColor:'var(--over)'};">${totalBudget > 0 ? totalPct.toFixed(1)+'%' : '—'}</div>
    </div>`;

  const body = document.getElementById('qtybd-body');
  let html = '';
  const maxBgt = Math.max(...PROD_CATS.map(c => BUDGET.qty[c.key][mi]||0), 1);
  const maxAct = Math.max(...PROD_CATS.map(c => actualMT[c.key]||0), 1);
  const maxBar = Math.max(maxBgt, maxAct);

  PROD_CATS.forEach(cat => {
    const catBgt   = BUDGET.qty[cat.key][mi] || 0;
    const catAct   = actualMT[cat.key] || 0;
    const gap      = catAct - catBgt;
    const gapStr   = (gap >= 0 ? '+' : '') + Math.round(gap).toLocaleString('id-ID') + ' MT';
    const gapColor = gap >= 0 ? 'var(--ok)' : 'var(--over)';
    const rowColor = catAct > 0 && catAct >= catBgt ? 'var(--ok)' : catAct > 0 ? 'var(--over)' : 'var(--border2)';
    const bgtBarW  = (catBgt / maxBar * 100).toFixed(1);
    const actBarW  = (catAct / maxBar * 100).toFixed(1);
    const pctVal   = catBgt > 0 ? (catAct / catBgt * 100).toFixed(1) + '%' : catAct > 0 ? '∞%' : '—';
    const pctColor = catAct >= catBgt && catBgt > 0 ? 'var(--ok)' : 'var(--over)';
    const pctText  = catBgt > 0 ? `<span style="font-weight:700;color:${pctColor};">${pctVal}</span> dari budget`
                   : catAct > 0 ? `Tidak ada budget · actual: ${fmtMT(catAct)}`
                   : `<span style="color:var(--over);font-weight:700;">0%</span> dari budget ${fmtMT(catBgt)}`;

    html += `
    <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:10px;height:10px;border-radius:2px;background:${cat.color};display:inline-block;flex-shrink:0;"></span>
          <span style="font-size:13px;font-weight:600;color:var(--text);">${cat.label}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:10px;">
          <span style="font-size:11px;color:${gapColor};font-weight:600;">${gapStr}</span>
          <span style="font-family:Barlow Condensed,sans-serif;font-size:16px;font-weight:700;color:${rowColor};">${fmtMT(catAct)}</span>
          <span style="font-size:11px;color:rgba(255,255,255,0.25);">/ ${fmtMT(catBgt)}</span>
        </div>
      </div>
      <div style="position:relative;height:5px;background:var(--s3);border-radius:99px;overflow:visible;margin-bottom:4px;">
        <div style="position:absolute;top:0;left:0;height:100%;width:${bgtBarW}%;background:rgba(255,255,255,0.10);border-radius:99px;"></div>
        <div style="position:absolute;top:0;left:0;height:100%;width:${actBarW}%;background:${cat.color};border-radius:99px;opacity:0.85;transition:width 0.5s cubic-bezier(.4,0,.2,1);"></div>
      </div>
      <div style="font-size:10px;color:var(--muted2);margin-top:4px;">${pctText}</div>
    </div>`;
  });

  if (!hasActual) {
    html = `<div style="padding:10px 20px 4px;"><span style="font-size:11px;color:var(--muted);font-style:italic;">Belum ada data aktual untuk ${MONTHS[mi]} — menampilkan budget target</span></div>` + html;
  }
  body.innerHTML = html;
}
// ============================================================================
// DELETE PROJECT SHEET — Confirm dialog & API call
// ============================================================================

// State untuk menyimpan PS yang akan dihapus
let _deletePsNumber = null;
let _deletePsName   = null;
let _deleteMonthIdx = null;

function confirmDeletePS(psNumber, psName, monthIdx) {
  _deletePsNumber = psNumber;
  _deletePsName   = psName;
  _deleteMonthIdx = monthIdx;

  document.getElementById('delete-ps-name').textContent  = psName;
  document.getElementById('delete-ps-number').textContent = psNumber;

  const overlay = document.getElementById('delete-ps-overlay');
  overlay.style.display = 'flex';
  // Trigger transition
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function closeDeleteModal(force) {
  const overlay = document.getElementById('delete-ps-overlay');
  overlay.classList.remove('open');
  setTimeout(() => { overlay.style.display = 'none'; }, 250);
}

async function executeDeletePS() {
  if (!_deletePsNumber) return;

  const btn = document.getElementById('delete-ps-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      style="animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
    Menghapus...`;

  try {
    const res = await fetch(
      `/api/project-sheet/${encodeURIComponent(_deletePsNumber)}`,
      { method: 'DELETE' }
    );
    const data = await res.json();

    if (res.ok) {
      closeDeleteModal(true);
      showToast(`✓ ${_deletePsNumber} berhasil dihapus`);
      // Tutup monthly modal dulu, lalu refresh semua data
      closeModal(null, true);
      if (typeof initApp === 'function') initApp();
    } else {
      throw new Error(data.error || `Error ${res.status}`);
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
      Ya, Hapus`;
    showToast(`Gagal menghapus: ${err.message}`, true);
  }
}