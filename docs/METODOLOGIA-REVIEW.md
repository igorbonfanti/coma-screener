# Coma Screener — revisione critica della metodologia

_Analisi condotta sul codice (`scripts/engine.js`, `scripts/fetch_data.js`, `js/live.js`) e sui
dati prodotti in `data/*.json` (run del 2026-08-03). Non è una raccomandazione d'investimento._

> **Stato: Sprint 1 completato il 2026-08-08** (v1.5.0). Vedi §7 per i risultati
> prima/dopo. I §2.1, §2.4, §2.6, §3.3, §3.4, §3.6 (NaN) e §5 punto 7 sono risolti;
> il resto della roadmap è invariato.

---

## 1. Verdetto sintetico

Ho fatto la cosa che il progetto non fa: la **regressione del portafoglio sul benchmark**, per
separare quanto del risultato è alfa e quanto è semplicemente beta.

| Universo | Periodo | Beta | Alfa annuo | t-stat |
|---|---|---|---|---|
| S&P 500 | in-sample (220 mesi) | 0.65 | **+9.5%** | 4.47 |
| S&P 500 | out-of-sample (83 mesi) | 0.75 | +0.9% | **0.28** |
| NYSE | in-sample | 0.76 | +9.8% | 4.81 |
| NYSE | out-of-sample | 0.77 | +2.2% | **0.90** |
| NASDAQ | in-sample | 0.51 | +11.5% | 4.59 |
| NASDAQ | out-of-sample | 0.38 | +4.2% | **0.91** |
| STOXX 600 | in-sample | 0.61 | +10.0% | 5.52 |
| STOXX 600 | out-of-sample | 0.75 | +3.5% | **0.99** |

Tre letture:

1. **In-sample l'alfa è enorme e "significativo" (t 4.5–5.5). Out-of-sample crolla e nessun
   t-stat supera 1.** Con t < 1 non si può rifiutare l'ipotesi "alfa = 0". Il gap IS→OOS è la
   firma tipica del data-mining, non di un edge.
2. **Il beta è strutturalmente 0.4–0.8.** Il portafoglio non è "migliore" del mercato: è *meno
   mercato*. Gran parte di ciò che l'app chiama edge è low-beta + settori difensivi.
3. **Quegli alfa OOS sono comunque sovrastimati**, perché il benchmark usato è sbagliato (§2.1).
   Corretti, diventano ≈ **−0.4% (S&P), +0.8% (NYSE), +1.3% (STOXX), +3.8% (NASDAQ)** — tutti
   con t < 1.

La conclusione professionale è netta: **oggi il modello non dimostra alcun edge fuori campione.
Descrive un portafoglio quality/low-vol difensivo, che è una scelta legittima ma va valutata
come tale (e confrontata con un ETF factor a 0.25% di TER), non come selezione titoli alfa-generante.**

---

## 2. Difetti che invalidano i numeri attuali (P0 — da correggere prima di qualsiasi altra cosa)

### 2.1 Il benchmark è un indice **price-only**: bias di +1.8/+3.0 punti l'anno a favore della strategia

Questo è il difetto più grave e il più facile da correggere.

I titoli sono scaricati con `includeAdjustedClose=true` → serie **total return** (dividendi
reinvestiti). I benchmark `^GSPC`, `^IXIC`, `^NYA`, `^STOXX` sono invece **indici di solo prezzo**:
Yahoo non applica alcun aggiustamento per dividendi. Stai confrontando mele con pere.

Verificato empiricamente (CAGR ultimi 7 anni, valuta locale):

| Benchmark in uso | CAGR 7Y | Versione total return | CAGR 7Y | Gap |
|---|---|---|---|---|
| `^GSPC` | 14.79% | `^SP500TR` | 16.56% | **−1.77 pp** |
| `^IXIC` | 18.55% | `^XCMP` | 19.47% | **−0.92 pp** |
| `^STOXX` | 8.29% | `EXSA.DE` (ETF, TR, EUR) | 11.23% | **−2.94 pp** |
| `^NYA` | 9.63% | nessun TR su Yahoo | — | ~−1.9 pp stimato |

