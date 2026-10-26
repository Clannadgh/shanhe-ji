/* =============================================================
 * test/forecast.js —— 干跑推演 + 建造参谋 的验收（DESIGN-FORECAST）
 *
 * 对着设计稿 §四 的清单逐条过：
 *   ① 同源：forecast 的受控分项和随后那次**真实结算**对得上（产出/维护）
 *   ② 关一座农场 → 预测立刻变（口粮掉一座的净产出，维护不升）
 *   ③ 满仓：省库顶格 → 干跑 kept=0、记浪费
 *   ④ 矿寿：储量只够 1~2 回合 → mineOut 拐点
 *   ⑤ 参谋两卡（先修/该盖）+ 满仓/矿寿/口粮缺三种文案 + 行尾 ✓▲
 *   ⑥ 实时：点步进器关一座 → 左栏 KPI 同帧变化（不关面板）
 *   ⑦ 新档第 1 回合就有预测（修掉"两回合白屏"）+ 存档零变化
 *   ⑧ FLOW.d.prod 落账：产出从 gain 里拆得开
 *
 * 跑法：node test/forecast.js
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
    document.getElementById('seed').value = 'forecast-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- 公共准备：选国、给足钱、走三个回合让流水有锚 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const cid = D.world().countries[0].id;
    D.choosePlayer(cid);
    D.balLoad(null);
    const cen = D.ensureCentral(cid);
    cen.iron = 999; cen.gold = 999;          // 别让"缴不起维护"来搅局
    for (let i = 0; i < 3; i++) D.nextTurn();
    ok('准备 三回合走完不炸', true, 'turn=' + window.AO.curTurn());
    return o;
  }));

  /* ---------------- ① 同源：干跑的受控分项 == 随后的真实结算 ----------------
   * 产出/维护两边都该精确一致（同一条算路）。事件/匪乱是随机的，
   * 撞上就隔一回合重试（最多 4 次）。 */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const cid = D.world().countries[0].id;
    let pass = false, note = '';
    for (let a = 0; a < 4 && !pass; a++) {
      const fc = AO.forecast(cid);
      D.nextTurn();
      const act = AO.balUI.actual(cid);
      const dP = Math.abs(fc.steps[1].prodI - act.prodI) + Math.abs(fc.steps[1].prodG - act.prodG);
      const dM = Math.abs(fc.steps[1].maintI - act.maintI) + Math.abs(fc.steps[1].maintG - act.maintG);
      note = '第' + (a + 1) + '次 产出差 ' + dP.toFixed(3) + ' 维护差 ' + dM.toFixed(3);
      pass = dP < 0.01 && dM < 0.01;
    }
    ok('① 干跑与结算同源（产出/维护精确一致）', pass, note);
    return o;
  }));

  /* ---------------- ② 关一座农场 → 预测立刻变 ----------------
   * 产量掉"一座的净产出"（毛产 3 − 居民吃的 40% 攒整，净 1~3）；
   * 维护只会降不会升。两次 forecast 之间只动了 KEEP，别的一个字没碰。 */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const c = D.world().countries[0], cid = c.id;
    let pid = 0;
    for (const p of c.provinces) { if (AO.resSim[p] && AO.resSim[p].grain) { pid = p; break; } }
    const farm = AO.resSim[pid].grain;
    farm.built = 3; farm.tiers = { 1: 3, 2: 0 }; farm.halted = false; farm.gone = false;
    farm.cool = 0; farm.left = 999; farm.stock = 0;
    farm.pAcc = 0; farm.eatAcc = 0; farm.mAcc = { iron: 0, gold: 0 };
    AO.rep.setKeep(pid, 'grain', null);

    const fc1 = AO.forecast(cid);
    const pf1 = fc1.provFood.find(x => x.pid === pid);
    AO.rep.setKeep(pid, 'grain', 2);          // 3 座留 2 座
    const fc2 = AO.forecast(cid);
    const pf2 = fc2.provFood.find(x => x.pid === pid);
    const drop = pf1.food - pf2.food;
    ok('② 关一座：该省口粮产出立刻掉一座的量（净 1~3）',
      drop >= 1 && drop <= 3, '掉 ' + drop.toFixed(2) + '（毛产 3，吃 40% 攒整）');
    ok('② 关一座：全国预测口粮同步变少', fc2.steps[1].fProd < fc1.steps[1].fProd,
      f(fc1.steps[1].fProd) + ' → ' + f(fc2.steps[1].fProd));
    ok('② 关一座：维护只降不升',
      fc2.steps[1].maintI <= fc1.steps[1].maintI + 1e-9 &&
      fc2.steps[1].maintG <= fc1.steps[1].maintG + 1e-9,
      '铁 ' + f(fc1.steps[1].maintI) + '→' + f(fc2.steps[1].maintI) +
      ' / 金 ' + f(fc1.steps[1].maintG) + '→' + f(fc2.steps[1].maintG));
    ok('② 残差 R 不被开关动到（那是杂项的锚，不是开关的事）',
      Math.abs(fc2.R.i - fc1.R.i) < 1e-9 && Math.abs(fc2.R.g - fc1.R.g) < 1e-9);
    function f(v) { return (+v).toFixed(2); }
    return o;
  }));

  /* ---------------- ③ 满仓：省库顶格 → 产出进不了库 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const c = D.world().countries[0];
    let pid = 0;
    for (const p of c.provinces) {
      const sim = AO.resSim[p];
      if (sim && sim.grain && D.repLive(p, 'granary').built === 0) { pid = p; break; }
    }
    const farm = AO.resSim[pid].grain;
    farm.built = 2; farm.tiers = { 1: 2, 2: 0 }; farm.halted = false; farm.gone = false;
    farm.cool = 0; farm.left = 999; farm.pAcc = 0; farm.eatAcc = 0;
    farm.stock = 150;                          // 顶格（没粮仓上限就是 150）
    AO.rep.setKeep(pid, 'grain', null);
    if (AO.resSim[pid].fish) AO.rep.setKeep(pid, 'fish', 0);   // food 是粮+渔的合计，渔港也得闭嘴
    const fc = AO.forecast(c.id);
    const pf = fc.provFood.find(x => x.pid === pid);
    ok('③ 省库顶格：干跑这一省的口粮产出 = 0（全浪费在仓外）', pf.food === 0, 'food=' + pf.food);
    ok('③ 浪费被记下来（8 回合推演累计 > 0）', (fc.waste.grain || 0) > 0,
      '浪费 ' + (fc.waste.grain || 0).toFixed(1));
    return o;
  }));

  /* ---------------- ④ 矿寿：储量只够一两回合 → 拐点 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const c = D.world().countries[0];
    let pid = 0;
    for (const p of c.provinces) { if (AO.resSim[p] && AO.resSim[p].iron) { pid = p; break; } }
    const mine = AO.resSim[pid].iron;
    mine.built = 1; mine.tiers = { 1: 1, 2: 0 }; mine.halted = false; mine.gone = false;
    mine.cool = 0; mine.pAcc = 0; mine.mAcc = { iron: 0, gold: 0 };
    mine.left = D.repLive(pid, 'iron').gross;   // 恰好一回合的毛产
    AO.rep.setKeep(pid, 'iron', null);
    const fc = AO.forecast(c.id);
    const mo = fc.mineOut.filter(x => x.key === 'iron' && x.pid === pid);
    ok('④ 储量见底：干跑 1~2 回合内标记采空', mo.length === 1 && mo[0].turn >= 1 && mo[0].turn <= 2,
      fc.mineOut.map(x => x.name + '#' + x.turn).join(',') || '无');
    return o;
  }));

  /* ---------------- ⑤ 参谋两卡 + 三种文案 + 行尾 ✓▲ ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const c = D.world().countries[0], cid = c.id;
    const U = D.repUI();
    U.open();
    U.state.scope = 'all';

    /* ⑤a 满仓（接着 ③ 的状态走一回合，让 d.cap 落实测） */
    D.nextTurn();
    U.render();
    const body = document.getElementById('balBody').textContent;
    ok('⑤ 建议拆成两卡：先修 / 该盖',
      body.indexOf('先修（开关）') >= 0 && body.indexOf('该盖（建造）') >= 0);
    ok('⑤ 满仓文案：写得出"满仓浪费"和"别再往死里盖"', body.indexOf('满仓浪费') >= 0);
    ok('⑤ 维修行尾的 ▲过量（农场行）',
      !!document.querySelector('#rpPrioList .rprow[data-kind="grain"] .bm.over'));

    /* ⑤b 口粮缺（全国农场/渔港全停 → 「该盖」给省名 + 座数） */
    AO.rep.setKeepRatio(cid, 'grain', 0);
    AO.rep.setKeepRatio(cid, 'fish', 0);
    U.render();
    const body2 = document.getElementById('balBody').textContent;
    ok('⑤ 口粮缺：该盖卡给出省名与座数',
      body2.indexOf('座') >= 0 && body2.indexOf('农场') >= 0 && body2.indexOf('该盖') >= 0);
    ok('⑤ 先修卡分得清"自己关的"（让你开回来，不是让你去盖）',
      body2.indexOf('开回来') >= 0 || body2.indexOf('停着') >= 0);
    AO.rep.setKeepRatio(cid, 'grain', 1);
    AO.rep.setKeepRatio(cid, 'fish', 1);

    /* ⑤c 矿寿（接着 ④ 的状态：储量 1 回合 → 小结写"采空"） */
    U.render();
    ok('⑤ 矿寿文案：小结写得出"采空"回合',
      document.getElementById('balBody').textContent.indexOf('采空') >= 0);
    return o;
  }));

  /* ---------------- ⑥ 实时：点步进器关一座 → 左栏同帧变 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const c = D.world().countries[0];
    let pid = 0;
    for (const p of c.provinces) { if (AO.resSim[p] && AO.resSim[p].grain) { pid = p; break; } }
    const farm = AO.resSim[pid].grain;
    farm.built = 3; farm.tiers = { 1: 3, 2: 0 }; farm.halted = false; farm.gone = false;
    farm.cool = 0; farm.left = 999;
    AO.rep.setKeep(pid, 'grain', null);

    const U = D.repUI();
    U.open();
    U.state.scope = 'all';
    U.render();
    const chartsBefore = document.querySelectorAll('#balBody .bchart').length;
    const kpiBefore = document.getElementById('balKpi').textContent;

    /* 展开「农场」行，点这座城的 − 一下（面板整块重画，引用要重取） */
    document.querySelector('#rpPrioList .rprow[data-kind="grain"] button[data-act="exp"]').click();
    const city = () => document.querySelector(
      '#rpPrioList .rpcity[data-kind="grain"] .rpc[data-pid="' + pid + '"]');
    city().querySelector('button[data-d="-1"]').click();

    ok('⑥ 点 − 之后 KEEP 真的变了', AO.rep.keep(pid, 'grain') === 2, String(AO.rep.keep(pid, 'grain')));
    ok('⑥ 面板还开着（不是点一下就关）', document.getElementById('repPanel').classList.contains('on'));
    ok('⑥ 左栏 KPI 同帧变化（关一座，预测立刻重算）',
      document.getElementById('balKpi').textContent !== kpiBefore);
    ok('⑥ 图还是那些图（重画不是重置）',
      document.querySelectorAll('#balBody .bchart').length === chartsBefore,
      chartsBefore + ' 张');
    AO.rep.setKeep(pid, 'grain', null);
    return o;
  }));

  /* ---------------- ⑧ d.prod 落账（放在 ⑦ 之前：⑦ 要重开世界） ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const cid = D.world().countries[0].id;
    const a = D.balUI().actual(cid);
    ok('⑧ 有流水可对账', a.on);
    ok('⑧ d.prod 记到了产出（铁金合计 > 0）', a.prodI + a.prodG > 0,
      '铁 ' + a.prodI.toFixed(1) + ' / 金 ' + a.prodG.toFixed(1));
    ok('⑧ 产出 ≤ 落袋（gain 里还有涓流和卖货，d.prod 只是产出那一块）',
      a.gainI + 1e-9 >= a.prodI && a.gainG + 1e-9 >= a.prodG,
      'gain 铁 ' + a.gainI.toFixed(1) + ' ≥ prod 铁 ' + a.prodI.toFixed(1));
    return o;
  }));

  /* ---------------- 截图：左平衡（推演线）/ 右维修（✓▲）同屏 ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug;
    document.getElementById('info').classList.remove('on');
    const U = D.repUI();
    U.open();
    U.state.scope = 'all';
    U.render();
  });
  await sleep(700);
  await page.screenshot({ path: shot('forecast-panel.png') });

  /* ---------------- ⑦ 新档第 1 回合就有预测 + 存档零变化 ---------------- */
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    try {
      document.getElementById('prov').value = 120;
      document.getElementById('ctry').value = 6;
      document.getElementById('seed').value = 'forecast-fresh';
      document.getElementById('gen').click();
    } catch (e) { o.push({ name: '⑦ 重开世界', ok: false, detail: e.message }); return o; }
    return o;
  }));
  await sleep(2600);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    D.choosePlayer(D.world().countries[0].id);
    const U = D.repUI();
    U.open();
    U.state.scope = 'all';
    U.render();
    const kpi = document.getElementById('balKpi').textContent.trim();
    const body = document.getElementById('balBody').textContent;
    ok('⑦ 新档一回合没走：KPI 就有数（不是白屏等采样）', kpi.length > 8, kpi.slice(0, 40));
    ok('⑦ 推演线画得出来（不需要历史）',
      document.querySelectorAll('#balBody .bchart').length >= 1,
      document.querySelectorAll('#balBody .bchart').length + ' 张');
    ok('⑦ 老的"还没攒够数据"空屏没了', body.indexOf('还没攒够数据') < 0);
    ok('⑦ 免责写明了"杂项未计入"', body.indexOf('未计入') >= 0);
    const keys = Object.keys(D.balSave()).sort();
    ok('⑦ 存档零变化（还是 H + range，干跑不落盘）',
      keys.length === 2 && keys[0] === 'H' && keys[1] === 'range', keys.join(','));
    D.balLoad(null);
    return o;
  }));

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
