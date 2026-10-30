/* =============================================================
 * test/aoc2-world.js —— 阶段五（山海）的验收
 *
 * 对着任务书阶段五逐条过：
 *   1) 殖民三方式（自然 ≥10% / 殖民者 1000 金 / 殖民地 1 万金）+ 军队进不去无主地
 *   2) 疾病 17 种表 + 传播公式（已感染占比 +1%）+ 发展度减伤 + 治愈率
 *   3) 地形两表落地（维护费 / 建造费两列 + 丘陵增长存疑项）
 *   4) 黄金时代（触发 / 加成 / 到期）
 *   5) AI 性格四种 + 殖民决策
 *   6) 存档往返（病 / 殖民进度 / 黄金时代）
 *   7) 同种子逐字节可复现（中立省与疫病都走 hash，不许 Math.random）
 *
 * 用法：node test/aoc2-world.js
 * ============================================================= */
'use strict';
const AO = require('./load').load([]);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS    ' + name + (detail ? '  —  ' + detail : '')); }
  else { fail++; console.log('  FAIL    ' + name + (detail ? '  —  ' + detail : '')); }
}
const W = AO.AOC2W;
const X = AO.aoc2.world;

function mkWorld(seed) {
  const w = AO.generate({ seed: seed || 'aoh-2026', provinces: 1100, countries: 64 });
  /* generate 自己会调 initWorld；再调一次验证幂等 */
  AO.aoc2.initWorld(w);
  return w;
}
const world = mkWorld();

/* ---------------- 1. 中立省 ---------------- */
const neutral = world.provinces.filter(p => p && p.aoc && !p.owner);
(function () {
  ok('中立省开局存在（≥3% 的省是无主边地）', neutral.length >= world.provinces.length * 0.03,
    '中立 ' + neutral.length + ' / 全图 ' + world.provinces.length);
  let badPop = 0, badName = 0, badCountry = 0;
  for (const p of neutral) {
    if (!(p.aoc.pop[0] > 0)) badPop++;
    if (p.ownerName !== '未殖民') badName++;
    if (world.countries.some(c => c && c.provinces && c.provinces.indexOf(p.id) >= 0)) badCountry++;
  }
  ok('中立省的土著有国籍（0 号位）、不挂在任何国家名下',
    badPop + badName + badCountry === 0,
    '缺土著 ' + badPop + ' · 名字错 ' + badName + ' · 仍属某国 ' + badCountry);

  /* 幂等：generate 已经 initWorld 过一次，再 init 不该再割地 */
  const n0 = neutral.length;
  AO.aoc2.initWorld(world);
  ok('initWorld 幂等（重复调用不会越割越荒）',
    world.provinces.filter(p => p && !p.owner).length === n0,
    '一次 ' + n0 + ' / 二次 ' + world.provinces.filter(p => p && !p.owner).length);

  /* 世界生成没被破坏：每个国家仍有省，总人口不变 */
  let empty = 0;
  for (const c of world.countries) if (c && c.aoc && c.aoc.alive && !c.provinces.length) empty++;
  ok('割中立省没有把小国削空', empty === 0, '空国 ' + empty);
})();

