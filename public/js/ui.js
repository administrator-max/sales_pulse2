// ── RENDER CHARTS & TABLES ──
const chartCtx = document.getElementById('mainChart').getContext('2d');
let mainChart;

function buildChart() {
  if (mainChart) mainChart.destroy();
  
  const budgetQtyMonthly = getBudgetQtyMonthly();

  const catData = PROD_CATS.map(cat => {
    return MONTH_KEYS.map((mk) => {
      const projs = QTY_DATA[mk] || [];
      // Gunakan p.category (dari server, berdasarkan material code) sebagai
      // primary match. Fallback ke cat.match(p.name) untuk data lama/seeded.
      const mt = projs
        .filter(p => p.category ? p.category === cat.key : cat.match(p.name.toLowerCase()))
        .reduce((s,p) => s + weightToMT(p.totalWeight), 0);
      return mt > 0 ? mt : null;
    });
  });

  const planQty = getPlanQtyByProduct();
  const catPlanData = PROD_CATS.map(cat => {
    return Array(12).fill(null).map((_, mi) => {
      const v = (planQty[cat.key]||[])[mi] || 0;
      return v > 0 ? v : null;
    });
  });

  const totalActual = Array(12).fill(null);
  catData.forEach(arr => arr.forEach((v,i)=>{ if(v!=null) totalActual[i]=(totalActual[i]||0)+v; }));

  const totalPlan = Array(12).fill(0);
  catPlanData.forEach(arr => arr.forEach((v,i)=>{ if(v!=null) totalPlan[i]+= v; }));

  const totalCombined = Array(12).fill(null).map((_,i) => {
    const a = totalActual[i] || 0;
    const p = totalPlan[i]   || 0;
    return (a + p) > 0 ? (a + p) : null;
  });

  mainChart = new Chart(chartCtx, {
    type:'bar',
    data: {
      labels: MONTHS,
      datasets: [
        {
          label:'Budget',
          type:'bar',
          data: budgetQtyMonthly.slice(),
          backgroundColor:'rgba(255,255,255,0.0)',
          borderColor:'rgba(255,255,255,0.30)',
          borderWidth: 2,
          borderRadius: 4,
          borderSkipped: false,
          order: 3,
          stack: 'budget',
          datalabels:{ display:false }
        },
        ...PROD_CATS.map((cat, ci) => ({
          label: cat.label,
          data: catData[ci],
          backgroundColor: cat.rgba,
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: ci===PROD_CATS.length-1 ? 3 : 0,
          borderSkipped: false,
          order: 1,
          stack: 'actual',
          datalabels: ci === PROD_CATS.length-1 ? {
            anchor:'end', align:'end', offset:4,
            font:{ family:"'Barlow Condensed',sans-serif", size:11, weight:'700' },
            color: ctx => {
              const tot = totalActual[ctx.dataIndex];
              const bgt = budgetQtyMonthly[ctx.dataIndex];
              return (tot!=null && tot >= bgt) ? '#4ade80' : '#fb923c';
            },
            formatter:(v, ctx) => {
              const tot = totalActual[ctx.dataIndex];
              if(tot==null) return null;
              const pct = (tot / budgetQtyMonthly[ctx.dataIndex] * 100).toFixed(0);
              return pct + '%';
            }
          } : { display:false }
        })),
        ...PROD_CATS.map((cat, ci) => ({
          label: 'Plan '+cat.label,
          data: catPlanData[ci],
          backgroundColor: cat.color+'55',
          borderColor: cat.color+'99',
          borderWidth: 1,
          borderDash: [3,3],
          borderRadius: ci===PROD_CATS.length-1 ? 3 : 0,
          borderSkipped: false,
          order: 2,
          stack: 'plan',
          datalabels: ci === PROD_CATS.length-1 ? {
            anchor:'end', align:'end', offset:4,
            font:{ family:"'Barlow Condensed',sans-serif", size:11, weight:'700' },
            color: ctx => {
              const comb = totalCombined[ctx.dataIndex];
              const bgt  = budgetQtyMonthly[ctx.dataIndex];
              return (comb!=null && comb >= bgt) ? '#a78bfa' : '#f59e0b';
            },
            formatter:(v, ctx) => {
              const comb = totalCombined[ctx.dataIndex];
              if(!comb) return null;
              const bgt = budgetQtyMonthly[ctx.dataIndex];
              const pct = (comb / bgt * 100).toFixed(0);
              return pct + '%';
            }
          } : { display:false }
        })),
      ]
    },
    options: { 
      responsive: true, 
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{
          display:true, position:'top', align:'end',
          labels:{
            color:'#94a3b8', font:{size:11}, boxWidth:12, boxHeight:8, padding:16,
            filter: item => item.text !== 'Budget' && !item.text.startsWith('Plan ')
          }
        },
        tooltip:{
          backgroundColor:'#141618', borderColor:'rgba(255,255,255,0.12)', borderWidth:1,
          titleFont:{ family:"'Barlow Condensed',sans-serif", size:14, weight:'700' },
          bodyFont:{ family:"'Barlow',sans-serif", size:12 }, padding:12,
          callbacks:{
            title: items => {
              const i   = items[0].dataIndex;
              const tot = totalActual[i];
              const bgt = budgetQtyMonthly[i];
              const comb = totalCombined[i];
              const hasPlan = totalPlan[i] > 0;
              if(tot==null && !hasPlan) return `${MONTHS[i]}  ·  Budget: ${bgt.toLocaleString('id-ID')} MT`;
              const actPct  = tot  ? (tot/bgt*100).toFixed(1)+'%'  : '0%';
              const combPct = comb ? (comb/bgt*100).toFixed(1)+'%' : actPct;
              if(hasPlan){
                return `${MONTHS[i]}  ·  Actual ${actPct}  |  Actual+Plan ${combPct}  (Bgt: ${bgt.toLocaleString('id-ID')} MT)`;
              }
              return `${MONTHS[i]}  ·  ${Math.round(tot||0).toLocaleString('id-ID')} MT  (${actPct} of ${bgt.toLocaleString('id-ID')})`;
            },
            label: ctx => {
              if(ctx.dataset.label==='Budget'){
                return `  Budget total: ${Math.round(ctx.parsed.y).toLocaleString('id-ID')} MT`;
              }
              if(ctx.dataset.label.startsWith('Plan ')){
                if(ctx.parsed.y==null||ctx.parsed.y===0) return null;
                return `  Plan ${ctx.dataset.label.replace('Plan ','')} (pipeline): ${Math.round(ctx.parsed.y).toLocaleString('id-ID')} MT`;
              }
              if(ctx.parsed.y==null||ctx.parsed.y===0) return null;
              return `  ${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString('id-ID')} MT`;
            },
            labelColor: ctx => {
              if(ctx.dataset.label==='Budget') return { borderColor:'rgba(255,255,255,0.3)', backgroundColor:'rgba(255,255,255,0.15)' };
              const cat = PROD_CATS.find(c=>c.label===ctx.dataset.label);
              return cat ? { borderColor:cat.color, backgroundColor:cat.color } : {};
            }
          }
        }
      },
      scales:{
        x:{ grid:{display:false}, border:{display:false},
            ticks:{ font:{size:12,family:"'Barlow Condensed',sans-serif",weight:'600'}, color:'#606870' },
            stacked:true },
        y:{ grid:{color:'rgba(255,255,255,0.04)'}, border:{display:false},
            stacked:true,
            ticks:{ font:{size:10}, color:'#606870', callback: v => Math.round(v).toLocaleString('id-ID')+' MT' } }
      },
      onClick:(e,els)=>{
        if(els.length>0){
          const i = els[0].index;
          if(typeof openQtyProductModal==='function') openQtyProductModal(i);
        }
      },
      onHover:(e) => { e.native.target.style.cursor = 'pointer'; }
    },
    plugins: typeof ChartDataLabels!=='undefined' ? [ChartDataLabels] : []
  });
}

