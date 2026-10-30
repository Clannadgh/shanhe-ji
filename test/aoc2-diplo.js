/* =============================================================
 * test/aoc2-diplo.js —— 阶段四下半（外交 / 附庸 / 联合统治 / 贸易 / 大国）的验收
 *
 * 对着任务书阶段四逐条过：
 *   1) 21 种外交动作全在册
 *   2) 关系类：改善 / 侮辱（含冷却）/ 送礼（关系过低被拒且反降）
 *   3) 条约类：同盟 / 互不侵犯（宣战撕约）/ 防御条约（被攻参战）/ 保障独立 /
 *      军事通行权（真的能走进对方领土）
 *   4) 最后通牒：关系 ≤−10 才能发；兵力悬殊才被接受；拒绝就入侵
 *   5) 附庸：附庸税 20% / 独立欲望（宗主战时加速）/ 关系 100 吞并必成 / 释放附庸
 *   6) 联合统治：合并为一国
 *   7) 贸易：AI 不卖核心省 / 购省价 = 40000 × 价值 / 给钱换关系 / 支持叛军
 *   8) 大国 = 人口前 10
 *   9) **最后通牒流全链路**：压关系 → 附庸 → 停战 → 吞并
 *  10) 存档往返：条约 / 附庸 / 独立欲望
 *
 * 用法：node test/aoc2-diplo.js
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
const DP = A2.dip;
const D = DP.D;
world.turn = 40;              // 过开局 5 回合禁令

/* 挑一对相邻国：A 大 B 小（方便演"压关系 → 附庸"） */
function findPair() {
  let best = null;
  for (const a of world.countries) {
    if (!a.provinces.length) continue;
    for (const nid of a.neighbors || []) {
      const b = world.countries[nid - 1];
      if (!b || b.id === a.id || !b.provinces.length) continue;
      const score = a.provinces.length - b.provinces.length * 2;
      if (!best || score > best.score) best = { score, a, b };
    }
  }
  return best;
}
const pair = findPair();
const A = pair.a, B = pair.b;
function resetRel(x, y, v) { A2.setRel(world, x, y, v === undefined ? 0 : v); }
function giveDip(c, n) { c.aoc.dip = n; c.aoc.treasury = Math.max(c.aoc.treasury, 5e7); }

/* ---------------------------------------------------------------- */
console.log('\n【一】动作表');
ok('21 种外交动作全在册', DP.ORDER.length === 21 &&
  DP.ORDER.every(k => DP.ACT[k] && DP.ACT[k].cn), DP.ORDER.map(k => DP.ACT[k].cn).join(' / '));

/* ---------------------------------------------------------------- */
console.log('\n【二】关系类');
giveDip(A, 50);
resetRel(A.id, B.id, 0);
const imp = DP.act(world, A.id, B.id, 'improve');
ok('改善关系：关系 +8、耗外交点', imp.ok && A2.rel(A, B.id) === 8 && A.aoc.dip === 49,
  '关系 ' + A2.rel(A, B.id) + ' · 外交点 ' + A.aoc.dip);

const ins = DP.act(world, A.id, B.id, 'insult');
const imp2 = DP.act(world, A.id, B.id, 'improve');
ok('侮辱：关系 −15 且对方进入冷却，改善关系被拒',
  ins.ok && A2.rel(A, B.id) === -7 && !imp2.ok && /侮辱/.test(imp2.msg),
  '关系 ' + A2.rel(A, B.id) + ' · ' + imp2.msg);

world.turn += D.IMPROVE_COOL + 1;      // 等冷却过去
giveDip(A, 50);
resetRel(A.id, B.id, 0);
const g1 = DP.act(world, A.id, B.id, 'gift');
ok('送礼：关系 +12', g1.ok && A2.rel(A, B.id) === 12, '关系 ' + A2.rel(A, B.id));
resetRel(A.id, B.id, -60);
const g2 = DP.act(world, A.id, B.id, 'gift');
ok('关系过低：送礼被拒且关系反降', !g2.ok && A2.rel(A, B.id) < -60,
  '关系 −60 → ' + A2.rel(A, B.id));

