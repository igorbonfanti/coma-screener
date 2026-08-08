/* Self-test del motore: dati sintetici (no rete) + opzionale fetch reale.
 * Uso:  node _test_engine.js          (solo unit test)
 *       node _test_engine.js --net    (anche validazione accesso Yahoo)
 */
'use strict';
const E = require('./engine');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? '  -> ' + extra : '')); }
}
const approx = (a, b, tol) => Math.abs(a - b) <= (tol ?? 1e-6);

console.log('== UNIT TEST (sintetici) ==');

// Curva esponenziale perfetta: log-lineare => R2 = 1, CAGR noto.
const ppy = 252, years = 20, g = 0.12; // 12%/anno
const n = ppy * years;
const perStep = Math.pow(1 + g, 1 / ppy);
const expo = Array.from({ length: n }, (_, i) => 100 * Math.pow(perStep, i));

ok('R2 curva esponenziale ~1', approx(E.logLinearityR2(expo), 1, 1e-6), E.logLinearityR2(expo));
ok('CAGR curva esponenziale ~12%', approx(E.cagr(expo, ppy), g, 1e-3), E.cagr(expo, ppy));
ok('MaxDD curva monotona = 0', approx(E.maxDrawdown(expo), 0, 1e-9), E.maxDrawdown(expo));
ok('Min5Y curva crescente > 0', E.rollingMinReturn(expo, 5 * ppy) > 0, E.rollingMinReturn(expo, 5 * ppy));

// Drawdown noto: sale a 200 poi scende a 100 => -50%.
const dd = [100, 150, 200, 150, 100, 120];
ok('MaxDD -50%', approx(E.maxDrawdown(dd), -0.5, 1e-9), E.maxDrawdown(dd));

// Proiezione capped simplex: somma 1 e rispetto box.
const proj = E.projectCappedSimplex([0.5, 0.3, 0.1, 0.05, 0.05], 0.02, 0.20);
ok('proiezione somma a 1', approx(proj.reduce((a, b) => a + b, 0), 1, 1e-9));
ok('proiezione rispetta cap 0.20', Math.max(...proj) <= 0.20 + 1e-9, Math.max(...proj));
ok('proiezione rispetta floor 0.02', Math.min(...proj) >= 0.02 - 1e-9, Math.min(...proj));

// Max-Sharpe: con 2 asset scorrelati, peso maggiore a Sharpe piu alto.
const mu = [0.15, 0.08], cov = [[0.04, 0], [0, 0.04]];
const w2 = E.maxSharpe(mu, cov, 0.03, 0.0, 1.0, 500);
ok('maxSharpe favorisce asset migliore', w2[0] > w2[1], w2.join(', '));
ok('maxSharpe somma a 1', approx(w2[0] + w2[1], 1, 1e-6));

// Backtest: buy&hold vs ribilanciato su due curve identiche => uguali, CAGR coerente.
const A = expo, B = expo.map((x) => x * 0.5);
const curves = { A, B };
const eqRb = E.backtestPortfolio(curves, ['A', 'B'], [0.5, 0.5], { rebalance: 'annual', ppy });
const eqBh = E.backtestPortfolio(curves, ['A', 'B'], [0.5, 0.5], { rebalance: 'none', ppy });
ok('backtest ribilanciato CAGR ~12%', approx(E.cagr(eqRb, ppy), g, 5e-3), E.cagr(eqRb, ppy));
ok('backtest buy&hold CAGR ~12%', approx(E.cagr(eqBh, ppy), g, 5e-3), E.cagr(eqBh, ppy));
ok('backtest: firma booleana retro-compatibile',
  approx(E.cagr(E.backtestPortfolio(curves, ['A', 'B'], [0.5, 0.5], false), ppy), E.cagr(eqBh, ppy), 1e-12));

// Curve proporzionali => nessun drift => turnover e costi nulli.
ok('turnover nullo su curve proporzionali', eqRb.turnover < 1e-9, eqRb.turnover);

