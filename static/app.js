'use strict';
const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const DAY_ICONS = ['🔵','🟠','🟢','🟣','🔴','🟡','⚫'];
let ROLE = null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function on(sel, evt, fn){ const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.addEventListener(evt, fn); }

function toast(text, type='ok'){
  const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = text;
  $('#toasts').appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 350); }, 4500);
}
let pendingReqs = 0, loadingTimer = null;
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
}
function hideLoadingOverlay(){
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
  return trackReq((async () => {
    const r = await fetch(url, opts); let d = {};
    try { d = await r.json(); } catch(e){}
    if (r.status === 401){ window.location.href = '/'; throw new Error("Connexion requise"); }
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  })());
}
async function getResult(key){ try { return await api('/api/result/' + key); } catch(e){ return null; } }
function debounce(fn, ms=250){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }; }
function busy(btn, on_, label){
  if (!btn) return;
  if (on_){ btn.dataset.lbl = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ ' + (label||'…'); }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.lbl; }
}
function numVal(id){ const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : 0; }
function intVal(id){ const el = document.getElementById(id); const v = el ? parseInt(el.value) : NaN; return Number.isFinite(v) ? v : 0; }
function fillSelect(sel, values){
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous</option>' +
    (values||[]).map(v => `<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');
}
function orderedRows(rows, order){
  if (!rows || !rows.length) return rows;
  const known = new Set(order);
  const extra = Object.keys(rows[0]).filter(c => !known.has(c));
  const cols = order.concat(extra);
  return rows.map(r => { const o = {}; cols.forEach(c => o[c] = r[c]); return o; });
}
function isTotalRow(r){ return Object.values(r).some(v =>
  ['TOTAL','Total','TOTAL SEMAINE','Total par Créneau','Total à commander','Total Théorique'].includes(String(v ?? ''))); }
function fmtPct(v){ return (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(1).replace('.', ',') + ' %'; }
function tableHTML(rows, o={}){
  if (!rows || !rows.length) return '<div class="empty">Aucune donnée à afficher.</div>';
  const cols = Object.keys(rows[0]);
  let h = '<div class="tscroll"><table class="data"><thead><tr>' +
          cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
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

/* ================= RÔLE ================= */
const ADMIN_CONTROL_IDS = ['btn-import','inp-planning','inp-commande','inp-reference',
  'inp-week','inp-taux','btn-del-week','btn-p2','btn-p3','btn-p4','btn-p5',
  'btn-p7','btn-p6','btn-p8','btn-exp-p2'];
function applyRoleUI(){
  const viewer = (ROLE === 'viewer');
  // 1) Masquage par classe (éléments marqués admin-only dans le HTML)
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('viewer-hidden', viewer));
  // 2) Filet de sécurité : grisage par ID, même si la classe manque dans le HTML
  ADMIN_CONTROL_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = viewer;
    el.classList.toggle('viewer-locked', viewer);
  });
  const b = $('#role-badge');
  if (b) b.innerHTML = viewer ? '👁️ Visualiseur' : '🛡️ Admin';
  ['#inp-month','#inp-pu'].forEach(sel => { const el = $(sel); if (el) el.disabled = viewer; });
}

/* ---------- IndexedDB ---------- */
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
async function saveBackup(){
  if (ROLE !== 'admin') return;
  try { const snap = await api('/api/backup_export'); await idbSet('state', snap); } catch(e){}
}
async function restoreIfEmpty(){
  if (ROLE !== 'admin') return;
  try {
    const s = await api('/api/state');
    if (s.weeks && s.weeks.length) return;
    const snap = await idbGet('state');
    if (!snap) return;
    const hasData = Object.values(snap.plannings || {}).some(x => x && x.rows && x.rows.length);
    if (!hasData) return;
    const r = await api('/api/backup_import', {method:'POST', headers:{'Content-Type':'application/json'},
                                               body: JSON.stringify(snap)});
    toast(`💾 Données restaurées (${(r.weeks||[]).join(', ')})`);
  } catch(e){}
}

/* ---------- Sidebar ---------- */
on('#btn-side', 'click', () => document.body.classList.toggle('side-hidden'));
on('#inp-taux', 'input', e => { $('#taux-val').textContent = e.target.value + '%'; });

on('#btn-import', 'click', async () => {
  if (!$('#inp-planning').files.length) return toast('Importez au moins un fichier Planning.', 'err');
  const fd = new FormData();
  for (const f of $('#inp-planning').files) fd.append('planning', f);
  if ($('#inp-commande').files[0]) fd.append('commande', $('#inp-commande').files[0]);
  if ($('#inp-reference').files[0]) fd.append('reference', $('#inp-reference').files[0]);
  const w = $('#inp-week').value.trim(); if (w) fd.append('week', w);
  busy($('#btn-import'), true, 'Import…');
  try {
    const res = await api('/api/import', {method:'POST', body: fd});
    let t = `✅ Semaine <b>${esc(res.week)}</b> : ${res.n_planifiees} planifiés, ${res.n_commandes} commandes.`;
    if (res.warnings.length) t += '<br>⚠️ ' + res.warnings.map(esc).join('<br>⚠️ ');
    if ($('#imp-summary')) $('#imp-summary').innerHTML = `<div class="msg ok">${t}</div>`;
    p1Cache.week = undefined;
    await refreshState(); await loadP1(); await saveBackup();
  } catch(e){
    if ($('#imp-summary')) $('#imp-summary').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`;
    toast(esc(e.message), 'err');
  }
  busy($('#btn-import'), false);
});

