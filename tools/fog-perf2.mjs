/* tools/fog-perf2.mjs —— 拆开量：迷雾三段各花多少 */
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
await page.evaluate(() => { document.getElementById('seed').value = 'aoh-2026'; document.getElementById('gen').click(); });
await new Promise(r => setTimeout(r, 7000));
console.log(JSON.stringify(await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  R.fogRefresh();
  const ctx = R.baseCtx, s = R.cam.scale, dpr = R.dpr;
  const setT = () => {
    ctx.setTransform(dpr * s, 0, 0, dpr * s,
      dpr * (R.cssW / 2 - R.cam.x * s), dpr * (R.cssH / 2 - R.cam.y * s));
  };
  const t = (fn, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { setT(); fn(); } return (performance.now() - t0) / n; };
  const res = {};
  res.fillPol = t(() => R._fillFogPolitical(ctx), 5);
  res.paint = t(() => R._paintFog(ctx, s), 5);
  res.border = t(() => { ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke(R.borderPath); }, 5);
  res.coast = t(() => { ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke(R.coastPath); }, 5);
  res.rivers = t(() => { for (const p of R.riverPaths) ctx.stroke(p); }, 5);
  res.allRing = t(() => { ctx.strokeStyle = '#333'; ctx.stroke(R.allRingPath); }, 5);
  /* 单独量"建 unk 路径"（不含填充） */
  res.buildUnk = t(() => {
    const p = new Path2D();
    for (const pr of w.provinces) { if (D.fogVis(pr.id) === 0) for (const r of pr.rings) {
      const pts = r.coords, n = pts.length >> 1;
      p.moveTo(pts[0], pts[1]);
      for (let k = 1; k < n; k++) p.lineTo(pts[k * 2], pts[k * 2 + 1]);
      p.closePath();
    } }
  }, 3);
  return res;
}), null, 1));
await browser.close();
