/* charts.js — wrapper Chart.js per coma-screener (tema dark/light dinamico).
 * Impostazione editoriale: niente legenda (le serie sono etichettate in fondo
 * alla linea, dove l'occhio arriva gia), niente griglia verticale, valore finale
 * annotato. Meno cornice, piu dato. */
(function () {
  'use strict';
  // legge i colori dal tema CSS corrente, così i grafici seguono il toggle dark/light
  function vars() {
    const s = getComputedStyle(document.documentElement);
    const g = (n, f) => (s.getPropertyValue(n).trim() || f);
    return {
      accent: g('--accent', '#0d6e6e'), red: g('--red', '#b4553e'),
      tx: g('--tx', '#1b1813'), tx2: g('--tx2', '#57503f'), tx3: g('--tx3', '#8d8574'),
      line: g('--line', '#e4ddd0'), bg: g('--bg', '#fbf7f1'),
    };
  }
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size = 11;

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
   * Etichetta ogni serie alla fine della sua linea, con il valore finale.
   * Sostituisce la legenda: nessun salto occhio→legenda→linea.
   */
  const directLabels = {
    id: 'directLabels',
    afterDatasetsDraw(chart, args, opts) {
      const { ctx } = chart;
      const fmt = opts && opts.fmt ? opts.fmt : (v) => v;
      const placed = [];
      ctx.save();
      ctx.font = '600 11px ' + Chart.defaults.font.family;
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || !meta.data.length) return;
        const last = meta.data[meta.data.length - 1];
        if (!last) return;
        const v = ds.data[ds.data.length - 1];
        if (v == null) return;
        let y = last.y;
        // evita che due etichette si sovrappongano
        while (placed.some((p) => Math.abs(p - y) < 13)) y += 13;
        placed.push(y);
        ctx.fillStyle = ds.borderColor;
        ctx.fillText(fmt(v), last.x + 7, y);
        ctx.font = '400 10px ' + Chart.defaults.font.family;
        ctx.fillText(shortLabel(ds.label), last.x + 7, y + 12);
        ctx.font = '600 11px ' + Chart.defaults.font.family;
      });
      ctx.restore();
    },
  };

  const baseOpts = (logScale, labelFmt) => {
    const C = vars();
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 92, top: 6 } },   // spazio per le etichette in linea
      plugins: {
        legend: { display: false },
        directLabels: { fmt: labelFmt },
        tooltip: {
          backgroundColor: C.tx, borderWidth: 0, padding: 10, cornerRadius: 7,
          titleColor: C.bg, bodyColor: C.bg, displayColors: false,
          titleFont: { weight: '600' },
        },
      },
      scales: {
        x: { border: { color: C.line }, grid: { display: false },
          ticks: { color: C.tx3, maxTicksLimit: 6, autoSkip: true, maxRotation: 0 } },
        y: Object.assign(
          { border: { display: false }, grid: { color: C.line, drawTicks: false },
            ticks: { color: C.tx3, maxTicksLimit: 5, padding: 8 } },
          logScale ? { type: 'logarithmic',
            ticks: { color: C.tx3, maxTicksLimit: 5, padding: 8, callback: (v) => Number(v).toLocaleString('it-IT') } } : {}
        ),
      },
    };
  };

  function renderEquity(months, series) {
    const C = vars();
    const ds = [];
    if (series.bench) ds.push({ label: series.benchLabel || 'Benchmark', data: series.bench,
      borderColor: C.tx3, borderWidth: 1.2, borderDash: [4, 4], pointRadius: 0, tension: .05 });
    ds.push({ label: series.label || 'Portafoglio', data: series.port, borderColor: C.accent,
      borderWidth: 2, pointRadius: 0, tension: .05 });
    const cfg = { type: 'line', data: { labels: months, datasets: ds },
      options: baseOpts(true, (v) => Math.round(v).toLocaleString('it-IT')), plugins: [directLabels] };
    if (equityChart) { equityChart.options = cfg.options; equityChart.data = cfg.data; equityChart.update(); }
    else equityChart = new Chart(document.getElementById('equity'), cfg);
  }

  function renderDrawdown(months, port, bench) {
    const C = vars();
    const dd = (curve) => { let pk = -Infinity; return curve.map((x) => { if (x > pk) pk = x; return pk > 0 ? (x / pk - 1) * 100 : 0; }); };
    const dsets = [];
    if (bench) dsets.push({ label: 'Benchmark', data: dd(bench), borderColor: C.tx3,
      borderWidth: 1.2, borderDash: [4, 4], pointRadius: 0 });
    dsets.push({ label: 'Portafoglio', data: dd(port), borderColor: C.accent,
      backgroundColor: 'color-mix(in srgb, ' + C.accent + ' 12%, transparent)',
      borderWidth: 1.6, pointRadius: 0, fill: true });
    const opts = baseOpts(false, (v) => Math.round(v) + '%');
    opts.scales.y.ticks = { color: C.tx3, maxTicksLimit: 5, padding: 8, callback: (v) => v + '%' };
    const cfg = { type: 'line', data: { labels: months, datasets: dsets }, options: opts, plugins: [directLabels] };
    if (ddChart) { ddChart.options = cfg.options; ddChart.data = cfg.data; ddChart.update(); }
    else ddChart = new Chart(document.getElementById('drawdown'), cfg);
  }

  window.ComaCharts = { renderEquity, renderDrawdown };
})();
