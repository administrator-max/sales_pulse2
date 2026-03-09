// ── EXPORT DATA ──
function exportData() {
  const rows=[['Month','Budget','Actual','Plan','Revenue']];
  MONTHS.forEach((m,i)=>rows.push([m,BUDGET.margin[i],ACTUAL.margin[i]??'',ACTUAL.plan[i]??'',ACTUAL.revenue[i]??'']));
  const csv=rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='MarginTracker.csv';
  a.click();
}

// ── PROJECT CSV UPLOAD & PARSER ──
document.getElementById('globalUpload').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    const csvText = evt.target.result;
    const payload = parseProjectSheetCSV(csvText);
    
    if(!payload.header.psNumber) {
      showToast("Invalid CSV structure.", true);
      return;
    }

    try {
      const res = await fetch('/api/project-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if(res.ok) {
        showToast(`Imported ${payload.header.psNumber} ✓`);
        initApp(); // Refresh everything from DB
      } else {
        showToast("Server rejected import", true);
      }
    } catch(err) {
      showToast("Network error during import", true);
    }
  };
  reader.readAsText(file);
});

function parseProjectSheetCSV(csvText) {
  const lines = csvText.split('\n').map(line => line.split(','));
  const header = {};
  const items = [];
  
  const cleanNum = (str) => {
    if(!str) return 0;
    let s = str.replace(/"/g, '').trim();
    if(s.includes('%')) s = s.replace('%', '');
    s = s.replace(/\./g, '').replace(',', '.');
    if(s.startsWith('(') && s.endsWith(')')) { s = '-' + s.substring(1, s.length - 1); }
    return parseFloat(s) || 0;
  };

  for(let i=0; i<18; i++) {
    if(!lines[i]) continue;
    const label = (lines[i][1] || '').trim();
    const val = (lines[i][4] || '').trim();
    if(label === 'PS  #') header.psNumber = val;
    if(label === 'Project Code') header.projectCode = val;
    if(label === 'Project Name') header.projectName = val;
    if(label === 'Subsidiary') header.subsidiary = val;
    if(label === 'Customer Name') header.customerName = val;
    if(label === 'Supplier Name') header.supplierName = val;
    if(label === 'PO Date') header.poDate = val;
    if(label === 'Currency') header.currency = val;
  }

  let rowIndex = 18; 
  while(rowIndex < lines.length) {
    const row = lines[rowIndex];
    if(!row || !row[1]) { rowIndex++; continue; }
    if(row[1].includes('Sales') || row[1].includes('TOTAL') || row[1].includes('Margin')) break;
    
    if(parseInt(row[1])) { 
      const material = row[2]; const size = row[5]; const length = row[7];
      const qtyMatch = (row[8] || '').match(/([0-9.,]+)\s*(.*)/);
      items.push({
        no: parseInt(row[1]), material, size, length,
        qtyVal: qtyMatch ? cleanNum(qtyMatch[1]) : 0,
        qtyUnit: qtyMatch ? qtyMatch[2].trim() : '',
        totalWeight: cleanNum(row[10]), purchasePrice: cleanNum(row[11])
      });
    }
    rowIndex++;
  }

  for(let i = rowIndex; i < lines.length; i++) {
    const row = lines[i];
    if(!row) continue;
    const label = (row[1] || '').trim();
    if(label === 'Sales' || label === 'Total') header.sales = cleanNum(row[10] || row[9] || row[11]);
    if(label === 'Purchase') header.purchase = cleanNum(row[10] || row[9] || row[11]);
    if(label === 'Margin') {
      header.margin = cleanNum(row[10] || row[9] || row[11]);
      header.marginPct = cleanNum(row[13] || row[12] || row[14]);
    }
  }

  return { header, items };
}

// ── BOOTSTRAP ──
if (DRIVE.CLIENT_ID) setTimeout(loadGapiScript, 500);

// Initialize application
initApp();