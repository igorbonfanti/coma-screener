/* ============================================================================
 * coma-screener — ANALISI DEI DRAWDOWN E DELLE STRATEGIE DI INGRESSO
 * Modulo isomorfo (Node + browser), nessuna dipendenza, nessun accesso al DOM.
 *
 * Risponde alla domanda: dato un compounder selezionato dallo screener, conviene
 * comprarlo subito, accumularlo con un PAC, aspettarlo sui ribassi, o entrare
 * sulla forza alla rottura dei massimi?
 *
 * Due regole che questo modulo rispetta ovunque, e senza le quali il confronto
 * non significa niente:
 *
 *  1. EQUIVALENZA DI CAPITALE. Le strategie condividono lo stesso schema di
 *     versamenti; la liquidita in attesa e remunerata al risk-free. Confrontare
 *     il rendimento del solo capitale investito farebbe vincere per finta chi
 *     resta liquido.
 *  2. NIENTE LOOK-AHEAD NEI SEGNALI. Massimo corrente, massimo a N mesi e
 *     residuo dal trend sono calcolati su finestra ESPANSIVA: al tempo t usano
 *     solo [0..t]. Un trend log-lineare stimato su tutto il campione conosce il
 *     futuro e renderebbe il segnale "sotto la retta" magicamente profittevole.
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComaEntry = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  const quantileOf = (arr, q) => quantile(arr.slice().sort((a, b) => a - b), q);

  // ---- drawdown --------------------------------------------------------------

  /** Drawdown corrente rispetto al massimo precedente, periodo per periodo. */
  function runningDrawdown(prices) {
    const dd = new Array(prices.length);
    let peak = -Infinity;
    for (let i = 0; i < prices.length; i++) {
      if (prices[i] > peak) peak = prices[i];
      dd[i] = peak > 0 ? prices[i] / peak - 1 : 0;
    }
    return dd;
  }

  /**
   * Episodi di drawdown piu profondi di `minDepth` (es. 0.05 = 5%).
   * Per ognuno: profondita, durata picco->minimo, tempo di recupero.
   * Un episodio ancora aperto a fine serie ha `recovered:false` e recoveryLen null.
   */
  function drawdownEpisodes(prices, minDepth, ppy) {
    minDepth = minDepth == null ? 0.05 : minDepth;
    ppy = ppy || 252;
    const out = [];
    let peak = prices[0], peakI = 0, troughI = -1, trough = Infinity, open = false;
    for (let i = 1; i < prices.length; i++) {
      const p = prices[i];
      if (p >= peak) {
        if (open && trough / peak - 1 <= -minDepth) {
          out.push({ start: peakI, trough: troughI, end: i, depth: trough / peak - 1,
            fallLen: (troughI - peakI) / ppy, recoveryLen: (i - troughI) / ppy, recovered: true });
        }
        peak = p; peakI = i; open = false; trough = Infinity; troughI = -1;
      } else {
        open = true;
        if (p < trough) { trough = p; troughI = i; }
      }
    }
    if (open && trough / peak - 1 <= -minDepth) {
      out.push({ start: peakI, trough: troughI, end: null, depth: trough / peak - 1,
        fallLen: (troughI - peakI) / ppy, recoveryLen: null, recovered: false });
    }
    return out;
  }

  /**
   * Statistiche riassuntive dei ribassi: quanto spesso il titolo offre uno
   * sconto, quanto e profondo, quanto dura. E la parte che dice se una strategia
   * "compra sui ribassi" e anche solo ESEGUIBILE: se lo sconto del 15% arriva
   * una volta ogni cinque anni, quanto renda dopo e irrilevante.
   */
  function drawdownProfile(prices, ppy, thresholds) {
    ppy = ppy || 252;
    thresholds = thresholds || [0.10, 0.15, 0.20, 0.30];
    const years = (prices.length - 1) / ppy;
    const dd = runningDrawdown(prices);
    const eps = drawdownEpisodes(prices, 0.05, ppy);
    const depths = eps.map((e) => -e.depth);
    const recovered = eps.filter((e) => e.recovered);
    const freq = {};
    for (const t of thresholds) {
      const hits = eps.filter((e) => -e.depth >= t);
      const rec = hits.filter((e) => e.recovered);
      freq['d' + Math.round(t * 100)] = {
        episodes: hits.length,
        perYear: years > 0 ? hits.length / years : null,
        yearsBetween: hits.length > 1 ? years / hits.length : null,
        medRecovery: rec.length ? quantileOf(rec.map((e) => e.recoveryLen), 0.5) : null,
      };
    }
    return {
      years,
      episodes: eps.length,
      medDepth: depths.length ? quantileOf(depths, 0.5) : null,
      p90Depth: depths.length ? quantileOf(depths, 0.9) : null,
      maxDepth: depths.length ? Math.max.apply(null, depths) : null,
      medFall: eps.length ? quantileOf(eps.map((e) => e.fallLen), 0.5) : null,
      medRecovery: recovered.length ? quantileOf(recovered.map((e) => e.recoveryLen), 0.5) : null,
      p90Recovery: recovered.length ? quantileOf(recovered.map((e) => e.recoveryLen), 0.9) : null,
      pctUnderwater: dd.filter((x) => x < -0.01).length / dd.length,
      pctBelow10: dd.filter((x) => x <= -0.10).length / dd.length,
      pctBelow20: dd.filter((x) => x <= -0.20).length / dd.length,
      openEpisode: eps.length && !eps[eps.length - 1].recovered ? eps[eps.length - 1].depth : null,
      freq,
    };
  }

  // ---- residuo dal trend log (la "value area" nativa alla metodologia) -------

  /**
   * Z-score del residuo dal fit log-lineare calcolato su finestra ESPANSIVA:
   * al tempo t la retta e stimata solo su [0..t]. Negativo = sotto il proprio
   * trend, positivo = sopra. E l'analogo scala-invariante del "prezzo in area
   * di valore", senza bisogno dei volumi e senza il problema di scala del POC
   * statico (che su un compounder finisce a un prezzo di dieci anni fa).
   */
  function expandingResidZ(prices, minObs) {
    minObs = minObs || 60;
    const n = prices.length, z = new Array(n).fill(NaN);
    let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, Syy = 0;
    for (let i = 0; i < n; i++) {
      if (!(prices[i] > 0)) continue;
      const x = i, y = Math.log(prices[i]);
      Sx += x; Sy += y; Sxx += x * x; Sxy += x * y; Syy += y * y;
      const k = i + 1;
      if (k < minObs) continue;
      const cxx = Sxx - (Sx * Sx) / k;
      const cxy = Sxy - (Sx * Sy) / k;
      const cyy = Syy - (Sy * Sy) / k;
      if (!(cxx > 0)) continue;
      const slope = cxy / cxx;
      const intercept = (Sy - slope * Sx) / k;
      const sse = Math.max(0, cyy - slope * cxy);
      const sd = Math.sqrt(sse / Math.max(1, k - 2));
      if (sd > 0) z[i] = (y - (intercept + slope * x)) / sd;
    }
    return z;
  }

  // ---- rendimento forward condizionato ---------------------------------------

  /**
   * Rendimento forward annualizzato a `horizonYears` condizionato allo stato in
   * cui compri (bucket di drawdown, oppure di z-score). Confrontato con
   * l'incondizionato: e il numero che dice se comprare sui ribassi paga.
   *
   * ATTENZIONE: su un universo selezionato perche NON ha mai avuto un
   * quinquennio negativo, questa statistica e gonfiata per costruzione. Va letta
   * solo accanto al controllo out-of-sample / universo non filtrato.
   */
  function conditionalForward(prices, signal, buckets, horizonYears, ppy) {
    ppy = ppy || 252;
    const h = Math.round(horizonYears * ppy);
    const n = prices.length;
    if (n <= h + 1) return null;
    const res = buckets.map(() => []);
    const all = [];
    for (let i = 0; i < n - h; i++) {
      const s = signal[i];
      if (!isFinite(s) || !(prices[i] > 0)) continue;
      const r = Math.pow(prices[i + h] / prices[i], 1 / horizonYears) - 1;
      if (!isFinite(r)) continue;
      all.push(r);
      for (let b = 0; b < buckets.length; b++) {
        if (s >= buckets[b].lo && s < buckets[b].hi) { res[b].push(r); break; }
      }
    }
    return {
      horizonYears,
      uncond: all.length ? { n: all.length, med: quantileOf(all, 0.5), mean: mean(all) } : null,
      buckets: buckets.map((b, i) => ({
        label: b.label, n: res[i].length,
        med: res[i].length ? quantileOf(res[i], 0.5) : null,
        mean: res[i].length ? mean(res[i]) : null,
        p10: res[i].length ? quantileOf(res[i], 0.1) : null,
        pNeg: res[i].length ? res[i].filter((x) => x < 0).length / res[i].length : null,
      })),
    };
  }

  const DD_BUCKETS = [
    { label: 'ai massimi (0 a −5%)', lo: -0.05, hi: Infinity },
    { label: '−5% a −10%', lo: -0.10, hi: -0.05 },
    { label: '−10% a −20%', lo: -0.20, hi: -0.10 },
    { label: '−20% a −30%', lo: -0.30, hi: -0.20 },
    { label: 'oltre −30%', lo: -Infinity, hi: -0.30 },
  ];
  const Z_BUCKETS = [
    { label: 'molto sotto trend (z ≤ −1)', lo: -Infinity, hi: -1 },
    { label: 'sotto trend (−1 a 0)', lo: -1, hi: 0 },
    { label: 'sopra trend (0 a +1)', lo: 0, hi: 1 },
    { label: 'molto sopra trend (z > +1)', lo: 1, hi: Infinity },
  ];

  // ---- strategie di ingresso -------------------------------------------------

  /** Massimo mobile sulle ultime `w` osservazioni (solo passato). */
  function rollingMax(prices, w) {
    const out = new Array(prices.length);
    for (let i = 0; i < prices.length; i++) {
      const from = Math.max(0, i - w + 1);
      let m = -Infinity;
      for (let j = from; j <= i; j++) if (prices[j] > m) m = prices[j];
      out[i] = m;
    }
    return out;
  }

  /**
   * Costruisce il segnale booleano "adesso investi" per una strategia.
   * `immediate` investe sempre; le altre aspettano una condizione.
   */
  function triggerSeries(prices, strat, ppy) {
    const n = prices.length;
    if (strat.kind === 'immediate') return new Array(n).fill(true);
    if (strat.kind === 'dip') {
      const dd = runningDrawdown(prices);
      // tolleranza: un ribasso esattamente del 20% da 120 a 96 vale -0.19999999999999996
      // in virgola mobile, e senza epsilon la soglia "-20%" non scatterebbe mai.
      return dd.map((x) => x <= -strat.dip + 1e-9);
    }
    if (strat.kind === 'breakout') {
      const w = Math.max(2, Math.round(strat.months / 12 * ppy));
      const rm = rollingMax(prices, w);
      return prices.map((p, i) => i >= w - 1 && p >= rm[i] * 0.999);
    }
    if (strat.kind === 'value') {
      const z = expandingResidZ(prices, Math.min(n - 1, Math.round(ppy / 2)));
      return z.map((x) => isFinite(x) && x <= strat.z);
    }
    return new Array(n).fill(true);
  }

  /**
   * Simula una strategia di ingresso su una serie di prezzi.
   *
   * `rfRet` = rendimenti per periodo della liquidita (array lungo n-1, oppure un
   * numero = tasso annuo costante). La cassa in attesa NON sta ferma a zero:
   * ignorarlo e il modo classico di far vincere il "compra sui ribassi".
   *
   * opt = { schedule:'lump'|'quarterly', strat:{...}, ppy }
   * Ritorna ricchezza finale per euro versato, quota media investita e se il
   * segnale non e mai scattato.
   */
  function simulateEntry(prices, rfRet, opt) {
    const ppy = opt.ppy || 252;
    const n = prices.length;
    if (n < 2) return null;
    const cashRet = Array.isArray(rfRet) ? rfRet
      : new Array(n - 1).fill(Math.pow(1 + (rfRet == null ? 0.02 : rfRet), 1 / ppy) - 1);
    const trig = triggerSeries(prices, opt.strat, ppy);
    const qStep = Math.max(1, Math.round(ppy / 4));

    // schema dei versamenti: identico per tutte le strategie
    const contrib = new Array(n).fill(0);
    if (opt.schedule === 'quarterly') {
      let k = 0;
      for (let i = 0; i < n; i += qStep) { contrib[i] = 1; k++; }
      if (k) for (let i = 0; i < n; i++) contrib[i] /= k;   // totale versato = 1
    } else contrib[0] = 1;

    let cash = 0, shares = 0, contributed = 0, investedSum = 0, everFired = false;
    for (let i = 0; i < n; i++) {
      if (i > 0) cash *= 1 + cashRet[i - 1];
      if (contrib[i] > 0) { cash += contrib[i]; contributed += contrib[i]; }
      if (cash > 0 && trig[i] && prices[i] > 0) {
        shares += cash / prices[i]; cash = 0; everFired = true;
      }
      const invested = shares * prices[i], tot = invested + cash;
      if (tot > 0) investedSum += invested / tot;
    }
    const terminal = shares * prices[n - 1] + cash;
    return {
      terminal, contributed, multiple: contributed > 0 ? terminal / contributed : NaN,
      timeInMarket: investedSum / n, everFired,
      endCashShare: terminal > 0 ? cash / terminal : 0,
    };
  }

  /** Le strategie messe a confronto, con etichette pronte per l'interfaccia. */
  function defaultStrategies(o) {
    o = o || {};
    return [
      { id: 'immediate', kind: 'immediate', label: 'Subito' },
      { id: 'dip10', kind: 'dip', dip: 0.10, label: 'Ribasso −10%' },
      { id: 'dip20', kind: 'dip', dip: 0.20, label: 'Ribasso −20%' },
      { id: 'dip30', kind: 'dip', dip: 0.30, label: 'Ribasso −30%' },
      { id: 'value0', kind: 'value', z: 0, label: 'Sotto il trend (z≤0)' },
      { id: 'value1', kind: 'value', z: -1, label: 'Molto sotto il trend (z≤−1)' },
      { id: 'break12', kind: 'breakout', months: 12, label: 'Rottura massimi 12m' },
    ].filter((s) => !o.only || o.only.includes(s.id));
  }

  /**
   * Confronto fra strategie su TUTTE le date di partenza possibili, non su una
   * sola. Il numero che serve non e "ha reso il 9.4%" ma "ha battuto il
   * riferimento nel 38% delle partenze, e quando ha perso ha perso di piu".
   *
   * opt = { schedule, ppy, startStep, minYears, strategies, baseline }
   */
  function compareEntries(prices, rfRet, opt) {
    opt = opt || {};
    const ppy = opt.ppy || 252;
    const strategies = opt.strategies || defaultStrategies();
    const baseId = opt.baseline || 'immediate';
    const startStep = opt.startStep || Math.round(ppy / 4);       // partenze trimestrali
    const minLen = Math.round((opt.minYears || 5) * ppy);          // orizzonte minimo
    const n = prices.length;
    if (n < minLen + 2) return null;

    const cashAll = Array.isArray(rfRet) ? rfRet : null;
    const acc = {}; strategies.forEach((s) => (acc[s.id] = { mult: [], rel: [], tim: [], noFire: 0 }));
    let starts = 0;
    for (let s0 = 0; s0 + minLen < n; s0 += startStep) {
      const px = prices.slice(s0);
      const rf = cashAll ? cashAll.slice(s0) : rfRet;
      const base = simulateEntry(px, rf, { schedule: opt.schedule || 'lump', strat: strategies.find((x) => x.id === baseId), ppy });
      if (!base || !isFinite(base.multiple)) continue;
      starts++;
      for (const st of strategies) {
        const r = simulateEntry(px, rf, { schedule: opt.schedule || 'lump', strat: st, ppy });
        if (!r || !isFinite(r.multiple)) continue;
        acc[st.id].mult.push(r.multiple);
        acc[st.id].rel.push(r.multiple / base.multiple);
        acc[st.id].tim.push(r.timeInMarket);
        if (!r.everFired) acc[st.id].noFire++;
      }
    }
    if (!starts) return null;
    return {
      starts, schedule: opt.schedule || 'lump', baseline: baseId,
      results: strategies.map((st) => {
        const a = acc[st.id];
        const rel = a.rel;
        return {
          id: st.id, label: st.label, n: rel.length,
          medMultiple: quantileOf(a.mult, 0.5),
          medRel: rel.length ? quantileOf(rel, 0.5) : null,
          p10Rel: rel.length ? quantileOf(rel, 0.1) : null,
          p90Rel: rel.length ? quantileOf(rel, 0.9) : null,
          winRate: rel.length ? rel.filter((x) => x > 1).length / rel.length : null,
          medLoss: rel.filter((x) => x < 1).length ? quantileOf(rel.filter((x) => x < 1), 0.5) : null,
          timeInMarket: a.tim.length ? mean(a.tim) : null,
          neverFired: rel.length ? a.noFire / rel.length : null,
        };
      }),
    };
  }

  /** Intervallo di confidenza del win rate con bootstrap a blocchi sulle partenze. */
  function bootstrapCI(values, stat, nSim, blockLen, rand) {
    const n = values.length;
    if (n < 4) return null;
    nSim = nSim || 400; blockLen = Math.max(1, blockLen || Math.round(Math.sqrt(n)));
    const out = [];
    for (let s = 0; s < nSim; s++) {
      const samp = [];
      while (samp.length < n) {
        let i = Math.floor(rand() * n);
        for (let b = 0; b < blockLen && samp.length < n; b++) { samp.push(values[i]); i = (i + 1) % n; }
      }
      out.push(stat(samp));
    }
    out.sort((a, b) => a - b);
    return { lo: quantile(out, 0.05), hi: quantile(out, 0.95) };
  }

  return {
    quantileOf, runningDrawdown, drawdownEpisodes, drawdownProfile,
    expandingResidZ, conditionalForward, DD_BUCKETS, Z_BUCKETS,
    rollingMax, triggerSeries, simulateEntry, defaultStrategies, compareEntries, bootstrapCI,
  };
});
