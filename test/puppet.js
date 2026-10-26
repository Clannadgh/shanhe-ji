/* =============================================================
 * test/puppet.js —— 傀儡与朝贡（战争的第三种结局）的验收
 *
 * 对着任务书的验收清单逐条过：
 *   ① 领先 40 → 谈判桌出现傀儡条款；AI 按 aiDiploEval 扩展式接受/拒绝
 *   ② 称臣后：朝贡到账（FLOWC 对账）· 宗主宣战它自动跟宣且出兵 · 外交全锁 · REL −80
 *   ③ 投降线三分支（全吞 / 傀儡 / 被 AI 要求称臣）；玩家败方 40%
 *   ④ 和平并入（满 60 回合 + 条件 + 60% 掷点）· 拒绝重掷 · 强并入的价
 *   ⑤ 傀儡独立（宗主陷战争时更易过 · 独立即宣战 · 玩家 +15）
 *   ⑥ 地图（臣）标 / 国家卡横幅 / 纪要 / 存档往返
 *   K bench 策略 K：AI-AI 观察 100 回合 + 朝贡对账 + 全吞 vs 收租的收益对照
 *
 * 注（v18.5 宣战入口搬家）：②b / ⑤ 里"宣战钮置灰"的旧断言跟着改了 ——
 *   钮从自己卡上那排邻国搬到了**对方卡**上，断言改成看对方卡那枚。
 *
 * 跑法：node test/puppet.js
 * 小世界（140 省 / 8 国），约 2 分钟。
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
  await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);

  /* 每节都从同一个世界重新开始：傀儡表是"这一局"的事，跨节污染最难查 */
  const gen = async (seed) => {
    await page.evaluate((seed) => {
      document.getElementById('prov').value = 140;
      document.getElementById('ctry').value = 8;
      document.getElementById('seed').value = seed;
      document.getElementById('gen').click();
    }, seed);
    await sleep(1600);
  };
  const fresh = async (seed) => {
    await gen(seed || 'puppet-spec-1');
    await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });
    await sleep(150);
  };
  /* 一回合：先把挂起的事件按默认选项落地（不然 nextTurn 会被挡住） */
  const step = () => page.evaluate(() => {
    const D = window.AO.resDebug;
    let g = 0;
    while (D.evtPending && D.evtPending() && g++ < 5) D.evtPick(0);
    D.nextTurn();
  });

  /* 页面里反复用的三个小工具（每个 evaluate 里重新定义，避免跨调用丢闭包） */
  const HELPERS = `
    const A = window.AO, D = A.resDebug;
    const o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const victim = () => {
      const w = D.world(), me = w.countries[0];
      for (const id of (me.neighbors || [])) {
        const c = w.countries[id - 1];
        if (c && !D.deadMap[c.id] && c.provinces.length >= 8) return c.id;
      }
      return 0;
    };
    /* 砸到投降线：每占一座就重算一次线（首都一丢，线会从 1/3 放宽到 2/3） */
    const collapse = (v, by) => {
      let guard = 0;
      while (guard++ < 90 && D.coOf(v).provinces.length > D.surrenderLine(v, by)) {
        const pid = D.coOf(v).provinces[0];
        if (!D.occupy(pid, by, '测试')) break;
      }
      return D.coOf(v).provinces.length;
    };
  `;
  /* 把 HELPERS + 一段语句拼成一个函数丢进页面跑。
   * 为什么不用 page.evaluate(字符串)：那段字符串在页面**全局作用域**求值，
   * 十几个块都写 const A = … 会当场撞 "Identifier 'A' has already been declared"。
   * new Function 让每个块有自己的函数作用域，顺便自动返回 o。 */
  const ev = (body) => page.evaluate(new Function(HELPERS + body + '\nreturn o;'));

  /* ---------------- 0) 定义区 + 状态表就位 ---------------- */
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'puppet-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);
  add(await page.evaluate(() => {
    const A = window.AO, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const P = A.DIPLO.puppet, D = A.resDebug;
    ok('0 定义区 AO.DIPLO.puppet 在', !!P);
    ok('0 谈判线 40 / 评估基价 50 / 性格 −20·0·+15',
      P.talkLead === 40 && P.evalBase === 50 && P.persona.mil === -20 &&
      P.persona.balanced === 0 && P.persona.econ === 15,
      'lead=' + P.talkLead + ' base=' + P.evalBase + ' persona=' + JSON.stringify(P.persona));
    ok('0 快顶不住了（投降线 1.2 倍 / +20）', P.nearLine === 1.2 && P.nearAdd === 20);
    ok('0 朝贡两成 / REL 锁 −80', P.tribute === 0.2 && P.relLock === -80);
    ok('0 并入：60 回合 / 重掷 30 / 幸福 55 / 60%',
      P.annexCd === 60 && P.annexRetry === 30 && P.annexHappy === 55 && P.annexAccept === 0.6);
    ok('0 强并入代价：民心 −8 / 不安 +30', P.forceHappy === 8 && P.forceUnrest === 30);
    ok('0 独立：每 10 回合 / 线 40 / 玩家 +15',
      P.indepEvery === 10 && P.indepNeed === 40 && P.indepPlayer === 15);
    ok('0 投降线 40% 要求称臣', P.surrenderP === 0.4);
    ok('0 状态表与入口都在',
      !!D.puppetMap && typeof D.makePuppet === 'function' && typeof D.settlePuppets === 'function' &&
      typeof D.aiPuppetEval === 'function' && !!D.surrenderState && typeof D.surrenderBranch === 'function');
    return o;
  }));

  /* ---------------- ① 谈判桌条款 ---------------- */
  await fresh();
  add(await ev(`
    const v = victim();
    ok('① 找得到一个邻居当受害国', v > 0, v);
    window.__T = { v: v };
    D.declareWar(1, v);
    /* 战争分：占 4 座省 = 40 分（每座 +10），正好压在条款解锁线上 */
    let n = 0;
    for (const pid of D.coOf(v).provinces.slice()) {
      if (n >= 4) break;
      if (D.occupy(pid, 1, '测试')) n++;
    }
    const lead = D.wsScoreOf(1, v) - D.wsScoreOf(v, 1);
    ok('① 占 4 省 → 战争分领先 ≥ 40', lead >= 40, lead);

    /* 未解锁：把分压到 15，条款不该出现，点了也被拒 */
    const s = D.wsOf(1, v); const keepA = s.a;
    s.a = keepA - (lead - 15);
    D.talkOpen(v);
    const html0 = document.getElementById('tkOpts').innerHTML;
    ok('① 领先 15：条款按钮不出现', html0.indexOf('data-term="puppet"') < 0);
    const r0 = D.talkDeal('puppet');
    ok('① 领先 15：点了被拒（不到 40）', !r0.ok && /不到 40/.test(r0.msg), r0.msg);
    D.talkClose();
    s.a = keepA;

    /* 解锁：领先 40 → 谈判桌出现条款，正文也提到 */
    D.talkOpen(v);
    const html1 = document.getElementById('tkOpts').innerHTML;
    ok('① 领先 40：谈判桌出现「扶植傀儡」条款', html1.indexOf('data-term="puppet"') >= 0);
    ok('① 谈判桌正文提到扶植傀儡', /傀儡/.test(document.getElementById('tkText').textContent));
    D.talkClose();

    /* 评估公式：接受分 = 领先 − 50 + 性格 + 快顶不住了 */
    const ev = D.aiDiploEval(v, 'puppet', 1);
    ok('① aiDiploEval 走傀儡那一套（kind=puppet）', ev.kind === 'puppet' && ev.lead === lead, 'lead=' + ev.lead);
    ok('① 接受分 = 领先 − 50 + 性格 + 快顶不住了',
      ev.score === ev.lead - 50 + ev.persona + ev.near,
      ev.lead + ' − 50 + ' + ev.persona + ' + ' + ev.near + ' = ' + ev.score);
    ok('① 接受与否就是分 ≥ 0', ev.accept === (ev.score >= 0), ev.score);

    /* 拒绝：设成军国（−20）→ 40 − 50 − 20 = −30 */
    A.aiDebug.setPersona(v, 'mil');
    const evMil = D.aiPuppetEval(v, 1);
    ok('① 军国在领先 40 时拒绝（宁死不屈 −20）', !evMil.accept, evMil.score + '：' + evMil.why);
    D.talkState.open = true; D.talkState.to = v;
    const rNo = D.talkDeal('puppet');
    const cds = Object.keys(D.diplo.talkCd).map(k => D.diplo.talkCd[k]);
    ok('① 被拒 → 记 5 回合冷却', !rNo.ok && cds.some(x => x > D.turn()), JSON.stringify(D.diplo.talkCd));
    ok('① 被拒时没有立表', Object.keys(D.puppetMap).length === 0);

    /* 接受：设成经营（+15）→ 40 − 50 + 15 = 5 ≥ 0 */
    A.aiDebug.setPersona(v, 'econ');
    const evEcon = D.aiPuppetEval(v, 1);
    ok('① 经营在领先 40 时接受（识时务 +15）', evEcon.accept, evEcon.score);
    for (const k of Object.keys(D.diplo.talkCd)) delete D.diplo.talkCd[k];
    D.talkState.open = true; D.talkState.to = v;
    const rYes = D.talkDeal('puppet');
    ok('① 成交：称臣立表', rYes.ok && D.suzerainOf(v) === 1, rYes.msg);
    ok('① 成交：战争清掉（停战了）', !D.atWar(1, v));
    ok('① 成交：关系锁 −80', D.relOf(1, v) === -80, D.relOf(1, v));
    const occ = Object.keys(D.occupyMap);
    ok('① 成交：已经占下的 4 省仍留在占领方手里（地不吐）',
      occ.length >= 4 && occ.every(pid => D.world().provinces[pid - 1].owner === 1),
      occ.length + ' 座占领省');
    ok('① 纪要写了「奉表称臣」',
      D.notes().concat(D.log()).some(x => /奉表称臣/.test(x.text || '')));
  `));

  /* ---------------- ② 称臣之后：朝贡 / 跟战 / 外交锁 ---------------- */
  add(await ev(`
    const v = window.__T.v;
    ok('② 记录里方向对（1 是宗主）', D.suzerainOf(v) === 1 && D.vassalsOf(1).indexOf(v) >= 0);

    /* 朝贡单元账：注入"本回合中央金入 100" → 应上贡 20，两边流水对得上 */
    const FC = A.resFlowC[v] || (A.resFlowC[v] = { gain: {}, loss: {}, d: {} });
    FC.gain.gold = 100; FC.loss = {}; FC.d = {};
    const cenV = D.ensureCentral(v), cenS = D.ensureCentral(1);
    cenV.gold = 500;
    const beforeS = cenS.gold || 0, beforeV = cenV.gold;
    const tr = D.puppetTribute();
    ok('② 上贡 = 中央金入的 20%', tr.paid === 20, 'paid=' + tr.paid);
    ok('② 傀儡侧记 loss.tribute', FC.loss.gold === 20 && FC.d.tribute === 20,
      JSON.stringify(FC.loss) + ' ' + JSON.stringify(FC.d));
    const FS = A.resFlowC[1];
    ok('② 宗主侧记 gain.tribute（与傀儡侧相等）',
      !!FS && FS.gain.gold === 20 && FS.d.tribute === 20,
      FS ? JSON.stringify(FS.gain) + ' ' + JSON.stringify(FS.d) : 'no flow');
    ok('② 真金位移（傀儡中央 −20 / 宗主中央 +20）',
      cenV.gold === beforeV - 20 && (cenS.gold || 0) === beforeS + 20,
      cenV.gold + ' / ' + (cenS.gold || 0));

    /* 见底少付、不欠账 */
    FC.gain.gold = 100; FC.loss = {}; FC.d = {};
    cenV.gold = 7;
    const tr2 = D.puppetTribute();
    ok('② 中央见底：少付不欠（付 7，不是 20）', tr2.paid === 7 && cenV.gold === 0, tr2.paid);
    ok('② 少付也没把账记成负数', cenV.gold >= 0);

    /* 强制参战：宗主宣战 → 傀儡自动同宣（靶子优先挑它的邻居，下面要验出兵） */
    let foe = 0;
    for (const id of (D.coOf(v).neighbors || [])) {
      const c = D.coOf(id);
      if (c && !D.deadMap[id] && id !== 1 && id !== v && !D.atWar(1, id)) { foe = id; break; }
    }
    if (!foe) {
      for (const c of D.world().countries) {
        if (!c || c.id === 1 || c.id === v || D.deadMap[c.id]) continue;
        if (D.atWar(1, c.id) || D.atWar(v, c.id)) continue;
        foe = c.id; break;
      }
    }
    ok('② 找得到一个第三国当靶子', foe > 0, foe);
    D.declareWar(1, foe);
    ok('② 宗主宣战 → 傀儡自动同宣（走 WARSET）', D.atWar(v, foe));
    ok('② 同宣也开了战争分账', !!D.wsOf(v, foe));

    /* 单向 leash：傀儡被宣，宗主不参战 */
    let foe2 = 0;
    for (const c of D.world().countries) {
      if (!c || c.id === 1 || c.id === v || D.deadMap[c.id]) continue;
      if (D.atWar(1, c.id) || D.atWar(v, c.id)) continue;
      foe2 = c.id; break;
    }
    if (foe2) {
      D.declareWar(foe2, v);
      ok('② 傀儡被宣 → 宗主不自动参战（单向 leash）', !D.atWar(1, foe2), '1 vs ' + foe2);
    } else {
      ok('② 傀儡被宣 → 宗主不参战（无第三方可测，跳过）', true, 'skip');
    }

    /* 出兵：给它一支军，跑战争格 → 应拿到进攻/围城命令（权重 = 宗主 warBias × 0.5） */
    const vp = D.coOf(v).provinces[0];
    D.newArmy(v, vp, { type: 'army', tier: 'leather', men: 4000 });
    A.aiDebug.quirkOf(1).war = 1.2;                 // 宗主是个军国，确保出兵力道不为 0
    A.aiDebug.setPersona(1, 'mil');
    A.aiWarTick();
    const mine = D.armiesOf(v)[0];
    ok('② 傀儡军队拿到进攻/围城命令', !!mine && !!mine.order &&
      (mine.order.type === 'attack' || mine.order.type === 'siege'),
      mine && mine.order ? mine.order.type : 'no order');

    /* 外交锁 */
    const x = (D.coOf(v).neighbors || [])[0] || foe;
    const p1 = D.proposePact(v, x, 'nap');
    ok('② 傀儡不能缔约（听命于宗主）', !p1.ok && /听命于宗主/.test(p1.msg), p1.msg);
    const p2 = D.declareWar(v, x);
    ok('② 傀儡不能宣战（听命于宗主）', !p2.ok && /听命于宗主/.test(p2.msg), p2.msg);

    /* REL 锁：手改到 0，缓释一轮后应该被钉回 −80 */
    D.relSet(1, v, 0);
    D.settleDiplo();
    ok('② 缓释不适用：关系钉回 −80', D.relOf(1, v) === -80, D.relOf(1, v));
  `));

  /* ---------------- ②b 地图（臣）标 / 国家卡横幅 ---------------- */
  add(await ev(`
    const v = window.__T.v;
    const L = A.computeLabels(D.world(), 'political', {
      scale: 0.4, width: 5000, height: 5000, countryKnown: () => true, vis: () => 2
    });
    const lab = L.filter(x => x.kind === 'country' && x.id === v)[0];
    ok('②b 地图国名带「（臣）」', !!lab && /（臣）$/.test(lab.text), lab ? lab.text : '没标出来');
    D.showCountry(v);
    const hV = document.getElementById('cDiplo').innerHTML;
    ok('②b 傀儡卡：奉表称臣横幅 + 已 N 回合 / 距可并入',
      /奉表称臣于/.test(hV) && /已 \\d+ 回合/.test(hV) && /距可并入/.test(hV));
    D.showCountry(1);
    const hS = document.getElementById('cDiplo').innerHTML;
    ok('②b 宗主卡：属国一行', /属国/.test(hS) && /奉表/.test(hS));
    ok('②b 宗主卡：和平并入 / 强并入两个钮都在',
      /data-annex=/.test(hS) && /data-force=/.test(hS));
    ok('②b 未满 60 回合：「和平并入」是灰的', /data-annex="\\d+" disabled/.test(hS));
    /* 宗主不能宣战自己的属国（它的兵反正跟着你打）—— 要收地走「强并入」。
     * 旧用例跟着改了（v18.5 入口搬家）：钮现在在**属国自己的卡**上，
     * 所以断言看属国卡那枚，而不是宗主卡上那排邻国钮。
     * 注意：属国卡上那枚只在"没在打仗"时渲染 —— 它自己可能还挂着别的仗
     * （被宗主拖下水的那些），所以**两边**的战争都要先停掉。 */
    for (const c0 of D.world().countries) {
      if (!c0 || D.deadMap[c0.id]) continue;
      if (c0.id !== 1 && D.atWar(1, c0.id)) D.makePeace(1, c0.id);
      if (c0.id !== v && D.atWar(v, c0.id)) D.makePeace(v, c0.id);
    }
    D.showCountry(v);
    const hS2 = document.getElementById('cDiplo').innerHTML;
    const hasBtn = new RegExp('data-declare="' + v + '"').test(hS2);
    ok('②b 属国卡：宣战钮置灰且写明走强并入',
      hasBtn && new RegExp('data-declare="' + v + '" disabled').test(hS2) && /强并入/.test(hS2),
      '属国 ' + v + ' · 宣战钮 ' + (hS2.match(/data-declare="\\d+"( disabled)?/g) || []).join(' / '));
    D.showCountry(1);
    ok('②b 宗主自己的卡上不再有宣战钮（只剩指路一句）',
      !/data-declare=/.test(document.getElementById('cDiplo').innerHTML));
    const dw = D.declareWar(1, v);
    ok('②b 直接调 declareWar 也挡回来', !dw.ok && /属国/.test(dw.msg), dw.msg);
  `));

  /* 真跑一回合：朝贡在结算尾自动发生（settlePuppets） */
  await step();
  add(await ev(`
    const v = window.__T.v;
    const FV = A.resFlowC[v] || {}, FS = A.resFlowC[1] || {};
    const lv = (FV.d && FV.d.tribute) || 0, gs = (FS.d && FS.d.tribute) || 0;
    ok('② 结算尾自动上贡，两边流水相等（loss = gain）', lv === gs, '傀儡 ' + lv + ' / 宗主 ' + gs);
    ok('② 上贡不超过两成收入', lv <= Math.floor(((FV.gain && FV.gain.gold) || 0) * 0.2) + 1,
      lv + ' / 收入 ' + ((FV.gain && FV.gain.gold) || 0));
  `));

  /* ---------------- ③ 投降线三分支 ---------------- */
  await fresh();
  add(await ev(`
    const v = victim();
    window.__T = { v: v };
    D.declareWar(1, v);
    const left = collapse(v, 1);
    ok('③ 受害国被砸到投降线', left <= D.surrenderLine(v, 1), left + ' ≤ ' + D.surrenderLine(v, 1));

    ok('③ 玩家是胜方 → 分支是「弹卡」', D.surrenderBranch(v, 1) === 'card');
    let cnt = 0; const N = 4000;
    for (let i = 0; i < N; i++) if (D.surrenderBranch(1, v) === 'puppet') cnt++;
    ok('③ 玩家败方：掷点约 40% 被要求称臣', Math.abs(cnt / N - 0.4) < 0.03,
      (cnt / N * 100).toFixed(1) + '%（n=' + N + '）');

    /* 已经是别人的傀儡 → 一律全吞（没有傀儡的傀儡） */
    const pm = D.makePuppet(v, 1);
    ok('③ 它已经是傀儡 → 分支一律 annex', pm.ok && D.surrenderBranch(1, v) === 'annex', pm.msg);
    /* 清场：删表 + 重新开战（下一步靠"玩家胜方"弹卡） */
    for (const k of Object.keys(D.puppetMap)) delete D.puppetMap[k];
    D.relSet(1, v, -100);
    D.declareWar(1, v);
    ok('③ 清场后仍在投降线以下', D.coOf(v).provinces.length <= D.surrenderLine(v, 1));
  `));

  /* 玩家是胜方：真回合里弹出受降卡，能选「扶植傀儡」 */
  await step();
  add(await ev(`
    const v = window.__T.v;
    const S = D.surrenderState, el = document.getElementById('talkModal');
    ok('③ 玩家胜方 → 弹出受降卡', !!S.open && S.loser === v && S.winner === 1,
      JSON.stringify({ open: S.open, loser: S.loser, winner: S.winner }));
    ok('③ 受降卡真的显示出来了', el.classList.contains('on'));
    const h = document.getElementById('tkOpts').innerHTML;
    ok('③ 卡上两个选项：全吞 / 扶植傀儡',
      h.indexOf('data-term="annex"') >= 0 && h.indexOf('data-term="puppet"') >= 0);
    ok('③ 卡上用整合成本表达「全吞的诱惑」',
      /整合/.test(document.getElementById('tkText').textContent) &&
      /回合/.test(document.getElementById('tkText').textContent));
    const r = D.surrenderChoose('puppet');
    ok('③ 选「扶植傀儡」→ 立表 + 停战', r.ok && D.suzerainOf(v) === 1, r.msg);
    ok('③ 选完之后卡收起来了', !D.surrenderState.open && !el.classList.contains('on'));
  `));

  /* ---------------- ④ 和平并入的条件 / 拒绝重掷 ---------------- */
  add(await ev(`
    const v = window.__T.v;
    const rd0 = D.puppetAnnexReady(1, v);
    ok('④ 刚称臣：和平并入不可提（还要 60 回合）', !rd0.ok && rd0.left > 0, rd0.why);

    const rec = D.puppetRec(1, v);
    rec.annexCd = D.turn() - 1;
    rec.warT = -999;
    const setHappy = (n) => {
      for (const pid of D.coOf(v).provinces) {
        const hp = D.happy[pid] || (D.happy[pid] = { v: 60 });
        hp.v = n;
      }
    };
    setHappy(70);
    ok('④ 满 60 回合 + 民心 70 → 可以提', D.puppetAnnexReady(1, v).ok,
      JSON.stringify(D.puppetAnnexReady(1, v)));

    setHappy(30);
    const rd2 = D.puppetAnnexReady(1, v);
    ok('④ 民心 30 → 人心不服，不能提', !rd2.ok && /民心/.test(rd2.why), rd2.why);
    setHappy(70);

    rec.warT = D.turn() - 2;
    const rd3 = D.puppetAnnexReady(1, v);
    ok('④ 刚被卷入战事 → 要静 10 回合', !rd3.ok && /战事/.test(rd3.why), rd3.why);
    rec.warT = -999;

    /* 拒绝：60% 接受 —— 这里不掷运气，直接把 Math.random 钉成 0.99（必拒）。
     * 掷点概率本身在 ③ 的 4000 次统计里已经验过，这一段验的是**被拒之后做什么**。 */
    const rnd = Math.random;
    rec.annexCd = D.turn() - 1;
    Math.random = () => 0.99;
    const rNo = D.tryAnnexPuppet(1, v);
    Math.random = rnd;
    ok('④ 被拒（Math.random=0.99）', !rNo.ok && rNo.rejected === true, rNo.msg);
    ok('④ 被拒 → annexCd 重掷 30 回合', rec.annexCd === D.turn() + 30, (rec.annexCd - D.turn()) + ' 回合');
    ok('④ 被拒时不吞地（省还是它的、也没记灭亡）',
      D.coOf(v).provinces.length > 0 && !D.deadMap[v]);
  `));

  /* 强并入：快，但有价 */
  await fresh();
  add(await ev(`
    const v = victim();
    window.__T = { v: v };
    D.declareWar(1, v);
    collapse(v, 1);
    D.makePuppet(1, v);
    /* 给它一位官 + 一支军（验"官员留任 / 军队 30% 转编"） */
    const vp = D.coOf(v).provinces[0];
    D.official[vp] = { id: 990001, name: '测试官', traitKey: 'plain', owed: 0, ten: 0 };
    const army = D.newArmy(v, vp, { type: 'army', tier: 'leather', men: 5000 });
    const offBefore = !!D.official[vp];
    const nBefore = D.coOf(v).provinces.length;
    /* 它现在手里的省（并入后这些必须直接是正式国土；
     * 之前打仗占下来的那几座**仍然算占领** —— 地不吐，整合照旧） */
    const mergedIds = D.coOf(v).provinces.slice();
    const hvBefore = D.countryHappyOf(1);

    const r = D.forceAnnexPuppet(1, v);
    ok('④ 强并入成功', r.ok, r.msg);
    ok('④ 省全易手（' + nBefore + ' 省归宗主）',
      D.coOf(v).provinces.length === 0 && D.coOf(1).provinces.length > nBefore);
    ok('④ DEAD 记档（puppet=force）', !!D.deadMap[v] && D.deadMap[v].puppet === 'force',
      JSON.stringify(D.deadMap[v]));
    ok('④ 并入的省不是未整合状态（OCCUPY / INTEG 都没有）',
      mergedIds.every(pid => !D.occupyMap[pid] && !D.integMap[pid]),
      mergedIds.filter(pid => D.occupyMap[pid] || D.integMap[pid]).length + ' 座还是占领态');
    ok('④ 官员留任', offBefore ? !!D.official[vp] : true, offBefore);
    const kept = D.army[army.id];
    ok('④ 军队解散 70% / 转编 30%',
      !!kept && kept.owner === 1 && kept.men === Math.round(5000 * 0.3),
      kept ? ('归 ' + kept.owner + ' · ' + kept.men + ' 人（原 5000）') : '整支解散了');
    ok('④ 强并入让并入各省不安 ≥ 30',
      D.coOf(1).provinces.some(pid => D.unrestOf(pid).v >= 30),
      '最高 ' + Math.max.apply(null, D.coOf(1).provinces.map(pid => D.unrestOf(pid).v)).toFixed(0));
    ok('④ 强并入让宗主全国民心下降（−8 那一档）', D.countryHappyOf(1) < hvBefore,
      hvBefore.toFixed(1) + ' → ' + D.countryHappyOf(1).toFixed(1));
  `));

  /* 和平并入：条件够 → 掷到答应（省直接算正式国土） */
  await fresh();
  add(await ev(`
    const v = victim();
    window.__T = { v: v };
    D.declareWar(1, v);
    collapse(v, 1);
    D.makePuppet(1, v);
    const rec = D.puppetRec(1, v);
    rec.warT = -999;
    for (const pid of D.coOf(v).provinces) {
      const hp = D.happy[pid] || (D.happy[pid] = { v: 60 });
      hp.v = 70;
    }
    /* 它此刻手里的省（并入后这些必须直接是正式国土）。
     * 只认这一批：之前打仗占下来的那几座**仍然算占领**（地不吐，整合照旧），
     * 拿"宗主全部省份"去要求在册，验的就不是并入了。 */
    const mergedIds = D.coOf(v).provinces.slice();
    let done = null;
    for (let i = 0; i < 40 && !done; i++) {
      rec.annexCd = D.turn() - 1;
      const r = D.tryAnnexPuppet(1, v);
      if (r.ok) done = r;
    }
    ok('④ 和平并入掷到答应（60%）', !!done, done ? done.msg : '40 次都没答应（不该发生）');
    ok('④ 和平并入：DEAD 记 puppet=peace', !!D.deadMap[v] && D.deadMap[v].puppet === 'peace',
      JSON.stringify(D.deadMap[v]));
    ok('④ 并入的省是正式国土（OCCUPY / INTEG 都没有）',
      mergedIds.every(pid => !D.occupyMap[pid] && !D.integMap[pid]),
      mergedIds.filter(pid => D.occupyMap[pid] || D.integMap[pid]).length + ' 座还是占领态 / 共 ' + mergedIds.length);
    const umax = Math.max.apply(null, D.coOf(1).provinces.map(pid => D.unrestOf(pid).v));
    ok('④ 和平并入不加不安恐慌（只有强并入才 +30）', umax < 30, umax.toFixed(0));
  `));

  /* ---------------- ⑤ 傀儡独立 ---------------- */
  await fresh();
  add(await ev(`
    const v = victim();
    window.__T = { v: v };
    D.declareWar(1, v);
    collapse(v, 1);
    D.makePuppet(1, v);
    /* 民心先托到 60（刚被打过，民心可能已经在 35 以下） */
    for (const pid of D.coOf(v).provinces) {
      const hp = D.happy[pid] || (D.happy[pid] = { v: 60 });
      hp.v = 60;
    }
    const base = D.indepScore(1, v);
    ok('⑤ 风平浪静时独立分 = 0', base.score === 0, JSON.stringify(base));

    const foes = [];
    for (const c of D.world().countries) {
      if (!c || c.id === 1 || c.id === v || D.deadMap[c.id]) continue;
      if (foes.length < 2) { D.declareWar(1, c.id); foes.push(c.id); }
    }
    const s1 = D.indepScore(1, v);
    ok('⑤ 宗主陷 2 场战争 → +30', s1.war === 30, JSON.stringify(s1));
    ok('⑤ 30 分还不到独立线 40', s1.score < 40, s1.score);

    const msuz = D.menOf(1);
    const vp = D.coOf(v).provinces[0];
    D.newArmy(v, vp, { type: 'army', tier: 'leather', men: Math.max(4000, Math.ceil(msuz)) });
    const s2 = D.indepScore(1, v);
    ok('⑤ 再补「军力过半」→ +20', s2.army === 20, JSON.stringify(s2));
    ok('⑤ 两项相加过线（≥ 40）', s2.score >= 40, s2.score);

    /* 掷点：把回合拨到对齐（每国错开），揭竿而起 */
    let t = D.turn();
    while ((t + v) % 10 !== 0) t++;
    D.setTurn(t);
    const fired = D.indepRoll();
    ok('⑤ 到点就揭竿而起', fired.indexOf(v) >= 0, JSON.stringify(fired));
    ok('⑤ 立表删掉了', !D.suzerainOf(v));
    ok('⑤ 独立即自动宣战宗主', D.atWar(v, 1));
    ok('⑤ 纪要写了「揭竿而起」',
      D.notes().concat(D.log()).some(x => /揭竿而起/.test(x.text || '')));
  `));

  /* 玩家当傀儡：+15 主角光环 + 面板全锁 */
  await fresh();
  add(await ev(`
    const v = victim();
    window.__T = { v: v };
    /* 反过来：AI 当宗主，玩家当傀儡 */
    D.declareWar(v, 1);
    collapse(1, v);
    const r = D.makePuppet(v, 1);
    ok('⑤ 玩家被迫称臣（AI 受表）', r.ok && D.suzerainOf(1) === v, r.msg);
    const sd = D.indepScore(v, 1);
    ok('⑤ 玩家傀儡：独立分恒 +15（主角光环）', sd.player === 15 && sd.score >= 15, JSON.stringify(sd));
    const p = D.declareWar(1, (D.coOf(1).neighbors || [])[0] || v);
    ok('⑤ 玩家当傀儡也不能自行宣战', !p.ok && /听命于宗主/.test(p.msg), p.msg);

    D.showCountry(1);
    const h = document.getElementById('cDiplo').innerHTML;
    ok('⑤ 玩家卡上写「奉表称臣于」', /奉表称臣于/.test(h));
    /* 旧用例跟着改了（v18.5 入口搬家）：自家卡上不再有宣战钮 ——
     * 原来那句"玩家卡上的宣战钮全置灰"改成：自家卡没有钮，
     * 邻国卡上那枚才是灰的（玩家是傀儡 → 宣战权在宗主手里）。 */
    ok('⑤ 玩家卡上不再渲染宣战钮，只剩指路一句',
      !/data-declare=/.test(h) && /点对方国土/.test(h));

    /* 在别国的卡上：缔约钮也全灰 */
    const x = (D.coOf(1).neighbors || [])[0];
    D.showCountry(x);
    const hx = document.getElementById('cDiplo').innerHTML;
    const pAll = (hx.match(/data-pact="/g) || []).length;
    const pDis = (hx.match(/data-pact="\\w+" disabled/g) || []).length;
    ok('⑤ 别国卡上的缔约钮全置灰', pAll > 0 && pDis === pAll, pDis + ' / ' + pAll);
    ok('⑤ 置灰的 title 写明「听命于宗主」', /听命于宗主/.test(hx));
    const dx = document.querySelector('#cDiplo button[data-declare="' + x + '"]');
    ok('⑤ 别国卡上的宣战钮也置灰（玩家是傀儡）',
      !!dx && dx.disabled && /听命于宗主/.test(dx.title), dx ? dx.title : '没有');
  `));

  /* ---------------- ⑥ 存档往返 ---------------- */
  await fresh();
  add(await ev(`
    const v = victim();
    window.__T = { v: v };
    D.declareWar(1, v);
    D.makePuppet(1, v);
    D.save();
    const raw = JSON.parse(localStorage.getItem(A.SAVE_KEY));
    ok('⑥ 版本号没升（仍 v6）', raw.v === 6, 'v' + raw.v);
    ok('⑥ 存档里有 puppet 块', !!raw.DIPLO && !!raw.DIPLO.puppet,
      raw.DIPLO ? Object.keys(raw.DIPLO).join(',') : 'no DIPLO');
    D.load();
  `));
  await sleep(2600);
  add(await ev(`
    const v = window.__T.v;
    const rec = D.puppetRecOf(v);
    ok('⑥ 读档后傀儡关系回来（方向 / 回合 / 可并入都在）',
      !!rec && D.suzerainOf(v) === 1 && rec.since > 0 && rec.annexCd > rec.since,
      JSON.stringify(rec));
    ok('⑥ 读档后关系锁仍是 −80', D.relOf(1, v) === -80, D.relOf(1, v));
    /* 老档（没有 puppet 块）→ 全补默认，不炸 */
    const raw = JSON.parse(localStorage.getItem(A.SAVE_KEY));
    delete raw.DIPLO.puppet;
    localStorage.setItem(A.SAVE_KEY, JSON.stringify(raw));
    D.load();
  `));
  await sleep(2600);
  add(await ev(`
    ok('⑥ 没有 puppet 块的老档读得进（表为空、不炸）',
      Object.keys(D.puppetMap).length === 0, Object.keys(D.puppetMap).length);
    ok('⑥ 老档读完还能立表（默认值可用）',
      typeof D.makePuppet === 'function' && !!D.coOf(1));
  `));

  /* ---------------- K bench 策略 K ---------------- */
  await gen('puppet-bench-K');
  await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });
  await sleep(150);
  add(await ev(`
    const seen = new Set();
    let forms = 0, maxPup = 0, cards = 0;
    for (let i = 0; i < 100; i++) {
      let g = 0;
      while (D.evtPending && D.evtPending() && g++ < 5) D.evtPick(0);
      D.nextTurn();
      /* 玩家胜方的受降卡会挡住后续结算 —— bench 统一按"全吞"放行，
       * 这样观察的仍然是 AI 之间的傀儡化 */
      if (D.surrenderState.open) { cards++; D.surrenderChoose('annex'); }
      for (const k of Object.keys(D.puppetMap)) if (!seen.has(k)) { seen.add(k); forms++; }
      maxPup = Math.max(maxPup, Object.keys(D.puppetMap).length);
    }
    const st = A.aiDebug.war;
    ok('K 100 回合：AI 之间打起来了', st.declare > 0, st.declare + ' 次宣战');
    ok('K 100 回合：有求和（世界不是单向屠杀）', st.peace > 0, st.peace + ' 次');
    ok('K 100 回合：有灭国（世界在动）', st.deaths > 0, st.deaths + ' 国灭亡');
    ok('K 100 回合：出现过傀儡化结局（≥1）', forms >= 1,
      forms + ' 次立表 · 同时最多 ' + maxPup + ' 家 · 玩家受降卡 ' + cards + ' 次');
    window.__K = { forms, maxPup, cards, declare: st.declare, peace: st.peace, deaths: st.deaths };
  `));

  /* K 受控：AI 胜方在投降线上会收朝贡国（不靠自由观察碰运气） */
  add(await ev(`
    D.exitGame();                                    // 退到工坊：不介入"玩家是胜方"的分支
    const w = D.world();
    const alive = [];
    for (const c of w.countries) if (c && !D.deadMap[c.id] && c.provinces.length > 2) alive.push(c.id);
    let made = 0, tries = 0;
    for (let i = 0; i < 14 && !made; i++) {
      const a = alive[i % alive.length], b = alive[(i + 1) % alive.length];
      if (a === b) continue;
      tries++;
      if (!D.atWar(a, b)) D.declareWar(a, b);
      collapse(b, a);
      D.settleWar();                                  // 走真实的投降判定（掷点在 surrenderBranch 里）
      if (D.suzerainOf(b) === a) made = 1;
    }
    ok('K 受控：AI 胜方在投降线上会收朝贡国（不总是全吞）', made === 1,
      made ? '第 ' + tries + ' 对成功立表' : '14 对都被全吞');
    if (made) {
      const pup = Object.keys(D.puppetMap).map(k => D.puppetMap[k])[0];
      ok('K 受控：记录方向正确（宗主 / 傀儡）', !!pup && pup.s === pup.s && pup.p !== pup.s,
        JSON.stringify(pup));
      ok('K 受控：傀儡没有灭亡（DEAD 表里没有它）', !D.deadMap[pup.p]);
    }
  `));

  /* K3 朝贡金对账：任一回合，傀儡 loss.tribute === 宗主 gain.tribute
   *
   * 这一段换一个干净世界。原因：上面那个 100 回合观察局打完，活着的国家
   * 大多只剩一两省、国库见底 —— 中央金入为 0 时 puppetTribute 按"见底少付
   * 不欠"直接跳过，拿那个世界对账只会得出「朝贡从不发生」的错误结论。
   * 对账要验的是"钱划过去时两边账对不对"，不是"破产国付不付得出"。 */
  await gen('puppet-K3');
  await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });
  await sleep(150);
  add(await ev(`
    const w = D.world();
    const suz1 = D.suzerainOf(1);
    if (suz1) D.dropPuppetRec(suz1, 1);      // 干净世界里不该有，兜底
    /* 挑最大的一个国家当属国（省份多、中央金入才够攒出整数金）。
     * 优先邻居；这个种子上"我"可能在岛上没有邻居 —— 再退到全图。
     * 立表不要求接壤（称臣是外交结果，不是地理结果）。 */
    const me = w.countries[0];
    const pool = [];
    for (const id of (me.neighbors || [])) { const c = w.countries[id - 1]; if (c) pool.push(c); }
    if (!pool.length) for (const c of w.countries) if (c) pool.push(c);
    let cand = 0;
    for (const c of pool) {
      if (c.id === 1 || D.deadMap[c.id]) continue;
      if (!cand || c.provinces.length > D.coOf(cand).provinces.length) cand = c.id;
    }
    ok('K3 找得到一个付得起朝贡的属国', !!cand, cand || '没有邻居');
    if (!cand) return o;
    const mk = D.makePuppet(1, cand);
    ok('K3 在干净世界里立表', mk.ok, mk.msg);
    if (!mk.ok) return o;

    let bad = 0, paid = 0, n = 0, turns = 0, inc0 = 0;
    for (let i = 0; i < 12 && n < 3; i++) {
      let g = 0;
      while (D.evtPending && D.evtPending() && g++ < 5) D.evtPick(0);
      D.nextTurn();
      turns++;
      if (D.surrenderState.open) D.surrenderChoose('annex');
      for (const k of Object.keys(D.puppetMap)) {
        const r = D.puppetMap[k];
        const FV = A.resFlowC[r.p] || {}, FS = A.resFlowC[r.s] || {};
        const lv = (FV.d && FV.d.tribute) || 0, gs = (FS.d && FS.d.tribute) || 0;
        if (r.p === cand) inc0 = Math.max(inc0, (FV.gain && FV.gain.gold) || 0);
        if (lv || gs) { n++; paid += lv; if (lv !== gs) bad++; }
      }
    }
    ok('K3 朝贡双方流水严格相等（loss = gain）', bad === 0, bad + ' 处不等 / ' + n + ' 笔');
    ok('K3 有真的朝贡发生（金在动）', n > 0 && paid > 0,
      n + ' 笔 / 观察 ' + turns + ' 回合 · 合计 ' + paid + ' 金 · 它的中央金入 ' + inc0);
  `));

  /* K4 收益对照：全吞 vs 收租（同种子、同设置、各跑 100 回合）
   *
   * 两个口径要分清，否则这张表会说谎：
   *   ① **选择瞬间**拿了多少省 —— 这是确定性的（全吞必得对方的全部省份，
   *      收租一座都拿不到）。中途省数会随战争上下浮动，拿 100 回合后的
   *      省数比大小，比的其实是"谁挨打得多"。
   *   ② **100 回合的经济账** —— 为了让它只反映经济，每回合把玩家从战争里
   *      摘出来（强制停战）。不然玩家被第三方打崩、甚至被全吞，
   *      "国库增减"就变成战场运气的函数了。 */
  const runYield = async (mode) => {
    await gen('puppet-yield');
    return page.evaluate((mode) => {
      const A = window.AO, D = A.resDebug;
      D.choosePlayer(1);
      const w = D.world(), me = w.countries[0];
      let v = 0;
      for (const id of (me.neighbors || [])) {
        const c = w.countries[id - 1];
        if (c && !D.deadMap[c.id] && c.provinces.length >= 8) { v = c.id; break; }
      }
      if (!v) return { mode: mode, err: '没有够大的邻居' };
      D.declareWar(1, v);
      /* 砸到投降线（打下来的这几座在两条路线里都归玩家 —— 地不吐） */
      const merged = [];
      let guard = 0;
      while (guard++ < 90 && D.coOf(v).provinces.length > D.surrenderLine(v, 1)) {
        const pid = D.coOf(v).provinces[0];
        if (!D.occupy(pid, 1, 'bench')) break;
        merged.push(pid);
      }
      const before = D.coOf(1).provinces.length;
      const gold0 = D.ensureCentral(1).gold || 0;
      if (mode === 'annex') D.annex(v, 1); else D.makePuppet(1, v);
      /* 选择瞬间：这一步是确定的（全吞 = 全拿，收租 = 一座不拿） */
      const atChoice = D.coOf(1).provinces.length;

      let tribute = 0, provTax = 0, died = 0, turns = 0, vassalTurns = 0;
      for (let i = 0; i < 100; i++) {
        let g = 0;
        while (D.evtPending && D.evtPending() && g++ < 5) D.evtPick(0);
        D.nextTurn();
        turns++;
        if (D.surrenderState.open) D.surrenderChoose('annex');
        /* 只比较经济账：每回合把玩家从战争里摘出来 */
        const ww = D.world();
        for (const c of ww.countries) {
          if (c && c.id !== 1 && !D.deadMap[c.id] && D.atWar(1, c.id)) D.makePeace(1, c.id);
        }
        /* 属国能撑多久是它自己的事（独立掷点每 10 回合一次）——
         * 这里只**如实记**，不作断言：中途揭竿而起也是设计的一部分。 */
        if (mode === 'puppet' && D.suzerainOf(v) === 1) vassalTurns++;
        tribute += (A.resFlowC[1] && A.resFlowC[1].d && A.resFlowC[1].d.tribute) || 0;
        for (const pid of merged) {
          const F = A.resFlow[pid];
          if (F && F.d && F.d.tax) provTax += F.d.tax.gold || 0;
        }
        if (D.deadMap[1]) { died = turns; break; }
      }
      return {
        mode: mode, v: v, nTake: merged.length, tribute: tribute, provTax: provTax,
        before: before, atChoice: atChoice, turns: turns, died: died, vassalTurns: vassalTurns,
        endState: mode !== 'puppet' ? '' :
          (D.deadMap[v] ? '被并掉了' : (D.suzerainOf(v) === 1 ? '仍在称臣' : '揭竿而起')),
        gold0: gold0, goldEnd: D.ensureCentral(1).gold || 0
      };
    }, mode);
  };
  const yA = await runYield('annex');
  const yB = await runYield('puppet');
  add((() => {
    const o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    ok('K4 两条路线都跑完了 100 回合',
      !!yA && !!yB && !yA.err && !yB.err && yA.goldEnd !== undefined && yB.goldEnd !== undefined,
      '全吞 ' + yA.turns + ' 回合 / 收租 ' + yB.turns + ' 回合');
    ok('K4 实跑的 100 回合里玩家没被第三方吞掉（对照才可信）', !yA.died && !yB.died,
      '全吞 ' + (yA.died || '活到最后') + ' / 收租 ' + (yB.died || '活到最后'));
    ok('K4 全吞在「选择瞬间」多拿了省', yA.atChoice > yB.atChoice,
      yA.atChoice + ' vs ' + yB.atChoice + '（+ ' + (yA.atChoice - yB.atChoice) + ' 省）');
    ok('K4 收租真的收到了朝贡', yB.tribute > 0, yB.tribute + ' 金 / ' + yB.turns + ' 回合');
    ok('K4 收租方真的立过表（不是空跑）', yB.vassalTurns > 0,
      '称臣 ' + yB.vassalTurns + ' / ' + yB.turns + ' 回合 · 结局：' + yB.endState);
    o.push({
      name: 'K4 收益对照（100 回合实测 · 同种子同设置）',
      ok: true,
      detail: '全吞：省 ' + yA.before + '→' + yA.atChoice + '（选择瞬间）· 国库 ' +
        Math.round(yA.goldEnd - yA.gold0) + ' 金 · 打下来的 ' + yA.nTake + ' 省中央抽税 ' +
        yA.provTax.toFixed(0) + ' 金　｜　收租：省 ' + yB.before + '→' + yB.atChoice +
        ' · 国库 ' + Math.round(yB.goldEnd - yB.gold0) + ' 金 · 朝贡 ' + yB.tribute.toFixed(0) +
        ' 金（属国 ' + yB.vassalTurns + ' 回合后' + yB.endState + '）'
    });
    return o;
  })());

  /* ---------------- 汇总 ---------------- */
  if (errors.length) {
    out.push({ name: '页面无 JS 错误', ok: false, detail: errors.slice(0, 3).join(' | ') });
  } else {
    out.push({ name: '页面无 JS 错误', ok: true, detail: '' });
  }
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
