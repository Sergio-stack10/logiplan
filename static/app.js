'use strict';
const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const DAY_ICONS = ['🔵','🟠','🟢','🟣','🔴','🟡','⚫'];
let ROLE = null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function on(sel, evt, fn){ const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(evt, fn); }

function toast(text, type='ok'){
  try {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = text;
    box.appendChild(t);
    setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 350); }, 4500);
  } catch(e){ console.error(text); }
}

let pendingReqs = 0, loadingTimer = null, loadingWatchdog = null;
function showLoadingOverlay(label){
  let ov = document.getElementById('loading-overlay');
  if (!ov){
    ov = document.createElement('div');
    ov.id = 'loading-overlay';
    ov.innerHTML = '<div class="load-box"><div class="load-spinner"></div><div class="load-txt">Chargement…</div></div>';
    document.body.appendChild(ov);
  }
  ov.querySelector('.load-txt').textContent = label || 'Chargement des données…';
  ov.classList.add('active');
  clearTimeout(loadingWatchdog);
  loadingWatchdog = setTimeout(() => { pendingReqs = 0; hideLoadingOverlay(); }, 30000);
}
function hideLoadingOverlay(){
  clearTimeout(loadingWatchdog);
  const ov = document.getElementById('loading-overlay');
  if (ov) ov.classList.remove('active');
}
function trackReq(promise){
  pendingReqs++;
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => { if (pendingReqs > 0) showLoadingOverlay(); }, 300);
  return promise.finally(() => {
    pendingReqs = Math.max(0, pendingReqs - 1);
    if (pendingReqs === 0){ clearTimeout(loadingTimer); hideLoadingOverlay(); }
  });
}
async function api(url, opts={}){
  const p = (async () => {
    const r = await fetch(url, opts); let d = {};
    try { d = await r.json(); } catch(e){}
    if (r.status === 401){ window.location.href = '/'; throw new Error("Connexion requise"); }
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  })();
  return (opts && opts.silent) ? p : trackReq(p);
}
async function getResult(key){
  try {
    const d = await api('/api/result/' + key);
    if (!d) return null;
    if (typeof d === 'object' && 'found' in d) return d.found ? d.data : null;
    return d;
  } catch(e){ return null; }
}
function debounce(fn, ms=250){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }; }
function busy(btn, on_, label){
  if (!btn) return;
  if (on_){
    if (!btn.dataset.lbl) btn.dataset.lbl = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ ' + (label || '…');
  } else {
    btn.disabled = false;
    if (btn.dataset.lbl){ btn.innerHTML = btn.dataset.lbl; delete btn.dataset.lbl; }
  }
}
function numVal(id){ const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : 0; }
function intVal(id){ const el = document.getElementById(id); const v = el ? parseInt(el.value) : NaN; return Number.isFinite(v) ? v : 0; }

const MS = { comps: {} };
function initMultiSelect(id){
  const sel = document.getElementById(id);
  if (!sel || MS.comps[id]) return;
  const wrap = document.createElement('div');
  wrap.className = 'ms';
  wrap.innerHTML = `<button type="button" class="ms-btn">Tous ▾</button><div class="ms-panel"></div>`;
  sel.parentNode.insertBefore(wrap, sel);
  sel.style.display = 'none';
  MS.comps[id] = { sel, wrap, btn: wrap.querySelector('.ms-btn'), panel: wrap.querySelector('.ms-panel') };
  wrap.querySelector('.ms-btn').addEventListener('click', e => {
    e.stopPropagation();
    Object.entries(MS.comps).forEach(([k, c]) => { if (k !== id) c.wrap.classList.remove('open'); });
    wrap.classList.toggle('open');
  });
  wrap.querySelector('.ms-panel').addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => wrap.classList.remove('open'));
}
function msValues(id){
  const c = MS.comps[id];
  if (!c){
    const sel = document.getElementById(id);
    return (sel && sel.value) ? [sel.value] : [];
  }
  return Array.from(c.panel.querySelectorAll('input:checked')).map(cb => cb.value);
}
function msFill(id, values){
  const c = MS.comps[id];
  if (!c) return;
  const prev = msValues(id);
  const vals = values || [];
  c.panel.innerHTML =
    `<label class="ms-opt ms-all"><input type="checkbox" class="ms-toggle-all"> <b>Tout sélectionner / Tout désélectionner</b></label>` +
    `<div class="ms-sep"></div>` +
    (vals.map(v =>
      `<label class="ms-opt"><input type="checkbox" value="${esc(v)}"${prev.includes(v)?' checked':''}> ${esc(v)}</label>`).join('')
    || '<div class="ms-empty">—</div>');
  const all = c.panel.querySelector('.ms-toggle-all');
  if (all) all.checked = vals.length > 0 && prev.length === vals.length;
  if (all) all.addEventListener('change', () => {
    c.panel.querySelectorAll('.ms-opt:not(.ms-all) input').forEach(cb => cb.checked = all.checked);
    msUpdateBtn(id);
  });
  c.panel.querySelectorAll('.ms-opt:not(.ms-all) input').forEach(cb =>
    cb.addEventListener('change', () => {
      if (all){
        const boxes = c.panel.querySelectorAll('.ms-opt:not(.ms-all) input');
        all.checked = boxes.length > 0 && Array.from(boxes).every(b => b.checked);
      }
      msUpdateBtn(id);
    }));
  msUpdateBtn(id);
}
function msUpdateBtn(id){
  const c = MS.comps[id]; if (!c) return;
  const n = c.panel.querySelectorAll('input:checked').length;
  c.btn.innerHTML = n === 0 ? 'Tous ▾' : `✓ ${n} sélectionné${n > 1 ? 's' : ''} ▾`;
  c.btn.classList.toggle('has-sel', n > 0);
}
const MULTI_IDS = ['f1-transport','f1-projet','f1-statut','f2-projet','f2-statut',
                   'f3-transport','f3-projet','f3-statut','f4-projet','f4-statut'];
function fillSelect(sel, values){ msFill((typeof sel === 'string') ? sel : sel.id, values || []); }

function orderedRows(rows, order){
  if (!rows || !rows.length) return rows;
  const known = new Set(order);
  const extra = Object.keys(rows[0]).filter(c => !known.has(c));
  const cols = order.concat(extra);
  return rows.map(r => { const o = {}; cols.forEach(c => o[c] = r[c]); return o; });
}
function isTotalRow(r){ return Object.values(r).some(v =>
  ['TOTAL','Total','TOTAL SEMAINE','Total par Créneau','Total à commander','Total Théorique','TOTAL (sélection)'].includes(String(v ?? ''))); }
