import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage();
page.wikiTestSource = await readFile(new URL('wiki-masters-market.user.js', root), 'utf8');
let passed = 0;
try {
  for (const name of ['browser-tests.js', 'notification-tests.js', 'auction-tests.js', 'sync-tests.js', 'pagination-tests.js']) {
    // Ces fichiers sont des fonctions de test du dépôt, également exécutables
    // via le MCP Playwright. Ne jamais y charger de code distant.
    const source = await readFile(new URL(name, root), 'utf8');
    const run = new Function(`return (${source}\n);`)();
    const result = await run(page);
    if (result.error) throw new Error(`${name}: ${JSON.stringify(result)}`);
    passed += result.passed;
    console.log(`${name}: ${result.passed} assertions OK`);
  }
  console.log(`${passed} assertions OK — toutes les réponses du jeu sont simulées.`);
} finally {
  await browser.close();
}
