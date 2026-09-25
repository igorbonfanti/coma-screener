/* ============================================================================
 * fetch_data.js — PIPELINE DATI coma-screener (gira in GitHub Action e in locale)
 *
 *   node fetch_data.js SP500
 *   node fetch_data.js STOXX600
 *
 * Per ogni universo:
 *  1. carica i ticker  2. scarica storico giornaliero (Yahoo)  3. converte in EUR
 *  4. calcola metriche  5. screen canonico + pesi resampled + backtest in-sample
 *  6. backtest OUT-OF-SAMPLE (walk-forward, split temporale)  7. scrive data/*.json
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./engine');
const X = require('./entry');
const { fetchSeries, fetchMany } = require('./yahoo');

const PPY = 252;
const DATA_DIR = path.join(__dirname, '..', 'data');

// Parametri canonici (allineati al Colab, ma con backtest reso onesto)
const PARAMS = {
  minYears: 15, tolerance5y: -0.05, minR2: 0.90, minCagr: 0.10, maxDD: -0.45,
  topN: 20, sortBy: 'quality',
  weightFloor: 0.02, weightCap: 0.20, nSim: 500, windowYears: 5, rf: 0.03,
  rebalance: 'annual', // ribilanciamento realizzabile (era: ogni giorno di borsa)
  costBps: 15,         // 0.15% sul notional scambiato: commissioni + spread retail
  oosCutoffYears: 7,   // ultimi 7 anni tenuti fuori campione per la validazione
  oosMinYears: 12,     // storia minima richiesta NEL pre-cutoff per lo screen OOS
};

// Proxy del risk-free in EUR: ETF monetario overnight (€STR capitalizzato).
// Storia dal 2008; prima si usa la costante E.RF_DEFAULT (~media EONIA 2000-07).
const RF_SYMBOL = 'XEON.DE';

// ---- util ------------------------------------------------------------------
const ymd = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const ym = (sec) => new Date(sec * 1000).toISOString().slice(0, 7);
const log = (...a) => console.log(...a);

/** Downsample a fine mese: ultimo prezzo di ogni mese. */
function toMonthly(ts, px) {
  const months = [], vals = [];
  let cur = null;
  for (let i = 0; i < ts.length; i++) {
    const m = ym(ts[i]);
    if (m !== cur) { months.push(m); vals.push(px[i]); cur = m; }
    else vals[vals.length - 1] = px[i];
  }
  return { months, vals };
}

// ---- universo --------------------------------------------------------------
async function loadTickers(uname, cfg) {
  // liste ticker da file di testo (uno per riga), es. NASDAQ+NYSE
  if (cfg.txtSources && cfg.txtSources.length) {
    const set = new Set();
    for (const url of cfg.txtSources) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const text = await res.text();
        for (let line of text.split('\n')) {
          line = line.trim().toUpperCase().replace(/\./g, '-');
          if (line && line.length <= 6 && !['NAN', 'SYMBOL', 'TICKER'].includes(line)) set.add(line);
        }
      } catch (e) { log(`  errore fonte txt ${url}: ${e.message}`); }
    }
    const out = [...set].concat(cfg.tickers || []);
    log(`  ${uname}: ${out.length} ticker da liste txt`);
    return out;
  }
  if (cfg.tickers && cfg.tickers.length && !cfg.source) return cfg.tickers.slice();
  if (cfg.source) {
    try {
      const res = await fetch(cfg.source, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const text = await res.text();
      const lines = text.trim().split('\n');
      const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
      const symIdx = header.indexOf('symbol');
      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const sym = lines[i].split(',')[symIdx];
        if (sym) out.push(sym.trim().replace(/\./g, '-'));
      }
      log(`  ${uname}: ${out.length} ticker da fonte live`);
      return out.concat(cfg.tickers || []);
    } catch (e) {
      log(`  errore fonte ${uname}: ${e.message}`);
      return cfg.tickers ? cfg.tickers.slice() : [];
    }
  }
  return cfg.tickers ? cfg.tickers.slice() : [];
}

