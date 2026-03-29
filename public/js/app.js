// ============================================================================
// UPLOAD EXCEL MODAL — State
// ============================================================================
const DEFAULT_FX_RATE = 17000; // Fallback kurs USD→IDR jika template belum diisi

let _uploadParsedFiles   = [];   // array of parsed payloads (satu per file)
let _uploadGrouped       = {};   // grouped by (projectName + poDate)

// ── Buka / Tutup Modal ───────────────────────────────────────────────────────
function openUploadModal() {
  document.getElementById('upload-modal-overlay').classList.add('open');
  resetUploadModal();
}

function closeUploadModal(event, force) {
  if (event && event.target !== document.getElementById('upload-modal-overlay') && !force) return;
  document.getElementById('upload-modal-overlay').classList.remove('open');
}

function resetUploadModal() {
  _uploadParsedFiles = [];
  _uploadGrouped     = {};
  document.getElementById('upload-dropzone').style.display         = 'block';
  document.getElementById('upload-preview-section').style.display  = 'none';
  document.getElementById('upload-modal-badge').style.display      = 'none';
  document.getElementById('upload-btn-reset').style.display        = 'none';
  document.getElementById('upload-warning').style.display          = 'none';
  document.getElementById('upload-file-info').textContent          = 'Belum ada file dipilih';
  _setSubmitBtn(false);
  const inp = document.getElementById('upload-file-input');
  if (inp) inp.value = '';
}

