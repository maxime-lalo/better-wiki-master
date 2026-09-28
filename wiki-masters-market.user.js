// ==UserScript==
// @name         WikiMasters — Prix de la collection
// @namespace    local.wikimasters.collection
// @version      1.3.1
// @description  Prix en cache, filtres des notifications et mise aux enchères sans quitter la collection.
// @author       maxime-lalo
// @license      MIT
// @homepageURL  https://github.com/maxime-lalo/better-wiki-master
// @supportURL   https://github.com/maxime-lalo/better-wiki-master/issues
// @updateURL    https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.meta.js
// @downloadURL  https://raw.githubusercontent.com/maxime-lalo/better-wiki-master/main/wiki-masters-market.user.js
// @match        https://www.wiki-masters.com/*
// @run-at       document-start
// @sandbox      raw
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==

/*
 * Better Wiki Master — Copyright (c) 2026 maxime-lalo
 * SPDX-License-Identifier: MIT
 *
 * MIT License
 *
 * Copyright (c) 2026 maxime-lalo
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Licence complète : https://github.com/maxime-lalo/better-wiki-master/blob/main/LICENSE
 * Usage et responsabilité : https://github.com/maxime-lalo/better-wiki-master/blob/main/NOTICE.md
 * Projet indépendant, sans garantie ni approbation de WikiMasters.
 * La licence ne donne aucune autorisation d'accéder à un service tiers ou
 * d'en enfreindre les règles. Obtenir l'autorisation nécessaire avant usage.
 */

