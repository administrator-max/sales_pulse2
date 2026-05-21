// ── AI CHATBOX (Dynamic DB Evaluator) ──
let chatOpen=false;

function toggleChat(){
  chatOpen=!chatOpen;
  document.getElementById('chatPanel').classList.toggle('open',chatOpen);
  if(chatOpen) setTimeout(()=>document.getElementById('chatInput').focus(),300);
}

function askShortcut(q){
  document.getElementById('chatInput').value=q;
  sendChat();
}

function addChatMsg(text,role){
  const msgs=document.getElementById('chatMessages');
  const div=document.createElement('div');
  div.className=`chat-msg ${role}`;
  if (role === 'user') div.textContent = text;
  else div.innerHTML = text;
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
  return div;
}

function sendChat(){
  const input=document.getElementById('chatInput');
  const q=input.value.trim();
  if(!q) return;
  input.value='';
  addChatMsg(q,'user');
  const typingEl=addChatMsg('⏳ <em>Menganalisis data...</em>','bot typing');

  const ytdActual=ACTUAL.margin.filter(v=>v!=null).reduce((a,b)=>a+b,0);
  const ytdRev=ACTUAL.revenue.filter(v=>v!=null).reduce((a,b)=>a+b,0);
  const reported=ACTUAL.margin.filter(v=>v!=null).length;
  const ytdBudget=BUDGET.margin.slice(0,Math.max(reported,1)).reduce((a,b)=>a+b,0);
  const ytdPct=ytdBudget>0?(ytdActual/ytdBudget*100).toFixed(1):'—';
  const ytdMPct=ytdRev>0?(ytdActual/ytdRev*100).toFixed(2):'—';

  setTimeout(()=>{
    typingEl.classList.remove('typing');
    typingEl.innerHTML=chatFallback(q,{ytdActual,ytdBudget,ytdPct,ytdMPct});
    document.getElementById('chatMessages').scrollTop=9999;
  },400);
}