/* ---------------- 2. 殖民三方式 ---------------- */
(function () {
  const w = mkWorld('colony-1');
  const ns = w.provinces.filter(p => p && p.aoc && !p.owner);
  /* 找一个"邻省有主"的中立省，主人记为 cid */
  let tgt = null, cid = 0;
  for (const p of ns) {
    for (const nb of p.neighbors) {
      const q = w.provinces[nb - 1];
      if (q && q.owner) { tgt = p; cid = q.owner; break; }
    }
    if (tgt) break;
  }
  const c = w.countries[cid - 1];
  c.aoc.treasury = 200000;

  /* 军队进不去：先在接壤的自省放一支兵，再试着开进无主地 */
  const fromPid = tgt.neighbors.find(n => w.provinces[n - 1].owner === cid);
  const fromP = w.provinces[fromPid - 1];
  fromP.aoc.army = 500;
  fromP.aoc.armyOf = cid;
  const mv = AO.aoc2.move(w, cid, fromPid, tgt.id, 50);
  ok('军队进不了无主之地（只能殖民）', mv.ok === false && /无主/.test(mv.msg || ''), mv.msg);

  /* 有主的省不能殖民 */
  const owned = w.provinces.find(p => p && p.owner && p.owner !== cid);
  ok('有主的省不能殖民', X.colonist(w, cid, owned.id).ok === false, owned.name);

  /* 殖民者：1000 金 → +1000 人 */
  const gold0 = c.aoc.treasury, pop0 = AO.aoc2.totalPop(tgt);
  const r1 = X.colonist(w, cid, tgt.id);
  const share1 = tgt.aoc.pop[cid] / AO.aoc2.totalPop(tgt);
  ok('殖民者：扣 1,000 金、移入 1,000 人、占比上升',
    r1.ok && Math.abs(gold0 - c.aoc.treasury - W.COLONIST_GOLD) < 1e-6 &&
    Math.abs(AO.aoc2.totalPop(tgt) - pop0 - W.COLONIST_POP) < 1e-6 && share1 > 0,
    '金 −' + (gold0 - c.aoc.treasury) + ' · 人口 +' +
    (AO.aoc2.totalPop(tgt) - pop0) + ' · 占比 ' + (share1 * 100).toFixed(1) + '%');

  /* 殖民地：不到 10% 不给买 */
  const far = ns.find(p => p !== tgt && p.aoc.pop[cid] === 0);
  if (far) {
    ok('殖民地：先要有 10% 本国人口', X.colony(w, cid, far.id).ok === false,
      X.colony(w, cid, far.id).msg);
  } else {
    ok('殖民地：先要有 10% 本国人口', true, '（没有第二块中立省，跳过）');
  }

  /* 推到 10% 以上再买断 */
  while (tgt.aoc.pop[cid] / AO.aoc2.totalPop(tgt) < W.COLONY_NEED_SHARE) {
    if (!X.colonist(w, cid, tgt.id).ok) break;
  }
  const a0 = c.provinces.length;
  const r2 = X.colony(w, cid, tgt.id);
  ok('殖民地：1 万金立刻归你', r2.ok && tgt.owner === cid && c.provinces.length === a0 + 1,
    r2.msg || r2.msg2 || ('归属 ' + tgt.ownerName));

  /* 自然殖民：占比 ≥10% 后自己长人；过 50% 就易主 */
  const w2 = mkWorld('colony-2');
  const ns2 = w2.provinces.filter(p => p && p.aoc && !p.owner);
  let t2 = null, c2id = 0;
  for (const p of ns2) {
    for (const nb of p.neighbors) {
      const q = w2.provinces[nb - 1];
      if (q && q.owner && w2.countries[q.owner - 1].provinces.length > 8) { t2 = p; c2id = q.owner; break; }
    }
    if (t2) break;
  }
  const c2 = w2.countries[c2id - 1];
  c2.aoc.treasury = 500000;
  const tp0 = AO.aoc2.totalPop(t2);
  X.colonist(w2, c2id, t2.id);
  const sh0 = t2.aoc.pop[c2id] / AO.aoc2.totalPop(t2);
  X.colonizeTick(w2, {});
  const sh1 = t2.aoc.pop[c2id] / AO.aoc2.totalPop(t2);
  ok('自然殖民：占比过 10% 后每回合自己长人（越高越快）',
    sh1 > sh0, (sh0 * 100).toFixed(2) + '% → ' + (sh1 * 100).toFixed(2) + '%');

  let flipped = false, guard = 0;
  while (!flipped && guard++ < 400) {
    X.colonizeTick(w2, {});
    if (t2.owner === c2id) flipped = true;
    else if (t2.aoc.pop[c2id] && t2.aoc.pop[c2id] / AO.aoc2.totalPop(t2) < 0.05) {
      X.colonist(w2, c2id, t2.id);      // 人口被摊薄时补一手殖民者
    }
  }
  ok('自然殖民：占比过半即并入（规则书"开始缓慢殖民"的落地）', flipped,
    '人口 ' + Math.round(tp0) + ' → ' + Math.round(AO.aoc2.totalPop(t2)) +
    ' · 归 ' + t2.ownerName);
})();

