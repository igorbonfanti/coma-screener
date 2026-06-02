/* charts.js — wrapper Chart.js per coma-screener (tema dark Antigravity) */
(function () {
  'use strict';
  const C = { amber: '#f59e0b', blue: '#60a5fa', red: '#f87171', tx3: '#6b7280', line: '#272c38' };
  Chart.defaults.color = '#9aa3b2';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size = 11;

  let equityChart = null, ddChart = null;

  const baseOpts = (logScale) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, padding: 12, usePointStyle: true } },
      tooltip: { backgroundColor: '#1d212c', borderColor: C.line, borderWidth: 1, padding: 10 },
    },
    scales: {
      x: { grid: { color: C.line, display: false }, ticks: { maxTicksLimit: 8, autoSkip: true } },
      y: logScale
        ? { type: 'logarithmic', grid: { color: C.line }, ticks: { callback: (v) => Number(v).toLocaleString() } }
        : { grid: { color: C.line } },
    },
  });

  function renderEquity(months, series) {
    const ds = [];
    if (series.bench) ds.push({ label: 'Benchmark', data: series.bench, borderColor: C.tx3, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: .05 });
    ds.push({ label: series.label || 'Portafoglio', data: series.port, borderColor: C.amber, backgroundColor: 'rgba(245,158,11,.06)', borderWidth: 2, pointRadius: 0, fill: true, tension: .05 });
    const cfg = { type: 'line', data: { labels: months, datasets: ds }, options: baseOpts(true) };
    if (equityChart) { equityChart.data = cfg.data; equityChart.update(); }
    else equityChart = new Chart(document.getElementById('equity'), cfg);
  }

  function renderDrawdown(months, port, bench) {
    const dd = (curve) => { let pk = -Infinity; return curve.map((x) => { if (x > pk) pk = x; return pk > 0 ? (x / pk - 1) * 100 : 0; }); };
    const ds = [{ label: 'Drawdown portafoglio', data: dd(port), borderColor: C.amber, backgroundColor: 'rgba(245,158,11,.15)', borderWidth: 1.5, pointRadius: 0, fill: true }];
    if (bench) ds.push({ label: 'Drawdown benchmark', data: dd(bench), borderColor: C.red, backgroundColor: 'rgba(248,113,113,.10)', borderWidth: 1, pointRadius: 0, fill: true });
    const opts = baseOpts(false);
    opts.scales.y.ticks = { callback: (v) => v + '%' };
    const cfg = { type: 'line', data: { labels: months, datasets: ds }, options: opts };
    if (ddChart) { ddChart.data = cfg.data; ddChart.update(); }
    else ddChart = new Chart(document.getElementById('drawdown'), cfg);
  }

  window.ComaCharts = { renderEquity, renderDrawdown };
})();
