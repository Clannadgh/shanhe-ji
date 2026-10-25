/* tools/fog-zoom.mjs —— 放大看边界：未测绘纸面 / 泛黄 / 实时 三态的交界 */
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
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-zoom-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2800));

const info = await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  document.getElementById('country').classList.remove('on');
  /* 造出三态同框：探几块邻省并把时间调旧，再留一片没探的 */
  const P = D.player();
  let n = 0;
  for (const p of w.provinces) {
    if (p.owner === P) continue;
    const near = p.neighbors.some(id => w.provinces[id - 1].owner === P);
    if (!near) continue;
    D.fogSee(P, p.id, true);
    if (n++ >= 5) break;
  }
  /* 其中 3 块做成"陈旧" */
  let m = 0;
  for (const k in D.fogLastSeen) {
    if (k.split('|')[0] !== String(P)) continue;
    const pid = +k.split('|')[1];
    if (w.provinces[pid - 1].owner === P) continue;
    if (m++ < 3) D.fogLastSeen[k].t = D.turn() - 9;
  }
  D.fogInvalidate();
  /* 相机定到边境 */
  const pb = w.provinces.find(p => p.owner === P && p.neighbors.some(id => w.provinces[id - 1].owner !== P));
  R.cam.x = pb.centroid[0];
  R.cam.y = pb.centroid[1];
  R.cam.scale = 2.6;
  R.clampCam();
  R.fogRefresh();
  return { P, plan: D.fogPlan(), cam: [R.cam.x, R.cam.y, R.cam.scale] };
});
console.log(JSON.stringify(info));
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: path.join(root, 'shots', 'fog-zoom.png') });
await browser.close();