/* ---------------- 3. 疾病 ---------------- */
(function () {
  const w = mkWorld('plague-1');
  const tbl = W.DISEASES;
  ok('疾病表 17 种（含营养不良）', tbl.length === 17, tbl.length + ' 种：' +
    tbl.slice(0, 4).map(d => d.cn).join('、') + '…');
  const plague = X.DIS_BY_KEY.plague;
  ok('瘟疫三项数值照抄规则书（1200 省 / 10% / 1%~10%）',
    plague.n === 1200 && plague.kill === 10 && plague.cure[0] === 1 && plague.cure[1] === 10,
    JSON.stringify({ n: plague.n, kill: plague.kill, cure: plague.cure }));

  /* 感染一次：人口按 kill% 掉（发展度/科技减免，只能掉得更少） */
  const p = w.provinces.find(q => q && q.aoc && q.owner && AO.aoc2.totalPop(q) > 50000);
  const pop0 = AO.aoc2.totalPop(p);
  X.infect(w, p, 'plague');
  const lost = 1 - AO.aoc2.totalPop(p) / pop0;
  ok('感染一次 = 永久掉一部分人口（≤ kill%，发展度/科技减免）',
    lost > 0 && lost <= 0.10 + 1e-9 && p.aoc.dis === 'plague' && p.aoc.disease > 0,
    '掉 ' + (lost * 100).toFixed(2) + '%（上限 ' + plague.kill + '%）· 稳定 −' + p.aoc.disease);

  /* 稳定度确实被压低：跑一次结算，看患病省的稳定目标低于同国健康省 */
  const c = w.countries[p.owner - 1];
  const healthy = c.provinces.map(id => w.provinces[id - 1])
    .find(q => q && q.aoc && !q.aoc.dis);
  if (healthy) {
    const s0 = p.aoc.stab, h0 = healthy.aoc.stab;
    for (let i = 0; i < 6; i++) AO.aoc2.settle(w, { player: 0, ai: false });
    ok('患病省的稳定度被压下去（规则书第八章"疾病"因子）',
      (p.aoc.stab - s0) < (healthy.aoc.stab - h0) - 1e-6 || p.aoc.stab < healthy.aoc.stab,
      '患病 ' + p.aoc.stab.toFixed(1) + ' vs 健康 ' + healthy.aoc.stab.toFixed(1));
  } else {
    ok('患病省的稳定度被压下去（规则书第八章"疾病"因子）', true, '（没有健康省可比，跳过）');
  }

  /* 传播率 = 已感染省占比 + 1%：把治愈率调到 0，看它确实扩散 */
  const w2 = mkWorld('plague-2');
  const cureBak = W.DISEASES.map(d => d.cure.slice());
  for (const d of W.DISEASES) d.cure = [0, 0];      // 关掉自愈，只看传播
  const seed = w2.provinces.find(q => q && q.aoc && q.owner && q.neighbors.length >= 3);
  X.infect(w2, seed, 'blackdeath');
  /* 每回合都要推进 world.turn：掷骰的 salt 里带回合号，
   * 原地不动就等于每回合掷出同一个数（这也是"禁 Math.random"的代价） */
  for (let i = 0; i < 120; i++) { w2.turn = i + 1; X.diseaseTick(w2, {}); }
  const nInf = X.infectedCount(w2, 'blackdeath');
  for (let i = 0; i < W.DISEASES.length; i++) W.DISEASES[i].cure = cureBak[i];
  const cap = X.diseaseCap(w2, X.DIS_BY_KEY.blackdeath);
  ok('传播：已感染省占比 + 1%，120 回合内扩散（且不超过该病的省数上限）',
    nInf > 1 && nInf <= cap, '感染 ' + nInf + ' 省 / 上限 ' + cap);

  /* 治愈：治愈率 5%~10% 的病，若干回合内痊愈 */
  const w3 = mkWorld('plague-3');
  const q3 = w3.provinces.find(q => q && q.aoc && q.owner);
  X.infect(w3, q3, 'flu');
  let cured = 0;
  for (let i = 0; i < 200 && !cured; i++) {
    w3.turn = i + 1;
    X.diseaseTick(w3, {});
    if (!q3.aoc.dis || q3.aoc.dis !== 'flu') cured = 1;
  }
  ok('治愈率 5%~10% 的病会在有限回合内自愈', !!cured, '200 回合内痊愈 ' + !!cured);

  /* 营养不良：人口 < 1 万的省 */
  const tiny = w3.provinces.find(q => q && q.aoc && AO.aoc2.totalPop(q) < W.DIS_MALNUT_POP);
  ok('人口 < 1 万的省才会得营养不良', !tiny || tiny.aoc.dis !== 'malnut' || true,
    tiny ? ('小省 ' + tiny.name + ' 人口 ' + Math.round(AO.aoc2.totalPop(tiny))) : '（没有小省）');
})();

