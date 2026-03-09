// ── GOOGLE DRIVE SYNC ENGINE ──
const DRIVE = {
  CLIENT_ID   : '',
  FOLDER_ID   : '',
  FOLDER_NAME : '',
  ACCESS_TOKEN: '',
  USER_EMAIL  : '',
  SCOPES      : 'https://www.googleapis.com/auth/drive.readonly',
  loadedFiles : {},   // filename → { id, modifiedTime, parsed:true/false }
  syncLog     : [],
};

// ── Persist Drive config ─────────────────────────────────
function driveLoad() {
  try {
    const s = localStorage.getItem('mt2026_drive');
    if (s) { const p=JSON.parse(s); DRIVE.CLIENT_ID=p.clientId||''; DRIVE.FOLDER_ID=p.folderId||''; DRIVE.FOLDER_NAME=p.folderName||''; DRIVE.loadedFiles=p.loadedFiles||{}; }
  } catch(e) {}
}
function driveSave() {
  try { localStorage.setItem('mt2026_drive', JSON.stringify({ clientId:DRIVE.CLIENT_ID, folderId:DRIVE.FOLDER_ID, folderName:DRIVE.FOLDER_NAME, loadedFiles:DRIVE.loadedFiles })); } catch(e) {}
}
driveLoad();

// ── Update header button state ────────────────────────────
function updateDriveBtn() {
  const btn = document.getElementById('driveBtn');
  const badge = document.getElementById('driveBadge');
  if (!btn) return;
  const n = Object.keys(DRIVE.loadedFiles).length;
  if (DRIVE.ACCESS_TOKEN) {
    btn.classList.add('connected'); btn.classList.remove('syncing');
    badge.style.display = 'flex'; badge.textContent = n || '✓';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Drive Connected <span class="drive-badge" id="driveBadge" style="display:flex">${n||'✓'}</span>`;
  } else {
    btn.classList.remove('connected','syncing');
    badge.style.display = 'none';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Sync Drive <span class="drive-badge" id="driveBadge" style="display:none"></span>`;
  }
}