on('#sel-week', 'change', async e => {
  await api('/api/select_week', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({week: e.target.value})});
  p1Cache.week = undefined;
  await loadP1();
  await autoLoadAll();
});
on('#btn-del-week', 'click', async () => {
  if (!confirm('Supprimer définitivement cette semaine et toutes ses données ?')) return;
  await api('/api/delete_week', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({week: $('#sel-week').value})});
  p1Cache.week = undefined;
  ['out-p2','out-p3','out-p4','out-p5','out-p6','out-p8'].forEach(id => { const el = $('#'+id); if (el) el.innerHTML = ''; });
  p5Rows = null; p7Rows = null; lastRecapData = null; lastSynData = null;
  await refreshState(); await loadP1(); await saveBackup();
  toast('Semaine supprimée');
});

async function refreshState(){
  const s = await api('/api/state');
  $('#sel-week').innerHTML = s.weeks.map(w => `<option${w===s.current_week?' selected':''}>${esc(w)}</option>`).join('') || '<option value="">—</option>';
  $('#sel-week').disabled = !s.weeks.length;
  $('#week-badge').textContent = s.current_week ? 'Semaine ' + s.current_week : 'Aucune semaine';
}

/* ---------- Onglets ---------- */
 $$('.tab').forEach(b => b.addEventListener('click', async () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); $('#' + b.dataset.tab).classList.add('active');
  window.scrollTo({top:0});
  if (b.dataset.tab === 'p1') await loadP1();
  if (b.dataset.tab === 'p6'){ await loadPrefixes(); const r = await getResult('recap'); if (r) renderRecap(r); }
  if (b.dataset.tab === 'p7'){ const c = await getResult('conf'); if (c){ p5Rows = c.rows; } const a = await getResult('constat'); if (a){ p7Rows = a.rows; renderP7(); } }
  if (b.dataset.tab === 'p8'){ const s8 = await getResult('synthese'); if (s8) renderSynthese(s8); }
}));

