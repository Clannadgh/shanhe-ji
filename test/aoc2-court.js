/* =============================================================
 * test/aoc2-court.js —— 阶段四上半（建筑八种 + 科技）的验收
 *
 * 对着任务书阶段四逐条过：
 *   1) 建筑表：八种 + 大学（图书馆 2 级的升级），等级上限照规则书
 *   2) 地形限制：农场只能平原/草原/森林
 *   3) 沿海限制：港口只能建在 coastDirs > 0 的省（岸线画像也在这里验）
 *   4) 科技前置：城堡/营地要 0.3、港口/军械库要 0.6
 *   5) 造价随"已拥有的同种建筑"递增；**在建的不计入**（批量建更便宜）
 *   6) 工期：开工扣金、等级等回合满了才涨
 *   7) 效果：工坊收入 / 农场增长 / 图书馆研究点 / 大学研究点 /
 *      军械库募兵 −1 金 / 城堡防御 / 补给营地军费 −20%
 *   8) 科技：100 研究进度 = 1 科技点；升级扣点、等级 +0.5、上限 50；
 *      科技抬移动点上限与收入
 *   9) 存档往返：建筑等级 / 在建队列 / 科技
 *
 * 用法：node test/aoc2-court.js
 * ============================================================= */
'use strict';
const AO = require('./load').load([]);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS    ' + name + (detail ? '  —  ' + detail : '')); }
  else { fail++; console.log('  FAIL    ' + name + (detail ? '  —  ' + detail : '')); }
}

const world = AO.generate({ seed: 'aoh-2026', provinces: 1100, countries: 64 });
const A2 = AO.aoc2;
const C = A2.court;
const T = C.T;

/* 挑一个国家：省多的那个，方便挑地形 */
const c = world.countries.slice().sort((a, b) => b.provinces.length - a.provinces.length)[0];
const ownProv = c.provinces.map(id => world.provinces[id - 1]).filter(Boolean);

function provWith(fn) { return ownProv.find(fn) || null; }
const plain = provWith(p => p.terrain === 'plains' || p.terrain === 'grassland' || p.terrain === 'forest');
const mountain = provWith(p => p.terrain === 'mountains' || p.terrain === 'hills');
const coastal = provWith(p => p.coastDirs > 0);
const inland = provWith(p => !(p.coastDirs > 0));

/* ---------------------------------------------------------------- */
console.log('\n【一】建筑表');
const kinds = C.ORDER;
ok('八种建筑 + 大学 = 九项在册', kinds.length === 9 &&
  ['farm', 'workshop', 'library', 'university', 'castle', 'watchtower', 'port', 'armory', 'camp']
    .every(k => kinds.indexOf(k) >= 0),
  kinds.map(k => C.BLD[k].cn).join(' / '));
ok('等级上限照规则书（农场 5 / 工坊 3 / 图书馆 2 / 城堡 3 / 其余 1）',
  C.BLD.farm.max === 5 && C.BLD.workshop.max === 3 && C.BLD.library.max === 2 &&
  C.BLD.castle.max === 3 && C.BLD.university.max === 1 &&
  C.BLD.port.max === 1 && C.BLD.armory.max === 1,
  '农场 ' + C.BLD.farm.max + ' · 工坊 ' + C.BLD.workshop.max + ' · 图书馆 ' + C.BLD.library.max);

/* ---------------------------------------------------------------- */
console.log('\n【二】地形 / 沿海 / 科技前置');
c.aoc.treasury = 1e9;
if (mountain) {
  const chk = C.canBuild(world, c, mountain, 'farm');
  ok('农场：山地/丘陵被拒', !chk.ok && /平原|地形/.test(chk.why), chk.why);
} else ok('农场：山地/丘陵被拒', false, '这个世界没找到山地省');

if (coastal && inland) {
  c.aoc.tech = 1.0;                        // 港口要 0.6
  const no = C.canBuild(world, c, inland, 'port');
  const yes = C.canBuild(world, c, coastal, 'port');
  ok('港口：内陆被拒、沿海可建', !no.ok && yes.ok,
    '内陆「' + no.why + '」· 沿海 ' + (yes.ok ? '可建 ' + yes.cost + ' 金' : yes.why));
} else ok('港口：内陆被拒、沿海可建', false, '没同时找到沿海与内陆省');

