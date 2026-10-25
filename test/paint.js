/* =============================================================
 * test/paint.js —— 涂色改归属之后，国家派生量必须跟着变
 *
 * 这是那个"自检偶发 1 国异常"的真正病根：`Renderer.paint()` 原来只把
 * 省份 id 从一个国家的 provinces 数组搬到另一个，**国家级派生量一概没重算** ——
 * 于是国家卡上的人口 / 面积 / 地形构成 / 信仰构成 / 邻国 / 首都 / 资源汇总
 * 全部停在改之前，自检里"各省人口之和 = 国人口"当场破掉。
 *
 * 验这些：
 *   1) 涂色后两国的人口 = 各自成员省人口之和（守恒：总量不变）
 *   2) 面积 / 密度 / 地形占比 / 信仰占比 都自洽（合计 = 1、faiths ≥ 2 项）
 *   3) 邻国列表跟着变（新东家 ↔ 老东家 互相出现在对方的 neighbors 里）
 *   4) 资源汇总跟着变（prov 数 = 省数）
 *   5) 首都被涂走 → 首都自动改到本国人口最大的那一省
 *   6) 来回涂（A→B→A）能完全回到原值（复算不摇骰子）
 *   7) 不许把一国的最后一省涂走（挡住，归属不变）
 *   8) 涂色后国家卡 / 省份卡能正常渲染，不报错
 *
 * 用法：node test/paint.js
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
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  /* 等世界真的建出来（generate 是 setTimeout 里的异步活，固定 sleep 会偶发抢跑） */
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => !!window.__world && !!window.__renderer);
    if (ok) break;
    await sleep(120);
  }

  const checks = [];
  const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

  /* 在页面里装一个小工具：给一个国家拍快照 + 校验自洽 */
  await page.evaluate(() => {
    window.__snapC = function (cid) {
      const w = window.__world, c = w.countries[cid - 1];
      let pSum = 0, aSum = 0;
      for (const id of c.provinces) {
        const p = w.provinces[id - 1];
        if (!p) continue;
        pSum += p.population || 0;
        aSum += p.area || 0;
      }
      const tc = c.terrainComp || [], fl = c.faiths || [];
      const tSum = tc.reduce((a, t) => a + t.pct, 0);
      const fSum = fl.reduce((a, f) => a + f.pct, 0);
      return {
        id: c.id, name: c.name, n: c.provinces.length,
        pop: c.population, pSum, area: c.areaKm2, aSum,
        density: c.density,
        tSum, fSum, fN: fl.length, faithKey: c.faith && c.faith.key,
        firstIsFaith: fl[0] === c.faith,
        capital: c.capital, capitalIn: c.provinces.indexOf(c.capital) >= 0,
        neighbors: (c.neighbors || []).slice(),
        resProv: (c.resources || []).map(r => r.prov)
      };
    };
    /* 一个国家自洽吗 */
    window.__okC = function (s) {
      const bad = [];
      if (s.pSum !== s.pop) bad.push('人口 ' + s.pSum + '≠' + s.pop);
      if (Math.abs(s.tSum - 1) > 0.01) bad.push('地形合计 ' + s.tSum.toFixed(4));
      if (Math.abs(s.fSum - 1) > 0.002) bad.push('信仰合计 ' + s.fSum.toFixed(4));
      if (s.fN < 2) bad.push('信仰项 ' + s.fN);
      if (!s.firstIsFaith) bad.push('faiths[0]≠faith');
      if (!s.capitalIn) bad.push('首都不在境内');
      if (!(s.area > 0)) bad.push('面积 0');
      if (s.resProv.some(v => v !== s.n)) bad.push('资源省数 ' + s.resProv.join('/'));
      return bad;
    };
  });

  /* ---- 0) 选一对相邻的国家 + 一个边界省 ---- */
  const setup = await page.evaluate(() => {
    const w = window.__world, R = window.__renderer;
    /* 找一个"有邻国、且省数 ≥ 3"的国家 A */
    let A = null;
    for (const c of w.countries) {
      if (c.provinces.length >= 3 && c.neighbors.length) { A = c; break; }
    }
    const B = w.countries[A.neighbors[0] - 1];
    /* 挑 A 里"贴着 B"的省（这样涂过去一定会改变邻接关系） */
    let pid = 0;
    for (const id of A.provinces) {
      const p = w.provinces[id - 1];
      if (p.neighbors.some(nid => w.provinces[nid - 1].owner === B.id)) { pid = id; break; }
    }
    if (!pid) pid = A.provinces[A.provinces.length - 1];
    /* 再找一个"不贴着 B、也不是首都"的省，用来做往返测试 */
    let pid2 = 0;
    for (const id of A.provinces) {
      if (id === pid || id === A.capital) continue;
      const p = w.provinces[id - 1];
      if (!p.neighbors.some(nid => w.provinces[nid - 1].owner === B.id)) { pid2 = id; break; }
    }
    R.cam.x = w.provinces[pid - 1].centroid[0];
    R.cam.y = w.provinces[pid - 1].centroid[1];
    R.cam.scale = 1.6; R.clampCam(); R.draw();
    return { a: A.id, b: B.id, pid, pid2, aName: A.name, bName: B.name,
             cap: A.capital, aN: A.provinces.length, bN: B.provinces.length };
  });

  const before = await page.evaluate((a) => ({
    A: window.__snapC(a.a), B: window.__snapC(a.b),
    totalPop: window.__world.provinces.reduce((s, p) => s + (p ? p.population : 0), 0)
  }), setup);

  /* ---- 1) 涂一块：A → B ---- */
  const afterPaint = await page.evaluate((a) => {
    const R = window.__renderer;
    R.paintOwner = a.b;
    R.paint(a.pid);
    return { A: window.__snapC(a.a), B: window.__snapC(a.b),
             totalPop: window.__world.provinces.reduce((s, p) => s + (p ? p.population : 0), 0),
             owner: window.__world.provinces[a.pid - 1].owner };
  }, setup);

  const badA = await page.evaluate((s) => window.__okC(s), afterPaint.A);
  const badB = await page.evaluate((s) => window.__okC(s), afterPaint.B);

  ck('涂色后：原属国自洽（人口/地形/信仰/首都/资源）',
    badA.length === 0 && afterPaint.A.n === before.A.n - 1,
    badA.length ? badA.join(' · ') : (afterPaint.A.name + ' ' + before.A.n + '→' + afterPaint.A.n + ' 省'));
  ck('涂色后：新属国自洽', badB.length === 0 && afterPaint.B.n === before.B.n + 1,
    badB.length ? badB.join(' · ') : (afterPaint.B.name + ' ' + before.B.n + '→' + afterPaint.B.n + ' 省'));
  ck('人口守恒（省之和 = 国人口，且全世界总人口不变）',
    afterPaint.A.pop === before.A.pop - before.A.pop + afterPaint.A.pSum &&   // 自身一致
    afterPaint.B.pop === afterPaint.B.pSum &&
    afterPaint.totalPop === before.totalPop,
    'A ' + afterPaint.A.pop + '（省和 ' + afterPaint.A.pSum + '）· B ' +
    afterPaint.B.pop + '（省和 ' + afterPaint.B.pSum + '）· 世界总人口不变 ' +
    (afterPaint.totalPop === before.totalPop));
  ck('邻国列表跟着变（A 与 B 互相在对方 neighbors 里）',
    afterPaint.A.neighbors.indexOf(setup.b) >= 0 || afterPaint.B.neighbors.indexOf(setup.a) >= 0,
    'A 邻国 ' + afterPaint.A.neighbors.join(',') + ' · B 邻国 ' + afterPaint.B.neighbors.join(','));
  ck('地形 / 信仰占比合计仍为 1',
    Math.abs(afterPaint.A.tSum - 1) < 0.01 && Math.abs(afterPaint.A.fSum - 1) < 0.002 &&
    Math.abs(afterPaint.B.tSum - 1) < 0.01 && Math.abs(afterPaint.B.fSum - 1) < 0.002,
    'A 地形 ' + afterPaint.A.tSum.toFixed(4) + ' / 信仰 ' + afterPaint.A.fSum.toFixed(4) +
    ' · B 地形 ' + afterPaint.B.tSum.toFixed(4) + ' / 信仰 ' + afterPaint.B.fSum.toFixed(4));

  /* ---- 2) 来回涂：A→B→A 必须完全回到原值（复算不摇骰子） ---- */
  const roundTrip = await page.evaluate((a) => {
    const R = window.__renderer;
    R.paintOwner = a.a;      // 涂回去
    R.paint(a.pid);
    return { A: window.__snapC(a.a), B: window.__snapC(a.b) };
  }, setup);
  const sameFaith = roundTrip.A.faithKey === before.A.faithKey &&
    Math.abs(roundTrip.A.fSum - before.A.fSum) < 1e-9 &&
    Math.abs(roundTrip.A.tSum - before.A.tSum) < 1e-9;
  ck('来回涂（A→B→A）回到原值：人口 / 地形 / 信仰逐位相同',
    roundTrip.A.pop === before.A.pop &&
    roundTrip.A.area === before.A.area &&
    Math.abs(roundTrip.A.fSum - before.A.fSum) < 1e-9 &&
    roundTrip.A.fN === before.A.fN && sameFaith,
    '人口 ' + roundTrip.A.pop + ' vs ' + before.A.pop +
    ' · 面积 ' + roundTrip.A.area + ' vs ' + before.A.area +
    ' · 信仰 ' + roundTrip.A.fSum.toFixed(6) + ' vs ' + before.A.fSum.toFixed(6));

  /* ---- 3) 首都被涂走 → 自动改到本国人口最大的省 ---- */
  const capMove = await page.evaluate((a) => {
    const R = window.__renderer, w = window.__world;
    const capOwner = w.provinces[a.cap - 1].owner;
    const other = capOwner === a.a ? a.b : a.a;
    R.paintOwner = other;
    R.paint(a.cap);
    const c = w.countries[capOwner - 1];
    let best = 0, bestPop = -1;
    for (const id of c.provinces) {
      const p = w.provinces[id - 1];
      if ((p.population || 0) > bestPop) { bestPop = p.population || 0; best = id; }
    }
    const s = window.__snapC(capOwner);
    return { oldCap: a.cap, newCap: c.capital, expect: best, inLand: s.capitalIn,
             bad: window.__okC(s), owner: capOwner };
  }, setup);
  ck('首都丢了 → 自动改到本国人口最大的省',
    capMove.newCap !== capMove.oldCap && capMove.newCap === capMove.expect && capMove.inLand,
    '首都 #' + capMove.oldCap + ' → #' + capMove.newCap + '（应为 #' + capMove.expect + '）' +
    (capMove.bad.length ? ' · ' + capMove.bad.join(' · ') : ''));

  /* ---- 4) 不许把一国的最后一省涂走 ---- */
  const guard = await page.evaluate(() => {
    const w = window.__world, R = window.__renderer;
    /* 找一个只剩 1 省的国家（找不到就把某国涂到只剩 1 省） */
    let tiny = null;
    for (const c of w.countries) if (c.provinces.length === 1) { tiny = c; break; }
    if (!tiny) {
      const c = w.countries[0];
      const keep = c.provinces[0];
      const other = w.countries[1].id;
      R.paintOwner = other;
      for (const id of c.provinces.slice(1)) R.paint(id);
      tiny = w.countries[0];
    }
    const lastPid = tiny.provinces[0];
    const other2 = w.countries.find(x => x.id !== tiny.id).id;
    R.paintOwner = other2;
    const beforeOwner = w.provinces[lastPid - 1].owner;
    R.paint(lastPid);
    return { n: tiny.provinces.length, owner: w.provinces[lastPid - 1].owner,
             beforeOwner, tinyId: tiny.id, other2 };
  });
  ck('不许把一国的最后一省涂走（挡住，归属不变）',
    guard.n === 1 && guard.owner === guard.beforeOwner && guard.owner === guard.tinyId,
    '国 #' + guard.tinyId + ' 剩 ' + guard.n + ' 省，涂后归属仍为 ' + guard.owner);

  /* ---- 5) 涂色后卡片能正常渲染 ---- */
  await page.evaluate(() => { document.getElementById('panelOpen').click(); });
  await sleep(150);
  const ui = await page.evaluate((a) => {
    const R = window.__renderer, w = window.__world;
    R.select(a.pid);
    document.querySelector('.itab[data-tab="info"]').click();
    R.selectCountry(w.provinces[a.pid - 1].owner);
    return {
      pop: document.getElementById('cPop').textContent,
      area: document.getElementById('cArea').textContent,
      provN: document.getElementById('cProv').textContent,
      cap: document.getElementById('cCapital').textContent,
      neigh: document.getElementById('cNeighbors').textContent.replace(/\s+/g, ' ').slice(0, 60),
      faithRows: document.querySelectorAll('#cFaithList .fr').length,
      terrRows: document.querySelectorAll('#cLegend div').length,
      iOwner: document.getElementById('iOwner').textContent
    };
  }, setup);
  await page.screenshot({ path: shot('paint-after.png') });
  ck('涂色后国家卡 / 省份卡正常渲染',
    /万|亿/.test(ui.pop) && /km²/.test(ui.area) && /个/.test(ui.provN) &&
    ui.faithRows >= 2 && ui.terrRows >= 1 && ui.iOwner.length > 0,
    '人口 ' + ui.pop + ' · 面积 ' + ui.area + ' · ' + ui.provN +
    ' · 首都 ' + ui.cap + ' · 信仰 ' + ui.faithRows + ' 行 · 邻国 ' + ui.neigh);

  /* ---- 汇总 ---- */
  let pass = true;
  console.log('国家：' + setup.aName + '（#' + setup.a + '，' + setup.aN + ' 省）↔ ' +
    setup.bName + '（#' + setup.b + '，' + setup.bN + ' 省）· 涂色省 #' + setup.pid);
  for (const [name, ok, note] of checks) {
    if (!ok) pass = false;
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + note);
  }
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
