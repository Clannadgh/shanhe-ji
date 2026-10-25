/* =============================================================
 * tools/shot-tech-mil.mjs —— 军事科技图标接线的无头验收：
 *   1) 本地 http 起服（file:// 的内存缓存会吃掉"删图"测试）→ 生成世界
 *      → 开全屏科技树 → 等 17 张军事科技 PNG 加载完 → 截整棵树；
 *   2) 用请求拦截把 item-tech-mil_bronze.png 变成 404（等价于删了这张
 *      PNG）→ 重开树 → 该节点应整块回退成全尺寸文字徽章，不报错不空块。
 * 用法：node tools/shot-tech-mil.mjs
 * ============================================================= */
import path from 'path';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const OUT1 = path.join(root, 'shots', 'tech-tree-mil.png');
const OUT2 = path.join(root, 'shots', 'tech-tree-mil-fallback.png');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('not found'); return; }
    /* no-store：绕开渲染进程的图片内存缓存，否则第二轮重渲的 img
     * 直接命中缓存不发请求，"删图"测不出来 */
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });
await page.setCacheEnabled(false);

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

/* 第二轮用：只拦军事科技那一张 PNG（=删掉它），其余照常 */
let blockMil = false;
await page.setRequestInterception(true);
page.on('request', req => {
  if (blockMil && /item-tech-mil_bronze\.png$/.test(req.url())) req.abort();
  else req.continue();
});

await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
await page.waitForFunction('window.__world || document.querySelector("#gen")', { timeout: 60000 });
if (!(await page.evaluate('!!window.__world'))) {
  await page.click('#gen');
  await page.waitForFunction('window.__world', { timeout: 180000 });
}
await new Promise(r => setTimeout(r, 1200));

async function openTree() {
  /* #techBtn 是 toggle：树开着先点一次关，再点一次开。
   * 用 element.click() 直接派发 —— 全屏 overlay 会吃掉坐标点击。 */
  const wasOpen = await page.evaluate('document.querySelector("#techTree").classList.contains("on")');
  if (wasOpen) {
    await page.evaluate('document.getElementById("techBtn").click()');
    await new Promise(r => setTimeout(r, 250));
  }
  await page.evaluate('document.getElementById("techBtn").click()');
  await page.waitForFunction('document.querySelector("#techTree").classList.contains("on")');
}

/* ---- 第一轮：真图标 + 角标 ---- */
await openTree();
await page.waitForFunction(`(() => {
  const imgs = [...document.querySelectorAll('#techTree .milico img')];
  return imgs.length >= 17 && imgs.every(i => i.complete && i.naturalWidth > 0);
})()`, { timeout: 30000 });
await new Promise(r => setTimeout(r, 400));
await (await page.$('#techTree')).screenshot({ path: OUT1 });
console.log('saved', path.relative(root, OUT1));

/* ---- 第二轮：缺图回退（拦截 = 404 = 删图） ---- */
blockMil = true;
await openTree();
let st = null, hit = false;
for (let i = 0; i < 8 && !hit; i++) {
  await new Promise(r => setTimeout(r, 2000));
  st = await page.evaluate(`(() => {
    const imgs = [...document.querySelectorAll('#techTree .milico img')];
    const bh = document.querySelector('#techTree [data-tech="mil_bronze"] .h');
    return { nMil: imgs.length,
      ok: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      bronze: bh ? bh.innerHTML.slice(0, 120) : '(missing)' };
  })()`);
  console.log('t+' + ((i + 1) * 2) + 's', JSON.stringify(st));
  hit = st.nMil === 16 && st.ok === 16;
}
if (!hit) throw new Error('fallback state not reached');
const check = await page.evaluate(`(() => {
  const node = document.querySelector('#techTree [data-tech="mil_bronze"] .h');
  const img = node.querySelector('img');
  const badge = node.querySelector('svg.mbadge');
  const empty = [...document.querySelectorAll('#techTree .ttnode .h')]
    .filter(h => {
      const i = h.querySelector('img');
      const s = h.querySelector('svg');
      return !((i && i.complete && i.naturalWidth > 0) || s);
    }).length;
  return { hasImg: !!img, fullBadge: !!badge, badgeW: badge ? badge.getAttribute('width') : null, emptyBlocks: empty };
})()`);
console.log('fallback check:', JSON.stringify(check));
await (await page.$('#techTree')).screenshot({ path: OUT2 });
console.log('saved', path.relative(root, OUT2));

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.close();
