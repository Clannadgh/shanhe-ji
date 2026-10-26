/* =============================================================
 * 16-events.js —— 事件系统 + 信仰做实（回合之间发生的"事"）
 *
 * 这一层放**数据 + 规则 + 状态**，DOM 全在 11-ui.js（弹窗 / 省卡 / 治理面板）。
 * 为什么这么切：事件状态要跟存档、NOTES、面板一起走，而它们全在 11-ui 的
 * 闭包里。所以 11-ui 在初始化时调一次 AO.evtInit({...}) 把内部件递进来，
 * 之后所有逻辑都跑在这个文件里 —— 11-ui 那边只剩十来个一行的钩子。
 *
 * 三条纪律（和资源层同一套）：
 *   1) 事件**只读**世界（when 里不许改状态），改状态只能走 fx 白名单；
 *   2) 数值与文本全在这一个文件里，改事件不用翻 UI；
 *   3) fx 的文案由 AO.evtFxText() 从 fx **自动生成** —— 弹窗上的 tip
 *      和真正生效的数字永远是同一个来源，不会出现"写 −20 扣 −18"。
 *
 * 关于 ctx：when(ctx) 拿到的是一份**快照式只读视图**（见 buildCtx），
 * 改状态只有 ctx.fx.* 一条路。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* =============================================================
   * 一、数值（占位）
   * ============================================================= */
  var EVT = {
    /* 开局前 N 回合不出事件 —— 第一回合就闹瘟疫，玩家还没看懂界面 */
    startTurn: 5,
    /* 每回合掷一次"出不出事"的概率；出了也只抽**一件** */
    chance: 0.62,
    /* 事件自己没写 cd 时的冷却回合 */
    cdDefault: 8,
    /* 同一个事件最多试几个目标省就放弃（省得 1100 个省扫一遍） */
    tries: 10,
    /* 纪要最多留多少条（和战报同一个池子，见 WARLOG 的 LOG_MAX） */
    logMax: 80
  };
  AO.EVT = EVT;

  /* 信仰（B 部分）的全部数值。policy 两档的差别只有三处：
   *   异信仰幸福度扣多少 / 能不能传教 / 传教工期倍率（宽容档本来就禁用，留字段备用） */
  var FAITH = {
    hitForce: -6,            // 强制：异信仰省幸福度 −6
    hitTolerant: -2,         // 宽容：异信仰省幸福度 −2
    missionCost: 20,         // 传教花费（省库金）
    missionTurns: 3,         // 传教工期（回合）
    missionTurnMul: 1,       // 强制档工期倍率（占位：以后可以做成"宽容更快"）
    polCn: { force: '强制', tolerant: '宽容' },
    polDesc: {
      force: '强制：异信仰省幸福度 −6，可派传教',
      tolerant: '宽容：异信仰省幸福度 −2，不能传教'
    }
  };
  AO.FAITH = FAITH;

  /* 资源中文名（tips 用全称，不用省卡上的单字简称） */
  var RES_CN = {
    iron: '铁', gold: '金', grain: '粮食', horse: '战马',
    timber: '木材', fish: '渔获', salt: '盐'
  };
  function resCn(k) { return RES_CN[k] || k; }

  /* =============================================================
   * 二、事件池（v1：十条）
   *
   *   key / cn      id 与标题
   *   cat           类目（弹窗右上角那个 § 的悬停文字）
   *   w             权重（同一回合里谁更可能被抽到）
   *   cd            冷却回合（这个事件下次最早能在第几回合再出现）
   *   once          一次性事件（出过就永不再出）
   *   spot          'prov' 落在某个省 / 'country' 落在某个国 / 'player' 只落在玩家国
   *   when(ctx)     能不能出。**只读**，不许改状态
   *   text          正文（≤80 字）。占位：{prov} 省名 {country} 国名
   *                 {name} 当事人（有官员用官员名，否则用国名）
   *   options[]     2~3 个选项。w = AI 抽这个选项的权重（默认 1）
   *                 tip 可省略 —— 省略时由 fx 自动生成（推荐，永不跑偏）
   *   onPick(ctx,i) 复杂事件才用：fx 表达不了的动作
   *
   * 文案纪律（DESIGN.md）：80 字内、纸面语汇、只写"事"不写"小说"。
   * ============================================================= */
  var EVENTS = [
    /* ---------------- 天灾 ---------------- */
    {
      key: 'plague', cn: '瘟疫', cat: '天灾', w: 12, cd: 10, once: false, spot: 'prov',
      when: function (ctx) { return ctx.pop > 120000; },
      text: '疫气自{prov}的洼地起，三日之内阖门不起者数十。医者说：或封里巷，或听其自去。',
      options: [
        { cn: '封锁里巷', w: 2, fx: { stock: { gold: -20 }, happy: -4 } },
        { cn: '听天由命', w: 1, fx: { popPct: -0.05 } }
      ]
    },
    {
      key: 'drought', cn: '大旱', cat: '天灾', w: 11, cd: 9, once: false, spot: 'prov',
      when: function (ctx) { return ctx.pop > 30000 && ctx.has('grain'); },
      text: '{prov}两月无雨，禾苗卷叶，井水见底。老农说：再不下雨，这一造就算完了。',
      /* v14：旱情直接喂价格 —— 减产是慢的（库存要吃完才见底），
       * 但"粮要涨"这件事市场当天就知道。所以这里除了 buff，还给一条
       * jump=1 的物价冲击（当回合就走一半），见 PRICES_CFG.shockLerp。 */
      options: [
        { cn: '凿井引水', w: 2, fx: { stock: { gold: -18 }, buff: { key: 'grain', mul: 0.75, turns: 1 },
          price: { grain: { target: 1.8, turns: 2, jump: 1 } } } },
        { cn: '听天由命', w: 1, fx: { happy: -3, buff: { key: 'grain', mul: 0.5, turns: 1 },
          price: { grain: { target: 2.1, turns: 2, jump: 1 } } } }
      ]
    },
    {
      key: 'bumper', cn: '丰年', cat: '天灾', w: 14, cd: 6, once: false, spot: 'prov',
      when: function (ctx) { return ctx.has('grain') && ctx.pop > 20000; },
      text: '{prov}今岁风调雨顺，仓廪盈溢。是尽数入官仓，还是分与乡里？',
      options: [
        { cn: '尽数入仓', w: 2, fx: { stock: { grain: 30 }, price: { grain: { target: 0.7, turns: 2 } } } },
        { cn: '分与乡里', w: 1, fx: { stock: { grain: 12 }, happy: 5, price: { grain: { target: 0.8, turns: 2 } } } }
      ]
    },
    {
      key: 'fishrun', cn: '渔汛', cat: '天灾', w: 8, cd: 8, once: false, spot: 'prov',
      when: function (ctx) { return ctx.has('fish'); },
      text: '{prov}海面忽起银鳞，渔户说这是十年一遇的大汛。船少网疏，怕赶不上这一潮。',
      options: [
        { cn: '全力捕捞', w: 2, fx: { buff: { key: 'fish', mul: 2, turns: 3 },
          price: { fish: { target: 0.75, turns: 2 } } } },
        { cn: '修船备汛', w: 1, fx: { stock: { gold: -10 }, buff: { key: 'fish', mul: 1.5, turns: 3 } } }
      ]
    },
    {
      key: 'lode', cn: '矿脉新发现', cat: '天灾', w: 8, cd: 8, once: false, spot: 'prov',
      when: function (ctx) { return !!ctx.ore; },
      text: '矿工在{prov}凿出旧脉之外的支脉，色如沉铁。可募工深采，也可收归官营。',
      options: [
        /* '*' = 本省最富的那个矿（ctx.ore 现算，铁或金） */
        { cn: '募工深采', w: 2, fx: { left: { '*': 0.5 } } },
        { cn: '收归官营', w: 1, fx: { central: { gold: 18 } } }
      ]
    },

    /* ---------------- 人祸 ---------------- */
    {
      key: 'bandits', cn: '匪患', cat: '人祸', w: 11, cd: 7, once: false, spot: 'prov',
      /* v13（A3）：改成**看不安值** —— 原来判"边境 + 人口"，结果是
       * "边境大省三天两头闹匪、内陆快饿死的省一次不闹"，因果反了。
       * 现在不安 ≥ 40 才出，于是它和 UNREST 互喂：
       * 不安养匪患（+10 不安），匪患的处置又改不安。 */
      when: function (ctx) { return ctx.unrest >= 40; },
      text: '{prov}界上聚了一股马贼，专劫运粮的车队。县令请兵，兵在三百里外。',
      options: [
        { cn: '发兵剿匪', w: 2, fx: { stock: { gold: -15 }, happy: 2, unrest: -15 } },
        { cn: '置之不理', w: 1, fx: { stockPct: { grain: -0.2 }, bandit: true } },
        /* 招安：花钱把匪首收编成守军 —— "金能买人心"最直白的那一档。
         * 三个效果一起给：不安 −25、匪患标记清掉、城里多一支驻防军（走现有征兵结构）。 */
        { cn: '招安', w: 1, fx: { stock: { gold: -20 }, unrest: -25, garrison: 1 } }
      ]
    },
    {
      key: 'graft', cn: '贪墨案发', cat: '人祸', w: 9, cd: 10, once: false, spot: 'prov',
      /* 只在"这一省真有一位贪墨官在任"时出 —— 否则案发从何说起 */
      when: function (ctx) {
        return !!(ctx.official && ctx.official.traitKey === 'greedy');
      },
      text: '{prov}的{name}被人告到御史台，账册上短了三成。是撤办查抄，还是压下去？',
      options: [
        { cn: '撤办查抄', w: 2, fx: { happy: 4, killOfficial: true } },
        { cn: '压下去', w: 1, fx: { central: { gold: 12 }, happy: -10 } }
      ]
    },
    {
      key: 'mutiny', cn: '将领叛乱', cat: '人祸', w: 5, cd: 14, once: false, spot: 'country',
      when: function (ctx) {
        return ctx.happy < 40 && ctx.armies >= 2 && ctx.generals >= 1;
      },
      text: '军中传言{name}私藏甲仗，与旧部夜饮。{country}的粮饷已欠了两月，人心浮动。',
      options: [
        { cn: '厚赏安抚', w: 2, fx: { central: { gold: -25 }, happy: 2 } },
        { cn: '召还处斩', w: 2, fx: { happy: -8, removeGeneral: true } },
        { cn: '置之不理', w: 1, fx: { mutiny: true } }
      ]
    },

    /* ---------------- 政事 / 商事 ---------------- */
    {
      key: 'heir', cn: '继承危机', cat: '政事', w: 7, cd: 12, once: true, spot: 'country',
      when: function (ctx) { return !!ctx.country && ctx.country.provinces.length >= 3; },
      text: '{country}的大位空悬。长子孱弱，次子有军功，宗室各拥一人。朝议三日夜不决。',
      options: [
        { cn: '立嫡', w: 2, fx: { central: { gold: -30 }, happy: 2 } },
        { cn: '立贤', w: 2, fx: { happy: -6, researchPts: 10 } },
        { cn: '血洗宗室', w: 1, fx: { happy: -12, central: { gold: 24 } } }
      ]
    },
    {
      key: 'trade', cn: '商路畅通', cat: '商事', w: 9, cd: 8, once: false, spot: 'country',
      when: function (ctx) { return ctx.market && !ctx.war; },
      text: '西来的驼队与东去的盐船在{country}接上了头，市面上的价一天一个样。',
      options: [
        { cn: '设关抽税', w: 2, fx: { central: { gold: 25 } } },
        { cn: '让利商旅', w: 1, fx: { central: { gold: 10 }, happy: 3 } }
      ]
    },
    /* v14：商队到访 —— 给玩家一个"盯价格板"的理由。
     * 收购价固定在物价 ×1.3，所以**本土物价越高，这一笔越值钱**：
     * 粮价 1.8 的时候卖 10 单位粮是 4.7 金，粮价 0.7 的时候只有 1.8 金。
     * 于是"什么时候卖"这件事第一次有了答案。 */
    {
      key: 'caravan', cn: '商队到访', cat: '商事', w: 6, cd: 12, once: false, spot: 'prov',
      when: function (ctx) { return !!ctx.market; },
      text: '一支远道而来的商队在{prov}城外卸货，领队的说：本地土产，有多少收多少，价比市面高三成。',
      options: [
        { cn: '卖与他', w: 2, fx: { caravan: 1.3 } },
        { cn: '不卖，留着自用', w: 1, fx: { happy: 2 } }
      ]
    }
  ];
  AO.EVENTS = EVENTS;

  var BY_KEY = Object.create(null);
  for (var ei = 0; ei < EVENTS.length; ei++) BY_KEY[EVENTS[ei].key] = EVENTS[ei];
  AO.EVT_BY_KEY = BY_KEY;

  /* =============================================================
   * 三、fx 白名单执行器
   *
   *   happy:n            民心（省事件=本省，国事件=全国各省）
   *   popPct:p           人口 ×(1+p)
   *   popAbs:n           人口 +n
   *   stock:{k:±n}       省库存（gold = 省库金）
   *   stockPct:{k:p}     省库存 ×(1+p)
   *   central:{k:±n}     中央国库
   *   left:{k:mul}       矿脉储量 ×(1+mul)（'*' = 本省最富的矿）
   *   buff:{key,mul,turns}  产量临时乘数（渔汛 / 大旱）
   *   talentPts:n        人才点
   *   researchPts:n      科研点
   *   killOfficial:true  撤掉本省在任官员（不回候选池）
   *   removeGeneral:true 该将去职（失一将）
   *   mutiny:true        该将带军自立为叛军，攻向旧主
   *   unrest:n          不安值（省事件=本省，v13 新增）
   *   bandit:true       挂匪患标记（下一回合产物归零 + 不安 +10）
   *   garrison:n        本省 +n 支驻防军（走现有征兵结构，v13 新增）
   * ============================================================= */
  function eachKey(obj, fn) {
    if (!obj) return;
    for (var k in obj) if (obj.hasOwnProperty(k)) fn(k, obj[k]);
  }

  AO.evtApply = function (ctx, fx) {
    if (!ctx || !fx || !ctx.fx) return;
    var f = ctx.fx;
    if (fx.happy) f.happy(fx.happy);
    if (fx.popPct) f.popPct(fx.popPct);
    if (fx.popAbs) f.popAbs(fx.popAbs);
    eachKey(fx.stock, function (k, n) { f.stock(k, n); });
    eachKey(fx.stockPct, function (k, p) { f.stockPct(k, p); });
    eachKey(fx.central, function (k, n) { f.central(k, n); });
    eachKey(fx.left, function (k, mul) { f.left(k, mul); });
    if (fx.buff) f.buff(fx.buff.key, fx.buff.mul, fx.buff.turns);
    if (fx.talentPts) f.talent(fx.talentPts);
    if (fx.researchPts) f.research(fx.researchPts);
    if (fx.killOfficial) f.killOfficial();
    if (fx.removeGeneral) f.removeGeneral();
    if (fx.mutiny) f.mutiny();
    /* v13（A3）：不安 / 匪患 / 招安驻军 —— 和 UNREST 互喂的那三笔 */
    if (fx.unrest) f.unrest(fx.unrest);
    if (fx.bandit) f.bandit();
    if (fx.garrison) f.garrison(fx.garrison);
    /* v14：物价冲击 / 商队收购 —— 让既有事件自动喂价格 */
    if (fx.price) eachKey(fx.price, function (k, o) {
      if (o && typeof o === 'object') f.price(k, o.target, o.turns, o.jump);
      else f.price(k, o, 2, 0);          // 简写：price:{grain:1.8} = 目标 1.8、2 回合
    });
    if (fx.caravan) f.caravan(fx.caravan === true ? 1.3 : fx.caravan);
  };

  /* ---------------- fx → 一行文案 ----------------
   * 弹窗上的 tip 与"真正扣了多少"必须同源，所以这里从 fx 反推文案。
   * 负号用 U+2212「−」不用 ASCII「-」：省卡 / 战报 / 面板里全是这个，
   * 一处写 ASCII 会在同一张纸上出现两种横线。 */
  function signed(n) {
    if (n > 0) return '+' + n;
    if (n < 0) return '−' + Math.abs(n);
    return '0';
  }
  function pctText(p) {
    var v = Math.round(p * 1000) / 10;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%';
  }

  AO.evtFxText = function (fx, scope) {
    var out = [], country = scope === 'country';
    if (!fx) return '';
    if (fx.happy) out.push((country ? '全国民心 ' : '民心 ') + signed(fx.happy));
    if (fx.popPct) out.push('人口 ' + pctText(fx.popPct));
    if (fx.popAbs) out.push('人口 ' + signed(fx.popAbs));
    eachKey(fx.stock, function (k, n) {
      out.push((k === 'gold' ? '省库金 ' : resCn(k) + ' ') + signed(n));
    });
    eachKey(fx.stockPct, function (k, p) {
      out.push('本省' + resCn(k) + ' ' + pctText(p));
    });
    eachKey(fx.central, function (k, n) {
      out.push((k === 'gold' ? '国库金 ' : '国库' + resCn(k) + ' ') + signed(n));
    });
    eachKey(fx.left, function (k, mul) {
      out.push((k === '*' ? '矿脉储量' : resCn(k) + '储量') + ' ' + pctText(mul));
    });
    if (fx.buff) {
      out.push(resCn(fx.buff.key) + '产出 ×' + fx.buff.mul + '（' + fx.buff.turns + ' 回合）');
    }
    if (fx.talentPts) out.push('人才 ' + signed(fx.talentPts));
    if (fx.researchPts) out.push('科研 ' + signed(fx.researchPts) + ' 点');
    if (fx.killOfficial) out.push('失一官');
    if (fx.removeGeneral) out.push('失一将');
    if (fx.mutiny) out.push('该将带军自立');
    if (fx.unrest) out.push('不安 ' + signed(fx.unrest));
    if (fx.bandit) out.push('匪患未平（下一回合断产、不安 +10）');
    if (fx.garrison) out.push('本省 +' + fx.garrison + ' 支驻防军');
    /* v14：物价冲击 / 商队 */
    eachKey(fx.price, function (k, o) {
      var t = (o && typeof o === 'object') ? o.target : o;
      var tn = (o && typeof o === 'object') ? (o.turns || 2) : 2;
      out.push(resCn(k) + '价 → ' + (Math.round(t * 100) / 100) + '（' + tn + ' 回合）');
    });
    if (fx.caravan) out.push('商队按 ×' + (fx.caravan === true ? 1.3 : fx.caravan) +
      ' 价收 10 单位土产换金');
    return out.join('，');
  };

  /* 选项的副行文案：有 tip 用 tip，没有就从 fx 生成 */
  AO.evtOptTip = function (ev, opt) {
    if (opt.tip) return opt.tip;
    return AO.evtFxText(opt.fx, ev.spot === 'prov' ? 'prov' : 'country') || '照办';
  };

  /* 正文占位替换（{prov} {country} {name}）—— 引擎只给值，不给模板 */
  AO.evtText = function (ev, v) {
    var t = ev.text || '';
    v = v || {};
    return t.replace(/\{prov\}/g, v.prov || '此地')
      .replace(/\{country\}/g, v.country || '朝廷')
      .replace(/\{name\}/g, v.name || v.country || '朝廷');
  };

  /* =============================================================
   * 四、状态
   *
   *   ECD[key]      这个事件下次最早能在第几回合再出现
   *   EDONE[key]    once 事件已经出过
   *   EPEND         挂起未选的事件（玩家的事件弹窗开着时）
   *   EBUFF[pid]    产量临时乘数 [{key, mul, turns}]（渔汛 / 大旱）
   *   MISSION[pid]  传教中 {left, to, owner}
   *   FAITHPOL[own] 'force' / 'tolerant'
   *   STATEFAITH[o] 国教 = 该国省份信仰里**面积占比最大**的那个下标
   *
   * 全部是"按 id 挂的普通对象"，JSON 原样进出（EPEND 只存 key/pid/cid，
   * ctx 里全是闭包，不能存）。
   * ============================================================= */
  var ECD = Object.create(null);
  var EDONE = Object.create(null);
  var EPEND = null;
  var EBUFF = Object.create(null);
  var MISSION = Object.create(null);
  var FAITHPOL = Object.create(null);
  var STATEFAITH = Object.create(null);
  var EVLOG = [];                     // 事件史（和战报同一个显示位，见 11-ui 的 WARLOG）

  AO.resEvtCd = ECD;
  AO.resEvtDone = EDONE;
  AO.resEvtBuff = EBUFF;
  AO.resMission = MISSION;
  AO.resFaithPol = FAITHPOL;
  AO.resStateFaith = STATEFAITH;
  AO.resEvtLog = function () { return EVLOG; };
  AO.evtPending = function () { return EPEND; };

  /* ---------------- 依赖注入 ----------------
   * 11-ui 在 init 里调一次。传进来的都是**活对象**（SIM / POP / …），
   * 之后只改内容、不换引用，所以这里留一份引用就够。 */
  var D = null;
  AO.evtInit = function (deps) {
    D = deps;
    recomputeAllStateFaith();
  };

  function W() { return D ? D.world() : null; }
  function getTurn() { return D ? D.getTurn() : 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(o, k) { return (o && typeof o[k] === 'number' && isFinite(o[k])) ? o[k] : 0; }
  function pOf(pid) { return D ? D.prov(pid) : null; }
  function coOf(cid) { return D ? D.country(cid) : null; }

  function countryList() { var w = W(); return (w && w.countries) || []; }
  function provList() { var w = W(); return (w && w.provinces) || []; }

  /* ---------------- 只读查询（ctx 用） ---------------- */
  function countArmies(owner) {
    var n = 0, A = D.army;
    for (var id in A) if (A[id] && A[id].owner === owner && !A[id].rebel) n++;
    return n;
  }
  function countGenerals(owner) {
    var n = 0, G = D.generals;
    for (var id in G) if (G[id] && G[id].owner === owner && G[id].armyId) n++;
    return n;
  }
  function inWar(owner) {
    var S = D.warset;
    for (var k in S) {
      if (!S[k]) continue;
      var parts = k.split('|');
      if ((+parts[0]) === owner || (+parts[1]) === owner) return true;
    }
    return false;
  }
  function hasMarket(owner) {
    var c = coOf(owner);
    if (!c) return false;
    for (var i = 0; i < c.provinces.length; i++) {
      var m = D.market[c.provinces[i]];
      if (m && m.n > 0 && !m.halted) return true;
    }
    return false;
  }
  function isBorder(p) {
    if (!p || !p.neighbors) return false;
    for (var i = 0; i < p.neighbors.length; i++) {
      var q = pOf(p.neighbors[i]);
      if (q && q.owner !== p.owner) return true;
    }
    return false;
  }
  function provHas(p, key) {
    if (!p || !p.resources) return false;
    for (var i = 0; i < p.resources.length; i++) if (p.resources[i].key === key) return true;
    return false;
  }
  /* 本省最富的那个矿（铁 / 金），都没有就 null */
  function oreOf(pid) {
    var bag = D.sim[pid], best = null, bestL = 0;
    var ks = ['iron', 'gold'];
    for (var i = 0; i < ks.length; i++) {
      var s = bag && bag[ks[i]];
      if (!s || !s.n) continue;
      var left = s.left || 0;
      if (left > bestL) { bestL = left; best = ks[i]; }
      else if (!best) best = ks[i];
    }
    return best;
  }

  /* =============================================================
   * 五、ctx —— 只读视图 + fx 执行器
   * ============================================================= */
  function buildCtx(ev, pid, cid) {
    var p = pOf(pid);
    var owner = cid || (p ? p.owner : 0);
    var c = coOf(owner);
    /* 国事件的作用面 = 全国各省；省事件 = 这一省 */
    var scope = (ev.spot === 'country' || ev.spot === 'player')
      ? (c ? c.provinces.slice() : [pid]) : [pid];
    return {
      world: W(), turn: getTurn(), PLAYER: D.player(),
      prov: p, country: c, pid: pid | 0, cid: owner | 0,
      pop: num(D.pop[pid], 'v') || (p && p.population) || 0,
      happy: c ? D.countryHappy(c) : 0,
      armies: countArmies(owner),
      generals: countGenerals(owner),
      official: D.official[pid | 0] || null,
      faith: (p && typeof p.faithIdx === 'number') ? p.faithIdx : -1,
      border: isBorder(p),
      war: inWar(owner),
      market: hasMarket(owner),
      /* 不安（v13）：UNREST 的唯一出口。没有就按 0 算 ——
       * 老档 / 手搓的 world 读进来不会崩，只是"这一刻还没人闹事"。 */
      unrest: D.unrestOf ? D.unrestOf(pid | 0).v : 0,
      scope: scope,
      has: function (key) { return provHas(p, key); },
      ore: oreOf(pid),
      fx: makeFx(pid, owner, scope)
    };
  }

  /* fx 的每一个动作都只改"现有状态"，不新开池子：
   * 省库存就是 SIM[pid]，省库金就是 SIM[pid].gold.stock，中央就是 CENTRAL[owner]。 */
  function makeFx(pid, owner, scope) {
    var bag = D.sim[pid] || {};
    return {
      /* 民心是每省一份：省事件改一省，国事件改全国（按 scope 逐省） */
      happy: function (n) {
        for (var i = 0; i < scope.length; i++) {
          var h = D.happyOf(scope[i]);
          h.v = clamp(h.v + n, 0, 100);
          h.target = clamp(h.target + n, 0, 100);
        }
      },
      popPct: function (p) {
        var s = D.pop[pid];
        if (s) s.v = Math.max(0, s.v * (1 + p));
      },
      popAbs: function (n) {
        var s = D.pop[pid];
        if (s) s.v = Math.max(0, s.v + n);
      },
      stock: function (key, n) {
        var s = bag[key];
        if (!s) return 0;
        var before = s.stock || 0;
        s.stock = Math.max(0, before + n);
        return s.stock - before;
      },
      stockPct: function (key, p) {
        var s = bag[key];
        if (!s) return 0;
        var before = s.stock || 0;
        s.stock = Math.max(0, Math.round(before * (1 + p)));
        return s.stock - before;
      },
      central: function (key, n) {
        var cen = D.ensureCentral(owner);
        cen[key] = Math.max(0, (cen[key] || 0) + n);
      },
      /* 储量 +50%：矿已经采空（gone）的话这一笔就把它救活 ——
       * 不然"新发现"落在一座空矿上，效果是 0，玩家会以为没生效。
       * **复活 = 回储量 + 清 gone**：gone 留着的话 settleTurn 里
       * `if (!s.built || s.gone) continue` 会把它永久跳过，改了也白改
       * （枯竭矿不再收维护、不再产出，只有清掉标记才恢复结算）。 */
      left: function (key, mul) {
        var k = (key === '*') ? oreOf(pid) : key;
        if (!k) return;
        var s = bag[k];
        if (!s) return;
        if ((s.left || 0) <= 0) {
          s.left = Math.max(10, Math.round((s.n || 40) * 0.5));
          s.cool = 0;
        } else {
          s.left = Math.max(1, Math.round(s.left * (1 + mul)));
        }
        /* 不管走哪一支，只要这一笔真给了储量，枯竭标记就得跟着清。
         * 复活之后熔旧坊照常并存（两份收入叠加）—— 熔旧坊的状态在 UI 层，
         * 这里一行都不用碰。 */
        s.gone = false;
      },
      buff: function (key, mul, turns) {
        if (!key || !(turns > 0)) return;
        var list = EBUFF[pid] || (EBUFF[pid] = []);
        list.push({ key: key, mul: mul, turns: turns });
      },
      talent: function (n) {
        var T = D.talentOf(owner);
        T.pts = Math.max(0, T.pts + n);
      },
      research: function (n) {
        var R = D.researchOf(owner);
        R.pts = Math.max(0, R.pts + n);
      },
      killOfficial: function () {
        var off = D.official[pid];
        if (off) delete D.official[pid];
      },
      removeGeneral: function () {
        var g = pickGeneral(owner);
        if (g) fireGeneral(g, owner, '召还处斩');
      },
      mutiny: function () {
        var g = pickGeneral(owner, true);
        if (g) rebelGeneral(g, owner);
      },
      /* 不安（v13）：**按 scope 逐省**改（和 happy 一个口径 ——
       * 省事件改一省，国事件改全国），并同步把 target 压下去，
       * 否则下一回合 settleUnrest 的 lerp 会立刻把降下去的那一截拉回来。 */
      unrest: function (n) {
        if (!D.unrestOf) return;
        for (var i = 0; i < scope.length; i++) {
          var u = D.unrestOf(scope[i]);
          u.v = clamp(u.v + n, 0, (AO.UNREST && AO.UNREST.max) || 100);
          u.target = clamp(Math.min(u.target, u.v), 0, (AO.UNREST && AO.UNREST.max) || 100);
          if (n < 0 && u.v < ((AO.UNREST && AO.UNREST.warnAt) || 70) && D.unwarnClear) {
            D.unwarnClear(scope[i]);          // 压回去了 → 预警档复位，下次攒上去还会再报
          }
        }
      },
      /* 匪患标记：下一回合产物归零 + 不安 +10（和"匪乱"共用一条标记） */
      bandit: function () {
        if (!D.banditSet) return;
        D.banditSet(pid | 0);
      },
      /* 招安出来的驻防军：走 11-ui 的现有征兵结构（newArmy + 该代最好的武器） */
      garrison: function (n) {
        if (!D.garrisonAdd) return;
        D.garrisonAdd(pid | 0, n || 1);
      },
      /* 物价冲击（v14）：把**本国**这种资源的目标价接管 turns 回合。
       * 只改 target 不改 v —— v 由 settlePrices 的 lerp 一步步挪过去，
       * 所以"旱情一起，粮价两天内涨上去"是看得见的过程，不是一夜跳价。
       * jump=1（旱情/商队这种消息面冲击）当回合就走一半。 */
      price: function (key, target, turns, jump) {
        if (!D.priceNudge || !key) return;
        D.priceNudge(owner | 0, key, target, turns || 2, jump);
      },
      /* 商队到访：按 ×1.3 价收本省 10 单位最富的土产（钱走攒整） */
      caravan: function (mul) {
        if (!D.caravan) return null;
        return D.caravan(pid | 0, null, mul || 1.3);
      }
    };
  }

  /* 挑一位将领：preferArmy=true 时优先挑"正带着兵"的那位（叛乱要有兵才叫叛乱） */
  function pickGeneral(owner, preferArmy) {
    var G = D.generals, pick = null, fallback = null;
    for (var id in G) {
      var g = G[id];
      if (!g || g.owner !== owner) continue;
      if (g.armyId) { if (!pick) pick = g; }
      else if (!fallback) fallback = g;
    }
    return pick || (preferArmy ? null : fallback);
  }
  function fireGeneral(g, owner, why) {
    var a = g.armyId ? D.army[g.armyId] : null;
    if (a) { a.generalId = 0; }
    delete D.generals[g.id];
    var pool = D.milPoolOf(owner);
    for (var i = pool.length - 1; i >= 0; i--) if (pool[i] && pool[i].id === g.id) pool.splice(i, 1);
    D.warLog.unshift({ turn: getTurn(), cls: 'warn',
      text: '⚑ ' + g.name + ' 被' + why + '（' + (coOf(owner) || {}).name + ' 失一将）' });
  }

  /* 叛军：owner 取**负号 id**（-旧主），于是
   *   · atWar(-5, 5) 走现成的 WARSET 表，不用给战争层加分支；
   *   · landPath 只允许走"自己的省或交战国"，叛军没有自己的省 → 只能往旧主腹地打；
   *   · coOf(-5) 是 undefined，所有显示位都有兜底（旗子用灰、名字用 ?）。
   * 占领那一环要跳过（叛军不占地），见 11-ui 的 settleWar ④。 */
  function rebelGeneral(g, owner) {
    var a = g.armyId ? D.army[g.armyId] : null;
    if (!a) return null;
    var target = 0, c = coOf(owner), me = pOf(a.pid);
    if (c && c.provinces.length) {
      var bestD = Infinity;
      for (var i = 0; i < c.provinces.length; i++) {
        var q = pOf(c.provinces[i]);
        if (!q) continue;
        if (q.id === a.pid) { target = q.id; bestD = -1; break; }
        if (!me) continue;
        var dx = q.centroid[0] - me.centroid[0], dy = q.centroid[1] - me.centroid[1];
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; target = q.id; }
      }
    }
    a.owner = -owner;
    a.rebel = owner;
    a.order = { type: 'attack', cid: owner, pid: target, tactic: 'assault' };
    D.warset[D.warKey(-owner, owner)] = true;
    var txt = '⚔ ' + g.name + ' 拥兵自立于' + ((me || {}).name || '边地') +
      '，' + a.men + ' 人叛军反攻' + ((coOf(owner) || {}).name || '旧主');
    D.warLog.unshift({ turn: getTurn(), cls: 'bad', text: txt });
    D.notes.push({ owner: owner, pid: a.pid, cls: 'bad', text: txt });
    return a;
  }

  /* =============================================================
   * 六、触发
   * ============================================================= */
  function evtByKey(k) { return BY_KEY[k] || null; }

  /* 给一个事件找一个能落的目标。找不到 → null。
   * 国事件先试玩家国（不然 64 国里抽，玩家十回合都见不到一次自己的事），
   * 不合格再随机挑一个国。 */
  function findTarget(ev) {
    var w = W();
    if (!w) return null;
    var tries = EVT.tries, t;
    if (ev.spot === 'prov') {
      var ps = w.provinces;
      for (t = 0; t < tries; t++) {
        var pid = 1 + Math.floor(Math.random() * ps.length);
        var p = ps[pid - 1];
        if (!p || !p.owner) continue;
        var ctx = buildCtx(ev, pid, p.owner);
        if (ev.when(ctx)) return { pid: pid, cid: p.owner, ctx: ctx };
      }
      return null;
    }
    /* country / player */
    var order = [], i;
    var pl = D.player();
    if (pl) order.push(pl);
    var cs = w.countries;
    for (t = 0; t < tries; t++) order.push(1 + Math.floor(Math.random() * cs.length));
    for (i = 0; i < order.length; i++) {
      var cid = order[i], c = cs[cid - 1];
      if (!c || !c.provinces.length) continue;
      var cap = pOf(c.capital) || pOf(c.provinces[0]);
      if (!cap) continue;
      var ctx2 = buildCtx(ev, cap.id, cid);
      if (ev.when(ctx2)) return { pid: cap.id, cid: cid, ctx: ctx2 };
    }
    return null;
  }

  function weightedPick(list, key) {
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += Math.max(0.0001, list[i][key] || 1);
    var r = Math.random() * sum;
    for (i = 0; i < list.length; i++) {
      r -= Math.max(0.0001, list[i][key] || 1);
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /* 每回合掷一次：过滤冷却/一次性/when → 按权重抽至多一件 */
  function rollEvent() {
    var turn = getTurn();
    if (turn <= EVT.startTurn) return null;
    if (Math.random() > EVT.chance) return null;
    var pool = [], i, ev, tg;
    for (i = 0; i < EVENTS.length; i++) {
      ev = EVENTS[i];
      if (ev.once && EDONE[ev.key]) continue;
      if ((ECD[ev.key] || 0) > turn) continue;
      tg = findTarget(ev);
      if (!tg) continue;
      pool.push({ ev: ev, tg: tg, w: Math.max(0.2, ev.w || 1) });
    }
    if (!pool.length) return null;
    var pick = weightedPick(pool, 'w');
    return fireEvent(pick.ev, pick.tg);
  }

  function fireEvent(ev, tg) {
    var turn = getTurn();
    ECD[ev.key] = turn + (ev.cd || EVT.cdDefault);
    if (ev.once) EDONE[ev.key] = true;
    /* 玩家国 → 弹窗等选项；别的国 → AI 按权重自己选一个，只进纪要 */
    if (D.player() && tg.cid === D.player()) {
      EPEND = { key: ev.key, pid: tg.pid, cid: tg.cid, turn: turn };
      D.openModal(ev, tg.ctx);
      return { ev: ev, tg: tg, pending: true };
    }
    var opt = weightedPick(ev.options, 'w');
    var idx = ev.options.indexOf(opt);
    resolve(ev, tg, idx, false);
    return { ev: ev, tg: tg, pending: false };
  }

  /* 落地：执行 fx → 写纪要 → 玩家选的话再弹一条 NOTES */
  function resolve(ev, tg, idx, byPlayer) {
    var opt = ev.options[idx] || ev.options[0];
    var ctx = tg.ctx;
    if (opt && opt.fx) AO.evtApply(ctx, opt.fx);
    if (ev.onPick) ev.onPick(ctx, idx);
    var line = evtLine(ev, tg, opt);
    EVLOG.unshift({ turn: getTurn(), key: ev.key, cls: byPlayer ? 'ok' : 'warn', text: line });
    if (EVLOG.length > EVT.logMax) EVLOG.length = EVT.logMax;
    /* 世界纪要 = WARLOG（战报那个池子，同款样式）：事件和战报混着排，
     * 读起来才像"这一年发生的事"，而不是两本互不相干的册子。 */
    D.warLog.unshift({ turn: getTurn(), cls: byPlayer ? 'ok' : 'warn', text: line });
    if (D.warLog.length > EVT.logMax) D.warLog.length = EVT.logMax;
    if (byPlayer) D.notes.push({ owner: tg.cid, pid: tg.pid, cls: 'ok', text: line });
    return line;
  }

  /* 一行纪要：⚑ 瘟疫 · 河间府（国名）—— 封锁里巷：省库金 −20，民心 −4 */
  function evtLine(ev, tg, opt) {
    var p = pOf(tg.pid), c = coOf(tg.cid);
    var where = (p ? p.name : '?') + (c ? '（' + c.name + '）' : '');
    var tip = opt ? AO.evtOptTip(ev, opt) : '';
    return '⚑ ' + ev.cn + ' · ' + where + (opt ? ' —— ' + opt.cn + '：' + tip : '');
  }

  /* 玩家在弹窗里点了一个选项 */
  AO.evtPick = function (idx) {
    if (!EPEND) return null;
    var ev = evtByKey(EPEND.key);
    var tg = EPEND;
    EPEND = null;
    D.closeModal();
    if (!ev) return null;
    var ctx = buildCtx(ev, tg.pid, tg.cid);
    var line = resolve(ev, { pid: tg.pid, cid: tg.cid, ctx: ctx }, idx, true);
    D.lockTurn(false);
    D.refresh();
    return line;
  };

  /* 读档后把挂起的事件重新弹出来（ctx 里有闭包，不能存，只能重建） */
  function reopenPending() {
    if (!EPEND) { D.lockTurn(false); return; }
    var ev = evtByKey(EPEND.key);
    if (!ev) { EPEND = null; D.lockTurn(false); return; }
    var ctx = buildCtx(ev, EPEND.pid, EPEND.cid);
    D.openModal(ev, ctx);
  }

  /* =============================================================
   * 七、每回合的推进（传教 / 临时产量 / 事件）
   *
   * 顺序很重要：
   *   ① 传教倒计时 ② 产量 buff 倒计时 ③ 重算国教 ④ 掷事件
   * 倒计时排在掷事件**之前**：这一回合新加的 buff 不该在同一回合就少一格，
   * 否则"3 回合"实际只有 2 回合。
   * ============================================================= */
  function tickMissions() {
    var FA = AO.FAITHS || [];
    for (var k in MISSION) {
      var m = MISSION[k], pid = +k, p = pOf(pid);
      /* 传教中的省被占领 → 作废（钱不退，人也没了） */
      if (!p || p.owner !== m.owner) {
        delete MISSION[k];
        if (p) {
          D.warLog.unshift({ turn: getTurn(), cls: 'warn',
            text: '⚑ ' + p.name + ' 易主，传教作废' });
        }
        continue;
      }
      m.left--;
      if (m.left > 0) continue;
      p.faithIdx = m.to;
      p.faithKey = FA[m.to] ? FA[m.to].key : '';
      p.faithName = FA[m.to] ? FA[m.to].cn : '';
      p.faithColor = FA[m.to] ? FA[m.to].color : '#cccccc';
      delete MISSION[k];
      recomputeStateFaith(m.owner);
      var txt = '✝ ' + p.name + ' 改宗' + (FA[m.to] ? FA[m.to].cn : '国教') +
        '（' + ((coOf(m.owner) || {}).name || '?') + '）';
      D.warLog.unshift({ turn: getTurn(), cls: 'ok', text: txt });
      D.notes.push({ owner: m.owner, pid: pid, cls: 'ok', text: txt });
    }
  }

  function tickBuffs() {
    for (var k in EBUFF) {
      var list = EBUFF[k];
      for (var i = list.length - 1; i >= 0; i--) {
        list[i].turns--;
        if (list[i].turns <= 0) list.splice(i, 1);
      }
      if (!list.length) delete EBUFF[k];
    }
  }

  /* 产量乘数：settleTurn ③ 里乘在毛产上（和官员 prodMul 同一层） */
  AO.evtProdMul = function (pid, key) {
    var list = EBUFF[pid];
    if (!list || !list.length) return 1;
    var m = 1;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) m *= list[i].mul;
    return m;
  };

  AO.evtSettle = function () {
    if (!D || !W()) return null;
    tickMissions();
    tickBuffs();
    recomputeAllStateFaith();
    return rollEvent();
  };

  /* =============================================================
   * 八、信仰做实
   *
   * 国教 = 该国省份里**面积占比最大**的那个信仰（复用 c.faiths 的统计口径：
   * 按 area 聚合，无神论不参与 —— 它不是"哪一块地信什么"）。
   * 每回合占领 / 传教之后重算一次；生成完也算一次。
   * ============================================================= */
  function recomputeStateFaith(owner) {
    var c = coOf(owner);
    if (!c || !c.provinces.length) { delete STATEFAITH[owner]; return -1; }
    var byF = Object.create(null), best = -1, bestA = -1;
    for (var i = 0; i < c.provinces.length; i++) {
      var p = pOf(c.provinces[i]);
      if (!p) continue;
      var fi = p.faithIdx;
      if (typeof fi !== 'number' || fi < 0) continue;
      var a = (p.area || 1);
      byF[fi] = (byF[fi] || 0) + a;
      if (byF[fi] > bestA) { bestA = byF[fi]; best = fi; }
    }
    if (best >= 0) STATEFAITH[owner] = best;
    else delete STATEFAITH[owner];
    return best;
  }
  AO.recomputeStateFaith = recomputeStateFaith;

  function recomputeAllStateFaith() {
    var ps = provList(), byF = Object.create(null), i, p;
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (!p || !p.owner) continue;
      var fi = p.faithIdx;
      if (typeof fi !== 'number' || fi < 0) continue;
      var bag = byF[p.owner] || (byF[p.owner] = { best: -1, bestA: -1, acc: Object.create(null) });
      bag.acc[fi] = (bag.acc[fi] || 0) + (p.area || 1);
      if (bag.acc[fi] > bag.bestA) { bag.bestA = bag.acc[fi]; bag.best = fi; }
    }
    for (var k in STATEFAITH) delete STATEFAITH[k];
    for (var o in byF) STATEFAITH[o] = byF[o].best;
    return STATEFAITH;
  }
  AO.recomputeAllStateFaith = recomputeAllStateFaith;

  /* 国教下标（没有国 → −1）。懒算：老存档读进来 STATEFAITH 是空的也不会崩 */
  function stateFaithOf(owner) {
    if (STATEFAITH[owner] === undefined) recomputeStateFaith(owner);
    return STATEFAITH[owner] === undefined ? -1 : STATEFAITH[owner];
  }
  AO.stateFaithOf = stateFaithOf;

  function faithPolOf(owner) {
    var v = FAITHPOL[owner];
    return (v === 'tolerant' || v === 'force') ? v : 'force';
  }
  AO.faithPolOf = faithPolOf;

  /* 异信仰的幸福度扣分（settleHappy 的 driver）。同信仰 / 无国教 → 0 */
  AO.faithDriver = function (pid, owner) {
    var p = pOf(pid);
    if (!p) return 0;
    var sf = stateFaithOf(owner);
    if (sf < 0) return 0;
    var fi = p.faithIdx;
    if (typeof fi !== 'number' || fi < 0) return 0;
    if (fi === sf) return 0;
    return faithPolOf(owner) === 'force' ? FAITH.hitForce : FAITH.hitTolerant;
  };

  /* 异信仰省的名字（悬停明细要写"异信仰（月影信仰）−6"） */
  AO.faithName = function (idx) {
    var FA = AO.FAITHS || [];
    return (idx >= 0 && FA[idx]) ? FA[idx].cn : '无';
  };

  function setFaithPol(owner, pol) {
    if (pol !== 'force' && pol !== 'tolerant') return false;
    if (!D.canAct(owner)) { D.toast('非你的国家（先点顶栏「开始游戏」选一个国）', 2400); return false; }
    FAITHPOL[owner] = pol;
    /* 切到宽容：正在传教的全部停手（宽容档本来就不许传教） */
    if (pol === 'tolerant') {
      for (var k in MISSION) if (MISSION[k].owner === owner) delete MISSION[k];
    }
    return true;
  }
  AO.setFaithPol = setFaithPol;

  /* 能不能对这一省开传教（按钮的可用性判据，UI 直接问这个） */
  AO.canMission = function (pid) {
    var p = pOf(pid);
    if (!p || !D.player() || p.owner !== D.player()) return false;
    if (faithPolOf(p.owner) !== 'force') return false;
    if (MISSION[pid]) return true;                 // 已在传教 → 可撤资
    var sf = stateFaithOf(p.owner);
    if (sf < 0) return false;
    return (typeof p.faithIdx === 'number' && p.faithIdx >= 0 && p.faithIdx !== sf);
  };

  /* 传教：花省库金 → 倒计时 → 改宗。重复点 = 撤资取消（金不退，防刷） */
  AO.toggleMission = function (pid) {
    var p = pOf(pid);
    if (!p) return { ok: false, msg: '没有这个省' };
    if (!AO.canMission(pid)) return { ok: false, msg: '这一省不需要传教' };
    if (MISSION[pid]) {
      delete MISSION[pid];
      return { ok: true, msg: p.name + ' 传教已撤资（' + FAITH.missionCost + ' 金不退）', cancel: true };
    }
    var bag = D.sim[pid], gold = (bag && bag.gold) ? bag.gold.stock : 0;
    if (gold < FAITH.missionCost) {
      return { ok: false, msg: '省库金不够：要 ' + FAITH.missionCost + '，' + p.name + ' 只有 ' + Math.floor(gold) };
    }
    bag.gold.stock -= FAITH.missionCost;
    var turns = Math.max(1, Math.round(FAITH.missionTurns * FAITH.missionTurnMul));
    MISSION[pid] = { left: turns, to: stateFaithOf(p.owner), owner: p.owner };
    return { ok: true, msg: '派传教士入 ' + p.name + '：金 −' + FAITH.missionCost + '，' + turns + ' 回合后改宗' };
  };

  AO.missionOf = function (pid) { return MISSION[pid] || null; };

  /* =============================================================
   * 九、存档
   * ============================================================= */
  AO.evtSave = function () {
    return {
      ECD: ECD, EDONE: EDONE, EBUFF: EBUFF, MISSION: MISSION,
      FAITHPOL: FAITHPOL, STATEFAITH: STATEFAITH,
      PEND: EPEND ? { key: EPEND.key, pid: EPEND.pid, cid: EPEND.cid, turn: EPEND.turn } : null
    };
  };

  function fill(dst, src) {
    for (var k in dst) delete dst[k];
    if (src) for (var j in src) dst[j] = src[j];
  }

  /* v3 档里没有这一块 → 全部补默认（空表 / 强制 / 重算国教），不炸 */
  AO.evtLoad = function (d) {
    d = d || {};
    fill(ECD, d.ECD);
    fill(EDONE, d.EDONE);
    fill(EBUFF, d.EBUFF);
    fill(MISSION, d.MISSION);
    fill(FAITHPOL, d.FAITHPOL);
    fill(STATEFAITH, d.STATEFAITH);
    EPEND = d.PEND ? { key: d.PEND.key, pid: d.PEND.pid | 0, cid: d.PEND.cid | 0, turn: d.PEND.turn | 0 } : null;
    if (!Object.keys(STATEFAITH).length) recomputeAllStateFaith();
    EVLOG.length = 0;
  };

  AO.evtReopen = function () { if (D) reopenPending(); };

  /* 新开一局：全清（含 buff / 传教 / 政策） */
  AO.evtReset = function () {
    fill(ECD, null); fill(EDONE, null); fill(EBUFF, null); fill(MISSION, null);
    fill(FAITHPOL, null); fill(STATEFAITH, null);
    EPEND = null;
    EVLOG.length = 0;
    recomputeAllStateFaith();
  };

  /* 测试用：直接按 key 触发一件（不看冷却、不掷骰）。
   * viaModal=true 时走"玩家弹窗"那条路（等 evtPick），否则按 AI 路径立刻落地。 */
  AO.evtForce = function (key, pid, viaModal) {
    var ev = evtByKey(key);
    if (!ev) return null;
    var tg;
    if (pid) {
      var p = pOf(pid);
      if (!p) return null;
      tg = { pid: p.id, cid: p.owner, ctx: buildCtx(ev, p.id, p.owner) };
    } else {
      tg = findTarget(ev);
    }
    if (!tg) return null;
    ECD[ev.key] = getTurn() + (ev.cd || EVT.cdDefault);
    if (ev.once) EDONE[ev.key] = true;
    if (viaModal && D.player() && tg.cid === D.player()) {
      EPEND = { key: ev.key, pid: tg.pid, cid: tg.cid, turn: getTurn() };
      D.openModal(ev, tg.ctx);
      return tg;
    }
    var opt = weightedPick(ev.options, 'w');
    resolve(ev, tg, ev.options.indexOf(opt), false);
    return tg;
  };

  /* 测试用：这一省现在能不能出这个事件（就是 when 的判定，不触发） */
  AO.evtCan = function (key, pid) {
    var ev = evtByKey(key);
    var p = pOf(pid);
    if (!ev || !p) return false;
    return !!ev.when(buildCtx(ev, p.id, p.owner));
  };

})(typeof window !== 'undefined' ? window : globalThis);