async function autoLoadAll(){
  try {
    const [p2, p3, p4, conf, recap, syn] = await Promise.all(
      ['p2','p3','p4','conf','recap','synthese'].map(getResult));
    if (p2 && p2.rows){ $('#out-p2').innerHTML = tableHTML(orderedRows(p2.rows, ['Projet', ...JOURS]));
      if ($('#p2-metrics')) $('#p2-metrics').innerHTML = JOURS.map((j, i) =>
        `<div class="metric"><div class="ico ${['i-blue','i-yellow','i-teal','i-red','i-navy','i-green','i-grey'][i]}">${DAY_ICONS[i]}</div>
         <div class="val">${p2.metrics[j]}</div><div class="lbl">${j}</div></div>`).join(''); }
    if (p3 && p3.pivot && p3.pivot.rows)
      $('#out-p3').innerHTML = '<h3 class="sub">📊 Nombre de personnes par Heure de Début</h3>' +
        tableHTML(orderedRows(p3.pivot.rows, ['Shift (Début)', ...JOURS, 'Total Semaine'])) +
        `<details class="mt"><summary>👁️ Liste détaillée</summary>${tableHTML(orderedRows(p3.detail.rows, ['Workday ID','Nom','Projet','Jour','Transport','Shift (Début)']))}</details>`;
    if (p4 && p4.peaks && p4.peaks.rows)
      $('#out-p4').innerHTML = '<h3 class="sub">📊 Pic de présence par projet</h3>' +
        tableHTML(orderedRows(p4.peaks.rows, ['Projet', ...JOURS])) +
        `<details class="mt"><summary>🕒 Détail par créneau</summary>${tableHTML(orderedRows(p4.slots.rows, ['Créneau', ...JOURS, 'Total Jour']))}</details>`;
    if (conf && conf.rows){ p5Rows = conf.rows; renderP5(); }
    if (recap && recap.day_order) renderRecap(recap);
    if (syn && syn.rows) renderSynthese(syn);
    toast('Résultats de la semaine rechargés ✅');
  } catch(e){}
}

