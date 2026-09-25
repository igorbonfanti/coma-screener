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

  /** Tasso risk-free di fallback (media EONIA/€STR pre-2008, usata quando manca la serie). */
  const RF_DEFAULT = 0.03;

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

  /**
   * Downside deviation (target 0). Il denominatore e il numero TOTALE di
   * osservazioni, non solo quelle negative: dividere per i soli negativi
   * sovrastima la downside vol di ~sqrt(2) e in modo non uniforme fra titoli.
   */
  function downsideVol(prices, ppy) {
    const r = periodReturns(prices);
    if (r.length < 2) return NaN;
    let ss = 0;
    for (const x of r) if (x < 0) ss += x * x;
    return Math.sqrt(ss / r.length) * Math.sqrt(ppy);
  }

  // ---- risk-free --------------------------------------------------------------
  /**
   * Normalizza `rf` in un array di rendimenti del conto cash PER PERIODO, lungo `n`.
   *   number -> tasso annuo costante
   *   array  -> rendimenti per periodo gia pronti (es. da un ETF monetario €STR),
   *             allineati alla CODA della serie di rendimenti.
   */
  function rfPerPeriod(rf, ppy, n) {
    if (Array.isArray(rf) && rf.length) {
      if (rf.length >= n) return rf.slice(rf.length - n);
      const head = new Array(n - rf.length).fill(Math.pow(1 + RF_DEFAULT, 1 / ppy) - 1);
      return head.concat(rf);
    }
    const per = Math.pow(1 + (rf == null ? RF_DEFAULT : rf), 1 / ppy) - 1;
    return new Array(n).fill(per);
  }

  /** Rendimenti in eccesso sul risk-free, periodo per periodo. */
  function excessReturns(rets, rf, ppy) {
    const c = rfPerPeriod(rf, ppy, rets.length);
    return rets.map((x, i) => x - c[i]);
  }

  /** Risk-free annualizzato effettivo sul campione (per reporting). */
  function annualizedRf(rf, ppy, n) {
    const c = rfPerPeriod(rf, ppy, n);
    let g = 1; for (const x of c) g *= 1 + x;
    return Math.pow(g, ppy / c.length) - 1;
  }

  /**
   * Sharpe standard: media ARITMETICA degli excess return, annualizzata, divisa
   * per la vol degli excess return. Usare il CAGR (geometrico) al numeratore
   * sottostima lo Sharpe di ~vol^2/2 e penalizza i titoli volatili, introducendo
   * un tilt low-vol non voluto nel ranking.
   */
  function sharpeRatio(prices, ppy, rf) {
    const r = periodReturns(prices);
    if (r.length < 2) return NaN;
    const e = excessReturns(r, rf, ppy);
    const m = mean(e);
    const v = sum(e.map((x) => (x - m) * (x - m))) / (e.length - 1);
    const sd = Math.sqrt(v);
    return sd > 0 ? (m * ppy) / (sd * Math.sqrt(ppy)) : NaN;
  }

  /** Sortino: excess return aritmetico annualizzato / downside deviation degli excess. */
  function sortinoRatio(prices, ppy, rf) {
    const r = periodReturns(prices);
    if (r.length < 2) return NaN;
    const e = excessReturns(r, rf, ppy);
    const m = mean(e);
    let ss = 0;
    for (const x of e) if (x < 0) ss += x * x;
    const dd = Math.sqrt(ss / e.length) * Math.sqrt(ppy);
    return dd > 0 ? (m * ppy) / dd : NaN;
  }

  /**
   * Regressione dei rendimenti del portafoglio sul benchmark (entrambi in eccesso
   * sul risk-free): alfa annualizzato, beta, t-stat dell'alfa, tracking error,
   * information ratio. E il test che distingue skill da esposizione al mercato.
   */
  function regress(portRets, benchRets, rf, ppy) {
    const n = Math.min(portRets.length, benchRets.length);
    if (n < 12) return null;
    const p = portRets.slice(portRets.length - n);
    const b = benchRets.slice(benchRets.length - n);
    const c = rfPerPeriod(rf, ppy, n);
    const y = p.map((x, i) => x - c[i]);
    const x = b.map((v, i) => v - c[i]);
    const my = mean(y), mx = mean(x);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (!(sxx > 0)) return null;
    const beta = sxy / sxx;
    const a = my - beta * mx;                       // alfa per periodo
    let sse = 0;
    for (let i = 0; i < n; i++) { const e = y[i] - (a + beta * x[i]); sse += e * e; }
    const s2 = sse / Math.max(1, n - 2);
    const seA = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
    const seB = Math.sqrt(s2 / sxx);
    const d = p.map((v, i) => v - b[i]);            // rendimento relativo
    const md = mean(d);
    const vd = sum(d.map((z) => (z - md) * (z - md))) / Math.max(1, d.length - 1);
    const te = Math.sqrt(vd * ppy);
    return {
      n, beta, betaSe: seB,
      alpha: a * ppy,                               // alfa annualizzato
      alphaT: seA > 0 ? a / seA : NaN,              // t-stat (invariante alla scala)
      r2: syy > 0 ? 1 - sse / syy : NaN,
      te, ir: te > 0 ? (md * ppy) / te : NaN,
    };
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

  // ---- regressione multivariata (attribuzione fattoriale) --------------------

  /** Inversa di una matrice piccola con Gauss-Jordan e pivoting parziale. */
  function invert(A) {
    const n = A.length;
    const M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;          // singolare
      const t = M[c]; M[c] = M[piv]; M[piv] = t;
      const d = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (!f) continue;
        for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map((r) => r.slice(n));
  }

  /**
   * OLS di `y` su `X` (colonne SENZA intercetta: viene aggiunta) con errori
   * standard Newey-West, che correggono autocorrelazione ed eteroschedasticita.
   * Sui rendimenti mensili basta un lag di 3-4.
   *
   * Ritorna coefficienti, errori standard, t-stat, R2 e R2 corretto. Il primo
   * coefficiente e l'intercetta, cioe l'ALFA per periodo.
   */
  function olsNW(y, X, lag) {
    const n = y.length, k = X.length ? X[0].length + 1 : 1;
    if (n <= k + 1) return null;
    lag = lag == null ? Math.max(1, Math.round(4 * Math.pow(n / 100, 2 / 9))) : lag;
    const D = [];                                   // matrice di disegno con intercetta
    for (let i = 0; i < n; i++) D.push([1].concat(X[i]));
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
    const Xty = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++) {
        Xty[a] += D[i][a] * y[i];
        for (let b = a; b < k; b++) XtX[a][b] += D[i][a] * D[i][b];
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const XtXinv = invert(XtX);
    if (!XtXinv) return null;
    const b = XtXinv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
    const u = y.map((v, i) => v - D[i].reduce((s, x, j) => s + x * b[j], 0));

    // Newey-West: S = Gamma0 + somma pesata di (Gamma_j + Gamma_j')
    const S = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let j = 0; j <= lag; j++) {
      const w = j === 0 ? 1 : 1 - j / (lag + 1);   // pesi di Bartlett
      const G = Array.from({ length: k }, () => new Array(k).fill(0));
      for (let i = j; i < n; i++) {
        const uu = u[i] * u[i - j];
        for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) G[a][c] += uu * D[i][a] * D[i - j][c];
      }
      for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) {
        S[a][c] += w * (j === 0 ? G[a][c] : G[a][c] + G[c][a]);
      }
    }
    const V = XtXinv.map((r, a) => XtXinv.map((_, c) =>
      S.reduce((s, Srow, p) => s + r[p] * Srow.reduce((s2, v, q) => s2 + v * XtXinv[q][c], 0), 0)));
    const se = V.map((r, a) => Math.sqrt(Math.max(0, r[a])));

    const my = mean(y);
    const sst = sum(y.map((v) => (v - my) * (v - my)));
    const sse = sum(u.map((v) => v * v));
    const r2 = sst > 0 ? 1 - sse / sst : NaN;
    return {
      n, k, lag, coef: b, se,
      t: b.map((v, i) => (se[i] > 0 ? v / se[i] : NaN)),
      r2, adjR2: sst > 0 ? 1 - (1 - r2) * (n - 1) / (n - k) : NaN,
    };
  }

  /**
   * Attribuzione a scala: CAPM -> FF3 -> FF5+momentum -> +BAB+QMJ.
   * Si legge l'incremento di R2 e soprattutto la MORTALITA DELL'ALFA a ogni
   * passo: su un portafoglio a beta basso e ricco di difensivi, l'alfa che
   * sopravvive al mercato spesso non sopravvive a BAB e QMJ.
   *
   * `rets` = rendimenti del portafoglio IN DOLLARI, allineati a `f` (i fattori).
   * `f` = { mktrf, smb, hml, rmw, cma, wml, bab, qmj, rf } come array allineati.
   */
  const MODELLI = [
    { id: 'capm', label: 'CAPM', cols: ['mktrf'] },
    { id: 'ff3', label: 'Fama-French 3', cols: ['mktrf', 'smb', 'hml'] },
    { id: 'ff5m', label: 'Fama-French 5 + momentum', cols: ['mktrf', 'smb', 'hml', 'rmw', 'cma', 'wml'] },
    { id: 'full', label: '+ BAB + QMJ', cols: ['mktrf', 'smb', 'hml', 'rmw', 'cma', 'wml', 'bab', 'qmj'] },
  ];

  function factorLadder(rets, f, ppy, lag) {
    ppy = ppy || 12;
    const out = [];
    for (const m of MODELLI) {
      // tiene solo i periodi in cui TUTTI i regressori del modello esistono
      const y = [], X = [];
      for (let i = 0; i < rets.length; i++) {
        if (!isFinite(rets[i]) || !isFinite(f.rf[i])) continue;
        const riga = m.cols.map((c) => f[c][i]);
        if (riga.some((v) => v == null || !isFinite(v))) continue;
        y.push(rets[i] - f.rf[i]);                 // rendimento in eccesso
        X.push(riga);
      }
      const r = olsNW(y, X, lag);
      if (!r) { out.push({ id: m.id, label: m.label, insufficiente: true, n: y.length }); continue; }
      out.push({
        id: m.id, label: m.label, n: r.n, lag: r.lag,
        alpha: r.coef[0] * ppy,                    // alfa annualizzato
        alphaT: r.t[0],
        beta: m.cols.map((c, j) => ({ f: c, b: r.coef[j + 1], t: r.t[j + 1] })),
        r2: r.r2, adjR2: r.adjR2,
      });
    }
    return out;
  }

  /** Calcola tutte le metriche per una serie di prezzi. `rf` = numero o serie. */
  function metricsFor(prices, ppy, rf) {
    const c = cagr(prices, ppy);
    const vol = annualizedVol(prices, ppy);
    const mdd = maxDrawdown(prices);
    const min5y = rollingMinReturn(prices, Math.round(5 * ppy));
    const r2 = logLinearityR2(prices);
    const reg = logResidStd(prices);
    const ddAbs = Math.abs(mdd);
    return {
      cagr: c, vol, mdd, min5y, r2, reg,
      mar: ddAbs > 0 ? c / ddAbs : NaN,                 // standard: CAGR / |MaxDD|
      sortino: sortinoRatio(prices, ppy, rf),
      sharpe: sharpeRatio(prices, ppy, rf),
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
    // NB: i confronti sono in forma "passa solo se isFinite && dentro soglia":
    // con `NaN < soglia` (che e sempre false) una riga con metrica mancante
    // passerebbe silenziosamente il filtro.
    for (const row of rows) {
      if (!(row.days >= minDays)) { skipped.storico++; continue; }
      if (!(row.min5y >= (t.tolerance5y ?? -0.05))) { skipped.cinqueY++; continue; }
      if (!(row.r2 >= (t.minR2 ?? 0.90))) { skipped.r2++; continue; }
      if (t.minCagr != null && !(row.cagr >= t.minCagr)) { skipped.cagr++; continue; }
      if (t.maxDD != null && !(row.mdd >= t.maxDD)) { skipped.dd++; continue; }
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
    const floor = opt.floor ?? 0.02, cap = opt.cap ?? 0.20;
    const ppy = opt.ppy || 252;
    // l'ottimizzatore vuole uno scalare: se rf e una serie, usa il suo annualizzato
    const rf = Array.isArray(opt.rf) ? annualizedRf(opt.rf, ppy, opt.rf.length) : (opt.rf ?? RF_DEFAULT);
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
  /** Numero di periodi fra due ribilanciamenti. 0 = mai (buy & hold). */
  function rebalanceStep(freq, ppy) {
    if (!freq || freq === 'none' || freq === 'buyhold') return 0;
    const perYear = { daily: ppy, weekly: 52, monthly: 12, quarterly: 4, annual: 1 }[freq];
    if (!perYear) return 0;
    return Math.max(1, Math.round(ppy / perYear));
  }

  /**
   * Backtest di un portafoglio dato un set di curve allineate.
   * `curves` = { ticker: number[] } gia allineate sullo stesso indice temporale.
   *
   * opt = { rebalance:'none'|'annual'|'quarterly'|'monthly'|'daily', ppy, costBps }
   *   - 'none'   -> buy & hold, i pesi driftano (coerente con la tesi "coma")
   *   - altro    -> ritorno ai pesi target alla frequenza scelta, pagando
   *                 `costBps` punti base sul notional effettivamente scambiato.
   * Ribilanciare a ogni periodo su dati giornalieri e irrealizzabile e regala un
   * rebalancing premium gratuito: default 'annual'.
   *
   * Ritorna la curva equity (base 100) con `.turnover` = notional scambiato/anno.
   */
  function backtestPortfolio(curves, tickers, weights, opt) {
    if (opt === true) opt = { rebalance: 'daily' };
    else if (opt === false || opt == null) opt = { rebalance: 'none' };
    const ppy = opt.ppy || 252;
    const step = rebalanceStep(opt.rebalance, ppy);
    const cost = (opt.costBps || 0) / 10000;
    const k = tickers.length;
    const T = curves[tickers[0]].length;
    const eq = new Array(T);
    let w = weights.slice(), v = 100, traded = 0;
    eq[0] = v;
    for (let i = 1; i < T; i++) {
      let g = 0;
      const wn = new Array(k);
      for (let j = 0; j < k; j++) {
        const p0 = curves[tickers[j]][i - 1], p1 = curves[tickers[j]][i];
        wn[j] = w[j] * (p0 > 0 ? p1 / p0 : 1);
        g += wn[j];
      }
      if (!(g > 0)) { eq[i] = v; continue; }
      v *= g;
      for (let j = 0; j < k; j++) wn[j] /= g;      // pesi driftati
      w = wn;
      if (step && i % step === 0) {
        let tv = 0;
        for (let j = 0; j < k; j++) tv += Math.abs(weights[j] - w[j]);
        traded += tv;
        v *= 1 - tv * cost;
        w = weights.slice();
      }
      eq[i] = v;
    }
    eq.turnover = T > 1 ? traded / ((T - 1) / ppy) : 0;
    return eq;
  }

  /** Metriche sintetiche di una curva equity. `rf` = numero o serie per periodo. */
  function curveMetrics(eq, ppy, rf) {
    const c = cagr(eq, ppy), vol = annualizedVol(eq, ppy), mdd = maxDrawdown(eq);
    return {
      cagr: c, vol, mdd,
      mar: Math.abs(mdd) > 0 ? c / Math.abs(mdd) : NaN,
      sharpe: sharpeRatio(eq, ppy, rf),
      sortino: sortinoRatio(eq, ppy, rf),
      turnover: isFinite(eq.turnover) ? eq.turnover : null,
    };
  }

  return {
    RF_DEFAULT,
    rng, cagr, periodReturns, annualizedVol, downsideVol, maxDrawdown,
    rollingMinReturn, logLinearityR2, logResidStd, percentileRanks, addQualityScore,
    rfPerPeriod, excessReturns, annualizedRf, sharpeRatio, sortinoRatio, regress,
    invert, olsNW, factorLadder, MODELLI,
    metricsFor, screen,
    colMeans, covMatrix, portfolioStats, projectCappedSimplex, maxSharpe,
    equalWeights, inverseVolWeights, blockBootstrap, resampledWeights, computeWeights,
    rebalanceStep, backtestPortfolio, curveMetrics,
  };
});
