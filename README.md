# Coma Screener — Aziende da Coma · v1.1.0

Screener azionario per individuare **compounder di lungo periodo** ("aziende da coma": comprale e dimenticale) secondo la metodologia di Massimo Rea, con backtest **out-of-sample** onesto.

🔗 **App live:** https://igorbonfanti.github.io/coma-screener/

**Universi:** S&P 500 · STOXX Europe 600 · USA (NASDAQ + NYSE, ~3500 titoli).

## Come funziona

Un solo **motore isomorfo** (`scripts/engine.js`, JS puro senza dipendenze) gira sia nella GitHub Action (calcolo pesante) sia nel browser (re-filtri e pesatura live).

- **Pipeline** (`scripts/fetch_data.js`, Node): scarica lo storico giornaliero da Yahoo (total return, convertito in **EUR**), calcola le metriche, esegue screening + pesi + backtest in-sample e **out-of-sample**, scrive `data/*.json`. La [GitHub Action](.github/workflows/update-data.yml) la rilancia ogni settimana.
- **App** (`index.html` + `js/`): explorer con soglie interattive che **ricalcolano live** portafoglio, pesi (3 schemi) e backtest; salvataggio snapshot su Firebase ed export Excel. PWA.

## Metodologia

| Fase | Criterio |
|------|----------|
| Filtri | ≥15 anni storia · nessun quinquennio rolling < −5% · R² log-prezzo ≥0.90 · CAGR ≥10% · MaxDD ≥ −45% |
| Selezione | **Coma Quality Score** = media dei percentili di R² (regolarità) + Min5Y + MAR |
| Pesi | Equipeso · Risk-parity (inverse-vol) · Resampled max-Sharpe (block bootstrap) — selezionabili |
| Validazione | Backtest **out-of-sample** (selezione nel passato, test in avanti) + buy&hold vs ribilanciato |

## ⚠️ Caveat

I risultati **in-sample** sono ottimistici per costruzione (survivorship + look-ahead): lo screening parte dai titoli oggi nell'indice con lunga storia. Affidarsi al **backtest out-of-sample**. Non è una raccomandazione d'investimento.

## Sviluppo

```bash
node scripts/_test_engine.js --net   # test motore (+ validazione Yahoo)
node scripts/_test_ui.js             # smoke test UI (jsdom)
node scripts/fetch_data.js SP500     # rigenera un universo
node scripts/_serve.js               # preview locale su :8099
```
