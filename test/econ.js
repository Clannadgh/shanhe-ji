/* =============================================================
 * test/econ.js —— 经济沙盒六件套的验收（对着任务书的验收清单逐条过）
 *
 *   1) 省卡收支小结 = 实际结算（库存变化逐项对账）；国库总览 = 中央实际变化
 *   2) 市场：建好后 ? 面板能卖资源换金；库存不足置灰；停产只停"卖"
 *   3) 建造坊：有它的省工地行尾有 ＋（扣金、倒计时 −1、砍到 0 立即完工）；
 *      没有它的省没有这个钮；研究冲刺从中央扣费
 *   4) 全局科技四条各有效；队列：入队不扣费、队头开研才扣、扣不起停摆
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
    const rows = [...panel.querySelectorAll('.sellbox:not(.buy) .srow')];
    const buys = [...panel.querySelectorAll('.sellbox.buy .srow')];
    return {
      n: rows.length,
      labels: rows.map(r => r.querySelector('span').textContent),
      btns: rows.map(r => ({ t: r.querySelector('button').textContent, dis: r.querySelector('button').disabled })),
      bn: buys.length,
      bbtns: buys.map(r => ({ t: r.querySelector('button').textContent, dis: r.querySelector('button').disabled }))
    };
  });
  ck('市场 ? 面板：七种资源各一行「卖 5 → +1 金」',
    sellUi.n === 7 && sellUi.btns.every(b => /卖 5 → \+1 金/.test(b.t)),
    sellUi.n + ' 行：' + sellUi.labels.join('/'));
  ck('市场 ? 面板：七种资源各一行买货「买 5 ← 8 金」',
    sellUi.bn === 7 && sellUi.bbtns.every(b => /买 5 ← 8 金/.test(b.t)),
    sellUi.bn + ' 行' + (sellUi.bn ? '' : '（买货格没画出来）'));

  const goldBefore = await ev((id) => window.AO.resSim[id].gold.stock, P.id);
  const timBefore = await ev((id) => window.AO.resSim[id].timber.stock, P.id);
  await ev(() => document.querySelector('#iSchoolList .qinfo.on button[data-sell="timber"]').click());
  await sleep(200);
  const goldAfter = await ev((id) => window.AO.resSim[id].gold.stock, P.id);
  const timAfter = await ev((id) => window.AO.resSim[id].timber.stock, P.id);
  ck('卖 5 木材 → +1 金（本省库存直接扣）',
    goldAfter === goldBefore + 1 && timAfter === timBefore - 5,
    '木材 ' + timBefore + '→' + timAfter + '，金 ' + goldBefore + '→' + goldAfter);

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
    return { n: btns.length, allOff: btns.every(b => b.disabled),
             addOff: document.querySelector('#iSchoolList .rr[data-univ="market"] .add').disabled };
  });
  ck('市场停产只停「卖」（建造钮仍然可用）',
    haltedSell.allOff && haltedSell.addOff === false,
    '卖货 ' + haltedSell.n + ' 个全灰=' + haltedSell.allOff + '，＋建造 disabled=' + haltedSell.addOff);
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

  await ev(() => document.getElementById('ttTurn').click());   // 树盖着屏幕，用树里的回合钮
  await sleep(300);
  const Q2 = await ev((o) => {
    const R = window.AO.resResearch[o];
    return { pts: R.pts, gold: window.AO.resCentral[o].gold, q: R.queue.slice(), cur: R.cur && R.cur.key };
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

  /* 中央造空 → 队头停摆并提示 */
  const stall = await ev((o) => {
    const R = window.AO.resResearch[o];
    R.cur = null; R.queue.length = 0; R.done = Object.create(null);
    R.pts = 500; R.unlocked = true;
    window.AO.resCentral[o].gold = 0;
    window.AO.resDebug.startResearch(o, 'plow2');
    return { q: R.queue.slice() };
  }, owner);
  await ev(() => document.getElementById('ttTurn').click());
  await sleep(300);
  const stall2 = await ev((o) => {
    const R = window.AO.resResearch[o];
    return { cur: R.cur, q: R.queue.slice(), pts: R.pts };
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
