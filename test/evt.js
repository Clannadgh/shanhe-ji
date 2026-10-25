/* =============================================================
 * test/evt.js —— 事件系统 + 信仰做实的验收
 *
 * 对着任务书的验收清单逐条过：
 *   1) 连跑 30 回合：事件按权重出现、开局 5 回合内无事件、同事件冷却内不重复
 *   2) 玩家事件弹窗：选项 tip 与实际数值一致（手算一例）；弹出期间下一回合禁用
 *   3) AI 国事件只进纪要、自动选结果；贪墨案发只在有贪墨官时触发；
 *      将领叛乱真把军变成叛军并进攻旧主
 *   4) 国教 = 占比最大信仰；异信仰省幸福度悬停能看到 faith driver 及数值
 *   5) 政策切宽容：driver 变 −2、传教钮消失；切回强制恢复
 *   6) 传教全流程：扣金 → 倒计时 → 换信仰 → 省卡信仰行与信仰视图同步；被占领作废
 *   7) 存档 v4 往返含事件状态 / 政策 / 传教中；读 v3 补默认不炸
 *
 * 用法：node test/evt.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const shot = (n) => path.join(root, 'shots', n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1.4 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2800);

  const checks = [];
  const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

  /* 页面里放一个"找一个异信仰省"的小工具：后面 4~7 都要用，
   * 而"玩家国刚好有异信仰省"这件事不能靠运气（小国可能全国同教）。 */
  await page.evaluate(() => {
    /* 给了 cid 就**只**在那一个国家里找（找不到返回 null，由调用方决定换国）；
     * 不给 cid 就全世界扫一遍。两种语义分开，免得"以为在找玩家的省、其实找了别国"。 */
    window.__pickHetero = function (cid) {
      const AO = window.AO, w = window.__world;
      const scan = function (c) {
        const sf = AO.stateFaithOf(c.id);
        for (const q of c.provinces) {
          const p = w.provinces[q - 1];
          if (p && typeof p.faithIdx === 'number' && p.faithIdx >= 0 && p.faithIdx !== sf) {
            return { cid: c.id, pid: p.id, name: p.name };
          }
        }
        return null;
      };
      if (cid) {
        const c = w.countries[cid - 1];
        return c ? scan(c) : null;
      }
      for (const c of w.countries) {
        const hit = scan(c);
        if (hit) return hit;
      }
      return null;
    };
  });

  /* =========================================================
   * 1) 30 回合：开局静默 / 冷却 / 权重
   * ========================================================= */
  const r1 = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO;
    const fires = [];
    const startTurn = D.turn();
    for (let i = 0; i < 30; i++) {
      D.settleTurn();
      const pend = D.evtPending();
      if (pend) D.evtPick(0);
      const t = D.turn();
      /* 这一回合新写进事件史的那几条（一次最多一条） */
      const now = AO.resEvtLog().filter(x => x.turn === t);
      for (const e of now) fires.push({ turn: t, key: e.key });
    }
    const cd = Object.assign({}, AO.EVT_BY_KEY);
    const gapBad = [];
    const seen = {};
    for (const f of fires) {
      if (seen[f.key] !== undefined) {
        const ev = cd[f.key];
        const need = ev ? (ev.cd || AO.EVT.cdDefault) : AO.EVT.cdDefault;
        if (f.turn - seen[f.key] < need) gapBad.push(f.key + ':' + seen[f.key] + '→' + f.turn);
      }
      seen[f.key] = f.turn;
    }
    return {
      startTurn, endTurn: D.turn(), n: fires.length, fires,
      keys: Array.from(new Set(fires.map(f => f.key))),
      gapBad,
      early: fires.filter(f => f.turn <= AO.EVT.startTurn),
      /* 权重抽样：抽 4000 次看分布是不是"重的更多" */
      pool: AO.EVENTS.map(e => ({ key: e.key, w: e.w }))
    };
  });
  ck('1.1 开局前 5 回合无事件', r1.early.length === 0, '最早第 ' + (r1.fires[0] ? r1.fires[0].turn : '—') + ' 回合');
  ck('1.2 30 回合里事件数量合理（3~25 件）', r1.n >= 3 && r1.n <= 25, r1.n + ' 件');
  ck('1.3 同事件在冷却内不重复', r1.gapBad.length === 0, r1.gapBad.join(' / ') || '无违例');
  ck('1.4 事件种类 ≥ 3（不是一直同一件）', r1.keys.length >= 3, r1.keys.join(','));
  console.log('   · 30 回合事件序列：' + r1.fires.map(f => 'T' + f.turn + ' ' + f.key).join(' | '));

  /* =========================================================
   * 2) 玩家弹窗：tip 与数值一致 / 回合按钮禁用
   * ========================================================= */
  const r2 = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    /* 找一个人口够、有耕地的省，把玩家设成它的国 */
    let target = null;
    for (const p of w.provinces) {
      if (!p || !p.owner) continue;
      if (p.population < 30000) continue;
      if (!p.resources.some(r => r.key === 'grain')) continue;
      target = p; break;
    }
    if (!target) return { err: '没有合适的省' };
    D.choosePlayer(target.owner);
    /* 先把这一省的粮清成一个整数，手算才干净 */
    AO.resSim[target.id].grain.stock = 100;
    const before = AO.resSim[target.id].grain.stock;
    D.evtForceModal('bumper', target.id);
    const open = D.evtOpen();
    const card = document.querySelector('#evOpts .evopt');
    const tip = card ? card.querySelector('em').textContent : '';
    const title = document.getElementById('evTitle').textContent;
    const where = document.getElementById('evWhere').textContent;
    const nextDisabled = document.getElementById('nextTurn').disabled;
    const turnBefore = D.turn();
    /* 弹出期间点「下一回合」：不该动 */
    document.getElementById('nextTurn').click();
    const turnAfterClick = D.turn();
    /* 选「尽数入仓」= 粮食 +30 */
    card.click();
    const after = AO.resSim[target.id].grain.stock;
    return {
      open, tip, title, where, nextDisabled, turnBefore, turnAfterClick,
      delta: after - before, stillOpen: D.evtOpen(),
      unlocked: !document.getElementById('nextTurn').disabled,
      topLog: (D.log()[0] || {}).text || ''
    };
  });
  ck('2.1 玩家国事件弹出居中小卡', r2.open === true, '《' + r2.title + '》' + r2.where);
  ck('2.2 选项 tip 与 fx 一致（粮食 +30）', /粮食 \+30/.test(r2.tip), 'tip = 「' + r2.tip + '」');
  ck('2.3 手算一例：库存 100 → 130', r2.delta === 30, '100 → ' + (100 + r2.delta));
  ck('2.4 弹出期间「下一回合」禁用且点不动', r2.nextDisabled === true && r2.turnAfterClick === r2.turnBefore,
    '禁用=' + r2.nextDisabled + ' 回合 ' + r2.turnBefore + '→' + r2.turnAfterClick);
  ck('2.5 选完关闭并放行', r2.stillOpen === false && r2.unlocked === true);
  ck('2.6 结果进世界纪要（战报同款）', /⚑/.test(r2.topLog), r2.topLog);

  /* 弹窗截图：重新开一件（三选项的继承危机，看满排版），拍完再选掉 */
  await page.evaluate(() => {
    const D = window.AO.resDebug, w = window.__world;
    D.evtForceModal('heir', w.countries[D.player() - 1].provinces[0]);
  });
  await sleep(320);
  await page.screenshot({ path: shot('evt-modal.png') });
  await page.evaluate(() => { window.AO.resDebug.evtPick(0); });
  await sleep(200);

  /* =========================================================
   * 3) AI 事件只进纪要 / 贪墨门控 / 将领叛乱
   * ========================================================= */
  const r3 = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    const player = D.player();
    /* 找一个别国的省 */
    let ai = null;
    for (const p of w.provinces) {
      if (p && p.owner && p.owner !== player) { ai = p; break; }
    }
    D.evtForce('plague', ai.id);
    const aiModal = D.evtOpen();
    const aiLog = (D.log()[0] || {}).text || '';

    /* 贪墨案发：没有贪墨官的省不该能出 */
    let plain = null, greedyPid = 0;
    for (const p of w.provinces) {
      if (p && p.owner === player && !window.AO.resOfficial[p.id]) { plain = p; break; }
    }
    const beforeGate = D.evtCan('graft', plain.id);
    /* 给这一省塞一位贪墨官（直接写表，走的是同一份 OFFICIAL） */
    AO.resOfficial[plain.id] = { id: 9999, name: '王守仁', traitKey: 'greedy', owed: 0 };
    const afterGate = D.evtCan('graft', plain.id);
    const otherGate = (function () {
      let q = null;
      for (const p of w.provinces) if (p && p.owner === player && p.id !== plain.id) { q = p; break; }
      return q ? D.evtCan('graft', q.id) : null;
    })();
    delete AO.resOfficial[plain.id];

    /* 将领叛乱：2 军 + 带兵将领 + 国民幸福度 < 40 */
    const c = w.countries[player - 1];
    for (const pid of c.provinces) {
      const h = AO.resHappy[pid];
      if (h) { h.v = 28; h.target = 28; }
    }
    AO.resTalent[player] = AO.resTalent[player] || { pts: 0, pool: [] };
    AO.resTalent[player].pts = 200;
    const cap = c.provinces[0];
    const a1 = D.newArmy(player, cap, { men: 4000 });
    const a2 = D.newArmy(player, cap, { men: 4000 });
    const ex = D.examGeneral(player);
    if (ex && ex.ok) D.assignGeneral(a1.id, ex.gen.id);
    const canMutiny = D.evtCan('mutiny', cap);
    D.evtForceModal('mutiny', cap);
    const mutinyModal = D.evtOpen();
    /* 第三个选项 = 置之不理 → 该将带军自立 */
    const btns = document.querySelectorAll('#evOpts .evopt');
    const third = btns[2];
    const thirdTip = third ? third.querySelector('em').textContent : '';
    if (third) third.click();
    const rebel = Object.keys(D.army).map(Number).filter(id => D.army[id].rebel)
      .map(id => D.army[id]);
    const rb = rebel[0] || null;
    /* 打两回合，看叛军有没有真的动/打起来 */
    const logBefore = D.log().length;
    for (let i = 0; i < 2; i++) {
      D.settleTurn();
      const pend = D.evtPending();
      if (pend) D.evtPick(0);
    }
    const newLog = D.log().slice(0, Math.max(0, D.log().length - logBefore)).map(x => x.text);
    const rb2 = rb ? D.army[rb.id] : null;
    return {
      aiModal, aiLog,
      beforeGate, afterGate, otherGate,
      canMutiny, mutinyModal, thirdTip,
      rebel: rb ? { owner: rb.owner, rebel: rb.rebel, order: rb.order, pid: rb.pid } : null,
      rebelAfter: rb2 ? { pid: rb2.pid, men: rb2.men, order: rb2.order } : null,
      fight: newLog.filter(t => /⚔|叛军|溃散/.test(t)).slice(0, 3),
      player
    };
  });
  ck('3.1 AI 国事件不弹窗、只进纪要', r3.aiModal === false && /⚑/.test(r3.aiLog), r3.aiLog);
  ck('3.2 贪墨案发：无贪墨官时不可触发', r3.beforeGate === false);
  ck('3.3 贪墨案发：有贪墨官时可触发', r3.afterGate === true);
  ck('3.4 贪墨案发只认"这一省"的官', r3.otherGate === false);
  ck('3.5 将领叛乱的前置（幸福度<40 且军≥2 且有将）', r3.canMutiny === true);
  ck('3.6 「置之不理」把军变成叛军（owner 取负号、反攻旧主）',
    !!r3.rebel && r3.rebel.owner === -r3.player && r3.rebel.rebel === r3.player &&
    r3.rebel.order && r3.rebel.order.type === 'attack' && r3.rebel.order.cid === r3.player,
    r3.rebel ? ('owner=' + r3.rebel.owner + ' 命令=' + r3.rebel.order.type + '→#' + r3.rebel.order.pid) : '没有叛军');
  const rebelMoved = !!(r3.rebelAfter && r3.rebel && r3.rebelAfter.pid !== r3.rebel.pid);
  const rebelFought = r3.fight.some(t => /⚔/.test(t));
  ck('3.7 叛军真的进攻旧主（会战 / 换省 / 战至溃散）', rebelFought || rebelMoved,
    (rebelFought ? '打起来了：' : '') + (r3.fight[0] || '') +
    (r3.rebelAfter ? (' 驻 ' + r3.rebel.pid + '→' + r3.rebelAfter.pid) : '（叛军已溃散）'));

  /* =========================================================
   * 4) 国教 = 占比最大信仰；faith driver 出现在悬停明细里
   * ========================================================= */
  const r4 = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    let bad = 0, n = 0;
    for (const c of w.countries) {
      const by = {};
      for (const pid of c.provinces) {
        const p = w.provinces[pid - 1];
        const fi = p.faithIdx;
        if (typeof fi !== 'number' || fi < 0) continue;
        by[fi] = (by[fi] || 0) + (p.area || 1);
      }
      let best = -1, ba = -1;
      for (const k in by) if (by[k] > ba) { ba = by[k]; best = +k; }
      n++;
      if (AO.stateFaithOf(c.id) !== best) bad++;
    }
    /* 找一个异信仰省：看悬停明细里有没有 faith driver */
    let h = window.__pickHetero(D.player());
    if (!h) { h = window.__pickHetero(0); if (h) D.choosePlayer(h.cid); }
    if (!h) return { n, bad, hetero: null };
    const player = D.player();
    const hetero = w.provinces[h.pid - 1];
    D.faithPol(D.player(), 'force');          // 默认档：异信仰 −6
    D.settleHappy(hetero.id);
    const drv = (AO.resHappy[hetero.id].drivers || {});
    const title = AO.resHappyTitle(hetero.id);
    return {
      n, bad,
      hetero: hetero.name,
      faith: AO.faithName(hetero.faithIdx),
      stateFaith: AO.faithName(AO.stateFaithOf(player)),
      driver: drv.faith,
      hasLine: /异信仰（/.test(title),
      line: (title.split('\n').find(l => /异信仰|信仰 /.test(l)) || '')
    };
  });
  ck('4.1 64 国的国教都 = 省份信仰面积占比最大者', r4.bad === 0, r4.n + ' 国全部一致');
  ck('4.2 异信仰省 drivers.faith = −6（强制档）', r4.driver === -6,
    r4.hetero ? (r4.hetero + ' 信 ' + r4.faith + '，国教 ' + r4.stateFaith) : '本国无异信仰省');
  ck('4.3 悬停明细逐项显示「异信仰（…）−6」', r4.hasLine, r4.line);

  /* =========================================================
   * 5) 政策切宽容：driver −2、传教钮消失；切回强制恢复
   * ========================================================= */
  const r5 = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    let h = window.__pickHetero(D.player());
    if (!h) { h = window.__pickHetero(0); if (h) D.choosePlayer(h.cid); }
    if (!h) return { err: '全世界都没有异信仰省' };
    const player = D.player();
    const pid = h.pid;
    /* 给这一省备足省库金，传教钮才可用 */
    AO.resSim[pid].gold.stock = 200;
    const dForce = D.faithDriver(pid, player);
    D.faithPol(player, 'force');
    /* 打开治理面板看按钮 */
    document.getElementById('govBtn').click();
    const btnForce = document.querySelector('#gpTable button.pmiss[data-pid="' + pid + '"]');
    const forceState = { exists: !!btnForce, disabled: btnForce ? btnForce.disabled : null };
    const polOn = document.querySelector('#gpFaithPol button.on');
    const polForceTxt = polOn ? polOn.textContent : '';

    D.faithPol(player, 'tolerant');
    if (window.AO.govOpen()) document.getElementById('govBtn').click();
    document.getElementById('govBtn').click();
    const dTol = D.faithDriver(pid, player);
    const canMis = D.canMission(pid);
    const btnTol = document.querySelector('#gpTable button.pmiss[data-pid="' + pid + '"]');
    const tolState = { exists: !!btnTol, disabled: btnTol ? btnTol.disabled : null };

    D.faithPol(player, 'force');
    const dBack = D.faithDriver(pid, player);
    const canBack = D.canMission(pid);
    /* 面板上再点一次「宽容」按钮，走的是真事件链 */
    const tolBtn = document.querySelector('#gpFaithPol button[data-pol="tolerant"]');
    if (tolBtn) tolBtn.click();
    const afterClick = D.faithPol(player);
    const forceBtn = document.querySelector('#gpFaithPol button[data-pol="force"]');
    if (forceBtn) forceBtn.click();
    const backClick = D.faithPol(player);
    if (window.AO.govOpen()) document.getElementById('govBtn').click();
    return {
      pid, dForce, dTol, dBack, canMis, canBack,
      forceState, tolState, polForceTxt, afterClick, backClick,
      diag: { open: window.AO.govOpen(), tab: (document.querySelector("#gpTabs button.on")||{}).textContent, rows: document.querySelectorAll("#gpTable .prow").length, pmiss: document.querySelectorAll("#gpTable button.pmiss").length, inTable: !!document.querySelector("#gpTable .prow[data-pid=\"" + pid + "\"]") }
    };
  });
  ck('5.1 强制档 driver = −6', r5.dForce === -6, '省 #' + r5.pid);
  ck('5.2 切宽容后 driver = −2', r5.dTol === -2);
  ck('5.3 宽容档传教不可用（钮置灰）', r5.canMis === false && r5.tolState.disabled === true,
    JSON.stringify(r5.diag) + ' | 按钮存在=' + r5.tolState.exists + ' 置灰=' + r5.tolState.disabled);
  ck('5.4 切回强制：driver 恢复 −6、传教可用', r5.dBack === -6 && r5.canBack === true);
  ck('5.5 面板 segmented 真能切（宽容↔强制）', r5.afterClick === 'tolerant' && r5.backClick === 'force');

  /* =========================================================
   * 6) 传教全流程：扣金 → 倒计时 → 改宗 → 被占领作废
   * ========================================================= */
  const r6 = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    let h = window.__pickHetero(D.player());
    if (!h) { h = window.__pickHetero(0); if (h) D.choosePlayer(h.cid); }
    if (!h) return { err: '全世界都没有异信仰省' };
    const player = D.player();
    D.faithPol(player, 'force');
    const pid = h.pid;
    AO.resSim[pid].gold.stock = 120;
    const gold0 = AO.resSim[pid].gold.stock;
    const r = D.startMission(pid);
    const gold1 = AO.resSim[pid].gold.stock;
    const rmsg = r && r.msg;
    /* missionOf 返回的是 MISSION 里的**活对象**（倒计时会就地减），
     * 所以这里必须拍快照，否则"开工时的 left"会被后面的回合改成 0 */
    const m0 = D.missionOf(pid) ? Object.assign({}, D.missionOf(pid)) : null;
    /* 选中这一省，看省卡的信仰行 */
    window.__renderer.select(pid);
    const rowMid = D.faithRow(pid);
    const lefts = [m0 ? m0.left : -1];
    for (let i = 0; i < 3; i++) {
      D.settleTurn();
      const pend = D.evtPending();
      if (pend) D.evtPick(0);
      const m = D.missionOf(pid);
      lefts.push(m ? m.left : 0);
    }
    const p = w.provinces[pid - 1];
    window.__renderer.select(pid);          // 重画省卡（settleTurn 不刷 UI）
    const rowEnd = D.faithRow(pid);
    /* 找整条纪要里的改宗那一条 —— 这 3 回合里可能还夹着别的事件，
     * 不能只看 log[0]（那是最近一条，不一定是改宗） */
    const logTop = (D.log().find(x => /✝/.test(x.text)) || {}).text || '';

    /* 被占领作废：另找一省开传教，然后把 owner 改掉 */
    let pid2 = 0;
    for (const q of w.countries[player - 1].provinces) {
      const qq = w.provinces[q - 1];
      if (qq && qq.faithIdx !== AO.stateFaithOf(player) && qq.id !== pid) { pid2 = qq.id; break; }
    }
    let voidOk = null, voidMsg = '';
    if (pid2) {
      AO.resSim[pid2].gold.stock = 120;
      D.startMission(pid2);
      const had = !!D.missionOf(pid2);
      w.provinces[pid2 - 1].owner = player === 1 ? 2 : 1;
      D.settleTurn();
      const pend2 = D.evtPending();
      if (pend2) D.evtPick(0);
      voidOk = had && !D.missionOf(pid2);
      voidMsg = (D.log().find(x => /易主，传教作废/.test(x.text)) || {}).text || '';
      w.provinces[pid2 - 1].owner = player;      // 还回去
    }
    return {
      pid, gold0, gold1, rmsg, m0, lefts, owner: p.owner, player, faithIdx: p.faithIdx,
      stateFaith: AO.stateFaithOf(player), rowMid, rowEnd, logTop,
      name: p.name, voidOk, voidMsg,
      /* 信仰视图上的转教标记：AO.resMission 有值就说明渲染器会画十字 */
      marks: Object.keys(AO.resMission).length
    };
  });
  ck('6.1 传教扣省库金 20', r6.gold0 - r6.gold1 === 20, r6.gold0 + ' → ' + r6.gold1 + ' / ' + r6.rmsg + ' / owner=' + r6.owner + ' player=' + r6.player);
  ck('6.2 开工即 3 回合倒计时', r6.m0 && r6.m0.left === 3, 'left=' + (r6.m0 ? r6.m0.left : '—'));
  ck('6.3 倒计时逐回合递减 3→2→1→0', JSON.stringify(r6.lefts) === '[3,2,1,0]', JSON.stringify(r6.lefts));
  ck('6.4 到点改宗国教', r6.faithIdx === r6.stateFaith,
    r6.name + ' 信仰 ' + r6.faithIdx + ' / 国教 ' + r6.stateFaith);
  ck('6.5 省卡信仰行同步（开工显示倒计时 → 结束显示国教角标）',
    /传教 3/.test(r6.rowMid) && /国教/.test(r6.rowEnd), '中途「' + r6.rowMid + '」→ 结束「' + r6.rowEnd + '」');
  ck('6.6 改宗进世界纪要', /✝/.test(r6.logTop), r6.logTop);
  ck('6.7 传教中的省被占领 → 作废', r6.voidOk === true, r6.voidMsg);

  /* =========================================================
   * 7) 存档 v4 往返 / 读 v3 补默认
   * ========================================================= */
  const r7a = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    let h = window.__pickHetero(D.player());
    if (!h) { h = window.__pickHetero(0); if (h) D.choosePlayer(h.cid); }
    const player = D.player();
    /* 宽容档**禁止**传教（B3），所以存档测试用强制档：两者互斥，
     * 「切宽容会清掉进行中的传教」本身就是设计的一部分（见 16-events setFaithPol） */
    D.faithPol(player, 'force');
    const pid = h ? h.pid : 0;
    if (pid) { AO.resSim[pid].gold.stock = 120; D.startMission(pid); }
    D.evtForce('bumper', w.countries[player - 1].provinces[0]);
    window.AO.resSave();
    const raw = localStorage.getItem('sj.save');
    const d = JSON.parse(raw);
    return {
      ver: d.v, hasEvt: !!d.EVT,
      pol: d.EVT && d.EVT.FAITHPOL ? d.EVT.FAITHPOL[player] : null,
      mission: d.EVT ? Object.keys(d.EVT.MISSION || {}).length : -1,
      cd: d.EVT ? Object.keys(d.EVT.ECD || {}).length : -1,
      stateFaith: d.EVT ? Object.keys(d.EVT.STATEFAITH || {}).length : -1,
      pid, size: raw.length
    };
  });
  ck('7.1 存档版本 ≥ v4（事件块从 v4 起）', r7a.ver >= 4, 'v' + r7a.ver + ' · ' + Math.round(r7a.size / 1024) + ' KB');
  ck('7.2 存档里带事件冷却表 / 政策 / 传教中 / 国教',
    r7a.hasEvt && r7a.cd > 0 && r7a.pol === 'force' && r7a.mission >= 1 && r7a.stateFaith > 0,
    'cd=' + r7a.cd + ' 政策=' + r7a.pol + ' 传教中=' + r7a.mission + ' 国教表=' + r7a.stateFaith);

  /* 读回来：先改成强制 + 清掉传教，再读档，看有没有恢复 */
  await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO;
    D.faithPol(D.player(), 'tolerant');
    for (const k in AO.resMission) delete AO.resMission[k];
  });
  await page.evaluate(() => { window.AO.resLoad(); });
  await sleep(4200);
  const r7b = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, player = D.player();
    return {
      turn: D.turn(),
      pol: AO.faithPolOf(player),
      mission: Object.keys(AO.resMission).length,
      stateFaith: Object.keys(AO.resStateFaith).length,
      modal: D.evtOpen()
    };
  });
  ck('7.3 读档恢复政策 / 传教中 / 国教表',
    r7b.pol === 'force' && r7b.mission === r7a.mission && r7b.stateFaith > 0,
    '政策=' + r7b.pol + ' 传教中=' + r7b.mission + ' 国教表=' + r7b.stateFaith);

  /* 读 v3：把 EVT 整块删掉、版本写回 3 */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sj.save'));
    d.v = 3;
    delete d.EVT;
    localStorage.setItem('sj.save', JSON.stringify(d));
  });
  await page.evaluate(() => { window.AO.resLoad(); });
  await sleep(4200);
  const r7c = await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, player = D.player();
    let runOk = true;
    try { D.settleTurn(); } catch (e) { runOk = false; }
    const pend = D.evtPending();
    if (pend) D.evtPick(0);
    return {
      pol: AO.faithPolOf(player), mission: Object.keys(AO.resMission).length,
      runOk, turn: D.turn(), stateFaith: AO.stateFaithOf(player)
    };
  });
  ck('7.4 读 v3 旧档不炸：政策补默认「强制」、传教表清空', r7c.pol === 'force' && r7c.mission === 0,
    '政策=' + r7c.pol + ' 传教中=' + r7c.mission);
  ck('7.5 读 v3 后还能正常结算回合', r7c.runOk === true && r7c.turn > 1,
    '第 ' + r7c.turn + ' 回合 · 国教=' + r7c.stateFaith);

  /* 面板截图（治理页的信仰政策 + 传教钮） */
  await page.evaluate(() => {
    const D = window.AO.resDebug, AO = window.AO, w = window.__world;
    let h = window.__pickHetero(D.player());
    if (!h) { h = window.__pickHetero(0); if (h) D.choosePlayer(h.cid); }
    D.faithPol(D.player(), 'force');
    if (h) {
      const p = w.provinces[h.pid - 1];
      AO.resSim[p.id].gold.stock = 120;
      D.startMission(p.id);                 // 开一个传教，截图里能看到倒计时
      window.__renderer.select(p.id);
      window.__renderer.cam.x = p.centroid[0];
      window.__renderer.cam.y = p.centroid[1];
      window.__renderer.cam.scale = 2.2;
      window.__renderer.clampCam();
      window.__renderer.draw();
    }
    document.getElementById('govBtn').click();
  });
  await sleep(600);
  await page.screenshot({ path: shot('evt-gov-faith.png') });
  await page.evaluate(() => {
    if (window.AO.govOpen()) document.getElementById('govBtn').click();
    /* 面板默认是收起的：不收起来截图只能拍到地图 */
    if (document.body.classList.contains('panel-collapsed')) {
      const po = document.getElementById('panelOpen');
      if (po) po.click();
    }
    /* 省份卡默认只露「信息 / 建筑」两个入口，先点开信息页 */
    const it = document.querySelector('#infoTabs .itab[data-tab="info"]');
    if (it) it.click();
  });
  await sleep(500);
  const cardEl = await page.$('#info');
  if (cardEl) await cardEl.screenshot({ path: shot('evt-faith-card.png') });
  else await page.screenshot({ path: shot('evt-faith-card.png') });

  /* ---------------- 汇总 ---------------- */
  const pass = checks.filter(c => c[1]).length;
  for (const [name, ok, note] of checks) {
    console.log((ok ? '  PASS  ' : '> FAIL <') + '  ' + name + (note ? '  —  ' + note : ''));
  }
  console.log('\n合计 ' + pass + ' / ' + checks.length + (errors.length ? '\n页面错误：\n' + errors.slice(0, 6).join('\n') : '\n页面无 JS 报错'));
  await browser.close();
  process.exit(pass === checks.length && !errors.length ? 0 : 1);
})();
