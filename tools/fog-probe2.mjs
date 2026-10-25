/* tools/fog-probe2.mjs —— 逐省打印 vis / ownerColor / 分组键 */
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1200));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-smoke-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2600));
console.log(JSON.stringify(await page.evaluate(() => {
  const D = window.AO.resDebug, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  const keys = {}, owners = {};
  for (const p of w.provinces) {
    const v = window.AO.fogVis(p.id);
    const col = v === 2 ? p.ownerColor : (v === 1 ? 'seen' : 'unk');
    const k = v + '|' + col;
    keys[k] = (keys[k] || 0) + 1;
    owners['o' + p.owner + ':' + (p.ownerColor || 'null')] = (owners['o' + p.owner + ':' + (p.ownerColor || 'null')] || 0) + 1;
  }
  return { keys, owners, sample: w.provinces.slice(0, 6).map(p => [p.id, p.owner, p.ownerColor, window.AO.fogVis(p.id)]),
           real: w.provinces.filter(p => window.AO.fogVis(p.id) === 2).length };
}), null, 1));
await browser.close();