function chatFallback(q, d) {
  const ql = q.toLowerCase();
  const has = (...w) => w.some(x => ql.includes(x));

  // Determine if a specific month was mentioned
  let mIdx = -1;
  if(has('januari', 'jan')) mIdx = 0;
  else if(has('februari', 'feb')) mIdx = 1;
  else if(has('maret', 'mar')) mIdx = 2;
  else if(has('april', 'apr')) mIdx = 3;
  else if(has('mei', 'may')) mIdx = 4;
  else if(has('juni', 'jun')) mIdx = 5;
  else if(has('juli', 'jul')) mIdx = 6;
  else if(has('agustus', 'agu', 'aug')) mIdx = 7;
  else if(has('september', 'sep')) mIdx = 8;
  else if(has('oktober', 'okt', 'oct')) mIdx = 9;
  else if(has('november', 'nov')) mIdx = 10;
  else if(has('desember', 'des', 'dec')) mIdx = 11;

  // 1. Detect if inquiring about a specific project globally
  let foundProject = null;
  let foundProjectMonth = '';
  for (let i = 0; i < 12; i++) {
    const mk = MONTH_KEYS[i];
    const chains = PS_CHAINS[mk] || [];
    for (const ch of chains) {
        if (ql.includes(ch.name.toLowerCase()) || ql.includes(ch.ps.toLowerCase().split('-')[0])) {
            foundProject = ch;
            foundProjectMonth = MONTHS[i];
            break;
        }
    }
    if (foundProject) break;
  }

  if (foundProject) {
      return `<strong>${escapeHtml(foundProject.name)}</strong> — ${foundProjectMonth} ${(typeof FILTER_YEAR!=='undefined') ? FILTER_YEAR : new Date().getFullYear()}:<br>
      Revenue: <strong>IDR ${fmt(foundProject.revenue, 3)} M</strong><br>
      Margin: <strong>IDR ${fmt(foundProject.margin, 3)} M (${foundProject.pct}%)</strong><br>
      Customer: ${escapeHtml(foundProject.customer)}<br>
      PS: ${escapeHtml(foundProject.ps)}`;
  }

  // 2. Identify top/max margin searches
  if (has('tertinggi', 'terbesar', 'terbaik', 'paling tinggi') && has('margin')) {
     let maxP = null;
     let maxPMonth = '';
     for (let i = 0; i < 12; i++) {
        const chains = PS_CHAINS[MONTH_KEYS[i]] || [];
        for (const ch of chains) {
            if(!maxP || ch.margin > maxP.margin) { maxP = ch; maxPMonth = MONTHS[i]; }
        }
     }
     if (maxP) {
         return `Margin tertinggi saat ini: <strong>${escapeHtml(maxP.name)}</strong> (${maxPMonth}) — <strong>IDR ${fmt(maxP.margin, 3)} M</strong> (${maxP.pct}%).<br>Customer: ${escapeHtml(maxP.customer)}`;
     }
  }

  // 3. YTD/Total Questions
  if (has('ytd', 'total', 'keseluruhan') && (has('margin', 'revenue', 'volume', 'qty'))) {
      return `<strong>YTD ${(typeof FILTER_YEAR!=='undefined') ? FILTER_YEAR : new Date().getFullYear()}:</strong><br>
      Actual Margin: <strong>${fmt(d.ytdActual)} MIDR</strong><br>
      Budget Margin: <strong>${fmt(d.ytdBudget)} MIDR</strong><br>
      Achievement: <strong>${d.ytdPct}%</strong><br>
      Margin %: <strong>${d.ytdMPct}%</strong>`;
  }

  // 4. Gap
  if (has('gap', 'selisih', 'kurang')) {
      let gapText = `<strong>Gap Actual vs Budget:</strong><br>`;
      for(let i=0; i<12; i++) {
          if (ACTUAL.margin[i] != null) {
              const gap = ACTUAL.margin[i] - BUDGET.margin[i];
              gapText += `${MONTHS[i]}: <strong>${gap >= 0 ? '+' : ''}${fmt(gap)} MIDR</strong><br>`;
          }
      }
      const ytdGap = d.ytdActual - d.ytdBudget;
      gapText += `<strong>YTD Gap: ${ytdGap >= 0 ? '+' : ''}${fmt(ytdGap)} MIDR</strong>`;
      return gapText;
  }

  // 5. Month Specific Summaries
  if (mIdx !== -1) {
      const mk = MONTH_KEYS[mIdx];
      const m = ACTUAL.margin[mIdx];
      const b = BUDGET.margin[mIdx];
      const ach = m != null && b > 0 ? (m/b*100).toFixed(1) : '?';
      const chains = PS_CHAINS[mk] || [];
      let pList = chains.map(c => `• ${escapeHtml(c.name)}: ${fmt(c.margin)} M (${c.pct}%)`).join('<br>');
      if (!pList) pList = 'Belum ada data proyek / PS import.';

      return `<strong>${MONTHS[mIdx]} ${(typeof FILTER_YEAR!=='undefined') ? FILTER_YEAR : new Date().getFullYear()}:</strong><br>
      Margin: <strong>${m != null ? fmt(m) + ' MIDR' : 'Belum ada'}</strong><br>
      Budget: <strong>${fmt(b)} MIDR</strong><br>
      Achievement: <strong>${ach}%</strong><br>
      Proyek:<br>${pList}`;
  }

  // 6. Generic response for everything else
  return `Saya adalah AI Analyst berbasis data <em>live</em> dari database.<br>
  Saya bisa menjawab pertanyaan seperti:<br>
  • <em>"Berapa total margin YTD?"</em><br>
  • <em>"Project mana yang margin tertinggi?"</em><br>
  • <em>"Ringkasan Januari"</em> atau <em>"Gap vs budget"</em><br>
  Status saat ini: YTD Achievement <strong>${d.ytdPct}%</strong>.`;
}
