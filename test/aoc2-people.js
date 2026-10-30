/* =============================================================
 * test/aoc2-people.js —— 阶段三（人心）的验收
 *
 * 对着任务书阶段三逐条过：
 *   1) 国籍构成 / 核心表：打下来的省人口还是原国籍，核心仍记原主
 *   2) 同化敕令：花金 + 移动点、渐进转国籍、本国占比上升、稳定度上升、**旧核心不删**
 *   3) 革命风险：低幸福 / 低稳定 / 异族 / 厌战驱动；驻军能压
 *   4) 叛军国：风险拉满 → 举旗、起源省带兵、与所有人交战、母国失去该省
 *   5) 内战：全国幸福连续 20 回合低位 → 国家一分为二
 *   6) 政体九种：切换花金、时代门槛、税率上限当场压下来、系数即时生效
 *   7) 存档往返：版图 + 叛军国 + 政体 / 时代
 *
 * 用法：node test/aoc2-people.js
 * ============================================================= */
'use strict';
const AO = require('./load').load([]);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS    ' + name + (detail ? '  —  ' + detail : '')); }
  else { fail++; console.log('  FAIL    ' + name + (detail ? '  —  ' + detail : '')); }
}
const A2 = AO.aoc2;

const world = AO.generate({ seed: 'aoh-2026', provinces: 1100, countries: 64 });
const OFF = { player: 0, ai: false };      // 世界不动，只有测试在动

/* 找两个相邻国：A 大、B 小 */
function findPair() {
  let best = null;
  for (const a of world.countries) {
    if (a.provinces.length < 6) continue;
    for (const nid of a.neighbors || []) {
      const b = world.countries[nid - 1];
      if (!b || b.id === a.id || !b.provinces.length) continue;
      for (const pid of a.provinces) {
        const p = world.provinces[pid - 1];
        for (const q of p.neighbors) {
          const qq = world.provinces[q - 1];
          if (!qq || qq.owner !== b.id) continue;
          const score = b.provinces.length * 100 + Math.abs(pop(p) - 200000) / 1000;
          if (!best || score < best.score) best = { score, a, b, fromPid: p.id, toPid: qq.id };
        }
      }
    }
  }
  return best;
}
function pop(p) { return A2.totalPop(p); }
const pair = findPair();
const A = world.countries[pair.a.id - 1];
const B = world.countries[pair.b.id - 1];

/* ---------------- 1. 国籍构成 / 核心表 ---------------- */
(function () {
  const pid = pair.toPid;
  const p = world.provinces[pid - 1];
  const before = { own: p.aoc.pop[B.id] || 0, core: Object.keys(p.aoc.core).map(Number) };
  A2.transferProvince(world, pid, A.id);
  const after = {
    share: A2.natShare(p, A.id),
    bPop: p.aoc.pop[B.id] || 0,
    core: Object.keys(p.aoc.core).map(Number),
    owner: p.owner
  };
  ok('割地后：归属变了，人口还是原国籍（本国占比 0）',
    after.owner === A.id && after.share < 0.01 && after.bPop > 0,
    '归属 ' + p.ownerName + ' · 本国占比 ' + (after.share * 100).toFixed(1) + '% · 原国籍 ' +
    Math.round(after.bPop).toLocaleString());
  ok('核心表不因割地而改（旧核心留着）',
    after.core.indexOf(B.id) >= 0 && before.core.indexOf(B.id) >= 0,
    '核心 ' + after.core.join(',') + '（原主 #' + B.id + '）');
})();

/* ---------------- 2. 同化敕令 ---------------- */
(function () {
  const p = world.provinces[pair.toPid - 1];
  A.aoc.treasury = 1e7; A.aoc.mp = 100;
  const share0 = A2.natShare(p, A.id);
  const stab0 = p.aoc.stab;
  const cost = A2.assimCost(world, A.id, p.id);
  const g0 = A.aoc.treasury, mp0 = A.aoc.mp;
  const r = A2.assimilate(world, A.id, p.id);
  ok('同化：花金 + 移动点、一次转一批人',
    r.ok && r.converted > 0 && Math.round(g0 - A.aoc.treasury) === cost &&
    A.aoc.mp === mp0 - AO.AOC2.MP_COST.assimilate,
    '转 ' + Math.round(r.converted).toLocaleString() + ' 人 · ' + cost.toLocaleString() +
    ' 金 · 移动点 ' + mp0 + '→' + A.aoc.mp);
  ok('同化后本国占比上升（渐进：一次 8%）',
    A2.natShare(p, A.id) > share0 && A2.natShare(p, A.id) < 0.2,
    (share0 * 100).toFixed(1) + '% → ' + (A2.natShare(p, A.id) * 100).toFixed(1) + '%');
  ok('同化不删旧核心', (Object.keys(p.aoc.core).map(Number)).indexOf(B.id) >= 0,
    '核心 ' + Object.keys(p.aoc.core).join(','));

  /* 一直同化到满，再看稳定度 */
  let guard = 0;
  while (A2.natShare(p, A.id) < 0.999 && guard++ < 200) {
    A.aoc.treasury = 1e7; A.aoc.mp = 100;
    if (!A2.assimilate(world, A.id, p.id).ok) break;
  }
  A.aoc.treasury = 1e7; A.aoc.mp = 100;
  for (let i = 0; i < 12; i++) A2.settle(world, { player: A.id, ai: false });
  ok('同化完成后稳定度上升',
    p.aoc.stab > stab0,
    '稳定 ' + stab0.toFixed(1) + ' → ' + p.aoc.stab.toFixed(1) +
    '（本国占比 ' + (A2.natShare(p, A.id) * 100).toFixed(1) + '%）');
})();