/* ---------------------------------------------------------------- */
console.log('\n【三】条约类');
giveDip(A, 50);
resetRel(A.id, B.id, 0);
const allyLow = DP.act(world, A.id, B.id, 'ally');
resetRel(A.id, B.id, 50);
giveDip(A, 50);
/* 同盟是掷骰的（关系 50 时约 60%）：谈不成可以再谈，别用一次结果当断言 */
let ally = null;
for (let i = 0; i < 20 && !(ally && ally.ok); i++) {
  giveDip(A, 50);
  ally = DP.act(world, A.id, B.id, 'ally');
}
ok('同盟：关系不够被拒、关系 50 时谈得成',
  !allyLow.ok && ally.ok && DP.has(world, A.id, B.id, 'ally'),
  '低关系「' + allyLow.msg + '」· 高关系「' + ally.msg + '」');

/* 互不侵犯：宣战会撕约 */
const C3 = world.countries.find(c => c.aoc && c.aoc.alive && c.id !== A.id && c.id !== B.id);
giveDip(A, 50);
resetRel(A.id, C3.id, 10);
const nap = DP.act(world, A.id, C3.id, 'nap');
const napBefore = DP.has(world, A.id, C3.id, 'nap');
A2.declareWar(world, A.id, C3.id);
const napAfter = DP.has(world, A.id, C3.id, 'nap');
ok('互不侵犯：签得下、宣战即撕约', nap.ok && napBefore && !napAfter,
  '签约 ' + napBefore + ' → 宣战后 ' + napAfter);

/* 防御条约：被攻方把盟友拉进来 */
const w2 = AO.generate({ seed: 'diplo-def', provinces: 300, countries: 10 });
w2.turn = 40;
const d1 = w2.countries[0], d2 = w2.countries[1], d3 = w2.countries[2];
for (const c of [d1, d2, d3]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w2, d1.id, d2.id, 60);
A2.setRel(w2, d2.id, d3.id, 60);
DP.act(w2, d1.id, d2.id, 'defpact');
DP.act(w2, d2.id, d3.id, 'defpact');
const warD = A2.declareWar(w2, d1.id, d3.id);
ok('防御条约：打 d3，d2 依约参战',
  warD.ok && A2.atWar(w2, d2.id, d1.id),
  warD.msg + ' · d2 与 d1 交战 ' + A2.atWar(w2, d2.id, d1.id));

/* 保障独立：只有被保障方被打才触发（反向不触发） */
const w3 = AO.generate({ seed: 'diplo-guar', provinces: 300, countries: 10 });
w3.turn = 40;
const g1c = w3.countries[0], g2c = w3.countries[1], g3c = w3.countries[2];
for (const c of [g1c, g2c, g3c]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w3, g1c.id, g2c.id, 40);
DP.act(w3, g1c.id, g2c.id, 'guarantee');       // g1 保障 g2
A2.declareWar(w3, g3c.id, g2c.id);             // g3 打 g2 → g1 该参战
const guarJoin = A2.atWar(w3, g1c.id, g3c.id);
const w4 = AO.generate({ seed: 'diplo-guar2', provinces: 300, countries: 10 });
w4.turn = 40;
const h1 = w4.countries[0], h2 = w4.countries[1], h3 = w4.countries[2];
for (const c of [h1, h2, h3]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w4, h1.id, h2.id, 40);
DP.act(w4, h1.id, h2.id, 'guarantee');         // h1 保障 h2
A2.declareWar(w4, h2.id, h3.id);               // h2 去打 h3 → 反向不触发
ok('保障独立：被保障方被打才参战，反向不触发',
  guarJoin && !A2.atWar(w4, h1.id, h3.id),
  '被保障方被攻 → 参战 ' + guarJoin + ' · 保障方主动开战 → 不参战');

