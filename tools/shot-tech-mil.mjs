/* =============================================================
 * tools/shot-tech-mil.mjs —— 军事科技图标接线的无头验收：
 *   1) 本地 http 起服（file:// 的内存缓存会吃掉"删图"测试）→ 生成世界
 *      → 开全屏科技树 → 等 17 张军事科技 PNG 加载完 → 截整棵树；
 *   2) 全新隐身上下文（独立渲染进程，绕开 Blink MemoryCache）里
 *      用请求拦截把 item-tech-mil_bronze.png 变成 404（等价于删了这张
 *      PNG）→ 开树 → 该节点应整块回退成全尺寸文字徽章，不报错不空块。
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const errors = [];

async function runRound(opts) {
  /* 每轮一个全新上下文：第二轮必须零缓存，"删图"才测得出来 */
  const ctx = opts.incognito ? await browser.createBrowserContext() : browser.defaultBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });

  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  if (opts.block) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (/item-tech-mil_bronze\.png$/.test(req.url())) req.abort();
      else req.continue();
    });
  }

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction('window.__world || document.querySelector("#gen")', { timeout: 60000 });
  if (!(await page.evaluate('!!window.__world'))) {
    await page.evaluate('document.getElementById("gen").click()');
    await page.waitForFunction('window.__world', { timeout: 180000 });
  }
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate('document.getElementById("techBtn").click()');
  await page.waitForFunction('document.querySelector("#techTree").classList.contains("on")');
  const want = opts.block ? 16 : 17;
  await page.waitForFunction(`(() => {
    const imgs = [...document.querySelectorAll('#techTree .milico img')];
    return imgs.length === ${want} && imgs.every(i => i.complete && i.naturalWidth > 0);
  })()`, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 400));
  /* 测试专供：把"未建学校"的置灰摘掉，看真彩（不动游戏代码，只动这次 DOM） */
  if (!opts.block) {
    await page.evaluate(`(() => {
      document.querySelectorAll('#techTree .ttnode.lock').forEach(n => {
        n.classList.remove('lock'); n.classList.add('avail');
      });
    })()`);
  }
  return { page, errs };
}

/* ---- 第一轮：真图标 + 角标 ---- */
const r1 = await runRound({ block: false });
await (await r1.page.$('#techTree')).screenshot({ path: OUT1 });
console.log('saved', path.relative(root, OUT1));
/* 六个代表节点特写（elementHandle.screenshot 会自动滚进视野） */
for (const k of ['mil_bronze', 'mil_matchlock', 'mil_gw', 'mil_catapult', 'mil_galley', 'mil_ironclad']) {
  const el = await r1.page.$(`#techTree [data-tech="${k}"]`);
  if (el) { await el.screenshot({ path: path.join(root, 'shots', 'node-' + k + '.png') }); }
}
console.log('node close-ups saved');
errors.push(...r1.errs);
await r1.page.close();

/* ---- 第二轮：缺图回退（拦截 = 404 = 删图） ---- */
const r2 = await runRound({ block: true, incognito: true });
const check = await r2.page.evaluate(`(() => {
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
const badNode = await r2.page.$('#techTree [data-tech="mil_bronze"]');
if (badNode) await badNode.screenshot({ path: path.join(root, 'shots', 'node-fallback-bronze.png') });
await (await r2.page.$('#techTree')).screenshot({ path: OUT2 });
console.log('saved', path.relative(root, OUT2));
errors.push(...r2.errs);
await r2.page.close();

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.close();
