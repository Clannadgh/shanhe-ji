/* =============================================================
 * test/aoc2-core.js —— 阶段一（换骨架）的验收
 *
 * 对着任务书阶段一第 9 条逐项过：
 *   1) 省 / 国新字段齐全且互相自洽（人口表 / 经济 ≤ 人口 / 发展度区间）
 *   2) 结算顺序：省收入 → 国库 → 行政费 → 物资 → 幸福 → 稳定 → 增长
 *   3) 加税 → 幸福降（稳定跟着降）
 *   4) 经济投资上限 = 人口
 *   5) 发展度自然增长 1.0 封顶；投资能越过 1.0，最高 2.0
 *   6) 三敕令数值（节日 / 投资经济 / 投资发展）与移动点消耗
 *   7) 旧档（v6 及以下）拒读提示
 *   8) 存档往返一致
 *
 * 用法：node test/aoc2-core.js
 * ============================================================= */
'use strict';
const AO = require('./load').load([]);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS    ' + name + (detail ? '  —  ' + detail : '')); }
  else { fail++; console.log('  FAIL    ' + name + (detail ? '  —  ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }

const world = AO.generate({ seed: 'aoh-2026', provinces: 1100, countries: 64 });
AO.aoc2.initWorld(world);

/* ---------------- 1. 字段齐全 ---------------- */
(function () {
  let bad = 0, badEcon = 0, badDev = 0, badStab = 0, badHappy = 0, badCore = 0, badVal = 0;
  for (const p of world.provinces) {
    if (!p) continue;
    const a = p.aoc;
    if (!a || !a.pop || typeof a.pop !== 'object') { bad++; continue; }
    if (a.econ > AO.aoc2.totalPop(p) + 0.001) badEcon++;
    if (!(a.dev >= AO.AOC2.DEV_MIN && a.dev <= AO.AOC2.DEV_MAX)) badDev++;
    if (!(a.stab >= AO.AOC2.STAB_MIN && a.stab <= AO.AOC2.STAB_MAX)) badStab++;
    if (!(a.happy >= AO.AOC2.HAPPY_MIN && a.happy <= AO.AOC2.HAPPY_MAX)) badHappy++;
    if (!a.core || !a.core[p.owner]) badCore++;
    if (!(a.value > 0)) badVal++;
  }
  ok('省字段齐全（人口表 / 经济 / 发展度 / 稳定 / 幸福 / 核心 / 价值）',
    bad + badEcon + badDev + badStab + badHappy + badCore + badVal === 0,
    '缺字段 ' + bad + ' · 经济超人口 ' + badEcon + ' · 发展度越界 ' + badDev +
    ' · 稳定越界 ' + badStab + ' · 幸福越界 ' + badHappy + ' · 核心缺 ' + badCore + ' · 价值缺 ' + badVal);

  let badC = 0, badSum = 0, badCap = 0, badGov = 0;
  for (const c of world.countries) {
    const a = c.aoc;
    if (!a || typeof a.treasury !== 'number' || typeof a.loans !== 'number' ||
      !a.sliders || typeof a.mp !== 'number' || typeof a.dip !== 'number') { badC++; continue; }
    const sum = a.sliders.tax + a.sliders.goods + a.sliders.research + a.sliders.invest;
    if (sum > 100) badSum++;
    if (a.taxRate > AO.AOC2.GOV[a.gov].taxCap) badCap++;
    if (a.gov !== 'monarchy') badGov++;
  }
  ok('国字段齐全（国库 / 贷款 / 税率 / 四滑条 / 政体 / 移动点 / 外交点）',
    badC + badSum + badCap + badGov === 0,
    '缺字段 ' + badC + ' · 滑条合计>100 ' + badSum + ' · 税率超上限 ' + badCap + ' · 非君主 ' + badGov);
})();

/* ---------------- 2. 结算顺序 ---------------- */
(function () {
  const c = world.countries[0];
  const before = c.aoc.treasury;
  /* player = 这个国：关掉 AI 的自动加税 / 余钱投资，账才对得上 */
  const P = { player: c.id };
  AO.aoc2.settle(world, P);
  const L = c.aoc.last;
  let incSum = 0;
  for (const pid of c.provinces) incSum += world.provinces[pid - 1].aoc.income;
  ok('省收入汇总 = 国毛收入', near(incSum, L.gross, 1e-6),
    'Σ省收入 ' + incSum.toFixed(2) + ' / 毛收入 ' + L.gross.toFixed(2));
  const expect = before + L.net;
  ok('国库变化 = 毛收入分配 − 行政 − 军费 − 利息',
    c.aoc.loans === 0 ? near(c.aoc.treasury, expect, 1e-6) : true,
    '国库 ' + c.aoc.treasury.toFixed(1) + '（净 ' + L.net.toFixed(1) + '）· 军费 ' + L.upkeep);
  ok('本阶段无兵 → 军费为 0（路径留着）', L.upkeep === 0, 'upkeep=' + L.upkeep);

  /* 物资滑条当回合就影响幸福目标：把物资拉满，幸福必须比上回合高 */
  const p0 = world.provinces[c.provinces[0] - 1];
  const h0 = p0.aoc.happy;
  c.aoc.sliders = { tax: 20, goods: 95, research: 5, invest: 5 };
  AO.aoc2.settle(world, P);
  ok('物资滑条提高 → 当回合幸福上升（顺序：物资在幸福之前）', p0.aoc.happy > h0,
    h0.toFixed(2) + ' → ' + p0.aoc.happy.toFixed(2));

  /* 幸福在稳定之前：幸福涨了，稳定也必须跟着涨（同一回合） */
  const s0 = p0.aoc.stab;
  AO.aoc2.settle(world, P);
  ok('幸福上升 → 稳定同回合跟着上升（顺序：幸福在稳定之前）', p0.aoc.stab > s0,
    s0.toFixed(2) + ' → ' + p0.aoc.stab.toFixed(2));
})();

/* ---------------- 3. 加税 → 幸福降 ---------------- */
(function () {
  const c = world.countries[1];
  c.aoc.sliders = { tax: 25, goods: 65, research: 5, invest: 5 };
  const P3 = { player: c.id };
  AO.aoc2.setTaxRate(c, 8);
  for (let i = 0; i < 12; i++) AO.aoc2.settle(world, P3);
  const happyLow = c.aoc.happy, stabLow = c.aoc.stab;

  AO.aoc2.setTaxRate(c, 25);
  for (let i = 0; i < 12; i++) AO.aoc2.settle(world, P3);
  const happyHigh = c.aoc.happy, stabHigh = c.aoc.stab;

  ok('加税（8% → 25%）→ 幸福降', happyHigh < happyLow,
    '幸福 ' + happyLow.toFixed(2) + ' → ' + happyHigh.toFixed(2));
  ok('加税 → 稳定跟着降', stabHigh < stabLow,
    '稳定 ' + stabLow.toFixed(2) + ' → ' + stabHigh.toFixed(2));
  ok('税率受政体上限约束（君主制 25%）', AO.aoc2.setTaxRate(c, 99) === 25,
    '设 99 实得 ' + c.aoc.taxRate);
})();

/* ---------------- 4. 经济投资上限 = 人口 ---------------- */
(function () {
  const c = world.countries[2];
  c.aoc.treasury = 1e9; c.aoc.mp = 1e9;
  const pid = c.provinces[0];
  const p = world.provinces[pid - 1];
  let guard = 0, r;
  do {
    r = AO.aoc2.decree(world, c.id, 'econ', pid);
    guard++;
  } while (r.ok && guard < 200);
  const tp = AO.aoc2.totalPop(p);
  ok('经济投资上限 = 人口', p.aoc.econ <= tp + 1e-6 && !r.ok,
    '经济 ' + p.aoc.econ.toFixed(1) + ' / 人口 ' + tp.toFixed(1) + '（' + guard + ' 次后 ' + r.msg + '）');
})();

/* ---------------- 5. 发展度 1.0 封顶 / 投资越线 / 2.0 上限 ---------------- */
(function () {
  const c = world.countries[3];
  const p = world.provinces[c.provinces[0] - 1];
  p.aoc.dev = 0.5;
  for (let i = 0; i < 400; i++) AO.aoc2.settle(world, { player: c.id });
  ok('发展度自然增长封顶 1.0', p.aoc.dev <= 1.0 + 1e-9 && p.aoc.dev > 0.95,
    '400 回合后 ' + p.aoc.dev.toFixed(4));

  c.aoc.treasury = 1e9; c.aoc.mp = 1e9;
  const r1 = AO.aoc2.decree(world, c.id, 'dev', p.id);
  ok('投资发展能越过 1.0', r1.ok && p.aoc.dev > 1.0, p.aoc.dev.toFixed(3));

  let guard = 0, r;
  do { r = AO.aoc2.decree(world, c.id, 'dev', p.id); guard++; } while (r.ok && guard < 200);
  ok('发展度上限 2.0', p.aoc.dev <= 2.0 + 1e-9 && !r.ok,
    p.aoc.dev.toFixed(3) + '（' + r.msg + '）');
})();

/* ---------------- 6. 三敕令数值 ---------------- */
(function () {
  const c = world.countries[4];
  const p = world.provinces[c.provinces[0] - 1];
  c.aoc.treasury = 1e9; c.aoc.mp = AO.AOC2.MP_BASE;
  const tp = AO.aoc2.totalPop(p);
  const h0 = p.aoc.happy, mp0 = c.aoc.mp, t0 = c.aoc.treasury;

  const rf = AO.aoc2.decree(world, c.id, 'festival', p.id);
  const gainWant = tp / 20000 * 0.1;
  const costWant = tp * 0.02;
  ok('节日：幸福 +0.1/2 万人口', rf.ok && near(p.aoc.happy - h0, gainWant, 0.02),
    '+' + (p.aoc.happy - h0).toFixed(4) + '（应 ' + gainWant.toFixed(4) + '）');
  ok('节日：花费 每人 0.02 金', near(t0 - c.aoc.treasury, Math.round(costWant), 1),
    '花费 ' + (t0 - c.aoc.treasury).toFixed(0) + '（应 ' + Math.round(costWant) + '）');
  ok('节日：扣移动点 ' + AO.AOC2.MP_COST.festival, c.aoc.mp === mp0 - AO.AOC2.MP_COST.festival,
    mp0 + ' → ' + c.aoc.mp);

  const e0 = p.aoc.econ, mpE = c.aoc.mp;
  const re = AO.aoc2.decree(world, c.id, 'econ', p.id);
  ok('投资经济：经济值上升且不超人口', re.ok && p.aoc.econ > e0 && p.aoc.econ <= tp + 1e-6,
    e0.toFixed(0) + ' → ' + p.aoc.econ.toFixed(0) + '（人口 ' + tp.toFixed(0) + '）');
  ok('投资经济：扣移动点 ' + AO.AOC2.MP_COST.econ, c.aoc.mp === mpE - AO.AOC2.MP_COST.econ);

  const d0 = p.aoc.dev, mpD = c.aoc.mp;
  const rd = AO.aoc2.decree(world, c.id, 'dev', p.id);
  ok('投资发展：+0.02', rd.ok && near(p.aoc.dev - d0, AO.AOC2.DEV_INVEST_STEP, 1e-9),
    d0.toFixed(2) + ' → ' + p.aoc.dev.toFixed(2));
  ok('投资发展：扣移动点 ' + AO.AOC2.MP_COST.dev, c.aoc.mp === mpD - AO.AOC2.MP_COST.dev);

  /* 移动点不足 → 拒绝 */
  c.aoc.mp = 0;
  const rNo = AO.aoc2.decree(world, c.id, 'festival', p.id);
  ok('移动点不够 → 敕令被拒', !rNo.ok, rNo.msg);

  /* 不是自己的省 → 拒绝 */
  c.aoc.mp = 99;
  const other = world.provinces.find(q => q && q.owner !== c.id);
  const rOwn = AO.aoc2.decree(world, c.id, 'festival', other.id);
  ok('别国的省 → 敕令被拒', !rOwn.ok, rOwn.msg);
})();

/* ---------------- 7. 旧档拒读 ---------------- */
(function () {
  const v6 = AO.aoc2.checkSaveVersion(6);
  const v7 = AO.aoc2.checkSaveVersion(7);
  ok('v6 旧档拒读且给出 legacy-v19 提示',
    !v6.ok && v6.legacy && /legacy-v19/.test(v6.msg), v6.msg);
  ok('v7 档可读', v7.ok === true);
  ok('SAVE_VER = 7', AO.AOC2.SAVE_VER === 7, 'v' + AO.AOC2.SAVE_VER);
})();

/* ---------------- 8. 存档往返 ---------------- */
(function () {
  const c = world.countries[5];
  const p = world.provinces[c.provinces[0] - 1];
  c.aoc.treasury = 12345; c.aoc.taxRate = 17;
  c.aoc.sliders = { tax: 30, goods: 55, research: 10, invest: 5 };
  p.aoc.dev = 1.234; p.aoc.happy = 66.6; p.aoc.stab = 44.4;
  const snap = AO.aoc2.save(world);

  c.aoc.treasury = 0; p.aoc.dev = 0.1; p.aoc.happy = 0;
  AO.aoc2.load(world, snap);
  ok('存档往返：国库 / 税率 / 滑条 / 发展度 / 幸福 / 稳定',
    c.aoc.treasury === 12345 && c.aoc.taxRate === 17 && c.aoc.sliders.tax === 30 &&
    near(p.aoc.dev, 1.234, 1e-9) && near(p.aoc.happy, 66.6, 0.05) && near(p.aoc.stab, 44.4, 0.05),
    '国库 ' + c.aoc.treasury + ' · 税率 ' + c.aoc.taxRate + ' · 发展度 ' + p.aoc.dev);
})();

console.log('\n总体: ' + (fail ? fail + ' 项失败' : '全部通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);