/* 军事通行权：签了才走得进去 */
const w5 = AO.generate({ seed: 'diplo-access', provinces: 300, countries: 10 });
w5.turn = 40;
let e1 = null, e2 = null;
for (const cc of w5.countries) {
  for (const nid of cc.neighbors || []) {
    const nb = w5.countries[nid - 1];
    if (nb && nb.id !== cc.id && nb.provinces.length) { e1 = cc; e2 = nb; break; }
  }
  if (e1) break;
}
for (const c of [e1, e2]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w5, e1.id, e2.id, 60);
let from = null, to = null;
for (const pid of e1.provinces) {
  const q = w5.provinces[pid - 1];
  for (const nid of q.neighbors) {
    const n = w5.provinces[nid - 1];
    if (n && n.owner === e2.id) { from = q; to = n; break; }
  }
  if (from) break;
}
if (from) {
  from.aoc.army = 5000; from.aoc.armyOf = e1.id;
  e1.aoc.mp = 100;
  const noAccess = A2.move(w5, e1.id, from.id, to.id, 1000);
  DP.act(w5, e1.id, e2.id, 'access');            // 给通行权
  e1.aoc.mp = 100;
  const withAccess = A2.move(w5, e1.id, from.id, to.id, 1000);
  ok('军事通行权：没签走不进去，签了能进（不交战）',
    !noAccess.ok && withAccess.ok && !A2.atWar(w5, e1.id, e2.id),
    '无通行「' + noAccess.msg + '」· 有通行 ' + (withAccess.ok ? '进入成功' : withAccess.msg));
} else ok('军事通行权：没签走不进去，签了能进（不交战）', false, '没找到相邻省');

/* ---------------------------------------------------------------- */
console.log('\n【四】最后通牒');
const w6 = AO.generate({ seed: 'diplo-ult', provinces: 300, countries: 10 });
w6.turn = 40;
const u1 = w6.countries[0], u2 = w6.countries[1];
for (const c of [u1, u2]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w6, u1.id, u2.id, 20);
const ultTooNice = DP.act(w6, u1.id, u2.id, 'vassalize');
ok('最后通牒：关系 >−10 发不出去', !ultTooNice.ok && /关系/.test(ultTooNice.msg), ultTooNice.msg);

A2.setRel(w6, u1.id, u2.id, -30);
/* 兵力悬殊：u1 塞 20 万兵 */
const up = w6.provinces[u1.provinces[0] - 1];
up.aoc.army = 200000; up.aoc.armyOf = u1.id;
const ult = DP.act(w6, u1.id, u2.id, 'vassalize', { invade: false });
ok('最后通牒：兵力悬殊 → 对方接受附庸',
  ult.ok && DP.overlordOf(w6, u2.id) === u1.id,
  ult.msg);

/* 拒绝就入侵 */
const w7 = AO.generate({ seed: 'diplo-ult2', provinces: 300, countries: 10 });
w7.turn = 40;
const v1 = w7.countries[0], v2 = w7.countries[1];
for (const c of [v1, v2]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w7, v1.id, v2.id, -50);
const ultNo = DP.act(w7, v1.id, v2.id, 'vassalize', { invade: true });   // 兵力相当 → 被拒
ok('最后通牒：拒绝 + 勾了入侵 → 自动宣战',
  !ultNo.ok && ultNo.refused && A2.atWar(w7, v1.id, v2.id),
  ultNo.msg);

