/* app.js — UI explorer coma-screener · multi-universo (unione), IS+OOS live */
(function () {
  'use strict';
  const E = window.ComaEngine, CH = window.ComaCharts, LIVE = window.ComaLive;
  const $ = (s) => document.querySelector(s);
  // numeri all'italiana: virgola, meno tipografico, "+" sulle variazioni (js/fmt.js)
  const F = window.ComaFmt;
  const pct = (x, d = 1) => F.pct(x, d);
  const num = (x, d = 2) => F.num(x, d);
  const delta = (x, d = 1) => F.delta(x, d);
  const wKey = { equal: 'wEqual', invvol: 'wInvvol', resampled: 'wResampled' };
  const schemeLabel = { equal: 'Equipeso', invvol: 'Risk-parity', resampled: 'Max-Sharpe' };

  // basi selezionabili + priorita benchmark (la prima selezionata fa da bench)
  // Solo USA: per l'Europa non esistono costituenti storici gratuiti ne
  // fondamentali point-in-time, quindi un risultato non sarebbe validabile.
  const BASES = [
    { id: 'SP500', label: 'S&P 500' },
    { id: 'NYSE', label: 'NYSE' },
    { id: 'NASDAQ', label: 'NASDAQ' },
  ];
  const BENCH_PRIORITY = ['SP500', 'NYSE', 'NASDAQ'];
  const PRESETS = [
    { label: 'Tutti USA', set: ['SP500', 'NYSE', 'NASDAQ'] },
  ];

  const DEFAULT_T = { minYears: 15, tolerance5y: -0.05, minR2: 0.90, minCagr: 0.10, maxDD: -0.45, topN: 20 };
  const T = { ...DEFAULT_T };
  let state = { universes: ['SP500'], loaded: {}, merged: null, params: null, benchmarks: null,
    live: null, oos: null, period: 'oos', scheme: 'equal', mode: 'rebal',
    sortKey: 'quality', sortDir: -1, basket: new Set(), build: null, lastScreen: [],
    hl: null, hist: null, factors: null };

  // benchmark più congruente alla selezione di universi.
  // TUTTI total return: i titoli usano l'adjusted close (dividendi reinvestiti),
  // quindi un indice price-only (^GSPC, ^IXIC, ^STOXX) regalerebbe 1-3 pp/anno.
  function chooseBenchmark(unis) {
    if (unis.length === 1) return { SP500: { sym: '^SP500TR', label: 'S&P 500 Total Return' },
      NASDAQ: { sym: '^XCMP', label: 'NASDAQ Composite TR' },
      NYSE: { sym: 'VTI', label: 'US Total Market TR (proxy NYSE)' } }[unis[0]];
    return { sym: 'VTI', label: 'US Total Market TR' };
  }

  // spiegazioni mostrate al passaggio del mouse (attributi title)
  const TIPS = {
    SP500: 'Le ~500 maggiori aziende quotate USA (indice S&P 500).',
    NYSE: 'Titoli quotati al New York Stock Exchange (~2300).',
    NASDAQ: 'Titoli quotati al NASDAQ (~4000), forte presenza tech.',
    preset0: 'Seleziona insieme S&P 500 + NYSE + NASDAQ.',
    oos: 'Out-of-sample: selezione fatta su dati passati (fino a ~7 anni fa) e testata sul periodo successivo. È il risultato più onesto.',
    insample: 'In-sample: selezione e test sullo stesso intero storico. Sempre ottimistico (circolare): usalo solo come riferimento.',
    equal: 'Equipeso: stesso peso a ogni titolo (1/N). Il più robusto, nessuna stima richiesta.',
    invvol: 'Risk-parity: peso inversamente proporzionale alla volatilità, così ogni titolo contribuisce ugualmente al rischio.',
    resampled: 'Max-Sharpe: ottimizza il rapporto rischio/rendimento (resampled, block bootstrap). Cerca i pesi migliori ma concentra di più.',
    rebal: 'Ritorno ai pesi target una volta l\'anno, pagando 0.15% sul controvalore scambiato (commissioni + spread).',
    buyhold: 'Comprato una volta e lasciato correre: i pesi driftano, zero costi di ribilanciamento. Coerente con la tesi "compra e dimentica".',
    minYears: 'Anni minimi di quotazione richiesti: esclude i titoli troppo giovani. Massimo 22: le serie convertite in EUR partono da dicembre 2003, limite del cambio EUR/USD su Yahoo.',
    tolerance5y: 'Perdita massima tollerata sul peggior quinquennio mobile (0% = mai negativo su 5 anni). Attenzione: i dati partono dal 2003, quindi questo filtro NON vede la bolla dot-com 2000-02.',
    minR2: 'Quanto la curva di prezzo (scala log) è vicina a una retta: più alto = crescita più regolare.',
    minCagr: 'Rendimento annuo composto minimo richiesto.',
    maxDD: 'Massima caduta dai massimi tollerata: più stretto = più difensivo.',
    topN: 'Quanti titoli compongono il portafoglio (i migliori per Quality).',
    // intestazioni colonne
    t: 'Simbolo (ticker) del titolo.',
    spark: 'Andamento del prezzo (total return, EUR) sulla finestra di test, in scala logaritmica. ' +
      'È la "regolarità" di cui parla la metodologia: una retta è il caso ideale, i gradini e i tuffi si vedono a occhio.',
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
    alfa: 'Alfa: extra-rendimento annuo che resta DOPO aver tolto la parte spiegata dal mercato (beta). ' +
      'Il t-stat dice se è distinguibile dal caso: sotto 2 non lo è. β è il beta: quanto il portafoglio ' +
      'si muove insieme al mercato (sotto 1 = più difensivo).',
    beta: 'Beta: quanto il portafoglio si muove insieme al mercato. Sotto 1 = più difensivo — ' +
      'un CAGR più basso con beta basso non è necessariamente un risultato peggiore.',
    sharpeKpi: 'Sharpe: rendimento in eccesso sul risk-free per unità di volatilità. ' +
      'Confrontalo con quello del benchmark: se è simile, il portafoglio non sta facendo meglio, ' +
      'sta solo rischiando meno.',
    f_cut: 'Titoli eliminati da questa soglia. Se un solo filtro scarta quasi tutto, è lui a decidere il portafoglio.',
    f_keep: 'Titoli che superano tutte le soglie. In tabella ne compaiono al massimo "Numero titoli".',
  };

  // `get` = valore della metrica su cui la soglia agisce (per l'istogramma).
  // Tutti i filtri sono "passa se valore >= soglia", quindi le barre a destra
  // della soglia sono quelle che sopravvivono.
  const CTRLS = [
    // max 22: le serie in EUR partono da dicembre 2003 (limite di EURUSD=X su Yahoo)
    { k: 'minYears', label: 'Storia minima', min: 5, max: 22, step: 1, fmt: (v) => v + ' anni', get: (r) => r.days / 252 },
    { k: 'tolerance5y', label: 'Tolleranza 5Y', min: -0.30, max: 0, step: 0.01, fmt: (v) => pct(v, 0), get: (r) => r.min5y },
    { k: 'minR2', label: 'R² minimo', min: 0.70, max: 0.99, step: 0.01, fmt: (v) => num(v, 2), get: (r) => r.r2 },
    { k: 'minCagr', label: 'CAGR minimo', min: 0, max: 0.25, step: 0.01, fmt: (v) => pct(v, 0), get: (r) => r.cagr },
    { k: 'maxDD', label: 'Max Drawdown', min: -0.80, max: -0.20, step: 0.05, fmt: (v) => pct(v, 0), get: (r) => r.mdd },
    { k: 'topN', label: 'Numero titoli', min: 5, max: 40, step: 1, fmt: (v) => v },
  ];
  const HIST_BINS = 32;

  /**
   * Sparkline: la curva del titolo sulla finestra di test, in scala log.
   * La metodologia parla di "regolarita della curva" e finora te la faceva
   * dedurre da un numero (R² 0.982): questa te la fa vedere.
   */
  function sparkline(t, months) {
    const c = state.merged && state.merged.curves.series[t];
    if (!c || !c.p || c.p.length < 24) return '';
    let p = c.p.slice(Math.max(0, c.p.length - (months || 180))).filter((x) => x > 0);
    if (p.length < 24) return '';
    const W = 64, H = 18, pad = 1.5, MAXPT = 64;
    if (p.length > MAXPT) {                       // sottocampiona: 64px non reggono 180 punti
      const k = (p.length - 1) / (MAXPT - 1);
      p = Array.from({ length: MAXPT }, (_, i) => p[Math.round(i * k)]);
    }
    const ys = p.map(Math.log);
    const lo = Math.min(...ys), hi = Math.max(...ys), rng = (hi - lo) || 1;
    const step = (W - 2 * pad) / (p.length - 1);
    let d = '';
    for (let i = 0; i < p.length; i++) {
      const x = pad + i * step;
      const y = H - pad - ((ys[i] - lo) / rng) * (H - 2 * pad);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  /** Conteggi per bin sulla scala dello slider, così l'istogramma e la soglia coincidono. */
  function buildHist(rows, c) {
    if (!c.get) return null;
    const bins = new Array(HIST_BINS).fill(0);
    const span = c.max - c.min || 1;
    for (const r of rows) {
      const v = c.get(r);
      if (!isFinite(v)) continue;
      const i = Math.max(0, Math.min(HIST_BINS - 1, Math.floor(((v - c.min) / span) * HIST_BINS)));
      bins[i]++;
    }
    return bins;
  }

  /** Istogramma dell'universo: altezze in radice, così i bin piccoli restano visibili. */
  /**
   * Istogramma dell'universo dietro il cursore. Due accorgimenti:
   * altezze in radice, perche i bin piccoli restino visibili; e riferimento al
   * 90esimo percentile invece che al massimo, perche i valori fuori scala si
   * accumulano nel bin di bordo e un solo picco schiaccerebbe tutto il resto
   * (con R2 minimo a 0,70 quel bin vale da solo piu di meta universo).
   */
  function histSvg(c) {
    const bins = state.hist && state.hist[c.k];
    if (!bins) return '';
    const vivi = bins.filter((x) => x > 0).sort((a, b) => a - b);
    if (!vivi.length) return '';
    const rif = Math.sqrt(Math.max(1, vivi[Math.floor((vivi.length - 1) * 0.9)]));
    const w = 100 / HIST_BINS;
    let r = '';
    for (let i = 0; i < HIST_BINS; i++) {
      if (!(bins[i] > 0)) continue;
      const h = Math.min(100, (Math.sqrt(bins[i]) / rif) * 100);
      r += `<rect class="bar" data-i="${i}" x="${(i * w).toFixed(3)}" y="${(100 - h).toFixed(2)}" ` +
        `width="${(w * 0.82).toFixed(3)}" height="${h.toFixed(2)}"><title>${bins[i]} titoli</title></rect>`;
    }
    return `<svg class="hist" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${r}</svg>`;
  }

  /** Colora di accento i bin che sopravvivono alla soglia corrente. */
  function paintHist(c) {
    const svg = $('#hist-' + c.k);
    if (!svg) return;
    const span = c.max - c.min || 1;
    const cutoff = ((T[c.k] - c.min) / span) * HIST_BINS;
    svg.querySelectorAll('.bar').forEach((b) => {
      b.classList.toggle('in', +b.dataset.i + 1 > cutoff);
    });
  }

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

  /** Placeholder animati mentre si scaricano i dataset: meglio di uno spinner. */
  function showLoading() {
    if (!window.ComaUI) return;
    ComaUI.skeletonCards(4, '#kpis');
    ComaUI.skeletonCards(3, '#kpis-is');
    ComaUI.skeletonRows(6, '#port-tbl', 9);
    ComaUI.skeletonRows(8, '#screen-tbl', 12);
    $('#verdict').innerHTML = '<div class="verdict"><div class="vhead">' +
      '<span class="st st-normal">' + stIcon('normal') + 'Caricamento</span></div>' +
      '<div class="vtext">Metriche e curve arrivano dai dati precalcolati; portafoglio e backtest ' +
      'si ricalcolano qui nel browser.</div></div>';
  }

  /** Le forme dei badge di stato: si distinguono anche senza colore. */
  function stIcon(kind) {
    const s = (inner) => '<svg viewBox="0 0 12 12" aria-hidden="true">' + inner + '</svg>';
    if (kind === 'watch') return s('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/>');
    if (kind === 'setup') return s('<path d="M6 1.5 L11 10.5 L1 10.5 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>');
    if (kind === 'trig') return s('<path d="M6 10.5 L1 1.5 L11 1.5 Z" fill="currentColor"/>');
    if (kind === 'fail') return s('<path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="2"/>');
    return s('<rect x="2" y="5" width="8" height="2" fill="currentColor"/>');
  }

  async function loadAndMerge() {
    const sel = state.universes;
    let datasets;
    try { datasets = await Promise.all(sel.map(loadBase)); }
    catch (e) {
      $('#kpis').innerHTML = '';
      $('#kpis-is').innerHTML = '';
      $('#port-tbl').innerHTML = '';
      $('#screen-tbl').innerHTML = '';
      $('#verdict').innerHTML = '<div class="verdict bad"><div class="vi">⚠️</div><div>' +
        '<div class="vt">Dati non disponibili</div>' +
        `<div class="vd">Non riesco a caricare <b>${sel.join(', ')}</b>. Se stai aprendo il file in locale servi la cartella via HTTP (<b>node scripts/_serve.js</b>); online riprova fra poco.</div></div></div>`;
      return;
    }

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
      curves: { series, bench: benchCurve,
        rf: (state.benchmarks && state.benchmarks.rf) || null,
        fx: (state.benchmarks && state.benchmarks.fx) || null },
      benchLabel: bm.label,
    };
    setDataDate(updated);
    // istogrammi: dipendono dall'universo, quindi si ricalcolano a ogni merge
    state.hist = {};
    for (const c of CTRLS) { const b = buildHist(rows, c); if (b) state.hist[c.k] = b; }
    renderScreenCtrls();
    recomputeLive(); recomputeOOS(); renderAll();
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
    box.innerHTML = '<span>Universi</span>' +
      '<div class="seg" role="group" aria-label="Universi da analizzare">' +
      BASES.map((b) => `<button type="button" data-u="${b.id}" aria-pressed="${state.universes.includes(b.id)}" title="${TIPS[b.id]}">${b.label.toUpperCase()}</button>`).join('') +
      '</div>' +
      PRESETS.map((p, i) => `<button type="button" class="tool mini" data-preset="${i}" title="${TIPS['preset' + i]}">${p.label.toUpperCase()}</button>`).join('');
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
    showLoading();
    loadAndMerge();
  }

  /**
   * Riquadro KPI: etichetta in maiuscolo, valore, riga di contesto.
   * Nessun numero senza contesto, come chiede il sistema.
   */
  const card = (lab, val, ctx, help) =>
    `<div class="kpi"><span class="k">${lab}` +
    (help ? ` <span class="info" title="${help}">i</span>` : '') +
    `</span><span class="v">${val}</span><span class="s">${ctx || ''}</span></div>`;

  /**
   * Alfa della regressione sul benchmark, con beta e t-stat: e il KPI che
   * distingue la bravura dall'esposizione al mercato. Un "vantaggio" del +3%
   * con beta 0,7 e t 0,9 non e un vantaggio, e meno mercato piu rumore.
   */
  function alphaCard(reg, prefix) {
    if (!reg) return card('Alfa ' + prefix, F.DASH, 'benchmark non allineato', TIPS.alfa);
    const t = reg.alphaT, solido = isFinite(t) && Math.abs(t) >= 2;
    const ctx = solido
      ? `t ${num(t, 2)} &middot; distinguibile da zero`
      : `t ${num(t, 2)} &middot; sotto 2: indistinguibile dal caso`;
    return card(`Alfa ${prefix} <span class="gr">&middot; β ${num(reg.beta, 2)}</span>`, delta(reg.alpha), ctx, TIPS.alfa);
  }

  /**
   * Il verdetto: una frase che risponde alla domanda vera, prima dei numeri che
   * la giustificano. Il criterio e il t-stat dell'alfa out-of-sample, non il CAGR.
   * Il badge blu e il segnale principale del progetto: la significativita.
   */
  function renderVerdict() {
    const box = $('#verdict');
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    const rk = state.mode === 'buyhold' ? 'buyhold' : 'rebal';
    const sc = oosB && oosB.schemes[state.scheme];
    const reg = sc && sc.regression && sc.regression[rk];
    const m = sc && sc.metrics[rk];
    const meta = $('#verdict-meta');
    if (meta) meta.textContent = oosB ? `${F.month(oosB.from)} &ndash; ${F.month(oosB.to)} &middot; ${schemeLabel[state.scheme].toLowerCase()}`.replace(/&ndash;/g, '\u2013').replace(/&middot;/g, '\u00b7') : '';

    const paint = (stClass, icon, title, detail) =>
      `<div class="verdict"><div class="vhead"><span class="st ${stClass}">${stIcon(icon)}${title}</span></div>` +
      `<div class="vtext">${detail}</div></div>`;

    if (!reg || !m) {
      box.innerHTML = paint('st-cool', 'normal', 'Validazione non disponibile',
        'Con queste soglie non restano abbastanza titoli con storia sufficiente per un test out-of-sample. Allarga i filtri o aggiungi un universo.');
      return;
    }
    const t = reg.alphaT, a = reg.alpha, b = reg.beta;
    const base = `Alfa out-of-sample ${delta(a)} con <b class="num">t ${num(t, 2)}</b>, beta <b class="num">${num(b, 2)}</b>. ` +
      `CAGR <b class="num">${pct(m.cagr)}</b> contro <b class="num">${pct(oosB.benchMetrics && oosB.benchMetrics.cagr)}</b> del benchmark.`;
    if (isFinite(t) && t >= 2) {
      box.innerHTML = paint('st-setup', 'setup', 'Vantaggio significativo',
        base + ' L&rsquo;extra-rendimento resta dopo aver tolto la parte spiegata dal mercato. Resta per&ograve; il survivorship bias dell&rsquo;universo: trattalo come indizio, non come prova.');
    } else if (isFinite(t) && t <= -2) {
      box.innerHTML = paint('st-fail', 'fail', 'Sottoperformance significativa',
        base + ' Il portafoglio ha reso meno di quanto giustificato dalla sua esposizione al mercato.');
    } else {
      box.innerHTML = paint('st-watch', 'watch', 'Nessun vantaggio dimostrabile',
        base + ` Sotto |t| = 2 l&rsquo;alfa non &egrave; distinguibile dal caso: su questi dati il modello non aggiunge nulla rispetto al benchmark. ` +
        `Con beta ${num(b, 2)} il portafoglio &egrave; soprattutto <b>esposizione difensiva al mercato</b>, ottenibile in modo pi&ugrave; semplice ed economico.`);
    }
  }

  function renderKpis() {
    renderVerdict();
    const insB = state.live && !state.live.insufficient ? state.live.backtest : null;
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    const sc = (b) => (b && b.schemes[state.scheme]) || null;
    const iS = sc(insB), oS = sc(oosB);
    const im = iS && iS.metrics, om = oS && oS.metrics;
    const rk = state.mode === 'buyhold' ? 'buyhold' : 'rebal';

    let oosHtml = '';
    if (om) {
      const bm = oosB.benchMetrics;
      const edge = om[rk].cagr - (bm ? bm.cagr : 0);
      oosHtml += card('CAGR out-of-sample', pct(om[rk].cagr),
        `benchmark ${pct(bm && bm.cagr)} &middot; ${delta(edge)}`, TIPS.cagr);
      oosHtml += alphaCard(oS.regression && oS.regression[rk], 'OOS');
      oosHtml += card('Sharpe', num(om[rk].sharpe), `benchmark ${num(bm && bm.sharpe, 2)}`, TIPS.sharpeKpi);
      oosHtml += card('Drawdown massimo', `<span class="down">${pct(om[rk].mdd, 0)}</span>`,
        `benchmark ${pct(bm && bm.mdd, 0)}`, TIPS.mdd);
    } else {
      oosHtml = card('Out-of-sample', F.DASH, 'titoli insufficienti per la validazione');
    }
    $('#kpis').innerHTML = oosHtml;

    let isHtml = '';
    if (im) {
      const bm = insB.benchMetrics;
      const edge = im[rk].cagr - (bm ? bm.cagr : 0);
      isHtml += card('CAGR in-sample', pct(im[rk].cagr),
        `benchmark ${pct(bm && bm.cagr)} &middot; ${delta(edge)}`, TIPS.insample);
      isHtml += alphaCard(iS.regression && iS.regression[rk], 'IS');
      isHtml += card('Sharpe', num(im[rk].sharpe), `drawdown ${pct(im[rk].mdd, 0)}`, TIPS.sharpeKpi);
    } else isHtml = card('In-sample', F.DASH, 'titoli insufficienti');
    $('#kpis-is').innerHTML = isHtml;
  }

  /**
   * Attribuzione fattoriale: la tabella che dice se l'alfa e bravura o
   * esposizione a fattori gia noti. Si legge da sinistra a destra: l'alfa che
   * sopravvive al mercato spesso non sopravvive a BAB (low-beta) e QMJ
   * (qualita). E il test che in *Buffett's Alpha* azzera l'alfa di Berkshire.
   */
  function renderAttribution() {
    const box = $('#attrib-tbl'), meta = $('#attrib-n');
    if (!box) return;
    const blk = currentBacktest();
    const fx = state.merged && state.merged.curves.fx;
    if (!blk || !state.factors || !fx) {
      if (meta) meta.textContent = '';
      box.innerHTML = emptyState('Attribuzione non disponibile',
        !state.factors ? 'Il file dei fattori non e stato caricato.'
          : 'Serve il cambio euro/dollaro per riportare i rendimenti nella valuta dei fattori.', 5);
      return;
    }
    const seg = { i0: (() => { const [y, m] = fx.s.split('-').map(Number); return y * 12 + (m - 1); })(), p: fx.p };
    const a = LIVE.attribution(blk, state.scheme, state.mode, seg, state.factors);
    if (!a) {
      if (meta) meta.textContent = '';
      box.innerHTML = emptyState('Serie troppo corta',
        'Servono almeno 25 mesi in comune fra il backtest e i fattori.', 5);
      return;
    }
    if (meta) meta.textContent = `${a.n} mesi \u00b7 ${F.month(a.da)}\u2013${F.month(a.a)} \u00b7 in dollari`;
    let h = '<thead><tr>' +
      th('Modello', 'I fattori tolti al rendimento, uno strato alla volta.') +
      th('Alfa annuo', 'Quello che resta dopo aver tolto i fattori del modello.', { r: 1 }) +
      th('t-stat', 'Serve |t| > 3 per dichiarare una scoperta (Harvey, Liu e Zhu 2016): con 2 si raccolgono falsi positivi.', { r: 1 }) +
      th('Beta mercato', 'Esposizione al mercato. Sotto 1 significa difensivo.', { r: 1 }) +
      th('R\u00b2 corretto', 'Quanta parte del rendimento il modello spiega.', { r: 1 }) +
      '</tr></thead><tbody>';
    for (const m of a.scala) {
      if (m.insufficiente) {
        h += `<tr><td><span class="sym">${m.label}</span></td>` +
          `<td colspan="4" class="muted">osservazioni insufficienti (${m.n})</td></tr>`;
        continue;
      }
      const mkt = m.beta.find((b) => b.f === 'mktrf');
      const solido = isFinite(m.alphaT) && Math.abs(m.alphaT) >= 3;
      h += `<tr${m.id === 'full' ? ' class="sel"' : ''}><td><span class="sym">${m.label}</span></td>` +
        `<td class="num r">${delta(m.alpha)}</td>` +
        `<td class="num r"${solido ? '' : ' style="color:var(--ink-3)"'}>${num(m.alphaT, 2)}</td>` +
        `<td class="num r">${mkt ? num(mkt.b, 2) : F.DASH}</td>` +
        `<td class="num r">${pct(m.adjR2, 0)}</td></tr>`;
    }
    h += '</tbody>';
    box.innerHTML = h;

    // i coefficienti del modello completo, per leggere DA DOVE viene il rendimento
    const full = a.scala.find((m) => m.id === 'full' && !m.insufficiente);
    const det = $('#attrib-betas');
    if (det) {
      if (!full) det.innerHTML = '';
      else {
        const NOMI = { mktrf: 'Mercato', smb: 'Dimensione (SMB)', hml: 'Valore (HML)',
          rmw: 'Profittabilita (RMW)', cma: 'Investimento (CMA)', wml: 'Momentum (WML)',
          bab: 'Low-beta (BAB)', qmj: 'Qualita (QMJ)' };
        det.innerHTML = full.beta.map((b) => {
          const forte = isFinite(b.t) && Math.abs(b.t) >= 2;
          return `<span class="fstep${forte ? ' keep' : ''}">${NOMI[b.f] || b.f} ` +
            `<b class="num">${F.signed(b.b, 2)}</b> <span class="muted">t ${num(b.t, 1)}</span></span>`;
        }).join('');
      }
    }
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

  const emptyState = (title, hint, cols) =>
    `<tbody><tr><td colspan="${cols}"><div class="empty"><b>${title}</b>${hint}</div></td></tr></tbody>`;

  /** Intestazione di colonna: etichetta in maiuscolo, ordinamento con aria-sort. */
  const th = (label, tip, opt) => {
    opt = opt || {};
    const aria = opt.sort ? ` aria-sort="${opt.sort}"` : '';
    const k = opt.k ? ` data-k="${opt.k}"` : '';
    const r = opt.r ? ' class="r"' : '';
    const mark = opt.sort ? (opt.sort === 'descending' ? ' \u25BC' : ' \u25B2') : '';
    const inner = opt.k ? `<button type="button">${label}${mark}</button>` : label + mark;
    return `<th scope="col"${r}${k}${aria} title="${tip || ''}">${inner}</th>`;
  };

  function renderPortfolio() {
    const live = state.live;
    if (!live || live.insufficient || !live.picks.length) {
      $('#port-n').textContent = 'nessun titolo';
      $('#port-tbl').innerHTML = emptyState('Nessun portafoglio con queste soglie',
        'Le soglie sono troppo restrittive, oppure i titoli superstiti non hanno una storia comune abbastanza lunga. Prova ad abbassare R\u00b2 o il CAGR minimo, o ad aggiungere un universo.', 9);
      return;
    }
    const wk = wKey[state.scheme];
    const picks = live.picks.slice().sort((a, b) => b[wk] - a[wk]);
    const bt = live.backtest;
    const to = bt && bt.schemes[state.scheme].metrics.rebal.turnover;
    $('#port-n').textContent = `${picks.length} titoli \u00b7 ${schemeLabel[state.scheme].toLowerCase()}` +
      (state.scheme === 'resampled' ? ` \u00b7 ${live.scenarios} scenari` : '') +
      (bt ? ` \u00b7 ${F.month(bt.from)}\u2013${F.month(bt.to)}` : '') +
      (to ? ` \u00b7 turnover ${pct(to, 0)}/anno` : '') +
      (live.dropped ? ` \u00b7 ${live.dropped} esclusi` : '');
    const maxW = Math.max(...picks.map((x) => x[wk]));
    const winMonths = Math.round((T.minYears || 15) * 12);
    let h = '<thead><tr>' +
      th('Titolo', TIPS.t) + th('Peso', TIPS.w) + th('Curva', TIPS.spark) +
      th('Quality', TIPS.quality, { r: 1 }) + th('CAGR', TIPS.cagr, { r: 1 }) +
      th('Drawdown', TIPS.mdd, { r: 1 }) + th('Min 5 anni', TIPS.min5y, { r: 1 }) +
      th('R\u00b2', TIPS.r2, { r: 1 }) + th('Regolarit\u00e0', TIPS.reg, { r: 1 }) +
      '</tr></thead><tbody>';
    for (const x of picks) {
      h += `<tr data-sym="${x.t}" tabindex="0"><td><span class="sym">${x.t}</span></td>` +
        `<td><span class="wbar"><i style="width:${(x[wk] / maxW * 100).toFixed(0)}%"></i></span><span class="num">${pct(x[wk])}</span></td>` +
        `<td>${sparkline(x.t, winMonths)}</td>` +
        `<td class="num r">${num(x.quality, 2)}</td>` +
        `<td class="num r">${pct(x.cagr, 0)}</td>` +
        `<td class="num r down">${pct(x.mdd, 0)}</td>` +
        `<td class="num r">${F.signedPct(x.min5y, 0)}</td>` +
        `<td class="num r">${num(x.r2, 3)}</td><td class="num r">${pct(x.reg, 0)}</td></tr>`;
    }
    $('#port-tbl').innerHTML = h + '</tbody>';
  }

  function renderScreenCtrls() {
    let h = '';
    for (const c of CTRLS) {
      const hist = histSvg(c);
      h += `<div class="ctl-range"><label for="rng-${c.k}" title="${TIPS[c.k]}">` +
        `<span>${c.label} <span class="info">i</span></span> <b id="lbl-${c.k}">${c.fmt(T[c.k])}</b></label>` +
        (hist ? hist.replace('class="hist"', `class="hist" id="hist-${c.k}"`) : '') +
        `<input type="range" id="rng-${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${T[c.k]}" ` +
        `aria-label="${c.label}" aria-valuetext="${c.fmt(T[c.k])}"></div>`;
    }
    $('#screen-ctrls').innerHTML = h;
    for (const c of CTRLS) {
      paintHist(c);
      $('#rng-' + c.k).addEventListener('input', (e) => {
        T[c.k] = +e.target.value;
        $('#lbl-' + c.k).textContent = c.fmt(T[c.k]);
        e.target.setAttribute('aria-valuetext', c.fmt(T[c.k]));
        paintHist(c);
        renderScreenTable(); scheduleLive();
      });
    }
  }

  function resetFilters() {
    Object.assign(T, DEFAULT_T);
    for (const c of CTRLS) {
      const el = $('#rng-' + c.k);
      if (el) { el.value = T[c.k]; $('#lbl-' + c.k).textContent = c.fmt(T[c.k]); paintHist(c); }
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
      renderPortfolio(); renderKpis(); renderBacktest(); renderAttribution(); renderBasket();
    }, 200);
  }

  function renderScreenTable() {
    if (!state.merged) return;
    const res = E.screen(state.merged.metrics.rows, { ...T, ppy: 252, sortBy: state.sortKey });
    if (state.sortDir === 1) res.picks.reverse();
    state.lastScreen = res.picks;

    // imbuto: quale soglia sta davvero scartando i titoli
    const s = res.skipped;
    const step = (lab, n, kind) => `<span class="fstep ${kind || ''}" title="${TIPS['f_' + kind] || ''}">${lab} <b class="num">${n}</b></span>`;
    const cut = [['storia', s.storico], ['quinquennio negativo', s.cinqueY], ['R\u00b2', s.r2],
      ['CAGR', s.cagr], ['drawdown', s.dd]].filter(([, n]) => n > 0);
    $('#screen-summary').innerHTML = '<div class="funnel">' +
      step('Analizzati', state.merged.metrics.count) +
      (cut.length ? '<span class="farrow">\u2192 scartati da</span>' : '') +
      cut.map(([l, n]) => step(l, n, 'cut')).join('') +
      '<span class="farrow">\u2192</span>' +
      step('Passati', res.passed, 'keep') +
      (res.picks.length < res.passed ? step('in tabella', res.picks.length) : '') +
      '</div>';

    const cols = [['quality', 'Quality'], ['cagr', 'CAGR'], ['vol', 'Volatilit\u00e0'],
      ['mdd', 'Drawdown'], ['min5y', 'Min 5 anni'], ['r2', 'R\u00b2'], ['reg', 'Regolarit\u00e0'],
      ['mar', 'MAR'], ['sortino', 'Sortino']];
    const sortable = (k) => k !== 'mdd' && k !== 'reg';
    const dir = state.sortDir < 0 ? 'descending' : 'ascending';
    let h = '<thead><tr>' +
      '<th scope="col" title="Segna il titolo per metterlo nel basket in fondo alla pagina"><span class="sr">Basket</span>\u2605</th>' +
      th('Titolo', TIPS.t) + th('Curva', TIPS.spark) +
      cols.map(([k, l]) => th(l, (TIPS[k] || '') + (sortable(k) ? ' Clicca per ordinare.' : ''),
        { r: 1, k: sortable(k) ? k : null, sort: state.sortKey === k ? dir : null })).join('') +
      '</tr></thead>';
    if (!res.picks.length) {
      $('#screen-tbl').innerHTML = h + emptyState('Nessun titolo supera le soglie',
        'L\u2019imbuto qui sopra dice quale filtro sta scartando tutto. Usa Azzera soglie per tornare ai valori di partenza.', cols.length + 3);
    } else {
      const winMonths = Math.round((T.minYears || 15) * 12);
      h += '<tbody>';
      for (const r of res.picks) {
        const on = state.basket.has(r.t);
        h += `<tr data-sym="${r.t}"${state.hl === r.t ? ' class="sel"' : ''}>` +
          `<td><span class="chip" role="button" tabindex="0" data-star="${r.t}" aria-pressed="${on}" ` +
          `aria-label="${on ? 'Togli' : 'Aggiungi'} ${r.t} ${on ? 'dal' : 'al'} basket">${on ? '\u2605' : '\u2606'}</span></td>` +
          `<td><span class="sym">${r.t}</span></td>` +
          `<td>${sparkline(r.t, winMonths)}</td>` +
          `<td class="num r">${num(r.quality, 2)}</td>` +
          `<td class="num r">${pct(r.cagr, 0)}</td>` +
          `<td class="num r">${pct(r.vol, 0)}</td>` +
          `<td class="num r down">${pct(r.mdd, 0)}</td>` +
          `<td class="num r">${F.signedPct(r.min5y, 0)}</td>` +
          `<td class="num r">${num(r.r2, 3)}</td><td class="num r">${pct(r.reg, 0)}</td>` +
          `<td class="num r">${num(r.mar, 2)}</td><td class="num r">${num(r.sortino, 2)}</td></tr>`;
      }
      $('#screen-tbl').innerHTML = h + '</tbody>';
    }
    $('#screen-tbl').querySelectorAll('th[data-k]').forEach((el) => el.addEventListener('click', () => {
      const k = el.dataset.k;
      if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = -1; }
      renderScreenTable();
    }));
    $('#screen-tbl').querySelectorAll('[data-star]').forEach((el) => {
      const toggle = () => {
        const t = el.dataset.star;
        if (state.basket.has(t)) state.basket.delete(t); else state.basket.add(t);
        renderScreenTable(); renderBasket();
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  // ---- portafoglio custom / salvataggio ------------------------------------
  function activeBuild() {
    if (state.basket.size >= 2) {
      const res = LIVE.recomputeFromTickers(state.merged.metrics, state.merged.curves, [...state.basket], { ...state.params, nSim: 150 }, T.minYears);
      return { source: 'custom', res };
    }
    return { source: 'canonico', res: state.live };
  }

  function renderBasket() {
    if (!state.merged) return;
    const ab = activeBuild(); state.build = ab;
    const chips = $('#basket-chips');
    if (state.basket.size) {
      chips.innerHTML = [...state.basket].map((t) =>
        `<button type="button" class="chip" data-rm="${t}" aria-label="Togli ${t} dal basket">${t} \u00d7</button>`).join('') +
        '<button type="button" class="tool mini" id="basket-clear">SVUOTA</button>';
      chips.querySelectorAll('[data-rm]').forEach((el) => el.addEventListener('click', () => {
        state.basket.delete(el.dataset.rm); renderScreenTable(); renderBasket();
      }));
      $('#basket-clear').addEventListener('click', () => {
        state.basket.clear(); renderScreenTable(); renderBasket();
      });
    } else chips.innerHTML = '<span class="note">Basket vuoto: vale il portafoglio corrente.</span>';

    const box = $('#basket-metrics'), r = ab.res;
    if (!r || r.insufficient || !r.picks.length) {
      box.innerHTML = card('Basket', F.DASH, 'titoli insufficienti');
      return;
    }
    const m = r.backtest.schemes[state.scheme].metrics.rebal, bm = r.backtest.benchMetrics;
    const edge = bm ? m.cagr - bm.cagr : null;
    box.innerHTML =
      card(ab.source === 'custom' ? 'Basket personale' : 'Portafoglio corrente',
        r.picks.length + ' titoli', schemeLabel[state.scheme].toLowerCase() + (r.dropped ? ' \u00b7 ' + r.dropped + ' senza curva' : '')) +
      card('CAGR in-sample', pct(m.cagr), edge != null ? `${delta(edge)} rispetto al benchmark` : '') +
      card('Sharpe', num(m.sharpe), `drawdown ${pct(m.mdd, 0)}`);
  }

  async function saveSnapshot() {
    const ab = state.build || activeBuild(), r = ab.res;
    if (!r || !r.picks || r.picks.length < 2) { setStatus('Niente da salvare', true); return; }
    const wk = wKey[state.scheme];
    const m = r.backtest.schemes[state.scheme].metrics.rebal;
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    const oosS = oosB && oosB.schemes[state.scheme];
    const oosM = oosS && oosS.metrics.rebal;
    const oosR = oosS && oosS.regression && oosS.regression.rebal;
    const snap = {
      universes: state.universes, source: ab.source, scheme: state.scheme,
      params: { ...T }, note: ($('#snap-note').value || '').slice(0, 200),
      benchmark: state.merged ? state.merged.benchLabel : null,
      picks: r.picks.map((x) => ({ t: x.t, w: +(x[wk]).toFixed(4) })),
      metricsIS: { cagr: m.cagr, sharpe: m.sharpe, mdd: m.mdd },
      metricsOOS: oosM ? { cagr: oosM.cagr, sharpe: oosM.sharpe, mdd: oosM.mdd } : null,
      regressionOOS: oosR ? { beta: oosR.beta, alpha: oosR.alpha, alphaT: oosR.alphaT } : null,
    };
    try { setStatus('salvataggio…'); await ComaStore.save(snap); setStatus('salvato ✓'); $('#snap-note').value = ''; renderSnapshots(); }
    catch (e) { setStatus('errore: ' + e.message, true); }
  }

  function exportExcel() {
    const ab = state.build || activeBuild();
    const oosB = state.oos && !state.oos.insufficient ? state.oos.backtest : null;
    const isS = ab.res && ab.res.backtest && ab.res.backtest.schemes[state.scheme];
    const oosS = oosB && oosB.schemes[state.scheme];
    ComaExport.toExcel({
      universe: state.universes.join('+'), scheme: state.scheme,
      screenRows: state.lastScreen, portfolioPicks: ab.res ? ab.res.picks : [],
      bench: state.merged ? state.merged.benchLabel : null,
      isMetrics: isS && isS.metrics, isReg: isS && isS.regression,
      oosMetrics: oosS && oosS.metrics, oosReg: oosS && oosS.regression,
    });
  }

  function setStatus(msg, err) { const e = $('#save-status'); e.textContent = msg; e.style.color = err ? 'var(--down)' : 'var(--ink-3)'; }

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
        const g = s.regressionOOS ? ` · α ${F.signedPct(s.regressionOOS.alpha)} (t ${num(s.regressionOOS.alphaT, 2)})` : '';
        return `<div class="snap"><span class="ld" data-load="${s.id}">${uni} · ${s.source} · ${s.scheme}</span>` +
          `<span class="muted">${s.picks.length} titoli · OOS ${cagr}${g} · ${d}${s.note ? ' · ' + s.note : ''}</span>` +
          `<button type="button" class="del" data-del="${s.id}" aria-label="Elimina lo snapshot">ELIMINA</button></div>`;
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

  /** Il link alla pagina 2 porta con se i titoli attualmente selezionati. */
  function updateEntryLink() {
    const a = $('#link-entry');
    if (!a) return;
    const ab = state.build || (state.merged ? activeBuild() : null);
    const picks = ab && ab.res && ab.res.picks ? ab.res.picks.map((x) => x.t) : [];
    a.href = 'entry.html?u=' + encodeURIComponent(state.universes[0] || 'SP500') +
      (picks.length ? '&t=' + encodeURIComponent(picks.join(',')) : '');
  }

  function renderAll() { renderKpis(); renderBacktest(); renderAttribution(); renderPortfolio(); renderScreenTable(); renderBasket(); updateEntryLink(); }

  function bindSeg(id, key, after) {
    $(id).addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      state[key] = btn.dataset.v;
      $(id).querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      after();
    });
  }

  /**
   * Tema per daltonici: cambia solo "su" e "giu" (azzurro e rosso).
   * Il design system ha un solo tema scuro, quindi non c'e un chiaro/scuro.
   */
  function applyCvd(on) {
    document.getElementById('term').classList.toggle('cvd', on);
    const btn = $('#cvd-toggle');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    try { localStorage.setItem('coma-cvd', on ? '1' : '0'); } catch (e) {}
    renderBacktest(); // i grafici rileggono i colori dal tema
  }
  function initCvd() {
    let on = false;
    try { on = localStorage.getItem('coma-cvd') === '1'; } catch (e) {}
    applyCvd(on);
    $('#cvd-toggle').addEventListener('click', () =>
      applyCvd($('#cvd-toggle').getAttribute('aria-pressed') !== 'true'));
  }

  /** La guida: dialogo modale, il focus torna a chi l'ha aperta. */
  function initHelp() {
    const dlg = $('#help-dlg'), opener = $('#btn-help');
    if (!dlg || !opener) return;
    opener.addEventListener('click', () => {
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    });
    $('#help-close').addEventListener('click', () => {
      if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
      opener.focus();
    });
    dlg.addEventListener('close', () => opener.focus());
  }

  /**
   * Barra comandi: un ticker lo cerca nello screening e lo evidenzia, GUIDA apre
   * la guida. Un comando non trovato compare nel segnaposto per quattro secondi.
   */
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
      const row = state.merged && state.merged.metrics.rows.find((r) => r.t === q);
      if (!row) {
        form.classList.add('err');
        input.placeholder = q + ' non trovato in questo universo';
        clearTimeout(timer);
        timer = setTimeout(() => { form.classList.remove('err'); input.placeholder = base; }, 4000);
        return;
      }
      state.hl = q;
      renderScreenTable();
      const el = $('#screen-tbl [data-sym="' + q + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  let inited = false;
  function init() {
    if (inited) return; // guardia contro doppio DOMContentLoaded
    inited = true;
    initCvd();
    initHelp();
    initCommand();
    if (window.ComaUI) ComaUI.initTooltips();
    renderUniverseSelect();
    renderScreenCtrls();
    showLoading();
    bindSeg('#seg-period', 'period', () => { renderBacktest(); renderAttribution(); });
    bindSeg('#seg-scheme', 'scheme', () => { renderKpis(); renderBacktest(); renderAttribution(); renderPortfolio(); renderBasket(); });
    bindSeg('#seg-mode', 'mode', () => { renderKpis(); renderBacktest(); renderAttribution(); });
    $('#btn-save').addEventListener('click', saveSnapshot);
    $('#btn-export').addEventListener('click', exportExcel);
    $('#btn-reset').addEventListener('click', resetFilters);
    ComaStore.init();
    renderSnapshots();
    Promise.all([
      fetch('data/benchmarks.json').then((r) => r.json()).catch(() => null),
      fetch('data/factors.json').then((r) => r.json()).catch(() => null),
    ]).then(([b, f]) => { state.benchmarks = b; state.factors = f; }).finally(loadAndMerge);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
