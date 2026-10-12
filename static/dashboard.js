'use strict';
/* ================= ONGLET 9 : DASHBOARD ================= */
const DB = { charts: {}, last: null };
const fmtInt = v => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0}).format(Number(v) || 0);

function dbDestroy(){ Object.values(DB.charts).forEach(c => { try { c.destroy(); } catch(e){} }); DB.charts = {}; }

/* Mêmes seuils que la Synthèse : rouge <98 · orange <99 · vert 99-101 · orange 101-102 · rouge >102 */
function dbQsColor(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '#9db3c0';
  if (n < 98) return '#c0392b';
  if (n < 99) return '#e67e22';
  if (n <= 101) return '#27ae60';
  if (n <= 102) return '#e67e22';
  return '#c0392b';
}

function dbMakeChart(id, label, labels, data, colors, yOpts, tooltipFmt){
  const cv = document.getElementById(id);
  if (!cv || !window.Chart) return;
  if (DB.charts[id]){ try { DB.charts[id].destroy(); } catch(e){} }
  DB.charts[id] = new Chart(cv.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: colors, borderRadius: 6,
                                 maxBarThickness: 52, borderWidth: 1, borderColor: 'rgba(0,0,0,.06)' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { label: c => ` ${label} : ` + (tooltipFmt ? tooltipFmt(c.parsed.y) : c.parsed.y) } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 60, autoSkip: true } },
                y: Object.assign({ beginAtZero: true, grid: { color: 'rgba(0,61,91,.08)' } }, yOpts || {}) }
    }
  });
}

function refreshDbWeeks(weeks){
  const sel = $('#db-week'), cur = sel.value;
  sel.innerHTML = '<option value="">Semaine : toutes</option>' +
    (weeks || []).map(w => `<option${w === cur ? ' selected' : ''}>${esc(w)}</option>`).join('');
}

function renderDashboard(d){
  const k = d.kpis || {};
  const qsTxt = (k.qs === null || k.qs === undefined) ? '—' : String(k.qs).replace('.', ',');
  $('#db-kpis').innerHTML =
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
    $('#out-db').innerHTML = '<div class="msg warn">⚠️ Aucune donnée : générez d\'abord des synthèses mensuelles (onglet 🧾 Synthèse) pour alimenter le dashboard.</div>';
    return;
  }
  const labels = rows.map(r => r.periode);
  const qsData = rows.map(r => (r['QS (%)'] === null || r['QS (%)'] === undefined) ? null : Number(r['QS (%)']));
  const ncData = rows.map(r => Number(r['Non consommé'] || 0));
  const mtData = rows.map(r => Number(r['MONTANT DA MGA HT'] || 0));

  let h = '';
  if (!window.Chart) h += '<div class="msg warn">⚠️ Chart.js non chargé (connexion internet requise). Seuls les KPIs et le tableau sont disponibles.</div>';
  h += '<div class="chart-box"><h3 class="sub">🎯 Qualité de service — QS (%) <small style="color:#889;font-weight:400">(vert 99–101 · orange 98–99 / 101–102 · rouge hors limites)</small></h3><div class="chart-wrap"><canvas id="db-c-qs"></canvas></div></div>';
  h += '<div class="chart-box"><h3 class="sub">🗑️ Nombre de repas non consommés</h3><div class="chart-wrap"><canvas id="db-c-nc"></canvas></div></div>';
  h += '<div class="chart-box"><h3 class="sub">💰 MONTANT DA MGA HT</h3><div class="chart-wrap"><canvas id="db-c-mt"></canvas></div></div>';
  const tblRows = rows.map(r => ({'Période': r.periode, 'Nb jours': r.nb_jours, 'Consommé': r['Consommé'],
    'Commande finale': r['Commande finale'], 'Non consommé': r['Non consommé'],
    'QS (%)': r['QS (%)'], 'MONTANT DA MGA HT': r['MONTANT DA MGA HT']}));
  h += `<details class="mt"><summary>📋 Données des graphiques</summary>${tableHTML(tblRows)}</details>`;
  $('#out-db').innerHTML = h;

  if (window.Chart){
    dbMakeChart('db-c-qs', 'QS (%)', labels, qsData, qsData.map(dbQsColor),
      {beginAtZero: false, suggestedMin: 90, suggestedMax: 105}, v => String(v).replace('.', ',') + ' %');
    dbMakeChart('db-c-nc', 'Non consommé', labels, ncData, ncData.map(() => '#e74c3c'), null, fmtInt);
    dbMakeChart('db-c-mt', 'MONTANT DA MGA HT', labels, mtData, mtData.map(() => '#003D5B'), null, fmtInt);
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
  } catch(e){ $('#out-db').innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`; }
  busy($('#btn-db'), false);
}

on('#db-period', 'change', () => { $('#db-month').disabled = $('#db-period').value === 'mensuel'; loadDashboard(); });
on('#db-month', 'change', loadDashboard);
on('#db-week', 'change', loadDashboard);
on('#btn-db', 'click', loadDashboard);
on('.tab[data-tab="p9"]', 'click', loadDashboard);
on('#btn-exp-db', 'click', () => {
  const period = $('#db-period').value;
  const params = new URLSearchParams({period});
  if (period !== 'mensuel'){
    if ($('#db-month').value) params.set('month', $('#db-month').value);
    if ($('#db-week').value) params.set('week', $('#db-week').value);
  }
  window.open('/api/export_dashboard?' + params, '_blank');
});

/* Valeur par défaut : mois courant */
(function dbInit(){
  const m = $('#db-month');
  if (m && !m.value){
    const n = new Date();
    m.value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
  }
})();
