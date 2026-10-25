/* =============================================================
 * test/sim-res.js —— 省份卡「信息 | 建筑」两栏 + 回合结算的回归检查
 *
 * 验这些：
 *   1) 两栏结构：左信息（7 行资源）、右建筑（7 行 + 货运 1 行）；
 *   2) 开局铺底：普通省主资源 ×1、其余 ×0；首都主资源 ×3；
 *   3) 建造吃国家资源：点 ＋ 后中央变少，工地要等工期才变 ×N；
 *   4) 居民先吃：面板写明「本地吃掉 X%」；
 *   5) 货运升级：等级 +1；
 *   6) 建筑没有上限：连着建能到 ×4；
 *   7) 模拟不写回 p.resources。
 *
 * 用法：node test/sim-res.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const shot = (n) => path.join(root, 'shots', n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);

  const picked = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    const caps = {};
    w.countries.forEach(c => { if (c.capital) caps[c.capital] = 1; });
    let q = null;
    for (const p of w.provinces) {
      if (!p || caps[p.id] || !p.resources) continue;
      if (p.resources[0].key !== 'timber') continue;
      if (!q || p.resources[0].n < q.resources[0].n) q = p;
    }
    if (!q) return null;
    R.cam.x = q.centroid[0]; R.cam.y = q.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(q.id); R.draw();
    return { id: q.id, name: q.name, timber: q.resources.find(r => r.key === 'timber').n, owner: q.owner };
  });
  if (!picked) { console.log('FAIL 找不到合适的省'); await browser.close(); process.exit(1); }

  const sim = (key) => page.evaluate((a) => {
    const s = window.AO.resSim[a.id] && window.AO.resSim[a.id][a.key];
    return s ? { built: s.built, site: s.site, stock: s.stock, left: s.left, cool: s.cool, gone: s.gone } : null;
  }, { id: picked.id, key });
  const central = () => page.evaluate((o) => Object.assign({}, window.AO.resCentral[o]), picked.owner);
  const freightLv = () => page.evaluate((id) => window.AO.resFreight[id] || 0, picked.id);
  const rowOf = (name) => `[...document.querySelectorAll('#iBldList .rr.bld')].find(r => r.querySelector('.nm').textContent === '${name}')`;
  const clickAdd = (name) => page.evaluate((expr) => { eval(expr).querySelector('.add').click(); }, rowOf(name));
  const qtyOf = (name) => page.evaluate((expr) => eval(expr).querySelector('.qty').textContent, rowOf(name));
  const clickNext = () => page.click('#nextTurn');
  const turns = async (n) => { for (let i = 0; i < n; i++) { await clickNext(); await sleep(60); } };

  const layout = await page.evaluate(() => ({
    cols: document.querySelectorAll('#infoBody .col').length,
    res: document.querySelectorAll('#iResList .rr').length,
    bld: document.querySelectorAll('#iBldList .rr').length,
    freight: document.querySelectorAll('#iFreightList .rr').length
  }));

  const startQty = { timber: await qtyOf('伐木场'), farm: await qtyOf('农场') };

  const cen0 = await central();
  await clickAdd('伐木场');
  const afterClick = {
    qty: await qtyOf('伐木场'),
    site: (await sim('timber')).site,
    msg: await page.evaluate(() => document.getElementById('bldMsg').textContent)
  };
  const cen1 = await central();
  await page.screenshot({ path: shot('res-bld-1.png') });

  await turns(3);
  const afterBuild = { qty: await qtyOf('伐木场'), site: (await sim('timber')).site };

  const lv0 = await freightLv();
  const cenBeforeUp = await central();
  await page.evaluate(() => document.querySelector('#iFreightList .rr .add').click());
  const lv1 = await freightLv();
  const cenAfterUp = await central();
  const freightMsg = await page.evaluate(() => document.getElementById('bldMsg').textContent);

  /* 货运曲线：损耗每级 −5%、工期单调不增、每级造价固定（不随等级涨） */
  const curve = await page.evaluate(() => {
    const F = window.AO.FREIGHT, out = { loss: [], turns: [], cost: [] };
    for (let lv = 0; lv <= F.maxLv; lv++) {
      out.loss.push(Math.round(F.lossAt(lv) * 100));
      out.turns.push(F.turnsAt(lv));
      out.cost.push(F.costAt(lv));
    }
    return out;
  });
  const fixedCost = curve.cost.every(c => c.timber === 15 && c.grain === 9);
  const everyLevelPays = curve.loss.join() === '30,25,20,15,10,5' &&
    curve.turns.join() === '3,2,2,1,1,1';

  await clickAdd('伐木场'); await turns(3);
  await clickAdd('伐木场'); await turns(3);
  const qty4 = await qtyOf('伐木场');
  await page.screenshot({ path: shot('res-bld-2.png') });

  const cap = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    const c = w.countries.find(x => x.capital);
    const p = w.provinces[c.capital - 1];
    R.cam.x = p.centroid[0]; R.cam.y = p.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(p.id); R.draw();
    return {
      name: p.name,
      rows: [...document.querySelectorAll('#iBldList .rr.bld')].map(r => r.querySelector('.qty').textContent)
    };
  });
  const fishPanel = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#iBldList .rr.bld')].find(r => r.querySelector('.nm').textContent === '渔港');
    row.querySelector('.qbtn').click();
    const el = document.querySelector('#iBldList .qinfo.on');
    return el ? el.textContent.replace(/\s+/g, ' ') : '';
  });
  await page.screenshot({ path: shot('res-bld-3.png') });

  const reserveAfter = await page.evaluate((id) => {
    const p = window.__world.provinces[id - 1];
    return (p.resources.find(r => r.key === 'timber') || {}).n;
  }, picked.id);

  const checks = [
    ['两栏结构（信息 | 建筑）', layout.cols === 2 && layout.res === 7 && layout.bld === 7 && layout.freight === 1,
      '列 ' + layout.cols + ' / 资源 ' + layout.res + ' 行 / 建筑 ' + layout.bld + ' 行 / 货运 ' + layout.freight + ' 行'],
    ['普通省：主资源开局 ×1', startQty.timber === '×1', startQty.timber],
    ['普通省：其余资源开局 ×0', startQty.farm === '×0', startQty.farm],
    ['建造扣中央资源', cen1.timber < cen0.timber && cen1.grain < cen0.grain,
      '木材 ' + cen0.timber + '→' + cen1.timber + '，粮食 ' + cen0.grain + '→' + cen1.grain],
    ['点 ＋ 先开工（不立刻 ×N）', afterClick.qty === '×1' && afterClick.site > 0,
      afterClick.qty + '，在建 ' + afterClick.site + ' 回合'],
    ['工期到了才完工', afterBuild.qty === '×2' && afterBuild.site === 0, afterBuild.qty],
    ['货运升级（损耗下降）', lv1 === lv0 + 1 && /Lv1/.test(freightMsg),
      'Lv' + lv0 + '→Lv' + lv1 + '：' + freightMsg],
    ['货运升级真扣资源', (cenBeforeUp.timber + cenBeforeUp.grain) > (cenAfterUp.timber + cenAfterUp.grain),
      '中央木材 ' + cenBeforeUp.timber + '→' + cenAfterUp.timber +
      '，粮食 ' + cenBeforeUp.grain + '→' + cenAfterUp.grain],
    ['货运每级都有收益', everyLevelPays,
      '损耗 ' + curve.loss.join('/') + '% · 工期 ' + curve.turns.join('/')],
    ['货运升级固定价 15/9', fixedCost,
      curve.cost.map(c => c.timber + '/' + c.grain).join(' ')],
    ['建筑没有上限（建到 ×4）', qty4 === '×4', qty4],
    ['首都：主资源 ×3', cap.rows[0] === '×3', cap.name + ' ' + cap.rows.join(' ')],
    ['居民先吃（面板写明）', /本地吃掉 35%/.test(fishPanel), (fishPanel.match(/本地吃掉 35%[^造]*/) || ['无'])[0]],
    ['模拟不写回储量', reserveAfter === picked.timber, '储量仍为 ' + reserveAfter]
  ];

  let pass = true;
  console.log('省份：' + picked.name + '（林木储量 ' + picked.timber + '，主资源）');
  for (const [name, ok, note] of checks) {
    if (!ok) pass = false;
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + note);
  }
  console.log(errors.length ? 'errors:/n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
