/* =============================================================
 * 19-repair.js —— 维护与维修（"每一座建筑自己决定开不开"）
 *
 * 为什么会有这个文件：
 * 以前全国每一类建筑、每一面城墙，每回合都要"本省库存 → 中央国库"硬扣一笔
 * 铁 + 金。付不出就整类停产，而玩家**没有任何调节手段** —— 只能干等中央攒够。
 * 一局里只要铁/金被建造抽空，全国就集体躺平，经济再也翻不了身。
 *
 * 中间试过"高/中/低/停"四档，但它是**按类别一刀切**的：全国 14 座渔港要么
 * 全开、要么全停。"留 6 座、停 8 座"做不到 —— 而那恰恰是资源紧张时最需要
 * 的动作（口粮要保，但不能把铁金全吃光）。
 *
 * 现在只留一个轴：**每省每类"保留几座"**（KEEP[pid][kind] = n）。
 *   · n 省略 = 全开（默认；老档读进来就是这个状态）
 *   · 在跑的座缴维护、出产量；停掉的座什么都不花、也不产出，但**不失修**
 *     （不缴费就不欠费，随时能恢复 —— "停工"和"年久失修"是两件事）
 *   · 保留哪几座由建筑自己排：先保 Lv2（同样维护费，产量翻倍）
 *
 * 钱仍然走"本省库存 → 中央拨款"两段：省里没铁没金的国家靠中央接济。
 * 中央这回合能拨多少 = 上回合实付 × 2 + 保底（见"四、中央配给"）。
 * 拨完还不够的那几座就停产（halted），凑齐了自动复工。
 *
 * 维修（repair）—— 手动、一次性。失修的东西不再只能干等：
 * 点「修」立刻掏钱（本省 → 中央）把它修好，也可以"停修"让它烂着省钱。
 * 城墙另算：按缺的耐久付钱。
 * （维修队 —— 每回合自动修最便宜几处 —— 2026-10 删了：干跑预测上线之后，
 *  "哪儿该修"这张面板自己会说，自动修反而把账搅浑。）
 *
 * 放在 19 号位（11-ui 之后）：它要读 SIM / WALL / CENTRAL / FLOW，
 * 但**不能**反过来被 11-ui 的闭包依赖 —— 所以 11-ui 只留几个一行的钩子：
 *   payMaint             → AO.repPayMaint(...)   扣款（含停修判断）
 *   settleTurn ①         → AO.repStep(owner)     批中央拨款
 *   generate / 读档      → AO.repLoad(undefined) 清表
 *   存档                 → AO.repSave()
 *
 * 存档：本文件自带 AO.repSave / AO.repLoad，由 11-ui 的 saveGame 一并存，
 * **不升 SAVE_VER**（老档没有这一块 → 全按默认"全开"补齐；老档里的 PR
 * 四档表直接丢弃 —— 四档已经不存在了）。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* =============================================================
   * 一、数值（占位 —— 拍板只改这一块）
   * ============================================================= */
  var REP = {
    /* 维修价 = 这一处**一回合维护费** × 这个倍数，一次性付清。
     * 为什么是 3 倍而不是 1 倍：一次性付款必须比"每回合正常缴费"贵，
     * 否则最优解就是"永远停缴 + 一直手动修"，保留座数就成了废纸。
     * 也不能太贵（5 倍以上玩家宁可让房子烂着），那维修面板又成了废纸。 */
    repairMul: 3,

    /* 城墙按耐久算（不走上面的倍数）：
     *   每点缺的耐久 0.3 铁 + 0.3 金 → Lv3 从 0 修满 ≈ 30 铁 30 金；
     *   拆干净的价按城墙造价的 20%（拆墙本来就该便宜）。 */
    wallPerHp: { iron: 0.3, gold: 0.3 },
    wallRazeMul: 0.2,

    /* 中央拨款的保底（够十几座建筑一回合）：没有这笔保底，
     * 开局第一回合"上回合实付 = 0" → 拨款 = 0 → 全国集体失修，非常难看。 */
    lowReserve: 20,

    /* 分析面板（20-balance.js）用的历史长度：只留最近 160 个采样点
     * （够画三屏折线，存档也不会胖）。 */
    histMax: 160
  };
  AO.REP = REP;

  /* 建筑类型清单：7 种资源建筑 + 11 种通用设施（民用 + 军工）+ 城墙。
   * 顺序就是面板里的行序：先"吃口粮的"、再"出料的"、再花钱的、最后城墙。
   * 军工那六类以前**不在**这张表上（维护照付，只是面板不管）——
   * 既然现在能按城停座数，兵营/军械坊也该让玩家关，所以一并列进来。 */
  var KIND_ORDER = ['grain', 'fish', 'salt', 'timber', 'horse', 'iron', 'gold',
    'market', 'granary', 'builder', 'school', 'university',
    'barracks', 'armory', 'stable', 'shipyard', 'factory', 'wall'];
  var KIND_CN = {
    grain: '农场', fish: '渔港', salt: '盐场', timber: '伐木场', horse: '牧场',
    iron: '铁矿场', gold: '金矿场', market: '市场', granary: '粮仓',
    builder: '建造坊', school: '学校', university: '大学',
    barracks: '兵营', armory: '军械坊', stable: '驯马场',
    shipyard: '造船厂', factory: '工厂', wall: '城墙'
  };
  /* 断了就掉人口的（面板上标"口粮"角标：调保留座数的人有依据） */
  var KIND_FOOD = { grain: 1, fish: 1 };

  function kindCn(k) { return KIND_CN[k] || k; }

  /* =============================================================
   * 二、状态
   * ============================================================= */
  /* 保留座数：pid -> { kind: n }。**不存 = 全开**（默认，也是老档的状态）。
   * 为什么按 pid 而不是按 owner 存：这是"这一座城建几座"的事，
   * 省易主了也还是那块地、那批房子 —— 跟着城走比跟着国旗走合理。 */
  var KEEP = Object.create(null);
  var STOP = Object.create(null);  // 'pid|kind' -> { t }  手动"停修"名单
  /* 上一回合中央实付（铁+金合计）：owner -> n。
   * 本文件自己记，不依赖 FLOWC —— 它每回合清零，
   * 而结算开始时看到的还是"上上回合"的数。 */
  var SPENT = Object.create(null);
  /* 本回合的中央拨款（铁/金合计）。见"四、中央配给"。 */
  var RESERVE = 0;
  var V = null;                    // 11-ui 递进来的内部件（repAttach 时填）

  function kinds() { return KIND_ORDER; }

  /* ---------------- 保留座数 ---------------- */
  function keepOf(pid, kind) {
    var t = KEEP[pid | 0];
    if (!t) return null;
    var n = t[kind];
    return (n === undefined || n === null) ? null : (n | 0);
  }
  /* 这一类这一省"实际在跑几座"：没设过就是全开 */
  function effKeep(pid, kind, built) {
    var k = keepOf(pid, kind);
    if (k === null) return built | 0;
    return Math.max(0, Math.min(k, built | 0));
  }
  function setKeep(pid, kind, n) {
    pid = pid | 0;
    if (!pid) return false;
    var t = KEEP[pid] || (KEEP[pid] = Object.create(null));
    if (n === null || n === undefined) { delete t[kind]; }
    else { t[kind] = Math.max(0, n | 0); }
    /* 表清空了就把这一省整条删掉 —— 存档只写"真的改过"的东西 */
    var any = false, k;
    for (k in t) { any = true; break; }
    if (!any) delete KEEP[pid];
    return true;
  }
  function setKeepAll(pid, kind, on) {
    if (!V) return false;
    var lv = V.live(pid | 0, kind);
    if (!lv) return false;
    return setKeep(pid, kind, on ? null : 0);
  }
  /* 全国按比例设保留座数（AI 与面板的"一键"共用）：
   *   r >= 1 → 全部清成"全开"（不是设成 built，这样以后盖新房子自动算在内）
   *   r <= 0 → 全停
   *   其余   → 每省 round(built × r)，至少留 1 座（除非 r 就是 0） */
  function setKeepRatio(owner, kind, r) {
    if (!V) return 0;
    var w = V.world();
    if (!w) return 0;
    var c = w.countries[(owner | 0) - 1];
    if (!c) return 0;
    var n = 0;
    for (var i = 0; i < c.provinces.length; i++) {
      var pid = c.provinces[i];
      var lv = V.live(pid, kind);
      if (!lv || !(lv.built > 0)) continue;
      if (r >= 1) { setKeep(pid, kind, null); n++; continue; }
      var k = r <= 0 ? 0 : Math.max(1, Math.round(lv.built * r));
      if (k >= lv.built) setKeep(pid, kind, null);
      else setKeep(pid, kind, k);
      n++;
    }
    return n;
  }
  /* 全国这一类"在跑 / 已建"的合计（面板表头与 AI 判断共用） */
  function keepStat(owner, kind) {
    var out = { built: 0, keep: 0 };
    if (!V) return out;
    var w = V.world();
    if (!w) return out;
    var c = w.countries[(owner | 0) - 1];
    if (!c) return out;
    for (var i = 0; i < c.provinces.length; i++) {
      var pid = c.provinces[i];
      var lv = V.live(pid, kind);
      if (!lv || !(lv.built > 0)) continue;
      out.built += lv.built;
      out.keep += effKeep(pid, kind, lv.built);
    }
    return out;
  }
  function keepRatio(owner, kind) {
    var s = keepStat(owner, kind);
    return s.built > 0 ? s.keep / s.built : 1;
  }

  /* ---------------- 停修 ---------------- */
  function stopKey(pid, kind) { return (pid | 0) + '|' + kind; }
  function isStopped(pid, kind) { return !!STOP[stopKey(pid, kind)]; }
  function setStopped(pid, kind, on) {
    var k = stopKey(pid, kind);
    if (on) STOP[k] = { t: V ? V.turn() : 0 };
    else delete STOP[k];
    return !!on;
  }
  /* 把已消失的省（换世界 / 读档 / 省被吞并）从保留表与停修名单里剔掉。
   * 不做这一步，换世界后旧 pid 的设置会挂到新世界的同号省上。 */
  function prune() {
    if (!V) return 0;
    var n = 0, k;
    for (k in STOP) {
      var pid = +(k.split('|')[0]);
      if (!V.prov(pid) || !V.sim[pid]) { delete STOP[k]; n++; }
    }
    for (k in KEEP) {
      var q = k | 0;
      if (!V.prov(q) || !V.sim[q]) { delete KEEP[k]; n++; }
    }
    return n;
  }

  /* =============================================================
   * 三、缴费（11-ui 的 payMaint 只转发到这里）
   * ============================================================= */

  /* 返回 true = 这一处这回合付清了；false = 有缺口（调用方标 halted）。
   * 规则只有一条：**停修 + 已经失修 → 跳过**（修好/恢复后自动继续）。
   * 「保留 0 座」不需要在这里判 —— 那时候 maintDue 本来就是 0，
   * 走一遍也是空账，没必要多一个分支。
   * 剩下的交给 V.pay 里的"本省 → 中央拨款"两段取款。 */
  AO.repPayMaint = function (acc, demand, owner, pid, kind) {
    if (!V) return true;
    owner = owner | 0; pid = pid | 0;
    kind = kind || 'x';
    if (isStopped(pid, kind)) {
      var live = V.live(pid, kind);
      /* 停修只停"已经烂着的"：没失修的建筑照常缴费 ——
       * 否则"停修"就成了"免费养着"，比缴费还划算。 */
      if (!live || live.halted) return true;
    }
    return V.pay(pid, owner, demand, acc, kind);
  };

  /* =============================================================
   * 四、中央配给
   *
   * 一次结算要跑完 1100 个省才回到"国家"这一层，没法在中间回头补扣。
   * 所以结算开始时**先给全国批一笔中央拨款**，省里扣钱只走"本省库存 + 这笔拨款"：
   * 省库有铁有金就自己出，不够的部分由中央补 —— 补不到就停产。
   *
   * 为什么用"一笔拨款"而不是给每一座精确配额：1100 省 × 19 类要跑一遍才
   * 知道总需求，精确分配就得把结算做两遍。拨款是**保守估**：
   * 估少了少数建筑少拿一点（好过整类饿死），估多了只是"这回合中央花得多"。
   * ============================================================= */
  AO.repTurnStart = function (owner) {
    owner = owner | 0;
    RESERVE = 0;
    if (!V) return;
    var cen = V.central(owner) || {};
    var pool = (cen.iron || 0) + (cen.gold || 0);
    if (pool <= 0) return;
    /* 拨款 = 上回合实付 × 2 + 保底。
     * 乘 2 而不是 1：上回合若有人因为"拨款刚好花完"停产，这回合得有富余。
     * 也不乘太多 —— 拨款太大等于"中央无脑兜底"，省库就没人管了。 */
    var want = (SPENT[owner] || 0) * 2 + REP.lowReserve;
    RESERVE = Math.min(pool, want);
  };
  /* V.pay 每次从中央取钱后回填"实际花了多少"，下一回合按它估拨款 */
  function noteSpent(owner, n) {
    if (!(n > 0)) return;
    SPENT[owner | 0] = (SPENT[owner | 0] || 0) + n;
  }
  function canPool() { return RESERVE > 0; }
  /* 从拨款里划走 n（返回实际划走的量 —— 只够半笔就划半笔） */
  function takePool(n) {
    if (!(n > 0)) return 0;
    var t = Math.min(RESERVE, n);
    RESERVE -= t;
    return t;
  }

  /* =============================================================
   * 五、维修（手动一次性）
   * ============================================================= */

  /* 维护需求 → 一段人话（面板 / title 共用） */
  function moneyText(c) {
    if (!c) return '免费';
    var a = [];
    if (c.iron) a.push(Math.round(c.iron * 10) / 10 + ' 铁');
    if (c.gold) a.push(Math.round(c.gold * 10) / 10 + ' 金');
    return a.length ? a.join(' + ') : '免费';
  }

  /* 这一处的维修价：满额维护 × 倍数（城墙另算）。
   * 用"满额"而不是"欠账"：欠账是随回合滚的零头，拿它算价会出现
   * "同一座建筑今天 2 铁明天 3 铁"这种事，玩家没法预估。 */
  function repairCost(pid, kind, mul) {
    if (!V) return null;
    if (kind === 'wall') return wallCost(pid);
    var it = V.live(pid, kind);
    if (!it || it.off) return null;   // 玩家主动停的：没有"维修价"这回事
    var d = it.due || {};
    var w = mul === undefined ? REP.repairMul : mul;
    var out = { iron: Math.ceil((d.iron || 0) * w), gold: Math.ceil((d.gold || 0) * w) };
    if (!out.iron && !out.gold) { out.iron = 1; out.gold = 1; }   // 维护是 0 也得有个价
    return out;
  }
  /* 城墙：缺多少耐久修多少 */
  function wallCost(pid) {
    var w = V.wall(pid);
    if (!w || !(w.lv > 0)) return null;
    var lack = Math.max(0, AO.WALL.maxHp(w.lv) - (w.hp || 0));
    if (!lack && !w.halted) return null;
    var u = REP.wallPerHp;
    return {
      iron: Math.ceil(lack * u.iron) || (w.halted ? 1 : 0),
      gold: Math.ceil(lack * u.gold) || (w.halted ? 1 : 0)
    };
  }
  /* 修好一处。付不起就**一分不扣**：部分付款会生出"付了钱却没修好"的中间态，
   * 到处漏账，不如干脆不开始。 */
  function repairOne(pid, owner, kind) {
    if (!V) return { ok: false, why: '还没开局' };
    if (kind === 'wall') return repairWall(pid, owner);
    var it = V.live(pid, kind);
    if (!it) return { ok: false, why: '这里没有' + kindCn(kind) };
    if (it.off) return { ok: false, why: kindCn(kind) + ' 已停（保留 0 座），先调回保留座数再修' };
    if (!it.built && !it.n) return { ok: false, why: '这里还没有' + kindCn(kind) };
    if (it.site > 0) return { ok: false, why: '还有工地，等完工' };
    var cost = repairCost(pid, kind);
    var got = V.draw(pid, owner, cost);
    if (!got.ok) return { ok: false, why: '铁/金不够（缺 ' + moneyText(got.lack) + '）' };
    it.repair();
    setStopped(pid, kind, false);       // 修好了就不再"停着"
    return { ok: true, cost: cost, spent: got.spent };
  }
  function repairWall(pid, owner) {
    var w = V.wall(pid);
    if (!w || !(w.lv > 0)) return { ok: false, why: '这里没有城墙' };
    var cost = wallCost(pid);
    if (!cost) return { ok: false, why: '城墙完好，不用修' };
    var got = V.draw(pid, owner, cost);
    if (!got.ok) return { ok: false, why: '铁/金不够（缺 ' + moneyText(got.lack) + '）' };
    w.hp = AO.WALL.maxHp(w.lv);
    w.halted = false;
    if (w.mAcc) { w.mAcc.iron = 0; w.mAcc.gold = 0; }
    setStopped(pid, 'wall', false);
    return { ok: true, cost: cost, spent: got.spent };
  }
  /* 拆掉残墙：这一格的城墙记录整个抹掉（Lv0 = 没墙） */
  function razeWall(pid, owner) {
    var w = V.wall(pid);
    if (!w || !(w.lv > 0)) return { ok: false, why: '这里没有城墙' };
    var c = AO.WALL.costAt(w.lv);
    var cost = {
      iron: Math.ceil(c.iron * REP.wallRazeMul),
      gold: Math.ceil(c.gold * REP.wallRazeMul)
    };
    var got = V.draw(pid, owner, cost);
    if (!got.ok) return { ok: false, why: '铁/金不够（缺 ' + moneyText(got.lack) + '）' };
    V.razeWall(pid);
    setStopped(pid, 'wall', false);
    return { ok: true, cost: cost, spent: got.spent };
  }

  /* 回合结算 ① 的位次：批一笔中央拨款（19-repair 自己的核心动作）。
   * 维修队（曾经在这里顺带出手）2026-10 删除 —— 干跑预测会把"哪儿失修、
   * 修不修划算"说清楚，自动修反而让玩家对不上账。 */
  AO.repStep = function (owner) {
    if (!V) return;
    AO.repTurnStart(owner);
  };

  /* =============================================================
   * 六、递内部件 / 存档
   * ============================================================= */
  /* 11-ui 在初始化末尾调一次。api 里有：
   *   world()  prov(pid)  sim  central(owner)  wall(pid)  turn()
   *   live(pid,kind) -> { halted, built, n, active, site, due, repair() }
   *   pay(pid,owner,demand,acc,kind) -> bool 整
   *   draw(pid,owner,cost) -> { ok, spent, lack }   （本省 → 中央，一次性）
   *   razeWall(pid)  note(owner,text,cls) */
  AO.repAttach = function (api) {
    V = api;
    /* 11-ui 的 payMaint 通过 AO.rep 取"能不能动用中央"与"划走多少" */
    AO.rep.canPool = canPool;
    AO.rep.takePool = takePool;
    AO.rep.noteSpent = noteSpent;
    prune();
  };

  /* 拷一份普通对象：存档交出去的必须是**快照**，不能是局内的活对象。
   * 否则调用方拿到 payload 之后继续玩（改保留座数、点维修），刚才"存下来"
   * 的那一份会被一起改写 —— 读档/对比存档时就对不上了。 */
  function copy(o) { var r = {}, k; for (k in o) r[k] = o[k]; return r; }
  function deep2(o) {
    var r = {}, k, kk;
    for (k in o) { r[k] = {}; for (kk in o[k]) r[k][kk] = o[k][kk]; }
    return r;
  }

  AO.repSave = function () {
    return { KEEP: deep2(KEEP), STOP: copy(STOP), SPENT: copy(SPENT) };
  };
  AO.repLoad = function (d) {
    var k;
    for (k in KEEP) delete KEEP[k];
    for (k in STOP) delete STOP[k];
    for (k in SPENT) delete SPENT[k];
    if (!d) return;
    /* 同样只"抄值"不"接管引用"：读进来的 payload 可能是调用方手里那一份，
     * 直接挂上去的话，局内改状态会顺着引用改掉调用方的对象。
     * 老档里的 d.PR（四档表）、d.CREW（维修队，2026-10 已删）都不认识就不读。 */
    var src, inner, kk;
    for (k in (src = d.KEEP || {})) {
      inner = KEEP[k] = Object.create(null);
      for (kk in src[k] || {}) inner[kk] = src[k][kk] | 0;
    }
    for (k in (src = d.STOP || {})) STOP[k] = copy(src[k]);
    for (k in (src = d.SPENT || {})) SPENT[k] = src[k];
    prune();
  };

  /* =============================================================
   * 七、只读导出（面板 / 测试 / AI 用）
   * ============================================================= */
  AO.rep = {
    kinds: kinds, kindCn: kindCn, food: KIND_FOOD,
    /* 保留座数 */
    keep: keepOf, setKeep: setKeep, keepAll: setKeepAll, effKeep: effKeep,
    keepStat: keepStat, keepRatio: keepRatio, setKeepRatio: setKeepRatio,
    /* 停修 */
    stopped: isStopped, setStopped: setStopped,
    /* 钱与修 */
    cost: repairCost, costText: moneyText, wallCost: wallCost,
    repair: repairOne, raze: razeWall, prune: prune,
    table: KEEP, keepMap: KEEP, stopMap: STOP, spent: SPENT,
    reserve: function () { return RESERVE; },
    canPool: null, takePool: null, noteSpent: null,
    turnStart: AO.repTurnStart, step: AO.repStep
  };
})(typeof window !== 'undefined' ? window : globalThis);
