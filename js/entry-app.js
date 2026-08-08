/* entry-app.js — pagina "Come entrare".
 * Aggrega le statistiche per titolo precalcolate dalla pipeline (entry_*.json)
 * sul portafoglio selezionato, e le confronta sempre con l'universo non
 * filtrato: e il controllo che distingue un effetto reale da un artefatto
 * della selezione. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%');
  const num = (x, d = 2) => (x == null || !isFinite(x) ? '–' : (+x).toFixed(d));
  const cls = (x) => (x >= 0 ? 'pos' : 'neg');
  const BASES = [{ id: 'SP500', label: 'S&P 500' }, { id: 'NYSE', label: 'NYSE' },
    { id: 'NASDAQ', label: 'NASDAQ' }, { id: 'STOXX600', label: 'STOXX 600' }];

  const state = { universe: 'SP500', source: 'oos', sched: 'lump', cond: 'dd', horizon: '3',
    entry: null, portfolio: null, tickers: [], fromUrl: null };

  // mediana: piu robusta della media quando un solo titolo ha una storia estrema
  const med = (a) => {
    const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y);
    if (!v.length) return null;
    const i = (v.length - 1) / 2;
    return v.length % 2 ? v[i] : (v[Math.floor(i)] + v[Math.ceil(i)]) / 2;
  };
  const pick = (list, f) => med(list.map((t) => { const e = state.entry.tickers[t]; return e ? f(e) : null; }));

  const card = (lab, val, cmp, help, kind) =>
    `<div class="kpi${kind ? ' ' + kind : ''}"><div class="lab">${lab}` +
    (help ? ` <span class="info" title="${help}">i</span>` : '') +
    `</div><div class="val">${val}</div><div class="cmp">${cmp || ''}</div></div>`;

  // ---- caricamento ---------------------------------------------------------
  async function load() {
    skeletons();
    let entry, portfolio;
    try {
      [entry, portfolio] = await Promise.all([
        fetch(`data/entry_${state.universe}.json`).then((r) => r.json()),
        fetch(`data/portfolio_${state.universe}.json`).then((r) => r.json()),
      ]);
    } catch (e) {
      $('#verdict').innerHTML = verdictBox('bad', '⚠️', 'Dati non disponibili',
        `Non riesco a caricare l'analisi per <b>${state.universe}</b>. Se stai aprendo il file da disco, servi la cartella via HTTP.`);
      return;
    }
    state.entry = entry; state.portfolio = portfolio;
    $('#updated').textContent = 'agg. ' + new Date(entry.updated).toLocaleDateString('it-IT');
    resolveTickers();
    renderAll();
  }

  /** I titoli da analizzare: quelli passati dallo screener, o la selezione salvata. */
  function resolveTickers() {
    const have = (t) => !!state.entry.tickers[t];
    if (state.fromUrl && state.fromUrl.length) {
      const found = state.fromUrl.filter(have);
      if (found.length >= 2) { state.tickers = found; return; }
    }
    const src = state.source === 'canonical' ? state.portfolio.canonical : state.portfolio.oos;
    state.tickers = (src && src.picks ? src.picks.map((p) => p.t) : []).filter(have);
  }

  // ---- verdetto ------------------------------------------------------------
  const verdictBox = (kind, icon, title, detail) =>
    `<div class="verdict ${kind}"><div class="rule"></div><div>` +
    `<div class="vk">${icon} Verdetto sull'ingresso</div>` +
    `<div class="vt">${title}</div><div class="vd">${detail}</div></div></div>`;

  function aggStrategies(list, sched) {
    const byId = {};
    for (const t of list) {
      const c = state.entry.tickers[t] && state.entry.tickers[t][sched];
      if (!c) continue;
      for (const r of c.r) (byId[r.id] = byId[r.id] || []).push(r);
    }
    return state.entry.strategies.map((s) => {
      const rows = byId[s.id] || [];
      return { id: s.id, label: s.label, n: rows.length,
        medRel: med(rows.map((r) => r.med)), p10: med(rows.map((r) => r.p10)),
        p90: med(rows.map((r) => r.p90)), win: med(rows.map((r) => r.win)),
        tim: med(rows.map((r) => r.tim)), nf: med(rows.map((r) => r.nf)) };
    }).filter((r) => r.n > 0);
  }

  function renderVerdict() {
    const box = $('#verdict');
    if (!state.tickers.length) {
      box.innerHTML = verdictBox('idle', '⏳', 'Nessun titolo da analizzare',
        'La selezione scelta non contiene titoli con storia sufficiente. Prova un altro universo o l\'altra selezione.');
      return;
    }
    const res = aggStrategies(state.tickers, state.sched);
    const waiting = res.filter((r) => r.id !== 'immediate' && r.medRel != null);
    if (!waiting.length) { box.innerHTML = ''; return; }
    const best = waiting.reduce((a, b) => (b.medRel > a.medRel ? b : a));
    const dip = res.find((r) => r.id === 'dip20');
    const schedLab = state.sched === 'lump' ? 'con un capitale unico' : 'con un PAC trimestrale';
    const anyBeats = best.medRel > 1 && best.win > 0.5;
    const detail = `Su <b>${state.tickers.length}</b> titoli e tutte le date di partenza, ${schedLab} ` +
      `la strategia d'attesa migliore è <b>${best.label}</b>: ricchezza finale ` +
      `<b class="${cls(best.medRel - 1)}">${((best.medRel - 1) * 100).toFixed(1)}%</b> rispetto a comprare subito, ` +
      `e batte l'acquisto immediato nel <b>${(best.win * 100).toFixed(0)}%</b> delle partenze` +
      (dip && dip.medRel != null ? `. Aspettare un ribasso del 20% costa <b class="${cls(dip.medRel - 1)}">${((dip.medRel - 1) * 100).toFixed(1)}%</b> ` +
        `e lascia fermo il <b>${((1 - dip.tim) * 100).toFixed(0)}%</b> del capitale` : '') + '.';
    if (anyBeats) {
      box.innerHTML = verdictBox('good', '✅', 'Aspettare ha pagato', detail +
        ' Attenzione: è la strategia migliore <i>ex post</i> fra quelle provate, quindi parte del vantaggio è selezione.');
    } else {
      box.innerHTML = verdictBox('warn', '⚖️', 'Conviene comprare subito', detail +
        ' Nessuna strategia d\'attesa batte l\'acquisto immediato nella maggioranza delle partenze: ' +
        'il ribasso, quando arriva, è un buon momento, ma <b>aspettarlo costa più di quanto renda</b>.');
    }
  }

  // ---- KPI ribassi ---------------------------------------------------------
  function renderDdKpis() {
    const L = state.tickers, U = Object.keys(state.entry.tickers);
    if (!L.length) { $('#kpis-dd').innerHTML = ''; return; }
    const cmpU = (f, fmt) => `universo ${fmt(med(U.map((t) => f(state.entry.tickers[t]))))}`;
    let h = '';
    h += card('Sconto −20%', num(pick(L, (e) => e.freq.d20 && e.freq.d20.gap), 1) + ' anni',
      cmpU((e) => e.freq.d20 && e.freq.d20.gap, (v) => num(v, 1) + ' anni'),
      'Tempo medio fra un ribasso del 20% e il successivo. Se sono anni, "compro sui ribassi" non è un piano.', 'hero');
    h += card('Profondità mediana', pct(pick(L, (e) => e.medDepth), 0),
      cmpU((e) => e.medDepth, (v) => pct(v, 0)), 'Profondità tipica di un episodio di ribasso oltre il 5%.');
    h += card('Tempo sott\'acqua', pct(pick(L, (e) => e.pctUnderwater), 0),
      cmpU((e) => e.pctUnderwater, (v) => pct(v, 0)),
      'Quota di giorni passati sotto il massimo precedente. Su un compounder è quasi sempre alta: è il prezzo psicologico del buy & hold.');
    h += card('Recupero mediano', num(pick(L, (e) => e.medRecovery), 1) + ' anni',
      cmpU((e) => e.medRecovery, (v) => num(v, 1) + ' anni'),
      'Tempo dal minimo al nuovo massimo. Il p90 dice quanto può andare lunga nei casi brutti.');
    $('#kpis-dd').innerHTML = h;
  }

  // ---- confronto strategie -------------------------------------------------
  function renderCompare() {
    const L = state.tickers;
    const res = aggStrategies(L, state.sched);
    const uni = aggStrategies(Object.keys(state.entry.tickers), state.sched);
    const uniById = Object.fromEntries(uni.map((r) => [r.id, r]));
    const starts = med(L.map((t) => {
      const c = state.entry.tickers[t] && state.entry.tickers[t][state.sched]; return c ? c.starts : null; }));
    $('#cmp-n').textContent = `${L.length} titoli · ${starts ? Math.round(starts) : 0} date di partenza ciascuno · ` +
      (state.sched === 'lump' ? 'capitale unico' : 'PAC trimestrale');
    if (!res.length) { $('#cmp-tbl').innerHTML = ''; return; }
    const cols = [['Strategia', 'Quando entra il capitale.'],
      ['Ricchezza vs subito', 'Ricchezza finale mediana rispetto a investire immediatamente, a parità di versamenti.'],
      ['Batte subito', 'Percentuale di date di partenza in cui la strategia finisce sopra l\'acquisto immediato. Sotto il 50% conviene comprare subito.'],
      ['Investito', 'Quota media del capitale disponibile effettivamente esposta al mercato.'],
      ['Mai scattato', 'Partenze in cui il segnale non è mai arrivato: il capitale è rimasto liquido fino alla fine.'],
      ['Universo', 'Stesso calcolo su tutti i titoli eleggibili, non solo sui compounder selezionati. Se l\'effetto c\'è solo qui, è la selezione.']];
    let h = '<thead><tr>' + cols.map(([l, t], i) =>
      `<th scope="col"${i === 0 ? '' : ''} title="${t}">${l}</th>`).join('') + '</tr></thead><tbody>';
    for (const r of res) {
      const u = uniById[r.id];
      const isBase = r.id === 'immediate';
      const rel = isBase ? 0 : (r.medRel - 1);
      h += `<tr><td class="tk">${r.label}${isBase ? ' <span class="muted">(riferimento)</span>' : ''}</td>` +
        `<td class="${isBase ? '' : cls(rel)}"><b>${isBase ? '—' : (rel * 100).toFixed(1) + '%'}</b></td>` +
        `<td class="${isBase ? '' : (r.win > 0.5 ? 'pos' : 'neg')}">${isBase ? '—' : pct(r.win, 0)}</td>` +
        `<td>${pct(r.tim, 0)}</td>` +
        `<td class="${r.nf > 0.05 ? 'neg' : ''}">${r.nf ? pct(r.nf, 0) : '—'}</td>` +
        `<td class="muted">${isBase || !u ? '—' : ((u.medRel - 1) * 100).toFixed(1) + '% · ' + pct(u.win, 0)}</td></tr>`;
    }
    $('#cmp-tbl').innerHTML = h + '</tbody>';
  }

  // ---- forward condizionato ------------------------------------------------
  function renderConditional() {
    const key = state.cond + state.horizon;
    const L = state.tickers, U = Object.keys(state.entry.tickers);
    const sample = L.map((t) => state.entry.tickers[t]).find((e) => e && e.cond && e.cond[key]);
    if (!sample) { $('#cond-tbl').innerHTML = ''; $('#cond-n').textContent = ''; return; }
    const labels = sample.cond[key].b.map((b) => b.l);
    const bucketMed = (list, i, f) => med(list.map((t) => {
      const c = state.entry.tickers[t].cond[key]; return c && c.b[i] ? f(c.b[i]) : null; }));
    const uncond = (list, f) => med(list.map((t) => {
      const c = state.entry.tickers[t].cond[key]; return c && c.u ? f(c.u) : null; }));
    $('#cond-n').textContent = `${L.length} titoli · orizzonte ${state.horizon === '1' ? '1 anno' : state.horizon + ' anni'}`;
    const cols = [['Stato al momento dell\'acquisto', ''],
      ['Rendimento annuo dopo', 'Mediana fra i titoli del portafoglio del rendimento annualizzato nei periodi successivi.'],
      ['Scenario sfavorevole', 'Decimo percentile: quanto è andata male nel 10% dei casi peggiori.'],
      ['Casi in perdita', 'Percentuale di acquisti in quello stato che dopo l\'orizzonte scelto erano in perdita.'],
      ['Osservazioni', 'Giorni di osservazione, fortemente sovrapposti: NON sono osservazioni indipendenti.'],
      ['Universo', 'Stesso calcolo su tutti i titoli eleggibili.']];
    let h = '<thead><tr>' + cols.map(([l, t]) => `<th scope="col" title="${t}">${l}</th>`).join('') + '</tr></thead><tbody>';
    const base = uncond(L, (u) => u.med);
    labels.forEach((l, i) => {
      const m = bucketMed(L, i, (b) => b.med), p10 = bucketMed(L, i, (b) => b.p10);
      const neg = bucketMed(L, i, (b) => b.neg), n = bucketMed(L, i, (b) => b.n);
      const mu = bucketMed(U, i, (b) => b.med);
      const better = m != null && base != null && m > base;
      h += `<tr><td class="tk">${l}</td>` +
        `<td class="${better ? 'pos' : ''}"><b>${pct(m, 1)}</b></td>` +
        `<td class="${p10 < 0 ? 'neg' : ''}">${pct(p10, 1)}</td>` +
        `<td>${pct(neg, 0)}</td><td class="muted">${n == null ? '–' : Math.round(n).toLocaleString('it-IT')}</td>` +
        `<td class="muted">${pct(mu, 1)}</td></tr>`;
    });
    h += `<tr><td class="tk"><b>Indifferente (tutti i giorni)</b></td>` +
      `<td><b>${pct(base, 1)}</b></td><td class="muted">—</td><td class="muted">—</td>` +
      `<td class="muted">${Math.round(uncond(L, (u) => u.n) || 0).toLocaleString('it-IT')}</td>` +
      `<td class="muted">${pct(uncond(U, (u) => u.med), 1)}</td></tr>`;
    $('#cond-tbl').innerHTML = h + '</tbody>';
  }

  // ---- titolo per titolo ---------------------------------------------------
  function renderSingle() {
    const L = state.tickers;
    $('#single-n').textContent = `${L.length} titoli`;
    if (!L.length) { $('#single-tbl').innerHTML = ''; return; }
    const cols = [['Ticker', ''], ['Oggi dai massimi', 'Distanza attuale dal massimo storico.'],
      ['Oggi vs trend', 'Z-score del residuo dal trend log-lineare: negativo = sotto il proprio trend.'],
      ['Prof. mediana', 'Profondità tipica dei ribassi oltre il 5%.'],
      ['Drawdown max', 'Il peggior ribasso mai subito su tutta la storia.'],
      ['Sott\'acqua', 'Quota di tempo passata sotto il massimo precedente.'],
      ['Recupero', 'Tempo mediano dal minimo al nuovo massimo.'],
      ['Attesa −20%', 'Anni medi fra un ribasso del 20% e il successivo.'],
      ['Storia', 'Anni di dati disponibili.']];
    let h = '<thead><tr>' + cols.map(([l, t]) => `<th scope="col" title="${t}">${l}</th>`).join('') + '</tr></thead><tbody>';
    const rows = L.map((t) => Object.assign({ t }, state.entry.tickers[t]))
      .sort((a, b) => (a.ddNow ?? 0) - (b.ddNow ?? 0));
    for (const r of rows) {
      h += `<tr><td class="tk">${r.t}</td>` +
        `<td class="${r.ddNow < -0.05 ? 'neg' : ''}">${pct(r.ddNow, 0)}</td>` +
        `<td class="${r.zNow < 0 ? 'pos' : ''}">${num(r.zNow, 1)}</td>` +
        `<td>${pct(r.medDepth, 0)}</td><td class="neg">${pct(-r.maxDepth, 0)}</td>` +
        `<td>${pct(r.pctUnderwater, 0)}</td><td>${num(r.medRecovery, 1)}a</td>` +
        `<td>${r.freq.d20 && r.freq.d20.gap ? num(r.freq.d20.gap, 1) + 'a' : '–'}</td>` +
        `<td class="muted">${num(r.years, 0)}a</td></tr>`;
    }
    $('#single-tbl').innerHTML = h + '</tbody>';
  }

  // ---- chrome --------------------------------------------------------------
  function renderUniverseSelect() {
    const box = $('#universe-select');
    box.innerHTML = '<span class="muted">Universi:</span>' + BASES.map((b) =>
      `<span class="uchip${state.universe === b.id ? ' on' : ''}" data-u="${b.id}" role="button" tabindex="0">${b.label}</span>`).join('');
    box.querySelectorAll('[data-u]').forEach((el) => {
      const go = () => { state.universe = el.dataset.u; state.fromUrl = null; renderUniverseSelect(); load(); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  function bindSeg(id, key, after) {
    const box = $(id);
    if (!box) return;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      state[key] = btn.dataset.v;
      box.querySelectorAll('button').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      after();
    });
  }

  function skeletons() {
    if (!window.ComaUI) return;
    ComaUI.skeletonCards(4, '#kpis-dd');
    ComaUI.skeletonRows(6, '#cmp-tbl', 6);
    ComaUI.skeletonRows(5, '#cond-tbl', 6);
    ComaUI.skeletonRows(6, '#single-tbl', 9);
  }

  function renderAll() { renderVerdict(); renderDdKpis(); renderCompare(); renderConditional(); renderSingle(); }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('antigravity-theme', t); } catch (e) {}
    const btn = $('#theme-toggle');
    if (btn) { btn.textContent = t === 'light' ? '☾' : '☀'; }
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#fbf7f1' : '#15130f');
  }

  function initCaveat() {
    const full = $('#caveat'), mini = $('#caveat-show');
    let hidden = false;
    try { hidden = localStorage.getItem('coma-caveat-entry') === 'hidden'; } catch (e) {}
    const apply = (h) => { full.hidden = h; mini.hidden = !h; };
    apply(hidden);
    $('#caveat-hide').addEventListener('click', () => {
      apply(true); try { localStorage.setItem('coma-caveat-entry', 'hidden'); } catch (e) {}
    });
    mini.addEventListener('click', () => {
      apply(false); try { localStorage.removeItem('coma-caveat-entry'); } catch (e) {}
    });
  }

  let inited = false;
  function init() {
    if (inited) return;
    inited = true;
    let t = 'light'; try { t = localStorage.getItem('antigravity-theme') || 'light'; } catch (e) {}
    applyTheme(t);
    $('#theme-toggle').addEventListener('click', () =>
      applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
    initCaveat();
    if (window.ComaUI) ComaUI.initTooltips();
    // titoli e universo arrivano dallo screener, se ci si e passati da li
    const q = new URLSearchParams(location.search);
    if (q.get('u') && BASES.some((b) => b.id === q.get('u'))) state.universe = q.get('u');
    if (q.get('t')) state.fromUrl = q.get('t').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    renderUniverseSelect();
    bindSeg('#seg-source', 'source', () => { state.fromUrl = null; resolveTickers(); renderAll(); });
    bindSeg('#seg-sched', 'sched', () => { renderVerdict(); renderCompare(); });
    bindSeg('#seg-cond', 'cond', renderConditional);
    bindSeg('#seg-horizon', 'horizon', renderConditional);
    load();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