// ---- FX -> EUR -------------------------------------------------------------
async function buildFx(currencies) {
  const need = new Set();
  for (const c of currencies) {
    const ccy = c === 'GBp' ? 'GBP' : c; // pence -> sterline
    if (ccy && ccy !== 'EUR') need.add(ccy);
  }
  const fx = {}; // ccy -> {ts:[], rate:[]}  (rate = unita di ccy per 1 EUR)
  for (const ccy of need) {
    const s = await fetchSeries(`EUR${ccy}=X`);
    if (s) fx[ccy] = { ts: s.ts, rate: s.px };
    else log(`  WARN: FX EUR${ccy} non disponibile`);
  }
  return fx;
}

/** Converte una serie in EUR. Ritorna {ts, px} (in EUR), scartando i punti senza FX. */
function toEur(series, fx) {
  let ccy = series.currency || 'USD';
  const pence = ccy === 'GBp';
  if (pence) ccy = 'GBP';
  if (ccy === 'EUR') return { ts: series.ts.slice(), px: series.px.slice() };
  const f = fx[ccy];
  if (!f) return null;
  const ts = [], px = [];
  let j = 0;
  for (let i = 0; i < series.ts.length; i++) {
    while (j + 1 < f.ts.length && f.ts[j + 1] <= series.ts[i]) j++;
    if (f.ts[j] > series.ts[i] && j === 0) continue; // prima dell'inizio FX
    const rate = f.rate[j];
    if (!rate || rate <= 0) continue;
    let p = series.px[i];
    if (pence) p /= 100;
    ts.push(series.ts[i]);
    px.push(p / rate);
  }
  return px.length > 2 ? { ts, px } : null;
}

// ---- allineamento per portafoglio -----------------------------------------
/** Interseca le date dei ticker selezionati. Ritorna {ts, prices:{t:[...]}, rets:[[...]]}. */
function alignPicks(picks, eur) {
  const maps = picks.map((t) => {
    const s = eur[t]; const m = new Map();
    for (let i = 0; i < s.ts.length; i++) m.set(s.ts[i], s.px[i]);
    return m;
  });
  // intersezione sulle date del primo (poi filtra)
  let common = [...maps[0].keys()];
  for (let k = 1; k < maps.length; k++) common = common.filter((d) => maps[k].has(d));
  common.sort((a, b) => a - b);
  const prices = {}; picks.forEach((t) => (prices[t] = []));
  for (const d of common) picks.forEach((t, k) => prices[t].push(maps[k].get(d)));
  // matrice rendimenti
  const rets = [];
  for (let i = 1; i < common.length; i++) {
    rets.push(picks.map((t) => prices[t][i] / prices[t][i - 1] - 1));
  }
  return { ts: common, prices, rets };
}

// ---- risk-free -------------------------------------------------------------
/**
 * Rendimenti del conto cash per periodo, allineati a `ts` (lunghezza ts.length-1).
 * Forward-fill dell'ETF monetario; prima del suo inizio, costante E.RF_DEFAULT.
 */
function rfReturnsFor(ts, rfSer, ppy) {
  const flat = Math.pow(1 + E.RF_DEFAULT, 1 / ppy) - 1;
  if (!rfSer || !rfSer.ts.length) return ts.slice(1).map(() => flat);
  const vals = [];
  let last = null, j = 0;
  for (const d of ts) {
    while (j < rfSer.ts.length && rfSer.ts[j] <= d) { last = rfSer.px[j]; j++; }
    vals.push(last);
  }
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    out.push(vals[i - 1] > 0 && vals[i] > 0 ? vals[i] / vals[i - 1] - 1 : flat);
  }
  return out;
}

function metricsRows(eur, rfSer) {
  const rows = [];
  for (const t of Object.keys(eur)) {
    const s = eur[t];
    if (s.px.length < 30) continue;
    const m = E.metricsFor(s.px, PPY, rfReturnsFor(s.ts, rfSer, PPY));
    rows.push({
      t, ccy: s.currency, days: s.px.length,
      start: ymd(s.ts[0]), end: ymd(s.ts[s.ts.length - 1]),
      cagr: m.cagr, vol: m.vol, mdd: m.mdd, min5y: m.min5y, r2: m.r2, reg: m.reg,
      mar: m.mar, sortino: m.sortino, sharpe: m.sharpe, score: m.score,
    });
  }
  E.addQualityScore(rows); // Coma Quality Score (percentili R2/Min5Y/MAR sull'universo)
  return rows;
}