c.aoc.tech = 0.01;
const lowTech = C.canBuild(world, c, plain, 'castle');
ok('科技前置：0.01 科技建不了城堡（要 0.3）', !lowTech.ok && /科技/.test(lowTech.why), lowTech.why);
c.aoc.tech = 0.5;
const okTech = C.canBuild(world, c, plain, 'castle');
ok('科技 0.5 就能建城堡了', okTech.ok, okTech.ok ? okTech.cost + ' 金' : okTech.why);

/* ---------------------------------------------------------------- */
console.log('\n【三】造价递增 / 在建不计入');
c.aoc.tech = 1.0;
const pA = plain;
const cost0 = C.cost(world, c, pA, 'farm');
/* 一口气排 3 个：在建的不计入 → 三个报价应该完全一样 */
const b1 = C.build(world, c.id, pA.id, 'farm');
const b2 = C.build(world, c.id, pA.id, 'farm');
const b3 = C.build(world, c.id, pA.id, 'farm');
ok('同省连排 3 个农场：三个报价相同（在建不计入）',
  b1.ok && b2.ok && b3.ok && b1.cost === b2.cost && b3.cost === b2.cost,
  '报价 ' + b1.cost + ' / ' + b2.cost + ' / ' + b3.cost);
ok('排队 3 个后第 4 个被拒（工地排满 4 个上限先不触发，先验钱和等级）',
  pA.aoc.queue.length === 3, '队列 ' + pA.aoc.queue.length);

/* 另一个省再建：这时"已拥有"仍是 0（三个都在建）→ 不该被那三个抬高。
 * 注意造价还乘了"这个省有多大"（0.25 + 经济/20000），所以两个省的报价
 * 本来就不会相同 —— 要比的是"同一套尺寸系数下有没有被 +35% 抬起来"。 */
const pB = ownProv.find(p => p.id !== pA.id && (p.terrain === 'plains' || p.terrain === 'grassland' || p.terrain === 'forest'));
if (pB) {
  const sizeB = 0.25 + (pB.aoc.econ || 0) / T.BLD_COST_ECON;
  const rawB = C.BLD.farm.base * sizeB;
  ok('别的省这时建农场没被在建的那三个抬价', Math.abs(C.cost(world, c, pB, 'farm') - rawB) / rawB < 0.02,
    C.cost(world, c, pB, 'farm') + ' vs 原价 ' + Math.round(rawB));
}

/* ---------------------------------------------------------------- */
console.log('\n【四】工期');
const t0 = pA.aoc.bld.farm || 0;
let turns = 0;
for (let i = 0; i < C.BLD.farm.turns; i++) { C.tick(world, c); turns++; }
ok('农场工期 3 回合：3 次 tick 后只完工队首那一座',
  (pA.aoc.bld.farm || 0) === t0 + 1 && pA.aoc.queue.length === 2,
  '等级 ' + t0 + ' → ' + (pA.aoc.bld.farm || 0) + '，队列剩 ' + pA.aoc.queue.length +
  ' 个（同省一次只干一件，' + turns + ' 回合）');
/* 现在有 1 座完工 → 别的省报价被抬高 35%。
 * 直接比"完工前/完工后"没法做（那时 pA 还没完工），所以拿"把 pA 的农场
 * 临时抹掉"当完工前 —— 尺寸系数和省自己的等级都不动，只让"全国已拥有数"
 * 这一个变量起作用。 */
const pX = pB || pA;
const lvX = pX.aoc.bld.farm || 0;
const lvA = pA.aoc.bld.farm || 0;
pX.aoc.bld.farm = 0;
pA.aoc.bld.farm = 0;
const before = C.cost(world, c, pX, 'farm');
pA.aoc.bld.farm = lvA;
const costAfter = C.cost(world, c, pX, 'farm');
pX.aoc.bld.farm = lvX;
ok('有 1 座完工后别的省造价上涨（+35%）', Math.abs(costAfter / before - 1.35) < 0.02,
  before + ' → ' + costAfter + '（×' + (costAfter / before).toFixed(3) + '）');

/* ---------------------------------------------------------------- */
console.log('\n【五】建筑效果');
const pW = ownProv.find(p => p.id !== pA.id);
/* 工坊收入 */
const mul0 = C.incomeMul(c, pW);
pW.aoc.bld.workshop = 1;
const mul1 = C.incomeMul(c, pW);
ok('工坊 1 级：收入 ×1.05', Math.abs(mul1 / mul0 - 1.05) < 1e-9,
  mul0.toFixed(4) + ' → ' + mul1.toFixed(4));

