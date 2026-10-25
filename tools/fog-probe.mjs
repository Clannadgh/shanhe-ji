/* tools/fog-probe.mjs —— 直接问页面：_paintFog 到底有没有填上 */
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
page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-smoke-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2800));
console.log(JSON.stringify(await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer;
  let best = null;
  for (const c of D.world().countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  const w = D.world();
  const res = { fogOn: D.fogOn(), hasPaint: typeof R._paintFog, plan: D.fogPlan() };
  /* 找第一个 unknown 省，量它的圆心 + 画一张独立测试图 */
  let up = null;
  for (let i = 1; i <= w.provinces.length; i++) if (D.fogVis(i) === 0) { up = w.provinces[i - 1]; break; }
  res.upid = up.id; res.centroid = up.centroid; res.rings = up.rings.length;
  const cv = document.createElement('canvas');
  cv.width = 400; cv.height = 400;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 400, 400);
  const path = new Path2D();
  g.translate(200 - up.centroid[0], 200 - up.centroid[1]);
  for (const r of up.rings) {
    const pts = r.coords, n = pts.length >> 1;
    path.moveTo(pts[0], pts[1]);
    for (let k = 1; k < n; k++) path.lineTo(pts[k * 2], pts[k * 2 + 1]);
    path.closePath();
  }
  g.fillStyle = '#e7ddc6';
  g.fill(path, 'nonzero');
  res.testPx = Array.from(g.getImageData(200, 200, 1, 1).data);
  /* 再看底图：把 base 采样点算对（base 是 dpr 缩放后的世界坐标） */
  R._renderBase();
  const s = R.cam.scale, dpr = R.dpr;
  const cx = Math.round((up.centroid[0] - R.cam.x) * s * dpr + R.base.width / 2);
  const cy = Math.round((up.centroid[1] - R.cam.y) * s * dpr + R.base.height / 2);
  res.baseSize = [R.base.width, R.base.height, dpr, s];
  res.basePx = Array.from(R.baseCtx.getImageData(cx, cy, 1, 1).data);
  res.cam = [R.cam.x, R.cam.y, R.cam.scale];
  res.css = [R.cssW, R.cssH];
  return res;
}), null, 1));
await browser.close();