// Con drift reale, i costi devono ridurre il montante finale.
const C1 = Array.from({ length: n }, (_, i) => 100 * Math.pow(1.15, i / ppy));
const C2 = Array.from({ length: n }, (_, i) => 100 * Math.pow(1.05, i / ppy));
const noCost = E.backtestPortfolio({ C1, C2 }, ['C1', 'C2'], [0.5, 0.5], { rebalance: 'annual', ppy, costBps: 0 });
const wiCost = E.backtestPortfolio({ C1, C2 }, ['C1', 'C2'], [0.5, 0.5], { rebalance: 'annual', ppy, costBps: 15 });
ok('turnover > 0 con drift', noCost.turnover > 0.01, noCost.turnover);
ok('i costi riducono il montante finale', wiCost[n - 1] < noCost[n - 1],
  `${wiCost[n - 1].toFixed(2)} vs ${noCost[n - 1].toFixed(2)}`);
// Ribilanciare ogni giorno regala rebalancing premium rispetto all'annuale.
const eqDaily = E.backtestPortfolio({ C1, C2 }, ['C1', 'C2'], [0.5, 0.5], { rebalance: 'daily', ppy, costBps: 0 });
ok('frequenza di ribilanciamento cambia il risultato', Math.abs(eqDaily[n - 1] - noCost[n - 1]) > 1e-6);

// Sharpe: media aritmetica degli excess, non CAGR/vol.
const flatRf = 0.03;
const shExp = E.sharpeRatio(expo, ppy, flatRf);
ok('Sharpe curva senza vol = NaN o enorme', !isFinite(shExp) || shExp > 100, shExp);
const noisy2 = expo.map((x, i) => x * (1 + 0.1 * Math.sin(i / 3)));
ok('Sharpe finito su curva rumorosa', isFinite(E.sharpeRatio(noisy2, ppy, flatRf)), E.sharpeRatio(noisy2, ppy, flatRf));
ok('rf come serie = rf costante equivalente',
  approx(E.sharpeRatio(noisy2, ppy, flatRf),
    E.sharpeRatio(noisy2, ppy, new Array(n - 1).fill(Math.pow(1.03, 1 / ppy) - 1)), 1e-9));
ok('annualizedRf ricostruisce il tasso', approx(E.annualizedRf(0.03, ppy, n), 0.03, 1e-6), E.annualizedRf(0.03, ppy, n));

// Downside deviation: denominatore = N totale, non i soli negativi.
const mixed = [100, 110, 99, 108, 97, 106];
const rr = E.periodReturns(mixed);
let ssNeg = 0; for (const x of rr) if (x < 0) ssNeg += x * x;
ok('downsideVol divide per N totale',
  approx(E.downsideVol(mixed, 1), Math.sqrt(ssNeg / rr.length), 1e-12), E.downsideVol(mixed, 1));

// Regressione: portafoglio = 0.5x il benchmark => beta 0.5, alfa ~0.
const rand = E.rng(7);
const bR = Array.from({ length: 400 }, () => (rand() - 0.5) * 0.04);
const pR = bR.map((x) => 0.5 * x);
const reg = E.regress(pR, bR, 0, 12);
ok('regress beta = 0.5', approx(reg.beta, 0.5, 1e-9), reg.beta);
ok('regress alfa ~ 0', Math.abs(reg.alpha) < 1e-9, reg.alpha);
// Con alfa iniettato + rumore idiosincratico, alfa stimato ~ vero e t-stat alto.
const pR2 = bR.map((x) => 0.5 * x + 0.004 + (rand() - 0.5) * 0.01);
const reg2 = E.regress(pR2, bR, 0, 12);
ok('regress stima l\'alfa iniettato (~4.8%/anno)', approx(reg2.alpha, 0.048, 5e-3), reg2.alpha);
ok('regress t-stat alto su alfa vero', reg2.alphaT > 10, reg2.alphaT);
// Alfa nullo + solo rumore => t-stat piccolo (il test deve saper dire "non c'e edge").
const pR3 = bR.map((x) => 0.5 * x + (rand() - 0.5) * 0.01);
ok('regress t-stat basso senza alfa', Math.abs(E.regress(pR3, bR, 0, 12).alphaT) < 2,
  E.regress(pR3, bR, 0, 12).alphaT);

