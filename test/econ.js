/* =============================================================
 * test/econ.js —— 经济沙盒六件套的验收（对着任务书的验收清单逐条过）
 *
 *   1) 省卡收支小结 = 实际结算（库存变化逐项对账）；国库总览 = 中央实际变化
 *   2) 市场：建好后 ? 面板能卖资源换金；库存不足置灰；停产只停"卖"
 *   3) 建造坊：有它的省工地行尾有 ＋（扣金、倒计时 −1、砍到 0 立即完工）；
 *      没有它的省没有这个钮；研究冲刺从中央扣费
 *   4) 全局科技四条各有效；队列：入队不扣费、队头开研才扣、扣不起停摆
 *   4b) 铁矿「深层休眠」（v18 追加一补课）：采空 → 面板写「休眠 48」→ 倒数到点
 *      回满复产；金矿仍永久枯竭（cool 0）——**旧断言"铁矿采空即永久枯竭"已作废**，
 *      改由这一节验"休眠回满"。
 *   5) 存档 → 刷新 → 读档：同世界、同库存、同回合；不点读档刷新 = 纯工坊
 *   7) 六张新图标存在且能显示（市场/建造坊行、四条全局科技节点）
 *
 * 用法：node test/econ.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const URL = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');

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

  const checks = [];
  const ck = (name, ok, note) => {
    checks.push([name, !!ok, note || '']);
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + (note || ''));
  };
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  /* 省卡的「建筑」栏在页签没展开时是 display:none，page.click 点不到 ——
   * 一律走 DOM click（和用户点一下等价，事件照常冒泡）。 */
  const clickSel = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('找不到元素：' + s);
    el.click();
  }, sel);

  await page.goto(URL, { waitUntil: 'load' });
  await sleep(2600);
  /* v18.11：工坊模式不再自动冻结 AI —— 这个文件是"摆一个局面再对账"，
   * AI 在同一回合花钱盖房，账本立刻对不上。显式关掉（只关 AI，不动别的）。 */
  await page.evaluate(() => { window.AO.aiDebug.aiOff(true); });

  /* ---------- 选一个普通省（非首都、主资源最富），打开省卡 ---------- */
  const P = await ev(() => {
    const w = window.__world, R = window.__renderer;
    const caps = {}; w.countries.forEach(c => { if (c.capital) caps[c.capital] = 1; });
    let q = null;
    for (const p of w.provinces) {
      if (!p || caps[p.id] || !p.resources) continue;
      if (!q || p.resources[0].n > q.resources[0].n) q = p;
    }
    R.cam.x = q.centroid[0]; R.cam.y = q.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(q.id); R.draw();
    return { id: q.id, name: q.name, owner: q.owner };
  });
  await sleep(200);

  /* ---------- 1) 收支对账：库存变化 === Σ(gain − loss) ---------- */
  const snap = () => ev((id) => {
    const b = window.AO.resSim[id], out = {};
    for (const k in b) out[k] = b[k].stock;
    return out;
  }, P.id);
  const cenSnap = () => ev((o) => Object.assign({}, window.AO.resCentral[o]), P.owner);

  const before = await snap();
  const cenBefore = await cenSnap();
  await page.click('#nextTurn');
  await sleep(160);
  const after = await snap();
  const cenAfter = await cenSnap();
  const flow = await ev((id) => {
    const F = window.AO.resFlow[id];
    return { gain: Object.assign({}, F.gain), loss: Object.assign({}, F.loss),
             eat: Object.assign({}, F.d.eat), tax: Object.assign({}, F.d.tax),
             maint: Object.assign({}, F.d.maint) };
  }, P.id);
  const flowC = await ev((o) => {
    const F = window.AO.resFlowC[o] || { gain: {}, loss: {} };
    return { gain: Object.assign({}, F.gain), loss: Object.assign({}, F.loss) };
  }, P.owner);

  let worstKey = '', worst = 0, totalGain = 0, totalLoss = 0;
  for (const k in before) {
    const d = (after[k] || 0) - (before[k] || 0);
    const g = flow.gain[k] || 0, l = flow.loss[k] || 0;
    totalGain += g; totalLoss += l;
    if (Math.abs(d - (g - l)) > Math.abs(worst)) { worst = d - (g - l); worstKey = k; }
  }
  ck('收支小结逐项对上库存变化（Δ库存 = 产出 − 支出）',
    Math.abs(worst) < 1e-9,
    '最大偏差 ' + worst + (worstKey ? '（' + worstKey + '）' : '') +
    '；本回合 +' + totalGain + ' / −' + totalLoss);

  /* 明细三项都在（居民吃 / 抽税 / 维护至少各有一条，或者本省这回合没这几项） */
  const detailSum = (o) => Object.keys(o).reduce((a, k) => a + o[k], 0);
  ck('支出可拆成「居民吃 + 抽税 + 维护」三项',
    Math.abs(detailSum(flow.eat) + detailSum(flow.tax) + detailSum(flow.maint) - totalLoss) < 1e-9,
    '吃 ' + detailSum(flow.eat) + ' · 税 ' + detailSum(flow.tax) + ' · 维护 ' + detailSum(flow.maint) +
    ' = 支出 ' + totalLoss);

  /* 省卡上那一行真的显示了这些数 */
  const shown = await ev((id) => {
    const el = document.getElementById('iFlow');
    return { text: (el.querySelector('.fv') || {}).textContent || '', title: el.title };
  }, P.id);
  const expectTxt = await ev((id) => window.AO.resFlowText(window.AO.resFlow[id]), P.id);
  ck('省卡「信息」栏底部有收支小结，内容 = 流水',
    shown.text === expectTxt && shown.text.length > 0,
    '显示「' + shown.text + '」');
  ck('收支小结的 title 写明居民吃 / 抽税 / 维护',
    /居民吃掉|抽税|维护|产出/.test(shown.title), shown.title.split('\n').slice(1, 4).join(' / '));

  /* 国库总览 = 中央实际变化 */
  await ev((o) => { const R = window.__renderer; R.selectCountry(o); }, P.owner);
  await sleep(200);
  const treas = await ev(() => {
    const box = document.getElementById('cTreasury');
    const rows = [...box.querySelectorAll('.trrow')].map(r => ({
      nm: r.querySelector('.nm').textContent,
      stock: r.querySelector('b').textContent,
      net: r.querySelector('em').textContent
    }));
    return { on: !!box, rows, head: box.querySelector('.trhead') ? box.querySelector('.trhead').textContent : '' };
  });
  ck('国家卡「科技」上方有国库总览（七种资源 + 科研点）',
    treas.on && treas.rows.length === 8 && /库存/.test(treas.head),
    treas.rows.map(r => r.nm + ' ' + r.stock + '/' + r.net).join('  '));

  let cenOk = true, cenNote = [];
  for (const k in cenBefore) {
    const d = (cenAfter[k] || 0) - (cenBefore[k] || 0);
    const g = flowC.gain[k] || 0, l = flowC.loss[k] || 0;
    if (Math.abs(d - (g - l)) > 1e-9) { cenOk = false; cenNote.push(k + ':' + d + '≠' + (g - l)); }
  }
  ck('国库总览对得上中央实际变化（Δ中央 = 税入 − 垫付）', cenOk,
    cenOk ? '全部对上（本回合中央 +' + Object.keys(flowC.gain).filter(k => k !== 'pts')
      .reduce((a, k) => a + flowC.gain[k], 0) + ' / −' +
      Object.keys(flowC.loss).filter(k => k !== 'pts').reduce((a, k) => a + flowC.loss[k], 0) + '）'
      : cenNote.join(' '));

  /* ---------- 2) 市场 ---------- */
  const give = (id, n) => ev((a) => {
    const b = window.AO.resSim[a.id];
    for (const k in b) b[k].stock += a.n;
  }, { id, n });
  await give(P.id, 60);
  await ev((id) => { window.__renderer.select(id); }, P.id);
  await sleep(120);

  const uniRow = (kind) => `#iSchoolList .rr[data-univ="${kind}"]`;
  const rowInfo = (kind) => ev((sel) => {
    const r = document.querySelector(sel);
    if (!r) return null;
    return {
      nm: r.querySelector('.nm').textContent,
      qty: r.querySelector('.qty').textContent,
      site: r.querySelector('.site') ? r.querySelector('.site').textContent : '',
      spurt: !!r.querySelector('.spurt'),
      img: r.querySelector('img') ? r.querySelector('img').getAttribute('src') : ''
    };
  }, uniRow(kind));

  const m0 = await rowInfo('market');
  const b0 = await rowInfo('builder');
  const s0 = await rowInfo('school');
  ck('通用栏三行（学校 / 市场 / 建造坊），市场与建造坊用新图标',
    !!s0 && !!m0 && !!b0 && m0.nm === '市场' && b0.nm === '建造坊' &&
    /item-market-bld\.png$/.test(m0.img) && /item-builder-bld\.png$/.test(b0.img),
    [s0 && s0.nm, m0 && m0.nm, b0 && b0.nm].join(' / ') + '　图标 ' + (m0 && m0.img) + ' · ' + (b0 && b0.img));

  await clickSel(uniRow('market') + ' .add');
  await sleep(120);
  const mSite = await rowInfo('market');
  ck('市场开工（不立刻 ×N）', mSite.qty === '×0' && /建\d/.test(mSite.site), mSite.qty + ' ' + mSite.site);

  await page.click('#nextTurn'); await sleep(120);
  await page.click('#nextTurn'); await sleep(160);
  const mDone = await rowInfo('market');
  ck('市场工期到了才完工', mDone.qty === '×1', mDone.qty);

  /* 打开市场 ? 面板：七种资源各一行卖货钮 + 七行买货钮（两个格子） */
  await clickSel(uniRow('market') + ' .qbtn');
  await sleep(160);
  const sellUi = await ev(() => {
    const panel = document.querySelector('#iSchoolList .qinfo.on');
    /* v14：卖货格 = 纯 .sellbox（buy / fbuy / exp 都是别节），所以三个 :not 都要排除；
     * v18/B2 又加了兑换格（.xchg：付出/换回/这一手），照样排除 —— 卖货行还是七行 */
    const rows = [...panel.querySelectorAll('.sellbox:not(.buy):not(.fbuy):not(.exp):not(.xchg) .srow')];
    const buys = [...panel.querySelectorAll('.sellbox.buy:not(.fbuy) .srow')];
    return {
      n: rows.length,
      labels: rows.map(r => r.querySelector('span').textContent),
      btns: rows.map(r => ({ t: r.querySelector('button').textContent, dis: r.querySelector('button').disabled })),
      bn: buys.length,
      bbtns: buys.map(r => ({ t: r.querySelector('button').textContent, dis: r.querySelector('button').disabled }))
    };
  });
  /* v14：价格不再固定 —— 按钮上的数必须等于**物价板上的数**（同一个 sellGold/buyGold）。
   * 这一条就是任务书验收 ②「卖/买/外国买三处价格与价格板一致」的手算对表版。 */
  const priceChk = await ev((pid) => {
    const D = window.AO.resDebug, prov = D.world().provinces[pid - 1], cid = prov.owner;
    const box = document.querySelector('#iSchoolList .qinfo.on');
    const rows = [...box.querySelectorAll('.sellbox:not(.buy):not(.fbuy):not(.exp):not(.xchg) .srow')];
    const buys = [...box.querySelectorAll('.sellbox.buy:not(.fbuy) .srow')];
    const board = [...box.querySelectorAll('.pbrow')].map(r => ({
      k: r.querySelector('.nm').textContent,
      v: r.querySelector('b').textContent
    }));
    return {
      sellOk: rows.every(r => {
        const b = r.querySelector('button');
        return b.textContent.indexOf('+' + D.priceNum(D.sellGold(cid, b.getAttribute('data-sell')))) >= 0;
      }),
      buyOk: buys.every(r => {
        const b = r.querySelector('button');
        return b.textContent.indexOf('← ' + D.buyGold(cid, b.getAttribute('data-buy')) + ' 金') >= 0;
      }),
      sellSample: rows[0] ? rows[0].querySelector('button').textContent.trim() : '',
      buySample: buys[0] ? buys[0].querySelector('button').textContent.trim() : '',
      boardN: board.length,
      boardSample: board[0] ? board[0].k + ' ' + board[0].v : ''
    };
  }, P.id);
  ck('市场 ? 面板：七种资源各一行卖货（价 = 本国物价指数）',
    sellUi.n === 7 && priceChk.sellOk,
    sellUi.n + ' 行 · ' + priceChk.sellSample + ' · ' + sellUi.labels.join('/'));
  ck('市场 ? 面板：七种资源各一行买货（价 = 基准 × 本国物价）',
    sellUi.bn === 7 && priceChk.buyOk,
    sellUi.bn + ' 行 · ' + priceChk.buySample);
  ck('市场 ? 面板：顶部价格板七行（现价 + 趋势 + 库存/需求）',
    priceChk.boardN === 7, priceChk.boardN + ' 行 · ' + priceChk.boardSample);

  const goldBefore = await ev((id) => window.AO.resSim[id].gold.stock, P.id);
  const timBefore = await ev((id) => window.AO.resSim[id].timber.stock, P.id);
  /* v14：卖价 = 本国物价指数（可能 1.3 / 0.7），所以这里验的是
   * **"落袋 + 零头 = 物价"** —— 那正是"小数攒整不吞钱"那句话。
   * 顺手记下卖前卖后的 PI：卖货本身不改价（价只在回合结算时动）。 */
  const sellPre = await ev((pid) => {
    const D = window.AO.resDebug, prov = D.world().provinces[pid - 1];
    return { pi: D.priceOf(prov.owner, 'timber'), acc: D.sellAcc[pid] || 0 };
  }, P.id);
  await ev(() => document.querySelector('#iSchoolList .qinfo.on button[data-sell="timber"]').click());
  await sleep(200);
  const goldAfter = await ev((id) => window.AO.resSim[id].gold.stock, P.id);
  const timAfter = await ev((id) => window.AO.resSim[id].timber.stock, P.id);
  const sellPost = await ev((pid) => (window.AO.resDebug.sellAcc[pid] || 0), P.id);
  const gotGold = goldAfter - goldBefore;
  ck('卖 5 木材 = 本国木价（落袋 + 零头，一分不吞）',
    Math.abs((gotGold + sellPost - sellPre.acc) - sellPre.pi) < 1e-9 && timAfter === timBefore - 5,
    '木材 ' + timBefore + '→' + timAfter + '，金 ' + goldBefore + '→' + goldAfter +
    '（落袋 ' + gotGold + ' + 零头 ' + Math.round(sellPost * 100) / 100 + ' = 木价 ' +
    Math.round(sellPre.pi * 100) / 100 + '）');

  /* 库存不足置灰 */
  await ev((id) => { window.AO.resSim[id].salt.stock = 1; }, P.id);
  await clickSel(uniRow('market') + ' .qbtn');   // 收起
  await sleep(100);
  await clickSel(uniRow('market') + ' .qbtn');   // 重开（重建面板，读新库存）
  await sleep(150);
  const saltBtn = await ev(() => {
    const b = document.querySelector('#iSchoolList .qinfo.on button[data-sell="salt"]');
    return b ? b.disabled : null;
  });
  ck('库存不够的卖货钮置灰', saltBtn === true, '盐库存 1，按钮 disabled=' + saltBtn);

  /* 市场停产 → 卖货全灰，但建造不受影响 */
  await ev((id) => {
    const mk = window.AO.resMarket[id];
    mk.halted = true;
  }, P.id);
  await clickSel(uniRow('market') + ' .qbtn');
  await sleep(100);
  await clickSel(uniRow('market') + ' .qbtn');
  await sleep(150);
  const haltedSell = await ev(() => {
    const btns = [...document.querySelectorAll('#iSchoolList .qinfo.on button[data-sell]')];
    const add = document.querySelector('#iSchoolList .rr[data-univ="market"] .add');
    return { n: btns.length, allOff: btns.every(b => b.disabled),
             addOff: add.disabled, addTitle: add.title };
  });
  /* v18 追加三：市场每省一座 —— 这一行建满之后 ＋ 本来就灰了，
   * 灰的原因是「每省一座」而不是「停产」。停产仍然只停卖货。 */
  ck('市场停产只停「卖」；＋ 灰是"每省一座"，不是停产',
    haltedSell.allOff && haltedSell.addOff === true && /每省一座市场/.test(haltedSell.addTitle),
    '卖货 ' + haltedSell.n + ' 个全灰=' + haltedSell.allOff + '，＋建造 title=' + haltedSell.addTitle);
  await ev((id) => { window.AO.resMarket[id].halted = false; }, P.id);
  await clickSel(uniRow('market') + ' .qbtn');
  await sleep(100);

  /* ---------- 3) 建造坊 + 冲刺 ---------- */
  await give(P.id, 60);
  await clickSel(uniRow('builder') + ' .add');
  await sleep(120);
  const bSite = await rowInfo('builder');
  ck('建造坊开工', /建\d/.test(bSite.site), bSite.qty + ' ' + bSite.site);
  await page.click('#nextTurn'); await sleep(120);
  await page.click('#nextTurn'); await sleep(160);
  const bDone = await rowInfo('builder');
  ck('建造坊建成 ×1', bDone.qty === '×1', bDone.qty);

  /* 起一个工地（走真实的 ＋ 按钮），看行尾有没有冲刺钮 */
  const siteRow0 = await ev((id) => {
    const p = window.__world.provinces[id - 1];
    const key = p.resources[0].key;
    const def = window.AO.RESOURCE_BY_KEY[key];
    const row = [...document.querySelectorAll('#iBldList .rr.bld')]
      .find(r => r.querySelector('.nm').textContent === def.build);
    row.querySelector('.add').click();
    return { key: key, build: def.build };
  }, P.id);
  await sleep(200);
  const siteRow = await ev((id) => {
    const key = window.__world.provinces[id - 1].resources[0].key;
    const def = window.AO.RESOURCE_BY_KEY[key];
    const row = [...document.querySelectorAll('#iBldList .rr.bld')]
      .find(r => r.querySelector('.nm').textContent === def.build);
    return {
      key: key, build: def.build,
      site: window.AO.resSim[id][key].site,
      spurt: !!row.querySelector('.spurt'),
      built: window.AO.resSim[id][key].built
    };
  }, P.id);
  ck('有建造坊的省：工地行尾出现圆形冲刺钮', siteRow.spurt && siteRow.site > 0,
    siteRow.build + ' 在建 ' + siteRow.site + ' 回合，冲刺钮=' + siteRow.spurt);

  const g0 = await ev((id) => window.AO.resSim[id].gold.stock, P.id);
  const s1 = await ev((id) => window.AO.resSim[id][window.__world.provinces[id - 1].resources[0].key].site, P.id);
  await ev((id) => {
    const p = window.__world.provinces[id - 1];
    const def = window.AO.RESOURCE_BY_KEY[p.resources[0].key];
    const row = [...document.querySelectorAll('#iBldList .rr.bld')]
      .find(r => r.querySelector('.nm').textContent === def.build);
    row.querySelector('.spurt').click();
  }, P.id);
  await sleep(160);
  const s2 = await ev((id) => window.AO.resSim[id][window.__world.provinces[id - 1].resources[0].key].site, P.id);
  const g1 = await ev((id) => window.AO.resSim[id].gold.stock, P.id);
  ck('点冲刺：扣金 2、倒计时 −1', s2 === s1 - 1 && g1 === g0 - 2,
    '工期 ' + s1 + '→' + s2 + '，金 ' + g0 + '→' + g1);

  /* 一路砍到 0：立刻完工，不用点下一回合 */
  const builtBefore = await ev((id) => window.AO.resSim[id][window.__world.provinces[id - 1].resources[0].key].built, P.id);
  for (let i = 0; i < 6; i++) {
    const left = await ev((id) => window.AO.resSim[id][window.__world.provinces[id - 1].resources[0].key].site, P.id);
    if (!left) break;
    await ev((id) => {
      const p = window.__world.provinces[id - 1];
      const def = window.AO.RESOURCE_BY_KEY[p.resources[0].key];
      const row = [...document.querySelectorAll('#iBldList .rr.bld')]
        .find(r => r.querySelector('.nm').textContent === def.build);
      const b = row.querySelector('.spurt');
      if (b) b.click();
    }, P.id);
    await sleep(140);
  }
  const cutTo0 = await ev((id) => {
    const key = window.__world.provinces[id - 1].resources[0].key;
    const s = window.AO.resSim[id][key];
    return { site: s.site, built: s.built };
  }, P.id);
  ck('冲刺砍到 0 → 当场完工（不用点下一回合）',
    cutTo0.site === 0 && cutTo0.built === builtBefore + 1,
    '工地 ' + cutTo0.site + '，座数 ' + builtBefore + '→' + cutTo0.built);

  /* 没有建造坊的省：不该有冲刺钮 */
  const noB = await ev((pid) => {
    const w = window.__world, R = window.__renderer;
    for (const p of w.provinces) {
      if (!p || p.id === pid) continue;
      const b = window.AO.resBuilder[p.id];
      if (b && b.n > 0) continue;                 // 有建造坊的跳过
      const bag = window.AO.resSim[p.id];
      if (!bag) continue;
      for (const k in bag) bag[k].stock += 60;
      R.cam.x = p.centroid[0]; R.cam.y = p.centroid[1]; R.clampCam();
      R.select(p.id); R.draw();
      const key = p.resources[0].key;
      const def = window.AO.RESOURCE_BY_KEY[key];
      const row0 = [...document.querySelectorAll('#iBldList .rr.bld')]
        .find(r => r.querySelector('.nm').textContent === def.build);
      if (!row0) return { id: p.id, name: p.name, site: 0, spurt: null };
      row0.querySelector('.add').click();
      const s = window.AO.resSim[p.id][key];
      const row = [...document.querySelectorAll('#iBldList .rr.bld')]
        .find(r => r.querySelector('.nm').textContent === def.build);
      return { id: p.id, name: p.name, site: s.site,
               spurt: row ? !!row.querySelector('.spurt') : null };
    }
    return null;
  }, P.id);
  ck('没有建造坊的省：工地行尾没有冲刺钮',
    !!noB && noB.site > 0 && noB.spurt === false,
    noB ? noB.name + ' 在建 ' + noB.site + ' 回合，冲刺钮=' + noB.spurt : '没找到合适的省');

  /* 研究冲刺：全国有建造坊才出现 */
  const owner = P.owner;
  await ev((o) => {
    const R = window.AO.resResearch[o];
    R.pts = 200; R.unlocked = true;
    window.AO.resCentral[o].gold = 60;
  }, owner);
  await ev((o) => window.AO.resDebug.startResearch(o, 'plow2'), owner);
  await page.click('#nextTurn'); await sleep(200);
  await ev((o) => { window.__renderer.selectCountry(o); }, owner);
  await sleep(150);
  await ev(() => document.querySelector('#cTech .topen').click());
  await sleep(300);
  const ttSprint = await ev(() => {
    const node = document.querySelector('#ttNodes .ttnode[data-tech="plow2"]');
    const head = document.querySelector('#ttCur .ttsprint');
    return {
      cls: node ? node.className : '',
      nodeBtn: !!(node && node.querySelector('.ttsprint')),
      headBtn: !!head,
      left: window.AO.resResearch[1] ? null : null
    };
  });
  const rs0 = await ev((o) => ({ left: window.AO.resResearch[o].cur.left, gold: window.AO.resCentral[o].gold }), owner);
  await ev(() => document.querySelector('#ttCur .ttsprint').click());
  await sleep(250);
  const rs1 = await ev((o) => ({ left: window.AO.resResearch[o].cur ? window.AO.resResearch[o].cur.left : 0,
                                  gold: window.AO.resCentral[o].gold }), owner);
  ck('研究冲刺：顶栏与节点都有 ＋，点一下从中央扣 2 金、倒计时 −1',
    ttSprint.headBtn && ttSprint.nodeBtn && rs1.gold === rs0.gold - 2 && rs1.left === rs0.left - 1,
    '金 ' + rs0.gold + '→' + rs1.gold + '，剩 ' + rs0.left + '→' + rs1.left + ' 回合');

  /* ---------- 4) 全局科技 + 队列 ---------- */
  const mods = await ev((o) => {
    const R = window.AO.resResearch[o];
    ['ledger', 'gauge', 'road', 'apprent'].forEach(k => { R.done[k] = true; });
    const m = window.AO.resMODS(o);
    const pid = window.__renderer.selected;
    const baseLoss = window.AO.FREIGHT.lossAt(window.AO.resFreight[pid] || 0);
    const baseTurn = window.AO.FREIGHT.turnsAt(window.AO.resFreight[pid] || 0);
    return {
      m: m,
      loss: window.AO.resEffectiveLoss(pid, o),
      baseLoss: baseLoss,
      turns: window.AO.resEffectiveTurns(pid, o),
      baseTurn: baseTurn,
      turnsFloor: window.AO.resEffectiveTurns(pid, o, 1)
    };
  }, owner);
  ck('全局科技四条：税 +1 / 维护 −25% / 损耗 −5% / 工期 −1',
    mods.m.tax === 1 && mods.m.maintCut === 0.25 && mods.m.lossCut === 0.05 && mods.m.turnCut === 1,
    JSON.stringify(mods.m));
  ck('损耗走 effectiveLoss（不改 FREIGHT 本身）',
    Math.abs(mods.loss - (mods.baseLoss - 0.05)) < 1e-9 && mods.baseLoss === 0.30,
    '基础 ' + Math.round(mods.baseLoss * 100) + '% → 实际 ' + Math.round(mods.loss * 100) + '%');
  ck('工期走 effectiveTurns（下限 1）',
    mods.turns === Math.max(1, mods.baseTurn - 1) && mods.turnsFloor === 1,
    '基础 ' + mods.baseTurn + ' → ' + mods.turns + '（传 1 得 ' + mods.turnsFloor + '）');

  /* 抽税真的 +1：找一个产出够的省，对比税率 */
  const taxEff = await ev((o) => {
    const w = window.__world;
    let p = null;
    for (const q of w.provinces) { if (q && q.owner === o && q.resources) { p = q; break; } }
    const key = p.resources[0].key;
    const s = window.AO.resSim[p.id][key];
    s.stock = 50;
    const cen = window.AO.resCentral[o];
    const g0 = cen[key] || 0;
    window.AO.resDebug.settleTurn();
    return { key: key, delta: (cen[key] || 0) - g0, tax: window.AO.TAX.take, fx: window.AO.resMODS(o).tax };
  }, owner);
  ck('「复式账簿」让每笔抽税多抽 1', taxEff.delta >= taxEff.tax + taxEff.fx,
    taxEff.key + ' 中央 +' + taxEff.delta + '（基础 ' + taxEff.tax + ' + 账簿 ' + taxEff.fx + '）');

  /* 队列：入队不扣费；队头开研才扣；扣不起停摆 */
  const Q = await ev((o) => {
    const R = window.AO.resResearch[o];
    R.cur = null; R.queue.length = 0; R.pts = 120; R.unlocked = true;
    window.AO.resCentral[o].gold = 60;
    return { pts: R.pts, gold: window.AO.resCentral[o].gold };
  }, owner);
  await ev((o) => window.AO.resDebug.startResearch(o, 'saw2'), owner);
  await ev((o) => window.AO.resDebug.startResearch(o, 'net2'), owner);
  const Q1 = await ev((o) => {
    const R = window.AO.resResearch[o];
    return { pts: R.pts, gold: window.AO.resCentral[o].gold, q: R.queue.slice(), cur: R.cur };
  }, owner);
  ck('点节点 = 入队，不扣任何东西',
    Q1.q.length === 2 && Q1.pts === Q.pts && Q1.gold === Q.gold && !Q1.cur,
    '队列 [' + Q1.q.join(',') + ']，科研点 ' + Q1.pts + '，金 ' + Q1.gold);

  /* 重开一次树，让角标画出来（入队走的是数据层，不自动重绘） */
  await ev(() => document.getElementById('ttClose').click());
  await sleep(120);
  await ev(() => document.querySelector('#cTech .topen').click());
  await sleep(250);
  const badges = await ev(() => {
    const out = {};
    document.querySelectorAll('#ttNodes .ttnode').forEach(n => {
      const b = n.querySelector('.qbadge');
      if (b) out[n.getAttribute('data-tech')] = b.textContent;
    });
    return out;
  });
  ck('队列节点有序号角标', badges.saw2 === '1' && badges.net2 === '2', JSON.stringify(badges));

  /* 这一回合**临时摘掉上解**（v18.3）：上解就是"省库 → 中央"，而这一条验的是
   * "国库金少了那 5 金" —— 省里每回合搬回来的金会把它抵掉，看起来像没扣。
   * 和下面"中央造空 → 队头停摆"同一条处理，验完立刻装回。 */
  await ev(() => { window.__remit0 = window.AO.GOV.remit; window.AO.GOV.remit = null; });
  await ev(() => document.getElementById('ttTurn').click());   // 树盖着屏幕，用树里的回合钮
  await sleep(300);
  const Q2 = await ev((o) => {
    const R = window.AO.resResearch[o];
    const r = { pts: R.pts, gold: window.AO.resCentral[o].gold, q: R.queue.slice(), cur: R.cur && R.cur.key };
    window.AO.GOV.remit = window.__remit0;
    return r;
  }, owner);
  ck('队头开研才扣费（科研点 + 国库金）',
    Q2.cur === 'saw2' && Q2.pts < Q1.pts && Q2.gold < Q1.gold && Q2.q.length === 1,
    '队头 ' + Q2.cur + '，科研点 ' + Q1.pts + '→' + Q2.pts + '，金 ' + Q1.gold + '→' + Q2.gold);

  /* 取消：还没扣费，直接移除 */
  const beforeCancel = await ev((o) => ({ pts: window.AO.resResearch[o].pts,
                                          gold: window.AO.resCentral[o].gold }), owner);
  await ev((o) => window.AO.resDebug.startResearch(o, 'net2'), owner);
  const afterCancel = await ev((o) => ({ pts: window.AO.resResearch[o].pts,
                                         gold: window.AO.resCentral[o].gold,
                                         q: window.AO.resResearch[o].queue.slice() }), owner);
  ck('取消队列里的节点：直接移除、不误扣',
    afterCancel.q.length === 0 && afterCancel.pts === beforeCancel.pts &&
    afterCancel.gold === beforeCancel.gold,
    '队列 [' + afterCancel.q.join(',') + ']，科研点/金都没动');

  /* 中央造空 → 队头停摆并提示
   * v18.3 跟改：省库上解改成三段累进之后，"把中央金清零"不再等于"一整回合
   * 都没钱" —— 省里 30 以上的那部分每回合都会搬回中央，队头转眼就付得起。
   * 这一条验的是"付不起就停"（与上解无关），所以临时摘掉上解让金真的留在省里，
   * 验完立刻装回（bench-lifeline 也是同一手法）。 */
  const stall = await ev((o) => {
    const R = window.AO.resResearch[o];
    R.cur = null; R.queue.length = 0; R.done = Object.create(null);
    R.pts = 500; R.unlocked = true;
    window.AO.resCentral[o].gold = 0;
    window.__remit0 = window.AO.GOV.remit;
    window.AO.GOV.remit = null;
    window.AO.resDebug.startResearch(o, 'plow2');
    return { q: R.queue.slice() };
  }, owner);
  await ev(() => document.getElementById('ttTurn').click());
  await sleep(300);
  const stall2 = await ev((o) => {
    const R = window.AO.resResearch[o];
    const r = { cur: R.cur, q: R.queue.slice(), pts: R.pts };
    window.AO.GOV.remit = window.__remit0;      // 装回上解
    return r;
  }, owner);
  const stallMsg = await ev(() => document.getElementById('ttMsg').textContent);
  ck('中央造空 → 队头停摆、不扣科研点、给「资源不足，队列等待」',
    stall2.cur === null && stall2.q.length === 1 && stall2.pts === 500 && /队列等待/.test(stallMsg),
    '队列 [' + stall2.q.join(',') + ']，科研点仍 ' + stall2.pts + '，提示「' + stallMsg + '」');

  /* ---------- 7) 六张新图标都能加载 ---------- */
  const icons = await ev(() => {
    const keys = ['item-market-bld', 'item-builder-bld', 'item-tech-ledger',
                  'item-tech-gauge', 'item-tech-road', 'item-tech-apprent'];
    return Promise.all(keys.map(k => new Promise(res => {
      const im = new Image();
      im.onload = () => res({ k: k, ok: im.naturalWidth > 0, w: im.naturalWidth });
      im.onerror = () => res({ k: k, ok: false, w: 0 });
      im.src = 'assets/res/' + k + '.png';
    })));
  });
  ck('六张新图标都在 assets/res 里且能加载',
    icons.every(i => i.ok),
    icons.map(i => i.k.replace('item-', '') + ':' + i.w + 'px').join(' '));

  const techIcons = await ev(() => {
    const out = {};
    document.querySelectorAll('#ttNodes .ttnode').forEach(n => {
      const img = n.querySelector('.h img');
      out[n.getAttribute('data-tech')] = img ? { src: img.getAttribute('src'), w: img.naturalWidth } : null;
    });
    return out;
  });
  ck('四条全局科技节点用 item-tech-<key>.png',
    ['ledger', 'gauge', 'road', 'apprent'].every(k =>
      techIcons[k] && new RegExp('item-tech-' + k + '\\.png$').test(techIcons[k].src) && techIcons[k].w > 0),
    ['ledger', 'gauge', 'road', 'apprent'].map(k => k + ':' + (techIcons[k] ? techIcons[k].w : 'X')).join(' '));

  /* 树布局：11 个节点、深度按 req 算、全局科技也上树 */
  const treeGeo = await ev(() => {
    const pos = {};
    document.querySelectorAll('#ttNodes .ttnode').forEach(n => {
      pos[n.getAttribute('data-tech')] = Math.round(parseFloat(n.style.left));
    });
    return { n: Object.keys(pos).length, pos: pos,
             edges: document.querySelectorAll('#ttEdges path').length,
             total: window.AO.TECHS.length };
  });
  ck('树布局照旧按 req 算深度（11 个节点全上树）',
    treeGeo.n === treeGeo.total && treeGeo.pos.road === treeGeo.pos.plow2 &&
    treeGeo.pos.ledger > treeGeo.pos.plow2 && treeGeo.pos.gauge > treeGeo.pos.saw2,
    '节点 ' + treeGeo.n + '，第 1 列 x=' + treeGeo.pos.plow2 + '（驿道同列），' +
    '账簿 x=' + treeGeo.pos.ledger + '，连线 ' + treeGeo.edges + ' 条');

  await ev(() => document.getElementById('ttClose').click());
  await sleep(120);

  /* ---------- 4b) 铁矿深层休眠（v18 追加一补课） ----------
   * 旧断言是"铁矿采空即永久枯竭（gone）"—— 铁 cool 改成 48 之后那条不成立了，
   * 换成"采空 → 休眠 48 → 倒数到点回满复产"。金矿仍是 cool 0（永久枯竭），
   * 两种"没矿"从此不是一回事，这条对照一起验。 */
  const coolDefs = await ev(() => ({
    iron: window.AO.RESOURCE_BY_KEY.iron.cool,
    gold: window.AO.RESOURCE_BY_KEY.gold.cool
  }));
  ck('铁矿 cool = 48（深层休眠）· 金矿仍是 0（永久枯竭）',
    coolDefs.iron === 48 && coolDefs.gold === 0, '铁 ' + coolDefs.iron + ' · 金 ' + coolDefs.gold);

  /* 把这一省的铁矿捏成"只剩 1 点储量"：跑一回合就采空 */
  await ev((id) => {
    const s = window.AO.resSim[id].iron;
    s.built = 2; s.tiers = { 1: 2, 2: 0 };
    s.gone = false; s.cool = 0; s.halted = false; s.left = 1;
    s.stock = 60;
    window.AO.resSim[id].gold.stock = 150;          // 付得起维护，别让停产混进来
  }, P.id);
  await ev(() => { const D = window.AO.resDebug; D.settleTurn(); if (D.evtPending()) D.evtPick(0); });
  await sleep(200);
  const depleted = await ev((id) => {
    const s = window.AO.resSim[id].iron;
    return { cool: s.cool, gone: s.gone, left: s.left };
  }, P.id);
  ck('采空 → 进休眠 48 回合（不再 gone）',
    depleted.cool === 48 && depleted.gone === false,
    'cool=' + depleted.cool + ' gone=' + depleted.gone + ' left=' + depleted.left);

  /* 面板：行上要出现蓝色的「休眠 48」小标，×N 也转蓝 */
  await ev((id) => {
    window.AO.resDebug.showInfo(id);
    const body = document.getElementById('infoBody');
    if (!body.classList.contains('tab-bld')) {
      document.querySelector('#infoTabs .itab[data-tab="bld"]').click();
    }
  }, P.id);
  await sleep(220);
  const sleepRow = await ev(() => {
    const row = document.querySelector('#iBldList .rr[data-key="iron"]');
    const slp = row && row.querySelector('.sleep');
    const qty = row && row.querySelector('.qty');
    return { txt: slp ? slp.textContent : '', qty: qty ? qty.className : '',
             title: row ? row.title : '' };
  });
  ck('面板转蓝：行上写「休眠 48」，×N 也转蓝',
    /休眠\s*48/.test(sleepRow.txt) && /cool/.test(sleepRow.qty),
    '标「' + sleepRow.txt + '」 · qty=' + sleepRow.qty);

  /* 倒数到点：把 cool 压到 2 再跑两回合（走的是同一条 `s.cool--` → `left = n`），
   * 这样不必真的等 48 回合，也不会被半路的事件改掉储量。 */
  await ev((id) => {
    const s = window.AO.resSim[id].iron;
    s.cool = 2;
  }, P.id);
  await ev(() => {
    const D = window.AO.resDebug;
    for (let i = 0; i < 2; i++) { D.settleTurn(); if (D.evtPending()) D.evtPick(0); }
  });
  await sleep(200);
  const woke = await ev((id) => {
    const s = window.AO.resSim[id].iron;
    return { cool: s.cool, left: s.left, n: s.n, gone: s.gone };
  }, P.id);
  ck('倒数到点回满：cool 归零、left 回满 n、没有 gone',
    woke.cool === 0 && woke.left === woke.n && woke.gone === false,
    'cool=' + woke.cool + ' left=' + woke.left + '/' + woke.n);

  await ev((id) => {
    const A = window.AO;
    A.resSim[id].gold.stock = 150; A.resSim[id].iron.stock = 150;
    const D = A.resDebug; D.settleTurn(); if (D.evtPending()) D.evtPick(0);
  }, P.id);
  await sleep(160);
  const resumed = await ev((id) => {
    const A = window.AO, s = A.resSim[id].iron;
    return { left: s.left, prod: ((A.resFlow[id] || {}).d.prod || {}).iron || 0 };
  }, P.id);
  ck('醒了就复产（储量被采掉 / 流水里有产出）',
    resumed.left < woke.n || resumed.prod > 0,
    'left ' + woke.n + ' → ' + resumed.left + '，d.prod.iron=' + resumed.prod);

  /* 对照：金矿采空还是 gone（永久枯竭，淘金场入口不变） */
  await ev((id) => {
    const s = window.AO.resSim[id].gold;
    s.built = 2; s.tiers = { 1: 2, 2: 0 };
    s.gone = false; s.cool = 0; s.halted = false; s.left = 1;
  }, P.id);
  await ev(() => { const D = window.AO.resDebug; D.settleTurn(); if (D.evtPending()) D.evtPick(0); });
  await sleep(160);
  const goldEnd = await ev((id) => {
    const s = window.AO.resSim[id].gold;
    return { cool: s.cool, gone: s.gone };
  }, P.id);
  ck('金矿采空仍是永久枯竭（cool 0 / gone）',
    goldEnd.gone === true && goldEnd.cool === 0, 'cool=' + goldEnd.cool + ' gone=' + goldEnd.gone);

  /* ---------- 5) 存档 / 读档 ---------- */
  const saved = await ev((id, o) => {
    // 先把这一局捏成一个有辨识度的状态
    const R = window.AO.resResearch[o];
    R.done.mint2 = true;
    window.AO.resSim[id].gold.stock = 777;
    window.AO.resSchool[id].n = 5;
    return { gold: window.AO.resSim[id].gold.stock, school: window.AO.resSchool[id].n,
             turn: window.AO.resDebug.turn() };
  }, P.id, owner);
  /* v16：存档/读档/科技/治理/编年史 收进了 ☰ 菜单，先把菜单打开再点 */
  await page.click('#menuBtn');
  await sleep(150);
  await page.click('#saveBtn');
  await sleep(200);
  const hasSave = await ev(() => {
    /* 存档键和版本号都从定义区读 —— 以前这里硬编码 'sj.save.v1' + v===1，
     * 版本一升（v2 治理层 / v3 战争层）这条就必然红，而且报的是
     * "读不到存档"，看着像功能坏了。 */
    const raw = localStorage.getItem(window.AO.SAVE_KEY);
    if (!raw) return { ok: false, keys: [] };
    const d = JSON.parse(raw);
    return { ok: true, v: d.v, ver: window.AO.SAVE_VER, turn: d.turnNo, seed: d.seed,
             keys: Object.keys(d), size: raw.length };
  });
  ck('存档写入 AO.SAVE_KEY（含 SIM/SCHOOL/BUILDER/MARKET/CENTRAL/RESEARCH/POP）',
    hasSave.ok && hasSave.v === hasSave.ver && ['SIM', 'SCHOOL', 'BUILDER', 'MARKET', 'FREIGHT_LV',
      'CENTRAL', 'RESEARCH', 'POP'].every(k => hasSave.keys.indexOf(k) >= 0),
    'v' + hasSave.v + ' · ' + hasSave.keys.join(',') + ' · ' + ((hasSave.size / 1024) | 0) + ' KB');

  /* 刷新 = 纯工坊（不被劫持） */
  await page.reload({ waitUntil: 'load' });
  await sleep(2600);
  const fresh = await ev(() => ({ turn: window.AO.resDebug.turn(),
                                  gold: window.AO.resSim[1] && window.AO.resSim[1].gold.stock,
                                  hasWorld: !!window.__world }));
  ck('刷新后不点读档 = 纯工坊（回合 1、没被存档劫持）',
    fresh.hasWorld && fresh.turn === 1, '回合 ' + fresh.turn);

  /* v16：存档/读档/科技/治理/编年史 收进了 ☰ 菜单，先把菜单打开再点 */
  await page.click('#menuBtn');
  await sleep(150);
  await page.click('#loadBtn');
  await sleep(3600);
  const loaded = await ev((id, o) => ({
    turn: window.AO.resDebug.turn(),
    gold: window.AO.resSim[id] ? window.AO.resSim[id].gold.stock : null,
    school: window.AO.resSchool[id] ? window.AO.resSchool[id].n : null,
    mint2: !!(window.AO.resResearch[o] && window.AO.resResearch[o].done.mint2),
    seed: document.getElementById('seed').value,
    sameWorld: !!window.__world
  }), P.id, owner);
  ck('读档：同世界、同库存、同回合、同科技',
    loaded.turn === saved.turn && loaded.gold === saved.gold &&
    loaded.school === saved.school && loaded.mint2 && loaded.sameWorld,
    '回合 ' + loaded.turn + '（存档 ' + saved.turn + '），金 ' + loaded.gold +
    '，学校 ' + loaded.school + '，精炼提金 ' + loaded.mint2);

  /* 读档后省卡能重新打开并显示收支 */
  const afterLoadCard = await ev((id) => {
    const R = window.__renderer;
    R.select(id); R.draw();
    return { on: document.getElementById('info').classList.contains('on'),
             flow: document.getElementById('iFlow').textContent };
  }, P.id);
  ck('读档后省卡重渲染（收支行在）', afterLoadCard.on && afterLoadCard.flow.length > 0,
    afterLoadCard.flow);

  /* ---------- 汇总 ---------- */
  let pass = true;
  for (const [name, ok] of checks) if (!ok) pass = false;
  console.log('---');
  console.log('共 ' + checks.length + ' 项，失败 ' + checks.filter(c => !c[1]).length + ' 项');
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
