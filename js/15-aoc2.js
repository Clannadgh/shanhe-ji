/* =============================================================
 * 15-aoc2.js —— 《文明时代2》规则的核心层（数据模型 + 回合结算 + 敕令）
 *
 * 口径 = 仓库根 `规则书-文明时代2.md`。本文件只做三件事：
 *   ① 定义区：规则书给的数值照抄；没给的集中放这里当占位（每个都标 `占位`）
 *   ② 数据模型：省 = 人口(按国籍) / 经济 / 发展度 / 稳定 / 幸福 / 革命风险 /
 *      核心表 / 省份价值；国 = 国库 / 贷款 / 五条滑条 / 政体 / 移动点 / 外交点
 *   ③ 回合结算：照规则书第三、八章的顺序走一遍（见 settle 里的 ①~⑦）
 *
 * 为什么单独开一个文件而不是塞回 15-resources：
 * 旧制（七种资源 / 官员 / 工艺链）已经整体退役，新规则的唯一真相必须只有一个。
 * 15-resources 里剩下的只有战争/外交/编年史那几块（阶段二~五会陆续接手），
 * 经济这一半从此归本文件。
 *
 * 纯逻辑、不碰 DOM —— test/load.js 能直接 eval 它，node 里跑结算不用浏览器。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* =============================================================
   * ① 定义区（改数字只来这里）
   * ============================================================= */

  /* 政体九种（规则书第七章整表照抄）。
   * 列名 = 对全国系数的修正；百分比项是"百分点"，乘数项是"倍率"。
   * 本阶段全体默认君主制，但表先落地 —— 阶段三换政体时不用再回来补。 */
  var GOV = {
    monarchy: { key: 'monarchy', cn: '君主制', taxCap: 25, goods: 15, invest: 10,
      taxRev: 1, prodRev: 1, admin: 2, research: 0, move: 0.8, recruit: 1.8, upkeep: 0, defense: 4 },
    democracy: { key: 'democracy', cn: '民主制', taxCap: 24, goods: 10, invest: 14,
      taxRev: 4, prodRev: -2, admin: 4, research: 2, move: 0.8, recruit: 1.8, upkeep: 4, defense: 6 },
    communism: { key: 'communism', cn: '共产主义', taxCap: 28, goods: 16, invest: 10,
      taxRev: -2, prodRev: 0, admin: 8, research: 4, move: 0.8, recruit: 1.6, upkeep: -3, defense: 3 },
    fascism: { key: 'fascism', cn: '法西斯', taxCap: 28, goods: 14, invest: 12,
      taxRev: 1, prodRev: 4, admin: 0, research: 0, move: 0.8, recruit: 1.8, upkeep: -2, defense: 5 },
    republic: { key: 'republic', cn: '共和制', taxCap: 25, goods: 15, invest: 10,
      taxRev: -2, prodRev: 0, admin: -2, research: 2, move: 0.8, recruit: 1.8, upkeep: 0, defense: 4 },
    nomad: { key: 'nomad', cn: '游牧', taxCap: 22, goods: 14, invest: 8,
      taxRev: 8, prodRev: -4, admin: 4, research: 35, move: 0.6, recruit: 2.0, upkeep: 4, defense: 0 },
    citystate: { key: 'citystate', cn: '城邦', taxCap: 26, goods: 10, invest: 12,
      taxRev: 2, prodRev: 2, admin: 20, research: 2, move: 1.0, recruit: 1.8, upkeep: -6, defense: 12 },
    tribe: { key: 'tribe', cn: '部族', taxCap: 30, goods: 10, invest: 6,
      taxRev: 10, prodRev: 0, admin: 17, research: 40, move: 1.5, recruit: 1.6, upkeep: 60, defense: 10 },
    rebel: { key: 'rebel', cn: '叛军', taxCap: 24, goods: 8, invest: 14,
      taxRev: 15, prodRev: -5, admin: 4, research: 700, move: 0.6, recruit: 1.6, upkeep: -85, defense: 2 }
  };

  var AOC2 = {
    /* ---- 规则书明确给出的 ---- */
    DEV_MIN: 0.01,          // 第四章：发展度 0.01 ~ 2.0
    DEV_MAX: 2.0,
    DEV_NAT_CAP: 1.0,       // 第四章：自然增长到 1.0 封顶，再往上只能投资
    STAB_MIN: 1, STAB_MAX: 100,
    HAPPY_MIN: 0, HAPPY_MAX: 100,
    RECRUIT_PER_POP: [0.10, 0.20],  // 第二章：一省可招兵 1/10 ~ 1/5（阶段二用）
    OCCUPY_INCOME: 10,              // 第一章：占领省每回合 ~10 金〔社区〕
    TRADE_PROV_MUL: 40000,          // 第十七章：购省价 = 40000 × 省份价值
    PEACE_TRUCE: 30,                // 第十二章：和约后停战 30 回合
    WAR_BAN_TURNS: 5,               // 第十二章：开局 5 回合禁宣战
    ASSIMILATE_POP_GOLD: 0.02,      // 第八章：节日每人 0.02 金
    FESTIVAL_POP: 20000,            // 第八章：节日每 2 万人口 +0.1 幸福
    FESTIVAL_HAPPY: 0.1,
    /* ---- 军队与战争（第十一、十二章）---- */
    RECRUIT_GOLD: 5,         // 占位：基础约 5 金/兵〔社区〕
    RECRUIT_POP: 1,          // 占位：1 兵扣 1 人口（规则书只说"同时扣人口"）
    RECRUIT_CAP_STABLE: 0.20,// 第二章：单省上限 1/10 ~ 1/5，稳定省取高值
    RECRUIT_CAP_UNSTABLE: 0.10,
    RECRUIT_STAB_LINE: 70,   // 占位：稳定 ≥70 算"稳定省"
    INSTANT_MUL: 2,          // 第十一章：征兵敕令即时到位 = 正常价 ×2
    RECRUIT_BATCH: 1000,     // UI 一次招多少（不是规则，是手感）
    MOVE_BASE: 1,            // 占位：每跳基础移动点
    OCCUPY_MIN_TROOPS: 10,   // 第十一章：空省最少 10 兵即可占领
    OCCUPY_DAMAGE_MUL: 2,    // 占位：大军损毁 = 兵/人口 × 2，上限 25%
    OCCUPY_DAMAGE_MAX: 0.25,
    OCCUPY_HAPPY_HIT: 10,    // 占位：被占领当回合幸福 −10
    COMBAT_LOSS: 0.7,        // 占位：败方被歼时，胜方按对方战力 × 0.7 折损
    COMBAT_LUCK: 0.12,       // 占位：±12% 的确定性抖动（不用 Math.random）
    PLUNDER_GOLD: 0.5,       // 占位：每兵抢 0.5 金（规则书只说"军越多抢越多"）
    PLUNDER_RATE: 2,         // 占位：人口/经济损失 = 兵/人口 × 2，上限 20%
    PLUNDER_HAPPY: 12,       // 占位：掠夺一次幸福 −12
    WAR_DIP_COST: 10,        // 占位：宣战耗外交点
    WEAR_RISE: 0.025,        // 占位：战时每回合 +2.5% 厌战（约 30 回合打疲）
    WEAR_FALL: 0.05,         // 占位：和平每回合 −5%
    WEAR_UPKEEP: 1.0,        // 占位：厌战 100% 时军费 ×2（规则书"极端时每兵 >1 金"）
    WEAR_HAPPY: 12,          // 占位：厌战 100% 时幸福 −12
    /* ---- 人心（第七、八、九、十章）---- */
    ASSIM_GOLD: 0.01,        // 占位：同化每人 0.01 金 × (1 + 异族占比 × 2)
    ASSIM_RATE: 0.08,        // 占位：一次同化掉"剩下的异族"的 8%（渐进）
    REVOLT_TRIGGER: 80,      // 占位：革命风险 ≥80 才可能举旗
    REVOLT_CHANCE: 0.10,     // 占位：达标后每回合 10% 爆发
    REVOLT_HAPPY_LINE: 45,   // 占位：幸福低于 45 开始算账
    REVOLT_HAPPY_K: 1.2,
    REVOLT_STAB_LINE: 55,    // 占位：稳定低于 55 开始算账
    REVOLT_STAB_K: 1.0,
    REVOLT_FOREIGN: 35,      // 占位：异族占比 100% 加 35 点
    REVOLT_WEAR: 15,         // 占位：厌战 100% 加 15 点
    REVOLT_OCCUPIED: 15,     // 占位：被占领加 15 点
    REVOLT_GARRISON_K: 1,    // 占位：每千兵压 1 点
    REVOLT_GARRISON_MAX: 12,
    REBEL_ARMY: 0.03,        // 占位：叛军起兵 = 省人口 × 3%
    /* 叛军国上限：规则书没给，但不封顶会滚成"100 回合 15 个叛军国、
     * 1000 多对交战"（实测），厌战把全世界拖垮。到顶之后高风险省只是
     * 继续掉稳定度，不再起兵。 */
    REBEL_MAX: 6,
    CIVIL_HAPPY: 25,         // 占位：全国幸福低于 25 记为"低位"
    CIVIL_TURNS: 20,         // 第九章：连续约 20 回合低位才可能内战
    GOV_SWITCH_BASE: 5000,   // 占位：换政体「数千级」
    GOV_SWITCH_PER_PROV: 500,
    STAB_REVOLT: 0.15,       // 占位：革命风险对稳定的反向拉扯
    AI_AGGRO: 0.75,          // 第二十章：AI 侵略度默认 75%
    AI_WAR_CHANCE: 3,        // 占位：每回合宣战判定（百分比 × 侵略度）
    AI_ARMY_RATIO: 0.01,     // 占位：AI 目标兵力 = 人口 × 1%
    /* 地形防御加成（规则书第十八章维基表，单位 %） */
    TERRAIN_DEF: {
      plains: 0, grassland: 0, forest: 20, hills: 15, mountains: 50,
      desert: 0, tundra: 10, swamp: 0, coast: 0, islands: 0
    },
    /* 地形移动花费（维基表倍率；islands 不在表里，占位 1.5） */
    TERRAIN_MOVE: {
      plains: 1, grassland: 1, forest: 1.5, hills: 2, mountains: 3,
      desert: 1, tundra: 2, swamp: 1, coast: 1, islands: 1.5
    },

    /* 地形增长倍率（规则书第十八章维基表；islands 不在表里，占位） */
    TERRAIN_GROWTH: {
      plains: 1.5, grassland: 1.0, forest: 1.5, hills: 1.25, mountains: 0.5,
      desert: 0.75, tundra: 0.5, swamp: 0.75, coast: 2.0, islands: 0.75
    },

    /* ---- 占位：规则书未给出（附录 A 缺口表） ---- */
    ECON_RATIO: 0.80,        // 占位：开局经济值 = 人口 × 0.8（规则书只给"经济≤人口"）
    ECON_GOLD: 0.2,          // 占位：1 点经济 × 100% 税率 = 0.2 金/回合
    PROD_GOLD: 0.02,         // 占位：生产收入系数（规则书只说"受 goods 影响"）
    DEV_TAX_BONUS: 0.5,      // 占位：发展度对税收的加成斜率
    /* 行政费：规则书只说"随省份数 / 发展度"，没给公式。
     * 为什么大头按收入比例而不是按省数：纯按省数收，穷省第一回合就付不出、
     * 只能靠借债续命（实测 20 省穷国每回合 −44 金，30 回合债务翻倍）。
     * 按毛收入抽 18% 再补一点固定额，富省多付、穷省也活得下去。 */
    ADMIN_RATE: 0.20,        // 占位：行政费 = 毛收入 × 20% + 省数 × 50 + 发展度合计 × 200
    ADMIN_PER_PROV: 50,
    ADMIN_PER_DEV: 200,      // 占位：发展度合计的附加行政费
    UPKEEP_PER_SOLDIER: 0.5, // 占位：社区通说 0.5 金/兵/回合〔待核实〕
    LOAN_RATE: 0.05,         // 占位：贷款每回合利息 5%
    LOAN_LIMIT_INCOME: 3,    // 占位：贷款额度 = 每回合收入 × 3
    MP_BASE: 10,             // 占位：移动点池上限（科技/将领加成未给出）
    DIP_BASE: 3,             // 占位：外交点每回合收入
    DIP_MAX: 20,             // 占位：外交点存量上限
    MP_COST: { festival: 2, econ: 1, dev: 2, recruit: 2, plunder: 1, assimilate: 2 },
    /* AI 的余钱出口（占位）：本阶段没有军队与建筑，钱只有"投资"一个去处。
     * 不设出口的话，大国的国库会以毛收入的百分比线性膨胀（实测 T100 最大 840 万），
     * 探针里那条"国库不发散"就成了空话。留两回合毛收入当周转，超出的每回合投一半。 */
    AI_KEEP_GROSS: 2,
    AI_INVEST_SHARE: 0.5,
    INVEST_ECON_GAIN: 0.02,  // 占位：投资经济一次抬人口 2% 的经济值
    INVEST_ECON_COST: 2.0,   // 占位：每点经济 2 金 × (1 + 经济/人口 × 3)
    INVEST_ECON_SLOPE: 3,
    DEV_INVEST_STEP: 0.02,   // 占位：投资发展一次 +0.02
    DEV_INVEST_BASE: 400,    // 占位：基础花费 × (1+发展度)^2 × (0.2 + 人口/10 万)
    POP_GROWTH: 0.003,       // 占位：人口自然增长率基数（× 地形 × 政体 × 幸福）
    ECON_GROWTH: 0.005,      // 占位：经济自然增长率基数
    DEV_GROWTH: 0.012,       // 占位：发展度向 1.0 靠拢的速率
    POP_JOB_DAMP: 0.3,       // 占位：人口超过经济（岗位）时的增长阻尼
    HAPPY_BASE: 55,          // 占位：幸福基准
    GOODS_NEED: 0.70,        // 占位：物资需求线（滑条 70% = 刚好满足）
    GOODS_HAPPY: 30,         // 占位：物资满意度对幸福的斜率
    TAX_HAPPY: 0.6,          // 占位：每 1% 税率扣多少幸福
    HAPPY_STEP: 0.35,        // 占位：幸福向目标靠拢的比例
    STAB_BASE: 30,           // 占位：稳定基准
    STAB_NAT: 40,            // 占位：本国人口占比的权重
    STAB_HAPPY: 0.4,         // 占位：幸福对稳定的权重
    STAB_STEP: 0.25,         // 占位：稳定向目标靠拢的比例
    START_TREASURY: 20000,   // 占位：开局国库
    START_TREASURY_PER_PROV: 3000,
    START_TAX_RATE: 12,      // 占位：开局税率
    DEFAULT_SLIDERS: { tax: 20, goods: 70, research: 5, invest: 5 }
  };
  AOC2.GOV = GOV;
  /* 存档版本：换血即升版。v6 及以下全是旧规则的档，直接拒读 ——
   * 旧档里的 SIM / CENTRAL / OFFICIAL 在新模型里没有对应物，
   * "尽量迁移"只会把玩家送进一个半新半旧、两套账都算不清的世界。 */
  AOC2.SAVE_VER = 7;
  AO.SAVE_VER = 7;            // 旧代码 / 测试读的是 AO.SAVE_VER，留个别名
  /* 存档键：原来定义在 15-resources，换血后搬到这里（测试直接读 AO.SAVE_KEY） */
  AO.SAVE_KEY = 'sj.save';
  AO.SAVE_KEY_V1 = 'sj.save.v1';
  AO.AOC2 = AOC2;

  /* 读档前的版本闸门：UI 与测试共用同一句话，不许两处各写一份 */
  AO.aoc2 = AO.aoc2 || {};
  AO.aoc2.checkSaveVersion = function (v) {
    if (!(v >= 1)) return { ok: false, msg: '这不是山河纪的存档' };
    if (v < AOC2.SAVE_VER) {
      return { ok: false, legacy: true,
        msg: '旧规则档案（v' + v + '）：想玩旧版请 checkout legacy-v19' };
    }
    if (v > AOC2.SAVE_VER) {
      return { ok: false, msg: '存档版本比本版新（v' + v + '，本版 v' + AOC2.SAVE_VER + '）' };
    }
    return { ok: true };
  };

  var G = AOC2.GOV;

  /* =============================================================
   * ② 小工具
   * ============================================================= */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function govOf(c) { return G[(c.aoc && c.aoc.gov) || 'monarchy'] || G.monarchy; }
  /* 百分比项（+4 = ×1.04） */
  function pct(base, p) { return base * (1 + (p || 0) / 100); }

  function totalPop(p) {
    var t = 0, k;
    for (k in p.aoc.pop) t += p.aoc.pop[k] || 0;
    return t;
  }
  function ownPop(p, cid) { return (p.aoc.pop[cid] || 0); }

  /* =============================================================
   * ③ 初始化：给每个省 / 每个国挂上 AoC2 字段
   *
   * 为什么人口要存成"国籍构成的表"而不是一个数：
   * 规则书第二章 —— 本国人口占比 = 同化程度，直接决定稳定度与革命风险。
   * 本阶段先全部本国人口（表里只有一个键），阶段三的同化敕令只搬数字，
   * 不用再改数据形状。
   * ============================================================= */
  AO.aoc2 = AO.aoc2 || {};

  AO.aoc2.initWorld = function (world) {
    var i, c, p, cid;
    world.turn = world.turn || 1;

    /* --- 省 --- */
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p) continue;
      cid = p.owner | 0;
      var pop = Math.max(100, Math.round(p.population || 100));
      var econ = Math.max(1, Math.round(pop * AOC2.ECON_RATIO));

      /* 发展度：开局按人口规模给一个温和的梯度（大城高、边地低），
       * 首都额外 +0.12 —— 规则书只给了范围 0.01~2.0 与"君士坦丁堡 0.58"这个锚点。 */
      var dev = clamp(0.25 + 0.35 * Math.sqrt(Math.min(1, pop / 400000)), AOC2.DEV_MIN, 0.9);
      var cc = world.countries[cid - 1];
      if (cc && cc.capital === p.id) dev = clamp(dev + 0.12, AOC2.DEV_MIN, 0.95);

      p.aoc = {
        pop: (function () { var o = {}; o[cid] = pop; return o; })(),
        econ: econ,
        dev: Math.round(dev * 1000) / 1000,
        growth: 0,                 // 上回合实际人口增长率（省卡显示用）
        stab: 55,
        happy: 55,
        revolt: 0,                 // 革命风险（阶段三接驱动）
        core: (function () { var o = {}; o[cid] = 1; return o; })(),
        value: 0,
        income: 0,                 // 上回合本省总收入（省卡显示）
        occupied: 0,               // 占领方 cid（0 = 未被占领）
        army: 0,                   // 驻军人数（规则书第十一章：军队 = 省上一个数字）
        armyOf: 0,                 // 这支兵属于谁（占领军的归属方；空省为 0）
        disease: 0,                // 疾病压低稳定的量（阶段五）
        dis: '',                   // 正在患的病（阶段五；空串 = 没病）
        disT: 0,                   // 感染回合（UI 显示病程）
        mal: 0,                    // 营养不良（人口 < 1 万的省；与传染病并存）
        ind: 0,                    // 中立省的殖民进度 0~1（阶段五，UI 用）
        fest: 0,                   // 节日带来的临时幸福（每回合衰减）
        /* 建筑（阶段四，规则书第五章）：bld = 已完工等级，queue = 在建。
         * 在建的不计入"同种建筑数量"—— 所以一口气排队批量建更便宜，
         * 这是规则书明说的特性。 */
        bld: {},
        queue: []
      };
      p.aoc.value = AO.aoc2.provValue(p);
      /* 旧字段跟着新表走：别的模块（渲染 / 导出 / 编年史）还在读 p.population */
      p.population = pop;
    }

    /* --- 国 --- */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c) continue;
      /* 开局的税率 / 滑条按国离散一下（同一个种子永远同一套）：
       * 全用同一个默认值，64 个国家的幸福会整齐地贴在同一个数上，
       * 探针报出来的"分布"等于一个点，看不出任何东西。 */
      var hh = ((world.meta && world.meta.seedInt ? world.meta.seedInt : 0) ^ (c.id * 2654435761)) >>> 0;
      var r1 = (hh % 1000) / 1000, r2 = ((hh >>> 10) % 1000) / 1000;
      var taxShare = 26 + Math.round(r1 * 8);             // 26~34%
      var goodsShare = 90 - taxShare;                     // 物资 58~66%（税收+物资=90）
      c.aoc = {
        treasury: AOC2.START_TREASURY + (c.provinces ? c.provinces.length : 0) * AOC2.START_TREASURY_PER_PROV,
        loans: 0,
        taxRate: 8 + Math.round(r2 * 8),                  // 8~16%
        sliders: { tax: taxShare, goods: goodsShare, research: 5, invest: 5 },
        gov: 'monarchy',           // 本阶段全体默认君主制
        mp: AOC2.MP_BASE, mpMax: AOC2.MP_BASE,
        dip: AOC2.DIP_BASE, dipMax: AOC2.DIP_MAX,
        rel: {},                   // 关系值（-100 = 战争；阶段四扩成 21 种外交动作）
        pacts: {},                 // 条约：cid -> { nap, defpact, guarantee, access, ally }
        vassalOf: 0,               // 宗主 cid（0 = 不是附庸）
        vassals: {},               // 附庸集合 cid -> 1
        indep: 0,                  // 独立欲望 0~1（第十四章）
        cool: {},                  // 侮辱冷却：cid -> 到期回合（期间不能改善关系）
        guarBy: {},                // 谁保障了我的独立（反向索引）
        prepare: null,             // 备战：{ target, turns }
        supported: null,           // 被支持叛军：{ by, until }
        great: false,              // 大国（人口前 10）
        truce: {},                 // 停战期：cid -> 到哪一回合为止不许宣战
        warStart: {},              // 这一场仗从哪回合开始（算厌战/战报用）
        wear: 0,                   // 厌战 0~1（军费膨胀 + 幸福降）
        rq: [],                    // 征兵队列：[{pid, n}]，下一回合到位
        rp: 0,                     // 研究进度（每 100 = 1 科技点）
        tech: 0.01,                // 科技等级 0.01~50.0（阶段四）
        investPool: 0,             // 投资款（建筑用；投资敕令也用它）
        last: null,                // 上回合收支明细
        /* 汇总值（每回合结算后写，UI 直接读，避免面板自己再算一遍算错） */
        happy: 55, stab: 55, pop: 0, econ: 0, dev: 0,
        alive: true
      };
      AO.aoc2.recomputeCountry(world, c);
    }

    /* 岸线画像（coastDirs）：港口的前置、省卡"岸线"那一行的数据源。
     * 这一段原来由已退役的模块计算，换血时被删掉了 —— 在这里补回来。 */
    if (AO.aoc2.court && AO.aoc2.court.profileCoast) AO.aoc2.court.profileCoast(world);
    /* 中立省（阶段五）：殖民的前提。放在最后 —— 它要读"每国几省 / 谁是首都"
     * 这两件已经算完的事，割完还要把原主的汇总值重算一遍。 */
    if (AO.aoc2.world) AO.aoc2.world.initNeutral(world);
    return world;
  };

  /* 省份价值：贸易定价用（阶段四）。规则书只给了"40000 × 省份价值"，
   * 价值本身没给公式 —— 这里用 人口/1000 × (0.4 + 发展度)，占位。 */
  AO.aoc2.provValue = function (p) {
    var pop = p.aoc ? totalPop(p) : (p.population || 0);
    var dev = p.aoc ? p.aoc.dev : 0.3;
    return Math.max(1, Math.round(pop / 1000 * (0.4 + dev) * 10) / 10);
  };

  /* 国级派生量：人口 / 经济 / 发展度 / 幸福 / 稳定（按人口加权） */
  AO.aoc2.recomputeCountry = function (world, c) {
    var i, p, pop = 0, econ = 0, dev = 0, hSum = 0, sSum = 0, n = 0;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || !p.aoc) continue;
      var tp = totalPop(p);
      pop += tp; econ += p.aoc.econ; dev += p.aoc.dev;
      hSum += p.aoc.happy * tp; sSum += p.aoc.stab * tp; n += tp;
    }
    c.aoc.pop = pop;
    c.aoc.econ = econ;
    c.aoc.dev = c.provinces.length ? dev / c.provinces.length : 0;
    c.aoc.happy = n ? hSum / n : 50;
    c.aoc.stab = n ? sSum / n : 50;
    c.population = pop;                  // 旧字段同步（导出 / 编年史还在读）
    return c;
  };

  /* =============================================================
   * ④ 回合结算
   *
   * 顺序照规则书第三、八章（任务书阶段一第 3 条）：
   *   ① 省收入（经济 × 税率 + 生产）→ ② 国库汇总
   *   → ③ 行政费 + 军费（本阶段无兵 = 0，路径留好）+ 贷款利息
   *   → ④ 物资满意度 → ⑤ 幸福度 → ⑥ 稳定度 → ⑦ 人口/经济/发展度增长
   *
   * 为什么结算顺序不能换：幸福要看这一回合的物资，稳定要看这一回合的幸福，
   * 增长又要看这一回合的幸福与稳定 —— 反过来算，玩家看到的因果就晚一回合。
   * ============================================================= */
  AO.aoc2.settle = function (world, opts) {
    opts = opts || {};
    var ci, pi, c, p, g, A, i;
    world.turn = (world.turn || 1) + 1;

    /* 军队与占领按"归属方"统计，而不是按"省属于谁" ——
     * 占领军驻在别人的省里，军费得算在占领者头上（规则书第十一章按兵员计）。
     * 所以先把整张图扫一遍，得到 每国兵力 / 每国占领了几个省。 */
    var armyBy = Object.create(null), occBy = Object.create(null);
    for (pi = 0; pi < world.provinces.length; pi++) {
      p = world.provinces[pi];
      if (!p || !p.aoc) continue;
      if (p.aoc.army > 0) {
        var ao = p.aoc.armyOf || p.owner;
        armyBy[ao] = (armyBy[ao] || 0) + p.aoc.army;
      }
      if (p.aoc.occupied) occBy[p.aoc.occupied] = (occBy[p.aoc.occupied] || 0) + 1;
    }

    for (ci = 0; ci < world.countries.length; ci++) {
      c = world.countries[ci];
      if (!c || !c.aoc) continue;
      A = c.aoc;
      if (!A.alive) { continue; }
      g = govOf(c);
      var sl = A.sliders;

      /* AI 缺钱就加税：一个税率 8%、行政费占毛收入 20% 的国家，不改税率只会
       * 一路借债到利息吞掉全部收入（实测 100 回合滚到 27 万债、净额 −1.4 万）。
       * 每回合 +1%，到政体上限为止；加税的代价（幸福降）照规则书第八条走。 */
      if (opts.player !== c.id) {
        var lowCash = A.treasury < (A.last ? A.last.gross : 0) * 0.6;
        if (lowCash && A.taxRate < g.taxCap) A.taxRate = Math.min(g.taxCap, A.taxRate + 1);
      }

      /* 移动点与外交点每回合刷新（规则书第十一章：全国共享一条每回合刷新的池）。
       * 上限吃科技（第六章"每回合更多移动点数"）—— 每回合重算，
       * 这样科技升完不用等读档就能看到池子变大。 */
      if (AO.aoc2.court) A.mpMax = AO.aoc2.court.mpMaxOf(c);
      A.mp = A.mpMax;
      A.dip = Math.min(A.dipMax, A.dip + AOC2.DIP_BASE +
        (AO.aoc2.dip ? AO.aoc2.dip.greatDipOf(c) : 0));

      var gross = 0, devSum = 0, provN = 0;
      var soldiers = armyBy[c.id] || 0;
      var occupiedN = occBy[c.id] || 0;

      /* ① 省收入 ---------------------------------------------------- */
      for (pi = 0; pi < c.provinces.length; pi++) {
        p = world.provinces[c.provinces[pi] - 1];
        if (!p || !p.aoc) continue;
        provN++;
        devSum += p.aoc.dev;

        var taxIncome = p.aoc.econ * (A.taxRate / 100) * AOC2.ECON_GOLD *
          (1 + p.aoc.dev * AOC2.DEV_TAX_BONUS) * (1 + g.taxRev / 100);
        /* 生产收入：受物资（goods）滑条影响 —— 物资足，工坊才开得动 */
        var prodIncome = p.aoc.econ * AOC2.PROD_GOLD * (0.5 + sl.goods / 100) *
          (1 + g.prodRev / 100);
        if (AO.aoc2.court) prodIncome *= AO.aoc2.court.goodsMul(c);
        var inc = taxIncome + prodIncome;
        /* 建筑与科技：工坊 +5%/级、港口 +3%、科技每级 +1%（规则书第五、六章） */
        if (AO.aoc2.court) inc *= AO.aoc2.court.incomeMul(c, p);
        /* 黄金时代（第十九章）：繁荣型全境收入 +15% */
        if (AO.aoc2.world) inc *= AO.aoc2.world.incomeMul(c);
        /* 占领省：原主收入归零，占领者拿固定 ~10 金（阶段二才可能有占领） */
        if (p.aoc.occupied && p.aoc.occupied !== c.id) inc = 0;
        p.aoc.income = inc;
        gross += inc;
      }

      /* 占领省的直接收入：约 10 金/省/回合〔社区〕（第一章） */
      gross += occupiedN * AOC2.OCCUPY_INCOME;
      /* 大国加成（第十四章：人口前 10 的国家自动获得该身份与加成） */
      if (AO.aoc2.dip) gross *= AO.aoc2.dip.taxMulOf(c);

      /* ② 国库汇总：四条预算滑条把总收入切开 -------------------------
       * 税收 → 国库；物资 → 当回合消耗掉（换满意度）；科研 → 研究点；
       * 投资 → 投资款。剩下没分配的部分自动进国库（不浪费）。 */
      var taxShare = gross * (sl.tax / 100);
      var goodsMoney = gross * (sl.goods / 100);
      var researchMoney = gross * (sl.research / 100);
      var investMoney = gross * (sl.invest / 100);
      var unalloc = gross - taxShare - goodsMoney - researchMoney - investMoney;

      /* ③ 行政费 + 军费 + 贷款利息 ---------------------------------- */
      var admin = (gross * AOC2.ADMIN_RATE + provN * AOC2.ADMIN_PER_PROV +
        devSum * AOC2.ADMIN_PER_DEV) * (1 + g.admin / 100);
      /* 军费：占领军驻在别人家里，军费得算在占领者头上（第十一章按兵员计）。
       * 有庙堂层就逐省算 —— 补给营地只降本地驻军那 20%。 */
      var upkeep = AO.aoc2.court
        ? AO.aoc2.court.upkeepOf(world, c, g, A)
        : soldiers * AOC2.UPKEEP_PER_SOLDIER * (1 + g.upkeep / 100) *
          (1 + (A.wear || 0) * AOC2.WEAR_UPKEEP);
      var interest = A.loans * AOC2.LOAN_RATE;
      var net = taxShare + unalloc - admin - upkeep - interest;

      A.treasury += net;
      /* 研究点（第六章）：科研滑条那一份买进度，图书馆/大学每回合白给一点。
       * 每攒满 100 进度 = 1 科技点。科技型黄金时代（第十九章）×1.5。 */
      if (AO.aoc2.world) researchMoney *= AO.aoc2.world.researchMul(c);
      if (AO.aoc2.court) AO.aoc2.court.gainRp(world, c, researchMoney);
      else A.rp += researchMoney * 0.1;
      A.investPool += investMoney;
      /* 国库见底 → 自动借债（规则书第三章允许主动贷款；这里先做"被动兜底"，
       * 否则一个开局小国会在第 3 回合就发不出行政费，AI 直接死给你看）。
       * 额度按每回合收入的比例核定（LOAN_LIMIT_INCOME），到顶就不再借：
       * 借不到钱的国家这一回合就是"欠饷"，国库停在 0 —— 比让它无限滚利息好，
       * 也比让国库变成负数（探针里那条"国库不爆负"）好。 */
      if (A.treasury < 0) {
        var borrowCap = Math.max(0, gross * AOC2.LOAN_LIMIT_INCOME - A.loans);
        var need = -A.treasury;
        var take2 = Math.min(need, borrowCap);
        A.loans += take2;
        A.treasury = Math.min(0, A.treasury + take2);
        if (A.treasury < 0) { A.unpaid = (A.unpaid || 0) + (-A.treasury); A.treasury = 0; }
      }

      A.last = {
        gross: gross, taxIn: taxShare + unalloc, admin: admin, upkeep: upkeep,
        occIncome: occupiedN * AOC2.OCCUPY_INCOME, occN: occupiedN,
        interest: interest, net: net, goodsMoney: goodsMoney,
        researchMoney: researchMoney, investMoney: investMoney, provN: provN
      };

      /* ④ 物资满意度：滑条给的钱够不够养人（1.0 = 刚好够） */
      var goodsSat = clamp((sl.goods / 100) / AOC2.GOODS_NEED, 0, 1.3);

      /* ⑤⑥⑦ 逐省走：幸福 → 稳定 → 增长 ---------------------------- */
      var hSum = 0, sSum = 0, popSum = 0;
      for (pi = 0; pi < c.provinces.length; pi++) {
        p = world.provinces[c.provinces[pi] - 1];
        if (!p || !p.aoc) continue;

        /* ⑤ 幸福度：税率 + 物资 + 节日 + 厌战（阶段一厌战恒 0） */
        var hTarget = AOC2.HAPPY_BASE +
          (goodsSat - 1) * AOC2.GOODS_HAPPY -
          A.taxRate * AOC2.TAX_HAPPY +
          (p.aoc.fest || 0) -
          (A.wear || 0) * AOC2.WEAR_HAPPY +
          /* 繁荣型黄金时代（第十九章）：全境 +5 幸福 */
          (AO.aoc2.world ? AO.aoc2.world.happyAdd(c) : 0);
        p.aoc.happy = clamp(p.aoc.happy + (hTarget - p.aoc.happy) * AOC2.HAPPY_STEP,
          AOC2.HAPPY_MIN, AOC2.HAPPY_MAX);
        /* 节日是一次性的：加到幸福里之后每回合衰减 80%，几回合就散掉 */
        if (p.aoc.fest) { p.aoc.fest *= 0.8; if (p.aoc.fest < 0.05) p.aoc.fest = 0; }

        /* ⑥ 稳定度：国籍占比 / 驻军 / 疾病 / 幸福 / 占领 */
        var tp = totalPop(p);
        var natShare = tp > 0 ? ownPop(p, c.id) / tp : 1;
        var sTarget = AOC2.STAB_BASE + AOC2.STAB_NAT * natShare +
          (p.aoc.happy - 50) * AOC2.STAB_HAPPY -
          (p.aoc.disease || 0) -
          (p.aoc.occupied ? 20 : 0) -
          /* 革命风险越高，稳定越压不住（第八章因子表里的一条） */
          (p.aoc.revolt || 0) * AOC2.STAB_REVOLT +
          /* 驻军临时维稳：每 1000 兵 +2 稳定，最多 +20（规则书第八章"权宜"） */
          Math.min(20, (p.aoc.army || 0) / 1000 * 2);
        p.aoc.stab = clamp(p.aoc.stab + (sTarget - p.aoc.stab) * AOC2.STAB_STEP,
          AOC2.STAB_MIN, AOC2.STAB_MAX);

        /* 革命风险（第九章）：低幸福 / 低稳定 / 异族 / 厌战 / 被占领，驻军压一点。
         * 用本回合刚算出来的幸福与稳定 —— 顺序反过来玩家看到的因果就晚一回合。 */
        var rTarget = revoltTargetOf(p, c.id, A.wear || 0, world);
        p.aoc.revolt = clamp((p.aoc.revolt || 0) + (rTarget - (p.aoc.revolt || 0)) * 0.35, 0, 100);

        /* ⑦ 增长：人口 / 经济 / 发展度 ---------------------------------
         * 地形倍率 × 政体 × 幸福；人口超过岗位（经济）时增长被压住 —— 第二章
         * "人口超过经济的部分会外流/停止增长"。 */
        var gmul = (AOC2.TERRAIN_GROWTH[p.terrain] || 1) * (1 + 0) *
          (0.5 + p.aoc.happy / 100);
        /* 农场 +5%/级（第五章） */
        if (AO.aoc2.court) gmul *= AO.aoc2.court.growthMul(p);
        var rate = AOC2.POP_GROWTH * gmul;
        if (tp > p.aoc.econ * 1.02) rate *= AOC2.POP_JOB_DAMP;
        var dPop = tp * rate;
        if (dPop > 0) {
          /* 新增人口记在"本国国籍"名下（同化/移民是阶段三的事） */
          p.aoc.pop[c.id] = (p.aoc.pop[c.id] || 0) + dPop;
        }
        p.aoc.growth = rate;

        /* 经济自然增长，上限 = 人口（岗位逻辑，第三章） */
        var dEcon = p.aoc.econ * AOC2.ECON_GROWTH * gmul;
        p.aoc.econ = Math.min(tp, p.aoc.econ + dEcon);

        /* 发展度自然增长：只往 1.0 靠，绝不越过（第四章） */
        if (p.aoc.dev < AOC2.DEV_NAT_CAP) {
          p.aoc.dev = Math.min(AOC2.DEV_NAT_CAP,
            p.aoc.dev + (AOC2.DEV_NAT_CAP - p.aoc.dev) * AOC2.DEV_GROWTH);
        }
        p.aoc.value = AO.aoc2.provValue(p);

        /* 旧字段同步：别的模块还在读 p.population */
        var ntp = totalPop(p);
        p.population = Math.round(ntp);
        p.aoc.pop[c.id] = Math.round(p.aoc.pop[c.id] || 0);

        hSum += p.aoc.happy * ntp; sSum += p.aoc.stab * ntp; popSum += ntp;
      }

      /* AI 的余钱出口：把超过"两回合毛收入"的部分投进最落后的省（经济优先，
       * 经济满了就投发展度）。玩家国不自动花 —— 那是玩家自己的决定。 */
      if (opts.player !== c.id && A.treasury > 0 && gross > 0) {
        var keep = gross * AOC2.AI_KEEP_GROSS;
        var spend = (A.treasury - keep) * AOC2.AI_INVEST_SHARE + A.investPool;
        if (spend > 0) {
          var budget = Math.min(spend, A.treasury + A.investPool);
          var spent = 0, guard = 0;
          while (budget > 0 && guard++ < 8) {
            /* 找 econ/人口 比例最低的省（岗位最缺的地方最该投） */
            var tgt = null, tgtR = Infinity;
            for (pi = 0; pi < c.provinces.length; pi++) {
              var q = world.provinces[c.provinces[pi] - 1];
              if (!q || !q.aoc) continue;
              var qp = totalPop(q);
              var rr = q.aoc.econ / Math.max(1, qp);
              if (rr < tgtR) { tgtR = rr; tgt = q; }
            }
            if (!tgt) break;
            var tp2 = totalPop(tgt);
            var room2 = Math.max(0, tp2 - tgt.aoc.econ);
            if (room2 > 1) {
              var per = AOC2.INVEST_ECON_COST * (1 + tgt.aoc.econ / Math.max(1, tp2) * AOC2.INVEST_ECON_SLOPE);
              var afford = Math.floor(budget / per);
              if (afford < 1) break;
              var gain2 = Math.min(room2, afford);
              tgt.aoc.econ += gain2;
              budget -= gain2 * per; spent += gain2 * per;
            } else {
              var dc = decreeCostDev(tgt);
              if (dc > budget || tgt.aoc.dev >= AOC2.DEV_MAX) break;
              tgt.aoc.dev = Math.min(AOC2.DEV_MAX, tgt.aoc.dev + AOC2.DEV_INVEST_STEP);
              budget -= dc; spent += dc;
            }
          }
          if (spent > 0) {
            var fromPool = Math.min(A.investPool, spent);
            A.investPool -= fromPool;
            A.treasury -= (spent - fromPool);
          }
        }
      }

      A.happy = popSum ? hSum / popSum : 50;
      A.stab = popSum ? sSum / popSum : 50;
      A.pop = popSum;
      A.econ = 0;
      for (i = 0; i < c.provinces.length; i++) {
        var pp = world.provinces[c.provinces[i] - 1];
        if (pp && pp.aoc) A.econ += pp.aoc.econ;
      }

      /* 工地推进（第五章：在建的不计入造价递增，完工才 +1 级） */
      if (AO.aoc2.court) {
        var done = AO.aoc2.court.tick(world, c);
        if (done) A.builtLast = done;
      }
    }

    /* AI 的研究与建设：放在国家循环之后 —— 这一回合的毛收入已经算好，
     * "留三回合毛收入当周转"才有意义。 */
    if (AO.aoc2.court && opts.ai !== false) {
      for (ci = 0; ci < world.countries.length; ci++) {
        var ac = world.countries[ci];
        if (!ac || !ac.aoc || !ac.aoc.alive) continue;
        AO.aoc2.court.aiTick(world, ac, opts);
      }
    }

    /* ⑦b 外交段（第十三、十四章）：附庸税 → 独立欲望 → 备战 → 大国身份。
     * 放在国家循环之后：附庸税要读"这一回合刚算完"的入库收入。 */
    if (AO.aoc2.dip) {
      AO.aoc2.dip.settle(world, opts);
      if (opts.ai !== false) {
        for (ci = 0; ci < world.countries.length; ci++) {
          var dc = world.countries[ci];
          if (!dc || !dc.aoc || !dc.aoc.alive) continue;
          AO.aoc2.dip.aiTick(world, dc, opts);
        }
      }
    }

    /* ⑧ 战争段（第九、十一、十二章）：征兵到货 → 厌战 → AI 行动 */
    settleWar(world, opts);
    /* ⑨ 人心（第九、十章）：革命风险 → 叛军国；全国幸福低位 → 内战 */
    settleUnrest(world, opts);
    /* ⑩ 山海（第十五、十六、十九、二十章）：疫病 → 殖民 → 黄金时代 → AI 殖民。
     * 放在最后：疾病要按"这一回合的人口"结算，殖民长出来的人和黄金时代
     * 都是"下一回合才吃到"的东西 —— 排在收入前面就会让玩家看到一回合的假象。 */
    if (AO.aoc2.world) AO.aoc2.world.tick(world, opts);
    return world;
  };

  /* =============================================================
   * ⑦ 人心（规则书第七、八、九、十章）
   *
   * 这一层回答三个问题：
   *   ① 这块地是谁的（国籍构成 + 核心表）—— 打下来不等于吃得下
   *   ② 吃不下会怎样（革命风险 → 叛军国 → 内战）
   *   ③ 换个活法（政体九种 + 切换）
   *
   * 数据形状沿用阶段一留好的那两个表：
   *   p.aoc.pop  = { 国 id: 人数 }   —— 本国占比 = 同化程度
   *   p.aoc.core = { 国 id: 1 }      —— 历史主张，同化**不删**
   * ============================================================= */

  /* ---------------- 国籍 / 核心 ---------------- */
  /* 本国人口占比：0 = 全是异族，1 = 全是自己人 */
  function natShareOf(p, cid) {
    var tp = totalPop(p);
    return tp > 0 ? (p.aoc.pop[cid] || 0) / tp : 1;
  }
  AO.aoc2.natShare = natShareOf;

  /* 国籍构成（省卡显示用）：按人数降序，带国名 */
  AO.aoc2.popParts = function (world, p) {
    var out = [], k, c;
    for (k in p.aoc.pop) {
      var n = p.aoc.pop[k] || 0;
      if (n < 1) continue;
      c = world.countries[(k | 0) - 1];
      out.push({ cid: k | 0, name: c ? c.name : ('#' + k), n: n, color: c ? c.color : '#999' });
    }
    out.sort(function (a, b) { return b.n - a.n; });
    return out;
  };

  /* ---------------- 同化敕令（第十章） ---------------- */
  /* 花金 + 移动点，把异族人口**逐步**转成本国国籍；人口越多越贵越慢。
   * 旧核心不删：只转人口构成，p.aoc.core 一个字都不动。 */
  AO.aoc2.assimilate = function (world, cid, pid) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !c.aoc || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    if (p.owner !== cid) return { ok: false, msg: '不是自己的省' };
    if (p.aoc.occupied) return { ok: false, msg: '占领省不能同化（要先通过和约拿到手）' };
    var tp = totalPop(p), own = p.aoc.pop[cid] || 0, foreign = tp - own;
    if (foreign < 1) return { ok: false, msg: '这省全是本国人，不用同化' };
    var mp = AOC2.MP_COST.assimilate;
    if (c.aoc.mp < mp) return { ok: false, msg: '移动点不够（需 ' + mp + '）' };
    var share = foreign / Math.max(1, tp);
    var cost = Math.round(tp * AOC2.ASSIM_GOLD * (1 + share * 2));
    if (c.aoc.treasury < cost) return { ok: false, msg: '国库不足（需 ' + cost.toLocaleString() + ' 金）' };

    c.aoc.treasury -= cost;
    c.aoc.mp -= mp;
    /* 一次转掉"剩下的异族"的 8%（渐进：越到后面越慢，像真在消化） */
    var conv = 0;
    for (var k in p.aoc.pop) {
      if ((k | 0) === cid) continue;
      var take = (p.aoc.pop[k] || 0) * AOC2.ASSIM_RATE;
      if (take < 0.5) continue;
      p.aoc.pop[k] -= take;
      conv += take;
    }
    p.aoc.pop[cid] = own + conv;
    p.population = Math.round(totalPop(p));
    p.aoc.assimT = world.turn;
    return {
      ok: true, converted: conv, cost: cost,
      msg: '同化 ' + Math.round(conv).toLocaleString() + ' 人（本国占比 ' +
        Math.round(natShareOf(p, cid) * 100) + '%），花费 ' + cost.toLocaleString() + ' 金'
    };
  };
  AO.aoc2.assimCost = function (world, cid, pid) {
    var p = world.provinces[pid - 1];
    if (!p || !p.aoc) return 0;
    var tp = totalPop(p), own = p.aoc.pop[cid] || 0, foreign = tp - own;
    if (foreign < 1) return 0;
    return Math.round(tp * AOC2.ASSIM_GOLD * (1 + foreign / Math.max(1, tp) * 2));
  };

  /* ---------------- 政体（第七章） ---------------- */
  /* 时代：0 启蒙 / 1 工业 / 2 现代（推进时代是阶段四科技的事，这里只立门槛） */
  var GOV_ERA = {
    monarchy: 0, democracy: 0, republic: 0, citystate: 0, tribe: 0, nomad: 0,
    communism: 1, fascism: 1, rebel: 0
  };
  AO.aoc2.govEra = function (key) { return GOV_ERA[key] || 0; };
  AO.aoc2.govSwitchCost = function (c) {
    return Math.round(AOC2.GOV_SWITCH_BASE + (c.provinces.length || 0) * AOC2.GOV_SWITCH_PER_PROV);
  };
  AO.aoc2.setEra = function (c, era) { c.aoc.era = clamp(era | 0, 0, 2); return c.aoc.era; };
  AO.aoc2.setGov = function (world, cid, key) {
    var c = world.countries[cid - 1];
    if (!c || !c.aoc) return { ok: false, msg: '国家不存在' };
    if (!G[key]) return { ok: false, msg: '没有这个政体' };
    if (c.aoc.gov === key) return { ok: false, msg: '已经是' + G[key].cn };
    if (c.aoc.rebel && key !== 'rebel') return { ok: false, msg: '叛军只有一种活法' };
    if ((c.aoc.era || 0) < GOV_ERA[key]) {
      return { ok: false, msg: G[key].cn + '要' + ['启蒙', '工业', '现代'][GOV_ERA[key]] + '时代' };
    }
    var cost = AO.aoc2.govSwitchCost(c);
    if (c.aoc.treasury < cost) return { ok: false, msg: '国库不足（需 ' + cost.toLocaleString() + ' 金）' };
    c.aoc.treasury -= cost;
    c.aoc.gov = key;
    /* 新政体的税率上限可能更低：当场压下来（不然会出现"24% 上限的民主制收 28% 的税"） */
    if (c.aoc.taxRate > G[key].taxCap) c.aoc.taxRate = G[key].taxCap;
    return { ok: true, cost: cost, msg: '改行' + G[key].cn + '（' + cost.toLocaleString() + ' 金）' };
  };

  /* ---------------- 革命风险（第九章） ---------------- */
  /* 驱动：低幸福、低稳定、异族人口、厌战、被占领；驻军能压一点（权宜） */
  function revoltTargetOf(p, cid, wear, world) {
    var tp = totalPop(p), share = natShareOf(p, cid);
    var r = 0;
    r += Math.max(0, AOC2.REVOLT_HAPPY_LINE - p.aoc.happy) * AOC2.REVOLT_HAPPY_K;
    r += Math.max(0, AOC2.REVOLT_STAB_LINE - p.aoc.stab) * AOC2.REVOLT_STAB_K;
    r += (1 - share) * AOC2.REVOLT_FOREIGN;
    r += (wear || 0) * AOC2.REVOLT_WEAR;
    if (p.aoc.occupied) r += AOC2.REVOLT_OCCUPIED;
    r -= Math.min(AOC2.REVOLT_GARRISON_MAX, (p.aoc.army || 0) / 1000 * AOC2.REVOLT_GARRISON_K);
    /* 外国资助叛军（第十三章"支持叛军"）：目标国全国革命风险抬高 */
    var oc = world && world.countries ? world.countries[cid - 1] : null;
    if (oc && oc.aoc && oc.aoc.supported) r += AO.aoc2.dip ? AO.aoc2.dip.D.SUPPORT_REVOLT : 12;
    return clamp(r, 0, 100);
  }

  /* 革命风险的"目标值"（省卡 tooltip / 探针用）：给的是这一回合各项驱动的合计，
   * 不是平滑后的 p.aoc.revolt —— 平滑值要看历史，看不出"现在为什么高"。 */
  AO.aoc2.revoltTarget = function (world, pid) {
    var p = world.provinces[pid - 1];
    if (!p || !p.aoc) return 0;
    var c = world.countries[p.owner - 1];
    return revoltTargetOf(p, p.owner, c && c.aoc ? (c.aoc.wear || 0) : 0, world);
  };

  /* ---------------- 叛军国 / 内战 ---------------- */
  var REBEL_NAMES = ['义军', '叛军', '民军', '揭竿军', '复国军'];

  function makeCountry(world, name, color, gov) {
    var id = world.countries.length + 1;
    var seed = (AO.hashString('rebel:' + name + ':' + id) >>> 0);
    var c = {
      id: id,
      name: name,
      name_en: 'Rebels of ' + name,
      color: color,
      provinces: [],
      capital: 0,
      neighbors: [],
      gov: gov || 'rebel',
      govCn: (G[gov || 'rebel'] || G.rebel).cn,
      economy: '战时经济',
      house: '',
      leader: {
        name: '首领' + (id % 90 + 10), name_en: 'Leader', gender: 'm',
        title: '首领', age: 30 + (seed % 25), reign: 1
      },
      portraitHat: 'none',
      portrait: '',
      population: 0, areaKm2: 0, density: 0,
      terrainComp: [], faiths: [], faith: null, kmPerPx: 1,
      irrPct: 0, faithRoll: 0.99
    };
    if (AO.makePortrait) {
      try { c.portrait = AO.makePortrait(seed, { color: color, hat: 'none', gender: 'm' }); } catch (e) { c.portrait = ''; }
    }
    c.aoc = {
      treasury: 0, loans: 0, taxRate: 20,
      sliders: { tax: 30, goods: 60, research: 5, invest: 5 },
      gov: gov || 'rebel', era: 0,
      mp: AOC2.MP_BASE, mpMax: AOC2.MP_BASE,
      dip: AOC2.DIP_BASE, dipMax: AOC2.DIP_MAX,
      rel: {}, truce: {}, warStart: {}, wear: 0, rq: [],
      rp: 0, investPool: 0, last: null,
      happy: 50, stab: 50, pop: 0, econ: 0, dev: 0,
      alive: true, rebel: gov === 'rebel',
      lowHappy: 0
    };
    world.countries.push(c);
    return c;
  }

  /* 叛军与所有人敌对（第九章〔社区〕：叛军会和第三国也打） */
  function hostileToAll(world, c) {
    for (var i = 0; i < world.countries.length; i++) {
      var o = world.countries[i];
      if (!o || !o.aoc || o.id === c.id || !o.aoc.alive) continue;
      AO.aoc2.setRel(world, c.id, o.id, -100);
      c.aoc.warStart[o.id] = world.turn || 1;
      o.aoc.warStart[c.id] = world.turn || 1;
    }
  }

  /* 在一个省里竖起叛旗：省归叛军、带兵、和所有人开战 */
  function spawnRebel(world, parent, pid) {
    var p = world.provinces[pid - 1];
    if (!p) return null;
    var nm = (parent ? parent.name : '本地') + REBEL_NAMES[(world.turn + pid) % REBEL_NAMES.length];
    var col = parent ? parent.color : '#8a3b2f';
    var reb = makeCountry(world, nm, shadeColor(col, -18), 'rebel');
    AO.aoc2.transferProvince(world, pid, reb.id);
    p = world.provinces[pid - 1];
    /* 起兵：人口 × 3%（占位）；这些人从本地人口里出，不从天上掉 */
    var tp = totalPop(p);
    var men = Math.max(200, Math.round(tp * AOC2.REBEL_ARMY));
    men = Math.min(men, Math.max(200, Math.floor(tp * 0.2)));
    p.aoc.army = men;
    p.aoc.armyOf = reb.id;
    reb.aoc.treasury = Math.round((parent ? parent.aoc.treasury : 0) * 0.02) + 1000;
    AO.aoc2.recomputeCountry(world, reb);
    if (parent) AO.aoc2.recomputeCountry(world, parent);
    hostileToAll(world, reb);
    return reb;
  }

  /* 颜色明暗（叛军用原国色的暗调：一眼看出是"从哪来的"） */
  function shadeColor(hex, pct) {
    var h = String(hex || '#888888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return hex;
    var r = clamp(((n >> 16) & 255) + pct, 0, 255);
    var g = clamp(((n >> 8) & 255) + pct, 0, 255);
    var b = clamp((n & 255) + pct, 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* 内战（第九章）：全国幸福连续约 20 回合低位 → 国家一分为二 */
  function startCivilWar(world, c) {
    var list = [], i, p;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || p.aoc.occupied) continue;
      list.push({ pid: p.id, happy: p.aoc.happy });
    }
    if (list.length < 4) return null;
    /* 最不满的那一半（至少 2 省）举旗 */
    list.sort(function (a, b) { return a.happy - b.happy; });
    var take = Math.max(2, Math.floor(list.length / 2));
    var first = list[0].pid;
    var reb = spawnRebel(world, c, first);
    if (!reb) return null;
    for (i = 1; i < take && i < list.length; i++) {
      AO.aoc2.transferProvince(world, list[i].pid, reb.id);
      var q = world.provinces[list[i].pid - 1];
      if (q) {
        q.aoc.army = Math.max(100, Math.round(totalPop(q) * AOC2.REBEL_ARMY * 0.5));
        q.aoc.armyOf = reb.id;
      }
    }
    AO.aoc2.recomputeCountry(world, reb);
    AO.aoc2.recomputeCountry(world, c);
    c.aoc.lowHappy = 0;
    return reb;
  }

  /* 每回合末：革命风险 → 叛乱；全国幸福低位 → 内战 */
  function rebelCount(world) {
    var n = 0;
    for (var i = 0; i < world.countries.length; i++) {
      if (world.countries[i] && world.countries[i].aoc && world.countries[i].aoc.rebel) n++;
    }
    return n;
  }

  function settleUnrest(world, opts) {
    var i, p, c, ci;
    var spawned = 0;

    /* ① 逐省掷革命风险（每回合最多起一处，免得一崩全崩） */
    for (i = 0; i < world.provinces.length && spawned < 1; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || p.aoc.occupied) continue;
      if (p.aoc.revolt < AOC2.REVOLT_TRIGGER) continue;
      var owner = world.countries[p.owner - 1];
      if (!owner || !owner.aoc || !owner.aoc.alive) continue;
      if (owner.aoc.rebel) continue;            // 叛军不会再叛
      if (rebelCount(world) >= AOC2.REBEL_MAX) break;
      var roll = hashRoll(world, p.id, 'revolt') / 100;   // 0~1
      if (roll > AOC2.REVOLT_CHANCE) continue;
      spawnRebel(world, owner, p.id);
      spawned++;
    }

    /* ② 内战：全国幸福连续 20 回合低位 */
    for (ci = 0; ci < world.countries.length; ci++) {
      c = world.countries[ci];
      if (!c || !c.aoc || !c.aoc.alive || c.aoc.rebel) continue;
      if (opts.player === c.id) {
        /* 玩家国也照规则走 —— 内战不是"AI 专属惩罚" */
      }
      if ((c.aoc.happy || 0) < AOC2.CIVIL_HAPPY) c.aoc.lowHappy = (c.aoc.lowHappy || 0) + 1;
      else c.aoc.lowHappy = 0;
      if (c.aoc.lowHappy >= AOC2.CIVIL_TURNS && c.provinces.length >= 4 &&
        rebelCount(world) < AOC2.REBEL_MAX) {
        startCivilWar(world, c);
      }
    }
  }

  /* =============================================================
   * ⑥ 战争（规则书第十一、十二章）
   *
   * 这一层的口径很短：**军队就是省上的一个数字**。没有单位、没有将领编制、
   * 没有战术卡 —— 那些东西在 AoC2 里不存在，也正是旧制被整体退役的部分。
   *
   * 一条完整链路：征兵 → 移动（花移动点）→ 战斗（守方吃地形+政体加成）
   *   → 占领（阴影 / 不能募兵下敕令 / 每回合 ~10 金）→ 和谈（割地/赔款/白和平）
   *   → 停战 30 回合。
   *
   * 所有"随机"都走 AO.hashString 的确定性抖动（同种子同回合同省 = 同一场仗），
   * 这是全项目"禁 Math.random"那条约定的一部分。
   * ============================================================= */
  function govDefOf(c) { return govOf(c).defense || 0; }

  /* 一支兵属于谁：空省返回 0 */
  function armyOwnerOf(p) { return p.aoc.army > 0 ? (p.aoc.armyOf || p.owner) : 0; }

  function armyOf(world, cid) {
    var n = 0, i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc || !(p.aoc.army > 0)) continue;
      if ((p.aoc.armyOf || p.owner) === cid) n += p.aoc.army;
    }
    return n;
  }
  AO.aoc2.armyOf = armyOf;

  /* ---------------- 关系 / 战争状态 ---------------- */
  AO.aoc2.rel = function (c, cid) { return (c.aoc.rel && c.aoc.rel[cid]) || 0; };
  AO.aoc2.setRel = function (world, a, b, v) {
    var ca = world.countries[a - 1], cb = world.countries[b - 1];
    if (!ca || !cb || !ca.aoc || !cb.aoc) return 0;
    v = clamp(Math.round(v), -100, 100);
    ca.aoc.rel = ca.aoc.rel || {}; cb.aoc.rel = cb.aoc.rel || {};
    ca.aoc.rel[b] = v; cb.aoc.rel[a] = v;
    return v;
  };
  AO.aoc2.atWar = function (world, a, b) {
    var ca = world.countries[a - 1];
    if (!ca || !ca.aoc || a === b) return false;
    return AO.aoc2.rel(ca, b) <= -100;
  };
  /* 停战期还剩几回合（0 = 没有停战约束） */
  AO.aoc2.truceLeft = function (world, a, b) {
    var ca = world.countries[a - 1];
    if (!ca || !ca.aoc || !ca.aoc.truce) return 0;
    var until = ca.aoc.truce[b] || 0;
    return Math.max(0, until - (world.turn || 1));
  };
  AO.aoc2.warsOf = function (world, cid) {
    var out = [], i, c = world.countries[cid - 1];
    if (!c || !c.aoc || !c.aoc.rel) return out;
    for (var k in c.aoc.rel) {
      if (c.aoc.rel[k] <= -100) {
        var o = world.countries[(k | 0) - 1];
        if (o && o.aoc && o.aoc.alive) out.push(o.id);
      }
    }
    return out;
  };

  /* ---------------- 宣战（第十二章） ---------------- */
  AO.aoc2.declareWar = function (world, a, b, opts) {
    opts = opts || {};
    var ca = world.countries[a - 1], cb = world.countries[b - 1];
    if (!ca || !cb || !ca.aoc || !cb.aoc) return { ok: false, msg: '国家不存在' };
    if (a === b) return { ok: false, msg: '不能对自己宣战' };
    if (!ca.aoc.alive || !cb.aoc.alive) return { ok: false, msg: '对方已经不存在了' };
    if (AO.aoc2.atWar(world, a, b)) return { ok: false, msg: '已经在交战' };
    /* 开局 5 回合禁宣战（规则书第十二章） */
    if ((world.turn || 1) <= AOC2.WAR_BAN_TURNS) {
      return { ok: false, msg: '开局 ' + AOC2.WAR_BAN_TURNS + ' 回合内不能宣战' };
    }
    var tl = AO.aoc2.truceLeft(world, a, b);
    if (tl > 0) return { ok: false, msg: '停战期还剩 ' + tl + ' 回合' };
    if (ca.aoc.dip < AOC2.WAR_DIP_COST && !opts.free) {
      return { ok: false, msg: '外交点不够（需 ' + AOC2.WAR_DIP_COST + '，剩 ' + ca.aoc.dip + '）' };
    }
    if (!opts.free) ca.aoc.dip -= AOC2.WAR_DIP_COST;
    AO.aoc2.setRel(world, a, b, -100);
    ca.aoc.warStart[b] = world.turn || 1;
    cb.aoc.warStart[a] = world.turn || 1;
    /* opts.noJoin：只开这一场，不触发"盟友依约参战"。
     * 连带参战本身要触发一次，但**只能一层** —— 盟友的盟友不该跟着进来，
     * 否则一个 52 对同盟的世界里，一次宣战会连锁成全世界大战
     * （实测 100 回合 283 次宣战、263 对同时交战）。 */
    if (AO.aoc2.dip && !opts.noJoin) {
      AO.aoc2.dip.clearPact(world, a, b, 'nap');
      AO.aoc2.dip.clearPact(world, a, b, 'defpact');
      /* 防御条约 / 保障独立 / 附庸：被攻方把盟友拉进来（第十三章） */
      var joined = AO.aoc2.dip.onWarDeclared(world, a, b);
      var msg = ca.name + ' 向 ' + cb.name + ' 宣战';
      if (joined && joined.length) {
        var nm = [];
        for (var ji = 0; ji < joined.length; ji++) {
          var jc = world.countries[joined[ji].cid - 1];
          if (jc) nm.push(jc.name);
        }
        msg += '（' + nm.join('、') + ' 依约参战）';
      }
      return { ok: true, msg: msg, joined: joined };
    }
    return { ok: true, msg: ca.name + ' 向 ' + cb.name + ' 宣战' };
  };

  /* ---------------- 征兵（第十一章） ---------------- */
  /* 单省可招上限 = 人口 1/10 ~ 1/5（稳定省取高值） */
  AO.aoc2.recruitCap = function (p, cid) {
    var pop = totalPop(p);
    var cap = pop * (p.aoc.stab >= AOC2.RECRUIT_STAB_LINE
      ? AOC2.RECRUIT_CAP_STABLE : AOC2.RECRUIT_CAP_UNSTABLE);
    return Math.max(0, Math.floor(cap - (p.aoc.armyOf === cid ? p.aoc.army : 0)));
  };

  /* instant=true 是「征兵」敕令：即时到位、正常价 ×2（规则书第二十一章） */
  AO.aoc2.recruit = function (world, cid, pid, n, instant) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !c.aoc || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    if (p.owner !== cid) return { ok: false, msg: '不是自己的省' };
    if (p.aoc.occupied) return { ok: false, msg: '占领省不能募兵' };
    n = Math.floor(n);
    if (!(n > 0)) return { ok: false, msg: '兵数不对' };
    var cap = AO.aoc2.recruitCap(p, cid);
    if (cap <= 0) return { ok: false, msg: '这省已到征兵上限（人口 ' + Math.round(totalPop(p)).toLocaleString() + '）' };
    if (n > cap) n = cap;
    var mul = instant ? AOC2.INSTANT_MUL : 1;
    /* 募兵成本 × 政体系数（君主制 1.8；规则书第七章"募兵成本"那一列）。
     * 军械库每兵 −1 金（第五章）—— 单价降了，政体系数照乘。 */
    var unit = AO.aoc2.court ? AO.aoc2.court.recruitUnit(p) : AOC2.RECRUIT_GOLD;
    var cost = Math.round(n * unit * mul * govOf(c).recruit);
    if (c.aoc.treasury < cost) return { ok: false, msg: '国库不足（需 ' + cost.toLocaleString() + ' 金）' };
    var pop = totalPop(p);
    if (pop - n < 100) return { ok: false, msg: '人口不够' };

    c.aoc.treasury -= cost;
    /* 同时扣人口（规则书第十一章）：按国籍表扣本国那一份 */
    p.aoc.pop[cid] = Math.max(0, (p.aoc.pop[cid] || 0) - n);
    var np = totalPop(p);
    p.population = Math.round(np);

    if (instant) {
      if (c.aoc.mp < AOC2.MP_COST.recruit) {
        /* 移动点不够就别白扣钱：回滚 */
        c.aoc.treasury += cost;
        p.aoc.pop[cid] = (p.aoc.pop[cid] || 0) + n;
        p.population = Math.round(totalPop(p));
        return { ok: false, msg: '移动点不够（需 ' + AOC2.MP_COST.recruit + '）' };
      }
      c.aoc.mp -= AOC2.MP_COST.recruit;
      p.aoc.army = (p.aoc.army || 0) + n;
      p.aoc.armyOf = cid;
      return { ok: true, msg: '即时征兵 ' + n.toLocaleString() + ' 人（' + cost.toLocaleString() + ' 金）', n: n, cost: cost };
    }
    c.aoc.rq.push({ pid: pid, n: n });
    return { ok: true, msg: '征兵 ' + n.toLocaleString() + ' 人，下一回合到位（' + cost.toLocaleString() + ' 金）', n: n, cost: cost };
  };

  /* ---------------- 移动（第十一章） ---------------- */
  AO.aoc2.moveCost = function (world, cid, toPid) {
    var c = world.countries[cid - 1], p = world.provinces[toPid - 1];
    if (!c || !p) return 0;
    var tm = AOC2.TERRAIN_MOVE[p.terrain] || 1;
    return Math.max(1, Math.ceil(AOC2.MOVE_BASE * tm * govOf(c).move));
  };

  /* 一场仗的确定性抖动：同回合同省同双方 = 同一个数（禁 Math.random） */
  function warLuck(world, salt, a, b) {
    var h = AO.hashString('war:' + (world.turn || 1) + ':' + salt + ':' + a + ':' + b) >>> 0;
    return ((h % 2001) / 1000 - 1) * AOC2.COMBAT_LUCK;
  }

  /* 战斗：攻守双方按兵力结算，守方吃 地形 + 政体 防御加成（规则书第十一章） */
  function battle(world, atkCid, p, troops) {
    var defCid = p.aoc.occupied || p.owner;
    var def = p.aoc.army || 0;
    var defCountry = world.countries[defCid - 1];
    var defBonus = (AOC2.TERRAIN_DEF[p.terrain] || 0) +
      (defCountry && defCountry.aoc ? govDefOf(defCountry) : 0);
    /* 建筑与科技（第五、六章）：城堡 +10%/级、瞭望塔 +4%、科技每级 +0.5 */
    if (AO.aoc2.court && defCountry && defCountry.aoc) {
      defBonus += AO.aoc2.court.defOf(defCountry, p);
    }
    var la = warLuck(world, 'a', atkCid, p.id);
    var ld = warLuck(world, 'd', defCid, p.id);
    var atkPow = troops * (1 + la);
    /* 科技"更强军队"：攻方战力也吃自己那一份 */
    var atkC = world.countries[atkCid - 1];
    if (AO.aoc2.court && atkC && atkC.aoc) atkPow *= AO.aoc2.court.combatMul(atkC);
    var defPow = def * (1 + defBonus / 100) * (1 + ld);

    /* 空省：最少 10 兵才能占（规则书第十一章） */
    if (def <= 0) {
      if (troops < AOC2.OCCUPY_MIN_TROOPS) {
        return { ok: true, won: false, occupied: false, atkLoss: 0, defLoss: 0,
          msg: '空省至少要 ' + AOC2.OCCUPY_MIN_TROOPS + ' 兵才能占领（你派了 ' + troops + '）' };
      }
      return { ok: true, won: true, occupied: true, atkLoss: 0, defLoss: 0, remain: troops };
    }

    if (atkPow > defPow) {
      /* 攻方胜：守军全歼，攻方按对方战力折损 */
      var atkLoss = Math.min(troops - 1, Math.round(defPow * AOC2.COMBAT_LOSS));
      if (atkLoss < 0) atkLoss = 0;
      var remain = troops - atkLoss;
      p.aoc.army = 0;
      p.aoc.armyOf = 0;
      if (remain < AOC2.OCCUPY_MIN_TROOPS) {
        /* 打赢了但剩不下 10 个人守不住：残兵退回出发省，省仍归守方 */
        return { ok: true, won: true, occupied: false, atkLoss: atkLoss, defLoss: def,
          remain: remain, retreat: true, msg: '打赢了，但只剩 ' + remain + ' 兵，守不住（需 ' + AOC2.OCCUPY_MIN_TROOPS + '）' };
      }
      return { ok: true, won: true, occupied: true, atkLoss: atkLoss, defLoss: def, remain: remain };
    }

    /* 守方胜：攻方全灭，守方按攻方战力折损 */
    var dLoss = Math.min(def, Math.round(atkPow * AOC2.COMBAT_LOSS / (1 + defBonus / 100)));
    if (dLoss < 0) dLoss = 0;
    p.aoc.army = def - dLoss;
    if (p.aoc.army <= 0) { p.aoc.army = 0; p.aoc.armyOf = 0; }
    return { ok: true, won: false, occupied: false, atkLoss: troops, defLoss: dLoss,
      msg: '进攻被打退（守方 +' + defBonus + '% 防御）' };
  }

  /* 占领：阴影 / 不能募兵下敕令 / 每回合 ~10 金 / 大军损毁当地经济人口（第一章） */
  function occupyProvince(world, atkCid, p, troops) {
    var pop0 = totalPop(p);
    /* 大军开进会损毁当地经济和人口：军队越多损毁越重（第一章） */
    var dmg = Math.min(AOC2.OCCUPY_DAMAGE_MAX, (troops / Math.max(1, pop0)) * AOC2.OCCUPY_DAMAGE_MUL);
    if (dmg > 0) {
      for (var k in p.aoc.pop) p.aoc.pop[k] = Math.max(0, p.aoc.pop[k] * (1 - dmg));
      p.aoc.econ = Math.max(1, p.aoc.econ * (1 - dmg));
    }
    p.aoc.happy = clamp(p.aoc.happy - AOC2.OCCUPY_HAPPY_HIT, AOC2.HAPPY_MIN, AOC2.HAPPY_MAX);
    p.aoc.occupied = atkCid;
    p.aoc.army = troops;
    p.aoc.armyOf = atkCid;
    p.population = Math.round(totalPop(p));
    p.aoc.value = AO.aoc2.provValue(p);
    return dmg;
  }

  /* 移动一支兵：邻接、花移动点；目标是对手就打成一场仗 */
  AO.aoc2.move = function (world, cid, fromPid, toPid, n) {
    var c = world.countries[cid - 1];
    var a = world.provinces[fromPid - 1], b = world.provinces[toPid - 1];
    if (!c || !c.aoc || !a || !b || !a.aoc || !b.aoc) return { ok: false, msg: '目标不存在' };
    if (armyOwnerOf(a) !== cid) return { ok: false, msg: '出发省没有你的兵' };
    n = Math.floor(n);
    if (!(n > 0) || n > a.aoc.army) return { ok: false, msg: '兵数不对' };
    if (!a.neighbors || a.neighbors.indexOf(toPid) < 0) return { ok: false, msg: '只能移到相邻省' };
    var toOwner = b.aoc.occupied || b.owner;
    /* 无主之地（阶段五）：军队进不去 —— 规则书第一章把"中立 / 荒地"定义为
     * 只能殖民的地块。让兵能开进去的话，殖民那条线（1000 金换 1000 人）
     * 立刻变成"派 10 个人走一趟"，三种殖民方式全部作废。 */
    if (!toOwner) return { ok: false, msg: '无主之地军队进不去：要先殖民（省卡「殖民」）' };
    var hostile = toOwner !== cid && AO.aoc2.atWar(world, cid, toOwner);
    if (toOwner !== cid && !hostile &&
      !(AO.aoc2.dip && AO.aoc2.dip.canEnter(world, cid, toOwner))) {
      return { ok: false, msg: '要先宣战才能进入对方领土（或先拿到军事通行权）' };
    }
    var cost = AO.aoc2.moveCost(world, cid, toPid);
    if (c.aoc.mp < cost) return { ok: false, msg: '移动点不够（需 ' + cost + '，剩 ' + c.aoc.mp + '）' };
    c.aoc.mp -= cost;

    a.aoc.army -= n;
    if (a.aoc.army <= 0) { a.aoc.army = 0; a.aoc.armyOf = 0; }

    if (!hostile) {
      /* 友方/自己的省：并进去 */
      if (b.aoc.army > 0 && (b.aoc.armyOf || b.owner) !== cid) {
        /* 理论上不会发生（敌对会走 hostile 分支），保守处理成拒绝 */
        a.aoc.army += n; c.aoc.mp += cost;
        return { ok: false, msg: '目标省有别的国家的兵' };
      }
      b.aoc.army = (b.aoc.army || 0) + n;
      b.aoc.armyOf = cid;
      return { ok: true, moved: n, cost: cost, msg: '移动 ' + n.toLocaleString() + ' 兵（' + cost + ' 移动点）' };
    }

    /* 敌对：打 */
    var r = battle(world, cid, b, n);
    if (r.occupied) {
      occupyProvince(world, cid, b, r.remain);
      r.msg = '攻占 ' + b.name + '：歼敌 ' + (r.defLoss || 0).toLocaleString() +
        '，自损 ' + (r.atkLoss || 0).toLocaleString() + '，驻军 ' + r.remain.toLocaleString();
    } else if (r.retreat) {
      /* 残兵退回出发省 */
      a.aoc.army += (r.remain || 0);
      a.aoc.armyOf = cid;
    }
    if (!r.occupied && r.won === false && !r.retreat) {
      /* 攻方全灭：什么也不回 */
    }
    r.from = fromPid; r.to = toPid; r.cost = cost;
    return r;
  };

  /* 解散军队：只回填约 1/20 人口（第二章"撤编损耗人口"） */
  AO.aoc2.disband = function (world, cid, pid, n) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    if (armyOwnerOf(p) !== cid) return { ok: false, msg: '这省没有你的兵' };
    n = Math.floor(n || p.aoc.army);
    n = Math.min(n, p.aoc.army);
    if (n <= 0) return { ok: false, msg: '没有兵可解散' };
    p.aoc.army -= n;
    if (p.aoc.army <= 0) { p.aoc.army = 0; p.aoc.armyOf = 0; }
    p.aoc.pop[cid] = (p.aoc.pop[cid] || 0) + n / 20;
    p.population = Math.round(totalPop(p));
    return { ok: true, msg: '解散 ' + n.toLocaleString() + ' 人，回填 ' +
      Math.round(n / 20).toLocaleString() + ' 人口', n: n };
  };

  /* ---------------- 掠夺（第十二章 / 第二十一章） ---------------- */
  AO.aoc2.plunder = function (world, cid, pid) {
    var c = world.countries[cid - 1], p = world.provinces[pid - 1];
    if (!c || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    if (p.aoc.occupied !== cid) return { ok: false, msg: '只能掠夺自己占领的省' };
    if (!(p.aoc.army > 0)) return { ok: false, msg: '这省没有驻军，抢不了' };
    if (c.aoc.mp < AOC2.MP_COST.plunder) return { ok: false, msg: '移动点不够' };
    c.aoc.mp -= AOC2.MP_COST.plunder;
    var troops = p.aoc.army;
    var gold = Math.round(troops * AOC2.PLUNDER_GOLD);
    var rate = Math.min(0.20, troops / Math.max(1, totalPop(p)) * AOC2.PLUNDER_RATE);
    for (var k in p.aoc.pop) p.aoc.pop[k] = Math.max(0, p.aoc.pop[k] * (1 - rate));
    p.aoc.econ = Math.max(1, p.aoc.econ * (1 - rate));
    p.aoc.happy = clamp(p.aoc.happy - AOC2.PLUNDER_HAPPY, AOC2.HAPPY_MIN, AOC2.HAPPY_MAX);
    p.population = Math.round(totalPop(p));
    c.aoc.treasury += gold;
    return { ok: true, msg: '掠夺 ' + p.name + '：+' + gold.toLocaleString() + ' 金（人口 −' +
      (rate * 100).toFixed(1) + '%）', gold: gold };
  };

  /* ---------------- 战争分数（第十二章） ---------------- */
  AO.aoc2.warScore = function (world, a, b) {
    var ca = world.countries[a - 1], cb = world.countries[b - 1];
    if (!ca || !cb || !ca.aoc || !cb.aoc) return 0;
    var occA = 0, occB = 0, i, p;
    for (i = 0; i < cb.provinces.length; i++) {
      p = world.provinces[cb.provinces[i] - 1];
      if (p && p.aoc && p.aoc.occupied === a) occA++;
    }
    for (i = 0; i < ca.provinces.length; i++) {
      p = world.provinces[ca.provinces[i] - 1];
      if (p && p.aoc && p.aoc.occupied === b) occB++;
    }
    var totalB = Math.max(1, cb.provinces.length), totalA = Math.max(1, ca.provinces.length);
    /* clamp(v, lo, hi) —— 顺序别写反：写反了恒等于 lo，战争分永远 100 */
    return clamp(occA / totalB * 100 - occB / totalA * 50, 0, 100);
  };

  /* 割让：把一个省从原主转给新主（和约割地 / 转让控制权都用它） */
  AO.aoc2.transfers = 0;      // 割地次数（UI 拿它判断"版图变了，得重建路径"）
  AO.aoc2.transferProvince = function (world, pid, toCid) {
    var p = world.provinces[pid - 1];
    if (!p) return false;
    var fromCid = p.owner;
    if (fromCid === toCid) return false;
    var from = world.countries[fromCid - 1], to = world.countries[toCid - 1];
    if (from && from.aoc) {
      var idx = from.provinces.indexOf(pid);
      if (idx >= 0) from.provinces.splice(idx, 1);
      if (from.capital === pid) from.capital = 0;
    }
    if (to && to.aoc) {
      if (to.provinces.indexOf(pid) < 0) {
        to.provinces.push(pid);
        to.provinces.sort(function (x, y) { return x - y; });
      }
    }
    p.owner = toCid;
    p.ownerName = to ? to.name : '';
    p.ownerColor = to ? to.color : '#999999';
    p.aoc.occupied = 0;
    if (p.aoc.army > 0) p.aoc.armyOf = toCid;
    if (from) {
      if (!from.provinces.length) from.aoc.alive = false;
      AO.aoc2.recomputeCountry(world, from);
    }
    if (to) AO.aoc2.recomputeCountry(world, to);
    AO.aoc2.transfers++;
    return true;
  };

  /* ---------------- 和谈（第十二章） ---------------- */
  /* terms: 'white' 白和平 / 'land' 割让被占省 / 'reparations' 赔款 */
  AO.aoc2.peace = function (world, a, b, terms, opts) {
    opts = opts || {};
    var ca = world.countries[a - 1], cb = world.countries[b - 1];
    if (!ca || !cb || !ca.aoc || !cb.aoc) return { ok: false, msg: '国家不存在' };
    if (!AO.aoc2.atWar(world, a, b)) return { ok: false, msg: '并没有在交战' };
    var score = AO.aoc2.warScore(world, a, b);
    var foeWear = cb.aoc.wear || 0;
    /* 谁接受什么（第十二章"偏向值到 100 → 所有要求被接受"的落地）：
     *   白和平：占不到便宜的一方（分数 < 40）没资格要求停火 —— 赢家不白给；
     *           除非赢家自己也打疲了（厌战 ≥70%）。
     *   割地  ：全境被占（100）必接受；60 分以上且对方厌战 ≥70% 也认。
     *   赔款  ：50 分以上，或 30 分 + 对方厌战 ≥80%。 */
    /* 战争分 ↔ 条款的换算（附录 A 明说这是缺口，这里是实测标定的）：
     * 战争分的上限在实战里是"占掉对方一半的省"（=50），因为全境被占之前
     * 对方早就求和了。所以门槛不能定在 100 —— 实测 300 回合 0 次割地、
     * 全世界版图一动不动。改成按"占了几成"给条款：
     *   割地 30 分 / 附庸 45 分 / 赔款 20 分 / 白和平 40 分（输家开不了白和平） */
    var accept;
    if (terms === 'white') accept = score >= 40 || foeWear >= 0.7;
    else if (terms === 'land') accept = score >= 30 || (score >= 20 && foeWear >= 0.7);
    else if (terms === 'reparations') accept = score >= 20 || (score >= 12 && foeWear >= 0.8);
    /* 附庸化（第十四章"打赢战争在和约里附庸化"）：和割地同一道门槛。
     * 规则书没给"分数 ↔ 条款"的换算（附录 A 明确说是缺口），所以两条都
     * 按"全境被占 / 半境被占且对方打疲"来判 —— 附庸要的地更少、控制更强，
     * 不该比割地更难谈。 */
    else if (terms === 'vassal') accept = score >= 45 || (score >= 30 && foeWear >= 0.7);
    else accept = false;
    if (opts.force) accept = true;
    if (!accept) {
      return { ok: false, refused: true,
        msg: cb.name + ' 拒绝和谈（战争分 ' + Math.round(score) + '，对方厌战 ' +
          Math.round(foeWear * 100) + '%）' };
    }
    var out = { ok: true, score: score, terms: terms, ceded: 0, gold: 0 };
    if (terms === 'land') {
      /* 割让「被占领的」省：只割当前被 A 占着的 B 的省 */
      var list = [], i, p;
      for (i = 0; i < cb.provinces.length; i++) {
        p = world.provinces[cb.provinces[i] - 1];
        if (p && p.aoc && p.aoc.occupied === a) list.push(p.id);
      }
      for (i = 0; i < list.length; i++) {
        if (AO.aoc2.transferProvince(world, list[i], a)) out.ceded++;
      }
    } else if (terms === 'vassal') {
      /* 附庸化：地不动，人归你。占领省先还回去，再挂上宗主关系 */
      if (AO.aoc2.dip) AO.aoc2.dip.setVassal(world, b, a);
      out.vassal = true;
    } else if (terms === 'reparations') {
      var grossB = (cb.aoc.last && cb.aoc.last.gross) || 0;
      out.gold = Math.min(Math.round(cb.aoc.treasury), Math.round(grossB * 3));
      cb.aoc.treasury -= out.gold;
      ca.aoc.treasury += out.gold;
    }
    /* 白和平 / 赔款：占着的省要还回去（规则书第十二章只有"割让"会换归属）。
     * 占领军就地解散 —— 这支兵没有"遣返"这条路可走（遣返是军事通行权的事，
     * 阶段四才有），留着会变成"和平时期一支外国军队驻在你家里"的怪状态。 */
    if (terms !== 'land') {
      var all = [ca, cb], ai2, pi2, pp;
      for (ai2 = 0; ai2 < 2; ai2++) {
        var cc = all[ai2], other = all[1 - ai2];
        for (pi2 = 0; pi2 < cc.provinces.length; pi2++) {
          pp = world.provinces[cc.provinces[pi2] - 1];
          if (pp && pp.aoc && pp.aoc.occupied === other.id) {
            pp.aoc.occupied = 0;
            if ((pp.aoc.armyOf || 0) === other.id) { pp.aoc.army = 0; pp.aoc.armyOf = 0; }
          }
        }
      }
    }

    /* 结束战争：关系回 0，停战 30 回合（第十二章） */
    AO.aoc2.setRel(world, a, b, 0);
    ca.aoc.truce = ca.aoc.truce || {}; cb.aoc.truce = cb.aoc.truce || {};
    ca.aoc.truce[b] = (world.turn || 1) + AOC2.PEACE_TRUCE;
    cb.aoc.truce[a] = (world.turn || 1) + AOC2.PEACE_TRUCE;
    delete ca.aoc.warStart[b]; delete cb.aoc.warStart[a];
    ca.aoc.wear = Math.max(0, (ca.aoc.wear || 0) - 0.3);
    cb.aoc.wear = Math.max(0, (cb.aoc.wear || 0) - 0.3);
    out.msg = (terms === 'white' ? '白和平' : terms === 'land' ? '割让 ' + out.ceded + ' 省' :
      terms === 'vassal' ? '附庸化' :
      '赔款 ' + out.gold.toLocaleString() + ' 金') + '：' + ca.name + ' × ' + cb.name +
      '（停战 ' + AOC2.PEACE_TRUCE + ' 回合）';
    return out;
  };

  /* ---------------- 回合末的战争段 ---------------- */
  function settleWar(world, opts) {
    var ci, c, A;

    /* ① 征兵到货（正常价的兵下一回合到位） */
    for (ci = 0; ci < world.countries.length; ci++) {
      c = world.countries[ci];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      A = c.aoc;
      if (!A.rq || !A.rq.length) continue;
      for (var i = 0; i < A.rq.length; i++) {
        var it = A.rq[i], p = world.provinces[it.pid - 1];
        if (p && p.owner === c.id && !p.aoc.occupied) {
          p.aoc.army = (p.aoc.army || 0) + it.n;
          p.aoc.armyOf = c.id;
        }
        /* 省丢了：兵不发了（钱已经扣过，这是征兵的代价） */
      }
      A.rq = [];
    }

    /* ② 厌战：战时上升、和平回落（第九章） */
    for (ci = 0; ci < world.countries.length; ci++) {
      c = world.countries[ci];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      A = c.aoc;
      var wars = AO.aoc2.warsOf(world, c.id);
      /* 厌战只看"接壤的敌人"：叛军与所有人敌对（第九章〔社区〕），
       * 如果远方一个叛军也算战时，全世界会被拖成永久厌战 —— 实测
       * 100 回合 1000 多对交战、幸福全体 20 出头。 */
      var active = 0;
      for (var wi = 0; wi < wars.length; wi++) {
        if ((c.neighbors || []).indexOf(wars[wi]) >= 0) { active = 1; break; }
      }
      if (active) A.wear = Math.min(1, (A.wear || 0) + AOC2.WEAR_RISE);
      else A.wear = Math.max(0, (A.wear || 0) - AOC2.WEAR_FALL);
      A.wars = wars.length;
      A.activeWar = active;
    }

    /* ③ AI 的战争行为（玩家国不自动行动；opts.ai === false 时整段关掉，
     * 给单测和探针一个"世界不动、只有我动"的干净场景） */
    if (opts.ai === false) return;
    for (ci = 0; ci < world.countries.length; ci++) {
      c = world.countries[ci];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      if (opts.player === c.id) continue;
      aiWarTick(world, c, opts);
    }
  }

  function hashRoll(world, cid, salt) {
    var h = AO.hashString('aiwar:' + (world.turn || 1) + ':' + cid + ':' + (salt || '')) >>> 0;
    return (h % 1000) / 10;      // 0.0 ~ 99.9
  }


  /* AI 把后方的兵往战线挪：AoC2 里没有"前线"这个概念，但 AI 如果只会从
   * 与敌省相邻的省出击，兵招在内陆就永远走不到战场 —— 实测一场仗 20 回合
   * 双方兵力一动不动、只占了 2 个省。这里用一次 BFS 算出每个自省到前线的
   * 跳数，然后让后方的兵往跳数更小的邻省走一步（每回合每支兵走一跳）。 */
  function aiMarch(world, c) {
    var own = Object.create(null), i, k, p;
    for (i = 0; i < c.provinces.length; i++) own[c.provinces[i]] = 1;
    var dist = Object.create(null), queue = [];
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || p.aoc.occupied) continue;
      for (k = 0; k < p.neighbors.length; k++) {
        var q = world.provinces[p.neighbors[k] - 1];
        if (!q) continue;
        var o = q.aoc.occupied || q.owner;
        if (o !== c.id && AO.aoc2.atWar(world, c.id, o)) { dist[p.id] = 0; queue.push(p.id); break; }
      }
    }
    if (!queue.length) return;
    for (var h = 0; h < queue.length; h++) {
      var id = queue[h], pp = world.provinces[id - 1];
      for (k = 0; k < pp.neighbors.length; k++) {
        var nid = pp.neighbors[k];
        if (own[nid] && dist[nid] === undefined) { dist[nid] = dist[id] + 1; queue.push(nid); }
      }
    }
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || p.aoc.occupied || armyOwnerOf(p) !== c.id || p.aoc.army < AOC2.OCCUPY_MIN_TROOPS) continue;
      var d = dist[p.id];
      if (d === undefined || d === 0) continue;
      for (k = 0; k < p.neighbors.length; k++) {
        var nid2 = p.neighbors[k];
        if (!own[nid2] || dist[nid2] !== d - 1) continue;
        if (AO.aoc2.move(world, c.id, p.id, nid2, p.aoc.army).ok) break;
      }
    }
  }

  /* AI：招兵 → 行军 → 打 → 谈 → 宣战。都是"能解释的一步"，不追求聪明。 */
  function aiWarTick(world, c, opts) {
    var A = c.aoc, g = govOf(c);
    if (!A.alive || !c.provinces.length) return;
    var enemies = AO.aoc2.warsOf(world, c.id);
    /* 叛军和所有人敌对（第九章）：如果把它算进"已经在打仗"，
     * 所有国家都会永远停在"有敌人"的分支里，再也不宣战 ——
     * 实测 300 回合只剩 25 次宣战、全程 1 对交战。所以分成两份：
     *   enemies     打谁（含叛军）
     *   realEnemies 能不能谈、要不要另开一桌（不含叛军） */
    var realEnemies = [];
    for (var ei = 0; ei < enemies.length; ei++) {
      var eo = world.countries[enemies[ei] - 1];
      if (eo && eo.aoc && !eo.aoc.rebel) realEnemies.push(enemies[ei]);
    }

    /* ① 打不动了就和谈：厌战高 + 战争分低 */
    if (realEnemies.length) {
      var worst = 0, worstScore = 101;
      for (var e = 0; e < realEnemies.length; e++) {
        var sc = AO.aoc2.warScore(world, c.id, realEnemies[e]);
        if (sc < worstScore) { worstScore = sc; worst = realEnemies[e]; }
      }
      /* 打崩了对方（100 分）就割地；自己快撑不住就白和平 */
      /* 不能替玩家决定和平：对面是玩家就只打不谈（玩家自己开谈判桌） */
      var worstIsPlayer = opts.player === worst;
      var foeWear = (world.countries[worst - 1] || { aoc: {} }).aoc.wear || 0;
      /* 赢了就割地：全境占领必割；打到 60 分且对方厌战 ≥70% 也能割。
       * 只有"自己快撑不住且没占到便宜"才白和平。 */
      /* 先要附庸（地不动、人归你），要不到再割地 */
      if (!worstIsPlayer && AO.aoc2.dip &&
        (worstScore >= 45 || (worstScore >= 30 && foeWear >= 0.7)) &&
        !AO.aoc2.dip.overlordOf(world, worst) && !AO.aoc2.dip.overlordOf(world, c.id) &&
        world.countries[worst - 1] && world.countries[worst - 1].provinces.length <=
          Math.max(6, c.provinces.length * 0.5)) {
        var pv = AO.aoc2.peace(world, c.id, worst, 'vassal');
        if (pv.ok) return;
      }
      if (!worstIsPlayer && (worstScore >= 30 || (worstScore >= 20 && foeWear >= 0.7))) {
        var pr = AO.aoc2.peace(world, c.id, worst, 'land');
        if (pr.ok) return;
      }
      if (!worstIsPlayer && (A.wear || 0) >= 0.75 && worstScore < 25 &&
        hashRoll(world, c.id, 'peace') < 60) {
        AO.aoc2.peace(world, c.id, worst, 'white');
        return;
      }
    }

    /* ② 招兵：目标兵力 = 人口 × 1%（占位）；钱够就在人口最多的省招 */
    var total = armyOf(world, c.id);
    var target = A.pop * AOC2.AI_ARMY_RATIO;
    if (total < target && A.treasury > 5000 && A.mp >= 1) {
      /* 优先招在边境省：招在内陆的话，兵要一跳一跳往前挪，
       * 移动点又不够，结果整场仗一个省都占不下来（实测灭国 0）。 */
      var bestP = null, bestScore = -1;
      for (var i = 0; i < c.provinces.length; i++) {
        var q = world.provinces[c.provinces[i] - 1];
        if (!q || q.aoc.occupied) continue;
        var border = 0;
        for (var bi = 0; bi < q.neighbors.length; bi++) {
          var nb0 = world.provinces[q.neighbors[bi] - 1];
          if (nb0 && nb0.owner !== c.id) border = 1;
        }
        var sc0 = totalPop(q) * (border ? 3 : 1);
        if (sc0 > bestScore) { bestScore = sc0; bestP = q; }
      }
      if (bestP) {
        var n = Math.min(AOC2.RECRUIT_BATCH, Math.max(100, Math.round((target - total) / 2)));
        var r = AO.aoc2.recruit(world, c.id, bestP.id, n, false);
        if (!r.ok) {
          /* 钱不够就少招一点，别每回合白试 */
          AO.aoc2.recruit(world, c.id, bestP.id, Math.max(50, Math.floor(n / 4)), false);
        }
      }
    }

    /* ②b 复员：和平时期还欠着债，就裁掉两成兵（军费是最大的固定支出）。
     * 没有这一步，AI 会在每场仗后留着一支养不起的常备军，利息一路滚下去。 */
    if (!enemies.length && (A.loans > 0 || A.treasury < 1000) && total > target * 0.5) {
      var cut = Math.round(total * 0.2), guard2 = 0;
      for (var qi = 0; qi < c.provinces.length && cut > 0 && guard2++ < 40; qi++) {
        var qp = world.provinces[c.provinces[qi] - 1];
        if (!qp || !qp.aoc || armyOwnerOf(qp) !== c.id || !(qp.aoc.army > 0)) continue;
        var take = Math.min(cut, Math.floor(qp.aoc.army * 0.5));
        qp.aoc.army -= take; cut -= take;
        if (qp.aoc.army <= 0) { qp.aoc.army = 0; qp.aoc.armyOf = 0; }
      }
    }

    /* ③ 进攻：先把后方的兵挪到前线，移动点还够就继续推（一回合最多 3 次） */
    if (enemies.length) {
      aiMarch(world, c);
      for (var round = 0; round < 3; round++) {
        var moved = false;
        for (var pi = 0; pi < c.provinces.length && !moved; pi++) {
          var p = world.provinces[c.provinces[pi] - 1];
          if (!p || !p.aoc || armyOwnerOf(p) !== c.id || p.aoc.army < AOC2.OCCUPY_MIN_TROOPS) continue;
          for (var k = 0; k < p.neighbors.length; k++) {
            var nb = world.provinces[p.neighbors[k] - 1];
            if (!nb || !nb.aoc) continue;
            var owner = nb.aoc.occupied || nb.owner;
            if (owner === c.id) continue;
            if (!AO.aoc2.atWar(world, c.id, owner)) continue;
            var send = Math.max(AOC2.OCCUPY_MIN_TROOPS, Math.floor(p.aoc.army * 0.8));
            if (send > p.aoc.army) send = p.aoc.army;
            var mv = AO.aoc2.move(world, c.id, p.id, nb.id, send);
            if (mv.ok) { moved = true; break; }
          }
        }
        if (!moved) break;
      }
      /* 打完了：身上只有叛军（realEnemies 空）就继续往下走，该宣战宣战；
       * 有真敌人就收手（不另开战线）。 */
    }
    if (realEnemies.length) return;

    /* ④ 宣战：有兵、有外交点、有更弱的邻国（身上还挂着叛军也照宣不误） */
    if ((world.turn || 1) <= AOC2.WAR_BAN_TURNS) return;
    if (realEnemies.length) return;
    if (A.dip < AOC2.WAR_DIP_COST) return;
    if (total < Math.max(200, target * 0.6)) return;
    /* 性格（阶段五，第二十章"AI 按性格分工"）：扩张型更爱开战、外交型更不爱。
     * 乘在阈值上而不是乘决策本身 —— 这样"侵略度 75%"那条规则还在原位，
     * 只是每个国家有自己的系数。 */
    var wmul = AO.aoc2.world ? AO.aoc2.world.warMul(c) : 1;
    if (hashRoll(world, c.id, 'war') > AOC2.AI_WAR_CHANCE * AOC2.AI_AGGRO * wmul) return;

    var best = 0, bestRatio = 1;
    for (var ni = 0; ni < (c.neighbors || []).length; ni++) {
      var nc = world.countries[c.neighbors[ni] - 1];
      if (!nc || !nc.aoc || !nc.aoc.alive || nc.id === c.id) continue;
      if (AO.aoc2.atWar(world, c.id, nc.id)) continue;
      if (AO.aoc2.truceLeft(world, c.id, nc.id) > 0) continue;
      /* 盟友 / 互不侵犯：AI 不撕约（规则书只说"玩家实际可违约硬打"） */
      if (AO.aoc2.dip) {
        if (AO.aoc2.dip.has(world, c.id, nc.id, 'ally')) continue;
        if (AO.aoc2.dip.has(world, c.id, nc.id, 'nap')) continue;
        if (AO.aoc2.dip.has(world, c.id, nc.id, 'defpact')) continue;
      }
      var theirArmy = armyOf(world, nc.id);
      var ratio = theirArmy / Math.max(1, total);
      if (ratio < bestRatio) { bestRatio = ratio; best = nc.id; }
    }
    if (best && bestRatio < 0.7) AO.aoc2.declareWar(world, c.id, best);
  }

  /* =============================================================
   * ⑤ 敕令（规则书第二十一章；本阶段三条）
   * ============================================================= */
  function decreeCostDev(p) {
    var tp = totalPop(p);
    return AOC2.DEV_INVEST_BASE * Math.pow(1 + p.aoc.dev, 2) * (0.2 + tp / 100000);
  }
  function decreeCostEcon(p, gain) {
    var tp = Math.max(1, totalPop(p));
    return gain * AOC2.INVEST_ECON_COST * (1 + p.aoc.econ / tp * AOC2.INVEST_ECON_SLOPE);
  }
  AO.aoc2.decreeCost = function (world, pid, kind) {
    var p = world.provinces[pid - 1];
    if (!p || !p.aoc) return null;
    if (kind === 'festival') return Math.round(totalPop(p) * AOC2.ASSIMILATE_POP_GOLD);
    if (kind === 'econ') {
      var room = Math.max(0, totalPop(p) - p.aoc.econ);
      var gain = Math.min(room, Math.max(1, Math.round(totalPop(p) * AOC2.INVEST_ECON_GAIN)));
      return Math.round(decreeCostEcon(p, gain));
    }
    if (kind === 'dev') return Math.round(decreeCostDev(p));
    return null;
  };

  /* 下一回合才生效？不 —— 规则书没这么说，敕令是即时生效的（花移动点 + 金） */
  AO.aoc2.decree = function (world, cid, kind, pid) {
    var c = world.countries[cid - 1];
    var p = world.provinces[pid - 1];
    if (!c || !c.aoc || !p || !p.aoc) return { ok: false, msg: '目标不存在' };
    if (p.owner !== cid) return { ok: false, msg: '不是自己的省' };
    if (p.aoc.occupied) return { ok: false, msg: '占领省不能下敕令' };

    var mp = AOC2.MP_COST[kind] || 0;
    if (c.aoc.mp < mp) return { ok: false, msg: '移动点不够（需 ' + mp + '，剩 ' + c.aoc.mp + '）' };

    if (kind === 'festival') {
      var cost = AO.aoc2.decreeCost(world, pid, 'festival');
      if (c.aoc.treasury < cost) return { ok: false, msg: '国库不足（需 ' + cost + ' 金）' };
      c.aoc.treasury -= cost;
      var gain = totalPop(p) / AOC2.FESTIVAL_POP * AOC2.FESTIVAL_HAPPY;
      p.aoc.happy = clamp(p.aoc.happy + gain, AOC2.HAPPY_MIN, AOC2.HAPPY_MAX);
      p.aoc.fest = (p.aoc.fest || 0) + gain * 0.5;
      c.aoc.mp -= mp;
      return { ok: true, msg: '节日：幸福 +' + gain.toFixed(2) + '，花费 ' + cost + ' 金', gain: gain, cost: cost };
    }

    if (kind === 'econ') {
      var room2 = Math.max(0, totalPop(p) - p.aoc.econ);
      if (room2 <= 0.5) return { ok: false, msg: '经济已到人口上限（岗位满了）' };
      var gain2 = Math.min(room2, Math.max(1, Math.round(totalPop(p) * AOC2.INVEST_ECON_GAIN)));
      var cost2 = Math.round(decreeCostEcon(p, gain2));
      if (c.aoc.treasury < cost2) return { ok: false, msg: '国库不足（需 ' + cost2 + ' 金）' };
      c.aoc.treasury -= cost2;
      p.aoc.econ += gain2;
      c.aoc.mp -= mp;
      return { ok: true, msg: '投资经济：+' + Math.round(gain2) + '（上限 = 人口），花费 ' + cost2 + ' 金', gain: gain2, cost: cost2 };
    }

    if (kind === 'dev') {
      if (p.aoc.dev >= AOC2.DEV_MAX - 1e-9) return { ok: false, msg: '发展度已到 2.0 上限' };
      var cost3 = Math.round(decreeCostDev(p));
      if (c.aoc.treasury < cost3) return { ok: false, msg: '国库不足（需 ' + cost3 + ' 金）' };
      c.aoc.treasury -= cost3;
      var before = p.aoc.dev;
      p.aoc.dev = Math.min(AOC2.DEV_MAX, p.aoc.dev + AOC2.DEV_INVEST_STEP);
      c.aoc.mp -= mp;
      return { ok: true, msg: '投资发展：' + before.toFixed(2) + ' → ' + p.aoc.dev.toFixed(2) + '，花费 ' + cost3 + ' 金', cost: cost3 };
    }
    return { ok: false, msg: '未知敕令' };
  };

  /* 滑条合法性：四条预算互相挤占，合计不许超过 100；
   * 税率不许超过政体上限（规则书第七章）。返回归一化后的值。 */
  AO.aoc2.setSliders = function (c, sl) {
    var g = govOf(c);
    var out = {
      tax: clamp(Math.round(sl.tax), 0, 100),
      goods: clamp(Math.round(sl.goods), 0, 100),
      research: clamp(Math.round(sl.research), 0, 100),
      invest: clamp(Math.round(sl.invest), 0, 100)
    };
    var sum = out.tax + out.goods + out.research + out.invest;
    if (sum > 100) {
      /* 超额时从"投资"开始往回砍，最后砍税收 —— 物资与科研是长期项，先保 */
      var over = sum - 100;
      var order = ['invest', 'research', 'goods', 'tax'];
      for (var i = 0; i < order.length && over > 0; i++) {
        var take = Math.min(out[order[i]], over);
        out[order[i]] -= take;
        over -= take;
      }
    }
    c.aoc.sliders = out;
    return out;
  };
  AO.aoc2.setTaxRate = function (c, v) {
    var g = govOf(c);
    c.aoc.taxRate = clamp(Math.round(v), 0, g.taxCap);
    return c.aoc.taxRate;
  };
  AO.aoc2.sliderSum = function (c) {
    var s = c.aoc.sliders;
    return s.tax + s.goods + s.research + s.invest;
  };

  /* =============================================================
   * ⑥ 存档：只存 AoC2 自己的那几张表（v7 起）
   * ============================================================= */
  /* 存档要**拷贝**关系/停战/征兵队列：直接塞引用的话，存完之后玩家再改关系，
   * 快照里的值会跟着变（读档读出"存完之后"的状态，等于没存）。 */
  function cloneMap(o) {
    var r = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }
  /* 两层：pacts 的内层是 { nap, defpact, ... } 对象，浅拷贝会让快照和现场
   * 共享同一个内层 —— 存完之后清一条条约，快照里那条也跟着没了。 */
  function cloneNested(o) {
    var r = {}, k;
    for (k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      r[k] = (o[k] && typeof o[k] === 'object') ? cloneMap(o[k]) : o[k];
    }
    return r;
  }

  AO.aoc2.save = function (world) {
    var out = { t: world.turn || 1, p: {}, c: {}, own: [], reb: [] }, i, p, c;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc) continue;
      /* 归属必须存：世界读档时是按种子重生成的，不存 owner 的话
       * 所有征服、割地、叛军占的地都会还原成开局版图。 */
      out.own[p.id - 1] = p.owner;
      /* 阶段五的环境字段（病 / 殖民进度）由山海层自己打包，本文件不猜它的形状 */
      var env = AO.aoc2.world ? AO.aoc2.world.saveProv(p) : null;
      out.p[p.id] = {
        e: Math.round(p.aoc.econ * 100) / 100,
        d: Math.round(p.aoc.dev * 1000) / 1000,
        s: Math.round(p.aoc.stab * 10) / 10,
        h: Math.round(p.aoc.happy * 10) / 10,
        r: Math.round(p.aoc.revolt * 10) / 10,
        g: Math.round(p.aoc.growth * 100000) / 100000,
        o: p.aoc.occupied | 0,
        y: p.aoc.army | 0,
        yw: p.aoc.armyOf | 0,
        f: Math.round((p.aoc.fest || 0) * 100) / 100,
        n: p.aoc.pop,
        k: p.aoc.core,
        b: p.aoc.bld || {},
        q: (p.aoc.queue || []).map(function (x) { return { k: x.k, t: x.t, cost: x.cost }; }),
        /* 阶段五：病名 / 病程 / 殖民进度（只加字段，不升版本号） */
        dz: env ? env.dz : '',
        dzt: env ? env.dzt : 0,
        ind: env ? env.ind : 0,
        mal: env ? env.mal : 0
      };
    }
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc) continue;
      out.c[c.id] = {
        t: Math.round(c.aoc.treasury),
        l: Math.round(c.aoc.loans),
        tr: c.aoc.taxRate,
        sl: [c.aoc.sliders.tax, c.aoc.sliders.goods, c.aoc.sliders.research, c.aoc.sliders.invest],
        gv: c.aoc.gov,
        mp: c.aoc.mp, dp: c.aoc.dip,
        rp: Math.round(c.aoc.rp * 100) / 100,
        th: Math.round((c.aoc.tech || 0.01) * 100) / 100,
        ip: Math.round(c.aoc.investPool),
        al: c.aoc.alive ? 1 : 0,
        rel: cloneMap(c.aoc.rel || {}),
        pacts: cloneNested(c.aoc.pacts || {}),
        vo: c.aoc.vassalOf | 0,
        vs: cloneMap(c.aoc.vassals || {}),
        idp: Math.round((c.aoc.indep || 0) * 1000) / 1000,
        cool: cloneMap(c.aoc.cool || {}),
        gb: cloneMap(c.aoc.guarBy || {}),
        gt: c.aoc.great ? 1 : 0,
        prep: c.aoc.prepare || null,
        sup: c.aoc.supported || null,
        truce: cloneMap(c.aoc.truce || {}),
        wear: Math.round((c.aoc.wear || 0) * 1000) / 1000,
        era: c.aoc.era | 0,
        low: c.aoc.lowHappy | 0,
        /* 阶段五：黄金时代（第十九章）—— 只加字段，不升版本号 */
        gd: c.aoc.gd || '',
        gdt: c.aoc.gdt || 0,
        gd0: c.aoc.gd0 || 0,
        reb: c.aoc.rebel ? 1 : 0,
        rq: (c.aoc.rq || []).map(function (x) { return { pid: x.pid, n: x.n }; })
      };
    }
    /* 叛军国是"这一局长出来的"，种子重建不出来 —— 名字 / 颜色 / 首都全存 */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.rebel) continue;
      out.reb.push({
        id: c.id, name: c.name, nameEn: c.name_en, color: c.color,
        capital: c.capital, gov: c.aoc.gov,
        leader: c.leader ? c.leader.name : '', age: c.leader ? c.leader.age : 30
      });
    }
    return out;
  };

  /* 读档时把版图接回来：先补出叛军国，再逐省落归属 */
  function rebuildOwnership(world, owners, rebels) {
    var i, c, p;
    /* 1) 清空所有国家的省列表（世界是刚生成的） */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (c) c.provinces = [];
    }
    /* 2) 补出叛军国（id 必须等于下标 +1，追加即可） */
    if (rebels) {
      for (i = 0; i < rebels.length; i++) {
        var r = rebels[i];
        while (world.countries.length < r.id) {
          /* 理论不会发生（叛军是连续追加的），补个占位免得下标错位 */
          world.countries.push(makeCountry(world, '叛军', '#8a3b2f', 'rebel'));
        }
        if (world.countries[r.id - 1]) continue;
        var rc = makeCountry(world, r.name, r.color, r.gov || 'rebel');
        rc.name_en = r.nameEn || rc.name_en;
        rc.capital = r.capital || 0;
        if (r.leader) rc.leader.name = r.leader;
        if (r.age) rc.leader.age = r.age;
      }
    }
    /* 3) 逐省落归属 */
    if (owners) {
      for (i = 0; i < world.provinces.length; i++) {
        p = world.provinces[i];
        if (!p) continue;
        var ow = owners[p.id - 1];
        if (!ow) continue;
        p.owner = ow;
        c = world.countries[ow - 1];
        p.ownerName = c ? c.name : '';
        p.ownerColor = c ? c.color : '#999999';
        if (c) c.provinces.push(p.id);
      }
    }
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c) continue;
      c.provinces.sort(function (a, b) { return a - b; });
      AO.aoc2.recomputeCountry(world, c);
      if (!c.provinces.length && c.aoc) c.aoc.alive = false;
    }
  }

  AO.aoc2.load = function (world, data) {
    if (!data) return world;
    var i, p, c, s;
    if (data.t) world.turn = data.t;
    /* 版图先接回来（叛军国也在这一步补出来），再灌省 / 国的字段 */
    rebuildOwnership(world, data.own, data.reb);
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p) continue;
      s = data.p && data.p[p.id];
      if (!s) continue;
      if (!p.aoc) p.aoc = {};
      p.aoc.econ = s.e;
      p.aoc.dev = s.d;
      p.aoc.stab = s.s;
      p.aoc.happy = s.h;
      p.aoc.revolt = s.r || 0;
      p.aoc.growth = s.g || 0;
      p.aoc.occupied = s.o || 0;
      p.aoc.army = s.y || 0;
      p.aoc.armyOf = s.yw || 0;
      p.aoc.fest = s.f || 0;
      p.aoc.pop = s.n || p.aoc.pop;
      p.aoc.core = s.k || p.aoc.core;
      p.aoc.bld = s.b || {};
      p.aoc.queue = s.q || [];
      /* 阶段五的环境字段（病 / 殖民进度）：由山海层还原，缺字段时它自己补默认 */
      if (AO.aoc2.world) AO.aoc2.world.loadProv(p, s);
      p.aoc.value = AO.aoc2.provValue(p);
      p.population = Math.round(totalPop(p));
    }
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c) continue;
      s = data.c && data.c[c.id];
      if (!s) continue;
      if (!c.aoc) c.aoc = {};
      c.aoc.treasury = s.t;
      c.aoc.loans = s.l || 0;
      c.aoc.taxRate = s.tr;
      c.aoc.sliders = { tax: s.sl[0], goods: s.sl[1], research: s.sl[2], invest: s.sl[3] };
      c.aoc.gov = s.gv || 'monarchy';
      c.aoc.mp = s.mp; c.aoc.dip = s.dp;
      c.aoc.rp = s.rp || 0;
      c.aoc.tech = s.th || 0.01;
      c.aoc.investPool = s.ip || 0;
      c.aoc.alive = s.al !== 0;
      c.aoc.era = s.era | 0;
      c.aoc.lowHappy = s.low | 0;
      /* 阶段五：黄金时代。缺字段（旧档）就是"没有黄金时代"，不用补默认值以外的东西 */
      c.aoc.gd = s.gd || '';
      c.aoc.gdt = s.gdt || 0;
      c.aoc.gd0 = s.gd0 || 0;
      c.aoc.rebel = !!s.reb;
      c.aoc.rel = s.rel || {};
      c.aoc.pacts = s.pacts || {};
      c.aoc.vassalOf = s.vo | 0;
      c.aoc.vassals = s.vs || {};
      c.aoc.indep = s.idp || 0;
      c.aoc.cool = s.cool || {};
      c.aoc.guarBy = s.gb || {};
      c.aoc.great = !!s.gt;
      c.aoc.prepare = s.prep || null;
      c.aoc.supported = s.sup || null;
      c.aoc.truce = s.truce || {};
      c.aoc.wear = s.wear || 0;
      c.aoc.rq = s.rq || [];
      AO.aoc2.recomputeCountry(world, c);
    }
    return world;
  };


  /* =============================================================
   * 历法（UI 与编年史共用）
   *
   * 一年 12 回合。回合标签**必须带月**：只写年的话，连点十二次「下一回合」
   * 屏幕上那个字一个都不动 —— 玩家的第一反应是"卡了"。
   * 这段原来在 15-resources（旧资源层），换血时跟着搬过来。
   * ============================================================= */
  var CAL = { perYear: 12 };
  AO.CAL = CAL;
  AO.calOf = function (turn) {
    var t = Math.max(1, (turn | 0) || 1);
    return {
      turn: t,
      year: Math.floor((t - 1) / CAL.perYear) + 1,
      month: ((t - 1) % CAL.perYear) + 1
    };
  };
  var CN_D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  AO.cnNum = function (n) {
    n = n | 0;
    if (n < 0 || n > 99) return String(n);
    if (n < 10) return CN_D[n];
    var t = Math.floor(n / 10), u = n % 10;
    return (t === 1 ? '十' : CN_D[t] + '十') + (u ? CN_D[u] : '');
  };
  AO.calTag = function (turn) {
    var c = AO.calOf(turn === undefined ? (AO.curTurn ? AO.curTurn() : 1) : turn);
    return (c.year === 1 ? '元年' : AO.cnNum(c.year) + '年') +
      (c.month === 1 ? '正' : AO.cnNum(c.month)) + '月';
  };
  AO.calLabel = function (turn) {
    var c = AO.calOf(turn === undefined ? (AO.curTurn ? AO.curTurn() : 1) : turn);
    return '王国历 ' + c.year + ' 年 ' + c.month + ' 月';
  };

  /* 供 UI / 探针读的小结 */
  AO.aoc2.summary = function (world) {
    var out = [], i, c;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc) continue;
      out.push({
        id: c.id, name: c.name, treasury: c.aoc.treasury, loans: c.aoc.loans,
        happy: c.aoc.happy, stab: c.aoc.stab, pop: c.aoc.pop, econ: c.aoc.econ,
        army: armyOf(world, c.id), wear: c.aoc.wear || 0,
        wars: (AO.aoc2.warsOf(world, c.id) || []).length, alive: !!c.aoc.alive
      });
    }
    return out;
  };
  AO.aoc2.totalPop = totalPop;
  AO.aoc2.govOf = govOf;
  /* 释放附庸（第十四章）要建国：叛军和附庸走同一把刀，别写两份 */
  AO.aoc2.makeCountry = makeCountry;

})(typeof window !== 'undefined' ? window : globalThis);
