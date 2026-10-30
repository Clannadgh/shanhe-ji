/* =============================================================
 * 17-chrono.js —— 编年史（史书页 / 年表 / 三图快照 / 称号 / 导出 PNG）
 *
 * 这是全游戏**唯一一个非地图界面**。DESIGN.md 的原话是
 * "一张可滚动的史书页：标题、领袖、年表、三张地图、最终数据、称号。
 *   底部导出 PNG / 复制种子码。这是唯一的非地图界面，值得单独做漂亮。"
 *
 * 分五块，互相只通过"数据"打交道：
 *   ① 年表仓储（YEARLOG）—— 每回合结算尾把 NOTES 全量归档，战报按 turn 并入
 *   ② 称号表（AO.TITLES）—— 条件与阈值集中在一处，随便调
 *   ③ 史书页 DOM —— 全屏、可滚动、暖白纸 + 双线图廓
 *   ④ 三图快照 —— 复用渲染层的 _renderBase 画到离屏（不切主视图、不闪屏）
 *   ⑤ 导出 —— 离屏 canvas 竖版长卷（纯 canvas，不引 html2canvas）
 *
 * 为什么单独成文件：11-ui.js 已经 7000 行了，而这块是**读状态**的展示层，
 * 除了"结算尾一行归档钩子"之外不碰任何战争 / 治理 / 事件逻辑。
 * 外部只认这个文件导出的 AO.chronoXxx，内部变量一律不外泄。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  function doc() { return root.document; }
  function $(id) { var d = doc(); return d ? d.getElementById(id) : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* =============================================================
   * ① 称号表
   *
   * 定稿时按终局数据挑 1~3 枚：**从上到下先命中的当正章**，
   * 之后最多再补两枚副章。条件互斥靠顺序保证（千古一帝不会被
   * 再补一枚"征服者"，因为正章已经封顶）。
   * 阈值全部写在这一张表里 —— 以后想调"多少省才算征服者"只改这里。
   * ============================================================= */
  AO.TITLES = {
    dead:      { cn: '悲情末帝', sym: '殤', note: '一省不剩，社稷倾覆',
      cond: function (d) { return d.provN === 0; } },
    unified:   { cn: '千古一帝', sym: '帝', note: '四海之内，尽归版图',
      cond: function (d) { return d.areaPct >= 99.9; } },
    conqueror: { cn: '征服者',   sym: '征', note: '疆域之广，冠于列国',
      cond: function (d) { return d.areaRank === 1 && d.areaPct >= 25; } },
    gold:      { cn: '黄金之国', sym: '金', note: '国库之富，天下无双',
      cond: function (d) { return d.goldRank === 1 && d.gold >= 400; } },
    science:   { cn: '格物穷理', sym: '理', note: '百工之术，几近穷尽',
      cond: function (d) { return d.techTotal > 0 && d.techN >= d.techTotal * 0.9; } },
    happy:     { cn: '万民称颂', sym: '颂', note: '民心所向，歌于道路',
      cond: function (d) { return d.happy >= 80; } },
    edu:       { cn: '文教昌盛', sym: '文', note: '庠序如林，弦歌不绝',
      cond: function (d) { return d.edu >= 60; } },
    army:      { cn: '马上天子', sym: '武', note: '带甲之士，列国之最',
      cond: function (d) { return d.armyRank === 1 && d.armyMen >= 10000; } },
    keeper:    { cn: '守成之君', sym: '守', note: '不功不烈，亦无失坠',
      cond: function () { return true; } }
  };
  /* 顺序即优先级（守成之君永远垫底，只在一条都没占上时才用） */
  var TITLE_ORDER = ['dead', 'unified', 'conqueror', 'gold', 'science', 'happy', 'edu', 'army', 'keeper'];

  /* 挑称号：返回 [{ key, cn, sym, note }]，1~3 枚 */
  function pickTitles(d) {
    var out = [], i, k, t;
    for (i = 0; i < TITLE_ORDER.length; i++) {
      k = TITLE_ORDER[i];
      t = AO.TITLES[k];
      if (!t || !t.cond(d)) continue;
      out.push({ key: k, cn: t.cn, sym: t.sym, note: t.note });
      break;                                  // 正章只有一个
    }
    if (!out.length) {
      t = AO.TITLES.keeper;
      out.push({ key: 'keeper', cn: t.cn, sym: t.sym, note: t.note });
    }
    for (i = 0; i < TITLE_ORDER.length && out.length < 3; i++) {
      k = TITLE_ORDER[i];
      if (k === 'keeper' || k === 'dead' || k === out[0].key) continue;
      /* 千古一帝必然"疆域第一"，再盖一枚征服者只是把同一件事说两遍 */
      if (k === 'conqueror' && out[0].key === 'unified') continue;
      t = AO.TITLES[k];
      if (!t.cond(d)) continue;
      out.push({ key: k, cn: t.cn, sym: t.sym, note: t.note });
    }
    return out;
  }
  AO.chronoPickTitles = pickTitles;

  /* =============================================================
   * ② 年表仓储
   *
   * YEARLOG = [ { turn, entries: [ { text, cls, tag } ] } ]，按 turn 升序。
   * 一条几十字节，一千回合也就几十 KB —— 不设上限。
   *
   * 归档口径：
   *   · NOTES 是"即时流"（这一回合攒的，flushNotes 弹一条），**原样不动**；
   *     归档只是把它的内容抄进年表，抄过的打 n.__yl 记号，绝不重复抄。
   *   · WARLOG 的战报**不重复存**：年表渲染时按 turn 合并进对应年份，
   *     合并时按文本去重（会战/宣战/灭亡在两边各推了一次，文本是同一句）。
   *   · 首都易手 / 光复没有现成的 NOTES，靠"上一回合的首都归属快照"求差 ——
   *     纯读状态，不需要在战争逻辑里插一行。
   * ============================================================= */
  var YL = [];                            // 年表
  var FLAGS = { unified: 0, dead: 0 };    // 自动触发只推一次
  var FINAL = null;                       // 定稿快照 { turn, data, titles, shots, ts }
  var CAPW = null, CAP = null;            // 首都归属快照（跟着 world 走）
  var PENDING = null;                     // 待弹的自动触发（'unified' / 'dead'）

  /* 文本前缀的符号（🚩💀⚔ 这些在纸面上太跳）—— 归到 12 个"史官用字"上，
   * 渲染时放在条目左侧当标记，正文里就不带 emoji 了。 */
  var TAG_SYM = {
    occupy: '據', death: '亡', capital: '都', war: '戰', peace: '和',
    tech: '技', edu: '學', event: '事', battle: '兵', siege: '圍',
    raid: '掠', scorch: '燼', faith: '教', warn: '警', plain: ''
  };
  /* 里程碑：年表里前置红点、加粗、字号大一号 */
  var MILESTONE = { occupy: 1, death: 1, capital: 1, war: 1, peace: 1, tech: 1, edu: 1, event: 1 };
  AO.chronoMilestone = function (tag) { return !!MILESTONE[tag]; };

  var EMOJI = /^(?:[\u2190-\u21FF\u2300-\u23FF\u2500-\u27BF\u2B00-\u2BFF\uFE0F\u200D]|[\uD83C-\uD83E][\uDC00-\uDFFF])+\s*/;
  function clean(s) { return String(s == null ? '' : s).replace(EMOJI, '').trim(); }

  function tagOf(raw) {
    var t = String(raw || '');
    if (/^💀|灭亡/.test(t)) return 'death';
    if (/^🚩|易主/.test(t)) return 'occupy';
    if (/^📜/.test(t)) return 'war';
    if (/^🕊/.test(t)) return 'peace';
    if (/研究完成/.test(t)) return 'tech';
    if (/科研条攒满|开始研究/.test(t)) return 'edu';
    if (/^⚑/.test(t)) return 'event';
    if (/^✝/.test(t)) return 'faith';
    if (/^⚔/.test(t)) return 'battle';
    if (/^🏯/.test(t)) return 'siege';
    if (/^🔥/.test(t)) return 'raid';
    if (/^🧱/.test(t)) return 'scorch';
    if (/^⚠/.test(t)) return 'warn';
    return '';
  }
  AO.chronoTagOf = tagOf;

  function findYear(t) {
    for (var i = YL.length - 1; i >= 0; i--) {
      if (YL[i].turn === t) return YL[i];
      if (YL[i].turn < t) break;
    }
    return null;
  }

  function yearOf(t) {
    var rec = findYear(t);
    if (rec) return rec;
    rec = { turn: t, entries: [] };
    var i;
    for (i = 0; i < YL.length; i++) if (YL[i].turn > t) break;
    YL.splice(i, 0, rec);
    return rec;
  }

  function hasText(rec, txt) {
    for (var i = 0; i < rec.entries.length; i++) if (rec.entries[i].text === txt) return true;
    return false;
  }

  /* 按年分组（v13）：YEARLOG 是按**回合**存的，史书要按**年**分节。
   * 一年 12 回合，硬按回合分会得到 12 倍厚的年表 —— 那不是史书，是流水账。
   * 拎成函数是为了测试能直接验"同年的几条并到一节"，
   * 而不用去 canvas 上数像素。 */
  function yearsOf(limit) {
    var out = [], gy = -1, g = null, i, rec, yr;
    for (i = 0; i < YL.length; i++) {
      rec = YL[i];
      if (rec.turn > limit || !rec.entries.length) continue;
      yr = AO.calOf ? AO.calOf(rec.turn).year : rec.turn;
      if (yr !== gy) { gy = yr; g = { year: yr, recs: [] }; out.push(g); }
      g.recs.push(rec);
    }
    return out;
  }
  AO.chronoYears = yearsOf;

  function capSnapshot(world) {
    var m = Object.create(null), i, c, p;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      p = c.capital ? world.provinces[c.capital - 1] : null;
      m[c.id] = p ? (p.owner | 0) : 0;
    }
    return m;
  }

  /* 首都易手 / 光复：和上一回合的快照比。world 换了就只记快照、不产条目
   * （否则读档/换种子的第一回合会凭空冒出几十条"首都陷落"）。 */
  function capMilestones(world, rec) {
    if (CAPW !== world) { CAPW = world; CAP = capSnapshot(world); return; }
    var now = capSnapshot(world), i, c, was, is, p, by;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      was = CAP[c.id] || 0; is = now[c.id] || 0;
      if (was === is) continue;
      p = c.capital ? world.provinces[c.capital - 1] : null;
      if (!p) continue;
      if (was === c.id && is !== c.id) {
        by = B && B.country ? B.country(is) : null;
        rec.entries.push({ text: '京城陷落：' + c.name + ' 的都城 ' + p.name +
          ' 落入' + (by ? by.name : '他人') + '之手', cls: 'bad', tag: 'capital' });
      } else if (was !== c.id && is === c.id) {
        rec.entries.push({ text: '光复：' + c.name + ' 收回都城 ' + p.name, cls: 'ok', tag: 'capital' });
      }
    }
    CAP = now;
  }

  /* 把当前 NOTES / WARLOG 里还没进年表的东西抄进去。
   * 空回合不建空年（一条都没有就什么都不做）—— 否则一千回合会攒下
   * 一千个空壳，读档还得多走一遍排序。 */
  /* 文本的"骨头"：去掉 emoji、括号、标点、空白，只留字。
   * 用来判"是不是同一件事" —— 战报和邸报的措辞差一个【十年七月】前缀、
   * 一个（后闻），逐字比是比不出来的，去掉装饰之后就能互相包含。 */
  function bone(s) {
    return String(s == null ? '' : s).replace(EMOJI, '')
      .replace(/[【】（）()「」『』·—：:，,。.\s]/g, '');
  }
  /* 迟到的一条进来时，这一年可能已经有同一件事了（战报也并进来了）。
   * 那就只在旧条目末尾补一个「（后闻）」—— 史书是事后修订过的，
   * 这个记号正是"史官后来才听说"的味道，而不是再抄一遍。 */
  function markRear(rec, core) {
    var c = bone(core);
    if (c.length < 4) return false;
    for (var i = 0; i < rec.entries.length; i++) {
      var e = rec.entries[i], b = bone(e.text);
      if (b.length < 4) continue;
      if (c.indexOf(b) < 0 && b.indexOf(c) < 0) continue;
      if (e.text.indexOf('（后闻）') < 0) e.text += '（后闻）';
      return true;
    }
    return false;
  }

  function archive() {
    if (!B) return 0;
    var world = B.world();
    if (!world) return 0;
    var t = B.turn() | 0;
    var rec = findYear(t) || { turn: t, entries: [] };
    var start = rec.entries.length, n, i;
    var notes = B.notes() || [];
    for (i = 0; i < notes.length; i++) {
      n = notes[i];
      if (!n || !n.text || n.__yl) continue;
      n.__yl = 1;
      /* 世界消息（v15）三条归位规矩：
       *   ① 风闻不进年表（它只留在纪要里，等被更正）；
       *   ② 更正条不进年表（实情那一条本来就在里面，再记一条等于记两遍）；
       *   ③ 迟到的按**事件发生的年份**归位 —— 不是得知的年份。
       *      史书是编年的，不是邮局的收发登记簿。 */
      if (n.rumour || n.noYl) continue;
      var et = n.evtTurn | 0, tr = rec;
      if (et > 0 && et !== t) {
        tr = findYear(et) || yearOf(et);
        if (markRear(tr, n.core || n.text)) continue;
      }
      /* 迟到的那条在文末带「（后闻）」—— 史书不会假装当年就知道，
       * 它老老实实写"后来才听说"。 */
      var etxt = clean(n.text) + (et > 0 && et !== t ? '（后闻）' : '');
      tr.entries.push({ text: etxt, cls: n.cls || '', tag: tagOf(n.text) });
    }
    /* 战报：新的在前 → 倒着并入，年表里就是正序 */
    var wl = B.warLog() || [];
    for (i = wl.length - 1; i >= 0; i--) {
      var e = wl[i];
      if (!e || !e.text || (e.turn | 0) !== t) continue;
      var txt = clean(e.text);
      if (hasText(rec, txt)) continue;
      rec.entries.push({ text: txt, cls: e.cls || '', tag: tagOf(e.text) });
    }
    capMilestones(world, rec);
    if (rec.entries.length === start) return 0;   // 这一年什么都没发生
    if (!findYear(t)) yearOf(t).entries = rec.entries;
    return rec.entries.length - start;
  }

  /* =============================================================
   * ③ 数据源（全部从现有状态直读，不另存一份）
   * ============================================================= */
  var B = null;                           // 桥：11-ui.js 递进来的活对象 + 取值器

  function provsOf(cid, world) {
    var out = [], i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (p && p.owner === cid) out.push(p);
    }
    return out;
  }

  /* 没有选国（PLAYER=0 的工坊模式）时，以疆域最广的一国为记 ——
   * 编年史总得有个"本纪"的主角，否则整页都是空的。 */
  function subject() {
    var world = B.world(), cid = B.player() || 0, i, best = 0, bestN = -1, c;
    if (cid) return cid;
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      var n = (c.provinces || []).length;
      if (n > bestN) { bestN = n; best = c.id; }
    }
    return best || 1;
  }

  /* =============================================================
   * 编年史的数据：全部从 AoC2 的省/国字段读
   *
   * 旧版这里读的是 POP / CENTRAL / SCHOOL / RESEARCH / ARMY 五张表 ——
   * 那些表随换血一起退役了，继续读只会得到 undefined（渲染时 toFixed 炸）。
   * 现在：人口取国籍表、国库取 treasury、军队取 armyOf、占领取 occupied。
   * 学校 / 科技是阶段四的事，这里先老实写 0，不编数。
   * ============================================================= */
  function dataOf(cid) {
    var world = B.world(), t = B.turn() | 0;
    var c = world.countries[cid - 1] || null;
    var provinces = world.provinces, total = provinces.length, i, p;
    var own = 0, per = Object.create(null), pop = 0, occN = 0, men = 0;
    var menBy = Object.create(null);

    for (i = 0; i < provinces.length; i++) {
      p = provinces[i];
      if (!p || !p.aoc) continue;
      per[p.owner] = (per[p.owner] || 0) + 1;
      var tp = 0, k;
      for (k in p.aoc.pop) tp += p.aoc.pop[k] || 0;
      if (p.aoc.army > 0) {
        var ao = p.aoc.armyOf || p.owner;
        menBy[ao] = (menBy[ao] || 0) + p.aoc.army;
      }
      if (p.aoc.occupied === cid) occN++;
      if (p.owner !== cid) continue;
      own++;
      pop += tp;
    }
    men = menBy[cid] || 0;

    /* 排名：比自己省多 / 钱多的国家有几个（0 就是第一） */
    var moreN = 0, moreG = 0, moreA = 0, cc;
    var gold = (c && c.aoc) ? c.aoc.treasury : 0;
    for (i = 0; i < world.countries.length; i++) {
      cc = world.countries[i];
      if (!cc || cc.id === cid) continue;
      if ((per[cc.id] || 0) > own) moreN++;
      if (((cc.aoc && cc.aoc.treasury) || 0) > gold) moreG++;
      if ((menBy[cc.id] || 0) > men) moreA++;
    }

    /* 经历战争：年表里"宣战"条目点了名的次数；战报条数另算 */
    var wrN = 0, nm = (c && c.name) || '';
    for (i = 0; i < YL.length; i++) {
      for (var j = 0; j < YL[i].entries.length; j++) {
        var en = YL[i].entries[j];
        if (en.tag !== 'war') continue;
        if (nm && en.text.indexOf(nm) < 0) continue;
        wrN++;
      }
    }
    return {
      cid: cid, turn: t,
      name: (c && c.name) || '无名之国',
      nameEn: (c && (c.name_en || c.nameEn)) || '',
      leader: (c && c.leader && c.leader.name) || '',
      leaderTitle: (c && c.leader && c.leader.title) || '',
      gov: (c && c.aoc && AO.AOC2.GOV[c.aoc.gov]) ? AO.AOC2.GOV[c.aoc.gov].cn : ((c && c.govCn) || ''),
      color: (c && c.color) || '#9a9a9a',
      provN: own, provTotal: total,
      areaPct: total ? own * 100 / total : 0,
      areaRank: moreN + 1,
      pop: pop, gold: Math.round(gold), goldRank: moreG + 1,
      edu: 0, eduSchool: 0, eduPts: 0,
      techN: 0, techTotal: 0,
      armyMen: men, armyRank: moreA + 1,
      happy: (c && c.aoc) ? c.aoc.happy : 0,
      warN: wrN, logN: (B.warLog() || []).length,
      occN: occN,
      dead: own === 0
    };
  }
  AO.chronoData = function () { return B && B.world() ? dataOf(subject()) : null; };

  /* =============================================================
   * ④ 三图快照
   *
   * 复用渲染层的 _renderBase：临时把它的"底图画布 / 相机 / 视图"换成离屏的，
   * 画完原样换回来 —— 主画布一个像素都没碰，所以**不闪屏、不切玩家当前视图**。
   * 占领斜线、军队旗这些在 overlay 层（另一条绘制链），快照里天然没有；
   * 政治色块 + 海岸线 + 首都星已经足够"史书感"了。
   * ============================================================= */
  var SHOTS = null, SHOTW = null;

  function snapWorld(mode, cw, ch, dpr) {
    var R = B.renderer && B.renderer();
    if (!R || !R._renderBase || !R.world) return null;
    var world = R.world, M = world.meta;
    var cv = doc().createElement('canvas');
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    var ctx = cv.getContext('2d');
    /* 整张世界按比例装进 cw×ch（四周留 2% 呼吸） */
    var s = Math.min(cw / M.width, ch / M.height) * 0.98;
    var save = {
      base: R.base, baseCtx: R.baseCtx, dpr: R.dpr,
      cssW: R.cssW, cssH: R.cssH, view: R.viewMode,
      cam: { x: R.cam.x, y: R.cam.y, scale: R.cam.scale },
      paper: R._paperPat
    };
    R.base = cv; R.baseCtx = ctx; R.dpr = dpr;
    R.cssW = cw; R.cssH = ch;
    R.viewMode = mode;
    R.cam.x = M.width / 2; R.cam.y = M.height / 2; R.cam.scale = s;
    R._paperPat = null;                    // 纸纹按新画布重做，别把主画布的 pattern 搬过来
    try {
      R._renderBase();
    } catch (e) {
      if (root.console) console.warn('快照失败：' + (e && e.message));
    } finally {
      R.base = save.base; R.baseCtx = save.baseCtx; R.dpr = save.dpr;
      R.cssW = save.cssW; R.cssH = save.cssH; R.viewMode = save.view;
      R.cam.x = save.cam.x; R.cam.y = save.cam.y; R.cam.scale = save.cam.scale;
      R._paperPat = save.paper;
    }
    return cv;
  }

  var VIEWS = [
    { mode: 'political', cn: '政治 · 疆域' },
    { mode: 'terrain',   cn: '地形 · 山川' },
    { mode: 'faith',     cn: '信仰 · 教化' }
  ];

  function ensureShots(force) {
    var world = B.world();
    if (!world || !B.renderer || !B.renderer()) return null;
    if (!force && SHOTS && SHOTW === world) return SHOTS;
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    SHOTS = {};
    for (var i = 0; i < VIEWS.length; i++) {
      SHOTS[VIEWS[i].mode] = snapWorld(VIEWS[i].mode, 460, 300, dpr);
    }
    SHOTW = world;
    return SHOTS;
  }

  /* 一张快照：定稿后优先用"盖章那一刻"存下来的那张，否则现算。
   * 存档里的快照是 dataURL，第一次取时建一个 Image 缓存起来（onload 再刷一次页面）。 */
  function shotOf(mode) {
    if (FINAL) {
      if (FINAL.cvs && FINAL.cvs[mode]) return FINAL.cvs[mode];
      if (FINAL.imgs && FINAL.imgs[mode]) {
        var im0 = FINAL.imgs[mode];
        return im0.complete ? im0 : null;
      }
      var u = FINAL.shots && FINAL.shots[mode];
      if (typeof u === 'string' && root.Image) {
        var im = new root.Image();
        im.onload = function () { if (OPEN) render(); };
        im.src = u;
        FINAL.imgs = FINAL.imgs || {};
        FINAL.imgs[mode] = im;
        return null;
      }
      return (u && u.tagName) ? u : null;
    }
    var s = ensureShots();
    return s ? s[mode] : null;
  }

  /* =============================================================
   * ⑤ 史书页 DOM
   * ============================================================= */
  var built = false, OPEN = false;

  function ensureDOM() {
    if (built) return;
    var d = doc();
    if (!d || !d.body) return;
    var el = d.createElement('div');
    el.id = 'chrono';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '编年史');
    el.innerHTML =
      '<div id="chFrame" aria-hidden="true"></div>' +
      '<div id="chScroll"><div id="chPage">' +
        '<header id="chHead">' +
          '<span id="chFlag"></span>' +
          '<div class="chn"><b id="chName"></b><i id="chNameEn"></i></div>' +
          '<div class="chsub" id="chSub"></div>' +
          '<button id="chTurn" type="button" class="primary" title="结算本回合，进入下一回合">下一回合 ▸</button>' +
          '<button id="chClose" type="button" title="关闭（ESC）">×</button>' +
        '</header>' +
        '<div id="chMark"></div>' +
        '<section class="chsec" id="chSecMaps"><h3>疆 域 三 图</h3><div class="chmaps" id="chMaps"></div></section>' +
        '<section class="chsec" id="chSecYear"><h3>编 年</h3><div class="chyears" id="chYears"></div></section>' +
        '<section class="chsec" id="chSecData"><h3>终 局 度 支</h3><div class="chkv" id="chData"></div></section>' +
        '<section class="chsec" id="chSecTitle"><h3>史 官 曰</h3><div class="chtitles" id="chTitles"></div></section>' +
        '<div class="chend">— 山 河 纪 · 编 年 史 —</div>' +
      '</div></div>' +
      '<div id="chFoot">' +
        '<button id="chPng" class="primary" type="button" title="把这一页重新排成一张竖版长卷（离屏 canvas 重绘，不是截屏）">导出 PNG</button>' +
        '<button id="chSeed" class="ghost" type="button" title="复制这个世界的种子码，发给朋友就能开同一局">复制种子码</button>' +
        '<button id="chFinal" class="ghost" type="button" title="给这一刻盖个章：快照最终数据 + 三图 + 称号。之后仍可继续经营，再点一次刷新">定稿</button>' +
        '<span id="chHint"></span>' +
      '</div>' +
      '<div id="chZoom" title="点击关闭"><canvas id="chZoomCv"></canvas></div>';
    d.body.appendChild(el);
    built = true;

    $('chClose').addEventListener('click', close);
    /* 书里也能走回合（v17）：全屏 z=44，把右上角那颗主线钮整个盖住了。
     * 走完立刻重画 —— 年表多一行、终局度支变数、三张图可能换了疆域。
     * 三张快照是按 world **对象**认缓存的，走回合不换对象，所以先手动丢缓存，
     * 不然点完还是旧疆域（真机上看不出来，但对拍图的人就是 bug）。 */
    $('chTurn').addEventListener('click', function () {
      if (!AO.resNextTurn) return;
      var sc = $('chScroll'), keep = sc ? sc.scrollTop : 0;
      SHOTS = null; SHOTW = null;
      AO.resNextTurn();
      if (!OPEN) return;                 // 回合结算里若把书关了（读档/终局）就到此为止
      render();
      if (sc) sc.scrollTop = keep;       // 别把正在读的那一年弹回卷首
    });
    $('chFoot').addEventListener('click', function (e) {
      var b = e.target;
      if (!b || !b.id) return;
      if (b.id === 'chPng') exportPNG();
      else if (b.id === 'chSeed') copySeed();
      else if (b.id === 'chFinal') finalize();
    });
    $('chMaps').addEventListener('click', function (e) {
      var fig = e.target && e.target.closest ? e.target.closest('figure') : null;
      if (fig) zoom(fig.getAttribute('data-mode'));
    });
    $('chYears').addEventListener('click', function (e) {
      var b = e.target;
      if (!b || !b.classList || !b.classList.contains('chmore')) return;
      /* 先取祖先再摘按钮：按钮一离开 DOM，closest 就找不回这一节了 */
      var sec = b.closest ? b.closest('.chy') : null;
      if (sec) sec.classList.remove('cut');
      if (b.parentNode) b.parentNode.removeChild(b);
    });
    $('chZoom').addEventListener('click', function () { $('chZoom').classList.remove('on'); });
  }

  function open(mode) {
    if (!B || !B.world()) { if (B && B.toast) B.toast('还没有世界', 1800); return false; }
    ensureDOM();
    if (!built) return false;
    var el = $('chrono');
    /* DOM 可能被别的东西清掉（换世界 / 外部脚本动了 body）：
     * built 是缓存，不能当证据 —— 找不到就重建一次，别在这里炸。 */
    if (!el) { built = false; ensureDOM(); el = $('chrono'); if (!el) return false; }
    OPEN = true;
    el.classList.toggle('on', true);
    el.classList.toggle('dead', mode === 'dead');
    if (doc().body) doc().body.classList.add('chrono-open');
    render();
    var sc = $('chScroll');
    if (sc) sc.scrollTop = 0;
    return true;
  }

  function close() {
    OPEN = false;
    var el = $('chrono');
    if (el) el.classList.remove('on');
    var z = $('chZoom');
    if (z) z.classList.remove('on');
    if (doc() && doc().body) doc().body.classList.remove('chrono-open');
  }

  function zoom(mode) {
    var v = null, i;
    for (i = 0; i < VIEWS.length; i++) if (VIEWS[i].mode === mode) v = VIEWS[i];
    if (!v) return;
    var shot = shotOf(mode);
    var cv = $('chZoomCv');
    if (!cv) return;
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    var W = Math.min(1180, Math.round((root.innerWidth || 1200) * 0.86));
    var H = Math.round(W * 0.62);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#f6f0e2';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (shot && (shot.tagName === 'CANVAS' || shot.tagName === 'IMG')) {
      ctx.drawImage(shot, 0, 0, cv.width, cv.height);
    }
    $('chZoom').classList.add('on');
  }

  /* ---------- 渲染 ---------- */
  function yearsUpTo() {
    return FINAL ? FINAL.turn : (B.turn() | 0);
  }

  function renderMaps(d) {
    var box = $('chMaps');
    if (!box) return;
    var h = '';
    for (var i = 0; i < VIEWS.length; i++) {
      var v = VIEWS[i];
      h += '<figure data-mode="' + v.mode + '" title="点击放大">' +
        '<canvas width="920" height="600"></canvas>' +
        '<figcaption>' + esc(v.cn) + (FINAL ? '<em>定稿时</em>' : '') + '</figcaption></figure>';
    }
    box.innerHTML = h;
    var figs = box.querySelectorAll('figure');
    for (i = 0; i < figs.length; i++) {
      var cv = figs[i].querySelector('canvas');
      var src = shotOf(figs[i].getAttribute('data-mode'));
      if (src) cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    }
  }

  function renderYears(limit) {
    var box = $('chYears');
    if (!box) return;
    /* 只画有内容的年份；中间的空白年份压成一行"史册无记"——
     * 留白也是排版，一年一条空标题只会把书读成表格。 */
    var rows = [], i, j, gapFrom = 0;
    for (i = 0; i < YL.length; i++) {
      var rec = YL[i];
      if (rec.turn > limit) break;
      if (!rec.entries.length) continue;
      if (gapFrom && rec.turn - gapFrom > 1) rows.push({ gap: [gapFrom + 1, rec.turn - 1] });
      gapFrom = rec.turn;
      rows.push({ rec: rec });
    }
    if (gapFrom && gapFrom < limit) rows.push({ gap: [gapFrom + 1, limit] });
    if (!rows.length) {
      box.innerHTML = '<div class="chempty">史册尚空。回合走过一年，这里就多一行字。</div>';
      return;
    }
    var h = '';
    for (i = 0; i < rows.length; i++) {
      if (rows[i].gap) {
        var g = rows[i].gap;
        h += '<div class="chgap">' + (g[0] === g[1] ? '第 ' + g[0] + ' 年' :
          '第 ' + g[0] + ' — ' + g[1] + ' 年') + ' · 史册无记</div>';
        continue;
      }
      var r = rows[i].rec;
      h += '<section class="chy"><h4><span>第 ' + r.turn + ' 年</span>' +
        '<em>' + (r.entries.length > 1 ? r.entries.length + ' 条' : '') + '</em></h4><ul>';
      /* 一年条目太多就折起来（史书也不是流水账）：前 14 条照排，其余等「展卷」 */
      var cut = r.entries.length > 14;
      for (j = 0; j < r.entries.length; j++) {
        var e = r.entries[j];
        var tag = e.tag || '';
        var cls = 'ent t-' + (tag || 'plain') + (MILESTONE[tag] ? ' ms' : '') +
          (cut && j >= 14 ? ' fold' : '');
        h += '<li class="' + cls + '"><i class="mk">' + (TAG_SYM[tag] || '') + '</i>' +
          '<p>' + esc(e.text) + '</p></li>';
      }
      h += '</ul>';
      if (cut) {
        h += '<div class="chcut"><button type="button" class="chmore">展卷（余 ' +
          (r.entries.length - 14) + ' 条）</button></div>';
      }
      h += '</section>';
    }
    box.innerHTML = h;
    var secs = box.querySelectorAll('.chy');
    for (i = 0; i < secs.length; i++) {
      if (secs[i].querySelector('.chmore')) secs[i].classList.add('cut');
    }
  }

  function renderData(d) {
    var box = $('chData');
    if (!box) return;
    var rows = [
      ['在位', (AO.calOf ? AO.calOf(d.turn).year : d.turn) + ' 年（' + d.turn + ' 回合）'],
      ['疆域', d.provN + ' 省 · ' + d.areaPct.toFixed(1) + '%'],
      ['人口', AO.formatPop ? AO.formatPop(Math.round(d.pop)) : num(d.pop)],
      ['国库存金', num(d.gold) + ' 金'],
      ['教育', num(d.edu) + '（' + d.eduSchool + ' 校 · ' + d.eduPts + ' 才）'],
      ['科技', d.techN + ' / ' + d.techTotal],
      ['常备军', num(d.armyMen) + ' 人'],
      ['民心', d.happy.toFixed(1)],
      ['战事', d.warN + ' 场 · 战报 ' + d.logN + ' 条'],
      ['占领', d.occN + ' 省']
    ];
    var h = '';
    for (var i = 0; i < rows.length; i++) {
      h += '<div class="kv"><span>' + rows[i][0] + '</span><b>' + esc(rows[i][1]) + '</b></div>';
    }
    box.innerHTML = h;
  }

  /* 印章：朱红圆章 + 篆味方字，全程序画（不用素材图）。
   * DOM 里每枚是一张小 canvas，PNG 里直接画到长卷上（同一个 drawSeal）。 */
  function drawSeal(ctx, cx, cy, r, txt, seed) {
    var chars = String(txt || '').split(''), i;
    ctx.save();
    /* 章面：两色径向 + 一点斑驳，别让它像个按钮 */
    var g = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.38, r * 0.12, cx, cy, r * 1.02);
    g.addColorStop(0, '#bb4b3c');
    g.addColorStop(0.62, '#a8382b');
    g.addColorStop(1, '#8e2a20');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    /* 内圈细线（朱文印的那一圈留白） */
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(250,244,232,0.62)';
    ctx.lineWidth = Math.max(1, r * 0.042);
    ctx.stroke();
    /* 字：2 字竖排，3 字竖排（字号缩），4 字 2×2 */
    ctx.fillStyle = '#fbf4e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var fam = '"Songti SC","STSong","SimSun","Noto Serif SC",serif';
    if (chars.length >= 4) {
      var fs4 = r * 0.56;
      ctx.font = '700 ' + fs4 + 'px ' + fam;
      var pts = [[-0.29, -0.29], [0.29, -0.29], [-0.29, 0.29], [0.29, 0.29]];
      for (i = 0; i < 4; i++) {
        ctx.fillText(chars[i], cx + r * pts[i][0], cy + r * pts[i][1]);
      }
    } else {
      var n = chars.length || 1;
      var fs = r * (n === 1 ? 0.96 : n === 2 ? 0.66 : 0.52);
      ctx.font = '700 ' + fs + 'px ' + fam;
      var step = n > 1 ? (r * 0.86) / (n - 0.02) : 0;
      var top = cy - step * (n - 1) / 2;
      for (i = 0; i < n; i++) ctx.fillText(chars[i], cx, top + step * i);
    }
    /* 斑驳：固定种子撒几粒纸色小点（同字同斑，重绘不变） */
    var sd = (seed || 7) | 0;
    function rnd() { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; }
    ctx.fillStyle = 'rgba(247,240,227,0.5)';
    for (i = 0; i < 26; i++) {
      var ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * r * 0.94;
      var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
      ctx.globalAlpha = 0.10 + rnd() * 0.22;
      ctx.beginPath();
      ctx.arc(px, py, r * (0.014 + rnd() * 0.028), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  AO.chronoDrawSeal = drawSeal;

  function renderTitles(titles) {
    var box = $('chTitles');
    if (!box) return;
    if (!titles || !titles.length) {
      box.innerHTML = '<div class="chempty">尚未定稿。任一时刻按下「定稿」，史官便据此盖印。</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < titles.length; i++) {
      h += '<figure class="chseal" data-i="' + i + '"><canvas width="132" height="132"></canvas>' +
        '<figcaption><b>' + esc(titles[i].cn) + '</b><em>' + esc(titles[i].note) + '</em></figcaption></figure>';
    }
    box.innerHTML = h;
    var figs = box.querySelectorAll('.chseal');
    for (i = 0; i < figs.length; i++) {
      var cv = figs[i].querySelector('canvas');
      var ctx = cv.getContext('2d');
      var s = 132;
      drawSeal(ctx, s / 2, s / 2, s * 0.45, titles[i].cn, 11 + i * 37);
    }
  }

  function render() {
    if (!built || !B || !B.world()) return;
    var d = curData();
    var el = $('chrono');
    $('chFlag').style.background = d.color;
    $('chName').textContent = d.name;
    $('chNameEn').textContent = d.nameEn || '';
    var lead = [d.leaderTitle, d.leader].filter(Boolean).join(' ');
    $('chSub').innerHTML =
      (lead ? '<span>' + esc(lead) + '</span>' : '') +
      '<em>始于第 1 年 · 终于第 ' + d.turn + ' 年</em>' +
      (B.player() ? '' : '<i>（未选国：以疆域最广者为记）</i>');
    var mk = $('chMark');
    if (FINAL) {
      var seals = '', ti;
      for (ti = 0; ti < FINAL.titles.length; ti++) {
        seals += '<canvas class="chtopseal" width="112" height="112"></canvas>';
      }
      mk.innerHTML = '<span class="sig">定稿于第 ' + FINAL.turn + ' 年 · ' +
        new Date(FINAL.ts || Date.now()).toLocaleDateString('zh-CN') + '</span>' +
        '<span class="chtopseals">' + seals + '</span>' +
        (B.turn() > FINAL.turn ? '<span class="later">此后仍在经营，至今第 ' + B.turn() + ' 年</span>' : '');
      mk.classList.add('on');
      var tcv = mk.querySelectorAll('.chtopseal');
      for (ti = 0; ti < tcv.length; ti++) {
        drawSeal(tcv[ti].getContext('2d'), 56, 56, 48, FINAL.titles[ti].cn, 11 + ti * 37);
      }
    } else {
      mk.innerHTML = '';
      mk.classList.remove('on');
    }
    renderMaps(d);
    renderYears(yearsUpTo());
    renderData(d);
    renderTitles(FINAL ? FINAL.titles : null);
    var fin = $('chFinal');
    if (fin) fin.textContent = FINAL ? '重新定稿' : '定稿';
    var hint = $('chHint');
    if (hint) {
      hint.textContent = FINAL ? '' : '定稿只给这一刻盖章 —— 之后照样能继续经营，再定一次就刷新。';
    }
  }

  /* 定稿后所有"数字"都取冻结的那一份；没定稿就现场读。 */
  function curData() {
    if (FINAL && FINAL.data) return FINAL.data;
    return dataOf(subject());
  }

  /* ---------- 定稿 ---------- */
  /* 存进存档的那一份缩到 460×300：屏幕上那张是 920×600（清晰），
   * 存档里只要"认得出来"就够 —— 一张 JPEG 从 ~120KB 降到 ~35KB。 */
  function shrink(cv, w, h) {
    var d = doc();
    if (!d) return null;
    var out = d.createElement('canvas');
    out.width = w; out.height = h;
    try { out.getContext('2d').drawImage(cv, 0, 0, w, h); }
    catch (e) { return null; }
    return out;
  }

  function finalize() {
    if (!B || !B.world()) return null;
    var d = dataOf(subject());
    var shots = ensureShots(true) || {};
    /* 三图双份：canvas 留着本会话直接画；dataURL 存进存档，这样"定稿之后
     * 再打二十回合"，翻开史书看到的仍是**盖章那一刻**的疆域。
     * 压成 jpeg 0.68 的 460×300，三张 ~100KB，相对 1.8MB 的存档可以接受。 */
    var cvs = {}, pack = {}, i, m, sz = 0;
    for (i = 0; i < VIEWS.length; i++) {
      m = VIEWS[i].mode;
      if (!shots[m]) continue;
      cvs[m] = shots[m];
      var small = shrink(shots[m], 460, 300);
      if (!small) continue;
      try {
        var url = small.toDataURL('image/jpeg', 0.68);
        if (url && url.length < 120000) { pack[m] = url; sz += url.length; }
      } catch (e) { /* 画布被污染（理论上不会）：跳过 */ }
    }
    FINAL = {
      turn: d.turn,
      ts: Date.now(),
      data: d,
      titles: pickTitles(d),
      shots: sz < 400000 ? pack : {},
      cvs: cvs,
      imgs: {}
    };
    render();
    if (B.toast) {
      B.toast('定稿：第 ' + FINAL.turn + ' 年 · ' + FINAL.titles.map(function (t) { return t.cn; }).join(' · '),
        3600);
    }
    return FINAL;
  }

  /* =============================================================
   * ⑥ 导出 PNG —— 竖版长卷
   *
   * 不是"截屏"：同一套数据重新排一遍版（drawChronicle），所以
   * 字号、留白、图廓都是为输出尺寸定的，1200 宽下字字清楚。
   * 两遍走：第一遍在 1px 画布上只量不画，得到总高；第二遍真画。
   * ============================================================= */
  var FAM = '"Songti SC","STSong","SimSun","Noto Serif SC",Georgia,serif';
  var SANS = '-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
  var INK = '#2a2f34';
  var INK2 = '#6b6257';
  var RED = '#a8382b';

  function wrapText(ctx, text, maxW) {
    var out = [], line = '', i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch === '\n') { out.push(line); line = ''; continue; }
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    if (line) out.push(line);
    return out;
  }

  function seedToInt(s) {
    var h = 2166136261, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  /* 长卷排版：dry=true 时只推进 y、不落笔（用 1px 画布量高度）。 */
  function drawChronicle(ctx, W, dry) {
    var d = curData();
    var seed = B.seed ? String(B.seed() || '') : '';
    var M = 64, cw = W - M * 2;
    var y = 0;

    function font(str) { ctx.font = str; }
    function txt(str, x, yy, f, color, align) {
      font(f);
      if (dry) return;
      ctx.fillStyle = color || INK;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, yy);
    }
    function rule(x1, y1, x2, y2, color, w) {
      if (dry) return;
      ctx.strokeStyle = color; ctx.lineWidth = w || 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    /* ---- 抬头 ---- */
    y = 96;
    font('600 26px ' + FAM);
    txt('山 河 纪 · 编 年 史', W / 2, y, '600 26px ' + FAM, INK, 'center');
    y += 20;
    txt('C H R O N I C L E', W / 2, y, '400 11px ' + SANS, '#a29a8c', 'center');
    y += 26;
    rule(M, y, W - M, y, 'rgba(42,47,52,.42)', 1.4);
    y += 4;
    rule(M, y + 3, W - M, y + 3, 'rgba(42,47,52,.20)', 1);
    y += 54;

    /* ---- 标题区：旗色 + 国名 + 领袖 + 起讫 ---- */
    var flagY = y - 34;
    if (!dry) {
      ctx.fillStyle = d.color;
      ctx.fillRect(M, flagY, 46, 46);
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(M + .5, flagY + .5, 45, 45);
    }
    txt(d.name, M + 64, y, '700 42px ' + FAM, INK);
    y += 26;
    if (d.nameEn) txt(d.nameEn, M + 64, y, 'italic 400 15px ' + SANS, '#8b8272');
    y += 30;
    var lead = [d.leaderTitle, d.leader].filter(Boolean).join(' ');
    txt((lead ? lead + '　·　' : '') + (d.gov ? d.gov + '　·　' : '') +
      '始于第 1 年 · 终于第 ' + d.turn + ' 年',
      M + 64, y, '400 16px ' + SANS, INK2);
    y += 22;
    if (FINAL) {
      txt('定稿于第 ' + FINAL.turn + ' 年 · ' +
        new Date(FINAL.ts || Date.now()).toLocaleDateString('zh-CN'),
        M + 64, y, '400 13px ' + SANS, RED);
      y += 18;
    }
    y += 26;

    /* ---- 三图 ---- */
    var gap = 26, tw = Math.floor((cw - gap * 2) / 3), th = Math.round(tw * 300 / 460);
    for (var vi = 0; vi < VIEWS.length; vi++) {
      var v = VIEWS[vi], x = M + vi * (tw + gap);
      var src = shotOf(v.mode);
      if (!dry) {
        if (src && (src.tagName === 'CANVAS' || src.tagName === 'IMG')) ctx.drawImage(src, x, y, tw, th);
        else { ctx.fillStyle = '#ece3d0'; ctx.fillRect(x, y, tw, th); }
        ctx.strokeStyle = 'rgba(42,47,52,.30)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, tw - 1, th - 1);
      }
      txt(v.cn, x + tw / 2, y + th + 20, '400 12px ' + SANS, '#8b8272', 'center');
    }
    y += th + 40;
    rule(M, y, W - M, y, 'rgba(42,47,52,.18)', 1);
    y += 44;

    /* ---- 年表 ---- */
    txt('编 年', M, y, '700 22px ' + FAM, INK);
    y += 30;
    var limit = FINAL ? FINAL.turn : (B.turn() | 0);
    /* grp 必须**声明**：本文件是 'use strict'，下面那句 `grp = years[i]` 是
     * 给未声明标识符赋值 —— 一进循环就 ReferenceError（"grp is not defined"），
     * 表现是"编年史里只要有年表，导出长卷就崩"。年表为空时循环不执行，
     * 所以这个坑在空局里看不出来（本批就是这么撞上的）。 */
    var years = yearsOf(limit), i, j, rec, e, grp;
    /* 全量太长：只取带 tag 的条目 + 每年首条（史书本来就是"择要而书"） */
    var budget = 170, used = 0;
    var lineH = 27;
    for (i = 0; i < years.length && used < budget; i++) {
      grp = years[i];
      y += 34;                              // 年与年之间留一口气
      txt('第 ' + grp.year + ' 年', M, y, '700 17px ' + FAM, '#3c4147');
      y += 30;                              // 标题基线 → 第一条基线
      var shown = 0;
      for (var g = 0; g < grp.recs.length && used < budget; g++) {
        rec = grp.recs[g];
        for (j = 0; j < rec.entries.length && used < budget; j++) {
          e = rec.entries[j];
          var keep = !!e.tag || shown === 0;
          if (!keep) continue;
          var ef = '400 14px ' + SANS;
          /* 里程碑带年月小字（"十年七月"式）：哪一年做的事转眼就忘，
           * 但"那年七月打的那一仗"记得住 —— 年月是史书里最便宜的锚点。 */
          var body = e.text;
          if (e.tag && AO.calTag) body = AO.calTag(rec.turn) + ' · ' + body;
          font(ef);                             // 量宽之前必须先把字号设上（dry 也一样）
          var lines = wrapText(ctx, body, cw - 26);
          if (lines.length > 4) lines = lines.slice(0, 4);
          for (var k = 0; k < lines.length; k++) {
            txt(lines[k], M + 26, y + k * lineH, ef,
              e.tag && MILESTONE[e.tag] ? INK : INK2);
          }
          if (!dry && e.tag && MILESTONE[e.tag]) {
            ctx.fillStyle = RED;
            ctx.beginPath();
            ctx.arc(M + 9, y - 5, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
          y += lineH * lines.length;
          shown++; used++;
        }
      }
      if (!shown) y += 2;
    }
    if (!years.length) {
      txt('史册尚空。', M + 26, y + 20, '400 14px ' + SANS, INK2);
      y += 40;
    } else if (used >= budget) {
      txt('…… 其后诸年，另存别卷。', M + 26, y + 22, '400 13px ' + SANS, '#9a9184');
      y += 34;
    }
    y += 18;
    rule(M, y, W - M, y, 'rgba(42,47,52,.18)', 1);
    y += 44;

    /* ---- 终局度支：两列 kv ---- */
    txt('终 局 度 支', M, y, '700 22px ' + FAM, INK);
    y += 28;
    var rows = [
      ['在位', (AO.calOf ? AO.calOf(d.turn).year : d.turn) + ' 年（' + d.turn + ' 回合）'],
      ['疆域', d.provN + ' 省 · ' + d.areaPct.toFixed(1) + '%'],
      ['人口', AO.formatPop ? AO.formatPop(Math.round(d.pop)) : num(d.pop)],
      ['国库存金', num(d.gold) + ' 金'],
      ['教育', num(d.edu) + '（' + d.eduSchool + ' 校 · ' + d.eduPts + ' 才）'],
      ['科技', d.techN + ' / ' + d.techTotal],
      ['常备军', num(d.armyMen) + ' 人'],
      ['民心', d.happy.toFixed(1)],
      ['战事', d.warN + ' 场 · 战报 ' + d.logN + ' 条'],
      ['占领', d.occN + ' 省']
    ];
    var colW = (cw - 40) / 2, rowH = 30;
    for (i = 0; i < rows.length; i++) {
      var cx = M + (i % 2) * (colW + 40), cy = y + Math.floor(i / 2) * rowH;
      txt(rows[i][0], cx, cy + 18, '400 13px ' + SANS, '#8b8272');
      txt(rows[i][1], cx + colW - 8, cy + 18, '600 15px ' + SANS, INK, 'right');
      rule(cx, cy + 24, cx + colW - 8, cy + 24, 'rgba(42,47,52,.10)', 1);
    }
    y += Math.ceil(rows.length / 2) * rowH + 26;
    rule(M, y, W - M, y, 'rgba(42,47,52,.18)', 1);
    y += 46;

    /* ---- 称号：红印 ---- */
    var titles = FINAL ? FINAL.titles : null;
    txt('史 官 曰', M, y, '700 22px ' + FAM, INK);
    y += 34;
    if (titles && titles.length) {
      var r = 46, step = Math.min(190, cw / titles.length);
      var startX = M + step / 2;
      for (i = 0; i < titles.length; i++) {
        var sx = startX + i * step;
        if (!dry) drawSeal(ctx, sx, y + r, r, titles[i].cn, 11 + i * 37);
        txt(titles[i].note || '', sx, y + r * 2 + 22, '400 12px ' + SANS, '#8b8272', 'center');
      }
      y += r * 2 + 44;
      var line = titles.map(function (t) { return t.cn; }).join(' · ');
      txt('谥曰：' + line, W / 2, y, '400 16px ' + FAM, RED, 'center');
      y += 30;
    } else {
      txt('未定稿 —— 此刻尚无谥号。', M, y + 8, '400 14px ' + SANS, INK2);
      y += 46;
    }

    /* ---- 落款 ---- */
    y += 20;
    rule(M, y, W - M, y, 'rgba(42,47,52,.32)', 1.2);
    y += 26;
    var dt = new Date();
    var ds = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' +
      ('0' + dt.getDate()).slice(-2);
    txt('种子码 ' + (seed || '—'), M, y, '400 12px ' + SANS, '#8b8272');
    txt('山河纪 · 导出 ' + ds, W - M, y, '400 12px ' + SANS, '#8b8272', 'right');
    y += 46;
    return y;
  }

  /* 纸底 + 双线图廓：和地图 / 科技树同一套描边，只是换成竖版长卷。 */
  function paintPaper(ctx, W, H, seed) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#fdfaf3');
    g.addColorStop(0.5, '#faf5e9');
    g.addColorStop(1, '#f3ebda');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    /* 纤维：固定种子，导出两次是同一张纸 */
    var sd = seedToInt(seed) | 1;
    function rnd() { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; }
    var i;
    for (i = 0; i < 380; i++) {
      ctx.globalAlpha = 0.05 + rnd() * 0.07;
      ctx.fillStyle = rnd() > 0.5 ? '#8f7f63' : '#fffdf6';
      var w = 6 + rnd() * 60;
      ctx.fillRect(rnd() * W, rnd() * H, w, 1);
    }
    ctx.globalAlpha = 1;
    /* 双线图廓 */
    ctx.strokeStyle = 'rgba(32,42,52,.46)';
    ctx.lineWidth = 2;
    ctx.strokeRect(26.5, 26.5, W - 53, H - 53);
    ctx.strokeStyle = 'rgba(32,42,52,.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(31.5, 31.5, W - 63, H - 63);
  }

  AO.chronoBuildPNG = function (W) {
    if (!B || !B.world()) return null;
    var d = doc();
    if (!d) return null;
    if (!FINAL) ensureShots();               // 没打开过面板也能导：现算三图
    W = Math.max(900, Math.round(W || 1200));
    var scratch = d.createElement('canvas');
    scratch.width = W; scratch.height = 8;
    var mctx = scratch.getContext('2d');
    mctx.fillStyle = '#fff';
    var H = Math.ceil(drawChronicle(mctx, W, true)) + 8;
    var cv = d.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    paintPaper(ctx, W, H, B.seed ? B.seed() : '');
    drawChronicle(ctx, W, false);
    return cv;
  };

  function exportPNG() {
    var cv = AO.chronoBuildPNG(1200);
    if (!cv) { if (B && B.toast) B.toast('还没有世界，导不出', 2000); return null; }
    var name = 'chronicle-' + (B.seed ? String(B.seed()).replace(/[^\w.-]+/g, '_') : 'world') +
      '-y' + (FINAL ? FINAL.turn : B.turn()) + '.png';
    var url;
    try { url = cv.toDataURL('image/png'); }
    catch (e) { if (B && B.toast) B.toast('导出失败：' + e.message, 2600); return null; }
    var a = doc().createElement('a');
    a.href = url;
    a.download = name;
    doc().body.appendChild(a);
    a.click();
    doc().body.removeChild(a);
    if (B && B.toast) B.toast('已导出 ' + name + '（' + cv.width + '×' + cv.height + '）', 3200);
    return { canvas: cv, url: url, name: name };
  }
  AO.chronoExport = exportPNG;

  /* ---------- 复制种子码 ----------
   * file:// 下 clipboard API 常被禁；三级退路：
   *   navigator.clipboard → 隐藏 textarea + execCommand → 原生 prompt 手动复制 */
  function execCopy(s) {
    var d = doc();
    if (!d || !d.execCommand) return false;
    var ta = d.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    d.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = d.execCommand('copy'); } catch (e) { ok = false; }
    d.body.removeChild(ta);
    return ok;
  }
  function manualCopy(s) {
    try {
      if (root.prompt) root.prompt('复制这个种子码（Ctrl+C / ⌘C）', s);
    } catch (e) { /* 忽略 */ }
  }
  function copySeed() {
    var s = B && B.seed ? String(B.seed() || '') : '';
    if (!s) { if (B && B.toast) B.toast('还没有种子码', 1800); return false; }
    var nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      try {
        nav.clipboard.writeText(s).then(function () {
          if (B && B.toast) B.toast('种子码已复制：' + s, 2400);
        }, function () {
          if (execCopy(s)) { if (B && B.toast) B.toast('种子码已复制：' + s, 2400); }
          else manualCopy(s);
        });
        return true;
      } catch (e) { /* 落到下一级 */ }
    }
    if (execCopy(s)) { if (B && B.toast) B.toast('种子码已复制：' + s, 2400); return true; }
    manualCopy(s);
    return false;
  }
  AO.chronoCopySeed = copySeed;

  /* =============================================================
   * ⑦ 自动触发 / 存档
   * ============================================================= */
  function check() {
    if (!B || !B.world()) return null;
    var cid = B.player() || 0;
    if (!cid) return null;
    var world = B.world();
    var c = world.countries[cid - 1];
    if (!c) return null;
    var own = 0, live = 0, i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p) continue;
      if (p.owner > 0) live++;
      if (p.owner === cid) own++;
    }
    var mode = null;
    if (!own && !FLAGS.dead) {
      FLAGS.dead = 1;
      B.notes().push({ owner: cid, cls: 'bad', text: '💀 亡国：' + c.name + ' 一省不剩，社稷倾覆' });
      mode = 'dead';
    } else if (own && live && own === live && !FLAGS.unified) {
      FLAGS.unified = 1;
      B.notes().push({ owner: cid, cls: 'ok', text: '⚑ 天下归一：四海之内，尽归' + c.name });
      mode = 'unified';
    }
    if (!mode) return null;
    archive();                              // 把刚推的那一条也收进本年年表
    /* 事件弹窗正开着：回合还没处置完，等 evtRefresh 再弹 */
    if (AO.evtPending && AO.evtPending()) { PENDING = mode; return mode; }
    open(mode);
    return mode;
  }

  /* 结算尾的钩子：归档 + 判胜负。11-ui.js 只在 settleTurn 末尾调这一行。 */
  AO.chronoArchive = function () {
    if (!B) return 0;
    var n = archive();
    check();                                // 统一 / 灭亡：推一条 NOTES 并自动弹史书
    return n;
  };
  /* 只归档、不判胜负：下一回合开头清 NOTES 之前调用（玩家操作也会推纪要） */
  AO.chronoArchiveNotes = function () { return B ? archive() : 0; };
  AO.chronoCheck = function () { return check(); };
  AO.chronoCheck = function () {
    var had = PENDING;
    var mode = check();
    if (had && OPEN) { /* 已经开着了，不重复弹 */ }
    return mode;
  };
  /* 事件弹窗关掉之后补弹（11-ui 的 evtRefresh 末尾调） */
  AO.chronoFlushPending = function () {
    if (!PENDING) return false;
    var m = PENDING;
    PENDING = null;
    return open(m);
  };

  AO.chronoOpen = function (mode) { return open(mode); };
  AO.chronoClose = close;
  AO.chronoIsOpen = function () { return OPEN; };
  AO.chronoRefresh = function () { if (OPEN) render(); };
  AO.chronoFinalize = finalize;
  AO.chronoFinal = function () { return FINAL; };
  AO.chronoYearLog = function () { return YL; };
  AO.chronoFlags = function () { return FLAGS; };

  /* 换世界：年表 / 定稿 / 首都快照全部作废（和 SIM / WARLOG 同一条规矩） */
  AO.chronoReset = function () {
    YL.length = 0;
    FLAGS.unified = 0; FLAGS.dead = 0;
    FINAL = null; PENDING = null;
    CAPW = null; CAP = null;
    SHOTS = null; SHOTW = null;
    close();
  };

  /* 存档：只存"数据"，不存 DOM。三张快照是 dataURL 字符串，JSON 原样进出；
   * cvs / imgs 是会话内的活对象，绝不能进 JSON（否则一存 5MB）。 */
  AO.chronoState = function () {
    var fin = null;
    if (FINAL) {
      fin = { turn: FINAL.turn, ts: FINAL.ts, data: FINAL.data, titles: FINAL.titles, shots: FINAL.shots };
    }
    return { YEARLOG: YL, FINAL: fin, FLAGS: { unified: FLAGS.unified ? 1 : 0, dead: FLAGS.dead ? 1 : 0 } };
  };
  AO.chronoLoad = function (d) {
    YL.length = 0;
    FLAGS.unified = 0; FLAGS.dead = 0;
    FINAL = null; PENDING = null;
    CAPW = null; CAP = null;
    SHOTS = null; SHOTW = null;
    if (!d) return;                          // 旧档（v4-）：空年表，不炸
    if (d.YEARLOG && d.YEARLOG.length) {
      for (var i = 0; i < d.YEARLOG.length; i++) {
        var rec = d.YEARLOG[i];
        if (!rec || !(rec.turn >= 0)) continue;
        YL.push({ turn: rec.turn | 0, entries: (rec.entries || []).slice() });
      }
      YL.sort(function (a, b) { return a.turn - b.turn; });
    }
    if (d.FLAGS) {
      FLAGS.unified = d.FLAGS.unified ? 1 : 0;
      FLAGS.dead = d.FLAGS.dead ? 1 : 0;
    }
    if (d.FINAL && d.FINAL.data) {
      FINAL = d.FINAL;
      if (!FINAL.titles || !FINAL.titles.length) FINAL.titles = pickTitles(FINAL.data);
      if (!FINAL.shots) FINAL.shots = {};
      FINAL.cvs = {}; FINAL.imgs = {};
    }
  };

  /* 桥：11-ui.js 在 evtBoot 旁边调一次，递进来的都是**取值器 / 活对象**。
   * 为什么不在文件加载时就抓：11-ui 的 IIFE 还没跑完，那些变量都是 undefined。 */
  AO.chronoInit = function (bridge) {
    B = bridge;
    built = false;
    OPEN = false;
    /* 换世界之后 DOM 还在，只是内容要重画 —— 所以 built 保持 */
    if ($('chrono')) built = true;
  };

  AO.chronoBooted = function () { return !!B; };
})(typeof window !== 'undefined' ? window : globalThis);
