/* =============================================================
 * 18-ai.js —— 敌国 AI（v11）
 *
 * 敌国 AI 原本被三条约束捆着：
 *   ① 不主动进攻   ② 敌国之间不打   ③ 不动经济
 * v7 解除了 ③（内政），v10 解除 ① ②（互战）—— 至此三条全开。
 * 于是这张地图上开始有别的事在发生：学校一座座盖起来、科研条在涨、
 * 官员一个个派下去、税率跟着国情自己调；边境上有军队在动，
 * 远方有国家在打、在亡，而玩家会在纪要里读到"别处的历史"。
 * v11 补的是**当家人**的那一半：官员会升迁、会积怨、会被赏、会被换；
 * 一打仗，钱袋子的优先级自己换挡（军备升档、民用停建、俸禄不欠）。
 *
 * 文件结构：
 *   一~四  内政（v7/v8）：性格 / 怪癖 / 建造 / 研究 / 调税 / 人事
 *   五    吏部（v11）：资历怨气带来的赏赐 / 撤换 / 补人
 *   六    战时经济（v11）：维修档位换挡 / 建造只留军备 / 俸禄照付不欠
 *   七    战争（v10）：军费护栏 → 回撤 → 求和 → 进攻 → 宣战 → 贸易
 *   八    存档（性格 + 怪癖；战争 / 吏部 / 换挡都是运行时状态，不进档）
 *
 * 为什么单独一个文件而不是并进 11-ui.js 的「十二、敌国 AI」：
 *   决策层（性格 / 优先级 / 阈值）只读 AO.res* 那一套导出，不碰 DOM，
 *   单独成文时"AI 会做什么"能一眼看完。落手的那几个动作（建造 / 开科 /
 *   调税）仍然是 11-ui.js 里的原函数 —— 加一个 silent 参数，AI 走同一段代码，
 *   不另写一套"AI 专用建造"，否则迟早两套账对不上。
 *
 * 三条纪律（和任务书一致）：
 *   1) 只在 PLAYER > 0（"开始游戏"之后）运行。工坊模式（PLAYER = 0）AI 全静止 ——
 *      在工坊里涂色改归属时不该有一堆国家趁机动土。
 *   2) **只看自己的省**。决策读的全是 owner 等于自己的那份 SIM / HAPPY / OFFICIAL，
 *      别国的实时数据一个都不读（迷雾框架下"偷看"是走后门，AI 也不该全知）。
 *   3) 一律 silent：不写 bldMsg、不弹提示条、不推 NOTES。36 个国家一回合
 *      七十个动作，件件都报的话玩家纪要就废了。唯一保留的是研究完成那条
 *      既有推送（finishResearch 里），那是"世界在动"的正经证据。
 *
 * 每回合每国最多 AIECON.actPerTurn 个动作，按下面这个优先级取：
 *   建造（每回合最多 1 座）→ 研究 → 调税 → 开科 / 派官 / 撤贪墨
 *
 * 为什么不是"永远取第一个可执行的"：建造几乎永远可执行（总有省没学校），
 * 那样研究和调税会被永远饿死，国家就成了只会砌墙的僵尸。所以规则写成
 * **同一类动作每回合各做一次**：第一格给建造，第二格自然轮到研究，
 * 研究的空窗期（在研 / 点数不够）才轮到调税和人事。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* ---------------- 性格（生成时定，随档存） ----------------
   * PERSONA[cid] ∈ 'econ' 经营 | 'balanced' 均衡 | 'mil' 军国
   *
   * 掷的时候用的是 **seed + cid 的散列**，不是 Math.random：
   *   ① 同一个 seed 的同一个国家，性格永远一样（换浏览器、重开一局都对得上）；
   *   ② 老存档里没有这个字段时，第一次读就按同一条规则补上 ——
   *      "读到旧档"和"新开一局"走同一条路，不用写迁移函数。
   * 权重在 AIECON.personas 里（30 / 50 / 20），改数值只改那一处。 */
  var PERSONA = Object.create(null);
  var PERSONA_SEED = '';          // 生成世界时的种子（personaOf 用它掷）
  var PERSONA_W = null;           // 缓存：这一局实际用到的 world 对象
  var QUIRK = Object.create(null);   // cid -> { build, tax, research, war }
  var ORDER = Object.create(null);   // cid -> 该国专属建造顺序（buildBias 重排过）
  var STAT = Object.create(null);    // cid -> { school, taxUp, acts }（运行时，不进档）

  function personaList() { return (AO.AIECON && AO.AIECON.personas) || []; }
  function personaCn(key) {
    var l = personaList();
    for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i].cn;
    return key || '均衡';
  }
  /* 政体 → 性格权重的乘数（表在 AO.AIECON.personaGov，表里没写的政体按 1 倍）。
   * 这一层是"王室多军国、商民多经营"的唯一落点 —— 改权重只改定义区那一张表。 */
  function govMul(govKey, key) {
    var T = (AO.AIECON && AO.AIECON.personaGov) || {};
    var row = T[govKey];
    return (row && row[key]) || 1;
  }
  /* 这个政体下三型各自的**实际权重**（掷的时候用它；测试和面板也能读，
   * 好回答"为什么这个国是军国"）。 */
  function personaWeights(govKey) {
    var l = personaList(), out = [], i;
    for (i = 0; i < l.length; i++) {
      out.push({ key: l[i].key, cn: l[i].cn, w: (l[i].w || 0) * govMul(govKey, l[i].key) });
    }
    return out;
  }
  function govKeyOf(cid) {
    var c = countryOf(cid | 0);
    return (c && (c.govKey || c.gov)) || '';
  }
  function rollPersona(cid) {
    return rollPersonaWith(cid, govKeyOf(cid));
  }
  /* 纯函数版（给定政体键）—— 测试与 bench 直接用它验"政体修正"这件事，
   * 不用为了凑样本去生成几十个世界。 */
  function rollPersonaWith(cid, govKey) {
    var l = personaWeights(govKey || ''), total = 0, i;
    if (!l.length) return 'balanced';
    for (i = 0; i < l.length; i++) total += l[i].w || 0;
    if (!(total > 0)) return 'balanced';
    var h = AO.hashString('persona|' + PERSONA_SEED + '|' + (cid | 0));
    var r = (h % 100000) / 100000 * total;
    for (i = 0; i < l.length; i++) {
      r -= l[i].w || 0;
      if (r <= 0) return l[i].key;
    }
    return l[l.length - 1].key;
  }
  function personaOf(cid) {
    cid = cid | 0;
    if (!cid) return 'balanced';
    var p = PERSONA[cid];
    if (p) return p;
    p = rollPersona(cid);
    PERSONA[cid] = p;             // 读一次就落定，之后不再重掷
    return p;
  }
  /* 测试 / bench 用：显式指定性格（也顺带验证"随档存"能不能原样读回） */
  function setPersona(cid, key) {
    var l = personaList(), ok = false, i;
    for (i = 0; i < l.length; i++) if (l[i].key === key) ok = true;
    if (!ok) return false;
    PERSONA[cid | 0] = key;
    return true;
  }

  /* ---------------- 个体怪癖（三个系数 + warBias 占位） ----------------
   * PERSONA[cid] 只管"三型底色"，同一型里的国还得有各自的活法 —— 这一层就是它：
   *   buildBias     建设狂热 → 只用来给建造优先级表做**轻微重排**（见 orderOf）
   *   taxBias       手紧/手松 → 所有**金钱阈值** × 它（>1 = 手松、加税晚）
   *   researchBias  科研偏执 → 取最便宜的两条时，贵的那条权重 = 它
   *   warBias       宣战激进值 —— **本批只存不用**（下一批 AI 互战才消费）
   *
   * 和性格一样用 seed+cid 的散列掷：同一个种子同一个国，怪癖永远一样；
   * 老档没有这一块 → 第一次被问到时补上，不写迁移函数。
   * 存的是**数值**不是文案：文案在 AO.PERSONA_TXT 里，改文案不用改档。 */
  function q01(cid, salt) {
    return (AO.hashString('quirk|' + PERSONA_SEED + '|' + (cid | 0) + '|' + salt) % 100000) / 100000;
  }
  function rollQuirk(cid) {
    var R = (AO.AIECON && AO.AIECON.quirk) || {};
    var lo = R.lo === undefined ? 0.8 : R.lo, hi = R.hi === undefined ? 1.2 : R.hi;
    function v(salt) { return Math.round((lo + (hi - lo) * q01(cid, salt)) * 1000) / 1000; }
    return { build: v('build'), tax: v('tax'), research: v('research'), war: v('war') };
  }
  function quirkOf(cid) {
    cid = cid | 0;
    if (!cid) return { build: 1, tax: 1, research: 1, war: 1 };
    syncWorld();                  // 保证 PERSONA_SEED 已经是这一局的（UI 可能比 tick 先问）
    var q = QUIRK[cid];
    if (q) return q;
    q = QUIRK[cid] = rollQuirk(cid);
    return q;
  }
  /* 偏得最狠的那一项 —— 2 档情报只显示这一项（"军国 · 苛税"）。
   * 三项一样偏（老档补的 1/1/1）时按 build → tax → research 取第一个，
   * 于是至少有一个说法，不会出现"性格后面空一格"。 */
  function topQuirk(cid) {
    var q = quirkOf(cid), ks = ['build', 'tax', 'research'], best = 'build', bv = -1, i;
    for (i = 0; i < ks.length; i++) {
      var d = Math.abs((q[ks[i]] || 1) - 1);
      if (d > bv + 1e-9) { bv = d; best = ks[i]; }
    }
    var hi = (q[best] || 1) >= 1;
    var T = ((AO.PERSONA_TXT || {})[best]) || {};
    return {
      key: best, hi: hi, v: q[best] || 1, d: bv,
      cn: hi ? (T.hi || '') : (T.lo || ''),
      desc: hi ? (T.hiD || '') : (T.loD || '')
    };
  }

  /* ---------------- 运行时统计（不进档） ----------------
   * bench 的"方差线"要的是**同性格国家之间**的时机差，所以记两个"第一次"：
   *   school  首座学校真的开工的回合
   *   taxUp   第一次**往上**调税的回合
   * 只活在内存里：读档后重新开始记，bench 每次重生成世界也会清空
   * （syncWorld 里一起清）。 */
  function statOf(cid) {
    var k = cid | 0;
    return STAT[k] || (STAT[k] = { school: 0, taxUp: 0 });
  }

  /* ---------------- 性格可见（识人也是情报战） ----------------
   * tier 就是 11-ui.js 的 intelTier：自己的国 / 工坊 = 3，别国 = 玩家情报预算 0/1/2。
   *   0 档  "？？"（连性格都不给）
   *   1 档  只给性格词
   *   2 档  性格 + 主导怪癖（"军国 · 苛税"）+ 三项明细
   * 返回 { known, text, title }：UI 只管往格子里放，不判断档位。 */
  function personaView(cid, tier) {
    cid = cid | 0;
    var T = AO.PERSONA_TXT || {};
    var cn = personaCn(personaOf(cid));
    if ((tier | 0) <= 0) {
      return {
        known: false, text: T.unknown || '？？',
        title: '情报不足：连它是什么性格都看不出来\n（把右上「情报」预算提到 1 档，就能看出性格）'
      };
    }
    if ((tier | 0) === 1) {
      return {
        known: true, text: cn,
        title: '性格：' + cn + '\n（2 档情报才看得出它的怪癖：建设狂热 / 手紧手松 / 科研偏执）'
      };
    }
    var q = quirkOf(cid), top = topQuirk(cid), c = countryOf(cid);
    var f = function (v) { return (v >= 1 ? '+' : '−') + Math.abs(v - 1).toFixed(2); };
    return {
      known: true,
      text: cn + (top.cn ? ' · ' + top.cn : ''),
      title: '性格：' + cn + '（' + ((c && c.govCn) || '政体未知') + ' 的底子）' +
        '\n主导怪癖：' + top.cn + ' —— ' + top.desc +
        '\n　建设狂热 ' + f(q.build) + '（越大越爱动土）' +
        '\n　手紧手松 ' + f(q.tax) + '（越大加税越晚）' +
        '\n　科研偏执 ' + f(q.research) + '（越大越爱硬啃贵的）'
    };
  }

  /* ---------------- 世界变了就整层重来 ----------------
   * 换世界（生成 / 读档重建）时 PERSONA 里挂的是上一局的同号国家。
   * 不在这里清的话，新世界的第 3 号国会继承上一局第 3 号国的性格。
   * 用 world 对象的身份判，比给 11-ui.js 加一个 reset 钩子更省事。 */
  function world() { return AO.resDebug ? AO.resDebug.world() : null; }
  function syncWorld() {
    var w = world();
    if (w === PERSONA_W) return w;
    PERSONA_W = w;
    for (var k in PERSONA) delete PERSONA[k];
    /* 怪癖 / 各国专属建造表 / 运行时统计同理：都是"这一局"的，
     * 不清的话新世界的 3 号国会继承上一局 3 号国的怪癖与顺序 */
    for (var qk in QUIRK) delete QUIRK[qk];
    for (var ok2 in ORDER) delete ORDER[ok2];
    for (var sk2 in STAT) delete STAT[sk2];
    /* v10 的战争运行时表同理：求和计数 / 护栏留痕 / 统计都是"这一局"的 */
    for (var lk in LOSING) delete LOSING[lk];
    for (var mk2 in MILG) delete MILG[mk2];
    for (var dk in DCL) delete DCL[dk];
    for (var ek in WECON) delete WECON[ek];
    for (var wk in WSTAT) {
      if (wk === 'deaths') continue;
      WSTAT[wk] = 0;
    }
    LASTDEATH = -999;
    var s = root.document && root.document.getElementById('seed');
    PERSONA_SEED = s ? (s.value || '') : '';
    return w;
  }

  /* ---------------- 读世界的小工具（全部只读） ---------------- */
  /* 国 → 省数组。11-ui.js 里有同样的一份缓存，但那是闭包内的；
   * 这里按 world 身份另存一份，一局只扫一遍（520 省 × 36 国不值得每回合重扫）。 */
  var IDX = { w: null, map: null };
  function provsOf(cid) {
    var w = syncWorld();
    if (!w) return [];
    if (IDX.w !== w || !IDX.map) {
      IDX.w = w; IDX.map = Object.create(null);
      for (var i = 0; i < w.provinces.length; i++) {
        var p = w.provinces[i];
        if (!p) continue;
        (IDX.map[p.owner] || (IDX.map[p.owner] = [])).push(p);
      }
    }
    return IDX.map[cid | 0] || [];
  }
  function deadOf(cid) { return !!(AO.resWar && AO.resWar.dead[cid | 0]); }
  /* 国号 → 国家对象。w.countries 是按下标 id-1 放的，但这里多一道校验：
   * 版图里灭亡的国家不会从数组里删掉，万一哪天换了编号方式也不至于认错国。 */
  function countryOf(cid) {
    var w = syncWorld();
    if (!w || !w.countries) return null;
    var c = w.countries[(cid | 0) - 1];
    if (c && c.id === (cid | 0)) return c;
    for (var i = 0; i < w.countries.length; i++) {
      if (w.countries[i] && w.countries[i].id === (cid | 0)) return w.countries[i];
    }
    return null;
  }
  function atWarWithSomeone(cid) {
    var W = AO.resWar && AO.resWar.wars, n = 0, k;
    if (!W) return 0;
    for (k in W) {
      if (!W[k]) continue;
      var ab = k.split('|');
      if (+ab[0] === (cid | 0) || +ab[1] === (cid | 0)) n++;
    }
    return n;
  }
  function univTable(kind) {
    var M = AO.resMil || {};
    if (M[kind]) return M[kind];
    var U = {
      school: AO.resSchool, market: AO.resMarket, builder: AO.resBuilder,
      granary: AO.resGranary, university: AO.resUniversity
    };
    return U[kind];
  }
  /* 通用设施自己的教育门槛（大学 60）。装备厂那一套在 AO.FACTORY[kind].needTier 里。
   * 两处都想读同一个数，所以合成一个函数 —— 18-ai.js 里不要再抄一遍 60。 */
  function univDefNeed(kind) {
    var U = {
      school: AO.SCHOOL, market: AO.MARKET, builder: AO.BUILDER,
      granary: AO.GRANARY, university: AO.UNIVERSITY
    }[kind];
    return (U && U.needTier) || 0;
  }
  /* 一块地某种设施的"座数 + 工地"（资源建筑住在 SIM 里，通用设施住在 UNIV 里） */
  function siteOf(pid, kind) {
    var res = AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind];
    if (res) {
      var bag = AO.resSim[pid];
      var s = bag && bag[kind];
      return s ? { n: s.built || 0, site: s.site || 0 } : { n: 0, site: 0 };
    }
    var T = univTable(kind), st = T && T[pid];
    return { n: (st && st.n) || 0, site: (st && st.site) || 0 };
  }
  function univCount(cid, kind) {
    var list = provsOf(cid), n = 0;
    for (var i = 0; i < list.length; i++) n += siteOf(list[i].id, kind).n;
    return n;
  }
  /* 已建 + 在建。配额判断必须用它：工地要两回合才完工，只看"已建成"的话
   * 一个国可以在同一回合里连开好几座学校，配额形同虚设。 */
  function univCountAll(cid, kind) {
    var list = provsOf(cid), n = 0;
    for (var i = 0; i < list.length; i++) {
      var st = siteOf(list[i].id, kind);
      n += st.n + st.site;
    }
    return n;
  }
  function researched(cid, key) {
    var t = AO.techFor ? AO.techFor(key) : null;
    var R = AO.resResearch[cid | 0];
    return !!(t && R && R.done && R.done[t.key]);
  }
  function costForKind(cid, kind) {
    var res = AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind];
    if (res) return (researched(cid, kind) && res.cost2) ? res.cost2 : res.cost;
    /* 通用设施（学校 / 市场 / 建造坊 / 粮仓 / 大学）与装备厂（兵营 / 军械坊 / … / 工厂）
     * 的造价都各只有一份定义，这里按同一条优先级反查，不另抄数字。 */
    if (AO.FACTORY && AO.FACTORY[kind]) return AO.FACTORY[kind].cost;
    var U = {
      school: AO.SCHOOL, market: AO.MARKET, builder: AO.BUILDER,
      granary: AO.GRANARY, university: AO.UNIVERSITY
    }[kind];
    return (U && U.cost) || {};
  }
  function stockOf(pid, key) {
    var b = AO.resSim[pid];
    return (b && b[key] && b[key].stock) || 0;
  }
  function popOf(pid) {
    var s = AO.resPop[pid];
    return (s && s.v) || 0;
  }

  /* ---------------- ① 建造 ----------------
   * 优先级（AIECON.buildOrder）：
   *   经营  学校（全国 < 省数/3）→ 市场 → 建造坊 → 粮仓 → 大学(60) →
   *         工厂(15，有军械坊的省) → 军械坊（有铁）→ 熔旧坊（排最后）
   *   均衡  学校 → 市场 → 建造坊 → 兵营（交战中优先）→ 工厂(15) → 熔旧坊 → 军械坊
   *   军国  兵营 → 熔旧坊 → 军械坊 → 工厂(15) → 学校 → 市场
   * 这是**底表**；每国再按 buildBias 做一次微调重排（orderOf，一局只算一次）。
   *
   * 三条硬门（顺序就是"先别把自己搞垮"的顺序）：
   *   ① 中央金 ≥ cost.gold + goldReserve —— 建造是先扣中央再扣省，不加这道闸，
   *      一回合两座就能把国库抽干（36 国 × 每回合都抽，几回合就集体停产）；
   *   ② 这块地这一种**只建一座**（n = 0 且没有工地）—— 全国分散不扎堆，
   *      而且"每省一座"本身就是最均匀的铺法，不用再算距离；
   *   ③ 建厂条件（AO.FACTORY.check）与矿脉不枯 —— 和玩家点 ＋ 读到的是同一句话。
   * 选省：库存最富 / 人口最多者优先。 */

  /* 该国专属建造顺序：底表 + buildBias 微调 + 交战中兵营提前。
   * 重排规则写在 orderOf 里（一局只算一次，**每回合不重掷**）。 */
  function buildOrderOf(cid, persona, fighting) {
    var order = orderOf(cid, persona).slice();
    if (fighting && persona === 'balanced') {
      var i = order.indexOf('barracks');
      if (i > 0) { order.splice(i, 1); order.unshift('barracks'); }
    }
    return order;
  }
  /* ---------------- 建造顺序：底色不变、各国略有差异 ----------------
   * 底表来自 AO.AIECON.buildOrder[persona]，这里按 buildBias 做一次**微调重排**：
   *   每一项算一个分 = 名次 − (buildBias−1) × buildJitter + 抖动(±0.9 格)，
   * 再按分排序。所以：
   *   · 营造狂（1.2）把想盖的往前挪一格多，惜工（0.8）往后挪；
   *   · 抖动由 seed+cid+kind 定 → 同性格的两个国顺序不同，但同一个国永远一样；
   *   · 底色不变：最多挪一两格，不会把军国的兵营挪到最后。
   * 缓存按 cid（一局只算一次），所以"每回合不重掷"是结构保证的。 */
  function orderOf(cid, persona) {
    cid = cid | 0;
    /* 缓存键带上性格：setPersona（bench / 测试）改过性格之后要能拿到新表 */
    var key = cid + '|' + (persona || 'balanced');
    var hit = ORDER[key];
    if (hit) return hit;
    var E = AO.AIECON, tbl = E.buildOrder || {};
    var base = (tbl[persona] || tbl.balanced || []).slice();
    var bias = (quirkOf(cid).build || 1) - 1;                 // −0.2 ~ +0.2
    var K = E.buildJitter === undefined ? 6 : E.buildJitter;  // 每 0.1 → 0.6 格
    var rows = [], i;
    for (i = 0; i < base.length; i++) {
      var j = ((AO.hashString('order|' + PERSONA_SEED + '|' + cid + '|' + base[i]) % 1000) / 1000 - 0.5) * 1.8;
      rows.push({ k: base[i], s: i - bias * K + j });
    }
    rows.sort(function (a, b) { return a.s - b.s; });
    var out = [];
    for (i = 0; i < rows.length; i++) out.push(rows[i].k);
    ORDER[key] = out;
    return out;
  }
  function provScore(p, kind) {
    var s = 0;
    var res = AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind];
    if (res) {
      var bag = AO.resSim[p.id], g = bag && bag[kind];
      s += (g && g.left || 0) * 2000;      // 资源建筑：这块地产得越多越优先
    }
    s += stockOf(p.id, 'gold') * 2000;     // 省库有钱的省，自己就能出一部分料
    return s + popOf(p.id);                // 人口最多：有人才盖得起来，也才有人用
  }
  function pickProv(cid, kind) {
    var list = provsOf(cid), best = null, bestS = -1;
    var T = AO.resTalentOf ? AO.resTalentOf(cid) : { pts: 0, total: 0 };
    var ctxGold = T.pts || 0, edu = T.total || 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (AO.resWar.occupy[p.id] || AO.resWar.siege[p.id]) continue;   // 打着的省不盖房
      var st = siteOf(p.id, kind);
      if (st.n > 0 || st.site > 0) continue;                            // 同省同 kind 只建一座
      if (AO.FACTORY && AO.FACTORY[kind]) {
        var ck = AO.FACTORY.check(kind, p, { bag: AO.resSim[p.id], talent: ctxGold, edu: edu });
        if (!ck.ok) continue;
      }
      var res = AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind];
      if (res) {
        var bag = AO.resSim[p.id];
        if (!bag || !bag[kind] || bag[kind].gone) continue;             // 矿脉枯了别盖
      }
      /* 工厂是"给本省军械坊/驯马场/铸炮厂/造船厂加倍"的，没有军械坊的省盖它
       * 等于白扔 20 木 8 铁 14 金 —— 所以只在已有军械坊的省里挑（经营那张表
       * 写的就是"挑有军械坊的省"，均衡/军国同理）。 */
      if (kind === 'factory' && !(siteOf(p.id, 'armory').n > 0)) continue;
      var s = provScore(p, kind);
      if (s > bestS) { bestS = s; best = p; }
    }
    return best;
  }
  /* 熔旧坊：本省铁矿枯了才改建（规则与玩家点「改建」同源，见 AO.SMELT.check）。
   * 它和别的建造共用**同一个建造格**（每回合最多一座），所以放在 tryBuild 里
   * 当一项来试，而不是单独一个动作。 */
  function trySmelt(cid, edu) {
    var D = AO.resDebug, S = AO.SMELT, E = AO.AIECON;
    if (!S || !D.smeltOf || !D.buildSmelt) return false;
    if (edu < (S.needEdu || 15)) return false;
    var cen = D.ensureCentral(cid);
    if ((cen.gold || 0) < (S.cost.gold || 0) + (E.goldReserve || 0)) return false;
    var list = provsOf(cid), best = null, bestPop = -1, i;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      if (AO.resWar.occupy[p.id] || AO.resWar.siege[p.id]) continue;
      var st = D.smeltOf(p.id);
      if (st && (st.n >= S.maxPer || st.site > 0)) continue;   // 封顶 / 正在改建
      var bag = AO.resSim[p.id], s = bag && bag.iron;
      if (!s || !s.gone) continue;                             // 矿还在 → 不许改建
      var pv = popOf(p.id);
      if (pv > bestPop) { bestPop = pv; best = p; }
    }
    if (!best) return false;
    D.buildSmelt(best, true);
    var st2 = D.smeltOf(best.id);
    return !!(st2 && st2.site > 0);
  }
  function tryBuild(cid, persona) {
    var E = AO.AIECON, D = AO.resDebug;
    var provs = provsOf(cid);
    if (!provs.length) return false;
    var cen = D.ensureCentral(cid);
    var war = atWarWithSomeone(cid) > 0;
    var order = buildOrderOf(cid, persona, war);
    /* 战时只盖军备类（§9 ⑤：兵营 / 军械坊 / 熔旧坊）。
     * 民用全停 —— 打仗的时候盖学校是白扔料，而且省下的维护费
     * 正是军费护栏要的那一笔。熔旧坊留着：它是战时的铁来源。 */
    var warAllow = (AO.AIWAR && AO.AIWAR.warEcon && AO.AIWAR.warEcon.build) || null;
    var schoolCap = Math.max(1, Math.floor(provs.length / (E.schoolQuotaDiv || 3)));
    var T = AO.resTalentOf(cid), edu = T.total || 0;
    for (var i = 0; i < order.length; i++) {
      var kind = order[i];
      if (war && warAllow && warAllow.indexOf(kind) < 0) continue;
      /* 熔旧坊走自己的挑省逻辑（只有枯竭矿的省能改） */
      if (kind === 'smelt') {
        if (trySmelt(cid, edu)) return true;
        continue;
      }
      /* 经营：学校够用了就往下走（省数/3 是"扫盲"而不是"每省一座"） */
      if (kind === 'school' && persona === 'econ' && univCountAll(cid, 'school') >= schoolCap) continue;
      /* 教育门槛（大学 60 / 工厂 15）：还没到就先跳过，别把格子浪费在必然失败的调用上 */
      var needTier = (AO.FACTORY && AO.FACTORY[kind] && AO.FACTORY[kind].needTier) ||
        (univDefNeed(kind));
      if (needTier && edu < needTier) continue;
      var cost = costForKind(cid, kind);
      if ((cen.gold || 0) < (cost.gold || 0) + (E.goldReserve || 0)) continue;
      var p = pickProv(cid, kind);
      if (!p) continue;
      if (AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind]) D.buildOne(p, kind, true);
      else if (AO.FACTORY && AO.FACTORY[kind]) D.buildFactory(p, kind, true);
      else D.buildUniv(p, kind, true);
      if (siteOf(p.id, kind).site > 0) {
        /* 方差线要的"建校时机"：第一次真的开学的回合 */
        if (kind === 'school') {
          var st3 = statOf(cid);
          if (!st3.school) st3.school = D.turn();
        }
        return true;                                     // 真的开工了才算一个动作
      }
    }
    return false;
  }

  /* ---------------- ② 研究 ----------------
   * 队列空 → 从"没研完、前置已满足、点数买得起、国库料够"的科技里，
   * 取 **pts 最便宜的两条**，按 researchBias 加权掷一条入队（走既有 queue 机制：
   * 这里只入队，真正的扣费在下一回合的 pullQueue —— 和玩家点节点一模一样，
   * 所以"点错不白花钱"那条保护对 AI 也照样成立）。
   *
   * 为什么不是永远挑最便宜的：那所有国家都会同一回合毕业同一条科技，
   * 世界读起来像一支队伍。取两条 + 偏执系数之后，有的国硬啃贵的（好高骛远），
   * 有的国捡便宜快点毕业（急用先学）—— 科研树上就能看出"偏科"。 */
  function tryResearch(cid) {
    var R = AO.resResearch[cid | 0];
    if (!R || R.cur || (R.queue && R.queue.length)) return false;
    if (!R.unlocked) return false;
    var cen = AO.resDebug.ensureCentral(cid), list = AO.TECHS || [], pool = [], i, k;
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      if (R.done && R.done[t.key]) continue;
      if (t.req && !(R.done && R.done[t.req])) continue;
      if (R.pts < t.pts) continue;
      var ok = true;
      for (k in t.cost) if ((cen[k] || 0) < t.cost[k]) { ok = false; break; }
      if (!ok) continue;
      pool.push(t);
    }
    if (!pool.length) return false;
    pool.sort(function (a, b) { return a.pts - b.pts; });
    var n = Math.max(1, (AO.AIECON && AO.AIECON.researchPick) || 2);
    var top = pool.slice(0, n);
    if (top.length === 1) { R.queue.push(top[0].key); return true; }
    /* 权重：最便宜那条 1，第二条起 = researchBias^名次。
     * researchBias 1.2 → 贵的更容易被挑；0.8 → 便宜的基本稳赢。 */
    var rb = quirkOf(cid).research || 1;
    var w = [], wsum = 0, j;
    for (j = 0; j < top.length; j++) {
      w[j] = Math.pow(rb, j);
      wsum += w[j];
    }
    var r = Math.random() * wsum, pick = top[top.length - 1];
    for (j = 0; j < top.length; j++) {
      r -= w[j];
      if (r <= 0) { pick = top[j]; break; }
    }
    R.queue.push(pick.key);
    return true;
  }

  /* ---------------- ③ 调税 ----------------
   * 经营 / 均衡（"不碰横征暴敛"，所以上限就是常规档 1）：
   *   民心 < 45 → 降一档（保民心比多收那点金划算）
   *   民心已回到 45 以上、中央金 > 80×taxBias → 升回常规（钱够花就少折腾百姓）
   * 军国（先保命，再穷兵黩武）：
   *   民心 < 35 → 降一档
   *   民心回来了、中央金 < 30×taxBias → 拉满档（横征暴敛）
   *
   * **金钱阈值全乘该国的 taxBias**（手紧/手松）：手松的军国（1.5）中央金掉到 45
   * 才加税，手紧的（0.83）25 就加了；经营/均衡那边同理 —— 80×1.5=120 才敢升回去，
   * 于是"手松"的国家长期停在高税档、国库却更空，"手紧"的国早早回到常规。
   * 民心阈值不乘：那是人命关天的线，不该被怪癖推着走。
   *
   * "升档"那一条为什么要求民心已经回升：两条规则同时成立的话
   * （民心 40、中央金 100），升一档下回合又降一档，面板上就是一根
   * 每回合上下横跳的税率 —— 加一个"民心先回来"的门槛，规则才稳定。
   * 只在**真要变**的时候算一个动作 —— 每回合都"确认了一下税率"不该吃掉格子。 */
  function tryTax(cid, persona) {
    var E = AO.AIECON, cur = AO.resTaxRateOf(cid), want = cur;
    var h = AO.resCountryHappy(countryOf(cid));
    var cen = AO.resDebug.ensureCentral(cid);
    var gold = cen.gold || 0;
    var tb = quirkOf(cid).tax || 1;
    if (persona === 'mil') {
      if (h < (E.milTaxHappy || 35) && cur > 0) want = cur - 1;
      else if (h >= (E.milTaxHappy || 35) && gold < (E.milTaxGold || 30) * tb && cur < 2) want = 2;
    } else {
      if (h < (E.taxDownHappy || 45) && cur > 0) want = cur - 1;
      else if (h >= (E.taxDownHappy || 45) && gold > (E.taxUpGold || 80) * tb && cur < 1) want = 1;
    }
    if (want === cur) return false;
    AO.resDebug.setTax(cid, want);
    /* 方差线要的"加税时机"：第一次**往上**调的回合 */
    if (want > cur) {
      var st = statOf(cid);
      if (!st.taxUp) st.taxUp = AO.resDebug.turn();
    }
    return true;
  }

  /* ---------------- ④ 开科 / 派官 / 撤贪墨 ----------------
   * 三件事共用一个动作格（人事就是一件事），顺序：
   *   撤贪墨 → 派官 → 开科
   * 先撤再派最后才抽，是因为"池里已经有人的时候还去开科"纯属浪费人才点。
   *
   * 贪墨官：上任 graftTurns 回合内，每回合 graftChance 概率自己撤换。
   * AI 也不傻 —— 贪墨是"税 +40%、民心 −10"，短期回本、长期赔本，
   * 所以只在刚上任的窗口里认这个错（上任三年还看不清的，那就不是 AI 的问题了）。 */
  function aiArmyNeedGeneral(cid) {
    var list = AO.resDebug.armiesOf(cid), need = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.type !== 'army') continue;
      if (a.generalId && AO.resWar.generals[a.generalId]) continue;
      need.push(a);
    }
    return need;
  }
  function tryOfficers(cid, persona) {
    var G = AO.GOV, D = AO.resDebug, E = AO.AIECON;
    var T = AO.resTalentOf(cid), provs = provsOf(cid), turn = D.turn(), i;
    if (!provs.length) return false;

    /* ① 贪墨官自己撤换 */
    for (i = 0; i < provs.length; i++) {
      var off = AO.resOfficial[provs[i].id];
      if (!off) continue;
      if (off.at === undefined) off.at = turn;         // 上任回合（存档自带，读档不丢）
      if (turn - off.at >= (E.graftTurns || 3)) continue;
      if (AO.traitOf(off.traitKey).rar !== 'bad') continue;
      if (Math.random() >= (E.graftChance || 0.3)) continue;
      D.dismiss(provs[i].id, true);
      return true;
    }

    /* ② 池里有文官 → 派给无官省（人口最多的优先） */
    if (T.pool && T.pool.length) {
      var best = null, bestPop = -1;
      for (i = 0; i < provs.length; i++) {
        var p = provs[i];
        if (AO.resOfficial[p.id]) continue;
        if (AO.resWar.occupy[p.id] || AO.resWar.siege[p.id]) continue;
        var pv = popOf(p.id);
        if (pv > bestPop) { bestPop = pv; best = p; }
      }
      /* pool 里理论上不会有空洞，但"灭国 → 池子清空 → 读档"这条路上见过一次
       * undefined 混在里面（AI 挂机 60 回合后崩在 off0.id 上）。
       * 取之前先滤一遍：这一步只是派官，滤掉一个坏记录比整局崩掉划算。 */
      var off0 = T.pool.filter(Boolean)[0];
      if (best && off0) {
        var offId = off0.id;
        D.assign(best.id, offId, true);
        if (AO.resOfficial[best.id] === off0) { off0.at = turn; return true; }
      }
    }

    /* ③ 武将（池里）→ 派给没将领的军队 —— 武科抽出来就得用，否则人才点白花 */
    var mp = (D.milPoolOf ? D.milPoolOf(cid) : []).filter(Boolean);
    if (mp.length) {
      var need = aiArmyNeedGeneral(cid);
      if (need.length) {
        /* 先把 id 抄出来：assignGeneral 会把这位从池里 splice 掉，
         * 之后 mp[0] 就换人（甚至没有）了 —— 原写法读 mp[0].id 会崩在池子只剩一位时 */
        var gid0 = mp[0].id;
        D.assignGeneral(need[0].id, gid0, true);
        if (need[0].generalId === gid0) return true;
      }
    }

    /* ④ 人才点攒够（examCost × examMul）→ 开科 */
    if (T.pts >= G.examCost * (E.examMul || 1.5)) {
      /* 军国文武各半：拿一个计数器轮流来，文武都不落下 */
      var mil = persona === 'mil' && (T.examFlip = !T.examFlip);
      var r = mil ? D.examGeneral(cid, true) : D.exam(cid, true);
      return !!(r && r.ok);
    }
    return false;
  }

  /* =============================================================
   * v11：吏部（AI 对自家官员的赏 / 撤）
   *
   * 派官只是"把位置填满"，治官才是"让位置产出"：一个官在任久了会升（rank），
   * 也会因为地方穷、民心差、俸禄欠着而生怨（griev）。怨气是**连续**折损
   * 效果的（倍率在 11-ui 的 offMul 里，玩家 tooltip 与 AI 读同一个数），
   * 所以 AI 也得像玩家一样做两件事：
   *
   *   赏（救）：怨气过线就花 15 金压 25 点 —— 但只救**还救得回来**的人
   *   撤（弃）：怨气过了"该走了"的线，认赔换人（回池子、资历减半）
   *
   * 三条纪律照旧：只动自己的省、一律 silent（不写提示条、不推 NOTES）、
   * 赏赐花的是**中央**金（和玩家点「赏」是同一个函数 AO.resReward）。
   *
   * 为什么"赏"要在"撤"之后判断：先看这人是不是已经该走了。
   * 反过来的话，一位怨气 92 的老臣会被赏回 67，永远等不到撤换 ——
   * 面板上就成了"AI 一直在给钱、从来不换人"，那不像活人。
   * ============================================================= */
  function aiFireLine(E, rank) {
    var l = E.fireByRank;
    return (l && l[rank]) || (l && l[l.length - 1]) || 90;
  }
  function aiRewardLine(E, rank) {
    var l = E.rewardByRank;
    if (!l) return null;
    return (l[rank] === undefined) ? null : l[rank];
  }
  /* 从候选池补一位到"最该有官"的空缺省：人口最多者优先，同人口看省库金
   * （有人才用得上，也得养得起）。池空就留着空缺（裸税 0.6）等下一次开科。 */
  function aiFillVacancy(cid) {
    var D = AO.resDebug, T = AO.resTalentOf(cid);
    var pool = (T.pool || []).filter(Boolean);
    if (!pool.length) return 0;
    var provs = provsOf(cid), best = null, bestS = -1, i;
    for (i = 0; i < provs.length; i++) {
      var p = provs[i];
      if (AO.resOfficial[p.id]) continue;
      if (AO.resWar.occupy[p.id] || AO.resWar.siege[p.id]) continue;
      /* 人口是主，省库金是次（每 1 金抵 1 万人）：大省先派，同规模派给有钱的省 */
      var s = popOf(p.id) + stockOf(p.id, 'gold') * 10000;
      if (s > bestS) { bestS = s; best = p; }
    }
    if (!best) return 0;
    var offId = pool[0].id;
    D.assign(best.id, offId, true);
    return (AO.resOfficial[best.id] && AO.resOfficial[best.id].id === offId) ? 1 : 0;
  }
  function aiGovPatrol(c, per) {
    var E = AO.AIECON && AO.AIECON.gov, G = AO.GOV, D = AO.resDebug;
    if (!E || !G || !G.griev || !AO.resReward) return 0;
    var cid = c.id, turn = D.turn(), provs = provsOf(cid), i;
    var cen = D.ensureCentral(cid);
    var war = atWarWithSomeone(cid) > 0;
    var adj = (E.personaAdj && E.personaAdj[per]) || 0;
    var n = 0;

    for (i = 0; i < provs.length; i++) {
      var pid = provs[i].id, off = AO.resOfficial[pid];
      if (!off) continue;
      AO.resOffNorm(off);
      /* ① 撤换（弃）：怨气过了这一级的线 → 认赔。资历越高给的余地越大
       *    （rank0 70 / rank1-2 80 / rank3 90）—— 老臣见过世面，也值这个耐心。 */
      if (off.griev >= aiFireLine(E, off.rank)) {
        D.dismiss(pid, true);
        n++;
        n += aiFillVacancy(cid);          // 换一位补上（池空则空着）
        continue;
      }
      /* ② 赏赐（救）：线值按性格修正（经营 −10 早赏、军国 +10 晚赏），
       *    战时只保 rank ≥ warMinRank（老臣稳住，新官自己扛）。 */
      if (war && off.rank < (E.warMinRank || 2)) continue;
      var line = aiRewardLine(E, off.rank);
      if (line === null || line === undefined) continue;      // rank0：永不赏
      line += adj;
      if (off.griev < line) continue;
      if (off.rewardAt && turn - off.rewardAt < (E.rewardCd || 12)) continue;
      if ((cen.gold || 0) < (E.minCentral || 30)) break;      // 国库比面子要紧
      var r = AO.resReward(pid, true);
      if (r && r.ok) n++;
    }
    return n;
  }

  /* =============================================================
   * v11：战时经济换挡（§9）
   *
   * 打仗的时候钱只有一种花法：先保军队。宣战后一回合内换挡，停战恢复。
   * 换的是**维修优先档**（19-repair 的那张表），不是军费本身：
   *   军备类（兵营/军械坊/铸炮厂/造船厂/驯马场/城墙）→ 高
   *   资源类（口粮与料）→ 中（断口粮会掉人口，不能一刀切停）
   *   民用（市场/建造坊/学校/大学/粮仓/工厂）→ 低（只吃本省库存）
   * 另外两件：战时俸禄照付不欠（省库不够从中央补，**不加薪**）、
   * 建造只许盖军备类（见 tryBuild 的闸门）。
   *
   * 和军费护栏的分工：换挡只是"重排优先级"，不减少任何一笔支出；
   * 真正的削减归 guardMil（军费 ≤ 收入 60%）。所以调用顺序是
   * **换挡在前、护栏在后** —— 护栏永远能盖掉换挡（"护栏优先"）。
   * ============================================================= */
  var WECON = Object.create(null);      // cid -> { war, prev:{kind:prio} }（运行时，不进档）

  function kindClass(W, kind) {
    if (W.milKinds.indexOf(kind) >= 0) return 'mil';
    if (W.resKinds.indexOf(kind) >= 0) return 'res';
    return 'civ';
  }
  /* 换挡要动的**全部**建筑类型：军备 + 资源 + 民用三张表。
   * 为什么不直接用 AO.rep.kinds()：那张表是"维修面板的行序"，只有
   * 7 资源 + 4 民用 + 工厂 + 城墙，**没有兵营/军械坊/铸炮厂/造船厂/驯马场**
   * （它们在 UNIV_KINDS 里，维护照付，只是不在面板那张表上）。
   * 换挡要动军备，所以这里按 AIWAR.warEcon 的三张名单取并集。 */
  function allKinds() {
    var W = AO.AIWAR && AO.AIWAR.warEcon;
    if (!W) return AO.rep ? AO.rep.kinds() : [];
    var out = [], seen = Object.create(null), i, src = [W.milKinds, W.resKinds, W.civKinds];
    for (var s = 0; s < src.length; s++) {
      for (i = 0; i < (src[s] || []).length; i++) {
        if (seen[src[s][i]]) continue;
        seen[src[s][i]] = 1;
        out.push(src[s][i]);
      }
    }
    return out;
  }
  /* 名义军费占岁入的比例（guard 与换挡共用一份算法） */
  function milRatioOf(cid) {
    var G = AO.AIWAR && AO.AIWAR.guard, D = AO.resDebug;
    if (!G || !D) return 0;
    var list = D.armiesOf(cid), men = 0, i;
    for (i = 0; i < list.length; i++) men += list[i].men || 0;
    if (!men) return 0;
    var inc = incomeOf(cid);
    if (inc <= 0) return 0;
    return men / 1000 * G.upkeepGoldPerK / inc;
  }
  /* 还能不能再征兵（§9 ① + §10 的交叉点）：军费已经吃掉 milShare(60%) 岁入的国家，
   * 不再动员新军 —— "护栏优先（少征兵，不掏空国库）"。
   * 11-ui 的 aiDefend（每 3 回合的民兵动员）在建军之前问这一句。 */
  function canRecruit(cid) {
    var G = AO.AIWAR && AO.AIWAR.guard;
    if (!G) return true;
    return milRatioOf(cid) <= (G.milShare || 0.6);
  }
  function warEcon(cid, per) {
    var W = AO.AIWAR && AO.AIWAR.warEcon, rep = AO.rep, D = AO.resDebug;
    if (!W || !rep || !rep.setPrio) return 0;
    var war = atWarWithSomeone(cid) > 0;
    var st = WECON[cid];
    if (st && st.war === war) return 0;          // 状态没变：一个动作都不做
    var kinds = allKinds(), i, k, n = 0;
    if (war) {
      /* 快照战前的档位：停战时原样还回去（玩家/AI 之前怎么调的，恢复就怎么调） */
      var prev = {};
      for (i = 0; i < kinds.length; i++) prev[kinds[i]] = rep.prio(cid, kinds[i]);
      /* 护栏优先：军费已经吃掉 90% 岁入的国家，换挡时连军备也不升档 ——
       * 那是"要破产了"的信号（这一档 guard 每回合还会再压一次，见 guardMil）。 */
      var broke = milRatioOf(cid) > (AO.AIWAR.guard.hardShare || 0.9);
      for (i = 0; i < kinds.length; i++) {
        k = kinds[i];
        var cls = kindClass(W, k);
        var want = cls === 'mil' ? (broke ? (AO.AIWAR.guard.lowPrio || 'p3') : W.milPrio)
          : (cls === 'res' ? W.resPrio : W.civPrio);
        if (rep.prio(cid, k) !== want && rep.setPrio(cid, k, want)) n++;
      }
      WECON[cid] = { war: true, prev: prev, turn: D.turn() };
    } else {
      /* 停战恢复：只还"这一轮真的改过"的项；没有快照就什么都不做 */
      if (st && st.prev) {
        for (k in st.prev) {
          if (rep.prio(cid, k) !== st.prev[k] && rep.setPrio(cid, k, st.prev[k])) n++;
        }
      }
      WECON[cid] = { war: false, prev: null, turn: D.turn() };
    }
    return n;
  }
  /* 战时俸禄照付不欠（§9 ③）：省库发不出俸禄时，从**中央**补上，owed 清零。
   * 只在交战中做，而且中央要留 topUpReserve —— 这不是"加薪"，是"别欠"：
   * 欠饷的惩罚（怨气 +2/回合）已经写在 GOV.griev 里，AI 不该一边打仗一边欠薪。
   * 护栏优先：中央连 reserve 都不够时一分不补（宁可欠着，也不掏空国库）。 */
  function payOwedAtWar(cid) {
    var W = AO.AIWAR && AO.AIWAR.warEcon, D = AO.resDebug, G = AO.GOV;
    if (!W || !G || !G.griev) return 0;
    if (!atWarWithSomeone(cid)) return 0;
    var provs = provsOf(cid), cen = D.ensureCentral(cid), n = 0, i;
    var reserve = W.topUpReserve || 20;
    for (i = 0; i < provs.length; i++) {
      var off = AO.resOfficial[provs[i].id];
      if (!off || !(off.owed > 0)) continue;
      var room = (cen.gold || 0) - reserve;
      if (room <= 0) break;
      var pay = Math.min(off.owed, room);
      var bag = AO.resSim[provs[i].id];
      if (!bag || !bag.gold) continue;
      cen.gold -= pay;
      bag.gold.stock += pay;
      off.owed -= pay;
      n++;
    }
    return n;
  }


  /* =============================================================
   * v10：AI 互战 / 迷雾消费 / 性格 × 外交
   *
   * 这一批解除最后两条约束：① 不主动进攻、② 敌国之间不打。
   * 六件事，每国每回合按这个顺序走一遍：
   *
   *   军费护栏 → 回撤 → 求和 → 进攻 → 宣战 → 贸易
   *
   * 为什么"护栏"排第一：先算清楚自己养不养得起兵，再决定打不打。
   * 为什么"宣战"排在"进攻"之后：这一回合刚宣的战，下回合才出兵 ——
   *   同一回合既宣又打的话，边境上那支驻防军会当场变成"越境奇袭"，
   *   战报里读起来像瞬移。
   *
   * 三条纪律照旧（和 v7 一样，一个字没松）：
   *   ① 只在 PLAYER > 0 时运行；
   *   ② 只用自己的数据 —— **行军目标只从自己的已探集（AIKNOW）里挑**，
   *      军力比里对方的兵力也只算自己探过的省（看不见的兵不算数）；
   *   ③ 一律 silent。唯一的例外是「世界纪要」（那是玩家该知道的远方大事），
   *      而且每回合最多 2 条。
   * ============================================================= */

  /* 运行时统计（不进档）：bench 策略 H 与 test/ai-war.js 都读这一份 */
  var WSTAT = {
    declare: 0,        // 累计宣战次数
    attack: 0,         // 累计下达的进攻命令数
    badTarget: 0,      // 目标不在已探集里的次数（**必须永远是 0**）
    retreat: 0,        // 回撤次数
    peace: 0,          // 成交的求和次数
    guard: 0,          // 军费护栏触发次数
    trade: 0,          // 成交的外国买货次数
    wars: 0,           // 当前战争数（每回合刷新）
    deaths: 0,         // 已灭国数
    news: 0            // 累计放出的世界纪要条数
  };
  var LOSING = Object.create(null);   // 'a|b' → 连续落后的回合数（求和用）
  var MILG = Object.create(null);     // cid → { turn, ratio, act }（护栏留痕）
  var DCL = Object.create(null);      // cid → 累计宣战次数（bench 按 warBias 分位看它）
  var LASTDEATH = -999;               // 上次有国家灭亡的回合（阻尼用）

  function warsOf(cid) {
    var W = AO.resWar && AO.resWar.wars, out = [], k;
    if (!W) return out;
    cid = cid | 0;
    for (k in W) {
      if (!W[k]) continue;
      var ab = k.split('|'), a = +ab[0], b = +ab[1];
      if (a === cid) out.push(b);
      else if (b === cid) out.push(a);
    }
    return out;
  }
  function warCount() {
    var W = AO.resWar && AO.resWar.wars, n = 0, k;
    for (k in W) if (W[k]) n++;
    return n;
  }
  /* AI 的已探集：'pid' → 回合。11-ui 的 see() 在行军 / 会战 / 围城 / 轰击时写它，
   * 情报署的自动织网也写它。**这张表就是 AI 的眼睛**。 */
  function aiKnow(cid) {
    var T = AO.resDebug && AO.resDebug.fogAiKnow;
    return (T && T[cid | 0]) || null;
  }
  function knows(cid, pid) {
    var K = aiKnow(cid);
    return !!(K && K[pid | 0]);
  }
  /* 军力：自己的兵算全，别人的兵只算"我探过的省里那些" + 国家级规模估计。
   * 这一条是"AI 吃迷雾"最硬的地方 —— 看不见的兵不进算式。 */
  function powerOf(cid, viewer) {
    var A = AO.AIWAR, D = AO.resDebug, sum = 0, i;
    var list = D.armiesOf(cid | 0);
    for (i = 0; i < list.length; i++) {
      if (viewer && !knows(viewer, list[i].pid)) continue;
      sum += list[i].men || 0;
    }
    var c = countryOf(cid);
    sum += (c ? c.provinces.length : 0) * (A.powPerProv || 300);
    return sum;
  }
  function incomeOf(cid) {
    var F = (AO.resDebug && AO.resDebug.flow) || {}, list = provsOf(cid), sum = 0, i;
    for (i = 0; i < list.length; i++) {
      var f = F[list[i].id];
      if (f && f.gain && f.gain.gold) sum += f.gain.gold;
    }
    return sum;
  }
  function stockTotal(cid, key) {
    var D = AO.resDebug, list = provsOf(cid), sum = 0, i;
    var cen = D.ensureCentral(cid);
    sum += (cen[key] || 0);
    for (i = 0; i < list.length; i++) sum += D.stockOf(list[i].id, key);
    return sum;
  }

  /* ---------------- ① 宣战决策 ---------------- */
  function declareScore(cid, foe, q, per) {
    var A = AO.AIWAR, S = A.score, D = AO.resDebug;
    var rel = D.relOf(cid, foe);
    var s = (q.war || 1) * S.wWar + (S.persona[per] || 0);
    if (rel < S.hostileRel) s += S.hostileAdd;
    var busy = warsOf(foe).length > 0;
    if (busy) s += S.busyAdd;
    return { score: s, rel: rel, busy: busy };
  }
  /* 阻尼：任一国灭亡后 damp.afterDeath 回合内，全球战争数还 ≥ damp.wars
   * → 所有 AI 的宣战门槛 +damp.add。打完一个大国之后世界该喘口气。 */
  function dampAdd() {
    var A = AO.AIWAR;
    if (!A || !A.damp) return 0;
    if (AO.resDebug.turn() - LASTDEATH > A.damp.afterDeath) return 0;
    return warCount() >= A.damp.wars ? A.damp.add : 0;
  }
  function tryDeclare(cid, per, q) {
    var A = AO.AIWAR, D = AO.resDebug, turn = D.turn();
    if (turn % A.every !== (cid % A.every)) return 0;     // 各国错开，免得同回合一起动手
    if (warsOf(cid).length >= A.maxWars) return 0;
    var cd = D.peaceCd || {}, thr = A.threshold + dampAdd();
    var provs = provsOf(cid), best = 0, bestS = -1e9, i, j;
    var seen = Object.create(null);
    for (i = 0; i < provs.length; i++) {
      var nb = provs[i].neighbors || [];
      for (j = 0; j < nb.length; j++) {
        var q2 = D.world().provinces[nb[j] - 1];
        if (!q2 || !q2.owner || q2.owner === cid) continue;
        var foe = q2.owner | 0;
        if (seen[foe] || deadOf(foe)) continue;
        seen[foe] = 1;
        if (D.atWar(cid, foe)) continue;
        if (AO.resIsAlly && AO.resIsAlly(cid, foe)) continue;   // 不打盟友
        if (AO.resIsNap && AO.resIsNap(cid, foe)) continue;     // 不打互不侵犯对象
        if ((cd[cid < foe ? cid + '|' + foe : foe + '|' + cid] || 0) > turn) continue;  // 停战冷却
        var sc = declareScore(cid, foe, q, per);
        if (sc.score < thr) continue;
        /* 军力比一票否决：打不过就别打（对方的兵只算我探过的） */
        var mine = powerOf(cid, 0), theirs = powerOf(foe, cid);
        if (mine < theirs * A.powerRatio) continue;
        if (sc.score > bestS) { bestS = sc.score; best = foe; }
      }
    }
    if (!best) return 0;
    D.declareWar(cid, best);
    WSTAT.declare++;
    DCL[cid] = (DCL[cid] || 0) + 1;
    return 1;
  }

  /* ---------------- ② 进攻 ---------------- */
  /* 机动军比例：QUIRK.war 归一化到 0~1 之后取档（见 AO.AIWAR.attack 的注释） */
  function attackRatio(war) {
    var A = AO.AIWAR.attack, Q = (AO.AIECON && AO.AIECON.quirk) || { lo: 0.8, hi: 1.2 };
    var lo = Q.lo || 0.8, hi = Q.hi || 1.2;
    var n = ((war || 1) - lo) / Math.max(0.0001, hi - lo);
    if (n >= A.high) return A.highPct;
    if (n >= A.mid) return A.midPct;
    return 0;
  }
  /* 这块地是不是贴着我方（陆军要走得过去，就得有一条从自家省出发的陆路） */
  function touchesMine(p, cid) {
    var nb = p.neighbors || [], i;
    for (i = 0; i < nb.length; i++) {
      var q = AO.resDebug.world().provinces[nb[i] - 1];
      if (q && q.owner === (cid | 0)) return true;
    }
    return false;
  }
  /* 目标只从**自己的已探集**里挑（spec ③）。
   * 打分：没守军的最好、离得近的好、对方都城额外加分。 */
  function pickTarget(cid, army) {
    var D = AO.resDebug, w = D.world(), K = aiKnow(cid);
    if (!w || !K) return 0;
    var me = w.provinces[army.pid - 1], best = 0, bestS = -1e9;
    for (var key in K) {
      var pid = key | 0;
      var p = w.provinces[pid - 1];
      if (!p || p.owner === (cid | 0)) continue;
      if (!D.atWar(cid, p.owner)) continue;
      if (!touchesMine(p, cid)) continue;
      var foes = D.armiesIn(pid), def = 0, i;
      for (i = 0; i < foes.length; i++) if (foes[i].owner !== (cid | 0)) def += foes[i].men || 0;
      var s = 100 - def / 50;
      var cc = countryOf(p.owner);
      if (cc && cc.capital === pid) s += 40;
      if (me && p.centroid) {
        var dx = p.centroid[0] - me.centroid[0], dy = p.centroid[1] - me.centroid[1];
        s -= Math.sqrt(dx * dx + dy * dy) / 100;
      }
      if (s > bestS) { bestS = s; best = pid; }
    }
    return best;
  }
  function tryAttack(cid, per, q) {
    var A = AO.AIWAR.attack, D = AO.resDebug;
    if (per === 'econ') return 0;                    // 经营不进攻（spec ②）
    var ratio = attackRatio(q.war);
    if (ratio <= 0) return 0;
    if (!warsOf(cid).length) return 0;
    var list = D.armiesOf(cid).filter(function (a) { return a.type === 'army'; });
    if (!list.length) return 0;
    var isAttacking = function (a) {
      return !!(a.order && (a.order.type === 'attack' || a.order.type === 'siege'));
    };
    var going = list.filter(isAttacking);
    var want = Math.min(A.maxArmies, Math.max(1, Math.round(list.length * ratio)));
    if (going.length >= want) return 0;
    var cands = list.filter(function (a) { return !isAttacking(a); })
      .sort(function (x, y) { return (y.men || 0) - (x.men || 0); });
    var n = 0, i;
    for (i = 0; i < cands.length && going.length < want; i++) {
      var a = cands[i];
      if ((a.men || 0) < 1000) continue;             // 残兵先补员，别送人头
      var tgt = pickTarget(cid, a);
      if (!tgt) break;
      var p = D.world().provinces[tgt - 1];
      /* 断言（spec ③）：目标必须在自己已探集里。真的走不到就记一笔，
       * bench 与测试会读 WSTAT.badTarget —— 它必须是 0。 */
      if (!knows(cid, tgt)) WSTAT.badTarget++;
      a.aiHome = a.aiHome || a.pid;
      a.aiMen0 = a.men;
      a.order = { type: 'attack', cid: p.owner, pid: tgt, tactic: A.tactic[per] || 'assault' };
      going.push(a);
      WSTAT.attack++;
      n++;
    }
    return n;
  }
  /* 兵损过半 / 仗打完了 → 停止推进。
   * "回撤"在本批只能做到"停手"：现有命令里没有"走回某个自家省"这一条
   * （attack 的目标必须是敌省）。所以自己省里就转练兵补员（+2%/回合），
   * 敌省里就转驻防守着 —— 不新写战斗代码，这是 spec ② 的原话。 */
  function tryRetreat(cid) {
    var A = AO.AIWAR.attack, D = AO.resDebug;
    var list = D.armiesOf(cid), n = 0, i;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.order || (a.order.type !== 'attack' && a.order.type !== 'siege')) continue;
      if (!a.aiMen0) continue;
      var lost = (a.men || 0) < a.aiMen0 * (A.retreatLoss || 0.5);
      var over = !a.order.cid || !D.atWar(cid, a.order.cid);
      if (!lost && !over) continue;
      var p = D.world().provinces[a.pid - 1];
      var home = p && p.owner === (cid | 0);
      a.order = home
        ? { type: 'train', cid: cid, pid: a.pid }
        : { type: 'defend', cid: cid, pid: a.pid, tactic: 'assault' };
      a.aiMen0 = 0;
      WSTAT.retreat++;
      n++;
    }
    return n;
  }

  /* ---------------- ④ 求和（性格 × 外交） ----------------
   * 落后 ≥ behind 且连续 turns 回合 → 主动求和，赔款从自家国库出。
   * 胜方答不答应看 peaceScore：把 AO.aiPeaceEval 的四个输入（战况/性格/民心/要价）
   * 里那个"要价"换成"赔款的分量"—— 玩家桌上的要价是"你得再多赢我 15 分"，
   * AI 之间的赔款是"我拿钱换命"，两回事。 */
  function peaceScore(winner, loser, pay) {
    var A = AO.AIWAR.peace;
    var ev = AO.resDebug.aiPeaceEval ? AO.resDebug.aiPeaceEval(winner, loser) : null;
    if (!ev) return { score: -999, ev: null };
    /* 赢家的**优势**（mine − theirs，正数）是它继续打下去的理由，所以带负号；
     * 这一项封顶（A.deficitCap）：胃口有上限，见 AIWAR.peace 的注释。
     * 曾经写成 theirs − mine（符号反了）—— 结果是"赢得越多越不想停"，
     * 战争永远以灭国收场，一局 100 回合能死掉半个世界。 */
    var adv = Math.max(0, ev.mine - ev.theirs);
    var def = Math.min(A.deficitCap || 45, adv);
    var score = -def + ev.persona + ev.press + (pay || 0) / (A.payWeight || 2);
    return { score: score, ev: ev, def: def, adv: adv };
  }
  function tryPeace(cid) {
    var A = AO.AIWAR.peace, D = AO.resDebug, wars = warsOf(cid), n = 0, i;
    for (i = 0; i < wars.length; i++) {
      var foe = wars[i];
      /* 键**带方向**（cid>foe）：这一格记的是"我连续几回合落后于它"。
       * 用无序对的话，赢家那一趟循环会走进 else 分支把败方的计数删掉 ——
       * 双方每回合各跑一次，计数永远卡在 1，求和就成了死代码。 */
      var key = cid + '>' + foe;
      var mine = D.wsScoreOf(cid, foe), theirs = D.wsScoreOf(foe, cid);
      if (mine - theirs > -A.behind) { delete LOSING[key]; continue; }
      LOSING[key] = (LOSING[key] || 0) + 1;
      if (LOSING[key] < A.turns) continue;
      /* 赔款从**全境**出（中央 + 各省省库）：AI 的钱大多在省里，
       * 只看中央的话它连 50 金都掏不出，求和永远成不了。
       * 档位跟着绝望程度走：落后 1 档赔 50，2 档赔 100，3 档赔 150 ——
       * 战况越惨，越该破财免灾（这也让"越惨越买不起和平"的荒诞感消失：
       * 赔款随分数线性涨，抵消掉一部分"赢家胃口也随分数涨"）。 */
      var tiers = Math.max(1, Math.ceil((theirs - mine) / A.behind));
      var want = A.pay * tiers;
      var pay = Math.min(want, Math.max(0, Math.floor(stockTotal(cid, 'gold'))));
      var sc = peaceScore(foe, cid, pay);
      if (sc.score < 0) continue;
      var r = D.aiPeace(cid, foe, pay);
      if (r && r.ok) { WSTAT.peace++; delete LOSING[key]; n++; }
    }
    return n;
  }

  /* ---------------- ④b 贸易（AI 内政买货走外国货源） ----------------
   * 只在"这种资源全国见底、手里还有金、有市场"的时候买 —— 那是应急口，
   * 不是稳定的进货渠道（和玩家的买货同一个定位）。经营型看得最勤。 */
  function tryTrade(cid, per) {
    var T = AO.AIWAR.trade, D = AO.resDebug;
    var every = T.every[per] || 6;
    if ((D.turn() + cid) % every !== 0) return 0;
    var provs = provsOf(cid), i, k;
    for (k = 0; k < T.keys.length; k++) {
      var key = T.keys[k];
      if (stockTotal(cid, key) >= T.minStock) continue;
      var best = null, bestG = 0;
      for (i = 0; i < provs.length; i++) {
        var mk = AO.resMarket && AO.resMarket[provs[i].id];
        if (!mk || !(mk.n > 0) || mk.halted) continue;
        var g = D.stockOf(provs[i].id, 'gold');
        if (g > bestG) { bestG = g; best = provs[i]; }
      }
      if (!best || bestG < T.minGold) continue;
      var srcs = D.foreignSources ? D.foreignSources(best, key) : [];
      if (!srcs.length) continue;
      /* 挑关系最好的那家（同关系时按货量，foreignSources 已经按货量排过） */
      var pick = srcs[0];
      for (i = 0; i < srcs.length; i++) if (srcs[i].rel > pick.rel) pick = srcs[i];
      var r = D.aiBuy(best, key, pick.cid);
      if (r && r.ok) { WSTAT.trade++; return 1; }
    }
    return 0;
  }

  /* ---------------- ⑥ 军费护栏 ----------------
   * AI 没有真正的"军饷"（征兵一次性扣钱，之后只吃粮），所以这里用**名义军费**
   * 做决策护栏：men/1000 × upkeepGoldPerK 当这一国每回合的军费，
   * 和它上回合的实际金收入比。超了就削：
   *   ① 机动军全部转驻防（先停进攻）
   *   ② 非军备建筑降档（AO.rep.setPrio → p3：只吃本省库存，不动中央）
   * 超 hardShare 连军备建筑也一起降 —— 那是"要破产了"的信号。 */
  function guardMil(cid, per) {
    var G = AO.AIWAR.guard, D = AO.resDebug;
    if (D.turn() < 4) return 0;
    var list = D.armiesOf(cid), men = 0, i;
    for (i = 0; i < list.length; i++) men += list[i].men || 0;
    if (!men) return 0;
    var upkeep = men / 1000 * G.upkeepGoldPerK;
    var inc = incomeOf(cid);
    if (inc <= 0) return 0;
    var ratio = upkeep / inc;
    if (ratio <= G.milShare) return 0;
    var act = [];
    var back = 0;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.order || (a.order.type !== 'attack' && a.order.type !== 'siege')) continue;
      a.order = { type: 'defend', cid: cid, pid: a.pid, tactic: 'assault' };
      a.aiMen0 = 0;
      back++;
    }
    if (back) act.push('停进攻 ' + back + ' 支');
    var rep = AO.rep;
    if (rep && rep.setPrio) {
      /* 用 allKinds()（含兵营/军械坊…）而不是 rep.kinds()：
       * 军备建筑不在维修面板那张表上，但维护照付、优先档照读 ——
       * 不列进来的话"超 90% 连军备一起降"这条永远落不了地。 */
      var kinds = allKinds(), cut = 0;
      var hard = ratio > G.hardShare;
      for (i = 0; i < kinds.length; i++) {
        var kind = kinds[i];
        if (!hard && G.keepKinds.indexOf(kind) >= 0) continue;
        if (rep.prio(cid, kind) === G.lowPrio) continue;
        rep.setPrio(cid, kind, G.lowPrio);
        cut++;
      }
      if (cut) act.push('降档 ' + cut + ' 类');
    }
    if (!act.length) return 0;
    MILG[cid] = { turn: D.turn(), ratio: ratio, act: act.join(' · ') };
    WSTAT.guard++;
    /* 护栏也要"可见"：每 20 回合最多报一次，免得纪要变成军费流水账 */
    if (D.turn() - (MILG[cid].last || -99) >= 20) {
      MILG[cid].last = D.turn();
      if (AO.resWorldNews) {
        AO.resWorldNews(nameOfAi(cid) + ' 削减军费：常备军吃掉 ' + Math.round(ratio * 100) +
          '% 岁入（' + act.join('、') + '）', 'warn');
      }
    }
    return 1;
  }
  function nameOfAi(cid) {
    var c = countryOf(cid);
    return c ? c.name : ('#' + cid);
  }

  /* ---------------- 一国一回合的战争格 ---------------- */
  function aiWarCountry(c, per, q) {
    var cid = c.id, n = 0;
    n += guardMil(cid, per);
    n += tryRetreat(cid) ? 1 : 0;
    n += tryPeace(cid) ? 1 : 0;
    n += tryAttack(cid, per, q) ? 1 : 0;
    n += tryDeclare(cid, per, q) ? 1 : 0;
    n += tryTrade(cid, per) ? 1 : 0;
    return n;
  }

  /* 灭国数要每回合数一遍（DEAD 表是唯一出处）；比上次多就记下回合 —— 阻尼读它 */
  function syncDeaths() {
    var D = AO.resDebug, dead = D.deadMap || {}, n = 0, k;
    for (k in dead) if (dead[k]) n++;
    if (n > WSTAT.deaths) { WSTAT.deaths = n; LASTDEATH = D.turn(); }
    else if (n < WSTAT.deaths) WSTAT.deaths = n;     // 换世界 / 读档
    return n;
  }

  /* 每回合一次，挂在 tick() 的末尾（结算尾、情报 tick 之后） */
  function warTick() {
    if (!AO.AIWAR) return 0;
    if (!AO.resDebug || AO.resDebug.player() <= 0) return 0;   // 工坊模式：AI 全静止
    var w = syncWorld();
    if (!w || !w.countries) return 0;
    syncDeaths();
    WSTAT.wars = warCount();
    var played = 0, i;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === AO.resDebug.player()) continue;
      if (deadOf(c.id)) continue;
      if (!provsOf(c.id).length) continue;
      played += aiWarCountry(c, personaOf(c.id), quirkOf(c.id));
    }
    return played;
  }
  AO.aiWarTick = warTick;

  /* ---------------- 一回合：一国最多 actPerTurn 个动作 ---------------- */
  function aiCountry(c) {
    var E = AO.AIECON, cid = c.id, per = personaOf(cid);
    var did = Object.create(null);
    var n = 0;
    for (var slot = 0; slot < (E.actPerTurn || 2); slot++) {
      var acted = false;
      /* 建造：每回合最多 buildPerTurn 座（默认 1）—— 这一格不做，第二格再试 */
      if (!did.build && n < (E.buildPerTurn || 1) && tryBuild(cid, per)) {
        did.build = true; acted = true; n++;
      } else if (!did.research && tryResearch(cid)) {
        did.research = true; acted = true;
      } else if (!did.tax && tryTax(cid, per)) {
        did.tax = true; acted = true;
      } else if (!did.off && tryOfficers(cid, per)) {
        did.off = true; acted = true;
      }
      if (!acted) break;          // 这一格什么都做不了 → 后面的格子更做不了
    }
    return n;
  }

  /* 每回合一次，挂在战争段之后 / 情报 tick 之后（11-ui.js 的 settleTurn ⓫ 前） */
  function tick() {
    if (!AO.AIECON) return 0;
    if (!AO.resDebug || AO.resDebug.player() <= 0) return 0;   // 工坊模式：AI 全静止
    var w = syncWorld();
    if (!w || !w.countries) return 0;
    var played = 0, i;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === AO.resDebug.player()) continue;       // 玩家国不归 AI 管
      if (deadOf(c.id)) continue;
      if (!provsOf(c.id).length) continue;
      personaOf(c.id);                                          // 老存档：顺手把性格补上
      played += aiCountry(c);
    }
    /* v11 战时换挡：宣战 / 停战之后**一回合内**改维修优先档、补上欠俸。
     * 排在内政之后（这一回合的建造已经按上回合的战况做完）、战争之前
     * （warTick 里的 guardMil 必须能盖掉换挡 —— 护栏优先）。 */
    played += ecoTick();
    /* v10：内政走完再走战争格（军费护栏 → 回撤 → 求和 → 进攻 → 宣战 → 贸易）。
     * 排在内政之后：这一回合刚盖好的兵营/军械坊，下回合才影响战局；
     * 也排在世界纪要 flush 之前 —— 纪要要收这一回合新打起来的仗。 */
    played += warTick();
    /* v11 吏部巡查：排在战争之后 —— 战时的"赏赐只保 rank≥2"要看这一回合的战况。 */
    played += govTick();
    return played;
  }

  /* 换挡 / 补俸：只跑 AI 国（玩家自己的维修档位由玩家自己调，AI 不代劳） */
  function ecoTick() {
    var w = world();
    if (!w || !w.countries) return 0;
    var n = 0, i;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === AO.resDebug.player()) continue;
      if (deadOf(c.id) || !provsOf(c.id).length) continue;
      n += warEcon(c.id, personaOf(c.id));
      n += payOwedAtWar(c.id);
    }
    return n;
  }
  /* 吏部巡查：每国每回合走一遍（不吃内政的两个动作格 —— 治官不是治国） */
  function govTick() {
    var w = world();
    if (!w || !w.countries) return 0;
    var n = 0, i;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === AO.resDebug.player()) continue;
      if (deadOf(c.id) || !provsOf(c.id).length) continue;
      n += aiGovPatrol(c, personaOf(c.id));
    }
    return n;
  }

  /* ---------------- 存档：性格 + 怪癖 ----------------
   * 不升版本号，只加字段（任务书要求）。形状：
   *   { p: { cid: 'econ' | … }, q: { cid: { build, tax, research, war } } }
   * **兼容上一版**（那版存的是扁平的 { cid: 'econ' }）：loadState 认两种形状，
   * 读到扁平表就只灌性格、怪癖留空（第一次被问到时按 seed+cid 补上）。
   * 所以"读到旧档"和"新开一局"还是同一条路，不写迁移函数。 */
  function saveState() {
    syncWorld();
    var p = Object.create(null), q = Object.create(null), k;
    for (k in PERSONA) p[k] = PERSONA[k];
    /* 怪癖只存**真掷过**的国（没问过的国不占档；第一次问到时补） */
    for (k in QUIRK) q[k] = QUIRK[k];
    return { p: p, q: q };
  }
  function loadState(d) {
    /* 先 syncWorld：读档是"按 seed 重建世界 → 灌状态"，
     * 到这一步 PERSONA_W 通常还指着读档前的那个世界对象。不先对齐的话，
     * 下一次 tick 的 syncWorld 会以为"换世界了"，把刚读回来的性格整表清掉 ——
     * 症状是"读档后所有国家性格全变"，而且只在真读档（不是测试直调）时出现。 */
    syncWorld();
    for (var k in PERSONA) delete PERSONA[k];
    for (var qk in QUIRK) delete QUIRK[qk];
    if (!d) return;
    /* 两种形状：新版 { p, q } / 旧版扁平的 { cid: 'econ' } */
    var p = d.p || d, q = d.q || null, c;
    for (c in p) {
      var v = p[c];
      if (v === 'econ' || v === 'balanced' || v === 'mil') PERSONA[c | 0] = v;
    }
    if (q) {
      for (c in q) {
        var o = q[c];
        if (!o || typeof o !== 'object') continue;
        var out = { build: 1, tax: 1, research: 1, war: 1 }, bad = false;
        for (var f in out) {
          var n = +o[f];
          if (isFinite(n) && n > 0) out[f] = Math.min(1.6, Math.max(0.6, n));
          else bad = true;
        }
        /* 四个都是默认值 = 这一条没有信息量，不占内存（等同"还没掷过"） */
        if (!bad) QUIRK[c | 0] = out;
      }
    }
  }

  /* ---------------- 给 bench / 测试的只读出口 ----------------
   * 按性格分组汇总（每国平均 / 全国的极值）。bench 策略 G 的曲线就吃这一份 ——
   * 宁可在这里多算两个极值，也不让 bench 自己去翻内部表（那样一改结构就散架）。 */
  function groups() {
    var w = world(), out = Object.create(null), l = personaList(), i;
    for (i = 0; i < l.length; i++) {
      out[l[i].key] = { key: l[i].key, cn: l[i].cn, n: 0,
        school: 0, market: 0, barracks: 0, granary: 0, factory: 0, university: 0,
        smelt: 0, tech: 0, gold: 0, happy: 0, tax: 0, off: 0,
        halt: 0, cenGold: 0, cenMax: 0, happyMin: 100,
        /* 方差线：同性格国家之间"建校 / 加税"时机的标准差（样本不足 2 个 = 0） */
        schoolSd: 0, taxSd: 0, _st: [], _tt: [] };
    }
    if (!w) return out;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || deadOf(c.id) || !c.provinces || !c.provinces.length) continue;
      var g = out[personaOf(c.id)];
      if (!g) continue;
      var list = provsOf(c.id), gsum = 0, hsum = 0, wn = 0, j, hMin = 100, sm = 0;
      for (j = 0; j < list.length; j++) {
        gsum += stockOf(list[j].id, 'gold');
        var h = AO.resHappyOf(list[j].id).v, pw = popOf(list[j].id) || 1;
        hsum += h * pw; wn += pw;
        if (h < hMin) hMin = h;
        if (AO.resOfficial[list[j].id]) g.off++;
        /* 熔旧坊：AI 省的枯竭矿有没有被改建成炉（验收要看它出现） */
        var smt = AO.resSmelt && AO.resSmelt[list[j].id];
        if (smt) sm += smt.n || 0;
        /* 停产（维护欠费）的座数：AI 铺太快的第一征兆就是它往上窜 */
        var kinds = ['school', 'market', 'barracks', 'armory', 'granary', 'factory'];
        for (var kk = 0; kk < kinds.length; kk++) {
          var tb = univTable(kinds[kk]), stx = tb && tb[list[j].id];
          if (stx && stx.halted && stx.n > 0) g.halt += stx.n;
        }
      }
      var R = AO.resResearch[c.id];
      var cen = AO.resDebug.ensureCentral(c.id);
      g.n++;
      g.school += univCount(c.id, 'school');
      g.market += univCount(c.id, 'market');
      g.barracks += univCount(c.id, 'barracks');
      g.granary += univCount(c.id, 'granary');
      g.factory += univCount(c.id, 'factory');
      g.university += univCount(c.id, 'university');
      g.smelt += sm;
      g.tech += R && R.done ? Object.keys(R.done).length : 0;
      g.gold += wn ? gsum / list.length : 0;
      g.happy += wn ? hsum / wn : 60;
      if (hMin < g.happyMin) g.happyMin = hMin;
      g.cenGold += (cen.gold || 0);
      if ((cen.gold || 0) > g.cenMax) g.cenMax = cen.gold || 0;
      g.tax += AO.resTaxRateOf(c.id);
      /* 方差线的样本：这一国的"建校回合 / 首次加税回合"（0 = 还没发生） */
      var st = STAT[c.id];
      if (st && st.school) g._st.push(st.school);
      if (st && st.taxUp) g._tt.push(st.taxUp);
    }
    for (var k in out) {
      var q = out[k];
      if (!q.n) continue;
      /* 座数 / 科研 / 官员保持**全国合计**（bench 自己除国数）——
       * 和上一版口径一致，改口径会让历史 bench 表不可比 */
      q.gold /= q.n; q.happy /= q.n; q.tax /= q.n; q.cenGold /= q.n;
      q.schoolSd = sd(q._st);
      q.taxSd = sd(q._tt);
      q.schoolN = q._st.length; q.taxN = q._tt.length;
      delete q._st; delete q._tt;
    }
    return out;
  }
  /* 样本标准差（n−1 分母；样本 < 2 返回 0） */
  function sd(a) {
    if (!a || a.length < 2) return 0;
    var m = 0, i;
    for (i = 0; i < a.length; i++) m += a[i];
    m /= a.length;
    var s = 0;
    for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }

  AO.aiEconTick = tick;
  AO.aiEconSave = saveState;
  AO.aiEconLoad = loadState;
  AO.aiPersonaView = personaView;
  AO.aiDebug = {
    persona: PERSONA,
    personaOf: personaOf,
    personaCn: personaCn,
    setPersona: setPersona,
    /* 本批新增：怪癖 / 顺序 / 统计 / 可见性 */
    quirk: QUIRK,
    quirkOf: quirkOf,
    topQuirk: topQuirk,
    orderOf: orderOf,
    orderOf_: function (cid) { return orderOf(cid, personaOf(cid)).slice(); },
    stat: STAT,
    view: personaView,
    weights: function (govKey) { return personaWeights(govKey || ''); },
    govKeyOf: govKeyOf,
    /* v10：互战 / 迷雾 / 性格×外交（test/ai-war.js 与 bench H 只从这里进） */
    war: WSTAT,
    warTick: warTick,
    warsOf: warsOf,
    warCount: warCount,
    aiKnow: aiKnow,
    knows: knows,
    powerOf: powerOf,
    incomeOf: incomeOf,
    declareScore: declareScore,
    declare: tryDeclare,
    attackRatio: attackRatio,
    attack: tryAttack,
    pickTarget: pickTarget,
    retreat: tryRetreat,
    peace: tryPeace,
    peaceScore: peaceScore,
    trade: tryTrade,
    guard: guardMil,
    milGuard: MILG,
    losing: LOSING,
    dcl: DCL,
    damp: dampAdd,
    /* v11：吏部 / 战时经济（test/ai-gov.js 只从这里进） */
    gov: aiGovPatrol,
    govTick: govTick,
    fill: aiFillVacancy,
    fireLine: aiFireLine,
    rewardLine: aiRewardLine,
    warEcon: warEcon,
    wecon: WECON,
    ecoTick: ecoTick,
    payOwed: payOwedAtWar,
    milRatio: milRatioOf,
    canRecruit: canRecruit,
    allKinds: allKinds,
    /* 单步入口（测试用）：只做一件事，不走"每回合两格"的调度 */
    build: tryBuild,
    buildOrder: function (cid) { return buildOrderOf(cid, personaOf(cid), false); },
    smelt: trySmelt,
    research: tryResearch,
    tax: tryTax,
    officers: tryOfficers,
    rollWith: rollPersonaWith,
    tick: tick,
    country: aiCountry,
    groups: groups,
    provsOf: provsOf,
    univCount: univCount,
    consts: function () { return AO.AIECON; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
