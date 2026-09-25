/* entry-app.js — pagina "Come entrare".
 * Aggrega le statistiche per titolo precalcolate dalla pipeline (entry_*.json)
 * sul portafoglio selezionato, e le confronta sempre con l'universo non
 * filtrato: e il controllo che distingue un effetto reale da un artefatto
 * della selezione. Nessun calcolo nuovo: solo lettura e aggregazione. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const F = window.ComaFmt;
  const pct = (x, d) => F.pct(x, d == null ? 1 : d);
  const num = (x, d) => F.num(x, d == null ? 2 : d);
  const BASES = [{ id: 'SP500', label: 'S&P 500' }, { id: 'NYSE', label: 'NYSE' },
    { id: 'NASDAQ', label: 'NASDAQ' }, { id: 'STOXX600', label: 'STOXX 600' }];

  const state = { universe: 'SP500', source: 'oos', sched: 'lump', cond: 'dd', horizon: '3',
    entry: null, portfolio: null, tickers: [], fromUrl: null, hl: null };

  // mediana: piu robusta della media quando un solo titolo ha una storia estrema
  const med = (a) => {
    const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y);
    if (!v.length) return null;
    const i = (v.length - 1) / 2;
    return v.length % 2 ? v[i] : (v[Math.floor(i)] + v[Math.ceil(i)]) / 2;
  };
  const pick = (list, f) => med(list.map((t) => { const e = state.entry.tickers[t]; return e ? f(e) : null; }));

  const card = (lab, val, ctx, help) =>
    `<div class="kpi"><span class="k">${lab}` +
    (help ? ` <span class="info" title="${help}">i</span>` : '') +
    `</span><span class="v">${val}</span><span class="s">${ctx || ''}</span></div>`;

  const th = (label, tip, opt) => {
    opt = opt || {};
    return `<th scope="col"${opt.r ? ' class="r"' : ''} title="${tip || ''}">${label}</th>`;
  };

  /** Le forme dei badge di stato: si distinguono anche senza colore. */
  function stIcon(kind) {
    const s = (inner) => '<svg viewBox="0 0 12 12" aria-hidden="true">' + inner + '</svg>';
    if (kind === 'watch') return s('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/>');
    if (kind === 'setup') return s('<path d="M6 1.5 L11 10.5 L1 10.5 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>');
    if (kind === 'trig') return s('<path d="M6 10.5 L1 1.5 L11 1.5 Z" fill="currentColor"/>');
    return s('<rect x="2" y="5" width="8" height="2" fill="currentColor"/>');
  }

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
      $('#verdict').innerHTML = '<div class="verdict"><div class="vhead">' +
        '<span class="st st-fail">' + stIcon('fail') + 'Dati non disponibili</span></div>' +
        `<div class="vtext">Non riesco a caricare l’analisi per <b>${state.universe}</b>. ` +
        'Se stai aprendo il file da disco, servi la cartella via HTTP.</div></div>';
      return;
    }
    state.entry = entry; state.portfolio = portfolio;
    setDataDate(entry.updated);
    resolveTickers();
    renderAll();
  }

  /** Data dei dati e badge di freschezza nella barra comandi. */
  function setDataDate(updated) {
    const el = $('#updated'), fr = $('#fresh'), gen = $('#gen-date');
    if (el) el.textContent = updated ? F.date(updated) : F.DASH;
    if (gen) gen.textContent = updated ? F.date(updated) : F.DASH;
    if (!fr || !updated) return;
    const giorni = Math.floor((Date.now() - new Date(updated).getTime()) / 86400000);
    fr.className = 'fresh ' + (giorni <= 9 ? 'ok' : giorni <= 21 ? 'late' : 'stale');
    fr.textContent = giorni <= 9 ? 'AGGIORNATO' : giorni + ' GIORNI FA';
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
    const box = $('#verdict'), meta = $('#verdict-meta');
    if (meta) meta.textContent = state.tickers.length
      ? `${state.tickers.length} titoli · ${state.sched === 'lump' ? 'capitale unico' : 'PAC trimestrale'}` : '';
    const paint = (stClass, icon, title, detail) =>
      `<div class="verdict"><div class="vhead"><span class="st ${stClass}">${stIcon(icon)}${title}</span></div>` +
      `<div class="vtext">${detail}</div></div>`;

    if (!state.tickers.length) {
      box.innerHTML = paint('st-cool', 'normal', 'Nessun titolo da analizzare',
        'La selezione scelta non contiene titoli con storia sufficiente. Prova un altro universo o l’altra selezione.');
      return;
    }
    const res = aggStrategies(state.tickers, state.sched);
    const waiting = res.filter((r) => r.id !== 'immediate' && r.medRel != null);
    if (!waiting.length) { box.innerHTML = ''; return; }
    const best = waiting.reduce((a, b) => (b.medRel > a.medRel ? b : a));
    const dip = res.find((r) => r.id === 'dip20');
    const schedLab = state.sched === 'lump' ? 'con un capitale unico' : 'con un PAC trimestrale';
    const anyBeats = best.medRel > 1 && best.win > 0.5;
    const detail = `Su <b class="num">${state.tickers.length}</b> titoli e tutte le date di partenza, ${schedLab} ` +
      `la strategia d’attesa migliore è <b>${best.label}</b>: ricchezza finale ${F.delta(best.medRel - 1)} ` +
      `rispetto a comprare subito, e batte l’acquisto immediato nel <b class="num">${pct(best.win, 0)}</b> delle partenze` +
      (dip && dip.medRel != null
        ? `. Aspettare un ribasso del 20% costa ${F.delta(dip.medRel - 1)} e lascia fermo il <b class="num">${pct(1 - dip.tim, 0)}</b> del capitale`
        : '') + '.';
    if (anyBeats) {
      box.innerHTML = paint('st-trig', 'trig', 'Aspettare ha pagato', detail +
        ' Attenzione: è la strategia migliore <i>ex post</i> fra quelle provate, quindi parte del vantaggio è selezione.');
    } else {
      box.innerHTML = paint('st-watch', 'watch', 'Conviene comprare subito', detail +
        ' Nessuna strategia d’attesa batte l’acquisto immediato nella maggioranza delle partenze: ' +
        'il ribasso, quando arriva, è un buon momento, ma <b>aspettarlo costa più di quanto renda</b>.');
    }
  }

  // ---- KPI ribassi ---------------------------------------------------------
  function renderDdKpis() {
    const L = state.tickers, U = Object.keys(state.entry.tickers);
    if (!L.length) { $('#kpis-dd').innerHTML = ''; return; }
    const cmpU = (f, fmt) => `universo ${fmt(med(U.map((t) => f(state.entry.tickers[t]))))}`;
    let h = '';
    h += card('Attesa di uno sconto del 20%', F.years(pick(L, (e) => e.freq.d20 && e.freq.d20.gap)),
      cmpU((e) => e.freq.d20 && e.freq.d20.gap, (v) => F.years(v)),
      'Tempo medio fra un ribasso del 20% e il successivo. Se sono anni, comprare sui ribassi non è un piano.');
    h += card('Profondità mediana', pct(pick(L, (e) => e.medDepth), 0),
      cmpU((e) => e.medDepth, (v) => pct(v, 0)), 'Profondità tipica di un episodio di ribasso oltre il 5%.');
    h += card('Tempo sotto il massimo', pct(pick(L, (e) => e.pctUnderwater), 0),
      cmpU((e) => e.pctUnderwater, (v) => pct(v, 0)),
      'Quota di giorni passati sotto il massimo precedente. Su un compounder è quasi sempre alta: è il prezzo psicologico del buy and hold.');
    h += card('Recupero mediano', F.years(pick(L, (e) => e.medRecovery)),
      cmpU((e) => e.medRecovery, (v) => F.years(v)),
      'Tempo dal minimo al nuovo massimo.');
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
    $('#cmp-n').textContent = `${L.length} titoli · ${starts ? Math.round(starts) : 0} date di partenza ciascuno`
      + ` · ${state.sched === 'lump' ? 'capitale unico' : 'PAC trimestrale'}`;
    if (!res.length) { $('#cmp-tbl').innerHTML = ''; return; }
    let h = '<thead><tr>' +
      th('Strategia', 'Quando entra il capitale.') +
      th('Ricchezza vs subito', 'Ricchezza finale mediana rispetto a investire immediatamente, a parità di versamenti.', { r: 1 }) +
      th('Batte subito', 'Percentuale di date di partenza in cui la strategia finisce sopra l’acquisto immediato. Sotto il 50% conviene comprare subito.') +
      th('Investito', 'Quota media del capitale disponibile effettivamente esposta al mercato.', { r: 1 }) +
      th('Mai scattato', 'Partenze in cui il segnale non è mai arrivato: il capitale è rimasto liquido fino alla fine.', { r: 1 }) +
      th('Universo', 'Stesso calcolo su tutti i titoli eleggibili, non solo sui compounder selezionati. Se l’effetto c’è solo qui, è la selezione.', { r: 1 }) +
      '</tr></thead><tbody>';
    for (const r of res) {
      const u = uniById[r.id];
      const isBase = r.id === 'immediate';
      const rel = isBase ? 0 : r.medRel - 1;
      const w = r.win == null ? 0 : r.win * 100;
      const bullet = isBase ? F.DASH
        : `<span class="cellv num">${pct(r.win, 0)}</span>` +
          `<span class="bullet${w > 50 ? ' below' : ''}"><span class="zone" style="width:50%"></span>` +
          `<i style="width:${w.toFixed(1)}%"></i><span class="tick" style="left:calc(50% - 1px)"></span></span>`;
      h += `<tr data-sym="${r.id}"><td><span class="sym">${r.label}</span>` +
        (isBase ? '<span class="nm">riferimento</span>' : '') + '</td>' +
        `<td class="num r">${isBase ? F.DASH : F.delta(rel)}</td>` +
        `<td>${bullet}</td>` +
        `<td class="num r">${pct(r.tim, 0)}</td>` +
        `<td class="num r">${r.nf ? pct(r.nf, 0) : F.DASH}</td>` +
        `<td class="num r muted">${isBase || !u ? F.DASH : F.signedPct(u.medRel - 1) + ' · ' + pct(u.win, 0)}</td></tr>`;
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
    let h = '<thead><tr>' +
      th('Stato al momento dell’acquisto', '') +
      th('Rendimento annuo dopo', 'Mediana fra i titoli del portafoglio del rendimento annualizzato nei periodi successivi.', { r: 1 }) +
      th('Scenario sfavorevole', 'Decimo percentile: quanto è andata male nel 10% dei casi peggiori.', { r: 1 }) +
      th('Casi in perdita', 'Percentuale di acquisti in quello stato che dopo l’orizzonte scelto erano in perdita.', { r: 1 }) +
      th('Osservazioni', 'Giorni di osservazione, fortemente sovrapposti: NON sono osservazioni indipendenti.', { r: 1 }) +
      th('Universo', 'Stesso calcolo su tutti i titoli eleggibili.', { r: 1 }) +
      '</tr></thead><tbody>';
    const base = uncond(L, (u) => u.med);
    labels.forEach((l, i) => {
      const m = bucketMed(L, i, (b) => b.med), p10 = bucketMed(L, i, (b) => b.p10);
      const neg = bucketMed(L, i, (b) => b.neg), n = bucketMed(L, i, (b) => b.n);
      const mu = bucketMed(U, i, (b) => b.med);
      const better = m != null && base != null && m > base;
      h += `<tr><td>${l}</td>` +
        `<td class="num r"${better ? ' style="color:var(--ink)"' : ''}><b>${pct(m, 1)}</b></td>` +
        `<td class="num r">${F.signedPct(p10, 1)}</td>` +
        `<td class="num r">${pct(neg, 0)}</td>` +
        `<td class="num r muted">${n == null ? F.DASH : Math.round(n).toLocaleString('it-IT')}</td>` +
        `<td class="num r muted">${pct(mu, 1)}</td></tr>`;
    });
    h += '<tr class="bench"><td><b>Indifferente (tutti i giorni)</b></td>' +
      `<td class="num r"><b>${pct(base, 1)}</b></td><td class="num r">${F.DASH}</td><td class="num r">${F.DASH}</td>` +
      `<td class="num r">${Math.round(uncond(L, (u) => u.n) || 0).toLocaleString('it-IT')}</td>` +
      `<td class="num r">${pct(uncond(U, (u) => u.med), 1)}</td></tr>`;
    $('#cond-tbl').innerHTML = h + '</tbody>';
  }

  // ---- titolo per titolo ---------------------------------------------------
  function renderSingle() {
    const L = state.tickers;
    $('#single-n').textContent = `${L.length} titoli`;
    if (!L.length) { $('#single-tbl').innerHTML = ''; return; }
    let h = '<thead><tr>' +
      th('Titolo', '') +
      th('Oggi dai massimi', 'Distanza attuale dal massimo storico.', { r: 1 }) +
      th('Oggi vs trend', 'Z-score del residuo dal trend logaritmico: negativo significa sotto il proprio trend.', { r: 1 }) +
      th('Prof. mediana', 'Profondità tipica dei ribassi oltre il 5%.', { r: 1 }) +
      th('Drawdown max', 'Il peggior ribasso mai subito su tutta la storia.', { r: 1 }) +
      th('Sotto il massimo', 'Quota di tempo passata sotto il massimo precedente.', { r: 1 }) +
      th('Recupero', 'Tempo mediano dal minimo al nuovo massimo.', { r: 1 }) +
      th('Attesa −20%', 'Anni medi fra un ribasso del 20% e il successivo.', { r: 1 }) +
      th('Storia', 'Anni di dati disponibili.', { r: 1 }) +
      '</tr></thead><tbody>';
    const rows = L.map((t) => Object.assign({ t }, state.entry.tickers[t]))
      .sort((a, b) => (a.ddNow ?? 0) - (b.ddNow ?? 0));
    for (const r of rows) {
      h += `<tr data-sym="${r.t}"${state.hl === r.t ? ' class="sel"' : ''}>` +
        `<td><span class="sym">${r.t}</span></td>` +
        `<td class="num r">${F.signedPct(r.ddNow, 0)}</td>` +
        `<td class="num r">${F.signed(r.zNow, 1)}</td>` +
        `<td class="num r">${pct(r.medDepth, 0)}</td>` +
        `<td class="num r down">${pct(-r.maxDepth, 0)}</td>` +
        `<td class="num r">${pct(r.pctUnderwater, 0)}</td>` +
        `<td class="num r">${F.years(r.medRecovery)}</td>` +
        `<td class="num r">${r.freq.d20 && r.freq.d20.gap ? F.years(r.freq.d20.gap) : F.DASH}</td>` +
        `<td class="num r muted">${F.years(r.years, 0)}</td></tr>`;
    }
    $('#single-tbl').innerHTML = h + '</tbody>';
  }

  // ---- cornice -------------------------------------------------------------
  function renderUniverseSelect() {
    const box = $('#universe-select');
    box.innerHTML = '<span>Universi</span><div class="seg" role="group" aria-label="Universo da analizzare">' +
      BASES.map((b) => `<button type="button" data-u="${b.id}" aria-pressed="${state.universe === b.id}">${b.label.toUpperCase()}</button>`).join('') +
      '</div>';
    box.querySelectorAll('[data-u]').forEach((el) => el.addEventListener('click', () => {
      state.universe = el.dataset.u; state.fromUrl = null; renderUniverseSelect(); load();
    }));
  }

  function bindSeg(id, key, after) {
    const box = $(id);
    if (!box) return;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      state[key] = btn.dataset.v;
      box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
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

  function applyCvd(on) {
    document.getElementById('term').classList.toggle('cvd', on);
    const btn = $('#cvd-toggle');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    try { localStorage.setItem('coma-cvd', on ? '1' : '0'); } catch (e) {}
  }
  function initCvd() {
    let on = false;
    try { on = localStorage.getItem('coma-cvd') === '1'; } catch (e) {}
    applyCvd(on);
    $('#cvd-toggle').addEventListener('click', () =>
      applyCvd($('#cvd-toggle').getAttribute('aria-pressed') !== 'true'));
  }

  function initHelp() {
    const dlg = $('#help-dlg'), opener = $('#btn-help');
    if (!dlg || !opener) return;
    opener.addEventListener('click', () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
    $('#help-close').addEventListener('click', () => {
      if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
      opener.focus();
    });
    dlg.addEventListener('close', () => opener.focus());
  }

  /** Barra comandi: un ticker del portafoglio lo evidenzia, GUIDA apre la guida. */
  function initCommand() {
    const form = $('#cmd-form'), input = $('#cmd-input');
    if (!form || !input) return;
    const base = input.placeholder;
    let timer = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (input.value || '').trim().toUpperCase();
      if (!q) return;
      input.value = '';
      if (q === 'GUIDA' || q === 'HELP') { $('#btn-help').click(); return; }
      if (state.tickers.indexOf(q) < 0) {
        form.classList.add('err');
        input.placeholder = q + ' non è nel portafoglio analizzato';
        clearTimeout(timer);
        timer = setTimeout(() => { form.classList.remove('err'); input.placeholder = base; }, 4000);
        return;
      }
      state.hl = q;
      renderSingle();
      const el = $('#single-tbl [data-sym="' + q + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  let inited = false;
  function init() {
    if (inited) return;
    inited = true;
    initCvd();
    initHelp();
    initCommand();
    if (window.ComaUI) ComaUI.initTooltips();
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
