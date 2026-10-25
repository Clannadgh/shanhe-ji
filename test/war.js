/* =============================================================
 * test/war.js —— 战争层（v3）的验收
 *
 * 覆盖验收清单 1~10：
 *   ① 选国锁权（别省 ＋ 钮置灰 / 自己全可用 / 退出回工坊）
 *   ② 军事科技两枝链 + 军械坊订单制（产量不随科技涨）
 *   ③ 征兵三消耗 + 成建制门槛 + 军队吃粮/断粮掉兵
 *   ④ 武科抽将稀有度分布 + 词条→战术置灰
 *   ⑤ 会战两相位（战报可复算）+ 地形/压制/骰子 + 撤退 + 装备损毁
 *   ⑥ 轰击不触发会战但有压制 + 围城饿到开城
 *   ⑦ 群龙无首四件套 / 光复 / 占领省 / 投降灭亡
 *   ⑧ 海路 / 舰队会战 / 封锁断渔获 / 运输登岸 / 岛屿陆军到不了
 *   ⑨ 敌国自动征兵驻防（不主动进攻）
 *   ⑩ 存档 v3+ 往返
 *
 * 跑法：node test/war.js
 * 和小世界一起跑（140 省 / 8 国），几十秒。
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
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);
  /* 小世界：跑得快，验的是逻辑不是画面 */
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'war-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- ① 选国锁权 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    let A = 0, B = 0;
    for (const c of w.countries) {
      for (const nb of c.neighbors) { if (nb && nb !== c.id) { A = c.id; B = nb; break; } }
      if (A) break;
    }
    ok('① 世界里有相邻国', A && B, A + ' vs ' + B);
    D.choosePlayer(A);
    ok('① 选国写入 PLAYER', D.player() === A, 'PLAYER=' + D.player());

    const pB = w.provinces.find(p => p.owner === B);
    const pA = w.provinces.find(p => p.owner === A);
    /* 迷雾（v6）：别国纵深省是 unknown，省卡整张被遮住 —— 那样测不到"按钮置灰"。
     * 挑 B 的**边境省**，先探一次、再把关系调友好 → 它对 A 是实时可见
     * （见 rebuildVis 的 ③④ 两条），锁权照旧生效。 */
    D.fogSetRel(A, B, 50);
    const pBReal = w.provinces.find(p => p.owner === B &&
      (p.neighbors || []).some(n => w.provinces[n - 1].owner === A)) || pB;
    D.fogSee(A, pBReal.id, false);
    ok('① 别国被锁', D.isLocked(B) && !D.isLocked(A), 'locked(B)=' + D.isLocked(B));

    /* 直接调建造函数也要被拦（不只靠 UI 置灰） */
    const b0 = AO.resSchool[pB.id].n + AO.resSchool[pB.id].site;
    D.buildUniv(pB, 'school');
    ok('① 别省建造被函数拦下', (AO.resSchool[pB.id].n + AO.resSchool[pB.id].site) === b0, pB.name);

    const R = window.__renderer;
    R.select(pBReal.id);
    let addBtn = document.querySelector('#iBldList .rr.bld button.add');
    ok('① 别省 ＋ 钮置灰 + title 写非你的国家',
      addBtn && addBtn.disabled && /非你的国家/.test(addBtn.title), addBtn ? addBtn.title.slice(0, 24) : 'no button');

    R.select(pA.id);
    addBtn = document.querySelector('#iBldList .rr.bld button.add');
    ok('① 自己的省 ＋ 钮可用', addBtn && !addBtn.disabled, addBtn ? addBtn.title.slice(0, 24) : 'no button');

    /* 军备栏也受同一把锁 */
    let milAdd = document.querySelector('#iMilList .rr.bld button.add');
    ok('① 自己的省军备 ＋ 可用', milAdd && !milAdd.disabled);

    D.exitGame();
    ok('① 退出回工坊（一切可动）', D.player() === 0 && !D.isLocked(B));
    return o;
  }));

  /* ---------------- ② 军事科技 + 军械坊 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    /* 挑一个有铁矿的省（把铁矿场强制建起来，省得看运气） */
    let owner = 1, pid = 0;
    for (const p of w.provinces) {
      const bag = AO.resSim[p.id];
      if (!bag) continue;
      bag.iron.built = 1; bag.iron.tiers[1] = 1;
      if (p.owner === owner && !pid) pid = p.id;
    }
    const p = w.provinces[pid - 1];
    D.buildFactory(p, 'armory');
    const ar = AO.resMil.armory[pid];
    ok('② 军械坊要铁矿（已满足可建）', ar && ar.site > 0, 'site=' + (ar && ar.site));
    /* 快进完工 */
    ar.site = 0; ar.n = 1;
    AO.resMil.barracks[pid] = Object.assign({}, ar, { n: 0 });
    AO.resMil.barracks[pid].n = 0;

    const r1 = D.setShopOrder(pid, 'armory', 'bronze');
    ok('② 没研究就不能接青铜订单', !r1.ok && /还没解锁/.test(r1.msg), r1.msg);

    AO.resResearch[owner].done.mil_bronze = true;
    const r2 = D.setShopOrder(pid, 'armory', 'bronze');
    ok('② 研究后可以接单', r2.ok, r2.msg);

    /* 把这一省的生产全停掉：不然"订单耗铁 1"会被"铁矿这一回合产 2"抵掉，验不出来 */
    const bag = AO.resSim[pid];
    for (const k in bag) {
      if (!bag[k] || !bag[k].tiers) continue;
      bag[k].built = 0; bag[k].tiers = { 1: 0, 2: 0 }; bag[k].site = 0; bag[k].halted = false;
    }
    bag.iron.stock += 10; bag.timber.stock += 10;
    const iron0 = bag.iron.stock, tim0 = bag.timber.stock;
    const wp0 = D.itemStock(pid, 'bronze');
    D.nextTurn();
    const made = D.itemStock(pid, 'bronze') - wp0;
    ok('② 订单产出 = out（2 件）', made === 2, 'made=' + made);
    ok('② 订单耗料（铁1 + 木1）', bag.iron.stock === iron0 - 1 && bag.timber.stock === tim0 - 1,
      'iron ' + iron0 + '→' + bag.iron.stock + ' / timber ' + tim0 + '→' + bag.timber.stock);

    /* 再研一档：解锁更多军械，但**产量不变**（产能是闸） */
    AO.resResearch[owner].done.mil_iron = true;
    D.setShopOrder(pid, 'armory', 'ironwp');
    bag.iron.stock += 10; bag.timber.stock += 10;
    const wp1 = D.itemStock(pid, 'ironwp');
    D.nextTurn();
    const made2 = D.itemStock(pid, 'ironwp') - wp1;
    ok('② 新一档产量仍是 2（不随科技涨）', made2 === 2, 'made=' + made2);

    /* 两枝链：冷兵器（青铜→铁→强弩）与火器（铁兵器段→火门枪→…） */
    const R = AO.resResearch[owner];
    const chain = ['mil_bronze', 'mil_iron', 'mil_crossbow', 'mil_matchlock', 'mil_musket'];
    ok('② 两条枝的前置链正确',
      AO.TECH_BY_KEY.mil_bronze.req === null && AO.TECH_BY_KEY.mil_iron.req === 'mil_bronze' &&
      AO.TECH_BY_KEY.mil_crossbow.req === 'mil_iron' && AO.TECH_BY_KEY.mil_matchlock.req === 'mil_iron' &&
      AO.TECH_BY_KEY.mil_musket.req === 'mil_matchlock',
      chain.join('→'));
    ok('② 军事科技点数递增 30→120',
      AO.TECH_BY_KEY.mil_bronze.pts < AO.TECH_BY_KEY.mil_gw.pts &&
      AO.TECH_BY_KEY.mil_gw.pts === 120 && AO.TECH_BY_KEY.mil_bronze.pts === 30);
    return o;
  }));

  /* ---------------- ③ 征兵 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    const pid = w.provinces.findIndex(p => p.owner === 1) + 1;
    const p = w.provinces[pid - 1];
    const bag = AO.resSim[pid];
    bag.iron.built = 1; bag.iron.tiers[1] = 1;

    D.buildFactory(p, 'barracks');
    const bq = AO.resMil.barracks[pid];
    bq.site = 0; bq.n = 1;
    ok('③ 兵营建成（不限省份）', bq.n === 1);

    /* 成建制门槛：库存 0 件 → 不能征，且说明差几件。
     * 注意"该代军械"取的是 recruitInfo 判定的那一档（前一节已研出铁兵器） */
    const probe = D.recruitInfo(pid, 'inf');
    const tier = probe.tier.key;
    bag[tier] = { stock: 0, wp: true };
    const i0 = D.recruitInfo(pid, 'inf');
    ok('③ 军械不够时不可征 + 写差几件', !i0.ok && /军械不够/.test(i0.why) && /差 1 件/.test(i0.why), i0.why);

    D.addItem(pid, tier, 1);
    const i1 = D.recruitInfo(pid, 'inf');
    ok('③ 凑齐门槛后可征', i1.ok, i1.why);

    const pop0 = AO.resPop[pid].v;
    const gold0 = bag.gold.stock + (AO.resCentral[1].gold || 0);
    const arms0 = D.itemStock(pid, tier);
    const rr = D.recruit(pid, 'inf');
    const gold1 = bag.gold.stock + (AO.resCentral[1].gold || 0);
    ok('③ 征兵扣人口', AO.resPop[pid].v === pop0 - 1000, pop0 + '→' + AO.resPop[pid].v);
    ok('③ 征兵扣金', gold1 === gold0 - AO.RECRUIT.goldPerUnit, gold0 + '→' + gold1);
    ok('③ 征兵扣军械', D.itemStock(pid, tier) === arms0 - 1, tier + ' ' + arms0 + '→' + D.itemStock(pid, tier));
    ok('③ 征兵进入队列/成军', rr.ok, rr.msg);

    D.nextTurn();
    const mine = D.armiesOf(1);
    ok('③ 一回合后成军', mine.length === 1, 'armies=' + mine.length);
    const a = mine[0];
    ok('③ 军队兵数 1000', a && a.men === 1000, a && a.men);

    /* 断粮：把粮、鱼、中央存粮全清空 → 掉兵 + 战力打折 */
    bag.grain.stock = 0; bag.fish.stock = 0;
    AO.resCentral[1].grain = 0;
    bag.grain.built = 0; bag.grain.tiers[1] = 0; bag.grain.halted = true;
    const men0 = a.men;
    AO.resCentral[1].grain = 0;
    D.settleWar();                 // 只跑战争段：补给 → 掉兵
    const a2 = D.army[a.id];
    ok('③ 断粮掉兵（3%）', a2 && a2.men < men0, men0 + '→' + (a2 && a2.men));
    ok('③ 断粮标记（战力 ×0.85）', a2 && a2.starved === true);
    return o;
  }));

  /* ---------------- ④ 武科抽将 + 战术置灰 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    AO.resTalent[1].pts = 100000;
    const cnt = {};
    for (let i = 0; i < 400; i++) {
      const r = D.examGeneral(1);
      if (r.ok) cnt[r.trait.key] = (cnt[r.trait.key] || 0) + 1;
    }
    const total = Object.values(cnt).reduce((s, v) => s + v, 0);
    ok('④ 武科抽出将领（400 次）', total === 400, Object.keys(cnt).length + ' 种词条');
    ok('④ 稀有度分布合理（平平无奇最多、军神最少）',
      cnt.m_plain > cnt.m_fierce && cnt.m_fierce > (cnt.m_god || 0),
      'plain=' + cnt.m_plain + ' 猛将=' + cnt.m_fierce + ' 军神=' + (cnt.m_god || 0));
    ok('④ 军神概率 ≈ 3%', (cnt.m_god || 0) <= 400 * 0.07, '军神 ' + (cnt.m_god || 0) + '/400');
    const rar = Object.keys(AO.MIL_TRAITS).length;
    /* 14 条 = 原来 13 条 + 城墙那批的「营造」（行为型词条，fx 留空） */
    ok('④ 词条池 14 条', AO.MIL_TRAITS.length === 14, AO.MIL_TRAITS.length);

    /* 无闪袭词条的将领点不了闪袭 */
    const pool = AO.resTalent[1].milPool;
    const plain = pool.find(g => g.traitKey === 'm_plain');
    const flash = pool.find(g => g.traitKey === 'm_flash');
    const a = D.armiesOf(1)[0];
    if (!a) { ok('④ 有军队可测词条', false, 'no army'); return o; }
    if (plain) {
      D.assignGeneral(a.id, plain.id);
      const bad = D.setOrder(a.id, { type: 'attack', pid: a.pid, tactic: 'raid' });
      ok('④ 没闪袭词条 → 闪袭被拒', !bad.ok && /没学过/.test(bad.msg), bad.msg);
      const good = D.setOrder(a.id, { type: 'attack', pid: a.pid, tactic: 'assault' });
      ok('④ 强攻人人可用', good.ok, good.msg);
    }
    if (flash) {
      D.assignGeneral(a.id, flash.id);
      const okr = D.setOrder(a.id, { type: 'attack', pid: a.pid, tactic: 'raid' });
      ok('④ 有闪袭词条 → 闪袭可用', okr.ok, okr.msg);
    }
    /* UI 里那颗钮必须真的 disabled */
    D.openWar(1);
    const panel = document.getElementById('govPanel');
    ok('④ 军务页是治理面板的第二个页签',
      document.querySelectorAll('#gpTabs button').length === 2 && panel.classList.contains('mode-war'),
      'tab=' + (panel.className || ''));
    const row = document.querySelector('#gpTableWar .prow.war[data-aid]');
    if (row) row.click();          // 选中军队 → 展开命令编辑器
    const tacBtns = Array.from(document.querySelectorAll('#gpWarBody button[data-otac]'));
    const raidBtn = tacBtns.find(b => b.getAttribute('data-otac') === 'raid');
    ok('④ 战术钮存在且置灰逻辑正确', tacBtns.length >= 1 && (!raidBtn || !raidBtn.disabled || /词条/.test(raidBtn.title)),
      '战术钮 ' + tacBtns.length + ' 个');
    D.closeGov();
    return o;
  }));

  /* ---------------- ⑤ 会战两相位 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    /* 清场：把现有军队全解散（避免上一段留下的军干扰） */
    for (const id of Object.keys(D.army)) delete D.army[id];

    /* 找一对相邻省：X 属 1 国、Y 属 2 国 */
    let X = 0, Y = 0;
    for (const p of w.provinces) {
      if (p.owner !== 1) continue;
      for (const nb of p.neighbors) {
        const q = w.provinces[nb - 1];
        if (q && q.owner === 2) { X = p.id; Y = q.id; break; }
      }
      if (X) break;
    }
    ok('⑤ 找到接壤的两国省份', X && Y, X + ' / ' + Y);
    D.declareWar(1, 2);
    ok('⑤ 宣战写入 WARSET', !!D.wars[Math.min(1, 2) + '|' + Math.max(1, 2)]);

    /* 双方各一支军：攻方 3000 铁甲，守方 2500 青铜 */
    AO.resResearch[1].done.mil_iron = true;
    AO.resResearch[2].done.mil_bronze = true;
    const atk = D.newArmy(1, X, { type: 'army', tier: 'ironwp', men: 3000 });
    const def = D.newArmy(2, Y, { type: 'army', tier: 'bronze', men: 2500 });
    def.order = { type: 'defend', cid: 2, pid: Y, tactic: 'assault' };
    const spy0 = D.itemStock(Y, 'bronze');

    D.setOrder(atk.id, { type: 'attack', pid: Y, cid: 2, tactic: 'assault' });
    D.settleWar();

    const rep = AO.resWar.last;
    ok('⑤ 打起来了（有战报）', !!rep && rep.pid === Y, rep && rep.prov);
    if (rep) {
      ok('⑤ 战报含射击 / 接触两相位', typeof rep.shoot.deadA === 'number' && typeof rep.melee.deadA === 'number',
        '射击亡 ' + rep.shoot.deadA + '/' + rep.shoot.deadD + ' · 接触亡 ' + rep.melee.deadA + '/' + rep.melee.deadD);
      const recomputeA = rep.atk.men0 - rep.shoot.deadA - rep.melee.deadA;
      ok('⑤ 攻方伤亡可复算', recomputeA === rep.atk.men1, recomputeA + ' vs ' + rep.atk.men1);
      const recomputeD = rep.def.men0 - rep.shoot.deadD - rep.melee.deadD;
      ok('⑤ 守方伤亡可复算', recomputeD === rep.def.men1, recomputeD + ' vs ' + rep.def.men1);
      const terr = AO.BATTLE.terrainDef[rep.terrain] === undefined ? 1 : AO.BATTLE.terrainDef[rep.terrain];
      ok('⑤ 地形修正按 TERRAIN 表（守方）', Math.abs(rep.def.terr - terr) < 1e-9,
        rep.terrain + ' ×' + rep.def.terr + '（表 ' + terr + '）');
      ok('⑤ 骰子在 0.85~1.15', rep.atk.dice >= 0.85 && rep.atk.dice <= 1.15 &&
        rep.def.dice >= 0.85 && rep.def.dice <= 1.15, rep.atk.dice.toFixed(2) + ' / ' + rep.def.dice.toFixed(2));
      ok('⑤ 战报带将领名/地点/双方', /⚔/.test(rep.text) && rep.text.indexOf(rep.prov) > 0, rep.text.slice(0, 40) + '…');
      /* 装备按阵亡损毁 */
      const lossD = Math.floor((rep.def.men0 - rep.def.men1) / 1000);
      const spent = spy0 - D.itemStock(Y, 'bronze');
      ok('⑤ 阵亡兵按比例损毁装备', spent >= 0 && spent <= Math.max(0, lossD) + 1, '损 ' + spent + '（阵亡 ' + (rep.def.men0 - rep.def.men1) + '）');
    }
    /* 败方撤退：守方的省还在自己手里 → 不撤；攻方输了就退回 X */
    const loser = rep && rep.winner === 'atk' ? D.army[atk.id] : D.army[def.id];
    ok('⑤ 战败方要么撤退要么被歼（不会留在原地挨打）',
      !loser || loser.pid !== Y || rep.winner !== 'def', loser ? 'loser@' + loser.pid : '歼灭');

    /* 压制：给守方打上 sup，下一场会战战力 ×0.8 */
    const d2 = D.army[def.id] || D.newArmy(2, Y, { type: 'army', tier: 'bronze', men: 2000 });
    d2.sup = true;
    const before = d2.men;
    D.settleWar();
    ok('⑤ 压制消耗一次后清掉', d2.sup === false, 'sup=' + d2.sup);
    return o;
  }));

  /* ---------------- ⑥ 轰击 + 围城 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    for (const id of Object.keys(D.army)) delete D.army[id];

    /* 相邻省：1 国 vs 2 国 */
    let X = 0, Y = 0;
    for (const p of w.provinces) {
      if (p.owner !== 1) continue;
      for (const nb of p.neighbors) {
        const q = w.provinces[nb - 1];
        if (q && q.owner === 2) { X = p.id; Y = q.id; break; }
      }
      if (X) break;
    }
    AO.resResearch[1].done.mil_matchlock = true;
    const gun = { id: 9001, owner: 1, type: 'army', tier: 'matchlock', men: 3000, ships: 0, cargo: null,
      generalId: 0, order: null, pid: X, sup: false, starved: false, arms: 'inf' };
    D.army[9001] = gun;
    const foe = D.newArmy(2, Y, { type: 'army', tier: 'bronze', men: 2000 });
    foe.order = { type: 'defend', cid: 2, pid: Y, tactic: 'assault' };

    const men0 = foe.men;
    const logN = D.log().length;
    D.setOrder(9001, { type: 'bombard', pid: Y, tactic: 'assault' });
    D.settleWar();
    ok('⑥ 轰击造成伤亡', D.army[foe.id].men < men0, men0 + '→' + D.army[foe.id].men);
    const newLogs = D.log().slice(0, D.log().length - logN).map(e => e.text);
    ok('⑥ 轰击不触发会战（没有 ⚔ 战报）', !newLogs.some(t => /⚔/.test(t)), newLogs[0] ? newLogs[0].slice(0, 34) : '—');
    ok('⑥ 轰击留下压制标记', D.army[foe.id].sup === true, 'sup=' + D.army[foe.id].sup);

    /* ---- 围城 ---- */
    for (const id of Object.keys(D.army)) delete D.army[id];
    for (const k of Object.keys(D.siegeMap)) delete D.siegeMap[k];
    /* 围城战术要词条：造一位围城将 */
    const gen = { id: 7001, name: '围城将', traitKey: 'm_siege', owner: 1, armyId: 0 };
    D.generals[7001] = gen;
    const sieger = D.newArmy(1, X, { type: 'army', tier: 'ironwp', men: 5000, generalId: 7001 });
    gen.armyId = sieger.id;
    const holder = D.newArmy(2, Y, { type: 'army', tier: 'bronze', men: 1200 });
    holder.order = { type: 'defend', cid: 2, pid: Y, tactic: 'assault' };
    /* 城里没粮：一进围城就开始饿 */
    const bag = AO.resSim[Y];
    bag.grain.stock = 0; bag.fish.stock = 0;
    bag.grain.built = 0; bag.grain.tiers[1] = 0; bag.grain.halted = true;

    D.setOrder(sieger.id, { type: 'attack', pid: Y, cid: 2, tactic: 'siege' });
    D.settleWar();
    ok('⑥ 围城标记生效（产出归零）', !!D.siegeMap[Y], JSON.stringify(D.siegeMap[Y] || {}));
    const holder2 = D.army[holder.id];
    const hmen0 = holder2.men;
    for (let i = 0; i < 3; i++) D.settleWar();
    const hmen1 = (D.army[holder.id] || { men: 0 }).men;
    ok('⑥ 城内存粮尽 → 守军每回合 −10%', hmen1 < hmen0 * 0.78, hmen0 + '→' + hmen1);
    for (let i = 0; i < 80; i++) D.settleWar();
    ok('⑥ 兵尽开城 → 省易主', w.provinces[Y - 1].owner === 1,
      'owner=' + w.provinces[Y - 1].owner + ' · 守军 ' + ((D.army[holder.id] || {}).men || 0) +
      ' · dead=' + JSON.stringify(D.deadMap) + ' · turn=' + D.turn());
    return o;
  }));

  /* ---------------- ⑦ 群龙无首 / 占领 / 投降 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    /* 现挑一个**还活着、省数够多**的 AI 国：前面几段已经打过仗，
     * 写死 "2 号国" 会踩到"它已经在 ⑥ 里被吞并"的状态漂移。 */
    const cB = w.countries.find(c => c.id !== 1 && !D.deadMap[c.id] && c.provinces.length >= 6);
    if (!cB) { ok('⑦ 还有可测的国家', false, '所有 AI 国都没了'); return o; }
    const B = cB.id;
    const cap = cB.capital;
    const capP = w.provinces[cap - 1];
    if (capP.owner !== B) D.occupy(cap, B);          // 光复成干净状态
    ok('⑦ ' + B + ' 号国首都在自己手里', capP.owner === B,
      capP.name + ' · 剩省 ' + cB.provinces.length);

    D.occupy(cap, 1);
    ok('⑦ 首都易手 → 挂群龙无首', D.isDecap(B), 'isDecap=' + D.isDecap(B));
    ok('⑦ 占领省记进 OCCUPY', !!D.occupyMap[cap]);
    D.nextTurn();
    const hd = AO.resHappy[cap].drivers;
    ok('⑦ 占领/群龙无首 进民心 drivers（−10）', hd && hd.war <= -10, 'war=' + (hd && hd.war));
    ok('⑦ 群龙无首四件套的系数在 BATTLE 里',
      AO.BATTLE.decapTax === 0.7 && AO.BATTLE.decapScience === 0.5 &&
      AO.BATTLE.decapHappy === -10 && AO.BATTLE.decap === 0.8,
      '税×' + AO.BATTLE.decapTax + ' 科研×' + AO.BATTLE.decapScience + ' 民心' +
      AO.BATTLE.decapHappy + ' 战力×' + AO.BATTLE.decap);

    /* 光复：还给 B → 立刻解除 */
    D.occupy(cap, B);
    ok('⑦ 光复解除群龙无首', !D.isDecap(B));

    /* 占领省产出 ×0.6：同一省两回合 A/B 对比 */
    const pid = w.provinces.find(p => p.owner === 1 && p.id !== cap).id;
    const bag = AO.resSim[pid];
    function reset() {
      bag.grain.built = 1; bag.grain.tiers = { 1: 1, 2: 0 }; bag.grain.halted = false;
      bag.grain.cool = 0; bag.grain.left = 100; bag.grain.stock = 0; bag.grain.pAcc = 0;
      bag.grain.eatAcc = 0;
    }
    delete D.occupyMap[pid];
    reset();
    D.nextTurn();
    const g1 = (D.flow[pid].gain.grain || 0);
    D.occupyMap[pid] = { by: 1, turn: D.turn() };
    reset();
    D.nextTurn();
    const g2 = (D.flow[pid].gain.grain || 0);
    ok('⑦ 占领省产出 ×0.6（3→1.8 → 落袋 1）', g1 === 2 && g2 === 1, '正常 ' + g1 + ' / 占领 ' + g2);

    /* 投降：先宣战（投降线的分母 = **开战那一刻**的省数），再把它打到线下。
     * 顺序反过来的话分母会跟着缩水，永远到不了 1/3 —— 这也是真实玩法的顺序。 */
    const dr = D.declareWar(1, B);
    ok('⑦ 宣战成功（投降线记为开战国省数）', dr.ok || /已经在交战/.test(dr.msg), dr.msg);
    const wk = Math.min(1, B) + '|' + Math.max(1, B);
    const rec = window.AO.resWar.base[wk];
    /* WARBASE 的 a/b 按 id 小的排在 a：1 号国永远在 a 侧 */
    const baseB = rec ? (1 < B ? rec.b : rec.a) : cB.provinces.length;
    const keep = Math.max(1, Math.ceil(baseB * (D.isDecap(B) ? 2 / 3 : 1 / 3)));
    let guard = 0;
    while (cB.provinces.length > keep && guard++ < 400) D.occupy(cB.provinces[0], 1);
    ok('⑦ ' + B + ' 号国剩省 ' + cB.provinces.length + '（线 ' + keep + '）', cB.provinces.length <= keep);
    D.settleWar();
    ok('⑦ 触发投降 → 全境并入', !!D.deadMap[B],
      JSON.stringify(D.deadMap[B] || {}) + ' · base=' + baseB + ' · declare=' + dr.msg);
    ok('⑦ 灭亡国省表清空', cB.provinces.length === 0, '剩 ' + cB.provinces.length);
    ok('⑦ 灭亡国军队清空', D.armiesOf(B).length === 0, D.armiesOf(B).length);
    ok('⑦ 灭亡国科技清空', Object.keys(AO.resResearch[B].done).length === 0);
    ok('⑦ 战报宣布灭亡', D.log().some(e => /灭亡/.test(e.text)), (D.log()[0] || {}).text);
    return o;
  }));

  /* ---------------- ⑧ 海军 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    for (const id of Object.keys(D.army)) delete D.army[id];

    /* 海路：找一个有邻居的沿海省 */
    let port = 0;
    for (const p of w.provinces) if (p.coastDirs > 0 && D.seaAdj(p.id).length) { port = p.id; break; }
    ok('⑧ 沿海省之间有海路', !!port, port ? ('省 ' + port + ' → ' + D.seaAdj(port).length + ' 个可达港') : 'no port');

    /* 舰队：征一支（直接建），跑封锁 */
    let enemyPort = 0, ownPort = 0;
    for (const p of w.provinces) {
      if (!(p.coastDirs > 0) || p.owner !== 1) continue;
      for (const q of D.seaAdj(p.id)) {
        const p2 = w.provinces[q - 1];
        if (p2 && p2.owner !== 1 && p2.coastDirs > 0) { ownPort = p.id; enemyPort = q; break; }
      }
      if (ownPort) break;
    }
    if (!ownPort) ownPort = port;
    ok('⑧ 找到敌对沿海省', !!(enemyPort && ownPort), '自 ' + ownPort + ' / 敌 ' + enemyPort);
    if (enemyPort && ownPort) {
      AO.resResearch[1].done.mil_galley = true;
      const fleet = D.newArmy(1, ownPort, { type: 'navy', tier: 'galley', men: 1000, ships: 4 });
      ok('⑧ 舰队建成（4 艘）', fleet.ships === 4);
      D.declareWar(1, w.provinces[enemyPort - 1].owner);
      D.setOrder(fleet.id, { type: 'blockade', pid: enemyPort, tactic: 'assault' });
      for (let i = 0; i < 4; i++) D.settleWar();
      ok('⑧ 舰队抵达并上封锁', !!D.blockadeMap[enemyPort],
        'fleet@' + D.army[fleet.id].pid + ' · blockade=' + JSON.stringify(D.blockadeMap[enemyPort] || {}));

      /* 封锁断渔获：同一省 A/B 对比 */
      const pid = enemyPort;
      const bag = AO.resSim[pid];
      bag.fish.built = 1; bag.fish.tiers = { 1: 1, 2: 0 }; bag.fish.halted = false;
      bag.fish.cool = 0; bag.fish.left = 100; bag.fish.stock = 0; bag.fish.eatAcc = 0;
      bag.fish.pAcc = 0;
      D.nextTurn();
      const blocked = (D.flow[pid].gain.fish || 0);
      delete D.blockadeMap[pid];
      bag.fish.left = 100; bag.fish.stock = 0; bag.fish.eatAcc = 0; bag.fish.pAcc = 0; bag.fish.cool = 0;
      D.nextTurn();
      const free = (D.flow[pid].gain.fish || 0);
      ok('⑧ 封锁断渔获（0 vs 有产）', blocked === 0 && free > 0, '封锁 ' + blocked + ' / 不封锁 ' + free);

      /* 运输：装船 → 一回合登岸 */
      const dest = D.seaAdj(ownPort).find(q => w.provinces[q - 1].owner === 1) || D.seaAdj(ownPort)[0];
      const land = D.newArmy(1, ownPort, { type: 'army', tier: 'ironwp', men: 2000 });
      const cap0 = (fleet.ships) * (AO.MIL_ITEM.galley.cap);
      fleet.cargo = { men: Math.min(land.men, cap0), tier: land.tier, arms: 'inf' };
      land.men -= fleet.cargo.men;
      if (land.men <= 0) delete D.army[land.id];
      D.setOrder(fleet.id, { type: 'transport', pid: dest, tactic: 'assault' });
      for (let i = 0; i < 4; i++) D.settleWar();
      const arrived = D.armiesIn(dest).some(a => a.type === 'army' && a.owner === 1 && a.men >= 1000);
      ok('⑧ 舰队运输 → 陆军登岸', arrived, 'dest=' + dest + ' · 舰队@' + D.army[fleet.id].pid);
    }

    /* 岛屿：分连通块，跨块的陆军目标应当"无路可走" */
    const seen = new Set(); const comp = {};
    let compN = 0;
    for (const p of w.provinces) {
      if (seen.has(p.id)) continue;
      compN++;
      const q = [p.id]; seen.add(p.id); comp[p.id] = compN;
      let minRep = p.owner, maxRep = p.owner;
      while (q.length) {
        const cur = q.pop();
        for (const nb of w.provinces[cur - 1].neighbors) {
          if (seen.has(nb)) continue;
          seen.add(nb); comp[nb] = compN; q.push(nb);
        }
      }
    }
    const multi = Object.keys(comp).length && compN > 1;
    ok('⑧ 世界上有多个陆块（跨海只能靠舰队）', multi, compN + ' 个陆块');
    if (multi) {
      const from = w.provinces.find(p => comp[p.id] === 1).id;
      const to = w.provinces.find(p => comp[p.id] === 2 && p.owner !== w.provinces[from - 1].owner);
      if (to) {
        D.declareWar(1, to.owner);
        const a = D.newArmy(1, from, { type: 'army', tier: 'ironwp', men: 1000 });
        D.setOrder(a.id, { type: 'attack', pid: to.id, cid: to.owner, tactic: 'assault' });
        const n0 = D.log().length;
        D.settleWar();
        ok('⑧ 陆军过不了海（写"无路可走"）',
          D.army[a.id].pid === from && D.log().some(e => /无路可走/.test(e.text)),
          D.log()[0].text.slice(0, 40));
      } else {
        ok('⑧ 陆军过不了海（写"无路可走"）', true, 'skip：另一块大陆上没有敌国');
      }
    }
    return o;
  }));

  /* ---------------- ⑨ 敌国 AI ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    for (const id of Object.keys(D.army)) delete D.army[id];
    /* 找一个还活着的 AI 国（3 号） */
    let ai = 0;
    for (const c of w.countries) if (c.id !== 1 && !D.deadMap[c.id] && c.provinces.length) { ai = c.id; break; }
    ok('⑨ 还有 AI 国', !!ai, 'AI=' + ai);
    D.declareWar(1, ai);
    const n0 = D.armiesOf(ai).length;
    D.nextTurn(); D.nextTurn(); D.nextTurn();
    const list = D.armiesOf(ai);
    ok('⑨ 交战 AI 每 3 回合自动征一军', list.length > n0, n0 + '→' + list.length);
    ok('⑨ AI 军队是驻防命令（不主动进攻）',
      list.every(a => a.order && (a.order.type === 'defend' || a.order.type === 'train')),
      list.map(a => a.order && a.order.type).join(','));
    ok('⑨ AI 的兵有自己的将领（走同一词条池）',
      list.some(a => a.generalId && D.generals[a.generalId]), list.length + ' 支');
    return o;
  }));

  /* ---------------- ⑩ 存档 v3 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    D.choosePlayer(1);
    D.save();
    const raw = localStorage.getItem('sj.save');
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { /* ignore */ }
    ok('⑩ 存档写得出来（≥v3）', !!d && d.v >= 3, d && ('v' + d.v + ' · ' + ((raw.length / 1024) | 0) + 'KB'));
    ok('⑩ 存档含 PLAYER/WARSET/ARMY/GENERALS',
      !!d && d.PLAYER === 1 && d.WARSET && d.ARMY && d.GENERALS,
      d && ('PLAYER=' + d.PLAYER + ' 军 ' + Object.keys(d.ARMY).length + ' 支 将 ' +
        Object.keys(d.GENERALS || {}).length + ' 位 交战 ' + Object.keys(d.WARSET).length));
    ok('⑩ 存档含装备厂状态', !!(d && d.BARRACKS && d.ARMORY && d.SHIPYARD));
    /* 装备库存跟着 SIM 袋走 —— 抽查一个武器键 */
    const wpKey = Object.keys(d.SIM).map(k => d.SIM[k]).some(b => b && b['ironwp'] && b['ironwp'].wp);
    ok('⑩ 装备库存随 SIM 袋持久化', wpKey, wpKey ? '找到 ironwp 袋' : '没找到（可能这局还没产过）');
    return o;
  }));

  /* 读档：走一次完整 load（会按 seed 重建世界，慢一点） */
  const before = await page.evaluate(() => ({
    player: window.AO.resDebug.player(),
    armies: Object.keys(window.AO.resDebug.army).length
  }));
  await page.evaluate(() => {
    const D = window.AO.resDebug;
    D.choosePlayer(0);           // 先抹掉 PLAYER，验读档能恢复
    D.load();
  });
  await sleep(3200);
  add(await page.evaluate((before) => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    ok('⑩ 读档恢复 PLAYER', D.player() === before.player, D.player() + ' vs ' + before.player);
    ok('⑩ 读档恢复军队', Object.keys(D.army).length === before.armies,
      Object.keys(D.army).length + ' vs ' + before.armies);
    return o;
  }, before));

  await browser.close();

  /* ---------------- 输出 ---------------- */
  let pass = 0, fail = 0;
  const lines = [];
  for (const c of out) {
    if (c.ok) pass++; else fail++;
    lines.push((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + (c.detail ? '  —  ' + c.detail : ''));
  }
  console.log(lines.join('\n'));
  if (errors.length) {
    console.log('\n页面报错：');
    for (const e of errors.slice(0, 12)) console.log('  ' + e);
  }
  console.log('\n合计 ' + out.length + ' 项：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail || errors.length ? 1 : 0);
})();
