// Exécution MCP Playwright ; page.wikiTestSource contient le userscript courant.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 900, height: 700 } });
  const results = [];
  const apiRequests = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const fixture = `<!doctype html><html><head><meta charset="UTF-8"><style>
    body{background:#101411;color:#eee;font:14px system-ui}.card-frame.fixed{position:fixed;left:20px;top:30px;width:320px;max-height:450px;display:flex;flex-direction:column;background:#17211a;border:1px solid #555}.header{padding:12px}.overflow-y-auto{overflow:auto;min-height:0}.overflow-y-auto>button{display:flex;width:100%;background:transparent;color:inherit;text-align:left;padding:12px;border:0;border-bottom:1px solid #333}.overflow-y-auto p{margin:3px 0}.other{left:450px!important}
    </style></head><body><main><h1>Paramètres</h1></main><div class="card-frame fixed other"><div><span>Échanges</span></div><div class="overflow-y-auto"><button><p>Liste de souhaits</p></button></div></div>
    <script>
      window.nativeClicks=0;window.readAllClicks=0;
      window.items=[['Liste de souhaits','Carte A'],['Enchère gagnée','Carte B'],['Surenchéri','Carte C'],["Demande d'ami",'Joueur D'],['Liste de souhaits','Carte E']];
      window.mountDrawer=()=>{let r=document.createElement('div');r.id='drawer';r.className='card-frame fixed';r.innerHTML='<div class="header"><span>Notifications</span><button id="read-all">Tout marquer comme lu</button></div><div class="min-h-0 flex-1 overflow-y-auto"></div>';r.querySelector('#read-all').onclick=()=>window.readAllClicks++;document.body.append(r);window.renderRows();};
      window.renderRows=()=>{let list=document.querySelector('#drawer>.overflow-y-auto');list.replaceChildren();for(const [type,message] of window.items){let b=document.createElement('button');let d=document.createElement('div');let p=document.createElement('p');p.textContent=type;d.append(p);p=document.createElement('p');p.textContent=message;d.append(p);b.append(d);b.onclick=()=>window.nativeClicks++;list.append(b);}if(!window.items.length){let p=document.createElement('p');p.textContent='Aucune notification';list.append(p);}};
      window.mountDrawer();
    </script></body></html>`;
  await context.route('**/*', route => {
    if (route.request().url().includes('/api/')) { apiRequests.push(route.request().url()); return route.fulfill({ status: 200, body: '{}' }); }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fixture });
  });
  const p = await context.newPage();
  p.setDefaultTimeout(5000);
  const tick = () => p.clock.runFor(250);
  const shown = () => p.locator('#drawer>.overflow-y-auto>button:visible').count();
  try {
    await p.clock.install();
    await p.addInitScript({ content: page.wikiTestSource });
    await p.goto('https://www.wiki-masters.com/settings');
    await tick();
    const filter = p.getByRole('combobox', { name: 'Type de notification', exact: true });
    assert(await shown() === 5 && await filter.locator('option').count() === 5, 'Toutes les notifications et les quatre types détectés');
    assert((await filter.locator('option').allTextContents()).includes('Liste de souhaits (2)'), 'Compteur par type exact');
    await filter.selectOption('Enchère gagnée');
    assert(await shown() === 1 && (await p.locator('#drawer>.overflow-y-auto>button:visible').innerText()).includes('Carte B'), 'Filtrage par le type, pas par le texte du message');
    assert(await p.locator('.other button:visible').count() === 1 && await p.locator('.other .wm-notification-controls').count() === 0, 'Les autres panneaux restent intacts');
    assert(await p.evaluate(() => window.nativeClicks === 0 && window.readAllClicks === 0), 'Filtrer ne clique pas les notifications et ne les marque pas comme lues');
    await p.locator('#drawer>.overflow-y-auto>button:visible').click();
    assert(await p.evaluate(() => window.nativeClicks === 1), 'Les gestionnaires de clic natifs restent fonctionnels');
    await p.evaluate(() => { document.querySelector('#drawer').remove(); window.mountDrawer(); });
    await tick();
    assert(await filter.inputValue() === 'Enchère gagnée' && await shown() === 1, 'Filtre conservé à la réouverture du panneau');
    await p.reload();
    await tick();
    assert(await filter.inputValue() === 'Enchère gagnée' && await shown() === 1, 'Filtre conservé après rechargement de la page');
    await p.evaluate(() => { window.items.push(['Échange accepté','Carte F']); window.renderRows(); });
    await tick();
    assert((await filter.locator('option').allTextContents()).includes('Échange accepté (1)') && await shown() === 1, 'Nouveau type détecté lors d’une mise à jour native');
    await p.evaluate(() => { window.items=window.items.filter(([t])=>t!=='Enchère gagnée');window.renderRows(); });
    await tick();
    assert(await shown() === 0 && await p.locator('.wm-notification-empty').isVisible()
      && (await filter.locator('option').allTextContents()).includes('Enchère gagnée (0)'), 'État vide explicite quand le type sélectionné disparaît');
    await filter.selectOption('');
    assert(await shown() === 5 && await p.locator('#drawer [data-wm-notification-hidden]').count() === 0, 'Toutes restaure les notifications et leur accessibilité');
    await p.evaluate(() => { window.items=[];window.renderRows(); });
    await tick();
    assert(await p.getByText('Aucune notification', { exact: true }).isVisible()
      && await p.locator('.wm-notification-empty:visible').count() === 0, 'L’état vide natif est conservé');
    await p.clock.fastForward(60000);
    assert(apiRequests.length === 0, 'Aucun appel API supplémentaire pour le filtrage');
    assert(await p.locator('#drawer .wm-notification-controls').count() === 1, 'Aucune duplication du filtre après les mises à jour');
    await p.evaluate(() => {window.items=[['Enchère gagnée','Carte B'],['Liste de souhaits','Carte A']];window.renderRows();});
    await tick();
    await p.setViewportSize({ width: 390, height: 700 });
    assert(await p.locator('.wm-notification-controls').evaluate(el => el.scrollWidth <= el.clientWidth), 'Contrôle sans débordement à 390 px');
    return { passed: results.length, results, apiRequests: apiRequests.length };
  } catch (error) { return { error: error.message, passed: results, ui: await p.locator('#drawer').innerText() }; }
  finally { await context.close(); }
}
