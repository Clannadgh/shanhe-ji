/* =============================================================
 * 15-resources.js —— 资源层（生成器侧）
 *
 * 在管线里的位置：buildSociety 之后、环规范化之前 —— 地形、国家、名字
 * 全部定完之后，作为最后一道工序"发牌"给省。
 *
 * 三条纪律：
 *   1) 只走独立支流 rng.fork('resources')。fork 只做哈希派生、不消耗父流，
 *      所以加这一段不会位移前面任何随机数，世界指纹保持 ef44ddc6 不变。
 *   2) 掷数顺序固定：种类数 → 选种类 → 储量。顺序不许换 ——
 *      换一次整张图的资源就全变一套。
 *   3) 颜色不硬编码，走 07-politics 的 buildDataPalette，饱和度压到 0.42
 *      （与国家色 0.32~0.47、信仰色 ≤0.55 同一套纪律，不抢视线）。
 *
 * 每省七种资源都有，只是"谁多谁少"：地形决定丰度上限，不决定有无 ——
 * 平原有盐也有金（1~10），山地的铁才可能到 90+。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* tier：strategic / mid / common（旧分级，保留给"富集省"等旧逻辑）
   * bias：地形 → 丰度权重（**不是有无**：表里没有的地形按 FLOOR_W 给微量）
   * cn  ：名字说的是**地里还没开发的那个东西**，不是成品、也不是设施 ——
   *       所以是"铁矿/金矿"（岩里的矿脉）而不是"铁/金锭"，
   *       是"耕地"（能开垦的地）而不是"粮食"（收上来的谷子），
   *       是"林木"（立着的树）而不是"木材/木板"。玩家读到的是"这地方有什么"。
   * build：这种资源开发时盖的建筑（下一轮游戏侧用，本轮只存数据）。
   * prod ：开发之后**变成的东西**（省卡"已开发"那一档显示的名字与图标），
   *        和 cn 成对：cn 是地里的形态，prod 是开发后的产物。
   * per  ：一座建筑**每回合**产出多少（回合制：一回合结算一次，不是每秒）。
   * cool ：采空之后的**冷静期**（回合）。0 = 不可再生（矿脉挖完就没了），
   *        >0 = 可再生，停这么多回合之后慢慢长回来。
   *
   * 为什么按回合而不是按秒：一回合结算一次，储量 100 的矿要 50 回合才采空，
   * 玩家的操作节奏（建造 / 征兵 / 外交）才跟得上；按秒的话几秒就挖空了。
   *
   * cost ：盖一座 Lv1 要吃什么 —— 木材 + 粮食 + 金（建材 + 工人的口粮 + 工资）。
   *        付账顺序：本省库存 → 中央国库 → 从同国富裕省份调拨（有调拨损耗）。
   * cost2：把一座旧建筑升到 Lv2 的价（主料略多、工资明显更贵）。
   *        **科技没研出来之前用不上**，见 AO.TECHS。
   * per2 ：Lv2 单座每回合产量（占位：= per × 2）。
   * maint：每座每回合的维护（铁 + 金）。maint2 是 Lv2 的，翻倍。
   *        付不起 → 这一类建筑当回合起停产（halted），凑齐了自动复工。
   * eat  ：本地居民吃掉的比例（0.4 = 四成）。农场/渔港/盐场/伐木场/牧场都吃，
   *        剩下的才进省库存；矿场不吃（矿石不能当饭）。
   * 这些字段只给 UI 层的模拟用，不参与地形生成、也不进 worldHash。
   * **所有数值都是占位**，拍板时只改这张表。 */
  var RESOURCES = [
    { key: 'iron',   cn: '铁矿', prod: '铁锭', build: '铁矿场', per: 2, per2: 4, cool: 0, eat: 0,    cost: { timber: 12, grain: 8, gold: 4 }, cost2: { timber: 16, grain: 8, gold: 10 }, maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'strategic', hue: 210, bias: { hills: 3.0, mountains: 2.2 } },
    { key: 'gold',   cn: '金矿', prod: '金锭', build: '金矿场', per: 2, per2: 4, cool: 0, eat: 0,    cost: { timber: 12, grain: 8, gold: 4 }, cost2: { timber: 16, grain: 8, gold: 10 }, maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'strategic', hue: 45,  bias: { mountains: 1.6, desert: 1.2 } },
    { key: 'grain',  cn: '耕地', prod: '粮食', build: '农场',   per: 3, per2: 6, cool: 3, eat: 0.40, cost: { timber: 8,  grain: 4, gold: 2 }, cost2: { timber: 12, grain: 4, gold: 6 },  maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'common',    hue: 88,  bias: { plains: 3.0, grassland: 2.4 } },
    { key: 'horse',  cn: '畜牧', prod: '牲畜', build: '牧场',   per: 2, per2: 4, cool: 5, eat: 0.30, cost: { timber: 10, grain: 6, gold: 3 }, cost2: { timber: 14, grain: 6, gold: 8 },  maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'strategic', hue: 28,  bias: { grassland: 2.0, plains: 1.0 } },
    { key: 'timber', cn: '林木', prod: '木材', build: '伐木场', per: 2, per2: 4, cool: 6, eat: 0.20, cost: { timber: 6,  grain: 6, gold: 2 }, cost2: { timber: 10, grain: 6, gold: 6 },  maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'common',    hue: 132, bias: { forest: 3.0, tundra: 1.5 } },
    { key: 'fish',   cn: '渔获', prod: '渔获', build: '渔港',   per: 3, per2: 6, cool: 5, eat: 0.35, cost: { timber: 14, grain: 6, gold: 4 }, cost2: { timber: 18, grain: 6, gold: 10 }, maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'common',    hue: 192, bias: { coast: 3.0, islands: 2.5 } },
    { key: 'salt',   cn: '盐',   prod: '盐',   build: '盐场',   per: 1, per2: 2, cool: 9, eat: 0.25, cost: { timber: 10, grain: 6, gold: 3 }, cost2: { timber: 14, grain: 6, gold: 8 },  maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'mid',       hue: 0,   bias: { swamp: 1.8, coast: 0.8 } }
  ];

  /* 颜色在这里统一生成：表里只写"语义色相" */
  (function () {
    var pal = AO.buildDataPalette(RESOURCES, { sMax: 0.42 });
    for (var i = 0; i < RESOURCES.length; i++) RESOURCES[i].color = pal[i];
  })();

  AO.RESOURCES = RESOURCES;

  /* 货运：不是资源建筑，是"物流"本身。
   * 升级它 → 调拨损耗更低（资源到得更快）、建造工期更短。
   *
   * 造价**固定**：每升一级都是木材 15 · 粮食 9，五级升满共 75 / 45。
   * 旧公式是 base × (等级 + 1)，Lv2 之后一级就要 30/18、满级共 150/90 ——
   * 比全国开局的中央国库（木材 40 + 6×省数）还贵，前中期根本升不动。
   *
   * 每级都得有实感，不能出现"花了钱什么都没变"：
   *   损耗 30 → 25 → 20 → 15 → 10 → 5 %（每级 −5）
   *   工期  3 →  2 →  2 →  1 →  1 → 1 回合（Lv1、Lv3 各缩一回合）
   * 两条轴错开，所以任意一级至少动一项（旧版 Lv2→Lv3 只降损耗、
   * 面板却还写着"工期 2 回合"，读起来像白花钱）。 */
  var FREIGHT = {
    key: 'freight', cn: '货运', en: 'Freight', build: '货运站',
    cost: { timber: 15, grain: 9 },   // 每次升级都是这个数（固定，不随等级涨）
    maxLv: 5,
    lossAt: function (lv) { return Math.max(0.05, 0.30 - 0.05 * lv); },    // 调拨损耗
    turnsAt: function (lv) { return Math.max(1, 3 - Math.ceil(lv / 2)); }  // 建造工期
  };
  /* 从 lv 升到 lv+1 的造价。现在与等级无关，留成函数是为了以后想改成
   * "越往上越贵"时，只动这里、不动调用方。返回新对象，调用方可以随便改。 */
  FREIGHT.costAt = function (lv) {
    return { timber: FREIGHT.cost.timber, grain: FREIGHT.cost.grain };
  };
  AO.FREIGHT = FREIGHT;

  /* ---------------- 城墙（城防值）：让攻城值有对手 ----------------
   * 一省一座，0~3 级（土木 → 砖石 → 棱堡），完全照货运站那套：
   * 升级制、维护吃铁+金、付不起就 halted（年久失修）。
   *
   * 它是一条**守方的额外血条**，不是又一个战力乘数：
   *   · 会战：守方伤亡先扣 hp，hp 空了才掉兵；hp>0 时守方战力 ×(1 + hp/max×0.25)
   *   · 轰击：先削 hp，削空了才杀伤 + 压制
   *   · 围城：**完全无视城墙** —— 饿死绕开墙，这正是围城战术的价值
   *
   * 单位换算：1 点城防 ≈ manPerHp 人的伤亡容量。30/60/100 点对上
   * "一场会战几百到一千多伤亡"这个量级 —— Lv1 大约能顶一场半，
   * 所以没有攻城器械的军队啃墙很慢，带重炮的一轮就砸穿（见 breachMul）。
   *
   * 全部占位：调平衡只改这一块。 */
  var WALL = {
    key: 'wall', cn: '城防', build: '城墙',
    maxLv: 3,
    hpAt: [0, 30, 60, 100],                 // 各级耐久上限
    lvCn: ['无', '土木', '砖石', '棱堡'],     // 各级叫什么（面板和战报都用它）
    cost: { timber: 18, gold: 10 },          // Lv0 → Lv1
    costMul: 2,                              // 每往上一级造价 ×2
    turnsAt: function (lv) { return lv >= 2 ? 3 : 2; },   // 升到 lv+1 要几回合
    maint: { iron: 0.3, gold: 0.4 },         // 每级每回合（实际 ×lv；取一位小数，面板不四舍五入）
    regen: 2,                                // 无战事每回合回复
    decay: 5,                                // 维护欠费：每回合失修
    manPerHp: 100,                           // 1 点城防吃 100 人份伤亡
    defendMul: 0.25,                         // 满耐久时守方战力 +25%
    breachMul: 2,                            // 破城锤：攻方攻城值合计 ×2 点/场
    bombardKoef: 0.5,                        // 轰击削墙 = 攻城值 × 兵数/1000 × 这个系数
    fabricRegen: 8,                          // 「营造」驻防：额外 +8/回合
    fabricRefill: 0.15,                      // 「营造」守城胜：立即回充 15%
    aiCapitalLv: 1                           // 敌国首都开局自动砌到这一级
  };
  WALL.maxHp = function (lv) { return WALL.hpAt[lv | 0] || 0; };
  /* 从 lv 升到 lv+1 的造价：18/10 → 36/20 → 72/40（每级 ×2） */
  WALL.costAt = function (lv) {
    var m = Math.pow(WALL.costMul, lv | 0);
    return {
      timber: Math.round(WALL.cost.timber * m),
      gold: Math.round(WALL.cost.gold * m)
    };
  };
  /* 这一级墙每回合的维护（铁 + 金），按等级线性涨 */
  WALL.maintAt = function (lv) {
    var n = lv | 0;
    return {
      iron: Math.round(WALL.maint.iron * n * 100) / 100,
      gold: Math.round(WALL.maint.gold * n * 100) / 100
    };
  };
  AO.WALL = WALL;

  /* ---------------- 学校：科研点的来源 ----------------
   * 完全仿 FREIGHT 的写法（不是资源建筑，是一种"通用"设施）：
   *   每座每回合 +per 科研点 → 攒进所属国家的 RESEARCH[owner].pts；
   *   科研点攒到 TECH_UNLOCK_PTS 就解锁科技树，之后当钱花。
   * 学校也吃维护（铁 + 金），付不起就停课（halted）—— 停课不产科研点。
   *
   * 为什么学校不按省记账、按国家记账：科技是**国家工程**，
   * 一个省建学校，全国受益；不然 1100 个省要各点一遍才能研一条科技。 */
  var SCHOOL = {
    key: 'school', cn: '学校', en: 'School', build: '学校',
    cost: { timber: 14, gold: 8 },      // 盖一座
    maint: { iron: 0.2, gold: 0.3 },    // 每座每回合
    per: 3,                             // 每座每回合 +3 科研点
    perCn: '科研点',
    turnsAt: function () { return 2; }  // 工期固定 2 回合（不跟货运走，学校是慢工）
  };
  AO.SCHOOL = SCHOOL;

  /* ---------------- 市场：把「金」的循环闭上 ----------------
   * 资源建筑只产资源、维护只吃铁+金 —— 没有金矿的省永远缺金。
   * 市场是唯一的换金口：**手动**卖资源换金（rate = 几单位资源换 1 金）。
   *
   * 为什么 v1 只做手动：自动交易会把回合制沙盒变成挂机游戏 ——
   * 玩家只需要点「下一回合」，剩下的交给市场。等数值定下来再说。
   *
   * 市场也吃维护，付不起就停产；**停产只停"卖"，不影响建造**。 */
  var MARKET = {
    key: 'market', cn: '市场', en: 'Market', build: '市场',
    cost: { timber: 12, gold: 6 },      // 盖一座
    maint: { iron: 0.2, gold: 0.3 },    // 每座每回合
    rate: 5,                            // 5 单位资源 → 1 金（占位）
    turnsAt: function () { return 2; }
  };
  AO.MARKET = MARKET;

  /* ---------------- 建造坊：工期冲刺的开关 ----------------
   * 有建造坊（且没停产）的省，任何一个工地行尾会多一个圆形「＋」：
   * 花 sprintCost 把工期砍 1 回合，可以连点。
   * 没有它 —— 或者它停产了 —— 这个省就只能老老实实等回合走。
   *
   * 研究冲刺同理，但看的是**全国**：只要还有一座不停产的建造坊，
   * 全屏科技树里"研究中"的节点和顶栏就能冲刺（钱从中央国库扣）。 */
  var BUILDER = {
    key: 'builder', cn: '建造坊', en: 'Builder', build: '建造坊',
    cost: { timber: 16, gold: 8 },
    maint: { iron: 0.3, gold: 0.3 },
    sprintCost: { gold: 2 },            // 冲一次砍 1 回合
    turnsAt: function () { return 2; }
  };
  AO.BUILDER = BUILDER;

  /* =============================================================
   * 内政批（占位数值集中在这里）—— 粮仓上限 / 人才档位
   * =============================================================
   *
   * ① 库存上限：治"稳态无限囤"。
   * 原来省库存只增不减 —— 只要不停产，一个省能把粮囤到四位数，
   * 于是"缺粮"永远只是开局前几回合的事，人口/饥荒/围城全成了摆设。
   * 现在每省每种资源各有上限（中央国库不上限：国家工程要能攒），
   * 产出超过上限的那部分**当场损耗**，并记进收支流水的 d.cap ——
   * 「满仓 −N」必须写出来，否则玩家只会看到"产出 3 却只进账 1"。
   *
   * 粮/渔两种吃的东西另加粮仓的 capBonus：粮仓是"储粮"这个玩法的
   * 唯一出口，3 座封顶（再多就是纯堆数值，没有决策）。
   * 粮仓停产（维护欠费）→ 加成立刻失效，但**已经囤着的超额存量保留** ——
   * 只掐增量、不销毁存货，不然玩家一停产就被抄家，手感像 bug。
   *
   * ② 人才档位 15 / 35 / 60：把"人才点"拆成两条线。
   *   pts   能花的（开科取士 / 开武科），抽卡会扣
   *   total 累计教育水平，**只加不减** —— 解锁靠它
   * 两条线互不侵占：抽掉 10 点官员不会把"工厂"重新锁上。
   */
  var CAP = {
    base: 150            // 每省每种资源的库存上限（粮/渔另加粮仓）
  };
  AO.CAP = CAP;

  var GRANARY = {
    key: 'granary', cn: '粮仓', en: 'Granary', build: '粮仓',
    cost: { timber: 10, grain: 6, gold: 4 },
    maint: { iron: 0.1, gold: 0.2 },
    capBonus: 100,       // 每座给粮/渔加多少上限
    maxPer: 3,           // 每省封顶 3 座
    turnsAt: function () { return 2; }
  };
  AO.GRANARY = GRANARY;

  /* 大学（民用第 5 座）：科研点与人才点的第二个来源 ——
   * 学校是"量"（3 点/座），大学是"质"（6 科研 + 2 人才/座）。
   * 门槛挂在累计教育 60（= 第三档），所以它是本批的"终点建筑"。 */
  var UNIVERSITY = {
    key: 'university', cn: '大学', en: 'University', build: '大学',
    cost: { timber: 24, gold: 20 },
    maint: { iron: 0.2, gold: 0.4 },
    perSci: 6,           // 每座每回合 +6 科研点（全国共用）
    perTalent: 2,        // 每座每回合 +2 人才点
    needTier: 60,        // 累计教育 ≥ 60 才能建
    turnsAt: function () { return 3; }
  };
  AO.UNIVERSITY = UNIVERSITY;

  /* 三档教育门槛。key 只给"有建筑要解锁"的两档：
   *   15 factory    —— 军备新建筑「工厂」（工业化：本省军械产出 ×2）
   *   35 （无 key） —— 「火炮」：铸炮厂的门槛从 15 提到 35，见 FACTORY.foundry
   *   60 university —— 民用第 5 座「大学」 */
  var TIER = [
    { at: 15, key: 'factory', cn: '工厂', desc: '本省军械坊 / 驯马场 / 铸炮厂 / 造船厂 产出 ×2' },
    { at: 35, cn: '火炮', desc: '铸炮厂要累计教育 35 才建得起来' },
    { at: 60, key: 'university', cn: '大学', desc: '每座 +6 科研点、+2 人才点' }
  ];
  AO.TIER = TIER;
  /* 累计教育 total → 已经跨过第几档（-1 = 还没到 15）。
   * 只此一份：解锁判断、面板进度行、跨档提示都用它，免得三处各判一次。 */
  AO.tierIndexAt = function (total) {
    var t = (typeof total === 'number' && isFinite(total)) ? total : 0;
    var idx = -1;
    for (var i = 0; i < TIER.length; i++) if (t >= TIER[i].at) idx = i;
    return idx;
  };

  /* 收支流水里用的单字简称（省卡一行要塞下 4~5 项，用「粮/木/铁/金」） */
  AO.RES_SHORT = {
    iron: '铁', gold: '金', grain: '粮', horse: '畜',
    timber: '木', fish: '鱼', salt: '盐'
  };

  /* ---------------- 科技树（七条支线 + 四条全局） ----------------
   * 字段：
   *   key   —— 科技 id（RESEARCH.done 里存的就是它）
   *   cn    —— 名字
   *   for   —— 解锁哪种资源建筑的 Lv2（= RESOURCES[i].key）
   *   pts   —— 研究要花多少科研点
   *   cost  —— 还要花的资源（**从中央国库扣**，国家工程不走调拨）
   *   turns —— 研究回合数（开工后逐回合倒计时）
   *   req   —— **前置科技**：null = 树根，其余必须先研完父节点
   * 效果一律是"该建筑可以盖/升 Lv2"，具体数值在 RESOURCES 的 cost2/per2/maint2。
   *
   * 形状（思维导图 / 树）：
   *          治学（学校）
   *        ├─ 铁犁深耕 ── 良种牧场
   *        ├─ 水力锯木 ── 高炉鼓风 ── 精炼提金
   *        └─ 远洋渔网 ── 盐田结晶
   * 三条支线各占一条产业链：农业 / 木铁金（重工业）/ 海产。
   * 越往下越贵（20 → 25 → 35 点），但也是产量翻倍最狠的那几种。
   *
   * 另有四条**全局科技**（for: null）：不解锁任何建筑，效果写在 fx 里，
   * 由 UI 层的 MODS(owner) 从 done 汇总成四个乘数/加数：
   *   tax      每笔抽税多抽几个
   *   maintCut 维护费打几折（0.25 = −25%）
   *   lossCut  调拨损耗降低几个百分点（0.05 = −5%）
   *   turnCut  建造/研究工期减几回合（下限 1）
   * 挂在不同支线的末端，所以"点满一条支线"才有全局加成，不是白送的。 */
  var TECHS = [
    { key: 'plow2',  cn: '铁犁深耕', for: 'grain',  pts: 20, cost: { gold: 5 }, turns: 2, req: null },
    { key: 'breed2', cn: '良种牧场', for: 'horse',  pts: 25, cost: { gold: 6 }, turns: 2, req: 'plow2' },
    { key: 'saw2',   cn: '水力锯木', for: 'timber', pts: 20, cost: { gold: 5 }, turns: 2, req: null },
    { key: 'blast2', cn: '高炉鼓风', for: 'iron',   pts: 25, cost: { gold: 6 }, turns: 3, req: 'saw2' },
    { key: 'mint2',  cn: '精炼提金', for: 'gold',   pts: 35, cost: { gold: 8 }, turns: 3, req: 'blast2' },
    { key: 'net2',   cn: '远洋渔网', for: 'fish',   pts: 20, cost: { gold: 5 }, turns: 2, req: null },
    { key: 'pan2',   cn: '盐田结晶', for: 'salt',   pts: 25, cost: { gold: 6 }, turns: 2, req: 'net2' },
    /* 全局科技：for 为 null，上树但不在资源支线上 */
    { key: 'ledger',  cn: '复式账簿', for: null, fx: { tax: 1 },         pts: 30, cost: { gold: 6 }, turns: 2, req: 'plow2' },
    { key: 'gauge',   cn: '标准工料', for: null, fx: { maintCut: 0.25 }, pts: 30, cost: { gold: 6 }, turns: 2, req: 'saw2' },
    { key: 'road',    cn: '驿道',     for: null, fx: { lossCut: 0.05 },  pts: 30, cost: { gold: 6 }, turns: 2, req: null },
    { key: 'apprent', cn: '学徒制',   for: null, fx: { turnCut: 1 },     pts: 30, cost: { gold: 6 }, turns: 2, req: 'net2' }
  ];
  AO.TECHS = TECHS;

  var TECH_BY_KEY = Object.create(null), TECH_FOR = Object.create(null);
  for (var ti = 0; ti < TECHS.length; ti++) {
    TECH_BY_KEY[TECHS[ti].key] = TECHS[ti];
    /* 全局科技 for 是 null，不能拿它当键 —— 否则 TECH_FOR[null] 会把
     * 某一条资源科技顶掉（"null 这种资源"的 Lv2 科技） */
    if (TECHS[ti].for) TECH_FOR[TECHS[ti].for] = TECHS[ti];
  }
  AO.TECH_BY_KEY = TECH_BY_KEY;
  /* 某种资源建筑对应的 Lv2 科技（没有就返回 null） */
  AO.techFor = function (resKey) { return TECH_FOR[resKey] || null; };

  /* 科研条攒满 → 解锁科技树。占位：30 点 = 10 座学校一回合。 */
  var TECH_UNLOCK_PTS = 30;
  AO.TECH_UNLOCK_PTS = TECH_UNLOCK_PTS;

  /* 中央抽税：每省每回合每种产出 ≥ min 时，抽 take 进中央国库。
   * 为什么必须先有这条：维护费要付铁 + 金，但**没有矿的省根本没有铁/金袋子**，
   * 全靠中央接济；中央没有进账，整套维护系统第一回合就崩。
   * 注意：某种资源的 per 必须 ≥ min，否则它永远抽不上来 —— 所以金矿的 per
   * 从 1 提到 2（维护费全靠金，抽不上来全国就停摆）。 */
  var TAX = { min: 2, take: 1 };
  AO.TAX = TAX;

  /* =============================================================
   * 治理层（GOV）—— 官员 / 人口税 / 幸福度
   *
   * 这一层的两条账**必须分清**，否则整个经济会变成一锅粥：
   *   生产抽税（AO.TAX）  每省每种产出抽一份 → 中央国库 → 养全国维护与科技
   *   人口税（AO.GOV）    省按人口向人民收金     → 省库（= 省的金锭库存）
   * 前者是国家工程的钱，后者是省长自己的钱：省库用来发俸禄、买货、建东西。
   * 所以人口税**不新开池子**，直接进 bag.gold.stock —— 省卡上看到的就是它。
   *
   * 官员从哪来：学校（不停课的）每回合产人才点，攒够 examCost 开科取士抽一位。
   * 词条（TRAITS）是抽卡池，权重 w；fx 由 UI 层的 PMOD(pid) 叠加到 MODS(owner) 上。
   *
   * **所有数值都是占位**，拍板时只改这一块 + TRAITS。 */
  var GOV = {
    /* --- 税率三档 --- */
    rateCn: ['轻徭薄赋', '常规', '横征暴敛'],
    rateShort: ['轻', '常', '暴'],            // 面板上的 segmented 短标签
    /* 人口税的计量单位与每档单价：**每 popUnit 人每回合 goldPerUnit 金**。
     *
     * 为什么不是字面上的"每 200 万人 1 金"：这个世界的人口是按省份面积摊出来的 ——
     * 1106 个省的实测分布是中位 12.7 万、p90 30.7 万、最大 53.8 万
     * （全世界合计 1.6 亿）。照 200 万的门槛算，一个中位省一回合只有 0.06 金，
     * 收 16 回合才够 1 金，连 1 金的俸禄都发不出来，整层玩法就是空转。
     * 所以把"多少人算一个单位"做成参数 popUnit = 10 万：
     *   中位省 ≈ 1.3 金/回合 · 大省 ≈ 4 金/回合 · 首都省更多，
     * 正好和"每座建筑维护 0.2 金""俸禄 1 金""买一次货 8 金"同一个量级。
     * 想回到"每 200 万人"的口径：把 popUnit 改成 2000000 即可（公式一行都不用动）。 */
    popUnit: 100000,
    goldPerUnit: [0.5, 1, 2],                 // 每单位人口每回合收多少金（小数攒整）
    happyHit: [0, -4, -12],                   // 税率对幸福度的压力

    /* --- 人才 --- */
    talentPerSchool: 0.5,                     // 每座在校（不停课）每回合人才点
    examCost: 10,                             // 抽一位官员花的人才点
    salary: 1,                                // 官员俸禄（金/回合，省库发；发不起欠着不罚）

    /* --- 收税系数 --- */
    noOfficerMul: 0.6,                        // 无官员省份的裸税系数
    happyTaxMul: function (v) { return 0.6 + v / 100 * 0.6; },  // 幸福度 → 收税系数

    /* --- 幸福度 --- */
    happyStart: 60,                           // 开局值 / 读旧档的补默认
    happyBase: 60,                            // 基准（drivers 的 base 项）
    happyLerp: 0.3,                           // 每回合向 target 靠 30%
    happyLackFood: -15,                       // 缺粮（eat < need）
    happyHaltEach: -3,                        // 每"类"停产建筑
    happyHaltCap: -9,                         // 停产扣分封顶
    happyMarket: 2,                           // 有在营市场
    happyLow: 30,                             // ≤ 这个值：人口增速打折
    happyHigh: 70,                            // ≥ 这个值：人口增速加成
    popLowMul: 0.5,
    popHighMul: 1.2,

    /* --- 买货（省库的第二种花法） ---
     * 每行「买 N ← X 金」：N = 市场的换金单位数，X = N × buyMul 向上取整。
     * 比卖价贵得多是**故意的**：中央进货是应急口（缺粮、缺铁），
     * 不是一条稳定的套利路径（否则市场就成了印钞机）。 */
    buyMul: 1.5,
    buyLot: function () {
      var n = (AO.MARKET && AO.MARKET.rate) || 5;
      return { n: n, gold: Math.ceil(n * GOV.buyMul) };
    },

    /* --- 显示用的人话（别让玩家自己换算 popUnit） --- */
    popCn: function () {
      var u = GOV.popUnit;
      return (u >= 10000 ? (u / 10000) + ' 万' : String(u)) + ' 人';
    },
    /* 某一档税率的完整说明 —— 面板 tooltip / 国家卡 / 省卡都从这里取，
     * 免得三处各写一遍、改一个数漏两处 */
    rateDesc: function (r) {
      return GOV.rateCn[r] + '：每 ' + GOV.popCn() + ' ' + GOV.goldPerUnit[r] +
        ' 金/回合，民心压力 ' + (GOV.happyHit[r] > 0 ? '+' : '') + GOV.happyHit[r];
    }
  };
  AO.GOV = GOV;

  /* ---------------- 官员词条（抽卡池） ----------------
   * w  权重；fx 进 PMOD(pid)：
   *     taxMul  收税乘数      happyAdd 幸福度加数
   *     turnCut 工期减回合    prodMul  按资源键乘产量
   * rar 稀有度（只影响显示边色 / 头像底色，不影响数值）：
   *     gray 平平无奇 · plain 一技之长 · bad 贪墨（红边）· gold 治世能臣（金边）
   * 权重合计 100，抽一位就是一次线性扫描 —— 不用建累积表。 */
  var TRAITS = [
    { key: 'plain',    cn: '平平无奇', w: 45, rar: 'gray',  fx: {},
      desc: '没什么本事，但好歹是个官' },
    { key: 'finance',  cn: '理财能手', w: 20, rar: 'plain', fx: { taxMul: 1.2 },
      desc: '税收 +20%' },
    { key: 'beloved',  cn: '民望贤达', w: 15, rar: 'plain', fx: { happyAdd: 8 },
      desc: '幸福度 +8' },
    { key: 'maker',    cn: '营造巧匠', w: 10, rar: 'plain', fx: { turnCut: 1 },
      desc: '本省建造/研究工期 −1' },
    { key: 'agrarian', cn: '劝农使',   w: 10, rar: 'plain', fx: { prodMul: { grain: 1.25, fish: 1.15 } },
      desc: '粮/渔产量 +25%/+15%' },
    { key: 'greedy',   cn: '贪墨成性', w: 5,  rar: 'bad',   fx: { taxMul: 1.4, happyAdd: -10 },
      desc: '税 +40%，幸福度 −10' },
    { key: 'sage',     cn: '治世能臣', w: 5,  rar: 'gold',  fx: { taxMul: 1.25, happyAdd: 6 },
      desc: '税 +25% 且幸福度 +6' }
  ];
  AO.TRAITS = TRAITS;
  var TRAIT_BY_KEY = Object.create(null);
  for (var tr = 0; tr < TRAITS.length; tr++) TRAIT_BY_KEY[TRAITS[tr].key] = TRAITS[tr];
  AO.traitOf = function (key) { return TRAIT_BY_KEY[key] || TRAITS[0]; };
  /* 稀有度的中文名（面板上写"一技之长"比写 plain 好看） */
  AO.RAR_CN = { gray: '平平无奇', plain: '一技之长', bad: '贪墨', gold: '治世能臣' };

  /* 抽卡取名：8 姓 × 12 名 = 96 种组合。重名靠 UI 层去重（见 pickOffName）。 */
  AO.OFF_NAMES = {
    surnames: ['王', '李', '张', '刘', '陈', '杨', '黄', '赵'],
    givens: ['守仁', '廷玉', '若水', '文正', '敬之', '元朗',
             '仲堪', '伯谦', '季常', '子昂', '允恭', '承业']
  };

  /* ---------------- 存档 ----------------
   * 存档键和版本号放在定义区，方便以后加字段时只改这里。
   * 为什么是手动存/读而不是自动读档：index.html 兼职"世界工坊"，
   * 自动读档会把工坊劫持成"永远继续上局"——换个种子看新世界都做不到。
   *
   * v2 加了 TALENT / OFFICIAL / TAXRATE / HAPPY（治理层）。
   * 键名**不带版本号**：带版本号的话旧档就永远找不到了，
   * 而"读到 v1 旧档补默认、不炸"正是要求之一（见 11-ui.js 的 loadGame）。 */
  AO.SAVE_KEY = 'sj.save';
  AO.SAVE_KEY_V1 = 'sj.save.v1';      // 旧档位置（只读，找到就按 v1 补默认）
  AO.SAVE_VER = 2;

  /* key → 定义。省上只存 { key, cn, color }（导出/存档用），
   * tier / bias 这类"生成期元数据"留在表里，渲染时按 key 反查。 */
  var BY_KEY = Object.create(null), IDX = Object.create(null);
  for (var bi = 0; bi < RESOURCES.length; bi++) {
    BY_KEY[RESOURCES[bi].key] = RESOURCES[bi];
    IDX[RESOURCES[bi].key] = bi;
  }
  AO.RESOURCE_BY_KEY = BY_KEY;
  AO.RESOURCE_INDEX = IDX;

  /* 图标画什么（三套都留在仓库里，可切）：
   *   'item'  —— assets/res/item-<key>.png（矢量手绘：**未开发形态**的物产，默认）
   *              铁矿=岩里嵌矿脉 / 金矿=岩里嵌金脉 / 耕地=可开垦的田块 /
   *              林木=还长在地里的针叶林 / 盐=天然盐晶 / 渔获=鱼 / 畜牧=活畜（马）。
   *              画的是"这地方有什么可以开发"，不是开发完的成品（铁锭/金锭/木板/盐砖/粮袋）。
   *   'glyph' —— assets/res/<key>.png（生图的墨字，备选风格）
   *   'font'  —— canvas 字体（最锐利，但少了实物感）
   * 缺图会逐级退回，所以这里只是"优先用哪个"。 */
  AO.RES_ICON = 'item';

  /* 地图上要不要再垫一层资源标记（图标）：
   *   'none' —— 不画（默认）。资源视图按主资源给省填色，七种储量在省份卡里看。
   *   'icon' —— 在省质心上画主资源的实物图标（会盖住地块，且和填色重复）。 */
  AO.RES_MARKS = 'none';

  /* ---------------- 分配 ----------------
   * 每省**七种资源都有**，只是量不同：
   *   地形只决定"这种资源在这片地上有多丰"，不决定有无 ——
   *   平原有盐也有金，只是储量低（1~10），山地的铁才可能到 90+。
   *
   *   w   = bias[terrain]，表里没有这项的地形给 FLOOR_W（微量）
   *   n   = (0.22 + 0.78·r) × (w / 3) × 100，取整、下限 1
   *
   * 掷数：每省按资源表顺序各掷一次（7 次），顺序固定。
   */
  var FLOOR_W = 0.22;
  AO.RES_FLOOR_W = FLOOR_W;

  /* ---------------- 渔获：沿海岸 / 河流的"地理成因" ----------------
   * 单看 terrain==='coast' 是不够的：
   *   · 内陆大河也能打渔（河鲜），不该输给一条没有河的秃海岸；
   *   · 两面都临海（半岛/地峡）本该更强，但如果那两面临的是陡岸，
   *     根本站不住码头 —— 这时渔获要压下去，并在地理说明里写清楚。
   *
   *   coast  = 一面海 1.55，每多一面 +0.75（最多算到三面）
   *   river  = 河道长度（世界内归一）1.8，河口再 +0.8
   *   harbor = 陡岸惩罚：1 - 0.62 × steep
   */
  var FISH_COAST = 1.55, FISH_EXTRA = 0.75, FISH_RIVER = 1.8, FISH_MOUTH = 0.8, FISH_STEEP = 0.62;
  AO.RES_FISH = {
    coast: FISH_COAST, extra: FISH_EXTRA, river: FISH_RIVER,
    mouth: FISH_MOUTH, steep: FISH_STEEP
  };

  function fishWeight(p) {
    var coast = p.coastDirs ? FISH_COAST + FISH_EXTRA * Math.min(2, p.coastDirs - 1) : 0;
    var river = FISH_RIVER * (p.riverRel || 0) + (p.riverMouth ? FISH_MOUTH : 0);
    var harbor = p.coastDirs ? (1 - FISH_STEEP * (p.coastSteep || 0)) : 1;
    return (0.22 + coast + river) * harbor;
  }
  AO.fishWeight = fishWeight;

  /* 远景（scale < 1.0）只画"富集省"：主资源储量 ≥ 这个值。近景全画。
   * 定 85 是量出来的：1100 省的世界里约 137 个，和旧版"只画战略资源"的
   * 136 个密度相当，远景才不至于糊成一片色点。 */
  var RICH = 85;
  AO.RES_RICH = RICH;

  AO.assignResources = function (world, rng) {
    var provinces = (world && world.provinces) || [];
    var countries = (world && world.countries) || [];
    var coast = (world && world.coast) || null;
    var i, j, k;

    /* 河道长度先取世界内最大值，好归一成 0~1（不同世界尺度不同，不能写死阈值） */
    var maxR = 1e-6;
    if (coast) {
      for (i = 0; i < provinces.length; i++) {
        var pr0 = provinces[i];
        if (pr0 && coast.rlen[pr0.id] > maxR) maxR = coast.rlen[pr0.id];
      }
    }

    for (i = 0; i < provinces.length; i++) {
      var p = provinces[i];
      if (!p) continue;

      /* 地理画像挂到省上（不参与 worldHash，纯派生量） */
      if (coast) {
        p.coastDirs = coast.dirs[p.id] | 0;
        p.riverLen = Math.round((coast.rlen[p.id] || 0));
        p.riverMouth = !!coast.mouth[p.id];
        p.riverRel = AO.clamp((coast.rlen[p.id] || 0) / maxR / 0.55, 0, 1);
        /* 陡岸：岸后地势高（省的均高离海面远）就当陡岸 —— 岸线像素本身
         * 天然贴着海平面，用它量不出坡度，所以取内陆一侧的整体高度。
         * 0.05 抵消沿岸低地，0.20 是分位实测：沿海省 p50=0.084、p90=0.216。 */
        var em = p.elevMean === undefined ? coast.seaLevel : p.elevMean;
        p.coastSteep = p.coastDirs ? AO.clamp((em - coast.seaLevel - 0.05) / 0.20, 0, 1) : 0;
      }

      var list = [];
      for (j = 0; j < RESOURCES.length; j++) {
        var def = RESOURCES[j];
        var w = def.bias[p.terrain] || FLOOR_W;
        if (def.key === 'fish' && coast) w = fishWeight(p);
        /* 盐：海盐看的是"有没有海岸"，不是地形名。
         * 地形里的 'coast' 现在只表示低地沿海（滨海平原），
         * 沿海的丘陵/山地一样能晒盐，所以按岸线画像补一份，别让它们白丢。 */
        if (def.key === 'salt' && p.coastDirs) w += 0.55;
        var n = AO.clamp(Math.round((0.22 + 0.78 * rng.next()) * (w / 3.0) * 100), 1, 100);
        list.push({ key: def.key, cn: def.cn, color: def.color, n: n });
      }

      /* 按储量降序；同量时保持资源表顺序（Array.sort 稳定），结果完全确定 */
      list.sort(function (a, b) { return b.n - a.n; });
      p.resources = list;
      /* 兼容字段：主资源 = 储量最高的那一条（地图上画的就是它） */
      p.resource = list[0];
    }

    /* 国家层汇总：{ key, cn, color, n, prov, max }
     *   n    = 全国该资源储量合计
     *   prov = 省数（七种资源每省都有，所以这个数就是国家省数）
     *   max  = 单省最高储量
     * 先按省成员顺序累加、再按 n 稳定排序 —— 同 n 时的次序也是确定的。
     *
     * 抽成独立函数是因为**改归属之后要重算**（涂色把一省划给别国，
     * 两边的国家储量合计都得跟着变，见 08b 的 AO.recomputeCountry）。
     * 生成期和运行期共用这一份，免得两处算法慢慢走偏。 */
    for (i = 0; i < countries.length; i++) {
      AO.aggCountryResources(countries[i], provinces);
    }
  };

  /* 单个国家的资源汇总（纯函数：只看成员省的 p.resources，不碰 rng） */
  AO.aggCountryResources = function (c, provinces) {
    var agg = Object.create(null), order = [], j, k;
    for (k = 0; k < c.provinces.length; k++) {
      var pv = provinces[c.provinces[k] - 1];
      if (!pv || !pv.resources) continue;
      for (j = 0; j < pv.resources.length; j++) {
        var r = pv.resources[j];
        if (!agg[r.key]) {
          agg[r.key] = { key: r.key, cn: r.cn, color: r.color, n: 0, prov: 0, max: 0 };
          order.push(r.key);
        }
        agg[r.key].n += r.n;
        agg[r.key].prov++;
        if (r.n > agg[r.key].max) agg[r.key].max = r.n;
      }
    }
    var clist = [];
    for (k = 0; k < order.length; k++) clist.push(agg[order[k]]);
    clist.sort(function (a, b) { return b.n - a.n; });
    c.resources = clist;
    return clist;
  };

  /* =============================================================
   * 战争层（MIL）—— 军械 / 兵种 / 舰种 / 装备厂 / 将领词条 / 会战
   *
   * 这一层的核心原则只有一句：**玩家给将领下命令，不微操**。
   * 所以这里定义的全是"一张订单、一个兵种、一条词条、一个系数"，
   * 逻辑（走位、会战、占领、投降）一律在 11-ui.js 的 settleWar 里跑。
   *
   * 三条纪律，和资源层一样：
   *   1) **所有数值都是占位**，拍板时只改这一块 + BATTLE；
   *   2) 军械坊的**产能是闸**：recipe 是每回合吃的东西，out 是每回合出几件，
   *      两者都写死在军械表里 —— 科技只解锁"能接哪种单"，不提高产量。
   *      想多产武器只有一条路：多盖军械坊。（这是本层唯一一处"堆量不堆科技"）
   *   3) 装备键（leather/ironwp/ship_galley…）和七种资源共用 SIM 袋，
   *      只是没有 AO.RESOURCE_BY_KEY，所以产出/维护循环会自动跳过它们，
   *      而 stockOf / payCost 这类按 key 取库存的函数一行都不用改。
   * ============================================================= */

  /* ---------------- 军械（10 档，冷兵器 4 + 火器 6） ----------------
   * key    存进 SIM 袋的键（和资源键同一命名空间，不能撞：iron/gold/grain/horse/timber/fish/salt）
   * cn     兵种名（征兵时写的就是它）
   * era    时代标签（文字徽章上用）
   * tech   解锁它的军事科技键；null = 初始就有（皮甲）
   * recipe 军械坊每回合的料；out 每回合出几件（**产能是闸**，不随科技涨）
   * pow    千人队战力系数（会战公式里乘兵数）
   * siege  攻城值（轰击伤害 / 围城效率；0 = 打不了城）
   * range  射程（>0 才有射击相位，才能接「轰击相邻敌省」的命令）
   * arms   征兵用的兵种类型：inf 步兵 / cav 骑兵（另吃战马）/ art 炮兵（吃炮）
   *
   * 战力占位 1.0/1.2/1.4/1.7/1.8/2.2/2.6/3.0/3.5/4.5，
   * 攻城值 0/0/0/2/2/3/3/4/5/6 —— 一档一档往上爬，火器段才真正拉开。
   * 为什么要"强弩·具装"给 1.7：它是冷兵器枝的终点，也是重骑兵的解锁点，
   * 不给足分量的话没人愿意在铁兵器之后再多研一条。 */
  var WEAPONS = [
    { key: 'leather',   cn: '皮甲',      unit: '皮甲民兵',   era: '部落', tech: null,
      recipe: { horse: 1 }, out: 2, pow: 1.0, siege: 0, range: 0, arms: 'inf', color: '#a08a6a' },
    { key: 'bronze',    cn: '青铜兵器',  unit: '青铜武士',   era: '青铜', tech: 'mil_bronze',
      recipe: { iron: 1, timber: 1 }, out: 2, pow: 1.2, siege: 0, range: 0, arms: 'inf', color: '#b08a3c' },
    { key: 'ironwp',    cn: '铁兵器',    unit: '铁甲步卒',   era: '铁器', tech: 'mil_iron',
      recipe: { iron: 1, timber: 1 }, out: 2, pow: 1.4, siege: 0, range: 0, arms: 'inf', color: '#8c949c' },
    { key: 'crossbow',  cn: '强弩·具装', unit: '具装重骑',   era: '强弩', tech: 'mil_crossbow',
      recipe: { iron: 1, horse: 1 }, out: 1, pow: 1.7, siege: 2, range: 1, arms: 'cav', color: '#7d6b96' },
    { key: 'matchlock', cn: '火门枪',    unit: '火门枪手',   era: '火门', tech: 'mil_matchlock',
      recipe: { iron: 1, salt: 1 }, out: 1, pow: 1.8, siege: 2, range: 1, arms: 'inf', color: '#a8623f' },
    { key: 'musket',    cn: '火绳枪',    unit: '火绳枪队',   era: '火绳', tech: 'mil_musket',
      recipe: { iron: 1, salt: 1 }, out: 2, pow: 2.2, siege: 3, range: 2, arms: 'inf', color: '#b2543a' },
    { key: 'flintlock', cn: '燧发枪',    unit: '燧发线列',   era: '燧发', tech: 'mil_flintlock',
      recipe: { iron: 1, salt: 1 }, out: 2, pow: 2.6, siege: 3, range: 2, arms: 'inf', color: '#9c4a52' },
    { key: 'percussion',cn: '击发枪',    unit: '击发猎兵',   era: '击发', tech: 'mil_percussion',
      recipe: { iron: 2, salt: 1 }, out: 2, pow: 3.0, siege: 4, range: 2, arms: 'inf', color: '#6f4a73' },
    { key: 'breech',    cn: '后膛定装',  unit: '后膛步枪队', era: '后膛', tech: 'mil_breech',
      recipe: { iron: 2, salt: 1 }, out: 2, pow: 3.5, siege: 5, range: 3, arms: 'inf', color: '#4a5b76' },
    { key: 'gw',        cn: '一战军械',  unit: '线列步兵',   era: '工业', tech: 'mil_gw',
      recipe: { iron: 2, salt: 2 }, out: 2, pow: 4.5, siege: 6, range: 3, arms: 'inf', color: '#3c5566' }
  ];

  /* ---------------- 铸炮枝（4 档）----------------
   * 炮是**另一种装备**，不占兵种档位：炮兵（arms:'art'）征一支要 1 门炮 + 1 把该代武器。
   * 攻城值 6/7/9/12 是本层最大的数 —— 轰击和围城全靠它。
   * 战力只有 1.2~2.4：炮在接触相位很脆（'art' 在会战里接触段战力打 5 折）。 */
  var GUNS = [
    { key: 'catapult',   cn: '投石机', unit: '投石机队', era: '攻城', tech: 'mil_catapult',
      recipe: { timber: 2, iron: 1 }, out: 1, pow: 1.2, siege: 6,  range: 1, arms: 'art', color: '#8a7550' },
    { key: 'bronze_gun', cn: '青铜炮', unit: '青铜炮队', era: '攻城', tech: 'mil_bronze_gun',
      recipe: { iron: 2, salt: 1 }, out: 1, pow: 1.6, siege: 7,  range: 2, arms: 'art', color: '#a8893c' },
    { key: 'field_gun',  cn: '野战炮', unit: '野战炮队', era: '攻城', tech: 'mil_field_gun',
      recipe: { iron: 2, salt: 2 }, out: 1, pow: 2.0, siege: 9,  range: 3, arms: 'art', color: '#7b6a52' },
    { key: 'heavy_gun',  cn: '重炮',   unit: '重炮营',   era: '攻城', tech: 'mil_heavy_gun',
      recipe: { iron: 3, salt: 2 }, out: 1, pow: 2.4, siege: 12, range: 4, arms: 'art', color: '#5c5a56' }
  ];

  /* ---------------- 舰种（4 档，并轨解锁）----------------
   * 简化版海军：**没有独立海图**。沿海省两两质心距离 < SEA.D 就算通航，
   * 舰队在"海路"上跑，一格 = 一个沿海省，一回合航程。
   * 舰种战力代替兵种战力，海上会战无地形。 */
  var SHIPS = [
    { key: 'galley',  cn: '桨帆船',   era: '桨帆', tech: 'mil_galley',
      recipe: { timber: 2 }, out: 1, pow: 1.4, cap: 1000, color: '#6b7f8c' },
    { key: 'galleon', cn: '盖伦帆船', era: '盖伦', tech: 'mil_galleon',
      recipe: { timber: 2, iron: 1 }, out: 1, pow: 2.0, cap: 1000, color: '#7a6a55' },
    { key: 'ship74',  cn: '风帆战列', era: '战列', tech: 'mil_ship74',
      recipe: { timber: 2, iron: 1 }, out: 1, pow: 2.8, cap: 1000, color: '#5e6a58' },
    { key: 'ironclad',cn: '铁甲舰',   era: '铁甲', tech: 'mil_ironclad',
      recipe: { iron: 3, timber: 1 }, out: 1, pow: 4.0, cap: 1000, color: '#4c5a63' }
  ];

  /* ---------------- 装备厂（5 种，状态照 UNIV 懒建） ----------------
   * 和学校/市场/建造坊共用同一套 UNIV 结构（n / site / halted / mAcc），
   * 所以维护、工地推进、完工、冲刺全靠原来那三处循环，一行新代码都不用加。
   * 差异只在两处：**建厂条件**（need）和**每回合的产出**（军械坊订单 / 驯马场战马 / 铸炮厂炮 / 造船厂舰）。
   *
   * need 是"这个省得先有什么"：
   *   iron   该省已建铁矿场（bag.iron.built > 0）
   *   horse  该省已建牧场
   *   coast  沿海 + 缓岸（复用渔港那套 coastDirs / coastSteep）
   *   talent 全国累计教育 ≥ FACTORY.foundry.talentNeed（铸炮厂要匠人；35 档起）
   *   tier   全国累计教育 ≥ D.needTier（工厂 15 / 大学 60）
   * 军械坊的产量**不随科技涨** —— 科技只解锁"能接哪种订单"（见 WEAPONS.recipe）。
   * 唯一能把产量翻倍的是**工厂**（15 档）：它不改 recipe，只把 out 乘 2。 */
  var FACTORY = {
    barracks: {
      key: 'barracks', cn: '兵营', en: 'Barracks', build: '兵营',
      cost: { timber: 14, gold: 6 }, maint: { iron: 0.2, gold: 0.3 },
      need: null, needCn: '不限省份',
      desc: '征兵入口：每回合最多征一支（受武器库存限制）',
      turnsAt: function () { return 2; }
    },
    armory: {
      key: 'armory', cn: '军械坊', en: 'Armory', build: '军械坊',
      cost: { timber: 16, iron: 6, gold: 8 }, maint: { iron: 0.4, gold: 0.4 },
      need: 'iron', needCn: '需本省已建铁矿场',
      desc: '订单制：在已解锁军械里选一种，每回合按 recipe 产 out 件',
      turnsAt: function () { return 2; }
    },
    stable: {
      key: 'stable', cn: '驯马场', en: 'Stable', build: '驯马场',
      cost: { timber: 12, grain: 8, gold: 5 }, maint: { iron: 0.2, gold: 0.3 },
      need: 'horse', needCn: '需本省已建牧场',
      desc: '每座每回合 +1 战马（骑兵成建制的第二道闸）',
      per: 1, turnsAt: function () { return 2; }
    },
    foundry: {
      key: 'foundry', cn: '铸炮厂', en: 'Foundry', build: '铸炮厂',
      cost: { timber: 18, iron: 10, gold: 10 }, maint: { iron: 0.5, gold: 0.5 },
      /* 门槛从 15 提到 35（第二批教育档「火炮」）：铸炮是匠人活，
       * 全国累计教育 35 才凑得出一批能浇炮的师傅。**已建成的照旧运转**，
       * 这里只是"能不能再盖一座"的判断，不回头拆厂。 */
      need: 'iron', talentNeed: 35, needCn: '需本省已建铁矿场 + 累计教育 ≥ 35',
      desc: '订单制：投石机 / 青铜炮 / 野战炮 / 重炮',
      turnsAt: function () { return 3; }
    },
    shipyard: {
      key: 'shipyard', cn: '造船厂', en: 'Shipyard', build: '造船厂',
      cost: { timber: 20, iron: 6, gold: 8 }, maint: { iron: 0.4, gold: 0.4 },
      need: 'coast', needCn: '需沿海且缓岸',
      desc: '订单制：桨帆船 / 盖伦 / 风帆战列 / 铁甲舰',
      turnsAt: function () { return 3; }
    },
    /* 工厂（第三批·15 档「工厂」）：不限省份，只认累计教育。
     * 效果是**本省**的军械产能 ×2（军械坊 / 驯马场 / 铸炮厂 / 造船厂），
     * 而且是"产出翻倍、料不变" —— 工业化解放的是产能，不是原料。
     * 维护略高于普通厂：它养的是整条产线，不是一块工地。 */
    factory: {
      key: 'factory', cn: '工厂', en: 'Factory', build: '工厂',
      cost: { timber: 20, iron: 8, gold: 14 }, maint: { iron: 0.4, gold: 0.5 },
      need: null, needCn: '不限省份 · 需累计教育 ≥ 15',
      needTier: 15, prodMul: 2,
      desc: '工业化：本省军械坊 / 驯马场 / 铸炮厂 / 造船厂 每回合产出 ×2',
      turnsAt: function () { return 3; }
    }
  };

  /* 装备厂能不能建 —— 建厂条件只有一份，＋钮 title 和真建厂都读它 */
  FACTORY.check = function (kind, prov, ctx) {
    var D = FACTORY[kind];
    if (!D) return { ok: false, why: '没有这种厂' };
    if (!prov) return { ok: false, why: '没有这个省' };
    if (D.need === 'iron') {
      var s = ctx && ctx.bag && ctx.bag.iron;
      if (!s || !(s.built > 0)) return { ok: false, why: '需本省已建铁矿场（先开发铁矿）' };
    } else if (D.need === 'horse') {
      var h = ctx && ctx.bag && ctx.bag.horse;
      if (!h || !(h.built > 0)) return { ok: false, why: '需本省已建牧场（先开发畜牧）' };
    } else if (D.need === 'coast') {
      if (!(prov.coastDirs > 0)) return { ok: false, why: '内陆省建不了造船厂' };
      if ((prov.coastSteep || 0) > 0.5) return { ok: false, why: '岸太陡，站不住船台' };
    }
    if (D.needTier && ctx && (ctx.edu || 0) < D.needTier) {
      return { ok: false, why: D.cn + '要累计教育 ' + D.needTier + '（现在 ' +
        Math.floor(ctx.edu || 0) + '）—— 开科抽卡不涨教育，建学校/大学才涨' };
    }
    /* 门槛看的是**累计教育**（TALENT.total），不是能花的人才点（pts）：
     * 抽一位官员就少 10 点 pts，若门槛看 pts，玩家的厂会被"抽卡抽回去"。 */
    if (D.talentNeed && ctx && (ctx.edu || 0) < D.talentNeed) {
      return { ok: false, why: '铸炮厂要匠人：累计教育 ' +
        Math.floor(ctx.edu || 0) + ' / ' + D.talentNeed };
    }
    return { ok: true };
  };
  AO.FACTORY = FACTORY;

  /* ---------------- 征兵 / 军队 / 会战 的占位常数 ----------------
   * 为什么单独一块：验收要求"会战公式数值集中一个 BATTLE 常量区"，
   * 那训练/口粮/占领/投降这些跟会战直接相关的数也放在一起 ——
   * 调平衡时只看这一块，不用翻 4000 行的 11-ui.js。 */
  var RECRUIT = {
    menPerUnit: 1000,      // 一支基础军队的兵数
    popPerUnit: 1000,      // 从省人口里直接扣（POP.v -= 1000）
    goldPerUnit: 2,        // 金（从中央国库扣，中央没有就扣省库）
    weaponPerUnit: 1,      // 该代军械 N 件（成建制门槛就看这个）
    horsePerCav: 1,        // 骑兵另扣战马（每支）
    gunPerArt: 1,          // 炮兵另扣炮（每支）
    maxMen: 20000,         // 一支军队的兵数上限（并军时不再往上加）
    aiMen: 4000,           // 敌国自动征兵的兵数
    aiEvery: 3             // 敌国每几回合检查一次
  };
  AO.RECRUIT = RECRUIT;

  /* ---------------- 敌国内政 AI（v7）的占位常数 ----------------
   * 敌国 AI 原来被三条约束捆着：不主动进攻 / 敌国之间不打 / 不动经济。
   * v7 只解除第三条，于是"每回合有几件事可做、花到什么程度"需要一组数。
   *
   * 为什么单独一块：和 RECRUIT / BATTLE / GOV 同一套纪律 ——
   * 调平衡时只看这一块，不用翻 18-ai.js 那三百行决策。
   *
   *   personas     性格与权重（生成时按 seed+cid 的散列掷，随档存）
   *   buildOrder   三种性格的建造优先级（kind 用的是 UNIV / RESOURCES 的键）
   *   actPerTurn   每国每回合最多几个动作
   *   buildPerTurn 其中"建造"最多几座 —— 不加这道闸，一回合两座能把国库抽干
   *   goldReserve  建之前中央金必须 ≥ cost.gold + 它（防抽干国库）
   *   schoolQuotaDiv 经营：全国学校 < 省数 / 它 才继续盖（扫盲，不是每省一座）
   *   tax*         调税阈值（经营/均衡降档 45、升回常规 80；军国 30 / 35）
   *   examMul      人才点 ≥ examCost × 它 才开科（和玩家同价，只是更谨慎）
   *   graft*       贪墨官上任几回合内、多大几率被 AI 自己撤换 */
  var AIECON = {
    personas: [
      { key: 'econ',     cn: '经营', w: 30 },
      { key: 'balanced', cn: '均衡', w: 50 },
      { key: 'mil',      cn: '军国', w: 20 }
    ],
    buildOrder: {
      /* 经营：先扫盲（学校）→ 换金口（市场）→ 冲工期（建造坊）→ 存粮（粮仓，
       *       粮/渔库存上限 +100/座）→ 军械坊只在有铁矿的省会落地（need = iron）。 */
      econ:     ['school', 'market', 'builder', 'granary', 'armory'],
      /* 均衡：学校 → 市场 → 建造坊 → 兵营 → 军械坊。
       * 兵营在交战中会被 18-ai.js 临时提到最前面（"兵营（交战中优先）"）。 */
      balanced: ['school', 'market', 'builder', 'barracks', 'armory'],
      /* 军国：兵营 → 军械坊 → 学校 → 市场。税重兵多，科研垫底。 */
      mil:      ['barracks', 'armory', 'school', 'market']
    },
    actPerTurn: 2,
    buildPerTurn: 1,
    goldReserve: 5,
    schoolQuotaDiv: 3,
    taxDownHappy: 45,
    taxUpGold: 80,
    milTaxGold: 30,
    milTaxHappy: 35,
    examMul: 1.5,
    graftTurns: 3,
    graftChance: 0.3
  };
  AO.AIECON = AIECON;

  var BATTLE = {
    diceLo: 0.85, diceHi: 1.15,      // 骰子：每方独立摇一次
    /* 地形修正（**只给守方**）：山地 1.3 / 森林 1.15 —— 其余按 1 或轻微正负 */
    terrainDef: {
      mountains: 1.30, hills: 1.20, forest: 1.15, swamp: 1.05,
      tundra: 1.05, desert: 0.95, plains: 1.00, grassland: 1.00,
      coast: 1.00, islands: 1.00
    },
    shootShare: 0.55,        // 射击相位：双方带射程的那部分战力先互杀伤
    lossBase: 0.26,          // 每个相位的基础损失率（按战力比放大）
    routRatio: 0.70,         // 战后兵力 < 对方 70% → 判负（= 兵少 30% 以上）
    encircle: 1.15,          // 合围：同省同国 ≥2 军，各 +15%
    suppress: 0.80,          // 被轰击压制：下回合 ×0.8
    decap: 0.80,             // 群龙无首：战力 −20%
    ambush: 1.30,            // 设伏（守方 + 山地/森林）
    wall: 1.25,              // 铁壁：防御 ×1.25
    raidFirst: 1.10,         // 闪袭：首战先手 +10%（并免一次守方射击）
    plunderRate: 0.30,       // 劫掠：抢存粮/金的 30%
    plunderHappy: -15,       // 劫掠：该省民心 −15
    scorchRate: 0.70,        // 坚壁清野：敌军进城前运走 70% 存粮
    siegeStarve: 0.10,       // 围城：存粮尽后每回合守军 −10%
    bombardKoef: 0.055,      // 轰击伤害 = 攻城值 × 兵数/1000 × 这个系数
    feedPerK: 0.5,           // 军队就地吃粮：每 1000 人每回合 0.5 单位
    starveLoss: 0.03,        // 断粮：每回合掉 3% 兵
    occupyProd: 0.6,         // 占领省产出 ×0.6
    occupyHappy: -10,        // 占领省民心 −10
    surrenderFrac: 1 / 3,    // 剩省 ≤ 1/3 → 投降
    surrenderFracDecap: 2 / 3, // 群龙无首时放宽到 2/3
    decapTax: 0.7,           // 群龙无首：税 ×0.7
    decapScience: 0.5,       // 群龙无首：科研 ×0.5
    decapHappy: -10,         // 群龙无首：民心 −10
    blockadeHappy: -5,       // 封锁：民心 driver −5
    seaD: 0.055              // 海路阈值 = 世界长边 × 这个系数（占位）
  };
  AO.BATTLE = BATTLE;

  /* ---------------- 战争迷雾 + 情报署（v6） ----------------
   * 迷雾是**玩家视角层**：底层 SIM / CENTRAL / 版图永远是真实的，
   * 这一层只决定"你现在看得见什么、看得有多旧"。
   *
   * 三态（visOf）：
   *   realtime  自己的省 / 自己军队脚下的省 / 友好邻省 —— 照常渲染
   *   seen      探过但不在跟前 —— 按 LASTSEEN 快照渲染，越旧越泛黄
   *   unknown   从没探过 —— 只露纸纹
   *
   * 所有数值都是占位：调平衡只改这一块。
   * 预算档 0/1/2 同时是**情报等级**与**反谍等级**（同一笔钱养两种人）。 */
  var INTEL = {
    cn: ['无', '常规', '重金'],
    short: ['无', '常', '重'],
    /* 每回合金（中央国库扣；扣不起 → 本回合按无档算，即"断供自动降档"） */
    cost: [0, 2, 6],
    desc: [
      '不设情报署：地图停在探过的那一天，永远不会自己更新',
      '自动织网：每 3 回合刷新 20 个已探省（边境与交战方向优先）',
      '自动织网加密：每 2 回合刷新 40 省，附建筑与驻军；每次另向未探区揭示邻国边境'
    ],
    /* 自动织网：间隔（回合）/ 每次刷新省数 / 是否写 bld+troops */
    autoEvery: [0, 3, 2],
    autoN: [0, 20, 40],
    deep: [false, false, true],
    /* 重金档每次额外揭示的未探省数（向邻国边境伸手） */
    spread: [0, 0, 7],              // 5~10 取中间值，实际 roll 在 5..10
    spreadLo: 5,
    spreadHi: 10,
    /* 定向探测（治理面板手动） */
    probeCost: 10,                  // 金（中央）
    probeCd: 5,                     // 每国冷却回合
    probeN: function (b) { return Math.max(6, (b | 0) * 4); },
    /* 暴露概率：目标国的反谍档（INTELB）→ 密探被抓的概率 */
    exposeP: [0, 0.15, 0.30],
    /* REL：极简关系值（-100~100，无序对）。v1 只有一条用途：
     * 邻省实时可见 = 非交战且 REL ≥ relFriend */
    relInit: 10,                    // 生成时每对 0 ± 这个数
    relWar: -100,
    relPeace: -30,
    relProbe: -15,
    relPlunder: -10,
    relFriend: 0,
    /* 泛黄分档：陈旧回合数 → 黄层 alpha（0.10 微黄 / 0.22 中黄 / 0.35 深黄） */
    staleMid: 5,
    staleOld: 20,
    yellow: [0.10, 0.22, 0.35],
    /* 纸纹（未测绘区）与斜线阴影 */
    paper: '#e6dcc4',
    paperDeep: '#dfd3b7',
    hatch: 'rgba(120,104,74,0.16)',
    /* AI：生成时掷预算档的权重（无 / 常规 / 重金），占位 —— 性格系统来了再接管 */
    aiBudgetW: [30, 50, 20],
    aiProbeEvery: 10,               // AI 每 ~10 回合对一个已知邻国下手一次
    /* AI 的"量入为出"线：国库低于 cost + 这个数就不办情报（先保维护）。
     * 不设这条时 60 回合约有 3/7 个 AI 国会把国库抽到 0（实测），
     * 建筑集体停产 —— AI 变弱是其次，主要看着像 bug。玩家不受此限。 */
    aiReserve: 25
  };
  AO.INTEL = INTEL;

  /* ---------------- 将领词条（武科抽卡池） ----------------
   * 和官员词条（TRAITS）是**两套池子**：文官管钱粮，武官管打仗，抽卡消耗同一种人才点。
   * w  权重（合计 147，不是 100 —— 抽卡是一次线性扫描，权重只表达相对概率）
   * tac 这条词条额外解锁的战术（"强攻"人人都会，所以不写在这里）
   * fx  powMul 战力乘数 / defMul 防御乘数 / move 行军省数 / first 先手 / rec 征兵减回合
   *     immuneNight 免疫夜袭 / autoFill 练兵自动补员 / happy 驻省民心加数
   * rar 稀有度（只管显示边色，和官员那套同一组取值） */
  var MIL_TRAITS = [
    { key: 'm_plain', cn: '平平无奇', w: 45, rar: 'gray', tac: [], fx: {},
      desc: '没什么战绩，但能带兵' },
    { key: 'm_fierce', cn: '猛将', w: 20, rar: 'plain', tac: [], fx: { powMul: 1.25 },
      desc: '战力 ×1.25' },
    { key: 'm_wall', cn: '铁壁', w: 15, rar: 'plain', tac: ['wall'], fx: { defMul: 1.25, immuneNight: true },
      desc: '防御 ×1.25，免夜袭' },
    { key: 'm_march', cn: '急行军', w: 10, rar: 'plain', tac: ['raid'], fx: { move: 2 },
      desc: '一回合可跨两省' },
    { key: 'm_drill', cn: '练兵使', w: 10, rar: 'plain', tac: [], fx: { rec: 1, autoFill: 0.02 },
      desc: '本省征兵快 1 回合，驻军每回合自动补员 2%' },
    { key: 'm_flash', cn: '闪袭', w: 8, rar: 'plain', tac: ['raid'], fx: { move: 2, first: 1.10 },
      desc: '跨两省、可指定敌首都，首战先手 +10%' },
    { key: 'm_siege', cn: '围城', w: 8, rar: 'plain', tac: ['siege'], fx: { siegeMul: 1.25 },
      desc: '围城效率 ×1.25' },
    { key: 'm_rider', cn: '游骑', w: 6, rar: 'plain', tac: ['plunder'], fx: { plunder: 1.30 },
      desc: '劫掠得手多 30%' },
    { key: 'm_night', cn: '夜战', w: 6, rar: 'plain', tac: ['night'], fx: {},
      desc: '夜袭：跳过守方射击相位' },
    { key: 'm_scorch', cn: '坚壁', w: 6, rar: 'plain', tac: ['scorch'], fx: {},
      desc: '坚壁清野：敌军进入前运走 70% 存粮' },
    { key: 'm_ambush', cn: '设伏', w: 6, rar: 'plain', tac: ['ambush'], fx: {},
      desc: '山地/森林防御 ×1.3' },
    { key: 'm_greedy', cn: '贪墨', w: 4, rar: 'bad', tac: [], fx: { powMul: 1.10, happy: -6 },
      desc: '战力 +10%，驻省民心 −6' },
    /* 「营造」是**行为型**词条：效果不写在 fx 里（TRAIT fx 执行器只管乘加），
     * 而是由城墙回复结算处查"这个省有没有驻防的营造将"来实现：
     *   驻防的省 hp 回复 +8/回合；每场守城战胜利后立即回充 15%。
     * fx 留空是故意的 —— 这样它不会被 powMul/defMul 那条路误吃。 */
    { key: 'fabric', cn: '营造', w: 8, rar: 'plain', tac: [], fx: {},
      desc: '驻防省城墙回复 +8/回合；守城战胜利后立即回充 15% 耐久' },
    { key: 'm_god', cn: '治世军神', w: 3, rar: 'gold', tac: ['raid', 'siege'], fx: { powMul: 1.15, siegeMul: 1.2 },
      desc: '闪袭 + 围城，战力 +15%' }
  ];
  AO.MIL_TRAITS = MIL_TRAITS;
  var MIL_BY_KEY = Object.create(null);
  for (var mt = 0; mt < MIL_TRAITS.length; mt++) MIL_BY_KEY[MIL_TRAITS[mt].key] = MIL_TRAITS[mt];
  AO.milTraitOf = function (key) { return MIL_BY_KEY[key] || MIL_TRAITS[0]; };

  /* ---------------- 战术（v1 就做这九个） ----------------
   * need = 需要将领有哪条词条（null = 人人可用）
   * where = 只能用在哪种命令上（attack / defend；都不写 = 两种都行）
   * auto = 自动判定，玩家不用点（合围看"同省同国 ≥2 军"） */
  var TACTICS = [
    { key: 'assault', cn: '强攻', need: null,
      desc: '正面会战，没有额外加成 —— 没有对应词条时的唯一选择' },
    { key: 'raid', cn: '闪袭', need: 'flash', desc: '一回合跨两省，可指定敌首都，首战先手 +10%' },
    { key: 'siege', cn: '围城', need: 'siege', desc: '围而不打：敌省产出归零，守军吃存粮，粮尽每回合 −10%' },
    { key: 'wall', cn: '铁壁', need: 'wall', desc: '防御 ×1.25，免疫一次夜袭' },
    { key: 'night', cn: '夜袭', need: 'night', desc: '跳过守方射击相位' },
    { key: 'plunder', cn: '劫掠', need: 'rider', desc: '抢 30% 存粮与金，该省民心 −15' },
    { key: 'ambush', cn: '设伏', need: 'ambush', where: 'defend', desc: '山地/森林防御 ×1.3' },
    { key: 'scorch', cn: '坚壁清野', need: 'scorch', where: 'defend', desc: '敌军进入前把 70% 存粮运往内陆省' },
    { key: 'pincer', cn: '合围', need: null, auto: true, desc: '同省同国 ≥2 军，各 +15%（自动）' }
  ];
  AO.TACTICS = TACTICS;
  var TAC_BY_KEY = Object.create(null);
  for (var tk = 0; tk < TACTICS.length; tk++) TAC_BY_KEY[TACTICS[tk].key] = TACTICS[tk];
  AO.tacOf = function (key) { return TAC_BY_KEY[key] || TACTICS[0]; };

  /* 命令类型（军队那一行的中文名 + 一句话说明，面板和战报共用） */
  AO.ORDERS = {
    attack:    { cn: '进攻', desc: '向目标国某省进军，遇敌会战，无敌则占领' },
    defend:    { cn: '驻防', desc: '留在本省，按战术迎敌' },
    train:     { cn: '练兵', desc: '原地补员（每回合 +2%，不打仗）' },
    bombard:   { cn: '轰击', desc: '对相邻敌省造成伤亡并压制（不触发会战）' },
    siege:     { cn: '围城', desc: '围住敌省：产出归零，粮尽守军 −10%/回合' },
    blockade:  { cn: '封锁', desc: '舰队封锁敌沿海省：断渔获、禁买货、民心 −5' },
    transport: { cn: '运输', desc: '舰队载陆军沿海→沿海，一回合航程' }
  };

  /* ---------------- 军事科技挂上科技树 ----------------
   * 为什么在定义区末尾统一 push 而不是手写进 TECHS 字面量：
   * 军械表里已经有 tech 键、前置、点数，再手写一遍必然有一天两边不一致。
   * 这里按"档位越深越贵"统一生成：pts 30→120，turns 2→4，cost 只吃金。
   *
   * req 的两条枝：
   *   冷兵器  皮甲(初始) → 青铜 → 铁兵器 → 强弩·具装
   *   火器    铁兵器段 → 火门枪 → 火绳枪 → 燧发枪 → 击发枪 → 后膛 → 一战
   *   铸炮    铁兵器段 → 投石机 → 青铜炮 → 野战炮 → 重炮
   *   舰种    铁兵器/火绳/燧发/一战 四档并轨解锁
   * 科技效果 = 解锁军械坊该订单 + 该兵种（**不提高产量**）。 */
  var MIL_TECH_DEF = {
    mil_bronze:     { cn: '青铜兵器', pts: 30, cost: { gold: 4 },  turns: 2, req: null,             branch: '冷兵器' },
    mil_iron:       { cn: '铁兵器',   pts: 35, cost: { gold: 5 },  turns: 2, req: 'mil_bronze',     branch: '冷兵器' },
    mil_crossbow:   { cn: '强弩·具装', pts: 45, cost: { gold: 7 }, turns: 3, req: 'mil_iron',       branch: '冷兵器' },
    mil_matchlock:  { cn: '火门枪',   pts: 50, cost: { gold: 8 },  turns: 3, req: 'mil_iron',       branch: '火器' },
    mil_musket:     { cn: '火绳枪',   pts: 60, cost: { gold: 9 },  turns: 3, req: 'mil_matchlock',  branch: '火器' },
    mil_flintlock:  { cn: '燧发枪',   pts: 70, cost: { gold: 10 }, turns: 3, req: 'mil_musket',     branch: '火器' },
    mil_percussion: { cn: '击发枪',   pts: 85, cost: { gold: 12 }, turns: 4, req: 'mil_flintlock',  branch: '火器' },
    mil_breech:     { cn: '后膛定装', pts: 100, cost: { gold: 14 }, turns: 4, req: 'mil_percussion', branch: '火器' },
    mil_gw:         { cn: '一战军械', pts: 120, cost: { gold: 16 }, turns: 4, req: 'mil_breech',     branch: '火器' },
    mil_catapult:   { cn: '投石机',   pts: 40, cost: { gold: 6 },  turns: 2, req: 'mil_iron',       branch: '铸炮' },
    mil_bronze_gun: { cn: '青铜炮',   pts: 55, cost: { gold: 8 },  turns: 3, req: 'mil_catapult',   branch: '铸炮' },
    mil_field_gun:  { cn: '野战炮',   pts: 75, cost: { gold: 10 }, turns: 3, req: 'mil_bronze_gun', branch: '铸炮' },
    mil_heavy_gun:  { cn: '重炮',     pts: 95, cost: { gold: 13 }, turns: 4, req: 'mil_field_gun',  branch: '铸炮' },
    mil_galley:     { cn: '桨帆船',   pts: 45, cost: { gold: 6 },  turns: 3, req: 'mil_iron',       branch: '舰种' },
    mil_galleon:    { cn: '盖伦帆船', pts: 65, cost: { gold: 9 },  turns: 3, req: 'mil_musket',     branch: '舰种' },
    mil_ship74:     { cn: '风帆战列', pts: 80, cost: { gold: 11 }, turns: 4, req: 'mil_flintlock',  branch: '舰种' },
    mil_ironclad:   { cn: '铁甲舰',   pts: 110, cost: { gold: 15 }, turns: 4, req: 'mil_gw',        branch: '舰种' }
  };
  AO.MIL_TECH_DEF = MIL_TECH_DEF;

  /* 军械 / 炮 / 舰 → 解锁它的科技键（征兵与订单都靠它判断"解锁了没有"） */
  (function () {
    var groups = [['weapon', WEAPONS], ['gun', GUNS], ['ship', SHIPS]];
    AO.MIL_ITEM = Object.create(null);
    for (var gi = 0; gi < groups.length; gi++) {
      var kind = groups[gi][0], arr = groups[gi][1];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        it.kind = kind;
        AO.MIL_ITEM[it.key] = it;
        if (it.tech) {
          var td = MIL_TECH_DEF[it.tech];
          if (!td) continue;
          var tech = {
            key: it.tech, cn: td.cn, for: null, mil: it.key, milKind: kind,
            pts: td.pts, cost: td.cost, turns: td.turns, req: td.req, branch: td.branch
          };
          TECHS.push(tech);
          TECH_BY_KEY[tech.key] = tech;
        }
      }
    }
    /* 皮甲没有科技键：它是"初始兵种"，兵营开局就能征 —— 但要武器库存，
     * 而皮甲的料是畜牧，所以开局那条链是"牧场 → 军械坊 → 皮甲民兵"。 */
    AO.MIL_ORDER = ['leather', 'bronze', 'ironwp', 'crossbow', 'matchlock', 'musket',
      'flintlock', 'percussion', 'breech', 'gw'];
    AO.GUN_ORDER = ['catapult', 'bronze_gun', 'field_gun', 'heavy_gun'];
    AO.SHIP_ORDER = ['galley', 'galleon', 'ship74', 'ironclad'];
  })();

  /* 存档版本：v3 加 PLAYER / WARSET / ARMY / GENERALS / 装备与厂状态
   *           v4 加事件状态（冷却/一次性/挂起/产量 buff）+ 信仰（政策/国教/传教中）
   *           v5 加编年史（YEARLOG 年表 / 定稿快照与称号 / 自动触发 flag）；
   *              旧档没有 CHRONO → 空年表起步，不炸（见 17-chrono 的 chronoLoad）
   *           v6 加战争迷雾（PLAYER 的 EXPLORED/LASTSEEN/INTELB/PROBE_CD）+ REL；
   *              旧档 PLAYER>0 但没有 FOG → 按"自国已探、其余 unknown"补初始化
   * 内政批（粮仓 / 人才档位）**不升号**：只加字段（GRANARY / UNIVERSITY /
   * TALENT.total / TALENT.tier / SIM 的 d.cap 流水），读 v6 旧档时缺什么补什么。
   * 并行批全部落地后由最后一批统一升号。 */
  AO.SAVE_VER = 6;

})(typeof window !== 'undefined' ? window : globalThis);
