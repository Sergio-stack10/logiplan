'use strict';
const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const ENTITES = ['PRESTA','SUPPORT + SAI','PROD / PLANIFIÉ PROD','AUTRE / IGNORÉ'];
const ENTITES_MAIN = ENTITES.slice(0, 3);
const DAY_ICONS = ['🔵','🟠','🟢','🟣','🔴','🟡','⚫'];
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- Helpers ---------- */
function toast(text, type='ok'){
  const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = text;
  $('#toasts').appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 350); }, 4500);
}
async function api(url, opts={}){
  const r = await fetch(url, opts); let d = {};
  try { d = await r.json(); } catch(e){}
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
function debounce(fn, ms=280){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }; }
function busy(btn, on, label){
  if (!btn) return;
  if (on){ btn.dataset.lbl = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ ' + (label||'…'); }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.lbl; }
}
function numVal(id){ const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : 0; }
function intVal(id){ const el = document.getElementById(id); const v = el ? parseInt(el.value) : NaN; return Number.isFinite(v) ? v : 0; }
function fillSelect(sel, values){
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous</option>' +
    (values||[]).map(v => `<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');
}

/* ORDRE DES COLONNES VERROUILLÉ CÔTÉ INTERFACE (garantie anti-désordre) */
function orderedRows(rows, order){
  if (!rows || !rows.length) return rows;
  const known = new Set(order);
  const extra = Object.keys(rows[0]).filter(c => !known.has(c));
  const cols = order.concat(extra);
  return rows.map(r => { const o = {}; cols.forEach(c => o[c] = r[c]); return o; });
}
function isTotalRow(r){ return Object.values(r).some(v =>
  ['TOTAL','Total','TOTAL SEMAINE','Total par Créneau','Total à commander','Total Théorique'].includes(String(v ?? ''))); }
function tableHTML(rows, o={}){
  if (!rows || !rows.length) return '<div class="empty">Aucune donnée à afficher.</div>';
  const cols = Object.keys(rows[0]);
  let h = '<div class="tscroll"><table class="data"><thead><tr>' +
          cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(r => {
    let cls = '';
    const c0 = String(r[cols[0]] ?? '');
    if (o.recap){ if (c0==='TOTAL') cls='total'; else if (c0==='SANS CHOIX') cls='sanschoix'; else if (c0.startsWith('dont ')) cls='dont'; }
    else if (isTotalRow(r)) cls = 'total';
    h += `<tr class="${cls}">` + cols.map(c => {
      let v = r[c];
      if (c === 'Pourcentage' && v !== null && v !== undefined && v !== '') v = Number(v).toFixed(1).replace('.', ',') + ' %';
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

/* ---------- Sidebar toggle ---------- */
 $('#btn-side').addEventListener('click', () => document.body.classList.toggle('side-hidden'));

/* ---------- Sidebar : import & semaines ---------- */
 $('#inp-taux').addEventListener('input', e => $('#taux-val').textContent = e.target.value + '%');

 $('#btn-import').addEventListener('click', async () => {
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
    $('#imp-summary').innerHTML = `<div class="msg ok">${t}</div>`;
    toast('Import réussi : semaine ' + esc(res.week));
    await refreshState(); await loadP1();
  } catch(e){
    $('#imp-summary').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`;
    toast(esc(e.message), 'err');
  }
  busy($('#btn-import'), false);
});

 $('#sel-week').addEventListener('change', async e => {
  await api('/api/select_week', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({week: e.target.value})});
  await loadP1();
  toast('Semaine ' + esc(e.target.value) + ' affichée');
});
 $('#btn-del-week').addEventListener('click', async () => {
  if (!confirm('Supprimer définitivement cette semaine ?')) return;
  await api('/api/delete_week', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({week: $('#sel-week').value})});
  await refreshState(); await loadP1();
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
  if (b.dataset.tab === 'p6') await loadPrefixes();
}));