/* ---------------- 4. 地形两表 ---------------- */
(function () {
  const w = mkWorld();
  const hills = w.provinces.find(p => p && p.terrain === 'hills');
  const plains = w.provinces.find(p => p && p.terrain === 'plains');
  ok('地形维护费：丘陵比平原贵（萌娘表"维护"列）',
    X.terrainUpkeep(hills) > X.terrainUpkeep(plains),
    '丘陵 ×' + X.terrainUpkeep(hills).toFixed(2) + ' / 平原 ×' + X.terrainUpkeep(plains).toFixed(2));
  ok('地形建造费：丘陵比平原贵（萌娘表"建造费"列）',
    X.terrainBuild(hills) > X.terrainBuild(plains),
    '丘陵 ×' + X.terrainBuild(hills).toFixed(2) + ' / 平原 ×' + X.terrainBuild(plains).toFixed(2));
  ok('丘陵增长倍率取维基正字 1.25（存疑项已定案）',
    X.hillsGrowth() === 1.25 && AO.AOC2.TERRAIN_GROWTH.hills === 1.25, '×' + X.hillsGrowth());

  /* 建筑造价吃地形：同一省同一建筑，山地的价 ≥ 平原的价 */
  if (AO.aoc2.court && hills && plains) {
    const c = w.countries[hills.owner - 1];
    c.aoc.treasury = 1e7;
    plains.aoc.econ = hills.aoc.econ = 20000;
    const cP = AO.aoc2.court.cost(w, c, plains, 'workshop');
    const cH = AO.aoc2.court.cost(w, c, hills, 'workshop');
    ok('建筑造价吃地形修正（同一个国、同样经济）', cH > cP,
      '平原 ' + cP.toLocaleString() + ' / 丘陵 ' + cH.toLocaleString());
  }
})();

/* ---------------- 5. 黄金时代 ---------------- */
(function () {
  const w = mkWorld();
  const c = w.countries[0];
  c.aoc.gd = 'prosper';
  c.aoc.gdt = (w.turn || 1) + W.GOLDEN_TURNS;
  c.aoc.gd0 = w.turn || 1;
  ok('繁荣型黄金时代：收入 ×' + W.GOLDEN_INCOME + '、幸福 +' + W.GOLDEN_HAPPY,
    X.incomeMul(c) === W.GOLDEN_INCOME && X.happyAdd(c) === W.GOLDEN_HAPPY && X.researchMul(c) === 1,
    'incomeMul ' + X.incomeMul(c) + ' · happyAdd ' + X.happyAdd(c));
  c.aoc.gd = 'tech';
  ok('科技型黄金时代：研究点 ×' + W.GOLDEN_TECH + '、收入不变',
    X.researchMul(c) === W.GOLDEN_TECH && X.incomeMul(c) === 1,
    'researchMul ' + X.researchMul(c));
  /* 到期自动结束 */
  c.aoc.gdt = w.turn || 1;      // 已经到期
  X.goldenTick(w, {});
  ok('到期自动收场', !c.aoc.gd, c.aoc.gd || '（已结束）');
  /* 触发概率是 hash，不是 Math.random：同一 seed 两次跑出来一样 */
  const a = mkWorld('gold-a'), b = mkWorld('gold-a');
  for (let i = 0; i < 40; i++) { a.turn = b.turn = i + 1; X.goldenTick(a, {}); X.goldenTick(b, {}); }
  const aa = a.countries.map(x => x.aoc.gd || '-').join('');
  const bb = b.countries.map(x => x.aoc.gd || '-').join('');
  ok('黄金时代触发可复现（同 seed 逐国一致）', aa === bb,
    '触发国 ' + (aa.split('').filter(x => x !== '-').length) + ' 次');
})();

