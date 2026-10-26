/* 一次性验收截图（v18.2 人口承载力）：省卡人口行 + 国家卡「承载」行
 * 跑法：node tools/shot-popcap.mjs
 */
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(import.meta.dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = process.env.TEMP || '/tmp';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => {
  document.getElementById('prov').value = 260;
  document.getElementById('ctry').value = 10;
  document.getElementById('seed').value = 'popcap-shot-1';
  document.getElementById('gen').click();
});
await sleep(2600);

/* 找一个平原省，把人口推到超限（这样两种状态都能截到） */
const info = await page.evaluate(() => {
  const AO = window.AO, D = AO.resDebug, w = D.world();
  const me = w.countries[0].id;
  D.choosePlayer(me);
  let pick = null;
  /* 必须挑**自己**的省：别国省在迷雾下是「未知之地」，卡片根本不出人口行 */
  for (const id of w.countries[0].provinces) {
    const p = w.provinces[id - 1];
    if (!p || p.terrain !== 'plains') continue;
    if (w.countries[0].capital === p.id) continue;
    pick = p; break;
  }
  if (!pick) return null;
  const cap = AO.resPopCap(pick.id);
  AO.resPop[pick.id].v = Math.round(cap * 1.15);   // 超限 → 红签
  const R = window.__renderer;
  R.cam.x = pick.centroid[0]; R.cam.y = pick.centroid[1]; R.cam.scale = 2.2;
  R.camClamp && R.camClamp();
  R.select(pick.id); R.draw();
  D.settleTurn();
  R.select(pick.id); R.draw();
  return { pid: pick.id, owner: pick.owner, cap, pop: AO.resPop[pick.id].v };
});
console.log('省', info && info.pid, 'cap', info && info.cap, 'pop', info && info.pop);
await sleep(700);
/* 卡片默认可能停在「建筑」页签 —— 点回「信息」才看得到人口行 */
await page.evaluate(() => {
  const b = document.querySelector('#info .itab[data-tab="info"]');
  if (b && !b.classList.contains('on')) b.click();
});
await sleep(400);

const el = await page.$('#info');
await el.screenshot({ path: path.join(OUT, 'popcap-card.png') });
console.log('省卡 →', path.join(OUT, 'popcap-card.png'));

/* 再截一张「摸顶」的：人口正好 = cap → 绿签「人丁兴旺」 */
await page.evaluate((a) => {
  const AO = window.AO, D = AO.resDebug, R = window.__renderer;
  AO.resPop[a.pid].v = Math.round(AO.resPopCap(a.pid));
  D.settleTurn();
  R.select(a.pid); R.draw();
}, info);
await sleep(600);
await (await page.$('#info')).screenshot({ path: path.join(OUT, 'popcap-card-cap.png') });
console.log('省卡（摸顶）→', path.join(OUT, 'popcap-card-cap.png'));

/* 国家卡概览 */
await page.evaluate((a) => { window.AO.resDebug.showCountry(a.owner); }, info);
await sleep(600);
const on = await page.evaluate(() => document.getElementById('country').classList.contains('on'));
if (on) {
  await (await page.$('#country')).screenshot({ path: path.join(OUT, 'popcap-country.png') });
  console.log('国家卡 →', path.join(OUT, 'popcap-country.png'));
} else {
  console.log('国家卡没打开，跳过');
}
await browser.close();
