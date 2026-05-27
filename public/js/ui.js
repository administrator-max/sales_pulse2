// ── RENDER CHARTS & TABLES ──
const chartCtx = document.getElementById('mainChart').getContext('2d');
let mainChart;

function buildChart() {
  if (mainChart) mainChart.destroy();

  // ── Tentukan bulan yang ditampilkan berdasarkan filter ──────────────────────
  const fm = (typeof FILTER_MONTH !== 'undefined') ? FILTER_MONTH : -1;
  const activeIndices = fm === -1 ? Array.from({length: 12}, (_, i) => i) : [fm];
  const activeLabels  = activeIndices.map(i => MONTHS[i]);

  // ── Branch: filter ke specific canonical product ───────────────────────────
  // Render simple Budget vs Actual (2 bar per bulan), tanpa stacking macro
  const cp = (typeof CHART_PRODUCT !== 'undefined') ? CHART_PRODUCT : '__all__';
  if (cp && cp !== '__all__') {
    return _buildChartForProduct(cp, fm, activeIndices, activeLabels);
  }

  const products = getCanonicalProductNames();
  const budgetFiltered = activeIndices.map(i =>
    products.reduce((s, product) => s + getMetricValue(BUDGET.products || {}, product, 'volume', i), 0)
  );

  // ── Build productData & planData hanya untuk bulan aktif ───────────────────
  const planQty = getPlanQtyByProduct();

  const productData = products.map(product =>
    activeIndices.map(i => {
      const mt = getActualProductVolume(product, i);
      return mt > 0 ? mt : null;
    })
  );

  const productPlanData = products.map(product =>
    activeIndices.map(i => {
      const v = (planQty[product] || [])[i] || 0;
      return v > 0 ? v : null;
    })
  );

  // ── Totals per slot (index dalam activeIndices) ─────────────────────────────
  const totalActual = activeIndices.map((_, slot) => {
    let sum = null;
    productData.forEach(arr => {
      if (arr[slot] != null) sum = (sum || 0) + arr[slot];
    });
    return sum;
  });

  const totalPlan = activeIndices.map((_, slot) => {
    let sum = 0;
    productPlanData.forEach(arr => { if (arr[slot]) sum += arr[slot]; });
    return sum;
  });

  const totalCombined = activeIndices.map((_, slot) => {
    const a = totalActual[slot] || 0;
    const p = totalPlan[slot]   || 0;
    return (a + p) > 0 ? (a + p) : null;
  });

  // ── Chart ───────────────────────────────────────────────────────────────────
  // ── Custom plugin: gambar label % di tengah/atas stacked bar 'actual' ──
  const pctLabelPlugin = {
    id: 'pctLabel',
    afterDatasetsDraw(chart) {
      if (chart.tooltip && chart.tooltip.opacity > 0) return;
      const { ctx } = chart;
      const actualMeta = chart.data.datasets
        .map((ds, i) => ({ ds, i }))
        .filter(({ ds }) => ds.stack === 'actual');

      const slotCount = chart.data.labels.length;
      for (let slot = 0; slot < slotCount; slot++) {
        const tot = totalActual[slot];
        const bgt = budgetFiltered[slot];
        if (tot == null || tot === 0) continue;

        let yTop = Infinity, yBottom = -Infinity, xCenter = null;
        actualMeta.forEach(({ i }) => {
          const meta = chart.getDatasetMeta(i);
          if (!meta || meta.hidden) return;
          const bar = meta.data[slot];
          if (!bar) return;
          const props = bar.getProps(['x','y','base'], true);
          if (props.y    < yTop)    yTop    = props.y;
          if (props.base > yBottom) yBottom = props.base;
          xCenter = props.x;
        });

        if (xCenter == null || yTop === Infinity) continue;

        const pct    = (tot / bgt * 100).toFixed(0) + '%';
        const isOver = tot >= bgt;
        const color  = isOver ? '#0A6A36' : '#2077BD';

        const yPos = yTop - 6;

        ctx.save();
        ctx.font         = '700 12px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.fillStyle    = color;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor  = 'rgba(255,255,255,0.8)';
        ctx.shadowBlur   = 5;
        ctx.fillText(pct, xCenter, yPos);
        ctx.restore();
      }
    }
  };

  mainChart = new Chart(chartCtx, {
    type: 'bar',
    data: {
      labels: activeLabels,
      datasets: [
        // Budget bars (outline only)
        {
          label: 'Budget',
          type: 'bar',
          data: budgetFiltered,
          backgroundColor: 'rgba(255,255,255,0.0)',
          borderColor: 'rgba(55,56,150,0.30)',
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
          order: 3,
          stack: 'budget',
          datalabels: { display: false }
        },

        // Actual stacked per canonical product — semua label OFF
        ...products.map((product, pi) => ({
          label: product,
          data: productData[pi],
          backgroundColor: getProductRgba(product, pi, 0.90),
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: pi === products.length - 1 ? 3 : 0,
          borderSkipped: false,
          order: 1,
          stack: 'actual',
          datalabels: { display: false }
        })),

        // Plan stacked — label OFF
        ...products.map((product, pi) => ({
          label: 'Plan ' + product,
          data: productPlanData[pi],
          backgroundColor: getProductColor(product, pi) + '55',
          borderColor: getProductColor(product, pi) + '99',
          borderWidth: 1,
          borderRadius: pi === products.length - 1 ? 3 : 0,
          borderSkipped: false,
          order: 2,
          stack: 'plan',
          datalabels: { display: false }
        })),

        // label % digambar via custom pctLabelPlugin (afterDraw)
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      clip: false,
      aspectRatio: fm === -1 ? 3.5 : 2.0,
      layout: {
        padding: { top: 28, bottom: 4, left: 4, right: 4 }
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: {
            color: '#6D6E71',
            font: { size: 11, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '700' },
            boxWidth: 10, boxHeight: 8, padding: 18,
            filter: item => item.text !== 'Budget' && !item.text.startsWith('Plan ')
          }
        },
        tooltip: {
          backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: 1,
          titleFont: { family: "'Helvetica Neue', Helvetica, Arial, sans-serif", size: 13, weight: '700' },
          bodyFont:  { family: "'Helvetica Neue', Helvetica, Arial, sans-serif", size: 12, weight: '400' },
          padding: 12,
          titleColor: '#231F20', bodyColor: '#6D6E71',
          callbacks: {
            title: items => {
              const slot = items[0].dataIndex;
              const tot  = totalActual[slot];
              const bgt  = budgetFiltered[slot];
              const lbl  = activeLabels[slot];
              if (tot == null) return lbl + '  \u00b7  Budget: ' + bgt.toLocaleString('id-ID') + ' MT';
              const pct  = (tot / bgt * 100).toFixed(1);
              return lbl + '  \u00b7  ' + Math.round(tot).toLocaleString('id-ID') + ' MT'
                   + '  (' + pct + '% vs ' + bgt.toLocaleString('id-ID') + ' MT budget)';
            },
            label: ctx => {
              const lbl = ctx.dataset.label;
              if (lbl === 'Budget') return null;
              if (lbl.startsWith('Plan ')) {
                if (!ctx.parsed.y) return null;
                return '  \ud83d\udccb Plan ' + lbl.replace('Plan ', '') + ':  '
                     + Math.round(ctx.parsed.y).toLocaleString('id-ID') + ' MT';
              }
              if (!ctx.parsed.y) return null;
              const tot  = totalActual[ctx.dataIndex];
              const dist = tot > 0 ? (ctx.parsed.y / tot * 100).toFixed(1) : '0';
              return '  ' + lbl + ':  '
                   + Math.round(ctx.parsed.y).toLocaleString('id-ID') + ' MT'
                   + '  (' + dist + '%)';
            },
            afterBody: items => {
              const slot = items[0].dataIndex;
              const tot  = totalActual[slot];
              const bgt  = budgetFiltered[slot];
              if (tot == null || tot === 0) return [];
              const pct  = (tot / bgt * 100).toFixed(1);
              const lines = [''];
              lines.push('  \u2500\u2500 Total Actual:  ' + Math.round(tot).toLocaleString('id-ID') + ' MT  (' + pct + '%)');
              lines.push('  \u2500\u2500 Budget:        ' + Math.round(bgt).toLocaleString('id-ID') + ' MT');
              if (totalPlan[slot] > 0) {
                const comb = totalCombined[slot] || 0;
                lines.push('  \u2500\u2500 Actual+Plan:   ' + Math.round(comb).toLocaleString('id-ID') + ' MT  (' + (comb/bgt*100).toFixed(1) + '%)');
              }
              return lines;
            },
            labelColor: ctx => {
              if (ctx.dataset.label === 'Budget') return { borderColor: '#D1D5DB', backgroundColor: '#F1F3F5' };
              const lbl = ctx.dataset.label.replace('Plan ', '');
              const idx = products.indexOf(lbl);
              const color = getProductColor(lbl, idx);
              return { borderColor: color, backgroundColor: color };
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false }, border: { display: false },
          ticks: {
            font: { size: 12, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '700' },
            color: idx => {
              if (fm === -1) return '#6D6E71';
              return idx.index === 0 ? '#2077BD' : '#6D6E71';
            }
          },
          stacked: true
        },
        y: {
          grid: { color: '#F1F3F5' }, border: { display: false },
          stacked: true,
          ticks: {
            font: { size: 10, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '400' },
            color: '#6D6E71',
            callback: v => Math.round(v).toLocaleString('id-ID') + ' MT'
          }
        }
      },
      onClick: (e, els) => {
        if (els.length > 0) {
          // Klik bar → buka product detail modal, mapping slot ke month index
          const monthIdx = (typeof FILTER_MONTH !== 'undefined' && FILTER_MONTH !== -1)
            ? FILTER_MONTH
            : els[0].index;
          if (typeof openQtyProductModal === 'function') openQtyProductModal(monthIdx);
        }
      },
      onHover: (e) => { e.native.target.style.cursor = 'pointer'; }
    },
    plugins: (typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : []).concat([pctLabelPlugin])
  });
}

// ── Specialized chart untuk single canonical product ───────────────────────
function _buildChartForProduct(productName, fm, activeIndices, activeLabels) {
  const bp = (BUDGET.products && BUDGET.products[productName]) || null;
  const ap = (typeof ACTUAL_PRODUCTS !== 'undefined' && ACTUAL_PRODUCTS[productName]) || null;

  const budgetMT = activeIndices.map(i => bp ? (bp.volume[i] || 0) : 0);
  const actualMT = activeIndices.map(i => ap ? (ap.volume[i] || 0) : 0);

  // Color tiap bar actual: hijau kalau ≥ budget, biru kalau di bawah
  const actualColors = actualMT.map((v, idx) => {
    const b = budgetMT[idx];
    if (!v) return 'rgba(32,119,189,0.15)';
    return v >= b && b > 0 ? '#2AB675' : '#2077BD';
  });

  const pctLabelPlugin = {
    id: 'pctLabel',
    afterDatasetsDraw(chart) {
      if (chart.tooltip && chart.tooltip.opacity > 0) return;
      const { ctx } = chart;
      const ds = chart.data.datasets.find(d => d.label === 'Actual');
      if (!ds) return;
      const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(ds));
      activeIndices.forEach((_, slot) => {
        const v = actualMT[slot], b = budgetMT[slot];
        if (!v || b <= 0) return;
        const bar = meta.data[slot];
        if (!bar) return;
        const props = bar.getProps(['x','y'], true);
        const pct = (v / b * 100).toFixed(0) + '%';
        const color = v >= b ? '#0A6A36' : '#2077BD';
        ctx.save();
        ctx.font = '700 12px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(255,255,255,0.8)';
        ctx.shadowBlur = 5;
        ctx.fillText(pct, props.x, props.y - 6);
        ctx.restore();
      });
    },
  };

  mainChart = new Chart(chartCtx, {
    type: 'bar',
    data: {
      labels: activeLabels,
      datasets: [
        {
          label: 'Budget',
          data: budgetMT,
          backgroundColor: 'rgba(255,255,255,0)',
          borderColor: 'rgba(55,56,150,0.40)',
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
          categoryPercentage: 0.7,
          barPercentage: 0.95,
        },
        {
          label: 'Actual',
          data: actualMT,
          backgroundColor: actualColors,
          borderColor: 'transparent',
          borderRadius: 4,
          borderSkipped: false,
          categoryPercentage: 0.7,
          barPercentage: 0.65,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: fm === -1 ? 3.5 : 2.0,
      layout: { padding: { top: 28, bottom: 4, left: 4, right: 4 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: { color: '#6D6E71', font: { size: 11, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '700' }, boxWidth: 10, boxHeight: 8, padding: 14 },
        },
        tooltip: {
          backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: 1,
          titleFont: { family: "'Helvetica Neue', Helvetica, Arial, sans-serif", size: 13, weight: '700' },
          bodyFont:  { family: "'Helvetica Neue', Helvetica, Arial, sans-serif", size: 12, weight: '400' },
          padding: 12, titleColor: '#231F20', bodyColor: '#6D6E71',
          callbacks: {
            title: items => `${productName} · ${items[0].label}`,
            label: ctx => {
              const v = Math.round(ctx.parsed.y).toLocaleString('id-ID');
              return `  ${ctx.dataset.label}:  ${v} MT`;
            },
            afterBody: items => {
              const slot = items[0].dataIndex;
              const v = actualMT[slot], b = budgetMT[slot];
              if (!v || !b) return [];
              const pct = (v / b * 100).toFixed(1);
              return ['', `  ── Achievement:  ${pct}% (${Math.round(v).toLocaleString('id-ID')} / ${Math.round(b).toLocaleString('id-ID')} MT)`];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false }, border: { display: false },
          ticks: { font: { size: 12, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '700' }, color: '#6D6E71' },
        },
        y: {
          grid: { color: '#F1F3F5' }, border: { display: false },
          beginAtZero: true,
          ticks: { font: { size: 10, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '400' }, color: '#6D6E71',
                   callback: v => Math.round(v).toLocaleString('id-ID') + ' MT' },
        },
      },
    },
    plugins: [pctLabelPlugin],
  });
}

function buildTable() {
  const tbody = document.getElementById('month-tbody');
  tbody.innerHTML = '';
  let totBudget=0, totActual=0, totPlan=0;

  MONTHS.forEach((m,i) => {
    // Skip months that don't match active filter
    if (typeof FILTER_MONTH !== 'undefined' && FILTER_MONTH !== -1 && FILTER_MONTH !== i) return;
    const budget=BUDGET.margin[i], actual=ACTUAL.margin[i], plan=ACTUAL.plan[i], rev=ACTUAL.revenue[i];
    const isCur=i===NOW_MONTH, isPS=PS_CHAINS[m.toLowerCase()] && PS_CHAINS[m.toLowerCase()].length > 0;
    const attPct = actual!=null && budget>0 ? (actual/budget)*100 : null;
    const gap    = actual!=null ? actual-budget : null;
    const marginP= actual!=null&&rev!=null ? (actual/rev*100) : null;

    totBudget+=budget;
    if(actual!=null) totActual+=actual;
    if(plan!=null)   totPlan+=plan;

    // Brand: green = positive achievement (>=80%), blue = neutral (30-80%), gray = below
    const achColor = attPct==null?'var(--muted)':attPct>=80?'var(--brand-green-dark)':attPct>=30?'var(--brand-blue)':'var(--muted)';
    const achW = attPct!=null ? Math.min(attPct,100).toFixed(1) : 0;
    const attChip = attPct==null
      ? `<span style="color:var(--muted);font-size:12px">—</span>`
      : `<div style="min-width:130px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px"><span style="font-family:inherit;font-size:15px;font-weight:700;color:${achColor};line-height:1">${attPct.toFixed(1)}%</span><span style="font-size:10px;color:var(--muted);font-weight:400;">vs budget</span></div><div style="height:4px;background:var(--s3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${achW}%;background:${achColor};border-radius:99px;transition:width 1.1s cubic-bezier(.4,0,.2,1)"></div></div></div>`;

    const statusPill = isPS ? `<span class="month-tag-pill pill-ps">PS</span>`
      : isCur ? `<span class="month-tag-pill pill-cur">NOW</span>`
      : actual!=null ? `<span class="month-tag-pill pill-done">DONE</span>` : '';

    // Gap: positive = green, negative = dark text (no red per brand)
    const gapStr = gap==null ? '<td style="color:var(--muted)">—</td>'
      : gap>=0 ? `<td style="color:var(--brand-green-dark);font-size:12px;font-weight:700;">+${fmt(gap,2)}</td>`
      : `<td style="color:var(--text);font-size:12px;font-weight:700;">${fmt(gap,2)}</td>`;

    const actualColor = actual!=null?(isPS?'var(--brand-blue)':'var(--brand-blue)'):'var(--muted)';
    const tr = document.createElement('tr');
    if(isCur) tr.classList.add('is-current');
    if(isPS)  { tr.style.background='rgba(32,119,189,0.04)'; }
    tr.innerHTML = `
      <td>${m} ${statusPill}</td>
      <td>${fmt(budget,2)}</td>
      <td style="color:${actualColor};font-weight:${actual!=null?'700':'400'}">${actual!=null?fmt(actual,2):'—'}</td>
      <td style="color:${plan!=null?'var(--brand-dark)':'var(--muted)'}">${plan!=null?fmt(plan,2):'—'}</td>
      <td style="color:var(--muted)">${marginP!=null?fmtP(marginP):'—'}</td>
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
  const totalLabel = (typeof FILTER_MONTH !== 'undefined' && FILTER_MONTH !== -1 && typeof MONTHS !== 'undefined')
    ? `${MONTHS[FILTER_MONTH]} TOTAL`
    : 'FULL YEAR';
  const totalPct = totActual>0 && totBudget > 0?(totActual/totBudget*100).toFixed(1):null;
  const col = totalPct!=null?(totalPct>=80?'var(--brand-green-dark)':totalPct>=30?'var(--brand-blue)':'var(--muted)'):'var(--muted)';
  const bw  = totalPct!=null?Math.min(parseFloat(totalPct),100).toFixed(1):0;
  tr.innerHTML = `
    <td>${totalLabel}</td>
    <td>${fmt(totBudget,2)}</td>
    <td>${totActual>0?fmt(totActual,2):'—'}</td>
    <td>${totPlan>0?fmt(totPlan,2):'—'}</td>
    <td>—</td>
    <td>${totalPct!=null?`<div style="min-width:130px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px"><span style="font-family:inherit;font-size:15px;font-weight:700;color:${col};line-height:1">${totalPct}%</span><span style="font-size:10px;color:var(--muted);font-weight:400;">vs budget</span></div><div style="height:4px;background:var(--s3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${bw}%;background:${col};border-radius:99px"></div></div></div>`:'—'}</td>
    <td>${totActual>0?fmt(totActual-totBudget,2):'—'}</td>
  `;
  tbody.appendChild(tr);
}

function buildWaterfall() {
  const el = document.getElementById('waterfall');
  el.innerHTML = '';
  const maxBudget = Math.max(...BUDGET.margin, 1);
  MONTHS.forEach((m,i) => {
    if (typeof FILTER_MONTH !== 'undefined' && FILTER_MONTH !== -1 && FILTER_MONTH !== i) return;
    const budget=BUDGET.margin[i], actual=ACTUAL.margin[i];
    const isPS = PS_CHAINS[m.toLowerCase()] && PS_CHAINS[m.toLowerCase()].length > 0;
    const budgetW=(budget/maxBudget)*100;
    const actualW=actual!=null && budget > 0 ? Math.min((actual/budget)*budgetW,budgetW):0;
    // Brand: green for >=80% achievement, blue otherwise — gray when below 30%
    const actualColor=actual==null?'transparent':(actual/budget)>=0.8?'var(--brand-green)':(actual/budget)>=0.3?'var(--brand-blue)':'var(--muted)';
    const div=document.createElement('div');
    div.className='wf-row';
    div.innerHTML=`<div class="wf-month" style="${isPS?'color:var(--brand-blue)':''}">${m}</div><div class="wf-track"><div class="wf-bg"></div><div class="wf-budget-bar" style="width:${budgetW}%"></div><div class="wf-actual-bar" data-w="${actualW}" style="background:${actualColor}"></div></div><div class="wf-val" style="color:${actual!=null?actualColor:'var(--muted)'}">  ${actual!=null?fmt(actual,2):fmt(budget,2)}</div>`;
    el.appendChild(div);
  });
  setTimeout(()=>{ document.querySelectorAll('.wf-actual-bar').forEach(el=>{el.style.width=(el.dataset.w||0)+'%';}); },150);
}

function updateKPIs() {
  const indices = typeof getAnalyticsMonthIndices === 'function'
    ? getAnalyticsMonthIndices()
    : Array.from({length:12},(_,i)=>i);
  const periodLabel = typeof getAnalyticsPeriodLabel === 'function'
    ? getAnalyticsPeriodLabel()
    : 'YTD';
  const isMtd = typeof ANALYTICS_PERIOD_MODE !== 'undefined' && ANALYTICS_PERIOD_MODE === 'mtd';
  const reportedSet = typeof getReportedMonthIndices === 'function'
    ? new Set(getReportedMonthIndices())
    : new Set(ACTUAL.margin.map((v,i)=>v!=null?i:-1).filter(i=>i>=0));

  const filtMargin  = indices.map(i => ACTUAL.margin[i]);
  const filtBudget  = indices.map(i => BUDGET.margin[i]);
  const actualValue = sum(filtMargin);
  const totalBudget = filtBudget.reduce((a,b)=>a+(b||0),0);
  const reported    = indices.filter(i => reportedSet.has(i)).length;

  document.getElementById('kpi-budget').textContent = fmt(totalBudget,2);
  document.getElementById('kpi-actual').textContent = actualValue > 0 ? fmt(actualValue,2) : '—';
  document.getElementById('kpi-actual-sub').textContent = actualValue > 0 ? periodLabel : 'No data yet';
  document.getElementById('kpi-reported').textContent = isMtd ? (reported > 0 ? 'Reported' : 'Not reported') : (reported + ' / 12');
  document.getElementById('footer-updated').textContent = 'Last updated: ' + new Date().toLocaleTimeString();

  const attEl  = document.getElementById('kpi-att');
  const attTip = document.getElementById('kpi-att-tip');
  if (actualValue > 0 && totalBudget > 0) {
    const att    = (actualValue / totalBudget * 100).toFixed(1);
    const color  = att>=80 ? 'var(--brand-green-dark)' : att>=30 ? 'var(--brand-blue)' : 'var(--muted)';
    if (attEl) {
      attEl.textContent  = att + '%';
      attEl.className    = 'kpi-delta ' + (att>=80 ? 'delta-good' : att>=30 ? 'delta-na' : 'delta-bad');
    }
    if (attTip) {
      attTip.innerHTML = `
        <div style="padding-top:2px;">
          <div style="display:flex;justify-content:space-between;gap:16px;">
            <span>Actual (${periodLabel})</span>
            <span style="color:var(--brand-blue);font-weight:700;">${fmt(actualValue,2)} MIDR</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:16px;">
            <span>Budget target</span>
            <span style="font-weight:700;color:var(--text);">${fmt(totalBudget,2)} MIDR</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:16px;margin-top:6px;border-top:1px solid var(--border);padding-top:6px;">
            <span>Achievement</span>
            <span style="color:${color};font-weight:700;">${att}%</span>
          </div>
        </div>`;
    }
  } else {
    if (attEl) { attEl.textContent = '—'; attEl.className = 'kpi-delta delta-na'; }
    if (attTip) attTip.innerHTML = '<div style="color:var(--muted);">Belum ada data aktual untuk periode ini.</div>';
  }

  // Best month in the same YTD/MTD period as the summary cards.
  let bestIdx = -1, bestPct = -1;
  indices.forEach(i => {
    const v = ACTUAL.margin[i];
    if (v == null) return;
    const b = BUDGET.margin[i];
    if (b) { const p = (v/b)*100; if (p > bestPct) { bestPct = p; bestIdx = i; } }
  });
  const bestEl = document.getElementById('kpi-best');
  if (bestEl) {
    if (bestIdx >= 0) { bestEl.textContent = MONTHS[bestIdx]; document.getElementById('kpi-best-sub').textContent = bestPct.toFixed(1)+'% of budget'; }
    else { bestEl.textContent = '—'; }
  }
}

// ── ANALYTICS CARDS LOGIC ──
// ── Filter helper: return month keys yang aktif sesuai FILTER_MONTH ──────────
function getActiveMonthKeys() {
  const fm = (typeof FILTER_MONTH !== 'undefined') ? FILTER_MONTH : -1;
  if (fm === -1) return MONTH_KEYS;                    // All months
  return [MONTH_KEYS[fm]];                             // Specific month
}

function getMonthKeysFromIndices(indices) {
  return (indices || []).map(i => MONTH_KEYS[i]).filter(Boolean);
}

function getChainsForMonthIndices(indices) {
  const keys = getMonthKeysFromIndices(indices);
  const result = {};
  keys.forEach(mk => { if (PS_CHAINS[mk]) result[mk] = PS_CHAINS[mk]; });
  return result;
}

function getQtyDataForMonthIndices(indices) {
  const keys = getMonthKeysFromIndices(indices);
  const result = {};
  keys.forEach(mk => { if (QTY_DATA[mk]) result[mk] = QTY_DATA[mk]; });
  return result;
}

function getActiveChains() {
  return getChainsForMonthIndices(getActiveMonthIndices());
}

function getActiveQtyData() {
  return getQtyDataForMonthIndices(getActiveMonthIndices());
}

function getProdCategoryData(indices = getAnalyticsMonthIndices()) {
  const products = getCanonicalProductNames();
  const rows = products.map((product, idx) => ({
    key: product,
    label: product,
    color: getProductColor(product, idx),
    margin: sumProductMetric(ACTUAL_PRODUCTS || {}, product, 'margin', indices),
    revenue: sumProductMetric(ACTUAL_PRODUCTS || {}, product, 'revenue', indices),
    mt: indices.reduce((s, i) => s + getActualProductVolume(product, i), 0),
    budgetMargin: sumProductMetric(BUDGET.products || {}, product, 'margin', indices),
    budgetRevenue: sumProductMetric(BUDGET.products || {}, product, 'revenue', indices),
    budgetMT: sumProductMetric(BUDGET.products || {}, product, 'volume', indices),
    projects: []
  }));
  const byProduct = Object.fromEntries(rows.map(row => [row.key, row]));

  Object.values(getChainsForMonthIndices(indices)).forEach(chains => {
    chains.forEach(ch => {
      const product = ch.product;
      if (!product || !byProduct[product]) return;
      if (!byProduct[product].projects.includes(ch.name)) byProduct[product].projects.push(ch.name);
    });
  });

  return rows.filter(row =>
    row.margin > 0 || row.revenue > 0 || row.mt > 0 ||
    row.budgetMargin > 0 || row.budgetRevenue > 0 || row.budgetMT > 0
  );
}

function getCustomerData(indices = getAnalyticsMonthIndices()) {
  const custMap = {};
  Object.values(getChainsForMonthIndices(indices)).forEach(chains => {
      chains.forEach(ch => {
          if (isExcludedCompanyRankName(ch.customer)) return;
          if(!custMap[ch.customer]) custMap[ch.customer]={margin:0,revenue:0,projects:[],kg:0};
          custMap[ch.customer].margin  += ch.margin;
          custMap[ch.customer].revenue += ch.revenue;
          if (!custMap[ch.customer].projects.includes(ch.name)) custMap[ch.customer].projects.push(ch.name);
      });
  });
  Object.values(getQtyDataForMonthIndices(indices)).forEach(projs => {
      projs.forEach(p => {
          if(custMap[p.customer]) custMap[p.customer].kg += weightToMT(p.totalWeight) * 1000;
      });
  });
  return custMap;
}

function exportDashboardExcel(mode = ANALYTICS_PERIOD_MODE) {
  if (typeof XLSX === 'undefined') {
    showToast('Excel export library belum siap', true);
    return;
  }

  const exportMode = mode === 'mtd' ? 'mtd' : 'ytd';
  const indices = getAnalyticsMonthIndices(exportMode);
  const periodLabel = getAnalyticsPeriodLabel(exportMode);
  const modeLabel = exportMode.toUpperCase();
  const products = getProdCategoryData(indices).sort((a, b) => b.margin - a.margin);
  const customers = Object.entries(getCustomerData(indices))
    .map(([name, data]) => ({ name, ...data, marginPct: data.revenue > 0 ? data.margin / data.revenue * 100 : 0 }))
    .sort((a, b) => b.margin - a.margin);
  const budgetQty = getBudgetQtyMonthly();
  const actualVolumeForMonth = (idx) =>
    getCanonicalProductNames().reduce((s, product) => s + getActualProductVolume(product, idx), 0);

  const totalMargin = products.reduce((s, p) => s + p.margin, 0);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const totalVolume = products.reduce((s, p) => s + p.mt, 0);
  const totalBudgetMargin = products.reduce((s, p) => s + p.budgetMargin, 0);
  const totalBudgetRevenue = products.reduce((s, p) => s + p.budgetRevenue, 0);
  const totalBudgetVolume = products.reduce((s, p) => s + p.budgetMT, 0);

  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  addSheet('Summary', [
    ['Sales Pulse Export'],
    ['Mode', modeLabel],
    ['Period', periodLabel],
    ['Year', FILTER_YEAR],
    [],
    ['Metric', 'Actual', 'Budget', 'Achievement %'],
    ['Margin (MIDR)', totalMargin, totalBudgetMargin, totalBudgetMargin > 0 ? totalMargin / totalBudgetMargin * 100 : null],
    ['Revenue (MIDR)', totalRevenue, totalBudgetRevenue, totalBudgetRevenue > 0 ? totalRevenue / totalBudgetRevenue * 100 : null],
    ['Volume (MT)', totalVolume, totalBudgetVolume, totalBudgetVolume > 0 ? totalVolume / totalBudgetVolume * 100 : null],
    ['Product Count', products.length, '', ''],
    ['Customer Count', customers.length, '', ''],
  ]);

  addSheet('Products', [
    ['Rank', 'Product', 'Margin MIDR', 'Revenue MIDR', 'Volume MT', 'Budget Margin MIDR', 'Budget Revenue MIDR', 'Budget Volume MT', 'Margin %', 'Projects'],
    ...products.map((p, idx) => [
      idx + 1,
      p.label,
      p.margin,
      p.revenue,
      p.mt,
      p.budgetMargin,
      p.budgetRevenue,
      p.budgetMT,
      p.revenue > 0 ? p.margin / p.revenue * 100 : null,
      p.projects.join(' | '),
    ]),
  ]);

  addSheet('Customers', [
    ['Rank', 'Customer', 'Margin MIDR', 'Revenue MIDR', 'Volume MT', 'Margin %', 'Projects'],
    ...customers.map((c, idx) => [
      idx + 1,
      c.name,
      c.margin,
      c.revenue,
      c.kg / 1000,
      c.marginPct,
      c.projects.join(' | '),
    ]),
  ]);

  addSheet('Monthly Detail', [
    ['Month', 'Actual Margin MIDR', 'Budget Margin MIDR', 'Actual Revenue MIDR', 'Budget Revenue MIDR', 'Actual Volume MT', 'Budget Volume MT', 'Margin Achievement %', 'Volume Achievement %'],
    ...indices.map(i => {
      const actualVol = actualVolumeForMonth(i);
      const budgetVol = budgetQty[i] || 0;
      return [
        `${MONTHS[i]} ${FILTER_YEAR}`,
        ACTUAL.margin[i] || 0,
        BUDGET.margin[i] || 0,
        ACTUAL.revenue[i] || 0,
        BUDGET.revenue[i] || 0,
        actualVol,
        budgetVol,
        BUDGET.margin[i] > 0 ? (ACTUAL.margin[i] || 0) / BUDGET.margin[i] * 100 : null,
        budgetVol > 0 ? actualVol / budgetVol * 100 : null,
      ];
    }),
  ]);

  const volumeByProject = {};
  Object.entries(getQtyDataForMonthIndices(indices)).forEach(([mk, projectsForMonth]) => {
    projectsForMonth.forEach(p => {
      volumeByProject[`${mk}__${p.name}`] = weightToMT(p.totalWeight);
    });
  });
  const projectRows = [];
  Object.entries(getChainsForMonthIndices(indices)).forEach(([mk, chains]) => {
    chains.forEach(ch => {
      projectRows.push([
        `${mk.charAt(0).toUpperCase()}${mk.slice(1)} ${FILTER_YEAR}`,
        ch.name,
        ch.customer,
        ch.product || '',
        ch.segment || '',
        ch.revenue || 0,
        ch.margin || 0,
        ch.pct || 0,
        volumeByProject[`${mk}__${ch.name}`] || 0,
        ch.ps || '',
      ]);
    });
  });
  addSheet('Projects', [
    ['Month', 'Project', 'Customer', 'Product', 'Segment', 'Revenue MIDR', 'Margin MIDR', 'Margin %', 'Volume MT', 'PS Number'],
    ...projectRows,
  ]);

  const safePeriod = periodLabel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  XLSX.writeFile(wb, `Sales Pulse ${FILTER_YEAR} ${modeLabel} ${safePeriod}.xlsx`);
  showToast(`Export Excel ${modeLabel} dibuat`);
}

function buildAnalytics() {
  const activeIndices = getAnalyticsMonthIndices();
  const periodLabel = getAnalyticsPeriodLabel();
  const modeLabel = ANALYTICS_PERIOD_MODE.toUpperCase();
  const periodContext = document.getElementById('analytics-period-context');
  if (periodContext) periodContext.textContent = `${modeLabel} · ${periodLabel}`;

  const mq = document.getElementById('mini-qty');
  if(mq) {
    const chartProducts = getCanonicalProductNames();
    const actualMTForMonth = (idx) => chartProducts.reduce((s, product) => s + getActualProductVolume(product, idx), 0);
    const totalMT = activeIndices.reduce((s, idx) => s + actualMTForMonth(idx), 0);
    const budgetMonthly = getBudgetQtyMonthly();
    const totalBudgMT = activeIndices.reduce((s, idx) => s + (budgetMonthly[idx] || 0), 0);
    const totalPct = totalBudgMT > 0 ? (totalMT/totalBudgMT*100) : 0;
    const pctColor = totalPct>=100?'var(--brand-green-dark)':totalPct>=50?'var(--brand-blue)':'var(--muted)';

    mq.innerHTML = `
      <div class="mini-highlight" style="color:var(--brand-blue)">${Math.round(totalMT).toLocaleString('id-ID')} MT</div>
      <div class="mini-sub">${periodLabel} · of ${Math.round(totalBudgMT).toLocaleString('id-ID')} MT · <span style="color:${pctColor};font-weight:700">${totalPct.toFixed(1)}%</span></div>
    `;
  }

  const prodCats = getProdCategoryData();
  const totalMarginProd = prodCats.reduce((s,p)=>s+p.margin,0);
  const totalRevenueProd = prodCats.reduce((s,p)=>s+p.revenue,0);
  const totalMTProd = prodCats.reduce((s,p)=>s+p.mt,0);
  const prodValue = (value, unit) => unit === 'MT'
    ? `${Math.round(value).toLocaleString('id-ID')} MT`
    : `${value.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})} M`;
  const productMini = (actual, unit, color, subLabel) => `
    <div class="mini-highlight" style="color:${color}">${prodValue(actual, unit)}</div>
    <div class="mini-sub">${periodLabel} · ${subLabel}</div>`;
  
  const mpM = document.getElementById('mini-prod-margin');
  if(mpM) mpM.innerHTML = productMini(totalMarginProd, 'M', 'var(--brand-green-dark)', `${prodCats.length} produk`);

  const mpR = document.getElementById('mini-prod-revenue');
  if(mpR) mpR.innerHTML = productMini(totalRevenueProd, 'M', 'var(--brand-blue)', 'revenue produk');

  const mpQ = document.getElementById('mini-prod-qty');
  if(mpQ) mpQ.innerHTML = productMini(totalMTProd, 'MT', 'var(--brand-dark)', 'volume produk');

  const custMap = getCustomerData();
  const byMargin = Object.entries(custMap).sort((a,b)=>b[1].margin-a[1].margin);
  const top1m = byMargin[0];
  const mc = document.getElementById('mini-cust-margin');
  if(mc && top1m) mc.innerHTML = `
    <div class="mini-highlight" style="color:var(--brand-green-dark)">${top1m[1].margin.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})} M</div>
    <div class="mini-sub">${top1m[0].replace('PT. ','').replace(' Indonesia','')}</div>`;

  const byQty = Object.entries(custMap).filter(([,v])=>v.kg>0).sort((a,b)=>b[1].kg-a[1].kg);
  const top1q = byQty[0];
  const mq2 = document.getElementById('mini-cust-qty');
  if(mq2 && top1q) mq2.innerHTML = `
    <div class="mini-highlight" style="color:var(--brand-blue)">${Math.round(top1q[1].kg/1000).toLocaleString('id-ID')} MT</div>
    <div class="mini-sub">${top1q[0].replace('PT. ','').replace(' Indonesia','')}</div>`;
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
    const productColor = proj.product ? getProductColor(proj.product, pi) : (proj.color || 'var(--brand-blue)');
    const productLabel = proj.product ? ` · ${proj.product}` : '';
    html += `
      <div class="qty-project">
        <div class="qty-project-head" onclick="toggleQtyProject(${pi})">
            <div class="qty-proj-name" style="color:${productColor}">
            <span id="qty-arrow-${pi}" style="display:inline-block;margin-right:5px;transition:transform 0.2s;${open?'transform:rotate(90deg)':''}">▶</span>${proj.name}
            </div>
            <div class="qty-proj-total">${proj.totalWeight.replace(/ \(.*?\)/,'')}</div>
        </div>
        <div id="qty-prods-${pi}" style="${open?'':'display:none'}">
            <div class="qty-product-list">
                <div style="font-size:10px;color:var(--muted);padding:0 0 6px;letter-spacing:0.5px;">${proj.customer}${productLabel}</div>`;
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
