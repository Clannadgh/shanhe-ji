/* =============================================================
 * test/smelt.js —— 人口铁税 + 熔旧坊（枯竭铁矿场的再就业）的验收
 *
 * 对着这次改动的验收清单逐条过：
 *   ① 矿脉枯竭 → 铁矿场那一行出现「改建」钮；没枯的矿行不出现
 *   ①b 铁矿「深层休眠」（cool 48）也能改建 —— v18 追加一补课：
 *      "矿睡了"和"矿死了"都是开炉的时机（SMELT.dormant）
 *   ② 累计教育 0 也能改建（**门槛已拆**，见文件头的家法说明）
 *   ③ 改建 2 回合后行内变身（名字/图标/×n），产量与金耗恒等 产量 × 0.5
 *   ④ 每省 2 座封顶
 *   ⑤ 付不起金 → 当回合产量减半，不欠账
 *   ⑥ lode（矿脉新发现）命中枯竭矿 → 复活，且与熔旧坊收入叠加
 *   ⑦ 无铁省开不了炉；人口铁税照常（同档同系数、攒整落袋）
 *   ⑧ 存档：SMELT / IRONACC 进档；缺字段的老档不炸
 *
 * **一处旧用例跟着改了：门槛已拆除**（v18 / A0）。
 * 原来 ② 验的是"累计教育 < 15 → 改建钮置灰"，而 A0 把这道门槛整段删了
 * （活命建筑不问学历：最缺铁金的正是没铺学校的穷国）。旧用例留着只会一直红，
 * 所以按家法**整节反转**成"教育 0 也能改建、钮亮、SMELT.check.ok、文案里
 * 不再出现'累计教育'"。下面 65 行那个"先把门槛铺够"的 setup 也一并改掉了。
 *
 * 跑法：node test/smelt.js
 * 小世界（120 省 / 6 国），二十几秒。
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
    document.getElementById('seed').value = 'smelt-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- 公用：挑省 + 铺条件 ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO;
    const w = D.world();
    /* 挑一个"省数够多"的国当玩家国（要有至少两个能用的铁矿省） */
    let cid = 0, best = null;
    for (const c of w.countries) {
      const ironProvs = c.provinces.filter(id => {
        const p = w.provinces[id - 1];
        return p && (p.resources || []).some(r => r.key === 'iron');
      });
      if (ironProvs.length >= 2 && (!best || c.provinces.length > best.n)) {
        best = { n: c.provinces.length, cid: c.id, iron: ironProvs };
      }
    }
    cid = best.cid;
    D.choosePlayer(cid);
    /* 教育（v18 / A0）：门槛已拆 —— 这里**故意留 0**，用来验"活命建筑不问学历" */
    D.talent[cid].total = 0;
    /* 中央给足木/金，改建价（木 10 · 金 14）付得出 */
    const cen = D.ensureCentral(cid);
    cen.timber = 400; cen.gold = 400; cen.iron = 400; cen.grain = 400;
    window.__T = { cid: cid, a: best.iron[0], b: best.iron[1] };
    /* 建筑页的标签是"点一下开、再点一下关"——测试里反复点会把面板关掉，
     * 所以统一走这个助手：只在没开的时候点一次 */
    window.__openBld = function (pid) {
      D.showInfo(pid);
      var body = document.getElementById('infoBody');
      if (!body.classList.contains('tab-bld')) {
        document.querySelector('#infoTabs .itab[data-tab="bld"]').click();
      }
    };
    /* a = 要枯竭的那个省（用来改建）；b = 保持完好的那个省（对照组） */
  });

  /* ---------------- ① 枯竭才出现「改建」钮 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const pa = w.provinces[T.a - 1], pb = w.provinces[T.b - 1];
    /* a / b 的铁矿都先"建过 2 座"：真实世界里矿是先挖空、再枯竭的，
     * 建过才有"复活后恢复出产"这回事（没建过的矿本来就不产） */
    [T.a, T.b].forEach(id => {
      const s = A.resSim[id].iron;
      s.built = 2; s.tiers = { 1: 2, 2: 0 };
    });
    /* 让 a 的铁矿"采空"（left=0 + gone，等价于 settleTurn 里走到 left<=0） */
    const sa = A.resSim[T.a].iron;
    sa.left = 0; sa.gone = true; sa.cool = 0;
    /* b 保持完好（储量回满） */
    const sb = A.resSim[T.b].iron;
    sb.left = sb.n; sb.gone = false; sb.cool = 0;

    window.__openBld(T.a);
    const rowA = document.querySelector('#iBldList .rr[data-key="iron"]');
    const btnA = rowA && rowA.querySelector('.add');
    ok('① 枯竭矿的铁矿场行有「改建」钮', !!btnA && btnA.getAttribute('data-smelt') === '1',
      btnA ? btnA.textContent : '没找到行');
    ok('① 改建钮写着「改建」', !!btnA && btnA.textContent === '改建', btnA && btnA.textContent);
    ok('① 枯竭矿的 ＋ 不再是「＋」', !!btnA && btnA.textContent !== '＋');

    window.__openBld(T.b);
    const rowB = document.querySelector('#iBldList .rr[data-key="iron"]');
    const btnB = rowB && rowB.querySelector('.add');
    ok('① 没枯的矿行没有「改建」钮', !!btnB && btnB.getAttribute('data-smelt') !== '1',
      btnB ? btnB.textContent : '没找到行');
    ok('① 没枯的矿行还是「＋」', !!btnB && btnB.textContent === '＋', btnB && btnB.textContent);
    return o;
  }));

  /* ---------------- ①b 铁矿「深层休眠」也能改建（v18 追加一补课） ----------------
   * cool 0 → 48 之后，"矿睡了"不再等于"矿死了"：gone **或** cool>0 都该开炉。
   * 淘金场那条不动（金矿 cool 仍是 0，只认 gone），所以这里只验铁。 */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T;
    const s = A.resSim[T.a].iron;
    /* 从"永久枯竭"换成"深层休眠"——这正是老档迁移之后的样子 */
    s.gone = false; s.cool = 48; s.left = 0;

    const ck = D.smeltCheck(T.a);
    ok('①b 休眠中的铁省：规则层放行（SMELT.check.ok）', ck.ok === true, JSON.stringify(ck));
    ok('①b SMELT.dormant 认休眠（cool>0）也认枯竭（gone）',
      A.SMELT.dormant(s) === true && A.SMELT.dormant({ gone: true, cool: 0 }) === true &&
      A.SMELT.dormant({ gone: false, cool: 0 }) === false,
      'sleep=' + A.SMELT.dormant(s));

    window.__openBld(T.a);
    const row = document.querySelector('#iBldList .rr[data-key="iron"]');
    const btn = row && row.querySelector('.add');
    ok('①b 休眠中：＋ 变成「改建」且是亮的',
      !!btn && btn.getAttribute('data-smelt') === '1' && btn.disabled === false,
      btn ? 'text=' + btn.textContent + ' disabled=' + btn.disabled : '没找到行');

    /* 复原成 ① 的"枯竭"态：后面的 ② / ③ 还按那一套走 */
    s.gone = true; s.cool = 0;
    return o;
  }));

  /* ---------------- ② 教育 0 也能改建（v18 / A0：门槛已拆） ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T;
    D.talent[T.cid].total = 0;                    // 一个没铺过学校的穷国
    window.__openBld(T.a);
    const row = document.querySelector('#iBldList .rr[data-key="iron"]');
    const btn = row && row.querySelector('.add');
    ok('② 教育 0 时改建钮是亮的', !!btn && btn.disabled === false,
      btn ? 'disabled=' + btn.disabled : '没找到');
    const ck = D.smeltCheck(T.a);
    ok('② 规则层放行（SMELT.check.ok）', !!ck && ck.ok === true, JSON.stringify(ck));
    ok('② 改建钮 title 不再提"累计教育"', !!btn && !/累计教育/.test(btn.title),
      btn && btn.title.split('\n')[0]);
    ok('② why 里也没有"累计教育"', !/累计教育/.test(ck.why || ''), ck.why || '(ok)');
    ok('② SMELT 定义里已经没有 needEdu 字段', A.SMELT.needEdu === undefined,
      String(A.SMELT.needEdu));
    return o;
  }));

  /* ---------------- ③ 改建 2 回合 → 行内变身；产量 = 金耗 × 2 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const p = w.provinces[T.a - 1];
    D.buildSmelt(p);
    const st = D.smeltOf(T.a);
    ok('③ 改建开工：site = 2', st && st.site === 2, st && st.site);
    ok('③ 开工时还没变身（n 仍是 0）', st && st.n === 0, st && st.n);

    /* 走两回合（中间弹出的玩家事件按默认选项落地，别把回合卡住） */
    for (let i = 0; i < 2; i++) {
      D.settleTurn();
      if (D.evtPending()) D.evtPick(0);
    }
    ok('③ 两回合后完工：site = 0 · n = 1', st.site === 0 && st.n === 1, 'site=' + st.site + ' n=' + st.n);

    window.__openBld(T.a);
    const row = document.querySelector('#iBldList .rr[data-key="iron"]');
    ok('③ 行内变身：名字变「熔旧坊」', !!row && row.querySelector('.nm').textContent === '熔旧坊',
      row && row.querySelector('.nm').textContent);
    const img = row && row.querySelector('img');
    ok('③ 行内变身：图标换成 item-smelt-bld.png',
      !!img && /item-smelt-bld\.png/.test(img.getAttribute('src') || ''), img && img.getAttribute('src'));
    ok('③ 行内变身：×n 读的是熔旧坊座数',
      !!row && row.querySelector('.qty').textContent === '×1', row && row.querySelector('.qty').textContent);

    /* 对账：连跑 20 回合，累计产铁 vs 累计付金（付金 = 省库 + 中央垫） */
    let iron = 0, gold = 0;
    for (let i = 0; i < 20; i++) {
      D.settleTurn();
      if (D.evtPending()) D.evtPick(0);
      const F = D.flow[T.a];
      iron += (F && F.d.smelt) || 0;
      gold += (F && F.d.smeltGold) || 0;
      gold += (F && F.d.smeltC) || 0;
    }
    ok('③ 20 回合确有产出', iron > 0, '铁 +' + iron + ' · 金 −' + gold);
    ok('③ 对账：累计金耗 = 累计产量 × 0.5（零头留在 mAcc，误差 < 1 金）',
      Math.abs(gold * 2 - iron) <= 1, '铁 ' + iron + ' / 金 ' + gold + ' → 2×金 = ' + gold * 2);
    return o;
  }));

  /* ---------------- ④ 每省 2 座封顶 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const p = w.provinces[T.a - 1];
    const st = D.smeltOf(T.a);
    /* 第二座：走真流程（付账 + 工期）。
     * 工期读 effectiveTurns：冬季「农闲徭役」会砍 1 回合，所以**不能写死 2** ——
     * 写死的话这条断言只在非冬季成立（v13 季节批之后就时不时红一次）。 */
    const expect = D.effectiveTurns(p.id, p.owner, A.SMELT.turns);
    D.buildSmelt(p);
    ok('④ 第二座开工', st.site === expect, 'site=' + st.site + ' / 期望 ' + expect);
    for (let i = 0; i < expect; i++) { D.settleTurn(); if (D.evtPending()) D.evtPick(0); }
    ok('④ 第二座完工：n = 2', st.n === 2, 'n=' + st.n);
    const ck = D.smeltCheck(T.a);
    ok('④ 第 3 座被规则挡住（封顶 2）', !ck.ok && /封顶 2/.test(ck.why), ck.why);

    window.__openBld(T.a);
    const btn = document.querySelector('#iBldList .rr[data-key="iron"] .add');
    ok('④ 封顶后改建钮置灰', !!btn && btn.disabled === true, btn ? 'disabled=' + btn.disabled : '没找到');
    ok('④ 封顶后 title 写「封顶」', !!btn && /封顶/.test(btn.title), btn && btn.title.split('\n')[0]);
    return o;
  }));

  /* ---------------- ⑤ 付不起金 → 当回合产量减半，不欠账 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T;
    const st = D.smeltOf(T.a);
    const owner = D.world().provinces[T.a - 1].owner;

    /* 让这一回合"攒出 10 块铁"，手里只有 3 金（够半炉，不够整炉） */
    st.iAcc = 9.5;
    st.mAcc.gold = 0;
    D.setGold(T.a, 3);
    D.ensureCentral(owner).gold = 0;
    const iron0 = D.stockOf(T.a, 'iron');
    const got = D.settleSmelt(T.a, owner);
    const spent = 3 - D.goldOf(T.a);
    ok('⑤ 付不起整炉金 → 产量减半（10 → 5）', got === 5, 'got=' + got);
    ok('⑤ 半炉的金照付（5 × 0.5 = 2 金）', spent === 2, 'spent=' + spent);
    ok('⑤ 不欠账：mAcc 只留小数零头（< 1 金）', st.mAcc.gold > 0 && st.mAcc.gold < 1,
      'mAcc=' + st.mAcc.gold);
    ok('⑤ 铁确实进了省库', D.stockOf(T.a, 'iron') - iron0 === got,
      'Δ=' + (D.stockOf(T.a, 'iron') - iron0));

    /* 一分钱都没有 → 停炉（连半炉都付不起） */
    st.iAcc = 9.5; st.mAcc.gold = 0;
    D.setGold(T.a, 0);
    D.ensureCentral(owner).gold = 0;
    const got0 = D.settleSmelt(T.a, owner);
    ok('⑤ 一分金都没有 → 停炉（产量 0，且不挂欠账）', got0 === 0 && st.halted === true,
      'got=' + got0 + ' halted=' + st.halted);
    ok('⑤ 停炉也不留欠账', st.mAcc.gold < 1, 'mAcc=' + st.mAcc.gold);
    st.halted = false;
    return o;
  }));

  /* ---------------- ⑥ lode 命中枯竭矿 → 复活 + 与熔旧坊叠加 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    const p = w.provinces[T.a - 1];
    const si = A.resSim[T.a].iron, sg = A.resSim[T.a].gold;
    /* 把铁、金两条矿脉都按到枯竭，oreOf 就会挑到铁（第一顺位） */
    si.left = 0; si.gone = true;
    sg.left = 0; sg.gone = true;
    const before = { n: si.n, gone: si.gone, smelt: D.smeltOf(T.a).n };
    D.evtForceModal('lode', T.a);
    D.evtPick(0);                       // 募工深采：储量 +50%
    ok('⑥ lode 命中枯竭矿 → gone 清掉', si.gone === false, 'gone=' + si.gone);
    ok('⑥ 储量回来了（≈ 原始储量的一半）', si.left >= 10, 'left=' + si.left);
    ok('⑥ 熔旧坊照常并存', D.smeltOf(T.a).n === before.smelt && before.smelt > 0,
      '熔旧坊 ×' + D.smeltOf(T.a).n);

    /* 两份收入叠加：跑一回合，矿场的产出与熔旧坊的产出都记在账上 */
    A.resSim[T.a].iron.stock = 0;
    D.setGold(T.a, 200);
    D.ensureCentral(p.owner).gold = 200;
    D.settleTurn();
    if (D.evtPending()) D.evtPick(0);
    const F = D.flow[T.a];
    const sm = (F && F.d.smelt) || 0;
    const mine = ((F && F.gain.iron) || 0) - sm - ((F && F.d.ironTax) || 0);
    ok('⑥ 熔旧坊这一份还在产', sm > 0, '熔旧坊 +' + sm + ' 铁');
    ok('⑥ 复活矿场那一份也在产（两份叠加）', mine > 0, '矿场 +' + mine + ' 铁');
    return o;
  }));

  /* ---------------- ⑦ 无铁省开不了炉；铁税照常 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T, w = D.world();
    /* 造一个"没有铁矿资源"的省：把袋子摘掉（真实世界里七种资源每省都有，
     * 这里验的是**代码的防御**：没有矿就没有这一行，也开不了炉） */
    const pid = T.b;
    const p = w.provinces[pid - 1];
    const saved = A.resSim[pid].iron;
    delete A.resSim[pid].iron;
    const ck = D.smeltCheck(pid);
    ok('⑦ 无铁省：规则层拒绝开炉', !ck.ok && /没有铁矿脉/.test(ck.why), ck.why);
    const st = D.smeltOf(pid) || (D.smelt[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, iAcc: 9 });
    st.n = 1;
    D.setGold(pid, 50);
    const got = D.settleSmelt(pid, p.owner);
    ok('⑦ 无铁省：结算也不产铁', got === 0, 'got=' + got);
    A.resSim[pid].iron = saved;            // 还回去，后面还要用
    delete D.smelt[pid];

    /* 铁税：同档同系数、攒整落袋（把零头铺到 0.99，跑一回合就落 1 块） */
    const pid2 = T.b;
    const owner = w.provinces[pid2 - 1].owner;
    D.setTax(owner, 1);                 // 常规档：每 10 万人（= ironUnit）0.2 铁
    D.ironAcc[pid2] = 0.99;
    A.resSim[pid2].iron.stock = 0;
    A.resSim[pid2].iron.gone = false;
    A.resSim[pid2].iron.left = A.resSim[pid2].iron.n;
    D.settleTurn();
    if (D.evtPending()) D.evtPick(0);
    const F = D.flow[pid2];
    ok('⑦ 铁税照常收（常规档 0.2 铁 / 10 万人）', ((F && F.d.ironTax) || 0) >= 1,
      'ironTax=' + ((F && F.d.ironTax) || 0));
    ok('⑦ 铁税进的是省库的铁', D.stockOf(pid2, 'iron') >= 1, '库存 ' + D.stockOf(pid2, 'iron'));
    /* v18 追加二：金铁两个单位**同源**（都读 unitCn），rateDesc 里不该再出现
     * 硬编码的"每 200 万人" —— 一出现就说明又漏了一处。 */
    ok('⑦ 铁税与金税同单位（rateDesc 两处都写 10 万人）',
      /每 10 万人/.test(A.GOV.rateDesc(1)) && !/200 万/.test(A.GOV.rateDesc(1)) &&
      /0\.2 铁/.test(A.GOV.rateDesc(1)), A.GOV.rateDesc(1));
    return o;
  }));

  /* ---------------- 截图：改建钮 / 行内变身 ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug, T = window.__T;
    const st = D.smeltOf(T.a);
    st.site = 0;
    window.__openBld(T.a);
  });
  await sleep(500);
  const card = await page.evaluate(() => {
    const r = document.getElementById('info').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 940) };
  });
  await page.screenshot({ path: shot('smelt-row.png'), clip: card });

  /* 再看一眼"改建钮"的样子：把熔旧坊清掉，矿脉枯竭 */
  await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, T = window.__T;
    delete D.smelt[T.a];
    A.resSim[T.a].iron.gone = true;
    A.resSim[T.a].iron.left = 0;
    window.__openBld(T.a);
  });
  await sleep(400);
  await page.screenshot({ path: shot('smelt-build.png'), clip: card });

  /* ---------------- ⑧ 存档：SMELT / IRONACC 进档；老档不炸 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const T = window.__T;
    D.smelt[T.a] = { n: 2, site: 1, halted: false, mAcc: { iron: 0, gold: 0.5 }, iAcc: 0.25 };
    D.ironAcc[T.a] = 0.75;
    D.save(true);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(A.SAVE_KEY)); } catch (e) { /* file:// 禁 ls */ }
    ok('⑧ 存档里有 SMELT 块', !!raw && !!raw.SMELT, raw ? Object.keys(raw.SMELT || {}).length + ' 条' : '无档');
    ok('⑧ 熔旧坊状态进档（n / site / mAcc / iAcc）',
      !!raw && raw.SMELT[T.a] && raw.SMELT[T.a].n === 2 && raw.SMELT[T.a].site === 1 &&
      raw.SMELT[T.a].mAcc.gold === 0.5 && raw.SMELT[T.a].iAcc === 0.25,
      raw && JSON.stringify(raw.SMELT[T.a]));
    ok('⑧ 铁税零头进档', !!raw && raw.IRONACC && raw.IRONACC[T.a] === 0.75,
      raw && raw.IRONACC && raw.IRONACC[T.a]);
    ok('⑧ 没炉没工地的省不进档（瘦身）',
      !!raw && !Object.keys(raw.SMELT).some(k => !(raw.SMELT[k].n > 0 || raw.SMELT[k].site > 0)),
      raw && Object.keys(raw.SMELT).length + ' 条');
    ok('⑧ 存档版本号没升（缺字段只补默认）', !!raw && raw.v === A.SAVE_VER, raw && raw.v);
    /* 把 SMELT / IRONACC 摘掉，模拟"这一块之前的老档" */
    if (raw) {
      delete raw.SMELT; delete raw.IRONACC;
      try { localStorage.setItem(A.SAVE_KEY, JSON.stringify(raw)); } catch (e) { /* 忽略 */ }
    }
    return o;
  }));

  /* 老档读档：世界按同 seed 重建，SMELT 缺字段 → 空表，不炸 */
  await page.evaluate(() => { window.AO.resDebug.load(); });
  await sleep(3600);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    ok('⑧ 老档（无 SMELT）读得进', !!D.world(), '第 ' + D.turn() + ' 回合');
    ok('⑧ 老档读进来是"还没改过建"（空表）', Object.keys(A.resSmelt).length === 0,
      Object.keys(A.resSmelt).length + ' 条');
    ok('⑧ 老档读进来铁税零头也是空的', Object.keys(A.resIronAcc).length === 0,
      Object.keys(A.resIronAcc).length + ' 条');
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
