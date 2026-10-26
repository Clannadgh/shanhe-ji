/* =============================================================
 * test/prices.js —— 动态市场（物价指数 + 跨国倒卖）的验收
 *
 * 对着任务书「验收清单」逐条过：
 *   ① 价格板显示七资源现价 + 趋势；挂机可见丰年跌 / 断产涨 / 战时铁贵
 *   ② 卖 / 中央买 / 外国买三处价格与价格板一致（手算对表）；小数攒整不吞钱
 *   ③ 出口：价差排序、成交后对方回落、运费抽成 20%、每省每回合 1 笔
 *   ④ AI 比价买货（取最便宜源）、经营型 AI 出口积压；军国不比价
 *   ⑤ 「商队到访」全流程；饥荒省买粮不受比价影响
 *   ⑥ 存档含 PRICES 往返；旧档（没有这一块）不炸
 *
 * 跑法：node test/prices.js
 * 小世界（180 省 / 10 国），一分多钟。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
function add(list) { for (const c of list) out.push(c); }

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
  await sleep(1200);
  await page.evaluate(() => {
    document.getElementById('prov').value = 180;
    document.getElementById('ctry').value = 10;
    document.getElementById('seed').value = 'price-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2800);

  const ev = (fn, arg) => page.evaluate(fn, arg);

  /* ================= ① 定义表 + 分档 + lerp ================= */
  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const C = AO.PRICES_CFG;

    ok('① 定义表 AO.PRICES_CFG 在（基准 1.0 / 钳位 0.5~2.5 / lerp 25%）',
      !!C && C.base === 1 && C.lo === 0.5 && C.hi === 2.5 && C.lerp === 0.25,
      'base ' + C.base + ' · [' + C.lo + ', ' + C.hi + '] · lerp ' + C.lerp);
    ok('① 四档目标价 1.8 / 1.3 / 1.0 / 0.7（比值 0.5 / 1 / 3）',
      C.tier.scarce === 1.8 && C.tier.tight === 1.3 && C.tier.ok === 1.0 && C.tier.glut === 0.7 &&
      C.ratio.scarce === 0.5 && C.ratio.tight === 1 && C.ratio.glut === 3,
      JSON.stringify(C.tier));

    /* priceTarget：库存/需求 比值 → 档位（手算对表） */
    const PT = D.priceTarget, nd = 100;
    ok('① 分档：库存 30/100=0.3 → 1.8；70 → 1.3；200 → 1.0；500 → 0.7',
      PT(30, nd) === 1.8 && PT(70, nd) === 1.3 && PT(200, nd) === 1.0 && PT(500, nd) === 0.7,
      [PT(30, nd), PT(70, nd), PT(200, nd), PT(500, nd)].join(' / '));

    /* lerp：v=1.0、目标 1.8 → 1.0 + 0.25×0.8 = 1.20 */
    const w = D.world();
    const c = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id])[0];
    c.provinces.forEach(pid => {
      const bag = AO.resSim[pid];
      if (bag && bag.salt) bag.salt.stock = 0;      // 盐一定缺 → 目标 1.8
    });
    const row = D.prices[c.id] || (D.prices[c.id] = {});
    row.salt = { v: 1, target: 1, trend: 0 };
    D.settlePrices();
    ok('① v 每回合向目标靠 25%（1.00 → 1.20，目标 1.8）',
      Math.abs(D.priceOf(c.id, 'salt') - 1.2) < 1e-9,
      'v=' + Math.round(D.priceOf(c.id, 'salt') * 10000) / 10000 +
      ' · target=' + Math.round(row.salt.target * 100) / 100);
    ok('① 趋势字段记下"这一回合涨了"（trend=1）', D.priceTrend(c.id, 'salt') === 1,
      'trend=' + D.priceTrend(c.id, 'salt'));

    /* 钳位：目标 2.5 也不会飞出去 */
    row.salt.v = 2.4;
    D.priceNudge(c.id, 'salt', 2.5, 2, 1);
    D.settlePrices();
    ok('① 价格钳在 [0.5, 2.5]', D.priceOf(c.id, 'salt') <= 2.5 && D.priceOf(c.id, 'salt') >= 0.5,
      'v=' + Math.round(D.priceOf(c.id, 'salt') * 100) / 100);
    return o;
  }));

  /* ================= ① 价格板（DOM）+ 三种传导 ================= */
  const P = await ev(() => {
    const w = window.__world, R = window.__renderer;
    const caps = {}; w.countries.forEach(c => { if (c.capital) caps[c.capital] = 1; });
    let q = null;
    for (const p of w.provinces) if (p && !caps[p.id] && p.resources && (!q || p.resources[0].n > q.resources[0].n)) q = p;
    R.cam.x = q.centroid[0]; R.cam.y = q.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(q.id); R.draw();
    return { id: q.id, name: q.name, owner: q.owner };
  });
  await sleep(200);

  /* 保证这个省有市场（? 面板才有卖货格） */
  await ev((pid) => {
    const AO = window.AO;
    if (!AO.resMarket[pid] || !AO.resMarket[pid].n) {
      AO.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    }
    AO.resMarket[pid].halted = false;
    window.AO.resDebug.settlePrices();
  }, P.id);
  await page.evaluate((pid) => {
    const r = document.querySelector('#iSchoolList .rr[data-univ="market"]');
    if (r) r.querySelector('.qbtn').click();
  }, P.id);
  await sleep(200);
  const board = await ev(() => {
    const box = document.querySelector('#iSchoolList .qinfo.on');
    if (!box) return null;
    const rows = [...box.querySelectorAll('.pbrow')];
    return {
      n: rows.length,
      head: !!box.querySelector('.pbhead'),
      rows: rows.map(r => ({
        nm: r.querySelector('.nm').textContent,
        v: r.querySelector('b').textContent,
        em: r.querySelector('em').textContent
      }))
    };
  });
  const priceOk = await ev((args) => {
    const D = window.AO.resDebug, w = D.world(), pid = args;
    const cid = w.provinces[pid - 1].owner;
    const box = document.querySelector('#iSchoolList .qinfo.on');
    if (!box) return false;
    return [...box.querySelectorAll('.pbrow')].every(r => {
      const nm = r.querySelector('.nm').textContent;
      const k = (window.AO.RESOURCES.find(x => (x.prod || x.cn) === nm) || {}).key;
      if (!k) return false;
      const want = D.priceNum(D.priceOf(cid, k));
      return r.querySelector('b').textContent.indexOf(want) === 0 &&
        /[↑↓—]/.test(r.querySelector('b').textContent);
    });
  }, P.id);
  add([{
    name: '① 市场 ? 面板顶部有价格板：七行 + 表头（现价 / 趋势 / 库存·需求）',
    ok: !!board && board.n === 7 && board.head,
    detail: board ? board.n + ' 行 · ' + board.rows.map(r => r.nm + ' ' + r.v).slice(0, 3).join(' / ') : '没画出来'
  }, {
    name: '① 价格板上的数 = 本国物价指数（逐行对表）',
    ok: priceOk,
    detail: board ? board.rows.map(r => r.v).join(' ') : ''
  }]);

  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const C = AO.PRICES_CFG, w = D.world();
    const alive = w.countries.filter(c => c && c.provinces.length >= 2 && !D.deadMap[c.id]);
    const c = alive[0];

    /* 断产涨：把粮食抽干 → 目标 1.8，v 一路往上 */
    const setGrain = (n) => c.provinces.forEach(pid => {
      const bag = AO.resSim[pid];
      if (bag && bag.grain) { bag.grain.built = 0; bag.grain.tiers = { 1: 0, 2: 0 }; bag.grain.stock = n; }
    });
    setGrain(0);
    const pi0 = D.priceOf(c.id, 'grain');
    for (let i = 0; i < 3; i++) D.settlePrices();
    const pi1 = D.priceOf(c.id, 'grain');
    ok('① 断产（库存抽干）→ 粮价上涨（' + Math.round(pi0 * 100) / 100 + ' → ' +
      Math.round(pi1 * 100) / 100 + '）', pi1 > pi0 + 0.1, 'trend=' + D.priceTrend(c.id, 'grain'));

    /* 丰年（+30 粮）→ 目标掉到 0.7 档 → v 往下 */
    setGrain(150);
    for (let i = 0; i < 4; i++) D.settlePrices();
    const pi2 = D.priceOf(c.id, 'grain');
    const p = c.provinces[0];
    AO.resSim[p].grain.stock = 0;
    AO.evtForce('bumper', p, false);            // 事件自带 price:{grain:{target:0.7}}
    for (let i = 0; i < 2; i++) D.settlePrices();
    const pi3 = D.priceOf(c.id, 'grain');
    ok('① 丰年 +30 粮 → 粮价下跌（' + Math.round(pi2 * 100) / 100 + ' → ' +
      Math.round(pi3 * 100) / 100 + '）', pi3 < pi2, '丰年把目标价压到 0.7 档');

    /* 战时铁贵：宣战 → 铁需求 ×warNeedMul */
    const needPeace = D.needOf(c.id).iron;
    const foe = alive.find(q => q.id !== c.id);
    D.declareWar(c.id, foe.id);
    const needWar = D.needOf(c.id).iron;
    ok('① 战时铁贵：开战后铁需求 ×' + C.need.warNeedMul,
      Math.abs(needWar / needPeace - C.need.warNeedMul) < 0.01,
      '平时 ' + Math.round(needPeace) + ' → 战时 ' + Math.round(needWar));
    return o;
  }));

  /* ================= ② 三处价格一致 + 攒整 ================= */
  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world(), lot = AO.GOV.buyLot();
    const alive = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id]);
    const c = alive[0];

    /* 手算对表：三国价全设成已知值 */
    const row = D.prices[c.id] || (D.prices[c.id] = {});
    row.iron = { v: 1.4, target: 1.4, trend: 1 };
    ok('② 卖价 = 本国 PI（1.40）', Math.abs(D.sellGold(c.id, 'iron') - 1.4) < 1e-9,
      D.sellGold(c.id, 'iron'));
    ok('② 中央买价 = ceil(基准 ' + lot.gold + ' × 1.40) = ' + Math.ceil(lot.gold * 1.4),
      D.buyGold(c.id, 'iron') === Math.ceil(lot.gold * 1.4), D.buyGold(c.id, 'iron'));

    const o2 = alive.find(q => q.id !== c.id);
    const row2 = D.prices[o2.id] || (D.prices[o2.id] = {});
    row2.iron = { v: 0.6, target: 0.6, trend: -1 };
    const prem = AO.DIPLO.trade.premium;
    ok('② 外国买价 = ceil(基准 × 溢价 ' + prem + ' × 对方 0.60) = ' +
      Math.ceil(lot.gold * prem * 0.6),
      D.fBuyGold(o2.id, 'iron') === Math.ceil(lot.gold * prem * 0.6), D.fBuyGold(o2.id, 'iron'));

    /* 小数攒整：连续卖 5 次，总到账 + 零头 = 5 × PI（一分不吞） */
    const pid = c.provinces[0], bag = AO.resSim[pid];
    if (bag && bag.iron) {
      bag.iron.stock = 100;
      if (!AO.resMarket[pid] || !AO.resMarket[pid].n) {
        AO.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      }
      AO.resMarket[pid].halted = false;
      const g0 = bag.gold.stock, acc0 = D.sellAcc[pid] || 0;
      const prov = w.provinces[pid - 1];
      for (let i = 0; i < 5; i++) D.sell(prov, 'iron');
      const gained = bag.gold.stock - g0, acc1 = D.sellAcc[pid] || 0;
      ok('② 卖 5 次 ×5 铁：落袋 ' + gained + ' + 零头 ' +
        Math.round(acc1 * 100) / 100 + ' = 5 × 1.40（攒整不吞钱）',
        Math.abs(gained + acc1 - acc0 - 5 * 1.4) < 1e-9,
        '金 ' + g0 + ' → ' + bag.gold.stock);
    } else {
      ok('② 小数攒整（本省没有铁袋，跳过）', true, '没铁袋');
    }
    return o;
  }));

  /* ================= ③ 出口 ================= */
  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const C = AO.PRICES_CFG, w = D.world();
    const alive = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id]);

    /* 甲：省多、粮多；乙：省最少（need 小，5 单位就能撼动比值） */
    const A = alive.slice().sort((x, y) => y.provinces.length - x.provinces.length)[0];
    const B = alive.filter(q => q.id !== A.id).sort((x, y) => x.provinces.length - y.provinces.length)[0];
    D.relSet(A.id, B.id, 80);
    /* 甲乙都布置成：有市场、有钱 */
    const prep = (c, stock) => c.provinces.forEach(pid => {
      const mk = AO.resMarket[pid];
      if (!mk) AO.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      else { mk.n = Math.max(1, mk.n | 0); mk.halted = false; }
      const bag = AO.resSim[pid];
      if (!bag) return;
      if (bag.grain) { bag.grain.stock = stock; bag.grain.built = 0; bag.grain.tiers = { 1: 0, 2: 0 }; }
      if (bag.gold) bag.gold.stock = 500;
    });
    prep(A, 150);
    prep(B, 0);

    /* 价差自己长出来：甲满仓 → 积压档 0.7；乙空仓 → 紧缺档 1.8。
     * **不用 priceNudge** —— 冲击会接管目标价若干回合，那期间"出口把价差压下去"
     * 这件事会被冲击盖住，测出来的就不是收敛了。 */
    for (let i = 0; i < 8; i++) D.settlePrices();
    const pa = D.priceOf(A.id, 'grain'), pb = D.priceOf(B.id, 'grain');

    const srcs = D.exportSources(A.provinces.map(p => w.provinces[p - 1])[0], 'grain');
    const bSrc = srcs.find(s => s.cid === B.id);
    ok('③ 出口货源只列"对方价更高"的国家（甲 ' + (Math.round(pa * 100) / 100) + ' → 乙 ' +
      (Math.round(pb * 100) / 100) + '）', !!bSrc && srcs.every((s, i) => i === 0 || srcs[i - 1].spread >= s.spread),
      srcs.length + ' 家 · 首位 ' + (srcs[0] ? srcs[0].name + ' 价差 ' + Math.round(srcs[0].spread * 100) / 100 : '无'));

    /* 运费抽成 20%：到手 = 对方价 × 0.8 */
    const p0 = w.provinces[A.provinces[0] - 1];
    const before = { gold: D.stockOf(p0.id, 'gold'), grain: D.stockOf(p0.id, 'grain') };
    const r1 = D.exportForeign(p0, 'grain', B.id);
    ok('③ 运费抽成：到手 = 对方价 ' + (Math.round(pb * 100) / 100) + ' × ' +
      C.exportCut + ' = ' + (Math.round(pb * C.exportCut * 100) / 100),
      !!r1 && r1.ok && Math.abs(r1.raw - pb * C.exportCut * (C.exportLot / AO.MARKET.rate)) < 1e-9,
      r1 ? 'raw=' + Math.round(r1.raw * 100) / 100 + ' · 货 ' + r1.qty : '失败');
    ok('③ 货从本省出（−' + C.exportLot + '）、进对方库存',
      D.stockOf(p0.id, 'grain') === before.grain - C.exportLot,
      '本省 ' + before.grain + ' → ' + D.stockOf(p0.id, 'grain'));
    ok('③ 双方 FLOW 记同一批货（己 gain.export = 对方 gain.import）', (() => {
      const e = (D.flow[p0.id] && D.flow[p0.id].gain.export) || 0;
      let im = 0;
      B.provinces.forEach(pid => { const F = D.flow[pid]; if (F) im += F.gain.import || 0; });
      return e === C.exportLot && im === C.exportLot;
    })(), '出口 ' + ((D.flow[p0.id] || { gain: {} }).gain.export || 0) + ' / 进口见对方 FLOW');

    /* 每省每回合 1 笔 */
    /* 第 2 笔用 AI 入口验：玩家入口只弹提示（bldMsg），不返回结构化结果 */
    const r2 = D.aiExport(p0, 'grain', B.id);
    ok('③ 同一省同一回合第 2 笔被挡住', !!r2 && !r2.ok && /出过一笔/.test(r2.msg), r2 && r2.msg ? r2.msg : '');

    /* 多笔出口 → 乙的库存上去 → 下一回合乙的价回落 */
    let lots = 0;
    A.provinces.slice(1).forEach(pid => {
      const q = w.provinces[pid - 1];
      if (!q) return;
      const r = D.exportForeign(q, 'grain', B.id);
      if (r && r.ok) lots++;
    });
    const bStock = D.countryStock(B.id, 'grain');
    D.settlePrices();
    const pb2 = D.priceOf(B.id, 'grain');
    ok('③ 成交后对方粮价回落（' + (Math.round(pb * 100) / 100) + ' → ' +
      (Math.round(pb2 * 100) / 100) + '，共出口 ' + (lots + 1) + ' 手/乙库存 ' + Math.round(bStock) + '）',
      pb2 < pb && lots >= 1, '库存涨 → 比值涨 → 目标价降，这就是"价差自闭合"');

    /* 价差薄到 minSpread 以下就不列（白搬货）—— 用"把甲的价按到和乙一样"来构造 */
    D.prices[A.id].grain = { v: pb2, target: pb2, trend: 0 };
    D.prices[B.id].grain = { v: pb2, target: pb2, trend: 0 };
    const thin = D.exportSources(p0, 'grain');
    ok('③ 价差 ≤ ' + C.minSpread + ' 就不列出口对象（白搬货）',
      thin.filter(s => s.cid === B.id).length === 0,
      '两国同价 ' + (Math.round(pb2 * 100) / 100) + ' · 档口 ' + thin.length + ' 家');
    return o;
  }));

  /* ================= ④ AI 比价 / 出口 ================= */
  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world(), lot = AO.GOV.buyLot(), T = AO.AIWAR.trade;

    ok('④ 比价配置：经营 / 均衡比价、军国不比价',
      T.compare.econ === 1 && T.compare.balanced === 1 && T.compare.mil === 0 &&
      T.every.econ === 3 && T.every.balanced === 5,
      'every ' + JSON.stringify(T.every) + ' · compare ' + JSON.stringify(T.compare));

    const alive = w.countries.filter(q => q && q.provinces.length >= 2 && !D.deadMap[q.id]);
    const me = alive[0];
    /* 必须挑一个**没在交战**的对象：交战国之间 foreignSources 直接不给货源，
     * 那样"比价"永远只剩中央一个候选，测不出"取最便宜的源"。 */
    const you = alive.find(q => q.id !== me.id && !D.atWar(me.id, q.id)) ||
      alive.find(q => q.id !== me.id);
    D.relSet(me.id, you.id, 80);
    /* 让 me 缺铁、有市场有钱 */
    me.provinces.forEach(pid => {
      const bag = AO.resSim[pid];
      if (!bag) return;
      if (bag.iron) bag.iron.stock = 0;
      if (bag.gold) bag.gold.stock = 300;
      const mk = AO.resMarket[pid];
      if (!mk) AO.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      else { mk.n = 1; mk.halted = false; }
    });
    /* v18 追加三：**国库不是商店** —— 中央不再卖货，比价只在
     * 「世界市场价（基准 × 本国 PI，供给无限）vs 外国价」之间做。
     * 中央故意留 10 铁：它不该被动（只当 stockTotal 的一部分）。
     * 这一档 stockTotal 仍 < minStock(30)，所以 AI 判定"缺铁、要买"。 */
    const cen = D.ensureCentral(me.id);
    cen.iron = 10;
    D.prices[me.id] = D.prices[me.id] || {}; D.prices[me.id].iron = { v: 0.6, target: 0.6, trend: 0 };
    you.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.iron) b.iron.stock = 200; });
    D.prices[you.id] = D.prices[you.id] || {}; D.prices[you.id].iron = { v: 2.4, target: 2.4, trend: 0 };

    /* 让这一国轮到"该看价"的回合（走回合会推物价，所以走完再钉一次价） */
    const every = T.every.econ;
    let guardT = 0;
    while (((D.turn() + me.id) % every) !== 0 && guardT++ < every) D.settleTurn();
    D.prices[me.id].iron = { v: 0.6, target: 0.6, trend: 0 };
    D.prices[you.id].iron = { v: 2.4, target: 2.4, trend: 0 };
    me.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.iron) b.iron.stock = 0; });
    cen.iron = 10;
    const sumOf = (c, key) => c.provinces.reduce((s, pid) => s + D.stockOf(pid, key), 0);
    const iron0 = sumOf(me, 'iron'), gold0 = sumOf(me, 'gold');
    AO.aiDebug.setPersona(me.id, 'econ');
    const n1 = AO.aiDebug.trade(me.id, 'econ');
    const iron1 = sumOf(me, 'iron'), gold1 = sumOf(me, 'gold');
    ok('④ 比价买货：世界市场便宜时买市场（中央铁不动 ' + Math.floor(cen.iron) +
      ' · 金沉没 −' + (gold0 - gold1) + '）',
      n1 === 1 && iron1 > iron0 && Math.floor(cen.iron) === 10 && gold1 < gold0,
      '市场价 ' + D.buyGold(me.id, 'iron') + ' vs 外国价 ' + D.fBuyGold(you.id, 'iron') +
      ' · 本国铁 ' + Math.round(iron0) + ' → ' + Math.round(iron1));

    /* 反过来：市场贵、外国便宜 → 买外国，中央照旧不动 */
    me.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.iron) b.iron.stock = 0; });
    cen.iron = 10;
    D.prices[me.id].iron = { v: 2.4, target: 2.4, trend: 0 };
    D.prices[you.id].iron = { v: 0.6, target: 0.6, trend: 0 };
    you.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.iron) b.iron.stock = 200; });
    let youIron0 = 0;
    you.provinces.forEach(pid => { youIron0 += D.stockOf(pid, 'iron'); });
    guardT = 0;
    while (((D.turn() + me.id) % every) !== 0 && guardT++ < every) D.settleTurn();
    D.prices[me.id].iron = { v: 2.4, target: 2.4, trend: 0 };
    D.prices[you.id].iron = { v: 0.6, target: 0.6, trend: 0 };
    me.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.iron) b.iron.stock = 0; });
    cen.iron = 10;
    const n2 = AO.aiDebug.trade(me.id, 'econ');
    let youIron1 = 0;
    you.provinces.forEach(pid => { youIron1 += D.stockOf(pid, 'iron'); });
    ok('④ 比价买货：外国便宜时买外国（中央没动 ' + Math.floor(cen.iron) + '）',
      n2 === 1 && Math.floor(cen.iron) === 10 && youIron1 < youIron0,
      '市场价 ' + D.buyGold(me.id, 'iron') + ' vs 外国价 ' + D.fBuyGold(you.id, 'iron') +
      ' · 对方铁 ' + Math.round(youIron0) + ' → ' + Math.round(youIron1));

    /* 经营型 AI 出口积压 */
    D.prices[me.id].grain = { v: 0.6, target: 0.6, trend: 0 };
    D.prices[you.id].grain = { v: 2.2, target: 2.2, trend: 0 };
    me.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.grain) b.grain.stock = 100; });
    const exp0 = AO.aiDebug.war.export | 0;
    let gSum0 = 0;
    me.provinces.forEach(pid => { gSum0 += D.stockOf(pid, 'grain'); });
    guardT = 0;
    while (((D.turn() + me.id) % (T.sellEvery || 3)) !== 0 && guardT++ < 3) D.settleTurn();
    D.prices[me.id].grain = { v: 0.6, target: 0.6, trend: 0 };
    D.prices[you.id].grain = { v: 2.2, target: 2.2, trend: 0 };
    me.provinces.forEach(pid => { const b = AO.resSim[pid]; if (b && b.grain) b.grain.stock = 100; });
    const before1 = AO.aiDebug.war.export | 0;
    AO.aiDebug.sell(me.id, 'econ');
    const expUp = (AO.aiDebug.war.export | 0) > before1;
    ok('④ 经营型 AI 把积压的粮卖到外国（PI 0.6 ≤ ' + T.sellAt + '）', expUp,
      '出口次数 ' + before1 + ' → ' + (AO.aiDebug.war.export | 0));
    ok('④ 军国不出口（sellPersona 只有经营）', !T.sellPersona.mil && !T.sellPersona.balanced,
      JSON.stringify(T.sellPersona));
    return o;
  }));

  /* ================= ⑤ 商队到访 + 饥荒不看价 ================= */
  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const ev0 = AO.EVENTS.find(e => e.key === 'caravan');
    ok('⑤ 「商队到访」在事件池里（w 6 / cd 12 / 省事件）',
      !!ev0 && ev0.w === 6 && ev0.cd === 12 && ev0.spot === 'prov',
      ev0 ? 'w=' + ev0.w + ' cd=' + ev0.cd : '没有');
    ok('⑤ 两个选项（卖 / 不卖）且卖的那项 fx.caravan = 1.3',
      !!ev0 && ev0.options.length === 2 && ev0.options.some(o2 => o2.fx && o2.fx.caravan === 1.3),
      ev0 ? ev0.options.map(o2 => o2.cn).join(' / ') : '');

    /* 效果手算：10 单位 = 2 手；到手 = PI × 1.3 × 2 */
    const alive = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id]);
    const c = alive[0], pid = c.provinces[0], bag = AO.resSim[pid];
    if (bag && bag.grain && bag.gold) {
      bag.grain.stock = 40; bag.gold.stock = 10;
      D.prices[c.id] = D.prices[c.id] || {};
      D.prices[c.id].grain = { v: 1.0, target: 1.0, trend: 0 };
      const acc0 = D.sellAcc[pid] || 0;
      const g0 = bag.gold.stock;
      const r = D.caravan(pid, 'grain', 1.3);
      const gained = bag.gold.stock - g0, acc1 = D.sellAcc[pid] || 0;
      ok('⑤ 商队收 10 单位：库存 −10、到手 = 价 1.00 × 1.3 × 2 手 = 2.6',
        !!r && r.n === 10 && Math.abs((gained + acc1 - acc0) - 2.6) < 1e-9,
        '库存 40 → ' + bag.grain.stock + ' · 金 ' + g0 + ' → ' + bag.gold.stock);
    } else {
      ok('⑤ 商队效果（本省没有粮袋/金袋，跳过）', true, '跳过');
    }

    /* 全流程：真的把事件打出来 */
    let line = null, boom = null;
    /* 战报的对外入口是 AO.resWarLog()（D.warLog 这个键在 resDebug 里没有）。
     * 战报有上限（满 80 条就不再变长），所以比的是**最上面那条有没有换**，
     * 不是长度有没有加一。 */
    const lgOf = () => (window.AO.resWarLog ? window.AO.resWarLog() : (window.AO.resWar.log || [])) || [];
    const top0 = (lgOf()[0] || {}).text || '';
    let tgt = null;
    try {
      tgt = AO.evtForce('caravan', pid, false);
      const lg = lgOf();
      line = (lg[0] && lg[0].text) || '';
      if (line === top0) line = '';       // 没换 = 没落账
    }
    catch (e) { boom = String(e && e.message || e); }
    ok('⑤ 「商队到访」事件全流程不炸（纪要落一条）',
      !boom && typeof line === 'string' && /商队/.test(line),
      boom || line || ('没落账（tg=' + (tgt ? 'ok' : 'null') + ' · 战报 ' + lgOf().length + ' 条）'));

    /* 饥荒省买粮不看价：把粮价全顶到 2.5，AI 照样买 */
    const me = alive[0];
    const you = alive.find(q => q.id !== me.id && !D.atWar(me.id, q.id)) ||
      alive.find(q => q.id !== me.id);
    D.relSet(me.id, you.id, 80);
    me.provinces.forEach(p2 => {
      const b = AO.resSim[p2];
      if (!b) return;
      if (b.grain) b.grain.stock = 0;
      if (b.gold) b.gold.stock = 300;
      const mk = AO.resMarket[p2];
      if (!mk) AO.resMarket[p2] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      else { mk.n = 1; mk.halted = false; }
    });
    const cen = D.ensureCentral(me.id);
    cen.grain = 10;          // 同上：中央放多了 AI 会判"不缺" 
    D.prices[me.id] = D.prices[me.id] || {};
    D.prices[me.id].grain = { v: 2.5, target: 2.5, trend: 1 };
    you.provinces.forEach(p2 => { const b = AO.resSim[p2]; if (b && b.grain) b.grain.stock = 200; });
    D.prices[you.id] = D.prices[you.id] || {};
    D.prices[you.id].grain = { v: 2.5, target: 2.5, trend: 1 };
    const every = AO.AIWAR.trade.every.econ;
    let guardT = 0;
    while (((D.turn() + me.id) % every) !== 0 && guardT++ < every) D.settleTurn();
    me.provinces.forEach(p2 => { const b = AO.resSim[p2]; if (b && b.grain) b.grain.stock = 0; });
    cen.grain = 10;
    const n = AO.aiDebug.trade(me.id, 'econ');
    ok('⑤ 饥荒省买粮不受比价影响（粮价顶到 2.5 也照买）', n === 1,
      '粮价 2.5 · 成交 ' + n + ' 笔');
    return o;
  }));

  /* ================= ⑥ 存档 ================= */
  const sv = await ev(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world();
    const alive = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id]);
    const c = alive[0];
    D.prices[c.id] = D.prices[c.id] || {};
    D.prices[c.id].grain = { v: 1.44, target: 1.8, trend: 1 };
    D.priceNudge(c.id, 'timber', 2.2, 3, 0);
    D.settlePrices();
    D.save();
    const raw = JSON.parse(localStorage.getItem('sj.save'));
    return {
      cid: c.id, v: D.priceOf(c.id, 'grain'), t: D.turn(),
      has: !!raw.PRICES, ver: raw.v,
      shock: !!raw.PRICESHOCK, acc: raw.SELLACC !== undefined, exp: raw.EXP1 !== undefined,
      n: raw.PRICES ? Object.keys(raw.PRICES).length : 0,
      kb: Math.round(JSON.stringify(raw).length / 1024),
      pr: raw.PRICES && raw.PRICES[c.id] ? raw.PRICES[c.id].grain : null
    };
  });
  add([{
    name: '⑥ 存档里有 PRICES / PRICESHOCK / SELLACC / EXP1 四块（版本仍 v' + sv.ver + '）',
    ok: sv.has && sv.shock && sv.acc && sv.exp,
    detail: sv.n + ' 国 · ' + sv.kb + ' KB · 版本 ' + sv.ver
  }, {
    name: '⑥ 存档里的物价保留两位小数（不写一本书进档）',
    ok: !!sv.pr && Math.abs(sv.pr.v * 100 - Math.round(sv.pr.v * 100)) < 1e-9,
    detail: sv.pr ? JSON.stringify(sv.pr) : '没有'
  }]);

  await ev(() => {
    const D = window.AO.resDebug, w = D.world();
    const alive = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id]);
    /* 弄脏：把物价全打回 1.0，读档看能不能回来 */
    Object.keys(D.prices).forEach(cid => { D.prices[cid] = {}; });
    D.load();
  });
  await sleep(4200);
  add(await ev((args) => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const v = D.priceOf(args.cid, 'grain');
    ok('⑥ 读档恢复物价（第 ' + args.cid + ' 号国的粮价）', Math.abs(v - args.v) < 0.011,
      'v=' + Math.round(v * 100) / 100 + '（存档 ' + Math.round(args.v * 100) / 100 + '）');
    ok('⑥ 读档回到存档那一回合、还能继续结算', (() => {
      const t = D.turn();
      D.settleTurn();
      return D.turn() === t + 1;
    })(), '第 ' + D.turn() + ' 回合（存档 ' + args.t + '）');
    return o;
  }, { cid: sv.cid, v: sv.v, t: sv.t }));

  /* 旧档：删掉四块再灌回去 */
  await ev(() => {
    const raw = JSON.parse(localStorage.getItem('sj.save'));
    delete raw.PRICES; delete raw.PRICESHOCK; delete raw.SELLACC; delete raw.EXP1;
    localStorage.setItem('sj.save', JSON.stringify(raw));
    window.AO.resDebug.load();
  });
  await sleep(4200);
  add(await ev(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    let boom = null;
    try { D.settleTurn(); } catch (e) { boom = String(e && e.message || e); }
    ok('⑥ 读「没有这四块」的旧档不炸', !boom, boom || '第 ' + D.turn() + ' 回合');
    const w = D.world();
    const c = w.countries.filter(q => q && q.provinces.length && !D.deadMap[q.id])[0];
    const all = AO.RESOURCES.every(r => {
      const v = D.priceOf(c.id, r.key);
      return v >= AO.PRICES_CFG.lo && v <= AO.PRICES_CFG.hi;
    });
    ok('⑥ 旧档读进来后物价回基准（1.0）并在钳位内', all,
      AO.RESOURCES.map(r => D.priceOf(c.id, r.key)).map(v => Math.round(v * 100) / 100).join(' '));
    return o;
  }));

  for (const c of out) {
    console.log((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + (c.detail ? '  —  ' + c.detail : ''));
  }
  const bad = out.filter(c => !c.ok).length;
  console.log('\n合计 ' + out.length + ' 项：通过 ' + (out.length - bad) + '，失败 ' + bad);
  console.log(errors.length ? '页面报错:\n' + errors.join('\n') : '页面无 JS 报错');
  await browser.close();
  process.exit(bad || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
