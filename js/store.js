/* store.js — persistenza snapshot su Firebase Firestore (progetto condiviso
 * magazzino-edile-pos, namespace coma_snapshots). Degrada con grazia offline. */
(function () {
  'use strict';
  const CONFIG = {
    apiKey: 'AIzaSyCLdOfp4z3FUJX2xt-xBZciyjxJZWeoh7A',
    authDomain: 'magazzino-edile-pos.firebaseapp.com',
    projectId: 'magazzino-edile-pos',
    storageBucket: 'magazzino-edile-pos.appspot.com',
  };
  const COLL = 'coma_snapshots';
  let db = null, ready = false;

  function init() {
    try {
      if (typeof firebase === 'undefined') return false;
      if (!firebase.apps.length) firebase.initializeApp(CONFIG);
      db = firebase.firestore();
      ready = true;
      return true;
    } catch (e) { console.warn('Firebase non disponibile:', e.message); return false; }
  }

  async function save(snapshot) {
    if (!ready && !init()) throw new Error('Firebase non inizializzato');
    const doc = { ...snapshot, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref = await db.collection(COLL).add(doc);
    return ref.id;
  }

  async function list(max) {
    if (!ready && !init()) return [];
    const snap = await db.collection(COLL).orderBy('createdAt', 'desc').limit(max || 50).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function remove(id) {
    if (!ready && !init()) throw new Error('Firebase non inizializzato');
    await db.collection(COLL).doc(id).delete();
  }

  window.ComaStore = { init, save, list, remove, available: () => ready || init() };
})();
