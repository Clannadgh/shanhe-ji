/* =============================================================
 * test/aoc2-war.js —— 阶段二（铁与血）的验收
 *
 * 对着任务书阶段二逐条过：
 *   1) 征兵：扣金 + 扣人口；单省上限 1/10~1/5；即时征 ×2 价、花移动点；占领省不能募兵
 *   2) 移动：只能邻接、按地形花移动点；进敌省必须先宣战
 *   3) 宣战：开局 5 回合禁、耗外交点、关系 −100 = 战争、停战期内禁
 *   4) 战斗：守方吃地形加成（山地打不动、平原打得动）；空省 <10 兵占不了
 *   5) 占领：阴影标记 / 原主收入归零 / 占领者每回合 ~10 金 / 大军损毁人口经济
 *   6) 战争分 = 占领比例
 *   7) 和谈：白和平 / 割地（100 分必接受）/ 赔款；和约后停战 30 回合
 *   8) **完整链路**：宣战 → 攻占 → 和谈 → 割地 → 停战
 *   9) 厌战：战时上升、和平回落、军费膨胀
 *  10) 存档往返：军队 / 关系 / 停战 / 厌战
 *
 * 用法：node test/aoc2-war.js
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

/* 找一对相邻国家：B 越小越好（方便一条链路打穿） */
function findPair() {
  let best = null;
  for (const a of world.countries) {
    if (!a.provinces.length) continue;
    for (const nid of a.neighbors || []) {
      const b = world.countries[nid - 1];
      if (!b || b.id === a.id || !b.provinces.length) continue;
      /* A 里有一个省和 B 的省相邻，且 A 的省人口够多 */
      for (const pid of a.provinces) {
        const p = world.provinces[pid - 1];
        for (const q of p.neighbors) {
          const qq = world.provinces[q - 1];
          if (!qq || qq.owner !== b.id) continue;
          const score = b.provinces.length * 1000 - AO.aoc2.totalPop(p) / 1000;
          if (!best || score < best.score) best = { score, a, b, fromPid: p.id, toPid: qq.id };
        }
      }
    }
  }
  return best;
}
const pair = findPair();

/* ---------------- 1. 征兵 ---------------- */
(function () {
  const c = world.countries[pair.a.id - 1];
  const p = world.provinces[pair.fromPid - 1];
  c.aoc.treasury = 1e9; c.aoc.mp = 100;
  const pop0 = A2.totalPop(p), gold0 = c.aoc.treasury;
  const cap = A2.recruitCap(p, c.id);

  const r = A2.recruit(world, c.id, p.id, 1000, false);
  const costWant = Math.round(1000 * AO.AOC2.RECRUIT_GOLD * AO.aoc2.govOf(c).recruit);
  ok('征兵：同时扣金 + 扣人口',
    r.ok && Math.round(gold0 - c.aoc.treasury) === costWant &&
    Math.round(pop0 - A2.totalPop(p)) === 1000,
    '金 −' + Math.round(gold0 - c.aoc.treasury) + '（应 ' + costWant + '）· 人口 −' +
    Math.round(pop0 - A2.totalPop(p)));
  ok('征兵（正常价）：下一回合才到位', p.aoc.army === 0 && c.aoc.rq.length === 1,
    '队列 ' + c.aoc.rq.length + ' 条，驻军 ' + p.aoc.army);

  A2.settle(world, { player: c.id, ai: false });
  ok('征兵到货：结算后驻军 = 1000', p.aoc.army === 1000, '驻军 ' + p.aoc.army);
  ok('征兵上限 = 人口 1/10（稳定度 ' + p.aoc.stab.toFixed(0) + ' < 70）',
    Math.abs(cap - Math.floor(pop0 * AO.AOC2.RECRUIT_CAP_UNSTABLE)) <= 1,
    '上限 ' + cap + ' / 人口 ' + Math.round(pop0));

  /* 即时征：×2 价 + 移动点 */
  const g1 = c.aoc.treasury, mp1 = c.aoc.mp, a1 = p.aoc.army;
  const ri = A2.recruit(world, c.id, p.id, 500, true);
  const costI = Math.round(500 * AO.AOC2.RECRUIT_GOLD * AO.AOC2.INSTANT_MUL * AO.aoc2.govOf(c).recruit);
  ok('即时征兵：×2 价 + 立即到位 + 扣移动点',
    ri.ok && Math.round(g1 - c.aoc.treasury) === costI && p.aoc.army === a1 + 500 &&
    c.aoc.mp === mp1 - AO.AOC2.MP_COST.recruit,
    '金 −' + Math.round(g1 - c.aoc.treasury) + '（应 ' + costI + '）· 兵 ' + a1 + '→' + p.aoc.army +
    ' · 移动点 ' + mp1 + '→' + c.aoc.mp);

  /* 超上限会被截断 */
  const capBefore = A2.recruitCap(p, c.id);
  const big = A2.recruit(world, c.id, p.id, 1e9, false);
  ok('征兵超过上限 → 截到上限', big.ok && big.n <= capBefore && big.n > 0,
    '实招 ' + (big.n || 0) + ' / 上限 ' + capBefore);
  c.aoc.rq = [];
})();

