/* =============================================================
 * test/diplo.js —— 外交和谈（关系值扩展 / 同盟 / 互不侵犯 / 战争分 /
 *                  谈判桌 / 跨国贸易）的验收
 *
 * 对着这次改动的验收清单逐条过：
 *   ① REL 驱动 / 缓释 / 同盟地板正确；邻省可见规则不回归
 *   ② 结盟全流程（门槛 / 冷却 / 达成 / 毁约背信 / 互不侵犯禁互宣）
 *   ②b 宣战入口搬家（v18.5）：钮在**对方卡**上、置灰矩阵（条约/傀儡/属国/不相邻）
 *      —— 旧用例跟着改了：原来断言"自己卡上那排邻国钮置灰"，现在看对方卡那枚
 *   ③ 战争分计分正确、谈判卡条款按分解锁、AI 评估符合公式、赔款到账
 *   ④ 外国货源买货全流程、封锁断供、贸易关系值累计封顶
 *   ⑤ 存档往返（不升版本号）、缺字段的老档不炸
 *
 * 跑法：node test/diplo.js
 * 小世界（120 省 / 6 国），约半分钟。
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
    document.getElementById('seed').value = 'diplo-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2600);

  /* ---------------- 0) 定义区与状态表就位 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const P = A.DIPLO;
    ok('0 定义区 AO.DIPLO 七块都在', P && P.rel && P.ally && P.nap && P.eval && P.score && P.talk && P.trade);
    ok('0 关系驱动表齐全（结盟/毁盟/互不侵犯/贸易/赔款/败仗/缓释/地板）',
      P.rel.ally === 40 && P.rel.breakAlly === -50 && P.rel.nap === 20 && P.rel.napEnd === -20 &&
      P.rel.trade === 0.5 && P.rel.tradeCap === 20 && P.rel.peacePay === 10 &&
      P.rel.battleLoss === -5 && P.rel.drift === 1 && P.rel.allyFloor === 60,
      JSON.stringify(P.rel));
    ok('0 五档词按高低排', P.rel.tiers.length === 5 &&
      P.rel.tiers[0].cn === '亲睦' && P.rel.tiers[4].cn === '敌对');
    ok('0 战争分五档数值', P.score.occupy === 10 && P.score.battle === 5 &&
      P.score.siege === 8 && P.score.capital === 30 && P.score.bombard === 1);
    ok('0 条约门槛（同盟 60 / 互不侵犯 20 / 接受线 30 / 冷却 10）',
      P.ally.need === 60 && P.nap.need === 20 && P.eval.accept === 30 && P.ally.cd === 10);
    ok('0 谈判桌（赔款门槛 20 / 两档 50·150 / 冷却 5）',
      P.talk.payLead === 20 && P.talk.payTiers.join(',') === '50,150' && P.talk.cd === 5);
    ok('0 跨国贸易（REL 门槛 20 / 溢价 1.8）', P.trade.minRel === 20 && P.trade.premium === 1.8);
    ok('0 状态表七张都在', ['allies', 'naps', 'score', 'cd', 'talkCd', 'prop', 'tradeAcc']
      .every(k => D.diplo[k] && typeof D.diplo[k] === 'object'));
    ok('0 导出 AO.aiDiploEval（下一批 AI 的接口）', typeof A.aiDiploEval === 'function');
    return o;
  }));

  /* ---------------- 选国：3 号（有邻国 4 / 6） ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug, w = D.world();
    window.__T = { p: 3, q: 4 };
    D.choosePlayer(3);
    window.__T.c3 = w.countries[2];
    window.__T.c4 = w.countries[3];
  });

  /* ---------------- ① REL：驱动 / 缓释 / 地板 / 邻省可见 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;

    /* 缓释：每回合向 0 走 1 */
    D.relSet(a, b, 20);
    D.settleDiplo();
    ok('① 缓释：20 → 19（向 0 走 1）', D.relOf(a, b) === 19, D.relOf(a, b));
    /* 这一回合被事件动过 → 不缓释 */
    D.relAdd(a, b, 5);                       // 24，同时标 RELHIT
    D.settleDiplo();
    ok('① 本回合动过 → 不缓释', D.relOf(a, b) === 24, D.relOf(a, b));
    D.setTurn(D.turn() + 1);
    D.settleDiplo();
    ok('① 下一回合恢复缓释（24 → 23）', D.relOf(a, b) === 23, D.relOf(a, b));
    /* 负数也往 0 走 */
    D.relSet(a, b, -20); D.setTurn(D.turn() + 1); D.settleDiplo();
    ok('① 负关系同样向 0 走（−20 → −19）', D.relOf(a, b) === -19, D.relOf(a, b));
    /* 交战对不缓释 */
    D.declareWar(a, b);
    const warRel0 = D.relOf(a, b);
    D.setTurn(D.turn() + 1); D.settleDiplo();
    ok('① 交战中不缓释（钉在 −100）', D.relOf(a, b) === warRel0 && warRel0 === -100, D.relOf(a, b));
    D.makePeace(a, b);

    /* 同盟地板：关系 65 结盟 → 之后每回合只掉到 60 为止 */
    D.relSet(a, b, 65);
    const pk = D.proposePact(a, b, 'ally');
    ok('① 结盟成功（关系 65 ≥ 60）', pk.ok && D.isAlly(a, b), pk.msg);
    for (let i = 0; i < 50; i++) { D.setTurn(D.turn() + 1); D.settleDiplo(); }
    ok('① 同盟地板托住：50 回合后仍是 60', D.relOf(a, b) === 60, D.relOf(a, b));
    /* 毁盟 −50（60 → 10） */
    D.breakPact(a, b, 'ally');
    ok('① 毁盟 −50（60 → 10）', !D.isAlly(a, b) && D.relOf(a, b) === 10, D.relOf(a, b));
    /* 互不侵犯作废 −20 */
    D.relSet(a, b, 40);
    D.proposePact(a, b, 'nap');
    const relNap = D.relOf(a, b);
    D.breakPact(a, b, 'nap');
    ok('① 作废互不侵犯 −20', D.relOf(a, b) === Math.max(-100, relNap - 20),
      relNap + ' → ' + D.relOf(a, b));

    /* 邻省可见规则不回归：交界 + 非交战 + REL ≥ 0 → 实时（2）；REL < 0 → 已探（1） */
    const w = D.world();
    let pid = 0;
    for (const q of T.c4.provinces) {
      const p = w.provinces[q - 1];
      if ((p.neighbors || []).some(n => w.provinces[n - 1].owner === a)) { pid = q; break; }
    }
    D.fogSee(a, pid, false);
    D.relSet(a, b, 0); D.fogInvalidate();
    const vis0 = D.fogVis(pid);
    D.relSet(a, b, -1); D.fogInvalidate();
    const vis1 = D.fogVis(pid);
    ok('① 邻省可见：REL 0 → 实时 / REL −1 → 已探（规则未动）',
      vis0 === 2 && vis1 === 1, 'REL0 vis=' + vis0 + ' · REL−1 vis=' + vis1);
    D.relSet(a, b, 10);
    return o;
  }));

  /* ---------------- ② 结盟全流程（含背信 / 禁互宣） ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;
    /* 先清干净 */
    if (D.isAlly(a, b)) D.breakPact(a, b, 'ally');
    if (D.isNap(a, b)) D.breakPact(a, b, 'nap');
    D.diplo.cd[a + '|' + b + '|ally'] = 0;
    D.diplo.cd[a + '|' + b + '|nap'] = 0;

    /* 关系不到门槛 → 拒绝 + 10 回合冷却 */
    D.relSet(a, b, 40);
    const r1 = D.proposePact(a, b, 'ally');
    ok('② 关系 40 < 60：同盟被拒', !r1.ok && /没到 60/.test(r1.msg), r1.msg);
    ok('② 被拒后冷却 10 回合（键带 kind：a|b|ally）',
      (D.diplo.cd[a + '|' + b + '|ally'] || 0) === D.turn() + 10,
      (D.diplo.cd[a + '|' + b + '|ally'] || 0) - D.turn() + ' 回合');
    const r2 = D.proposePact(a, b, 'ally');
    ok('② 冷却期内再提 → 直接挡回', !r2.ok && /还要等/.test(r2.msg), r2.msg);
    /* 门槛按 kind 分：同样 40 的关系，互不侵犯（≥20）能签。
     * 冷却也按 kind 分 —— 同盟被拒不该把互不侵犯一起锁住。 */
    D.relSet(a, b, 40);
    const r3 = D.proposePact(a, b, 'nap');
    ok('② 互不侵犯门槛低（REL 40 ≥ 20）：签成', r3.ok && D.isNap(a, b), r3.msg);
    ok('② 缔约 +20 关系', D.relOf(a, b) === 60, D.relOf(a, b));
    /* 互不侵犯禁互宣：面板置灰 + 规则层挡住。
     * 旧用例跟着改了（v18.5 入口搬家）：宣战钮不再长在自己卡上，
     * 而是长在**对方卡**上 —— 断言也跟着看对方卡那枚。 */
    D.showCountry(b);
    const declBtn = document.querySelector('#cDiplo button[data-declare="' + b + '"]');
    const pactedBtn = document.querySelector('#cDiplo button[data-break]');
    ok('② 对方卡上有「毁约」钮', !!pactedBtn, pactedBtn ? pactedBtn.textContent : '没有');
    ok('② 对方卡上的宣战钮：有互不侵犯 → 置灰且写「先毁约」',
      !!declBtn && declBtn.disabled && /先毁约/.test(declBtn.title),
      declBtn ? declBtn.title : '没有');
    /* 毁约宣战：先毁约（−20）再宣战（−100），战报两条：背信 + 宣战 */
    const logsBefore = D.log().length;
    const wr = D.declareWar(a, b);
    ok('② 有互不侵犯时宣战 = 撕毁条约（自动毁约）',
      wr.ok && D.atWar(a, b) && !D.isNap(a, b), wr.msg);
    ok('② 撕毁并宣战的战报写明背信', /背信/.test(wr.msg) && /撕毁互不侵犯/.test(wr.msg), wr.msg);
    ok('② 战报多了条目（宣战 + 背信）', D.log().length >= logsBefore + 2, D.log().length - logsBefore);
    ok('② 宣战后关系钉在 −100', D.relOf(a, b) === -100, D.relOf(a, b));
    D.makePeace(a, b);

    /* 同盟：达成 → 关系地板 60 → 宣战 = 背信 −50 */
    D.relSet(a, b, 62);
    D.diplo.cd[a + '|' + b + '|ally'] = 0;
    const r4 = D.proposePact(a, b, 'ally');
    ok('② 同盟达成', r4.ok && D.isAlly(a, b) && !D.isNap(a, b), r4.msg);
    ok('② 结盟 +40 且不低于地板 60', D.relOf(a, b) >= 60, D.relOf(a, b));
    const r5 = D.declareWar(a, b);
    ok('② 毁约宣战：同盟被撕、战报写明背信',
      r5.ok && !D.isAlly(a, b) && /撕毁同盟/.test(r5.msg), r5.msg);
    ok('② 毁约那一下记 −50（关系先 −50 再被宣战打到 −100）',
      D.relOf(a, b) === -100, D.relOf(a, b));
    D.makePeace(a, b);

    /* AI 评估公式：REL + 性格权重 + 共同敌人 ≥ 30 且 REL ≥ 门槛 */
    D.relSet(a, b, 60);
    const ev = D.aiDiploEval(b, 'ally', a);
    const personaW = (A.DIPLO.eval.persona[A.aiDebug.personaOf(b)] || 0);
    ok('② AI 评估 = REL + 性格 + 共同敌人', ev.rel === 60 && ev.persona === personaW &&
      ev.score === 60 + personaW + ev.common, JSON.stringify(ev));
    ok('② 军国比经营更难谈（性格权重 −10 vs +10）',
      A.DIPLO.eval.persona.mil === -10 && A.DIPLO.eval.persona.econ === 10);
    return o;
  }));

  /* ---------------- ②b 宣战入口搬家（v18.5）：点谁打谁 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;
    const w = D.world();
    /* 清干净：先跟所有人停战、清掉条约（② 结束时 a/b 刚停战，关系 −100 已到谷底） */
    for (const c0 of w.countries) {
      if (c0 && c0.id !== a && !D.deadMap[c0.id] && D.atWar(a, c0.id)) D.makePeace(a, c0.id);
    }
    if (D.isAlly(a, b)) D.breakPact(a, b, 'ally');
    if (D.isNap(a, b)) D.breakPact(a, b, 'nap');
    D.relSet(a, b, 10);

    /* ① 对方卡上有一枚「宣战」，label 只有两个字 —— 目标就是这张卡 */
    D.showCountry(b);
    let btn = document.querySelector('#cDiplo button[data-declare="' + b + '"]');
    ok('②b 对方卡上渲染 data-declare="对方 id" 且可点',
      !!btn && !btn.disabled && btn.textContent.trim() === '宣战',
      btn ? (btn.textContent.trim() + ' / disabled=' + btn.disabled) : '没有');
    ok('②b title 写明向 X 宣战', !!btn && /向 .+ 宣战/.test(btn.title), btn && btn.title);

    /* ② 点它：WARSET 出现该键、战报一条宣战、卡重画（已交战 → 变成求和排） */
    const n0 = D.log().length;
    btn.click();
    const key = Math.min(a, b) + '|' + Math.max(a, b);
    ok('②b 点一下 → WARSET 出现该键', !!D.wars[key] && D.atWar(a, b), JSON.stringify(Object.keys(D.wars)));
    ok('②b 战报多一条宣战', D.log().length === n0 + 1 && /宣战/.test(D.log()[0].text || ''),
      D.log().length - n0 + ' 条 · ' + (D.log()[0] || {}).text);
    ok('②b 点完重画的是对方卡（出现求和钮）',
      !!document.querySelector('#cDiplo button[data-talk="' + b + '"]'));
    D.makePeace(a, b);

    /* ③ 自己卡上那一排拆了：没有 data-declare，只有一句指路 */
    D.showCountry(a);
    const hMine = document.getElementById('cDiplo').innerHTML;
    ok('②b 自己卡不再渲染 data-declare', !/data-declare=/.test(hMine));
    ok('②b 自己卡换成一行指路', /宣战：点对方国土/.test(hMine));
    ok('②b 「四周皆海」那句随之消失', !/四周皆海/.test(hMine));

    /* ④ 有互不侵犯 → 置灰；毁约后**当回合**就能宣（不用等回合推进） */
    D.relSet(a, b, 40);
    D.diplo.cd[a + '|' + b + '|nap'] = 0;
    const rp = D.proposePact(a, b, 'nap');
    ok('②b 先签一张互不侵犯', rp.ok && D.isNap(a, b), rp.msg);
    D.showCountry(b);
    btn = document.querySelector('#cDiplo button[data-declare="' + b + '"]');
    ok('②b 有互不侵犯 → 置灰且 title 含「先毁约」',
      !!btn && btn.disabled && /先毁约/.test(btn.title), btn && btn.title);
    D.breakPact(a, b, 'nap');
    D.showCountry(b);
    btn = document.querySelector('#cDiplo button[data-declare="' + b + '"]');
    ok('②b 毁约后当回合：宣战钮转为可点', !!btn && !btn.disabled, btn && btn.title);

    /* ⑤ 不相邻 → 置灰（这层闸以前靠"自己卡只列陆上邻国"挡着，搬入口时必须跟着搬） */
    const nb = D.coOf(a).neighbors || [];
    const far = w.countries.filter(c => c && c.id !== a && !D.deadMap[c.id] && nb.indexOf(c.id) < 0)[0];
    ok('②b 小世界里找得到一个不相邻的活国', !!far, far && far.name);
    if (far) {
      D.showCountry(far.id);
      btn = document.querySelector('#cDiplo button[data-declare="' + far.id + '"]');
      ok('②b 无陆上接壤 → 置灰且 title 写「不相邻」',
        !!btn && btn.disabled && /不相邻/.test(btn.title), btn && btn.title);
    }
    D.showCountry(b);
    return o;
  }));

  /* ---------------- ③ 战争分 / 谈判桌 / 赔款 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;
    const w = D.world();
    if (D.atWar(a, b)) D.makePeace(a, b);

    /* 宣战清零战争分 */
    D.diplo.score[a + '|' + b] = { a: 99, b: 99 };
    D.declareWar(a, b);
    ok('③ 宣战把战争分清零', D.wsScoreOf(a, b) === 0 && D.wsScoreOf(b, a) === 0,
      JSON.stringify(D.wsOf(a, b)));

    /* 占领省 +10（挑一个非首都省） */
    const capB = T.c4.capital;
    let plain = 0;
    for (const q of T.c4.provinces) if (q !== capB) { plain = q; break; }
    D.occupy(plain, a, '测试');
    ok('③ 占领省 +10', D.wsScoreOf(a, b) === 10, D.wsScoreOf(a, b));
    /* 首都易手 +30（外加占领省的 +10） */
    D.occupy(capB, a, '测试');
    ok('③ 首都易手 +30（该省另有占领 +10，合计 50）', D.wsScoreOf(a, b) === 50, D.wsScoreOf(a, b));
    /* 围城陷城 +8 */
    let third = 0;
    for (const q of T.c4.provinces) if (!D.occupyMap[q] && q !== capB) { third = q; break; }
    if (third) D.occupy(third, a, '围城开城');
    ok('③ 围城陷城 +8（不是 +10）', D.wsScoreOf(a, b) === (third ? 58 : 50), D.wsScoreOf(a, b));
    /* 会战胜 +5 / 轰击 +1 */
    D.wsAdd(a, b, 'battle');
    D.wsAdd(a, b, 'bombard');
    ok('③ 会战胜 +5 · 轰击 +1', D.wsScoreOf(a, b) === (third ? 64 : 56), D.wsScoreOf(a, b));
    ok('③ 分数是双向的（对方 0 分）', D.wsScoreOf(b, a) === 0, D.wsScoreOf(b, a));
    /* 不在交战就不记分（1 号国跟谁都没打） */
    const before1 = D.wsScoreOf(1, a);
    D.wsAdd(1, a, 'battle');
    ok('③ 非交战方不记分', D.wsScoreOf(1, a) === before1, D.wsScoreOf(1, a));

    /* 谈判卡：条款按分解锁 */
    D.ensureCentral(a).gold = 400;
    const open = D.talkOpen(b);
    ok('③ 求和能开谈判桌', open && open.ok, JSON.stringify(open));
    ok('③ 谈判卡在 DOM 上开着', document.getElementById('talkModal').classList.contains('on'));
    const terms = [...document.querySelectorAll('#tkOpts button[data-term]')].map(x => ({
      t: x.getAttribute('data-term'), off: x.disabled
    }));
    ok('③ 白和永远可选', terms.some(x => x.t === 'white' && !x.off), JSON.stringify(terms));
    ok('③ 领先 64 ≥ 20：两档赔款都可选',
      terms.filter(x => /^pay/.test(x.t)).every(x => !x.off), JSON.stringify(terms));
    ok('③ 对比条画出来了', !!document.querySelector('#tkBar .tkA') &&
      !!document.querySelector('#tkBar .tkB'));
    /* 战争分不够时赔款置灰 */
    D.talkClose();
    const saveScore = JSON.parse(JSON.stringify(D.wsOf(a, b)));
    D.wsOf(a, b).a = 5; D.wsOf(a, b).b = 0;
    D.talkOpen(b);
    const terms2 = [...document.querySelectorAll('#tkOpts button[data-term]')].map(x => ({
      t: x.getAttribute('data-term'), off: x.disabled
    }));
    ok('③ 领先 5 < 20：赔款置灰、白和仍可点',
      terms2.filter(x => /^pay/.test(x.t)).every(x => x.off) &&
      terms2.some(x => x.t === 'white' && !x.off), JSON.stringify(terms2));
    D.talkClose();
    D.wsOf(a, b).a = saveScore.a; D.wsOf(a, b).b = saveScore.b;
    return o;
  }));

  /* ---------------- ③b AI 反向评估 + 赔款到账 / 被拒冷却 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;

    /* 公式：对方分 − 己方分 + 性格 + 民心压力 */
    const s = { mine: D.wsScoreOf(b, a), theirs: D.wsScoreOf(a, b) };
    const ev = D.aiPeaceEval(b, a);
    const personaW = A.DIPLO.eval.persona[A.aiDebug.personaOf(b)] || 0;
    ok('③ AI 和议评估 = (对方分 − 己方分) + 性格 + 民心压力 − 要价',
      ev.score === (s.theirs - s.mine) + personaW + ev.press - A.DIPLO.talk.demand,
      JSON.stringify(ev));

    /* 打崩它 → 接受赔款；钱从我国库到它国库 */
    D.wsOf(a, b).a = 60; D.wsOf(a, b).b = 0;
    const g0a = D.ensureCentral(a).gold, g0b = D.ensureCentral(b).gold;
    D.ensureCentral(a).gold = 400;
    D.diplo.talkCd[a + '|' + b] = 0;
    D.talkOpen(b);
    const deal = D.talkDeal('pay50');
    ok('③ 赔款和议成交', deal.ok && deal.pay === 50, deal.msg);
    ok('③ 赔款转账：−50 / +50（中央国库）',
      D.ensureCentral(a).gold === 350 && D.ensureCentral(b).gold === g0b + 50,
      D.ensureCentral(a).gold + ' / ' + D.ensureCentral(b).gold);
    ok('③ 停战后关系 = −30 + 赔款 +10 = −20',
      !D.atWar(a, b) && D.relOf(a, b) === -20, D.relOf(a, b));
    ok('③ 条约进了纪要', D.notes().some(n => /条约/.test(n.text) && /赔款/.test(n.text)));
    D.ensureCentral(a).gold = g0a;

    /* 被拒 → 5 回合冷却，求和钮置灰。
     * 构造：领先刚好 20（够格开口）+ 军国性格（−10）→ 20 − 10 − 15(要价) < 0，拒。 */
    D.declareWar(a, b);
    A.aiDebug.setPersona(b, 'mil');
    D.wsOf(a, b).a = 20; D.wsOf(a, b).b = 0;
    D.diplo.talkCd[a + '|' + b] = 0;
    D.talkOpen(b);
    const rej = D.talkDeal('pay50');
    ok('③ 战况打平 + 民心不差 → AI 拒赔款', !rej.ok && /拒绝/.test(rej.msg), rej.msg);
    ok('③ 被拒后冷却 5 回合', (D.diplo.talkCd[a + '|' + b] || 0) === D.turn() + 5,
      (D.diplo.talkCd[a + '|' + b] || 0) - D.turn());
    D.showCountry(a);
    const talkBtn = document.querySelector('#cDiplo button[data-talk]');
    ok('③ 冷却期内求和钮置灰', !!talkBtn && talkBtn.disabled,
      talkBtn ? 'disabled=' + talkBtn.disabled : '没有钮');
    const openAgain = D.talkOpen(b);
    ok('③ 冷却期内开不了谈判桌', !openAgain || openAgain.ok !== true, JSON.stringify(openAgain));
    /* 白和永远能走（不接受评估） */
    D.diplo.talkCd[a + '|' + b] = 0;
    D.talkOpen(b);
    const white = D.talkDeal('white');
    ok('③ 白和永远可选（现状承认）', white.ok && !D.atWar(a, b), white.msg);
    return o;
  }));

  /* ---------------- ④ 跨国贸易 + 封锁断供 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q, w = D.world();
    if (D.atWar(a, b)) D.makePeace(a, b);
    const pid = T.c3.provinces[0], prov = w.provinces[pid - 1];
    const srcPid = T.c4.provinces[0];
    /* 铺条件：本省有市场、省库有钱；对方那个省有 100 粮 */
    A.resSim[srcPid].grain.stock = 100;
    A.resSim[pid].gold.stock = 200;
    D.buildUniv(prov, 'market', true);
    A.resMarket[pid].site = 0;
    A.resMarket[pid].n = 1;

    /* 关系不到 20 → 不列货源 */
    D.relSet(a, b, 19);
    ok('④ 关系 19 < 20：不列外国货源', D.foreignSources(prov, 'grain').length === 0,
      D.foreignSources(prov, 'grain').length);
    D.relSet(a, b, 25);
    const srcs = D.foreignSources(prov, 'grain');
    ok('④ 关系 25：列出货源（对方最富的那个省）',
      srcs.length === 1 && srcs[0].cid === b && srcs[0].stock === 100,
      JSON.stringify(srcs));
    const lot = A.GOV.buyLot();
    ok('④ 溢价 = 中央价 × 1.8', srcs[0].price === Math.ceil(lot.gold * 1.8),
      srcs[0].price + ' vs ' + Math.ceil(lot.gold * 1.8));

    /* 买一笔：钱进对方省库、货进本省、关系 +0.5（攒整） */
    const g0 = A.resSim[pid].gold.stock, h0 = A.resSim[srcPid].gold.stock;
    const n0 = A.resSim[pid].grain.stock, s0 = A.resSim[srcPid].grain.stock;
    const r = D.buyForeign(prov, 'grain', b);
    ok('④ 买货成功', r && r.ok && r.got === lot.n, JSON.stringify(r));
    ok('④ 扣本省省库金', A.resSim[pid].gold.stock === g0 - r.paid,
      g0 + ' → ' + A.resSim[pid].gold.stock);
    ok('④ 金进对方那个省的省库（不是国库）',
      A.resSim[srcPid].gold.stock === h0 + r.paid, h0 + ' → ' + A.resSim[srcPid].gold.stock);
    ok('④ 货进本省、对方省库扣货',
      A.resSim[pid].grain.stock === n0 + lot.n && A.resSim[srcPid].grain.stock === s0 - lot.n,
      '本省 ' + A.resSim[pid].grain.stock + ' · 对方 ' + A.resSim[srcPid].grain.stock);
    ok('④ 一笔 +0.5 关系（攒整，整数表不动）', D.relOf(a, b) === 25, D.relOf(a, b));
    ok('④ 贸易累计记了 0.5', D.diplo.tradeAcc[a + '|' + b] === 0.5, D.diplo.tradeAcc[a + '|' + b]);

    /* 封锁断供 */
    D.blockadeMap[pid] = b;
    const rb = D.buyForeign(prov, 'grain', b);
    ok('④ 封锁省买不了外国货', !rb || !rb.ok, rb && rb.msg);
    delete D.blockadeMap[pid];

    /* 累计上限 +20 */
    for (let i = 0; i < 60; i++) {
      A.resSim[srcPid].grain.stock = 100;
      A.resSim[pid].gold.stock = 400;
      D.buyForeign(prov, 'grain', b);
    }
    ok('④ 贸易关系累计封顶 +20（25 → 45）', D.relOf(a, b) === 45, D.relOf(a, b));
    ok('④ 累计表停在 20', D.diplo.tradeAcc[a + '|' + b] === 20, D.diplo.tradeAcc[a + '|' + b]);
    /* 交战 / 灭亡国不是货源 */
    D.relSet(a, b, 60);
    D.declareWar(a, b);
    ok('④ 交战国不供货', D.foreignSources(prov, 'grain').length === 0,
      D.foreignSources(prov, 'grain').length);
    D.makePeace(a, b);
    return o;
  }));

  /* ---------------- 截图：国卡外交节 + 谈判卡 ---------------- */
  await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, T = window.__T;
    const a = T.p, b = T.q;
    if (D.atWar(a, b)) D.makePeace(a, b);
    D.relSet(a, b, 72);
    D.diplo.cd[a + '|' + b] = 0;
    D.proposePact(a, b, 'ally');
    D.declareWar(a, b);                        // 撕盟 → 开战（为了同时看到战争分条）
    D.wsOf(a, b).a = 42; D.wsOf(a, b).b = 12;
    D.diplo.talkCd[a + '|' + b] = 0;
    D.ensureCentral(a).gold = 260;
    D.showCountry(b);
  });
  await sleep(500);
  {
    const box = await page.evaluate(() => {
      const el = document.getElementById('cDiplo');
      const r = el.getBoundingClientRect();
      const card = document.getElementById('country');
      const cr = card.getBoundingClientRect();
      return { x: Math.max(0, cr.x), y: Math.max(0, cr.y), width: cr.width, height: Math.min(cr.height, 940) };
    });
    await page.screenshot({ path: shot('diplo-card.png'), clip: box });
  }
  await page.evaluate(() => {
    const D = window.AO.resDebug, T = window.__T;
    D.talkOpen(T.q);
  });
  await sleep(400);
  {
    const box = await page.evaluate(() => {
      const el = document.querySelector('#talkModal .evcard');
      const r = el.getBoundingClientRect();
      return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 };
    });
    await page.screenshot({ path: shot('diplo-talk.png'), clip: box });
  }
  await page.evaluate(() => window.AO.resDebug.talkClose());

  /* ---------------- ⑤ 存档往返 + 老档容错 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;
    /* 铺一份有内容的档：同盟 / 互不侵犯 / 战争分 / 冷却 / 贸易累计 */
    if (D.atWar(a, b)) D.makePeace(a, b);
    D.relSet(a, b, 70);
    D.diplo.cd[a + '|' + b] = 0;
    D.proposePact(a, b, 'ally');
    D.relSet(a, 6, 30);
    D.diplo.cd[a + '|' + 6] = 0;
    D.proposePact(a, 6, 'nap');
    D.diplo.score[a + '|' + 6] = { a: 12, b: 3 };
    D.diplo.cd[a + '|' + 6] = D.turn() + 7;
    D.diplo.tradeAcc[a + '|' + 6] = 4.5;
    D.diplo.prop[a + '|' + 6] = { kind: 'nap', ok: true, turn: D.turn() };
    const before = {
      ally: D.isAlly(a, b), nap: D.isNap(a, 6), rel: D.relOf(a, b),
      score: JSON.parse(JSON.stringify(D.wsOf(a, 6))),
      cd: D.diplo.cd[a + '|' + 6], trade: D.diplo.tradeAcc[a + '|' + 6]
    };
    D.save(true);
    const raw = JSON.parse(localStorage.getItem(A.SAVE_KEY));
    ok('⑤ 存档里有 DIPLO 块', !!raw.DIPLO && !!raw.DIPLO.allies && !!raw.DIPLO.score,
      raw.DIPLO ? Object.keys(raw.DIPLO).join(',') : '没有');
    ok('⑤ 版本号没升（仍 v6）', raw.v === 6, raw.v);
    ok('⑤ 同盟 / 互不侵犯都进档',
      Object.keys(raw.DIPLO.allies).length === 1 && Object.keys(raw.DIPLO.naps).length === 1,
      JSON.stringify(raw.DIPLO.allies) + ' / ' + JSON.stringify(raw.DIPLO.naps));

    /* 换一局再读回来 */
    document.getElementById('seed').value = 'diplo-other';
    document.getElementById('gen').click();
    return o;
  }));
  await sleep(2600);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, A = window.AO, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;
    ok('⑤ 换世界后条约表清空', Object.keys(D.diplo.allies).length === 0,
      Object.keys(D.diplo.allies).length);
    D.load();
    return o;
  }));
  await sleep(3200);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [], T = window.__T;
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const a = T.p, b = T.q;
    ok('⑤ 读档后同盟回来', D.isAlly(a, b), JSON.stringify(D.diplo.allies));
    ok('⑤ 读档后互不侵犯回来', D.isNap(a, 6), JSON.stringify(D.diplo.naps));
    ok('⑤ 读档后关系值回来（≥60 的地板）', D.relOf(a, b) >= 60, D.relOf(a, b));
    const sc = D.wsOf(a, 6);
    ok('⑤ 读档后战争分回来', sc.a === 12 && sc.b === 3, JSON.stringify(sc));
    ok('⑤ 读档后冷却回来', D.diplo.cd[a + '|' + 6] > D.turn(), D.diplo.cd[a + '|' + 6]);
    ok('⑤ 读档后贸易累计回来', D.diplo.tradeAcc[a + '|' + 6] === 4.5, D.diplo.tradeAcc[a + '|' + 6]);
    ok('⑤ 读档后提案状态回来', (D.diplo.prop[a + '|' + 6] || {}).kind === 'nap',
      JSON.stringify(D.diplo.prop[a + '|' + 6]));

    /* 老档（没有 DIPLO 块）→ 全补默认，不炸 */
    const raw = JSON.parse(localStorage.getItem(window.AO.SAVE_KEY));
    delete raw.DIPLO;
    localStorage.setItem(window.AO.SAVE_KEY, JSON.stringify(raw));
    D.load();
    return o;
  }));
  await sleep(3200);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    ok('⑤ 没有 DIPLO 块的老档读得进（条约表为空、不炸）',
      Object.keys(D.diplo.allies).length === 0 && Object.keys(D.diplo.naps).length === 0,
      Object.keys(D.diplo.allies).length + ' / ' + Object.keys(D.diplo.naps).length);
    ok('⑤ 老档读完还能继续缔约（默认值可用）',
      typeof D.proposePact === 'function' && D.relOf(1, 2) !== undefined);
    return o;
  }));

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
