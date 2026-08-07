// Accesso OPZIONALE per gli screener pubblici.
//
// Diverso dall'auth-gate delle app aziendali: qui non si blocca niente.
// Chiunque apra la pagina vede i dati subito, senza account. L'accesso serve
// solo a chi carica o cancella, perche' le regole del progetto
// igorbonfanti-screener concedono la lettura a tutti e la scrittura solo a un
// utente autenticato.
//
// Stesso file per bond-screener e coma-screener. Se lo modifichi qui,
// riportalo anche nell'altro repo e alza la versione del service worker,
// altrimenti i client gia' installati continueranno a usare quello vecchio.

(function () {
  'use strict';

  var CONFIG = {
    apiKey: 'AIzaSyCJK3ewMh6T8GHWbJx_WB39JYIYYifoyl8',
    authDomain: 'igorbonfanti-screener.firebaseapp.com',
    projectId: 'igorbonfanti-screener',
    storageBucket: 'igorbonfanti-screener.firebasestorage.app',
    messagingSenderId: '1015526355462',
    appId: '1:1015526355462:web:e8c2c95edacac1c48b4987'
  };

  if (typeof firebase === 'undefined' || !firebase.auth) {
    console.warn('[Accesso] SDK Firebase Auth non caricato: il pulsante di accesso non comparira.');
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(CONFIG);

  var auth = firebase.auth();
  var utenteCorrente = null;
  var pulsante = null;
  var modale = null;

  function messaggioErrore(err) {
    switch ((err && err.code) || '') {
      case 'auth/invalid-email': return 'Indirizzo email non valido.';
      case 'auth/user-disabled': return 'Utente disabilitato.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return 'Email o password errati.';
      case 'auth/too-many-requests': return 'Troppi tentativi. Riprova fra qualche minuto.';
      case 'auth/network-request-failed': return 'Connessione assente.';
      default: return 'Accesso non riuscito. Riprova.';
    }
  }

  // --- pulsante fisso in basso a destra -----------------------------------

  function creaPulsante() {
    var b = document.createElement('button');
    b.id = 'accessoPulsante';
    b.type = 'button';
    b.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483000',
      'padding:7px 12px', 'font-size:12px', 'font-family:system-ui,sans-serif',
      'border:1px solid rgba(127,127,127,.45)', 'border-radius:999px',
      'background:rgba(20,22,28,.82)', 'color:#e8eaee', 'cursor:pointer',
      'backdrop-filter:blur(4px)'
    ].join(';');
    b.addEventListener('click', function () {
      if (utenteCorrente) {
        if (confirm('Vuoi uscire da ' + utenteCorrente.email + '?')) auth.signOut();
      } else {
        mostraModale();
      }
    });
    document.body.appendChild(b);
    return b;
  }

  function aggiornaPulsante() {
    if (!pulsante) pulsante = creaPulsante();
    if (utenteCorrente) {
      pulsante.textContent = '● ' + utenteCorrente.email;
      pulsante.title = 'Sei autenticato: puoi salvare ed eliminare. Clicca per uscire.';
    } else {
      pulsante.textContent = 'Accedi per salvare';
      pulsante.title = 'La consultazione e libera. L\'accesso serve solo per salvare.';
    }
  }

  // --- modale di accesso ---------------------------------------------------

  function mostraModale() {
    if (modale && modale.isConnected) return;
    modale = document.createElement('div');
    modale.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483001', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:24px',
      'background:rgba(0,0,0,.55)', 'font-family:system-ui,sans-serif'
    ].join(';');

    modale.innerHTML =
      '<form id="accessoForm" style="width:100%;max-width:340px;background:#fff;border-radius:12px;padding:24px">' +
      '<h2 style="margin:0;font-size:16px;color:#0f172a">Accesso</h2>' +
      '<p style="margin:6px 0 18px;font-size:12px;color:#64748b">Serve solo per salvare o eliminare. La consultazione resta libera.</p>' +
      '<input id="accessoEmail" type="email" placeholder="Email" autocomplete="username" required ' +
      'style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:9px 11px;font-size:14px;border:1px solid #cbd5e1;border-radius:7px">' +
      '<input id="accessoPassword" type="password" placeholder="Password" autocomplete="current-password" required ' +
      'style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:14px;border:1px solid #cbd5e1;border-radius:7px">' +
      '<p id="accessoErrore" role="alert" style="display:none;margin:10px 0 0;padding:8px 10px;font-size:12px;color:#991b1b;background:#fee2e2;border-radius:7px"></p>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button type="button" id="accessoAnnulla" style="flex:1;padding:9px;font-size:13px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;cursor:pointer">Annulla</button>' +
      '<button type="submit" id="accessoConferma" style="flex:1;padding:9px;font-size:13px;font-weight:600;color:#fff;background:#0f172a;border:0;border-radius:7px;cursor:pointer">Accedi</button>' +
      '</div></form>';

    var chiudi = function () { if (modale && modale.isConnected) modale.remove(); };
    modale.querySelector('#accessoAnnulla').addEventListener('click', chiudi);
    modale.addEventListener('click', function (e) { if (e.target === modale) chiudi(); });

    modale.querySelector('#accessoForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var errore = modale.querySelector('#accessoErrore');
      var conferma = modale.querySelector('#accessoConferma');
      errore.style.display = 'none';
      conferma.disabled = true;
      conferma.textContent = 'Accesso...';
      auth.signInWithEmailAndPassword(
        modale.querySelector('#accessoEmail').value.trim(),
        modale.querySelector('#accessoPassword').value
      ).then(chiudi).catch(function (err) {
        errore.textContent = messaggioErrore(err);
        errore.style.display = 'block';
        conferma.disabled = false;
        conferma.textContent = 'Accedi';
      });
    });

    document.body.appendChild(modale);
    modale.querySelector('#accessoEmail').focus();
  }

  // --- avvio ---------------------------------------------------------------

  auth.onAuthStateChanged(function (u) {
    utenteCorrente = u;
    if (document.body) aggiornaPulsante();
    else document.addEventListener('DOMContentLoaded', aggiornaPulsante);
  });

  window.Accesso = {
    utente: function () { return utenteCorrente; },
    puoScrivere: function () { return !!utenteCorrente; },
    logout: function () { return auth.signOut(); }
  };
})();
