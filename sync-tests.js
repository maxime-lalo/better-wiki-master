// File de synchronisation : réponses à corps différé, sans serveur réel.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 800 } });
  const results = [];
  const errors = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const ids = [1, 2, 3].map(n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0'));
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:20px;background:#101411;color:#e4eee8;font:14px system-ui}main{max-width:1000px;margin:auto;min-height:2000px}h1{font-size:28px}#grid{display:flex;flex-wrap:wrap;gap:20px}.group{width:160px}.cursor-pointer{height:140px;padding:12px;box-sizing:border-box;border:1px solid #51645a;border-radius:12px;background:#1d3328}h3{margin:20px 0 4px}
    </style></head><body><main><h1>Collection</h1><div id="grid"></div></main><script>
      window.addCard=(id,title)=>{const node=document.createElement('div');node.className='relative isolate group';node.innerHTML='<div class="cursor-pointer"><span>L</span><h3></h3></div>';const h=node.querySelector('h3');h.textContent=title;h.__reactFiber$test={memoizedProps:{card:{id,rarity:'L',wikipedia_title:title}}};document.querySelector('#grid').append(node);};
      window.addCard('${ids[0]}','Carte Alpha');window.addCard('${ids[1]}','Carte Bêta');
    </script></body></html>`;
  let externalRequests = 0;
  await context.route('**/*', route => {
    if (route.request().resourceType() !== 'document') { externalRequests++; return route.abort(); }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
  });
  await context.addInitScript({ content: `
    window.testHidden=false;Object.defineProperty(document,'hidden',{get:()=>window.testHidden});
    window.testCalls=[];window.testPending=[];window.testStatus=200;
    window.fetch=async (input)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.pathname.match(/^\\/api\\/marketplace\\/cards\\/[^/]+\\/sales$/))throw new Error('Requête non prévue');
      const call={id:url.pathname.split('/')[4],startedAt:Date.now(),headersAt:Date.now()};
      window.testCalls.push(call);
      const stream=new ReadableStream({start(controller){window.testPending.push({call,controller});}});
      return new Response(stream,{status:window.testStatus,headers:{'Content-Type':'application/json',...(window.testStatus===429?{'Retry-After':'900'}:{})}});
    };
    window.finishBody=()=>{
      const {call,controller}=window.testPending.shift();call.finishedAt=Date.now();
      controller.enqueue(new TextEncoder().encode(JSON.stringify({summary:{L:{average:42,count:2,latest:40}}})));controller.close();return call.finishedAt;
    };
  ` + page.wikiTestSource });
  const p = await context.newPage();
  p.setDefaultTimeout(5000);
  p.on('pageerror', error => errors.push(error.message));
  const settle = async target => {
    for (let i = 0; i < 10; i++) await target.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel(); channel.port1.onmessage = () => {
        channel.port1.close(); channel.port2.close(); resolve();
      }; channel.port2.postMessage(0);
    }));
  };
  const advance = async (ms, target = p) => { await target.clock.runFor(ms); await settle(target); };
  const calls = target => target.evaluate(() => window.testCalls);
  const banner = target => target.locator('#wm-market-controls');
  const toggle = target => target.getByRole('switch', { name: 'Synchronisation des prix' });
  const slider = target => target.getByRole('slider', { name: 'Délai après chaque réponse (secondes)' });
  const delay = (seconds, target = p) => slider(target).evaluate((el, seconds) => {
    el.value = String(seconds); el.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  try {
    await p.clock.install();
    await p.goto('https://www.wiki-masters.com/collection');
    assert(await banner(p).isVisible() && await slider(p).inputValue() === '1' && await toggle(p).isChecked(), 'Bandeau permanent, activé par défaut, délai initial d’une seconde');
    await advance(300);
    assert((await calls(p)).length === 1 && (await banner(p).innerText()).includes('en cours — Carte Alpha'), 'Requête active identifiée par le nom de la carte');
    await advance(5000);
    assert((await calls(p)).length === 1 && await p.evaluate(() => window.testCalls[0].finishedAt === undefined), 'Des en-têtes reçus ne suffisent pas : attendre le corps de la réponse, sans lancer B');
    await delay(3);
    await advance(2000);
    assert((await calls(p)).length === 1, 'Modifier le délai pendant une requête ne lance pas la suivante');
    const endA = await p.evaluate(() => window.finishBody());
    await settle(p);
    assert((await banner(p).innerText()).includes('Prochaine carte : Carte Bêta')
      && (await banner(p).innerText()).includes('1 / 2 cartes'), 'Compte à rebours et progression affichés après la réponse complète');
    await advance(2800);
    assert((await calls(p)).length === 1, 'Aucun appel pendant les 2,8 premières secondes APRÈS la fin de A');
    await advance(450);
    const afterA = await calls(p);
    assert(afterA.length === 2 && afterA[1].startedAt - endA >= 3000, 'B démarre au moins trois secondes après la réception du corps de A');
    await delay(5);
    await toggle(p).uncheck();
    assert((await banner(p).innerText()).includes('Arrêt demandé') && await p.evaluate(() => window.testPending.length === 1), 'Désactivation immédiate de la file ; la requête en vol termine normalement');
    await p.evaluate(() => window.finishBody());
    await settle(p);
    await p.evaluate(id => window.addCard(id, 'Carte Gamma'), ids[2]);
    await advance(1000);
    assert((await calls(p)).length === 2 && (await banner(p).innerText()).includes('Synchronisation désactivée')
      && await p.locator('.wm-market button').first().isDisabled(), 'Désactivé : ni chargement automatique ni bouton manuel, cache conservé');
    await p.locator('.wm-market button').first().evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert((await calls(p)).length === 2, 'Le gestionnaire manuel respecte aussi la désactivation');
    await toggle(p).check();
    await delay(2);
    await advance(700);
    assert((await calls(p)).length === 2, 'Réactivation et réduction du délai respectent encore le temps restant');
    await advance(600);
    const afterB = await calls(p);
    assert(afterB.length === 3 && afterB[2].startedAt - afterB[1].finishedAt >= 2000,
      'Le nouveau délai utilise la fin de B, pas la date du changement de curseur');
    await p.evaluate(() => window.finishBody());
    await settle(p);
    assert(await banner(p).isVisible() && (await banner(p).innerText()).includes('À jour')
      && (await banner(p).innerText()).includes('3 / 3 cartes'), 'Bandeau toujours présent quand les cartes visibles sont à jour');
    await p.reload();
    await advance(5000);
    assert((await calls(p)).length === 0 && await slider(p).inputValue() === '2', 'Délai et cache conservés après rechargement, aucun appel superflu');
    await toggle(p).uncheck();
    await p.reload();
    await advance(1000);
    assert(!await toggle(p).isChecked() && (await calls(p)).length === 0, 'Désactivation conservée entre visites');
    await delay(0);
    assert(await slider(p).inputValue() === '1', 'Curseur borné à une seconde minimum');
    await delay(90);
    assert(await slider(p).inputValue() === '30', 'Curseur borné à trente secondes maximum');
    await p.setViewportSize({ width: 390, height: 844 });
    assert(await banner(p).evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth), 'Bandeau et contrôles sans débordement à 390 px');
    await p.evaluate(() => scrollTo(0, 700));
    assert(await banner(p).evaluate(el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom < innerHeight), 'Bandeau maintenu visible pendant le défilement');
    await p.evaluate(() => history.pushState(null, '', '/settings'));
    await advance(300);
    assert(await banner(p).count() === 0, 'Le bandeau reste limité à la collection lors d’une navigation SPA');
    await p.evaluate(() => history.pushState(null, '', '/collection'));
    await advance(300);
    assert(await banner(p).count() === 1, 'Retour à la collection sans duplication des contrôles');

    // Deux onglets avec horloges communes : délai et verrou partagés.
    await p.setViewportSize({ width: 1100, height: 800 });
    await p.evaluate(ids => {
      for (const id of ids) localStorage.removeItem('wm-market-v1:' + id);
      localStorage.removeItem('wm-market-v1:gate');
    }, ids);
    await delay(1);
    await p.reload();
    await p.evaluate(() => scrollTo(0, 0));
    const p2 = await context.newPage();
    p2.setDefaultTimeout(5000);
    p2.on('pageerror', error => errors.push(error.message));
    // Playwright installe l'horloge sur tout le BrowserContext, donc elle est
    // déjà partagée : ne pas l'installer ni l'avancer une seconde fois ici.
    await p2.goto('https://www.wiki-masters.com/collection');
    await p.locator('.cursor-pointer').first().scrollIntoViewIfNeeded();
    await p.evaluate(()=>{window.testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    await toggle(p).check();
    await settle(p); await settle(p2);
    assert((await banner(p2).innerText()).includes('Carte Alpha (autre onglet)') && await toggle(p2).isChecked(), 'L’autre onglet affiche la même carte active et le même interrupteur');
    await delay(4, p2);
    await settle(p);
    assert(await slider(p).inputValue() === '4', 'Le délai choisi dans un autre onglet se répercute immédiatement');
    const advanceBoth = async ms => { await advance(ms, p); await settle(p2); };
    await advanceBoth(5000);
    assert((await calls(p)).length + (await calls(p2)).length === 1, 'Un onglet en arrière-plan et un au premier plan : une seule requête en vol');
    const crossEnd = await p.evaluate(() => window.finishBody());
    await settle(p); await settle(p2);
    await advanceBoth(3800);
    assert((await calls(p)).length + (await calls(p2)).length === 1, 'Aucun onglet ne raccourcit le délai après la réponse du premier');
    await advanceBoth(450);
    const allCalls = [...await calls(p), ...await calls(p2)];
    assert(allCalls.length === 2 && allCalls[1].startedAt - crossEnd >= 4000, 'Le délai de quatre secondes est partagé avant la carte suivante');
    const owner = await p.evaluate(() => window.testPending.length) ? p : p2;
    await owner.evaluate(() => window.finishBody());
    await settle(p); await settle(p2);
    await toggle(p2).uncheck();
    await settle(p);
    assert(!await toggle(p).isChecked(), 'Un autre onglet peut désactiver la synchronisation globale');
    await p2.close();

    // Les commandes utilisateur ne lèvent pas une contrainte Retry-After.
    await p.evaluate(id => { localStorage.removeItem('wm-market-v1:' + id); window.testStatus = 429; }, ids[0]);
    await toggle(p).check();
    await advance(5000);
    await p.evaluate(() => window.finishBody());
    await settle(p);
    const refusedCount = (await calls(p)).length;
    const retryBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('wm-market-v1:gate')).retryAfterUntil);
    await delay(1);
    await toggle(p).uncheck();
    await toggle(p).check();
    await advance(10000);
    assert((await calls(p)).length === refusedCount && await p.evaluate(before => JSON.parse(localStorage.getItem('wm-market-v1:gate')).retryAfterUntil === before, retryBefore)
      && await p.getByRole('button', { name: 'Reprendre le chargement' }).isDisabled(), 'Curseur et interrupteur ne contournent pas Retry-After');
    assert((await banner(p).innerText()).includes('délai demandé par le serveur'), 'Pause serveur explicite dans le bandeau permanent');
    assert(errors.length === 0 && externalRequests === 0, 'Aucune erreur JavaScript et aucun accès réel à l’API');
    return { passed: results.length, results, liveApiRequests: externalRequests };
  } catch (error) {
    return { error: error.message, passed: results, requests: await calls(p), errors,
      layout: await p.evaluate(() => ({ scroll: scrollY, height: innerHeight, hidden: document.hidden,
        cards: [...document.querySelectorAll('.cursor-pointer')].map(el => el.getBoundingClientRect().toJSON()) })),
      text: await p.locator('body').innerText() };
  } finally { await context.close(); }
}