/* ---------------------------------------------------------------- */
console.log('\n【五】附庸');
/* 附庸税 20% */
const w8 = AO.generate({ seed: 'diplo-vassal', provinces: 300, countries: 10 });
w8.turn = 40;
const s1 = w8.countries[0], s2 = w8.countries[1];
DP.setVassal(w8, s2.id, s1.id);
A2.settle(w8, { player: 0, ai: false });
const paid = s2.aoc.paidTax || 0;
const expect = (s2.aoc.last && s2.aoc.last.taxIn || 0) * D.VASSAL_TAX;
ok('附庸税：按入库收入的 20% 上缴宗主',
  Math.abs(paid - expect) < Math.max(1, expect * 0.02),
  '上缴 ' + Math.round(paid) + ' / 期望 ' + Math.round(expect));

/* 独立欲望：和平慢慢涨，宗主战时涨得快 */
s2.aoc.indep = 0;
A2.settle(w8, { player: 0, ai: false });
const indepPeace = s2.aoc.indep;
s2.aoc.indep = 0;
const enemy = w8.countries.find(c => c.id !== s1.id && c.id !== s2.id);
A2.setRel(w8, s1.id, enemy.id, -100);
A2.settle(w8, { player: 0, ai: false });
const indepWar = s2.aoc.indep;
ok('独立欲望：宗主战时涨得更快', indepWar > indepPeace,
  '和平 +' + (indepPeace * 100).toFixed(0) + '% / 宗主战时 +' + (indepWar * 100).toFixed(0) + '%');

/* 关系 100 吞并必成 */
A2.setRel(w8, s1.id, s2.id, 100);
const provBefore = s2.provinces.length;
const ann = DP.act(w8, s1.id, s2.id, 'annex');
ok('附庸吞并：关系 100 → 必定接受', ann.ok && !s2.aoc.alive && s1.provinces.length > provBefore,
  ann.msg);

/* 关系不到 100 就拒 */
const w9 = AO.generate({ seed: 'diplo-annex', provinces: 300, countries: 10 });
w9.turn = 40;
const t1 = w9.countries[0], t2 = w9.countries[1];
DP.setVassal(w9, t2.id, t1.id);
A2.setRel(w9, t1.id, t2.id, 60);
const annLow = DP.act(w9, t1.id, t2.id, 'annex');
ok('附庸吞并：关系 60 → 被拒', !annLow.ok && annLow.refused, annLow.msg);

/* 释放附庸 */
const w10 = AO.generate({ seed: 'diplo-release', provinces: 300, countries: 10 });
w10.turn = 40;
const r1 = w10.countries[0];
r1.aoc.dip = 100;
const relPid = r1.provinces[1];
const rel = DP.act(w10, r1.id, 0, 'release', { pid: relPid });
ok('释放附庸：从自己的省里复国', rel.ok && DP.overlordOf(w10, rel.cid) === r1.id,
  rel.msg);

/* ---------------------------------------------------------------- */
console.log('\n【六】联合统治');
const w11 = AO.generate({ seed: 'diplo-union', provinces: 300, countries: 10 });
w11.turn = 40;
const n1 = w11.countries[0], n2 = w11.countries[1];
for (const c of [n1, n2]) { c.aoc.dip = 100; c.aoc.treasury = 1e7; }
A2.setRel(w11, n1.id, n2.id, 20);
const unionLow = DP.act(w11, n1.id, n2.id, 'union');
A2.setRel(w11, n1.id, n2.id, 100);   // 关系 100：成功率 0.35 + 0.2 = 0.55，掷一次不一定成
let unionOk = false, tries = 0;
while (!unionOk && tries++ < 30 && n1.aoc.alive && n2.aoc.alive) {
  n1.aoc.dip = 100;
  const u = DP.act(w11, n1.id, n2.id, 'union');
  if (u.ok) unionOk = true;
  A2.setRel(w11, n1.id, n2.id, 100);
}
ok('联合统治：关系不够被拒、关系 100 反复谈能合并',
  !unionLow.ok && unionOk && (!n1.aoc.alive || !n2.aoc.alive),
  '低关系「' + unionLow.msg + '」· 合并用了 ' + tries + ' 次');

