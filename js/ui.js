/* ============================================================================
 * ui.js — utilita di interfaccia condivise: tooltip accessibili e skeleton.
 * Nessuna logica di dominio: solo presentazione.
 * ========================================================================== */
(function () {
  'use strict';

  // ---- tooltip ---------------------------------------------------------------
  // Prende in carico gli attributi `title` gia presenti nel markup: li rimuove
  // al volo (per sopprimere il tooltip nativo, lento e invisibile su touch) e
  // mostra una bolla posizionata, raggiungibile anche da tastiera e con un tap.
  let bubble = null, current = null, touchOpen = false;

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'tip';
    bubble.setAttribute('role', 'tooltip');
    bubble.hidden = true;
    document.body.appendChild(bubble);
    return bubble;
  }

  const tipText = (el) => el.getAttribute('data-tip') || el.getAttribute('title') || '';

  /** L'elemento con tooltip piu vicino, purche il testo valga la pena. */
  function target(node) {
    while (node && node !== document.body) {
      if (node.nodeType === 1 && tipText(node).length > 3) return node;
      node = node.parentNode;
    }
    return null;
  }

  function place(el, b) {
    try {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;                 // fuori layout (jsdom)
      b.style.maxWidth = Math.min(320, window.innerWidth - 24) + 'px';
      const br = b.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left + r.width / 2 - br.width / 2,
        window.innerWidth - br.width - 8));
      const above = r.top - br.height - 10;
      const below = above < 8;
      b.classList.toggle('below', below);
      b.style.left = Math.round(left + window.scrollX) + 'px';
      b.style.top = Math.round((below ? r.bottom + 10 : above) + window.scrollY) + 'px';
    } catch (e) { /* nessun layout disponibile: la bolla resta a 0,0 */ }
  }

  function show(el) {
    const txt = tipText(el);
    if (!txt || el === current) return;
    hide();
    current = el;
    // sposta title -> data-tip cosi il browser non disegna anche il suo tooltip
    if (el.hasAttribute('title')) {
      el.setAttribute('data-tip', el.getAttribute('title'));
      el.removeAttribute('title');
    }
    const b = ensureBubble();
    b.textContent = txt;
    b.hidden = false;
    place(el, b);
  }

  function hide() {
    if (current && current.hasAttribute('data-tip') && !current.hasAttribute('title')) {
      current.setAttribute('title', current.getAttribute('data-tip'));
    }
    current = null; touchOpen = false;
    if (bubble) bubble.hidden = true;
  }

  function initTooltips() {
    document.addEventListener('mouseover', (e) => {
      if (touchOpen) return;
      const el = target(e.target);
      if (el) show(el); else hide();
    });
    document.addEventListener('mouseout', (e) => { if (!touchOpen && !target(e.relatedTarget)) hide(); });
    document.addEventListener('focusin', (e) => { const el = target(e.target); if (el) show(el); });
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    // touch: un tap apre il tooltip, il successivo altrove lo chiude
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const el = target(e.target);
      if (el && el !== current) { show(el); touchOpen = true; } else hide();
    }, true);
  }

  // ---- skeleton --------------------------------------------------------------
  /** Placeholder animati durante il caricamento: meglio di uno spinner o di "…". */
  function skeletonCards(n, host) {
    const el = typeof host === 'string' ? document.querySelector(host) : host;
    if (!el) return;
    el.innerHTML = Array.from({ length: n }, () =>
      '<div class="kpi"><div class="skel skel-lab"></div><div class="skel skel-val"></div>' +
      '<div class="skel skel-cmp"></div></div>').join('');
  }

  function skeletonRows(n, host, cols) {
    const el = typeof host === 'string' ? document.querySelector(host) : host;
    if (!el) return;
    const cell = '<td><div class="skel skel-cell"></div></td>';
    el.innerHTML = '<tbody>' + Array.from({ length: n }, () =>
      '<tr>' + cell.repeat(cols || 6) + '</tr>').join('') + '</tbody>';
  }

  window.ComaUI = { initTooltips, hideTooltip: hide, skeletonCards, skeletonRows };
})();
