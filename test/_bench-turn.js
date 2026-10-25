/* 一次性：量"改一个省的归属 → 地图更新"的真实成本（设计玩法用） */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');
const root = path.join(__dirname, '..');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2600));
  const r = await page.evaluate(() => {
    const R = window.__renderer, w = R.world;
    const sync = () => R.baseCtx.getImageData(0, 0, 1, 1);
    function t(label, fn, n) {
      fn(); sync();
      const a = [];
      for (let i = 0; i < n; i++) { sync(); const t0 = performance.now(); fn(); sync(); a.push(performance.now() - t0); }
      a.sort((x, y) => x - y);
      return { label, med: +a[a.length >> 1].toFixed(1) };
    }
    const out = [];
    out.push(t('_buildGeometry', () => R._buildGeometry(), 6));
    out.push(t('_buildMinimap', () => R._buildMinimap(), 6));
    out.push(t('_renderBase', () => { R._needBase = true; R._renderBase(); }, 6));
    // 一个真实动作：把某省划给邻国（等价于 paint）
    const victim = w.provinces.find(p => p && p.neighbors.length > 2 && w.provinces[p.neighbors[0]].owner !== p.owner);
    const target = w.provinces[victim.neighbors[0]].owner;
    out.push(t('paint 一个省', () => {
      victim.owner = target;
      R.rebuild();
    }, 4));
    // 1000 次简单算术的基准，用来判断上面的数字是不是被噪声主导
    let sink = 0;
    out.push(t('空转 1000 次', () => { for (let i = 0; i < 1000; i++) sink += i * 0.5; }, 6));
    return { out, countryCount: w.countries.length, provCount: w.provinces.length, sink };
  });
  for (const o of r.out) console.log(o.label.padEnd(16), o.med + 'ms');
  console.log('国家', r.countryCount, '省', r.provCount);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
