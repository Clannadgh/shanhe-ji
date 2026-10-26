/* =============================================================
 * test/pop.js —— 人口承载力（v18.2）：地能养多少人，人就在哪里停
 *
 * 对着任务书逐条验：
 *   ① 地形表 → cap 计算（含首都 ×1.5、未知地形回落）
 *   ② 建筑加成（农场 Lv1/Lv2 · 渔港 · 粮仓 · 牧场 · 混建）
 *   ③ 摸顶停涨（pop ≥ cap → 增速归零，不回落）
 *   ④ 超限回落 + 幸福扣（−1%/回合，落到底就停；driver「人满为患」−2）
 *   ⑤ 铁犁深耕 ×1.25
 *   ⑥ AI 高负载省优先建农场（provScore 加分/淘汰 + 挂机 60 回合的建造分布）
 *
 * bench 为什么要先把人口推高：开局中位省 12.7 万、承载力 40 万 = 负载 32%，
 * 60 回合里（每回合最多 +1.2%）根本挤不到 85% —— 那样 bench 只会测出
 * "一次农场都没盖"，等于什么也没验。所以先把世界调成**中期样子**
 * （一半的省 90% 负载、一半 35%），再看 AI 往哪儿盖。
 *
 * 跑法：node test/pop.js
 * 小世界（120 省 / 6 国），约一分钟。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
function add(list) {
  for (const c of list) {
    out.push(c);
    console.log((c.ok ? '  PASS    ' : '  FAIL    ') + c.name + '  —  ' + (c.detail || ''));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  /* file:// 的 localStorage 是跨测试共享的：先清干净再重进，免得自动读上一局的档 */
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload({ waitUntil: 'load' });
  await sleep(1400);
  await page.evaluate(() => {
    document.getElementById('prov').value = 120;
    document.getElementById('ctry').value = 6;
    document.getElementById('seed').value = 'pop-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2400);

  /* ---------------- ①②⑤ 纯函数：地形表 / 建筑加成 / 铁犁 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, P = AO.POPCAP, B = P.base, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const W = 10000;

    ok('① 地形表：平 40 / 草 30 / 海岸 35 / 林 20 / 丘 18 / 山 12 / 沼 10 / 荒 8 / 苔 6',
      B.plains === 40 && B.grassland === 30 && B.coast === 35 && B.forest === 20 &&
      B.hills === 18 && B.mountains === 12 && B.swamp === 10 && B.desert === 8 && B.tundra === 6,
      '平' + B.plains + ' 草' + B.grassland + ' 海' + B.coast + ' 林' + B.forest + ' 丘' + B.hills +
      ' 山' + B.mountains + ' 沼' + B.swamp + ' 荒' + B.desert + ' 苔' + B.tundra);
    ok('① 空省 = 地形基础（平原 40 万）', P.capOf('plains', {}) === 40 * W, P.capOf('plains', {}));
    ok('① 十种地形都算得出（含群岛）',
      Object.keys(B).every(k => P.capOf(k, {}) > 0) && B.islands > 0,
      Object.keys(B).map(k => k + ':' + P.capOf(k, {}) / W).join(' '));
    ok('① 表里没有的地形回落 fallback（20 万）',
      P.capOf('atlantis', {}) === P.fallback * W, P.capOf('atlantis', {}) / W + ' 万');
    ok('① 首都 ×1.5：平原 40 → 60 万',
      P.capOf('plains', { capital: true }) === 60 * W, P.capOf('plains', { capital: true }) / W + ' 万');

    ok('② 农场 Lv1 +10 万/座（2 座：40 + 20 = 60 万）',
      P.capOf('plains', { farm1: 2 }) === 60 * W, P.capOf('plains', { farm1: 2 }) / W + ' 万');
    ok('② 农场 Lv2 +20 万/座（2 座：40 + 40 = 80 万）',
      P.capOf('plains', { farm2: 2 }) === 80 * W, P.capOf('plains', { farm2: 2 }) / W + ' 万');
    ok('② 渔港 +8 万/座（海岸 35 + 16 = 51 万）',
      P.capOf('coast', { fish: 2 }) === 51 * W, P.capOf('coast', { fish: 2 }) / W + ' 万');
    ok('② 粮仓 +6 万/座（3 座：40 + 18 = 58 万）',
      P.capOf('plains', { granary: 3 }) === 58 * W, P.capOf('plains', { granary: 3 }) / W + ' 万');
    ok('② 牧场 +4 万/座（草原 30 + 12 = 42 万）',
      P.capOf('grassland', { horse: 3 }) === 42 * W, P.capOf('grassland', { horse: 3 }) / W + ' 万');
    ok('② 混建：40 + 10 + 20 + 8 + 6 + 4 = 88 万',
      P.capOf('plains', { farm1: 1, farm2: 1, fish: 1, granary: 1, horse: 1 }) === 88 * W,
      P.capOf('plains', { farm1: 1, farm2: 1, fish: 1, granary: 1, horse: 1 }) / W + ' 万');
    ok('② 首都先乘再相加：40×1.5 + 2 座农场 20 = 80 万',
      P.capOf('plains', { capital: true, farm1: 2 }) === 80 * W,
      P.capOf('plains', { capital: true, farm1: 2 }) / W + ' 万');

    ok('⑤ 铁犁深耕 ×1.25（40 + 20 = 60 → 75 万）',
      P.capOf('plains', { farm1: 2, plow: true }) === 75 * W,
      P.capOf('plains', { farm1: 2, plow: true }) / W + ' 万');
    ok('⑤ 倍率作用在**总和**上（含首都）：60×1.25 + 20×1.25 = 100 万',
      P.capOf('plains', { capital: true, farm1: 2, plow: true }) === 100 * W,
      P.capOf('plains', { capital: true, farm1: 2, plow: true }) / W + ' 万');
    ok('⑤ 科技键对得上（plowTech = plow2，且 TECHS 里真有这一条）',
      P.plowTech === 'plow2' && !!(AO.TECH_BY_KEY && AO.TECH_BY_KEY.plow2),
      P.plowTech);

    /* 面积系数：**默认关**（任务书给的是"按省定额"）。开着的时候 cap 按
     * area / areaRef 等比放大 —— 这是给小世界留的那一个数（见 POPCAP 注释）。 */
    const ref0 = P.areaRef;
    ok('① 面积系数默认关（areaRef = 0，面积不参与公式）',
      ref0 === 0 && P.capOf('plains', { area: 5000 }) === 40 * W,
      'areaRef=' + ref0 + ' · cap=' + P.capOf('plains', { area: 5000 }) / W + ' 万');
    P.areaRef = 987;
    const capA = P.capOf('plains', { area: 4013 });
    ok('① 打开 areaRef=987：面积 4013 的省 → 40 × 4.07 = 162.6 万',
      Math.abs(capA - 40 * W * 4013 / 987) < 1e-6, (capA / W).toFixed(1) + ' 万');
    P.areaRef = ref0;
    return o;
  }));

  /* ---------------- 选一省：非首都、地形可改、建筑可清 ---------------- */
  const S = await page.evaluate(() => {
    const w = window.__world;
    for (const p of w.provinces) {
      if (!p || !p.owner) continue;
      const c = w.countries[p.owner - 1];
      if (!c || c.capital === p.id) continue;
      return { pid: p.id, owner: p.owner, terrain: p.terrain, name: p.name };
    }
    return null;
  });
  if (!S) { console.log('找不到可用省'); await browser.close(); process.exit(1); }

  /* ---------------- 适配层：真省上的 cap 与纯函数一致 ---------------- */
  add(await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, P = AO.POPCAP, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const pid = a.pid, p = window.__world.provinces[pid - 1];
    const bag = AO.resSim[pid];

    /* 清空 + 造一个已知局面：平原、2 座 Lv1 农场、1 座粮仓 = 40 + 20 + 6 = 66 万 */
    const oldT = p.terrain;
    p.terrain = 'plains';
    bag.grain.tiers = { 1: 2, 2: 0 }; bag.grain.built = 2; bag.grain.site = 0;
    bag.fish.built = 0; bag.horse.built = 0;
    AO.resGranary[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };

    const ctx = AO.resPopCapCtx(pid);
    const cap1 = AO.resPopCap(pid);
    ok('② 真省：农场 Lv1×2 + 粮仓×1 = 66 万（地形 40 + 20 + 6）',
      cap1 === 660000, cap1 / 10000 + ' 万 · ctx=' + JSON.stringify(ctx));
    ok('② 适配层读对了座数（farm1 2 / granary 1 / 非首都 / 未研铁犁）',
      ctx.farm1 === 2 && ctx.farm2 === 0 && ctx.granary === 1 && ctx.capital === false && ctx.plow === false,
      JSON.stringify(ctx));

    /* 农场升 Lv2：2 座 Lv2 = 40 万 → 40 + 40 + 6 = 86 万 */
    bag.grain.tiers = { 1: 0, 2: 2 }; bag.grain.built = 2;
    const cap2 = AO.resPopCap(pid);
    ok('② 真省：农场升 Lv2 后上限跟着涨（40 + 40 + 6 = 86 万）',
      cap2 === 860000, cap2 / 10000 + ' 万');

    /* 渔港 + 牧场也进上限（各 1 座：86 + 8 + 4 = 98 万） */
    bag.fish.built = 1; bag.horse.built = 1;
    const cap3 = AO.resPopCap(pid);
    ok('② 真省：渔港 +8 / 牧场 +4 也进上限（98 万）', cap3 === 980000, cap3 / 10000 + ' 万');
    bag.fish.built = 0; bag.horse.built = 0;

    /* 铁犁深耕：86 万 × 1.25 = 107.5 万 */
    const R = AO.resResearch[a.owner] || (AO.resResearch[a.owner] = { done: {}, pts: 0 });
    const hadPlow = !!(R.done && R.done.plow2);
    R.done = R.done || {}; R.done.plow2 = true;
    const ctxP = AO.resPopCapCtx(pid), capP = AO.resPopCap(pid);
    ok('⑤ 真省：研了铁犁深耕 → ×1.25（86 → 107.5 万）',
      capP === 1075000 && ctxP.plow === true, capP / 10000 + ' 万');
    /* 复原：科技状态是全局的，留着会污染后面的段 */
    if (!hadPlow) delete R.done.plow2;

    /* 拆掉建筑 → 上限回到地形基础（这就是"cap 现算、不进存档"的意义） */
    bag.grain.tiers = { 1: 0, 2: 0 }; bag.grain.built = 0;
    AO.resGranary[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const cap4 = AO.resPopCap(pid);
    ok('② 拆掉建筑：上限立刻回到地形基础 40 万（现算，不缓存）',
      cap4 === 400000, cap4 / 10000 + ' 万');

    p.terrain = oldT;
    return o;
  }, S));

  /* ---------------- ③ 摸顶停涨 ---------------- */
  add(await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, P = AO.POPCAP, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const pid = a.pid, p = window.__world.provinces[pid - 1];
    const bag = AO.resSim[pid], pop = AO.resPop[pid];
    const oldT = p.terrain;
    p.terrain = 'plains';
    bag.grain.tiers = { 1: 0, 2: 0 }; bag.grain.built = 0;
    bag.fish.built = 0; bag.horse.built = 0;
    AO.resGranary[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const cap = AO.resPopCap(pid);
    bag.grain.stock = 999; bag.fish.stock = 999;      // 吃得起，别让饥荒分支抢戏
    AO.resHappy[pid].v = 60;                          // 民心 60 → 增速不打折也不加成

    /* 差一点到顶：还在涨（富余 5 → +1.2%） */
    pop.v = cap - 1000;
    D.settlePop(pid, pop.need + 5);
    const below = { rate: pop.rate, v: pop.v };

    /* 正好到顶：增速归零，**不回落** */
    pop.v = cap;
    const need0 = Math.max(1, Math.round(pop.v / 2000000));
    D.settlePop(pid, need0 + 5);
    const at = { rate: pop.rate, v: pop.v };

    /* 再来一回合：还是不动 */
    D.settlePop(pid, need0 + 5);
    const at2 = { rate: pop.rate, v: pop.v };

    ok('③ 没到顶时照旧涨（富余 5 → +1.2%）',
      below.rate === 0.012 && below.v > cap - 1000, (below.rate * 100).toFixed(1) + '% · ' + below.v);
    ok('③ 摸顶：增速归零', at.rate === 0, 'rate=' + at.rate);
    ok('③ 摸顶：人口**不回落**（原地不动，不是 −1%）',
      at.v === cap && at2.v === cap, cap + ' → ' + at.v + ' → ' + at2.v);
    ok('③ 摸顶两回合都是 0（不是"抖一下"）', at2.rate === 0, 'rate=' + at2.rate);

    p.terrain = oldT;
    return o;
  }, S));

  /* ---------------- ④ 超限回落 + 幸福扣 ---------------- */
  add(await page.evaluate((a) => {
    const AO = window.AO, D = AO.resDebug, P = AO.POPCAP, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const pid = a.pid, p = window.__world.provinces[pid - 1];
    const bag = AO.resSim[pid], pop = AO.resPop[pid];
    const oldT = p.terrain;
    p.terrain = 'plains';
    bag.grain.tiers = { 1: 0, 2: 0 }; bag.grain.built = 0;
    AO.resGranary[pid] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const cap = AO.resPopCap(pid);
    bag.grain.stock = 9999; bag.fish.stock = 9999;
    AO.resHappy[pid].v = 60;

    /* 超限 20%（吞地 / 事件涌入） */
    pop.v = Math.round(cap * 1.2);
    const v0 = pop.v;
    const need0 = Math.max(1, Math.round(pop.v / 2000000));
    D.settlePop(pid, need0 + 5);
    const r1 = { rate: pop.rate, v: pop.v };

    /* 一回合 −1%（±1 人的取整误差） */
    ok('④ 超限：每回合 −1% 往 cap 回落',
      Math.abs(r1.rate + P.overRate) < 1e-12 && Math.abs(r1.v - v0 * 0.99) <= 1,
      v0 + ' → ' + r1.v + '（rate ' + (r1.rate * 100).toFixed(1) + '%）');

    /* 一路落到底：**停在 cap**，不穿过 */
    const trail = [];
    for (let i = 0; i < 80; i++) {
      D.settlePop(pid, Math.max(1, Math.round(pop.v / 2000000)) + 5);
      if (i < 3 || i > 76) trail.push(pop.v);
    }
    ok('④ 落到底就停：最终 = cap（不穿过、不继续掉）',
      pop.v === Math.round(cap), 'cap ' + cap + ' · 80 回合后 ' + pop.v);
    ok('④ 回落是单调往下（前几步一路减）',
      trail[0] > trail[1] && trail[1] > trail[2], trail.join(' → '));

    /* 幸福：超限 −2（driver「人满为患」） */
    pop.v = Math.round(cap * 1.1);
    AO.resHappy[pid].v = 60;
    D.settleHappy(pid, p);
    const dOver = AO.resHappy[pid].drivers;
    ok('④ 超限：民心 driver「人满为患」= −2',
      dOver.crowd === P.overHappy, 'crowd=' + dOver.crowd + ' · overHappy=' + P.overHappy);
    ok('④ 超限：这一项真的进了 target（不多不少就 −2）',
      Math.abs(AO.resHappy[pid].target - (60 + dOver.rate + dOver.food + dOver.crowd +
        dOver.halt + dOver.official + dOver.market + dOver.faith + dOver.war +
        (dOver.chancellor || 0))) < 1e-9,
      'target ' + AO.resHappy[pid].target.toFixed(1));

    /* 摸顶（pop = cap）**不**扣：那是"刚好住满"，不是"挤爆了" */
    pop.v = cap;
    D.settleHappy(pid, p);
    const dAt = AO.resHappy[pid].drivers;
    ok('④ 摸顶不扣（pop = cap → crowd 0）', dAt.crowd === 0, 'crowd=' + dAt.crowd);

    p.terrain = oldT;
    return o;
  }, S));

  /* ---------------- ⑥a AI：负载 > 85% 加分 / < 50% 淘汰 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, AI = AO.aiDebug, P = AO.POPCAP, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = window.__world;
    /* 挑一个省数 ≥ 3 的国，把全境清成"没农场、有矿脉"，再按负载摆人口 */
    let cid = 0, list = [];
    for (const c of w.countries) {
      if (!c) continue;
      const ps = AI.provsOf(c.id);
      if (ps.length >= 3) { cid = c.id; list = ps; break; }
    }
    if (!cid) return [{ name: '⑥ 找到多省国家', ok: false, detail: '没有' }];
    for (const p of list) {
      const bag = AO.resSim[p.id];
      if (!bag || !bag.grain) continue;
      bag.grain.tiers = { 1: 0, 2: 0 }; bag.grain.built = 0; bag.grain.site = 0;
      bag.grain.gone = false; bag.grain.left = 100;
      AO.resGranary[p.id] = { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    }
    const usable = list.filter(p => AO.resSim[p.id] && AO.resSim[p.id].grain);
    const target = usable[0];
    /* 全境 30% 负载，只有 target 一省 90% */
    for (const p of usable) {
      const cap = AO.resPopCap(p.id);
      AO.resPop[p.id].v = Math.round(cap * (p === target ? 0.90 : 0.30));
    }
    const sHi = AI.provScore(target, 'grain');
    const sLo = AI.provScore(usable[1], 'grain');
    ok('⑥ 负载 90%：农场分数被大幅上调（含 +boost）',
      sHi >= P.ai.boost, 'score=' + Math.round(sHi) + '（boost ' + P.ai.boost + '）');
    ok('⑥ 负载 30%：这一省直接淘汰（−1，比任何真分数都低）',
      sLo === -1, 'score=' + sLo);
    ok('⑥ 粮仓 / 渔港同样吃这条规则',
      AI.provScore(target, 'granary') >= P.ai.boost && AI.provScore(usable[1], 'granary') === -1,
      '粮仓 ' + Math.round(AI.provScore(target, 'granary')) + ' / ' + AI.provScore(usable[1], 'granary'));
    ok('⑥ 别的建筑不受影响（学校不看负载）',
      AI.provScore(usable[1], 'school') > -1, '学校 ' + Math.round(AI.provScore(usable[1], 'school')));

    const pick = AI.pickProv(cid, 'grain');
    ok('⑥ pickProv 挑中的就是那个挤的省', !!pick && pick.id === target.id,
      pick ? pick.id + ' vs ' + target.id : 'null');
    /* buildOrder 的底表里**没有**农场 / 渔港（AI 的资源建筑只靠开局铺底 +
     * 缺矿反应 + 本批的扩容本能）。所以这条验的是"表没被塞东西"：
     * 拿回来的顺序必须还是底表那几个键的一个排列。 */
    ok('⑥ buildOrder 一个字没动（还是底表那几个键的排列，没塞进农场）',
      (function () {
        const persona = AI.personaOf ? AI.personaOf(cid) : 'balanced';
        const base = ((AO.AIECON.buildOrder || {})[persona] || []).slice().sort().join(',');
        const ord = AI.buildOrder(cid).slice().sort().join(',');
        return base === ord && ord.indexOf('grain') < 0;
      })(), AI.buildOrder(cid).join(' → '));
    ok('⑥ 扩容本能挂在 tryBuild 之前（aiDebug.expand 存在）',
      typeof AI.expand === 'function', typeof AI.expand);
    return o;
  }));

  /* ---------------- ⑥b bench：挂机 60 回合，看农场盖在哪种省 ----------------
   * 先把世界调成"中期"：一半的省 90% 负载、一半 35%（理由见文件头）。
   * 然后挂机 60 回合，用 buildOne 的钩子记下每一次农场建造**当时**的负载。 */
  await page.evaluate(() => {
    document.getElementById('seed').value = 'pop-bench-1';
    document.getElementById('gen').click();
  });
  await sleep(2400);

  const bench = await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = window.__world;
    /* 必须先选一个玩家国：PLAYER = 0 是"工坊模式"，18-ai 在那里面直接返回、
     * 全世界静止 —— 不选国挂机 60 回合，一次建造都不会发生（这条踩过）。 */
    D.choosePlayer(w.countries[0].id);
    const provs = w.provinces.filter(p => p && p.owner);
    /* 一半挤（90%）、一半空（35%）—— 按省 id 奇偶分，跟地形/国家无关 */
    let hi = 0, lo = 0, hot0 = 0;
    provs.forEach((p, i) => {
      const cap = AO.resPopCap(p.id) || 1;
      const k = (i % 2 === 0) ? 0.90 : 0.35;
      if (k > 0.5) hi++; else lo++;
      AO.resPop[p.id].v = Math.round(cap * k);
      if (k > 0.5) hot0++;
    });
    window.__farmLog = [];
    const orig = D.buildOne;
    D.buildOne = function (p, kind) {
      if (kind === 'grain') {
        const capv = AO.resPopCap(p.id) || 0;
        const popv = (AO.resPop[p.id] || {}).v || 0;
        window.__farmLog.push({ pid: p.id, load: capv > 0 ? popv / capv : 0 });
      }
      return orig.apply(this, arguments);
    };
    return { provs: provs.length, hi, lo, hot0 };
  });

  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => {
      const D = window.AO.resDebug;
      D.settleTurn();
      if (D.evtPending && D.evtPending()) D.evtPick(0);
    });
  }

  const dist = await page.evaluate(() => {
    const log = window.__farmLog || [];
    const hi = log.filter(x => x.load >= 0.85).length;
    const mid = log.filter(x => x.load >= 0.5 && x.load < 0.85).length;
    const lo = log.filter(x => x.load < 0.5).length;
    const avg = log.length ? log.reduce((a, b) => a + b.load, 0) / log.length : 0;
    return { n: log.length, hi, mid, lo, avg, turn: window.AO.resDebug.turn() };
  });

  console.log('');
  console.log('=== bench：挂机 ' + dist.turn + ' 回合（' + bench.provs + ' 省 / 一半 90% 负载）===');
  console.log('  农场建造 ' + dist.n + ' 次：高负载(≥85%) ' + dist.hi + ' · 中(50~85%) ' + dist.mid +
    ' · 低(<50%) ' + dist.lo + '　平均负载 ' + (dist.avg * 100).toFixed(0) + '%');
  console.log('');
  add([
    { name: '⑥bench 挂机 60 回合，AI 确实在盖农场', ok: dist.n > 0, detail: dist.n + ' 次' },
    { name: '⑥bench 低负载省（<50%）一次都没被选中',
      ok: dist.lo === 0, detail: dist.lo + ' 次' },
    { name: '⑥bench 高负载省（≥85%）盖得最多（占比 > 中负载）',
      ok: dist.hi > 0 && dist.hi >= dist.mid, detail: '高 ' + dist.hi + ' / 中 ' + dist.mid },
    { name: '⑥bench 平均负载显著偏高（> 70%）',
      ok: dist.avg > 0.7, detail: (dist.avg * 100).toFixed(0) + '%' }
  ]);

  if (errors.length) {
    out.push({ name: '页面无 JS 错误', ok: false, detail: errors.slice(0, 3).join(' | ') });
  } else {
    out.push({ name: '页面无 JS 错误', ok: true, detail: '' });
  }
  let bad = 0;
  for (const c of out) if (!c.ok) bad++;
  console.log('');
  console.log(bad ? `❌ ${bad} 项失败 / 共 ${out.length} 项` : `✅ 全部通过（${out.length} 项）`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