const SCHEMES = ['equal', 'invvol', 'resampled'];

/**
 * Screen -> pesi per TUTTI gli schemi.
 * `rows` porta le metriche di selezione (storia piena); `eurW` e la finestra su
 * cui si stimano i pesi e si esegue il backtest: sono cose diverse e vanno tenute
 * separate, altrimenti il periodo di test dipende dai titoli selezionati.
 */
function buildPortfolio(rows, eurW, params) {
  const scr = E.screen(rows, { ...params, ppy: PPY, sortBy: 'quality' });
  const picks = scr.picks.map((r) => r.t).filter((t) => eurW[t] && eurW[t].px.length > PPY);
  if (picks.length < 2) return null;
  const al = alignPicks(picks, eurW);
  if (al.rets.length < PPY) return null;
  const opt = { floor: params.weightFloor, cap: params.weightCap, rf: params.rf,
    ppy: PPY, nSim: params.nSim, windowYears: params.windowYears, seed: 42 };
  const schemes = {};
  for (const s of SCHEMES) schemes[s] = E.computeWeights(s, al.rets, opt);
  return { scr, picks, align: al, schemes };
}

/** Tronca le serie EUR a [from,to] (sec). */
function sliceEur(eur, from, to) {
  const out = {};
  for (const t of Object.keys(eur)) {
    const s = eur[t]; const ts = [], px = [];
    for (let i = 0; i < s.ts.length; i++) {
      if (s.ts[i] >= (from || 0) && s.ts[i] <= (to || Infinity)) { ts.push(s.ts[i]); px.push(s.px[i]); }
    }
    if (px.length > 2) out[t] = { ts, px, currency: s.currency };
  }
  return out;
}

/**
 * Backtest dei picks per TUTTI gli schemi (i picks sono identici → allineamento
 * e benchmark calcolati una volta sola, condivisi). schemeWeights = {nome:[pesi]}.
 * Il ribilanciamento e alla frequenza di PARAMS.rebalance e paga PARAMS.costBps
 * sul notional scambiato; per ogni schema viene stimata anche la regressione sul
 * benchmark (alfa, beta, t-stat) — l'unico modo per distinguere skill da beta.
 */
function backtestSchemes(picks, schemeWeights, eur, benchEur, rfSer) {
  const al = alignPicks(picks, eur);
  if (al.ts.length < 30) return null;
  // benchmark allineato in EUR, base 100 (forward-fill dei giorni mancanti)
  let benchDaily = null;
  if (benchEur) {
    const bm = new Map(benchEur.ts.map((d, i) => [d, benchEur.px[i]]));
    const bvals = al.ts.map((d) => (bm.has(d) ? bm.get(d) : null));
    for (let i = 1; i < bvals.length; i++) if (bvals[i] == null) bvals[i] = bvals[i - 1];
    if (bvals[0] != null) benchDaily = bvals.map((x) => (x / bvals[0]) * 100);
  }
  const rfRet = rfReturnsFor(al.ts, rfSer, PPY);
  const benchRets = benchDaily ? E.periodReturns(benchDaily) : null;
  const bopt = { ppy: PPY, costBps: PARAMS.costBps };
  const months = toMonthly(al.ts, al.prices[picks[0]]).months;
  const out = {
    from: ymd(al.ts[0]), to: ymd(al.ts[al.ts.length - 1]), months,
    rebalance: PARAMS.rebalance, costBps: PARAMS.costBps,
    rfAnn: E.annualizedRf(rfRet, PPY, rfRet.length),
    bench: benchDaily ? toMonthly(al.ts, benchDaily).vals : null,
    benchMetrics: benchDaily ? E.curveMetrics(benchDaily, PPY, rfRet) : null,
    schemes: {},
  };
  for (const [name, w] of Object.entries(schemeWeights)) {
    const eqR = E.backtestPortfolio(al.prices, picks, w, { ...bopt, rebalance: PARAMS.rebalance });
    const eqB = E.backtestPortfolio(al.prices, picks, w, { ...bopt, rebalance: 'none' });
    out.schemes[name] = {
      rebal: toMonthly(al.ts, eqR).vals, buyhold: toMonthly(al.ts, eqB).vals,
      metrics: { rebal: E.curveMetrics(eqR, PPY, rfRet), buyhold: E.curveMetrics(eqB, PPY, rfRet) },
      regression: benchRets ? {
        rebal: E.regress(E.periodReturns(eqR), benchRets, rfRet, PPY),
        buyhold: E.regress(E.periodReturns(eqB), benchRets, rfRet, PPY),
      } : null,
    };
  }
  return out;
}

