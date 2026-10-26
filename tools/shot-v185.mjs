/* 一次性验收截图（v18.5 宣战入口搬家）：
 * 对方卡上的「宣战」钮 + 自己卡上的指路一行。
 * 跑法：node tools/shot-v185.mjs
 */
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(import.meta.dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => {
  document.getElementById('prov').value = 120;
  document.getElementById('ctry').value = 6;
  document.getElementById('seed').value = 'diplo-spec-1';
  document.getElementById('gen').click();
});
await sleep(2600);
await page.evaluate(() => {
  const D = window.AO.resDebug;
  D.choosePlayer(3);
  D.showCountry(4);
  document.querySelector('#cTabs .itab[data-ctab="dip"]').click();
});
await sleep(500);
const box = await page.evaluate(() => {
  const el = document.getElementById('country');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('box', JSON.stringify(box));
const el = await page.$('#country');
await el.screenshot({ path: path.join(root, 'shots', 'v185-declare-other.png') });
await page.evaluate(() => {
  window.AO.resDebug.showCountry(3);
  document.querySelector('#cTabs .itab[data-ctab="dip"]').click();
});
await sleep(400);
await (await page.$('#country')).screenshot({ path: path.join(root, 'shots', 'v185-declare-self.png') });
await browser.close();
console.log('ok', JSON.stringify(box));