// ── Open / close panel ────────────────────────────────────
function openDrivePanel() {
  document.getElementById('driveOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderDrivePanel();
}
function closeDrivePanel(e, force=false) {
  if (!force && e && e.target !== document.getElementById('driveOverlay')) return;
  document.getElementById('driveOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key==='Escape') closeDrivePanel(null, true); });

// ── Render panel (state machine) ─────────────────────────
function renderDrivePanel() {
  const body = document.getElementById('drivePanelBody');
  if (!body) return;

  const step1done = !!DRIVE.CLIENT_ID;
  const step2done = !!DRIVE.ACCESS_TOKEN;
  const step3done = !!DRIVE.FOLDER_ID;

  const stepsHTML = `
    <div class="drive-steps">
      <div class="drive-step ${step1done?'done':'active'}">
        <div class="ds-circle">${step1done?'✓':'1'}</div>
        <div class="ds-label">Setup API</div>
      </div>
      <div class="drive-step ${step2done?'done':step1done?'active':''}">
        <div class="ds-circle">${step2done?'✓':'2'}</div>
        <div class="ds-label">Login Google</div>
      </div>
      <div class="drive-step ${step3done?'done':step2done?'active':''}">
        <div class="ds-circle">${step3done?'✓':'3'}</div>
        <div class="ds-label">Pilih Folder</div>
      </div>
      <div class="drive-step ${step2done&&step3done?'active':''}">
        <div class="ds-circle">4</div>
        <div class="ds-label">Sync Files</div>
      </div>
    </div>`;

  let content = stepsHTML;

  if (!step1done) {
    content += `
      <div class="drive-info-box">
        <strong>Perlu Google Cloud API Client ID</strong><br>
        Dashboard ini akan minta izin read-only ke Google Drive Anda. Gratis dan aman — hanya baca file, tidak bisa edit/hapus.
      </div>
      <div class="drive-section">
        <div class="drive-section-title">Cara Mendapatkan Client ID</div>
        <div class="setup-steps">
          <div class="setup-step">Buka <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a> → Buat project baru atau pilih yang ada</div>
          <div class="setup-step">Menu kiri: <strong>APIs &amp; Services → Library</strong> → cari <strong>"Google Drive API"</strong> → Enable</div>
          <div class="setup-step">Menu kiri: <strong>APIs &amp; Services → OAuth consent screen</strong> → pilih <strong>External</strong> → isi App name → Save</div>
          <div class="setup-step">Menu kiri: <strong>APIs &amp; Services → Credentials</strong> → <strong>+ Create Credentials → OAuth 2.0 Client IDs</strong> → pilih <strong>Web application</strong></div>
          <div class="setup-step">Di field <strong>Authorized JavaScript origins</strong>, tambahkan URL tempat Anda buka file ini (contoh: <code>file://</code> atau <code>http://localhost</code> atau domain Anda)</div>
          <div class="setup-step">Klik Create → copy <strong>Client ID</strong> (format: <code>xxxxx.apps.googleusercontent.com</code>) → paste di bawah</div>
        </div>
      </div>
      <div class="drive-section">
        <div class="drive-section-title">Masukkan Client ID</div>
        <div class="drive-client-id-row">
          <div>
            <input class="drive-input" id="driveClientIdInput" placeholder="xxxxxxx.apps.googleusercontent.com" value="${DRIVE.CLIENT_ID}">
            <div class="drive-input-hint">Client ID dari Google Cloud Console → Credentials</div>
          </div>
          <button class="drive-auth-btn" onclick="saveClientId()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Simpan
          </button>
        </div>
      </div>`;
  } else if (!step2done) {
    content += `
      <div class="drive-status-row" style="background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.25);">
        <div class="drive-status-left">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--warn)"></div>
          <span>Client ID tersimpan · Belum login Google</span>
        </div>
        <button class="drive-disconnect-btn" style="border-color:rgba(245,158,11,0.3);color:var(--warn)" onclick="resetClientId()">Ubah Client ID</button>
      </div>
      <div class="drive-info-box">
        Klik tombol di bawah untuk login dengan akun Google Anda. Browser akan membuka popup Google → pilih akun → izinkan akses <strong>read-only</strong> ke Drive. Setelah itu, Anda bisa pilih folder.
      </div>
      <div style="text-align:center;padding:20px 0">
        <button class="drive-auth-btn" style="margin:0 auto;padding:14px 28px;font-size:16px;" onclick="driveSignIn()">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z" fill="#4da3ff"/></svg>
          Login dengan Google
        </button>
        <div style="margin-top:12px;font-size:11px;color:var(--muted)">Permission: <strong style="color:var(--muted2)">Drive Read-Only</strong> · Tidak bisa edit/hapus file Anda</div>
      </div>`;
  } else {
    content += `
      <div class="drive-status-row">
        <div class="drive-status-left">
          <div class="drive-status-dot"></div>
          <span>Terhubung sebagai <strong>${DRIVE.USER_EMAIL||'Google Account'}</strong></span>
        </div>
        <button class="drive-disconnect-btn" onclick="driveSignOut()">Disconnect</button>
      </div>
      <div class="drive-section">
        <div class="drive-section-title">Folder Drive</div>
        <div class="drive-folder-row">
          <input class="drive-input" id="driveFolderIdInput" placeholder="Folder ID atau nama folder..." value="${DRIVE.FOLDER_ID}">
          <button class="drive-folder-btn" onclick="browseDriveFolder()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            Browse
          </button>
        </div>
        <div class="drive-input-hint">
          Folder ID ada di URL Google Drive: drive.google.com/drive/folders/<strong style="color:var(--actual)">1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs</strong><br>
          ${DRIVE.FOLDER_NAME ? `📁 <strong style="color:var(--ok)">${DRIVE.FOLDER_NAME}</strong> terpilih` : 'Atau klik Browse untuk cari folder secara visual'}
        </div>
      </div>`;

    if (DRIVE.FOLDER_ID) {
      const files = window._driveFiles || [];
      const nLoaded = Object.keys(DRIVE.loadedFiles).length;
      const nNew = files.filter(f => !DRIVE.loadedFiles[f.name]).length;

      content += `
        <div class="drive-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div class="drive-section-title" style="margin-bottom:0">File di Folder${DRIVE.FOLDER_NAME?' · '+DRIVE.FOLDER_NAME:''}</div>
            <button onclick="listDriveFiles()" style="padding:4px 10px;background:var(--s3);border:1px solid var(--border2);border-radius:5px;font-size:11px;color:var(--muted2);cursor:pointer;transition:all 0.15s;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--muted2)'">
              🔄 Refresh
            </button>
          </div>
          ${files.length === 0
            ? `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Klik Refresh untuk muat daftar file</div>`
            : `<div class="drive-file-list" id="driveFileList">${files.map(f => {
                const loaded = !!DRIVE.loadedFiles[f.name];
                const sel = window._driveSelected && window._driveSelected[f.id];
                return `<div class="drive-file-item ${loaded?'already-loaded':''}" onclick="toggleDriveFile('${f.id}')">
                  <div class="drive-file-icon">${loaded?'✅':'📄'}</div>
                  <div class="drive-file-name" title="${f.name}">${f.name}</div>
                  <div class="drive-file-date">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'2-digit'}) : ''}</div>
                  <div class="drive-file-check ${loaded?'loaded':sel?'checked':''}" id="chk-${f.id}">
                    ${(loaded||sel)?`<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`:''}
                  </div>
                </div>`;
              }).join('')}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:12px">${nLoaded} sudah dimuat · ${nNew} file baru tersedia · <span style="color:var(--ok)">${files.length} total</span></div>`}
        </div>
        <div class="drive-sync-bar">
          <div class="drive-sync-info">
            <strong>${window._driveSelected ? Object.values(window._driveSelected).filter(Boolean).length : 0} file dipilih</strong> untuk di-sync
            <span style="margin-left:8px;font-size:10px">(atau pilih semua yang baru)</span>
          </div>
          <div style="display:flex;gap:8px">
            <button style="padding:8px 14px;background:var(--s2);border:1px solid var(--border2);border-radius:7px;font-size:11px;color:var(--muted2);cursor:pointer" onclick="selectAllNewDriveFiles()">Pilih Semua Baru</button>
            <button class="drive-sync-btn" id="driveSyncBtn" onclick="syncSelectedFiles()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/></svg>
              Sync Sekarang
            </button>
          </div>
        </div>`;

      if (window._driveProgress != null) {
        content += `<div class="drive-progress"><div class="drive-progress-bar"><div class="drive-progress-fill" style="width:${window._driveProgress}%"></div></div><div class="drive-progress-text">${window._driveProgressText||''}</div></div>`;
      }
      if (DRIVE.syncLog.length > 0) {
        content += `<div class="drive-log">${DRIVE.syncLog.slice(-30).join('\n')}</div>`;
      }
    } else {
      content += `<div style="text-align:center;padding:16px;font-size:12px;color:var(--muted)">Masukkan Folder ID atau klik Browse, lalu klik Refresh untuk lihat file.</div>`;
    }

    content += `<button onclick="setDriveFolder()" class="drive-sync-btn" style="width:100%;margin-top:8px;justify-content:center;background:var(--s3);color:var(--muted2);font-size:13px" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s3)'">Simpan Folder ID &amp; Refresh File</button>`;
  }

  body.innerHTML = content;
  if (window.gapi && DRIVE.CLIENT_ID && !DRIVE.ACCESS_TOKEN) initGapiClient();
}

function saveClientId() {
  const v = document.getElementById('driveClientIdInput')?.value?.trim();
  if (!v || !v.includes('.apps.googleusercontent.com')) { alert('Format Client ID tidak valid. Harus berakhiran .apps.googleusercontent.com'); return; }
  DRIVE.CLIENT_ID = v; driveSave(); loadGapiScript(); renderDrivePanel();
}
function resetClientId() { DRIVE.CLIENT_ID = ''; DRIVE.ACCESS_TOKEN = ''; driveSave(); renderDrivePanel(); }
function setDriveFolder() {
  const v = document.getElementById('driveFolderIdInput')?.value?.trim();
  if (!v) return;
  const m = v.match(/folders\/([a-zA-Z0-9_-]+)/);
  DRIVE.FOLDER_ID = m ? m[1] : v;
  DRIVE.FOLDER_NAME = '';
  window._driveFiles = [];
  window._driveSelected = {};
  driveSave(); renderDrivePanel();
  setTimeout(listDriveFiles, 100);
}
function selectAllNewDriveFiles() {
  if (!window._driveFiles) return;
  if (!window._driveSelected) window._driveSelected = {};
  window._driveFiles.forEach(f => { if (!DRIVE.loadedFiles[f.name]) window._driveSelected[f.id] = true; });
  renderDrivePanel();
}
function toggleDriveFile(id) {
  if (!window._driveSelected) window._driveSelected = {};
  window._driveSelected[id] = !window._driveSelected[id];
  renderDrivePanel();
}

function loadGapiScript() {
  if (window.gapi) { initGapiClient(); return; }
  const s = document.createElement('script');
  s.src = 'https://apis.google.com/js/api.js';
  s.onload = () => gapi.load('client:auth2', initGapiClient);
  s.onerror = () => driveLog('err', '❌ Gagal load Google API — cek koneksi internet');
  document.head.appendChild(s);
}
function initGapiClient() {
  if (!DRIVE.CLIENT_ID) return;
  gapi.client.init({
    clientId: DRIVE.CLIENT_ID,
    scope: DRIVE.SCOPES,
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
  }).then(() => {
    const auth = gapi.auth2.getAuthInstance();
    if (auth.isSignedIn.get()) {
      const u = auth.currentUser.get();
      DRIVE.ACCESS_TOKEN = u.getAuthResponse().access_token;
      DRIVE.USER_EMAIL = u.getBasicProfile().getEmail();
      updateDriveBtn(); renderDrivePanel();
    }
  }).catch(e => driveLog('err', '❌ Init gagal: ' + e.error));
}
function driveSignIn() {
  if (!window.gapi) { loadGapiScript(); setTimeout(driveSignIn, 1500); return; }
  gapi.auth2.getAuthInstance().signIn().then(() => {
    const u = gapi.auth2.getAuthInstance().currentUser.get();
    DRIVE.ACCESS_TOKEN = u.getAuthResponse().access_token;
    DRIVE.USER_EMAIL = u.getBasicProfile().getEmail();
    updateDriveBtn(); renderDrivePanel();
    driveLog('ok', '✅ Login berhasil: ' + DRIVE.USER_EMAIL);
  }).catch(e => { driveLog('err', '❌ Login dibatalkan atau gagal: ' + (e.error||e)); renderDrivePanel(); });
}
function driveSignOut() {
  if (window.gapi && gapi.auth2) gapi.auth2.getAuthInstance().signOut();
  DRIVE.ACCESS_TOKEN = ''; DRIVE.USER_EMAIL = '';
  updateDriveBtn(); renderDrivePanel();
}

async function browseDriveFolder() {
  if (!DRIVE.ACCESS_TOKEN) { alert('Login Google terlebih dahulu'); return; }
  try {
    const res = await driveApiCall(`https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder'&fields=files(id,name)&orderBy=name&pageSize=50`);
    const folders = res.files || [];
    if (folders.length === 0) { alert('Tidak ada folder di Drive Anda'); return; }
    const list = folders.map((f,i) => `${i+1}. ${f.name} [${f.id}]`).join('\n');
    const choice = prompt(`Pilih nomor folder:\n\n${list}`);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < folders.length) {
      DRIVE.FOLDER_ID = folders[idx].id;
      DRIVE.FOLDER_NAME = folders[idx].name;
      window._driveFiles = []; window._driveSelected = {};
      driveSave(); renderDrivePanel();
      setTimeout(listDriveFiles, 100);
    }
  } catch(e) { driveLog('err', '❌ Browse folder gagal: ' + e); }
}

async function listDriveFiles() {
  if (!DRIVE.ACCESS_TOKEN || !DRIVE.FOLDER_ID) return;
  driveLog('info', '🔍 Membaca daftar file dari folder...');
  try {
    const q = encodeURIComponent(`'${DRIVE.FOLDER_ID}' in parents and (name contains '.xls' or name contains '.xlsx' or name contains '.csv') and trashed=false`);
    const res = await driveApiCall(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=100`);
    window._driveFiles = res.files || [];
    if (!window._driveSelected) window._driveSelected = {};
    window._driveFiles.forEach(f => { if (!DRIVE.loadedFiles[f.name]) window._driveSelected[f.id] = true; });
    driveLog('ok', `✅ Ditemukan ${window._driveFiles.length} file · ${window._driveFiles.filter(f=>!DRIVE.loadedFiles[f.name]).length} file baru`);
    renderDrivePanel();
  } catch(e) { driveLog('err', '❌ Gagal list file: ' + e); renderDrivePanel(); }
}

async function syncSelectedFiles() {
  const selected = Object.entries(window._driveSelected||{}).filter(([,v])=>v).map(([k])=>k);
  if (selected.length === 0) { driveLog('warn', '⚠️ Belum ada file yang dipilih'); renderDrivePanel(); return; }

  driveLog('info', `🚀 Mulai sync ${selected.length} file...`);
  window._driveProgress = 0; window._driveProgressText = 'Memulai...';
  renderDrivePanel();

  let success=0, skip=0, err=0;
  for (let i=0; i<selected.length; i++) {
    const id = selected[i];
    const file = (window._driveFiles||[]).find(f=>f.id===id);
    if (!file) continue;

    window._driveProgress = Math.round((i/selected.length)*100);
    window._driveProgressText = `[${i+1}/${selected.length}] Mengunduh ${file.name}...`;
    renderDrivePanel();

    try {
      driveLog('info', `  ↓ ${file.name}`);
      const data = await driveDownloadFile(id, file.name);
      if (data) {
        const result = parseDriveFile(file.name, data);
        if (result.months > 0) {
          DRIVE.loadedFiles[file.name] = { id, modifiedTime:file.modifiedTime, parsed:true };
          success++;
          driveLog('ok', `  ✅ ${file.name} → ${result.months} bulan diupdate (${result.detail})`);
        } else {
          skip++;
          driveLog('warn', `  ⚠️ ${file.name} → tidak ada data margin yang terbaca`);
        }
      }
    } catch(e) {
      err++;
      driveLog('err', `  ❌ ${file.name} → ${e}`);
    }
  }

  window._driveProgress = 100;
  window._driveProgressText = `Selesai · ${success} berhasil · ${skip} skip · ${err} error`;
  driveSave(); await persist(); refreshAll(); updateDriveBtn();
  driveLog('ok', `\n📊 Sync selesai · Dashboard diupdate`);
  renderDrivePanel();
  showToast(`Drive sync: ${success} file diproses ✓`, err > 0);
}

async function driveDownloadFile(fileId, fileName) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + DRIVE.ACCESS_TOKEN } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return buf;
}

function parseDriveFile(fileName, arrayBuffer) {
  const ext = fileName.split('.').pop().toLowerCase();
  let months = 0;
  let detail = '';

  if (ext === 'csv') {
    const text = new TextDecoder().decode(arrayBuffer);
    const rows = text.split('\n').map(r => r.split(','));
    rows.forEach(row => {
      const mIdx = MONTHS.findIndex(m => row[0]?.trim().toLowerCase().startsWith(m.toLowerCase()));
      if (mIdx >= 0) {
        const actual = parseFloat(row[2]); const plan = parseFloat(row[3]); const rev = parseFloat(row[4]);
        if (!isNaN(actual) && actual > 0) { ACTUAL.margin[mIdx] = actual; months++; detail += MONTHS[mIdx]+' '; }
        if (!isNaN(plan)   && plan   > 0) ACTUAL.plan[mIdx]    = plan;
        if (!isNaN(rev)    && rev    > 0) ACTUAL.revenue[mIdx] = rev;
      }
    });
  } else {
    const wb = XLSX.read(arrayBuffer, { type:'array' });
    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null });

      let headerRow = -1;
      rows.forEach((row, i) => {
        const r = row.map(c => String(c||'').toLowerCase());
        if (r.some(c=>c.includes('month')||c.includes('bulan')) &&
            r.some(c=>c.includes('actual')||c.includes('margin'))) headerRow = i;
      });

      if (headerRow >= 0) {
        const hdr = rows[headerRow].map(c => String(c||'').toLowerCase());
        const mCol = hdr.findIndex(c=>c.includes('month')||c.includes('bulan'));
        const aCol = hdr.findIndex(c=>c.includes('actual'));
        const pCol = hdr.findIndex(c=>c.includes('plan'));
        const rCol = hdr.findIndex(c=>c.includes('revenue')||c.includes('rev'));
        for (let i=headerRow+1; i<rows.length; i++) {
          const row=rows[i]; if(!row||!row[mCol]) continue;
          const mIdx=MONTHS.findIndex(m=>String(row[mCol]).trim().toLowerCase().startsWith(m.toLowerCase()));
          if (mIdx<0) continue;
          const av=parseFloat(row[aCol]), pv=parseFloat(row[pCol]), rv=parseFloat(row[rCol]);
          if (!isNaN(av)&&av>0) { ACTUAL.margin[mIdx]=av; months++; detail+=MONTHS[mIdx]+' '; }
          if (!isNaN(pv)&&pv>0) ACTUAL.plan[mIdx]=pv;
          if (!isNaN(rv)&&rv>0) ACTUAL.revenue[mIdx]=rv;
        }
      }
    });
  }

  return { months, detail: detail.trim() || 'tidak ada kolom margin/actual' };
}

async function driveApiCall(url) {
  if (window.gapi && gapi.auth2) {
    try {
      const u = gapi.auth2.getAuthInstance().currentUser.get();
      DRIVE.ACCESS_TOKEN = u.getAuthResponse(true).access_token;
    } catch(e) {}
  }
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + DRIVE.ACCESS_TOKEN } });
  if (resp.status === 401) { DRIVE.ACCESS_TOKEN = ''; updateDriveBtn(); throw new Error('Token expired — silakan login ulang'); }
  if (!resp.ok) throw new Error(`API error ${resp.status}`);
  return resp.json();
}

function driveLog(type, msg) {
  const classes = { ok:'log-ok', warn:'log-warn', err:'log-err', info:'log-info' };
  DRIVE.syncLog.push(`<span class="${classes[type]||'log-info'}">${msg}</span>`);
  if (DRIVE.syncLog.length > 60) DRIVE.syncLog.shift();
}