/* =============================================================
 * test/ai-persona.js —— 敌国内政 AI（完整版）的验收
 *
 * 对着任务书的验收清单逐条过：
 *   1) 选国挂机：AI 省陆续长出学校 / 市场 / 粮仓，科研在涨，官员在派
 *   2) 教育 ≥15 后 AI 建工厂、枯竭矿 AI 省改建熔旧坊、≥60 出现大学（全走 tick 自发）
 *   3) 三种性格大趋势分化；**同性格国家行为不同**（顺序有方差）
 *   4) 军事政体国家显著更常出军国人格（政体修正的纯函数 + 统计）
 *   5) 调税按 taxBias 触发、经营型永不横征；研究选择带偏科
 *   6) 国家卡性格显示随情报档三态（？？/ 性格 / 性格+怪癖）
 *   7) AI 建造不抽干中央、不写玩家提示条、不刷纪要；工坊模式全静
 *   8) 贪墨官被 AI 撤换；存档字段往返正常（含上一版的扁平格式）
 *
 * 跑法：node test/ai-persona.js
 * 小世界（240 省 / 12 国），四十秒左右。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const shot = (n) => path.join(root, 'shots', n);
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
    document.getElementById('seed').value = 'ai-persona-spec';
    document.getElementById('gen').click();
  });
  await sleep(2800);

  /* ---------------- ① 定义区 + 政体修正（纯函数，不动世界） ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, E = A.AIECON, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    ok('① 定义区有政体修正表', !!E.personaGov && !!E.personaGov.kingdom && !!E.personaGov.republic);
    ok('① 定义区有怪癖范围 0.8~1.2', E.quirk && E.quirk.lo === 0.8 && E.quirk.hi === 1.2);
    ok('① 定义区有怪癖文案表', !!A.PERSONA_TXT && !!A.PERSONA_TXT.tax && !!A.PERSONA_TXT.tax.lo);
    const wk = AI.weights('kingdom'), wr = AI.weights('republic');
    const g = (l, k) => (l.filter(x => x.key === k)[0] || {}).w || 0;
    ok('① 王室政体把军国权重抬高', g(wk, 'mil') > 20, '王国 mil 权重 ' + g(wk, 'mil').toFixed(1));
    ok('① 商民政体把军国权重压低', g(wr, 'mil') < 20, '共和 mil 权重 ' + g(wr, 'mil').toFixed(1));
    ok('① 商民政体把经营权重抬高', g(wr, 'econ') > 30, '共和 econ 权重 ' + g(wr, 'econ').toFixed(1));

    /* 统计：600 个合成国号 × 两种政体，看分布差 */
    const cnt = (gov) => {
      const r = { econ: 0, balanced: 0, mil: 0 };
      for (let i = 1; i <= 600; i++) r[AI.rollWith(i, gov)]++;
      return r;
    };
    const K = cnt('kingdom'), R = cnt('republic');
    ok('④ 军事政体显著更常出军国（600 样本）',
      K.mil / 600 > 0.30 && R.mil / 600 < 0.15,
      '王国 ' + (K.mil / 6).toFixed(1) + '% vs 共和 ' + (R.mil / 6).toFixed(1) + '%');
    ok('④ 商业共和更常出经营',
      R.econ / 600 > 0.42 && K.econ / 600 < 0.25 && R.econ > K.econ * 2,
      '共和 ' + (R.econ / 6).toFixed(1) + '% vs 王国 ' + (K.econ / 6).toFixed(1) + '%');
    return o;
  }));

  /* ---------------- ② 怪癖（生成即定、可复现、随档存） ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const c1 = w.countries[1], c2 = w.countries[2];
    const q1 = AI.quirkOf(c1.id), q2 = AI.quirkOf(c2.id);
    const ks = ['build', 'tax', 'research'];
    ok('② 三个系数都在 0.8~1.2',
      ks.every(k => q1[k] >= 0.8 - 1e-9 && q1[k] <= 1.2 + 1e-9),
      JSON.stringify(q1));
    ok('② warBias 也掷了（本批只存不用）', typeof q1.war === 'number' && q1.war >= 0.8 && q1.war <= 1.2, q1.war);
    ok('② 同一国两次取到同一个怪癖',
      JSON.stringify(AI.quirkOf(c1.id)) === JSON.stringify(q1));
    ok('② 不同国怪癖不同',
      JSON.stringify(q1) !== JSON.stringify(q2), JSON.stringify(q2));
    const top = AI.topQuirk(c1.id);
    ok('② 主导怪癖有说法（key + 中文）',
      ['build', 'tax', 'research'].indexOf(top.key) >= 0 && !!top.cn, top.key + ' · ' + top.cn);
    window.__Q = { c1: c1.id, c2: c2.id, q1: q1 };
    return o;
  }));

  /* ---------------- ③ 建造顺序：底色不变、同性格有差异 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, E = A.AIECON, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world(), ids = w.countries.slice(1, 9).map(c => c.id);
    /* 表里有本批新加的三项 */
    ok('③ 底表含 大学 / 工厂 / 熔旧坊',
      E.buildOrder.econ.indexOf('university') >= 0 &&
      E.buildOrder.econ.indexOf('factory') >= 0 &&
      E.buildOrder.econ.indexOf('smelt') >= 0);
    ok('③ 经营把熔旧坊排在最后',
      E.buildOrder.econ[E.buildOrder.econ.length - 1] === 'smelt');
    ok('③ 军国把熔旧坊排在军械坊之前',
      E.buildOrder.mil.indexOf('smelt') < E.buildOrder.mil.indexOf('armory'));

    /* 顺序稳定：同一国连问两次一样（每回合不重掷） */
    const a1 = AI.orderOf(ids[0]), a2 = AI.orderOf(ids[0]);
    ok('③ 同一国顺序稳定（每回合不重掷）', JSON.stringify(a1) === JSON.stringify(a2), a1.join(' → '));

    /* 同性格不同国：顺序不完全一样（buildBias 抖动） */
    ids.forEach(id => AI.setPersona(id, 'mil'));
    const orders = ids.map(id => AI.orderOf(id, 'mil').join(','));
    ok('③ 同性格国家顺序有差异', new Set(orders).size > 1,
      new Set(orders).size + ' 种 / ' + ids.length + ' 国');
    /* 底色不变：军国的兵营仍在前三 */
    const bad = ids.filter(id => AI.orderOf(id, 'mil').indexOf('barracks') > 2);
    ok('③ 底色不变（军国的兵营仍在前三）', bad.length === 0, '越界 ' + bad.length + ' 国');
    /* 还原真实性格 */
    ids.forEach(id => { delete AI.persona[id]; });
    return o;
  }));

  /* ---------------- ⑦a 工坊模式：AI 全静止 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const cnt = () => {
      let s = 0;
      for (const c of D.world().countries) {
        for (const p of AI.provsOf(c.id)) {
          const st = A.resSchool[p.id];
          if (st) s += st.n + st.site;
        }
      }
      return s;
    };
    const before = cnt();
    const acted = AI.tick();
    D.settleTurn();
    ok('⑦ 工坊模式（PLAYER=0）AI 一动都不动', acted === 0, '动作数 ' + acted);
    ok('⑦ 工坊模式跑一回合也没长出学校', cnt() === before, before + ' → ' + cnt());
    return o;
  }));

  /* ---------------- 1) 选国挂机 30 回合：世界活起来 ---------------- */
  const before = await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug;
    const w = D.world();
    /* 选一个省数最多的国当玩家（它不归 AI 管） */
    let best = w.countries[0];
    for (const c of w.countries) if (c.provinces.length > best.provinces.length) best = c;
    D.choosePlayer(best.id);
    window.__PL = best.id;
    /* 顺手把两个 AI 省的铁矿按成枯竭（模拟中局：矿早就挖空了），
     * 这样 30 回合内就能看到"AI 自发改建熔旧坊" */
    const ai = w.countries.filter(c => c.id !== best.id);
    let n = 0;
    for (const c of ai) {
      for (const pid of c.provinces) {
        if (n >= 3) break;
        const bag = A.resSim[pid], s = bag && bag.iron;
        if (!s) continue;
        s.built = Math.max(1, s.built); s.tiers = { 1: s.built, 2: 0 };
        s.left = 0; s.gone = true; s.cool = 0;
        n++;
      }
    }
    /* 给 AI 国一点教育，好让熔旧坊（门槛 15）能开工 */
    for (const c of ai) A.resTalent[c.id].total = Math.max(A.resTalent[c.id].total || 0, 20);
    window.__GONE = n;
    const snap = () => {
      let sch = 0, mkt = 0, gra = 0, off = 0, tech = 0, pts = 0;
      for (const c of ai) {
        for (const pid of c.provinces) {
          if (A.resSchool[pid]) sch += A.resSchool[pid].n;
          if (A.resMarket[pid]) mkt += A.resMarket[pid].n;
          if (A.resGranary[pid]) gra += A.resGranary[pid].n;
          if (A.resOfficial[pid]) off++;
        }
        const R = A.resResearch[c.id];
        if (R) { tech += R.done ? Object.keys(R.done).length : 0; pts += R.pts || 0; }
      }
      return { sch, mkt, gra, off, tech, pts, turn: D.turn() };
    };
    return { s0: snap(), notes: D.notes().length };
  });

  await page.evaluate(() => {
    const D = window.AO.resDebug;
    for (let i = 0; i < 30; i++) {
      D.settleTurn();
      if (D.evtPending()) D.evtPick(0);     // 玩家国的事件按默认选项落地，别卡住回合
    }
  });

  add(await page.evaluate((b) => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const ai = w.countries.filter(c => c.id !== window.__PL);
    let sch = 0, mkt = 0, gra = 0, off = 0, tech = 0, pts = 0, smelt = 0, cenMin = 1e9;
    for (const c of ai) {
      for (const pid of c.provinces) {
        if (A.resSchool[pid]) sch += A.resSchool[pid].n;
        if (A.resMarket[pid]) mkt += A.resMarket[pid].n;
        if (A.resGranary[pid]) gra += A.resGranary[pid].n;
        if (A.resOfficial[pid]) off++;
        if (A.resSmelt[pid]) smelt += A.resSmelt[pid].n;
      }
      const R = A.resResearch[c.id];
      if (R) { tech += R.done ? Object.keys(R.done).length : 0; pts += R.pts || 0; }
      cenMin = Math.min(cenMin, D.ensureCentral(c.id).gold || 0);
    }
    ok('1 挂机 30 回合：学校长出来了', sch > b.s0.sch, b.s0.sch + ' → ' + sch);
    ok('1 市场长出来了', mkt > b.s0.mkt, b.s0.mkt + ' → ' + mkt);
    ok('1 粮仓长出来了', gra > b.s0.gra, b.s0.gra + ' → ' + gra);
    ok('1 科研在涨（点数或完成数）', pts > b.s0.pts || tech > b.s0.tech,
      '科研点 ' + b.s0.pts + ' → ' + pts + ' · 完成 ' + b.s0.tech + ' → ' + tech);
    ok('1 官员派下去了', off > b.s0.off, b.s0.off + ' → ' + off);
    ok('2 枯竭矿的 AI 省自发改建出熔旧坊', smelt > 0, '熔旧坊 ' + smelt + ' 座（枯竭矿 ' + window.__GONE + ' 处）');
    ok('7 AI 没把中央抽干（每国中央金 ≥ 0）', cenMin >= 0, '最低 ' + cenMin);
    /* 不写提示条 / 不刷纪要：AI 的动作都是 silent */
    const bm = document.getElementById('bldMsg');
    /* v10 起「世界纪要」（🌍 开头的远方大事）是允许可见的（spec ⑤），
     * 所以这里只断言：提示条里不会出现**内政口径**的话。 */
    const bmTxt = bm ? bm.textContent.trim() : '';
    ok('7 AI 内政不写玩家提示条（只允许 🌍 世界纪要）',
      !bmTxt || /^🌍/.test(bmTxt), bmTxt);
    const notes = D.notes().map(x => x.text || '');
    ok('7 AI 建造不推纪要（没有"开工/改建/开科"这类玩家口径的条目）',
      !notes.some(t => /开工|改建|开科|再建一座/.test(t)),
      notes.filter(t => /开工|改建|开科/.test(t)).slice(0, 2).join(' / '));
    window.__RUN = { sch, mkt, gra, off, tech, smelt };
    return o;
  }, before));

  /* ---------------- 3) 三型分化 + 同性格不重合 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 结构分化：三种性格的"第一件事"就该不一样 */
    const first = (p) => AI.orderOf(D.world().countries[1].id, p)[0];
    ok('3 经营先学校', first('econ') === 'school', first('econ'));
    ok('3 军国先兵营', first('mil') === 'barracks', first('mil'));
    /* 曲线分化：groups() 里三组各自有数，且不是同一组数字 */
    const g = AI.groups();
    const keys = Object.keys(g);
    ok('3 三组都在（经营/均衡/军国）', keys.length === 3, keys.join(','));
    const sig = keys.map(k => [g[k].school, g[k].market, g[k].barracks, g[k].tax, g[k].gold].map(v => v.toFixed(2)).join('/'));
    ok('3 三组曲线不重合', new Set(sig).size === 3, sig.join('  |  '));
    /* 方差线：同性格国家的建校/加税时机标准差（样本 < 2 时是 0） */
    ok('3 方差线字段在（建校 σ / 加税 σ）',
      keys.every(k => typeof g[k].schoolSd === 'number' && typeof g[k].taxSd === 'number'),
      keys.map(k => g[k].cn + ' σ建校 ' + g[k].schoolSd.toFixed(1)).join(' · '));
    ok('3 至少一组的时机有方差（同性格不重合）',
      keys.some(k => g[k].schoolSd > 0 || g[k].taxSd > 0),
      keys.map(k => g[k].cn + ' σ税 ' + g[k].taxSd.toFixed(1)).join(' · '));
    window.__G = g;
    return o;
  }));

  /* ---------------- 5) 调税：taxBias 消费 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const cid = window.__PL + 1 <= D.world().countries.length ? window.__PL + 1 : 1;
    const c = D.world().countries[cid - 1];
    const setHappy = (v) => { for (const pid of c.provinces) { A.resHappy[pid] = { v: v, target: v, drivers: null }; } };
    const cen = D.ensureCentral(cid);
    const q = AI.quirkOf(cid);
    const qSave = Object.assign({}, q);

    /* 手紧（0.8）：阈值 64，中央金 90 → 该升回常规 */
    q.tax = 0.8; D.setTax(cid, 0); setHappy(60); cen.gold = 90;
    const r1 = AI.tax(cid, 'econ');
    ok('5 手紧的经营：中央金 90 > 80×0.8=64 → 升回常规', r1 && D.taxrate[cid] === 1, '税率 ' + D.taxrate[cid]);

    /* 手松（1.2）：阈值 96，中央金 90 → 还不到，不动 */
    q.tax = 1.2; D.setTax(cid, 0); setHappy(60); cen.gold = 90;
    const r2 = AI.tax(cid, 'econ');
    ok('5 手松的经营：中央金 90 < 80×1.2=96 → 不升（手松就是能忍）',
      !r2 && D.taxrate[cid] === 0, '税率 ' + D.taxrate[cid]);

    /* 经营永不横征：常规档、国库见底也不动 */
    q.tax = 1; D.setTax(cid, 1); setHappy(60); cen.gold = 0;
    AI.tax(cid, 'econ'); AI.tax(cid, 'balanced');
    ok('5 经营/均衡永不主动横征暴敛', D.taxrate[cid] <= 1, '税率 ' + D.taxrate[cid]);

    /* 军国手紧（0.83）：阈值 25，中央金 40 < 25 不成立 → 不动 */
    q.tax = 0.83; D.setTax(cid, 0); setHappy(60); cen.gold = 40;
    AI.tax(cid, 'mil');
    ok('5 手紧的军国：中央金 40 > 30×0.83=25 → 先不加税', D.taxrate[cid] === 0, '税率 ' + D.taxrate[cid]);

    /* 军国手松（1.5）：阈值 45，中央金 40 < 45 → 拉满 */
    q.tax = 1.5; D.setTax(cid, 0); setHappy(60); cen.gold = 40;
    AI.tax(cid, 'mil');
    ok('5 手松的军国：中央金 40 < 30×1.5=45 → 拉满档', D.taxrate[cid] === 2, '税率 ' + D.taxrate[cid]);

    /* 民心低 → 降一档保命（军国 35 线） */
    q.tax = 1; D.setTax(cid, 2); setHappy(30); cen.gold = 40;
    AI.tax(cid, 'mil');
    ok('5 民心跌破 35 → 军国降一档', D.taxrate[cid] === 1, '税率 ' + D.taxrate[cid]);

    Object.assign(q, qSave);
    D.setTax(cid, 1);
    return o;
  }));

  /* ---------------- 5b) 研究偏科（researchBias 消费） ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const cid = window.__PL + 1 <= D.world().countries.length ? window.__PL + 1 : 1;
    const R = A.resResearch[cid];
    const q = AI.quirkOf(cid), qSave = Object.assign({}, q);
    const cen = D.ensureCentral(cid);
    R.unlocked = true; R.cur = null; R.pts = 999; R.done = {};
    R.queue = [];
    cen.gold = 999; cen.iron = 999; cen.timber = 999; cen.grain = 999;

    /* 自己算一遍"最便宜的两条"（和 tryResearch 的过滤条件一致），
     * 免得靠"跑一次看结果"去猜 —— 那样猜到的可能是第一名。 */
    const pool = A.TECHS.filter(t => !R.done[t.key] && (!t.req || R.done[t.req]) && R.pts >= t.pts)
      .sort((a, b) => a.pts - b.pts);
    const second = pool[1].key, first = pool[0].key;
    const trial = (rb) => {
      q.research = rb;
      let hit = 0;
      for (let i = 0; i < 80; i++) {
        R.queue = [];
        AI.research(cid);
        if (R.queue[0] === second) hit++;
      }
      return hit;
    };
    const hi = trial(1.99), lo = trial(0.01);
    ok('5 研究偏科：偏执高的国更常挑"两条里贵的那条"', hi > lo * 3 + 3,
      '偏执1.99 选中 ' + hi + '/80 · 偏执0.01 选中 ' + lo + '/80（前两条 ' + first + ' / ' + second + '）');
    ok('5 偏执极低时几乎只捡便宜的', lo <= 3, lo + '/80');

    Object.assign(q, qSave);
    R.queue = []; R.cur = null; R.done = {};
    return o;
  }));

  /* ---------------- 2) 工厂 / 大学：教育到位后自发 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const c = w.countries.filter(x => x.id !== window.__PL && x.provinces.length >= 4)[0];
    const cid = c.id;
    AI.setPersona(cid, 'econ');
    /* 先停掉这一国身上的所有战争：v11 起"战时建造只留军备类"（兵营/军械坊/熔旧坊），
     * 民用全停 —— 这条用例检验的是"和平时期教育到位会不会盖大学/工厂"，
     * 所以前提得是和平。不停战的话，前面挂机的 30 回合里 AI 已经打起来了。 */
    AI.warsOf(cid).forEach(foe => { if (D.atWar(cid, foe)) D.makePeace(cid, foe); });
    AI.warEcon(cid, 'econ');                        // 让换挡状态跟上（停战恢复）
    A.resTalent[cid].total = 65;                    // 教育跨过大学（60）与工厂（15）
    const cen = D.ensureCentral(cid);
    cen.gold = 4000; cen.timber = 4000; cen.iron = 4000; cen.grain = 4000;
    /* 学校/市场/建造坊/粮仓都先铺满（否则 econ 会一直卡在前面几项上） */
    for (const pid of c.provinces) {
      [A.resSchool, A.resMarket, A.resBuilder, A.resGranary].forEach(T => {
        if (!T[pid]) T[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null };
        T[pid].n = Math.max(1, T[pid].n || 0);
      });
    }
    const built = AI.build(cid, 'econ');
    let uni = 0;
    for (const pid of c.provinces) if (A.resUniversity[pid]) uni += A.resUniversity[pid].n + A.resUniversity[pid].site;
    ok('2 教育 65 → AI 自发盖大学', built && uni > 0, '大学 已建+在建 = ' + uni);

    /* 再补一座军械坊 → 工厂（要求本省有军械坊） */
    const armPid = c.provinces[0];
    if (!A.resMil.armory[armPid]) A.resMil.armory[armPid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null };
    A.resMil.armory[armPid].n = 1;
    /* 大学已开工的省不挡工厂，但 econ 表里大学在工厂前面 —— 把它铺满 */
    for (const pid of c.provinces) {
      if (!A.resUniversity[pid]) A.resUniversity[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      if (!(A.resUniversity[pid].site > 0)) A.resUniversity[pid].n = Math.max(1, A.resUniversity[pid].n || 0);
    }
    const built2 = AI.build(cid, 'econ');
    let fac = 0;
    for (const pid of c.provinces) if (A.resFactory[pid]) fac += A.resFactory[pid].n + A.resFactory[pid].site;
    ok('2 有军械坊 + 教育 65 → AI 自发盖工厂', built2 && fac > 0, '工厂 已建+在建 = ' + fac);
    return o;
  }));

  /* ---------------- 6) 性格可见：情报三档 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const cid = window.__PL + 1 <= D.world().countries.length ? window.__PL + 1 : 1;
    const cn = AI.personaCn(AI.personaOf(cid));
    const v0 = AI.view(cid, 0), v1 = AI.view(cid, 1), v2 = AI.view(cid, 2);
    ok('6 0 档 → ？？', v0.known === false && v0.text === '？？', v0.text);
    ok('6 1 档 → 只有性格词', v1.known === true && v1.text === cn, v1.text);
    ok('6 2 档 → 性格 + 怪癖', v2.known === true && v2.text.indexOf(cn) === 0 && v2.text.indexOf(' · ') > 0,
      v2.text);
    ok('6 2 档 title 给三项明细', /建设狂热/.test(v2.title) && /科研偏执/.test(v2.title));

    /* 国卡外交节：三档各渲染一次 */
    const tier = (n) => {
      D.fogBudget[D.player()] = n;
      D.showCountry(cid);
      const el = document.getElementById('cDiplo');
      const row = el && Array.prototype.slice.call(el.querySelectorAll('.gvrow'))
        .filter(x => (x.querySelector('span') || {}).textContent === '性格')[0];
      return row ? row.querySelector('em').textContent : '(没这一行)';
    };
    const t0 = tier(0), t1 = tier(1), t2 = tier(2);
    ok('6 国卡 0 档显示 ？？', t0 === '？？', t0);
    ok('6 国卡 1 档显示性格词', t1 === cn, t1);
    ok('6 国卡 2 档显示性格+怪癖', t2.indexOf(cn) === 0 && t2.indexOf(' · ') > 0, t2);
    D.fogBudget[D.player()] = 1;
    return o;
  }));

  /* 截图：国卡性格行（2 档） */
  await page.evaluate(() => {
    const A = window.AO, D = A.resDebug;
    const cid = window.__PL + 1 <= D.world().countries.length ? window.__PL + 1 : 1;
    D.fogBudget[D.player()] = 2;
    D.showCountry(cid);
  });
  await sleep(400);
  const cbox = await page.evaluate(() => {
    const r = document.getElementById('country').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 900) };
  });
  await page.screenshot({ path: shot('ai-persona-card.png'), clip: cbox });

  /* ---------------- 8) 贪墨撤换 + 存档往返 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, AI = A.aiDebug, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const w = D.world();
    const c = w.countries.filter(x => x.id !== window.__PL)[0];
    const pid = c.provinces[0];
    /* 塞一位贪墨官（上任 1 回合内），连试几次必然被撤 */
    A.resOfficial[pid] = { id: 90001, name: '贪墨试', traitKey: 'greedy', owed: 0, at: D.turn() };
    let fired = false;
    for (let i = 0; i < 30 && !fired; i++) {
      AI.officers(c.id, 'econ');
      if (!A.resOfficial[pid]) fired = true;
    }
    ok('8 贪墨官被 AI 自己撤换', fired, fired ? '撤了' : '还在');

    /* 存档：性格 + 怪癖都在 payload.AI 里 */
    D.save(true);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(A.SAVE_KEY)); } catch (e) { /* file:// 禁 ls */ }
    ok('8 存档里有 AI 块（p 性格 / q 怪癖）',
      !!raw && !!raw.AI && !!raw.AI.p && !!raw.AI.q,
      raw && raw.AI ? Object.keys(raw.AI.p).length + ' 国性格 / ' + Object.keys(raw.AI.q).length + ' 国怪癖' : '无档');
    ok('8 存档版本号没升（只加字段）', !!raw && raw.v === A.SAVE_VER, raw && raw.v);

    /* 直接过一遍 JSON：改掉内存再 load 回来 */
    const snap = JSON.parse(JSON.stringify(A.aiEconSave()));
    const cid = c.id, p0 = AI.personaOf(cid), q0 = Object.assign({}, AI.quirkOf(cid));
    AI.setPersona(cid, p0 === 'mil' ? 'econ' : 'mil');
    AI.quirk[cid] = { build: 1, tax: 1, research: 1, war: 1 };
    A.aiEconLoad(snap);
    ok('8 性格随档往返', AI.personaOf(cid) === p0, p0 + ' → ' + AI.personaOf(cid));
    ok('8 怪癖随档往返',
      Math.abs(AI.quirkOf(cid).build - q0.build) < 1e-6 &&
      Math.abs(AI.quirkOf(cid).tax - q0.tax) < 1e-6,
      JSON.stringify(AI.quirkOf(cid)));

    /* 上一版的扁平格式（{ cid: 'econ' }）也要读得进 */
    A.aiEconLoad({ '3': 'mil', '4': 'econ' });
    ok('8 读上一版扁平档（性格照读、怪癖留空重掷）',
      AI.personaOf(3) === 'mil' && AI.personaOf(4) === 'econ' &&
      Object.keys(AI.quirk).length === 0,
      '性格 ' + AI.personaOf(3) + '/' + AI.personaOf(4) + ' · 怪癖表 ' + Object.keys(AI.quirk).length + ' 条');
    const qq = AI.quirkOf(3);
    ok('8 读旧档后怪癖按 seed 补上（仍在 0.8~1.2）',
      qq.build >= 0.8 - 1e-9 && qq.build <= 1.2 + 1e-9, JSON.stringify(qq));
    ok('8 老档（AI = undefined）不炸', (() => { try { A.aiEconLoad(undefined); return true; } catch (e) { return false; } })());
    return o;
  }));

  /* ---------------- 汇总 ---------------- */
  for (const c of out) {
    console.log((c.ok ? '  PASS  ' : '> FAIL <') + '  ' + c.name + '  —  ' + c.detail);
  }
  const pass = out.every(c => c.ok) && !errors.length;
  if (errors.length) console.log('\n运行时错误：\n' + errors.join('\n'));
  console.log('\n总体:', pass ? '全部通过' : '存在失败项');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