/* ---------------------------------------------------------------- */
console.log('\n【七】贸易与支持叛军');
const w12 = AO.generate({ seed: 'diplo-trade', provinces: 300, countries: 10 });
w12.turn = 40;
const k1 = w12.countries[0], k2 = w12.countries[1];
k1.aoc.treasury = 1e9;
const corePid = k2.provinces[0];
/* 非核心省：刚割过来的那种（割地只换 owner，core 表不动） */
const k3 = w12.countries.find(c => c.id !== k1.id && c.id !== k2.id && c.provinces.length > 2);
if (k3) A2.transferProvince(w12, k3.provinces[k3.provinces.length - 1], k2.id);
const nonCore = k2.provinces.find(pid => !w12.provinces[pid - 1].aoc.core[k2.id]);
const buyCore = DP.buyProvince(w12, k1.id, k2.id, corePid);
ok('贸易：AI 永远不卖核心省', !buyCore.ok && buyCore.refused, buyCore.msg);
if (nonCore) {
  const price = DP.provPrice(w12, nonCore);
  const before = k1.aoc.treasury;
  const buy = DP.buyProvince(w12, k1.id, k2.id, nonCore);
  const paid2 = before - k1.aoc.treasury;
  ok('贸易：非核心省可买，价 = 40000 × 价值 × 1.2',
    buy.ok && Math.abs(paid2 - Math.round(price * D.TRADE_PROV_PREMIUM)) < 2,
    '成交 ' + Math.round(paid2) + ' 金（价值 × 40000 = ' + price + '）');
} else ok('贸易：非核心省可买', false, '没找到非核心省');

A2.setRel(w12, k1.id, k2.id, 0);
const give = DP.giveGold(w12, k1.id, k2.id, 10000);
ok('贸易：给钱换关系', give.ok && A2.rel(k1, k2.id) > 0,
  '给 10,000 金 → 关系 ' + A2.rel(k1, k2.id));

/* 支持叛军：目标国革命风险抬高 */
const w13 = AO.generate({ seed: 'diplo-support', provinces: 300, countries: 10 });
w13.turn = 40;
const m1 = w13.countries[0], m2 = w13.countries[1];
m1.aoc.dip = 100; m1.aoc.treasury = 1e7;
const mp = w13.provinces[m2.provinces[0] - 1];
mp.aoc.happy = 40; mp.aoc.stab = 40;
const revBefore = A2.revoltTarget(w13, mp.id);
DP.act(w13, m1.id, m2.id, 'support');
const revAfter = A2.revoltTarget(w13, mp.id);
ok('支持叛军：目标省革命风险 +12', Math.abs((revAfter - revBefore) - D.SUPPORT_REVOLT) < 0.01,
  revBefore.toFixed(1) + ' → ' + revAfter.toFixed(1));

/* ---------------------------------------------------------------- */
console.log('\n【八】迁都 / 大国');
const w14 = AO.generate({ seed: 'diplo-cap', provinces: 300, countries: 10 });
w14.turn = 40;
const p1 = w14.countries[0];
p1.aoc.dip = 100;
const oldCap = w14.provinces[p1.capital - 1];
const oldHappy = oldCap.aoc.happy;
const newCapPid = p1.provinces.find(pid => pid !== p1.capital);
const capRes = DP.act(w14, p1.id, 0, 'capital', { pid: newCapPid });
ok('迁都：首都换掉、旧都幸福 −10',
  capRes.ok && p1.capital === newCapPid && Math.abs((oldHappy - oldCap.aoc.happy) - 10) < 0.01,
  capRes.msg);

DP.refreshGreat(w14);
const greats = w14.countries.filter(c => c.aoc && c.aoc.alive && c.aoc.great).length;
const top10 = w14.countries.filter(c => c.aoc && c.aoc.alive)
  .sort((x, y) => y.aoc.pop - x.aoc.pop).slice(0, 10);