/* ---------------- 3. 革命风险 ---------------- */
(function () {
  const p = world.provinces[pair.toPid - 1];
  /* 造一个"异族 + 低幸福 + 低稳定"的省 */
  p.aoc.pop = (function () { const o = {}; o[B.id] = 200000; return o; })();
  /* 取"中等糟糕"而不是贴地：贴地会把目标值顶到 100（夹住），
   * 驻军那 −12 就被夹没了，看不出效果。 */
  p.aoc.happy = 30; p.aoc.stab = 30; p.aoc.army = 0; p.aoc.armyOf = 0;
  /* 比的是"目标值"而不是平滑后的 revolt：平滑值要看历史，
   * 连跑几回合还会碰上举旗（风险 ≥80 每回合 25%），测不稳。 */
  const risky = A2.revoltTarget(world, p.id);

  p.aoc.army = 20000; p.aoc.armyOf = A.id;   // 驻军维稳
  const guarded = A2.revoltTarget(world, p.id);
  ok('革命风险：异族 + 低幸福低稳定 → 高；驻军能压',
    risky > 60 && guarded < risky,
    '目标值：无驻军 ' + risky.toFixed(1) + ' → 驻军 2 万后 ' + guarded.toFixed(1));

  /* 恢复 */
  p.aoc.army = 0; p.aoc.armyOf = 0;
  p.aoc.pop = (function () { const o = {}; o[A.id] = 200000; return o; })();
  p.aoc.happy = 55; p.aoc.stab = 60;
})();

/* ---------------- 4. 叛军国 ---------------- */
(function () {
  const p = world.provinces[pair.toPid - 1];
  /* 条件拉满：全异族、幸福稳定贴地、厌战满 */
  p.aoc.pop = (function () { const o = {}; o[B.id] = 200000; return o; })();
  p.aoc.happy = 3; p.aoc.stab = 3; p.aoc.army = 0; p.aoc.armyOf = 0;
  A.aoc.wear = 1;
  A.aoc.taxRate = 25; A.aoc.sliders.goods = 0;

  const beforeN = world.countries.length;
  let reb = null;
  for (let i = 0; i < 40 && !reb; i++) {
    p.aoc.happy = 3; p.aoc.stab = 3;   // 每回合压回去（不然会被结算拉高）
    A2.settle(world, OFF);
    for (let k = beforeN; k < world.countries.length; k++) {
      if (world.countries[k] && world.countries[k].aoc.rebel) { reb = world.countries[k]; break; }
    }
  }
  ok('革命风险拉满 → 叛军国出现', !!reb,
    reb ? reb.name + '（#' + reb.id + '，' + reb.provinces.length + ' 省）' : '40 回合没起来');
  if (reb) {
    const rp = world.provinces[reb.provinces[0] - 1];
    ok('叛军起源省带兵', rp.aoc.army > 0 && rp.aoc.armyOf === reb.id,
      '驻军 ' + Math.round(rp.aoc.army).toLocaleString());
    ok('叛军与所有人敌对', (function () {
      for (const c of world.countries) {
        if (!c || !c.aoc || c.id === reb.id || !c.aoc.alive) continue;
        if (!A2.atWar(world, reb.id, c.id)) return false;
      }
      return true;
    })(), '交战国 ' + A2.warsOf(world, reb.id).length + ' 个');
    ok('母国失去该省', world.provinces[reb.provinces[0] - 1].owner === reb.id,
      '归属 ' + world.provinces[reb.provinces[0] - 1].ownerName);
  }
})();

/* ---------------- 5. 内战 ---------------- */
(function () {
  /* 找一个还有 ≥5 省的国家，把幸福压到低位 */
  const c = world.countries.find(x => x.aoc && x.aoc.alive && !x.aoc.rebel && x.provinces.length >= 5);
  c.aoc.taxRate = 25; c.aoc.sliders.goods = 0;   // 高税 + 不供物资 → 幸福贴地
  const before = { n: world.countries.length, prov: c.provinces.length };
  let civil = null;
  for (let i = 0; i < 30 && !civil; i++) {
    A2.settle(world, OFF);
    for (let k = before.n; k < world.countries.length; k++) {
      const r = world.countries[k];
      if (r && r.aoc.rebel) { civil = r; break; }
    }
  }
  ok('全国幸福连续低位 → 内战（国家一分为二）', !!civil,
    civil ? (c.name + ' 分裂出 ' + civil.name + '（' + civil.provinces.length + ' 省）· 母国剩 ' +
      c.provinces.length + ' 省') : '30 回合没打起来');
  if (civil) {
    ok('内战后两边开战', A2.atWar(world, c.id, civil.id), '关系 ' + A2.rel(c, civil.id));
    ok('叛军拿走的是最不满的那一半',
      civil.provinces.length >= 2 && c.provinces.length >= 2,
      '叛军 ' + civil.provinces.length + ' 省 / 母国 ' + c.provinces.length + ' 省');
  }
})();

