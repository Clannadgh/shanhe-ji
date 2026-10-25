/* tools/cover-shot.mjs —— 出封面用的 1600×1200（dpr2）截图
 * 构造一个有说服力的"游玩中"状态：已知世界连成一片、边角仍是羊皮纸、
 * 一部分情报已经泛黄。真实渲染，不做后期伪造。 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const browser = await puppeteer.launch({ headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1800));
await page.evaluate(() => {
  document.getElementById('seed').value = 'shanhe-2026';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 6500));

const info = await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer, w = D.world();
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  D.setTurn(40);                 // 回合数要像个"玩了很久"的局，也让"陈旧 N 回合"读得通
  const P = D.player();
  const cap = w.provinces[(w.countries[P - 1].capital || 1) - 1];
  const cx = cap.centroid[0], cy = cap.centroid[1];
  const R0 = Math.max(w.meta.width, w.meta.height) * 0.34;
  /* 已知世界：离首都 R0 以内的省都探过（近的旧、远的新，做出"泛黄梯度"） */
  const turn = D.turn();
  for (const p of w.provinces) {
    const dx = p.centroid[0] - cx, dy = p.centroid[1] - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > R0) continue;
    D.fogSee(P, p.id, true);
    const k = P + '|' + p.id;
    const rec = D.fogLastSeen[k];
    if (!rec) continue;
    /* 越靠近首都越旧（0 / 7 / 24 回合成三档黄） */
    const age = d < R0 * 0.55 ? 24 : d < R0 * 0.88 ? 7 : 0;
    rec.t = turn - age;
    rec.bt = rec.t;
  }
  /* 军队站在边境上，军旗出镜 */
  let border = null;
  for (const p of w.provinces) {
    if (p.owner !== P) continue;
    if (p.neighbors.some(id => w.provinces[id - 1].owner !== P)) { border = p; break; }
  }
  if (border) {
    const a = D.newArmy(P, border.id, { type: 'army', tier: 'ironwp', men: 14000 });
    a.order = { type: 'defend', cid: P, pid: border.id, tactic: 'assault' };
    D.fogSee(P, border.id, true);
  }
  D.fogInvalidate();
  /* 相机：坐在"已知 / 未测绘"的边界上，让三态同框 */
  R.cam.x = cx + w.meta.width * 0.10;
  R.cam.y = cy;
  R.cam.scale = 1.06;
  R.clampCam();
  R.fogRefresh();
  /* 关掉国家卡（选国时自动弹出来的）与省卡：封面主图只留地图本身，
   * 省卡另外单独截一张（作为封面上的小插图，比让它在画面里被裁掉好看）。 */
  document.getElementById('country').classList.remove('on');
  document.getElementById('info').classList.remove('on');
  /* 收掉左侧工坊面板和提示，让地图自己说话 */
  const hide = ['panel', 'panelOpen', 'modeHint', 'toast'];
  for (const id of hide) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  const box = document.getElementById('turnBox'); if (box) box.style.opacity = '0.92';
  return { P, name: w.countries[P - 1].name, plan: D.fogPlan(), provs: w.provinces.length,
           countries: w.countries.length };
});
console.log(JSON.stringify(info));
await new Promise(r => setTimeout(r, 900));
const buf = await page.screenshot({ type: 'png' });
fs.writeFileSync(path.join(root, 'shots', 'cover-raw.png'), buf);
console.log('saved shots/cover-raw.png');

/* 再把一张"已探省"的省卡单独截出来（封面上的小插图） */
const cardPid = await page.evaluate(() => {
  const D = window.AO.resDebug, w = D.world();
  let n = 0, pick = 0;
  for (let i = 1; i <= w.provinces.length; i++) {
    if (D.fogVis(i) === 1 && D.fogBucket(i) === 2) { pick = i; if (++n > 8) break; }
  }
  if (!pick) for (let i = 1; i <= w.provinces.length; i++) if (D.fogVis(i) === 1) { pick = i; break; }
  D.showInfo(pick);
  return pick;
});
await new Promise(r => setTimeout(r, 500));
const card = await page.$('#info');
if (card) {
  await card.screenshot({ path: path.join(root, 'shots', 'cover-card.png') });
  console.log('saved shots/cover-card.png · pid ' + cardPid);
}
await browser.close();