/**
 * Finestra di backtest FISSA: gli ultimi `years` anni, intersecati con la
 * disponibilita del benchmark. Prima il backtest partiva dall'intersezione delle
 * date dei picks, cioe dall'IPO del titolo piu giovane: muovere uno slider
 * cambiava il PERIODO oltre al paniere, rendendo i confronti privi di senso.
 */
function fixedWindow(years, benchEur, now) {
  let from = Math.floor((now || Date.now()) / 1000) - Math.round(years * 365.25 * 86400);
  if (benchEur && benchEur.ts.length && benchEur.ts[0] > from) from = benchEur.ts[0];
  return from;
}

/** Titoli che coprono davvero la finestra (entro 15 giorni dall'inizio). */
function coveringWindow(picks, eurW, from) {
  return picks.filter((t) => eurW[t] && eurW[t].ts[0] <= from + 15 * 86400);
}

// ---- analisi ingressi (pagina 2) -------------------------------------------
/**
 * Statistiche di drawdown e di strategia d'ingresso per ogni titolo eleggibile,
 * calcolate sui dati GIORNALIERI (le curve spedite al browser sono mensili:
 * troppo grossolane per i trigger sui ribassi). Il browser poi le aggrega sul
 * portafoglio che l'utente ha selezionato.
 *
 * La simulazione gira su serie settimanali: a soglie del 10-20% il segnale non
 * cambia, e costa cinque volte meno.
 */
function entryStatsFor(tickers, eur, rfSer, from) {
  const out = {};
  const rd = (v, d) => (isFinite(v) && v !== null ? +v.toFixed(d) : null);
  for (const t of tickers) {
    const s = eur[t];
    if (!s) continue;
    const i0 = from ? s.ts.findIndex((d) => d >= from) : 0;
    if (i0 < 0) continue;
    const px = s.px.slice(i0), ts = s.ts.slice(i0);
    if (px.length < 6 * PPY) continue;

    const prof = X.drawdownProfile(px, PPY);
    const ddSig = X.runningDrawdown(px);
    const zSig = X.expandingResidZ(px, Math.round(PPY / 2));
    const cond = {};
    for (const h of [1, 3]) {
      const byDd = X.conditionalForward(px, ddSig, X.DD_BUCKETS, h, PPY);
      const byZ = X.conditionalForward(px, zSig, X.Z_BUCKETS, h, PPY);
      if (byDd) cond['dd' + h] = byDd;
      if (byZ) cond['z' + h] = byZ;
    }
    // simulazione su serie settimanale + risk-free allineato
    const step = 5;
    const wPx = [], wTs = [];
    for (let i = 0; i < px.length; i += step) { wPx.push(px[i]); wTs.push(ts[i]); }
    const wRf = rfReturnsFor(wTs, rfSer, PPY / step);
    const cmpOpt = { ppy: PPY / step, minYears: 5, startStep: Math.round(PPY / step / 4) };
    const lump = X.compareEntries(wPx, wRf, { ...cmpOpt, schedule: 'lump' });
    const pac = X.compareEntries(wPx, wRf, { ...cmpOpt, schedule: 'quarterly' });

    const slimCond = (c) => c && ({ h: c.horizonYears,
      u: c.uncond ? { n: c.uncond.n, med: rd(c.uncond.med, 4) } : null,
      b: c.buckets.map((b) => ({ l: b.label, n: b.n, med: rd(b.med, 4), p10: rd(b.p10, 4), neg: rd(b.pNeg, 3) })) });
    const slimCmp = (c) => c && ({ starts: c.starts, r: c.results.map((r) => ({
      id: r.id, med: rd(r.medRel, 4), p10: rd(r.p10Rel, 4), p90: rd(r.p90Rel, 4),
      win: rd(r.winRate, 3), tim: rd(r.timeInMarket, 3), nf: rd(r.neverFired, 3) })) });

    out[t] = {
      years: rd(prof.years, 1), episodes: prof.episodes,
      medDepth: rd(prof.medDepth, 4), p90Depth: rd(prof.p90Depth, 4), maxDepth: rd(prof.maxDepth, 4),
      medFall: rd(prof.medFall, 2), medRecovery: rd(prof.medRecovery, 2), p90Recovery: rd(prof.p90Recovery, 2),
      pctUnderwater: rd(prof.pctUnderwater, 3), pctBelow10: rd(prof.pctBelow10, 3), pctBelow20: rd(prof.pctBelow20, 3),
      openDD: rd(prof.openEpisode, 4), zNow: rd(zSig[zSig.length - 1], 2), ddNow: rd(ddSig[ddSig.length - 1], 4),
      freq: Object.fromEntries(Object.entries(prof.freq).map(([k, v]) => [k,
        { n: v.episodes, per: rd(v.perYear, 3), gap: rd(v.yearsBetween, 2), rec: rd(v.medRecovery, 2) }])),
      cond: Object.fromEntries(Object.entries(cond).map(([k, v]) => [k, slimCond(v)])),
      lump: slimCmp(lump), pac: slimCmp(pac),
    };
  }
  return out;
}