function buildTable() {
  const tbody = document.getElementById('month-tbody');
  tbody.innerHTML = '';
  let totBudget=0, totActual=0, totPlan=0;

  MONTHS.forEach((m,i) => {
    const budget=BUDGET.margin[i], actual=ACTUAL.margin[i], plan=ACTUAL.plan[i], rev=ACTUAL.revenue[i];
    const isCur=i===NOW_MONTH, isPS=PS_CHAINS[m.toLowerCase()] && PS_CHAINS[m.toLowerCase()].length > 0;
    const attPct = actual!=null && budget>0 ? (actual/budget)*100 : null;
    const gap    = actual!=null ? actual-budget : null;
    const marginP= actual!=null&&rev!=null ? (actual/rev*100) : null;

    totBudget+=budget;
    if(actual!=null) totActual+=actual;
    if(plan!=null)   totPlan+=plan;

    const achColor = attPct==null?'var(--muted)':attPct>=80?'var(--ok)':attPct>=30?'var(--warn)':'var(--over)';
    const achW = attPct!=null ? Math.min(attPct,100).toFixed(1) : 0;
    const attChip = attPct==null
      ? `<span style="color:var(--muted);font-size:12px">—</span>`
      : `<div style="min-width:130px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px"><span style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;color:${achColor};line-height:1">${attPct.toFixed(1)}%</span><span style="font-size:10px;color:var(--muted)">vs budget</span></div><div style="height:4px;background:var(--s3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${achW}%;background:${achColor};border-radius:99px;transition:width 1.1s cubic-bezier(.4,0,.2,1)"></div></div></div>`;

    const statusPill = isPS ? `<span class="month-tag-pill pill-ps">PS</span>`
      : isCur ? `<span class="month-tag-pill pill-cur">NOW</span>`
      : actual!=null ? `<span class="month-tag-pill pill-done">✓</span>` : '';

    const gapStr = gap==null ? '<td style="color:var(--muted)">—</td>'
      : gap>=0 ? `<td style="color:var(--ok);font-size:11px">+${fmt(gap,2)}</td>`
      : `<td style="color:var(--over);font-size:11px">${fmt(gap,2)}</td>`;

    const actualColor = actual!=null?(isPS?'#f59e0b':'var(--actual)'):'var(--muted)';
    const tr = document.createElement('tr');
    if(isCur) tr.classList.add('is-current');
    if(isPS)  tr.style.background='rgba(245,158,11,0.03)';
    tr.innerHTML = `
      <td>${m} ${statusPill}</td>
      <td>${fmt(budget,2)}</td>
      <td style="color:${actualColor};font-weight:${actual!=null?'600':'400'}">${actual!=null?fmt(actual,2):'—'}</td>
      <td style="color:${plan!=null?'var(--plan)':'var(--muted)'}">${plan!=null?fmt(plan,2):'—'}</td>
      <td style="color:var(--muted2)">${marginP!=null?fmtP(marginP):'—'}</td>
      <td>${attChip}</td>
      ${gapStr}
    `;
    tr.style.cursor='pointer';
    tr.onclick = (function(idx){ return function(){ selectedMonth=idx; openModal(idx); }; })(i);
    tbody.appendChild(tr);
  });

  // Total row
  const tr = document.createElement('tr');
  tr.classList.add('total-row');
  const reported = ACTUAL.margin.filter(v=>v!=null).length;
  const ytdBgt = BUDGET.margin.slice(0,Math.max(reported,1)).reduce((a,b)=>a+b,0);
  const ytdPct = totActual>0 && ytdBgt > 0?(totActual/ytdBgt*100).toFixed(1):null;
  const col = ytdPct!=null?(ytdPct>=80?'var(--ok)':ytdPct>=30?'var(--warn)':'var(--over)'):'var(--muted)';
  const bw  = ytdPct!=null?Math.min(parseFloat(ytdPct),100).toFixed(1):0;
  tr.innerHTML = `
    <td>FULL YEAR</td>
    <td>${fmt(totBudget,2)}</td>
    <td>${totActual>0?fmt(totActual,2):'—'}</td>
    <td>${totPlan>0?fmt(totPlan,2):'—'}</td>
    <td>—</td>
    <td>${ytdPct!=null?`<div style="min-width:130px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px"><span style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;color:${col};line-height:1">${ytdPct}%</span><span style="font-size:10px;color:var(--muted)">vs budget</span></div><div style="height:4px;background:var(--s3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${bw}%;background:${col};border-radius:99px"></div></div></div>`:'—'}</td>
    <td>${totActual>0?fmt(totActual-totBudget,2):'—'}</td>
  `;
  tbody.appendChild(tr);
}

function buildWaterfall() {
  const el = document.getElementById('waterfall');
  el.innerHTML = '';
  const maxBudget = Math.max(...BUDGET.margin, 1);
  MONTHS.forEach((m,i) => {
    const budget=BUDGET.margin[i], actual=ACTUAL.margin[i];
    const isPS = PS_CHAINS[m.toLowerCase()] && PS_CHAINS[m.toLowerCase()].length > 0;
    const budgetW=(budget/maxBudget)*100;
    const actualW=actual!=null && budget > 0 ? Math.min((actual/budget)*budgetW,budgetW):0;
    const actualColor=actual==null?'transparent':isPS?'#f59e0b':(actual/budget)>=0.8?'var(--actual)':(actual/budget)>=0.3?'var(--warn)':'var(--over)';
    const div=document.createElement('div');
    div.className='wf-row';
    div.innerHTML=`<div class="wf-month" style="${isPS?'color:#f59e0b':''}">${m}</div><div class="wf-track"><div class="wf-bg"></div><div class="wf-budget-bar" style="width:${budgetW}%"></div><div class="wf-actual-bar" data-w="${actualW}" style="background:${actualColor}"></div></div><div class="wf-val" style="color:${actual!=null?actualColor:'var(--muted)'}">  ${actual!=null?fmt(actual,2):fmt(budget,2)}</div>`;
    el.appendChild(div);
  });
  setTimeout(()=>{ document.querySelectorAll('.wf-actual-bar').forEach(el=>{el.style.width=(el.dataset.w||0)+'%';}); },150);
}

function updateKPIs() {
  const ytdActual = sum(ACTUAL.margin), totalBudget = sum(BUDGET.margin);
  const reported = ACTUAL.margin.filter(v=>v!=null).length;
  document.getElementById('kpi-budget').textContent = fmt(totalBudget,2);
  document.getElementById('kpi-actual').textContent = ytdActual > 0 ? fmt(ytdActual,2) : '—';
  document.getElementById('kpi-actual-sub').textContent=ytdActual>0?'YTD':'No data yet';
  document.getElementById('kpi-reported').textContent = `${reported} / 12`;
  document.getElementById('footer-updated').textContent = 'Last updated: ' + new Date().toLocaleTimeString();

  if(ytdActual>0 && reported > 0){
    const ytdBgt = sum(BUDGET.margin.slice(0,Math.max(reported,1)));
    const att= ytdBgt > 0 ? ((ytdActual/ytdBgt)*100).toFixed(1) : 0;
    const attEl=document.getElementById('kpi-att');
    if(attEl) {
        attEl.textContent=att+'%';
        attEl.className='kpi-delta '+(att>=80?'delta-good':att>=30?'delta-na':'delta-bad');
    }
  }

  let bestIdx = -1, bestPct = -1;
  ACTUAL.margin.forEach((v,i) => { 
    if(v == null) return; 
    const b = BUDGET.margin[i]; 
    if(b) {
      const p = (v/b) * 100; 
      if(p > bestPct) { bestPct = p; bestIdx = i; } 
    }
  });
  const bestEl = document.getElementById('kpi-best');
  if(bestEl) {
    if(bestIdx >= 0){
      bestEl.textContent = MONTHS[bestIdx];
      document.getElementById('kpi-best-sub').textContent = bestPct.toFixed(1) + '% of budget';
    } else {
      bestEl.textContent = '—';
    }
  }
}

// ── ANALYTICS CARDS LOGIC ──
function getProdCategoryData() {
  // 5 kategori produk — GI dan GL ditambahkan agar tidak salah masuk ke PPGL
  const cats = {
    sheetPile:  { label:'Sheet Pile',   color:'#4ade80', margin:0, revenue:0, mt:0, projects:[] },
    weldedPipe: { label:'Welded Pipes', color:'#22d3ee', margin:0, revenue:0, mt:0, projects:[] },
    ppgl:       { label:'PPGL / Coil',  color:'#f59e0b', margin:0, revenue:0, mt:0, projects:[] },
    gi:         { label:'GI Steel',     color:'#38bdf8', margin:0, revenue:0, mt:0, projects:[] },
    gl:         { label:'GL Steel',     color:'#818cf8', margin:0, revenue:0, mt:0, projects:[] },
  };

  // Helper: klasifikasi project dari nama (untuk data lama/seeded yang tidak punya category)
  function classifyByName(name) {
    const n = name.toLowerCase();
    if (n.includes('sheet pile') || n.includes('mlion')) return 'sheetPile';
    if (n.includes('welded') || n.includes('youfa') || n.includes('pipe')) return 'weldedPipe';
    if (n.includes('ppgl') || n.includes('sssc') || n.includes('coil')) return 'ppgl';
    if (n.includes('galvanized') || n.startsWith('gi')) return 'gi';
    if (n.includes('galvalume') || n.startsWith('gl')) return 'gl';
    return 'ppgl'; // fallback
  }

  // Margin & revenue dari PS_CHAINS — cari category dari QTY_DATA entry yang nama-nya sama
  Object.entries(PS_CHAINS).forEach(([mk, chains]) => {
    chains.forEach(ch => {
      // Cari di QTY_DATA bulan yang sama untuk dapat p.category dari server
      const qEntry = (QTY_DATA[mk] || []).find(p => p.name === ch.name);
      const key = (qEntry && qEntry.category) ? qEntry.category : classifyByName(ch.name);
      if (!cats[key]) return; // skip unknown
      cats[key].margin  += ch.margin;
      cats[key].revenue += ch.revenue;
      if (!cats[key].projects.includes(ch.name)) cats[key].projects.push(ch.name);
    });
  });

  // Volume (MT) dari QTY_DATA — gunakan p.category langsung
  Object.values(QTY_DATA).forEach(projs => {
    projs.forEach(p => {
      const key = p.category ? p.category : classifyByName(p.name);
      if (!cats[key]) return;
      cats[key].mt += weightToMT(p.totalWeight);
    });
  });

  // Kembalikan hanya kategori yang punya data
  return Object.values(cats).filter(c => c.margin > 0 || c.mt > 0);
}

function getCustomerData() {
  const custMap = {};
  Object.values(PS_CHAINS).forEach(chains => {
      chains.forEach(ch => {
          if(!custMap[ch.customer]) custMap[ch.customer]={margin:0,revenue:0,projects:[],kg:0};
          custMap[ch.customer].margin  += ch.margin;
          custMap[ch.customer].revenue += ch.revenue;
          if (!custMap[ch.customer].projects.includes(ch.name)) custMap[ch.customer].projects.push(ch.name);
      });
  });
  Object.values(QTY_DATA).forEach(projs => {
      projs.forEach(p => {
          if(custMap[p.customer]) custMap[p.customer].kg += parseInt((p.totalWeight||'').replace(/[^0-9]/g,''))||0;
      });
  });
  return custMap;
}

function buildAnalytics() {
  const mq = document.getElementById('mini-qty');
  if(mq) {
    let totalMT = 0;
    Object.values(QTY_DATA).forEach(projs => projs.forEach(p => totalMT += weightToMT(p.totalWeight)));
    const totalBudgMT = getBudgetQtyMonthly().reduce((a,b)=>a+b,0);
    const totalPct = totalBudgMT > 0 ? (totalMT/totalBudgMT*100) : 0;
    const pctColor = totalPct>=100?'var(--ok)':totalPct>=50?'var(--warn)':'#f87171';
    
    mq.innerHTML = `
      <div class="mini-highlight" style="color:#22d3ee">${Math.round(totalMT).toLocaleString('id-ID')} MT</div>
      <div class="mini-sub">of ${totalBudgMT.toLocaleString('id-ID')} MT · <span style="color:${pctColor};font-weight:700">${totalPct.toFixed(1)}%</span></div>
      <div class="mini-badges">
        ${MONTH_KEYS.map(mk => {
            const mt = (QTY_DATA[mk]||[]).reduce((s,p)=>s+weightToMT(p.totalWeight),0);
            return mt > 0 ? `<span class="mini-badge" style="background:#22d3ee22;color:#22d3ee">${mk.charAt(0).toUpperCase() + mk.slice(1)} ${Math.round(mt).toLocaleString('id-ID')} MT</span>` : '';
        }).join('')}
      </div>
    `;
  }

  const prodCats = getProdCategoryData();
  const totalMarginProd = prodCats.reduce((s,p)=>s+p.margin,0);
  const totalMTProd = prodCats.reduce((s,p)=>s+p.mt,0);
  
  const mpM = document.getElementById('mini-prod-margin');
  if(mpM) mpM.innerHTML = `
    <div class="mini-highlight" style="color:var(--ok)">${totalMarginProd.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})} M</div>
    <div class="mini-sub">YTD · ${prodCats.length} kategori produk</div>
    <div class="mini-badges">
      ${[...prodCats].sort((a,b)=>b.margin-a.margin).map(p=>`<span class="mini-badge" style="background:${p.color}22;color:${p.color}">${p.label}: ${p.margin.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})} M</span>`).join('')}
    </div>`;
    
  const mpQ = document.getElementById('mini-prod-qty');
  if(mpQ) mpQ.innerHTML = `
    <div class="mini-highlight" style="color:#a78bfa">${Math.round(totalMTProd).toLocaleString('id-ID')} MT</div>
    <div class="mini-sub">YTD · volume produk</div>
    <div class="mini-badges">
      ${[...prodCats].sort((a,b)=>b.mt-a.mt).map(p=>`<span class="mini-badge" style="background:${p.color}22;color:${p.color}">${p.label}: ${Math.round(p.mt).toLocaleString('id-ID')} MT</span>`).join('')}
    </div>`;

  const custMap = getCustomerData();
  const byMargin = Object.entries(custMap).sort((a,b)=>b[1].margin-a[1].margin);
  const top1m = byMargin[0];
  const mc = document.getElementById('mini-cust-margin');
  if(mc && top1m) mc.innerHTML = `
    <div class="mini-highlight" style="color:#4ade80">${top1m[1].margin.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})} M</div>
    <div class="mini-sub">${top1m[0].replace('PT. ','').replace(' Indonesia','')}</div>
    <div class="mini-badges">
      ${byMargin.slice(0,3).map(([n,v],i)=>`<span class="mini-badge" style="background:#4ade8022;color:#4ade80">${i+1}. ${n.replace('PT. ','').replace(' Indonesia','').replace(' Intl','')}</span>`).join('')}
    </div>`;

  const byQty = Object.entries(custMap).filter(([,v])=>v.kg>0).sort((a,b)=>b[1].kg-a[1].kg);
  const top1q = byQty[0];
  const mq2 = document.getElementById('mini-cust-qty');
  if(mq2 && top1q) mq2.innerHTML = `
    <div class="mini-highlight" style="color:#f59e0b">${Math.round(top1q[1].kg/1000).toLocaleString('id-ID')} MT</div>
    <div class="mini-sub">${top1q[0].replace('PT. ','').replace(' Indonesia','')}</div>
    <div class="mini-badges">
      ${byQty.slice(0,3).map(([n,v],i)=>`<span class="mini-badge" style="background:#f59e0b22;color:#f59e0b">${i+1}. ${n.replace('PT. ','').replace(' Indonesia','').replace(' Intl','')}</span>`).join('')}
    </div>`;
}

let activeQtyMonth='jan';
let qtyOpenStates={};
function showQtyMonth(m){ 
    activeQtyMonth=m; 
    qtyOpenStates={};
    buildQtyPanel(); 
}

function buildQtyPanel() {
  const panel = document.getElementById('qty-panel');
  const tabWrap = document.getElementById('qty-tabs-wrap');
  
  if(tabWrap) {
      tabWrap.innerHTML = MONTH_KEYS.map(mk => {
          if(!QTY_DATA[mk] || QTY_DATA[mk].length === 0) return '';
          return `<button class="qty-tab-btn ${activeQtyMonth===mk?'active':''}" onclick="showQtyMonth('${mk}')">${mk.charAt(0).toUpperCase() + mk.slice(1)}</button>`;
      }).join('');
  }

  const projects = QTY_DATA[activeQtyMonth];
  if(!projects || projects.length === 0) {
    panel.innerHTML = `<div style="padding:15px; color: var(--muted);">No Data Imported for ${activeQtyMonth.toUpperCase()}</div>`;
    return;
  }
  
  let html = '';
  projects.forEach((proj, pi) => {
    const open=qtyOpenStates[pi]!==undefined?qtyOpenStates[pi]:(pi===0);
    html += `
      <div class="qty-project">
        <div class="qty-project-head" onclick="toggleQtyProject(${pi})">
            <div class="qty-proj-name" style="color:${proj.color}">
            <span id="qty-arrow-${pi}" style="display:inline-block;margin-right:5px;transition:transform 0.2s;${open?'transform:rotate(90deg)':''}">▶</span>${proj.name}
            </div>
            <div class="qty-proj-total">${proj.totalWeight.replace(/ \(.*?\)/,'')}</div>
        </div>
        <div id="qty-prods-${pi}" style="${open?'':'display:none'}">
            <div class="qty-product-list">
                <div style="font-size:10px;color:var(--muted);padding:0 0 6px;letter-spacing:0.5px;">${proj.customer}</div>`;
    proj.products.forEach(p => {
      html += `<div class="qty-product-row"><div class="qty-product-name" title="${p.name}">${p.name}</div><div class="qty-product-weight">${p.qty} (${p.weight})</div></div>`;
    });
    html += `</div></div></div>`;
  });
  panel.innerHTML = html;
}

window.toggleQtyProject = function(pi){
  qtyOpenStates[pi]=!qtyOpenStates[pi];
  if(qtyOpenStates[pi]===undefined) qtyOpenStates[pi]=false;
  const el=document.getElementById(`qty-prods-${pi}`);
  const arrow=document.getElementById(`qty-arrow-${pi}`);
  const open=qtyOpenStates[pi];
  if(el) el.style.display=open?'block':'none';
  if(arrow) arrow.style.transform=open?'rotate(90deg)':'';
};