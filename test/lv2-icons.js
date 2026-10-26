/* =============================================================
 * test/lv2-icons.js —— Lv2 建筑独立图标：三处接线 + 兜底
 *
 * 对着任务验收清单逐条过：
 *   1) 科技树每条科技的图标 = 该建筑 Lv2 图（≠ 该建筑 Lv1 图）
 *   2) 省卡建筑行：tiers[2]>0 → Lv2 图；纯 Lv1 的省仍是 Lv1 图
 *   3) ？面板「档位」区：Lv1 / Lv2 两张图并排，src 不同
 *   4) 兜底：-bld-2 缺图 → 退到 -bld → 再退到内联 SVG，不抛错
 *
 * 用法：node test/lv2-icons.js
 * ============================================================= */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const RES = path.join(root, 'assets', 'res');
const shot = (n) => path.join(root, 'shots', n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const KEYS = ['iron', 'gold', 'grain', 'horse', 'timber', 'fish', 'salt'];
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  const checks = [];
  const ck = (name, ok, note) => { checks.push([name, !!ok, note || '']); };

  /* ---- 0) 素材层：7 张 Lv2 图存在，且和 Lv1 不是同一张 ---- */
  for (const k of KEYS) {
    const a = path.join(RES, 'item-' + k + '-bld.png');
    const b = path.join(RES, 'item-' + k + '-bld-2.png');
    const has = fs.existsSync(a) && fs.existsSync(b);
    ck('素材 ' + k + '：Lv1/Lv2 两张都在且不同',
      has && md5(a) !== md5(b) && fs.statSync(b).size > 1500,
      has ? (fs.statSync(b).size + 'B') : '缺文件');
  }

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);

  /* ---- 1) 科技树：每条科技的图标都必须是 Lv2 图 ---- */
  /* v16：存档/读档/科技/治理/编年史 收进了 ☰ 菜单，先把菜单打开再点 */
  await page.click('#menuBtn');
  await sleep(150);
  await page.click('#techBtn');
  await sleep(300);
  const nodes = await page.evaluate(() => [...document.querySelectorAll('#ttNodes .ttnode')].map(n => {
    const el = n.querySelector('.h img.bart-img, .h svg.bart');
    const t = window.AO.TECH_BY_KEY[n.getAttribute('data-tech')] || {};
    return {
      tech: n.getAttribute('data-tech'),
      name: n.querySelector('.tx b') ? n.querySelector('.tx b').textContent : '',
      tag: el ? el.tagName.toLowerCase() : 'none',
      src: el ? (el.currentSrc || el.src || '') : '',
      lv: el ? el.getAttribute('data-lv') : '',
      global: !t.for,
      ok: el && el.tagName.toLowerCase() === 'img' ? el.naturalWidth > 0 : !!el
    };
  }));
  const techTotal = await page.evaluate(() => window.AO.TECHS.length);
  ck('科技树节点数 = TECHS 长度（' + techTotal + '）', nodes.length === techTotal, nodes.length + ' 条');
  /* 资源科技：图标必须是该建筑 Lv2 的图；全局科技（for:null）另有一套概念图 */
  for (const n of nodes) {
    const f = (n.src || '').split('/').pop();
    if (n.global) {
      ck('全局科技「' + n.name + '」用 item-tech-*.png',
        n.tag === 'img' && /^item-tech-.+\.png$/.test(f) && n.ok, f || n.tag);
      continue;
    }
    ck('科技「' + n.name + '」用 Lv2 图', n.tag === 'img' && /-bld-2\.png$/.test(f) && n.ok && n.lv === '2',
      f || n.tag);
  }
  await page.screenshot({ path: shot('lv2-tech.png') });

  /* ---- 2) 省卡建筑行：纯 Lv1 的省看老图；升到 Lv2 换新图 ---- */
  const P = await page.evaluate(() => {
    const w = window.__world, R = window.__renderer;
    let q = null;
    for (const c of w.countries) {
      const p = w.provinces[c.capital - 1];
      if (p && p.resources && p.resources.length >= 5) { q = p; break; }
    }
    if (!q) for (const p of w.provinces) if (p && p.resources && p.resources.length >= 5) { q = p; break; }
    if (!q) return null;
    R.cam.x = q.centroid[0]; R.cam.y = q.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(q.id); R.draw();
    return { id: q.id, owner: q.owner, name: q.name };
  });
  if (!P) { console.log('FAIL 找不到合适的省'); await browser.close(); process.exit(1); }

  /* 把「建筑」页签展开，方便截图 */
  await page.evaluate(() => {
    const b = document.querySelector('#infoTabs .itab[data-tab="bld"]');
    if (b && !b.classList.contains('on')) b.click();
  });
  await sleep(300);

  const rows = () => page.evaluate(() => [...document.querySelectorAll('#iBldList .rr.bld')].map(r => {
    const img = r.querySelector('img.bart-img, svg.bart');
    return {
      name: r.querySelector('.nm') ? r.querySelector('.nm').textContent : '',
      src: img && img.tagName.toLowerCase() === 'img' ? (img.currentSrc || img.src) : '',
      tag: img ? img.tagName.toLowerCase() : 'none',
      lv: img ? img.getAttribute('data-lv') : '',
      ok: img && img.tagName.toLowerCase() === 'img' ? img.naturalWidth > 0 : !!img
    };
  }));

  const before = await rows();
  ck('省卡建筑行全在（≥5 行）', before.length >= 5, before.length + ' 行');
  const lv1Rows = before.filter(r => /-bld\.png$/.test(r.src));
  ck('纯 Lv1 的省：建筑行仍是 Lv1 图', lv1Rows.length === before.length && before.every(r => r.lv === '1'),
    before.map(r => r.name + ':' + (r.src.split('/').pop() || r.tag)).join(' | '));
  await page.screenshot({ path: shot('lv2-prov-lv1.png') });

  /* 升级一座：把该省某建筑改成 tiers[2]=1，然后重渲染 */
  const target = await page.evaluate((pid) => {
    const w = window.__world, R = window.__renderer;
    const p = w.provinces[pid - 1];
    const bag = window.AO.resSim[pid];
    const r = p.resources.find(x => x.key === 'grain') || p.resources[0];
    const s = bag[r.key];
    s.built = Math.max(1, s.built | 0);
    s.tiers = s.tiers || { 1: 0, 2: 0 };
    s.tiers[1] = Math.max(0, (s.tiers[1] | 0) - 1);
    s.tiers[2] = (s.tiers[2] | 0) + 1;
    s.site = 0;
    const tech = window.AO.techFor(r.key);
    if (tech) window.AO.resResearch[p.owner].done[tech.key] = true;
    R.select(pid); R.draw();
    return { key: r.key, tiers: Object.assign({}, s.tiers) };
  }, P.id);
  await sleep(300);

  const after = await rows();
  const upRow = after.find(r => /-bld-2\.png$/.test(r.src));
  ck('升了 Lv2 的建筑行换 Lv2 图', !!upRow && upRow.ok && upRow.lv === '2',
    upRow ? upRow.name + ' → ' + upRow.src.split('/').pop() : '没找到 Lv2 行');
  ck('没升的行仍然用 Lv1 图', after.filter(r => /-bld\.png$/.test(r.src)).length === after.length - 1,
    after.map(r => r.name + ':' + (r.src.split('/').pop() || r.tag)).join(' | '));
  await page.screenshot({ path: shot('lv2-prov-lv2.png') });

  /* ---- 3) ？面板：两档并排、两张不同图 ---- */
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('#iBldList .rr.bld')];
    const row = all.find(x => {
      const img = x.querySelector('img.bart-img');
      return img && /-bld-2\.png$/.test(img.src);
    }) || all[0];
    row.querySelector('.qbtn').click();
  });
  await sleep(250);
  const tiers = await page.evaluate(() => {
    const pn = document.querySelector('#iBldList .qinfo.on');
    if (!pn) return [];
    return [...pn.querySelectorAll('.tiers .tr')].map(tr => {
      const img = tr.querySelector('img.bart-img, svg.bart');
      return {
        lv: tr.querySelector('b') ? tr.querySelector('b').textContent : '',
        src: img && img.tagName.toLowerCase() === 'img' ? (img.currentSrc || img.src) : '',
        tag: img ? img.tagName.toLowerCase() : 'none',
        ok: img && img.tagName.toLowerCase() === 'img' ? img.naturalWidth > 0 : !!img
      };
    });
  });
  ck('？面板档位区两格', tiers.length === 2, tiers.map(t => t.lv + ':' + (t.src.split('/').pop() || t.tag)).join(' | '));
  if (tiers.length === 2) {
    ck('两档用的是两张不同的图',
      /-bld\.png$/.test(tiers[0].src) && /-bld-2\.png$/.test(tiers[1].src) && tiers[0].src !== tiers[1].src,
      tiers[0].src.split('/').pop() + ' vs ' + tiers[1].src.split('/').pop());
    ck('两档图都真的加载出来了', tiers[0].ok && tiers[1].ok);
  }
  await page.screenshot({ path: shot('lv2-qinfo.png') });

  /* ---- 4) 兜底：缺图静默降级，不抛错 ---- */
  const fb = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:-300px;top:0';
    d.innerHTML = '<img class="bart-img" src="assets/res/item-grain-bld-2.png" data-lv="2">';
    document.body.appendChild(d);
    const img = d.firstChild;
    window.AO.imgFallback(img, 'grain', 2, 22);            // 第一步：退到 Lv1 图
    const step1 = img.parentNode ? img.getAttribute('src') : 'gone';
    window.AO.imgFallback(img, 'grain', 2, 22);            // 第二步：换成内联 SVG
    const svg = d.querySelector('svg.bart');
    const out = { step1: step1, svg: !!svg, lv: svg ? svg.getAttribute('data-lv') : '' };
    d.remove();
    return out;
  });
  ck('兜底：Lv2 缺图先退回 Lv1 图', /item-grain-bld\.png$/.test(fb.step1), fb.step1);
  ck('兜底：再缺就换内联 SVG', fb.svg && fb.lv === '2', 'svg=' + fb.svg + ' lv=' + fb.lv);

  /* ---- 汇总 ---- */
  ck('页面无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' / '));

  await browser.close();
  let bad = 0;
  for (const [n, ok, note] of checks) {
    if (!ok) bad++;
    console.log((ok ? 'PASS ' : 'FAIL ') + n + (note ? '  [' + note + ']' : ''));
  }
  console.log('\n' + (checks.length - bad) + ' / ' + checks.length + ' 通过');
  process.exit(bad ? 1 : 0);
})();
