/* =============================================================
 * test/ai-gov.js —— AI 收官第三批（吏部 / 战时经济）的验收
 *
 * 对着任务书的 §2 / §4 / §9 逐条过：
 *   ① 官员资历与怨气：rank/ten/griev 三字段、每回合累积、24 回合掷去留、
 *      连续倍率（无死区）、怨望与侵吞两个节点、卸任规则、俸禄 × 资历、赏赐
 *   ② AI 吏部：赏（按 rank 分线 + 性格修正 + 冷却 + 国库门槛）、
 *      撤（怨气超线 → 回池 → 补人）、战时只保 rank≥2、全程不推 NOTES
 *   ③ 战时经济：维修档位换挡（军备高 / 资源中 / 民用低）、停战恢复、
 *      建造只留军备类、俸禄照付不欠、护栏优先
 *   ④ 存档：rank/ten/griev 随档往返；旧档（无这三个字段）读进来补 0 不炸
 *
 * 跑法：node test/ai-gov.js
 * 240 省 / 12 国的小世界，约 40 秒。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
const add = (list) => { for (const c of list) out.push(c); };

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);
  await page.evaluate(() => {
    document.getElementById('prov').value = 240;
    document.getElementById('ctry').value = 12;
    document.getElementById('seed').value = 'ai-gov-spec';
    document.getElementById('gen').click();
  });
  await sleep(3000);

  /* ---------------- ⓪ 定义区就位 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const G = A.GOV, E = A.AIECON, W = A.AIWAR;
    ok('⓪ 资历与怨气数值在 AO.GOV（玩家与 AI 同一份）',
      G.rankMax === 3 && G.rankFx === 0.15 && G.grievFx === 0.005 &&
      JSON.stringify(G.rankPay) === '[1,1.25,1.5,2]' && !!G.griev,
      'rankMax=' + G.rankMax + ' rankPay=' + JSON.stringify(G.rankPay));
    ok('⓪ 怨气曲线：基础 1/12 · 民心差 1/6 · 欠饷 +2 · 每 24 回合掷',
      G.griev.base === 12 && G.griev.lowEvery === 6 && G.griev.owedPer === 2 &&
      G.griev.rollEvery === 24 && G.griev.promote === 0.45 && G.griev.resentAdd === 20,
      JSON.stringify(G.griev));
    ok('⓪ 两个节点：怨望 60 / 侵吞 90 · 赏赐 15 金 −25',
      G.griev.warn === 60 && G.griev.steal === 90 &&
      G.griev.reward === 15 && G.griev.rewardCut === 25);
    ok('⓪ AI 吏部线值（rank0 永不赏 · 撤换 70/80/80/90）',
      !!E.gov && E.gov.rewardByRank[0] === null &&
      JSON.stringify(E.gov.fireByRank) === '[70,80,80,90]' &&
      E.gov.personaAdj.econ === -10 && E.gov.personaAdj.mil === 10,
      JSON.stringify(E.gov.rewardByRank) + ' / ' + JSON.stringify(E.gov.fireByRank));
    ok('⓪ 战时经济定义（军备/资源/民用三档 + 战时建造白名单）',
      !!W.warEcon && W.warEcon.milPrio === 'p1' && W.warEcon.civPrio === 'p3' &&
      W.warEcon.build.indexOf('barracks') >= 0 && W.warEcon.build.indexOf('school') < 0,
      JSON.stringify(W.warEcon.build));
    ok('⓪ 导出齐（resReward / resOffMul / aiDebug.gov / warEcon）',
      typeof A.resReward === 'function' && typeof A.resOffMul === 'function' &&
      typeof A.aiDebug.gov === 'function' && typeof A.aiDebug.warEcon === 'function');
    return o;
  }));

  /* 选玩家国 1，其余归 AI */
  await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });

  /* ---------------- ① 资历 / 怨气：公式与逐回合累积 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const near = (a, b, eps) => Math.abs(a - b) <= (eps || 0.02);

    /* 倍率：连续、无死区 */
    ok('① 倍率 = 资历 × 怨气（rank3 → ×1.45 · griev100 → ×0.5）',
      near(A.resOffMul({ rank: 3, griev: 0 }), 1.45) &&
      near(A.resOffMul({ rank: 0, griev: 100 }), 0.5) &&
      near(A.resOffMul({ rank: 3, griev: 100 }), 0.725),
      [A.resOffMul({ rank: 3, griev: 0 }), A.resOffMul({ rank: 0, griev: 100 }),
        A.resOffMul({ rank: 3, griev: 100 })].map(x => x.toFixed(3)).join(' / '));
    ok('① 没有死区：怨气 59 与 61 的倍率不同',
      Math.abs(A.resOffMul({ rank: 0, griev: 59 }) - A.resOffMul({ rank: 0, griev: 61 })) > 0.005,
      A.resOffMul({ rank: 0, griev: 59 }).toFixed(3) + ' vs ' +
      A.resOffMul({ rank: 0, griev: 61 }).toFixed(3));

    /* 词条 fx 是"按倍率缩放"，不是简单相乘 */
    const f0 = A.resOffFx({ traitKey: 'finance', rank: 0, griev: 0 });
    const f1 = A.resOffFx({ traitKey: 'finance', rank: 0, griev: 100 });
    ok('① 词条按倍率缩放（理财 1.2 → 怨气满时 1.1，不是 0.6）',
      near(f0.taxMul, 1.2) && near(f1.taxMul, 1.1),
      f0.taxMul.toFixed(3) + ' / ' + f1.taxMul.toFixed(3));

    /* PMOD 真的乘上去 */
    const pid = D.world().countries[0].provinces[0];
    const bak = A.resOfficial[pid];
    A.resOfficial[pid] = { id: 99001, name: '测试甲', traitKey: 'finance', owed: 0,
      rank: 0, ten: 0, griev: 100, salAcc: 0 };
    const mul1 = D.pmod(pid).taxMul;
    A.resOfficial[pid].rank = 3; A.resOfficial[pid].griev = 0;
    const mul2 = D.pmod(pid).taxMul;
    if (bak) A.resOfficial[pid] = bak; else delete A.resOfficial[pid];
    ok('① PMOD 走同一个倍率（怨吏 1.1 / 能臣 1.29）',
      near(mul1, 1.1) && near(mul2, 1 + 0.2 * 1.45),
      mul1.toFixed(3) + ' → ' + mul2.toFixed(3));

    /* 俸禄 × 资历：小数攒整，长期平均真的是倍率 */
    const mk = (rank) => ({ traitKey: 'plain', owed: 0, rank: rank, ten: 0, griev: 0, salAcc: 0 });
    const sum = (rank, n) => { const f = mk(rank); let s = 0; for (let i = 0; i < n; i++) s += A.resSalaryOf(f); return s; };
    /* tooltip 与玩家同公式：省卡/面板悬停读的就是这一份文案 */
    const tip = A.resOffTitle({ traitKey: 'finance', owed: 2, rank: 2, ten: 30,
      griev: 66, salAcc: 0 });
    ok('① tooltip 里有资历 / 怨气 / 效果倍率 / 俸禄（和结算同一公式）',
      /倍率 ×/.test(tip) && /资历 2/.test(tip) && /66\/100/.test(tip) &&
      /俸禄 1\.50/.test(tip) && /怨望/.test(tip),
      tip.split('\n').slice(1, 3).join(' | '));

    ok('① 俸禄按资历 ×1/1.25/1.5/2（8 回合合计 8/10/12/16）',
      sum(0, 8) === 8 && sum(1, 8) === 10 && sum(2, 8) === 12 && sum(3, 8) === 16,
      [sum(0, 8), sum(1, 8), sum(2, 8), sum(3, 8)].join(' / '));

    /* 逐回合累积：基础 1/12 */
    const P = A.resOfficial;
    const provs = D.country(D.player()).provinces;
    const pid2 = provs[0];
    P[pid2] = { id: 99002, name: '测试乙', traitKey: 'plain', owed: 0,
      rank: 0, ten: 0, griev: 0, salAcc: 0 };
    /* 避开 24 回合掷骰（掷了会 +20 怨气，污染这条曲线） */
    let t = 100;
    while ((t + 99002) % 24 === 0) t++;
    D.setTurn(t);
    const ten0 = P[pid2].ten;
    for (let i = 0; i < 12; i++) D.settleOfficials();
    ok('① 每回合 ten++ 且基础怨气 1/12 回合（12 回合 ≈ +1）',
      P[pid2].ten === ten0 + 12 && near(P[pid2].griev, 1, 0.03),
      'ten ' + ten0 + ' → ' + P[pid2].ten + ' · griev ' + P[pid2].griev.toFixed(3));

    /* 民心 <45 → 1/6 */
    P[pid2].griev = 0;
    D.happy[pid2].v = 40;
    let t2 = 200;
    while ((t2 + 99002) % 24 === 0) t2++;
    D.setTurn(t2);
    D.settleOfficials();
    const g1 = P[pid2].griev;
    D.happy[pid2].v = 60;
    D.settleOfficials();
    const g2 = P[pid2].griev - g1;
    ok('① 民心 <45 时怨气 +1/6（正常 +1/12）',
      near(g1, 1 / 6, 0.01) && near(g2, 1 / 12, 0.01),
      '民心差 ' + g1.toFixed(3) + ' vs 正常 ' + g2.toFixed(3));

    /* 欠饷 +2/回合 */
    P[pid2].owed = 3;
    const g3 = P[pid2].griev;
    D.settleOfficials();
    ok('① 欠饷每回合再 +2', P[pid2].griev - g3 > 2, '+' + (P[pid2].griev - g3).toFixed(2));
    P[pid2].owed = 0;

    /* 24 回合掷去留：45 / 45 / 10 */
    const realRnd = Math.random;
    let t3 = 300;
    while ((t3 + 99002) % 24 !== 0) t3++;
    D.setTurn(t3);
    const roll = (r) => {
      Math.random = () => r;
      P[pid2].rank = 0; P[pid2].griev = 0;
      D.settleOfficials();
      return { rank: P[pid2].rank, griev: P[pid2].griev };
    };
    const rp = roll(0.10), ri = roll(0.60), rr = roll(0.95);
    Math.random = realRnd;
    ok('① 每 24 回合掷去留：45% 擢升 / 45% 无事 / 10% 怨望 +20',
      rp.rank === 1 && ri.rank === 0 && near(ri.griev, 1 / 12, 0.01) &&
      rr.rank === 0 && rr.griev > 20,
      '擢升 rank ' + rp.rank + ' · 无事 griev ' + ri.griev.toFixed(2) +
      ' · 怨望 griev ' + rr.griev.toFixed(1));

    /* 封顶 3 */
    P[pid2].rank = 3;
    const realRnd2 = Math.random;
    Math.random = () => 0.1;
    D.settleOfficials();
    Math.random = realRnd2;
    ok('① 资历封顶 3（柱国不再升）', P[pid2].rank === 3, P[pid2].rank);

    delete P[pid2];
    return o;
  }));

  /* ---------------- ①b 节点：怨望纪要 / 侵吞 / 卸任 / 赏赐 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const me = D.player();
    const w = D.world();
    const minePid = D.country(me).provinces[0];
    const aiC = w.countries.find(c => c.id !== me && c.provinces.length > 2);
    const aiPid = aiC.provinces[0];

    /* 怨望：玩家国首次 ≥60 → 一条纪要（只报一次） */
    D.notes().length = 0;
    A.resOfficial[minePid] = { id: 99003, name: '测试丙', traitKey: 'plain', owed: 0,
      rank: 1, ten: 0, griev: 60, salAcc: 0 };
    let t = 400; while ((t + 99003) % 24 === 0) t++;
    D.setTurn(t);
    D.settleOfficials();
    const n1 = D.notes().filter(x => /怨望/.test(x.text)).length;
    D.settleOfficials();
    const n2 = D.notes().filter(x => /怨望/.test(x.text)).length;
    ok('① 怨气首次 ≥60 →「怨望」纪要一次（不刷屏）', n1 === 1 && n2 === 1, n1 + ' → ' + n2);

    /* AI 国官员不推纪要 */
    D.notes().length = 0;
    A.resOfficial[aiPid] = { id: 99004, name: '测试丁', traitKey: 'plain', owed: 0,
      rank: 1, ten: 0, griev: 59.9, salAcc: 0 };
    let t2 = 500; while ((t2 + 99004) % 24 === 0) t2++;
    D.setTurn(t2);
    D.settleOfficials();
    D.settleOfficials();
    /* 只看"怨望 / 这位 AI 官员"的条目 —— 同一回合玩家国自己的官也可能擢升，
     * 那是该报的，不能算在 AI 头上。 */
    const aiNotes = D.notes().filter(x => /怨望/.test(x.text) && /测试丁/.test(x.text));
    ok('① AI 国官员的怨望不进玩家纪要', aiNotes.length === 0,
      '相关条目 ' + aiNotes.length + ' 条（全部纪要 ' + D.notes().length + ' 条）');

    /* 侵吞：griev ≥90 → 每回合从省库偷 1 金（记 FLOW loss）。
     * 省库同时还在收人口税，所以不能拿绝对值比 —— 跑两遍（低怨气 / 高怨气），
     * 差额正好是那 1 金才说明"是侵吞拿走的"。 */
    const bag = A.resSim[minePid];
    const fresh = () => { D.flow[minePid] = { gain: {}, loss: {}, d: { eat: {}, tax: {}, maint: {}, maintC: {}, cap: {} } }; };
    const runTax = (griev) => {
      bag.gold.stock = 10;
      A.resOfficial[minePid].griev = griev;
      A.resOfficial[minePid].rank = 0;
      A.resOfficial[minePid].owed = 0;
      A.resOfficial[minePid].salAcc = 0;
      fresh();
      A.resSettleTax(minePid, me, w.provinces[minePid - 1]);
      /* 看**流出**而不是存量：省库同时还在收人口税、发俸禄，
       * 存量差额会被 TAXACC 的小数零头搅乱；loss 只记真正流出去的。 */
      return { steal: D.flow[minePid].d.steal || 0,
        loss: D.flow[minePid].loss.gold || 0 };
    };
    const lo = runTax(0), hi = runTax(95);
    ok('① 怨气 ≥90 → 每回合侵吞 1 金（FLOW loss 多出 1 金）',
      lo.steal === 0 && hi.steal === 1 && Math.abs((hi.loss - lo.loss) - 1) < 1e-9,
      '低怨气 loss ' + lo.loss + '（steal ' + lo.steal + '）· 高怨气 loss ' +
      hi.loss + '（steal ' + hi.steal + '）');

    /* 卸任：资历减半、怨气/在任清零；rank≥2 推一条荣休 */
    D.notes().length = 0;
    const off = A.resOfficial[minePid];
    off.rank = 3; off.ten = 10; off.griev = 80;
    const back = D.dismiss(minePid, false);
    const pool = A.resDebug.talent[me].pool;
    ok('① 卸任：资历减半（3 → 1）· 怨气与在任清零 · 回候选池',
      !A.resOfficial[minePid] && back.rank === 1 && back.griev === 0 && back.ten === 0 &&
      pool.indexOf(back) >= 0,
      'rank 3 → ' + back.rank + ' · griev ' + back.griev + ' · 池 ' + pool.length);
    ok('① rank ≥2 卸任 → 一条「荣休」纪要',
      D.notes().filter(x => /荣休/.test(x.text)).length === 1,
      D.notes().map(x => x.text).join(' | ').slice(0, 60));

    /* 赏赐：中央金 −15 → 怨气 −25（玩家与 AI 同一个函数） */
    const cen = D.ensureCentral(me);
    cen.gold = 100;
    A.resOfficial[minePid] = { id: 99005, name: '测试戊', traitKey: 'plain', owed: 0,
      rank: 1, ten: 0, griev: 60, salAcc: 0 };
    const rw = A.resReward(minePid);
    ok('① 赏赐：中央金 −15 → 怨气 −25',
      rw.ok && cen.gold === 85 && Math.abs(A.resOfficial[minePid].griev - 35) < 1e-9,
      '中央 ' + cen.gold + ' · 怨气 ' + A.resOfficial[minePid].griev);
    cen.gold = 5;
    const rw2 = A.resReward(minePid);
    ok('① 国库不够就赏不了（不给负国库开后门）', !rw2.ok && cen.gold === 5, rw2.msg);

    /* 俸禄按 rank 从省库发：rank3 → 2 金/回合 */
    cen.gold = 100;
    bag.gold.stock = 50;
    A.resOfficial[minePid].rank = 3;
    A.resOfficial[minePid].owed = 0;
    D.flow[minePid] = { gain: {}, loss: {}, d: { eat: {}, tax: {}, maint: {}, maintC: {}, cap: {} } };
    A.resSettleTax(minePid, me, w.provinces[minePid - 1]);
    ok('① 俸禄按 rank ×2（rank3 每回合 2 金，省库出）',
      D.flow[minePid].d.salary === 2, 'd.salary=' + D.flow[minePid].d.salary);

    delete A.resOfficial[minePid];
    delete A.resOfficial[aiPid];
    return o;
  }));

  /* ---------------- ② AI 吏部：赏 / 撤 / 补 / 战时收紧 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, E = A.AIECON, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const me = D.player();
    const w = D.world();
    const c = w.countries.find(x => x.id !== me && x.provinces.length >= 4);
    const cid = c.id;
    const pid = c.provinces[0];
    const pid2 = c.provinces[1];
    const cen = D.ensureCentral(cid);
    const mkOff = (id, rank, griev, name) => ({ id: id, name: name || ('吏' + id),
      traitKey: 'plain', owed: 0, rank: rank, ten: 0, griev: griev, salAcc: 0 });

    /* 线值 + 性格修正 */
    ok('② 赏赐线按资历分档 + 性格修正（经营 −10 / 军国 +10 / rank0 永不赏）',
      AI.rewardLine(E.gov, 3) === 45 && AI.rewardLine(E.gov, 1) === 50 &&
      AI.rewardLine(E.gov, 0) === null,
      JSON.stringify(E.gov.rewardByRank));

    /* 赏：怨气 60、rank1、国库宽裕 → 花 15 压 25 */
    cen.gold = 200;
    A.resOfficial[pid] = mkOff(99101, 1, 60);
    let t = 700; while ((t + 99101) % 24 === 0) t++;
    D.setTurn(t);
    D.notes().length = 0;
    const n1 = AI.gov(c, 'balanced');
    ok('② AI 赏赐：中央 −15、怨气 60 → 35',
      n1 >= 1 && cen.gold === 185 && Math.abs(A.resOfficial[pid].griev - 35) < 1e-9,
      'n=' + n1 + ' 中央 ' + cen.gold + ' 怨气 ' + A.resOfficial[pid].griev.toFixed(0));
    ok('② AI 赏赐 / 撤换不推玩家纪要', D.notes().length === 0, D.notes().length + ' 条');

    /* 冷却：同一位官 12 回合内不重复赏 */
    A.resOfficial[pid].griev = 60;
    const gold0 = cen.gold;
    AI.gov(c, 'balanced');
    ok('② 同一位官 12 回合冷却（不给钱刷怨气）',
      cen.gold === gold0, '中央 ' + gold0 + ' → ' + cen.gold);

    /* 国库门槛：中央 <30 一分不赏 */
    cen.gold = 20;
    A.resOfficial[pid].rewardAt = 0;
    A.resOfficial[pid].griev = 60;
    AI.gov(c, 'balanced');
    ok('② 中央金 <30 就不赏（国库比面子要紧）', cen.gold === 20, '中央 ' + cen.gold);

    /* rank0 永不赏（但还没到撤换线） */
    cen.gold = 200;
    A.resOfficial[pid] = mkOff(99102, 0, 55);
    const g0 = cen.gold;
    AI.gov(c, 'balanced');
    ok('② rank0 永不赏（新手还没攒够本钱）',
      cen.gold === g0 && Math.abs(A.resOfficial[pid].griev - 55) < 1e-9,
      '中央 ' + cen.gold + ' 怨气 ' + A.resOfficial[pid].griev);

    /* 撤：怨气超线 → 回池 → 立刻补人（池里有人） */
    A.resOfficial[pid] = mkOff(99103, 1, 85);
    const T = A.resTalentOf(cid);
    T.pool.push(mkOff(99104, 0, 0, '候补甲'));
    const oldId = A.resOfficial[pid].id;
    const cntOff = () => D.country(cid).provinces.filter(x => A.resOfficial[x]).length;
    const nOff0 = cntOff();
    AI.gov(c, 'balanced');
    const nOff1 = cntOff();
    /* 撤换之后立刻补人：总数不减，而且原来的 99103 已经不在任上了
     * （它被 retireOff 过，可能回池、也可能被派去别的空缺省） */
    const stillOld = D.country(cid).provinces.some(x => A.resOfficial[x] && A.resOfficial[x].id === oldId);
    ok('② 怨气超线（rank1 ≥80）→ 撤换，并从候选池补人（总数不减）',
      nOff1 === nOff0 && !stillOld,
      '在任 ' + nOff0 + ' → ' + nOff1 + ' · 原官是否仍在任：' + stillOld);

    /* 补人优先人口最多的空缺省 */
    delete A.resOfficial[pid];
    delete A.resOfficial[pid2];
    const p1 = w.provinces[pid - 1], p2 = w.provinces[pid2 - 1];
    A.resPop[pid].v = 900000;
    A.resPop[pid2].v = 100000;
    T.pool.push(mkOff(99105, 0, 0, '候补乙'));
    AI.fill(cid);
    ok('② 补人优先人口最多的空缺省',
      !!A.resOfficial[pid] && !A.resOfficial[pid2],
      (A.resOfficial[pid] ? A.resOfficial[pid].name + '@大省（90 万）' : '大省空着') +
      ' · 小省 ' + (A.resOfficial[pid2] ? '有官' : '空着'));

    /* 战时收紧：赏赐只保 rank ≥2 */
    const foe = w.countries.find(x => x.id !== me && x.id !== cid && x.provinces.length > 1);
    if (!D.atWar(cid, foe.id)) D.declareWar(cid, foe.id);
    cen.gold = 200;
    A.resOfficial[pid] = mkOff(99106, 1, 60);
    const gw = cen.gold;
    AI.gov(c, 'balanced');
    const noReward = cen.gold === gw;
    A.resOfficial[pid] = mkOff(99107, 2, 60);
    AI.gov(c, 'balanced');
    const yesReward = cen.gold === gw - 15;
    ok('② 战时赏赐收紧：rank1 不赏、rank2 照赏',
      noReward && yesReward, 'rank1 ' + (noReward ? '未赏' : '赏了') +
      ' · rank2 ' + (yesReward ? '赏了' : '未赏'));

    /* 性格修正真的改变行为：同一怨气，经营赏、军国不赏（线 40 vs 60）。
     * 先停战 —— 战时只保 rank≥2，rank1 无论性格都不会被赏。 */
    if (D.atWar(cid, foe.id)) D.makePeace(cid, foe.id);
    AI.warEcon(cid, 'balanced');           // 让换挡状态跟上（停战恢复）
    cen.gold = 200;
    A.resOfficial[pid] = mkOff(99108, 1, 45);
    const gA = cen.gold;
    AI.gov(c, 'mil');                    // 线 50 + 10 = 60 → 45 不够
    const milNo = cen.gold === gA;
    A.resOfficial[pid].griev = 45;
    A.resOfficial[pid].rewardAt = 0;
    AI.gov(c, 'econ');                   // 线 50 − 10 = 40 → 45 够
    const econYes = cen.gold === gA - 15;
    ok('② 性格修正线值（怨气 45：经营赏、军国不赏）', milNo && econYes,
      '军国 ' + (milNo ? '未赏' : '赏了') + ' · 经营 ' + (econYes ? '赏了' : '未赏'));

    /* 收拾：停战 + 清场 */
    if (D.atWar(cid, foe.id)) D.makePeace(cid, foe.id);
    delete A.resOfficial[pid];
    delete A.resOfficial[pid2];
    return o;
  }));

  /* ---------------- ③ 战时经济：换挡 / 恢复 / 建造 / 俸禄 / 护栏 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, W = A.AIWAR, rep = A.rep, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const me = D.player();
    const w = D.world();
    const c = w.countries.find(x => x.id !== me && x.provinces.length >= 4);
    const cid = c.id;
    const foe = w.countries.find(x => x.id !== me && x.id !== cid && x.provinces.length > 1);

    /* 战前把档位调成"标准"：学校中、兵营中、农场中 */
    rep.setPrio(cid, 'school', 'p2');
    rep.setPrio(cid, 'barracks', 'p2');
    rep.setPrio(cid, 'grain', 'p2');
    rep.setPrio(cid, 'market', 'p2');
    if (D.atWar(cid, foe.id)) D.makePeace(cid, foe.id);
    D.setTurn(800);
    AI.warEcon(cid, 'balanced');                    // 先落一次"和平"基线
    ok('③ 和平时不动档位（学校仍是中档）', rep.prio(cid, 'school') === 'p2',
      rep.prio(cid, 'school'));

    /* 宣战 → 一回合内换挡 */
    D.declareWar(cid, foe.id);
    AI.warEcon(cid, 'balanced');
    ok('③ 宣战后换挡：军备升「高」、资源留「中」、民用降「低」',
      rep.prio(cid, 'barracks') === 'p1' && rep.prio(cid, 'grain') === 'p2' &&
      rep.prio(cid, 'school') === 'p3' && rep.prio(cid, 'market') === 'p3',
      '兵营 ' + rep.prio(cid, 'barracks') + ' · 农场 ' + rep.prio(cid, 'grain') +
      ' · 学校 ' + rep.prio(cid, 'school') + ' · 市场 ' + rep.prio(cid, 'market'));

    /* 换挡只做一次（状态没变不重复改） */
    const n2 = AI.warEcon(cid, 'balanced');
    ok('③ 换挡是"状态切换"而不是每回合重设', n2 === 0, 'n=' + n2);

    /* 战时建造只留军备类：给足国库，连开 20 次，民用一座都不许动 */
    const cen = D.ensureCentral(cid);
    cen.gold = 5000;
    A.resTalentOf(cid).total = 200;                 // 教育拉满，别让门槛挡住军备
    const kinds = ['school', 'market', 'builder', 'granary', 'university', 'factory'];
    const before = {};
    kinds.forEach(k => { before[k] = 0; });
    const cnt = (k) => {
      let n = 0;
      const T = k === 'university' ? A.resUniversity : k === 'granary' ? A.resGranary :
        k === 'factory' ? A.resFactory : k === 'school' ? A.resSchool :
        k === 'market' ? A.resMarket : A.resBuilder;
      D.country(cid).provinces.forEach(x => {
        const st = T[x];
        n += (st ? (st.n || 0) + (st.site || 0) : 0);
      });
      return n;
    };
    kinds.forEach(k => { before[k] = cnt(k); });
    let built = 0;
    for (let i = 0; i < 20; i++) {
      D.setTurn(801 + i);
      if (AI.build(cid, 'balanced')) built++;
    }
    const grew = kinds.filter(k => cnt(k) > before[k]);
    ok('③ 战时建造只留军备类（民用 20 次尝试一座没开）',
      grew.length === 0,
      '开工 ' + built + ' 次 · 民用新增 [' + grew.join(',') + ']');

    /* 停战恢复：原来怎么调的就怎么还回去 */
    D.makePeace(cid, foe.id);
    AI.warEcon(cid, 'balanced');
    ok('③ 停战恢复原档位（学校回中、兵营回中）',
      rep.prio(cid, 'school') === 'p2' && rep.prio(cid, 'barracks') === 'p2',
      '学校 ' + rep.prio(cid, 'school') + ' · 兵营 ' + rep.prio(cid, 'barracks'));

    /* 俸禄照付不欠：战时省库发不出 → 中央补，owed 清零 */
    const pid = c.provinces[0];
    A.resOfficial[pid] = { id: 99201, name: '欠俸吏', traitKey: 'plain', owed: 5,
      rank: 0, ten: 0, griev: 10, salAcc: 0 };
    A.resSim[pid].gold.stock = 0;
    cen.gold = 100;
    D.declareWar(cid, foe.id);
    AI.warEcon(cid, 'balanced');
    const nPay = AI.payOwed(cid);
    ok('③ 战时俸禄照付不欠（中央补省库、owed 清零）',
      nPay >= 1 && A.resOfficial[pid].owed === 0 && cen.gold === 95 &&
      A.resSim[pid].gold.stock === 5,
      'owed 5 → ' + A.resOfficial[pid].owed + ' · 中央 ' + cen.gold + ' · 省库 ' + A.resSim[pid].gold.stock);

    /* 护栏优先：中央见底时宁可不补（不掏空国库） */
    cen.gold = W.warEcon.topUpReserve;
    A.resOfficial[pid].owed = 4;
    A.resSim[pid].gold.stock = 0;
    AI.payOwed(cid);
    ok('③ 中央只剩保底时不补俸禄（护栏优先，不掏空国库）',
      A.resOfficial[pid].owed === 4 && cen.gold === W.warEcon.topUpReserve,
      'owed ' + A.resOfficial[pid].owed + ' · 中央 ' + cen.gold);

    /* 护栏优先：军费爆表（>90% 岁入）时，换挡不给军备升档、guard 还会再压一次。
     * 造 8 万常备军、岁入 1 金/省 —— 名义军费 40 金/回合，比例远超 90%。 */
    const FL = D.flow;
    D.country(cid).provinces.forEach(x => {
      if (!FL[x]) FL[x] = { gain: {}, loss: {}, d: {} };
      if (!FL[x].gain) FL[x].gain = {};
      FL[x].gain.gold = 1;
    });
    const apid = c.provinces[0];
    for (let i = 0; i < 4; i++) {
      const ar = D.newArmy(cid, apid, { type: 'army', men: 20000 });
      ar.order = { type: 'defend', cid: cid, pid: apid, tactic: 'assault' };
    }
    D.setTurn(900);
    if (!D.atWar(cid, foe.id)) D.declareWar(cid, foe.id);
    /* 把换挡状态清零，逼它重新走一次"进入战争"分支 */
    delete AI.wecon[cid];
    rep.setPrio(cid, 'barracks', 'p2');
    AI.warEcon(cid, 'balanced');
    const afterSwap = rep.prio(cid, 'barracks');
    const fired = AI.guard(cid, 'balanced');
    ok('③ 护栏优先：军费爆表时军备不升档、guard 再压到低档',
      afterSwap === 'p3' && fired === 1 && rep.prio(cid, 'barracks') === 'p3',
      '换挡后 ' + afterSwap + ' → 护栏后 ' + rep.prio(cid, 'barracks'));

    /* 护栏优先的另一半：超了 60% 就不再征兵（少征兵，不掏空国库）。
     * aiDefend（每 3 回合的民兵动员）建军之前问的就是这一句。 */
    const ratio = AI.milRatio(cid);
    const noRec = AI.canRecruit(cid);
    const poor = w.countries.find(x => x.id !== me && x.id !== cid && x.provinces.length > 1);
    const yesRec = AI.canRecruit(poor.id);       // 没有军队的国家永远可以征兵
    ok('③ 护栏优先：军费超 60% 岁入就不再征兵',
      ratio > 0.6 && noRec === false && yesRec === true,
      '比例 ' + ratio.toFixed(2) + ' → canRecruit=' + noRec +
      '（无军的 ' + poor.id + ' 号国 = ' + yesRec + '）');

    delete A.resOfficial[pid];
    if (D.atWar(cid, foe.id)) D.makePeace(cid, foe.id);
    return o;
  }));

  /* ---------------- ④ 存档：新字段往返 + 旧档容错 ---------------- */
  add(await page.evaluate(async () => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const me = D.player();
    const pid = D.country(me).provinces[0];
    A.resOfficial[pid] = { id: 99301, name: '存档吏', traitKey: 'finance', owed: 2,
      rank: 2, ten: 37, griev: 66.5, salAcc: 0.5, warned: 12 };
    D.save(true);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('sj.save')); } catch (e) { return [{ name: '④ 读得到存档', ok: false, detail: 'no-storage' }]; }
    const sv = (raw.OFFICIAL || {})[pid] || {};
    ok('④ 存档里有 rank / ten / griev（不升版本号）',
      sv.rank === 2 && sv.ten === 37 && Math.abs(sv.griev - 66.5) < 1e-6,
      JSON.stringify({ rank: sv.rank, ten: sv.ten, griev: sv.griev }) +
      ' · v' + raw.v + '（当前 v' + A.SAVE_VER + '）');

    /* 旧档容错：把这三个键删掉再读 → 补 0，PMOD 不能变 NaN */
    delete sv.rank; delete sv.ten; delete sv.griev; delete sv.salAcc; delete sv.warned;
    raw.OFFICIAL[pid] = sv;
    localStorage.setItem('sj.save', JSON.stringify(raw));
    D.load();
    /* 读档是"按 seed 重建世界 → 灌状态"的异步流程：等它落地再读表，
     * 否则看到的还是重置之后的空表（ai.js 的读档用例也是这么等的）。 */
    await new Promise(r => setTimeout(r, 1600));
    const back = A.resOfficial[pid];
    const mul = D.pmod(pid).taxMul;
    ok('④ 旧档（无这三个字段）读档补 0，倍率不 NaN',
      back && back.rank === 0 && back.ten === 0 && back.griev === 0 &&
      isFinite(mul) && mul > 0,
      back ? ('rank ' + back.rank + ' · griev ' + back.griev + ' · taxMul ' + mul.toFixed(2)) : '官没了');
    return o;
  }));

  /* ---------------- 汇总 ---------------- */
  let pass = 0, fail = 0;
  for (const r of out) {
    if (r.ok) { pass++; console.log('  PASS   ' + r.name + (r.detail ? '  —  ' + r.detail : '')); }
    else { fail++; console.log('  FAIL   ' + r.name + (r.detail ? '  —  ' + r.detail : '')); }
  }
  console.log('\n共 ' + out.length + ' 项：' + pass + ' 通过 / ' + fail + ' 失败');
  if (errors.length) {
    console.log('控制台错误：');
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
  } else {
    console.log('no console errors');
  }
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
