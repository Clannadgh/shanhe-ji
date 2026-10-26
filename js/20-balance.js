/* =============================================================
 * 20-balance.js —— 平衡分析（"这么停到底好不好"）+ 干跑推演（"照当前配置会怎样"）
 *
 * 为什么会有这个文件：
 * 维修面板能"每个城留几座"之后，玩家面对的是一个纯数字决策：
 * 停 8 座渔港省下 3.2 铁，但口粮缺口会变成 4 —— 到底该不该停？
 * 光看"本回合库存"答不了这个问题，因为它只说现在，不说"照这样下去会怎样"。
 *
 * 第一版的答案是"历史平均外推"：拿最近 3 回合的平均净额画 8 回合虚线。
 * 用起来发现它有个致命的毛病（用户原话："我关掉一个农场，预测那个线
 * 会实时的更新"）：**历史平均和玩家手上的开关无关** —— 关 8 座渔港，
 * 虚线纹丝不动，要等三个回合的新历史把平均值稀释掉才慢慢变。
 * 病根是"不重算一遍模拟"这条家法用错了地方：对历史它是对的（图必须
 * 和结算同源），但预测要回答的本来就是"照**当前**配置下一回合会怎样"，
 * 那天然是一次（干跑的）结算。
 *
 * 所以这一版做四件事：
 *   ① 采样：每回合把一国**实际发生**的收支记一行（和历史完全同源，不变）；
 *   ② 干跑估算器 forecast：按当前开关配置把产出/维护/口粮逐回合重演一遍。
 *      受控分项（KEEP 能影响的）走结算的同一条算路（钩子取数，不抄公式）；
 *      估不了的杂项（战争军费/事件/俸禄/科研/朝贡/市场买卖）用残差
 *      R = 上回合实测净额 − 上回合受控分项实测值 近似；
 *   ③ 画图：历史线照旧，虚线全部换成干跑 —— 不再必然是直线：铁矿采空的
 *      那一回它会拐头，口粮线和人口线会自己交叉；
 *   ④ 建议：拆成「先修（开关）」和「该盖（建造）」两卡 —— 后者回答
 *      "该盖什么/盖几座/盖到哪/什么时候停"（建筑没有座数上限，
 *      满仓/维护/矿寿这三个刹车必须变成看得见的数字）。
 *
 * 刷新管线不用动：11-ui 在改保留座数后本来就会调 balUI.render()
 * （renderRepPanel 开头那一行）—— 数字来源换成干跑之后，
 * "关一座农场、左边的线立刻动"这件事自动成立。
 *
 * 存档：跟着 11-ui 的 saveGame 走（BAL 字段，只有历史采样和区间），
 * **不升 SAVE_VER**，干跑是纯函数、不落任何新字段。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  var BAL = {
    histMax: 160,        // 每国最多留多少个采样点（一世纪 400 回合，只留最近 160）
    projTurns: 8,        // 干跑往后推几回合
    rangeDef: 24,        // 默认看最近 24 回合
    ranges: [12, 24, 48],
    /* 维护占岁入的红线（和"该盖"建议共用一条） */
    maintRed: 0.55,
    /* 口粮目标带：产出比口粮多 3 = 人口最快涨档（settlePop 的 surplus≥3）。
     * "最好建多少"的下限就是这条线，上限是满仓/维护/矿寿。 */
    foodTarget: 3,
    /* 颜色：铁=钢青，金=赭黄，粮=草绿，口粮=朱红（和游戏里"缺"的警示色一致） */
    color: {
      iron: '#5b7686', gold: '#b98b2f', food: '#6f8f47',
      need: '#b0492f', halted: '#b0492f', active: '#2f7d4f'
    }
  };
  AO.BAL = BAL;

  var H = Object.create(null);   // owner -> [sample]
  var V = null;                  // 11-ui 递进来的内部件
  /* 只留"看多少回合"这一个状态：开关与页签归 11-ui 的「经营」面板。
   * marks 是干跑顺手算出的"每类够不够"（✓/▲），维修右栏行尾来取。 */
  var UI = { range: BAL.rangeDef, marks: Object.create(null) };

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 面板看的是谁：选了国就是自己；工坊模式看当前选中的国 */
  function viewOwner() {
    if (!V) return 0;
    var p = V.player();
    if (p) return p | 0;
    return (V.viewOwner ? V.viewOwner() : 0) | 0;
  }

  /* =============================================================
   * 一、采样（每回合末尾，11-ui 的 nextTurn 调一次）
   * ============================================================= */
  /* 一行样本。字段都是"这一回合**实际发生**的数"，不是预估：
   *   iIn/iOut  铁的收入与支出（省侧 + 中央侧，抽税两边相抵，所以净额是真的）
   *   gIn/gOut  金
   *   maint     维护支出（铁 + 金合计，从两本流水的 d.maint 取）
   *   fProd/fNeed  口粮产出 / 口粮需求（POP 里结算时算好的，和吃饭用的是同一个数）
   *   iStock/gStock  中央国库
   *   built/active/halted  已建 / 在跑 / 失修处数
   */
  function makeSample(owner) {
    var w = V.world();
    if (!w) return null;
    var c = w.countries[owner - 1];
    if (!c) return null;
    var o = {
      t: V.turn(), iIn: 0, iOut: 0, gIn: 0, gOut: 0, maint: 0,
      fProd: 0, fNeed: 0, iStock: 0, gStock: 0, pop: 0,
      built: 0, active: 0, halted: 0
    };
    var ks = V.rep.kinds(), i, ki, pid, F;
    for (i = 0; i < c.provinces.length; i++) {
      pid = c.provinces[i];
      F = V.flow[pid];
      if (F) {
        o.iIn += num(F.gain.iron); o.iOut += num(F.loss.iron);
        o.gIn += num(F.gain.gold); o.gOut += num(F.loss.gold);
        if (F.d && F.d.maint) o.maint += num(F.d.maint.iron) + num(F.d.maint.gold);
      }
      var P = V.pop[pid];
      if (P) { o.fProd += num(P.prod); o.fNeed += num(P.need); o.pop += num(P.v); }
      for (ki = 0; ki < ks.length; ki++) {
        var lv = V.live(pid, ks[ki]);
        if (!lv) continue;
        o.built += lv.built | 0;
        o.active += lv.active | 0;
        if (lv.halted && !lv.off) o.halted++;
      }
    }
    /* 中央侧：税入 / 科技 / 情报经费 / 中央垫付的维护 —— 不加上这一块，
     * 图上的净额会比国库真实变化小一大截（抽税是"省里记支出、中央记收入"）。 */
    var FC = V.flowc[owner];
    if (FC) {
      o.iIn += num(FC.gain.iron); o.iOut += num(FC.loss.iron);
      o.gIn += num(FC.gain.gold); o.gOut += num(FC.loss.gold);
      if (FC.d && FC.d.maint) o.maint += num(FC.d.maint.iron) + num(FC.d.maint.gold);
    }
    var cen = V.central(owner) || {};
    o.iStock = num(cen.iron); o.gStock = num(cen.gold);
    return o;
  }

  /* 只采"当前看的那一国" —— 64 国全采是白费力气，玩家只关心自己那张图。 */
  AO.balStep = function () {
    if (!V) return;
    var owner = viewOwner();
    if (!owner) return;
    var s = makeSample(owner);
    if (!s) return;
    var arr = H[owner] || (H[owner] = []);
    /* 同一回合重复结算（读档后重跑）不留两条：按 t 覆盖 */
    if (arr.length && arr[arr.length - 1].t === s.t) arr[arr.length - 1] = s;
    else arr.push(s);
    while (arr.length > BAL.histMax) arr.shift();
    if (AO.balUI.isOpen()) render();
  };

  /* =============================================================
   * 二、小工具
   * ============================================================= */
  function hist() {
    var owner = viewOwner();
    return (owner && H[owner]) ? H[owner] : [];
  }
  /* 取最近 n 个点 */
  function tail(arr, n) { return n >= arr.length ? arr.slice() : arr.slice(arr.length - n); }

  /* 一位小数（面板上的数都按这个来：整数看不出 0.4 的差别） */
  function f1(v) {
    var r = Math.round((v || 0) * 10) / 10;
    return (r > 0 ? '+' : '') + r;
  }
  function f0(v) { return Math.round(v || 0).toString(); }

  /* 刻度步长取 1 / 2 / 5 × 10^n —— 轴上的数字才会是 5 / 10 / 15 这种整数级，
   * 而不是 3.7 / 7.4 / 11.1。raw 是"大概一格要多宽"。 */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var e = Math.floor(Math.log(raw) / Math.LN10);
    var p = Math.pow(10, e);
    var f = raw / p;
    var m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return m * p;
  }

  /* =============================================================
   * 三、干跑估算器 forecast —— "照当前配置，下一回合会怎样"
   *
   * 一句话：把 settleTurn ①③（维护/产出/抽税）和 settlePop（口粮/人口）
   * 在**只读的快照**上逐回合重演一遍。三条纪律：
   *   ① 一律走 11-ui 递的钩子取数（repLive.tiers/gross/due、prodGate、
   *      prodMulOf、resCapOf…），禁止在这里抄公式 —— 抄出来的数一旦和
   *      结算分叉，这张图就再也没人信；
   *   ② 只动快照、不动真状态：干跑永远不该有副作用；
   *   ③ 估不了的（战争军费/事件/俸禄/科研/朝贡/市场买卖）不硬估，
   *      用残差 R = 上回合实测净额 − 上回合受控分项实测值 近似。
   *      R 依赖 FLOW.d.prod（结算里新记的一格"纯产出"）把产出从 gain
   *      里拆出来 —— 没有它，熔旧坊的涓流和出口卖货全算成"产出"。
   *
   * 欠费停产的座按"继续停产"推演（悲观但诚实）：它们能不能复工取决于
   * 中央拨款的先后顺序，那不在可预测的范围内。
   * ============================================================= */

  /* tiers 裁到保留座数（先保 Lv2）—— activeTiers 的镜像，
   * 快照里每一步工地完工后都要重裁一次。 */
  function clipTiers(t1, t2, k) {
    if (k === null || k === undefined) return { 1: t1, 2: t2 };
    var n2 = Math.min(t2, k), n1 = Math.min(t1, k - n2);
    return { 1: Math.max(0, n1), 2: Math.max(0, n2) };
  }

  /* 一次性快照：把干跑要读的全部状态拷出来。
   * 拷贝而不是引用 —— 后面 8 步全在快照上走，绝不碰真状态。 */
  function buildSnap(owner) {
    var w = V.world();
    if (!w) return null;
    var c = w.countries[(owner | 0) - 1];
    if (!c) return null;
    var provs = [], built = 0, activeN = 0, sites = [];
    for (var i = 0; i < c.provinces.length; i++) {
      var pid = c.provinces[i] | 0;
      var p = w.provinces[pid - 1];
      var sim = V.sim[pid];
      if (!p || !sim) continue;
      var pr = {
        pid: pid, name: p.name || ('#' + pid),
        v: (V.pop[pid] && V.pop[pid].v) || 1,
        happy: (AO.resHappyOf ? AO.resHappyOf(pid).v : 55),
        cut: 1, taxN: AO.TAX.take, kinds: {}, univ: {}, wall: null
      };
      var pmod = AO.resPMOD ? AO.resPMOD(pid, owner) : null;
      pr.cut = 1 - ((pmod && pmod.maintCut) || 0);
      pr.taxN = AO.TAX.take + ((pmod && pmod.tax) || 0);

      /* 资源建筑：tiers 取**原始档位**（干跑里工地完工会改它），
       * 保留座数取 KEEP 原值（null=全开），每一步现裁。 */
      for (var key in sim) {
        var def = AO.RESOURCE_BY_KEY[key];
        var s = sim[key];
        if (!def || !s) continue;
        var keep = V.rep.keep ? V.rep.keep(pid, key) : null;
        var act = clipTiers((s.tiers && s.tiers[1]) || 0, (s.tiers && s.tiers[2]) || 0, keep);
        built += s.built | 0;
        activeN += act[1] + act[2];
        if (s.site > 0) sites.push({ pid: pid, name: pr.name, kind: key, left: s.site | 0 });
        pr.kinds[key] = {
          def: def, built: s.built | 0,
          t1: (s.tiers && s.tiers[1]) || 0, t2: (s.tiers && s.tiers[2]) || 0,
          keep: keep,
          cool: s.cool || 0, left: s.left || 0, dep: s.n || 0,
          gone: !!s.gone, halted: !!s.halted,
          stock: s.stock || 0, pAcc: s.pAcc || 0, eatAcc: s.eatAcc || 0,
          mAccI: (s.mAcc && s.mAcc.iron) || 0, mAccG: (s.mAcc && s.mAcc.gold) || 0,
          site: s.site | 0, siteKind: s.siteKind, siteTier: s.siteTier || 1,
          cap: (AO.resCapOf ? AO.resCapOf(pid, key) : (AO.CAP ? AO.CAP.base : 150))
        };
      }
      /* 通用设施（学校/兵营/粮仓…）：产出离散，干跑只关心维护与完工 */
      var ks = V.rep.kinds();
      for (var ki = 0; ki < ks.length; ki++) {
        var kind = ks[ki];
        if (pr.kinds[kind]) continue;
        if (kind === 'wall') {
          var wlv = V.live(pid, 'wall');
          if (wlv && wlv.built > 0) {
            if (wlv.site > 0) sites.push({ pid: pid, name: pr.name, kind: 'wall', left: wlv.site });
            pr.wall = {
              off: !!wlv.off, dueI: num(wlv.due.iron), dueG: num(wlv.due.gold),
              mAccI: (wlv.mAcc && wlv.mAcc.iron) || 0, mAccG: (wlv.mAcc && wlv.mAcc.gold) || 0
            };
            built += wlv.built | 0;
            if (!wlv.off) activeN += wlv.built | 0;
          }
          continue;
        }
        var un = V.live(pid, kind);
        if (!un || !(un.built > 0)) continue;
        if (un.site > 0) sites.push({ pid: pid, name: pr.name, kind: kind, left: un.site });
        var unit = V.univMaint ? V.univMaint(kind) : { iron: 0, gold: 0 };
        built += un.built | 0;
        if (!un.off) activeN += un.built | 0;
        pr.univ[kind] = {
          n: un.built | 0, off: !!un.off,
          unitI: num(unit.iron), unitG: num(unit.gold),
          mAccI: (un.mAcc && un.mAcc.iron) || 0, mAccG: (un.mAcc && un.mAcc.gold) || 0
        };
      }
      provs.push(pr);
    }
    return { country: c, provs: provs, built: built, active: activeN, sites: sites };
  }

  function forecast(owner) {
    owner = owner | 0;
    if (!V || !owner) return null;
    var snap = buildSnap(owner);
    if (!snap) return null;
    var P = BAL.projTurns;
    var cen = V.central(owner) || {};
    var iS0 = num(cen.iron), gS0 = num(cen.gold);

    /* ---- 残差 R：估不了的杂项，按"上回合实测 − 上回合受控实测"近似 ---- */
    var R = { i: 0, g: 0, on: false };
    var lastNetI = 0, lastNetG = 0, lastCtrlI = 0, lastCtrlG = 0, pi;
    for (pi = 0; pi < snap.provs.length; pi++) {
      var F = V.flow[snap.provs[pi].pid];
      if (!F) continue;
      R.on = true;                      // 见过一次结算的流水，残差才有锚
      lastNetI += num(F.gain.iron) - num(F.loss.iron);
      lastNetG += num(F.gain.gold) - num(F.loss.gold);
      if (F.d) {
        lastCtrlI += num(F.d.prod.iron) - num(F.d.maint.iron);
        lastCtrlG += num(F.d.prod.gold) - num(F.d.maint.gold);
      }
    }
    var FC = V.flowc[owner];
    if (FC) {
      lastNetI += num(FC.gain.iron) - num(FC.loss.iron);
      lastNetG += num(FC.gain.gold) - num(FC.loss.gold);
      if (FC.d) {
        lastCtrlI -= num(FC.d.maint.iron);
        lastCtrlG -= num(FC.d.maint.gold);
      }
    }
    R.i = lastNetI - lastCtrlI;
    R.g = lastNetG - lastCtrlG;

    var steps = [{ iStock: iS0, gStock: gS0 }];
    var mineOut = [], haltedNow = 0, waste = {}, wk, t, key, uk;
    var provFood = [];                  // 第 1 步的逐省口粮（「该盖」用）

    for (t = 1; t <= P; t++) {
      var prodI = 0, prodG = 0, maintI = 0, maintG = 0, fProd = 0, fNeed = 0;
      for (pi = 0; pi < snap.provs.length; pi++) {
        var pr = snap.provs[pi];

        /* ① 维护：照 activeTiers 裁完的座算；攒整零头逐回合 floor（和
         * payMaint 同一套账，否则 0.2/座 的零头会在 8 回合里攒出假拐点）。
         * 假设缴得起 —— 缴不起的情形走"欠费停产"那条注释。 */
        for (key in pr.kinds) {
          var K = pr.kinds[key];
          if (!K.built || K.gone) continue;
          /* 铁矿深层休眠：不产也不收维护（和 settleTurn ① 那条 continue 同口径） */
          if (K.def.key === 'iron' && K.cool > 0) continue;
          var a = clipTiers(K.t1, K.t2, K.keep);
          var m = K.def.maint || {}, m2 = K.def.maint2 || m;
          var dI = ((m.iron || 0) * a[1] + (m2.iron || 0) * a[2]) * pr.cut;
          var dG = ((m.gold || 0) * a[1] + (m2.gold || 0) * a[2]) * pr.cut;
          var payI = Math.floor(K.mAccI + dI); K.mAccI += dI - payI; maintI += payI;
          var payG = Math.floor(K.mAccG + dG); K.mAccG += dG - payG; maintG += payG;
        }
        for (uk in pr.univ) {
          var U = pr.univ[uk];
          if (U.off || !(U.n > 0)) continue;
          var udI = U.unitI * U.n, udG = U.unitG * U.n;
          var upI = Math.floor(U.mAccI + udI); U.mAccI += udI - upI; maintI += upI;
          var upG = Math.floor(U.mAccG + udG); U.mAccG += udG - upG; maintG += upG;
        }
        if (pr.wall && !pr.wall.off) {
          var wI = Math.floor(pr.wall.mAccI + pr.wall.dueI); pr.wall.mAccI += pr.wall.dueI - wI; maintI += wI;
          var wG = Math.floor(pr.wall.mAccG + pr.wall.dueG); pr.wall.mAccG += pr.wall.dueG - wG; maintG += wG;
        }

        /* ② 工地推进：完工会改座数，所以排在维护之后、产出之前 */
        for (key in pr.kinds) {
          K = pr.kinds[key];
          if (!(K.site > 0)) continue;
          K.site--;
          if (!K.site) {
            if (K.siteKind === 'up') { if (K.t1 > 0) { K.t1--; K.t2++; } }
            else if (K.siteTier === 2) { K.t2++; K.built++; }
            else { K.t1++; K.built++; }
            K.siteKind = null; K.siteTier = 1;
          }
        }
        for (uk in pr.univ) {
          U = pr.univ[uk];
          if (U.site > 0) { U.site--; if (!U.site) U.n++; }
        }

        /* ③ 产出：cool → 采空 → 停产 → 战争门 → 乘数 → 攒整 → 吃 → 满仓 → 抽税，
         *    一步一步照 settleTurn ③ 抄，顺序不能换。 */
        var food = 0;
        for (key in pr.kinds) {
          K = pr.kinds[key];
          if (!K.built || K.gone) continue;
          if (K.cool > 0) {
            K.cool--;
            if (K.cool <= 0) { K.cool = 0; K.left = K.dep; }
            continue;
          }
          if (K.left <= 0) {
            if ((K.def.cool || 0) > 0) K.cool = K.def.cool; else K.gone = true;
            continue;
          }
          if (K.halted) { if (t === 1) haltedNow++; continue; }
          if (V.prodGate && !V.prodGate(pr.pid, key)) continue;
          a = clipTiers(K.t1, K.t2, K.keep);
          var mul = V.prodMulOf ? V.prodMulOf(pr.pid, key, owner) : 1;
          var grossF = ((K.def.per || 0) * a[1] + (K.def.per2 || K.def.per || 0) * a[2]) * mul;
          var gross = Math.floor(grossF + K.pAcc);
          K.pAcc += grossF - gross;
          if (!gross) continue;
          var take = Math.min(K.left, gross);
          K.left -= take;
          K.eatAcc += take * (K.def.eat || 0);
          var eaten = Math.floor(K.eatAcc);
          K.eatAcc -= eaten;
          var net = take - eaten;
          var room = K.cap - K.stock;
          var kept = net;
          if (room < kept) {
            kept = room > 0 ? room : 0;
            waste[key] = (waste[key] || 0) + (net - kept);
          }
          K.stock += kept;
          if (key === 'iron') prodI += kept;
          else if (key === 'gold') prodG += kept;
          else if (key === 'grain' || key === 'fish') food += kept;
          /* 抽税是省内→中央的内部划账，对国家净额是零，只影响存在哪边；
           * 为了"下一回合省库还装不装得下"照扣。 */
          if (take >= AO.TAX.min && K.stock >= pr.taxN) K.stock -= pr.taxN;
          if (K.left <= 0) {
            if ((K.def.cool || 0) > 0) K.cool = K.def.cool;
            else K.gone = true;
            /* 采空就报，**不管之后会不会回满**：预测要提醒的是"这一脉什么时候断"。
             * 铁 v18 起改 48 回合休眠，但那 48 回合里产量确实是 0 —— 不报等于骗人。 */
            if (key === 'iron' || key === 'gold') mineOut.push({ key: key, pid: pr.pid, name: pr.name, turn: t });
          }
        }

        /* ④ 人口：need 按**当前**人口算，先吃仓里的存粮，再按余缺定涨跌 */
        var need = Math.max(1, Math.round(pr.v / 2000000));
        var gk = pr.kinds.grain, fk = pr.kinds.fish;
        var eat = Math.min(gk ? gk.stock : 0, need);
        if (gk) gk.stock -= eat;
        if (eat < need && fk) {
          var more = Math.min(fk.stock, need - eat);
          fk.stock -= more;
          eat += more;
        }
        var surplus = food - need;
        var rate = 0;
        if (eat < need) rate = -0.015;
        else if (surplus >= 3) rate = 0.012;
        else if (surplus >= 1) rate = 0.004;
        if (rate > 0) {
          var G = AO.GOV;
          if (pr.happy <= G.happyLow) rate *= G.popLowMul;
          else if (pr.happy >= G.happyHigh) rate *= G.popHighMul;
        }
        pr.v = Math.max(1000, Math.round(pr.v * (1 + rate)));
        fProd += food; fNeed += need;
        if (t === 1) {
          provFood.push({ pid: pr.pid, name: pr.name, food: food, need: need, surplus: surplus });
        }
      }
      steps.push({
        prodI: prodI, prodG: prodG, maintI: maintI, maintG: maintG,
        fProd: fProd, fNeed: fNeed,
        netI: prodI - maintI + R.i, netG: prodG - maintG + R.g
      });
    }
    /* 库存走完再累：预测净额全记在中央头上（和历史外推同一口径 ——
     * 省/中央的分账对"国家还能撑几回合"这个问题不重要）。 */
    var ci = iS0, cg = gS0, si;
    for (si = 1; si < steps.length; si++) {
      ci += steps[si].netI; cg += steps[si].netG;
      steps[si].iStock = ci; steps[si].gStock = cg;
    }

    /* 上回合的满仓损耗（「别再往死里盖」用实测，比推演值硬） */
    var capLast = {};
    for (pi = 0; pi < snap.provs.length; pi++) {
      var F2 = V.flow[snap.provs[pi].pid];
      if (F2 && F2.d && F2.d.cap) {
        for (wk in F2.d.cap) capLast[wk] = (capLast[wk] || 0) + num(F2.d.cap[wk]);
      }
    }
    /* 在战？（打起来的时候残差里全是军火钱，预测必须自己声明不可信） */
    var inWar = false;
    if (AO.resWar && AO.resWar.wars) {
      for (wk in AO.resWar.wars) {
        if (AO.resWar.wars[wk] && String(wk).split('|').indexOf(String(owner)) >= 0) { inWar = true; break; }
      }
    }
    return {
      owner: owner, P: P, steps: steps, R: R,
      built: snap.built, active: snap.active, sites: snap.sites,
      mineOut: mineOut, haltedNow: haltedNow, waste: waste,
      capLast: capLast, inWar: inWar, provFood: provFood
    };
  }
  /* 对外：AI / 测试可以直接要一份干跑（纯函数，跑多少次都没有副作用） */
  AO.forecast = function (owner) { return forecast(owner || viewOwner()); };

  /* 上回合受控分项的实测值（测试用来验"干跑和结算同源"：
   * forecast 在结算前采一份、nextTurn 之后拿这个对账）。 */
  function actualSums(owner) {
    var r = { prodI: 0, prodG: 0, maintI: 0, maintG: 0, netI: 0, netG: 0, gainI: 0, gainG: 0, on: false };
    if (!V) return r;
    var w = V.world();
    var c = w ? w.countries[(owner | 0) - 1] : null;
    if (!c) return r;
    for (var i = 0; i < c.provinces.length; i++) {
      var F = V.flow[c.provinces[i]];
      if (!F) continue;
      r.on = true;
      r.netI += num(F.gain.iron) - num(F.loss.iron);
      r.netG += num(F.gain.gold) - num(F.loss.gold);
      r.gainI += num(F.gain.iron); r.gainG += num(F.gain.gold);
      if (F.d) {
        r.prodI += num(F.d.prod.iron); r.prodG += num(F.d.prod.gold);
        r.maintI += num(F.d.maint.iron); r.maintG += num(F.d.maint.gold);
      }
    }
    var FC = V.flowc[owner | 0];
    if (FC) {
      r.netI += num(FC.gain.iron) - num(FC.loss.iron);
      r.netG += num(FC.gain.gold) - num(FC.loss.gold);
      if (FC.d) { r.maintI += num(FC.d.maint.iron); r.maintG += num(FC.d.maint.gold); }
    }
    return r;
  }

  /* =============================================================
   * 四、SVG 折线图（手写，不引库 —— file:// 直开的单页多一个库
   * 就多一个"离线打不开"的理由）
   * ============================================================= */
  function svgChart(o) {
    var W = o.w || 452, Hh = o.h || 96;
    var pl = 34, pr = 8, pt = 10, pb = 15;
    var iw = W - pl - pr, ih = Hh - pt - pb;
    var series = o.series || [], i, j;

    /* ---- y 范围 ---- */
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < series.length; i++) {
      for (j = 0; j < series[i].pts.length; j++) {
        var y = series[i].pts[j].y;
        if (!isFinite(y)) continue;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    /* 上沿封顶：库存图里金可能一路推到 800，把 288 的铁压成一条贴底的线。
     * 封顶之后预测线会冲出画面 —— 那正好读作"涨得没边"，比两条线挤在一起强。
     * 下沿不封：跌破零就是"见底"，那个必须看得见。 */
    if (o.capHi && hi > o.capHi) hi = o.capHi;
    if (hi - lo < 1e-6) { hi = lo + 1; }

    /* 刻度取"整数级"：0 / 50 / 100 这种，而不是 74 / 93 / 112。 */
    var step = niceStep((hi - lo) / 2);
    var yLo = Math.floor(lo / step) * step;
    var yHi = Math.ceil(hi / step) * step;
    if (yHi - yLo < step * 2) yHi = yLo + step * 2;
    lo = yLo; hi = yHi;

    var xMin = o.xMin, xMax = o.xMax;
    if (!(xMax > xMin)) { xMax = xMin + 1; }
    function X(x) { return pl + (x - xMin) / (xMax - xMin) * iw; }
    function Y(y) { return pt + ih - (y - lo) / (hi - lo) * ih; }

    var out = ['<svg class="bchart" viewBox="0 0 ' + W + ' ' + Hh + '" width="100%" height="' + Hh + '" ' +
      'preserveAspectRatio="none" aria-hidden="true">'];

    /* ---- 网格 + y 轴标签（三档：底 / 中 / 顶） ---- */
    var lastLbl = null;
    for (i = 0; i < 3; i++) {
      var gy = lo + (hi - lo) * (i / 2), yy = Y(gy);
      out.push('<line x1="' + pl + '" y1="' + yy.toFixed(1) + '" x2="' + (W - pr) +
        '" y2="' + yy.toFixed(1) + '" stroke="rgba(20,26,32,.07)" stroke-width="1"/>');
      var lbl = f0(gy);
      if (lbl !== lastLbl) {      // 范围很小时三个刻度会重号，重的不画
        out.push('<text x="' + (pl - 4) + '" y="' + (yy + 3).toFixed(1) +
          '" text-anchor="end" font-size="9" fill="#a8b0b7">' + lbl + '</text>');
        lastLbl = lbl;
      }
    }
    /* 零轴：净额图的"盈亏分界"，比任何网格线都重要，单独加粗 */
    if (o.zero && lo < 0 && hi > 0) {
      var zy = Y(0);
      out.push('<line x1="' + pl + '" y1="' + zy.toFixed(1) + '" x2="' + (W - pr) +
        '" y2="' + zy.toFixed(1) + '" stroke="rgba(20,26,32,.30)" stroke-width="1" stroke-dasharray="3 3"/>');
    }

    /* ---- 折线 ---- */
    for (i = 0; i < series.length; i++) {
      var s = series[i], pts = s.pts, d = '', area = '';
      var started = false;
      for (j = 0; j < pts.length; j++) {
        var p = pts[j];
        if (!isFinite(p.y)) { started = false; continue; }
        var cmd = started ? 'L' : 'M';
        d += cmd + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1) + ' ';
        started = true;
      }
      if (s.fill && d) {
        /* 面积填充：只用来让"哪条在上面"更好读，不承担数值信息 */
        area = d + 'L' + X(pts[pts.length - 1].x).toFixed(1) + ' ' + Y(o.zero ? 0 : lo).toFixed(1) +
          ' L' + X(pts[0].x).toFixed(1) + ' ' + Y(o.zero ? 0 : lo).toFixed(1) + ' Z';
        out.push('<path d="' + area + '" fill="' + s.color + '" opacity=".10"/>');
      }
      if (d) {
        out.push('<path d="' + d.trim() + '" fill="none" stroke="' + s.color + '" stroke-width="' +
          (s.width || 1.6) + '" stroke-linejoin="round" stroke-linecap="round"' +
          (s.dash ? ' stroke-dasharray="4 3" opacity=".75"' : '') + '/>');
      }
      /* 最后一个点画个小圆：让"现在到哪儿了"一眼看得见 */
      var lastP = null;
      for (j = pts.length - 1; j >= 0; j--) { if (isFinite(pts[j].y)) { lastP = pts[j]; break; } }
      if (lastP && !s.dash) {
        out.push('<circle cx="' + X(lastP.x).toFixed(1) + '" cy="' + Y(lastP.y).toFixed(1) +
          '" r="2.2" fill="' + s.color + '"/>');
      }
    }

    /* ---- 柱状（停产处数用） ---- */
    if (o.bars) {
      var bw = Math.max(2, Math.min(9, iw / Math.max(1, o.bars.length) - 2));
      for (i = 0; i < o.bars.length; i++) {
        var bp = o.bars[i];
        if (!(bp.y > 0)) continue;
        var bx = X(bp.x) - bw / 2, by = Y(bp.y);
        out.push('<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw +
          '" height="' + Math.max(1, Y(0) - by).toFixed(1) + '" rx="1.5" fill="' +
          (o.barColor || BAL.color.halted) + '" opacity=".55"/>');
      }
    }

    /* ---- x 轴：只标首尾两个回合数（中间标了会糊成一团） ---- */
    out.push('<text x="' + pl + '" y="' + (Hh - 3) + '" font-size="9" fill="#b6bec4">' + (o.xLabel0 || '') + '</text>');
    out.push('<text x="' + (W - pr) + '" y="' + (Hh - 3) + '" text-anchor="end" font-size="9" fill="#b6bec4">' +
      (o.xLabel1 || '') + '</text>');
    /* 推演区用一道竖线切开：左边是"已经发生"，右边是"照当前配置下去" */
    if (o.splitX !== undefined && o.splitX > xMin && o.splitX < xMax) {
      var sx = X(o.splitX);
      out.push('<line x1="' + sx + '" y1="' + pt + '" x2="' + sx + '" y2="' +
        (pt + ih) + '" stroke="rgba(20,26,32,.22)" stroke-width="1" stroke-dasharray="2 3"/>');
    }
    out.push('</svg>');
    return out.join('');
  }

  /* 图例：一行小色块 + 名字（图上不标文字，免得折线穿过字） */
  function legend(items) {
    var h = '<div class="bleg">';
    for (var i = 0; i < items.length; i++) {
      h += '<span><i style="background:' + items[i].color + '"></i>' + items[i].name + '</span>';
    }
    return h + '</div>';
  }

  /* =============================================================
   * 五、面板（「经营」页左栏：往 #balKpi / #balBody 写什么）
   * ============================================================= */
  function render() {
    if (!V) return;
    var w = V.world();
    if (!w) return;
    /* 记住滚动位置：这张页每回合都整块重画（改了保留座数也会重画） */
    var bodyEl = document.getElementById('balBody');
    var keepTop = bodyEl ? bodyEl.scrollTop : 0;
    var rb = document.getElementById('balRange');
    if (rb) {
      var bs = rb.querySelectorAll('button');
      for (var bi = 0; bi < bs.length; bi++) {
        bs[bi].classList.toggle('on', +bs[bi].getAttribute('data-r') === UI.range);
      }
    }

    var owner = viewOwner();
    var fc = owner ? forecast(owner) : null;
    if (!fc || !fc.steps[1]) {
      UI.marks = Object.create(null);
      set('balKpi', '');
      set('balBody', '<div class="balEmpty">这一页要等开局以后才有东西可算。</div>');
      return;
    }

    var cen = V.central(owner) || {};
    var all = hist();
    var hasHist = all.length >= 2;
    var arr = hasHist ? tail(all, UI.range) : [];
    var last = all.length ? all[all.length - 1] : null;
    /* 时间轴锚点：有历史用最后一个采样，没历史用当前回合 ——
     * 干跑从"现在"出发，第 1 步就是下一回合。 */
    var anchor = last ? last.t : V.turn();
    var st1 = fc.steps[1], stP = fc.steps[fc.P];

    /* ---- 顶部四格：库存是实测，净额全换干跑的第 1 步（"下一回合"） ---- */
    var kpi = '';
    kpi += kpiBox('铁', f0(num(cen.iron)), '下回合预测净 ' + f1(st1.netI), st1.netI >= 0 ? 'ok' : 'warn');
    kpi += kpiBox('金', f0(num(cen.gold)), '下回合预测净 ' + f1(st1.netG), st1.netG >= 0 ? 'ok' : 'warn');
    var foodNow = last ? last.fProd : st1.fProd, needNow = last ? last.fNeed : st1.fNeed;
    kpi += kpiBox('口粮', f0(foodNow) + ' / ' + f0(needNow),
      '下回合余 ' + f0(st1.fProd - st1.fNeed), st1.fProd >= st1.fNeed ? 'ok' : 'warn');
    kpi += kpiBox('在跑', fc.active + ' / ' + fc.built,
      fc.haltedNow ? fc.haltedNow + ' 处欠费停产' : '无失修', fc.haltedNow ? 'warn' : '');
    set('balKpi', kpi);

    /* ---- 图宽按左栏实际宽度算（全屏两栏后左栏 900+，按 452 画会横向变形） ---- */
    var bbEl = document.getElementById('balBody');
    var chartW = Math.max(320, ((bbEl && bbEl.clientWidth) || 452) - 20);
    var xMin = hasHist ? arr[0].t : anchor;
    var xMax = hasHist ? arr[arr.length - 1].t : anchor;
    var xMax2 = anchor + fc.P;

    var h = '';
    /* 在战黄条：残差里全是军火钱的时候，预测必须自己声明不可信 */
    if (fc.inWar) {
      h += '<div class="bwar">交战中：军费只在残差里按上回合近似 —— 这页的虚线只当方向看。</div>';
    }

    /* 干跑点列：{ x: 回合, y: 值 }，四张图共用。
     * fx  从"现在"（step 0 = 当前库存）出发；fx1 从某个实测值接出去 ——
     * 口粮的 step 0 没有意义（没有"现在的产出"），直接从 0 画会跳一条假线。 */
    function fx(field) {
      return fc.steps.map(function (s, idx) { return { x: anchor + idx, y: num(s[field]) }; });
    }
    function fx1(field, startY) {
      var pts = [];
      if (startY !== null && startY !== undefined) pts.push({ x: anchor, y: startY });
      for (var q = 1; q < fc.steps.length; q++) {
        pts.push({ x: anchor + q, y: num(fc.steps[q][field]) });
      }
      return pts;
    }

    if (hasHist) {
      /* ---- 图 1：铁金净额（只画已经发生的 —— 这张图回答"这回合是赚是亏"） ---- */
      var s1 = [
        { color: BAL.color.iron, pts: arr.map(function (s) { return { x: s.t, y: s.iIn - s.iOut }; }) },
        { color: BAL.color.gold, pts: arr.map(function (s) { return { x: s.t, y: s.gIn - s.gOut }; }) }
      ];
      h += chartCard('铁金净额（收入 − 支出）',
        legend([{ name: '铁', color: BAL.color.iron }, { name: '金', color: BAL.color.gold }]),
        svgChart({ series: s1, zero: true, xMin: xMin, xMax: xMax, w: chartW, h: 112,
          xLabel0: '第 ' + xMin + ' 回合', xLabel1: '第 ' + xMax + ' 回合' }),
        '「净额」= 这一回合真正进出国库的铁/金。线在零轴以下就是在吃老本。');

      /* ---- 图 2：粮食（实测两线 + 干跑虚线 —— 交叉点就是该盖农场的时刻） ---- */
      var s2 = [
        { color: BAL.color.food, pts: arr.map(function (s) { return { x: s.t, y: s.fProd }; }), fill: 1 },
        { color: BAL.color.need, pts: arr.map(function (s) { return { x: s.t, y: s.fNeed }; }) },
        { color: BAL.color.food, dash: 1, width: 1.3, pts: fx1('fProd', last ? last.fProd : null) },
        { color: BAL.color.need, dash: 1, width: 1.3, pts: fx1('fNeed', last ? last.fNeed : null) }
      ];
      h += chartCard('粮食：产出 vs 口粮',
        legend([{ name: '口粮产出', color: BAL.color.food }, { name: '人口要吃', color: BAL.color.need },
          { name: '虚线 = 推演 ' + fc.P + ' 回合', color: '#c9ccd0' }]),
        svgChart({ series: s2, xMin: xMin, xMax: xMax2, splitX: anchor, w: chartW, h: 104,
          xLabel0: '第 ' + xMin + ' 回合', xLabel1: '第 ' + xMax2 + ' 回合' }),
        '两线之间的差就是人口的涨落依据：产出 − 口粮 ≥ 3 时人口涨得最快，' +
        '小于 0 就会开始吃存粮、掉人口。虚线按当前开关配置推演，人口涨上去红线会跟着爬。');
    } else {
      /* 没攒够历史也照画：干跑不需要历史（新档第 1 回合就有预测线，
        这修掉了老版"两回合白屏"的问题） */
      var s2b = [
        { color: BAL.color.food, dash: 1, width: 1.3, pts: fx1('fProd') },
        { color: BAL.color.need, dash: 1, width: 1.3, pts: fx1('fNeed') }
      ];
      h += chartCard('粮食：产出 vs 口粮（推演）',
        legend([{ name: '口粮产出', color: BAL.color.food }, { name: '人口要吃', color: BAL.color.need }]),
        svgChart({ series: s2b, xMin: anchor, xMax: xMax2, w: chartW, h: 104,
          xLabel0: '第 ' + anchor + ' 回合', xLabel1: '第 ' + xMax2 + ' 回合' }),
        '实测线再走几回合就会长出来 —— 现在先看推演：虚线相交的那回合，就该去盖农场了。');
    }

    /* ---- 图 3：库存 + 干跑虚线（不再必然是直线：矿采空会拐头） ---- */
    var s3 = [];
    if (hasHist) {
      s3.push({ color: BAL.color.iron, pts: arr.map(function (s) { return { x: s.t, y: s.iStock }; }) });
      s3.push({ color: BAL.color.gold, pts: arr.map(function (s) { return { x: s.t, y: s.gStock }; }) });
    }
    s3.push({ color: BAL.color.iron, dash: 1, width: 1.3, pts: fx('iStock') });
    s3.push({ color: BAL.color.gold, dash: 1, width: 1.3, pts: fx('gStock') });
    var capHi = 0, ci;
    if (hasHist) {
      for (ci = 0; ci < arr.length; ci++) capHi = Math.max(capHi, arr[ci].iStock, arr[ci].gStock);
    }
    for (ci = 1; ci < fc.steps.length; ci++) {
      capHi = Math.max(capHi, fc.steps[ci].iStock, fc.steps[ci].gStock);
    }
    capHi = Math.max(1, capHi) * 1.25;
    h += chartCard('中央国库库存（虚线 = 按当前配置推演 ' + fc.P + ' 回合）',
      legend([{ name: '铁', color: BAL.color.iron }, { name: '金', color: BAL.color.gold },
        { name: '虚线 = 干跑推演', color: '#c9ccd0' }]),
      svgChart({ series: s3, xMin: xMin, xMax: xMax2, splitX: anchor, capHi: capHi, w: chartW, h: 118,
        xLabel0: '第 ' + xMin + ' 回合', xLabel1: '第 ' + xMax2 + ' 回合' }),
      '虚线每一段都是照当前开关配置重演出来的：铁矿采空的那一回它会拐头，' +
      '虚线要碰到零，就是该去右边减保留座数的时候。');

    if (hasHist) {
      /* ---- 图 4：失修（已经发生的损失，不是"省了钱"） ---- */
      var s4 = [{ color: BAL.color.halted, pts: arr.map(function (s) { return { x: s.t, y: s.halted }; }) }];
      h += chartCard('失修处数',
        legend([{ name: '欠费停产（主动停的不算）', color: BAL.color.halted }]),
        svgChart({ series: s4, bars: arr.map(function (s) { return { x: s.t, y: s.halted }; }),
          xMin: xMin, xMax: xMax, w: chartW, h: 80,
          xLabel0: '第 ' + xMin + ' 回合', xLabel1: '第 ' + xMax + ' 回合' }),
        '失修不是"停了省钱"，是"没钱了"：产量归零，还要按 3 倍维护价才修得回来。');
    }

    /* ---- 预测小结 ---- */
    var foodD = (st1.fProd - st1.fNeed);
    var foodD8 = (stP.fProd - stP.fNeed);
    var foodRate = fc.P > 1 ? (foodD8 - foodD) / (fc.P - 1) : 0;
    h += '<div class="bcard"><div class="bh">照当前配置再走 ' + fc.P + ' 回合</div>' +
      '<div class="bproj">' +
      projLine('铁', num(cen.iron), stP.iStock, st1.netI) +
      projLine('金', num(cen.gold), stP.gStock, st1.netG) +
      projLine('口粮盈余', foodD, foodD8, foodRate) +
      '</div>' + fcNotes(fc) +
      '<div class="btip">推演 = 产出与维护按当前开关配置逐回合重演（和结算同一条算路）；' +
      '税外杂项按上回合实测近似，不含随机事件与新开战。</div></div>';

    /* ---- 建议：先修（开关）/ 该盖（建造）两卡 ---- */
    h += adviceFix(fc);
    h += adviceBuild(fc);

    set('balBody', h);
    if (bodyEl) bodyEl.scrollTop = keepTop;

    /* 维修右栏行尾的 ✓/▲ 也顺手算出来（两边同一份干跑） */
    computeMarks(fc);
  }

  /* 预测小结下面的小字注记：每一条都是"这个预测哪里不可信" */
  function fcNotes(fc) {
    var out = '', i;
    /* 矿寿：按矿种归并（铁/金分开报） */
    var byKey = { iron: null, gold: null };
    for (i = 0; i < fc.mineOut.length; i++) {
      var mo = fc.mineOut[i];
      var b = byKey[mo.key];
      if (!b || mo.turn < b.turn) byKey[mo.key] = mo;
    }
    var cn = { iron: '铁矿', gold: '金矿' };
    for (var k in byKey) {
      if (!byKey[k]) continue;
      var n = 0;
      for (i = 0; i < fc.mineOut.length; i++) if (fc.mineOut[i].key === k) n++;
      out += note(cn[k] + ' ' + n + ' 处将在 ' + fc.P + ' 回合内采空（最早第 ' +
        (V.turn() + byKey[k].turn) + ' 回合，' + esc(byKey[k].name) + '）—— 之后那一格产量归零' +
        (k === 'iron' ? '（深层休眠 48 回合后回满）' : '') + '。');
    }
    if (fc.haltedNow) {
      out += note(fc.haltedNow + ' 处欠费停产按"继续停产"推演；把铁金补上会自动复工，线会比这个好。');
    }
    if (!fc.R.on) {
      out += note('还没有完整回合的流水：税外杂项（俸禄/科研/朝贡…）未计入，第一回合的预测会偏乐观。');
    }
    for (var wk in fc.waste) {
      if (fc.capLast[wk]) continue;          // 已有实测满仓的，建议卡里会说
      out += note('推演中' + (AO.RESOURCE_BY_KEY[wk] ? AO.RESOURCE_BY_KEY[wk].cn : wk) +
        '将开始满仓浪费（省库 150 顶格）—— 产出进不了库。');
    }
    return out;
  }
  function note(txt) { return '<div class="bnote">' + txt + '</div>'; }

  function projLine(name, from, to, net) {
    var cls = to >= from ? 'ok' : 'warn';
    var arrow = to > from + 0.05 ? '↑' : (to < from - 0.05 ? '↓' : '→');
    return '<div class="bpl"><span class="nm">' + name + '</span>' +
      '<b>' + f0(from) + '</b><i class="' + cls + '">' + arrow + '</i><b>' + f0(to) + '</b>' +
      '<em class="' + cls + '">' + f1(net) + '／回合</em></div>';
  }

  function kpiBox(name, val, sub, cls) {
    return '<div class="bkpi' + (cls ? ' ' + cls : '') + '"><span>' + name + '</span>' +
      '<b>' + val + '</b><em>' + sub + '</em></div>';
  }

  function chartCard(title, leg, svg, tip) {
    return '<div class="bcard"><div class="bh">' + title + '</div>' + leg + svg +
      (tip ? '<div class="btip">' + tip + '</div>' : '') + '</div>';
  }

  function set(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function advCard(title, items) {
    var h = '<div class="bcard"><div class="bh">' + title + '</div><div class="badv">';
    for (var i = 0; i < items.length; i++) {
      h += '<div class="badv1 ' + (items[i].cls || '') + '"><p>' + items[i].txt + '</p><em>' +
        items[i].how +
        (items[i].pid ? ' <button type="button" class="bgo" data-goto="' + items[i].pid +
          '" title="选中这座城并打开省卡">去看看</button>' : '') +
        '</em></div>';
    }
    return h + '</div></div>';
  }

  /* =============================================================
   * 六、建议 —— 先修（开关）
   *
   * 每条建议都带"依据"和"去哪儿改"。数字全部来自干跑（和历史样本），
   * 和图上画的是同一份 —— 玩家真正缺的不是结论，是"凭什么这么说"。
   * ============================================================= */
  /* 库存推演第一次穿零的回合（找不到返回 0 = 推演期内没见底） */
  function crossTurn(fc, field) {
    for (var i = 1; i < fc.steps.length; i++) {
      if (fc.steps[i][field] <= 0) return V.turn() + i;
    }
    return 0;
  }

  function adviceFix(fc) {
    var out = [], R = V.rep;
    var st1 = fc.steps[1];

    /* ① 口粮缺口：最要命的一条，永远排第一。
     * 分清两种缺口：有停着的农场/渔港 = 你自己关的，开回来就行；
     * 一座没停还缺 = 产能不够，只能新建 / 升 Lv2。 */
    if (st1.fProd < st1.fNeed) {
      var gap = st1.fNeed - st1.fProd;
      var gs = R.keepStat(fc.owner, 'grain'), fs = R.keepStat(fc.owner, 'fish');
      var idleFood = (gs.built - gs.keep) + (fs.built - fs.keep);
      out.push({
        cls: 'bad',
        txt: '下回合口粮缺 <b>' + f0(gap) + '</b>：要吃 ' + f0(st1.fNeed) +
          '，只产得了 ' + f0(st1.fProd) + '。人口会先吃存粮，存粮见底就开始掉。',
        how: idleFood > 0
          ? '农场/渔港还有 <b>' + idleFood + '</b> 座停着 —— 去右栏把它们开回来，这是最快的补法。'
          : '农场/渔港全都在跑，缺的是产能：去「该盖」看该在哪盖几座。'
      });
    } else if (st1.fProd - st1.fNeed < 1) {
      out.push({
        cls: '',
        txt: '口粮刚好够吃（余 ' + f0(st1.fProd - st1.fNeed) + '），人口不涨不跌 —— ' +
          '想让城变大，得先把产出拉到比口粮多 ' + BAL.foodTarget + ' 以上。',
        how: '右栏多留几座农场/渔港，或者去「该盖」盖新的。'
      });
    }

    /* ② 见底倒计时：走库存推演找穿零点 —— 不再是"库存÷平均净额"的除法，
     * 矿采空导致的拐弯它自己会算进去。 */
    if (st1.netI < -0.05) {
      var tI = crossTurn(fc, 'iStock');
      out.push({
        cls: tI && tI - V.turn() <= fc.P ? 'bad' : 'warn',
        txt: '铁下回合净 <b>' + f1(st1.netI) + '</b>，国库 ' + f0(fc.steps[0].iStock) +
          (tI ? ' —— 推演到 <b>第 ' + tI + ' 回合</b>见底' : ' —— 推演 ' + fc.P + ' 回合内还见不了底') + '。',
        how: '优先停掉"产出不值钱"的那几类（盐场、金矿场可以先减半），口粮相关的别动。'
      });
    }
    if (st1.netG < -0.05) {
      var tG = crossTurn(fc, 'gStock');
      out.push({
        cls: tG && tG - V.turn() <= fc.P ? 'bad' : 'warn',
        txt: '金下回合净 <b>' + f1(st1.netG) + '</b>，国库 ' + f0(fc.steps[0].gStock) +
          (tG ? ' —— 推演到 <b>第 ' + tG + ' 回合</b>见底' : ' —— 推演 ' + fc.P + ' 回合内还见不了底') + '。',
        how: '金主要花在维护和军费上；军费那部分在「军务」里，维护在右栏的保留座数里。'
      });
    }

    /* ③ 有富余却还停着："停多了"的反向提醒 */
    if (st1.netI > 0.5 && st1.netG > 0.5) {
      var idle = [];
      var ks = R.kinds();
      for (var i = 0; i < ks.length; i++) {
        var st = R.keepStat(fc.owner, ks[i]);
        if (st.built > 0 && st.keep < st.built) idle.push(R.kindCn(ks[i]) + ' ' + (st.built - st.keep) + ' 座');
      }
      if (idle.length) {
        out.push({
          cls: 'ok',
          txt: '铁金都在涨（下回合 ' + f1(st1.netI) + ' / ' + f1(st1.netG) + '），但还有 <b>' +
            idle.slice(0, 3).join('、') + (idle.length > 3 ? ' 等' : '') + '</b> 停着没开。',
          how: '这些座开回来能直接换成产量，钱够的时候没必要省。'
        });
      }
    }

    /* ④ 维护占比：钱花在哪 */
    var inc = st1.prodI + st1.prodG + Math.max(0, fc.R.i) + Math.max(0, fc.R.g);
    var maintSum = st1.maintI + st1.maintG;
    if (inc > 0 && maintSum / inc > BAL.maintRed) {
      out.push({
        cls: 'warn',
        txt: '维护吃掉岁入的 <b>' + Math.round(maintSum / inc * 100) + '%</b>（下回合 ' +
          f0(maintSum) + ' 铁金）—— 这是最大的一笔固定开销。',
        how: '先看"已建最多、单价又不高"的那几类（渔港/农场往往是大头），一座一座减。'
      });
    }

    /* ⑤ 失修：已经发生的损失 */
    if (fc.haltedNow > 0) {
      out.push({
        cls: 'bad',
        txt: '有 <b>' + fc.haltedNow + '</b> 处欠费停产 —— 产量为 0，按 3 倍维护价才修得回来。',
        how: '右栏最下面的失修清单里点「修」把它修回来（3 倍维护价，一次性）。'
      });
    }

    if (!out.length) {
      out.push({ cls: 'ok', txt: '这几项都还稳：口粮够吃、铁金不塌、没有失修。', how: '可以去「该盖」看看下一步盖什么。' });
    }
    return advCard('先修（开关）', out);
  }

  /* =============================================================
   * 七、建议 —— 该盖（建造）
   *
   * "最好建多少"是一条目标带：
   *   下限 = 口粮比人口多 3（最快涨档）/ 预测净额 ≥ 0；
   *   上限 = 满仓浪费 / 维护吃岁入 55% / 矿寿不足 8 回合。
   * 建筑本身没有座数上限、每座产量又是平的 —— 这三个刹车不变成数字，
   * "往死里建"就是默认玩法。规则七条，每条带省名/座数/依据。
   * ============================================================= */
  function adviceBuild(fc) {
    var out = [];
    var st1 = fc.steps[1];
    var tgt = BAL.foodTarget;

    /* ⑦ 净额为负：建造建议整体降级 —— 这时候盖什么都是加速见底 */
    if (st1.netI < -0.05 || st1.netG < -0.05) {
      out.push({
        cls: 'warn',
        txt: '铁/金预测净额为负（' + f1(st1.netI) + ' / ' + f1(st1.netG) +
          '）：先修收支，再谈盖新的 —— 现在开新工地只会加速见底。',
        how: '去「先修」按顺序处理；真要盖，只盖口粮（农场/渔港）保人口。'
      });
      return advCard('该盖（建造）', out);
    }

    /* ⑤ 维护红线：还没到"不能盖"，但得先挂个号 */
    var inc = st1.prodI + st1.prodG + Math.max(0, fc.R.i) + Math.max(0, fc.R.g);
    var maintSum = st1.maintI + st1.maintG;
    var redLine = inc > 0 && maintSum / inc > BAL.maintRed;

    /* ① 口粮档：逐省算"到最快涨还差几座"（每座按 Lv1 的 per 估，标 ≈） */
    var deficit = [], full = [];
    for (var i = 0; i < fc.provFood.length; i++) {
      var pf = fc.provFood[i];
      if (pf.food - pf.need < tgt) deficit.push(pf);
      else full.push(pf);
    }
    if (deficit.length) {
      deficit.sort(function (a, b) { return (b.need + tgt - b.food) - (a.need + tgt - a.food); });
      var names = [];
      for (i = 0; i < Math.min(2, deficit.length); i++) {
        var d = deficit[i];
        var seats = Math.ceil((d.need + tgt - d.food) / 3);   // 农场/渔港 Lv1 都产 3
        names.push(esc(d.name) + ' ≈' + seats + ' 座');
      }
      out.push({
        cls: 'bad',
        txt: '口粮还不够人口最快涨（目标：产出比口粮多 ' + tgt + '）：' + names.join('、') +
          (deficit.length > 2 ? ' 等 ' + deficit.length + ' 个省' : '') + ' 的农场/渔港。',
        how: '优先盖给"矿层还厚"的省（省卡里看储量）—— 同样的钱能多吃很多年。'
      });
    }

    /* ② 够了线：这是"不能往死里建"的正面回答 */
    if (!deficit.length && st1.fProd - st1.fNeed >= tgt) {
      var nxt = '';
      if (fc.capLast.grain || fc.capLast.fish) nxt = '下一个该盖的是粮仓（每座 +100 上限，至多 3 座）';
      else if (fc.mineOut.length) nxt = '下一个瓶颈是矿寿（见下面那条）';
      else nxt = '要再涨人口，等人口追上来再补';
      out.push({
        cls: 'ok',
        txt: '口粮够了：全国余 <b>' + f0(st1.fProd - st1.fNeed) + '</b>，够人口最快涨。' +
          (full.length ? '最富的是 ' + esc(full[0].name) + '（余 ' + f0(full[0].surplus) + '）。' : '') +
          ' —— 农场可以停手了，' + nxt + '。',
        how: '右栏农场/渔港行上的 ✓ 就是这个意思；盖多了只会变成满仓浪费。'
      });
    }

    /* ③ 满仓刹车：实测优先（上回合真浪费过），推演其次 */
    for (var key in fc.capLast) {
      if (!(fc.capLast[key] > 0)) continue;
      var def = AO.RESOURCE_BY_KEY[key];
      var nm = def ? def.cn : key;
      var isFood = key === 'grain' || key === 'fish';
      out.push({
        cls: 'warn',
        txt: nm + ' 上回合满仓浪费了 <b>' + f0(fc.capLast[key]) + '</b>（省库顶格 150，产出进不了库）' +
          ' —— 这一类别再往死里盖了。',
        how: isFood
          ? '盖粮仓（+100/座，至多 3 座）把上限抬起来，或者把别省的农场停几座。'
          : '这一类该出口换钱（省卡「出口」）或停建，产量已经装不下了。'
      });
    }
    /* 推演里的浪费（现在还没浪费、但 8 回合内会） */
    for (var wk in fc.waste) {
      if (fc.capLast[wk]) continue;
      if (!(fc.waste[wk] > 0)) continue;
      var def2 = AO.RESOURCE_BY_KEY[wk];
      out.push({
        cls: '',
        txt: (def2 ? def2.cn : wk) + ' 按当前配置推演 ' + fc.P + ' 回合会开始满仓浪费（共 ' +
          f0(fc.waste[wk]) + '）—— 快到上限了。',
        how: '不用急着动：等真的开始浪费（上面那种实测条目）再停建/出口也来得及。'
      });
    }

    /* ④ 矿寿：不可再生的铁/金（连着"缺铁缺金"的老病根） */
    if (fc.mineOut.length) {
      var mo = fc.mineOut[0];
      for (i = 1; i < fc.mineOut.length; i++) if (fc.mineOut[i].turn < mo.turn) mo = fc.mineOut[i];
      out.push({
        cls: 'warn',
        txt: '矿寿告急：<b>' + esc(mo.name) + '</b>的' + (mo.key === 'iron' ? '铁' : '金') +
          '矿第 <b>' + (V.turn() + mo.turn) + '</b> 回合采空（共 ' + fc.mineOut.length + ' 处在 ' +
          fc.P + ' 回合内枯竭）—— 这些省别再新建了。',
        how: '同样的钱：给存量座升 Lv2（产量翻倍、维护不翻倍）、或转熔旧坊/淘金场吃涓流。'
      });
    }

    /* ⑥ 在建推演：避免"重复下单" */
    if (fc.sites.length) {
      var minLeft = fc.sites[0].left;
      for (i = 1; i < fc.sites.length; i++) minLeft = Math.min(minLeft, fc.sites[i].left);
      out.push({
        cls: '',
        txt: '已有 <b>' + fc.sites.length + '</b> 处工地在跑（最早 ' + minLeft + ' 回合后完工）—— ' +
          '它们的产出还不在图上，别按现在的线重复下单。',
        how: '先等这几处完工、线拐上来，再决定下一批。'
      });
    }

    if (redLine) {
      out.push({
        cls: 'warn',
        txt: '维护吃掉岁入的 <b>' + Math.round(maintSum / inc * 100) + '%</b>：新开工地会先加维护再出产能。',
        how: '要盖也先盖"单位维护划算"的（升 Lv2 好过新建一座 Lv1）。'
      });
    }

    if (!out.length) {
      out.push({
        cls: 'ok',
        txt: '收支与口粮都稳，想扩就盖。优先把"矿层还厚"的省铺起来。',
        how: '判断矿层：省卡里看储量剩多少；这页的推演线一旦拐头，就是矿要空了。'
      });
    }
    return advCard('该盖（建造）', out);
  }

  /* =============================================================
   * 八、维修右栏行尾的 ✓/▲（干跑顺手算的，两边同一份）
   * ============================================================= */
  function computeMarks(fc) {
    var m = Object.create(null);
    var st1 = fc.steps[1];
    var foodOk = st1.fProd - st1.fNeed >= BAL.foodTarget;
    var ks = V.rep.kinds();
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      if ((fc.capLast[k] || 0) > 0 || (fc.waste[k] || 0) > 0) m[k] = 'over';
      else if (V.rep.food[k] && foodOk) m[k] = 'ok';
    }
    UI.marks = m;
  }

  /* =============================================================
   * 九、递内部件 / 存档
   * ============================================================= */
  AO.balAttach = function (api) {
    V = api;
    buildActions();
  };

  function copyHist() {
    var o = {}, k, i;
    for (k in H) {
      o[k] = [];
      for (i = 0; i < H[k].length; i++) {
        var s = H[k][i], d = {};
        for (var kk in s) d[kk] = s[kk];
        o[k].push(d);
      }
    }
    return o;
  }
  AO.balSave = function () { return { H: copyHist(), range: UI.range }; };
  AO.balLoad = function (d) {
    var k;
    for (k in H) delete H[k];
    if (!d) return;
    var src = d.H || {}, i;
    for (k in src) {
      H[k] = [];
      for (i = 0; i < (src[k] || []).length; i++) {
        var s = src[k][i], o = {};
        for (var kk in s) o[kk] = s[kk];
        H[k].push(o);
      }
    }
    if (d.range) UI.range = d.range | 0;
  };
  /* 换世界：整张表清掉（这是"这一局"的记录） */
  AO.balReset = function () { var k; for (k in H) delete H[k]; };

  /* 绑自己那两件：区间选择（12 / 24 / 48）+「去看看」跳省。
   * 开关面板、切页签、下一回合、ESC 全归 11-ui 的「经营」面板管。 */
  function buildActions() {
    var rg = document.getElementById('balRange');
    if (rg) rg.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-r]') : null;
      if (!btn) return;
      UI.range = +btn.getAttribute('data-r') || BAL.rangeDef;
      render();
    });
    var bb = document.getElementById('balBody');
    if (bb) bb.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-goto]') : null;
      if (!b) return;
      if (V && V.gotoProv) V.gotoProv(+b.getAttribute('data-goto'));
      if (AO.repUI && AO.repUI.close) AO.repUI.close();
    });
  }

  /* 对外：画（render）、"现在该不该画"（isOpen）、行尾状态标（mark）、
   * 上回合受控分项实测（actual，测试对账用）。isOpen 直接问全屏「经营」页
   * 开着没有 —— 状态只有一份。 */
  AO.balUI = {
    render: render,
    isOpen: function () { return !!(AO.repUI && AO.repUI.isOpen && AO.repUI.isOpen()); },
    mark: function (kind) {
      var m = UI.marks[kind];
      if (!m) return '';
      return m === 'over'
        ? '<span class="bm over" title="这一类已经满仓浪费：产出进不了省库，别再往死里盖">▲</span>'
        : '<span class="bm ok" title="口粮已够最快增长（余 ≥3）：这一类可以停手了">✓</span>';
    },
    actual: actualSums
  };
})(typeof window !== 'undefined' ? window : globalThis);
