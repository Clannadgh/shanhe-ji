/* tools/fog-dump.mjs —— 把底图 / 合成图分别存成 PNG */
import path from 'path';
import fs from 'fs';
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
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-smoke-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2800));
const data = await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer;
  let best = null;
  for (const c of D.world().countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  R._renderBase();
  /* 统计每种填色被用了多少次：直接在 _fillFogPolitical 上套一层 */
  const stats = {};
  const orig = CanvasRenderingContext2D.prototype.fill;
  CanvasRenderingContext2D.prototype.fill = function (p, rule) {
    if (this.fillStyle) stats[String(this.fillStyle)] = (stats[String(this.fillStyle)] || 0) + 1;
    return orig.apply(this, arguments);
  };
  R._renderBase();
  CanvasRenderingContext2D.prototype.fill = orig;
  return {
    plan: D.fogPlan(),
    stats: Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 12),
    base: R.base.toDataURL('image/png')
  };
});
fs.writeFileSync(path.join(root, 'shots', 'fog-base.png'),
  Buffer.from(data.base.split(',')[1], 'base64'));
console.log('plan', JSON.stringify(data.plan));
console.log('fills', JSON.stringify(data.stats));
await browser.close();
