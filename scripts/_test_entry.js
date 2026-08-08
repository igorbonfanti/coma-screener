/* Self-test del modulo drawdown / strategie di ingresso (dati sintetici, no rete).
 *   node scripts/_test_entry.js
 */
'use strict';
const E = require('./engine');
const X = require('./entry');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra != null ? '  -> ' + extra : '')); }
}
const approx = (a, b, tol) => Math.abs(a - b) <= (tol ?? 1e-6);
const ppy = 252;

console.log('== DRAWDOWN ==');

// Serie con due ribassi noti: -20% recuperato, -50% recuperato.
const seq = [100, 120, 96, 130, 140, 70, 150, 160];
const dd = X.runningDrawdown(seq);
ok('drawdown corrente 0 ai massimi', approx(dd[0], 0) && approx(dd[7], 0), dd.join(','));
ok('drawdown -20% dopo 120->96', approx(dd[2], -0.2, 1e-9), dd[2]);
ok('drawdown -50% dopo 140->70', approx(dd[5], -0.5, 1e-9), dd[5]);

const eps = X.drawdownEpisodes(seq, 0.05, 1);
ok('due episodi individuati', eps.length === 2, eps.length);
ok('primo episodio -20%', approx(eps[0].depth, -0.2, 1e-9), eps[0].depth);
ok('secondo episodio -50%', approx(eps[1].depth, -0.5, 1e-9), eps[1].depth);
ok('entrambi recuperati', eps.every((e) => e.recovered));
ok('tempi di recupero corretti', eps[0].recoveryLen === 1 && eps[1].recoveryLen === 1,
  eps.map((e) => e.recoveryLen).join(','));

// Episodio ancora aperto a fine serie.
const openSeq = [100, 120, 140, 100];
const oe = X.drawdownEpisodes(openSeq, 0.05, 1);
ok('episodio aperto marcato non recuperato', oe.length === 1 && !oe[0].recovered && oe[0].recoveryLen === null);

// Curva monotona: nessun episodio, mai sott'acqua.
const up = Array.from({ length: 500 }, (_, i) => 100 * Math.pow(1.0005, i));
ok('curva monotona: zero episodi', X.drawdownEpisodes(up, 0.05, ppy).length === 0);
const prof = X.drawdownProfile(up, ppy);
ok('curva monotona: 0% sott\'acqua', approx(prof.pctUnderwater, 0, 1e-9), prof.pctUnderwater);

// Profilo su serie con ribassi: la frequenza deve essere coerente.
const prof2 = X.drawdownProfile(seq, 1, [0.10, 0.30]);
ok('frequenza: 2 episodi oltre -10%', prof2.freq.d10.episodes === 2, prof2.freq.d10.episodes);
ok('frequenza: 1 episodio oltre -30%', prof2.freq.d30.episodes === 1, prof2.freq.d30.episodes);
ok('profondita mediana 35%', approx(prof2.medDepth, 0.35, 1e-9), prof2.medDepth);

console.log('\n== RESIDUO DAL TREND (finestra espansiva) ==');

// Esponenziale perfetta: residui ~0, quindi z indefinito o piccolissimo.
const expo = Array.from({ length: 800 }, (_, i) => 100 * Math.pow(1.0004, i));
const zExp = X.expandingResidZ(expo, 60).filter(isFinite);
ok('trend perfetto: z trascurabile', zExp.every((v) => Math.abs(v) < 1e-3), Math.max(...zExp.map(Math.abs)));

// Trend + oscillazione: z deve essere negativo nei minimi e positivo nei massimi.
const wave = expo.map((x, i) => x * (1 + 0.12 * Math.sin(i / 40)));
const zW = X.expandingResidZ(wave, 120);
let lowOk = true, highOk = true;
for (let i = 300; i < wave.length; i++) {
  const s = Math.sin(i / 40);
  if (s < -0.9 && !(zW[i] < 0)) lowOk = false;
  if (s > 0.9 && !(zW[i] > 0)) highOk = false;
}
ok('z negativo sotto il trend', lowOk);
ok('z positivo sopra il trend', highOk);

