# Riprogettazione della metodologia — sintesi della ricerca

_25 settembre 2026. Sintesi di cinque filoni di ricerca (fondamentali, valutazione,
validazione, costruzione di portafoglio, fonti dati) applicata al Coma Screener.
Ogni affermazione porta la fonte; dove l'evidenza è debole o assente è detto._

---

## 0. Il punto di partenza

Lo screener seleziona usando **solo il prezzo**: R² della regressione di log(prezzo) sul
tempo, nessun quinquennio rolling negativo, drawdown contenuto, CAGR minimo. Out-of-sample
l'alfa è **negativo e non significativo** in tre universi su quattro, con beta 0,57–0,75 e
una forte concentrazione in utility e staples.

La ricerca conferma la diagnosi già scritta in [`METODOLOGIA-REVIEW.md`](METODOLOGIA-REVIEW.md)
§4 — si sta selezionando la *conseguenza* (curva liscia) invece della *causa* — ma corregge
diverse delle soluzioni che avevo proposto lì.

---

## 1. Correzioni a quanto avevo raccomandato io

Sei punti del §4.1 della review vanno rivisti. Li elenco perché è il tipo di errore che
altrimenti si propaga.

| Avevo scritto | La ricerca dice |
|---|---|
| ROIC e spread ROIC−WACC come metriche centrali | La **persistenza** del ROIC è documentata (Mauboussin: chi è nel quintile alto ha ~64% di probabilità di restare nei primi due dopo 10 anni), ma **non esiste evidenza accademica che un ROIC alto predica i rendimenti**: è già prezzato. Vale come filtro di qualità del business, non come segnale. Lo spread su WACC va abbandonato: la stima del WACC è troppo rumorosa e arbitraria. |
| P/E relativo alla propria storia a 10 anni (z-score sul titolo) | **Sbagliato per un compounder.** I multipli del singolo titolo non sono stazionari, e per un'azienda con ROIC in ascesa il multiplo "giusto" sale strutturalmente: lo z-score sulla propria storia produce falsi positivi sistematici in entrambe le direzioni. Solo diagnostica, mai esclusione. La valutazione va misurata **cross-sezionalmente, dentro il settore**. |
| Reverse DCF come criterio | Framework coerente (Rappaport–Mauboussin) ma **nessun test out-of-sample pubblicato** come segnale cross-sezionale. Al massimo un veto su casi estremi. |
| FCF conversion e stabilità del margine lordo | **Nessuna evidenza accademica dedicata**: compaiono solo come componenti interne di QMJ. Da dichiarare come ipotesi non validate, non come criteri duri. |
| Gross profitability (Novy-Marx) | Superata: Ball, Gerakos, Linnainmaa &amp; Nikolaev (JFE 2016) mostrano che la **cash-based operating profitability** la batte e assorbe l'anomalia degli accruals. |
| Accruals (Sloan) come segnale | Estinto: Green, Hand &amp; Soliman (Management Science 2011) documentano la scomparsa del rendimento hedge. Sussunto dalla cash-based profitability. |

Una cosa che invece la ricerca conferma: il resampling di Michaud **non** risolve l'errore di
stima sui rendimenti attesi, e il nostro max-Sharpe che non batte l'equipeso è il risultato
*atteso*, non un difetto (§4).

---

## 2. Il vincolo che decide tutto: i dati

Prima della metodologia viene ciò che è materialmente ottenibile da una GitHub Action, gratis,
con licenza che consenta di committare i derivati in un repo pubblico.

### Quello che si può fare