function fmtPct(v){ return (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(1).replace('.', ',') + ' %'; }
function tableHTML(rows, o={}){
  if (!rows || !rows.length) return '<div class="empty">Aucune donnée à afficher.</div>';
  const cols = Object.keys(rows[0]);
  let h = '<div class="tscroll"><table class="data"><thead><tr>' +
          cols.map(c => `<th>${esc(dayLabel(c))}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(r => {
    let cls = '';
    const c0 = String(r[cols[0]] ?? '');
    if (o.recap){ if (c0==='TOTAL') cls='total'; else if (c0==='SANS CHOIX') cls='sanschoix'; }
    else if (isTotalRow(r)) cls = 'total';
    h += `<tr class="${cls}">` + cols.map(c => {
      let v = r[c];
      if (c.includes('(%)') || c === 'Pourcentage') v = fmtPct(v);
      return `<td title="${esc(v)}">${esc(v)}</td>`;
    }).join('') + '</tr>';
  });
  return h + '</tbody></table></div>';
}
function searchRows(rows, text){
  if (!text) return rows;
  const s = text.toLowerCase();
  return (rows||[]).filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
}

let JOURS_DATE = {};
const dayLabel = j => JOURS_DATE[j] || j;
function computeJoursDate(week){
  JOURS_DATE = {};
  try {
    const m = String(week || '').toUpperCase().match(/S(\d{1,2})/);
    if (!m) return;
    const wk = parseInt(m[1], 10);
    if (wk < 1 || wk > 53) return;
    const now = new Date();
    for (const y of [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1]){
      const jan4 = new Date(Date.UTC(y, 0, 4));
      const dow = jan4.getUTCDay() || 7;
      const monday = new Date(jan4);
      monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (wk - 1) * 7);
      JOURS_DATE = Object.fromEntries(JOURS.map((j, i) => {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + i);
        return [j, ['lun.','mar.','mer.','jeu.','ven.','sam.','dim.'][i] + ' ' +
               String(d.getUTCDate()).padStart(2,'0') + '/' + String(d.getUTCMonth()+1).padStart(2,'0')];
      }));
      break;
    }
  } catch(e){}
}

const ADMIN_CONTROL_IDS = [
  'btn-import','inp-planning','inp-commande','inp-consommation','inp-reference','inp-week','inp-taux',
  'btn-del-week','btn-import-cons','btn-p2','btn-p3','btn-p4','btn-p5','btn-p6','btn-p7','btn-exp-p2','btn-matr'
];
function applyRoleUI(){
  const viewer = (ROLE === 'viewer');
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('viewer-hidden', viewer));
  ADMIN_CONTROL_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = viewer;
    el.classList.toggle('viewer-locked', viewer);
    el.title = viewer ? "Action réservée à l'administrateur" : '';
  });
  const b = $('#role-badge');
  if (b) b.innerHTML = viewer ? '👁️ Utilisateur' : '🛡️ Admin';
  ['#inp-pu'].forEach(sel => { const el = $(sel); if (el) el.disabled = viewer; });
}

on('#btn-logout', 'click', async () => {
  try { await api('/api/logout', {method:'POST', silent:true}); } catch(e){}
  window.location.href = '/logout';
});

function idbOpen(){ return new Promise((res, rej) => {
  const r = indexedDB.open('logiplan', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});}
async function idbSet(k, v){ const db = await idbOpen(); return new Promise((res, rej) => {
  const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
  tx.oncomplete = res; tx.onerror = () => rej(tx.error); });}
async function idbGet(k){ const db = await idbOpen(); return new Promise((res, rej) => {
  const tx = db.transaction('kv', 'readonly'); const rq = tx.objectStore('kv').get(k);
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });}

/* Backup local : ne JAMAIS écraser un backup existant par un état vide */
async function saveBackup(){
  if (ROLE !== 'admin') return;
  try {
    const snap = await api('/api/backup_export');
    const hasData = Object.values(snap.plannings || {}).some(x => x && x.rows && x.rows.length);
    if (!hasData) return;
    await idbSet('state', snap);
  } catch(e){}
}
async function restoreIfEmpty(){
  try {
    const s = await api('/api/state');
    if (s.weeks && s.weeks.length) return;
    const snap = await idbGet('state');
    if (!snap) return;
    const hasData = Object.values(snap.plannings || {}).some(x => x && x.rows && x.rows.length);
    if (!hasData) return;
    const r = await api('/api/backup_import', {method:'POST', headers:{'Content-Type':'application/json'},
                                               body: JSON.stringify(snap)});
    toast(`💾 Données restaurées depuis la sauvegarde locale (${(r.weeks||[]).join(', ')})`);
  } catch(e){}
}

on('#btn-side', 'click', () => document.body.classList.toggle('side-hidden'));
on('#inp-taux', 'input', e => { $('#taux-val').textContent = e.target.value + '%'; });

on('#btn-import', 'click', async () => {
  if (!$('#inp-planning').files.length) return toast('Importez au moins un fichier Planning.', 'err');
  const fd = new FormData();
  for (const f of $('#inp-planning').files) fd.append('planning', f);
  if ($('#inp-commande').files[0]) fd.append('commande', $('#inp-commande').files[0]);
  if ($('#inp-reference').files[0]) fd.append('reference', $('#inp-reference').files[0]);
  if ($('#inp-consommation') && $('#inp-consommation').files[0]) fd.append('consommation', $('#inp-consommation').files[0]);
  const w = $('#inp-week').value.trim(); if (w) fd.append('week', w);
  busy($('#btn-import'), true, 'Import…');
  try {
    const res = await api('/api/import', {method:'POST', body: fd});
    let t = `✅ Semaine <b>${esc(res.week)}</b> : ${res.n_planifiees} planifiés, ${res.n_commandes} commandes.`;
    if (res.warnings.length) t += '<br>⚠️ ' + res.warnings.map(esc).join('<br>⚠️ ');
    if ($('#imp-summary')) $('#imp-summary').innerHTML = `<div class="msg ok">${t}</div>`;
    toast('Import réussi — cliquez sur « 📥 Charger les données » pour afficher la semaine.', 'warn');
    p1Cache.week = undefined;
    await refreshState(); await saveBackup();
  } catch(e){
    if ($('#imp-summary')) $('#imp-summary').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`;
    toast(esc(e.message), 'err');
  }
  busy($('#btn-import'), false);
});

on('#btn-import-cons', 'click', async () => {
  if (!$('#inp-consommation') || !$('#inp-consommation').files.length) return toast('Choisissez le fichier Consommations.', 'err');
  const fd = new FormData();
  fd.append('consommation', $('#inp-consommation').files[0]);
  busy($('#btn-import-cons'), true, 'Import…');
  try {
    const res = await api('/api/import_consommation', {method:'POST', body: fd});
    const w = Object.entries(res.weeks || {}).map(([k, v]) => `${k} (${v} scans)`).join(', ') || '—';
    toast('✅ Consommations importées : ' + esc(w));
    await saveBackup();
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-import-cons'), false);
});

const HINT_LOAD = '<div class="hint">📥 Cliquez sur « Charger les données » dans le menu latéral pour afficher les résultats de cette semaine.</div>';
const HINT_EMPTY = '<div class="hint">Aucun résultat généré pour cette semaine.</div>';

function resetPanelsToHint(){
  const out2 = $('#out-p2'); if (out2) out2.innerHTML = '';
  const m2 = $('#p2-metrics'); if (m2) m2.innerHTML = '';
  ['out-p3','out-p4','out-p5','out-p6','out-p7','out-p8'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = HINT_LOAD;
  });
  p5Rows = null; p7Rows = null; lastRecapData = null; lastSynData = null; lastSynRenderRows = null;
  const sel7 = $('#f7-type'); if (sel7) sel7.innerHTML = '<option value="">Type de constat : tous</option>';
}

async function loadAllForWeek(showToast = true){
  const btn = document.getElementById('btn-load-week');
  busy(btn, true, 'Chargement…');
  try {
    p1Cache.week = undefined;
    await loadP1();
    const d = await api('/api/load_all');
    const R = d.results || {};
    renderP2(R.p2 || null);
    renderP3(R.p3 || null);
    renderP4(R.p4 || null);
    if (R.conf && R.conf.rows){ p5Rows = R.conf.rows; renderP5(); }
    else { p5Rows = null; $('#out-p5').innerHTML = HINT_LOAD; }
    if (R.recap && R.recap.day_order){ renderRecap(R.recap); }
    else { lastRecapData = null; $('#out-p6').innerHTML = HINT_LOAD; }
    if (R.constat && R.constat.rows){
      p7Rows = R.constat.rows;
      const sel7 = $('#f7-type'); if (sel7) sel7.innerHTML = '<option value="">Type de constat : tous</option>';
      renderP7();
    } else {
      p7Rows = null; $('#out-p7').innerHTML = HINT_LOAD;
    }
    if (R.synthese && R.synthese.rows){ renderSynthese(R.synthese); }
    else { lastSynData = null; lastSynRenderRows = null; $('#out-p8').innerHTML = HINT_LOAD; }
    if (showToast){
      const keys = ['p2','p3','p4','conf','recap','constat','synthese'];
      const n = keys.filter(k => R[k]).length;
      toast(`✅ Semaine <b>${esc(d.week || '')}</b> chargée — résultats disponibles sur ${n} onglet(s)`);
    }
  } catch(e){
    toast('Chargement : ' + esc(e.message), 'err');
  }
  busy(btn, false);
}

on('#sel-week', 'change', async e => {
  await api('/api/select_week', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({week: e.target.value})});
  await refreshState();
  resetPanelsToHint();
  toast(`Semaine « ${esc(e.target.value)} » sélectionnée — cliquez sur 📥 Charger les données.`, 'warn');
});
on('#btn-load-week', 'click', () => loadAllForWeek(true));

