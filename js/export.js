/* export.js — esportazione Excel (SheetJS) di screening + portafoglio + metriche. */
(function () {
  'use strict';
  const pct = (x) => (x == null || isNaN(x) ? null : +(x * 100).toFixed(2));
  const r3 = (x) => (x == null || isNaN(x) ? null : +(+x).toFixed(3));

  function toExcel(ctx) {
    if (typeof XLSX === 'undefined') { alert('Libreria Excel non caricata'); return; }
    const { universe, scheme, screenRows, portfolioPicks, isMetrics, oosMetrics,
      isReg, oosReg, bench } = ctx;
    const wb = XLSX.utils.book_new();

    // 1) Portafoglio (con pesi dello schema selezionato)
    const wKey = { equal: 'wEqual', invvol: 'wInvvol', resampled: 'wResampled' }[scheme];
    const port = portfolioPicks.map((x) => ({
      Ticker: x.t, 'Peso %': pct(x[wKey]), Quality: r3(x.quality), 'CAGR %': pct(x.cagr),
      'Vol %': pct(x.vol), 'MaxDD %': pct(x.mdd), 'Min5Y %': pct(x.min5y), R2: r3(x.r2), 'Reg %': pct(x.reg),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(port), 'Portafoglio');

    // 2) Metriche backtest + regressione sul benchmark (alfa/beta/t-stat)
    const mrow = (lab, m, g) => (m ? { Periodo: lab, 'CAGR %': pct(m.rebal.cagr), 'Vol %': pct(m.rebal.vol),
      'MaxDD %': pct(m.rebal.mdd), Sharpe: r3(m.rebal.sharpe), Sortino: r3(m.rebal.sortino),
      MAR: r3(m.rebal.mar), 'Turnover %/anno': pct(m.rebal.turnover),
      Benchmark: bench || null, Beta: g && g.rebal ? r3(g.rebal.beta) : null,
      'Alfa %': g && g.rebal ? pct(g.rebal.alpha) : null,
      't-stat alfa': g && g.rebal ? r3(g.rebal.alphaT) : null,
      'Alfa significativo': g && g.rebal ? (Math.abs(g.rebal.alphaT) >= 2 ? 'si' : 'NO') : null,
      'Tracking error %': g && g.rebal ? pct(g.rebal.te) : null,
      'Information ratio': g && g.rebal ? r3(g.rebal.ir) : null } : null);
    const mets = [mrow('In-sample (circolare)', isMetrics, isReg),
      mrow('Out-of-sample', oosMetrics, oosReg)].filter(Boolean);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mets), 'Backtest');

    // 3) Screening completo (tutti i passati)
    const scr = screenRows.map((r) => ({
      Ticker: r.t, Quality: r3(r.quality), 'CAGR %': pct(r.cagr), 'Vol %': pct(r.vol),
      'MaxDD %': pct(r.mdd), 'Min5Y %': pct(r.min5y), R2: r3(r.r2), 'Reg %': pct(r.reg),
      MAR: r3(r.mar), Sortino: r3(r.sortino),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scr), 'Screening');

    const oggi = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `coma_${universe}_${scheme}_${oggi}.xlsx`);
  }

  window.ComaExport = { toExcel };
})();