| Problema | Fonte | Stato |
|---|---|---|
| Cambi oltre il 2003 | **BCE `eurofxref-hist.zip`** | ✅ **Fatto** (`scripts/ecbfx.js`). 41 valute dal 4 gennaio 1999, nessuna chiave, un solo download da 640 KB. Yahoo resta come riserva per le valute che la BCE non pubblica. Il file grezzo non viene ridistribuito: si conservano solo le serie derivate, con la fonte citata. |
| Fondamentali USA point-in-time | **SEC EDGAR `companyfacts`** + Financial Statement Data Sets | Gratuito, nessuna chiave, 10 richieste/s con User-Agent identificativo. **Nativamente point-in-time**: ogni fatto porta la data di deposito `filed`, quindi filtrando `filed <= data` si ottiene ciò che era noto allora, restatement escluse. Dati pubblici, ridistribuibili. Bulk dal 2009 (prima non c'è XBRL). |
| Costituenti storici S&P 500 | **fja05680/sp500** (licenza MIT) | Dal 1996. **Ricostruito, non nativamente PIT**: il nucleo viene da un libro e gli aggiornamenti sono manuali. MIT consente la ridistribuzione. Da incrociare con la revision history di Wikipedia. |

### Quello che non si può fare a costo zero

- **Costituenti storici dello STOXX 600**: nessuna fonte libera. STOXX licenzia la composizione commercialmente.
- **Prezzi dei titoli delistati**, USA ed Europa. EDGAR conserva i *fondamentali* dei morti (il CIK non sparisce) ma non i prezzi. CRSP è lo standard accademico ed è istituzionale.
- **Fondamentali europei prima del 2020**: `filings.xbrl.org` è libero e PIT ma parte dall'obbligo ESEF, e mancano Germania e Irlanda.

Fonti a pagamento valutate e **scartate per licenza**, non per prezzo: SHARADAR ($19–29/mese)
vieta esplicitamente di ridistribuire i dati; Financial Modeling Prep richiede un accordo di
licenza separato per mostrare i dati a terzi; EODHD (€19,99–59,99/mese, con delisted inclusi)
consente la ridistribuzione solo sul piano Enterprise.

### La conseguenza, detta chiaramente

**Una validazione davvero priva di survivorship bias è raggiungibile per gli USA dal 2009, e
non è raggiungibile gratuitamente per l'Europa.** Qualunque piano deve scegliere: o il binario
rigoroso resta USA, o l'Europa continua con un bias dichiarato.

E l'ordine di grandezza in gioco giustifica la scelta: le stime raccolte danno al survivorship
**3–5 punti percentuali l'anno** (Dow 30: 11,7% contro 6,1% includendo i delisting). È più di
qualunque raffinamento statistico.

---

## 3. La selezione riprogettata

Non filtri in sequenza ma un **punteggio integrato**, perché AQR (Journal of Investing 2017)
misura che integrare batte mescolare sleeve separate di circa +1% di excess return e +40% di
information ratio, con beneficio crescente al crescere dei fattori.

```
punteggio = 2 × z(qualità) + 1 × z(valutazione)      calcolati DENTRO il settore GICS
```

**Blocco qualità** (pesi a priori, non ottimizzati):
- **Cash-based operating profitability / attivo** — la specifica con l'evidenza migliore (Ball et al. 2016).
- **Emissione netta di azioni** a 1 e 5 anni, come Δlog(azioni rettificate per split). È la metrica con l'evidenza più forte sui *rendimenti*: Pontiff &amp; Woodgate (JF 2008) la trovano più significativa di size, book-to-market e momentum presi singolarmente, e l'effetto si replica internazionalmente.
- **ROIC medio a 5–10 anni** contro la mediana di settore, come filtro di persistenza del business.
- **Stabilità della profittabilità** (deviazione standard del ROIC su 10 anni) — etichettata come ipotesi non validata.

**Blocco valutazione**:
- **EBIT/EV**, z-score dentro il settore. Gray &amp; Vogel (JPM 2012, ~40 anni) trovano che EBITDA/TEV batte P/E, FCF/TEV e book-to-market; e che i multipli mediati su più anni aggiungono poco rispetto a quelli a un anno.

**Esclusioni dure** (non punteggio, sì/no):
- **Distress**: net debt/EBITDA e interest coverage oltre soglia, alta volatilità del ROE. Campbell, Hilscher &amp; Szilagyi (JF 2008) documentano che questi profili hanno sia più fallimenti sia rendimenti anomalmente bassi.
- **Decile più caro per EBIT/EV** dentro l'universo già qualificato per qualità. Un decile, non un quintile: taglia la coda patologica senza distruggere l'esposizione alla qualità.
- **Presidio anti value-trap**: fuori chi ha ROIC e margine lordo in calo per 3 anni consecutivi. Fama &amp; French (2000) misurano che la profittabilità torna verso la media al **~40% l'anno**: un multiplo basso su un ex-compounder spesso sconta un fade già in corso, e ha ragione.

**Perché la valutazione è il pezzo che manca davvero.** Il paper QMJ documenta che il *prezzo
della qualità* varia nel tempo e che **un prezzo basso della qualità predice alti rendimenti
futuri di QMJ**: il premio è condizionato a quanto lo paghi. E la prova diretta è il 2022 —
scomposizione FTSE Russell del Russell 1000: **−19,1% totale, di cui −24,5 punti da
compressione del multiplo e +4,0 da crescita degli utili**. Il calo fu interamente di multiplo,
mentre gli utili salivano. MSCI World Quality quell'anno ha reso −21,9% contro −17,7% del
World: **la qualità ha perso più del mercato pur avendo fondamentali migliori.**

---

## 4. La costruzione del portafoglio

**Default: inverse-volatility**, non max-Sharpe. DeMiguel, Garlappi &amp; Uppal (RFS 2009) danno
il numero decisivo: perché la media-varianza campionaria batta 1/N servono **~3.000 mesi di
stima con 25 asset, ~6.000 con 50**. Con 14 nomi e 60 osservazioni siamo ordini di grandezza
sotto. L'inverse-vol non richiede rendimenti attesi — la fonte di errore fatale — e sotto
correlazioni omogenee coincide con l'equal risk contribution (Maillard, Roncalli &amp; Teiletche,
JPM 2010).

