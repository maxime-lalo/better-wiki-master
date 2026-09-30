// Tri de la page courante : positions réelles dans la grille, réponses simulées.
async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1100,height:850}});
  const results=[],errors=[];let externalRequests=0;
  const assert=(ok,label)=>{if(!ok)throw Error(label);results.push(label);};
  const fixture=`<!doctype html><meta charset="utf-8"><style>
    body{background:#101411;color:#d8e6df;margin:20px;font:14px system-ui}main{max-width:1000px;margin:auto}#grid{display:grid;grid-template-columns:repeat(5,160px);gap:20px}.group{width:160px}.cursor-pointer{height:140px;box-sizing:border-box;padding:12px;border:1px solid #51645a;border-radius:12px}h3{font-size:14px}
    @media(max-width:640px){#grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.group{width:auto}}
    </style><main><h1>Collection</h1><div id="pager"><span>Page 1 / 2</span><button>Suivant →</button></div><div id="grid"></div></main><script>
    window.id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
    window.makeCard=(name,n,rarity='L')=>{const group=document.createElement('div');group.className='group';group.dataset.name=name;group.innerHTML='<div class="cursor-pointer"><span>'+rarity+'</span><h3>'+name+'</h3></div>';const node=group.firstElementChild;node.querySelector('h3').__reactFiber$fixture={memoizedProps:{card:{id:window.id(n),rarity,wikipedia_title:name}}};node.onclick=()=>window.lastOpened=name;return group;};
    window.cache=(n,summary)=>localStorage.setItem('wm-market-v1:'+window.id(n),JSON.stringify({version:1,fetchedAt:Date.now()-86400000,summary}));
    if(!localStorage.getItem('wm-market-v1:sync-settings'))localStorage.setItem('wm-market-v1:sync-settings',JSON.stringify({enabled:false,intervalMs:1000}));
    if(!localStorage.getItem('wm-market-v1:'+window.id(1))){
      window.cache(1,{L:{average:90,count:2},UR:{average:200,count:3}});window.cache(2,{L:{average:20,count:12}});
      window.cache(5,{});window.cache(6,{L:{average:20,count:12}});window.cache(7,{L:{average:0,count:0}});
    }
    for(const [name,n,rarity]of[['A',1,'L'],['B',2,'L'],['C',1,'UR'],['D',4,'L'],['E',5,'L'],['F',6,'L'],['G',7,'L']])document.querySelector('#grid').append(window.makeCard(name,n,rarity));
    window.initialNodes=[...document.querySelector('#grid').children];window.nextClicks=0;document.querySelector('#pager button').onclick=()=>window.nextClicks++;
    window.nextPage=()=>{const grid=document.querySelector('#grid');grid.replaceChildren();for(let n=1;n<=50;n++){window.cache(100+n,{L:{average:1000-n,count:n}});grid.append(window.makeCard('Page 2 — '+n,100+n));}document.querySelector('#pager span').textContent='Page 2 / 2';};
    </script>`;
  await context.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:fixture}):(externalRequests++,route.abort()));
  await context.addInitScript({content:`window.simulatedRequests=0;window.fetch=async()=>{window.simulatedRequests++;return new Response(JSON.stringify({summary:{L:{average:300,count:20}}}),{headers:{'Content-Type':'application/json'}});};`+page.wikiTestSource});
  const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
  const select=target=>target.getByRole('combobox',{name:'Trier les cartes de cette page'});
  const settle=async(target=p)=>{for(let n=0;n<10;n++)await target.evaluate(()=>new Promise(resolve=>{const ch=new MessageChannel();ch.port1.onmessage=()=>{ch.port1.close();ch.port2.close();resolve();};ch.port2.postMessage(0);}));};
  const advance=async ms=>{await p.clock.runFor(ms);await settle();};
  const order=target=>target.locator('#grid > .group').evaluateAll(nodes=>nodes.map(node=>({name:node.dataset.name,rect:node.getBoundingClientRect()})).sort((a,b)=>a.rect.top-b.rect.top||a.rect.left-b.rect.left).map(v=>v.name));
  const check=async(mode,expected,label)=>{await select(p).selectOption(mode);assert((await order(p)).join(',')===expected,label);};
  try {
    await p.clock.install();await p.goto('https://www.wiki-masters.com/collection');await advance(300);
    assert(await select(p).inputValue()==='native' && (await order(p)).join(',')==='A,B,C,D,E,F,G','Ordre du site conservé par défaut');
    await check('count-desc','B,F,C,A,E,G,D','Nombre de ventes décroissant, égalités stables, zéro ventes avant donnée inconnue');
    await check('count-asc','E,G,A,C,B,F,D','Nombre de ventes croissant, absence de ventes connue à zéro et cache absent à la fin');
    await check('average-desc','C,A,B,F,G,D,E','Prix moyen décroissant selon la rareté effective, mêmes IDs autorisés');
    await check('average-asc','G,B,F,A,C,D,E','Prix moyen croissant : vrai zéro avant les moyennes positives, moyennes absentes à la fin');
    assert(await p.evaluate(()=>window.initialNodes.every((node,i)=>document.querySelector('#grid').children[i]===node)),'Nœuds natifs conservés dans leur ordre DOM, sans déplacement ni clonage');
    await p.locator('[data-name="C"] .cursor-pointer').click();
    assert(await p.evaluate(()=>window.lastOpened)==='C' && await p.locator('[data-name="C"] .wm-market strong').innerText()==='200','Le clic et le prix restent associés à la bonne carte après tri');
    assert(await p.evaluate(()=>window.simulatedRequests===0 && window.nextClicks===0),'Trier n’ajoute aucune requête et ne change pas la page');

    await select(p).selectOption('average-desc');
    await p.evaluate(async()=>{await(await fetch('/api/marketplace/cards/'+window.id(4)+'/sales?scope=summary')).json();});await settle();await advance(300);
    assert((await order(p))[0]==='D','Un prix reçu du site remet automatiquement la carte à sa place dans le tri');
    const second=await context.newPage();await second.goto('https://www.wiki-masters.com/collection');await settle(second);
    await second.evaluate(()=>window.cache(5,{L:{average:10,count:50}}));await settle();
    await select(second).selectOption('count-desc');await settle();
    assert(await select(p).inputValue()==='count-desc' && (await order(p))[0]==='E','Réglage et données reçus d’un autre onglet mettent à jour le tri');
    await second.close();

    await p.evaluate(()=>{window.initialNodes[1].remove();document.querySelector('#grid').insertBefore(window.makeCard('H',6),window.initialNodes[5]);});await advance(300);
    assert((await order(p)).join(',')==='E,D,H,F,C,A,G','Suppression et insertion natives conservées sous tri, égalités suivant le nouvel ordre du site');
    await p.evaluate(()=>document.querySelector('[data-name="G"]').style.order='-1');
    await check('native','G,A,C,D,E,H,F','Retour à l’ordre natif, y compris un ordre CSS préexistant du site');
    assert(await p.locator('.wm-page-sorted-card').count()===0 && await p.locator('[data-name="G"]').evaluate(el=>el.style.order)==='-1','Désactiver le tri retire seulement les styles ajoutés par le script');

    await select(p).selectOption('count-desc');await p.reload();await advance(300);
    assert(await select(p).inputValue()==='count-desc' && (await order(p))[0]==='E','Tri conservé après rechargement, à partir des données en cache');
    await p.evaluate(()=>window.nextPage());await advance(300);
    const nextOrder=await order(p);
    assert(nextOrder.length===50 && nextOrder[0]==='Page 2 — 50' && nextOrder.at(-1)==='Page 2 — 1','Les 50 cartes de la nouvelle page sont triées, y compris celles sous le viewport');
    assert(await p.locator('.wm-market').count()===50 && !(await order(p)).includes('E'),'Aucune carte d’une autre page n’est ajoutée à la grille');
    await p.evaluate(()=>document.querySelector('#grid').style.cssText='display:flex;flex-wrap:wrap');await select(p).selectOption('count-asc');
    assert((await order(p))[0]==='Page 2 — 1' && (await order(p)).at(-1)==='Page 2 — 50','Tri fonctionnel dans une grille flexible également');
    await p.setViewportSize({width:390,height:844});
    assert(await select(p).isVisible() && await p.locator('#wm-market-controls').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth),'Sélecteur accessible sans débordement sur un écran de 390 px');
    await p.screenshot({path:'preview-sort-mobile.png'});
    await p.setViewportSize({width:1100,height:850});await p.screenshot({path:'preview-sort-desktop.png'});
    await p.evaluate(()=>history.pushState(null,'','/settings'));await advance(1300);
    assert(await p.locator('.wm-page-sorted-card').count()===0,'Quitter la collection retire le tri visuel');
    assert(errors.length===0 && externalRequests===0,'Aucune erreur JavaScript et aucune requête réelle au jeu');
    return {passed:results.length,results,liveApiRequests:externalRequests};
  } catch(error){return{error:error.message,passed:results,order:await order(p),errors,text:await p.locator('body').innerText()};}
  finally {await context.close();}
}
