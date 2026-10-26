/* =============================================================
 * test/repair.js —— 保留座数 / 维修 / 平衡面板 的验收
 *
 * 对着这次改动的验收清单逐条过：
 *   ① 面板开得出来、徽标数对得上；每一类一行，行上能展开分城
 *   ② 保留 0 座：不扣钱、不攒欠账、产量归零，但**不失修**
 *   ③ 保留 N 座：维护费和产量都按 N 算（不是按已建座数）
 *   ④ 本省没料 → 中央拨款顶上；拨款见底 → 停产
 *   ⑤ 手动「修」：扣 3 倍维护 → 失修标记与欠账零头一起清掉
 *   ⑥ 「停修」：失修的暂停缴费；没失修的照常缴费（不能变成免费养着）
 *   ⑦ 维修队已删（2026-10）：接口/面板/存档字段都不在了，老档带 CREW 不炸
 *   ⑧ 存档往返：保留座数 / 停修名单都存得回来
 *   ⑨ 平衡面板：四张图 + 采样 + 外推
 *
 * 跑法：node test/repair.js
 * 小世界（120 省 / 6 国），十几秒。
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
    document.getElementById('seed').value = 'repair-spec-2';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- ① 面板打得开 + 徽标 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const U = D.repUI();
    U.open();
    ok('① 维修面板能打开', document.getElementById('repPanel').classList.contains('on'));
    ok('① 面板有三块（国库/保留座数/失修清单）',
      !!document.getElementById('rpTreasury') && !!document.getElementById('rpPrioList') &&
      !!document.getElementById('rpBadList'));
    const rows = document.querySelectorAll('#rpPrioList .rprow');
    ok('① 保留座数表列出全部类别（含军工与城墙）',
      rows.length === window.AO.rep.kinds().length, rows.length + ' 行 / ' +
      window.AO.rep.kinds().length + ' 类');
    ok('① 每一行都有「展开分城」的钮',
      rows.length > 0 && Array.from(rows).every(r => !!r.querySelector('button[data-act="exp"]')));
    ok('① 顶栏只有一颗「经营」钮（维修 + 平衡合成一页）',
      !!document.getElementById('repBtn') && !document.getElementById('balBtn'));
    ok('① 全屏两栏：左边平衡、右边维修（同屏可见，不是页签）',
      !!document.getElementById('rpTabBal') && !!document.getElementById('rpTabRep') &&
      !!document.getElementById('balKpi') && !!document.getElementById('rpPrioList'));
    return o;
  }));

  /* ---------------- ② 保留 0 座：不花钱、不产出、不失修 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    const c = w.countries[0];
    const pid = c.provinces[0];
    /* 造三座农场：直接改状态（不走建造，省掉几个回合） */
    const bag = AO.resSim[pid];
    const farm = bag.grain;
    farm.built = 3;
    farm.tiers = { 1: 3, 2: 0 };
    farm.halted = false;
    farm.mAcc = { iron: 0, gold: 0 };
    const cen0 = D.ensureCentral(c.id);
    cen0.iron = 400; cen0.gold = 400;

    const pairAll = D.maintPair(pid, 'grain', c.id);
    ok('② 全开时维护 = 3 座的量', Math.abs(pairAll.all.iron - pairAll.now.iron) < 1e-9,
      '全开 ' + pairAll.all.iron.toFixed(2) + ' / 现在 ' + pairAll.now.iron.toFixed(2));

    AO.rep.setKeep(pid, 'grain', 0);
    ok('② 保留 0 座后维护归零',
      D.maintPair(pid, 'grain', c.id).now.iron === 0, JSON.stringify(D.maintPair(pid, 'grain', c.id).now));
    ok('② 保留 0 座后产量归零', D.activeTiers(pid, 'grain', farm)[1] === 0);
    ok('② 保留 0 座 = 主动停（不是失修）', D.keepOff(pid, 'grain') === true);

    const iron0 = cen0.iron + (bag.iron ? bag.iron.stock : 0);
    const live = D.repLive(pid, 'grain');
    const before = JSON.stringify(farm.mAcc);
    const paid = AO.repPayMaint(farm.mAcc, live.due, c.id, pid, 'grain');
    ok('② 停着的座：缴费直接返回"付清"', paid === true);
    ok('② 停着的座：中央与省库一分未动',
      (cen0.iron + (bag.iron ? bag.iron.stock : 0)) === iron0,
      '国库铁 ' + cen0.iron + '（扣前合计 ' + iron0 + '）');
    ok('② 停着的座：不攒欠账', JSON.stringify(farm.mAcc) === before, JSON.stringify(farm.mAcc));
    AO.rep.setKeep(pid, 'grain', null);       // 收工：恢复全开
    return o;
  }));

  /* ---------------- ③ 保留 N 座：维护与产量都按 N 算 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), c = w.countries[0];
    const pid = c.provinces[0], bag = AO.resSim[pid], farm = bag.grain;
    farm.built = 3; farm.tiers = { 1: 2, 2: 1 }; farm.halted = false;

    /* 2 座 Lv1（各 0.2）+ 1 座 Lv2（0.4）= 满额 0.8 铁。
     * 留 1 座 = 留那座 Lv2 = 0.4；留 2 座 = Lv2 + 一座 Lv1 = 0.6；全开 = 0.8。
     * 断言用"具体数"而不是"比例"—— 先保 Lv2 会让比例不是线性的，
     * 写成 2/3 反而会把正确行为判成错（这就是第一版测试踩的坑）。 */
    AO.rep.setKeep(pid, 'grain', 1);
    const k1 = D.maintPair(pid, 'grain', c.id).now.iron;
    AO.rep.setKeep(pid, 'grain', 2);
    const k2 = D.maintPair(pid, 'grain', c.id).now.iron;
    AO.rep.setKeep(pid, 'grain', null);
    const k3 = D.maintPair(pid, 'grain', c.id).now.iron;
    ok('③ 维护费按保留座数算（留 1 座只收那一座的钱）',
      Math.abs(k1 / k3 - 0.5) < 0.01, k1.toFixed(2) + ' / ' + k3.toFixed(2));
    ok('③ 留 2 座 = Lv2 + 一座 Lv1',
      Math.abs(k2 / k3 - 0.75) < 0.01, k2.toFixed(2) + ' / ' + k3.toFixed(2));
    ok('③ 停掉的座真的不收费（1 < 2 < 3 单调）', k1 < k2 && k2 < k3,
      [k1, k2, k3].map(v => v.toFixed(2)).join(' < '));

    /* 先保 Lv2：3 座里 1 座 Lv2 + 2 座 Lv1，留 1 座时该留的是那座 Lv2 */
    AO.rep.setKeep(pid, 'grain', 1);
    const t1 = D.activeTiers(pid, 'grain', farm);
    ok('③ 留 1 座时先保 Lv2', t1[2] === 1 && t1[1] === 0, JSON.stringify(t1));
    AO.rep.setKeep(pid, 'grain', null);
    return o;
  }));

  /* ---------------- ④ 中央拨款：本省没料时顶上，拨款见底就停产 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), c = w.countries[0];
    const pid = c.provinces[0], bag = AO.resSim[pid], farm = bag.grain;
    const cen = D.ensureCentral(c.id);
    const reset = () => { farm.halted = false; farm.mAcc = { iron: 0, gold: 0 }; };
    /* 本省铁/金清空：能不能付只看中央批不批 */
    if (bag.iron) bag.iron.stock = 0;
    if (bag.gold) bag.gold.stock = 0;
    const due = D.repLive(pid, 'grain').due;

    cen.iron = 500; cen.gold = 500;
    AO.rep.turnStart(c.id);                       // 批拨款（保底 20）
    reset();
    let paid = true;
    for (let t = 0; t < 5; t++) paid = AO.repPayMaint(farm.mAcc, due, c.id, pid, 'grain');
    ok('④ 本省无料：中央拨款顶上，付得清', paid === true, '拨款剩 ' + AO.rep.reserve().toFixed(1));
    ok('④ 确实花了中央', cen.iron < 500 || cen.gold < 500,
      '铁 ' + cen.iron.toFixed(1) + ' 金 ' + cen.gold.toFixed(1));

    /* 拨款被抽干 → 付不起（这是"中央也没钱了"的那条线） */
    AO.rep.turnStart(c.id);
    const reserve = AO.rep.reserve();
    AO.rep.takePool(reserve);                     // 手动抽干
    reset();
    let paid2 = true;
    for (let t = 0; t < 5; t++) paid2 = AO.repPayMaint(farm.mAcc, due, c.id, pid, 'grain');
    ok('④ 拨款见底：付不起（停产）', paid2 === false, '拨款剩 ' + AO.rep.reserve().toFixed(1));
    return o;
  }));

  /* ---------------- ⑤ 手动修：扣 3 倍、清标记与零头 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), c = w.countries[0];
    const pid = c.provinces[0], bag = AO.resSim[pid], farm = bag.grain;
    const cen = D.ensureCentral(c.id);
    cen.iron = 500; cen.gold = 500;
    if (bag.iron) bag.iron.stock = 50;
    if (bag.gold) bag.gold.stock = 50;
    AO.rep.setKeep(pid, 'grain', null);
    farm.halted = true;
    farm.mAcc = { iron: 39, gold: 39 };             // 攒了一笔大欠账
    const cost = AO.rep.cost(pid, 'grain');
    const due = D.repLive(pid, 'grain').due;
    const dueSum = (due.iron || 0) + (due.gold || 0);
    const costSum = cost.iron + cost.gold;
    ok('⑤ 维修价 = 维护 × 3（向上取整）', costSum >= dueSum * 3 && costSum < dueSum * 3 + 2,
      '价 ' + costSum + ' / 三倍维护 ' + (dueSum * 3).toFixed(2));
    const r = AO.rep.repair(pid, c.id, 'grain');
    ok('⑤ 修好返回 ok', r.ok === true, r.why || '');
    ok('⑤ 失修标记清掉', farm.halted === false);
    ok('⑤ 欠账零头清掉（否则下回合立刻再停产）', farm.mAcc.iron === 0 && farm.mAcc.gold === 0,
      JSON.stringify(farm.mAcc));
    /* 付不起时必须一分不扣 */
    cen.iron = 0; cen.gold = 0;
    if (bag.iron) bag.iron.stock = 0;
    if (bag.gold) bag.gold.stock = 0;
    farm.halted = true;
    const before = { i: cen.iron, g: cen.gold };
    const r2 = AO.rep.repair(pid, c.id, 'grain');
    ok('⑤ 钱不够：返回失败且一分不扣',
      r2.ok === false && cen.iron === before.i && cen.gold === before.g, r2.why);
    return o;
  }));

  /* ---------------- ⑥ 停修：只停"已经烂着的" ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), c = w.countries[0];
    const pid = c.provinces[0], bag = AO.resSim[pid], farm = bag.grain;
    const cen = D.ensureCentral(c.id);
    cen.iron = 500; cen.gold = 500;
    if (bag.iron) bag.iron.stock = 50;
    if (bag.gold) bag.gold.stock = 50;
    farm.halted = true; farm.mAcc = { iron: 0, gold: 0 };
    AO.rep.setStopped(pid, 'grain', true);
    const p1 = AO.repPayMaint(farm.mAcc, D.repLive(pid, 'grain').due, c.id, pid, 'grain');
    ok('⑥ 停修 + 已失修：不缴费', p1 === true && farm.mAcc.iron === 0);
    /* 没失修的照常缴费：否则"停修"就是免费养着 */
    farm.halted = false; farm.mAcc = { iron: 0, gold: 0 };
    for (let t = 0; t < 5; t++) AO.repPayMaint(farm.mAcc, { iron: 0.2, gold: 0.2 }, c.id, pid, 'grain');
    ok('⑥ 停修 + 没失修：照常缴费（停修不等于白养）', farm.mAcc.iron > 0 || bag.iron.stock < 50,
      '欠账零头 ' + farm.mAcc.iron.toFixed(2) + ' · 省库铁 ' + (bag.iron ? bag.iron.stock : 0));
    AO.rep.setStopped(pid, 'grain', false);
    return o;
  }));

  /* ---------------- ⑦ 维修队已删（2026-10）：干跑预测上线后自动修反而搅账 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    ok('⑦ 面板上没有维修队那块了', !document.getElementById('rpCrew') &&
      document.getElementById('repPanel').textContent.indexOf('维修队') < 0);
    ok('⑦ 接口下线（crewSet/crewSweep/crewMap 都没了）',
      AO.rep.crewSet === undefined && AO.rep.crewSweep === undefined && AO.rep.crewMap === undefined);
    ok('⑦ 存档不再写 CREW 字段', !('CREW' in AO.repSave()));
    ok('⑦ 老档带 CREW / PR 不炸（不认识就不读）', (() => {
      try { AO.repLoad({ KEEP: {}, STOP: {}, CREW: { 1: 'mid' }, PR: { 1: { grain: 'p1' } } }); return true; }
      catch (e) { return false; }
    })());
    return o;
  }));

  /* ---------------- ⑧ 存档往返 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world(), c = w.countries[0];
    const pid = c.provinces[0];
    AO.rep.setKeep(pid, 'fish', 1);
    AO.rep.setKeep(pid, 'school', 0);
    AO.rep.setStopped(pid, 'salt', true);
    const raw = AO.repSave();
    /* 存档必须是**快照**：后面继续改局内状态，不能把刚存下来的那份一起改写 */
    AO.rep.setKeep(pid, 'fish', null);
    ok('⑧ 存档是快照（改局内状态不影响已存的 payload）',
      raw.KEEP[pid] && raw.KEEP[pid].fish === 1,
      'payload=' + JSON.stringify(raw.KEEP));
    AO.repLoad(JSON.parse(JSON.stringify(raw)));   // 过一遍 JSON：模拟进存档再读回来
    ok('⑧ 保留座数存得回来', AO.rep.keep(pid, 'fish') === 1, String(AO.rep.keep(pid, 'fish')));
    ok('⑧ 「全停」存得回来', AO.rep.keep(pid, 'school') === 0, String(AO.rep.keep(pid, 'school')));
    ok('⑧ 停修名单存得回来', AO.rep.stopped(pid, 'salt') === true);
    ok('⑧ 老档（REP = undefined）不炸',
      (() => { try { AO.repLoad(undefined); return true; } catch (e) { return false; } })());
    ok('⑧ 老档读进来全按默认（全开）', AO.rep.keep(pid, 'fish') === null);
    /* 老档里带 PR（四档表）也不该炸：那一块已经不存在了，不认识就当没读 */
    ok('⑧ 带旧 PR / CREW 字段的老档不炸', (() => {
      try { AO.repLoad({ PR: { 1: { grain: 'p1' } }, STOP: {}, CREW: { 1: 'mid' } }); return true; }
      catch (e) { return false; }
    })());
    return o;
  }));

  /* ---------------- ⑨ 平衡栏（和维修同屏，左边那一栏） ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    D.choosePlayer(D.world().countries[0].id);
    D.balLoad(null);                       // 从空曲线起步
    for (let i = 0; i < 6; i++) D.nextTurn();
    D.repUI().open();
    const P = document.getElementById('repPanel');
    const bal = document.getElementById('rpTabBal'), rep = document.getElementById('rpTabRep');
    const charts = document.querySelectorAll('#balBody .bchart').length;
    ok('⑨ 全屏「经营」页打得开', P.classList.contains('on'));
    ok('⑨ 两栏同屏：平衡和维修都没被藏起来',
      getComputedStyle(bal).display !== 'none' && getComputedStyle(rep).display !== 'none');
    ok('⑨ 左边是平衡、右边是维修（横向排列，不是上下堆）',
      bal.getBoundingClientRect().left < rep.getBoundingClientRect().left &&
      Math.abs(bal.getBoundingClientRect().top - rep.getBoundingClientRect().top) < 4,
      '平衡 x=' + Math.round(bal.getBoundingClientRect().left) +
      ' 维修 x=' + Math.round(rep.getBoundingClientRect().left));
    ok('⑨ 画出四张图（净额/粮食/库存/失修）', charts === 4, charts + ' 张');
    /* 图宽要跟着左栏走：全屏之后左栏有 900+ px，还按 452 画就会被拉变形 */
    const svg = document.querySelector('#balBody .bchart');
    const vb = svg ? (svg.getAttribute('viewBox') || '').split(' ') : [];
    const box = svg ? svg.getBoundingClientRect().width : 0;
    ok('⑨ 图的宽度跟着左栏自适应（不会被横向拉变形）',
      svg && Math.abs(+vb[2] - box) < 24, 'viewBox 宽 ' + vb[2] + ' / 实际 ' + Math.round(box));
    ok('⑨ 顶部四格有数', document.getElementById('balKpi').textContent.trim().length > 8);
    /* 推演批（DESIGN-FORECAST）起，外推换成了按当前配置的干跑 ——
     * 文案也从"照这样再走"改成了"照当前配置再走"（不再是历史平均）。 */
    ok('⑨ 有"照当前配置再走 N 回合"的预测',
      document.getElementById('balBody').textContent.indexOf('照当前配置再走') >= 0);
    ok('⑨ 至少给出一条建议',
      document.querySelectorAll('#balBody .badv1').length >= 1,
      document.querySelectorAll('#balBody .badv1').length + ' 条');
    const H = D.balSave().H;
    const keys = Object.keys(H);
    ok('⑨ 采样按国记账', keys.length >= 1 && H[keys[0]].length >= 3,
      keys.map(k => k + ':' + H[k].length).join(' '));
    /* 区间开关只在平衡栏、范围开关只在维修栏 */
    ok('⑨ 12/24/48 在平衡栏、本省/全国 在维修栏',
      !!bal.querySelector('#balRange') && !!rep.querySelector('#rpScope'));
    return o;
  }));

  /* ---------------- ⑩ 面板上的点击真的改到了 KEEP ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const c = D.world().countries[0];
    /* 造一座"多座"的城（步进器）和一座"单座"的城（开关） */
    const multi = c.provinces[0], single = c.provinces[1];
    const gm = AO.resSim[multi].grain, gs = AO.resSim[single].grain;
    gm.built = 3; gm.tiers = { 1: 3, 2: 0 }; gm.halted = false;
    gs.built = 1; gs.tiers = { 1: 1, 2: 0 }; gs.halted = false;
    AO.rep.setKeep(multi, 'grain', null);
    AO.rep.setKeep(single, 'grain', null);

    const U = D.repUI();
    U.open();
    U.state.scope = 'all';
    U.render();
    /* 展开「农场」那一行 */
    const row = document.querySelector('#rpPrioList .rprow[data-kind="grain"]');
    ok('⑩ 农场那一行在表上', !!row);
    row.querySelector('button[data-act="exp"]').click();
    const box = document.querySelector('#rpPrioList .rpcity[data-kind="grain"]');
    ok('⑩ 点 ▾ 展开出分城明细', !!box);

    /* 多座的那座城：点 − 一次 → keep = built-1
     * 注意：每点一下面板都会**整块重画**，旧的 DOM 引用立刻失效 ——
     * 所以每次都要重新查一遍（这也是玩家视角：他看到的永远是重画后的表）。 */
    const cityOf = (pid) => document.querySelector(
      '#rpPrioList .rpcity[data-kind="grain"] .rpc[data-pid="' + pid + '"]');
    cityOf(multi).querySelector('button[data-d="-1"]').click();
    ok('⑩ 点 − 真的减了一座', AO.rep.keep(multi, 'grain') === 2, String(AO.rep.keep(multi, 'grain')));
    cityOf(multi).querySelector('button[data-d="1"]').click();
    ok('⑩ 点 + 加回来（满额就清成"全开"）', AO.rep.keep(multi, 'grain') === null,
      String(AO.rep.keep(multi, 'grain')));

    /* 单座的那座城：是开关，不是步进器 */
    const cs = cityOf(single);
    ok('⑩ 只有一座的城给的是「开/停」开关',
      !!cs.querySelector('button[data-act="onoff"]') && !cs.querySelector('button[data-d="-1"]'));
    cs.querySelector('button[data-act="onoff"]').click();
    ok('⑩ 点「停」→ 保留 0 座', AO.rep.keep(single, 'grain') === 0, String(AO.rep.keep(single, 'grain')));
    cityOf(single).querySelector('button[data-act="onoff"]').click();
    ok('⑩ 再点一下恢复全开', AO.rep.keep(single, 'grain') === null, String(AO.rep.keep(single, 'grain')));

    /* 小计那一行要写出"在跑 x / y 座" */
    const sum = document.querySelector('#rpPrioList .rpcity[data-kind="grain"] .rpcsum');
    ok('⑩ 分城小计写出了"在跑 x / y 座"', !!sum && /在跑\s*\d+\s*\/\s*\d+\s*座/.test(sum.textContent),
      sum ? sum.textContent.trim().slice(0, 40) : '');
    return o;
  }));

  /* ---------------- 截图：全屏「经营」页（左平衡 / 右维修） ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug;
    document.getElementById('info').classList.remove('on');
    const cc = document.getElementById('country');
    if (cc) cc.classList.remove('on');
    D.repUI().open();
    D.repUI().state.scope = 'all';
    D.repUI().render();
    /* 展开第一类有建筑的行，截一张"分城明细"的图 */
    const rows = document.querySelectorAll('#rpPrioList .rprow:not(.empty)');
    if (rows[1]) rows[1].querySelector('button[data-act="exp"]').click();
  });
  await sleep(700);
  await page.screenshot({ path: shot('operate-panel.png') });

  /* ---------------- 汇总 ---------------- */
  for (const c of out) {
    console.log((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + '  —  ' + c.detail);
  }
  const pass = out.every(c => c.ok) && !errors.length;
  if (errors.length) console.log('\n运行时错误：\n' + errors.join('\n'));
  console.log('\n总体:', pass ? '全部通过' : '存在失败项',
    '（' + out.filter(c => c.ok).length + ' / ' + out.length + '）');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
