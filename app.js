const JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const ENTITES = ['PRESTA','SUPPORT + SAI','PROD / PLANIFIÉ PROD','AUTRE / IGNORÉ'];
let mappingSel = {};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function msg(el, text, cls){ el.innerHTML = text ? `<div class="msg ${cls}">${text}</div>` : ''; }
async function api(url, opts = {}){
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
  return data;
}
function tableHTML(rows, recap = false){
  if (!rows || !rows.length) return '<p style="color:#889;font-size:13px">Aucune donnée.</p>';
  const cols = Object.keys(rows[0]);
  let h = '<div style="overflow:auto;max-height:620px"><table class="data"><thead><tr>' +
          cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows){
    let cls = '';
    if (recap){
      const c = String(r['Choix'] ?? '');
      if (c === 'TOTAL') cls = 'total';
      else if (c === 'SANS CHOIX') cls = 'sanschoix';
      else if (c.startsWith('dont ')) cls = 'dont';
    }
    h += `<tr class="${cls}">` + cols.map(c => {
      let v = r[c];
      if (c === 'Pourcentage' && v !== null && v !== undefined && v !== '')
        v = Number(v).toFixed(1).replace('.', ',') + ' %';
      return `<td>${esc(v)}</td>`;
    }).join('') + '</tr>';
  }
  return h + '</tbody></table></div>';
}
function fillSelect(sel, values){
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous</option>' +
    values.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
}
function searchFilter(rows, text){
  if (!text) return rows;
  const s = text.toLowerCase();
  return (rows || []).filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
}

/* ---------- Sidebar ---------- */
 $('#inp-taux').addEventListener('input', e => $('#taux-val').textContent = e.target.value + '%');

 $('#btn-import').addEventListener('click', async () => {
  const fd = new FormData();
  for (const f of $('#inp-planning').files) fd.append('planning', f);
  if ($('#inp-commande').files[0]) fd.append('commande', $('#inp-commande').files[0]);
  if ($('#inp-reference').files[0]) fd.append('reference', $('#inp-reference').files[0]);
  const w = $('#inp-week').value.trim(); if (w) fd.append('week', w);
  msg($('#sidebar-msg'), '⏳ Traitement en cours...', '');
  try {
    const res = await api('/api/import', {method: 'POST', body: fd});
    let t = `✅ Semaine ${res.week} : ${res.n_planifiees} planifiés, ${res.n_commandes} commandes.`;
    if (res.warnings.length) t += ' ⚠️ ' + res.warnings.join(' ; ');
    msg($('#sidebar-msg'), t, 'ok');
    await refreshState();
    loadPage1();
  } catch (e){ msg($('#sidebar-msg'), '❌ ' + e.message, 'err'); }
});

 $('#sel-week').addEventListener('change', async e => {
  await api('/api/select_week', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                 body: JSON.stringify({week: e.target.value})});
  loadPage1();
});
 $('#btn-del-week').addEventListener('click', async () => {
  if (!confirm('Supprimer cette semaine ?')) return;
  await api('/api/delete_week', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                 body: JSON.stringify({week: $('#sel-week').value})});
  await refreshState(); loadPage1();
});

async function refreshState(){
  const s = await api('/api/state');
  $('#sel-week').innerHTML = s.weeks.map(w => `<option${w === s.current_week ? ' selected' : ''}>${esc(w)}</option>`).join('')
    || '<option value="">—</option>';
  $('#sel-week').disabled = !s.weeks.length;
}

/* ---------- Onglets ---------- */
 $$('.tab').forEach(b => b.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); $('#' + b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'p1') loadPage1();
  if (b.dataset.tab === 'p6') loadPrefixes();
}));

