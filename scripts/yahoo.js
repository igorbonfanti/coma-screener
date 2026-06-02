/* ============================================================================
 * yahoo.js — download serie storiche adjusted close da Yahoo chart API.
 * Funziona lato Node (no CORS). Stesso approccio collaudato nel progetto RRG.
 * ========================================================================== */
'use strict';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json',
};

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scarica la serie adjusted-close (total return) per `symbol`.
 * @returns {Promise<{symbol, currency, ts:number[], px:number[]}|null>}
 */
async function fetchSeries(symbol, { interval = '1d', retries = 3 } = {}) {
  // period1=0 / period2=now forza lo storico GIORNALIERO completo.
  // (range=max degrada l'intervallo a dati radi e falsa CAGR/Min5Y.)
  const period2 = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < retries; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=0&period2=${period2}&interval=${interval}&events=div,splits&includeAdjustedClose=true`;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) { await sleep(800 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r || !r.timestamp) return null;
      const adj = r.indicators?.adjclose?.[0]?.adjclose;
      const close = r.indicators?.quote?.[0]?.close;
      const raw = adj || close;
      if (!raw) return null;
      const ts = [], px = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        const v = raw[i];
        if (v != null && isFinite(v) && v > 0) { ts.push(r.timestamp[i]); px.push(v); }
      }
      if (px.length < 2) return null;
      return { symbol, currency: r.meta?.currency || null, ts, px };
    } catch (e) {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

/** Scarica molte serie con concorrenza limitata e piccola pausa anti rate-limit. */
async function fetchMany(symbols, { concurrency = 6, pauseMs = 120, onProgress } = {}) {
  const out = {};
  let done = 0;
  const queue = symbols.slice();
  async function worker() {
    while (queue.length) {
      const sym = queue.shift();
      const s = await fetchSeries(sym);
      if (s) out[sym] = s;
      done++;
      if (onProgress && done % 25 === 0) onProgress(done, symbols.length);
      await sleep(pauseMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

module.exports = { fetchSeries, fetchMany };