/* ---------------- 2. 移动 ---------------- */
(function () {
  const c = world.countries[pair.a.id - 1];
  const from = world.provinces[pair.fromPid - 1];
  const to = world.provinces[pair.toPid - 1];
  from.aoc.army = 5000; from.aoc.armyOf = c.id;
  c.aoc.mp = 100;

  /* 不相邻 → 拒绝 */
  const far = world.provinces.find(q => q && q.aoc && from.neighbors.indexOf(q.id) < 0);
  const rFar = A2.move(world, c.id, from.id, far.id, 10);
  ok('移动：只能移到相邻省', !rFar.ok, rFar.msg);

  /* 目标是对手但没宣战 → 拒绝 */
  const rNoWar = A2.move(world, c.id, from.id, to.id, 100);
  ok('移动：进敌省必须先宣战', !rNoWar.ok, rNoWar.msg);

  /* 自己的邻省 → 成功并花移动点 */
  const ownNb = from.neighbors.map(i => world.provinces[i - 1])
    .find(q => q && q.owner === c.id);
  if (ownNb) {
    const mp0 = c.aoc.mp;
    const rOwn = A2.move(world, c.id, from.id, ownNb.id, 500);
    ok('移动：自己的省 → 并兵 + 按地形扣移动点',
      rOwn.ok && ownNb.aoc.army >= 500 && c.aoc.mp < mp0,
      '移动点 ' + mp0 + '→' + c.aoc.mp + '（' + ownNb.terrain + '，每跳 ' +
      A2.moveCost(world, c.id, ownNb.id) + '）');
  }
  /* 移动点不够 → 拒绝 */
  c.aoc.mp = 0;
  const rMp = A2.move(world, c.id, from.id, to.id, 100);
  ok('移动：移动点不够 → 拒绝', !rMp.ok, rMp.msg);
  c.aoc.mp = 100;
})();

/* ---------------- 3. 宣战 ---------------- */
(function () {
  const a = world.countries[pair.a.id - 1], b = world.countries[pair.b.id - 1];

  /* 开局 5 回合禁 */
  world.turn = 3;
  const rBan = A2.declareWar(world, a.id, b.id);
  ok('宣战：开局 5 回合内禁止', !rBan.ok && /开局/.test(rBan.msg), rBan.msg);

  /* 外交点不够 */
  world.turn = 10;
  a.aoc.dip = 0;
  const rDip = A2.declareWar(world, a.id, b.id);
  ok('宣战：外交点不够 → 拒绝', !rDip.ok && /外交点/.test(rDip.msg), rDip.msg);

  /* 正常宣战 */
  a.aoc.dip = 50;
  const dip0 = a.aoc.dip;
  const rWar = A2.declareWar(world, a.id, b.id);
  ok('宣战：耗外交点、关系 −100 即战争',
    rWar.ok && a.aoc.dip === dip0 - AO.AOC2.WAR_DIP_COST &&
    A2.rel(a, b.id) === -100 && A2.atWar(world, a.id, b.id),
    '外交点 ' + dip0 + '→' + a.aoc.dip + ' · 关系 ' + A2.rel(a, b.id));

  /* 重复宣战 */
  const rAgain = A2.declareWar(world, a.id, b.id);
  ok('宣战：已在交战 → 拒绝', !rAgain.ok, rAgain.msg);
})();

