/* charts.js — grafici del terminale.
 * Colori letti dai token del design system, quindi seguono anche il tema CVD.
 * Regole seguite: niente legenda dentro il grafico (le serie sono etichettate
 * alla fine della propria linea), niente griglia verticale, serie principale in
 * `ink` e riferimento in `amber`, ultimo valore in un cartellino ambra con
 * testo nero sull'asse destro. */
(function () {
  'use strict';
  function vars() {
    const s = getComputedStyle(document.getElementById('term') || document.documentElement);
    const g = (n, f) => (s.getPropertyValue(n).trim() || f);
    return {
      bg: g('--bg', '#000'), amber: g('--amber', '#ffa028'),
      ink: g('--ink', '#e8e8e8'), ink2: g('--ink-2', '#b4b4b4'), ink3: g('--ink-3', '#8a8a8a'),
      rule: g('--rule', '#2a2a2a'), grid: g('--grid', '#1a1a1a'),
      down: g('--down', '#ef4444'), chartLine: g('--chart-line', '#5a5a5a'),
      mono: g('--f-mono', 'monospace').replace(/^\s+/, ''),
    };
  }
  Chart.defaults.font.family = "'IBM Plex Mono', ui-monospace, monospace";
  Chart.defaults.font.size = 10.5;

  let equityChart = null, ddChart = null;

  /** Nome corto per l'etichetta in linea: "S&P 500 Total Return" -> "S&P 500". */
  function shortLabel(s) {
    if (!s) return '';
    let t = String(s).replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/\s*(total return|composite|tr)\b/gi, '').trim();
    if (!t) t = String(s).trim();
    return t.length > 17 ? t.slice(0, 16).trim() + '…' : t;
  }

  /**
   * Etichetta ogni serie alla fine della propria linea. L'ultimo valore della
   * serie principale sta in un cartellino ambra con testo nero, come chiede il
   * design system; le altre serie restano testo del proprio colore.
   */
  const directLabels = {
    id: 'directLabels',
    afterDatasetsDraw(chart, args, opts) {
      const { ctx } = chart;
      const C = vars();
      const fmt = opts && opts.fmt ? opts.fmt : (v) => v;
      const placed = [];
      ctx.save();
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || !meta.data.length) return;
        const last = meta.data[meta.data.length - 1];
        if (!last) return;
        const v = ds.data[ds.data.length - 1];
        if (v == null) return;
        let y = last.y;
        while (placed.some((p) => Math.abs(p - y) < 14)) y += 14;
        placed.push(y);
        const txt = fmt(v);
        const x = last.x + 6;
        ctx.font = '600 10.5px ' + Chart.defaults.font.family;
        if (ds.__tag) {                       // cartellino ambra, testo nero
          const w = ctx.measureText(txt).width + 8;
          ctx.fillStyle = C.amber;
          ctx.fillRect(x, y - 7, w, 14);
          ctx.fillStyle = C.bg;
          ctx.fillText(txt, x + 4, y);
        } else {
          ctx.fillStyle = ds.borderColor;
          ctx.fillText(txt, x, y);
        }
        ctx.font = '400 10px ' + Chart.defaults.font.family;
        ctx.fillStyle = C.ink3;
        ctx.fillText(shortLabel(ds.label), x, y + 12);
      });
      ctx.restore();
    },
  };

  const baseOpts = (logScale, labelFmt) => {
    const C = vars();
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 96, top: 8 } },   // spazio per le etichette in linea
      plugins: {
        legend: { display: false },
        directLabels: { fmt: labelFmt },
        tooltip: {
          backgroundColor: C.bg, borderColor: C.amber, borderWidth: 1, cornerRadius: 0,
          padding: 8, titleColor: C.ink, bodyColor: C.ink2, displayColors: false,
          titleFont: { weight: '600' },
        },
      },
      scales: {
        x: { border: { color: C.rule }, grid: { display: false },
          ticks: { color: C.ink3, maxTicksLimit: 6, autoSkip: true, maxRotation: 0 } },
        y: Object.assign(
          { border: { display: false }, grid: { color: C.grid, drawTicks: false },
            ticks: { color: C.ink3, maxTicksLimit: 5, padding: 8 } },
          logScale ? { type: 'logarithmic',
            ticks: { color: C.ink3, maxTicksLimit: 5, padding: 8,
              callback: (v) => Number(v).toLocaleString('it-IT') } } : {}
        ),
      },
    };
  };

  function renderEquity(months, series) {
    const C = vars();
    const ds = [];
    if (series.bench) ds.push({ label: series.benchLabel || 'Benchmark', data: series.bench,
      borderColor: C.amber, borderWidth: 1.3, borderDash: [4, 4], pointRadius: 0, tension: 0.05 });
    ds.push({ label: series.label || 'Portafoglio', data: series.port, borderColor: C.ink,
      borderWidth: 2, pointRadius: 0, tension: 0.05, __tag: true });
    const cfg = { type: 'line', data: { labels: months, datasets: ds },
      options: baseOpts(true, (v) => Math.round(v).toLocaleString('it-IT')), plugins: [directLabels] };
    if (equityChart) { equityChart.options = cfg.options; equityChart.data = cfg.data; equityChart.update(); }
    else equityChart = new Chart(document.getElementById('equity'), cfg);
  }

  function renderDrawdown(months, port, bench) {
    const C = vars();
    const dd = (curve) => { let pk = -Infinity; return curve.map((x) => { if (x > pk) pk = x; return pk > 0 ? (x / pk - 1) * 100 : 0; }); };
    const dsets = [];
    if (bench) dsets.push({ label: 'Benchmark', data: dd(bench), borderColor: C.chartLine,
      borderWidth: 1.2, borderDash: [4, 4], pointRadius: 0 });
    dsets.push({ label: 'Portafoglio', data: dd(port), borderColor: C.ink,
      backgroundColor: 'rgba(239, 68, 68, 0.14)', borderWidth: 1.6, pointRadius: 0, fill: true, __tag: true });
    const fmtPc = (v) => (v < 0 ? '−' : '') + Math.abs(Math.round(v)) + '%';
    const opts = baseOpts(false, fmtPc);
    opts.scales.y.ticks = { color: C.ink3, maxTicksLimit: 5, padding: 8, callback: fmtPc };
    const cfg = { type: 'line', data: { labels: months, datasets: dsets }, options: opts, plugins: [directLabels] };
    if (ddChart) { ddChart.options = cfg.options; ddChart.data = cfg.data; ddChart.update(); }
    else ddChart = new Chart(document.getElementById('drawdown'), cfg);
  }

  window.ComaCharts = { renderEquity, renderDrawdown };
})();
