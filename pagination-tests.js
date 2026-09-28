// Parcours par le bouton natif : viewport uniquement, réponses intégralement simulées.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 800 } });
  const results = [], errors = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  let externalRequests = 0;
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:20px;background:#101411;color:#e4eee8;font:14px system-ui}main{max-width:1000px;margin:auto}
    #grid{display:grid;grid-template-columns:160px 160px;gap:20px}.group{width:160px}.offscreen{grid-column:1;margin-top:1100px}
    .cursor-pointer{height:140px;padding:12px;box-sizing:border-box;border:1px solid #51645a;border-radius:12px;background:#1d3328}h3{margin:20px 0 4px}
  </style></head><body><main><h1>Collection</h1><div class="pager"></div><div id="grid"></div><div class="pager"></div></main><script>
    window.currentPage=1;window.nextClicks=[];
    window.renderPage=(number)=>{
      window.currentPage=number;document.querySelector('#grid').replaceChildren();
      for(let i=1;i<=3;i++){
        const node=document.createElement('div');node.className='group'+(i===3?' offscreen':'');
        node.innerHTML='<div class="cursor-pointer"><span>L</span><h3></h3></div>';
        const h=node.querySelector('h3');const card=window.card(number,i);h.textContent=card.wikipedia_title;h.__reactFiber$test={memoizedProps:{card}};
        document.querySelector('#grid').append(node);
      }
      window.renderPagers(false);
    };
    window.renderPagers=(loading)=>{
      for(const pager of document.querySelectorAll('.pager')){
        pager.innerHTML='<button>← Précédent</button><span>'+(loading?'Chargement…':'Page '+window.currentPage+' / 3')+'</span><button>Suivant →</button>';
        pager.firstElementChild.disabled=loading||window.currentPage===1;
        const next=pager.lastElementChild;next.disabled=loading||window.currentPage===3;
        next.onclick=async()=>{
          const target=window.currentPage+1;window.nextClicks.push({target,at:Date.now()});window.renderPagers(true);
          try{
            const response=await fetch('/api/my-collection?rarity=L&search=conserve&page='+(target-1)+'&stats=0');
            const data=await response.json();if(response.ok&&data.collection)window.renderPage(target);
          }finally{window.renderPagers(false);}
        };
      }
    };
    window.renderPage(1);
  </script></body></html>`;
  await context.route('**/*', route => {
    if (route.request().resourceType() !== 'document') { externalRequests++; return route.abort(); }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
  });
  await context.addInitScript({ content: `
    window.testHidden=false;Object.defineProperty(document,'hidden',{get:()=>window.testHidden});
    window.card=(page,index)=>({id:'00000000-0000-0000-0000-'+String(page*10+index).padStart(12,'0'),rarity:'L',wikipedia_title:'Carte '+page+'-'+index});
    window.testCalls=[];window.testPending=[];window.collectionStatus=200;
    window.fetch=async(input)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      const kind=url.pathname==='/api/my-collection'?'page':'price';
      if(kind==='price'&&!url.pathname.match(/^\\/api\\/marketplace\\/cards\\/[^/]+\\/sales$/))throw new Error('Requête imprévue');
      const call={kind,url:url.href,startedAt:Date.now(),hidden:document.hidden,page:Number(url.searchParams.get('page'))+1};window.testCalls.push(call);
      const stream=new ReadableStream({start(controller){window.testPending.push({call,controller});}});
      const status=kind==='page'?window.collectionStatus:200;
      return new Response(stream,{status,headers:{'Content-Type':'application/json',...(status===429?{'Retry-After':'900'}:{})}});
    };
    window.finish=(kind)=>{
      const index=window.testPending.findIndex(p=>p.call.kind===kind);if(index<0)throw new Error('Pas de réponse en attente : '+kind);
      const {call,controller}=window.testPending.splice(index,1)[0];call.finishedAt=Date.now();
      const data=kind==='price'?{summary:{L:{average:42,count:2,latest:40}}}:{collection:[1,2,3].map(i=>({card:window.card(call.page,i)}))};
      controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));controller.close();return call.finishedAt;
    };
    window.cachePage=(number)=>{for(let i=1;i<=2;i++)localStorage.setItem('wm-market-v1:'+window.card(number,i).id,JSON.stringify({version:1,fetchedAt:Date.now(),summary:{}}));};
  ` + page.wikiTestSource });
  const p = await context.newPage();
  p.setDefaultTimeout(5000);
  p.on('pageerror', error => errors.push(error.message));
  const settle = async () => { for (let i=0;i<10;i++) await p.evaluate(() => new Promise(resolve => {
    const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);
  })); };
  const advance = async ms => { await p.clock.runFor(ms); await settle(); };
  const finish = async kind => { const end=await p.evaluate(kind=>window.finish(kind),kind);await settle();return end; };
  const option = () => p.getByRole('checkbox', { name: 'Passer automatiquement à la page suivante' });
  const toggle = () => p.getByRole('switch', { name: 'Synchronisation des prix' });
  const clicks = () => p.evaluate(() => window.nextClicks.length);
  const calls = () => p.evaluate(() => window.testCalls);
  const reset = async () => {
    await p.evaluate(() => { localStorage.clear();localStorage.setItem('wm-market-v1:sync-settings',JSON.stringify({enabled:false,autoNext:true,intervalMs:1000})); });
    await p.goto('https://www.wiki-masters.com/collection');await advance(300);await p.evaluate(() => scrollTo(0,0));
    await p.locator('.cursor-pointer').first().scrollIntoViewIfNeeded();
    await p.evaluate(() => window.cachePage(1));
  };
  try {
    await p.clock.install();await p.goto('https://www.wiki-masters.com/collection');await advance(300);
    assert(!await option().isChecked(), 'Case exacte présente et désactivée par défaut');
    assert((await calls()).length===1, 'Une seule carte visible démarre');
    await p.evaluate(()=>{window.testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    await advance(2500);
    assert((await calls()).length===1 && await clicks()===0, 'Ni seconde carte ni navigation avant la première réponse complète');
    const firstEnd=await finish('price');await advance(1300);
    const firstCalls=await calls();
    assert(firstCalls.length===2 && firstCalls[1].startedAt-firstEnd>=1000, 'Deuxième carte visible après le délai d’une seconde');
    await finish('price');await advance(3000);
    assert((await calls()).length===2 && await clicks()===0, 'Option décochée : aucune navigation et carte hors écran ignorée');
    await option().check();await advance(900);
    assert(await clicks()===1 && (await calls()).filter(c=>c.kind==='page').length===1, 'Un seul clic natif malgré les deux boutons Suivant');
    await advance(4000);
    assert(await clicks()===1 && (await calls()).filter(c=>c.kind==='price').length===2, 'Ancienne grille pendant une réponse lente : ni double clic ni prix supplémentaires');
    const pageEnd=await finish('page');await advance(1950);
    const page2Calls=await calls();
    assert(await p.evaluate(()=>window.currentPage)===2 && page2Calls.at(-1).kind==='price'
      && page2Calls.at(-1).startedAt-pageEnd>=1000, 'Page suivante affichée avant de reprendre les prix et délai conservé');
    await finish('price');await advance(1300);await finish('price');await advance(1900);
    assert(await clicks()===2, 'Passage automatique à la troisième page après ses deux cartes visibles');
    await finish('page');await advance(1950);await finish('price');await advance(1300);await finish('price');await advance(5000);
    const completed=await calls();
    assert(await clicks()===2 && await p.evaluate(()=>window.currentPage)===3, 'Arrêt à la dernière page');
    assert(completed.filter(c=>c.kind==='price').length===6 && completed.filter(c=>c.kind==='price').every(c=>!c.url.includes('000000000013')&&!c.url.includes('000000000023')&&!c.url.includes('000000000033')), 'Six cartes visibles traitées, zéro carte hors écran');
    assert(completed.slice(1).every(c=>c.hidden) && completed.length===8, 'Les cinq prix suivants et les deux changements de page continuent en arrière-plan');
    assert(completed.filter(c=>c.kind==='page').every(c=>c.url.includes('rarity=L&search=conserve')), 'Paramètres natifs et filtres conservés');
    assert((await p.locator('.wm-sync-detail').innerText()).includes('Dernière page'), 'Fin du parcours signalée dans le bandeau');
    await p.reload();await advance(1000);
    assert(await option().isChecked() && (await calls()).every(c=>c.kind==='page'), 'Option persistante et prix en cache réutilisés après rechargement');
    await option().uncheck();
    if(await p.evaluate(()=>window.testPending.some(x=>x.call.kind==='page')))await finish('page');
    await advance(5000);
    const stoppedClicks=await clicks();await advance(4000);
    assert(await clicks()===stoppedClicks, 'Décocher termine le chargement en vol sans passer encore à la page suivante');

    await reset();
    await p.evaluate(()=>{const dialog=document.createElement('div');dialog.role='dialog';dialog.textContent='Carte ouverte';document.body.append(dialog);});
    await toggle().check();await advance(2000);
    assert(await clicks()===0, 'Un détail ou formulaire ouvert empêche le changement automatique');
    await p.evaluate(()=>document.querySelector('[role="dialog"]').remove());
    await p.evaluate(()=>{window.testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});await advance(2000);
    assert(await clicks()===1 && (await calls())[0].hidden, 'Passage automatique à la page suivante dans un onglet masqué');
    await p.evaluate(()=>{window.testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await advance(900);
    assert(await clicks()===1 && (await calls()).length===1, 'Retour au premier plan sans double clic ni nouvelle requête pendant le chargement');
    await p.evaluate(()=>{window.testHidden=true;});
    await toggle().uncheck();await finish('page');await advance(5000);
    assert(await clicks()===1 && (await calls()).length===1, 'Interrupteur global respecté aussi en arrière-plan');

    await reset();
    await p.evaluate(()=>{const h=document.querySelector('h3');delete h.__reactFiber$test;});await advance(300);
    await toggle().check();await advance(2000);
    assert(await clicks()===0, 'Carte visible non reconnue : la page ne doit pas être sautée');
    await toggle().uncheck();
    await p.evaluate(()=>{document.querySelector('#grid').replaceChildren();});await advance(300);await toggle().check();await advance(2000);
    assert(await clicks()===0, 'Une grille vide ne provoque pas de boucle de navigation');

    await reset();await toggle().check();await advance(900);await advance(21000);
    assert(await clicks()===1 && (await p.locator('.wm-sync-status').innerText()).includes('arrêté'), 'Réponse bloquée : arrêt après expiration sans répéter le clic');
    await finish('page');await advance(2000);
    await p.getByRole('button',{name:'Reprendre le chargement'}).click();await settle();await advance(1300);
    assert((await calls()).some(c=>c.kind==='price'), 'Le bouton de reprise réarme le traitement après une navigation bloquée');
    await toggle().uncheck();await finish('price');

    await reset();await p.evaluate(()=>{window.testHidden=true;});await toggle().check();await advance(900);await finish('page');
    // Avancer l'heure sans exécuter les timers simule un réveil tardif du navigateur.
    await p.clock.setSystemTime(await p.evaluate(()=>Date.now()+60000));await advance(900);
    assert(await clicks()===1 && await p.evaluate(()=>window.currentPage)===2
      && !(await p.locator('.wm-sync-status').innerText()).includes('arrêté'), 'Un timer réveillé une minute plus tard ne met pas en erreur une page déjà chargée');
    assert((await calls()).length===1, 'Aucune rafale de rattrapage après le retard du navigateur');
    await advance(1400);
    const afterDelay=await calls();
    assert(afterDelay.length===2 && afterDelay[1].kind==='price' && afterDelay[1].hidden
      && afterDelay[1].startedAt-afterDelay[0].finishedAt>=1000, 'Prix repris en arrière-plan après la page confirmée et le délai minimal');
    await toggle().uncheck();await finish('price');

    await reset();await toggle().check();
    await p.evaluate(()=>{window.testHidden=true;history.pushState(null,'','/marketplace');});await advance(2000);
    assert(await clicks()===0 && (await calls()).length===0, 'Quitter la collection dans le même onglet arrête les appels et la pagination');

    await reset();await p.evaluate(()=>{window.testHidden=true;window.collectionStatus=429;});await toggle().check();await advance(900);await finish('page');await advance(1000);
    await option().uncheck();await option().check();await advance(3000);
    assert(await clicks()===1 && await p.getByRole('button',{name:'Reprendre le chargement'}).isDisabled(), 'Un 429 de pagination conserve Retry-After en arrière-plan malgré les changements d’option');
    await p.setViewportSize({width:390,height:844});
    assert(await option().isVisible() && await p.locator('#wm-market-controls').evaluate(el=>el.scrollWidth<=el.clientWidth && el.getBoundingClientRect().right<=innerWidth), 'Case accessible et bandeau sans débordement sur écran de 390 px');
    assert(errors.length===0 && externalRequests===0, 'Aucune erreur JavaScript, aucun appel réel au jeu');
    return {passed:results.length,results,liveApiRequests:externalRequests};
  } catch(error) {
    return {error:error.message,passed:results,requests:await calls(),clicks:await clicks(),errors,text:await p.locator('body').innerText()};
  } finally {await context.close();}
}
