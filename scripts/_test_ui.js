/* Smoke test UI con jsdom: esegue app.js sui dati reali, stub Chart+fetch.
 * Verifica che KPI, tabella portafoglio e screening si popolino senza errori. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

// stub Chart.js
function Chart() { this.update = () => {}; }
Chart.defaults = { color: '', font: {} };
window.Chart = Chart;

// stub Firebase (Firestore in-memory)
const fbDocs = [];
const db = {
  collection: () => ({
    add: (d) => { fbDocs.push(d); return Promise.resolve({ id: 'x' + fbDocs.length }); },
    orderBy() { return this; }, limit() { return this; },
    get: () => Promise.resolve({ docs: fbDocs.map((d, i) => ({ id: 'x' + i, data: () => d })) }),
    doc: () => ({ delete: () => Promise.resolve() }),
  }),
};
function firestore() { return db; }
firestore.FieldValue = { serverTimestamp: () => ({ __ts: true }) };
window.firebase = { apps: [], initializeApp() { window.firebase.apps.push({}); }, firestore };

// stub SheetJS
let xlsxFile = null;
window.XLSX = { utils: { book_new: () => ({ SheetNames: [], Sheets: {} }),
  json_to_sheet: (a) => ({ __rows: a }), book_append_sheet: (wb, ws, n) => wb.SheetNames.push(n) },
  writeFile: (wb, fn) => { xlsxFile = { fn, sheets: wb.SheetNames }; } };
window.alert = () => {}; window.confirm = () => true;

// stub fetch -> file system locale
window.fetch = (url) => {
  const p = url.replace(/^\.?\//, '');
  try { return Promise.resolve({ json: () => Promise.resolve(JSON.parse(read(p))), text: () => Promise.resolve(read(p)) }); }
  catch (e) { return Promise.reject(new Error('404 ' + p)); }
};

// carica gli script nell'ordine dell'index
for (const f of ['scripts/engine.js', 'js/charts.js', 'js/live.js', 'js/store.js', 'js/export.js', 'js/app.js']) {
  const code = read(f);
  try { window.eval(code); } catch (e) { errors.push(f + ': ' + e.message); }
}

// avvia
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const $ = (s) => window.document.querySelector(s);
const fail = [];
const ck = (cond, name) => { if (!cond) fail.push(name); };

setTimeout(() => {
  // stato iniziale (load + recompute live sincrono)
  ck($('#kpis').children.length >= 2, 'KPI popolati');
  ck($('#kpis').textContent.includes('%'), 'KPI con percentuali');
  ck($('#kpis').textContent.includes('In-sample'), 'KPI in-sample (live)');
  ck($('#kpis').textContent.includes('Out-of-sample'), 'KPI out-of-sample');
  ck($('#port-tbl').querySelectorAll('tr').length > 5, 'tabella portafoglio righe (live)');
  ck($('#port-tbl').textContent.includes('MCD'), 'portafoglio contiene un pick noto (MCD)');
  ck($('#screen-ctrls').querySelectorAll('input[type=range]').length === 6, '6 slider screening');
  ck($('#screen-tbl').querySelectorAll('tr').length > 5, 'tabella screening righe');
  ck($('#updated').textContent.includes('agg.'), 'data aggiornamento');

  const nPortBefore = $('#port-tbl').querySelectorAll('tr').length;

  // M3: card costruisci/salva + basket
  ck(!!$('#build-card'), 'card costruisci/salva presente');
  ck($('#basket-metrics').children.length >= 1, 'metriche basket (canonico)');
  ck($('#snapshots').textContent.includes('Nessuno') || $('#snapshots').querySelector('.snap'), 'lista snapshot');

  // aggiungi 2 titoli al basket cliccando le stelle
  const stars = $('#screen-tbl').querySelectorAll('[data-star]');
  stars[0].click(); stars[1].click();
  ck($('#basket-chips').querySelectorAll('.chip').length >= 2, 'basket: 2 chip');
  ck($('#basket-metrics').textContent.includes('Custom'), 'basket: modalità Custom');

  // export Excel
  $('#btn-export').click();
  ck(xlsxFile && xlsxFile.fn.includes('coma_'), 'export Excel chiamato');
  ck(xlsxFile && xlsxFile.sheets.includes('Portafoglio') && xlsxFile.sheets.includes('Screening'), 'export: fogli presenti');

  // salva snapshot (async)
  $('#snap-note').value = 'test';
  $('#btn-save').click();

  // muovi slider
  const r2 = $('#rng-minR2'); r2.value = 0.95; r2.dispatchEvent(new window.Event('input'));

  setTimeout(() => {
    ck(fbDocs.length >= 1, 'snapshot salvato su Firebase (stub)');
    ck(fbDocs[0] && fbDocs[0].picks && fbDocs[0].picks.length >= 2, 'snapshot ha i picks');
    ck($('#save-status').textContent.includes('salvato'), 'status salvataggio');
    ck($('#snapshots').querySelector('.snap'), 'snapshot in lista dopo save');

    console.log('Errori runtime:', errors.length ? errors : 'nessuno');
    console.log(fail.length ? 'FAIL: ' + fail.join(', ')
      : 'TUTTI I CHECK UI PASSATI (port ' + (nPortBefore - 1) + ', basket+export+save ok, ' + fbDocs.length + ' snapshot)');
    process.exit(fail.length || errors.length ? 1 : 0);
  }, 450);
}, 600);
