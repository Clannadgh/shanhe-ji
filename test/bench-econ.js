/* =============================================================
 * test/bench-econ.js —— 经济沙盒的**数值 bench**
 *
 * ★ 数值拍板就看这张表。★
 * 表里的每一个数都是当前占位数值（15-resources.js 定义区）跑出来的，
 * 改 rate / cost / per / maint / fx 之后重跑一次，对比两张表就知道
 * "这一改是让前 50 回合更好过还是更难过"。
 *
 * 跑法：node test/bench-econ.js
 *   固定 seed + 标准世界（520 省 / 36 国），跑 200 回合 × 四套策略：
 *     A  什么都不建（只吃开局铺的那点底子）—— 看"不作为"的基线
 *     B  每省铺满 学校 + 市场 + 建造坊     —— 看"全力铺通用设施"能不能撑住
 *     C  只铺学校                        —— 看"只冲科技、不管钱"的后果
 *     D  只铺学校 + 税率拉满 + 每国产两官派大省 —— 看治理层的极限（税最多、民心最差）
 *   每 10 回合记录：停产建筑数 / 中央七种资源结余 / 科研点 / 解锁国数 /
 *   全国总产出 / **省库金均值 / 国民幸福度均值 / 在任官员数** / 这一档里新完成的科技；
 *   最后单列一张"各科技完成回合号"。
 *
 * 为什么 D 也要铺学校：人才点只从学校来（每座 0.5/回合），
 * 不铺学校就永远抽不到官 —— 那条策略会退化成"只把税率拉满"，
 * 测不出官员对经济的影响。
 *
 * 为什么用 DOM 驱动而不是 node 直跑：模拟层（11-ui.js）活在浏览器里，
 * 没有 node 直跑路径（见 test/sim-res.js 的说明）。这里只是把点击换成
 * AO.resDebug 里的钩子，结算逻辑一行都没改。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SEED = 'bench-econ-1';
const PROV = 520, CTRY = 36;
const TURNS = 200, STEP = 10;

/* 显示宽度：CJK / 全角算 2 列，其余算 1 列 —— 中文表头不对齐会很难读 */
function dw(s) {
  let n = 0;
  for (const ch of String(s)) n += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return n;
}
function pad(s, w, right) {
  s = String(s);
  const gap = Math.max(0, w - dw(s));
  return right ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}
function row(cells, widths, rights) {
  return cells.map((c, i) => pad(c, widths[i], rights && rights[i])).join(' ');
}