**L'equipeso resta benchmark obbligatorio in ogni backtest.** Se l'inverse-vol non lo batte su
almeno due o tre finestre out-of-sample, si usa l'equipeso.

**Il max-Sharpe resampled va archiviato**: abbiamo già la conferma empirica sul nostro universo.

**Covarianza**: shrinkage lineare di Ledoit &amp; Wolf verso il target single-index. Il loro studio
del 2003 ha un disegno quasi identico al nostro (N=30, T=60 mesi). Non aspettarsi Sharpe
migliore: aspettarsi **pesi stabili fra un ribilanciamento e l'altro**. Nota che essendo
long-only una parte del beneficio è già catturata: Jagannathan &amp; Ma (JF 2003) dimostrano che
il vincolo no-short agisce già come uno shrinkage implicito.

**Vincoli**: 3% minimo e 10% massimo per titolo, tetto settoriale 25% (oggi 4 utility su 14 lo
violano), numero effettivo di titoli ≥ 10 su 14, contributo al rischio del singolo ≤ 20%,
turnover annuo ≤ 20%. Chow, Kose &amp; Li (FAJ 2016) misurano che l'effetto dei vincoli è
**monotòno**: ogni vincolo alza la volatilità e abbassa il tracking error. È uno scambio
esplicito, non un pasto gratis. _Queste soglie sono raccomandazione professionale, non
evidenza accademica: l'unico riferimento quantitativo oggettivo è la regola UCITS 5/10/40._

**Concentrazione**: oltre al numero effettivo di titoli (1/HHI), serve l'**Effective Number of
Bets** di Meucci (Risk 2009), che misura l'entropia dei contributi al rischio su fattori
scorrelati. È la misura che smaschera il nostro problema: 14 titoli equipesati danno un numero
effettivo di 14, ma con 4 utility correlate l'ENB è molto più basso.

---

## 5. L'attribuzione fattoriale, che è il punto più scomodo

**Con beta 0,57–0,75 e un portafoglio pieno di utility e staples, misurare l'alfa contro
l'indice pieno non ha senso.** Il confronto onesto è contro un benchmark a **beta equivalente**
(0,7 × indice + 0,3 × risk-free).

E c'è di peggio. Il low-beta è un fattore **remunerato**, quindi non è alfa: Frazzini &amp;
Pedersen (JFE 2014) riportano per BAB azionario USA Sharpe 0,78 e rendimento anomalo dello
**0,56% al mese, t = 4,02**, coerente su 20 mercati. La dimostrazione più pulita è *Buffett's
Alpha* (Frazzini, Kabiller &amp; Pedersen, FAJ 2018): Berkshire ha Sharpe 0,79 e alfa
significativo sui fattori tradizionali, ma **l'alfa diventa non significativo controllando per
BAB e QMJ**.

Il nostro portafoglio è esattamente quel profilo. **Se non controlliamo BAB e QMJ, misureremo
alfa che non c'è.**