// Nessun look-ahead: z al tempo t non deve cambiare se allungo la serie dopo t.
const zShort = X.expandingResidZ(wave.slice(0, 500), 120);
const zLong = X.expandingResidZ(wave, 120);
let sameHead = true;
for (let i = 0; i < 500; i++) {
  const a = zShort[i], b = zLong[i];
  if (isFinite(a) !== isFinite(b) || (isFinite(a) && !approx(a, b, 1e-12))) { sameHead = false; break; }
}
ok('z e privo di look-ahead (invariante ai dati futuri)', sameHead);

console.log('\n== SEGNALI ==');

const trigImm = X.triggerSeries(seq, { kind: 'immediate' }, 1);
ok('segnale immediato sempre vero', trigImm.every(Boolean));
const trigDip = X.triggerSeries(seq, { kind: 'dip', dip: 0.20 }, 1);
ok('segnale ribasso scatta solo sotto -20%', trigDip.join(',') === 'false,false,true,false,false,true,false,false', trigDip.join(','));
// ppy=12, months=3 -> finestra di 3 periodi
const trigBrk = X.triggerSeries([1, 2, 3, 2, 1, 4], { kind: 'breakout', months: 3 }, 12);
ok('segnale rottura scatta sui nuovi massimi', trigBrk[2] === true && trigBrk[4] === false && trigBrk[5] === true, trigBrk.join(','));

console.log('\n== SIMULAZIONE INGRESSI ==');

// Lump sum immediato su curva che raddoppia: multiplo = 2.
const dbl = [100, 120, 150, 200];
const sIm = X.simulateEntry(dbl, 0, { schedule: 'lump', strat: { kind: 'immediate' }, ppy: 1 });
ok('lump immediato: multiplo = 2', approx(sIm.multiple, 2, 1e-9), sIm.multiple);
ok('lump immediato: sempre investito', approx(sIm.timeInMarket, 1, 1e-9), sIm.timeInMarket);

// Segnale che non scatta mai: il capitale resta cassa e cresce al risk-free.
const noFire = X.simulateEntry(dbl, 0.10, { schedule: 'lump', strat: { kind: 'dip', dip: 0.90 }, ppy: 1 });
ok('segnale mai scattato: marcato everFired=false', noFire.everFired === false);
ok('cassa remunerata al risk-free', approx(noFire.multiple, Math.pow(1.10, 3), 1e-9), noFire.multiple);
ok('quota investita = 0', approx(noFire.timeInMarket, 0, 1e-9), noFire.timeInMarket);

// La cassa NON e ferma a zero: alzare rf migliora chi aspetta (equivalenza di capitale).
const dipLow = X.simulateEntry(seq, 0.00, { schedule: 'lump', strat: { kind: 'dip', dip: 0.20 }, ppy: 1 });
const dipHigh = X.simulateEntry(seq, 0.20, { schedule: 'lump', strat: { kind: 'dip', dip: 0.20 }, ppy: 1 });
ok('rf piu alto premia chi resta liquido', dipHigh.multiple > dipLow.multiple,
  dipLow.multiple.toFixed(4) + ' -> ' + dipHigh.multiple.toFixed(4));

// PAC: il totale versato e normalizzato a 1 in ogni caso.
const pac = X.simulateEntry(up, 0.02, { schedule: 'quarterly', strat: { kind: 'immediate' }, ppy });
ok('PAC: totale versato = 1', approx(pac.contributed, 1, 1e-9), pac.contributed);
ok('PAC su curva crescente: multiplo > 1', pac.multiple > 1, pac.multiple);
// timeInMarket misura il RISTAGNO DI CASSA (quota del capitale disponibile che e
// investita), non l'esposizione differita del PAC: un PAC che investe subito non
// ha cassa ferma, quindi vale 1. Lo svantaggio del PAC si vede nel multiplo.
ok('PAC immediato: nessuna cassa ferma', approx(pac.timeInMarket, 1, 1e-9), pac.timeInMarket);
const pacDip = X.simulateEntry(up, 0.02, { schedule: 'quarterly', strat: { kind: 'dip', dip: 0.10 }, ppy });
ok('PAC in attesa di un ribasso: cassa ferma', pacDip.timeInMarket < 0.5, pacDip.timeInMarket);