/* ---------- PAGE 1 ---------- */
let p1Cache = {week: undefined, rows: [], options: {}, total: 0};
async function loadP1(){
  try {
    const s = await api('/api/state');
    const week = s.current_week;
    if (p1Cache.week !== week){
      const d = await api('/api/page1');
      p1Cache = {week, rows: d.rows, options: d.options || {}, total: d.total || 0};
      fillSelect($('#f1-transport'), p1Cache.options.TRANSPORT || []);
      fillSelect($('#f1-projet'), p1Cache.options.Projet || []);
      fillSelect($('#f1-statut'), p1Cache.options.Statut || []);
      fillSelect($('#f2-projet'), p1Cache.options.Projet || []);
      fillSelect($('#f2-statut'), p1Cache.options.Statut || []);
      fillSelect($('#f3-transport'), p1Cache.options.TRANSPORT || []);
      fillSelect($('#f3-projet'), p1Cache.options.Projet || []);
      fillSelect($('#f3-statut'), p1Cache.options.Statut || []);
      fillSelect($('#f4-projet'), p1Cache.options.Projet || []);
      fillSelect($('#f4-statut'), p1Cache.options.Statut || []);
    }
    applyP1();
  } catch(e){ $('#out-p1').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
function applyP1(){
  const t = $('#f1-transport').value, pj = $('#f1-projet').value, st = $('#f1-statut').value;
  const q = ($('#f1-search').value || '').trim().toLowerCase();
  let rows = p1Cache.rows;
  if (t) rows = rows.filter(r => String(r['TRANSPORT'] ?? '') === t);
  if (pj) rows = rows.filter(r => String(r['Projet'] ?? '') === pj);
  if (st) rows = rows.filter(r => String(r['Statut'] ?? '') === st);
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
  JOURS.forEach(j => h += `<th colspan="4">${j}</th>`);
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
on('#btn-exp-p1', 'click', () =>
  window.open('/api/export_page1?' + new URLSearchParams({transport:$('#f1-transport').value, projet:$('#f1-projet').value, statut:$('#f1-statut').value, q:$('#f1-search').value}), '_blank'));

/* ---------- PAGE 2 ---------- */
if ($('#p2-presta'))
  $('#p2-presta').innerHTML = JOURS.map(j => `<label>${j}<input type="number" id="prest-${j}" min="0" value="0"></label>`).join('');
on('#btn-p2', 'click', async () => {
  busy($('#btn-p2'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({taux: $('#inp-taux').value, projet: $('#f2-projet').value, statut: $('#f2-statut').value});
    JOURS.forEach(j => p.set('prest_' + j, intVal('prest-' + j)));
    const d = await api('/api/page2?' + p);
    $('#out-p2').innerHTML = tableHTML(orderedRows(d.rows, ['Projet', ...JOURS]));
    $('#p2-metrics').innerHTML = JOURS.map((j, i) =>
      `<div class="metric"><div class="ico ${['i-blue','i-yellow','i-teal','i-red','i-navy','i-green','i-grey'][i]}">${DAY_ICONS[i]}</div>
       <div class="val">${d.metrics[j]}</div><div class="lbl">${j}</div></div>`).join('');
    await saveBackup();
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p2'), false);
});
on('#btn-exp-p2', 'click', () => {
  const p = new URLSearchParams({taux: $('#inp-taux').value, projet: $('#f2-projet').value, statut: $('#f2-statut').value});
  JOURS.forEach(j => p.set('prest_' + j, intVal('prest-' + j)));
  window.open('/api/export_page2?' + p, '_blank');
});

/* ---------- PAGE 3 ---------- */
on('#btn-p3', 'click', async () => {
  busy($('#btn-p3'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({transport:$('#f3-transport').value, projet:$('#f3-projet').value, statut:$('#f3-statut').value});
    const d = await api('/api/page3?' + p);
    $('#out-p3').innerHTML = '<h3 class="sub">📊 Nombre de personnes par Heure de Début</h3>' +
      tableHTML(orderedRows(d.pivot.rows, ['Shift (Début)', ...JOURS, 'Total Semaine'])) +
      `<details class="mt"><summary>👁️ Liste détaillée</summary>` +
      tableHTML(orderedRows(d.detail.rows, ['Workday ID','Nom','Projet','Jour','Transport','Shift (Début)'])) + '</details>';
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p3'), false);
});
on('#btn-exp-p3', 'click', () =>
  window.open('/api/export_page3?' + new URLSearchParams({transport:$('#f3-transport').value, projet:$('#f3-projet').value, statut:$('#f3-statut').value}), '_blank'));

/* ---------- PAGE 4 ---------- */
on('#btn-p4', 'click', async () => {
  busy($('#btn-p4'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({projet:$('#f4-projet').value, statut:$('#f4-statut').value});
    const d = await api('/api/page4?' + p);
    $('#out-p4').innerHTML = '<h3 class="sub">📊 Pic de présence par projet</h3>' +
      tableHTML(orderedRows(d.peaks.rows, ['Projet', ...JOURS])) +
      `<details class="mt"><summary>🕒 Détail par créneau</summary>` +
      tableHTML(orderedRows(d.slots.rows, ['Créneau', ...JOURS, 'Total Jour'])) + '</details>';
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p4'), false);
});
on('#btn-exp-p4', 'click', () =>
  window.open('/api/export_page4?' + new URLSearchParams({projet:$('#f4-projet').value, statut:$('#f4-statut').value}), '_blank'));

/* ---------- PAGE 5 ---------- */
let p5Rows = null;
function confTable(rows){
  if (!rows || !rows.length) return '<div class="empty">Aucune donnée.</div>';
  const base = ['Workday ID','Paid ID','Nom','Projet','Statut'];
  let h = '<div class="tscroll"><table class="data conf"><thead>';
  h += '<tr class="grp-row"><th colspan="5">👤 Identité</th>';
  JOURS.forEach(j => h += `<th colspan="2">${j}</th>`);
  h += '</tr><tr class="cols-row">';
  base.forEach(c => h += `<th>${esc(c)}</th>`);
  JOURS.forEach(() => h += '<th>Planning</th><th>Commande</th>');
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr>' + base.map(c => `<td title="${esc(r[c])}">${esc(r[c])}</td>`).join('');
    JOURS.forEach(j => {
      const pl = String(r[j + ' - Planning'] ?? '');
      const cm = String(r[j + ' - Commande'] ?? '');
      const plCell = pl === 'Planifié' ? '<span class="badge b-ok">Planifié</span>'
        : pl === 'hors planning' ? '<span class="badge b-warn">hors planning</span>'
        : pl ? `<span class="badge b-info">${esc(pl)}</span>` : '';
      const cmCell = cm ? (/JE NE SERAI PAS/i.test(cm) ? '<span class="badge b-abs">Je ne serai pas présent</span>' : `<span title="${esc(cm)}">${esc(cm)}</span>`) : '';
      h += `<td>${plCell}</td><td>${cmCell}</td>`;
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

/* ---------- PAGE 6 : Commandes par menu ---------- */
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
function renderRecap(d){
  lastRecapData = d;
  let h = (d.warnings || []).map(w => `<div class="msg warn">⚠️ ${esc(w)}</div>`).join('');
  h += '<h3 class="sub">📈 Synthèse de la semaine (repas à préparer)</h3>' +
       tableHTML(orderedRows(d.summary_rows, SUMMARY_COLS), {recap:true});
  for (const day of d.day_order){
    const D = d.days[day];
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
        ${tableHTML(orderedRows(E.rows, RECAP_COLS), {recap:true})}</div></div>`;
    }
    h += '</div>';
  }
  if (!d.has_planning) h += '<div class="msg warn">ℹ️ Planning non chargé.</div>';
  $('#out-p6').innerHTML = h;
  $$('#out-p6 [data-dtaux]').forEach(inp => inp.addEventListener('change', () => {
    tauxByDay[inp.dataset.dtaux] = parseFloat(inp.value) || 0;
    calcP6();
  }));
}
async function calcP6(){
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
      return `<td>${esc(v)}</td>`;
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

/* ---------- PAGE 7 : Constats ---------- */
let p7Rows = null;
function renderP7(){
  if (p7Rows === null) return;
  const rows = orderedRows(searchRows(p7Rows, $('#f7-search').value),
    ['Paid ID','Nom','Projet','Jour','Type de constat','Commande']);
  $('#out-p7').innerHTML = rows.length ? tableHTML(rows) : '<div class="msg ok">✅ Aucun constat.</div>';
}
on('#btn-p7', 'click', async () => {
  busy($('#btn-p7'), true, 'Extraction…');
  try {
    p7Rows = (await api('/api/page7', {method:'POST'})).rows;
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

/* ---------- PAGE 8 : Synthèse mensuelle ---------- */
const SYN_COLS = ['Date','Semaine','Planifié total','À commander','Commande finale','Consommé',
                  'Non consommé','À facturer','QS (%)','QS conso vs commandé final (%)',
                  'MONTANT DA MGA HT','Nombre de plat ajusté','Pourcentage plat ajusté (%)'];
const SYN_EDITABLE = {'Commande finale':'commande_finale', 'Consommé':'consomme'};
let synEdits = {};
let lastSynData = null;

function synthBody(){
  return { month: ($('#inp-month') ? $('#inp-month').value : ''),
           pu: numVal('inp-pu'), edits: ROLE === 'admin' ? synEdits : {} };
}
function renderSynthese(d){
  lastSynData = d;
  if ($('#inp-month') && !$('#inp-month').value) $('#inp-month').value = d.month || '';
  if ($('#inp-pu') && document.activeElement !== $('#inp-pu')) $('#inp-pu').value = d.pu ?? 0;
  let h = '<div class="tscroll"><table class="data syn"><thead><tr>' +
    SYN_COLS.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  d.rows.forEach(r => {
    const isTotal = String(r['Date']).toUpperCase().startsWith('TOTAL');
    h += `<tr class="${isTotal ? 'total' : ''}">`;
    SYN_COLS.forEach(c => {
      if (!isTotal && SYN_EDITABLE[c] && ROLE === 'admin'){
        h += `<td class="editcell"><input type="number" min="0" step="1" data-date="${esc(r.DateIso)}" data-champ="${SYN_EDITABLE[c]}" value="${r[c] ?? 0}"></td>`;
      } else if (c.includes('(%)')){
        h += `<td>${fmtPct(r[c])}</td>`;
      } else if (c === 'MONTANT DA MGA HT'){
        h += `<td style="text-align:right;font-weight:600">${Number(r[c] ?? 0).toLocaleString('fr-FR')}</td>`;
      } else {
        h += `<td>${esc(r[c])}</td>`;
      }
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  $('#out-p8').innerHTML = h;
  $$('#out-p8 .editcell input').forEach(inp => inp.addEventListener('change', debounce(() => {
    const diso = inp.dataset.date, champ = inp.dataset.champ;
    synEdits[diso] = synEdits[diso] || {};
    synEdits[diso][champ] = parseInt(inp.value) || 0;
    genSynthese(false);
  }, 400)));
}
async function genSynthese(showToast = true){
  busy($('#btn-p8'), true, 'Calcul…');
  try {
    renderSynthese(await api('/api/synthese', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(synthBody())}));
    synEdits = {};
    if (showToast) toast('Synthèse générée ✅');
  } catch(e){ $('#out-p8').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; if (showToast) toast(esc(e.message), 'err'); }
  busy($('#btn-p8'), false);
}
on('#btn-p8', 'click', () => genSynthese());
on('#inp-month', 'change', () => { if (ROLE === 'admin') genSynthese(); });
on('#inp-pu', 'change', debounce(() => { if (ROLE === 'admin') genSynthese(false); }, 500));
on('#btn-exp-p8', 'click', async () => {
  try { await downloadPost('/api/export_synthese', 'synthese_mensuelle.xlsx', synthBody()); }
  catch(e){ toast(esc(e.message), 'err'); }
});
on('#btn-pdf-p8', 'click', () => {
  if (!lastSynData){ toast("Aucune synthèse générée pour cette semaine.", 'warn'); return; }
  const d = lastSynData;
  let h = `<h1>LogiPlan — Synthèse mensuelle · ${esc(d.month || '')}</h1>
    <p class="gen">Édité le ${new Date().toLocaleDateString('fr-FR')} · Prix unitaire : ${Number(d.pu).toLocaleString('fr-FR')} MGA HT</p>`;
  h += pdfSimpleTable(d.rows, SYN_COLS);
  printIframe(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Synthèse</title><style>
body{font-family:'Segoe UI',Arial,sans-serif;padding:14px;font-size:10px;color:#22333f}
h1{color:#003D5B;font-size:15px;border-bottom:3px solid #25E2CC;padding-bottom:5px;margin:0 0 4px}
.gen{color:#789;font-size:9px;margin:0 0 8px}
table{border-collapse:collapse;width:100%}
th{background:#003D5B;color:#fff;padding:3px 4px;font-size:8.5px;text-align:left}
td{border:1px solid #dde5ec;padding:2px 4px}
tbody tr:nth-child(odd) td{background:#f8fbfd}
tr.total td{font-weight:800;background:rgba(0,61,91,.12)!important;border-top:2px solid #003D5B}
@page{size:A4 landscape;margin:10mm}</style></head><body>${h}</body></html>`);
});

/* ---------- Démarrage ---------- */
async function startApp(){
  await restoreIfEmpty();
  try { await refreshState(); await loadP1(); await autoLoadAll(); } catch(e){}
}
(async function boot(){
  try {
    const me = await api('/api/me');
    if (!me.role){ window.location.href = '/'; return; }
    ROLE = me.role; applyRoleUI();
    if (me.using_defaults && me.role === 'admin')
      setTimeout(() => toast('⚠️ Identifiants par défaut actifs — définissez ADMIN_USER / ADMIN_PASSWORD / VIEWER_USER / VIEWER_PASSWORD dans Render → Environment', 'warn'), 1800);
    await startApp();
  } catch(e){ window.location.href = '/'; }
})();
