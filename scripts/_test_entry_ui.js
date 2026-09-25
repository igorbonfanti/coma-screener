/* Smoke test della pagina "Come entrare" con jsdom, sui dati reali.
 *   node scripts/_test_entry_ui.js [--show]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const dom = new JSDOM(read('entry.html'), { runScripts: 'outside-only', pretendToBeVisual: true,
  url: 'http://localhost/entry.html?u=SP500' });
const { window } = dom;
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

window.fetch = (url) => {
  const p = String(url).replace(/^\.?\//, '');
  try { return Promise.resolve({ json: () => Promise.resolve(JSON.parse(read(p))) }); }
  catch (e) { return Promise.reject(new Error('404 ' + p)); }
};

for (const f of ['scripts/engine.js', 'scripts/entry.js', 'js/fmt.js', 'js/ui.js', 'js/entry-app.js']) {
  try { window.eval(read(f)); } catch (e) { errors.push(f + ': ' + e.message); }
}
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const $ = (s) => window.document.querySelector(s);
const fail = [];
const ck = (cond, name) => { if (!cond) fail.push(name); };
const rows = (sel) => $(sel).querySelectorAll('tbody tr').length;

setTimeout(() => {
  // verdetto
  ck(!!$('#verdict .verdict'), 'verdetto renderizzato');
  ck(/subito|aspettare/i.test($('#verdict').textContent), 'verdetto esprime un giudizio');
  ck(!!$('#verdict').querySelector('.st'), 'il verdetto usa un badge di stato');
  ck($('#verdict').textContent.includes('%'), 'verdetto cita i numeri');

  // KPI ribassi, sempre con il confronto sull'universo
  ck($('#kpis-dd').children.length === 4, 'quattro KPI sui ribassi');
  ck(($('#kpis-dd').textContent.match(/universo/g) || []).length >= 3,
    'ogni KPI mostra il controllo sull\'universo');

  // confronto strategie
  ck(rows('#cmp-tbl') >= 5, 'tabella strategie popolata: ' + rows('#cmp-tbl'));
  ck($('#cmp-tbl').textContent.includes('riferimento'), 'riga di riferimento marcata');
  ck($('#cmp-n').textContent.includes('date di partenza'), 'conteggio partenze mostrato: ' + $('#cmp-n').textContent);
  ck($('#cmp-tbl').querySelectorAll('.bullet').length >= 3, 'barre bullet con la soglia del 50%');
  ck($('#cmp-tbl').querySelector('.bullet .tick'), 'la soglia e marcata dentro la barra');
  const cmpTxt = $('#cmp-tbl').textContent;
  ck(cmpTxt.includes('Ribasso −20%') && cmpTxt.includes('Rottura massimi'), 'strategie attese presenti');

  // forward condizionato + toggle
  ck(rows('#cond-tbl') >= 5, 'tabella condizionata popolata');
  ck($('#cond-tbl').textContent.includes('Indifferente'), 'riga incondizionata presente');
  const ddTxt = $('#cond-tbl').textContent;
  $('#seg-cond').querySelector('[data-v="z"]').click();
  ck($('#cond-tbl').textContent !== ddTxt, 'il segnale "distanza dal trend" cambia la tabella');
  ck($('#cond-tbl').textContent.includes('trend'), 'bucket per z-score mostrati');
  $('#seg-horizon').querySelector('[data-v="1"]').click();
  ck($('#cond-n').textContent.includes('1 anno'), 'orizzonte 1 anno al singolare: ' + $('#cond-n').textContent);
  ck(/\d,\d/.test($('#cond-tbl').textContent), 'numeri con la virgola decimale');

  // titolo per titolo
  ck(rows('#single-tbl') >= 5, 'tabella per titolo popolata');

  // schema versamenti
  const lumpTxt = $('#cmp-tbl').textContent;
  $('#seg-sched').querySelector('[data-v="pac"]').click();
  ck($('#cmp-tbl').textContent !== lumpTxt, 'il PAC produce numeri diversi dal capitale unico');
  ck($('#cmp-n').textContent.includes('PAC'), 'intestazione aggiornata al PAC');
  ck([...$('#seg-sched').querySelectorAll('button')].every((b) => b.hasAttribute('aria-pressed')),
    'segmented control con aria-pressed');

  // sorgente del portafoglio
  const oosTxt = $('#single-tbl').textContent;
  $('#seg-source').querySelector('[data-v="canonical"]').click();
  ck($('#single-tbl').textContent !== oosTxt, 'la selezione in-sample cambia i titoli analizzati');

  if (process.argv.includes('--show')) {
    $('#seg-source').querySelector('[data-v="oos"]').click();
    $('#seg-sched').querySelector('[data-v="lump"]').click();
    console.log('\n-- ' + $('#verdict .vt').textContent + ' --');
    console.log($('#verdict .vd').textContent.replace(/\s+/g, ' ').trim() + '\n');
    console.log($('#cmp-tbl').innerText ? '' : '');
  }

  console.log('Errori runtime:', errors.length ? errors.join(' | ') : 'nessuno');
  if (fail.length || errors.length) {
    console.log('FAIL: ' + fail.join(', '));
    process.exit(1);
  }
  console.log(`TUTTI I CHECK PAGINA INGRESSI PASSATI (${rows('#single-tbl')} titoli analizzati)`);
}, 2500);
