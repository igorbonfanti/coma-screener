/* ============================================================================
 * factors.js — scarica i fattori per l'attribuzione e scrive data/factors.json
 *
 *   node scripts/factors.js
 *
 * Perche' serve. Il portafoglio ha beta 0,57-0,75 ed e' concentrato in utility e
 * staples. Il low-beta e' un fattore REMUNERATO (Frazzini & Pedersen, JFE 2014),
 * quindi non e' bravura: *Buffett's Alpha* (Frazzini, Kabiller & Pedersen, FAJ
 * 2018) mostra che l'alfa di Berkshire diventa non significativo controllando
 * per BAB e QMJ. Senza questi due regressori misureremmo alfa che non c'e'.
 *
 * Fonti, entrambe gratuite:
 *  - Kenneth French Data Library: FF5 + momentum, regione North America.
 *  - AQR Datasets: BAB e QMJ, colonna USA.
 *
 * ATTENZIONE ALLA VALUTA. I fattori sono in DOLLARI. I rendimenti di
 * portafoglio del progetto sono in euro e vanno riconvertiti prima della
 * regressione, altrimenti l'attribuzione e' sporca di cambio.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const Z = require('./zipxlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UA = { 'User-Agent': 'coma-screener/1.0 (+https://github.com/igorbonfanti/coma-screener)' };
const FRENCH = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/';
const AQR = 'https://www.aqr.com/-/media/AQR/Documents/Insights/Data-Sets/';

const log = (...a) => console.log(...a);

async function scarica(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * CSV di French: righe di preambolo, poi l'intestazione (che comincia con una
 * virgola perche' la prima colonna non ha nome), poi i mensili YYYYMM, poi in
 * coda gli annuali YYYY che vanno ignorati. I valori sono in PERCENTO.
 */
function parseFrench(testo, attesi) {
  const righe = testo.split(/\r?\n/);
  const hdr = righe.findIndex((l) => /^\s*,/.test(l));
  if (hdr < 0) throw new Error('French: intestazione non trovata');
  const nomi = righe[hdr].split(',').slice(1).map((s) => s.trim());
  for (const a of attesi) {
    if (nomi.indexOf(a) < 0) throw new Error('French: colonna attesa mancante: ' + a + ' (ho ' + nomi.join(',') + ')');
  }
  const out = {};
  for (let i = hdr + 1; i < righe.length; i++) {
    const c = righe[i].split(',');
    const mese = (c[0] || '').trim();
    if (!/^\d{6}$/.test(mese)) continue;          // salta gli annuali in coda
    const v = {};
    let valido = true;
    nomi.forEach((n, k) => {
      const x = Number((c[k + 1] || '').trim());
      if (!isFinite(x) || x <= -99.98) valido = false;   // -99.99 = dato mancante
      v[n] = x / 100;
    });
    if (valido) out[mese] = v;
  }
  return out;
}

/** "12/31/1930" -> "193012". Gestisce anche il seriale Excel, per sicurezza. */
function meseDaCella(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Z.serialeAMese(v);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim());
  if (m) return m[3] + String(m[1]).padStart(2, '0');
  const iso = /^(\d{4})-(\d{2})/.exec(String(v).trim());
  return iso ? iso[1] + iso[2] : null;
}

/**
 * Foglio AQR: preambolo, riga DATE con i codici paese, poi i mensili.
 * Estrae una sola colonna (per noi USA), gia' in forma decimale.
 */
function parseAqr(righe, colonna) {
  const hdr = righe.findIndex((r) => r && String(r[0]).trim().toUpperCase() === 'DATE');
  if (hdr < 0) throw new Error('AQR: riga DATE non trovata');
  const idx = righe[hdr].findIndex((c) => c && String(c).trim().toUpperCase() === colonna);
  if (idx < 0) throw new Error('AQR: colonna ' + colonna + ' non trovata (ho ' +
    righe[hdr].filter(Boolean).slice(0, 30).join(',') + ')');
  const out = {};
  for (let i = hdr + 1; i < righe.length; i++) {
    const r = righe[i];
    if (!r || r[0] == null) continue;
    const mese = meseDaCella(r[0]);
    const val = r[idx];
    if (mese && typeof val === 'number' && isFinite(val)) out[mese] = val;
  }
  return out;
}

async function run() {
  log('Fattori Fama-French (North America)...');
  const ff5 = parseFrench(Z.unzipFirstText(await scarica(FRENCH + 'North_America_5_Factors_CSV.zip')),
    ['Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA', 'RF']);
  const mom = parseFrench(Z.unzipFirstText(await scarica(FRENCH + 'North_America_Mom_Factor_CSV.zip')),
    ['WML']);
  log(`  FF5: ${Object.keys(ff5).length} mesi · MOM: ${Object.keys(mom).length} mesi`);

  log('Fattori AQR (colonna USA)...');
  const bab = parseAqr(Z.xlsxFirstSheet(await scarica(AQR + 'Betting-Against-Beta-Equity-Factors-Monthly.xlsx')), 'USA');
  const qmj = parseAqr(Z.xlsxFirstSheet(await scarica(AQR + 'Quality-Minus-Junk-Factors-Monthly.xlsx')), 'USA');
  log(`  BAB: ${Object.keys(bab).length} mesi · QMJ: ${Object.keys(qmj).length} mesi`);

  // unione sui mesi in cui c'e' almeno FF5; BAB e QMJ possono mancare in coda
  const mesi = Object.keys(ff5).sort();
  const serie = {};
  const campi = ['mktrf', 'smb', 'hml', 'rmw', 'cma', 'wml', 'bab', 'qmj', 'rf'];
  campi.forEach((c) => (serie[c] = []));
  const usati = [];
  for (const m of mesi) {
    if (!mom[m]) continue;                      // il momentum parte qualche mese dopo
    usati.push(m);
    const f = ff5[m];
    const r6 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(6));
    serie.mktrf.push(r6(f['Mkt-RF'])); serie.smb.push(r6(f.SMB)); serie.hml.push(r6(f.HML));
    serie.rmw.push(r6(f.RMW)); serie.cma.push(r6(f.CMA)); serie.rf.push(r6(f.RF));
    serie.wml.push(r6(mom[m].WML));
    serie.bab.push(r6(bab[m])); serie.qmj.push(r6(qmj[m]));
  }
  const copertura = (c) => serie[c].filter((x) => x != null).length;
  const out = {
    updated: new Date().toISOString(),
    valuta: 'USD',
    regione: 'North America (French) · USA (AQR)',
    nota: 'Rendimenti mensili in forma decimale. I fattori sono in dollari: converti i ' +
      'rendimenti di portafoglio in USD prima della regressione.',
    fonti: {
      french: 'Kenneth R. French Data Library, Tuck School of Business at Dartmouth',
      aqr: 'AQR Capital Management, Datasets (Betting Against Beta; Quality Minus Junk)',
    },
    months: usati, series: serie,
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'factors.json'), JSON.stringify(out));
  log(`Scritto factors.json: ${usati.length} mesi, da ${usati[0]} a ${usati[usati.length - 1]}`);
  log('  copertura: ' + campi.map((c) => c + ' ' + copertura(c)).join(' · '));
}

run().catch((e) => { console.error(e.message); process.exit(1); });
