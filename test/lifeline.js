/* =============================================================
 * test/lifeline.js —— v18「经济续命」的验收（A0 / A / B / C / D / E / F / G / H 九件）
 *
 * 这一批不推翻"终局压力"，只给五条活气口 + 拆一道锁死穷国的门槛：
 *   A0  拆门槛：熔旧坊 / 淘金场是"活命建筑"，不问学历（累计教育 0 也能改建）
 *   A   淘金场：金的熔旧坊（枯竭金矿的再就业），逐条镜像 SMELT
 *   B   AI 会卖货：市场 5:1 对 AI 开门（含铁、有安全线、每国 ≤2 手）
 *   C   产线库存闸：装备/兵刃攒够了就停线，和平期不再白烧铁
 *   D   省库上解：三段累进（≤30 免 / 30~80 抽 10% / >80 抽 25%，每省每回合 ≤3）
 *   E   AI 缺了会开矿：对稀缺有反应（at / left / 中央金三道闸）
 *   F   税也收铁（v18 追加二）：人口铁税从涓流提为常脉，与金税同单位
 *   G   市场一座 · 国库不是商店（v18 追加三）：每省 maxPer 1；
 *       买货改走世界市场（供给无限、金沉没、不扣中央），buyCentral 退役
 *   H   改建快速通道（v18.1b）：熔旧坊/淘金场从 buildOrder 里摘出来，
 *       改走 aiConvert（不占建造格，每国每回合至多 1 座，先铁后金）
 *   I   存钱本能（v18.3）：goldReserve 15 + 中央金 < 10 时整条建造跳过
 *   J   省库买铁付维护（v18.4）：维护缺铁 → 世界市场按缺口零买，金沉没；
 *       每国每回合 ≤1 手、付完留 keepGold、封锁 / 满仓 / 没钱不买
 *   K   养得起几座就养几座（v18.5）：维护前按库存写保留座数，欠账按座数砍
 *   L   开辟新资源（v18.6）：图上有空着的富矿就去开一座；
 *       本国同类还有停着的座时不开（和 K 一进一出）
 *
 * 每一节都对着任务书那一条验收写，断言尽量落在"规则层"（check / settle /
 * 表本身）而不是像素上；只有"钮亮不亮、title 写什么"这类必须走 DOM。
 *
 * 跑法：node test/lifeline.js
 * 小世界（120 省 / 6 国），三十几秒。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const shot = (n) => path.join(root, 'shots', n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
function add(list) { for (const c of list) out.push(c); }

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);
  await page.evaluate(() => {
    document.getElementById('prov').value = 120;
    document.getElementById('ctry').value = 6;
    document.getElementById('seed').value = 'lifeline-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- 公用：挑省 + 铺条件 ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO;
    const w = D.world();
    /* 挑一个省数最多的国当玩家国（要有铁省、金省各至少两个） */
    let best = null;
    for (const c of w.countries) {
      const n = c.provinces.length;
      if (!best || n > best.n) best = { n: n, cid: c.id, provs: c.provinces.slice() };
    }
    D.choosePlayer(best.cid);
    const cen = D.ensureCentral(best.cid);
    cen.timber = 600; cen.gold = 600; cen.iron = 600; cen.grain = 600;
    /* 教育故意留 0：A0 要验的就是"没铺过学校的穷国也能改建" */
    D.talent[best.cid].total = 0;
    /* 按资源挑省：a=铁矿省（要枯竭） b=铁矿省（保持完好） g=金矿省（要枯竭）
     * g2=金矿省（保持完好） m=有市场的省（B 用） */
    const pick = (key) => best.provs.find(id => {
      const bag = A.resSim[id];
      return bag && bag[key] && bag[key].n >= 30;
    }) || best.provs[0];
    window.__T = {
      cid: best.cid, provs: best.provs,
      a: pick('iron'), b: null, g: pick('gold'), g2: null, m: best.provs[0]
    };
    window.__T.b = best.provs.find(id => id !== window.__T.a) || window.__T.a;
    window.__T.g2 = best.provs.find(id => id !== window.__T.g) || window.__T.g;
    /* 建筑页的标签是"点一下开、再点一下关"——统一走这个助手 */
    window.__openBld = function (pid) {
      D.showInfo(pid);
      var body = document.getElementById('infoBody');
      if (!body.classList.contains('tab-bld')) {
        document.querySelector('#infoTabs .itab[data-tab="bld"]').click();
      }
    };
    window.__step = function () {          // 走一回合（事件按默认选项落地）
      D.settleTurn();
      if (D.evtPending()) D.evtPick(0);
    };
  });
  /* 先走一回合：FLOW 表按省建起来（D 节要读 d.remit） */
  await page.evaluate(() => { window.__step(); });

  /* =============================================================
   * A0 拆门槛 —— 熔旧坊 / 淘金场不问学历
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const pa = w.provinces[T.a - 1];
    /* 铁矿：先建过 2 座、再采空（真实世界里矿是先挖空再枯竭的） */
    const sa = A.resSim[T.a].iron;
    sa.built = 2; sa.tiers = { 1: 2, 2: 0 };
    sa.left = 0; sa.gone = true; sa.cool = 0;

    ok('A0 SMELT 定义里已经没有 needEdu', A.SMELT.needEdu === undefined, String(A.SMELT.needEdu));
    ok('A0 WASH 定义里也没有 needEdu', A.WASH.needEdu === undefined, String(A.WASH.needEdu));

    D.talent[T.cid].total = 0;
    window.__openBld(T.a);
    const row = document.querySelector('#iBldList .rr[data-key="iron"]');
    const btn = row && row.querySelector('.add');
    ok('A0 教育 0：熔旧坊改建钮是亮的', !!btn && btn.disabled === false,
      btn ? 'disabled=' + btn.disabled : '没找到行');
    ok('A0 教育 0：SMELT.check.ok', D.smeltCheck(T.a).ok === true, JSON.stringify(D.smeltCheck(T.a)));
    ok('A0 改建钮 title 不再出现「累计教育」', !!btn && !/累计教育/.test(btn.title),
      btn && btn.title.split('\n')[0]);
    /* ? 面板里那句"（累计教育 ≥ 15）"也得跟着消失 */
    const qb = row && row.querySelector('.qbtn');
    if (qb) qb.click();
    const info = document.querySelector('#iBldList .qinfo.on');
    ok('A0 ? 面板里也没有「累计教育」', !info || !/累计教育/.test(info.textContent),
      info ? info.textContent.slice(0, 40) : '(面板没开)');
    ok('A0 熔旧坊账目写在面板里（汇率那句话）', !!info && /1 铁 = 0\.5 金/.test(info.textContent),
      info ? 'ok' : '(面板没开)');
    return o;
  }));

  /* =============================================================
   * A 淘金场 —— 金的熔旧坊
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const pg = w.provinces[T.g - 1], pb = w.provinces[T.b - 1];

    /* ① 枯竭前不许改建（金、铁都一样） */
    const sg = A.resSim[T.g].gold;
    sg.built = 1; sg.tiers = { 1: 1, 2: 0 }; sg.left = sg.n; sg.gone = false; sg.cool = 0;
    const sb = A.resSim[T.b].iron;
    sb.built = 1; sb.tiers = { 1: 1, 2: 0 }; sb.left = sb.n; sb.gone = false; sb.cool = 0;
    ok('A 金矿没枯：淘金场改建被规则挡住', !D.washCheck(T.g).ok && /还没枯竭/.test(D.washCheck(T.g).why),
      D.washCheck(T.g).why);
    ok('A 铁矿没枯（还在产）：熔旧坊改建同样被挡住',
      !D.smeltCheck(T.b).ok && /还在产/.test(D.smeltCheck(T.b).why),
      D.smeltCheck(T.b).why);

    /* ② 枯竭之后：无门槛，直接可改建 */
    sg.left = 0; sg.gone = true; sg.cool = 0;
    ok('A 金矿枯竭：无门槛（教育 0 也 ok）', D.washCheck(T.g).ok === true,
      JSON.stringify(D.washCheck(T.g)));

    /* UI：金矿那一行的 ＋ 变成「改建」 */
    window.__openBld(T.g);
    const row = document.querySelector('#iBldList .rr[data-key="gold"]');
    const btn = row && row.querySelector('.add');
    ok('A 金矿枯竭：金矿行出现「改建」钮', !!btn && btn.textContent === '改建',
      btn ? btn.textContent : '没找到行');
    ok('A 改建钮带 data-wash 标记（和熔旧坊的 data-smelt 分开）',
      !!btn && btn.getAttribute('data-wash') === '1', btn && btn.getAttribute('data-wash'));

    /* ③ 改建 → 两回合后行内变身 */
    D.buildWash(pg);
    const st = D.washOf(T.g);
    ok('A 改建开工：site = 2', st && st.site === 2, st && st.site);
    for (let i = 0; i < 2; i++) window.__step();
    ok('A 两回合后完工：n = 1', st.site === 0 && st.n === 1, 'site=' + st.site + ' n=' + st.n);
    window.__openBld(T.g);
    const row2 = document.querySelector('#iBldList .rr[data-key="gold"]');
    ok('A 行内变身：名字变「淘金场」', !!row2 && row2.querySelector('.nm').textContent === '淘金场',
      row2 && row2.querySelector('.nm').textContent);
    const img = row2 && row2.querySelector('img');
    ok('A 行内变身：图标是 item-wash-bld.png',
      !!img && /item-wash-bld\.png/.test(img.getAttribute('src') || ''), img && img.getAttribute('src'));
    ok('A 行内变身：×n 读的是淘金场座数', !!row2 && row2.querySelector('.qty').textContent === '×1',
      row2 && row2.querySelector('.qty').textContent);

    /* ④ 1 金 = 2 木：攒够 10 金，木正好够 */
    st.iAcc = 9.9; st.halted = false;
    A.resSim[T.g].gold.stock = 0;
    A.resSim[T.g].timber.stock = 100;
    const g0 = D.stockOf(T.g, 'gold'), t0 = D.stockOf(T.g, 'timber');
    const got = D.settleWash(T.g, pg.owner);
    const dg = D.stockOf(T.g, 'gold') - g0, dt = t0 - D.stockOf(T.g, 'timber');
    ok('A 一炉出 10 金', got === 10 && dg === 10, 'got=' + got + ' Δ金=' + dg);
    ok('A 1 金 = 2 木（10 金耗 20 木）', dt === 20, 'Δ木=' + dt);
    ok('A 产的金进省库（走 gainStock，吃满仓上限）', dg === 10, 'Δ金=' + dg);

    /* ⑤ 没木 → 当回合不出金、不倒扣 */
    st.iAcc = 9.9; st.halted = false;
    A.resSim[T.g].gold.stock = 0;
    A.resSim[T.g].timber.stock = 5;                 // 不够 20
    const got2 = D.settleWash(T.g, pg.owner);
    ok('A 没木：当回合不出金', got2 === 0, 'got=' + got2);
    ok('A 没木：不扣木（5 还是 5，不倒扣成 −15）', D.stockOf(T.g, 'timber') === 5,
      '木=' + D.stockOf(T.g, 'timber'));
    ok('A 没木：金库也不变', D.stockOf(T.g, 'gold') === 0, '金=' + D.stockOf(T.g, 'gold'));
    ok('A 没木：状态标成停淘（halted）', st.halted === true, 'halted=' + st.halted);

    /* ⑥ 封顶 2 座 */
    A.resSim[T.g].timber.stock = 400;
    st.site = 0; st.n = 2;
    ok('A 封顶：第 3 座被规则挡住', !D.washCheck(T.g).ok && /封顶 2/.test(D.washCheck(T.g).why),
      D.washCheck(T.g).why);
    window.__openBld(T.g);
    const btn3 = document.querySelector('#iBldList .rr[data-key="gold"] .add');
    ok('A 封顶：改建钮置灰', !!btn3 && btn3.disabled === true, btn3 ? 'disabled=' + btn3.disabled : '没找到');
    return o;
  }));

  /* ---------------- 截图：金矿行变身 / 改建钮 ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug, T = window.__T;
    D.washOf(T.g).site = 0;
    window.__openBld(T.g);
  });
  await sleep(500);
  const card = await page.evaluate(() => {
    const r = document.getElementById('info').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 940) };
  });
  await page.screenshot({ path: shot('lifeline-wash-row.png'), clip: card });
  await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, T = window.__T;
    delete D.wash[T.g];
    A.resSim[T.g].gold.gone = true;
    A.resSim[T.g].gold.left = 0;
    window.__openBld(T.g);
  });
  await sleep(400);
  await page.screenshot({ path: shot('lifeline-wash-build.png'), clip: card });

  /* =============================================================
   * B AI 会卖货（市场 5:1 终于对 AI 开门）
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, AI = A.aiDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const cid = T.cid, owner = cid;
    const pid = T.m, p = w.provinces[pid - 1];

    /* 建一座市场（直接铺状态，省得等两回合工地） */
    A.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const line = (k) => {
      const pop = (A.resPop[pid] || {}).v || 0;
      const eat = Math.max(1, Math.round(pop / 2000000));
      return (k === 'grain' || k === 'fish') ? eat * 4 + 30 : (k === 'horse' ? 20 : 40);
    };
    /* 清场：把**全国**能卖的东西都清零（不然前面几条留下的 200 粮会混进
     * 后面的"这一条到底卖了几手"里 —— 每国每回合的上限只有 2 手） */
    const reset = () => {
      for (const id of T.provs) {
        const bag = A.resSim[id];
        if (!bag) continue;
        for (const k of ['grain', 'timber', 'fish', 'salt', 'horse', 'iron']) {
          if (bag[k]) bag[k].stock = 0;
        }
        if (bag.gold) bag.gold.stock = 0;
        D.sellAcc[id] = 0.99;                // 攒到 0.99：这一手必落 1 金
      }
    };

    /* ① 积压卖货 → PI 金进省库 */
    reset();
    A.resSim[pid].grain.stock = line('grain') + 100;
    const pi = D.priceOf(owner, 'grain');
    const g0 = D.goldOf(pid), gr0 = D.stockOf(pid, 'grain');
    const sold = AI.sellMarket(cid);
    const dg = D.goldOf(pid) - g0;
    ok('B 有市场 + 积压 → 卖出一手', sold === 1, 'sold=' + sold);
    ok('B 一手扣 5 单位', gr0 - D.stockOf(pid, 'grain') === 5,
      'Δ粮=' + (gr0 - D.stockOf(pid, 'grain')));
    ok('B 金进省库（0.99 攒整 + PI → floor）', dg === Math.floor(0.99 + pi),
      'Δ金=' + dg + ' / 期望 ' + Math.floor(0.99 + pi) + '（PI ' + pi.toFixed(2) + '）');

    /* ② 安全线内不卖（粮正好压线） */
    reset();
    A.resSim[pid].grain.stock = line('grain');
    const n2 = AI.sellMarket(cid);
    ok('B 粮在安全线内不卖', n2 === 0 && D.stockOf(pid, 'grain') === line('grain'),
      'sold=' + n2 + ' 粮=' + D.stockOf(pid, 'grain'));

    /* ③ 围城 / 占领省不卖 */
    reset();
    A.resSim[pid].grain.stock = 200;
    D.siegeMap[pid] = { by: 1, turns: 1 };
    const n3 = AI.sellMarket(cid);
    delete D.siegeMap[pid];
    ok('B 围城省不卖', n3 === 0 && D.stockOf(pid, 'grain') === 200,
      'sold=' + n3 + ' 粮=' + D.stockOf(pid, 'grain'));
    D.occupyMap[pid] = 1;
    const n4 = AI.sellMarket(cid);
    delete D.occupyMap[pid];
    ok('B 占领省不卖', n4 === 0 && D.stockOf(pid, 'grain') === 200,
      'sold=' + n4 + ' 粮=' + D.stockOf(pid, 'grain'));

    /* ④ 每国每回合 ≤ sellLots（占位 2）：铺三个市场省、每个都积压 */
    const three = T.provs.slice(0, 3);
    for (const id of three) {
      A.resMarket[id] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      A.resSim[id].grain.stock = 200;
      A.resSim[id].timber.stock = 0; A.resSim[id].fish.stock = 0;
      A.resSim[id].salt.stock = 0; A.resSim[id].horse.stock = 0;
      D.sellAcc[id] = 0;
    }
    const n5 = AI.sellMarket(cid);
    ok('B 每国每回合至多 ' + A.AIECON.sellLots + ' 手', n5 === A.AIECON.sellLots, 'sold=' + n5);

    /* ⑤ 铁也能交易（拍板改口）：库存过安全线就卖，压线不卖 */
    reset();
    A.resSim[pid].iron.stock = 100;                 // 安全线 40，够卖
    const n6 = AI.sellMarket(cid);
    ok('B 铁过安全线（100 > 40）→ 卖出一手', n6 === 1 && D.stockOf(pid, 'iron') === 95,
      'sold=' + n6 + ' 铁=' + D.stockOf(pid, 'iron'));
    reset();
    A.resSim[pid].iron.stock = 40;                  // 正好压线：不卖
    const n7 = AI.sellMarket(cid);
    ok('B 铁在安全线内（40）不卖', n7 === 0 && D.stockOf(pid, 'iron') === 40,
      'sold=' + n7 + ' 铁=' + D.stockOf(pid, 'iron'));

    /* ⑥ 卖键 / 买货键都含 iron */
    ok('B AIWAR.trade.sellKeys 含 iron（铁也可以交易）',
      A.AIWAR.trade.sellKeys.indexOf('iron') >= 0, A.AIWAR.trade.sellKeys.join(','));
    ok('B AIWAR.trade.keys（买货）里 iron 保留',
      A.AIWAR.trade.keys.indexOf('iron') >= 0, A.AIWAR.trade.keys.join(','));
    return o;
  }));

  /* =============================================================
   * B2 兑换（以物易物：任何两种资源都能换，金也能换铁）
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const pid = T.m, p = w.provinces[pid - 1], cid = p.owner;
    A.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const bag = A.resSim[pid];
    const cut = 1 - A.MARKET.xchg.spread;
    const outOf = (give, get) =>
      Math.floor(5 * D.priceOf(cid, give) / D.priceOf(cid, get) * cut + 1e-9);

    /* ① 汇率 = 两边物价之比 × (1 − 抽成) */
    const piG = D.priceOf(cid, 'grain'), piI = D.priceOf(cid, 'iron');
    ok('B2 汇率 = 粮价 / 铁价 × (1 − ' + A.MARKET.xchg.spread + ')',
      D.xchgOut(cid, 'grain', 'iron', 5) === outOf('grain', 'iron'),
      'xchgOut=' + D.xchgOut(cid, 'grain', 'iron', 5) + '（粮价 ' + piG.toFixed(2) +
      ' / 铁价 ' + piI.toFixed(2) + '）');

    /* ② 粮 → 铁 */
    const e1 = outOf('grain', 'iron');
    bag.grain.stock = 50; bag.iron.stock = 0;
    const r1 = D.exchange(pid, 'grain', 'iron', true);
    ok('B2 粮换铁：成交', !!r1 && r1.ok === true, JSON.stringify(r1));
    ok('B2 粮换铁：粮 −5 / 铁 +' + e1,
      bag.grain.stock === 45 && bag.iron.stock === e1,
      '粮=' + bag.grain.stock + ' 铁=' + bag.iron.stock);

    /* ③ 金 → 铁（点名的场景） */
    const e2 = outOf('gold', 'iron');
    bag.gold.stock = 50; bag.iron.stock = 0;
    const r2 = D.exchange(pid, 'gold', 'iron', true);
    ok('B2 金换铁：成交', !!r2 && r2.ok === true, JSON.stringify(r2));
    ok('B2 金换铁：金 −5 / 铁 +' + e2,
      bag.gold.stock === 45 && bag.iron.stock === e2,
      '金=' + bag.gold.stock + ' 铁=' + bag.iron.stock);

    /* ④ 鱼换盐（"什么都可以互相换"—— 两条非战略资源之间也行） */
    const e3 = outOf('fish', 'salt');
    bag.fish.stock = 50; bag.salt.stock = 0;
    const r3 = D.exchange(pid, 'fish', 'salt', true);
    ok('B2 鱼换盐：成交', !!r3 && r3.ok === true && bag.salt.stock === e3,
      'salt=' + bag.salt.stock + ' / 期望 ' + e3);

    /* ⑤ 同种不换 */
    const r4 = D.exchange(pid, 'iron', 'iron', true);
    ok('B2 同种不换', !!r4 && r4.ok === false, r4 && r4.why);

    /* ⑥ 付出不够 5 → 不换 */
    bag.grain.stock = 3;
    const r5 = D.exchange(pid, 'grain', 'iron', true);
    ok('B2 付出不够 5 → 不换', !!r5 && r5.ok === false && bag.grain.stock === 3,
      (r5 && r5.why) + ' 粮=' + bag.grain.stock);

    /* ⑦ 目标满仓 → 不换，而且**不白扣**付出 */
    bag.grain.stock = 50;
    bag.iron.stock = D.capOf(pid, 'iron');
    const r6 = D.exchange(pid, 'grain', 'iron', true);
    ok('B2 目标满仓 → 不换（粮不扣）', !!r6 && r6.ok === false && bag.grain.stock === 50,
      (r6 && r6.why) + ' 粮=' + bag.grain.stock);

    /* ⑧ 市场停产 → 换不了 */
    bag.iron.stock = 0;
    A.resMarket[pid].halted = true;
    const r7 = D.exchange(pid, 'grain', 'iron', true);
    ok('B2 市场停产 → 换不了', !!r7 && r7.ok === false, r7 && r7.why);
    A.resMarket[pid].halted = false;

    /* ⑨ 流水：一进一出都记着 */
    bag.grain.stock = 50; bag.iron.stock = 0;
    D.exchange(pid, 'grain', 'iron', true);
    const F = D.flow[pid];
    ok('B2 流水里一进一出都记着（d.xchg）',
      !!F && (F.loss.grain || 0) >= 5 && (F.gain.iron || 0) >= e1 && !!F.d.xchg,
      F ? ('粮 −' + F.loss.grain + ' / 铁 +' + F.gain.iron) : '没流水');

    /* ⑩ 面板：两排各 7 个键 + 「兑换」钮 */
    D.showInfo(pid);
    const body = document.getElementById('infoBody');
    if (!body.classList.contains('tab-bld')) {
      document.querySelector('#infoTabs .itab[data-tab="bld"]').click();
    }
    const mrow = document.querySelector('#iSchoolList .rr[data-univ="market"]');
    const qb = mrow && mrow.querySelector('.qbtn');
    if (qb) qb.click();
    const panel = document.querySelector('#iSchoolList .qinfo.on');
    const nGive = panel ? panel.querySelectorAll('button[data-xgive]').length : 0;
    const nGet = panel ? panel.querySelectorAll('button[data-xget]').length : 0;
    ok('B2 面板里有两排各 7 个键（付出 / 换回）', nGive === 7 && nGet === 7,
      'give=' + nGive + ' get=' + nGet);
    const xdo = panel && panel.querySelector('button[data-xdo]');
    ok('B2 面板里有「兑换」钮', !!xdo, xdo ? xdo.textContent : '没找到');
    return o;
  }));

  /* ---------------- 截图：兑换面板 ----------------
   * 兑换块在市场的 ? 面板**最下面**，卡片本身是可滚动的 ——
   * 先滚到底再截，否则截出来只有卖货/买货那两段。 */
  await sleep(300);
  await page.evaluate(() => {
    const ids = ['infoBody', 'iSchoolList', 'info'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.scrollTop = el.scrollHeight;
    }
  });
  await sleep(200);
  const card2 = await page.evaluate(() => {
    const r = document.getElementById('info').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 940) };
  });
  await page.screenshot({ path: shot('lifeline-xchg.png'), clip: card2 });

  /* =============================================================
   * C 产线库存闸（和平期不再白烧铁）
   *
   * v19 制造工艺批把产线从"每省每坊一份 arm/hor/syd"改成了**全国三池 + 19 条线**
   * （millOf(owner).alloc 是扁平的线名表），这一节跟着换读法：
   *   分配读 D.millOf(cid).alloc[线名] · 池容量读 D.poolCap(cid,'arm')
   *   兵刃库存读武库 D.arsTotal(cid,'wpn')（不再是省库的 itemStock）
   * 断言仍落在"两道闸"本身，不去钉 4:6 的精确点数 —— 那是策略，不是规则。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, AI = A.aiDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const cid = T.cid;
    const pid = T.provs[T.provs.length - 1];           // 用玩家国最后一个省，AI 不会来抢
    const c = w.countries[cid - 1];
    const M = A.AIECON.mill;

    /* 军械坊 2 座（每座 2 点 → 全国军械池 4 点）+ 一个匠人（装备线的钥匙） */
    A.resMil.armory[pid] = { n: 2, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null };
    D.addTalent(cid, 400);
    const ex = D.examArtisan(cid);
    if (ex && ex.ok) D.postArtisan(pid, ex.artisan.id, true);
    const capA = D.poolCap(cid, 'arm');
    ok('C 军械坊产能 ≥ 4 点（才看得出怎么分）', capA >= 4, 'cap=' + capA);

    /* 先清场：没有军队、没有装备、武库空 */
    const oldArmies = [];
    for (const k in D.army) if (D.army[k] && D.army[k].owner === cid) oldArmies.push(k);
    for (const k of oldArmies) delete D.army[k];
    const eq = D.equipOf(cid);
    for (const s of A.EQUIP.slots) for (const q of A.EQUIP.q) eq[s][q] = 0;
    const ars = D.arsOf(cid);
    for (const k in ars.wpn) delete ars.wpn[k];
    const bw = D.bestWeapon(cid);

    const alloc = () => D.millOf(cid).alloc;
    const eqPts = () => (alloc().helm | 0) + (alloc().chest | 0) + (alloc().boots | 0);
    const wpnPts = () => alloc().dao | 0;
    const sumArm = () => D.allocSum(cid, 'arm');

    /* ① 没有军队 → 装备需求 = 0 → 装备线归零，点全给兵刃 */
    AI.millPolicy(c, AI.personaOf(cid));
    ok('C 无军队：装备三线全 0', eqPts() === 0,
      'helm=' + alloc().helm + ' chest=' + alloc().chest + ' boots=' + alloc().boots);
    ok('C 无军队：点全给兵刃', wpnPts() > 0 && sumArm() === wpnPts(),
      '兵刃=' + wpnPts() + ' / 池内合计=' + sumArm());

    /* ② 有 1 支军队、装备 0 → 装备缺口 3 → 装备线重新开（和平档 兵刃4:装备6） */
    const a1 = D.newArmy(cid, pid, { type: 'army', tier: bw.key, men: 1000 });
    a1.order = { type: 'defend', cid: cid, pid: pid, tactic: 'assault' };
    AI.millPolicy(c, AI.personaOf(cid));
    ok('C 有军队但缺装备：装备线重新开（和平档 兵刃 4 : 装备 6）',
      eqPts() > 0 && wpnPts() > 0 && sumArm() <= capA,
      '兵刃=' + wpnPts() + ' 装备=' + eqPts() + ' / cap=' + capA);

    /* ③ 装备 ≥ 军队 × equipNeedPerArmy → 装备线归零 */
    eq.helm.plain = 1 * (M.equipNeedPerArmy || 3);
    AI.millPolicy(c, AI.personaOf(cid));
    ok('C 装备够用（≥ 军队×' + M.equipNeedPerArmy + '）：装备线归零', eqPts() === 0,
      'helm=' + alloc().helm + ' chest=' + alloc().chest + ' boots=' + alloc().boots);
    ok('C 装备够用：点全给兵刃', wpnPts() > 0, '兵刃=' + wpnPts());

    /* ④ 兵刃 ≥ wpnStockCap → 兵刃线也归零（两闸都关 → 整池空转） */
    D.arsAdd(cid, 'wpn', bw.key + '|plain|plain|plain', M.wpnStockCap + 5);
    AI.millPolicy(c, AI.personaOf(cid));
    ok('C 兵刃够用（≥' + M.wpnStockCap + '）：兵刃线也归零', wpnPts() === 0,
      '兵刃=' + wpnPts() + ' / 武库 ' + D.arsTotal(cid, 'wpn'));
    ok('C 两闸都关：整池产线全零（坊空转）', sumArm() === 0, 'alloc=' + sumArm());

    /* ⑤ 全停时铁库存逐回合不降、也不出货 */
    const iron0 = D.stockOf(pid, 'iron');
    const wpn0 = D.arsTotal(cid, 'wpn'), eq0 = D.equipTotal(cid);
    for (let i = 0; i < 3; i++) window.__step();
    AI.millPolicy(c, AI.personaOf(cid));      // 每回合都会重排，这里再确认一次
    ok('C 全停：3 回合没出过一件兵刃', D.arsTotal(cid, 'wpn') === wpn0,
      '兵刃 ' + wpn0 + ' → ' + D.arsTotal(cid, 'wpn'));
    ok('C 全停：3 回合没打过一件装备', D.equipTotal(cid) === eq0,
      '装备 ' + eq0 + ' → ' + D.equipTotal(cid));
    ok('C 全停：省库铁没有下降', D.stockOf(pid, 'iron') >= iron0,
      '铁 ' + iron0 + ' → ' + D.stockOf(pid, 'iron'));
    return o;
  }));

  /* =============================================================
   * D 省库上解（把散在省里的金聚回中央）
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const pid = T.m, owner = w.provinces[pid - 1].owner;
    const cen = D.ensureCentral(owner);

    ok('D 规则在 GOV 定义区（30 免 / 30~80 抽 10% / >80 抽 25% / 每省 ≤3）',
      A.GOV.remit && A.GOV.remit.free === 30 && A.GOV.remit.low === 80 &&
      A.GOV.remit.lowRate === 0.10 && A.GOV.remit.highRate === 0.25 &&
      A.GOV.remit.cap === 3,
      JSON.stringify(A.GOV.remit));

    /* 每条断言都从"确定状态"出发：金设成指定值 + 上解零头清零
     * （零头是跨回合的，不清的话上一条的 0.5 会漏进来把这一条算多 1）。 */
    const set = (v) => { D.setGold(pid, v); D.remitAcc[pid] = 0; };

    /* ① ≤ 30 免：那是省里的家底（买料 / 垫俸禄 / 开工钱） */
    cen.gold = 0;
    set(30);
    const m1 = D.settleRemit(pid, owner);
    ok('D 省库 30（到起征点但不超）→ 不动', m1 === 0 && D.goldOf(pid) === 30,
      'moved=' + m1 + ' 省库=' + D.goldOf(pid));

    /* ② 30~80 段抽 10%：50 → (50−30)×0.10 = 2 */
    cen.gold = 0;
    set(50);
    const m2 = D.settleRemit(pid, owner);
    ok('D 省库 50 → 上解 2（(50−30)×10%）', m2 === 2 && D.goldOf(pid) === 48 &&
      (cen.gold || 0) === 2, 'moved=' + m2 + ' 省库=' + D.goldOf(pid) + ' 中央=' + cen.gold);

    /* ③ 150：50×0.10 + 70×0.25 = 22.5，但每省每回合封顶 3 */
    cen.gold = 0;
    set(150);
    /* 流水是**按回合累计**的：前面几节走过回合，这一省可能已经有上解记录。
     * 所以断言看的是"这一笔"的增量，不是绝对值。 */
    const F = D.flow[pid];
    const r0 = (F && F.d.remit) || 0;
    const moved = D.settleRemit(pid, owner);
    ok('D 省库 150 → 上解 3（22.5 被 cap 夹住，防大省抽干）',
      moved === 3 && D.goldOf(pid) === 147, 'moved=' + moved + ' 省库=' + D.goldOf(pid));
    ok('D 中央 +3', (cen.gold || 0) === 3, '中央=' + cen.gold);

    /* ④ 流水里看得见（省侧 d.remit） */
    ok('D 流水 d.remit 记了这一笔', !!F && (F.d.remit - r0) === 3,
      F ? 'd.remit ' + r0 + ' → ' + F.d.remit : '没流水');

    /* ⑤ 攒整：35 → 0.5 金/回合，两回合才落 1 金（floor 不许把它抹平） */
    cen.gold = 0;
    set(35);
    const m5a = D.settleRemit(pid, owner);
    const m5b = D.settleRemit(pid, owner);
    ok('D 省库 35：第一回合 0 金、第二回合 1 金（0.5 攒整）',
      m5a === 0 && m5b === 1 && D.goldOf(pid) === 34 && (cen.gold || 0) === 1,
      'moved=' + m5a + ',' + m5b + ' 省库=' + D.goldOf(pid) + ' 中央=' + cen.gold);

    /* ⑥ 只走金不走铁：铁库存原样 */
    const iron0 = D.stockOf(pid, 'iron');
    cen.gold = 0; set(150);
    D.settleRemit(pid, owner);
    ok('D 只搬金：铁库存不动', D.stockOf(pid, 'iron') === iron0,
      '铁 ' + iron0 + ' → ' + D.stockOf(pid, 'iron'));
    return o;
  }));

  /* =============================================================
   * E AI 缺了会开矿（对稀缺有反应）
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, AI = A.aiDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const cid = T.cid, cen = D.ensureCentral(cid);
    const M = A.AIECON.mineOpen;

    ok('E 常数在定义区（at / left）',
      M && M.at.iron === 40 && M.left.iron === 25, JSON.stringify(M));

    /* 清场：全国铁库存归零、每个省的铁矿都"没建过、left 归零"，
     * 这样只有我们指定的两块地满足条件（left ≥ 25）。 */
    cen.iron = 0;
    for (const id of T.provs) {
      const s = A.resSim[id].iron;
      s.stock = 0; s.built = 0; s.tiers = { 1: 0, 2: 0 }; s.left = 0;
      s.gone = false; s.cool = 0; s.site = 0;
    }
    const p1 = T.provs[0], p2 = T.provs[1];
    A.resSim[p1].iron.left = 50;
    A.resSim[p2].iron.left = 50;
    A.resPop[p1].v = 80000;
    A.resPop[p2].v = 400000;                      // 同 left，人口大的先开

    /* ① 中央金不够 → 不动 */
    cen.gold = 0;
    const r0 = AI.mineOpen(cid);
    ok('E 中央金不够：不开矿', r0 === false && A.resSim[p1].iron.site === 0 && A.resSim[p2].iron.site === 0,
      'ret=' + r0 + ' site=' + A.resSim[p1].iron.site + '/' + A.resSim[p2].iron.site);

    /* ② 全国铁 < 40 → 在 left ≥ 25 的省开工 */
    cen.gold = 400; cen.timber = 400; cen.grain = 400;
    const r1 = AI.mineOpen(cid);
    const started = A.resSim[p1].iron.site > 0 || A.resSim[p2].iron.site > 0;
    ok('E 全国铁 < 40：真的开了一座矿', r1 === true && started,
      'ret=' + r1 + ' site=' + A.resSim[p1].iron.site + '/' + A.resSim[p2].iron.site);
    ok('E 同 left 挑人口大的省', A.resSim[p2].iron.site > 0 && A.resSim[p1].iron.site === 0,
      'p1(8万)=' + A.resSim[p1].iron.site + ' p2(40万)=' + A.resSim[p2].iron.site);

    /* ③ 铁够了（≥ at）就不开 */
    A.resSim[p2].iron.site = 0;
    A.resSim[p2].iron.built = 1;
    cen.iron = M.at.iron + 10;
    const r2 = AI.mineOpen(cid);
    ok('E 全国铁 ≥ ' + M.at.iron + '：不再开矿', r2 === false && A.resSim[p1].iron.site === 0,
      'ret=' + r2);

    /* ④ left 不够（薄矿）不开 */
    cen.iron = 0;
    A.resSim[p2].iron.built = 0;
    A.resSim[p2].iron.left = M.left.iron - 1;
    A.resSim[p1].iron.left = M.left.iron - 1;
    const r3 = AI.mineOpen(cid);
    ok('E left < ' + M.left.iron + ' 的薄矿不开', r3 === false && A.resSim[p1].iron.site === 0,
      'ret=' + r3);
    return o;
  }));

  /* =============================================================
   * F 税也收铁（v18 追加二）—— 人口铁税从涓流提为常脉
   *
   * 口径没变：铁税 = 人口 / ironUnit × ironPer2M[档] × mul，
   * mul 和金税**是同一个**（有官 taxMul / 无官 0.6）× happyTaxMul(民心)。
   * 变的只有单位：ironUnit 200 万 → 10 万（与 popUnit 同源）。
   *   80 万人 · 常规档：裸算 8 × 0.2 = 1.6 铁/回合，乘民心 0.96 ≈1.54
   *   80 万人 · 横征档：裸算 8 × 0.4 = 3.2，乘民心 0.96 ≈3.07（民心 −12 的代价）
   * 这里跑 10 回合看落袋 —— 小数走 IRONACC 攒整，单回合会被 floor 抹平。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world(), G = A.GOV;
    const pid = T.provs.find(id => A.resSim[id] && A.resSim[id].iron) || T.m;
    const prov = w.provinces[pid - 1], owner = prov.owner;
    const bag = A.resSim[pid], cen = D.ensureCentral(owner);
    window.__Fpid = pid;

    /* ① 常数：铁税与金税同单位（每 10 万人），三档 0.1 / 0.2 / 0.4 */
    ok('F 铁税与金税同单位（ironUnit = 10 万 = popUnit）',
      G.ironUnit === 100000 && G.ironUnit === G.popUnit,
      'ironUnit=' + G.ironUnit + ' popUnit=' + G.popUnit);
    ok('F 三档 0.1 / 0.2 / 0.4（每 10 万人）',
      JSON.stringify(G.ironPer2M) === '[0.1,0.2,0.4]', JSON.stringify(G.ironPer2M));

    /* ② 80 万人 · 常规档 · 有官（plain 词条 taxMul = 1）· 民心 60 */
    if (A.resOfficial[pid]) D.dismiss(pid, true);
    const talent = A.resTalent[owner];
    talent.pool.push({ id: 91001, name: '测试常脉', traitKey: 'plain', owed: 0 });
    D.assign(pid, 91001, true);
    A.resPop[pid].v = 800000;

    const happyMul = G.happyTaxMul(60);
    const rawOf = (rate, mul) => 800000 / G.ironUnit * G.ironPer2M[rate] * mul * happyMul;
    const run = (rate, turns) => {
      D.setTax(owner, rate);
      A.resHappy[pid].v = 60; A.resHappy[pid].target = 60;
      A.resTaxAcc[pid] = 0; D.ironAcc[pid] = 0;
      bag.iron.stock = 0;
      const cen0 = cen.iron || 0;
      for (let i = 0; i < turns; i++) A.resSettleTax(pid, owner, prov, null);
      return { got: D.stockOf(pid, 'iron'), cenD: (cen.iron || 0) - cen0 };
    };
    const TEN = 10;
    const rOff = run(1, TEN);
    ok('F 80 万人 · 常规档：裸算 1.6 铁/回合（8 × 0.2）',
      Math.abs(800000 / G.ironUnit * G.ironPer2M[1] - 1.6) < 1e-9,
      (800000 / G.ironUnit * G.ironPer2M[1]).toFixed(2));
    ok('F 80 万人 · 常规档：10 回合落 ≈' + (rawOf(1, 1) * TEN).toFixed(1) + ' 铁（每回合 ≈1.5）',
      rOff.got >= 14 && rOff.got <= 16, '落袋 ' + rOff.got + ' 铁 / 10 回合');
    ok('F 税铁进省库，不进中央', rOff.cenD === 0, '中央铁 Δ=' + rOff.cenD);

    /* ③ 无官省 ×0.6（同一档、同一民心，只差官员那一个系数） */
    D.dismiss(pid, true);
    const rNone = run(1, TEN);
    ok('F 无官省 ×0.6（同样 10 回合，落袋 ≈0.6 倍）',
      Math.abs(rNone.got / Math.max(1, rOff.got) - 0.6) < 0.06,
      '有官 ' + rOff.got + ' / 无官 ' + rNone.got + ' = ' +
      (rNone.got / Math.max(1, rOff.got)).toFixed(2));

    /* ④ 横征档 ≈3.1（裸 3.2 × 民心 0.96） */
    talent.pool.push({ id: 91002, name: '测试横征', traitKey: 'plain', owed: 0 });
    D.assign(pid, 91002, true);
    const rMax = run(2, TEN);
    ok('F 横征档 ≈3.1 铁/回合（裸 3.2 × 民心 0.96）',
      Math.abs(rawOf(2, 1) - 3.072) < 1e-9 && rMax.got >= 29 && rMax.got <= 32,
      '裸 ' + rawOf(2, 1).toFixed(2) + ' / 10 回合落 ' + rMax.got + ' 铁');
    ok('F 横征档的代价是民心 −12', G.happyHit[2] === -12, G.happyHit[2]);

    /* ⑤ rateDesc：金铁两个单位同源（都写 10 万人），不再有硬编码的 200 万 */
    const desc = G.rateDesc(1);
    const hits = (desc.match(/每 10 万人/g) || []).length;
    ok('F rateDesc 两处单位一致（都是 10 万人）', hits === 2 && !/200 万/.test(desc), desc);

    /* ⑥ 存档零迁移：常数变了，IRONACC 的零头照攒（下一节读档后验它还在） */
    D.ironAcc[pid] = 0.75;
    return o;
  }));

  /* =============================================================
   * G 市场一座 · 国库不是商店（v18 追加三）
   *
   * 两件事，一个口径：
   *   ① 市场每省一座（MARKET.maxPer = 1）—— 它是"换金的口"，不是产能建筑；
   *   ② 买货不再从中央国库扣货：货从**世界市场**来（供给无限），
   *      省库付的金**沉没**（谁都不记这笔进项）—— 买货是通胀阀门，不是搬仓库。
   *      buyCentral 退役，中央只剩维护拨款 / 建造调拨 / 科技国家工程三个去处。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const pid = T.m, p = w.provinces[pid - 1], cid = p.owner;
    const bag = A.resSim[pid], cen = D.ensureCentral(cid);

    /* ① 定义区：每省一座；买货那条旧路（buyCentral）已经退役 */
    ok('G MARKET.maxPer = 1（每省一座市场）', A.MARKET.maxPer === 1, 'maxPer=' + A.MARKET.maxPer);
    ok('G buyCentral 退役：只剩 buyWorld（AI 与玩家同一条账）',
      typeof D.buyWorld === 'function' && typeof D.buyCentral === 'undefined',
      'buyWorld=' + typeof D.buyWorld + ' buyCentral=' + typeof D.buyCentral);

    /* ② 已有一座 → 第二座建不了，而且不扣料 */
    A.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const t0 = D.stockOf(pid, 'timber'), g0 = D.stockOf(pid, 'gold');
    D.buildUniv(p, 'market');
    ok('G 已有一座：第二座建不了（site 仍 0、座数仍 1）',
      A.resMarket[pid].site === 0 && A.resMarket[pid].n === 1,
      'site=' + A.resMarket[pid].site + ' n=' + A.resMarket[pid].n);
    ok('G 第二座被挡住时不扣料',
      D.stockOf(pid, 'timber') === t0 && D.stockOf(pid, 'gold') === g0,
      '木 ' + t0 + '→' + D.stockOf(pid, 'timber') + ' · 金 ' + g0 + '→' + D.stockOf(pid, 'gold'));

    /* UI：＋ 钮置灰（不隐藏），title 直接给替代方案 */
    window.__openBld(pid);
    const mrow = document.querySelector('#iSchoolList .rr[data-univ="market"]');
    const add = mrow && mrow.querySelector('.add');
    ok('G ＋ 钮置灰且 title =「每省一座市场——要吞吐量就去修货运」',
      !!add && add.disabled === true && /每省一座市场——要吞吐量就去修货运/.test(add.title),
      add ? 'disabled=' + add.disabled + ' title=' + add.title : '没找到行');

    /* ③ 买货：货从世界市场来、中央一分不动、金沉没 */
    const lot = A.GOV.buyLot();
    cen.iron = 50; cen.gold = 0;
    bag.iron.stock = 0;
    D.setGold(pid, 100);
    const pi = D.priceOf(cid, 'iron');
    const price = D.buyGold(cid, 'iron');
    ok('G 价格 = lot(' + lot.n + ') × buyMul(' + A.GOV.buyMul + ') × PI，向上取整',
      price === Math.ceil(lot.gold * pi) && lot.gold === Math.ceil(lot.n * A.GOV.buyMul),
      'lot.gold=' + lot.gold + ' × PI ' + pi.toFixed(2) + ' → ' + price + ' 金');
    const rb = D.buy(pid, 'iron');
    ok('G 买货成交，货 +' + lot.n + ' 进省库',
      !!rb && rb.ok === true && D.stockOf(pid, 'iron') === lot.n && rb.from === 'world',
      JSON.stringify(rb) + ' 铁=' + D.stockOf(pid, 'iron'));
    ok('G 中央铁不动（国库不是商店，货不从这里扣）', cen.iron === 50, '中央铁=' + cen.iron);
    ok('G 中央金也不涨（省库付的金沉没进世界市场）', (cen.gold || 0) === 0, '中央金=' + cen.gold);
    ok('G 省库金 −' + price, D.goldOf(pid) === 100 - price, '省库金=' + D.goldOf(pid));

    /* ④ 把中央全部清空 → 买货钮照旧不灰（唯一的闸是省库金） */
    for (const k of ['grain', 'fish', 'salt', 'timber', 'horse', 'iron', 'gold']) cen[k] = 0;
    const openMarket = () => {
      window.__openBld(pid);
      const q = document.querySelector('#iSchoolList .rr[data-univ="market"] .qbtn');
      for (let i = 0; i < 2 && q; i++) {
        q.click();
        const pn = document.querySelector('#iSchoolList .qinfo.on');
        if (pn && /买货/.test(pn.textContent)) return pn;
      }
      return null;
    };
    let panel = openMarket();
    let buys = panel ? [...panel.querySelectorAll('button[data-buy]')] : [];
    ok('G 中央清空：七行买货钮照旧全亮（不因"中央没货"变灰）',
      buys.length === 7 && buys.every(b => !b.disabled),
      buys.length + ' 行，亮 ' + buys.filter(b => !b.disabled).length);
    ok('G 买货 title 写明「世界市场进货：价随本国物价走，越缺越贵」',
      !!buys[0] && /世界市场进货：价随本国物价走，越缺越贵/.test(buys[0].title),
      buys[0] ? buys[0].title : '没找到');

    /* ⑤ 缺货 → PI 升 → 价升（供给无限的刹车就在这里） */
    D.prices[cid] = D.prices[cid] || {};
    D.prices[cid].iron = { v: 1.0, target: 1.0, trend: 0 };
    const pCheap = D.buyGold(cid, 'iron');
    D.prices[cid].iron = { v: 1.8, target: 1.8, trend: 1 };
    const pDear = D.buyGold(cid, 'iron');
    ok('G 缺货 PI 1.0 → 1.8：价 ' + pCheap + ' → ' + pDear + '（越缺越贵）',
      pCheap === Math.ceil(lot.gold * 1.0) && pDear === Math.ceil(lot.gold * 1.8) && pDear > pCheap,
      'PI 1.0 → ' + pCheap + ' 金 · PI 1.8 → ' + pDear + ' 金');
    D.prices[cid].iron = { v: 1.0, target: 1.0, trend: 0 };

    /* ⑥ 省库没钱 → 买货钮才灰（这才是唯一的闸） */
    D.setGold(pid, 0);
    panel = openMarket();
    const poor = panel ? panel.querySelector('button[data-buy="iron"]') : null;
    ok('G 省库 0 金：买货钮置灰（title 说省库金不足）',
      !!poor && poor.disabled === true && /省库金不足/.test(poor.title),
      poor ? 'disabled=' + poor.disabled + ' title=' + poor.title : '没找到');

    /* ⑦ 卖货方向不动：5 单位 → PI 金进省库（中央不参与） */
    D.setGold(pid, 0);
    bag.grain.stock = 100;
    const acc0 = D.sellAcc[pid] || 0;
    const gr0 = D.stockOf(pid, 'grain');
    const rs = D.sell(pid, 'grain', true);
    ok('G 卖货照旧：扣 5 粮、PI 金进省库（与买货方向互不影响）',
      !!rs && rs.ok === true && gr0 - D.stockOf(pid, 'grain') === A.MARKET.rate &&
      D.goldOf(pid) === Math.floor(acc0 + D.priceOf(cid, 'grain')) && (cen.gold || 0) === 0,
      '粮 ' + gr0 + '→' + D.stockOf(pid, 'grain') + ' · 省库金=' + D.goldOf(pid));

    /* ⑧ AI tryTrade：候选一从"中央价"换成"市场价"，与外国价比价照旧
     * 用计数桩替掉两个出口，只看它**挑了谁**（成交细节在 prices.js ④ 里验）。 */
    const me2 = w.countries.find(c => c.id !== cid && c.provinces && c.provinces.length >= 2 && !D.deadMap[c.id]);
    const foe = w.countries.find(c => c.id !== cid && c.id !== (me2 && me2.id) &&
      c.provinces && c.provinces.length >= 2 && me2 && !D.atWar(me2.id, c.id) && !D.deadMap[c.id]);
    if (me2 && foe) {
      D.relSet(me2.id, foe.id, 80);
      for (const id of me2.provinces) {
        A.resMarket[id] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
        if (A.resSim[id] && A.resSim[id].iron) A.resSim[id].iron.stock = 0;
        if (A.resSim[id] && A.resSim[id].gold) A.resSim[id].gold.stock = 300;
      }
      D.ensureCentral(me2.id).iron = 0;
      for (const id of foe.provinces) {
        if (A.resSim[id] && A.resSim[id].iron) A.resSim[id].iron.stock = 200;
      }
      /* 轮到"该看价"的回合。**不真走回合**（D.setTurn 直接改回合号）：
       * 走回合会跑一遍税/维护/物价，把 F 节留下的 IRONACC 零头冲掉，
       * 后面那条"旧档读入零头照攒"就验不成了。 */
      const every = A.AIWAR.trade.every.econ;
      D.setTurn(every * 10 - (me2.id % every));
      A.aiDebug.setPersona(me2.id, 'econ');

      let nW = 0, nF = 0;
      const origW = D.buyWorld, origF = D.aiBuy;
      D.buyWorld = function () { nW++; return { ok: true }; };
      D.aiBuy = function () { nF++; return { ok: true }; };

      /* 市场便宜（PI 0.6 → 5 金）、外国贵（PI 2.4 → 33 金）→ 买市场 */
      D.prices[me2.id] = D.prices[me2.id] || {};
      D.prices[me2.id].iron = { v: 0.6, target: 0.6, trend: 0 };
      D.prices[foe.id] = D.prices[foe.id] || {};
      D.prices[foe.id].iron = { v: 2.4, target: 2.4, trend: 0 };
      const a1 = A.aiDebug.trade(me2.id, 'econ');
      ok('G AI 比价：市场价 5 金 < 外国价 33 金 → 走世界市场（D.buyWorld）',
        a1 === 1 && nW === 1 && nF === 0, 'nW=' + nW + ' nF=' + nF + ' 市场价 ' +
        D.buyGold(me2.id, 'iron') + ' 外国价 ' + D.fBuyGold(foe.id, 'iron'));

      /* 反过来：市场贵（PI 2.4 → 18）、外国便宜（PI 0.6 → 9）→ 买外国 */
      for (const id of me2.provinces) {
        if (A.resSim[id] && A.resSim[id].iron) A.resSim[id].iron.stock = 0;
      }
      D.prices[me2.id].iron = { v: 2.4, target: 2.4, trend: 0 };
      D.prices[foe.id].iron = { v: 0.6, target: 0.6, trend: 0 };
      nW = 0; nF = 0;
      const a2 = A.aiDebug.trade(me2.id, 'econ');
      ok('G AI 比价：外国更便宜 → 走外国货源（D.aiBuy），市场只当兜底',
        a2 === 1 && nF === 1 && nW === 0, 'nW=' + nW + ' nF=' + nF + ' 市场价 ' +
        D.buyGold(me2.id, 'iron') + ' 外国价 ' + D.fBuyGold(foe.id, 'iron'));

      D.buyWorld = origW; D.aiBuy = origF;
    } else {
      ok('G AI 比价：找得到两个够大的国家', false, '没找到对照国');
    }
    return o;
  }));

  /* ---------------- 截图：市场 ? 面板（买货一排 + 世界市场提示） ---------------- */
  await sleep(250);
  await page.evaluate(() => {
    const D = window.AO.resDebug, T = window.__T;
    const w = D.world(), pid = T.m;
    const bag = window.AO.resSim[pid];
    if (bag.gold) bag.gold.stock = 60;
    D.showInfo(pid);
    const body = document.getElementById('infoBody');
    if (!body.classList.contains('tab-bld')) {
      document.querySelector('#infoTabs .itab[data-tab="bld"]').click();
    }
    const q = document.querySelector('#iSchoolList .rr[data-univ="market"] .qbtn');
    for (let i = 0; i < 2 && q; i++) {
      q.click();
      const pn = document.querySelector('#iSchoolList .qinfo.on');
      if (pn && /买货/.test(pn.textContent)) break;
    }
    const el = document.getElementById('infoBody');
    if (el) el.scrollTop = 260;
  });
  await sleep(400);
  const card3 = await page.evaluate(() => {
    const r = document.getElementById('info').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 940) };
  });
  await page.screenshot({ path: shot('lifeline-market-world.png'), clip: card3 });

  /* =============================================================
   * A（续）存档：WASH 进档、旧档读入不炸
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T;
    D.wash[T.g] = { n: 2, site: 1, halted: false, mAcc: { iron: 0, gold: 0 }, iAcc: 0.25, tAcc: 0 };
    /* 顺手放一座熔旧坊：下面要验"摘掉 WASH 不会连 SMELT 一起清掉"。
     * v18.1b 之后 AI 每回合都会改建，档里本来就有几条 —— 但这一条是我们自己放的，
     * 断言不依赖 AI 的运气。 */
    D.smelt[T.b] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, iAcc: 0 };
    window.__SMELT_N = Object.keys(A.resSmelt).length;
    D.save(true);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(A.SAVE_KEY)); } catch (e) { /* file:// 禁 ls */ }
    ok('A 存档里有 WASH 块', !!raw && !!raw.WASH, raw ? Object.keys(raw.WASH || {}).length + ' 条' : '无档');
    ok('A 淘金场状态进档（n / site / iAcc）',
      !!raw && raw.WASH[T.g] && raw.WASH[T.g].n === 2 && raw.WASH[T.g].site === 1 &&
      raw.WASH[T.g].iAcc === 0.25,
      raw && JSON.stringify(raw.WASH[T.g]));
    ok('A 没场没工地的省不进档（瘦身）',
      !!raw && !Object.keys(raw.WASH).some(k => !(raw.WASH[k].n > 0 || raw.WASH[k].site > 0)),
      raw && Object.keys(raw.WASH).length + ' 条');
    ok('A 存档版本号没升', !!raw && raw.v === A.SAVE_VER, raw && raw.v);
    /* 摘掉 WASH，模拟"这一块之前的老档"；顺手把一个铁袋写成**旧档的形态**
     * （gone: true, cool: 0）—— 读回来应该是"刚睡下"的休眠 48（v18 追加一补课）。 */
    if (raw) {
      const mp = T.b;
      const bag0 = (raw.SIM && raw.SIM[mp]) || ((raw.SIM = raw.SIM || {})[mp] = {});
      const ib = bag0.iron || {};
      bag0.iron = Object.assign({}, ib, {
        n: ib.n || 40, built: 2, tiers: { 1: 2, 2: 0 },
        stock: 0, left: 0, cool: 0, gone: true, pop: 0, eaten: 0,
        halted: false, mAcc: { iron: 0, gold: 0 }
      });
      window.__MIG = mp;
      delete raw.WASH;
      try { localStorage.setItem(A.SAVE_KEY, JSON.stringify(raw)); } catch (e) { /* 忽略 */ }
    }
    return o;
  }));

  await page.evaluate(() => { window.AO.resDebug.load(); });
  await sleep(3600);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    ok('A 老档（无 WASH）读得进', !!D.world(), '第 ' + D.turn() + ' 回合');
    ok('A 老档读进来是"还没改建过"（空表）', Object.keys(A.resWash).length === 0,
      Object.keys(A.resWash).length + ' 条');
    /* 旧断言"读回来 SMELT 也是空表"跟改（v18.1b）：AI 现在每回合都改建，
     * 档里必然有熔旧坊 —— 要验的是**摘掉 WASH 不会连 SMELT 一起清掉**，
     * 所以比"条数没少 + 我们放的那条还在"，而不是比"空"。 */
    ok('A 老档读进来 SMELT 还在（摘掉 WASH 不影响另一套镜像）',
      Object.keys(A.resSmelt).length === window.__SMELT_N && !!A.resSmelt[window.__T.b],
      Object.keys(A.resSmelt).length + ' 条 / 存档时 ' + window.__SMELT_N);

    /* F（v18 追加二）：常数从 200 万改成 10 万，但存档格式没动 ——
     * 铁税的零头应该原样读回来（0.75），旧档读入后结算也不能炸。 */
    const fpid = window.__Fpid;
    ok('F 旧档读入：IRONACC 零头照攒（0.75 原样回来）',
      A.resIronAcc[fpid] === 0.75, A.resIronAcc[fpid]);
    let alive = false;
    try {
      const pv = D.world().provinces[fpid - 1];
      A.resSettleTax(fpid, pv.owner, pv, null);
      alive = true;
    } catch (e) { alive = false; }
    ok('F 旧档读入不炸：铁税还能照常结算', alive, alive ? 'ok' : '结算抛错');

    /* 铁矿"旧档"迁移（v18 追加一补课）：档里写的是 gone 的铁袋，
     * 读回来必须变成"刚睡下"的休眠 48 —— 不炸、也不凭空白送 48 回合的储量。 */
    const mp = window.__MIG;
    const mig = A.resSim[mp] && A.resSim[mp].iron;
    ok('旧档迁移：gone 的铁袋 → 休眠 48（left 留 0，不回溯）',
      !!mig && mig.gone === false && mig.cool === 48 && mig.left === 0,
      mig ? 'cool=' + mig.cool + ' gone=' + mig.gone + ' left=' + mig.left : '没有这个铁袋');
    return o;
  }));

  /* =============================================================
   * H 改建快速通道（v18.1b）—— 改建不再挤建造独木桥
   *
   * 老路子：熔旧坊是 buildOrder 里的一项，改建要跟"每省一座市场 / 三座粮仓"
   * 这种无底清单抢同一个建造格（每回合 1 座），排到最后 = 永远排不上。
   * 新路子：aiConvert 独立结算、不占建造格，每国每回合至多 1 座（先铁后金）。
   *
   * 这一节放在最后：前面几节按"回合数"和 IRONACC 零头对过账，60 回合的挂机
   * 会把那些数冲掉，所以不能插在中间。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, AI = A.aiDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), T = window.__T;
    const c = w.countries.filter(x => x && x.id !== T.cid && x.provinces.length >= 4)[0];
    const cid = c.id;
    const cen = D.ensureCentral(cid);
    cen.gold = 3000; cen.timber = 3000; cen.iron = 3000; cen.grain = 3000;

    /* ① 三张表里已经没有 smelt（改建不走建造表了） */
    ok('H 三张建造表都不再有 smelt',
      ['econ', 'balanced', 'mil'].every(k => A.AIECON.buildOrder[k].indexOf('smelt') < 0),
      ['econ', 'balanced', 'mil'].map(k => k + ':' + A.AIECON.buildOrder[k].join(',')).join(' | '));

    /* ② 扫盲闸：学校还没铺够（省数/3）时，改建通道一律不动 ——
     *    改建不占建造格，花的却是同一个国库；不设这道闸就是"换个位置挤建造"。 */
    for (const id of c.provinces) { if (A.resSchool[id]) A.resSchool[id].n = 0; }
    const quota = Math.max(1, Math.floor(c.provinces.length / (A.AIECON.schoolQuotaDiv || 3)));
    ok('H 扫盲没完（学校 < 省数/' + (A.AIECON.schoolQuotaDiv || 3) + ' = ' + quota +
      ' 座）：改建通道不动',
      AI.convert(cid) === 0, 'convert=' + AI.convert(cid) + ' · 学校 0 座');

    /* ③ 铺够学校之后：同一回合 —— 建造格照常动 + 改建通道也动（互不挤） */
    for (const id of c.provinces) {
      if (!A.resSchool[id]) A.resSchool[id] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null };
      A.resSchool[id].n = 1;
    }
    const pid = c.provinces[0];
    const s = A.resSim[pid].iron;
    s.built = 1; s.tiers = { 1: 1, 2: 0 };
    s.left = 0; s.cool = 48; s.gone = false; s.halted = false;
    for (const id of c.provinces) delete A.resSmelt[id];     // 清场：别撞封顶

    const cnt = () => {
      let sm = 0, sch = 0, mkt = 0;
      for (const id of c.provinces) {
        if (A.resSmelt[id]) sm += A.resSmelt[id].n;
        if (A.resSchool[id]) sch += A.resSchool[id].n;
        if (A.resMarket[id]) mkt += A.resMarket[id].n;
      }
      return { sm, sch, mkt };
    };
    const before = cnt();
    const built = AI.build(cid, AI.personaOf(cid));
    const conv = AI.convert(cid);
    const st = A.resSmelt[pid];
    ok('H 同一回合：建造格真的动了（AI.build 开工）', built === true, 'build=' + built);
    ok('H 同一回合：改建通道也动了（AI.convert → 熔旧坊开工）',
      conv === 1 && !!st && st.site > 0,
      'convert=' + conv + ' site=' + (st ? st.site : '—'));

    /* ④ 硬指标：挂机 60 回合 —— 熔旧坊数 > 0、逐回合不降且确实在涨；
     *    学校 / 市场也照涨（建造格没被改建吃掉）。
     *    先把学校清零，让 AI 自己从 0 铺到配额，再开始改建 —— 这一段测的是
     *    "两条路同时走"，不是"我替它铺好"。
     *    每回合先停战：战时民用建造全停，不停战就测不出"建造格还在不在"。 */
    for (const id of c.provinces) { if (A.resSchool[id]) A.resSchool[id].n = 0; }
    for (const id of c.provinces) delete A.resSmelt[id];
    const t0 = cnt();
    const series = [];
    let grew = 0, last = 0;
    for (let i = 0; i < 60; i++) {
      AI.warsOf(cid).forEach(foe => { if (D.atWar(cid, foe)) D.makePeace(cid, foe); });
      D.settleTurn();
      if (D.evtPending()) D.evtPick(0);
      const cur = cnt().sm;
      series.push(cur);
      if (cur > last) grew++;
      last = cur;
    }
    const after = cnt();
    const mono = series.every((v, i) => i === 0 || v >= series[i - 1]);
    ok('H 60 回合：熔旧坊数 > 0', after.sm > 0, '熔旧坊 ' + t0.sm + ' → ' + after.sm + ' 座');
    ok('H 60 回合：只增不减，且真的涨过', mono && grew >= 1,
      '序列 ' + series[0] + ' → ' + series[series.length - 1] + '（涨了 ' + grew + ' 次）');
    ok('H 60 回合：建造格没被改建吃掉（学校 / 市场照涨）',
      (after.sch + after.mkt) > (t0.sch + t0.mkt),
      '学校 ' + t0.sch + '→' + after.sch + ' · 市场 ' + t0.mkt + '→' + after.mkt);
    return o;
  }));

  /* =============================================================
   * I AI 存钱本能（v18.3）—— 有钱就花的国家，中央永远见底
   *
   * 两道：goldReserve 5 → 15（建完还得剩一轮维护费）、buildGate 10（中央金 < 10
   * 时整条建造都不试）。要验的是"挡住但不永久停"：9 金一动不动、给到 200 又能盖。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, AI = A.aiDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    const c = w.countries.filter(x => x && !D.deadMap[x.id] && x.provinces.length >= 3)[0];
    if (!c) { ok('I 找得到一个够大的国', false, '没有'); return o; }

    ok('I 常数在定义区（goldReserve 15 / buildGate 10）',
      A.AIECON.goldReserve === 15 && A.AIECON.buildGate === 10,
      'goldReserve=' + A.AIECON.goldReserve + ' buildGate=' + A.AIECON.buildGate);

    /* 停战 + 给足料：战时民用建造全停，不停战测的是战争白名单，不是这道闸 */
    AI.warsOf(c.id).forEach(foe => { if (D.atWar(c.id, foe)) D.makePeace(c.id, foe); });
    const cen = D.ensureCentral(c.id);
    cen.timber = 3000; cen.grain = 3000; cen.iron = 3000;
    /* 清掉现成的学校 / 熔旧坊：让建造表第一项一定可盖，否则
     * "200 金也盖不出来"会被误判成"闸没松开" */
    for (const id of c.provinces) {
      if (A.resSchool[id]) A.resSchool[id].n = 0;
      delete A.resSmelt[id];
    }

    /* ① 中央 9 金（< buildGate）：整条建造不动，一分钱都不花 */
    cen.gold = 9;
    const r1 = AI.build(c.id, AI.personaOf(c.id));
    ok('I 中央 9 金（< 10）：本回合建造整条跳过', r1 === false && cen.gold === 9,
      'build=' + r1 + ' 中央金=' + cen.gold);

    /* ② 给到 200 金：闸松开，照常开工（不是永久停摆） */
    cen.gold = 200;
    const r2 = AI.build(c.id, AI.personaOf(c.id));
    ok('I 中央 200 金：闸松开，照常开工', r2 === true, 'build=' + r2);
    return o;
  }));

  /* =============================================================
   * J 省库买铁付维护（v18.4）—— 让上解搬回的金第一次能变成铁
   *
   * 停产省的瓶颈是铁（见 DESIGN-LIFELINE §十四）：金搬得再多也换不来铁。
   * 这条规则把世界市场那条口子接到**维护**上：铁见底、省库还有金 →
   * 自己去买一手（5 铁），金沉没。三道闸在 GOV.selfBuy 里。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world(), G = A.GOV;
    const cid = T.cid, cen = D.ensureCentral(cid);
    const pid = T.provs.find(id => A.resSim[id] && A.resSim[id].iron);
    const pid2 = T.provs.find(id => id !== pid && A.resSim[id] && A.resSim[id].iron);
    const lot = G.buyLot();

    ok('J 规则在 GOV 定义区（at 2 / keepGold 6 / 每国每回合 1 手）',
      !!G.selfBuy && G.selfBuy.at === 2 && G.selfBuy.keepGold === 6 &&
      G.selfBuy.lotsPerTurn === 1, JSON.stringify(G.selfBuy));

    /* 配额绑在 turnNo 上：拨一个"干净"的回合号，免得被前面几节用掉 */
    const freshTurn = () => D.setTurn(D.turn() + 1);
    const setIron = (id, v) => { A.resSim[id].iron.stock = v; };
    /* 前几条只验"省库自己出钱"那一段：临时关掉中央拨款那一段，
     * 否则拨款里剩的钱会把"金不够就不买"这条断言搅掉（拨款额度是全局状态）。 */
    const poolOff = () => { G.selfBuy.usePool = false; };
    const poolOn = () => { G.selfBuy.usePool = true; };
    poolOff();

    /* ① 铁还够（= at）→ 不囤铁 */
    freshTurn();
    setIron(pid, G.selfBuy.at);
    D.setGold(pid, 100);
    const g0 = D.goldOf(pid);
    ok('J 铁 = at(2)：不买（这是续命，不是囤铁）',
      D.selfBuyIron(pid, cid, D.flow[pid], 3) === 0 && D.goldOf(pid) === g0,
      '省库金 ' + g0 + ' → ' + D.goldOf(pid) + '，铁 ' + A.resSim[pid].iron.stock);

    /* ② 铁见底 + 金够 → 按缺口买 3 单位：金出省库、铁进省库、中央一分不动 */
    freshTurn();
    setIron(pid, 0);
    D.setGold(pid, 100);
    cen.gold = 0;
    const up = D.selfBuyUnit(cid);
    const F = D.flow[pid];
    const b0 = { iron: D.stockOf(pid, 'iron'), n: A.resSelfBuyStat().n };
    const paid = D.selfBuyIron(pid, cid, F, 3);
    ok('J 铁 0 + 金 100 → 买 3 单位（单价 ' + up + ' 金，共 ' + up * 3 + ' 金）',
      paid === up * 3 && D.stockOf(pid, 'iron') === b0.iron + 3 &&
      D.goldOf(pid) === 100 - up * 3,
      '付费 ' + paid + ' · 铁 ' + b0.iron + ' → ' + D.stockOf(pid, 'iron') +
      ' · 金 ' + D.goldOf(pid));
    ok('J 金沉没：中央不涨（货来自世界市场，不是国库）',
      (cen.gold || 0) === 0, '中央金=' + cen.gold);
    ok('J 流水两格：d.buyIron（金）/ d.buyIronN（铁）',
      !!F && F.d.buyIron === paid && F.d.buyIronN === 3,
      F ? 'd.buyIron=' + F.d.buyIron + ' d.buyIronN=' + F.d.buyIronN : '没流水');

    /* ③ 配额：每国每回合至多 1 手 = lot.n 单位。买满之后再多也不卖 */
    freshTurn();
    setIron(pid, 0); setIron(pid2, 0);
    D.setGold(pid, 300); D.setGold(pid2, 300);
    const q1 = D.selfBuyIron(pid, cid, D.flow[pid], lot.n);
    const q2 = D.selfBuyIron(pid2, cid, D.flow[pid2], lot.n);
    ok('J 每国每回合至多 ' + lot.n + ' 单位（一手）—— 第一笔成、第二笔不动',
      q1 === up * lot.n && q2 === 0 && D.stockOf(pid2, 'iron') === 0,
      '两笔 ' + q1 + ' / ' + q2 + '，第二省铁=' + D.stockOf(pid2, 'iron'));
    freshTurn();
    setIron(pid2, 0);
    const q3 = D.selfBuyIron(pid2, cid, D.flow[pid2], 2);
    ok('J 换一回合：配额恢复，第二省也买得到', q3 === up * 2 && D.stockOf(pid2, 'iron') === 2,
      '付费 ' + q3 + '，铁=' + D.stockOf(pid2, 'iron'));

    /* ④ 金不够：只买得起几单位就买几单位（不赊账、也不把开工钱花光） */
    freshTurn();
    setIron(pid, 0);
    D.setGold(pid, up * 2 + G.selfBuy.keepGold - 1);
    const gPoor = D.goldOf(pid);
    const p4 = D.selfBuyIron(pid, cid, D.flow[pid], 3);
    ok('J 金只够 1 单位的余量 → 少买（不赊账、留住开工钱）',
      p4 === up && D.stockOf(pid, 'iron') === 1 && D.goldOf(pid) === gPoor - up,
      '省库金 ' + gPoor + ' → ' + D.goldOf(pid) + '（单价 ' + up + ' + 留 ' +
      G.selfBuy.keepGold + '），铁=' + D.stockOf(pid, 'iron'));

    /* ⑤ 被封锁的省买不了货（和 buyWorld 同一条闸） */
    freshTurn();
    setIron(pid, 0);
    D.setGold(pid, 200);
    A.resWar.blockade[pid] = cid;
    const p5 = D.selfBuyIron(pid, cid, D.flow[pid], 2);
    delete A.resWar.blockade[pid];
    ok('J 封锁省：买不了（和玩家点「买货」同一条闸）', p5 === 0 && D.stockOf(pid, 'iron') === 0,
      '付费 ' + p5);

    /* ⑥ 省库一分钱没有时，中央拨款垫付（两段付款的第二段）——
     *    这才是"穷省也能续命"的那一半：停产省里九成省库金不足 5。 */
    poolOn();
    freshTurn();
    setIron(pid, 0);
    D.setGold(pid, 0);
    cen.gold = 60;
    A.rep.turnStart(cid);                       // 批这一回合的拨款（按上回合实付估）
    const pool0 = A.rep.reserve(), cen0 = cen.gold;
    const F7 = D.flow[pid];
    const p7 = D.selfBuyIron(pid, cid, F7, 3);
    ok('J 省库 0 金 + 中央有金 → 拨款垫付买铁（省库不动、中央出钱）',
      p7 > 0 && D.goldOf(pid) === 0 && (cen.gold || 0) < cen0 &&
      !!F7 && F7.d.buyIronC === p7,
      '付费 ' + p7 + ' · 中央金 ' + cen0 + ' → ' + cen.gold + ' · 拨款 ' + pool0 +
      ' → ' + A.rep.reserve());
    poolOff();

    /* ⑦ 上解把金搬走之后，省里仍然付得起"续命钱"——
     *    把两条规则放在一起跑一遍：省库 60 金 → 上解 → 剩下的钱够不够买铁。 */
    freshTurn();
    setIron(pid, 0);
    D.setGold(pid, 60);
    D.remitAcc[pid] = 0;
    cen.gold = 0;
    D.settleRemit(pid, cid);
    const afterRemit = D.goldOf(pid);
    const p6 = D.selfBuyIron(pid, cid, D.flow[pid], 2);
    ok('J 上解与买铁同场：60 金 → 上解后还剩 ' + afterRemit + '，仍买得起铁',
      afterRemit >= up * 2 + G.selfBuy.keepGold && p6 === up * 2,
      '上解后省库 ' + afterRemit + ' · 付 ' + p6 + ' · 铁 ' + D.stockOf(pid, 'iron'));
    return o;
  }));

  /* =============================================================
   * K 养得起几座就养几座（v18.5）—— 欠费停产是"整类一起停"，
   * 而省库里的钱往往够养活其中几座
   *
   * 实测口径：4 座农场 ×（0.2 铁 + 0.2 金）/座 → 省库 0.4 铁只养得起 2 座。
   * 这一节直接调 D.trimKeep（结算里就在维护之前调它，位置见 11-ui 的 ①-0）。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), rep = A.rep;
    const player = A.resPlayer();
    const c = w.countries.filter(x => x && x.id !== player && !D.deadMap[x.id] &&
      x.provinces && x.provinces.length >= 2)[0];
    if (!c) { ok('K 找得到一个 AI 国', false, '没有'); return o; }
    const cid = c.id;
    const pk = c.provinces.find(id => A.resSim[id] && A.resSim[id].iron);
    const bag = A.resSim[pk];

    /* 清场：这一省只留 4 座农场（别的类清空，免得抢同一笔预算） */
    for (const k in bag) if (bag[k] && bag[k].built !== undefined) bag[k].built = 0;
    for (const k2 in A.resSim[pk]) {
      const s = A.resSim[pk][k2];
      if (s && s.tiers) s.tiers = { 1: 0, 2: 0 };
    }
    const UN = { school: A.resSchool, market: A.resMarket, builder: A.resBuilder,
      granary: A.resGranary, university: A.resUniversity, barracks: A.resBarracks,
      armory: A.resArmory, stable: A.resStable, shipyard: A.resShipyard,
      factory: A.resFactory };
    for (const k3 in UN) if (UN[k3]) delete UN[k3][pk];
    bag.grain.built = 4; bag.grain.tiers = { 1: 4, 2: 0 };
    bag.grain.mAcc = { iron: 0, gold: 0 };
    rep.setKeep(pk, 'grain', null);
    delete D.autoKeep[pk];
    bag.gold.stock = 100;                    // 金管够，只看铁

    /* ① 0 铁：一座都养不起 → 保留 0 座（主动停，不是欠费停） */
    bag.iron.stock = 0;
    D.trimKeep(pk, cid);
    ok('K 省库 0 铁 → 4 座农场全停（保留 0 座，不是欠费停产）',
      rep.keep(pk, 'grain') === 0,
      'keep=' + rep.keep(pk, 'grain'));

    /* ② 0.4 铁：刚好养 2 座（0.2 铁/座） */
    bag.iron.stock = 0.4;
    D.trimKeep(pk, cid);
    ok('K 省库 0.4 铁 → 只养 2 座（每座 0.2 铁）',
      rep.keep(pk, 'grain') === 2, 'keep=' + rep.keep(pk, 'grain'));

    /* ③ 欠账跟着座数一起砍：4 座欠 2 铁，只养 2 座 → 欠 1 铁 */
    bag.iron.stock = 0.4;
    bag.grain.mAcc = { iron: 2, gold: 0 };
    rep.setKeep(pk, 'grain', null);
    delete D.autoKeep[pk];
    D.trimKeep(pk, cid);
    ok('K 停掉的那两座，旧账一起砍掉（2 铁 → 1 铁）',
      rep.keep(pk, 'grain') === 2 && Math.abs(bag.grain.mAcc.iron - 1) < 1e-9,
      'keep=' + rep.keep(pk, 'grain') + ' acc=' + bag.grain.mAcc.iron);

    /* ④ 铁回来了：自动放回"全开"（不用人工复位） */
    bag.iron.stock = 5;
    bag.grain.mAcc = { iron: 0, gold: 0 };
    D.trimKeep(pk, cid);
    ok('K 铁回来（5）→ 自动放回全开（keep = null）',
      rep.keep(pk, 'grain') === null && D.autoKeep[pk] === undefined,
      'keep=' + rep.keep(pk, 'grain'));

    /* ⑤ 别人设过的座数不许改（战时换挡 / 玩家手调都走这条） */
    bag.iron.stock = 0;
    rep.setKeep(pk, 'grain', 1);
    D.trimKeep(pk, cid);
    ok('K 已经有人设过保留座数（战时换挡 / 手调）→ 不覆盖',
      rep.keep(pk, 'grain') === 1, 'keep=' + rep.keep(pk, 'grain'));

    /* ⑥ 玩家国不碰：同样的局面，玩家那一省保持"全开"由玩家自己决定 */
    const pp = player ? (w.countries[player - 1] || {}).provinces : null;
    if (pp && pp.length) {
      const pv = pp.find(id => A.resSim[id] && A.resSim[id].iron);
      if (pv) {
        const b2 = A.resSim[pv];
        for (const k4 in b2) if (b2[k4] && b2[k4].built !== undefined) b2[k4].built = 0;
        b2.grain.built = 2; b2.grain.tiers = { 1: 2, 2: 0 };
        b2.iron.stock = 0;
        rep.setKeep(pv, 'grain', null);
        const n0 = D.trimStat.n;
        D.trimKeep(pv, player);
        ok('K 玩家国不动（玩家自己调「维修」面板，自动改是越权）',
          rep.keep(pv, 'grain') === null && D.trimStat.n === n0,
          'keep=' + rep.keep(pv, 'grain') + ' 统计没动=' + (D.trimStat.n === n0));
      }
    }
    return o;
  }));

  /* =============================================================
   * L 开辟新资源（v18.6）—— 图上没人开的矿，AI 会不会去开
   *
   * 以前只有两条路会新建资源建筑：缺铁缺金（tryMineOpen）、人挤（tryExpand）。
   * 盐场 / 伐木场 / 牧场**永远不会被新建**。这一节验新加的 tryOpen，
   * 以及它和 v18.5「养不起就少养几座」的一进一出。
   * ============================================================= */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, AI = A.aiDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), player = A.resPlayer();
    const c = w.countries.filter(x => x && x.id !== player && !D.deadMap[x.id] &&
      x.provinces.length >= 2)[0];
    if (!c) { ok('L 找得到一个 AI 国', false, '没有'); return o; }
    const cid = c.id, cen = D.ensureCentral(cid);
    const keys = ['grain', 'fish', 'salt', 'timber', 'horse', 'iron', 'gold'];
    const pk = c.provinces[0];

    /* 清场：全国所有矿脉储量归零、建筑清零 —— 只留 pk 的一块盐矿 60 */
    for (const id of c.provinces) {
      for (const k of keys) {
        const s = A.resSim[id] && A.resSim[id][k];
        if (!s) continue;
        s.built = 0; s.site = 0; s.tiers = { 1: 0, 2: 0 };
        s.left = 0; s.gone = false; s.cool = 0; s.halted = false;
        s.mAcc = { iron: 0, gold: 0 };
      }
      if (A.rep && A.rep.setKeep) for (const k of keys) A.rep.setKeep(id, k, null);
    }
    A.resSim[pk].salt.left = 60;
    cen.gold = 300; cen.timber = 300; cen.grain = 300; cen.iron = 300;
    /* 先把学校铺到配额（省数/3，这里至少 1 座）—— v18.6 的闸：先扫盲再开矿 */
    if (!A.resSchool[pk]) A.resSchool[pk] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const SCAP = Math.max(1, Math.ceil(c.provinces.length / (A.AIECON.schoolQuotaDiv || 3)));
    A.resSchool[pk].n = SCAP; A.resSchool[pk].site = 0; A.resSchool[pk].halted = false;

    ok('L 规则在定义区（openResource：on / minLeft 25）',
      !!A.AIECON.openResource && A.AIECON.openResource.on === true &&
      A.AIECON.openResource.minLeft === 25, JSON.stringify(A.AIECON.openResource));

    /* ① 有富矿 + 有钱 → 开一座（这就是"未开发资源"那条缺口） */
    const r1 = AI.open(cid);
    const st1 = A.resSim[pk].salt;
    ok('L 一块 left=60 的空盐矿 → AI 去开了（盐场原来永远没人建）',
      r1 === true && st1.site > 0, 'ret=' + r1 + ' site=' + st1.site + ' built=' + st1.built);

    /* ② 这一类的座还有停着的 → 先养活现有的，不扩产（和 trimKeep 一进一出） */
    const p2 = c.provinces[1] || pk;
    A.resSim[p2].salt.built = 1;
    A.resSim[p2].salt.tiers = { 1: 1, 2: 0 };
    A.resSim[p2].salt.halted = true;
    A.resSim[pk].salt.site = 0;                 // 上一座撤掉，重新来
    const r2 = AI.open(cid);
    ok('L 本国盐场还有停着的座 → 不扩产（先养活旧的）',
      r2 === false && A.resSim[pk].salt.site === 0, 'ret=' + r2);

    /* ③ 那座复工了（不再停）→ 又能开 */
    A.resSim[p2].salt.halted = false;
    const r3 = AI.open(cid);
    ok('L 旧的复工之后 → 继续开新矿', r3 === true && A.resSim[pk].salt.site > 0,
      'ret=' + r3 + ' site=' + A.resSim[pk].salt.site);

    /* ④ 被围 / 占领的省不开 */
    A.resSim[pk].salt.site = 0;
    A.resWar.occupy[pk] = cid;
    const r4 = AI.open(cid);
    delete A.resWar.occupy[pk];
    ok('L 被占领的省：不在那儿开矿', r4 === false, 'ret=' + r4);

    /* ⑤ 穷国不开：中央金不够成本 + goldReserve */
    cen.gold = 0;
    const r5 = AI.open(cid);
    ok('L 中央金 0：不为了开矿把国库抽干', r5 === false, 'ret=' + r5);
    cen.gold = 300;

    /* ⑥ 先扫盲再开矿：学校配额没铺够，建造格留给学校 */
    A.resSim[pk].salt.site = 0;
    A.resSchool[pk].n = 0;
    const r6 = AI.open(cid);
    A.resSchool[pk].n = SCAP;
    ok('L 学校配额没铺够 → 先盖学校，不开矿', r6 === false, 'ret=' + r6);
    return o;
  }));

  /* ---------------- 汇总 ---------------- */
  for (const c of out) {
    console.log((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + '  —  ' + c.detail);
  }
  const pass = out.every(c => c.ok) && !errors.length;
  if (errors.length) console.log('\n运行时错误：\n' + errors.join('\n'));
  console.log('\n总体:', pass ? '全部通过' : '存在失败项');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
