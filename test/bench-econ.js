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
        barracks: q.n ? q.barracks / q.n : 0,
        tech: q.n ? q.tech / q.n : 0,
        off: q.n ? q.off / q.n : 0,
        halt: q.halt, gold: q.gold, happy: q.happy, tax: q.tax,
        cen: q.cenGold, cenMax: q.cenMax, happyMin: q.happyMin
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
   * 每 10 回合一行 × 三种性格。看三件事：
   *   ① 分化：军国的兵营/税率该明显高、经营的市场/省库金该明显高；
   *   ② 无人金爆仓：cenMax 不该一路往上冲（中央金有闸）；
   *   ③ 无人民心归零：happyMin 不该贴地（≤10 就是出事了）。 */
  {
    const G = results['G'];
    const W3 = [5, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
    const R3 = W3.map((_, i) => i > 1);
    const head3 = ['回合', '性格', '国数', '学校/国', '市场/国', '兵营/国', '科研/国',
                   '官员/国', '省库金', '民心', '税率', '中央金', '停产'];
    console.log('');
    console.log('=== 策略 G：全 AI 开内政 · 三性格曲线（每国平均，100 回合）===');
    console.log('（AI 只用自己省的数据做决定；玩家国 = 1 号国，不参与统计）');
    console.log(row(head3, W3, R3));
    console.log(W3.map(w => '─'.repeat(w)).join(' '));
    for (const r of G.rows) {
      r.groups.forEach((q, idx) => {
        console.log(row([
          idx === 0 ? r.turn : '', q.cn, q.n,
          q.school.toFixed(1), q.market.toFixed(1), q.barracks.toFixed(1),
          q.tech.toFixed(1), q.off.toFixed(1), q.gold.toFixed(0),
          q.happy.toFixed(1), q.tax.toFixed(2), q.cen.toFixed(0), q.halt
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
    for (const q of lastG) {
      console.log('　' + pad(q.cn, 6) + ' 学校 ' + pad(q.school.toFixed(1), 5, true) +
        ' 市场 ' + pad(q.market.toFixed(1), 5, true) +
        ' 兵营 ' + pad(q.barracks.toFixed(1), 5, true) +
        ' 科研 ' + pad(q.tech.toFixed(1), 5, true) +
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
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