function _setSubmitBtn(ready, text) {
  const btn = document.getElementById('upload-btn-submit');
  btn.disabled = !ready;
  btn.className = 'upload-submit-btn' + (ready ? ' ready' : '');
  btn.innerHTML = (text || (ready ? '✓ Simpan ke Database' : '✓ Simpan ke Database'))
    .replace('✓', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M5 12l5 5L20 7"/></svg>');
}

// ── Drag & Drop ──────────────────────────────────────────────────────────────
function handleUploadDrop(event) {
  event.preventDefault();
  document.getElementById('upload-dropzone').classList.remove('upload-dz-hover');
  const files = Array.from(event.dataTransfer.files);
  if (files.length) processUploadFiles(files);
}

function handleUploadFileSelect(event) {
  const files = Array.from(event.target.files);
  if (files.length) processUploadFiles(files);
}

// ── Process Multiple Files ───────────────────────────────────────────────────
async function processUploadFiles(files) {
  document.getElementById('upload-file-info').textContent =
    `⏳ Memproses ${files.length} file...`;

  const results = [];
  const errors  = [];

  for (const file of files) {
    try {
      const rows    = await _readFileAsRows(file);
      const payload = parseProjectSheetData(rows);
      if (!payload.header.psNumber) {
        errors.push(`${file.name}: PS # tidak ditemukan`);
        continue;
      }
      payload._fileName = file.name;
      results.push(payload);
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }

  _uploadParsedFiles = results;

  if (results.length === 0) {
    showUploadError('Tidak ada file valid: ' + errors.join('; '));
    return;
  }

  // Group by (projectName, poDate) → consolidation
  _uploadGrouped = _groupByProject(results);

  renderUploadPreview(errors);
}

function _readFileAsRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const firstBytes = new Uint8Array(evt.target.result).slice(0, 200);
        const rawText    = new TextDecoder('utf-8').decode(firstBytes);
        const isXml      = rawText.includes('<?xml') && rawText.includes('Excel.Sheet');
        let rows;
        if (isXml) {
          rows = parseXmlSpreadsheet(new TextDecoder('utf-8').decode(evt.target.result));
        } else {
          const wb    = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        }
        resolve(rows);
      } catch(e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}

function _groupByProject(payloads) {
  const groups = {};
  payloads.forEach(p => {
    const key = (p.header.projectName || p.header.psNumber) + '__' + (p.header.poDate || '');
    if (!groups[key]) groups[key] = { projectName: p.header.projectName, poDate: p.header.poDate, files: [] };
    groups[key].files.push(p);
  });
  return groups;
}

function showUploadError(msg) {
  const warn = document.getElementById('upload-warning');
  warn.innerHTML = '⚠️ ' + msg;
  warn.style.display = 'block';
  document.getElementById('upload-preview-section').style.display = 'block';
  document.getElementById('upload-dropzone').style.display        = 'none';
}

// ── Render Preview ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function renderUploadPreview(errors) {
  document.getElementById('upload-dropzone').style.display        = 'none';
  document.getElementById('upload-preview-section').style.display = 'block';
  document.getElementById('upload-modal-badge').style.display     = 'inline-flex';
  document.getElementById('upload-btn-reset').style.display       = 'inline-flex';

  const totalFiles   = _uploadParsedFiles.length;
  const totalGroups  = Object.keys(_uploadGrouped).length;
  const grandTotalM  = _uploadParsedFiles.reduce((s, p) => s + (p.header.marginIDR || 0), 0);

  // Footer info & badge
  document.getElementById('upload-file-info').textContent = `${totalFiles} file · ${totalGroups} project`;
  const badge = document.getElementById('upload-modal-badge');
  badge.textContent = totalFiles > 1
    ? `${totalFiles} FILES · ${totalGroups} PROJECT${totalGroups > 1 ? 'S' : ''}`
    : 'File Loaded';

  const fmtM = v => {
    if (!v) return '—';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1e9)  return sign + 'Rp ' + (abs/1e9).toFixed(3) + ' M';
    if (abs >= 1e6)  return sign + 'Rp ' + (abs/1e6).toFixed(1) + ' Jt';
    return sign + 'Rp ' + Number(abs).toLocaleString('id-ID');
  };

  // ── Summary bar (grand total jika multi-project) ──
  const summaryBar = document.getElementById('upload-summary-bar');
  if (totalGroups > 1 && summaryBar) {
    summaryBar.innerHTML = `
      <div style="width:100%;padding:10px 14px;background:rgba(74,222,128,0.06);border:1px solid rgba(74,222,128,0.2);border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--ok);">Grand Total · ${totalFiles} file · ${totalGroups} projects</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;color:var(--ok);">${fmtM(grandTotalM)}</div>
      </div>`;
  } else if (summaryBar) {
    summaryBar.innerHTML = '';
  }

  // ── Render each project group ──
  let html = '';
  Object.values(_uploadGrouped).forEach((group) => {
    const { projectName, poDate, files } = group;

    // Month label from PO Date
    let monthLabel = '—';
    if (poDate) {
      const p = poDate.split('/');
      if (p.length >= 2) {
        const mi = parseInt(p[1]) - 1;
        if (mi >= 0 && mi <= 11) monthLabel = MONTH_NAMES[mi];
      }
    }

    const totalMarginIDR  = files.reduce((s, f) => s + (f.header.marginIDR  || 0), 0);
    const totalSalesIDR   = files.reduce((s, f) => s + (f.header.salesIDR   || 0), 0);
    const totalWeightKg   = files.reduce((s, f) => f.items.reduce((ss, it) => ss + (it.totalWeight || 0), 0) + s, 0);
    const consolidatedPct = totalSalesIDR > 0 ? (totalMarginIDR / totalSalesIDR * 100).toFixed(2) : '0.00';
    const isMulti         = files.length > 1;
    const accentColor     = isMulti ? '#1e5aa8' : '#0288d1';
    const borderColor     = isMulti ? 'rgba(30,90,168,0.25)' : 'var(--border2)';
    const bgColor         = isMulti ? '#f0f7ff' : 'var(--s2)';

    // Per-file rows
    const fileRows = files.map(f => {
      const h     = f.header;
      const isFx  = h.baseCurrency && h.baseCurrency !== 'IDR';
      const fxStr = isFx
        ? `<div style="font-size:10px;color:var(--muted2);margin-top:3px;">
             FX: ${Number(h.netMarginNative || 0).toLocaleString('id-ID')} ${h.baseCurrency}
             &times; ${Number(h.fxToIDR || DEFAULT_FX_RATE).toLocaleString('id-ID')}
             = ${fmtM(h.marginIDR)}
           </div>`
        : '';

      // Item list (collapsed, show first 3)
      const itemRows = f.items.slice(0, 3).map(it =>
        `<div style="font-size:10px;color:var(--muted2);padding:3px 0;border-bottom:1px solid var(--border);">
           <span style="color:var(--muted)">${it.material.substring(0,40)}${it.material.length>40?'…':''}</span>
           &nbsp;&mdash;&nbsp;${Number(it.totalWeight||0).toLocaleString('id-ID')} KG
         </div>`
      ).join('');
      const moreItems = f.items.length > 3
        ? `<div style="font-size:10px;color:var(--muted);padding:3px 0;">+${f.items.length-3} item lainnya</div>`
        : '';

      return `
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;color:#fff;">${h.psNumber}</div>
              <div style="font-size:10px;color:var(--muted2);margin-top:2px;">${h.subsidiary || h.customerName || ''}</div>
              ${fxStr}
            </div>
            <div style="text-align:right;margin-left:12px;flex-shrink:0;">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:800;color:var(--ok);">${fmtM(h.marginIDR)}</div>
              <div style="font-size:10px;color:var(--muted2);">${(h.marginPct||0).toFixed(2)}% &middot; ${h.baseCurrency||'IDR'}</div>
            </div>
          </div>
          ${f.items.length > 0 ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
            ${itemRows}${moreItems}
          </div>` : ''}
        </div>`;
    }).join('');

    // Consolidated footer (only for multi-file groups)
    const consolidatedFooter = isMulti ? `
      <div style="padding:10px 16px;background:#eaf3ff;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--actual);">Total Konsolidasi</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:800;color:var(--ok);">
          ${fmtM(totalMarginIDR)}
          <span style="font-size:12px;color:var(--muted2);margin-left:4px;">${consolidatedPct}%</span>
        </div>
      </div>` : '';

    html += `
      <div style="border:1px solid ${borderColor};border-radius:10px;overflow:hidden;margin-bottom:14px;">
        <!-- Project header -->
        <div style="background:${bgColor};padding:12px 16px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--border2);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${accentColor};margin-bottom:4px;">
              ${isMulti ? `🔗 INTERCOMPANY &middot; ${files.length} Subsidiaries` : '📄 Single PS'}
            </div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;color:#fff;line-height:1.2;">${projectName}</div>
            <div style="font-size:11px;color:var(--muted2);margin-top:4px;">
              PO Date: <strong style="color:var(--plan)">${poDate}</strong>
              &rarr; <strong style="color:#fff">${monthLabel}</strong>
              &nbsp;&middot;&nbsp; ${Math.round(totalWeightKg/1000).toLocaleString('id-ID')} MT
              &nbsp;&middot;&nbsp; ${files.reduce((s,f)=>s+f.items.length,0)} item
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:12px;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;color:var(--ok);">${fmtM(totalMarginIDR)}</div>
            <div style="font-size:10px;color:var(--muted2);">${consolidatedPct}% net margin</div>
          </div>
        </div>
        ${fileRows}
        ${consolidatedFooter}
      </div>`;
  });

  // Write to the clean container
  const container = document.getElementById('upload-groups-container');
  if (container) container.innerHTML = html;

  // Warnings
  const warnEl = document.getElementById('upload-warning');
  const warns  = [...(errors || [])];
  _uploadParsedFiles.forEach(p => {
    if (!p.header.sales)  warns.push(`${p.header.psNumber}: Total Sales tidak terbaca`);
    if (!p.header.margin) warns.push(`${p.header.psNumber}: Margin tidak terbaca`);
  });
  if (warns.length) {
    warnEl.innerHTML = '⚠️ ' + warns.join('<br>⚠️ ');
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }

  _setSubmitBtn(true);
}

// ── Submit ke Database ────────────────────────────────────────────────────────
async function submitUploadToDb() {
  if (!_uploadParsedFiles.length) return;

  const btn = document.getElementById('upload-btn-submit');
  btn.disabled = true;
  btn.className = 'upload-submit-btn loading';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;animation:spin 1s linear infinite;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg> Menyimpan ${_uploadParsedFiles.length} file...`;

  try {
    // Submit satu per satu — server aggregates after each
    for (const payload of _uploadParsedFiles) {
      // Tambahkan tahun dashboard dari FILTER_YEAR ke setiap payload
    if (typeof FILTER_YEAR !== 'undefined') {
        payload.header.dashboardYear = FILTER_YEAR;
    }
    const res = await fetch('/api/project-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`${payload.header.psNumber}: ${err.error || res.status}`);
      }
    }

    const names = Object.values(_uploadGrouped).map(g => g.projectName).join(', ');
    btn.innerHTML = '✓ Tersimpan!';
    btn.className = 'upload-submit-btn success';
    showToast(`✓ ${_uploadParsedFiles.length} PS disimpan (${Object.keys(_uploadGrouped).length} project)`);
    setTimeout(() => { closeUploadModal(null, true); if (typeof initApp === 'function') initApp(); }, 900);

  } catch (err) {
    btn.disabled = false;
    btn.className = 'upload-submit-btn ready';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M5 12l5 5L20 7"/></svg> Simpan ke Database';
    showToast(`Gagal: ${err.message}`, true);
  }
}

// ============================================================================
// XML SpreadsheetML PARSER
// ============================================================================
function parseXmlSpreadsheet(xmlText) {
  let text = xmlText
    .replace(/ xmlns[^"]*"[^"]*"/g, '')
    .replace(/<(\w+):(\w+)/g,  '<$2')
    .replace(/<\/(\w+):(\w+)/g,'</$2')
    .replace(/ (\w+):(\w+)=/g, ' $2=');

  const parser = new DOMParser();
  const doc    = parser.parseFromString(text, 'application/xml');
  const rows   = [];

  doc.querySelectorAll('Row').forEach(rowEl => {
    const cells = [];
    let colIdx  = 0;
    rowEl.querySelectorAll('Cell').forEach(cellEl => {
      const idxAttr = cellEl.getAttribute('Index');
      if (idxAttr) {
        const target = parseInt(idxAttr) - 1;
        while (colIdx < target) { cells.push(''); colIdx++; }
      }
      const dataEl = cellEl.querySelector('Data');
      const val    = dataEl ? (dataEl.textContent || '').replace(/\n\s*/g, ' ').trim() : '';
      cells.push(val);
      colIdx++;
      const merge = cellEl.getAttribute('MergeAcross');
      if (merge) { for (let m = 0; m < parseInt(merge); m++) { cells.push(''); colIdx++; } }
    });
    rows.push(cells);
  });
  return rows;
}

// ============================================================================
// PROJECT SHEET PARSER — dengan FX detection & Net Margin priority
// ============================================================================
function parseProjectSheetData(lines) {
  const header = {};
  const items  = [];

  const cleanNum = (val) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    let s = String(val).replace(/"/g, '').trim();
    if (s.includes('%')) s = s.replace('%', '');
    s = s.replace(/\./g, '').replace(',', '.');
    if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
    return parseFloat(s) || 0;
  };
  const get = (row, idx) => (row && row.length > idx) ? (row[idx] || '') : '';

  // ── Header ──
  for (let i = 0; i < 17; i++) {
    const row   = lines[i];
    if (!row) continue;
    const label = String(get(row, 1)).trim();
    const val   = String(get(row, 4)).trim();

    if (label === 'PS  #' || label === 'PS #') header.psNumber    = val;
    if (label === 'Project Code')               header.projectCode  = val;
    if (label === 'Project Name')               header.projectName  = val;
    if (label === 'Subsidiary')                 header.subsidiary   = val;
    if (label === 'Customer Name')              header.customerName = val;
    if (label === 'Supplier Name')              header.supplierName = val;
    if (label === 'PO Date')                    header.poDate       = val;
    if (label === 'Currency')                   header.currency     = val;

    // FX row: "1 USD = IDR", "1 IDR = IDR", "1 SGD = IDR", dll
    // Format: col[1] = "1 XXX = IDR", col[4] = rate value
    if (label.match(/^1\s+\w+\s+=\s+IDR/i)) {
      header.fxLabel = label;    // e.g. "1 USD = IDR"
      header.fxRate  = cleanNum(val); // numeric rate (misal 17000, atau 1 jika belum diisi)
    }
  }

  // ── Detect base currency & fxToIDR ──
  const fxLabel = header.fxLabel || '';
  const fxRate  = header.fxRate  || 0;
  // Extract currency code dari label: "1 USD = IDR" → "USD"
  const fxMatch = fxLabel.match(/^1\s+(\w+)\s+=\s+IDR/i);
  const baseCurr = fxMatch ? fxMatch[1].toUpperCase() : 'IDR';

  if (baseCurr === 'IDR') {
    header.baseCurrency = 'IDR';
    header.fxToIDR = 1;
  } else {
    header.baseCurrency = baseCurr;
    // Jika rate = 1, template belum diisi → pakai DEFAULT
    header.fxToIDR = (fxRate && fxRate > 1) ? fxRate : DEFAULT_FX_RATE;
  }

  // ── Items ──
  let rowIndex = 22;
  while (rowIndex < lines.length) {
    const row  = lines[rowIndex];
    if (!row || row.length === 0) { rowIndex++; continue; }
    const col1 = String(get(row, 1)).trim();
    const col2 = String(get(row, 2)).trim();
    if (col2 === 'TOTAL') break;
    if (col1 === '' && col2 !== '') { rowIndex++; continue; }
    const itemNo = parseInt(col1);
    if (!isNaN(itemNo) && itemNo > 0) {
      items.push({
        no:            itemNo,
        material:      String(get(row, 2)).trim(),
        size:          String(get(row, 6)).trim(),
        length:        String(get(row, 8)).trim(),
        qtyVal:        cleanNum(get(row, 9)),
        qtyUnit:       'PCS',
        totalWeight:   cleanNum(get(row, 11)),
        purchasePrice: cleanNum(get(row, 14)) || cleanNum(get(row, 12))
      });
    }
    rowIndex++;
  }

  // ── Summary: Net Margin priority ──
  let rawMargin = 0, rawPct = 0, grossMargin = 0, grossPct = 0, netMargin = 0, netPct = 0;
  for (let i = rowIndex; i < lines.length; i++) {
    const row   = lines[i];
    if (!row) continue;
    const label = String(get(row, 1)).trim();
    if (label === 'Sales' || label === 'Net Sales') {
      const v = cleanNum(get(row, 9));
      if (v && !header.sales) header.sales = v;
    }
    if (label === 'Purchase')    { header.purchase = Math.abs(cleanNum(get(row, 9))); }
    if (label === 'Margin')      { rawMargin   = cleanNum(get(row, 9)); rawPct   = cleanNum(get(row, 11)); }
    if (label === 'Gross Margin'){ grossMargin = cleanNum(get(row, 9)); grossPct = cleanNum(get(row, 11)); }
    if (label === 'Net Margin')  { netMargin   = cleanNum(get(row, 9)); netPct   = cleanNum(get(row, 11)); break; }
  }

  // Nilai dalam currency asli file (USD/IDR/etc)
  header.netMarginNative = netMargin || grossMargin || rawMargin;
  header.marginPct       = netPct    || grossPct    || rawPct;

  // Konversi ke IDR
  header.marginIDR = header.netMarginNative * header.fxToIDR;
  header.salesIDR  = (header.sales || 0) * (header.baseCurrency === 'IDR' ? 1 : header.fxToIDR);

  // Backward compat: header.margin = IDR value (yang disimpan ke DB)
  header.margin = header.marginIDR;

  return { header, items };
}

// ── BOOTSTRAP ──
initApp();