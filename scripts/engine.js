/* ============================================================================
 * coma-screener — MOTORE ISOMORFO
 * Stesso codice in Node (pipeline dati) e nel browser (re-filtri/pesatura live).
 * Nessuna dipendenza, nessun accesso al DOM.
 *
 * Metodologia "Aziende da Coma" (M. Rea): titoli con curva di prezzo che cresce
 * in modo regolare sul lungo periodo (alta linearita log), mai un quinquennio
 * negativo, drawdown contenuti. Vedi README per i caveat metodologici.
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComaEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- helpers ---------------------------------------------------------------
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);

  /** RNG deterministico (mulberry32) per riproducibilita del resampling */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- metriche per singolo titolo ------------------------------------------
  // `prices` = array di prezzi adjusted (total return), ordine cronologico.
  // `ppy` = periodi per anno (252 daily, 12 monthly).

  function cagr(prices, ppy) {
    const p = prices.filter((x) => x > 0);
    if (p.length < 2) return NaN;
    const years = p.length / ppy;
    return Math.pow(p[p.length - 1] / p[0], 1 / years) - 1;
  }

  function periodReturns(prices) {
    const r = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) r.push(prices[i] / prices[i - 1] - 1);
    }
    return r;
  }

  function annualizedVol(prices, ppy) {
    const r = periodReturns(prices);
    if (r.length < 2) return NaN;
    const m = mean(r);
    const v = sum(r.map((x) => (x - m) * (x - m))) / (r.length - 1);
    return Math.sqrt(v) * Math.sqrt(ppy);
  }

  function downsideVol(prices, ppy) {
    const r = periodReturns(prices).filter((x) => x < 0);
    if (r.length < 2) return NaN;
    const v = sum(r.map((x) => x * x)) / r.length; // target 0
    return Math.sqrt(v) * Math.sqrt(ppy);
  }

  function maxDrawdown(prices) {
    let peak = -Infinity, mdd = 0;
    for (const x of prices) {
      if (x > peak) peak = x;
      if (peak > 0) { const dd = x / peak - 1; if (dd < mdd) mdd = dd; }
    }
    return mdd; // <= 0
  }

  /** Rendimento minimo su finestra rolling di `w` periodi (es. 5 anni). */
  function rollingMinReturn(prices, w) {
    let m = Infinity;
    for (let i = w; i < prices.length; i++) {
      if (prices[i - w] > 0) {
        const r = prices[i] / prices[i - w] - 1;
        if (r < m) m = r;
      }
    }
    return m === Infinity ? NaN : m;
  }

  /** R^2 della regressione lineare di log(prezzo) sul tempo: "liscezza" della curva. */
  function logLinearityR2(prices) {
    const p = prices.filter((x) => x > 0);
    const n = p.length;
    if (n < 30) return NaN;
    const y = p.map((x) => Math.log(x));
    const mx = (n - 1) / 2;
    const my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return NaN;
    const r = sxy / Math.sqrt(sxx * syy);
    return r * r;
  }

  /**
   * Regolarita: deviazione standard dei residui di log(prezzo) attorno al fit
   * log-lineare. ~ deviazione frazionale tipica dal trend esponenziale ideale.
   * Piu bassa = curva piu liscia ("coma" piu profondo). Indipendente dal trend
   * (a differenza di R^2, che un titolo nervoso ma in forte crescita gonfia).
   */
  function logResidStd(prices) {
    const p = prices.filter((x) => x > 0);
    const n = p.length;
    if (n < 30) return NaN;
    const y = p.map((x) => Math.log(x));
    const mx = (n - 1) / 2, my = mean(y);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const dx = i - mx; sxy += dx * (y[i] - my); sxx += dx * dx; }
    const slope = sxy / sxx, intercept = my - slope * mx;
    let ss = 0;
    for (let i = 0; i < n; i++) { const e = y[i] - (intercept + slope * i); ss += e * e; }
    return Math.sqrt(ss / n);
  }

  /** Percentili (rank) di un array; NaN preservati. */
  function percentileRanks(vals) {
    const idx = vals.map((v, i) => [v, i]).filter((a) => isFinite(a[0]));
    idx.sort((a, b) => a[0] - b[0]);
    const pr = new Array(vals.length).fill(NaN);
    for (let r = 0; r < idx.length; r++) pr[idx[r][1]] = idx.length > 1 ? r / (idx.length - 1) : 1;
    return pr;
  }

  /**
   * Coma Quality Score: media dei percentili di R^2 (regolarita), Min5Y (mai un
   * brutto quinquennio) e MAR (rendimento per unita di drawdown). Rank-based →
   * robusto agli outlier, scala-invariante. Calcolato sull'intero universo.
   */
  function addQualityScore(rows) {
    const pr2 = percentileRanks(rows.map((r) => r.r2));
    const pmin = percentileRanks(rows.map((r) => r.min5y));
    const pmar = percentileRanks(rows.map((r) => r.mar));
    rows.forEach((r, i) => {
      const parts = [pr2[i], pmin[i], pmar[i]].filter(isFinite);
      r.quality = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : NaN;
    });
    return rows;
  }

  /** Calcola tutte le metriche per una serie di prezzi. */
  function metricsFor(prices, ppy, rf) {
    rf = rf == null ? 0.03 : rf;
    const c = cagr(prices, ppy);
    const vol = annualizedVol(prices, ppy);
    const dvol = downsideVol(prices, ppy);
    const mdd = maxDrawdown(prices);
    const min5y = rollingMinReturn(prices, Math.round(5 * ppy));
    const r2 = logLinearityR2(prices);
    const reg = logResidStd(prices);
    const ddAbs = Math.abs(mdd);
    return {
      cagr: c, vol, mdd, min5y, r2, reg,
      mar: ddAbs > 0 ? c / ddAbs : NaN,                 // standard: CAGR / |MaxDD|
      sortino: dvol > 0 ? (c - rf) / dvol : NaN,
      sharpe: vol > 0 ? (c - rf) / vol : NaN,
      score: (vol > 0 && ddAbs > 0) ? c / (vol * ddAbs) : NaN, // score storico Colab
      days: prices.length,
    };
  }

  // ---- screening -------------------------------------------------------------
  // `rows` = [{ticker, cagr, vol, mdd, min5y, r2, days, ...}], thresholds = filtri.
  function screen(rows, t) {
    const minDays = Math.round((t.minYears || 20) * (t.ppy || 252));
    const out = [];
    const skipped = { storico: 0, cinqueY: 0, r2: 0, cagr: 0, dd: 0 };
    for (const row of rows) {
      if (row.days < minDays) { skipped.storico++; continue; }
      if (row.min5y < (t.tolerance5y ?? -0.05)) { skipped.cinqueY++; continue; }
      if (row.r2 < (t.minR2 ?? 0.90)) { skipped.r2++; continue; }
      if (t.minCagr != null && row.cagr < t.minCagr) { skipped.cagr++; continue; }
      if (t.maxDD != null && row.mdd < t.maxDD) { skipped.dd++; continue; }
      out.push(row);
    }
    const key = t.sortBy || 'quality';
    out.sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
    const top = t.topN ? out.slice(0, t.topN) : out;
    return { picks: top, skipped, passed: out.length };
  }

  // ---- algebra portafoglio ---------------------------------------------------
  function colMeans(R) {
    const n = R.length, k = R[0].length, mu = new Array(k).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) mu[j] += R[i][j];
    return mu.map((x) => x / n);
  }

  function covMatrix(R) {
    const n = R.length, k = R[0].length, mu = colMeans(R);
    const C = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++) {
        const da = R[i][a] - mu[a];
        for (let b = a; b < k; b++) {
          C[a][b] += da * (R[i][b] - mu[b]);
        }
      }
    }
    const d = n - 1 || 1;
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) { C[a][b] /= d; C[b][a] = C[a][b]; }
    return C;
  }

  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const matVec = (M, v) => M.map((row) => dot(row, v));

  function portfolioStats(w, mu, cov, rf) {
    const ret = dot(w, mu);
    const vol = Math.sqrt(Math.max(0, dot(w, matVec(cov, w))));
    return { ret, vol, sharpe: vol > 0 ? (ret - rf) / vol : NaN };
  }

  /** Proiezione di v sul simplesso con box: {sum=1, floor<=x<=cap}. Bisezione su tau. */
  function projectCappedSimplex(v, floor, cap) {
    const n = v.length;
    const clip = (tau) => v.map((x) => Math.min(cap, Math.max(floor, x - tau)));
    let lo = Math.min(...v) - cap, hi = Math.max(...v) - floor;
    for (let it = 0; it < 100; it++) {
      const tau = (lo + hi) / 2;
      const s = sum(clip(tau));
      if (Math.abs(s - 1) < 1e-10) break;
      if (s > 1) lo = tau; else hi = tau;
    }
    return clip((lo + hi) / 2);
  }

  /** Max-Sharpe long-only con box [floor,cap] e sum=1, via gradiente proiettato. */
  function maxSharpe(mu, cov, rf, floor, cap, iters) {
    const n = mu.length;
    floor = Math.min(floor, 1 / n); cap = Math.max(cap, 1 / n);
    let w = projectCappedSimplex(new Array(n).fill(1 / n), floor, cap);
    let lr = 0.1, best = w.slice(), bestS = -Infinity;
    for (let it = 0; it < (iters || 400); it++) {
      const Sw = matVec(cov, w);
      const sig = Math.sqrt(Math.max(1e-18, dot(w, Sw)));
      const exc = dot(w, mu) - rf;
      const sharpe = exc / sig;
      if (sharpe > bestS) { bestS = sharpe; best = w.slice(); }
      // grad Sharpe = mu/sig - exc*Sw/sig^3
      const g = mu.map((m, i) => m / sig - (exc * Sw[i]) / (sig * sig * sig));
      let wn = w.map((x, i) => x + lr * g[i]);
      wn = projectCappedSimplex(wn, floor, cap);
      w = wn;
      lr *= 0.999;
    }
    return best;
  }

  /** Equipeso 1/N — il piu robusto, nessuna stima richiesta. */
  function equalWeights(n) { return new Array(n).fill(1 / n); }

  /** Risk-parity (inverse-vol): peso ∝ 1/volatilita, poi cap/floor. */
  function inverseVolWeights(R, floor, cap) {
    const cov = covMatrix(R);
    const k = cov.length;
    let w = cov.map((row, i) => 1 / Math.sqrt(Math.max(1e-12, row[i])));
    const tot = sum(w); w = w.map((x) => x / tot);
    w = projectCappedSimplex(w, floor ?? 0.02, cap ?? 0.20);
    const t2 = sum(w); return w.map((x) => x / t2);
  }

  /** Campione block-bootstrap stazionario (blocchi a lunghezza geometrica). */
  function blockBootstrap(R, len, meanBlock, rand) {
    const n = R.length, out = [];
    while (out.length < len) {
      let i = Math.floor(rand() * n);
      const bl = Math.max(1, Math.round(-meanBlock * Math.log(1 - rand())));
      for (let b = 0; b < bl && out.length < len; b++) { out.push(R[i]); i = (i + 1) % n; }
    }
    return out;
  }

  /**
   * Resampled max-Sharpe (in spirito a Michaud): media dei pesi ottimi su tanti
   * campioni BLOCK-BOOTSTRAP dei rendimenti (preserva l'autocorrelazione e
   * decorrela i campioni, a differenza delle finestre overlapping). Riduce
   * l'instabilita di Markowitz.
   */
  function resampledWeights(R, opt) {
    opt = opt || {};
    const floor = opt.floor ?? 0.02, cap = opt.cap ?? 0.20, rf = opt.rf ?? 0.03;
    const ppy = opt.ppy || 252;
    const nSim = opt.nSim || 500;
    const winLen = Math.min(R.length, Math.round((opt.windowYears || 5) * ppy));
    const meanBlock = opt.meanBlock || 21; // ~1 mese di trading
    const k = R[0].length;
    const rand = rng(opt.seed || 12345);
    const acc = new Array(k).fill(0), sq = new Array(k).fill(0);
    let ok = 0;
    for (let s = 0; s < nSim; s++) {
      const sample = blockBootstrap(R, winLen, meanBlock, rand);
      const mu = colMeans(sample).map((x) => x * ppy);
      const cov = covMatrix(sample).map((row) => row.map((x) => x * ppy));
      const w = maxSharpe(mu, cov, rf, floor, cap, 250);
      if (w.some((x) => !isFinite(x))) continue;
      for (let i = 0; i < k; i++) { acc[i] += w[i]; sq[i] += w[i] * w[i]; }
      ok++;
    }
    let w, wstd;
    if (ok >= 10) {
      w = acc.map((x) => x / ok);
      wstd = sq.map((x, i) => Math.sqrt(Math.max(0, x / ok - (acc[i] / ok) ** 2)));
    } else { w = equalWeights(k); wstd = new Array(k).fill(0); }
    w = projectCappedSimplex(w, floor, cap);
    const tot = sum(w); w = w.map((x) => x / tot);
    return { weights: w, std: wstd, scenarios: ok };
  }

  /** Calcola i pesi secondo lo schema scelto. */
  function computeWeights(scheme, R, opt) {
    opt = opt || {};
    const k = R[0].length;
    if (scheme === 'equal') return { weights: equalWeights(k), std: new Array(k).fill(0), scenarios: 0 };
    if (scheme === 'invvol') return { weights: inverseVolWeights(R, opt.floor, opt.cap), std: new Array(k).fill(0), scenarios: 0 };
    return resampledWeights(R, opt); // 'resampled' (default)
  }

  // ---- backtest --------------------------------------------------------------
  /**
   * Backtest di un portafoglio dato un set di curve allineate.
   * `curves` = { ticker: number[] } gia allineate sullo stesso indice temporale.
   * rebalance=true -> pesi costanti (ribilanciato ogni periodo)
   * rebalance=false -> buy & hold (i pesi driftano) — coerente con la tesi "coma".
   * Ritorna la curva equity (base 100).
   */
  function backtestPortfolio(curves, tickers, weights, rebalance) {
    const T = curves[tickers[0]].length;
    const eq = new Array(T);
    if (rebalance) {
      // rendimenti pesati periodo per periodo
      const rets = tickers.map((t) => periodReturns(curves[t]));
      eq[0] = 100;
      for (let i = 1; i < T; i++) {
        let r = 0;
        for (let j = 0; j < tickers.length; j++) r += weights[j] * rets[j][i - 1];
        eq[i] = eq[i - 1] * (1 + r);
      }
    } else {
      // buy & hold: quote fisse comprate a t0
      const shares = tickers.map((t, j) => (100 * weights[j]) / curves[t][0]);
      for (let i = 0; i < T; i++) {
        let v = 0;
        for (let j = 0; j < tickers.length; j++) v += shares[j] * curves[tickers[j]][i];
        eq[i] = v;
      }
    }
    return eq;
  }

  /** Metriche sintetiche di una curva equity. */
  function curveMetrics(eq, ppy, rf) {
    rf = rf == null ? 0.03 : rf;
    return {
      cagr: cagr(eq, ppy), vol: annualizedVol(eq, ppy),
      mdd: maxDrawdown(eq),
      mar: Math.abs(maxDrawdown(eq)) > 0 ? cagr(eq, ppy) / Math.abs(maxDrawdown(eq)) : NaN,
      sharpe: annualizedVol(eq, ppy) > 0 ? (cagr(eq, ppy) - rf) / annualizedVol(eq, ppy) : NaN,
    };
  }

  return {
    rng, cagr, periodReturns, annualizedVol, downsideVol, maxDrawdown,
    rollingMinReturn, logLinearityR2, logResidStd, percentileRanks, addQualityScore,
    metricsFor, screen,
    colMeans, covMatrix, portfolioStats, projectCappedSimplex, maxSharpe,
    equalWeights, inverseVolWeights, blockBootstrap, resampledWeights, computeWeights,
    backtestPortfolio, curveMetrics,
  };
});
