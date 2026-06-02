/* live.js — ricalcolo IN-SAMPLE e OUT-OF-SAMPLE live nel browser.
 * Lavora su un dataset {metrics, curves} che puo essere un singolo universo o
 * l'UNIONE di piu universi (vedi app.js). Stesso motore della pipeline
 * (engine.js) ma su dati MENSILI (ppy=12): piccole differenze numeriche attese. */
(function () {
  'use strict';
  const E = window.ComaEngine;
  const PPY_M = 12;

  const ymToIdx = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + (m - 1); };
  const idxToYm = (gi) => { const y = Math.floor(gi / 12), m = gi % 12 + 1; return y + '-' + String(m).padStart(2, '0'); };
  const segsOf = (curves) => { const s = {}; for (const t in curves.series) { const c = curves.series[t]; s[t] = { i0: ymToIdx(c.s), p: c.p }; } return s; };

  /** Allinea i ticker su [lo,hi] (indici globali di mese). Scarta chi non copre. */
  function alignRange(tickers, segs, lo, hi) {
    const len = hi - lo + 1; if (len < 6) return null;
    const used = [], prices = {};
    for (const t of tickers) {
      const s = segs[t]; if (!s) continue;
      if (s.i0 > lo || s.i0 + s.p.length - 1 < hi) continue;
      prices[t] = s.p.slice(lo - s.i0, hi - s.i0 + 1); used.push(t);
    }
    if (used.length < 2) return null;
    const R = [];
    for (let i = 1; i < len; i++) R.push(used.map((t) => prices[t][i] / prices[t][i - 1] - 1));
    const months = Array.from({ length: len }, (_, i) => idxToYm(lo + i));
    return { used, prices, R, months, lo, hi, len };
  }

  function weightsFor(R, opt) {
    const wOpt = { floor: opt.weightFloor ?? 0.02, cap: opt.weightCap ?? 0.20, rf: opt.rf ?? 0.03,
      ppy: PPY_M, nSim: opt.nSim || 150, windowYears: opt.windowYears || 5, meanBlock: 3, seed: 42 };
    return { equal: E.computeWeights('equal', R, wOpt), invvol: E.computeWeights('invvol', R, wOpt),
      resampled: E.computeWeights('resampled', R, wOpt) };
  }

  function benchBlock(benchSeg, lo, hi, rf) {
    if (!benchSeg || benchSeg.i0 > lo || benchSeg.i0 + benchSeg.p.length - 1 < hi) return { arr: null, metrics: null };
    const bs = benchSeg.p.slice(lo - benchSeg.i0, hi - benchSeg.i0 + 1);
    const base = bs[0]; const arr = bs.map((x) => (x / base) * 100);
    return { arr, metrics: E.curveMetrics(arr, PPY_M, rf) };
  }

  function backtestSchemes(align, weights, benchSeg, rf) {
    const bk = benchBlock(benchSeg, align.lo, align.hi, rf);
    const schemes = {};
    for (const name of ['equal', 'invvol', 'resampled']) {
      const w = weights[name].weights;
      const eqR = E.backtestPortfolio(align.prices, align.used, w, true);
      const eqB = E.backtestPortfolio(align.prices, align.used, w, false);
      schemes[name] = { rebal: eqR, buyhold: eqB,
        metrics: { rebal: E.curveMetrics(eqR, PPY_M, rf), buyhold: E.curveMetrics(eqB, PPY_M, rf) } };
    }
    return { months: align.months, bench: bk.arr, benchMetrics: bk.metrics, schemes };
  }

  function picksInfo(used, weights, mrowMap) {
    return used.map((t, i) => {
      const r = mrowMap[t] || {};
      return { t, wEqual: weights.equal.weights[i], wInvvol: weights.invvol.weights[i],
        wResampled: weights.resampled.weights[i], quality: r.quality, cagr: r.cagr, vol: r.vol,
        mdd: r.mdd, min5y: r.min5y, r2: r.r2, reg: r.reg, mar: r.mar };
    });
  }

  // ---- IN-SAMPLE -----------------------------------------------------------
  function build(available, dropped, metrics, curves, opt) {
    opt = opt || {};
    const segs = segsOf(curves);
    const benchSeg = curves.bench ? { i0: ymToIdx(curves.bench.s), p: curves.bench.p } : null;
    let lo = -Infinity, hi = Infinity;
    const valid = available.filter((t) => segs[t]);
    if (valid.length < 2) return { picks: [], dropped, insufficient: true };
    for (const t of valid) { const s = segs[t]; lo = Math.max(lo, s.i0); hi = Math.min(hi, s.i0 + s.p.length - 1); }
    if (benchSeg) { lo = Math.max(lo, benchSeg.i0); hi = Math.min(hi, benchSeg.i0 + benchSeg.p.length - 1); }
    if (hi - lo + 1 < (opt.minMonths || 36)) return { picks: [], dropped, insufficient: true };
    const align = alignRange(valid, segs, lo, hi);
    if (!align) return { picks: [], dropped, insufficient: true };
    const weights = weightsFor(align.R, opt);
    const mrowMap = {}; metrics.rows.forEach((r) => (mrowMap[r.t] = r));
    return { picks: picksInfo(align.used, weights, mrowMap), dropped, insufficient: false,
      scenarios: weights.resampled.scenarios, backtest: backtestSchemes(align, weights, benchSeg, opt.rf ?? 0.03) };
  }

  function recompute(metrics, curves, thresholds, opt) {
    const scr = E.screen(metrics.rows, { ...thresholds, ppy: 252, sortBy: 'quality' });
    const wanted = scr.picks.map((r) => r.t);
    const available = wanted.filter((t) => curves.series[t]);
    const res = build(available, wanted.length - available.length, metrics, curves, opt);
    res.scr = scr;
    return res;
  }

  function recomputeFromTickers(metrics, curves, tickers, opt) {
    const uniq = [...new Set(tickers)];
    const available = uniq.filter((t) => curves.series[t]);
    return build(available, uniq.length - available.length, metrics, curves, opt);
  }

  // ---- OUT-OF-SAMPLE (walk-forward dalle curve mensili) --------------------
  function recomputeOOS(curves, thresholds, opt) {
    opt = opt || {};
    const rf = opt.rf ?? 0.03;
    const cutoffYears = opt.oosCutoffYears || 7, oosMinYears = opt.oosMinYears || 12;
    const nowIdx = ymToIdx(new Date().toISOString().slice(0, 7));
    const cutoffIdx = nowIdx - cutoffYears * 12;
    const minPre = Math.round(oosMinYears * 12);
    const segs = segsOf(curves);
    const benchSeg = curves.bench ? { i0: ymToIdx(curves.bench.s), p: curves.bench.p } : null;

    // metriche pre-cutoff (mensili) per lo screen out-of-sample
    const rows = [], preLenMap = {};
    for (const t in segs) {
      const { i0, p } = segs[t];
      const preLen = Math.min(p.length, cutoffIdx - i0 + 1);
      if (preLen < minPre) continue;
      const post = p.length - preLen;
      if (post < 12) continue;            // serve abbastanza storia POST per testare
      preLenMap[t] = preLen;
      const m = E.metricsFor(p.slice(0, preLen), PPY_M, rf);
      rows.push({ t, days: preLen, cagr: m.cagr, vol: m.vol, mdd: m.mdd, min5y: m.min5y,
        r2: m.r2, reg: m.reg, mar: m.mar, sortino: m.sortino, sharpe: m.sharpe, score: m.score });
    }
    if (rows.length < 2) return { insufficient: true };
    E.addQualityScore(rows);
    const scr = E.screen(rows, { ...thresholds, minYears: oosMinYears, ppy: PPY_M, sortBy: 'quality' });
    const avail = scr.picks.map((r) => r.t);
    if (avail.length < 2) return { insufficient: true };

    // pesi sui rendimenti PRE-cutoff (decisi out-of-sample)
    let lo = -Infinity, hi = -Infinity;
    for (const t of avail) { const s = segs[t]; lo = Math.max(lo, s.i0); hi = hi === -Infinity ? cutoffIdx : hi; }
    hi = cutoffIdx;
    for (const t of avail) hi = Math.min(hi, segs[t].i0 + preLenMap[t] - 1);
    const preAlign = alignRange(avail, segs, lo, hi);
    if (!preAlign) return { insufficient: true };
    const weights = weightsFor(preAlign.R, opt);

    // backtest sul periodo POST-cutoff con quei pesi
    let plo = cutoffIdx + 1, phi = Infinity;
    for (const t of preAlign.used) phi = Math.min(phi, segs[t].i0 + segs[t].p.length - 1);
    if (benchSeg) phi = Math.min(phi, benchSeg.i0 + benchSeg.p.length - 1);
    const postAlign = alignRange(preAlign.used, segs, plo, phi);
    if (!postAlign) return { insufficient: true };
    // riallinea i pesi all'eventuale sottoinsieme che copre il post
    const wIdx = {}; preAlign.used.forEach((t, i) => (wIdx[t] = i));
    const reW = (arr) => { let w = postAlign.used.map((t) => arr[wIdx[t]]); const s = w.reduce((a, b) => a + b, 0); return w.map((x) => x / s); };
    const weights2 = { equal: { weights: reW(weights.equal.weights) },
      invvol: { weights: reW(weights.invvol.weights) }, resampled: { weights: reW(weights.resampled.weights) } };
    const bt = backtestSchemes(postAlign, weights2, benchSeg, rf);
    return { insufficient: false, cutoff: idxToYm(cutoffIdx), picks: postAlign.used, backtest: bt };
  }

  window.ComaLive = { recompute, recomputeFromTickers, recomputeOOS };
})();