Critica da riportare: Novy-Marx &amp; Velikov (JFE 2022) mostrano che BAB nella sua forma
originale equipesa di fatto i rendimenti e pesca nell'1% inferiore di capitalizzazione; una
versione value-weighted rende comunque 56 bp/mese con t = 3,5. Il premio esiste, è più piccolo
e più "quality" di quanto il fattore originale suggerisca.

**Implementazione**, senza dipendenze:
- Dati gratuiti: **Kenneth French Data Library** (FF5 + momentum, anche regione Europa) e **AQR Datasets** (BAB e QMJ, USA e internazionali).
- Trappola: i fattori regionali di French sono **in dollari**. I rendimenti di portafoglio vanno convertiti in USD o l'attribuzione è sporca di valuta.
- OLS via equazioni normali, risoluzione con eliminazione di Gauss con pivoting parziale: matrice 9×9, ~60 righe di JavaScript. Errori standard **Newey-West** con lag 3–4.
- Regressioni **a scala**: CAPM → FF3 → FF5+momentum → +BAB+QMJ, leggendo l'incremento di R² e la mortalità dell'alfa a ogni passo.

---

## 6. La validazione

**La soglia t = 2 è troppo generosa.** Harvey, Liu &amp; Zhu (RFS 2016), su 316 fattori
pubblicati, concludono che serve **t > 3,0**; la soglia minima difendibile con controllo del
false discovery rate è **3,18**. E la nostra interfaccia offre sei cursori con cui esplorare
moltissime configurazioni: quel multiple testing oggi non è contabilizzato da nessuna parte.

**Con sette anni non distinguiamo da zero uno Sharpe sotto ~0,7.** È il Minimum Track Record
Length; il nostro OOS ha Sharpe 0,58. Non è un difetto da correggere: è un limite da
dichiarare in pagina, perché cambia il significato di tutto ciò che mostriamo.

Piano, in ordine di priorità:

1. **Universo point-in-time.** Tutto il resto è rumore finché l'OOS porta 3–5 pp/anno di bias.
2. **Log delle configurazioni provate.** Senza il numero di prove e la varianza degli Sharpe provati il Deflated Sharpe non è calcolabile. Costo trascurabile.
3. **Deflated Sharpe Ratio e MinTRL in pagina** (~150 righe con Φ e Φ⁻¹).
4. **Soglia a 3,0–3,2** al posto di 2,0, con l'avvertenza in interfaccia.
5. **Walk-forward a blocchi annuali**, con purging pari all'holding period ed embargo ~1% del campione.
6. **Stationary bootstrap** (Politis–Romano) con lunghezza del blocco ≈ n^(1/3) per gli intervalli di confidenza.

Da **scartare** per costo/beneficio: la CPCV completa (con sette anni i blocchi indipendenti
sono troppo pochi perché i percorsi multipli siano informativi); il PBO via CSCV (12.870
combinazioni per configurazione in JavaScript single-thread, e il Deflated Sharpe dà quasi la
stessa informazione); il test SPA di Hansen; il selettore automatico Politis–White.

**Da tenere presente su qualunque cosa aggiungeremo**: McLean &amp; Pontiff (JF 2016), su 97
predittori, misurano **−26% fuori campione e −58% dopo la pubblicazione**. Hou, Xue &amp; Zhang
(RFS 2020): con breakpoint NYSE e pesi value-weighted, il **65% di 452 anomalie non supera
|t| > 1,96**.

E la metrica primaria dovrebbe diventare **Sharpe e drawdown massimo, non il CAGR**: è lì che
la letteratura colloca il guadagno della combinazione qualità-valutazione.

---

## 7. Due verifiche da fare prima di scrivere codice

Gli agenti hanno segnalato onestamente i punti deboli delle proprie fonti. Vanno chiusi prima
dell'implementazione:

1. La formula del **Deflated Sharpe Ratio** è stata presa da una fonte secondaria perché il PDF originale di Bailey non si è lasciato estrarre. Va verificata sul paper SSRN 2460551, in particolare la definizione di SR\* e il ruolo della varianza degli Sharpe provati.
2. I numeri del **MinTRL** (≈12 anni per Sharpe 0,5, ≈4 per Sharpe 1,0) sono un calcolo dell'agente applicando la formula, non cifre lette in un paper.

Inoltre alcune cifre su QMJ (premio ~4,7% annuo, correlazioni) vengono da fonti secondarie e
sono da trattare come indicative.
