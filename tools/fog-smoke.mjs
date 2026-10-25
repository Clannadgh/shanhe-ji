/* tools/fog-smoke.mjs —— 迷雾改动的快速冒烟：开一局 → 截图 → 打印三态统计
 * 用法：node tools/fog-smoke.mjs [turns]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const turns = +(process.argv[2] || 6);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));

await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-smoke-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 3000));

const before = await page.evaluate(() => {
  const D = window.AO.resDebug;
  return { plan: D.fogPlan(), player: D.player(), turn: D.turn(), on: D.fogOn() };
});
console.log('工坊模式：', JSON.stringify(before));

const pick = await page.evaluate(() => {
  const D = window.AO.resDebug, w = D.world();
  /* 选一个省数中等的国家，别选最小的 */
  let best = null;
  for (const c of w.countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  return { id: best.id, name: best.name, provs: best.provinces.length, plan: D.fogPlan() };
});
console.log('选国：', JSON.stringify(pick));
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(root, 'shots', 'fog-1-start.png') });

/* 点一个未探省，看省卡 */
const cardUnknown = await page.evaluate(() => {
  const D = window.AO.resDebug;
  for (let i = 1; i <= D.world().provinces.length; i++) {
    if (D.fogVis(i) === 0) { window.__renderer.select(i); return { pid: i, name: D.world().provinces[i - 1].name }; }
  }
  return null;
});
await new Promise(r => setTimeout(r, 350));
await page.screenshot({ path: path.join(root, 'shots', 'fog-2-unknown.png') });
const unknownHtml = await page.evaluate(() => document.getElementById('infoEmpty').innerHTML);
console.log('未知省卡：', cardUnknown, unknownHtml.slice(0, 80));

/* 跑回合 */
for (let i = 0; i < turns; i++) {
  await page.evaluate(() => window.AO.resDebug.nextTurn());
  await new Promise(r => setTimeout(r, 120));
}
const after = await page.evaluate(() => {
  const D = window.AO.resDebug;
  return { plan: D.fogPlan(), turn: D.turn(), rel: Object.keys(D.fogRel).length,
           budget: D.fogBudgetOf(D.player()), notes: D.notes().slice(-3).map(n => n.text) };
});
console.log('跑完 ' + turns + ' 回合：', JSON.stringify(after));
await page.screenshot({ path: path.join(root, 'shots', 'fog-3-turns.png') });

/* 打开治理面板 */
await page.evaluate(() => { const D = window.AO.resDebug; D.openGov(D.player()); });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(root, 'shots', 'fog-4-gov.png') });
const govHtml = await page.evaluate(() => ({
  budget: document.getElementById('gpIntelB').innerHTML.slice(0, 120),
  tip: document.getElementById('gpIntelTip').textContent,
  list: document.getElementById('gpIntelList').textContent.slice(0, 200)
}));
console.log('情报节：', JSON.stringify(govHtml));

console.log('错误：', errs.length ? errs : '无');
await browser.close();
