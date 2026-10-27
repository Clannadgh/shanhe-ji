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
   *        v18 追加一补课：**铁矿改 48**（"深层休眠"，到点 left 回满），
   *        金矿仍是 0（金有淘金场闭环，别再叠一层再生）。
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
    { key: 'iron',   cn: '铁矿', prod: '铁锭', build: '铁矿场', per: 2, per2: 4, cool: 48, eat: 0,   cost: { timber: 12, grain: 8, gold: 4 }, cost2: { timber: 16, grain: 8, gold: 10 }, maint: { iron: 0.2, gold: 0.2 }, maint2: { iron: 0.4, gold: 0.4 }, tier: 'strategic', hue: 210, bias: { hills: 3.0, mountains: 2.2 } },
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
   * 市场是唯一的换金口：**手动**卖资源换金（rate = 几单位资源换 1 金），
   * 反过来也管进货（拿省库金去世界市场买货，见 11-ui 的 buyWorld）。
   *
   * 为什么 v1 只做手动：自动交易会把回合制沙盒变成挂机游戏 ——
   * 玩家只需要点「下一回合」，剩下的交给市场。等数值定下来再说。
   *
   * 市场也吃维护，付不起就停产；**停产只停"卖"，不影响建造**。
   *
   * v18 追加三：市场买铁是**第三档铁源** —— 矿（最便宜）→ 熔旧坊（0.5 金/铁，
   * 封顶）→ 世界市场（最贵、无限）。越缺越贵，所以这三档自己会排队。
   *
   * v18 追加三：**每省一座**（maxPer: 1）。市场不是产能建筑，是"换金的口"——
   * 多盖一座只是把同一个口开两次，没有决策。真缺吞吐量该去修货运（调拨），
   * 那里才有"多快、损耗多少"的取舍。AI 本来就每省只盖一座（pickProv 挡着），
   * 所以这道闸只对玩家生效。 */
  var MARKET = {
    key: 'market', cn: '市场', en: 'Market', build: '市场',
    cost: { timber: 12, gold: 6 },      // 盖一座
    maint: { iron: 0.2, gold: 0.3 },    // 每座每回合
    rate: 5,                            // 5 单位资源 → 1 金（占位）
    maxPer: 1,                          // 每省一座（要吞吐量就去修货运）
    /* 兑换（v18 / B2）：**任何两种资源**都能互换（粮换铁、金换铁、鱼换盐…）。
     * 换回 = floor(付出 × PI(付出) / PI(换回) × (1 − spread))，一手 = rate 单位。
     * 为什么要抽这一成：不抽的话"粮换铁再换回粮"零损耗，市场就成了免费搬运机；
     * 抽一成之后倒手是亏的，兑换只用于"真的缺这一种"。 */
    xchg: { spread: 0.10 },
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

  /* =============================================================
   * 人口承载力（POPCAP）—— 地能养多少人，人就在哪里停（v18.2）
   * =============================================================
   *
   * 两把刀各管各的，别混：
   *   承载力  长期天花板 —— 地形 + 建筑决定"这块地最多住多少人"
   *   口粮    短期冲击   —— 缺粮 / 围城当场死人（settlePop 的饥荒分支）
   * 口粮口径（每 200 万人 1 粮）**一个字没动**：它管"今年够不够吃"，
   * 承载力管"这辈子能住多少"。合成一条，围城饿死人和人口上限就成了
   * 同一件事，两个玩法互相顶牛。
   *
   * 公式（全部占位，拍板只改这一块）：
   *   cap = ( 地形基础 × 首都倍率 + Σ建筑加成 ) × 铁犁深耕倍率
   *   地形基础（万）：平 40 / 草 30 / 海岸 35 / 林 20 / 丘 18 /
   *                  山 12 / 沼 10 / 荒 8 / 苔 6
   *   建筑加成（万/座）：农场 Lv1 +10 · 农场 Lv2 +20 · 渔港 +8 ·
   *                     粮仓 +6 · 牧场 +4
   *   首都 ×1.5 —— 首都是全国的粮仓与人口漏斗，同一片地在京畿能多养一半人
   *   铁犁深耕 ×1.25 —— 它本来就是粮食支线的第一个节点，顺手把天花板抬起来，
   *   科技才有"同一块地能多养人"的实感（只抬上限，不改产量）
   *   ×面积系数 —— **可选、默认关**（见下面 areaRef：省数调小之后必须开）
   *
   * 三个结算分支（settlePop 里，11-ui）：
   *   pop < cap → 照旧按"本回合产出 − 口粮"分档涨
   *   pop ≥ cap → 增长归零（**不回落**，面板写「人丁兴旺」）
   *   pop > cap → 每回合 −1% 往 cap 回落 + 民心 −2（driver「人满为患」）
   * 第三条是给"吞地 / 事件涌入"留的：那些人是凭空多出来的，不会因为
   * 没饭当场消失，但会慢慢流走，同时挤得人心不安。
   *
   * 为什么 cap 不进 POP 表：它是**纯函数**（地形 + 建筑 + 科技）。
   * 每回合现算比存档多一个字段安全 —— 建筑一拆、科技一研，上限立刻跟着变，
   * 不会出现"存档里的上限和面板上的建筑对不上"。所以 SAVE_VER 不动。
   */
  var POPCAP = {
    /* 地形基础（万）。键与 AO.TERRAIN_CN 对齐。
     * islands 是任务书没列的一项（地形表里确有"群岛"）：按海岸 35 打八折 = 28 ——
     * 岛小、耕地碎，但也靠海吃海，不该比山地（12）还低。 */
    base: {
      plains: 40, grassland: 30, coast: 35, forest: 20, hills: 18,
      mountains: 12, swamp: 10, desert: 8, tundra: 6, islands: 28
    },
    fallback: 20,           // 表里没有的地形（以后加新地形时不至于 cap = 0）
    capMul: 1.5,            // 首都省倍率
    add: { farm1: 10, farm2: 20, fish: 8, granary: 6, horse: 4 },   // 万/座
    plowMul: 1.25,          // 铁犁深耕
    plowTech: 'plow2',      // 倍率挂在哪个科技上（RESEARCH.done 里查）
    unit: 10000,            // 表里按"万"写，算出来换成"人"
    overRate: 0.01,         // 超限：每回合 −1%（往 cap 回落）
    overHappy: -2,          // 超限：民心 −2（driver「人满为患」）

    /* 面积系数（**默认关**：0 = 不启用）。
     * 承载力是"每省一个定额"，而人口是按**省面积**摊的 —— 于是只有默认的
     * 1100 省世界对得上：中位面积 987 px²、负载中位 50%、超限 3%（实测）。
     * 省数一调小，每省面积和人口一起成倍放大，定额却没动：
     *   260 省（中位面积 4013）→ 负载中位 187%、84% 的省一开局就超限
     *    80 省（中位面积 13672）→ 负载中位 563%、99% 超限
     * 那时已经不是"地养不活人"，而是"全世界一起掉血"。
     * 要修就把这里设成基准面积（默认世界的中位面积 **987**），
     * cap 会按 area / areaRef 等比放大，三档世界立刻回到同一个负载分布。
     * 默认关着，是因为任务书给的是"按省定额"—— 开不开由拍板的人定。 */
    areaRef: 0,

    /* AI 的扩容本能（18-ai 的 provScore 只读这三个数）：
     *   load = pop / cap
     *   > high（85%）→ 农场 / 粮仓 / 渔港 的分数 +boost（谁挤就先扩谁）
     *   < low （50%）→ 这一省**跳过**（还不挤，别把料扔在空地上）
     * boost 的量级对着 provScore 现有两项定：省库金顶到 150 也只值 30 万、
     * 人口 50 万值 50 万，所以 200 万足以让"挤"压过"富"与"人多"，
     * 真正决定的是负载 —— 这就是"扩容本能"该有的样子。 */
    ai: { high: 0.85, low: 0.5, boost: 2000000 }
  };

  /* cap 计算：**纯函数**，不碰任何全局状态（测试可以直接喂假数据）。
   *   terrain —— 省的 terrain 键（plains / hills / …）
   *   ctx     —— { capital, farm1, farm2, fish, granary, horse, plow, area }
   *              （area 只在 areaRef 打开时才用得上）
   * 返回**人**（已经乘过 unit），不是万。 */
  POPCAP.capOf = function (terrain, ctx) {
    return POPCAP.parts(terrain, ctx).cap;
  };
  /* 同一套公式的明细版 —— 省卡悬停要把每一项拆开，所以只算一次、两边共用。
   * 返回的 base / land / farm / fish / granary / horse / sum 单位是**万**，
   * cap 例外（人）。名字带 N 的是座数，悬停直接拿它写「农场 Lv1×2」。 */
  POPCAP.parts = function (terrain, ctx) {
    ctx = ctx || {};
    var P = POPCAP, A = P.add;
    var base = P.base[terrain];
    if (base === undefined) base = P.fallback;
    var mul = ctx.capital ? P.capMul : 1;
    var land = base * mul;
    var f1 = ctx.farm1 | 0, f2 = ctx.farm2 | 0;
    var fishN = ctx.fish | 0, granN = ctx.granary | 0, horseN = ctx.horse | 0;
    var farm = f1 * A.farm1 + f2 * A.farm2;
    var fish = fishN * A.fish, gran = granN * A.granary, horse = horseN * A.horse;
    var sum = land + farm + fish + gran + horse;
    var plow = ctx.plow ? P.plowMul : 1;
    /* 面积系数：只有显式打开 areaRef 才算（见常量区那段实测） */
    var areaMul = (P.areaRef > 0 && ctx.area > 0) ? (ctx.area / P.areaRef) : 1;
    return {
      base: base, capMul: mul, land: land,
      farm: farm, fish: fish, granary: gran, horse: horse,
      farm1: f1, farm2: f2, fishN: fishN, granaryN: granN, horseN: horseN,
      sum: sum, plowMul: plow, areaMul: areaMul, cap: sum * plow * areaMul * P.unit
    };
  };
  AO.POPCAP = POPCAP;

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

  /* =============================================================
   * 熔旧坊（SMELT）—— 枯竭 / 休眠铁矿场的再就业
   *
   * v18 追加一补课：铁矿 cool 0 → 48，采空不是"永远没了"，是**深层休眠 48 回合**，
   * 到点储量回满、矿场自己复产。所以这一行现在有两种"没铁可挖"的状态：
   *   gone（永久枯竭）  旧档里的铁袋迁移之后基本不会再有，留着是为了兜底
   *   cool > 0（休眠）  48 回合的等待期 —— 这正是开炉的时机
   * 熔旧坊是这段等待期里**唯一**的活路：把省里的旧铁器（锅、刀、犁）回炉重炼，
   * 换一条涓流（税铁是另一脉，见 AO.GOV）。
   *
   * 三条纪律：
   *   1) **不新增建筑行** —— 它就长在铁矿场那一行里（n>0 时行内变身）。
   *      理由：省卡右栏已经六行军备 + 七行资源 + 五通用 + 货运，
   *      再插一行"熔旧坊"会让"铁矿场"和"熔旧坊"看起来是两处无关的产业。
   *   2) 唯一入口是**矿睡了之后**那个 ＋ 钮（变成「改建」）——
   *      矿还在产的时不许改建（矿还在，去炼旧锅是亏本生意）。
   *   3) 金耗锁死 = 产量 × goldPerIron。真矿约 0.1 金/铁
   *      （维护 0.2 铁 + 0.2 金 出 2 铁），熔旧坊贵 5 倍是**故意的**：
   *      矿是命脉，这是休眠/枯竭期的活路，不是替代品。
   * ============================================================= */
  var SMELT = {
    key: 'smelt', cn: '熔旧坊', en: 'Old-Iron Smeltery',
    cost: { timber: 10, gold: 14 },   // 改建价：拆矿架、砌炉膛、收旧铁
    turns: 2,                         // 改建工期（回合）
    maxPer: 2,                        // 每省封顶 2 座（再多就是纯堆数值）
    /* v18（A0）：**没有教育门槛**。最缺铁金的恰恰是没铺学校的穷国（军国人格
     * 学校垫底），"累计教育 15"把活路锁在最需要的人门外 —— 活命建筑不问学历。 */
    /* 每座每回合的铁产量 = min(perCap, perBase + 人口/popUnit × perPop)。
     * 人口项极缓（200 万一档），所以现实里一座就是 0.5~0.6 铁/回合，
     * perCap 只是防止某个超级大省把它堆成矿场。
     * **popUnit 是熔旧坊自己的口径，不跟 GOV.ironUnit 走**：v18 追加二把人口
     * 铁税的计量单位提到 10 万（税要从涓流变常脉），炉子仍是涓流 —— 两者共用
     * 一个数，每座炉的产量会凭空涨 20 倍，矿与炉的平衡当场崩掉。 */
    popUnit: 2000000,
    perBase: 0.5, perCap: 2.5, perPop: 0.5,
    goldPerIron: 0.5,                 // 1 铁 = 0.5 金，锁死
    /* 统一账目字段（和 WASH 共用一套 UI）：payKey 是"每产一单位要付的东西"，
     * payPer 是单价。SMELT 付金、WASH 付木 —— 面板只读这三个字段，不各写一份。 */
    payKey: 'gold', payPer: 0.5,
    payNote: '金耗 = 产量 × 0.5（省库 → 中央，付不起当回合减半，不欠账）',
    perAt: function (pop) {
      var v = SMELT.perBase + (pop || 0) / SMELT.popUnit * SMELT.perPop;
      return Math.min(SMELT.perCap, v);
    },
    /* 账目一句话：行 title 和 ? 面板共用，只此一份 */
    note: '1 铁 = 0.5 金锁死汇率；真矿约 0.1 金/铁——矿是命脉，这是枯竭后的活路'
  };

  /* 矿"睡了"就能开炉：gone（永久枯竭）或 cool > 0（深层休眠）。
   * 只给 SMELT 用 —— 淘金场**不走这条**（金矿 cool 仍是 0，不会休眠），
   * 它只认 gone。玩家侧（＋钮 / ? 面板 / AI 的 trySmelt）与规则层读同一个函数，
   * 免得"按钮亮了但 check 不过"这种两套判断。 */
  SMELT.dormant = function (s) { return !!s && (!!s.gone || (s.cool | 0) > 0); };

  /* 能不能改建 —— 和 FACTORY.check 同一套写法：＋钮的 title 与真改建读同一份规则。
   * ctx = { bag, smeltN, site }（v18 起**不再收 edu**：门槛已拆） */
  SMELT.check = function (prov, ctx) {
    if (!prov) return { ok: false, why: '没有这个省' };
    var s = ctx && ctx.bag && ctx.bag.iron;
    /* 没有铁矿资源的省：连这一行都没有，自然也开不了炉 */
    if (!s) return { ok: false, why: '本省没有铁矿脉，开不了炉' };
    if (!SMELT.dormant(s)) {
      return { ok: false, why: '矿脉还在产 —— 熔旧坊是休眠/枯竭期的活路，不是矿场的替代' };
    }
    if ((ctx.site | 0) > 0) return { ok: false, why: '还有一座在改建（剩 ' + (ctx.site | 0) + ' 回合）' };
    if ((ctx.smeltN | 0) >= SMELT.maxPer) {
      return { ok: false, why: '每省封顶 ' + SMELT.maxPer + ' 座熔旧坊（已建 ' + (ctx.smeltN | 0) + ' 座）' };
    }
    return { ok: true };
  };
  AO.SMELT = SMELT;

  /* =============================================================
   * 淘金场（WASH）—— 枯竭金矿场的再就业（金的熔旧坊）
   *
   * 金是七种资源里**唯一** cool=0 不可再生的（铁矿 v18 起改为 48 回合深层休眠），
   * 而金又恰好是全游戏唯一的维护货币。
   * 金矿挖完，那一行只剩一个灰 ×N，而省里的维护账单不会跟着停 —— 淘金场是
   * 那条行当的下半辈子：淘旧首饰、砂里澄金，换一条涓流。
   *
   * 和 SMELT **逐条镜像**（同一套 check / build / settle / 存档 / 面板写法）：
   *   · 唯一入口是金矿脉枯竭后的「改建」；没枯不许、封顶 2 座/省、无任何门槛
   *   · 不吃维护（枯竭矿本来就不收）；产量进省库 gold 袋，走 gainStock 吃满仓上限
   *   · 差别只有一处：它吃的是**木材**（淘金要木槽、木簸箕），1 金 = 2 木，
   *     没木就这一回合不出金 —— 不倒扣（账当场结清，不挂欠条）
   * ============================================================= */
  var WASH = {
    key: 'wash', cn: '淘金场', en: 'Gold Washing Camp', build: '淘金场',
    cost: { timber: 10, gold: 12 },   // 改建价：拆井架、搭木槽、收旧首饰
    turns: 2,                         // 改建工期（回合）
    maxPer: 2,                        // 每省封顶 2 座
    /* 每座每回合的金产量 = min(perCap, perBase + 人口/popUnit × perPop)。
     * 人口项同熔旧坊（200 万一档，且**用自己这一个**，不读 GOV.ironUnit），
     * 一座现实里 0.25~0.4 金/回合：
     * 比真金矿（2 金/回合）慢一个量级 —— 矿是命脉，这是枯竭后的活路。 */
    popUnit: 2000000,
    perBase: 0.25, perCap: 1.5, perPop: 0.25,
    timberPerGold: 2,                 // 1 金 = 2 木，锁死
    payKey: 'timber', payPer: 2,
    payNote: '木耗 = 产量 × 2（省库木材，没木当回合不出金，不倒扣）',
    perAt: function (pop) {
      var v = WASH.perBase + (pop || 0) / WASH.popUnit * WASH.perPop;
      return Math.min(WASH.perCap, v);
    },
    note: '1 金 = 2 木；真矿近乎白捡——矿是命脉，这是枯竭后的活路'
  };
  /* 能不能改建 —— 和 SMELT.check 逐条对齐（连文案结构都一样），
   * 只把 iron 换成 gold。**没有教育门槛**：淘金是活命手艺，不问学历。 */
  WASH.check = function (prov, ctx) {
    if (!prov) return { ok: false, why: '没有这个省' };
    var s = ctx && ctx.bag && ctx.bag.gold;
    if (!s) return { ok: false, why: '本省没有金矿脉，淘不了金' };
    if (!s.gone) return { ok: false, why: '矿脉还没枯竭 —— 淘金场是枯竭后的活路，不是矿场的替代' };
    if ((ctx.site | 0) > 0) return { ok: false, why: '还有一座在改建（剩 ' + (ctx.site | 0) + ' 回合）' };
    if ((ctx.washN | 0) >= WASH.maxPer) {
      return { ok: false, why: '每省封顶 ' + WASH.maxPer + ' 座淘金场（已建 ' + (ctx.washN | 0) + ' 座）' };
    }
    return { ok: true };
  };
  AO.WASH = WASH;

  /* 两档教育门槛。key 只给"有建筑要解锁"的两档：
   *   15 factory    —— 军备新建筑「工厂」（工业化：本省军械产能 ×2）
   *   60 university —— 民用第 5 座「大学」
   * v19 删掉了 35 那一档：铸炮厂整条没了（炮线并进军械坊），
   * 所以"累计教育 35 才能浇炮"这道门槛也随之消失 —— 产能面板上没有一条线
   * 是被教育或匠人锁着的（任务书〇·2「中间没有第二把锁」）。 */
  var TIER = [
    { at: 15, key: 'factory', cn: '工厂', desc: '本省军械坊 / 造船厂 产能 ×2（驯马场产出 ×2）' },
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
    /* 民间铁器熔缴（人口铁税）：**每 ironUnit 人**每回合 ironPer2M[档] 铁。
     * v18 追加二：口径从"涓流"提成"常脉" —— ironUnit 与金税同源（10 万人），
     * 于是 13 省小国约 80 万人：常规 8 × 0.2 = 1.6 铁/回合、横征 8 × 0.4 = 3.2
     * （乘民心系数 0.96 后 ≈1.5 / ≈3.1 —— 横征那 −12 的民心压力就是这个代价）。
     * 攒整照旧走 IRONACC、落进省库（不进中央）；系数同金税（官员 / 无官 0.6 / 民心）。
     * 口径修订（原来是"它不构成军备产能"）：税铁现在是**第二脉** —— 矿休眠期
     * （枯竭 / 没铺矿的穷国）靠它保底。但大头仍然不该支撑成建制扩军：
     * 3 铁/回合一炉刀，扩不动，正好。军备主力仍是矿场 + 熔旧坊，
     * 税铁保的是"不饿死"，不是"能扩军"。
     * （字段名 ironPer2M 是历史遗留 —— 现在它读的是 ironUnit，别再按 200 万理解。） */
    ironUnit: 100000,
    ironPer2M: [0.1, 0.2, 0.4],
    happyHit: [0, -4, -12],                   // 税率对幸福度的压力

    /* --- 人才 --- */
    talentPerSchool: 0.5,                     // 每座在校（不停课）每回合人才点
    examCost: 10,                             // 抽一位官员花的人才点
    salary: 1,                                // 官员俸禄（金/回合，省库发；发不起欠着不罚）

    /* --- 官员资历与怨气（v11） ---
     * 派下去的不是一枚棋子，是一个人：干得久会升（rank 0→3），
     * 待得久、民心差、还欠着饷会生怨（griev 0→100）。
     * 两者合起来给一个**连续**的效果倍率（没有死区 —— 怨气 59 和 61 不一样）：
     *   m = (1 + rank × rankFx) × (1 − griev × grievFx)
     * 满资历 +45%，怨气满 −50%，两端相乘就是"能臣"与"怨吏"的差距。
     * 玩家侧与 AI 侧读同一份（tooltip 上显示的就是结算真正乘的那个数）。 */
    rankMax: 3,
    rankFx: 0.15,                             // 每级资历：效果 × (1 + rank×0.15)
    grievFx: 0.005,                           // 每点怨气：效果 × (1 − griev×0.005)
    rankPay: [1, 1.25, 1.5, 2],               // 俸禄倍率（接 owed 欠饷机制）
    rankCn: ['初任', '干吏', '能臣', '柱国'],  // 资历的四个说法（tooltip / 纪要）
    griev: {
      base: 12,                               // 每 base 回合 +1（民心正常时）
      lowHappy: 45,                           // 民心低于它 → 改成每 lowEvery 回合 +1
      lowEvery: 6,
      owedPer: 2,                             // 欠饷：每回合再 +2
      rollEvery: 24,                          // 每 24 回合掷一次去留
      promote: 0.45,                          //   45% 擢升（rank+1，封顶 3）
      idle: 0.45,                             //   45% 无事
      resentAdd: 20,                          //   10% 怨望（griev+20）
      warn: 60,                               // 首次 ≥60 →「怨望」红字 + 纪要一次
      steal: 90,                              // ≥90 → 每回合从省库侵吞 1 金
      reward: 15,                             // 赏赐价（中央金）
      rewardCut: 25                           // 赏赐降多少怨气
    },

    /* --- 省库上解（v18 / D，v18.3 改累进）---
     * 人口税只进省库、中央只出不进，是"中央金饿死"的另一半：省库被 CAP.base
     * 顶死在 150，多收的钱全当满仓损耗掉，而中央连维护费都凑不齐。
     *
     * 三段累进（v18.3：原来只有"过 80 抽 25%"那一段 —— 省库中位只有 18 的世界里，
     * 80 这道死线等于没有，上解这笔账全年不动，中央照样饿）：
     *   ≤ free(30)            免 —— 那是省里的家底，下一刻就要付维护费
     *   free ~ low 的部分     lowRate(10%)  —— 涓流常开：30~79 的省每回合都出一点，
     *                          广而薄，比"等一个富省"稳
     *   > low(80) 的部分      highRate(25%) —— 照旧：肥的省多出
     * 每省每回合至多 cap(3) 金 —— 防大省抽干（它也要开工钱）。
     * **玩家与 AI 同一条**（有意的：玩家和 AI 活在同一个经济里）；
     * 只走金不走铁 —— 铁的家在矿脉和熔旧坊，这条别扩散。
     * 落袋时的 floor 由 REMITACC 攒整（见 11-ui 的 settleRemit）。 */
    remit: { free: 30, low: 80, lowRate: 0.10, highRate: 0.25, cap: 3 },

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
     * 每行「买 N ← X 金」：N = 市场的换金单位数，X = ceil(N × buyMul × 本国 PI)。
     * 比卖价贵得多是**故意的**：世界市场进货是应急口（缺粮、缺铁），
     * 不是一条稳定的套利路径（否则市场就成了印钞机）。
     * v18 追加三：货从世界市场来（供给无限、不扣任何库存），
     * 金从省库出并**沉没** —— 买货从此是通胀阀门，不是搬仓库。 */
    buyMul: 1.5,
    buyLot: function () {
      var n = (AO.MARKET && AO.MARKET.rate) || 5;
      return { n: n, gold: Math.ceil(n * GOV.buyMul) };
    },

    /* --- 省库买铁付维护（v18.4）---
     * 为什么需要这一条：上解把金搬回中央之后，"有金没铁"的省还是只能停产 ——
     * 维护吃的是铁，而铁只从矿脉和熔旧坊来。这一条把世界市场那条口子
     * （玩家点「买货」走的同一条账）接到**维护**上：铁要断了、省库还有金，
     * 就自己去买一手铁（5 单位），金沉没、货从虚空来。
     *
     * 三道闸，缺一不可（少一道就是"印铁机"）：
     *   at          省库铁 < 它才出手 —— 不是囤铁，是续命
     *   keepGold    省库付完价还得剩这么多金（不把开工钱花在买铁上）
     *   lotsPerTurn 每国每回合至多几"手"（1 手 = 5 单位）—— 全国一起缺铁时
     *               也不会一夜之间把铁荒抹平：这是一条涓流，不是一条河
     * 付款走**两段**（和 payMaint 同一条家法）：省库先掏，不够的从中央拨款里划。
     * 没有这一段，最需要续命的穷省反而买不起（停产省里九成省库金不足 5）。
     * usePool=true 可关掉中央那一段（拍板项，默认开）。
     * 价格 = ceil(lot.gold × PI)，和玩家点「买货」同一个价 —— 铁的 PI 越高，
     * 续命越贵，贵到买不起就真的该停产了。**它比熔旧坊贵 8~10 倍**：
     * 应急口不该比"自己炼"划算，否则矿脉和熔旧坊就没意义了。
     * 玩家与 AI 同一条（和上解一样，同一个经济里没有两套规则）。 */
    /* usePool 默认 **关**：让中央拨款也去买铁的话，T100 中央金中位会从 1.0 掉到
     * 0.0（本金攒不住，就变成"左手倒右手"了）。开着它的实测：停产省 153 → 147，
     * 但中央见底 —— 这条线是拍板项，代码通路留着（`usePool: true` 一行可开）。 */
    selfBuy: { at: 2, keepGold: 6, lotsPerTurn: 1, usePool: false },

    /* --- 显示用的人话（别让玩家自己换算 popUnit / ironUnit） ---
     * 金与铁的单位**同源**：两个都走 unitCn，谁改都不会漏掉另一处。
     * v18 追加二之前，rateDesc 里铁那一句是硬编码的"每 200 万人" ——
     * 单位一改就撒谎。从此只认这两个函数。 */
    unitCn: function (u) {
      return (u >= 10000 ? (u / 10000) + ' 万' : String(u)) + '人';
    },
    popCn: function () { return GOV.unitCn(GOV.popUnit); },
    ironCn: function () { return GOV.unitCn(GOV.ironUnit); },
    /* 某一档税率的完整说明 —— 面板 tooltip / 国家卡 / 省卡都从这里取，
     * 免得三处各写一遍、改一个数漏两处。 */
    rateDesc: function (r) {
      return GOV.rateCn[r] + '：每 ' + GOV.popCn() + ' ' + GOV.goldPerUnit[r] +
        ' 金 · 每 ' + GOV.ironCn() + ' ' + GOV.ironPer2M[r] + ' 铁（民间铁器熔缴）' +
        '，民心压力 ' + (GOV.happyHit[r] > 0 ? '+' : '') + GOV.happyHit[r];
    }
  };
  AO.GOV = GOV;

  /* ---------------- 官员词条（抽卡池） ----------------
   * w  权重；fx 进 PMOD(pid)：
   *     taxMul  收税乘数      happyAdd 幸福度加数
   *     turnCut 工期减回合    prodMul  按资源键乘产量
   * rar 稀有度（只影响显示边色 / 头像底色，不影响数值）：
   *     gray 平平无奇 · plain 一技之长 · bad 贪墨（红边）· gold 治世能臣（金边）
   * 权重合计 114.3（七条文官 110 + 四条宰相级 4.3），抽一位就是一次线性扫描 ——
   * 不用建累积表。所以宰相级出现的概率是 4.3 / 114.3 ≈ 3.8%。 */
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
      desc: '税 +25% 且幸福度 +6' },

    /* --- 宰相级（v12）：超稀有，合计 4.3 / 114.3 ≈ 3.8% ---
     * 这四条**既是省官也是宰相候选人**：
     *   · 抽到之后放在省里，就是一位属性不错的官（fx 比同级文官小一号）；
     *   · 只有它们能「拜相」（治理面板「内阁」节，见 AO.CHANCELLOR_LV）。
     * 为什么不给"宰相专用池"：开科取士只有一张池子，抽到谁全靠运气 ——
     * 拜相的机会本身就是一次抽卡，这样"贤相"才值得等。
     * grade 就是宰相等级（1 守成 / 2 干练 / 3 贤相 / 4 权臣）。
     * 权倾朝野没有 happyAdd：它的代价写在 CHANCELLOR_LV[4] 里（偷金/常驻 −3/弹劾），
     * 不重复扣在词条上 —— 否则"当省官"和"当宰相"会各扣一次。 */
    { key: 'ch_keep',  cn: '守成之才', w: 2,   rar: 'gold', grade: 1, isChancellor: true,
      fx: { taxMul: 1.05 }, desc: '守成有余，开创不足（可拜相）' },
    { key: 'ch_able',  cn: '干练能臣', w: 1.2, rar: 'gold', grade: 2, isChancellor: true,
      fx: { taxMul: 1.1 }, desc: '庶务精熟，能替君主分劳（可拜相）' },
    { key: 'ch_great', cn: '一代贤相', w: 0.8, rar: 'gold', grade: 3, isChancellor: true,
      fx: { taxMul: 1.15, happyAdd: 2 }, desc: '经纬之才，可托国政（可拜相）' },
    { key: 'ch_power', cn: '权倾朝野', w: 0.3, rar: 'gold', grade: 4, isChancellor: true,
      fx: { taxMul: 1.25 }, desc: '能臣亦是权臣 —— 用他，得付代价（可拜相）' }
  ];
  AO.TRAITS = TRAITS;
  var TRAIT_BY_KEY = Object.create(null);
  for (var tr = 0; tr < TRAITS.length; tr++) TRAIT_BY_KEY[TRAITS[tr].key] = TRAITS[tr];
  AO.traitOf = function (key) { return TRAIT_BY_KEY[key] || TRAITS[0]; };

  /* ---------------- 宰相（v12）：四级规则 ----------------
   * 玩家自己的"AI 政府"：拜相之后，每回合结算尾由他代劳你还没做的事。
   * 四级不是"数值大小"，而是**权限与代价**的组合（见 DESIGN-AI.md v12）：
   *
   *   grade 1 守成之才  1 动作 · 只会 build+research（tax/officials 开关点了也不生效）· 俸禄 ×1
   *   grade 2 干练能臣  2 动作 · 四项全能 · 降税线 ×0.8（更敢收）· 俸禄 ×2
   *   grade 3 一代贤相  3 动作 · 会看账调税 · 每 10 回合进言 · 幸福 <40 撂挑子 · 俸禄 ×4
   *   grade 4 权倾朝野  3 动作 · **无视权限开关** · 可横征 · 每回合偷 3 金 · 全国幸福 −3
   *                     · 10% 弹劾 · 俸禄 ×1
   *
   * 三条硬边界（和 §2 的资历/怨气互不渗透）：
   *   ① 宰相不进 OFFICIAL 表 —— 所以 §4 的 AI 吏部巡查、怨气、偷金、卸任规则都碰不到他；
   *   ② 他不推玩家的操作：只做"你还没做的"，不撤销、不改你刚设的税率；
   *   ③ 俸禄从**中央**出（他是国家级官员），欠一次就停摆（自动化暂停），补上才复工。 */
  var CHANCELLOR_LV = {
    1: { cn: '守成之才', acts: 1, pay: 1, taxMul: 1,
      perms: { build: 1, research: 1, tax: 0, officials: 0 },
      desc: '每回合 1 个动作，只会盖房与研科技 —— 税率与人事他一概不碰（开关点了也不生效）' },
    2: { cn: '干练能臣', acts: 2, pay: 2, taxMul: 0.8,
      perms: { build: 1, research: 1, tax: 1, officials: 1 },
      desc: '每回合 2 个动作，四项全能；降税线比常人低两成（更敢收，也更晚松手）' },
    3: { cn: '一代贤相', acts: 3, pay: 4, taxMul: 0.8, smartTax: true,
      adviseEvery: 10, strikeHappy: 40, resumeHappy: 45,
      perms: { build: 1, research: 1, tax: 1, officials: 1 },
      desc: '每回合 3 个动作，会看账调税；每 10 回合进言一条；国民幸福度 <40 会撂挑子' },
    4: { cn: '权倾朝野', acts: 3, pay: 1, taxMul: 0.8, ignorePerms: true, forceMax: true,
      grab: 3, happy: -3, impeach: 0.1,
      perms: { build: 1, research: 1, tax: 1, officials: 1 },
      desc: '每回合 3 个动作，**无视你的权限开关**（他自作主张）；可以横征暴敛；' +
        '每回合从国库拿 3 金；全国幸福度 −3；有 10% 概率被谏官弹劾' }
  };
  AO.CHANCELLOR_LV = CHANCELLOR_LV;
  /* 头衔随政体（08b-society 的政体键）。表里没有的政体一律「宰相」。 */
  AO.CH_TITLE = {
    kingdom: '宰相', grandduchy: '宰相', duchy: '宰相',
    empire: '摄政', republic: '副总统', federation: '总理',
    league: '执政官', khanate: '断事官'
  };
  /* 权限开关的四个键（顺序就是「内阁」节里的按钮顺序） */
  AO.CH_PERMS = [
    { key: 'build', cn: '营造' }, { key: 'research', cn: '科研' },
    { key: 'tax', cn: '税赋' }, { key: 'officials', cn: '人事' }
  ];

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
   * 所以这里定义的全是"一条产线、一个兵种、一条词条、一个系数"，
   * 逻辑（走位、会战、占领、投降）一律在 11-ui.js 的 settleWar 里跑。
   *
   * 三条纪律，和资源层一样：
   *   1) **所有数值都是占位**，拍板时只改这一块 + BATTLE；
   *   2) 三坊的**产能是闸**（v17）：每座每回合产几点产能，玩家把点分到产线上。
   *      recipe 是"一炉的料"，out 是"一炉出几件"，吃点（MILL.pt）是"一炉要几点"。
   *      科技只解锁"这条线开不开"，不提高每点产出 —— 想多产只有两条路：
   *      多盖坊，或盖工厂（×2）/ 请匠人（+40%）/ 研「制式装备」（+1 点/座）。
   *   3) 装备键（leather/ironwp/ship_galley…）和七种资源共用 SIM 袋，
   *      只是没有 AO.RESOURCE_BY_KEY，所以产出/维护循环会自动跳过它们，
   *      而 stockOf / payCost 这类按 key 取库存的函数一行都不用改。
   *      **盔/甲/靴是例外**：它们不进 SIM 袋，进国家级的 EQUIP（资产，不是消耗品）。
   * ============================================================= */

  /* ---------------- 材质（工艺的唯一数值产物） ----------------
   * v19 返工（任务书第一节·四句界碑）：**兵器不再是"时代阶梯"**，而是
   *   类型（刀/剑/矛/斧/弓）× 材质（皮/青铜/铁/火器）× 品质（凡/良/上/珍）× 形制。
   * 工艺只卖材质：解锁一条工艺 = 该材质的**全类型**武器自动可造（无逐步解锁），
   * 树上一个兵器名节点都不许出现。三维只来自 类型 × 材质 × 品质 × 词条，
   * 科技不直加任何武器数值（精密/工业那两档"全兵种 +15%"是 CRAFT.eraBonus 的占位）。
   *
   * key    材质键（武库按 '材质|类型|形制|品质' 分格；和资源键同一命名空间）
   * cn     面板/战报写它（「铁 · 刀 · 锋锐（良）」里的第一个字）
   * craft  由哪条工艺解锁（null = 皮革，开局就有）
   * tech   同一件事，装备线（EQUIP.mat）读这个字段 —— 两处同源，别各写一份
   * mul    兵器三维乘数（工艺的唯一数值产物）
   * base   装备（盔/甲/靴）每槽加成的底数
   * recipe 一「队份」（1000 件）的料 = recipe × 2（见 MILL.bladeMul）
   * color  图标与 UI 行色的 token（沿用 v4 那套历史色） */
  var MATERIALS = [
    { key: 'leather', cn: '皮',   craft: null,           tech: null,
      mul: 1.00, base: 0.03, recipe: { horse: 1 },           color: '#a08a6a' },
    { key: 'bronze',  cn: '青铜', craft: 'mil_bronze',    tech: 'mil_bronze',
      mul: 1.15, base: 0.05, recipe: { iron: 1, timber: 1 }, color: '#b08a3c' },
    { key: 'iron',    cn: '铁',   craft: 'mil_iron',      tech: 'mil_iron',
      mul: 1.30, base: 0.08, recipe: { iron: 1, timber: 1 }, color: '#8c949c' },
    { key: 'powder',  cn: '火器', craft: 'mil_matchlock', tech: 'mil_matchlock',
      mul: 1.55, base: 0.12, recipe: { iron: 1, salt: 1 },   color: '#3c5566' }
  ];
  AO.MATERIALS = MATERIALS;
  AO.MAT_ORDER = ['leather', 'bronze', 'iron', 'powder'];
  /* 旧档 / 旧脚本里的"装备代"键 → 材质键（任务书第一节·读档折算，高级覆盖低级）：
   *   ironwp / crossbow → 铁 · matchlock / musket / flintlock / percussion / breech / gw → 火器
   * 不退点数、不丢件数 —— 只是把"代"读成"材质"。 */
  AO.MAT_ALIAS = {
    leather: 'leather', bronze: 'bronze',
    ironwp: 'iron', crossbow: 'iron',
    matchlock: 'powder', musket: 'powder', flintlock: 'powder',
    percussion: 'powder', breech: 'powder', gw: 'powder'
  };
  AO.matKeyOf = function (k) {
    if (AO.MAT_ALIAS[k]) return AO.MAT_ALIAS[k];
    if (k && AO.MIL_ITEM && AO.MIL_ITEM[k] && AO.MIL_ITEM[k].kind === 'weapon') return k;
    return 'leather';
  };

  /* ---------------- 工艺链（v19 返工：科技只卖材质）----------------
   * 树上**六条工艺，仅此而已**（兵器名节点全下树）：
   *   皮革工艺  免科技、开局人人有（树上画成已点亮的根）
   *   青铜 / 铁器 / 火器 / 精密 / 工业 —— 一条比一条贵
   * 解锁内容（写进节点 tooltip，不写进树）：
   *   · 材质：解锁即该材质**全类型武器自动可造**（铁器 = 铁刀/铁剑/铁矛/铁斧/铁弓整排出现）；
   *   · 炮挂材质：投石机=皮革 · 青铜炮=青铜 · 野战炮=铁器 · 重炮=火器；
   *   · 舰挂材质：桨帆=开局 · 盖伦=青铜 · 战列=铁器 · 铁甲舰=工业；
   *   · 精密 / 工业 = 全兵种三维 +15%（各一档，占位）+ 上述高端舰。
   * 精密 / 工业另给**全兵种三维 +15%** 的时代加成（占位，eraBonus）。
   *
   * 读档折算（alias）：已研高级覆盖低级，不退点数 ——
   *   mil_crossbow → mil_iron · mil_musket / mil_flintlock → mil_matchlock ·
   *   mil_breech → mil_percussion。 */
  var CRAFT = {
    order: ['leather', 'mil_bronze', 'mil_iron', 'mil_matchlock', 'mil_percussion', 'mil_gw'],
    cn: {
      leather: '皮革工艺', mil_bronze: '青铜工艺', mil_iron: '铁器工艺',
      mil_matchlock: '火器工艺', mil_percussion: '精密工艺', mil_gw: '工业工艺'
    },
    desc: {
      leather: '材质：皮（×1.00）· 刀/剑/矛/斧/弓全类型可造 · 投石机 · 桨帆船',
      mil_bronze: '材质：青铜（×1.15）· 五类兵器全可造 · 青铜炮 · 盖伦帆船',
      mil_iron: '材质：铁（×1.30）· 五类兵器全可造 · 野战炮 · 风帆战列',
      mil_matchlock: '材质：火器（×1.55）· 五类兵器全可造（弓显示为「铳」）· 重炮',
      mil_percussion: '全兵种三维 +15%（占位）· 兵器材质不升（仍是火器）',
      mil_gw: '全兵种三维 再 +15%（占位）· 铁甲舰'
    },
    /* 树上的节点（皮革是免费的根，不进研究队列） */
    def: {
      /* 青铜挂在皮革下面：皮革是**免费的根**（开局已点亮），所以这条链读起来是
       * 皮革 → 青铜 → 铁器 → … 一条完整的工艺链，而不是"两个并排的根"。 */
      mil_bronze:     { pts: 20, cost: { gold: 5 },  turns: 2, req: 'leather' },
      mil_iron:       { pts: 30, cost: { gold: 6 },  turns: 3, req: 'mil_bronze' },
      mil_matchlock:  { pts: 45, cost: { gold: 8 },  turns: 3, req: 'mil_iron' },
      mil_percussion: { pts: 60, cost: { gold: 10 }, turns: 4, req: 'mil_matchlock' },
      mil_gw:         { pts: 80, cost: { gold: 12 }, turns: 4, req: 'mil_percussion' }
    },
    /* 时代加成：研成这条工艺 → 全兵种三维 ×(1+0.15)，两条都研 = ×1.30（加算） */
    eraBonus: { mil_percussion: 0.15, mil_gw: 0.15 },
    /* 旧科技键 → 新工艺键（读档折算；高级覆盖低级） */
    alias: {
      mil_crossbow: 'mil_iron',
      mil_musket: 'mil_matchlock',
      mil_flintlock: 'mil_matchlock',
      mil_breech: 'mil_percussion'
    }
  };
  AO.CRAFT = CRAFT;
  /* 这条工艺研成了没有（皮革恒为真） */
  AO.craftHave = function (done, key) {
    if (!key) return true;
    if (key === 'leather') return true;
    return !!(done && done[key]);
  };
  /* 工艺键 → 链上的第几档（-1 = 还没有） */
  AO.craftIdx = function (done) {
    var idx = -1, o = CRAFT.order, i;
    for (i = 1; i < o.length; i++) if (done && done[o[i]]) idx = i;
    return idx;
  };
  /* 时代加成（全兵种三维乘数） */
  AO.craftMul = function (done) {
    var m = 1, k;
    for (k in CRAFT.eraBonus) if (done && done[k]) m += CRAFT.eraBonus[k];
    return m;
  };


  /* ---------------- 铸炮枝（4 档）----------------
   * 炮是**另一种装备**，不占兵种档位：炮兵（arms:'art'）征一支要 1 门炮 + 1 把该代武器。
   * 攻城值 6/7/9/12 是本层最大的数 —— 轰击和围城全靠它。
   * 战力只有 1.2~2.4：炮在接触相位很脆（'art' 在会战里接触段战力打 5 折）。 */
  /* v19 返工：炮**挂材质**，不再各自占一个科技节点（树上一个兵器名都不许出现）。 */
  var GUNS = [
    { key: 'catapult',   cn: '投石机', unit: '投石机队', era: '攻城', craft: null,
      recipe: { timber: 2, iron: 1 }, out: 1, pow: 1.2, siege: 6,  range: 1, arms: 'art', color: '#8a7550' },
    { key: 'bronze_gun', cn: '青铜炮', unit: '青铜炮队', era: '攻城', craft: 'mil_bronze',
      recipe: { iron: 2, salt: 1 }, out: 1, pow: 1.6, siege: 7,  range: 2, arms: 'art', color: '#a8893c' },
    { key: 'field_gun',  cn: '野战炮', unit: '野战炮队', era: '攻城', craft: 'mil_iron',
      recipe: { iron: 2, salt: 2 }, out: 1, pow: 2.0, siege: 9,  range: 3, arms: 'art', color: '#7b6a52' },
    { key: 'heavy_gun',  cn: '重炮',   unit: '重炮营',   era: '攻城', craft: 'mil_matchlock',
      recipe: { iron: 3, salt: 2 }, out: 1, pow: 2.4, siege: 12, range: 4, arms: 'art', color: '#5c5a56' }
  ];

  /* ---------------- 舰种（4 档，并轨解锁）----------------
   * 简化版海军：**没有独立海图**。沿海省两两质心距离 < SEA.D 就算通航，
   * 舰队在"海路"上跑，一格 = 一个沿海省，一回合航程。
   * 舰种战力代替兵种战力，海上会战无地形。 */
  /* v19 返工：舰也**挂材质**（桨帆开局 · 盖伦青铜 · 战列铁器 · 铁甲舰工业）。 */
  var SHIPS = [
    { key: 'galley',  cn: '桨帆船',   era: '桨帆', craft: null,
      recipe: { timber: 2 }, out: 1, pow: 1.4, cap: 1000, color: '#6b7f8c' },
    { key: 'galleon', cn: '盖伦帆船', era: '盖伦', craft: 'mil_bronze',
      recipe: { timber: 2, iron: 1 }, out: 1, pow: 2.0, cap: 1000, color: '#7a6a55' },
    { key: 'ship74',  cn: '风帆战列', era: '战列', craft: 'mil_iron',
      recipe: { timber: 2, iron: 1 }, out: 1, pow: 2.8, cap: 1000, color: '#5e6a58' },
    { key: 'ironclad',cn: '铁甲舰',   era: '铁甲', craft: 'mil_gw',
      recipe: { iron: 3, timber: 1 }, out: 1, pow: 4.0, cap: 1000, color: '#4c5a63' }
  ];

  /* ---------------- 装备厂（4 种，状态照 UNIV 懒建） ----------------
   * 和学校/市场/建造坊共用同一套 UNIV 结构（n / site / halted / mAcc），
   * 所以维护、工地推进、完工、冲刺全靠原来那三处循环，一行新代码都不用加。
   * 差异只在两处：**建厂条件**（need）和**每回合的产能**（三个产能池）。
   *
   * v19：**铸炮厂整条删掉**（任务书第三节）—— 四条炮线并进军械坊，
   * 产能不涨（军械坊仍 2 点/座），炮与兵刃装备抢同一口锅。
   * 所以"累计教育 35"那道门槛也没了（TIER 只剩 15 / 60）。
   *
   * need 是"这个省得先有什么"：
   *   iron   该省已建铁矿场（bag.iron.built > 0）
   *   horse  该省已建牧场
   *   coast  沿海 + 缓岸（复用渔港那套 coastDirs / coastSteep）
   *   tier   全国累计教育 ≥ D.needTier（工厂 15 / 大学 60）
   * 军械坊的产能**不随科技涨** —— 科技只解锁"这一代装备能不能造"（见 CRAFT）。
   * 唯一能把产能翻倍的是**工厂**（15 档）。 */
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
      desc: '产能中心：每座 2 点/回合，供兵刃五类型 / 盔甲靴三线 / 炮四线共 12 条线',
      turnsAt: function () { return 2; }
    },
    stable: {
      key: 'stable', cn: '驯马场', en: 'Stable', build: '驯马场',
      cost: { timber: 12, grain: 8, gold: 5 }, maint: { iron: 0.2, gold: 0.3 },
      need: 'horse', needCn: '需本省已建牧场',
      desc: '产能中心：每座 1 点/回合，供马厩池（四个品种）',
      per: 1, turnsAt: function () { return 2; }
    },
    shipyard: {
      key: 'shipyard', cn: '造船厂', en: 'Shipyard', build: '造船厂',
      cost: { timber: 20, iron: 6, gold: 8 }, maint: { iron: 0.4, gold: 0.4 },
      need: 'coast', needCn: '需沿海且缓岸',
      desc: '产能中心：每座 1 点/回合；桨帆 1 点 · 盖伦 2 · 战列 3 · 铁甲 4',
      turnsAt: function () { return 3; }
    },
    /* 工厂（第三批·15 档「工厂」）：不限省份，只认累计教育。
     * 效果是**本省**的军械产能 ×2（军械坊 / 驯马场 / 造船厂），
     * 而且是"产能翻倍、料不变" —— 工业化解放的是产能，不是原料。
     * 维护略高于普通厂：它养的是整条产线，不是一块工地。 */
    factory: {
      key: 'factory', cn: '工厂', en: 'Factory', build: '工厂',
      cost: { timber: 20, iron: 8, gold: 14 }, maint: { iron: 0.4, gold: 0.5 },
      need: null, needCn: '不限省份 · 需累计教育 ≥ 15',
      needTier: 15, prodMul: 2,
      desc: '工业化：本省军械坊 / 造船厂 的**产能点数 ×2**（驯马场产出也 ×2）',
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

  /* =============================================================
   * 军工产线（MILL v19）—— **全国口径的三个产能池 + 19 条产线 + 订单制**
   *
   * v17 的产线是"每省一坊、点数分到线上"；v19 把口径抬到**全国**：
   * 玩家在一张面板上看到三个池（军械 / 马厩 / 船坞）和 19 条线，
   * 点数怎么分是全国一个决定 —— 不用再逐省找坊、逐省调。
   *
   * 四条纪律：
   *   1) **科技只管"有哪一代"**（CRAFT），产能管"造多少、造什么款式"，
   *      产线 / 形制 / 品种一律没有解锁条件 —— 中间没有第二把锁；
   *   2) **工匠是加成者不是钥匙**：产能加成按本省驻场算，品质 roll 看全国最高那一位；
   *   3) **订单制**：每线一次一单，每回合**至多完成 1 单**；
   *      回合数 = ⌈工作量 ÷ 分配产能⌉，进度逐回合攒；缺料卡在 100% 等料；
   *   4) **溢出无效**：分给某线的点数超过工作量就进不去（滑条 / ＋钮到工作量即封顶），
   *      多余的点留在池里铺别的线。
   * ============================================================= */
  var MILL = {
    /* 三个产能池：坊键 → 池键。池容量 = Σ每省(座数 × base × 工厂×2 × (1+匠人)) */
    poolOf: { armory: 'arm', stable: 'hor', shipyard: 'syd' },
    poolCn: { arm: '军械', hor: '马厩', syd: '船坞' },
    poolBld: { arm: 'armory', hor: 'stable', syd: 'shipyard' },
    /* 每座每回合的产能点数 */
    base: { armory: 2, stable: 1, shipyard: 1 },
    /* 20 条线（三段分组，任务书第四节）：
     *   军械池 12 条 = 兵刃五类型（刀/剑/矛/斧/弓）+ 盔/甲/靴 + 炮四线；
     *   马厩池  4 条 = 马四品种；
     *   船坞池  4 条 = 舰四线。 */
    lines: {
      arm: ['dao', 'jian', 'qiang', 'fu', 'gong', 'helm', 'chest', 'boots',
        'catapult', 'bronze_gun', 'field_gun', 'heavy_gun'],
      hor: ['nag', 'steppe', 'dayuan', 'barded'],
      syd: ['galley', 'galleon', 'ship74', 'ironclad']
    },
    /* 线的类别（决定单量、料、出产去向） */
    kindOf: {
      dao: 'blade', jian: 'blade', qiang: 'blade', fu: 'blade', gong: 'blade',
      helm: 'equip', chest: 'equip', boots: 'equip',
      catapult: 'gun', bronze_gun: 'gun', field_gun: 'gun', heavy_gun: 'gun',
      nag: 'mount', steppe: 'mount', dayuan: 'mount', barded: 'mount',
      galley: 'ship', galleon: 'ship', ship74: 'ship', ironclad: 'ship'
    },
    lineCn: {
      dao: '刀', jian: '剑', qiang: '矛', fu: '斧', gong: '弓',
      helm: '盔', chest: '甲', boots: '靴',
      catapult: '投石机', bronze_gun: '青铜炮', field_gun: '野战炮', heavy_gun: '重炮',
      nag: '驽马', steppe: '草原马', dayuan: '大宛马', barded: '具装马',
      galley: '桨帆船', galleon: '盖伦帆船', ship74: '风帆战列', ironclad: '铁甲舰'
    },
    kindCn: { blade: '兵刃', equip: '装备', gun: '炮', mount: '马', ship: '舰' },
    /* 工作量（点/单）。兵刃 / 装备 / 马 都是 5 点 = 1 回合 1 单（5 点产能时）；
     * 炮 2 点一门；舰 1/2/3/4 点一艘（大舰慢，取舍就在这）。 */
    work: {
      dao: 5, jian: 5, qiang: 5, fu: 5, gong: 5,
      helm: 5, chest: 5, boots: 5,
      catapult: 2, bronze_gun: 2, field_gun: 2, heavy_gun: 2,
      nag: 5, steppe: 5, dayuan: 5, barded: 5,
      galley: 1, galleon: 2, ship74: 3, ironclad: 4
    },
    /* 单量：队份 = 武装一个千人队（UI 写 ×1000，内部记 1 份） */
    batch: { blade: 1000, equip: 1000, mount: 1000, gun: 1, ship: 1 },
    /* 料（每单）：兵刃 = 该代 recipe × bladeMul；装备 铁 4；马 粮 2；炮/舰 照旧 recipe */
    bladeMul: 2,
    equipRecipe: { iron: 4 },
    mountRecipe: { grain: 2 },
    /* 「制式装备」：军械坊每座 +1 点 */
    stdBonus: { armory: 1 },
    /* 「量产工艺」：兵刃线工作量 5 → 4（不是产出 ×1.5 了 —— 订单制下"更快"才是收益） */
    massWork: 4,
    /* 每国每回合至多完成几单/线（任务书：至多 1 单） */
    maxOrderPerLine: 1
  };
  AO.MILL = MILL;

  /* ---------------- 词条（GEAR）：类型 / 形制 / 品种 / 品质 ----------------
   * 全部是**占位**，且**没有解锁条件**（任务书〇·2）：教育 0、没有匠人也能选锋锐、
   * 也能养具装马、也能开炮线 —— 匠人只决定品质与产能，不决定"能不能"。
   *
   * 数值口径（v19 返工）：**类型是三维的基准值**（绝对数），
   * 形制/品种是**百分比与档位**（+25 = ×1.25，mov+1 = 快一档）。
   *   类型：刀 1.00/0.80/2 ／ 剑 1.05/0.90/2 ／ 矛 1.10/0.70/2 ／
   *         斧 1.20/0.60/1 ／ 弓 0.80/0.60/2 + 射程 1（火器材质下显示「铳」、射程 +1）
   *   形制：平平无奇 ／ 重装 def+30 mov−1 ／ 疾行 mov+1 atk−10 ／ 锋锐 atk+25 def−15
   *   品种：驽马 ／ 草原马 mov+1 def−15 ／ 大宛马 atk+15 def−5 ／ 具装马 def+30 mov−1 */
  var GEAR = {
    types: [
      { key: 'dao',   cn: '刀', atk: 1.00, def: 0.80, mov: 2, range: 0 },
      { key: 'jian',  cn: '剑', atk: 1.05, def: 0.90, mov: 2, range: 0 },
      { key: 'qiang', cn: '矛', atk: 1.10, def: 0.70, mov: 2, range: 0 },
      { key: 'fu',    cn: '斧', atk: 1.20, def: 0.60, mov: 1, range: 0 },
      { key: 'gong',  cn: '弓', atk: 0.80, def: 0.60, mov: 2, range: 1 }
    ],
    forms: [
      { key: 'plain', cn: '平平无奇', atk: 0,   def: 0,   mov: 0 },
      { key: 'heavy', cn: '重装',     atk: 0,   def: 30,  mov: -1 },
      { key: 'swift', cn: '疾行',     atk: -10, def: 0,   mov: 1 },
      { key: 'keen',  cn: '锋锐',     atk: 25,  def: -15, mov: 0 }
    ],
    breeds: [
      { key: 'nag',    cn: '驽马',   atk: 0,   def: 0,   mov: 0 },
      { key: 'steppe', cn: '草原马', atk: 0,   def: -15, mov: 1 },
      { key: 'dayuan', cn: '大宛马', atk: 15,  def: -5,  mov: 0 },
      { key: 'barded', cn: '具装马', atk: 0,   def: 30,  mov: -1 }
    ],
    /* 品质四档：整队同品质（一单 roll 一次）。qMul 直接乘三维的 atk/def。 */
    q: ['plain', 'good', 'fine', 'rare'],
    qCn: { plain: '凡', good: '良', fine: '上', rare: '珍' },
    qLong: { plain: '凡品', good: '良工', fine: '上品', rare: '珍品' },
    /* 品质倍率（任务书第二节·3）：凡 1.0 / 良 1.2 / 上 1.5 / 珍 2.0。
     * 「珍」只有宗师出得来（rollQuality 读全国最高匠人）。 */
    qMul: { plain: 1.0, good: 1.2, fine: 1.5, rare: 2.0 },
    /* 裸兵：没有武器时的一支千人队（能守不能攻） */
    bare: { atk: 0.5, def: 0.5, mov: 2, range: 0, siege: 0 }
  };
  AO.GEAR = GEAR;
  AO.gearOf = function (list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0];
  };

  /* ---------------- 装备（EQUIP）：盔 / 甲 / 靴 三槽 ----------------
   * 和武器**不是一回事**：武器是消耗品（征兵吃掉一件少一件），
   * 装备是**资产**（打造一次，永久叠在那支部队身上）——所以它单独一张表：
   *   EQUIP[owner][slot] = { plain, good, fine, rare }   件数，按品质分四档
   *
   * **材质不进库存**：一件盔的加成 = 打造时国家的最高材质 × 它的品质倍率。
   * 为什么不按件记材质：库存就四个数，再加一维材质会变成
   * "皮盔 3 件 / 铁盔 1 件"——面板读不完，玩家也算不清；
   * 代价是"老材质的存货"必须有个出口，于是有了换代回收（见 recycle）：
   * 新材料一研成，旧库存折半回炉，**库存永远只有一代**。
   *
   * 加成是**加算**的：战力 ×(1 + Σ(材质底 × 品质倍))，攻防同乘。
   * 三槽全珍品、火器材质 = 1 + 3 × (0.12 × 2) = 1.72 —— 这是这一层的天花板。 */
  var EQUIP = {
    slots: ['helm', 'chest', 'boots'],
    slotCn: { helm: '盔', chest: '甲', boots: '靴' },
    /* 品质四档（顺序就是库存里的字段顺序） */
    q: ['plain', 'good', 'fine', 'rare'],
    qCn: { plain: '凡', good: '良', fine: '上', rare: '珍' },
    qLong: { plain: '平凡', good: '良工', fine: '上品', rare: '珍品' },
    qMul: { plain: 1.0, good: 1.2, fine: 1.5, rare: 2.0 },
    /* 面板小芯片的边色（和词条稀有度用同一套说法，玩家不用再学一遍） */
    qRar: { plain: 'gray', good: 'plain', fine: 'gold', rare: 'gold' },
    /* 材质台阶：**和兵器共用同一张表**（MATERIALS）——
     * 武器读它的 mul，装备读它的 base，解锁条件都是 craft/tech。
     * 皮 3% 是开局就有的，青铜/铁/火器各挂在一条工艺上。 */
    mat: MATERIALS,
    /* 换代回收：每件旧装备折半成材料（一半留、一半进炉）。
     * 折的是**件数的一半**（向下取整），返还 0.5 铁/件 —— 补偿"换代那一下的沉没"，
     * 但不至于让玩家靠"存旧货换代"套利。 */
    recycle: { iron: 0.5 },
    /* 军队覆没：随军装备全部损毁，胜者不缴获（v1 拍板） */
    destroyOnDeath: true
  };
  AO.EQUIP = EQUIP;

  /* ---------------- 工匠（ARTISAN）：装备线的钥匙 ----------------
   * 文科抽官、武科抽将，工科抽匠 —— 第三张池子，共用同一份人才点。
   *
   * 匠人做两件事（这就是"工科"的全部价值）：
   *   ① **钥匙**：一省没匠人驻场，这个省的装备三线（盔/甲/靴）直接锁死。
   *      理由：武器是"照模子打"，装备是"看手艺人"——没有师傅，打出来的东西
   *      不该有品质可言，而装备这一层的全部乐趣就在品质 roll 上。
   *   ② **品质与产能**：等级越高，品质表越往上移（珍品只有宗师出得来），
   *      同省三坊共享 +0/10/20/40% 产能。
   *
   * 代价是俸禄（金/回合，按等级）。匠人不进 OFFICIAL 表 —— 他不治民，
   * 所以资历/怨气/偷金那一整套（v11 吏部）碰不到他，也就没有"匠人贪墨"。
   * 一省一匠：和"一省一官"同一个口径，换人即回池（免费）。 */
  var ARTISAN = {
    lv: [
      { key: 'apprentice', cn: '学徒', w: 50, bonus: 0,    pay: 0.5, roll: 0,
        desc: '能打，但都是寻常货色' },
      { key: 'hand',       cn: '巧手', w: 30, bonus: 0.10, pay: 1,   roll: 1,
        desc: '产能 +10%，良品多了' },
      { key: 'master',     cn: '名师', w: 15, bonus: 0.20, pay: 2,   roll: 2,
        desc: '产能 +20%，上品是常态' },
      { key: 'grand',      cn: '宗师', w: 5,  bonus: 0.40, pay: 4,   roll: 3,
        desc: '产能 +40%，且只有他能出珍品' }
    ],
    /* 品质 roll 表（凡/良/上/珍，权重合计 100）。
     * 任务书给的"基础 60/25/12/3"是纸面基准（base），实际掷的是这张分级表：
     * 等级越高整条表往上移，**珍品只有宗师那一档有份额**（前三档的珍品份额
     * 让给良/上）。「淬火工艺」科技 = 整张表再上移一档（见 rollIdx）。 */
    base: [60, 25, 12, 3],
    roll: [
      [72, 24, 4, 0],    // 学徒
      [55, 32, 13, 0],   // 巧手
      [35, 40, 25, 0],   // 名师
      [15, 30, 35, 20]   // 宗师
    ],
    /* 取名：和官员/将领同一套姓名字库（同国里不会出现两个"王守仁"） */
    examCost: null,      // null = 和文科同价（读 GOV.examCost，改一处就够）
    /* AI 开科的时机：累计教育 ≥ edu + 有军械坊（拍板⑥） */
    aiEdu: 15
  };
  AO.ARTISAN = ARTISAN;

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
   *   personaGov   政体 → 性格权重的乘数（王室偏军国、商民偏经营）
   *   quirk        个体怪癖系数的范围（buildBias / taxBias / researchBias / warBias）
   *   buildJitter  buildBias 对建造表项的挪格幅度（底色不变，顺序各国略有差异）
   *   researchPick 研究时从"最便宜的几条"里按 researchBias 加权掷
   *   buildOrder   三种性格的建造优先级（kind 用的是 UNIV / RESOURCES 的键；
   *                **不含 smelt** —— 改建走 aiConvert 的快速通道，不占建造格）
   *   actPerTurn   每国每回合最多几个动作
   *   buildPerTurn 其中"建造"最多几座 —— 不加这道闸，一回合两座能把国库抽干
   *   goldReserve  建之前中央金必须 ≥ cost.gold + 它（防抽干国库）
   *   buildGate    中央金 < 它 → 本回合**整条建造都不动**（只攒钱不盖房，v18.3）
   *   convertPad   改建（熔旧坊 / 淘金场）额外要多留的金 —— 走独立通道也得让开预算
   *   schoolQuotaDiv 经营：全国学校 < 省数 / 它 才继续盖（扫盲，不是每省一座）
   *   tax*         调税阈值（经营/均衡降档 45、升回常规 80；军国 30 / 35）——
   *                所有**金钱阈值**再 × 该国的 taxBias（手松的加税晚、手紧的加税早）
   *   examMul      人才点 ≥ examCost × 它 才开科（和玩家同价，只是更谨慎）
   *   graft*       贪墨官上任几回合内、多大几率被 AI 自己撤换 */
  var AIECON = {
    personas: [
      { key: 'econ',     cn: '经营', w: 30 },
      { key: 'balanced', cn: '均衡', w: 50 },
      { key: 'mil',      cn: '军国', w: 20 }
    ],
    /* --- 政体修正：乘在上面那三个基础权重上 ---
     * key 用 08b-society 的政体键（GOV 表）：王室一侧（kingdom/empire/grandduchy/
     * duchy）偏军功，汗国最极端；商民一侧（republic/federation/league）偏经营。
     * 表里没写的政体按 1 倍（= 不动）。这样"军事政体显著更常出军国人格"
     * 是**生成规则**保证的，不是碰运气。 */
    personaGov: {
      kingdom:    { mil: 1.9, econ: 0.65, balanced: 1.00 },
      empire:     { mil: 2.2, econ: 0.55, balanced: 0.95 },
      grandduchy: { mil: 1.8, econ: 0.75, balanced: 1.00 },
      duchy:      { mil: 1.7, econ: 0.85, balanced: 1.00 },
      khanate:    { mil: 2.6, econ: 0.45, balanced: 0.80 },
      republic:   { mil: 0.45, econ: 2.10, balanced: 1.10 },
      federation: { mil: 0.45, econ: 2.00, balanced: 1.10 },
      league:     { mil: 0.55, econ: 2.20, balanced: 1.00 }
    },
    /* --- 个体怪癖：每国再掷三个 0.8~1.2 的系数 ---
     *   buildBias    建设狂热：只用来给建造优先级表做"轻微重排"（底色不变）
     *   taxBias      手紧/手松：所有**金钱阈值** × 它（>1 = 手松、加税晚）
     *   researchBias 科研偏执：取最便宜的两条时，贵的那条权重 = 它（>1 = 硬啃贵的）
     * 另掷一个 warBias（下一批 AI 互战的宣战激进值）—— 本批**只存不用**。 */
    quirk: { lo: 0.8, hi: 1.2, n: 3 },
    /* buildBias 对建造表项的**挪格幅度**：偏移 = (buildBias − 1) × 它（格）。
     * 6 → 极端国家（1.2）挪 1.2 格：够让同性格的两国换位，不够把底色翻过来。 */
    buildJitter: 6,
    researchPick: 2,         // 研究：从最便宜的几条里掷（任务书：两条）
    /* 熔旧坊 / 淘金场**不在表里**（v18.1b 改建快速通道）：改建不是"盖一座新建筑"，
     * 它不占地、不吃建造格 —— 走 18-ai 的 aiConvert，每回合独立结算 1 座。
     * 以前它们排在表尾（经营甚至排最后），而前面是"每省一座市场 / 三座粮仓"
     * 这种无底清单，于是改建永远排不上，矿睡了就只能干等 48 回合。 */
    buildOrder: {
      /* 经营：先扫盲（学校）→ 换金口（市场）→ 冲工期（建造坊）→ 存粮（粮仓）
       *       → 大学（教育 ≥ 60）→ 工厂（教育 ≥ 15，挑已有军械坊的省）
       *       → 军械坊。 */
      econ:     ['school', 'market', 'builder', 'granary', 'university', 'factory',
                 'armory'],
      /* 均衡：学校 → 市场 → 建造坊 → 兵营（交战中优先）→ 工厂 → 军械坊。 */
      balanced: ['school', 'market', 'builder', 'barracks', 'factory', 'armory'],
      /* 军国：兵营 → 军械坊 → 工厂 → 学校 → 市场。税重兵多，科研垫底。 */
      mil:      ['barracks', 'armory', 'factory', 'school', 'market']
    },
    actPerTurn: 2,
    buildPerTurn: 1,
    /* 建之前中央金必须 ≥ cost.gold + 它（防抽干国库）。v18.3：5 → 15 ——
     * 5 金垫在账上不够一次维护，建完就把下一回合的维护费花掉了。 */
    goldReserve: 15,
    /* 存钱闸（v18.3）：中央金 < 它 → 本回合**整条建造都不动**（只攒钱不盖房）。
     * 治的是"有钱就花、中央永见底"：真穷的时候，goldReserve 那道闸会被
     * "便宜的建筑"逐个绕过（学校 6 金 + 15 = 21 就能过），于是国库在 20 上下
     * 反复被打穿。这道闸不看成本，只看存量 —— 攒过 10 自动恢复，不是永久停。 */
    buildGate: 10,
    /* 改建（熔旧坊 / 淘金场）额外要多留的金（v18.1b）：改建走独立通道、不占建造格，
     * 但它花的是**同一个国库** —— 只按 goldReserve 放行的话，改建会把下一回合
     * 学校 / 市场的预算吃光，那就成了"换个位置挤建造"。所以它要留得更宽：
     * 门槛 = cost.gold + goldReserve + convertPad。 */
    convertPad: 30,
    schoolQuotaDiv: 3,
    taxDownHappy: 45,
    taxUpGold: 80,
    milTaxGold: 30,
    milTaxHappy: 35,
    examMul: 1.5,
    graftTurns: 3,
    graftChance: 0.3,

    /* --- 军工产线策略（v17，占位） ---
     * AI 不玩"精确分配"：它只有两套档位 —— 交战（兵刃 7 : 装备 3）与和平（装备 6 : 兵刃 4）。
     * 理由：这一点产能对 AI 只是"别空转"，难的是玩家侧的取舍；AI 侧真要玩混编，
     * 面板上一堆小国会在纪要和战报里制造噪音（AI 不玩混编也是拍板⑤的原话）。
     *   equipSplit  装备那 30%/60% 怎么分到盔/甲/靴（甲最贵，权重最高）
     *   shipPeace   和平期要不要开造船线（false = 归零，点全让给军械坊）
     *   shipOnly    AI 只造"当前最高解锁档"，不铺低档船
     *
     * v18（C）加两道**库存闸**（和平期不再白烧铁）：
     *   equipNeedPerArmy  军队数 × 它 − 全国装备库存(EQUIPS 三槽合计) ≤ 0
     *                     → 装备线归零，点全让给兵刃
     *   wpnStockCap       当前最优武器的全国库存 ≥ 它 → 兵刃线也归零
     * 两闸都关 → 该坊产线全零（坊空转、不扣料、不占动作）。
     * **战时同样生效**：攒够了就不烧，和打不打仗无关。 */
    mill: {
      warWpn: 0.7, warEquip: 0.3,
      peaceWpn: 0.4, peaceEquip: 0.6,
      equipSplit: { helm: 0.4, chest: 0.35, boots: 0.25 },
      shipPeace: false,
      shipOnly: true,
      equipNeedPerArmy: 3,
      wpnStockCap: 30
    },

    /* --- 卖货（v18 / B）：市场 5:1 终于对 AI 开门 ---
     * 每国每回合最多 sellLots 手（1 手 = MARKET.rate 单位 → PI 金进省库）；
     * 每省每回合至多 1 手。安全线（库存超过才卖）：
     *   粮 / 鱼  > 人口口粮 × foodMul + foodAdd   （先保全国吃饱）
     *   马       > horse
     *   其余     > other（铁也走这一档：攒过 40 才会卖，见下）
     * 卖键里**含 iron**（拍板改口：铁也可以交易）—— 铁是维护货币，攒过安全线
     * 的余量换成金，总比满仓损耗掉强；缺铁时它照旧去开矿 / 买货。 */
    sellLots: 2,
    sellSafe: { foodMul: 4, foodAdd: 30, horse: 20, other: 40 },

    /* --- 缺矿反应（v18 / E）：对稀缺有反应，活得像人 ---
     * 全国库存（中央 + 各省，stockTotal）低于 at[key] → 在"left 达线且这一种
     * 一座都没盖"的省开一座矿。铁金都缺时先开 (库存/at) 比值小的那种。 */
    mineOpen: {
      at: { iron: 40, gold: 30 },
      left: { iron: 25, gold: 15 }
    },

    /* --- 吏部巡查（v11）：AI 对自家官员的赏 / 撤 ---
     * 一个官不是派下去就不管了：怨气涨上来要么给钱（赏赐），要么换人（撤换）。
     * 三条线都按资历分档 —— 资历越高越值钱，也越难伺候：
     *   rewardByRank  怨气到这条线就赏（rank0 永不赏：新手还没攒够本钱）
     *   fireByRank    怨气到这条线就撤（越老的官越给它机会）
     *   personaAdj    性格修正线值：经营心软（−10，早赏）、军国心硬（+10，晚赏）
     * 赏赐花的是**中央金**（和玩家点「赏」同一个函数），撤换之后从候选池补人。 */
    gov: {
      rewardByRank: [null, 50, 50, 45],      // rank0 永不赏
      fireByRank: [70, 80, 80, 90],
      personaAdj: { econ: -10, balanced: 0, mil: 10 },
      rewardCd: 12,                          // 同一位官 12 回合内不重复赏
      minCentral: 30,                        // 中央金 < 它就不赏（国库比面子要紧）
      warMinRank: 2                          // 战时赏赐只保 rank ≥ 2
    }
  };
  AO.AIECON = AIECON;

  /* ---------------- 怪癖文案（性格可见用） ----------------
   * 三档情报各显示什么：
   *   0 档  "？？"（连性格都不给）
   *   1 档  只给性格词（经营 / 均衡 / 军国）
   *   2 档  性格 + **主导怪癖**（偏得最狠的那一项）→ "军国 · 苛税"
   * 文案集中在这里，18-ai 只负责挑"哪一项偏得最狠"，不写文案。
   *   hi = 系数偏大那一侧的说法，lo = 偏小那一侧 */
  var PERSONA_TXT = {
    build: {
      hi: '营造狂', lo: '惜工',
      hiD: '见省就盖，中央的钱留不住', loD: '能凑合就凑合，工地开得少'
    },
    tax: {
      hi: '手松', lo: '苛税',
      hiD: '宁可省着花也不加税', loD: '缺钱就加税，先保住国库'
    },
    research: {
      hi: '好高骛远', lo: '急用先学',
      hiD: '专挑贵的硬啃', loD: '捡便宜的，快点毕业'
    },
    /* 情报不足时那一行 */
    unknown: '？？'
  };
  AO.PERSONA_TXT = PERSONA_TXT;

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
    seaD: 0.055,             // 海路阈值 = 世界长边 × 这个系数（占位）

    /* ---- 三维（v19）：def 减伤 / mov 三用 ----
     * 守方减伤 = (def守 / def攻)^0.5，封顶 defMitCap。
     * 为什么开方：三维是 1.0~2.0 的量级，不开方的话"铁器打皮甲"一刀就是 2 倍，
     * 兵种差异会盖过兵数与地形；开方之后 2 倍防御 = 1.41 倍减伤，是"明显更强"而不是"无敌"。
     * 封顶 1.3 的理由同上：再高的防御只值 30%。 */
    defMitExp: 0.5,
    defMitCap: 1.30,
    /* mov：快档（≥3）一回合行军 2 省 */
    fastMove: 3,
    fastMoveHops: 2,
    /* mov：先手 —— 机动差每高一档，射击相位 +5%（封顶 ±15%） */
    initPerStep: 0.05,
    initCap: 0.15,
    /* mov：败方每低一档被追击多损 5% */
    pursuePerStep: 0.05
  };
  AO.BATTLE = BATTLE;

  /* ---------------- 不安与叛乱（A 批） ----------------
   * 这一块只回答一个问题：**民心长期塌下去之后会怎样**。
   * 民心（GOV.happyLerp）是"这一省过得舒不舒服"，不安（UNREST）是
   * "这一省还想不想跟你过" —— 两件事分开存，因为它们的记忆长度不同：
   * 民心每回合向目标靠 30%（今天缺粮明天就回），不安只涨不降（怨是攒出来的）。
   *
   * 六个驱动项各管一件事，全部可解释、全部进 drivers 供悬停明细：
   *   基线   民心塌到 45 以下才开始积（45 是"及格线"，不是 60：
   *          60 是基准，常年 55~60 的省不该有不安）
   *   停产   三类以上建筑停产 → 城里没活干（+10）
   *   未整合 打下来还没消化（+15，见 INTEG）
   *   异信仰 强制改宗压着异教徒（+8，和 settleHappy 的 faith 段同源）
   *   贪墨   贪官在任，税进了私囊（+6）
   *   匪患   上一场匪乱没平（+10，事件和不安互喂）
   *
   * **数值为什么不是 0.3**：任务书写的是 `max(0,45−民心)×0.3`，
   * 但 0.3 的斜率让爆发线（80）在算术上不可达 —— 民心 0 时基线只有 13.5，
   * 六项全拉满（10+15+8+6+10=49）也才 62.5，那一整条叛乱链永远不会触发。
   * 所以斜率按"**民心 30 单独就能到 81**"反解成 5.4，曲线是：
   *   民心 45→0 · 40→27 · 35→54 · 30→81 · 25→100
   * 读法：民心 45 以上不安恒 0；40 上下开始"骚动"（≥40 黄）；塌到 30
   * 就够自己炸（再加上停产/异信仰/贪墨只会更早）。
   * 正常省（民心 50~65）恒 0，只有真塌下去才会炸 —— 正是"长期崩溃"。
   *
   * **所有数值都是占位**：拍板只改这一块。 */
  var UNREST = {
    max: 100,
    gapFrom: 45,             // 民心低于它开始积不安
    gapMul: 5.4,             // 每低 1 点民心积多少不安（见上面的反解说明）
    haltN: 3, haltAdd: 10,   // 三类以上建筑停产 → +10
    occupyAdd: 15,           // 未整合省 → +15
    faithAdd: 8,             // 异信仰且政策强制 → +8
    graftAdd: 6,             // 贪墨官在任 → +6
    banditAdd: 10,           // 匪患未平 → +10
    /* 回落：民心 ≥ 55 时目标 −5/回合（其余情况目标只升不降 ——
     * 于是"曾经闹过"的省不会自己好透，得靠安抚或民心真的回上去） */
    calmHappy: 55, calmFall: 5,
    lerp: 0.35,              // 每回合向目标靠 35%（不跳变）
    revoltAt: 80,            // 爆发线
    revoltChance: 0.15,      // 每回合 15%
    /* 爆发结果的权重：60% 匪乱 / 30% 倒戈 / 10% 独立。
     * 有驻军时倒戈与独立**各自减半**（15 / 5），省下的份额全给匪乱 ——
     * "驻军压制"压的是背叛，不是治安。 */
    wBandit: 60, wDefect: 30, wSecede: 10,
    banditDrop: 30,          // 匪乱之后 UNREST −30
    banditTurns: 3,          // 匪患标记持续回合（这期间 +10 不安）
    warnAt: 70,              // 玩家预警线（比爆发线早一档 → 提前一回合的反应窗口）
    warnAt2: 80,             // 第二次预警：已经到爆发线了（和 revoltAt 同步）
    secedeUnrest: 60,        // 独立时"抱团"的邻省门槛
    secedeMax: 4,            // 一次最多带走几省（多了会把整国拆散）
    defectRel: -25,          // 倒戈后两国关系
    secedeRel: -40,          // 独立后和旧主的关系
    riotLine: 40             // 国家卡"N 省骚动"的门槛
  };
  AO.UNREST = UNREST;

  /* ---------------- 占领整合（B 批） ----------------
   * 打下来的省不是你的：OCCUPY 只记"谁在什么时候打下的"，
   * 真正的消化进度在 INTEG（0~100）。三件事跟着它走：
   *
   *   产出  未整合 ×0.4 → 整合满 ×0.6（= BATTLE.occupyProd 满额）→
   *         整合完成（OCCUPY 删除）才是正式国土 ×1.0
   *   资格  未整合不产科研、不能传教（沿用占领省的老规矩）
   *   不安  未整合 +15（见 UNREST）
   *
   * 加速项全部 +1/回合（同信仰 / 有官 / 民心≥55 / 有驻军），
   * 也就是"最快 20 回合消化完一个省、最慢 100 回合" —— 扩张的刹车就在这里。
   * 「安抚」是唯一能一次买一大截的路（金能买人心），但有 3 回合冷却。 */
  var INTEG = {
    max: 100,
    base: 1,                 // 基础推进
    sameFaith: 1,            // 省信仰 = 国教
    officer: 1,              // 省有在任官员
    happy: 1, happyAt: 55,   // 民心 ≥ 55
    garrison: 1,             // 省有驻军（军队弹压）
    stallHappy: 35,          // 民心低于它 → 本回合不推进
    prodAt0: 0.4,            // 未整合省的产出起点
    doneText: '归附，设官治理',
    /* 安抚金（B3）：花金买人心。省库优先、中央兜底（走 payCost 那条链） */
    pacify: {
      cost: 25,
      cd: 3,                 // 冷却回合（防连点买平安）
      integ: 15,             // 未整合省：INTEG +15
      unrest: 15,            //           UNREST −15
      unrestOnly: 25,        // 只是不安高（非占领省）：UNREST −25
      at: 40,                // 省卡按钮的可用门槛（不安 ≥ 40 或未整合）
      aiAt: 70               // AI 出手的门槛（比自己闹事更晚 —— 留给玩家的人工价值）
    }
  };
  /* 未整合省的产出乘数：从 prodAt0 线性涨到 occupyProd。
   * 任务书写的 `0.4 + INTEG/100 × 0.6` 是"从 0.4 涨到满额"的口语写法 ——
   * 照字面算，INTEG 满时乘数是 1.0，那 B2 的"整合完成才 ×1.0"就没有意义了
   * （没完成已经满产）。所以按两端插值：0 → 0.4，100 → 0.6，完成那一刻才跳到 1.0。 */
  INTEG.prodMul = function (v) {
    var t = AO.clamp((v || 0) / INTEG.max, 0, 1);
    return INTEG.prodAt0 + (BATTLE.occupyProd - INTEG.prodAt0) * t;
  };
  AO.INTEG = INTEG;

  /* ---------------- 动态市场（物价指数 + 跨国倒卖） ----------------
   * v1 的市场只是个兑换机：卖永远 5:1、中央买固定价、外国固定 1.8 倍。
   * 这一批给**每国每种资源**一个物价指数 PI（price index）：
   *
   *   PI = 1.0   基准（卖 5 单位得 1 金）
   *   PI > 1     这东西在这一国值钱（库存紧）→ 卖得贵、买也贵
   *   PI < 1     积压 → 卖不出价
   *
   * 于是"跨国价差"自己长出来了：丰年把粮卖给闹饥荒的邻国，
   * 价差就是利润 —— 经济从"攒资源"变成"经营"。
   *
   * **为什么不给每种资源配一条真实供需曲线**：那个要算弹性、要解方程，
   * 玩家在面板上根本读不出来。这里只用**库存 / 需求**一个比值分四档，
   * 每档一个目标价，v 每回合向目标靠 25%（lerp，和民心/不安同一个套路）——
   * 一眼能算、一眼能懂，而且天然收敛（见下）。
   *
   * **为什么价差会自己闭合（不会变成印钞机）**：
   * 出口的货**进对方库存** → 对方的比值上去 → 对方目标价下来 → 价差收窄。
   * 所以一笔套利会自己把门关上，不需要额外加"每回合限 N 笔"的硬闸
   * （那条限制是给手感用的，不是给平衡用的）。
   *
   * 需求（need）怎么估：
   *   grain / fish   Σ省口粮（POP[pid].need，settlePop 算好的那个数）
   *   iron / gold    Σ省维护需求（建筑维护吃铁吃金，打仗时再乘 warNeedMul）
   *   其余          省数 × otherPer（盐 / 木 / 畜没有"刚性口粮"，
   *                 一个省按 1.5 的日常消耗当基准，是纯占位）
   *
   * **所有数值都是占位**：拍板只改这一块。 */
  var PRICES_CFG = {
    base: 1.0,               // 初始 / 基准价（1 = 卖 5 单位得 1 金）
    lo: 0.5, hi: 2.5,        // 钳位（极端事件也不让它飞出这个区间）
    lerp: 0.25,              // 每回合向 target 靠 25%
    /* 事件冲击当回合走得更快：旱情/商队这种事，市场**当天就反应**，
     * 再按 25% 慢慢挪会显得"消息没人信"。所以冲击生效的第一回合用 shockLerp。 */
    shockLerp: 0.5,
    round: 2,                // 存档里保留几位小数（v / target 都是）

    /* 稀缺度分档：ratio = 库存 / need，落到哪一档就用哪个目标价。
     * 60/100/300 是"半够吃 / 刚够 / 三倍余粮"的口语表达。 */
    ratio: { scarce: 0.5, tight: 1.0, glut: 3.0 },
    tier: { scarce: 1.8, tight: 1.3, ok: 1.0, glut: 0.7 },

    /* need 的估算
     *
     * **为什么要乘一个 cover**：口粮和维护都是"每回合消耗"，直接拿来当 need 的话，
     * 和库存（每省上限 150）差着两个数量级 —— 结果每个国的每种资源都落在
     * "三倍以上"那一档，物价永远 0.7，价格板等于一块死表。
     * cover 的意思是"这个国想囤多少回合的用量"，一个乘法把所有 need 抬到
     * 和库存同一个量级上。25 回合 ≈ 两年的储备，是能玩出"紧 → 松"的值。 */
    need: {
      cover: 25,                              // 想囤多少回合的用量（全局换算）
      foodShare: { grain: 1.0, fish: 0.4 },   // 渔获是口粮的补充，按四成算
      otherPer: 1.5,                          // 非口粮、非军需资源：省数 × 1.5
      /* 战时军械消耗抬高铁/金的需求 —— 这就是"战时铁贵"的来源 */
      warNeedMul: 1.6,
      floor: 1                                // need 至少 1（不然开局除零）
    },

    /* 出口（卖到外国）：对方 PI × exportCut 就是你到手的金（每 5 单位一手）。
     * 那 20% 是运费 + 中间商 —— 也是"为什么不去当纯倒爷"的答案：
     * 价差不到 25% 的时候，出口还不如在本国卖掉。 */
    exportCut: 0.8,
    exportLot: 5,            // 一手的单位数（跟 MARKET.rate 同一个量）
    exportPerTurn: 1,        // 每省每回合最多几笔（占位：手感闸，不是平衡闸）
    minSpread: 0.05          // 价差小于这个就不列（列出来也赚不到钱）
  };
  AO.PRICES_CFG = PRICES_CFG;

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
    aiReserve: 25,

    /* ---- 世界消息（v15）：新闻也走情报渠道 ----
     * 地图有迷雾，纪要就不该是全知的：AI 之间宣战 / 灭国 / 都城易手，
     * 要按你的情报档**晚几回合**才送得到，而且低档还会传来走样的风闻。
     *
     *   delay[tier]  入队时掷的时滞（回合，两端含）。0 档 5~8：快马到边境
     *                再转驿站，就是这个量级；2 档 1 回合 = "下个月才知道"。
     *                为什么不给 0：0 = 当回合就知道，那又变回全知了。
     *   rumourP      0 档走样概率（1/2 档永不走样 —— 情报署养着人呢）
     *   lateMid      迟到换算：< lateMid = 数月前
     *   lateOld      < lateOld = 去年；其余 = ⌊差/perYear⌋年前
     *   styleLate    迟到 ≥ 这个数算「迟报」（纪要里淡黄斜体）
     *   cap          每回合最多送几条（兜底；正常读 AO.AIWAR.newsPerTurn）
     *   queueMax     待送达队列上限（防"入队比出队快"把档撑爆） */
    news: {
      delay: [[5, 8], [3, 4], [1, 1]],
      rumourP: 0.15,
      lateMid: 12,
      lateOld: 24,
      styleLate: 3,
      cap: 2,
      queueMax: 160,
      /* 战况一行只在重金档附（"附战争分对比一行"） */
      scoreLine: 2
    }
  };
  AO.INTEL = INTEL;

  /* ---------------- 外交（v9）：关系驱动 / 条约 / 战争分 / 谈判桌 / 跨国贸易 ----------------
   * 这一层**不改 REL 的本体**（REL 仍是 -100~100 的无序对表，键还是 warKey），
   * 只在它上面做两件事：
   *   ① 给 REL 加**驱动**（结盟、毁约、互不侵犯、跨国贸易、和谈赔款、会战败仗）
   *      和**缓释**（无事件的回合向 0 走 1，同盟有 60 的地板托着）；
   *   ② 在它上面长出条约（同盟 / 互不侵犯）、战争分、谈判桌与外国货源。
   *
   * 数值全部集中在这里；AI 只留一个评估接口 AO.aiDiploEval（消费在 18-ai.js 的下一批）。
   * 这一批**不碰** 18-ai.js 的任何一行。 */
  var DIPLO = {
    /* REL 的驱动表。正数抬关系、负数压关系；缓释 drift 每回合把关系往 0 拉一格。
     * 为什么缓释要"无事件时才走"：一回合里刚结的盟（+40）不该当场被扣回 39，
     * 那会让"结盟"这条消息和面板上的数字对不上。 */
    rel: {
      ally: 40,                     // 结盟
      breakAlly: -50,               // 毁盟（背信）
      nap: 20,                      // 互不侵犯
      napEnd: -20,                  // 互不侵犯作废
      trade: 0.5,                   // 每一笔跨国贸易
      tradeCap: 20,                 // 贸易累计的上限（再多也只是生意，不是交情）
      peacePay: 10,                 // 和谈赔款
      battleLoss: -5,               // 会战败仗
      drift: 1,                     // 每回合向 0 走多少
      allyFloor: 60,                // 同盟的地板：盟友之间关系不会掉到 60 以下
      /* 五档词（面板上"关系值 42 · 友好"里的那个词）。
       * 从高到低排，取第一个 v >= min 的档；-100 兜底成"敌对"。 */
      tiers: [
        { min: 60,   key: 'kin',    cn: '亲睦' },
        { min: 25,   key: 'friend', cn: '友好' },
        { min: -24,  key: 'plain',  cn: '普通' },
        { min: -60,  key: 'cold',   cn: '冷淡' },
        { min: -100, key: 'foe',    cn: '敌对' }
      ]
    },
    /* 两条条约：门槛是"关系值"，冷却只给"被拒"那一种（答应了当然不用等）。 */
    ally: { need: 60, cd: 10 },
    nap:  { need: 20, cd: 10 },
    /* AI 评估：REL + 性格权重 + 共同敌人，≥ accept 才答应。
     * 性格权重是"这个国家天生多疑还是好说话"：军国 −10（谁都不信）、
     * 经营 +10（和气生财）、均衡 0。所以关系刚好压线时，军国总是差一口气。 */
    eval: {
      accept: 30,
      commonEnemy: 15,              // 有共同的敌人：多给 15 分（敌人的敌人）
      persona: { mil: -10, balanced: 0, econ: 10 }
    },
    /* 战争分（'a|b' → { a, b }，宣战时清零）。这是"这一仗谁打赢了"的唯一账本：
     * 谈判桌的条款、AI 愿不愿意停，全读它。 */
    score: {
      occupy: 10,                   // 占领一座省
      battle: 5,                    // 会战获胜
      siege: 8,                     // 围城陷城（比硬攻便宜，分也少一点）
      capital: 30,                  // 首都易手（额外加，和"占领省"叠加）
      bombard: 1                    // 轰击见效（小胜）
    },
    /* 谈判桌：白和永远可选；赔款要求己方分领先 payLead，档位两档。
     * 赔款走中央国库（不是省库）—— 那是国家掏钱，不是某省的私房钱。 */
    talk: {
      payLead: 20,                  // 己方战争分领先多少才能提赔款
      payTiers: [50, 150],          // 两档赔款额（金）
      cd: 5,                        // 被拒后的冷却（回合）
      relPeace: -30,                // 停战后关系重置到（makePeace 用的就是 FOG.relPeace）
      /* AI 的"要价"：领先 20 分只是**够格开口**，还得再多出这么多分它才肯点头。
       * 这一项是必要的 —— 没有它，"领先 ≥20 才可提赔款"和"对方分 − 己方分 ≥ 0
       * 就接受"这两条叠在一起，任何能提的赔款都会被接受，拒绝分支永远走不到
       * （冷却 5 回合就成了死代码）。有了 15 分的要价：军国（−10）在刚好领先 20
       * 时还要看民心（压力 +5 才勉强点头），经营（+10）则爽快得多。 */
      demand: 15,
      /* AI 愿不愿意停：对方分 − 己方分 + 性格 + 民心压力 − 要价 ≥ 0
       * 民心压力 = max(0, (happyRef − 民心) / happyPer)，封顶 happyMax。
       * 也就是"百姓快活不下去了"能顶掉一点战况优势 —— 饿着肚子打仗打不久。 */
      happyRef: 55,
      happyPer: 5,
      happyMax: 10
    },
    /* 跨国贸易：只和 REL ≥ minRel 的存续外国做生意，溢价 premium 倍。
     * 出口侧 v1 不做（AI 不会来买你的货）。 */
    trade: { minRel: 20, premium: 1.8 },

    /* ---- 傀儡与朝贡（v13）：战争的第三种结局 ----
     * 一仗打到最后只有两条路（白和 / 全吞）时，玩家在后期会退化成"一格一格啃省"：
     * 每省要 25~100 回合整合，吃掉一个 12 省的国，等于把游戏按了暂停。
     * 傀儡是那条中间档：**不吞地，收租**。它还是个国（自己的内政、官员、整合），
     * 但腰包和军队不归自己 —— 上贡 20% 中央金入、被宗主拖进战争、不能自行缔约宣战。
     *
     * 数值为什么这么定（每条都对应一处验收）：
     *   talkLead 40 —— 比赔款（20）高一倍：傀儡是比"要点钱"重得多的胜利。
     *   evalBase 50 —— 接受分 = 领先分 − 50 + 性格 + 快顶不住了 20。
     *                 领先 40 只是"够格开口"，均衡国要到 50、军国要到 70 才点头；
     *                 经营（+15）在 40 分就能谈成 —— 这就是"识时务"的味道。
     *   tribute 0.20 —— 傀儡中央金入的两成。定太高（三成）会让被傀儡化的 AI
     *                 直接破产（它的维护费是按全额收入配的）；两成是"肉疼但活得下去"。
     *   annexCd 60 —— 一个省最快 20 回合整合完，60 回合 ≈ 两代人的"奉表称臣"，
     *                 玩家在这段时间里已经拿回本了（20% × 60 ≈ 12 年岁入）。
     *   indepNeed 40 —— 三个加分项（宗主陷 2 场战争 30 / 军力过半 20 / 民心思变 10）
     *                 任意两项相加就能过线，单独一项不够：独立要"天时 + 人和"。 */
    puppet: {
      talkLead: 40,                 // 谈判桌上「扶植傀儡」的解锁线（己方战争分领先）
      evalBase: 50,                 // 接受分 = 领先 − 它 + 性格 + 快顶不住了
      /* 性格权重（和缔约那套 eval.persona 是两张表：那是"信不信你"，这是"服不服你"）。
       * 军国宁死不屈 −20 / 均衡 0 / 经营识时务 +15 */
      persona: { mil: -20, balanced: 0, econ: 15 },
      nearLine: 1.2,                // 剩省 ≤ 投降线 × 它 → "快顶不住了"
      nearAdd: 20,
      tribute: 0.20,                // 每回合傀儡**中央金收入**的两成上贡
      relLock: -80,                 // 宗主 ⇄ 傀儡的关系锁（貌合神离，缓释也拉不回来）
      annexCd: 60,                  // 称臣满这么多年 → 宗主卡上出现「和平并入」
      annexRetry: 30,               // 被拒 → 重掷这么多年
      annexHappy: 55,               // 傀儡平均幸福 ≥ 它才肯谈（"过得好不好"）
      annexPeace: 10,               // 最近这么多年没被卷进宗主的战争
      annexAccept: 0.60,            // 条件满足时的接受概率
      forceHappy: 8,                // 强并入：宗主全国民心 −8（随后自然回暖）
      forceUnrest: 30,              // 强并入：并入各省不安 +30（吞并恐慌）
      indepEvery: 10,               // 傀儡每这么多年掷一次独立
      indepWars: 2,                 // 宗主正陷这么多场战争 → 天时
      indepWar: 30,
      indepArmyRatio: 0.5,          // 傀儡军力 ≥ 宗主的这么多 → 人和之一
      indepArmy: 20,
      indepHappyRef: 35,            // 民心低于它 → 民心思变
      indepHappy: 10,
      indepNeed: 40,                // 独立线
      indepPlayer: 15,              // 玩家当傀儡的主角光环（恒 +15）
      attackWeight: 0.5,            // 跟宗主出兵：权重 = 宗主 warBias × 它
      surrenderP: 0.40,             // 投降线上 AI 胜方要求称臣（而不是全吞）的概率
      armyKeep: 0.30                // 并入时傀儡军队转编比例（其余解散）
    }
  };
  AO.DIPLO = DIPLO;

  /* ---------------- AI 互战 / 迷雾消费 / 性格×外交（v10） ----------------
   * 路线图的最后一块：AI 从"会过日子的县长"变成"会打仗、也会算账的邻居"。
   * 决策全在 18-ai.js 的 warTick；这里只放数值。
   *
   * 三条设计前提（和 18-ai 的老纪律一致）：
   *   ① 只在 PLAYER > 0 时运行（工坊模式 AI 全静止）；
   *   ② AI 只用**自己**的数据：军力比看自家兵 + 自己探过的敌军，
   *      行军目标只从自己的已探集里挑（AIKNOW）—— 和玩家吃同一套迷雾；
   *   ③ 一律 silent：不写 bldMsg、不弹提示条。唯一的例外是「世界纪要」，
   *      那是玩家该知道的远方大事（每回合最多 newsPerTurn 条）。 */
  var AIWAR = {
    /* ---- ① 宣战 ----
     * 每国每 every 回合评估一次（用 (turnNo + cid) % every 错开，
     * 免得 36 国同一回合一起动手，纪要一屏刷完）。 */
    every: 6,
    /* 宣战分 = QUIRK.war × wWar + 性格权重 + 敌意 + 趁火打劫
     *   典型值：军国（war 1.0）20 + 15 = 35；均衡 20；经营 20 − 15 = 5
     *   阈值 30 的校准（跑出来的，不是拍的）：
     *     军国 31~39 —— 全都够（这一型天生要打）；
     *     均衡 16~24 —— 要一条加成（敌意或趁火打劫 → 26~34）才够；
     *     经营  1~ 9 —— 上限 29，**正好比阈值低 1 分**：
     *                   哪怕关系烂到底、对方正在挨打，经营也**永远**不主动开战。
     *                   这 1 分是刻意的，"经营太平"要是规则保证，不能靠运气。
     *   为什么不是 38：关系值每回合向 0 缓释，开局全在 ±10，
     *   敌意（< −40）和趁火打劫（对方在打）都不是开局就有的 ——
     *   阈值定太高，第一场仗永远打不起来，世界会一直和平到终局。 */
    score: {
      wWar: 20,                              // QUIRK.war（0.8~1.2）× 它 → 16~24
      persona: { mil: 15, balanced: 0, econ: -15 },
      hostileRel: -40, hostileAdd: 10,       // 关系烂到 −40 以下
      busyAdd: 10                            // 对方正陷战争（趁火打劫）
    },
    threshold: 30,
    powerRatio: 0.7,                         // 军力比一票否决（打不过就别打）
    maxWars: 2,                              // 已在打 2 场就不再开新战场（防全图乱战）
    peaceCd: 20,                             // 停战之后多少回合内不重新宣战
    powPerProv: 300,                         // 敌国"规模估计"：每省按这么多兵算

    /* ---- ② 进攻 ----
     * 机动军比例按 QUIRK.war 归一化后取档（0.8~1.2 → 0~1）。
     * 任务书给的是 0.5 / 0.3 两个阈值，那套数按 warBias ∈ 0~1 写的；
     * 我们的 warBias 是 0.8~1.2，所以先把 (war − lo) / (hi − lo) 归一化再用同一套阈值 ——
     * 效果：war ≥ 1.0 转 30%、0.92~1.0 转 15%、其余不动。 */
    attack: {
      high: 0.5, highPct: 0.30,
      mid: 0.3, midPct: 0.15,
      maxArmies: 2,                          // 一国最多几支机动军（防抽空边防）
      retreatLoss: 0.5,                      // 兵损过半 → 回撤补员
      tactic: { mil: 'assault', balanced: 'siege' }   // 经营不进攻
    },

    /* ---- ④ 求和 ----
     * 战争分落后 ≥ behind 且连续 turns 回合 → 主动求和（败方掏钱，胜方点头）。
     * payWeight：赔款折成分数（每 1 金 = 1/payWeight 分）。
     * 为什么 AI-AI 这一路把赔款折成分数、玩家谈判桌那一路不折：
     *   玩家那边赔款是"买面子"（要价 15 分是门槛，钱不抵分）；
     *   AI 这边赔款是"买命"（败方只剩钱这一张牌）。
     * 两边共用 AO.aiPeaceEval 的四个输入（战况 / 性格 / 民心 / 要价），
     * 只是 AI 这一路把"要价"换成"赔款"。 */
    peace: {
      behind: 30, turns: 5, pay: 50, payWeight: 2, cd: 5,
      /* 赢家的"胃口上限"：落后分超过它之后，多赢的分数不再增加停战难度。
       * 没有这条，一旦把对方打崩（落后 200+），任何赔款都换不来和平 ——
       * 战争就只能以灭国收场，世界会在一两百回合内被吃干。
       * 45 ≈ 1.5 档：拿下四五座省之后，再往前的多是焦土（占领省产出 ×0.6、
       * 民心 −10），边际价值不如一笔现钱。 */
      deficitCap: 45
    },

    /* ---- ⑤ 世界纪要：每回合最多报几条（防刷屏） ---- */
    newsPerTurn: 2,

    /* ---- ⑥ 平衡护栏 ----
     * AI 没有真正的"军饷"（征兵一次性扣钱，之后只吃粮），所以这里用**名义军费**
     * 做决策护栏：men/1000 × upkeepGoldPerK 当作这一国每回合的军费，
     * 和它上回合的实际金收入比。超过 milShare 就削减：
     *   ① 机动军全部转驻防（先停进攻，最省事）
     *   ② 非军备建筑停到只剩 lowKeep（AO.rep.setKeepRatio：每城留三分之一在跑）
     * 超过 hardShare 再全类停一半 + 全面转驻防。 */
    guard: {
      milShare: 0.6, hardShare: 0.9,
      upkeepGoldPerK: 0.5,
      /* 军费超线时把非军备类停到只剩这个比例（0.34 ≈ 每城留三分之一在跑）。
       * 为什么不是 0：全停会让整类建筑连维护费都省掉，AI 就再也不会
       * 因为"没钱"而恢复它们 —— 留一点，国力和产出都还有回旋余地。 */
      lowKeep: 0.34,
      keepKinds: ['barracks', 'armory', 'stable', 'shipyard', 'wall', 'factory']
    },

    /* ---- 阻尼（防雪崩）----
     * 任一 AI 灭国后 afterDeath 回合内，若全球战争数 ≥ wars，
     * 所有 AI 的宣战门槛 +add —— 打完一个大国之后世界该喘口气。 */
    damp: { afterDeath: 10, wars: 6, add: 15 },

    /* ---- ⑧ 战时经济换挡（v11）----
     * 宣战后一回合内换挡，停战恢复。三件事：
     *   ① 保留座数：军备类全开、资源类全开（口粮不能断）、民用停一半
     *   ② 建造只留军备类（兵营 / 军械坊 / 熔旧坊）—— 战时盖学校是白扔料
     *   ③ 官员俸禄照付不欠：省库发不出时从中央补（不加薪，欠饷惩罚已有）
     * 和军费护栏的关系：**护栏优先**。换挡先发生，护栏随后还能把它压到 lowKeep；
     * 换挡本身不征兵、不动军费 —— 那件事归 guard（军费 ≤ 收入 60%）。
     * 数值是"保留比例"（1 = 全开，0.5 = 每城停一半，0 = 全停）。 */
    warEcon: {
      milKinds: ['barracks', 'armory', 'stable', 'shipyard', 'wall'],
      resKinds: ['grain', 'fish', 'salt', 'timber', 'horse', 'iron', 'gold'],
      civKinds: ['market', 'builder', 'school', 'university', 'granary', 'factory'],
      milKeep: 1, resKeep: 1, civKeep: 0.5,
      /* 战时只许盖这两类（熔旧坊 v18.1b 起走 aiConvert 快速通道，
       * 不吃建造格、也不受这张白名单管 —— 战时照改） */
      build: ['barracks', 'armory'],
      topUpReserve: 20,                          // 中央补俸禄后至少留这么多金
      grace: 1                                   // 宣战后第几回合内完成换挡（1 = 当回合）
    },

    /* ---- ⑦ 贸易（AI 内政买货走外国货源）----
     * 按性格分频次：经营每 3 回合看一次、均衡 5、军国 12（军国宁可直接盖厂）。
     * 只在"这种资源全国库存 < minStock 且手里有金"时才买。
     *
     * v14（动态市场）加了三格：
     *   compare   要不要**比价**（中央 vs 外国取便宜的）。军国 0 —— 它不看价，
     *             只看有没有，因为军国的答案永远是"盖厂"。
     *   sellAt    积压线：本国 PI ≤ 它就算"卖不动"，经营型会出口（0.7 = 最低档）
     *   sellEvery / sellPersona / sellKeys  出口的频次、谁做、卖哪些
     */
    trade: {
      every: { econ: 3, balanced: 5, mil: 12 },
      minStock: 30, minGold: 60,
      keys: ['iron', 'timber', 'grain'],
      compare: { econ: 1, balanced: 1, mil: 0 },
      sellAt: 0.7, sellEvery: 3,
      sellPersona: { econ: 1 },
      /* 出口卖什么：**含 iron**（拍板改口：铁也可以交易）。
       * 顺序就是"先出最不值钱的余货"：粮木鱼盐 → 铁 → 马。 */
      sellKeys: ['grain', 'timber', 'fish', 'salt', 'iron', 'horse']
    }
  };
  AO.AIWAR = AIWAR;

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

  /* ---------------- 军事科技挂上科技树（v19：工艺链） ----------------
   * 树上现在是这样：
   *   工艺  皮革(免费根) → 青铜 → 铁器 → 火器 → 精密 → 工业
   *   铸炮  铁器 → 投石机 → 青铜炮 → 野战炮 → 重炮
   *   舰种  铁器/火器/精密/工业 四档并轨
   *
   * **兵器名节点全下树**（青铜兵器 / 铁兵器 / 强弩·具装 / 火门枪 / 火绳枪 /
   * 燧发枪 / 击发枪 / 后膛定装 / 一战军械）：它们现在是"工艺解锁的一组装备代"，
   * 不再是各自一条科技。炮/舰科技保留，req 改挂对应工艺。
   *
   * 为什么工艺节点从 CRAFT.def 生成而不是再手写一遍：
   * 点数/花费/工期/前置只该有一份（CRAFT），科技树读的就是那一份。 */
  /* v19 返工：**铸炮枝 / 舰种枝的八条科技整表删除**。
   * 任务书第一节：树上一个兵器名都不许出现 —— 炮与舰一律"挂材质"
   * （见 GUNS[].craft / SHIPS[].craft），所以没有"投石机"这条科技，
   * 只有"皮革工艺"；没有"铁甲舰"，只有"工业工艺"。 */

  /* 材质 / 炮 / 舰 → AO.MIL_ITEM（征兵、订单、战报都按 key 查它） */
  (function () {
    /* 工艺链：皮革是免费根（free:true），其余从 CRAFT.def 生成 */
    var leatherTech = {
      key: 'leather', cn: CRAFT.cn.leather, for: null, craft: true, free: true,
      pts: 0, cost: {}, turns: 0, req: null, branch: '工艺',
      desc: CRAFT.desc.leather
    };
    TECHS.push(leatherTech);
    TECH_BY_KEY.leather = leatherTech;
    var MAT = { mil_bronze: 'bronze', mil_iron: 'iron', mil_matchlock: 'powder' };
    for (var ci = 1; ci < CRAFT.order.length; ci++) {
      var ck = CRAFT.order[ci], cd = CRAFT.def[ck];
      var ct = {
        key: ck, cn: CRAFT.cn[ck], for: null, craft: true, free: false,
        pts: cd.pts, cost: cd.cost, turns: cd.turns, req: cd.req, branch: '工艺',
        mat: MAT[ck] || null, desc: CRAFT.desc[ck]
      };
      TECHS.push(ct);
      TECH_BY_KEY[ct.key] = ct;
    }
    var groups = [['weapon', MATERIALS], ['gun', GUNS], ['ship', SHIPS]];
    AO.MIL_ITEM = Object.create(null);
    for (var gi = 0; gi < groups.length; gi++) {
      var kind = groups[gi][0], arr = groups[gi][1];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        it.kind = kind;
        AO.MIL_ITEM[it.key] = it;
        /* 三类都没有自己的科技节点：解锁条件统一是 craft（材质工艺）。
         * tech 这个字段留给老代码 / 老档读（和 craft 同值）。 */
        it.tech = it.craft || null;
      }
    }
    /* 兵刃的"材质次序"（武库排序 / 换代回收 / bestMaterial 都读它） */
    AO.MIL_ORDER = AO.MAT_ORDER.slice();
    AO.GUN_ORDER = ['catapult', 'bronze_gun', 'field_gun', 'heavy_gun'];
    AO.SHIP_ORDER = ['galley', 'galleon', 'ship74', 'ironclad'];
  })();

  /* ---------------- 军工科技（三条，挂军事枝） ----------------
   * 三条都是"改产线怎么跑"，不解锁任何装备 —— 所以它们不进工艺链（CRAFT），
   * 这里手写进 TECHS，req 指向的 mil_iron / mil_bronze / mil_matchlock 是工艺节点。
   *
   * 效果写在 desc 上、判定写在 11-ui 的三个点上（不使用 fx 汇总）：
   * 这三条是**局部乘数**（只作用于某个坊的产能 / 只作用于品质 roll / 只作用于武器线），
   * 塞进 MODS 的四个全局字段会张冠李戴 —— 全局科技是"全国所有建筑都受益"，
   * 这三条不是。判定统一走 hasTech(owner, key)，读的就是 RESEARCH.done。
   * ============================================================= */
  var MILL_TECHS = [
    { key: 'mil_std', cn: '制式装备', for: null, pts: 45, cost: { gold: 6 }, turns: 3,
      req: 'mil_iron', branch: '军工',
      desc: '军械坊产能 +1 点/座（两座军械坊 = 五点火，够打一炉兵刃再加一双靴）' },
    { key: 'mil_quench', cn: '淬火工艺', for: null, pts: 40, cost: { gold: 5 }, turns: 2,
      req: 'mil_bronze', branch: '军工',
      desc: '装备品质 roll 整体上移一档（学徒也能出上品，宗师出珍品的机会翻倍）' },
    { key: 'mil_massline', cn: '量产工艺', for: null, pts: 70, cost: { gold: 10 }, turns: 3,
      req: 'mil_matchlock', branch: '军工',
      desc: '兵刃线工作量 5 → 4 点（同样 4 点产能就能一回合出一单 1000 件）' }
  ];
  (function () {
    for (var i = 0; i < MILL_TECHS.length; i++) {
      TECHS.push(MILL_TECHS[i]);
      TECH_BY_KEY[MILL_TECHS[i].key] = MILL_TECHS[i];
    }
    AO.MILL_TECHS = MILL_TECHS;
  })();

  /* 科技树的行序（v19）：**工艺链排在最前**。
   * 为什么：树的行是按 TECHS 顺序排的（根节点依次往下），工艺链排在
   * 资源支线后面时会被挤到整张树的最底部 —— 一打开科技树只看见农场/伐木那条，
   * 会以为"军事支线没改"。工艺是这一批的主角，放第一行。 */
  (function () {
    var front = CRAFT.order.slice(), head = [], rest = [], i;
    for (i = 0; i < TECHS.length; i++) {
      if (front.indexOf(TECHS[i].key) >= 0) head.push(TECHS[i]); else rest.push(TECHS[i]);
    }
    head.sort(function (a, b) { return front.indexOf(a.key) - front.indexOf(b.key); });
    TECHS.length = 0;
    for (i = 0; i < head.length; i++) TECHS.push(head[i]);
    for (i = 0; i < rest.length; i++) TECHS.push(rest[i]);
  })();

  /* =============================================================
   * 年轮（v13 有年轮，v18 去季节）—— 只有一个**历法**，不带任何修正器
   *
   * 一回合 = 一个月、一年 12 回合：
   *   年 = floor((turn-1) / 12) + 1     月 = ((turn-1) % 12) + 1
   * 玩家是不死的操盘手（原设定不动），年轮只服务编年史的味道：
   *   年表按年分节、战报写"十年七月"、回合标签写"王国历 10 年 7 月"。
   *
   * 这里原来挂着一张 SEASONS 表（春夏秋冬各一组产出 / 税 / 征兵 / 维护 /
   * 人口 / 守城 / 行军 / 工期 / 事件权重的乘数）。四季整套删掉之后，那张表
   * 连同七个乘数出口一起没了 —— 产出与结算现在只认省份、科技、官员、事件，
   * 没有任何"这一回合是哪一季"的分支。
   * ============================================================= */

  var CAL = { perYear: 12 };
  AO.CAL = CAL;

  /* 回合 → 历法对象：turn = 第几回合，year = 第几年，month = 第几月 */
  AO.calOf = function (turn) {
    var t = Math.max(1, (turn | 0) || 1);
    return {
      turn: t,
      year: Math.floor((t - 1) / CAL.perYear) + 1,
      /* 月是每回合都在变的那一位 —— 只写年的话，连点十二次「下一回合」
       * 屏幕上一个字都不动，玩家会以为游戏卡死了。 */
      month: ((t - 1) % CAL.perYear) + 1
    };
  };

  /* 中文年号：一年只有 12 回合，跑到"一百一十三年"就太怪了 —— 只写到 99，
   * 之后退回阿拉伯数字。十年七月 / 二十三年七月 / 105年7月。 */
  var CN_D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  AO.cnNum = function (n) {
    n = n | 0;
    if (n < 0 || n > 99) return String(n);
    if (n < 10) return CN_D[n];
    var t = Math.floor(n / 10), u = n % 10;
    return (t === 1 ? '十' : CN_D[t] + '十') + (u ? CN_D[u] : '');
  };
  /* 战报/纪要里挂的短标签：「十年七月」「元年七月」。turn 省略就取当前回合。
   * 第一年写"元年"而不是"一年" —— 纪年本来就是这么开口的。 */
  AO.calTag = function (turn) {
    var c = AO.calOf(turn === undefined ? (AO.curTurn ? AO.curTurn() : 1) : turn);
    /* 月也写汉字（正月 / 七月 / 十二月）：史书里"元年1月"那种半中半西的写法最出戏 */
    return (c.year === 1 ? '元年' : AO.cnNum(c.year) + '年') +
      (c.month === 1 ? '正' : AO.cnNum(c.month)) + '月';
  };
  /* 回合标签的整句：「王国历 10 年 7 月」
   * **必须带月**：一年 12 回合，只写"10 年"的话，连点十二次「下一回合」
   * 屏幕上那个字一个都不动 —— 玩家的第一反应是"卡了"。 */
  AO.calLabel = function (turn) {
    var c = AO.calOf(turn === undefined ? (AO.curTurn ? AO.curTurn() : 1) : turn);
    return '王国历 ' + c.year + ' 年 ' + c.month + ' 月';
  };

  /* 存档版本：v3 加 PLAYER / WARSET / ARMY / GENERALS / 装备与厂状态
   *           v4 加事件状态（冷却/一次性/挂起/产量 buff）+ 信仰（政策/国教/传教中）
   *           v5 加编年史（YEARLOG 年表 / 定稿快照与称号 / 自动触发 flag）；
   *              旧档没有 CHRONO → 空年表起步，不炸（见 17-chrono 的 chronoLoad）
   *           v6 加战争迷雾（PLAYER 的 EXPLORED/LASTSEEN/INTELB/PROBE_CD）+ REL；
   *              旧档 PLAYER>0 但没有 FOG → 按"自国已探、其余 unknown"补初始化
   * 内政批（粮仓 / 人才档位）**不升号**：只加字段（GRANARY / UNIVERSITY /
   * TALENT.total / TALENT.tier / SIM 的 d.cap 流水），读 v6 旧档时缺什么补什么。
   * 军工产线批（MILL / EQUIP / ARTISAN）同样**不升号**：三张表读旧档时补默认，
   * 旧三坊的 st.order 读档时迁成"全产能 → 原订单线"（见 11-ui 的 millMigrate）。
   * 并行批全部落地后由最后一批统一升号。 */
  AO.SAVE_VER = 6;

})(typeof window !== 'undefined' ? window : globalThis);
