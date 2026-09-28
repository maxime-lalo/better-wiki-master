// ==UserScript==
// @name         WikiMasters — Prix de la collection
// @namespace    local.wikimasters.collection
// @version      1.6.0
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

  // Une seule requête à la fois ; le délai commence après sa réponse complète.
  // Mettre false pour charger uniquement avec le bouton ↻.
  const AUTO_LOAD = true;
  const DEFAULT_INTERVAL_MS = 1000;
  const MIN_INTERVAL_MS = 1000;
  const MAX_INTERVAL_MS = 30000;
  const REQUEST_TIMEOUT_MS = 20000;
  const SHARED_DEFAULT_URL = 'https://wikimasters-cache.eplp.fr';
  const PREFIX = 'wm-market-v1:';
  const GATE_KEY = PREFIX + 'gate';
  const BLOCK_KEY = PREFIX + 'automation-block';
  const SETTINGS_KEY = PREFIX + 'sync-settings';
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
  const collectionLoads = new Set();
  let collectionSerial = 0;
  let lastCollectionLoad = null;
  let pageCandidate = null;
  let activePage = null;
  let pageError = '';
  const shared = { signature: '', busy: false, checked: new Map(), waiting: new Map(),
    pending: new Map(), retryAt: 0, message: 'Cache partagé désactivé.', uploaded: {}, formSignature: '', lookupUrl: '', deniedKey: '' };
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
  function save(id, data, fetchedAt = Date.now(), source = 'site', quiet = false) {
    if (!UUID.test(id) || !validSummary(data?.summary)) return false;
    if ((cached(id)?.fetchedAt || 0) > fetchedAt) return true;
    const ok = write(PREFIX + id, { version: 1, fetchedAt, summary: data.summary, source });
    if (ok) failures.delete(id);
    if (ok && source === 'site') queueContribution(id, { fetchedAt, summary: data.summary });
    if (!quiet) renderAll();
    return ok;
  }
  function automationBlocked() { return read(BLOCK_KEY)?.code === 'automation_limit'; }
  function syncSettings() {
    const saved = read(SETTINGS_KEY);
    const intervalMs = Number.isFinite(saved?.intervalMs)
      ? Math.round(saved.intervalMs / 500) * 500 : DEFAULT_INTERVAL_MS;
    return { enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
      autoNext: saved?.autoNext === true,
      sharedEnabled: saved?.sharedEnabled === true,
      sharedUrl: typeof saved?.sharedUrl === 'string' ? saved.sharedUrl : SHARED_DEFAULT_URL,
      contributorKey: typeof saved?.contributorKey === 'string' ? saved.contributorKey : '',
      intervalMs: Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, intervalMs)) };
  }
  function setSyncSettings(update) {
    const settings = { ...syncSettings(), ...update };
    if (!write(SETTINGS_KEY, settings)) { renderAll(); return; }
    if (!settings.enabled) manual.clear();
    pageCandidate = null;
    if (update.autoNext !== undefined) pageError = '';
    renderAll();
    void pump();
  }
  function gate() {
    const g = read(GATE_KEY);
    const request = g?.request;
    return { next: Number(g?.next) || 0, until: Number(g?.until) || 0,
      waitFrom: Number(g?.waitFrom) || 0,
      request: (UUID.test(request?.id) || request?.kind === 'page') && typeof request.title === 'string'
        && Number.isFinite(request.expiresAt) ? request : null,
      retryAfterUntil: Number(g?.retryAfterUntil) || 0, resumeRevision: Number(g?.resumeRevision) || 0 };
  }
  function nextRequestAt(g, settings = syncSettings()) {
    // Recalculer depuis la fin de la requête précédente permet de modifier le
    // curseur pendant le compte à rebours, sans remettre le compteur à zéro.
    return g.waitFrom ? g.waitFrom + settings.intervalMs : g.next;
  }

  function sharedConfig() {
    const settings = syncSettings();
    return { enabled: settings.sharedEnabled, url: settings.sharedUrl, key: settings.contributorKey };
  }
  function sharedUrl(input) {
    const url = new URL(input);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Utiliser une adresse de serveur sans chemin ni identifiants.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('Le cache partagé doit utiliser HTTPS.');
    }
    return url.origin;
  }
  function currentShared(config) {
    return syncSettings().enabled && JSON.stringify(config) === JSON.stringify(sharedConfig());
  }
  function uploadedKey(config) { return PREFIX + 'shared-uploaded:' + config.url; }
  function queueContribution(id, value) {
    const config = sharedConfig();
    if (!config.enabled || !config.key || value.source === 'shared') return;
    if ((shared.uploaded[id] || 0) < value.fetchedAt) shared.pending.set(id, { id, fetchedAt: value.fetchedAt, summary: value.summary });
  }
  function markUploaded(config, entries) {
    const markers = read(uploadedKey(config)) || {};
    for (const value of entries) {
      markers[value.id] = Math.max(Number(markers[value.id]) || 0, value.fetchedAt);
      if (shared.pending.get(value.id)?.fetchedAt <= value.fetchedAt) shared.pending.delete(value.id);
    }
    shared.uploaded = markers;
    write(uploadedKey(config), markers);
  }
  function sharedFailure(error, config) {
    if (!currentShared(config)) return;
    if (error.status === 401 && config.key) {
      shared.deniedKey = config.key;
      shared.message = 'Contributions refusées. Le cache reste disponible en lecture seule.';
      return;
    }
    shared.retryAt = Date.now() + Math.max(60000, error.retryMs || 0);
    shared.message = `Cache partagé indisponible : ${error.message}. Mode local avec délai WikiMasters.`;
  }
  async function sharedRequest(config, path, body, contribute = false) {
    if (!currentShared(config)) throw new Error('Réglages modifiés');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await nativeFetch(sharedUrl(config.url) + path, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...(contribute ? { contributorKey: config.key } : {}) }),
      });
      if (!response.ok) {
        const error = new Error(response.status === 401 ? 'clé de contribution refusée' : `HTTP ${response.status}`);
        error.status = response.status;
        const retry = response.headers.get('Retry-After');
        const seconds = retry === null ? NaN : Number(retry);
        error.retryMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
        throw error;
      }
      const result = await response.json();
      if (!currentShared(config)) throw new Error('Réglages modifiés');
      return result;
    } finally { clearTimeout(timer); }
  }
  function importShared(entries, allowed) {
    if (!Array.isArray(entries) || entries.length > 100) throw new Error('Réponse de cache invalide');
    for (const value of entries) {
      if (!value || !UUID.test(value.id) || !allowed.has(value.id) || !validSummary(value.summary)
          || !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt < 946684800000 || value.fetchedAt > Date.now() + 120000) {
        throw new Error('Prix partagé invalide');
      }
    }
    for (const value of entries) save(value.id, value, value.fetchedAt, 'shared', true);
    renderAll();
  }
  async function sharedLookup(config, ids) {
    const result = await sharedRequest(config, '/v1/lookup', { ids });
    const wanted = new Set(ids);
    if (!Array.isArray(result?.entries) || !Array.isArray(result.missing)
        || result.missing.some(id => !wanted.has(id))
        || new Set([...result.entries.map(v => v?.id), ...result.missing]).size !== wanted.size) throw new Error('Réponse de cache incomplète');
    importShared(result.entries, wanted);
    return result;
  }
  async function sharedPass() {
    const config = sharedConfig();
    if (!config.enabled) { shared.message = 'Cache partagé désactivé.'; return true; }
    if (shared.busy) return false;
    const signature = JSON.stringify(config);
    if (shared.signature !== signature) {
      shared.signature = signature;
      if (shared.lookupUrl !== config.url) { shared.checked.clear(); shared.waiting.clear(); shared.lookupUrl = config.url; }
      shared.pending.clear(); shared.retryAt = 0;
      shared.uploaded = read(uploadedKey(config)) || {};
      if (config.key) {
        // Importer le cache existant en lots ; les prix venus du serveur ne sont
        // jamais renvoyés comme de nouvelles observations WikiMasters.
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith(PREFIX) || !UUID.test(key.slice(PREFIX.length))) continue;
          const id = key.slice(PREFIX.length), value = cached(id);
          if (value) queueContribution(id, value);
        }
      }
      shared.message = config.key ? 'Cache partagé connecté.' : 'Activation du partage automatique…';
    }
    if (shared.retryAt > Date.now()) return true;
    // Lecture groupée AVANT le délai WikiMasters. Tous les prix disponibles
    // s'affichent ensemble, sans délai artificiel entre les cartes du lot.
    const ids = [...new Set([...views.values()].filter(onCollectionPage).map(v => v.id))]
      .filter(id => (shared.waiting.get(id) || 0) <= Date.now()
        && shared.checked.get(id) !== (manual.get(id) || 0)).slice(0, 100);
    const canContribute = config.key && shared.deniedKey !== config.key;
    const registrationGate = PREFIX + 'registration:' + config.url;
    const needsKey = !config.key && (read(registrationGate)?.until || 0) <= Date.now();
    const entries = [...shared.pending.values()].slice(0, 100);
    if (!ids.length && !(canContribute && entries.length) && !needsKey) return true;
    shared.busy = true;
    try {
      if (ids.length) {
        shared.message = `Recherche de ${ids.length} cartes dans le cache partagé…`;
        renderControls();
        const requested = new Map(ids.map(id => [id, manual.get(id) || 0]));
        const result = await sharedLookup(config, ids);
        for (const id of ids) shared.checked.set(id, requested.get(id));
        shared.message = `Cache partagé : ${result.entries.length} prix trouvés, ${result.missing.length} absents du lot.`;
      } else if (needsKey) {
        shared.message = 'Activation du partage automatique…';
        renderControls();
        try {
          if (!navigator.locks) throw new Error('Coordination entre onglets indisponible');
          await navigator.locks.request(PREFIX + 'registration:' + config.url, { ifAvailable: true }, async lock => {
            if (!lock || !currentShared(config) || sharedConfig().key) return;
            if ((read(registrationGate)?.until || 0) > Date.now()) return;
            const result = await sharedRequest(config, '/v1/installations', {});
            if (!/^bwm_[A-Za-z0-9_-]{43}$/.test(result?.contributorKey)) throw new Error('Clé automatique invalide');
            setSyncSettings({ contributorKey: result.contributorKey });
            shared.message = 'Partage automatique activé.';
          });
        } catch (error) {
          if (currentShared(config)) {
            write(registrationGate, { until: Date.now() + Math.max(60000, error.retryMs || 0) });
            shared.message = 'Lecture du cache disponible. Activation du partage différée : ' + error.message + '.';
          }
        }
      } else {
        shared.message = `Partage de ${entries.length} prix en cache…`;
        renderControls();
        const result = await sharedRequest(config, '/v1/contributions', { entries }, true);
        if (result?.accepted !== entries.length) throw new Error('Contribution non confirmée');
        markUploaded(config, entries);
        shared.message = `Cache partagé : ${entries.length} prix envoyés${shared.pending.size ? `, ${shared.pending.size} en attente` : ''}.`;
      }
    } catch (error) { sharedFailure(error, config); }
    finally { shared.busy = false; renderControls(); }
    return false;
  }
  async function sharedBeforeSite(job) {
    const config = sharedConfig();
    if (!config.enabled || shared.retryAt > Date.now()) return { proceed: true };
    try {
      if (!config.key || shared.deniedKey === config.key) {
        await sharedLookup(config, [job.id]);
        return { proceed: job.requested ? (cached(job.id)?.fetchedAt || 0) <= job.requested : !cached(job.id) };
      }
      const claim = await sharedRequest(config, '/v1/claims', { id: job.id, after: job.requested }, true);
      if (claim?.state === 'cached') { importShared([claim.entry], new Set([job.id])); return { proceed: false }; }
      if (claim?.state === 'busy') {
        shared.waiting.set(job.id, Date.now() + 5000);
        shared.checked.delete(job.id);
        shared.message = 'Un autre utilisateur récupère ce prix. Vérification dans 5 s.';
        return { proceed: false };
      }
      if (claim?.state !== 'granted' || typeof claim.token !== 'string' || !Number.isFinite(claim.expiresAt)) throw new Error('Réservation invalide');
      return { proceed: true, lease: { config, id: job.id, token: claim.token } };
    } catch (error) { sharedFailure(error, config); return { proceed: true }; }
  }
  async function finishSharedLease(lease, success) {
    if (!lease || !currentShared(lease.config)) return;
    try {
      if (success) {
        const value = cached(lease.id);
        if (!value) return;
        const entries = [{ id: lease.id, fetchedAt: value.fetchedAt, summary: value.summary }];
        const result = await sharedRequest(lease.config, '/v1/contributions', { entries }, true);
        if (result?.accepted !== 1) throw new Error('Contribution non confirmée');
        markUploaded(lease.config, entries);
      }
      // Publier le prix avant de libérer la réservation évite une seconde
      // consultation pendant l'envoi. En cas d'échec, le bail expirera seul.
      await sharedRequest(lease.config, '/v1/claims/release', { id: lease.id, token: lease.token }, true);
    } catch (error) { sharedFailure(error, lease.config); }
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
    const collectionLoad = observeCollectionLoad(args);
    let response;
    try { response = await nativeFetch(...args); }
    catch (error) { finishCollectionLoad(collectionLoad, false); throw error; }
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
      if (collectionLoad && response.ok) {
        response.clone().json().then(data => {
          if (!Array.isArray(data.collection)) throw new Error('Collection invalide');
          for (const item of data.collection || []) {
            if (!UUID.test(item.card?.id)) continue;
            const card = { ...item.card, rarity: item.snapshot_rarity ?? item.card.rarity };
            const key = card.wikipedia_title + '\n' + card.rarity;
            const ids = catalogue.get(key) || new Set();
            ids.add(card.id);
            catalogue.set(key, ids);
          }
          finishCollectionLoad(collectionLoad, true);
          scheduleScan();
        }).catch(() => finishCollectionLoad(collectionLoad, false));
      } else finishCollectionLoad(collectionLoad, false);
    } catch { finishCollectionLoad(collectionLoad, false); /* Préserver les requêtes natives. */ }
    return response;
  };

  function observeCollectionLoad(args) {
    try {
      const input = args[0];
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = String(args[1]?.method || input?.method || 'GET').toUpperCase();
      if (url.origin !== location.origin || url.pathname !== '/api/my-collection' || method !== 'GET') return null;
      const load = { serial: ++collectionSerial, page: Number(url.searchParams.get('page') || 0) + 1, done: false, ok: false };
      collectionLoads.add(load);
      lastCollectionLoad = load;
      pageCandidate = null;
      return load;
    } catch { return null; }
  }
  function finishCollectionLoad(load, ok) {
    if (!load) return;
    load.done = true;
    load.ok = ok;
    collectionLoads.delete(load);
  }

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

  function onCollectionPage(view) {
    // Toute la grille de la page courante est éligible, y compris sous la
    // ligne de flottaison. Les cartes des autres pages ne sont pas parcourues.
    if (!view.node.isConnected || location.pathname !== '/collection') return false;
    const r = view.cardNode.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function render(view) {
    const entry = cached(view.id);
    const stats = entry?.summary[view.rarity];
    const g = gate();
    const settings = syncSettings();
    const pending = activeId === view.id || manual.has(view.id)
      || (g.request?.id === view.id && g.request.expiresAt > Date.now());
    const paused = g.until > Date.now();
    const error = failures.get(view.id);
    const blocked = automationBlocked();
    const state = blocked ? 'Appels refusés par le site' : !storageOK ? 'Stockage indisponible' : !navigator.locks ? 'Web Locks indisponible'
      : pending ? 'Chargement…' : !settings.enabled ? 'Synchronisation désactivée' : paused ? 'Pause API' : error ? 'Échec · réessayer ↻'
      : entry ? `${entry.source === 'shared' ? 'Partagé · ' : ''}${new Date(entry.fetchedAt).toLocaleDateString('fr-FR')}` : 'Non chargé';
    const signature = JSON.stringify([entry, state, pending, paused, blocked, settings.enabled]);
    if (view.signature === signature) return;
    view.signature = signature;
    view.mean.textContent = entry ? stats ? format(stats.average) : '—' : '…';
    view.last.textContent = entry ? stats ? format(stats.latest) : '—' : '…';
    view.count.textContent = entry ? `${format(stats?.count ?? 0)} vente${stats?.count === 1 ? '' : 's'}` : 'Ventes : …';
    view.date.textContent = state;
    view.button.disabled = !settings.enabled || blocked || pending || paused || !storageOK || !navigator.locks;
    view.button.textContent = pending ? '…' : '↻';
    view.button.title = !settings.enabled ? 'Activer la synchronisation dans le bandeau pour actualiser ce prix.' : blocked ? 'WikiMasters a refusé l’automatisation (automation_limit). Le cache reste consultable.' : paused ? `Appels suspendus jusqu'au ${new Date(g.until).toLocaleString('fr-FR')}`
      : 'Actualiser moyenne, dernière vente et nombre de ventes';
    view.node.title = [
      `Marché · ${view.rarity} · prix en WikiBidous`,
      entry ? `Consulté le ${new Date(entry.fetchedAt).toLocaleString('fr-FR')}. Cache sans expiration.` : 'Chargement des cartes de cette page, une à la fois.',
      entry?.source === 'shared' ? 'Source : cache partagé communautaire, chiffres non certifiés par WikiMasters.' : '',
      entry && !stats ? 'Aucune vente enregistrée pour cette rareté.' : '',
      error || '',
    ].filter(Boolean).join('\n');
  }
  function renderAll() { for (const view of views.values()) render(view); renderControls(); }

  async function resumeLoading() {
    if (resuming || !syncSettings().enabled || !storageOK || !navigator.locks || gate().retryAfterUntil > Date.now()) return;
    resuming = true;
    renderControls();
    try {
      // Attend la fin de la requête en cours avant de réarmer la file.
      await navigator.locks.request(LOCK, async () => {
        const g = gate();
        if (!syncSettings().enabled || g.retryAfterUntil > Date.now()) return;
        const waitFrom = Date.now();
        const next = { ...g, until: 0, retryAfterUntil: 0, request: null, waitFrom,
          next: waitFrom + syncSettings().intervalMs, resumeRevision: g.resumeRevision + 1 };
        if (!write(GATE_KEY, next) || !write(BLOCK_KEY, null)) return;
        lastResumeRevision = next.resumeRevision;
        failures.clear();
        manual.clear();
        pageError = '';
        pageCandidate = null;
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
      controls.innerHTML = `<div class="wm-sync-summary">
        <strong class="wm-sync-status" role="status" aria-live="polite"></strong>
        <span class="wm-sync-detail"></span><span class="wm-sync-progress"></span>
      </div><div class="wm-sync-settings">
        <label class="wm-sync-toggle"><input type="checkbox" role="switch" aria-label="Synchronisation des prix"><span>Synchronisation des prix</span></label>
        <label class="wm-sync-delay" for="wm-sync-delay"><span>Délai après chaque réponse <output></output></span>
          <input id="wm-sync-delay" type="range" min="1" max="30" step="0.5" aria-label="Délai après chaque réponse (secondes)">
        </label>
        <label class="wm-sync-auto-next"><input type="checkbox"><span>Passer automatiquement à la page suivante</span></label>
        <details class="wm-shared"><summary>Cache partagé</summary>
          <label class="wm-sync-auto-next"><input class="wm-shared-enabled" type="checkbox"><span>Utiliser le cache partagé</span></label>
          <p class="wm-shared-info">Activation sans compte : les prix déjà en cache et les nouvelles consultations sont partagés automatiquement. Aucun cookie ni identifiant de compte WikiMasters envoyé.</p>
          <details class="wm-shared-advanced"><summary>Paramètres avancés</summary>
          <form class="wm-shared-form">
            <label>Serveur HTTPS<input class="wm-shared-url" type="url" aria-label="Adresse du cache partagé" required></label>
            <label>Clé de contribution (gérée automatiquement)<input class="wm-shared-key" type="password" aria-label="Clé de contribution" autocomplete="off"></label>
            <button type="submit">Enregistrer le cache partagé</button>
          </form></details>
        </details><span class="wm-shared-status" role="status"></span>
        <button class="wm-sync-resume" type="button">Reprendre le chargement</button>
      </div>`;
      controls.querySelector('[role="switch"]').addEventListener('change', event => {
        setSyncSettings({ enabled: event.target.checked });
      });
      controls.querySelector('input[type="range"]').addEventListener('input', event => {
        setSyncSettings({ intervalMs: Number(event.target.value) * 1000 });
      });
      controls.querySelector('.wm-sync-auto-next input').addEventListener('change', event => {
        setSyncSettings({ autoNext: event.target.checked });
      });
      shared.formSignature = '';
      controls.querySelector('.wm-shared-enabled').addEventListener('change', event => {
        setSyncSettings({ sharedEnabled: event.target.checked });
      });
      controls.querySelector('.wm-shared-url').addEventListener('input', event => {
        event.target.setCustomValidity('');
      });
      controls.querySelector('.wm-shared-form').addEventListener('submit', event => {
        event.preventDefault();
        const input = controls.querySelector('.wm-shared-url');
        input.setCustomValidity('');
        try {
          const url = sharedUrl(input.value.trim());
          const settings = syncSettings();
          let key = controls.querySelector('.wm-shared-key').value.trim();
          if (url !== settings.sharedUrl && key === settings.contributorKey) key = '';
          setSyncSettings({ sharedUrl: url, contributorKey: key });
        } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
      });
      controls.querySelector('.wm-sync-resume').addEventListener('click', () => { void resumeLoading(); });
      const heading = main.querySelector('h1');
      if (heading?.parentElement && heading.parentElement !== main) heading.parentElement.insertAdjacentElement('afterend', controls);
      else main.prepend(controls);
    }
    const g = gate();
    const settings = syncSettings();
    const now = Date.now();
    const waitingForServer = g.retryAfterUntil > now;
    const blocked = automationBlocked();
    const paused = blocked || g.until > now || waitingForServer;
    const request = g.request?.expiresAt > now ? g.request : null;
    const job = choose();
    const currentViews = [...views.values()].filter(v => v.node.isConnected);
    const pageViews = currentViews.filter(onCollectionPage);
    const pageNodes = pageCardNodes();
    const recognizedViews = pageNodes.flatMap(node => {
      const view = views.get(node), info = cardInfo(node.querySelector('h3'), node);
      return view && info?.id === view.id ? [view] : [];
    });
    const unknownCards = recognizedViews.length !== pageNodes.length;
    const errors = !!pageError || currentViews.some(v => failures.has(v.id));
    let message;
    let detail = 'Les prix en cache sont conservés.';
    if (request) {
      const local = request.kind === 'page' ? activePage !== null : activeId === request.id;
      message = `${request.kind === 'page' ? 'Changement de page en cours' : 'Synchronisation en cours'} — ${request.title}${local ? '' : ' (autre onglet)'}`;
      if (!settings.enabled) detail = 'Arrêt demandé : cette requête se termine, puis aucun autre appel ne sera lancé.';
      else detail = 'Le délai commencera après réception complète de cette réponse.';
    } else if (!storageOK) message = 'Synchronisation indisponible — stockage local inaccessible.';
    else if (!navigator.locks) message = 'Synchronisation indisponible — Web Locks indisponible.';
    else if (!settings.enabled) message = 'Synchronisation désactivée.';
    else if (resuming) message = 'Reprise du chargement…';
    else if (waitingForServer) {
      message = 'Synchronisation en pause — délai demandé par le serveur.';
      detail = `Reprise possible à partir du ${new Date(g.retryAfterUntil).toLocaleString('fr-FR')}.`;
    } else if (blocked) message = 'Chargement arrêté — appels refusés par le site.';
    else if (paused) {
      message = 'Synchronisation en pause après une erreur.';
      detail = `Pause jusqu’au ${new Date(g.until).toLocaleString('fr-FR')}. Les prix en cache sont conservés.`;
    } else if (pageError && settings.autoNext) {
      message = 'Passage automatique arrêté.';
      detail = pageError + ' Utiliser « Reprendre le chargement » pour réessayer.';
    } else if (collectionLoads.size) message = 'En attente du chargement de la collection.';
    else if (settings.sharedEnabled && shared.busy) message = 'Synchronisation du cache partagé…';
    else if (job) {
      const remaining = Math.max(0, nextRequestAt(g, settings) - now);
      message = remaining ? 'En attente du prochain chargement.' : 'Synchronisation prête.';
      const title = currentViews.find(v => v.id === job.id)?.title || 'Carte';
      detail = remaining ? `Prochaine carte : ${title} · dans ${format(Math.ceil(remaining / 100) / 10)} s.`
        : `Prochaine carte : ${title}.`;
    } else if (errors) message = 'Chargement arrêté — certains prix sont en erreur.';
    else if (unknownCards) message = 'Certaines cartes de cette page n’ont pas pu être identifiées.';
    else if (!pageViews.length) message = 'En attente de cartes à synchroniser sur cette page.';
    else if (pageViews.every(v => cached(v.id))) {
      message = 'À jour — toutes les cartes de cette page sont en cache.';
      if (settings.autoNext) {
        const pagination = collectionPagination();
        if (pagination && !pagination.loading && pagination.page < pagination.total) {
          const remaining = Math.max(0, nextRequestAt(g, settings) - now);
          detail = `Passage automatique à la page ${pagination.page + 1} / ${pagination.total}${remaining ? ` dans ${format(Math.ceil(remaining / 100) / 10)} s` : ' en attente'}.`;
        } else if (pagination && !pagination.loading) detail = 'Dernière page atteinte. Toutes ses cartes sont en cache.';
      }
    } else message = 'Chargement manuel — utiliser ↻ sur une carte.';
    const setText = (selector, text) => {
      const node = controls.querySelector(selector);
      if (node.textContent !== text) node.textContent = text;
    };
    setText('.wm-sync-status', message);
    setText('.wm-sync-detail', detail);
    const count = recognizedViews.filter(view => cached(view.id)).length;
    setText('.wm-sync-progress', `${count} / ${pageNodes.length} cartes de cette page en cache`);
    controls.querySelector('[role="switch"]').checked = settings.enabled;
    controls.querySelector('.wm-sync-auto-next input').checked = settings.autoNext;
    controls.querySelector('.wm-shared-enabled').checked = settings.sharedEnabled;
    const formSignature = JSON.stringify([settings.sharedUrl, settings.contributorKey]);
    if (shared.formSignature !== formSignature) {
      shared.formSignature = formSignature;
      controls.querySelector('.wm-shared-url').value = settings.sharedUrl;
      controls.querySelector('.wm-shared-key').value = settings.contributorKey;
    }
    setText('.wm-shared-status', settings.sharedEnabled ? shared.message : 'Cache partagé désactivé.');
    const slider = controls.querySelector('input[type="range"]');
    slider.value = String(settings.intervalMs / 1000);
    slider.setAttribute('aria-valuetext', `${format(settings.intervalMs / 1000)} secondes après chaque réponse`);
    setText('output', `${format(settings.intervalMs / 1000)} s`);
    const button = controls.querySelector('.wm-sync-resume');
    button.hidden = !paused && !errors && !resuming;
    button.disabled = !settings.enabled || resuming || busy || !!request || waitingForServer || !storageOK || !navigator.locks;
    setText('.wm-sync-resume', resuming ? 'Reprise…' : 'Reprendre le chargement');
    button.title = waitingForServer ? 'Le délai Retry-After doit être écoulé.'
      : 'Réessayer les prix manquants avec le délai choisi. Un nouveau refus arrêtera les appels.';
  }
  function requestRefresh(view) {
    if (!syncSettings().enabled || automationBlocked() || activeId === view.id || manual.has(view.id) || gate().until > Date.now()) return;
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
    if (!syncSettings().enabled) return null;
    const candidates = [...views.values()].filter(onCollectionPage);
    const waiting = id => syncSettings().sharedEnabled && (shared.waiting.get(id) || 0) > Date.now();
    for (const [id, requested] of manual) {
      if (!candidates.some(v => v.id === id)) { manual.delete(id); continue; }
      if ((cached(id)?.fetchedAt || 0) > requested) { manual.delete(id); continue; }
      if (waiting(id)) continue;
      return { id, requested };
    }
    if (!AUTO_LOAD) return null;
    const view = candidates.find(v => !cached(v.id) && !failures.has(v.id) && !waiting(v.id));
    return view ? { id: view.id, requested: 0 } : null;
  }

  function collectionPagination() {
    // Les deux paginations natives (haut et bas) pilotent le même état React.
    // N'utiliser qu'un bouton, sans recréer les requêtes ni toucher aux filtres.
    for (const next of document.querySelectorAll('main button')) {
      if (!/^Suivant(?:\s*→)?$/.test(next.textContent.trim())) continue;
      const label = [...next.parentElement.querySelectorAll('span')]
        .map(el => el.textContent.trim().match(/^Page\s+(\d+)\s*\/\s*(\d+)$/)).find(Boolean);
      if (label) return { next, page: Number(label[1]), total: Number(label[2]), loading: false };
      if (next.disabled) return { next, loading: true };
    }
    return null;
  }
  function pageCardNodes() {
    return [...document.querySelectorAll('main h3')].map(heading => heading.closest('div.cursor-pointer'))
      .filter(node => node?.parentElement?.classList.contains('group') && onCollectionPage({ node, cardNode: node }));
  }
  function nextPageReady() {
    const pagination = collectionPagination();
    const modal = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .fixed h2')]
      .some(el => el.getClientRects().length > 0);
    if (!syncSettings().autoNext || pageError || collectionLoads.size || modal || !pagination
        || pagination.loading || pagination.page >= pagination.total || pagination.next.disabled) {
      pageCandidate = null;
      return null;
    }
    const nodes = pageCardNodes();
    // Toute carte de cette page non reconnue, manquante ou en erreur bloque
    // Suivant, même si elle est située plus bas que la zone affichée.
    if (!nodes.length || nodes.some(node => {
      const view = views.get(node);
      const info = cardInfo(node.querySelector('h3'), node);
      return !view || !info || view.id !== info.id || !cached(view.id) || failures.has(view.id) || manual.has(view.id);
    })) { pageCandidate = null; return null; }
    const signature = JSON.stringify([pagination.page, pagination.total, ...nodes.map(node => views.get(node).id)]);
    if (pageCandidate?.signature !== signature) pageCandidate = { signature, since: Date.now() };
    // Laisser le rendu et le défilement natifs se stabiliser avant le clic.
    return Date.now() - pageCandidate.since >= 500 ? pagination : null;
  }
  async function advanceCollectionPage(pagination) {
    const target = pagination.page + 1;
    const beforeSerial = collectionSerial;
    const started = Date.now();
    const expiresAt = started + REQUEST_TIMEOUT_MS + 1000;
    if (!write(GATE_KEY, { ...gate(), waitFrom: 0,
      request: { kind: 'page', title: `Page ${target} / ${pagination.total}`, expiresAt },
      next: expiresAt + syncSettings().intervalMs })) return;
    activePage = target;
    pageCandidate = null;
    renderControls();
    try {
      pagination.next.click();
      let settledSince = 0;
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (location.pathname !== '/collection') return;
        const load = lastCollectionLoad;
        if (load?.serial > beforeSerial && load.done) {
          if (!load.ok) throw new Error('Le chargement de la page a échoué.');
          if (load.page !== target) throw new Error('La collection a changé pendant le passage de page.');
          const current = collectionPagination();
          if (!collectionLoads.size && current && !current.loading && current.page === target) {
            settledSince ||= Date.now();
            if (Date.now() - settledSince >= 500) { scan(); return; }
            // Un timer d'arrière-plan peut se réveiller après le délai maximal.
            // La page confirmée a priorité : terminer sa stabilisation, sans
            // transformer le retard du navigateur en erreur de chargement.
            continue;
          } else settledSince = 0;
        }
        if (Date.now() - started >= REQUEST_TIMEOUT_MS) {
          throw new Error('La nouvelle page ne répond pas ou son affichage n’a pas pu être confirmé.');
        }
      }
    } catch (error) {
      pageError = error.message || 'Le changement de page a échoué.';
    } finally {
      // Le même verrou couvre le clic et la réponse native complète. Le délai
      // repart seulement ensuite, même si la prochaine page est déjà en cache.
      const finished = Date.now();
      write(GATE_KEY, { ...gate(), request: null, waitFrom: finished,
        next: finished + syncSettings().intervalMs });
      activePage = null;
      renderAll();
    }
  }

  async function pump() {
    const settings = syncSettings();
    if (!settings.enabled || busy || collectionLoads.size || !storageOK || !navigator.locks || location.pathname !== '/collection') return;
    if (!await sharedPass()) return;
    if (busy || !syncSettings().enabled || (syncSettings().autoNext && pageError) || automationBlocked()) return;
    const g = gate();
    if (Date.now() < Math.max(nextRequestAt(g), g.until, g.retryAfterUntil) || (!choose() && !nextPageReady())) return;
    busy = true;
    try {
      // ifAvailable évite d'accumuler une file d'onglets en attente.
      await navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
        const settings = syncSettings();
        if (!lock || !settings.enabled || (settings.autoNext && pageError) || automationBlocked() || collectionLoads.size || !storageOK || location.pathname !== '/collection') return;
        let current = gate();
        if (Date.now() < Math.max(nextRequestAt(current), current.until, current.retryAfterUntil)) return;
        const job = choose(); // Relire le cache APRES avoir obtenu le verrou.
        if (!job) {
          const pagination = nextPageReady();
          if (pagination) await advanceCollectionPage(pagination);
          return;
        }
        const sharedResult = await sharedBeforeSite(job);
        if (!sharedResult.proceed) { renderAll(); return; }
        current = gate();
        if (!syncSettings().enabled || automationBlocked() || location.pathname !== '/collection'
            || Date.now() < Math.max(nextRequestAt(current), current.until, current.retryAfterUntil)
            || choose()?.id !== job.id) {
          await finishSharedLease(sharedResult.lease, false);
          return;
        }
        const started = Date.now();
        const title = [...views.values()].find(v => v.id === job.id)?.title || 'Carte';
        // Réservation conservatrice si l'onglet est fermé avant le finally.
        const expiresAt = started + REQUEST_TIMEOUT_MS + 1000;
        if (!write(GATE_KEY, { ...current, waitFrom: 0,
          request: { id: job.id, title, expiresAt }, next: expiresAt + syncSettings().intervalMs })) return;
        activeId = job.id;
        renderAll();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let success = false;
        try {
          const response = await nativeFetch(`/api/marketplace/cards/${job.id}/sales?scope=summary`, {
            credentials: 'same-origin', signal: controller.signal,
          });
          if (!response.ok) {
            await pause(response);
            throw new Error(`HTTP ${response.status}. Appels temporairement suspendus.`);
          }
          if (!save(job.id, await response.json())) throw new Error('Réponse invalide ou cache indisponible.');
          success = true;
        } catch (error) {
          failures.set(job.id, error.message || 'Erreur réseau.');
          // Aucun réessai automatique sur cette carte. Les anciennes valeurs restent visibles.
          const currentGate = gate();
          write(GATE_KEY, { ...currentGate, until: Math.max(currentGate.until, Date.now() + 60_000) });
        } finally {
          clearTimeout(timer);
          // Fin réelle : corps JSON reçu, traité ou en erreur. Le verrou est
          // encore détenu ; aucun autre onglet ne peut lancer la carte suivante.
          const finished = Date.now();
          const latest = gate();
          write(GATE_KEY, { ...latest, request: null, waitFrom: finished,
            next: finished + syncSettings().intervalMs });
          manual.delete(job.id);
          activeId = null;
          renderAll();
        }
        await finishSharedLease(sharedResult.lease, success);
      });
    } catch (error) { console.warn('[WikiMasters prix]', error); }
    finally { busy = false; renderControls(); }
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
      .wm-market-controls{box-sizing:border-box;position:sticky;top:12px;z-index:40;width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:14px 16px;margin:12px 0;border:1px solid #ffffff24;border-radius:10px;background:#111b17;color:#d8e6df;font:12px/1.5 system-ui,sans-serif;max-width:100%}
      .wm-sync-summary{display:flex;flex:1 1 240px;min-width:0;flex-direction:column;gap:4px;overflow-wrap:anywhere}
      .wm-sync-status{color:#a4eccf;font-size:13px}.wm-sync-detail{color:#c1d2c8}.wm-sync-progress{color:#91a89b;font-size:11px}
      .wm-sync-settings{display:flex;flex:0 1 270px;min-width:0;max-width:100%;flex-direction:column;gap:10px}
      .wm-sync-toggle{display:flex;align-items:center;gap:8px;cursor:pointer}
      .wm-sync-toggle input{appearance:none;position:relative;flex:none;width:34px;height:20px;margin:0;border:1px solid #ffffff40;border-radius:20px;background:#344039;cursor:pointer}
      .wm-sync-toggle input:after{content:'';position:absolute;left:3px;top:3px;width:12px;height:12px;border-radius:50%;background:#d8e6df}
      .wm-sync-toggle input:checked{background:#1c7858;border-color:#39e2a8}.wm-sync-toggle input:checked:after{left:17px;background:#fff}
      .wm-sync-auto-next{display:flex;align-items:flex-start;gap:8px;cursor:pointer}.wm-sync-auto-next input{flex:none;margin:3px 0 0;accent-color:#39e2a8}.wm-sync-auto-next span{min-width:0}
      .wm-shared{border-top:1px solid #ffffff20;padding-top:8px}.wm-shared summary{cursor:pointer;color:#a4eccf}.wm-shared[open] summary{margin-bottom:8px}
      .wm-shared-form{display:flex;flex-direction:column;gap:8px;margin-top:8px}.wm-shared-form label{display:flex;flex-direction:column;gap:4px}
      .wm-shared-form input{box-sizing:border-box;min-width:0;width:100%;padding:6px;border:1px solid #ffffff30;border-radius:6px;background:#19251e;color:inherit;font:inherit}
      .wm-shared-info{margin:8px 0;font-size:11px;color:#91a89b}.wm-shared-advanced{font-size:11px}.wm-shared-form p{margin:0;font-size:10px;color:#91a89b}.wm-shared-status{font-size:10px;color:#91a89b;overflow-wrap:anywhere}
      .wm-sync-delay{display:flex;flex-direction:column;gap:6px}.wm-sync-delay>span{display:flex;justify-content:space-between;gap:12px}.wm-sync-delay output{font-weight:700;color:#a4eccf;white-space:nowrap}
      .wm-sync-delay input{width:100%;min-width:0;margin:0;accent-color:#39e2a8;cursor:pointer}
      .wm-market-controls input:focus-visible{outline:2px solid #39e2a8;outline-offset:3px}
      .wm-market-controls [hidden]{display:none!important}
      @media(max-width:640px){.wm-sync-settings{flex-basis:100%;width:100%}.wm-market-controls{top:56px}}
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
      if (e.key === SETTINGS_KEY && !syncSettings().enabled) manual.clear();
      if (e.key === SETTINGS_KEY) {
        pageCandidate = null;
        if (!syncSettings().autoNext) pageError = '';
      }
      const revision = gate().resumeRevision;
      if (revision > lastResumeRevision) {
        lastResumeRevision = revision;
        failures.clear();
        manual.clear();
        pageError = '';
        pageCandidate = null;
      }
      renderAll();
    });
    document.addEventListener('visibilitychange', () => { scheduleScan(); void pump(); });
    document.addEventListener('scroll', () => { pageCandidate = null; }, { capture: true, passive: true });
    // Contrôle local, sans appel réseau : gère aussi pagination et navigation SPA.
    setInterval(renderAll, 1000);
    setInterval(() => { renderControls(); void pump(); }, 250);
    scan();
  }
  start();
})();
