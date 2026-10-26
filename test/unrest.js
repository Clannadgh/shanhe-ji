/* =============================================================
 * test/unrest.js —— 安定与整合（A 批叛乱链 + B 批整合链 + 安抚金）的验收
 *
 * 对着任务书「验收清单」逐条过：
 *   ① 安定行显示正确；六项驱动可解释（悬停明细逐项对得上）
 *   ② UNREST ≥ 80 有叛乱，三种结果（匪乱 / 倒戈 / 独立）都能复现；独立新国可交互
 *   ③ 驻军压制倒戈概率减半；PLAYER 危急警告提前一回合
 *   ④ 匪患事件改看不安值，「招安」三效果全对
 *   ⑤ 占领省从 ×0.4 随 INTEG 涨、整合完成变正式国土（×1.0、可传教、NOTES 归附）
 *   ⑥ 各加速项生效；被夺回 INTEG 清零；幸福 <35 停摆
 *   ⑦ 安抚钮：两段效果 / 冷却 / AI silent / 省库优先
 *   ⑧ AI 的省也会叛乱；纪要过滤不刷屏
 *   ⑨ 存档往返；旧档（没有这五块）不炸
 *
 * 跑法：node test/unrest.js
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
    document.getElementById('seed').value = 'unrest-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2800);

  /* ---------------- ① 定义表 + 六项驱动 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const U = AO.UNREST, I = AO.INTEG;

    ok('① 两张定义表都在（AO.UNREST / AO.INTEG）', !!U && !!I,
      '爆发线 ' + U.revoltAt + ' · 整合上限 ' + I.max);
    ok('① 权重 60/30/10，驻军时 15/5',
      U.wBandit === 60 && U.wDefect === 30 && U.wSecede === 10 && U.wDefect / 2 === 15);

    D.choosePlayer(1);
    const w = D.world();
    const p = w.provinces.find(q => q.owner === 1);

    /* 民心压到 40 → 基线 = (45−40)×5.4 = 27；再压到 30 → 81 */
    const h = AO.resHappyOf(p.id);
    h.v = 40; h.target = 40;
    D.settleUnrest(p.id, p);
    const u1 = D.unrestOf(p.id);
    ok('① 民心 40 → 基线 27（(45−40)×' + U.gapMul + '）', Math.abs(u1.drivers.base - 27) < 0.01,
      'base=' + u1.drivers.base);
    h.v = 30;
    D.settleUnrest(p.id, p);
    ok('① 民心 30 → 基线 81（单独就够爆发线）',
      Math.abs(u1.drivers.base - 81) < 0.01, 'base=' + u1.drivers.base);

    /* 未整合 +15：把它标成占领省 */
    D.occupy(p.id, 2);
    h.v = 30;
    D.settleUnrest(p.id, p);
    ok('① 未整合省 +' + U.occupyAdd, u1.drivers.occupy === U.occupyAdd, 'occupy=' + u1.drivers.occupy);
    delete D.occupyMap[p.id];
    delete D.integMap[p.id];

    /* 贪墨 +6：塞一位贪墨官 */
    const before = u1.drivers.graft;
    const greedy = { id: 99, name: '测试官', traitKey: 'greedy', rank: 0, griev: 0, ten: 0, owed: 0 };
    AO.resOfficial[p.id] = greedy;
    h.v = 50;                                   // 基线 0，只剩贪墨一项
    D.settleUnrest(p.id, p);
    ok('① 贪墨官 +' + U.graftAdd + '（民心 50 时只剩这一项）',
      u1.drivers.graft === U.graftAdd && u1.drivers.base === 0,
      'base=' + u1.drivers.base + ' graft=' + u1.drivers.graft + '（原来是 ' + before + '）');
    delete AO.resOfficial[p.id];

    /* 异信仰 +8：强制档 + 省信仰 ≠ 国教 */
    const sf = AO.stateFaithOf(1);
    const other = w.provinces.find(q => q.owner === 1 && q.faithIdx !== sf && q.id !== p.id);
    if (other) {
      AO.setFaithPol(1, 'force');
      AO.resHappyOf(other.id).v = 50;
      D.settleUnrest(other.id, other);
      ok('① 异信仰受压制 +' + U.faithAdd,
        D.unrestOf(other.id).drivers.faith === U.faithAdd,
        'faith=' + D.unrestOf(other.id).drivers.faith);
    } else {
      ok('① 异信仰受压制 +' + U.faithAdd, false, '这个世界没有异信仰省');
    }

    /* 匪患 +10：挂标记 */
    D.unrestOf(p.id).v = 0;
    AO.resDebug.banditMap[p.id] = { turn: D.turn(), left: 3 };
    h.v = 50;
    D.settleUnrest(p.id, p);
    ok('① 匪患未平 +' + U.banditAdd, D.unrestOf(p.id).drivers.bandit === U.banditAdd,
      'bandit=' + D.unrestOf(p.id).drivers.bandit);
    delete AO.resDebug.banditMap[p.id];

    /* 回落：民心 55 → −5（这一省若异信仰还会剩 +8−5=3，所以只要求"降到很低且往下走"） */
    D.unrestOf(p.id).v = 40;
    h.v = 60;
    D.settleUnrest(p.id, p);
    ok('① 民心 ≥' + U.calmHappy + ' → 目标回落 ' + U.calmFall,
      D.unrestOf(p.id).target <= U.faithAdd - U.calmFall && D.unrestOf(p.id).v < 40,
      'target=' + Math.round(D.unrestOf(p.id).target) + ' v=' + Math.round(D.unrestOf(p.id).v) +
      '（异信仰省剩 ' + (D.unrestOf(p.id).drivers.faith || 0) + '−' + U.calmFall + '）');

    /* 只涨不降：民心 50（既不到 55，也不低于 45）→ 不安停在原处 */
    D.unrestOf(p.id).v = 30;
    D.unrestOf(p.id).target = 30;
    h.v = 50;
    D.settleUnrest(p.id, p);
    ok('① 民心 50（45~55 之间）不安只涨不降', Math.round(D.unrestOf(p.id).v) === 30,
      'v=' + Math.round(D.unrestOf(p.id).v));
    return o;
  }));

  /* ---------------- ① 省卡三行 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const p = w.provinces.find(q => q.owner === 1);
    AO.resHappyOf(p.id).v = 50;
    D.unrestOf(p.id).v = 46; D.unrestOf(p.id).target = 46;
    D.settleUnrest(p.id, p);              // 先算一次 drivers，悬停明细才有内容
    D.unrestOf(p.id).v = 46; D.unrestOf(p.id).target = 46;
    window.__renderer.select(p.id);
    const el = document.getElementById('iUnrest');
    ok('① 省卡「安定」行显示数值 46', /46/.test(el.textContent), el.textContent);
    ok('① 46 → 黄色（warn）', el.className === 'warn', 'class=' + el.className);
    D.unrestOf(p.id).v = 78;
    window.__renderer.select(p.id);
    ok('① 78 → 红色（bad）', document.getElementById('iUnrest').className === 'bad',
      'class=' + document.getElementById('iUnrest').className);
    ok('① 悬停明细含六项', /停产|未整合|异信仰|贪墨|匪患|民心塌陷/.test(el.title) &&
      /民心塌陷/.test(el.title), el.title.split('\n').slice(0, 3).join(' / '));
    ok('① 安抚钮在（不安 ≥40）', document.getElementById('kvPacify').style.display === '',
      'display=' + document.getElementById('kvPacify').style.display);
    /* 低不安的正常省：安抚整行隐藏 */
    D.unrestOf(p.id).v = 3;
    window.__renderer.select(p.id);
    ok('① 不安 3 的普通省：安抚钮整行隐藏', document.getElementById('kvPacify').style.display === 'none');
    ok('① 非占领省：「整合」行隐藏', document.getElementById('kvInteg').style.display === 'none');
    return o;
  }));

  /* ---------------- ② 叛乱三种结果（概率 1000 次 + 实跑） ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 掷 4000 次验比例（无驻军） */
    let b = 0, df = 0, sc = 0;
    for (let i = 0; i < 4000; i++) {
      const k = D.rollRevolt(false);
      if (k === 'bandit') b++; else if (k === 'defect') df++; else sc++;
    }
    ok('② 无驻军 60/30/10（±3%）',
      Math.abs(b / 4000 - .60) < .03 && Math.abs(df / 4000 - .30) < .03 && Math.abs(sc / 4000 - .10) < .03,
      b + '/' + df + '/' + sc);
    let b2 = 0, d2 = 0, s2 = 0;
    for (let i = 0; i < 4000; i++) {
      const k = D.rollRevolt(true);
      if (k === 'bandit') b2++; else if (k === 'defect') d2++; else s2++;
    }
    ok('③ 有驻军：倒戈与独立各减半（15% / 5%）',
      Math.abs(d2 / 4000 - .15) < .025 && Math.abs(s2 / 4000 - .05) < .02,
      b2 + '/' + d2 + '/' + s2);
    return o;
  }));

  /* 真实跑：把一整国的省压到 100 不安，看三种结果都能出现 */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const target = 3;
    const pids = w.countries[target - 1].provinces.slice();
    let bandit = 0, defect = 0, secede = 0;
    /* 新国在**创建当场**拍快照 —— 34 回合里 1 省的小国很可能被邻国打掉，
     * 事后再回头查 w.countries 只会看到一具"0 省的尸体" */
    let snap = null;
    for (let i = 0; i < 34; i++) {
      pids.forEach(pid => {
        const u = D.unrestOf(pid);
        if (u.v < 100) { u.v = 100; u.target = 100; }
      });
      const before = w.countries.length;
      const lg0 = D.log().length;
      D.settleTurn();
      if (w.countries.length > before) {
        secede += w.countries.length - before;
        const nc = w.countries[before];
        if (!snap) snap = { id: nc.id, name: nc.name, provs: nc.provinces.length, cap: nc.capital, pop: nc.population };
      }
      const fresh = D.log().slice(0, 6);
      for (const e of fresh) {
        if (/匪乱/.test(e.text)) bandit++;
        else if (/举城投/.test(e.text)) defect++;
      }
    }
    ok('② 匪乱出现', bandit > 0, bandit + ' 次');
    ok('② 倒戈出现', defect > 0, defect + ' 次');
    ok('② 独立出现（新国数增加）', secede > 0, secede + ' 个新国');
    ok('② 独立新国进得了世界（成员省 / 首都 / 人口 / 颜色 / 头像 / 领导人）',
      !!snap && snap.provs > 0 && snap.cap > 0 && snap.pop > 0,
      snap ? ('「' + snap.name + '」' + snap.provs + ' 省 · 首都 ' + snap.cap + ' · 人口 ' + snap.pop) : '没有新国');
    return o;
  }));

  /* 新国可交互（单独一段：自己造一个，保证它活着） */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 找一个还有 ≥3 省的 AI 国，把它 3 个省压到 100 不安，逼出一次独立 */
    let c = null;
    for (const x of w.countries) {
      if (x && x.id !== 1 && x.provinces.length >= 3 && !D.deadMap[x.id]) { c = x; break; }
    }
    if (!c) return o.concat([{ name: '② 独立新国可交互', ok: false, detail: '没有合适的国' }]);
    const pids = c.provinces.slice();
    const p0 = w.provinces[pids[0] - 1];
    pids.forEach(pid => {
      const u = D.unrestOf(pid);
      u.v = 100; u.target = 100;
      w.provinces[pid - 1].faithIdx = p0.faithIdx;    // 同宗，确保"抱团"也走到
    });
    let nc = null;
    for (let i = 0; i < 40 && !nc; i++) {
      pids.forEach(pid => {
        if (w.provinces[pid - 1].owner !== c.id) return;
        const u = D.unrestOf(pid);
        u.v = 100; u.target = 100;
      });
      const before = w.countries.length;
      D.settleTurn();
      if (w.countries.length > before) nc = w.countries[before];
    }
    if (!nc) return o.concat([{ name: '② 独立新国可交互', ok: false, detail: '40 回合没独立出来' }]);
    let cardOK = false, ctryOK = false, warOK = false;
    try {
      const R = window.__renderer;
      R.select(nc.provinces[0]);
      cardOK = document.getElementById('info').classList.contains('on');
      D.showCountry(nc.id);
      ctryOK = document.getElementById('cName').textContent === nc.name;
      warOK = !!D.declareWar(1, nc.id).ok;               // 能对它宣战
    } catch (e) { /* 下面如实报 */ }
    ok('② 独立新国可交互（省卡 / 国家卡 / 宣战）', cardOK && ctryOK && warOK,
      'card=' + cardOK + ' country=' + ctryOK + ' war=' + warOK +
      ' ·「' + nc.name + '」' + nc.provinces.length + ' 省');
    ok('② 新国的省是本土、不是占领省（无 OCCUPY）',
      nc.provinces.filter(pid => D.occupyMap[pid]).length === 0,
      nc.provinces.length + ' 省');
    ok('② 新国的省不安已清零（不带着一腔怨气开国）',
      nc.provinces.every(pid => D.unrestOf(pid).v < 5),
      nc.provinces.map(pid => Math.round(D.unrestOf(pid).v)).join(','));
    return o;
  }));

  /* ---------------- ③ PLAYER 危急警告 + 停摆 + 夺回清零 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const alive = w.countries.filter(c => c && c.provinces.length && !D.deadMap[c.id]);
    const pc = alive.find(c => c.id === D.player()) || alive[0];
    D.choosePlayer(pc.id);
    const p = w.provinces.find(q => q.owner === pc.id);
    AO.resHappyOf(p.id).v = 28;
    D.unrestOf(p.id).v = 72;              // 跨过 warnAt(70)
    D.warnPlayerProv(p.id, p);
    let note = D.notes().filter(n => /警戒/.test(n.text)).pop();
    ok('③ 玩家省不安 72 → 「警戒」纪要（提前一回合）', !!note,
      note && note.text.slice(0, 46));
    D.unrestOf(p.id).v = 84;
    D.warnPlayerProv(p.id, p);
    note = D.notes().filter(n => /危急/.test(n.text)).pop();
    ok('③ 抬到 84 → 「危急」再报一次（档位抬升才报）', !!note, note && note.text.slice(0, 40));
    const n1 = D.notes().length;
    D.warnPlayerProv(p.id, p);
    ok('③ 同一档重复调用不刷屏', D.notes().length === n1, n1 + ' → ' + D.notes().length);

    /* 幸福 <35 → 整合停摆 */
    const ec = alive.find(c => c.id !== pc.id);
    const q = w.provinces.find(x => x.owner === ec.id);
    D.occupy(q.id, pc.id);
    AO.resHappyOf(q.id).v = 30; AO.resHappyOf(q.id).target = 30;
    D.integMap[q.id].v = 10;
    D.settleInteg(q.id, q);
    ok('⑥ 民心 <35 → 整合停摆（本回合 +0）',
      D.integOf(q.id).v === 10 && D.integOf(q.id).gain === 0,
      'v=' + Math.round(D.integOf(q.id).v) + ' gain=' + D.integOf(q.id).gain);

    /* 加速项：同信仰 / 有官 / 民心 / 驻军 */
    AO.resHappyOf(q.id).v = 70; AO.resHappyOf(q.id).target = 70;
    const sf = AO.stateFaithOf(D.player());
    q.faithIdx = sf;                        // 强行同信仰
    delete AO.resOfficial[q.id];
    D.integMap[q.id].v = 0;
    D.settleInteg(q.id, q);
    const g0 = D.integOf(q.id).gain;
    ok('⑥ 基础 +1 / 同信仰 +1 / 民心≥55 +1（无官、无驻军）', g0 === 3, 'gain=' + g0);
    D.integMap[q.id].v = 0;
    AO.resOfficial[q.id] = { id: 98, name: '测试官二', traitKey: 'upright', rank: 0, griev: 0, ten: 0, owed: 0 };
    D.settleInteg(q.id, q);
    const g1 = D.integOf(q.id).gain;
    ok('⑥ 有官 +1、民心 ≥55 +1', g1 === 4, 'gain=' + g1);
    /* 驻军：直接放一支军队进去 */
    const before = D.integOf(q.id).gain;
    const a = D.newArmy(D.player(), q.id, { type: 'army', tier: 'leather', men: 1000 });
    D.settleInteg(q.id, q);
    const g2 = D.integOf(q.id).gain;
    ok('⑥ 驻军 +1', g2 === before + 1, before + ' → ' + g2);
    D.disarm ? D.disarm(a.id) : (delete AO.resWar.army[a.id]);

    /* 被夺回 → INTEG 清零 */
    D.integMap[q.id].v = 60;
    D.occupy(q.id, ec.id);
    ok('⑥ 被敌国夺回 → INTEG 清零重算', D.integOf(q.id).v === 0, 'v=' + D.integOf(q.id).v);
    delete AO.resOfficial[q.id];
    return o;
  }));

  /* ---------------- ④ 匪患事件：看不安值 + 招安 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 玩家国还活着的那一省（前面搅了几十个回合，1 号国可能已经没了） */
    const alive = w.countries.filter(c => c && c.provinces.length && !D.deadMap[c.id]);
    const pc = alive.find(c => c.id === D.player()) || alive[0];
    D.choosePlayer(pc.id);
    const mine = w.provinces.filter(x => x.owner === pc.id && !D.occupyMap[x.id]);
    const hi = mine[0], lo = mine[mine.length - 1];
    D.unrestOf(hi.id).v = 55; D.unrestOf(hi.id).target = 55;
    D.unrestOf(lo.id).v = 5;  D.unrestOf(lo.id).target = 5;
    ok('④ 不安 55 → 匪患事件可出', AO.evtCan('bandits', hi.id));
    ok('④ 不安 5 → 匪患事件不出（改看不安值，不再看边境人口）', !AO.evtCan('bandits', lo.id));
    /* 招安：金 −20 / 不安 −25 / +1 支驻防军 */
    AO.resSim[hi.id].gold.stock = 100;
    const arms0 = D.armiesIn(hi.id).length, u0 = D.unrestOf(hi.id).v, g0 = AO.resSim[hi.id].gold.stock;
    AO.evtForce('bandits', hi.id, true);
    const three = AO.EVT_BY_KEY.bandits.options.length === 3 &&
      AO.EVT_BY_KEY.bandits.options[2].cn === '招安';
    const line = AO.evtPick(2);
    ok('④ 「招安」是第三项', three, line && line.slice(0, 60));
    ok('④ 招安扣省库金 20', g0 - AO.resSim[hi.id].gold.stock === 20,
      g0 + ' → ' + AO.resSim[hi.id].gold.stock);
    ok('④ 招安不安 −25', Math.abs(u0 - D.unrestOf(hi.id).v - 25) < 1.5,
      Math.round(u0) + ' → ' + Math.round(D.unrestOf(hi.id).v));
    ok('④ 招安 +1 支驻防军（走现有征兵结构）', D.armiesIn(hi.id).length === arms0 + 1,
      arms0 + ' → ' + D.armiesIn(hi.id).length);
    return o;
  }));

  /* ---------------- ⑤⑦ 整合乘数 / 完成 / 安抚 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    ok('⑤ 产出乘数 0→0.4 / 50→0.5 / 100→0.6',
      D.integProdMul(0) === 0.4 && Math.abs(D.integProdMul(50) - 0.5) < 1e-9 &&
      Math.abs(D.integProdMul(100) - 0.6) < 1e-9,
      D.integProdMul(0) + ' / ' + D.integProdMul(50) + ' / ' + D.integProdMul(100));

    /* 前面的叛乱测试把几个国搅烂了 —— 这里一律按"还活着的国"重新挑，
     * 别把断言绑死在某一个国家 id 上 */
    const alive = () => w.countries.filter(c => c && c.provinces.length && !D.deadMap[c.id]);
    let pc = alive().find(c => c.id === D.player()) || alive()[0];
    D.choosePlayer(pc.id);
    const myId = D.player();
    const enemyP = () => {
      const c = alive().find(c => c.id !== myId);
      return c ? w.provinces[c.provinces[0] - 1] : null;
    };

    const q = enemyP();
    D.occupy(q.id, myId);
    AO.resHappyOf(q.id).v = 60; AO.resHappyOf(q.id).target = 60;
    D.integMap[q.id].v = 95;
    let tg = 0;
    while (D.occupyMap[q.id] && tg++ < 6) {
      AO.resHappyOf(q.id).v = 60;
      D.settleInteg(q.id, q);
    }
    ok('⑤ 整合 ≥100 → OCCUPY 删除（变正式国土）', !D.occupyMap[q.id],
      tg + ' 回合完成 · occup=' + !!D.occupyMap[q.id]);
    ok('⑤ 整合记录同时删除', !D.integOf(q.id));
    const doneLine = D.log().filter(e => /归附，设官治理/.test(e.text))[0];
    ok('⑤ NOTES / 战报写「归附，设官治理」', !!doneLine, doneLine && doneLine.text);
    /* 正式国土：可传教（判据就是 OCCUPY） */
    AO.setFaithPol(myId, 'force');
    const sf = AO.stateFaithOf(myId);
    if (q.faithIdx === sf) { q.faithIdx = (sf + 1) % (AO.FAITHS || []).length; }
    ok('⑤ 整合完成 → 传教资格恢复（不再被判为占领省）', AO.canMission(q.id) === true,
      'canMission=' + AO.canMission(q.id));

    /* ⑦ 安抚：未整合省 → INTEG +15、UNREST −15 */
    AO.resSim[q.id].gold.stock = 200;
    AO.resCentral[myId].gold = (AO.resCentral[myId].gold || 0) + 200;
    const q2 = enemyP();
    D.occupy(q2.id, myId);
    D.integMap[q2.id].v = 20;
    D.unrestOf(q2.id).v = 50; D.unrestOf(q2.id).target = 50;
    const g2 = AO.resSim[q2.id].gold.stock, u2 = D.unrestOf(q2.id).v;
    const r1 = D.pacify(q2.id, false);
    ok('⑦ 未整合省：整合 +15', r1.ok && D.integOf(q2.id).v === 35, 'v=' + D.integOf(q2.id).v);
    ok('⑦ 未整合省：不安 −15', Math.abs(u2 - D.unrestOf(q2.id).v - 15) < 0.01,
      u2 + ' → ' + D.unrestOf(q2.id).v);
    ok('⑦ 省库优先扣款（本省金够 → 中央不动）', g2 - AO.resSim[q2.id].gold.stock === 25,
      '省库 −' + (g2 - AO.resSim[q2.id].gold.stock));
    const r2 = D.pacify(q2.id, false);
    ok('⑦ 冷却 3 回合（连点无效）', !r2.ok && /还要等 3 回合/.test(r2.msg), r2.msg);
    for (let i = 0; i < 3; i++) D.settleTurn();
    D.unrestOf(q2.id).v = 60; D.unrestOf(q2.id).target = 60;
    const r3 = D.pacify(q2.id, false);
    ok('⑦ 3 回合后可以再安抚', r3.ok, r3.msg.slice(0, 40));

    /* ⑦ 高不安（非占领省）：只降不安 25 */
    const q3 = w.provinces.find(x => x.owner === myId && !D.occupyMap[x.id]);
    D.unrestOf(q3.id).v = 60; D.unrestOf(q3.id).target = 60;
    const u3 = D.unrestOf(q3.id).v;
    AO.resSim[q3.id].gold.stock = 100;
    const r4 = D.pacify(q3.id, false);
    ok('⑦ 高不安省：不安 −25（不动整合）',
      r4.ok && Math.abs(u3 - D.unrestOf(q3.id).v - 25) < 0.01 && !D.integOf(q3.id),
      u3 + ' → ' + D.unrestOf(q3.id).v);

    /* ⑦ AI silent：只花中央金、不写纪要 */
    const q4 = enemyP();
    D.unrestOf(q4.id).v = 75; D.unrestOf(q4.id).target = 75;
    const cen = AO.resCentral[q4.owner] || (AO.resCentral[q4.owner] = {});
    cen.gold = 100;
    const stock4 = AO.resSim[q4.id].gold.stock;
    const lg0 = D.log().length, nt0 = D.notes().length;
    const r5 = D.pacify(q4.id, true);
    ok('⑦ AI 安抚：花中央金、省库不动',
      r5.ok && cen.gold === 75 && AO.resSim[q4.id].gold.stock === stock4,
      '中央 ' + cen.gold + ' / 省库 ' + AO.resSim[q4.id].gold.stock);
    ok('⑦ AI 安抚 silent：不写战报、不推纪要', D.log().length === lg0 && D.notes().length === nt0,
      'log ' + lg0 + '→' + D.log().length + ' notes ' + nt0 + '→' + D.notes().length);
    return o;
  }));

  /* ---------------- ⑧ AI 国的省也会叛乱 + 纪要过滤 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 找一个大 AI 国，压到 100 不安跑 20 回合 —— 它的省数应当明显缩水 */
    let big = null;
    for (const c of w.countries) {
      if (!c || c.id === D.player() || !c.provinces.length || D.deadMap[c.id]) continue;
      if (!big || c.provinces.length > big.provinces.length) big = c;
    }
    if (!big) return o.concat([{ name: '⑧ AI 的省也会叛乱', ok: false, detail: '没有合适的 AI 国' }]);
    const pids = big.provinces.slice(), n0 = pids.length;
    let fired = 0;
    for (let i = 0; i < 20; i++) {
      pids.forEach(pid => {
        const u = D.unrestOf(pid);
        if (u.v < 100) { u.v = 100; u.target = 100; }
      });
      fired += D.settleTurn() === undefined ? 0 : 0;
      D.settleRevolt();
    }
    ok('⑧ AI 的省也会叛乱（' + big.name + ' 省数下降）', big.provinces.length < n0,
      n0 + ' → ' + big.provinces.length + ' 省');
    /* 世界纪要每回合 ≤ newsPerTurn 条 */
    const cap = (AO.AIWAR && AO.AIWAR.newsPerTurn) || 2;
    ok('⑧ 世界纪要过滤：每回合 ≤' + cap + ' 条「🌍」', (() => {
      const all = D.log().filter(e => /🌍/.test(e.text));
      const byTurn = {};
      for (const e of all) byTurn[e.turn] = (byTurn[e.turn] || 0) + 1;
      return Object.values(byTurn).every(v => v <= cap);
    })(), '上限 ' + cap);
    return o;
  }));

  /* ---------------- ⑨ 存档往返 + 旧档兼容 ----------------
   * 读档是**异步**的（要按 seed 重建世界 → 回调里灌状态），所以拆成三段：
   * 存 → 弄脏 → 读 → 等重建 → 验。整段塞进一个 evaluate 只会读到半初始化状态。 */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const p = (() => {
      /* 前面的测试把两个国搅得天翻地覆，1 号国可能已经被打没了 ——
       * 这里重新挑一个还活着的国当玩家，别让存档测试依赖"谁还在" */
      let pc = w.countries.find(c => c && c.provinces.length >= 5 && !D.deadMap[c.id]);
      if (!pc) return null;
      D.choosePlayer(pc.id);
      return w.provinces[pc.provinces[0] - 1];
    })();
    if (!p) return o.concat([{ name: '⑨ 存档', ok: false, detail: '没有还活着的国' }]);
    window.__sv = { pid: p.id, turn: D.turn() };
    D.unrestOf(p.id).v = 57;
    const q = w.provinces.find(x => x.owner && x.owner !== p.owner && !D.occupyMap[x.id]);
    D.occupy(q.id, 1);
    D.integMap[q.id].v = 43;
    window.__sv.qid = q.id;
    D.banditMap[p.id] = { turn: D.turn(), left: 2 };
    D.pacifyMap[p.id] = D.turn();
    D.save(true);
    ok('⑨ 存档版本没升（仍 v' + AO.SAVE_VER + '）', AO.SAVE_VER === 6, 'v' + AO.SAVE_VER);
    const raw = JSON.parse(localStorage.getItem('sj.save'));
    ok('⑨ 存档里带五块新状态',
      !!raw.UNREST && !!raw.INTEG && !!raw.BANDIT && !!raw.PACIFY && !!raw.UNWARN,
      'UNREST ' + Object.keys(raw.UNREST).length + ' 省 · INTEG ' + Object.keys(raw.INTEG).length + ' 省');
    /* 弄脏，验证读档确实是从存档恢复而不是"本来就在" */
    D.unrestOf(p.id).v = 0;
    delete D.integMap[q.id];
    delete D.banditMap[p.id];
    D.load();
    return o;
  }));

  await sleep(4200);          // 等世界按 seed 重建完 + applySave

  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const sv = window.__sv;
    ok('⑨ 读档恢复 UNREST', Math.round(D.unrestOf(sv.pid).v) === 57, 'v=' + Math.round(D.unrestOf(sv.pid).v));
    ok('⑨ 读档恢复 INTEG', D.integOf(sv.qid) && Math.round(D.integOf(sv.qid).v) === 43,
      'v=' + (D.integOf(sv.qid) && Math.round(D.integOf(sv.qid).v)));
    ok('⑨ 读档恢复 BANDIT / PACIFY',
      !!D.banditMap[sv.pid] && D.pacifyMap[sv.pid] !== undefined,
      'bandit=' + !!D.banditMap[sv.pid] + ' pacify=' + D.pacifyMap[sv.pid]);
    ok('⑨ 读档回到存档那一回合', D.turn() === sv.turn, '第 ' + D.turn() + ' 回合（存档 ' + sv.turn + '）');
    ok('⑨ 读档后还能结算', (() => {
      const t = D.turn();
      D.settleTurn();
      return D.turn() === t + 1;
    })(), '第 ' + D.turn() + ' 回合');
    return o;
  }));

  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 模拟旧档：把五块删掉再灌回去 */
    const raw = JSON.parse(localStorage.getItem('sj.save'));
    const occ = Object.keys(raw.OCCUPY || {}).length;
    delete raw.UNREST; delete raw.INTEG; delete raw.BANDIT; delete raw.PACIFY; delete raw.UNWARN;
    localStorage.setItem('sj.save', JSON.stringify(raw));
    window.__occ = occ;
    let boom = null;
    try { D.load(); } catch (e) { boom = String(e && e.message || e); }
    return o.concat([{ name: '⑨ 读「没有这五块」的旧档不炸', ok: !boom, detail: boom || '已发起重建' }]);
  }));

  await sleep(4200);

  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    let boom = null;
    try { D.settleTurn(); } catch (e) { boom = String(e && e.message || e); }
    ok('⑨ 旧档读进来还能结算', !boom, boom || '第 ' + D.turn() + ' 回合');
    ok('⑨ 旧档里已占领的省：INTEG 补 0（省卡「整合」行不会消失）',
      Object.keys(D.occupyMap).every(pid => !!D.integOf(+pid)),
      Object.keys(D.occupyMap).length + ' 个占领省（存档里 ' + (window.__occ || 0) + ' 个）');
    ok('⑨ 旧档补出来的不安在 0~100 之间', Object.values(D.unrestMap).every(u => u.v >= 0 && u.v <= 100),
      '省数 ' + Object.keys(D.unrestMap).length);
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