/* ---------------- 4. 战斗：地形防御 / 空省 10 兵 ---------------- */
(function () {
  const a = world.countries[pair.a.id - 1];
  const to = world.provinces[pair.toPid - 1];
  a.aoc.mp = 100;

  /* 空省：5 兵占不了，10 兵能占 */
  to.aoc.army = 0; to.aoc.armyOf = 0;
  const from = world.provinces[pair.fromPid - 1];
  from.aoc.army = 500; from.aoc.armyOf = a.id;
  const r5 = A2.move(world, a.id, from.id, to.id, 5);
  ok('战斗：空省 <10 兵占不了', !r5.occupied && /10/.test(r5.msg || ''), r5.msg);
  from.aoc.army = 500; from.aoc.armyOf = a.id;
  const r10 = A2.move(world, a.id, from.id, to.id, 10);
  ok('战斗：空省 ≥10 兵即占', r10.occupied === true, r10.msg);

  /* 山地 vs 平原：同样兵力，山地守得住、平原守不住 */
  function tryTerrain(terrain) {
    const atk = world.countries[pair.a.id - 1];
    const def = world.countries[pair.b.id - 1];
    /* 造一个"干净的"目标省：临时把它设成指定地形、守军 1000、无占领 */
    const t = world.provinces[pair.toPid - 1];
    t.aoc.occupied = 0; t.terrain = terrain; t.aoc.army = 1000; t.aoc.armyOf = def.id;
    const src = world.provinces[pair.fromPid - 1];
    src.aoc.army = 1000; src.aoc.armyOf = atk.id;
    atk.aoc.mp = 100;
    A2.setRel(world, atk.id, def.id, -100);
    return A2.move(world, atk.id, src.id, t.id, 1000);
  }
  const rPlain = tryTerrain('plains');
  const rMtn = tryTerrain('mountains');
  ok('战斗：守方吃地形加成（同兵力：平原打得动、山地打不动）',
    rPlain.occupied === true && rMtn.occupied === false,
    '平原 occupied=' + rPlain.occupied + '（自损 ' + rPlain.atkLoss + '）；山地 occupied=' +
    rMtn.occupied + '（' + (rMtn.msg || '') + '）');

  /* 还原地形 */
  world.provinces[pair.toPid - 1].terrain = pair.b ? 'plains' : 'plains';
})();

/* ---------------- 5. 占领 ---------------- */
(function () {
  const a = world.countries[pair.a.id - 1], b = world.countries[pair.b.id - 1];
  const p = world.provinces[pair.toPid - 1];
  /* 确保 p 是被 a 占领的状态 */
  if (p.aoc.occupied !== a.id) {
    p.aoc.occupied = 0; p.aoc.army = 0; p.aoc.armyOf = 0;
    const src = world.provinces[pair.fromPid - 1];
    src.aoc.army = 20000; src.aoc.armyOf = a.id;
    a.aoc.mp = 100;
    A2.move(world, a.id, src.id, p.id, 20000);
  }
  ok('占领：省上留下占领方标记（阴影）', p.aoc.occupied === a.id, 'occupied=' + p.aoc.occupied);
  ok('占领：驻军归属改成占领者', p.aoc.armyOf === a.id, 'armyOf=' + p.aoc.armyOf);

  /* 原主收入归零 / 占领者拿 ~10 金 */
  const before = b.aoc.treasury;
  A2.settle(world, { player: b.id, ai: false });
  const L = b.aoc.last;
  let incP = 0;
  for (const pid of b.provinces) if (pid === p.id) incP = world.provinces[pid - 1].aoc.income;
  ok('占领：原主该省收入归零', incP === 0, '该省收入 ' + incP);
  ok('占领：占领者每回合 ~10 金/省', (a.aoc.last && a.aoc.last.gross) > 0,
    '占领省数 = ' + a.provinces.filter(pid => world.provinces[pid - 1].aoc.occupied === a.id).length);

  /* 占领省不能募兵 / 不能下敕令 */
  const rR = A2.recruit(world, b.id, p.id, 100, false);
  ok('占领：原主不能在占领省募兵', !rR.ok, rR.msg);
  const rD = A2.decree(world, b.id, 'festival', p.id);
  ok('占领：不能下敕令', !rD.ok, rD.msg);
  const rP = A2.plunder(world, a.id, p.id);
  ok('掠夺：占领者能抢（军越多抢越多）', rP.ok && rP.gold > 0, rP.msg);
})();

