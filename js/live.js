/* live.js — ricalcolo IN-SAMPLE live nel browser.
 * Ri-screena le metriche (o usa una lista di titoli scelti a mano), ricostruisce
 * i rendimenti mensili dalle curve (curves_<U>.json) e ricalcola picks + pesi
 * (3 schemi) + backtest. Stesso motore della pipeline (engine.js) ma su dati
 * MENSILI (ppy=12): piccole differenze numeriche attese. OOS resta pre-calcolato. */
(function () {
  'use strict';
  const E = window.ComaEngine;
  const PPY_M = 12;

  const ymToIdx = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + (m - 1); };
  const idxToYm = (gi) => { const y = Math.floor(gi / 12), m = gi % 12 + 1; return y + '-' + String(m).padStart(2, '0'); };

  /** Core: dato l'elenco `available` di ticker con curva, calcola pesi+backtest. */
  function build(available, dropped, metrics, curves, opt) {
    opt = opt || {};
    const floor = opt.weightFloor ?? 0.02, cap = opt.weightCap ?? 0.20, rf = opt.rf ?? 0.03;
    const minMonths = opt.minMonths || 36;
    if (available.length < 2) return { picks: [], dropped, insufficient: true };

    const segs = available.map((t) => {
      const c = curves.series[t]; const i0 = ymToIdx(c.s); return { t, i0, end: i0 + c.p.length - 1, p: c.p };
    });
    let lo = Math.max(...segs.map((s) => s.i0));
    let hi = Math.min(...segs.map((s) => s.end));
    let benchSeg = null;
    if (curves.bench) {
      const bi0 = ymToIdx(curves.bench.s);
      benchSeg = { i0: bi0, end: bi0 + curves.bench.p.length - 1, p: curves.bench.p };
      lo = Math.max(lo, bi0); hi = Math.min(hi, benchSeg.end);
    }
    if (hi - lo + 1 < minMonths) return { picks: [], dropped, insufficient: true };

    const len = hi - lo + 1;
    const months = Array.from({ length: len }, (_, i) => idxToYm(lo + i));
    const prices = {};
    for (const s of segs) prices[s.t] = s.p.slice(lo - s.i0, hi - s.i0 + 1);

    const R = [];
    for (let i = 1; i < len; i++) R.push(available.map((t) => prices[t][i] / prices[t][i - 1] - 1));

    const wOpt = { floor, cap, rf, ppy: PPY_M, nSim: opt.nSim || 150,
      windowYears: opt.windowYears || 5, meanBlock: 3, seed: 42 };
    const weights = {
      equal: E.computeWeights('equal', R, wOpt),
      invvol: E.computeWeights('invvol', R, wOpt),
      resampled: E.computeWeights('resampled', R, wOpt),
    };

    let benchArr = null, benchMetrics = null;
    if (benchSeg) {
      const bs = benchSeg.p.slice(lo - benchSeg.i0, hi - benchSeg.i0 + 1);
      const base = bs[0]; benchArr = bs.map((x) => (x / base) * 100);
      benchMetrics = E.curveMetrics(benchArr, PPY_M, rf);
    }

    const schemes = {};
    for (const name of ['equal', 'invvol', 'resampled']) {
      const w = weights[name].weights;
      const eqR = E.backtestPortfolio(prices, available, w, true);
      const eqB = E.backtestPortfolio(prices, available, w, false);
      schemes[name] = { rebal: eqR, buyhold: eqB,
        metrics: { rebal: E.curveMetrics(eqR, PPY_M, rf), buyhold: E.curveMetrics(eqB, PPY_M, rf) } };
    }

    const mrow = {}; metrics.rows.forEach((r) => (mrow[r.t] = r));
    const picks = available.map((t, i) => {
      const r = mrow[t] || {};
      return { t, wEqual: weights.equal.weights[i], wInvvol: weights.invvol.weights[i],
        wResampled: weights.resampled.weights[i], quality: r.quality, cagr: r.cagr, vol: r.vol,
        mdd: r.mdd, min5y: r.min5y, r2: r.r2, reg: r.reg, mar: r.mar };
    });

    return { picks, dropped, insufficient: false, from: months[0], to: months[len - 1],
      scenarios: weights.resampled.scenarios,
      backtest: { months, bench: benchArr, benchMetrics, schemes } };
  }

  /** Screening -> portafoglio canonico live. */
  function recompute(metrics, curves, thresholds, opt) {
    const scr = E.screen(metrics.rows, { ...thresholds, ppy: 252, sortBy: 'quality' });
    const wanted = scr.picks.map((r) => r.t);
    const available = wanted.filter((t) => curves.series[t]);
    const res = build(available, wanted.length - available.length, metrics, curves, opt);
    res.scr = scr;
    return res;
  }

  /** Portafoglio da una lista di ticker scelti a mano (basket custom). */
  function recomputeFromTickers(metrics, curves, tickers, opt) {
    const uniq = [...new Set(tickers)];
    const available = uniq.filter((t) => curves.series[t]);
    return build(available, uniq.length - available.length, metrics, curves, opt);
  }

  window.ComaLive = { recompute, recomputeFromTickers };
})();