// ---- main ------------------------------------------------------------------
async function run(uname) {
  const universe = JSON.parse(fs.readFileSync(path.join(__dirname, 'universe.json'), 'utf8')).universes;
  const cfg = universe[uname];
  if (!cfg) { log(`Universo sconosciuto: ${uname}`); process.exit(1); }
  log(`\n=== ${uname} (${cfg.label}) ===`);

  const tickers = await loadTickers(uname, cfg);
  log(`Ticker: ${tickers.length}`);

  log('Download storico giornaliero...');
  const raw = await fetchMany(tickers, {
    concurrency: 5, pauseMs: 140,
    onProgress: (d, n) => log(`  ${d}/${n}`),
  });
  log(`Serie scaricate: ${Object.keys(raw).length}/${tickers.length}`);

  // FX -> EUR
  const ccys = [...new Set(Object.values(raw).map((s) => s.currency).filter(Boolean))];
  log(`Valute: ${ccys.join(', ')}`);
  const fx = await buildFx(ccys);
  const eur = {};
  for (const [t, s] of Object.entries(raw)) {
    const e = toEur(s, fx);
    if (e) eur[t] = { ts: e.ts, px: e.px, currency: s.currency };
  }
  log(`Serie convertite in EUR: ${Object.keys(eur).length}`);

  // benchmark in EUR (TOTAL RETURN: vedi BENCHMARKS)
  let benchEur = null;
  const braw = await fetchSeries(cfg.benchmark);
  if (braw) { const be = toEur(braw, fx); if (be) benchEur = { ts: be.ts, px: be.px }; }
  else log(`  WARN: benchmark ${cfg.benchmark} non disponibile`);

  // risk-free EUR (€STR capitalizzato)
  let rfSer = null;
  const rfRaw = await fetchSeries(RF_SYMBOL);
  if (rfRaw) rfSer = { ts: rfRaw.ts, px: rfRaw.px };
  else log(`  WARN: risk-free ${RF_SYMBOL} non disponibile, uso costante ${E.RF_DEFAULT}`);

  // metriche (su tutta la storia disponibile: sono il criterio di SELEZIONE)
  const rows = metricsRows(eur, rfSer);

  let portfolioOut = { universe: uname, label: cfg.label, benchmark: cfg.benchmark,
    benchmarkLabel: BENCHMARKS[cfg.benchmark] || cfg.benchmark, params: PARAMS };

  const schemeWeights = (port) => Object.fromEntries(SCHEMES.map((s) => [s, port.schemes[s].weights]));

  // finestra di TEST fissa: ultimi minYears anni, non dipende dai picks
  const isFrom = fixedWindow(PARAMS.minYears, benchEur);
  const eurWin = sliceEur(eur, isFrom, Infinity);
  log(`Finestra backtest in-sample: da ${ymd(isFrom)} (${PARAMS.minYears} anni, fissa)`);

  const canon = buildPortfolio(rows, eurWin, PARAMS);
  if (canon) {
    const covered = coveringWindow(canon.picks, eurWin, isFrom);
    const dropped = canon.picks.length - covered.length;
    const sw = schemeWeights(canon);
    const wMap = {}; SCHEMES.forEach((s) => { wMap[s] = {}; canon.picks.forEach((t, i) => (wMap[s][t] = sw[s][i])); });
    const swCov = {};
    for (const s of SCHEMES) {
      const w = covered.map((t) => wMap[s][t]); const tot = w.reduce((a, b) => a + b, 0);
      swCov[s] = w.map((x) => x / tot);
    }
    const stdMap = {}; canon.picks.forEach((t, i) => (stdMap[t] = canon.schemes.resampled.std[i]));
    const picksInfo = covered.map((t, i) => {
      const r = rows.find((x) => x.t === t);
      return { t, wEqual: swCov.equal[i], wInvvol: swCov.invvol[i], wResampled: swCov.resampled[i],
        wstd: stdMap[t], cagr: r.cagr, vol: r.vol, mdd: r.mdd,
        min5y: r.min5y, r2: r.r2, reg: r.reg, mar: r.mar, quality: r.quality };
    }); // ordine = selezione per quality (gia ordinato da screen)
    const bt = covered.length >= 2 ? backtestSchemes(covered, swCov, eurWin, benchEur, rfSer) : null;
    portfolioOut.canonical = { picks: picksInfo, scenarios: canon.schemes.resampled.scenarios,
      skipped: canon.scr.skipped, passed: canon.scr.passed, dropped, window: ymd(isFrom), backtest: bt };
    if (bt) {
      const m = bt.schemes.equal.metrics.rebal, g = bt.schemes.equal.regression;
      log(`Canonico: ${covered.length} titoli${dropped ? ` (${dropped} senza copertura finestra)` : ''} | ` +
        `IS equipeso CAGR ${(m.cagr * 100).toFixed(1)}% vs bench ` +
        `${bt.benchMetrics ? (bt.benchMetrics.cagr * 100).toFixed(1) + '%' : 'n/d'}` +
        (g && g.rebal ? ` | beta ${g.rebal.beta.toFixed(2)} alfa ${(g.rebal.alpha * 100).toFixed(1)}% (t ${g.rebal.alphaT.toFixed(2)})` : ''));
    } else log(`Canonico: solo ${covered.length} titoli coprono la finestra`);
  } else log('Canonico: nessun titolo supera i filtri');

  // OUT-OF-SAMPLE: screen+pesi su pre-cutoff, test sul post-cutoff
  const cutoff = Math.floor(Date.now() / 1000) - PARAMS.oosCutoffYears * 365 * 86400;
  const eurPre = sliceEur(eur, 0, cutoff);
  const eurPost = sliceEur(eur, cutoff, Infinity);
  const rowsPre = metricsRows(eurPre, rfSer);
  const oosParams = { ...PARAMS, minYears: PARAMS.oosMinYears };
  const oos = buildPortfolio(rowsPre, eurPre, oosParams);
  if (oos) {
    // la finestra post-cutoff e gia fissa; si richiede pero copertura PIENA,
    // altrimenti l'intersezione di alignPicks accorcia il test per tutti
    const postFrom = fixedWindow(PARAMS.oosCutoffYears, benchEur);
    const validPicks = coveringWindow(oos.picks, eurPost, postFrom);
    if (validPicks.length >= 2) {
      const swPre = schemeWeights(oos);
      // restringe e rinormalizza i pesi di ogni schema ai titoli con dati post-cutoff
      const swValid = {};
      for (const s of SCHEMES) {
        const map = {}; oos.picks.forEach((t, i) => (map[t] = swPre[s][i]));
        let w = validPicks.map((t) => map[t]); const tot = w.reduce((a, b) => a + b, 0);
        swValid[s] = w.map((x) => x / tot);
      }
      const bt = backtestSchemes(validPicks, swValid, eurPost, benchEur, rfSer);
      portfolioOut.oos = { cutoff: ymd(cutoff), minYears: PARAMS.oosMinYears,
        dropped: oos.picks.length - validPicks.length,
        picks: validPicks.map((t, i) => ({ t, wEqual: swValid.equal[i],
          wInvvol: swValid.invvol[i], wResampled: swValid.resampled[i] })), backtest: bt };
      if (bt) {
        const g = bt.schemes.equal.regression;
        log(`OOS (post ${ymd(cutoff)}): ${validPicks.length} titoli | equipeso ` +
          `CAGR ${(bt.schemes.equal.metrics.rebal.cagr * 100).toFixed(1)}% vs bench ` +
          `${bt.benchMetrics ? (bt.benchMetrics.cagr * 100).toFixed(1) + '%' : 'n/d'}` +
          (g && g.rebal ? ` | beta ${g.rebal.beta.toFixed(2)} alfa ${(g.rebal.alpha * 100).toFixed(1)}% (t ${g.rebal.alphaT.toFixed(2)})` : ''));
      }
    } else log('OOS: troppi pochi titoli con copertura piena del post-cutoff');
  } else log('OOS: nessun titolo supera i filtri pre-cutoff');

  // curve mensili EUR per il pool eleggibile (per ribilanciamenti custom nel browser)
  // pool per il ricalcolo live: storia >= 8 anni e R2 >= 0.70 (= minimo degli slider),
  // così copre ogni selezione possibile senza gonfiare il file con la coda di junk.
  const eligible = rows.filter((r) => r.days >= 8 * PPY && r.r2 >= 0.70).map((r) => r.t);
  const curvesOut = { updated: new Date().toISOString(), base: 'EUR', freq: 'M', series: {} };
  for (const t of eligible) {
    const m = toMonthly(eur[t].ts, eur[t].px);
    curvesOut.series[t] = { s: m.months[0], p: m.vals.map((x) => +x.toFixed(4)) };
  }
  if (benchEur) {
    const mb = toMonthly(benchEur.ts, benchEur.px);
    curvesOut.bench = { s: mb.months[0], p: mb.vals.map((x) => +x.toFixed(4)) };
  }

  // scrittura
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const metricsOut = { updated: new Date().toISOString(), base: 'EUR', universe: uname,
    label: cfg.label, params: PARAMS, count: rows.length,
    rows: rows.map((r) => { const rd = (v, d) => (isFinite(v) ? +v.toFixed(d) : null); return { ...r,
      cagr: rd(r.cagr, 4), vol: rd(r.vol, 4), mdd: rd(r.mdd, 4), min5y: rd(r.min5y, 4),
      r2: rd(r.r2, 4), reg: rd(r.reg, 4), mar: rd(r.mar, 3), sortino: rd(r.sortino, 3),
      sharpe: rd(r.sharpe, 3), score: rd(r.score, 3), quality: rd(r.quality, 4) }; }) };
  portfolioOut.updated = new Date().toISOString();

  // analisi ingressi: su TUTTA la storia disponibile, non sulla finestra a 15
  // anni del backtest. La finestra fissa parte dal 2011 e si perderebbe il 2008,
  // cioe l'unico vero stress test presente nel campione.
  const t0 = Date.now();
  const entryOut = { updated: new Date().toISOString(), base: 'EUR', universe: uname,
    note: 'storia piena; simulazione settimanale; liquidita remunerata al risk-free',
    strategies: X.defaultStrategies().map((s) => ({ id: s.id, label: s.label })),
    tickers: entryStatsFor(eligible, eur, rfSer, 0) };
  fs.writeFileSync(path.join(DATA_DIR, `entry_${uname}.json`), JSON.stringify(entryOut));
  log(`Analisi ingressi: ${Object.keys(entryOut.tickers).length} titoli in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  fs.writeFileSync(path.join(DATA_DIR, `metrics_${uname}.json`), JSON.stringify(metricsOut));
  fs.writeFileSync(path.join(DATA_DIR, `curves_${uname}.json`), JSON.stringify(curvesOut));
  fs.writeFileSync(path.join(DATA_DIR, `portfolio_${uname}.json`), JSON.stringify(portfolioOut, null, 1));
  log(`Scritti: metrics_${uname}.json (${rows.length} righe), curves_${uname}.json (${eligible.length} curve), portfolio_${uname}.json`);

  return { uname, count: rows.length, eligible: eligible.length };
}

// Benchmark globali, scelti dall'app in base alla selezione di universi.
// TUTTI total return: i titoli usano l'adjusted close (dividendi reinvestiti),
// quindi confrontarli con un indice price-only regala 1-3 pp/anno alla strategia.
const BENCHMARKS = {
  '^SP500TR': 'S&P 500 Total Return',
  '^XCMP': 'NASDAQ Composite Total Return',
  'VTI': 'US Total Market TR (proxy NYSE)',
};
async function generateBenchmarks() {
  log('Genero benchmarks.json...');
  const raw = {};
  for (const sym of Object.keys(BENCHMARKS)) {
    const s = await fetchSeries(sym);
    if (s) raw[sym] = s; else log(`  WARN: benchmark ${sym} non disponibile`);
  }
  const ccys = [...new Set(Object.values(raw).map((s) => s.currency).filter(Boolean))];
  const fx = await buildFx(ccys);
  const out = { updated: new Date().toISOString(), base: 'EUR', series: {} };
  for (const [sym, s] of Object.entries(raw)) {
    const e = toEur(s, fx); if (!e) continue;
    const m = toMonthly(e.ts, e.px);
    out.series[sym] = { label: BENCHMARKS[sym], s: m.months[0], p: m.vals.map((x) => +x.toFixed(4)) };
  }
  // cambio EUR/USD mensile: i fattori di French e AQR sono in dollari, quindi
  // il browser deve riconvertire i rendimenti di portafoglio prima di regredire
  if (fx.USD && fx.USD.ts.length) {
    const m = toMonthly(fx.USD.ts, fx.USD.rate);
    out.fx = { symbol: 'EURUSD=X', label: 'Dollari per euro', s: m.months[0],
      p: m.vals.map((x) => +x.toFixed(6)) };
  }

  // serie risk-free EUR (€STR capitalizzato): serve al browser per Sharpe/alfa
  const rfRaw = await fetchSeries(RF_SYMBOL);
  if (rfRaw) {
    const m = toMonthly(rfRaw.ts, rfRaw.px);
    out.rf = { symbol: RF_SYMBOL, label: 'Risk-free EUR (€STR)', s: m.months[0], p: m.vals.map((x) => +x.toFixed(4)) };
  } else log(`  WARN: risk-free ${RF_SYMBOL} non disponibile`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'benchmarks.json'), JSON.stringify(out));
  log(`Scritto benchmarks.json (${Object.keys(out.series).length} indici` +
    `${out.rf ? ' + risk-free' : ''}${out.fx ? ' + cambio' : ''})`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === 'BENCH') { await generateBenchmarks(); return; }
  const targets = args.length ? args : ['SP500'];
  const summary = [];
  for (const u of targets) summary.push(await run(u));
  await generateBenchmarks(); // tiene benchmarks.json fresco a ogni run
  // meta globale
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const metaPath = path.join(DATA_DIR, 'meta.json');
  let meta = {};
  if (fs.existsSync(metaPath)) { try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {} }
  meta.updated = new Date().toISOString();
  meta.universes = meta.universes || {};
  for (const s of summary) meta.universes[s.uname] = { count: s.count, eligible: s.eligible, updated: meta.updated };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  log('\nFatto.');
})().catch((e) => { console.error(e); process.exit(1); });
