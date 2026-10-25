/* tools/fog-debug.mjs —— 取几个省的"可见性 / 填色像素 / 注记"对照 */
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
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-smoke-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 3000));
const out = await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  R.fogRefresh();
  R._renderBase();          // 强制同步重烘，否则量到的是上一帧的底图
  R._ensureLabels();
  const s = R.cam.scale, dpr = R.dpr;
  const px = (x, y) => {
    const cx = Math.round((x - R.cam.x) * s * dpr + R.base.width / 2);
    const cy = Math.round((y - R.cam.y) * s * dpr + R.base.height / 2);
    const d = R.baseCtx.getImageData(cx, cy, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
  const pick = [];
  for (let i = 1; i <= w.provinces.length && pick.length < 8; i++) {
    const p = w.provinces[i - 1];
    if (!p) continue;
    if (pick.length < 4 && D.fogVis(i) === 0) pick.push({ pid: i, vis: 'unknown', owner: p.owner, color: p.ownerColor, px: px(p.centroid[0], p.centroid[1]), name: p.name });
    else if (pick.length >= 4 && D.fogVis(i) === 2) pick.push({ pid: i, vis: 'real', owner: p.owner, color: p.ownerColor, px: px(p.centroid[0], p.centroid[1]), name: p.name });
  }
  return {
    plan: D.fogPlan(),
    player: D.player(),
    pick,
    paper: D.fogInt.paper,
    labels: (R._labels || []).slice(0, 12).map(L => ({ k: L.kind, id: L.id, pid: L.pid, t: L.text, v: L.pid ? D.fogVis(L.pid) : null })),
    labelN: (R._labels || []).length
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
