/* =============================================================
 * 18-ai.js —— 敌国内政 AI（v7）
 *
 * 敌国 AI 原本被三条约束捆着：
 *   ① 不主动进攻   ② 敌国之间不打   ③ 不动经济
 * 本批只解除 ③ —— ① 仍然只有 aiDefend 的"民兵动员"，② 等外交落地。
 * 于是这张地图上开始有别的事在发生：学校一座座盖起来、科研条在涨、
 * 官员一个个派下去、税率跟着国情自己调。
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

  function personaList() { return (AO.AIECON && AO.AIECON.personas) || []; }
  function personaCn(key) {
    var l = personaList();
    for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i].cn;
    return key || '均衡';
  }
  function rollPersona(cid) {
    var l = personaList(), total = 0, i;
    if (!l.length) return 'balanced';
    for (i = 0; i < l.length; i++) total += l[i].w || 0;
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
   *   经营  学校（全国 < 省数/3）→ 市场 → 建造坊 → 粮仓 → 军械坊（有铁）
   *   均衡  学校 → 市场 → 建造坊 → 兵营（交战中优先）→ 军械坊
   *   军国  兵营 → 军械坊 → 学校 → 市场
   *
   * 三条硬门（顺序就是"先别把自己搞垮"的顺序）：
   *   ① 中央金 ≥ cost.gold + goldReserve —— 建造是先扣中央再扣省，不加这道闸，
   *      一回合两座就能把国库抽干（36 国 × 每回合都抽，几回合就集体停产）；
   *   ② 这块地这一种**只建一座**（n = 0 且没有工地）—— 全国分散不扎堆，
   *      而且"每省一座"本身就是最均匀的铺法，不用再算距离；
   *   ③ 建厂条件（AO.FACTORY.check）与矿脉不枯 —— 和玩家点 ＋ 读到的是同一句话。
   * 选省：库存最富 / 人口最多者优先。 */
  function buildOrderOf(persona, fighting) {
    var E = AO.AIECON, tbl = E.buildOrder || {};
    var order = (tbl[persona] || tbl.balanced || []).slice();
    if (fighting && persona === 'balanced') {
      var i = order.indexOf('barracks');
      if (i > 0) { order.splice(i, 1); order.unshift('barracks'); }
    }
    return order;
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
      var s = provScore(p, kind);
      if (s > bestS) { bestS = s; best = p; }
    }
    return best;
  }
  function tryBuild(cid, persona) {
    var E = AO.AIECON, D = AO.resDebug;
    var provs = provsOf(cid);
    if (!provs.length) return false;
    var cen = D.ensureCentral(cid);
    var order = buildOrderOf(persona, atWarWithSomeone(cid) > 0);
    var schoolCap = Math.max(1, Math.floor(provs.length / (E.schoolQuotaDiv || 3)));
    var T = AO.resTalentOf(cid), edu = T.total || 0;
    for (var i = 0; i < order.length; i++) {
      var kind = order[i];
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
      if (siteOf(p.id, kind).site > 0) return true;      // 真的开工了才算一个动作
    }
    return false;
  }

  /* ---------------- ② 研究 ----------------
   * 队列空 → 从"没研完、前置已满足、点数买得起、国库料够"的科技里
   * 挑 **pts 最便宜** 的一条入队。走的是既有 queue 机制：
   * 这里只入队，真正的扣费在下一回合的 pullQueue —— 和玩家点节点一模一样，
   * 所以"点错不白花钱"那条保护对 AI 也照样成立。 */
  function tryResearch(cid) {
    var R = AO.resResearch[cid | 0];
    if (!R || R.cur || (R.queue && R.queue.length)) return false;
    if (!R.unlocked) return false;
    var cen = AO.resDebug.ensureCentral(cid), list = AO.TECHS || [], best = null, i, k;
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      if (R.done && R.done[t.key]) continue;
      if (t.req && !(R.done && R.done[t.req])) continue;
      if (R.pts < t.pts) continue;
      var ok = true;
      for (k in t.cost) if ((cen[k] || 0) < t.cost[k]) { ok = false; break; }
      if (!ok) continue;
      if (!best || t.pts < best.pts) best = t;
    }
    if (!best) return false;
    R.queue.push(best.key);
    return true;
  }

  /* ---------------- ③ 调税 ----------------
   * 经营 / 均衡（"不碰横征暴敛"，所以上限就是常规档 1）：
   *   民心 < 45 → 降一档（保民心比多收那点金划算）
   *   民心已回到 45 以上、中央金 > 80 → 升回常规（钱够花就少折腾百姓）
   * 军国（先保命，再穷兵黩武）：
   *   民心 < 35 → 降一档
   *   民心回来了、中央金 < 30 → 拉满档（横征暴敛）
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
    if (persona === 'mil') {
      if (h < (E.milTaxHappy || 35) && cur > 0) want = cur - 1;
      else if (h >= (E.milTaxHappy || 35) && gold < (E.milTaxGold || 30) && cur < 2) want = 2;
    } else {
      if (h < (E.taxDownHappy || 45) && cur > 0) want = cur - 1;
      else if (h >= (E.taxDownHappy || 45) && gold > (E.taxUpGold || 80) && cur < 1) want = 1;
    }
    if (want === cur) return false;
    AO.resDebug.setTax(cid, want);
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
      if (best) {
        var off0 = T.pool[0];
        D.assign(best.id, off0.id, true);
        if (AO.resOfficial[best.id] === off0) { off0.at = turn; return true; }
      }
    }

    /* ③ 武将（池里）→ 派给没将领的军队 —— 武科抽出来就得用，否则人才点白花 */
    var mp = D.milPoolOf ? D.milPoolOf(cid) : [];
    if (mp && mp.length) {
      var need = aiArmyNeedGeneral(cid);
      if (need.length) {
        D.assignGeneral(need[0].id, mp[0].id, true);
        if (need[0].generalId === mp[0].id) return true;
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
    return played;
  }

  /* ---------------- 存档：只存性格 ----------------
   * 不升版本号，只加一个字段（任务书要求）。老档没有 AI 字段 → load(undefined)
   * 什么也不做，personaOf 第一次被问到的时候按 seed+cid 的散列补上，
   * 于是"读到旧档"和"新开一局"是同一条路。 */
  function saveState() {
    syncWorld();
    var out = Object.create(null);
    for (var k in PERSONA) out[k] = PERSONA[k];
    return out;
  }
  function loadState(d) {
    /* 先 syncWorld：读档是"按 seed 重建世界 → 灌状态"，
     * 到这一步 PERSONA_W 通常还指着读档前的那个世界对象。不先对齐的话，
     * 下一次 tick 的 syncWorld 会以为"换世界了"，把刚读回来的性格整表清掉 ——
     * 症状是"读档后所有国家性格全变"，而且只在真读档（不是测试直调）时出现。 */
    syncWorld();
    for (var k in PERSONA) delete PERSONA[k];
    if (!d) return;
    for (var c in d) {
      var v = d[c];
      if (v === 'econ' || v === 'balanced' || v === 'mil') PERSONA[c | 0] = v;
    }
  }

  /* ---------------- 给 bench / 测试的只读出口 ----------------
   * 按性格分组汇总（每国平均 / 全国的极值）。bench 策略 G 的曲线就吃这一份 ——
   * 宁可在这里多算两个极值，也不让 bench 自己去翻内部表（那样一改结构就散架）。 */
  function groups() {
    var w = world(), out = Object.create(null), l = personaList(), i;
    for (i = 0; i < l.length; i++) {
      out[l[i].key] = { key: l[i].key, cn: l[i].cn, n: 0, school: 0, market: 0,
        barracks: 0, tech: 0, gold: 0, happy: 0, tax: 0, off: 0,
        halt: 0, cenGold: 0, cenMax: 0, happyMin: 100 };
    }
    if (!w) return out;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || deadOf(c.id) || !c.provinces || !c.provinces.length) continue;
      var g = out[personaOf(c.id)];
      if (!g) continue;
      var list = provsOf(c.id), gsum = 0, hsum = 0, wn = 0, j, hMin = 100;
      for (j = 0; j < list.length; j++) {
        gsum += stockOf(list[j].id, 'gold');
        var h = AO.resHappyOf(list[j].id).v, pw = popOf(list[j].id) || 1;
        hsum += h * pw; wn += pw;
        if (h < hMin) hMin = h;
        if (AO.resOfficial[list[j].id]) g.off++;
        /* 停产（维护欠费）的座数：AI 铺太快的第一征兆就是它往上窜 */
        var kinds = ['school', 'market', 'barracks', 'armory', 'granary'];
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
      g.tech += R && R.done ? Object.keys(R.done).length : 0;
      g.gold += wn ? gsum / list.length : 0;
      g.happy += wn ? hsum / wn : 60;
      if (hMin < g.happyMin) g.happyMin = hMin;
      g.cenGold += (cen.gold || 0);
      if ((cen.gold || 0) > g.cenMax) g.cenMax = cen.gold || 0;
      g.tax += AO.resTaxRateOf(c.id);
    }
    for (var k in out) {
      var q = out[k];
      if (!q.n) continue;
      q.gold /= q.n; q.happy /= q.n; q.tax /= q.n; q.cenGold /= q.n;
    }
    return out;
  }

  AO.aiEconTick = tick;
  AO.aiEconSave = saveState;
  AO.aiEconLoad = loadState;
  AO.aiDebug = {
    persona: PERSONA,
    personaOf: personaOf,
    personaCn: personaCn,
    setPersona: setPersona,
    tick: tick,
    country: aiCountry,
    groups: groups,
    provsOf: provsOf,
    univCount: univCount,
    consts: function () { return AO.AIECON; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