// Su una curva monotona crescente comprare subito deve battere aspettare un ribasso.
const upIm = X.simulateEntry(up, 0.02, { schedule: 'lump', strat: { kind: 'immediate' }, ppy });
const upDip = X.simulateEntry(up, 0.02, { schedule: 'lump', strat: { kind: 'dip', dip: 0.10 }, ppy });
ok('curva sempre in salita: subito batte il ribasso', upIm.multiple > upDip.multiple,
  upIm.multiple.toFixed(3) + ' vs ' + upDip.multiple.toFixed(3));

console.log('\n== CONFRONTO SU TUTTE LE PARTENZE ==');

const cmp = X.compareEntries(wave, 0.02, { ppy, schedule: 'lump', minYears: 1, startStep: 63 });
ok('confronto prodotto', !!cmp && cmp.starts > 3, cmp && cmp.starts);
const base = cmp.results.find((r) => r.id === 'immediate');
ok('il riferimento ha rapporto relativo 1', approx(base.medRel, 1, 1e-9), base.medRel);
ok('win rate del riferimento = 0', approx(base.winRate, 0, 1e-9), base.winRate);
ok('tutte le strategie valutate', cmp.results.length === 7, cmp.results.length);
ok('win rate sempre in [0,1]', cmp.results.every((r) => r.winRate >= 0 && r.winRate <= 1));
ok('quota investita sempre in [0,1]', cmp.results.every((r) => r.timeInMarket >= 0 && r.timeInMarket <= 1));

console.log('\n== FORWARD CONDIZIONATO ==');

// NB: il ciclo di `wave` dura ~1 anno, quindi su orizzonte 1 anno l'oscillazione
// si annulla e il punto d'ingresso non conta. Serve un ciclo piu lungo
// dell'orizzonte perche la mean-reversion sia osservabile.
const wave2 = expo.map((x, i) => x * (1 + 0.15 * Math.sin(i / 80)));  // ciclo ~2 anni
const ddSig = X.runningDrawdown(wave2);
const cf = X.conditionalForward(wave2, ddSig, X.DD_BUCKETS, 1, ppy);
ok('tabella condizionata prodotta', !!cf && !!cf.uncond, cf && cf.uncond);
ok('somma osservazioni bucket = incondizionato',
  cf.buckets.reduce((s, b) => s + b.n, 0) === cf.uncond.n,
  cf.buckets.reduce((s, b) => s + b.n, 0) + ' vs ' + cf.uncond.n);
// Su una serie che torna verso il trend, comprare nei ribassi deve rendere di piu.
const atHigh = cf.buckets[0].med;
const deep = cf.buckets.filter((b) => b.n > 20).slice(1).pop();
ok('mean-reversion: comprare in ribasso rende piu che ai massimi',
  deep ? deep.med > atHigh : false,
  deep ? `${deep.label}: ${deep.med.toFixed(4)} vs massimi ${atHigh.toFixed(4)}` : 'nessun bucket popolato');

console.log('\n== BOOTSTRAP ==');
const rand = E.rng(11);
const ci = X.bootstrapCI(Array.from({ length: 80 }, (_, i) => (i % 3 === 0 ? 1.2 : 0.9)),
  (a) => a.filter((x) => x > 1).length / a.length, 300, 8, rand);
ok('intervallo di confidenza prodotto e ordinato', ci && ci.lo <= ci.hi, ci && JSON.stringify(ci));
ok('CI contiene il valore vero (~0.33)', ci.lo <= 0.34 && ci.hi >= 0.33, JSON.stringify(ci));

console.log(`\nTOTALE: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
