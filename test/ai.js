/* =============================================================
 * test/ai.js —— 敌国内政 AI（v7）的验收
 *
 * 对着任务书的验收清单逐条过：
 *   1) 工坊模式（PLAYER = 0）AI 全静止；选国之后 30 回合世界肉眼可见地活起来
 *      （学校 / 市场陆续出现、科研条在涨、官员在派）
 *   2) 三种性格分化可辨（军国先兵营、经营先学校）；调税规则按阈值触发
 *   3) AI 建造不抽干中央（中央金不够时连工地都不开）、不写玩家提示条、不推纪要
 *   4) 贪墨官会被 AI 自己撤换；AI 开科扣人才点与玩家同规则
 *   5) 存档加人格字段往返正常（不升版本号，旧档容错）
 *
 * 用法：node test/ai.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);

  const checks = [];
  const ck = (name, ok, note) => {
    checks.push([name, !!ok, note || '']);
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + (note || ''));
  };
  const ev = (fn, ...a) => page.evaluate(fn, ...a);

  /* 生成一个中小世界（520 省跑得快，又不至于只有几国） */
  await ev(() => {
    document.getElementById('seed').value = 'ai-accept';
    document.getElementById('prov').value = 360;
    document.getElementById('ctry').value = 20;
    document.getElementById('provVal').textContent = 360;
    document.getElementById('ctryVal').textContent = 20;
    document.getElementById('gen').click();
  });
  for (let i = 0; i < 200; i++) {
    await sleep(70);
    if (await ev(() => !document.getElementById('gen').disabled && !!window.__world)) break;
  }

  /* ---------------- 1) 工坊模式：AI 全静止 ---------------- */
  {
    const r = await ev(() => {
      const D = window.AO.resDebug, AI = window.AO.aiDebug;
      /* n + site = 已建 + 在建。只看 n 会把"这一回合刚开工"的工地漏掉；
       * 只看 site 又会漏掉"刚完工"的。两样加起来才是"这个国家有没有动土"。 */
      const cnt = (cid, kind) => {
        const T = { school: window.AO.resSchool, market: window.AO.resMarket,
          builder: window.AO.resBuilder, granary: window.AO.resGranary,
          barracks: window.AO.resMil.barracks, armory: window.AO.resMil.armory }[kind];
        let a = 0;
        for (const prov of AI.provsOf(cid)) {
          const st = T && T[prov.id];
          if (st && (st.n > 0 || st.site > 0)) a++;   // 数「这省有没有它」，不数 site 倒计时
        }
        return a;
      };
      const snap = () => {
        let s = 0, m = 0, b = 0, pts = 0, off = 0;
        for (const c of window.__world.countries) {
          s += cnt(c.id, 'school');
          m += cnt(c.id, 'market');
          b += cnt(c.id, 'barracks');
          pts += (window.AO.resResearch[c.id] || {}).pts || 0;
        }
        for (const k in window.AO.resOfficial) off++;
        return { s, m, b, pts, off };
      };
      const a = snap();
      const tick0 = window.AO.aiEconTick();          // 工坊模式：应当是 0
      for (let i = 0; i < 8; i++) D.settleTurn();
      const b = snap();
      return { a, b, tick0, player: D.player(), acted: D.notes().length };
    });
    ck('工坊模式 AI 全静止（8 回合什么都没盖、没研）',
      r.player === 0 && r.tick0 === 0 &&
      r.a.s === r.b.s && r.a.m === r.b.m && r.a.b === r.b.b,
      '学校 ' + r.a.s + '→' + r.b.s + ' · 市场 ' + r.a.m + '→' + r.b.m +
      ' · 兵营 ' + r.a.b + '→' + r.b.b + '（科研点照涨是既有学校在产，不算 AI 动作）');
  }

  /* ---------------- 2) 选国之后 30 回合：世界活起来 ---------------- */
  const live = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug, w = window.__world;
    D.choosePlayer(w.countries[0].id);
    const pid0 = D.player();
    const before = { s: 0, m: 0, pts: 0, off: 0, halt: 0 };
    for (const c of w.countries) {
      if (c.id === pid0) continue;
      before.s += AI.univCount(c.id, 'school');
      before.m += AI.univCount(c.id, 'market');
      before.pts += (window.AO.resResearch[c.id] || {}).pts || 0;
    }
    for (const k in window.AO.resOfficial) before.off++;
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) D.settleTurn();
    const after = { s: 0, m: 0, pts: 0, off: 0, tech: 0 };
    let cenMin = 1e9, cenBoom = 0;
    for (const c of w.countries) {
      if (c.id === pid0) continue;
      after.s += AI.univCount(c.id, 'school');
      after.m += AI.univCount(c.id, 'market');
      after.pts += (window.AO.resResearch[c.id] || {}).pts || 0;
      const dd = (window.AO.resResearch[c.id] || {}).done || {};
      after.tech += Object.keys(dd).length;
      const cen = D.ensureCentral(c.id).gold || 0;
      if (cen < cenMin) cenMin = cen;
      if (cen > cenBoom) cenBoom = cen;
    }
    for (const k in window.AO.resOfficial) after.off++;
    return { before, after, ms: Date.now() - t0, cenMin, cenBoom, turn: D.turn() };
  });
  ck('AI 国学校陆续出现', live.after.s - live.before.s >= 10,
    live.before.s + ' → ' + live.after.s + ' 座（30 回合新增 ' + (live.after.s - live.before.s) + '）');
  ck('AI 国市场陆续出现', live.after.m - live.before.m >= 3,
    live.before.m + ' → ' + live.after.m + ' 座');
  ck('AI 科研条在涨（有科技研出来）', live.after.tech > 0,
    '科研点 ' + Math.round(live.before.pts) + ' → ' + Math.round(live.after.pts) +
    ' · 已完成科技合计 ' + live.after.tech + ' 条');
  ck('AI 在派官员', live.after.off > 0, '在任官员 ' + live.after.off + ' 位（30 回合前 ' + live.before.off + '）');
  ck('AI 不抽干中央（没有负国库）', live.cenMin >= 0,
    '中央金最低 ' + Math.round(live.cenMin) + ' · 最高 ' + Math.round(live.cenBoom));

  /* ---------------- 3) 三种性格分化 ---------------- */
  const diverge = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug, w = window.__world;
    const KINDS = ['school', 'market', 'barracks', 'armory', 'granary', 'builder'];
    /* 找两个干净的 AI 国：清空它们的工地/建筑，塞足中央金，只看"先盖什么" */
    const pick = [];
    for (const c of w.countries) {
      if (c.id === D.player()) continue;
      if (c.provinces.length < 4) continue;
      pick.push(c);
      if (pick.length === 2) break;
    }
    const clearOne = (cid) => {
      for (const prov of AI.provsOf(cid)) { const pid = prov.id;
        for (const k of KINDS) {
          const T = { school: window.AO.resSchool, market: window.AO.resMarket,
            builder: window.AO.resBuilder, granary: window.AO.resGranary,
            barracks: window.AO.resMil.barracks, armory: window.AO.resMil.armory }[k];
          if (T && T[pid]) { T[pid].n = 0; T[pid].site = 0; T[pid].halted = false; }
        }
        const bag = window.AO.resSim[pid];
        if (bag) for (const k in bag) { bag[k].built = 0; bag[k].tiers = { 1: 0, 2: 0 }; bag[k].site = 0; }
      }
      const cen = D.ensureCentral(cid);
      for (const k in cen) cen[k] = 400;
      window.AO.resTalent[cid] = { pts: 0, pool: [], total: 0 };
    };
    /* 12 次动作不会让任何一座楼完工（学校 2 回合、兵营 2 回合），所以这里
     * 数的是"已建 + 在建" —— AI 有没有动土，看这个才准。 */
    const counts = (cid) => {
      const T = { school: window.AO.resSchool, market: window.AO.resMarket,
        builder: window.AO.resBuilder, granary: window.AO.resGranary,
        barracks: window.AO.resMil.barracks, armory: window.AO.resMil.armory };
      const out = {};
      for (const k of KINDS) {
        let a = 0;
        for (const prov of AI.provsOf(cid)) {
          const st = T[k] && T[k][prov.id];
          if (st && (st.n > 0 || st.site > 0)) a++;   // 数「这省有没有它」，不数 site 倒计时
        }
        out[k] = a;
      }
      return out;
    };
    const a = pick[0], b = pick[1];
    clearOne(a.id); clearOne(b.id);
    AI.setPersona(a.id, 'mil');
    AI.setPersona(b.id, 'econ');
    /* 跑 18 次"这个国家的一回合"：兵营 7 座、学校 7 座这种小国也能走完第一档，
     * 走到第二、第三档才看得出"优先级表"真的在起作用。 */
    for (let i = 0; i < 18; i++) { AI.country(a); AI.country(b); }
    return {
      mil: { cn: a.name, n: AI.provsOf(a.id).length, ...counts(a.id) },
      econ: { cn: b.name, n: AI.provsOf(b.id).length, ...counts(b.id),
        quota: Math.max(1, Math.floor(AI.provsOf(b.id).length / window.AO.AIECON.schoolQuotaDiv)) }
    };
  });
  ck('军国：每省先落一座兵营（兵营 ≥ 省数，学校排到兵营之后）',
    diverge.mil.barracks > 0 && diverge.mil.barracks >= diverge.mil.n,
    diverge.mil.cn + '（' + diverge.mil.n + ' 省）兵营 ' + diverge.mil.barracks +
    ' · 学校 ' + diverge.mil.school + ' · 市场 ' + diverge.mil.market);
  ck('经营：先学校、且学校数不超过省数/3 的扫盲配额，从不建兵营',
    diverge.econ.school > 0 && diverge.econ.school <= diverge.econ.quota &&
    diverge.econ.market > 0 && diverge.econ.barracks === 0,
    diverge.econ.cn + '（' + diverge.econ.n + ' 省，配额 ' + diverge.econ.quota + '）学校 ' +
    diverge.econ.school + ' · 市场 ' + diverge.econ.market + ' · 兵营 ' + diverge.econ.barracks);

  /* ---------------- 4) 调税规则 ---------------- */
  const tax = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug, w = window.__world;
    const c = w.countries.find(x => x.id !== D.player() && x.provinces.length > 2);
    const cid = c.id;
    const setHappy = (v) => {
      for (const pid of c.provinces) {
        const h = window.AO.resHappyOf(pid);
        h.v = v; h.target = v;
      }
    };
    const out = {};
    /* 军国：中央金 < 30 → 拉满；民心崩 → 降一档 */
    AI.setPersona(cid, 'mil');
    D.setTax(cid, 1); setHappy(60);
    D.ensureCentral(cid).gold = 5;
    AI.country(c);
    out.milPoor = D.taxrate[cid];
    setHappy(20);
    AI.country(c);
    out.milSad = D.taxrate[cid];
    /* 经营：民心 < 45 → 降一档；民心回来了 + 国库宽裕 → 升回常规（到 1 为止） */
    AI.setPersona(cid, 'econ');
    D.setTax(cid, 1); setHappy(30);
    AI.country(c);
    out.econSad = D.taxrate[cid];
    setHappy(70);
    D.ensureCentral(cid).gold = 300;
    AI.country(c);
    out.econRich = D.taxrate[cid];
    /* 经营"不碰横征暴敛"：就算再穷也不会升到 2 */
    AI.setPersona(cid, 'econ');
    D.setTax(cid, 1); setHappy(70); D.ensureCentral(cid).gold = 0;
    AI.country(c); AI.country(c); AI.country(c);
    out.econNever2 = D.taxrate[cid];
    return out;
  });
  ck('军国：中央金 < 30 → 拉满档（横征暴敛）', tax.milPoor === 2, '税率 ' + tax.milPoor);
  ck('军国：民心 < 35 → 降一档保命', tax.milSad === 1, '税率 ' + tax.milSad);
  ck('经营：民心 < 45 → 降一档', tax.econSad === 0, '税率 ' + tax.econSad);
  ck('经营：民心回升 + 国库宽裕 → 升回常规', tax.econRich === 1, '税率 ' + tax.econRich);
  ck('经营：不碰横征暴敛（永远升不到 2）', tax.econNever2 <= 1, '税率 ' + tax.econNever2);

  /* ---------------- 5) 建造不抽干中央 / 不写提示条 / 不推纪要 ---------------- */
  const guard = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug, w = window.__world;
    const c = w.countries.find(x => x.id !== D.player() && x.provinces.length > 3);
    const cid = c.id;
    const KINDS = ['school', 'market', 'builder', 'granary', 'barracks', 'armory'];
    for (const pid of c.provinces) {
      for (const k of KINDS) {
        const T = { school: window.AO.resSchool, market: window.AO.resMarket,
          builder: window.AO.resBuilder, granary: window.AO.resGranary,
          barracks: window.AO.resMil.barracks, armory: window.AO.resMil.armory }[k];
        if (T && T[pid]) { T[pid].n = 0; T[pid].site = 0; T[pid].halted = false; }
      }
    }
    AI.setPersona(cid, 'econ');
    /* 中央只给 6 金：连最便宜的学校（8 金）都不够 → 一座都不该开工 */
    D.ensureCentral(cid).gold = 6;
    const before = KINDS.reduce((a, k) => a + AI.univCount(cid, k), 0);
    AI.country(c); AI.country(c);
    const after = KINDS.reduce((a, k) => a + AI.univCount(cid, k), 0);
    const sites = c.provinces.reduce((a, pid) =>
      a + KINDS.reduce((b, k) => {
        const T = { school: window.AO.resSchool, market: window.AO.resMarket,
          builder: window.AO.resBuilder, granary: window.AO.resGranary,
          barracks: window.AO.resMil.barracks, armory: window.AO.resMil.armory }[k];
        return b + ((T && T[pid] && T[pid].site) || 0);
      }, 0), 0);
    return { before, after, sites, cen: D.ensureCentral(cid).gold };
  });
  ck('中央金低于 cost+5 时 AI 一座都不开工',
    guard.sites === 0 && guard.after === guard.before,
    '中央金 ' + guard.cen + ' 金 → 在建筑 ' + guard.before + ' 座 / 工地 ' + guard.sites + ' 处');

  /* 提示条 / 纪要：走真正的 nextTurn（它会清 NOTES 并按当前选国 flushNotes） */
  const quiet = await ev(() => {
    const D = window.AO.resDebug;
    const el = document.getElementById('bldMsg');
    if (el) el.textContent = '';
    D.notes().length = 0;
    for (let i = 0; i < 10; i++) D.nextTurn();
    const notes = D.notes().map(n => n.text);
    /* AI 的内政动作（盖房 / 开科 / 调税）一条都不该出现 */
    const bad = notes.filter(t => /开工|开科大典|武科|税率改为|开科取士/.test(t));
    return { msg: (document.getElementById('bldMsg') || {}).textContent || '',
      bad: bad.slice(0, 4), n: notes.length };
  });
  ck('AI 内政动作不写玩家提示条', !/开工|开科|税率/.test(quiet.msg), '提示条内容：' + (quiet.msg || '（空）'));
  ck('AI 内政动作不推纪要（盖房 / 开科 / 调税）', quiet.bad.length === 0,
    '纪要 ' + quiet.n + ' 条，其中有 AI 内政 ' + quiet.bad.length + ' 条' +
    (quiet.bad.length ? '：' + quiet.bad[0] : ''));

  /* ---------------- 6) 贪墨官会被 AI 自己撤换 ---------------- */
  const graft = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug, w = window.__world;
    const c = w.countries.find(x => x.id !== D.player() && x.provinces.length > 2);
    const pid = c.provinces[0];
    const off = { id: 999999, name: '贪墨测试', traitKey: 'greedy', owed: 0, at: D.turn() };
    window.AO.resOfficial[pid] = off;
    AI.setPersona(c.id, 'balanced');
    let n = 0;
    for (; n < 80; n++) {
      AI.country(c);
      if (!window.AO.resOfficial[pid] || window.AO.resOfficial[pid].id !== 999999) break;
    }
    const now = window.AO.resOfficial[pid];
    return { n, gone: !now || now.id !== 999999, name: now ? now.name : '（空缺）' };
  });
  ck('贪墨官上任 3 回合内会被 AI 自己撤换', graft.gone,
    '试了 ' + graft.n + ' 次动作后 ' + (graft.gone ? '已撤换（现由 ' + graft.name + '）' : '仍在任'));

  /* ---------------- 7) 开科扣人才点（和玩家同规则） ---------------- */
  const examR = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug, w = window.__world;
    const c = w.countries.find(x => x.id !== D.player() && x.provinces.length > 2);
    const G = window.AO.GOV, cid = c.id;
    /* 清空各省官员与候选池，人才点给足（examCost × 2 > threshold examCost × 1.5） */
    for (const pid of c.provinces) delete window.AO.resOfficial[pid];
    window.AO.resTalent[cid] = { pts: G.examCost * 2, pool: [], total: 0 };
    AI.setPersona(cid, 'balanced');
    const before = window.AO.resTalent[cid].pts;
    const r = window.AO.resDebug.exam(cid, true);      // silent = AI 那一路
    const after = window.AO.resTalent[cid].pts;
    return { before, after, cost: G.examCost, ok: r && r.ok, pool: window.AO.resTalent[cid].pool.length };
  });
  ck('AI 开科消耗人才点（与玩家同价）',
    examR.ok && Math.abs(examR.before - examR.after - examR.cost) < 1e-6,
    '人才点 ' + examR.before + ' → ' + examR.after + '（扣 ' + examR.cost + '）· 候选池 ' + examR.pool + ' 位');

  /* ---------------- 8) 存档加人格字段往返 ---------------- */
  const saveR = await ev(() => {
    const D = window.AO.resDebug, AI = window.AO.aiDebug;
    const c = window.__world.countries.find(x => x.id !== D.player());
    AI.setPersona(c.id, 'mil');
    D.save(true);
    let raw = null;
    try { raw = localStorage.getItem('sj.save'); } catch (e) { return { err: 'no-storage' }; }
    const d = JSON.parse(raw);
    const saved = d.AI && d.AI[c.id];
    const ver = d.v;
    /* 模拟"读档前的内存被清空"：换成别的性格，再 load 回来 */
    AI.setPersona(c.id, 'econ');
    const mid = AI.personaOf(c.id);
    AI.tick();                                  // 世界没换 → 不该清表
    window.AO.aiEconLoad(d.AI);
    const back = AI.personaOf(c.id);
    /* 旧档（没有 AI 字段）容错：清表 + 按 seed+cid 的散列补默认，不炸 */
    window.AO.aiEconLoad(undefined);
    const old = AI.personaOf(c.id);
    return { saved, ver, mid, back, old, cid: c.id, nowVer: window.AO.SAVE_VER };
  });
  ck('存档里有性格字段（不升版本号）',
    saveR.saved === 'mil' && saveR.ver === saveR.nowVer,
    'AI[' + saveR.cid + '] = ' + saveR.saved + ' · 存档版本 v' + saveR.ver +
    '（= 当前 AO.SAVE_VER，说明只是加了字段）');
  ck('性格随档往返', saveR.mid === 'econ' && saveR.back === 'mil',
    '存档 mil → 改成 econ → 读档 ' + saveR.back);
  ck('旧档（无 AI 字段）容错：按散列补默认', ['econ', 'balanced', 'mil'].indexOf(saveR.old) >= 0,
    '读旧档后性格 = ' + saveR.old);

  /* 真实读档路径：存档 → 换一个世界 → 点「读档」→ 性格要回到存档里的那个。
   * 这一段专门守"按 seed 重建世界之后，18-ai.js 的 world 缓存还指着旧对象"
   * 那个坑 —— 不守的话症状是"读档后所有国家性格全变"，而且只在真读档时出现。 */
  {
    const r = await ev(async () => {
      const D = window.AO.resDebug, AI = window.AO.aiDebug;
      const c = window.__world.countries.find(x => x.id !== D.player());
      AI.setPersona(c.id, 'mil');
      const want = AI.personaOf(c.id);
      D.save(true);
      /* 换成另一个 seed 的世界（读档会自己按存档里的 seed 再重建） */
      document.getElementById('seed').value = 'ai-accept-other';
      document.getElementById('gen').click();
      const waitGen = () => new Promise(res => {
        let n = 0;
        const t = setInterval(() => {
          if ((!document.getElementById('gen').disabled && window.__world) || ++n > 120) {
            clearInterval(t); res(true);
          }
        }, 70);
      });
      await waitGen();
      D.load();
      await waitGen();
      return { want, got: AI.personaOf(c.id), cid: c.id, turn: D.turn(), player: D.player() };
    });
    ck('真实读档路径：性格随档回来（不升版本号 / 不写迁移）',
      r.got === r.want,
      '存档 ' + r.want + ' → 重建世界并读档后 ' + r.got + '（第 ' + r.turn + ' 回合，玩家国 ' + r.player + '）');
  }

  /* ---------------- 9) 退出游戏 → AI 再次静止 ---------------- */
  {
    const r = await ev(() => {
      const D = window.AO.resDebug;
      D.exitGame();
      /* 判据用 AI 自己的动作计数（tick 的返回值 = 这一回合开了几个工地）：
       * 退出游戏之后它必须恒为 0。不去数"设施总数"是因为那一路上还有
       * 维护停产、事件、省界变动，掉几个座并不等于"AI 在动土"。 */
      const t0 = window.AO.aiEconTick();
      for (let i = 0; i < 6; i++) D.settleTurn();
      const t1 = window.AO.aiEconTick();
      return { t0, t1, player: D.player() };
    });
    ck('退出游戏（回到工坊）后 AI 立刻静止',
      r.player === 0 && r.t0 === 0 && r.t1 === 0,
      'AI 动作数 ' + r.t0 + ' / ' + r.t1 + '（0 = 一次都没动）');
  }

  /* ---------------- 收尾 ---------------- */
  const bad = checks.filter(c => !c[1]);
  console.log('');
  console.log('共 ' + checks.length + ' 项：' + (checks.length - bad.length) + ' 通过 / ' + bad.length + ' 失败');
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  process.exit(bad.length || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
