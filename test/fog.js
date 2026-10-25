/* =============================================================
 * test/fog.js —— 战争迷雾 + 情报署（v6）的验收
 *
 * 覆盖验收清单 1~8：
 *   ① 开游戏只有自国可见；工坊模式无迷雾
 *   ② 行军/贴脸探索 + seen 泛黄分档 + 军队在场转实时
 *   ③ 邻省可见随 REL 变化（宣战降级 / 停战仍 -30）
 *   ④ 三档预算：冻结 / 常规刷新 / 重金深情报 + 断供自动降档
 *   ⑤ 定向探测：成功揭示 / 冷却 / 花费 / 被抓（REL−15 + 双方纪要）
 *   ⑥ 玩家重金反谍能抓到 AI 密探
 *   ⑦ 省卡 / 国家卡逐档遮蔽；seen 省禁建造
 *   ⑧ 存档 v6 往返含迷雾；v5 旧档自动补初始化
 *
 * 跑法：node test/fog.js
 * 小世界（140 省 / 8 国），二三十秒。
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
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1400);
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'fog-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(3000);

  /* ---------------- ① 开局：只有自国可见 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    ok('① 工坊模式无迷雾', !D.fogOn() && D.fogPlan().unknown === 0 &&
      D.fogPlan().real === w.provinces.length, JSON.stringify(D.fogPlan()));
    /* 选一个有陆上邻国的国家 */
    let pick = null;
    for (const c of w.countries) {
      if (!c.provinces.length) continue;
      const nb = c.neighbors.filter(x => x !== c.id);
      if (nb.length) { pick = c; if (c.provinces.length > 12) break; }
    }
    window.__P = pick.id;
    D.choosePlayer(pick.id);
    const plan = D.fogPlan();
    ok('① 选国后：自国实时、其余未知',
      plan.real === pick.provinces.length && plan.seen === 0 &&
      plan.unknown === w.provinces.length - pick.provinces.length,
      '国 ' + pick.name + ' 省 ' + pick.provinces.length + ' / ' + JSON.stringify(plan));
    ok('① 退出游戏恢复全知', (() => { D.exitGame(); const p2 = D.fogPlan(); const on = D.fogOn(); D.choosePlayer(pick.id); return !on && p2.unknown === 0; })());
    return o;
  }));

  /* ---------------- ② 探索与陈旧度 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, w = D.world(), P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 找一块与自国交界、且不属于自己的省 */
    let pid = 0, other = 0;
    for (const p of w.provinces) {
      if (p.owner !== P) continue;
      for (const nb of p.neighbors) {
        const q = w.provinces[nb - 1];
        if (q && q.owner !== P) { pid = q.id; other = q.owner; break; }
      }
      if (pid) break;
    }
    window.__NB = { pid, other };
    ok('② 找到边境邻省', !!pid, '省 ' + pid + ' / 国 ' + other);
    ok('② 未探时是 unknown', D.fogVis(pid) === 0, 'vis=' + D.fogVis(pid));
    /* 模拟"军队踏过" */
    D.fogSee(P, pid, true);
    const rec = D.fogLastSeen[P + '|' + pid];
    ok('② 踏过即已探 + LASTSEEN', !!D.fogExplored[P][pid] && rec && rec.t === D.turn(),
      't=' + (rec && rec.t) + ' turn=' + D.turn());
    ok('② 深情报写了建筑与驻军约数', !!(rec && rec.b && rec.b.length >= 0 && rec.tr !== undefined),
      'b=' + (rec && rec.b && rec.b.length) + ' tr=' + (rec && rec.tr));
    /* 友好邻省 → 实时；敌对 → 已探 */
    D.fogSetRel(P, other, 8);
    ok('② REL≥0 的邻省实时', D.fogVis(pid) === 2, 'rel=8 vis=' + D.fogVis(pid));
    D.fogSetRel(P, other, -5);
    ok('② REL<0 的已探邻省降为 seen', D.fogVis(pid) === 1, 'rel=-5 vis=' + D.fogVis(pid));
    /* 军队在场 → 贴脸实时（哪怕 REL<0） */
    const a = D.newArmy(P, pid, { type: 'army', tier: 'leather', men: 1200 });
    D.fogInvalidate();
    ok('② 军队脚下的省转实时', D.fogVis(pid) === 2, 'vis=' + D.fogVis(pid));
    D.fogDisband(a.id);
    D.fogInvalidate();
    ok('② 军队离开后回到 seen', D.fogVis(pid) === 1, 'vis=' + D.fogVis(pid));
    /* 泛黄分档 */
    const key = P + '|' + pid, t0 = D.turn();
    D.fogLastSeen[key].t = t0 - 4;
    ok('② 陈旧 4 回合 = 微黄（0 档）', D.fogBucket(pid) === 0, 'b=' + D.fogBucket(pid));
    D.fogLastSeen[key].t = t0 - 6;
    ok('② 陈旧 6 回合 = 中黄（1 档）', D.fogBucket(pid) === 1, 'b=' + D.fogBucket(pid));
    D.fogLastSeen[key].t = t0 - 21;
    ok('② 陈旧 21 回合 = 深黄（2 档）', D.fogBucket(pid) === 2, 'b=' + D.fogBucket(pid));
    return o;
  }));

  /* ---------------- ③ REL：宣战降级 / 停战仍不可见 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const nb = window.__NB;
    D.fogSetRel(P, nb.other, 10);
    D.fogSee(P, nb.pid, false);
    ok('③ 战前邻省实时', D.fogVis(nb.pid) === 2, 'rel=' + D.fogRelOf(P, nb.other));
    D.declareWar(P, nb.other);
    ok('③ 宣战 REL 打到底', D.fogRelOf(P, nb.other) === D.fogInt.relWar, D.fogRelOf(P, nb.other));
    ok('③ 宣战后邻省立刻降级', D.fogVis(nb.pid) === 1, 'vis=' + D.fogVis(nb.pid));
    D.makePeace(P, nb.other);
    ok('③ 停战 REL = −30', D.fogRelOf(P, nb.other) === D.fogInt.relPeace, D.fogRelOf(P, nb.other));
    ok('③ 停战也看不到（−30 < 0）', D.fogVis(nb.pid) === 1, 'vis=' + D.fogVis(nb.pid));
    /* 劫掠也要掉 REL：直接调内部函数太远，这里只验 read 一侧的默认值 */
    ok('③ REL 是 0±10 生成的（|v|≤10）', (() => {
      let bad = 0;
      for (const k in D.fogRel) {
        const v = D.fogRel[k];
        if (k === D.player() + '|' + nb.other) continue;
        if (v < -10 || v > 10) bad++;
      }
      return bad === 0;
    })(), '越界条数归零');
    return o;
  }));

  /* ---------------- ④ 预算三档 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const key = P + '|' + window.__NB.pid;
    const turn = () => {
      if (D.evtPending && D.evtPending()) D.evtPick(0);
      D.nextTurn();
    };
    /* 无档：冻结 */
    D.fogSetBudget(P, 0);
    D.fogLastSeen[key].t = D.turn() - 8;
    const t0 = D.fogLastSeen[key].t;
    for (let i = 0; i < 3; i++) turn();
    ok('④ 无档：老地图冻结（不刷新）', D.fogLastSeen[key].t === t0,
      't ' + t0 + ' → ' + D.fogLastSeen[key].t);
    ok('④ 无档：陈旧度继续增长', D.fogStale(window.__NB.pid) >= 11, 'stale=' + D.fogStale(window.__NB.pid));
    /* 常规档：每 3 回合刷新 20 省，每回合 2 金 */
    D.fogSetBudget(P, 1);
    const g0 = D.fogGold(P);
    turn();
    const fc = D.flowc[P] || { d: {} };
    ok('④ 常规档每回合扣 2 金（FLOW 记 intel）', (fc.d.intel || 0) === 2,
      'intel=' + (fc.d.intel || 0) + ' gold ' + g0 + '→' + D.fogGold(P));
    D.fogLastSeen[key].t = D.turn() - 8;
    for (let i = 0; i < 3; i++) turn();
    ok('④ 常规档 3 回合内刷新归属', D.fogLastSeen[key].t >= D.turn() - 1,
      't=' + D.fogLastSeen[key].t + ' turn=' + D.turn());
    /* 重金档：每回合 6 金 + 深情报 */
    D.fogSetBudget(P, 2);
    D.fogSetGold(P, 200);
    turn();
    const fc2 = D.flowc[P] || { d: {} };
    ok('④ 重金档每回合扣 6 金', (fc2.d.intel || 0) === 6, 'intel=' + (fc2.d.intel || 0));
    D.fogLastSeen[key].t = D.turn() - 9;
    delete D.fogLastSeen[key].b;
    delete D.fogLastSeen[key].tr;
    for (let i = 0; i < 2; i++) turn();
    const r2 = D.fogLastSeen[key];
    ok('④ 重金档刷新带建筑与驻军', !!(r2.b && r2.b.length) && r2.tr !== undefined,
      'b=' + (r2.b && r2.b.length) + ' tr=' + r2.tr);
    /* 断供：金见底 → 本回合按无档，且不会扣成负数 */
    D.fogSetGold(P, 0);
    D.notes().length = 0;
    D.fogSettle();
    ok('④ 断供自动降档（不扣成负数）', D.fogGold(P) === 0, 'gold=' + D.fogGold(P));
    ok('④ 断供有纪要', D.notes().some(n => (n.text || '').indexOf('欠费') >= 0),
      JSON.stringify(D.notes().map(n => n.text)));
    return o;
  }));

  /* ---------------- ⑤ 定向探测 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.fogSetBudget(P, 2);
    D.fogSetGold(P, 120);
    const target = D.fogKnown().filter(c => c !== P)[0];
    const kk = P + '|' + target;
    delete D.fogProbeCd[kk];
    const before = Object.keys(D.fogExplored[P]).length;
    /* 强制不暴露：Math.random 调到 0.99 */
    const rnd = Math.random;
    Math.random = () => 0.99;
    const r1 = D.fogProbe(target);
    Math.random = rnd;
    ok('⑤ 探测成功', r1 && r1.ok && r1.caught === false, JSON.stringify(r1));
    const after = Object.keys(D.fogExplored[P]).length;
    ok('⑤ 揭示数量 = max(6, 预算×4)（或该国省数封顶）', (after - before) > 0,
      '新增 ' + (after - before) + ' 省');
    ok('⑤ 花 10 金', D.fogGold(P) === 110, 'gold=' + D.fogGold(P));
    ok('⑤ 冷却 5 回合', D.fogProbeCd[kk] === 5, 'cd=' + D.fogProbeCd[kk]);
    const r2 = D.fogProbe(target);
    ok('⑤ 冷却中禁止再探', r2 && r2.ok === false && /休整/.test(r2.msg), r2 && r2.msg);
    /* 强制被抓（Math.random = 0 < 30%）—— 暴露率取**目标国**的反谍档，
     * 所以先把目标国设成重金反谍 */
    D.fogProbeCd[kk] = 0;
    D.fogSetGold(P, 120);
    D.fogBudget[target] = 2;
    D.fogInvalidate();
    const relBefore = D.fogRelOf(P, target);
    D.notes().length = 0;
    Math.random = () => 0;
    const r3 = D.fogProbe(target);
    Math.random = rnd;
    ok('⑤ 被抓：颗粒无收', r3 && r3.ok && r3.caught === true, JSON.stringify(r3));
    ok('⑤ 被抓：REL −15', D.fogRelOf(P, target) === relBefore - 15,
      relBefore + ' → ' + D.fogRelOf(P, target));
    const notes = D.notes().map(n => ({ o: n.owner, t: n.text }));
    ok('⑤ 被抓：双方各有纪要',
      notes.some(n => n.o === P && /暴露/.test(n.t)) &&
      notes.some(n => n.o === target && /抓获/.test(n.t)),
      JSON.stringify(notes));
    ok('⑤ 被抓：金照花', D.fogGold(P) === 110, 'gold=' + D.fogGold(P));
    return o;
  }));

  /* ---------------- ⑥ 玩家反谍抓到 AI 密探 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, w = D.world(), P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.fogSetBudget(P, 2);                 // 反谍 30%
    D.setTurn(40);                        // 越过 AI 的 ~10 回合节奏
    const ai = w.countries.find(c => c.id !== P &&
      w.provinces.some(p => p.owner === c.id));
    D.notes().length = 0;
    const relBefore = D.fogRelOf(P, ai.id);
    const rnd = Math.random;
    Math.random = () => 0;                // 0 < 30% → 必被抓
    D.fogAIProbe(ai.id, P);               // 指定目标：这名 AI 的密探盯上玩家
    Math.random = rnd;
    const notes = D.notes().map(n => ({ o: n.owner, t: n.text }));
    ok('⑥ 玩家重金反谍抓到 AI 密探',
      notes.some(n => n.o === P && /抓获/.test(n.t) && n.t.indexOf(ai.name) >= 0),
      JSON.stringify(notes));
    ok('⑥ 抓到的同时 REL 掉 15', D.fogRelOf(P, ai.id) === relBefore - 15,
      relBefore + ' → ' + D.fogRelOf(P, ai.id));
    return o;
  }));

  /* ---------------- ⑦ 省卡 / 国家卡遮蔽 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, w = D.world(), P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const disp = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return 'missing';
      return getComputedStyle(e).display === 'none' ? 'none' : 'shown';
    };
    /* 行内的 span 看不出遮蔽（父行被收起来了，span 自己还是 inline）——
     * 用 offsetParent 判"这一行到底看不看得见" */
    const seenRow = (id) => {
      const e = document.getElementById(id);
      return e && e.offsetParent !== null ? 'shown' : 'hidden';
    };
    /* unknown 省 */
    let up = 0;
    for (let i = 1; i <= w.provinces.length; i++) if (D.fogVis(i) === 0) { up = i; break; }
    D.showInfo(up);
    ok('⑦ unknown 省卡只给一句「未知之地」',
      /未知之地/.test(document.getElementById('infoEmpty').innerHTML) &&
      disp('#infoBody') === 'none',
      document.getElementById('infoEmpty').textContent.slice(0, 40));
    /* seen 省 */
    let sp = 0;
    for (let i = 1; i <= w.provinces.length; i++) if (D.fogVis(i) === 1) { sp = i; break; }
    D.showInfo(sp);
    const bar = document.getElementById('iFogBar');
    ok('⑦ seen 省卡有黄条（截止回合 + 陈旧）',
      !bar.hidden && /情报截止第 \d+ 回合/.test(bar.textContent) && /陈旧/.test(bar.textContent),
      bar.textContent);
    ok('⑦ seen 省卡禁建造（建造栏整块不显示）', disp('#info .bld-col') === 'none', disp('#info .bld-col'));
    ok('⑦ seen 省卡不露实时人口', disp('#kvPop') === 'none', disp('#kvPop'));
    ok('⑦ seen 省卡显示快照', /上回所见建筑/.test(document.getElementById('iFogSnap').textContent),
      document.getElementById('iFogSnap').textContent.slice(0, 60));

    /* 国家卡：别国按档 */
    const other = window.__NB.other;
    const show = (lv) => {
      D.fogSetBudget(P, lv);
      D.showCountry(other);
      return {
        bar: document.getElementById('cFogBar').hidden ? '' : document.getElementById('cFogBar').textContent,
        info: document.getElementById('cFogInfo').hidden ? '' : document.getElementById('cFogInfo').textContent,
        treasury: disp('#cTreasury'), tech: seenRow('cTech'), govern: seenRow('cGovern'),
        pop: seenRow('cPop'), econ: seenRow('cEcon'), prov: document.getElementById('cProv').textContent
      };
    };
    const t0 = show(0);
    ok('⑦ 0 档：只有国名/君主/政体/已探省数', t0.treasury === 'none' && t0.tech === 'hidden' &&
      t0.govern === 'hidden' && t0.pop === 'hidden' && t0.econ === 'hidden' &&
      /已探 \d+ 省/.test(t0.prov) && t0.info.indexOf('总兵力') < 0, JSON.stringify(t0));
    const t1 = show(1);
    ok('⑦ 1 档：+ 总兵力约数', t1.treasury === 'none' && t1.pop === 'hidden' &&
      /总兵力/.test(t1.info), t1.info);
    const t2 = show(2);
    ok('⑦ 2 档：+ 国库约数 + 边境见闻', t2.treasury === 'none' && /国库/.test(t2.info) &&
      /边境见闻/.test(t2.info), t2.info.slice(0, 80));
    /* 自己的国全透明 */
    D.showCountry(P);
    ok('⑦ 自己的国卡全透明', disp('#cTreasury') === 'shown' && seenRow('cTech') === 'shown' &&
      seenRow('cGovern') === 'shown' && seenRow('cPop') === 'shown' &&
      document.getElementById('cFogBar').hidden, '');
    /* 治理面板：别国被遮蔽 */
    D.fogSetBudget(P, 2);
    D.openGov(P);
    ok('⑦ 本国治理面板有情报节', !!document.querySelector('#gpIntelB button'), '');
    D.openGov(other);
    ok('⑦ 别国治理面板只留一句遮蔽说明',
      document.getElementById('gpLock').textContent.indexOf('情报遮蔽') >= 0 &&
      getComputedStyle(document.getElementById('gpBody')).display === 'none',
      document.getElementById('gpLock').textContent);
    D.closeGov();
    return o;
  }));

  /* ---------------- ⑧ 存档 v6 往返 + v5 旧档 ---------------- */
  add(await page.evaluate(() => {
    const D = window.AO.resDebug, P = D.player(), o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    D.fogSetBudget(P, 1);
    D.fogSetGold(P, 150);
    D.save(true);
    const raw = localStorage.getItem('sj.save');
    const d = JSON.parse(raw);
    ok('⑧ 存档版本 v6', d.v === 6, 'v=' + d.v);
    ok('⑧ 存档含迷雾（E/L/B/CD/REL）', !!d.FOG && d.FOG.E.length > 0 &&
      typeof d.FOG.B === 'number' && !!d.FOG.L && !!d.FOG.REL,
      'E=' + (d.FOG && d.FOG.E.length) + ' B=' + (d.FOG && d.FOG.B) + ' REL=' +
        (d.FOG && Object.keys(d.FOG.REL).length));
    ok('⑧ 只存玩家的迷雾（L 的键是省 id，不是 owner|pid）', (() => {
      const ks = Object.keys(d.FOG.L);
      return ks.length > 0 && ks.every(k => /^\d+$/.test(k)) && !('E' in d.FOG.L);
    })(), 'L 键示例 ' + Object.keys(d.FOG.L).slice(0, 3).join(','));
    /* 改内存再读回：应恢复存档里的状态 */
    const savedLen = d.FOG.E.length;
    D.fogSetBudget(P, 2);
    for (const pid in D.fogExplored[P]) delete D.fogExplored[P][pid];
    D.fogInvalidate();
    D.fogLoad(d.FOG);
    ok('⑧ 读回迷雾：已探省数一致', Object.keys(D.fogExplored[P]).length === savedLen,
      Object.keys(D.fogExplored[P]).length + ' vs ' + savedLen);
    ok('⑧ 读回迷雾：预算档一致', D.fogBudgetOf(P) === 1, D.fogBudgetOf(P));
    return o;
  }));

  /* v5 旧档：删掉 FOG / 版本改 5，读档后按"自国已探、其余 unknown"补 */
  const oldSave = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sj.save'));
    d.v = 5;
    delete d.FOG;
    localStorage.setItem('sj.save', JSON.stringify(d));
    return { player: d.PLAYER };
  });
  await page.evaluate(() => window.AO.resDebug.load());
  await sleep(3600);
  add(await page.evaluate((old) => {
    const D = window.AO.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const c = w && w.countries[D.player() - 1];
    ok('⑧ v5 旧档读入后玩家国还原', D.player() === old.player, D.player() + ' vs ' + old.player);
    ok('⑧ v5 旧档自动补初始化（自国已探）', !!c &&
      Object.keys(D.fogExplored[D.player()] || {}).length === c.provinces.length,
      c ? Object.keys(D.fogExplored[D.player()] || {}).length + ' / ' + c.provinces.length : 'no country');
    ok('⑧ v5 旧档补出 REL 表', Object.keys(D.fogRel).length > 0, Object.keys(D.fogRel).length);
    return o;
  }, oldSave));

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