/* ---------- PAGE 1 : Planning regroupé (ordre codé en dur) ---------- */
async function loadP1(){
  const p = new URLSearchParams({transport:$('#f1-transport').value, projet:$('#f1-projet').value,
                                 statut:$('#f1-statut').value, q:$('#f1-search').value});
  try {
    const d = await api('/api/page1?' + p);
    fillSelect($('#f1-transport'), d.options.TRANSPORT || []);
    fillSelect($('#f1-projet'), d.options.Projet || []);
    fillSelect($('#f1-statut'), d.options.Statut || []);
    fillSelect($('#f2-projet'), d.options.Projet || []);
    fillSelect($('#f2-statut'), d.options.Statut || []);
    fillSelect($('#f3-transport'), d.options.TRANSPORT || []);
    fillSelect($('#f3-projet'), d.options.Projet || []);
    fillSelect($('#f3-statut'), d.options.Statut || []);
    fillSelect($('#f4-projet'), d.options.Projet || []);
    fillSelect($('#f4-statut'), d.options.Statut || []);
    $('#cnt-p1').textContent = d.total ? `${d.shown} ligne(s) affichée(s) sur ${d.total}` : '';
    $('#out-p1').innerHTML = planTable(d.rows);
  } catch(e){ $('#out-p1').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
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
      const on = de && de !== '00:00' ? ' class="on"' : '';
      h += `<td${on}>${esc(de)||'—'}</td><td${on}>${esc(r[j+'_A'])||'—'}</td><td${on}>${esc(r[j+'_Pause'])||'—'}</td>`;
      h += `<td class="flag${Number(r[j+'_Flag'])?' on':''}">${Number(r[j+'_Flag'])?'✓':''}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}
['f1-transport','f1-projet','f1-statut'].forEach(id => $('#'+id).addEventListener('change', loadP1));
 $('#f1-search').addEventListener('input', debounce(loadP1, 300));
 $('#btn-exp-p1').addEventListener('click', () =>
  window.open('/api/export_page1?' + new URLSearchParams({transport:$('#f1-transport').value, projet:$('#f1-projet').value, statut:$('#f1-statut').value, q:$('#f1-search').value}), '_blank'));

/* ---------- PAGE 2 : Effectifs — ordre Projet puis Lundi..Dimanche ---------- */
 $('#p2-presta').innerHTML = JOURS.map(j => `<label>${j}<input type="number" id="prest-${j}" min="0" value="0"></label>`).join('');
 $('#btn-p2').addEventListener('click', async () => {
  busy($('#btn-p2'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({taux: $('#inp-taux').value, projet: $('#f2-projet').value, statut: $('#f2-statut').value});
    JOURS.forEach(j => p.set('prest_' + j, $('#prest-' + j).value));
    const d = await api('/api/page2?' + p);
    $('#out-p2').innerHTML = tableHTML(orderedRows(d.rows, ['Projet', ...JOURS]));
    $('#p2-metrics').innerHTML = JOURS.map((j, i) =>
      `<div class="metric"><div class="ico ${['i-blue','i-yellow','i-teal','i-red','i-navy','i-green','i-grey'][i]}">${DAY_ICONS[i]}</div>
       <div class="val">${d.metrics[j]}</div><div class="lbl">${j}</div></div>`).join('');
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p2'), false);
});
 $('#btn-exp-p2').addEventListener('click', () => {
  const p = new URLSearchParams({taux: $('#inp-taux').value, projet: $('#f2-projet').value, statut: $('#f2-statut').value});
  JOURS.forEach(j => p.set('prest_' + j, $('#prest-' + j).value));
  window.open('/api/export_page2?' + p, '_blank');
});

/* ---------- PAGE 3 : Shifts ---------- */
 $('#btn-p3').addEventListener('click', async () => {
  busy($('#btn-p3'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({transport:$('#f3-transport').value, projet:$('#f3-projet').value, statut:$('#f3-statut').value});
    const d = await api('/api/page3?' + p);
    $('#out-p3').innerHTML = '<h3 class="sub">📊 Nombre de personnes par Heure de Début</h3>' +
      tableHTML(orderedRows(d.pivot.rows, ['Shift (Début)', ...JOURS, 'Total Semaine'])) +
      `<details class="mt"><summary>👁️ Liste détaillée des personnes par shift</summary>` +
      tableHTML(orderedRows(d.detail.rows, ['Workday ID','Nom','Projet','Jour','Transport','Shift (Début)'])) + '</details>';
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p3'), false);
});
 $('#btn-exp-p3').addEventListener('click', () =>
  window.open('/api/export_page3?' + new URLSearchParams({transport:$('#f3-transport').value, projet:$('#f3-projet').value, statut:$('#f3-statut').value}), '_blank'));

/* ---------- PAGE 4 : Créneaux ---------- */
 $('#btn-p4').addEventListener('click', async () => {
  busy($('#btn-p4'), true, 'Calcul…');
  try {
    const p = new URLSearchParams({projet:$('#f4-projet').value, statut:$('#f4-statut').value});
    const d = await api('/api/page4?' + p);
    $('#out-p4').innerHTML = '<h3 class="sub">📊 Pic de présence par projet (overlap de shifts)</h3>' +
      tableHTML(orderedRows(d.peaks.rows, ['Projet', ...JOURS])) +
      `<details class="mt"><summary>🕒 Détail complet par créneau horaire</summary>` +
      tableHTML(orderedRows(d.slots.rows, ['Créneau', ...JOURS, 'Total Jour'])) + '</details>';
  } catch(e){ toast(esc(e.message), 'err'); }
  busy($('#btn-p4'), false);
});
 $('#btn-exp-p4').addEventListener('click', () =>
  window.open('/api/export_page4?' + new URLSearchParams({projet:$('#f4-projet').value, statut:$('#f4-statut').value}), '_blank'));

/* ---------- PAGE 5 : Confrontation (jours en bandes groupées) ---------- */
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
 $('#btn-p5').addEventListener('click', async () => {
  busy($('#btn-p5'), true, 'Génération…');
  try {
    p5Rows = (await api('/api/page5', {method:'POST'})).rows;
    renderP5();
    toast('Confrontation générée : ' + p5Rows.length + ' lignes');
  } catch(e){ toast(esc(e.message), 'err'); $('#out-p5').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-p5'), false);
});
 $('#f5-search').addEventListener('input', debounce(renderP5, 250));
 $('#btn-exp-p5').addEventListener('click', async () => { try { await downloadPost('/api/export_conf', 'confrontation.xlsx', {}); } catch(e){ toast(esc(e.message),'err'); } });

/* ---------- PAGE 6 : Recap ---------- */
let mappingSel = {};
async function loadPrefixes(){
  try {
    const d = await api('/api/prefixes');
    if (!d.prefixes.length){
      $('#out-mapping').innerHTML = '<div class="empty">Importez Planning et/ou Commandes pour générer la correspondance.</div>';
      return;
    }
    let h = '<div class="map-grid">';
    d.prefixes.forEach(p => {
      mappingSel[p.prefix] = p.current;
      h += `<div class="map-item"><span class="mono">« ${esc(p.prefix)}… »</span>
        <select data-prefix="${esc(p.prefix)}">` +
        d.entities.map(e => `<option${e===p.current?' selected':''}>${esc(e)}</option>`).join('') + '</select></div>';
    });
    $('#out-mapping').innerHTML = h + '</div>';
    $$('#out-mapping select').forEach(s => s.addEventListener('change', e => mappingSel[e.target.dataset.prefix] = e.target.value));
  } catch(e){ $('#out-mapping').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
 $('#map-search').addEventListener('input', debounce(() => {
  const s = $('#map-search').value.toLowerCase();
  $$('#out-mapping .map-item').forEach(it => it.style.display = it.textContent.toLowerCase().includes(s) ? '' : 'none');
}, 200));

/* IDs indexés (jamais de nom d'entité dans un sélecteur CSS) */
 $('#p6-taux').innerHTML = ENTITES_MAIN.map((e, i) =>
  `<label>${esc(e)} (%)<input type="number" id="t-${i}" min="0" max="50" step="0.5" value="${$('#inp-taux').value}"></label>`).join('');
 $('#p6-presta').innerHTML = JOURS.map(j => `<label>${j}<input type="number" id="p6prest-${j}" min="0" value="0"></label>`).join('');

function recapBody(){
  return {
    mapping: mappingSel,
    taux: Object.fromEntries(ENTITES_MAIN.map((e, i) => [e, numVal('t-' + i)])),
    presta_prevus: Object.fromEntries(JOURS.map(j => [j, intVal('p6prest-' + j)]))
  };
}
function renderRecap(d){
  let h = '<h3 class="sub">📈 Synthèse de la semaine (repas à préparer)</h3>' + tableHTML(d.summary_rows, {recap:true});
  for (const day of d.day_order){
    const D = d.days[day];
    h += `<div class="day-card">
      <div class="day-header"><span>📅 ${esc(day)}${D.date ? ' · ' + esc(D.date) : ''}</span>
      <span class="dh-right">Semaine ${esc(d.week)}</span></div>
      <div class="day-sub"><span class="big">À commander : <b>${D.a_commander}</b> repas</span>
      <small>(dont ${D.presta} prestataire(s) prévu(s))</small><br>
      À préparer → ${D.entities.map(e => `<b style="color:${e.color}">${esc(e.entity)} : ${e.rows.find(r => r.Choix==='TOTAL')?.['A preparer'] ?? 0}</b>`).join(' &nbsp;•&nbsp; ')}</div>`;
    for (const E of D.entities){
      h += `<div class="entity-row"><div class="entity-badge" style="background:${E.color}">${esc(E.entity)}</div>
        <div class="entity-body"><div class="entity-meta">Planifiés : <b>${E.planned_n}</b> · Réponses : <b>${E.reponses}</b> ·
        Absences déclarées : <b>${E.abs_n}</b> · SANS CHOIX : <b>${E.sans_choix}</b></div>
        ${tableHTML(E.rows, {recap:true})}</div></div>`;
    }
    if (D.warn) h += `<div class="warn">⚠️ ${esc(D.warn)}</div>`;
    h += '</div>';
  }
  if (!d.has_planning) h = '<div class="msg warn">ℹ️ Planning non chargé : SANS CHOIX ne contient que les absences déclarées.</div>' + h;
  $('#out-p6').innerHTML = h;
}
 $('#btn-p6').addEventListener('click', async () => {
  busy($('#btn-p6'), true, 'Calcul…');
  $('#out-p6').innerHTML = '<div class="hint">⏳ Calcul du récapitulatif en cours…</div>';
  try {
    renderRecap(await api('/api/recap', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(recapBody())}));
    toast('Récapitulatif calculé');
  } catch(e){ $('#out-p6').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; toast(esc(e.message), 'err'); }
  busy($('#btn-p6'), false);
});
async function downloadPost(url, filename, body){
  const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  if (!r.ok){ const d = await r.json().catch(()=>({})); throw new Error(d.error || 'Export impossible'); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob()); a.download = filename; a.click();
}
 $('#btn-exp-p6').addEventListener('click', async () => {
  try { await downloadPost('/api/export_recap', 'recap_commandes_menus.xlsx', recapBody()); }
  catch(e){ toast(esc(e.message), 'err'); }
});

/* ---------- PAGE 7 : Anomalies (ordre verrouillé) ---------- */
let p7Rows = null;
function renderP7(){
  if (p7Rows === null) return;
  const rows = orderedRows(searchRows(p7Rows, $('#f7-search').value),
    ['Paid ID','Nom','Projet','Jour',"Type d'anomalie",'Commande']);
  $('#out-p7').innerHTML = rows.length ? tableHTML(rows) : '<div class="msg ok">✅ Aucune anomalie commande.</div>';
}
 $('#btn-p7').addEventListener('click', async () => {
  busy($('#btn-p7'), true, 'Extraction…');
  try {
    p7Rows = (await api('/api/page7', {method:'POST'})).rows;
    renderP7();
    toast(p7Rows.length ? p7Rows.length + ' anomalie(s) détectée(s)' : 'Aucune anomalie 🎉', p7Rows.length ? 'warn' : 'ok');
  } catch(e){ toast(esc(e.message), 'err'); $('#out-p7').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-p7'), false);
});
 $('#f7-search').addEventListener('input', debounce(renderP7, 250));
 $('#btn-exp-p7').addEventListener('click', async () => { try { await downloadPost('/api/export_anom', 'anomalies_commande.xlsx', {}); } catch(e){ toast(esc(e.message),'err'); } });

 $('#btn-matr').addEventListener('click', async () => {
  busy($('#btn-matr'), true, 'Vérification…');
  try {
    const d = await api('/api/matricules');
    let h = '';
    h += d.mismatch.rows.length
      ? `<div class="msg warn">⚠️ ${d.mismatch.rows.length} matricule(s) paie différent(s) entre planning et Liste Actif.</div>` + tableHTML(d.mismatch.rows)
      : '<div class="msg ok">✅ Tous les matricules paie présents dans la Liste Actif correspondent au planning.</div>';
    h += d.notfound.rows.length
      ? `<details class="mt"><summary>ℹ️ ${d.notfound.rows.length} collaborateur(s) introuvable(s) dans la Liste Actif</summary>${tableHTML(d.notfound.rows)}</details>`
      : '';
    $('#out-matr').innerHTML = h;
  } catch(e){ $('#out-matr').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-matr'), false);
});

/* ---------- Init ---------- */
refreshState().then(loadP1).catch(()=>{});