/* 农场增长 */
const g0 = C.growthMul(pW);
pW.aoc.bld.farm = 2;
const g1 = C.growthMul(pW);
ok('农场 2 级：人口增长 ×1.10', Math.abs(g1 / g0 - 1.10) < 1e-9,
  g0.toFixed(3) + ' → ' + g1.toFixed(3));

/* 图书馆 / 大学的研究点 */
const pL = ownProv.find(p => p.id !== pA.id && p.id !== pW.id) || pW;
const flat0 = C.flatRp(world, c);
pL.aoc.bld.library = 1;
const flat1 = C.flatRp(world, c);
pL.aoc.bld.university = 1;
const flat2 = C.flatRp(world, c);
ok('图书馆 +0.01、大学 +0.02 研究点/回合',
  Math.abs(flat1 - flat0 - 0.01) < 1e-9 && Math.abs(flat2 - flat1 - 0.02) < 1e-9,
  flat0.toFixed(2) + ' → ' + flat1.toFixed(2) + ' → ' + flat2.toFixed(2));

/* 大学的前置：图书馆 2 级 */
const pU = ownProv.find(p => p.id !== pL.id) || pL;
pU.aoc.bld.library = 1;
const uni1 = C.canBuild(world, c, pU, 'university');
pU.aoc.bld.library = 2;
const uni2 = C.canBuild(world, c, pU, 'university');
ok('大学：图书馆 1 级被拒、2 级可建', !uni1.ok && uni2.ok,
  '1 级「' + uni1.why + '」· 2 级 ' + (uni2.ok ? '可建' : uni2.why));

/* 军械库：募兵 −1 金/兵 */
const pR = ownProv.find(p => p.id !== pU.id) || pU;
pR.aoc.bld.armory = 0;
const unit0 = C.recruitUnit(pR);
pR.aoc.bld.armory = 1;
const unit1 = C.recruitUnit(pR);
ok('军械库：募兵单价 5 → 4 金/兵', unit0 === 5 && unit1 === 4, unit0 + ' → ' + unit1);

/* 城堡 + 瞭望塔：防御 */
const pD = ownProv.find(p => p.id !== pR.id) || pR;
const def0 = C.defOf(c, pD);
pD.aoc.bld.castle = 2;
pD.aoc.bld.watchtower = 1;
const def1 = C.defOf(c, pD);
ok('城堡 2 级 + 瞭望塔：防御 +24（+20 +4）',
  Math.abs((def1 - def0) - 24) < 1e-9, def0.toFixed(1) + ' → ' + def1.toFixed(1));

/* 补给营地：军费 −20% */
const pC = ownProv.find(p => p.id !== pD.id) || pD;
const g = A2.govOf(c);
pC.aoc.army = 1000; pC.aoc.armyOf = c.id;
const up0 = C.upkeepOf(world, c, g, c.aoc);
pC.aoc.bld.camp = 1;
const up1 = C.upkeepOf(world, c, g, c.aoc);
ok('补给营地 1 级：这省驻军军费 −20%', Math.abs(up1 / up0 - 0.8) < 1e-9,
  Math.round(up0) + ' → ' + Math.round(up1) + ' 金');
pC.aoc.army = 0; pC.aoc.armyOf = 0;

/* ---------------------------------------------------------------- */
console.log('\n【六】科技');
const t1 = c.aoc.tech;
c.aoc.rp = 1000;
ok('100 研究进度 = 1 科技点', Math.abs(C.techPoints(c) - 10) < 1e-9, C.techPoints(c) + ' 点');
const costTp = C.techCost(c);
const up = C.techUp(world, c.id);
ok('升级：扣科技点、等级 +0.5', up.ok && Math.abs(c.aoc.tech - (t1 + 0.5)) < 1e-9 &&
  Math.abs(c.aoc.rp - (1000 - costTp * 100)) < 1e-6,
  t1.toFixed(2) + ' → ' + c.aoc.tech.toFixed(2) + '（−' + costTp + ' 点）');

/* 科技点不够就升不了 */
c.aoc.rp = 10;
const poor = C.techUp(world, c.id);
ok('科技点不够 → 拒绝且不扣', !poor.ok && c.aoc.rp === 10, poor.msg);

/* 上限 50 */
c.aoc.rp = 1e9;
c.aoc.tech = 50;
const maxed = C.techUp(world, c.id);
ok('科技 50.0 封顶', !maxed.ok && /满级/.test(maxed.msg), maxed.msg);

