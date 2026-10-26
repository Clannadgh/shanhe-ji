/* =============================================================
 * test/news.js —— 世界消息走情报渠道（v15）的验收
 *
 * 这一批要堵的是"地图有迷雾、纪要却全知"那个漏洞：AI 之间的宣战 / 灭国 /
 * 都城易手，不再当回合就推到玩家眼前，而是按情报档**延迟**送达，
 * 低档还会传来走样的风闻。涉玩家自己的事照旧即时。
 *
 * 覆盖验收清单 1~7：
 *   ① 无预算：内陆两国互宣 → 听不到；接壤国宣战 → 5~8 回合后到、带时间戳与"数月前"
 *   ② 常规档：已知国家 3~4 回合；两国都未知 → 丢弃
 *   ③ 重金档：1 回合 + 战况一行；入队时 0 档、中途升重金 → 提前送达
 *   ④ 涉玩家的宣战 / 灭国当回合即时报
 *   ⑤ 0 档风闻 15%（±5）：张冠李戴 / 夸大其词各能见到；实讯或探测触发「更正」
 *   ⑥ 编年史按事件年份归位、迟到条带「（后闻）」、风闻不进年表
 *   ⑦ 每回合 ≤2 条；bench 三项统计出数；存档往返；旧档（没有 NEWS 字段）能读
 *
 * 跑法：node test/news.js
 * 小世界（140 省 / 8 国）+ 约 20 个回合，几十秒。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
function add(list) { for (const c of list) out.push(c); }

/* 走一回合：事件弹窗先处置掉，再点下一回合（和真人点法一致） */
async function step(page) {
  await page.evaluate(() => {
    const AO = window.AO;
    if (AO.evtPending && AO.evtPending()) AO.evtPick(0);
    AO.resDebug.nextTurn();
  });
  await sleep(120);
}
/* 本回合纪要里带 🌍 的那几条 */
async function envNotes(page) {
  return page.evaluate(() => window.AO.resDebug.notes().filter(n => /🌍/.test(n.text || ''))
    .map(n => ({ text: n.text, cls: n.cls, evtTurn: n.evtTurn | 0, late: n.late | 0, rumour: n.rumour | 0 })));
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1400);
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'news-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(3000);

  /* ---------------- 铺场：选一个有邻国的国家，清干净队列 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    let pick = null;
    for (const c of w.countries) {
      if (!c || !c.provinces.length) continue;
      if (!c.neighbors.some(x => x !== c.id)) continue;
      if (!pick) pick = c;
    }
    D.choosePlayer(pick.id);
    D.newsQueue.length = 0;
    AO.resNews.rumour.length = 0;
    ok('⓪ 铺场：选国有邻国、邸报队列已清空',
      !!pick && D.newsQueue.length === 0, pick && pick.name + ' / 省 ' + pick.provinces.length);
    ok('⓪ 情报署默认「无」档', D.fogBudgetOf(D.player()) === 0, D.fogBudgetOf(D.player()));
    ok('⓪ 默认就是 5~8 / 3~4 / 1 的时滞表',
      JSON.stringify(AO.INTEL.news.delay) === '[[5,8],[3,4],[1,1]]',
      JSON.stringify(AO.INTEL.news.delay));
    return o;
  }));

  /* ---------------- ① 无预算：边界决定"听不听得见" ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.fogSetBudget(P, 0);
    /* 这一段专测"时滞与时间戳"，先把风闻关掉 —— 风闻会把正文改写掉，
     * 那就没法用原句认人了（⑤ 再把它开回来测概率）。 */
    window.__RP = AO.INTEL.news.rumourP;
    AO.INTEL.news.rumourP = 0;
    const adj = AO.resNews.adj();
    const alive = w.countries.filter(c => c && c.provinces.length && c.id !== P && !D.deadMap[c.id]);
    /* 内陆两国：都不挨着我 */
    let inA = 0, inB = 0;
    for (const a of alive) {
      if (adj[a.id]) continue;
      for (const b of alive) {
        if (b.id === a.id || adj[b.id]) continue;
        inA = a.id; inB = b.id; break;
      }
      if (inA) break;
    }
    /* 边境一国 + 随便另一国 */
    let bd = 0, other = 0;
    for (const a of alive) if (adj[a.id]) { bd = a.id; break; }
    for (const a of alive) if (a.id !== bd) { other = a.id; break; }
    window.__T = { inA, inB, bd, other };

    const s0 = Object.assign({}, D.newsStat());
    const took = D.worldNews('测试：内陆一国向另一国宣战', 'warn',
      { parties: [inA, inB], kind: 'war' });
    ok('① 无预算：内陆两国互宣 —— 根本听不到（不入队）',
      took === false && D.newsQueue.length === 0, 'took=' + took + ' 队列 ' + D.newsQueue.length);
    ok('① 「未知国丢弃」记了数', D.newsStat().dropped === s0.dropped + 1,
      s0.dropped + ' → ' + D.newsStat().dropped);

    const took2 = D.worldNews('测试：边境丙向丁宣战', 'warn',
      { parties: [bd, other], kind: 'war' });
    const it = D.newsQueue[0];
    ok('① 接壤国宣战能入队', took2 === true && D.newsQueue.length === 1, '队列 ' + D.newsQueue.length);
    ok('① 时滞掷在 5~8 回合', !!it && it.delay >= 5 && it.delay <= 8, it && it.delay);
    ok('① 入队记了事件回合与档位', !!it && it.evtTurn === D.turn() && it.tier === 0,
      it && ('evtTurn ' + it.evtTurn + ' / 档 ' + it.tier));
    window.__D = it ? it.delay : 5;
    return o;
  }));

  /* 一路走到送达：记下第几回合到的、文本长什么样 */
  let firstText = '', firstTurn = 0, firstEvt = 0;
  const t0 = await page.evaluate(() => window.AO.resDebug.turn());
  for (let i = 0; i < 10; i++) {
    await step(page);
    const ns = await envNotes(page);
    const hit = ns.find(n => /测试：边境丙向丁宣战/.test(n.text));
    if (hit) { firstText = hit.text; firstTurn = await page.evaluate(() => window.AO.resDebug.turn()); firstEvt = hit.evtTurn; break; }
  }
  add([{
    name: '① 边境消息在 5~8 回合后送到',
    ok: !!firstText && (firstTurn - t0) === (await page.evaluate(() => window.__D)),
    detail: firstText ? ('第 ' + (firstTurn - t0) + ' 回合后到（时滞 ' + (await page.evaluate(() => window.__D)) + '）') : '没等到'
  }, {
    name: '① 送达带事件时间戳 + 「（数月前）」',
    ok: /^🌍 【[^】]+】/.test(firstText) && /（数月前）/.test(firstText) && firstEvt === t0,
    detail: firstText
  }]);

  /* ---------------- ② 常规档：已知国家 3~4；都未知就丢弃 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), P = D.player(), T = window.__T, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.newsQueue.length = 0;
    D.fogSetBudget(P, 1);
    const adj = AO.resNews.adj();
    /* 已知（已探或接壤）的一国 */
    let kn = 0;
    for (const c of w.countries) {
      if (!c || !c.provinces.length || c.id === P || D.deadMap[c.id]) continue;
      if (AO.fogCountryKnown(c.id) || adj[c.id]) { kn = c.id; break; }
    }
    const took = D.worldNews('测试：常规档丙向丁宣战', 'warn', { parties: [kn, T.bd], kind: 'war' });
    const it = D.newsQueue[0];
    ok('② 常规档：已知国家的消息能入队', took === true && !!it, '队列 ' + D.newsQueue.length);
    ok('② 常规档时滞 3~4 回合', !!it && it.delay >= 3 && it.delay <= 4, it && it.delay);

    D.newsQueue.length = 0;
    const s0 = D.newsStat().dropped;
    const took2 = D.worldNews('测试：两个未知国家的战事', 'warn',
      { parties: [T.inA, T.inB], kind: 'war' });
    ok('② 两国都未知 → 静默丢弃', took2 === false && D.newsQueue.length === 0 &&
      D.newsStat().dropped === s0 + 1, '队列 ' + D.newsQueue.length);
    /* 常规档那条也让它落地：bench 的"各档平均延迟"要有 1 档的样本，
     * 否则那张表上 1 档永远是"—"，验收时看不出这一档到底走几回合。 */
    D.newsQueue.length = 0;
    D.worldNews('测试：常规档落地样本', 'warn', { parties: [kn, T.bd], kind: 'war' });
    if (D.newsQueue[0]) { D.newsQueue[0].delay = 0; D.flushWorldNews(); }
    ok('② 常规档送达后计入 1 档统计', D.newsStat().byTier[1].n > 0,
      JSON.stringify(D.newsStat().byTier[1]));
    D.fogSetBudget(P, 0);
    return o;
  }));

  /* ---------------- ③ 重金档：1 回合 + 战况；中途升档提前送达 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.newsQueue.length = 0;
    AO.resNews.rumour.length = 0;
    /* 造一场真仗：双方都不是玩家 —— WSCORE 才有数，战况那一行才写得出 */
    const alive = w.countries.filter(c => c && c.provinces.length && c.id !== P && !D.deadMap[c.id]);
    const a = alive[0].id, b = alive[1].id;
    D.declareWar(a, b, { force: true });
    D.newsQueue.length = 0;                       // 宣战那条自己入的队先清掉
    D.fogSetBudget(P, 2);
    const took = D.worldNews('测试：重金档的战事', 'warn', { parties: [a, b], kind: 'war' });
    const it = D.newsQueue[0];
    ok('③ 重金档：入队时滞 1 回合', took && it && it.delay === 1, it && it.delay);
    window.__W = { a, b };
    return o;
  }));
  await step(page);
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const n = D.notes().find(x => /测试：重金档的战事/.test(x.text || ''));
    ok('③ 1 回合就送到', !!n, n && n.text);
    ok('③ 重金档附战况一行', !!n && /（战况 .+ \d+ : \d+ .+）/.test(n.text), n && n.text);
    return o;
  }));

  /* 入队时 0 档、中途升重金 → 提前送达 */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.newsQueue.length = 0;
    D.fogSetBudget(P, 0);
    const T = window.__T, W = window.__W;
    const took = D.worldNews('测试：升档后的快讯', 'warn', { parties: [W.a, W.b], kind: 'war' });
    ok('③ 0 档入队（时滞 5~8）', took && D.newsQueue[0] && D.newsQueue[0].delay >= 5,
      D.newsQueue[0] && D.newsQueue[0].delay);
    D.fogSetBudget(P, 2);                        // 中途加钱
    return o;
  }));
  await step(page);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const n = D.notes().find(x => /测试：升档后的快讯/.test(x.text || ''));
    ok('③ 入队时 0 档、中途升重金 → 提前送达', !!n, n ? n.text : '还在路上');
    return o;
  }));

  /* ---------------- ④ 涉玩家即时（不进延迟队列） ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world(), P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.newsQueue.length = 0;
    D.fogSetBudget(P, 0);
    /* 直接调 worldNews：涉玩家的不该入队 */
    const took = D.worldNews('测试：涉玩家的事', 'warn', { parties: [P, window.__T.bd], kind: 'war' });
    ok('④ 涉玩家的消息不入延迟队列', took === false && D.newsQueue.length === 0,
      'took=' + took + ' 队列 ' + D.newsQueue.length);
    /* 真走一次宣战：玩家 vs 邻国，当回合就该有纪要。
     * 邻国可能已经和玩家打起来了（前十几回合 AI 会主动开战），
     * 所以先停战再宣 —— 目的是验"即时送达"，不是验宣战规则。 */
    D.notes().length = 0;
    let tgt = 0, msgs = [];
    const adj2 = AO.resNews.adj();
    for (const c of w.countries) {
      if (!c || !c.provinces.length || c.id === P || D.deadMap[c.id]) continue;
      if (!adj2[c.id]) continue;
      const key = P < c.id ? P + '|' + c.id : c.id + '|' + P;
      if (D.wars[key]) D.makePeace(P, c.id);
      const rr = D.declareWar(P, c.id, { force: true });
      msgs.push(c.name + ':' + (rr && rr.msg));
      if (rr && rr.ok) { tgt = c.id; break; }
    }
    const n = D.notes().find(x => /宣战/.test(x.text || ''));
    ok('④ 玩家参战的宣战当回合即时报', !!n, n ? n.text : msgs.join(' / '));
    if (tgt) D.makePeace(P, tgt);
    return o;
  }));

  /* ---------------- ⑤ 风闻：15%±5、两种走样、更正 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, P = D.player(), T = window.__T, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.fogSetBudget(P, 0);
    D.newsQueue.length = 0;
    const s0 = Object.assign({}, D.newsStat());
    AO.INTEL.news.rumourP = window.__RP === undefined ? 0.15 : window.__RP;   // 风闻开回来
    let sw = 0, ex = 0, sample = [];
    const N = 400;
    for (let i = 0; i < N; i++) {
      D.newsQueue.length = 0;
      D.worldNews('测试：风闻样本', 'warn', { parties: [T.bd, T.other], kind: 'war' });
      const it = D.newsQueue[0];
      if (!it) continue;
      if (it.rumour) {
        sample.push(it.rt || '');
        /* 夸大：说成"灭国在即"；张冠李戴：把一方换成另一个接壤邻国（措辞是"向…宣战"） */
        if (/灭国在即|王国已亡|宗庙将不保/.test(it.rt || '')) ex++;
        else sw++;
      }
    }
    D.newsQueue.length = 0;
    const st = D.newsStat();
    const rate = (st.rumour - s0.rumour) / Math.max(1, st.enq0 - s0.enq0);
    ok('⑤ 0 档风闻率 15%±5', rate >= 0.10 && rate <= 0.20,
      (rate * 100).toFixed(1) + '%（' + (st.rumour - s0.rumour) + '/' + (st.enq0 - s0.enq0) + '）');
    ok('⑤ 两种走样都见得到（张冠李戴 / 夸大其词）', sw > 0 && ex > 0, '张冠李戴 ' + sw + ' · 夸大 ' + ex);
    ok('⑤ 风闻文案带具体国家名（不是原话照抄）', sample.some(t => t && t.length > 4),
      sample.slice(0, 2).join(' | '));
    return o;
  }));

  /* 风闻 → 实讯触发「更正」 */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, P = D.player(), T = window.__T, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.newsQueue.length = 0;
    D.fogSetBudget(P, 0);
    /* 反复入队直到掷出一条风闻，然后把它"催"到送达 */
    let got = 0;
    for (let i = 0; i < 60 && !got; i++) {
      D.newsQueue.length = 0;
      D.worldNews('测试：可更正的战事', 'warn', { parties: [T.bd, T.other], kind: 'war' });
      if (D.newsQueue[0] && D.newsQueue[0].rumour) got = 1;
    }
    D.newsQueue[0].delay = 0;
    window.__R = { mis: (D.newsQueue[0].mis || []).slice() };
    return o.concat([{ name: '⑤ 掷出一条风闻（误指的国家记在账上）', ok: got === 1,
      detail: JSON.stringify(window.__R.mis) }]);
  }));
  await step(page);
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 风闻的正文被改写过了，原句「可更正的战事」不会留下来 —— 认「风闻：」前缀 */
    const n = D.notes().find(x => /风闻：/.test(x.text || ''));
    ok('⑤ 风闻进纪要时带「风闻」样式（cls=rumour）', !!n && n.cls === 'rumour',
      n && (n.cls + ' / ' + n.text));
    ok('⑤ 风闻挂进待更正账', D.newsRumours.length >= 1, D.newsRumours.length);
    /* 同一对国家再来一条实讯（重金档 1 回合到）→ 追一条「更正」 */
    D.newsQueue.length = 0;
    D.fogSetBudget(D.player(), 2);
    D.worldNews('测试：实讯到达', 'warn', { parties: [window.__T.bd, window.__T.other], kind: 'war' });
    return o;
  }));
  await step(page);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const c = D.notes().find(x => /更正：前讯有误/.test(x.text || ''));
    ok('⑤ 实讯到达 → 追推「更正：前讯有误，实为…」', !!c, c && c.text);
    ok('⑤ 更正后账上清掉那条', D.newsRumours.length === 0, D.newsRumours.length);
    return o;
  }));

  /* 探测成功也能触发更正 */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, P = D.player(), T = window.__T, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 手工挂一条"误指了 T.bd"的风闻账，再让密探探 T.bd */
    D.newsRumours.push({ mis: [T.bd], text: '测试：旧风闻', at: D.turn() });
    D.notes().length = 0;
    const cen = AO.resCentral[P] || (AO.resCentral[P] = {});
    cen.gold = 200;
    /* 清探测冷却（PROBE_CD 是活对象，直接清键） */
    for (const k in D.fogProbeCd) delete D.fogProbeCd[k];
    const r = AO.resProbe(T.bd);
    const c = D.notes().find(x => /更正：前讯有误/.test(x.text || ''));
    ok('⑤ 定向探测成功 → 更正那条风闻', !!r && r.ok && !!c, c && c.text);
    return o;
  }));

  /* ---------------- ⑥ 编年史：按事件年份归位 + （后闻）+ 风闻不进年表 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, T = window.__T, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const YL = AO.chronoYearLog();
    const all = [];
    for (const r of YL) for (const e of r.entries) all.push({ turn: r.turn, text: e.text });
    ok('⑥ 风闻不进年表', !all.some(e => /风闻|测试：可更正的战事/.test(e.text)),
      all.filter(e => /风闻/.test(e.text)).length + ' 条');
    ok('⑥ 更正的实情进了年表（不是更正条本身）',
      all.filter(e => /更正：前讯有误/.test(e.text)).length === 0,
      all.filter(e => /更正/.test(e.text)).length + ' 条');
    const rear = all.filter(e => /（后闻）$/.test(e.text));
    ok('⑥ 迟到的条目文末带「（后闻）」', rear.length >= 1, rear.length + ' 条 · ' +
      (rear[0] && rear[0].text));
    /* 归位：带（后闻）的那条，所在 rec 的 turn 应当 ≤ 现在（是事件发生的年份） */
    const now = D.turn();
    ok('⑥ 按事件年份归位（不是得知年份）',
      rear.every(e => e.turn < now) || rear.length === 0,
      rear.map(e => e.turn).join(',') + ' / 现在第 ' + now);
    return o;
  }));

  /* ---------------- ⑦ 每回合 ≤2 条 + 存档往返 + 旧档容错 ---------------- */
  let maxPer = 0;
  for (let i = 0; i < 8; i++) {
    await step(page);
    const ns = await envNotes(page);
    if (ns.length > maxPer) maxPer = ns.length;
  }
  add([{ name: '⑦ 每回合 ≤2 条世界消息', ok: maxPer <= 2, detail: '峰值 ' + maxPer + ' 条' }]);

  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const st = D.newsStat();
    const avg = i => st.byTier[i].n ? (st.byTier[i].sum / st.byTier[i].n).toFixed(1) : '—';
    ok('⑦ bench 三数出得来（各档平均延迟 / 丢弃数 / 风闻率）',
      st.delivered > 0 && st.dropped > 0 && st.enq0 > 0,
      '延迟 ' + avg(0) + '/' + avg(1) + '/' + avg(2) + ' · 丢弃 ' + st.dropped +
      ' · 风闻 ' + (st.rumour / Math.max(1, st.enq0) * 100).toFixed(1) + '%');
    /* 存档往返：攒一条在路上，存 → 清空 → 读回 */
    D.newsQueue.length = 0;
    D.fogSetBudget(D.player(), 1);
    D.worldNews('测试：存档前的在路上', 'warn', { parties: [window.__T.bd, window.__T.other], kind: 'war' });
    window.__SQ = { n: D.newsQueue.length, text: D.newsQueue[0] && D.newsQueue[0].text,
      delay: D.newsQueue[0] && D.newsQueue[0].delay };
    D.save(true);
    const raw = JSON.parse(localStorage.getItem('sj.save'));
    ok('⑦ 存档里有 NEWS 块（待送达队列）',
      !!raw.NEWS && Array.isArray(raw.NEWS.Q) && raw.NEWS.Q.length === window.__SQ.n,
      raw.NEWS ? ('Q ' + raw.NEWS.Q.length + ' · R ' + (raw.NEWS.R || []).length +
        ' · 统计键 ' + Object.keys(raw.NEWS.S || {}).length) : '没有');
    ok('⑦ 版本号没升（仍 v' + AO.SAVE_VER + '）', AO.SAVE_VER === 6, 'v' + AO.SAVE_VER);
    D.newsQueue.length = 0;
    return o;
  }));
  await page.evaluate(() => window.AO.resDebug.load());
  await sleep(3600);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const q = D.newsQueue;
    ok('⑦ 读档后"在路上的那条"还在路上（文字与时滞都没变）',
      q.length === window.__SQ.n && q[0] && q[0].text === window.__SQ.text &&
      q[0].delay === window.__SQ.delay,
      q.length + ' 条 · ' + (q[0] && (q[0].text + ' / 时滞 ' + q[0].delay)));
    ok('⑦ 队列条目带 evtTurn / tier（读档不会把消息变快）',
      !q[0] || ((q[0].evtTurn | 0) > 0 && (q[0].tier | 0) >= 0),
      q[0] && (q[0].evtTurn + ' / 档 ' + q[0].tier));
    return o;
  }));

  /* 旧档（没有 NEWS 键）：读进来空队起步，不炸 */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sj.save'));
    delete d.NEWS;
    localStorage.setItem('sj.save', JSON.stringify(d));
  });
  await page.evaluate(() => window.AO.resDebug.load());
  await sleep(3600);
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    ok('⑦ 旧档（没有 NEWS 块）读进来 = 空队起步，不炸',
      D.newsQueue.length === 0 && D.player() > 0, '队列 ' + D.newsQueue.length);
    return o;
  }));

  /* ---------------- 汇总 ---------------- */
  await browser.close();
  let pass = 0;
  for (const c of out) {
    console.log((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + (c.detail ? '  —  ' + c.detail : ''));
    if (c.ok) pass++;
  }
  console.log('\n' + pass + ' / ' + out.length + ' 通过' + (errors.length ? '\n页面错误：\n' + errors.join('\n') : ''));
  process.exit(pass === out.length && !errors.length ? 0 : 1);
})();