/* ---------- Page 1 ---------- */
let page1 = null;
async function loadPage1(){
  try {
    page1 = await api('/api/page1');
    fillSelect($('#f1-transport'), page1.options.TRANSPORT || []);
    fillSelect($('#f1-projet'), page1.options.Projet || []);
    fillSelect($('#f1-statut'), page1.options.Statut || []);
    renderP1();
  } catch (e){ $('#out-p1').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
function renderP1(){
  if (!page1) return;
  let rows = page1.rows;
  const f = {TRANSPORT: $('#f1-transport').value, Projet: $('#f1-projet').value, Statut: $('#f1-statut').value};
  for (const [c, v] of Object.entries(f)) if (v) rows = rows.filter(r => String(r[c]) === v);
  $('#out-p1').innerHTML = tableHTML(searchFilter(rows, $('#f1-search').value));
}
['f1-transport','f1-projet','f1-statut','f1-search'].forEach(id =>
  $('#' + id).addEventListener('input', renderP1));
 $('#btn-exp-p1').addEventListener('click', () => window.open('/api/export_page1', '_blank'));

/* ---------- Page 2 ---------- */
 $('#p2-presta').innerHTML = JOURS.map(j =>
  `<label>${j}<input type="number" id="prest-${j}" min="0" value="0"></label>`).join('');
 $('#btn-p2').addEventListener('click', async () => {
  const p = new URLSearchParams({taux: $('#inp-taux').value, projet: $('#f2-projet').value, statut: $('#f2-statut').value});
  JOURS.forEach(j => p.set('prest_' + j, $('#prest-' + j).value));
  const d = await api('/api/page2?' + p);
  $('#out-p2').innerHTML = tableHTML(d.rows);
  $('#p2-metrics').innerHTML = JOURS.map(j =>
    `<div class="metric"><div class="lbl">${j}</div><div class="val">${d.metrics[j]} pax</div></div>`).join('');
});
api('/api/state').then(s => { /* filtres remplis via page1 */ });

/* ---------- Page 3 ---------- */
 $('#btn-p3').addEventListener('click', async () => {
  const p = new URLSearchParams({transport: $('#f3-transport').value, projet: $('#f3-projet').value, statut: $('#f3-statut').value});
  const d = await api('/api/page3?' + p);
  $('#out-p3').innerHTML = '<h3>Nombre de personnes par Heure de Début</h3>' + tableHTML(d.pivot.rows) +
    `<details><summary>👁️ Liste détaillée par shift</summary>${tableHTML(d.detail.rows)}</details>`;
});
/* remplissage des selects transport/projet/statut des pages 3 et 4 depuis page1 */
async function syncFilterOptions(){
  if (!page1) await loadPage1();
  fillSelect($('#f3-transport'), page1.options.TRANSPORT || []);
  fillSelect($('#f3-projet'), page1.options.Projet || []);
  fillSelect($('#f3-statut'), page1.options.Statut || []);
  fillSelect($('#f4-projet'), page1.options.Projet || []);
  fillSelect($('#f4-statut'), page1.options.Statut || []);
  fillSelect($('#f2-projet'), page1.options.Projet || []);
  fillSelect($('#f2-statut'), page1.options.Statut || []);
}

/* ---------- Page 4 ---------- */
 $('#btn-p4').addEventListener('click', async () => {
  const p = new URLSearchParams({projet: $('#f4-projet').value, statut: $('#f4-statut').value});
  const d = await api('/api/page4?' + p);
  $('#out-p4').innerHTML = '<h3>📊 Pic de présence par projet</h3>' + tableHTML(d.peaks.rows) +
    `<details><summary>🕒 Détail par créneau horaire</summary>${tableHTML(d.slots.rows)}</details>`;
});

/* ---------- Page 5 ---------- */
 $('#btn-p5').addEventListener('click', async () => {
  $('#out-p5').innerHTML = '<div class="msg">⏳ Génération...</div>';
  try {
    const d = await api('/api/page5', {method: 'POST'});
    $('#out-p5').innerHTML = tableHTML(searchFilter(d.rows, $('#f5-search').value));
  } catch (e){ $('#out-p5').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
});
 $('#f5-search').addEventListener('input', async () => { renderP5Again(); });
let p5rows = null;
const _origP5 = $('#btn-p5').onclick;
 $('#btn-p5').addEventListener('click', async () => {
  try { p5rows = (await api('/api/page5', {method: 'POST'})).rows; } catch (e){}
});
function renderP5Again(){
  // re-render local si rows déjà chargées
}
// Simplification : garder référence des rows
let p5Data = null;
 $('#btn-p5').addEventListener('click', async () => {
  try { const d = await api('/api/page5', {method: 'POST'}); p5Data = d.rows;
        $('#out-p5').innerHTML = tableHTML(searchFilter(p5Data, $('#f5-search').value)); } catch (e){}
});
 $('#f5-search').addEventListener('input', () => {
  if (p5Data) $('#out-p5').innerHTML = tableHTML(searchFilter(p5Data, $('#f5-search').value));
});

/* ---------- Page 6 (Recap) ---------- */
async function loadPrefixes(){
  try {
    const d = await api('/api/prefixes');
    let h = '<table class="data"><thead><tr><th>Préfixe</th><th>Entité</th></tr></thead><tbody>';
    for (const p of d.prefixes){
      mappingSel[p.prefix] = p.current;
      h += `<tr><td>« ${esc(p.prefix)}… »</td><td><select data-prefix="${esc(p.prefix)}">` +
        d.entities.map(e => `<option${e === p.current ? ' selected' : ''}>${esc(e)}</option>`).join('') +
        '</select></td></tr>';
    }
    $('#out-mapping').innerHTML = h + '</tbody></table>';
    $$('#out-mapping select').forEach(s => s.addEventListener('change', e => {
      mappingSel[e.target.dataset.prefix] = e.target.value;
    }));
  } catch (e){ $('#out-mapping').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
 $('#p6-taux').innerHTML = ENTITES.slice(0, 3).map(e =>
  `<label>${esc(e)} (%)<input type="number" id="taux-${esc(e)}" min="0" max="50" step="0.5" value="${$('#inp-taux').value}"></label>`).join('');
 $('#p6-presta').innerHTML = JOURS.map(j =>
  `<label>${j}<input type="number" id="p6prest-${j}" min="0" value="0"></label>`).join('');

function recapBody(){
  return {
    mapping: mappingSel,
    taux: Object.fromEntries(ENTITES.slice(0, 3).map(e => [e, parseFloat($('#taux-' + e).value || 0)])),
    presta_prevus: Object.fromEntries(JOURS.map(j => [j, parseInt($('#p6prest-' + j).value || 0)]))
  };
}
function renderRecap(d){
  let h = '<h3>📈 Synthèse de la semaine</h3>' + tableHTML(d.summary_rows, true);
  for (const day of d.day_order){
    const D = d.days[day];
    h += `<div class="day-card">
      <div class="day-header"><span>📅 ${esc(day)}${D.date ? ' ' + esc(D.date) : ''}</span><span style="font-weight:400;font-size:12px;opacity:.85">Semaine ${esc(d.week)}</span></div>
      <div class="day-sub">À commander : <b>${D.a_commander}</b> repas (dont ${D.presta} prestataire(s) prévu(s))<br>
      À préparer → ${D.entities.map(e => `<b style="color:${e.color}">${esc(e.entity)} : ${e.rows.find(r => r.Choix === 'TOTAL')?.['A preparer'] ?? 0}</b>`).join(' • ')}</div>`;
    for (const E of D.entities){
      h += `<div class="entity-row"><div class="entity-badge" style="background:${E.color}">${esc(E.entity)}</div>
        <div class="entity-body"><div class="entity-meta">Planifiés : ${E.planned_n} · Réponses : ${E.reponses} · Absences déclarées : ${E.abs_n} · SANS CHOIX : ${E.sans_choix}</div>
        ${tableHTML(E.rows, true)}</div></div>`;
    }
    if (D.warn) h += `<div class="warn">⚠️ ${esc(D.warn)}</div>`;
    h += '</div>';
  }
  if (!d.has_planning) h = '<div class="msg warn">ℹ️ Planning non chargé : SANS CHOIX ne contient que les absences déclarées.</div>' + h;
  $('#out-p6').innerHTML = h;
}
 $('#btn-p6').addEventListener('click', async () => {
  $('#out-p6').innerHTML = '<div class="msg">⏳ Calcul en cours...</div>';
  try { renderRecap(await api('/api/recap', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(recapBody())})); }
  catch (e){ $('#out-p6').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
});
 $('#btn-exp-p6').addEventListener('click', async () => {
  try {
    const r = await fetch('/api/export_recap', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                                body: JSON.stringify(recapBody())});
    if (!r.ok) throw new Error('Export impossible');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob()); a.download = 'recap_commandes_menus.xlsx'; a.click();
  } catch (e){ alert(e.message); }
});

/* ---------- Page 7 ---------- */
let p7Data = null;
 $('#btn-p7').addEventListener('click', async () => {
  try { p7Data = (await api('/api/page7', {method: 'POST'})).rows;
        $('#out-p7').innerHTML = p7Data.length ? tableHTML(searchFilter(p7Data, $('#f7-search').value))
                                               : '<div class="msg ok">✅ Aucune anomalie commande.</div>'; }
  catch (e){ $('#out-p7').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
});
 $('#f7-search').addEventListener('input', () => {
  if (p7Data) $('#out-p7').innerHTML = tableHTML(searchFilter(p7Data, $('#f7-search').value));
});

/* ---------- Init ---------- */
refreshState().then(() => { loadPage1(); syncFilterOptions(); });