on('#btn-del-week', 'click', async () => {
  if (!confirm('Supprimer définitivement cette semaine et toutes ses données ?')) return;
  await api('/api/delete_week', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({week: $('#sel-week').value})});
  p1Cache.week = undefined;
  resetPanelsToHint();
  await refreshState(); await loadP1(); await saveBackup();
  toast('Semaine supprimée');
});

async function refreshState(){
  try {
    const s = await api('/api/state');
    $('#sel-week').innerHTML = s.weeks.map(w => `<option${w===s.current_week?' selected':''}>${esc(w)}</option>`).join('') || '<option value="">—</option>';
    $('#sel-week').disabled = !s.weeks.length;
    $('#week-badge').textContent = s.current_week ? 'Semaine ' + s.current_week : 'Aucune semaine';
    computeJoursDate(s.current_week);
    if (!s.weeks.length){
      toast("⚠️ Aucune semaine sur le serveur : l'administrateur doit importer les fichiers.", 'warn');
    }
  } catch(e){
    console.error('[LogiPlan] refreshState :', e.message);
    $('#sel-week').innerHTML = '<option value="">—</option>';
    $('#sel-week').disabled = true;
    $('#week-badge').textContent = 'Non connecté';
    toast('❌ ' + esc(e.message) + ' — reconnectez-vous.', 'err');
  }
}

 $$('.tab').forEach(b => b.addEventListener('click', async () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); $('#' + b.dataset.tab).classList.add('active');
  window.scrollTo({top:0});
  if (b.dataset.tab === 'p1') await loadP1();
  if (b.dataset.tab === 'p6'){ await loadPrefixes(); }
  if (b.dataset.tab === 'p9'){ loadDashboard().catch(()=>{}); }
}));

