/* tools/fog-mask.mjs —— 国家卡按情报档遮蔽的视觉检查（0/1/2 三张） */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const browser = await puppeteer.launch({ headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1300));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-mask-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2700));

const setup = await page.evaluate(() => {
  const D = window.AO.resDebug, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  /* 找一个已知（探过一省）的别国 */
  const other = w.countries.find(c => c.id !== D.player() && c.neighbors.indexOf(D.player()) >= 0) ||
    w.countries.find(c => c.id !== D.player());
  /* 先派一次密探：让"已探 / 边境见闻"有内容，再看三档的差别 */
  D.fogSetBudget(D.player(), 2);
  const pr = D.fogProbe(other.id);
  return { me: best.name, other: other.id, otherName: other.name, probe: pr };
});
console.log(JSON.stringify(setup));

for (const lv of [0, 1, 2]) {
  const info = await page.evaluate((cid, lv) => {
    const D = window.AO.resDebug;
    D.fogSetBudget(D.player(), lv);
    window.__renderer.selectCountry(cid);
    D.showCountry(cid);
    const el = document.getElementById('country');
    const vis = (id) => { const e = document.getElementById(id); if (!e) return 'missing';
      const r = e.getBoundingClientRect(); return (e.offsetParent === null || r.height < 1) ? 'hidden' : 'shown'; };
    return {
      lv,
      bar: document.getElementById('cFogBar').textContent,
      fog: document.getElementById('cFogInfo').textContent,
      treasury: vis('cTreasury'), tech: vis('cTech'), govern: vis('cGovern'),
      pop: vis('cPop'), econ: vis('cEcon'), prov: document.getElementById('cProv').textContent
    };
  }, setup.other, lv);
  console.log(JSON.stringify(info));
  await new Promise(r => setTimeout(r, 260));
  await page.screenshot({ path: path.join(root, 'shots', 'fog-mask-t' + lv + '.png') });
}

/* 自己国：必须全透明 */
const mine = await page.evaluate(() => {
  const D = window.AO.resDebug, id = D.player();
  D.showCountry(id);
  const vis = (i) => { const e = document.getElementById(i); return (e && e.offsetParent !== null) ? 'shown' : 'hidden'; };
  return { treasury: vis('cTreasury'), tech: vis('cTech'), govern: vis('cGovern'),
    fogBarHidden: document.getElementById('cFogBar').hidden, prov: document.getElementById('cProv').textContent };
});
console.log('自己的国', JSON.stringify(mine));
await new Promise(r => setTimeout(r, 260));
await page.screenshot({ path: path.join(root, 'shots', 'fog-mask-self.png') });
await browser.close();
