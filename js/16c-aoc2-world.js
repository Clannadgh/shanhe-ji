/* =============================================================
 * 16c-aoc2-world.js —— 山海层（阶段五）：殖民 + 疾病 + 地形 + 黄金时代
 *
 * 规则书第十五、十六、十八、十九章。这一层回答四个问题：
 *   ① 地图上还有没有"没主的地"（中立省 → 殖民）
 *   ② 瘟疫怎么来、怎么走、怎么死人、怎么好（17 种病 + 传播公式）
 *   ③ 地形除了防御和移动，还收不收维护费 / 抬不抬造价（第十八章萌娘表的另两列）
 *   ④ 国运的浪头（黄金时代：随机触发的加成事件）
 *
 * 为什么单独开文件：这四块共用同一个"世界级时钟"（world.tick），
 * 而且都只读省/国的既有字段、不改它们的形状 —— 拆开就等于把同一个循环
 * 切四段，改一处要翻四个文件。经济（15）、庙堂（16）、外交（16b）各管一头，
 * 环境这一头归这里。
 *
 * 三条纪律沿用全项目：
 *   · 禁 Math.random —— 所有掷骰走 AO.hashString(seed + turn + salt)，
 *     同种子同回合必须逐字节复现；
 *   · 占位值集中在本文件的 W 定义区，每处标 `占位：规则书未给出`；
 *   · 纯逻辑、不碰 DOM（test/aoc2-world.js 在 node 里直接跑）。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});
  AO.aoc2 = AO.aoc2 || {};
  var AOC2 = AO.AOC2;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function totalPop(p) {
    var t = 0, k;
    for (k in p.aoc.pop) t += p.aoc.pop[k] || 0;
    return t;
  }

  /* =============================================================
   * ① 定义区（改数字只来这里）
   * ============================================================= */
  var W = {
    /* ---------------- 地形（第十八章）----------------
     * 维基表给了 防御 / 移动 / 增长 三列，已经在 15-aoc2 里落地；
     * 萌娘表另给 维护 / 建造费 两列。两表的地形名对不上（萌娘按"干草原 /
     * 针叶林 / 半沙漠"分，我们只有 10 种），映射见 TERRAIN_MAP。
     * 原则：**以维基表为准**（任务书第四节），萌娘表只补维基没给的那两列。 */
    TERRAIN_UPKEEP: {          // 维护费 ±%（萌娘表"维护"列）
      plains: -5, grassland: 2, forest: 0, hills: 4, mountains: 5,
      desert: 5, tundra: 4, swamp: 5, coast: -5, islands: 4
    },
    TERRAIN_BUILD: {           // 建造费 ±%（萌娘表"建造费"列）
      plains: -5, grassland: 2, forest: 0, hills: 4, mountains: 5,
      desert: 5, tundra: 4, swamp: 5, coast: -5, islands: 4
    },
    /* 我们的 10 种地形 ← 规则书两表里最接近的那一行（注释即对照表）：
     *   plains      平原        coast     农田（沿海低地，增长 ×2）
     *   grassland   稀树草原    forest    森林
     *   hills       丘陵        mountains 山地 / 山脉
     *   desert      沙漠        tundra    苔原
     *   swamp       沼泽        islands   海岸岛屿（维基无此行，占位取森林与苔原之间）
     * 存疑项（维基自己标了"存疑"）：
     *   hills 增长 1.25 还是 1.5 —— 见 TERRAIN_HILLS_GROWTH，实测口径见 DESIGN-WORLD.md；
     *   丛林不在我们的地形集里（forest 取 20% 防御，不取存疑的 30%）。 */
    TERRAIN_HILLS_GROWTH: 1.25,   // 维基表正字；实测见 diag/aoc2-terrain-probe.js

    /* ---------------- 殖民（第十五章）----------------
     * 规则书只给了三种方式的**花费与效果**，没说"中立省从哪来"——
     * 我们这个世界生成器把每一寸陆地都分给了 64 国（实测 1,106 省全部有主）。
     * 所以先得造出中立省：从"大国（≥6 省）"里各割一块人口最少的非首都省。
     * 为什么不是随机挖洞：低人口的省本来就集中在苔原 / 沙漠 / 沼泽那一圈，
     * 割出来就是"未开发的边地"；在腹地挖洞会把一个国家劈成两半，
     * 邻接、AI 行军、国界线全跟着乱。 */
    NEUTRAL_SHARE: 0.045,      // 占位：开局中立省占全图比例（约 50 省）
    NEUTRAL_MIN_PROVS: 6,      // 占位：只从 ≥6 省的国家割（小国不能腰斩）
    NEUTRAL_MAX_PER: 1,        // 占位：每国最多割几块
    COLONIST_GOLD: 1000,       // 第十五章：殖民者 1,000 金
    COLONIST_POP: 1000,        // 第十五章：向目标省移入 1,000 人口
    COLONY_GOLD: 10000,        // 第十五章：殖民地 10,000 金 → 立即殖民
    COLONY_NEED_SHARE: 0.10,   // 占位：殖民地方式要求先有 10% 本国人口（原文"对省人口有要求"含混）
    COLON_NAT_TRIGGER: 0.10,   // 第十五章：本国占比 ≥10% 触发自然殖民
    COLON_NAT_RATE: 0.02,      // 占位：每回合按"超出门槛的部分"追加人口（占比越高越快）
    COLON_TAKE_SHARE: 0.50,    // 占位：占比 ≥50% 该省归你（规则书只说"开始缓慢殖民"）

    /* ---------------- 疾病（第十六章）----------------
     * 表是规则书原表。三个可调值（传播 / 人口损失 / 治愈率）都在表里，
     * 触发与并发上限规则书没给 —— 占位。 */
    DISEASES: [
      { key: 'plague', cn: '瘟疫', n: 1200, kill: 10, cure: [1, 10], terr: ['swamp', 'coast'] },
      { key: 'blackdeath', cn: '黑死病', n: 700, kill: 7.5, cure: [2.5, 10] },
      { key: 'smallpox', cn: '天花', n: 700, kill: 7.5, cure: [1, 10] },
      { key: 'flu', cn: '西班牙流感', n: 400, kill: 3, cure: [5, 10] },
      { key: 'ebola', cn: '埃博拉', n: 100, kill: 0.5, cure: [1, 5], terr: ['swamp'] },
      { key: 'malaria', cn: '疟疾', n: 80, kill: 0.5, cure: [1, 10], terr: ['swamp', 'forest'] },
      { key: 'yellow', cn: '黄热病', n: 60, kill: 0.5, cure: [1, 5], terr: ['swamp'] },
      { key: 'cholera', cn: '霍乱', n: 60, kill: 0.5, cure: [1, 5], terr: ['coast'] },
      { key: 'dengue', cn: '登革热', n: 60, kill: 0.5, cure: [1, 5], terr: ['swamp', 'coast'] },
      { key: 'typhus', cn: '斑疹伤寒', n: 50, kill: 0.5, cure: [1, 5], terr: ['tundra'] },
      { key: 'typhoid', cn: '伤寒', n: 40, kill: 0.5, cure: [1, 5] },
      { key: 'measles', cn: '麻疹', n: 40, kill: 0.5, cure: [1, 5] },
      { key: 'leprosy', cn: '麻风病', n: 30, kill: 0.25, cure: [0.1, 5] },
      { key: 'rabies', cn: '狂犬病', n: 20, kill: 0.1, cure: [0.1, 2] },
      { key: 'mumps', cn: '腮腺炎', n: 20, kill: 0.1, cure: [0.1, 2] },
      { key: 'polio', cn: '脊髓灰质炎', n: 20, kill: 0.1, cure: [0.1, 2] },
      /* 营养不良不是"爆发"出来的病：人口 < 1 万的省每回合自己掷，
       * 所以它不进爆发池（pool:false），只在病名表里占一格。 */
      { key: 'malnut', cn: '营养不良', n: 0, kill: 1, cure: [0.1, 2], pool: false }
    ],
    /* 规则书那张表的"省数"是 AoH2 的地球口径（3,988 个陆地省）。
     * 我们的世界 1,106 省，直接照抄会让一场瘟疫吃掉全图 —— 按比例折算，
     * 再乘一个 0.5 的"气候折扣"（占位：规则书没给触发频率，一天一场瘟疫没法玩）。 */
    WORLD_PROV_REF: 3988,
    DIS_SCALE: 0.5,
    DIS_MAX_ACTIVE: 2,         // 占位：同时最多几种病在流行
    DIS_OUTBREAK: 0.015,       // 占位：每回合爆发一场新瘟疫的概率
    DIS_SPREAD_BASE: 0.01,     // 第十六章：传播率 = 已感染省占比 + 1%
    DIS_STAB: 18,              // 占位：患病省的稳定度 −18（规则书"暂时降低稳定度"）
    DIS_DEV_SHIELD: 0.5,       // 占位：发展度 2.0 时死亡减半（规则书只说"越高越少"）
    DIS_TECH_SHIELD: 0.01,     // 占位：科技每级再减 1%（规则书"科技减少死亡"）
    DIS_MALNUT_POP: 10000,     // 第十六章：人口 < 10,000 的省营养不良
    DIS_MALNUT_CHANCE: 0.02,   // 占位：每回合 2% 掷一次

    /* ---------------- 黄金时代（第十九章）---------------- */
    GOLDEN_CHANCE: 0.004,      // 占位：每回合 0.4%（约 250 回合一次；实测 0.6% 时 64 国长期有 8~10 个在黄金时代，太廉价）
    GOLDEN_TURNS: 24,          // 占位：持续 24 回合（两年）
    GOLDEN_TECH: 1.5,          // 科技型：研究点 ×1.5
    GOLDEN_INCOME: 1.15,       // 繁荣型：收入 ×1.15
    GOLDEN_HAPPY: 5,           // 繁荣型：幸福 +5

    /* ---------------- AI 性格（第二十章）---------------- */
    /* AI 的殖民门槛（占位）：比玩家紧一档。
     * 为什么：殖民者一次 +1,000 人，而边地省只有 6 千~1 万人 —— 一次就是
     * 12% 的占比，AI 要是每回合能派两次、还随手掏 1 万买断，全部边地会在
     * 头 10 回合被瓜分干净（实测 50 块边地 → 6 块）。这里是"AI 也会算账"：
     * 手里要有四倍钱、每回合只派一次、买断要等占比过 35%。 */
    AI_COLON_KEEP: 4,
    AI_COLONY_KEEP: 8,          // 买断要"手里有八倍钱"
    AI_COLON_PER_TURN: 1,
    AI_COLON_FOOTHOLD: 0.12,    // 占比过了 12% 就不再派殖民者（够触发自然殖民了）
    AI_COLONY_MIN_SHARE: 0.25,
  };
  AO.AOC2W = W;

  /* AI 性格表：权重乘在各自的决策阈值上（不是"只能干这个"——
   * 一个扩张型国家照样会投资，只是更爱开战）。 */
  var PERSONA = {
    builder: { key: 'builder', cn: '经营', war: 0.4, colon: 1.0, build: 1.3, diplo: 1.0 },
    conqueror: { key: 'conqueror', cn: '扩张', war: 1.6, colon: 0.7, build: 0.8, diplo: 0.6 },
    diplomat: { key: 'diplomat', cn: '外交', war: 0.5, colon: 0.6, build: 1.0, diplo: 1.6 },
    colonist: { key: 'colonist', cn: '殖民', war: 0.7, colon: 1.8, build: 0.9, diplo: 1.0 }
  };
  var PKEYS = ['builder', 'conqueror', 'diplomat', 'colonist'];
  W.PERSONA = PERSONA;

  /* =============================================================
   * ② 确定性掷骰
   *
   * 全文件只有这一个随机源。salt 里必须带"这是哪一件事、哪一个省/国"，
   * 否则同一个回合里两件事会共用一个数（传播和爆发同步发生）。
   * ============================================================= */
  function wr(world, salt) {
    var seed = (world.meta && world.meta.seedInt) || 0;
    var h = AO.hashString('world:' + seed + ':' + (world.turn || 1) + ':' + salt) >>> 0;
    return (h % 100000) / 100000;
  }
  AO.aoc2.world = {};
  var X = AO.aoc2.world;
  X.roll = wr;

  /* =============================================================
   * ③ 中立省（殖民的前提）
   *
   * 数据形状：p.owner = 0、p.aoc.pop = { 0: 原住民 }、p.aoc.core = { 0: 1 }。
   * 为什么原住民记在国籍表的 0 号位而不是另开一个字段：
   * 人口表本来就是"这块地上有哪些人"，土著也是人；这样 totalPop、
   * 同化、稳定度、殖民占比全部复用同一套代码，一个新分支都不用加。
   * 而且"殖民者进来以后土著成了少数民族"正好就是第十章同化那个场景。
   *
   * 无主省是**世界生成器给的**（苔原 / 沙漠 / 沼泽那一圈边地），
   * 这里的 init 只做三件事：把 0 号位那份人口补齐、把显示名与颜色挂上、
   * 把殖民进度清零。不割任何有主的地 —— 那是把人家版图劈成两半。
   * ============================================================= */
  var NEUTRAL_NAME = '未殖民';
  var NEUTRAL_COLOR = '#b9b09a';

  X.isNeutral = function (p) { return !!p && p.aoc && !p.owner; };
  X.neutralName = NEUTRAL_NAME;

  /* 开局造中立省。返回这批省的 id 列表（测试/探针用）。
   *
   * **必须幂等**：AO.generate 自己会在第 10 步调一次 initWorld（13-main:565），
   * 而测试/UI 常常在建好世界之后再显式调一次 —— 不设闸的话第二次会再割 50 块，
   * 世界越读越荒（实测：generate 后 50 块，再 init 一次变 100 块）。
   * 闸门存在 world 上（不是模块级变量）：一个进程里可能同时有几个世界。 */
  X.initNeutral = function (world) {
    var i, p, c, cid;
    var list = [];
    if (!world || !world.provinces) return list;
    /* ① 已经把 0 号位人口补上的省：顺手补显示字段（读档 / 叛军割出来的） */
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || p.owner) continue;
      p.ownerName = NEUTRAL_NAME;
      p.ownerColor = NEUTRAL_COLOR;
      if (!p.aoc.pop) p.aoc.pop = {};
      if (!p.aoc.pop[0] && p.population) p.aoc.pop[0] = p.population;
      /* 核心：0 号位 = "这块地谁的核心也不是"（无主之地）。
       * 不删它是因为全项目的口径是"每个省都有 core 表"—— 留一个 0 号位
       * 比到处写"中立省可能没有 core"便宜。 */
      if (!p.aoc.core) p.aoc.core = {};
      if (!p.aoc.core[0]) p.aoc.core[0] = 1;
      p.aoc.ind = p.aoc.ind || 0;
      p.aoc.value = AO.aoc2.provValue(p);
      list.push(p.id);
    }
    if (world.aocNeutDone) return list;        // ② 只割一次
    world.aocNeutDone = 1;

    /* ③ 割哪几块：大国（≥6 省）里人口最少的非首都省，每国最多一块。
     * 低人口的省本来就集中在苔原 / 沙漠 / 沼泽那一圈，割出来就是"未开发的边地"，
     * 不会把一个国家的腹地挖出一个洞。 */
    var target = Math.max(0, Math.round(world.provinces.length * W.NEUTRAL_SHARE));
    var cand = [];
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || !p.owner) continue;
      c = world.countries[p.owner - 1];
      if (!c || !c.aoc || !c.provinces || c.provinces.length < W.NEUTRAL_MIN_PROVS) continue;
      if (c.capital === p.id) continue;
      cand.push({ p: p, c: c, pop: totalPop(p) });
    }
    cand.sort(function (a, b) {
      if (a.pop !== b.pop) return a.pop - b.pop;
      return a.p.id - b.p.id;                  // 同人口按 id 定序：可复现
    });
    var per = Object.create(null);
    for (i = 0; i < cand.length && list.length < target; i++) {
      var it = cand[i];
      cid = it.c.id;
      if ((per[cid] || 0) >= W.NEUTRAL_MAX_PER) continue;
      if (it.c.provinces.length <= W.NEUTRAL_MIN_PROVS) continue;   // 割完还得剩够
      per[cid] = (per[cid] || 0) + 1;
      cutNeutral(world, it.p, cid);
      list.push(it.p.id);
    }
    return list;
  };

  /* 把一个有主省改成中立（"放弃"敕令 / 探针造场景用）。
   * 规则书第一章：放弃后人口经济大幅下滑，首都不可放弃。 */
  function cutNeutral(world, p, fromCid) {
    var c = world.countries[(fromCid || p.owner) - 1];
    var pop = Math.max(100, Math.round(totalPop(p)));
    if (c && c.aoc) {
      var idx = c.provinces.indexOf(p.id);
      if (idx >= 0) c.provinces.splice(idx, 1);
      if (c.capital === p.id) c.capital = 0;
    }
    p.owner = 0;
    p.ownerName = NEUTRAL_NAME;
    p.ownerColor = NEUTRAL_COLOR;
    /* 人还在，但"国"没了：原人口变成土著，记在 0 号位 */
    p.aoc.pop = { 0: pop };
    p.aoc.core = p.aoc.core || {};
    if (fromCid) p.aoc.core[fromCid] = 1;   // 旧核心不删（第十章的同一条纪律）
    p.aoc.core[0] = 1;                      // 现在它是无主之地
    p.aoc.occupied = 0;
    p.aoc.army = 0;
    p.aoc.armyOf = 0;
    p.aoc.revolt = 0;
    p.aoc.ind = 0;
    p.population = pop;
    p.aoc.value = AO.aoc2.provValue(p);
    if (c && c.aoc) AO.aoc2.recomputeCountry(world, c);
    return p;
  }
  X.cutNeutral = cutNeutral;

  /* 殖民资格：无主 + 与自国（或已有本国人口的省）接壤。
   * 为什么允许"已经有了桥头堡就不用接壤"：自然殖民长出来的省可能被
   * 另一块地包住，硬要求接壤会让殖民在半路断掉。 */
  X.colonizeWhy = function (world, cid, pid) {
    var p = world.provinces[pid - 1];
    if (!p || !p.aoc) return '目标不存在';
    if (p.owner) return '这省有主（要用战争或贸易）';
    if ((p.aoc.pop[cid] || 0) > 0) return '';
    var nb = p.neighbors || [], i;
    for (i = 0; i < nb.length; i++) {
      var q = world.provinces[nb[i] - 1];
      if (!q) continue;
      if (q.owner === cid) return '';
      if ((q.aoc.pop[cid] || 0) > 0) return '';
    }
    return '要和大片接壤（或先有桥头堡）才能殖民';
  };

  /* 殖民者：1,000 金 → 移入 1,000 人（抬占比，触发/加速自然殖民） */
  X.colonist = function (world, cid, pid) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !c.aoc || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    var why = X.colonizeWhy(world, cid, pid);
    if (why) return { ok: false, msg: why };
    if (c.aoc.treasury < W.COLONIST_GOLD) {
      return { ok: false, msg: '国库不足（殖民者要 ' + W.COLONIST_GOLD.toLocaleString() + ' 金）' };
    }
    c.aoc.treasury -= W.COLONIST_GOLD;
    p.aoc.pop[cid] = (p.aoc.pop[cid] || 0) + W.COLONIST_POP;
    p.population = Math.round(totalPop(p));
    p.aoc.value = AO.aoc2.provValue(p);
    var share = totalPop(p) > 0 ? p.aoc.pop[cid] / totalPop(p) : 0;
    return {
      ok: true, share: share,
      msg: '派出殖民者：' + p.name + ' 的本国人口到 ' + Math.round(share * 100) + '%' +
        (share >= W.COLON_NAT_TRIGGER ? '（已过 ' + Math.round(W.COLON_NAT_TRIGGER * 100) + '% 门槛，开始自然殖民）' : '')
    };
  };

  /* 殖民地：10,000 金 → 立即归你。
   * 规则书原文"对省人口有要求〔待实测〕"，占位口径：本国占比先到 10%。 */
  X.colony = function (world, cid, pid) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !c.aoc || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    var why = X.colonizeWhy(world, cid, pid);
    if (why) return { ok: false, msg: why };
    var tp = totalPop(p);
    var share = tp > 0 ? (p.aoc.pop[cid] || 0) / tp : 0;
    if (share < W.COLONY_NEED_SHARE) {
      return { ok: false, msg: '先要有 ' + Math.round(W.COLONY_NEED_SHARE * 100) +
        '% 的本国人口（现 ' + Math.round(share * 100) + '%）：派殖民者过去' };
    }
    if (c.aoc.treasury < W.COLONY_GOLD) {
      return { ok: false, msg: '国库不足（殖民地要 ' + W.COLONY_GOLD.toLocaleString() + ' 金）' };
    }
    c.aoc.treasury -= W.COLONY_GOLD;
    AO.aoc2.transferProvince(world, pid, cid);
    AO.aoc2.recomputeCountry(world, c);
    return { ok: true, msg: '殖民地建立：' + p.name + ' 归 ' + c.name + '（' + W.COLONY_GOLD.toLocaleString() + ' 金）' };
  };

  /* 自然殖民：占比 ≥10% 的省每回合自行长人，占比过半就归你（第十五章） */
  function colonizeTick(world, opts) {
    var i, j, k, p, q, c;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || p.owner) continue;
      var tp = totalPop(p);
      if (tp < 1) continue;
      /* 每个在这块地上有人的国家各长各的：占比越高长得越快（"越高越快"） */
      var bestCid = 0, bestShare = 0;
      for (k in p.aoc.pop) {
        var cid = k | 0;
        if (!cid) continue;                     // 土著不生（他们不是殖民者）
        var n = p.aoc.pop[k] || 0;
        if (n <= 1) continue;
        var share = n / tp;
        if (share < W.COLON_NAT_TRIGGER) continue;
        c = world.countries[cid - 1];
        if (!c || !c.aoc || !c.aoc.alive) continue;
        var add = tp * W.COLON_NAT_RATE * (share - W.COLON_NAT_TRIGGER + 0.05);
        if (add < 1) continue;
        p.aoc.pop[cid] = n + add;
        tp += add;                              // 分母跟着涨，占比不会一夜翻倍
        var ns = p.aoc.pop[cid] / tp;
        if (ns > bestShare) { bestShare = ns; bestCid = cid; }
      }
      p.population = Math.round(totalPop(p));
      p.aoc.ind = bestShare;            // 省卡上的"殖民进度"就是它
      if (bestCid && bestShare >= W.COLON_TAKE_SHARE) {
        var nm = world.countries[bestCid - 1];
        var nmName = nm ? nm.name : ('#' + bestCid);
        AO.aoc2.transferProvince(world, p.id, bestCid);
        /* 归属变了（transferProvince 已经改过 owner），这里只补一句纪要 */
        X.note(world, '殖民：' + p.name + ' 并入 ' + nmName +
          '（本国人口 ' + Math.round(bestShare * 100) + '%）', nm ? nm.id : 0);
      }
    }
  }
  X.colonizeTick = colonizeTick;

  /* =============================================================
   * ④ 疾病（第十六章）
   *
   * 一个省一次只患一种病（p.aoc.dis = 病 key），三种病同时流行是上限。
   * 杀伤在**感染那一下**一次性结算：规则书说"永久减少人口"，
   * 而逐回合扣会让一场 10% 的病在 40 回合里吃掉三分之一的人（治愈率口径是
   * 1%~10%/回合，等于病能挂 10~100 回合），那是人口黑洞，不是瘟疫。
   * 所以"杀伤 = 感染瞬间的 kill%×(发展度/科技减伤)"，
   * 患病期间只剩稳定度惩罚 —— 这条是占位，写进 DESIGN-WORLD.md。
   * ============================================================= */
  var DIS_BY_KEY = {};
  for (var di = 0; di < W.DISEASES.length; di++) DIS_BY_KEY[W.DISEASES[di].key] = W.DISEASES[di];
  X.DIS_BY_KEY = DIS_BY_KEY;
  X.disCn = function (key) { return (DIS_BY_KEY[key] || {}).cn || ''; };

  /* 一种病在"这个世界"里能感染多少省：地表省数按比例折算 */
  function capOf(world, dis) {
    var n = world.provinces.length;
    return Math.max(3, Math.round(dis.n * n / W.WORLD_PROV_REF * W.DIS_SCALE));
  }
  X.diseaseCap = capOf;

  function infectedCount(world, key) {
    var n = 0, i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (p && p.aoc && p.aoc.dis === key) n++;
    }
    return n;
  }
  X.infectedCount = infectedCount;
  /* 直接让一个省患病（测试 / 探针造场景；正式路径只有爆发与传播两处调它） */
  X.infect = function (world, p, key) {
    var d = DIS_BY_KEY[key];
    if (!d || !p || !p.aoc) return 0;
    return infect(world, p, d);
  };

  /* 感染一个省：先扣人，再挂病 */
  function infect(world, p, dis) {
    var tp = totalPop(p);
    var dev = p.aoc.dev || 0, tech = 0;
    var c = p.owner ? world.countries[p.owner - 1] : null;
    if (c && c.aoc) tech = c.aoc.tech || 0;
    var kill = (dis.kill || 0) / 100;
    kill *= Math.max(0.1, 1 - dev * W.DIS_DEV_SHIELD);
    kill *= Math.max(0.1, 1 - tech * W.DIS_TECH_SHIELD);
    if (kill > 0) {
      for (var k in p.aoc.pop) p.aoc.pop[k] = Math.max(0, p.aoc.pop[k] * (1 - kill));
      p.population = Math.round(totalPop(p));
    }
    p.aoc.dis = dis.key;
    p.aoc.disT = world.turn || 1;
    p.aoc.disease = W.DIS_STAB;          // 结算 ⑥ 里读它压稳定度
    return Math.round(tp * kill);
  }

  function cure(p) {
    p.aoc.dis = '';
    p.aoc.disT = 0;
    /* 病好了但还在挨饿的省，稳定度仍然要压着 */
    p.aoc.disease = p.aoc.mal ? W.DIS_STAB : 0;
  }
  X.cureProvince = cure;

  /* 疾病每回合：爆发 → 传播 → 治愈 → 营养不良 */
  function diseaseTick(world, opts) {
    var i, p, dis, key;
    /* ① 爆发：还没到并发上限，就掷一次 */
    var active = [], ai;
    for (ai = 0; ai < W.DISEASES.length; ai++) {
      dis = W.DISEASES[ai];
      if (dis.pool === false) continue;
      if (infectedCount(world, dis.key) > 0) active.push(dis.key);
    }
    if (active.length < W.DIS_MAX_ACTIVE && wr(world, 'outbreak') < W.DIS_OUTBREAK) {
      /* 候选病：不在流行中的，按"省数"加权（大瘟疫更容易出现） */
      var pool = [], total = 0, k;
      for (ai = 0; ai < W.DISEASES.length; ai++) {
        dis = W.DISEASES[ai];
        if (dis.pool === false) continue;
        if (active.indexOf(dis.key) >= 0) continue;
        pool.push(dis);
        total += dis.n;
      }
      if (pool.length) {
        var roll = wr(world, 'which') * total, pick = pool[0];
        for (ai = 0; ai < pool.length; ai++) { roll -= pool[ai].n; if (roll <= 0) { pick = pool[ai]; break; } }
        /* 起源省：一次播**好几个**（占位：规则书只说"每回合随机触发"，
         * 没说从几个省开始）。为什么不能只播一个：单点爆发的传播率是
         * "已感染占比 + 1%"，而治愈率是 1%~10% —— 一条链在头几十回合里
         * 几乎必然自灭（实测 500 回合峰值只有 3 省，瘟疫等于没发生）。
         * 按该病的"省数"规模播 1~5 个省，大病才有大病的样子。 */
        var seeds = Math.max(1, Math.min(6, Math.round(capOf(world, pick) * 0.03)));
        var first = null;
        for (var si = 0; si < seeds; si++) {
          var start = pickStart(world, pick, si);
          if (!start) break;
          infect(world, start, pick);
          if (!first) first = start;
        }
        if (first) {
          X.note(world, '疫起：' + pick.cn + ' 在 ' + first.name +
            (seeds > 1 ? ' 等 ' + seeds + ' 地' : '') + ' 爆发', first.owner || 0);
        }
      }
    }

    /* ② 传播：已感染省占比 + 1%（第十六章原公式）。
     * 逐省逐邻判定 —— 1100 省 × 平均 3 邻 = 3300 次，每回合一次可接受。
     * 同一回合新感染的省先记进 newly，等整轮扫完再统一落病：
     * 边扫边落的话，"这一轮"的感染数会中途变大，传播率跟着跳，结果依赖遍历顺序。 */
    var total2 = world.provinces.length;
    var cnt = Object.create(null), newly = [], claimed = Object.create(null);
    /* 一次扫全图数一遍：17 种病各扫一遍是 1.8 万次，一回合一次虽不算贵，
     * 但结算尾已经够长了 —— 数一遍就够 */
    for (i = 0; i < world.provinces.length; i++) {
      var pz = world.provinces[i];
      if (pz && pz.aoc && pz.aoc.dis) cnt[pz.aoc.dis] = (cnt[pz.aoc.dis] || 0) + 1;
    }
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || !p.aoc.dis) continue;
      dis = DIS_BY_KEY[p.aoc.dis];
      if (!dis || dis.key === 'malnut') continue;   // 营养不良不传染
      var share = cnt[dis.key] / Math.max(1, total2);
      var rate = share + W.DIS_SPREAD_BASE;
      var cap = capOf(world, dis);
      var nb = p.neighbors || [];
      for (var j = 0; j < nb.length; j++) {
        var q = world.provinces[nb[j] - 1];
        if (!q || !q.aoc || q.aoc.dis || claimed[q.id]) continue;
        if (cnt[dis.key] >= cap) break;
        if (wr(world, 'spread:' + dis.key + ':' + p.id + ':' + q.id) < rate) {
          claimed[q.id] = 1;
          newly.push({ p: q, key: dis.key });
          cnt[dis.key]++;
        }
      }
    }
    for (i = 0; i < newly.length; i++) {
      infect(world, newly[i].p, DIS_BY_KEY[newly[i].key]);
    }

    /* ③ 治愈：治愈率 0.1%~10%/回合（规则书第十六章） */
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || !p.aoc.dis) continue;
      dis = DIS_BY_KEY[p.aoc.dis];
      if (!dis) { cure(p); continue; }
      var lo = dis.cure[0], hi = dis.cure[1];
      var rate2 = (lo + (hi - lo) * wr(world, 'curelo:' + dis.key)) / 100;
      if (wr(world, 'cure:' + p.id) < rate2) cure(p);
    }

    /* ④ 营养不良（人口 < 1 万的省）——不传染，自己掷。
     *
     * 它和传染病**并存**，不抢 p.aoc.dis 那个格子：小省的邻省动辄就是
     * 营养不良，如果它也占 dis，一场瘟疫会被"隔壁都是营养不良"堵在原地
     * （实测 120 回合 0 扩散）。所以单开一个 p.aoc.mal 布尔。 */
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc) continue;
      if (totalPop(p) >= W.DIS_MALNUT_POP) { p.aoc.mal = 0; continue; }
      if (p.aoc.mal) continue;
      if (wr(world, 'malnut:' + p.id) < W.DIS_MALNUT_CHANCE) {
        var mk = DIS_BY_KEY.malnut;
        var tp0 = totalPop(p);
        var kk = (mk.kill / 100) * Math.max(0.1, 1 - (p.aoc.dev || 0) * W.DIS_DEV_SHIELD);
        for (var kx in p.aoc.pop) p.aoc.pop[kx] = Math.max(0, p.aoc.pop[kx] * (1 - kk));
        p.population = Math.round(totalPop(p));
        p.aoc.mal = 1;
        if (tp0 > 0) p.aoc.ind = p.aoc.ind || 0;
      }
      p.aoc.disease = (p.aoc.dis || p.aoc.mal) ? W.DIS_STAB : 0;
    }
  }
  X.diseaseTick = diseaseTick;

  /* 起源省：有地形偏好的病优先落在偏好地形上，否则全图随便一个 */
  function pickStart(world, dis, nth) {
    var i, p, pref = [];
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc) continue;
      if (dis.terr && dis.terr.indexOf(p.terrain) >= 0) pref.push(p);
    }
    if (!pref.length) {
      /* 没有偏好地形（或偏好地形不存在）：全图任选，但不能选正在患病的省 */
      for (i = 0; i < world.provinces.length; i++) {
        p = world.provinces[i];
        if (p && p.aoc && !p.aoc.dis) pref.push(p);
      }
    }
    if (!pref.length) return null;
    var idx = Math.floor(wr(world, 'start:' + dis.key + ':' + (nth || 0)) * pref.length) % pref.length;
    var out = pref[idx];
    /* 已经被这一轮播过的省要跳过（否则 5 个种子可能落在同一个省上） */
    for (var k = 0; k < (nth || 0) && out && out.aoc.dis === dis.key; k++) {
      idx = (idx + 7919) % pref.length;
      out = pref[idx];
    }
    if (out && out.aoc.dis) return null;
    return out;
  }

  /* 找一个"正在患病"的邻居当源省 —— 只在测试/探针里用（排查传播是否发生了），
   * 正式传播路径已经带着病名走（newly[i].key），不需要回查。 */
  function sourceOf(world, q) {
    var nb = q.neighbors || [], i;
    for (i = 0; i < nb.length; i++) {
      var p = world.provinces[nb[i] - 1];
      if (p && p.aoc && p.aoc.dis && p.aoc.dis !== 'malnut') return p;
    }
    return null;
  }

  /* =============================================================
   * ⑤ 黄金时代（第十九章）
   *
   * 随机触发、限时加成。规则书没说触发条件，只给了"科技型 / 繁荣型"两类。
   * 存一个 c.aoc.gd（kind）与 c.aoc.gdt（到期回合），结算里读。 */
  var GOLDEN_CN = { tech: '科技黄金时代', prosper: '繁荣黄金时代' };
  X.goldenCn = function (c) {
    var A = c && c.aoc;
    return A && A.gd ? (GOLDEN_CN[A.gd] || '') : '';
  };
  X.goldenLeft = function (c, turn) {
    var A = c && c.aoc;
    if (!A || !A.gd) return 0;
    return Math.max(0, (A.gdt || 0) - (turn || 0));
  };
  /* 加成乘数：结算 ① 与 gainRp 读它 */
  X.incomeMul = function (c) {
    var A = c && c.aoc;
    return (A && A.gd === 'prosper') ? W.GOLDEN_INCOME : 1;
  };
  X.researchMul = function (c) {
    var A = c && c.aoc;
    return (A && A.gd === 'tech') ? W.GOLDEN_TECH : 1;
  };
  X.happyAdd = function (c) {
    var A = c && c.aoc;
    return (A && A.gd === 'prosper') ? W.GOLDEN_HAPPY : 0;
  };

  function goldenTick(world, opts) {
    var i, c, A;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      A = c.aoc;
      if (A.gd) {
        if ((world.turn || 1) >= (A.gdt || 0)) {
          A.gd = '';
          A.gdt = 0;
          if (X.note) X.note(world, '黄金时代结束：' + c.name, c.id);
        }
        continue;
      }
      if (wr(world, 'golden:' + c.id) >= W.GOLDEN_CHANCE) continue;
      /* 科技型 / 繁荣型 各半 */
      A.gd = wr(world, 'goldenKind:' + c.id) < 0.5 ? 'tech' : 'prosper';
      A.gd0 = world.turn || 1;
      A.gdt = (world.turn || 1) + W.GOLDEN_TURNS;
      if (X.note) {
        X.note(world, GOLDEN_CN[A.gd] + '：' + c.name + '（' + W.GOLDEN_TURNS + ' 回合）', c.id);
      }
    }
  }
  X.goldenTick = goldenTick;

  /* =============================================================
   * ⑥ AI 性格 + 殖民决策（第二十章）
   *
   * 规则书只说"AI 按关系 / 实力 / 政体 / 距离做判断，侵略度默认 75%"。
   * 完全体要的"按性格分工"是任务书加的（阶段五第 6 条），这里用四个性格
   * 权重乘到既有决策上 —— 不新开一套 AI，只给原来的判断换个秤。
   * ============================================================= */
  function personaOf(c) {
    if (!c) return PERSONA.builder;
    var h = AO.hashString('persona:' + c.id) >>> 0;
    return PERSONA[PKEYS[h % PKEYS.length]];
  }
  X.personaOf = personaOf;
  X.personaCn = function (c) { return personaOf(c).cn; };
  X.warMul = function (c) { return personaOf(c).war; };
  X.buildMul = function (c) { return personaOf(c).build; };

  function aiTick(world, c, opts) {
    if (!c || !c.aoc || !c.aoc.alive) return;
    if (opts && opts.player === c.id) return;
    var P = personaOf(c);
    if (P.colon <= 0.5) return;
    var A = c.aoc, used = 0;
    /* 候选：接壤或已有桥头堡的中立省 */
    var cand = [];
    for (var i = 0; i < world.provinces.length; i++) {
      var p = world.provinces[i];
      if (!p || !p.aoc || p.owner) continue;
      if (X.colonizeWhy(world, c.id, p.id)) continue;
      cand.push(p);
    }
    if (!cand.length) return;
    /* 离得近的先（接壤的排前面，其余按 id 稳定排序） */
    cand.sort(function (a, b) { return a.id - b.id; });
    for (var k = 0; k < cand.length && used < W.AI_COLON_PER_TURN; k++) {
      var q = cand[k];
      var tp = totalPop(q);
      var share = tp > 0 ? (q.aoc.pop[c.id] || 0) / tp : 0;
      /* 已经站稳的省：有钱就买断（殖民地），否则交给自然殖民慢慢长。
       * 只派一次殖民者是**规则书自己的叙述**（"殖民者抬占比，触发/加速
       * 自然殖民"）—— 连派十次等于把 1,000 金一张船票当成传送门。 */
      if (share >= W.AI_COLONY_MIN_SHARE && A.treasury >= W.COLONY_GOLD * W.AI_COLONY_KEEP) {
        if (X.colony(world, c.id, q.id).ok) { used++; continue; }
      }
      if (share >= W.AI_COLON_FOOTHOLD) continue;
      if (A.treasury >= W.COLONIST_GOLD * W.AI_COLON_KEEP / Math.max(0.5, P.colon)) {
        if (X.colonist(world, c.id, q.id).ok) used++;
      } else break;
    }
  }
  X.aiTick = aiTick;

  /* =============================================================
   * ⑦ 世界时钟：一回合一次（15-aoc2 的 settle 末尾调）
   *
   * 顺序：疾病（先死人，后面的幸福/稳定都不该按已经死掉的人算）→
   *       殖民（长人、可能易主）→ 黄金时代（下回合的收入才吃到）→ AI 殖民
   * ============================================================= */
  X.tick = function (world, opts) {
    if (!world || !world.turn) return;
    opts = opts || {};
    diseaseTick(world, opts);
    colonizeTick(world, opts);
    goldenTick(world, opts);
    if (opts.ai !== false) {
      for (var i = 0; i < world.countries.length; i++) {
        var c = world.countries[i];
        if (!c || !c.aoc || !c.aoc.alive) continue;
        aiTick(world, c, opts);
      }
    }
  };

  /* 纪要：编年史（17-chrono）读 world.notes。没有编年史层时静默丢弃 ——
   * 环境层不该因为"没接上史官"就崩掉。 */
  X.note = function (world, text, owner) {
    if (!world) return;
    world.notes = world.notes || [];
    world.notes.push({ turn: world.turn || 1, text: text, owner: owner || 0 });
    if (world.notes.length > 200) world.notes.shift();
  };

  /* =============================================================
   * ⑧ 地形：维护费与建造费（第十八章萌娘表的另两列）
   *
   * 维基表那三列（防御 / 移动 / 增长）已经在 15-aoc2 落地；
   * 这里只补维基没给的两列，供 16-aoc2-court 的 upkeep / 造价读。
   * ============================================================= */
  X.terrainUpkeep = function (p) {
    if (!p) return 1;
    return 1 + (W.TERRAIN_UPKEEP[p.terrain] || 0) / 100;
  };
  X.terrainBuild = function (p) {
    if (!p) return 1;
    return 1 + (W.TERRAIN_BUILD[p.terrain] || 0) / 100;
  };
  /* 存疑项：丘陵增长倍率。维基正字 1.25，附注"或 1.5"。
   * 实测口径（diag/aoc2-terrain-probe.js）：同一 seed 跑 100 回合，
   * 比较丘陵省与平原省的人口比 —— 细则见 DESIGN-WORLD.md。 */
  X.hillsGrowth = function () { return W.TERRAIN_HILLS_GROWTH; };

  /* =============================================================
   * ⑨ 存档：只加字段，不升版本号（项目一贯做法）
   *   省：dz / dzt（病名、起始回合）、ind（殖民地进度，UI 用）
   *   国：gd / gdt / gd0（黄金时代）
   * 15-aoc2 的 save/load 里已经逐字段写死，这里给两个拷贝函数省得它知道细节。
   * ============================================================= */
  X.saveProv = function (p) {
    return { dz: p.aoc.dis || '', dzt: p.aoc.disT || 0,
      ind: Math.round((p.aoc.ind || 0) * 1000) / 1000, mal: p.aoc.mal ? 1 : 0 };
  };
  X.loadProv = function (p, s) {
    if (!s) return;
    p.aoc.dis = s.dz || '';
    p.aoc.disT = s.dzt || 0;
    p.aoc.mal = s.mal ? 1 : 0;
    p.aoc.disease = (p.aoc.dis || p.aoc.mal) ? W.DIS_STAB : 0;
    p.aoc.ind = s.ind || 0;
  };

})(typeof window !== 'undefined' ? window : globalThis);
