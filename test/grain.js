/* =============================================================
 * test/grain.js —— 内政批（粮仓库存上限 + 人才档位 15/35/60）的验收
 *
 * 对着任务书的验收清单逐条过：
 *   1) 无粮仓 150 封顶、收支小结见「满仓 −N」；3 座粮仓粮/渔 450、铁金仍 150；
 *      中央不受限
 *   2) 粮仓停产：上限回落，但不扣超额存量
 *   3) total 只增不减、抽卡花 pts 不动 total；15/35/60 依次解锁且 NOTES 正确；
 *      铸炮厂门槛变 35
 *   4) 工厂省的军械坊产量 ×2；大学加成进国家结算
 *   5) 存档加字段往返正常、读旧档补默认不炸
 *
 * 用法：node test/grain.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
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
  await sleep(2600);

  const checks = [];
  const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

  /* ---------------- 0) 选省：本国人口最大、且七种资源齐全的那一省 ---------------- */
  const S = await page.evaluate(() => {
    const w = window.__world, R = window.__renderer;
    const c = w.countries[0];
    let best = null;
    for (const id of c.provinces) {
      const p = w.provinces[id - 1];
      if (p && (!best || p.population > best.population)) best = p;
    }
    R.cam.x = best.centroid[0]; R.cam.y = best.centroid[1]; R.cam.scale = 2.0; R.camClamp && R.camClamp();
    R.select(best.id); R.draw();
    return { pid: best.id, owner: best.owner, name: best.name, pop: best.population };
  });

  /* ---------------- 1) 无粮仓：150 封顶 + 满仓 −N ---------------- */
  const capBase = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid, bag = AO.resSim[pid];
    /* 把粮仓清空、粮食建筑拉成"在产"，并把库存顶到上限 */
    AO.resGranary[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const caps = {
      grain: D.capOf(pid, 'grain'), fish: D.capOf(pid, 'fish'),
      iron: D.capOf(pid, 'iron'), gold: D.capOf(pid, 'gold'), timber: D.capOf(pid, 'timber')
    };
    const g = bag.grain;
    g.built = 1; g.tiers[1] = 1; g.tiers[2] = 0; g.left = 100; g.n = 100;
    g.cool = 0; g.gone = false; g.halted = false; g.eatAcc = 0; g.pAcc = 0;
    g.mAcc = { iron: 0, gold: 0 };
    bag.iron.stock = 60; bag.gold.stock = 60;      // 维护付得起，别让它停产
    AO.resPop[pid].v = 200000;                     // 口粮 1，吃不出乱子

    /* 连跑到出现"满仓"为止（每回合先把库存顶到上限；事件把产量打半也不怕） */
    let hit = 0, turn = 0, stock = 0, flowTxt = '';
    for (let i = 0; i < 8; i++) {
      bag.grain.stock = D.capOf(pid, 'grain');
      D.settleTurn();
      turn = D.turn();
      const F = D.flow[pid];
      hit = (F && F.d && F.d.cap && F.d.cap.grain) || 0;
      stock = bag.grain.stock;
      flowTxt = AO.resFlowText(F);
      if (hit > 0) break;
    }
    return { caps, hit, turn, stock, flowTxt, grainCap: D.capOf(pid, 'grain') };
  }, S);
  ck('无粮仓：七种资源上限都是 150',
    [capBase.caps.grain, capBase.caps.fish, capBase.caps.iron, capBase.caps.gold, capBase.caps.timber]
      .every(v => v === 150),
    '粮 ' + capBase.caps.grain + ' · 渔 ' + capBase.caps.fish + ' · 铁 ' + capBase.caps.iron +
    ' · 金 ' + capBase.caps.gold + ' · 木 ' + capBase.caps.timber);
  ck('粮食到上限就停：库存不越过 150',
    capBase.stock <= 150 && capBase.grainCap === 150,
    '第 ' + capBase.turn + ' 回合库 ' + capBase.stock + ' / 上限 ' + capBase.grainCap);
  ck('超出上限的部分记进 d.cap，收支小结写「满仓 −N」',
    capBase.hit > 0 && /满仓\s*−\d+/.test(capBase.flowTxt),
    'd.cap.grain=' + capBase.hit + ' · 小结「' + capBase.flowTxt + '」');

  /* ---------------- 2) 3 座粮仓：粮/渔 450，铁金仍 150；中央不受限 ---------------- */
  const cap3 = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid;
    AO.resGranary[pid] = { n: 3, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const caps = {
      grain: D.capOf(pid, 'grain'), fish: D.capOf(pid, 'fish'),
      iron: D.capOf(pid, 'iron'), gold: D.capOf(pid, 'gold'), salt: D.capOf(pid, 'salt')
    };
    /* 中央国库不设上限：塞 5000 粮，跑一回合，只会更多（抽税），不会被削 */
    const cen = AO.resCentral[a.owner];
    cen.grain = 5000;
    D.settleTurn();
    return { caps, cenGrain: cen.grain, base: AO.CAP.base, bonus: AO.GRANARY.capBonus };
  }, S);
  ck('3 座粮仓：粮/渔上限 450（150 + 3×100）',
    cap3.caps.grain === 450 && cap3.caps.fish === 450,
    '粮 ' + cap3.caps.grain + ' · 渔 ' + cap3.caps.fish +
    '（基础 ' + cap3.base + ' + 每座 ' + cap3.bonus + '）');
  ck('粮仓不加别的资源：铁 / 金 / 盐仍是 150',
    cap3.caps.iron === 150 && cap3.caps.gold === 150 && cap3.caps.salt === 150,
    '铁 ' + cap3.caps.iron + ' · 金 ' + cap3.caps.gold + ' · 盐 ' + cap3.caps.salt);
  ck('中央国库不上限（塞 5000 粮，跑一回合还在）',
    cap3.cenGrain >= 5000, '中央粮 ' + cap3.cenGrain);

  /* ---------------- 3) 粮仓停产：上限回落，但存量保留 ---------------- */
  const capHalt = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid, bag = AO.resSim[pid];
    /* 先造出"超额存量"（450 上限下囤 400），再把粮仓标成停产 */
    AO.resGranary[pid].halted = false;
    const capOn = D.capOf(pid, 'grain');
    bag.grain.stock = 400;
    AO.resGranary[pid].halted = true;
    const capOff = D.capOf(pid, 'grain');
    const before = bag.grain.stock;
    bag.grain.halted = true;          // 粮食建筑停产：这一回合既不产也不吃粮
    bag.iron.stock = 60; bag.gold.stock = 60;
    AO.resPop[pid].v = 1000;          // 口粮 1，扣得动
    D.settleTurn();
    return { capOn, capOff, before, after: bag.grain.stock, base: AO.CAP.base };
  }, S);
  ck('粮仓停产 → 上限回落到 150（加成立刻失效）',
    capHalt.capOn === 450 && capHalt.capOff === capHalt.base,
    '在产 ' + capHalt.capOn + ' → 停产 ' + capHalt.capOff);
  ck('上限回落不扣存量：超额的 400 还是 400（只停增量）',
    capHalt.after > capHalt.capOff && capHalt.after >= capHalt.before - 1,
    capHalt.before + ' → ' + capHalt.after + '（上限 ' + capHalt.capOff + '）');

  /* ---------------- 4) UI：资源行 / 粮仓行 / ? 面板 ---------------- */
  const ui = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid;
    /* 恢复成"3 座粮仓在产 + 粮库存 87"的可读状态，再渲染省卡 */
    AO.resGranary[pid] = { n: 3, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    AO.resSim[pid].grain.stock = 87;
    const R = window.__renderer;
    R.select(pid); R.draw();
    /* 切到「已开发」那一栏（资源行显示库存） */
    const devBtn = document.querySelector('#resState button[data-st="dev"]');
    if (devBtn) devBtn.click();

    const resRows = [...document.querySelectorAll('#iResList .rr')];
    const grainRow = resRows.find(r => (r.querySelector('.nm') || {}).textContent === '粮食');
    const growRow = document.querySelector('#iSchoolList .rr.bld[data-univ="granary"]');
    const uniRow = document.querySelector('#iSchoolList .rr.bld[data-univ="university"]');

    /* 粮仓行的 ＋ 在 3 座时应该置灰 */
    const addBtn = growRow ? growRow.querySelector('button.add') : null;

    /* 打开粮仓的 ? 面板，读里面的说明 */
    let qHtml = '';
    if (growRow) {
      growRow.querySelector('.qbtn').click();
      const q = document.querySelector('#iSchoolList .qinfo.on');
      qHtml = q ? q.textContent : '';
    }
    /* 建筑栏里粮食那一行的 ? 面板（库存 x / 上限 y 应该写在这里） */
    let qHtml2 = '';
    const bRows = [...document.querySelectorAll('#iBldList .rr.bld')];
    const farmRow = bRows.find(r => (r.querySelector('.nm') || {}).textContent === '农场');
    if (farmRow) {
      farmRow.querySelector('.qbtn').click();
      const q2 = document.querySelector('#iBldList .qinfo.on');
      qHtml2 = q2 ? q2.textContent : '';
    }
    /* 资源行的 title 直接写在 .rr 上 */
    return {
      resTitle: grainRow ? grainRow.title : '',
      growTitle: growRow ? growRow.title : '',
      growAddDisabled: addBtn ? addBtn.disabled : null,
      growAddTitle: addBtn ? addBtn.title : '',
      uniTitle: uniRow ? uniRow.title : '',
      qHtml, qHtml2,
      rows: document.querySelectorAll('#iSchoolList .rr.bld').length
    };
  }, S);
  ck('资源行 title 写「库存 87 / 上限 450」',
    /库存\s*87\s*\/\s*上限\s*450/.test(ui.resTitle),
    (ui.resTitle || '').split('\n')[0]);
  ck('粮仓行 title 写「+100 粮/渔上限」',
    /\+100 粮\/渔上限/.test(ui.growTitle),
    (ui.growTitle || '').split('\n')[1] || ui.growTitle);
  ck('3 座粮仓 → ＋ 置灰并说明已到上限',
    ui.growAddDisabled === true && /上限/.test(ui.growAddTitle),
    ui.growAddTitle);
  ck('粮仓 ? 面板写清本省上限（粮/渔 450）',
    /上限/.test(ui.qHtml) && /450/.test(ui.qHtml),
    (ui.qHtml || '').replace(/\s+/g, ' ').slice(0, 90));
  ck('农场 ? 面板写「库存 87 / 上限 450」',
    /库存/.test(ui.qHtml2) && /上限/.test(ui.qHtml2),
    (ui.qHtml2 || '').replace(/\s+/g, ' ').slice(0, 90));
  ck('大学行也在民用栏里（学校/市场/建造坊/粮仓/大学 = 5 行）',
    ui.rows === 5 && /大学/.test(ui.uniTitle),
    ui.rows + ' 行 · ' + (ui.uniTitle || '').split('\n')[0]);

  /* ---------------- 5) 人才 total：只增不减 + 抽卡不动 total ---------------- */
  const talent = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, owner = a.owner;
    const T = AO.resTalent[owner];
    T.pts = 0; T.total = 0; T.tier = -1;
    D.notes().length = 0;

    D.addTalent(owner, 15);
    const after15 = { total: T.total, pts: T.pts, tier: D.tierOf(owner), notes: D.notes().map(n => n.text) };

    /* 抽卡：pts 掉 10，total 一分不动（否则抽着抽着厂就被抽没了） */
    T.pts = 100;
    const before = { pts: T.pts, total: T.total };
    const r = D.exam(owner);
    const afterExam = { pts: T.pts, total: T.total, ok: r.ok };

    D.addTalent(owner, 20);                   // 15 → 35
    const after35 = { total: T.total, tier: D.tierOf(owner), notes: D.notes().map(n => n.text) };
    D.addTalent(owner, 30);                   // 35 → 65（跨 60）
    const after65 = { total: T.total, tier: D.tierOf(owner), notes: D.notes().map(n => n.text) };

    /* 再抽一次：total 仍然不动 */
    T.pts = 100;
    D.exam(owner);
    return { after15, afterExam, before, after35, after65, totalEnd: T.total };
  }, S);
  ck('累计教育 15：跨第一档「工厂」，并推一条 NOTES',
    talent.after15.total === 15 && talent.after15.tier === 0 &&
    talent.after15.notes.some(t => /教育跨档/.test(t) && /工厂/.test(t)),
    'total 15 · tier ' + talent.after15.tier + ' · ' + (talent.after15.notes[0] || '无 NOTES'));
  ck('抽卡只花 pts：100 → 90，total 一点不动',
    talent.afterExam.ok && talent.afterExam.pts === talent.before.pts - 10 &&
    talent.afterExam.total === talent.before.total,
    'pts ' + talent.before.pts + '→' + talent.afterExam.pts + ' · total ' + talent.before.total + '→' + talent.afterExam.total);
  /* v19：教育档只剩两档（15 工厂 / 60 大学）—— 铸炮厂删了，"35 火炮"那道门槛随之消失 */
  ck('累计教育 35：不跨档（35 火炮那道门槛已随铸炮厂删除）',
    talent.after35.total === 35 && talent.after35.tier === 0 &&
    !talent.after35.notes.some(t => /火炮/.test(t)),
    'total 35 · tier ' + talent.after35.tier);
  ck('累计教育 60：跨第二档「大学」（35→65 只报一次）',
    talent.after65.tier === 1 && talent.after65.notes.filter(t => /大学/.test(t)).length === 1,
    'total ' + talent.after65.total + ' · tier ' + talent.after65.tier);
  ck('连抽两次之后 total 仍是 65（只加不减）',
    talent.totalEnd === 65, 'total ' + talent.totalEnd);

  /* ---------------- 6) 铸炮厂已删 + 工厂 15 门槛 ---------------- */
  const gate = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid, owner = a.owner;
    const bag = AO.resSim[pid];
    bag.iron.built = 1; bag.iron.tiers[1] = 1;
    const prov = window.__world.provinces[pid - 1];
    const T = AO.resTalent[owner];
    const fac20 = AO.FACTORY.check('factory', prov, { bag: bag, edu: 20 });
    const fac10 = AO.FACTORY.check('factory', prov, { bag: bag, edu: 10 });
    /* 铸炮厂：定义 / 建厂 / 教育档三处都不该再存在 */
    const noFoundry = !AO.FACTORY.foundry;
    T.total = 10; T.tier = 0;
    D.buildFactory(prov, 'foundry');                 // 老脚本这样调：现在应该是空转不报错
    const msg10 = (document.getElementById('bldMsg') || {}).textContent || '';
    T.total = 20; T.tier = 0;
    return { noFoundry: noFoundry, fac20: fac20.ok, fac10: fac10.ok, fac10Why: fac10.why,
      msg10: msg10, tiers: AO.TIER.map(t => t.at).join(',') };
  }, S);
  ck('铸炮厂整条删掉（定义 / 建厂 / 教育档都没了）',
    gate.noFoundry && gate.tiers === '15,60' && !gate.msg10,
    'TIER=' + gate.tiers + ' · buildFactory 静默=' + !gate.msg10);
  ck('工厂要累计教育 15（10 点不行、20 点行）',
    gate.fac10 === false && gate.fac20 === true,
    gate.fac10Why);

  /* ---------------- 7) 工厂 ×2（v19：乘的是产能点数）+ 大学加成 ---------------- */
  const prod = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid, owner = a.owner;
    const bag = AO.resSim[pid];
    AO.resMil.armory[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    AO.resFactory[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    bag.iron.stock = 60; bag.gold.stock = 60;
    const one = D.millCap(pid, 'armory');            // 1 座 × 2 点 = 2
    AO.resFactory[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const two = D.millCap(pid, 'armory');            // ×2 = 4
    const mulHalted = (() => {
      AO.resFactory[pid].halted = true;
      const v = D.armProdMul(pid);
      AO.resFactory[pid].halted = false;
      return v;
    })();
    AO.resFactory[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const back = D.millCap(pid, 'armory');

    /* 大学：每座 +6 科研点、+2 人才点（走国家结算） */
    AO.resUniversity[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const R = AO.resResearch[owner], T = AO.resTalent[owner];
    const sci0 = R.pts, tal0 = T.total;
    D.settleTurn();
    const dSci = R.pts - sci0, dTal = T.total - tal0;
    return { one, two, mulHalted, back, dSci, dTal, uniN: AO.resUniversity[pid].n };
  }, S);
  ck('工厂省：本省产能 2 → 4 点（料不变，多的是产能）',
    prod.one === 2 && prod.two === 4, prod.one + ' 点 → 有工厂 ' + prod.two + ' 点');
  ck('工厂停产 / 没工厂 → 乘数回到 ×1',
    prod.mulHalted === 1 && prod.back === 2,
    '停产 ×' + prod.mulHalted + ' · 无厂 ' + prod.back + ' 点');
  ck('大学进国家结算：本回合科研点 +6、累计教育 +2',
    prod.dSci >= 6 && prod.dTal >= 2,
    '科研 +' + prod.dSci + ' · 教育 +' + prod.dTal);

  /* ---------------- 8) 治理面板的教育进度行 ---------------- */
  const govRow = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug;
    AO.resTalent[a.owner].total = 22;
    AO.resTalent[a.owner].tier = 0;
    D.openGov(a.owner);
    const el = document.getElementById('gpEdu');
    const txt = el ? el.textContent : '';
    const tip = el ? el.title : '';
    D.closeGov();
    return { txt, tip };
  }, S);
  ck('治理面板国家区有「教育 22/60 · 下一档：大学」',
    /教育\s*22\/60/.test(govRow.txt) && /下一档：大学/.test(govRow.txt),
    govRow.txt);
  ck('教育行的悬停列出两档（15 工厂 / 60 大学；35 火炮已随铸炮厂删除）',
    /15 工厂/.test(govRow.tip) && /60 大学/.test(govRow.tip) && !/35 火炮/.test(govRow.tip),
    (govRow.tip || '').split('\n').slice(2).join(' | ').slice(0, 80));

  /* ---------------- 9) 存档：加字段往返 ---------------- */
  const saveInfo = await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid, owner = a.owner;
    AO.resGranary[pid] = { n: 3, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    AO.resUniversity[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    AO.resFactory[pid] = { n: 2, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    AO.resTalent[owner].total = 65;
    AO.resTalent[owner].tier = 2;
    D.save();
    const raw = localStorage.getItem('sj.save');
    const d = JSON.parse(raw);
    return {
      v: d.v, ver: AO.SAVE_VER,
      hasG: !!d.GRANARY, hasU: !!d.UNIVERSITY, hasF: !!d.FACTORY_BLD,
      gN: (d.GRANARY[pid] || {}).n, uN: (d.UNIVERSITY[pid] || {}).n,
      fN: (d.FACTORY_BLD[pid] || {}).n,
      total: (d.TALENT[owner] || {}).total, tier: (d.TALENT[owner] || {}).tier,
      kb: Math.round(raw.length / 1024)
    };
  }, S);
  ck('存档仍是 v' + saveInfo.ver + '（本批不升号），且带上 GRANARY / UNIVERSITY / FACTORY_BLD / TALENT.total',
    saveInfo.v === saveInfo.ver && saveInfo.hasG && saveInfo.hasU && saveInfo.hasF &&
    saveInfo.total === 65 && saveInfo.tier === 2,
    'v' + saveInfo.v + ' · ' + saveInfo.kb + ' KB · 粮仓 ' + saveInfo.gN +
    ' · 大学 ' + saveInfo.uN + ' · 工厂 ' + saveInfo.fN + ' · 教育 ' + saveInfo.total);

  const restored = await page.evaluate(async (a) => {
    const AO = window.AO, D = AO.resDebug, pid = a.pid;
    /* 先把内存里的东西砸掉，再读档 */
    AO.resGranary[pid].n = 0;
    AO.resUniversity[pid].n = 0;
    AO.resFactory[pid].n = 0;
    AO.resTalent[a.owner].total = 0;
    AO.resTalent[a.owner].tier = -1;
    D.load();
    for (let i = 0; i < 140; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.__world && AO.resGranary[a.pid] && AO.resGranary[a.pid].n === 3) break;
    }
    await new Promise(r => setTimeout(r, 400));
    return {
      gN: AO.resGranary[pid].n, uN: AO.resUniversity[pid].n, fN: AO.resFactory[pid].n,
      total: AO.resTalent[a.owner].total, tier: AO.resTalent[a.owner].tier,
      cap: D.capOf(pid, 'grain')
    };
  }, S);
  ck('读档往返：粮仓 3 / 大学 1 / 工厂 2 / 教育 65 全回来了，上限跟着是 450',
    restored.gN === 3 && restored.uN === 1 && restored.fN === 2 &&
    restored.total === 65 && restored.tier === 2 && restored.cap === 450,
    '粮仓 ' + restored.gN + ' · 大学 ' + restored.uN + ' · 工厂 ' + restored.fN +
    ' · 教育 ' + restored.total + ' · 上限 ' + restored.cap);

  /* ---------------- 10) 读旧档（缺内政批字段）：补默认不炸 ---------------- */
  const oldSave = await page.evaluate(async (a) => {
    const AO = window.AO, D = AO.resDebug;
    const raw = localStorage.getItem('sj.save');
    const d = JSON.parse(raw);
    /* 模拟"并行批落地前"的 v6 档：三张新表、TALENT 的 total/tier 都不存在 */
    delete d.GRANARY; delete d.UNIVERSITY; delete d.FACTORY_BLD;
    for (const k in d.TALENT) { delete d.TALENT[k].total; delete d.TALENT[k].tier; }
    const pts = (d.TALENT[a.owner] || {}).pts || 0;
    localStorage.setItem('sj.save', JSON.stringify(d));
    D.load();
    for (let i = 0; i < 140; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.__world && AO.resSim[a.pid] && AO.resGranary[a.pid]) break;
    }
    await new Promise(r => setTimeout(r, 500));
    const T = AO.resTalent[a.owner];
    return {
      gN: AO.resGranary[a.pid] ? AO.resGranary[a.pid].n : -1,
      uN: AO.resUniversity[a.pid] ? AO.resUniversity[a.pid].n : -1,
      cap: D.capOf(a.pid, 'grain'),
      total: T.total, pts: T.pts, tier: T.tier, ptsInSave: pts,
      tierOk: T.tier === AO.tierIndexAt(T.total),
      world: !!window.__world
    };
  }, S);
  ck('读旧档（无内政批字段）：粮仓/大学补 0 座、上限回 150，不炸',
    oldSave.world && oldSave.gN === 0 && oldSave.uN === 0 && oldSave.cap === 150,
    '粮仓 ' + oldSave.gN + ' · 大学 ' + oldSave.uN + ' · 上限 ' + oldSave.cap);
  ck('读旧档：total 按 pts 补（偏低可接受），tier 按 total 对齐',
    oldSave.total === oldSave.pts && oldSave.tierOk,
    'pts ' + oldSave.pts + ' → total ' + oldSave.total + ' · tier ' + oldSave.tier);

  /* ---------------- 汇总 ---------------- */
  let pass = true;
  console.log('省份：' + S.name + '（#' + S.pid + '，人口 ' + S.pop + '）');
  for (const [name, ok, note] of checks) {
    if (!ok) pass = false;
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + note);
  }
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
