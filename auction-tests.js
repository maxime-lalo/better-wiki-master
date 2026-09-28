// Tests isolés : aucun accès au serveur réel. page.wikiTestSource = userscript.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 900, height: 700 } });
  const p = await context.newPage();
  p.setDefaultTimeout(5000);
  const requests = [];
  const results = [];
  let mode = 'success';
  const assert = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const cardId = '00000000-0000-0000-0000-000000000001';
  const ownedId = '00000000-0000-0000-0000-000000000011';
  const auctionId = '00000000-0000-0000-0000-000000000099';
  const fixture = `<!doctype html><html><head><meta charset="UTF-8"></head><body>
    <main><input id="filter" value="Pierre"><p>Page 3 / 60</p><div id="cards"></div></main>
    <script>
      window.card={id:'${cardId}',wikipedia_title:'Pierre <test> & Compagnie',rarity:'L'};
      window.items=[{id:'${ownedId}',card}, {id:'00000000-0000-0000-0000-000000000012',card}];
      window.counts={balance:0,reloads:0,navigations:0,closeSale:0,closeDetail:0};
      window.dispatch=fn=>{window.items=fn(window.items);document.querySelectorAll('[data-owned]').forEach(e=>{if(!items.some(i=>i.id===e.dataset.owned))e.remove()});};
      for(const item of items){const e=document.createElement('p');e.dataset.owned=item.id;e.textContent=item.card.wikipedia_title;document.querySelector('#cards').append(e);}
      window.otherNode=document.querySelectorAll('[data-owned]')[1];
      window.addEventListener('wikimasters:wikibidous-balance-refresh',()=>window.counts.balance++);
      window.router={push:href=>{window.counts.navigations++;history.pushState(null,'',href);}};
      window.mount=(kind='valid')=>{
        document.querySelector('#detail')?.remove();document.querySelector('#sale')?.remove();
        const detail=document.createElement('div');detail.id='detail';detail.textContent='Détail de la carte';document.body.append(detail);
        const sale=document.createElement('div');sale.id='sale';sale.innerHTML='<h2>Mettre aux enchères</h2><p id="error"></p>';document.body.append(sale);
        const h=sale.querySelector('h2');
        const closeSale=()=>{window.counts.closeSale++;sale.remove()};
        const closeDetail=()=>{window.counts.closeDetail++;detail.remove()};
        const props={card,userCardId:'${ownedId}',onClose:closeSale};
        const hook={memoizedState:window.items,queue:{lastRenderedState:window.items,dispatch:window.dispatch}};
        if(kind==='ambiguous')hook.next={memoizedState:window.items,queue:{dispatch:()=>{}}};
        const collection={memoizedProps:{},memoizedState:hook};
        h.__reactFiber$test={memoizedProps:{},return:{memoizedProps:props,return:{memoizedProps:props,return:{memoizedProps:{...props,onClose:closeDetail},return:collection}}}};
        if(kind==='unknown')delete h.__reactFiber$test;
        window.submit=async (overrides={})=>{
          const body={card_id:'${ownedId}',base_amount:1234,duration_minutes:60,...overrides};
          try{
            const response=await fetch('/api/marketplace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            window.lastResponse={status:response.status,body:await response.clone().text()};
            const data=await response.json();
            if(!response.ok){sale.querySelector('#error').textContent=data.error||'Erreur';return;}
            if(data.auction_id){
              window.counts.balance++;
              closeSale();window.counts.reloads++;await fetch('/api/my-collection?page=2&stats=0');
              window.router.push('/marketplace/'+data.auction_id);
            }else closeSale();
          }catch{sale.querySelector('#error').textContent='Erreur réseau';}
        };
      };
      window.mount();
    </script></body></html>`;
  await context.route('**/*', route => {
    const req = route.request();
    if (!req.url().includes('/api/')) return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    requests.push({ method: req.method(), url: req.url(), body: req.postData() });
    if (req.method() === 'POST' && req.url().endsWith('/api/marketplace')) {
      if (mode === 'network') return route.abort();
      if (mode === 'error') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Limite atteinte"}' });
      if (mode === 'invalid') return route.fulfill({ status: 200, contentType: 'application/json', body: 'oops' });
      if (mode === 'missing-id') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ auction_id: auctionId }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const reset = async () => {
    await p.goto('https://www.wiki-masters.com/collection');
    requests.length = 0;
  };
  try {
    await p.clock.install();
    await p.addInitScript({ content: page.wikiTestSource });
    await reset();
    const beforeHistory = await p.evaluate(() => history.length);
    // Simuler la suppression du conteneur par l'hydratation Next.js.
    await p.evaluate(() => document.querySelector('.wm-toast-region')?.remove());
    await p.evaluate(() => window.submit());
    assert(requests.length === 1 && requests[0].method === 'POST', 'Un seul POST : aucune requête de rechargement de collection');
    assert(JSON.parse(requests[0].body).card_id === ownedId && JSON.parse(requests[0].body).base_amount === 1234
      && JSON.parse(requests[0].body).duration_minutes === 60, 'Exemplaire, montant et durée envoyés sans modification');
    assert(await p.evaluate(() => window.items.length === 1 && window.otherNode.isConnected), 'Retrait du seul exemplaire vendu ; doublon et nœud DOM conservés');
    assert(await p.evaluate(() => window.counts.reloads === 0 && window.counts.navigations === 0 && window.counts.balance === 1), 'Ni onListed ni navigation ; événement de solde conservé une seule fois');
    assert(await p.locator('#sale,#detail').count() === 0, 'Formulaire et détail fermés après succès');
    assert(p.url().endsWith('/collection') && await p.evaluate(n => history.length === n, beforeHistory)
      && await p.locator('#filter').inputValue() === 'Pierre' && await p.getByText('Page 3 / 60').isVisible(), 'URL, historique, filtre et page préservés');
    assert(await p.locator('.wm-toast span').innerText() === 'Pierre <test> & Compagnie a bien été mise aux enchères pour 1\u202f234 wikibidous', 'Toast exact : titre et montant réel formaté');
    assert(await p.locator('.wm-toast test').count() === 0, 'Titre rendu comme texte, sans injection HTML');
    assert(await p.locator('.wm-toast-region').getAttribute('aria-live') === 'polite', 'Toast accessible et région recréée après hydratation');
    assert(await p.evaluate(id => window.lastResponse.status === 200 && JSON.parse(window.lastResponse.body).auction_id === id, auctionId), 'Statut et corps réseau originaux préservés');
    await p.setViewportSize({ width: 390, height: 700 });
    assert(await p.locator('.wm-toast').evaluate(e => e.getBoundingClientRect().right <= innerWidth && e.scrollWidth <= e.clientWidth), 'Toast sans débordement sur mobile');
    await p.getByRole('button', { name: 'Fermer la confirmation' }).click();
    assert(await p.locator('.wm-toast').count() === 0, 'Toast refermable manuellement');
    await p.evaluate(id => window.router.push('/marketplace/' + id), auctionId);
    assert(p.url().endsWith('/marketplace/' + auctionId), 'Navigation manuelle ultérieure vers cette enchère autorisée');
    await reset();
    await p.evaluate(() => window.submit());
    await p.clock.runFor(8100);
    assert(await p.locator('.wm-toast').count() === 0, 'Toast fermé automatiquement après huit secondes');
    for (const errorMode of ['error', 'network', 'invalid']) {
      mode = errorMode;
      await reset();
      await p.evaluate(() => window.submit());
      assert(await p.locator('#sale').isVisible() && await p.locator('#detail').isVisible()
        && await p.locator('[data-owned]').count() === 2 && await p.locator('.wm-toast').count() === 0
        && await p.locator('#error').innerText() === (errorMode === 'error' ? 'Limite atteinte' : 'Erreur réseau'),
        `${errorMode} : erreur native, modales et cartes conservées, aucun faux toast`);
    }
    mode = 'missing-id';
    await reset();
    await p.evaluate(() => window.submit());
    assert(await p.locator('.wm-toast').count() === 0 && await p.locator('[data-owned]').count() === 2,
      'Pas de retrait ni de confirmation sans identifiant d’enchère');
    mode = 'success';
    for (const kind of ['unknown', 'ambiguous']) {
      await reset();
      await p.evaluate(kind => { window.mount(kind); return window.submit(); }, kind);
      assert(p.url().endsWith('/marketplace/' + auctionId) && await p.locator('.wm-toast').count() === 0
        && await p.evaluate(() => window.items.length === 2), `${kind} : structure inconnue ou ambiguë, repli sur le site sans retrait arbitraire`);
    }
    await reset();
    await p.evaluate(() => window.submit({ card_id: '00000000-0000-0000-0000-000000000088' }));
    assert(p.url().endsWith('/marketplace/' + auctionId) && await p.locator('[data-owned]').count() === 2,
      'Un autre exemplaire dans le POST ne modifie pas la carte du formulaire');
    await reset();
    await p.evaluate(() => { history.replaceState(null, '', '/marketplace'); return window.submit(); });
    assert(p.url().endsWith('/marketplace/' + auctionId), 'Aucune interception des mises en vente hors collection');
    await reset();
    const raw = await p.evaluate(async () => {
      document.querySelector('#sale').remove();
      return (await fetch('/api/marketplace', { method: 'POST', body: JSON.stringify({ card_id: '00000000-0000-0000-0000-000000000011', base_amount: 10 }) })).json();
    });
    assert(raw.auction_id === auctionId, 'POST sans formulaire : réponse JSON inchangée');
    return { passed: results.length, results, realRequests: 0 };
  } catch (error) { return { error: error.message, passed: results, url: p.url(), text: await p.locator('body').innerText() }; }
  finally { await context.close(); }
}