Effetto: l'unico universo dove l'OOS sembrava battere il benchmark (STOXX: 10.4% vs 8.6%)
in realtà **perde** contro il total return (10.4% vs 11.2%). E il KPI "edge" mostrato a video
è sistematicamente gonfiato di 1–3 punti l'anno.

**Fix:** in `universe.json` e in `BENCHMARKS` di `fetch_data.js` sostituire con
`^SP500TR`, `^XCMP`, `EXSA.DE` (o `SPYY.DE`), e per il mondo `IWDA.AS`/`VWCE.DE` invece di `ACWI`.
Per NYSE non esiste un TR su Yahoo: o si usa un proxy investibile, o si dichiara esplicitamente
il gap. Meglio ancora: **benchmark = ETF realmente comprabile** (SXR8.DE, EXSA.DE, IWDA.AS),
così il confronto include TER e tracking difference ed è quello che conta davvero per l'investitore.

### 2.2 Survivorship bias — anche nell'out-of-sample

Il README lo dichiara per l'in-sample, ma il punto importante è un altro: **anche il backtest
OOS ne è affetto**. L'universo è la lista dei costituenti *odierni* dell'S&P 500. Nel 2019
(data di cutoff) quell'insieme non era conoscibile: mancano tutti i titoli usciti dall'indice
nel frattempo (delisting, M&A, distruzione di valore). Lo screen "nel passato" pesca quindi
in un bacino già ripulito dai perdenti.

Non è una sfumatura: il filtro `min5y ≥ −5%` scarta 387 titoli su ~470. Su un universo
point-in-time corretto scarterebbe anche molti che *oggi non ci sono più* — ma soprattutto
farebbe passare nomi che sono poi morti, che oggi il test non vede mai.

**Fix realistici, in ordine di costo:**
- Minimo: sostituire l'etichetta "out-of-sample" con "out-of-sample **con survivorship residuo**"
  e mettere una stima del bias (letteratura: 1–4 pp/anno su universi survivor-only).
- Corretto: liste di costituenti **point-in-time**. Per l'S&P 500 il repo
  `datasets/s-and-p-500-companies` ha lo storico via git history — si può ricostruire la
  membership per data leggendo le revisioni del CSV. È la singola modifica che sposta di più
  la credibilità del progetto.
