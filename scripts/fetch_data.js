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
const { fetchSeries, fetchMany } = require('./yahoo');

const PPY = 252;
const DATA_DIR = path.join(__dirname, '..', 'data');

// Parametri canonici (allineati al Colab, ma con backtest reso onesto)
const PARAMS = {
  minYears: 15, tolerance5y: -0.05, minR2: 0.90, minCagr: 0.10, maxDD: -0.45,
  topN: 20, sortBy: 'quality',
  weightFloor: 0.02, weightCap: 0.20, nSim: 500, windowYears: 5, rf: 0.03,
  oosCutoffYears: 7,   // ultimi 7 anni tenuti fuori campione per la validazione
  oosMinYears: 12,     // storia minima richiesta NEL pre-cutoff per lo screen OOS
};

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

function metricsRows(eur) {
  const rows = [];
  for (const t of Object.keys(eur)) {
    const s = eur[t];
    if (s.px.length < 30) continue;
    const m = E.metricsFor(s.px, PPY, PARAMS.rf);
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

/** Screen -> pesi per TUTTI gli schemi su un set di serie EUR (eventualmente troncate). */
function buildPortfolio(rows, eur, params) {
  const scr = E.screen(rows, { ...params, ppy: PPY, sortBy: 'quality' });
  const picks = scr.picks.map((r) => r.t).filter((t) => eur[t] && eur[t].px.length > PPY);
  if (picks.length < 2) return null;
  const al = alignPicks(picks, eur);
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
 */
function backtestSchemes(picks, schemeWeights, eur, benchEur) {
  const al = alignPicks(picks, eur);
  if (al.ts.length < 30) return null;
  // benchmark allineato in EUR, base 100
  let benchDaily = null;
  if (benchEur) {
    const bm = new Map(benchEur.ts.map((d, i) => [d, benchEur.px[i]]));
    const bvals = al.ts.map((d) => (bm.has(d) ? bm.get(d) : null));
    for (let i = 1; i < bvals.length; i++) if (bvals[i] == null) bvals[i] = bvals[i - 1];
    const i0 = bvals.findIndex((x) => x != null);
    if (i0 >= 0) { const base = bvals[i0]; benchDaily = bvals.map((x) => (x == null ? null : (x / base) * 100)); }
  }
  const months = toMonthly(al.ts, al.prices[picks[0]]).months;
  const out = {
    from: ymd(al.ts[0]), to: ymd(al.ts[al.ts.length - 1]), months,
    bench: benchDaily ? toMonthly(al.ts, benchDaily).vals : null,
    benchMetrics: benchDaily ? E.curveMetrics(benchDaily.filter((x) => x != null), PPY, PARAMS.rf) : null,
    schemes: {},
  };
  for (const [name, w] of Object.entries(schemeWeights)) {
    const eqR = E.backtestPortfolio(al.prices, picks, w, true);
    const eqB = E.backtestPortfolio(al.prices, picks, w, false);
    out.schemes[name] = {
      rebal: toMonthly(al.ts, eqR).vals, buyhold: toMonthly(al.ts, eqB).vals,
      metrics: { rebal: E.curveMetrics(eqR, PPY, PARAMS.rf), buyhold: E.curveMetrics(eqB, PPY, PARAMS.rf) },
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

  // benchmark in EUR
  let benchEur = null;
  const braw = await fetchSeries(cfg.benchmark);
  if (braw) { const be = toEur(braw, fx); if (be) benchEur = { ts: be.ts, px: be.px }; }

  // metriche
  const rows = metricsRows(eur);

  // portafoglio canonico (full sample)
  const canon = buildPortfolio(rows, eur, PARAMS);
  let portfolioOut = { universe: uname, label: cfg.label, benchmark: cfg.benchmark, params: PARAMS };

  const schemeWeights = (port) => Object.fromEntries(SCHEMES.map((s) => [s, port.schemes[s].weights]));

  if (canon) {
    const sw = schemeWeights(canon);
    const picksInfo = canon.picks.map((t, i) => {
      const r = rows.find((x) => x.t === t);
      return { t, wEqual: sw.equal[i], wInvvol: sw.invvol[i], wResampled: sw.resampled[i],
        wstd: canon.schemes.resampled.std[i], cagr: r.cagr, vol: r.vol, mdd: r.mdd,
        min5y: r.min5y, r2: r.r2, reg: r.reg, mar: r.mar, quality: r.quality };
    }); // ordine = selezione per quality (gia ordinato da screen)
    const bt = backtestSchemes(canon.picks, sw, eur, benchEur);
    portfolioOut.canonical = { picks: picksInfo, scenarios: canon.schemes.resampled.scenarios,
      skipped: canon.scr.skipped, passed: canon.scr.passed, backtest: bt };
    const ic = bt && bt.schemes.equal.metrics.rebal.cagr;
    log(`Canonico: ${canon.picks.length} titoli | in-sample equipeso CAGR ${(ic * 100).toFixed(1)}%`);
  } else log('Canonico: nessun titolo supera i filtri');

  // OUT-OF-SAMPLE: screen+pesi su pre-cutoff, test sul post-cutoff
  const cutoff = Math.floor(Date.now() / 1000) - PARAMS.oosCutoffYears * 365 * 86400;
  const eurPre = sliceEur(eur, 0, cutoff);
  const eurPost = sliceEur(eur, cutoff, Infinity);
  const rowsPre = metricsRows(eurPre);
  const oosParams = { ...PARAMS, minYears: PARAMS.oosMinYears };
  const oos = buildPortfolio(rowsPre, eurPre, oosParams);
  if (oos) {
    const validPicks = oos.picks.filter((t) => eurPost[t] && eurPost[t].px.length > 60);
    if (validPicks.length >= 2) {
      const swPre = schemeWeights(oos);
      // restringe e rinormalizza i pesi di ogni schema ai titoli con dati post-cutoff
      const swValid = {};
      for (const s of SCHEMES) {
        const map = {}; oos.picks.forEach((t, i) => (map[t] = swPre[s][i]));
        let w = validPicks.map((t) => map[t]); const tot = w.reduce((a, b) => a + b, 0);
        swValid[s] = w.map((x) => x / tot);
      }
      const bt = backtestSchemes(validPicks, swValid, eurPost, benchEur);
      portfolioOut.oos = { cutoff: ymd(cutoff), minYears: PARAMS.oosMinYears,
        picks: validPicks.map((t, i) => ({ t, wEqual: swValid.equal[i],
          wInvvol: swValid.invvol[i], wResampled: swValid.resampled[i] })), backtest: bt };
      if (bt) log(`OOS (post ${ymd(cutoff)}): ${validPicks.length} titoli | equipeso ` +
        `CAGR ${(bt.schemes.equal.metrics.rebal.cagr * 100).toFixed(1)}% vs bench ` +
        `${bt.benchMetrics ? (bt.benchMetrics.cagr * 100).toFixed(1) + '%' : 'n/d'}`);
    } else log('OOS: troppi pochi titoli con dati post-cutoff');
  } else log('OOS: nessun titolo supera i filtri pre-cutoff');

  // curve mensili EUR per il pool eleggibile (per ribilanciamenti custom nel browser)
  // pool ampio (storia >= 8 anni) per supportare il ricalcolo live su tutto il range slider
  const eligible = rows.filter((r) => r.days >= 8 * PPY).map((r) => r.t);
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

  fs.writeFileSync(path.join(DATA_DIR, `metrics_${uname}.json`), JSON.stringify(metricsOut));
  fs.writeFileSync(path.join(DATA_DIR, `curves_${uname}.json`), JSON.stringify(curvesOut));
  fs.writeFileSync(path.join(DATA_DIR, `portfolio_${uname}.json`), JSON.stringify(portfolioOut, null, 1));
  log(`Scritti: metrics_${uname}.json (${rows.length} righe), curves_${uname}.json (${eligible.length} curve), portfolio_${uname}.json`);

  return { uname, count: rows.length, eligible: eligible.length };
}

(async () => {
  const args = process.argv.slice(2);
  const targets = args.length ? args : ['SP500'];
  const summary = [];
  for (const u of targets) summary.push(await run(u));
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
