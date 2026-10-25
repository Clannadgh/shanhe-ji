/* tools/shot-rows.mjs —— 截「通用 / 军备」两栏，检查内政批三张建筑图的实际观感。
 * 用法：node tools/shot-rows.mjs
 * 产出：shots/inner-rows.png（省份卡右栏）+ shots/inner-rows-zoom.png（行图标 4 倍放大）
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(2800);

const info = await page.evaluate(() => {
  const w = window.__world, R = window.__renderer, AO = window.AO, D = AO.resDebug;
  /* 侧栏默认是收起的：先拉开，否则 .bld-col 尺寸为 0，截不了图 */
  document.body.classList.remove('panel-collapsed');
  const c = w.countries[0];
  let best = null;
  for (const id of c.provinces) {
    const p = w.provinces[id - 1];
    if (p && (!best || p.population > best.population)) best = p;
  }
  /* 造出"五件民用 + 六件军备都在"的状态，好一眼看全 11 行 */
  const pid = best.id;
  AO.resGranary[pid] = { n: 2, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
  AO.resUniversity[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
  AO.resFactory[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
  AO.resTalent[1].total = 22;
  AO.resTalent[1].tier = 0;
  AO.resSim[pid].grain.stock = 87;
  R.select(pid); R.draw();
  return { pid: pid, name: best.name };
});

await sleep(400);
/* 省份卡默认停在「信息」页签：切到「建筑」才看得见 .bld-col */
await page.evaluate(() => {
  const b = document.querySelector('.itab[data-tab="bld"]');
  if (b) b.click();
});
await sleep(300);
const col = await page.$('.bld-col');
await col.screenshot({ path: path.join(root, 'shots', 'inner-rows.png') });

/* 4 倍放大的行图标：把新三张并排画一遍，看线宽/留白是否和老的同一套 */
const zoom = await page.evaluate(() => {
  const box = document.createElement('div');
  box.id = 'iconZoom';
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;background:#f7f4ec;' +
    'padding:10px;display:flex;gap:14px;border:1px solid #ccc;border-radius:6px';
  const keys = ['granary', 'factory', 'university'];
  const names = ['粮仓', '工厂', '大学'];
  keys.forEach((k, i) => {
    const d = document.createElement('div');
    d.style.cssText = 'text-align:center;font:11px sans-serif;color:#333';
    /* 正式图标（PNG）—— 和行里用的是同一张 */
    d.innerHTML = '<img src="assets/res/item-' + k + '-bld.png" style="width:88px;height:88px">' +
      '<div>' + names[i] + '</div>';
    box.appendChild(d);
  });
  document.body.appendChild(box);
  return true;
});
await sleep(300);
const box = await page.$('#iconZoom');
if (box) await box.screenshot({ path: path.join(root, 'shots', 'inner-rows-zoom.png'), omitBackground: false });

console.log('saved shots/inner-rows.png · shots/inner-rows-zoom.png  (' + info.name + ' #' + info.pid + ')');
await browser.close();
