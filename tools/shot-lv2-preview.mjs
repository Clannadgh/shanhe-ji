/* tools/shot-lv2-preview.mjs —— 把 tools/lv2-preview.html 截成一张对比图
 * 用法：node tools/shot-lv2-preview.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--no-sandbox', '--font-render-hinting=none']
});
const page = await browser.newPage();
await page.setViewport({ width: 520, height: 700, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(here, 'lv2-preview.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 600));
const body = await page.$('table');
await body.screenshot({ path: path.join(root, 'shots', 'lv2-preview.png'), omitBackground: false });
console.log('saved shots/lv2-preview.png');
await browser.close();