let p1Cache = {week: undefined, rows: [], options: {}, total: 0};
async function loadP1(){
  try {
    const s = await api('/api/state');
    const week = s.current_week;
    if (p1Cache.week !== week){
      const d = await api('/api/page1');
      p1Cache = {week, rows: d.rows, options: d.options || {}, total: d.total || 0};
      fillSelect('f1-transport', p1Cache.options.TRANSPORT || []);
      fillSelect('f1-projet', p1Cache.options.Projet || []);
      fillSelect('f1-statut', p1Cache.options.Statut || []);
      fillSelect('f2-projet', p1Cache.options.Projet || []);
      fillSelect('f2-statut', p1Cache.options.Statut || []);
      fillSelect('f3-transport', p1Cache.options.TRANSPORT || []);
      fillSelect('f3-projet', p1Cache.options.Projet || []);
      fillSelect('f3-statut', p1Cache.options.Statut || []);
      fillSelect('f4-projet', p1Cache.options.Projet || []);
      fillSelect('f4-statut', p1Cache.options.Statut || []);
    }
    applyP1();
  } catch(e){ $('#out-p1').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
function applyP1(){
  const tr = msValues('f1-transport'), pj = msValues('f1-projet'), st = msValues('f1-statut');
  const q = ($('#f1-search').value || '').trim().toLowerCase();
  let rows = p1Cache.rows;
  if (tr.length) rows = rows.filter(r => tr.includes(String(r['TRANSPORT'] ?? '')));
  if (pj.length) rows = rows.filter(r => pj.includes(String(r['Projet'] ?? '')));
  if (st.length) rows = rows.filter(r => st.includes(String(r['Statut'] ?? '')));
  if (q) rows = rows.filter(r => ['WORKDAY ID','Paid ID','Nom'].some(c => String(r[c] ?? '').toLowerCase().includes(q)));
  $('#cnt-p1').textContent = p1Cache.total ? `${rows.length} ligne(s) affichée(s) sur ${p1Cache.total}` : '';
  $('#out-p1').innerHTML = planTable(rows);
}
function planTable(rows){
  if (!rows || !rows.length) return '<div class="empty">Aucune ligne ne correspond aux filtres.</div>';
  const base = ['TRANSPORT','WORKDAY ID','Paid ID','Nom','Projet','Statut'];
  const lab = {DE:'Début', A:'Fin', Pause:'Pause', Flag:'✓'};
  let h = '<div class="tscroll"><table class="data plan"><thead>';
  h += '<tr class="grp-row"><th colspan="6">👤 Identité &amp; affectation</th>';
  JOURS.forEach(j => h += `<th colspan="4">${esc(dayLabel(j))}</th>`);
  h += '</tr><tr class="cols-row">';
  base.forEach(c => h += `<th>${c==='TRANSPORT'?'Transport':c}</th>`);
  JOURS.forEach(j => ['DE','A','Pause','Flag'].forEach(s => h += `<th>${lab[s]}</th>`));
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr>';
    base.forEach(c => h += `<td title="${esc(r[c])}">${esc(r[c])}</td>`);
    JOURS.forEach(j => {
      const de = String(r[j+'_DE'] ?? '');
      const on_ = de && de !== '00:00' ? ' class="on"' : '';
      h += `<td${on_}>${esc(de)||'—'}</td><td${on_}>${esc(r[j+'_A'])||'—'}</td><td${on_}>${esc(r[j+'_Pause'])||'—'}</td>`;
      h += `<td class="flag${Number(r[j+'_Flag'])?' on':''}">${Number(r[j+'_Flag'])?'✓':''}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}
['#f1-transport','#f1-projet','#f1-statut'].forEach(id => on(id, 'change', applyP1));
on('#f1-search', 'input', debounce(applyP1, 150));
on('#btn-exp-p1', 'click', () => {
  const p = new URLSearchParams();
  msValues('f1-transport').forEach(v => p.append('transport', v));
  msValues('f1-projet').forEach(v => p.append('projet', v));
  msValues('f1-statut').forEach(v => p.append('statut', v));
  p.set('q', $('#f1-search').value);
  window.open('/api/export_page1?' + p, '_blank');
});

if ($('#p2-presta'))
  $('#p2-presta').innerHTML = JOURS.map(j => `<label>${esc(dayLabel(j))}<input type="number" id="prest-${j}" min="0" value="0"></label>`).join('');
function applyPrestaValues(p2){
  if (!p2 || !p2.presta) return false;
  JOURS.forEach(j => {
    const el = document.getElementById('prest-' + j);
    if (el) el.value = Number(p2.presta[j] ?? 0);
  });
  return true;
}
function renderP2(d){
  if (d && d.rows){
    $('#out-p2').innerHTML = tableHTML(orderedRows(d.rows, ['Projet', ...JOURS]));
    $('#p2-metrics').innerHTML = JOURS.map((j, i) =>
      `<div class="metric"><div class="ico ${['i-blue','i-yellow','i-teal','i-red','i-navy','i-green','i-grey'][i]}">${DAY_ICONS[i]}</div>
       <div class="val">${(d.metrics || {})[j] ?? 0}</div><div class="lbl">${esc(dayLabel(j))}</div></div>`).join('');
    applyPrestaValues(d);
  } else {
    $('#out-p2').innerHTML = '';
    $('#p2-metrics').innerHTML = '';
  }
}
on('#btn-p2', 'click', async () => {
  busy($('#btn-p2'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({taux: $('#inp-taux').value});
    msValues('f2-projet').forEach(v => p.append('projet', v));
    msValues('f2-statut').forEach(v => p.append('statut', v));
    JOURS.forEach(j => p.set('prest_' + j, intVal('prest-' + j)));
    renderP2(await api('/api/page2?' + p));
    await saveBackup();
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p2'), false);
});
on('#btn-exp-p2', 'click', () => {
  const p = new URLSearchParams({taux: $('#inp-taux').value});
  msValues('f2-projet').forEach(v => p.append('projet', v));
  msValues('f2-statut').forEach(v => p.append('statut', v));
  JOURS.forEach(j => p.set('prest_' + j, intVal('prest-' + j)));
  window.open('/api/export_page2?' + p, '_blank');
});

function renderP3(d){
  if (d && d.pivot && d.pivot.rows){
    $('#out-p3').innerHTML = '<h3 class="sub">📊 Nombre de personnes par Heure de Début</h3>' +
      tableHTML(orderedRows(d.pivot.rows, ['Shift (Début)', ...JOURS, 'Total Semaine'])) +
      `<details class="mt"><summary>👁️ Liste détaillée</summary>` +
      tableHTML(orderedRows(d.detail.rows, ['Workday ID','Nom','Projet','Jour','Transport','Shift (Début)'])) + '</details>';
  } else {
    $('#out-p3').innerHTML = HINT_EMPTY;
  }
}
on('#btn-p3', 'click', async () => {
  busy($('#btn-p3'), true, 'Calcul…');
  try {
    const p = new URLSearchParams();
    msValues('f3-transport').forEach(v => p.append('transport', v));
    msValues('f3-projet').forEach(v => p.append('projet', v));
    msValues('f3-statut').forEach(v => p.append('statut', v));
    renderP3(await api('/api/page3?' + p));
    await saveBackup();
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p3'), false);
});
on('#btn-exp-p3', 'click', () => {
  const p = new URLSearchParams();
  msValues('f3-transport').forEach(v => p.append('transport', v));
  msValues('f3-projet').forEach(v => p.append('projet', v));
  msValues('f3-statut').forEach(v => p.append('statut', v));
  window.open('/api/export_page3?' + p, '_blank');
});

function renderP4(d){
  if (d && d.peaks && d.peaks.rows){
    $('#out-p4').innerHTML = '<h3 class="sub">📊 Pic de présence par projet</h3>' +
      tableHTML(orderedRows(d.peaks.rows, ['Projet', ...JOURS])) +
      `<details class="mt"><summary>🕒 Détail par créneau</summary>` +
      tableHTML(orderedRows(d.slots.rows, ['Créneau', ...JOURS, 'Total Jour'])) + '</details>';
  } else {
    $('#out-p4').innerHTML = HINT_EMPTY;
  }
}
on('#btn-p4', 'click', async () => {
  busy($('#btn-p4'), true, 'Calcul…');
  try {
    const p = new URLSearchParams();
    msValues('f4-projet').forEach(v => p.append('projet', v));
    msValues('f4-statut').forEach(v => p.append('statut', v));
    renderP4(await api('/api/page4?' + p));
    await saveBackup();
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p4'), false);
});
on('#btn-exp-p4', 'click', () => {
  const p = new URLSearchParams();
  msValues('f4-projet').forEach(v => p.append('projet', v));
  msValues('f4-statut').forEach(v => p.append('statut', v));
  window.open('/api/export_page4?' + p, '_blank');
});

let p5Rows = null;
function confTable(rows){
  if (!rows || !rows.length) return '<div class="empty">Aucune donnée.</div>';
  const base = ['Workday ID','Paid ID','Nom','Projet','Statut'];
  let h = '<div class="tscroll"><table class="data conf"><thead>';
  h += '<tr class="grp-row"><th colspan="5">👤 Identité</th>';
  JOURS.forEach(j => h += `<th colspan="3">${esc(dayLabel(j))}</th>`);
  h += '</tr><tr class="cols-row">';
  base.forEach(c => h += `<th>${esc(c)}</th>`);
  JOURS.forEach(() => h += '<th>Planning</th><th>Commande</th><th>Consommé</th>');
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr>' + base.map(c => `<td title="${esc(r[c])}">${esc(r[c])}</td>`).join('');
    JOURS.forEach(j => {
      const pl = String(r[j + ' - Planning'] ?? '');
      const cm = String(r[j + ' - Commande'] ?? '');
      const cs = String(r[j + ' - Consommé'] ?? '');
      const plCell = pl === 'Planifié' ? '<span class="badge b-ok">Planifié</span>'
        : pl === 'hors planning' ? '<span class="badge b-warn">hors planning</span>'
        : pl ? `<span class="badge b-info">${esc(pl)}</span>` : '';
      const cmCell = cm ? (/JE NE SERAI PAS/i.test(cm) ? '<span class="badge b-abs">Je ne serai pas présent</span>' : `<span title="${esc(cm)}">${esc(cm)}</span>`) : '';
      const csCell = cs !== '' ? `<span class="badge b-ok" title="Repas pointés ce jour (fichier consommations)">${esc(cs)}</span>` : '';
      h += `<td>${plCell}</td><td>${cmCell}</td><td>${csCell}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}
function renderP5(){ if (p5Rows) $('#out-p5').innerHTML = confTable(searchRows(p5Rows, $('#f5-search').value)); }
on('#btn-p5', 'click', async () => {
  busy($('#btn-p5'), true, 'Génération…');
  try {
    p5Rows = (await api('/api/page5', {method:'POST'})).rows;
    renderP5(); await saveBackup();
    toast('Confrontation générée : ' + p5Rows.length + ' lignes');
  } catch(e){ toast(esc(e.message), 'err'); $('#out-p5').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-p5'), false);
});
on('#f5-search', 'input', debounce(renderP5, 250));
on('#btn-exp-p5', 'click', async () => { try { await downloadPost('/api/export_conf', 'confrontation.xlsx', {}); } catch(e){ toast(esc(e.message),'err'); } });

const tauxByDay = Object.fromEntries(JOURS.map(j => [j, parseFloat($('#inp-taux') ? $('#inp-taux').value : 0) || 0]));
on('#inp-taux', 'input', e => {
  JOURS.forEach(j => tauxByDay[j] = parseFloat(e.target.value) || 0);
  $$('#out-p6 [data-dtaux]').forEach(inp => inp.value = tauxByDay[inp.dataset.dtaux]);
});
async function loadPrefixes(){
  try {
    const d = await api('/api/prefixes');
    if (!d.prefixes.length){
      $('#out-mapping').innerHTML = '<div class="empty">Importez Planning et/ou Commandes.</div>';
      return;
    }
    let h = '<div class="map-grid">';
    d.prefixes.forEach(p => {
      h += `<div class="map-item"><span class="mono">« ${esc(p.prefix)} »</span>
        <span class="badge ${p.entity === 'HORS PROD' ? 'b-info' : 'b-ok'}">${esc(p.entity)}</span></div>`;
    });
    $('#out-mapping').innerHTML = h + '</div>';
  } catch(e){ $('#out-mapping').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
on('#map-search', 'input', debounce(() => {
  const s = $('#map-search').value.toLowerCase();
  $$('#out-mapping .map-item').forEach(it => it.style.display = it.textContent.toLowerCase().includes(s) ? '' : 'none');
}, 200));
function recapBody(){ return { taux: Object.fromEntries(JOURS.map(j => [j, tauxByDay[j]])) }; }
const RECAP_COLS = ['Choix','Nombres','Pourcentage','À commander'];
const SUMMARY_COLS = ['Jour', 'HORS PROD', 'PROD / PLANIFIÉ', 'Planifié total', 'À commander'];
let lastRecapData = null;

function normalizeRecapLabels(d){
  if (!d) return d;
  const fix = o => { if (o && ('PROD / PLANIFIÉ PROD' in o)){ o['PROD / PLANIFIÉ'] = o['PROD / PLANIFIÉ PROD']; delete o['PROD / PLANIFIÉ PROD']; } return o; };
  (d.summary_rows || []).forEach(fix);
  Object.values(d.days || {}).forEach(day => (day.entities || []).forEach(e => {
    if (e.entity === 'PROD / PLANIFIÉ PROD') e.entity = 'PROD / PLANIFIÉ';
  }));
  return d;
}
function computeDateIso(week, day){
  try {
    const m = String(week || '').toUpperCase().match(/S(\d{1,2})/);
    if (!m) return '';
    const wk = parseInt(m[1], 10);
    if (wk < 1 || wk > 53) return '';
    const now = new Date();
    for (const y of [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1]){
      const jan4 = new Date(Date.UTC(y, 0, 4));
      const dow = jan4.getUTCDay() || 7;
      const monday = new Date(jan4);
      monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (wk - 1) * 7);
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + JOURS.indexOf(day));
      return d.toISOString().slice(0, 10);
    }
  } catch(e){}
  return '';
}
function entityTableHTML(E, dayIso){
  const rows = orderedRows(E.rows, RECAP_COLS);
  if (!rows || !rows.length) return '<div class="empty">Aucune donnée à afficher.</div>';
  const cols = Object.keys(rows[0]);
  const editable = (ROLE === 'admin' && E.entity === 'HORS PROD' && dayIso);
  let h = '<div class="tscroll"><table class="data"><thead><tr>' +
          cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(r => {
    const c0 = String(r['Choix'] ?? '');
    let cls = '';
    if (c0 === 'TOTAL') cls = 'total'; else if (c0 === 'SANS CHOIX') cls = 'sanschoix';
    h += `<tr class="${cls}">` + cols.map(c => {
      let v = r[c];
      if (c === 'Pourcentage') v = fmtPct(v);
      if (c === 'Nombres' && editable && c0 !== 'TOTAL' && c0 !== 'SANS CHOIX'){
        return `<td class="editcell"><input type="number" min="0" step="1" data-date="${esc(dayIso)}" data-menu="${esc(c0)}" value="${Number(r[c] ?? 0)}"></td>`;
      }
      return `<td title="${esc(v)}">${esc(v)}</td>`;
    }).join('') + '</tr>';
  });
  return h + '</tbody></table></div>';
}
function renderRecap(d){
  d = normalizeRecapLabels(d);
  lastRecapData = d;
  let h = (d.warnings || []).map(w => `<div class="msg warn">⚠️ ${esc(w)}</div>`).join('');
  h += '<h3 class="sub">📈 Synthèse de la semaine (repas à préparer)</h3>' +
       tableHTML(orderedRows(d.summary_rows, SUMMARY_COLS), {recap:true});
  for (const day of d.day_order){
    const D = d.days[day];
    D.dateIso = D.dateIso || computeDateIso(d.week, day);
    const taCtrl = ROLE === 'admin' ?
      `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7c8a;font-weight:600;white-space:nowrap">
        Absence prévue (%) — PROD
        <input type="number" data-dtaux="${esc(day)}" min="0" max="50" step="0.5" value="${tauxByDay[day]}"
          style="width:74px;padding:6px;border:1px solid #dde5ec;border-radius:8px;text-align:center">
      </div>` : '';
    h += `<div class="day-card">
      <div class="day-header"><span>📅 ${esc(day)}${D.date ? ' · ' + esc(D.date) : ''}</span>
      <span class="dh-right">Semaine ${esc(d.week)}</span></div>
      <div class="day-sub" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;justify-content:space-between">
        <div><span class="big">À commander : <b>${D.a_commander}</b> repas</span><br>
        À préparer → ${D.entities.map(e => `<b style="color:${e.color}">${esc(e.entity)} : ${e.rows.find(r => r.Choix==='TOTAL')?.['À commander'] ?? 0}</b>`).join(' &nbsp;•&nbsp; ')}</div>
        ${taCtrl}
      </div>`;
    for (const E of D.entities){
      h += `<div class="entity-row"><div class="entity-badge" style="background:${E.color}">${esc(E.entity)}</div>
        <div class="entity-body"><div class="entity-meta">Planifiés : <b>${E.planned_n}</b> ·
        SANS CHOIX : <b>${E.sans_choix}</b> · Absences déclarées : <b>${E.abs_prevues}</b></div>
        ${entityTableHTML(E, D.dateIso)}</div></div>`;
    }
    h += '</div>';
  }
  if (!d.has_planning) h += '<div class="msg warn">ℹ️ Planning non chargé.</div>';
  $('#out-p6').innerHTML = h;
  $$('#out-p6 [data-dtaux]').forEach(inp => inp.addEventListener('change', () => {
    tauxByDay[inp.dataset.dtaux] = parseFloat(inp.value) || 0;
    calcP6();
  }));
  $$('#out-p6 .editcell input[data-menu]').forEach(inp => inp.addEventListener('change', debounce(async () => {
    if (!inp.dataset.date || !inp.dataset.menu) return;
    try {
      await api('/api/menu_edit', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({date: inp.dataset.date, menu: inp.dataset.menu, nombres: parseInt(inp.value) || 0})});
      await calcP6();
      toast('Effectif « ' + esc(inp.dataset.menu) + ' » enregistré pour cette date');
    } catch(e){ toast(esc(e.message), 'err'); }
  }, 500)));
}
async function calcP6(){
  if (ROLE === 'viewer'){ toast("Action réservée à l'administrateur", 'warn'); return; }
  busy($('#btn-p6'), true, 'Calcul…');
  try {
    renderRecap(await api('/api/recap', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(recapBody())}));
    await saveBackup();
  } catch(e){ $('#out-p6').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; toast(esc(e.message), 'err'); }
  busy($('#btn-p6'), false);
}
on('#btn-p6', 'click', calcP6);
async function downloadPost(url, filename, body){
  const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  if (r.status === 401){ window.location.href = '/'; throw new Error("Connexion requise"); }
  if (!r.ok){ const d = await r.json().catch(()=>({})); throw new Error(d.error || 'Export impossible'); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob()); a.download = filename; a.click();
}
on('#btn-exp-p6', 'click', async () => {
  try { await downloadPost('/api/export_recap', 'recap_commandes_menus.xlsx', recapBody()); }
  catch(e){ toast(esc(e.message), 'err'); }
});
function pdfSimpleTable(rows, cols){
  if (!rows || !rows.length) return '';
  let h = '<table><thead><tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(r => {
    const c0 = String(r[cols[0]] ?? '');
    let cls = '';
    if (c0 === 'TOTAL') cls = 'total'; else if (c0 === 'SANS CHOIX') cls = 'sanschoix';
    h += `<tr class="${cls}">` + cols.map(c => {
      let v = r[c];
      if (c.includes('(%)') || c === 'Pourcentage') v = fmtPct(v);
      const style = (c === 'QS (%)') ? ` style="color:${qsClass(Number(r[c] ?? 0)) === 'qs-red' ? '#c0392b' : qsClass(Number(r[c] ?? 0)) === 'qs-orange' ? '#e67e22' : '#27ae60'};font-weight:bold"` : '';
      return `<td${style}>${esc(v)}</td>`;
    }).join('') + '</tr>';
  });
  return h + '</tbody></table>';
}
function printIframe(html){
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch(e){ toast('Impression indisponible : ' + e.message, 'err'); }
    setTimeout(() => iframe.remove(), 60000);
  };
  iframe.srcdoc = html;
}
on('#btn-pdf-p6', 'click', () => {
  if (!lastRecapData){ toast("Aucun récapitulatif généré pour cette semaine.", 'warn'); return; }
  const d = lastRecapData;
  let h = `<h1>LogiPlan — Commandes par menu · Semaine ${esc(d.week || '')}</h1>
           <p class="gen">Édité le ${new Date().toLocaleDateString('fr-FR')}</p>`;
  (d.warnings || []).forEach(w => h += `<div class="msg">⚠️ ${esc(w)}</div>`);
  h += '<h3>Synthèse de la semaine</h3>' + pdfSimpleTable(d.summary_rows, SUMMARY_COLS);
  for (const day of d.day_order){
    const D = d.days[day];
    h += `<div class="day-card"><div class="day-header">
      <span>📅 ${esc(day)}${D.date ? ' · ' + esc(D.date) : ''}</span>
      <span>À commander : ${D.a_commander} repas</span></div>`;
    for (const E of D.entities){
      h += `<div class="entity-block">
        <div class="entity-title" style="background:${E.color}">${esc(E.entity)}
          &nbsp;—&nbsp; Planifiés : ${E.planned_n} · SANS CHOIX : ${E.sans_choix} · Absences déclarées : ${E.abs_prevues}</div>
        ${pdfSimpleTable(E.rows, RECAP_COLS)}</div>`;
    }
    h += '</div>';
  }
  printIframe(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>LogiPlan</title><style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#22333f;padding:18px;font-size:12px}
h1{color:#003D5B;font-size:18px;border-bottom:3px solid #25E2CC;padding-bottom:6px;margin:0 0 4px}
h3{color:#003D5B;font-size:14px;margin:14px 0 4px}
.gen{color:#789;font-size:10px;margin:0 0 10px}
table{border-collapse:collapse;width:100%;margin:4px 0 10px}
th{background:#003D5B;color:#fff;padding:4px 8px;text-align:left;font-size:11px}
td{border:1px solid #dde5ec;padding:3px 8px}
tbody tr:nth-child(odd) td{background:#f8fbfd}
tr.total td{font-weight:800;background:rgba(0,61,91,.12)!important;border-top:2px solid #003D5B}
tr.sanschoix td{font-weight:700}
.day-card{border:2px solid #003D5B;border-radius:10px;margin:12px 0;overflow:hidden;page-break-inside:avoid}
.day-header{background:#003D5B;color:#fff;padding:7px 14px;font-weight:700;display:flex;justify-content:space-between;font-size:13px}
.entity-block{page-break-inside:avoid}
.entity-title{color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;margin-top:6px}
.msg{background:#fff3cd;color:#775500;padding:6px 10px;border-radius:6px;font-size:11px;margin:6px 0}
@page{margin:12mm}</style></head><body>${h}</body></html>`);
});

let p7Rows = null;
function renderP7(){
  if (p7Rows === null) return;
  const sel = $('#f7-type');
  if (sel && sel.options.length <= 1){
    const types = [...new Set(p7Rows.map(r => String(r['Type de constat'] ?? '')).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Type de constat : tous</option>' +
      types.map(t => `<option>${esc(t)}</option>`).join('');
  }
  const tsel = sel ? sel.value : '';
  let rows = searchRows(p7Rows, $('#f7-search').value);
  if (tsel) rows = rows.filter(r => String(r['Type de constat'] ?? '') === tsel);
  rows = orderedRows(rows, ['Paid ID','Nom','Projet','Jour','Type de constat','Commande']);
  $('#out-p7').innerHTML = rows.length ? tableHTML(rows) : '<div class="msg ok">✅ Aucun constat.</div>';
}
on('#f7-type', 'change', renderP7);
on('#btn-p7', 'click', async () => {
  if (ROLE === 'viewer'){ toast("Action réservée à l'administrateur", 'warn'); return; }
  busy($('#btn-p7'), true, 'Extraction…');
  try {
    p7Rows = (await api('/api/page7', {method:'POST'})).rows;
    const sel = $('#f7-type'); if (sel) sel.innerHTML = '<option value="">Type de constat : tous</option>';
    renderP7(); await saveBackup();
    toast(p7Rows.length ? p7Rows.length + ' constat(s) détecté(s)' : 'Aucun constat 🎉', p7Rows.length ? 'warn' : 'ok');
  } catch(e){ toast(esc(e.message), 'err'); $('#out-p7').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-p7'), false);
});
on('#f7-search', 'input', debounce(renderP7, 250));
on('#btn-exp-p7', 'click', async () => { try { await downloadPost('/api/export_anom', 'constats_commande.xlsx', {}); } catch(e){ toast(esc(e.message),'err'); } });
on('#btn-matr', 'click', async () => {
  busy($('#btn-matr'), true, 'Vérification…');
  try {
    const d = await api('/api/matricules');
    let h = '';
    h += d.mismatch.rows.length
      ? `<div class="msg warn">⚠️ ${d.mismatch.rows.length} matricule(s) différent(s).</div>` + tableHTML(d.mismatch.rows)
      : '<div class="msg ok">✅ Tous les matricules correspondent.</div>';
    h += d.notfound.rows.length
      ? `<details class="mt"><summary>ℹ️ ${d.notfound.rows.length} introuvable(s) dans la Liste Actif</summary>${tableHTML(d.notfound.rows)}</details>`
      : '';
    $('#out-matr').innerHTML = h;
  } catch(e){ $('#out-matr').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-matr'), false);
});

const SYN_COLS = ['Date','Semaine','Planifié total','À commander','Commande finale','Consommé',
                  'Non consommé','À facturer','QS (%)','QS conso vs commandé final (%)',
                  'MONTANT DA MGA HT','Nombre de plat ajusté','Pourcentage plat ajusté (%)'];
const SYN_EDITABLE = {'Commande finale':'commande_finale', 'Consommé':'consomme'};
const SYN_WKEY = 'logiplan_syn_widths';
let synEdits = {};
let lastSynData = null;
let lastSynRenderRows = null;
let synColFilters = {};

function synthBody(){
  return { month: ($('#inp-month') ? $('#inp-month').value : ''),
           pu: numVal('inp-pu'), edits: ROLE === 'admin' ? synEdits : {} };
}
function synthAllRows(d){
  return (d.rows || []).filter(r => !String(r['Date'] ?? '').toUpperCase().startsWith('TOTAL'));
}
function cellVal(r, c){
  const v = r[c];
  if (v === null || v === undefined || String(v).trim() === '') return '(vide)';
  return String(v);
}
function synthTotalLocal(rows, label){
  const t = {'Date': label, 'Semaine': '', 'DateIso': ''};
  const sum = k => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  ['Planifié total','À commander','Commande finale','Consommé','Non consommé','À facturer',
   'MONTANT DA MGA HT','Nombre de plat ajusté'].forEach(k => t[k] = sum(k));
  const done = rows.filter(r => Number(r['Consommé'] ?? 0) > 0);
  const qn = done.reduce((s, r) => s + Number(r['Consommé'] ?? 0), 0);
  const qd = done.reduce((s, r) => s + Number(r['Commande finale'] ?? 0), 0);
  t['QS (%)'] = qd > 0 ? Math.round(qn / qd * 1000) / 10 : 0;
  t['QS conso vs commandé final (%)'] = (t['Commande finale'] > t['Consommé']) ? 100 :
    ((t['Commande finale'] > 0) ? Math.round(t['Consommé'] / t['Commande finale'] * 1000) / 10 : 0);
  t['Pourcentage plat ajusté (%)'] = (t['À commander'] > 0) ?
    Math.round(t['Nombre de plat ajusté'] / t['À commander'] * 1000) / 10 : 0;
  return t;
}
function synFiltersActive(){ return Object.keys(synColFilters).length > 0; }
function synRowPasses(r){
  for (const [col, keep] of Object.entries(synColFilters)){
    if (!keep.has(cellVal(r, col))) return false;
  }
  return true;
}
function closeSynPopover(){ const p = document.getElementById('syn-popover'); if (p) p.remove(); }
function openSynPopover(col, anchorTh){
  closeSynPopover();
  const rows = synthAllRows(lastSynData);
  const uniq = [...new Set(rows.map(r => cellVal(r, col)))].sort((a, b) => a.localeCompare(b, 'fr', {numeric: true}));
  const keep = synColFilters[col] || new Set(uniq);
  const pop = document.createElement('div');
  pop.id = 'syn-popover';
  pop.innerHTML = `
    <div class="sp-head"><b>${esc(col)}</b><button type="button" class="sp-close" title="Fermer">✕</button></div>
    <input type="text" class="sp-search" placeholder="🔍 Rechercher une valeur…">
    <div class="sp-actions">
      <button type="button" class="sp-link" data-act="all">Tout cocher</button>
      <button type="button" class="sp-link" data-act="none">Tout décocher</button>
      <button type="button" class="sp-link" data-act="clear">Effacer le filtre</button>
    </div>
    <div class="sp-list">
      ${uniq.map(v => `<label class="sp-opt"><input type="checkbox" value="${esc(v)}"${keep.has(v) ? ' checked' : ''}> ${esc(v)}</label>`).join('') || '<div class="ms-empty">—</div>'}
    </div>
    <div class="sp-foot"><button type="button" class="btn accent sp-ok">Appliquer</button></div>`;
  document.body.appendChild(pop);
  const r = anchorTh.getBoundingClientRect();
  const pw = Math.max(240, Math.min(r.width + 40, 320));
  pop.style.width = pw + 'px';
  let left = Math.min(r.left, window.innerWidth - pw - 8);
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  const search = pop.querySelector('.sp-search');
  search.addEventListener('input', () => {
    const s = search.value.trim().toLowerCase();
    pop.querySelectorAll('.sp-opt').forEach(l => {
      l.style.display = l.textContent.toLowerCase().includes(s) ? '' : 'none';
    });
  });
  const checkedMap = () => new Set(Array.from(pop.querySelectorAll('.sp-list input:checked')).map(cb => cb.value));
  pop.querySelector('.sp-close').addEventListener('click', closeSynPopover);
  pop.querySelectorAll('.sp-link').forEach(btn => btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'all') pop.querySelectorAll('.sp-list input').forEach(cb => cb.checked = true);
    if (act === 'none') pop.querySelectorAll('.sp-list input').forEach(cb => cb.checked = false);
    if (act === 'clear'){
      delete synColFilters[col];
      closeSynPopover(); renderSynthese(lastSynData);
    }
  }));
  pop.querySelector('.sp-ok').addEventListener('click', () => {
    const set = checkedMap();
    if (set.size >= uniq.length) delete synColFilters[col];
    else synColFilters[col] = set;
    closeSynPopover(); renderSynthese(lastSynData);
  });
  setTimeout(() => {
    const close = e => { if (!pop.contains(e.target)){ closeSynPopover(); document.removeEventListener('mousedown', close); } };
    document.addEventListener('mousedown', close);
  }, 0);
  search.focus();
}
function applySynWidths(table){
  try {
    const w = JSON.parse(localStorage.getItem(SYN_WKEY) || '{}');
    if (!Object.keys(w).length) return false;
    table.style.tableLayout = 'fixed';
    table.querySelectorAll('thead th[data-col]').forEach(th => {
      if (w[th.dataset.col]) th.style.width = w[th.dataset.col] + 'px';
    });
    return true;
  } catch(e){ return false; }
}
function saveSynWidths(table){
  try {
    const w = {};
    table.querySelectorAll('thead th[data-col]').forEach(th => {
      const px = th.getBoundingClientRect().width;
      if (px) w[th.dataset.col] = Math.round(px);
    });
    localStorage.setItem(SYN_WKEY, JSON.stringify(w));
  } catch(e){}
}
function enableSynResize(table){
  if (!table || table.dataset.resizable) return;
  table.dataset.resizable = '1';
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    const handle = document.createElement('span');
    handle.className = 'col-resizer';
    handle.title = 'Glisser pour redimensionner';
    handle.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const startW = th.getBoundingClientRect().width;
      const startX = ev.clientX;
      if (getComputedStyle(table).tableLayout !== 'fixed'){
        const heads = Array.from(table.querySelectorAll('thead th[data-col]'));
        heads.forEach(t => { t.style.width = t.getBoundingClientRect().width + 'px'; });
        table.style.tableLayout = 'fixed';
        table.style.width = Math.ceil(heads.reduce((s, t) => s + t.getBoundingClientRect().width, 0)) + 'px';
      }
      const move = e => { th.style.width = Math.max(48, startW + e.clientX - startX) + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        saveSynWidths(table);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
    });
    th.appendChild(handle);
  });
}
function qsClass(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n < 98) return 'qs-red';
  if (n < 99) return 'qs-orange';
  if (n <= 101) return 'qs-green';
  if (n <= 102) return 'qs-orange';
  return 'qs-red';
}
function renderSynthese(d){
  lastSynData = d;
  if ($('#inp-month') && !$('#inp-month').value) $('#inp-month').value = d.month || '';
  if ($('#inp-pu') && document.activeElement !== $('#inp-pu')) $('#inp-pu').value = d.pu ?? 0;
  const all = synthAllRows(d);
  Object.keys(synColFilters).forEach(col => {
    const uniq = new Set(all.map(r => cellVal(r, col)));
    const f = synColFilters[col];
    if (![...f].some(v => uniq.has(v))) delete synColFilters[col];
  });
  const filtered = synFiltersActive();
  let rows = filtered ? all.filter(synRowPasses) : all;
  const totalRow = filtered ? synthTotalLocal(rows, 'TOTAL (sélection)')
                            : (d.rows || []).find(r => String(r['Date'] ?? '').toUpperCase().startsWith('TOTAL'));
  const body = [];
  let curWeek = null, curRows = [];
  const flushSub = () => {
    if (curWeek && curRows.length) body.push(synthTotalLocal(curRows, 'Sous-total ' + curWeek));
    curWeek = null; curRows = [];
  };
  rows.forEach(r => {
    const w = String(r['Semaine'] ?? '');
    if (curWeek !== null && w !== curWeek) flushSub();
    curWeek = w;
    curRows.push(r);
    body.push(r);
  });
  flushSub();
  if (totalRow) body.push(totalRow);

  let h = `<div class="count">${filtered ? rows.length + ' ligne(s) filtrée(s) sur ' + all.length + ' · ' : ''}${all.length} ligne(s)</div>`;
  h += '<div class="tscroll"><table class="data syn" id="syn-table"><thead><tr>';
  h += SYN_COLS.map(c => {
    const active = !!synColFilters[c];
    return `<th data-col="${esc(c)}"><span class="th-label">${esc(c)}</span>` +
           `<button type="button" class="th-filter${active ? ' active' : ''}" data-col="${esc(c)}" title="Filtrer la colonne">▽</button></th>`;
  }).join('');
  h += '</tr></thead><tbody>';
  body.forEach(r => {
    const lab = String(r['Date'] ?? '');
    const isSub = lab.startsWith('Sous-total');
    const isTot = lab.toUpperCase().startsWith('TOTAL');
    const cls = isSub ? 'subtotal' : (isTot ? 'total' : '');
    h += `<tr class="${cls}">`;
    SYN_COLS.forEach(c => {
      if (ROLE === 'admin' && !isSub && !isTot && SYN_EDITABLE[c]){
        const di = String(r['DateIso'] ?? '');
        const edited = (synEdits[di] || {})[SYN_EDITABLE[c]];
        const cur = (edited === undefined || edited === null) ? (r[c] ?? '') : edited;
        h += `<td class="editcell"><input type="number" min="0" step="1" data-date="${esc(di)}" data-field="${esc(SYN_EDITABLE[c])}" value="${esc(cur)}"></td>`;
      } else {
        let v = r[c];
        if (c.includes('(%)')) v = fmtPct(v);
        const qc = (c === 'QS (%)' || c === 'QS conso vs commandé final (%)') ? ` class="${qsClass(Number(r[c] ?? 0))}"` : '';
        h += `<td${qc} title="${esc(v)}">${esc(v)}</td>`;
      }
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  $('#out-p8').innerHTML = h;
  lastSynRenderRows = body;
  const table = $('#syn-table');
  if (table){
    applySynWidths(table);
    enableSynResize(table);
    table.querySelectorAll('.th-filter').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); openSynPopover(btn.dataset.col, btn.closest('th')); }));
    table.querySelectorAll('.editcell input').forEach(inp =>
      inp.addEventListener('change', () => {
        const di = inp.dataset.date, f = inp.dataset.field;
        if (!di || !f) return;
        (synEdits[di] = synEdits[di] || {})[f] = parseFloat(inp.value) || 0;
        const b8 = $('#btn-p8'); if (b8) b8.classList.add('pending');
      }));
  }
}
async function calcP8(){
  if (ROLE === 'viewer'){ toast("Action réservée à l'administrateur", 'warn'); return; }
  const b = $('#btn-p8');
  busy(b, true, 'Génération…');
  if (b) b.classList.remove('pending');
  try {
    renderSynthese(await api('/api/synthese', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(synthBody())}));
    await saveBackup();
  } catch(e){ toast(esc(e.message), 'err'); }
  busy(b, false);
}
on('#btn-p8', 'click', calcP8);
on('#inp-month', 'change', () => { if (lastSynData) calcP8(); });
on('#inp-pu', 'change', async () => {
  if (ROLE !== 'admin') return;
  try {
    await api('/api/pu', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({pu: numVal('inp-pu')})});
    if (lastSynData) await calcP8();
  } catch(e){ toast(esc(e.message), 'err'); }
});
on('#btn-exp-p8', 'click', async () => {
  try { await downloadPost('/api/export_synthese', 'synthese_mensuelle.xlsx', synthBody()); }
  catch(e){ toast(esc(e.message), 'err'); }
});
on('#btn-pdf-p8', 'click', () => {
  if (!lastSynRenderRows || !lastSynRenderRows.length){ toast("Aucune synthèse générée pour ce mois.", 'warn'); return; }
  const d = lastSynData || {};
  let h = `<h1>LogiPlan — Synthèse mensuelle${d.month ? ' · ' + esc(d.month) : ''}</h1>
           <p class="gen">Édité le ${new Date().toLocaleDateString('fr-FR')}</p>`;
  h += pdfSimpleTable(lastSynRenderRows, SYN_COLS);
  printIframe(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>LogiPlan</title><style>
body{font-family:'Segoe UI',Arial,sans-serif;color:#22333f;padding:18px;font-size:12px}
h1{color:#003D5B;font-size:18px;border-bottom:3px solid #25E2CC;padding-bottom:6px;margin:0 0 4px}
.gen{color:#789;font-size:10px;margin:0 0 10px}
table{border-collapse:collapse;width:100%;margin:4px 0 10px}
th{background:#003D5B;color:#fff;padding:4px 6px;text-align:left;font-size:10px}
td{border:1px solid #dde5ec;padding:3px 6px}
tbody tr:nth-child(odd) td{background:#f8fbfd}
tr.total td{font-weight:800;background:rgba(0,61,91,.12)!important;border-top:2px solid #003D5B}
tr.subtotal td{font-weight:700;background:#fdf3d7!important}
@page{margin:12mm}</style></head><body>${h}</body></html>`);
});

const DB = { charts: {}, last: null };
const fmtInt = v => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0}).format(Number(v) || 0);
function fmtCompact(v){
  const n = Number(v) || 0, abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', ',') + ' M';
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace('.', ',') + ' K';
  return fmtInt(n);
}
function dbQsColor(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '#9db3c0';
  if (n < 98) return '#c0392b';
  if (n < 99) return '#e67e22';
  if (n <= 101) return '#27ae60';
  if (n <= 102) return '#e67e22';
  return '#c0392b';
}
function dbDestroy(){ Object.values(DB.charts).forEach(c => { try { c.destroy(); } catch(e){} }); DB.charts = {}; }
if (window.Chart && window.ChartDataLabels){
  try { Chart.register(ChartDataLabels); } catch(e){}
}
function dbMakeChart(id, label, labels, data, colors, yOpts, labelFmt){
  try {
    const cv = document.getElementById(id);
    if (!cv || !window.Chart) return;
    if (DB.charts[id]){ try { DB.charts[id].destroy(); } catch(e){} }
    DB.charts[id] = new Chart(cv.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: colors, borderRadius: 6,
                                   maxBarThickness: 52, borderWidth: 1, borderColor: 'rgba(0,0,0,.06)' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${label} : ` + (labelFmt ? labelFmt(c.parsed.y) : c.parsed.y) } },
          datalabels: window.ChartDataLabels ? {
            anchor: 'end', align: 'end', offset: 2, clamp: true,
            color: '#003D5B', font: { weight: '700', size: 11 },
            formatter: v => (v === null || v === undefined) ? '' : (labelFmt ? labelFmt(v) : String(v))
          } : { display: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 60, autoSkip: true } },
          y: Object.assign({ display: false, beginAtZero: true }, yOpts || {})
        }
      }
    });
  } catch(e){ console.error('[Dashboard]', e); }
}
function refreshDbWeeks(weeks){
  const sel = $('#db-week'), cur = sel.value;
  sel.innerHTML = '<option value="">Semaine : toutes</option>' +
    (weeks || []).map(w => `<option${w === cur ? ' selected' : ''}>${esc(w)}</option>`).join('');
}
function renderDashboard(d){
  const kpis = document.getElementById('db-kpis');
  const out = document.getElementById('out-db');
  if (!kpis || !out) return;
  const k = d.kpis || {};
  const qsTxt = (k.qs === null || k.qs === undefined) ? '—' : String(k.qs).replace('.', ',');
  kpis.innerHTML =
    `<div class="metric"><div class="ico i-teal">🎯</div><div class="val">${qsTxt}</div><div class="lbl">QS globale (%)</div></div>` +
    `<div class="metric"><div class="ico i-blue">🍽️</div><div class="val">${fmtInt(k.consomme)}</div><div class="lbl">Repas consommés</div></div>` +
    `<div class="metric"><div class="ico i-red">🗑️</div><div class="val">${fmtInt(k.non_conso)}</div><div class="lbl">Non consommé</div></div>` +
    `<div class="metric"><div class="ico i-green">💰</div><div class="val">${fmtInt(k.montant)}</div><div class="lbl">Montant MGA HT</div></div>` +
    `<div class="metric"><div class="ico i-navy">📅</div><div class="val">${k.nb_jours || 0}</div><div class="lbl">Jours de données</div></div>`;
  $('#db-count').textContent =
    `${k.nb_jours || 0} jour(s) · Semaines : ${(d.weeks_available || []).join(', ') || '—'} · Mois : ${(d.months_available || []).join(', ') || '—'}`;
  const rows = d.rows || [];
  if (!rows.length){
    dbDestroy();
    out.innerHTML = '<div class="msg warn">⚠️ Aucune donnée : générez d\'abord des synthèses mensuelles (onglet 🧾 Synthèse) pour alimenter le dashboard.</div>';
    return;
  }
  const labels = rows.map(r => r.periode);
  const qsData = rows.map(r => (r['QS (%)'] === null || r['QS (%)'] === undefined) ? null : Number(r['QS (%)']));
  const ncData = rows.map(r => Number(r['Non consommé'] || 0));
  const mtData = rows.map(r => Number(r['MONTANT DA MGA HT'] || 0));
  let h = '';
  if (!window.Chart) h += '<div class="msg err">❌ Chart.js non chargé (connexion internet requise).</div>';
  h += '<div class="chart-box"><h3 class="sub">🎯 Qualité de service — QS (%)</h3><div class="chart-wrap"><canvas id="db-c-qs"></canvas></div></div>';
  h += '<div class="chart-box"><h3 class="sub">🗑️ Nombre de repas non consommés</h3><div class="chart-wrap"><canvas id="db-c-nc"></canvas></div></div>';
  h += '<div class="chart-box"><h3 class="sub">💰 MONTANT DA MGA HT</h3><div class="chart-wrap"><canvas id="db-c-mt"></canvas></div></div>';
  const tblRows = rows.map(r => ({'Période': r.periode, 'Nb jours': r.nb_jours, 'Consommé': r['Consommé'],
    'Commande finale': r['Commande finale'], 'Non consommé': r['Non consommé'],
    'QS (%)': r['QS (%)'], 'MONTANT DA MGA HT': r['MONTANT DA MGA HT']}));
  h += `<details class="mt"><summary>📋 Données des graphiques</summary>${tableHTML(tblRows)}</details>`;
  out.innerHTML = h;
  if (window.Chart){
    dbMakeChart('db-c-qs', 'QS (%)', labels, qsData, qsData.map(dbQsColor),
      {beginAtZero: false, suggestedMin: 90, suggestedMax: 105},
      v => String(v).replace('.', ',') + ' %');
    dbMakeChart('db-c-nc', 'Non consommé', labels, ncData, ncData.map(() => '#e74c3c'),
      null, v => fmtInt(v));
    dbMakeChart('db-c-mt', 'MONTANT DA MGA HT', labels, mtData, mtData.map(() => '#003D5B'),
      null, fmtCompact);
  }
}
async function loadDashboard(){
  const period = $('#db-period').value;
  const params = new URLSearchParams({period});
  if (period !== 'mensuel'){
    if ($('#db-month').value) params.set('month', $('#db-month').value);
    if ($('#db-week').value) params.set('week', $('#db-week').value);
  }
  busy($('#btn-db'), true, 'Chargement…');
  try {
    const d = await api('/api/dashboard?' + params);
    DB.last = d;
    refreshDbWeeks(d.weeks_available);
    renderDashboard(d);
  } catch(e){
    const out = document.getElementById('out-db');
    if (out) out.innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`;
    toast('Dashboard : ' + e.message, 'err');
  }
  busy($('#btn-db'), false);
}
on('#db-period', 'change', () => { $('#db-month').disabled = $('#db-period').value === 'mensuel'; loadDashboard(); });
on('#db-month', 'change', loadDashboard);
on('#db-week', 'change', loadDashboard);
on('#btn-db', 'click', loadDashboard);
on('#btn-exp-db', 'click', () => {
  const period = $('#db-period').value;
  const params = new URLSearchParams({period});
  if (period !== 'mensuel'){
    if ($('#db-month').value) params.set('month', $('#db-month').value);
    if ($('#db-week').value) params.set('week', $('#db-week').value);
  }
  window.open('/api/export_dashboard?' + params, '_blank');
});

(function init(){
  MULTI_IDS.forEach(initMultiSelect);
  const m = $('#db-month');
  if (m && !m.value){
    const n = new Date();
    m.value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
  }
  (async () => {
    try {
      const me = await api('/api/me', {silent:true});
      ROLE = me.role || null;
      applyRoleUI();
    } catch(e){ ROLE = null; }
    await restoreIfEmpty();
    await refreshState();
    await loadAllForWeek(false);
  })();
})();
