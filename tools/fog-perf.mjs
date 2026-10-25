/* tools/fog-perf.mjs —— 迷雾的渲染开销（1100 省 / 64 国）
 * 关注两件事：① 底图烘焙（每回合一次）有没有明显变慢；② visOf 的逐省开销
 */
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
  document.getElementById('seed').value = 'aoh-2026';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 7000));

const out = await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  const t = (fn, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };
  D.choosePlayer(best.id);
  R.fogRefresh();
  const res = { provs: w.provinces.length, countries: w.countries.length, plan: D.fogPlan() };
  /* 无迷雾的底图烘焙 */
  D.exitGame();
  R.fogRefresh();
  res.baseNoFog = t(() => R._renderBase(), 5);
  res.minimapNoFog = t(() => R._buildMinimap(), 5);
  /* 有迷雾 */
  D.choosePlayer(best.id);
  R.fogRefresh();
  res.baseFog = t(() => R._renderBase(), 5);
  res.minimapFog = t(() => R._buildMinimap(), 5);
  res.visRebuild = t(() => { D.fogInvalidate(); D.fogVis(1); }, 5);
  /* 逐省判定：1100 省 × 100 遍 */
  res.visPerProv = t(() => { for (let i = 1; i <= w.provinces.length; i++) D.fogVis(i); }, 100) / w.provinces.length * 1000;
  /* 一回合的额外开销（情报 tick，含 64 国自动织网与 AI 探测） */
  res.intelTick = t(() => D.fogSettle(), 3);
  /* 冷烘焙：迷雾刚变过（重建路径）+ 整张底图 */
  D.fogInvalidate();
  var t1 = performance.now();
  R.fogRefresh();
  R._renderBase();
  res.coldBake = performance.now() - t1;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
