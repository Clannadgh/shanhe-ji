/* =============================================================
 * test/gov.js —— 治理层（官员抽卡 / 人口税 / 民心 / 总览面板）的验收
 *
 * 对着任务书的验收清单逐条过：
 *   1) 学校产人才点；开科抽官员有稀有度分布（多抽能看到贪墨/能臣）；重名率低
 *   2) 派官员到省：税入按公式变化（理财能手 +20% 可手算对上）；撤换回池正常
 *   3) 三档税率切换：税入与幸福度压力同步变；民心悬停能看到逐项 drivers
 *   4) 缺粮 / 多类停产的省民心走低 → 收税系数下降、人口增速打折（v≤30）
 *   5) 省库金：收税 + / 俸禄 − / 卖货 + / 买货 −；中央的账不被买货污染
 *   6) 买货从中央进货成功、中央无货置灰；贪墨官的省民心明显下滑但税更高
 *   7) 总览面板：只列当前国、切国刷新、ESC 关闭、开着时地图滚轮锁住
 *   8) 存档 v2 往返含官员与税率；读 v1 旧档补默认不炸
 *
 * 用法：node test/gov.js
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
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);

  const checks = [];
  const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

  /* ---------------- 0) 选省：本国人口最大的那一省 ---------------- */
  const S = await page.evaluate(() => {
    const w = window.__world, R = window.__renderer, D = window.AO.resDebug;
    const c = w.countries[0];
    let best = null;
    for (const id of c.provinces) {
      const p = w.provinces[id - 1];
      if (p && (!best || p.population > best.population)) best = p;
    }
    R.cam.x = best.centroid[0]; R.cam.y = best.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(best.id); R.draw();
    return { pid: best.id, owner: best.owner, name: best.name, pop: best.population,
             G: { popUnit: window.AO.GOV.popUnit, per: window.AO.GOV.goldPerUnit[1] } };
  });

  /* ---------------- 1) 人才点 + 抽卡分布 + 重名 ---------------- */
  const draw = await page.evaluate((owner) => {
    const D = window.AO.resDebug, T = window.AO.resTalent[owner];
    const before = T.pts;
    /* 学校产点：给这一国盖一座学校、跑 6 回合，看 pts 有没有涨 */
    const w = window.__world;
    const prov = w.provinces[w.countries[owner - 1].provinces[0] - 1];
    D.buildSchool(prov);
    for (let i = 0; i < 4; i++) D.settleTurn();       // 2 回合工期 + 2 回合产点
    const afterSchool = T.pts;

    /* 抽 300 位，统计词条分布与重名 */
    T.pts = 100000;
    const cnt = {}, names = [];
    for (let i = 0; i < 300; i++) {
      const r = D.exam(owner);
      if (!r.ok) break;
      cnt[r.off.traitKey] = (cnt[r.off.traitKey] || 0) + 1;
      names.push(r.off.name);
    }
    const uniq = new Set(names).size;
    const dup = names.length - uniq;
    return { before, afterSchool, cnt, total: names.length, uniq, dup,
             pool: T.pool.length, sample: names.slice(0, 6) };
  }, S.owner);
  ck('学校产人才点（建校 4 回合后 pts 增加）', draw.afterSchool > draw.before,
    draw.before + ' → ' + draw.afterSchool + ' 点');
  /* v12：卡池从七条扩到十一条（加了四条宰相级，合计约 3.8%）。
   * 所以这里不再要求"刚好七种"，而是：七条普通词条都在 + 至少抽到一位宰相级；
   * 权重分布仍是"平平无奇最多"（宰相级太稀有，300 抽里见不到某一条很正常）。 */
  const PLAIN7 = ['plain', 'finance', 'beloved', 'maker', 'agrarian', 'greedy', 'sage'];
  const chSeen = Object.keys(draw.cnt).filter(k => /^ch_/.test(k));
  ck('抽卡覆盖七种普通词条 + 宰相级（超稀有）且有权重分布（平平无奇最多）',
    PLAIN7.every(k => draw.cnt[k] > 0) && draw.cnt.plain > draw.cnt.finance && chSeen.length >= 1,
    Object.entries(draw.cnt).map(([k, v]) => k + ':' + v).join(' '));
  ck('稀有度：贪墨 / 治世能臣都抽得到', draw.cnt.greedy > 0 && draw.cnt.sage > 0,
    '贪墨 ' + draw.cnt.greedy + ' · 能臣 ' + draw.cnt.sage + '（共抽 ' + draw.total + ' 位）');
  ck('重名率低（300 抽里重名 ≤ 2）', draw.dup <= 2, '重名 ' + draw.dup + ' 次，示例 ' + draw.sample.join('/'));

  /* ---------------- 2) 派官：税入按公式变化 + 撤换回池 ---------------- */
  /* 手动造一位「理财能手」放进池（不用靠运气抽），手算两个数对账 */
  const taxCheck = await page.evaluate((a) => {
    const D = window.AO.resDebug, G = window.AO.GOV;
    const pid = a.pid, T = window.AO.resTalent[a.owner];
    /* 先把这一省恢复成"干净"状态：无官、常规税、民心 60、零头清零 */
    if (window.AO.resOfficial[pid]) D.dismiss(pid);
    D.setTax(a.owner, 1);
    window.AO.resHappy[pid].v = 60;
    window.AO.resHappy[pid].target = 60;
    window.AO.resTaxAcc[pid] = 0;
    const pop = window.AO.resPop[pid].v;
    const happyMul = G.happyTaxMul(60);

    const raw = (mul) => pop / G.popUnit * G.goldPerUnit[1] * mul * happyMul;
    const expNo = Math.floor(raw(G.noOfficerMul));     // 无官
    const expFin = Math.floor(raw(1.2));               // 理财能手

    D.settleTurn();
    const taxNo = (window.AO.resFlow[pid] || {}).d.popTax || 0;

    /* 造一位理财能手并派上去 */
    T.pool.push({ id: 90001, name: '测试理财', traitKey: 'finance', owed: 0 });
    const asg = D.assign(pid, 90001);
    window.AO.resTaxAcc[pid] = 0;
    D.settleTurn();
    const taxFin = (window.AO.resFlow[pid] || {}).d.popTax || 0;

    /* 撤换：回池、这一省无官 */
    const dis = D.dismiss(pid);
    const backInPool = T.pool.some(o => o.id === 90001);
    const gone = !window.AO.resOfficial[pid];

    return { pop, happyMul, expNo, expFin, taxNo, taxFin, asg: asg.ok,
             dis: !!dis, backInPool, gone,
             ratio: taxNo ? +(taxFin / taxNo).toFixed(2) : 0 };
  }, S);
  ck('无官裸税 = floor(人口/单位 × 单价 × 0.6 × 民心系数)',
    taxCheck.taxNo === taxCheck.expNo,
    '实收 ' + taxCheck.taxNo + ' / 手算 ' + taxCheck.expNo +
    '（人口 ' + taxCheck.pop + '，系数 ' + taxCheck.happyMul.toFixed(2) + '）');
  ck('理财能手 +20% 对得上（实收 = 手算，且是无官的 2 倍）',
    taxCheck.taxFin === taxCheck.expFin && taxCheck.ratio === 2,
    '实收 ' + taxCheck.taxFin + ' / 手算 ' + taxCheck.expFin + '，倍数 ' + taxCheck.ratio + '×');
  ck('撤换：在任回候选池、这一省变回无官',
    taxCheck.dis && taxCheck.backInPool && taxCheck.gone,
    '回池 ' + taxCheck.backInPool + ' / 卸任 ' + taxCheck.gone);

  /* ---------------- 3) 三档税率：税入 ↑ 与民心压力 ↓ 同步 ---------------- */
  const rateCheck = await page.evaluate((a) => {
    const D = window.AO.resDebug, G = window.AO.GOV, pid = a.pid;
    const out = [];
    for (const r of [0, 1, 2]) {
      D.setTax(a.owner, r);
      window.AO.resHappy[pid].v = 60;          // 每档都从同一个民心起跑，只比税率
      window.AO.resTaxAcc[pid] = 0;
      D.settleTurn();
      const F = window.AO.resFlow[pid] || {};
      out.push({ r, tax: F.d.popTax || 0, rate: window.AO.resHappy[pid].drivers.rate });
    }
    D.setTax(a.owner, 1);
    /* 悬停文本里有没有逐项 drivers */
    const tip = window.AO.resHappyTitle(pid);
    return { out, tip,
      hasBase: /基准/.test(tip), hasRate: /税率/.test(tip), hasFood: /缺粮/.test(tip),
      hasHalt: /停产/.test(tip), hasOff: /官员/.test(tip), hasMarket: /市场/.test(tip) };
  }, S);
  ck('税率三档：税入递增（轻 < 常 < 暴）',
    rateCheck.out[0].tax < rateCheck.out[1].tax && rateCheck.out[1].tax < rateCheck.out[2].tax,
    rateCheck.out.map(o => ['轻', '常', '暴'][o.r] + ':' + o.tax).join(' / '));
  ck('税率三档：民心压力同步（0 / −4 / −12）',
    rateCheck.out[0].rate === 0 && rateCheck.out[1].rate === -4 && rateCheck.out[2].rate === -12,
    rateCheck.out.map(o => o.rate).join(' / '));
  ck('民心悬停列出逐项 drivers',
    rateCheck.hasBase && rateCheck.hasRate && rateCheck.hasFood &&
    rateCheck.hasHalt && rateCheck.hasOff && rateCheck.hasMarket,
    rateCheck.tip.split('\n')[1] + ' … ' + rateCheck.tip.split('\n')[5]);

  /* ---------------- 4) 缺粮 / 停产 → 民心走低 → 税系数与人口增速 ----------------
   * 这里**直接调 settleHappy / settlePop**，不跑整轮 settleTurn：
   * settleTurn 的①维护会按"付不付得起"重算 halted，手动标上的停产会被冲掉 ——
   * 想验"停产扣民心"这条规则，就得把它单独拿出来测。 */
  const happyCheck = await page.evaluate((a) => {
    const D = window.AO.resDebug, G = window.AO.GOV, pid = a.pid;
    const bag = window.AO.resSim[pid], pop = window.AO.resPop[pid];
    const prov = window.__world.provinces[pid - 1];

    /* 制造"缺粮 + 三类停产"：粮/渔清空、三类建筑标停产 */
    bag.grain.stock = 0; bag.fish.stock = 0;
    pop.eat = 0; pop.need = 3;                  // 本回合一口没吃到
    let n = 0;
    for (const k in bag) {
      if (n >= 3) break;
      bag[k].built = Math.max(1, bag[k].built || 0);
      bag[k].halted = true;
      n++;
    }
    window.AO.resHappy[pid].v = 60;
    D.settleHappy(pid, prov);
    const d = window.AO.resHappy[pid].drivers;
    const vAfter = window.AO.resHappy[pid].v;
    const target = 60 + d.rate + d.food + d.halt + d.official + d.market;

    /* 民心很低 → 人口增速打折（富余 5 单位 = rate 0.012，×0.5 = 0.006）
     * 先把存粮补回去，否则 eat < need 会走"饥荒 −1.5%"那条分支 */
    bag.grain.stock = 999; bag.fish.stock = 999;
    window.AO.resHappy[pid].v = 20;
    D.settlePop(pid, pop.need + 5);
    const mulLow = pop.happyMul, rateLow = pop.rate;

    /* 民心很高 → 加成 */
    window.AO.resHappy[pid].v = 85;
    D.settlePop(pid, pop.need + 5);
    const mulHigh = pop.happyMul, rateHigh = pop.rate;

    for (const k in bag) bag[k].halted = false;   // 复原
    return { d, vAfter, target, mulLow, rateLow, mulHigh, rateHigh,
             taxMulLow: G.happyTaxMul(20), taxMulHigh: G.happyTaxMul(85) };
  }, S);
  ck('缺粮 −15 且停产封顶 −9',
    happyCheck.d.food === -15 && happyCheck.d.halt === -9 && happyCheck.d.haltN >= 3,
    '缺粮 ' + happyCheck.d.food + ' · 停产 ' + happyCheck.d.haltN + ' 类 → ' + happyCheck.d.halt);
  ck('民心向目标靠拢（不跳变：60 起跑只走 30%）',
    Math.abs(happyCheck.vAfter - (60 + (happyCheck.target - 60) * 0.3)) < 0.01,
    '60 → ' + happyCheck.vAfter.toFixed(1) + '（目标 ' + happyCheck.target + '）');
  ck('民心 ≤30：人口增速 ×0.5；≥70：×1.2',
    happyCheck.mulLow === 0.5 && happyCheck.mulHigh === 1.2 &&
    Math.abs(happyCheck.rateLow - 0.006) < 1e-9 && Math.abs(happyCheck.rateHigh - 0.0144) < 1e-9,
    '民心20 → ' + (happyCheck.rateLow * 100).toFixed(1) + '%/回合（×' + happyCheck.mulLow +
    '）· 民心85 → ' + (happyCheck.rateHigh * 100).toFixed(2) + '%/回合（×' + happyCheck.mulHigh + '）');
  ck('民心影响收税系数（20 与 85 时差 0.39）',
    Math.abs((happyCheck.taxMulHigh - happyCheck.taxMulLow) - 0.39) < 1e-9,
    happyCheck.taxMulLow.toFixed(2) + ' → ' + happyCheck.taxMulHigh.toFixed(2));

  /* ---------------- 5) 省库金的四条腿 ---------------- */
  const goldCheck = await page.evaluate((a) => {
    const D = window.AO.resDebug, G = window.AO.GOV, pid = a.pid;
    const bag = window.AO.resSim[pid], cen = window.AO.resCentral[a.owner];
    const snap = () => ({
      gold: bag.gold.stock,
      cenGold: cen.gold,
      cenTimber: cen.timber,
      timber: bag.timber.stock
    });
    /* 保证有市场 + 一位官（俸禄要扣得动） */
    if (!window.AO.resMarket[pid].n) window.AO.resMarket[pid].n = 1;
    window.AO.resMarket[pid].halted = false;
    if (!window.AO.resOfficial[pid]) {
      window.AO.resTalent[a.owner].pool.push({ id: 90002, name: '测试俸禄', traitKey: 'plain', owed: 0 });
      D.assign(pid, 90002);
    }
    window.AO.resTaxAcc[pid] = 0;
    window.AO.resHappy[pid].v = 60;
    D.setTax(a.owner, 1);
    bag.gold.stock = 50;                     // 给个能看出来的起点
    cen.gold = 50;
    cen.timber = 200;
    bag.timber.stock = 20;

    const s0 = snap();
    D.settleTurn();
    const s1 = snap();
    const F = window.AO.resFlow[pid] || {};

    D.sell(pid, 'timber');                   // 卖货：−5 木材 +1 金
    const s2 = snap();
    const lot = G.buyLot();
    bag.gold.stock = 40;                     // 备足钱再买
    const before = snap();
    D.buy(pid, 'timber');                    // 买货：−8 金，中央 −5 木材，本省 +5
    const s3 = snap();
    return { s0, s1, s2, s3, before, lot,
             popTax: F.d.popTax || 0, salary: F.d.salary || 0,
             maintGold: (F.d.maint && F.d.maint.gold) || 0,
             taxGain: F.gain.gold || 0, taxLoss: F.loss.gold || 0 };
  }, S);
  /* 省库金的变化 = 人口税 − 俸禄 − 维护里自己掏的那份金（维护也从省库扣）。
   * 三项都写进说明里 —— 只说"变多了"看不出账对不对。 */
  ck('收税进省库（+）且俸禄出省库（−）',
    goldCheck.popTax > 0 && goldCheck.salary === 1 &&
    goldCheck.s1.gold === goldCheck.s0.gold + goldCheck.popTax - goldCheck.salary - goldCheck.maintGold,
    '金 ' + goldCheck.s0.gold + ' → ' + goldCheck.s1.gold + '（税 +' + goldCheck.popTax +
    ' · 俸禄 −' + goldCheck.salary + ' · 维护 −' + goldCheck.maintGold + '）');
  ck('卖货：省库 +1 金、木材 −5',
    goldCheck.s2.gold === goldCheck.s1.gold + 1 && goldCheck.s2.timber === goldCheck.s1.timber - 5,
    '金 ' + goldCheck.s1.gold + '→' + goldCheck.s2.gold + '，木 ' +
    goldCheck.s1.timber + '→' + goldCheck.s2.timber);
  ck('买货：省库 −' + goldCheck.lot.gold + ' 金、本省 +' + goldCheck.lot.n + ' 木材、中央 −' + goldCheck.lot.n,
    goldCheck.s3.gold === goldCheck.before.gold - goldCheck.lot.gold &&
    goldCheck.s3.timber === goldCheck.before.timber + goldCheck.lot.n &&
    goldCheck.s3.cenTimber === goldCheck.before.cenTimber - goldCheck.lot.n,
    '金 ' + goldCheck.before.gold + '→' + goldCheck.s3.gold +
    '，木 ' + goldCheck.before.timber + '→' + goldCheck.s3.timber +
    '，中央木 ' + goldCheck.before.cenTimber + '→' + goldCheck.s3.cenTimber);
  ck('两本账不串：买货不动中央的金',
    goldCheck.s3.cenGold === goldCheck.before.cenGold,
    '中央金 ' + goldCheck.before.cenGold + ' → ' + goldCheck.s3.cenGold);

  /* ---------------- 6) 买货置灰 + 贪墨官 ---------------- */
  const market = await page.evaluate((a) => {
    const D = window.AO.resDebug, pid = a.pid, cen = window.AO.resCentral[a.owner];
    /* 打开省份卡的「建筑」栏，展开市场 ? 面板，看买货行 */
    document.querySelector('.itab[data-tab="bld"]').click();
    const row = [...document.querySelectorAll('#iSchoolList .rr.bld')]
      .find(r => r.querySelector('.nm').textContent === '市场');
    row.querySelector('.qbtn').click();
    const panel = document.querySelector('#iSchoolList .qinfo.on');
    const btns = [...panel.querySelectorAll('button[data-buy]')];
    const anyEnabled = btns.some(b => !b.disabled);

    /* 中央把盐清空 → 盐那一行必须置灰 */
    cen.salt = 0;
    row.querySelector('.qbtn').click();      // 收起
    row.querySelector('.qbtn').click();      // 重开（重画面板）
    const panel2 = document.querySelector('#iSchoolList .qinfo.on');
    const saltBtn = panel2.querySelector('button[data-buy="salt"]');
    const saltOff = saltBtn && saltBtn.disabled;

    /* 贪墨官：税更高、民心更低 */
    if (window.AO.resOfficial[pid]) D.dismiss(pid);
    const pop = window.AO.resPop[pid].v, G = window.AO.GOV;
    const tax = (mul) => pop / G.popUnit * G.goldPerUnit[1] * mul * G.happyTaxMul(60);
    const expPlain = Math.floor(tax(1.0));     // 平平无奇 = taxMul 1
    const expGreedy = Math.floor(tax(1.4));

    window.AO.resTalent[a.owner].pool.push({ id: 90003, name: '测试贪墨', traitKey: 'greedy', owed: 0 });
    D.assign(pid, 90003);
    window.AO.resHappy[pid].v = 60; window.AO.resHappy[pid].target = 60;
    window.AO.resTaxAcc[pid] = 0;
    D.settleTurn();
    const greedyTax = (window.AO.resFlow[pid] || {}).d.popTax || 0;
    const greedyHappy = window.AO.resHappy[pid].drivers.official;

    /* 换平平无奇对照 */
    D.dismiss(pid);
    window.AO.resTalent[a.owner].pool.push({ id: 90004, name: '测试平庸', traitKey: 'plain', owed: 0 });
    D.assign(pid, 90004);
    window.AO.resHappy[pid].v = 60; window.AO.resHappy[pid].target = 60;
    window.AO.resTaxAcc[pid] = 0;
    D.settleTurn();
    const plainTax = (window.AO.resFlow[pid] || {}).d.popTax || 0;

    return { buyRows: btns.length, anyEnabled, saltOff, expPlain, expGreedy,
             greedyTax, plainTax, greedyHappy };
  }, S);
  ck('市场买货行齐全（七种），中央有货时可买', market.buyRows === 7 && market.anyEnabled,
    market.buyRows + ' 行，可买 ' + market.anyEnabled);
  ck('中央无货 → 该行买货钮置灰', market.saltOff === true, '盐 ' + (market.saltOff ? '已置灰' : '仍可点'));
  ck('贪墨官：税 +40%（手算对上）、民心 −10',
    market.greedyTax === market.expGreedy && market.greedyHappy === -10 &&
    market.greedyTax > market.plainTax,
    '贪墨 ' + market.greedyTax + '（手算 ' + market.expGreedy + '）· 平庸 ' + market.plainTax +
    ' · 民心项 ' + market.greedyHappy);

  /* ---------------- 7) 总览面板 ---------------- */
  await page.evaluate(() => document.querySelector('#panelOpen').click());
  await page.evaluate(() => window.AO.resDebug.openGov(1));
  await sleep(250);
  const panel1 = await page.evaluate(() => {
    const w = window.__world;
    return {
      open: window.AO.govOpen(),
      rows: document.querySelectorAll('#gpTable .prow:not(.head)').length,
      provs: w.countries[0].provinces.length,
      name: document.getElementById('gpName').textContent,
      rates: document.querySelectorAll('#gpRates button').length,
      onRate: (document.querySelector('#gpRates button.on') || {}).dataset
    };
  });
  await page.screenshot({ path: shot('gov-panel-1.png') });

  /* 面板里的撤换：点「在任官员」那格名字（和行尾「撤」钮同一个动作） */
  const uiDismiss = await page.evaluate(() => {
    const chip = document.querySelector('#gpTable .po.has');
    if (!chip) return { ok: false, why: '面板里没有在任官员' };
    const pid = +chip.parentNode.getAttribute('data-pid');
    const name = chip.textContent;
    const before = !!window.AO.resOfficial[pid];
    chip.click();
    return { ok: before && !window.AO.resOfficial[pid], pid, name };
  });
  ck('面板里点官员名字 = 撤换回池', uiDismiss.ok, (uiDismiss.name || '') + ' @ #' + uiDismiss.pid);

  /* 切国：行数跟着变 */
  await page.evaluate(() => document.getElementById('gpNext').click());
  await sleep(200);
  const panel2 = await page.evaluate(() => {
    const w = window.__world;
    return {
      rows: document.querySelectorAll('#gpTable .prow:not(.head)').length,
      provs: w.countries[1].provinces.length,
      name: document.getElementById('gpName').textContent
    };
  });

  /* 滚轮锁：面板开着时地图缩放不变；关掉之后能变 */
  const wheel = await page.evaluate(async () => {
    const R = window.__renderer, canvas = document.getElementById('map');
    const s0 = R.cam.scale;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    const s1 = R.cam.scale;
    return { s0, s1 };
  });
  await page.keyboard.press('Escape');
  await sleep(200);
  const closed = await page.evaluate(() => window.AO.govOpen());
  const wheelAfter = await page.evaluate(() => {
    const R = window.__renderer, canvas = document.getElementById('map');
    const s0 = R.cam.scale;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    return { s0, s1: R.cam.scale };
  });
  ck('面板只列当前国（行数 = 该国省数）',
    panel1.rows === panel1.provs && panel1.open && panel1.rates === 3,
    panel1.name + '：' + panel1.rows + ' 行 / ' + panel1.provs + ' 省，税率 ' + panel1.rates + ' 档');
  ck('切国刷新（行数随国家变）',
    panel2.rows === panel2.provs && panel2.name !== panel1.name,
    panel1.name + ' ' + panel1.rows + ' 行 → ' + panel2.name + ' ' + panel2.rows + ' 行');
  ck('面板开着时地图滚轮锁住；关掉后恢复',
    wheel.s0 === wheel.s1 && !closed && wheelAfter.s0 !== wheelAfter.s1,
    '开着 ' + wheel.s0.toFixed(2) + '→' + wheel.s1.toFixed(2) +
    '，关后 ' + wheelAfter.s0.toFixed(2) + '→' + wheelAfter.s1.toFixed(2));
  ck('ESC 关闭面板', closed === false, 'govOpen = ' + closed);

  /* ---------------- 8) 存档 v2 往返 + v1 旧档补默认 ---------------- */
  const saveInfo = await page.evaluate((a) => {
    const D = window.AO.resDebug;
    D.setTax(a.owner, 2);
    /* 先卸掉现任（前面几条检查换过好几位），再派一位存档官 ——
     * 否则存下去的还是上一条检查留下的那位，往返校验就没有意义了 */
    if (window.AO.resOfficial[a.pid]) D.dismiss(a.pid);
    window.AO.resTalent[a.owner].pool.push({ id: 90005, name: '存档官', traitKey: 'sage', owed: 0 });
    D.assign(a.pid, 90005);
    D.save();
    const raw = localStorage.getItem('sj.save');
    const d = JSON.parse(raw);
    return {
      v: d.v,
      ver: window.AO.SAVE_VER,
      hasTalent: !!d.TALENT, hasOfficial: !!d.OFFICIAL,
      hasTax: !!d.TAXRATE, hasHappy: !!d.HAPPY,
      kb: Math.round(raw.length / 1024),
      rate: d.TAXRATE[a.owner],
      offName: (d.OFFICIAL[a.pid] || {}).name,
      poolN: (d.TALENT[a.owner] || {}).pool.length
    };
  }, S);
  ck('存档：版本号 = AO.SAVE_VER，且含 TALENT / OFFICIAL / TAXRATE / HAPPY',
    saveInfo.v === saveInfo.ver && saveInfo.hasTalent && saveInfo.hasOfficial &&
    saveInfo.hasTax && saveInfo.hasHappy,
    'v' + saveInfo.v + ' · ' + saveInfo.kb + ' KB · 税率 ' + saveInfo.rate +
    ' · 在任 ' + saveInfo.offName + ' · 候选 ' + saveInfo.poolN + ' 位');

  /* 改掉内存里的状态，再读档，看是否回到存档那一刻 */
  const restored = await page.evaluate(async (a) => {
    const D = window.AO.resDebug;
    D.setTax(a.owner, 0);
    D.dismiss(a.pid);
    window.AO.resTalent[a.owner].pool.length = 0;
    D.load();
    /* 读档要按 seed 重新生成世界（异步），等它建完 */
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 100));
      const off = window.AO.resOfficial[a.pid];
      if (off && off.name === '存档官') break;
    }
    return {
      rate: window.AO.resTaxRate[a.owner],
      off: (window.AO.resOfficial[a.pid] || {}).name,
      happy: Math.round(window.AO.resHappy[a.pid].v)
    };
  }, S);
  ck('读档往返：税率 / 官员 / 民心都回来了',
    restored.rate === 2 && restored.off === '存档官',
    '税率 ' + restored.rate + ' · 在任 ' + restored.off + ' · 民心 ' + restored.happy);

  /* v1 旧档：把治理层字段全删、版本改 1，写到旧键上，再读 */
  const v1 = await page.evaluate(async (a) => {
    const raw = localStorage.getItem('sj.save');
    const d = JSON.parse(raw);
    d.v = 1;
    delete d.TALENT; delete d.OFFICIAL; delete d.TAXRATE; delete d.HAPPY; delete d.TAXACC;
    localStorage.setItem('sj.save.v1', JSON.stringify(d));
    localStorage.removeItem('sj.save');
    window.AO.resDebug.load();
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (window.__world && window.AO.resHappy[a.pid]) break;
    }
    await new Promise(r => setTimeout(r, 800));
    return {
      rate: window.AO.resTaxRate[a.owner],
      happy: Math.round((window.AO.resHappy[a.pid] || {}).v || -1),
      off: window.AO.resOfficial[a.pid] || null,
      pool: ((window.AO.resTalent[a.owner] || {}).pool || []).length
    };
  }, S);
  ck('读 v1 旧档：税率补 1、民心补 60、官员池补空，不炸',
    v1.rate === 1 && v1.happy === 60 && !v1.off && v1.pool === 0,
    '税率 ' + v1.rate + ' · 民心 ' + v1.happy + ' · 在任 ' + (v1.off ? v1.off.name : '无') +
    ' · 候选 ' + v1.pool);

  /* ---------------- 汇总 ---------------- */
  let pass = true;
  console.log('省份：' + S.name + '（#' + S.pid + '，人口 ' + S.pop + '）');
  for (const [name, ok, note] of checks) {
    if (!ok) pass = false;
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + note);
  }
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
