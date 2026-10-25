/* =============================================================
 * tools/shot-tech-mil.mjs —— 军事科技图标接线的无头验收：
 *   1) 真开一局（#gen）→ 点 #techBtn 开全屏科技树 → 等 17 张军事科技
 *      PNG 全部加载完 → 截整棵树（真图标 + 右下角标）；
 *   2) 拦掉 item-tech-mil_bronze.png 再重开一次树 → 该节点应整块回退成
 *      全尺寸文字徽章，不报错、不空块。
 * 用法：node tools/shot-tech-mil.mjs
 * ============================================================= */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const OUT1 = path.join(root, 'shots', 'tech-tree-mil.png');
const OUT2 = path.join(root, 'shots', 'tech-tree-mil-fallback.png');

/* 第二轮用：把青铜那张 PNG 临时改名（模拟"任删一张"），验完恢复 */
import fs from 'fs';
const VICTIM = path.join(root, 'assets', 'res', 'item-tech-mil_bronze.png');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });
await page.setCacheEnabled(false);

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
/* 可能自动恢复了上一局（localStorage），菜单不出现 —— 有世界就直接用 */
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

/* ---- 第二轮：缺图回退（临时删掉那张 PNG） ---- */
fs.renameSync(VICTIM, VICTIM + '.bak');
try {
  await openTree();
  let state = null, hit = false;
  for (let i = 0; i < 8 && !hit; i++) {
    await new Promise(r => setTimeout(r, 2000));
    state = await page.evaluate(`(() => {
      const imgs = [...document.querySelectorAll('#techTree .milico img')];
      const bh = document.querySelector('#techTree [data-tech="mil_bronze"] .h');
      return {
        treeOn: document.querySelector('#techTree').classList.contains('on'),
        nMil: imgs.length,
        ok: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        bronzeHtml: bh ? bh.innerHTML.slice(0, 160) : '(node missing)'
      };
    })()`);
    console.log('t+' + ((i + 1) * 2) + 's', JSON.stringify(state));
    hit = state.nMil === 16 && state.ok === 16;
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
} finally {
  fs.renameSync(VICTIM + '.bak', VICTIM);               // 无论成败都把图放回去
  if (errors.length) console.log('ERRORS so far:\n' + errors.join('\n'));
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
