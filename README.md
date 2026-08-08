# Coma Screener — Aziende da Coma · v1.5.0

Screener azionario per individuare **compounder di lungo periodo** ("aziende da coma": comprale e dimenticale) secondo la metodologia di Massimo Rea, con backtest **out-of-sample** onesto.

🔗 **App live:** https://igorbonfanti.github.io/coma-screener/

**Universi selezionabili e combinabili:** S&P 500 · NYSE · NASDAQ · STOXX Europe 600 (+ preset "Tutti USA" e "USA + Europa"). Selezionando più universi l'app ne fa l'**unione**, ricalcola il Quality Score sul set combinato e produce screening + portafoglio + backtest IS/OOS live.

**Benchmark total return, congruente alla selezione:** S&P 500→`^SP500TR` · NASDAQ→`^XCMP` · NYSE→`VTI` · STOXX→`EXSA.DE` · combo USA→`^SP500TR` · USA+Europa→`ACWI`. Sono tutti **total return** perché le serie dei titoli usano l'adjusted close: confrontarle con un indice price-only (`^GSPC`, `^IXIC`, `^STOXX`) regala **1–3 punti percentuali l'anno** alla strategia. Mostrato sempre a video. Passando il mouse su opzioni e intestazioni compaiono spiegazioni.

## Due pagine

1. **Screener** (`index.html`) — *quali* titoli. Filtri, portafoglio, pesi, backtest IS/OOS con alfa, beta e t-stat.
2. **Come entrare** (`entry.html`) — *quando* comprarli. Anatomia dei drawdown, rendimento forward condizionato allo stato d'acquisto, e confronto fra strategie d'ingresso (subito · ribasso −10/−20/−30% · sotto il trend · rottura dei massimi) a parità di versamenti, con la liquidità in attesa remunerata al risk-free.

Risultato in sintesi: **il ribasso è un buon momento per comprare, ma aspettarlo costa più di quanto renda** — e vale ancora di più sui compounder che sul mercato in generale. Dettagli e numeri: [`docs/METODOLOGIA-REVIEW.md`](docs/METODOLOGIA-REVIEW.md) §7.

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
| Esecuzione | Ribilanciamento **annuale** con **0.15%** di costi sul controvalore scambiato, oppure buy&hold |
| Validazione | Backtest **out-of-sample** (selezione nel passato, test in avanti) su finestra **fissa**, con **alfa, beta e t-stat** rispetto al benchmark total return |

Sharpe e Sortino usano la media **aritmetica** degli excess return (non il CAGR) e un
risk-free **variabile nel tempo** (€STR capitalizzato via `XEON.DE`, costante 3% prima del 2008).

## ⚠️ Caveat

- I risultati **in-sample** sono ottimistici per costruzione (survivorship + look-ahead): lo screening parte dai titoli oggi nell'indice con lunga storia.
- Il **survivorship bias resta anche nell'out-of-sample**: l'elenco dei costituenti odierni non era conoscibile alla data di cutoff.
- L'OOS è un **singolo fold** di 7 anni: non basta per distinguere skill da fortuna. Guardare il **t-stat dell'alfa**: sotto 2 non si può dire che ci sia un edge.
- Il backtest è **lordo di tasse** (ritenuta sui dividendi, capital gain) e di costi di conversione valutaria.
- Nessun dato **fondamentale** né di **valutazione** entra nella selezione: il modello sceglie sulla regolarità del prezzo passato, che è la conseguenza di un buon business, non la causa.

Non è una raccomandazione d'investimento. Analisi critica completa della metodologia e
roadmap dei miglioramenti: [`docs/METODOLOGIA-REVIEW.md`](docs/METODOLOGIA-REVIEW.md).

## Sviluppo

```bash
node scripts/_test_engine.js --net   # test motore (+ validazione Yahoo)
node scripts/_test_entry.js          # test drawdown e strategie d'ingresso
node scripts/_test_ui.js --show      # smoke test screener (jsdom)
node scripts/_test_entry_ui.js       # smoke test pagina "Come entrare"
node scripts/fetch_data.js SP500     # rigenera un universo
node scripts/_serve.js               # preview locale su :8099
```