// Screen: una riga con metriche NaN non deve passare i filtri.
const scr = E.screen([
  { t: 'GOOD', days: 5000, min5y: 0.2, r2: 0.95, cagr: 0.12, mdd: -0.3, quality: 0.9 },
  { t: 'NAN', days: 5000, min5y: NaN, r2: NaN, cagr: NaN, mdd: NaN, quality: 0.5 },
], { minYears: 15, ppy: 252, tolerance5y: -0.05, minR2: 0.9, minCagr: 0.10, maxDD: -0.45 });
ok('screen scarta le righe con metriche NaN',
  scr.picks.length === 1 && scr.picks[0].t === 'GOOD', scr.picks.map((x) => x.t).join(','));

// Regolarita: curva esponenziale perfetta => residui ~0.
ok('logResidStd curva perfetta ~0', E.logResidStd(expo) < 1e-9, E.logResidStd(expo));
// Una curva nervosa ha residui > di una liscia.
const noisy = expo.map((x, i) => x * (1 + 0.15 * Math.sin(i / 7)));
ok('logResidStd: nervosa > liscia', E.logResidStd(noisy) > E.logResidStd(expo));

// Quality score: rank-based, il titolo dominante ha quality piu alta.
const qrows = [
  { r2: 0.99, min5y: 0.30, mar: 0.6 },  // migliore su tutto
  { r2: 0.95, min5y: 0.10, mar: 0.4 },
  { r2: 0.80, min5y: -0.20, mar: 0.2 }, // peggiore su tutto
];
E.addQualityScore(qrows);
ok('quality: dominante = 1', approx(qrows[0].quality, 1, 1e-9), qrows[0].quality);
ok('quality: peggiore = 0', approx(qrows[2].quality, 0, 1e-9), qrows[2].quality);
ok('quality ordinata', qrows[0].quality > qrows[1].quality && qrows[1].quality > qrows[2].quality);

// inverse-vol: asset meno volatile pesa di piu.
const Rmix = Array.from({ length: 600 }, (_, i) => [0.001 + 0.002 * Math.sin(i), 0.001 + 0.05 * Math.sin(i * 1.3)]);
const wiv = E.inverseVolWeights(Rmix, 0.0, 1.0);
ok('inverse-vol favorisce il meno volatile', wiv[0] > wiv[1], wiv.join(', '));
ok('inverse-vol somma a 1', approx(wiv[0] + wiv[1], 1, 1e-9));

// computeWeights equal.
const we = E.computeWeights('equal', Rmix).weights;
ok('equal = 1/n', approx(we[0], 0.5, 1e-9) && approx(we[1], 0.5, 1e-9));

console.log(`\nUNIT: ${pass} pass / ${fail} fail`);

// -- validazione rete opzionale --------------------------------------------
async function netTest() {
  console.log('\n== NET TEST (Yahoo chart API) ==');
  const { fetchSeries } = require('./yahoo');
  for (const sym of ['MSFT', 'OR.PA', 'NESN.SW']) {
    const s = await fetchSeries(sym);
    if (!s) { console.log(`  FAIL ${sym}: nessun dato`); fail++; continue; }
    const m = E.metricsFor(s.px, 252);
    const y0 = new Date(s.ts[0] * 1000).getFullYear();
    const y1 = new Date(s.ts[s.ts.length - 1] * 1000).getFullYear();
    console.log(`  PASS ${sym}: ${s.px.length} gg (${y0}-${y1}) ${s.currency}` +
      ` | CAGR ${(m.cagr * 100).toFixed(1)}% R2 ${m.r2.toFixed(3)}` +
      ` MaxDD ${(m.mdd * 100).toFixed(0)}% Min5Y ${(m.min5y * 100).toFixed(0)}%`);
    pass++;
  }
}

(async () => {
  if (process.argv.includes('--net')) { try { await netTest(); } catch (e) { console.log('NET errore:', e.message); } }
  console.log(`\nTOTALE: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
