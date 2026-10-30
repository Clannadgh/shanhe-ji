/* =============================================================
 * 16b-aoc2-diplo.js —— 庙堂层（阶段四下半）：外交 / 附庸 / 联合统治 / 贸易 / 大国
 *
 * 规则书第十三、十四、十七章。这一层是"不打仗也能改地图"的那一半：
 *   关系值 −100~+100（−100 = 战争）、21 种外交动作、最后通牒、
 *   附庸三途径 + 附庸税 + 独立欲望 + 吞并、联合统治、七类贸易、大国。
 *
 * 为什么所有动作都收在 `A.dip.act(world, a, b, key, arg)` 一个入口：
 * 21 种动作的"要求 / 花费 / 效果"必须能在一张表里读完（规则书十三章那张表），
 * 散成 21 个函数之后，加一种动作要改三处（UI、AI、测试），漏一处就是 bug。
 *
 * 纯逻辑、不碰 DOM：node 里直接跑（test/aoc2-diplo.js）。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});
  AO.aoc2 = AO.aoc2 || {};
  var AOC2 = AO.AOC2;
  var A = AO.aoc2;

  /* =============================================================
   * ① 定义区（改数字只来这里）
   * ============================================================= */
  var D = {
    /* ---- 关系 ---- */
    REL_MIN: -100, REL_MAX: 100,
    IMPROVE_REL: 8,          // 第十三章：改善关系（幅度未给，占位）
    IMPROVE_DIP: 1,
    IMPROVE_GOLD: 500,       // 第十三章：改善关系"花金/外交点"
    IMPROVE_COOL: 10,        // 第十三章：被侮辱后一段时间不能再改善（占位 10 回合）
    INSULT_REL: -15,         // 占位：侮辱一次掉 15
    GIFT_DIP: 0,
    GIFT_GOLD: 2000,         // 占位：送礼基数
    GIFT_REL: 12,            // 占位：送礼成功 +12
    GIFT_LOW_REL: -40,       // 第十三章：关系过低会被拒且关系反降

    /* ---- 条约 ---- */
    NAP_TURNS: 30,           // 占位：互不侵犯 30 回合（和停战期同量级）
    ALLY_REL: 30,            // 占位：提议同盟的关系门槛
    DEF_REL: 40,             // 占位：防御条约门槛
    GUAR_REL: 20,            // 占位：保障独立门槛
    ACCESS_REL: 20,          // 占位：军事通行权门槛
    PACT_BREAK_REL: -20,     // 占位：解除同盟 / 毁约掉多少关系
    /* 同盟 / 互不侵犯的上限（占位）：规则书没给。不加的话 AI 会和每个邻国
     * 都签一遍 —— 实测 200 回合 123 对同盟、123 对互不侵犯，世界变成养老院，
     * 战争、附庸、最后通牒全都不再发生。 */
    ALLY_MAX: 2,
    NAP_MAX: 3,

    /* ---- 最后通牒（第十三章）---- */
    ULTIM_REL: -10,          // 关系 ≤ −10 才能发
    ULTIM_STRENGTH: 3,       // 占位：兵力 / 省数 差 3 倍以上才可能被接受
    ULTIM_REFUSE_REL: -10,   // 占位：被拒之后关系再掉 10
    ULTIM_ANSWER_TURNS: 1,   // 占位：对方几回合内答复（现在即时答复）

    /* ---- 附庸（第十四章）---- */
    VASSAL_TAX: 0.20,        // 第十四章：约 20%〔待核实〕
    INDEP_RISE: 0.02,        // 占位：独立欲望每回合 +2%
    INDEP_WAR: 0.06,         // 占位：宗主战时额外 +6%
    INDEP_TRIGGER: 1.0,      // 占位：满 100% 起兵独立
    ANNEX_REL: 100,          // 第十四章：关系 100 吞并必成
    VASSAL_MIN_PROV: 2,      // 占位：释放附庸至少给 2 个省（1 个省复国太脆）
    RELEASE_REL: 20,         // 占位：释放出来的附庸初始关系

    /* ---- 联合统治（第十四章）---- */
    UNION_REL: 80,           // 占位：合并的关系门槛
    UNION_CHANCE: 0.35,      // 占位：达门槛后的成功率（"无保成配方"）

    /* ---- 贸易（第十七章）---- */
    TRADE_PROV_MUL: 40000,   // 第十七章：购省价 = 40000 × 省份价值
    TRADE_PROV_PREMIUM: 1.2, // 占位：非核心省也要加价 20% AI 才肯卖
    TRADE_GOLD_REL: 0.002,   // 占位：每给 1 金涨多少关系（500 金 = +1）

    /* ---- 大国（第十四章）---- */
    GREAT_N: 10,             // 世界人口前 10
    GREAT_TAX: 5,            // 占位：大国税收 +5%
    GREAT_DIP: 2,            // 占位：大国每回合多 2 外交点
    GREAT_MP: 1,             // 占位：大国移动点 +1

    /* ---- 支持叛军（第十三章）---- */
    SUPPORT_GOLD: 3000,      // 占位
    SUPPORT_REVOLT: 12,      // 占位：目标省革命风险 +12
    SUPPORT_TURNS: 15,       // 占位：持续 15 回合

    /* ---- 迁都（第十三章）---- */
    CAPITAL_HAPPY: 10,       // 第十三章：原首都省幸福度下降（占位 10）

    /* ---- AI ---- */
    AI_IMPROVE_BELOW: 10,    // 占位：关系低于 10 且有余点就改善
    AI_MAX_ACTIONS: 2        // 占位：AI 一回合最多做几次外交动作
  };

  /* 21 种外交动作（规则书第十三章那张表 + 三个把表补到 21 的项）。
   * `dip` = 外交点花费（全部占位：附录 A 明确说"各行动具体花费未给出"）。 */
  var ACT = {
    improve: { cn: '改善关系', dip: 1, gold: D.IMPROVE_GOLD, tip: '关系 +8；对方刚被侮辱时有冷却' },
    insult: { cn: '外交侮辱', dip: 1, gold: 0, tip: '关系 −15；对方一段时间内不能再改善关系' },
    gift: { cn: '送礼', dip: 0, gold: D.GIFT_GOLD, tip: '关系 +12；关系过低会被拒且反降' },
    war: { cn: '宣战', dip: AOC2.WAR_DIP_COST, gold: 0, tip: '进入战争（可召盟友）' },
    prepare: { cn: '备战', dip: 3, gold: 0, tip: '需要盟友或附庸：几回合后一起宣战' },
    peace: { cn: '和平谈判', dip: 0, gold: 0, tip: '按战争分提条款' },
    ally: { cn: '提议同盟', dip: 5, gold: 0, tip: '关系 ≥30 且双方不在交战' },
    nap: { cn: '互不侵犯', dip: 3, gold: 0, tip: '30 回合内不许宣战（可以违约硬打）' },
    defpact: { cn: '防御条约', dip: 4, gold: 0, tip: '任一方被攻 → 另一方强制参战' },
    guarantee: { cn: '保障独立', dip: 3, gold: 0, tip: '被保障国被攻 → 保障国参战（反向不触发）' },
    access: { cn: '军事通行权', dip: 2, gold: 0, tip: '给对方通行权；滞留军会被遣返' },
    requestAccess: { cn: '请求通行权', dip: 2, gold: 0, tip: '向对方要通行权（AI 可能收钱）' },
    trade: { cn: '贸易', dip: 2, gold: 0, tip: '七类交易：金币 / 省份 / 条约 / 参战' },
    vassalize: { cn: '索取附庸', dip: 8, gold: 0, tip: '最后通牒：关系 ≤−10；拒绝就入侵' },
    annex: { cn: '索取吞并', dip: 8, gold: 0, tip: '对象是自己的附庸；关系 100 必成' },
    release: { cn: '释放附庸', dip: 4, gold: 0, tip: '从自己的省里划一块复国成附庸' },
    support: { cn: '支持叛军', dip: 4, gold: D.SUPPORT_GOLD, tip: '目标国各省革命风险 +12（15 回合）' },
    union: { cn: '联合统治', dip: 10, gold: 0, tip: '两国合并；关系 ≥80 才可能' },
    capital: { cn: '迁都', dip: 2, gold: 0, tip: '换首都；原首都幸福下降' },
    ultimatum: { cn: '最后通牒', dip: 6, gold: 0, tip: '关系 ≤−10；可要求割地 / 通行 / 解放附庸' },
    breakAlly: { cn: '解除同盟', dip: 2, gold: 0, tip: '关系 −20' }
  };
  var ACT_ORDER = ['improve', 'insult', 'gift', 'war', 'prepare', 'peace', 'ally',
    'nap', 'defpact', 'guarantee', 'access', 'requestAccess', 'trade',
    'vassalize', 'annex', 'release', 'support', 'union', 'capital',
    'ultimatum', 'breakAlly'];

  A.dip = A.dip || {};
  var DP = A.dip;
  DP.ACT = ACT;
  DP.ORDER = ACT_ORDER;
  DP.D = D;

  /* =============================================================
   * ② 小工具：关系 / 条约 / 附庸
   * ============================================================= */
  function C(world, cid) { return world.countries[cid - 1] || null; }
  function relOf(world, a, b) {
    var ca = C(world, a);
    return ca ? A.rel(ca, b) : 0;
  }
  function setRel(world, a, b, v) { A.setRel(world, a, b, v); }

  function pactCount(c, k) {
    var n = 0, x;
    for (x in (c.aoc.pacts || {})) {
      if (c.aoc.pacts[x] && c.aoc.pacts[x][k]) n++;
    }
    return n;
  }
  DP.pactCount = pactCount;

  function pactOf(c, cid) {
    return (c && c.aoc && c.aoc.pacts && c.aoc.pacts[cid]) || null;
  }
  DP.pactOf = pactOf;
  DP.has = function (world, a, b, k) {
    var ca = C(world, a);
    var p = ca ? pactOf(ca, b) : null;
    if (!p) return false;
    if (k === 'nap') return (p.nap || 0) > (world.turn || 1);
    return !!p[k];
  };
  function setPact(world, a, b, k, v) {
    var ca = C(world, a), cb = C(world, b);
    if (!ca || !cb || !ca.aoc || !cb.aoc) return;
    ca.aoc.pacts = ca.aoc.pacts || {};
    cb.aoc.pacts = cb.aoc.pacts || {};
    ca.aoc.pacts[b] = ca.aoc.pacts[b] || {};
    cb.aoc.pacts[a] = cb.aoc.pacts[a] || {};
    ca.aoc.pacts[b][k] = v;
    cb.aoc.pacts[a][k] = v;
  }
  DP.setPact = setPact;
  function clearPact(world, a, b, k) {
    var ca = C(world, a), cb = C(world, b);
    if (ca && ca.aoc && ca.aoc.pacts && ca.aoc.pacts[b]) delete ca.aoc.pacts[b][k];
    if (cb && cb.aoc && cb.aoc.pacts && cb.aoc.pacts[a]) delete cb.aoc.pacts[a][k];
  }
  DP.clearPact = clearPact;

  /* 附庸关系 */
  DP.overlordOf = function (world, cid) {
    var c = C(world, cid);
    return (c && c.aoc && c.aoc.vassalOf) || 0;
  };
  DP.isVassal = function (world, a, b) {
    return DP.overlordOf(world, a) === b;
  };
  function setVassal(world, v, o) {
    var cv = C(world, v), co = C(world, o);
    if (!cv || !co || !cv.aoc || !co.aoc) return;
    /* 一个附庸只能有一个宗主：先解掉旧的 */
    var old = cv.aoc.vassalOf | 0;
    if (old) {
      var cold = C(world, old);
      if (cold && cold.aoc && cold.aoc.vassals) delete cold.aoc.vassals[v];
    }
    cv.aoc.vassalOf = o;
    cv.aoc.indep = 0;
    co.aoc.vassals = co.aoc.vassals || {};
    co.aoc.vassals[v] = 1;
    /* 附庸与宗主不交战、关系至少 0 */
    if (A.atWar(world, v, o)) A.peace(world, v, o, 'white', { force: true });
    if (A.rel(cv, o) < 0) setRel(world, v, o, 0);
  }
  DP.setVassal = setVassal;
  function dropVassal(world, v) {
    var cv = C(world, v);
    if (!cv || !cv.aoc) return;
    var o = cv.aoc.vassalOf | 0;
    if (o) {
      var co = C(world, o);
      if (co && co.aoc && co.aoc.vassals) delete co.aoc.vassals[v];
    }
    cv.aoc.vassalOf = 0;
    cv.aoc.indep = 0;
  }
  DP.dropVassal = dropVassal;

  /* 通行权：能不能进对方领土（军事通行权 / 同盟 / 附庸关系都算） */
  DP.canEnter = function (world, cid, owner) {
    if (owner === cid) return true;
    if (DP.has(world, owner, cid, 'access')) return true;
    if (DP.has(world, cid, owner, 'access')) return true;
    if (DP.has(world, cid, owner, 'ally')) return true;
    if (DP.isVassal(world, cid, owner) || DP.isVassal(world, owner, cid)) return true;
    return false;
  };

  /* =============================================================
   * ③ 大国（第十四章：世界人口前 10）
   * ============================================================= */
  DP.refreshGreat = function (world) {
    var list = [], i, c;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      list.push(c);
    }
    list.sort(function (x, y) { return (y.aoc.pop || 0) - (x.aoc.pop || 0); });
    for (i = 0; i < list.length; i++) list[i].aoc.great = i < D.GREAT_N;
    return Math.min(D.GREAT_N, list.length);
  };
  DP.taxMulOf = function (c) {
    return (c && c.aoc && c.aoc.great) ? 1 + D.GREAT_TAX / 100 : 1;
  };
  DP.greatDipOf = function (c) {
    return (c && c.aoc && c.aoc.great) ? D.GREAT_DIP : 0;
  };
  DP.greatMpOf = function (c) {
    return (c && c.aoc && c.aoc.great) ? D.GREAT_MP : 0;
  };

  /* =============================================================
   * ④ 单个动作的落地
   * ============================================================= */

  function spend(c, act) {
    var a = ACT[act];
    if (!a) return { ok: false, msg: '没有这个动作' };
    if (c.aoc.dip < a.dip) {
      return { ok: false, msg: '外交点不够（需 ' + a.dip + '，剩 ' + c.aoc.dip + '）' };
    }
    if (a.gold && c.aoc.treasury < a.gold) {
      return { ok: false, msg: '国库不足（需 ' + a.gold.toLocaleString() + ' 金）' };
    }
    c.aoc.dip -= a.dip;
    if (a.gold) c.aoc.treasury -= a.gold;
    /* 动作计数：所有"掷一次"的地方都拿它当盐。
     * 只拿 回合+双方 当盐的话，同一回合反复谈会永远掷出同一个数 ——
     * 实测"联合统治"成功率 55% 却连拒 31 次，因为盐一直没变。 */
    c.aoc.acts = (c.aoc.acts || 0) + 1;
    return { ok: true };
  }

  /* 关系修正的统一出口：顺手夹到 −100~100 */
  function bump(world, a, b, dv) {
    var v = relOf(world, a, b) + dv;
    setRel(world, a, b, v);
    return relOf(world, a, b);
  }

  /* ---- 改善关系 ---- */
  function doImprove(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (A.atWar(world, a, b)) return { ok: false, msg: '交战中不能改善关系（先谈和）' };
    if ((cb.aoc.cool || {})[a] > (world.turn || 1)) {
      return { ok: false, msg: cb.name + ' 刚被你侮辱过，暂时不谈（还有 ' +
        (cb.aoc.cool[a] - (world.turn || 1)) + ' 回合）' };
    }
    var sp = spend(ca, 'improve');
    if (!sp.ok) return sp;
    var v = bump(world, a, b, D.IMPROVE_REL);
    return { ok: true, rel: v, msg: '关系 → ' + v };
  }

  /* ---- 外交侮辱 ---- */
  function doInsult(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    var sp = spend(ca, 'insult');
    if (!sp.ok) return sp;
    var v = bump(world, a, b, D.INSULT_REL);
    cb.aoc.cool = cb.aoc.cool || {};
    cb.aoc.cool[a] = (world.turn || 1) + D.IMPROVE_COOL;
    /* 侮辱也会撕掉互不侵犯以外的好感：同盟不会因为一句难听话就散，
     * 但"防御条约"这种东西本来就靠关系撑着，掉到门槛以下就作废。 */
    if (DP.has(world, a, b, 'defpact') && v < D.DEF_REL) {
      clearPact(world, a, b, 'defpact');
    }
    return { ok: true, rel: v, msg: '关系 → ' + v + '（对方 ' + D.IMPROVE_COOL + ' 回合内不谈改善）' };
  }

  /* ---- 送礼 ---- */
  function doGift(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    var v0 = relOf(world, a, b);
    var sp = spend(ca, 'gift');
    if (!sp.ok) return sp;
    if (v0 < D.GIFT_LOW_REL) {
      /* 第十三章：关系过低会被拒且关系反降 —— 钱照扣（送出去的东西收不回） */
      var v = bump(world, a, b, -5);
      return { ok: false, msg: cb.name + ' 拒收礼物（关系 ' + v0 + ' 太低），关系 → ' + v };
    }
    var v2 = bump(world, a, b, D.GIFT_REL);
    return { ok: true, rel: v2, msg: '送礼 ' + D.GIFT_GOLD.toLocaleString() + ' 金，关系 → ' + v2 };
  }

  /* ---- 条约类 ---- */
  function doAlly(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (DP.has(world, a, b, 'ally')) return { ok: false, msg: '已经是同盟' };
    if (A.atWar(world, a, b)) return { ok: false, msg: '交战中不能提同盟' };
    if (A.warsOf(world, a).length || A.warsOf(world, b).length) {
      return { ok: false, msg: '任一方交战中不能提同盟（规则书第十三章）' };
    }
    var v = relOf(world, a, b);
    if (v < D.ALLY_REL) return { ok: false, msg: '关系不够（' + v + ' / ' + D.ALLY_REL + '）' };
    /* 两边都要数：只数提方的话，被动接受的一方会不知不觉攒到 4~6 个同盟
     * （实测 18 个国家超限）。 */
    if (pactCount(ca, 'ally') >= D.ALLY_MAX || pactCount(cb, 'ally') >= D.ALLY_MAX) {
      return { ok: false, msg: '同盟已经够多了（' + D.ALLY_MAX + ' 个）' };
    }
    var sp = spend(ca, 'ally');
    if (!sp.ok) return sp;
    /* 成功率：关系 + 实力差距 + 政体相近。三项都只是"更好说话"，不是硬门槛。 */
    var g1 = A.govOf(ca), g2 = A.govOf(cb);
    var strength = (A.armyOf(world, a) + 1) / (A.armyOf(world, b) + 1);
    var chance = 0.35 + (v - D.ALLY_REL) / 200 +
      (g1.key === g2.key ? 0.15 : 0) + Math.min(0.2, (strength - 1) * 0.1);
    var roll = (AO.hashString('ally:' + (world.turn || 1) + ':' + (ca.aoc.acts || 0) + ':' + a + ':' + b) >>> 0) % 1000 / 1000;
    if (roll > chance) {
      bump(world, a, b, -5);
      return { ok: false, refused: true,
        msg: cb.name + ' 拒绝结盟（成功率 ' + Math.round(chance * 100) + '%）' };
    }
    setPact(world, a, b, 'ally', 1);
    bump(world, a, b, 10);
    return { ok: true, msg: '与 ' + cb.name + ' 结盟' };
  }

  function doNap(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (DP.has(world, a, b, 'nap')) return { ok: false, msg: '已有互不侵犯条约' };
    var v = relOf(world, a, b);
    if (v < 0) return { ok: false, msg: cb.name + ' 不信任你（关系 ' + v + '）' };
    if (pactCount(ca, 'nap') >= D.NAP_MAX || pactCount(cb, 'nap') >= D.NAP_MAX) {
      return { ok: false, msg: '互不侵犯签得太多了（' + D.NAP_MAX + ' 个）' };
    }
    var sp = spend(ca, 'nap');
    if (!sp.ok) return sp;
    var until = (world.turn || 1) + D.NAP_TURNS;
    setPact(world, a, b, 'nap', until);
    return { ok: true, until: until, msg: '互不侵犯：' + D.NAP_TURNS + ' 回合内不许宣战' };
  }

  function doDefPact(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (DP.has(world, a, b, 'defpact')) return { ok: false, msg: '已有防御条约' };
    var v = relOf(world, a, b);
    if (v < D.DEF_REL) return { ok: false, msg: '关系不够（' + v + ' / ' + D.DEF_REL + '）' };
    var sp = spend(ca, 'defpact');
    if (!sp.ok) return sp;
    setPact(world, a, b, 'defpact', 1);
    bump(world, a, b, 5);
    return { ok: true, msg: '与 ' + cb.name + ' 签防御条约（谁被打，另一方参战）' };
  }

  function doGuarantee(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (DP.has(world, a, b, 'guarantee')) return { ok: false, msg: '已经在保障对方独立' };
    var v = relOf(world, a, b);
    if (v < D.GUAR_REL) return { ok: false, msg: '关系不够（' + v + ' / ' + D.GUAR_REL + '）' };
    var sp = spend(ca, 'guarantee');
    if (!sp.ok) return sp;
    setPact(world, a, b, 'guarantee', 1);
    cb.aoc.guarBy = cb.aoc.guarBy || {};
    cb.aoc.guarBy[a] = 1;
    return { ok: true, msg: '保障 ' + cb.name + ' 独立（对方被攻时你会参战）' };
  }

  function doAccess(world, a, b, give) {
    var ca = C(world, a), cb = C(world, b);
    if (give) {
      /* 给：白送，关系 +8 */
      if (DP.has(world, a, b, 'access')) return { ok: false, msg: '已经给了通行权' };
      var sp = spend(ca, 'access');
      if (!sp.ok) return sp;
      setPact(world, a, b, 'access', 1);
      bump(world, a, b, 8);
      return { ok: true, msg: '给 ' + cb.name + ' 军事通行权' };
    }
    /* 请求：对方按关系决定，关系不够会开价（这里简化成"拒绝"） */
    if (DP.has(world, a, b, 'access')) return { ok: false, msg: '已经有通行权' };
    var v = relOf(world, a, b);
    var sp2 = spend(ca, 'requestAccess');
    if (!sp2.ok) return sp2;
    if (v < D.ACCESS_REL) {
      bump(world, a, b, -3);
      return { ok: false, refused: true,
        msg: cb.name + ' 拒绝开放边境（关系 ' + v + ' / ' + D.ACCESS_REL + '）' };
    }
    setPact(world, a, b, 'access', 1);
    bump(world, a, b, 5);
    return { ok: true, msg: cb.name + ' 开放了军事通行权' };
  }

  /* ---- 备战：召唤盟友 / 附庸，几回合后一起宣战 ---- */
  function doPrepare(world, a, b) {
    var ca = C(world, a);
    var helpers = [];
    for (var k in (ca.aoc.pacts || {})) {
      if (ca.aoc.pacts[k].ally) helpers.push(k | 0);
    }
    for (var vk in (ca.aoc.vassals || {})) helpers.push(vk | 0);
    if (!helpers.length) return { ok: false, msg: '没有盟友或附庸可召（备战需要至少一个）' };
    var sp = spend(ca, 'prepare');
    if (!sp.ok) return sp;
    ca.aoc.prepare = { target: b, turns: 2 + ((world.turn || 1) % 9), by: a };
    return { ok: true, helpers: helpers.length,
      msg: '备战：' + helpers.length + ' 个盟友/附庸将在几回合后一起对 ' +
        (C(world, b) ? C(world, b).name : '#' + b) + ' 宣战' };
  }

  /* ---- 支持叛军 ---- */
  function doSupport(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    var sp = spend(ca, 'support');
    if (!sp.ok) return sp;
    cb.aoc.supported = { by: a, until: (world.turn || 1) + D.SUPPORT_TURNS };
    bump(world, a, b, -8);
    return { ok: true, msg: '资助 ' + cb.name + ' 的叛军：全国革命风险 +' +
      D.SUPPORT_REVOLT + '（' + D.SUPPORT_TURNS + ' 回合）' };
  }

  /* ---- 联合统治 ---- */
  function doUnion(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (A.atWar(world, a, b)) return { ok: false, msg: '交战中不能谈合并' };
    if (DP.overlordOf(world, a) || DP.overlordOf(world, b)) {
      return { ok: false, msg: '附庸不能谈合并（先独立或先吞并）' };
    }
    var v = relOf(world, a, b);
    if (v < D.UNION_REL) return { ok: false, msg: '关系不够（' + v + ' / ' + D.UNION_REL + '）' };
    var sp = spend(ca, 'union');
    if (!sp.ok) return sp;
    /* 第十四章："无保成配方，成功率看关系" —— 关系越高压根不用掷 */
    var chance = D.UNION_CHANCE + (v - D.UNION_REL) / 100;
    var roll = (AO.hashString('union:' + (world.turn || 1) + ':' + (ca.aoc.acts || 0) + ':' + a + ':' + b) >>> 0) % 1000 / 1000;
    if (roll > chance) {
      bump(world, a, b, -8);
      return { ok: false, refused: true,
        msg: cb.name + ' 拒绝合并（成功率 ' + Math.round(chance * 100) + '%）' };
    }
    /* 合并：小的一边整体并进大的一边（按省数判大小） */
    var small = cb.provinces.length <= ca.provinces.length ? b : a;
    var big = small === a ? b : a;
    var list = C(world, small).provinces.slice();
    for (var i = 0; i < list.length; i++) A.transferProvince(world, list[i], big);
    var cs = C(world, small), cbig = C(world, big);
    if (cs && cs.aoc) cs.aoc.alive = false;
    if (cbig && cbig.aoc) {
      cbig.aoc.treasury += (cs.aoc.treasury || 0);
      cbig.aoc.loans += (cs.aoc.loans || 0);
    }
    A.recomputeCountry(world, cbig);
    return { ok: true, msg: C(world, big).name + ' 与 ' + C(world, small).name +
      ' 合并为一国（' + list.length + ' 省并入）' };
  }

  /* ---- 迁都 ---- */
  function doCapital(world, a, pid) {
    var ca = C(world, a), p = world.provinces[pid - 1];
    if (!ca || !ca.aoc) return { ok: false, msg: '国家不存在' };
    if (!p || p.owner !== a) return { ok: false, msg: '不是自己的省' };
    if (p.aoc.occupied) return { ok: false, msg: '被占领的省不能当首都' };
    if (ca.capital === pid) return { ok: false, msg: '已经是首都了' };
    var sp = spend(ca, 'capital');
    if (!sp.ok) return sp;
    var old = world.provinces[ca.capital - 1];
    if (old && old.aoc) {
      old.aoc.happy = Math.max(AOC2.HAPPY_MIN, old.aoc.happy - D.CAPITAL_HAPPY);
    }
    var oldName = old ? old.name : '—';
    ca.capital = pid;
    return { ok: true, msg: '迁都：' + oldName + ' → ' + p.name + '（旧都幸福 −' + D.CAPITAL_HAPPY + '）' };
  }

  /* ---- 附庸：索取 / 吞并 / 释放 ---- */
  function doVassalize(world, a, b, invade) {
    var ca = C(world, a), cb = C(world, b);
    if (DP.overlordOf(world, b)) return { ok: false, msg: cb.name + ' 已经是别人的附庸' };
    if (DP.overlordOf(world, a)) return { ok: false, msg: '附庸不能再收附庸' };
    return ultimatum(world, a, b, 'vassalize', invade);
  }

  function doAnnex(world, a, b) {
    var ca = C(world, a), cb = C(world, b);
    if (DP.overlordOf(world, b) !== a) return { ok: false, msg: '对方不是你的附庸' };
    var v = relOf(world, a, b);
    if (v < D.ANNEX_REL) {
      /* 第十四章：关系拉到 100 后提吞并必定接受 —— 不到 100 就只能等 */
      return { ok: false, refused: true,
        msg: cb.name + ' 拒绝被吞并（关系 ' + v + ' / ' + D.ANNEX_REL + '）' };
    }
    var sp = spend(ca, 'annex');
    if (!sp.ok) return sp;
    var list = cb.provinces.slice(), i;
    for (i = 0; i < list.length; i++) A.transferProvince(world, list[i], a);
    dropVassal(world, b);
    if (cb.aoc) cb.aoc.alive = false;
    ca.aoc.treasury += (cb.aoc.treasury || 0);
    A.recomputeCountry(world, ca);
    return { ok: true, msg: '吞并 ' + cb.name + '（' + list.length + ' 省）' };
  }

  function doRelease(world, a, pid) {
    var ca = C(world, a), p = world.provinces[pid - 1];
    if (!ca || !p || p.owner !== a) return { ok: false, msg: '要在自己的省上复国' };
    if (ca.provinces.length <= D.VASSAL_MIN_PROV) {
      return { ok: false, msg: '自己只剩 ' + ca.provinces.length + ' 省，放不出附庸（至少留 ' +
        D.VASSAL_MIN_PROV + ' 省）' };
    }
    var sp = spend(ca, 'release');
    if (!sp.ok) return sp;
    var nm = p.name + '公国';
    var seed = AO.hashString('release:' + nm + ':' + (world.turn || 1)) >>> 0;
    var c2 = A.makeCountry ? A.makeCountry(world, nm, p.ownerColor || ca.color, 'monarchy') : null;
    if (!c2) return { ok: false, msg: '复国失败（引擎没给出建国的口子）' };
    c2.aoc.treasury = Math.round((ca.aoc.treasury || 0) * 0.05) + 2000;
    A.transferProvince(world, pid, c2.id);
    setVassal(world, c2.id, a);
    setRel(world, c2.id, a, D.RELEASE_REL);
    A.recomputeCountry(world, c2);
    A.recomputeCountry(world, ca);
    return { ok: true, cid: c2.id, msg: '释放附庸：' + nm + '（' + p.name + ' 复国）' };
  }

  /* ---- 最后通牒（第十三章）----
   * term: vassalize / annex / land / access / release
   * invade: 对方拒绝就自动宣战（规则书"设定拒绝就入侵的兵力上限"） */
  function ultimatum(world, a, b, term, invade) {
    var ca = C(world, a), cb = C(world, b);
    if (!ca || !cb || !ca.aoc || !cb.aoc) return { ok: false, msg: '国家不存在' };
    if (a === b) return { ok: false, msg: '不能对自己发最后通牒' };
    var v = relOf(world, a, b);
    if (v > D.ULTIM_REL) {
      return { ok: false, msg: '关系 ' + v + ' 还不够差（要 ≤ ' + D.ULTIM_REL + ' 才能发最后通牒）' };
    }
    var sp = spend(ca, term === 'vassalize' || term === 'annex' ? 'vassalize' : 'ultimatum');
    if (!sp.ok) return sp;

    /* 对方接受与否：兵力差 + 省数差 + 关系 + 有没有靠山 */
    var myPow = A.armyOf(world, a) + ca.provinces.length * 500;
    var hisPow = A.armyOf(world, b) + cb.provinces.length * 500;
    var ratio = myPow / Math.max(1, hisPow);
    var backed = false;
    for (var g in (cb.aoc.guarBy || {})) if (C(world, g | 0)) backed = true;
    var accept = false;
    if (term === 'annex') accept = DP.overlordOf(world, b) === a && v >= D.ANNEX_REL;
    else if (term === 'vassalize') accept = ratio >= D.ULTIM_STRENGTH && !backed;
    else if (term === 'land') accept = ratio >= D.ULTIM_STRENGTH * 1.5;
    else if (term === 'access') accept = ratio >= 1 || v <= -50;
    else if (term === 'release') accept = (cb.aoc.vassals && Object.keys(cb.aoc.vassals).length) ? ratio >= 1 : false;
    else accept = false;

    if (!accept) {
      bump(world, a, b, D.ULTIM_REFUSE_REL);
      if (invade) {
        var w = A.declareWar(world, a, b, { free: true, noJoin: true });
        return { ok: false, refused: true, war: w.ok,
          msg: cb.name + ' 拒绝最后通牒（兵力比 ' + ratio.toFixed(1) + '）→ 宣战' };
      }
      return { ok: false, refused: true,
        msg: cb.name + ' 拒绝最后通牒（兵力比 ' + ratio.toFixed(1) + '），关系 → ' +
          relOf(world, a, b) };
    }

    if (term === 'vassalize') {
      setVassal(world, b, a);
      return { ok: true, msg: cb.name + ' 接受附庸（兵力比 ' + ratio.toFixed(1) + '）' };
    }
    if (term === 'annex') {
      var list = cb.provinces.slice(), i;
      for (i = 0; i < list.length; i++) A.transferProvince(world, list[i], a);
      dropVassal(world, b);
      if (cb.aoc) cb.aoc.alive = false;
      A.recomputeCountry(world, ca);
      return { ok: true, msg: '吞并 ' + cb.name + '（' + list.length + ' 省）' };
    }
    if (term === 'land') {
      /* 割一个边境省（离对方首都最近的那个） */
      var pick = null, bestD = Infinity;
      var capA = world.provinces[ca.capital - 1];
      for (i = 0; i < cb.provinces.length; i++) {
        var q = world.provinces[cb.provinces[i] - 1];
        if (!q || q.aoc.occupied) continue;
        var d = capA ? Math.hypot(q.centroid[0] - capA.centroid[0], q.centroid[1] - capA.centroid[1]) : 0;
        if (d < bestD) { bestD = d; pick = q; }
      }
      if (!pick) return { ok: false, msg: '对方没有可割的省' };
      A.transferProvince(world, pick.id, a);
      A.recomputeCountry(world, ca); A.recomputeCountry(world, cb);
      return { ok: true, msg: '割得 ' + pick.name + '（' + cb.name + ' 接受最后通牒）' };
    }
    if (term === 'access') {
      setPact(world, a, b, 'access', 1);
      return { ok: true, msg: cb.name + ' 开放军事通行权' };
    }
    if (term === 'release') {
      var vs = Object.keys(cb.aoc.vassals || {});
      if (!vs.length) return { ok: false, msg: '对方没有附庸可放' };
      var vid = vs[0] | 0;
      dropVassal(world, vid);
      setRel(world, vid, b, -40);
      return { ok: true, msg: C(world, vid).name + ' 脱离 ' + cb.name + ' 独立' };
    }
    return { ok: false, msg: '不认识的条款' };
  }
  DP.ultimatum = ultimatum;

  /* =============================================================
   * ⑤ 统一入口：A.dip.act(world, a, b, key, arg)
   * ============================================================= */
  DP.act = function (world, a, b, key, arg) {
    var ca = C(world, a), cb = C(world, b);
    if (!ca || !ca.aoc) return { ok: false, msg: '国家不存在' };
    if (key !== 'capital' && key !== 'release') {
      if (!cb || !cb.aoc || !cb.aoc.alive) return { ok: false, msg: '对方已经不存在了' };
      if (a === b) return { ok: false, msg: '不能对自己做外交动作' };
    }
    switch (key) {
      case 'improve': return doImprove(world, a, b);
      case 'insult': return doInsult(world, a, b);
      case 'gift': return doGift(world, a, b);
      case 'war': return A.declareWar(world, a, b);
      case 'prepare': return doPrepare(world, a, b);
      case 'peace': return A.peace(world, a, b, (arg && arg.terms) || 'white');
      case 'ally': return doAlly(world, a, b);
      case 'nap': return doNap(world, a, b);
      case 'defpact': return doDefPact(world, a, b);
      case 'guarantee': return doGuarantee(world, a, b);
      case 'access': return doAccess(world, a, b, true);
      case 'requestAccess': return doAccess(world, a, b, false);
      case 'trade': return { ok: true, open: true, msg: '打开贸易（七类）' };
      case 'vassalize': return doVassalize(world, a, b, !!(arg && arg.invade));
      case 'annex': return doAnnex(world, a, b);
      case 'release': return doRelease(world, a, (arg && arg.pid) | 0);
      case 'support': return doSupport(world, a, b);
      case 'union': return doUnion(world, a, b);
      case 'capital': return doCapital(world, a, (arg && arg.pid) | 0);
      case 'ultimatum': return ultimatum(world, a, b, (arg && arg.term) || 'land', !!(arg && arg.invade));
      case 'breakAlly': {
        if (!DP.has(world, a, b, 'ally')) return { ok: false, msg: '本来就不是同盟' };
        var sp = spend(ca, 'breakAlly');
        if (!sp.ok) return sp;
        clearPact(world, a, b, 'ally');
        bump(world, a, b, D.PACT_BREAK_REL);
        return { ok: true, msg: '解除与 ' + cb.name + ' 的同盟（关系 → ' + relOf(world, a, b) + '）' };
      }
      default: return { ok: false, msg: '没有这个外交动作：' + key };
    }
  };

  /* =============================================================
   * ⑥ 贸易（第十七章）：七类
   * ============================================================= */
  DP.provPrice = function (world, pid) {
    var p = world.provinces[pid - 1];
    if (!p || !p.aoc) return 0;
    return Math.round(D.TRADE_PROV_MUL * p.aoc.value);
  };

  /* 买省：AI 永远不卖核心省（天价也不卖）；非核心要加价 20% */
  DP.buyProvince = function (world, a, b, pid) {
    var ca = C(world, a), cb = C(world, b), p = world.provinces[pid - 1];
    if (!ca || !cb || !p) return { ok: false, msg: '目标不存在' };
    if (p.owner !== b) return { ok: false, msg: '不是对方的省' };
    if (p.aoc.core && p.aoc.core[b]) {
      return { ok: false, refused: true, msg: cb.name + ' 不卖核心省（规则书第十七章：天价也不卖）' };
    }
    if (cb.provinces.length <= 1) return { ok: false, refused: true, msg: '对方只剩一个省，不卖' };
    var price = Math.round(DP.provPrice(world, pid) * D.TRADE_PROV_PREMIUM);
    if (ca.aoc.treasury < price) {
      return { ok: false, msg: '国库不足（要 ' + price.toLocaleString() + ' 金）' };
    }
    ca.aoc.treasury -= price;
    cb.aoc.treasury += price;
    A.transferProvince(world, pid, a);
    A.recomputeCountry(world, ca); A.recomputeCountry(world, cb);
    return { ok: true, price: price, msg: '以 ' + price.toLocaleString() + ' 金买下 ' + p.name };
  };

  /* 卖省给自己（对方出价）：AI 出价 = 40000 × 价值，且不买核心省 */
  DP.sellProvince = function (world, a, b, pid) {
    var ca = C(world, a), cb = C(world, b), p = world.provinces[pid - 1];
    if (!ca || !cb || !p) return { ok: false, msg: '目标不存在' };
    if (p.owner !== a) return { ok: false, msg: '不是自己的省' };
    if (p.aoc.core && p.aoc.core[a]) return { ok: false, msg: '不能卖自己的核心省' };
    if (ca.provinces.length <= 1) return { ok: false, msg: '只剩一个省，不能卖' };
    var price = DP.provPrice(world, pid);
    if (cb.aoc.treasury < price) {
      return { ok: false, refused: true, msg: cb.name + ' 出不起（要 ' + price.toLocaleString() + ' 金）' };
    }
    cb.aoc.treasury -= price;
    ca.aoc.treasury += price;
    A.transferProvince(world, pid, b);
    A.recomputeCountry(world, ca); A.recomputeCountry(world, cb);
    return { ok: true, price: price, msg: '以 ' + price.toLocaleString() + ' 金卖出 ' + p.name };
  };

  /* 给钱换关系 */
  DP.giveGold = function (world, a, b, amount) {
    var ca = C(world, a), cb = C(world, b);
    amount = Math.round(amount);
    if (!(amount > 0)) return { ok: false, msg: '金额不对' };
    if (ca.aoc.treasury < amount) return { ok: false, msg: '国库不足' };
    ca.aoc.treasury -= amount;
    cb.aoc.treasury += amount;
    var dv = Math.min(30, amount * D.TRADE_GOLD_REL);
    var v = bump(world, a, b, dv);
    return { ok: true, rel: v, msg: '给 ' + cb.name + ' ' + amount.toLocaleString() + ' 金，关系 → ' + v };
  };

  /* 让对方对第三国宣战（贸易里的一类） */
  DP.tradeJoinWar = function (world, a, b, target) {
    var ca = C(world, a), cb = C(world, b), ct = C(world, target);
    if (!ca || !cb || !ct) return { ok: false, msg: '目标不存在' };
    if (!A.atWar(world, a, target)) return { ok: false, msg: '你和对方没有在交战' };
    var price = Math.round((ct.aoc.pop || 0) / 100);
    if (ca.aoc.treasury < price) {
      return { ok: false, msg: '国库不足（要 ' + price.toLocaleString() + ' 金）' };
    }
    var v = relOf(world, a, b);
    var chance = 0.15 + (v / 200) + (DP.has(world, a, b, 'ally') ? 0.4 : 0);
    var roll = (AO.hashString('joinwar:' + (world.turn || 1) + ':' + (ca.aoc.acts || 0) + ':' + a + ':' + b + ':' + target) >>> 0) % 1000 / 1000;
    if (roll > chance) {
      return { ok: false, refused: true,
        msg: cb.name + ' 不愿参战（成功率 ' + Math.round(chance * 100) + '%）' };
    }
    ca.aoc.treasury -= price;
    cb.aoc.treasury += price;
    var r = A.declareWar(world, b, target, { free: true, noJoin: true });
    return { ok: r.ok, msg: cb.name + ' 对 ' + ct.name + ' 宣战（' + price.toLocaleString() + ' 金）' };
  };

  /* =============================================================
   * ⑦ 宣战之后的连带：盟友 / 防御条约 / 保障独立 / 宗主
   *
   * 规则书第十三章：
   *   防御条约 —— 任一成员被攻 → 其他成员强制参战；
   *   保障独立 —— 被保障国被攻 → 保障国参战（反向不触发）；
   *   备战     —— 召唤盟友 2~10 回合后一起宣战。
   * 这里在 declareWar 之后同步结算，避免"打完了盟友还没动"。
   * ============================================================= */
  DP.onWarDeclared = function (world, a, b) {
    var cb = C(world, b), i, k;
    if (!cb || !cb.aoc) return [];
    var joined = [];

    /* ① 防御条约：b 的盟友按条约参战 */
    for (k in (cb.aoc.pacts || {})) {
      var p = cb.aoc.pacts[k];
      if (!p) continue;
      var x = k | 0;
      if (x === a) continue;
      if (p.defpact) {
        var cx = C(world, x);
        if (cx && cx.aoc && cx.aoc.alive && !A.atWar(world, x, a)) {
          A.declareWar(world, x, a, { free: true, noJoin: true });
          joined.push({ cid: x, why: 'defpact' });
        }
      }
    }
    /* ② 保障独立：谁保障了 b，谁参战（反向不触发） */
    for (k in (cb.aoc.guarBy || {})) {
      var g = k | 0;
      if (g === a) continue;
      var cg = C(world, g);
      if (cg && cg.aoc && cg.aoc.alive && !A.atWar(world, g, a)) {
        A.declareWar(world, g, a, { free: true, noJoin: true });
        joined.push({ cid: g, why: 'guarantee' });
      }
    }
    /* ③ 附庸：宗主参战（附庸被打，宗主下场）；附庸也跟着宗主打 */
    var ov = cb.aoc.vassalOf | 0;
    if (ov && ov !== a) {
      var co = C(world, ov);
      if (co && co.aoc && co.aoc.alive && !A.atWar(world, ov, a)) {
        A.declareWar(world, ov, a, { free: true, noJoin: true });
        joined.push({ cid: ov, why: 'overlord' });
      }
    }
    var ca = C(world, a);
    if (ca && ca.aoc) {
      for (k in (ca.aoc.vassals || {})) {
        var v = k | 0;
        var cv = C(world, v);
        if (cv && cv.aoc && cv.aoc.alive && !A.atWar(world, v, b)) {
          A.declareWar(world, v, b, { free: true, noJoin: true });
          joined.push({ cid: v, why: 'vassal' });
        }
      }
    }
    return joined;
  };

  /* =============================================================
   * ⑧ 回合结算（15-aoc2 的 settle 调用）
   * ============================================================= */
  DP.settle = function (world, opts) {
    var i, c, A2, k;
    var turn = world.turn || 1;

    /* ① 附庸税（第十四章：约 20%）：附庸的入库收入按比例上缴宗主 */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      var ov = c.aoc.vassalOf | 0;
      if (!ov) continue;
      var co = C(world, ov);
      if (!co || !co.aoc || !co.aoc.alive) { c.aoc.vassalOf = 0; continue; }
      var last = c.aoc.last;
      if (!last || !(last.taxIn > 0)) continue;
      var tax = last.taxIn * D.VASSAL_TAX;
      c.aoc.treasury -= tax;
      co.aoc.treasury += tax;
      if (c.aoc.treasury < 0) {
        /* 上缴不能把附庸逼到负数：差额记成宗主垫付，附庸欠着 */
        co.aoc.treasury += c.aoc.treasury;
        c.aoc.treasury = 0;
      }
      c.aoc.paidTax = tax;
    }

    /* ② 独立欲望：随时间上升，宗主战时加速（第十四章） */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      var o2 = c.aoc.vassalOf | 0;
      if (!o2) continue;
      var co2 = C(world, o2);
      var war = co2 && co2.aoc ? A.warsOf(world, o2).length : 0;
      c.aoc.indep = Math.min(1.5, (c.aoc.indep || 0) + D.INDEP_RISE + (war ? D.INDEP_WAR : 0));
      if (c.aoc.indep >= D.INDEP_TRIGGER && co2 && co2.aoc && co2.aoc.alive) {
        /* 起兵独立：直接开战，关系打到底 */
        dropVassal(world, c.id);
        A.setRel(world, c.id, o2, -100);
        A.declareWar(world, c.id, o2, { free: true, noJoin: true });
        c.aoc.indep = 0;
        c.aoc.indepWar = turn;
      }
    }

    /* ③ 备战的倒计时：到点就召唤盟友一起宣战 */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      var pr = c.aoc.prepare;
      if (!pr) continue;
      pr.turns--;
      if (pr.turns > 0) continue;
      var tgt = C(world, pr.target);
      if (tgt && tgt.aoc && tgt.aoc.alive && !A.atWar(world, c.id, pr.target)) {
        A.declareWar(world, c.id, pr.target, { free: true, noJoin: true });
        for (k in (c.aoc.pacts || {})) {
          if (c.aoc.pacts[k] && c.aoc.pacts[k].ally) {
            var ally = C(world, k | 0);
            if (ally && ally.aoc && ally.aoc.alive && !A.atWar(world, ally.id, pr.target)) {
              A.declareWar(world, ally.id, pr.target, { free: true, noJoin: true });
            }
          }
        }
      }
      c.aoc.prepare = null;
    }

    /* ④ 支持叛军的期限 */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      if (c.aoc.supported && c.aoc.supported.until <= turn) c.aoc.supported = null;
    }

    /* ⑤ 大国身份（第十四章：世界人口前 10） */
    DP.refreshGreat(world);

    /* ⑥ 无主国家清理：省被割光但 alive 还是 true 的，补一刀 */
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc) continue;
      if (c.aoc.alive && !c.provinces.length) {
        c.aoc.alive = false;
        if (c.aoc.vassalOf) dropVassal(world, c.id);
      }
    }
  };

  /* =============================================================
   * ⑨ AI 的外交（温和：改善关系 + 偶尔送礼）
   *
   * 宣战/和谈在 15-aoc2 的 aiWarTick 里（那一段已经有"打不打得动"的判断）。
   * 这里只补"不打仗的时候也在经营关系"，否则 AI 之间的关系永远停在 0，
   * 同盟 / 防御条约 / 通行权这几条规则在挂机里一次都不会触发。
   * ============================================================= */
  DP.aiTick = function (world, c, opts) {
    if (!c || !c.aoc || !c.aoc.alive) return;
    if (opts && opts.player === c.id) return;
    if (c.aoc.rebel) return;
    var n = 0, i;
    /* 只对邻国经营：隔着半个世界的关系没有意义。
     * 顺序是"先修好、再签条约、最后才是通牒"—— 一个 AI 一回合只做两件事，
     * 所以这三档必须按关系从低到高排，不能每档都试一遍。 */
    for (i = 0; i < (c.neighbors || []).length && n < D.AI_MAX_ACTIONS; i++) {
      var nid = c.neighbors[i];
      var nc = C(world, nid);
      if (!nc || !nc.aoc || !nc.aoc.alive) continue;
      if (A.atWar(world, c.id, nid)) continue;
      var v = A.rel(c, nid);
      var ratio = (A.armyOf(world, c.id) + c.provinces.length * 500) /
        Math.max(1, A.armyOf(world, nid) + nc.provinces.length * 500);

      if (v < D.ALLY_REL) {
        if (c.aoc.dip >= 1 && c.aoc.treasury > D.IMPROVE_GOLD * 3) {
          DP.act(world, c.id, nid, 'improve');
          n++;
        }
        continue;
      }
      /* 关系够好：按"同盟 → 防御 → 互不侵犯"从强到弱签 */
      if (!DP.has(world, c.id, nid, 'ally') && c.aoc.dip >= ACT.ally.dip &&
        A.warsOf(world, c.id).length === 0 && A.warsOf(world, nid).length === 0) {
        if (DP.act(world, c.id, nid, 'ally').ok) { n++; continue; }
      }
      if (!DP.has(world, c.id, nid, 'defpact') && v >= D.DEF_REL && c.aoc.dip >= ACT.defpact.dip) {
        if (DP.act(world, c.id, nid, 'defpact').ok) { n++; continue; }
      }
      if (!DP.has(world, c.id, nid, 'nap') && c.aoc.dip >= ACT.nap.dip) {
        if (DP.act(world, c.id, nid, 'nap').ok) { n++; continue; }
      }
      /* 关系很糟 + 兵力压倒：发最后通牒要附庸（规则书说的"最后通牒流"） */
      if (v <= D.ULTIM_REL && ratio >= D.ULTIM_STRENGTH && c.aoc.dip >= ACT.vassalize.dip &&
        !DP.overlordOf(world, nid) && !DP.overlordOf(world, c.id)) {
        if (DP.act(world, c.id, nid, 'vassalize', { invade: false }).ok) n++;
      }
    }
  };

  /* 探针用的小结 */
  DP.stat = function (world) {
    var out = { vassals: 0, overlords: 0, allies: 0, naps: 0, defs: 0,
      guars: 0, access: 0, greats: 0, unions: 0 };
    var i, c, k;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (!c || !c.aoc || !c.aoc.alive) continue;
      if (c.aoc.vassalOf) out.vassals++;
      if (c.aoc.vassals) out.overlords += Object.keys(c.aoc.vassals).length;
      if (c.aoc.great) out.greats++;
      for (k in (c.aoc.pacts || {})) {
        var p = c.aoc.pacts[k];
        if (!p) continue;
        if (p.ally && c.id < (k | 0)) out.allies++;
        if (p.nap && p.nap > (world.turn || 1) && c.id < (k | 0)) out.naps++;
        if (p.defpact && c.id < (k | 0)) out.defs++;
        if (p.guarantee && c.id < (k | 0)) out.guars++;
        if (p.access && c.id < (k | 0)) out.access++;
      }
    }
    return out;
  };

})(typeof window !== 'undefined' ? window : globalThis);
