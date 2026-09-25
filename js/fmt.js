/* ============================================================================
 * fmt.js — numeri e date all'italiana, secondo le regole del design system.
 *
 *  - virgola decimale;
 *  - segno meno tipografico U+2212 (non il trattino della tastiera);
 *  - "+" esplicito sulle variazioni;
 *  - un valore che arrotondato vale zero non ha segno ne colore (niente "−0,0");
 *  - il colore non e mai l'unico indizio: ogni variazione porta anche freccia e segno;
 *  - date gg/mm/aaaa.
 * ========================================================================== */
(function () {
  'use strict';
  var MINUS = '\u2212';          // −
  var UP = '\u25B2', DOWN = '\u25BC';  // ▲ ▼
  var DASH = '\u2013';           // – (dato assente)

  var ok = function (x) { return x != null && isFinite(x); };
  var dec = function (v, d) { return v.toFixed(d).replace('.', ','); };

  /** Numero semplice: "12,5", "−3,8". Nessun segno positivo. */
  function num(x, d) {
    d = d == null ? 2 : d;
    if (!ok(x)) return DASH;
    var r = +(+x).toFixed(d);
    return (r < 0 ? MINUS : '') + dec(Math.abs(r), d);
  }

  /** Percentuale come livello (non come variazione): "44,9%". */
  function pct(x, d) {
    d = d == null ? 1 : d;
    return ok(x) ? num(x * 100, d) + '%' : DASH;
  }

  /**
   * Variazione con segno esplicito: "+4,6%", "−1,7%".
   * Se arrotondata vale zero il segno sparisce: "0,0%".
   */
  function signed(x, d, suffix) {
    d = d == null ? 1 : d;
    suffix = suffix || '';
    if (!ok(x)) return DASH;
    var r = +(+x).toFixed(d);
    if (r === 0) return dec(0, d) + suffix;
    return (r > 0 ? '+' : MINUS) + dec(Math.abs(r), d) + suffix;
  }

  /** Variazione percentuale con segno: prende una frazione (0,046 -> "+4,6%"). */
  function signedPct(x, d) { return ok(x) ? signed(x * 100, d == null ? 1 : d, '%') : DASH; }

  /**
   * Variazione pronta da stampare: freccia + segno + colore.
   * Zero resta neutro (niente freccia, niente colore), come chiede il sistema.
   */
  function delta(x, d, opt) {
    d = d == null ? 1 : d;
    opt = opt || {};
    if (!ok(x)) return '<span class="num muted">' + DASH + '</span>';
    var v = +(x * 100).toFixed(d);
    var txt = signed(v, d, '%');
    if (v === 0) return '<span class="num">' + txt + '</span>';
    var arrow = v > 0 ? UP : DOWN;
    return '<span class="num ' + (v > 0 ? 'up' : 'down') + '">' + arrow + ' ' + txt + '</span>';
  }

  /** Come delta ma per un numero puro (es. un rapporto), non una percentuale. */
  function deltaNum(x, d) {
    d = d == null ? 2 : d;
    if (!ok(x)) return '<span class="num muted">' + DASH + '</span>';
    var v = +(+x).toFixed(d);
    var txt = signed(v, d, '');
    if (v === 0) return '<span class="num">' + txt + '</span>';
    return '<span class="num ' + (v > 0 ? 'up' : 'down') + '">' + (v > 0 ? UP : DOWN) + ' ' + txt + '</span>';
  }

  /** Data gg/mm/aaaa da ISO (o da Date). */
  function date(v) {
    if (!v) return DASH;
    var dt = v instanceof Date ? v : new Date(v);
    if (isNaN(dt)) return String(v);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear();
  }

  /** "2026-08" -> "08/2026" (le curve mensili). */
  function month(ym) {
    if (!ym || String(ym).length < 7) return DASH;
    var s = String(ym);
    return s.slice(5, 7) + '/' + s.slice(0, 4);
  }

  /**
   * Anni con unita. Il singolare vale solo quando il numero e scritto intero
   * ("1 anno"): con il decimale in vista l'italiano vuole il plurale ("1,0 anni").
   */
  function years(x, d) {
    if (!ok(x)) return DASH;
    d = d == null ? 1 : d;
    var singolare = d === 0 && Math.abs(+(+x).toFixed(0)) === 1;
    return num(x, d) + (singolare ? ' anno' : ' anni');
  }

  window.ComaFmt = { MINUS: MINUS, UP: UP, DOWN: DOWN, DASH: DASH,
    num: num, pct: pct, signed: signed, signedPct: signedPct,
    delta: delta, deltaNum: deltaNum, date: date, month: month, years: years };
})();