const KEYS = ['iron', 'gold', 'grain', 'horse', 'timber', 'fish', 'salt'];
const SHORT = { iron: '铁', gold: '金', grain: '粮', horse: '畜', timber: '木', fish: '鱼', salt: '盐' };

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);

  /* 固定 seed + 标准世界 */
  await page.evaluate((s, pv, ct) => {
    document.getElementById('seed').value = s;
    document.getElementById('prov').value = pv;
    document.getElementById('ctry').value = ct;
    document.getElementById('provVal').textContent = pv;
    document.getElementById('ctryVal').textContent = ct;
  }, SEED, PROV, CTRY);

  async function regen() {
    await page.evaluate(() => document.getElementById('gen').click());
    for (let i = 0; i < 160; i++) {
      await sleep(70);
      const ok = await page.evaluate(() => !document.getElementById('gen').disabled && !!window.__world);
      if (ok) return;
    }
    throw new Error('生成超时');
  }

  /* 一回合：按策略铺设施 → 挑一条付得起的科技入队 → 结算。
   * 为什么研究也要"跑"：不然"各科技完成回合"这一栏永远是空的 ——
   * 沙盒里没有 AI，bench 得自己当一个"理智的玩家"。 */
  const runTurn = (strategy) => page.evaluate((strat) => {
    const D = window.AO.resDebug, w = window.__world;
    /* ---------------- 策略 G：全 AI 开内政（v7）----------------
     * 这一条**不替 AI 操作**：选一个玩家国进入游戏模式（PLAYER > 0 时
     * 18-ai.js 才会跑），剩下的国家全交给 AI 自己决定盖什么、研什么、怎么收税。
     * 性格在这里**均分**（轮流 econ / balanced / mil），不用 30/50/20 的生成权重 ——
     * bench 要的是"三组各有多少国、曲线差多少"，组内样本数不等会让均值白抖。 */
    if (strat === 'G') {
      if (!window.__benchAI) {
        D.choosePlayer(w.countries[0].id);
        const keys = window.AO.AIECON.personas.map(p => p.key);
        let i = 0;
        for (const c of w.countries) {
          if (!c || c.id === D.player()) continue;
          window.AO.aiDebug.setPersona(c.id, keys[i % keys.length]);
          i++;
        }
        window.__benchAI = { n: i };
      }
      D.settleTurn();
      return;                       // 科研由 AI 自己开，不走下面那段"替补玩家"
    }
    if (strat !== 'A') {
      const kinds = (strat === 'C' || strat === 'D') ? ['school'] : ['school', 'market', 'builder'];
      for (const p of w.provinces) {
        if (!p) continue;
        for (const k of kinds) {
          const st = (k === 'school' ? window.AO.resSchool : k === 'market' ? window.AO.resMarket : window.AO.resBuilder)[p.id];
          if (!st || st.site > 0 || st.n > 0) continue;
          if (k === 'school') D.buildSchool(p);
          else if (k === 'market') D.buildMarket(p);
          else D.buildBuilder(p);
        }
      }
    }
    /* 策略 D：税率拉满（横征暴敛）+ **每国两位官**派大省。
     * "两官"是硬上限（不是每回合补两位）：一个国十几省，每回合补两位
     * 几回合就全国都有官了，测出来的就不是"两官"而是"满编"。 */
    if (strat === 'D') {
      const G = window.AO.GOV;
      for (const c of w.countries) {
        D.setTax(c.id, 2);
        const T = window.AO.resTalent[c.id];
        if (!T) continue;
        const provs = c.provinces.map(id => w.provinces[id - 1]).filter(Boolean)
          .sort((a, b) => ((window.AO.resPop[b.id] || {}).v || 0) - ((window.AO.resPop[a.id] || {}).v || 0));
        let have = 0;
        for (const p of provs) if (D.official[p.id]) have++;
        if (have >= 2) continue;
        while (T.pool.length < 2 - have && T.pts >= G.examCost) D.exam(c.id);
        let placed = have;
        for (const p of provs) {
          if (!T.pool.length || placed >= 2) break;
          if (D.official[p.id]) continue;
          D.assign(p.id, T.pool[0].id);
          placed++;
        }
      }
    }
    /* ---------------- 策略 E：两国宣战，互征到 3 军对撞 ----------------
     * 这条策略不测经济（经济由 A~D 测），测的是**战争层的数值**：
     * 兵打光了要不要补、装备产能够不够、50 回合能啃下几个省。
     *
     * 为了让它能"一直打下去"，bench 做两件现实中玩家也要做的事：
     *   1) 给两国各盖一座兵营 + 军械坊（直接给料，不等生产链慢慢爬 ——
     *      那是经济 bench 的事，这里只关心战场）；
     *   2) 每回合往省库塞 4 件青铜兵器（相当于"后方的军械坊这一回合的产量"），
     *      让它够征、也够补阵亡的装备。
     * 兵数上限 3 支 × 4000 人：多了就是两团人互相磨，看不出曲线。 */
    if (strat === 'E') {
      const RW = window.AO.resWar;
      if (!window.__benchWar || !window.__benchWar.pair.length) {
        const c1 = w.countries[0];
        const foeId = (c1.neighbors || [])[0];
        const c2 = w.countries[foeId - 1];
        const pair = [c1.id, c2.id];
        const home = {};
        for (const cid of pair) {
          const c = w.countries[cid - 1];
          const pid = (c.capital && w.provinces[c.capital - 1].owner === cid) ? c.capital : c.provinces[0];
          home[cid] = pid;
          const p = w.provinces[pid - 1];
          const bag = window.AO.resSim[pid];
          bag.iron.built = 1; bag.iron.tiers[1] = 1;
          window.AO.resMil.barracks[pid] = Object.assign({}, window.AO.resMil.barracks[pid], { n: 1, site: 0 });
          window.AO.resMil.armory[pid] = Object.assign({}, window.AO.resMil.armory[pid], { n: 1, site: 0 });
          window.AO.resResearch[cid].done.mil_bronze = true;
          window.AO.resDebug.addItem(pid, 'bronze', 20);
          bag.gold.stock += 200;
        }
        const own = {};
        for (const p of w.provinces) if (p) own[p.id] = p.owner;
        window.__benchWar = { pair: pair, home: home, recruited: 0, wpnIn: 40, own: own };
        window.AO.resDebug.declareWar(pair[0], pair[1]);
      }
      const WB = window.__benchWar;
      for (const cid of WB.pair) {
        const pid = WB.home[cid];
        const p = w.provinces[pid - 1];
        /* 省被打下来了就换一个自己的省当征兵基地 */
        const base = (p && p.owner === cid) ? pid : (w.countries[cid - 1].provinces[0] || 0);
        if (!base) continue;
        const b2 = w.provinces[base - 1];
        const bag2 = window.AO.resSim[base];
        if (bag2 && bag2.gold) bag2.gold.stock += 30;
        window.AO.resDebug.addItem(base, 'bronze', 4);
        WB.wpnIn += 4;
        /* 补到 3 支（每回合最多征一支：和游戏里"一回合一支"的节奏一致） */
        const mine = window.AO.resDebug.armiesOf(cid).filter(a => a.type === 'army');
        if (mine.length < 3) {
          const bq = window.AO.resMil.barracks[base];
          if (!bq || !(bq.n > 0)) {
            window.AO.resMil.barracks[base] = Object.assign(
              { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null }, bq || {},
              { n: 1, site: 0, halted: false });
          }
          const r = window.AO.resDebug.recruit(base, 'inf');
          if (r.ok) WB.recruited += window.AO.RECRUIT.menPerUnit;
        }
        /* 命令：pair[0] 主动进攻（玩家），pair[1] 纯防守（= 游戏里敌国 AI 的行为）。
         * 两边都无脑对冲的话，双方老家都会空掉，打出来的曲线不代表任何一方。 */
        for (const a of window.AO.resDebug.armiesOf(cid)) {
          if (a.type !== 'army') continue;
          if (cid === WB.pair[1]) {
            if (!a.order || a.order.type !== 'defend') {
              window.AO.resDebug.setOrder(a.id, { type: 'defend', pid: a.pid, cid: cid, tactic: 'assault' });
            }
            continue;
          }
          const foCid = WB.pair[0] === cid ? WB.pair[1] : WB.pair[0];
          const foe = w.countries[foCid - 1];
          if (!foe || !foe.provinces.length) continue;
          const me = w.provinces[a.pid - 1];
          let best = 0, bd = Infinity;
          for (const q of foe.provinces) {
            const qp = w.provinces[q - 1];
            if (!qp) continue;
            const dx = qp.centroid[0] - me.centroid[0], dy = qp.centroid[1] - me.centroid[1];
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = qp.id; }
          }
          if (!best) continue;
          if (a.order && a.order.type === 'attack' && a.order.pid === best) continue;
          window.AO.resDebug.setOrder(a.id, { type: 'attack', pid: best, cid: foCid, tactic: 'assault' });
        }
      }
    }
    /* 空闲国家：按 TECHS 顺序挑第一条"前置已研 + 付得起"的科技入队 */
    for (const cid in window.AO.resResearch) {
      const R = window.AO.resResearch[cid];
      if (!R.unlocked || R.cur || R.queue.length) continue;
      const cen = window.AO.resCentral[cid];
      for (const t of window.AO.TECHS) {
        if (R.done[t.key]) continue;
        if (t.req && !R.done[t.req]) continue;
        if (R.pts < t.pts) continue;
        let ok = true;
        for (const k in t.cost) if ((cen[k] || 0) < t.cost[k]) { ok = false; break; }
        if (!ok) continue;
        D.startResearch(+cid, t.key);
        break;
      }
    }
    D.settleTurn();
    /* 每条科技"第一次被研出来"的回合号（逐回合记，精确到 1） */
    const turn = D.turn();
    /* 会战次数是**累计**：WARLOG 只留最近 80 条，直接数总数会随着老战报被挤掉而变少 */
    if (window.__benchWar) {
      const lg = window.AO.resWarLog ? window.AO.resWarLog() : window.AO.resWar.log;
      let n = 0;
      for (const e of lg) if (e.turn === turn && /⚔/.test(e.text)) n++;
      window.__benchWar.battles = (window.__benchWar.battles || 0) + n;
    }
    const doneAt = window.AO.__benchDoneAt;
    for (const cid in window.AO.resResearch) {
      const R = window.AO.resResearch[cid];
      for (const k in R.done) if (R.done[k] && doneAt[k] === undefined) doneAt[k] = turn;
    }
  }, strategy);

  /* 快照：全部只读，返回一个可序列化的小对象 */
  const snap = () => page.evaluate((keys) => {
    const w = window.__world;
    let halted = 0, built = 0, prod = 0;
    let goldSum = 0, goldN = 0, hSum = 0, hW = 0, offN = 0;
    const cen = {};
    keys.forEach(k => { cen[k] = 0; });
    for (const p of w.provinces) {
      if (!p) continue;
      const bag = window.AO.resSim[p.id];
      if (bag) {
        for (const k in bag) {
          const s = bag[k];
          if (s.built > 0) { built++; if (s.halted) halted++; }
        }
        if (bag.gold) { goldSum += bag.gold.stock; goldN++; }
      }
      /* 民心按人口加权（和面板顶栏同一个口径） */
      const h = window.AO.resHappy[p.id];
      const pw = (window.AO.resPop[p.id] || {}).v || 0;
      hSum += (h ? h.v : 60) * pw; hW += pw;
      if (window.AO.resOfficial[p.id]) offN++;
      ['school', 'market', 'builder'].forEach(kind => {
        const st = (kind === 'school' ? window.AO.resSchool : kind === 'market' ? window.AO.resMarket : window.AO.resBuilder)[p.id];
        if (st && st.n > 0) { built++; if (st.halted) halted++; }
      });
      const F = window.AO.resFlow[p.id];
      if (F) for (const k in F.gain) prod += F.gain[k];
    }
    let pts = 0, unlocked = 0;
    for (const cid in window.AO.resCentral) {
      keys.forEach(k => { cen[k] += window.AO.resCentral[cid][k] || 0; });
    }
    for (const cid in window.AO.resResearch) {
      const R = window.AO.resResearch[cid];
      pts += R.pts;
      if (R.unlocked) unlocked++;
    }
    /* --- 战争指标（策略 E 用；其余策略下全为 0，不影响原表） ---
     * 战损 = 累计征到的兵 − 现在还活着的兵（阵亡只从 POP 和兵数里扣，没有别的出口）
     * 装备消耗 = 投进去的军械 − 两国省库里还剩的军械
     * 占领数 = 和开局那一刻比，易主过的省（只看参战两国的地界） */
    const WB = window.__benchWar || { pair: [], recruited: 0, wpnIn: 0, own: {} };
    const RW = window.AO.resWar || { army: {}, occupy: {}, wars: {} };
    let aliveMen = 0, armyN = 0;
    for (const id in RW.army) {
      const a = RW.army[id];
      if (!a || WB.pair.indexOf(a.owner) < 0) continue;
      aliveMen += a.men; armyN++;
    }
    let wpnLeft = 0;
    for (const p of w.provinces) {
      if (!p || WB.pair.indexOf(p.owner) < 0) continue;
      wpnLeft += window.AO.resDebug.itemStock(p.id, 'bronze');
    }
    let occ = 0, flipped = 0;
    for (const p of w.provinces) {
      if (!p) continue;
      const was = WB.own[p.id];
      if (was === undefined) continue;
      if (was !== p.owner && (WB.pair.indexOf(was) >= 0 || WB.pair.indexOf(p.owner) >= 0)) {
        occ++;
        if (WB.pair.indexOf(was) < 0) flipped++;
      }
    }
    const war = {
      armyN: armyN, men: aliveMen, loss: Math.max(0, WB.recruited - aliveMen),
      wpn: Math.max(0, WB.wpnIn - wpnLeft), occ: occ, flipped: flipped,
      battles: WB.battles || 0
    };
    return { turn: window.AO.resDebug.turn(), halted: halted, built: built, cen: cen, pts: pts,
             unlocked: unlocked, prod: Math.round(prod), war: war,
             goldAvg: goldN ? goldSum / goldN : 0,
             happyAvg: hW ? hSum / hW : 60,
             offN: offN,
             doneAt: Object.assign({}, window.AO.__benchDoneAt) };
  }, KEYS);

  /* 快照（策略 G 专用）：按性格分组，全部取"每国平均"，另附极值 ——
   * 验收要的两条（无人金爆仓 / 无人民心归零）看的就是 cenMax 与 happyMin。 */
  const snapG = () => page.evaluate(() => {
    const g = window.AO.aiDebug.groups(), out = [];
    for (const k in g) {
      const q = g[k];
      out.push({
        key: q.key, cn: q.cn, n: q.n,
        school: q.n ? q.school / q.n : 0,
        market: q.n ? q.market / q.n : 0,
        granary: q.n ? q.granary / q.n : 0,
        factory: q.n ? q.factory / q.n : 0,
        university: q.n ? q.university / q.n : 0,
        smelt: q.n ? q.smelt / q.n : 0,
        barracks: q.n ? q.barracks / q.n : 0,
        tech: q.n ? q.tech / q.n : 0,
        off: q.n ? q.off / q.n : 0,
        halt: q.halt, gold: q.gold, happy: q.happy, tax: q.tax,
        cen: q.cenGold, cenMax: q.cenMax, happyMin: q.happyMin,
        /* 方差线：同性格国家之间"建校 / 加税"时机的标准差 */
        schoolSd: q.schoolSd, taxSd: q.taxSd,
        schoolN: q.schoolN, taxN: q.taxN
      });
    }
    return { turn: window.AO.resDebug.turn(), groups: out };
  });

  const results = {};
  const strategies = [
    ['A', '什么都不建'],
    ['B', '每省铺满 学校+市场+建造坊'],
    ['C', '只铺学校'],
    ['D', '只铺学校 + 税率拉满 + 每国两官'],
    ['E', '两国宣战 · 互征到 3 军对撞'],
    ['G', '全 AI 开内政 · 三性格对照']
  ];

  for (const [code, label] of strategies) {
    await regen();
    await page.evaluate(() => { window.AO.__benchDoneAt = {}; window.__benchAI = null; });
    /* G 只跑 100 回合（任务书的验收口径），其余照旧 200 —— 战后曲线要跑长 */
    const T = code === 'G' ? 100 : TURNS;
    const rows = [];
    if (code === 'G') {
      for (let t = 1; t <= T; t++) {
        await runTurn(code);
        if (t % STEP === 0) rows.push(await snapG());
      }
      results[code] = { label: label, rows: rows, doneAt: {} };
      continue;
    }
    for (let t = 1; t <= T; t++) {
      await runTurn(code);
      if (t % STEP === 0) rows.push(await snap());
    }
    results[code] = { label: label, rows: rows, doneAt: await page.evaluate(() => Object.assign({}, window.AO.__benchDoneAt)) };
  }

  /* ---------------- 出表 ---------------- */
  const W = [5, 6, 6, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 8, 5, 9];
  const RIGHTS = W.map(() => true);
  const head = ['回合', '停产', '建成', '省库金', '民心', '官员',
                '铁', '金', '粮', '畜', '木', '鱼', '盐', '科研点', '解锁', '全国产出'];

  console.log('');
  console.log('经济 bench · seed=' + SEED + ' · ' + PROV + ' 省 / ' + CTRY + ' 国 · ' + TURNS + ' 回合');
  console.log('（数值拍板看这张表：所有数字都来自 15-resources.js 的占位值）');
  console.log('（省库金 = 各省金锭库存均值；民心 = 人口加权平均；官员 = 全国在任总数）');

  for (const [code, label] of strategies) {
    if (code === 'G') continue;             // G 的曲线是另一张表（见下）
    const R = results[code];
    console.log('');
    console.log('=== 策略 ' + code + '：' + label + ' ===');
    console.log(row(head, W, RIGHTS));
    console.log(W.map(w => '─'.repeat(w)).join(' '));
    for (const s of R.rows) {
      console.log(row([
        s.turn, s.halted, s.built,
        s.goldAvg.toFixed(1), s.happyAvg.toFixed(1), s.offN,
        Math.round(s.cen.iron), Math.round(s.cen.gold), Math.round(s.cen.grain),
        Math.round(s.cen.horse), Math.round(s.cen.timber), Math.round(s.cen.fish),
        Math.round(s.cen.salt), s.pts, s.unlocked, s.prod
      ], W, RIGHTS));
    }
  }

  /* 策略 E 的战争曲线：这张表才是"验战争层平衡"要看的东西 */
  const warInfo = await page.evaluate(() => {
    const D = window.AO.resDebug, w = D.world(), WB = window.__benchWar || {};
    const pair = WB.pair || [];
    const side = pair.map(cid => {
      const c = w.countries[cid - 1] || { provinces: [] };
      return { cid: cid, name: c.name || ('#' + cid), prov: c.provinces.length, dead: !!D.deadMap[cid] };
    });
    let note = '';
    const dead = side.filter(s => s.dead);
    if (dead.length) {
      const win = side.find(s => !s.dead) || {};
      note = dead.map(s => s.name).join('、') + ' 已被吞并 —— 之后没有对手，曲线平掉是"打完了"，不是"卡住了"。' +
        '（剩下 ' + (win.name || '?') + ' ' + win.prov + ' 省）';
    } else if (side.length === 2) {
      note = side.map(s => s.name + ' ' + s.prov + ' 省').join(' vs ') + ' —— 双方都还活着，继续磨。';
    }
    return { side: side, note: note, battles: WB.battles || 0 };
  });
  {
    const R = results['E'];
    const W2 = [5, 5, 7, 8, 8, 8, 6];
    const R2 = W2.map(() => true);
    const head2 = ['回合', '军队', '总兵力', '累计战损', '装备消耗', '易主省', '战报数'];
    console.log('');
    console.log('=== 策略 E 的战争曲线（两国互征，各 3 军上限）===');
    console.log('（战损 = 征到的兵 − 还活着的兵；装备消耗 = 投进去的军械 − 两国省库剩余；易主省 = 相对开局的版图变化）');
    console.log(row(head2, W2, R2));
    console.log(W2.map(w => '─'.repeat(w)).join(' '));
    for (const s2 of R.rows) {
      const x = s2.war || { armyN: 0, men: 0, loss: 0, wpn: 0, occ: 0, battles: 0 };
      console.log(row([s2.turn, x.armyN, x.men, x.loss, x.wpn, x.occ, x.battles], W2, R2));
    }
    const last = R.rows[R.rows.length - 1];
    const x = (last && last.war) || {};
    console.log('结论：' + PROV + ' 省的世界里，' + TURNS + ' 回合打到剩 ' + (x.men || 0) + ' 兵、累计战损 ' +
      (x.loss || 0) + '、易主 ' + (x.occ || 0) + ' 省、会战 ' + (x.battles || 0) + ' 场。');
    if (warInfo.note) console.log('　　　' + warInfo.note);
  }

  /* 科技完成回合号：每条科技最早在哪一回合被哪个国家研出来 */
  const techs = await page.evaluate(() => window.AO.TECHS.map(t => ({ key: t.key, cn: t.cn, pts: t.pts })));
  console.log('');
  console.log('=== 各科技首次完成回合（— = 200 回合内没人研出来）===');
  console.log(row(['科技', '点数', 'A', 'B', 'C', 'D', 'E'], [14, 5, 7, 7, 7, 7, 7],
    [false, true, true, true, true, true, true]));
  console.log(['─'.repeat(14), '─'.repeat(5), '─'.repeat(7), '─'.repeat(7), '─'.repeat(7), '─'.repeat(7),
    '─'.repeat(7)].join(' '));
  for (const t of techs) {
    const cell = (c) => {
      const v = results[c].doneAt[t.key];
      return v === undefined ? '—' : String(v);
    };
    console.log(row([t.cn, t.pts, cell('A'), cell('B'), cell('C'), cell('D')],
      [14, 5, 7, 7, 7, 7], [false, true, true, true, true, true]));
  }

  /* ---------------- 策略 G：三性格曲线 ----------------
   * 每 10 回合一行 × 三种性格。看四件事：
   *   ① 分化：军国的兵营/税率该明显高、经营的市场/大学/省库金该明显高；
   *   ② 无人金爆仓：cenMax 不该一路往上冲（中央金有闸）；
   *   ③ 无人民心归零：happyMin 不该贴地（≤10 就是出事了）；
   *   ④ **同性格不重合**：schoolSd / taxSd 是"同性格国家之间建校 / 加税
   *      时机的标准差" —— 三条曲线各自分散（σ>0）才说明"同一型里也有各自的活法"，
   *      σ=0 就是"同性格国家像克隆人"，本批要的就是它不为 0。 */
  {
    const G = results['G'];
    const W3 = [5, 4, 4, 6, 6, 6, 6, 6, 7, 6, 6, 6, 6, 5, 5];
    const R3 = W3.map((_, i) => i > 1);
    const head3 = ['回合', '性格', '国数', '学校/国', '市场/国', '粮仓/国', '工厂/国',
                   '大学/国', '熔旧坊/国', '科研/国', '官员/国', '省库金', '民心', '税率', '停产'];
    console.log('');
    console.log('=== 策略 G：全 AI 开内政 · 三性格曲线（每国平均，100 回合）===');
    console.log('（AI 只用自己省的数据做决定；玩家国 = 1 号国，不参与统计）');
    console.log(row(head3, W3, R3));
    console.log(W3.map(w => '─'.repeat(w)).join(' '));
    for (const r of G.rows) {
      r.groups.forEach((q, idx) => {
        console.log(row([
          idx === 0 ? r.turn : '', q.cn, q.n,
          q.school.toFixed(1), q.market.toFixed(1), q.granary.toFixed(1),
          q.factory.toFixed(1), q.university.toFixed(1), q.smelt.toFixed(1),
          q.tech.toFixed(1), q.off.toFixed(1), q.gold.toFixed(0),
          q.happy.toFixed(1), q.tax.toFixed(2), q.halt
        ], W3, R3));
      });
      console.log(W3.map(w => '·'.repeat(w)).join(' '));
    }
    const lastG = G.rows[G.rows.length - 1].groups;
    let cenMax = 0, happyMin = 100, halted = 0;
    for (const q of lastG) {
      cenMax = Math.max(cenMax, q.cenMax);
      happyMin = Math.min(happyMin, q.happyMin);
      halted += q.halt;
    }
    console.log('结论（第 100 回合）：中央金峰值 ' + cenMax.toFixed(0) +
      '（不算爆仓的门槛看它有没有一路狂涨）· 单省民心最低 ' + happyMin.toFixed(1) +
      '（0 = 出事了）· 停产建筑合计 ' + halted + ' 座');
    /* 方差线：同性格国家的"建校 / 加税"时机标准差（单位：回合） */
    console.log('');
    console.log('=== 方差线：同性格国家之间「建校 / 加税」时机的标准差（回合）===');
    console.log('（σ=0 表示同性格像克隆人；σ>0 才是"各有各的活法"。括号里是样本国数）');
    for (const q of lastG) {
      console.log('　' + pad(q.cn, 6) +
        ' 建校 σ ' + pad(q.schoolSd.toFixed(1), 5, true) + '（' + q.schoolN + ' 国）' +
        '　加税 σ ' + pad(q.taxSd.toFixed(1), 5, true) + '（' + q.taxN + ' 国）');
    }
    /* 一句实话：大学/工厂都是 0 的话，八成不是"没解锁"，是**没钱** ——
     * 第 100 回合前后全国金见底（见第一段 bench 的老结论），AI 连市场都铺不满，
     * 根本轮不到表尾那几项。这不是 AI 的问题，是占位数值的经济曲线。 */
    const zeroLate = lastG.every(q => q.university === 0 && q.factory === 0);
    if (zeroLate) {
      console.log('　注：三种性格的大学/工厂都是 0 —— 看「停产」那一列，第 100 回合前后' +
        '全国金见底，AI 连市场都铺不满，轮不到表尾。解锁条件（教育 60/15）本身是满足的。');
    }
    for (const q of lastG) {
      console.log('　' + pad(q.cn, 6) + ' 学校 ' + pad(q.school.toFixed(1), 5, true) +
        ' 市场 ' + pad(q.market.toFixed(1), 5, true) +
        ' 粮仓 ' + pad(q.granary.toFixed(1), 5, true) +
        ' 工厂 ' + pad(q.factory.toFixed(1), 5, true) +
        ' 大学 ' + pad(q.university.toFixed(1), 5, true) +
        ' 熔旧坊 ' + pad(q.smelt.toFixed(1), 5, true) +
        ' 兵营 ' + pad(q.barracks.toFixed(1), 5, true));
      console.log('　' + ' '.repeat(6) + ' 科研 ' + pad(q.tech.toFixed(1), 5, true) +
        ' 官员 ' + pad(q.off.toFixed(1), 5, true) +
        ' 省库金 ' + pad(q.gold.toFixed(0), 5, true) +
        ' 民心 ' + pad(q.happy.toFixed(1), 5, true) +
        ' 税率 ' + q.tax.toFixed(2));
    }
  }


  /* 一句话结论（只描述现象，不做判断 —— 判断留给拍板的人） */
  const last = (c) => results[c].rows[results[c].rows.length - 1];
  console.log('');
  console.log('=== 第 ' + TURNS + ' 回合快照 ===');
  for (const [code, label] of strategies) {
    if (code === 'G') continue;             // G 的收尾在它自己那张表下面
    const s = last(code);
    console.log('  ' + code + '  ' + pad(label, 30) +
      ' 停产 ' + pad(s.halted, 4, true) + ' / 建成 ' + pad(s.built, 5, true) +
      ' · 科研点 ' + pad(s.pts, 5, true) + ' · 解锁 ' + pad(s.unlocked, 3, true) + ' 国' +
      ' · 省库金 ' + pad(s.goldAvg.toFixed(1), 6, true) +
      ' · 民心 ' + pad(s.happyAvg.toFixed(1), 5, true) +
      ' · 官员 ' + pad(s.offN, 4, true));
  }
  console.log('');
  /* ---------------- 策略 H：全 AI 互战（v10） ----------------
   * 150 回合、玩家挂机（选一个国进入游戏模式，之后一步不动，全交给 AI）。
   * 看四件事：
   *   ① 军国好战 / 经营太平 —— 按性格、按 warBias 分位看宣战频次；
   *   ② 无雪崩 —— 灭国数、当前战争数（阻尼在 AIWAR.damp）；
   *   ③ 进攻目标 100% 在已探集（WSTAT.badTarget 必须是 0）；
   *   ④ 世界纪要（"别处的历史"有没有真的在发生）。 */
  {
    await page.evaluate(() => { document.getElementById('seed').value = 'bench-war-1'; });
    await regen();
    await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });
    const t0 = Date.now();
    for (let i = 0; i < 150; i++) await page.evaluate(() => window.AO.resDebug.settleTurn());
    const ms = Date.now() - t0;

    const H = await page.evaluate(() => {
      const A = window.AO, D = A.resDebug, AI = A.aiDebug, w = D.world();
      const rows = [];
      for (const c of w.countries) {
        if (!c || c.id === D.player()) continue;
        if (D.deadMap[c.id]) continue;
        rows.push({
          id: c.id, per: AI.personaOf(c.id), war: AI.quirkOf(c.id).war,
          dcl: AI.dcl[c.id] || 0
        });
      }
      /* warBias 三分位 */
      const sorted = rows.slice().sort((x, y) => x.war - y.war);
      const cut1 = Math.floor(sorted.length / 3), cut2 = Math.floor(sorted.length * 2 / 3);
      const buckets = [
        { cn: 'warBias 低', list: sorted.slice(0, cut1) },
        { cn: 'warBias 中', list: sorted.slice(cut1, cut2) },
        { cn: 'warBias 高', list: sorted.slice(cut2) }
      ].map(b => ({
        cn: b.cn, n: b.list.length,
        war: b.list.reduce((s2, x) => s2 + x.war, 0) / Math.max(1, b.list.length),
        dcl: b.list.reduce((s2, x) => s2 + x.dcl, 0)
      }));
      const pers = ['mil', 'balanced', 'econ'].map(k => {
        const l = rows.filter(x => x.per === k);
        const sum = l.reduce((s2, x) => s2 + x.dcl, 0);
        return { cn: (A.AIECON.personas.find(pp => pp.key === k) || {}).cn, n: l.length,
          dcl: sum, per: sum / Math.max(1, l.length) };
      });
      return {
        turn: D.turn(), war: JSON.parse(JSON.stringify(AI.war)),
        buckets, pers,
        allies: Object.keys(A.resDiplo.allies).length,
        naps: Object.keys(A.resDiplo.naps).length,
        dead: Object.keys(D.deadMap).length,
        wars: Object.keys(D.wars).filter(k => D.wars[k]).length,
        alive: rows.length,
        guard: Object.keys(AI.milGuard).length,
        /* v15：新闻走情报渠道之后，这一局"听过多少、晚了多久、听错多少" ——
         * 三项直接取游戏内的 NSTAT，不另立一套账。 */
        news: (function () {
          const s = A.resNews.stat();
          return {
            byTier: s.byTier.map(b => ({ n: b.n | 0, avg: b.n ? b.sum / b.n : null })),
            enq0: s.enq0 | 0, rumour: s.rumour | 0,
            dropped: s.dropped | 0, delivered: s.delivered | 0
          };
        })()
      };
    });

    const W3 = [12, 6, 6, 8, 8, 8];
    const R3 = [false, true, true, true, true, true];
    console.log('');
    console.log('=== 策略 H：全 AI 互战 · 150 回合（玩家挂机，' + (ms / 1000).toFixed(1) + 's）===');
    console.log('（AI 只用自己已探到的情报；行军目标只从已探集里挑）');
    console.log('');
    console.log(row(['warBias 分位', '国数', '均值', '宣战合计'], W3.slice(0, 4), R3.slice(0, 4)));
    console.log(W3.slice(0, 4).map(w => '─'.repeat(w)).join(' '));
    for (const b of H.buckets) {
      console.log(row([b.cn, b.n, b.war.toFixed(2), b.dcl], W3.slice(0, 4), R3.slice(0, 4)));
    }
    console.log('');
    console.log(row(['性格', '国数', '宣战合计', '每国平均'], W3.slice(0, 4), R3.slice(0, 4)));
    console.log(W3.slice(0, 4).map(w => '─'.repeat(w)).join(' '));
    for (const q of H.pers) {
      console.log(row([q.cn, q.n, q.dcl, q.per.toFixed(2)], W3.slice(0, 4), R3.slice(0, 4)));
    }
    console.log('');
    console.log('第 ' + H.turn + ' 回合：存活 ' + H.alive + ' 国 · 当前战争 ' + H.wars +
      ' 场 · 灭国 ' + H.dead + ' · 同盟 ' + H.allies + ' · 互不侵犯 ' + H.naps +
      ' · 军费护栏触发过 ' + H.guard + ' 国');
    console.log('累计：宣战 ' + H.war.declare + ' · 进攻 ' + H.war.attack + ' · 回撤 ' + H.war.retreat +
      ' · 求和 ' + H.war.peace + ' · 买货 ' + H.war.trade + ' · 世界纪要 ' + H.war.news + ' 条');
    /* v15 三项（验收 ⑥）：各档平均送达延迟 / 被"未知国"丢弃条数 / 风闻率。
     * 均值后面括号里是样本数 —— 挂机玩家一直是无预算档，1/2 档那两格本来就是空的，
     * 只报一个"延迟 —"会让人以为管线没跑，报出样本数才看得出是"没花钱"。 */
    const NS = H.news, tierCn = ['无', '常规', '重金'];
    const avgTxt = NS.byTier.map((b, i) => tierCn[i] + ' ' +
      (b.avg === null ? '—' : b.avg.toFixed(1)) + '(' + b.n + ')').join(' / ');
    const rumourRate = NS.enq0 ? NS.rumour / NS.enq0 : 0;
    console.log('世界消息（v15）：送达 ' + NS.delivered + ' 条 · 平均延迟 ' + avgTxt + ' 回合' +
      ' · 被"未知国"丢弃 ' + NS.dropped + ' 条' +
      ' · 0 档风闻率 ' + (rumourRate * 100).toFixed(1) + '%（' + NS.rumour + '/' + NS.enq0 + '）');
    console.log('');
    const milDcl = H.pers.find(q => q.cn === '军国');
    const econDcl = H.pers.find(q => q.cn === '经营');
    const hi = H.buckets[2], lo = H.buckets[0];
    console.log('判定：');
    console.log('　① 军国好战 / 经营太平 —— 军国每国 ' + milDcl.per.toFixed(2) +
      ' 次 vs 经营 ' + econDcl.per.toFixed(2) + ' 次　' +
      (milDcl.per > econDcl.per ? '✔' : '✘'));
    console.log('　② warBias 高的一档更爱开战 —— ' + hi.dcl + ' vs ' + lo.dcl + '　' +
      (hi.dcl >= lo.dcl ? '✔' : '✘'));
    console.log('　③ 进攻目标 100% 在已探集 —— badTarget ' + H.war.badTarget + '　' +
      (H.war.badTarget === 0 ? '✔' : '✘'));
    console.log('　④ 无雪崩 —— 150 回合灭国 ' + H.dead + ' / ' + (H.dead + H.alive) + ' 国　' +
      (H.dead <= Math.ceil((H.dead + H.alive) / 3) ? '✔' : '✘'));
    console.log('　⑤ 0 档风闻率 15%±5 —— ' + (rumourRate * 100).toFixed(1) + '%　' +
      (rumourRate >= 0.10 && rumourRate <= 0.20 ? '✔' : '✘'));
  }

  /* ---------------- 策略 I：横征暴敛 → 叛乱链（A 批） ----------------
   * 一国（玩家国）被压到"民心 30 上下"，跑 50 回合，看整条链会不会自己走完：
   *   不安涨到 80 → 15% 掷骰 → 匪乱 / 倒戈 / 独立。
   *
   * 怎么压到 30：**用游戏里真实的三把刀**，不直接改民心 ——
   *   ① 税率拉满（横征暴敛 −12）
   *   ② 中央国库清零 → 维护付不起 → 建筑成片停产（−9 封顶）
   *   ③ 省库存粮清空 → 缺粮（−15）
   * 合起来 target ≈ 24~33，正好是"活不下去"的那一档。
   * 这样测出来的曲线，玩家在游戏里照着做也能复现。 */
  {
    await page.evaluate(() => { document.getElementById('seed').value = 'bench-revolt-1'; });
    await regen();
    const I = await page.evaluate(() => {
      const AO = window.AO, D = AO.resDebug, w = D.world();
      /* 挑一个省数最多的国当玩家（省多才看得出"整国裂开"） */
      let pc = null;
      for (const c of w.countries) if (c && (!pc || c.provinces.length > pc.provinces.length)) pc = c;
      D.choosePlayer(pc.id);
      return { cid: pc.id, name: pc.name, n0: pc.provinces.length };
    });

    const t0 = Date.now();
    const R = await page.evaluate(() => {
      const AO = window.AO, D = AO.resDebug, w = D.world();
      const cid = D.player();
      const c0 = w.countries[cid - 1];
      const n0 = c0.provinces.length;
      let bandit = 0, defect = 0, secede = 0, newC = 0;
      const turns = [];
      for (let t = 1; t <= 50; t++) {
        const provs = w.provinces.filter(p => p && p.owner === cid);
        /* ① 横征暴敛 */
        D.setTax(cid, 2);
        AO.setFaithPol(cid, 'force');
        /* ② 中央国库清零：维护付不起 → 成片停产 */
        const cen = AO.resCentral[cid];
        if (cen) { cen.gold = 0; cen.iron = 0; cen.timber = 0; }
        /* ③ 断粮：省库存粮/渔获清空 */
        for (const p of provs) {
          const bag = AO.resSim[p.id];
          if (bag) {
            if (bag.grain) { bag.grain.stock = 0; bag.grain.left = Math.max(1, bag.grain.left); }
            if (bag.fish) bag.fish.stock = 0;
          }
        }
        const beforeC = w.countries.length;
        const lgBefore = D.log().length;
        D.settleTurn();
        const fresh = D.log().slice(0, 8);
        let b = 0, d = 0;
        for (const e of fresh) {
          if (/匪乱/.test(e.text)) b++;
          else if (/举城投/.test(e.text)) d++;
        }
        bandit += b; defect += d;
        if (w.countries.length > beforeC) { secede += w.countries.length - beforeC; newC += w.countries.length - beforeC; }
        /* 每 10 回合记一行：不安均值 / 民心均值 / 停产类数 / 还剩几省 */
        if (t % 10 === 0) {
          const ps = w.provinces.filter(p => p && p.owner === cid);
          let us = 0, hs = 0, halt = 0;
          for (const p of ps) {
            us += D.unrestOf(p.id).v;
            hs += AO.resHappyOf(p.id).v;
            const hd = AO.resHappyOf(p.id).drivers;
            if (hd && hd.haltN) halt += hd.haltN;
          }
          turns.push({
            t: t, n: ps.length,
            unrest: ps.length ? us / ps.length : 0,
            happy: ps.length ? hs / ps.length : 0,
            halt: ps.length ? halt / ps.length : 0,
            bandit: bandit, defect: defect, secede: secede
          });
        }
      }
      const c = w.countries[cid - 1];
      return {
        turn: D.turn(), rows: turns, bandit: bandit, defect: defect, secede: secede,
        n0: n0, n1: c.provinces.length, newC: newC,
        alive: w.countries.filter(x => x && x.provinces.length && !D.deadMap[x.id]).length,
        dead: Object.keys(D.deadMap).length
      };
    });
    const ms = Date.now() - t0;

    console.log('');
    console.log('=== 策略 I：横征暴敛 → 叛乱链 · 50 回合（' + I.name + '，' + I.n0 +
      ' 省起步，' + (ms / 1000).toFixed(1) + 's）===');
    console.log('（税率拉满 + 国库清零（成片停产）+ 断粮 → 民心压到 30 上下，看不安自己涨到爆发）');
    console.log('');
    const WI = [8, 6, 8, 8, 8, 8, 8];
    const RI = [false, true, true, true, true, true, true];
    console.log(row(['回合', '省数', '不安', '民心', '停产', '匪乱', '倒戈', '独立'], WI, RI));
    console.log(WI.map(w2 => '─'.repeat(w2)).join(' '));
    for (const q of R.rows) {
      console.log(row([q.t, q.n, q.unrest.toFixed(1), q.happy.toFixed(1), q.halt.toFixed(1),
        q.bandit, q.defect, q.secede], WI, RI));
    }
    console.log('');
    console.log('判定：');
    console.log('　① 匪乱出现 —— ' + R.bandit + ' 次　' + (R.bandit > 0 ? '✔' : '✘'));
    console.log('　② 倒戈出现 —— ' + R.defect + ' 次　' + (R.defect > 0 ? '✔' : '✘'));
    console.log('　③ 独立出现 —— 新国 ' + R.newC + ' 个　' + (R.newC > 0 ? '✔' : '✘'));
    console.log('　④ 整国在裂 —— 裂出去 ' + (R.secede + R.defect) + ' 省（独立 ' + R.secede +
      ' · 倒戈 ' + R.defect + '），省数 ' + R.n0 + ' → ' + R.n1 +
      '，存活国 ' + R.alive + '、灭国 ' + R.dead + '　' +
      ((R.secede + R.defect) >= 5 ? '✔' : '✘'));
    /* v18（经济续命）之后这一条的**口径**改了，记在这里：
     * ① 上解（GOV.remit）让"只清空中央国库"不再等于成片停产 —— 省库里的金
     *    会在结算尾自动回流，所以"停产"这一把刀钝了（表里停产从原来的 3~4
     *    掉到 0.1~0.3，民心从 ~30 抬到 ~35）。这是 D 在起作用，不是回归。
     * ② 判据从"净省数变少"改成"真的裂出去多少省"：倒戈是**双向**的
     *    （别国的省也会投过来），净数会被它顶回去 —— 这一次独立 23 省、
     *    倒戈 29 次，净省数反而是 23 → 24，用净数判"整国在裂"是错的度量。 */
  }

  /* ---------------- 策略 J：整合的两条路（B 批） ----------------
   * 拿同一批 10 个占领省分两组，跑 100 回合：
   *   A 组  不派官、不驻军、不安抚      —— 只有基础 +1（同信仰 +1，看运气）
   *   B 组  派官 + 每 3 回合安抚一次    —— 基础 +1 + 官 +1 + 安抚 15/3
   * 验收：整合完成的回合数差 ≥ 2 倍。
   *
   * 为了只比较"人 / 兵 / 金"这三项，两组的民心都被按住在 60（≥55 那一档两边都有），
   * 否则一边饿死一边吃饱，测出来的是"谁更穷"而不是"谁在治理"。 */
  {
    await page.evaluate(() => { document.getElementById('seed').value = 'bench-integ-1'; });
    await regen();
    const t0 = Date.now();
    const J = await page.evaluate(() => {
      const AO = window.AO, D = AO.resDebug, w = D.world();
      D.choosePlayer(1);
      const myId = 1;
      /* 挑 10 个省占下来（不宣战，避免触发投降线把对方整国吞掉 ——
       * 这里要的是"10 个未整合省"，不是一场灭国战争） */
      const pool = w.provinces.filter(p => p && p.owner && p.owner !== myId);
      const picked = [];
      for (const p of pool) { if (picked.length >= 10) break; picked.push(p.id); }
      const A = picked.slice(0, 5), B = picked.slice(5, 10);
      for (const pid of picked) D.occupy(pid, myId);

      /* B 组派官：从人才池里抽（没有就开科） */
      const G = AO.GOV, T = AO.resTalentOf(myId);
      T.pts = Math.max(T.pts, 200);
      for (const pid of B) {
        let placed = false;
        while (!placed) {
          if (!T.pool || !T.pool.length) {
            D.exam(myId);
            if (!T.pool || !T.pool.length) break;
          }
          const off = T.pool[0];
          D.assign(pid, off.id, true);
          placed = !!(AO.resOfficial[pid] && AO.resOfficial[pid].id === off.id);
          if (!placed) break;
        }
      }
      const doneAt = {};
      let aiPac = 0;
      for (let t = 1; t <= 100; t++) {
        /* 民心按住 60（只比较官/兵/金） */
        for (const pid of picked) {
          const h = AO.resHappyOf(pid);
          h.v = 60; h.target = 60;
        }
        /* B 组：每 3 回合安抚（金不够就从中央补，模拟一个"顾得上治理"的国家） */
        if (t % 3 === 0) {
          for (const pid of B) {
            const bag = AO.resSim[pid];
            if (bag && bag.gold && bag.gold.stock < 25) bag.gold.stock = 60;
            const r = D.pacify(pid, false);
            if (r && r.ok) aiPac++;
          }
        }
        D.settleTurn();
        for (const pid of picked) {
          if (doneAt[pid] === undefined && !D.occupyMap[pid]) doneAt[pid] = t;
        }
        if (A.every(p => doneAt[p] !== undefined) && B.every(p => doneAt[p] !== undefined)) break;
      }
      const avg = list => {
        const v = list.map(p => doneAt[p] === undefined ? null : doneAt[p]).filter(x => x !== null);
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      return {
        turn: D.turn(),
        A: A.map(p => doneAt[p] === undefined ? '—' : doneAt[p]),
        B: B.map(p => doneAt[p] === undefined ? '—' : doneAt[p]),
        avgA: avg(A), avgB: avg(B), pac: aiPac,
        doneA: A.filter(p => doneAt[p] !== undefined).length,
        doneB: B.filter(p => doneAt[p] !== undefined).length
      };
    });
    const ms = Date.now() - t0;

    console.log('');
    console.log('=== 策略 J：整合的两条路 · 100 回合（' + (ms / 1000).toFixed(1) + 's）===');
    console.log('（10 个占领省分两组；民心都按在 60，只比"派官 + 安抚"这两项）');
    console.log('');
    console.log('  A 组（不派官不安抚）完成回合：' + J.A.join(' · '));
    console.log('  B 组（派官 + 每 3 回合安抚，共 ' + J.pac + ' 次）完成回合：' + J.B.join(' · '));
    console.log('');
    const a = J.avgA, b = J.avgB;
    const ratio = (a && b) ? a / b : 0;
    console.log('判定：');
    console.log('　① A 组平均 ' + (a === null ? '未完成' : a.toFixed(1)) + ' 回合、B 组平均 ' +
      (b === null ? '未完成' : b.toFixed(1)) + ' 回合　' +
      ((a && b) ? ('差 ' + ratio.toFixed(2) + ' 倍　' + (ratio >= 2 ? '✔' : '✘')) : '✘'));
    console.log('　② 完成数 A ' + J.doneA + '/5 · B ' + J.doneB + '/5　' +
      (J.doneB >= J.doneA ? '✔' : '✘'));
  }

  /* ---------------- 策略 L：双国局 —— 甲粮积压、乙粮紧缺（v14 动态市场） ----------------
   * 甲乙两国关系拉到 80，甲仓满、乙空仓，各给一座市场，然后跑 60 回合，
   * 每回合从甲"出口一手"给乙。验四件事：
   *   ① 乙的粮价从 1.3+ 回落、甲的回升 —— 价格随出口**收敛**（收敛曲线入表）
   *   ② 双方 FLOW 的 export / import 对账相等（同一批货，两边记同一个数）
   *   ③ 每手的套利利润逐回合递减 —— 出口自己把价差关掉，没有无限刷钱
   *   ④ 大旱之后受灾国粮价两回合内 ≥ 1.5（冲击传导）
   *
   * **为什么要按住两国的粮食产出**：一回合全国粮食产量是几百，而一手出口只有 5。
   * 不按住的话，"出口造成的库存变化"会被产量完全盖住，价格几乎不动 ——
   * 那测出来的就不是"价差会闭合"，而是"5 单位太小了"。所以这里把两国的农场
   * 全部停掉（built = 0），只留人口在吃粮：库存的唯一增量就是出口。
   * 这是**受控实验**，不是玩法简化。 */
  {
    await page.evaluate(() => { document.getElementById('seed').value = 'bench-mkt-1'; });
    await regen();
    const t0 = Date.now();
    const L = await page.evaluate(() => {
      const AO = window.AO, D = AO.resDebug, w = D.world(), C = AO.PRICES_CFG;
      /* 挑"省最少的两个国"：出口一回合只有 5 单位，如果甲有 20 个省，
       * 出口量会被本国的口粮消耗完全淹没（那测的是"人口在吃粮"，不是"出口在改价"）。
       * 小国才看得见出口的力道。 */
      const alive = w.countries.filter(c => c && c.provinces.length >= 1 && !D.deadMap[c.id]);
      const A = alive.slice().sort((x, y) => x.provinces.length - y.provinces.length)[0];
      const B = alive.filter(c => c.id !== A.id)
        .sort((x, y) => x.provinces.length - y.provinces.length)[0];
      D.relSet(A.id, B.id, 80);

      /* 两国都布置成"只有一个变量在动"：有市场、有钱、没有农场 */
      function prep(c, grainStock) {
        c.provinces.forEach(pid => {
          const mk = AO.resMarket[pid];
          if (!mk) AO.resMarket[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
          else { mk.n = Math.max(1, mk.n | 0); mk.halted = false; }
          const bag = AO.resSim[pid];
          if (!bag) return;
          if (bag.grain) {
            bag.grain.built = 0; bag.grain.tiers = { 1: 0, 2: 0 };
            bag.grain.halted = false; bag.grain.stock = grainStock;
          }
          if (bag.gold) bag.gold.stock = 500;
        });
      }
      /* 甲的仓要"刚好比积压线多一点"：比值 3.6 → 目标 0.7（积压），
       * 出口 + 口粮消耗推着它掉到 3 倍以下，目标翻到 1.0 → 甲的价格**回升**。
       * 直接塞满（150/省）的话比值太高，60 回合都掉不下来，那就看不到"回升"了。 */
      const needA = D.needOf(A.id).grain;
      const perA = Math.min(150, Math.max(20, Math.round(3.6 * needA / A.provinces.length)));
      prep(A, perA);
      prep(B, 0);        // 乙：空仓 → 紧缺（比值 0 → 1.8 档）

      const pick = (c, key) => {
        let best = null, bestN = -1;
        c.provinces.forEach(pid => {
          const q = w.provinces[pid - 1], n = D.stockOf(pid, key);
          if (q && n > bestN) { bestN = n; best = q; }
        });
        return best;
      };

      /* 先让价格结算到稳态（否则第一格是初始 1.0，曲线开头会假跌） */
      for (let i = 0; i < 6; i++) D.settlePrices();

      const series = [], profit = [];
      let expQty = 0, impQty = 0, exports = 0, gold = 0;
      for (let t = 1; t <= 60; t++) {
        const p = pick(A, 'grain');
        const srcs = p ? D.exportSources(p, 'grain') : [];
        const toB = srcs.find(s => s.cid === B.id);
        let one = 0;
        if (toB) {
          const r = D.exportForeign(p, 'grain', B.id);
          if (r && r.ok) {
            one = r.raw;                       // 这一手**账面上**到手多少（含零头）
            exports++; gold += r.raw;
          }
        }
        /* 对账：两边这一回合各记了多少货（FLOW 每回合清零，所以逐回合累加） */
        A.provinces.forEach(pid => { const F = D.flow[pid]; if (F && F.gain.export) expQty += F.gain.export; });
        B.provinces.forEach(pid => { const F = D.flow[pid]; if (F && F.gain.import) impQty += F.gain.import; });
        /* 一手赚的"价差" = 到手 − 本国价（不出口的话卖在国内能得多少） */
        profit.push(one > 0 ? one - D.priceOf(A.id, 'grain') * (C.exportLot / AO.MARKET.rate) : 0);

        D.settleTurn();
        if (t % 10 === 0 || t === 1) {
          series.push({ t: t, pa: D.priceOf(A.id, 'grain'), pb: D.priceOf(B.id, 'grain'),
            sa: D.countryStock(A.id, 'grain'), sb: D.countryStock(B.id, 'grain') });
        }
      }
      const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
      const first = avg(profit.slice(0, 10)), last = avg(profit.slice(-10));

      /* ④ 大旱：找乙国一个有粮袋的省，真的把事件打出来（走 evtForce，和玩家一样） */
      let drought = null;
      const bp = B.provinces.map(pid => w.provinces[pid - 1]).find(q => q && AO.resSim[q.id] && AO.resSim[q.id].grain);
      if (bp) {
        AO.resSim[bp.id].grain.stock = 0;      // 先回到"缺粮"状态
        for (let i = 0; i < 4; i++) D.settlePrices();
        const before = D.priceOf(B.id, 'grain');
        AO.evtForce('drought', bp.id, false);
        D.settlePrices();
        const t1 = D.priceOf(B.id, 'grain');
        D.settlePrices();
        drought = { pid: bp.id, before: before, t1: t1, t2: D.priceOf(B.id, 'grain') };
      }

      return {
        a: { id: A.id, name: A.name }, b: { id: B.id, name: B.name },
        series: series, exports: exports, gold: gold, qty: expQty + '/' + impQty,
        expQty: expQty, impQty: impQty,
        first: first, last: last, drought: drought
      };
    });
    const ms = Date.now() - t0;

    console.log('');
    console.log('=== 策略 L：双国局 · 甲粮积压 / 乙粮紧缺 · 60 回合（' + (ms / 1000).toFixed(1) + 's）===');
    console.log('（' + L.a.name + '（甲）→ ' + L.b.name + '（乙），关系 80，两国农场全停，只让出口这一条腿动）');
    console.log('');
    console.log('  回合   甲粮价   乙粮价      甲库存   乙库存');
    console.log('  ───── ─────── ──────── ───────── ────────');
    L.series.forEach(s => {
      console.log('  ' + pad(s.t, 5, true) + ' ' + pad(s.pa.toFixed(2), 7, true) + ' ' +
        pad(s.pb.toFixed(2), 8, true) + ' ' + pad(Math.round(s.sa), 9, true) + ' ' +
        pad(Math.round(s.sb), 8, true));
    });
    console.log('');
    console.log('  出口 ' + L.exports + ' 手 · 累计到手 ' + (Math.round(L.gold * 10) / 10) + ' 金' +
      ' · 对账 出口 ' + L.expQty + ' / 进口 ' + L.impQty);
    console.log('');
    const s0 = L.series[0], sN = L.series[L.series.length - 1];
    console.log('判定：');
    console.log('　① 甲 ' + s0.pa.toFixed(2) + ' → ' + sN.pa.toFixed(2) + '、乙 ' +
      s0.pb.toFixed(2) + ' → ' + sN.pb.toFixed(2) +
      '（相向而行；价差 ' + (s0.pb - s0.pa).toFixed(2) + ' → ' + (sN.pb - sN.pa).toFixed(2) + '）　' +
      ((sN.pb < s0.pb && sN.pa > s0.pa) ? '✔' : '✘'));
    console.log('　② 双方对账相等（出口 ' + L.expQty + ' = 进口 ' + L.impQty + '）　' +
      (L.expQty === L.impQty && L.expQty > 0 ? '✔' : '✘'));
    console.log('　③ 每手利润 前 10 回合 ' + (Math.round(L.first * 100) / 100) + ' → 后 10 回合 ' +
      (Math.round(L.last * 100) / 100) + '（递减 = 价差自闭合）　' +
      (L.last < L.first ? '✔' : '✘'));
    console.log('　④ 大旱后受灾国粮价 ' + (L.drought ?
      (Math.round(L.drought.before * 100) / 100 + ' → ' + Math.round(L.drought.t1 * 100) / 100 +
        ' → ' + Math.round(L.drought.t2 * 100) / 100) : '没跑') + '（两回合内 ≥ 1.5）　' +
      (L.drought && L.drought.t2 >= 1.5 ? '✔' : '✘'));
  }

  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