- Alternativa pragmatica: cambiare universo in "tutti i titoli quotati con cap > X al tempo t",
  che è point-in-time per costruzione se si conservano i delisted (Yahoo però li rimuove: serve
  un'altra fonte).

### 2.3 Un solo fold OOS, nessuna inferenza statistica

`oosCutoffYears: 7` produce **un solo percorso**. Un singolo campione di 7 anni non distingue
skill da fortuna, e per di più quei 7 anni sono un regime specifico (Covid + inflazione + rialzo
tassi 2022 + AI rally), pessimo per un portafoglio pieno di utility.

**Fix:**
- **Walk-forward multi-fold**: cutoff a 5, 7, 9, 11, 13 anni (o rolling annuale con finestra
  espansiva), riportando la *distribuzione* dell'alfa, non un numero.
- Riportare sempre **t-stat / intervallo di confidenza dell'alfa**, non solo CAGR e "edge".
- **Test di significatività onesto**: block-bootstrap sui rendimenti del portafoglio per
  l'intervallo di confidenza, e — data la ricerca su griglia che gli slider incoraggiano —
  una correzione tipo **Deflated Sharpe Ratio** (Bailey–López de Prado) o almeno il numero di
  configurazioni provate. Con 6 slider stai facendo multiple testing di fatto.
- **Placebo test**: portafogli casuali di N titoli estratti dallo stesso universo survivor-only.
  Sospetto che buona parte dell'"edge" in-sample si riproduca anche a caso: è il test che
  smaschera il bias.

### 2.4 Il backtest della pipeline ribilancia **ogni giorno**

`backtestPortfolio(..., rebalance=true)` con prezzi giornalieri = pesi costanti riportati a
target **ogni singolo giorno di borsa**. Questo:
- è irrealizzabile;
- regala un *volatility-harvesting bonus* gratuito (rebalancing premium) che gonfia il CAGR;
- ha costi di transazione impliciti pari a zero.

Peggio: il browser (`live.js`) fa la stessa cosa su dati **mensili**, quindi i numeri IS mostrati
dall'app non coincidono con quelli della pipeline e non sono confrontabili tra loro.

**Fix:** parametro `rebalanceFreq` esplicito (annuale / semestrale / trimestrale / a soglia di
drift 20%) uguale in pipeline e browser, con **costi di transazione** applicati sul turnover.

### 2.5 Nessun costo, nessuna tassa — su un portafoglio ad alto dividendo e in valuta estera

Il backtest è lordo di tutto. Per un investitore **in EUR** che compra azioni USA singole, gli
attriti reali sono rilevanti e sistematicamente contro:

- **Ritenuta alla fonte sui dividendi USA**: 15% con W-8BEN, non recuperabile in Italia; poi
  26% italiano sul netto frontiera → carico effettivo ~37%. Il portafoglio canonico è pieno di
  utility e staples (DUK, SO, XEL, WEC, MCD, MO) con yield 3–4%: **~1.2–1.5 pp/anno di drag**
  che l'adjusted close di Yahoo non vede.
- **Spread + commissioni** su 14–20 posizioni, ribilanciate.
- **Conversione valutaria** EUR/USD in entrata e in uscita (0.15–0.5% per operazione sui broker retail).
- Un ETF UCITS accumulante subisce invece solo il 15% alla fonte a livello di fondo e **nessuna
  tassazione fino alla vendita** — cioè il benchmark corretto ha un vantaggio fiscale strutturale
  sul tuo portafoglio di singoli titoli. Il confronto lordo lo nasconde.

**Fix:** modellare esplicitamente `withholdingTax`, `tradingCost`, `fxCost` e confrontare
**netto contro netto** (portafoglio di singoli titoli tassato vs ETF accumulante). È la
differenza tra un backtest e una decisione d'investimento.

### 2.6 La data d'inizio del backtest è endogena ai filtri

`alignPicks` prende l'**intersezione** delle date dei titoli selezionati → il backtest parte
dall'IPO del titolo più giovane. Per l'S&P 500 canonico parte dal **2008-03-19**: è l'IPO di
Visa a decidere il periodo di test per tutti gli altri 13 titoli.

Conseguenze: (a) muovere uno slider cambia il *periodo* oltre che il paniere, quindi i confronti
tra configurazioni non sono validi; (b) partire da marzo 2008 significa entrare a ridosso del
minimo GFC, il che aiuta molto il CAGR.

**Fix:** finestra di backtest **fissa e dichiarata** (es. sempre gli ultimi 15 anni), con
titoli che entrano quando disponibili e peso ridistribuito (o esclusi a priori se non coprono
la finestra). Mai un periodo che dipende dalla selezione.

### 2.7 Contaminazione dell'universo: fondi chiusi, micro-cap, nessun filtro di liquidità

Le liste `nasdaq_tickers.txt` / `nyse_tickers.txt` sono elenchi grezzi di **tutti i simboli
quotati**. Il risultato si vede nei picks NYSE in-sample:

- **STK** = Columbia Seligman Premium Technology Growth Fund → **closed-end fund**, non un'azienda
- **BME** = BlackRock Health Sciences Trust → **closed-end fund**
- **RGCO, MGEE, FFIN, MLAB** (picks OOS NASDAQ) → micro/small cap, alcune sotto i 500 M$

I CEF hanno curve artificialmente lisce (NAV gestito, leva, distribuzioni) e **vincono per
costruzione** su un criterio di "regolarità del prezzo". È esattamente il tipo di artefatto che
un filtro puramente tecnico non può distinguere.

**Fix:** filtro sul tipo di strumento (`quoteType === 'EQUITY'` dal meta di Yahoo, che hai già
disponibile e stai buttando via), esclusione di ADR/preferred/units/SPAC, e soglie minime di
**market cap** (es. > 2 mld) e **ADV** (es. > 5 M$/giorno). Senza questo il progetto non è
investibile su NYSE/NASDAQ.

---

## 3. Difetti metodologici di secondo ordine (P1)

### 3.1 Il "Coma Quality Score" è un solo fattore travestito da tre

Correlazione tra i percentili delle tre componenti sull'S&P 500 (n = 467):

```
corr(R², Min5Y)     0.83
corr(R², MAR)       0.77
corr(Min5Y, MAR)    0.77
corr(MAR, CAGR)     0.87
corr(Quality, CAGR)         0.69
corr(Quality, −Volatilità)  0.47
```

Mediare tre rank correlati 0.8 non è diversificazione del segnale: è **pesare tre volte lo
stesso fattore**, cioè "il prezzo è salito in modo regolare in passato". Il punteggio finale è
per il 69% un ranking di performance passata e per il resto un ranking di bassa volatilità.

Inoltre tutte e tre le metriche sono **funzioni dello stesso identico percorso di prezzo
realizzato**, con zero contenuto informativo indipendente. Non esiste letteratura che documenti
persistenza della "linearità log" del prezzo; esiste invece ampia evidenza di persistenza di
ROIC, margini e crescita — cioè le *cause*, non l'effetto.

**Fix:** o si dichiara onestamente che è un fattore singolo (low-vol/quality tecnico), o si
costruisce uno score **multi-fattore con componenti a bassa correlazione**: qualità fondamentale,
valutazione, momentum, e stabilità. Vedi §4.

### 3.2 R² come misura di "regolarità" è fragile

`logLinearityR2` è l'R² della regressione di log(prezzo) sul tempo. Problemi:
- **Dipende dal trend**: un titolo volatilissimo ma con crescita fortissima ottiene R² alto
  (il denominatore `syy` esplode). Lo hai capito — hai scritto `logResidStd` (`reg`) proprio per
  questo — ma **il filtro e lo score usano ancora R², non `reg`**. `reg` è calcolato, mostrato
  in tabella e poi mai usato per decidere.
- **Dipende dalla lunghezza della serie**: R² su 15 anni e su 25 anni non sono confrontabili,
  eppure lo screen li mette nello stesso ranking.
- Nella pipeline è calcolato su dati **giornalieri** (ppy=252), nel browser su dati **mensili**
  (ppy=12). Lo stesso slider "R² ≥ 0.90" seleziona insiemi diversi nella vista IS e nella
  vista OOS. Incoerenza da eliminare.

**Fix:** usare `reg` (deviazione std dei residui, scala-invariante e indipendente dal trend)
come criterio primario di regolarità, normalizzata per orizzonte; e uniformare la frequenza
(tutto mensile è sufficiente e più veloce, o tutto giornaliero).

### 3.3 Bug: `downsideVol` divide per il numero di rendimenti **negativi**

```js
const r = periodReturns(prices).filter((x) => x < 0);
const v = sum(r.map((x) => x * x)) / r.length;   // ← r.length = solo i negativi
```

La downside deviation standard divide per il **numero totale** di osservazioni, non per quelle
sotto target. Così com'è, la downside vol è sovrastimata di ~√2 e **il Sortino è sottostimato
di ~30%** — e in modo non uniforme fra titoli (dipende dalla frazione di giorni negativi).
Il Sortino è mostrato in tabella ed è ordinabile: chi ordina per Sortino sta ordinando per una
quantità distorta.

**Fix:** `/ periodReturns(prices).length`.

### 3.4 Sharpe e MAR mescolano rendimento geometrico e volatilità aritmetica

`sharpe = (CAGR − rf) / vol` con `vol` = deviazione standard annualizzata dei rendimenti
aritmetici. Lo Sharpe corretto usa la **media aritmetica** degli excess return. Con vol 19% la
differenza geometrica/aritmetica è ~1.8 pp/anno: lo Sharpe risulta sottostimato, e la
sottostima è **maggiore per i titoli volatili** — cioè introduce un tilt low-vol addizionale e
non intenzionale nel ranking.

Inoltre `rf = 0.03` **costante** su un campione 2003–2026 che contiene sia lo ZIRP (rf reale
~0%) sia il 2023–24 (rf ~5%). Uno Sharpe calcolato con rf fisso non è confrontabile fra
sotto-periodi. Per un investitore in EUR il risk-free rilevante è per di più l'€STR/BOT, non il
3% generico.

**Fix:** Sharpe su media aritmetica degli excess return, e serie storica del risk-free
(€STR o Bund 3M) invece di una costante.

### 3.5 Il max-Sharpe resampled ottimizza sull'input peggiore possibile

`resampledWeights` fa block-bootstrap e media i pesi ottimi — corretto in spirito (Michaud) e
ben implementato. Ma **il resampling non risolve il problema vero**: l'errore di stima dei
**rendimenti attesi**. Il consenso accademico (Best–Grauer, Chopra–Ziemba, DeMiguel et al.) è
che l'errore su μ costa un ordine di grandezza più dell'errore su Σ, e che l'ottimizzatore
media-varianza fatica a battere l'1/N fuori campione.

I tuoi stessi dati lo confermano: OOS, `resampled` fa 12.5% e `equal` 11.9% sull'S&P — differenza
dentro il rumore — mentre su NASDAQ `resampled` fa **peggio** (9.1% vs 11.0%).

**Fix:** togliere μ dall'ottimizzazione. Alternative in ordine di robustezza documentata:
- **Minimum variance** o **risk parity vero** (equal risk contribution, non inverse-vol), che
  non richiedono μ;
- **Ledoit–Wolf shrinkage** sulla matrice di covarianza (oggi usi la covarianza campionaria
  grezza: con 20 titoli e finestra 5 anni è accettabile, ma lo shrinkage è quasi gratis);
- se si vuole μ, **Black–Litterman** con prior di equilibrio, o shrinkage di James–Stein di μ
  verso la media cross-sectional.
- Mantenere **1/N come default** e presentare gli altri schemi come alternative, non il contrario.

### 3.6 Dettagli implementativi da sistemare

| Punto | Problema | Fix |
|---|---|---|
| `screen()` | `NaN < soglia` è `false` → una riga con metrica NaN **passa** il filtro | filtro esplicito `isFinite()` |
| `addQualityScore` sull'unione | i percentili si ricalcolano sull'universo selezionato: **lo stesso titolo ha Quality diversa** a seconda degli universi spuntati | dichiararlo nel tooltip, o normalizzare su un universo di riferimento fisso |
| `cagr()` | `years = p.length / ppy` invece di `(p.length − 1) / ppy` | irrilevante su 15 anni, ma correggere |
| `alignPicks` | intersezione stretta: un giorno mancante su un titolo cancella quel giorno per tutti | forward-fill invece di drop |
| `toEur` | il tasso FX viene forward-fillato senza limite; se una serie FX ha un buco lungo, converte a un cambio stantio | limite di staleness (es. 5 giorni) |
| `topN: 20` ma passano 14 | la dimensione del portafoglio dipende dai filtri, non è controllata | separare "quanti passano" da "quanti ne prendo", con minimo di diversificazione |

---

## 4. Cosa manca perché sia una metodologia da gestore (e non un filtro di prezzo)

Questa è la parte più importante. Tutto quanto sopra sono correzioni; qui c'è il salto di livello.

### 4.1 Zero fondamentali — si sta selezionando l'effetto, non la causa

Il concetto di "compounder" è **fondamentale**: un'azienda che reinveste capitale a rendimenti
superiori al costo del capitale, per molti anni. La curva di prezzo liscia è la *conseguenza*
di quella caratteristica, non la caratteristica. Selezionare sull'effetto significa selezionare
su una variabile che (a) è già nel prezzo, (b) non ha persistenza documentata, (c) è massima
proprio quando il titolo è più caro.

Cosa dovrebbe entrare, con dati disponibili da Yahoo `quoteSummary` o FMP/Finnhub gratuiti:

**Qualità del business**
- **ROIC** e **spread ROIC − WACC** medio a 10 anni, e la sua *stabilità* (dev. std)
- **Reinvestment rate** × ROIC = crescita organica sostenibile
- **FCF conversion** (FCF / utile netto) — smaschera utili di carta
- Stabilità del **margine lordo** (proxy di pricing power / moat)
- **Interest coverage**, **Net debt / EBITDA** — evita che il "coma" sia solo leva finanziaria
- **Variazione del numero di azioni** — diluizione cronica o buyback
- **Accruals** (Sloan) — segnale negativo robusto e documentato

**Valutazione — oggi completamente assente, ed è il buco più pericoloso**
- FCF yield, EV/EBIT, P/E **relativo alla propria storia a 10 anni** (z-score)
- Crescita implicita nel prezzo (reverse DCF semplificato)

Perché è pericoloso: un filtro che premia la regolarità della salita **compra sistematicamente
ai massimi di valutazione**. È letteralmente il meccanismo con cui i "quality compounder" hanno
fatto −30/−50% nel 2022. Nei tuoi stessi picks OOS S&P 500 c'è **NKE**, selezionato nel 2019
per curva perfetta, poi dimezzato. Senza un vincolo di prezzo, "compra e dimentica" diventa
"compra caro e dimentica".

Un gestore non compra un compounder: compra **un compounder a un prezzo che incorpora meno
crescita di quella che l'azienda può produrre**. Aggiungere anche solo un filtro
"escludi il quintile più caro per FCF yield relativo alla propria storia" cambierebbe
materialmente il profilo.

### 4.2 Nessun risk model

Il portafoglio S&P 500 canonico è: V, CASY, AME, MCD, LIN, ROL, WEC, AON, CHD, COST, DUK, SO,
XEL, ECL → **4 utility regolate su 14 (29%)**, più staples. È una scommessa concentrata sui
tassi d'interesse mascherata da diversificazione. Nel 2022 quel cluster è stato colpito
esattamente insieme.

Manca:
- **Cap settoriale** (es. max 20–25% per GICS sector) e **cap paese/valuta**
- Misura di concentrazione reale: il tuo `resampled` ha **N effettivo 12.2** su 14 titoli — ok,
  ma non è monitorato né vincolato
- **Esposizione fattoriale**: regressione su mercato/size/value/momentum/quality/low-vol.
  Con beta 0.4–0.8 e tilt difensivo, quasi tutto il risultato è replicabile con 2 ETF factor.
  Va misurato e mostrato, altrimenti si vende come alfa ciò che è beta a buon mercato.
- **Clustering per correlazione**: 14 titoli con correlazione media alta ≠ 14 scommesse
- **Stress test per regime**: 2008, 2020, 2022 (rialzo tassi), 2000–02. Il periodo di test
  dovrebbe *sempre* includere un regime di tassi in salita, per un portafoglio così bond-like.

### 4.3 Nessuna disciplina di uscita né monitoraggio

"Comprale e dimenticale" è una tesi, non un processo. Anche l'investitore più paziente deve
sapere **quando la tesi è rotta**. Servono trigger espliciti e verificabili:
- ROIC sotto WACC per N trimestri consecutivi
- Leva oltre soglia / covenant breach
- Perdita del pricing power (margine lordo in calo strutturale)
- Il titolo esce dallo screen per M mesi consecutivi
- Valutazione oltre il 95° percentile storico → trim, non necessariamente vendita

E, sul lato test: confrontare la variante "picks congelati per 7 anni" (che è quella attuale)
con "riselezione annuale". Sono due strategie diverse e vanno misurate entrambe.

### 4.4 Nessun confronto con l'alternativa vera

La domanda decisiva per chi userà questo strumento non è "battiamo l'S&P price index?", ma:
**"battiamo, al netto di tasse e costi, un ETF che costa 0.07% e si compra in 30 secondi?"**

Confronti che dovrebbero essere in prima pagina:
- vs **SXR8.DE / IWDA.AS / VWCE.DE** (netto, accumulante, EUR)
- vs un **ETF quality/min-vol** (es. IS3Q.DE World Quality, MVOL) — perché quello è il vero
  "comparabile fattoriale" del portafoglio
- vs **1/N sull'universo** e vs **portafogli casuali** (placebo)

Se la strategia non batte questi tre, il valore del progetto non è nella selezione — è nel fatto
che è uno strumento di analisi trasparente e riproducibile. Che è comunque un valore, ma va detto.

---

## 5. Roadmap prioritizzata

### ~~Sprint 1 — rendere i numeri non-fuorvianti~~ ✅ fatto (v1.5.0)
1. ~~Benchmark **total return**~~ → `^SP500TR`, `^XCMP`, `VTI`, `EXSA.DE`, `ACWI` — §2.1
2. ~~Fix `downsideVol`~~ — §3.3
3. ~~Sharpe su media aritmetica; rf da serie storica~~ → €STR via `XEON.DE` — §3.4
4. ~~Filtro `isFinite()` nello screen~~ — §3.6
5. ~~Rebalancing **annuale** con costi (15 bps), uguale in pipeline e browser~~ — §2.4
6. ~~Finestra di backtest **fissa**~~ → ultimi `minYears` anni — §2.6
7. ~~**Beta, alfa e t-stat** nei KPI dell'app~~, con verdetto esplicito sotto |t| = 2

### Sprint 2 — validazione onesta (1–2 giorni)
8. **Walk-forward multi-fold** (cutoff 5/7/9/11/13 anni) con distribuzione dell'alfa
9. **Placebo test** con portafogli casuali dallo stesso universo
10. Filtro **tipo strumento + market cap + liquidità** (via `quoteType` già disponibile) — §2.7
11. Costi, ritenuta sui dividendi e conversione FX nel backtest — §2.5
12. Confronto esplicito **netto vs ETF UCITS accumulante** — §4.4

### Sprint 3 — universo corretto (2–3 giorni)
13. Costituenti **point-in-time** dell'S&P 500 ricostruiti dalla git history del repo dataset — §2.2
14. Uniformare la frequenza dei dati fra pipeline e browser — §3.2

### Sprint 4 — da screener tecnico a metodologia d'investimento (il vero salto)
15. Sostituire R² con `reg` come criterio di regolarità — §3.2
16. Aggiungere il blocco **fondamentali** (ROIC, spread ROIC−WACC, FCF conversion, leva,
    diluizione, stabilità margini) — §4.1
17. Aggiungere il blocco **valutazione** (FCF yield, z-score P/E vs storia) come *vincolo*,
    non solo come colonna informativa — §4.1
18. Score multi-fattore con componenti **decorrelate**, pesi dichiarati, e contributo di ogni
    fattore visibile per titolo
19. **Cap settoriali** e attribuzione fattoriale del portafoglio — §4.2
20. Passare a **min-variance / ERC con shrinkage Ledoit–Wolf**, 1/N come default — §3.5
21. Regole di **uscita** esplicite e backtest della variante con riselezione annuale — §4.3

---

## 6. Risultati dopo lo Sprint 1

Pipeline rigirata su tutti e quattro gli universi (2026-08-08) con benchmark total return,
ribilanciamento annuale a 15 bps, finestra fissa di 15 anni, Sharpe aritmetico e risk-free €STR.

**Alfa out-of-sample, prima e dopo:**

| Universo | Alfa OOS prima | t | Alfa OOS dopo | t | Beta |
|---|---|---|---|---|---|
| S&P 500 | +0.9% | 0.28 | **−1.7%** | −0.44 | 0.76 |
| NYSE | +2.2% | 0.90 | **−2.2%** | −0.58 | 0.69 |
| NASDAQ | +4.2% | 0.91 | **−1.7%** | −0.32 | 0.58 |
| STOXX 600 | +3.5% | 0.99 | **+1.5%** | 0.38 | 0.74 |

**Alfa in-sample, prima e dopo:**

| Universo | Alfa IS prima | t | Alfa IS dopo | t |
|---|---|---|---|---|
| S&P 500 | +9.5% | 4.47 | +4.6% | 1.94 |
| NYSE | +9.8% | 4.81 | +4.0% | 1.82 |
| NASDAQ | +11.5% | 4.59 | +6.6% | 2.00 |
| STOXX 600 | +10.0% | 5.52 | +4.6% | 1.70 |

**CAGR e benchmark (out-of-sample, 2019-08 → 2026-08, equipeso, EUR):**

| Universo | Portafoglio | Benchmark TR | Differenza |
|---|---|---|---|
| S&P 500 | 10.8% | 16.6% | −5.8 pp |
| NYSE | 8.7% | 15.9% | −7.2 pp |
| NASDAQ | 9.4% | 19.6% | −10.2 pp |
| STOXX 600 | 10.2% | 11.6% | −1.4 pp |

Cosa è cambiato e perché:

- **L'alfa in-sample si è dimezzato** (da ~+10% a ~+5%, t da ~4.7 a ~1.9). Due cause: il
  benchmark ora incassa i dividendi, e la finestra fissa a 15 anni ha tolto l'ingresso
  fortunato di marzo 2008 (minimo della crisi) che il vecchio allineamento sceglieva da solo.
  Anche in-sample — cioè col massimo del look-ahead possibile — l'alfa ora è **al limite
  della significatività**.
- **L'alfa out-of-sample è diventato negativo in 3 universi su 4.** Nessun t-stat arriva
  neanche a 1 in valore assoluto: statisticamente non c'è edge, in nessuna direzione.
  Il risultato più onesto è "il modello non aggiunge nulla rispetto a comprare l'indice".
- **Il turnover del ribilanciamento annuale è ~9%/anno**, quindi i costi (0.15% sullo
  scambiato) pesano solo ~1.4 bps/anno: la correzione dell'alfa viene quasi tutta dal
  benchmark e dalla finestra, non dai costi. È un'informazione utile — il portafoglio è
  davvero a bassa manutenzione, come promette la tesi "coma".
- **Il beta resta 0.58–0.76 ovunque.** Il portafoglio continua a essere un'esposizione
  difensiva al mercato. Chi vuole quel profilo lo può ottenere con un ETF min-vol o
  semplicemente con 70% indice + 30% liquidità, senza rischio idiosincratico su 14 titoli.

**Limite scoperto durante il lavoro:** le serie convertite in EUR partono tutte da
**dicembre 2003**, perché è lì che inizia il cambio `EURUSD=X` su Yahoo (nessuna alternativa
più lunga disponibile da questa fonte). Due conseguenze non banali:

1. La storia massima utilizzabile è **22.6 anni**, non 30 — lo slider è stato limitato a 22.
2. Il filtro "mai un quinquennio negativo" **non vede la bolla dot-com 2000-02**, cioè proprio
   il tipo di evento che dovrebbe intercettare. Il filtro è quindi molto meno selettivo di
   quanto sembri: il solo stress test rilevante nel campione è il 2008.

---

## 7. Nota finale

Il codice è pulito, il motore isomorfo è un'ottima scelta architetturale, e il fatto che tu
abbia già costruito un OOS e scritto i caveat nel README ti mette avanti al 90% dei progetti
di questo tipo. Il problema non è l'implementazione: è che **la metodologia sta selezionando
sul risultato passato invece che sulle sue cause, e la validazione ha ancora abbastanza bias
residuo da non poter dire nulla di conclusivo.**

La cosa più utile che i numeri attuali dicono è questa: quando togli il look-ahead, l'alfa
sparisce. È un risultato prezioso — significa che il framework di validazione **funziona**.
Ora va usato per testare ipotesi migliori.

Dopo lo Sprint 1 questa conclusione è ancora più netta: con un benchmark corretto e
un'esecuzione realizzabile, l'alfa out-of-sample è **negativo in tre universi su quattro** e
mai statisticamente distinguibile da zero. Lo strumento oggi vale come **infrastruttura di
validazione onesta**, non come generatore di idee. Il prossimo passo che può cambiare il
risultato non è un'altra soglia di prezzo: è mettere dentro **fondamentali e valutazione**
(§4.1) e un universo **point-in-time** (§2.2).
