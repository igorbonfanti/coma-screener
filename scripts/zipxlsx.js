/* ============================================================================
 * zipxlsx.js — lettore ZIP e XLSX minimale, senza dipendenze.
 *
 * Serve per i dati dei fattori: Kenneth French li pubblica come CSV dentro uno
 * ZIP, AQR come XLSX (che e' a sua volta uno ZIP di XML). Il progetto non ha
 * dipendenze e non e' il caso di aggiungerne per due parser di poche decine di
 * righe che girano una volta a settimana.
 *
 * Legge solo cio' che serve: deflate e stored, nessuna cifratura, nessun ZIP64.
 * ========================================================================== */
'use strict';
const zlib = require('zlib');

/** Voci di uno ZIP, lette dalla central directory. Ritorna { nome: Buffer }. */
function unzip(buf) {
  // End Of Central Directory: si cerca all'indietro, la coda puo' avere un commento
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: end of central directory non trovata');
  const nEntries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < nEntries; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: voce di directory non valida');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // l'intestazione locale ha lunghezze proprie di nome ed extra
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

/** Il primo file dello ZIP come testo (i CSV di French ne contengono uno solo). */
function unzipFirstText(buf, enc) {
  const files = unzip(buf);
  const nomi = Object.keys(files).filter((n) => !n.endsWith('/'));
  if (!nomi.length) throw new Error('ZIP vuoto');
  return files[nomi[0]].toString(enc || 'latin1');
}

// ---- XLSX ------------------------------------------------------------------

const ENTITA = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const deXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITA[m])
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));

/** Stringhe condivise: in xlsx il testo delle celle sta quasi sempre qui. */
function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const si = xml.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || [];
  for (const s of si) {
    // un <si> puo' contenere piu' <t> se il testo ha formattazione mista
    const parti = s.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(parti.map((t) => deXml(t.replace(/<[^>]+>/g, ''))).join(''));
  }
  return out;
}

const colToIndex = (ref) => {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * Un foglio come matrice di righe. I numeri restano numeri, il testo stringa.
 * Le celle vuote diventano null, cosi' gli indici di colonna restano allineati.
 */
function sheetRows(xml, strings) {
  const righe = [];
  const blocchi = xml.match(/<row[\s>][\s\S]*?<\/row>|<row[^>]*\/>/g) || [];
  for (const r of blocchi) {
    const celle = r.match(/<c[\s>][\s\S]*?<\/c>|<c[^>]*\/>/g) || [];
    const riga = [];
    for (const c of celle) {
      const ref = (/r="([A-Z]+\d+)"/.exec(c) || [])[1] || '';
      const tipo = (/t="([^"]+)"/.exec(c) || [])[1] || 'n';
      const idx = ref ? colToIndex(ref) : riga.length;
      let val = null;
      if (tipo === 'inlineStr') {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c);
        val = t ? deXml(t[1]) : null;
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c);
        if (v) {
          if (tipo === 's') val = strings[+v[1]];
          else if (tipo === 'str' || tipo === 'e') val = deXml(v[1]);
          else { const n = Number(v[1]); val = isFinite(n) ? n : null; }
        }
      }
      while (riga.length < idx) riga.push(null);
      riga[idx] = val;
    }
    righe.push(riga);
  }
  return righe;
}

/** Il primo foglio di un xlsx come matrice di righe. */
function xlsxFirstSheet(buf) {
  const f = unzip(buf);
  const nomi = Object.keys(f).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!nomi.length) throw new Error('XLSX: nessun foglio');
  const str = sharedStrings(f['xl/sharedStrings.xml'] ? f['xl/sharedStrings.xml'].toString('utf8') : null);
  return sheetRows(f[nomi[0]].toString('utf8'), str);
}

/**
 * Data seriale di Excel -> "YYYYMM". Epoca 1899-12-30 (il bug dell'anno 1900
 * e' gia' compensato da quella scelta di origine).
 */
function serialeAMese(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0');
}

module.exports = { unzip, unzipFirstText, xlsxFirstSheet, sharedStrings, sheetRows, serialeAMese };
