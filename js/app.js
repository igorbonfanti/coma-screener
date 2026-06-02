/* app.js — UI explorer coma-screener (in-sample ricalcolato live, OOS pre-calcolato) */
(function () {
  'use strict';
  const E = window.ComaEngine, CH = window.ComaCharts, LIVE = window.ComaLive;
  const $ = (s) => document.querySelector(s);
  const pct = (x, d = 1) => (x == null || isNaN(x) ? '–' : (x * 100).toFixed(d) + '%');
  const num = (x, d = 2) => (x == null || isNaN(x) ? '–' : (+x).toFixed(d));
  const cls = (x) => (x >= 0 ? 'pos' : 'neg');
  const wKey = { equal: 'wEqual', invvol: 'wInvvol', resampled: 'wResampled' };
  const schemeLabel = { equal: 'Equipeso', invvol: 'Risk-parity', resampled: 'Max-Sharpe' };

  const UNIVERSES = ['SP500', 'STOXX600', 'NASDAQ'];
  const DEFAULT_T = { minYears: 15, tolerance5y: -0.05, minR2: 0.90, minCagr: 0.10, maxDD: -0.45, topN: 20 };
  const T = { ...DEFAULT_T };
  let state = { universe: 'SP500', metrics: null, portfolio: null, curves: null, live: null,
    period: 'oos', scheme: 'equal', mode: 'rebal', sortKey: 'quality', sortDir: -1,
    basket: new Set(), build: null, lastScreen: [] };

  const CTRLS = [
    { k: 'minYears', label: 'Storia minima', min: 5, max: 30, step: 1, fmt: (v) => v + ' anni' },
    { k: 'tolerance5y', label: 'Tolleranza 5Y', min: -0.30, max: 0, step: 0.01, fmt: (v) => pct(v, 0) },
    { k: 'minR2', label: 'R² minimo', min: 0.70, max: 0.99, step: 0.01, fmt: (v) => num(v, 2) },
    { k: 'minCagr', label: 'CAGR minimo', min: 0, max: 0.25, step: 0.01, fmt: (v) => pct(v, 0) },
    { k: 'maxDD', label: 'Max Drawdown', min: -0.80, max: -0.20, step: 0.05, fmt: (v) => pct(v, 0) },
    { k: 'topN', label: 'Numero titoli', min: 5, max: 40, step: 1, fmt: (v) => v },
  ];
  const isDirty = () => CTRLS.some((c) => T[c.k] !== DEFAULT_T[c.k]);

  async function loadUniverse(u) {
    state.universe = u;
    try {
      const [m, p, c] = await Promise.all([
        fetch(`data/metrics_${u}.json`).then((r) => r.json()),
        fetch(`data/portfolio_${u}.json`).then((r) => r.json()),
        fetch(`data/curves_${u}.json`).then((r) => r.json()),
      ]);
      state.metrics = m; state.portfolio = p; state.curves = c;
      $('#updated').textContent = 'agg. ' + new Date(m.updated).toLocaleDateString('it-IT');
      recomputeLive();
      renderAll();
    } catch (e) {
      $('#kpis').innerHTML = `<div class="kpi"><div class="lab">Errore</div><div class="val" style="font-size:14px">Dati ${u} non disponibili</div></div>`;
      console.error(e);
    }
  }

  function recomputeLive() {
    state.live = LIVE.recompute(state.metrics, state.curves, T, { ...state.portfolio.params, nSim: 150 });
  }

  // blocco backtest corrente: in-sample = live, oos = pre-calcolato
  function currentBacktest() {
    if (state.period === 'oos') return state.portfolio.oos && state.portfolio.oos.backtest;
    return state.live && state.live.backtest;
  }

  function renderKpis() {
    const box = $('#kpis');
    const oosB = state.portfolio.oos && state.portfolio.oos.backtest;
    const insB = state.live && state.live.backtest;
    const om = oosB && oosB.schemes[state.scheme] && oosB.schemes[state.scheme].metrics;
    const im = insB && insB.schemes[state.scheme] && insB.schemes[state.scheme].metrics;
    const card = (lab, val, cmp) => `<div class="kpi"><div class="lab">${lab}</div><div class="val">${val}</div><div class="cmp">${cmp || ''}</div></div>`;
    let html = '';
    if (om) {
      const edge = om.rebal.cagr - (oosB.benchMetrics ? oosB.benchMetrics.cagr : 0);
      const tag = isDirty() ? ' · <span class="muted">par. default</span>' : '';
      html += card('CAGR Out-of-sample', pct(om.rebal.cagr),
        `bench ${pct(oosB.benchMetrics && oosB.benchMetrics.cagr)} · edge <b class="${cls(edge)}">${pct(edge, 1)}</b>${tag}`);
      html += card('Sharpe OOS', num(om.rebal.sharpe), `MaxDD ${pct(om.rebal.mdd, 0)}`);
    }
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
    if (!blk || !blk.schemes || !blk.schemes[state.scheme]) { CH.renderEquity([], { port: [], label: '–' }); return; }
    const sc = blk.schemes[state.scheme];
    const port = state.mode === 'buyhold' ? sc.buyhold : sc.rebal;
    const label = `Coma ${state.universe} · ${schemeLabel[state.scheme]}`;
    CH.renderEquity(blk.months, { port, bench: blk.bench, label });
    CH.renderDrawdown(blk.months, port, blk.bench);
  }

  function renderPortfolio() {
    const live = state.live;
    if (!live || live.insufficient || !live.picks.length) {
      $('#port-n').textContent = '';
      $('#port-tbl').innerHTML = '<tr><td>Soglie troppo restrittive: nessun titolo (o storia comune insufficiente).</td></tr>';
      return;
    }
    const wk = wKey[state.scheme];
    const picks = live.picks.slice().sort((a, b) => b[wk] - a[wk]);
    $('#port-n').textContent = `${picks.length} titoli · ${schemeLabel[state.scheme]}` +
      (state.scheme === 'resampled' ? ` · ${live.scenarios} scenari` : '') +
      (live.dropped ? ` · ${live.dropped} senza curva` : '') +
      (isDirty() ? ' · live' : '');
    const maxW = Math.max(...picks.map((x) => x[wk]));
    let h = '<tr><th>Ticker</th><th>Peso</th><th>Quality</th><th>CAGR</th><th>MaxDD</th><th>Min 5Y</th><th>R²</th><th>Reg.</th></tr>';
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
      h += `<div class="ctrl"><label>${c.label} <b id="lbl-${c.k}">${c.fmt(T[c.k])}</b></label>` +
        `<input type="range" id="rng-${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${T[c.k]}"></div>`;
    }
    $('#screen-ctrls').innerHTML = h;
    for (const c of CTRLS) {
      $('#rng-' + c.k).addEventListener('input', (e) => {
        T[c.k] = +e.target.value; $('#lbl-' + c.k).textContent = c.fmt(T[c.k]);
        renderScreenTable();
        scheduleLive();
      });
    }
  }

  let liveTimer = null;
  function scheduleLive() {
    clearTimeout(liveTimer);
    $('#port-n').textContent = 'ricalcolo…';
    liveTimer = setTimeout(() => { recomputeLive(); renderPortfolio(); renderKpis(); renderBacktest(); renderBasket(); }, 180);
  }

  function renderScreenTable() {
    const res = E.screen(state.metrics.rows, { ...T, ppy: 252, sortBy: state.sortKey });
    if (state.sortDir === 1) res.picks.reverse();
    state.lastScreen = res.picks;
    const s = res.skipped;
    $('#screen-summary').innerHTML =
      `<span class="pill">Analizzati ${state.metrics.count}</span>` +
      `<span class="pill">Passati ${res.passed}</span>` +
      `<span class="pill">mostrati ${res.picks.length}</span>` +
      `<span class="muted">scartati: storico ${s.storico} · 5Y neg ${s.cinqueY} · R² ${s.r2} · CAGR ${s.cagr} · DD ${s.dd}</span>`;
    const cols = [['t', 'Ticker'], ['quality', 'Quality'], ['cagr', 'CAGR'], ['vol', 'Vol'],
      ['mdd', 'MaxDD'], ['min5y', 'Min5Y'], ['r2', 'R²'], ['reg', 'Reg.'], ['mar', 'MAR'], ['sortino', 'Sortino']];
    let h = '<tr><th></th>' + cols.map(([k, l]) => `<th data-k="${k}">${l}${state.sortKey === k ? (state.sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('') + '</tr>';
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
      const res = LIVE.recomputeFromTickers(state.metrics, state.curves, [...state.basket], { ...state.portfolio.params, nSim: 150 });
      return { source: 'custom', res };
    }
    return { source: 'canonico', res: state.live };
  }

  function renderBasket() {
    const ab = activeBuild();
    state.build = ab;
    const chips = $('#basket-chips');
    if (state.basket.size) {
      chips.innerHTML = [...state.basket].map((t) =>
        `<span class="chip">${t}<b data-rm="${t}">×</b></span>`).join('') +
        `<span class="chip" style="cursor:pointer" id="basket-clear">svuota</span>`;
      chips.querySelectorAll('[data-rm]').forEach((el) => el.addEventListener('click', () => {
        state.basket.delete(el.dataset.rm); renderScreenTable(); renderBasket();
      }));
      $('#basket-clear').addEventListener('click', () => { state.basket.clear(); renderScreenTable(); renderBasket(); });
    } else {
      chips.innerHTML = '<span class="muted">Basket vuoto — verrà salvato/esportato il portafoglio canonico corrente.</span>';
    }
    const box = $('#basket-metrics');
    const r = ab.res;
    if (!r || r.insufficient || !r.picks.length) { box.innerHTML = '<div class="kpi"><div class="lab">Basket</div><div class="val" style="font-size:14px">titoli insufficienti</div></div>'; return; }
    const m = r.backtest.schemes[state.scheme].metrics.rebal;
    const bm = r.backtest.benchMetrics;
    const edge = bm ? m.cagr - bm.cagr : null;
    const card = (lab, val, cmp) => `<div class="kpi"><div class="lab">${lab}</div><div class="val">${val}</div><div class="cmp">${cmp || ''}</div></div>`;
    box.innerHTML =
      card(`${ab.source === 'custom' ? 'Custom' : 'Canonico'} · ${schemeLabel[state.scheme]}`, r.picks.length + ' titoli', r.dropped ? r.dropped + ' senza curva' : 'in-sample (mensile)') +
      card('CAGR in-sample', pct(m.cagr), edge != null ? `edge <b class="${cls(edge)}">${pct(edge, 1)}</b> vs bench` : '') +
      card('Sharpe', num(m.sharpe), `MaxDD ${pct(m.mdd, 0)}`);
  }

  async function saveSnapshot() {
    const ab = state.build || activeBuild();
    const r = ab.res;
    if (!r || !r.picks || r.picks.length < 2) { setStatus('Niente da salvare', true); return; }
    const wk = wKey[state.scheme];
    const m = r.backtest.schemes[state.scheme].metrics.rebal;
    const oosM = state.portfolio.oos && state.portfolio.oos.backtest &&
      state.portfolio.oos.backtest.schemes[state.scheme] && state.portfolio.oos.backtest.schemes[state.scheme].metrics.rebal;
    const snap = {
      universe: state.universe, source: ab.source, scheme: state.scheme,
      params: { ...T }, note: ($('#snap-note').value || '').slice(0, 200),
      picks: r.picks.map((x) => ({ t: x.t, w: +(x[wk]).toFixed(4) })),
      metricsIS: { cagr: m.cagr, sharpe: m.sharpe, mdd: m.mdd },
      metricsOOS: oosM ? { cagr: oosM.cagr, sharpe: oosM.sharpe, mdd: oosM.mdd } : null,
    };
    try {
      setStatus('salvataggio…');
      const id = await ComaStore.save(snap);
      setStatus('salvato ✓'); $('#snap-note').value = '';
      renderSnapshots();
    } catch (e) { setStatus('errore: ' + e.message, true); }
  }

  function exportExcel() {
    const ab = state.build || activeBuild();
    const oosB = state.portfolio.oos && state.portfolio.oos.backtest;
    ComaExport.toExcel({
      universe: state.universe, scheme: state.scheme,
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
        const cagr = s.metricsOOS ? pct(s.metricsOOS.cagr) : (s.metricsIS ? pct(s.metricsIS.cagr) + ' IS' : '–');
        return `<div class="snap"><span class="ld" data-load="${s.id}">${s.universe} · ${s.source} · ${s.scheme}</span>` +
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
    if (s.universe !== state.universe) { $('#universe').value = s.universe; }
    const apply = () => {
      state.scheme = s.scheme;
      $('#seg-scheme').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.scheme));
      state.basket = new Set(s.picks.map((p) => p.t));
      renderScreenTable(); renderBasket(); renderKpis(); renderBacktest();
      document.querySelector('#build-card').scrollIntoView({ behavior: 'smooth' });
    };
    if (s.universe !== state.universe) loadUniverse(s.universe).then(apply); else apply();
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

  function init() {
    const sel = $('#universe');
    sel.innerHTML = UNIVERSES.map((u) => `<option value="${u}">${u}</option>`).join('');
    sel.addEventListener('change', () => loadUniverse(sel.value));
    renderScreenCtrls();
    bindSeg('#seg-period', 'period', renderBacktest);
    bindSeg('#seg-scheme', 'scheme', () => { renderKpis(); renderBacktest(); renderPortfolio(); renderBasket(); });
    bindSeg('#seg-mode', 'mode', renderBacktest);
    $('#btn-save').addEventListener('click', saveSnapshot);
    $('#btn-export').addEventListener('click', exportExcel);
    ComaStore.init();
    renderSnapshots();
    loadUniverse('SP500');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