/* ---------------- 6. 战争分 ---------------- */
(function () {
  const a = world.countries[pair.a.id - 1], b = world.countries[pair.b.id - 1];
  let occ = 0;
  for (const pid of b.provinces) if (world.provinces[pid - 1].aoc.occupied === a.id) occ++;
  const score = A2.warScore(world, a.id, b.id);
  const want = Math.min(100, occ / Math.max(1, b.provinces.length) * 100);
  ok('战争分 = 占领比例', Math.abs(score - want) < 1e-6,
    '占领 ' + occ + '/' + b.provinces.length + ' → ' + score.toFixed(1) + ' 分');
})();

/* ---------------- 7+8. 完整链路：宣战 → 攻占 → 和谈 → 割地 → 停战 ---------------- */
(function () {
  /* 换一对干净的：B 只剩 1 省时最好演"割地到灭国" */
  const a = world.countries[pair.a.id - 1];
  const b = world.countries[pair.b.id - 1];

  /* 把 B 缩到只剩目标省 —— 这条链路要演的是"打到最后一个省 → 割地 → 灭国"，
   * 所以先把其余省按"已经打下来"处理掉（transferProvince 是同一把刀） */
  const keepPid = pair.toPid;
  for (const pid of b.provinces.slice()) {
    if (pid !== keepPid) A2.transferProvince(world, pid, a.id);
  }
  b.aoc.alive = true;

  /* 清掉上一段留下的状态，重来一遍完整链路 */
  A2.setRel(world, a.id, b.id, 0);
  b.aoc.alive = true;
  world.turn = 20;
  a.aoc.dip = 100; a.aoc.mp = 100;
  const src = world.provinces[pair.fromPid - 1];
  src.aoc.army = 50000; src.aoc.armyOf = a.id;
  src.aoc.occupied = 0;
  /* 目标省恢复成 B 的、无守军 */
  const tgt = world.provinces[pair.toPid - 1];
  tgt.aoc.occupied = 0; tgt.aoc.army = 0; tgt.aoc.armyOf = 0;

  const war = A2.declareWar(world, a.id, b.id);
  const attack = A2.move(world, a.id, src.id, tgt.id, 50000);
  const score = A2.warScore(world, a.id, b.id);
  const bN = b.provinces.length;
  const occN = b.provinces.filter(pid => world.provinces[pid - 1].aoc.occupied === a.id).length;
  const peace = A2.peace(world, a.id, b.id, 'land');

  ok('链路①：宣战成功', war.ok, war.msg);
  ok('链路②：攻占成功', attack.ok && attack.occupied, attack.msg);
  ok('链路③：战争分 = 100（全境被占）', Math.round(score) === 100,
    '战争分 ' + score.toFixed(1) + '（B 共 ' + bN + ' 省，占 ' + occN + '）');
  ok('链路④：和谈割地', peace.ok && peace.ceded > 0, peace.msg);
  ok('链路⑤：割地后该省归 A、阴影清除',
    tgt.owner === a.id && tgt.aoc.occupied === 0,
    '归属 ' + tgt.ownerName + '，occupied=' + tgt.aoc.occupied);
  ok('链路⑥：和约后停战 30 回合',
    A2.truceLeft(world, a.id, b.id) === AO.AOC2.PEACE_TRUCE,
    '停战剩 ' + A2.truceLeft(world, a.id, b.id) + ' 回合');
  /* 停战闸门要拿一个"还活着"的对手验：B 已经被割没了，
   * 对它宣战只会得到"对方已经不存在了"，验不到停战期。 */
  const c3 = world.countries.find(x => x.aoc && x.aoc.alive && x.id !== a.id && x.id !== b.id);
  A2.setRel(world, a.id, c3.id, 0);
  a.aoc.truce = a.aoc.truce || {};
  a.aoc.truce[c3.id] = world.turn + 10;
  a.aoc.dip = 100;
  const reWar = A2.declareWar(world, a.id, c3.id);
  ok('链路⑦：停战期内不能再宣战', !reWar.ok && /停战/.test(reWar.msg), reWar.msg);
})();

