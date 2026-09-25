/* ============================================================================
 * ecbfx.js — cambi di riferimento della BCE, serie storica completa.
 *
 * Sostituisce le coppie EUR/xxx di Yahoo, che partono da dicembre 2003 e
 * tagliavano fuori quasi cinque anni di storia: il filtro "mai un quinquennio
 * negativo" non poteva vedere la bolla dot-com, cioe' proprio il tipo di evento
 * che dovrebbe intercettare. La serie BCE parte dal 4 gennaio 1999.
 *
 * I tassi sono espressi in unita' di valuta per 1 euro, che e' gia' la
 * convenzione usata da toEur() nella pipeline.
 *
 * Fonte: European Central Bank, euro foreign exchange reference rates.
 * Riuso gratuito con citazione della fonte. Qui il file grezzo non viene
 * ridistribuito: si conservano solo le serie derivate (prezzi convertiti).
 *
 * Pubblicati solo nei giorni lavorativi TARGET e attorno alle 16:00 CET: la
 * data viene ancorata a mezzanotte UTC, cosi' il tasso di un giorno vale per le
 * quotazioni dello stesso giorno quando la pipeline le allinea in avanti.
 * ========================================================================== */
'use strict';
const Z = require('./zipxlsx');

const URL_HIST = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
const UA = { 'User-Agent': 'coma-screener/1.0 (+https://github.com/igorbonfanti/coma-screener)' };

let cache = null;   // una sola volta per esecuzione: il file pesa ~640 KB

/** Tutte le valute pubblicate dalla BCE: { CCY: {ts:[], rate:[]} }, cronologico. */
async function fetchAll() {
  if (cache) return cache;
  const r = await fetch(URL_HIST, { headers: UA });
  if (!r.ok) throw new Error('BCE: HTTP ' + r.status);
  const files = Z.unzip(Buffer.from(await r.arrayBuffer()));
  const nome = Object.keys(files).find((n) => n.toLowerCase().endsWith('.csv'));
  if (!nome) throw new Error('BCE: CSV non trovato nello zip');
  const righe = files[nome].toString('utf8').split(/\r?\n/);

  const intest = righe[0].split(',').map((s) => s.trim());
  if (intest[0].toLowerCase() !== 'date') throw new Error('BCE: intestazione inattesa: ' + righe[0].slice(0, 60));
  const valute = intest.slice(1).filter(Boolean);
  const out = {};
  valute.forEach((c) => (out[c] = { ts: [], rate: [] }));

  // il file e' ordinato dal piu' recente: si scorre all'indietro
  for (let i = righe.length - 1; i >= 1; i--) {
    const c = righe[i].split(',');
    const d = (c[0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const ts = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000;
    valute.forEach((ccy, k) => {
      const v = Number((c[k + 1] || '').trim());
      if (isFinite(v) && v > 0) { out[ccy].ts.push(ts); out[ccy].rate.push(v); }
    });
  }
  for (const c of valute) if (!out[c].ts.length) delete out[c];
  cache = out;
  return out;
}

/** Riepilogo utile nei log: quante valute e da quando. */
function riepilogo(fx) {
  const ccy = Object.keys(fx);
  const usd = fx.USD;
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  return `${ccy.length} valute` + (usd ? `, USD dal ${iso(usd.ts[0])} al ${iso(usd.ts[usd.ts.length - 1])}` : '');
}

module.exports = { fetchAll, riepilogo, URL_HIST };
