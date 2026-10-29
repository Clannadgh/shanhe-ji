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
        occupied: 0,               // 占领方 cid（阶段二）
        disease: 0,                // 疾病压低稳定的量（阶段五）
        fest: 0                    // 节日带来的临时幸福（每回合衰减）
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
        rp: 0,                     // 研究点（阶段四接科技）
        investPool: 0,             // 投资款（阶段四接建筑/经济投资）
        last: null,                // 上回合收支明细
        /* 汇总值（每回合结算后写，UI 直接读，避免面板自己再算一遍算错） */
        happy: 55, stab: 55, pop: 0, econ: 0, dev: 0,
        alive: true
      };
      AO.aoc2.recomputeCountry(world, c);
    }
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

      /* 移动点与外交点每回合刷新（规则书第十一章：全国共享一条每回合刷新的池） */
      A.mp = A.mpMax;
      A.dip = Math.min(A.dipMax, A.dip + AOC2.DIP_BASE);

      var gross = 0, devSum = 0, soldiers = 0, provN = 0;

      /* ① 省收入 ---------------------------------------------------- */
      for (pi = 0; pi < c.provinces.length; pi++) {
        p = world.provinces[c.provinces[pi] - 1];
        if (!p || !p.aoc) continue;
        provN++;
        devSum += p.aoc.dev;
        soldiers += p.aoc.army || 0;

        var taxIncome = p.aoc.econ * (A.taxRate / 100) * AOC2.ECON_GOLD *
          (1 + p.aoc.dev * AOC2.DEV_TAX_BONUS) * (1 + g.taxRev / 100);
        /* 生产收入：受物资（goods）滑条影响 —— 物资足，工坊才开得动 */
        var prodIncome = p.aoc.econ * AOC2.PROD_GOLD * (0.5 + sl.goods / 100) *
          (1 + g.prodRev / 100);
        var inc = taxIncome + prodIncome;
        /* 占领省：原主收入归零，占领者拿固定 ~10 金（阶段二才可能有占领） */
        if (p.aoc.occupied && p.aoc.occupied !== c.id) inc = 0;
        p.aoc.income = inc;
        gross += inc;
      }

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
      var upkeep = soldiers * AOC2.UPKEEP_PER_SOLDIER * (1 + g.upkeep / 100);
      var interest = A.loans * AOC2.LOAN_RATE;
      var net = taxShare + unalloc - admin - upkeep - interest;

      A.treasury += net;
      A.rp += researchMoney * 0.1;                 // 占位：1 金科研款 = 0.1 研究点
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
          (p.aoc.weariness || 0) * 10;
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
          (p.aoc.occupied ? 20 : 0) +
          /* 驻军临时维稳：每 1000 兵 +2 稳定，最多 +20（规则书第八章"权宜"） */
          Math.min(20, (p.aoc.army || 0) / 1000 * 2);
        p.aoc.stab = clamp(p.aoc.stab + (sTarget - p.aoc.stab) * AOC2.STAB_STEP,
          AOC2.STAB_MIN, AOC2.STAB_MAX);

        /* ⑦ 增长：人口 / 经济 / 发展度 ---------------------------------
         * 地形倍率 × 政体 × 幸福；人口超过岗位（经济）时增长被压住 —— 第二章
         * "人口超过经济的部分会外流/停止增长"。 */
        var gmul = (AOC2.TERRAIN_GROWTH[p.terrain] || 1) * (1 + 0) *
          (0.5 + p.aoc.happy / 100);
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
    }
    return world;
  };

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
  AO.aoc2.save = function (world) {
    var out = { p: {}, c: {} }, i, p, c;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !p.aoc) continue;
      out.p[p.id] = {
        e: Math.round(p.aoc.econ * 100) / 100,
        d: Math.round(p.aoc.dev * 1000) / 1000,
        s: Math.round(p.aoc.stab * 10) / 10,
        h: Math.round(p.aoc.happy * 10) / 10,
        r: Math.round(p.aoc.revolt * 10) / 10,
        g: Math.round(p.aoc.growth * 100000) / 100000,
        o: p.aoc.occupied | 0,
        f: Math.round((p.aoc.fest || 0) * 100) / 100,
        n: p.aoc.pop,
        k: p.aoc.core
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
        ip: Math.round(c.aoc.investPool),
        al: c.aoc.alive ? 1 : 0
      };
    }
    return out;
  };

  AO.aoc2.load = function (world, data) {
    if (!data) return world;
    var i, p, c, s;
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
      p.aoc.fest = s.f || 0;
      p.aoc.pop = s.n || p.aoc.pop;
      p.aoc.core = s.k || p.aoc.core;
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
      c.aoc.investPool = s.ip || 0;
      c.aoc.alive = s.al !== 0;
      AO.aoc2.recomputeCountry(world, c);
    }
    return world;
  };

  /* 供 UI / 探针读的小结 */
  AO.aoc2.summary = function (world) {
    var out = [], i, c;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc) continue;
      out.push({
        id: c.id, name: c.name, treasury: c.aoc.treasury, loans: c.aoc.loans,
        happy: c.aoc.happy, stab: c.aoc.stab, pop: c.aoc.pop, econ: c.aoc.econ
      });
    }
    return out;
  };
  AO.aoc2.totalPop = totalPop;
  AO.aoc2.govOf = govOf;

})(typeof window !== 'undefined' ? window : globalThis);
