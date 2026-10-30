/* =============================================================
 * 16-aoc2-court.js —— 庙堂层（阶段四上半）：建筑八种 + 科技
 *
 * 规则书第五、六章。这一层回答两个问题：
 *   ① 省里的钱能变成什么（建筑：八种，图书馆→大学算一条链的两级）
 *   ② 国家的钱能变成什么（科技：研究点 → 科技点 → 科技等级 0.01~50）
 *
 * 为什么建筑和科技放在同一个文件：它们是同一个循环的两头 —— 图书馆产研究点、
 * 研究点抬科技、科技解锁更高级的建筑。拆成两个文件会让"改一个数要翻两处"。
 *
 * 口径要点（照抄规则书，占位值集中在本文件的 AOC2 扩展区）：
 *   - 造价随"已拥有的同种建筑数量"递增，**在建的不计入** —— 所以一口气排队
 *     批量建比建完一个再建下一个便宜。这是规则书明说的特性，不是 bug。
 *   - 图书馆每回合 +0.01 研究点、大学 +0.02；每 100 研究进度 = 1 科技点。
 *   - 科技等级越高越贵（边际递增），效果见 TECH_* 那组系数。
 *
 * 纯逻辑、不碰 DOM：node 里可以直接跑（test/aoc2-court.js）。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});
  AO.aoc2 = AO.aoc2 || {};
  var AOC2 = AO.AOC2;

  /* =============================================================
   * ① 定义区（改数字只来这里）
   * ============================================================= */

  /* 建筑表：等级上限 / 造价基数 / 工期（回合）/ 地形与科技前置。
   * `max` 是等级上限；`need` 是"必须先有的别的建筑等级"；`coast` 只能沿海。 */
  var BLD = {
    farm: {
      key: 'farm', cn: '农场', max: 5, base: 3200, turns: 3,
      terrain: ['plains', 'grassland', 'forest'],
      cn1: '人口增长 +5%/级', why: '只能建在平原 / 草原 / 森林'
    },
    workshop: {
      key: 'workshop', cn: '工坊', max: 3, base: 4800, turns: 3,
      cn1: '收入 +5%/级'
    },
    library: {
      key: 'library', cn: '图书馆', max: 2, base: 7200, turns: 4,
      cn1: '每回合 +0.01 研究点；研究速度 +人口/725（2 级 425）'
    },
    university: {
      key: 'university', cn: '大学', max: 1, base: 19200, turns: 6,
      need: { library: 2 },
      cn1: '每回合 +0.02 研究点', why: '要先有 2 级图书馆'
    },
    castle: {
      key: 'castle', cn: '城堡', max: 3, base: 12000, turns: 5, tech: 0.3,
      cn1: '防御 +10%/级，守军损耗减少', why: '要科技 0.3'
    },
    watchtower: {
      key: 'watchtower', cn: '瞭望塔', max: 1, base: 5600, turns: 3,
      cn1: '防御 +4%，揭开邻省迷雾（迷雾是阶段五）'
    },
    port: {
      key: 'port', cn: '港口', max: 1, base: 9600, turns: 5, tech: 0.6, coast: true,
      cn1: '少量收入（+3%）；军队出海（海军是阶段五）', why: '只能建在沿海，且要科技 0.6'
    },
    armory: {
      key: 'armory', cn: '军械库', max: 1, base: 8800, turns: 4, tech: 0.6,
      cn1: '募兵成本 −1 金/兵', why: '要科技 0.6'
    },
    camp: {
      key: 'camp', cn: '补给营地', max: 1, base: 6400, turns: 3, tech: 0.3,
      cn1: '本地驻军维护费 −20%', why: '要科技 0.3'
    }
  };
  /* UI 的固定顺序：先经济（农场/工坊），再科研（图书馆/大学），
   * 再军事（城堡/瞭望塔/港口/军械库/营地）—— 和玩家的决策顺序一致。 */
  var BLD_ORDER = ['farm', 'workshop', 'library', 'university',
    'castle', 'watchtower', 'port', 'armory', 'camp'];

  var T = {
    /* ---- 建筑 ---- */
    BLD_COST_INFLATE: 0.35,   // 占位：同种建筑每多一级，造价 +35%
    /* 造价按"这个省有多大"折算：0.25 + 经济/20000。
     * 为什么要有这一项：本世界的省经济是十万级（省均人口 15 万），
     * 而规则书那张建筑表是 AoH2 的绝对值口径（几百到几千金）。直接照抄，
     * 一座农场只值大国半回合收入的 0.2%，等于白送。折算之后
     * "一座建筑 ≈ 这个省两三回合的收入"，建与不建才有取舍。 */
    BLD_COST_ECON: 20000,
    BLD_COST_LEVEL: 0.60,     // 占位：本省这一级已有 lv 级时，造价 ×(1 + lv×0.6)
    BLD_QUEUE_MAX: 4,         // 占位：一个省同时最多排 4 个（不是规则，是手感）
    FARM_GROWTH: 0.05,        // 第五章：农场人口增长 +5%/级
    WORKSHOP_INCOME: 0.05,    // 第五章：工坊收入 +5%/级
    PORT_INCOME: 0.03,        // 占位：港口"少量收入"（规则书没给数）
    LIB_RP: 0.01,             // 第五章：图书馆每回合 +0.01 研究点
    UNI_RP: 0.02,             // 第五章：大学每回合 +0.02 研究点
    LIB_POP_PER: 725,         // 第五章：每 725 人口 +1% 研究速度（1 级）
    LIB_POP_PER2: 425,        // 第五章：2 级后每 425 人口 +1%
    /* 规则书那两个分母是按 AoH2 的万级人口写的；本世界省均 15 万，
     * 照抄会得到 +276% 的研究速度（实测直接把科技顶满）。这里折算 1/1000
     * 并封顶 60%：形状保留（人口越多越快、2 级更快），量级能玩。 */
    LIB_BONUS_SCALE: 0.001,
    LIB_BONUS_CAP: 0.60,
    CASTLE_DEF: 10,           // 第五章：城堡防御 +10%/级
    TOWER_DEF: 4,             // 第五章：瞭望塔防御 +4%
    CAMP_UPKEEP: 0.20,        // 第五章：补给营地本地驻军维护费 −20%
    ARMORY_SAVE: 1,           // 第五章：军械库募兵成本 −1 金/兵

    /* ---- 科技 ---- */
    TECH_MIN: 0.01,           // 第六章：科技等级 0.01 ~ 50.0
    TECH_MAX: 50,
    TECH_STEP: 0.5,           // 占位：一次研究升 0.5 级（规则书只给范围）
    TECH_TP_BASE: 1.2,        // 占位：升级消耗 = ceil(1.2 × (1 + 等级/8)^1.5) 科技点
    TECH_TP_POW: 1.5,
    TECH_PER_POINT: 100,      // 第六章：每攒满 100 研究进度 = 1 科技点
    TECH_INCOME: 0.01,        // 第六章：科技更高 → 收入更高（每级 +1%）
    TECH_COMBAT: 0.01,        // 占位：每级 +1% 战力
    TECH_DEF: 0.5,            // 占位：每级 +0.5 省防御
    TECH_MP: 0.2,             // 第六章：每级更多移动点（每 5 级 +1 点）
    TECH_GOODS: 0.005,        // 占位：每级 +0.5% 物资产出
    /* 1 金科研款 = 0.004 研究点。这个数是**实测标定**的：规则书只给"花钱买研究点"，
     * 没给汇率；0.1 时 100 回合科技顶满 50，0.004 时 T100 中位 7.5、T300 中位 24。
     * 图书馆/大学那 +0.01/+0.02 是 AoH2 的绝对口径，在本世界尺度下可忽略 ——
     * 图书馆真正的价值是 researchMul（按人口给研究速度，封顶 +60%）。 */
    RP_PER_GOLD: 0.004,
    AI_TECH_MAX_PER_TURN: 3,  // 占位：AI 一回合最多升几级（免得一夜之间科技爆炸）
    AI_BUILD_MAX_PER_TURN: 2,
    /* AI 的建设预算：账上留 0.3 回合毛收入当周转，每回合最多花 12% 毛收入。
     * 为什么不是"留三回合"：AI 的余钱出口（投资经济/发展）每回合都把国库
     * 花到只剩两回合毛收入以下，按三回合留的话预算永远是负的 —— 实测
     * 100 回合全图只盖了 9 座建筑。 */
    AI_BUILD_KEEP_GROSS: 0.3,
    AI_BUILD_SHARE: 0.12,
  };

  AO.aoc2.court = AO.aoc2.court || {};
  var C = AO.aoc2.court;
  C.BLD = BLD;
  C.ORDER = BLD_ORDER;
  C.T = T;

  /* =============================================================
   * ② 小工具
   * ============================================================= */
  function techOf(c) {
    return (c && c.aoc && c.aoc.tech) || T.TECH_MIN;
  }
  function lv(p, k) {
    return (p && p.aoc && p.aoc.bld && p.aoc.bld[k]) || 0;
  }
  function queueOf(p) {
    return (p && p.aoc && p.aoc.queue) || [];
  }
  C.techOf = techOf;
  C.lv = lv;
  C.queueOf = queueOf;

  /* 全国同种建筑已完成的等级合计：造价按它递增（在建的不算） */
  function ownedLevels(world, c, k) {
    var n = 0, i, p;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (p && p.aoc) n += lv(p, k);
    }
    return n;
  }
  C.ownedLevels = ownedLevels;

  /* 下一级的造价 */
  C.cost = function (world, c, p, k) {
    var def = BLD[k];
    if (!def) return 0;
    var owned = ownedLevels(world, c, k);
    var cur = lv(p, k);
    var size = 0.25 + (p.aoc.econ || 0) / T.BLD_COST_ECON;
    return Math.round(def.base * size * (1 + owned * T.BLD_COST_INFLATE) *
      (1 + cur * T.BLD_COST_LEVEL));
  };

  /* 能不能建：把"为什么不能"一次说清（UI 与 AI 共用同一套判断） */
  C.canBuild = function (world, c, p, k) {
    var def = BLD[k];
    if (!def) return { ok: false, why: '没有这种建筑' };
    if (!p || !p.aoc) return { ok: false, why: '目标不存在' };
    if (p.owner !== c.id) return { ok: false, why: '不是自己的省' };
    if (lv(p, k) >= def.max) return { ok: false, why: def.cn + '已到 ' + def.max + ' 级' };
    if (queueOf(p).length >= T.BLD_QUEUE_MAX) {
      return { ok: false, why: '这个省的工地排满了（' + T.BLD_QUEUE_MAX + ' 个）' };
    }
    if (def.terrain && def.terrain.indexOf(p.terrain) < 0) {
      return { ok: false, why: def.why || (def.cn + '不适合这种地形') };
    }
    if (def.coast && !(p.coastDirs > 0)) return { ok: false, why: def.why || '只能建在沿海' };
    if (def.tech && techOf(c) < def.tech) {
      return { ok: false, why: '要科技 ' + def.tech + '（现 ' + techOf(c).toFixed(2) + '）' };
    }
    if (def.need) {
      for (var nk in def.need) {
        if (lv(p, nk) < def.need[nk]) {
          return { ok: false, why: (def.why || ('要先有 ' + def.need[nk] + ' 级' + BLD[nk].cn)) };
        }
      }
    }
    var cost = C.cost(world, c, p, k);
    if (c.aoc.treasury < cost) {
      return { ok: false, why: '国库不足（需 ' + cost.toLocaleString() + ' 金）' };
    }
    return { ok: true, cost: cost };
  };

  /* 开工：钱当场扣，等级等工期满了才涨（在建的不计入造价递增） */
  C.build = function (world, cid, pid, k) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !c.aoc) return { ok: false, msg: '国家不存在' };
    var chk = C.canBuild(world, c, p, k);
    if (!chk.ok) return { ok: false, msg: chk.why };
    var def = BLD[k];
    c.aoc.treasury -= chk.cost;
    p.aoc.queue = p.aoc.queue || [];
    p.aoc.queue.push({ k: k, t: def.turns, cost: chk.cost });
    return {
      ok: true, cost: chk.cost, turns: def.turns,
      msg: '开工：' + p.name + ' ' + def.cn + ' ' + (lv(p, k) + 1) + ' 级（' +
        chk.cost.toLocaleString() + ' 金，' + def.turns + ' 回合）'
    };
  };

  /* 每回合推进工期：**一个省同时只干一件**（队首），完工的等级 +1。
   *
   * 为什么不是整队并行：一个省同时冒出三座农场，等于三级在同一个回合落地，
   * 读起来像"地图上突然长出一座城"。队列的意义就是"先排着"，不是"同时开工"。
   * 造价那一条（在建不计入）仍然成立 —— 排队时就已经把三份钱按原价扣掉了。 */
  C.tick = function (world, c) {
    var i, p, q, done = 0;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || !p.aoc || !p.aoc.queue || !p.aoc.queue.length) continue;
      q = p.aoc.queue[0];
      q.t--;
      if (q.t > 0) continue;
      p.aoc.bld = p.aoc.bld || {};
      p.aoc.bld[q.k] = (p.aoc.bld[q.k] || 0) + 1;
      p.aoc.queue.shift();
      done++;
    }
    return done;
  };

  /* =============================================================
   * ③ 建筑的效果（结算时被 15-aoc2 调用）
   * ============================================================= */

  /* 收入倍率：工坊 + 港口 + 科技 */
  C.incomeMul = function (c, p) {
    var m = 1 + lv(p, 'workshop') * T.WORKSHOP_INCOME;
    if (lv(p, 'port')) m += T.PORT_INCOME;
    m *= 1 + techOf(c) * T.TECH_INCOME;
    return m;
  };

  /* 人口增长倍率：农场 */
  C.growthMul = function (p) {
    return 1 + lv(p, 'farm') * T.FARM_GROWTH;
  };

  /* 物资产出倍率：科技（第六章"更多物资产出"） */
  C.goodsMul = function (c) {
    return 1 + techOf(c) * T.TECH_GOODS;
  };

  /* 军费：按"兵属于谁"逐省算，补给营地只降本地驻军 */
  C.upkeepOf = function (world, c, g, A) {
    var base = AOC2.UPKEEP_PER_SOLDIER * (1 + g.upkeep / 100) *
      (1 + (A.wear || 0) * AOC2.WEAR_UPKEEP);
    var sum = 0, i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || !(p.aoc.army > 0)) continue;
      if ((p.aoc.armyOf || p.owner) !== c.id) continue;
      sum += p.aoc.army * base * (1 - T.CAMP_UPKEEP * lv(p, 'camp'));
    }
    return sum;
  };

  /* 每回合的固定研究点：图书馆 + 大学 */
  C.flatRp = function (world, c) {
    var sum = 0, i, p;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || !p.aoc) continue;
      sum += lv(p, 'library') * T.LIB_RP + lv(p, 'university') * T.UNI_RP;
    }
    return sum;
  };

  /* 研究速度倍率：图书馆按人口给（1 级 725、2 级 425），封顶 60% */
  C.researchMul = function (world, c) {
    var bonus = 0, i, p;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || !p.aoc) continue;
      var l = lv(p, 'library');
      if (!l) continue;
      var per = l >= 2 ? T.LIB_POP_PER2 : T.LIB_POP_PER;
      bonus += AO.aoc2.totalPop(p) / per * T.LIB_BONUS_SCALE;
    }
    return 1 + Math.min(T.LIB_BONUS_CAP, bonus);
  };

  /* 移动点上限：科技每 5 级 +1 点 */
  C.mpMaxOf = function (c) {
    return AOC2.MP_BASE + Math.floor(techOf(c) * T.TECH_MP);
  };

  /* 省防御加成（%）：城堡 + 瞭望塔 + 科技。地形与政体由 15-aoc2 那两处加 */
  C.defOf = function (c, p) {
    return lv(p, 'castle') * T.CASTLE_DEF + lv(p, 'watchtower') * T.TOWER_DEF +
      techOf(c) * T.TECH_DEF;
  };

  /* 募兵单价：军械库每兵 −1 金（不低于 1 金） */
  C.recruitUnit = function (p) {
    return Math.max(1, AOC2.RECRUIT_GOLD - lv(p, 'armory') * T.ARMORY_SAVE);
  };

  /* 战力倍率：科技（第六章"更强军队"） */
  C.combatMul = function (c) {
    return 1 + techOf(c) * T.TECH_COMBAT;
  };

  /* 一个省的建筑总览（UI / 探针读） */
  C.summaryOf = function (p) {
    var out = [], i, k;
    for (i = 0; i < BLD_ORDER.length; i++) {
      k = BLD_ORDER[i];
      if (lv(p, k)) out.push(BLD[k].cn + ' ' + lv(p, k));
    }
    return out;
  };

  /* =============================================================
   * ④ 科技
   * ============================================================= */

  /* 现有科技点 = 研究进度 / 100（规则书：每攒满 100 研究进度 = 1 科技点） */
  C.techPoints = function (c) {
    return Math.floor(((c.aoc.rp || 0) / T.TECH_PER_POINT) * 100) / 100;
  };

  /* 升一级要几个科技点（越高越贵） */
  C.techCost = function (c) {
    return Math.ceil(T.TECH_TP_BASE * Math.pow(1 + techOf(c) / 8, T.TECH_TP_POW));
  };

  C.techUp = function (world, cid) {
    var c = world.countries[cid - 1];
    if (!c || !c.aoc) return { ok: false, msg: '国家不存在' };
    var lvl = techOf(c);
    if (lvl >= T.TECH_MAX) return { ok: false, msg: '科技已经满级（50.0）' };
    var cost = C.techCost(c);
    var tp = C.techPoints(c);
    if (tp < cost) {
      return { ok: false, msg: '科技点不够（需 ' + cost + '，有 ' + tp.toFixed(2) + '）' };
    }
    c.aoc.rp -= cost * T.TECH_PER_POINT;
    if (c.aoc.rp < 0) c.aoc.rp = 0;
    c.aoc.tech = Math.min(T.TECH_MAX, Math.round((lvl + T.TECH_STEP) * 100) / 100);
    /* 科技抬高移动点上限：当场生效，玩家点完就能看到池子变大 */
    if (c.aoc.mpMax < C.mpMaxOf(c)) {
      c.aoc.mp += C.mpMaxOf(c) - c.aoc.mpMax;
      c.aoc.mpMax = C.mpMaxOf(c);
    }
    return {
      ok: true, cost: cost, tech: c.aoc.tech,
      msg: '科技 ' + c.aoc.tech.toFixed(2) + '（−' + cost + ' 科技点）'
    };
  };

  /* =============================================================
   * ⑤ 岸线画像（coastDirs / coastSteep）
   *
   * 这两个字段原来是别的模块算的，那次换血清理把它们一起删了 ——
   * 结果省卡的"岸线"永远写"内陆"，港口也永远建不了。
   * 现在在这里补回来：沿省界顶点看 3×3 邻域有没有海，按象限数出"几面临海"。
   * 只在 initWorld 跑一次（1106 省约 5ms），不占每帧。
   * ============================================================= */
  C.profileCoast = function (world) {
    if (!world || !world.land || !world.provinces) return 0;
    var W = world.meta.width, H = world.meta.height, land = world.land;
    var coastal = 0, i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.rings || !p.rings.length) continue;
      var co = p.rings[0].coords;
      var cx = p.centroid[0], cy = p.centroid[1];
      var hits = 0, quad = {};
      for (var j = 0; j < co.length; j += 2) {
        var x = Math.round(co[j]), y = Math.round(co[j + 1]);
        var sea = false;
        for (var dy = -1; dy <= 1 && !sea; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (!land[ny * W + nx]) { sea = true; break; }
          }
        }
        if (!sea) continue;
        hits++;
        var ang = Math.atan2(y - cy, x - cx);
        var q = Math.round((ang + Math.PI) / (Math.PI / 2)) % 4;
        quad[q] = 1;
      }
      /* 只碰到一个顶点的不算沿海：那是边界取整的毛刺，不是真的海 */
      if (hits >= 2) {
        p.coastDirs = Math.min(3, Object.keys(quad).length);
        p.coastSteep = 0.35;      // 占位：陡岸/缓岸的实测值没留下，先按"宜建港"
        coastal++;
      } else {
        p.coastDirs = 0;
        p.coastSteep = 0;
      }
    }
    return coastal;
  };

  /* =============================================================
   * ⑥ AI：研究 + 建设
   *
   * 不做"最优解"，只做"别把钱烂在账上"：科技点够就升，国库超过三回合
   * 毛收入就挑一个省盖最便宜且能盖的那一种。玩家的国不自动动 ——
   * 那是玩家自己的决定（和 AI 余钱投资那条同一口径）。
   * ============================================================= */
  C.aiTick = function (world, c, opts) {
    if (opts && opts.player === c.id) return;
    var A = c.aoc, i;
    if (!A || !A.alive) return;

    /* ① 科技：够就升，一回合最多几级 */
    for (i = 0; i < T.AI_TECH_MAX_PER_TURN; i++) {
      if (!C.techUp(world, c.id).ok) break;
    }

    /* ② 建设：留三回合毛收入当周转，剩下的拿去盖 */
    var gross = (A.last && A.last.gross) || 0;
    if (!(gross > 0)) return;
    var budget = Math.min(A.treasury - gross * T.AI_BUILD_KEEP_GROSS,
      gross * T.AI_BUILD_SHARE);
    if (budget < 800) return;
    for (var n = 0; n < T.AI_BUILD_MAX_PER_TURN; n++) {
      /* 挑"性价比"最高的那一座：人口多、这个省还没几座建筑、造价低。
       * 只按造价挑的话，AI 会一路在最小的省里盖（造价最低），
       * 结果穷省全盖满、大城一座没有（实测 300 回合 268 省有建筑，
       * 全是小省）。score 里把人口和"缺建筑"都算进去。 */
      var best = null, bestScore = -1, bestCost = 0;
      for (i = 0; i < c.provinces.length; i++) {
        var p = world.provinces[c.provinces[i] - 1];
        if (!p || !p.aoc || p.aoc.occupied) continue;
        var have = 0, bk;
        for (bk in (p.aoc.bld || {})) have += p.aoc.bld[bk] || 0;
        var pop = AO.aoc2.totalPop(p);
        for (var bi = 0; bi < BLD_ORDER.length; bi++) {
          var k = BLD_ORDER[bi];
          var chk = C.canBuild(world, c, p, k);
          if (!chk.ok || chk.cost > budget) continue;
          var score = pop * (1 + 0.5 * Math.max(0, 9 - have)) / Math.max(1, chk.cost);
          if (score > bestScore) { bestScore = score; bestCost = chk.cost; best = { p: p, k: k }; }
        }
      }
      if (!best) break;
      if (!C.build(world, c.id, best.p.id, best.k).ok) break;
      budget -= bestCost;
    }
  };

  /* 全图统计（探针用）：多少省有建筑、平均科技 */
  C.worldStat = function (world) {
    var pN = 0, withB = 0, bldTotal = 0, techSum = 0, cN = 0, i;
    for (i = 0; i < world.provinces.length; i++) {
      var p = world.provinces[i];
      if (!p || !p.aoc) continue;
      pN++;
      var s = 0, k;
      for (k in (p.aoc.bld || {})) s += p.aoc.bld[k] || 0;
      if (s) withB++;
      bldTotal += s;
    }
    for (i = 0; i < world.countries.length; i++) {
      var c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      cN++; techSum += techOf(c);
    }
    return { provN: pN, withBld: withB, bldTotal: bldTotal,
      avgTech: cN ? techSum / cN : 0, countries: cN };
  };

  /* 研究点入账（15-aoc2 的结算调用）：科研款 + 图书馆/大学的固定产出 */
  C.gainRp = function (world, c, researchMoney) {
    var rp = researchMoney * T.RP_PER_GOLD * C.researchMul(world, c) +
      C.flatRp(world, c);
    c.aoc.rp = (c.aoc.rp || 0) + rp;
    return rp;
  };

})(typeof window !== 'undefined' ? window : globalThis);
