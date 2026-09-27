/* ============================================================================
 * stamp.js — marca gli script e i fogli di stile con una versione di contenuto
 *
 *   node scripts/stamp.js           riscrive index.html e entry.html
 *   node scripts/stamp.js --check   esce con 1 se la marcatura e' vecchia
 *
 * Perche' serve. GitHub Pages serve con `Cache-Control: max-age=600`: per dieci
 * minuti dopo una pubblicazione il browser puo' usare il JavaScript vecchio
 * senza nemmeno chiedere al server. Se in quei dieci minuti l'HTML e' nuovo e
 * lo script no, l'app sembra rotta pur essendo corretta. Il service worker
 * network-first non basta: la sua richiesta di rete passa comunque dalla cache
 * HTTP del browser. Sono due livelli diversi.
 *
 * La versione e' l'impronta del CONTENUTO dei file marcati, non lo sha del
 * commit: cosi' cambia esattamente quando cambia qualcosa, e non c'e' la
 * circolarita' per cui lo sha dipenderebbe dal commit che lo contiene.
 *
 * L'HTML non entra nell'impronta, quindi riscriverlo non cambia il risultato:
 * lo script e' idempotente e puo' girare a ogni build.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PAGINE = ['index.html', 'entry.html'];

// src/href locali che puntano a uno script o a un foglio di stile
const RIF = /\b(src|href)="(?!https?:)([^"?]+\.(?:js|css))(\?v=[0-9a-f]+)?"/g;

/** I file marcati, raccolti dalle pagine: si marca cio' che si carica davvero. */
function fileMarcati() {
  const set = new Set();
  for (const p of PAGINE) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    let m;
    RIF.lastIndex = 0;
    while ((m = RIF.exec(html))) set.add(m[2]);
  }
  return [...set].sort();
}

/** Impronta stabile: sha1 di "percorso:sha1(contenuto)" per ogni file, in ordine. */
function impronta(file) {
  const h = crypto.createHash('sha1');
  for (const f of file) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) throw new Error('riferimento a un file inesistente: ' + f);
    h.update(f + ':' + crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex') + '\n');
  }
  return h.digest('hex').slice(0, 8);
}

function applica(v) {
  const cambiate = [];
  for (const p of PAGINE) {
    const abs = path.join(ROOT, p);
    const prima = fs.readFileSync(abs, 'utf8');
    const dopo = prima.replace(RIF, (_, attr, file) => `${attr}="${file}?v=${v}"`);
    if (dopo !== prima) { fs.writeFileSync(abs, dopo); cambiate.push(p); }
  }
  return cambiate;
}

/** Le versioni gia' presenti nelle pagine, per capire se la marcatura e' vecchia. */
function versioniPresenti() {
  const set = new Set();
  for (const p of PAGINE) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    let m;
    RIF.lastIndex = 0;
    while ((m = RIF.exec(html))) set.add(m[3] ? m[3].slice(3) : null);
  }
  return set;
}

const file = fileMarcati();
if (!file.length) { console.error('ERRORE: nessun file da marcare trovato nelle pagine'); process.exit(1); }
const v = impronta(file);

if (process.argv.includes('--check')) {
  const presenti = versioniPresenti();
  const ok = presenti.size === 1 && presenti.has(v);
  if (ok) { console.log(`marcatura aggiornata (${v}, ${file.length} file)`); process.exit(0); }
  console.error(`ERRORE: marcatura vecchia. Attesa ${v}, trovata ${[...presenti].join(', ') || 'nessuna'}.`);
  console.error('Esegui: node scripts/stamp.js');
  process.exit(1);
}

const cambiate = applica(v);
console.log(`versione ${v} su ${file.length} file` +
  (cambiate.length ? ` → aggiornate ${cambiate.join(', ')}` : ' → gia aggiornate'));
