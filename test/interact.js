/* 浏览器内交互 + 导出 + 自检的端到端测试 */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const dl = path.join(root, 'test', 'downloads');
if (!fs.existsSync(dl)) fs.mkdirSync(dl, { recursive: true });
for (const f of fs.readdirSync(dl)) fs.unlinkSync(path.join(dl, f));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2500));

  /* --- 1. 找一个陆地像素并点击 --- */
  const target = await page.evaluate(() => {
    const w = window.__world, R = window.__renderer;
    const W = w.meta.width, H = w.meta.height;
    for (let y = 100; y < H - 100; y += 7) {
      for (let x = 100; x < W - 100; x += 7) {
        const idx = y * W + x;
        const l = w.labels[idx];
        if (!l) continue;
        // 要求 3x3 邻域同省，避免点在海崖上一像素外（那是命中检测的正确行为）
        let solid = true;
        for (let dy = -1; dy <= 1 && solid; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (w.labels[idx + dy * W + dx] !== l) { solid = false; break; }
          }
        }
        if (!solid) continue;
        const s = R.toScreen(x + 0.5, y + 0.5);
        return { x, y, id: l, sx: s.x, sy: s.y };
      }
    }
    return null;
  });
  console.log('land target', JSON.stringify(target));

  await page.mouse.click(target.sx, target.sy);
  await new Promise(r => setTimeout(r, 300));
  const info = await page.evaluate(() => ({
    visible: document.getElementById('infoBody').style.display !== 'none',
    name: document.getElementById('iName').textContent,
    en: document.getElementById('iNameEn').textContent,
    owner: document.getElementById('iOwner').textContent,
    terrain: document.getElementById('iTerrain').textContent,
    deg: document.getElementById('iDeg').textContent,
    selected: window.__renderer.selected
  }));
  console.log('after click:', JSON.stringify(info));
  console.log(info.visible && info.name && info.selected === target.id ? '  PASS 选中省份' : '  FAIL 选中省份');

  /* --- 2. 涂色 --- */
  const paintRes = await page.evaluate(async () => {
    const R = window.__renderer, w = window.__world;
    /* 点色块会切到「涂色」模式，而切模式会把省份选中态清掉 ——
     * 所以先把要涂的那个省记下来，别用 R.selected（那会儿已经是 0 了）。 */
    const pid = R.selected;
    const before = w.provinces[pid - 1].owner;
    // 选一个相邻但不同归属的国家，避免"本来就是它"直接返回
    // 直接点第一个色块（有 title 的那个国家）
    const sw = document.querySelector('#swatches .sw');
    sw.click();
    const targetOwner = +sw.dataset.cid;
    R.paint(pid);
    return {
      before, targetOwner,
      after: w.provinces[pid - 1].owner,
      inCountry: w.countries[targetOwner - 1].provinces.indexOf(pid) >= 0,
      oldCountryHasIt: w.countries[before - 1].provinces.indexOf(pid) >= 0
    };
  });
  console.log('paint:', JSON.stringify(paintRes));
  console.log(paintRes.after === paintRes.targetOwner && paintRes.inCountry && !paintRes.oldCountryHasIt
    ? '  PASS 涂色改归属' : '  FAIL 涂色改归属');

  /* --- 3. 悬停 --- */
  await page.mouse.move(target.sx + 3, target.sy + 3);
  await new Promise(r => setTimeout(r, 200));
  const hoverOk = await page.evaluate(() => window.__renderer.hover !== 0);
  console.log(hoverOk ? '  PASS 悬停命中' : '  FAIL 悬停命中');

  /* --- 4. 缩放 --- */
  const zoom = await page.evaluate(() => {
    const R = window.__renderer;
    const s0 = R.cam.scale;
    R.cam.scale = s0 * 2; R.clampCam(); R.draw();
    return { s0, s1: R.cam.scale };
  });
  console.log('zoom', JSON.stringify(zoom));

  /* --- 5. 导出 --- */
  /* 面板默认收起（body.panel-collapsed），导出钮在屏幕外 —— 先展开 */
  await page.evaluate(() => { const b = document.getElementById('panelOpen'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 400));
  await page.click('#expGeo');
  await new Promise(r => setTimeout(r, 900));
  await page.click('#expJson');
  await new Promise(r => setTimeout(r, 1200));

  const files = fs.readdirSync(dl);
  console.log('downloads:', files.join(', '));
  const geoFile = files.find(f => f.endsWith('.geojson'));
  const jsonFile = files.find(f => f.endsWith('.json') && !f.endsWith('.geojson'));
  if (geoFile) {
    const gj = JSON.parse(fs.readFileSync(path.join(dl, geoFile), 'utf8'));
    const f0 = gj.features[0];
    const okType = gj.type === 'FeatureCollection';
    const okProps = ['id', 'name', 'name_en', 'owner', 'owner_name', 'owner_color', 'terrain', 'area', 'centroid', 'neighbors']
      .every(k => f0.properties[k] !== undefined);
    const okGeom = f0.geometry.type === 'MultiPolygon' && Array.isArray(f0.geometry.coordinates[0][0][0]);
    const ringClosed = f0.geometry.coordinates.every(poly =>
      poly.every(ring => {
        const a = ring[0], b = ring[ring.length - 1];
        return a[0] === b[0] && a[1] === b[1];
      }));
    console.log('geojson:', f0.properties.name, '| features', gj.features.length,
      '| type', okType, '| props', okProps, '| geom', okGeom, '| closed', ringClosed,
      '| KB', (fs.statSync(path.join(dl, geoFile)).size / 1024).toFixed(0));
    console.log(okType && okProps && okGeom && ringClosed ? '  PASS GeoJSON 结构' : '  FAIL GeoJSON 结构');
  }
  if (jsonFile) {
    const g = JSON.parse(fs.readFileSync(path.join(dl, jsonFile), 'utf8'));
    const metaKeys = ['seed', 'width', 'height', 'provinceCount', 'countryCount', 'coordinateSystem'];
    const okMeta = metaKeys.every(k => g.meta[k] !== undefined);
    // 双向一致
    let bad = 0;
    for (const c of g.countries) for (const pid of c.provinces) {
      const p = g.provinces.find(q => q.id === pid);
      if (!p || p.owner !== c.id) bad++;
    }
    // 邻接表：无向去重，且与省份 neighbors 数组互相印证
    const byId = new Map(g.provinces.map(p => [p.id, p]));
    let asym = 0;
    for (const e of g.adjacency) {
      const a = byId.get(e[0]), b = byId.get(e[1]);
      if (!a || !b || a.neighbors.indexOf(e[1]) < 0 || b.neighbors.indexOf(e[0]) < 0) asym++;
    }
    // 反查：neighbors 里出现的每一条都必须存在于边表
    const eset = new Set(g.adjacency.map(e => Math.min(e[0], e[1]) + '-' + Math.max(e[0], e[1])));
    let missing = 0;
    for (const p of g.provinces) for (const q of p.neighbors) {
      if (!eset.has(Math.min(p.id, q) + '-' + Math.max(p.id, q))) missing++;
    }
    console.log('game json: meta', okMeta, '| 省', g.provinces.length, '| 国', g.countries.length,
      '| 邻接', g.adjacency.length, '| 归属冲突', bad, '| 不对称', asym, '| 边表缺漏', missing,
      '| KB', (fs.statSync(path.join(dl, jsonFile)).size / 1024).toFixed(0));
    console.log(okMeta && bad === 0 && asym === 0 && missing === 0 ? '  PASS 游戏 JSON' : '  FAIL 游戏 JSON');
  }

  /* --- 6. 浏览器内自检 --- */
  await page.click('#runTest');
  await page.waitForFunction(() => {
    const t = document.getElementById('test');
    return t && t.textContent.indexOf('全部通过') >= 0 || t.textContent.indexOf('存在失败项') >= 0;
  }, { timeout: 30000 }).catch(() => {});
  const testText = await page.evaluate(() => document.getElementById('test').innerText);
  console.log('\n--- 页面自检 ---\n' + testText);

  /* --- 7. 换 seed 重新生成 --- */
  await page.evaluate(() => { document.getElementById('seed').value = 'another-world'; });
  await page.click('#gen');
  await new Promise(r => setTimeout(r, 3000));
  const regen = await page.evaluate(() => ({
    seed: window.__world.meta.seed,
    prov: window.__world.meta.provinceCount,
    btn: document.getElementById('gen').textContent
  }));
  console.log('regenerated:', JSON.stringify(regen));

  if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
  else console.log('\n无 JS 报错');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
