// À exécuter via le MCP Playwright (browser_run_code_unsafe).
// Injecter d'abord le texte du userscript dans page.wikiTestSource.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 900, height: 650 } });
  const results = [];
  const requests = [];
  const idA = '00000000-0000-0000-0000-000000000001';
  const idB = '00000000-0000-0000-0000-000000000002';
  const idC = '00000000-0000-0000-0000-000000000003';
  const start = Date.now();
  let mode = 'normal';
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const fixture = (id = idA) => `<!doctype html><html><head><style>
    body{margin:20px;background:#101411;color:white}main{display:flex;gap:25px;flex-wrap:wrap}.group{position:relative}
    .cursor-pointer{width:160px;height:200px;border:1px solid #444}.far{margin-top:2000px;width:100%}
    </style></head><body><main>
    <div class="relative isolate group"><div class="cursor-pointer"><span>L</span><h3>Alpha</h3></div></div>
    <div class="relative isolate group"><div class="cursor-pointer"><span>UR</span><h3>Alpha</h3></div></div>
    <div class="relative isolate group far"><div class="cursor-pointer"><span>L</span><h3>Beta</h3></div></div>
    </main><script>
    Object.defineProperty(document,'hidden',{get:()=>false});
    document.querySelectorAll('h3').forEach((h,i)=>h.__reactFiber$test={memoizedProps:{card:{id:i<2?'${id}':'${idB}',rarity:i===1?'UR':'L',wikipedia_title:h.textContent}}});
    </script></body></html>`;
  await context.route('**/*', async route => {
    const req = route.request();
    const url = req.url().replace('https://www.wiki-masters.com', '');
    if (url.includes('/api/')) {
      const id = url.split('/')[4];
      requests.push({ id, url });
      if (mode === 'automation-limit') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"automation_limit","error":"Automatisation refusée"}' });
      if (mode === '429') return route.fulfill({ status: 429, headers: { 'Retry-After': '900' }, body: '{}' });
      if (mode === 'invalid') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"summary":{"L":{"average":"wrong"}}}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        summary: id === idB ? {} : { L: { average: mode === 'updated' ? 999 : 402, latest: 408, count: 148 }, UR: { average: 74, latest: 180, count: 23 } },
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fixture(url.includes('?third') ? idC : idA) });
  });
  const p = await context.newPage();
  const settle = async target => {
    // Autorise la réponse simulée et les promises de verrouillage à se terminer.
    for (let i = 0; i < 8; i++) await target.evaluate(() => new Promise(r => MessageChannel ? (() => {
      const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); c.port2.close(); r(); }; c.port2.postMessage(0);
    })() : r()));
  };
  const advance = async (ms, target = p) => { await target.clock.runFor(ms); await settle(target); };
  try {
    await p.clock.install({ time: start });
    await p.addInitScript({ content: page.wikiTestSource });
    await p.goto('https://www.wiki-masters.com/collection');
    await advance(1300);
    assert(await p.locator('.wm-market').count() === 3, 'Trois encarts créés, sans modifier les cartes');
    assert(requests.length === 1, 'Une requête pour deux exemplaires du même ID avant le délai suivant');
    assert(await p.locator('.wm-market strong').nth(0).textContent() === '402', 'Moyenne de la rareté L affichée');
    assert(await p.locator('.wm-market strong').nth(1).textContent() === '74', 'Rareté UR distincte avec la même réponse');
    assert((await p.locator('.wm-market').first().innerText()).includes('148 ventes'), 'Nombre de ventes affiché');
    assert(await p.locator('.wm-market b').first().textContent() === '408', 'Dernière vente affichée');
    await advance(1500);
    assert(requests.length === 2 && requests[1].id === idB, 'Carte en bas de page chargée sans défilement');
    await p.reload();
    await advance(10000);
    assert(requests.length === 2, 'Rechargement : données conservées, aucun appel pour les cartes en cache');
    await p.locator('.far').scrollIntoViewIfNeeded();
    await advance(1500);
    assert(requests.length === 2 && requests[1].id === idB, 'Le défilement ne recharge pas les prix déjà en cache');
    assert((await p.locator('.wm-market').last().innerText()).includes('0 ventes'), 'Absence de ventes affichée et mise en cache');
    await p.evaluate(() => scrollTo(0, 0));
    await p.locator('.wm-market button').first().click();
    await advance(100);
    await advance(1500);
    assert(requests.length === 3, 'Actualisation ciblée : exactement un appel supplémentaire');
    await advance(5000);
    mode = '429';
    await p.locator('.wm-market button').first().click();
    await settle(p);
    await advance(1000);
    assert(requests.length === 4, 'Réponse 429 simulée reçue');
    assert(await p.locator('.wm-market strong').first().textContent() === '402', 'Ancien prix conservé après erreur');
    assert(await p.locator('.wm-market button').first().isDisabled(), 'Bouton bloqué pendant Retry-After');
    assert(await p.getByRole('button', { name: 'Reprendre le chargement', exact: true }).isDisabled(), 'Reprise manuelle désactivée pendant Retry-After');
    await p.getByRole('button', { name: 'Reprendre le chargement', exact: true }).evaluate(b => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle(p);
    assert(requests.length === 4 && await p.evaluate(() => JSON.parse(localStorage.getItem('wm-market-v1:gate')).retryAfterUntil > Date.now()), 'Le gestionnaire de reprise protège aussi le délai serveur');
    await p.clock.fastForward(600000);
    await settle(p);
    assert(requests.length === 4 && await p.locator('.wm-market button').first().isDisabled(), 'Retry-After de quinze minutes respecté, aucun retry automatique');
    await p.clock.fastForward(302000);
    await settle(p);
    await advance(1100);
    assert(requests.length === 4, 'Fin de la pause : cache permanent, toujours aucun appel automatique');
    mode = 'updated';
    await p.locator('.wm-market button').first().click();
    await settle(p);
    await advance(1000);
    assert(await p.locator('.wm-market strong').first().textContent() === '999', 'Actualisation explicite réussie après la pause');
    await advance(5000);
    mode = 'invalid';
    await p.locator('.wm-market button').first().click();
    await settle(p);
    await advance(1000);
    assert(await p.locator('.wm-market strong').first().textContent() === '999', 'Réponse malformée ne remplace pas le cache');
    mode = 'normal';
    await p.evaluate(() => localStorage.removeItem('wm-market-v1:gate'));
    const beforePassive = requests.length;
    await p.evaluate(async id => { await fetch('/api/marketplace/cards/' + id + '/sales?scope=summary'); }, idC);
    await settle(p);
    assert(requests.length === beforePassive + 1 && await p.evaluate(id => !!localStorage.getItem('wm-market-v1:' + id), idC), 'Observation passive : la réponse native alimente le cache sans appel additionnel');
    await p.evaluate(id => localStorage.removeItem('wm-market-v1:' + id), idC);
    const p2 = await context.newPage();
    const sharedTime = await p.evaluate(() => Date.now());
    await p2.clock.install({ time: sharedTime });
    await p2.addInitScript({ content: page.wikiTestSource });
    await p.goto('https://www.wiki-masters.com/collection?third');
    await p2.goto('https://www.wiki-masters.com/collection?third');
    const beforeTabs = requests.length;
    await Promise.all([advance(1500, p), advance(1500, p2)]);
    await settle(p); await settle(p2);
    assert(requests.length === beforeTabs + 1, 'Deux onglets : verrou partagé, une seule requête pour la même carte');
    mode = 'automation-limit';
    await advance(2000);
    await p.locator('.wm-market button').first().click();
    await settle(p);
    await advance(1000);
    assert(await p.evaluate(() => JSON.parse(localStorage.getItem('wm-market-v1:automation-block'))?.code === 'automation_limit'), 'Refus automation_limit enregistré durablement');
    assert(await p.locator('.wm-market button').first().isDisabled() && await p2.locator('.wm-market button').first().isDisabled(), 'Refus partagé : les boutons sont désactivés dans les deux onglets');
    assert(await p.locator('.wm-market strong').first().textContent() === '402', 'Prix conservé après le refus explicite');
    await p.evaluate(id => localStorage.removeItem('wm-market-v1:' + id), idB);
    const afterRefusal = requests.length;
    await p.clock.fastForward(7200000);
    await p.reload();
    await p.locator('.far').scrollIntoViewIfNeeded();
    await advance(2000);
    assert(requests.length === afterRefusal, 'Aucun appel pour une carte non cachée après deux heures et un rechargement');
    mode = 'updated';
    await p.evaluate(async id => { await fetch('/api/marketplace/cards/' + id + '/sales?scope=summary'); }, idC);
    await settle(p);
    assert(await p.locator('.wm-market strong').first().textContent() === '999'
      && await p.locator('.wm-market button').first().isDisabled(), 'Une réponse native actualise le cache sans lever le refus d’automatisation');
    await p.evaluate(() => { const key = 'wm-market-v1:gate'; const g = JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify({ ...g, until: 8640000000000000 })); });
    await advance(1100);
    assert(await p.getByRole('button', { name: 'Reprendre le chargement', exact: true }).isEnabled(), 'Une ancienne pause locale sans expiration peut être reprise manuellement');
    const cacheBeforeResume = await p.evaluate(id => localStorage.getItem('wm-market-v1:' + id), idC);
    mode = 'automation-limit';
    const beforeResume = requests.length;
    await p.getByRole('button', { name: 'Reprendre le chargement', exact: true }).click();
    await settle(p);
    await p.locator('.far').scrollIntoViewIfNeeded();
    await advance(100);
    assert(requests.length === beforeResume, 'La reprise conserve le délai minimal d’une seconde');
    await advance(1500);
    assert(requests.length === beforeResume + 1 && await p.evaluate(() => JSON.parse(localStorage.getItem('wm-market-v1:automation-block'))?.code === 'automation_limit'), 'Un nouveau refus après reprise arrête immédiatement la file');
    await advance(5000);
    assert(requests.length === beforeResume + 1, 'Aucune boucle de réessai après un nouveau refus');
    mode = 'updated';
    await p.getByRole('button', { name: 'Reprendre le chargement', exact: true }).click();
    await settle(p);
    await p.locator('.far').scrollIntoViewIfNeeded();
    await advance(1500);
    assert(requests.length === beforeResume + 2 && await p.evaluate(id => !!localStorage.getItem('wm-market-v1:' + id), idB), 'Reprise réussie : seul le prix manquant est chargé');
    assert(await p.evaluate(id => localStorage.getItem('wm-market-v1:' + id), idC) === cacheBeforeResume, 'La reprise ne vide pas les prix déjà en cache');
    assert(await p2.evaluate(() => !JSON.parse(localStorage.getItem('wm-market-v1:automation-block'))), 'Reprise partagée entre les onglets');
    return { passed: results.length, results, simulatedRequests: requests.length, liveApiRequests: 0 };
  } catch (error) {
    return { error: error.message, passed: results, requests, ui: await p.locator('.wm-market').allTextContents() };
  } finally { await context.close(); }
}
