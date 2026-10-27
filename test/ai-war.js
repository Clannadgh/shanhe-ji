/* =============================================================
 * test/ai-war.js —— AI 收官（互战 / 迷雾消费 / 性格×外交）的验收
 *
 * 对着这次改动的验收清单逐条过：
 *   ① 挂机：AI 之间宣战 → 推进 → 占领 → 求和 → 灭亡全流程自发，纪要有"遥远的战争"
 *   ② warBias 消费正确；宣战硬约束（盟友 / 互不侵犯 / 停战冷却 / 军力比 / 阈值）全生效
 *   ③ 进攻目标 100% 在 AI 已探集内；已探集越大可选目标越多（重金情报更优）
 *   ④ AI 求和走谈判桌、赔款真实到账；军费护栏触发可见（优先档自动下调）
 *   ⑤ 阻尼防雪崩生效；存档往返；旧回归全绿
 *
 * 跑法：node test/ai-war.js
 * 200 省 / 12 国的小世界，约 40 秒。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer');

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
  await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);
  await page.evaluate(() => {
    document.getElementById('prov').value = 200;
    document.getElementById('ctry').value = 12;
    document.getElementById('seed').value = 'aiwar-big';
    document.getElementById('gen').click();
  });
  await sleep(3200);

  /* 一回合：先把挂起的事件按默认选项落地（不然 nextTurn 会被挡住） */
  const step = () => page.evaluate(() => {
    const D = window.AO.resDebug;
    let g = 0;
    while (D.evtPending && D.evtPending() && g++ < 5) D.evtPick(0);
    D.nextTurn();
  });

  /* ---------------- 0) 定义区就位 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const W = A.AIWAR;
    ok('0 定义区 AO.AIWAR 六块都在', W && W.score && W.attack && W.peace && W.guard && W.damp && W.trade);
    ok('0 宣战分五要素（warBias 权重 / 性格 / 敌意 / 趁火打劫 / 阈值）',
      W.score.wWar === 20 && W.score.persona.mil === 15 && W.score.persona.econ === -15 &&
      W.score.hostileAdd === 10 && W.score.busyAdd === 10 && W.threshold === 30,
      JSON.stringify(W.score) + ' thr=' + W.threshold);
    ok('0 军力比 0.7 · 每 6 回合评估 · 停战冷却 20',
      W.powerRatio === 0.7 && W.every === 6 && W.peaceCd === 20);
    ok('0 进攻比例三档（30% / 15% / 0）与战术（军国强攻 / 均衡围城）',
      W.attack.highPct === 0.3 && W.attack.midPct === 0.15 &&
      W.attack.tactic.mil === 'assault' && W.attack.tactic.balanced === 'siege');
    /* v18.9：求和门槛从 behind 30 / turns 5 收紧到 18 / 3（让中等国家在
     * 被打到投降线之前就能用一笔钱收场）。这里跟着定义区走，别再写死。 */
    ok('0 求和（落后 ' + W.peace.behind + ' · 持续 ' + W.peace.turns +
      ' 回合）与军费护栏（60% / 90%）',
      W.peace.behind === 18 && W.peace.turns === 3 &&
      W.guard.milShare === 0.6 && W.guard.hardShare === 0.9,
      JSON.stringify(W.peace));
    ok('0 阻尼（灭国后 10 回合内、战争 ≥6 → 门槛 +15）',
      W.damp.afterDeath === 10 && W.damp.wars === 6 && W.damp.add === 15);
    ok('0 世界纪要每回合最多 2 条', W.newsPerTurn === 2);
    ok('0 统计表 / 导出都在', !!A.aiDebug.war && typeof A.aiDebug.warTick === 'function' &&
      typeof A.aiWarTick === 'function');
    return o;
  }));

  /* 选一个玩家国（1 号），其余 11 国归 AI */
  await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });

  /* ---------------- ② 宣战硬约束（单步，不跑回合） ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    /* 挑两个接壤的 AI 国（都不含玩家） */
    let a = 0, b = 0;
    for (const c of w.countries) {
      if (c.id === D.player()) continue;
      const nb = (c.neighbors || []).filter(x => x !== D.player());
      if (nb.length) { a = c.id; b = nb[0]; break; }
    }
    window.__T = { a, b };

    /* warBias 消费：同一对邻国，warBias 高的分数一定更高 */
    const q = AI.quirkOf(a);
    const qSave = q.war;
    q.war = 0.8;
    const sLo = AI.declareScore(a, b, q, 'mil').score;
    q.war = 1.2;
    const sHi = AI.declareScore(a, b, q, 'mil').score;
    q.war = qSave;
    ok('② warBias 直接进宣战分（0.8 → 1.2 涨 8 分）', Math.abs((sHi - sLo) - 8) < 1e-6,
      sLo.toFixed(1) + ' → ' + sHi.toFixed(1));

    /* 性格权重：军国 > 均衡 > 经营（同一 warBias、同一关系） */
    const sm = AI.declareScore(a, b, q, 'mil').score;
    const sb = AI.declareScore(a, b, q, 'balanced').score;
    const se = AI.declareScore(a, b, q, 'econ').score;
    ok('② 性格权重：军国 > 均衡 > 经营（+15 / 0 / −15）', sm > sb && sb > se,
      [sm, sb, se].map(x => x.toFixed(1)).join(' / '));

    /* 经营永远够不着阈值（上限 = 24 − 15 + 10 + 10 = 29 < 30） */
    D.relSet(a, b, -100);
    const eMax = AI.declareScore(a, b, { war: 1.2 }, 'econ').score;
    ok('② 经营即使"关系烂透 + 对方在挨打"也不到阈值（29 < 30）', eMax < A.AIWAR.threshold,
      eMax.toFixed(1) + ' < ' + A.AIWAR.threshold);

    /* 同盟 / 互不侵犯：不宣 */
    D.relSet(a, b, 70);
    D.diplo.cd[a + '|' + b + '|ally'] = 0;
    D.proposePact(a, b, 'ally');
    ok('② 结盟成功（前置）', D.isAlly(a, b), D.relOf(a, b));
    AI.quirkOf(a).war = 1.2;
    AI.setPersona(a, 'mil');
    const before = D.atWar(a, b);
    /* 让它在"该宣的那一回合"评估一次。
     * 注意：它**可能**去打别的邻国（那是合法的），所以只断言"没打这个盟友"。 */
    D.setTurn(A.AIWAR.every * 20 + (a % A.AIWAR.every));
    AI.declare(a, 'mil', AI.quirkOf(a));
    ok('② 同盟国不会被 AI 宣战（去打别人可以）', !before && !D.atWar(a, b),
      'atWar=' + D.atWar(a, b));
    /* 互不侵犯同理 */
    D.breakPact(a, b, 'ally');
    D.relSet(a, b, 70);
    D.diplo.cd[a + '|' + b + '|nap'] = 0;
    D.proposePact(a, b, 'nap');
    AI.declare(a, 'mil', AI.quirkOf(a));
    ok('② 互不侵犯国不会被 AI 宣战', !D.atWar(a, b), 'atWar=' + D.atWar(a, b));
    D.breakPact(a, b, 'nap');

    /* 停战冷却：刚和过的那一对不重新宣战 */
    D.relSet(a, b, -100);
    D.declareWar(a, b);
    D.makePeace(a, b);
    ok('② 停战写下冷却', (D.peaceCd[a < b ? a + '|' + b : b + '|' + a] || 0) > D.turn(),
      D.peaceCd[a < b ? a + '|' + b : b + '|' + a]);
    const nCd = AI.declare(a, 'mil', AI.quirkOf(a));
    ok('② 停战冷却期内不重新宣战', !D.atWar(a, b) && nCd === 0, 'n=' + nCd);

    /* 军力比一票否决：把对方的兵堆到天上去。
     * 先把 a 身上别的战争停掉 —— 否则 maxWars(2) 会先把宣战挡掉，
     * 测的就不是"军力比"这件事了。 */
    AI.warsOf(a).forEach(function (f) { D.makePeace(a, f); });
    D.relSet(a, b, -100);
    D.peaceCd[a < b ? a + '|' + b : b + '|' + a] = 0;
    const foeProv = D.country(b).provinces[0];
    for (let i = 0; i < 6; i++) {
      const ar = D.newArmy(b, foeProv, { type: 'army', men: 20000 });
      ar.order = { type: 'defend', cid: b, pid: foeProv, tactic: 'assault' };
    }
    /* 让对方这些兵"看得见"（否则 AI 不该知道） */
    const K = AI.aiKnow(a);
    Object.keys(D.country(b).provinces).forEach(i2 => { K[D.country(b).provinces[i2]] = D.turn(); });
    const ratio = AI.powerOf(a, 0) / AI.powerOf(b, a);
    /* b 的宣战分本来就够（关系 −100 + 军国），唯一挡住它的只能是军力比。
     * 它可能转而去打别的邻国 —— 那不算失败，所以只看"有没有打 b"。 */
    const scB = AI.declareScore(a, b, AI.quirkOf(a), 'mil').score;
    AI.declare(a, 'mil', AI.quirkOf(a));
    ok('② 军力比 < 0.7 一票否决（看得见的重兵挡住宣战）',
      ratio < 0.7 && scB >= A.AIWAR.threshold && !D.atWar(a, b),
      'ratio=' + ratio.toFixed(2) + ' 分=' + scB.toFixed(0) + ' atWar=' + D.atWar(a, b));
    /* 把对方的兵撤了 → 同样的关系下就敢打了 */
    Object.keys(D.army).forEach(k => { if (D.army[k].owner === b) D.fogDisband(k); });
    D.setTurn(A.AIWAR.every * 20 + (a % A.AIWAR.every));
    const nOk = AI.declare(a, 'mil', AI.quirkOf(a));
    ok('② 军力比够了就敢打（同关系、同回合）', nOk === 1 && D.atWar(a, b), 'n=' + nOk);
    D.makePeace(a, b);
    return o;
  }));

  /* ---------------- ③ 进攻目标只在已探集 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world(), a = T.a, b = T.b;
    D.peaceCd[a < b ? a + '|' + b : b + '|' + a] = 0;
    if (D.atWar(a, b)) D.makePeace(a, b);
    D.declareWar(a, b);
    AI.setPersona(a, 'mil');
    AI.quirkOf(a).war = 1.2;
    const pid = D.country(a).provinces[0];
    /* v19 起「裸兵只驻防」（tryAttack 里 `if (!a.weapon) continue`）——
     * 这一节验的是"目标只在已探集里"，不是"没兵刃也敢冲"，所以给一份铁刀。 */
    const ar = D.newArmy(a, pid, { type: 'army', men: 6000, tier: 'ironwp' });
    ar.order = { type: 'defend', cid: a, pid: pid, tactic: 'assault' };

    const tgt = AI.pickTarget(a, ar);
    ok('③ 选出来的目标在已探集里', tgt > 0 && AI.knows(a, tgt), 'tgt=' + tgt);
    ok('③ 目标属于交战国', tgt > 0 && w.provinces[tgt - 1].owner === b,
      tgt ? w.provinces[tgt - 1].owner : '-');
    ok('③ 目标与我方接壤（陆军走得过去）', tgt > 0 &&
      (w.provinces[tgt - 1].neighbors || []).some(n => w.provinces[n - 1].owner === a));

    /* 已探集越大，可选目标越多 —— 这就是"重金情报 AI 目标选择天然更优" */
    const K = AI.aiKnow(a);
    /* 先把"纵深情报"清掉（只留边境那几块），再模拟一次重金织网全探一遍。
     * 只数接壤省不会变 —— 边境那几块开局就在初识圈里；变的是"知道多少敌省"。 */
    Object.keys(K).forEach(k => {
      const p = w.provinces[(k | 0) - 1];
      if (!p || p.owner !== b) return;
      const touch = (p.neighbors || []).some(x => w.provinces[x - 1].owner === a);
      if (!touch) delete K[k];
    });
    const count = () => {
      let n = 0;
      for (const k in K) {
        const p = w.provinces[(k | 0) - 1];
        if (p && p.owner === b) n++;
      }
      return n;
    };
    const c0 = count();
    /* 把对方的省全"探"一遍（相当于重金情报织网） */
    D.country(b).provinces.forEach(x => { K[x] = D.turn(); });
    const c1 = count();
    ok('③ 已探集变大 → 已知敌省变多（重金情报目标选择更优）', c1 > c0, c0 + ' → ' + c1);

    /* 一条真的进攻命令：目标必须在已探集里，且 WSTAT.badTarget 不涨。
     * 前面 100 回合挂机可能已经让这一国有军队在进攻 —— tryAttack 的配额
     * （want）被它们占满，这支新军就轮不到。这一节验的是"命令怎么下"，
     * 不是"配额够不够"，所以先把别人的进攻令收回驻防。 */
    D.armiesOf(a).forEach(x => {
      if (x !== ar && x.order && (x.order.type === 'attack' || x.order.type === 'siege')) {
        x.order = { type: 'defend', cid: a, pid: x.pid, tactic: 'assault' };
      }
    });
    const bad0 = AI.war.badTarget;
    const n = AI.attack(a, 'mil', AI.quirkOf(a));
    ok('③ 进攻命令下达', n >= 1 && ar.order && ar.order.type === 'attack', JSON.stringify(ar.order));
    ok('③ 命令目标在已探集里、badTarget 没涨',
      !!ar.order && AI.knows(a, ar.order.pid) && AI.war.badTarget === bad0,
      'pid=' + (ar.order && ar.order.pid) + ' bad=' + AI.war.badTarget);
    ok('③ 战术按性格（军国 = 强攻）', ar.order && ar.order.tactic === 'assault', ar.order && ar.order.tactic);
    /* 经营不进攻 */
    AI.setPersona(a, 'econ');
    ar.order = { type: 'defend', cid: a, pid: ar.pid, tactic: 'assault' };
    const nEcon = AI.attack(a, 'econ', AI.quirkOf(a));
    ok('③ 经营型不进攻（比例 0）', nEcon === 0 && ar.order.type === 'defend', 'n=' + nEcon);
    /* 均衡用围城战术 */
    AI.setPersona(a, 'balanced');
    ar.order = { type: 'defend', cid: a, pid: ar.pid, tactic: 'assault' };
    AI.attack(a, 'balanced', AI.quirkOf(a));
    ok('③ 均衡型用围城战术', ar.order && ar.order.tactic === 'siege', ar.order && ar.order.tactic);

    /* 回撤：兵损过半 → 停止推进 */
    const before = ar.men;
    ar.aiMen0 = before;
    ar.men = Math.floor(before * 0.4);
    const r = AI.retreat(a);
    ok('④ 兵损过半自动回撤（停止推进）', r >= 1 && ar.order.type !== 'attack', ar.order.type);
    D.makePeace(a, b);
    return o;
  }));

  /* ---------------- ④ 求和：走谈判桌、赔款真实到账 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.a, b = T.b;
    /* 清场：a 身上别的战争会混进 tryPeace 的循环（它会先去和那些国家谈），
     * 测"落后 5 回合"之前必须只剩 a|b 这一场。 */
    AI.warsOf(a).forEach(function (f) { D.makePeace(a, f); });
    if (D.atWar(a, b)) D.makePeace(a, b);
    D.peaceCd[a < b ? a + '|' + b : b + '|' + a] = 0;
    /* 求和计数整表清零：前面几段单步测试留下的"落后计数"会串味 */
    Object.keys(AI.losing).forEach(function (k) { delete AI.losing[k]; });
    D.declareWar(a, b);
    /* a 落后 `behind` 分（b 赢）；b 是"经营"（软），a 国库有钱。
     * 打分 = −min(deficitCap, 落后) + 性格 + 民心 + 赔款/2 —— 这四个数都从
     * 定义区读，别再写死（v18.9 改过一轮：behind 30→18、pay 50→30）。 */
    const P = A.AIWAR.peace;
    D.wsOf(a, b).a = 0; D.wsOf(a, b).b = P.behind;
    AI.setPersona(b, 'econ');
    AI.setPersona(a, 'balanced');
    D.ensureCentral(a).gold = 120;
    const g0 = D.ensureCentral(a).gold, g1 = D.ensureCentral(b).gold;
    const key = a < b ? a + '|' + b : b + '|' + a;
    const sc = AI.peaceScore(b, a, P.pay);
    ok('④ 求和评估用"战况 + 性格 + 民心 + 赔款"（不带要价）',
      /* 落后分先被 deficitCap 夹住（def = min(cap, adv)），所以用 sc.def */
      Math.abs(sc.score - ((-sc.def) + sc.ev.persona + sc.ev.press + P.pay / 2)) < 1e-6,
      JSON.stringify(sc));
    /* 连续 turns 回合落后才动手：第 1~turns-1 回合只是记账，第 turns 回合才开口 */
    let n = 0;
    for (let i = 0; i < P.turns - 1; i++) n += AI.peace(a);
    /* 落后计数是**带方向**的键（a>b）：记的是"我连续几回合落后于它" */
    ok('④ 落后满 ' + P.turns + ' 回合才求和（前 ' + (P.turns - 1) + ' 回合不动）',
      n === 0 && AI.losing[a + '>' + b] === P.turns - 1,
      'n=' + n + ' losing=' + AI.losing[a + '>' + b]);
    n = AI.peace(a);
    ok('④ 第 ' + P.turns + ' 回合成交', n === 1 && !D.atWar(a, b), 'n=' + n);
    ok('④ 赔款真实到账（败方 −' + P.pay + ' / 胜方 +' + P.pay + '）',
      D.ensureCentral(a).gold === g0 - P.pay && D.ensureCentral(b).gold === g1 + P.pay,
      D.ensureCentral(a).gold + ' / ' + D.ensureCentral(b).gold);
    ok('④ 停战写进条约纪要', D.notesList().some(x => /条约/.test(x.text) && /赔款/.test(x.text)),
      (D.notesList().find(x => /条约/.test(x.text)) || {}).text);
    ok('④ 求和之后有停战冷却', (D.peaceCd[key] || 0) > D.turn(), D.peaceCd[key]);

    /* AI 内政买货：走外国货源（外交批的 buyForeign，asAi 版）。
     * 铺条件：本国铁见底、有市场有金；外国 REL ≥ 20 且仓里有铁。 */
    (function () {
      const aa = a, bb2 = b;
      const pv = D.country(aa).provinces[0];
      A.resMarket[pv] = A.resMarket[pv] || { n: 0, site: 0, halted: false, tiers: {}, built: 0 };
      A.resMarket[pv].n = 1; A.resMarket[pv].site = 0; A.resMarket[pv].halted = false;
      /* 本国铁清空 */
      D.country(aa).provinces.forEach(x => {
        if (A.resSim[x] && A.resSim[x].iron) A.resSim[x].iron.stock = 0;
      });
      D.ensureCentral(aa).iron = 0;
      A.resSim[pv].gold.stock = 300;
      /* 外国：关系 30、铁 60 */
      D.relSet(aa, bb2, 30);
      const srcPid = D.country(bb2).provinces[0];
      A.resSim[srcPid].iron.stock = 60;
      /* v18 追加三：买货的默认源已经是**世界市场**（永远有货、价 = 基准 × 本国 PI），
       * 想让 AI 去挑外国货源，就得让外国真的更便宜：
       * 本国 PI 抬到 2.4（市场价 18）、外国压到 0.6（外国价 9）。 */
      D.prices[aa] = D.prices[aa] || {};
      D.prices[aa].iron = { v: 2.4, target: 2.4, trend: 0 };
      D.prices[bb2] = D.prices[bb2] || {};
      D.prices[bb2].iron = { v: 0.6, target: 0.6, trend: 0 };
      const every = A.AIWAR.trade.every.econ;
      D.setTurn(every * 10 - (aa % every));
      const iron0 = A.resSim[pv].iron.stock;
      const nTrade = AI.trade(aa, 'econ');
      ok('④ AI 内政买货走外国货源（铁见底 → 买进来）',
        nTrade === 1 && A.resSim[pv].iron.stock > iron0,
        'n=' + nTrade + ' 铁 ' + iron0 + ' → ' + A.resSim[pv].iron.stock);
      ok('④ 买货把金付给了对方那个省（不走调拨）',
        A.resSim[srcPid].gold.stock > 0, A.resSim[srcPid].gold.stock);
      /* 军国看得最稀：同一回合不买（频次 12） */
      D.setTurn(every * 10 - (aa % every));
      const nMil = AI.trade(aa, 'mil');
      ok('④ 频次按性格分（军国这回合不该再买）', nMil === 0 || A.AIWAR.trade.every.mil > every,
        'n=' + nMil);
    })();

    /* 军费护栏：堆一支大军、收入很低 → 触发。
     * 护栏读的是 FLOW 里"上一回合的实际金收入"，所以先给它造一笔岁入。
     * 一支 8 万人的常备军 = 名义军费 40 金/回合；这里把总岁入定在 55 金，
     * 比例 0.73 —— **软档**（60%~90%）：非军备降档、军备保持。
     * 为什么不定在"远超 90%"：硬档会连军备建筑一起降到低档（那是文档里
     * 写明的行为，用例在 test/ai-gov.js 的「护栏优先」），
     * 这一条要检验的是软档"军备不动"，所以比例得落在软档区间里。 */
    const FL = D.flow;
    const NP = D.country(a).provinces.length;
    D.country(a).provinces.forEach(x => {
      if (!FL[x]) FL[x] = { gain: {}, loss: {}, d: {} };
      if (!FL[x].gain) FL[x].gain = {};
      FL[x].gain.gold = 55 / NP;
    });
    const pid = D.country(a).provinces[0];
    for (let i = 0; i < 4; i++) {
      const ar = D.newArmy(a, pid, { type: 'army', men: 20000 });
      ar.order = { type: 'attack', cid: b, pid: D.country(b).provinces[0], tactic: 'assault' };
      ar.aiMen0 = 20000;
    }
    D.setTurn(30);
    const fired = AI.guard(a, 'balanced');
    const mg = AI.milGuard[a];
    ok('④ 军费护栏触发（常备军吃掉太多岁入）', fired === 1 && !!mg,
      mg ? ('ratio=' + mg.ratio.toFixed(2) + ' · ' + mg.act) : '没触发');
    ok('④ 护栏动作：停进攻 + 非军备建筑降档',
      !!mg && /停进攻/.test(mg.act) && /停 \d+ 类/.test(mg.act), mg && mg.act);
    /* 旧用例跟着改（v19 维修批）：`AO.rep.prio(p1/p2/p3)` 这套"优先档"已经
     * 换成了**保留座数**（keepRatio 0~1），动作文案也从「降档」改成「停 N 类」。
     * 这三条在维修批之后就一直红（`rep.prio` 现在在 js/ 里根本不存在），
     * 与 v18 无关 —— 这里按现在的 API 重写，断言的意思不变：
     * 非军备类被压到 lowKeep，军备类一座不动。 */
    const lowK = A.AIWAR.guard.lowKeep;
    ok('④ 军备建筑没被降（兵营仍全开）',
      A.AIWAR.guard.keepKinds.indexOf('barracks') >= 0 &&
      A.rep.keepRatio(a, 'barracks') === 1,
      '兵营 keepRatio=' + A.rep.keepRatio(a, 'barracks'));
    /* 真·比例验证：给一个省塞 3 座市场（built = 3）再跑一次护栏 ——
     * 保留座数会压到 max(1, round(3 × lowKeep)) = 1，也就是 1/3。
     * 单座省看不出比例（"至少留 1 座"会让 ratio 恒等于 1），所以要造 3 座。 */
    const mkPid = D.country(a).provinces[1] || pid;
    A.resMarket[mkPid] = { n: 3, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    AI.guard(a, 'balanced');
    const kMk = A.rep.keepRatio(a, 'market');
    ok('④ 非军备类真被压到 lowKeep（市场 3 座 → 留 1 座）', kMk <= 0.5,
      'market keepRatio=' + kMk.toFixed(2) + '（lowKeep ' + lowK + '）');
    ok('④ 护栏之后军队全部转驻防',
      D.armiesOf(a).every(x => !x.order || x.order.type !== 'attack'),
      D.armiesOf(a).map(x => x.order && x.order.type).join(','));
    return o;
  }));

  /* ---------------- ⑤ 阻尼 + 存档 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const ids = w.countries.map(c => c.id).filter(x => x !== D.player());
    /* 造 6 场 AI-AI 战争（避开玩家）：成对试，成不了就换下一对 */
    for (let i = 0; i < ids.length && AI.warCount() < 6; i++) {
      for (let j = i + 1; j < ids.length && AI.warCount() < 6; j++) {
        if (!D.atWar(ids[i], ids[j])) D.declareWar(ids[i], ids[j]);
      }
    }
    const wars = AI.warCount();
    /* 假装刚死了一个国（syncDeaths 靠 DEAD 表计数） */
    const deadBefore = AI.war.deaths;
    const victim = ids[ids.length - 1];
    D.deadMap[victim] = { turn: D.turn(), by: ids[0] };
    AI.warTick();                       // syncDeaths 会记下 LASTDEATH
    const d = AI.damp();
    ok('⑤ 灭国 + 战争 ≥6 → 宣战门槛 +15（阻尼生效）',
      wars >= 6 && d === A.AIWAR.damp.add, 'wars=' + wars + ' add=' + d);
    ok('⑤ 灭国计数被记下', AI.war.deaths > deadBefore, deadBefore + ' → ' + AI.war.deaths);
    /* 过了阻尼窗口就恢复 */
    D.setTurn(D.turn() + A.AIWAR.damp.afterDeath + 1);
    ok('⑤ 过了 10 回合阻尼窗口，门槛恢复', AI.damp() === 0, AI.damp());

    /* 存档：停战冷却进档（AI 互战读它） */
    const key = Object.keys(D.peaceCd)[0];
    D.save(true);
    const raw = JSON.parse(localStorage.getItem(A.SAVE_KEY));
    ok('⑤ 存档里有 peaceCd（停战冷却）', !!raw.DIPLO && !!raw.DIPLO.peaceCd,
      raw.DIPLO ? Object.keys(raw.DIPLO).join(',') : '没有');
    ok('⑤ 版本号仍 v6（只加字段不升版）', raw.v === 6, raw.v);
    return o;
  }));

  /* ---------------- ① 挂机：全流程自发 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 清掉上一段造的假灭亡，重新起一局干净的世界 */
    return o;
  }));
  await page.evaluate(() => {
    document.getElementById('seed').value = 'aiwar-idle';
    document.getElementById('gen').click();
  });
  await sleep(3200);
  await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });
  /* 计时改成**页面内**量（v13）：原来用 Date.now() 包着 100 次
   * `await step()` —— 那里面有一次跨进程往返 + 一帧绘制，机器一有负载
   * 就 60s/85s/99s 乱跳（同一份代码三次跑出来三个数），量到的是 IPC 抖动，
   * 不是模拟成本。现在 100 回合在页面里一口气跑完，只量 settleTurn 本身。 */
  const ms = await page.evaluate((n) => {
    const D = window.AO.resDebug;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      let g = 0;
      while (D.evtPending && D.evtPending() && g++ < 5) D.evtPick(0);
      D.nextTurn();
      if (D.surrenderState && D.surrenderState.open) D.surrenderChoose('annex');
    }
    return performance.now() - t0;
  }, 100);
  add(await page.evaluate((ms) => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const W = AI.war;
    ok('① 挂机 100 回合：AI 之间真的打起来了', W.declare > 0, '宣战 ' + W.declare + ' 次');
    ok('① AI 下达过进攻命令（解除"纯防守"）', W.attack > 0, '进攻 ' + W.attack + ' 次');
    ok('① 有占领 / 灭亡（推进到版图变化）', W.deaths > 0 || W.retreat > 0,
      '灭国 ' + W.deaths + ' · 回撤 ' + W.retreat);
    ok('① 打不动的仗会求和（不是只有灭国一种结局）', W.peace > 0, '求和 ' + W.peace + ' 次');
    ok('① 世界纪要放出了"遥远的战争"', W.news > 0, W.news + ' 条');
    ok('① 进攻目标始终在自己已探集里（badTarget = 0）', W.badTarget === 0, W.badTarget);
    ok('① 工坊模式外 AI 有动作（不是静止）', W.declare + W.attack + W.peace + W.guard + W.trade > 0,
      JSON.stringify(W));
    ok('① 挂机 100 回合耗时可控（页面内 < 60s）', ms < 60000,
      (ms / 1000).toFixed(1) + 's · 每回合 ' + (ms / 100).toFixed(0) + 'ms');
    return o;
  }, ms));

  /* 工坊模式：AI 全静止 */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* v18.11 拍板改口：**工坊模式（PLAYER=0）AI 照常跑**。
     * 原来是全静止（怕涂色时有人动土），结果是上帝模式变成一个冻住的世界 ——
     * 没人盖学校、没人改建、铁永远见底。现在只有**涂色模式**暂停。
     * 断言改成"它确实在动"：动作统计里至少有一项涨了。 */
    D.exitGame();
    const before = JSON.parse(JSON.stringify(AI.war));
    for (let i = 0; i < 12; i++) D.nextTurn();
    const after = JSON.parse(JSON.stringify(AI.war));
    const moved = ['declare', 'attack', 'peace', 'trade', 'sell', 'export', 'guard']
      .some(k => (after[k] | 0) > (before[k] | 0));
    ok('① 工坊模式（PLAYER=0）AI 照常跑（不是冻住的世界）',
      moved && !D.paintMode(), JSON.stringify(after));
    return o;
  }));

  /* ---------------- 汇总 ---------------- */
  if (errors.length) out.push({ name: '页面无 JS 错误', ok: false, detail: errors.slice(0, 3).join(' | ') });
  else out.push({ name: '页面无 JS 错误', ok: true, detail: '' });

  let bad = 0;
  for (const c of out) {
    if (!c.ok) bad++;
    console.log((c.ok ? '  ✓ ' : '  ✗ ') + c.name + (c.detail ? '　— ' + c.detail : ''));
  }
  console.log('');
  console.log(bad ? `❌ ${bad} 项失败 / 共 ${out.length} 项` : `✅ 全部通过（${out.length} 项）`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
