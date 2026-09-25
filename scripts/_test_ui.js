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
for (const f of ['scripts/engine.js', 'js/fmt.js', 'js/ui.js', 'js/charts.js', 'js/live.js', 'js/store.js', 'js/export.js', 'js/app.js']) {
  const code = read(f);
  try { window.eval(code); } catch (e) { errors.push(f + ': ' + e.message); }
}

// avvia
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const $ = (s) => window.document.querySelector(s);
const fail = [];
const ck = (cond, name) => { if (!cond) fail.push(name); };

setTimeout(() => {
  // stato iniziale (SP500, IS+OOS live)
  ck($('#kpis').children.length >= 2, 'KPI out-of-sample popolati');
  ck($('#kpis-is').children.length >= 2, 'KPI in-sample popolati (blocco separato)');
  ck($('#kpis').textContent.includes('Alfa OOS'), 'KPI alfa out-of-sample');
  ck($('#kpis-is').textContent.includes('Alfa IS'), 'KPI alfa in-sample');
  ck(/β\s*-?[\d.]+/.test($('#kpis').textContent), 'KPI mostra il beta');
  ck(/t\s*\u2212?[\d,]+/.test($('#kpis').textContent), 'KPI mostra il t-stat');
  // il verdetto è la sintesi in cima: deve dire se l'edge è dimostrabile o no
  ck($('#verdict').querySelector('.verdict'), 'verdetto renderizzato');
  ck(/vantaggio|sottoperformance|significativ/i.test($('#verdict').textContent), 'verdetto esprime un giudizio');
  ck($('#verdict').textContent.includes('t '), 'verdetto cita il t-stat');
  ck(/\d{2}\/\d{4}\u2013\d{2}\/\d{4}/.test($('#port-n').textContent),
    'portafoglio mostra la finestra fissa: ' + $('#port-n').textContent);
  // struttura tabelle: thead/tbody per l'intestazione sticky
  ck($('#port-tbl').querySelector('thead') && $('#port-tbl').querySelector('tbody'), 'portafoglio ha thead+tbody');
  ck($('#screen-tbl').querySelector('thead'), 'screening ha thead');
  ck($('#screen-summary').querySelector('.funnel'), 'imbuto dei filtri renderizzato');
  ck($('#screen-tbl').querySelector('th[aria-sort]'), 'colonna ordinata marcata con aria-sort');
  // sparkline e istogrammi: le due idee che mostrano invece di far dedurre
  ck($('#screen-tbl').querySelectorAll('tbody .spark path').length > 3, 'sparkline nella tabella screening');
  ck($('#port-tbl').querySelectorAll('tbody .spark path').length > 3, 'sparkline nel portafoglio');
  ck($('#screen-ctrls').querySelectorAll('svg.hist').length >= 5, 'istogramma dietro gli slider');
  ck($('#hist-minR2').querySelectorAll('.bar.in').length > 0 &&
     $('#hist-minR2').querySelectorAll('.bar:not(.in)').length > 0,
    'istogramma distingue i bin che passano la soglia');
  ck([...$('#seg-scheme').querySelectorAll('button')].every((b) => b.hasAttribute('aria-pressed')),
    'segmented control con aria-pressed');
  // i limiti del risultato sono un pannello fisso nella colonna laterale
  ck($('#caveat').querySelectorAll('.acard').length >= 4, 'pannello "Da tenere presente" popolato');
  ck($('#caveat').textContent.includes('survivorship') || $('#caveat').textContent.includes('SURVIVORSHIP'),
    'i limiti citano il survivorship');

  // `--show` stampa i KPI live: utile per confrontarli con quelli della pipeline
  if (process.argv.includes('--show')) {
    console.log('\n-- KPI live (SP500, mensile) --');
    [...$('#kpis').children].forEach((c) => console.log('  • ' + c.textContent.replace(/\s+/g, ' ').trim()));
    console.log('  portafoglio: ' + $('#port-n').textContent);
    console.log('  ' + $('#bench-name').textContent + '\n');
  }
  ck($('#port-tbl').querySelectorAll('tr').length > 3, 'tabella portafoglio righe (live)');
  ck($('#port-tbl').textContent.includes('MCD'), 'portafoglio contiene un pick noto (MCD)');
  ck($('#universe-select').querySelectorAll('[data-u]').length === 4, '4 toggle universi');
  ck($('#universe-select').querySelectorAll('[data-preset]').length === 2, '2 preset');
  ck($('#screen-ctrls').querySelectorAll('input[type=range]').length === 6, '6 slider screening');
  ck(/^\d{2}\/\d{2}\/\d{4}$/.test($('#updated').textContent),
    'data dei dati gg/mm/aaaa: ' + $('#updated').textContent);
  ck(['ok', 'late', 'stale'].some((c) => $('#fresh').classList.contains(c)),
    'badge di freschezza: ' + $('#fresh').className);
  ck($('#bench-name').textContent.includes('S&P 500'), 'benchmark mostrato (S&P 500 per SP500)');
  ck([...$('#port-tbl').querySelectorAll('th')].some((th) => th.title && th.title.length > 10), 'tooltip su intestazioni portafoglio');
  ck([...$('#universe-select').querySelectorAll('[data-u]')].every((el) => el.title), 'tooltip su toggle universi');
  // un solo tema scuro; il pulsante CVD cambia soltanto "su" e "giu"
  const term = $('#term');
  ck(!!$('#cvd-toggle'), 'pulsante CVD presente');
  ck(!term.classList.contains('cvd'), 'di partenza tema Terminale');
  $('#cvd-toggle').click();
  ck(term.classList.contains('cvd') && $('#cvd-toggle').getAttribute('aria-pressed') === 'true',
    'CVD attiva il tema per daltonici');
  $('#cvd-toggle').click();
  ck(!term.classList.contains('cvd'), 'CVD si disattiva');
  // la guida e un dialogo modale
  ck(!!$('#help-dlg'), 'guida presente');
  ck($('#help-dlg').querySelector('.ph h2'), 'la guida ha un titolo di pannello');
  // numeri all'italiana: virgola decimale e meno tipografico, mai il trattino
  const numeri = $('#kpis').textContent + $('#port-tbl').textContent;
  ck(/\d,\d/.test(numeri), 'numeri con la virgola decimale');
  ck(!/[^\s]-\d/.test($('#port-tbl').textContent.replace(/\u2212/g, '')),
    'nessun meno da tastiera nei numeri');

  const countSP = state_count();
  function state_count() { return +($('#screen-summary').textContent.match(/Analizzati (\d+)/) || [])[1] || 0; }

  // aggiungi NASDAQ -> merge multi-universo
  $('#universe-select').querySelector('[data-u="NASDAQ"]').click();

  setTimeout(() => {
    const countMerged = state_count();
    ck(countMerged > countSP, `merge universi: analizzati ${countSP} -> ${countMerged}`);
    ck($('#universe-select').querySelectorAll('[data-u][aria-pressed="true"]').length === 2, '2 universi attivi');
    ck($('#bench-name').textContent.includes('proxy USA'), 'benchmark combo USA = S&P 500 proxy');
    ck($('#kpis').children.length >= 2 && $('#verdict').querySelector('.verdict'), 'OOS live anche su combo');
    ck($('#port-tbl').querySelectorAll('tr').length > 3, 'portafoglio su combo');

    // reset filtri: modifica una soglia e ripristina
    const rr = $('#rng-minR2'); rr.value = 0.99; rr.dispatchEvent(new window.Event('input'));
    $('#btn-reset').click();
    ck($('#rng-minR2').value === '0.9', 'reset filtri riporta R² al default (' + $('#rng-minR2').value + ')');
    ck($('#rng-maxDD').value === '-0.45', 'reset filtri riporta MaxDD al default');

    // basket custom
    const stars = $('#screen-tbl').querySelectorAll('[data-star]');
    stars[0].click(); stars[1].click();
    ck($('#basket-chips').querySelectorAll('.chip').length >= 2, 'basket: 2 chip');
    ck($('#basket-metrics').textContent.includes('personale'), 'basket: modalità personale');

    // export + save
    $('#btn-export').click();
    ck(xlsxFile && xlsxFile.fn.includes('coma_'), 'export Excel chiamato');
    ck(xlsxFile && xlsxFile.sheets.includes('Portafoglio'), 'export: fogli presenti');
    $('#snap-note').value = 'test'; $('#btn-save').click();

    setTimeout(() => {
      ck(fbDocs.length >= 1, 'snapshot salvato (stub)');
      ck(fbDocs[0] && fbDocs[0].universes && fbDocs[0].universes.length === 2, 'snapshot ha universi multipli');
      ck(fbDocs[0] && fbDocs[0].picks.length >= 2, 'snapshot ha i picks');
      ck($('#snapshots').querySelector('.snap'), 'snapshot in lista');

      console.log('Errori runtime:', errors.length ? errors : 'nessuno');
      console.log(fail.length ? 'FAIL: ' + fail.join(', ')
        : `TUTTI I CHECK UI PASSATI (SP500 ${countSP} -> merge ${countMerged} titoli, IS+OOS live, basket+export+save ok)`);
      process.exit(fail.length || errors.length ? 1 : 0);
    }, 500);
  }, 600);
}, 700);
