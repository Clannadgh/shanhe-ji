/* 科技树实况检查：把节点 key / 标题都打出来，并截一张图
 * 跑法：node tools/check-techtree.js
 */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');
const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
  page.on('pageerror', e => console.log('PAGEERR:', e.message));
  const target = process.argv[2] || 'index.html';
  const tag = target.indexOf('dist') >= 0 ? 'dist-' : '';
  await page.goto('file://' + path.join(root, target).replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await sleep(1400);
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'techtree-check';
    document.getElementById('gen').click();
  });
  await sleep(2400);
  const info = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO;
    D.choosePlayer(1);
    /* 教育拉高，树才不是全锁着 */
    AO.resTalent[1].total = 40; AO.resTalent[1].pts = 200;
    AO.resResearch[1].unlocked = true;
    document.getElementById('techBtn').click();
    const nodes = Array.from(document.querySelectorAll('#ttNodes .ttnode')).map(n => ({
      key: n.getAttribute('data-tech'),
      title: (n.querySelector('.tx b') || {}).textContent || ''
    }));
    return { n: nodes.length, nodes: nodes };
  });
  console.log(target + ' 节点数 =', info.n);
  const mil = info.nodes.filter(x => /^mil_|^leather$/.test(x.key));
  console.log('军事/工艺节点：');
  for (const m of mil) console.log('   ', m.key.padEnd(16), m.title);
  await sleep(400);
  const dim = await page.evaluate(() => {
    const cv = document.getElementById('ttCanvas');
    const st = document.getElementById('ttStage');
    return { cw: cv.offsetWidth, ch: cv.offsetHeight, sw: st.clientWidth, sh: st.clientHeight };
  });
  console.log('canvas', JSON.stringify(dim));
  /* 整张树（不是视口）：把 canvas 单独截出来 */
  const el = await page.$('#ttCanvas');
  await el.screenshot({ path: path.join(root, 'shots', 'v19-techtree' + tag + '.png') });
  /* 再看一眼"刚打开时"视口里能看见什么 */
  await page.evaluate(() => {
    const st = document.getElementById('ttStage');
    st.scrollTop = 0; st.scrollLeft = 0;
  });
  await page.screenshot({ path: path.join(root, 'shots', 'v19-techtree-view' + tag + '.png') });
  await browser.close();
})();
