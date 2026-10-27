/* =============================================================
 * test/bench-lifeline.js —— v18「经济续命」的**数值 bench**
 *
 * ★ 拍板就看这张表。★
 *
 * 36 国 × 100 回合，玩家挂机（选一个国进游戏模式，之后一步不动，全交给 AI）。
 * **同一个 seed 跑两遍**，条件完全相同，只有六个开关不一样：
 *
 *   改前基线   把这批的六个开关全关掉（sellLots=0 / remit=null /
 *              mineOpen.at=0 / 两道库存闸=0 / **iron.cool=0**）—— 等价于 v17 的 AI
 *   v18        开关全开（默认值）
 *
 * 为什么要跑两遍：拍板线里"停产类数较改前减半""中央金>0 的占比 ≥70%"这两条
 * 都要一个**改前**的分母。凭空回忆一个旧数字不算基线；同一个世界、同一套
 * 随机数、只切开关，才是能复现的对照。
 *
 * 两个说明（免得读表的人误会）：
 *   · A0（拆教育门槛）与 A（淘金场）**没有开关可关**，两遍里都在跑 ——
 *     所以"改前基线"这一列其实已经带了半条 A0/A 的好处，是**偏乐观的基线**。
 *     真实 v17 只会比它更差，结论方向不会错。
 *   · 事件按默认选项落地（和 test/smelt.js 一样），不让回合卡在弹窗上。
 *
 * 表里六列：
 *   T50/T100 中央金中位 / 中央铁中位 —— 只看**还活着的国**
 *   停产省数   还有建筑因维护欠费停着的省（全部建筑类型一起数）
 *   gone 矿    已经采空的矿脉数（铁 + 金，每个省每种算一条）
 *   存活国数   100 回合后还活着的国家
 *
 * 100 回合之后两遍**各再多跑 50 回合**，取 T150 的保险线：
 *   全国铁库存中位（中央 + 所有省库）—— 判"铁缓再生给无矿国保底"。
 *
 * 跑法：node test/bench-lifeline.js
 * 约 6 分钟（两遍 × 150 回合）。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SEED = 'bench-lifeline-1';
const PROV = 520, CTRY = 36;
const TURNS = 100;

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
const med = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

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
  await sleep(1600);

  async function regen() {
    /* 先把"旧世界"记下来：点击之后按钮可能还没置灰（生成是异步排队的），
     * 只看 `!disabled && __world` 会在第一帧就返回**页面开局那个世界**上 ——
     * 症状是"36 国的 bench 报出 100+ 个存活国"。所以按世界对象的身份判。 */
    await page.evaluate((s, pv, ct) => {
      window.__prevWorld = window.__world;
      document.getElementById('seed').value = s;
      document.getElementById('prov').value = pv;
      document.getElementById('ctry').value = ct;
      document.getElementById('provVal').textContent = pv;
      document.getElementById('ctryVal').textContent = ct;
      document.getElementById('gen').click();
    }, SEED, PROV, CTRY);
    for (let i = 0; i < 300; i++) {
      await sleep(80);
      const ok = await page.evaluate(() => !document.getElementById('gen').disabled &&
        !!window.__world && window.__world !== window.__prevWorld);
      if (ok) return;
    }
    throw new Error('生成超时');
  }

  /* 八个开关：on=true → 用定义区的默认值；on=false → 全关（= 改前基线）
   * 第 6 个是 v18 追加一补课的常数（铁矿 cool 48）：关掉它就回到"采空即永久枯竭"，
   * 这样 T150 全国铁库存那一列才有"改前趋零"的分母。
   * 第 7、8 个是 v18.4 / v18.5 补的：**买铁付维护**与**养得起几座就养几座**。
   * 这两条一旦漏在基线那一侧，基线就会跟着一起变好 —— 上一版实测基线停产
   * 从 250 掉到 133、铁中位从 0 涨到 17，"改前"两个字就名不副实了。 */
  const setV18 = (on) => page.evaluate((ON) => {
    const A = window.AO;
    if (!window.__v18) {
      window.__v18 = {
        sellLots: A.AIECON.sellLots,
        remit: A.GOV.remit,
        at: JSON.parse(JSON.stringify(A.AIECON.mineOpen.at)),
        equipNeed: A.AIECON.mill.equipNeedPerArmy,
        wpnCap: A.AIECON.mill.wpnStockCap,
        ironCool: A.RESOURCE_BY_KEY.iron.cool,
        selfBuy: A.GOV.selfBuy,
        trimKeep: A.GOV.trimKeep
      };
    }
    const o = window.__v18;
    A.AIECON.sellLots = ON ? o.sellLots : 0;
    A.GOV.remit = ON ? o.remit : null;
    A.AIECON.mineOpen.at = ON ? o.at : { iron: 0, gold: 0 };
    A.AIECON.mill.equipNeedPerArmy = ON ? o.equipNeed : 0;
    A.AIECON.mill.wpnStockCap = ON ? o.wpnCap : 0;
    A.RESOURCE_BY_KEY.iron.cool = ON ? o.ironCool : 0;
    A.GOV.selfBuy = ON ? o.selfBuy : null;
    A.GOV.trimKeep = ON ? o.trimKeep : null;
    return { sellLots: A.AIECON.sellLots, remit: A.GOV.remit, at: A.AIECON.mineOpen.at,
      equip: A.AIECON.mill.equipNeedPerArmy, wpn: A.AIECON.mill.wpnStockCap,
      ironCool: A.RESOURCE_BY_KEY.iron.cool, selfBuy: A.GOV.selfBuy,
      trimKeep: A.GOV.trimKeep };
  }, on);

  /* 一次采样：中央金/铁（按国）+ 停产省数 + gone 矿数 + 存活国数
   * 注意"存活国"里会混进**新生的起义国**（叛乱独立会造新国）——
   * 它们开局就一穷二白，会把"中央金>0 的占比"整体拉低。所以两个口径都报：
   *   goldPosAll  全体存活国
   *   goldPosOrig 开局那 36 国（拍板线看这个 —— 它才是"改前/改后"可比的分母） */
  const snap = () => page.evaluate(() => {
    const A = window.AO, D = A.resDebug, w = D.world();
    const orig = window.__orig || {};
    const golds = [], irons = [], provGold = [], ironByCtry = {};
    let alive = 0, aliveOrig = 0, goldPosAll = 0, goldPosOrig = 0;
    for (const c of w.countries) {
      if (!c || D.deadMap[c.id]) continue;
      alive++;
      const cen = D.ensureCentral(c.id);
      golds.push(cen.gold || 0);
      irons.push(cen.iron || 0);
      /* 全国铁库存 = 中央 + 这个国家所有省的省库铁（税铁落在省库，中央常年是 0） */
      ironByCtry[c.id] = (ironByCtry[c.id] || 0) + (cen.iron || 0);
      if ((cen.gold || 0) > 0) goldPosAll++;
      if (orig[c.id]) {
        aliveOrig++;
        if ((cen.gold || 0) > 0) goldPosOrig++;
      }
    }
    /* 停产省：这一省只要有一类建筑（资源 / 通用 / 装备厂）停着就算 */
    let halt = 0, gone = 0, richProv = 0;
    const provIron = [];
    for (const p of w.provinces) {
      if (!p) continue;
      const bag = A.resSim[p.id];
      if (!bag) continue;
      if (bag.gold && (bag.gold.stock || 0) > 80) richProv++;
      provGold.push((bag.gold && bag.gold.stock) || 0);
      const pi = (bag.iron && bag.iron.stock) || 0;
      provIron.push(pi);
      ironByCtry[p.owner] = (ironByCtry[p.owner] || 0) + pi;
      let h = false;
      for (const k in bag) {
        const s = bag[k];
        if (s && s.built > 0 && s.halted) { h = true; break; }
      }
      if (!h) {
        const civil = { school: A.resSchool, market: A.resMarket, builder: A.resBuilder,
          granary: A.resGranary, university: A.resUniversity, factory: A.resFactory };
        for (const k of ['school', 'market', 'builder', 'granary', 'university',
          'barracks', 'armory', 'stable', 'foundry', 'shipyard', 'factory']) {
          const tb = (A.resMil && A.resMil[k]) || civil[k];
          const st = tb && tb[p.id];
          if (st && st.n > 0 && st.halted) { h = true; break; }
        }
      }
      if (h) halt++;
      if (bag.iron && bag.iron.gone) gone++;
      if (bag.gold && bag.gold.gone) gone++;
    }
    const RS = D.remitStat || { n: 0, gold: 0 };
    return {
      turn: D.turn(), alive: alive, aliveOrig: aliveOrig, halt: halt, gone: gone,
      nC: w.countries.length, nP: w.provinces.length,
      golds: golds, irons: irons, provGold: provGold, provIron: provIron,
      ctryIron: Object.keys(ironByCtry).map(k => ironByCtry[k]),
      goldPos: goldPosAll, goldPosOrig: goldPosOrig,
      ironPos: irons.filter(v => v > 0).length,
      richProv: richProv,
      remitN: RS.n | 0, remitGold: Math.round(RS.gold || 0),
      wash: Object.keys(A.resWash || {}).length,
      smelt: Object.keys(A.resSmelt || {}).length,
      sell: (A.aiDebug.war.sell | 0)
    };
  });

  async function run(legacy) {
    await regen();
    /* 记下"开局国有哪些"：后面起义国会往 countries 里加人，分母要分得清 */
    await page.evaluate(() => {
      const D = window.AO.resDebug, w = D.world();
      window.__orig = {};
      for (const c of w.countries) if (c) window.__orig[c.id] = 1;
      D.choosePlayer(w.countries[0].id);
    });
    await setV18(!legacy);
    const t0 = Date.now();
    let s50 = null;
    for (let i = 1; i <= TURNS; i++) {
      await page.evaluate(() => {
        const D = window.AO.resDebug;
        D.settleTurn();
        if (D.evtPending && D.evtPending()) D.evtPick(0);
      });
      if (i === 50) s50 = await snap();
    }
    const s100 = await snap();
    /* v18 追加一补课：再跑 50 回合取 T150 的保险线（**两遍都跑**，
     * 否则"改前趋零"那个分母就没有了）。 */
    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => {
        const D = window.AO.resDebug;
        D.settleTurn();
        if (D.evtPending && D.evtPending()) D.evtPick(0);
      });
    }
    const s150 = await snap();
    return { s50, s100, s150, ms: Date.now() - t0 };
  }

  console.log('跑改前基线（六个开关全关）…');
  const base = await run(true);
  console.log('跑 v18（开关全开）…');
  const now = await run(false);
  const s150 = now.s150;

  const W = [10, 10, 10, 10, 10, 8, 8, 8];
  const R = [false, true, true, true, true, true, true, true];
  console.log('');
  console.log('=== bench-lifeline：' + CTRY + ' 国 × ' + TURNS + ' 回合挂机（seed ' + SEED + '）===');
  console.log(row(['', 'T50 金中位', 'T50 铁中位', 'T100 金中位', 'T100 铁中位', '省库金中位', '停产省', 'gone 矿', '存活国'], W, R));
  console.log(W.map(w => '─'.repeat(w)).join(' '));
  const line = (cn, s) => row([cn,
    f1(med(s.s50.golds)), f1(med(s.s50.irons)),
    f1(med(s.s100.golds)), f1(med(s.s100.irons)),
    f1(med(s.s100.provGold)),
    s.s100.halt, s.s100.gone, s.s100.alive], W, R);
  console.log(line('改前基线', base));
  console.log(line('v18', now));
  console.log('');
  console.log('世界：' + now.s100.nC + ' 国 / ' + now.s100.nP + ' 省（目标 ' + CTRY + ' 国 / ' + PROV + ' 省；' +
    '多出来的是叛乱独立的新生国）');
  const pct = (a, b) => Math.round(a / Math.max(1, b) * 100) + '%';
  console.log('中央金 > 0：开局国 改前 ' + base.s100.goldPosOrig + '/' + base.s100.aliveOrig +
    '（' + pct(base.s100.goldPosOrig, base.s100.aliveOrig) + '） → v18 ' +
    now.s100.goldPosOrig + '/' + now.s100.aliveOrig +
    '（' + pct(now.s100.goldPosOrig, now.s100.aliveOrig) + '）');
  console.log('中央金 > 0：全体存活国 改前 ' + base.s100.goldPos + '/' + base.s100.alive +
    '（' + pct(base.s100.goldPos, base.s100.alive) + '） → v18 ' +
    now.s100.goldPos + '/' + now.s100.alive + '（' + pct(now.s100.goldPos, now.s100.alive) + '）');
  console.log('中央铁 > 0：开局国 改前 ' + base.s100.ironPos + ' → v18 ' + now.s100.ironPos +
    '　·　省库金 > 80 的省（上解有燃料）改前 ' + base.s100.richProv + ' → v18 ' + now.s100.richProv);
  console.log('省库上解累计：改前 ' + base.s100.remitN + ' 笔 / ' + base.s100.remitGold + ' 金 → v18 ' +
    now.s100.remitN + ' 笔 / ' + now.s100.remitGold + ' 金');
  console.log('枯竭矿的再就业：改前 熔旧坊 ' + base.s100.smelt + ' 省 / 淘金场 ' + base.s100.wash +
    ' 省 → v18 熔旧坊 ' + now.s100.smelt + ' 省 / 淘金场 ' + now.s100.wash + ' 省');
  console.log('AI 卖货成交：v18 ' + now.s100.sell + ' 手（改前 ' + base.s100.sell + ' 手）');
  console.log('T150 保险线（两遍各多跑 50 回合）：全国铁库存中位 改前 ' +
    f1(med(base.s150.ctryIron)) + ' → v18 ' + f1(med(s150.ctryIron)) +
    '（逐省 ' + f1(med(s150.provIron)) + ' · 中央 ' + f1(med(s150.irons)) +
    ' · 存活开局国 ' + s150.aliveOrig + '/' + CTRY + '）');
  console.log('耗时：改前 ' + (base.ms / 1000).toFixed(1) + 's · v18 ' + (now.ms / 1000).toFixed(1) + 's');
  console.log('');

  /* ---------------- 拍板线 ----------------
   * v18.3 起 ② 从"较改前减半"改成**绝对线 140**：改前基线会随开关一起变，
   * 用比值判会让"两边一起烂"也算达标（250 → 216 是 ×0.86，但离"能活"很远）。
   * ③ 是新加的：中央金中位 > 0 —— 占比那条只看"有没有"，这条看"够不够用"。 */
  const ratio = now.s100.goldPosOrig / Math.max(1, now.s100.aliveOrig);
  const ratioBase = base.s100.goldPosOrig / Math.max(1, base.s100.aliveOrig);
  const haltCut = base.s100.halt ? now.s100.halt / base.s100.halt : 1;
  const goldMed100 = med(now.s100.golds);
  console.log('判定：');
  console.log('　① T100 中央金 > 0 的开局国占比 ≥ 70% —— ' + pct(now.s100.goldPosOrig, now.s100.aliveOrig) +
    '（改前 ' + pct(base.s100.goldPosOrig, base.s100.aliveOrig) + '）　' + (ratio >= 0.70 ? '✔' : '✘'));
  console.log('　② 停产省 ≤ 140 —— ' + now.s100.halt + '（改前 ' + base.s100.halt +
    '，×' + haltCut.toFixed(2) + '）　' + (now.s100.halt <= 140 ? '✔' : '✘'));
  console.log('　③ T100 中央金中位 > 0 —— ' + f1(goldMed100) + '　' + (goldMed100 > 0 ? '✔' : '✘'));
  console.log('　④ gone 矿不再无解（熔旧坊 + 淘金场有落地）—— 炉 ' + now.s100.smelt +
    ' 省 / 场 ' + now.s100.wash + ' 省　' + ((now.s100.smelt + now.s100.wash) > 0 ? '✔' : '✘'));
  console.log('　⑤ 世界没被打崩（存活开局国 ≥ 2/3）—— ' + now.s100.aliveOrig + '/' + CTRY + '　' +
    (now.s100.aliveOrig >= Math.ceil(CTRY * 2 / 3) ? '✔' : '✘'));
  console.log('　⑥ 中央金 > 0 的占比确实变好（改前 → 改后 至少翻倍）—— ' +
    pct(ratioBase, 1) + ' → ' + pct(ratio, 1) + '　' + (ratio >= ratioBase * 2 ? '✔' : '✘'));
  /* v18 追加一补课：铁矿从"采空即永久枯竭"改成"深层休眠 48 回合"。
   * 150 回合后**全国铁库存（中央 + 所有省库）的中位**还 > 0，就说明这个世界
   * 没有被铁荒锁死。为什么用"一国合计"而不是"逐省中位"：维护每回合都在吃铁，
   * 一半的省常年是 0，逐省中位永远是 0，测不出托底。
   * 改前基线那一侧把 iron.cool 关回 0（采空即死），所以"改前趋零"是可比的。 */
  console.log('　⑦ T150 全国铁库存中位 > 0（铁缓再生给无矿国保底）—— 改前 ' +
    f1(med(base.s150.ctryIron)) + ' → v18 ' + f1(med(s150.ctryIron)) + '　' +
    (med(s150.ctryIron) > 0 ? '✔' : '✘'));
  console.log('');
  console.log('（老 bench-econ 策略 H 的四条判定要单独跑：node test/bench-econ.js）');

  if (errors.length) console.log('\n运行时错误：\n' + errors.join('\n'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
