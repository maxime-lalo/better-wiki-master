// Cache partagé simulé : aucun appel à WikiMasters ni au serveur personnel.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 800 } });
  const results = [], errors = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
  const ids = [id(1), id(2), id(3)];
  const fixture = `<!doctype html><meta charset="utf-8"><style>body{margin:20px;background:#101411;color:#e4eee8}main{max-width:1000px;margin:auto}#grid{display:flex;gap:20px}.group{width:160px}.group:last-child{margin-top:1100px}.cursor-pointer{height:140px;padding:12px;box-sizing:border-box;border:1px solid #51645a}</style>
    <main><h1>Collection</h1><div id="grid"></div></main><script>
    for(let i=1;i<=2;i++){const node=document.createElement('div');node.className='group';node.innerHTML='<div class="cursor-pointer"><h3>Carte '+i+'</h3><span>L</span></div>';const h=node.querySelector('h3');h.__reactFiber$test={memoizedProps:{card:{id:window.cardId(i),rarity:'L',wikipedia_title:h.textContent}}};document.querySelector('#grid').append(node);}
    </script>`;
  let externalRequests = 0;
  await context.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html', body: fixture }) : (externalRequests++, route.abort()));
  await context.addInitScript({ content: `
    Object.defineProperty(document,'hidden',{get:()=>false});
    window.cardId=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
    window.opts=JSON.parse(sessionStorage.getItem('scenario')||'{}');
    localStorage.setItem('wm-market-v1:sync-settings',JSON.stringify({enabled:true,intervalMs:1000,sharedEnabled:!window.opts.localOnly,sharedUrl:'https://shared-cache.test',contributorKey:JSON.parse(localStorage.getItem('wm-market-v1:sync-settings')||'{}').contributorKey??(window.opts.newInstallation?'':'test-contributor-key')}));
    window.calls=[];window.pending=[];window.backend={};
    window.oldDate=Date.now()-86400000;
    window.value=n=>({id:window.cardId(n),fetchedAt:window.oldDate,summary:{L:{average:n*100,count:4,latest:n*110}}});
    window.backend[window.cardId(1)]=window.value(1);
    if(window.opts.allCached)window.backend[window.cardId(2)]=window.value(2);
    if(window.opts.uploadOld)localStorage.setItem('wm-market-v1:'+window.cardId(3),JSON.stringify({version:1,...window.value(3)}));
    if(window.opts.paused)localStorage.setItem('wm-market-v1:gate',JSON.stringify({until:Date.now()+600000,retryAfterUntil:Date.now()+600000}));
    if(window.opts.blocked)localStorage.setItem('wm-market-v1:automation-block',JSON.stringify({code:'automation_limit'}));
    window.reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href),body=JSON.parse(init.body||'{}');
      const kind=url.origin===location.origin?'site':'shared';
      const call={kind,origin:url.origin,path:url.pathname,body,at:Date.now(),credentials:init.credentials,referrerPolicy:init.referrerPolicy,headers:init.headers};window.calls.push(call);
      if(kind==='site'){
        if(!url.pathname.includes('/sales'))throw Error('API inattendue');
        return new Response(new ReadableStream({start(controller){window.pending.push({controller,call});}}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(window.opts.backendFailure)return new Response('{}',{status:429,headers:{'Retry-After':'120'}});
      if(url.pathname==='/v1/installations'){
        if(window.opts.registrationDenied)return new Response('{}',{status:429,headers:{'Retry-After':'3600'}});
        const data={contributorKey:'bwm_'+ 'a'.repeat(43)};
        if(window.opts.holdRegistration)return new Response(new ReadableStream({start(controller){window.pendingRegistration={controller,data};}}));
        return window.reply(data);
      }
      if(window.opts.revoked && ['/v1/contributions','/v1/claims'].includes(url.pathname))return new Response('{}',{status:401});
      if(url.pathname==='/v1/lookup'){
        const data={entries:body.ids.flatMap(id=>window.backend[id]?[window.backend[id]]:[]),missing:body.ids.filter(id=>!window.backend[id])};
        if(window.opts.holdLookup){window.opts.holdLookup=false;return new Response(new ReadableStream({start(controller){window.pendingLookup={controller,data};}}));}
        if(window.opts.malformed)return window.reply({entries:[{...window.value(1),fetchedAt:Date.now()+86400000}],missing:[window.cardId(2)]});
        return window.reply(data);
      }
      if(url.pathname==='/v1/contributions'){
        for(const value of body.entries)window.backend[value.id]=value;
        return window.reply({accepted:body.entries.length,stored:body.entries.length});
      }
      if(url.pathname==='/v1/claims'){
        if(window.backend[body.id]?.fetchedAt>body.after)return window.reply({state:'cached',entry:window.backend[body.id]});
        if(window.opts.claimBusy)return window.reply({state:'busy',retryAfterMs:90000});
        return window.reply({state:'granted',token:'claim-token',expiresAt:Date.now()+90000});
      }
      if(url.pathname==='/v1/claims/release')return window.reply({released:true});
      throw Error('Route backend inattendue');
    };
    window.finishRegistration=()=>{const p=window.pendingRegistration;p.controller.enqueue(new TextEncoder().encode(JSON.stringify(p.data)));p.controller.close();window.pendingRegistration=null;};
    window.finishLookup=()=>{const p=window.pendingLookup;p.controller.enqueue(new TextEncoder().encode(JSON.stringify(p.data)));p.controller.close();window.pendingLookup=null;};
    window.finishSite=()=>{const p=window.pending.shift();p.call.finishedAt=Date.now();p.controller.enqueue(new TextEncoder().encode(JSON.stringify({summary:{L:{average:222,count:5,latest:230}}})));p.controller.close();return p.call.finishedAt;};
  ` + page.wikiTestSource });
  const p = await context.newPage(); p.setDefaultTimeout(5000);
  p.on('pageerror', error => errors.push(error.message));
  const settle = async () => { for(let i=0;i<15;i++) await p.evaluate(()=>new Promise(resolve=>{
    const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);
  })); };
  const advance = async ms => { await p.clock.runFor(ms); await settle(); };
  const calls = () => p.evaluate(()=>window.calls);
  const siteCalls = async () => (await calls()).filter(c=>c.kind==='site');
  const reset = async options => {
    await p.evaluate(options=>{localStorage.clear();sessionStorage.setItem('scenario',JSON.stringify(options));},options);
    await p.goto('https://www.wiki-masters.com/collection');await advance(300);
  };
  try {
    await p.clock.install();await p.goto('https://www.wiki-masters.com/collection');
    await reset({holdLookup:true,uploadOld:true});
    assert((await calls()).length===1 && (await calls())[0].body.ids.length===2, 'Un tableau de deux cartes envoyé en une seule lecture de cache');
    await advance(3000);
    assert((await siteCalls()).length===0, 'La première lecture groupée est entièrement terminée avant tout appel WikiMasters');
    await p.evaluate(()=>window.finishLookup());await settle();await advance(1000);
    const sharedEntry=await p.evaluate(id=>JSON.parse(localStorage.getItem('wm-market-v1:'+id)),ids[0]);
    assert(sharedEntry.source==='shared' && sharedEntry.fetchedAt===await p.evaluate(()=>window.oldDate)
      && (await p.locator('.wm-market').first().innerText()).includes('100'), 'Prix partagé affiché et date originale conservée');
    assert((await siteCalls()).length===1 && (await siteCalls())[0].path.includes(ids[1]), 'Seule la carte absente du backend est demandée à WikiMasters');
    const oldUpload=(await calls()).find(c=>c.path==='/v1/contributions');
    assert(oldUpload.body.entries.length===1 && oldUpload.body.entries[0].id===ids[2]
      && oldUpload.body.entries[0].fetchedAt===sharedEntry.fetchedAt, 'Import du cache local antérieur, en lot et sans rajeunir les prix');
    await advance(2000);assert((await siteCalls()).length===1,'Une seule requête WikiMasters en vol pendant une réponse lente');
    const finished=await p.evaluate(()=>window.finishSite());await settle();await advance(300);
    assert(await p.evaluate(id=>window.backend[id].summary.L.average,ids[1])===222, 'Une nouvelle réponse WikiMasters alimente le backend');
    const ordered=await calls(), siteIndex=ordered.findIndex(c=>c.kind==='site');
    assert(ordered[siteIndex-1].path==='/v1/claims' && ordered[siteIndex+1].path==='/v1/contributions'
      && ordered[siteIndex+2].path==='/v1/claims/release', 'Réservation, consultation, publication puis libération dans cet ordre');
    const finishedGate=await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:gate')));
    assert(finishedGate.waitFrom>=finished && finishedGate.next-finishedGate.waitFrom===1000, 'Le délai WikiMasters part de sa réponse, indépendamment des appels au cache');
    await advance(3000);assert((await siteCalls()).length===1,'Les prix mis en cache ne provoquent aucun nouvel appel au site');
    assert((await calls()).filter(c=>c.kind==='shared').every(c=>c.credentials==='omit'&&c.referrerPolicy==='no-referrer'
      && !Object.keys(c.headers||{}).some(k=>/cookie|authorization/i.test(k))), 'Aucun cookie ni jeton WikiMasters transmis au backend');
    assert((await calls()).filter(c=>c.path==='/v1/contributions').every(c=>c.body.entries.every(e=>Object.keys(e).sort().join(',')==='fetchedAt,id,summary')), 'Les contributions ne contiennent que carte, prix et date');

    await reset({allCached:true,paused:true});await advance(1200);
    assert((await siteCalls()).length===0 && await p.locator('.wm-market strong').allTextContents().then(v=>v.join(',')==='100,200'), 'Tous les prix du lot disponibles malgré Retry-After, sans appel WikiMasters');
    assert(await p.getByRole('button',{name:'Reprendre le chargement'}).isDisabled(), 'Le cache partagé ne lève pas la pause demandée par WikiMasters');
    await reset({allCached:true,blocked:true});await advance(1200);
    assert((await siteCalls()).length===0 && await p.evaluate(id=>!!localStorage.getItem('wm-market-v1:'+id),ids[1]), 'Un refus automation_limit reste respecté tout en permettant de consulter le cache');

    await reset({claimBusy:true});await advance(1500);
    assert((await siteCalls()).length===0 && (await calls()).some(c=>c.path==='/v1/claims'), 'Une carte déjà réservée par un autre utilisateur ne déclenche pas de doublon');
    await p.evaluate(()=>{window.backend[window.cardId(2)]=window.value(2);});await advance(5500);
    assert((await siteCalls()).length===0 && await p.evaluate(id=>JSON.parse(localStorage.getItem('wm-market-v1:'+id)).source,ids[1])==='shared', 'Le résultat du contributeur concurrent est réutilisé à la vérification suivante');

    await reset({allCached:true,claimBusy:true});await advance(1000);
    await p.getByRole('button',{name:'Actualiser les prix de Carte 2'}).click();await advance(1500);
    assert(await p.getByRole('button',{name:'Actualiser les prix de Carte 2'}).isDisabled(), 'Une actualisation manuelle reste en attente pendant la réservation concurrente');
    await p.evaluate(()=>{window.backend[window.cardId(2)]={...window.value(2),fetchedAt:Date.now(),summary:{L:{average:777,count:8,latest:700}}};});
    await advance(5500);
    assert((await siteCalls()).length===0 && (await p.locator('.wm-market strong').nth(1).innerText())==='777', 'Le prix récemment actualisé par un autre utilisateur termine le rafraîchissement manuel');

    await reset({backendFailure:true});await advance(500);
    assert((await siteCalls()).length===1 && !(await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:gate')).until)), 'Un 429 du backend utilise le mode local sans transformer cela en pause WikiMasters');
    const siteEnd=await p.evaluate(()=>window.finishSite());await settle();await advance(750);
    assert((await siteCalls()).length===1, 'Le repli local conserve le délai après réponse');
    await advance(600);
    assert((await siteCalls()).length===2 && (await siteCalls())[1].at-siteEnd>=1000, 'Deuxième prix manquant après le délai minimal en mode local');
    assert((await calls()).filter(c=>c.kind==='shared').length===1, 'Retry-After du backend respecté sans le solliciter en boucle');

    await reset({malformed:true});await advance(500);
    assert((await siteCalls()).length===1 && await p.evaluate(id=>localStorage.getItem('wm-market-v1:'+id)===null,ids[0]), 'Une réponse communautaire invalide est rejetée et laisse le repli local disponible');
    await reset({allCached:true,newInstallation:true,uploadOld:true});await advance(2200);
    const autoKey=await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:sync-settings')).contributorKey);
    assert(autoKey==='bwm_'+'a'.repeat(43) && (await calls()).filter(c=>c.path==='/v1/installations').length===1, 'Clé automatique créée une seule fois et conservée dans le navigateur');
    assert((await calls()).filter(c=>c.path==='/v1/lookup').length===1 && (await siteCalls()).length===0, 'Activation automatique après la lecture groupée, sans répéter celle-ci ni contacter WikiMasters');
    assert((await calls()).some(c=>c.path==='/v1/contributions'&&c.body.contributorKey===autoKey&&c.body.entries[0].id===ids[2]), 'Le cache local est importé automatiquement après création de la clé');
    await p.reload();await advance(1500);
    assert((await calls()).every(c=>c.path!=='/v1/installations') && await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:sync-settings')).contributorKey)===autoKey, 'Un rechargement réutilise la clé existante');

    await reset({allCached:true,newInstallation:true,holdRegistration:true});await advance(1000);
    const second=await context.newPage();await second.clock.install({time:await p.evaluate(()=>Date.now())});
    await second.goto('https://www.wiki-masters.com/collection');await second.clock.runFor(1200);await advance(1200);
    assert((await calls()).filter(c=>c.path==='/v1/installations').length===1 && await second.evaluate(()=>window.calls.filter(c=>c.path==='/v1/installations').length)===0, 'Deux onglets simultanés partagent le verrou de création de clé');
    await p.evaluate(()=>window.finishRegistration());await settle();await advance(600);await second.clock.runFor(800);
    assert(await second.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:sync-settings')).contributorKey)===autoKey, 'La clé créée est réutilisée dans le second onglet');
    await second.close();

    await reset({allCached:true,newInstallation:true,registrationDenied:true});await advance(1200);
    assert((await siteCalls()).length===0 && (await p.locator('.wm-market strong').allTextContents()).join(',')==='100,200', 'Création de clé limitée : lecture du cache toujours disponible');
    await advance(61000);
    assert((await calls()).filter(c=>c.path==='/v1/installations').length===1, 'Retry-After de création respecté sans nouvelle demande après une minute');
    await p.reload();await advance(2000);
    assert((await calls()).every(c=>c.path==='/v1/lookup'), 'Pause de création conservée après rechargement, lectures maintenues');

    await reset({revoked:true});await advance(1200);await p.evaluate(()=>window.finishSite());await settle();await advance(61000);
    assert((await calls()).every(c=>c.path!=='/v1/installations') && await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:sync-settings')).contributorKey)==='test-contributor-key', 'Une clé refusée n’est jamais supprimée ni recréée automatiquement');

    await reset({allCached:true});await advance(1200);
    await p.locator('.wm-shared > summary').click();
    await p.locator('.wm-shared-advanced > summary').click();
    assert(await p.getByRole('textbox',{name:'Adresse du cache partagé'}).inputValue()==='https://shared-cache.test', 'Configuration du cache accessible dans le bandeau');
    const addressInput = p.getByRole('textbox',{name:'Adresse du cache partagé'});
    await addressInput.fill('http://insecure.test');
    await p.getByRole('button',{name:'Enregistrer le cache partagé'}).click();
    assert(await addressInput.evaluate(el=>!el.validity.valid), 'Serveur sans HTTPS refusé par le formulaire');
    await addressInput.fill('https://shared-cache.test');
    await p.getByRole('button',{name:'Enregistrer le cache partagé'}).click();
    assert(await addressInput.evaluate(el=>el.validity.valid), 'Adresse corrigée : le formulaire redevient utilisable');
    await addressInput.fill('https://other-cache.test');
    await p.getByRole('button',{name:'Enregistrer le cache partagé'}).click();await advance(1200);
    assert((await calls()).filter(c=>c.origin==='https://other-cache.test').every(c=>c.body.contributorKey!=='test-contributor-key'), 'Changer de serveur ne transmet pas la clé de l’ancien backend');
    await p.getByLabel('Utiliser le cache partagé').uncheck();
    assert(await p.evaluate(()=>JSON.parse(localStorage.getItem('wm-market-v1:sync-settings')).sharedEnabled)===false, 'Désactivation du cache partagée et persistée');
    await reset({localOnly:true});await advance(500);
    assert((await calls()).every(c=>c.kind==='site'), 'Option désactivée : aucun contact avec le backend');
    assert(errors.length===0 && externalRequests===0, 'Aucune erreur JavaScript ni requête réelle au jeu ou au backend');
    return {passed:results.length,results,liveApiRequests:externalRequests};
  } catch(error) {return {error:error.message,passed:results,calls:await calls(),errors,text:await p.locator('body').innerText()};}
  finally {await context.close();}
}
