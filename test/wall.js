/* =============================================================
 * test/wall.js —— 城墙（城防值）的验收
 *
 * 对着任务书第六节的验收清单逐条过：
 *   ① 建墙 → 省卡显示城防；Lv1→3 造价每级 ×2、上限 30/60/100
 *   ② 会战守方先掉 hp 再掉兵（手算一例对得上）；重炮破墙明显快于皮甲
 *   ③ 轰击先磨 hp、磨空后才杀伤；围城完全无视城防、照常饿到开城
 *   ④ 墙欠费失修掉 hp；「营造」将驻防回复加速、守城胜后回充 15%
 *   ⑤ AI 首都有 Lv1 墙；存档 WALL 往返正常、读旧档补默认不炸
 *
 * 跑法：node test/wall.js
 * 小世界（140 省 / 8 国），几十秒。
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
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'wall-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- ① 定义表 + 建墙 + 升级 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const W = AO.WALL;

    ok('① 耐久上限 30 / 60 / 100', W.hpAt.join(',') === '0,30,60,100', W.hpAt.join(','));
    ok('① 三级叫土木 → 砖石 → 棱堡', W.lvCn[1] + W.lvCn[2] + W.lvCn[3] === '土木砖石棱堡',
      W.lvCn.slice(1).join(' → '));
    const c = [0, 1, 2].map(l => W.costAt(l));
    ok('① 造价每级 ×2（木材与金都翻倍）',
      c[1].timber === c[0].timber * 2 && c[2].timber === c[1].timber * 2 &&
      c[1].gold === c[0].gold * 2 && c[2].gold === c[1].gold * 2,
      c.map(x => x.timber + '木/' + x.gold + '金').join(' → '));

    /* 选国 1，找一个还没墙的省（首都开局就有墙，跳过） */
    D.choosePlayer(1);
    const w = D.world();
    const p = w.provinces.find(q => q.owner === 1 && !(D.wall[q.id] && D.wall[q.id].lv > 0));
    if (!p) return o.concat([{ name: '① 找到可砌墙的省', ok: false }]);

    /* 备料：本省 + 中央都给足（不然付账会去别省调拨，扣的钱不好对账） */
    const bag = AO.resSim[p.id];
    bag.timber.stock = 400; bag.gold.stock = 400; bag.iron.stock = 200;
    const cen = AO.resCentral[1];
    cen.timber = 400; cen.gold = 400; cen.iron = 200;

    const t0 = bag.timber.stock, g0 = bag.gold.stock;
    D.upgradeWall(p);
    const cost0 = W.costAt(0);
    ok('① 砌墙扣了 Lv1 的价', t0 - bag.timber.stock === cost0.timber && g0 - bag.gold.stock === cost0.gold,
      '木 −' + (t0 - bag.timber.stock) + ' · 金 −' + (g0 - bag.gold.stock));
    const wl = D.wall[p.id];
    ok('① 开工后 lv 还是 0、site > 0', wl && wl.lv === 0 && wl.site > 0, wl && ('lv' + wl.lv + ' site' + wl.site));

    /* 推回合到完工（期间别的省也照常结算，不影响这条） */
    for (let i = 0; i < 4 && D.wall[p.id].site > 0; i++) D.settleTurn();
    ok('① 完工 → Lv1、耐久满 30', D.wall[p.id].lv === 1 && D.wall[p.id].hp === 30,
      'Lv' + D.wall[p.id].lv + ' · ' + D.wall[p.id].hp + '/30');

    /* 省卡：有墙才显示这一行 */
    const R = window.__renderer;
    R.select(p.id);
    const row = document.getElementById('iWallRow');
    const val = document.getElementById('iWall');
    ok('① 省卡显示「城防 30 / 30」', row && row.style.display !== 'none' && /^30 \/ 30$/.test(val.textContent),
      val ? val.textContent : 'no #iWall');

    /* Lv1 → Lv2 → Lv3：造价翻倍、上限对得上 */
    const paid = [];
    for (let lv = 1; lv <= 2; lv++) {
      const before = W.costAt(lv);
      const tb = bag.timber.stock, gb = bag.gold.stock;
      D.upgradeWall(p);
      paid.push({ lv: lv + 1, timber: tb - bag.timber.stock, gold: gb - bag.gold.stock, cost: before });
      for (let i = 0; i < 5 && D.wall[p.id].site > 0; i++) D.settleTurn();
    }
    ok('① Lv2/Lv3 造价逐级翻倍',
      paid[0].timber === cost0.timber * 2 && paid[1].timber === cost0.timber * 4 &&
      paid[1].timber === paid[0].timber * 2,
      paid.map(x => 'Lv' + x.lv + ':' + x.timber + '木/' + x.gold + '金').join(' → '));
    ok('① 升到 Lv3、上限 100', D.wall[p.id].lv === 3 && D.wall[p.id].hp === 100,
      'Lv' + D.wall[p.id].lv + ' · ' + D.wall[p.id].hp + '/100');
    ok('① 满级后 ＋ 钮置灰',
      (() => {
        R.select(p.id);
        const b = document.querySelector('#iMilList .rr.bld[data-wall] button.add');
        return b && b.disabled && /已满级/.test(b.title);
      })());
    window.__wallPid = p.id;
    return o;
  }));

  /* 截图：省卡信息栏的城防行 / 军备栏的城墙行 + ? 面板 */
  await page.evaluate(() => {
    const R = window.__renderer, p = window.__world.provinces[window.__wallPid - 1];
    /* 结算会掷事件，弹窗会盖住省卡 —— 先关掉（截图用） */
    const em = document.getElementById('eventModal');
    if (em) em.classList.remove('on');
    R.cam.x = p.centroid[0]; R.cam.y = p.centroid[1]; R.cam.scale = 2.4; R.clampCam();
    R.select(window.__wallPid); R.draw();
    const tab = document.querySelector('#infoTabs .itab[data-tab="info"]');
    if (tab) tab.click();
  });
  await sleep(600);
  await page.screenshot({ path: shot('wall-card.png') });

  await page.evaluate(() => {
    const tab = document.querySelector('#infoTabs .itab[data-tab="bld"]');
    if (tab) tab.click();
    const q = document.querySelector('#iMilList .rr.bld[data-wall] .qbtn');
    if (q) q.click();
  });
  await sleep(600);
  await page.screenshot({ path: shot('wall-row.png') });

  /* 地图角标：挑一个自己国家的墙，放大看小堡（迷雾下未探省不画，所以必须选自己的） */
  await page.evaluate(() => {
    const R = window.__renderer, D = window.AO.resDebug;
    D.choosePlayer(1);
    const p = window.__world.provinces.find(q => q.owner === 1 && D.wall[q.id] && D.wall[q.id].lv > 0);
    if (!p) return;
    R.cam.x = p.centroid[0]; R.cam.y = p.centroid[1]; R.cam.scale = 3.4; R.clampCam();
    R.select(p.id); R.draw();
  });
  await sleep(500);
  await page.screenshot({ path: shot('wall-map.png') });

  /* ---------------- ② 会战：先掉 hp 再掉兵 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const W = AO.WALL, pid = window.__wallPid, p = window.__world.provinces[pid - 1];
    const wl = D.wall[pid];
    wl.hp = 100;                                  // 满墙，保证一场打不空

    const atk = D.newArmy(2, pid, { type: 'army', tier: 'gw', men: 2000 });
    const def = D.newArmy(1, pid, { type: 'army', tier: 'ironwp', men: 2000 });
    const rep = D.fight([atk], [def], p, {});
    const wr = rep.wall;
    ok('② 战报带城墙记录', !!wr, wr ? JSON.stringify(wr) : '无');

    /* 手算四步：hp0 → 破城 −攻城值合计×2 → 再扣墙吃掉的伤亡 → hp1 */
    const siege = AO.MIL_ITEM.gw.siege;
    ok('② 破城伤害 = 攻城值合计 ×2', wr.breach === siege * 2, 'siege ' + siege + ' → −' + wr.breach);
    ok('② 守方战力乘数 = 1 + hp0/max×0.25',
      Math.abs(wr.mul - (1 + wr.hp0 / wr.max * 0.25)) < 1e-9, '×' + wr.mul.toFixed(3));
    const calc = wr.hp0 - wr.breach - wr.absorbed / W.manPerHp;
    ok('② 手算对得上：hp0 − 破城 − 墙吃/100 = hp1',
      Math.abs(calc - wr.hp1) < 0.51,
      wr.hp0 + ' − ' + wr.breach + ' − ' + (wr.absorbed / 100).toFixed(2) + ' = ' + calc.toFixed(2) +
      '（实际 ' + wr.hp1.toFixed(2) + '）');
    ok('② 墙没塌 → 守军一个没死', wr.hp1 > 0 && rep.def.men1 === rep.def.men0,
      '守军 ' + rep.def.men0 + ' → ' + rep.def.men1 + '，墙吃 ' + Math.round(wr.absorbed) + ' 人份');

    /* 对照：同样的守军、同样的墙，攻方换成皮甲（攻城值 0） */
    const p2 = window.__world.provinces.find(q => q.owner === 1 && q.id !== pid &&
      q.terrain === p.terrain && !D.armiesIn(q.id).length) ||
      window.__world.provinces.find(q => q.owner === 1 && q.id !== pid && !D.armiesIn(q.id).length);
    if (!p2) return o.concat([{ name: '② 找到对照省', ok: false }]);
    D.wall[p2.id] = { lv: 3, site: 0, hp: 100, halted: false, mAcc: { iron: 0, gold: 0 } };
    const a2 = D.newArmy(2, p2.id, { type: 'army', tier: 'leather', men: 2000 });
    const d2 = D.newArmy(1, p2.id, { type: 'army', tier: 'ironwp', men: 2000 });
    const rep2 = D.fight([a2], [d2], p2, {});
    const heavyLoss = wr.hp0 - wr.hp1, lightLoss = rep2.wall.hp0 - rep2.wall.hp1;
    ok('② 重炮破墙远快于皮甲', heavyLoss > lightLoss + 6,
      '重炮 −' + heavyLoss.toFixed(1) + ' vs 皮甲 −' + lightLoss.toFixed(1));
    ok('② 皮甲破城伤害为 0', rep2.wall.breach === 0, 'breach=' + rep2.wall.breach);

    /* 墙塌之后才开始掉兵 */
    wl.hp = 1;
    const a3 = D.newArmy(2, pid, { type: 'army', tier: 'gw', men: 2000 });
    const d3 = D.newArmy(1, pid, { type: 'army', tier: 'ironwp', men: 2000 });
    const rep3 = D.fight([a3], [d3], p, {});
    ok('② 墙被磨空 → 守军开始掉兵', rep3.wall.hp1 === 0 && rep3.def.men1 < rep3.def.men0,
      '墙 0 · 守军 ' + rep3.def.men0 + ' → ' + rep3.def.men1);

    /* 回复规则：这一回合打过仗 → 不修（否则"边打边修"）；下一回合没打 → +2 */
    wl.hp = 50;
    D.settleWalls();
    ok('② 打过仗的回合不回复（无战事才 +2）', wl.hp === 50, 'hp=' + wl.hp);
    D.setTurn(D.turn() + 1);
    D.settleWalls();
    ok('② 没打仗的回合回 +2', wl.hp === 52, 'hp=' + wl.hp);
    return o;
  }));

  /* ---------------- ③ 轰击 / 围城 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const W = AO.WALL, w = D.world();

    /* 找一对相邻的敌国省：P 我方（放炮兵），Q 敌方（放守军 + 墙）。
     * 不预设是哪一国 —— 小世界里 1 号和 2 号未必接壤。 */
    D.choosePlayer(1);
    let P = null, Q = null, Foe = 0;
    for (const q of w.provinces) {
      if (!q.owner || q.owner === 1) continue;
      for (const nb of (q.neighbors || [])) {
        const pp = w.provinces[nb - 1];
        if (pp && pp.owner === 1) { P = pp; Q = q; Foe = q.owner; break; }
      }
      if (P) break;
    }
    if (!P) return o.concat([{ name: '③ 找到相邻敌省', ok: false }]);
    D.declareWar(1, Foe);

    /* 清场：只在 P 留炮兵、Q 留守军 */
    for (const k of Object.keys(D.army)) {
      const a = D.army[k];
      if (a.pid === P.id || a.pid === Q.id) delete D.army[k];
    }
    D.wall[Q.id] = { lv: 3, site: 0, hp: 100, halted: false, mAcc: { iron: 0, gold: 0 } };
    const gun = D.newArmy(1, P.id, { type: 'army', tier: 'heavy_gun', men: 3000 });
    const hold = D.newArmy(Foe, Q.id, { type: 'army', tier: 'ironwp', men: 3000 });
    D.setOrder(gun.id, { type: 'bombard', pid: Q.id, cid: Foe, tactic: 'assault' });
    /* 口粮给足：不然 feedArmy 会让守军断粮掉兵，干扰"零伤亡"的判定 */
    if (AO.resSim[Q.id] && AO.resSim[Q.id].grain) AO.resSim[Q.id].grain.stock = 500;
    if (AO.resSim[P.id] && AO.resSim[P.id].grain) AO.resSim[P.id].grain.stock = 500;
    /* 炮弹要落进 Q：清掉 Q 之外的所有相邻敌省驻军（stepArmy 只挑有敌军的省） */
    D.settleWar();

    const hpAfter = D.wall[Q.id].hp;
    const expect = 100 - AO.MIL_ITEM.heavy_gun.siege * 3 * W.bombardKoef;
    ok('③ 轰击先磨墙：削墙量 = 攻城值 × 兵数/1000 × 系数',
      Math.abs(hpAfter - expect) < 0.001, hpAfter.toFixed(2) + '（应为 ' + expect.toFixed(2) + '）');
    ok('③ 墙没塌 → 守军零伤亡、也没有压制',
      hold.men === 3000 && !hold.sup, '守军 ' + hold.men + ' · sup=' + hold.sup);

    /* 墙只剩 1 点 → 这一炮磨穿，余劲才伤人 */
    D.wall[Q.id].hp = 1;
    D.setOrder(gun.id, { type: 'bombard', pid: Q.id, cid: Foe, tactic: 'assault' });
    if (AO.resSim[Q.id] && AO.resSim[Q.id].grain) AO.resSim[Q.id].grain.stock = 500;
    if (AO.resSim[P.id] && AO.resSim[P.id].grain) AO.resSim[P.id].grain.stock = 500;
    D.settleWar();
    ok('③ 磨穿后才开始杀伤 + 压制', D.wall[Q.id].hp === 0 && hold.men < 3000 && hold.sup,
      '墙 0 · 守军 ' + hold.men + ' · sup=' + hold.sup);
    return o;
  }));

  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();

    /* 围城：找一对相邻的"我方 → 敌方"省（优先敌国首都，开局就有 Lv1 墙），
     * 守方粮清零，围到开城。 */
    D.choosePlayer(1);
    let T = null, from = null, foe = 0;
    for (const q of w.provinces) {
      if (!q.owner || q.owner === 1) continue;
      const f = (q.neighbors || []).map(n => w.provinces[n - 1]).find(x => x && x.owner === 1);
      if (!f) continue;
      /* 首都优先（它的墙是开局砌的），其余按先来后到 */
      const c = w.countries[q.owner - 1];
      if (!T || (c && c.capital === q.id)) { T = q; from = f; foe = q.owner; }
      if (c && c.capital === q.id) break;
    }
    if (!T) return o.concat([{ name: '③ 找到可围的敌省', ok: false }]);
    D.declareWar(1, foe);

    for (const k of Object.keys(D.army)) delete D.army[k];
    D.wall[T.id] = { lv: 2, site: 0, hp: 60, halted: false, mAcc: { iron: 0, gold: 0 } };
    const def = D.newArmy(foe, T.id, { type: 'army', tier: 'leather', men: 1200 });
    /* 围城战术要「围城」词条才解锁：给围城军配一位 */
    const sgid = 99002;
    AO.resGenerals[sgid] = { id: sgid, name: '长围', traitKey: 'm_siege', owner: 1, armyId: 0 };
    const sieger = D.newArmy(1, from.id, { type: 'army', tier: 'ironwp', men: 6000, generalId: sgid });
    const ord = D.setOrder(sieger.id, { type: 'attack', pid: T.id, cid: foe, tactic: 'siege' });
    ok('③ 围城命令下达', ord.ok, ord.msg);
    /* 存粮清零：围城要能"饿到开城" */
    const bag = AO.resSim[T.id];
    if (bag && bag.grain) bag.grain.stock = 0;

    const hp0 = D.wall[T.id].hp;
    let opened = false, sieged = false;
    for (let i = 0; i < 140; i++) {
      D.settleWar();
      if (D.siegeMap[T.id]) sieged = true;
      if (D.world().provinces[T.id - 1].owner === 1) { opened = true; break; }
    }
    ok('③ 围城标记挂上了', sieged);
    ok('③ 围城无视城墙：照常饿到开城', opened, opened ? '围了若干回合后开城' : '140 回合没开城');
    ok('③ 围城期间城墙一点没掉（不吃城防减伤）', D.wall[T.id].hp >= hp0,
      'hp ' + hp0 + ' → ' + D.wall[T.id].hp);
    return o;
  }));

  /* ---------------- ④ 失修 + 营造 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const W = AO.WALL, w = D.world();
    D.choosePlayer(1);

    /* 失修：把本国所有省的铁/金和中央都清空，并把墙的维护零头顶到上限 40
     * —— 这一回合最多只有"每省 1 点抽税"能流进来（< 40），维护必然付不起。
     * 直接验"欠费 → 每回合 −5"这条规则。 */
    const p = w.provinces.find(q => q.owner === 1 && D.wall[q.id] && D.wall[q.id].lv > 0);
    const wl = D.wall[p.id];
    wl.hp = 60; wl.lv = 3; wl.halted = false;
    wl.mAcc = { iron: 40, gold: 40 };
    for (const q of w.provinces) {
      if (q.owner !== 1) continue;
      const b = AO.resSim[q.id];
      if (!b) continue;
      if (b.iron) b.iron.stock = 0;
      if (b.gold) b.gold.stock = 0;
    }
    const cen0 = AO.resCentral[1];
    cen0.iron = 0; cen0.gold = 0;
    D.settleTurn();
    ok('④ 维护欠费 → 城墙失修（−5）', wl.halted && wl.hp === 55, 'halted=' + wl.halted + ' hp=' + wl.hp);
    D.settleTurn();
    ok('④ 连续欠费继续掉（−5/回合）', wl.hp === 50, 'hp=' + wl.hp);

    /* 补足铁金 → 回补 +2/回合（封顶） */
    const bag = AO.resSim[p.id], cen = AO.resCentral[1];
    wl.mAcc = { iron: 0, gold: 0 };
    bag.iron.stock = 200; bag.gold.stock = 200; cen.iron = 200; cen.gold = 200;
    D.settleTurn();
    ok('④ 补上维护 → 自动复工 + 回补 +2', !wl.halted && wl.hp === 52, 'halted=' + wl.halted + ' hp=' + wl.hp);

    /* 营造：驻防将 → 回补 +2+8 = +10/回合 */
    const gid = 99001;
    AO.resGenerals[gid] = { id: gid, name: '匠石', traitKey: 'fabric', owner: 1, armyId: 0 };
    const fabArmy = D.newArmy(1, p.id, { type: 'army', tier: 'leather', men: 1000, generalId: gid });
    ok('④ 词条「营造」在池子里', AO.milTraitOf('fabric').cn === '营造', AO.milTraitOf('fabric').desc);
    ok('④ 驻防将识别到了', !!D.fabricOf(p.id, 1), fabArmy.id);
    const h0 = wl.hp;
    D.settleTurn();
    ok('④ 营造将驻防 → 回补 +10/回合', wl.hp - h0 === 2 + W.fabricRegen, '+' + (wl.hp - h0));

    /* 守城战胜利后立即回充 15% */
    wl.hp = 40;
    const weak = D.newArmy(2, p.id, { type: 'army', tier: 'leather', men: 800 });
    const rep = D.fight([weak], [fabArmy], p, {});
    const back = Math.round(W.maxHp(wl.lv) * W.fabricRefill);
    ok('④ 守城胜 → 立即回充 15%', rep.winner === 'def' && rep.wall.refill === back,
      rep.winner + ' · 回充 +' + rep.wall.refill + '（应 +' + back + '）');

    /* 没有营造将的省不该有这份加成 */
    const p2 = w.provinces.find(q => q.owner === 1 && q.id !== p.id && D.wall[q.id] && D.wall[q.id].lv > 0);
    if (p2) {
      const w2 = D.wall[p2.id];
      w2.hp = 40; w2.halted = false;
      const b2 = AO.resSim[p2.id], c2 = AO.resCentral[1];
      b2.iron.stock = 200; b2.gold.stock = 200; c2.iron = 200; c2.gold = 200;
      const hh = w2.hp;
      D.settleTurn();
      ok('④ 无营造将 → 只回 +2', w2.hp - hh === 2, '+' + (w2.hp - hh));
    }
    return o;
  }));

  /* ---------------- ⑤ AI 首都 + 存档 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    let caps = 0, withWall = 0;
    for (const c of w.countries) {
      if (!c.capital) continue;
      caps++;
      const cp = w.provinces[c.capital - 1];
      const wl = cp && D.wall[cp.id];
      if (wl && wl.lv >= 1) withWall++;
    }
    ok('⑤ 每国首都开局都有 Lv1 墙', caps > 0 && withWall === caps, withWall + ' / ' + caps);

    /* 存档：WALL 进档，且只存有墙的省 */
    D.choosePlayer(1);
    D.save();
    let d = null;
    try { d = JSON.parse(localStorage.getItem(window.AO.SAVE_KEY)); } catch (e) { /* ignore */ }
    const nWall = d && d.WALL ? Object.keys(d.WALL).length : -1;
    ok('⑤ 存档带 WALL 字段', nWall >= caps, nWall + ' 条（首都 ' + caps + ' 个）');
    ok('⑤ 不升 SAVE_VER（并行批约定）', d && d.v === 6, d && ('v' + d.v));
    const sample = d && d.WALL ? d.WALL[Object.keys(d.WALL)[0]] : null;
    ok('⑤ 存档里每条墙都有 lv/hp/site/halted/mAcc',
      !!sample && 'lv' in sample && 'hp' in sample && 'site' in sample && 'halted' in sample && 'mAcc' in sample,
      sample ? JSON.stringify(sample) : '无');
    return o;
  }));

  /* 读档往返 */
  const beforeWall = await page.evaluate(() => {
    const D = window.AO.resDebug, k = Object.keys(D.wall)[0];
    return { n: Object.keys(D.wall).length, k: k, hp: k ? D.wall[k].hp : -1, lv: k ? D.wall[k].lv : -1 };
  });
  await page.evaluate(() => window.AO.resDebug.load());
  await sleep(3400);
  add(await page.evaluate((b) => {
    const D = window.AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const n = Object.keys(D.wall).length;
    ok('⑤ 读档恢复城墙条数', n === b.n, n + ' vs ' + b.n);
    ok('⑤ 读档恢复耐久与等级', D.wall[b.k] && D.wall[b.k].hp === b.hp && D.wall[b.k].lv === b.lv,
      b.k + ': Lv' + (D.wall[b.k] || {}).lv + ' hp' + (D.wall[b.k] || {}).hp + '（存的是 Lv' + b.lv + ' hp' + b.hp + '）');
    return o;
  }, beforeWall));

  /* 旧档（没有 WALL 字段）：补默认，不炸 */
  add(await page.evaluate(() => {
    const o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const raw = localStorage.getItem(window.AO.SAVE_KEY);
    const d = JSON.parse(raw);
    delete d.WALL;
    /* 再塞一条缺字段的（模拟"只写了一部分"的档） */
    d.WALL = { 1: { lv: 2 } };
    localStorage.setItem(window.AO.SAVE_KEY, JSON.stringify(d));
    window.AO.resDebug.load();
    return o.concat([{ name: '⑤ 旧档（无 WALL）待验证', ok: true }]);
  }));
  await sleep(3400);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    ok('⑤ 旧档不炸：页面还活着', !!D.world(), D.turn());
    const wl = D.wall[1];
    ok('⑤ 缺字段按 lv2 补默认（hp 顶到 60 / site 0 / mAcc 补空）',
      !!wl && wl.lv === 2 && wl.hp === 60 && wl.site === 0 && wl.mAcc && wl.mAcc.iron === 0,
      wl ? JSON.stringify(wl) : '无');
    ok('⑤ 没墙的省读出来就是 lv0/hp0', !D.wall[2] || (D.wall[2].lv | 0) === 0,
      D.wall[2] ? 'Lv' + D.wall[2].lv : '无记录（=没墙）');
    return o;
  }));

  await browser.close();

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
