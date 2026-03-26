// ============================================================================
// UPLOAD EXCEL MODAL — State
// ============================================================================
let _uploadParsedPayload = null; // menyimpan {header, items} setelah file di-parse

// ── Buka / Tutup Modal ───────────────────────────────────────────────────────
function openUploadModal() {
  const overlay = document.getElementById('upload-modal-overlay');
  overlay.classList.add('open');
  resetUploadModal();
}

function closeUploadModal(event, force) {
  if (event && event.target !== document.getElementById('upload-modal-overlay') && !force) return;
  document.getElementById('upload-modal-overlay').classList.remove('open');
}

function resetUploadModal() {
  _uploadParsedPayload = null;

  // Reset dropzone
  document.getElementById('upload-dropzone').style.display  = 'block';
  document.getElementById('upload-preview-section').style.display = 'none';
  document.getElementById('upload-modal-badge').style.display     = 'none';
  document.getElementById('upload-btn-reset').style.display       = 'none';
  document.getElementById('upload-warning').style.display         = 'none';
  document.getElementById('upload-file-info').textContent         = 'Belum ada file dipilih';

  // Reset submit button
  const btn = document.getElementById('upload-btn-submit');
  btn.disabled = true;
  btn.classList.remove('ready', 'loading');
  btn.style.background   = 'rgba(34,211,238,0.15)';
  btn.style.color        = 'rgba(34,211,238,0.4)';
  btn.style.cursor       = 'not-allowed';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M5 12l5 5L20 7"/></svg>
    Simpan ke Database`;

  // Reset file input
  const inp = document.getElementById('upload-file-input');
  if (inp) inp.value = '';
}

// ── Drag & Drop ──────────────────────────────────────────────────────────────
function handleUploadDrop(event) {
  event.preventDefault();
  document.getElementById('upload-dropzone').classList.remove('upload-dz-hover');
  const file = event.dataTransfer.files[0];
  if (file) processUploadFile(file);
}

function handleUploadFileSelect(event) {
  const file = event.target.files[0];
  if (file) processUploadFile(file);
}

// ── Core: Read & Parse File ──────────────────────────────────────────────────
function processUploadFile(file) {
  document.getElementById('upload-file-info').textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      let rows;
      const firstBytes = new Uint8Array(evt.target.result).slice(0, 200);
      const rawText    = new TextDecoder('utf-8').decode(firstBytes);
      const isXml      = rawText.includes('<?xml') && rawText.includes('Excel.Sheet');

      if (isXml) {
        const text = new TextDecoder('utf-8').decode(evt.target.result);
        rows = parseXmlSpreadsheet(text);
      } else {
        const data     = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      }

      const payload = parseProjectSheetData(rows);

      if (!payload.header.psNumber) {
        showUploadError('Struktur file tidak dikenali. Pastikan file adalah Project Sheet yang valid (harus ada baris "PS  #").');
        return;
      }

      _uploadParsedPayload = payload;
      renderUploadPreview(payload, file.name);

    } catch (err) {
      console.error(err);
      showUploadError('Gagal membaca file. Pastikan file tidak corrupt dan formatnya benar.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function showUploadError(msg) {
  const warn = document.getElementById('upload-warning');
  warn.innerHTML = '⚠️ ' + msg;
  warn.style.display = 'block';
  document.getElementById('upload-preview-section').style.display = 'block';
  document.getElementById('upload-dropzone').style.display = 'none';
}

// ── Render Preview ───────────────────────────────────────────────────────────
const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function renderUploadPreview(payload, fileName) {
  const { header, items } = payload;

  // Sembunyikan dropzone, tampilkan preview
  document.getElementById('upload-dropzone').style.display        = 'none';
  document.getElementById('upload-preview-section').style.display = 'block';
  document.getElementById('upload-modal-badge').style.display     = 'inline-flex';
  document.getElementById('upload-btn-reset').style.display       = 'inline-flex';

  // Hitung bulan dari PO Date (format dd/mm/yyyy)
  let monthLabel = '—';
  if (header.poDate) {
    const parts = header.poDate.split('/');
    if (parts.length >= 2) {
      const mIdx = parseInt(parts[1]) - 1;
      if (mIdx >= 0 && mIdx <= 11) monthLabel = `${header.poDate}  →  ${MONTH_NAMES[mIdx]} 2026`;
    }
  }

  // Info cards
  document.getElementById('prev-ps-number').textContent = header.psNumber || '—';
  document.getElementById('prev-customer').textContent  = header.customerName || '—';
  document.getElementById('prev-po-date').textContent   = monthLabel;

  // KPI — format Rupiah singkat
  const fmt = (v) => {
    if (!v) return '—';
    if (v >= 1e9)  return 'Rp ' + (v / 1e9).toFixed(2) + ' M';
    if (v >= 1e6)  return 'Rp ' + (v / 1e6).toFixed(1) + ' Jt';
    return 'Rp ' + Number(v).toLocaleString('id-ID');
  };
  document.getElementById('prev-sales').textContent      = fmt(header.sales);
  document.getElementById('prev-purchase').textContent   = fmt(header.purchase);
  document.getElementById('prev-margin').textContent     = fmt(header.margin);
  document.getElementById('prev-margin-pct').textContent = header.marginPct ? `(${header.marginPct.toFixed(2)}%)` : '';

  // Item table
  document.getElementById('prev-item-count').textContent = items.length;
  const tbody = document.getElementById('prev-items-tbody');
  tbody.innerHTML = '';

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px;">Tidak ada item ditemukan</td></tr>`;
  } else {
    items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color:var(--muted2);font-size:11px;">${item.no}</td>
        <td>
          <div style="font-weight:600;font-size:12px;">${item.material}</div>
          ${item.size ? `<div style="font-size:11px;color:var(--muted2);margin-top:2px;">${item.size.substring(0,80)}${item.size.length>80?'…':''}</div>` : ''}
        </td>
        <td style="text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;">
          ${Number(item.qtyVal).toLocaleString('id-ID')} ${item.qtyUnit}
        </td>
        <td style="text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;">
          ${Number(item.totalWeight).toLocaleString('id-ID')} KG
        </td>
        <td style="text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--muted2);">
          ${item.purchasePrice ? Number(item.purchasePrice).toLocaleString('id-ID') : '—'}
        </td>`;
      tbody.appendChild(tr);
    });
  }

  // Warning jika field penting kosong
  const missing = [];
  if (!header.sales)   missing.push('Total Sales');
  if (!header.margin)  missing.push('Margin');
  if (!header.poDate)  missing.push('PO Date');
  const warnEl = document.getElementById('upload-warning');
  if (missing.length) {
    warnEl.innerHTML = `⚠️ Beberapa field tidak terbaca: <strong>${missing.join(', ')}</strong>. Data tetap bisa disimpan, tapi mungkin tidak lengkap.`;
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }

  // Aktifkan tombol Submit
  const btn = document.getElementById('upload-btn-submit');
  btn.disabled = false;
  btn.classList.add('ready');
  btn.style.background = '';
  btn.style.color      = '';
  btn.style.cursor     = '';
}

// ── Submit ke Database ───────────────────────────────────────────────────────
async function submitUploadToDb() {
  if (!_uploadParsedPayload) return;

  const btn = document.getElementById('upload-btn-submit');
  btn.disabled = true;
  btn.classList.remove('ready');
  btn.classList.add('loading');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;animation:spin 1s linear infinite;">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Menyimpan...`;

  try {
    const res = await fetch('/api/project-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_uploadParsedPayload)
    });

    if (res.ok) {
      const psNum = _uploadParsedPayload.header.psNumber;
      // Tampilkan sukses sebentar lalu tutup
      btn.innerHTML = `✓ Tersimpan!`;
      btn.style.background = 'linear-gradient(135deg,#15803d,#166534)';
      btn.style.color      = '#fff';
      btn.classList.remove('loading');
      showToast(`✓ ${psNum} berhasil disimpan ke database`);
      setTimeout(() => {
        closeUploadModal(null, true);
        if (typeof initApp === 'function') initApp();
      }, 900);
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${res.status}`);
    }
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.classList.add('ready');
    btn.style.background = '';
    btn.style.color      = '';
    btn.style.cursor     = '';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M5 12l5 5L20 7"/></svg> Simpan ke Database`;
    showToast(`Gagal menyimpan: ${err.message}`, true);
  }
}

