/* app.js — UI explorer coma-screener · multi-universo (unione), IS+OOS live */
(function () {
  'use strict';
  const E = window.ComaEngine, CH = window.ComaCharts, LIVE = window.ComaLive;
  const $ = (s) => document.querySelector(s);
  const pct = (x, d = 1) => (x == null || isNaN(x) ? '–' : (x * 100).toFixed(d) + '%');
  const num = (x, d = 2) => (x == null || isNaN(x) ? '–' : (+x).toFixed(d));
  const cls = (x) => (x >= 0 ? 'pos' : 'neg');
  const wKey = { equal: 'wEqual', invvol: 'wInvvol', resampled: 'wResampled' };
  const schemeLabel = { equal: 'Equipeso', invvol: 'Risk-parity', resampled: 'Max-Sharpe' };

  // basi selezionabili + priorita benchmark (la prima selezionata fa da bench)
  const BASES = [
    { id: 'SP500', label: 'S&P 500' },
    { id: 'NYSE', label: 'NYSE' },
    { id: 'NASDAQ', label: 'NASDAQ' },
    { id: 'STOXX600', label: 'STOXX 600' },
  ];
  const BENCH_PRIORITY = ['SP500', 'NYSE', 'NASDAQ', 'STOXX600'];
  const PRESETS = [
    { label: 'Tutti USA', set: ['SP500', 'NYSE', 'NASDAQ'] },
    { label: 'USA + Europa', set: ['SP500', 'NYSE', 'NASDAQ', 'STOXX600'] },
  ];

  const DEFAULT_T = { minYears: 15, tolerance5y: -0.05, minR2: 0.90, minCagr: 0.10, maxDD: -0.45, topN: 20 };
  const T = { ...DEFAULT_T };
  let state = { universes: ['SP500'], loaded: {}, merged: null, params: null, benchmarks: null,
    live: null, oos: null, period: 'oos', scheme: 'equal', mode: 'rebal',
    sortKey: 'quality', sortDir: -1, basket: new Set(), build: null, lastScreen: [] };

  // benchmark più congruente alla selezione di universi
  function chooseBenchmark(unis) {
    const eu = unis.includes('STOXX600');
    const us = unis.filter((u) => ['SP500', 'NYSE', 'NASDAQ'].includes(u));
    if (eu && us.length) return { sym: 'ACWI', label: 'MSCI ACWI (mondo)' };
    if (eu) return { sym: '^STOXX', label: 'STOXX Europe 600' };
    if (us.length === 1) return { SP500: { sym: '^GSPC', label: 'S&P 500' },
      NASDAQ: { sym: '^IXIC', label: 'NASDAQ Composite' }, NYSE: { sym: '^NYA', label: 'NYSE Composite' } }[us[0]];
    return { sym: '^GSPC', label: 'S&P 500 (proxy USA)' };
  }

  // spiegazioni mostrate al passaggio del mouse (attributi title)
  const TIPS = {
    SP500: 'Le ~500 maggiori aziende quotate USA (indice S&P 500).',
    NYSE: 'Titoli quotati al New York Stock Exchange (~2300).',
    NASDAQ: 'Titoli quotati al NASDAQ (~4000), forte presenza tech.',
    STOXX600: 'Maggiori aziende europee (subset dello STOXX Europe 600).',
    preset0: 'Seleziona insieme S&P 500 + NYSE + NASDAQ.',
    preset1: 'Seleziona tutti gli universi: USA + Europa.',
    oos: 'Out-of-sample: selezione fatta su dati passati (fino a ~7 anni fa) e testata sul periodo successivo. È il risultato più onesto.',
    insample: 'In-sample: selezione e test sullo stesso intero storico. Sempre ottimistico (circolare): usalo solo come riferimento.',
    equal: 'Equipeso: stesso peso a ogni titolo (1/N). Il più robusto, nessuna stima richiesta.',
    invvol: 'Risk-parity: peso inversamente proporzionale alla volatilità, così ogni titolo contribuisce ugualmente al rischio.',
    resampled: 'Max-Sharpe: ottimizza il rapporto rischio/rendimento (resampled, block bootstrap). Cerca i pesi migliori ma concentra di più.',
    rebal: 'Pesi mantenuti costanti nel tempo (ribilanciamento periodico).',
    buyhold: 'Comprato una volta e lasciato correre: i pesi driftano. Coerente con la tesi "compra e dimentica".',
    minYears: 'Anni minimi di quotazione richiesti: esclude i titoli troppo giovani.',
    tolerance5y: 'Perdita massima tollerata sul peggior quinquennio mobile (0% = mai negativo su 5 anni).',
    minR2: 'Quanto la curva di prezzo (scala log) è vicina a una retta: più alto = crescita più regolare.',
    minCagr: 'Rendimento annuo composto minimo richiesto.',
    maxDD: 'Massima caduta dai massimi tollerata: più stretto = più difensivo.',
    topN: 'Quanti titoli compongono il portafoglio (i migliori per Quality).',
    // intestazioni colonne
    t: 'Simbolo (ticker) del titolo.',
    w: 'Quota nel portafoglio secondo lo schema di pesi selezionato.',
    quality: 'Coma Quality Score: media dei percentili di R², Min 5Y e MAR (0–1, più alto = meglio).',
    cagr: 'CAGR: rendimento annuo composto storico.',
    vol: 'Volatilità annualizzata dei rendimenti.',
    mdd: 'Massima caduta dai massimi storici (drawdown).',
    min5y: 'Rendimento del peggior quinquennio mobile (negativo = ha perso su 5 anni).',
    r2: 'Regolarità della crescita: linearità della curva log-prezzo.',
    reg: 'Regolarità: deviazione tipica dal trend (più bassa = curva più liscia). Indipendente dalla crescita.',
    mar: 'MAR: CAGR diviso il massimo drawdown (rendimento per unità di sofferenza).',
    sortino: 'Sortino: rendimento corretto per la sola volatilità negativa.',
  };

  const CTRLS = [
    { k: 'minYears', label: 'Storia minima', min: 5, max: 30, step: 1, fmt: (v) => v + ' anni' },
    { k: 'tolerance5y', label: 'Tolleranza 5Y', min: -0.30, max: 0, step: 0.01, fmt: (v) => pct(v, 0) },
    { k: 'minR2', label: 'R² minimo', min: 0.70, max: 0.99, step: 0.01, fmt: (v) => num(v, 2) },
    { k: 'minCagr', label: 'CAGR minimo', min: 0, max: 0.25, step: 0.01, fmt: (v) => pct(v, 0) },
    { k: 'maxDD', label: 'Max Drawdown', min: -0.80, max: -0.20, step: 0.05, fmt: (v) => pct(v, 0) },
    { k: 'topN', label: 'Numero titoli', min: 5, max: 40, step: 1, fmt: (v) => v },
  ];

  // ---- caricamento + merge -------------------------------------------------
  async function loadBase(u) {
    if (state.loaded[u]) return state.loaded[u];
    const [m, c] = await Promise.all([
      fetch(`data/metrics_${u}.json`).then((r) => r.json()),
      fetch(`data/curves_${u}.json`).then((r) => r.json()),
    ]);
    state.loaded[u] = { metrics: m, curves: c };
    return state.loaded[u];
  }

  async function loadAndMerge() {
    const sel = state.universes;
    let datasets;
    try { datasets = await Promise.all(sel.map(loadBase)); }
    catch (e) { $('#kpis').innerHTML = `<div class="kpi"><div class="lab">Errore</div><div class="val" style="font-size:14px">Dati non disponibili</div></div>`; return; }

    // merge righe (dedup per ticker, prima occorrenza) + curve
    const rowMap = new Map(), series = {};
    let updated = null;
    datasets.forEach((d) => {
      d.metrics.rows.forEach((r) => { if (!rowMap.has(r.t)) rowMap.set(r.t, r); });
      for (const t in d.curves.series) if (!series[t]) series[t] = d.curves.series[t];
      if (!updated || d.metrics.updated > updated) updated = d.metrics.updated;
    });
    const rows = [...rowMap.values()];
    E.addQualityScore(rows); // Quality ricalcolato sull'insieme combinato

    // benchmark più congruente alla selezione
    const bm = chooseBenchmark(state.universes);
    const fallbackU = BENCH_PRIORITY.find((u) => sel.includes(u)) || sel[0];
    const benchCurve = (state.benchmarks && state.benchmarks.series[bm.sym])
      || state.loaded[fallbackU].curves.bench || null;

    state.params = datasets[0].metrics.params;
    state.merged = {
      metrics: { rows, count: rows.length, updated },
      curves: { series, bench: benchCurve },
      benchLabel: bm.label,
    };
    $('#updated').textContent = 'agg. ' + (updated ? new Date(updated).toLocaleDateString('it-IT') : '—');
    recomputeLive(); recomputeOOS(); renderAll();
  }

  function recomputeLive() {
    state.live = LIVE.recompute(state.merged.metrics, state.merged.curves, T, { ...state.params, nSim: 150 });
  }
  function recomputeOOS() {
    state.oos = LIVE.recomputeOOS(state.merged.curves, T, { ...state.params, nSim: 150 });
  }

  function currentBacktest() {
    if (state.period === 'oos') return state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    return state.live && !state.live.insufficient ? state.live.backtest : null;
  }

  // ---- render --------------------------------------------------------------
  function renderUniverseSelect() {
    const box = $('#universe-select');
    let h = '<span class="muted" style="font-size:12px;margin-right:4px">Universi:</span>';
    h += BASES.map((b) => `<span class="uchip${state.universes.includes(b.id) ? ' on' : ''}" data-u="${b.id}" title="${TIPS[b.id]}">${b.label}</span>`).join('');
    h += '<span class="usep"></span>';
    h += PRESETS.map((p, i) => `<button class="upreset" data-preset="${i}" title="${TIPS['preset' + i]}">${p.label}</button>`).join('');
    box.innerHTML = h;
    box.querySelectorAll('[data-u]').forEach((el) => el.addEventListener('click', () => toggleUniverse(el.dataset.u)));
    box.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('click', () => setUniverses(PRESETS[+el.dataset.preset].set)));
  }

  function toggleUniverse(u) {
    const set = new Set(state.universes);
    if (set.has(u)) { if (set.size > 1) set.delete(u); } else set.add(u);
    setUniverses([...set]);
  }
  function setUniverses(list) {
    if (!list.length) return;
    state.universes = BASES.map((b) => b.id).filter((id) => list.includes(id)); // ordine stabile
    state.basket.clear();
    renderUniverseSelect();
    $('#kpis').innerHTML = '<div class="kpi"><div class="lab">…</div><div class="val" style="font-size:14px">carico universi…</div></div>';
    loadAndMerge();
  }

  function renderKpis() {
    const box = $('#kpis');
    const insB = state.live && !state.live.insufficient ? state.live.backtest : null;
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    const im = insB && insB.schemes[state.scheme] && insB.schemes[state.scheme].metrics;
    const om = oosB && oosB.schemes[state.scheme] && oosB.schemes[state.scheme].metrics;
    const card = (lab, val, cmp) => `<div class="kpi"><div class="lab">${lab}</div><div class="val">${val}</div><div class="cmp">${cmp || ''}</div></div>`;
    let html = '';
    if (om) {
      const edge = om.rebal.cagr - (oosB.benchMetrics ? oosB.benchMetrics.cagr : 0);
      html += card('CAGR Out-of-sample', pct(om.rebal.cagr),
        `bench ${pct(oosB.benchMetrics && oosB.benchMetrics.cagr)} · edge <b class="${cls(edge)}">${pct(edge, 1)}</b>`);
      html += card('Sharpe OOS', num(om.rebal.sharpe), `MaxDD ${pct(om.rebal.mdd, 0)}`);
    } else html += card('Out-of-sample', 'n/d', 'titoli insufficienti per la validazione');
    if (im) {
      const edge = im.rebal.cagr - (insB.benchMetrics ? insB.benchMetrics.cagr : 0);
      html += card('CAGR In-sample', pct(im.rebal.cagr),
        `bench ${pct(insB.benchMetrics && insB.benchMetrics.cagr)} · edge <b class="${cls(edge)}">${pct(edge, 1)}</b> · ottimistico`);
      html += card('Sharpe In-sample', num(im.rebal.sharpe), `MaxDD ${pct(im.rebal.mdd, 0)}`);
    }
    box.innerHTML = html;
  }

  function renderBacktest() {
    const blk = currentBacktest();
    const benchLabel = state.merged ? state.merged.benchLabel : '';
    const bn = $('#bench-name'); if (bn) bn.textContent = benchLabel ? 'Benchmark: ' + benchLabel : '';
    if (!blk || !blk.schemes[state.scheme]) { CH.renderEquity([], { port: [], label: '–' }); CH.renderDrawdown([], [], null); return; }
    const sc = blk.schemes[state.scheme];
    const port = state.mode === 'buyhold' ? sc.buyhold : sc.rebal;
    const label = `Coma · ${schemeLabel[state.scheme]}`;
    CH.renderEquity(blk.months, { port, bench: blk.bench, label, benchLabel });
    CH.renderDrawdown(blk.months, port, blk.bench);
  }

  function renderPortfolio() {
    const live = state.live;
    if (!live || live.insufficient || !live.picks.length) {
      $('#port-n').textContent = '';
      $('#port-tbl').innerHTML = '<tr><td>Soglie troppo restrittive o storia comune insufficiente.</td></tr>';
      return;
    }
    const wk = wKey[state.scheme];
    const picks = live.picks.slice().sort((a, b) => b[wk] - a[wk]);
    $('#port-n').textContent = `${picks.length} titoli · ${schemeLabel[state.scheme]}` +
      (state.scheme === 'resampled' ? ` · ${live.scenarios} scenari` : '') +
      (live.dropped ? ` · ${live.dropped} senza curva` : '');
    const maxW = Math.max(...picks.map((x) => x[wk]));
    const ph = [['t', 'Ticker'], ['w', 'Peso'], ['quality', 'Quality'], ['cagr', 'CAGR'], ['mdd', 'MaxDD'], ['min5y', 'Min 5Y'], ['r2', 'R²'], ['reg', 'Reg.']];
    let h = '<tr>' + ph.map(([k, l]) => `<th title="${TIPS[k]}">${l}</th>`).join('') + '</tr>';
    for (const x of picks) {
      h += `<tr><td class="tk">${x.t}</td>` +
        `<td><span class="wbar" style="width:${(x[wk] / maxW * 46).toFixed(0)}px"></span>${pct(x[wk])}</td>` +
        `<td>${num(x.quality, 2)}</td>` +
        `<td class="${cls(x.cagr)}">${pct(x.cagr, 0)}</td>` +
        `<td class="neg">${pct(x.mdd, 0)}</td>` +
        `<td class="${cls(x.min5y)}">${pct(x.min5y, 0)}</td>` +
        `<td>${num(x.r2, 3)}</td><td>${pct(x.reg, 0)}</td></tr>`;
    }
    $('#port-tbl').innerHTML = h;
  }

  function renderScreenCtrls() {
    let h = '';
    for (const c of CTRLS) {
      h += `<div class="ctrl" title="${TIPS[c.k]}"><label>${c.label} <b id="lbl-${c.k}">${c.fmt(T[c.k])}</b></label>` +
        `<input type="range" id="rng-${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${T[c.k]}"></div>`;
    }
    $('#screen-ctrls').innerHTML = h;
    for (const c of CTRLS) {
      $('#rng-' + c.k).addEventListener('input', (e) => {
        T[c.k] = +e.target.value; $('#lbl-' + c.k).textContent = c.fmt(T[c.k]);
        renderScreenTable(); scheduleLive();
      });
    }
  }

  function resetFilters() {
    Object.assign(T, DEFAULT_T);
    for (const c of CTRLS) {
      const el = $('#rng-' + c.k);
      if (el) { el.value = T[c.k]; $('#lbl-' + c.k).textContent = c.fmt(T[c.k]); }
    }
    state.sortKey = 'quality'; state.sortDir = -1;
    renderScreenTable();
    recomputeLive(); recomputeOOS();
    renderPortfolio(); renderKpis(); renderBacktest(); renderBasket();
  }

  let liveTimer = null;
  function scheduleLive() {
    clearTimeout(liveTimer);
    $('#port-n').textContent = 'ricalcolo…';
    liveTimer = setTimeout(() => {
      recomputeLive(); recomputeOOS();
      renderPortfolio(); renderKpis(); renderBacktest(); renderBasket();
    }, 200);
  }

  function renderScreenTable() {
    if (!state.merged) return;
    const res = E.screen(state.merged.metrics.rows, { ...T, ppy: 252, sortBy: state.sortKey });
    if (state.sortDir === 1) res.picks.reverse();
    state.lastScreen = res.picks;
    const s = res.skipped;
    $('#screen-summary').innerHTML =
      `<span class="pill">Analizzati ${state.merged.metrics.count}</span>` +
      `<span class="pill">Passati ${res.passed}</span>` +
      `<span class="pill">mostrati ${res.picks.length}</span>` +
      `<span class="muted">scartati: storico ${s.storico} · 5Y neg ${s.cinqueY} · R² ${s.r2} · CAGR ${s.cagr} · DD ${s.dd}</span>`;
    const cols = [['t', 'Ticker'], ['quality', 'Quality'], ['cagr', 'CAGR'], ['vol', 'Vol'],
      ['mdd', 'MaxDD'], ['min5y', 'Min5Y'], ['r2', 'R²'], ['reg', 'Reg.'], ['mar', 'MAR'], ['sortino', 'Sortino']];
    let h = '<tr><th title="Clicca ★ per aggiungere al basket custom"></th>' + cols.map(([k, l]) => `<th data-k="${k}" title="${TIPS[k] || ''}">${l}${state.sortKey === k ? (state.sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('') + '</tr>';
    for (const r of res.picks) {
      const on = state.basket.has(r.t) ? ' on' : '';
      h += `<tr><td><span class="star${on}" data-star="${r.t}">${on ? '★' : '☆'}</span></td>` +
        `<td class="tk">${r.t}</td>` +
        `<td><b>${num(r.quality, 2)}</b></td>` +
        `<td class="${cls(r.cagr)}">${pct(r.cagr, 0)}</td>` +
        `<td>${pct(r.vol, 0)}</td>` +
        `<td class="neg">${pct(r.mdd, 0)}</td>` +
        `<td class="${cls(r.min5y)}">${pct(r.min5y, 0)}</td>` +
        `<td>${num(r.r2, 3)}</td><td>${pct(r.reg, 0)}</td>` +
        `<td>${num(r.mar, 2)}</td><td>${num(r.sortino, 2)}</td></tr>`;
    }
    $('#screen-tbl').innerHTML = h;
    $('#screen-tbl').querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.k; if (k === 'mdd' || k === 'reg') return;
      if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = -1; }
      renderScreenTable();
    }));
    $('#screen-tbl').querySelectorAll('[data-star]').forEach((el) => el.addEventListener('click', () => {
      const t = el.dataset.star;
      if (state.basket.has(t)) state.basket.delete(t); else state.basket.add(t);
      renderScreenTable(); renderBasket();
    }));
  }

  // ---- portafoglio custom / salvataggio ------------------------------------
  function activeBuild() {
    if (state.basket.size >= 2) {
      const res = LIVE.recomputeFromTickers(state.merged.metrics, state.merged.curves, [...state.basket], { ...state.params, nSim: 150 });
      return { source: 'custom', res };
    }
    return { source: 'canonico', res: state.live };
  }

  function renderBasket() {
    if (!state.merged) return;
    const ab = activeBuild(); state.build = ab;
    const chips = $('#basket-chips');
    if (state.basket.size) {
      chips.innerHTML = [...state.basket].map((t) => `<span class="chip">${t}<b data-rm="${t}">×</b></span>`).join('') +
        `<span class="chip" style="cursor:pointer" id="basket-clear">svuota</span>`;
      chips.querySelectorAll('[data-rm]').forEach((el) => el.addEventListener('click', () => { state.basket.delete(el.dataset.rm); renderScreenTable(); renderBasket(); }));
      $('#basket-clear').addEventListener('click', () => { state.basket.clear(); renderScreenTable(); renderBasket(); });
    } else chips.innerHTML = '<span class="muted">Basket vuoto — verrà salvato/esportato il portafoglio canonico corrente.</span>';

    const box = $('#basket-metrics'), r = ab.res;
    if (!r || r.insufficient || !r.picks.length) { box.innerHTML = '<div class="kpi"><div class="lab">Basket</div><div class="val" style="font-size:14px">titoli insufficienti</div></div>'; return; }
    const m = r.backtest.schemes[state.scheme].metrics.rebal, bm = r.backtest.benchMetrics;
    const edge = bm ? m.cagr - bm.cagr : null;
    const card = (lab, val, cmp) => `<div class="kpi"><div class="lab">${lab}</div><div class="val">${val}</div><div class="cmp">${cmp || ''}</div></div>`;
    box.innerHTML =
      card(`${ab.source === 'custom' ? 'Custom' : 'Canonico'} · ${schemeLabel[state.scheme]}`, r.picks.length + ' titoli', r.dropped ? r.dropped + ' senza curva' : 'in-sample (mensile)') +
      card('CAGR in-sample', pct(m.cagr), edge != null ? `edge <b class="${cls(edge)}">${pct(edge, 1)}</b> vs bench` : '') +
      card('Sharpe', num(m.sharpe), `MaxDD ${pct(m.mdd, 0)}`);
  }

  async function saveSnapshot() {
    const ab = state.build || activeBuild(), r = ab.res;
    if (!r || !r.picks || r.picks.length < 2) { setStatus('Niente da salvare', true); return; }
    const wk = wKey[state.scheme];
    const m = r.backtest.schemes[state.scheme].metrics.rebal;
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    const oosM = oosB && oosB.schemes[state.scheme] && oosB.schemes[state.scheme].metrics.rebal;
    const snap = {
      universes: state.universes, source: ab.source, scheme: state.scheme,
      params: { ...T }, note: ($('#snap-note').value || '').slice(0, 200),
      picks: r.picks.map((x) => ({ t: x.t, w: +(x[wk]).toFixed(4) })),
      metricsIS: { cagr: m.cagr, sharpe: m.sharpe, mdd: m.mdd },
      metricsOOS: oosM ? { cagr: oosM.cagr, sharpe: oosM.sharpe, mdd: oosM.mdd } : null,
    };
    try { setStatus('salvataggio…'); await ComaStore.save(snap); setStatus('salvato ✓'); $('#snap-note').value = ''; renderSnapshots(); }
    catch (e) { setStatus('errore: ' + e.message, true); }
  }

  function exportExcel() {
    const ab = state.build || activeBuild();
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    ComaExport.toExcel({
      universe: state.universes.join('+'), scheme: state.scheme,
      screenRows: state.lastScreen, portfolioPicks: ab.res ? ab.res.picks : [],
      isMetrics: ab.res && ab.res.backtest && ab.res.backtest.schemes[state.scheme].metrics,
      oosMetrics: oosB && oosB.schemes[state.scheme] && oosB.schemes[state.scheme].metrics,
    });
  }

  function setStatus(msg, err) { const e = $('#save-status'); e.textContent = msg; e.style.color = err ? 'var(--red)' : 'var(--tx3)'; }

  async function renderSnapshots() {
    const box = $('#snapshots');
    if (!ComaStore.available()) { box.innerHTML = '<span class="muted">Firebase non raggiungibile (offline o regole non configurate).</span>'; return; }
    try {
      const snaps = await ComaStore.list(50);
      if (!snaps.length) { box.innerHTML = '<span class="muted">Nessuno snapshot salvato.</span>'; return; }
      box.innerHTML = snaps.map((s) => {
        const d = s.createdAt && s.createdAt.toDate ? s.createdAt.toDate().toLocaleString('it-IT') : '—';
        const uni = (s.universes || [s.universe]).join('+');
        const cagr = s.metricsOOS ? pct(s.metricsOOS.cagr) : (s.metricsIS ? pct(s.metricsIS.cagr) + ' IS' : '–');
        return `<div class="snap"><span class="ld" data-load="${s.id}">${uni} · ${s.source} · ${s.scheme}</span>` +
          `<span class="muted">${s.picks.length} titoli · OOS ${cagr} · ${d}${s.note ? ' · ' + s.note : ''}</span>` +
          `<span class="del" data-del="${s.id}">🗑</span></div>`;
      }).join('');
      box.querySelectorAll('[data-load]').forEach((el) => el.addEventListener('click', () => loadSnapshot(snaps.find((x) => x.id === el.dataset.load))));
      box.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
        if (!confirm('Eliminare lo snapshot?')) return;
        try { await ComaStore.remove(el.dataset.del); renderSnapshots(); } catch (e) { setStatus('errore: ' + e.message, true); }
      }));
    } catch (e) { box.innerHTML = `<span class="muted">Errore lettura snapshot: ${e.message}</span>`; }
  }

  function loadSnapshot(s) {
    if (!s) return;
    const unis = s.universes || [s.universe];
    state.scheme = s.scheme;
    $('#seg-scheme').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.scheme));
    state.universes = BASES.map((b) => b.id).filter((id) => unis.includes(id));
    if (!state.universes.length) state.universes = ['SP500'];
    renderUniverseSelect();
    loadAndMerge().then(() => {
      state.basket = new Set(s.picks.map((p) => p.t));
      renderScreenTable(); renderBasket(); renderKpis(); renderBacktest();
      document.querySelector('#build-card').scrollIntoView({ behavior: 'smooth' });
    });
  }

  function renderAll() { renderKpis(); renderBacktest(); renderPortfolio(); renderScreenTable(); renderBasket(); }

  function bindSeg(id, key, after) {
    $(id).addEventListener('click', (e) => {
      if (!e.target.dataset.v) return;
      state[key] = e.target.dataset.v;
      $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
      after();
    });
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('coma-theme', t); } catch (e) {}
    const btn = $('#theme-toggle'); if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#f5f7fa' : '#0f1117');
  }
  function initTheme() {
    let t = 'dark'; try { t = localStorage.getItem('coma-theme') || 'dark'; } catch (e) {}
    applyTheme(t);
    $('#theme-toggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      applyTheme(cur === 'light' ? 'dark' : 'light');
      renderBacktest(); // i grafici rileggono i colori del tema
    });
  }

  let inited = false;
  function init() {
    if (inited) return; // guardia contro doppio DOMContentLoaded
    inited = true;
    initTheme();
    renderUniverseSelect();
    renderScreenCtrls();
    bindSeg('#seg-period', 'period', renderBacktest);
    bindSeg('#seg-scheme', 'scheme', () => { renderKpis(); renderBacktest(); renderPortfolio(); renderBasket(); });
    bindSeg('#seg-mode', 'mode', renderBacktest);
    $('#btn-save').addEventListener('click', saveSnapshot);
    $('#btn-export').addEventListener('click', exportExcel);
    $('#btn-reset').addEventListener('click', resetFilters);
    ComaStore.init();
    renderSnapshots();
    fetch('data/benchmarks.json').then((r) => r.json()).then((b) => { state.benchmarks = b; }).catch(() => {}).finally(loadAndMerge);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
