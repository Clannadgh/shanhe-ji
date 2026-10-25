/* 无头浏览器截图 + 控制台报错捕获 */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const out = process.argv[2] || 'shot.png';
const zoom = process.argv[3] ? parseFloat(process.argv[3]) : 0;
const focus = process.argv[4] || '';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2500));

  const info = await page.evaluate(() => {
    const r = window.__r || null;
    return {
      hasWorld: !!(window.AO && AO.generate),
      canvas: (() => { const c = document.getElementById('map'); return c ? [c.width, c.height] : null; })(),
      btn: document.getElementById('gen') ? document.getElementById('gen').textContent : null
    };
  });
  console.log('page:', JSON.stringify(info));
  if (errors.length) console.log('errors:\n' + errors.join('\n'));

  if (zoom) {
    await page.evaluate((z, fx) => {
      const R = window.__renderer;
      if (!R) return;
      if (fx) {
        const id = parseInt(fx, 10);
        const p = R.world.provinces[id - 1];
        if (p) { R.cam.x = p.centroid[0]; R.cam.y = p.centroid[1]; }
      }
      R.cam.scale = z;
      R.clampCam();
      R._needBase = true;
      R.draw();
    }, zoom, focus);
    await new Promise(r => setTimeout(r, 400));
  }

  await page.screenshot({ path: path.join(root, out) });
  console.log('saved', out);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