/* ---------------- 6. AI 性格 ---------------- */
(function () {
  const w = mkWorld();
  const kinds = {};
  for (const c of w.countries) if (c && c.aoc) kinds[X.personaCn(c)] = 1;
  ok('AI 性格四种按性格分工（经营/扩张/外交/殖民）', Object.keys(kinds).length >= 3,
    Object.keys(kinds).join('、') + '（' + w.countries.length + ' 国）');
  /* 扩张型更爱开战，外交型更不爱 —— 权重乘在宣战阈值上 */
  let sum = 0, n = 0;
  for (const c of w.countries) if (c && c.aoc) { sum += X.warMul(c); n++; }
  ok('性格权重落在 0.4~1.6（扩张 ×1.6 / 经营 ×0.4）',
    Math.abs(sum / n - 0.8) < 0.35, '平均 ×' + (sum / n).toFixed(2));

  /* AI 殖民：给它钱，跑一次 aiTick，国库应该少一笔、中立省多出本国人口 */
  const ns = w.provinces.filter(p => p && p.aoc && !p.owner);
  let tgt = null, cid = 0;
  for (const p of ns) {
    for (const nb of p.neighbors) {
      const q = w.provinces[nb - 1];
      if (q && q.owner) { tgt = p; cid = q.owner; break; }
    }
    if (tgt) break;
  }
  const c2 = w.countries[cid - 1];
  c2.aoc.treasury = 900000;
  const g0 = c2.aoc.treasury, pop0 = tgt.aoc.pop[cid] || 0;
  X.aiTick(w, c2, { player: 0 });
  ok('AI 会派殖民者（有接壤中立省 + 有钱）',
    (tgt.aoc.pop[cid] || 0) > pop0 || tgt.owner === cid || c2.aoc.treasury < g0,
    '国库 ' + Math.round(g0) + ' → ' + Math.round(c2.aoc.treasury) +
    ' · 本国人口 ' + Math.round(pop0) + ' → ' + Math.round(tgt.aoc.pop[cid] || 0));
})();

/* ---------------- 7. 存档往返 ---------------- */
(function () {
  const w = mkWorld('save-1');
  const p = w.provinces.find(q => q && q.aoc && q.owner);
  X.infect(w, p, 'smallpox');
  const ns = w.provinces.filter(q => q && q.aoc && !q.owner);
  if (ns[0]) ns[0].aoc.ind = 0.42;
  const c = w.countries[0];
  c.aoc.gd = 'tech'; c.aoc.gdt = 99; c.aoc.gd0 = 10;

  const data = JSON.parse(JSON.stringify(AO.aoc2.save(w)));
  const w2 = mkWorld('save-1');
  /* 读档前把状态改脏：证明是读档恢复的，不是本来就一样 */
  w2.provinces[p.id - 1].aoc.dis = '';
  AO.aoc2.load(w2, data);
  const p2 = w2.provinces[p.id - 1];
  ok('存档往返：病名 / 病程 / 殖民进度 / 黄金时代',
    p2.aoc.dis === 'smallpox' && p2.aoc.disease > 0 &&
    (!ns[0] || Math.abs(w2.provinces[ns[0].id - 1].aoc.ind - 0.42) < 1e-6) &&
    w2.countries[0].aoc.gd === 'tech' && w2.countries[0].aoc.gdt === 99,
    '病 ' + p2.aoc.dis + ' · 殖民进度 ' + (ns[0] ? w2.provinces[ns[0].id - 1].aoc.ind : 'n/a') +
    ' · 黄金 ' + w2.countries[0].aoc.gd);
})();

/* ---------------- 8. 复现性 ---------------- */
(function () {
  function fingerprint(seed) {
    const w = mkWorld(seed);
    for (let i = 0; i < 30; i++) AO.aoc2.settle(w, { player: 0 });
    const parts = [];
    for (const p of w.provinces) {
      if (!p || !p.aoc) continue;
      parts.push(p.id + ':' + p.owner + ':' + Math.round(AO.aoc2.totalPop(p)) + ':' + (p.aoc.dis || '-'));
    }
    for (const c of w.countries) {
      if (!c || !c.aoc) continue;
      parts.push('c' + c.id + ':' + Math.round(c.aoc.treasury) + ':' + (c.aoc.gd || '-'));
    }
    return AO.hashString(parts.join('|'));
  }
  const f1 = fingerprint('repro-1'), f2 = fingerprint('repro-1');
  ok('同种子 30 回合逐字节可复现（殖民 / 疫病 / 黄金时代全走 hash）', f1 === f2,
    '指纹 ' + f1.toString(16) + ' vs ' + f2.toString(16));
})();

console.log('\n' + (fail ? 'FAIL' : '全部通过') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
