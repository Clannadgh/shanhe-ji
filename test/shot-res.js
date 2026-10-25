/* 资源视图截图：远景（只显示铁/金/马）+ 近景（全资源 + 首字） */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2600));

  // 切到资源视图（按钮在收起的面板里也能点）
  await page.evaluate(() => document.querySelector('[data-view="resources"]').click());
  await new Promise(r => setTimeout(r, 500));

  const info = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    if (!R) return { err: 'no renderer' };
    let have = 0, rich = 0, items = 0;
    for (const p of w.provinces) {
      const rs = (p && p.resources) || [];
      if (rs.length) have++;
      items += rs.length;
      if (rs[0] && rs[0].n >= AO.RES_RICH) rich++;
    }
    return { view: R.viewMode, scale: +R.cam.scale.toFixed(3), have, items, rich,
      legend: document.getElementById('resLegend').classList.contains('on'),
      legendRows: document.querySelectorAll('#resLegend .rl').length };
  });
  console.log('far:', JSON.stringify(info));

  // 远景：fit 之后 scale ≈ 0.576 < 1.0 → 只画战略资源
  await page.evaluate(() => { const R = window.__renderer; R.fit(); R.draw(); });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(root, 'shots', 'res-far.png') });

  // 近景：挑一个"邻居资源种类最多"的省，画面里能看到多种图标 + 储量数字
  const near = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    let best = null, bestScore = -1;
    for (const p of w.provinces) {
      const rs = (p && p.resources) || [];
      if (!rs.length) continue;
      const kinds = new Set();
      for (const nid of p.neighbors) {
        const q = w.provinces[nid - 1];
        if (q && q.resources[0]) kinds.add(q.resources[0].key);
      }
      if (kinds.size > bestScore) { bestScore = kinds.size; best = p; }
    }
    if (!best) return null;
    R.cam.x = best.centroid[0];
    R.cam.y = best.centroid[1];
    R.cam.scale = 2.6;
    R.clampCam();
    R._needBase = true;
    R.draw();
    return { id: best.id, key: best.resources[0].key, n: best.resources[0].n,
      name: best.name, kinds: bestScore };
  });
  console.log('near:', JSON.stringify(near));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(root, 'shots', 'res-near.png') });

  /* 第三张：选中一个"两面临海·陡岸"的省，把渔获为什么低写在卡片上 */
  const card = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    let best = null, bestScore = -1;
    for (const p of w.provinces) {
      if (!(p.coastDirs >= 2)) continue;
      const sc = (p.coastSteep || 0) * 100 - (p.riverLen || 0);
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    if (!best) {
      for (const p of w.provinces) if (p.coastDirs) { best = p; break; }
    }
    if (!best) return null;
    R.cam.x = best.centroid[0];
    R.cam.y = best.centroid[1];
    R.cam.scale = 2.0;
    R.clampCam();
    R.select(best.id);
    R.draw();
    const fish = (best.resources || []).find(r => r.key === 'fish');
    return {
      name: best.name, sides: best.coastDirs, steep: +(best.coastSteep || 0).toFixed(2),
      river: best.riverLen | 0, mouth: !!best.riverMouth, fish: fish ? fish.n : null,
      water: (document.getElementById('iWater') || {}).textContent
    };
  });
  console.log('card:', JSON.stringify(card));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(root, 'shots', 'res-card.png') });

  /* 第四张：同一张卡，点「已开发」—— 图标换成铁锭/金锭/粮袋/木板，名字换成产物 */
  const dev = await page.evaluate(() => {
    const b = document.querySelector('#resState [data-st="dev"]');
    if (!b) return null;
    b.click();
    const rows = [...document.querySelectorAll('#iResList .rr')].map(r => ({
      nm: r.querySelector('.nm').textContent,
      src: (r.querySelector('img') || {}).getAttribute ? r.querySelector('img').getAttribute('src') : '',
      n: r.querySelector('em').textContent
    }));
    return { state: window.__uiResState || null, rows };
  });
  console.log('dev:', JSON.stringify(dev));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(root, 'shots', 'res-card-dev.png') });

  /* 第五张：建筑栏（独立一栏），把伐木场的问号打开 —— 看产出与冷静期 */
  const bld = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#iBldList .rr.bld')].map(r => ({
      nm: r.querySelector('.nm').textContent,
      qty: r.querySelector('.qty').textContent,
      src: r.querySelector('img').getAttribute('src')
    }));
    // 打开"林木/伐木场"那一行的问号（可再生能源，有冷静期）
    const target = [...document.querySelectorAll('#iBldList .rr.bld')]
      .find(r => r.querySelector('.nm').textContent === '伐木场')
      || document.querySelector('#iBldList .rr.bld');
    if (target) target.querySelector('.qbtn').click();
    const panel = document.querySelector('#iBldList .qinfo.on');
    return { rows, panel: panel ? panel.textContent.replace(/\s+/g, ' ').trim() : null };
  });
  console.log('bld:', JSON.stringify(bld));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(root, 'shots', 'res-card-bld.png') });

  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  else console.log('no console errors');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