(() => {
  'use strict';
  if (window.__wmMarketInstalled) return;
  window.__wmMarketInstalled = true;

  // Une seule requête à la fois, espacée d'au moins 1 s entre tous les onglets.
  // Mettre false pour charger uniquement avec le bouton ↻.
  const AUTO_LOAD = true;
  const INTERVAL_MS = 1000;
  const PREFIX = 'wm-market-v1:';
  const GATE_KEY = PREFIX + 'gate';
  const BLOCK_KEY = PREFIX + 'automation-block';
  const NOTIFICATION_FILTER_KEY = PREFIX + 'notification-filter';
  const LOCK = PREFIX + 'request';
  const RARITIES = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
  const nativeFetch = window.fetch.bind(window);
  const views = new Map();
  const manual = new Map();
  const failures = new Map();
  const catalogue = new Map();
  let busy = false;
  let activeId = null;
  let scanTimer;
  let storageOK = true;
  let resuming = false;
  let lastResumeRevision = 0;
  const notificationPanels = new Map();
  const savedNotificationType = read(NOTIFICATION_FILTER_KEY);
  let notificationType = typeof savedNotificationType === 'string' ? savedNotificationType : '';
  const format = n => Number.isFinite(n) ? n.toLocaleString('fr-FR') : '—';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { storageOK = false; return false; }
  }
  // Pas de durée d'expiration. Une carte sans vente est aussi mise en cache.
  function cached(id) {
    const entry = read(PREFIX + id);
    return entry?.version === 1 && Number.isFinite(entry.fetchedAt)
      && validSummary(entry.summary) ? entry : null;
  }
  function validSummary(summary) {
    return !!summary && typeof summary === 'object' && !Array.isArray(summary)
      && Object.entries(summary).every(([rarity, s]) => RARITIES.includes(rarity)
        && s && Number.isFinite(s.average) && s.average >= 0
        && Number.isInteger(s.count) && s.count >= 0
        && (s.latest === undefined || (Number.isFinite(s.latest) && s.latest >= 0)));
  }
  function save(id, data, fetchedAt = Date.now()) {
    if (!UUID.test(id) || !validSummary(data?.summary)) return false;
    if ((cached(id)?.fetchedAt || 0) > fetchedAt) return true;
    const ok = write(PREFIX + id, { version: 1, fetchedAt, summary: data.summary });
    if (ok) failures.delete(id);
    renderAll();
    return ok;
  }
  function automationBlocked() { return read(BLOCK_KEY)?.code === 'automation_limit'; }
  function gate() {
    const g = read(GATE_KEY);
    return { next: Number(g?.next) || 0, until: Number(g?.until) || 0,
      retryAfterUntil: Number(g?.retryAfterUntil) || 0, resumeRevision: Number(g?.resumeRevision) || 0 };
  }
  async function pause(response) {
    if (response.status === 403) {
      try {
        const data = await response.clone().json();
        if (data?.code === 'automation_limit') {
          write(BLOCK_KEY, { code: data.code, observedAt: Date.now() });
        }
      } catch { /* Une réponse non JSON reste traitée comme une erreur HTTP. */ }
    }
    const now = Date.now();
    const header = response.headers.get('Retry-After');
    const seconds = header === null ? NaN : Number(header);
    const retryAt = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(header);
    const delay = response.status === 401 || response.status === 403 ? 30 * 60_000 : 10 * 60_000;
    const g = gate();
    write(GATE_KEY, { ...g, until: Math.max(g.until, now + delay, retryAt || 0),
      retryAfterUntil: Math.max(g.retryAfterUntil, retryAt || 0) });
    renderAll();
  }

  // Observation passive : le site reçoit sa réponse intacte. Aucun appel ajouté.
  // Seul scope=summary est réutilisé, pour conserver exactement les chiffres
  // du formulaire de vente (l'historique complet peut avoir un autre périmètre).
  window.fetch = async function (...args) {
    const started = Date.now();
    const listing = captureAuctionSubmission(args);
    const response = await nativeFetch(...args);
    if (listing && response.ok) {
      // Le formulaire natif appelle response.json(), puis son onListed relance
      // cartes/étiquettes/échanges et router.push quitte la collection. Pour ce
      // seul formulaire, remplacer cette suite par une mise à jour React locale.
      // Le POST, le statut, les erreurs et le corps réseau restent inchangés.
      const json = response.json.bind(response);
      response.json = async () => {
        const data = await json();
        if (!UUID.test(data?.auction_id) || location.href !== listing.from
            || !listing.heading.isConnected) return data;
        try {
          listing.removeCard(previous => {
            if (!Array.isArray(previous)) return previous;
            return previous.some(item => item.id === listing.userCardId)
              ? previous.filter(item => item.id !== listing.userCardId) : previous;
          });
        } catch (error) {
          console.warn('[WikiMasters enchère] Mise à jour locale indisponible', error);
          return data; // Garder le traitement natif si la structure a changé.
        }
        for (const close of listing.close) {
          try { close(); } catch (error) { console.warn('[WikiMasters enchère]', error); }
        }
        // Préserver l'actualisation du solde (frais de mise aux enchères).
        window.dispatchEvent(new CustomEvent('wikimasters:wikibidous-balance-refresh'));
        showAuctionToast(listing.title, listing.amount);
        // Sans ID dans cette lecture, le formulaire suit sa branche « fermer ».
        // Il ne déclenche donc ni onListed (rechargement), ni la redirection.
        return { ...data, auction_id: null };
      };
    }
    try {
      const input = args[0];
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (url.origin !== location.origin) return response;
      if (url.pathname.startsWith('/api/') && [429, 401, 403].includes(response.status)) await pause(response);
      const match = url.pathname.match(/^\/api\/marketplace\/cards\/([^/]+)\/sales$/);
      if (response.ok && match && url.searchParams.get('scope') === 'summary') {
        response.clone().json().then(data => save(match[1], data, started)).catch(() => {});
      }
      if (response.ok && url.pathname === '/api/my-collection') {
        response.clone().json().then(data => {
          for (const item of data.collection || []) {
            if (!UUID.test(item.card?.id)) continue;
            const card = { ...item.card, rarity: item.snapshot_rarity ?? item.card.rarity };
            const key = card.wikipedia_title + '\n' + card.rarity;
            const ids = catalogue.get(key) || new Set();
            ids.add(card.id);
            catalogue.set(key, ids);
          }
          scheduleScan();
        }).catch(() => {});
      }
    } catch { /* L'observation ne doit jamais casser les requêtes du site. */ }
    return response;
  };

  function captureAuctionSubmission(args) {
    try {
      if (location.pathname !== '/collection') return null;
      const input = args[0];
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = String(args[1]?.method || input?.method || 'GET').toUpperCase();
      if (url.origin !== location.origin || url.pathname !== '/api/marketplace' || method !== 'POST') return null;
      // Le site envoie le JSON dans init.body. Sans correspondance exacte avec
      // l'exemplaire du formulaire, ne pas modifier son comportement.
      const body = JSON.parse(args[1]?.body);
      if (!UUID.test(body?.card_id) || !Number.isInteger(body.base_amount) || body.base_amount < 1) return null;
      const heading = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === 'Mettre aux enchères');
      if (!heading) return null;
      const key = Object.keys(heading).find(k => k.startsWith('__reactFiber$'));
      let fiber = key && heading[key];
      const close = new Set();
      const dispatchers = new Set();
      let cardId;
      let title;
      for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (UUID.test(props?.card?.id) && props.userCardId === body.card_id
            && typeof props.onClose === 'function') {
          cardId ??= props.card.id;
          title ??= props.card.wikipedia_title;
          if (cardId !== props.card.id) return null;
          close.add(props.onClose);
        }
        if (!cardId) continue;
        // Identifier la liste par ses données, sans numéro de hook ni mutation
        // des internals : seul le setter React existant sera appelé au succès.
        let hook = fiber.memoizedState;
        for (let index = 0; hook && index < 100; index++, hook = hook.next) {
          const items = hook.queue?.lastRenderedState ?? hook.memoizedState;
          if (typeof hook.queue?.dispatch === 'function' && Array.isArray(items)
              && items.some(item => item?.id === body.card_id && item.card?.id === cardId)) {
            dispatchers.add(hook.queue.dispatch);
          }
        }
      }
      // En cas de doute sur l'état React, conserver intégralement le flux natif.
      return close.size >= 2 && dispatchers.size === 1 && typeof title === 'string'
        ? { from: location.href, heading, userCardId: body.card_id,
            title, amount: body.base_amount, close: [...close], removeCard: [...dispatchers][0] } : null;
    } catch { return null; }
  }

  function showAuctionToast(title, amount) {
    const region = toastRegion();
    const toast = document.createElement('div');
    toast.className = 'wm-toast';
    const message = document.createElement('span');
    message.textContent = `${title} a bien été mise aux enchères pour ${format(amount)} wikibidous`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fermer la confirmation');
    toast.append(message, close);
    region.append(toast);
    while (region.children.length > 3) region.firstElementChild.remove();
    const timer = setTimeout(() => toast.remove(), 8000);
    close.addEventListener('click', () => { clearTimeout(timer); toast.remove(); });
  }

  function toastRegion() {
    let region = document.querySelector('.wm-toast-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'wm-toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-relevant', 'additions');
      document.body.append(region);
    }
    return region;
  }

  // Le libellé natif est le type déjà rendu par le site, pas le message de la
  // notification. Masquer les lignes conserve leurs liens et gestionnaires.
  // Aucun fetch, aucune modification de l'état lu/non lu pour ce filtrage.
  function filterNotifications() {
    for (const [root, panel] of notificationPanels) {
      if (!root.isConnected) notificationPanels.delete(root);
      else if (!panel.controls.isConnected || !panel.list.isConnected) {
        panel.controls.remove();
        panel.empty.remove();
        notificationPanels.delete(root);
      }
    }
    for (const root of document.querySelectorAll('.card-frame.fixed')) {
      const header = root.firstElementChild;
      if (header?.querySelector('span')?.textContent.trim() !== 'Notifications') continue;
      const list = [...root.children].find(el => el.classList.contains('overflow-y-auto'));
      if (!list) continue;
      let panel = notificationPanels.get(root);
      if (!panel) {
        const controls = document.createElement('div');
        controls.className = 'wm-notification-controls';
        controls.innerHTML = '<label><span>Type de notification</span><select aria-label="Type de notification"></select></label><p role="status" aria-live="polite"></p>';
        const empty = document.createElement('p');
        empty.className = 'wm-notification-empty';
        empty.textContent = 'Aucune notification de ce type parmi celles chargées.';
        empty.hidden = true;
        panel = { controls, list, empty, select: controls.querySelector('select'), status: controls.querySelector('p') };
        panel.select.addEventListener('change', () => {
          notificationType = panel.select.value;
          write(NOTIFICATION_FILTER_KEY, notificationType);
          filterNotifications();
          panel.list.scrollTop = 0;
        });
        list.before(controls);
        list.append(empty);
        notificationPanels.set(root, panel);
      }
      if (!panel.empty.isConnected) list.append(panel.empty);
      const rows = [...list.children].filter(el => el.tagName === 'BUTTON' && el.querySelector('p'));
      const counts = new Map();
      let shown = 0;
      for (const row of rows) {
        const type = row.querySelector('p').textContent.trim().replace(/\s+/g, ' ') || 'Autres';
        counts.set(type, (counts.get(type) || 0) + 1);
        const hidden = notificationType !== '' && type !== notificationType;
        if (hidden) row.setAttribute('data-wm-notification-hidden', 'true');
        else { row.removeAttribute('data-wm-notification-hidden'); shown++; }
      }
      // Conserver un filtre sans résultat quand les dernières notifications
      // changent, au lieu de réafficher silencieusement tous les types.
      if (notificationType && !counts.has(notificationType)) counts.set(notificationType, 0);
      const types = [...counts].sort(([a], [b]) => a.localeCompare(b, 'fr'));
      const signature = JSON.stringify([types, notificationType, rows.length]);
      if (panel.signature !== signature) {
        panel.signature = signature;
        const options = [['', `Toutes (${rows.length})`], ...types.map(([type, count]) => [type, `${type} (${count})`])]
          .map(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
          });
        panel.select.replaceChildren(...options);
        panel.select.value = notificationType;
        panel.status.textContent = `${shown} sur ${rows.length} notification${rows.length === 1 ? '' : 's'} chargée${rows.length === 1 ? '' : 's'}`;
      }
      panel.empty.hidden = rows.length === 0 || shown > 0;
    }
  }

  function cardInfo(heading, cardNode) {
    // Lecture seule des props : ID exact et rareté effective (dont snapshot_rarity).
    // Les internals React peuvent changer ; le catalogue réseau sert de repli.
    const key = Object.keys(heading).find(k => k.startsWith('__reactFiber$'));
    let fiber = key && heading[key];
    for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
      const card = fiber.memoizedProps?.card;
      if (card && UUID.test(card.id) && RARITIES.includes(card.rarity)
          && card.wikipedia_title === heading.textContent.trim()) {
        return { id: card.id, rarity: card.rarity, title: card.wikipedia_title };
      }
    }
    const rarity = [...cardNode.querySelectorAll('span,div')]
      .find(el => el.children.length === 0 && RARITIES.includes(el.textContent.trim()))?.textContent.trim();
    const ids = catalogue.get(heading.textContent.trim() + '\n' + rarity);
    // En cas d'ambiguïté, ne jamais affecter le prix d'une autre carte.
    return ids?.size === 1 ? { id: [...ids][0], rarity, title: heading.textContent.trim() } : null;
  }

  function visible(view) {
    if (!view.node.isConnected || document.hidden || location.pathname !== '/collection') return false;
    const r = view.cardNode.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }
  function render(view) {
    const entry = cached(view.id);
    const stats = entry?.summary[view.rarity];
    const pending = activeId === view.id || manual.has(view.id);
    const g = gate();
    const paused = g.until > Date.now();
    const error = failures.get(view.id);
    const blocked = automationBlocked();
    const state = blocked ? 'Appels refusés par le site' : !storageOK ? 'Stockage indisponible' : !navigator.locks ? 'Web Locks indisponible'
      : pending ? 'Chargement…' : paused ? 'Pause API' : error ? 'Échec · réessayer ↻'
      : entry ? new Date(entry.fetchedAt).toLocaleDateString('fr-FR') : 'Non chargé';
    const signature = JSON.stringify([entry, state, pending, paused, blocked]);
    if (view.signature === signature) return;
    view.signature = signature;
    view.mean.textContent = entry ? stats ? format(stats.average) : '—' : '…';
    view.last.textContent = entry ? stats ? format(stats.latest) : '—' : '…';
    view.count.textContent = entry ? `${format(stats?.count ?? 0)} vente${stats?.count === 1 ? '' : 's'}` : 'Ventes : …';
    view.date.textContent = state;
    view.button.disabled = blocked || pending || paused || !storageOK || !navigator.locks;
    view.button.textContent = pending ? '…' : '↻';
    view.button.title = blocked ? 'WikiMasters a refusé l’automatisation (automation_limit). Le cache reste consultable.' : paused ? `Appels suspendus jusqu'au ${new Date(g.until).toLocaleString('fr-FR')}`
      : 'Actualiser moyenne, dernière vente et nombre de ventes';
    view.node.title = [
      `Marché · ${view.rarity} · prix en WikiBidous`,
      entry ? `Consulté le ${new Date(entry.fetchedAt).toLocaleString('fr-FR')}. Cache sans expiration.` : 'Chargement des cartes visibles, une à la fois.',
      entry && !stats ? 'Aucune vente enregistrée pour cette rareté.' : '',
      error || '',
    ].filter(Boolean).join('\n');
  }
  function renderAll() { for (const view of views.values()) render(view); renderControls(); }

  async function resumeLoading() {
    if (resuming || !storageOK || !navigator.locks || gate().retryAfterUntil > Date.now()) return;
    resuming = true;
    renderControls();
    try {
      // Attend la fin de la requête en cours avant de réarmer la file.
      await navigator.locks.request(LOCK, async () => {
        const g = gate();
        if (g.retryAfterUntil > Date.now()) return;
        const next = { ...g, until: 0, retryAfterUntil: 0,
          next: Math.max(g.next, Date.now() + INTERVAL_MS), resumeRevision: g.resumeRevision + 1 };
        if (!write(GATE_KEY, next) || !write(BLOCK_KEY, null)) return;
        lastResumeRevision = next.resumeRevision;
        failures.clear();
        manual.clear();
      });
    } catch (error) { console.warn('[WikiMasters prix]', error); }
    finally { resuming = false; renderAll(); }
  }

  function renderControls() {
    let controls = document.getElementById('wm-market-controls');
    const main = document.querySelector('main');
    if (location.pathname !== '/collection' || !main) { controls?.remove(); return; }
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'wm-market-controls';
      controls.className = 'wm-market-controls';
      controls.innerHTML = '<span role="status"></span><button type="button">Reprendre le chargement</button>';
      controls.querySelector('button').addEventListener('click', () => { void resumeLoading(); });
      const heading = main.querySelector('h1');
      if (heading?.parentElement && heading.parentElement !== main) heading.parentElement.insertAdjacentElement('afterend', controls);
      else main.prepend(controls);
    }
    const g = gate();
    const waitingForServer = g.retryAfterUntil > Date.now();
    const paused = automationBlocked() || g.until > Date.now() || failures.size > 0;
    controls.hidden = !paused && !resuming;
    const button = controls.querySelector('button');
    button.disabled = resuming || busy || waitingForServer || !storageOK || !navigator.locks;
    const label = resuming ? 'Reprise…' : 'Reprendre le chargement';
    if (button.textContent !== label) button.textContent = label;
    const message = waitingForServer
      ? `Pause demandée par le serveur jusqu’au ${new Date(g.retryAfterUntil).toLocaleString('fr-FR')}.`
      : 'Chargement arrêté. Les prix en cache sont conservés.';
    const status = controls.querySelector('span');
    if (status.textContent !== message) status.textContent = message;
    button.title = waitingForServer ? 'Le délai Retry-After doit être écoulé.'
      : 'Réessayer les prix manquants, à une requête par seconde. Un nouveau refus arrêtera les appels.';
  }
  function requestRefresh(view) {
    if (automationBlocked() || activeId === view.id || manual.has(view.id) || gate().until > Date.now()) return;
    failures.delete(view.id);
    // Si un autre onglet actualise après ce clic, sa réponse suffira.
    manual.set(view.id, Date.now());
    renderAll();
    void pump();
  }
  function createView(cardNode, info) {
    const node = document.createElement('div');
    node.className = 'wm-market';
    node.innerHTML = '<div class="wm-market-top"><span>Moy. <strong></strong></span><button type="button">↻</button></div><div class="wm-market-bottom"><span>Dern. <b></b></span><span class="wm-market-count"></span></div><div class="wm-market-date"></div>';
    const view = { ...info, node, cardNode, mean: node.querySelector('strong'), last: node.querySelector('b'),
      count: node.querySelector('.wm-market-count'), date: node.querySelector('.wm-market-date'), button: node.querySelector('button') };
    view.button.setAttribute('aria-label', `Actualiser les prix de ${info.title}`);
    view.button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); requestRefresh(view); });
    // Le bouton ne doit pas ouvrir la carte ni modifier une sélection.
    node.addEventListener('click', e => e.stopPropagation());
    cardNode.insertAdjacentElement('afterend', node);
    return view;
  }
  function scan() {
    clearTimeout(scanTimer);
    filterNotifications();
    for (const [cardNode, view] of views) {
      if (!cardNode.isConnected || location.pathname !== '/collection') {
        view.node.remove(); views.delete(cardNode);
      }
    }
    if (location.pathname !== '/collection') { manual.clear(); renderControls(); return; }
    for (const heading of document.querySelectorAll('main h3')) {
      const cardNode = heading.closest('div.cursor-pointer');
      if (!cardNode || !cardNode.parentElement?.classList.contains('group')) continue;
      const info = cardInfo(heading, cardNode);
      if (!info) { views.get(cardNode)?.node.remove(); views.delete(cardNode); continue; }
      let view = views.get(cardNode);
      if (view && (view.id !== info.id || view.rarity !== info.rarity)) {
        view.node.remove(); views.delete(cardNode); view = null;
      }
      if (!view) { view = createView(cardNode, info); views.set(cardNode, view); }
      if (!view.node.isConnected) cardNode.insertAdjacentElement('afterend', view.node);
      render(view);
    }
    renderControls();
  }
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  }
  function choose() {
    const candidates = [...views.values()].filter(visible);
    for (const [id, requested] of manual) {
      if (!candidates.some(v => v.id === id)) { manual.delete(id); continue; }
      if ((cached(id)?.fetchedAt || 0) > requested) { manual.delete(id); continue; }
      return { id, requested };
    }
    if (!AUTO_LOAD) return null;
    const view = candidates.find(v => !cached(v.id) && !failures.has(v.id));
    return view ? { id: view.id, requested: 0 } : null;
  }

  async function pump() {
    if (automationBlocked() || busy || !storageOK || !navigator.locks || document.hidden || location.pathname !== '/collection') return;
    const g = gate();
    if (Date.now() < Math.max(g.next, g.until) || !choose()) return;
    busy = true;
    try {
      // ifAvailable évite d'accumuler une file d'onglets en attente.
      await navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
        if (!lock || automationBlocked() || document.hidden || location.pathname !== '/collection') return;
        const current = gate();
        if (Date.now() < Math.max(current.next, current.until)) return;
        const job = choose(); // Relire le cache APRES avoir obtenu le verrou.
        if (!job) return;
        if (!write(GATE_KEY, { ...current, next: Date.now() + INTERVAL_MS })) return;
        activeId = job.id;
        renderAll();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await nativeFetch(`/api/marketplace/cards/${job.id}/sales?scope=summary`, {
            credentials: 'same-origin', signal: controller.signal,
          });
          if (!response.ok) {
            await pause(response);
            throw new Error(`HTTP ${response.status}. Appels temporairement suspendus.`);
          }
          if (!save(job.id, await response.json())) throw new Error('Réponse invalide ou cache indisponible.');
        } catch (error) {
          failures.set(job.id, error.message || 'Erreur réseau.');
          // Aucun réessai automatique sur cette carte. Les anciennes valeurs restent visibles.
          const currentGate = gate();
          write(GATE_KEY, { ...currentGate, until: Math.max(currentGate.until, Date.now() + 60_000) });
        } finally {
          clearTimeout(timer);
          manual.delete(job.id);
          activeId = null;
          renderAll();
        }
      });
    } catch (error) { console.warn('[WikiMasters prix]', error); }
    finally { busy = false; }
  }

  function start() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', start, { once: true }); return; }
    const style = document.createElement('style');
    style.textContent = `
      .wm-market{box-sizing:border-box;width:clamp(8.4rem,43vw,10rem);margin-top:7px;padding:6px 8px;border:1px solid #ffffff24;border-radius:10px;background:#111b17;color:#d8e6df;font:11px/1.45 system-ui,sans-serif;cursor:default;font-variant-numeric:tabular-nums}
      .wm-market-top,.wm-market-bottom{display:flex;align-items:center;justify-content:space-between;gap:4px}
      .wm-market-top strong{color:#39e2a8;font-size:14px;margin-left:3px}
      .wm-market button{display:grid;place-items:center;width:26px;height:26px;flex-shrink:0;border:1px solid #ffffff25;border-radius:7px;background:#ffffff09;color:#a4eccf;font:20px/1 system-ui;cursor:pointer}
      .wm-market button:hover:not(:disabled){background:#39e2a828}
      .wm-market button:focus-visible{outline:2px solid #39e2a8;outline-offset:2px}
      .wm-market button:disabled{opacity:.4;cursor:default}
      .wm-market-bottom{font-size:10px;flex-wrap:wrap}.wm-market-bottom b{font-weight:600}
      .wm-market-date{color:#91a89b;font-size:9px;margin-top:2px;min-height:13px}
      .wm-market-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;margin:12px 0;border:1px solid #ffffff24;border-radius:10px;background:#111b17;color:#d8e6df;font:12px/1.5 system-ui,sans-serif}
      .wm-market-controls[hidden]{display:none}
      .wm-market-controls button{border:1px solid #39e2a866;border-radius:7px;padding:7px 11px;color:#a4eccf;background:#39e2a815;cursor:pointer;font:600 12px/1.4 system-ui,sans-serif}
      .wm-market-controls button:disabled{opacity:.45;cursor:default}
      .wm-market-controls button:focus-visible{outline:2px solid #39e2a8;outline-offset:2px}
      .wm-notification-controls{flex:none;padding:10px 16px;border-bottom:1px solid var(--color-border,#ffffff24);background:var(--color-surface,#111b17);color:var(--color-foreground,#d8e6df);font:12px/1.4 system-ui,sans-serif}
      .wm-notification-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:600}
      .wm-notification-controls select{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--color-border,#ffffff24);border-radius:7px;padding:7px 9px;background:var(--color-surface-light,#19251e);color:var(--color-foreground,#d8e6df);font:12px/1.4 system-ui,sans-serif;cursor:pointer}
      .wm-notification-controls select:focus-visible{outline:2px solid var(--color-accent,#39e2a8);outline-offset:2px}
      .wm-notification-controls p{margin:6px 0 0;font-size:10px;opacity:.65}
      [data-wm-notification-hidden="true"]{display:none!important}
      .wm-notification-empty{margin:0;padding:20px 16px;text-align:center;color:var(--color-foreground,#d8e6df);font:12px/1.5 system-ui,sans-serif;opacity:.65}
      .wm-notification-empty[hidden]{display:none}
      .wm-toast-region{position:fixed;z-index:1000;right:16px;bottom:max(24px,env(safe-area-inset-bottom));width:min(420px,calc(100vw - 32px));display:flex;flex-direction:column;gap:8px;pointer-events:none}
      .wm-toast{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #39e2a866;border-radius:12px;background:#14271f;color:#e0f6ea;box-shadow:0 6px 24px #0006;font:13px/1.5 system-ui,sans-serif;pointer-events:auto}
      .wm-toast span{flex:1;min-width:0;overflow-wrap:anywhere}
      .wm-toast button{flex:none;width:28px;height:28px;border:0;border-radius:6px;background:#ffffff12;color:inherit;font:22px/1 system-ui;cursor:pointer}
      .wm-toast button:focus-visible{outline:2px solid #39e2a8;outline-offset:2px}
      @media(max-width:640px){.wm-toast-region{bottom:calc(80px + env(safe-area-inset-bottom))}}
    `;
    document.head.append(style);
    toastRegion();
    const probe = PREFIX + 'probe';
    if (write(probe, true)) localStorage.removeItem(probe);
    new MutationObserver(changes => {
      if (changes.some(c => !c.target.closest?.('.wm-market,.wm-market-controls,.wm-notification-controls,.wm-notification-empty,.wm-toast-region'))) scheduleScan();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    lastResumeRevision = gate().resumeRevision;
    window.addEventListener('storage', e => {
      if (!e.key?.startsWith(PREFIX)) return;
      if (e.key === NOTIFICATION_FILTER_KEY) {
        const type = read(NOTIFICATION_FILTER_KEY);
        notificationType = typeof type === 'string' ? type : '';
        filterNotifications();
      }
      const revision = gate().resumeRevision;
      if (revision > lastResumeRevision) {
        lastResumeRevision = revision;
        failures.clear();
        manual.clear();
      }
      renderAll();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleScan(); void pump(); } });
    // Contrôle local, sans appel réseau : gère aussi pagination et navigation SPA.
    setInterval(renderAll, 1000);
    setInterval(() => { void pump(); }, 250);
    scan();
  }
  start();
})();
