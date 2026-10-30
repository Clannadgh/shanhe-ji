/* =============================================================
 * test/narrow.js —— 窄屏（手机竖屏）三块常驻浮层的叠放
 *
 * 起因：手机上打开「纪要」和「建筑」时被左侧面板挡住 —— 左栏、省卡、纪要
 * 全是 position:fixed 钉在角上，窄屏下必然互相压住。改法见 index.html 末尾的
 * @media (max-width: 760px) 和 11-ui.js 的 narrowSingleSurface()。
 *
 * 五条：
 *   1) 窄屏 + 展开左栏 → 纪要自动收起
 *   2) 窄屏 + 开纪要   → 左栏自动收起（互斥双向）
 *   3) 窄屏省卡铺满宽度（左右各留 8），不超出视口
 *   4) 窄屏切到「建筑」页，正文真的显示出来，页签还在视口里
 *   5) 宽屏不受影响：左栏 + 省卡不重叠，且两张浮层可以同时开着
 *
 * 用法：node test/narrow.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const checks = [];
const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

async function boot(browser, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('pageerror', e => checks.push(['JS 报错：' + e.message, false, '']));
  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);
  return page;
}
const flags = (page) => page.evaluate(() => ({
  panel: !document.body.classList.contains('panel-collapsed'),
  notes: document.getElementById('notesPanel').classList.contains('on')
}));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });

  /* ---------------- 窄屏 468 × 648 ---------------- */
  const page = await boot(browser, 468, 648);

  await page.evaluate(() => document.getElementById('notesBtn').click());
  await sleep(150);
  await page.evaluate(() => document.getElementById('panelOpen').click());
  await sleep(300);
  const a = await flags(page);
  ck('窄屏：展开左栏 → 纪要自动收起', a.panel && !a.notes, JSON.stringify(a));

  await page.evaluate(() => document.getElementById('panelToggle').click());   // 收起左栏
  await sleep(250);
  await page.evaluate(() => document.getElementById('panelOpen').click());     // 再展开
  await sleep(250);
  await page.evaluate(() => document.getElementById('notesBtn').click());      // 开纪要
  await sleep(300);
  const b = await flags(page);
  ck('窄屏：开纪要 → 左栏自动收起', !b.panel && b.notes, JSON.stringify(b));

  /* 省卡：铺满宽度 + 页签在视口内 + 建筑页真的有内容 */
  await page.evaluate(() => { document.getElementById('notesBtn').click(); });  // 关纪要
  await sleep(200);
  await page.evaluate(() => {
    const R = window.__renderer;
    R.select(window.__world.provinces[0].id); R.draw();
  });
  await sleep(350);
  const c = await page.evaluate(() => {
    const el = document.getElementById('info'), r = el.getBoundingClientRect();
    /* 「面板」钮现在长在顶栏里（AoC2 版式），它和省卡的关系从"谁压谁"
     * 变成了"两块根本不在一个角" —— 所以断言改成几何不相交。 */
    const bb = document.getElementById('panelOpen').getBoundingClientRect();
    return {
      x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right),
      vw: innerWidth, vh: innerHeight,
      on: el.classList.contains('on'),
      hit: !(bb.right <= r.left || bb.left >= r.right || bb.bottom <= r.top || bb.top >= r.bottom),
      bx: Math.round(bb.x), by: Math.round(bb.y), bw: Math.round(bb.width)
    };
  });
  ck('窄屏：省卡铺满宽度（左右各留 8，不越界）',
    c.on && c.x === 8 && c.right === c.vw - 8,
    'x 14→' + c.x + '，右 ' + c.right + ' / 视口 ' + c.vw);
  /* 旧版那颗浮在左上角的「面板」钮曾经压在省名上。改成顶栏内的一颗图标钮以后，
   * 它离省卡有一个顶栏的距离，永远不会盖住信息 —— 断言直接查重叠。 */
  ck('窄屏：「面板」钮不压省卡',
    !c.hit, '钮 ' + c.bx + ',' + c.by + ' (' + c.bw + 'px) / 省卡 y' + c.y + ' 起');

  /* 「建筑」页的窄屏断言随建筑一起退役（阶段一）：省卡现在只有一页。
   * 剩下的省卡断言（铺满宽度 / 层级）仍然有效。 */

  await page.close();

  /* ---------------- 宽屏 1500 × 940：不该被上面那套影响 ---------------- */
  const wide = await boot(browser, 1500, 940);
  await wide.evaluate(() => {
    const R = window.__renderer;
    R.select(window.__world.provinces[0].id); R.draw();
  });
  await wide.evaluate(() => document.getElementById('panelOpen').click());
  await sleep(300);
  const e = await wide.evaluate(() => {
    const p = document.getElementById('panel').getBoundingClientRect();
    const i = document.getElementById('info').getBoundingClientRect();
    const bb = document.getElementById('panelOpen').getBoundingClientRect();
    return { pr: Math.round(p.right), il: Math.round(i.left), iw: Math.round(i.width),
             hit: !(bb.right <= i.left || bb.left >= i.right || bb.bottom <= i.top || bb.top >= i.bottom) };
  });
  ck('宽屏：左栏展开时省卡右移让位（不咬在一起）',
    e.il >= e.pr, '左栏右沿 ' + e.pr + ' / 省卡左沿 ' + e.il);
  ck('宽屏：「面板」钮同样不压省卡', !e.hit, '重叠=' + e.hit);

  await wide.evaluate(() => document.getElementById('notesBtn').click());
  await sleep(250);
  const f = await flags(wide);
  ck('宽屏：互斥不生效（左栏和纪要各占一角，可以同时开）',
    f.panel && f.notes, JSON.stringify(f));
  await wide.close();

  await browser.close();

  let bad = 0;
  for (const [n, ok, note] of checks) {
    if (!ok) bad++;
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + '    ' + n + (note ? '  —  ' + note : ''));
  }
  console.log('\n' + (checks.length - bad) + ' / ' + checks.length + ' 通过');
  process.exit(bad ? 1 : 0);
})();