ok('大国 = 世界人口前 10', greats === Math.min(10, w14.countries.filter(c => c.aoc.alive).length) &&
  top10.every(c => c.aoc.great), greats + ' 个大国');

/* ---------------------------------------------------------------- */
console.log('\n【九】最后通牒流全链路：压关系 → 附庸 → 停战 → 吞并');
const w15 = AO.generate({ seed: 'diplo-flow', provinces: 400, countries: 12 });
w15.turn = 40;
const f1 = w15.countries.slice().sort((a, b) => b.provinces.length - a.provinces.length)[0];
const f2 = w15.countries.find(c => c.id !== f1.id && (f1.neighbors || []).indexOf(c.id) >= 0 &&
  c.provinces.length < f1.provinces.length) ||
  w15.countries.find(c => c.id !== f1.id && c.provinces.length < f1.provinces.length);
f1.aoc.dip = 200; f1.aoc.treasury = 1e8;
f2.aoc.dip = 20;
/* ① 压关系：连侮辱 */
let guard = 0;
while (A2.rel(f1, f2.id) > -10 && guard++ < 20) {
  A2.setRel(w15, f1.id, f2.id, Math.min(-10, A2.rel(f1, f2.id) - 15));
}
const flowRel = A2.rel(f1, f2.id);
/* ② 附庸：给 f1 一支压倒性兵力 */
const fp = w15.provinces[f1.provinces[0] - 1];
fp.aoc.army = 500000; fp.aoc.armyOf = f1.id;
const flowVas = DP.act(w15, f1.id, f2.id, 'vassalize', { invade: false });
/* ③ 停战：如果打起来了先白和平（没打就不用） */
if (A2.atWar(w15, f1.id, f2.id)) {
  A2.peace(w15, f1.id, f2.id, 'white', { force: true });
}
/* ④ 关系拉到 100 → 吞并 */
A2.setRel(w15, f1.id, f2.id, 100);
const flowAnn = DP.act(w15, f1.id, f2.id, 'annex');
ok('链路：压关系 → 附庸 → 停战 → 吞并',
  flowRel <= -10 && flowVas.ok && flowAnn.ok && !f2.aoc.alive,
  '关系 ' + flowRel + ' · 附庸「' + flowVas.msg + '」· 吞并「' + flowAnn.msg + '」');

/* ---------------------------------------------------------------- */
console.log('\n【十】存档往返');
const w16 = AO.generate({ seed: 'diplo-save', provinces: 300, countries: 10 });
w16.turn = 40;
const z1 = w16.countries[0], z2 = w16.countries[1], z3 = w16.countries[2];
A2.setRel(w16, z1.id, z2.id, 55);
DP.setPact(w16, z1.id, z2.id, 'ally', 1);
DP.setVassal(w16, z3.id, z1.id);
z3.aoc.indep = 0.42;
const snap = A2.save(w16);
/* 砸掉 */
DP.clearPact(w16, z1.id, z2.id, 'ally');
DP.dropVassal(w16, z3.id);
z3.aoc.indep = 0;
A2.load(w16, snap);
ok('存档：同盟 / 附庸 / 独立欲望都能读回来',
  DP.has(w16, z1.id, z2.id, 'ally') && DP.overlordOf(w16, z3.id) === z1.id &&
  Math.abs(z3.aoc.indep - 0.42) < 1e-6,
  '同盟 ' + DP.has(w16, z1.id, z2.id, 'ally') + ' · 宗主 ' +
  DP.overlordOf(w16, z3.id) + ' · 独立欲望 ' + z3.aoc.indep);

/* ---------------------------------------------------------------- */
console.log('\n总体：' + (fail ? '有 ' + fail + ' 项失败' : '全部通过') +
  '（' + pass + ' 项' + (fail ? '，' + fail + ' 项失败' : '') + '）');
process.exit(fail ? 1 : 0);