// Tambahkan animasi spin ke stylesheet secara dinamis (jika belum ada)
(function() {
  if (!document.getElementById('spin-style')) {
    const s = document.createElement('style');
    s.id = 'spin-style';
    s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }
})();

// ============================================================================
// XML SpreadsheetML PARSER
// File .xls dari sistem PS (SGD, LSJ) menggunakan format Office 2003 XML.
// SheetJS tidak bisa membacanya — parser ini menggantinya.
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
      // ss:Index → ada kolom yang di-skip
      const idxAttr = cellEl.getAttribute('Index');
      if (idxAttr) {
        const target = parseInt(idxAttr) - 1;
        while (colIdx < target) { cells.push(''); colIdx++; }
      }

      const dataEl = cellEl.querySelector('Data');
      const val    = dataEl ? (dataEl.textContent || '').replace(/\n\s*/g, ' ').trim() : '';
      cells.push(val);
      colIdx++;

      // ss:MergeAcross → isi kolom merge dengan ''
      const merge = cellEl.getAttribute('MergeAcross');
      if (merge) {
        for (let m = 0; m < parseInt(merge); m++) { cells.push(''); colIdx++; }
      }
    });

    rows.push(cells);
  });

  return rows;
}

// ============================================================================
// PROJECT SHEET PARSER
// Mengurai array 2D → {header, items}
//
// Mapping kolom (XML SpreadsheetML, terverifikasi dari file nyata):
//   HEADER (baris 0–16): col[1]=label, col[4]=value
//   ITEM   (baris 22+ ): col[1]=No, col[2]=Kode, col[6]=Deskripsi,
//                         col[9]=Qty, col[11]=TotalWeight, col[14]=Harga/KG
//   SUMMARY (post-TOTAL): col[1]=label, col[9]=IDR, col[11]=pct
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

  // ── Header section ──
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
  }

  // ── Item rows ──
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

  // ── Summary section ──
  // PENTING: Beberapa PS punya biaya tambahan (Port Charges, KSO, Insurance, dll)
  // yang mengurangi Margin menjadi Net Margin.
  // Contoh LSJ: Margin=1.218.882.000 tapi Net Margin=826.331.311 setelah port charges.
  // Kita harus pakai Net Margin sebagai angka final, bukan Margin kotor.
  // Strategi: scan dulu seluruh section, simpan semua nilai, pakai Net Margin jika ada.
  let rawMargin = 0, rawMarginPct = 0;
  let netMargin = 0, netMarginPct = 0;
  let grossMargin = 0, grossMarginPct = 0;

  for (let i = rowIndex; i < lines.length; i++) {
    const row   = lines[i];
    if (!row) continue;
    const label = String(get(row, 1)).trim();

    if (label === 'Sales' || label === 'Net Sales') {
      const v = cleanNum(get(row, 9));
      if (v && !header.sales) header.sales = v;
    }
    if (label === 'Purchase') {
      header.purchase = Math.abs(cleanNum(get(row, 9)));
    }
    // Margin kotor (sebelum port charges / biaya tambahan)
    if (label === 'Margin') {
      rawMargin    = cleanNum(get(row, 9));
      rawMarginPct = cleanNum(get(row, 11));
    }
    // Gross Margin (setelah Total Cost dikurangi)
    if (label === 'Gross Margin') {
      grossMargin    = cleanNum(get(row, 9));
      grossMarginPct = cleanNum(get(row, 11));
    }
    // Net Margin = angka paling final (setelah semua biaya)
    if (label === 'Net Margin') {
      netMargin    = cleanNum(get(row, 9));
      netMarginPct = cleanNum(get(row, 11));
      break; // tidak ada lagi setelah Net Margin
    }
  }

  // Prioritas: Net Margin > Gross Margin > Margin kotor
  header.margin    = netMargin    || grossMargin    || rawMargin;
  header.marginPct = netMarginPct || grossMarginPct || rawMarginPct;

  return { header, items };
}

// ── BOOTSTRAP ──
initApp();