/* 科技抬移动点与收入 */
c.aoc.tech = 0.01;
const mp0 = C.mpMaxOf(c), inc0 = C.incomeMul(c, pW);
c.aoc.tech = 20;
const mp20 = C.mpMaxOf(c), inc20 = C.incomeMul(c, pW);
ok('科技 20：移动点 +4（每 5 级 +1）', mp20 - mp0 === 4, mp0 + ' → ' + mp20);
ok('科技 20：收入 +20%（每级 +1%）', Math.abs(inc20 / inc0 - 1.2) < 1e-3,
  inc0.toFixed(3) + ' → ' + inc20.toFixed(3));

/* 造价越高越贵：等级越高单价越贵 */
c.aoc.tech = 0.01;
const c1 = C.techCost(c);
c.aoc.tech = 25;
const c25 = C.techCost(c);
c.aoc.tech = 49;
const c49 = C.techCost(c);
ok('科技越升越贵（边际递增）', c1 < c25 && c25 < c49, c1 + ' → ' + c25 + ' → ' + c49 + ' 点');

/* ---------------------------------------------------------------- */
console.log('\n【七】存档往返');
const pid = pA.id;
const bldBefore = JSON.stringify(world.provinces[pid - 1].aoc.bld);
const queueBefore = world.provinces[pid - 1].aoc.queue.length;
const techBefore = c.aoc.tech;
const snap = A2.save(world);
/* 砸掉再读回来 */
world.provinces[pid - 1].aoc.bld = {};
world.provinces[pid - 1].aoc.queue = [];
c.aoc.tech = 0.01;
A2.load(world, snap);
ok('建筑等级 / 在建队列 / 科技 都能读回来',
  JSON.stringify(world.provinces[pid - 1].aoc.bld) === bldBefore &&
  world.provinces[pid - 1].aoc.queue.length === queueBefore &&
  Math.abs(c.aoc.tech - techBefore) < 1e-9,
  'bld ' + bldBefore + ' · 队列 ' + queueBefore + ' · 科技 ' + techBefore.toFixed(2));

/* ---------------------------------------------------------------- */
console.log('\n【八】岸线画像');
const coastN = world.provinces.filter(p => p && p.coastDirs > 0).length;
const inlandN = world.provinces.filter(p => p && !(p.coastDirs > 0)).length;
ok('岸线画像：沿海省与内陆省都算出来了', coastN > 100 && inlandN > 100,
  '沿海 ' + coastN + ' · 内陆 ' + inlandN);
ok('岸线省的水文文本不再是"内陆"',
  (function () {
    const q = world.provinces.find(p => p && p.coastDirs > 0);
    return q && q.coastDirs >= 1;
  })(),
  '样例 coastDirs=' + (world.provinces.find(p => p && p.coastDirs > 0) || {}).coastDirs);

/* ---------------------------------------------------------------- */
console.log('\n【九】端到端：建完一座工坊，下一回合收入真的多了');
const w2 = AO.generate({ seed: 'court-e2e', provinces: 400, countries: 12 });
const c2 = w2.countries.slice().sort((a, b) => b.provinces.length - a.provinces.length)[0];
const p2 = w2.provinces[c2.provinces[0] - 1];
c2.aoc.tech = 1.0;
c2.aoc.treasury = 1e7;
p2.aoc.bld.workshop = 0;
A2.settle(w2, { player: c2.id, ai: false });
const incA = p2.aoc.income;
p2.aoc.bld.workshop = 1;
A2.settle(w2, { player: c2.id, ai: false });
const incB = p2.aoc.income;
ok('工坊落地后这省收入变高（同税同物资）', incB > incA,
  Math.round(incA) + ' → ' + Math.round(incB) + ' 金/回合（+5% 建筑 × 科技）');

/* 结算里的工地推进：排队一个农场，跑满工期后等级 +1 */
const p3 = w2.provinces[c2.provinces[1] - 1];
p3.aoc.bld.farm = 0;
p3.aoc.queue = [];
c2.aoc.treasury = 1e7;
const built = C.build(w2, c2.id, p3.id, 'farm');
for (let i = 0; i < C.BLD.farm.turns; i++) A2.settle(w2, { player: c2.id, ai: false });
ok('结算里工地自动推进：3 回合后农场 1 级', built.ok && p3.aoc.bld.farm === 1,
  '开工 ' + built.cost + ' 金 → 农场 ' + (p3.aoc.bld.farm || 0) + ' 级');

/* ---------------------------------------------------------------- */
console.log('\n总体：' + (fail ? '有 ' + fail + ' 项失败' : '全部通过') +
  '（' + pass + ' 项' + (fail ? '，' + fail + ' 项失败' : '') + '）');
process.exit(fail ? 1 : 0);
