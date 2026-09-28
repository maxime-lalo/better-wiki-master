// Reprises automatiques : réseau entièrement simulé, aucune requête au jeu.
async (page) => {
  const context = await page.context().browser().newContext({viewport:{width:1100,height:800}});
  const results=[],errors=[];let externalRequests=0;
  const assert=(ok,label)=>{if(!ok)throw Error(label);results.push(label);};
  const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
  const fixture=`<!doctype html><meta charset="utf-8"><style>main{width:900px;margin:auto}.group{display:inline-block;width:160px;margin:10px}.cursor-pointer{height:140px}body{background:#101411;color:white}</style><main><h1>Collection</h1><div id="grid"></div><div><span>Page 1 / 2</span><button id="next">Suivant →</button></div></main><script>
  for(let n=1;n<=2;n++){const group=document.createElement('div');group.className='group';group.innerHTML='<div class="cursor-pointer"><span>L</span><h3>Carte '+n+'</h3></div>';const heading=group.querySelector('h3');heading.__reactFiber$test={memoizedProps:{card:{id:window.id(n),rarity:'L',wikipedia_title:heading.textContent}}};document.querySelector('#grid').append(group);}
  window.nextClicks=0;document.querySelector('#next').onclick=()=>window.nextClicks++;
  </script>`;
  await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:fixture}):(externalRequests++,route.abort()));
  await context.addInitScript({content:`
    window.id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
    window.options=JSON.parse(sessionStorage.getItem('retry-scenario')||'{}');
    if(!localStorage.getItem('wm-market-v1:sync-settings'))localStorage.setItem('wm-market-v1:sync-settings',JSON.stringify({enabled:true,autoNext:true,intervalMs:3000}));
    window.oldDate=Date.now()-86400000;
    window.cache=n=>localStorage.setItem('wm-market-v1:'+window.id(n),JSON.stringify({version:1,fetchedAt:window.oldDate,summary:{L:{average:42,count:2,latest:40}}}));
    window.cache(2);if(window.options.cached)window.cache(1);
    window.calls=[];window.pending=[];window.nextStatus=window.options.status??503;window.retryAfter=window.options.retryAfter||'';
    window.fetch=async(input,init={})=>{
      const url=new URL(input,location.href);if(!url.pathname.includes('/sales'))throw Error('Appel inattendu');
      const call={id:url.pathname.split('/')[4],status:window.nextStatus,startedAt:Date.now()};window.calls.push(call);
      if(window.nextStatus==='network')throw new TypeError('Failed to fetch');
      const stream=new ReadableStream({start(controller){window.pending.push({call,controller});init.signal?.addEventListener('abort',()=>controller.error(new DOMException('Timed out','AbortError')),{once:true});}});
      return new Response(stream,{status:window.nextStatus,headers:{'Content-Type':'application/json',...(window.nextStatus===429?{'Retry-After':'900'}:window.retryAfter?{'Retry-After':window.retryAfter}:{})}});
    };
    window.finish=()=>{const {call,controller}=window.pending.shift();call.finishedAt=Date.now();controller.enqueue(new TextEncoder().encode(JSON.stringify({summary:{L:{average:77,count:3,latest:80}}})));controller.close();return call.finishedAt;};
  `+page.wikiTestSource});
  const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
  const settle=async(target=p)=>{for(let n=0;n<12;n++)await target.evaluate(()=>new Promise(resolve=>{const ch=new MessageChannel();ch.port1.onmessage=()=>{ch.port1.close();ch.port2.close();resolve();};ch.port2.postMessage(0);}));};
  const advance=async ms=>{await p.clock.runFor(ms);await settle();};
  const finish=async()=>{const at=await p.evaluate(()=>window.finish());await settle();return at;};
  const calls=()=>p.evaluate(()=>window.calls);
  const toggle=()=>p.getByRole('switch',{name:'Synchronisation des prix'});
  const reset=async(options={})=>{
    await p.evaluate(options=>{localStorage.clear();sessionStorage.setItem('retry-scenario',JSON.stringify(options));},options);
    await p.goto('https://www.wiki-masters.com/collection');await advance(300);
  };
  try {
    await p.clock.install();await p.goto('https://www.wiki-masters.com/collection');await advance(300);
    await advance(5000);
    assert((await calls()).length===1 && await p.evaluate(()=>window.nextClicks)===0,'503 : attendre la fin du corps d’erreur sans autre carte ni Suivant');
    const firstEnd=await finish();await advance(2800);
    assert((await calls()).length===1 && (await p.locator('.wm-sync-status').innerText()).includes('Nouvel essai'),'Réessai signalé, sans départ pendant les trois secondes après le corps');
    await p.evaluate(()=>window.nextStatus=404);await advance(500);
    assert((await calls()).length===2 && (await calls())[1].id===id(1) && (await calls())[1].startedAt-firstEnd>=3000,'503 puis 404 : la même carte est réessayée après le délai choisi');
    const secondEnd=await finish();await p.evaluate(()=>window.nextStatus=200);await advance(3300);
    assert((await calls()).length===3 && (await calls())[2].id===id(1) && (await calls())[2].startedAt-secondEnd>=3000,'404 : réessai automatique sur la même carte, sans pause de dix minutes');
    assert(await p.evaluate(()=>window.nextClicks)===0,'Une dernière carte en cours de réessai empêche de sauter la page');
    await finish();await advance(3800);
    assert(await p.evaluate(()=>window.nextClicks)===1 && await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:gate')).retry)===null,'Succès : réessai effacé et passage à Suivant autorisé');

    await reset({cached:true,status:404});
    await p.getByRole('checkbox',{name:'Passer automatiquement à la page suivante'}).uncheck();
    await p.getByRole('button',{name:'Actualiser les prix de Carte 1'}).click();await settle();await finish();
    assert((await p.locator('.wm-market strong').first().innerText())==='42','Le prix précédent reste affiché pendant les réessais d’une actualisation manuelle');
    await toggle().uncheck();await advance(10000);
    assert((await calls()).length===1,'Désactiver la synchronisation arrête aussi les réessais');
    await p.evaluate(()=>window.nextStatus=200);await toggle().check();await advance(400);
    assert((await calls()).length===2 && (await calls())[1].id===id(1),'Réactivation : reprise de l’actualisation de la même carte malgré son ancien prix en cache');
    await finish();await advance(3500);
    assert((await calls()).length===2 && (await p.locator('.wm-market strong').first().innerText())==='77','Actualisation réussie : cache remplacé et aucune boucle supplémentaire');

    await reset();await finish();
    await p.evaluate(()=>window.nextStatus=200);
    const second=await context.newPage();await second.goto('https://www.wiki-masters.com/collection');await second.evaluate(()=>window.nextStatus=200);await settle(second);
    await advance(3300);await settle(second);
    const together=[...await calls(),...await second.evaluate(()=>window.calls)];
    assert(together.length===2 && together.every(c=>c.id===id(1)),'Le réessai est partagé entre onglets, avec une seule nouvelle requête pour la dernière carte');
    await toggle().uncheck();
    const owner=await p.evaluate(()=>window.pending.length)?p:second;await owner.evaluate(()=>window.finish());await settle(owner);await second.close();

    await reset({status:'network'});await advance(2400);
    assert((await calls()).length===1,'Une coupure réseau respecte aussi le délai avant réessai');
    await p.evaluate(()=>window.nextStatus=200);await advance(1000);
    assert((await calls()).length===2 && (await calls())[1].id===id(1),'Coupure réseau : la même carte est reprise automatiquement');
    await toggle().uncheck();await finish();

    await reset();await advance(21000);
    assert((await calls()).length===1,'Une requête expirée n’est pas relancée avant le délai sélectionné');
    await p.evaluate(()=>{window.nextStatus=200;window.pending=[];});await advance(3000);
    assert((await calls()).length===2 && (await calls())[1].id===id(1),'Expiration du temps réseau : réessai après la fin de la tentative');
    await toggle().uncheck();await finish();

    await reset({status:503,retryAfter:'10'});const requestStart=(await calls())[0].startedAt;await finish();await advance(5000);
    assert((await calls()).length===1,'Un Retry-After fourni avec un 503 est respecté lui aussi');
    await p.evaluate(()=>{window.nextStatus=200;window.retryAfter='';});await advance(5500);
    assert((await calls()).length===2 && (await calls())[1].startedAt-requestStart>=10000,'Le délai serveur du 503 terminé, la même carte reprend automatiquement');
    await toggle().uncheck();await finish();

    await reset();await finish();await p.evaluate(()=>window.nextStatus=429);await advance(3300);await finish();await advance(10000);
    assert((await calls()).length===2 && await p.getByRole('button',{name:'Reprendre le chargement'}).isDisabled(),'429 après un réessai : arrêt et respect du Retry-After, aucune boucle automatique');
    assert(errors.length===0 && externalRequests===0,'Aucune erreur JavaScript et aucun appel réel au jeu');
    return {passed:results.length,results,liveApiRequests:externalRequests};
  } catch(error){return{error:error.message,passed:results,calls:await calls(),errors,text:await p.locator('body').innerText()};}
  finally {await context.close();}
}
