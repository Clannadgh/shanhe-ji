/* tools/fog-ai-cost.mjs —— AI 情报预算会不会把 AI 国库抽干（60 回合观察） */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const browser = await puppeteer.launch({ headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-aicost-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2800));
const out = await page.evaluate((noIntel) => {
  const D = window.AO.resDebug, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  /* 对照组：把所有情报预算清零，看"没有情报开销"时国库是不是也会掉到这个水平 */
  if (noIntel) for (const c of w.countries) D.fogBudget[c.id] = 0;
  const snap = (label) => {
    const rows = w.countries.filter(c => c.id !== D.player()).map(c => ({
      id: c.id, b: D.fogBudgetOf(c.id), gold: Math.round(D.fogGold(c.id))
    }));
    return { label, turn: D.turn(), zeroGold: rows.filter(r => r.gold <= 0).length,
      avgGold: Math.round(rows.reduce((a, r) => a + r.gold, 0) / rows.length),
      budgets: rows.map(r => r.b).join('') };
  };
  const log = [snap('开局')];
  for (let i = 0; i < 60; i++) {
    if (D.evtPending && D.evtPending()) D.evtPick(0);
    D.nextTurn();
    if (i === 19 || i === 39 || i === 59) log.push(snap('第' + D.turn() + '回合'));
  }
  return log;
}, process.argv[2] === 'off');
console.log(JSON.stringify(out, null, 1));
await browser.close();