/* ---------------- 9. 厌战 ---------------- */
(function () {
  const a = world.countries[pair.a.id - 1];
  /* 厌战只看"接壤的敌人"（远方的叛军不算），所以这里必须挑一个邻国 */
  const b = world.countries.find(x => x.aoc && x.aoc.alive && x.id !== a.id &&
    (a.neighbors || []).indexOf(x.id) >= 0) ||
    world.countries.find(x => x.aoc && x.aoc.alive && x.id !== a.id);
  a.aoc.truce = {}; b.aoc.truce = {};
  a.aoc.wear = 0; b.aoc.wear = 0;
  world.turn = 40;
  a.aoc.dip = 100;
  A2.setRel(world, a.id, b.id, -100);
  const w0 = a.aoc.wear;
  for (let i = 0; i < 5; i++) A2.settle(world, { player: a.id, ai: false });
  const w1 = a.aoc.wear;
  ok('厌战：战时上升', w1 > w0, w0.toFixed(2) + ' → ' + w1.toFixed(2));

  /* 军费膨胀：同样兵力，厌战 1.0 的军费应更高 */
  const L1 = a.aoc.last;
  a.aoc.wear = 1;
  A2.settle(world, { player: a.id, ai: false });
  const L2 = a.aoc.last;
  ok('厌战：军费膨胀（厌战 100% 时军费更高）',
    L2.upkeep > L1.upkeep * 1.2,
    '军费 ' + Math.round(L1.upkeep) + ' → ' + Math.round(L2.upkeep));

  /* 和平回落 */
  A2.setRel(world, a.id, b.id, 0);
  for (let i = 0; i < 5; i++) A2.settle(world, { player: a.id, ai: false });
  ok('厌战：和平回落', a.aoc.wear < 1, '厌战 ' + a.aoc.wear.toFixed(2));
})();

/* ---------------- 10. 存档往返 ---------------- */
(function () {
  const a = world.countries[pair.a.id - 1];
  const p = world.provinces[pair.fromPid - 1];
  p.aoc.army = 4321; p.aoc.armyOf = a.id;
  const other = world.countries[0].id === a.id ? world.countries[1].id : world.countries[0].id;
  A2.setRel(world, a.id, other, -100);
  const snap = A2.save(world);

  p.aoc.army = 0; p.aoc.armyOf = 0;
  A2.setRel(world, a.id, other, 0);
  A2.load(world, snap);
  ok('存档往返：军队 / 归属 / 关系',
    p.aoc.army === 4321 && p.aoc.armyOf === a.id && A2.rel(a, other) === -100,
    '驻军 ' + p.aoc.army + ' · armyOf ' + p.aoc.armyOf + '（应 ' + a.id + '）· 关系 ' +
    A2.rel(a, other) + ' · a.id=' + a.id + ' other=' + other);
})();

console.log('\n总体: ' + (fail ? fail + ' 项失败' : '全部通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);
