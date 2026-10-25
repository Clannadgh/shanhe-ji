/* =============================================================
 * 11-ui.js —— 面板、导出、涂色、自检结果展示
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO;
  var doc = root.document;
  function $(id) { return doc.getElementById(id); }

  var state = { world: null, renderer: null, opts: null, size: 'l', resState: 'raw',
                openKey: null, selKey: null, infoId: 0, infoTab: null };

  /* 三档世界尺寸：像素面积、省份密度、国家数量一起等比放大，
   * 所以"大世界"是更多省份铺满更大的画布，而不是把同样的省份拉大。 */
  var SIZES = {
    s: { w: 1600, h: 800, prov: 520, ctry: 36 },
    l: { w: 2400, h: 1200, prov: 1100, ctry: 64 },
    xl: { w: 3200, h: 1600, prov: 1900, ctry: 90 }
  };

  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('on'); }, ms || 1800);
  }

  function readOpts() {
    var sz = SIZES[state.size] || SIZES.l;
    return {
      seed: ($('seed').value || '').trim() || 'seed',
      width: sz.w,
      height: sz.h,
      provinces: +$('prov').value,
      countries: +$('ctry').value,
      landRatio: +$('land').value / 100
    };
  }

  function optsDiffer() {
    var o = readOpts(), c = state.opts;
    if (!c) return true;
    return o.seed !== c.seed || o.width !== c.width || o.height !== c.height ||
      o.provinces !== c.provinces || o.countries !== c.countries || o.landRatio !== c.landRatio;
  }

  function applySize(key, regen) {
    state.size = key;
    var sz = SIZES[key];
    var seg = $('sizeSeg').querySelectorAll('button');
    for (var i = 0; i < seg.length; i++) seg[i].classList.toggle('on', seg[i].dataset.size === key);
    $('prov').value = sz.prov;
    $('provVal').textContent = sz.prov;
    $('ctry').value = sz.ctry;
    $('ctryVal').textContent = sz.ctry;
    if (regen) generate();
  }

  /* ---------------- 生成 ---------------- */
  function generate(after) {
    var opts = readOpts();
    var btn = $('gen');
    btn.disabled = true;
    btn.textContent = '生成中…';
    // 先把上一个世界的引用全部丢掉，让 GC 在重活开始前就能回收
    if (state.renderer) state.renderer.releaseWorld();
    state.world = null;
    root.__world = null;
    /* 资源开发的小模拟是按省份 id 存的，换世界必须清空 —— 否则上一局的
     * "已建 2 座 / 库存 47" 会挂到新世界同一个 id 的省上 */
    for (var sk in SIM) delete SIM[sk];
    for (var ck in CENTRAL) delete CENTRAL[ck];
    for (var fk in FREIGHT_LV) delete FREIGHT_LV[fk];
    /* 城墙是"这一局"的（首都那面墙是 seedAllSims 砌的），换世界必须清空 */
    for (var wk in WALL) delete WALL[wk];
    for (var pk in POP) delete POP[pk];
    for (var hk in SCHOOL) delete SCHOOL[hk];
    for (var mk in MARKET) delete MARKET[mk];
    for (var bk in BUILDER) delete BUILDER[bk];
    for (var gr in GRANARY) delete GRANARY[gr];
    for (var uv in UNIVERSITY) delete UNIVERSITY[uv];
    for (var fb in FACTORY_BLD) delete FACTORY_BLD[fb];
    for (var rk in RESEARCH) delete RESEARCH[rk];
    for (var lk in FLOW) delete FLOW[lk];
    for (var lc in FLOWC) delete FLOWC[lc];
    /* 治理层同理：官员、税率、民心都是"这一局"的，换世界必须清干净 */
    for (var tk in TALENT) delete TALENT[tk];
    for (var ok in OFFICIAL) delete OFFICIAL[ok];
    for (var xk in TAXRATE) delete TAXRATE[xk];
    for (var hk2 in HAPPY) delete HAPPY[hk2];
    for (var ak in TAXACC) delete TAXACC[ak];
    GOV_ID = 1;
    /* 战争层（v3）：军队、将领、围城、封锁都是按 pid / cid 挂的 ——
     * 不清的话，上一局的 3 万大军会"驻扎"在新世界的同一个省上。
     * 五座装备厂也一样（和学校/市场同形状，所以一起清）。 */
    for (var mk2 in BARRACKS) delete BARRACKS[mk2];
    for (var am in ARMORY) delete ARMORY[am];
    for (var sb in STABLE) delete STABLE[sb];
    for (var fd in FOUNDRY) delete FOUNDRY[fd];
    for (var sy in SHIPYARD) delete SHIPYARD[sy];
    for (var ay in ARMY) delete ARMY[ay];
    for (var gn in GENERALS) delete GENERALS[gn];
    for (var ws in WARSET) delete WARSET[ws];
    for (var wb in WARBASE) delete WARBASE[wb];
    for (var oc in OCCUPY) delete OCCUPY[oc];
    for (var sg in SIEGE) delete SIEGE[sg];
    for (var bl in BLOCKADE) delete BLOCKADE[bl];
    for (var dd in DEAD) delete DEAD[dd];
    for (var rq in RECRUITQ) delete RECRUITQ[rq];
    WARLOG.length = 0;
    ARMY_ID = 1; GEN_ID = 1; PLAYER = 0;
    /* 迷雾（v6）：换世界 = 换一张没人测绘过的地图。不清的话上一局的
     * 已探省 / 关系值 / 情报预算会挂到新世界的同号省份上。 */
    fogClear();
    NOTES.length = 0;
    turnNo = 1;
    closeTechTree();
    closeGovPanel();
    /* 编年史（v5）：年表 / 定稿 / 首都快照都是"这一局"的，换世界一并清掉 */
    if (AO.chronoReset) AO.chronoReset();
    state.openKey = null;
    state.infoId = 0;
    // 让浏览器先把"生成中"画出来，再释放一次垃圾，最后才做重活
    setTimeout(function () {
      try {
        var t0 = root.performance.now();
        var world = AO.generate(opts);
        var ms = root.performance.now() - t0;
        state.opts = opts;
        state.world = world;
        root.__world = world;                    // 调试用
        seedAllSims(world);                      // 整张图进后台模拟
        /* 外交关系与 AI 情报预算（v6）：每局重掷 —— 关系值是"这一局"的局势，
         * 和种子一样属于存档状态（玩家那份进档，AI 的运行时重长）。 */
        initRel(world);
        rollAiBudgets(world);
        /* 事件 / 信仰（v4）：换世界必须全清 —— 冷却表、传教中、政策、国教
         * 都是"这一局"的，留着会让新世界的第 3 回合突然跳出上一局的旧事件。 */
        if (AO.evtReset) AO.evtReset();
        closeEventModal();

        if (!state.renderer) {
          state.renderer = new AO.Renderer($('map'), world);
          state.renderer.onSelect = showInfo;
          /* 国家模式下省份卡是多余的：选中整国时把省份卡收掉，
           * 但「查看」模式下点省份时仍保留省份卡（那里也会联动国家卡）。 */
          state.renderer.onSelectCountry = function (cid) {
            clearInfo();
            showCountry(cid);
          };
          /* 涂色改了归属：两张全屏面板里的国名 / 省列表都得跟着刷。
           * 省份卡和国家卡不用管 —— paint() 最后会 select(id)，
           * 那条链会走到 showInfo，它自己会顺手把国家卡切成新东家。 */
          state.renderer.onPaint = function (id, from, to) {
            if (GP.open) renderGovPanel();
            if (TT.open) renderTechTree(false);
          };
          state.renderer.onPaintBlocked = function (id, owner) {
            var cc = state.world && state.world.countries[owner - 1];
            toast('「' + (cc ? cc.name : '这个国家') + '」只剩这一省了，涂走它国就没了', 2600);
          };
          root.__renderer = state.renderer;      // 调试用
        } else {
          state.renderer.setWorld(world);
        }
        buildSwatches();
        clearInfo();
        clearCountry();
        updateFaithLegend(state.renderer ? state.renderer.viewMode : 'political');
        updateResLegend(state.renderer ? state.renderer.viewMode : 'political');
        $('test').classList.remove('on');
        $('test').innerHTML = '';
        var mt = world.meta;
        $('panel').querySelector('.sub').textContent =
          mt.width + '×' + mt.height + ' · ' + mt.provinceCount + ' 省 · ' +
          mt.countryCount + ' 国 · ' + Math.round(ms) + ' ms';
        updateTurnLabel();
        btn.textContent = '生成新世界 · ' + Math.round(ms) + ' ms';
        setTimeout(function () { btn.textContent = '生成新世界'; }, 2400);
        /* 读档要等世界真的建好再灌状态 —— 所以给个可选回调。
         * 注意 generate 也直接挂在「生成新世界」的 click 上，那里传进来的是
         * MouseEvent，所以必须判类型，不能只看真假。 */
        if (typeof after === 'function') { try { after(); } catch (e2) { console.error(e2); } }
      } catch (e) {
        console.error(e);
        btn.textContent = '生成失败，换个种子';
        toast('生成失败：' + e.message, 3200);
        setTimeout(function () { btn.textContent = '生成新世界'; }, 2400);
      }
      btn.disabled = false;
    }, 30);
  }

  /* ---------------- 国家色盘 ---------------- */
  function buildSwatches() {
    var box = $('swatches');
    box.innerHTML = '';
    var w = state.world;
    for (var i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      var d = doc.createElement('div');
      d.className = 'sw' + (state.renderer && state.renderer.paintOwner === c.id ? ' on' : '');
      d.style.background = c.color;
      d.title = c.name + '（' + c.provinceCount + ' 省）';
      d.dataset.cid = c.id;
      d.addEventListener('click', function () {
        var id = +this.dataset.cid;
        if (state.renderer) {
          state.renderer.paintOwner = id;
          setMode('paint');
          toast('涂色目标：' + w.countries[id - 1].name, 1200);
        }
        var all = box.querySelectorAll('.sw');
        for (var k = 0; k < all.length; k++) all[k].classList.remove('on');
        this.classList.add('on');
      });
      box.appendChild(d);
    }
  }

  function setMode(m) {
    if (!state.renderer) return;
    state.renderer.mode = m;
    $('modeView').classList.toggle('on', m === 'view');
    $('modeCountry').classList.toggle('on', m === 'country');
    $('modePaint').classList.toggle('on', m === 'paint');
    if (m !== 'country') state.renderer.hoverCountry = 0;
    if (m !== 'view') state.renderer.selected = 0;
    state.renderer.requestDraw();
    $('modeHint').textContent =
      m === 'view' ? '点击省份查看信息' :
      m === 'country' ? '点击任意地块，查看该国资料' :
      '点击省份把它划给所选国家';
  }

  /* 岸线画像：几面临海 / 岸陡不陡 / 有没有河 —— 用来解释渔获为什么高或低 */
  function waterText(p) {
    var t = [];
    var d = p.coastDirs | 0;
    if (d >= 3) t.push('三面临海');
    else if (d === 2) t.push('两面临海');
    else if (d === 1) t.push('一面临海');
    else t.push('内陆');
    if (d) t.push(p.coastSteep > 0.5 ? '陡岸·难建港' : '缓岸·宜建渔港');
    if (p.riverMouth) t.push('河口');
    else if (p.riverLen > 0) t.push(p.riverRel > 0.28 ? '有大河流经' : '有溪流');
    else t.push('无河流');
    return t.join(' · ');
  }

  /* 渔获高低的地理理由（挂在储量条的 title 上） */
  function fishWhy(p) {
    var s = [];
    var d = p.coastDirs | 0;
    if (!d) s.push('内陆，无海可捕');
    else {
      s.push(d >= 2 ? (d >= 3 ? '三面临海' : '两面临海') : '单面临海');
      s.push((p.coastSteep || 0) > 0.5 ? '岸壁陡峭、近岸水深，无法建渔港' : '岸缓、可建渔港');
    }
    if (p.riverMouth) s.push('河流在此入海，河口渔场最肥');
    else if (p.riverLen > 0) s.push((p.riverRel > 0.28 ? '大河' : '溪流') + '流经，淡水与洄游鱼类补给');
    else s.push('无河流补给');
    return s.join('，');
  }

  /* ---------------- 资源开发的小模拟（只活在 UI 层） ----------------
   * **回合制**：一回合结算一次，什么时候结算由玩家点「下一回合」决定。
   * 每回合：已建的建筑按 per 产出（本地居民先吃掉一份，剩下的入库），同时扣储量；
   *        在建的工地推进一回合；储量见底 → 冷静期 或 枯竭。
   * 建造要**吃国家现有资源**：本省库存 → 中央国库 → 从同国富裕省份调拨（有损耗）。
   * 货运等级越高，调拨损耗越低、工期越短。
   * 整张图一起算（生成完世界就 seedAllSims），跟有没有点开无关。
   * 这一层不写回 p.resources、也不进导出 —— 它只是省卡里的预览。
   */
  var SIM = Object.create(null);      // pid -> { key: sim }
  var CENTRAL = Object.create(null);  // owner -> 中央国库（七种资源 + 铁/金）
  var POP = Object.create(null);      // pid -> { v, base, rate, need, eat }（会吃粮、会涨落的人口）
  var FREIGHT_LV = Object.create(null); // pid -> 货运等级
  /* 城墙（城防值）：一省一座，和货运站同一条路 —— 升级制、维护欠费停产。
   * pid -> { lv:0~3, site:施工剩几回合, hp:当前耐久, halted:欠费失修, mAcc:维护零头 }
   * 惰性创建（wallOf）：1100 个省里大部分没墙，别开局就给每省塞一条空记录。 */
  var WALL = Object.create(null);
  var SCHOOL = Object.create(null);   // pid -> { n, site, halted, mAcc }（每省的学校）
  var MARKET = Object.create(null);   // pid -> 同款结构（市场：卖资源换金）
  var BUILDER = Object.create(null);  // pid -> 同款结构（建造坊：工期冲刺的开关）
  /* 内政批（不升存档号）：粮仓（给粮/渔加上限）与大学（科研点 + 人才点）。
   * 形状和前三个**完全一样**（n / site / halted / mAcc），所以维护、工地推进、
   * 完工、冲刺、存档补默认全都走原来那条路，一行新逻辑都没加。 */
  var GRANARY = Object.create(null);  // pid -> 同款结构（粮仓：粮食储量上限）
  var UNIVERSITY = Object.create(null); // pid -> 同款结构（大学：+6 科研 / +2 人才）
  /* 工厂（15 档军备建筑）的状态表。名字带 _BLD 是为了和**定义表**
   * AO.FACTORY（兵营/军械坊/…/工厂 的数值表）区分开 ——
   * 同名的话 univDef('factory') 会拿到状态表而不是定义表。 */
  var FACTORY_BLD = Object.create(null); // pid -> 同款结构（工厂：本省军械产出 ×2）
  /* 战争层的四种装备厂 + 兵营（v3）。形状和上面三个**完全一样**，
   * 所以维护、工地推进、完工、冲刺一行代码都不用重写 —— 唯一的差别是
   * 军械坊/铸炮厂/造船厂多一个 order 字段（订单：产哪种装备）。 */
  var BARRACKS = Object.create(null); // pid -> 同款结构（兵营：征兵入口）
  var ARMORY = Object.create(null);   // pid -> 同款 + { order: 军械键 }
  var STABLE = Object.create(null);   // pid -> 同款结构（驯马场：产战马）
  var FOUNDRY = Object.create(null);  // pid -> 同款 + { order: 炮键 }
  var SHIPYARD = Object.create(null); // pid -> 同款 + { order: 舰种键 }
  /* 十种"通用设施"形状完全一样（n / site / halted / mAcc），
   * 用一个注册表把它们当成同一种东西处理 —— 维护、工地推进、完工、冲刺
   * 都只写一遍，加新设施时只往这三处各加一行。
   * 民用五个走 renderUniversalList（通用栏），军备六个走 renderMilList（军备栏）。 */
  var UNIV = {
    school: SCHOOL, market: MARKET, builder: BUILDER,
    granary: GRANARY, university: UNIVERSITY,
    barracks: BARRACKS, armory: ARMORY, stable: STABLE, foundry: FOUNDRY, shipyard: SHIPYARD,
    factory: FACTORY_BLD
  };
  var UNIV_KINDS = ['school', 'market', 'builder', 'granary', 'university',
    'barracks', 'armory', 'stable', 'foundry', 'shipyard', 'factory'];
  /* 民用四件套 + 大学（顺序就是面板里的行序：学校 → 市场 → 建造坊 → 粮仓 → 大学） */
  var UNIV_CIVIL = ['school', 'market', 'builder', 'granary', 'university'];
  var UNIV_MIL = ['barracks', 'armory', 'stable', 'foundry', 'shipyard', 'factory'];
  function univDef(kind) {
    if (kind === 'market') return AO.MARKET;
    if (kind === 'builder') return AO.BUILDER;
    if (kind === 'school') return AO.SCHOOL;
    if (kind === 'granary') return AO.GRANARY;
    if (kind === 'university') return AO.UNIVERSITY;
    return AO.FACTORY[kind];          // 兵营 / 军械坊 / 驯马场 / 铸炮厂 / 造船厂 / 工厂
  }
  function univOf(kind, pid) {
    var bag = UNIV[kind];
    return bag[pid] || (bag[pid] = newSchool());
  }
  /* 科研是**国家**级的（学校在省里，成果全国共用）：
   *   pts      科研点余额（学校每回合往里加，研究科技时扣）
   *   unlocked 科研条攒满 TECH_UNLOCK_PTS 之后为 true（科技树才看得见）
   *   cur      正在研究的一条 { key, left }，null = 空闲
   *   done     已研完的科技 { techKey: true }
   *   queue    研究队列（key 数组）：点节点只是入队，队头每回合由 settleResearch
   *            检查"扣不扣得起"，扣得起才真扣费开工 —— 所以点错不会白花钱。 */
  var RESEARCH = Object.create(null); // owner -> { pts, unlocked, cur, done, queue }
  /* 收支流水（每回合清零重记）：
   *   FLOW[pid]   = { gain:{key:n}, loss:{key:n}, d:{ eat,tax,maint } }
   *   FLOWC[owner] = 同结构（中央侧：税入、科研点进出、中央垫付的维护）
   * gain 只记"这一回合真正落袋的"（产出扣掉本地居民吃的那份），
   * loss 记"这一回合真正流出的"（维护、抽税、口粮）—— 两边都是**实际发生额**，
   * 不是需求额，所以对不上账时一眼能看出是欠费还是没产。 */
  var FLOW = Object.create(null);
  var FLOWC = Object.create(null);
  var turnNo = 1;

  /* ---------------- 治理层（官员 / 人口税 / 幸福度） ----------------
   * 四张表 + 两个零头，形状都照 RESEARCH / SCHOOL 的老路子来（对象按 id 挂）：
   *   TALENT[owner]  = { pts, pool:[{id,name,traitKey}] }  候选官员池（未上任）
   *   OFFICIAL[pid]  = { id, name, traitKey, owed } | 无    在任官员（一省至多一位）
   *   TAXRATE[owner] = 0|1|2                               税率档（默认 1 = 常规）
   *   HAPPY[pid]     = { v, target, drivers }              民心（0~100，开局 60）
   *   TAXACC[pid]    = 人口税的小数零头（照 mAcc / eatAcc 的攒整法）
   *
   * 为什么省库不另开一个池子：省库就是**省的金锭库存**（SIM[pid].gold.stock）。
   * 多开一个 bag 之后，省卡上的金、市场卖货、维护扣款会变成三本账，
   * 玩家看到两个不同的"金"只会更糊涂。 */
  var TALENT = Object.create(null);
  var OFFICIAL = Object.create(null);
  var TAXRATE = Object.create(null);
  var HAPPY = Object.create(null);
  var TAXACC = Object.create(null);
  var GOV_ID = 1;                     // 官员 id 计数器（存档里存的是 id，不重排）

  /* ---------------- 战争层（v3）的状态 ----------------
   * 全部照老路子：**按 id 挂对象**，读默认靠 Of()，存档原样存、读档补默认。
   *
   *   PLAYER        玩家国（0 = 上帝工坊模式：一切可动，兼容现在的玩法）
   *   WARSET        'a|b'（a<b，无序对）→ true。宣战/停战只动这一张表
   *   WARBASE       'a|b' → { a: 开战国初始省数, b: … }（投降线的分母）
   *   ARMY          军队 id → { owner,type,tier,men,ships,cargo,generalId,order,pid,sup }
   *   GENERALS      将领 id → { id,name,traitKey,owner,armyId }
   *   OCCUPY        省 id → { by, turn }（占领：产出×0.6、民心−10、不产科研）
   *   SIEGE         省 id → { by }（围城中：产出归零、守军吃存粮）
   *   BLOCKADE      省 id → owner（舰队封锁：断渔获、禁买货、民心−5）
   *   DEAD          国 id → { turn, by }（已灭亡，投降后全境并入）
   *
   * 「群龙无首」**不存状态**：它等价于"本国首都现在不在自己手里"，
   * 每回合现算（isDecap）。这样光复的那一刻自动解除，读档也不用迁移。 */
  var PLAYER = 0;
  var WARSET = Object.create(null);
  var WARBASE = Object.create(null);
  var ARMY = Object.create(null);
  var GENERALS = Object.create(null);
  var ARMY_ID = 1, GEN_ID = 1;
  var OCCUPY = Object.create(null);
  var SIEGE = Object.create(null);
  var BLOCKADE = Object.create(null);
  var DEAD = Object.create(null);
  var WARLOG = [];                    // 战报（最多 LOG_MAX 条，新的在前）
  var LOG_MAX = 80;
  /* 征兵队列：一座兵营一回合只征一支，默认要等 1 回合成军
   * （「练兵使」在驻省时即刻成军 —— 这就是那条词条的体感来源）。 */
  var RECRUITQ = Object.create(null);
  var RECRUIT_TURNS = 1;

  /* ---------------- 战争迷雾 + 情报署（v6）的状态 ----------------
   * 迷雾只是**视角层**：SIM / CENTRAL / 版图永远真实，这里记的是"谁在什么时候看见了什么"。
   *
   *   EXPLORED[owner]        { pid: 1 }（用对象不用 Set：JSON 原样进存档）
   *   LASTSEEN['owner|pid']  { t, o, b?, tr? } —— t 回合、o 当时归属、
   *                          b 建筑摘要（重金/贴脸才写）、tr 驻军约数
   *   REL['a|b']             极简关系值 -100~100（和 WARSET 同一套无序对键）
   *   INTELB[owner]          预算档 0/1/2（默认 0；**同一档兼反谍等级**）
   *   PROBE_CD['owner|cid']  定向探测冷却（剩余回合）
   *   AIKNOW[owner]          { pid: turn } —— AI 的"已探"（运行时，不进存档）
   *   AUTOT[owner]           上次自动织网的回合
   *   INTELMSG[owner]        { cid: { turn, ok, text } } 最近一次探测结果（面板一行）
   *
   * 只有 PLAYER 的 EXPLORED / LASTSEEN / INTELB / PROBE_CD 进存档；
   * AI 的认知每次运行重新长出来（spec ⑨：AI 同规则，但认知是运行时模拟）。 */
  var EXPLORED = Object.create(null);
  var LASTSEEN = Object.create(null);
  var REL = Object.create(null);
  var INTELB = Object.create(null);
  var PROBE_CD = Object.create(null);
  var AIKNOW = Object.create(null);
  var AUTOT = Object.create(null);
  var INTELMSG = Object.create(null);
  /* 可见性缓存：visOf 在渲染/注记/小地图里被调用几十万次，
   * 逐省现算邻接 × REL × 交战会卡住底图烘焙。只在"迷雾可能变了"时重建一次。 */
  var VIS = { dirty: true, arr: null, n: 0 };
  var VIS_UNKNOWN = 0, VIS_SEEN = 1, VIS_REAL = 2;

  AO.resSim = SIM;
  AO.resCentral = CENTRAL;
  AO.resPop = POP;
  AO.resFreight = FREIGHT_LV;
  AO.resWall = WALL;
  AO.resSchool = SCHOOL;
  AO.resMarket = MARKET;
  AO.resBuilder = BUILDER;
  AO.resGranary = GRANARY;
  AO.resUniversity = UNIVERSITY;
  AO.resFactory = FACTORY_BLD;
  AO.resResearch = RESEARCH;
  AO.resFlow = FLOW;
  AO.resFlowC = FLOWC;
  AO.resTalent = TALENT;
  AO.resOfficial = OFFICIAL;
  AO.resTaxRate = TAXRATE;
  AO.resHappy = HAPPY;
  AO.resTaxAcc = TAXACC;
  AO.resTurn = function () { return { no: turnNo }; };
  AO.resArmy = ARMY;
  AO.resGenerals = GENERALS;
  AO.resWars = WARSET;
  AO.resWarLog = function () { return WARLOG; };
  AO.resPlayer = function () { return PLAYER; };
  AO.resMil = {
    barracks: BARRACKS, armory: ARMORY, stable: STABLE, foundry: FOUNDRY, shipyard: SHIPYARD,
    factory: FACTORY_BLD
  };
  AO.resWar = {
    army: ARMY, generals: GENERALS, wars: WARSET, occupy: OCCUPY, siege: SIEGE,
    blockade: BLOCKADE, dead: DEAD, recruitQ: RECRUITQ, base: WARBASE
  };

  /* 一回合里攒下的提示（科研解锁/完成、本省欠费停产），
   * 等 nextTurn 刷完界面再挑当前看得见的国家/省份报出来 —— 64 个国家一起喊会糊成一片。 */
  var NOTES = [];

  /* 当前正在结算的那个省/国。settleTurn 里设、结束时清。
   * 有了它，payMaint / settlePop 这些老函数不用加参数就能把账记进 FLOW ——
   * 加参数会改签名，而这些函数在 UI 侧也各有调用点。 */
  var CUR = { pid: 0, owner: 0, F: null, FC: null };

  function newResearch() {
    return { pts: 0, unlocked: false, cur: null, done: Object.create(null), queue: [] };
  }
  function researchOf(owner) {
    var R = RESEARCH[owner];
    if (!R) R = RESEARCH[owner] = newResearch();
    /* 老存档没有 queue 字段：读档后补一个空队，别让 settleResearch 崩在 undefined 上 */
    if (!R.queue) R.queue = [];
    return R;
  }

  /* ---------------- 治理层的惰性创建 / 读默认 ----------------
   * 三个 Of() 都是"没有就给默认值"，和老存档兼容全靠它们：
   * v1 的档里根本没有 TALENT / TAXRATE / HAPPY，读进来是 undefined，
   * 走到这里自动补成空池 / 常规税 / 60 民心，不会崩。 */
  function talentOf(owner) {
    var T = TALENT[owner];
    if (!T) T = TALENT[owner] = { pts: 0, pool: [] };
    if (!T.pool) T.pool = [];
    if (typeof T.pts !== 'number' || !isFinite(T.pts)) T.pts = 0;
    /* 累计教育（内政批）：**只加不减**，解锁 15/35/60 三档看它。
     * 旧档（v6 及以前）没有 total → 按 pts 补一个（偏低可接受：
     * 占位期不追求精确，反正 pts 只可能比 total 少）。
     * tier 记"已经跨过第几档"，跨档提示靠它只报一次。 */
    if (typeof T.total !== 'number' || !isFinite(T.total)) T.total = T.pts;
    if (typeof T.tier !== 'number') T.tier = AO.tierIndexAt(T.total);
    return T;
  }

  /* 教育档位：跨过去的那一刻往 NOTES 推一条（只报一次，靠 T.tier 记住）。
   * 放在 talentOf 旁边，因为它的两个字段都和人才点绑在一起。 */
  function checkTier(owner) {
    var T = talentOf(owner);
    var idx = AO.tierIndexAt(T.total);
    while (T.tier < idx) {
      T.tier++;
      var t = AO.TIER[T.tier];
      if (!t) break;
      NOTES.push({ owner: +owner, cls: 'ok',
        text: '教育跨档：累计 ' + Math.floor(T.total) + ' 点 —— 「' + t.cn + '」解锁，' + t.desc });
    }
  }
  /* 人才点入账：**同一个数同时加到 pts 与 total**。
   * 抽卡（开科 / 开武科）只扣 pts —— 抽光官员也不会把工厂/大学抽回去。 */
  function addTalent(owner, n) {
    if (!(n > 0)) return;
    var T = talentOf(owner);
    T.pts += n;
    T.total += n;
    checkTier(owner);
  }
  AO.resAddTalent = addTalent;
  AO.resCheckTier = checkTier;
  function taxRateOf(owner) {
    var r = TAXRATE[owner];
    return (r === 0 || r === 1 || r === 2) ? r : 1;
  }
  function happyOf(pid) {
    var h = HAPPY[pid];
    if (!h) h = HAPPY[pid] = { v: AO.GOV.happyStart, target: AO.GOV.happyStart, drivers: null };
    if (typeof h.v !== 'number' || !isFinite(h.v)) h.v = AO.GOV.happyStart;
    return h;
  }
  AO.resTalentOf = talentOf;
  AO.resTaxRateOf = taxRateOf;
  AO.resHappyOf = happyOf;

  /* 国家的人口加权平均幸福度（国家卡 / 面板顶栏共用）。
   * 用人口加权而不是省平均：1100 省的世界里一个国能有 20 个省，
   * 一个百万人的小省和一个两千万的大省在"国民幸福度"里不该等权。 */
  function countryHappy(c) {
    if (!c || !state.world) return AO.GOV.happyStart;
    var sum = 0, wsum = 0;
    for (var i = 0; i < c.provinces.length; i++) {
      var pid = c.provinces[i];
      var w = (POP[pid] && POP[pid].v) || 1;
      sum += happyOf(pid).v * w;
      wsum += w;
    }
    return wsum > 0 ? sum / wsum : AO.GOV.happyStart;
  }
  AO.resCountryHappy = countryHappy;

  /* ---------------- 科技加成 ----------------
   * 全局科技（for:null）的效果统一从 done 汇总到这里，四个点位各取一次：
   *   维护 → maintDue 乘 (1 − maintCut)
   *   抽税 → ③段 take 数加 fx.tax
   *   损耗 → effectiveLoss() 包住 FREIGHT.lossAt（**不改 FREIGHT 本身**）
   *   工期 → effectiveTurns() 包住建造/研究工期（下限 1）
   * 不做缓存：11 条科技 × 一回合几千次调用，比维护缓存的失效逻辑便宜。 */
  function MODS(owner) {
    var out = { tax: 0, maintCut: 0, lossCut: 0, turnCut: 0 };
    var R = RESEARCH[owner];
    if (!R) return out;
    var list = AO.TECHS || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t.fx || !R.done[t.key]) continue;
      for (var k in t.fx) out[k] = (out[k] || 0) + t.fx[k];
    }
    return out;
  }
  AO.resMODS = MODS;

  /* ---------------- 官员加成（PMOD） ----------------
   * = MODS(owner) 的四个字段，再叠加这一省在任官员的词条 fx：
   *   taxMul   收税乘数（乘）      happyAdd 幸福度加数（加）
   *   turnCut  工期减回合（加）    prodMul  按资源键乘产量
   * **不改 MODS 本身**：科技加成是全国共用的，官员加成是这一省的 ——
   * 混在一起之后，撤换一个官会连带把科技加成也算丢，账就查不清了。
   *
   * pid 传 0（研究冲刺那种"国家层面"的调用）时只有科技加成，不崩。
   * 第二个参数 owner 可以显式给：settleTurn 里已经算过，省一次反查。 */
  function PMOD(pid, owner) {
    var p = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    var o = owner || (p ? p.owner : 0);
    var b = MODS(o);
    var out = {
      tax: b.tax || 0, maintCut: b.maintCut || 0,
      lossCut: b.lossCut || 0, turnCut: b.turnCut || 0,
      taxMul: 1, happyAdd: 0, prodMul: null
    };
    var off = OFFICIAL[pid | 0];
    if (!off) return out;
    var fx = AO.traitOf(off.traitKey).fx || {};
    if (fx.taxMul) out.taxMul *= fx.taxMul;
    if (fx.happyAdd) out.happyAdd += fx.happyAdd;
    if (fx.turnCut) out.turnCut += fx.turnCut;
    if (fx.prodMul) {
      out.prodMul = {};
      for (var k in fx.prodMul) out.prodMul[k] = fx.prodMul[k];
    }
    return out;
  }
  AO.resPMOD = PMOD;

  /* 调拨损耗：货运等级给的基础值，再减掉「驿道」那几点。地板 0。 */
  function effectiveLoss(pid, owner) {
    var base = AO.FREIGHT.lossAt(FREIGHT_LV[pid] || 0);
    return Math.max(0, base - (MODS(owner).lossCut || 0));
  }
  /* 建造/研究工期：base 省略时按货运等级取；减掉「学徒制」和官员的 turnCut，下限 1 回合。
   * 「营造巧匠」正是从这里生效的 —— 它和省卡上写的工期、真的开工倒计时是同一个数。 */
  function effectiveTurns(pid, owner, base) {
    var t = (base === undefined || base === null)
      ? AO.FREIGHT.turnsAt(FREIGHT_LV[pid] || 0) : base;
    return Math.max(1, t - (PMOD(pid, owner).turnCut || 0));
  }
  AO.resEffectiveLoss = effectiveLoss;
  AO.resEffectiveTurns = effectiveTurns;

  /* 全局科技的一句话效果（节点副标题、完成提示共用） */
  function fxDesc(t) {
    var f = t.fx || {}, a = [];
    if (f.tax) a.push('每笔抽税 +' + f.tax);
    if (f.maintCut) a.push('维护 −' + Math.round(f.maintCut * 100) + '%');
    if (f.lossCut) a.push('调拨损耗 −' + Math.round(f.lossCut * 100) + '%');
    if (f.turnCut) a.push('建造/研究工期 −' + f.turnCut);
    return a.length ? a.join(' · ') : '全局加成';
  }


  /* 中央国库惰性创建：**七种资源键全给上**，缺一个 payCost/维护就会算错 */
  function ensureCentral(owner) {
    var c = CENTRAL[owner];
    if (!c) c = CENTRAL[owner] = Object.create(null);
    var rs = AO.RESOURCES || [];
    for (var i = 0; i < rs.length; i++) if (c[rs[i].key] === undefined) c[rs[i].key] = 0;
    if (c.timber === undefined) c.timber = 0;
    if (c.grain === undefined) c.grain = 0;
    return c;
  }

  /* 哪些省是首都（国家表的 capital 是省份 id） */
  var CAPS = null;
  function capitalSet(w) {
    if (CAPS && CAPS.w === w) return CAPS.s;
    var s = Object.create(null);
    for (var i = 0; i < ((w && w.countries) || []).length; i++) {
      var c = w.countries[i];
      if (c && c.capital) s[c.capital] = 1;
    }
    CAPS = { w: w, s: s };
    return s;
  }

  /* 一袋资源的模拟状态。**分档**：tiers 记 Lv1/Lv2 各几座，
   * built 保留为总数（= tiers[1] + tiers[2]），老代码和显示都不用改。 */
  function newSim(r, built) {
    built = built || 0;
    return {
      n: r.n, built: built, tiers: { 1: built, 2: 0 },
      site: 0, siteKind: null, siteTier: 1,     // 工地：'new' 新建 / 'up' 升档
      stock: 0, left: r.n, cool: 0, gone: false, pop: 0, eaten: 0,
      halted: false, mAcc: { iron: 0, gold: 0 } // 维护欠费标记 + 小数攒整的零头
    };
  }

  function newSchool() {
    /* order：只有军械坊 / 铸炮厂 / 造船厂用（订单制：这一座产哪种装备）。
     * 学校/市场/建造坊/兵营/驯马场永远是 null —— 多一个字段不影响它们。 */
    return { n: 0, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null };
  }

  /* 存档用的瘦身版：只留"盖过 / 在建"的省。
   * 为什么：一张 UNIV 表在 1100 省的世界里要 84KB（每省一条空结构），
   * 内政批新增三张表就是 252KB —— 而 localStorage 一共 5MB，
   * 存两份（正档 + 旧档模拟）就爆配额。空结构本来就能在读档时补，
   * 没有理由跟着存档走。applySave 的兜底会给每个 pid 补 newSchool()。 */
  function sparseUniv(map) {
    var out = {}, k, s;
    for (k in map) {
      s = map[k];
      if (s && ((s.n | 0) > 0 || (s.site | 0) > 0)) out[k] = s;
    }
    return out;
  }

  /* 开局铺底子：
   *   · 普通省：只有"主资源"上先有 1 座 —— 一省一个起步产业；
   *   · 首都省：主资源 3 座，其余六种各 1 座。
   * 建筑没有上限；开局中央国库里也有一点木材/粮食/铁/金，够前几座建筑开工。
   * 开局铺的一律算 **Lv1**（Lv2 得先有科技）。 */
  function seedSims(p) {
    var bag = Object.create(null);
    var isCap = state.world ? !!capitalSet(state.world)[p.id] : false;
    var top = (p.resources && p.resources[0]) ? p.resources[0].key : null;
    for (var i = 0; i < (p.resources || []).length; i++) {
      var r = p.resources[i];
      var built = 0;
      if (r.key === top) built = isCap ? 3 : 1;
      else if (isCap) built = 1;
      bag[r.key] = newSim(r, built);
    }
    SIM[p.id] = bag;
    POP[p.id] = { v: p.population || 0, base: p.population || 0, rate: 0, need: 0, eat: 0 };
    for (var ui = 0; ui < UNIV_KINDS.length; ui++) {
      var ub = UNIV[UNIV_KINDS[ui]];
      if (!ub[p.id]) ub[p.id] = newSchool();
    }
    /* 民心开局 60（= AO.GOV.happyStart），target 先对齐自己，
     * 这样第一回合结算时不会从 0 猛地往上跳 */
    happyOf(p.id);
    return bag;
  }

  /* 整张图一次性进模拟 + 给每国发一点中央库存 */
  function seedAllSims(w) {
    for (var i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (p && p.resources) seedSims(p);
    }
    for (var ci = 0; ci < (w.countries || []).length; ci++) {
      var c = w.countries[ci];
      var n = (c.provinces || []).length;
      /* 铁/金是维护费的本钱：没有矿的省全靠中央接济，所以开局就得有一笔底。
       * 占位值比木材/粮食给得多 —— 维护是**每回合都扣**的固定开销，
       * 底子太薄的话开局十几回合全国就集体停产，玩法根本展不开。
       * 真正的收支平衡下一轮拍板，这里只保证"跑得动"。 */
      CENTRAL[c.id] = {
        timber: 40 + 6 * n, grain: 30 + 4 * n,
        iron: 60 + 8 * n, gold: 40 + 6 * n,
        fish: 0, horse: 0, salt: 0
      };
      researchOf(c.id);
      talentOf(c.id);                 // 人才点从 0 开始，候选池空
      if (TAXRATE[c.id] === undefined) TAXRATE[c.id] = 1;   // 默认「常规」
      /* 城墙（城防值）：每国首都开局自动砌到 aiCapitalLv 级（一次性）。
       * 生成期还没有"玩家"这个概念（PLAYER=0），所以**所有**首都一视同仁 ——
       * 玩家的首都也有墙，只是敌人那面墙才是你攻城时要啃的那面。 */
      if (c.capital) {
        var capP = w.provinces[c.capital - 1];
        var capLv = AO.WALL.aiCapitalLv | 0;
        if (capP && capLv > 0) {
          WALL[c.capital] = {
            lv: capLv, site: 0, hp: AO.WALL.maxHp(capLv),
            halted: false, mAcc: { iron: 0, gold: 0 }
          };
        }
      }
    }
    return SIM;
  }

  /* 单座建筑每回合产多少 → 该资源这一回合总产出（分档求和）。
   * 签名保持不变：调用方只知道"这个资源袋每回合产多少"。 */
  function simPerTurn(s, def) {
    var t = s.tiers || { 1: s.built || 0, 2: 0 };
    return (def.per || 0) * (t[1] || 0) + (def.per2 || def.per || 0) * (t[2] || 0);
  }

  /* 这一袋建筑这一回合的维护需求（铁 + 金），按档位加权。
   * owner 给了就把「标准工料」的折扣算进去（−25%），没给按原价 ——
   * 老调用点（预览、对比文案）不传 owner 也不会算错，只是不含科技加成。 */
  function maintDue(s, def, owner) {
    var t = s.tiers || { 1: s.built || 0, 2: 0 };
    var a = def.maint || {}, b = def.maint2 || a, out = {};
    var cut = owner ? 1 - (MODS(owner).maintCut || 0) : 1;
    var ks = ['iron', 'gold'], i, k;
    for (i = 0; i < ks.length; i++) {
      k = ks[i];
      out[k] = ((a[k] || 0) * (t[1] || 0) + (b[k] || 0) * (t[2] || 0)) * cut;
    }
    return out;
  }

  /* 付维护：**只走本省库存 → 中央国库，不走调拨**。
   * 维护是日常开销，不是一次性工程；而且没有矿的省根本没有铁/金袋子，
   * 只能靠中央接济 —— 所以抽税那条规则必须先落地。
   * 小数用 eatAcc 同款"攒整"法：0.2 个/座看着像没付，攒五回合就是 1。
   * 返回 false = 有缺口 → 调用方把这一类建筑标成停产。
   *
   * 记账：CUR 正指着这个省时，把"本省扣的"和"中央垫的"分别记进两本流水 ——
   * 省卡的收支小结要能说清"维护里有多少是我自己掏的、多少是中央接济的"。 */
  function payMaint(pid, owner, demand, acc) {
    var cen = ensureCentral(owner), bag = SIM[pid];
    var ok = true;
    var F = (CUR.pid === (pid | 0)) ? CUR.F : null;
    var FC = (CUR.owner === (owner | 0)) ? CUR.FC : null;
    for (var k in demand) {
      acc[k] = (acc[k] || 0) + demand[k];
      if (acc[k] > 40) acc[k] = 40;            // 欠账别无限滚，否则永远还不清
      var need = Math.floor(acc[k]);
      if (need <= 0) continue;
      var got = 0;
      if (bag && bag[k] && bag[k].stock > 0) {  // 本省有这种资源才扣得了
        var t1 = Math.min(bag[k].stock, need);
        bag[k].stock -= t1; got += t1;
        if (F) { F.loss[k] = (F.loss[k] || 0) + t1; F.d.maint[k] = (F.d.maint[k] || 0) + t1; }
      }
      if (got < need) {
        var t2 = Math.min(cen[k] || 0, need - got);
        if (t2 > 0) {
          cen[k] = (cen[k] || 0) - t2; got += t2;
          if (FC) { FC.loss[k] = (FC.loss[k] || 0) + t2; FC.d.maint[k] = (FC.d.maint[k] || 0) + t2; }
          /* 中央替这个省垫了多少，单独记一格 —— 省卡 title 里要写
           * "维护 铁0.4（本省 0.2 + 中央垫 0.2）"，但省库存只掉了 0.2，
           * 所以这一格**不进 F.loss**，只作说明用。 */
          if (F) F.d.maintC[k] = (F.d.maintC[k] || 0) + t2;
        }
      }
      acc[k] -= got;
      if (got < need) ok = false;
    }
    return ok;
  }

  /* 工地完工：把"倒计时走到 0"这件事变成真正的状态变化。
   * **settleTurn 和冲刺钮共用这一个函数** —— 否则冲刺砍到 0 的那一刻要么
   * 不生效（只减了数没完工），要么等下一回合 settleTurn 再减一次（重复完工）。
   * 调用前提：site 已经是 0（或即将归零），这里只负责"落地"。 */
  function finishSite(pid, key) {
    var bag = SIM[pid], s = bag && bag[key];
    if (s && AO.RESOURCE_BY_KEY[key]) {
      s.site = 0;
      if (s.siteKind === 'up') {                    // 升档：旧的一座改成 Lv2
        s.tiers[1] = Math.max(0, (s.tiers[1] || 0) - 1);
        s.tiers[2] = (s.tiers[2] || 0) + 1;
      } else {                                      // 新建：落到开工时定的档位
        var tier = s.siteTier || 1;
        s.tiers[tier] = (s.tiers[tier] || 0) + 1;
        s.built++;
      }
      s.siteKind = null;
      s.siteTier = 1;
      return true;
    }
    /* 通用设施（学校 / 市场 / 建造坊）：只有"座数 +1" */
    for (var i = 0; i < UNIV_KINDS.length; i++) {
      if (UNIV_KINDS[i] !== key) continue;
      var st = UNIV[key][pid];
      if (!st) return false;
      st.site = 0;
      st.n++;
      return true;
    }
    return false;
  }
  AO.resFinishSite = finishSite;

  /* 结算一回合：所有省的资源与工地各走一步 */
  function settleTurn() {
    turnNo++;
    var selPid = state.renderer ? state.renderer.selected : 0;
    var pid, key, s, def, sch, prov, owner, was, ki;

    /* ⓿ 流水清零：收支小结只说"这一回合"的事，跨回合累加会变成一本糊涂账。
     * d.cap 是内政批新加的一格：**被库存上限吃掉的量**（满仓损耗）。
     * 它不进 gain / loss —— 那两份记的是真正落袋与真正流出的钱粮，
     * 满仓浪费的东西从来没进过库存，混进去会让库存变化对不上账。 */
    for (pid in SIM) {
      FLOW[pid] = { gain: Object.create(null), loss: Object.create(null),
                    d: { eat: Object.create(null), tax: Object.create(null),
                         maint: Object.create(null), maintC: Object.create(null),
                         cap: Object.create(null) } };
    }
    for (var co in CENTRAL) {
      FLOWC[co] = { gain: Object.create(null), loss: Object.create(null),
                    d: { eat: Object.create(null), tax: Object.create(null),
                         maint: Object.create(null), maintC: Object.create(null) } };
    }

    for (pid in SIM) {
      var bag = SIM[pid];
      prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
      owner = prov ? prov.owner : 0;
      /* 记账上下文：payMaint / settlePop / 抽税都从这里取，省得给每个函数加参数 */
      CUR.pid = pid | 0; CUR.owner = owner | 0;
      CUR.F = FLOW[pid]; CUR.FC = FLOWC[owner] || null;
      var mods = MODS(owner);
      /* 官员加成（科技加成 + 这一省在任官员的词条）每省算一次，③④⑤ 共用 */
      var pmod = PMOD(pid, owner);

      /* ① 维护：**在产出之前**算，按建筑类型各自付、各自停。
       * 付得起 → 当回合照常出产；付不起 → 这一类当回合起产量 0，凑齐了自动复工。
       * 枯竭的不收维护（矿脉都没了，没什么可养的），否则那些省会永远失血。 */
      var haltedNow = [];
      for (key in bag) {
        s = bag[key];
        def = AO.RESOURCE_BY_KEY[key];
        if (!def) continue;
        if (!s.built || s.gone) { s.halted = false; continue; }
        was = s.halted;
        s.halted = !payMaint(pid, owner, maintDue(s, def, owner), s.mAcc);
        if (s.halted && !was) haltedNow.push(def.build);
      }
      /* 学校 / 市场 / 建造坊：同一种形状，一遍循环处理完 */
      for (ki = 0; ki < UNIV_KINDS.length; ki++) {
        var kind = UNIV_KINDS[ki], udef = univDef(kind), ust = UNIV[kind][pid];
        if (!ust) continue;
        var wasU = ust.halted;
        ust.halted = ust.n > 0 ? !payMaint(pid, owner, {
          iron: (udef.maint.iron || 0) * ust.n,
          gold: (udef.maint.gold || 0) * ust.n
        }, ust.mAcc) : false;
        if (ust.halted && !wasU) haltedNow.push(udef.cn);
      }
      /* 城墙维护（铁 + 金）：和资源建筑同一套 payMaint —— 付不起就 halted，
       * 区别是墙"停产"的表现是**年久失修**（耐久每回合 −5），不是产量归零。
       * 耐久本身的涨落放在战争段末尾（settleWalls）：要先知道"这回合打没打仗"。 */
      var wst = WALL[pid];
      if (wst && wst.lv > 0) {
        var wasW = wst.halted;
        wst.halted = !payMaint(pid, owner, wallMaintDue(wst, owner), wst.mAcc);
        if (wst.halted && !wasW) haltedNow.push('城墙');
      } else if (wst) {
        wst.halted = false;
      }
      /* 一个省一回合只报一条：七类建筑一起停的时候，逐条报会刷屏 */
      if (haltedNow.length && (pid | 0) === selPid) {
        NOTES.push({ owner: owner, pid: pid | 0,
          text: haltedNow.join('、') + ' 维护欠费，停产中（铁/金见底，等中央接济）', cls: 'warn' });
      }

      /* ② 工地推进（枯竭了也照盖完，不半路烂尾） */
      if (WALL[pid] && WALL[pid].site > 0) {
        WALL[pid].site--;
        if (!WALL[pid].site) finishWall(pid | 0);
      }
      for (ki = 0; ki < UNIV_KINDS.length; ki++) {
        var u2 = UNIV[UNIV_KINDS[ki]][pid];
        if (u2 && u2.site > 0) { u2.site--; if (!u2.site) finishSite(pid, UNIV_KINDS[ki]); }
      }
      for (key in bag) {
        s = bag[key];
        if (!(s.site > 0)) continue;
        s.site--;
        if (!s.site) finishSite(pid, key);
      }

      /* ③ 产出 + 抽税。
       * 冷静期与「采空 → 冷静/枯竭」这两个计时**不受停产影响**：
       * 停产只掐产量，不该把倒计时也冻住。 */
      var foodProd = 0;
      for (key in bag) {
        s = bag[key];
        def = AO.RESOURCE_BY_KEY[key];
        if (!def) continue;
        if (!s.built || s.gone) continue;

        if (s.cool > 0) {                       // 冷静期：只走回合数
          s.cool--;
          if (s.cool <= 0) { s.cool = 0; s.left = s.n; }
          continue;
        }
        if (s.left <= 0) {                      // 采空 → 冷静 或 枯竭
          if ((def.cool || 0) > 0) s.cool = def.cool;
          else s.gone = true;
          continue;
        }
        if (s.halted) continue;                 // 停产：产量 0，工地照走、冷静照走
        /* 战争层两刀（都写在产出之前，所以"归零"是真的零，不是事后扣）：
         *   围城  被围的省产出全归零 —— 这是围城最狠的一条，也是"围而不打"的意义；
         *   封锁  沿海省被舰队封锁 → 打不到鱼（其余照产）。
         * 占领省不是归零，而是 ×0.6（见下面的 mul）—— 打下来的地方还能用，只是不顺手。 */
        if (SIEGE[pid]) continue;
        if (key === 'fish' && BLOCKADE[pid]) continue;
        /* 官员产量加成（劝农使）：乘在**毛产**上，再攒整成整数。
         * 为什么要 pAcc 攒零头：3 × 1.25 = 3.75，直接 round 成 4 等于白送 25%，
         * floor 成 3 等于白干 —— 攒起来下一回合补上，长期平均才真是 1.25 倍。
         * （和 eatAcc / mAcc 是同一套办法，见 payMaint 的注释。） */
        var mul = (pmod.prodMul && pmod.prodMul[key]) || 1;
        if (OCCUPY[pid]) mul *= AO.BATTLE.occupyProd;   // 占领省：产出 ×0.6
        /* 事件带来的临时乘数（渔汛 ×2 / 大旱 ×0.5），和官员加成同一层。
         * 放在这里而不是改 def.per：乘数是有回合数的，改表就回不去了。 */
        if (AO.evtProdMul) mul *= AO.evtProdMul(pid, key);
        var grossF = simPerTurn(s, def) * mul;
        var gross = Math.floor(grossF + (s.pAcc || 0));
        s.pAcc = grossF + (s.pAcc || 0) - gross;
        if (!gross) continue;
        var take = Math.min(s.left, gross);      // 不够一回合的产出就只拿剩下的
        /* 本地居民先吃掉一份（农场/渔港/盐场/伐木场/牧场），剩下才进省库存。
         * 小数用 eatAcc 攒着：每回合 0.4 个看着像没吃，攒五回合就是 2 个。 */
        s.eatAcc = (s.eatAcc || 0) + take * (def.eat || 0);
        var eaten = Math.floor(s.eatAcc);
        s.eatAcc -= eaten;
        s.eaten = eaten;
        var net = take - eaten;
        /* 入库受**省库上限**约束（AO.CAP.base，粮/渔另加粮仓）：
         * 超出上限的当场损耗，记进 d.cap，收支小结写「满仓 −N」。
         * gainStock 只掐增量、不吞已有存量（粮仓停产时上限会回落）。 */
        var kept = gainStock(pid, key, net, CUR.F);
        /* 流水：落袋的才算 gain（居民吃掉的、满仓损耗的都没进过库存） */
        CUR.F.gain[key] = (CUR.F.gain[key] || 0) + kept;
        /* 人口增速看的是**真进了仓**的粮：满仓浪费掉的粮不养人，
         * 否则"囤到上限就停"这条规则对人口完全无效。 */
        if (key === 'grain' || key === 'fish') foodProd += kept;
        s.left -= take;
        s.pop = Date.now();
        /* 抽税：这一省这一种资源本回合产得够多，就抽一份进中央。
         * 中央要养全国的维护费，没有这条，没矿的省会集体停产。
         * 「复式账簿」让每笔多抽 fx.tax —— 先算总量，抽不起就整笔不抽
         * （抽一半比不抽更难看懂）。 */
        var taxN = AO.TAX.take + (mods.tax || 0);
        if (take >= AO.TAX.min && s.stock >= taxN) {
          s.stock -= taxN;
          var cen = ensureCentral(owner);
          cen[key] = (cen[key] || 0) + taxN;
          CUR.F.loss[key] = (CUR.F.loss[key] || 0) + taxN;
          CUR.F.d.tax[key] = (CUR.F.d.tax[key] || 0) + taxN;
          if (CUR.FC) {
            CUR.FC.gain[key] = (CUR.FC.gain[key] || 0) + taxN;
            CUR.FC.d.tax[key] = (CUR.FC.d.tax[key] || 0) + taxN;
          }
        }
        if (s.left <= 0) {
          if ((def.cool || 0) > 0) s.cool = def.cool;
          else s.gone = true;
        }
      }
      /* ③b 装备厂：军械坊/铸炮厂/造船厂按订单产装备，驯马场产战马。
       * 放在产出之后（这一回合的料才有着落）、人口税之前（不干扰省库金）。 */
      settleIndustry(pid, owner);

      /* ④ 人口税：省向人民收金 → **省库**（就是本省的金锭库存，不另开池子）。
       * 和生产抽税（③ 里那一段，产出去中央）是两本账：这里收的金留在省里，
       * 用来发俸禄、买货、建东西；中央那份一分不动。 */
      settleTax(pid, owner, prov, pmod);

      settlePop(pid, foodProd);       // 资源产完之后，人口吃粮、涨落

      /* ⑤ 民心：用本回合**已经发生**的事实（吃没吃饱、停了几类产）算 target，
       * 再往它靠 30%。放在 settlePop 之后是因为"缺粮"要看 eat / need。 */
      settleHappy(pid, prov);
    }

    CUR.pid = 0; CUR.owner = 0; CUR.F = null; CUR.FC = null;

    /* ⑥ 科研：学校产点 → 条满解锁 → 在研科技倒计时 → 队列拉下一条。
     * 人才点也在这一步累加（同一批学校，见 settleResearch） */
    settleResearch();

    /* ⑦ 战争：粮食补给 → 敌国动员 → 行军/会战/占领 → 围城 → 投降。
     * 放在最后：这一回合的产出/人口/民心都算完了，战斗才拿得到"现在的兵和粮"。 */
    settleWar();

    /* ⑦b 情报署（v6）：扣经费 → 自动织网 → AI 密探。
     * 排在战争之后（要看到打完之后的新版图）、事件之前（事件弹窗不该挡住情报提示）。 */
    settleIntel();

    /* ⑦c 敌国内政 AI（v7）：建造 / 研究 / 调税 / 开科派官，每国每回合最多两个动作。
     * 排在情报 tick 之后 —— AI 的决策只看**自己省**的实时数据（SIM / HAPPY 里
     * owner 是自己那份），既不需要别国的情报，也不该读（迷雾框架下那是偷看）。
     * 排在事件之前：这一回合刚盖好的学校，下回合才产科研点，和玩家的时序一致。
     * 工坊模式（PLAYER = 0）里 18-ai.js 自己会立刻返回，AI 全静止。 */
    if (AO.aiEconTick) AO.aiEconTick();

    /* ⑧ 事件：传教倒计时 → 产量 buff 倒计时 → 重算国教 → 掷一件事件。
     * 也放在最后 —— 它要看到**打完之后的版图**（占领会让传教作废，
     * 新占的省会改掉"该国信仰占比最大者"）。 */
    if (AO.evtSettle) AO.evtSettle();
    /* ⓫ 编年史归档（v5）：把这一回合攒下的 NOTES 全量抄进年表，顺带判一次
     * 统一 / 灭亡。放在最后一行 —— 它要看到"打完之后"的版图和纪要。 */
    if (AO.chronoArchive) AO.chronoArchive();
  }

  /* ---------------- ④ 人口税 + 俸禄 ----------------
   *   税 = 人口/popUnit × goldPerUnit[档] × (有官 ? taxMul : noOfficerMul) × happyTaxMul(民心)
   * 三个系数各管一件事，所以公式能一眼读出手算：
   *   goldPerUnit 税率档（轻 0.5 / 常 1 / 暴 2，每 popUnit=10 万人）
   *   taxMul      官员（理财能手 1.2 / 贪墨 1.4 / 治世能臣 1.25；无官 = 0.6）
   *   happyTaxMul 民心（0.6 ~ 1.2，民心 60 时正好 0.96）
   * 小数攒整（TAXACC）：一个 3 万人的小省在轻税档一回合只有 0.15 金，
   * 直接 round 会永远收不上来 —— 攒到整数才落袋，长期平均才准。
   *
   * 俸禄从**省库**发：发不起就记在官员身上（owed），下回合接着补，不罚款、不停职。
   * 这是"占位"里唯一一处"欠着也不罚"的地方 —— 罚了会让玩家不敢派官。 */
  function settleTax(pid, owner, prov, pmod) {
    var G = AO.GOV, bag = SIM[pid], F = FLOW[pid];
    if (!bag || !bag.gold) return 0;
    var rate = taxRateOf(owner);
    var popV = (POP[pid] && POP[pid].v) || (prov && prov.population) || 0;
    var hv = happyOf(pid).v;
    var off = OFFICIAL[pid | 0];
    var mul = (off ? (pmod ? pmod.taxMul : PMOD(pid, owner).taxMul) : G.noOfficerMul) *
      G.happyTaxMul(hv);
    /* 群龙无首（首都丢了）：税 ×0.7 —— 只是"收不上来"，不是"收不到"，
     * 所以它是乘在税上的系数，不动 popUnit / 税率档本身。 */
    if (isDecap(owner)) mul *= AO.BATTLE.decapTax;
    var raw = popV / G.popUnit * G.goldPerUnit[rate] * mul;
    TAXACC[pid] = (TAXACC[pid] || 0) + raw;
    var gain = Math.floor(TAXACC[pid]);
    TAXACC[pid] -= gain;
    if (gain > 0) {
      /* 人口税也是入库：和产出同一条规矩（150 上限，满仓记 d.cap） */
      var kept = gainStock(pid, 'gold', gain, F);
      if (F) {
        F.gain.gold = (F.gain.gold || 0) + kept;
        F.d.popTax = (F.d.popTax || 0) + kept;    // 数字，不是资源袋：省卡只显示一行
      }
    }
    if (off) {
      var due = G.salary + (off.owed || 0);
      var pay = Math.min(bag.gold.stock, due);
      if (pay > 0) {
        bag.gold.stock -= pay;
        if (F) {
          F.loss.gold = (F.loss.gold || 0) + pay;
          F.d.salary = (F.d.salary || 0) + pay;
        }
      }
      off.owed = due - pay;
    }
    return gain;
  }
  AO.resSettleTax = settleTax;

  /* ---------------- ⑤ 民心 ----------------
   * target = base + Σdrivers，v 每回合向 target 靠 happyLerp（30%）——
   * 不做跳变，是因为"停产一回合民心立刻掉到底、复工立刻回满"读起来像 bug；
   * 慢慢挪，玩家才有"这个省在慢慢变好/变坏"的体感。
   *
   * drivers 全部存进 HAPPY[pid].drivers，省卡和面板的悬停都直接读它 ——
   * 存明细而不是只存一个总分，是为了让玩家能回答"我这民心到底为什么低"。 */
  function settleHappy(pid, prov) {
    var G = AO.GOV, h = happyOf(pid);
    /* prov 可以不给（单点重算 / 测试）：从世界里反查一份 —— 不给的话
     * owner 会变成 0，税率与信仰这两项就全按"没有国家"算了。 */
    if (!prov && state.world) prov = state.world.provinces[(pid | 0) - 1];
    var owner = prov ? prov.owner : 0;
    var rate = taxRateOf(owner);
    var d = {
      base: G.happyBase,
      rate: G.happyHit[rate],          // 税率压力（0 / −4 / −12）
      food: 0,                         // 缺粮
      halt: 0, haltN: 0,               // 停产（每类 −3，封顶 −9）
      official: 0,                     // 官员 happyAdd
      market: 0,                       // 有在营市场
      faith: 0, faithN: 0,             // 信仰：省主流信仰 ≠ 国教
      war: 0, warN: 0                  // 战争层：占领 / 封锁 / 群龙无首 / 驻军扰民
    };
    var pop = POP[pid];
    if (pop && pop.need > 0 && pop.eat < pop.need) d.food = G.happyLackFood;

    /* 战争层的民心项，四项各管一件事（明细照样存进 drivers，面板能逐项回答）：
     *   占领   −10  （OCCUPY：地是你打下来的，人不是你的人）
     *   封锁   −5   （BLOCKADE：渔港停了，市面没鱼）
     *   无主   −10  （群龙无首：首都都丢了，人心散）
     *   驻军   贪墨将领驻省 −6（词条 fx.happy）
     * 不做"围城再扣一次"：围城已经把产出打到零，停产那 −3 自然会跟着扣，
     * 再叠一层会变成"一围城民心立刻归零"，读起来像 bug。 */
    if (OCCUPY[pid]) d.war += AO.BATTLE.occupyHappy;
    if (BLOCKADE[pid]) d.war += AO.BATTLE.blockadeHappy;
    if (isDecap(owner)) d.war += AO.BATTLE.decapHappy;
    var gar = armiesIn(pid), gi2;
    for (gi2 = 0; gi2 < gar.length; gi2++) {
      var gt = generalOf(gar[gi2]);
      var gh = gt ? (AO.milTraitOf(gt.traitKey).fx.happy || 0) : 0;
      if (gh) { d.war += gh; d.warN++; }
    }

    /* 停产的"类"数：七种资源建筑各算一类，学校/市场/建造坊各算一类。
     * 用类数而不是座数 —— 否则一个省停 3 座农场就等于停 3 类，惩罚翻倍。 */
    var bag = SIM[pid] || {}, k, s, n = 0;
    for (k in bag) {
      s = bag[k];
      if (s && s.built && s.halted) n++;
    }
    for (var i = 0; i < UNIV_KINDS.length; i++) {
      var st = UNIV[UNIV_KINDS[i]][pid];
      if (st && st.n > 0 && st.halted) n++;
    }
    d.haltN = n;
    /* happyHaltEach 本身是负数（−3），所以这里是**乘**、不是"减" ——
     * 再套一层负号会变成"停产反而 +3 民心"（这个符号错误当初是被 test/gov.js 抓到的）。 */
    d.halt = Math.max(G.happyHaltCap, G.happyHaltEach * n);

    var off = OFFICIAL[pid | 0];
    if (off) d.official = AO.traitOf(off.traitKey).fx.happyAdd || 0;
    var mk = MARKET[pid];
    if (mk && mk.n > 0 && !mk.halted) d.market = G.happyMarket;

    /* 信仰（B2）：省的主流信仰 ≠ 国教 → 按政策扣分（强制 −6 / 宽容 −2）。
     * 判定与数值全在 16-events.js（faithDriver），这里只把它记进 drivers ——
     * 悬停明细照样逐项显示，玩家能回答"我这民心到底为什么低"。 */
    d.faith = (AO.faithDriver && prov) ? AO.faithDriver(pid, owner) : 0;
    d.faithN = d.faith ? 1 : 0;

    var target = d.base + d.rate + d.food + d.halt + d.official + d.market + d.faith + d.war;
    h.target = AO.clamp(target, 0, 100);
    h.drivers = d;
    h.v = AO.clamp(h.v + (h.target - h.v) * G.happyLerp, 0, 100);
    return h;
  }
  AO.resSettleHappy = settleHappy;

  /* 民心明细 → 悬停文本（省卡 / 面板共用一份，免得两处写得不一样） */
  function happyTitle(pid) {
    var G = AO.GOV, h = happyOf(pid), d = h.drivers;
    var lines = ['民心 ' + Math.round(h.v) + ' / 100' + (d ? '　目标 ' + Math.round(h.target) : '')];
    if (!d) {
      lines.push('（还没结算过，开局 ' + G.happyStart + '）');
    } else {
      var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
      var rn = G.rateCn[taxRateOf(prov ? prov.owner : 0)];
      lines.push('基准 +' + d.base);
      lines.push('税率「' + rn + '」 ' + (d.rate >= 0 ? '+' : '') + d.rate);
      lines.push('缺粮 ' + (d.food ? d.food : '0') + (d.food ? '（口粮不够吃）' : '（吃饱了）'));
      lines.push('停产 ' + (d.haltN ? d.haltN + ' 类 → ' + d.halt : '0') + (d.haltN >= 3 ? '（已封顶）' : ''));
      lines.push('官员 ' + (d.official >= 0 ? '+' : '') + d.official);
      lines.push('市场 ' + (d.market ? '+' + d.market : '0'));
      /* 信仰：异信仰省写清"哪一家的信仰"，否则玩家只看到一个 −6 不知道扣在哪 */
      var fv = d.faith || 0;
      if (fv) {
        lines.push('异信仰（' + AO.faithName(prov ? prov.faithIdx : -1) + '） ' + fv +
          '（国教 ' + AO.faithName(AO.stateFaithOf(prov ? prov.owner : 0)) +
          ' · 政策「' + AO.FAITH.polCn[AO.faithPolOf(prov ? prov.owner : 0)] + '」）');
      } else {
        lines.push('信仰 同国教（' + AO.faithName(prov ? prov.faithIdx : -1) + '）');
      }
      lines.push('战争 ' + (d.war >= 0 ? '+' : '') + Math.round(d.war) +
        (d.war ? '（占领/封锁/群龙无首/驻军扰民）' : ''));
      lines.push('→ 目标 ' + Math.round(h.target) + '，本回合往它靠 ' + Math.round(G.happyLerp * 100) + '%');
    }
    lines.push('');
    lines.push('民心影响两件事：收税系数 ' + G.happyTaxMul(h.v).toFixed(2) +
      '（0.6 ~ 1.2）；人口增速（≤' + G.happyLow + ' 打折、≥' + G.happyHigh + ' 加成）');
    return lines.join('\n');
  }
  AO.resHappyTitle = happyTitle;

  /* 一条科技研完：记账、提示、然后**自动拉队列里的下一条**。
   * 冲刺钮（把倒计时砍到 0）和 settleResearch 共用这一个收尾。 */
  function finishResearch(owner) {
    var R = RESEARCH[owner];
    if (!R || !R.cur) return null;
    var t = AO.TECH_BY_KEY[R.cur.key];
    R.done[R.cur.key] = true;
    R.cur = null;
    if (t) {
      var d = t.for ? AO.RESOURCE_BY_KEY[t.for] : null;
      NOTES.push({ owner: +owner, cls: 'ok',
        text: '「' + t.cn + '」研究完成：' + (t.fx ? fxDesc(t) : t.mil ? milEffectText(t.mil) :
          (d ? d.build : t.for) + ' 可以盖/升 Lv2 了') });
    }
    pullQueue(owner);
    return t;
  }

  /* 队列头能不能开研：扣得起（科研点 + 国库资源）就扣费、转 cur。
   * 扣不起 → 停在队头不动，给一句提示，**不扣任何东西**。
   * 返回 'started' / 'wait' / null（没队）。 */
  function pullQueue(owner) {
    var R = RESEARCH[owner];
    if (!R || R.cur || !R.queue || !R.queue.length) return null;
    var key = R.queue[0];
    var t = AO.TECH_BY_KEY[key];
    if (!t) { R.queue.shift(); return pullQueue(owner); }
    if (R.done[key]) { R.queue.shift(); return pullQueue(owner); }
    if (!R.unlocked) return 'wait';
    if (t.req && !R.done[t.req]) return 'wait';
    var cen = ensureCentral(owner), k;
    if (R.pts < t.pts) {
      NOTES.push({ owner: +owner, cls: 'warn',
        text: '队列等待：「' + t.cn + '」还差 ' + (t.pts - R.pts) + ' 科研点，资源不足，队列等待' });
      return 'wait';
    }
    for (k in t.cost) {
      if ((cen[k] || 0) < t.cost[k]) {
        NOTES.push({ owner: +owner, cls: 'warn',
          text: '队列等待：「' + t.cn + '」国库' + cnOf(k) + '还差 ' + (t.cost[k] - (cen[k] || 0)) +
            '，资源不足，队列等待' });
        return 'wait';
      }
    }
    for (k in t.cost) cen[k] -= t.cost[k];
    R.pts -= t.pts;
    R.queue.shift();
    R.cur = { key: key, left: effectiveTurns(0, owner, t.turns) };
    /* 科研点的进出记在中央那本账上（pts 不是资源，单开一格） */
    var FC = FLOWC[owner];
    if (FC) {
      FC.loss.pts = (FC.loss.pts || 0) + t.pts;
      for (k in t.cost) FC.loss[k] = (FC.loss[k] || 0) + t.cost[k];
    }
    NOTES.push({ owner: +owner, cls: 'ok',
      text: '开始研究「' + t.cn + '」：' + t.pts + ' 科研点 · ' + costText(t.cost) +
        '，' + R.cur.left + ' 回合后完成' });
    return 'started';
  }

  /* 每回合的科研结算（国家层，跑在省循环之后：这一回合建的学校下回合才产点） */
  function settleResearch() {
    var w = state.world;
    if (!w) return;
    var cnt = Object.create(null), ucnt = Object.create(null), i, p;
    for (i = 0; i < w.provinces.length; i++) {
      p = w.provinces[i];
      if (!p) continue;
      if (OCCUPY[p.id]) continue;          // 占领省不提供科研（学校还开着，但不算数）
      var sch = SCHOOL[p.id];
      if (sch && sch.n > 0 && !sch.halted) cnt[p.owner] = (cnt[p.owner] || 0) + sch.n;
      /* 大学（内政批）：和学校同一条规矩 —— 不停产、不被占领才算数。
       * 它同时产科研点和人才点，所以下面两段都要把 un 加进去。 */
      var uni = UNIVERSITY[p.id];
      if (uni && uni.n > 0 && !uni.halted) ucnt[p.owner] = (ucnt[p.owner] || 0) + uni.n;
    }
    for (var ci in RESEARCH) {
      var R = RESEARCH[ci];
      var n = cnt[ci] || 0;
      var un = ucnt[ci] || 0;
      /* 群龙无首：科研减半（BATTLE.decapScience）—— 朝廷都没了，谁还管算学 */
      var decapMul = isDecap(+ci) ? AO.BATTLE.decapScience : 1;
      if (n > 0 || un > 0) {
        var gain = (n * AO.SCHOOL.per + un * AO.UNIVERSITY.perSci) * decapMul;
        R.pts += gain;
        var FC = FLOWC[ci];
        if (FC) FC.gain.pts = (FC.gain.pts || 0) + gain;
      }
      /* 人才点：**同一批学校 + 大学**顺手多产一份（不停课的才算）。
       * 走 addTalent：pts（能花）与 total（累计教育，只加不减）同时涨。
       * 科研点是国家的（研究科技用），人才点是治理层的，两笔钱不互通。 */
      addTalent(ci, n * AO.GOV.talentPerSchool + un * AO.UNIVERSITY.perTalent);
      if (!R.unlocked && R.pts >= AO.TECH_UNLOCK_PTS) {
        R.unlocked = true;
        NOTES.push({ owner: +ci, text: '科研条攒满 —— 科技树解锁，可以挑一条研究了', cls: 'ok' });
      }
      if (R.cur) {
        R.cur.left--;
        if (R.cur.left <= 0) finishResearch(ci);      // 完工后会自动拉队列下一条
      } else {
        pullQueue(ci);                                 // 空闲 → 看看队头能不能开研
      }
    }
  }

  /* =============================================================
   * 官员：开科取士 / 派遣 / 撤换
   *
   * 抽卡是**纯即时**的（不做动画）：点「开科取士」→ 扣点 → 摇词条 → 取名 → 进候选池。
   * 词条按 AO.TRAITS 的 w 做一次线性扫描（合计 100），不建累积表 ——
   * 抽一次只摇一次，累积表只会多一处能写错的地方。
   *
   * 派遣是免费的（v1）：一省一位、一人一省。派到已有官员的省会**替换**，
   * 旧的自动回池 —— 不弹确认框，撤换本身就是"点一下"的成本。
   * ============================================================= */
  function fmtPts(v) {
    return (Math.round(v * 10) / 10).toString();
  }

  function rollTrait() {
    var list = AO.TRAITS, total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].w || 0;
    var r = Math.random() * total;
    for (i = 0; i < list.length; i++) {
      r -= list[i].w || 0;
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /* 全世界的官员名字（候选池 + 在任）—— 去重只看名字，不看 id */
  function usedOffNames() {
    var set = Object.create(null), k, i;
    for (k in TALENT) {
      var pool = TALENT[k] && TALENT[k].pool || [];
      for (i = 0; i < pool.length; i++) if (pool[i]) set[pool[i].name] = 1;
    }
    for (k in OFFICIAL) if (OFFICIAL[k]) set[OFFICIAL[k].name] = 1;
    return set;
  }

  /* 取名：8 姓 × 12 名 = 96 种。先随机试 60 次，撞了就加个尾字（之/卿/甫…），
   * 还撞就加序号 —— 保证"重名率低"而不是"理论上可能重名"。 */
  function pickOffName() {
    var N = AO.OFF_NAMES, used = usedOffNames(), t, nm;
    function rnd() {
      return N.surnames[(Math.random() * N.surnames.length) | 0] +
        N.givens[(Math.random() * N.givens.length) | 0];
    }
    for (t = 0; t < 60; t++) {
      nm = rnd();
      if (!used[nm]) return nm;
    }
    var tail = ['之', '卿', '甫', '翁', '叟'], i;
    for (i = 0; i < tail.length; i++) if (!used[nm + tail[i]]) return nm + tail[i];
    var n = 2;
    while (used[nm + n]) n++;
    return nm + n;
  }

  /* 开科取士：扣点 → 抽一位 → 进池。返回 { ok, off, trait, msg }。 */
  function examOfficial(owner, silent) {
    if (!silent && !canAct(owner)) return { ok: false, msg: lockTitle() };
    var G = AO.GOV, T = talentOf(owner);
    if (T.pts < G.examCost) {
      return { ok: false, msg: '人才点不够：开科要 ' + G.examCost + '，现在只有 ' + fmtPts(T.pts) +
        '（每座不停课的学校 +' + G.talentPerSchool + ' / 回合）' };
    }
    T.pts -= G.examCost;
    var tr = rollTrait();
    var off = { id: GOV_ID++, name: pickOffName(), traitKey: tr.key, owed: 0 };
    T.pool.push(off);
    /* 抽到贪墨 / 治世能臣时推一条 —— 抽卡的戏剧感全靠这两句。
     * silent（敌国内政 AI）：这两条也不推 —— 一个国每几回合就抽一位，
     * 36 个国家一起抽的话，玩家的纪要里全是别人家的科场。 */
    if (!silent && tr.rar === 'bad') {
      NOTES.push({ owner: +owner, cls: 'warn',
        text: '开科大典：' + off.name + ' 门路最广，中了 —— 「' + tr.cn + '」（' + tr.desc + '）' });
    } else if (!silent && tr.rar === 'gold') {
      NOTES.push({ owner: +owner, cls: 'ok',
        text: '开科大典：' + off.name + ' 对策问对答如流 —— 「' + tr.cn + '」（' + tr.desc + '）' });
    }
    return { ok: true, off: off, trait: tr };
  }

  /* 派一位候选去某省上任。一省一位：原来那位自动回池。 */
  function assignOfficial(pid, offId, silent) {
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (!prov) return { ok: false, msg: '没有这个省' };
    if (!silent && !canAct(prov.owner)) return { ok: false, msg: lockTitle() };
    var T = talentOf(prov.owner), idx = -1, i;
    for (i = 0; i < T.pool.length; i++) if (T.pool[i].id === offId) { idx = i; break; }
    if (idx < 0) return { ok: false, msg: '这位不在候选池里（可能已经上任了）' };
    var cur = OFFICIAL[pid | 0];
    if (cur) T.pool.push(cur);
    var off = T.pool.splice(idx, 1)[0];
    off.owed = off.owed || 0;
    OFFICIAL[pid | 0] = off;
    return { ok: true, off: off, replaced: cur || null };
  }

  /* 撤换：在任的回候选池（免费，随便调） */
  function dismissOfficial(pid, silent) {
    var off = OFFICIAL[pid | 0];
    if (!off) return null;
    var pv0 = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (pv0 && !silent && !canAct(pv0.owner)) return null;
    delete OFFICIAL[pid | 0];
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    talentOf(prov ? prov.owner : 0).pool.push(off);
    return off;
  }

  /* 一国现在有几位在任（面板顶部与底部合计用） */
  function officialsOf(owner) {
    var out = [];
    if (!state.world) return out;
    var list = countryProvinces(owner);
    for (var i = 0; i < list.length; i++) {
      var off = OFFICIAL[list[i].id];
      if (off) out.push({ pid: list[i].id, off: off, prov: list[i] });
    }
    return out;
  }
  AO.resExam = examOfficial;
  AO.resAssign = assignOfficial;
  AO.resDismiss = dismissOfficial;
  AO.resOfficialsOf = officialsOf;
  AO.resRollTrait = rollTrait;

  /* ---------------- 人口：吃粮、涨落 ----------------
   * 口粮：**每 200 万人每回合吃 1 单位**（先粮食、再渔获）。
   * 涨落看的是"本回合产出 vs 口粮"，不是库存 —— 这样人口不会一路涨到把存粮吃光：
   *   产出 − 口粮 ≥ 3 → +1.2%/回合
   *   产出 − 口粮 ≥ 1 → +0.4%/回合
   *   产出刚够吃（差 0~1）→ 不涨不跌，人口停在这儿
   *   产出不够吃 → 先吃存粮；存粮也见底才 −1.5%（真饥荒）
   * 于是"每回合净余 1 单位"就是人口的天然上限：想让人口再涨，就多盖农场/渔港。 */
  function settlePop(pid, foodProd) {
    var s = POP[pid], bag = SIM[pid];
    if (!s || !bag) return;
    var need = Math.max(1, Math.round(s.v / 2000000));
    var g = bag.grain, f = bag.fish;
    var eat = 0;
    var F = (CUR.pid === (pid | 0)) ? CUR.F : null;
    var t1 = Math.min(g ? g.stock : 0, need);
    if (t1 > 0) {
      g.stock -= t1; eat += t1;
      if (F) { F.loss.grain = (F.loss.grain || 0) + t1; F.d.eat.grain = (F.d.eat.grain || 0) + t1; }
    }
    if (eat < need) {
      var t2 = Math.min(f ? f.stock : 0, need - eat);
      if (t2 > 0) {
        f.stock -= t2; eat += t2;
        if (F) { F.loss.fish = (F.loss.fish || 0) + t2; F.d.eat.fish = (F.d.eat.fish || 0) + t2; }
      }
    }
    var surplus = (foodProd || 0) - need;     // 本回合产出减去口粮
    var rate;
    if (eat < need) rate = -0.015;            // 连存粮都吃不上
    else if (surplus >= 3) rate = 0.012;
    else if (surplus >= 1) rate = 0.004;
    else rate = 0;                            // 刚够吃：人口稳定，不再动存粮
    /* 民心修正：≤30 打折、≥70 加成。只乘**正向**速率 ——
     * 闹饥荒的时候再按民心多扣一层，会变成"越惨掉得越快"的雪崩。
     * 用的是上一回合结算后的民心（settleHappy 在本函数之后跑），
     * 所以面板上的"增速"和"民心"永远对得上：都是同一次结算的输入。 */
    var G = AO.GOV, hv = happyOf(pid).v, hm = 1;
    if (rate > 0) {
      if (hv <= G.happyLow) hm = G.popLowMul;
      else if (hv >= G.happyHigh) hm = G.popHighMul;
      rate *= hm;
    }
    s.happyMul = hm;
    s.v = Math.max(1000, Math.round(s.v * (1 + rate)));
    s.rate = rate;
    s.need = need;
    s.eat = eat;
    s.prod = foodProd || 0;
  }

  /* ---------------- 建造：吃国家资源 ---------------- */
  function stockOf(pid, key) {
    var b = SIM[pid];
    return b && b[key] ? b[key].stock : 0;
  }

  /* ---------------- 库存上限（粮仓 / 满仓损耗） ----------------
   * **只掐增量、不动存量**：上限回落（粮仓停产）或者老档里本来就超过上限时，
   * 已经囤着的东西不会被抄走 —— 玩家看到"停产扣存粮"只会觉得是 bug。 */
  function capOf(pid, key) {
    var base = (AO.CAP && AO.CAP.base) || 150;
    if (key !== 'grain' && key !== 'fish') return base;
    var g = GRANARY[pid | 0];
    /* 粮仓停产 → capBonus 失效（仓子没人看着，粮食存在仓里也是白搭） */
    if (!g || !(g.n > 0) || g.halted) return base;
    var GD = AO.GRANARY;
    return base + Math.min(g.n, GD.maxPer) * GD.capBonus;
  }
  AO.resCapOf = capOf;

  /* 入库：返回**真正落袋**的数量。超出上限的部分记进 FLOW 的 d.cap，
   * 收支小结会写「满仓 −N」—— 浪费必须可见，否则玩家只看到"产出 3 进账 1"。 */
  function gainStock(pid, key, n, F) {
    if (!(n > 0)) return 0;
    var b = SIM[pid], s = b && b[key];
    if (!s) return 0;
    var room = capOf(pid, key) - s.stock;
    if (room >= n) { s.stock += n; return n; }
    if (room < 0) room = 0;
    s.stock += room;
    if (F && F.d) F.d.cap[key] = (F.d.cap[key] || 0) + (n - room);
    return room;
  }
  AO.resGainStock = gainStock;

  /* 哪些省属于这个国家。**按世界缓存**：payCost 每建一座都要扫一遍同国各省，
   * 而 1100 省的世界里这个循环要跑几千次 —— 缓存之后一次世界只算一遍。
   * 返回的数组只读（调用方都只 filter / sort 出新数组），所以共享是安全的。 */
  var CPROV = { w: null, map: null };
  function countryProvinces(owner) {
    var w = state.world;
    if (!w) return [];
    if (CPROV.w !== w || !CPROV.map) { CPROV.w = w; CPROV.map = Object.create(null); }
    var hit = CPROV.map[owner];
    if (hit) return hit;
    var out = [];
    for (var i = 0; i < w.provinces.length; i++) {
      var q = w.provinces[i];
      if (q && q.owner === owner) out.push(q);
    }
    CPROV.map[owner] = out;
    return out;
  }

  function cnOf(key) {
    var d = AO.RESOURCE_BY_KEY[key];
    return d ? (d.prod || d.cn) : key;
  }

  function costText(cost) {
    var a = [];
    for (var k in cost) a.push(cnOf(k) + ' ' + cost[k]);
    return a.join(' · ');
  }

  /* 付账：本省库存 → 中央国库 → 从同国富裕省调拨（按损耗放大需求量）。
   * 先全部核算，凑齐了才真扣，避免"扣了一半又失败"。 */
  function payCost(p, cost) {
    var keys = Object.keys(cost), i, k;
    var short = {}, fromCentral = {};
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      short[k] = Math.max(0, cost[k] - stockOf(p.id, k));
    }
    var cen = ensureCentral(p.owner);
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!short[k]) continue;
      var tc = Math.min(cen[k] || 0, short[k]);
      if (tc > 0) { fromCentral[k] = tc; short[k] -= tc; }
    }
    var loss = effectiveLoss(p.id, p.owner);
    var need = {}, list = countryProvinces(p.owner);
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!short[k]) continue;
      need[k] = Math.ceil(short[k] / (1 - loss));    // 路上会损耗，得多调一点
      var avail = 0;
      for (var j = 0; j < list.length; j++) {
        if (list[j].id !== p.id) avail += stockOf(list[j].id, k);
      }
      if (avail < need[k]) {
        return { ok: false, lack: k, need: need[k] - avail, loss: loss };
      }
    }

    /* 真扣：本省 */
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      var take = Math.min(stockOf(p.id, k), cost[k]);
      if (take > 0) SIM[p.id][k].stock -= take;
    }
    /* 真扣：中央 */
    for (k in fromCentral) cen[k] -= fromCentral[k];
    /* 真扣：同国富裕省（按该资源库存从多到少） */
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!short[k]) continue;
      var want = need[k];
      var donors = list.filter(function (q) { return q.id !== p.id; });
      donors.sort(function (a, b) { return stockOf(b.id, k) - stockOf(a.id, k); });
      for (var d = 0; d < donors.length && want > 0; d++) {
        var got = Math.min(stockOf(donors[d].id, k), want);
        if (got > 0) { SIM[donors[d].id][k].stock -= got; want -= got; }
      }
    }
    return { ok: true, loss: loss };
  }

  /* 空提示：silent 调用（敌国内政 AI）拿它顶替 bldMsg。
   * 语义上就应该是"没有这个动作"，所以不返回任何东西 —— 调用点写着
   * `return say(...)` 时也就是提前 return undefined，和原来 `return bldMsg(...)` 同形。 */
  function noop() {}

  function bldMsg(text, cls) {
    var el = $('bldMsg');
    if (el) {
      el.textContent = text || '';
      el.className = 'bldmsg' + (cls ? ' ' + cls : '');
    }
    /* 全屏科技树开着的时候，同一句话写进 overlay 顶栏下那一行 ——
     * 否则提示落在被盖住的省份卡里，等于没说。 */
    if (typeof TT !== 'undefined' && TT.open) { ttMsg(text, cls); return; }
    /* 治理面板同理（它盖住整屏，省份卡的提示一个字都看不见） */
    if (typeof GP !== 'undefined' && GP.open) { govMsg(text, cls); return; }
    /* 省份卡没开着的时候（比如在国家卡里点「研究」），同一句话用 toast 兜一下 ——
     * 否则提示写在一块看不见的地方。 */
    var info = $('info');
    if (text && info && !info.classList.contains('on')) toast(text, 2600);
  }

  /* 这个国家有没有研究出某种建筑对应的 Lv2 科技 */
  function researched(owner, key) {
    var t = AO.techFor(key);
    var R = RESEARCH[owner];
    return !!(t && R && R.done[t.key]);
  }

  /* 现在盖/升一座该花哪个价：科技研出来就是 cost2，否则 cost */
  function costOf(def, lv2) { return (lv2 && def.cost2) ? def.cost2 : def.cost; }

  /* 维护费的读法：「铁 0.2 · 金 0.2 /座·回合」。
   * 这里用简称（铁/金）而不是产物名（铁锭/金锭）—— 维护是一笔日常开销，
   * 写在档位格子里只有几个字的宽度，长名字会撑到换行。
   * 传了 owner 就按「标准工料」打折 —— ? 面板的数字必须和实际扣款一致。 */
  var MAINT_CN = { iron: '铁', gold: '金' };
  function maintText(m, owner) {
    var a = [];
    var cut = owner ? 1 - (MODS(owner).maintCut || 0) : 1;
    for (var k in m) {
      /* 累加过的小数会带出 0.6000000000000001 这种尾巴，收敛到一位 */
      var v = Math.round((m[k] || 0) * cut * 10) / 10;
      a.push((MAINT_CN[k] || cnOf(k)) + v);   // 铁0.2 · 金0.2（紧凑，档位格子窄）
    }
    return a.length ? a.join(' · ') : '无';
  }

  /* 建一座：付账 → 开工（工期由货运等级决定）。
   * 科技已研 → 新盖的直接是 Lv2（付 cost2）；否则 Lv1（付 cost）。
   *
   * silent=true 是给敌国内政 AI（18-ai.js）用的：不检查玩家锁、不写 bldMsg。
   * 为什么同一个函数走两遍而不是另写一套"AI 建造"：付账顺序（本省 → 中央 →
   * 同国调拨）、工期、调拨损耗全在这里，抄一份出去迟早两边对不上账。
   * AI 也不该弹提示条 —— 36 个国家每回合各盖一座，弹一次就吃掉玩家的界面。 */
  function buildOne(p, key, silent) {
    var say = silent ? noop : bldMsg;
    var def = AO.RESOURCE_BY_KEY[key];
    var s = SIM[p.id] && SIM[p.id][key];
    if (!def || !s) return;
    if (!silent && !canAct(p.owner)) return say(lockTitle(), 'warn');
    if (s.gone) return say(def.build + ' 的矿脉已枯竭，不能再建', 'warn');
    if (s.site > 0) return say(def.build + ' 还在建（剩 ' + s.site + ' 回合）', 'warn');
    var lv2 = researched(p.owner, key);
    var cost = costOf(def, lv2);
    var r = payCost(p, cost);
    if (!r.ok) {
      return say('资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need + '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    s.site = effectiveTurns(p.id, p.owner);
    s.siteKind = 'new';
    s.siteTier = lv2 ? 2 : 1;
    say(def.build + (lv2 ? ' Lv2 ' : ' ') + '开工：' + costText(cost) + '，' + s.site + ' 回合后完工' +
      (r.loss > 0.01 ? '（调拨损耗 ' + Math.round(r.loss * 100) + '%）' : ''), 'ok');
  }

  /* 升档：把**最旧的一座** Lv1 花钱改成 Lv2（科技已研才开放）。
   * 复用现有工地队列，只多一个 siteKind='up'，完工时 tiers[1]-- / tiers[2]++。
   * 自愿原则：不升的旧建筑照常出产，只要维护付得起。 */
  function upgradeBuilding(p, key) {
    var def = AO.RESOURCE_BY_KEY[key];
    var s = SIM[p.id] && SIM[p.id][key];
    if (!def || !s) return;
    if (!canAct(p.owner)) return bldMsg(lockTitle(), 'warn');
    var tech = AO.techFor(key);
    if (!researched(p.owner, key)) {
      return bldMsg('还没研究「' + (tech ? tech.cn : '对应科技') + '」，' + def.build + ' 升不了 Lv2', 'warn');
    }
    if (s.gone) return bldMsg(def.build + ' 的矿脉已枯竭，升了也没用', 'warn');
    if (s.site > 0) return bldMsg(def.build + ' 还有工地在建（剩 ' + s.site + ' 回合）', 'warn');
    if (!(s.tiers[1] > 0)) return bldMsg('没有可升的旧 ' + def.build + '（Lv1 已经升完了）', 'warn');
    var cost = def.cost2 || def.cost;
    var r = payCost(p, cost);
    if (!r.ok) {
      return bldMsg('升档资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need + '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    s.site = effectiveTurns(p.id, p.owner);
    s.siteKind = 'up';
    bldMsg(def.build + ' 升 Lv2 开工：' + costText(cost) + '，' + s.site + ' 回合后完工' +
      '（产量 ' + def.per + ' → ' + (def.per2 || def.per) + '）', 'ok');
  }

  /* 建一所学校：付账 → 开工。学校是最早的科研点来源（大学是第二个，见 AO.UNIVERSITY）。 */
  function buildSchool(p) {
    return buildUniv(p, 'school');
  }

  /* 三种通用设施共用一条建造流程：付账 → 开工（工期吃货运 + 学徒制）。
   * 内政批之后这里是**五件套**：学校 / 市场 / 建造坊 / 粮仓 / 大学。 */
  function buildUniv(p, kind, silent) {
    var say = silent ? noop : bldMsg;
    var D = univDef(kind);
    var st = univOf(kind, p.id);
    if (!silent && !canAct(p.owner)) return say(lockTitle(), 'warn');
    if (st.site > 0) return say(D.cn + '还在建（剩 ' + st.site + ' 回合）', 'warn');
    /* 教育门槛（只有大学有）：和装备厂读同一套累计教育 */
    if (D.needTier) {
      var edu = talentOf(p.owner).total || 0;
      if (edu < D.needTier) {
        return say(D.cn + '要累计教育 ' + D.needTier + '（现在 ' + Math.floor(edu) +
          '）—— 建学校、等人才点慢慢攒', 'warn');
      }
    }
    /* 粮仓 3 座封顶（再多就是纯堆数值，没有决策） */
    if (kind === 'granary' && st.n >= AO.GRANARY.maxPer) {
      return say('这个省已经有 ' + st.n + ' 座粮仓（上限 ' + AO.GRANARY.maxPer + ' 座）', 'warn');
    }
    var r = payCost(p, D.cost);
    if (!r.ok) {
      return say('资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need + '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    st.site = effectiveTurns(p.id, p.owner, D.turnsAt());
    var tail = kind === 'school' ? '（每座每回合 +' + AO.SCHOOL.per + ' 科研点）'
      : kind === 'market' ? '（每座可把 ' + AO.MARKET.rate + ' 单位资源换成 1 金）'
        : kind === 'granary' ? '（每座 +' + AO.GRANARY.capBonus + ' 粮/渔上限）'
          : kind === 'university' ? '（每座每回合 +' + AO.UNIVERSITY.perSci + ' 科研点 · +' +
            AO.UNIVERSITY.perTalent + ' 人才点）'
            : '（有它才能冲刺工期：' + costText(AO.BUILDER.sprintCost) + ' 砍 1 回合）';
    say(D.cn + '开工：' + costText(D.cost) + '，' + st.site + ' 回合后完工' + tail, 'ok');
  }
  function buildMarket(p) { return buildUniv(p, 'market'); }
  function buildBuilder(p) { return buildUniv(p, 'builder'); }

  /* 卖资源换金：本省库存直接扣 rate 份、加 1 金。库存不够 → 调用方把按钮置灰。
   * **只做手动**：v1 不做自动交易（那会把沙盒变成挂机游戏）。 */
  function sellResource(p, key) {
    if (!canAct(p.owner)) return bldMsg(lockTitle(), 'warn');
    var M = AO.MARKET, mk = MARKET[p.id];    if (!mk || !(mk.n > 0)) return bldMsg('本省还没有市场', 'warn');
    if (mk.halted) return bldMsg('市场维护欠费，停产中（卖不了货）', 'warn');
    var s = SIM[p.id] && SIM[p.id][key];
    if (!s) return;
    if (s.stock < M.rate) return bldMsg(cnOf(key) + ' 不够：要 ' + M.rate + '，只有 ' + s.stock, 'warn');
    s.stock -= M.rate;
    var g = SIM[p.id].gold;
    /* 卖货的金也吃上限（满仓 → 钱白赚了，记 d.cap 让玩家看得见） */
    if (g) gainStock(p.id, 'gold', 1, FLOW[p.id]);
    bldMsg('卖 ' + M.rate + ' ' + cnOf(key) + ' → +1 金（本省库存 ' + s.stock + ' ' + cnOf(key) +
      (g ? ' · 金 ' + g.stock + ' / 上限 ' + capOf(p.id, 'gold') : '') + '）', 'ok');
  }

  /* 买货：省库金 → 中央进货 → 进本省库存。这是省库的**第二种花法**
   * （第一种是发俸禄、建东西）。价格比卖价贵得多是故意的：
   * 中央进货是应急口（缺粮救荒、缺铁复工），不是稳定的套利路径。
   * 中央没货 → 调用方把按钮置灰（这里再挡一次，防止连点）。 */
  function buyResource(p, key) {
    if (!canAct(p.owner)) return bldMsg(lockTitle(), 'warn');
    if (BLOCKADE[p.id]) return bldMsg('本省被舰队封锁，买不了货', 'warn');
    var lot = AO.GOV.buyLot();
    var cen = ensureCentral(p.owner);
    var bag = SIM[p.id], g = bag && bag.gold, s = bag && bag[key];
    if (!g || !s) return;
    var have = cen[key] || 0;
    if (have < lot.n) {
      return bldMsg('中央' + cnOf(key) + '只剩 ' + Math.floor(have) + '，不够进一次货（要 ' + lot.n + '）', 'warn');
    }
    if (g.stock < lot.gold) {
      return bldMsg('省库金不够：进货要 ' + lot.gold + '，省库只有 ' + g.stock, 'warn');
    }
    cen[key] = have - lot.n;
    g.stock -= lot.gold;
    /* 进货进省库：同样受上限约束（满仓再买 = 白花钱，提示里说清楚） */
    var got = gainStock(p.id, key, lot.n, FLOW[p.id]);
    bldMsg('买 ' + lot.n + ' ' + cnOf(key) + ' ← ' + lot.gold + ' 金（省库 ' + g.stock +
      ' 金 · 中央剩 ' + Math.floor(cen[key]) + ' ' + cnOf(key) + '）' +
      (got < lot.n ? '　⚠ 省库满仓，只收下 ' + got + '（上限 ' + capOf(p.id, key) + '）' : ''), 'ok');
  }
  AO.resBuy = buyResource;

  /* 冲刺：把本省某个工地砍 1 回合。**没有建造坊（或它停产）就不给这个能力** ——
   * 这正是建造坊的价值。砍到 0 立刻 finishSite 完工，不用等下一回合。 */
  function sprintSite(p, key) {
    if (!canAct(p.owner)) return bldMsg(lockTitle(), 'warn');
    var def = AO.RESOURCE_BY_KEY[key];
    var s = def ? (SIM[p.id] && SIM[p.id][key]) : (UNIV[key] && UNIV[key][p.id]);
    if (!s || !(s.site > 0)) return;
    var B = BUILDER[p.id];
    if (!B || !(B.n > 0)) return bldMsg('本省没有建造坊，冲不了工', 'warn');
    if (B.halted) return bldMsg('建造坊维护欠费，停产中 —— 冲不了工', 'warn');
    var r = payCost(p, AO.BUILDER.sprintCost);
    if (!r.ok) return bldMsg('冲刺还差 ' + cnOf(r.lack) + ' ' + r.need, 'warn');
    s.site--;
    var name = def ? def.build : univDef(key).cn;
    if (s.site <= 0) {
      finishSite(p.id, key);
      bldMsg(name + ' 冲刺完工（' + costText(AO.BUILDER.sprintCost) + '）', 'ok');
    } else {
      bldMsg(name + ' 冲刺：还剩 ' + s.site + ' 回合（' + costText(AO.BUILDER.sprintCost) + '）', 'ok');
    }
  }

  /* 全国有没有"能用"的建造坊（有几座、且没停产）。研究冲刺的门槛。 */
  function hasBuilder(owner) {
    var w = state.world;
    if (!w) return false;
    for (var i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (!p || p.owner !== owner) continue;
      var b = BUILDER[p.id];
      if (b && b.n > 0 && !b.halted) return true;
    }
    return false;
  }

  /* 研究冲刺：钱从**中央**扣（研究是国家工程），倒计时 −1，到 0 走完工逻辑。 */
  function sprintResearch(owner) {
    if (!canAct(owner)) return bldMsg(lockTitle(), 'warn');
    var R = researchOf(owner);
    if (!R.cur) return;
    if (!hasBuilder(owner)) return bldMsg('全国没有可用的建造坊，冲不了工', 'warn');
    var cen = ensureCentral(owner), k;
    var cost = AO.BUILDER.sprintCost;
    for (k in cost) {
      if ((cen[k] || 0) < cost[k]) {
        return bldMsg('国库不够：' + cnOf(k) + ' 还差 ' + (cost[k] - (cen[k] || 0)), 'warn');
      }
    }
    for (k in cost) cen[k] -= cost[k];
    var t = AO.TECH_BY_KEY[R.cur.key];
    R.cur.left--;
    if (R.cur.left <= 0) {
      finishResearch(owner);
      bldMsg('「' + (t ? t.cn : '') + '」冲刺完工（' + costText(cost) + '）', 'ok');
    } else {
      bldMsg('「' + (t ? t.cn : '') + '」冲刺：还剩 ' + R.cur.left + ' 回合（' + costText(cost) + '）', 'ok');
    }
  }

  /* 点科技节点 = **入队**，不扣费。队头每回合由 settleResearch 检查能不能开研。
   * 已经在队里的再点一次 = 取消（还没扣费，直接移除，不会误扣）。 */
  function startResearch(owner, key) {
    if (!canAct(owner)) return bldMsg(lockTitle(), 'warn');
    var R = researchOf(owner);
    var t = AO.TECH_BY_KEY[key];
    if (!t) return;
    if (!R.unlocked) return bldMsg('科研条还没攒满（' + R.pts + ' / ' + AO.TECH_UNLOCK_PTS + '）', 'warn');
    if (R.done[key]) return bldMsg('「' + t.cn + '」已经研究过了', 'warn');
    if (R.cur && R.cur.key === key) return bldMsg('「' + t.cn + '」正在研究（剩 ' + R.cur.left + ' 回合）', 'warn');
    var qi = R.queue.indexOf(key);
    if (qi >= 0) {
      R.queue.splice(qi, 1);
      return bldMsg('已从队列移除「' + t.cn + '」（还没扣费，不损失任何东西）', 'ok');
    }
    if (t.req && !R.done[t.req]) {
      var pa = AO.TECH_BY_KEY[t.req];
      return bldMsg('「' + t.cn + '」在树上还锁着：要先研究「' + (pa ? pa.cn : t.req) + '」', 'warn');
    }
    R.queue.push(key);
    bldMsg('已入队（第 ' + R.queue.length + ' 位）「' + t.cn + '」：队头轮到它时才会扣 ' +
      t.pts + ' 科研点 · ' + costText(t.cost), 'ok');
  }

  /* 货运升级：损耗更低、工期更短（造价固定，见 AO.FREIGHT.costAt） */
  function upgradeFreight(p) {
    if (!canAct(p.owner)) return bldMsg(lockTitle(), 'warn');
    var lv = FREIGHT_LV[p.id] || 0;
    if (lv >= AO.FREIGHT.maxLv) return bldMsg('货运已满级（Lv' + lv + '）', 'warn');
    var cost = AO.FREIGHT.costAt(lv);
    var r = payCost(p, cost);
    if (!r.ok) {
      return bldMsg('升级货运还差 ' + cnOf(r.lack) + ' ' + r.need, 'warn');
    }
    FREIGHT_LV[p.id] = lv + 1;
    var dLoss = Math.round((AO.FREIGHT.lossAt(lv) - AO.FREIGHT.lossAt(lv + 1)) * 100);
    var dTurn = AO.FREIGHT.turnsAt(lv) - AO.FREIGHT.turnsAt(lv + 1);
    bldMsg('货运升到 Lv' + (lv + 1) + '（' + costText(cost) + '）：调拨损耗 −' + dLoss + '%' +
      (dTurn > 0 ? '，建造工期 −' + dTurn + ' 回合' : ''), 'ok');
  }

  /* ---------------- 城墙（城防值）----------------
   * 状态形状照货运站：一省一座、升级制、维护欠费就停（这里是"失修"）。
   * 这一节只管**墙怎么变**；墙怎么挨打在会战（fight）和轰击（stepArmy）两处。
   *
   * 三条纪律：
   *   ① 城墙读的永远是**真实数据**（迷雾只遮显示，不影响战斗计算）；
   *   ② 围城完全不碰城墙（settleSieges 一行都不改）—— 饿死绕开墙；
   *   ③ 「营造」是行为型词条，不写进 TRAIT fx，只在这里查驻防将领。 */
  function newWall() {
    return { lv: 0, site: 0, hp: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
  }
  /* 惰性创建：没墙的省不占内存，也不进存档 */
  function wallOf(pid) {
    return WALL[pid] || (WALL[pid] = newWall());
  }
  function wallMaxOf(w) { return AO.WALL.maxHp(w ? w.lv : 0); }
  /* 这一级墙每回合的维护（铁 + 金），吃「标准工料」的折扣 */
  function wallMaintDue(w, owner) {
    var m = AO.WALL.maintAt(w ? w.lv : 0);
    var cut = owner ? 1 - (MODS(owner).maintCut || 0) : 1;
    return { iron: (m.iron || 0) * cut, gold: (m.gold || 0) * cut };
  }
  /* 这个省有没有「营造」将驻防（有 → 墙回得快、守城胜后回充） */
  function fabricOf(pid, owner) {
    var list = armiesIn(pid);
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.owner !== owner) continue;
      var tr = genTrait(generalOf(a));
      if (tr && tr.key === 'fabric') return a;
    }
    return null;
  }
  /* 完工：加高一段 → 直接顶到新上限（不然升级反而"变脆"） */
  function finishWall(pid) {
    var w = WALL[pid];
    if (!w) return;
    var W = AO.WALL;
    w.lv = Math.min(W.maxLv, w.lv + 1);
    w.site = 0;
    w.hp = W.maxHp(w.lv);
    w.halted = false;
    var p = pOf(pid);
    WARLOG.unshift({ turn: turnNo, cls: 'ok',
      text: '🧱 ' + (p ? p.name : '?') + ' 城墙升到 Lv' + w.lv + '（' + W.lvCn[w.lv] +
        '）：耐久上限 ' + W.maxHp(w.lv) });
    if (WARLOG.length > LOG_MAX) WARLOG.length = LOG_MAX;
  }
  /* 砌墙 / 加高一级：付账 → 开工（工期吃货运等级与学徒制，和别的工程一致） */
  function upgradeWall(p) {
    if (!canAct(p.owner)) return bldMsg(lockTitle(), 'warn');
    var W = AO.WALL, w = wallOf(p.id);
    if (w.lv >= W.maxLv) return bldMsg('城墙已满级（' + W.lvCn[W.maxLv] + ' Lv' + W.maxLv + '）', 'warn');
    if (w.site > 0) return bldMsg('城墙还有工地在建（剩 ' + w.site + ' 回合）', 'warn');
    var cost = W.costAt(w.lv);
    var r = payCost(p, cost);
    if (!r.ok) {
      return bldMsg('砌墙资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need +
        '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    var next = w.lv + 1;
    w.site = Math.max(1, effectiveTurns(p.id, p.owner, W.turnsAt(w.lv)));
    bldMsg(W.lvCn[next] + '城墙开工：' + costText(cost) + '，' + w.site + ' 回合后完工' +
      '（耐久上限 ' + W.maxHp(w.lv) + ' → ' + W.maxHp(next) + '）', 'ok');
  }

  /* 建筑插图（内联 SVG，每一级一个造型） ----------------
   * 风格照着 assets 里那套手绘图来：**粗墨线 + 平涂 2~4 色 + 简单几何**，
   * 44×44 的画布，缩到 19px 也认得出是什么。
   * 关键：**Lv1 / Lv2 是两个不同的造型**，不是同一张图加个框 ——
   *   铁矿场  矿洞 → 高炉（烟囱冒烟）
   *   金矿场  井架 → 井架 + 选矿厂 + 金锭
   *   农场    红顶谷仓 → 谷仓 + 筒仓
   *   牧场    马厩棚 → 大马厩 + 干草堆 + 栅栏
   *   伐木场  木屋 + 原木 → 木屋 + 锯架 + 原木堆
   *   渔港    栈桥 + 小帆船 → 双栈桥 + 大帆船
   *   盐场    盐池 → 盐池 + 风车
   * 想换回 assets 里那套 PNG 手绘图：把 AO.BLD_ART 改成 'png'（一行）。 */
  var ART_INK = '#2f353b', ART_WOOD = '#c99e6d', ART_WOODD = '#a97b4a',
      ART_STONE = '#b8c2ca', ART_DARK = '#3f4952', ART_CREAM = '#f4ecdc',
      ART_RED = '#b5573c', ART_WATER = '#a8cbd1', ART_GOLD = '#e3b95a',
      ART_SLATE = '#5b6b7a';

  /* 一段路径：d + 填充色 + 描边宽（0 = 不描边；fill 传 null = 只描边） */
  function ap(d, fill, sw) {
    return '<path d="' + d + '" fill="' + (fill || 'none') + '"' +
      (sw === 0 ? '' : ' stroke="' + ART_INK + '" stroke-width="' + (sw || 2.2) +
        '" stroke-linejoin="round" stroke-linecap="round"') + '/>';
  }
  /* 屋顶上的小旗（Lv2 的通用记号） */
  function apFlag(x, y, h) {
    h = h || 5;
    return '<path d="M' + x + ' ' + y + 'v-' + h + '" stroke="' + ART_INK + '" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M' + x + ' ' + (y - h) + 'l5.5 1.8-5.5 1.8z" fill="' + ART_RED + '" stroke="' + ART_INK + '" stroke-width="1.2" stroke-linejoin="round"/>';
  }

  var ART = {
    iron: {
      1: [  /* 矿洞：石壁 + 木支架 + 黑洞口 */
        ['M6 40V22h32v18z', ART_STONE],
        ['M8.5 22h27v5h-27z', ART_WOOD],
        ['M12 27v13M28 27v13', ART_WOOD, 2.8],
        ['M16 40v-8.5a6 6 0 0 1 12 0v8.5z', ART_DARK],
        ['M6 30h2.5M35.5 30H38', ART_STONE, 1.2]
      ],
      2: [  /* 高炉：宽基座 + 炉身 + 烟囱冒烟 + 出铁口 */
        ['M11 40V27h22v13z', ART_STONE],
        ['M15 27V15h14v12z', ART_STONE],
        ['M12.5 15h19v-4h-19z', ART_DARK],
        ['M26 11h5.5v4.5H26z', ART_STONE],
        '<circle cx="28.7" cy="7" r="2" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.5"/>',
        '<circle cx="31" cy="3.2" r="1.3" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.3"/>',
        ['M19 40v-7a4 4 0 0 1 8 0v7z', ART_DARK],
        ['M20.5 35h5v2.5h-5z', ART_GOLD, 0],
        ['M11 33h22', null, 1.2]
      ]
    },
    gold: {
      1: [  /* 井架 + 矿车（没有房子） */
        ['M13 40L22 14l9 26', null, 2.4],
        ['M17 28h10', null, 2],
        '<circle cx="22" cy="14" r="2.1" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.8"/>',
        ['M26 33h10l-2 5h-6z', ART_DARK],
        '<circle cx="27.5" cy="39.2" r="1.6" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.5"/>',
        '<circle cx="33" cy="39.2" r="1.6" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.5"/>'
      ],
      2: [  /* 高井架 + 大矿车 + 金锭堆 */
        ['M8 40L22 8l14 32', null, 2.6],
        ['M12 29h20', null, 2],
        ['M15 21h14', null, 1.8],
        '<circle cx="22" cy="8" r="2.4" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.8"/>',
        ['M25 32h14l-2.5 6h-9z', ART_DARK],
        '<circle cx="27" cy="39.4" r="1.7" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.5"/>',
        '<circle cx="34" cy="39.4" r="1.7" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.5"/>',
        ['M3 38h7v3H3z', ART_GOLD],
        ['M5 34h7v3H5z', ART_GOLD]
      ]
    },
    grain: {
      1: [  /* 红顶谷仓 + 大门 */
        ['M9 40V23h26v17z', ART_WOOD],
        ['M5 23l17-11 17 11z', ART_RED],
        ['M16 40V29h12v11z', ART_DARK],
        ['M17 31l10 8M27 31l-10 8', ART_WOOD, 2]
      ],
      2: [  /* 谷仓 + 筒仓 + 旗 */
        ['M4 40V25h17v15z', ART_WOOD],
        ['M1 25l11.5-8L24 25z', ART_RED],
        ['M9 40V31h7v9z', ART_DARK],
        ['M26 40V17h9v23z', ART_STONE],
        ['M26 17a4.5 4.5 0 0 1 9 0z', ART_STONE],
        ['M26 25h9M26 33h9', null, 1.4],
        apFlag(30.5, 13, 4.5)
      ]
    },
    horse: {
      1: [  /* 露天牧场：两垛干草 + 栅栏（草垛在栅栏后面） */
        '<circle cx="13" cy="33" r="5" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="2"/>',
        '<circle cx="24" cy="34" r="4" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.8"/>',
        ['M4 35h36M4 39h36', ART_WOOD, 2],
        ['M7 31v9M18 31v9M29 31v9M40 31v9', ART_WOODD, 1.9]
      ],
      2: [  /* 大马厩：石板顶 + 敞开式门洞 + 草垛 + 栅栏 */
        ['M5 40V24h19v16z', ART_WOOD],
        ['M2 24l12.5-8L27 24z', ART_SLATE],
        ['M10 40V30h9v10z', ART_DARK],
        ['M10 30h9', null, 1.4],
        '<circle cx="31" cy="34" r="4.4" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="2"/>',
        '<circle cx="36.6" cy="37.6" r="2.9" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.8"/>',
        ['M28 40v-5M36.5 40v-5M27.5 37.5h9.5', ART_WOODD, 1.8]
      ]
    },
    timber: {
      1: [  /* 树桩 + 两堆原木（没有房子） */
        '<circle cx="10" cy="36" r="5" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="2"/>',
        '<circle cx="10" cy="36" r="2.2" fill="none" stroke="' + ART_INK + '" stroke-width="1.1"/>',
        '<circle cx="27" cy="36" r="4.6" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="2"/>',
        '<circle cx="27" cy="36" r="1.9" fill="none" stroke="' + ART_INK + '" stroke-width="1"/>',
        '<circle cx="35.5" cy="37.5" r="3.8" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="1.8"/>',
        '<circle cx="35.5" cy="37.5" r="1.5" fill="none" stroke="' + ART_INK + '" stroke-width=".9"/>',
        '<circle cx="31" cy="29" r="4.2" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="1.9"/>',
        '<circle cx="31" cy="29" r="1.7" fill="none" stroke="' + ART_INK + '" stroke-width="1"/>'
      ],
      2: [  /* 锯架 + 原木堆 + 旗 */
        ['M8 40l9-16M26 40l-9-16', ART_WOODD, 2.6],
        ['M11 32h12', null, 1.7],
        '<circle cx="31" cy="36.5" r="4.4" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="2"/>',
        '<circle cx="31" cy="36.5" r="1.8" fill="none" stroke="' + ART_INK + '" stroke-width="1"/>',
        '<circle cx="38" cy="38" r="3.4" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="1.8"/>',
        '<circle cx="35" cy="29.5" r="4" fill="' + ART_WOODD + '" stroke="' + ART_INK + '" stroke-width="1.9"/>',
        '<circle cx="35" cy="29.5" r="1.6" fill="none" stroke="' + ART_INK + '" stroke-width="1"/>',
        apFlag(17, 24, 4.5)
      ]
    },
    fish: {
      1: [  /* 栈桥 + 小帆船 */
        ['M5 35h34v5H5z', ART_WATER, 2],
        ['M6 29h17v4H6z', ART_WOOD],
        ['M9 33v4M20 33v4', ART_WOOD, 2.2],
        ['M24 33h13l-2 5h-9z', ART_WOODD],
        ['M30 33V22', null, 2],
        ['M30 22l7 7h-7z', ART_CREAM]
      ],
      2: [  /* 双栈桥 + 大帆船 */
        ['M4 35h36v5H4z', ART_WATER, 2],
        ['M3 29h13v4H3z', ART_WOOD],
        ['M6 33v3M13 33v3', ART_WOOD, 2],
        ['M28 29h13v4H28z', ART_WOOD],
        ['M31 33v3M38 33v3', ART_WOOD, 2],
        ['M13 33h18l-3 6H16z', ART_WOODD],
        ['M22 33V16', null, 2],
        ['M22 16l10 10h-10z', ART_CREAM],
        ['M22 21l-7 6h7z', ART_CREAM]
      ]
    },
    salt: {
      1: [  /* 盐池 + 盐堆 */
        ['M5 26h14v5H5z', ART_CREAM],
        ['M5 33h14v5H5z', ART_CREAM],
        ['M25 40c0-4 3-7 6.5-7S38 36 38 40z', ART_CREAM],
        ['M28.5 36.5h.01M31.5 34.5h.01M34.5 37h.01', null, 1.6]
      ],
      2: [  /* 盐池 + 风车 */
        ['M4 25h12v4H4z', ART_CREAM],
        ['M4 31h12v4H4z', ART_CREAM],
        ['M4 37h12v3H4z', ART_CREAM],
        ['M26 40l2-11h6l2 11z', ART_CREAM],
        ['M31 29V18', null, 2],
        ['M31 18l7-4M31 18l7 4M31 18l-7-4M31 18l-7 4', null, 1.8],
        '<circle cx="31" cy="18" r="1.6" fill="' + ART_DARK + '"/>'
      ]
    },
    school: {
      1: [  /* 学堂：奶油墙 + 石板顶 + 钟塔 + 旗（和红谷仓明显不同） */
        ['M6 40V25h32v15z', ART_CREAM],
        ['M3 25l19-10 19 10z', ART_SLATE],
        ['M19 12h6v13h-6z', ART_CREAM],
        ['M17 12l5-5 5 5z', ART_SLATE],
        '<circle cx="22" cy="16.5" r="1.5" fill="' + ART_GOLD + '" stroke="' + ART_INK + '" stroke-width="1.1"/>',
        ['M19 40v-8a3 3 0 0 1 6 0v8z', ART_DARK],
        ['M10 29h4v5h-4zM30 29h4v5h-4z', ART_DARK, 1.6],
        apFlag(22, 7, 4.5)
      ],
      2: []
    },
    /* 市场（内联 SVG 回退用；正式图标是 assets/res/item-market-bld.png）。
     * 构图语言和资源建筑一致：粗墨线 + 平涂。辨识点是"斜遮阳棚 + 挂着的小钱袋"。 */
    market: {
      1: [
        ['M4 30h30v7H4z', ART_WOOD],                    // 摊台
        ['M3 20l5-12h22l5 12z', ART_RED],               // 斜遮阳棚
        ['M9 20V8M16 20V8M23 20V8M30 20V8', ART_CREAM, 1.4],  // 棚条纹
        ['M7 37v4M31 37v4', ART_WOODD, 2.4],            // 支腿
        '<circle cx="37" cy="25" r="4.8" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="2"/>',
        ['M34.6 20.6h4.8', ART_DARK, 2]                 // 袋口扎绳
      ],
      2: []
    },
    /* 建造坊：开口工棚 + 棚下的锤与锯 */
    builder: {
      1: [
        ['M3 22l19-13 19 13z', ART_WOODD],              // 棚顶
        ['M8 22v17M36 22v17', ART_WOOD, 2.8],           // 立柱
        ['M5 39h34', ART_WOODD, 2.2],                   // 地面
        ['M17 39l9-13', ART_WOODD, 2.6],                // 锤柄
        ['M24 21.6l7 4-3.4 5.8-7-4z', ART_DARK],        // 锤头
        ['M26 39l8-9 4.6 3.6-8 9z', ART_STONE],         // 锯身
        ['M28 37.4l1.5 2 1.5-2 1.5 2 1.5-2', null, 1.2] // 锯齿
      ],
      2: []
    },
    /* 内政批三张（正式图标是 assets/res/item-<key>-bld.png；
     * 这里是缺图时的内联回退，构图和 PNG 一致：高脚谷仓 / 烟囱厂房 / 穹顶柱式）。 */
    granary: {
      1: [  /* 高脚谷仓：架空仓身 + 草顶 + 斜梯（架空是为了防潮防鼠，一眼可读） */
        ['M10 31h24v-3H10z', ART_WOODD],                 // 台板
        ['M13 38V31h18v7z', ART_WOOD],                   // 仓身
        ['M9 31L22 18l13 13z', ART_RED],                 // 草顶
        ['M17 26h10', null, 1.4],                        // 顶脊
        ['M15 38v3M29 38v3', ART_WOODD, 2.4],            // 高脚
        ['M32 41l3-8', ART_WOODD, 1.6],                  // 斜梯
        ['M33 35.5h4M33.8 32.8h4', ART_WOODD, 1.1]       // 梯档
      ],
      2: []
    },
    factory: {
      1: [  /* 烟囱厂房：长条厂房 + 锯齿顶 + 高烟囱冒烟（工业化最直白的记号） */
        ['M5 40V25h20v15z', ART_STONE],                  // 厂房主体
        ['M5 25l5 4 5-4 5 4 5-4v-3H5z', ART_STONE],      // 锯齿顶
        ['M9 29h3v3H9zM15 29h3v3h-3zM21 29h3v3h-3z', ART_DARK], // 窗
        ['M28 40V12h6v28z', ART_RED],                    // 烟囱
        ['M28 12h6', ART_DARK, 2],
        '<circle cx="33" cy="8" r="2.2" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.5"/>',
        '<circle cx="36" cy="4" r="1.4" fill="' + ART_CREAM + '" stroke="' + ART_INK + '" stroke-width="1.3"/>'
      ],
      2: []
    },
    university: {
      1: [  /* 穹顶柱式：穹顶 + 檐口 + 四根柱 + 台阶 */
        ['M22 9a11 11 0 0 1 11 11H11A11 11 0 0 1 22 9z', ART_SLATE],  // 穹顶
        ['M22 9V5', ART_INK, 1.8],                       // 顶饰
        ['M8 20h28v3H8z', ART_STONE],                    // 檐口
        ['M11 23v14M18 23v14M26 23v14M33 23v14', ART_CREAM, 2.6],      // 柱
        ['M7 37h30v3H7z', ART_STONE]                     // 台阶
      ],
      2: []
    }
  };

  function bldArt(key, lv, size) {
    var set = ART[key] || ART.timber;
    var paths = set[lv] && set[lv].length ? set[lv] : set[1];
    var w = size || 32;
    /* 小尺寸（行图标 19~22px）要"撑满画布"才看得清：
     * 内容整体放大 1.08 倍，并且去掉地面淡影（那么小的影子只会糊成一团）。 */
    var small = w < 26;
    var out = ['<svg class="bart" viewBox="0 0 44 44" width="' + w + '" height="' + w + '"' +
      ' data-lv="' + (paths === set[2] ? 2 : 1) + '" aria-hidden="true">'];
    if (!small) out.push('<ellipse cx="22" cy="40" rx="16" ry="1.8" fill="#2f353b" fill-opacity=".10"/>');
    out.push('<g' + (small ? ' transform="translate(22 21.5) scale(1.1) translate(-22 -21.5)"' : '') + '>');
    for (var i = 0; i < paths.length; i++) {
      var it = paths[i];
      out.push(typeof it === 'string' ? it : ap(it[0], it[1], it[2]));
    }
    out.push('</g></svg>');
    return out.join('');
  }
  AO.bldArt = bldArt;          // 预览/调试用

  /* 用哪套图：'svg' = 现画（每级造型不同，默认）；'png' = assets 里的手绘图 */
  AO.BLD_ART = 'png';   // Lv1 用 item-<key>-bld.png，Lv2 用 item-<key>-bld-2.png（两套是不同的建筑）
  function bldVisual(key, lv, size) {
    return AO.BLD_ART === 'png' ? bldImgTag(key, lv, size) : bldArt(key, lv, size);
  }

  /* 建筑图统一走这里：**优先用 assets 里的手绘图**（每种资源一张，形状各不相同），
   * 缺图才逐级回退 —— Lv2 的图还没有就先借 Lv1 的，连 Lv1 都没有才现画 SVG。
   * 这样既保住了原来那套好看的图标，又不会因为缺图空一块。 */
  function bldSrc(key, lv) {
    return 'assets/res/item-' + key + '-bld' + (lv === 2 ? '-2' : '') + '.png';
  }
  /* 没有 PNG 的建筑（目前只有学校）直接走 SVG，省一次 404 */
  var NO_PNG = { school: 1 };
  function bldImgTag(key, lv, size, cls) {
    if (NO_PNG[key]) return bldArt(key, lv, size);
    return '<img class="' + (cls || 'bart-img') + '" src="' + bldSrc(key, lv) + '"' +
      ' data-lv="' + lv + '"' +
      ' style="width:' + size + 'px;height:' + size + 'px"' +
      ' onerror="AO.imgFallback(this,\'' + key + '\',' + lv + ',' + size + ')">';
  }
  /* onerror 链：-bld-2 → -bld → 内联 SVG */
  AO.imgFallback = function (img, key, lv, size) {
    if (lv === 2 && img.getAttribute('data-tried') !== '1') {
      img.setAttribute('data-tried', '1');
      img.src = bldSrc(key, 1);
      return;
    }
    var svg = doc.createElement('span');
    svg.innerHTML = bldArt(key, lv, size);
    var node = svg.firstChild;
    /* SVG 元素的 className 是只读的（SVGAnimatedString），必须走 setAttribute */
    node.setAttribute('class', 'bart');
    node.setAttribute('data-lv', lv);
    if (img.parentNode) img.parentNode.replaceChild(node, img);
  };

  /* 档位格子：一个 Lv 一张图 + 产量 + 维护 + 当前座数。
   * 没解锁的 Lv2 也画出来（灰掉）—— 玩家得先看见它长什么样才愿意去研究。 */
  function tierCell(r, def, lv, n, prod, open, owner) {
    var m = (lv === 1 ? def.maint : def.maint2) || {};
    var per = lv === 1 ? (def.per || 0) : (def.per2 || def.per || 0);
    return '<div class="tr' + (lv === 2 ? ' lv2' : '') + (open ? '' : ' lock') + '">' +
      bldVisual(r.key, lv, lv === 2 ? 40 : 38) +
      '<div class="tc"><b>Lv' + lv + (open ? '' : ' · 未解锁') +
        '<span class="cnt">×' + n + '</span></b>' +
      '<span>+' + per + ' ' + prod + '/回合</span>' +
      '<span>维护 ' + maintText(m, owner) + '</span></div></div>';
  }

  /* 问号里的说明 */
  function buildInfoHtml(r, def, s, p) {
    var prod = def.prod || r.cn;
    var lv2 = researched(p.owner, r.key);
    var t1 = (s.tiers && s.tiers[1]) || 0, t2 = (s.tiers && s.tiers[2]) || 0;
    var tech = AO.techFor(r.key);
    var h = '<div class="h">' + def.build + '<span>已建 ' + s.built + ' 座' +
      (s.site > 0 ? ' · ' + (s.siteKind === 'up' ? '升档中' : '在建') + '（' + s.site + ' 回合）' : '') + '</span></div>';
    /* 居民消耗是建筑属性，任何状态下都写出来 */
    var eatLine = def.eat > 0
      ? '<div class="l"><i>居民</i> 本地吃掉 ' + Math.round(def.eat * 100) + '%' +
        (s.built ? '（每回合约 ' + (simPerTurn(s, def) * def.eat).toFixed(1) + ' 个）' : '') +
        '，剩下才入库</div>'
      : '';

    /* 档位区：两档并排 + 座数 + 升级价 + 自愿原则 */
    h += '<div class="tiers">' + tierCell(r, def, 1, t1, prod, true, p.owner) +
      tierCell(r, def, 2, t2, prod, lv2, p.owner) + '</div>';
    h += '<div class="l"><i>座数</i> Lv2 ×' + t2 + ' · Lv1 ×' + t1 + '</div>';
    h += '<div class="l"><i>升级</i> ' + (lv2
      ? costText(def.cost2) + ' / 座（把一座旧的改成 Lv2，产量 ' + def.per + ' → ' + (def.per2 || def.per) + '）'
      : '要先研究「' + ((tech && tech.cn) || '对应科技') + '」') + '</div>';
    h += '<div class="l"><i>维护</i> 每座每回合 ' + maintText(def.maint, p.owner) +
         (s.built ? '（本省本回合 ' + maintText({
           iron: (def.maint.iron || 0) * t1 + ((def.maint2 || {}).iron || 0) * t2,
           gold: (def.maint.gold || 0) * t1 + ((def.maint2 || {}).gold || 0) * t2
         }, p.owner) + '）' : '') +
         (MODS(p.owner).maintCut ? '　<em class="ok">标准工料 −' + Math.round(MODS(p.owner).maintCut * 100) + '%</em>' : '') + '</div>';
    h += '<div class="l"><i>说明</i> 旧的可以一直用，不升也不停产（只要维护付得起）</div>';
    if (s.halted) h += '<div class="l gone"><i>停产</i> 维护欠费（铁/金没凑齐），本回合不产出</div>';

    if (s.gone) {
      h += '<div class="l gone"><i>枯竭</i> 矿脉已采空，不再恢复</div>';
      h += '<div class="l"><i>已产</i> ' + s.stock + ' ' + prod + '</div>';
      h += eatLine;
      return h;
    }
    if (s.cool > 0) {
      var pct = Math.max(0, Math.min(100, (1 - s.cool / (def.cool || 1)) * 100));
      h += '<div class="l cool"><i>冷静</i> 还剩 ' + s.cool + ' 回合' +
           (r.key === 'timber' ? '（林地慢慢长回来）' : '（资源慢慢恢复）') + '</div>';
      h += '<div class="bar cool"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      h += '<div class="l"><i>已产</i> ' + s.stock + ' ' + prod + '　冷静完剩余回满 ' + s.n + '</div>';
      h += eatLine;
      return h;
    }
    if (!s.built) {
      h += '<div class="l"><i>产出</i> 还没建 —— 点上面的 ＋ 建一座</div>';
      h += '<div class="l"><i>单座</i> 每回合 +' + def.per + ' ' + prod +
           '，储量 ' + s.n + (def.cool > 0 ? '，采空后冷静 ' + def.cool + ' 回合' : '，采空即枯竭') + '</div>';
      h += '<div class="l"><i>造价</i> ' + costText(costOf(def, lv2)) +
           (lv2 ? '（科技已研，新盖直接 Lv2）' : '') + '（本省 → 中央 → 同国各省）</div>';
      return h;
    }

    var per = simPerTurn(s, def);
    var popCls = (Date.now() - s.pop < 420) ? ' num pop' : ' num';
    var turns = per > 0 ? Math.ceil(s.left / per) : 0;
    h += '<div class="l"><i>产出</i> 每回合 +' + per + ' ' + prod +
         (s.built > 1 ? '（' + s.built + ' 座）' : '') + (s.halted ? '　<em class="halted">已停产</em>' : '') + '</div>';
    h += eatLine;
    h += '<div class="l"><i>库存</i> <b class="' + popCls + '">' + s.stock + '</b> ' + prod +
         ' <span class="muted">/ 上限 ' + capOf(p.id, r.key) + '</span>' +
         (s.stock >= capOf(p.id, r.key) ? '　<em class="halted">满仓</em>' : '') + '</div>';
    h += '<div class="l"><i>结算</i> 每回合一次 · 点右上角「下一回合」</div>';
    h += '<div class="l"><i>剩余</i> 储量 ' + s.left + ' / ' + s.n +
         (turns ? '（还够 ' + turns + ' 回合）' : '') + '</div>';
    h += '<div class="l"><i>造价</i> ' + costText(costOf(def, lv2)) +
         '　工期 ' + effectiveTurns(p.id, p.owner) + ' 回合' +
         (MODS(p.owner).turnCut ? '（学徒制 −' + MODS(p.owner).turnCut + '）' : '') + '</div>';
    return h;
  }

  /* 「可开发」栏：七种资源，两种看法（未开发 = 剩余储量 / 已开发 = 已产库存） */
  function renderResList(p) {
    var box = $('iResList');
    if (!box) return;
    box.innerHTML = '';
    var dev = state.resState === 'dev';
    var rs = p.resources || [];
    var bag = SIM[p.id] || seedSims(p);
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      var def = AO.RESOURCE_BY_KEY[r.key] || { cn: r.cn, prod: r.cn, build: '', per: 0, cool: 0, eat: 0, cost: {} };
      var prod = def.prod || r.cn;
      var s = bag[r.key] || (bag[r.key] = newSim(r, 0));

      var row = doc.createElement('div');
      row.className = 'rr';

      var val = dev ? s.stock : s.left;
      /* 进度条用 0~100 的**绝对刻度**（储量上限就是 100），不能用 val / n：
       * 那样开局每一条都是 100%，七行一样长，反而看不出这块地哪种资源更富。 */
      var pct = Math.min(100, val);
      /* 库存上限（内政批）：已开发那一栏直接写「库存 87 / 上限 150」，
       * 到了上限再补一句"再产就浪费" —— 玩家得能预期下一回合白干 */
      var cap = capOf(p.id, r.key);
      row.title = dev
        ? r.cn + ' → ' + prod + '：库存 ' + s.stock + ' / 上限 ' + cap +
          '（剩余储量 ' + s.left + '）' +
          (s.stock >= cap ? '\n⚠ 已满仓：再产出会就地损耗（收支小结记「满仓 −N」）' : '')
        : r.cn + '：剩余储量 ' + s.left + ' / ' + s.n +
          (def.build ? '（开发时建' + def.build + '）' : '') +
          (s.built ? '　已建 ' + s.built + ' 座' : '');
      if (r.key === 'fish') row.title += '\n' + fishWhy(p);

      var img = doc.createElement('img');
      img.src = 'assets/res/item-' + r.key + (dev ? '-dev' : '') + '.png';
      img.onerror = function () { this.style.visibility = 'hidden'; };
      row.appendChild(img);

      var nm = doc.createElement('span');
      nm.className = 'nm';
      nm.textContent = dev ? prod : r.cn;
      row.appendChild(nm);

      var bw = doc.createElement('span');
      bw.className = 'bw';
      var bi = doc.createElement('i');
      bi.style.width = Math.max(2, Math.min(100, pct)) + '%';
      bi.style.background = r.color;
      if (dev) bi.style.opacity = '.75';
      bw.appendChild(bi);
      row.appendChild(bw);

      var em = doc.createElement('em');
      em.className = (Date.now() - s.pop < 420 && dev) ? 'pop' : '';
      em.textContent = val;
      row.appendChild(em);

      box.appendChild(row);
    }
  }

  /* 「建筑」栏：＋ 在这里；建造吃国家资源，开工后要等工期。
   * 分档之后一行要表达四件事：总数、还剩几座旧的（旧N）、能不能升、有没有停产。 */
  function renderBldList(p) {
    var box = $('iBldList');
    if (!box) return;
    box.innerHTML = '';
    var rs = p.resources || [];
    var bag = SIM[p.id] || seedSims(p);
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      var def = AO.RESOURCE_BY_KEY[r.key] || { cn: r.cn, prod: r.cn, build: '', per: 0, cool: 0, eat: 0, cost: {} };
      var prod = def.prod || r.cn;
      var s = bag[r.key] || (bag[r.key] = newSim(r, 0));
      var lv2 = researched(p.owner, r.key);
      var n1 = (s.tiers && s.tiers[1]) || 0, n2 = (s.tiers && s.tiers[2]) || 0;
      var tech = AO.techFor(r.key);

      var row = doc.createElement('div');
      row.className = 'rr bld';
      row.title = def.build + '：已建 ' + s.built + ' 座' +
        (n2 ? '（Lv2 ×' + n2 + '）' : '') + (n1 ? '（Lv1 ×' + n1 + '）' : '') +
        (s.site > 0 ? '，' + (s.siteKind === 'up' ? '升档中' : '在建') + '（剩 ' + s.site + ' 回合）' : '') +
        '，每回合 +' + simPerTurn(s, def) + ' ' + prod +
        '\n造价 ' + costText(costOf(def, lv2)) + '（本省 → 中央 → 同国各省）' +
        (lv2 ? '\n升档 ' + costText(def.cost2) + ' / 座' : '\n升 Lv2 要先研究「' + ((tech && tech.cn) || '对应科技') + '」') +
        '\n维护 ' + maintText(def.maint, p.owner) + ' / 座·回合' +
        '\n工期 ' + effectiveTurns(p.id, p.owner) + ' 回合' +
        '\n剩余储量 ' + s.left + (s.gone ? '，已枯竭' : s.cool > 0 ? '，冷静 ' + s.cool + ' 回合' : '');
      if (s.halted) row.title += '\n维护欠费，停产中';

      /* 行图标：手绘图（Lv2 有专属图就用专属图，没有就先借 Lv1 的） */
      row.insertAdjacentHTML('beforeend', bldVisual(r.key, n2 > 0 ? 2 : 1, 22));

      var nmb = doc.createElement('span');
      nmb.className = 'nm';
      nmb.textContent = def.build;
      row.appendChild(nmb);

      var q = doc.createElement('span');
      q.className = 'qty' + (s.gone ? ' gone' : '');
      q.textContent = '×' + s.built;
      q.title = '已建 ' + s.built + ' 座（Lv2 ×' + n2 + ' · Lv1 ×' + n1 + '）';
      row.appendChild(q);

      /* 科技研出来之后，旧建筑不强制升 —— 但得让人看见"还有几座旧的" */
      if (lv2 && n1 > 0) {
        var old = doc.createElement('span');
        old.className = 'old';
        old.textContent = '旧' + n1;
        old.title = '还有 ' + n1 + ' 座 Lv1：不升也照常出产，想升就点「升」';
        row.appendChild(old);
      }

      if (s.site > 0) {
        var st = doc.createElement('span');
        st.className = 'site';
        st.textContent = (s.siteKind === 'up' ? '升' : '建') + s.site;
        st.title = (s.siteKind === 'up' ? '升档中：还要 ' : '在建：还要 ') + s.site + ' 回合';
        row.appendChild(st);
      }

      var add = doc.createElement('button');
      add.className = 'add';
      add.type = 'button';
      add.textContent = '＋';
      add.disabled = s.gone || s.site > 0;
      add.title = s.gone ? '已枯竭，不能再建' : s.site > 0 ? '还有工地，等完工' :
        '再建一座（' + costText(costOf(def, lv2)) + (lv2 ? '，Lv2' : '') + '）';
      lockBtn(add, p.owner);
      row.appendChild(add);

      /* 冲刺钮：只在"本省有不停产的建造坊 + 这一行有工地"时出现。
       * 学校/市场/建造坊自己的工地也走同一条路（见 buildUnivRow）。 */
      var bld0 = BUILDER[p.id];
      var sprint = null;
      if (s.site > 0 && bld0 && bld0.n > 0 && !bld0.halted) {
        sprint = doc.createElement('button');
        sprint.className = 'spurt';
        sprint.type = 'button';
        sprint.textContent = '＋';
        sprint.title = '冲刺：' + costText(AO.BUILDER.sprintCost) + ' 把工期砍 1 回合（还剩 ' + s.site + ' 回合）';
        lockBtn(sprint, p.owner);
        row.appendChild(sprint);
      }

      /* 「升」：科技已研 + 还有旧建筑 + 没有工地，才出现 */
      var up = null;
      if (lv2 && n1 > 0 && !(s.site > 0) && !s.gone) {
        up = doc.createElement('button');
        up.className = 'upg';
        up.type = 'button';
        up.textContent = '升';
        up.title = '把一座 Lv1 升到 Lv2：' + costText(def.cost2) +
          '（产量 ' + def.per + ' → ' + (def.per2 || def.per) + '，维护翻倍）';
        lockBtn(up, p.owner);
        row.appendChild(up);
      }

      var sp = doc.createElement('span');
      sp.className = 'sp';
      row.appendChild(sp);

      var dot = doc.createElement('i');
      dot.className = 'dot' + (s.halted ? ' halt' : s.gone ? ' gone' : s.cool > 0 ? ' cool' :
        s.site > 0 ? ' site' : s.built ? ' on' : '');
      row.appendChild(dot);

      var qb = doc.createElement('button');
      qb.className = 'qbtn';
      qb.type = 'button';
      qb.textContent = '?';
      qb.title = '档位 / 产出 / 维护 / 造价 / 剩余';
      row.appendChild(qb);

      box.appendChild(row);

      var panel = doc.createElement('div');
      panel.className = 'qinfo' + (state.openKey === r.key ? ' on' : '');
      panel.innerHTML = buildInfoHtml(r, def, s, p);
      box.appendChild(panel);
      if (state.openKey === r.key) qb.classList.add('on');

      (function (btn, pn, key, addBtn, upBtn, pp, spBtn) {
        btn.addEventListener('click', function () {
          state.openKey = (state.openKey === key) ? null : key;
          var on = pn.classList.toggle('on');
          btn.classList.toggle('on', on);
          if (on) renderBldList(pp);
        });
        addBtn.addEventListener('click', function () {
          buildOne(pp, key);
          renderInfoLists(pp);
        });
        if (upBtn) upBtn.addEventListener('click', function () {
          upgradeBuilding(pp, key);
          renderInfoLists(pp);
        });
        if (spBtn) spBtn.addEventListener('click', function () {
          sprintSite(pp, key);
          renderInfoLists(pp);
        });
      })(qb, panel, r.key, add, up, p, sprint);
    }
  }

  /* 「通用」栏：学校 / 市场 / 建造坊 —— 不绑在某种资源上的设施。
   * 三行结构完全一样（座数 · 在建 · ＋盖一座 · 冲刺 · 状态灯 · 问号），
   * 所以由同一段代码生成，差异只在 ? 面板里写什么。 */
  function renderUniversalList(p) {
    var box = $('iSchoolList');
    if (!box) return;
    box.innerHTML = '';
    var i;
    /* 只画**民用**三件套。五座装备厂走 renderMilList（它们有自己的
     * 建厂条件、订单和"非你的国家只能看"的锁，用通用行画会把这些全丢掉）。 */
    for (i = 0; i < UNIV_CIVIL.length; i++) buildUnivRow(box, p, UNIV_CIVIL[i]);

    /* 入口条：科研是**国家级**操作，研究钮在国家卡里 ——
     * 玩家在省份卡建完学校，得有个明确的地方往下点，不然找不到。 */
    var R = researchOf(p.owner);
    var link = doc.createElement('div');
    link.className = 'rr techlink';
    link.title = '科研点全国共用：点这里打开全屏科技树，挑一个节点入队研究';
    link.textContent = R.cur
      ? '科研：正在研究「' + ((AO.TECH_BY_KEY[R.cur.key] || {}).cn || R.cur.key) + '」剩 ' + R.cur.left + ' 回合' +
        (R.queue.length ? '（队列 ' + R.queue.length + '）' : '') + ' →'
      : R.queue.length
        ? '科研 ' + R.pts + ' 点 · 队列 ' + R.queue.length + ' 条等待 →'
        : R.unlocked
          ? '科研 ' + R.pts + ' 点 · 打开科技树研究 →'
          : '科研 ' + R.pts + ' / ' + AO.TECH_UNLOCK_PTS + ' 点 · 建学校开始科研 →';
    link.addEventListener('click', function () {
      /* 直接开独立科技面板：不清省份卡、不切模式，研究完还能接着盖房 */
      openTechTree(p.owner);
    });
    box.appendChild(link);
  }

  /* 一座通用设施的一行（含它自己的 ? 面板） */
  function buildUnivRow(box, p, kind) {
    var D = univDef(kind);
    var st = univOf(kind, p.id);
    var B = BUILDER[p.id];
    var canSprint = !!(B && B.n > 0 && !B.halted);

    var row = doc.createElement('div');
    row.className = 'rr bld';
    row.setAttribute('data-univ', kind);
    row.title = D.cn + '：已建 ' + st.n + ' 座' +
      (st.site > 0 ? '，在建（剩 ' + st.site + ' 回合）' : '') +
      '\n造价 ' + costText(D.cost) + '（本省 → 中央 → 同国各省）' +
      '\n工期 ' + effectiveTurns(p.id, p.owner, D.turnsAt()) + ' 回合' +
      '\n维护 ' + maintText(D.maint, p.owner) + ' / 座·回合';
    if (kind === 'school') {
      var R0 = researchOf(p.owner);
      row.title += '\n每座每回合 +' + AO.SCHOOL.per + ' 科研点' +
        '\n全国科研点 ' + R0.pts + '（' + (R0.unlocked ? '科技树已解锁' : '攒满 ' + AO.TECH_UNLOCK_PTS + ' 解锁科技树') + '）';
    } else if (kind === 'market') {
      row.title += '\n每座可把 ' + AO.MARKET.rate + ' 单位资源换成 1 金（点 ? 手动卖）';
    } else if (kind === 'granary') {
      /* 粮仓：效果写成"每座 +100 粮/渔上限"，并把当前上限一起报出来 ——
       * 玩家关心的是"我现在能不能多囤"，不是"这个建筑叫什么" */
      row.title += '\n每座 +' + AO.GRANARY.capBonus + ' 粮/渔上限（上限 ' + AO.GRANARY.maxPer + ' 座）' +
        '\n本省上限：粮食 ' + capOf(p.id, 'grain') + ' · 渔获 ' + capOf(p.id, 'fish') +
        (st.halted ? '\n⚠ 停产中：加成本回合失效（超额存量保留，只停增量）'
          : st.n ? '' : '\n还没有粮仓 —— 粮/渔上限只有 ' + AO.CAP.base);
    } else if (kind === 'university') {
      row.title += '\n每座每回合 +' + AO.UNIVERSITY.perSci + ' 科研点 · +' +
        AO.UNIVERSITY.perTalent + ' 人才点' +
        '\n门槛：累计教育 ≥ ' + AO.UNIVERSITY.needTier + '（现在 ' +
        Math.floor(talentOf(p.owner).total || 0) + '）';
    } else {
      row.title += '\n有它才能冲刺工期：' + costText(AO.BUILDER.sprintCost) + ' 砍 1 回合';
    }
    if (st.halted) row.title += '\n维护欠费，' + (kind === 'school' ? '停课' : kind === 'market' ? '停产（卖不了货）' : '停产（冲不了工）') + ' 中';

    row.insertAdjacentHTML('beforeend', bldVisual(kind, 1, 22));

    var nmb = doc.createElement('span');
    nmb.className = 'nm';
    nmb.textContent = D.cn;
    if (kind === 'school') nmb.title = '每座每回合 +' + AO.SCHOOL.per + ' 科研点';
    row.appendChild(nmb);

    var q = doc.createElement('span');
    q.className = 'qty';
    q.textContent = '×' + st.n;
    row.appendChild(q);

    if (st.site > 0) {
      var sch2 = doc.createElement('span');
      sch2.className = 'site';
      sch2.textContent = '建' + st.site;
      sch2.title = '在建：还要 ' + st.site + ' 回合';
      row.appendChild(sch2);
    }

    var add = doc.createElement('button');
    add.className = 'add';
    add.type = 'button';
    add.textContent = '＋';
    /* 两种"按不动"：粮仓 3 座封顶、大学要累计教育 60。
     * 置灰但**不隐藏** —— 隐藏了玩家会以为这一版没有这座建筑。 */
    var gateWhy = '';
    if (kind === 'granary' && st.n >= AO.GRANARY.maxPer) {
      gateWhy = '已到上限 ' + AO.GRANARY.maxPer + ' 座（粮/渔上限 +' +
        AO.GRANARY.maxPer * AO.GRANARY.capBonus + ' 已经是这个省的极限）';
    }
    if (D.needTier) {
      var eduN = talentOf(p.owner).total || 0;
      if (eduN < D.needTier) {
        gateWhy = '要累计教育 ' + D.needTier + '（现在 ' + Math.floor(eduN) + '）';
      }
    }
    add.disabled = st.site > 0 || !!gateWhy;
    add.title = gateWhy ? gateWhy
      : st.site > 0 ? '还有工地在建，等完工' : '再建一座' + D.cn + '（' + costText(D.cost) + '）';
    lockBtn(add, p.owner);
    row.appendChild(add);

    /* 冲刺钮：只在"有工地 + 有可用建造坊"时出现 —— 建造坊的价值就在这里 */
    var sprint = null;
    if (st.site > 0 && canSprint) {
      sprint = doc.createElement('button');
      sprint.className = 'spurt';
      sprint.type = 'button';
      sprint.textContent = '＋';
      sprint.title = '冲刺：' + costText(AO.BUILDER.sprintCost) + ' 把工期砍 1 回合（还剩 ' + st.site + ' 回合）';
      lockBtn(sprint, p.owner);
      row.appendChild(sprint);
    }

    var sp = doc.createElement('span');
    sp.className = 'sp';
    row.appendChild(sp);

    var dot = doc.createElement('i');
    dot.className = 'dot' + (st.halted ? ' halt' : st.site > 0 ? ' site' : st.n ? ' on' : '');
    row.appendChild(dot);

    var qb = doc.createElement('button');
    qb.className = 'qbtn';
    qb.type = 'button';
    qb.textContent = '?';
    qb.title = '说明 / 造价 / 维护';
    row.appendChild(qb);

    box.appendChild(row);

    var panel = doc.createElement('div');
    panel.className = 'qinfo' + (state.openKey === kind ? ' on' : '');
    panel.innerHTML = univInfoHtml(p, kind);
    box.appendChild(panel);
    if (state.openKey === kind) qb.classList.add('on');

    (function (btn, pn, kk, pp) {
      btn.addEventListener('click', function () {
        state.openKey = (state.openKey === kk) ? null : kk;
        var on = pn.classList.toggle('on');
        btn.classList.toggle('on', on);
        if (on) renderUniversalList(pp);
      });
      add.addEventListener('click', function () {
        buildUniv(pp, kk);
        renderInfoLists(pp);
      });
      if (sprint) sprint.addEventListener('click', function () {
        sprintSite(pp, kk);
        renderInfoLists(pp);
      });
    })(qb, panel, kind, p);

    /* 市场的卖货 / 买货钮在 ? 面板里，展开时才绑（面板是每次重画新建的） */
    if (kind === 'market') {
      var sells = panel.querySelectorAll('button[data-sell]');
      for (var j = 0; j < sells.length; j++) {
        sells[j].addEventListener('click', function () {
          var key = this.getAttribute('data-sell');
          sellResource(p, key);
          renderInfoLists(p);
        });
      }
      var buys = panel.querySelectorAll('button[data-buy]');
      for (var bj = 0; bj < buys.length; bj++) {
        buys[bj].addEventListener('click', function () {
          var key = this.getAttribute('data-buy');
          buyResource(p, key);
          renderInfoLists(p);
        });
      }
    }
  }

  /* 通用设施的 ? 面板。三种各有各的重点：学校说科研、市场摆卖货钮、建造坊说冲刺价 */
  function univInfoHtml(p, kind) {
    var D = univDef(kind);
    var st = univOf(kind, p.id);
    var turns = effectiveTurns(p.id, p.owner, D.turnsAt());
    var baseTurns = D.turnsAt();
    var turnNote = turns < baseTurns ? '（学徒制 −' + (baseTurns - turns) + '）' : '';
    var h = '<div class="h">' + D.cn + '<span>' + (st.n ? '已建 ' + st.n + ' 座' : '还没建') +
      (st.site > 0 ? ' · 在建（' + st.site + ' 回合）' : '') + '</span></div>';

    if (kind === 'school') {
      var R = researchOf(p.owner);
      h += '<div class="l"><i>科研</i> 每座每回合 +' + AO.SCHOOL.per + ' 科研点（全国共用，' +
        (st.n ? '本省 +' + (st.n * AO.SCHOOL.per) : '本省 +0') + ' / 回合）</div>';
    } else if (kind === 'market') {
      h += '<div class="l"><i>换金</i> 每座可把 ' + AO.MARKET.rate + ' 单位资源换成 1 金（手动，本省库存直接扣）</div>';
    } else if (kind === 'granary') {
      /* 粮仓：把"上限"这件事讲清楚 —— 基础 150、每座 +100、3 座封顶 */
      var gcapG = capOf(p.id, 'grain'), gcapF = capOf(p.id, 'fish');
      var gst = SIM[p.id] || {};
      h += '<div class="l"><i>储量</i> 每座 +' + AO.GRANARY.capBonus +
        ' 粮/渔上限，本省封顶 ' + AO.GRANARY.maxPer + ' 座</div>' +
        '<div class="l"><i>本省</i> 上限 粮食 <b>' + gcapG + '</b> · 渔获 <b>' + gcapF + '</b>' +
        '（基础 ' + AO.CAP.base + ' + 粮仓 ' + (gcapG - AO.CAP.base) + '）</div>';
      if (gst.grain) h += '<div class="l"><i>现况</i> 粮食 ' + gst.grain.stock + ' / ' + gcapG +
        (gst.grain.stock >= gcapG ? '　<em class="halted">满仓，再产会损耗</em>' : '') + '</div>';
      if (gst.fish) h += '<div class="l"><i>现况</i> 渔获 ' + gst.fish.stock + ' / ' + gcapF + '</div>';
      if (st.n >= AO.GRANARY.maxPer) {
        h += '<div class="l gone"><i>封顶</i> 本省已有 ' + st.n + ' 座粮仓（上限 ' +
          AO.GRANARY.maxPer + ' 座），再造也没地方放</div>';
      } else if (!st.n) {
        h += '<div class="l"><i>提示</i> 没有粮仓时粮/渔上限只有 ' + AO.CAP.base +
          '，超出部分当场损耗（收支小结写「满仓 −N」）</div>';
      }
    } else if (kind === 'university') {
      var eduU = talentOf(p.owner).total || 0;
      h += '<div class="l"><i>产出</i> 每座每回合 +' + AO.UNIVERSITY.perSci + ' 科研点 · +' +
        AO.UNIVERSITY.perTalent + ' 人才点' +
        (st.n ? '（本省 +' + (st.n * AO.UNIVERSITY.perSci) + ' / +' +
          (st.n * AO.UNIVERSITY.perTalent) + '）' : '') + '</div>' +
        '<div class="l"><i>门槛</i> 累计教育 ≥ ' + AO.UNIVERSITY.needTier +
        '（现在 <b>' + Math.floor(eduU) + '</b>' + (eduU >= AO.UNIVERSITY.needTier ? '　<em class="ok">已满足</em>' : '　<em class="halted">还不够</em>') + '）</div>';
      /* 人才点的两条线在这里说一次：面板上的"教育"读的是 total，不是能花的 pts */
      h += '<div class="l"><i>人才</i> 累计教育只加不减（解锁用）· 人才点会因开科花掉（花销用），两条线互不影响</div>';
    } else {
      h += '<div class="l"><i>冲刺</i> 每个工地花 ' + costText(AO.BUILDER.sprintCost) +
        ' 砍 1 回合，可以连点；砍到 0 立刻完工</div>' +
        '<div class="l"><i>范围</i> 全国有一座不停产的建造坊，研究冲刺也能用（从中央国库扣）</div>';
    }

    h += '<div class="l"><i>维护</i> 每座每回合 ' + maintText(D.maint, p.owner) +
      (st.n ? '（本省本回合 ' + maintText({
        iron: (D.maint.iron || 0) * st.n, gold: (D.maint.gold || 0) * st.n }, p.owner) + '）' : '') +
      (MODS(p.owner).maintCut ? '　<em class="ok">标准工料 −' + Math.round(MODS(p.owner).maintCut * 100) + '%</em>' : '') + '</div>' +
      '<div class="l"><i>造价</i> ' + costText(D.cost) + '　工期 ' + turns + ' 回合' + turnNote + '</div>';

    if (kind === 'school') {
      var R2 = researchOf(p.owner);
      h += '<div class="l"><i>科研</i> 全国 ' + R2.pts + ' 点 · ' +
        (R2.unlocked ? '科技树已解锁' : '再攒 ' + Math.max(0, AO.TECH_UNLOCK_PTS - R2.pts) + ' 点解锁科技树') + '</div>';
    }

    if (kind === 'market') {
      h += '<div class="l"><i>卖货</i> 七种资源都能卖，' + AO.MARKET.rate + ' 单位换 1 金（库存不够的置灰）</div>';
      if (!st.n) h += '<div class="l gone"><i>提示</i> 先盖一座市场，才有地方卖货</div>';
      else if (st.halted) h += '<div class="l gone"><i>停产</i> 维护欠费，本回合卖不了货（建造不受影响）</div>';
      var rs = p.resources || [], bag = SIM[p.id] || {};
      h += '<div class="sellbox">';
      for (var i = 0; i < rs.length; i++) {
        var rk = rs[i].key, ss = bag[rk];
        var have = ss ? ss.stock : 0;
        var off = !st.n || st.halted || have < AO.MARKET.rate || !canAct(p.owner);
        h += '<div class="srow"><span>' + cnOf(rk) + '</span><em>' + have + '</em>' +
          '<button type="button" data-sell="' + rk + '"' + (off ? ' disabled' : '') +
          ' title="' + (!canAct(p.owner) ? lockTitle() : off ? (st.halted ? '市场停产中' : '库存不足 ' + AO.MARKET.rate) :
            '扣本省 ' + AO.MARKET.rate + ' ' + cnOf(rk) + '，+1 金') + '">' +
          '卖 ' + AO.MARKET.rate + ' → +1 金</button></div>';
      }
      h += '</div>';

      /* ---- 买货：省库金 → 中央进货 → 进本省库存 ----
       * 和上面的卖货是**两条反向的腿**：卖是把省里的东西换成金，
       * 买是拿省库的金去中央调货（应急口：缺粮救荒、缺铁复工）。
       * 中央没货就置灰 —— 中央的库存只由「生产抽税」和「买货」进出，
       * 所以这里的置灰是真的"中央空了"，不是省里没钱。 */
      var lot = AO.GOV.buyLot(), cen = ensureCentral(p.owner);
      var gold = bag.gold ? bag.gold.stock : 0;
      h += '<div class="l"><i>买货</i> 省库金 <b>' + gold + '</b> · 每次进 ' + lot.n +
        ' 单位花 ' + lot.gold + ' 金（从中央国库调，比卖价贵）</div>';
      h += '<div class="sellbox buy">';
      for (var bi2 = 0; bi2 < rs.length; bi2++) {
        var bk = rs[bi2].key, cv = Math.floor(cen[bk] || 0);
        var boff = !st.n || cv < lot.n || gold < lot.gold || !canAct(p.owner) || !!BLOCKADE[p.id];
        h += '<div class="srow"><span>' + cnOf(bk) + '</span><em>' + cv + '</em>' +
          '<button type="button" data-buy="' + bk + '"' + (boff ? ' disabled' : '') +
          ' title="' + (!canAct(p.owner) ? lockTitle()
            : BLOCKADE[p.id] ? '本省被舰队封锁，买不了货'
              : !st.n ? '先盖一座市场' : cv < lot.n ? '中央没货（只有 ' + cv + '）' :
                gold < lot.gold ? '省库金不足 ' + lot.gold : '扣省库 ' + lot.gold + ' 金，从中央进 ' +
                  lot.n + ' ' + cnOf(bk)) + '">' +
          '买 ' + lot.n + ' ← ' + lot.gold + ' 金</button></div>';
      }
      h += '</div>';
    }

    if (st.halted) {
      h += '<div class="l gone"><i>停产</i> 维护欠费（铁/金没凑齐），' +
        (kind === 'school' ? '本回合不产科研点'
          : kind === 'market' ? '本回合卖不了货'
            : kind === 'granary' ? '本回合粮/渔上限加成失效（超额存量保留，只停增量）'
              : kind === 'university' ? '本回合不产科研点与人才点'
                : '本回合冲不了工') + '</div>';
    }
    return h;
  }

  /* ---------------- 军备栏（v3）：五种装备厂 + 本省驻军 ----------------
   * 为什么和「通用」栏分开：通用栏是"钱和科技"（学校/市场/建造坊），
   * 军备栏是"人和铁"（兵营/军械坊/驯马场/铸炮厂/造船厂）。
   * 混在一栏里，玩家要在一堆维护费里找"我在哪征兵"。
   *
   * 这一栏的所有按钮都受"选国锁权"管（canAct）：不是你的省，
   * 每个钮都置灰 + title 写「非你的国家」—— 面板照常能看，只是按不动。 */
  function renderMilList(p) {
    var box = $('iMilList');
    if (!box) return;
    box.innerHTML = '';
    var i;
    for (i = 0; i < UNIV_MIL.length; i++) buildMilRow(box, p, UNIV_MIL[i]);

    /* 本省驻军：一行一支，点一下跳到军务面板改命令 */
    var gar = armiesIn(p.id);
    for (i = 0; i < gar.length; i++) {
      (function (a) {
        var it = itemOf(a), gen = generalOf(a), c = coOf(a.owner);
        var row = doc.createElement('div');
        row.className = 'rr army';
        row.title = (a.type === 'navy' ? '舰队' : '军队') + '：' + it.cn +
          '\n兵数 ' + a.men + (a.ships ? ' · 舰 ' + a.ships + ' 艘' : '') +
          '\n将领 ' + (gen ? gen.name + '（' + genTrait(gen).cn + '）' : '无') +
          '\n命令 ' + (a.order ? AO.ORDERS[a.order.type].cn + (a.order.tactic ? '（' + AO.tacOf(a.order.tactic).cn + '）' : '') : '待命') +
          (a.starved ? '\n⚠ 断粮中：战力 ×0.85' : '') +
          '\n点一下打开军务面板';
        row.innerHTML = '<span class="fl" style="background:' + (c ? c.color : '#888') + '"></span>' +
          '<span class="nm">' + (a.type === 'navy' ? '舰队·' : '') + it.cn + '</span>' +
          '<span class="qty">' + a.men + ' 人</span>' +
          (gen ? '<span class="old">' + escHtml(gen.name) + '</span>' : '<span class="old">无将</span>') +
          '<span class="sp"></span>' +
          '<i class="dot' + (a.starved ? ' halt' : ' on') + '"></i>';
        row.addEventListener('click', function () { openWarPanel(a.owner); });
        box.appendChild(row);
      })(gar[i]);
    }

    /* 征兵队列（等 1 回合成军的那一支） */
    var q = RECRUITQ[p.id];
    if (q) {
      var qrow = doc.createElement('div');
      qrow.className = 'rr site-row';
      qrow.textContent = '征兵中 · ' + (AO.MIL_ITEM[q.tier] || {}).cn + ' · 剩 ' + q.left + ' 回合成军';
      box.appendChild(qrow);
    }

    /* 城墙（城防值）：军备节的最后一行 —— 装备厂 → 驻军 → 征兵 → 城墙。
     * 军务面板那个入口仍然压在最后（它是导航，不是一行建筑）。 */
    buildWallRow(box, p);

    /* 入口：军务面板（将领、命令、战报都在这儿） */
    var link = doc.createElement('div');
    link.className = 'rr techlink';
    link.title = '军务：将领候选池 / 军队列表 / 命令与战术 / 战报';
    link.textContent = '军务面板：' + (canAct(p.owner) ? '下命令 · 抽将领 · 看战报 →' : '（别国，只能看）→');
    link.addEventListener('click', function () { openWarPanel(p.owner); });
    box.appendChild(link);
  }

  /* 一座装备厂的一行 */
  function buildMilRow(box, p, kind) {
    var D = AO.FACTORY[kind];
    var st = univOf(kind, p.id);
    var mine = canAct(p.owner);
    var ck = AO.FACTORY.check(kind, p, factoryCtx(p));

    var row = doc.createElement('div');
    row.className = 'rr bld';
    row.setAttribute('data-mil', kind);
    row.title = D.cn + '：已建 ' + st.n + ' 座' +
      (st.site > 0 ? '，在建（剩 ' + st.site + ' 回合）' : '') +
      '\n建厂条件：' + D.needCn +
      '\n造价 ' + costText(D.cost) + '（本省 → 中央 → 同国各省）' +
      '\n工期 ' + effectiveTurns(p.id, p.owner, D.turnsAt()) + ' 回合' +
      '\n维护 ' + maintText(D.maint, p.owner) + ' / 座·回合' +
      '\n' + D.desc +
      (st.order ? '\n当前订单：' + (AO.MIL_ITEM[st.order] || {}).cn : '') +
      (st.halted ? '\n维护欠费，停产中' : '');
    if (!mine) row.title += '\n（非你的国家：只能看）';
    /* 工厂的 ×2 要挂在**受益的那几行**上：否则玩家建了工厂却不知道谁受益 */
    if (kind !== 'barracks' && kind !== 'factory') {
      var fbx = FACTORY_BLD[p.id];
      if (fbx && fbx.n > 0 && !fbx.halted) {
        row.title += '\n本省有工厂：产出 ×' + (AO.FACTORY.factory.prodMul || 2) + '（料不变）';
      }
    }

    row.insertAdjacentHTML('beforeend', bldVisual(kind, 1, 22));

    var nmb = doc.createElement('span');
    nmb.className = 'nm';
    nmb.textContent = D.cn;
    row.appendChild(nmb);

    var q = doc.createElement('span');
    q.className = 'qty';
    q.textContent = '×' + st.n;
    row.appendChild(q);

    if (st.site > 0) {
      var stt = doc.createElement('span');
      stt.className = 'site';
      stt.textContent = '建' + st.site;
      stt.title = '在建：还要 ' + st.site + ' 回合';
      row.appendChild(stt);
    }
    /* 订单厂的当前订单，直接写在行上（不用点开 ? 才知道在产什么） */
    if (kind !== 'barracks' && kind !== 'stable' && st.order) {
      var od = doc.createElement('span');
      od.className = 'old';
      od.textContent = (AO.MIL_ITEM[st.order] || {}).cn || '';
      od.title = '当前订单';
      row.appendChild(od);
    }

    /* 建厂 ＋ */
    var add = doc.createElement('button');
    add.className = 'add';
    add.type = 'button';
    add.textContent = '＋';
    add.disabled = st.site > 0 || !ck.ok || !mine;
    add.title = !mine ? lockTitle()
      : st.site > 0 ? '还有工地在建，等完工'
        : !ck.ok ? ('建不了' + D.cn + '：' + ck.why)
          : '再建一座' + D.cn + '（' + costText(D.cost) + '）';
    row.appendChild(add);

    /* 兵营：一个「征」钮（征步兵；骑兵/炮兵在 ? 面板里） */
    var rec = null;
    if (kind === 'barracks' && st.n > 0) {
      var info = recruitInfo(p.id, 'inf');
      rec = doc.createElement('button');
      rec.className = 'upg';
      rec.type = 'button';
      rec.textContent = '征';
      rec.disabled = !info.ok || !mine;
      rec.title = !mine ? lockTitle() : info.ok
        ? '征兵：金 ' + info.need.gold + ' · 人口 ' + info.need.pop + ' · ' + info.tier.cn + ' ×' + info.need.wpn +
          '（' + info.tier.unit + ' ' + AO.RECRUIT.menPerUnit + ' 人）'
        : info.why;
      row.appendChild(rec);
    }

    var sp = doc.createElement('span');
    sp.className = 'sp';
    row.appendChild(sp);

    var dot = doc.createElement('i');
    dot.className = 'dot' + (st.halted ? ' halt' : st.site > 0 ? ' site' : st.n ? ' on' : '');
    row.appendChild(dot);

    var qb = doc.createElement('button');
    qb.className = 'qbtn';
    qb.type = 'button';
    qb.textContent = '?';
    qb.title = '建厂条件 / 订单 / 造价 / 维护';
    row.appendChild(qb);

    box.appendChild(row);

    var panel = doc.createElement('div');
    panel.className = 'qinfo' + (state.openKey === kind ? ' on' : '');
    panel.innerHTML = milInfoHtml(p, kind);
    box.appendChild(panel);
    if (state.openKey === kind) qb.classList.add('on');

    qb.addEventListener('click', function () {
      state.openKey = (state.openKey === kind) ? null : kind;
      var on = panel.classList.toggle('on');
      qb.classList.toggle('on', on);
      if (on) renderMilList(p);
    });
    add.addEventListener('click', function () {
      buildFactory(p, kind);
      renderInfoLists(p);
    });
    if (rec) rec.addEventListener('click', function () {
      var r = recruit(p.id, 'inf');
      bldMsg(r.msg, r.ok ? 'ok' : 'warn');
      renderInfoLists(p);
    });
    /* 订单按钮：军械坊 / 铸炮厂 / 造船厂 */
    var obts = panel.querySelectorAll('button[data-ord]');
    for (var j = 0; j < obts.length; j++) {
      obts[j].addEventListener('click', function () {
        var key = this.getAttribute('data-ord');
        var r = setShopOrder(p.id, kind, key === '-' ? null : key);
        bldMsg(r.msg, r.ok ? 'ok' : 'warn');
        renderMilList(p);
      });
    }
    /* 征兵按钮：步兵 / 骑兵 / 炮兵 */
    var rbts = panel.querySelectorAll('button[data-rec]');
    for (var k2 = 0; k2 < rbts.length; k2++) {
      rbts[k2].addEventListener('click', function () {
        var arms = this.getAttribute('data-rec');
        var r = recruit(p.id, arms);
        bldMsg(r.msg, r.ok ? 'ok' : 'warn');
        renderInfoLists(p);
      });
    }
  }

  /* 装备厂的 ? 面板：建厂条件 + 订单 + 产出 + （兵营）征兵选项 */
  function milInfoHtml(p, kind) {
    var D = AO.FACTORY[kind];
    var st = univOf(kind, p.id);
    var ck = AO.FACTORY.check(kind, p, factoryCtx(p));
    var mine = canAct(p.owner);
    var h = '<div class="h">' + D.cn + '<span>' + (st.n ? '已建 ' + st.n + ' 座' : '还没建') +
      (st.site > 0 ? ' · 在建（' + st.site + ' 回合）' : '') + '</span></div>';
    h += '<div class="l"><i>条件</i> ' + D.needCn +
      (ck.ok ? '　<em class="ok">已满足</em>' : '　<em class="halted">' + ck.why + '</em>') + '</div>';
    h += '<div class="l"><i>造价</i> ' + costText(D.cost) + '　工期 ' +
      effectiveTurns(p.id, p.owner, D.turnsAt()) + ' 回合</div>';
    h += '<div class="l"><i>维护</i> 每座每回合 ' + maintText(D.maint, p.owner) +
      '（付不起就停产，凑齐自动复工）</div>';

    if (kind === 'barracks') {
      h += '<div class="l"><i>征兵</i> 一回合一支；三样消耗：人口 ' + AO.RECRUIT.popPerUnit +
        ' · 金 ' + AO.RECRUIT.goldPerUnit + ' · 该代装备 ' + AO.RECRUIT.weaponPerUnit + ' 件</div>';
      h += '<div class="sellbox">';
      var arms = [['inf', '步兵'], ['cav', '骑兵'], ['art', '炮兵']];
      for (var i = 0; i < arms.length; i++) {
        var info = recruitInfo(p.id, arms[i][0]);
        var need = info.need || { gold: AO.RECRUIT.goldPerUnit, pop: AO.RECRUIT.popPerUnit, wpn: AO.RECRUIT.weaponPerUnit };
        var dis = !info.ok || !mine;
        h += '<div class="srow"><span>' + arms[i][1] + '</span><em>' +
          (info.tier ? info.tier.cn : '—') + '</em>' +
          '<button type="button" data-rec="' + arms[i][0] + '"' + (dis ? ' disabled' : '') +
          ' title="' + escHtml(!mine ? lockTitle() : info.ok
            ? ('征一支 ' + info.tier.unit + '：金 ' + need.gold + ' · 人口 ' + need.pop +
              ' · ' + info.tier.cn + ' ×' + need.wpn + (need.horse ? ' · 战马 ' + need.horse : ''))
            : info.why) + '">' +
          '征 ' + AO.RECRUIT.menPerUnit + ' 人</button></div>';
      }
      h += '</div>';
      if (st.n && !mine) h += '<div class="l gone"><i>锁</i> 非你的国家：只能看，不能征</div>';
    } else if (kind === 'stable') {
      h += '<div class="l"><i>产出</i> 每座每回合 +' + (D.per || 1) + ' 战马（本省库存 ' +
        itemStock(p.id, 'warhorse') + ' 匹）</div>' +
        '<div class="l"><i>用途</i> 重骑兵（强弩·具装）成建制要 1 匹马 / 支 —— 这是骑兵的第二道闸</div>';
    } else if (kind === 'factory') {
      /* 工厂：不产东西，只放大本省的军械产能 */
      var fm = (st.n > 0 && !st.halted) ? (D.prodMul || 2) : 1;
      h += '<div class="l"><i>效果</i> 本省军械坊 / 驯马场 / 铸炮厂 / 造船厂 每回合产出 <b>×' +
        (D.prodMul || 2) + '</b>（料不变 —— 工业化解放产能，不解放原料）</div>' +
        '<div class="l"><i>本省</i> ' + (st.n ? (st.halted ? '工厂停产中 → 产能 ×1' : '产能 ×' + fm)
          : '还没有工厂 → 产能 ×1') + '</div>' +
        '<div class="l"><i>范围</i> 只放大 <b>本省</b> 的厂；科技只解锁"能接哪种订单"，不提高产量</div>';
    } else {
      /* 三个订单厂：列出已解锁的装备，点一下就改产 */
      var group = kind === 'armory' ? 'weapon' : kind === 'foundry' ? 'gun' : 'ship';
      var list = unlockedItems(p.owner, group);
      var all = group === 'weapon' ? AO.MIL_ORDER : group === 'gun' ? AO.GUN_ORDER : AO.SHIP_ORDER;
      var fb2 = FACTORY_BLD[p.id];
      var om = (fb2 && fb2.n > 0 && !fb2.halted) ? (AO.FACTORY.factory.prodMul || 2) : 1;
      h += '<div class="l"><i>订单</i> 每座每回合按配方产（产能是闸：不随科技涨，想多产就多盖）' +
        (om > 1 ? '　<em class="ok">本省有工厂：产出 ×' + om + '</em>' : '') + '</div>';
      h += '<div class="sellbox">';
      for (var j = 0; j < all.length; j++) {
        var it = AO.MIL_ITEM[all[j]];
        var unlocked = it.tech ? !!(RESEARCH[p.owner] && RESEARCH[p.owner].done[it.tech]) : true;
        var on = st.order === it.key;
        var rec = [], k;
        for (k in it.recipe) rec.push((AO.RES_SHORT[k] || k) + it.recipe[k]);
        h += '<div class="srow"><span>' + it.cn + '</span><em>' + rec.join('+') + '→' + it.out + '</em>' +
          '<button type="button" data-ord="' + it.key + '"' + ((!unlocked || !mine) ? ' disabled' : '') +
          (on ? ' class="on"' : '') +
          ' title="' + escHtml(!mine ? lockTitle() : !unlocked
            ? ('还没解锁：先研究「' + ((AO.TECH_BY_KEY[it.tech] || {}).cn || it.tech) + '」')
            : ('订单改成「' + it.cn + '」：每座每回合吃 ' + rec.join('+') + '，出 ' + it.out + ' 件')) +
          '">' + (on ? '在产' : '接单') + '</button></div>';
      }
      if (st.order) {
        h += '<div class="srow"><span>停工</span><em>—</em>' +
          '<button type="button" data-ord="-" title="不接单：不产也不耗料">停</button></div>';
      }
      h += '</div>';
      /* 本省库存里已有的该组装备 */
      var stockLine = [];
      for (var m = 0; m < all.length; m++) {
        var sv = itemStock(p.id, all[m]);
        if (sv > 0) stockLine.push((AO.MIL_ITEM[all[m]] || {}).cn + ' ' + sv);
      }
      h += '<div class="l"><i>库存</i> ' + (stockLine.length ? stockLine.join(' · ') : '本省还没有成品') + '</div>';
    }
    return h;
  }

  /* 「货运」栏：等级越高，调拨损耗越低、工期越短 */
  function renderFreightList(p) {
    var box = $('iFreightList');
    if (!box) return;
    box.innerHTML = '';
    var lv = FREIGHT_LV[p.id] || 0;
    var F = AO.FREIGHT;
    var cost = F.costAt(lv);
    var mods = MODS(p.owner);
    var lossNow = effectiveLoss(p.id, p.owner);
    var turnNow = effectiveTurns(p.id, p.owner);
    /* 「驿道」把损耗往下压，但压的是最终值、不是 FREIGHT 本身 ——
     * 所以面板要分开写"基础 30%，驿道 −5% → 实际 25%" */
    var lossBase = F.lossAt(lv);
    var lossNote = mods.lossCut
      ? '（基础 ' + Math.round(lossBase * 100) + '%，驿道 −' + Math.round(mods.lossCut * 100) + '%）' : '';
    var turnBase = F.turnsAt(lv);
    var turnNote = mods.turnCut ? '（基础 ' + turnBase + '，学徒制 −' + mods.turnCut + '）' : '';

    var row = doc.createElement('div');
    row.className = 'rr bld';
    row.title = '货运站 Lv' + lv + '：调拨损耗 ' + Math.round(lossNow * 100) + lossNote +
      '%，建造工期 ' + turnNow + ' 回合' + turnNote + '\n升级造价 ' +
      (lv >= F.maxLv ? '已满级' : costText(cost) + '（每级固定）');

    var img = doc.createElement('img');
    img.src = 'assets/res/item-freight-bld.png';
    img.onerror = function () { this.style.visibility = 'hidden'; };
    row.appendChild(img);

    var nmb = doc.createElement('span');
    nmb.className = 'nm';
    nmb.textContent = '货运站';
    row.appendChild(nmb);

    var lvChip = doc.createElement('span');
    lvChip.className = 'lv';
    lvChip.textContent = 'Lv' + lv;
    row.appendChild(lvChip);

    var add = doc.createElement('button');
    add.className = 'add';
    add.type = 'button';
    add.textContent = '＋';
    add.disabled = lv >= F.maxLv;
    add.title = lv >= F.maxLv ? '已满级' : '升级：' + costText(cost);
    lockBtn(add, p.owner);
    row.appendChild(add);

    var sp = doc.createElement('span');
    sp.className = 'sp';
    row.appendChild(sp);

    var dot = doc.createElement('i');
    dot.className = 'dot' + (lv > 0 ? ' on' : '');
    row.appendChild(dot);

    var qb = doc.createElement('button');
    qb.className = 'qbtn';
    qb.type = 'button';
    qb.textContent = '?';
    qb.title = '货运效果';
    row.appendChild(qb);

    box.appendChild(row);

    var panel = doc.createElement('div');
    panel.className = 'qinfo' + (state.openKey === 'freight' ? ' on' : '');
    /* 「升级」只写**真的会变**的那几项：损耗每级都降，工期不一定动 ——
     * 旧文案无条件写「工期 N 回合」，Lv2→Lv3 时前后都是 2，看着像白花钱。 */
    var upLine;
    if (lv >= F.maxLv) upLine = '已满级';
    else {
      var dTurn = F.turnsAt(lv) - F.turnsAt(lv + 1);
      upLine = costText(cost) + ' → 损耗 ' + Math.round(F.lossAt(lv) * 100) + '%→' +
        Math.round(F.lossAt(lv + 1) * 100) + '%' +
        (dTurn > 0 ? '、工期 ' + F.turnsAt(lv) + '→' + F.turnsAt(lv + 1) + ' 回合' : '（工期不变）');
    }
    panel.innerHTML =
      '<div class="h">货运站<span>Lv' + lv + ' / ' + F.maxLv + '</span></div>' +
      '<div class="l"><i>调拨</i> 从中央/邻省调资源，路上损耗 ' + Math.round(lossNow * 100) + '%' + lossNote + '</div>' +
      '<div class="l"><i>工期</i> 建一座资源建筑要 ' + turnNow + ' 回合' + turnNote + '</div>' +
      '<div class="l"><i>升级</i> ' + upLine + '</div>' +
      (mods.lossCut || mods.turnCut
        ? '<div class="l"><i>加成</i> 全局科技已生效：' +
          (mods.lossCut ? '损耗 −' + Math.round(mods.lossCut * 100) + '%' : '') +
          (mods.lossCut && mods.turnCut ? ' · ' : '') +
          (mods.turnCut ? '工期 −' + mods.turnCut : '') + '（不改货运等级本身）</div>'
        : '');
    box.appendChild(panel);
    if (state.openKey === 'freight') qb.classList.add('on');

    (function (btn, pn, pp) {
      btn.addEventListener('click', function () {
        state.openKey = (state.openKey === 'freight') ? null : 'freight';
        var on = pn.classList.toggle('on');
        btn.classList.toggle('on', on);
        if (on) renderFreightList(pp);
      });
      add.addEventListener('click', function () {
        upgradeFreight(pp);
        renderInfoLists(pp);
      });
    })(qb, panel, p);
  }

  /* 「城墙」行（军备节最后一行）—— 结构照货运站那一行抄：
   * Lv 徽章 + 耐久 + ＋升级 + 状态灯 + ? 详情。两行读法一致，玩家不用重学。
   * 状态灯：绿 = 完好；黄 = 在建；红 = 维护欠费（年久失修）；灭 = 没墙。 */
  function buildWallRow(box, p) {
    var W = AO.WALL, w = WALL[p.id];
    var lv = w ? w.lv : 0, max = W.maxHp(lv), hp = w ? Math.round(w.hp) : 0;
    var mine = canAct(p.owner);
    var full = lv >= W.maxLv;
    var cost = W.costAt(lv);
    var site = w ? w.site : 0;
    var halted = !!(w && w.halted);
    var mulNow = max > 0 && hp > 0 ? 1 + (hp / max) * W.defendMul : 1;

    var row = doc.createElement('div');
    row.className = 'rr bld';
    row.setAttribute('data-wall', '1');
    row.title = '城墙 Lv' + lv + (lv > 0 ? '（' + W.lvCn[lv] + '）' : '（还没砌）') +
      '\n耐久 ' + hp + ' / ' + max + '（1 点城防 ≈ ' + W.manPerHp + ' 人份伤亡）' +
      '\n会战：守方伤亡先扣墙，耐久 >0 时守方战力 ×' + mulNow.toFixed(2) +
      '（满耐久 ×' + (1 + W.defendMul).toFixed(2) + '）' +
      '\n破城锤：每场会战额外 −攻方攻城值合计 ×' + W.breachMul +
      '\n维护 ' + maintText(W.maintAt(lv || 1), p.owner) + (lv ? '' : '（Lv1 起）') +
      ' /回合；欠费 → 每回合 −' + W.decay + ' 耐久' +
      '\n回复 无战事 +' + W.regen + '/回合（打过仗的回合不修；「营造」将驻防再 +' + W.fabricRegen + '）' +
      (site > 0 ? '\n在建：剩 ' + site + ' 回合' : '') +
      (halted ? '\n维护欠费：年久失修中' : '') +
      (mine ? '' : '\n（非你的国家：只能看）');

    var img = doc.createElement('img');
    img.src = 'assets/res/item-wall-bld.png';
    img.onerror = function () { this.style.visibility = 'hidden'; };
    row.appendChild(img);

    var nmb = doc.createElement('span');
    nmb.className = 'nm';
    nmb.textContent = '城墙';
    row.appendChild(nmb);

    var lvChip = doc.createElement('span');
    lvChip.className = 'lv';
    lvChip.textContent = 'Lv' + lv;
    row.appendChild(lvChip);

    /* 耐久直接写在行上（不用点开 ? 才知道墙还剩多少） */
    if (lv > 0) {
      var q = doc.createElement('span');
      q.className = 'qty';
      q.textContent = hp + '/' + max;
      q.title = '城墙耐久';
      row.appendChild(q);
    }

    var add = doc.createElement('button');
    add.className = 'add';
    add.type = 'button';
    add.textContent = '＋';
    add.disabled = full || site > 0 || !mine;
    add.title = !mine ? lockTitle()
      : full ? '已满级（' + W.lvCn[W.maxLv] + '）'
        : site > 0 ? '还有工地在建（剩 ' + site + ' 回合）'
          : (lv === 0 ? '砌墙' : '加高一级') + '：' + costText(cost) +
            '（上限 ' + max + ' → ' + W.maxHp(lv + 1) + '，' + W.turnsAt(lv) + ' 回合）';
    lockBtn(add, p.owner);
    row.appendChild(add);

    var sp = doc.createElement('span');
    sp.className = 'sp';
    row.appendChild(sp);

    var dot = doc.createElement('i');
    dot.className = 'dot' + (halted ? ' halt' : site > 0 ? ' site' : lv > 0 ? ' on' : '');
    row.appendChild(dot);

    var qb = doc.createElement('button');
    qb.className = 'qbtn';
    qb.type = 'button';
    qb.textContent = '?';
    qb.title = '城墙：耐久 / 守势 / 破城 / 维护 / 升级';
    row.appendChild(qb);

    box.appendChild(row);

    var panel = doc.createElement('div');
    panel.className = 'qinfo' + (state.openKey === 'wall' ? ' on' : '');
    var upLine;
    if (full) upLine = '已满级（' + W.lvCn[W.maxLv] + '，耐久上限 ' + max + '）';
    else {
      upLine = costText(cost) + ' → 上限 ' + max + ' → ' + W.maxHp(lv + 1) +
        '、' + W.turnsAt(lv) + ' 回合（' + W.lvCn[lv + 1] + '）';
    }
    panel.innerHTML =
      '<div class="h">城墙<span>' + (lv > 0 ? W.lvCn[lv] + ' · ' : '') + 'Lv' + lv + ' / ' + W.maxLv + '</span></div>' +
      '<div class="l"><i>耐久</i> ' + hp + ' / ' + max +
        ' —— 会战与轰击先扣它，扣空了才伤兵；1 点 ≈ ' + W.manPerHp + ' 人份伤亡</div>' +
      '<div class="l"><i>守势</i> 耐久 >0 时守方战力 ×' + mulNow.toFixed(2) +
        '（满耐久 ×' + (1 + W.defendMul).toFixed(2) + '）</div>' +
      '<div class="l"><i>破城</i> 每场会战额外 −攻方攻城值合计 ×' + W.breachMul +
        '（重炮碾墙、皮甲啃不动）</div>' +
      '<div class="l"><i>围城</i> 无视城墙 —— 围而不打照样饿到开城</div>' +
      '<div class="l"><i>回复</i> 无战事 +' + W.regen + '/回合（「营造」将驻防再 +' + W.fabricRegen +
        '，守城胜后回充 ' + Math.round(W.fabricRefill * 100) + '%）</div>' +
      '<div class="l"><i>维护</i> ' + maintText(W.maintAt(lv || 1), p.owner) +
        (lv ? '' : '（Lv1 起）') + ' /回合；欠费 → 年久失修 −' + W.decay + '/回合</div>' +
      '<div class="l"><i>升级</i> ' + upLine + '</div>';
    box.appendChild(panel);
    if (state.openKey === 'wall') qb.classList.add('on');

    (function (btn, pn, pp) {
      btn.addEventListener('click', function () {
        state.openKey = (state.openKey === 'wall') ? null : 'wall';
        var on = pn.classList.toggle('on');
        btn.classList.toggle('on', on);
        if (on) renderMilList(pp);
      });
      add.addEventListener('click', function () {
        upgradeWall(pp);
        renderInfoLists(pp);
      });
    })(qb, panel, p);
  }

  /* 三栏一起刷 */
  function renderInfoLists(p) {
    renderPop(p);
    renderHappy(p);
    renderOfficial(p);
    renderFaithRow(p);        // 信仰（名 + 符号 + 国教角标 / 传教倒计时）
    renderResList(p);
    renderUniversalList(p);
    renderBldList(p);
    renderFreightList(p);
    renderMilList(p);          // 军备（兵营/军械坊/驯马场/铸炮厂/造船厂 + 本省驻军）
    renderFlow(p);
  }

  /* ---------------- 省卡「信息」栏的城防行 ----------------
   * 只有砌了墙的省才显示（没墙 → 整行隐藏，不占版面）。
   * 迷雾遮蔽（unknown / seen）时一律隐藏：耐久是**真实数据**，
   * 不该从一份旧情报里漏出来（和军旗、驻军数同一条纪律）。 */
  function renderWallRow(p) {
    var row = $('iWallRow'), el = $('iWall');
    if (!row || !el) return;
    var W = AO.WALL, w = p ? WALL[p.id] : null;
    if (!w || !(w.lv > 0)) {
      row.style.display = 'none';
      el.textContent = '';
      el.title = '';
      return;
    }
    row.style.display = '';
    var max = W.maxHp(w.lv), hp = Math.round(w.hp);
    var mul = hp > 0 ? 1 + (hp / max) * W.defendMul : 1;
    el.textContent = hp + ' / ' + max;
    el.title = '城墙 Lv' + w.lv + '（' + W.lvCn[w.lv] + '）· 守方战力 ×' + mul.toFixed(2) +
      '\n会战/轰击先扣城防，扣空了才伤兵；围城无视城墙' +
      '\n维护 ' + maintText(W.maintAt(w.lv), p.owner) + ' /回合' +
      (w.halted ? '（欠费：每回合 −' + W.decay + '，年久失修）' : '（无战事 +' + W.regen + '/回合）') +
      (w.site > 0 ? '\n在建：剩 ' + w.site + ' 回合' : '') +
      '\n点「建筑」页签 → 军备栏最后一行可以升级';
    row.classList.toggle('low', hp / max < 0.34);
  }
  function hideWallRow() {
    var row = $('iWallRow');
    if (row) row.style.display = 'none';
  }

  /* ---------------- 收支小结（省卡「信息」栏底部） ----------------
   * 一行只放**非零项**，按量级从大到小：`＋5 粮 · ＋2 木 · −1 铁 · −1 金`。
   * 数字全部来自 FLOW[pid]（上一回合**实际发生**的进出），不是需求额 ——
   * 所以"产出 3 但维护欠费 2"会如实显示成 ＋3 与 −0（没扣成就没记）。 */
  var FLOW_ORDER = ['grain', 'fish', 'timber', 'iron', 'gold', 'horse', 'salt'];
  /* 满仓损耗的简写：`满仓 −3 粮、−2 木`。空串 = 这一回合没浪费。
   * 单独抽出来是因为收支小结和悬停明细都要用，写法必须一致。 */
  function capText(F) {
    if (!F || !F.d || !F.d.cap) return '';
    var a = [], k;
    for (var i = 0; i < FLOW_ORDER.length; i++) {
      k = FLOW_ORDER[i];
      var v = F.d.cap[k] || 0;
      if (v > 0) a.push((a.length ? '、' : '') + '−' + v + ' ' + (AO.RES_SHORT[k] || k));
    }
    return a.length ? '满仓 ' + a.join('') : '';
  }
  AO.resCapText = capText;
  function flowText(F) {
    if (!F) return '—';
    var items = [], k;
    for (var i = 0; i < FLOW_ORDER.length; i++) {
      k = FLOW_ORDER[i];
      var v = (F.gain[k] || 0) - (F.loss[k] || 0);
      if (v) items.push({ k: k, v: v });
    }
    items.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    var out = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      out.push((it.v > 0 ? '＋' : '−') + Math.abs(it.v) + ' ' + (AO.RES_SHORT[it.k] || it.k));
    }
    /* 满仓损耗不是"进出"，但不写出来玩家就会把"产出 3 只进 1"当成 bug */
    var ct = capText(F);
    if (ct) out.push(ct);
    if (!out.length) return '本回合没有进出';
    return out.join(' · ');
  }
  AO.resFlowText = flowText;

  function flowDetail(F) {
    if (!F) return '';
    var parts = [], k;
    function pack(bag) {
      var a = [];
      for (var i = 0; i < FLOW_ORDER.length; i++) {
        k = FLOW_ORDER[i];
        if (bag && bag[k]) a.push((AO.RES_SHORT[k] || k) + ' ' + bag[k]);
      }
      return a.join('、');
    }
    var gainS = pack(F.gain), lossS = pack(F.loss);
    if (gainS) parts.push('产出 ' + gainS);
    if (lossS) parts.push('支出 ' + lossS);
    var eatS = pack(F.d.eat), taxS = pack(F.d.tax), mS = pack(F.d.maint);
    var mCS = pack(F.d.maintC);
    if (eatS) parts.push('居民吃掉 ' + eatS);
    if (taxS) parts.push('生产抽税 ' + taxS + '（去中央）');
    if (mS) parts.push('维护 ' + mS + (mCS ? '（另有中央垫付 ' + mCS + '，记在国库账上）' : ''));
    /* 治理层两笔：人口税进省库、俸禄出省库。都是"金"，但一个是收入一个是支出，
     * 且都不进中央 —— 所以单列两行，免得读者把它和上面的生产抽税混成一笔。 */
    if (F.d.popTax) parts.push('人口税 +' + F.d.popTax + ' 金（进省库）');
    if (F.d.salary) parts.push('官员俸禄 −' + F.d.salary + ' 金');
    /* 满仓损耗单列一行：它不是"支出"，是**根本没进过库存**的那部分产量 */
    var capS2 = capText(F);
    if (capS2) parts.push(capS2 + '（省库到了上限，多出来的就地损耗）');
    return parts.join('\n');
  }

  /* 本省这一回合停产了哪几类（欠费）—— 收支小结的 title 要把它写出来，
   * 否则"产出明明有 3，怎么只进账 0"读者要自己猜。 */
  function haltedNames(p) {
    var out = [], bag = SIM[p.id] || {}, key, s;
    for (key in bag) {
      s = bag[key];
      if (s && s.built && s.halted) {
        var d = AO.RESOURCE_BY_KEY[key];
        out.push(d ? d.build : key);
      }
    }
    for (var i = 0; i < UNIV_KINDS.length; i++) {
      var st = UNIV[UNIV_KINDS[i]][p.id];
      if (st && st.n > 0 && st.halted) out.push(univDef(UNIV_KINDS[i]).cn);
    }
    return out;
  }

  function renderFlow(p) {
    var el = $('iFlow');
    if (!el) return;
    var F = FLOW[p.id];
    el.innerHTML = '<span>收支</span><span class="fv">' + flowText(F) + '</span>';
    var halt = haltedNames(p);
    el.title = '上一回合的实际进出（＋入 −出）\n' + (flowDetail(F) || '还没有结算过') +
      '\n\n维护只在"真的扣到了"时才记支出；欠费停产的部分不记。' +
      (halt.length ? '\n维护欠费停产：' + halt.join('、') + '（本回合产量 0）' : '');
  }

  /* ---------------- 回合：玩家自己点「下一回合」 ----------------
   * 不再自动走表 —— 什么时候结算由玩家决定（右上角按钮 / 空格）。
   * 一次点击 = settleTurn() 把 1106 个省 × 7 种资源全部结算一遍。 */
  function updateTurnLabel() {
    var el = $('turnNo');
    if (el) el.textContent = turnNo;
  }

  function nextTurn() {
    /* 事件弹窗开着 = 这一回合的账还没处置完，不许往下走（回合制不抢戏）。
     * 三个入口（右上角 / 科技树 / 治理面板）和空格键都汇到这里，所以只守这一处。 */
    if (AO.evtPending && AO.evtPending()) { toast('先把这件事处置了', 1800); return; }
    /* 玩家在回合中的操作（楼盖好了 / 科技完成 / 宣战）也会往 NOTES 里推。
     * 清空之前先抄进年表，否则这些话跟着 NOTES 一起没了。 */
    if (AO.chronoArchiveNotes) AO.chronoArchiveNotes();
    NOTES.length = 0;
    settleTurn();
    updateTurnLabel();
    var box = $('turnBox');
    if (box) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
    if (state.world && state.renderer) {
      var id = state.renderer.selected;
      if (id) {
        var p = state.world.provinces[id - 1];
        /* 迷雾下的省卡不能直接 renderInfoLists（那会按真实数据重画）——
         * 交给 showInfo 自己回到遮蔽版 */
        if (p) {
          if (fogOn() && visCode(id) !== VIS_REAL) showInfo(id);
          else renderInfoLists(p);
        }
      }
      /* 国家卡开着就跟着刷（科研条/在研倒计时都要动） */
      var shown = state.renderer.selectedCountry;
      if (shown && $('country').classList.contains('on')) showCountry(shown);
    }
    if (TT.open) renderTechTree(false);
    if (GP.open) renderGovPanel();     // 治理面板开着 → 税入 / 民心 / 省库跟着刷
    flushNotes();
  }

  /* 把这一回合攒下的提示报出来：优先当前看得到的那个国家 / 那个省，
   * 其余国家的事不弹（64 个国家一起喊会糊成一片）。 */
  function flushNotes() {
    if (!NOTES.length) return;
    var cid = state.renderer ? state.renderer.selectedCountry : 0;
    var pid = state.renderer ? state.renderer.selected : 0;
    if (!cid && pid && state.world) {
      var p = state.world.provinces[pid - 1];
      if (p) cid = p.owner;
    }
    var mine = [], i;
    for (i = 0; i < NOTES.length; i++) {
      var n = NOTES[i];
      if (n.pid) { if (n.pid === pid) mine.push(n); }
      else if (n.owner === cid) mine.push(n);
    }
    if (!mine.length) return;
    bldMsg(mine[0].text + (mine.length > 1 ? '（另有 ' + (mine.length - 1) + ' 条）' : ''), mine[0].cls);
  }
  AO.resNextTurn = nextTurn;

  /* 省份卡的两个入口：null = 只显示「信息 / 建筑」两个词，'info' / 'bld' = 展开对应界面。
   * 只切 #infoBody 上的类名，DOM 结构（以及所有 id）一个都不动。 */
  function applyInfoTab() {
    var body = $('infoBody');
    if (!body) return;
    body.classList.toggle('tab-info', state.infoTab === 'info');
    body.classList.toggle('tab-bld', state.infoTab === 'bld');
    var tabs = $('infoTabs') ? $('infoTabs').querySelectorAll('.itab') : [];
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === state.infoTab);
    }
  }

  /* 人口行：数值 + 涨跌箭头；悬停给密度、口粮、上回合涨跌 */
  function renderPop(p) {
    var el = $('iPop');
    if (!el) return;
    var s = POP[p.id] || { v: p.population || 0, rate: 0, need: 0 };
    var ppl = Math.round(s.v);
    var arrow = s.rate > 0 ? '<i class="up">↑</i>' : s.rate < 0 ? '<i class="down">↓</i>' : '';
    el.innerHTML = AO.formatPop(ppl) + arrow;
    var w = state.world;
    var cty = w ? w.countries[p.owner - 1] : null;
    var km2 = cty && cty.kmPerPx ? p.area * cty.kmPerPx : 0;
    var rateTxt = s.rate > 0 ? '+' + (s.rate * 100).toFixed(1) + '%/回合'
      : s.rate < 0 ? '−1.5%/回合（闹饥荒）' : '人口稳定';
    el.title = ppl.toLocaleString() + ' 人' +
      (km2 ? '　密度 ' + Math.round(ppl / km2) + ' 人/km²' : '') +
      '\n口粮 ' + (s.need || 0) + ' 单位/回合（每 200 万人 1 单位，先粮食、再渔获）' +
      '\n本回合产出 ' + Math.round(s.prod || 0) + ' 单位 → 富余 ' +
      Math.round((s.prod || 0) - (s.need || 0)) + ' → ' + rateTxt +
      (s.happyMul && s.happyMul !== 1
        ? '\n民心修正：×' + s.happyMul + '（民心 ' +
          Math.round((HAPPY[p.id] ? HAPPY[p.id].v : AO.GOV.happyStart)) +
          (s.happyMul < 1 ? ' ≤ ' + AO.GOV.happyLow + '，增速打折' : ' ≥ ' + AO.GOV.happyHigh + '，增速加成') + '）'
        : '') +
      '\n想让人口涨快些，就多盖农场 / 渔港。';
  }

  /* 民心一行：数字 + 悬停逐项 drivers（明细由 happyTitle 统一生成） */
  function renderHappy(p) {
    var el = $('iHappy');
    if (!el) return;
    var h = happyOf(p.id), G = AO.GOV;
    var v = Math.round(h.v);
    /* 箭头指向**接下来会往哪走**（target 在上就是 ↑），不是"现在比 60 高还是低" */
    var arrow = h.target > h.v + 0.5 ? '<i class="up">↑</i>'
      : h.target < h.v - 0.5 ? '<i class="down">↓</i>' : '';
    el.innerHTML = v + arrow + '<em class="hmul">×' + G.happyTaxMul(h.v).toFixed(2) + '</em>';
    el.className = v <= G.happyLow ? 'low' : v >= G.happyHigh ? 'high' : '';
    el.title = happyTitle(p.id);
  }

  /* 官员一行：在任 → 名字 · 词条（点开治理面板撤换）；空缺 → 去派一位 */
  function renderOfficial(p) {
    var el = $('iOfficial');
    if (!el) return;
    var off = OFFICIAL[p.id];
    if (off) {
      var tr = AO.traitOf(off.traitKey);
      el.innerHTML = '<b>' + off.name + '</b><span class="otag ' + tr.rar + '">' + tr.cn + '</span>';
      el.title = tr.cn + '：' + tr.desc +
        '\n俸禄 ' + AO.GOV.salary + ' 金/回合（省库发）' +
        (off.owed ? '\n欠俸 ' + off.owed + ' 金（下回合补，不罚）' : '') +
        '\n点击打开治理面板（可以撤换）';
      el.className = 'has';
    } else {
      el.textContent = '空缺（无官裸税 ×' + AO.GOV.noOfficerMul + '）';
      el.title = '没有官员的省只能收 ' + AO.GOV.noOfficerMul + ' 倍的税。\n' +
        '去「治理」面板派一位上任 —— 学校产人才点，开科取士抽官员。';
      el.className = 'none';
    }
  }

  /* 信仰一行：符号 + 名 + 「国教」角标（或传教倒计时）。
   * 信息归省卡、操作归治理面板 —— 所以这里**没有按钮**，只有一句"去哪儿传教"。
   * 数据全从 16-events.js 问：省上的 faithIdx、STATEFAITH[owner]、MISSION[pid]。 */
  function renderFaithRow(p) {
    var el = $('iFaith');
    if (!el) return;
    var FA = AO.FAITHS || [];
    var fi = (typeof p.faithIdx === 'number') ? p.faithIdx : -1;
    var f = FA[fi] || null;
    var sf = AO.stateFaithOf ? AO.stateFaithOf(p.owner) : -1;
    var mis = AO.missionOf ? AO.missionOf(p.id) : null;
    var h = '';
    if (f) {
      h += '<span class="fsym" style="color:' + f.color + '">' + symSvg(f, 14) + '</span>' +
        '<span>' + f.cn + '</span>';
    } else {
      h += '<span style="color:#a8b0b7">未定</span>';
    }
    if (f && fi === sf) h += '<span class="ftag">国教</span>';
    else if (mis) h += '<span class="ftag mis">传教 ' + mis.left + '</span>';
    el.innerHTML = h;

    var lines = [];
    if (f) lines.push(f.cn + '「' + f.tenet + '」');
    lines.push('国教：' + (sf >= 0 ? AO.faithName(sf) : '无'));
    var owner = p.owner;
    lines.push('政策：' + AO.FAITH.polDesc[AO.faithPolOf(owner)]);
    if (f && sf >= 0 && fi !== sf) {
      lines.push('异信仰：民心 ' + AO.faithDriver(p.id, owner) + '（改宗可免）');
    }
    if (mis) lines.push('传教中：剩 ' + mis.left + ' 回合 → ' + AO.faithName(mis.to));
    lines.push('传教在「治理」面板：本国省份那一行的「传教」钮');
    el.title = lines.join('\n');
  }

  /* 省份信息 */
  function clearInfo() {
    $('info').classList.remove('on');
    $('info').classList.remove('fog-seen', 'fog-unknown');
    $('infoEmpty').style.display = '';
    $('infoEmpty').innerHTML = '未选中省份';
    $('infoBody').style.display = 'none';
    state.infoTab = null;
    applyInfoTab();
    hideWallRow();              // 城防行跟着省卡一起收起（别把上一省的墙留在版面上）
    if (state.renderer) state.renderer.selected = 0;
  }

  function showInfo(id) {
    var w = state.world;
    if (!id) { clearInfo(); return; }
    var p = w.provinces[id - 1];
    if (!p) { clearInfo(); return; }
    /* 换省份时收起上一省的问号面板；同一省重绘（计时器刷新）则保持展开 */
    if (state.infoId !== id) {
      state.infoId = id;
      state.openKey = null;
      state.selKey = null;
      state.infoTab = null;          // 换省 → 回到"只有两个词"的初始态
      bldMsg('');
    }
    $('info').classList.add('on');
    /* 迷雾（v6）：先判可见性。unknown / seen 走遮蔽版省卡，
     * 只有 realtime（自己的省、脚下的省、友好邻省）才是原来的全透明卡片。 */
    var vs = fogOn() ? visCode(id) : VIS_REAL;
    $('info').classList.toggle('fog-seen', vs === VIS_SEEN);
    $('info').classList.toggle('fog-unknown', vs === VIS_UNKNOWN);
    if (vs !== VIS_REAL) { showFogInfo(p); return; }
    $('infoEmpty').style.display = 'none';
    $('infoBody').style.display = '';
    applyInfoTab();
    $('iSw').style.background = p.ownerColor;
    $('iName').textContent = p.name;
    $('iNameEn').textContent = p.name_en;
    $('iOwner').textContent = p.ownerName + ' (#' + p.owner + ')';
    $('iTerrain').textContent = (AO.TERRAIN_CN[p.terrain] || p.terrain) + ' · ' + p.terrain;
    var wt = waterText(p);
    $('iWater').textContent = wt;
    $('iWater').title = wt + '　|　渔获：' + fishWhy(p);
    renderPop(p);
    renderInfoLists(p);
    renderWallRow(p);          // 城防（有墙才显示；迷雾遮蔽时在 showFogInfo 里隐藏）
    $('iArea').textContent = p.area.toLocaleString() + ' px²';
    $('iCentroid').textContent = p.centroid[0].toFixed(1) + ', ' + p.centroid[1].toFixed(1);
    $('iDeg').textContent = p.neighbors.length + ' 个';

    var box = $('iNeighbors');
    box.innerHTML = '';
    for (var i = 0; i < p.neighbors.length; i++) {
      (function (nid) {
        var q = w.provinces[nid - 1];
        if (!q) return;
        var s = doc.createElement('span');
        s.className = 'chip';
        s.textContent = q.name;
        s.title = q.ownerName;
        s.style.borderLeft = '3px solid ' + q.ownerColor;
        s.addEventListener('click', function () {
          state.renderer.select(nid);
          centerOn(nid);
        });
        box.appendChild(s);
      })(p.neighbors[i]);
    }
    // 国家卡开着的时候，点省份也跟着换成该省所属国
    if ($('country').classList.contains('on') && state.renderer) {
      state.renderer.selectedCountry = p.owner;
      showCountry(p.owner);
    }
  }

  /* ---------------- 国家卡片 ---------------- */
  function symSvg(f, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor">' +
      f.sym + '</svg>';
  }

  /* 宗教视图底部的图例：只列这个世界里真实存在的信仰 */
  function updateFaithLegend(view) {
    var box = $('faithLegend');
    if (view !== 'faith' || !state.world) { box.classList.remove('on'); return; }
    var w = state.world, cnt = {}, order = [];
    for (var i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (!p || p.faithIdx === undefined || p.faithIdx < 0) continue;
      if (cnt[p.faithIdx] === undefined) { cnt[p.faithIdx] = 0; order.push(p.faithIdx); }
      cnt[p.faithIdx] += p.area;
    }
    order.sort(function (a, b) { return cnt[b] - cnt[a]; });
    var html = '';
    for (var k = 0; k < order.length; k++) {
      var f = AO.FAITHS[order[k]];
      html += '<span class="fl"><i style="background:' + f.color + '"></i>' +
        '<span class="sy" style="color:' + f.color + '">' + symSvg(f, 13) + '</span>' + f.cn + '</span>';
    }
    box.innerHTML = html;
    box.classList.add('on');
  }

  /* 资源视图的图例：7 行固定（图标 + 色块 + 中文名 + 预留文案），不随世界变化。 */
  function updateResLegend(view) {
    var box = $('resLegend');
    if (!box) return;
    if (view !== 'resources') { box.classList.remove('on'); return; }
    var list = AO.RESOURCES || [];
    var icon = AO.RES_ICON || 'item';
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var img = icon === 'item'
        ? '<img src="assets/res/item-' + r.key + '.png" alt="">'
        : (icon === 'glyph' ? '<img src="assets/res/' + r.key + '.png" alt="">' : '');
      html += '<span class="rl">' + img + '<i style="background:' + r.color + '"></i>' +
        '<span class="nm">' + r.cn + '</span><em>' + (r.build ? '可建' + r.build : '') + '</em></span>';
    }
    html += '<span class="cap">颜色 = 该省主资源（储量最高的那种）；点省份看七种储量</span>';
    box.innerHTML = html;
    box.classList.add('on');
  }

  /* 信仰构成：条形 + 列表。百分比用"最大余数法"凑成整 100 */
  /* 这一块信仰是不是该国国教（B1：国教 = 省份信仰里占比最大者）。
   * STATEFAITH 没算出来时退回生成期那个 state 标记，不至于一个角标都不显示。 */
  function isStateFaith(c, f) {
    var i = AO.stateFaithOf ? AO.stateFaithOf(c.id) : -1;
    if (i >= 0) {
      var sf = (AO.FAITHS || [])[i];
      return !!(sf && f && f.key === sf.key);
    }
    return !!f.state;
  }

  function renderFaiths(c) {
    var bar = $('cFaithBar'), list = $('cFaithList');
    bar.innerHTML = ''; list.innerHTML = '';
    var fs = c.faiths || [];
    if (!fs.length) return;
    var raw = fs.map(function (f) { return f.pct * 100; });
    var rp = raw.map(function (x) { return Math.floor(x); });
    var rest = 100 - rp.reduce(function (a, b) { return a + b; }, 0);
    // 按小数部分从大到小补足
    var idxs = raw.map(function (x, i) { return i; })
      .sort(function (a, b) { return (raw[b] - rp[b]) - (raw[a] - rp[a]); });
    for (var k = 0; k < rest && idxs.length; k++) rp[idxs[k % idxs.length]]++;

    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      var seg = doc.createElement('i');
      seg.style.width = raw[i].toFixed(2) + '%';
      seg.style.background = f.color;
      seg.title = f.cn + ' ' + rp[i] + '%';
      bar.appendChild(seg);

      var row = doc.createElement('div');
      row.className = 'fr';
      var sy = doc.createElement('span');
      sy.className = 'sy';
      sy.style.color = f.color;
      sy.innerHTML = symSvg(f, 15);
      row.appendChild(sy);
      row.appendChild(doc.createTextNode(f.cn));
      /* 国教角标：以 STATEFAITH（省份信仰里面积占比最大者）为准 ——
       * 生成期那个 50% + 12% 余量的启发式只在 c.faiths[].state 里留着，
       * 一旦占领 / 传教改了版图，它就不再对；STATEFAITH 每回合重算。 */
      if (isStateFaith(c, f)) {
        var tg = doc.createElement('span');
        tg.className = 'tag';
        tg.textContent = '国教';
        row.appendChild(tg);
      }
      var em = doc.createElement('em');
      em.textContent = rp[i] + '%';
      row.appendChild(em);
      list.appendChild(row);
    }
    $('cTenet').textContent = '「' + c.faith.tenet + '」';
  }

  /* ---------------- 科技 ----------------
   * 两块 UI，一份数据：
   *   renderTech(c)     —— 国家卡里的摘要：科研条 + 一行状态 + 「打开科技树」
   *   renderTechTree()  —— 全屏科技树，**唯一**的开研入口
   * 为什么树要单独铺满一屏：七条科技按前置链分三列，塞进 300px 的侧栏只能缩进成
   * 一张列表，"树"就没了；铺开之后深度、分叉、连线一眼读得出来。
   *
   * 布局**全部从 req 派生**，不存任何手工坐标：
   *   depth = 前置链最长路径（无前置 → 第 1 列）
   *   row   = 叶子按 TECHS 顺序占槽位，父节点取首尾子节点的中位
   * 于是三条产业链各占一行、父子连线是直的，也不会互相穿插。
   */
  var TT = { open: false, owner: 0, panX: 0, panY: 0, cw: 0, ch: 0, drag: null, moved: 0, canSprint: false,
    /* pointerdown 时记下的落点（pointer capture 之后 target 会变）、
     * 以及 pointerup 接管点击的时间戳（用来吃掉被重定向的 click） */
    downNode: null, downHit: null, ptrTs: 0 };
  /* 节点尺寸 / 间距。TT_H 和 CSS 里 .ttnode 的 height 必须一致（两处都改）。
   * 定 96（原来 104）是因为树长到 11 条之后有 7 行：7×104 加行距就装不进
   * 940 高的屏了，一开树最上面那条会被顶栏吃掉。96 刚好装得下，而且节点里
   * 的内容（图标 32 + 两行文字 + 底栏 14）实测只占 85px，不挤。 */
  var TT_W = 226, TT_H = 96, TT_PAD = 34, TT_GX = 96, TT_GY = 8;
  /* 给渲染器看的：树开着时地图不吃滚轮（见 10-render.js 的 wheel） */
  AO.techTreeOpen = function () { return TT.open; };

  /* 四态：done 已完成 / cur 研究中 / lock 锁定 / avail 可研 */
  function techState(t, R) {
    if (R.done[t.key]) return 'done';
    if (R.cur && R.cur.key === t.key) return 'cur';
    if (!R.unlocked) return 'lock';
    if (t.req && !R.done[t.req]) return 'lock';
    return 'avail';
  }

  /* depth：前置链最长路径。memo 存结果，guard 防止数据写错时死循环 */
  function techDepths() {
    var memo = Object.create(null);
    function depthOf(t, guard) {
      if (memo[t.key] !== undefined) return memo[t.key];
      var pa = t.req ? AO.TECH_BY_KEY[t.req] : null;
      var d = (pa && guard < 32) ? depthOf(pa, guard + 1) + 1 : 0;
      memo[t.key] = d;
      return d;
    }
    var out = [];
    for (var i = 0; i < AO.TECHS.length; i++) {
      out.push({ t: AO.TECHS[i], depth: depthOf(AO.TECHS[i], 0) });
    }
    return out;
  }

  /* 整棵树的位置：列 = depth，行 = 叶子槽位（父节点取中位）；
   * 列距 / 行距按 stage 尺寸自适应铺开，一屏装得下就居中不出滚动。 */
  function techLayout() {
    var list = techDepths(), i;
    var kids = Object.create(null), roots = [];
    for (i = 0; i < list.length; i++) {
      var t = list[i].t;
      if (t.req && AO.TECH_BY_KEY[t.req]) (kids[t.req] || (kids[t.req] = [])).push(t);
      else roots.push(t);
    }
    var row = Object.create(null), cursor = 0;
    function place(t) {
      var ch = kids[t.key];
      if (!ch || !ch.length) { row[t.key] = cursor; return cursor++; }
      var ys = [];
      for (var k = 0; k < ch.length; k++) ys.push(place(ch[k]));
      row[t.key] = (ys[0] + ys[ys.length - 1]) / 2;
      return row[t.key];
    }
    for (i = 0; i < roots.length; i++) place(roots[i]);

    var rows = Math.max(1, cursor), cols = 1;
    for (i = 0; i < list.length; i++) if (list[i].depth + 1 > cols) cols = list[i].depth + 1;

    var stage = $('ttStage');
    var sw = stage ? stage.clientWidth : 1200, sh = stage ? stage.clientHeight : 700;
    var gx = TT_GX, gy = TT_GY;
    if (cols > 1) {
      var freeX = sw - TT_PAD * 2 - cols * TT_W;
      gx = Math.max(TT_GX, Math.min(240, freeX / (cols - 1)));
    }
    if (rows > 1) {
      var freeY = sh - TT_PAD * 2 - rows * TT_H;
      gy = Math.max(TT_GY, Math.min(108, freeY / (rows - 1)));
    }
    var pos = Object.create(null), w = 0, h = 0;
    for (i = 0; i < list.length; i++) {
      var it = list[i];
      var x = TT_PAD + it.depth * (TT_W + gx);
      var y = TT_PAD + row[it.t.key] * (TT_H + gy);
      pos[it.t.key] = { x: x, y: y };
      if (x + TT_W > w) w = x + TT_W;
      if (y + TT_H > h) h = y + TT_H;
    }
    return { list: list, pos: pos, w: w + TT_PAD, h: h + TT_PAD, rows: rows, cols: cols };
  }

  /* 军事科技 / 装备的**文字徽章**（v1 的武器图标占位）。
   * 为什么先不画 10 张武器图：图标是"词条名 + 时代色"就能读的东西，
   * 而 10 张 96px 的图在 20px 下根本分不出青铜和铁 —— 文字徽章反而更准。
   * 时代色取 15-resources.js 里 WEAPONS/GUNS/SHIPS 的 color（已经从冷到热排过）。 */
  function milBadge(key, size) {
    var it = AO.MIL_ITEM[key];
    if (!it) return '';
    var s = size || 32;
    var txt = String(it.cn || '').replace(/[·]/g, '').slice(0, 2);
    return '<svg class="bart mbadge" viewBox="0 0 44 44" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="3" y="9" width="38" height="26" rx="5" fill="' + (it.color || '#8d8d8d') +
      '" fill-opacity=".9" stroke="#2f353b" stroke-width="2"/>' +
      '<text x="22" y="27" text-anchor="middle" font-size="13" font-weight="700" fill="#fdfbf6" ' +
      'font-family="system-ui,-apple-system,sans-serif">' + txt + '</text></svg>';
  }
  /* 军事科技的一句话效果（节点副标题、完成提示共用一份） */
  function milEffectText(key) {
    var it = AO.MIL_ITEM[key];
    if (!it) return '解锁新装备';
    var rec = [], k;
    for (k in it.recipe) rec.push((AO.RES_SHORT[k] || k) + it.recipe[k]);
    var kindCn = it.kind === 'gun' ? '铸炮厂' : it.kind === 'ship' ? '造船厂' : '军械坊';
    return '解锁「' + kindCn + ' · ' + it.cn + '」订单：每回合 ' + rec.join(' + ') + ' → ' +
      it.out + ' 件 · 兵种「' + (it.unit || it.cn) + '」战力 ×' + it.pow +
      (it.siege ? ' 攻城 ' + it.siege : '') + (it.range ? ' 射程 ' + it.range : '');
  }
  AO.milBadge = milBadge;

  /* 节点图标：资源科技用**该建筑 Lv2 的图**（科技是"升级预告"，
   * 没研出来也要能看见升级后长什么样），全局科技用自己那张 item-tech-<key>.png，
   * 军事科技 v4 起也用真图 item-tech-<科技键>.png（tools/res-icons.html 里
   * tech-<科技键> 那一批），右下角再叠一枚缩到 40% 的 milBadge 角标：
   * 图标给形、角标给时代字，远近两套识别互补。
   * 缺图都走同一条回退链：PNG → 内联 SVG 徽章，不报错不空块。 */
  function techIcon(t, size) {
    if (t.mil) {
      var s = size || 32;
      return '<span class="milico" style="width:' + s + 'px;height:' + s + 'px">' +
        '<img class="bart-img" src="assets/res/item-tech-' + t.key + '.png"' +
        ' style="width:' + s + 'px;height:' + s + 'px"' +
        ' onerror="AO.techMilFallback(this,' + s + ',\'' + t.mil + '\')">' +
        milBadge(t.mil, Math.round(s * 0.4)) + '</span>';
    }
    if (t.for) return bldVisual(t.for, 2, size);
    return '<img class="bart-img" src="assets/res/item-tech-' + t.key + '.png"' +
      ' style="width:' + size + 'px;height:' + size + 'px"' +
      ' onerror="AO.techIconFallback(this,' + size + ')">';
  }
  /* 军事科技真图标缺图：整块换回全尺寸文字徽章（v3 行为）——
   * span.milico 一起换掉，别留个孤角标在原地。 */
  AO.techMilFallback = function (img, size, key) {
    var s = size || 32;
    var span = doc.createElement('span');
    span.innerHTML = milBadge(key, s);
    var node = span.firstChild;
    var wrap = img.parentNode;
    if (node && wrap && wrap.parentNode) wrap.parentNode.replaceChild(node, wrap);
  };
  /* 全局科技的通用墨线徽章：一个圆 + 里头的十字准星（"这格是加成，不是建筑"） */
  AO.techIconFallback = function (img, size) {
    var s = size || 32;
    var span = doc.createElement('span');
    span.innerHTML = '<svg class="bart" viewBox="0 0 44 44" width="' + s + '" height="' + s + '"' +
      ' aria-hidden="true"><g fill="none" stroke="#2f353b" stroke-width="2.4" stroke-linecap="round">' +
      '<circle cx="22" cy="22" r="13" fill="#f4ecdc"/>' +
      '<path d="M22 13v18M13 22h18"/><path d="M22 9v3M22 32v3M9 22h3M32 22h3"/></g></svg>';
    var node = span.firstChild;
    if (img.parentNode) img.parentNode.replaceChild(node, img);
  };

  /* 一个节点卡片。 */
  function techNodeHtml(t, p, R, cen) {
    var d = t.for ? AO.RESOURCE_BY_KEY[t.for] : null;
    var st = techState(t, R);
    var qi = R.queue ? R.queue.indexOf(t.key) : -1;
    var parent = t.req ? AO.TECH_BY_KEY[t.req] : null;
    var foot = '', extra = '', badge = '';
    var canSprint = st === 'cur' && TT.canSprint;
    if (qi >= 0) badge = '<span class="qbadge" title="队列第 ' + (qi + 1) + ' 位（点一下取消）">' + (qi + 1) + '</span>';
    if (st === 'lock') {
      foot = R.unlocked ? '需先研「' + (parent ? parent.cn : t.req) + '」' : '建学校开始科研';
    } else if (st === 'cur') {
      var tp = t.turns ? Math.max(0, Math.min(100, (1 - R.cur.left / t.turns) * 100)) : 0;
      foot = '<span class="pbar"><i style="width:' + tp.toFixed(0) + '%"></i></span>' +
        '<em>剩 ' + R.cur.left + ' 回合</em>' +
        (canSprint ? '<button class="ttsprint" type="button" title="冲刺：' +
          costText(AO.BUILDER.sprintCost) + '（中央国库）砍 1 回合">＋</button>' : '');
    } else if (st === 'done') {
      foot = '研成 · ' + (t.fx ? fxDesc(t) : t.mil ? milEffectText(t.mil).replace(/^解锁/, '') :
        (d ? d.build : t.for) + ' Lv2 开放');
      extra = '<span class="seal">✓</span>';
    } else {
      var lack = [], k;
      if (R.pts < t.pts) lack.push('科研点还差 ' + (t.pts - R.pts));
      for (k in t.cost) {
        if ((cen[k] || 0) < t.cost[k]) lack.push(cnOf(k) + ' 还差 ' + (t.cost[k] - (cen[k] || 0)));
      }
      if (lack.length) foot = '<em class="lack">' + lack[0] + '</em>';
      else foot = '<em class="go">' + (qi >= 0 ? '已在队列 · 点击取消' : '可研 · 点击入队') + '</em>';
    }
    var sub = t.fx ? fxDesc(t)
      : t.mil ? ((AO.MIL_ITEM[t.mil] || {}).cn + ' · 战力 ×' + ((AO.MIL_ITEM[t.mil] || {}).pow || 1))
        : (d ? d.build : t.for) + ' 可升 Lv2';
    var turnsNow = effectiveTurns(0, TT.owner, t.turns);
    return '<div class="ttnode ' + st + (qi >= 0 ? ' queued' : '') + '" data-tech="' + t.key + '"' +
      ' style="left:' + p.x + 'px;top:' + p.y + 'px"' +
      ' title="' + t.cn + '：' + t.pts + ' 科研点 · ' + costText(t.cost) + ' · ' + turnsNow + ' 回合">' +
      '<div class="h">' + techIcon(t, 32) +
        '<div class="tx"><b>' + t.cn + '</b>' +
        '<span>' + sub + '</span></div>' +
      '</div>' +
      '<div class="cost">' + t.pts + ' 科研点 · ' + costText(t.cost) + ' · ' + turnsNow + ' 回合</div>' +
      '<div class="ft">' + foot + '</div>' + extra + badge +
      '</div>';
  }

  /* 顶栏：国旗 + 国名·编号 / 科研条 / 正在研究（名 + 剩余回合 + 进度条） */
  function renderTechHead(c, R) {
    $('ttFlag').style.background = c.color;
    $('ttName').textContent = c.name;
    $('ttNameEn').textContent = c.name_en + ' · #' + c.id;
    $('ttOwner').textContent = '第 ' + c.id + ' / ' + state.world.countries.length + ' 国';

    var U = AO.TECH_UNLOCK_PTS;
    var pct = Math.max(0, Math.min(100, R.pts / U * 100));
    $('ttBarLabel').textContent = R.unlocked ? '科研点' : '科研条';
    $('ttPts').textContent = R.unlocked ? R.pts + ' 点' : R.pts + ' / ' + U;
    $('ttBarFill').style.width = pct.toFixed(1) + '%';
    var tn = $('ttTurnNo');
    if (tn) tn.textContent = '第 ' + turnNo + ' 回合';

    var box = $('ttCur');
    if (R.cur) {
      var ct = AO.TECH_BY_KEY[R.cur.key];
      var total = effectiveTurns(0, c.id, ct ? ct.turns : 1);
      var tp = (ct && ct.turns) ? Math.max(0, Math.min(100, (1 - R.cur.left / total) * 100)) : 0;
      box.innerHTML = '<div class="cr"><span>正在研究 <b>' + (ct ? ct.cn : R.cur.key) + '</b></span>' +
        '<em>剩 ' + R.cur.left + ' 回合</em>' +
        (TT.canSprint ? '<button class="ttsprint" type="button" title="冲刺：' +
          costText(AO.BUILDER.sprintCost) + '（中央国库）砍 1 回合">＋</button>' : '') + '</div>' +
        '<div class="bar sub"><i style="width:' + tp.toFixed(1) + '%"></i></div>' +
        (R.queue.length ? '<div class="cr hint">队列里还有 ' + R.queue.length + ' 条</div>' : '');
    } else {
      box.innerHTML = '<div class="cr"><span>' + (R.unlocked ? '空闲' : '未解锁') + '</span></div>' +
        '<div class="cr hint">' + (R.unlocked
          ? (R.queue.length
            ? '队列 ' + R.queue.length + ' 条等着开工 —— 点「下一回合」让队头开始'
            : '点亮着的节点入队（一次研一条）')
          : '建学校开始科研，攒满 ' + U + ' 点解锁') + '</div>';
    }
  }

  /* 全量重画（11 个节点，成本可以忽略）：入队 / 每回合结算后都走这里 */
  function renderTechTree(center) {
    if (!TT.open || !state.world) return;
    var cid = TT.owner || 1;
    var c = state.world.countries[cid - 1];
    if (!c) { closeTechTree(); return; }
    var R = researchOf(cid);
    TT.canSprint = hasBuilder(cid);
    renderTechHead(c, R);

    var L = techLayout();
    TT.cw = L.w; TT.ch = L.h;
    var cv = $('ttCanvas');
    cv.style.width = L.w + 'px';
    cv.style.height = L.h + 'px';

    var cen = ensureCentral(cid), html = '', i;
    for (i = 0; i < L.list.length; i++) {
      var t = L.list[i].t;
      html += techNodeHtml(t, L.pos[t.key], R, cen);
    }
    $('ttNodes').innerHTML = html;

    /* 连线：从左列节点右缘，到右列节点左缘。同高是直线，错开是一段 S 弯 */
    var paths = '';
    for (i = 0; i < L.list.length; i++) {
      var tc = L.list[i].t;
      if (!tc.req || !L.pos[tc.req]) continue;
      var a = L.pos[tc.req], b = L.pos[tc.key];
      var x1 = a.x + TT_W, y1 = a.y + TT_H / 2;
      var x2 = b.x, y2 = b.y + TT_H / 2;
      var dx = Math.max(26, (x2 - x1) * 0.55);
      paths += '<path d="M' + x1 + ' ' + y1 + 'C' + (x1 + dx) + ' ' + y1 + ',' +
        (x2 - dx) + ' ' + y2 + ',' + x2 + ' ' + y2 + '"/>';
    }
    var svg = $('ttEdges');
    svg.setAttribute('width', L.w);
    svg.setAttribute('height', L.h);
    svg.setAttribute('viewBox', '0 0 ' + L.w + ' ' + L.h);
    svg.innerHTML = paths;

    applyPan(center);
  }

  /* 平移：装得下就居中；**装不下就贴左上角**（居中会把最上面那条顶进顶栏里，
   * 一开树就看不见它），其余交给拖拽 / 滚轮。 */
  function applyPan(center) {
    var stage = $('ttStage'), cv = $('ttCanvas');
    if (!stage || !cv) return;
    var sw = stage.clientWidth, sh = stage.clientHeight;
    if (center) {
      TT.panX = TT.cw <= sw ? (sw - TT.cw) / 2 : 0;
      TT.panY = TT.ch <= sh ? (sh - TT.ch) / 2 : 0;
    }
    if (TT.cw <= sw) TT.panX = (sw - TT.cw) / 2;
    else TT.panX = AO.clamp(TT.panX, sw - TT.cw, 0);
    if (TT.ch <= sh) TT.panY = (sh - TT.ch) / 2;
    else TT.panY = AO.clamp(TT.panY, sh - TT.ch, 0);
    cv.style.transform = 'translate3d(' + TT.panX.toFixed(1) + 'px,' + TT.panY.toFixed(1) + 'px,0)';
  }

  /* 顶栏下那一行提示（点不动的反馈走这里，不弹 alert） */
  function ttMsg(text, cls) {
    var el = $('ttMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = (text ? 'on' : '') + (cls ? ' ' + cls : '');
    clearTimeout(el._t);
    if (text) el._t = setTimeout(function () { el.classList.remove('on'); }, 4600);
  }

  /* 打开时默认跟着"当前在看的那一国"：选中省 → 该国；否则国家卡那国 */
  function techOwnerGuess() {
    var id = state.renderer && state.renderer.selected;
    if (id && state.world) {
      var p = state.world.provinces[id - 1];
      if (p) return p.owner;
    }
    var cid = state.renderer && state.renderer.selectedCountry;
    return cid || TT.owner || 1;
  }

  function openTechTree(cid) {
    if (!state.world) return;
    var n = state.world.countries.length;
    var want = cid || techOwnerGuess() || 1;
    TT.owner = (want >= 1 && want <= n) ? want : 1;
    TT.open = true;
    /* 先上屏：display:none 的时候量不到舞台宽高，排版会按 0 算 */
    $('techTree').classList.add('on');
    doc.body.classList.add('tech-open');    // 地图那边看到这个类就不吃滚轮
    ttMsg('');
    renderTechTree(true);
  }

  function closeTechTree() {
    TT.open = false;
    TT.drag = null;
    var el = $('techTree');
    if (el) el.classList.remove('on');
    doc.body.classList.remove('tech-open');
  }

  /* 沙盒：每个国家的树都能翻着看 */
  function ttStep(d) {
    var n = state.world ? state.world.countries.length : 0;
    if (!n) return;
    TT.owner = ((TT.owner || 1) - 1 + d + n) % n + 1;
    ttMsg('');
    renderTechTree(true);
  }

  /* 一次节点点击的完整动作。nodeEl = 点中的节点卡（可空），hitEl = 真正被按下的
   * 那个子元素 —— 冲刺钮要先于"入队"判定。 */
  function ttActivate(nodeEl, hitEl) {
    if (!nodeEl) return;
    if (hitEl && hitEl.classList && hitEl.classList.contains('ttsprint')) {
      sprintResearch(TT.owner);
      renderTechTree(false);
      syncCountryTech();
      return;
    }
    var key = nodeEl.getAttribute('data-tech');
    var R = researchOf(TT.owner);
    if (!R.unlocked) {
      return bldMsg('建学校开始科研：每座每回合 +' + AO.SCHOOL.per + ' 点，攒满 ' +
        AO.TECH_UNLOCK_PTS + ' 点解锁科技树', 'warn');
    }
    startResearch(TT.owner, key);
    renderTechTree(false);
    syncCountryTech();
  }

  /* 树里改了研究状态，国家卡那段摘要如果开着就顺手刷新 */
  function syncCountryTech() {
    var box = $('country');
    if (!box || !box.classList.contains('on')) return;
    var c = state.world && state.world.countries[TT.owner - 1];
    if (c) renderTech(c);
  }

  function bindTechTree() {
    $('ttClose').addEventListener('click', closeTechTree);
    $('ttPrev').addEventListener('click', function () { ttStep(-1); });
    $('ttNext').addEventListener('click', function () { ttStep(1); });
    /* 树铺满整屏，右上角的回合条被盖住了 —— 这里给一个同样的入口，
     * 研究开完之后不用先关掉界面才能过回合。 */
    $('ttTurn').addEventListener('click', nextTurn);

    var stage = $('ttStage');
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      TT.drag = { x: e.clientX, y: e.clientY, px: TT.panX, py: TT.panY };
      TT.moved = 0;
      /* **按在哪个节点上，只能在这一刻记下来**：下面调用 setPointerCapture 之后，
       * 后续 pointerup / click 的 target 会被浏览器重定向成 #ttStage 本身，
       * e.target 再也不是 .ttnode 了（这正是"点节点没反应"的原因）。 */
      TT.downNode = (e.target && e.target.closest) ? e.target.closest('.ttnode') : null;
      TT.downHit = e.target;
      stage.classList.add('drag');
      if (stage.setPointerCapture) {
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!TT.drag) return;
      var dx = e.clientX - TT.drag.x, dy = e.clientY - TT.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > TT.moved) TT.moved = Math.abs(dx) + Math.abs(dy);
      TT.panX = TT.drag.px + dx;
      TT.panY = TT.drag.py + dy;
      applyPan(false);
    });
    function endDrag() {
      if (!TT.drag) return;
      TT.drag = null;
      stage.classList.remove('drag');
    }
    /* 松手 = 一次真鼠标点击（位移 ≤ 6px 才算点击，拖拽过的不算）。
     * 动作在这儿做，而不是等 click：pointer capture 让 click 落在 #ttStage 上，
     * 挂在 #ttNodes 上的 click 监听永远收不到。 */
    stage.addEventListener('pointerup', function (e) {
      var dragged = TT.moved > 6, node = TT.downNode, hit = TT.downHit;
      endDrag();
      TT.downNode = null; TT.downHit = null;
      TT.moved = 0;
      if (e.button !== 0 || dragged) return;
      /* 记一下时间：紧随其后的那个 click 若被重定向到 stage 就不要重复执行
       * （保留 click 入口是为了程序化 .click() 和键盘操作） */
      TT.ptrTs = e.timeStamp || Date.now();
      ttActivate(node, hit);
    });
    stage.addEventListener('pointercancel', function () {
      endDrag();
      TT.downNode = null; TT.downHit = null;
      TT.moved = 0;
    });

    /* 滚轮平移（不缩放）：竖向装得下就把滚轮当横向滚 —— 树是横着长的 */
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dx = e.deltaX, dy = e.deltaY;
      if (!dx && dy && TT.ch <= stage.clientHeight) { dx = dy; dy = 0; }
      TT.panX -= dx;
      TT.panY -= dy;
      applyPan(false);
    }, { passive: false });

    /* 节点动作：入队 / 取消（**不扣费**，队头开研时才扣）。
     * 两个入口共用 ttActivate：
     *   pointerup —— 真鼠标（capture 之后 click 会被重定向到 #ttStage）
     *   click     —— 程序化 .click() / 键盘回车 */
    $('ttNodes').addEventListener('click', function (e) {
      if (TT.ptrTs && Math.abs((e.timeStamp || 0) - TT.ptrTs) < 500) { TT.ptrTs = 0; return; }
      var el = (e.target && e.target.closest) ? e.target.closest('.ttnode') : null;
      if (!el) return;
      if (TT.moved > 6) { TT.moved = 0; return; }
      TT.moved = 0;
      ttActivate(el, e.target);
    });

    /* 顶栏「正在研究」那一行的冲刺钮（和节点里的那颗是同一个动作） */
    var curBox = $('ttCur');
    if (curBox) curBox.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.ttsprint') : null;
      if (!b) return;
      sprintResearch(TT.owner);
      renderTechTree(false);
      if ($('country').classList.contains('on')) {
        var c2 = state.world.countries[TT.owner - 1];
        if (c2) renderTech(c2);
      }
    });
  }

  /* =============================================================
   * 治理总览（全屏 overlay）
   *
   * 结构照科技树抄：全屏纸面 + 双线图廓 + 顶栏 + 一块正文。
   * 为什么不做成国家卡里的一段列表：一个国能有 20 个省 × 7 列，塞进 300px 的
   * 侧栏只能缩成一堆省略号；而且「开科取士 → 选人 → 派到省」是一个连续动作，
   * 候选池和省份列表必须**同屏可见** —— 所以铺满一屏。
   *
   * 面板里所有数字都是**只读派生**，不另存一份"面板数据"：
   *   税入 读 FLOW[pid].d.popTax（上一回合实际收上来的）
   *   民心 读 HAPPY[pid].v        省库 读 SIM[pid].gold.stock
   * 两边各存一份迟早会不一致，而这类不一致玩家一眼就能看出来。
   * ============================================================= */
  var GP = { open: false, owner: 0, sel: 0, tab: 'gov', selArmy: 0 };
  /* 给渲染器看的：治理面板开着时地图也不吃滚轮（和科技树同一个开关位） */
  AO.govOpen = function () { return GP.open; };

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function govMsg(text, cls) {
    var el = $('gpMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = (text ? 'on' : '') + (cls ? ' ' + cls : '');
    clearTimeout(el._t);
    if (text) el._t = setTimeout(function () { el.classList.remove('on'); }, 5200);
  }

  /* 一国里有几座"在产"的学校（不停课的）—— 顶栏的人才点速率靠它 */
  function activeSchools(owner) {
    var list = countryProvinces(owner), n = 0;
    for (var i = 0; i < list.length; i++) {
      var st = SCHOOL[list[i].id];
      if (st && st.n > 0 && !st.halted) n += st.n;
    }
    return n;
  }
  /* 大学同理（内政批）：它也给人才点，所以"每回合 +N"必须把大学算进去，
   * 否则面板上的速率会比实际到账少一截。 */
  function activeUnivs(owner) {
    var list = countryProvinces(owner), n = 0;
    for (var i = 0; i < list.length; i++) {
      var st = UNIVERSITY[list[i].id];
      if (st && st.n > 0 && !st.halted) n += st.n;
    }
    return n;
  }

  function renderGovPool(cid) {
    var box = $('gpPool');
    if (!box) return;
    var T = talentOf(cid), G = AO.GOV;
    $('gpPoolN').textContent = '· ' + T.pool.length + ' 位待任';
    if (!T.pool.length) {
      /* 空池的提示分两种：点不够就说还差多少，点够了就直接告诉他去点按钮 ——
       * 两种情况都写同一句"攒够 10 点后…"会让人以为按钮坏了 */
      box.innerHTML = '<div class="pempty">' + (T.pts >= G.examCost
        ? '候选池是空的 —— 人才点够了，点右上「开科取士」抽一位。'
        : '候选池是空的 —— 学校 / 大学每回合产人才点，还差 ' +
          fmtPts(G.examCost - T.pts) + ' 点就能开科（每座在产的学校 +' +
          G.talentPerSchool + '，每座大学 +' + AO.UNIVERSITY.perTalent + ' /回合）。') + '</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < T.pool.length; i++) {
      var off = T.pool[i], tr = AO.traitOf(off.traitKey);
      h += '<div class="ocard rar-' + tr.rar + (GP.sel === off.id ? ' sel' : '') +
        '" data-oid="' + off.id + '" title="' + escHtml(tr.cn + '：' + tr.desc) +
        '\n点一下选中，再点下面省行的「派」上任">' +
        '<span class="av ' + tr.rar + '">' + escHtml(off.name.charAt(0)) + '</span>' +
        '<div class="om"><b>' + escHtml(off.name) + '</b>' +
        '<span class="ot ' + tr.rar + '">' + tr.cn + '</span>' +
        '<span class="od">' + escHtml(tr.desc) + '</span></div></div>';
    }
    box.innerHTML = h;
  }

  /* 省行的「传教」钮（B3）。三个条件全由 16-events 的 canMission 判：
   * 仅玩家国 / 政策=强制 / 省信仰≠国教；已在传教 → 变成「传教 N」（再点 = 撤资）。
   * 不可用时置灰但**不隐藏** —— 隐藏了玩家会以为这一版根本没有传教。 */
  function missionBtn(p) {
    var can = AO.canMission ? AO.canMission(p.id) : false;
    var mis = AO.missionOf ? AO.missionOf(p.id) : null;
    var sf = AO.stateFaithOf ? AO.stateFaithOf(p.owner) : -1;
    var same = (typeof p.faithIdx === 'number' && p.faithIdx === sf);
    var tip;
    if (mis) tip = '撤资取消（' + AO.FAITH.missionCost + ' 金不退）：剩 ' + mis.left + ' 回合';
    else if (same) tip = '本省已信国教，不必传教';
    else if (AO.faithPolOf(p.owner) !== 'force') tip = '宽容政策下不传教（切回强制）';
    else tip = '派传教士：省库金 −' + AO.FAITH.missionCost + '，' +
      Math.max(1, Math.round(AO.FAITH.missionTurns * AO.FAITH.missionTurnMul)) + ' 回合后改宗国教';
    return '<button type="button" class="pmiss' + (mis ? ' on' : '') + '" data-pid="' + p.id + '"' +
      (can ? '' : ' disabled') + ' title="' + escHtml(tip) + '">' +
      (mis ? '传教 ' + mis.left : '传教') + '</button>';
  }

  function renderGovRows(c) {    var w = state.world, G = AO.GOV, i;
    var list = [];
    for (i = 0; i < c.provinces.length; i++) {
      var q = w.provinces[c.provinces[i] - 1];
      if (q) list.push(q);
    }
    /* 按人口降序：派官的时候玩家找的是"大省"，不是"第 37 号省" */
    list.sort(function (a, b) {
      return ((POP[b.id] && POP[b.id].v) || 0) - ((POP[a.id] && POP[a.id].v) || 0);
    });
    var h = '<div class="prow head">' +
      '<span class="pn">省名</span><span class="pp">人口</span><span class="pt">税入</span>' +
      '<span class="pg">省库金</span><span class="ph">民心</span><span class="po">在任官员</span>' +
      '<span class="px">派遣 · 传教</span></div>';
    for (i = 0; i < list.length; i++) {
      var p = list[i], pid = p.id;
      var pop = (POP[pid] && POP[pid].v) || p.population || 0;
      var F = FLOW[pid];
      var tax = (F && F.d.popTax) || 0;
      var hv = Math.round(happyOf(pid).v);
      var gold = (SIM[pid] && SIM[pid].gold) ? Math.floor(SIM[pid].gold.stock) : 0;
      var off = OFFICIAL[pid], tr = off ? AO.traitOf(off.traitKey) : null;
      h += '<div class="prow" data-pid="' + pid + '">' +
        '<span class="pn"><i style="background:' + p.ownerColor + '"></i>' +
          escHtml(p.name) + '</span>' +
        '<span class="pp">' + AO.formatPop(pop) + '</span>' +
        '<span class="pt' + (tax > 0 ? ' up' : '') + '">' + (F ? (tax > 0 ? '+' + tax : '0') : '—') + '</span>' +
        '<span class="pg">' + gold + '</span>' +
        '<span class="ph' + (hv <= G.happyLow ? ' low' : hv >= G.happyHigh ? ' high' : '') +
          '" title="' + escHtml(happyTitle(pid)) + '">' + hv + '</span>' +
        (off
          ? '<span class="po has" title="' + escHtml(tr.cn + '：' + tr.desc + '\n点击撤换回候选池') + '">' +
            escHtml(off.name) + '<em class="otag ' + tr.rar + '">' + tr.cn + '</em></span>'
          : '<span class="po none">空缺</span>') +
        (off
          ? '<span class="pm"><button type="button" class="pgo out" data-pid="' + pid +
            '" title="撤换回候选池（免费，随时可换）">撤</button>' + missionBtn(p) + '</span>'
          : '<span class="pm"><button type="button" class="pgo' + (GP.sel ? ' ready' : '') +
            '" data-pid="' + pid + '"' +
            (GP.sel ? '' : ' disabled') +
            ' title="' + (GP.sel ? '把选中的官员派到这一省' : '先在左边候选池里选一位官员') + '">派</button>' +
            missionBtn(p) + '</span>') +
        '</div>';
    }
    $('gpTable').innerHTML = h;
    /* 别国的省：派/撤钮全部置灰（面板可以看，按不动） */
    if (!canAct(c.id)) {
      var bs = $('gpTable').querySelectorAll('button.pgo');
      for (var bi = 0; bi < bs.length; bi++) lockBtn(bs[bi], c.id);
    }
  }

  function renderGovPanel() {
    if (!GP.open || !state.world) return;
    var w = state.world, n = w.countries.length;
    var cid = GP.owner || 1;
    var c = w.countries[cid - 1];
    if (!c) { closeGovPanel(); return; }
    var G = AO.GOV, i;

    $('gpFlag').style.background = c.color;
    $('gpName').textContent = c.name;
    $('gpNameEn').textContent = c.name_en + ' · #' + c.id;
    $('gpOwner').textContent = '第 ' + c.id + ' / ' + n + ' 国';

    /* 两个页签：治理（钱与人）/ 军务（兵与铁）。
     * 页签只切类名，DOM 不动 —— 和省份卡的「信息 / 建筑」同一个套路。 */
    var panelEl = $('govPanel');
    if (panelEl) panelEl.classList.toggle('mode-war', GP.tab === 'war');
    var tabs = $('gpTabs') ? $('gpTabs').querySelectorAll('button') : [];
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-gt') === GP.tab);
    }
    /* 军务页的"别国只能看"提示条 */
    var lockBar = $('gpLock');
    if (lockBar) {
      var locked = !canAct(cid);
      lockBar.classList.toggle('on', locked);
      lockBar.textContent = locked ? '⚠ 非你的国家：军务面板只能看，命令与征兵按钮全部置灰' : '';
    }
    /* 迷雾（v6）：选国之后，别国的税制 / 国库 / 省份明细属于"情报"，
     * 不在这块面板上白给 —— 想看就去情报署花 10 金派密探。 */
    var foreign = !!(PLAYER && cid !== PLAYER);
    if (panelEl) panelEl.classList.toggle('fog-foreign', foreign);
    if (foreign) {
      if (lockBar) {
        lockBar.classList.add('on');
        lockBar.textContent = '⚠ 情报遮蔽：别国的税制、国库与省份明细不公开' +
          '（情报署只能给到约数，见「情报」节）';
      }
      return;
    }
    if (GP.tab === 'war') { renderWarPage(c); return; }

    /* 税率三档（segmented，当前档高亮）。悬停写清"这一档到底收多少、压多少民心" */
    var rate = taxRateOf(cid), rh = '';
    var mine = canAct(cid);
    for (i = 0; i < 3; i++) {
      rh += '<button type="button" data-rate="' + i + '"' + (i === rate ? ' class="on"' : '') +
        ' title="' + G.rateDesc(i) + '">' +
        G.rateShort[i] + '</button>';
    }
    $('gpRates').innerHTML = rh;

    /* 信仰政策两档（B1）。切换即时生效：下一个回合的 settleHappy 就按新政策算，
     * 民心本身仍是一回合 lerp 30%，所以是"下回合开始慢慢变"，不会跳。 */
    var pol = AO.faithPolOf(cid), ph = '', pols = ['force', 'tolerant'];
    for (i = 0; i < pols.length; i++) {
      var pk = pols[i];
      ph += '<button type="button" data-pol="' + pk + '"' + (pk === pol ? ' class="on"' : '') +
        ' title="' + AO.FAITH.polDesc[pk] + '">' + AO.FAITH.polCn[pk] + '</button>';
    }
    var polEl = $('gpFaithPol');
    if (polEl) polEl.innerHTML = ph;
    if (!mine) {
      var rbs = $('gpRates').querySelectorAll('button');
      for (i = 0; i < rbs.length; i++) lockBtn(rbs[i], cid);
    }

    /* 国民幸福度（人口加权） */
    var hv = countryHappy(c);
    var hvEl = $('gpHappy');
    hvEl.textContent = Math.round(hv);
    hvEl.className = 'gv' + (hv <= G.happyLow ? ' low' : hv >= G.happyHigh ? ' high' : '');
    hvEl.title = '国民幸福度 ' + hv.toFixed(1) + '（人口加权平均）' +
      '\n收税系数 ×' + G.happyTaxMul(hv).toFixed(2) + '（0.6 ~ 1.2）' +
      '\n人口增速：≤' + G.happyLow + ' ×' + G.popLowMul + '，≥' + G.happyHigh + ' ×' + G.popHighMul;

    /* 人才点 + 开科取士 */
    var T = talentOf(cid), sch = activeSchools(cid), uniN = activeUnivs(cid);
    /* 只显示余额，不写成 "67.5 / 10" —— 攒多了之后那个 "/10" 看着像上限，
     * 而 10 其实是**一次开科的花费**，写在下面那行小字里更清楚 */
    $('gpPts').textContent = fmtPts(T.pts);
    var rateEl = $('gpPtsRate');
    if (rateEl) {
      var perTurn = sch * G.talentPerSchool + uniN * AO.UNIVERSITY.perTalent;
      rateEl.textContent = '开科 ' + G.examCost + ' 点/次 · ' + ((sch || uniN)
        ? ('在校 ' + sch + ' 座' + (uniN ? ' + 大学 ' + uniN + ' 座' : '') +
          ' · +' + fmtPts(perTurn) + '/回合')
        : '没有在产的学校或大学');
    }
    /* 教育进度行（内政批）：读的是**累计教育 total**，不是能花的人才点 pts ——
     * 抽卡花掉 10 点不会让这一行往回退，否则玩家会以为档位被抽没了。 */
    var eduEl = $('gpEdu');
    if (eduEl) {
      var totalEdu = T.total || 0;
      var ti = AO.tierIndexAt(totalEdu);
      var nextT = AO.TIER[ti + 1] || null;
      eduEl.textContent = '教育 ' + Math.floor(totalEdu) + (nextT ? '/' + nextT.at : '') +
        (nextT ? ' · 下一档：' + nextT.cn : ' · 三档全解');
      var tl = ['教育 = 累计人才点（只加不减）· 学校 +' + fmtPts(G.talentPerSchool) +
        ' / 大学 +' + AO.UNIVERSITY.perTalent + ' 每座每回合', ''];
      for (var ti2 = 0; ti2 < AO.TIER.length; ti2++) {
        var tt2 = AO.TIER[ti2];
        tl.push((totalEdu >= tt2.at ? '✔ ' : '· ') + tt2.at + ' ' + tt2.cn + ' —— ' + tt2.desc);
      }
      eduEl.title = tl.join('\n');
    }
    var ex = $('gpExam');
    ex.disabled = T.pts < G.examCost;
    ex.title = T.pts < G.examCost
      ? '人才点不够：还差 ' + fmtPts(G.examCost - T.pts) + ' 点'
      : '花 ' + G.examCost + ' 点抽一位官员（随机词条，权重见 15-resources.js）';
    lockBtn(ex, cid);

    renderGovPool(cid);
    renderIntelSection(c);          // 情报署（v6）：预算三档 + 已知国家 + 定向探测
    renderGovRows(c);
    $('gpProvN').textContent = '· ' + c.provinces.length + ' 省';

    /* 底部合计：全省税入 Σ / 平均民心 / 在任官员数 / 省库金合计 */
    var taxSum = 0, hsum = 0, hw = 0, goldSum = 0, withOff = 0, nProv = c.provinces.length;
    for (i = 0; i < nProv; i++) {
      var pid = c.provinces[i], F = FLOW[pid];
      taxSum += (F && F.d.popTax) || 0;
      var pw = (POP[pid] && POP[pid].v) || 0;
      hsum += happyOf(pid).v * pw; hw += pw;
      goldSum += (SIM[pid] && SIM[pid].gold) ? SIM[pid].gold.stock : 0;
      if (OFFICIAL[pid]) withOff++;
    }
    var avgH = hw > 0 ? hsum / hw : G.happyStart;
    $('gpFoot').innerHTML =
      '全省税入 <b>+' + taxSum + ' 金</b>／回合　·　平均民心 <b>' + Math.round(avgH) + '</b>' +
      '　·　在任 <b>' + withOff + ' / ' + nProv + '</b> 省　·　省库金合计 <b>' +
      Math.floor(goldSum) + '</b>　·　税率「' + G.rateCn[taxRateOf(cid)] + '」' +
      '　·　情报「' + FOG.cn[budgetOf(cid)] + (budgetOf(cid) ? ' ' + FOG.cost[budgetOf(cid)] + ' 金/回合' : '') + '」';
  }

  function govOwnerGuess() { return techOwnerGuess(); }

  function openGovPanel(cid) {
    if (!state.world) return;
    var n = state.world.countries.length;
    var want = cid || govOwnerGuess() || 1;
    GP.owner = (want >= 1 && want <= n) ? want : 1;
    GP.open = true;
    GP.sel = 0;
    GP.tab = 'gov';                 // 默认落在「治理」页；军务由 openWarPanel 切过去
    GP.selArmy = 0;
    /* 先上屏再渲染：display:none 的时候量不到尺寸（和科技树同一个坑） */
    $('govPanel').classList.add('on');
    doc.body.classList.add('gov-open');
    govMsg('');
    renderGovPanel();
  }

  function closeGovPanel() {
    GP.open = false;
    GP.sel = 0;
    var el = $('govPanel');
    if (el) el.classList.remove('on');
    doc.body.classList.remove('gov-open');
  }

  function govStep(d) {
    var n = state.world ? state.world.countries.length : 0;
    if (!n) return;
    GP.owner = ((GP.owner || 1) - 1 + d + n) % n + 1;
    GP.sel = 0;
    govMsg('');
    renderGovPanel();
  }

  /* 税率切换：**即时生效**，下一个回合的税就按新档收。
   * 民心不立刻跳（它是每回合 lerp 的），所以切到"横征暴敛"的当回合
   * 税就涨上去了、民心下回合才慢慢掉下来 —— 这个时序是故意的：
   * 先甜后苦，玩家才会去权衡。 */
  function setTaxRate(owner, r) {
    if (r !== 0 && r !== 1 && r !== 2) return;
    if (!canAct(owner)) return govMsg(lockTitle(), 'warn');
    TAXRATE[owner] = r;
    var G = AO.GOV;
    govMsg('税率改为「' + G.rateCn[r] + '」：每 ' + G.popCn() + ' ' + G.goldPerUnit[r] +
      ' 金/回合，民心压力 ' + (G.happyHit[r] > 0 ? '+' : '') + G.happyHit[r] +
      '（民心每回合慢慢靠过去）', 'ok');
  }

  function bindGovPanel() {
    $('gpClose').addEventListener('click', closeGovPanel);
    $('gpPrev').addEventListener('click', function () { govStep(-1); });
    $('gpNext').addEventListener('click', function () { govStep(1); });
    $('gpTurn').addEventListener('click', nextTurn);

    /* 税率：事件委托，重画时不用重新绑 */
    $('gpRates').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-rate]') : null;
      if (!b) return;
      setTaxRate(GP.owner, +b.getAttribute('data-rate'));
      renderGovPanel();
    });

    /* 情报署（v6）：预算三档 segmented —— 和税率同一套写法，切换即时生效 */
    var ibox = $('gpIntelB');
    if (ibox) ibox.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-ib]') : null;
      if (!b || b.disabled) return;
      var lv = +b.getAttribute('data-ib');
      if (!setIntelBudget(GP.owner, lv)) return govMsg(lockTitle(), 'warn');
      var I = AO.INTEL;
      govMsg('情报预算「' + I.cn[lv] + '」：每回合 ' + I.cost[lv] + ' 金（国库扣）· ' +
        (lv ? '自动织网每 ' + I.autoEvery[lv] + ' 回合 ' + I.autoN[lv] + ' 省' : '地图不再自动更新') +
        '　·　反谍抓人 ' + Math.round(I.exposeP[lv] * 100) + '%', 'ok');
      fogTouchAll();
    });

    /* 定向探测：一个已知国家一颗钮（冷却中置灰，钮上直接写剩余回合） */
    var ilist = $('gpIntelList');
    if (ilist) ilist.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button.iprobe') : null;
      if (!b || b.disabled) return;
      var r = probeTarget(+b.getAttribute('data-cid'));
      if (r && r.ok) {
        govMsg((r.caught ? '✗ ' : '✓ ') + r.msg, r.caught ? 'warn' : 'ok');
      } else if (r) {
        govMsg(r.msg, 'warn');
      }
    });

    /* 信仰政策：强制 / 宽容（切换即时生效，下回合的民心就按新政策算） */
    var polBox = $('gpFaithPol');
    if (polBox) polBox.addEventListener('click', function (e) {
      var pb = e.target && e.target.closest ? e.target.closest('button[data-pol]') : null;
      if (!pb) return;
      var pol = pb.getAttribute('data-pol');
      if (!AO.setFaithPol(GP.owner, pol)) return govMsg('非你的国家（先点顶栏「开始游戏」选一个国）', 'warn');
      govMsg('信仰政策改为「' + AO.FAITH.polCn[pol] + '」：' + AO.FAITH.polDesc[pol] +
        (pol === 'tolerant' ? '　进行中的传教已停手' : ''), 'ok');
      renderGovPanel();
      if (state.renderer && state.renderer.selected) {
        var sp = state.world.provinces[state.renderer.selected - 1];
        if (sp) renderInfoLists(sp);
      }
    });

    /* 开科取士 */
    $('gpExam').addEventListener('click', function () {      var r = examOfficial(GP.owner);
      if (!r.ok) return govMsg(r.msg, 'warn');
      var tr = r.trait;
      govMsg('开科取士：' + r.off.name + ' —— 「' + tr.cn + '」' + tr.desc, tr.rar === 'bad' ? 'warn' : 'ok');
      renderGovPanel();
      flushNotes();
    });

    /* 候选池：点卡 = 选中 / 取消选中 */
    $('gpPool').addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.ocard') : null;
      if (!el) return;
      var id = +el.getAttribute('data-oid');
      GP.sel = (GP.sel === id) ? 0 : id;
      renderGovPanel();
    });

    /* 省行：派 / 撤（撤有两个入口：行尾的「撤」钮，和在任官员名字本身 ——
     * 名字上写着"点击撤换"，那就得真的能点） */
    $('gpTable').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      /* 传教钮先拦：它和「派/撤」在同一个格子里，但动作完全不同 */
      var mb = t.closest('button.pmiss');
      if (mb) {
        var mpid = +mb.getAttribute('data-pid');
        var mr = AO.toggleMission(mpid);
        govMsg(mr.msg, mr.ok ? (mr.cancel ? 'warn' : 'ok') : 'warn');
        renderGovPanel();
        var mp = state.world.provinces[mpid - 1];
        if (mp && state.renderer && state.renderer.selected === mpid) renderInfoLists(mp);
        if (state.renderer) state.renderer.requestDraw();   // 信仰视图上的转教标记
        return;
      }
      var b = t.closest('button.pgo');
      var chip = !b ? t.closest('.po.has') : null;
      if (!b && !chip) return;
      var pid = +((b || chip.parentNode).getAttribute('data-pid'));
      var prov = state.world.provinces[pid - 1];
      if (!prov) return;
      if (b && !b.classList.contains('out')) {
        /* 派 */
        if (!GP.sel) return govMsg('先在候选池里点一位官员', 'warn');
        var r = assignOfficial(pid, GP.sel);
        if (!r.ok) return govMsg(r.msg, 'warn');
        govMsg(r.off.name + ' 上任 ' + prov.name +
          (r.replaced ? '（' + r.replaced.name + ' 回候选池）' : '') +
          '：词条「' + AO.traitOf(r.off.traitKey).cn + '」', 'ok');
        GP.sel = 0;
      } else {
        /* 撤 */
        var off = dismissOfficial(pid);
        if (off) govMsg(off.name + ' 已撤换回候选池（这一省暂时无官，裸税 ×' +
          AO.GOV.noOfficerMul + '）', 'warn');
      }
      renderGovPanel();
      /* 省卡开着的话跟着刷（民心/官员两行要变） */
      if (state.renderer && state.renderer.selected === pid) renderInfoLists(prov);
      if ($('country').classList.contains('on')) {
        var cc = state.world.countries[prov.owner - 1];
        if (cc) renderGovern(cc);
      }
    });

    /* 军务页的事件委托（和上面同一层，只是挂在同一个 overlay 上） */
    bindWarPage();
  }

  /* =============================================================
   * 军务页（#govPanel 的第二个页签）
   *
   * 布局三块，从上到下：一条统计条 → 军队列表（带命令编辑器）+ 将领池 → 战报。
   * 为什么跟治理挤在同一个 overlay 里而不是另开一屏：
   *   "抽将 → 建军 → 下命令"和"开科 → 派官 → 调税"是同一种连续动作，
   *   两块放在同一个壳里，玩家来回切页签不会跳戏（也是要求的做法）。
   *
   * 所有数字都是**只读派生**，和治理页同一条纪律：
   *   兵数读 ARMY.men、将领读 GENERALS、交战读 WARSET、战报读 WARLOG。
   * ============================================================= */
  function openWarPanel(cid) {
    openGovPanel(cid);
    GP.tab = 'war';
    GP.selArmy = 0;
    renderGovPanel();
  }

  function warPageOfArmy(a) {
    var it = itemOf(a), gen = generalOf(a), p = pOf(a.pid), c = coOf(a.owner);
    return {
      it: it, gen: gen, p: p, c: c,
      orderCn: a.order ? (AO.ORDERS[a.order.type] ? AO.ORDERS[a.order.type].cn : a.order.type) : '待命',
      tacCn: a.order && a.order.tactic ? AO.tacOf(a.order.tactic).cn : ''
    };
  }

  /* 可选目标：按命令类型给不同的清单（进攻 = 交战国的省；轰击 = 相邻敌省；…） */
  function listTargets(a, type) {
    var out = [], w = state.world, me = pOf(a.pid), i, j;
    if (!me) return out;
    function push(pid) {
      var q = pOf(pid);
      if (!q || pid === a.pid) return;
      var dx = q.centroid[0] - me.centroid[0], dy = q.centroid[1] - me.centroid[1];
      out.push({ pid: pid, name: q.name, cid: q.owner, cname: (coOf(q.owner) || {}).name || '',
        dist: dx * dx + dy * dy, terrain: q.terrain });
    }
    if (type === 'attack') {
      for (i = 0; i < w.countries.length; i++) {
        var c = w.countries[i];
        if (!c || !atWar(a.owner, c.id)) continue;
        for (j = 0; j < c.provinces.length; j++) push(c.provinces[j]);
      }
    } else if (type === 'bombard') {
      var nb = me.neighbors || [];
      for (i = 0; i < nb.length; i++) {
        var q = pOf(nb[i]);
        if (q && atWar(a.owner, q.owner)) push(q.id);
      }
    } else if (type === 'blockade') {
      for (i = 0; i < w.provinces.length; i++) {
        var bp = w.provinces[i];
        if (!bp || !(bp.coastDirs > 0)) continue;
        if (atWar(a.owner, bp.owner)) push(bp.id);
      }
    } else if (type === 'transport') {
      for (i = 0; i < w.provinces.length; i++) {
        var tp = w.provinces[i];
        if (tp && tp.coastDirs > 0) push(tp.id);
      }
    }
    out.sort(function (x, y) { return x.dist - y.dist; });
    return out;
  }

  function genCardHtml(g, small) {
    var tr = genTrait(g), busy = g.armyId ? (ARMY[g.armyId] ? '带兵中' : '空闲') : '待命';
    return '<div class="ocard rar-' + tr.rar + (small ? ' sm' : '') + '" data-gid="' + g.id + '"' +
      ' title="' + escHtml(g.name + ' · ' + tr.cn + '：' + tr.desc + '\n' + busy +
        '\n点一下指派给选中的军队') + '">' +
      '<span class="av ' + tr.rar + '">' + escHtml(g.name.charAt(0)) + '</span>' +
      '<div class="om"><b>' + escHtml(g.name) + '</b>' +
      '<span class="ot ' + tr.rar + '">' + tr.cn + '</span>' +
      '<span class="od">' + escHtml(tr.desc) + '</span></div></div>';
  }

  function renderWarPage(c) {
    var cid = c.id, mine = canAct(cid);
    var T = talentOf(cid), pool = milPoolOf(cid), list = armiesOf(cid);
    var i, k;

    /* ---- 统计条 ---- */
    var men = 0, ships = 0, bqN = 0, wars = [];
    for (i = 0; i < list.length; i++) { men += list[i].men; ships += list[i].ships || 0; }
    for (i = 0; i < c.provinces.length; i++) {
      var bqt = BARRACKS[c.provinces[i]];
      if (bqt && bqt.n > 0 && !bqt.halted) bqN++;
    }
    for (k in WARSET) {
      if (!WARSET[k]) continue;
      var ab = k.split('|');
      if (+ab[0] === cid) wars.push(+ab[1]);
      else if (+ab[1] === cid) wars.push(+ab[0]);
    }
    var ex = $('gpWarInfo');
    if (ex) {
      var warNames = [];
      for (i = 0; i < wars.length; i++) {
        var wc = coOf(wars[i]);
        if (wc) warNames.push(wc.name);
      }
      ex.innerHTML =
        '<span class="ws">军队 <b>' + list.length + '</b></span>' +
        '<span class="ws">总兵力 <b>' + men.toLocaleString() + '</b></span>' +
        (ships ? '<span class="ws">舰 <b>' + ships + '</b> 艘</span>' : '') +
        '<span class="ws">兵营 <b>' + bqN + '</b> 省</span>' +
        '<span class="ws">将领 <b>' + pool.length + '</b> 待命</span>' +
        '<span class="ws ' + (wars.length ? 'atwar' : '') + '">交战 <b>' + wars.length + '</b>' +
        (warNames.length ? '（' + warNames.join('、') + '）' : '') + '</span>' +
        '<span class="ws">人才点 <b>' + fmtPts(T.pts) + '</b></span>' +
        '<button class="gexam" type="button" id="gpMilExam"' + (T.pts < AO.GOV.examCost ? ' disabled' : '') +
        ' title="' + (T.pts < AO.GOV.examCost ? '人才点不够：还差 ' + fmtPts(AO.GOV.examCost - T.pts) + ' 点'
          : '花 ' + AO.GOV.examCost + ' 人才点抽一位将领（词条权重见 15-resources.js 的 MIL_TRAITS）') +
        '">开武科 · ' + AO.GOV.examCost + ' 点</button>';
      var eb = $('gpMilExam');
      if (eb) lockBtn(eb, cid);
    }

    /* ---- 将领候选池 ---- */
    var genBox = $('gpMilPool');
    if (genBox) {
      genBox.innerHTML = pool.length
        ? pool.map(function (g) { return genCardHtml(g); }).join('')
        : '<div class="pempty">武举无人 —— 点「开武科」抽一位（和文科共用人才点）。<br>' +
          '抽到的将领先进这个池子，选中一支军队再点他，就上任了。</div>';
      $('gpMilPoolN').textContent = '· ' + pool.length + ' 位待命';
    }

    /* ---- 军队列表 ---- */
    var box = $('gpTableWar');
    if (box) {
      if (!list.length) {
        box.innerHTML = '<div class="pempty">还没有军队。<br>' +
          '先在兵营省（兵营 ＋ 建）征一支：花金 + 人口 + 该代军械，成建制门槛看本省库存够不够 ' +
          AO.RECRUIT.weaponPerUnit + ' 件。</div>';
      } else {
        var h = '<div class="prow head war">' +
          '<span class="wn">军队</span><span class="wm">兵数</span><span class="wg">将领</span>' +
          '<span class="wo">命令</span><span class="wp">驻地</span><span class="wx">状态</span></div>';
        for (i = 0; i < list.length; i++) {
          var a = list[i], info = warPageOfArmy(a);
          h += '<div class="prow war' + (GP.selArmy === a.id ? ' sel' : '') + '" data-aid="' + a.id + '">' +
            '<span class="wn"><i style="background:' + (info.c ? info.c.color : '#888') + '"></i>' +
            (a.type === 'navy' ? '⚓ 舰队 · ' : '') + escHtml(info.it.cn) +
            (a.arms === 'cav' ? ' · 骑' : a.arms === 'art' ? ' · 炮' : '') + '</span>' +
            '<span class="wm">' + a.men.toLocaleString() + (a.ships ? ' / ' + a.ships + ' 舰' : '') + '</span>' +
            '<span class="wg">' + (info.gen ? escHtml(info.gen.name) + '<em class="otag ' +
              genTrait(info.gen).rar + '">' + genTrait(info.gen).cn + '</em>' : '<em class="none">无将</em>') + '</span>' +
            '<span class="wo">' + info.orderCn + (info.tacCn ? '<em>' + info.tacCn + '</em>' : '') + '</span>' +
            '<span class="wp">' + (info.p ? escHtml(info.p.name) : '—') +
              (info.p && OCCUPY[info.p.id] ? '<em>占领</em>' : '') + '</span>' +
            '<span class="wx">' + (a.starved ? '<em class="bad">断粮</em>' : '') +
              (a.sup ? '<em class="bad">被压制</em>' : '') +
              (a.order && a.order.type === 'train' ? '<em>练兵</em>' : '') + '</span>' +
            '</div>';
          if (GP.selArmy === a.id) h += armyEditorHtml(a);
        }
        box.innerHTML = h;
      }
    }

    /* ---- 战报 ---- */
    var lg = $('gpWarLog');
    if (lg) {
      var rows = [];
      for (i = 0; i < Math.min(WARLOG.length, 40); i++) {
        var e = WARLOG[i];
        rows.push('<div class="lrow ' + (e.cls || '') + '"><span class="lt">T' + e.turn + '</span>' +
          '<span class="lx">' + escHtml(e.text) + '</span></div>');
      }
      lg.innerHTML = rows.length ? rows.join('') : '<div class="pempty">还没有战事。宣战之后，军队一交手战报就写在这里。</div>';
    }
    /* 底部：和治理页一样给一句合计 */
    var ft = $('gpFoot');
    if (ft) {
      ft.innerHTML = '军队 <b>' + list.length + '</b> 支 · 总兵力 <b>' + men.toLocaleString() + '</b> 人' +
        '　·　待命将领 <b>' + pool.length + '</b> 位　·　交战 <b>' + wars.length + '</b> 国' +
        (isDecap(cid) ? '　·　<em class="bad">群龙无首</em>（首都已失：战力 −20%、税 ×0.7、科研减半、民心 −10）' : '') +
        (countryDead(cid) ? '　·　<em class="bad">已灭亡</em>' : '');
    }
  }

  /* 选中军队的命令编辑器（就摊在那一行下面，不弹窗） */
  function armyEditorHtml(a) {
    var mine = canAct(a.owner);
    var it = itemOf(a), isNavy = a.type === 'navy';
    var cur = a.order ? a.order.type : '';
    var curTac = a.order ? a.order.tactic : 'assault';
    var cmds = isNavy ? ['blockade', 'transport', 'defend'] : ['attack', 'defend', 'train', 'bombard'];
    var h = '<div class="wed">';

    /* 命令 */
    h += '<div class="werow"><span>命令</span><div class="segs">';
    for (var i = 0; i < cmds.length; i++) {
      var cn = AO.ORDERS[cmds[i]];
      h += '<button type="button" data-ocmd="' + cmds[i] + '"' +
        (cur === cmds[i] || (cmds[i] === 'attack' && cur === 'siege') ? ' class="on"' : '') +
        (mine ? '' : ' disabled') + ' title="' + escHtml(cn.desc + (mine ? '' : '（' + lockTitle() + '）')) +
        '">' + cn.cn + '</button>';
    }
    h += '</div></div>';

    /* 战术：没有对应词条的一律置灰（这就是"词条与战术置灰逻辑"） */
    var where = (cur === 'defend') ? 'defend' : 'attack';
    if (cur !== 'train') {
      h += '<div class="werow"><span>战术</span><div class="segs">';
      var tacList = tacticsFor(a, where);
      var tr = genTrait(generalOf(a));
      for (var j = 0; j < AO.TACTICS.length; j++) {
        var t = AO.TACTICS[j];
        if (t.auto) continue;
        if (t.where && t.where !== where) continue;
        var ok = tacticAllowed(a, t.key);
        var on = (curTac || 'assault') === t.key;
        h += '<button type="button" data-otac="' + t.key + '"' + (on ? ' class="on"' : '') +
          (ok && mine ? '' : ' disabled') +
          ' title="' + escHtml(t.cn + '：' + t.desc +
            (ok ? '' : '（要词条「' + (AO.milTraitOf(t.need).cn) + '」—— 这支部队的将领是' +
              (tr ? tr.cn : '无') + '）')) + '">' + t.cn + '</button>';
      }
      h += '</div></div>';
    }

    /* 目标 */
    if (cur === 'attack' || cur === 'bombard' || cur === 'blockade' || cur === 'transport' || cur === 'siege') {
      var tg = listTargets(a, cur === 'siege' ? 'attack' : cur);
      h += '<div class="werow"><span>目标</span><select id="wpTarget"' + (mine ? '' : ' disabled') + '>';
      if (!tg.length) h += '<option value="0">（没有可选目标：先宣战，或者附近没有敌省）</option>';
      var lastC = 0;
      for (var k = 0; k < tg.length; k++) {
        var o = tg[k];
        if (o.cid !== lastC) {
          if (lastC) h += '</optgroup>';
          h += '<optgroup label="' + escHtml(o.cname) + '">';
          lastC = o.cid;
        }
        h += '<option value="' + o.pid + '"' + (a.order && a.order.pid === o.pid ? ' selected' : '') + '>' +
          escHtml(o.name) + '（' + ((AO.TERRAIN_CN || {})[o.terrain] || o.terrain) + '）</option>';
      }
      if (lastC) h += '</optgroup>';
      h += '</select></div>';
    }

    /* 将领 */
    var pool = milPoolOf(a.owner), gen = generalOf(a);
    h += '<div class="werow"><span>将领</span><select id="wpGen"' + (mine ? '' : ' disabled') + '>' +
      '<option value="0">— 无将（直辖，战力无加成）—</option>';
    if (gen) h += '<option value="' + gen.id + '" selected>' + escHtml(gen.name + '（' + genTrait(gen).cn + '）') + '</option>';
    for (var m = 0; m < pool.length; m++) {
      if (gen && pool[m].id === gen.id) continue;
      h += '<option value="' + pool[m].id + '">' + escHtml(pool[m].name + '（' + AO.milTraitOf(pool[m].traitKey).cn + '）') + '</option>';
    }
    h += '</select></div>';

    /* 舰队：装载同省的陆军 */
    if (isNavy) {
      var here = armiesIn(a.pid).filter(function (x) { return x.type === 'army' && x.owner === a.owner; });
      h += '<div class="werow"><span>装载</span>';
      if (a.cargo && a.cargo.men) {
        h += '<em class="cargo">已载 ' + a.cargo.men + ' 人（' + (AO.MIL_ITEM[a.cargo.tier] || {}).cn + '）</em>' +
          '<button type="button" data-unload="1"' + (mine ? '' : ' disabled') + '>卸下</button>';
      } else if (!here.length) {
        h += '<em class="none">本省没有可载的陆军</em>';
      } else {
        h += '<select id="wpLoad"' + (mine ? '' : ' disabled') + '>';
        for (var q2 = 0; q2 < here.length; q2++) {
          h += '<option value="' + here[q2].id + '">' + (AO.MIL_ITEM[here[q2].tier] || {}).cn +
            ' · ' + here[q2].men + ' 人</option>';
        }
        h += '</select><button type="button" data-load="1"' + (mine ? '' : ' disabled') + '>装船</button>' +
          '<em class="none">载量 ' + (a.ships * (it.cap || 1000)) + ' 人</em>';
      }
      h += '</div>';
    }

    h += '<div class="werow tip">命令每回合自动执行一次；『下一回合』才结算。' +
      (a.type === 'navy' ? '舰队沿"海路"（沿海省两两质心距离 < ' +
        Math.round(AO.BATTLE.seaD * 100) + '% 世界长边）一回合走一格。' :
        '陆军一回合走一格（急行军/闪袭两格），遇敌即战，无敌即占。') + '</div>';
    h += '</div>';
    return h;
  }

  /* 军务页的事件（委托到容器上，重画不用重绑） */
  function bindWarPage() {
    var body = $('govPanel');
    if (!body) return;

    body.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      /* 页签 */
      var tab = t.closest('button[data-gt]');
      if (tab) {
        GP.tab = tab.getAttribute('data-gt');
        GP.selArmy = 0;
        govMsg('');
        renderGovPanel();
        return;
      }
      /* 开武科 */
      if (t.closest('#gpMilExam')) {
        var r = examGeneral(GP.owner);
        if (!r.ok) return govMsg(r.msg, 'warn');
        govMsg('开武科：' + r.gen.name + ' —— 「' + r.trait.cn + '」' + r.trait.desc, r.trait.rar === 'bad' ? 'warn' : 'ok');
        renderGovPanel();
        flushNotes();
        return;
      }
      /* 点将领卡 = 派给选中的军队 */
      var gc = t.closest('.ocard[data-gid]');
      if (gc) {
        var gid = +gc.getAttribute('data-gid');
        var a = ARMY[GP.selArmy];
        if (!a) return govMsg('先在上面点一支军队，再点将领卡', 'warn');
        var rr = assignGeneral(a.id, gid);
        if (!rr.ok) return govMsg(rr.msg, 'warn');
        govMsg(rr.gen.name + ' 接管「' + itemOf(a).cn + '」' +
          (rr.old ? '（' + rr.old.name + ' 回池）' : '') + '：词条「' + genTrait(rr.gen).cn + '」', 'ok');
        renderGovPanel();
        return;
      }
      /* 选军队 */
      var row = t.closest('.prow.war[data-aid]');
      if (row) {
        var aid = +row.getAttribute('data-aid');
        GP.selArmy = (GP.selArmy === aid) ? 0 : aid;
        renderGovPanel();
        return;
      }
      /* 命令按钮 */
      var oc = t.closest('button[data-ocmd]');
      if (oc) {
        var a2 = ARMY[GP.selArmy];
        if (!a2) return;
        var type = oc.getAttribute('data-ocmd');
        var keepTac = (a2.order && a2.order.tactic) || 'assault';
        var keepPid = a2.order ? a2.order.pid : 0;
        /* 换命令时战术可能不适用（比如练兵没有战术），setArmyOrder 里会再校验一次 */
        var res = setArmyOrder(a2.id, { type: type, pid: keepPid, cid: 0, tactic: keepTac });
        govMsg(res.msg, res.ok ? 'ok' : 'warn');
        renderGovPanel();
        return;
      }
      /* 战术按钮 */
      var ot = t.closest('button[data-otac]');
      if (ot) {
        var a3 = ARMY[GP.selArmy];
        if (!a3) return;
        var tk = ot.getAttribute('data-otac');
        var type2 = (a3.order && a3.order.type) || 'attack';
        var res2 = setArmyOrder(a3.id, {
          type: type2, pid: a3.order ? a3.order.pid : 0, cid: 0, tactic: tk
        });
        govMsg(res2.msg, res2.ok ? 'ok' : 'warn');
        renderGovPanel();
        return;
      }
      /* 装卸 */
      if (t.closest('button[data-load]')) {
        var navy = ARMY[GP.selArmy];
        var sel = $('wpLoad');
        if (!navy || !sel) return;
        var lid = +sel.value;
        var land = ARMY[lid];
        if (!land) return;
        var cap = (navy.ships || 0) * ((AO.MIL_ITEM[navy.tier] || {}).cap || 1000);
        var take = Math.min(land.men, cap);
        navy.cargo = { men: take, tier: land.tier, arms: land.arms || 'inf' };
        land.men -= take;
        if (land.men <= 0) disbandArmy(land.id);
        govMsg('装船：' + take + ' 人上舰（载量 ' + cap + '）；命令「运输」＋ 目标沿海省，一回合登岸', 'ok');
        renderGovPanel();
        return;
      }
      if (t.closest('button[data-unload]')) {
        var navy2 = ARMY[GP.selArmy];
        if (!navy2 || !navy2.cargo) return;
        var na = newArmy(navy2.owner, navy2.pid, { type: 'army', tier: navy2.cargo.tier, men: navy2.cargo.men });
        na.arms = navy2.cargo.arms;
        govMsg('卸下 ' + navy2.cargo.men + ' 人在 ' + (pOf(navy2.pid) || {}).name, 'ok');
        navy2.cargo = null;
        renderGovPanel();
        return;
      }
    });

    /* 目标 / 将领 下拉 */
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'wpTarget') {
        var a = ARMY[GP.selArmy];
        if (!a) return;
        var pid = +t.value;
        if (!pid) return;
        var p = pOf(pid);
        var type = (a.order && a.order.type) || 'attack';
        var tac = (a.order && a.order.tactic) || 'assault';
        var res = setArmyOrder(a.id, { type: type, pid: pid, cid: p ? p.owner : 0, tactic: tac });
        govMsg(res.msg, res.ok ? 'ok' : 'warn');
        renderGovPanel();
        return;
      }
      if (t.id === 'wpGen') {
        var a2 = ARMY[GP.selArmy];
        if (!a2) return;
        var gid = +t.value;
        if (!gid) {
          var old = detachGeneral(a2.id);
          govMsg(old ? (old.name + ' 卸任，回候选池') : '这支部队本来就没有将领', 'ok');
        } else {
          var r = assignGeneral(a2.id, gid);
          govMsg(r.ok ? (r.gen.name + ' 上任') : r.msg, r.ok ? 'ok' : 'warn');
        }
        renderGovPanel();
        return;
      }
    });
  }


  /* ---------------- 十七、选国浮层（开始游戏） ----------------
   * 国家列表直接用现有的国家卡数据（名字/旗色/省数/首都/政体），
   * 不另做一套"可选国家"定义 —— 世界还是那个世界，只是你挑了一个位置坐下。 */
  function openPickPanel() {
    if (!state.world) return;
    var el = $('pickPanel');
    if (!el) return;
    el.classList.add('on');
    renderPickList();
  }
  function closePickPanel() {
    var el = $('pickPanel');
    if (el) el.classList.remove('on');
  }
  function renderPickList() {
    var box = $('pickList');
    if (!box || !state.world) return;
    var w = state.world, h = '', i;
    $('pickN').textContent = '· ' + w.countries.length + ' 国';
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      var wars = 0, k;
      for (k in WARSET) {
        if (!WARSET[k]) continue;
        var ab = k.split('|');
        if (+ab[0] === c.id || +ab[1] === c.id) wars++;
      }
      h += '<button type="button" class="pcard' + (PLAYER === c.id ? ' sel' : '') + '" data-cid="' + c.id + '"' +
        ' title="' + escHtml(c.name + ' · ' + c.govCn + '\n' + c.provinces.length + ' 省 · 人口 ' +
          AO.formatPop(c.population) + (wars ? '\n交战 ' + wars + ' 国' : '')) + '">' +
        '<span class="pf" style="background:' + c.color + '"></span>' +
        '<span class="pn"><b>' + escHtml(c.name) + '</b><i>' + escHtml(c.name_en) + '</i></span>' +
        '<span class="ps">' + c.provinces.length + ' 省</span>' +
        (wars ? '<span class="pw">交战 ' + wars + '</span>' : '') +
        '</button>';
    }
    box.innerHTML = h;
  }

  /* ---------------- 十八、国家卡的「外交」节 ----------------
   * 只做三件事：显示交战对象、宣战/停战、以及"群龙无首 / 已灭亡"的红字。
   * 宣战钮只有 PLAYER 能用（别国的卡上也画，但置灰 —— 让玩家知道那儿有个钮）。 */
  function renderDiplo(c) {
    var box = $('cDiplo');
    if (!box) return;
    var mine = canAct(c.id), h = '', k, i;
    var wars = [];
    for (k in WARSET) {
      if (!WARSET[k]) continue;
      var ab = k.split('|');
      if (+ab[0] === c.id) wars.push(+ab[1]);
      else if (+ab[1] === c.id) wars.push(+ab[0]);
    }
    if (countryDead(c.id)) {
      h += '<div class="gvrow bad"><span>国运</span><em>已灭亡（第 ' +
        (DEAD[c.id] ? DEAD[c.id].turn : '?') + ' 回合被并入 ' +
        ((coOf(DEAD[c.id] && DEAD[c.id].by) || {}).name || '?') + '）</em></div>';
    } else if (isDecap(c.id)) {
      h += '<div class="gvrow bad"><span>群龙无首</span><em>首都已失：战力 −20% · 税 ×' +
        AO.BATTLE.decapTax + ' · 科研 ×' + AO.BATTLE.decapScience + ' · 民心 ' +
        AO.BATTLE.decapHappy + '</em></div>';
    }
    if (wars.length) {
      var names = [];
      for (i = 0; i < wars.length; i++) {
        var wc = coOf(wars[i]);
        names.push('<span class="wtag">' + escHtml(wc ? wc.name : '?') + '</span>');
      }
      h += '<div class="gvrow"><span>交战</span><em>' + names.join(' ') + '</em></div>';
    } else {
      h += '<div class="gvrow"><span>交战</span><em class="none">没有战争</em></div>';
    }
    var nProv = c.provinces.length;
    var line = Math.max(1, Math.ceil(nProv * frac100(c.id)));
    h += '<div class="gvrow"><span>投降线</span><em>剩省 ≤ ' + line + '（' +
      Math.round(frac100(c.id) * 100) + '%' + (isDecap(c.id) ? '，群龙无首已放宽' : '') + '）</em></div>';

    /* 宣战 / 停战：两种钮各一排，按"跟邻国打没打仗"分 */
    h += '<div class="diplobtns">';
    if (!wars.length) {
      /* 没在打 → 给"向邻国宣战"（只列陆上邻国，避免一屏 64 个钮）。
       * 别国的卡上不列 —— 一片灰按钮比没有更难看，这里直接用一句话说明。 */
      var nb = c.neighbors || [];
      if (!mine) {
        h += '<em class="none">宣战只能由玩家国发起</em>';
      } else if (!nb.length) {
        h += '<em class="none">四周皆海，没有陆上邻国可宣战（跨海的敌国要等舰队）</em>';
      }
      for (i = 0; mine && i < nb.length; i++) {
        var nc2 = coOf(nb[i]);
        if (!nc2 || countryDead(nc2.id)) continue;
        h += '<button type="button" class="warbtn" data-declare="' + nc2.id + '" title="' +
          escHtml('向 ' + nc2.name + ' 宣战：宣战后双方军队才会交战、才能占领对方省份') +
          '">宣战 · ' + escHtml(nc2.name) + '</button>';
      }
    } else {
      for (i = 0; i < wars.length; i++) {
        var wc2 = coOf(wars[i]);
        if (!wc2) continue;
        h += '<button type="button" class="warbtn peace" data-peace="' + wars[i] + '"' +
          (mine ? '' : ' disabled') + ' title="' +
          escHtml(mine ? ('与 ' + wc2.name + ' 停战：围城解除、封锁解除，已占领的省不归还')
            : lockTitle()) + '">停战 · ' + escHtml(wc2.name) + '</button>';
      }
    }
    h += '</div>';
    /* 玩家国自己的卡上给一个"去军务"的入口 —— 宣战之后下一步一定是下命令 */
    if (mine) h += '<button class="gopen" type="button" id="cGoWar">打开军务面板 →</button>';
    box.innerHTML = h;
    var gw = $('cGoWar');
    if (gw) gw.addEventListener('click', function () { openWarPanel(c.id); });
    var ds = box.querySelectorAll('button[data-declare]');
    for (i = 0; i < ds.length; i++) {
      ds[i].addEventListener('click', function () {
        var r = declareWar(c.id, +this.getAttribute('data-declare'));
        toast(r.msg, 3200);
        showCountry(c.id);
      });
    }
    var ps = box.querySelectorAll('button[data-peace]');
    for (i = 0; i < ps.length; i++) {
      ps[i].addEventListener('click', function () {
        var r = makePeace(c.id, +this.getAttribute('data-peace'));
        toast(r.msg, 3200);
        showCountry(c.id);
      });
    }
    box.title = '外交：宣战之后两国军队才会交战、才能占领对方省份；\n' +
      '剩省降到投降线以下就全境并入对方（群龙无首时线放宽）。';
  }


  /* 国家卡里的「治理」摘要：税率 / 民心 / 在任 / 人才点 + 一个入口钮。
   * 和「科技」那一节并排，所以写法也照抄 renderTech —— 两节读起来是一对。 */
  function renderGovern(c) {
    var box = $('cGovern');
    if (!box) return;
    var G = AO.GOV, cid = c.id;
    var T = talentOf(cid);
    var rate = taxRateOf(cid);
    var hv = countryHappy(c);
    var offs = officialsOf(cid).length;
    var sch = activeSchools(cid);
    box.innerHTML =
      '<div class="gvrow"><span>税率</span><em>' + G.rateCn[rate] +
        '<i>（' + G.goldPerUnit[rate] + ' 金/' + G.popCn() + '）</i></em></div>' +
      '<div class="gvrow"><span>国民幸福度</span><em class="' +
        (hv <= G.happyLow ? 'low' : hv >= G.happyHigh ? 'high' : '') + '">' + Math.round(hv) + '</em></div>' +
      '<div class="gvrow"><span>在任官员</span><em>' + offs + ' / ' + c.provinces.length + ' 省</em></div>' +
      '<div class="gvrow"><span>人才点</span><em>' + fmtPts(T.pts) + ' · 候选 ' + T.pool.length +
        ' 位' + (sch ? '（+' + fmtPts(sch * G.talentPerSchool) + '/回合）' : '') + '</em></div>' +
      '<button class="gopen" type="button">打开治理面板 →</button>';
    box.querySelector('.gopen').addEventListener('click', function () { openGovPanel(cid); });
    box.title = '治理：税率三档（税入 ↔ 民心）· 学校产人才点 → 开科取士 → 派官员上任\n' +
      '官员的词条会给这一省加税 / 加民心 / 减工期 / 加产量；无官的省裸税 ×' + G.noOfficerMul;
  }

  /* ---------------- 国库总览（国家卡「科技」节上方） ----------------   * 两块数：
   *   库存 = 中央国库现在有多少（维护费、科技开销都从这里出）
   *   净流 = 全国每回合实际进出 = Σ省(gain − loss) + 中央(gain − loss)
   *          抽税在省侧记 −、在中央侧记 +，两边相抵 —— 所以这里的数
   *          是"这个国家一回合到底多了/少了多少"，不是"抽了多少税"。
   * 科研点是特殊项（不在七种资源里），单开一行。 */
  function renderTreasury(c) {
    var box = $('cTreasury');
    if (!box) return;
    var cen = ensureCentral(c.id);
    var net = Object.create(null), i, k;
    for (i = 0; i < c.provinces.length; i++) {
      var F = FLOW[c.provinces[i]];
      if (!F) continue;
      for (k in F.gain) net[k] = (net[k] || 0) + F.gain[k];
      for (k in F.loss) net[k] = (net[k] || 0) - F.loss[k];
    }
    var FC = FLOWC[c.id];
    if (FC) {
      for (k in FC.gain) net[k] = (net[k] || 0) + FC.gain[k];
      for (k in FC.loss) net[k] = (net[k] || 0) - FC.loss[k];
    }
    var rs = AO.RESOURCES || [], html = '';
    for (i = 0; i < rs.length; i++) {
      var r = rs[i], v = net[r.key] || 0;
      var cls = v > 0.05 ? ' up' : v < -0.05 ? ' down' : '';
      var txt = Math.abs(v) < 0.05 ? '±0' : (v > 0 ? '＋' : '−') + Math.round(Math.abs(v) * 10) / 10;
      html += '<div class="trrow"><span class="nm">' + (r.prod || r.cn) + '</span>' +
        '<b>' + Math.round(cen[r.key] || 0) + '</b>' +
        '<em class="' + cls.trim() + '">' + txt + '</em></div>';
    }
    var pv = net.pts || 0;
    var pcls = pv > 0.05 ? 'up' : pv < -0.05 ? 'down' : '';
    html += '<div class="trrow pts"><span class="nm">科研点</span>' +
      '<b>' + researchOf(c.id).pts + '</b>' +
      '<em class="' + pcls + '">' + (Math.abs(pv) < 0.05 ? '±0' : (pv > 0 ? '＋' : '−') + Math.round(Math.abs(pv))) + '</em></div>';
    box.innerHTML = '<div class="trhead"><span>库存</span><span>每回合净流</span></div>' + html;
    box.title = '库存 = 中央国库现有量（维护与科技都从这里扣）\n' +
      '净流 = 全国每回合实际进出 = Σ省(产出 − 支出) + 中央(税入 − 垫付)\n' +
      '抽税在省侧记支出、中央侧记收入，两边相抵，所以净流是真实的增减。';
  }

  /* 国家卡里的科技摘要：科研条 + 一行状态 + 进树的钮。
   * 研究动作只有一个入口 —— 全屏树里的节点，所以这里不再有「研究」钮。 */
  function renderTech(c) {
    var box = $('cTech');
    if (!box) return;
    var R = researchOf(c.id);
    var U = AO.TECH_UNLOCK_PTS;
    var pct = Math.max(0, Math.min(100, R.pts / U * 100));
    var doneN = 0, k;
    for (k in R.done) if (R.done[k]) doneN++;

    var label, right = '', cls = '';
    if (!R.unlocked) {
      label = '未解锁 · 建学校开始科研';
      right = R.pts + ' / ' + U;
    } else if (R.cur) {
      var ct = AO.TECH_BY_KEY[R.cur.key];
      label = '正在研究 <b>' + (ct ? ct.cn : R.cur.key) + '</b>' +
        (R.queue.length ? '（队列 ' + R.queue.length + '）' : '');
      right = '剩 ' + R.cur.left + ' 回合';
      cls = ' class="cur"';
    } else if (R.queue.length) {
      var qt = AO.TECH_BY_KEY[R.queue[0]];
      label = '队列等待 <b>' + (qt ? qt.cn : R.queue[0]) + '</b>（' + R.queue.length + ' 条）';
      right = R.pts + ' 点';
      cls = ' class="cur"';
    } else {
      label = '已解锁 · 已研成 ' + doneN + ' / ' + AO.TECHS.length + ' 条';
      right = R.pts + ' 点';
    }

    box.innerHTML = '<div class="bar tech"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="trow"><span>' + label + '</span><em' + cls + '>' + right + '</em></div>' +
      '<button class="topen" type="button">打开科技树 →</button>';
    box.querySelector('.topen').addEventListener('click', function () { openTechTree(c.id); });
  }

  function clearCountry() {
    $('country').classList.remove('on');
    if (state.renderer) {
      state.renderer.selectedCountry = 0;
      state.renderer.requestDraw();
    }
  }

  function centerOnCountry(cid) {
    var w = state.world, c = w && w.countries[cid - 1];
    if (!c || !state.renderer) return;
    var sx = 0, sy = 0, n2 = 0;
    for (var i = 0; i < c.provinces.length; i++) {
      var p = w.provinces[c.provinces[i] - 1];
      if (!p) continue;
      sx += p.centroid[0]; sy += p.centroid[1]; n2++;
    }
    if (!n2) return;
    state.renderer.cam.x = sx / n2;
    state.renderer.cam.y = sy / n2;
    if (state.renderer.cam.scale < 1.0) state.renderer.cam.scale = 1.8;
    state.renderer.clampCam();
    state.renderer._needBase = true;
    state.renderer.requestDraw();
  }

  function showCountry(cid) {
    var w = state.world;
    var c = w && w.countries[cid - 1];
    if (!c) { clearCountry(); return; }
    $('country').classList.add('on');

    $('cFlag').style.background = c.color;
    $('cName').textContent = c.name;
    $('cNameEn').textContent = c.name_en + ' · #' + c.id;

    $('cPortrait').innerHTML = c.portrait;
    $('cTitle').textContent = c.leader.title;
    $('cLeader').textContent = c.leader.name;

    var isRepublic = /共和|联邦|联盟/.test(c.govCn);
    var sub = [c.leader.gender === 'f' ? '女' : '男', c.leader.age + ' 岁'];
    if (c.house) sub.push(c.house);
    sub.push((isRepublic ? '在任 ' : '在位 ') + c.leader.reign + ' 年');
    $('cLeaderSub').textContent = sub.join(' · ');

    $('cGov').textContent = c.govCn;
    $('cEcon').textContent = c.economy;
    renderFaiths(c);

    $('cPop').textContent = AO.formatPop(c.population) + '（' + c.density + ' 人/km²）';
    $('cArea').textContent = c.areaKm2.toLocaleString() + ' km²';
    var cap = w.provinces[c.capital - 1];
    $('cCapital').textContent = cap ? cap.name : '—';
    $('cProv').textContent = c.provinces.length + ' 个';

    var bar = $('cBar'), leg = $('cLegend');
    bar.innerHTML = ''; leg.innerHTML = '';
    for (var i = 0; i < c.terrainComp.length; i++) {
      var t = c.terrainComp[i];
      var seg = doc.createElement('i');
      seg.style.width = (t.pct * 100).toFixed(2) + '%';
      seg.style.background = t.color;
      seg.title = t.cn + ' ' + (t.pct * 100).toFixed(1) + '%';
      bar.appendChild(seg);

      var row = doc.createElement('div');
      var dot = doc.createElement('span');
      dot.className = 'dot';
      dot.style.background = t.color;
      row.appendChild(dot);
      row.appendChild(doc.createTextNode(t.cn));
      var em = doc.createElement('em');
      em.textContent = Math.round(t.pct * 100) + '%';
      row.appendChild(em);
      leg.appendChild(row);
    }

    var nb = $('cNeighbors');
    nb.innerHTML = '';
    if (!c.neighbors.length) {
      nb.innerHTML = '<span class="hint">四周皆海，没有陆上邻国</span>';
    }
    for (var k = 0; k < c.neighbors.length; k++) {
      (function (nid) {
        var nc = w.countries[nid - 1];
        if (!nc) return;
        var s2 = doc.createElement('span');
        s2.className = 'chip';
        s2.textContent = nc.name;
        s2.style.borderLeft = '3px solid ' + nc.color;
        s2.addEventListener('click', function () {
          state.renderer.selectCountry(nid);
          centerOnCountry(nid);
        });
        nb.appendChild(s2);
      })(c.neighbors[k]);
    }

    renderTreasury(c);      // 国库：库存 + 每回合净流
    renderTech(c);          // 科技节：科研条 + 一行状态 + 「打开科技树」
    renderGovern(c);        // 治理节：税率 / 民心 / 在任官员 / 人才点 + 「打开治理面板」
    renderDiplo(c);         // 外交节（v3）：交战对象 / 宣战停战 / 群龙无首 / 投降线
    /* 迷雾遮蔽（v6）放最后：上面的渲染照旧按真实数据走（自己的国要全透明），
     * 最后由这一层按情报档把不该给你看的块整个藏起来。
     * 遮蔽是**接口层**的事，和 canAct 的"能不能按"完全是两回事。 */
    applyCountryMask(c);
  }

  function centerOn(id) {
    var p = state.world.provinces[id - 1];
    if (!p || !state.renderer) return;
    state.renderer.cam.x = p.centroid[0];
    state.renderer.cam.y = p.centroid[1];
    if (state.renderer.cam.scale < 1.2) state.renderer.cam.scale = 2.2;
    state.renderer.clampCam();
    state.renderer._needBase = true;
    state.renderer.requestDraw();
  }

  /* ---------------- 导出 ---------------- */
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function exportGeo() {
    if (!state.world) return;
    var t0 = root.performance.now();
    var gj = AO.worldToGeoJSON(state.world);
    var text = JSON.stringify(gj);
    download('world-' + state.world.meta.seed + '.geojson', text, 'application/geo+json');
    toast('GeoJSON：' + gj.features.length + ' 个要素，' +
      (text.length / 1024 | 0) + ' KB（' + Math.round(root.performance.now() - t0) + ' ms）');
  }

  function exportJson() {
    if (!state.world) return;
    var t0 = root.performance.now();
    var g = AO.worldToGameJSON(state.world);
    var text = JSON.stringify(g);
    download('world-' + state.world.meta.seed + '.json', text, 'application/json');
    toast('游戏 JSON：' + g.provinces.length + ' 省 / ' + g.countries.length + ' 国 / ' +
      g.adjacency.length + ' 条邻接，' + (text.length / 1024 | 0) + ' KB');
  }

  /* ---------------- 自检 ---------------- */
  function runTest() {
    var box = $('test');
    box.classList.add('on');
    box.innerHTML = '<div class="t"><b>…</b><span>正在自检（会额外生成 2 个世界验证可复现性）</span></div>';
    setTimeout(function () {
      var r;
      try {
        r = AO.selfTest(state.world, state.opts);
      } catch (e) {
        box.innerHTML = '<div class="t no"><b>错误</b><span>' + e.message + '</span></div>';
        return;
      }
      var html = '';
      for (var i = 0; i < r.checks.length; i++) {
        var c = r.checks[i];
        html += '<div class="t ' + (c.ok ? 'ok' : 'no') + '"><b>' + (c.ok ? 'PASS' : 'FAIL') +
          '</b><span><strong>' + c.name + '</strong><br>' + c.detail + '</span></div>';
      }
      html += '<div class="t"><b>' + (r.pass ? 'OK' : '!!') + '</b><span>' +
        (r.pass ? '全部通过' : '存在失败项') + '</span></div>';
      box.innerHTML = html;
      toast(r.pass ? '自检全部通过' : '自检存在失败项');
    }, 30);
  }

  /* =============================================================
   * 战争层（WAR）—— 选国 / 军械 / 征兵 / 将领 / 命令 / 会战 / 占领
   *
   * 一句话原则：**玩家给将领下命令，不微操**。
   * 所以这里没有"点一下走一步"的东西 —— 玩家只填三件事：
   *   谁去打（军队）· 打哪（命令 + 目标）· 怎么打（战术）
   * 剩下的行军、会战、伤亡、撤退、占领，全在 settleWar 里一回合结算完。
   *
   * 一回合的战争段落（settleWar）固定七步，顺序不能乱：
   *   ⓪ 粮食补给   —— 军队就地吃粮，吃不到先掉兵（打之前先饿一遍）
   *   ① 敌国动员   —— 每 3 回合，交战国的 AI 补一支驻防军（纯防守，不主动进攻）
   *   ② 行军       —— 进攻/围城/轰击/封锁/运输，一格一回合（急行军两格）
   *   ③ 会战       —— 同省敌对军队两相位结算（射击 → 接触），出胜负与伤亡
   *   ④ 占领       —— 打赢得空省就易主（产出×0.6、民心−10、不产科研）
   *   ⑤ 围城       —— 围而不打：产出归零，粮尽守军每回合 −10%，兵尽开城
   *   ⑥ 投降       —— 剩省 ≤ 1/3（群龙无首时 2/3）→ 全境并入，宣布灭亡
   *
   * 为什么"占领"排在"会战"之后：会战决定谁留在这个省里，
   * 先占再打会变成"占了又被抢"，战报里会出现同一个省易主两次的鬼话。
   * ============================================================= */

  /* ---------------- 一、基础读表 ---------------- */
  function pOf(pid) { return state.world ? state.world.provinces[(pid | 0) - 1] : null; }
  function coOf(cid) { return state.world ? state.world.countries[(cid | 0) - 1] : null; }
  function warKey(a, b) { a = a | 0; b = b | 0; return a < b ? a + '|' + b : b + '|' + a; }
  function atWar(a, b) { return !!(a && b && a !== b && WARSET[warKey(a, b)]); }
  /* 一支军队"属于谁"的显示名。叛军的 owner 是负号 id（见 16-events 的
   * rebelGeneral），coOf(-5) 是 undefined —— 不兜这一句，战报里就会出现
   * "undefined 的一支 3317 人无路可退"这种句子。 */
  function ownerName(owner) {
    if ((owner | 0) < 0) return '叛军';
    var c = coOf(owner);
    return c ? c.name : '?';
  }
  function countryDead(cid) { return !!DEAD[cid | 0]; }

  /* 玩家国锁定：PLAYER=0（上帝工坊）时一切可动 —— 这是兼容旧玩法的关键，
   * 也是所有 bench / 自检能继续按老路子跑的原因。 */
  function canAct(owner) { return !PLAYER || PLAYER === (owner | 0); }
  function lockTitle() { return '非你的国家（先点顶栏「开始游戏」选一个国）'; }
  /* 把一个按钮按"锁权"处理：不是你的国 → 置灰 + title 说明。
   * 统一走这个函数，是为了让"哪些钮被锁了"只有一种视觉（灰 + 一句同样的话），
   * 而不是每个面板各自发挥。 */
  function lockBtn(btn, owner) {
    if (!btn || canAct(owner)) return false;
    btn.disabled = true;
    btn.classList.add('locked');
    btn.title = lockTitle() + (btn.title ? '　／　' + btn.title : '');
    return true;
  }

  /* 群龙无首：首都现在不在自己手里。**现算不存**，光复那一刻自动解除。 */
  function isDecap(owner) {
    if (!owner || countryDead(owner)) return false;
    var c = coOf(owner);
    if (!c || !c.capital) return false;
    var cap = pOf(c.capital);
    return !cap || cap.owner !== owner;
  }

  /* 宣战时记下双方初始省数 —— 投降线的分母。为什么不现算：
   * 现算的话"打下两个省"会让分母一起缩，永远到不了 1/3。 */
  function warBaseOf(a, b) {
    var k = warKey(a, b);
    if (!WARBASE[k]) {
      var ca = coOf(a), cb = coOf(b);
      WARBASE[k] = { a: ca ? ca.provinces.length : 0, b: cb ? cb.provinces.length : 0 };
    }
    return WARBASE[k];
  }

  /* ---------------- 二、装备袋（和七种资源共用 SIM 袋） ----------------
   * 装备键没有 AO.RESOURCE_BY_KEY，所以 settleTurn 的产出/维护循环会自动跳过，
   * 而 stockOf / payCost 这类"按 key 取库存"的函数一行都不用改。 */
  function itemStock(pid, key) {
    var bag = SIM[pid];
    if (!bag) return 0;
    return (bag[key] && bag[key].stock) || 0;
  }
  function addItem(pid, key, n) {
    var bag = SIM[pid];
    if (!bag || !n) return 0;
    var s = bag[key] || (bag[key] = { stock: 0, wp: true });
    if (s.stock === undefined) s.stock = 0;
    s.stock += n;
    return n;
  }
  function itemOf(a) { return AO.MIL_ITEM[a.tier] || AO.MIL_ITEM.leather; }

  /* 一国已解锁的装备（该 kind：weapon / gun / ship） */
  function unlockedItems(owner, kind) {
    var order = kind === 'gun' ? AO.GUN_ORDER : kind === 'ship' ? AO.SHIP_ORDER : AO.MIL_ORDER;
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var it = AO.MIL_ITEM[order[i]];
      if (!it) continue;
      if (!it.tech || (RESEARCH[owner] && RESEARCH[owner].done[it.tech])) out.push(it);
    }
    return out;
  }
  /* 该国当前"最高档"的可用军械（征兵的默认选择） */
  function bestWeapon(owner) {
    var list = unlockedItems(owner, 'weapon');
    return list.length ? list[list.length - 1] : AO.MIL_ITEM.leather;
  }

  /* ---------------- 三、装备厂：建厂条件 / 订单 / 产出 ---------------- */
  function factoryCtx(p) {
    /* edu = 累计教育（只加不减，解锁用）；talent = 能花的人才点（抽卡会扣）。
     * 建厂门槛一律看 edu —— 看 pts 的话"抽一位官员"就能把自己的厂锁掉。 */
    var T = talentOf(p.owner);
    return { bag: SIM[p.id], edu: T.total || 0, talent: T.pts || 0 };
  }
  /* 建一座装备厂（付账 → 开工）。门槛由 AO.FACTORY.check 统一回答，
   * 所以 ＋钮的 title 和真建厂读的是同一段判断，不会出现"说明说能建、点了不让建"。 */
  function buildFactory(p, kind, silent) {
    var say = silent ? noop : bldMsg;
    var D = AO.FACTORY[kind];
    if (!D) return;
    if (!silent && !canAct(p.owner)) return say('非你的国家', 'warn');
    var st = univOf(kind, p.id);
    if (st.site > 0) return say(D.cn + '还在建（剩 ' + st.site + ' 回合）', 'warn');
    var ck = AO.FACTORY.check(kind, p, factoryCtx(p));
    if (!ck.ok) return say('建不了' + D.cn + '：' + ck.why, 'warn');
    var r = payCost(p, D.cost);
    if (!r.ok) {
      return say('资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need + '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    st.site = effectiveTurns(p.id, p.owner, D.turnsAt());
    say(D.cn + '开工：' + costText(D.cost) + '，' + st.site + ' 回合后完工（' + D.desc + '）', 'ok');
  }

  /* 军械坊 / 铸炮厂 / 造船厂下订单：只能从**已解锁**的装备里挑。 */
  function setShopOrder(pid, kind, key) {
    var p = pOf(pid);
    if (!p) return { ok: false, msg: '没有这个省' };
    if (!canAct(p.owner)) return { ok: false, msg: lockTitle() };
    var it = key ? AO.MIL_ITEM[key] : null;
    if (key && !it) return { ok: false, msg: '没有这种装备' };
    if (it) {
      var order = kind === 'armory' ? AO.MIL_ORDER : kind === 'foundry' ? AO.GUN_ORDER : AO.SHIP_ORDER;
      if (order.indexOf(key) < 0) return { ok: false, msg: AO.FACTORY[kind].cn + ' 产不了' + it.cn };
      if (it.tech && !(RESEARCH[p.owner] && RESEARCH[p.owner].done[it.tech])) {
        var t = AO.TECH_BY_KEY[it.tech];
        return { ok: false, msg: '还没解锁「' + it.cn + '」，先研究「' + (t ? t.cn : it.tech) + '」' };
      }
    }
    var st = univOf(kind, pid);
    st.order = key || null;
    return { ok: true, msg: key ? (AO.FACTORY[kind].cn + ' 改产「' + it.cn + '」') : (AO.FACTORY[kind].cn + ' 停工待单') };
  }

  /* 本省军械产能的乘数：有一座**不停产**的工厂就 ×2，否则 ×1。
   * 抽成函数是为了「settleIndustry 的实际产出」和「? 面板/行 title 上写的 ×2」
   * 读同一个数 —— 面板说翻倍、结算没翻，这种错最难查。 */
  function armProdMul(pid) {
    var fb = FACTORY_BLD[pid];
    return (fb && fb.n > 0 && !fb.halted) ? (AO.FACTORY.factory.prodMul || 2) : 1;
  }
  AO.resArmProdMul = armProdMul;

  /* 装备厂结算：每回合一次，跑在资源产出之后。
   * **产能是闸**：每座每回合 out 件，料从本省库存 → 中央国库扣（不走调拨，
   * 和 payMaint 同一个口径 —— 厂子在本地，料也该在本地）。
   *
   * 工厂（15 档）是唯一的产能放大器：本省只要有一座不停产的工厂，
   * 军械坊 / 驯马场 / 铸炮厂 / 造船厂 的**产出 ×2、料不变** ——
   * 工业化解放的是产能，不是原料（否则"缺铁"就成了唯一瓶颈，
   * 工厂反而变成负担）。 */
  function settleIndustry(pid, owner) {
    var bag = SIM[pid];
    if (!bag) return;
    var i, kind, st, D;
    /* 本省工厂的产能乘数：0 座或停产 → 1 */
    var outMul = armProdMul(pid);
    for (i = 0; i < UNIV_MIL.length; i++) {
      kind = UNIV_MIL[i];
      st = UNIV[kind][pid];
      if (!st || !(st.n > 0)) continue;
      D = AO.FACTORY[kind];
      if (st.halted) continue;                     // 维护欠费 → 停产（复用 payMaint 的结果）
      var F = (CUR.pid === (pid | 0)) ? CUR.F : null;

      if (kind === 'stable') {                     // 驯马场：产战马（骑兵的第二道闸）
        var hn = st.n * (D.per || 1) * outMul;
        addItem(pid, 'warhorse', hn);
        if (F) F.gain.warhorse = (F.gain.warhorse || 0) + hn;
        continue;
      }
      if (kind === 'barracks' || kind === 'factory') continue;  // 不产东西：兵营开征兵口、工厂给产能

      /* 三个订单厂：armory / foundry / shipyard */
      var key = st.order;
      if (!key) continue;                          // 没下单 → 空转（不下单不花钱，这是故意的）
      var it = AO.MIL_ITEM[key];
      if (!it) { st.order = null; continue; }
      if (it.tech && !(RESEARCH[owner] && RESEARCH[owner].done[it.tech])) continue;  // 订单失效

      /* 凑料：先本省，再中央。凑不齐就这一回合不产（料不扣半份）。 */
      var cen = ensureCentral(owner), need = {}, k, okMat = true;
      for (k in it.recipe) need[k] = it.recipe[k] * st.n;
      for (k in need) {
        var have = stockOf(pid, k) + (cen[k] || 0);
        if (have < need[k]) { okMat = false; break; }
      }
      if (!okMat) continue;
      for (k in need) {
        var take = Math.min(stockOf(pid, k), need[k]);
        if (take > 0) {
          bag[k].stock -= take;
          if (F) { F.loss[k] = (F.loss[k] || 0) + take; F.d.ind = (F.d.ind || 0) + take; }
        }
        var rest = need[k] - take;
        if (rest > 0) {
          cen[k] = (cen[k] || 0) - rest;
          var FC = FLOWC[owner];
          if (FC) { FC.loss[k] = (FC.loss[k] || 0) + rest; FC.d.ind = (FC.d.ind || 0) + rest; }
        }
      }
      var outN = (it.out || 1) * st.n * outMul;
      addItem(pid, key, outN);
      if (F) F.gain[key] = (F.gain[key] || 0) + outN;
    }
  }

  /* ---------------- 四、将领（武科抽卡） ----------------
   * 和文科（examOfficial）共用**同一种人才点**、同一次消耗；
   * 区别只是抽的池子不同：文官进 TALENT[owner].pool，武官进 TALENT[owner].milPool。
   * 一将一军：指派即占位，撤下来回候选池（免费，随时换）。 */
  function rollMilTrait() {
    var list = AO.MIL_TRAITS, total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].w || 0;
    var r = Math.random() * total;
    for (i = 0; i < list.length; i++) {
      r -= list[i].w || 0;
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }
  function milPoolOf(owner) {
    var T = talentOf(owner);
    if (!T.milPool) T.milPool = [];
    return T.milPool;
  }
  function usedGenNames() {
    var set = Object.create(null), k, i;
    for (k in TALENT) {
      var pool = (TALENT[k] && TALENT[k].milPool) || [];
      for (i = 0; i < pool.length; i++) if (pool[i]) set[pool[i].name] = 1;
    }
    for (k in GENERALS) if (GENERALS[k]) set[GENERALS[k].name] = 1;
    /* 文官的名字也避开 —— 一个国家里出现两个"王守仁"一个当官一个当将，很出戏 */
    var used = usedOffNames();
    for (k in used) set[k] = 1;
    return set;
  }
  function pickGenName() {
    var N = AO.OFF_NAMES, used = usedGenNames(), t, nm;
    function rnd() {
      return N.surnames[(Math.random() * N.surnames.length) | 0] +
        N.givens[(Math.random() * N.givens.length) | 0];
    }
    for (t = 0; t < 60; t++) {
      nm = rnd();
      if (!used[nm]) return nm;
    }
    var n = 2;
    while (used[nm + n]) n++;
    return nm + n;
  }
  /* 开武科：扣人才点 → 摇词条 → 进武将候选池 */
  function examGeneral(owner, silent) {
    var G = AO.GOV, T = talentOf(owner);
    if (!silent && !canAct(owner)) return { ok: false, msg: lockTitle() };
    if (T.pts < G.examCost) {
      return { ok: false, msg: '人才点不够：开武科要 ' + G.examCost + '，现在只有 ' + fmtPts(T.pts) +
        '（学校每座 +' + G.talentPerSchool + ' / 回合）' };
    }
    T.pts -= G.examCost;
    var tr = rollMilTrait();
    var gen = { id: GEN_ID++, name: pickGenName(), traitKey: tr.key, owner: owner | 0, armyId: 0 };
    GENERALS[gen.id] = gen;
    milPoolOf(owner).push(gen);
    if (!silent && tr.rar === 'bad') {
      NOTES.push({ owner: +owner, cls: 'warn',
        text: '武科：' + gen.name + ' 弓马娴熟却性贪 —— 「' + tr.cn + '」（' + tr.desc + '）' });
    } else if (!silent && tr.rar === 'gold') {
      NOTES.push({ owner: +owner, cls: 'ok',
        text: '武科：' + gen.name + ' 策论兵法无一不精 —— 「' + tr.cn + '」（' + tr.desc + '）' });
    }
    return { ok: true, gen: gen, trait: tr };
  }
  function generalOf(a) { return (a && a.generalId && GENERALS[a.generalId]) || null; }
  function genTrait(g) { return g ? AO.milTraitOf(g.traitKey) : null; }
  /* 给军队指派将领（武将必须在候选池里、且没带兵） */
  function assignGeneral(armyId, genId, silent) {
    var a = ARMY[armyId];
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle() };
    var g = GENERALS[genId];
    if (!g) return { ok: false, msg: '没有这位将领' };
    if (g.owner !== a.owner) return { ok: false, msg: '不是本国的将领' };
    if (g.armyId && g.armyId !== a.id) return { ok: false, msg: g.name + ' 已经在带兵了' };
    var old = generalOf(a);
    if (old) old.armyId = 0;
    /* 从候选池里摘掉（指派即上任） */
    var pool = milPoolOf(a.owner), i;
    for (i = 0; i < pool.length; i++) if (pool[i].id === g.id) { pool.splice(i, 1); break; }
    g.armyId = a.id;
    a.generalId = g.id;
    return { ok: true, gen: g, old: old || null };
  }
  function detachGeneral(armyId) {
    var a = ARMY[armyId];
    if (!a) return null;
    var g = generalOf(a);
    if (!g) return null;
    g.armyId = 0;
    a.generalId = 0;
    milPoolOf(a.owner).push(g);
    return g;
  }

  /* ---------------- 五、军队 ---------------- */
  function armyIds() { return Object.keys(ARMY).map(Number).sort(function (x, y) { return x - y; }); }
  function armiesIn(pid) {
    var out = [], ids = armyIds();
    for (var i = 0; i < ids.length; i++) if (ARMY[ids[i]].pid === (pid | 0)) out.push(ARMY[ids[i]]);
    return out;
  }
  function armiesOf(owner) {
    var out = [], ids = armyIds();
    for (var i = 0; i < ids.length; i++) if (ARMY[ids[i]].owner === (owner | 0)) out.push(ARMY[ids[i]]);
    return out;
  }
  function newArmy(owner, pid, opt) {
    opt = opt || {};
    var id = ARMY_ID++;
    var a = {
      id: id, owner: owner | 0, type: opt.type || 'army',
      tier: opt.tier || 'leather', men: Math.max(100, opt.men || AO.RECRUIT.menPerUnit),
      ships: opt.type === 'navy' ? (opt.ships || 1) : 0, cargo: null,
      generalId: opt.generalId || 0, order: null, pid: pid | 0, sup: false, starved: false
    };
    ARMY[id] = a;
    if (a.generalId && GENERALS[a.generalId]) GENERALS[a.generalId].armyId = id;
    return a;
  }
  function disbandArmy(id, why) {
    var a = ARMY[id];
    if (!a) return;
    var g = generalOf(a);
    if (g) { g.armyId = 0; milPoolOf(a.owner).push(g); }
    delete ARMY[id];
    if (why) WARLOG.unshift({ turn: turnNo, cls: 'bad', text: why });
  }

  /* 征兵：三样消耗（人口 / 金 / 该代装备）齐全才成军。
   * **成建制门槛**：省里该代装备不够 N 件时直接不让征（title 里写差几件）。 */
  function recruitInfo(pid, arms, tierKey) {
    var p = pOf(pid), out = { ok: false, why: '', tier: null, arms: arms || 'inf' };
    if (!p) { out.why = '没有这个省'; return out; }
    var bq = BARRACKS[pid];
    if (!bq || !(bq.n > 0)) { out.why = '本省没有兵营'; return out; }
    if (bq.halted) { out.why = '兵营维护欠费，停产中'; return out; }
    var it = tierKey ? AO.MIL_ITEM[tierKey] : (arms === 'art' ? lastUnlocked(p.owner, 'gun') : bestWeapon(p.owner));
    if (!it) { out.why = '还没有可用的装备（先研究军械 / 铸炮）'; return out; }
    out.tier = it;
    if (it.tech && !(RESEARCH[p.owner] && RESEARCH[p.owner].done[it.tech])) {
      out.why = '还没解锁「' + it.cn + '」'; return out;
    }
    if (arms === 'cav' && it.arms !== 'cav' && !hasCavTech(p.owner)) {
      out.why = '重骑兵要「强弩·具装」解锁'; return out;
    }
    if (arms === 'art' && it.kind !== 'gun') { out.why = '炮兵要炮'; return out; }
    var R = AO.RECRUIT;
    out.need = {
      pop: R.popPerUnit, gold: R.goldPerUnit, wpn: R.weaponPerUnit,
      horse: arms === 'cav' ? R.horsePerCav : 0,
      gun: arms === 'art' ? R.gunPerArt : 0
    };
    var wpnHave = itemStock(pid, it.key);
    out.have = { wpn: wpnHave, horse: itemStock(pid, 'warhorse'), gun: arms === 'art' ? wpnHave : 0 };
    if (wpnHave < out.need.wpn) {
      out.why = '军械不够：本省「' + it.cn + '」只有 ' + wpnHave + ' 件，成建制要 ' + out.need.wpn +
        ' 件（差 ' + (out.need.wpn - wpnHave) + ' 件 —— 让军械坊接着产）';
      return out;
    }
    if (arms === 'cav' && itemStock(pid, 'warhorse') < out.need.horse) {
      out.why = '战马不够：要 ' + out.need.horse + ' 匹，本省有 ' + itemStock(pid, 'warhorse') + '（盖驯马场）';
      return out;
    }
    var gold = (SIM[pid].gold && SIM[pid].gold.stock) || 0;
    var cen = CENTRAL[p.owner] || {};
    if (gold + (cen.gold || 0) < out.need.gold) {
      out.why = '金不够：要 ' + out.need.gold + '（省库 ' + gold + ' · 中央 ' + Math.floor(cen.gold || 0) + '）';
      return out;
    }
    var popv = (POP[pid] && POP[pid].v) || 0;
    if (popv < out.need.pop) { out.why = '人口不够：要 ' + out.need.pop + ' 人，本省只有 ' + Math.round(popv); return out; }
    if (RECRUITQ[pid]) { out.why = '本省正在征兵（剩 ' + RECRUITQ[pid].left + ' 回合）'; return out; }
    out.ok = true;
    return out;
  }
  function lastUnlocked(owner, kind) {
    var list = unlockedItems(owner, kind);
    return list.length ? list[list.length - 1] : null;
  }
  function hasCavTech(owner) {
    var R = RESEARCH[owner];
    return !!(R && R.done.mil_crossbow);
  }

  function recruit(pid, arms, tierKey) {
    arms = arms || 'inf';
    var p = pOf(pid);
    if (!p) return { ok: false, msg: '没有这个省' };
    if (!canAct(p.owner)) return { ok: false, msg: lockTitle() };
    var info = recruitInfo(pid, arms, tierKey);
    if (!info.ok) return { ok: false, msg: info.why };
    var it = info.tier, R = AO.RECRUIT, need = info.need;

    /* 扣装备（本省库存） */
    SIM[pid][it.key].stock -= need.wpn;
    if (need.horse) addItem(pid, 'warhorse', -need.horse);
    /* 扣金：先省库、再中央 */
    var g = SIM[pid].gold, left = need.gold;
    var take1 = Math.min(g.stock, left);
    g.stock -= take1; left -= take1;
    if (left > 0) { var cen = ensureCentral(p.owner); cen.gold = (cen.gold || 0) - left; }
    /* 扣人口（POP.v 直接减，不产生"饿死"的粮食结算） */
    POP[pid].v = Math.max(1000, POP[pid].v - need.pop);

    /* 成军延迟：默认 1 回合（练兵使驻省时即刻成军） */
    var delay = RECRUIT_TURNS;
    var gar = armiesIn(pid);
    for (var i = 0; i < gar.length; i++) {
      var gt = genTrait(generalOf(gar[i]));
      if (gt && gt.fx.rec) delay = Math.max(0, delay - gt.fx.rec);
    }
    if (delay <= 0) {
      var a0 = spawnArmy(p.owner, pid, it.key, arms);
      return { ok: true, msg: p.name + ' 成军：「' + it.unit + '」' + AO.RECRUIT.menPerUnit + ' 人（' +
        it.cn + ' ×' + need.wpn + ' · 金 ' + need.gold + ' · 人口 ' + need.pop + '）', army: a0, instant: true };
    }
    RECRUITQ[pid] = { left: delay, tier: it.key, arms: arms, owner: p.owner | 0 };
    return { ok: true, msg: p.name + ' 征兵中：「' + it.unit + '」' + delay + ' 回合后成军（' +
      it.cn + ' ×' + need.wpn + ' · 金 ' + need.gold + ' · 人口 ' + need.pop + '）' };
  }

  /* 成军：同省同代同兵种 → 并进去（避免一个省堆十支小军） */
  function spawnArmy(owner, pid, tier, arms) {
    var list = armiesIn(pid), i;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.owner === (owner | 0) && a.type === 'army' && a.tier === tier && (a.arms || 'inf') === (arms || 'inf') &&
        a.men < AO.RECRUIT.maxMen) {
        a.men = Math.min(AO.RECRUIT.maxMen, a.men + AO.RECRUIT.menPerUnit);
        return a;
      }
    }
    var na = newArmy(owner, pid, { type: 'army', tier: tier, men: AO.RECRUIT.menPerUnit });
    na.arms = arms || 'inf';
    return na;
  }
  function recruitTick() {
    for (var pid in RECRUITQ) {
      var q = RECRUITQ[pid];
      q.left--;
      if (q.left > 0) continue;
      delete RECRUITQ[pid];
      var p = pOf(pid);
      if (!p) continue;
      spawnArmy(q.owner, +pid, q.tier, q.arms);
      WARLOG.unshift({ turn: turnNo, cls: 'ok',
        text: p.name + ' 新军成军（' + (AO.MIL_ITEM[q.tier] || {}).cn + '）' });
    }
  }

  /* ---------------- 六、命令与战术 ----------------
   * 军队命令只有五种（陆军）+ 两种（舰队）。玩家的操作量就到这里为止。
   * 战术：**词条没有的战术置灰**（tacticAllowed 是唯一的判定，UI 和结算共用）。 */
  function tacticsFor(army, where) {
    var g = generalOf(army), tr = genTrait(g), list = AO.TACTICS, out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.auto) continue;                             // 合围自动判定，不进选择器
      if (t.where && where && t.where !== where) continue;
      if (t.need && !(tr && tr.tac && tr.tac.indexOf(t.key) >= 0)) continue;
      out.push(t);
    }
    return out;
  }
  function tacticAllowed(army, key) {
    var t = AO.tacOf(key);
    if (!t || t.auto) return false;
    if (!t.need) return true;
    /* 判定看**战术键**在不在将领的 tac 清单里（不是看词条键 ——
     * 词条键和战术键不是一一对应：治世军神同时给了闪袭和围城）。 */
    var tr = genTrait(generalOf(army));
    return !!(tr && tr.tac && tr.tac.indexOf(t.key) >= 0);
  }
  /* 下命令。order = { type, cid, pid, tactic } */
  function setArmyOrder(armyId, order) {
    var a = ARMY[armyId];
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!canAct(a.owner)) return { ok: false, msg: lockTitle() };
    if (!order || !order.type) return { ok: false, msg: '没有命令' };
    var O = AO.ORDERS[order.type];
    if (!O) return { ok: false, msg: '没有这种命令' };
    if (a.type === 'navy' && order.type !== 'blockade' && order.type !== 'transport' && order.type !== 'defend') {
      return { ok: false, msg: '舰队只能封锁 / 运输 / 驻防' };
    }
    if (a.type === 'army' && (order.type === 'blockade' || order.type === 'transport')) {
      return { ok: false, msg: '陆军上不了海 —— 要舰队运输' };
    }
    var tac = order.tactic || 'assault';
    if (order.type !== 'train' && !tacticAllowed(a, tac)) {
      var tr = genTrait(generalOf(a));
      return { ok: false, msg: '这支部队没学过「' + AO.tacOf(tac).cn + '」' +
        (tr ? '（将领词条：' + tr.cn + '）' : '（还没有将领）') };
    }
    a.order = {
      type: order.type, cid: order.cid | 0, pid: order.pid | 0,
      tactic: order.type === 'train' ? null : tac
    };
    var target = order.pid ? pOf(order.pid) : null;
    return { ok: true, msg: '命令：' + O.cn + (target ? ' → ' + target.name : '') +
      (a.order.tactic ? '（' + AO.tacOf(a.order.tactic).cn + '）' : '') };
  }

  /* ---------------- 七、行军 ---------------- */
  /* 陆路 BFS：只能走"自己的省 + 交战国的省"（v1 没有军事通行权）。 */
  function landPath(from, to, owner) {
    if (!from || !to) return null;
    if (from === to) return [];
    var prev = Object.create(null), seen = Object.create(null), q = [from];
    seen[from] = 1;
    while (q.length) {
      var cur = q.shift();
      var pr = pOf(cur);
      if (!pr) continue;
      var nb = pr.neighbors || [];
      for (var i = 0; i < nb.length; i++) {
        var n = nb[i];
        if (seen[n]) continue;
        var pn = pOf(n);
        if (!pn) continue;
        if (pn.owner !== (owner | 0) && !atWar(owner, pn.owner)) continue;
        seen[n] = 1;
        prev[n] = cur;
        if (n === to) {
          var path = [n], c = n;
          while (prev[c] !== undefined) { c = prev[c]; path.unshift(c); }
          path.shift();                     // 去掉起点
          return path;
        }
        q.push(n);
      }
    }
    return null;
  }

  /* 海路：沿海省两两质心距离 < D 视为通航（**没有独立海图**）。
   * 世界级缓存 —— 500 个沿海省两两比一次就够，之后每回合只查表。 */
  var SEA = { w: null, map: null };
  function seaMap() {
    var w = state.world;
    if (SEA.w === w && SEA.map) return SEA.map;
    var D = AO.BATTLE.seaD * Math.max(w.meta.width, w.meta.height);
    var ports = [], i, j;
    for (i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (p && p.coastDirs > 0) ports.push(p);
    }
    var map = Object.create(null);
    for (i = 0; i < ports.length; i++) map[ports[i].id] = [];
    for (i = 0; i < ports.length; i++) {
      for (j = i + 1; j < ports.length; j++) {
        var dx = ports[i].centroid[0] - ports[j].centroid[0];
        var dy = ports[i].centroid[1] - ports[j].centroid[1];
        if (Math.sqrt(dx * dx + dy * dy) <= D) {
          map[ports[i].id].push(ports[j].id);
          map[ports[j].id].push(ports[i].id);
        }
      }
    }
    SEA = { w: w, map: map };
    return map;
  }
  function seaPath(from, to) {
    var map = seaMap();
    if (!map[from] || !map[to]) return null;
    if (from === to) return [];
    var prev = Object.create(null), seen = Object.create(null), q = [from];
    seen[from] = 1;
    while (q.length) {
      var cur = q.shift(), nb = map[cur] || [];
      for (var i = 0; i < nb.length; i++) {
        var n = nb[i];
        if (seen[n]) continue;
        seen[n] = 1;
        prev[n] = cur;
        if (n === to) {
          var path = [n], c = n;
          while (prev[c] !== undefined) { c = prev[c]; path.unshift(c); }
          path.shift();
          return path;
        }
        q.push(n);
      }
    }
    return null;
  }

  /* 行军：一格一回合（急行军/闪袭两格）。路上遇到敌人就停在那个省（开打）。 */
  function moveSteps(a, path, steps) {
    var moved = 0;
    for (var i = 0; i < path.length && moved < steps; i++) {
      var next = path[i], np = pOf(next);
      if (!np) break;
      a.pid = next;
      moved++;
      /* 踏过即测绘（v6）：行军是"免费但慢"的探索 —— 走过一次记一辈子，
       * 但记得的是当时的样子，回头再看就开始泛黄。 */
      see(a.owner, next, false);
      /* 进了敌省：如果那儿有敌军，就地停下（会战在③段统一结算） */
      var foes = armiesIn(next);
      for (var k = 0; k < foes.length; k++) {
        if (foes[k].owner !== a.owner && atWar(a.owner, foes[k].owner)) return moved;
      }
      if (np.owner !== a.owner && atWar(a.owner, np.owner)) return moved;
    }
    return moved;
  }

  /* ---------------- 八、会战 ----------------
   * 两相位：射击（双方射程 >0 的战力先互杀伤）→ 接触（余部互殴）。
   * 战力 = 兵数 × 兵种战力 × 将领 × 地形(守) × 压制(被轰击 0.8) × 骰子(0.85~1.15)
   * 战报里把每一个乘数都写出来 —— 验收要求"可以从战报复算"。 */
  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }

  function sideStat(list, prov, isDef) {
    var B = AO.BATTLE, pow = 0, shoot = 0, men = 0, ships = 0, siege = 0;
    var hasNight = false, hasWall = false, hasAmbush = false, first = 1;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], u = armyUnits(a);
      var tr = genTrait(generalOf(a)), fx = (tr && tr.fx) || {};
      var m = 1;
      if (fx.powMul) m *= fx.powMul;
      if (isDef && fx.defMul) m *= fx.defMul;
      if (a.sup) m *= B.suppress;                    // 被轰击压制
      if (a.starved) m *= 0.85;                      // 断粮
      if (isDecap(a.owner)) m *= B.decap;            // 群龙无首
      var v = u.base * m;
      pow += v; men += a.men; ships += a.ships || 0;
      if (u.range > 0) shoot += v;
      if (u.siege > siege) siege = u.siege;
      var tac = a.order && a.order.tactic;
      if (tac === 'night') hasNight = true;
      if (tac === 'wall') hasWall = true;
      if (tac === 'ambush') hasAmbush = true;
      if (fx.first && fx.first > first) first = fx.first;
    }
    if (list.length >= 2) { pow *= B.encircle; shoot *= B.encircle; }   // 合围
    var terrMul = 1;
    if (isDef) {
      terrMul = B.terrainDef[prov.terrain] === undefined ? 1 : B.terrainDef[prov.terrain];
      if (hasAmbush && (prov.terrain === 'mountains' || prov.terrain === 'forest')) {
        terrMul *= B.ambush;                          // 设伏
      }
    }
    return {
      pow: pow * terrMul, shoot: shoot * terrMul, men: men, ships: ships, siege: siege,
      terr: terrMul, terrain: prov.terrain, hasNight: hasNight, hasWall: hasWall,
      first: first, dice: rnd(B.diceLo, B.diceHi), n: list.length
    };
  }
  function armyUnits(a) {
    if (a.type === 'navy') {
      var sh = AO.MIL_ITEM[a.tier] || AO.MIL_ITEM.galley;
      return { pow: sh.pow, base: (a.ships || 0) * sh.pow, range: 1, siege: 0 };
    }
    var it = itemOf(a);
    var base = (a.men / 1000) * it.pow;
    /* 炮兵在接触相位很脆：射击段按满战力，接触段打 5 折 */
    return { pow: it.pow, base: base, range: it.range, siege: it.siege };
  }

  /* 伤亡：按兵比例摊到各军，人从 POP 扣，装备按比例损毁 */
  function hurt(list, total) {
    var men0 = 0, i;
    for (i = 0; i < list.length; i++) men0 += list[i].men;
    if (!men0 || total <= 0) return 0;
    var dead = 0;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      var share = Math.round(total * (a.men / men0));
      if (share <= 0) continue;
      var real = Math.min(a.men, share);
      a.men -= real;
      dead += real;
      /* 阵亡兵从省人口里扣（征的时候扣过一次，死的时候再扣一次 —— 这是人头，不是税收） */
      var pop = POP[a.pid];
      if (pop) pop.v = Math.max(1000, pop.v - real);
      /* 装备按比例损毁：每死 1000 人损 1 件（就地从驻省库存扣） */
      var lost = Math.floor(real / 1000);
      if (lost > 0 && a.type !== 'navy') {
        var have = itemStock(a.pid, a.tier);
        var cut = Math.min(have, lost);
        if (cut > 0) addItem(a.pid, a.tier, -cut);
      }
      if (a.type === 'navy') a.ships = Math.max(0, (a.ships || 0) - Math.floor(real / 1000));
    }
    return dead;
  }

  /* 守方伤亡**先扣城墙耐久**：1 点城防 ≈ manPerHp 人的伤亡容量。
   * 扣空了才轮到人（剩下的伤害按原比例摊给守军），所以有墙的一方
   * 头几轮"零伤亡"，墙一塌伤亡立刻照旧 —— 这就是"血条"的体感。
   * wallRec 是这一场会战的战报记录，用来写"墙替守军吃了多少人份"。 */
  function hurtWall(wallSt, wallRec, list, total) {
    if (!wallSt || !(wallSt.lv > 0) || !(wallSt.hp > 0) || !(total > 0)) return hurt(list, total);
    var per = AO.WALL.manPerHp;
    var hpDmg = total / per;
    var take = Math.min(wallSt.hp, hpDmg);
    wallSt.hp -= take;
    if (wallRec) wallRec.absorbed += take * per;
    var rest = (hpDmg - take) * per;
    return rest > 0.5 ? hurt(list, rest) : 0;
  }

  /* 一场会战。返回战报对象（同时推一条 NOTES + WARLOG）。 */
  function fight(atkList, defList, prov, opts) {
    opts = opts || {};
    var B = AO.BATTLE;
    var A = sideStat(atkList, prov, false), D = sideStat(defList, prov, true);
    A.pow *= A.dice; A.shoot *= A.dice;
    D.pow *= D.dice; D.shoot *= D.dice;

    /* ---- 城墙：守方的额外血条（第一条接口）----
     * 只有"守方就是这座省的主人"时墙才帮忙（驻在别国地盘上的军队没墙可躲）。
     * 战力加成按**开打那一刻**的耐久算，所以战报里的 hp0 / mul 能直接复算：
     *   mul = 1 + hp0 / max × 0.25
     * 破城锤 = 攻方**攻城值合计** × 2 点，一次性砸在墙上（重炮碾墙、皮甲啃不动）。
     * 之后的伤亡先扣 hp，扣空了才掉兵（见 hurtWall）。 */
    var wallSt = WALL[prov.id], wMax = 0, wHp0 = 0, wMul = 1, breach = 0, wallRec = null;
    if (wallSt && wallSt.lv > 0 && prov.owner === defList[0].owner) {
      wMax = AO.WALL.maxHp(wallSt.lv);
      wHp0 = wallSt.hp;
      if (wHp0 > 0) wMul = 1 + (wHp0 / wMax) * AO.WALL.defendMul;
      var atkSiege = 0;
      for (var ws = 0; ws < atkList.length; ws++) atkSiege += (armyUnits(atkList[ws]).siege || 0);
      breach = Math.round(atkSiege * AO.WALL.breachMul);
      wallSt.hp = AO.clamp(wallSt.hp - breach, 0, wMax);
      wallRec = { lv: wallSt.lv, max: wMax, hp0: wHp0, mul: wMul, breach: breach,
        siege: atkSiege, hp1: wallSt.hp, absorbed: 0, refill: 0 };
      D.pow *= wMul;
      D.shoot *= wMul;
    }

    var aMen0 = A.men, dMen0 = D.men;
    var defImmune = defList.some(function (x) {
      var tr = genTrait(generalOf(x));
      return !!(tr && tr.fx && tr.fx.immuneNight);
    });
    /* 夜袭：跳过守方射击相位（铁壁免疫）。闪袭：攻方先手 +10%。 */
    var nightSkip = A.hasNight && !defImmune;
    var firstMul = A.first || 1;
    if (firstMul > 1 && A.shoot > 0) A.shoot *= firstMul;

    /* ---- 相位一：射击 ---- */
    var aS = A.shoot, dS = nightSkip ? 0 : D.shoot;
    var shootRec = { aS: aS, dS: dS, deadD: 0, deadA: 0 };
    if (aS + dS > 0) {
      var rateA = B.lossBase * (aS / (aS + dS));   // 攻方造成的损失率（打在守方身上）
      var rateD = B.lossBase * (dS / (aS + dS));
      shootRec.deadD = hurtWall(wallSt, wallRec, defList, dMen0 * rateA);
      shootRec.deadA = hurt(atkList, aMen0 * rateD);
    }
    /* ---- 相位二：接触（炮兵接触段打折） ---- */
    var aM = contactPart(atkList, A), dM = contactPart(defList, D) * wMul;
    aM *= A.dice; dM *= D.dice;
    var meleeRec = { aM: aM, dM: dM, deadD: 0, deadA: 0 };
    var aMen1 = A.men - shootRec.deadA, dMen1 = D.men - shootRec.deadD;
    if (aM + dM > 0) {
      var mrA = B.lossBase * (aM / (aM + dM));
      var mrD = B.lossBase * (dM / (aM + dM));
      meleeRec.deadD = hurtWall(wallSt, wallRec, defList, Math.max(0, dMen1) * mrA);
      meleeRec.deadA = hurt(atkList, Math.max(0, aMen1) * mrD);
    }

    var aLeft = sumMen(atkList), dLeft = sumMen(defList);
    var winner = null, loserList = null, winList = null;
    if (dLeft <= 0 && aLeft > 0) { winner = 'atk'; }
    else if (aLeft <= 0 && dLeft > 0) { winner = 'def'; }
    else if (aLeft >= dLeft * (1 / B.routRatio)) { winner = 'atk'; }   // 守方兵少 30% 以上
    else if (dLeft >= aLeft * (1 / B.routRatio)) { winner = 'def'; }
    else { winner = aLeft >= dLeft ? 'atk' : 'def'; }                  // 僵持：兵多的算赢

    /* 「营造」：守城战**胜利后**立即回充 15% 耐久（行为型词条，不进 fx 执行器） */
    if (wallRec && winner === 'def' && fabricOf(prov.id, defList[0].owner)) {
      var back = Math.round(wMax * AO.WALL.fabricRefill);
      var before = wallSt.hp;
      wallSt.hp = AO.clamp(wallSt.hp + back, 0, wMax);
      wallRec.refill = wallSt.hp - before;
    }
    if (wallRec) wallRec.hp1 = wallSt.hp;

    var atkOwner = atkList[0].owner, defOwner = defList[0].owner;
    var gA = generalOf(atkList[0]), gD = generalOf(defList[0]);
    /* 会战一场，双方对这座省都是"贴脸看见"（v6）：刷新为当回合 */
    see(atkOwner, prov.id, false);
    see(defOwner, prov.id, false);
    var rep = {
      turn: turnNo, pid: prov.id, prov: prov.name, terrain: prov.terrain,
      atk: { owner: atkOwner, men0: aMen0, men1: aLeft, pow: A.pow, dice: A.dice, terr: 1, n: atkList.length },
      def: { owner: defOwner, men0: dMen0, men1: dLeft, pow: D.pow, dice: D.dice, terr: D.terr, n: defList.length },
      shoot: shootRec, melee: meleeRec, night: nightSkip, winner: winner,
      gA: gA ? gA.name : '', gD: gD ? gD.name : '',
      deadA: aMen0 - aLeft, deadD: dMen0 - dLeft,
      wall: wallRec
    };
    /* 压制只吃一次：这场会战用过了就清掉（没打起来的部队继续留着，下回合还有效） */
    for (var ci2 = 0; ci2 < atkList.length; ci2++) atkList[ci2].sup = false;
    for (var ci3 = 0; ci3 < defList.length; ci3++) defList[ci3].sup = false;
    if (winner === 'atk') { winList = atkList; loserList = defList; }
    else { winList = defList; loserList = atkList; }
    rep.retreat = retreat(loserList, winner === 'atk' ? atkOwner : defOwner, prov);
    recWarReport(rep);
    /* 存一份"最后一场会战"的完整战报：验收要能从战报复算伤亡，
     * 面板上只有一行字，复算需要原始乘数（战力/骰子/地形/两相位）。 */
    if (AO.resWar) AO.resWar.last = rep;
    return rep;
  }
  function contactPart(list, stat) {
    var v = 0;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], u = armyUnits(a);
      var tr = genTrait(generalOf(a)), fx = (tr && tr.fx) || {};
      var m = 1;
      if (fx.powMul) m *= fx.powMul;
      if (a.sup) m *= AO.BATTLE.suppress;
      if (a.starved) m *= 0.85;
      if (isDecap(a.owner)) m *= AO.BATTLE.decap;
      var base = u.base * m;
      if (a.type === 'army' && (a.arms === 'art' || (AO.MIL_ITEM[a.tier] || {}).arms === 'art')) base *= 0.5;
      v += base;
    }
    if (list.length >= 2) v *= AO.BATTLE.encircle;
    return v * stat.terr;
  }
  function sumMen(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) n += list[i].men;
    return n;
  }

  /* 败退：退向最近的己方省；无路可退 → 全歼。
   * 为什么先撤回再判"是否全歼"：不然每次败仗都变成"全军覆没"，
   * 玩家一次失误就没了半壁江山的兵，惩罚太重。 */
  function retreat(list, toOwner, prov) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.men <= 0) { disbandArmy(a.id); continue; }
      if (prov.owner === a.owner) continue;          // 已经在自己地盘上，就地待着
      var dest = nearestFriendly(a);
      if (!dest) {
        WARLOG.unshift({ turn: turnNo, cls: 'bad',
          text: ownerName(a.owner) + ' 的一支 ' + a.men + ' 人无路可退，在 ' + prov.name + ' 被全歼' });
        disbandArmy(a.id);
        out.push(a.id);
        continue;
      }
      a.pid = dest;
      out.push(a.id);
    }
    return out;
  }
  function nearestFriendly(a) {
    var ids = [];
    for (var pid in SIM) {
      var p = pOf(+pid);
      if (p && p.owner === a.owner) ids.push(+pid);
    }
    var best = 0, bestD = Infinity, me = pOf(a.pid);
    if (!me) return 0;
    for (var i = 0; i < ids.length; i++) {
      var q = pOf(ids[i]);
      var dx = q.centroid[0] - me.centroid[0], dy = q.centroid[1] - me.centroid[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = ids[i]; }
    }
    return best;
  }

  /* 战报 → 一行文本（NOTES + WARLOG 共用）。文本里带全部乘数，方便复算。 */
  function recWarReport(rep) {
    var ca = coOf(rep.atk.owner), cd = coOf(rep.def.owner);
    /* 叛军的 owner 是负号（没有国家表项）→ 统一写"叛军"，别让战报里出现 ? */
    var an = ownerName(rep.atk.owner), dn = ownerName(rep.def.owner);
    var winnerName = rep.winner === 'atk' ? an : dn;
    var tcn = (AO.TERRAIN_CN && AO.TERRAIN_CN[rep.terrain]) || rep.terrain;
    var txt = '⚔ ' + rep.prov + '（' + tcn + '·守 ×' + rep.def.terr.toFixed(2) + '）：' +
      an + ' ' + rep.gA + ' ' + rep.atk.men0 + ' 人（战 ' + fmtPts(rep.atk.pow) +
      '·骰 ' + rep.atk.dice.toFixed(2) + '）攻 ' +
      dn + ' ' + rep.gD + ' ' + rep.def.men0 + ' 人（战 ' + fmtPts(rep.def.pow) +
      '·骰 ' + rep.def.dice.toFixed(2) + '）' +
      (rep.night ? '｜夜袭：守方射击跳过' : '') +
      '｜射击 ' + fmtPts(rep.shoot.aS) + ' vs ' + fmtPts(rep.shoot.dS) +
      ' → 亡 ' + rep.shoot.deadA + '/' + rep.shoot.deadD +
      '｜接触 ' + fmtPts(rep.melee.aM) + ' vs ' + fmtPts(rep.melee.dM) +
      ' → 亡 ' + rep.melee.deadA + '/' + rep.melee.deadD +
      /* 城墙：把 hp0 → hp1、战力乘数、破城伤害、墙替人吃掉的伤亡都写出来，
       * 验收要求"从战报复算" —— 这四项就是复算需要的全部输入。 */
      (rep.wall ? '｜城防 ' + Math.round(rep.wall.hp0) + '→' + Math.round(rep.wall.hp1) + '/' + rep.wall.max +
        '（守 ×' + rep.wall.mul.toFixed(2) + '·破城 −' + rep.wall.breach +
        '·墙吃 ' + Math.round(rep.wall.absorbed) + ' 人份' +
        (rep.wall.refill ? '·营造回充 +' + Math.round(rep.wall.refill) : '') + '）' : '') +
      '｜' + winnerName + '胜，' + rep.atk.men1 + ' : ' + rep.def.men1;
    rep.text = txt;
    WARLOG.unshift({ turn: turnNo, cls: rep.winner === 'atk' ? 'ok' : 'warn', text: txt });
    if (WARLOG.length > LOG_MAX) WARLOG.length = LOG_MAX;
    FLASH[rep.pid] = turnNo;                       // 地图上标一对交叉剑
    NOTES.push({ owner: PLAYER || rep.atk.owner, pid: rep.pid, cls: 'warn', text: txt });
  }

  /* ---------------- 九、占领 / 劫掠 / 坚壁清野 ---------------- */
  function occupyProvince(pid, by, via) {
    var p = pOf(pid), before = p ? p.owner : 0;
    if (!p || p.owner === by) return false;
    var oldC = coOf(before), newC = coOf(by);
    p.owner = by;
    p.ownerColor = newC ? newC.color : p.ownerColor;
    p.ownerName = newC ? newC.name : '';
    /* 国家成员表要跟着改（渲染底图、面板列表都读它） */
    if (oldC) {
      var ix = oldC.provinces.indexOf(pid);
      if (ix >= 0) oldC.provinces.splice(ix, 1);
    }
    if (newC && newC.provinces.indexOf(pid) < 0) {
      newC.provinces.push(pid);
      newC.provinces.sort(function (a, b) { return a - b; });
    }
    OCCUPY[pid] = { by: by | 0, turn: turnNo };
    delete SIEGE[pid];
    CPROV.w = null;                            // 同国省列表缓存作废
    CAPS = null;                               // 首都表缓存作废（首都可能易手）
    invalidateGeo();
    /* 攻方贴脸进了这座城：立刻刷新一次所见（v6） */
    see(by, pid, false);
    if (before) see(before, pid, false);
    WARLOG.unshift({ turn: turnNo, cls: 'ok',
      text: '🚩 ' + p.name + ' 易主：' + (oldC ? oldC.name : '?') + ' → ' + (newC ? newC.name : '?') +
        (via ? '（' + via + '）' : '') + '；占领省产出 ×' + AO.BATTLE.occupyProd + '、民心 ' + AO.BATTLE.occupyHappy });
    /* 编年史（v5）：只读一次状态 —— 玩家刚把最后一块地打下来时，
     * 史记要当场翻到"天下归一"那一页，而不是等下一回合结算。 */
    if (AO.chronoCheck) AO.chronoCheck();
    return true;
  }
  function plunder(pid, by, mul) {
    var p = pOf(pid), bag = SIM[pid];
    if (!p || !bag) return null;
    var B = AO.BATTLE, rate = B.plunderRate * (mul || 1);
    var cen = ensureCentral(by), got = {};
    var keys = ['grain', 'gold'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], s = bag[k];
      if (!s || !(s.stock > 0)) continue;
      var n = Math.floor(s.stock * rate);
      if (n <= 0) continue;
      s.stock -= n;
      cen[k] = (cen[k] || 0) + n;
      got[k] = n;
    }
    var h = happyOf(pid);
    h.v = AO.clamp(h.v + B.plunderHappy, 0, 100);
    /* 劫掠留下的是恶名（v6）：关系 −10 —— 这一条是 REL 的四个变动源之一 */
    if (p.owner && p.owner !== (by | 0)) addRel(by, p.owner, FOG.relPlunder);
    var parts = [];
    for (var kk in got) parts.push(cnOf(kk) + ' ' + got[kk]);
    WARLOG.unshift({ turn: turnNo, cls: 'warn',
      text: '🔥 ' + p.name + ' 遭劫掠：' + (parts.length ? parts.join(' · ') + ' 归中央' : '一无所获') +
        '，民心 ' + B.plunderHappy });
    return got;
  }
  /* 坚壁清野：敌军进城之前，把 70% 存粮移到最近的己方内陆省 */
  function scorch(pid, owner) {
    var p = pOf(pid), bag = SIM[pid];
    if (!p || !bag || !bag.grain) return 0;
    var dest = null, bestD = Infinity;
    var i, list = countryProvinces(owner);
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      if (q.id === pid || q.coastDirs > 0 || OCCUPY[q.id]) continue;
      var dx = q.centroid[0] - p.centroid[0], dy = q.centroid[1] - p.centroid[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; dest = q; }
    }
    if (!dest) return 0;
    var n = Math.floor(bag.grain.stock * AO.BATTLE.scorchRate);
    if (n <= 0) return 0;
    bag.grain.stock -= n;
    addItem(dest.id, 'grain', n);
    WARLOG.unshift({ turn: turnNo, cls: 'ok',
      text: '🧱 ' + p.name + ' 坚壁清野：' + n + ' 粮运往 ' + dest.name });
    return n;
  }

  /* ---------------- 十、围城 ---------------- */
  function settleSieges() {
    for (var pid in SIEGE) {
      var p = pOf(+pid);
      if (!p) { delete SIEGE[pid]; continue; }
      var by = SIEGE[pid].by;
      if (!atWar(by, p.owner) || countryDead(p.owner)) { delete SIEGE[pid]; continue; }
      /* 围着城 = 天天看着它（v6）：围城期间这座省对攻方一直是实时 */
      see(by, +pid, false);
      see(p.owner, +pid, false);
      var bag = SIM[pid];
      var defs = armiesIn(+pid).filter(function (a) { return a.owner === p.owner; });
      if (!defs.length) { delete SIEGE[pid]; continue; }       // 守军没了 → 交给占领段
      var need = 0, i;
      for (i = 0; i < defs.length; i++) need += defs[i].men / 1000 * AO.BATTLE.feedPerK;
      need = Math.ceil(need);
      var have = bag && bag.grain ? bag.grain.stock : 0;
      if (have >= need) {
        bag.grain.stock -= need;
        continue;
      }
      /* 存粮尽 → 每回合守军 −10%（饿也饿死一半） */
      for (i = 0; i < defs.length; i++) {
        var a = defs[i];
        /* 至少掉 1 个人：残兵 4 人的时候 round(0.4) = 0，围到天荒地老也开不了城 */
        var cut = Math.max(1, Math.round(a.men * AO.BATTLE.siegeStarve));
        a.men = Math.max(0, a.men - cut);
        a.starved = true;
        if (a.men <= 0) disbandArmy(a.id);
      }
      var alive = armiesIn(+pid).filter(function (a) { return a.owner === p.owner; });
      if (!alive.length) {
        WARLOG.unshift({ turn: turnNo, cls: 'ok', text: '🏳 ' + p.name + ' 粮尽兵绝，开城投降' });
        occupyProvince(+pid, by, '围城开城');
        delete SIEGE[pid];
      }
    }
  }

  /* ---------------- 十、城墙耐久（每回合一次，放在战争段末尾） ----------------
   * 规则只有两条：
   *   欠费（halted）→ 每回合 −decay（年久失修，欠费也照掉）
   *   没欠费 + 这一回合没在这座省打过仗 → +regen（「营造」将驻防再 +fabricRegen）
   * 为什么要等战争段跑完：不然"这回合被攻城的墙"会先回 2 点再挨打，
   * 看起来像"边打边修"。FLASH 是"这一回合打过仗"的那张表（会战与轰击都写它）。 */
  function settleWalls() {
    if (!state.world) return;
    for (var pid in WALL) {
      var w = WALL[pid];
      if (!w || !(w.lv > 0)) continue;
      var p = pOf(+pid);
      if (!p) continue;
      var max = AO.WALL.maxHp(w.lv);
      if (w.halted) {
        w.hp = AO.clamp(w.hp - AO.WALL.decay, 0, max);
        continue;
      }
      if (FLASH[pid] === turnNo) continue;          // 打了一仗 → 这回合不修
      var fab = fabricOf(+pid, p.owner);
      w.hp = AO.clamp(w.hp + AO.WALL.regen + (fab ? AO.WALL.fabricRegen : 0), 0, max);
    }
  }

  /* ---------------- 十一、投降（全境并入） ---------------- */
  function checkSurrenders() {
    var w = state.world;
    if (!w) return;
    for (var k in WARSET) {
      if (!WARSET[k]) continue;
      var ab = k.split('|'), a = +ab[0], b = +ab[1];
      var base = warBaseOf(a, b);
      trySurrender(a, b, base.a, base.b);
      trySurrender(b, a, base.b, base.a);
    }
  }
  function trySurrender(loser, winner, baseLoser, baseWinner) {
    if (countryDead(loser) || countryDead(winner)) return;
    var lc = coOf(loser);
    if (!lc) return;
    var frac = isDecap(loser) ? AO.BATTLE.surrenderFracDecap : AO.BATTLE.surrenderFrac;
    var line = Math.max(1, Math.ceil((baseLoser || 1) * frac));
    if (lc.provinces.length > line) return;
    annex(loser, winner);
  }
  /* 全境并入：省全给赢家、军队/官员/科技清空、NOTES 宣布灭亡 */
  function annex(loser, winner) {
    var lc = coOf(loser), wc = coOf(winner);
    if (!lc || !wc) return;
    var list = lc.provinces.slice(), i;
    for (i = 0; i < list.length; i++) occupyProvince(list[i], winner, '投降并入');
    lc.provinces = [];
    /* 军队 / 将领 / 官员 / 科技一律清空 */
    var ids = armyIds();
    for (i = 0; i < ids.length; i++) {
      var a = ARMY[ids[i]];
      if (a && a.owner === loser) disbandArmy(a.id);
    }
    for (var gid in GENERALS) if (GENERALS[gid] && GENERALS[gid].owner === loser) delete GENERALS[gid];
    /* 官员清空：并入的省由赢家重新派官（老的跟着旧朝廷一起没了） */
    for (i = 0; i < list.length; i++) delete OFFICIAL[list[i]];
    var T = talentOf(loser);
    T.pool = []; T.milPool = []; T.pts = 0;
    RESEARCH[loser] = newResearch();
    DEAD[loser] = { turn: turnNo, by: winner };
    /* 把跟它的战争状态全部撤掉 */
    for (var k in WARSET) {
      var ab = k.split('|');
      if (+ab[0] === loser || +ab[1] === loser) delete WARSET[k];
    }
    CAPS = null; CPROV.w = null;
    invalidateGeo();
    var txt = '💀 ' + lc.name + ' 灭亡 —— 全境并入 ' + wc.name + '（剩省 ' + list.length + '，投降线 ' +
      Math.round(frac100(loser) * 100) + '%）';
    WARLOG.unshift({ turn: turnNo, cls: 'bad', text: txt });
    NOTES.push({ owner: PLAYER || winner, cls: 'warn', text: txt });
    if (PLAYER === loser) toast('你被灭了 —— ' + wc.name + ' 吞并了 ' + lc.name + '。可以「退出游戏」回到工坊模式。', 6000);
  }
  function frac100(owner) {
    return isDecap(owner) ? AO.BATTLE.surrenderFracDecap : AO.BATTLE.surrenderFrac;
  }

  /* ---------------- 十二、敌国 AI（v1 纯防守） ----------------
   * 三个约束：不主动进攻、不动经济、敌国之间不打。
   * 所以这里只有一件事：交战中的国家每 3 回合补一支驻防军（首都或边境）。
   * 不要求兵营 —— AI 走"民兵动员"，直接从中央国库扣钱扣装备，
   * 扣不起也成军（AI 经济等 AI 大版本；现在让它能守，不让人一眼看穿）。 */
  function aiDefend() {
    var w = state.world;
    if (!w) return;
    for (var i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || countryDead(c.id)) continue;
      if (PLAYER && c.id === PLAYER) continue;        // 玩家国不归 AI 管
      var foes = 0, k;
      for (k in WARSET) {
        if (!WARSET[k]) continue;
        var ab = k.split('|');
        if (+ab[0] === c.id || +ab[1] === c.id) foes++;
      }
      if (!foes) continue;
      var mine = armiesOf(c.id);
      if (mine.length >= 2) continue;
      /* 想派到哪：首都（还在自己手里）→ 任一与敌接壤的省 → 随便一个省 */
      var spot = 0;
      if (c.capital && pOf(c.capital) && pOf(c.capital).owner === c.id) spot = c.capital;
      if (!spot) {
        for (var pi = 0; pi < c.provinces.length; pi++) {
          var p = pOf(c.provinces[pi]);
          if (!p) continue;
          var nb = p.neighbors || [];
          for (var ni = 0; ni < nb.length; ni++) {
            var q = pOf(nb[ni]);
            if (q && q.owner !== c.id && atWar(c.id, q.owner)) { spot = p.id; break; }
          }
          if (spot) break;
        }
      }
      if (!spot && c.provinces.length) spot = c.provinces[0];
      if (!spot) continue;
      var pick = bestWeapon(c.id);
      /* 该省库存里要是有更好的，就用更好的（民兵也算有装备） */
      var guns = unlockedItems(c.id, 'gun');
      if (guns.length && itemStock(spot, guns[guns.length - 1].key) > 0) pick = guns[guns.length - 1];
      var cen = ensureCentral(c.id);
      cen.gold = Math.max(0, (cen.gold || 0) - AO.RECRUIT.goldPerUnit);
      var a = newArmy(c.id, spot, {
        type: 'army', tier: pick.key, men: AO.RECRUIT.aiMen
      });
      a.arms = (pick.arms === 'art') ? 'art' : 'inf';
      a.order = { type: 'defend', cid: c.id, pid: spot, tactic: 'assault' };
      /* 顺手给它抽一位将（走同一个 MIL_TRAITS 池） */
      var tr = rollMilTrait();
      var gen = { id: GEN_ID++, name: pickGenName(), traitKey: tr.key, owner: c.id, armyId: a.id };
      GENERALS[gen.id] = gen;
      a.generalId = gen.id;
      WARLOG.unshift({ turn: turnNo, cls: 'warn',
        text: '🛡 ' + c.name + ' 动员了一支 ' + AO.RECRUIT.aiMen + ' 人的守军（' + pick.cn + ' · ' + gen.name + '）驻 ' +
          (pOf(spot) || {}).name });
    }
  }

  /* ---------------- 十三、一回合的战争段落 ---------------- */
  /* 军队就地吃粮：每 1000 人 0.5 单位，先粮食再渔获；吃不到 → 掉兵 + 战力打折 */
  function feedArmy(a) {
    var B = AO.BATTLE, p = pOf(a.pid);
    if (!p) return;
    /* 部队在敌省（占领军/围城军）就地抢食：吃该省的粮，
     * 省里没粮就往回吃自己国家的中央 —— 抢不到就饿。 */
    var need = Math.ceil(a.men / 1000 * B.feedPerK);
    if (need <= 0) { a.starved = false; return; }
    var bag = SIM[a.pid] || {}, got = 0;
    var g1 = Math.min(bag.grain ? bag.grain.stock : 0, need);
    if (g1 > 0) { bag.grain.stock -= g1; got += g1; }
    if (got < need) {
      var g2 = Math.min(bag.fish ? bag.fish.stock : 0, need - got);
      if (g2 > 0) { bag.fish.stock -= g2; got += g2; }
    }
    if (got < need && (a.owner | 0) > 0) {
      /* 叛军（owner 是负号）没有国库可吃 —— 不给它开 CENTRAL[-5] 这种幽灵账，
       * 否则国家卡 / 存档里会多出一个不存在的"国"。抢不到粮就饿着，饿散为止。 */
      var cen = ensureCentral(a.owner);
      var g3 = Math.min(cen.grain || 0, need - got);
      if (g3 > 0) { cen.grain -= g3; got += g3; }
    }
    if (got < need) {
      a.starved = true;
      var cut = Math.round(a.men * B.starveLoss);
      a.men = Math.max(0, a.men - cut);
      if (a.men <= 0) {
        disbandArmy(a.id, ownerName(a.owner) + ' 一支军队在 ' + p.name + ' 断粮溃散');
      }
    } else {
      a.starved = false;
    }
  }

  function settleWar() {
    if (!state.world) return;
    var ids = armyIds(), i;
    /* ⓪ 征兵队列推进 + 粮食补给 */
    recruitTick();
    ids = armyIds();
    for (i = 0; i < ids.length; i++) feedArmy(ARMY[ids[i]]);

    /* ① 敌国动员（每 3 回合） */
    if (turnNo % AO.RECRUIT.aiEvery === 0) aiDefend();

    /* ② 行军 / 轰击 / 封锁 / 运输。
     * from 记下"这一回合从哪个省出发"—— 用来处理交叉行军（见 resolveCrossings）。 */
    ids = armyIds();
    for (i = 0; i < ids.length; i++) {
      var a = ARMY[ids[i]];
      if (!a) continue;
      a.from = a.pid;
      stepArmy(a);
    }
    /* ②b 交叉行军：同样的行军速度 + "就近打对面"，两支军队会在同一回合
     *     互换驻地，然后永远擦肩而过 —— 谁也打不着谁（bench 策略 E 抓到的）。
     *     处理方式是把后动的那支按回同一个省，交给会战段去结算。 */
    resolveCrossings();

    /* ③ 会战：同省敌对军队两两结算（一个省最多打一场，打完结余） */
    resolveBattles();

    /* ④ 占领：站在敌省里且没有敌军 → 易主 */
    ids = armyIds();
    for (i = 0; i < ids.length; i++) {
      var b = ARMY[ids[i]];
      if (!b || b.type === 'navy') continue;
      var p = pOf(b.pid);
      if (!p || p.owner === b.owner || !atWar(b.owner, p.owner)) continue;
      var foes = armiesIn(b.pid).filter(function (x) { return x.owner !== b.owner; });
      if (foes.length) continue;
      /* 坚壁清野：城破之前守方的存粮先运走 */
      var sc = armiesIn(b.pid).some(function (x) {
        var tr = genTrait(generalOf(x));
        return tr && tr.cn === '坚壁' && x.order && x.order.tactic === 'scorch';
      });
      if (sc) scorch(b.pid, p.owner);
      var tac = b.order && b.order.tactic;
      occupyProvince(b.pid, b.owner, tac === 'plunder' ? '劫掠' : '攻占');
      if (tac === 'plunder') {
        var tr2 = genTrait(generalOf(b));
        plunder(b.pid, b.owner, tr2 && tr2.fx.plunder ? tr2.fx.plunder : 1);
      }
    }

    /* ⑤ 围城 */
    settleSieges();

    /* ⑥ 投降 */
    checkSurrenders();

    /* ⑦ 清扫：兵没了军就撤编；压制标记与围城标记各清一次 */
    ids = armyIds();
    for (i = 0; i < ids.length; i++) {
      var z = ARMY[ids[i]];
      if (!z) continue;
      if (z.men <= 0) disbandArmy(z.id);
    }
    /* 压制（sup）**不在这里清**：轰击的压制要留给"下一次会战"吃一次，
     * 由 fight() 在算完战力之后清掉（见那里的 consumeSup）。 */
    /* 围城标记：围城军走了就自动解围 */
    for (var sp in SIEGE) {
      var still = armiesIn(+sp).some(function (x) {
        return x.owner === SIEGE[sp].by && x.order &&
          (x.order.type === 'siege' || x.order.tactic === 'siege');
      });
      if (!still) delete SIEGE[sp];
    }
    /* 封锁标记：舰队走了就解除 */
    for (var bp in BLOCKADE) {
      var held = armiesIn(+bp).some(function (x) {
        return x.type === 'navy' && x.owner === BLOCKADE[bp] && x.order && x.order.type === 'blockade';
      });
      if (!held) delete BLOCKADE[bp];
    }

    /* ⑧ 城墙耐久（放在最后：这一回合打没打仗已经知道了） */
    settleWalls();
  }

  /* 走一步命令。返回 true = 版图/军队有变化（让渲染重画）。 */
  function stepArmy(a) {
    var o = a.order;
    if (!o || o.type === 'defend') return false;
    var w = state.world;

    if (o.type === 'train') {
      var tr = genTrait(generalOf(a));
      var rate = 0.02 + ((tr && tr.fx.autoFill) || 0);
      a.men = Math.min(AO.RECRUIT.maxMen, Math.round(a.men * (1 + rate)));
      return false;
    }
    /* 轰击：不移动，对相邻敌省打一轮（不触发会战） */
    if (o.type === 'bombard') {
      var p = pOf(a.pid), it = itemOf(a);
      if (!p || !(it.range > 0)) return false;
      var tgt = 0, foes = 0, i;
      var nb = p.neighbors || [];
      for (i = 0; i < nb.length; i++) {
        var q = pOf(nb[i]);
        if (!q || !atWar(a.owner, q.owner)) continue;
        var list = armiesIn(q.id).filter(function (x) { return x.owner !== a.owner; });
        if (list.length) { tgt = q.id; foes = list.length; break; }
      }
      if (!tgt) {
        /* 没有相邻敌军 → 打城（削弱守备，为攻城做准备：直接扣省人口与粮） */
        return false;
      }
      var dmg = it.siege * (a.men / 1000) * AO.BATTLE.bombardKoef;
      /* 轰击也要看得见目标（v6）：炮弹落在哪儿，地图上就知道到哪儿 */
      see(a.owner, tgt, false);
      /* 记一笔"这回合打过仗"：城墙的回复要跳过它（否则边挨炮边修墙）。
       * 顺带地图上会画一对交叉剑 —— 挨炮的省本来就该有战火标记。 */
      FLASH[tgt] = turnNo;
      var list2 = armiesIn(tgt).filter(function (x) { return x.owner !== a.owner; });
      /* ---- 城墙（第二条接口）：伤害先扣目标省的 hp，扣空了才杀伤 + 压制 ----
       * 削墙量 = 攻城值 × 兵数/1000 × WALL.bombardKoef（点）。这是"远程慢慢磨"，
       * 和会战里一次性砸下的"破城锤"（攻城值合计 ×2）是两条线。
       * 现有杀伤公式**一个字没改**：只是挪到墙塌之后才生效。 */
      var tw = WALL[tgt], wallCut = 0, dead = 0, sup = false;
      if (tw && tw.lv > 0 && tw.hp > 0) {
        var wmax2 = AO.WALL.maxHp(tw.lv);
        var hpDmg = it.siege * (a.men / 1000) * AO.WALL.bombardKoef;
        wallCut = Math.min(tw.hp, hpDmg);
        tw.hp = AO.clamp(tw.hp - wallCut, 0, wmax2);
        var spill = hpDmg > 0 ? (hpDmg - wallCut) / hpDmg : 0;   // 这一炮磨穿了墙，余劲才漏到人身上
        if (spill > 0.001) {
          dead = hurt(list2, Math.round(dmg * 1000 / (it.pow || 1) * spill));
          sup = true;
        }
      } else {
        dead = hurt(list2, Math.round(dmg * 1000 / (it.pow || 1)));
        sup = true;
      }
      if (sup) for (i = 0; i < list2.length; i++) list2[i].sup = true;    // 压制：下回合会战 ×0.8
      var tp = pOf(tgt);
      WARLOG.unshift({ turn: turnNo, cls: 'warn',
        text: '💥 ' + (pOf(a.pid) || {}).name + ' 的' + it.cn + '轰击 ' + (tp ? tp.name : '?') + '：' +
          (wallCut > 0
            ? '城墙 −' + (Math.round(wallCut * 10) / 10) + ' → 剩 ' + Math.round(tw.hp) + '/' + wmax2 +
              (sup ? '，磨穿了：敌军亡 ' + dead + ' 人' : '，墙还没塌，伤不到守军')
            : '敌军亡 ' + dead + ' 人') +
          (sup ? '，压制生效（下回合战力 ×' + AO.BATTLE.suppress + '）' : '') });
      return false;
    }

    /* 舰队 */
    if (a.type === 'navy') {
      if (o.type === 'blockade') {
        if (!o.pid) return false;
        var path = seaPath(a.pid, o.pid);
        if (!path) { return false; }
        if (!path.length) {                       // 已到位：上封锁
          var bp = pOf(o.pid);
          if (bp && atWar(a.owner, bp.owner)) BLOCKADE[o.pid] = a.owner | 0;
          return true;
        }
        moveSteps(a, path, 1);
        return true;
      }
      if (o.type === 'transport') {
        if (!o.pid) return false;
        var path2 = seaPath(a.pid, o.pid);
        if (!path2) { return false; }
        if (!path2.length) {                      // 到岸：卸货成陆军
          if (a.cargo && a.cargo.men > 0) {
            var na = newArmy(a.owner, a.pid, { type: 'army', tier: a.cargo.tier, men: a.cargo.men });
            na.arms = a.cargo.arms || 'inf';
            WARLOG.unshift({ turn: turnNo, cls: 'ok',
              text: '⛵ 舰队在 ' + (pOf(a.pid) || {}).name + ' 卸下 ' + a.cargo.men + ' 人' });
            a.cargo = null;
            a.order = { type: 'defend', cid: a.owner, pid: a.pid, tactic: 'assault' };
          }
          return true;
        }
        moveSteps(a, path2, 1);
        return true;
      }
      return false;
    }

    /* 陆军：进攻 / 围城 */
    if (o.type === 'attack' || o.type === 'siege') {
      var tpid = o.pid;
      if (!tpid) return false;
      var tp2 = pOf(tpid);
      if (!tp2 || tp2.owner === a.owner || !atWar(a.owner, tp2.owner)) {
        /* 目标没了（被友军拿下 / 停战了）→ 自动找同国最近的省 */
        var alt = autoTarget(a, o.cid);
        if (!alt) { a.order = { type: 'defend', cid: a.owner, pid: a.pid, tactic: 'assault' }; return false; }
        o.pid = alt; tpid = alt;
      }
      var tr2 = genTrait(generalOf(a));
      var steps = (tr2 && tr2.fx.move) ? tr2.fx.move : 1;
      var path3 = landPath(a.pid, tpid, a.owner);
      if (!path3) {
        if (!a.noPathNote) {
          a.noPathNote = true;
          WARLOG.unshift({ turn: turnNo, cls: 'warn',
            text: '⚠ ' + ownerName(a.owner) + ' 一支军无路可走（' +
              (pOf(a.pid) || {}).name + ' → ' + (tp2 ? tp2.name : '?') + '）：陆军不会游泳，隔着海要舰队运' });
        }
        return false;
      }
      a.noPathNote = false;
      /* 围城 = 进攻 + 围城战术（⑤ 的战术表里没有"围城"这个命令，只有这条战术）。
       * 走到目标省就地扎营，不主动进攻 —— 见 resolveBattles 的排除规则。 */
      if (o.type === 'siege' || o.tactic === 'siege') {
        moveSteps(a, path3, steps);
        if (a.pid === tpid && SIEGE[tpid] === undefined) {
          SIEGE[tpid] = { by: a.owner | 0 };
          WARLOG.unshift({ turn: turnNo, cls: 'warn',
            text: '🏯 ' + (pOf(tpid) || {}).name + ' 被围：产出归零，守军开始吃存粮' });
        }
        return true;
      }
      moveSteps(a, path3, steps);
      return true;
    }
    return false;
  }
  /* 目标省已经不是敌国了：自动改成该国最近的边境省 */
  function autoTarget(a, cid) {
    var c = coOf(cid);
    if (!c || !c.provinces.length) return 0;
    var best = 0, bestD = Infinity, me = pOf(a.pid);
    if (!me) return 0;
    for (var i = 0; i < c.provinces.length; i++) {
      var q = pOf(c.provinces[i]);
      if (!q) continue;
      var dx = q.centroid[0] - me.centroid[0], dy = q.centroid[1] - me.centroid[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = q.id; }
    }
    return best;
  }

  /* 交叉行军：A 从 X 走到 Y、B 从 Y 走到 X（且两国在交战）→ 视为在 Y 相遇。
   * 只把 B 按回 Y，两边就同省了，会战段照常跑；谁退谁留由会战决定。 */
  function resolveCrossings() {
    var ids = armyIds(), i, j;
    for (i = 0; i < ids.length; i++) {
      var a = ARMY[ids[i]];
      if (!a || a.from === undefined || a.from === a.pid) continue;
      for (j = 0; j < ids.length; j++) {
        var b = ARMY[ids[j]];
        if (!b || b === a) continue;
        if (b.from === a.pid && b.pid === a.from && atWar(a.owner, b.owner)) {
          b.pid = a.pid;
          b.from = a.pid;                 // 标记已处理，避免来回按
        }
      }
    }
  }

  /* 会战结算：逐省检查。守方 = 该省的主人（如果他在场），攻方 = 其他交战方。 */
  function resolveBattles() {
    var ids = armyIds(), byPid = Object.create(null), i;
    for (i = 0; i < ids.length; i++) {
      var a = ARMY[ids[i]];
      if (!a) continue;
      (byPid[a.pid] || (byPid[a.pid] = [])).push(a);
    }
    for (var pid in byPid) {
      var list = byPid[pid], p = pOf(+pid);
      if (!p || list.length < 2) continue;
      var groups = Object.create(null), owners = [];
      for (i = 0; i < list.length; i++) {
        var o = list[i].owner;
        if (!groups[o]) { groups[o] = []; owners.push(o); }
        groups[o].push(list[i]);
      }
      if (owners.length < 2) continue;
      /* 守方：省的主人（在场时）；否则人最多的一方 */
      var defOwner = groups[p.owner] ? p.owner : 0;
      if (!defOwner) {
        var best = 0, bestN = -1;
        for (i = 0; i < owners.length; i++) {
          var n2 = sumMen(groups[owners[i]]);
          if (n2 > bestN) { bestN = n2; best = owners[i]; }
        }
        defOwner = best;
      }
      /* 攻方：所有跟守方交战的其他方（同国合并） */
      var atk = [], anyAtk = false;
      for (i = 0; i < owners.length; i++) {
        var ow = owners[i];
        if (ow === defOwner) continue;
        if (!atWar(ow, defOwner) && !atWar(ow, p.owner)) continue;
        atk = atk.concat(groups[ow]);
        anyAtk = true;
      }
      if (!anyAtk) continue;
      /* 围城军不算"进攻"：只有围城军在，就让围城段去饿死守军 */
      var realAtk = atk.filter(function (x) {
        if (!x.order) return true;
        return x.order.type !== 'siege' && x.order.tactic !== 'siege';
      });
      if (!realAtk.length) continue;
      fight(realAtk, groups[defOwner], p, {});
    }
  }

  /* ---------------- 十四、宣战 / 停战 ---------------- */
  function declareWar(a, b) {
    if (!a || !b || a === b) return { ok: false, msg: '不能对自己宣战' };
    if (countryDead(a) || countryDead(b)) return { ok: false, msg: '对方已经灭亡了' };
    var k = warKey(a, b);
    if (WARSET[k]) return { ok: false, msg: '已经在交战' };
    WARSET[k] = true;
    warBaseOf(a, b);
    /* 宣战把关系打到谷底（v6）：交战国边境立刻降级为 seen/unknown ——
     * 昨天还能看见的邻居，今天隔着一道战线 */
    setRel(a, b, FOG.relWar);
    var ca = coOf(a), cb = coOf(b);
    var txt = '📜 ' + (ca ? ca.name : '?') + ' 向 ' + (cb ? cb.name : '?') + ' 宣战';
    WARLOG.unshift({ turn: turnNo, cls: 'bad', text: txt });
    NOTES.push({ owner: PLAYER || a, cls: 'warn', text: txt });
    /* 宣战后给双方边境军一个默认命令：不然刚宣战谁都不动，玩家会以为没生效 */
    return { ok: true, msg: txt };
  }
  function makePeace(a, b) {
    var k = warKey(a, b);
    if (!WARSET[k]) return { ok: false, msg: '本来就没打' };
    delete WARSET[k];
    /* 停战只是"不打了"，不是"和好"（v6）：REL 停在 −30，边境依然看不透 */
    setRel(a, b, FOG.relPeace);
    /* 停战：围城解除、封锁解除、军队原地驻防（打完的仗不能白打，占领省不还） */
    for (var pid in SIEGE) if (SIEGE[pid].by === a || SIEGE[pid].by === b) delete SIEGE[pid];
    for (var bp in BLOCKADE) if (BLOCKADE[bp] === a || BLOCKADE[bp] === b) delete BLOCKADE[bp];
    var ids = armyIds(), i;
    for (i = 0; i < ids.length; i++) {
      var ar = ARMY[ids[i]];
      if (!ar) continue;
      if ((ar.owner === a || ar.owner === b) && ar.order && (ar.order.type === 'attack' || ar.order.type === 'siege')) {
        ar.order = { type: 'defend', cid: ar.owner, pid: ar.pid, tactic: 'assault' };
      }
    }
    var ca = coOf(a), cb = coOf(b);
    var txt = '🕊 ' + (ca ? ca.name : '?') + ' 与 ' + (cb ? cb.name : '?') + ' 停战';
    WARLOG.unshift({ turn: turnNo, cls: 'ok', text: txt });
    return { ok: true, msg: txt };
  }

  /* ---------------- 十五、选国 / 退出 ---------------- */
  /* 选国：只写 PLAYER，别的什么都不动 —— 世界是同一个世界，
   * 变的只是"哪些东西你现在能按"。这也让「退出游戏」变成一行赋值。 */
  function choosePlayer(cid) {
    var c = coOf(cid);
    if (!c) return { ok: false, msg: '没有这个国家' };
    PLAYER = cid | 0;
    /* 开局迷雾（v6）：自国全探 + 实时，其余全 blank ——
     * 「选国」就是"把眼睛安在这个国家身上"，地图随之重画。
     * 预算档回到「无」：情报署要不要开、开几档，是玩家自己的第一笔决策。 */
    INTELB[PLAYER] = 0;
    initFogForPlayer(PLAYER);
    if (state.renderer) state.renderer.fogRefresh();
    if (state.renderer) {
      state.renderer.selectCountry(PLAYER);
      centerOnCountry(PLAYER);
    }
    /* 视角切到"我的国"：省卡/国家卡都跟着走 */
    var txt = '开始游戏：你是 ' + c.name + '（#' + c.id + '）。别国的按钮一律置灰，『退出游戏』回工坊模式。';
    toast(txt, 4200);
    if (GP.open) renderGovPanel();
    if ($('country').classList.contains('on')) showCountry(PLAYER);
    refreshLocks();
    saveGame(true);
    return { ok: true, msg: txt };
  }
  function exitGame() {
    PLAYER = 0;
    /* 回到上帝工坊 = 摘掉眼睛：迷雾整层失效（地图恢复全知），
     * 相关表一并清空 —— 免得下一次选国时读出上一局的地图 */
    fogClear();
    if (state.renderer) state.renderer.fogRefresh();
    toast('已退出游戏 —— 回到上帝工坊：所有国家的按钮都能按了', 3200);
    if (GP.open) renderGovPanel();
    refreshLocks();
    saveGame(true);
    return { ok: true };
  }
  /* 锁权刷新：面板/卡片是每次重画新建的，所以"改 PLAYER 之后"只要重画一次。
   * 顶栏那颗按钮的文字也跟着变（开始游戏 / 退出游戏）。 */
  function refreshLocks() {
    var b = $('playBtn');
    if (b) {
      var c = coOf(PLAYER);
      b.textContent = PLAYER ? ('退出游戏 · ' + (c ? c.name : '')) : '开始游戏';
      b.title = PLAYER ? '退出游戏：回到上帝工坊模式（所有国家都能操作）'
        : '选一个国家开始游戏：别国的省卡与面板会置灰，你只能操作自己的国';
    }
    var pid = state.renderer ? state.renderer.selected : 0;
    if (pid) {
      var p = pOf(pid);
      if (p) {
        if (fogOn() && visCode(pid) !== VIS_REAL) showInfo(pid);
        else renderInfoLists(p);
      }
    }
    if ($('country').classList.contains('on') && state.renderer && state.renderer.selectedCountry) {
      showCountry(state.renderer.selectedCountry);
    }
    if (state.renderer) state.renderer.requestDraw();
  }

  /* ---------------- 十六、地图上的战争层（军旗 / 占领斜线 / 战火） ---------------- */
  /* 画在每帧 overlay 里（不是缓存底图）：军旗会随回合动，烘进底图就要每次重烘全图。 */
  function invalidateGeo() {
    if (!state.renderer) return;
    state.renderer._buildGeometry();
    state.renderer._needBase = true;
    state.renderer.requestDraw();
  }
  var FLASH = Object.create(null);     // pid → turnNo（这一回合打过仗的省）
  AO.drawWarLayer = function (ctx, rndr) {
    var s = rndr.cam.scale, w = state.world;
    if (!w) return;
    var i, pid;
    /* 占领斜线：只在放大到能看清的时候画（远景铺满斜线会糊成一张网） */
    if (s >= 0.85) {
      ctx.save();
      ctx.lineWidth = Math.max(0.7 / s, 0.2);
      ctx.strokeStyle = 'rgba(176,73,47,0.42)';
      for (pid in OCCUPY) {
        var p = pOf(pid);
        if (!p) continue;
        /* 迷雾：没测绘过的地方连"被占领了"都不该露出斜线 */
        if (fogOn() && visCode(p.id) === VIS_UNKNOWN) continue;
        var path = rndr._provPath(p.id);
        if (!path) continue;
        ctx.save();
        ctx.clip(path);
        var bb = p.centroid, span = 26;
        ctx.beginPath();
        for (var d = -span; d <= span; d += 7) {
          ctx.moveTo(bb[0] - span + d, bb[1] - span);
          ctx.lineTo(bb[0] + span + d, bb[1] + span);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    /* 城墙角标：有墙的省在质心右上方画一座小堡（城墙身 + 三个雉堞）。
     * 画在 overlay 而不是底图里：耐久每回合都在变，烘进底图就得每回合重烘全图。
     * 迷雾：没测绘过的省不画（和占领斜线、战火标记同一条规则）。
     * 欠费失修的墙用砖红画 —— 一眼看出"这面墙没人管了"。 */
    if (s >= 0.6) {
      ctx.save();
      for (pid in WALL) {
        var wq = WALL[pid];
        if (!wq || !(wq.lv > 0)) continue;
        var wp = pOf(pid);
        if (!wp) continue;
        if (fogOn() && visCode(wp.id) === VIS_UNKNOWN) continue;
        var wcx = wp.centroid[0] + AO.clamp(10 / s, 3, 14);
        var wcy = wp.centroid[1] - AO.clamp(10 / s, 3, 14);
        var wr = AO.clamp(4.6 / s, 1, 7);
        ctx.lineWidth = Math.max(1 / s, 0.25);
        ctx.strokeStyle = 'rgba(43,50,56,0.82)';
        ctx.fillStyle = wq.halted ? 'rgba(176,73,47,0.86)' : 'rgba(216,206,186,0.96)';
        ctx.beginPath();
        ctx.rect(wcx - wr, wcy - wr * 0.5, wr * 2, wr * 1.3);
        ctx.fill();
        ctx.stroke();
        for (var mi = 0; mi < 3; mi++) {
          var mmx = wcx - wr + wr * (0.12 + mi * 0.62);
          ctx.beginPath();
          ctx.rect(mmx, wcy - wr * 1.1, wr * 0.46, wr * 0.62);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    /* 军旗：国家色小旗 + 兵数（放大到 1.2 才写数字，远景只留旗） */
    var ids = armyIds();
    for (i = 0; i < ids.length; i++) {
      var a = ARMY[ids[i]];
      if (!a) continue;
      var pr = pOf(a.pid);
      if (!pr) continue;
      /* 迷雾（v6）：别国军队只在**实时**省里画旗。
       * 已探但不在跟前的地方，只能看到 LASTSEEN 里的"据报驻军约 N"。 */
      if (PLAYER && a.owner !== PLAYER && visCode(a.pid) !== VIS_REAL) continue;
      var c = coOf(a.owner);
      var col = c ? c.color : '#888';
      var cx = pr.centroid[0], cy = pr.centroid[1];
      /* 同一省多军：左右错开，免得叠成一面旗 */
      var same = armiesIn(a.pid), k = same.indexOf(a);
      var off = (k - (same.length - 1) / 2) * 7 / s;
      cx += off;
      var h = AO.clamp(7 / s, 0.5, 14);
      ctx.lineWidth = Math.max(0.9 / s, 0.25);
      ctx.strokeStyle = '#2b3238';
      ctx.beginPath();
      ctx.moveTo(cx, cy + h * 0.55);
      ctx.lineTo(cx, cy - h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - h);
      var fw = h * 0.82;
      if (a.type === 'navy') {
        /* 舰队：三角旗（和陆军方旗区分开） */
        ctx.lineTo(cx + fw, cy - h * 0.78);
        ctx.lineTo(cx, cy - h * 0.55);
      } else {
        ctx.lineTo(cx + fw, cy - h * 0.94);
        ctx.lineTo(cx + fw, cy - h * 0.62);
        ctx.lineTo(cx, cy - h * 0.55);
      }
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.stroke();
      /* 占领军：旗上点一个小红点（"这是打下来的地方"） */
      if (OCCUPY[a.pid]) {
        ctx.beginPath();
        ctx.arc(cx + fw * 0.4, cy - h * 0.78, Math.max(1.1 / s, 0.3), 0, Math.PI * 2);
        ctx.fillStyle = '#b0492f';
        ctx.fill();
      }
      if (s >= 1.2) {
        ctx.font = '600 ' + AO.clamp(9 / s, 2.4, 12) + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(30,38,44,0.92)';
        var label = (a.men >= 1000 ? (a.men / 1000).toFixed(a.men % 1000 ? 1 : 0) + 'k' : a.men) +
          (a.type === 'navy' ? '⚓' : '');
        ctx.fillText(label, cx + fw * 0.5, cy + h * 0.6);
      }
    }
    /* 已探省的"据报驻军"：**不画旗**，只写一行约数。
     * 情报的体感就在这里 —— 同一块地方，实时省看得见旗和兵数，
     * 泛黄省只写"据报约 3k"，而那个数字可能已经过时了。 */
    if (fogOn() && s >= 1.2) {
      var EE = EXPLORED[PLAYER] || {};
      ctx.font = '600 ' + AO.clamp(9 / s, 2.4, 11) + 'px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (pid in EE) {
        if (visCode(pid) !== VIS_SEEN) continue;
        var rr = LASTSEEN[PLAYER + '|' + pid];
        if (!rr || !rr.tr) continue;
        var sp2 = pOf(pid);
        if (!sp2) continue;
        var tx = sp2.centroid[0], ty = sp2.centroid[1] - AO.clamp(15 / s, 3, 14);
        var txt2 = '据报 ' + (rr.tr >= 1000 ? (rr.tr / 1000).toFixed(rr.tr % 1000 ? 1 : 0) + 'k' : rr.tr);
        ctx.lineWidth = Math.max(2 / s, 0.4);
        ctx.strokeStyle = 'rgba(250,247,240,0.85)';
        ctx.strokeText(txt2, tx, ty);
        ctx.fillStyle = 'rgba(92,74,36,0.92)';
        ctx.fillText(txt2, tx, ty);
      }
    }
    /* 战火标记：这一回合打过仗的省，画一对交叉剑的简写（×） */
    for (pid in FLASH) {
      if (FLASH[pid] !== turnNo) continue;
      var fp = pOf(pid);
      if (!fp) continue;
      if (fogOn() && visCode(fp.id) === VIS_UNKNOWN) continue;
      var fx = fp.centroid[0], fy = fp.centroid[1] - 10 / s;
      var r2 = AO.clamp(3.4 / s, 0.6, 6);
      ctx.beginPath();
      ctx.moveTo(fx - r2, fy - r2); ctx.lineTo(fx + r2, fy + r2);
      ctx.moveTo(fx + r2, fy - r2); ctx.lineTo(fx - r2, fy + r2);
      ctx.strokeStyle = 'rgba(176,73,47,0.85)';
      ctx.lineWidth = Math.max(1.2 / s, 0.3);
      ctx.stroke();
    }
    /* 转教中的省：信仰视图上画一个小十字 + 光环（B4 占位标记）。
     * 画在 overlay 而不是底图里 —— 传教每回合都在动，烘进底图就得每回合重烘全图。
     * 位置**抬到省名上方**：省名正好压在质心上，画在质心会被标签整个盖住。 */
    if (rndr.viewMode === 'faith' && AO.resMission) {
      var M = AO.resMission;
      for (pid in M) {
        var mp = pOf(pid);
        if (!mp) continue;
        var rr = AO.clamp(5.5 / s, 1.3, 9);
        var mx = mp.centroid[0];
        var my = mp.centroid[1] - AO.clamp(22 / s, 3, 60);   // 让开省名那两行
        ctx.save();
        /* 底片：奶油色实心圆 —— 深色信仰块上白十字、浅色块上也不糊 */
        ctx.beginPath();
        ctx.arc(mx, my, rr * 1.15, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(253,250,242,0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(201,168,111,0.95)';
        ctx.lineWidth = Math.max(1.2 / s, 0.32);
        ctx.stroke();
        /* 十字：竖长横短，像教堂尖顶上的那一个 */
        ctx.beginPath();
        ctx.moveTo(mx, my - rr * 0.72); ctx.lineTo(mx, my + rr * 0.72);
        ctx.moveTo(mx - rr * 0.42, my - rr * 0.2); ctx.lineTo(mx + rr * 0.42, my - rr * 0.2);
        ctx.strokeStyle = 'rgba(138,109,52,0.95)';
        ctx.lineWidth = Math.max(1.5 / s, 0.4);
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }
    }
  };


  /* =============================================================
   * 十八、战争迷雾 + 情报署（v6）
   *
   * 一句话原则：**迷雾只遮"你现在知道什么"，不遮"世界怎么运转"**。
   * 版图、资源、军队、AI 决策全部照旧按真实数据跑；这一层只决定
   *   ① 地图上哪块地方露纸纹（unknown）、哪块地方泛黄（seen 且旧）；
   *   ② 省卡 / 国家卡能给你看多少字段（遮蔽是接口层的事，和 canAct 权限无关）。
   *
   * 三态（visOf）：
   *   realtime  自己的省 / 本国军队脚下的省 / 非交战且 REL≥0 的邻省
   *   seen      探过（EXPLORED 里有），但不在跟前 —— 按 LASTSEEN 快照渲染
   *   unknown   从没探过 —— 只露纸纹
   *
   * 探索的三条来源：军队踏过（行军落省打点）、贴脸事件（会战/围城/轰击/占领）、
   * 情报署自动织网。前两条是"免费但慢"，第三条要花钱 —— 这就是预算三档的全部意义。
   *
   * 反谍不另开系统：**同一笔预算**就是反谍等级。别人对你下手时，
   * 按你的 INTELB 档掷暴露概率（0 / 15% / 30%）；你抓到他，双方各留一条纪要。
   * ============================================================= */
  var FOG = AO.INTEL;

  function fogOn() { return PLAYER > 0 && !!state.world; }
  /* 迷雾版本号：渲染层拿它做缓存键（建 Path2D 很贵，只在真的变了时重建）。
   * 任何"可见性可能变了"的操作都要走 fogInvalidate —— 它顺手把版本 +1。 */
  var FOGVER = 0;
  function fogInvalidate() {
    VIS.dirty = true;
    FOGSTAT = null;
    FOGVER++;
  }
  /* 玩家视角的三态（数值版，渲染层用；热路径上比字符串便宜） */
  function visCode(pid) {
    if (!fogOn()) return VIS_REAL;
    var n = state.world.provinces.length;
    if (VIS.dirty || !VIS.arr || VIS.n !== n) rebuildVis();
    var v = VIS.arr[pid | 0];
    return v === undefined ? VIS_UNKNOWN : v;
  }
  function visName(v) { return v === VIS_REAL ? 'realtime' : v === VIS_SEEN ? 'seen' : 'unknown'; }
  function visOf(pid) { return visName(visCode(pid)); }

  /* 重建可见性表：一次扫全图，只在迷雾可能变化时跑（每回合一次 + 探索/REL 变动）
   *
   * 判定顺序（**顺序本身就是规则**，别随手交换）：
   *   ① 自己的省                     → 实时
   *   ② 本国军队脚下的省             → 实时（围城 / 交战 / 驻军，贴脸必然看得见）
   *   ③ 没探过                       → unknown（哪怕就贴着边境）
   *   ④ 交界 + 非交战 + REL≥0        → 实时（"邻居家的近况"）
   *   ⑤ 其余探过的                   → seen（LASTSEEN 快照，越旧越黄）
   *
   * ③ 排在 ④ 前面是**故意的**：开局只有自国可见，其余全是空白羊皮纸。
   * 邻省要"先探过"才谈得上实时 —— 否则选完国就能看到一圈邻国，
   * 「战争迷雾」第一分钟就漏了。 */
  function rebuildVis() {
    var w = state.world;
    VIS.dirty = false;
    if (!w) { VIS.arr = null; VIS.n = 0; return; }
    var n = w.provinces.length, i;
    var arr = new Uint8Array(n + 1);
    VIS.arr = arr; VIS.n = n;
    if (!fogOn()) { for (i = 1; i <= n; i++) arr[i] = VIS_REAL; return; }
    var E = EXPLORED[PLAYER] || {};
    var border = Object.create(null);      // 与自国交界的省
    /* ① 自己的省 */
    for (i = 0; i < n; i++) {
      var p = w.provinces[i];
      if (p && p.owner === PLAYER) {
        arr[p.id] = VIS_REAL;
        var nb = p.neighbors || [];
        for (var j = 0; j < nb.length; j++) {
          var q = w.provinces[nb[j] - 1];
          if (q && q.owner !== PLAYER) border[q.id] = 1;
        }
      }
    }
    /* ② 本国军队脚下的省 */
    for (var aid in ARMY) {
      var a = ARMY[aid];
      if (a && a.owner === PLAYER && a.pid > 0) arr[a.pid] = VIS_REAL;
    }
    /* ③④⑤ 其余逐省判定 */
    for (i = 0; i < n; i++) {
      var p2 = w.provinces[i];
      if (!p2 || arr[p2.id]) continue;
      if (!E[p2.id]) { arr[p2.id] = VIS_UNKNOWN; continue; }
      if (border[p2.id] && !atWar(PLAYER, p2.owner) &&
          relOf(PLAYER, p2.owner) >= FOG.relFriend) {
        arr[p2.id] = VIS_REAL;
      } else {
        arr[p2.id] = VIS_SEEN;
      }
    }
  }

  /* ---------------- 关系值（极简外交） ---------------- */
  function relOf(a, b) {
    a = a | 0; b = b | 0;
    if (!a || !b || a === b) return 0;
    var v = REL[warKey(a, b)];
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }
  function setRel(a, b, v) {
    if (!a || !b || a === b) return;
    REL[warKey(a, b)] = Math.max(-100, Math.min(100, Math.round(v)));
    fogInvalidate();
  }
  function addRel(a, b, d) { setRel(a, b, relOf(a, b) + d); }

  /* 生成时：每对国家 0 ± relInit（关系是"这一局"的事，换世界必须重掷） */
  function initRel(w) {
    for (var k in REL) delete REL[k];
    if (!w) return;
    var cs = w.countries, i, j;
    for (i = 0; i < cs.length; i++) {
      for (j = i + 1; j < cs.length; j++) {
        if (!cs[i] || !cs[j]) continue;
        REL[warKey(cs[i].id, cs[j].id)] =
          Math.round((Math.random() * 2 - 1) * FOG.relInit);
      }
    }
    fogInvalidate();
  }
  /* 老档没有 REL：补一张全 0 的表（0 = 中立，邻省照常可见） */
  function ensureRel(w) {
    if (!w) return;
    var cs = w.countries, i, j;
    for (i = 0; i < cs.length; i++) {
      for (j = i + 1; j < cs.length; j++) {
        if (!cs[i] || !cs[j]) continue;
        var k = warKey(cs[i].id, cs[j].id);
        if (REL[k] === undefined) REL[k] = 0;
      }
    }
    fogInvalidate();
  }

  /* ---------------- 预算档 ---------------- */
  function budgetOf(owner) {
    var b = INTELB[owner];
    return (b === 1 || b === 2) ? b : 0;
  }
  function ensureFlowC(owner) {
    var F = FLOWC[owner];
    if (!F) {
      F = FLOWC[owner] = {
        gain: Object.create(null), loss: Object.create(null),
        d: { eat: Object.create(null), tax: Object.create(null),
             maint: Object.create(null), maintC: Object.create(null) }
      };
    }
    if (!F.d) F.d = { eat: Object.create(null), tax: Object.create(null),
                       maint: Object.create(null), maintC: Object.create(null) };
    return F;
  }
  /* 扣情报经费：扣得起返回实际档位，扣不起返回 0（= 本回合按无档算，即"断供自动降档"） */
  function intelPay(owner) {
    var b = budgetOf(owner);
    if (!b) return 0;
    var cost = FOG.cost[b];
    var cen = ensureCentral(owner);
    /* AI 要给自己留一条维护底线，否则它的建筑会集体停产（见 AO.INTEL.aiReserve）。
     * 玩家没有这条线 —— 国库见底就是见底，情报署停摆自己认。 */
    var need = cost + (owner === PLAYER ? 0 : (FOG.aiReserve || 0));
    if ((cen.gold || 0) < need) {
      if (owner === PLAYER) {
        NOTES.push({ owner: owner, cls: 'warn',
          text: '🕵 情报署欠费：国库金不够 ' + cost + ' 金，本回合按「无」档停摆' });
      }
      return 0;
    }
    cen.gold -= cost;
    var F = ensureFlowC(owner);
    F.loss.gold = (F.loss.gold || 0) + cost;
    F.d.intel = (F.d.intel || 0) + cost;
    return b;
  }

  /* ---------------- 探索：看见并记下来 ----------------
   * deep=true 才写建筑摘要与驻军约数（重金情报 / 自己的省）。
   * 旧的深度快照在同归属时保留（bt 记它自己的回合），免得一次路过就把细节洗掉。 */
  function bldSummary(pid) {
    var bag = SIM[pid], cnt = Object.create(null), order = [], key, i;
    if (bag) {
      for (key in bag) {
        var s = bag[key], def = AO.RESOURCE_BY_KEY[key];
        if (!def || !s) continue;
        var nm = def.build || def.cn;
        if (s.built > 0) {
          if (cnt[nm] === undefined) order.push(nm);
          cnt[nm] = (cnt[nm] || 0) + s.built;
        }
        if (s.site > 0) {
          var sn = nm + '（在建）';
          if (cnt[sn] === undefined) order.push(sn);
          cnt[sn] = (cnt[sn] || 0) + 1;
        }
      }
    }
    for (i = 0; i < UNIV_KINDS.length; i++) {
      var st = UNIV[UNIV_KINDS[i]][pid];
      if (st && st.n > 0) {
        var un = univDef(UNIV_KINDS[i]).cn;
        if (cnt[un] === undefined) order.push(un);
        cnt[un] = (cnt[un] || 0) + st.n;
      }
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      out.push(order[i] + (cnt[order[i]] > 1 ? '×' + cnt[order[i]] : ''));
    }
    return out.slice(0, 8);
  }
  function troopEstimate(pid) {
    var list = armiesIn(pid), men = 0, i;
    for (i = 0; i < list.length; i++) men += list[i].men || 0;
    if (!men) return 0;
    /* 约数：500 人一档 —— 情报给的是"约 3200"，不是"3217" */
    return Math.max(500, Math.round(men / 500) * 500);
  }
  function see(owner, pid, deep) {
    owner = owner | 0; pid = pid | 0;
    if (!owner || !pid || !state.world) return;
    var p = pOf(pid);
    if (!p) return;
    if (owner === PLAYER) {
      var E = EXPLORED[owner] || (EXPLORED[owner] = Object.create(null));
      var isNew = !E[pid];
      E[pid] = 1;
      var key = owner + '|' + pid, old = LASTSEEN[key];
      var rec = { t: turnNo, o: p.owner | 0 };
      if (deep) {
        rec.b = bldSummary(pid);
        rec.tr = troopEstimate(pid);
        rec.bt = turnNo;
      } else if (old && old.o === (p.owner | 0) && old.b) {
        /* 同归属：旧的详查结果还成立，留着并记下它自己的日期 */
        rec.b = old.b; rec.tr = old.tr; rec.bt = old.bt || old.t;
      }
      LASTSEEN[key] = rec;
      if (isNew) fogInvalidate();
      else if (!VIS.dirty) fogInvalidate();   // 时间戳变了 → 泛黄分档可能变
    } else if (owner > 0) {
      /* AI 的认知：只记"哪一回合见过"，不记明细（AI 决策 v1 不消费迷雾） */
      var A = AIKNOW[owner] || (AIKNOW[owner] = Object.create(null));
      A[pid] = turnNo;
    }
  }
  function lastSeenOf(pid) {
    if (!PLAYER) return null;
    return LASTSEEN[PLAYER + '|' + (pid | 0)] || null;
  }
  function staleOf(pid) {
    var r = lastSeenOf(pid);
    if (!r) return 9999;
    return Math.max(0, turnNo - (r.t || turnNo));
  }
  /* 泛黄档：0 微黄 / 1 中黄 / 2 深黄 */
  function staleBucket(pid) {
    var n = staleOf(pid);
    return n < FOG.staleMid ? 0 : n < FOG.staleOld ? 1 : 2;
  }
  function staleAlphaOf(pid) { return FOG.yellow[staleBucket(pid)]; }

  /* ---------------- 选国 / 换世界时的初始化 ---------------- */
  function fogClear() {
    var k;
    for (k in EXPLORED) delete EXPLORED[k];
    for (k in LASTSEEN) delete LASTSEEN[k];
    for (k in INTELB) delete INTELB[k];
    for (k in PROBE_CD) delete PROBE_CD[k];
    for (k in AIKNOW) delete AIKNOW[k];
    for (k in AUTOT) delete AUTOT[k];
    for (k in INTELMSG) delete INTELMSG[k];
    fogInvalidate();
  }
  /* AI 的预算档：生成时掷一次（无 30% / 常规 50% / 重金 20%） */
  function rollAiBudgets(w) {
    if (!w) return;
    var W = FOG.aiBudgetW, tot = W[0] + W[1] + W[2], i, k;
    for (k in AIKNOW) delete AIKNOW[k];
    for (k in AUTOT) delete AUTOT[k];
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === PLAYER) continue;
      var r = Math.random() * tot, lv = 0;
      if (r >= W[0]) lv = 1;
      if (r >= W[0] + W[1]) lv = 2;
      INTELB[c.id] = lv;
      /* AI 的初始认知：自己的省 + 一圈邻省（"邻居总归听说过"） */
      var A = AIKNOW[c.id] = Object.create(null);
      for (var pi = 0; pi < c.provinces.length; pi++) {
        var pid = c.provinces[pi];
        A[pid] = turnNo;
        var nb = (pOf(pid) || {}).neighbors || [];
        for (var j = 0; j < nb.length; j++) A[nb[j]] = turnNo;
      }
    }
  }
  /* 玩家开局：自国全探 + 实时，其余全 unknown */
  function initFogForPlayer(cid) {
    if (!state.world) return;
    var c = coOf(cid);
    if (!c) return;
    for (var k in LASTSEEN) delete LASTSEEN[k];
    var E = EXPLORED[cid] = Object.create(null);
    for (var i = 0; i < c.provinces.length; i++) {
      var pid = c.provinces[i], p = pOf(pid);
      if (!p) continue;
      E[pid] = 1;
      LASTSEEN[cid + '|' + pid] = { t: turnNo, o: p.owner, b: bldSummary(pid),
        tr: troopEstimate(pid), bt: turnNo };
    }
    if (INTELB[cid] === undefined) INTELB[cid] = 0;
    fogInvalidate();
  }

  /* ---------------- 已探统计（国家卡 / 情报面板共用） ---------------- */
  var FOGSTAT = null;                 // { turn, byOwner: {cid:n}, known: [cid] }
  function fogStats() {
    if (FOGSTAT) return FOGSTAT;
    var by = Object.create(null), known = [], adj = Object.create(null);
    var E = PLAYER ? EXPLORED[PLAYER] : null, pid, k;
    if (E) {
      for (pid in E) {
        var p = pOf(pid);
        if (!p) continue;
        var r = LASTSEEN[PLAYER + '|' + pid];
        var o = (r && r.o) || p.owner;
        by[o] = (by[o] || 0) + 1;
        if (p.owner && p.owner !== o) by[p.owner] = (by[p.owner] || 0) + 1;
      }
    }
    /* 接壤的国家"一定知道它存在"（朝廷的邻居不会没人知道），
     * 但它算**未探**：清单里会标"未探"。没有这一条，开局情报署是一张空表 ——
     * 玩家连"把密探派给谁"都选不了，只能先摸着走一回合。 */
    if (PLAYER && state.world) {
      for (var i = 0; i < state.world.provinces.length; i++) {
        var pp = state.world.provinces[i];
        if (!pp || pp.owner !== PLAYER) continue;
        var nb = pp.neighbors || [];
        for (var j = 0; j < nb.length; j++) {
          var q = pOf(nb[j]);
          if (q && q.owner && q.owner !== PLAYER) adj[q.owner] = 1;
        }
      }
    }
    for (k in by) if (+k !== PLAYER && by[k] > 0) known.push(+k);
    known.sort(function (a, b) { return by[b] - by[a]; });
    for (k in adj) if (+k !== PLAYER && by[k] === undefined) known.push(+k);
    FOGSTAT = { turn: turnNo, byOwner: by, known: known, adj: adj };
    return FOGSTAT;
  }
  function exploredCount(cid) { return fogStats().byOwner[cid | 0] || 0; }
  function countryKnown(cid) { return !PLAYER || (cid | 0) === PLAYER || exploredCount(cid) > 0; }
  /* 情报遮蔽档：3 = 全透明（自己的国 / 工坊）；别国 = 自己的预算档 0/1/2。
   * **不要把"3"和"重金档"混起来**：重金买的是"约数与见闻"，不是把别人的国库摊开。 */
  function intelTier(cid) {
    if (!PLAYER || (cid | 0) === PLAYER) return 3;
    return budgetOf(PLAYER);
  }

  /* ---------------- 自动织网 ---------------- */
  /* 已探省按"有多值得刷新"排队：交战国边境 > 边境 > 内陆 */
  function autoPool(owner) {
    var E = EXPLORED[owner], out = [], pid;
    if (!E) return out;
    for (pid in E) {
      var p = pOf(pid);
      if (!p) continue;
      var prio = 0, nb = p.neighbors || [], i;
      for (i = 0; i < nb.length; i++) {
        var q = pOf(nb[i]);
        if (!q) continue;
        if (atWar(owner, q.owner)) { prio = 3; break; }
        if (q.owner !== owner) prio = Math.max(prio, 1);
      }
      out.push({ pid: p.id, prio: prio, jitter: Math.random() });
    }
    out.sort(function (a, b) {
      return (b.prio - a.prio) || (a.jitter - b.jitter);
    });
    return out;
  }
  /* 向未探区伸手：从已探省的边缘往外挑 k 个没探过的邻省 */
  function spreadReveal(owner, k, deep) {
    var E = EXPLORED[owner], cand = [], seenSet = Object.create(null), pid;
    if (!E) return 0;
    for (pid in E) {
      var p = pOf(pid);
      if (!p) continue;
      var nb = p.neighbors || [], i;
      for (i = 0; i < nb.length; i++) {
        var q = pOf(nb[i]);
        if (!q || E[q.id] || seenSet[q.id]) continue;
        seenSet[q.id] = 1;
        cand.push({ pid: q.id, j: Math.random(),
          hot: q.owner && q.owner !== owner ? 1 : 0 });
      }
    }
    cand.sort(function (a, b) { return (b.hot - a.hot) || (a.j - b.j); });
    var n = Math.min(k, cand.length);
    for (var j = 0; j < n; j++) see(owner, cand[j].pid, deep);
    return n;
  }
  function autoWeb(owner, lvl) {
    var every = FOG.autoEvery[lvl], N = FOG.autoN[lvl];
    if (!every || !N) return 0;
    if (turnNo - (AUTOT[owner] || 0) < every) return 0;
    AUTOT[owner] = turnNo;
    var deep = FOG.deep[lvl], pool = autoPool(owner), got = 0, i;
    for (i = 0; i < pool.length && got < N; i++) {
      see(owner, pool[i].pid, deep);
      got++;
    }
    if (lvl >= 2) {
      var extra = FOG.spreadLo + Math.floor(Math.random() * (FOG.spreadHi - FOG.spreadLo + 1));
      got += spreadReveal(owner, extra, true);
    }
    return got;
  }

  /* ---------------- 定向探测：揭示 / 刷新目标国 n 个省 ----------------
   * 顺序：从未探开始（边境与首都圈优先）→ 再刷新已探的。
   * 这样"第一次探一个国家"看得见它的国门，"第二次"才填纵深。 */
  function revealCountry(cid, n, deep) {
    var c = coOf(cid), out = 0;
    if (!c) return 0;
    var capP = pOf(c.capital), list = [], i;
    for (i = 0; i < c.provinces.length; i++) {
      var p = pOf(c.provinces[i]);
      if (!p) continue;
      var isBorder = 0, nb = p.neighbors || [];
      for (var j = 0; j < nb.length; j++) {
        var q = pOf(nb[j]);
        if (q && q.owner !== cid) { isBorder = 1; break; }
      }
      var d = 0;
      if (capP) {
        var dx = p.centroid[0] - capP.centroid[0], dy = p.centroid[1] - capP.centroid[1];
        d = dx * dx + dy * dy;
      }
      var E = EXPLORED[PLAYER] || {};
      list.push({ pid: p.id, un: E[p.id] ? 0 : 1, b: isBorder, d: d, j: Math.random() });
    }
    list.sort(function (x, y) {
      return (y.un - x.un) || (y.b - x.b) || (x.d - y.d) || (x.j - y.j);
    });
    for (i = 0; i < list.length && out < n; i++) { see(PLAYER, list[i].pid, deep); out++; }
    return out;
  }

  /* 手动探测（治理面板）。返回 { ok, caught, got, msg } */
  function probeTarget(cid) {
    cid = cid | 0;
    if (!PLAYER) return { ok: false, msg: '先点顶栏「开始游戏」选一个国家' };
    if (!cid || cid === PLAYER) return { ok: false, msg: '不能探测自己' };
    if (countryDead(cid)) return { ok: false, msg: '这个国家已经不在了' };
    var key = PLAYER + '|' + cid, cd = PROBE_CD[key] | 0;
    if (cd > 0) return { ok: false, msg: '密探还在休整（还要 ' + cd + ' 回合）' };
    var cen = ensureCentral(PLAYER);
    if ((cen.gold || 0) < FOG.probeCost) {
      return { ok: false, msg: '国库金不够（定向探测要 ' + FOG.probeCost + ' 金）' };
    }
    cen.gold -= FOG.probeCost;
    var F = ensureFlowC(PLAYER);
    F.loss.gold = (F.loss.gold || 0) + FOG.probeCost;
    F.d.intel = (F.d.intel || 0) + FOG.probeCost;
    PROBE_CD[key] = FOG.probeCd;
    var b = budgetOf(PLAYER), tc = budgetOf(cid), name = ownerName(cid);
    /* 暴露 roll：按**目标国**的反谍等级（同一档预算养着反谍） */
    var caught = Math.random() < FOG.exposeP[tc];
    var rec, msg;
    if (caught) {
      addRel(PLAYER, cid, FOG.relProbe);
      msg = '密探在' + name + '暴露：颗粒无收，关系 −' + Math.abs(FOG.relProbe);
      rec = { turn: turnNo, ok: false, text: msg };
      NOTES.push({ owner: PLAYER, cls: 'warn', text: '🕵 ' + msg });
      NOTES.push({ owner: cid, cls: 'warn',
        text: '🕵 抓获 ' + ownerName(PLAYER) + ' 密探（关系 −' + Math.abs(FOG.relProbe) + '）' });
      toast('🕵 ' + msg, 3600);
    } else {
      var deep = FOG.deep[b] || b >= 2;
      var got = revealCountry(cid, FOG.probeN(b), deep);
      msg = '测得' + name + ' ' + got + ' 省' + (deep ? '（含建筑与驻军约数）' : '');
      rec = { turn: turnNo, ok: true, text: msg };
      NOTES.push({ owner: PLAYER, cls: 'ok', text: '🕵 密探回报：' + msg });
    }
    (INTELMSG[PLAYER] || (INTELMSG[PLAYER] = Object.create(null)))[cid] = rec;
    fogInvalidate();
    if (state.renderer) state.renderer.fogRefresh();
    if (GP.open) renderGovPanel();
    /* 省卡正开着 → 按新情报重画（可能从 unknown 变 seen） */
    var sel = state.renderer ? state.renderer.selected : 0;
    if (sel && pOf(sel)) showInfo(sel);
    return { ok: true, caught: !!caught, msg: msg };
  }
  AO.resProbe = probeTarget;

  /* ---------------- AI 的情报活动（运行时，不进存档） ----------------
   * AI 也花同样的钱、有同样的预算档；差别只在"玩家看得见结果，AI 的认知只影响它自己"。
   * v1 的 AI 决策不看迷雾，但"玩家反谍重金能抓到 AI 密探"这条必须真的能触发 ——
   * 所以这里照样掷暴露概率，被抓就双方纪要 + REL −15。 */
  var AI_PROBE_T = Object.create(null);
  function aiKnownCountries(owner, w) {
    var out = [];
    for (var i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === owner || countryDead(c.id)) continue;
      if (atWar(owner, c.id)) { out.push(c.id); continue; }
      /* 相邻或有已探省 → "听说过" */
      var known = false;
      var A = AIKNOW[owner] || {};
      for (var j = 0; j < c.provinces.length && !known; j++) {
        if (A[c.provinces[j]]) known = true;
      }
      if (known) out.push(c.id);
    }
    return out;
  }
  function aiProbe(owner, w, forceCid) {
    var last = AI_PROBE_T[owner] || 0;
    if (turnNo - last < FOG.aiProbeEvery) return;
    var pool = aiKnownCountries(owner, w);
    if (forceCid) pool = [forceCid | 0];          // 测试用：指定目标
    if (!pool.length) return;
    AI_PROBE_T[owner] = turnNo + Math.floor(Math.random() * 5) - 2;
    var cid = pool[Math.floor(Math.random() * pool.length)];
    var tc = budgetOf(cid);
    if (Math.random() < FOG.exposeP[tc]) {
      /* 被抓：颗粒无收 + 关系 −15 + 双方纪要 */
      addRel(owner, cid, FOG.relProbe);
      var nm = ownerName(owner), tn = ownerName(cid);
      if (cid === PLAYER) {
        NOTES.push({ owner: PLAYER, cls: 'ok',
          text: '🕵 抓获 ' + nm + ' 密探（关系 ' + relOf(PLAYER, owner) + '）' });
        toast('🕵 抓获 ' + nm + ' 密探 —— 你的反谍网立功了', 3400);
        (INTELMSG[PLAYER] || (INTELMSG[PLAYER] = Object.create(null)))[owner] =
          { turn: turnNo, ok: true, text: '抓获' + nm + '密探' };
      } else if (owner === PLAYER) {
        NOTES.push({ owner: PLAYER, cls: 'warn', text: '🕵 密探在 ' + tn + ' 暴露' });
      }
    } else {
      /* 成功：AI 记住目标国边境的几个省（对它自己有用，对玩家无感） */
      var c = coOf(cid);
      if (c) {
        var E = EXPLORED[cid] ? Object.keys(EXPLORED[cid]).length : 0;
        for (var i = 0; i < c.provinces.length && i < 6; i++) see(owner, c.provinces[i], false);
        if (E < 0) return;
      }
    }
  }

  /* ---------------- 每回合一次：情报 tick（排在战争段之后） ----------------
   * 为什么在战争之后：行军/会战/占领刚刚改过版图，情报署刷新的是"打完之后的现状"，
   * 排在前面会拿到一张过时的地图（今天打下的城，情报还写着旧主）。
   * 为什么在事件之前：事件要读 NOTES（密探被抓那一条），也免得事件弹窗挡住情报提示。 */
  function settleIntel() {
    if (!PLAYER || !state.world) return;
    var w = state.world, i;
    /* ① 自己的省永远新鲜（不刷新的后果是"自己家也泛黄"，看着像 bug） */
    var mine = EXPLORED[PLAYER] || (EXPLORED[PLAYER] = Object.create(null));
    for (i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (p && p.owner === PLAYER) { mine[p.id] = 1; see(PLAYER, p.id, true); }
    }
    /* ② 探测冷却走一格 */
    for (var k in PROBE_CD) if (PROBE_CD[k] > 0) PROBE_CD[k]--;
    /* ③ 各国情报署各走一步（玩家的自动织网 + AI 的织网与探测） */
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || countryDead(c.id)) continue;
      var lvl = intelPay(c.id);
      if (!lvl) continue;
      if (c.id === PLAYER) autoWeb(c.id, lvl);
      else { autoWeb(c.id, lvl); aiProbe(c.id, w); }
    }
    fogInvalidate();
    if (state.renderer) state.renderer.fogRefresh();
  }

  /* ---------------- 迷雾下的呈现（省卡 / 国家卡 / 军旗） ---------------- */
  function fogNameOf(cid) {
    var c = coOf(cid);
    return c ? c.name : '未知之国';
  }
  /* 省卡的两条遮蔽路径。realtime 不走这里（照旧全透明）。 */
  function showFogInfo(p) {
    var info = $('info'), body = $('infoBody'), empty = $('infoEmpty');
    var v = visCode(p.id);
    /* 城防行在迷雾下不显示（耐久是真实数据，旧情报里不该有） */
    hideWallRow();
    info.classList.add('on');
    if (v === VIS_UNKNOWN) {
      info.classList.add('fog-unknown');
      info.classList.remove('fog-seen');
      if (body) body.style.display = 'none';
      if (empty) {
        empty.style.display = '';
        empty.innerHTML = '<b>未知之地</b><span>尚无测绘资料</span>' +
          '<em>派军队前往，或等情报署渗透 —— 地图上这块还只是羊皮纸</em>';
      }
      var fb0 = $('iFogBar');
      if (fb0) fb0.hidden = true;
      return;
    }
    info.classList.remove('fog-unknown');
    info.classList.add('fog-seen');
    if (empty) empty.style.display = 'none';
    if (body) body.style.display = '';
    var ls = lastSeenOf(p.id) || { t: turnNo, o: p.owner };
    var age = Math.max(0, turnNo - (ls.t || turnNo));
    var oc = coOf(ls.o);
    var fb = $('iFogBar');
    if (fb) {
      fb.hidden = false;
      fb.innerHTML = '⚠ 情报截止第 ' + (ls.t || turnNo) + ' 回合 · 陈旧 <b>' + age + '</b> 回合' +
        (age >= FOG.staleMid ? '（已泛黄）' : '');
    }
    $('iSw').style.background = oc ? oc.color : '#b9b09a';
    $('iName').textContent = p.name;
    $('iNameEn').textContent = p.name_en;
    $('iOwner').textContent = (oc ? oc.name : '无主') + '（第 ' + (ls.t || turnNo) + ' 回合所见）';
    $('iTerrain').textContent = (AO.TERRAIN_CN[p.terrain] || p.terrain) + ' · ' + p.terrain;
    var wt = waterText(p);
    $('iWater').textContent = wt;
    $('iWater').title = wt;
    $('iArea').textContent = p.area.toLocaleString() + ' px²';
    var snap = $('iFogSnap');
    if (snap) {
      var h = '<div class="fsrow"><b>上回所见建筑</b><span>' +
        (ls.b && ls.b.length ? escHtml(ls.b.join('、')) : '未记录（要重金情报或再探一次）') + '</span></div>' +
        '<div class="fsrow"><b>据报驻军</b><span>' +
        (ls.tr ? '约 ' + ls.tr.toLocaleString() + ' 人' : '未记录') + '</span></div>';
      if (ls.bt && ls.bt !== ls.t) h += '<div class="fsrow dim"><b>建筑详查于</b><span>第 ' + ls.bt + ' 回合</span></div>';
      h += '<div class="fsrow dim"><b>当下实况</b><span>需派军队进入或定向探测</span></div>';
      snap.innerHTML = h;
    }
    /* 邻国小签会泄露现状（别人的旗色 / 归属），seen 态下不给 */
    if ($('iNeighbors')) $('iNeighbors').innerHTML = '';
  }
  /* 国家卡遮蔽：own/工坊 = 全透明；别国按 INTELB 档给字段 */
  function maskRow(el, hide) {
    if (!el) return;
    var row = el.closest ? el.closest('.kv') : null;
    (row || el).style.display = hide ? 'none' : '';
  }
  function maskBlock(el, hide) {
    if (!el) return;
    el.style.display = hide ? 'none' : '';
    var prev = el.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('sec')) prev.style.display = hide ? 'none' : '';
  }
  function fmtApprox(v) {
    v = Math.max(0, Math.round(v || 0));
    if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 1 : 2) + ' 万';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(v);
  }
  function fmtMen(v) {
    v = Math.max(0, Math.round(v || 0));
    if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + ' 万';
    return v.toLocaleString();
  }
  /* 别国边境省的建筑见闻（只用 LASTSEEN 里的快照，绝不读 SIM） */
  function borderIntelLines(cid, max) {
    var E = EXPLORED[PLAYER] || {}, out = [], n = 0;
    for (var pid in E) {
      var p = pOf(pid);
      if (!p) continue;
      var r = LASTSEEN[PLAYER + '|' + pid];
      if (!r || !r.b || !r.b.length) continue;
      if (r.o !== cid) continue;
      out.push({ name: p.name, b: r.b, t: r.t });
    }
    out.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    return out.slice(0, max || 6);
  }
  function applyCountryMask(c) {
    if (!state.world) return;
    var tier = intelTier(c.id);
    var masked = tier < 3;                  // 3 = 自己的国 / 工坊：全透明
    var box = $('country');
    if (box) box.classList.toggle('fog-masked', masked);
    /* 明细块：国库 / 科技 / 治理 / 地形 / 信仰 / 邻国 —— 只对自己的国显示 */
    maskRow($('cEcon'), masked);
    maskRow($('cPop'), masked);
    maskRow($('cArea'), masked);
    maskRow($('cCapital'), masked);
    maskBlock($('cBar'), masked);
    maskBlock($('cLegend'), masked);
    maskBlock($('cFaithBar'), masked);
    maskBlock($('cFaithList'), masked);
    maskBlock($('cTenet'), masked);
    maskBlock($('cTreasury'), masked);
    maskBlock($('cTech'), masked);
    maskBlock($('cGovern'), masked);
    maskBlock($('cNeighbors'), masked);
    var bar = $('cFogBar'), infoEl = $('cFogInfo');
    if (bar) {
      bar.hidden = !masked;
      if (masked) {
        bar.innerHTML = '⚠ 情报等级「' + FOG.cn[tier] + '」· 已探 <b>' +
          exploredCount(c.id) + '</b> 省　·　国库明细 / 科技 / 治理只对自己的国显示';
      }
    }
    if (masked) $('cProv').textContent = '已探 ' + exploredCount(c.id) + ' 省';
    if (infoEl) {
      infoEl.hidden = !masked;
      if (!masked) { infoEl.innerHTML = ''; return; }
      var h = '';
      if (tier >= 1) {
        var list = armiesOf(c.id), men = 0, i;
        for (i = 0; i < list.length; i++) men += list[i].men || 0;
        h += '<div class="fogrow"><b>总兵力</b><span>' +
          (men > 0 ? '约 ' + fmtMen(men) + ' 人' : '未见成军（约 0）') + '</span></div>';
      }
      if (tier >= 2) {
        var cen = CENTRAL[c.id];
        h += '<div class="fogrow"><b>国库</b><span>金约 ' + fmtApprox(cen ? cen.gold : 0) +
          ' · 粮约 ' + fmtApprox(cen ? cen.grain : 0) + '</span></div>';
        var bl = borderIntelLines(c.id, 5);
        if (bl.length) {
          h += '<div class="fogrow"><b>边境见闻</b><span></span></div>';
          for (var j = 0; j < bl.length; j++) {
            h += '<div class="fogrow sub"><b>' + escHtml(bl[j].name) + '</b><span>' +
              escHtml(bl[j].b.join('、')) + '（第 ' + bl[j].t + ' 回合）</span></div>';
          }
        } else {
          h += '<div class="fogrow sub"><b>边境见闻</b><span>还没有深度情报 —— 用「定向探测」或升到重金档</span></div>';
        }
      }
      if (!h) h = '<div class="fogrow dim"><b>情报不足</b><span>升预算档或定向探测可以多知道一些</span></div>';
      infoEl.innerHTML = h;
    }
  }

  /* ---------------- 治理面板的「情报署」节 ---------------- */
  function renderIntelSection(c) {
    var box = $('gpIntelB');
    if (!box) return;
    var cid = c.id, i;
    var mine = !PLAYER || PLAYER === cid;
    var b = budgetOf(cid), h = '';
    for (i = 0; i < 3; i++) {
      h += '<button type="button" data-ib="' + i + '"' + (i === b ? ' class="on"' : '') +
        ' title="' + escHtml(FOG.desc[i] + '\n每回合 ' + FOG.cost[i] + ' 金') + '">' +
        FOG.cn[i] + '</button>';
    }
    box.innerHTML = h;
    if (!mine || !canAct(cid)) {
      var bs = box.querySelectorAll('button');
      for (i = 0; i < bs.length; i++) lockBtn(bs[i], cid);
    }
    var tip = $('gpIntelTip');
    if (tip) {
      tip.innerHTML = '每回合开销 <b>' + FOG.cost[b] + ' 金</b>（国库扣）　·　反谍：抓到密探 ' +
        Math.round(FOG.exposeP[b] * 100) + '%　·　自动织网 ' +
        (FOG.autoEvery[b] ? ('每 ' + FOG.autoEvery[b] + ' 回合 ' + FOG.autoN[b] + ' 省' +
          (FOG.deep[b] ? '（含建筑与驻军）' : '')) : '不织网');
    }
    var nEl = $('gpIntelN');
    if (nEl) nEl.textContent = mine ? ('· 定向探测 ' + FOG.probeCost + ' 金 / 冷却 ' + FOG.probeCd + ' 回合') : '';
    var listEl = $('gpIntelList');
    if (!listEl) return;
    if (!mine) {
      listEl.innerHTML = '<div class="pempty">情报署只对本国开放 —— 别国的预算与密探活动不对你公布。</div>';
      return;
    }
    if (!PLAYER) {
      listEl.innerHTML = '<div class="pempty">工坊模式（未选国）：没有迷雾，也没有情报署。<br>' +
        '点顶栏「开始游戏」选一个国家，地图才会按你的眼睛来画。</div>';
      return;
    }
    var st = fogStats(), html = '';
    for (i = 0; i < st.known.length; i++) {
      var kc = coOf(st.known[i]);
      if (!kc) continue;
      var key = PLAYER + '|' + kc.id, cd = PROBE_CD[key] | 0;
      var msg = (INTELMSG[PLAYER] || {})[kc.id];
      var poor = (ensureCentral(PLAYER).gold || 0) < FOG.probeCost;
      var dis = cd > 0 || poor;
      var knownN = exploredCount(kc.id);
      html += '<div class="irowk">' +
        '<span class="ikflag" style="background:' + kc.color + '"></span>' +
        '<b class="ikname">' + escHtml(kc.name) + '</b>' +
        '<span class="ikn">' + (knownN ? '已探 ' + knownN + ' 省' : '接壤未探') + '</span>' +
        '<button type="button" class="iprobe" data-cid="' + kc.id + '"' + (dis ? ' disabled' : '') +
        ' title="' + (cd > 0 ? '密探休整中：还要 ' + cd + ' 回合'
          : poor ? '国库金不够 ' + FOG.probeCost + ' 金'
            : '花 ' + FOG.probeCost + ' 金揭示它的 ' + FOG.probeN(budgetOf(PLAYER)) + ' 个省（有暴露风险）') +
        '">' + (cd > 0 ? '冷却 ' + cd : '定向探测') + '</button>' +
        '<em class="ikmsg ' + (msg ? (msg.ok ? 'ok' : 'bad') : '') + '">' +
        (msg ? escHtml('第 ' + msg.turn + ' 回合：' + msg.text) : '尚未派出密探') + '</em>' +
        '</div>';
    }
    if (!html) {
      html = '<div class="pempty">没有接壤国家，也没有探到任何国家 —— ' +
        '这是个岛国？派军队出海，或者等邻国的船先到。</div>';
    }
    listEl.innerHTML = html;
  }
  function setIntelBudget(owner, b) {
    if (b !== 0 && b !== 1 && b !== 2) return false;
    if (!canAct(owner)) return false;
    INTELB[owner] = b;
    fogInvalidate();
    if (owner === PLAYER && state.renderer) state.renderer.fogRefresh();
    if (owner === PLAYER) {
      var c = coOf(owner), name = c ? c.name : '';
      return true;
    }
    return true;
  }

  /* 迷雾状态变化的统一入口：面板 / 卡片 / 底图 / 小地图一起刷 */
  function fogTouchAll() {
    fogInvalidate();
    if (state.renderer) state.renderer.fogRefresh();
    if (GP.open) renderGovPanel();
    if (state.renderer && state.renderer.selected) {
      var p = pOf(state.renderer.selected);
      if (p) showInfo(p.id);
    }
    if ($('country').classList.contains('on') && state.renderer && state.renderer.selectedCountry) {
      showCountry(state.renderer.selectedCountry);
    }
  }
  AO.fogTouch = fogTouchAll;

  /* 给 10-render.js / 14-labels.js 的钩子。渲染层不认识 PLAYER / 情报署，
   * 只认这四个函数 —— 所以换世界时把 fogOn 一拍两散即可。 */
  AO.fogOn = fogOn;
  AO.fogVersion = function () { return FOGVER; };
  AO.fogPlayer = function () { return PLAYER; };
  AO.fogVis = visCode;
  AO.fogVIS = { unknown: VIS_UNKNOWN, seen: VIS_SEEN, real: VIS_REAL };
  AO.fogSeenOf = lastSeenOf;
  AO.fogStaleBucket = staleBucket;
  AO.fogStaleAlpha = staleAlphaOf;
  AO.fogSeenColor = function (pid) {
    var r = lastSeenOf(pid);
    if (!r) return null;
    var c = coOf(r.o);
    return c ? c.color : null;
  };
  AO.fogCountryKnown = countryKnown;
  /* 这块省的**现行归属**和 LASTSEEN 里记的不一样了吗？
   * 渲染层拿它做一件事：把"换了旗"的已探省在国界线画完之后再盖一次 ——
   * 否则那条国界线会按今天的版图画出来，等于免费告诉玩家"这里易主了"。 */
  AO.fogOwnerChanged = function (pid) {
    if (!PLAYER) return false;
    var r = LASTSEEN[PLAYER + '|' + (pid | 0)];
    var p = pOf(pid);
    return !!(r && p && (r.o | 0) !== (p.owner | 0));
  };
  AO.fogIntelTier = intelTier;
  AO.fogBudgetOf = budgetOf;
  AO.fogRelOf = function (a, b) { return relOf(a, b); };
  AO.fogPaper = function () { return { paper: FOG.paper, hatch: FOG.hatch }; };

  /* ---------------- 存档：只存玩家自己的迷雾 ---------------- */
  function fogSave() {
    if (!PLAYER) return null;
    var E = EXPLORED[PLAYER] || {}, pids = [], L = Object.create(null), CD = Object.create(null);
    for (var pid in E) {
      pids.push(pid | 0);
      var r = LASTSEEN[PLAYER + '|' + pid];
      if (r) L[pid] = r;
    }
    for (var k in PROBE_CD) {
      if (k.indexOf(PLAYER + '|') === 0) CD[k] = PROBE_CD[k];
    }
    var rel = Object.create(null);
    for (var rk in REL) rel[rk] = REL[rk];
    return {
      E: pids, L: L, B: budgetOf(PLAYER), CD: CD, REL: rel,
      AUTO: AUTOT[PLAYER] || 0,
      MSG: INTELMSG[PLAYER] || null
    };
  }
  function fogLoad(f) {
    /* 先清干净：读档可能换了国，上一个国的地图不能留下来 */
    var k;
    for (k in EXPLORED) delete EXPLORED[k];
    for (k in LASTSEEN) delete LASTSEEN[k];
    for (k in PROBE_CD) delete PROBE_CD[k];
    for (k in INTELMSG) delete INTELMSG[k];
    for (k in AUTOT) delete AUTOT[k];
    for (k in REL) delete REL[k];
    if (!f) {
      /* v5 及更早的档：没有迷雾字段。PLAYER>0 → 按"自国已探、其余 unknown"补；
       * PLAYER=0（工坊）→ 什么都不做，迷雾本来就不生效。 */
      if (PLAYER) { initRel(state.world); initFogForPlayer(PLAYER); }
      fogInvalidate();
      return;
    }
    if (f.REL) for (k in f.REL) REL[k] = f.REL[k];
    if (state.world) ensureRel(state.world);
    var E = EXPLORED[PLAYER] = Object.create(null), i;
    var pids = f.E || [];
    for (i = 0; i < pids.length; i++) E[pids[i] | 0] = 1;
    if (f.L) for (k in f.L) LASTSEEN[PLAYER + '|' + k] = f.L[k];
    INTELB[PLAYER] = (f.B === 1 || f.B === 2) ? f.B : 0;
    if (f.CD) for (k in f.CD) PROBE_CD[k] = f.CD[k] | 0;
    AUTOT[PLAYER] = f.AUTO || 0;
    INTELMSG[PLAYER] = f.MSG || Object.create(null);
    if (!pids.length) initFogForPlayer(PLAYER);
    fogInvalidate();
  }
  AO.fogSave = fogSave;       // 供 test 直接看存档内容
  AO.fogLoad = fogLoad;


  /* ---------------- 存档 / 读档（手动，绝不自动读） ----------------
   * 为什么手动：index.html 兼职"世界工坊"，自动读档会把工坊劫持成
   * "永远继续上局" —— 想换个种子看新世界都做不到。
   * 存的是**状态**，不是地图：世界由 seed + 三个滑杆重新生成，
   * 所以读回来的世界和存的那一刻完全一致（1100 省约 1.8 MB，别的地方省不了 ——
   * 每省七种资源各有库存/储量/工地/维护零头，压缩不了多少）。
   * FLOW / FLOWC 不存：那是"上一回合"的流水，读回来应该从零开始。 */
  var SAVE_KEY = AO.SAVE_KEY || 'sj.save';
  var SAVE_KEY_V1 = AO.SAVE_KEY_V1 || 'sj.save.v1';
  var SAVE_VER = AO.SAVE_VER || 2;

  /* file:// 下有些浏览器会禁 localStorage。探一次，禁了就把两个钮置灰。 */
  function lsOK() {
    try {
      localStorage.setItem('sj.__probe', '1');
      localStorage.removeItem('sj.__probe');
      return true;
    } catch (e) { return false; }
  }
  AO.resLocalStorageOK = lsOK;

  /* silent=true：选国 / 退出游戏时顺手存一档，不弹"已存档"（那时正在弹别的提示） */
  function saveGame(silent) {
    if (!state.world) { if (!silent) toast('还没有世界可以存', 2200); return; }
    var payload = {
      v: SAVE_VER,
      seed: $('seed').value,
      opt: { prov: +$('prov').value, ctry: +$('ctry').value, land: +$('land').value, size: state.size },
      turnNo: turnNo,
      SIM: SIM, SCHOOL: SCHOOL, MARKET: MARKET, BUILDER: BUILDER,
      /* 内政批：粮仓 / 大学 / 工厂（三张和学校同形状的表）。
       * **不升 SAVE_VER** —— 旧档没有这三个键，读进来 fill 成空表、
       * 后面那条"缺了就补 newSchool()"会补成 0 座，等同"还没盖过"，
       * 和"新开一局"完全同一条路。
       * 存的是**瘦身版**（sparseUniv）：只留盖过/在建的省，不然 1100 个省
       * 每张表 84KB，三张就吃掉 252KB 配额。 */
      GRANARY: sparseUniv(GRANARY), UNIVERSITY: sparseUniv(UNIVERSITY),
      FACTORY_BLD: sparseUniv(FACTORY_BLD),
      FREIGHT_LV: FREIGHT_LV, CENTRAL: CENTRAL, RESEARCH: RESEARCH, POP: POP,
      /* 城墙（本批新增，不升 SAVE_VER）：pid -> { lv, site, hp, halted, mAcc }。
       * 只存**有墙的省**（惰性创建），1100 个省里通常只有几十条。
       * 读旧档时缺这一块 → 按"没墙"补默认，不炸（见 applySave 的兜底）。 */
      WALL: WALL,
      /* 治理层（v2 新增）：官员池、在任、税率、民心 + 人口税零头。
       * TAXACC 也存 —— 不存的话读档后每省的小数零头归零，
       * 长期看只是慢一点点，但"存档前后税入不一样"会被玩家当成 bug。 */
      TALENT: TALENT, OFFICIAL: OFFICIAL, TAXRATE: TAXRATE, HAPPY: HAPPY,
      TAXACC: TAXACC, GOV_ID: GOV_ID,
      /* 战争层（v3）：五座装备厂（和学校同形状）+ 军队 / 将领 / 外交 / 占领 / 围城 /
       * 封锁 / 灭亡 / 战报 / 征兵队列 + 两个 id 计数器 + 玩家国。
       * 全部是"按 id 挂的普通对象"，JSON 原样进出；id 计数器必须存 ——
       * 不存的话读档后新征的军队会拿到已经用过的 id，两支军队会互相覆盖。 */
      BARRACKS: BARRACKS, ARMORY: ARMORY, STABLE: STABLE, FOUNDRY: FOUNDRY,
      SHIPYARD: SHIPYARD,
      ARMY: ARMY, GENERALS: GENERALS, ARMY_ID: ARMY_ID, GEN_ID: GEN_ID,
      PLAYER: PLAYER, WARSET: WARSET, WARBASE: WARBASE,
      OCCUPY: OCCUPY, SIEGE: SIEGE, BLOCKADE: BLOCKADE, DEAD: DEAD,
      RECRUITQ: RECRUITQ, WARLOG: WARLOG,
      /* v4：事件系统 + 信仰（冷却表 / 一次性 / 产量 buff / 传教中 / 政策 /
       * 国教 / 挂起未选的事件）。全部按 id 挂的普通对象，JSON 原样进出；
       * 挂起事件只存 key+pid+cid —— ctx 里全是闭包，存不了也读不回来。
       * v5：编年史（年表 / 定稿快照与称号 / 自动触发 flag）。年表一条几十字节，
       * 定稿的三张图是 dataURL（~100KB），随档走。 */
      EVT: AO.evtSave ? AO.evtSave() : null,
      CHRONO: AO.chronoState ? AO.chronoState() : null,
      /* v6：战争迷雾。**只存玩家自己那份认知**（EXPLORED / LASTSEEN / 预算 /
       * 探测冷却 / 关系值）。AI 的认知是运行时长出来的，不进档 ——
       * 存了反而会在读档后和 re-roll 的预算档打架。 */
      FOG: fogSave(),
      /* v7：敌国性格（PERSONA）。**不升版本号，只加字段** ——
       * 老档没有这一块，读进来是 undefined，18-ai.js 的 load 什么都不做，
       * 性格第一次被问到的时候按 seed + cid 的散列补上（同一个种子永远同一个性格）。 */
      AI: AO.aiEconSave ? AO.aiEconSave() : null
    };
    var text;
    try { text = JSON.stringify(payload); }
    catch (e) { return toast('存档失败：' + e.message, 3200); }
    try {
      localStorage.setItem(SAVE_KEY, text);
      if (!silent) toast('已存档：第 ' + turnNo + ' 回合 · ' + ((text.length / 1024) | 0) + ' KB', 2600);
    } catch (e) {
      if (!silent) toast('存档失败（这个环境禁用了 localStorage）', 3600);
    }
  }

  /* 把存档里的状态灌回当前世界。世界已经按同一个 seed 重建好了，
   * 所以 pid / owner 都是同一套编号，逐键覆盖即可。
   *
   * v1 → v2 的迁移全在**默认值**里，不写迁移函数：
   * v1 的档里没有 TALENT / OFFICIAL / TAXRATE / HAPPY，fill 之后是空对象，
   * 后面那段兜底会把税率补成 1、民心补成 60、官员池补成空 ——
   * 于是"读到旧档"和"新开一局"走的是同一条代码路径，不会出现两套逻辑。 */
  function applySave(d, keepPid, keepCid) {
    function wipe(o) { for (var k in o) delete o[k]; }
    function fill(dst, src) { wipe(dst); if (src) for (var k in src) dst[k] = src[k]; }
    fill(SIM, d.SIM);
    fill(SCHOOL, d.SCHOOL);
    fill(GRANARY, d.GRANARY);
    fill(UNIVERSITY, d.UNIVERSITY);
    fill(FACTORY_BLD, d.FACTORY_BLD);
    fill(MARKET, d.MARKET);
    fill(BUILDER, d.BUILDER);
    fill(FREIGHT_LV, d.FREIGHT_LV);
    /* 城墙：旧档（v6 及更早）没有 WALL → fill 之后是空表，等于"这一局还没人砌墙"。
     * 有 WALL 的档逐条过一遍，缺字段按 lv0/hp0 补齐（并行批约定：不升号 + 读档容错）。 */
    fill(WALL, d.WALL);
    for (var wpid in WALL) {
      var wr = WALL[wpid];
      if (!wr || typeof wr !== 'object') { delete WALL[wpid]; continue; }
      wr.lv = AO.clamp(wr.lv | 0, 0, AO.WALL.maxLv);
      wr.site = Math.max(0, wr.site | 0);
      /* hp 缺失（只写了一部分的档）→ 按"完好的墙"补满；
       * hp 明确写了 0 → 保留 0（那是一面被打塌的墙，不能凭空修好）。 */
      var wmax0 = AO.WALL.maxHp(wr.lv);
      wr.hp = (wr.hp === undefined || wr.hp === null || isNaN(+wr.hp))
        ? wmax0 : AO.clamp(+wr.hp, 0, wmax0);
      wr.halted = !!wr.halted;
      if (!wr.mAcc) wr.mAcc = { iron: 0, gold: 0 };
    }
    fill(CENTRAL, d.CENTRAL);
    fill(RESEARCH, d.RESEARCH);
    fill(POP, d.POP);
    fill(TALENT, d.TALENT);
    fill(OFFICIAL, d.OFFICIAL);
    fill(TAXRATE, d.TAXRATE);
    fill(HAPPY, d.HAPPY);
    fill(TAXACC, d.TAXACC);
    /* 战争层（v3）。老档（v1/v2）没有这些键 → fill 之后是空表，
     * 和"新开一局"完全一样，所以不需要写迁移函数。 */
    fill(BARRACKS, d.BARRACKS);
    fill(ARMORY, d.ARMORY);
    fill(STABLE, d.STABLE);
    fill(FOUNDRY, d.FOUNDRY);
    fill(SHIPYARD, d.SHIPYARD);
    fill(ARMY, d.ARMY);
    fill(GENERALS, d.GENERALS);
    fill(WARSET, d.WARSET);
    fill(WARBASE, d.WARBASE);
    fill(OCCUPY, d.OCCUPY);
    fill(SIEGE, d.SIEGE);
    fill(BLOCKADE, d.BLOCKADE);
    fill(DEAD, d.DEAD);
    fill(RECRUITQ, d.RECRUITQ);
    /* 事件 / 信仰（v4）。老档（v1~v3）没有这一块 → evtLoad(undefined) 全补默认：
     * 冷却表空、政策一律强制、国教重算，于是"读到旧档"和"新开一局"同一条路。 */
    if (AO.evtLoad) AO.evtLoad(d.EVT);
    /* 编年史（v5）。老档没有 CHRONO → chronoLoad(undefined) 补空年表，
     * 于是"读到旧档"和"新开一局"走同一条路（和 EVT 一个道理）。 */
    if (AO.chronoLoad) AO.chronoLoad(d.CHRONO);
    /* 战报是数组：fill 只按 key 遍历，数组得单独灌（否则 length 会留成旧的长度） */
    WARLOG.length = 0;
    if (d.WARLOG && d.WARLOG.length) for (var wi = 0; wi < d.WARLOG.length; wi++) WARLOG.push(d.WARLOG[wi]);
    /* 流水是"上一回合"的，读档后清空（否则省卡会显示上一局的收支） */
    wipe(FLOW);
    wipe(FLOWC);
    /* 兜底：更早的存档没有 queue / 市场 / 建造坊 / 治理层，补空结构而不是崩掉 */
    for (var o in RESEARCH) {
      var R = RESEARCH[o];
      if (!R.queue) R.queue = [];
      if (!R.done) R.done = Object.create(null);
    }
    for (var pid in SIM) {
      if (!SCHOOL[pid]) SCHOOL[pid] = newSchool();
      if (!MARKET[pid]) MARKET[pid] = newSchool();
      if (!BUILDER[pid]) BUILDER[pid] = newSchool();
      /* 战争层的五座厂同形状，缺了就补一个空的（v1/v2 档走到这里就是"还没建过厂"） */
      if (!BARRACKS[pid]) BARRACKS[pid] = newSchool();
      if (!ARMORY[pid]) ARMORY[pid] = newSchool();
      if (!STABLE[pid]) STABLE[pid] = newSchool();
      if (!FOUNDRY[pid]) FOUNDRY[pid] = newSchool();
      if (!SHIPYARD[pid]) SHIPYARD[pid] = newSchool();
      /* 内政批：粮仓 / 大学 / 工厂。旧档没有这三张表 → 补 0 座（等同"还没盖过"） */
      if (!GRANARY[pid]) GRANARY[pid] = newSchool();
      if (!UNIVERSITY[pid]) UNIVERSITY[pid] = newSchool();
      if (!FACTORY_BLD[pid]) FACTORY_BLD[pid] = newSchool();
      happyOf(pid);                       // v1 档：民心补 60
    }
    if (state.world) {
      for (var ci2 = 0; ci2 < state.world.countries.length; ci2++) {
        var cid2 = state.world.countries[ci2].id;
        talentOf(cid2);                   // v1 档：人才池补空
        if (TAXRATE[cid2] === undefined) TAXRATE[cid2] = 1;   // v1 档：默认常规税
      }
    }
    /* 官员 id 计数器要接着存档里的最大值往后走，否则新抽的官会撞 id
     * （撞了之后"派/撤"会认错人 —— 这种 bug 只在读档后才出现，最难查） */
    var maxId = 0, kk;
    for (kk in OFFICIAL) if (OFFICIAL[kk] && OFFICIAL[kk].id > maxId) maxId = OFFICIAL[kk].id;
    for (kk in TALENT) {
      var pool = (TALENT[kk] && TALENT[kk].pool) || [];
      for (var pi = 0; pi < pool.length; pi++) if (pool[pi] && pool[pi].id > maxId) maxId = pool[pi].id;
    }
    GOV_ID = Math.max(d.GOV_ID || 1, maxId + 1);
    /* 军队 / 将领的 id 计数器同理：老档没有就从头开始，
     * 有的话至少要比现有最大 id 大 —— 否则新征的军队会覆盖旧的那支。 */
    var maxArmy = 0, maxGen = 0, ak2, gk;
    for (ak2 in ARMY) if (ARMY[ak2] && +ak2 > maxArmy) maxArmy = +ak2;
    for (gk in GENERALS) if (GENERALS[gk] && GENERALS[gk].id > maxGen) maxGen = GENERALS[gk].id;
    ARMY_ID = Math.max(d.ARMY_ID || 1, maxArmy + 1);
    GEN_ID = Math.max(d.GEN_ID || 1, maxGen + 1);
    PLAYER = d.PLAYER || 0;
    turnNo = d.turnNo || 1;
    /* 迷雾（v6）：PLAYER 与回合数都落定之后再灌 ——
     * LASTSEEN 的陈旧度是拿 turnNo 现算的，先灌迷雾会得到一张"未来情报"。
     * 旧档没有 d.FOG → fogLoad(undefined) 按"自国已探、其余 unknown"补初始化。 */
    fogLoad(d.FOG);
    /* 敌国性格（v7）：和迷雾同一位次 —— turnNo / PLAYER 都定完了。
     * 旧档没有 d.AI → aiEconLoad(undefined) 只清空表，性格按 seed + cid 的散列补，
     * 于是"读到旧档"和"新开一局"走同一条路。 */
    if (AO.aiEconLoad) AO.aiEconLoad(d.AI);
    updateTurnLabel();
    state.infoId = 0;
    state.openKey = null;
    clearInfo();
    clearCountry();
    if (state.renderer) state.renderer.requestDraw();
    /* 把读档前正在看的省/国接着显示出来（同 seed 重建，id 一定对得上） */
    if (keepCid && state.world.countries[keepCid - 1]) {
      if (state.renderer) state.renderer.selectedCountry = keepCid;
      showCountry(keepCid);
    }
    if (keepPid && state.world.provinces[keepPid - 1]) {
      if (state.renderer) { state.renderer.select(keepPid); }
      showInfo(keepPid);
    }
    refreshLocks();          // PLAYER 可能变了：所有"非你的国家"的灰要重新算一遍
    /* 存档里挂着一件没选完的事 → 重新弹出来（不弹的话 EPEND 有值、
     * 下一回合按钮却没人置灰，玩家会卡在一件看不见的事上）。 */
    if (AO.evtReopen) AO.evtReopen();
    toast('读档完成：第 ' + turnNo + ' 回合', 2400);
  }

  function loadGame() {
    var raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      /* v1 旧档存在旧键上：找不到新键就回退找它，读到之后按 v1 补默认 */
      if (!raw) raw = localStorage.getItem(SAVE_KEY_V1);
    }
    catch (e) { return toast('这个环境不允许读 localStorage（file:// 被禁），读不了存档', 3400); }
    if (!raw) return toast('还没有存档 —— 先点「存档」', 2600);
    var d = null;
    try { d = JSON.parse(raw); }
    catch (e) { return toast('存档损坏，读不出来', 3200); }
    /* 版本容忍：**读得进比读不进的档多**。v1（治理层之前）、v2（治理层）、
     * v3（战争层）的字段是逐层叠加的 —— 老档缺的字段在 applySave 里补默认，
     * 所以只要"不比当前版本新"就都能读。比当前版本新的才拒（那些字段我们不认识）。 */
    if (!d || !(d.v >= 1) || d.v > SAVE_VER) {
      return toast('存档版本不认识（v' + (d && d.v) + '，本版最高 v' + SAVE_VER + '）', 3200);
    }
    if (d.v < SAVE_VER) {
      toast('读到 v' + d.v + ' 旧档：' +
        (d.v < 2 ? '官员 / 税率 / 民心' : d.v < 3 ? '军队 / 外交 / 装备厂' :
          d.v < 4 ? '事件 / 信仰' : d.v < 5 ? '编年史年表' :
            '战争迷雾（按"自国已探、其余未知"补）') + '按默认补齐', 3000);
    }

    /* 先按存档里的 seed + 滑杆值重建世界，世界建好之后再灌状态 */
    $('seed').value = d.seed || '';
    var opt = d.opt || {};
    if (opt.size && SIZES[opt.size]) {
      state.size = opt.size;
      var seg = $('sizeSeg').querySelectorAll('button');
      for (var i = 0; i < seg.length; i++) {
        seg[i].classList.toggle('on', seg[i].dataset.size === state.size);
      }
    }
    if (opt.prov) { $('prov').value = opt.prov; $('provVal').textContent = opt.prov; }
    if (opt.ctry) { $('ctry').value = opt.ctry; $('ctryVal').textContent = opt.ctry; }
    if (opt.land) { $('land').value = opt.land; $('landVal').textContent = opt.land + '%'; }
    var keepPid = state.renderer ? state.renderer.selected : 0;
    var keepCid = state.renderer ? state.renderer.selectedCountry : 0;
    toast('正在按存档重建世界…', 1600);
    generate(function () { applySave(d, keepPid, keepCid); });
  }
  AO.resSave = saveGame;
  AO.resLoad = loadGame;

  /* =============================================================
   * 十七、事件弹窗 + 信仰（钩子层）
   *
   * 逻辑与数值全在 js/16-events.js —— 这里只做三件事：
   *   ① 把内部件递进去（evtBoot → AO.evtInit）：那边拿不到 SIM / POP / NOTES
   *   ② DOM：事件弹窗（居中小卡）、省卡信仰行、治理面板的信仰政策与传教钮
   *   ③ 回合钩子：settleTurn 末尾掷事件、settleHappy 的 faith driver
   *
   * 为什么事件弹窗不做成 #techTree 那种全屏：它是回合结算的**插曲**，
   * 铺满一屏会把地图整个盖住，玩家选完还得重新找回刚才看的地方。
   * ============================================================= */
  function evtLockTurn(on) {
    var ids = ['nextTurn', 'ttTurn', 'gpTurn'];
    for (var i = 0; i < ids.length; i++) {
      var b = $(ids[i]);
      if (b) b.disabled = !!on;
    }
  }

  /* 事件弹窗：标题（事件名）/ 地点与回合 / 正文 / 2~3 个选项（副行 = 数值） */
  function openEventModal(ev, ctx) {
    if (!ev) return;
    var p = ctx.prov, c = ctx.country;
    var provName = p ? p.name : '';
    var cname = c ? c.name : '';
    var who = (ctx.official && ctx.official.name) || cname || '朝廷';
    $('evTitle').textContent = ev.cn;
    $('evWhere').textContent = (provName ? provName + '　·　' : '') + (cname || '—') +
      '　·　第 ' + turnNo + ' 回合';
    $('evText').textContent = AO.evtText(ev, { prov: provName, country: cname, name: who });
    var cat = $('evCat');
    cat.title = '事件类目：' + (ev.cat || '杂事');
    cat.textContent = '§';
    var box = $('evOpts');
    box.innerHTML = '';
    for (var i = 0; i < ev.options.length; i++) {
      var opt = ev.options[i];
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'evopt';
      b.setAttribute('data-i', i);
      b.innerHTML = '<b>' + escHtml(opt.cn) + '</b><em>' + escHtml(AO.evtOptTip(ev, opt)) + '</em>';
      b.addEventListener('click', function () {
        var line = AO.evtPick(+this.getAttribute('data-i'));
        if (line) toast(line, 4600);
      });
      box.appendChild(b);
    }
    $('eventModal').classList.add('on');
    evtLockTurn(true);
    /* 焦点给卡片本身（不是第一个选项）：第一项自带焦点框会被读成
     * "已经替你选好了"。键盘用户按 Tab 自然落到第一个选项。 */
    var cardEl = $('eventModal').querySelector('.evcard');
    if (cardEl) cardEl.focus();
  }

  function closeEventModal() {
    var el = $('eventModal');
    if (el) el.classList.remove('on');
  }

  /* 事件处置完 → 刷一遍看得见的界面（省卡 / 国家卡 / 两个全屏面板） */
  function evtRefresh() {
    evtLockTurn(false);
    updateTurnLabel();
    if (state.world && state.renderer) {
      var id = state.renderer.selected;
      if (id) {
        var p = state.world.provinces[id - 1];
        if (p) {
          if (fogOn() && visCode(id) !== VIS_REAL) showInfo(id);
          else renderInfoLists(p);
        }
      }
      var shown = state.renderer.selectedCountry;
      if (shown && $('country').classList.contains('on')) showCountry(shown);
    }
    if (TT.open) renderTechTree(false);
    if (GP.open) renderGovPanel();
    flushNotes();
    if (state.renderer) state.renderer.requestDraw();
    /* 编年史：自动触发那一下如果正好撞上事件弹窗，会先挂起，等这里补弹 */
    if (AO.chronoFlushPending) AO.chronoFlushPending();
  }

  /* 把内部件递给事件层。传的都是**活对象**（只改内容不换引用），
   * 所以这里给一次引用就够；换世界时 AO.evtReset 负责清表。 */
  function evtBoot() {
    if (!AO.evtInit) return;
    AO.evtInit({
      world: function () { return state.world; },
      player: function () { return PLAYER; },
      getTurn: function () { return turnNo; },
      setTurn: function (n) { turnNo = n | 0; },
      prov: pOf, country: coOf, warKey: warKey, canAct: canAct,
      sim: SIM, pop: POP, central: CENTRAL, happy: HAPPY, official: OFFICIAL,
      generals: GENERALS, army: ARMY, market: MARKET, research: RESEARCH,
      talent: TALENT, warset: WARSET, warLog: WARLOG, notes: NOTES,
      happyOf: happyOf, countryHappy: countryHappy, ensureCentral: ensureCentral,
      talentOf: talentOf, researchOf: researchOf, milPoolOf: milPoolOf,
      toast: toast,
      openModal: openEventModal, closeModal: closeEventModal,
      lockTurn: evtLockTurn,
      /* 16-events.js 里用的是 unlockTurn(false) 这个写法（lockTurn 的反面）；
       * 两个都递进去 —— 事件层改名字也不会把回合按钮永久锁死。 */
      unlockTurn: function (on) { evtLockTurn(!!on); },
      refresh: evtRefresh
    });
  }

  /* 测试钩子
   * 只留这一个出口：数值 bench（test/bench-econ.js）和手工调参都从这里进，
   * 不给每个内部函数都挂一个 AO.xxx，免得导出面越滚越大。 */
  /* 有些钩子收"省对象"，有些收 pid —— 测试里手上多半只有一个 id，
   * 所以统一在这里转一道，两种都收。 */
  function asProv(x) {
    if (x && typeof x === 'object') return x;
    return state.world ? state.world.provinces[(x | 0) - 1] : null;
  }
  AO.resDebug = {
    buildOne: buildOne,
    buildSchool: buildSchool,
    buildMarket: buildMarket,
    buildBuilder: buildBuilder,
    buildUniv: buildUniv,
    startResearch: startResearch,
    sprintSite: sprintSite,
    sprintResearch: sprintResearch,
    sell: function (x, key) { return sellResource(asProv(x), key); },
    buy: function (x, key) { return buyResource(asProv(x), key); },
    settlePop: settlePop,
    settleHappy: settleHappy,
    finishSite: finishSite,
    finishResearch: finishResearch,
    pullQueue: pullQueue,
    nextTurn: nextTurn,
    settleTurn: settleTurn,
    mods: MODS,
    pmod: PMOD,
    effectiveLoss: effectiveLoss,
    effectiveTurns: effectiveTurns,
    flow: FLOW,
    flowc: FLOWC,
    /* 治理层（bench 策略 D 用）：抽官 / 派官 / 撤换 / 调税 / 读三张表 */
    exam: examOfficial,
    assign: assignOfficial,
    dismiss: dismissOfficial,
    setTax: function (owner, r) { TAXRATE[owner] = r; },
    talent: TALENT,
    /* 内政批：粮仓 / 大学 / 工厂 / 库存上限 / 教育档位（test/grain.js 只从这里进） */
    granary: GRANARY,
    university: UNIVERSITY,
    factoryBld: FACTORY_BLD,
    capOf: capOf,
    gainStock: gainStock,
    armProdMul: armProdMul,
    addTalent: addTalent,
    edu: function (owner) { return talentOf(owner).total || 0; },
    tierOf: function (owner) { return talentOf(owner).tier; },
    tierList: AO.TIER,
    official: OFFICIAL,
    taxrate: TAXRATE,
    happy: HAPPY,
    officialsOf: officialsOf,
    countryHappy: countryHappy,
    govOpen: function () { return GP.open; },
    openGov: openGovPanel,
    closeGov: closeGovPanel,
    save: saveGame,
    load: loadGame,
    world: function () { return state.world; },
    /* AI 内政批（18-ai.js）要直接摸中央国库 / 国家表 / 将领池：
     * 给它正规入口，比让那边自己复制一份安全（缺键会自动补七种资源）。 */
    ensureCentral: ensureCentral,
    country: coOf,
    milPoolOf: milPoolOf,
    turn: function () { return turnNo; },
    setTurn: function (n) { turnNo = n; updateTurnLabel(); },

    /* ---- 战争层（v3）：test/war.js 和 bench 策略 E 都只从这里进 ---- */
    choosePlayer: choosePlayer,
    exitGame: exitGame,
    declareWar: declareWar,
    makePeace: makePeace,
    player: function () { return PLAYER; },
    wars: WARSET,
    army: ARMY,
    generals: GENERALS,
    armiesOf: armiesOf,
    armiesIn: armiesIn,
    newArmy: newArmy,
    recruit: recruit,
    recruitInfo: recruitInfo,
    buildFactory: buildFactory,
    setShopOrder: setShopOrder,
    examGeneral: examGeneral,
    assignGeneral: assignGeneral,
    setOrder: setArmyOrder,
    settleWar: settleWar,
    occupy: occupyProvince,
    isDecap: isDecap,
    log: function () { return WARLOG; },
    notes: function () { return NOTES; },
    itemStock: itemStock,
    addItem: addItem,
    openWar: openWarPanel,
    isLocked: function (owner) { return !canAct(owner); },
    battle: AO.BATTLE,
    occupyMap: OCCUPY,
    siegeMap: SIEGE,
    blockadeMap: BLOCKADE,
    deadMap: DEAD,
    seaAdj: function (pid) { return seaMap()[pid] || []; },
    plunder: plunder,
    scorch: scorch,
    annex: annex,

    /* ---- 城墙（城防值）：test/wall.js 只从这里进 ----
     * fight 直接暴露是给"手算一例"用的：固定两支部队 + 固定城墙，
     * 战报里的 hp0 / mul / breach / absorbed 四个数就是复算的全部输入。 */
    wall: WALL,
    wallOf: wallOf,
    wallMax: function (lv) { return AO.WALL.maxHp(lv); },
    wallCost: function (lv) { return AO.WALL.costAt(lv); },
    wallMaint: wallMaintDue,
    upgradeWall: upgradeWall,
    finishWall: finishWall,
    settleWalls: settleWalls,
    fabricOf: fabricOf,
    fight: fight,

    /* ---- 事件 / 信仰（v4）：test/evt.js 只从这里进 ---- */
    evtSettle: function () { return AO.evtSettle(); },
    evtForce: function (key, pid) { return AO.evtForce(key, pid); },
    evtForceModal: function (key, pid) { return AO.evtForce(key, pid, true); },
    evtCan: function (key, pid) { return AO.evtCan(key, pid); },
    evtPick: function (i) { return AO.evtPick(i); },
    evtPending: function () { return AO.evtPending(); },
    evtCd: AO.resEvtCd,
    evtDone: AO.resEvtDone,
    evtBuff: AO.resEvtBuff,
    mission: AO.resMission,
    missionOf: function (pid) { return AO.missionOf(pid); },
    startMission: function (pid) { return AO.toggleMission(pid); },
    faithPol: function (owner, pol) { return pol ? AO.setFaithPol(owner, pol) : AO.faithPolOf(owner); },
    stateFaith: function (owner) { return AO.stateFaithOf(owner); },
    faithDriver: function (pid, owner) { return AO.faithDriver(pid, owner); },
    canMission: function (pid) { return AO.canMission(pid); },
    evtOpen: function () { return $('eventModal').classList.contains('on'); },
    faithRow: function (pid) { return $('iFaith') ? $('iFaith').innerHTML : ''; },

    /* ---- 战争迷雾 / 情报署（v6）：test/fog.js 只从这里进 ---- */
    fogOn: fogOn,
    fogVis: visCode,
    fogVisName: function (pid) { return visOf(pid); },
    fogExplored: EXPLORED,
    fogLastSeen: LASTSEEN,
    fogRel: REL,
    fogBudget: INTELB,
    fogProbeCd: PROBE_CD,
    fogMsg: INTELMSG,
    fogInt: AO.INTEL,
    fogSee: see,
    fogProbe: probeTarget,
    fogSetBudget: setIntelBudget,
    fogBudgetOf: budgetOf,
    fogSettle: settleIntel,
    fogStale: staleOf,
    fogBucket: staleBucket,
    fogSeen: lastSeenOf,
    fogKnown: function () { return fogStats().known.slice(); },
    fogExploredCount: exploredCount,
    fogTier: intelTier,
    fogRelOf: relOf,
    fogSetRel: setRel,
    fogSave: fogSave,
    fogLoad: fogLoad,
    fogInvalidate: fogInvalidate,
    /* 测试专用：AI 探测 / 金库读写 / 揭示 */
    fogAIProbe: function (owner, cid) {
      if (!state.world) return;
      aiProbe(owner | 0, state.world, cid | 0);
    },
    fogReveal: function (cid, n, deep) { return revealCountry(cid, n, deep); },
    fogGold: function (owner) { return (ensureCentral(owner).gold || 0); },
    fogSetGold: function (owner, v) { ensureCentral(owner).gold = v; },
    fogCost: function (b) { return AO.INTEL.cost[b] || 0; },
    fogArmiesOf: armiesOf,
    fogDisband: function (aid) { disbandArmy(aid); fogInvalidate(); },
    fogTouch: fogTouchAll,
    showCountry: function (cid) { if (state.renderer) state.renderer.selectCountry(cid); showCountry(cid); },
    showInfo: function (pid) { if (state.renderer) state.renderer.select(pid); showInfo(pid); },
    /* 测试用：直接读"这一帧的画法"（不看画布，省得比像素） */
    fogPlan: function () {
      var out = { real: 0, seen: 0, unknown: 0 };
      if (!state.world) return out;
      for (var i = 1; i <= state.world.provinces.length; i++) {
        var v = visCode(i);
        if (v === VIS_REAL) out.real++; else if (v === VIS_SEEN) out.seen++; else out.unknown++;
      }
      return out;
    }
  };


  /* ---------------- 面板收起 ---------------- */
  /* 默认收起：地图才是主体，面板按需拉开。选择记在 localStorage 里。 */
  function setPanel(open) {
    doc.body.classList.toggle('panel-collapsed', !open);
    try { localStorage.setItem('sj.panelOpen', open ? '1' : '0'); } catch (e) { /* file:// 下可能被禁 */ }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('gen').addEventListener('click', generate);
    $('dice').addEventListener('click', function () {
      $('seed').value = Math.random().toString(36).slice(2, 9);
      generate();
    });
    var seg = $('sizeSeg').querySelectorAll('button');
    for (var i = 0; i < seg.length; i++) {
      seg[i].addEventListener('click', function () { applySize(this.dataset.size, true); });
    }
    var vseg = $('viewSeg').querySelectorAll('button');
    for (var vi = 0; vi < vseg.length; vi++) {
      vseg[vi].addEventListener('click', function () {
        var v = this.dataset.view;
        for (var k2 = 0; k2 < vseg.length; k2++) vseg[k2].classList.toggle('on', vseg[k2] === this);
        if (state.renderer) state.renderer.setView(v);
        updateFaithLegend(v);
        updateResLegend(v);
        var md = state.renderer ? state.renderer.mode : 'view';
        $('modeHint').textContent = v === 'terrain'
          ? '地形视图：按高程分带，河流按水量加粗'
          : v === 'faith'
            ? '宗教视图：同一片颜色 = 同一个信仰'
            : v === 'resources'
              ? '资源视图：颜色 = 该省主资源，点省份看七种储量'
              : (md === 'paint' ? '点击省份把它划给所选国家'
                : md === 'country' ? '点击任意地块，查看该国资料'
                : '点击省份查看信息');
      });
    }
    /* 省卡「可开发」的两态开关：只换图标和名字，储量数字不动 */
    var rst = $('resState');
    if (rst) {
      var rbtns = rst.querySelectorAll('button');
      for (var ri = 0; ri < rbtns.length; ri++) {
        rbtns[ri].addEventListener('click', function () {
          state.resState = this.dataset.st;
          for (var k3 = 0; k3 < rbtns.length; k3++) rbtns[k3].classList.toggle('on', rbtns[k3] === this);
          var sid = state.renderer ? state.renderer.selected : 0;
          if (sid) showInfo(sid);
        });
      }
    }
    /* 信息 / 建筑 两个入口：点开一个；再点当前这个 = 收起 */
    var itabs = $('infoTabs').querySelectorAll('.itab');
    for (var ti = 0; ti < itabs.length; ti++) {
      itabs[ti].addEventListener('click', function () {
        var tab = this.getAttribute('data-tab');
        state.infoTab = (state.infoTab === tab) ? null : tab;
        applyInfoTab();
        if (state.infoTab && state.renderer && state.renderer.selected && state.world) {
          var pp = state.world.provinces[state.renderer.selected - 1];
          if (pp) renderInfoLists(pp);       // 展开时补一次内容
        }
      });
    }
    $('nextTurn').addEventListener('click', nextTurn);
    /* 存档 / 读档：**手动**两个钮。file:// 下 localStorage 被禁时优雅置灰，
     * 而不是点了没反应。 */
    var sv = $('saveBtn'), ld = $('loadBtn');
    if (sv) sv.addEventListener('click', saveGame);
    if (ld) ld.addEventListener('click', loadGame);
    if (!lsOK()) {
      if (sv) { sv.disabled = true; sv.title = '这个环境禁用了 localStorage（file:// 常见），存不了档'; }
      if (ld) { ld.disabled = true; ld.title = '这个环境禁用了 localStorage（file:// 常见），读不了档'; }
    }
    /* 科技：右上角一个入口，点开就是全屏科技树；节点上的点击在 bindTechTree 里 */
    $('techBtn').addEventListener('click', function () {
      if (TT.open) closeTechTree();
      else openTechTree(0);
    });
    bindTechTree();
    /* 治理：同样的位置再给一个入口（科技管国家工程，治理管人和钱） */
    var gb = $('govBtn');
    if (gb) gb.addEventListener('click', function () {
      if (GP.open) closeGovPanel();
      else openGovPanel(0);
    });
    bindGovPanel();

    /* ---- 战争层（v3）的三个入口 ----
     * 开始游戏（选国）/ 军务 / 退出游戏。
     * 「军务」和「治理」是同一块 overlay 的两个页签，所以这里只是切页。 */
    var pb = $('playBtn');
    if (pb) pb.addEventListener('click', function () {
      if (PLAYER) exitGame();
      else openPickPanel();
    });
    var wb = $('warBtn');
    if (wb) wb.addEventListener('click', function () {
      var cid = PLAYER || (state.renderer && state.renderer.selectedCountry) || 0;
      if (GP.open && GP.tab === 'war') closeGovPanel();
      else openWarPanel(cid);
    });
    /* 编年史（v5）：随时可开 —— 没定稿时是"实时年表 + 当前数据"，
     * 定稿只是给这一刻盖个章，之后照样能继续经营。 */
    var chb = $('chronoBtn');
    if (chb) chb.addEventListener('click', function () {
      if (AO.chronoIsOpen && AO.chronoIsOpen()) AO.chronoClose();
      else if (AO.chronoOpen) AO.chronoOpen();
    });
    var pc = $('pickClose');
    if (pc) pc.addEventListener('click', closePickPanel);
    var pl = $('pickList');
    if (pl) pl.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-cid]') : null;
      if (!b) return;
      var r = choosePlayer(+b.getAttribute('data-cid'));
      if (r.ok) closePickPanel();
    });
    var pAll = $('pickGod');
    if (pAll) pAll.addEventListener('click', function () {
      closePickPanel();
      if (PLAYER) exitGame();
      else toast('已经是上帝工坊模式：所有国家都能操作', 2600);
    });
    /* 省卡的「民心 / 官员」两行点开治理面板（悬停有明细，点击有去处） */
    var ih = $('iHappy'), io = $('iOfficial');
    function gotoGov() {
      var id = state.renderer && state.renderer.selected;
      var p = id && state.world ? state.world.provinces[id - 1] : null;
      if (p) openGovPanel(p.owner);
    }
    if (ih) { ih.style.cursor = 'pointer'; ih.addEventListener('click', gotoGov); }
    if (io) { io.style.cursor = 'pointer'; io.addEventListener('click', gotoGov); }
    $('prov').addEventListener('input', function () { $('provVal').textContent = this.value; });
    $('ctry').addEventListener('input', function () { $('ctryVal').textContent = this.value; });
    $('land').addEventListener('input', function () { $('landVal').textContent = this.value + '%'; });
    // 松手后如果参数真的变了就立刻重算，不用再去点生成
    var rerender = function () { if (optsDiffer()) generate(); };
    $('prov').addEventListener('change', rerender);
    $('ctry').addEventListener('change', rerender);
    $('land').addEventListener('change', rerender);
    $('modeView').addEventListener('click', function () { setMode('view'); });
    $('modeCountry').addEventListener('click', function () { setMode('country'); });
    $('modePaint').addEventListener('click', function () { setMode('paint'); });
    $('cClose').addEventListener('click', clearCountry);
    $('panelToggle').addEventListener('click', function () { setPanel(false); });
    $('panelOpen').addEventListener('click', function () { setPanel(true); });
    // 省份卡里的「归属」直接点开国家资料
    $('iOwner').addEventListener('click', function () {
      var id = state.renderer && state.renderer.selected;
      if (!id || !state.world) return;
      var p = state.world.provinces[id - 1];
      if (!p) return;
      setMode('country');
      state.renderer.selectCountry(p.owner);
    });
    $('expGeo').addEventListener('click', exportGeo);
    $('expJson').addEventListener('click', exportJson);
    $('runTest').addEventListener('click', runTest);
    $('seed').addEventListener('keydown', function (e) { if (e.key === 'Enter') generate(); });
    root.addEventListener('keydown', function (e) {
      /* ESC 先关最上层的全屏层（治理 → 科技树），再关国家卡。
       * 两个 overlay 同时开在实现上不会发生（各有各的入口），
       * 但顺序写死更保险：先退后开的那个。 */
      if (e.key === 'Escape') {
        var pk = $('pickPanel');
        if (pk && pk.classList.contains('on')) { closePickPanel(); return; }
        if (AO.chronoIsOpen && AO.chronoIsOpen()) { AO.chronoClose(); return; }
        if (GP.open) { closeGovPanel(); return; }
        if (TT.open) { closeTechTree(); return; }
        clearCountry();
        return;
      }
      /* 空格 = 下一回合（正在输入框里打字时不抢；史书开着时也不抢 ——
       * 翻着书突然结算一年，页面会在脚下刷新） */
      if (e.key === ' ' || e.code === 'Space') {
        var t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (AO.chronoIsOpen && AO.chronoIsOpen()) return;
        e.preventDefault();
        nextTurn();
      }
    });
  }

  /* 把内部件递给编年史（js/17-chrono.js）。和 evtBoot 同一个道理：
   * 递的是**取值器 + 活对象**，那边只读、不持有引用，换世界也不用重新递。
   * 这块是纯展示层，除了结算尾那一行归档钩子，一行游戏逻辑都不碰。 */
  function chronoBoot() {
    if (!AO.chronoInit) return;
    AO.chronoInit({
      world: function () { return state.world; },
      player: function () { return PLAYER; },
      turn: function () { return turnNo; },
      seed: function () { return ($('seed') && $('seed').value) || ''; },
      renderer: function () { return state.renderer; },
      notes: function () { return NOTES; },
      warLog: function () { return WARLOG; },
      central: function () { return CENTRAL; },
      pop: function () { return POP; },
      happy: function () { return HAPPY; },
      school: function () { return SCHOOL; },
      research: function () { return RESEARCH; },
      talent: function () { return TALENT; },
      army: function () { return ARMY; },
      occupy: function () { return OCCUPY; },
      country: coOf,
      countryHappy: countryHappy,
      toast: toast
    });
  }

  function boot() {
    bind();
    updateTurnLabel();
    evtBoot();                         // 事件层拿内部件（必须在第一次 generate 之前）
    chronoBoot();                      // 编年史层拿内部件（同上）
    var savedOpen = null;
    try { savedOpen = localStorage.getItem('sj.panelOpen'); } catch (e) { /* 忽略 */ }
    setPanel(savedOpen === '1');       // 没记录过 → 默认收起
    generate();
    refreshLocks();                    // 顶栏那颗「开始游戏 / 退出游戏」的文字
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
