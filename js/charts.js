/* charts.js — wrapper Chart.js per coma-screener (tema dark/light dinamico) */
(function () {
  'use strict';
  // legge i colori dal tema CSS corrente, così i grafici seguono il toggle dark/light
  function vars() {
    const s = getComputedStyle(document.documentElement);
    const g = (n, f) => (s.getPropertyValue(n).trim() || f);
    return {
      amber: g('--amber', '#f59e0b'), red: g('--red', '#f87171'),
      tx2: g('--tx2', '#9aa3b2'), tx3: g('--tx3', '#6b7280'),
      line: g('--line', '#272c38'), bg2: g('--bg2', '#1d212c'),
    };
  }
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size = 11;

  let equityChart = null, ddChart = null;

  const baseOpts = (logScale) => {
    const C = vars();
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, padding: 12, usePointStyle: true, color: C.tx2 } },
        tooltip: { backgroundColor: C.bg2, borderColor: C.line, borderWidth: 1, padding: 10, titleColor: C.tx2, bodyColor: C.tx2 },
      },
      scales: {
        x: { grid: { color: C.line, display: false }, ticks: { color: C.tx3, maxTicksLimit: 8, autoSkip: true } },
        y: logScale
          ? { type: 'logarithmic', grid: { color: C.line }, ticks: { color: C.tx3, callback: (v) => Number(v).toLocaleString() } }
          : { grid: { color: C.line }, ticks: { color: C.tx3 } },
      },
    };
  };

  function renderEquity(months, series) {
    const C = vars();
    const ds = [];
    if (series.bench) ds.push({ label: series.benchLabel || 'Benchmark', data: series.bench, borderColor: C.tx3, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: .05 });
    ds.push({ label: series.label || 'Portafoglio', data: series.port, borderColor: C.amber, backgroundColor: 'rgba(245,158,11,.07)', borderWidth: 2, pointRadius: 0, fill: true, tension: .05 });
    const cfg = { type: 'line', data: { labels: months, datasets: ds }, options: baseOpts(true) };
    if (equityChart) { equityChart.options = cfg.options; equityChart.data = cfg.data; equityChart.update(); }
    else equityChart = new Chart(document.getElementById('equity'), cfg);
  }

  function renderDrawdown(months, port, bench) {
    const C = vars();
    const dd = (curve) => { let pk = -Infinity; return curve.map((x) => { if (x > pk) pk = x; return pk > 0 ? (x / pk - 1) * 100 : 0; }); };
    const dsets = [{ label: 'Drawdown portafoglio', data: dd(port), borderColor: C.amber, backgroundColor: 'rgba(245,158,11,.15)', borderWidth: 1.5, pointRadius: 0, fill: true }];
    if (bench) dsets.push({ label: 'Drawdown benchmark', data: dd(bench), borderColor: C.red, backgroundColor: 'rgba(248,113,113,.10)', borderWidth: 1, pointRadius: 0, fill: true });
    const opts = baseOpts(false);
    opts.scales.y.ticks = { color: C.tx3, callback: (v) => v + '%' };
    const cfg = { type: 'line', data: { labels: months, datasets: dsets }, options: opts };
    if (ddChart) { ddChart.options = cfg.options; ddChart.data = cfg.data; ddChart.update(); }
    else ddChart = new Chart(document.getElementById('drawdown'), cfg);
  }

  window.ComaCharts = { renderEquity, renderDrawdown };
})();