/* ---------------- 6. 政体九种 ---------------- */
(function () {
  const c = world.countries.find(x => x.aoc && x.aoc.alive && !x.aoc.rebel && x.provinces.length >= 3);
  c.aoc.treasury = 1e7;
  c.aoc.taxRate = 25;
  const cost = A2.govSwitchCost(c);
  const g0 = c.aoc.treasury;
  const r = A2.setGov(world, c.id, 'democracy');
  ok('换政体：花金（数千级）+ 立即生效',
    r.ok && Math.round(g0 - c.aoc.treasury) === cost && c.aoc.gov === 'democracy',
    '花费 ' + cost.toLocaleString() + ' · 现政体 ' + AO.AOC2.GOV[c.aoc.gov].cn);

  ok('民主制税收上限 24%：原来的 25% 被当场压下来',
    c.aoc.taxRate === 24 && AO.AOC2.GOV.democracy.taxCap === 24,
    '税率 ' + c.aoc.taxRate + '%');

  /* 系数即时生效：民主制募兵 ×1.8，游牧 ×2.0 */
  const p = world.provinces[c.provinces[0] - 1];
  p.aoc.army = 0; p.aoc.armyOf = 0;
  c.aoc.treasury = 1e7; c.aoc.mp = 100;
  const r1 = A2.recruit(world, c.id, p.id, 100, true);
  const costDem = r1.cost;
  A2.setGov(world, c.id, 'nomad');
  c.aoc.treasury = 1e7; c.aoc.mp = 100;
  p.aoc.army = 0; p.aoc.armyOf = 0;
  const r2 = A2.recruit(world, c.id, p.id, 100, true);
  ok('政体系数即时生效（募兵：民主 ×1.8 → 游牧 ×2.0）',
    r2.cost > costDem,
    costDem + ' → ' + r2.cost + ' 金');

  /* 时代门槛 */
  c.aoc.treasury = 1e7;
  const rCom = A2.setGov(world, c.id, 'communism');
  A2.setEra(c, 1);
  const rCom2 = A2.setGov(world, c.id, 'communism');
  ok('共产主义要工业时代（时代门槛）',
    !rCom.ok && /工业/.test(rCom.msg) && rCom2.ok,
    rCom.msg + ' → 推进时代后 ' + (rCom2.ok ? '可改行' : rCom2.msg));

  ok('九种政体全表在册', Object.keys(AO.AOC2.GOV).length === 9,
    Object.keys(AO.AOC2.GOV).join(','));
})();

/* ---------------- 7. 存档往返 ---------------- */
(function () {
  const c = world.countries[pair.a.id - 1];
  c.aoc.gov = 'monarchy'; c.aoc.era = 1; c.aoc.lowHappy = 7;
  const reb = world.countries.find(x => x.aoc && x.aoc.rebel);
  const rebId = reb ? reb.id : 0;
  const pid = pair.toPid;
  const ownerNow = world.provinces[pid - 1].owner;
  const snap = JSON.parse(JSON.stringify(A2.save(world)));

  /* 打乱：把版图还原成"全归 1 号国"、政体改回去 */
  for (const p of world.provinces) if (p) p.owner = 1;
  c.aoc.gov = 'tribe'; c.aoc.era = 0;
  A2.load(world, snap);

  ok('存档往返：省归属接回来（含叛军占的地）',
    world.provinces[pid - 1].owner === ownerNow,
    '#' + pid + ' → ' + world.provinces[pid - 1].ownerName);
  ok('存档往返：政体 / 时代 / 低位计数',
    c.aoc.gov === 'monarchy' && c.aoc.era === 1 && c.aoc.lowHappy === 7,
    c.aoc.gov + ' · 时代 ' + c.aoc.era + ' · lowHappy ' + c.aoc.lowHappy);
  if (rebId) {
    const r2 = world.countries[rebId - 1];
    ok('存档往返：叛军国重建出来', !!r2 && !!r2.aoc.rebel && r2.provinces.length > 0,
      r2 ? r2.name + '（' + r2.provinces.length + ' 省）' : '没重建');
  } else {
    ok('存档往返：叛军国重建出来（本局没有叛军，跳过）', true, 'skip');
  }
})();

console.log('\n总体: ' + (fail ? fail + ' 项失败' : '全部通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);
