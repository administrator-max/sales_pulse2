// ── PROJECT EXCEL/CSV UPLOAD & PARSER ──
document.getElementById('globalUpload').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if(!file) return;

  const reader = new FileReader();
  
  reader.onload = async (evt) => {
    try {
      // Read the file data as an ArrayBuffer for SheetJS
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      // Grab the first sheet in the uploaded file
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert the sheet directly to an array of arrays (like CSV rows/cols)
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Pass the 2D array to our updated parser
      const payload = parseProjectSheetData(rows);
      
      if(!payload.header.psNumber) {
        showToast("Invalid file structure. Could not find PS #.", true);
        return;
      }

      const res = await fetch('/api/project-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if(res.ok) {
        showToast(`Imported ${payload.header.psNumber} ✓`);
        if (typeof initApp === 'function') initApp(); // Refresh everything from DB
      } else {
        showToast("Server rejected import", true);
      }
    } catch(err) {
      console.error(err);
      showToast("Error processing file format", true);
    }
  };
  
  // readAsArrayBuffer handles both text (CSV) and binary (XLSX) reliably for SheetJS
  reader.readAsArrayBuffer(file);
});

function parseProjectSheetData(lines) {
  const header = {};
  const items = [];
  
  // Updated cleanNum to handle both direct Excel numbers and formatted strings
  const cleanNum = (val) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val; 
    let s = String(val).replace(/"/g, '').trim();
    if(s.includes('%')) s = s.replace('%', '');
    s = s.replace(/\./g, '').replace(',', '.');
    if(s.startsWith('(') && s.endsWith(')')) { s = '-' + s.substring(1, s.length - 1); }
    return parseFloat(s) || 0;
  };

  // Parse Header Data (Rows 0-17)
  for(let i=0; i<18; i++) {
    if(!lines[i]) continue;
    const label = String(lines[i][1] || '').trim();
    const val = String(lines[i][4] || '').trim();
    
    // Accommodate slight variations in spacing
    if(label === 'PS  #' || label === 'PS #') header.psNumber = val;
    if(label === 'Project Code') header.projectCode = val;
    if(label === 'Project Name') header.projectName = val;
    if(label === 'Subsidiary') header.subsidiary = val;
    if(label === 'Customer Name') header.customerName = val;
    if(label === 'Supplier Name') header.supplierName = val;
    if(label === 'PO Date') header.poDate = val;
    if(label === 'Currency') header.currency = val;
  }

  // Parse Item Rows (Row 18 onwards)
  let rowIndex = 18; 
  while(rowIndex < lines.length) {
    const row = lines[rowIndex];
    if(!row || !row[1]) { rowIndex++; continue; }
    
    const label = String(row[1] || '').trim();
    if(label.includes('Sales') || label.includes('TOTAL') || label.includes('Margin')) break;
    
    // Check if column 1 is an item number
    if(parseInt(row[1])) { 
      const material = String(row[2] || ''); 
      const size = String(row[5] || ''); 
      const length = String(row[7] || '');
      const rawQty = String(row[8] || '');
      const qtyMatch = rawQty.match(/([0-9.,]+)\s*(.*)/);
      
      items.push({
        no: parseInt(row[1]), 
        material, 
        size, 
        length,
        qtyVal: qtyMatch ? cleanNum(qtyMatch[1]) : 0,
        qtyUnit: qtyMatch ? qtyMatch[2].trim() : '',
        totalWeight: cleanNum(row[10]), 
        purchasePrice: cleanNum(row[11])
      });
    }
    rowIndex++;
  }

  // Parse Footer Totals/Margins
  for(let i = rowIndex; i < lines.length; i++) {
    const row = lines[i];
    if(!row) continue;
    
    const label = String(row[1] || '').trim();
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
// Initialize application
initApp();