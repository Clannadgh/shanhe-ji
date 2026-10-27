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
    /* 熔旧坊 + 铁税零头也是"这一局"的：不清的话上一局的 2 座炉会挂到
     * 新世界同号省的铁矿场行上，把"铁矿场"显示成"熔旧坊" */
    for (var smk in SMELT) delete SMELT[smk];
    /* 淘金场（v18）：同理 —— 不清的话上一局的淘金场会挂到新世界同号省的金矿行上 */
    for (var wsk in WASH) delete WASH[wsk];
    for (var iak in IRONACC) delete IRONACC[iak];
    for (var rak in REMITACC) delete REMITACC[rak];
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
    /* 上解统计是"这一局"的（bench 读它看这条规则有没有在动） */
    REMIT.n = 0; REMIT.gold = 0;
    /* 买铁续命的统计同理（v18.4）：换世界必须清零，否则上一局的数字会挂在
     * 新世界的 bench 上 —— 也正是"这条规则有没有在动"的证据链。 */
    SELFSTAT.n = 0; SELFSTAT.gold = 0; SELFSTAT.iron = 0;
    SELFBUY = Object.create(null); SELFBUY_TURN = -1;
    /* 保留座数的"我们自己设的"记录（v18.5）同理：换世界必须清，
     * 否则上一局的 pid 会让我们把新世界同号省的座数当成自己的去改 */
    for (var tkk in AUTOK) delete AUTOK[tkk];
    TRIMSTAT.n = 0;
    /* v12：宰相也是"这一局"的 —— 不清的话新世界的 1 号国直接继承上一局的宰相 */
    for (var ck in CHANCELLOR) delete CHANCELLOR[ck];
    GOV_ID = 1;
    /* 战争层（v3）：军队、将领、围城、封锁都是按 pid / cid 挂的 ——
     * 不清的话，上一局的 3 万大军会"驻扎"在新世界的同一个省上。
     * 五座装备厂也一样（和学校/市场同形状，所以一起清）。 */
    for (var mk2 in BARRACKS) delete BARRACKS[mk2];
    for (var am in ARMORY) delete ARMORY[am];
    for (var sb in STABLE) delete STABLE[sb];
    for (var sy in SHIPYARD) delete SHIPYARD[sy];
    for (var ay in ARMY) delete ARMY[ay];
    for (var gn in GENERALS) delete GENERALS[gn];
    for (var ws in WARSET) delete WARSET[ws];
    for (var wb in WARBASE) delete WARBASE[wb];
    for (var oc in OCCUPY) delete OCCUPY[oc];
    /* 不安 / 整合 / 安抚冷却 / 匪患标记全是"这一局"的 —— 不清的话新世界的
     * 3 号省会扛着上一局的 80 点不安开局就叛乱 */
    for (var ug in UNREST) delete UNREST[ug];
    for (var ig in INTEG) delete INTEG[ig];
    for (var bg in BANDIT) delete BANDIT[bg];
    for (var pc in PACIFY) delete PACIFY[pc];
    for (var uw in UNWARN) delete UNWARN[uw];
    /* 物价也是"这一局"的：不清的话新世界的 5 号国会继承上一局的粮价 */
    for (var prc in PRICES) delete PRICES[prc];
    for (var psh in PRICESHOCK) delete PRICESHOCK[psh];
    for (var slc in SELLACC) delete SELLACC[slc];
    for (var expk in EXP1) delete EXP1[expk];
    for (var sg in SIEGE) delete SIEGE[sg];
    for (var bl in BLOCKADE) delete BLOCKADE[bl];
    for (var dd in DEAD) delete DEAD[dd];
    for (var rq in RECRUITQ) delete RECRUITQ[rq];
    /* 外交层（v9）：条约 / 战争分 / 冷却 / 贸易累计都是"这一局"的事，
     * 换世界不清的话，新世界同号的两国会凭空多出一张同盟条约。 */
    for (var al in ALLIES) delete ALLIES[al];
    for (var np in NAPS) delete NAPS[np];
    for (var sc in WSCORE) delete WSCORE[sc];
    for (var dc in DIPCD) delete DIPCD[dc];
    for (var tc in TALKCD) delete TALKCD[tc];
    for (var dp in DIPPROP) delete DIPPROP[dp];
    for (var ta in TRADEACC) delete TRADEACC[ta];
    for (var ra in RELACC) delete RELACC[ra];
    for (var rh in RELHIT) delete RELHIT[rh];
    /* 傀儡表（v13）：也是"这一局"的。不清的话新世界的同号国家会凭空变成
     * 上一局某个人的属国 —— 而且这种脏表最难查（面板上有字，但你从没立过表）。 */
    for (var pp2 in PUPPET) delete PUPPET[pp2];
    SURR.open = false; SURR.loser = 0; SURR.winner = 0;
    TALK.open = false; TALK.to = 0;
    WARLOG.length = 0;
    /* 世界消息（v15）：上一条"在路上"的邸报不能送进新世界的同号国家 ——
     * 那会变成"这局还没开打，你先收到一封别处的战报"。 */
    PNEWS.length = 0; RUMOURS.length = 0; newsFogTouch();
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
    /* 维修档（19-repair.js）：保留座数 / 停修名单都是"这一局"的 */
    if (AO.repLoad) AO.repLoad(null);
    /* 平衡分析（20-balance.js）：历史曲线也是"这一局"的 —— 换世界就清空 */
    if (AO.balReset) AO.balReset();
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
  /* 熔旧坊（枯竭铁矿场的改建）：**不新增建筑行**，状态就挂在铁矿场那一行旁边。
   *   pid -> { n, site, halted, mAcc:{iron,gold}, iAcc }
   *     n      已改建几座（≤ AO.SMELT.maxPer = 2）
   *     site   改建工地剩几回合（0 = 没在改）
   *     halted 这一回合付不起金 → 停炉（当回合产量减半，不欠账）
   *     mAcc   金的小数零头（1 铁 = 0.5 金，攒整才扣得动）
   *     iAcc   铁的小数零头（每座 0.5~0.6 铁/回合，攒整才入得了库）
   * 惰性创建（smeltOf）：1100 个省里绝大多数矿还没枯，别开局就给每省塞一条空记录。 */
  var SMELT = Object.create(null);
  /* 淘金场（枯竭金矿场的改建，v18 / A）：金的熔旧坊，**逐条镜像 SMELT**。
   *   pid -> { n, site, halted, mAcc:{iron,gold}, iAcc, tAcc }
   *     n      已改建几座（≤ AO.WASH.maxPer = 2）
   *     site   改建工地剩几回合（0 = 没在改）
   *     halted 这一回合没木 → 停淘（当回合不出金，不倒扣）
   *     mAcc   备用零头（和 SMELT 同形状，存档/面板共用一条归一化路）
   *     iAcc   金的小数零头（每座 0.25~0.4 金/回合，攒整才入得了库）
   *     tAcc   木材的小数零头（1 金 = 2 木，攒整才扣得动）
   * 惰性创建（washOf）：1100 个省里绝大多数金矿还没枯。 */
  var WASH = Object.create(null);
  /* 人口铁税的小数零头（照 TAXACC）：每 ironUnit（10 万）人 0.1~0.4 铁，
   * 一个中位省一回合 0.2~0.4 块，仍要攒整才落得了袋。 */
  var IRONACC = Object.create(null);
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
  var SHIPYARD = Object.create(null); // pid -> 同款 + { order: 舰种键 }
  /* 十种"通用设施"形状完全一样（n / site / halted / mAcc），
   * 用一个注册表把它们当成同一种东西处理 —— 维护、工地推进、完工、冲刺
   * 都只写一遍，加新设施时只往这三处各加一行。
   * 民用五个走 renderUniversalList（通用栏），军备六个走 renderMilList（军备栏）。 */
  var UNIV = {
    school: SCHOOL, market: MARKET, builder: BUILDER,
    granary: GRANARY, university: UNIVERSITY,
    barracks: BARRACKS, armory: ARMORY, stable: STABLE, shipyard: SHIPYARD,
    factory: FACTORY_BLD
  };
  var UNIV_KINDS = ['school', 'market', 'builder', 'granary', 'university',
    'barracks', 'armory', 'stable', 'shipyard', 'factory'];
  /* 民用四件套 + 大学（顺序就是面板里的行序：学校 → 市场 → 建造坊 → 粮仓 → 大学） */
  var UNIV_CIVIL = ['school', 'market', 'builder', 'granary', 'university'];
  var UNIV_MIL = ['barracks', 'armory', 'stable', 'shipyard', 'factory'];
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
  /* 一份空流水。抽成函数是因为**回合外**也会记账（出口 / 商队：玩家在面板上
   * 点一下就要落账，不能等到下回合结算才建表 —— 否则"读档后第一次出口"
   * 和"新开一局第一回合出口"都会静默丢掉两笔账）。 */
  function newFlow() {
    return { gain: Object.create(null), loss: Object.create(null),
             d: { eat: Object.create(null), tax: Object.create(null),
                  maint: Object.create(null), maintC: Object.create(null),
                  cap: Object.create(null), prod: Object.create(null) } };
  }
  function flowOf(pid) { return FLOW[pid | 0] || (FLOW[pid | 0] = newFlow()); }
  var turnNo = 1;
  /* 年 / 月全从 turnNo 派生，不单独存字段 —— 存档里只有回合数，
   * 旧档读进来也立刻有正确的年号（这就是"纯派生"的好处）。
   * 挂在 AO 上是因为 15-resources 的 AO.calOf / AO.calTag 要读它，而那两个
   * 文件的加载顺序是 15 在前、11 在后。 */
  AO.curTurn = function () { return turnNo; };

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
  /* 省库上解的累计（v18 / D，**运行时统计，不进档**）：
   * { n: 搬过几笔, gold: 一共搬了多少金 }。bench 与 test 用它回答
   * "这条规则到底有没有在动" —— 只看某一回合的流水会被"这一回合没到线"骗过去。 */
  var REMIT = { n: 0, gold: 0 };
  /* 上解零头（v18.3 累进之后才需要）：10% / 25% 两段乘出来的都是小数，
   * 一个 33 金的省一回合只有 0.3 金 —— 直接 floor 就永远是 0，"涓流常开"
   * 变成"涓流不存在"。所以和 TAXACC / IRONACC 同一个办法：攒够 1 才落袋，
   * 零头留在表里。**进档**（和 IRONACC 一样，不存的话读档后那点零头归零）。 */
  var REMITACC = Object.create(null);
  var GOV_ID = 1;                     // 官员 id 计数器（存档里存的是 id，不重排）

  /* ---------------- 官员的"人味"（v11：资历 / 怨气） ----------------
   * 一个官员对象从 { id, name, traitKey, owed } 变成：
   *   rank   0~3        资历（每 24 回合 45% 擢升，封顶 3）
   *   ten    0~         在任回合数
   *   griev  0~100      怨气（任期 / 民心差 / 欠饷 三条累积，赏赐 −25）
   *   salAcc 小数俸禄零头（俸禄 1 × 1.25 这种数要攒整，见 settleTax）
   *   warned 上次"怨望"纪要的回合（降下去之后可以再报一次）
   * 三个新字段**不升版本号**：旧档里的官没有它们，offNorm() 读一次补一次，
   * 和"新开一局"走同一条路（这个项目一贯的做法）。
   *
   * 效果倍率是**连续**的、没有死区：
   *   m = (1 + rank × 0.15) × (1 − griev × 0.005)
   * 乘在官员词条的每一项 fx 上（税 / 幸福 / 工期 / 产量）——
   * 所以"资历 3、怨气 0"的能臣是 1.45 倍，"资历 0、怨气 100"的怨吏是 0.5 倍。
   * PMOD 与 tooltip 都读 offMul()，面板上看到的数就是结算真正乘的数。 */
  function offNorm(off) {
    if (!off) return off;
    var G = AO.GOV;
    if (typeof off.rank !== 'number' || !isFinite(off.rank)) off.rank = 0;
    off.rank = AO.clamp(Math.floor(off.rank), 0, (G && G.rankMax) || 3);
    if (typeof off.ten !== 'number' || !isFinite(off.ten) || off.ten < 0) off.ten = 0;
    if (typeof off.griev !== 'number' || !isFinite(off.griev)) off.griev = 0;
    off.griev = AO.clamp(off.griev, 0, 100);
    if (typeof off.owed !== 'number' || !isFinite(off.owed) || off.owed < 0) off.owed = 0;
    if (typeof off.salAcc !== 'number' || !isFinite(off.salAcc)) off.salAcc = 0;
    if (typeof off.warned !== 'number' || !isFinite(off.warned)) off.warned = 0;
    if (typeof off.at !== 'number' || !isFinite(off.at)) off.at = 0;
    return off;
  }
  function offMul(off) {
    var G = AO.GOV;
    if (!off) return 1;
    return (1 + (off.rank || 0) * G.rankFx) * (1 - (off.griev || 0) * G.grievFx);
  }
  /* 词条 fx 按倍率**缩放**（不是简单相乘：taxMul 1.2 在倍率 0.5 时应该是 1.1，
   * 乘成 0.6 就变成"官员反而倒扣税"，那是另一个意思了） */
  function offFx(off) {
    var tr = AO.traitOf(off.traitKey), fx = tr.fx || {}, m = offMul(off), out = {};
    if (fx.taxMul) out.taxMul = 1 + (fx.taxMul - 1) * m;
    if (fx.happyAdd) out.happyAdd = fx.happyAdd * m;
    if (fx.turnCut) out.turnCut = Math.round(fx.turnCut * m);
    if (fx.prodMul) {
      out.prodMul = {};
      for (var k in fx.prodMul) out.prodMul[k] = 1 + (fx.prodMul[k] - 1) * m;
    }
    return out;
  }
  /* 俸禄：base × rankPay[rank]，小数攒整（1 × 1.25 = 1.25 → 这回合付 1、下回合补 0.25）。
   * 不攒整的话 Math.round 会把 rank1 和 rank0 付成同一个数，资历的"加薪"就白写了。 */
  function salaryOf(off) {
    var G = AO.GOV;
    offNorm(off);
    var want = G.salary * (G.rankPay[off.rank] || 1);
    off.salAcc += want;
    var whole = Math.floor(off.salAcc + 1e-9);
    off.salAcc -= whole;
    return whole;
  }
  /* 卸任（撤换 / 被顶替）：资历减半、怨气与在任一概清零。
   * 为什么减半而不是清零：一位干到"柱国"的老臣被撤，回池子里仍比新手强；
   * 但也不能原样留着 —— 否则"撤了再派"就是免费洗怨气。 */
  function retireOff(off) {
    if (!off) return off;
    offNorm(off);
    off.rank = Math.max(0, Math.floor((off.rank || 0) / 2));
    off.griev = 0;
    off.ten = 0;
    off.warned = 0;
    off.salAcc = 0;
    off.at = 0;
    return off;
  }
  AO.resOffNorm = offNorm;
  AO.resOffMul = offMul;
  AO.resOffFx = offFx;
  AO.resSalaryOf = salaryOf;

  /* ---------------- 宰相（v12）：玩家自己的"AI 政府" ----------------
   *   CHANCELLOR[owner] = { id, name, traitKey, grade, perms, owed, paused, since, adviseAt }
   *
   * 三条硬边界 —— 这一层的全部设计就在这里：
   *   ① **不进 OFFICIAL 表**。§2 的资历/怨气按 OFFICIAL 遍历、§4 的 AI 吏部巡查
   *      也是遍历 OFFICIAL —— 两套状态天然碰不到他，不需要任何特判。
   *      他的 id 沿用候选池里那位官员的 id，但不占任何省的官位。
   *   ② **只做"你还没做的"**。动作走 18-ai.js 的 aiDecide（和 AI 国同一个函数），
   *      每格每回合最多一次；你手动做完的事它自然做不了（闸门都在原函数里），
   *      所以"宰相不会推翻你"是结构保证的，不是靠礼貌。
   *   ③ 俸禄从**中央**出（他是国家级官员，食的是国库不是某省的省库），
   *      欠一次就停摆（paused='owed'），补上才复工。
   *
   * 四级规则在 AO.CHANCELLOR_LV（15-resources.js）：1 守成 / 2 干练 / 3 贤相 / 4 权臣。
   * 等级不是"数值大小"，是**权限与代价**的组合 —— 4 级最强也最贵（偷金/民心/弹劾）。 */
  var CHANCELLOR = Object.create(null);
  /* 玩家上一次**手动**改税率的回合（owner -> turn）。
   * 宰相的三条边界里有一条"你手动做的他绝不推翻" —— 落点就在这里：
   * 你改过税之后 3 回合内他不碰税率（先照你的意思走，等你不管了再按自己的判断来）。
   * 只记 UI 的 setTaxRate；AI 走 AO.resDebug.setTax，不会写进这张表。 */
  var TAXMAN = Object.create(null);
  var CH_TAX_HOLD = 3;

  function chOf(owner) { return CHANCELLOR[owner | 0] || null; }
  function chLv(ch) { return (ch && AO.CHANCELLOR_LV && AO.CHANCELLOR_LV[ch.grade]) || null; }
  /* 头衔随政体（王国 宰相 / 帝国 摄政 / 共和 副总统 / 联邦 总理 / 其余 宰相） */
  function chTitleOf(owner) {
    var c = state.world ? state.world.countries[(owner | 0) - 1] : null;
    var g = c && (c.govKey || c.gov);
    return (AO.CH_TITLE && AO.CH_TITLE[g]) || '宰相';
  }
  /* 实际生效的权限（**唯一**的权限判定处，UI 与执行都读它）：
   *   权相 → 全开（无视开关）；1 级 → 只有 build/research（开关点了也不生效）；
   *   其余 → 开关 AND 等级自带的权限。 */
  function chPerms(ch) {
    var L = chLv(ch), out = {};
    if (!L) return { build: 0, research: 0, tax: 0, officials: 0 };
    if (L.ignorePerms) return { build: 1, research: 1, tax: 1, officials: 1 };
    var p = ch.perms || {};
    for (var k in L.perms) out[k] = (L.perms[k] && p[k] !== 0) ? 1 : 0;
    return out;
  }
  /* 权相的常驻民心 debuff（结算 driver 用；没有宰相的国家恒 0） */
  function chHappyOf(owner) {
    var L = chLv(chOf(owner));
    return (L && L.happy) || 0;
  }

  /* 拜相：把候选池里那位移出来，入 CHANCELLOR。只有 isChancellor 的词条能拜。 */
  function appointChancellor(owner, offId) {
    owner = owner | 0;
    if (!canAct(owner)) return { ok: false, msg: lockTitle() };
    if (CHANCELLOR[owner]) return { ok: false, msg: '已经有' + chTitleOf(owner) + '了 —— 先罢免再换人' };
    var T = talentOf(owner), idx = -1, i;
    for (i = 0; i < T.pool.length; i++) if (T.pool[i] && T.pool[i].id === offId) { idx = i; break; }
    if (idx < 0) return { ok: false, msg: '这位不在候选池里（可能已经上任了）' };
    var off = T.pool[idx], tr = AO.traitOf(off.traitKey);
    if (!tr.isChancellor) {
      return { ok: false, msg: '「' + tr.cn + '」不是宰相之才 —— 只有「守成之才」以上四级可拜相' };
    }
    T.pool.splice(idx, 1);
    offNorm(off);
    CHANCELLOR[owner] = {
      id: off.id, name: off.name, traitKey: off.traitKey, grade: tr.grade || 1,
      /* 权限默认全开：拜相的人不会一上来就只准他盖房；要不要收权是玩家的事 */
      perms: { build: 1, research: 1, tax: 1, officials: 1 },
      owed: 0, paused: '', since: turnNo, adviseAt: turnNo
    };
    var L = chLv(CHANCELLOR[owner]);
    NOTES.push({ owner: owner, cls: 'ok',
      text: '拜相：' + off.name + ' 为' + chTitleOf(owner) + ' —— 「' + tr.cn + '」' +
        '（每回合 ' + L.acts + ' 个动作 · 俸禄 ' + L.pay + ' 倍）' });
    return { ok: true, ch: CHANCELLOR[owner] };
  }
  /* 罢相：位子空缺、自动化全停；**该官员致仕不回候选池**（想再请回来就得重新开科） */
  function dismissChancellor(owner) {
    owner = owner | 0;
    var ch = CHANCELLOR[owner];
    if (!ch) return null;
    var title = chTitleOf(owner);
    delete CHANCELLOR[owner];
    NOTES.push({ owner: owner, cls: 'warn',
      text: '罢相：' + ch.name + ' 致仕还乡 —— ' + title + '之位空缺，自动化全停' });
    return ch;
  }

  /* 每回合的"人在朝堂"部分：俸禄 / 权相偷金 / 贤相罢工与进言 / 权相弹劾。
   * 排在 settleOfficials 之后（人口税段）：和官员一样，先把钱的事算清。 */
  function settleChancellor() {
    var G = AO.GOV;
    for (var k in CHANCELLOR) {
      var ch = CHANCELLOR[k], owner = k | 0, L = chLv(ch);
      if (!ch || !L) continue;
      var cen = ensureCentral(owner), FC = FLOWC[owner];
      /* ① 俸禄 = 普通俸禄 × 等级倍率，从中央出；发不出就欠着并停摆 */
      var due = G.salary * (L.pay || 1) + (ch.owed || 0);
      var pay = Math.min(cen.gold || 0, due);
      if (pay > 0) {
        cen.gold -= pay;
        if (FC) {
          FC.loss.gold = (FC.loss.gold || 0) + pay;
          FC.d.chancellor = (FC.d.chancellor || 0) + pay;
        }
      }
      ch.owed = due - pay;
      if (ch.owed > 0) {
        if (ch.paused !== 'owed') {
          ch.paused = 'owed';
          NOTES.push({ owner: owner, cls: 'warn',
            text: ch.name + ' 的俸禄发不出（欠 ' + Math.round(ch.owed) +
              ' 金）—— ' + chTitleOf(owner) + '停摆，国库补上即复工' });
        }
      } else if (ch.paused === 'owed') {
        ch.paused = '';
        NOTES.push({ owner: owner, cls: 'ok', text: ch.name + ' 的俸禄补齐，' + chTitleOf(owner) + '复工' });
      }
      /* ② 权相：每回合从国库拿 3 金（记 FLOWC，国家卡的收支里看得到） */
      if (L.grab && (cen.gold || 0) >= L.grab) {
        cen.gold -= L.grab;
        if (FC) {
          FC.loss.gold = (FC.loss.gold || 0) + L.grab;
          FC.d.chancellor = (FC.d.chancellor || 0) + L.grab;
        }
      }
      /* ③ 贤相：民心 <40 撂挑子，回到 45 才复工（带 5 点回差，免得来回横跳） */
      if (L.strikeHappy) {
        var hv = AO.resCountryHappy(coOf(owner));
        if (hv < L.strikeHappy && ch.paused !== 'strike' && ch.paused !== 'owed') {
          ch.paused = 'strike';
          NOTES.push({ owner: owner, cls: 'warn',
            text: ch.name + ' 撂挑子：国民幸福度 ' + Math.round(hv) + ' < ' + L.strikeHappy +
              ' —— 自动化暂停（回到 ' + L.resumeHappy + ' 复工）' });
        } else if (ch.paused === 'strike' && hv >= L.resumeHappy) {
          ch.paused = '';
          NOTES.push({ owner: owner, cls: 'ok',
            text: ch.name + ' 回朝视事：国民幸福度回到 ' + Math.round(hv) });
        }
      }
      /* ④ 贤相进言：每 10 回合一条（走同一条纪要，进年表） */
      if (L.adviseEvery && turnNo - (ch.adviseAt || 0) >= L.adviseEvery) {
        ch.adviseAt = turnNo;
        NOTES.push({ owner: owner, cls: 'ok', text: chAdvice(owner, ch) });
      }
      /* ⑤ 权相：10% 概率被谏官弹劾（只是推送，不掉任何数值 —— 压力给玩家） */
      if (L.impeach && Math.random() < L.impeach) {
        NOTES.push({ owner: owner, cls: 'warn',
          text: '谏官弹劾：' + ch.name + ' 擅权自专、目无君上 —— 罢相可止，留用则国无宁日' });
      }
    }
  }
  /* 贤相的"进言"：一句看账的话，按当前最紧要的事挑 —— 不是随机台词，
   * 玩家扫一眼纪要就知道该往哪看。 */
  function chAdvice(owner, ch) {
    var cen = ensureCentral(owner);
    var hv = AO.resCountryHappy(coOf(owner));
    var wars = 0, k, W = AO.resWar && AO.resWar.wars;
    if (W) for (k in W) if (W[k] && k.split('|').indexOf(String(owner)) >= 0) wars++;
    var body;
    if ((cen.gold || 0) < 30) body = '国库见底（' + Math.floor(cen.gold || 0) + ' 金），宜开源节流，或暂停营造';
    else if (hv < 50) body = '民心仅 ' + Math.round(hv) + '，宜减税、修仓、少动土木';
    else if (wars) body = '兵事未决（' + wars + ' 处交战），宜先修军械坊、备粮草';
    else body = '四境无事，府库尚可 —— 宜劝农桑、兴学校，缓称王';
    return ch.name + '进言：' + body;
  }

  /* 自动化：结算尾（AI tick 之后）由宰相代劳。**权限与动作格都从等级来**。 */
  function chancellorAct() {
    if (!PLAYER) return 0;
    var ch = CHANCELLOR[PLAYER];
    if (!ch) return 0;
    var L = chLv(ch);
    if (!L || ch.paused) return 0;
    if (!AO.aiDecide) return 0;
    var opt = {
      slots: L.acts, taxMul: L.taxMul, smartTax: !!L.smartTax,
      forceMax: !!L.forceMax, noMaxTax: !L.forceMax
    };
    var perms = chPerms(ch);
    /* "你手动做的他绝不推翻"：你刚调过税率 → 他这几回合不碰税。
     * 只挡税率：营造/科研/人事都是**追加**动作，闸门（同省同 kind 只建一座、
     * 池里有人就不再开科）天然保证不会覆盖你刚做的事。 */
    if (turnNo - (TAXMAN[PLAYER] || -99) < CH_TAX_HOLD) perms.tax = 0;
    return AO.aiDecide(PLAYER, perms, opt);
  }
  AO.resChOf = chOf;
  AO.resChLv = chLv;
  AO.resChTitle = chTitleOf;
  AO.resChPerms = chPerms;
  AO.resAppoint = appointChancellor;
  AO.resDismissCh = dismissChancellor;
  AO.resChancellor = CHANCELLOR;
  AO.resSettleChancellor = settleChancellor;
  AO.resChancellorAct = chancellorAct;

  /* ---------------- 战争层（v3）的状态 ----------------
   * 全部照老路子：**按 id 挂对象**，读默认靠 Of()，存档原样存、读档补默认。
   *
   *   PLAYER        玩家国（0 = 上帝工坊模式：一切可动，兼容现在的玩法）
   *   WARSET        'a|b'（a<b，无序对）→ true。宣战/停战只动这一张表
   *   WARBASE       'a|b' → { a: 开战国初始省数, b: … }（投降线的分母）
   *   ARMY          军队 id → { owner,type,tier,men,ships,cargo,generalId,order,pid,sup }
   *   GENERALS      将领 id → { id,name,traitKey,owner,armyId }
   *   OCCUPY        省 id → { by, turn }（占领：产出×0.6、民心−10、不产科研）
   *   INTEG         省 id → { v }（整合度 0~100：只有占领省才有，完成即删除）
   *   UNREST        省 id → { v, target, drivers }（不安 0~100：只涨不降，见 15-resources）
   *   BANDIT        省 id → { turn, left }（匪患标记：下一回合产出归零 + 不安 +10）
   *   PACIFY        省 id → 上次安抚的回合号（冷却 3 回合）
   *   UNWARN        省 id → 已报过的预警档（0 未报 / 1 警戒 70 / 2 危急 90）
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
  var INTEG = Object.create(null);
  var UNREST = Object.create(null);
  var BANDIT = Object.create(null);
  var PACIFY = Object.create(null);
  var UNWARN = Object.create(null);
  /* 动态市场（v14）：PRICES[cid][key] = { v, target, trend }。
   * PRICESHOCK 是事件冲击（旱情 / 商队），SELLACC 是卖货的小数零头，
   * EXP1 记"这个省本回合已经出口过"（存回合号，占位：每省每回合 1 笔）。 */
  var PRICES = Object.create(null);
  var PRICESHOCK = Object.create(null);
  var SELLACC = Object.create(null);
  var EXP1 = Object.create(null);
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

  /* ---------------- 外交层（v9）的状态 ----------------
   * 全部是"无序对 'a|b' → 值"的普通对象，键和 WARSET / REL 完全一样（warKey），
   * 所以存档原样进出、读档逐条归一化就够。
   *
   *   ALLIES   'a|b' → true          同盟（双向，一张表）
   *   NAPS     'a|b' → true          互不侵犯（双向）
   *   WSCORE   'a|b' → { a, b }      战争分（宣战时清零；a 是小 id 那一方）
   *   DIPCD    'a|b' → 回合数         提案冷却（被拒后到这个回合才能再提）
   *   TALKCD   'a|b' → 回合数         求和被拒后的冷却
   *   DIPPROP  'a|b' → { kind, ok, turn } 最后一次提案的结果（面板写一句话用）
   *   TRADEACC 'a|b' → 数            贸易累计的关系值（封顶 DIPLO.rel.tradeCap）
   *   RELACC   'a|b' → 数            贸易关系值的小数零头（一笔 +0.5，攒整才落袋）
   *   RELHIT   'a|b' → 回合数         这一回合被事件动过 → 本回合不缓释（运行时，不进档）
   *
   * 条约表存的是**双向的一张表**（warKey 无序），所以"两国卡都显示"天然成立，
   * 不需要各存一份再对齐。 */
  var ALLIES = Object.create(null);
  var NAPS = Object.create(null);
  var WSCORE = Object.create(null);
  var DIPCD = Object.create(null);
  var TALKCD = Object.create(null);
  var DIPPROP = Object.create(null);
  var TRADEACC = Object.create(null);
  var RELACC = Object.create(null);
  var RELHIT = Object.create(null);
  /* 傀儡与朝贡（v13）：'a|b'（warKey，无序）→ { s: 宗主, p: 傀儡, since, annexCd, warT }
   *
   * 键还是老规矩的无序对，**方向写在记录里**（s / p）—— 因为这张表不是对称的：
   * "甲是乙的宗主"和"乙是甲的宗主"是两件事，用一张单向表就够，查的时候按字段找。
   * 一国同时只能有一条（当傀儡 or 当宗主），所以按 p 找唯一。
   *
   *   since    称臣的回合（"已 N 回合"读它）
   *   annexCd  **绝对回合号**：到这个回合之后才能提「和平并入」（和 TALKCD 同一种写法）
   *   warT     最近一次被宗主拖进战争的回合（"未被卷入 10 回合"读它）
   *
   * 朝贡不存账 —— 每回合现算现转，FLOWC 上记一笔（gain.tribute / loss.tribute），
   * 和贸易、俸禄同一套流水，国家卡的收支行里能直接对账。 */
  var PUPPET = Object.create(null);
  /* 受降选择卡（v13）：玩家在投降线上是胜方时弹一张「全吞 / 扶植傀儡」。
   * 和谈判桌共用同一个弹窗（同一套纸面语汇），所以这里只存"谁向谁受降"。
   * open 为真时 trySurrender 不再重复掷 —— 否则玩家还没选，下回合又弹一次。 */
  var SURR = { open: false, loser: 0, winner: 0 };
  /* 停战冷却（v10）：'a|b' → 到这个回合之前不许重新宣战。
   * AI 互战要"打了就别隔回合又打"，否则同一对邻居会变成永动机。
   * 玩家不受它限制（按钮本来就在玩家手里），所以只给 AI 决策读。 */
  var PEACECD = Object.create(null);
  /* 「世界消息」（v15，前身是 v10 的 WNEWS）：AI 之间的事攒在这里等送达。
   * 和 v10 的区别：v10 是**当回合就推**（地图有迷雾、纪要却全知），
   * 现在每一条入队时都记下 evtTurn / delay / tier，结算尾只放**到期**的。
   * 结构（也原样进存档）：
   *   { text, cls, kind, parties:[a,b], evtTurn, delay, tier,
   *     rumour:0|1, mis:[…]（风闻误指的国家）, rt（风闻正文） } */
  var PNEWS = [];
  /* 还没被更正的「风闻」：等**同一对国家（或被误指的那国）**再出实讯、
   * 或者玩家的密探探到它，就补一条「更正：前讯有误」。最多挂 12 条 ——
   * 风闻本来就不该记得太清楚。 */
  var RUMOURS = [];
  /* bench 三项（验收 ⑥）：各档平均送达延迟 / 被"未知国"丢弃的条数 / 风闻率。
   * 风闻率的分母是**0 档入队条数**而不是全部入队条数 —— 1/2 档永不走样，
   * 混着算会把 15% 稀释成个位数，那个数就没法验收了。 */
  var NSTAT = {
    byTier: [{ n: 0, sum: 0 }, { n: 0, sum: 0 }, { n: 0, sum: 0 }],
    enq0: 0, rumour: 0, dropped: 0, delivered: 0
  };
  /* 谈判卡：open = 开着没；to = 正在谈的那个国家 */
  var TALK = { open: false, to: 0 };

  /* 可见性缓存：visOf 在渲染/注记/小地图里被调用几十万次，
   * 逐省现算邻接 × REL × 交战会卡住底图烘焙。只在"迷雾可能变了"时重建一次。 */
  var VIS = { dirty: true, arr: null, n: 0 };
  var VIS_UNKNOWN = 0, VIS_SEEN = 1, VIS_REAL = 2;

  AO.resSim = SIM;
  AO.resCentral = CENTRAL;
  AO.resPop = POP;
  AO.resFreight = FREIGHT_LV;
  AO.resWall = WALL;
  AO.resSmelt = SMELT;
  AO.resWash = WASH;
  AO.resIronAcc = IRONACC;
  AO.resSchool = SCHOOL;
  AO.resMarket = MARKET;
  AO.resBuilder = BUILDER;
  AO.resGranary = GRANARY;
  AO.resUniversity = UNIVERSITY;
  AO.resFactory = FACTORY_BLD;
  /* 整张通用设施表（学校/市场/兵营/军械坊…都在这张 UNIV 里）。
   * 导出它是为了测试能直接给某一国"造"一座兵营来验保留座数 ——
   * 逐个 kind 各导一个 AO.resXxx 只会让出口越来越长。
   * **故意不叫 resXxx**：测试里有"扫所有 res* 表来数工地"的写法，
   * 叫 resUniv 会让学校/兵营这些表被数两遍（踩过一次）。 */
  AO.univAll = UNIV;
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
    barracks: BARRACKS, armory: ARMORY, stable: STABLE, shipyard: SHIPYARD,
    factory: FACTORY_BLD
  };
  AO.resWar = {
    army: ARMY, generals: GENERALS, wars: WARSET, occupy: OCCUPY, siege: SIEGE,
    blockade: BLOCKADE, dead: DEAD, recruitQ: RECRUITQ, base: WARBASE
  };
  /* 外交层（v9）：条约 / 战争分 / 冷却 / 贸易累计。UI 与测试都从这里取，
   * 不再各自去摸闭包里的变量名。 */
  AO.resDiplo = {
    allies: ALLIES, naps: NAPS, score: WSCORE, cd: DIPCD, talkCd: TALKCD,
    prop: DIPPROP, tradeAcc: TRADEACC, relAcc: RELACC,
    /* v13：傀儡表（读）+ 受降卡状态。写一律走下面那几个函数。 */
    puppet: PUPPET, surrender: SURR
  };

  /* 一回合里攒下的提示（科研解锁/完成、本省欠费停产），
   * 等 nextTurn 刷完界面再挑当前看得见的国家/省份报出来 —— 64 个国家一起喊会糊成一片。 */
  var NOTES = [];

  /* =============================================================
   * 「世界消息」：新闻也走情报渠道（v15）
   *
   * v10 的做法是"AI 之间出事 → 攒进 WNEWS → 结算尾推给玩家"。问题一眼可见：
   * **地图有迷雾，纪要却是全知的** —— 两支你从没听说过的军队在千里之外互宣，
   * 下个回合你就收到了消息，情报署形同虚设。
   *
   * 现在这条管线是一份**要走完路才送得到的邸报**，三个环节各管一件事：
   *
   *   ① worldNews(text, cls, meta)  入队时按**事件发生时**的预算档判定两件事：
   *      "能不能听到"（边境 / 已知国 / 已知国+战况）和"要走多久"（5~8 / 3~4 / 1 回合）。
   *      0 档另有 15% 会走样 —— 传到耳朵里的不是消息，是风闻。
   *   ② flushWorldNews()  逐条查 turnNo − evtTurn ≥ delay，到期的才进纪要，
   *      每回合仍 cap 条；**没到期的留队下回合再查**（晚到，不是丢弃）。
   *      中途升档 → 按新档更短的时滞重判，够久就提前送达（花钱买到了快讯）。
   *   ③ 送达  每条带【十年七月】式的事件时间戳 +「（数月前）」的迟到换算；
   *      迟报淡黄斜体、风闻虚线框、即时确报照旧墨色。
   *
   * 三条纪律（写在这里是因为它们都是"为什么"）：
   *   · 涉玩家的事件**不进这个队** —— 那是你自己的仗，当回合就该知道；
   *   · 双方都未知的国家 → 静默丢弃：你连这两个国家都没听说过，哪来的消息；
   *   · 时滞在**入队那一刻**掷定，之后不再重掷 —— 否则读一次档就能刷出更快的消息。
   * ============================================================= */

  function newsCfg() { return (AO.INTEL && AO.INTEL.news) || {}; }

  /* 玩家国的"耳目圈"：自国省份 + 已探省份的邻国。
   * 为什么把已探省份也算进来：你测绘过的那片地就是你的耳目所及 ——
   * "我踏勘过的山口那边打起来了"比"我领土那边"更符合情报工作的直觉。
   * 一回合算一次（按 turnNo 缓存）：worldNews 一回合可能被调十几次，
   * 而每次都要扫 1100 个省的话，结算尾就是白白多出几万次邻接遍历。 */
  var NEWS_ADJ = null, NEWS_ADJ_T = -1;
  function newsAdjSet() {
    if (NEWS_ADJ && NEWS_ADJ_T === turnNo) return NEWS_ADJ;
    var set = Object.create(null), w = state.world, i, j;
    if (w && PLAYER) {
      var E = EXPLORED[PLAYER] || {};
      for (i = 0; i < w.provinces.length; i++) {
        var p = w.provinces[i];
        if (!p || !p.owner) continue;
        if (p.owner !== PLAYER && !E[p.id]) continue;
        var nb = p.neighbors || [];
        for (j = 0; j < nb.length; j++) {
          var q = pOf(nb[j]);
          if (q && q.owner && q.owner !== PLAYER) set[q.owner] = 1;
        }
      }
    }
    NEWS_ADJ = set; NEWS_ADJ_T = turnNo;
    return set;
  }
  /* 迷雾一变（探到新省 / 换国 / 读档），耳目圈就作废 */
  function newsFogTouch() { NEWS_ADJ = null; NEWS_ADJ_T = -1; }

  /* 事件时间戳：【十年七月】。历法算不出来时退回【第37回合】——
   * 那种档里"几年几月"是编不出来的，硬编就是假古董。 */
  function newsStamp(t) {
    t = t === undefined ? turnNo : (t | 0);
    if (AO.calTag) return '【' + AO.calTag(t) + '】';
    return '【第' + t + '回合】';
  }
  /* 迟到换算：迟 1~11 回合 = 数月前；12~23 = 去年；再往上按年数说。
   * 为什么不写"迟 5 个月"：驿马不会告诉你它走了几个月，只会告诉你"这是早几个月的事"。 */
  function newsLateWord(age) {
    var N = newsCfg(), per = (AO.CAL && AO.CAL.perYear) || 12;
    age = age | 0;
    if (age < 1) return '';
    if (age < (N.lateMid || 12)) return '（数月前）';
    if (age < (N.lateOld || 24)) return '（去年）';
    return '（' + Math.max(2, Math.floor(age / per)) + '年前）';
  }

  /* 这一段消息，玩家这个档位听不听得见？ */
  function newsHeard(it, tier) {
    var P = it.parties || [], i;
    if ((tier | 0) <= 0) {
      /* 无预算：只听得见**边境**的事 —— 任一方与玩家国或已探省份接壤。
       * 内陆两国互宣？那是别人的历史，你连信儿都没有。 */
      var adj = newsAdjSet();
      for (i = 0; i < P.length; i++) if (adj[P[i] | 0]) return true;
      return false;
    }
    /* 常规 / 重金：**已知国家**的事。判据和情报署「已知国家」那张表同一把尺
     * （治理面板 :6869 —— 已探集里有它的省，或者就挨着我），
     * 所以面板上列得出来的国家，它的事才听得见； inland 那些从没见过的？
     * 那是别人的历史，跟你没关系。 */
    if (!P.length) return true;          // 没点名国家的消息（旧调用点）：不拦
    var adj2 = newsAdjSet();
    for (i = 0; i < P.length; i++) {
      var c2 = P[i] | 0;
      if (countryKnown(c2) || adj2[c2]) return true;
    }
    return false;
  }
  /* 时滞：按档掷。入队那一刻掷一次，之后不再改 —— 见上面第③条纪律。 */
  function newsDelayRoll(tier) {
    var N = newsCfg(), r = (N.delay && N.delay[tier | 0]) || [1, 1];
    var lo = r[0] | 0, hi = Math.max(lo, r[1] | 0);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  function newsDelayLo(tier) {
    var N = newsCfg(), r = (N.delay && N.delay[tier | 0]) || [1, 1];
    return Math.max(1, r[0] | 0);
  }

  /* 风闻（0 档，15%）：两种走样，按"事件是什么"改写。
   *   张冠李戴  说反方向，或把一方换成**另一个接壤邻国**
   *             （边境上传来传去，张三李四本来就分不清）；
   *   夸大其词  宣战说成"灭国在即"，都城易手说成"王国已亡"。
   * 只改写 kind 认得的几种，其余照抄原文再加一句"传言如此"——
   * 为了改几句自由文案去解析句法，那才是真的会出错。 */
  function newsAltNeighbor(P) {
    var adj = newsAdjSet(), cand = [], i;
    for (i in adj) {
      var cid = +i;
      if (!cid || (P || []).indexOf(cid) >= 0) continue;
      if (countryDead(cid)) continue;
      cand.push(cid);
    }
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : 0;
  }
  function newsRumour(it) {
    var P = it.parties || [], A = P[0] ? nameOf(P[0]) : '', B = P[1] ? nameOf(P[1]) : '';
    var alt = newsAltNeighbor(P), k = it.kind || '', mix = Math.random() < 0.5;
    var t = '', mis = P.slice();
    if (mix) {
      /* 张冠李戴 */
      if (k === 'war' && A && B) {
        if (alt) { t = nameOf(alt) + ' 向 ' + (Math.random() < 0.5 ? A : B) + ' 宣战'; mis = [alt, P[0]]; }
        else { t = B + ' 向 ' + A + ' 宣战'; mis = [P[1], P[0]]; }
      } else if (k === 'capital' && A && B) {
        t = (alt ? nameOf(alt) : B) + ' 攻破了 ' + A + ' 的都城';
        mis = [alt || P[1], P[0]];
      } else if (A && B) {
        t = (alt ? nameOf(alt) : B) + ' 与 ' + A + ' 起了刀兵';
        mis = [alt || P[1], P[0]];
      }
    } else {
      /* 夸大其词 */
      if (k === 'war' && A && B) t = A + ' 兴兵伐 ' + B + '，' + B + ' 灭国在即';
      else if (k === 'capital' && B) t = B + ' 王国已亡 —— 都城陷落，宗庙倾覆';
      else if ((k === 'fall' || k === 'annex') && A) t = A + ' 举国震恐，宗庙将不保';
      else if (A && B) t = A + ' 与 ' + B + ' 已成死局，' + B + ' 恐难久持';
    }
    if (!t) t = it.text + '（传言如此，未得其详）';
    return { text: t, mis: mis };
  }

  /* 重金档附的那一行：战况。分数表的方向写在 WSCORE 里（a = 小 id 那方），
   * 这里只负责按同一个方向念出来，免得面板上 A 的分记到 B 头上。 */
  function newsScoreLine(a, b) {
    a = a | 0; b = b | 0;
    if (!a || !b || a === b) return '';
    var s = WSCORE[warKey(a, b)];
    if (!s) return '';
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return '（战况 ' + ownerName(lo) + ' ' + (s.a | 0) + ' : ' + (s.b | 0) + ' ' + ownerName(hi) + '）';
  }

  /* 入队。meta = { evtTurn, parties:[a,b], kind } —— 三个都能省，省了就是
   * "当回合、没点名、说不清是什么事"（旧调用点的形状）。 */
  function worldNews(text, cls, meta) {
    meta = meta || {};
    var parties = [], i;
    if (meta.parties) for (i = 0; i < meta.parties.length; i++) {
      var cid = meta.parties[i] | 0;
      if (cid) parties.push(cid);
    }
    var evt = meta.evtTurn === undefined ? turnNo : (meta.evtTurn | 0);
    /* 工坊模式：没有"玩家"，也就没人要听 */
    if (!PLAYER) return false;
    /* 涉玩家 → 不进队（调用点自己已经推了 NOTES，那一条是即时的）。
     * 这里再审一次不是多余：将来新加的调用点忘了判玩家，也不会变成"你自己的仗
     * 还要等五回合才知道"这种荒唐事。 */
    if (parties.indexOf(PLAYER) >= 0) return false;
    var tier = budgetOf(PLAYER), N = newsCfg();
    var it = {
      text: text, cls: cls || 'warn', kind: meta.kind || 'other',
      parties: parties, evtTurn: evt, tier: tier, rumour: 0, mis: null, rt: ''
    };
    if (!newsHeard(it, tier)) { NSTAT.dropped++; return false; }
    it.delay = newsDelayRoll(tier);
    if (tier <= 0) {
      NSTAT.enq0++;
      if (Math.random() < (N.rumourP === undefined ? 0.15 : N.rumourP)) {
        var rm = newsRumour(it);
        if (rm) { it.rumour = 1; it.mis = rm.mis; it.rt = rm.text; NSTAT.rumour++; }
      }
    }
    PNEWS.push(it);
    var qmax = N.queueMax || 160;
    if (PNEWS.length > qmax) PNEWS.splice(0, PNEWS.length - qmax);
    return true;
  }

  /* 送达：这一条从"在路上"变成"你知道了"。
   * 只进 NOTES —— 不写战报。为什么：战报是"天下共读的战事记录"（会战、攻城、
   * 无路可走这些逐条都在里面），它本来就是另一条线；把邸报再抄一份进去，
   * 同一件事会在战报里出现两次（一次"发生"，一次"听说"），读起来更乱。
   * 玩家真正读的那份"纪要"就是提示条这一行 + 编年史里按事件年份归位的那一条。 */
  function deliverNews(it, tier) {
    var age = turnNo - (it.evtTurn | 0);
    /* 风闻带「风闻：」前缀 —— 提示条上只有一行字，语气得自己说出来：
     * 这一条没核实过，别拿它当国书。 */
    var body = it.rumour ? ('风闻：' + (it.rt || it.text)) : it.text;
    var txt = '🌍 ' + newsStamp(it.evtTurn) + newsLateWord(age) + body;
    if (!it.rumour && (tier | 0) >= (newsCfg().scoreLine || 2) && (it.parties || []).length >= 2) {
      var ws = newsScoreLine(it.parties[0], it.parties[1]);
      if (ws) txt += ws;
    }
    var late = age >= (newsCfg().styleLate || 3);
    var cls = it.rumour ? 'rumour' : (late ? 'late' : (it.cls || 'warn'));
    NOTES.push({
      owner: PLAYER, cls: cls, text: txt,
      /* src：这一条是"世界新闻"（邸报），不是玩家自己的事 ——
       * 纪要的三档过滤就按它分（旧读取不看这个字段，结构向后兼容）。 */
      src: 'world',
      evtTurn: it.evtTurn | 0, late: age | 0, rumour: it.rumour ? 1 : 0,
      /* core = 不带时间戳的正文：编年史拿它和战报里那一条对暗号，
       * 对上了就说明"这件事史书里已经有了"，只补一个「（后闻）」。 */
      core: body
    });
    NSTAT.delivered++;
    var slot = NSTAT.byTier[(it.tier | 0)] || NSTAT.byTier[0];
    slot.n++; slot.sum += Math.max(0, age);
    if (it.rumour) {
      RUMOURS.push({ mis: (it.mis || it.parties || []).slice(0, 4), text: body, at: turnNo });
      if (RUMOURS.length > 12) RUMOURS.shift();
    } else {
      newsCorrectBy(it.parties || [], body);
    }
  }

  /* 实讯到了 → 之前说错的那条当场"打脸"。
   * 只认**同一个国家（或被误指的那个国家）**：这条更正是给玩家的一个交代，
   * 不是全天下的勘误表。 */
  function newsCorrectBy(parties, realText) {
    for (var i = RUMOURS.length - 1; i >= 0; i--) {
      var r = RUMOURS[i], hit = false;
      for (var j = 0; j < (r.mis || []).length; j++) {
        if ((parties || []).indexOf(r.mis[j]) >= 0) hit = true;
      }
      if (!hit) continue;
      RUMOURS.splice(i, 1);
      NOTES.push({ owner: PLAYER, cls: 'warn', noYl: 1, src: 'world',
        text: '更正：前讯有误，实为「' + realText + '」' });
    }
  }
  /* 密探回报 → 就地更正。风闻说的是"某国如何如何"，密探亲眼看过了，
   * 那就没有"再等等看"的道理。 */
  function newsProbeCorrect(cid) {
    cid = cid | 0;
    for (var i = RUMOURS.length - 1; i >= 0; i--) {
      var r = RUMOURS[i];
      if ((r.mis || []).indexOf(cid) < 0) continue;
      RUMOURS.splice(i, 1);
      NOTES.push({ owner: PLAYER, cls: 'ok', noYl: 1,
        text: '更正：前讯有误 —— 密探自 ' + nameOf(cid) + ' 回报，前番风闻不实' });
    }
  }

  /* 结算尾：只放**到期**的，剩下的留队。
   * 提前送达的条件是"中途升了档，且已经过了新档的时滞"——
   * 花钱买快讯这件事，本来就不该等原来那匹驿马。 */
  function flushWorldNews() {
    if (!PLAYER) { PNEWS.length = 0; return 0; }   // 工坊模式：没人要听
    if (!PNEWS.length) return 0;
    var cap = (AO.AIWAR && AO.AIWAR.newsPerTurn) || newsCfg().cap || 2;
    var tier = budgetOf(PLAYER), out = 0, keep = [], i, it;
    for (i = 0; i < PNEWS.length; i++) {
      it = PNEWS[i];
      if (out >= cap) { keep.push(it); continue; }
      var age = turnNo - (it.evtTurn | 0), d = it.delay | 0;
      if (tier > (it.tier | 0)) {
        var d2 = newsDelayLo(tier);
        if (age >= d2) d = Math.min(d, d2);
      }
      if (age < d) { keep.push(it); continue; }
      deliverNews(it, tier);
      out++;
    }
    PNEWS.length = 0;
    for (i = 0; i < keep.length; i++) PNEWS.push(keep[i]);
    /* 统计回填给 18-ai（bench 策略 H 要读"放出了几条远方大事"） */
    if (AO.aiDebug && AO.aiDebug.war) AO.aiDebug.war.news += out;
    return out;
  }

  /* 存档：队列 + 待更正的账 + 统计（**不升 SAVE_VER**，旧档缺这一块 = 空队） */
  function newsSave() {
    return { Q: PNEWS.slice(0, 160), R: RUMOURS.slice(0, 12), S: NSTAT };
  }
  function newsLoad(d) {
    PNEWS.length = 0;
    RUMOURS.length = 0;
    NSTAT = {
      byTier: [{ n: 0, sum: 0 }, { n: 0, sum: 0 }, { n: 0, sum: 0 }],
      enq0: 0, rumour: 0, dropped: 0, delivered: 0
    };
    newsFogTouch();
    if (!d || typeof d !== 'object') return;      // 旧档：空队起步，和新开一局同一条路
    var i, it, q = d.Q || [];
    for (i = 0; i < q.length && i < 160; i++) {
      it = q[i];
      if (!it || !it.text) continue;
      PNEWS.push({
        text: String(it.text), cls: it.cls || 'warn', kind: it.kind || 'other',
        parties: (it.parties || []).slice(0, 4),
        evtTurn: it.evtTurn | 0,
        delay: Math.max(0, it.delay | 0) || 1,
        tier: it.tier | 0,
        rumour: it.rumour ? 1 : 0,
        mis: (it.mis || []).slice(0, 4),
        rt: it.rt || ''
      });
    }
    var r = d.R || [];
    for (i = 0; i < r.length && i < 12; i++) {
      if (!r[i] || !r[i].mis) continue;
      RUMOURS.push({ mis: r[i].mis.slice(0, 4), text: r[i].text || '', at: r[i].at | 0 });
    }
    var s = d.S || {};
    if (s.byTier && s.byTier.length) {
      for (i = 0; i < 3; i++) {
        var b = s.byTier[i] || {};
        NSTAT.byTier[i] = { n: Math.max(0, b.n | 0), sum: Math.max(0, +b.sum || 0) };
      }
    }
    NSTAT.enq0 = Math.max(0, s.enq0 | 0);
    NSTAT.rumour = Math.max(0, s.rumour | 0);
    NSTAT.dropped = Math.max(0, s.dropped | 0);
    NSTAT.delivered = Math.max(0, s.delivered | 0);
  }

  AO.resWorldNews = worldNews;
  AO.resFlushWorldNews = flushWorldNews;
  AO.resWorldNewsQueue = PNEWS;
  /* 测试 / bench 只从这里读新闻管线的三样：队列、待更正、统计 */
  AO.resNews = {
    queue: PNEWS, rumour: RUMOURS, stat: function () { return NSTAT; },
    save: newsSave, load: newsLoad,
    stamp: newsStamp, lateWord: newsLateWord,
    heard: newsHeard, adj: newsAdjSet, correct: newsProbeCorrect,
    reset: function () { PNEWS.length = 0; RUMOURS.length = 0; NEWS_ADJ = null; NEWS_ADJ_T = -1; }
  };

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
    /* v11：词条效果先按「资历 × 怨气」的倍率缩放，再叠到科技加成上 ——
     * 一位怨气 90 的老吏，他的"理财 +20%"只剩 +10%（倍率 0.55）。
     * 这里调 offFx()，面板 tooltip 也调 offFx()，两边是同一个函数。 */
    offNorm(off);
    var fx = offFx(off);
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
    t -= (PMOD(pid, owner).turnCut || 0);
    /* 下限 1 回合：能不能"一回合起一座"是另一条平衡线。 */
    return Math.max(1, t);
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

  /* ---------------- 保留座数（19-repair.js 的 KEEP 表） ----------------
   * 一座城某类建筑可能有 N 座，玩家可以只留 K 座在跑（见 js/19-repair.js）。
   * 停掉的座**不缴维护、不产出**，但也不失修 —— 所以这里只做一件事：
   * 把 tiers / 座数裁到 K。裁的时候**先保 Lv2**（同样维护费，产量翻倍），
   * 剩下的名额才给 Lv1。
   *
   * 为什么裁在"计算入口"而不是结算时扣产量：维护费和产量必须同源。
   * 如果只把产量砍半、维护费照全收，玩家就会觉得"停了还要交钱"，
   * 那这个开关就没人敢用了。 */
  function keepCap(pid, kind) {
    var R = AO.rep;
    if (!R || !R.keep || pid === undefined || pid === null || !kind) return null;
    return R.keep(pid, kind);
  }
  /* 资源建筑：{1:n1, 2:n2} 裁到保留座数 */
  function activeTiers(pid, kind, s) {
    var t = s.tiers || { 1: s.built || 0, 2: 0 };
    var k = keepCap(pid, kind);
    if (k === null) return t;
    var n2 = Math.min(t[2] || 0, k);
    var n1 = Math.min(t[1] || 0, k - n2);
    return { 1: Math.max(0, n1), 2: Math.max(0, n2) };
  }
  /* 通用设施（学校/市场/兵营…）：只有座数，直接裁 */
  function activeN(pid, kind, n) {
    var k = keepCap(pid, kind);
    if (k === null) return n | 0;
    return Math.max(0, Math.min(k, n | 0));
  }
  /* 玩家把这一类这一省**主动停了**（保留 0 座）。
   * 主动停 ≠ 失修：不缴维护、不产出，但耐久/座数一点不掉，随时能开回来。
   * 面板上"失修"一列不计它们。 */
  function keepOff(pid, kind) {
    var k = keepCap(pid, kind);
    return k !== null && k <= 0;
  }

  /* 单座建筑每回合产多少 → 该资源这一回合总产出（分档求和）。
   * pid/kind 给了就按"在跑的座数"算 —— 面板上显示的产量和结算扣的钱必须同源。 */
  function simPerTurn(s, def, pid, kind) {
    var t = activeTiers(pid, kind, s);
    return (def.per || 0) * (t[1] || 0) + (def.per2 || def.per || 0) * (t[2] || 0);
  }

  /* 这一袋建筑这一回合的维护需求（铁 + 金），按档位加权。
   * owner 给了就把「标准工料」的折扣算进去（−25%），没给按原价 ——
   * 老调用点（预览、对比文案）不传 owner 也不会算错，只是不含科技加成。
   * pid/kind 给了就只算**在跑的座**（停掉的座不缴维护，见 activeTiers）。 */
  function maintDue(s, def, owner, pid, kind) {
    /* 枯竭 / 铁矿休眠的座数不收维护 —— 和结算里那条 `continue` 同一口径，
     * 否则维修面板会劝玩家去"修"一座根本不收费的矿（面板数字必须等于真扣的数）。 */
    if (s && (s.gone || (kind === 'iron' && s.cool > 0))) return { iron: 0, gold: 0 };
    var t = activeTiers(pid, kind, s);
    var a = def.maint || {}, b = def.maint2 || a, out = {};
    var cut = owner ? 1 - (MODS(owner).maintCut || 0) : 1;
    var ks = ['iron', 'gold'], i, k;
    for (i = 0; i < ks.length; i++) {
      k = ks[i];
      out[k] = ((a[k] || 0) * (t[1] || 0) + (b[k] || 0) * (t[2] || 0)) * cut;
    }
    return out;
  }

  /* ---------------- 养得起几座就养几座（v18.5 / v18.8 改成反馈式） ----------------
   * 欠费停产是**整类一起停**：4 座农场 + 省库 2 铁 → 4 座全停、全欠着，
   * 而它其实养得起 2 座。所以按"能养几座"给每类设保留座数
   * （19-repair 的 KEEP，和玩家在「维修」面板手动调的是**同一个开关**）。
   *
   * **v18.8 重做：从"按库存预算"改成"欠费反馈"**。老版本（按这一回合的库存
   * 算能养几座）实测把产出砍了 20%：它只看**此刻的存货**，而省里的收入
   * （铁税 / 人口税）是维护**之后**才进账的 —— 于是它总是少算，把本来付得起
   * 的座也停掉。探针（diag/stuck-probe）对照：在跑 622 / 真在产 619，
   * 而关掉裁座是 1106 / 777。指标漂亮了，东西少产了两成。
   *
   * 新规则（每条每省各自一套，慢速回差）：
   *   · 上一回合**真的欠费**（halted）→ 少养一座（这是唯一会裁座的时机）；
   *   · 没欠费、而且是我们设过的 → 每 recoverEvery 回合养回一座；
   *   · 养满 → 把保留座数清成 null（全开），不留痕迹。
   * 这样欠费只活一回合，产出不掉：只有真的付不起的那一座会让位。
   *
   * 只裁**资源七类**（学校/市场是开/关二态，停了在结算里同样写 halted，
   * 裁它们既省不了指标、又让面板分不清"欠费停"和"主动停"）。
   * 只碰**没人设过**或**我们自己设过**的类：玩家手调的、战时换挡设的比例都不动。
   * 只管 **AI 国**：玩家有「维修」面板可以自己调，自动去改是越权。 */
  var AUTOK = Object.create(null);   // pid -> { kind: { n, t } }：我们设的座数与回合
  var TRIMSTAT = { n: 0, cut: 0, back: 0 };  // 设过几处 / 裁了几次 / 放回几次
  function trimSeats(pid, kind) {
    var bag = SIM[pid | 0];
    if (AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind]) {
      var s = bag && bag[kind];
      if (!s || !s.built || s.gone) return 0;      // 枯竭的不收维护，也不用养
      if (kind === 'iron' && s.cool > 0) return 0; // 休眠矿同 maintDue 的口径
      return s.built;
    }
    var st = univOf(kind, pid | 0);
    return (st && st.n) || 0;
  }
  /* 按座数比例砍欠账（停掉的座不欠）；砍到 0 就等于"这笔账结了" */
  function trimArrears(pid, kind, built, can) {
    var s = (AO.RESOURCE_BY_KEY && AO.RESOURCE_BY_KEY[kind])
      ? (SIM[pid | 0] && SIM[pid | 0][kind]) : univOf(kind, pid | 0);
    if (!s || !s.mAcc) return;
    var r = built > 0 ? can / built : 0;
    s.mAcc.iron = (s.mAcc.iron || 0) * r;
    s.mAcc.gold = (s.mAcc.gold || 0) * r;
  }
  function trimKeep(pid, owner) {
    var T = AO.GOV && AO.GOV.trimKeep, R = AO.rep;
    if (!T || T.on === false || !R || !R.setKeep) return 0;
    owner = owner | 0;
    if (!owner || owner === (PLAYER | 0)) return 0;      // 玩家自己调，不越权
    var bag = SIM[pid | 0];
    if (!bag) return 0;
    var gap = T.recoverEvery === undefined ? 6 : T.recoverEvery;
    var mine = AUTOK[pid | 0];
    var changed = 0, k;
    for (k in AO.RESOURCE_BY_KEY) {
      var s = bag[k];
      if (!s || !(s.built > 0)) continue;
      if (s.gone || (k === 'iron' && s.cool > 0)) continue;
      var built = s.built | 0;
      var cur = R.keep(pid | 0, k);
      var rec = mine && mine[k];
      /* 别人改过我们设的数（战时换挡 / 读档 / 手改）→ 放手，这一类别再管 */
      if (rec && cur !== rec.n) {
        delete mine[k];
        rec = null;
        if (!Object.keys(mine).length) { delete AUTOK[pid | 0]; mine = undefined; }
      }
      if (cur !== null && !rec) continue;                // 不是我们设的：不动
      var eff = cur === null ? built : Math.min(cur, built);
      var can = eff;
      if (s.halted) can = Math.max(0, eff - 1);          // 上一回合真欠费 → 让一座
      else if (rec && turnNo >= (rec.t || 0) + gap) can = Math.min(built, eff + 1);
      if (can === eff) continue;
      if (can >= built) {
        R.setKeep(pid | 0, k, null);                     // 养满了：还给"全开"
        if (rec) {
          delete mine[k];
          if (!Object.keys(mine).length) { delete AUTOK[pid | 0]; mine = undefined; }
        }
        TRIMSTAT.n++; changed++;
      } else {
        R.setKeep(pid | 0, k, can);
        mine = mine || (AUTOK[pid | 0] = Object.create(null));
        mine[k] = { n: can, t: turnNo };
        if (can < eff) { trimArrears(pid, k, built, can); TRIMSTAT.cut++; }
        else TRIMSTAT.back++;
        TRIMSTAT.n++; changed++;
      }
    }
    return changed;
  }

  /* 付维护：**本省库存 → 中央国库**。
   * 维护是日常开销，不是一次性工程；而且没有矿的省根本没有铁/金袋子，
   * 只能靠中央接济 —— 所以抽税那条规则必须先落地。
   * 小数用 eatAcc 同款"攒整"法：0.2 个/座看着像没付，攒五回合就是 1。
   * 返回 false = 有缺口 → 调用方把这一类建筑标成停产。
   *
   * 「这一回合能花中央多少」由 19-repair.js 在结算开始时批的一笔**拨款**决定
   * （见那里的"四、中央配给"）：省库先掏，不够的从拨款里划，拨款见底就停产。
   * 谁先花由结算顺序决定，玩家真正能调的是"留几座在跑"（保留座数）。
   *
   * 记账：CUR 正指着这个省时，把"本省扣的"和"中央垫的"分别记进两本流水 ——
   * 省卡的收支小结要能说清"维护里有多少是我自己掏的、多少是中央接济的"。 */
  function payMaint(pid, owner, demand, acc, kind) {
    var cen = ensureCentral(owner), bag = SIM[pid];
    var ok = true;
    var F = (CUR.pid === (pid | 0)) ? CUR.F : null;
    var FC = (CUR.owner === (owner | 0)) ? CUR.FC : null;
    var R = AO.rep;
    /* 「能不能动用中央」要**每一次取款都问**：拨款是一笔会被越吃越少的钱，
     * 第一个资源（铁）取完可能就见底了，金那一段就不该再批。 */
    var canPool = R && R.canPool ? R.canPool : null;
    var takePool = R && R.takePool ? R.takePool : null;
    var fromPool = 0;
    for (var k in demand) {
      /* 求和不封顶：以前的 `if (acc[k] > 40) acc[k] = 40` 会把欠账**抹掉**，
       * 显得"国家悄悄替你还了一笔"。现在只在展示上封顶（见 panelNeed），
       * 账本身一直记得 —— 修好时由 repLive().repair() 一次清零。 */
      acc[k] = (acc[k] || 0) + demand[k];
      var need = Math.floor(acc[k]);
      if (need <= 0) continue;
      var got = 0;
      if (bag && bag[k] && bag[k].stock > 0) {  // 本省有这种资源才扣得了
        var t1 = Math.min(bag[k].stock, need);
        bag[k].stock -= t1; got += t1;
        if (F) { F.loss[k] = (F.loss[k] || 0) + t1; F.d.maint[k] = (F.d.maint[k] || 0) + t1; }
      }
      if (got < need && (!canPool || canPool())) {
        /* 从中央拨款里划：够多少划多少，不够就是不够（拨款花完就该轮到后面的省了）。 */
        var want = Math.min(cen[k] || 0, need - got);
        var t2 = takePool ? takePool(want) : want;
        if (t2 > 0) {
          cen[k] = (cen[k] || 0) - t2; got += t2; fromPool += t2;
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
    if (R && fromPool > 0 && R.noteSpent) R.noteSpent(owner, fromPool);
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
      /* 产线中心刚建成 → 默认**全产能给第一条线**（军械坊 = 兵刃）。
       * 为什么不像旧版那样"等玩家下单"：旧版面板上是一排「接单」按钮，
       * 不点也知道该点；现在是一张分配表，全 0 的坊看起来像坏了。
       * 玩家随时可以在 ? 面板里改（或「清空」让它空转）。 */
      if (MILL_KINDS.indexOf(key) >= 0 && st.n === 1) {
        var p0 = pOf(pid), ow0 = p0 ? p0.owner : 0;
        var pool0 = AO.MILL.poolOf[key], first0 = AO.MILL.lines[pool0][0];
        var m0 = millOf(ow0);
        if (!allocSum(ow0, pool0)) {
          /* 刚建成 → 默认把这一池的点给第一条线（军械=刀 / 马厩=驽马 / 船坞=桨帆）。
           * 全 0 的池看起来像坏了，而"先动起来"永远比"先想清楚"更不容易卡住玩家。 */
          setLineAlloc(ow0, first0, Math.min(lineWork(ow0, first0), millCap(pid, key)), true);
        }
      }
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
      FLOW[pid] = newFlow();
    }
    for (var co in CENTRAL) {
      FLOWC[co] = { gain: Object.create(null), loss: Object.create(null),
                    d: { eat: Object.create(null), tax: Object.create(null),
                         maint: Object.create(null), maintC: Object.create(null) } };
    }
    /* ⓪b 中央拨款：每个国家批一笔"这回合能动的维护钱"（见 js/19-repair.js）。
     * 必须**在 ① 维护之前**批好 —— 批的额度按上一回合各档实付估，
     * 所以它是"回合开始时的存量"，和本回合的产出无关。 */
    if (AO.repTurnStart) {
      var owners = Object.create(null);
      for (pid in SIM) {
        prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
        if (prov && prov.owner) owners[prov.owner] = 1;
      }
      for (var ow in owners) AO.repTurnStart(+ow);
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

      /* ①-0 养得起几座就养几座（v18.5）：按库存把"能养的座数"写进保留表。
       * 必须在 ① 维护**之前** —— 这一回合就按新座数收钱，否则先按全座收一遍，
       * 收不起再改成 0 座，等于白停一回合。 */
      trimKeep(pid, owner);

      /* ① 维护：**在产出之前**算，按建筑类型各自付、各自停。
       * 付得起 → 当回合照常出产；付不起 → 这一类当回合起产量 0，凑齐了自动复工。
       * 枯竭的不收维护（矿脉都没了，没什么可养的），否则那些省会永远失血。
       * 维护只按**在跑的座数**收（玩家在右上「维修」里按城调保留几座）。 */
      var haltedNow = [];      // { t: 名字, obj: 状态袋, fresh: 这一回合刚停, iron: 铁需求 }
      for (key in bag) {
        s = bag[key];
        def = AO.RESOURCE_BY_KEY[key];
        if (!def) continue;
        if (!s.built || s.gone) { s.halted = false; continue; }
        /* 铁矿「深层休眠」（v18 追加一补课）：和枯竭一样不产、不收维护 ——
         * 48 回合的等待期还要按座收铁收金，那不是在等矿醒，是在等死。
         * 别的资源的冷静期照旧收（3~9 回合的短休耕，是"地还在，只是歇一季"）。 */
        if (key === 'iron' && s.cool > 0) { s.halted = false; continue; }
        was = s.halted;
        var rDue = maintDue(s, def, owner, pid, key);
        s.halted = !payMaint(pid, owner, rDue, s.mAcc, key);
        if (s.halted) {
          haltedNow.push({ t: def.build, cls: 'res', obj: s, fresh: !was,
            iron: rDue.iron || 0, def: def, key: key });
        }
      }
      /* 学校 / 市场 / 建造坊…：同一种形状，一遍循环处理完。
       * 通用设施的产出是**离散**的（学校产科研点、兵营征兵、工厂开一条产线），
       * "留半座"没有意义 —— 所以它们的保留座数只有两态：全开 / 全停（见面板）。
       * 全停的时候直接把 halted 挂上：下面所有 `!st.halted` 的产出判断
       * 就自动全关了，不必在二十几处产出点各加一个 if。 */
      for (ki = 0; ki < UNIV_KINDS.length; ki++) {
        var kind = UNIV_KINDS[ki], udef = univDef(kind), ust = UNIV[kind][pid];
        if (!ust) continue;
        var wasU = ust.halted;
        /* kind 就是这一类的设施键（school / market / …），19-repair 拿它查保留座数 */
        var uk = kind;
        var uoff = keepOff(pid, uk);
        if (!(ust.n > 0)) ust.halted = false;
        else if (uoff) ust.halted = true;              // 玩家停的：不缴费、不产出
        else {
          var uDue = {
            iron: (udef.maint.iron || 0) * ust.n,
            gold: (udef.maint.gold || 0) * ust.n
          };
          ust.halted = !payMaint(pid, owner, uDue, ust.mAcc, uk);
          if (ust.halted && !uoff) {
            haltedNow.push({ t: udef.cn, cls: 'uni', obj: ust, fresh: !wasU,
              iron: uDue.iron, def: udef, key: uk });
          }
        }
      }
      /* 城墙维护（铁 + 金）：和资源建筑同一套 payMaint —— 付不起就 halted，
       * 区别是墙"停产"的表现是**年久失修**（耐久每回合 −5），不是产量归零。
       * 耐久本身的涨落放在战争段末尾（settleWalls）：要先知道"这回合打没打仗"。 */
      var wst = WALL[pid];
      if (wst && wst.lv > 0) {
        var wasW = wst.halted;
        /* 城墙也是"开/停"二态：停了就不缴维护，耐久原地不动（不烂，但也不修） */
        if (keepOff(pid, 'wall')) wst.halted = true;
        else {
          var wDue = wallMaintDue(wst, owner);
          wst.halted = !payMaint(pid, owner, wDue, wst.mAcc, 'wall');
          if (wst.halted) {
            haltedNow.push({ t: '城墙', cls: 'wall', obj: wst, fresh: !wasW, iron: wDue.iron || 0 });
          }
        }
      } else if (wst) {
        wst.halted = false;
      }

      /* ①-c 缺铁自救（v18.4）：这一回合**真有**建筑因为没铁停下来了，才去世界市场
       * 按缺口买几单位铁，然后当场补缴（payMaint 只会再要"还差的那部分"—— acc 已经扣过）。
       *
       * 为什么是"事后 + 按缺口零买"，而不是"事前按阈值预买一手"：
       * 预买的铁常常被这一回合的建造吃掉（AI 就在同省开工，铁从省库出），下回合
       * 又是 0，于是每回合买、每回合停 —— 探针实测：整手预买 100 回合买掉 2660 铁
       * （4668 金），停产仍有 151；按缺口零买把同一批停产的钱降到四分之一。
       * 四道闸（AO.GOV.selfBuy）都在 selfBuyIron 里，这里只管"什么时候叫它、叫多少"。 */
      if (haltedNow.length) {
        var needU = 0, hi;
        for (hi = 0; hi < haltedNow.length; hi++) {
          var he = haltedNow[hi];
          if (!he.obj.halted || !(he.iron > 0)) continue;
          /* acc.iron 里剩的就是"这一回合还欠几单位铁"（第一次缴费没付成，acc 没减）。
           * 不能拿"这一回合的需求"当缺口：停的是**金**那一段时，铁的需求早付清了，
           * 再买铁就是白花金（探针里那批省库金不足 5 的省全是这种）。 */
          var macc = (he.obj.mAcc && he.obj.mAcc.iron) || 0;
          needU += Math.floor(macc + 1e-9);
        }
        if (needU > 0 && selfBuyIron(pid, owner, CUR.F, needU) > 0) {
          /* 补缴：按现在的 acc 余额重算一遍需求，付得起就复工。
           * 只能补"铁"那部分缺口 —— 金的缺口买铁治不了，别假装治了。 */
          for (hi = 0; hi < haltedNow.length; hi++) {
            var hn = haltedNow[hi];
            if (!hn.obj.halted) continue;
            if (hn.cls === 'wall') {
              hn.obj.halted = !payMaint(pid, owner, wallMaintDue(hn.obj, owner), hn.obj.mAcc, 'wall');
            } else if (hn.cls === 'res') {
              hn.obj.halted = !payMaint(pid, owner,
                maintDue(hn.obj, hn.def, owner, pid, hn.key), hn.obj.mAcc, hn.key);
            } else {
              hn.obj.halted = !payMaint(pid, owner, {
                iron: (hn.def.maint.iron || 0) * hn.obj.n,
                gold: (hn.def.maint.gold || 0) * hn.obj.n
              }, hn.obj.mAcc, hn.key);
            }
          }
        }
      }
      /* 一个省一回合只报一条：七类建筑一起停的时候，逐条报会刷屏。
       * 只报**这一回合刚停**且补缴后仍然停着的（不然纪要会说一句假话）。 */
      var haltLabels = [];
      for (var hl = 0; hl < haltedNow.length; hl++) {
        if (haltedNow[hl].obj.halted && haltedNow[hl].fresh) haltLabels.push(haltedNow[hl].t);
      }
      if (haltLabels.length && (pid | 0) === selPid) {
        NOTES.push({ owner: owner, pid: pid | 0,
          text: haltLabels.join('、') + ' 维护欠费，停产中（铁/金见底 —— 右上「维修」里调优先档或点「修」）', cls: 'warn' });
      }
      /* ①b 中央拨款位次（19-repair 的 repStep：批"这一回合能动的维护钱"）。
       * 拨款额度按上回合实付估，必须每个省轮到之前都批着。 */
      if (AO.repStep) AO.repStep(owner | 0);

      /* ② 工地推进（枯竭了也照盖完，不半路烂尾） */
      if (WALL[pid] && WALL[pid].site > 0) {
        WALL[pid].site--;
        if (!WALL[pid].site) finishWall(pid | 0);
      }
      /* 熔旧坊改建：和工地同一位次。枯竭矿本身不再有工地（建不了），
       * 所以这一条和上面那段 for (key in bag) 不会抢同一个省。 */
      if (SMELT[pid] && SMELT[pid].site > 0) {
        SMELT[pid].site--;
        if (!SMELT[pid].site) finishSmelt(pid | 0);
      }
      /* 淘金场改建：和熔旧坊同一位次（金矿枯竭后金矿场行不再有工地） */
      if (WASH[pid] && WASH[pid].site > 0) {
        WASH[pid].site--;
        if (!WASH[pid].site) finishWash(pid | 0);
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
        /* 匪乱：爆发后的**下一回合**产出归零（此刻产出已经算完，只能挂在下一回合）。
         * 只看"上一回合爆发的"那一条 —— 标记本身还要挂 3 回合给不安 +10，
         * 但那 3 回合里只有第一回合断产（否则一次匪乱等于三回合绝收，太狠）。 */
        if (BANDIT[pid] && BANDIT[pid].turn === turnNo - 1) continue;
        /* 官员产量加成（劝农使）：乘在**毛产**上，再攒整成整数。
         * 为什么要 pAcc 攒零头：3 × 1.25 = 3.75，直接 round 成 4 等于白送 25%，
         * floor 成 3 等于白干 —— 攒起来下一回合补上，长期平均才真是 1.25 倍。
         * （和 eatAcc / mAcc 是同一套办法，见 payMaint 的注释。） */
        var mul = (pmod.prodMul && pmod.prodMul[key]) || 1;
        /* 占领省：产出乘数随**整合度**爬（0.4 → 0.6），整合完成（OCCUPY 删除）
         * 才回到正式国土的 ×1.0。旧档没有 INTEG 的占领省按 0 算 = ×0.4，
         * 于是"读旧档"和"刚打下来"是同一条路。 */
        if (OCCUPY[pid]) {
          var itg = INTEG[pid];
          mul *= AO.INTEG.prodMul(itg ? itg.v : 0);
        }
        /* 事件带来的临时乘数（渔汛 ×2 / 大旱 ×0.5），和官员加成同一层。
         * 放在这里而不是改 def.per：乘数是有回合数的，改表就回不去了。 */
        if (AO.evtProdMul) mul *= AO.evtProdMul(pid, key);
        var grossF = simPerTurn(s, def, pid, key) * mul;
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
        /* gain 里"纯产出"的那一份单独记一格（d.prod）：gain 还混着熔旧坊/淘金场
         * 的涓流和出口卖货，不拆开的话，20-balance 的干跑预测永远对不出残差。 */
        CUR.F.d.prod[key] = (CUR.F.d.prod[key] || 0) + kept;
        /* 人口增速看的是**真进了仓**的粮：满仓浪费掉的粮不养人，
         * 否则"囤到上限就停"这条规则对人口完全无效。 */
        if (key === 'grain' || key === 'fish') foodProd += kept;
        s.left -= take;
        s.pop = Date.now();
        /* 抽税：这一省这一种资源本回合产得够多，就抽一份进中央。
         * 中央要养全国的维护费，没有这条，没矿的省会集体停产。
         * 「复式账簿」让每笔多抽 fx.tax —— 先算总量，抽不起就整笔不抽
         * （抽一半比不抽更难看懂）。
         * 这是"每笔 +1"，不是"抽成 ×1.1" —— 后者在有科技加成时算出来是小数，
         * 又得回到攒整那套账，不如直接给一个整数。 */
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
      /* ③a 熔旧坊：枯竭铁矿场的涓流。
       * 放在资源产出之后 —— 它和矿场产出同属"这一回合的 gain"，
       * 但不吃储量、不吃维护，只吃"每炼一块铁半块钱"。 */
      settleSmelt(pid | 0, owner | 0);
      /* ③a 淘金场：枯竭金矿场的涓流（金的熔旧坊，和上面同一位次）。
       * 它产金、吃省库木材 —— 木不够就这一回合不出金，不扣料不倒扣。 */
      settleWash(pid | 0, owner | 0);

      /* ③b 军工产线（v19）：**不在这里算** —— 产能是全国的，
       * 逐省算会把"同一个池"拆成 1100 份。全国那一遍在省循环之后（见 ④a）。 */

      /* ④ 人口税：省向人民收金 → **省库**（就是本省的金锭库存，不另开池子）。
       * 和生产抽税（③ 里那一段，产出去中央）是两本账：这里收的金留在省里，
       * 用来发俸禄、买货、建东西；中央那份一分不动。 */
      settleTax(pid, owner, prov, pmod);

      settlePop(pid, foodProd);       // 资源产完之后，人口吃粮、涨落

      /* ⑤ 民心：用本回合**已经发生**的事实（吃没吃饱、停了几类产）算 target，
       * 再往它靠 30%。放在 settlePop 之后是因为"缺粮"要看 eat / need。 */
      settleHappy(pid, prov);
      /* ⑤b 不安（A 批）：吃民心 + 停产 + 未整合 + 异信仰 + 贪墨 + 匪患六项。
       * 必须排在 settleHappy **之后** —— 它的基线项就是本回合刚算出来的民心，
       * 停产类数也直接借 happy.drivers.haltN（两处数出不同的数会很难解释）。 */
      settleUnrest(pid, prov);
      /* ⑤c 整合推进（B 批）：占领省往"正式国土"爬一步，满 100 就删 OCCUPY。
       * 排在产出之后 —— 这一回合的产量仍按**推进前**的整合度算，下回合才涨。 */
      settleInteg(pid, prov);
    }

    CUR.pid = 0; CUR.owner = 0; CUR.F = null; CUR.FC = null;

    /* ④a 军工产线（v19，全国口径）：三个产能池 → 20 条线 → 出单。
     * 排在省循环**之后**：这一回合的料（含刚抽完的税）才有着落；
     * 排在人口税之前那一位次的口径不变 —— 它不碰省库金。 */
    if (state.world) {
      for (var co2 = 0; co2 < state.world.countries.length; co2++) {
        var cw2 = state.world.countries[co2];
        if (cw2 && !countryDead(cw2.id)) settleIndustry(cw2.id);
      }
    }

    /* ④b 官员资历与怨气（v11）：ten++ / 怨气累积 / 每 24 回合掷一次去留。
     * 必须排在省循环**之后** —— 怨气要看"这一回合到底欠没欠饷"（owed 在
     * settleTax 里才定下来）。偷金那一步留在 settleTax 里（那里有 FLOW 上下文）。 */
    settleOfficials();

    /* ④d 匠人俸禄（v17）：和官员同一位次 —— 都是"人"的开销。
     * 从**省库**发、发不起就欠着（和官员的 owed 一个口径），
     * 因为停发匠人 = 装备线全锁，那等于"没钱就别玩这一层"，太硬。 */
    for (var aow in ARTISANS) settleArtisans(+aow);

    /* ④c 宰相（v12）：俸禄 / 权相偷金 / 贤相罢工与进言 / 权相弹劾。
     * 和官员同一位次（人口税段）—— 都是"人"的开销，先把账算清再谈干活。 */
    settleChancellor();

    /* ⑥ 科研：学校产点 → 条满解锁 → 在研科技倒计时 → 队列拉下一条。
     * 人才点也在这一步累加（同一批学校，见 settleResearch） */
    settleResearch();

    /* ⑦ 战争：粮食补给 → 敌国动员 → 行军/会战/占领 → 围城 → 投降。
     * 放在最后：这一回合的产出/人口/民心都算完了，战斗才拿得到"现在的兵和粮"。 */
    settleWar();

    /* ⑦a 叛乱（A2）：所有 UNREST ≥ 80 的省各掷一次（玩家与 AI 同规则）。
     * 必须排在战争之后 —— 倒戈/独立会改归属，得看到**打完之后的版图**；
     * 也要排在内政 AI 之前 —— 新独立出来的国这一回合就能被 AI 接管。 */
    settleRevolt();

    /* ⑦b 情报署（v6）：扣经费 → 自动织网 → AI 密探。
     * 排在战争之后（要看到打完之后的新版图）、事件之前（事件弹窗不该挡住情报提示）。 */
    settleIntel();

    /* ⑦b2 外交缓释（v9）：条约表清理 → 关系值向 0 走 1（同盟有地板托住）。
     * 排在 AI 内政之前：下一批 AI 的缔约/求和判断读的是**这一回合**的 REL，
     * 先缓释再决策，面板上看到的数和 AI 用的是同一个。 */
    settleDiplo();

    /* ⑦b3 傀儡与朝贡（v13）：清死表 → 朝贡（FLOWC 双方记账）→ 补跟战 → 独立掷点。
     * 排在 settleDiplo 之后：那一回合的 REL 锁刚写完，属国这一侧读到的是一致的；
     * 也排在 AI 内政/战争之前 —— 这一回合的朝贡先落袋，AI 的军费护栏读到的
     * 收入才是"上贡之后"的那个数（不然属国永远以为自己很有钱）。
     * 独立掷点会宣战（改 WARSET），排在战争段之后是刻意的：揭竿而起这一回合
     * 不打，下一回合才见血 —— 消息和战报才对得上。 */
    settlePuppets();

    /* ⑦c 敌国内政 AI（v7）：建造 / 研究 / 调税 / 开科派官，每国每回合最多两个动作。
     * 排在情报 tick 之后 —— AI 的决策只看**自己省**的实时数据（SIM / HAPPY 里
     * owner 是自己那份），既不需要别国的情报，也不该读（迷雾框架下那是偷看）。
     * 排在事件之前：这一回合刚盖好的学校，下回合才产科研点，和玩家的时序一致。
     * 工坊模式（PLAYER = 0）里 18-ai.js 自己会立刻返回，AI 全静止。 */
    if (AO.aiEconTick) AO.aiEconTick();

    /* ⑦c2 宰相（v12）：AI 走完之后，玩家国由宰相代劳"你还没做的"。
     * 排在 AI 之后：同一回合里世界先动、你家的宰相后动 —— 这样他读到的
     * 已经是这一回合打完之后的版图（和玩家的时序一致）。
     * 排在世界纪要之前：他的进言要走同一条 flush（不然要等下一回合才见报）。 */
    chancellorAct();

    /* ⑦d 世界消息（v15，v10 起是"当回合直推"）：AI 之间这一回合出的大事
     * 里**到期的那几条**才放出来，最多 AIWAR.newsPerTurn 条，其余留队。
     * 排在 AI tick 之后 —— 不然这一回合刚打起来的仗要晚一整轮才排进队。 */
    flushWorldNews();

    /* ⑧ 事件：传教倒计时 → 产量 buff 倒计时 → 重算国教 → 掷一件事件。
     * 也放在最后 —— 它要看到**打完之后的版图**（占领会让传教作废，
     * 新占的省会改掉"该国信仰占比最大者"）。 */
    if (AO.evtSettle) AO.evtSettle();

    /* ⑨ 物价（v14）：每国每种资源按"库存 / 需求"分档，v 向目标靠 25%。
     * **排在事件之后是刻意的** —— 大旱 / 丰年这些事当回合就进价格，
     * 不然玩家看到"旱情"要再等一回合才见价动，因果就断了。
     * AI 与面板读的是这一回合结算出来的价（等于"拿昨天的行情做决定"）。 */
    settlePrices();

    /* ⓫ 编年史归档（v5）：把这一回合攒下的 NOTES 全量抄进年表，顺带判一次
     * 统一 / 灭亡。放在最后一行 —— 它要看到"打完之后"的版图和纪要。 */
    if (AO.chronoArchive) AO.chronoArchive();
  }

  /* ---------------- ④ 人口税 + 俸禄 ----------------
   *   金税 = 人口/popUnit × goldPerUnit[档] × (有官 ? taxMul : noOfficerMul) × happyTaxMul(民心)
   *   铁税 = 人口/ironUnit × ironPer2M[档] × 同一个 mul          （民间铁器熔缴）
   * 三个系数各管一件事，所以公式能一眼读出手算：
   *   goldPerUnit 税率档（轻 0.5 / 常 1 / 暴 2，每 popUnit=10 万人）
   *   taxMul      官员（理财能手 1.2 / 贪墨 1.4 / 治世能臣 1.25；无官 = 0.6）
   *   happyTaxMul 民心（0.6 ~ 1.2，民心 60 时正好 0.96）
   * 铁税与金税**同单位**（v18 追加二：ironUnit = 10 万人，原来是 200 万）：
   * 它从"锅碗瓢盆回炉"的涓流提成了常脉 —— 13 省小国约 80 万人，常规档
   * 约 1.6 铁/回合、横征约 3.1。但大头仍然撑不起成建制扩军（3 铁/回合一炉刀），
   * 军备主力仍是矿场 + 熔旧坊；税铁保的是"不饿死"。
   * 小数攒整（TAXACC / IRONACC）：一个 3 万人的小省在轻税档一回合只有 0.15 金，
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
    /* 铁税（人口铁税）：**同档、同系数、同攒整法**，v18 追加二起**也同单位** ——
     * 金是 popUnit=10 万人，铁是 ironUnit=10 万人，一个中位省一回合约 0.2~0.4 块。
     * 它是矿休眠期的第二脉（保"不饿死"），不是军备主力：军备的铁仍然主要来自
     * 矿场与熔旧坊。 */
    if (bag.iron) {
      var rawI = popV / G.ironUnit * G.ironPer2M[rate] * mul;
      IRONACC[pid] = (IRONACC[pid] || 0) + rawI;
      var gainI = Math.floor(IRONACC[pid]);
      IRONACC[pid] -= gainI;
      if (gainI > 0) {
        var keptI = gainStock(pid, 'iron', gainI, F);
        if (F) {
          F.gain.iron = (F.gain.iron || 0) + keptI;
          F.d.ironTax = (F.d.ironTax || 0) + keptI;
        }
      }
    }
    if (off) {
      /* 俸禄 = 底薪 × 资历倍率（1 / 1.25 / 1.5 / 2），小数攒整（见 salaryOf）。
       * 攒整不是抠门：base 1 金的时候 rank1 的 1.25 直接 round 会变成 1，
       * "资历加薪"就白写了。攒整之后长期平均真的是 1.25。 */
      var due = salaryOf(off) + (off.owed || 0);
      var pay = Math.min(bag.gold.stock, due);
      if (pay > 0) {
        bag.gold.stock -= pay;
        if (F) {
          F.loss.gold = (F.loss.gold || 0) + pay;
          F.d.salary = (F.d.salary || 0) + pay;
        }
      }
      off.owed = due - pay;
      /* 怨气 ≥ steal(90)：贪到敢从省库里伸手了 —— 每回合 1 金。
       * 记进 FLOW.loss（它真的流出去了），所以收支小结里看得到"官员侵吞"。
       * 放在这里而不是资历结算里，是因为只有这里拿得到本省的 FLOW 上下文。 */
      if (off.griev >= G.griev.steal && bag.gold.stock >= 1) {
        bag.gold.stock -= 1;
        if (F) {
          F.loss.gold = (F.loss.gold || 0) + 1;
          F.d.steal = (F.d.steal || 0) + 1;
        }
      }
    }
    /* ⑤ 省库上解（v18 / D）：人口税只进省库、中央只出不进 —— 这一笔把散在
     * 省里的金聚回中央。放在**最末**（俸禄、偷金都算完之后）：
     * 上解的是"这个省真的剩下来的钱"，不是它收上来还没花的那一笔。
     * 规则在 AO.GOV.remit（30 免 / 30~80 抽 10% / >80 抽 25% / 每省每回合 ≤3），
     * 玩家与 AI 同一条。 */
    settleRemit(pid, owner);
    return gain;
  }
  AO.resSettleTax = settleTax;

  /* 省库上解（v18 / D，v18.3 改累进）：省库金按三段抽成搬给中央。
   *   ≤ free(30)            免 —— 省里的家底，下一刻就要付维护费
   *   free ~ low 的部分     lowRate(10%)
   *   > low(80) 的部分      highRate(25%)
   * 每省每回合至多 cap(3) 金。**先抽成再封顶**（不是先封顶再抽）：
   * 封顶是"别把大省抽干"，不是"大省只按 3 金算税率"。
   * 小数走 REMITACC 攒整 —— 33 金的省一回合只有 0.3 金，floor 掉就永远搬不出，
   * 10% 那一段会静悄悄地不存在（这正是 v18 那条 80 死线的老毛病）。
   * 只走金不走铁：铁的家在矿脉和熔旧坊，这条别扩散。
   * 单独成函数是为了测试能定点验（settleTax 里还混着人口税与俸禄）。 */
  function settleRemit(pid, owner) {
    var R = AO.GOV && AO.GOV.remit;
    if (!R || !owner) return 0;          // 无主省不搬（别给 CENTRAL[0] 造一本假账）
    var bag = SIM[pid | 0];
    var g = bag && bag.gold;
    if (!g) return 0;
    var free = R.free === undefined ? 30 : R.free;
    var low = R.low === undefined ? 80 : R.low;
    var r1 = R.lowRate === undefined ? 0.10 : R.lowRate;
    var r2 = R.highRate === undefined ? 0.25 : R.highRate;
    var cap = R.cap === undefined ? 3 : R.cap;
    var stock = g.stock || 0;
    if (stock <= free) return 0;         // 没到起征点：零头留着，别清（攒整跨回合）
    var amt = (Math.min(stock, low) - free) * r1 + Math.max(0, stock - low) * r2;
    if (amt > cap) amt = cap;
    REMITACC[pid | 0] = (REMITACC[pid | 0] || 0) + amt;
    var move = Math.floor(REMITACC[pid | 0] + 1e-9);
    if (move > stock) move = Math.floor(stock);   // 不留负数：理论上到不了，防手改档
    if (move <= 0) return 0;
    REMITACC[pid | 0] -= move;
    g.stock -= move;
    var cen = ensureCentral(owner | 0);
    cen.gold = (cen.gold || 0) + move;
    var F = FLOW[pid | 0];
    if (F) {
      F.loss.gold = (F.loss.gold || 0) + move;
      F.d.remit = (F.d.remit || 0) + move;
    }
    var FC = FLOWC[owner | 0] || ensureFlowC(owner | 0);
    if (FC) {
      FC.gain.gold = (FC.gain.gold || 0) + move;
      FC.d.remit = (FC.d.remit || 0) + move;
    }
    REMIT.n++; REMIT.gold += move;
    return move;
  }
  AO.resSettleRemit = settleRemit;

  /* ---------------- ④b 官员资历与怨气（v11） ----------------
   * 每回合一遍，全部官员走同一条时间线：
   *   ten++                            在任回合数（卸任清零，所以它是"这一任"的工龄）
   *   griev += 1/base                  基础：每 12 回合 +1
   *          = 1/lowEvery（民心 <45）  民心差的地方更难待（每 6 回合 +1）
   *          + owedPer（欠饷 >0）      欠着俸禄的官，每回合再 +2
   *   每 rollEvery 回合掷一次去留：45% 擢升 / 45% 无事 / 10% 怨望 +20
   *   griev 首次 ≥ warn(60) →「怨望」红字 + 纪要一条（只对玩家国；AI 不推）
   * 怨气不设"死区"：59 和 61 的倍率不一样，玩家调赏赐的时机才有意义。
   *
   * 为什么怨气用小数直接加、不学 TAXACC 攒整：
   * 1/12 攒整之后永远是 0（每回合都不到 1），这一条就成了死代码。
   * 存小数、显示时取整，长期平均才是真的"12 回合 +1"。 */
  function settleOfficials() {
    var G = AO.GOV, gv = G.griev, turn = turnNo;
    for (var key in OFFICIAL) {
      var off = OFFICIAL[key];
      if (!off) continue;
      offNorm(off);
      var pid = key | 0;
      var prov = state.world ? state.world.provinces[pid - 1] : null;
      var owner = prov ? prov.owner : 0;

      off.ten++;
      var add = 1 / (gv.base || 12);
      var hv = prov ? happyOf(pid).v : G.happyBase;
      if (hv < (gv.lowHappy || 45)) add = 1 / (gv.lowEvery || 6);
      if ((off.owed || 0) > 0) add += (gv.owedPer || 2);
      off.griev = AO.clamp(off.griev + add, 0, 100);

      /* 每 24 回合掷一次去留。用 (回合 + 官员 id) 错开 —— 否则全国官员
       * 会在同一回合集体擢升，读起来像发年终奖。 */
      if ((turn + (off.id || 0)) % (gv.rollEvery || 24) === 0) {
        var r = Math.random();
        if (r < (gv.promote || 0.45)) {
          if (off.rank < (G.rankMax || 3)) {
            off.rank++;
            if (PLAYER && owner === PLAYER) {
              NOTES.push({ owner: PLAYER, pid: pid, cls: 'ok',
                text: '擢升：' + off.name + ' 迁「' + G.rankCn[off.rank] + '」' +
                  '（资历 ' + off.rank + ' · 效果 ×' + offMul(off).toFixed(2) + '）' });
            }
          }
        } else if (r >= (gv.promote || 0.45) + (gv.idle || 0.45)) {
          off.griev = AO.clamp(off.griev + (gv.resentAdd || 20), 0, 100);
        }
      }

      /* 怨望节点：首次跨过 60 报一次（只报玩家国 —— AI 官员的牢骚不进玩家年表）。
       * 降回 warn−15 以下之后重新武装，下次再涨上来还能再报一次。 */
      if (off.griev >= gv.warn) {
        if (!off.warned && PLAYER && owner === PLAYER) {
          NOTES.push({ owner: PLAYER, pid: pid, cls: 'warn',
            text: '怨望：' + off.name + '（' + prov.name + '）怨气 ' +
              Math.round(off.griev) + ' —— 效果已降到 ×' + offMul(off).toFixed(2) +
              '，去「治理」里赏赐安抚（15 金 −25 怨气）' });
        }
        if (!off.warned) off.warned = turn;
      } else if (off.warned && off.griev < gv.warn - 15) {
        off.warned = 0;
      }
    }
  }
  AO.resSettleOfficials = settleOfficials;

  /* 赏赐：中央金 −15 → 怨气 −25。**玩家和 AI 走同一个函数**（对等原则），
   * 区别只是 silent：AI 不写提示条、不推纪要。
   * 返回 { ok, off, msg } —— 面板拿 msg 直接弹提示条。 */
  function rewardOfficial(pid, silent) {
    var off = OFFICIAL[pid | 0];
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (!prov) return { ok: false, msg: '没有这个省' };
    if (!silent && !canAct(prov.owner)) return { ok: false, msg: lockTitle() };
    if (!off) return { ok: false, msg: '这一省没有在任官员 —— 先派一位' };
    var G = AO.GOV, cen = ensureCentral(prov.owner), cost = G.griev.reward;
    if ((cen.gold || 0) < cost) {
      return { ok: false, msg: '中央国库不够：赏赐要 ' + cost + ' 金，现在只有 ' +
        Math.floor(cen.gold || 0) + ' 金' };
    }
    cen.gold -= cost;
    offNorm(off);
    var before = off.griev;
    off.griev = AO.clamp(off.griev - G.griev.rewardCut, 0, 100);
    off.rewardAt = turnNo;
    return {
      ok: true, off: off, before: before, cost: cost,
      msg: '赏赐 ' + off.name + '：中央金 −' + cost + '，怨气 ' + Math.round(before) +
        ' → ' + Math.round(off.griev) + '（效果 ×' + offMul(off).toFixed(2) + '）'
    };
  }
  AO.resReward = rewardOfficial;

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
      crowd: 0,                        // 人满为患（v18.2：人口压过承载力）
      halt: 0, haltN: 0,               // 停产（每类 −3，封顶 −9）
      official: 0,                     // 官员 happyAdd
      market: 0,                       // 有在营市场
      faith: 0, faithN: 0,             // 信仰：省主流信仰 ≠ 国教
      war: 0, warN: 0                  // 战争层：占领 / 封锁 / 群龙无首 / 驻军扰民
    };
    var pop = POP[pid];
    if (pop && pop.need > 0 && pop.eat < pop.need) d.food = G.happyLackFood;
    /* 人满为患（v18.2）：人口**压过**承载力才扣 —— 摸顶（pop = cap）不扣，
     * 那是"刚好住满"，不是"挤爆了"。回落是每回合 −1%，所以这 −2 会挂几回合，
     * 面板上能清楚看到"人太多，心不安"这一项在扣。 */
    if (pop && pop.v > 0 && AO.POPCAP) {
      var pcap = popCapOf(pid);
      if (pcap > 0 && pop.v > pcap) d.crowd = AO.POPCAP.overHappy;
    }

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
    /* 官员的民心加成同样吃「资历 × 怨气」的倍率：一位民望贤达（+8）怨到 90，
     * 只剩 +4 点民心 —— 否则"怨吏"在面板上还挂着 +8，读起来像 bug。 */
    if (off) d.official = Math.round(offFx(off).happyAdd || 0);
    var mk = MARKET[pid];
    if (mk && mk.n > 0 && !mk.halted) d.market = G.happyMarket;

    /* 信仰（B2）：省的主流信仰 ≠ 国教 → 按政策扣分（强制 −6 / 宽容 −2）。
     * 判定与数值全在 16-events.js（faithDriver），这里只把它记进 drivers ——
     * 悬停明细照样逐项显示，玩家能回答"我这民心到底为什么低"。 */
    d.faith = (AO.faithDriver && prov) ? AO.faithDriver(pid, owner) : 0;
    d.faithN = d.faith ? 1 : 0;

    /* 宰相（v12）：权倾朝野的常驻 −3（§14.3 的 debuff 之一）。
     * 按 owner 查表：没有宰相的国家恒 0，所以这一段对 AI 国天然无影响。 */
    d.chancellor = chHappyOf(owner);

    var target = d.base + d.rate + d.food + d.crowd + d.halt + d.official + d.market +
      d.faith + d.war + (d.chancellor || 0);
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
      /* 人满为患只在真超限时出现 —— 平时不占一行，免得"0"把明细撑长 */
      if (d.crowd) {
        var pc2 = popCapOf(pid);
        lines.push('人满为患 ' + d.crowd + '（' + AO.formatPop(Math.round((POP[pid] || {}).v || 0)) +
          ' 挤在 ' + AO.formatPop(Math.round(pc2)) + ' 的地上，每回合 −' +
          Math.round(AO.POPCAP.overRate * 100) + '% 往外走）');
      }
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
      if (d.chancellor) {
        lines.push('权臣在朝 ' + d.chancellor + '（罢相可去）');
      }
      lines.push('→ 目标 ' + Math.round(h.target) + '，本回合往它靠 ' + Math.round(G.happyLerp * 100) + '%');
    }
    lines.push('');
    lines.push('民心影响两件事：收税系数 ' + G.happyTaxMul(h.v).toFixed(2) +
      '（0.6 ~ 1.2）；人口增速（≤' + G.happyLow + ' 打折、≥' + G.happyHigh + ' 加成）');
    return lines.join('\n');
  }
  AO.resHappyTitle = happyTitle;

  /* =============================================================
   * ⑤b 不安与叛乱（A 批）
   *
   * 位置说明：settleUnrest / settleInteg 都排在 settleHappy **之后**、同一个省循环里 ——
   * 它们要读本回合刚算完的民心与停产状态；settleRevolt 排在 settleWar 之后
   * （叛乱会改归属，得看到打完之后的版图）。
   *
   * 三个状态都跟 OCCUPY 一样是"按 pid 挂的普通对象"，JSON 原样进存档。
   * ============================================================= */

  /* 不安：没有就给一条 0 起的记录（老档补默认全靠这里） */
  function unrestOf(pid) {
    pid = pid | 0;
    var u = UNREST[pid];
    if (!u) u = UNREST[pid] = { v: 0, target: 0, drivers: null };
    if (typeof u.v !== 'number' || !isFinite(u.v)) u.v = 0;
    if (typeof u.target !== 'number' || !isFinite(u.target)) u.target = u.v;
    return u;
  }
  AO.resUnrestOf = unrestOf;

  /* 整合度：**只有占领省才有**（没占领就是 0，不建记录 —— 1100 个省全建一份
   * 会让存档凭空胖一圈，而"没占领"这个状态本身就是默认值） */
  function integOf(pid) {
    var it = INTEG[pid | 0];
    if (!it) return null;
    if (typeof it.v !== 'number' || !isFinite(it.v)) it.v = 0;
    return it;
  }
  AO.resIntegOf = integOf;

  /* 本省有没有驻军（≥1 支）。镇压倒戈/独立、加速整合都用它 ——
   * 一支舰队不算：船在港里压不住城里的人 */
  function hasGarrison(pid) {
    var list = armiesIn(pid | 0);
    for (var i = 0; i < list.length; i++) if (list[i].type === 'army') return true;
    return false;
  }
  AO.resHasGarrison = hasGarrison;

  /* 匪患标记还挂着吗（事件与不安共用一条标记） */
  function banditOf(pid) {
    var b = BANDIT[pid | 0];
    return b && b.left > 0 ? b : null;
  }
  AO.resBanditOf = banditOf;

  /* ---------------- 不安的六个驱动 ----------------
   * 每一项都写进 drivers，省卡的悬停明细逐条回答"我为什么这么不稳"。
   * 顺序和面板上的顺序一致，改一处不会漏另一处。 */
  function settleUnrest(pid, prov) {
    var U = AO.UNREST, u = unrestOf(pid);
    var G = AO.GOV, h = happyOf(pid);
    if (!prov && state.world) prov = state.world.provinces[(pid | 0) - 1];
    var owner = prov ? prov.owner : 0;
    var d = {
      base: Math.max(0, U.gapFrom - h.v) * U.gapMul,   // 民心塌陷
      halt: 0, haltN: 0,                                // 停产三类以上
      occupy: 0,                                        // 未整合
      faith: 0,                                         // 异信仰被强压
      graft: 0,                                         // 贪墨官
      bandit: 0,                                        // 匪患未平
      calm: 0                                           // 民心回上去了 → 回落
    };

    /* 停产：和 settleHappy 同一口径（数"类"不数"座"）——
     * happy.drivers 已经算好了，直接借过来，免得两处数出不同的数 */
    var hd = h.drivers;
    if (hd && hd.haltN >= U.haltN) { d.haltN = hd.haltN; d.halt = U.haltAdd; }

    if (OCCUPY[pid]) d.occupy = U.occupyAdd;

    /* 异信仰 + 强制改宗：和 settleHappy 的 faith 段同源（AO.faithDriver），
     * 但只有"强制"档才积不安 —— 宽容档本来就不压人 */
    if (AO.faithDriver && prov && AO.faithPolOf(owner) === 'force' &&
        AO.faithDriver(pid, owner) < 0) d.faith = U.faithAdd;

    var off = OFFICIAL[pid | 0];
    if (off && off.traitKey === 'greedy') d.graft = U.graftAdd;

    var bt = banditOf(pid);
    if (bt) d.bandit = U.banditAdd;

    var t = d.base + d.halt + d.occupy + d.faith + d.graft + d.bandit;
    if (h.v >= U.calmHappy) {
      /* 民心好了：目标往下走 5 —— 这一项单独记一格，悬停里能看见"民心回来了" */
      d.calm = -U.calmFall;
      t = Math.max(0, t + d.calm);
    } else {
      /* 其余情况**只涨不降**：目标不低于现在这个值。
       * 于是"闹过一次"的省不会因为某个 driver 消失就自己好透，
       * 要么把民心抬到 55 以上，要么花钱安抚 —— 这就是"金能买人心"。 */
      t = Math.max(t, u.v);
    }
    u.target = AO.clamp(t, 0, U.max);
    u.drivers = d;
    u.v = AO.clamp(u.v + (u.target - u.v) * U.lerp, 0, U.max);

    /* 匪患标记的寿命在这里走一格（**先算 driver 再减**，所以设标记那一回合
     * 之后的 banditTurns 个回合都吃得到 +10）。散场之后不安自己慢慢回落 ——
     * 除非民心和别的项还撑着它，这正是"怨是攒出来的"那句话。 */
    if (bt) {
      bt.left--;
      if (bt.left <= 0) delete BANDIT[pid | 0];
    }
    return u;
  }
  AO.resSettleUnrest = settleUnrest;

  /* 不安明细 → 悬停文本（省卡 / 国家卡共用） */
  function unrestTitle(pid) {
    var U = AO.UNREST, u = unrestOf(pid), d = u.drivers;
    var lines = ['安定 ' + Math.round(u.v) + ' / 100（不安值，越高越不稳）' +
      (d ? '　目标 ' + Math.round(u.target) : '')];
    if (!d) {
      lines.push('（还没结算过，开局 0）');
    } else {
      lines.push('民心塌陷 +' + Math.round(d.base) +
        '（民心 ' + Math.round(happyOf(pid).v) + '，低于 ' + U.gapFrom + ' 才开始积）');
      lines.push('停产 +' + d.halt + (d.haltN ? '（' + d.haltN + ' 类建筑停产）' : '（未达 ' + U.haltN + ' 类）'));
      if (d.occupy) lines.push('未整合 +' + d.occupy + '（打下来的地还没消化）');
      if (d.faith) lines.push('异信仰受压制 +' + d.faith + '（政策强制）');
      if (d.graft) lines.push('贪墨官在任 +' + d.graft);
      if (d.bandit) lines.push('匪患未平 +' + d.bandit);
      if (d.calm) lines.push('民心已回 55 以上 → 回落 ' + d.calm + '/回合');
      lines.push('→ 目标 ' + Math.round(u.target) + '，本回合往它靠 ' + Math.round(U.lerp * 100) + '%');
    }
    lines.push('');
    lines.push('不安 ≥ ' + U.revoltAt + '：每回合 ' + Math.round(U.revoltChance * 100) +
      '% 爆发（' + U.wBandit + '% 匪乱 · ' + U.wDefect + '% 倒戈 · ' + U.wSecede + '% 独立）');
    lines.push('自己的省会先报「警戒」（' + U.warnAt + '）与「危急」（' + U.warnAt2 + '）两档纪要');
    lines.push('有驻军时倒戈与独立各减半（' + (U.wDefect / 2) + '% / ' + (U.wSecede / 2) + '%），匪乱照发');
    lines.push('民心 ≥ ' + U.calmHappy + ' 时不安每回合 −' + U.calmFall + '；其余情况只涨不降');
    lines.push('「安抚」花 ' + AO.INTEG.pacify.cost + ' 金：不安 −' + AO.INTEG.pacify.unrestOnly +
      '（未整合省另有整合 +' + AO.INTEG.pacify.integ + '、不安 −' + AO.INTEG.pacify.unrest + '）');
    return lines.join('\n');
  }
  AO.resUnrestTitle = unrestTitle;

  /* ---------------- 整合推进 ----------------
   * 每回合 +1（同信仰 / 有官 / 民心≥55 / 有驻军 各再 +1）→ 最快 5/回合、最慢 1/回合。
   * 民心 < 35 → 本回合不推进（连饭都吃不上，没人替你办差）。
   * 整合满 → **OCCUPY 删除**：这一省从此是正式国土（×1.0、可传教、产科研）。 */
  function settleInteg(pid, prov) {
    if (!OCCUPY[pid]) {                      // 不是占领省 → 不该有整合记录
      if (INTEG[pid]) delete INTEG[pid];
      return null;
    }
    var I = AO.INTEG, h = happyOf(pid);
    var it = integOf(pid) || (INTEG[pid] = { v: 0 });
    if (!prov && state.world) prov = state.world.provinces[(pid | 0) - 1];

    var gain = 0, why = [];
    if (h.v < I.stallHappy) {
      why.push('民心 ' + Math.round(h.v) + ' < ' + I.stallHappy + '，本回合停摆');
    } else {
      gain += I.base;
      var sf = AO.stateFaithOf(prov ? prov.owner : 0);
      if (sf >= 0 && prov && prov.faithIdx === sf) { gain += I.sameFaith; why.push('同信仰'); }
      if (OFFICIAL[pid | 0]) { gain += I.officer; why.push('有官'); }
      if (h.v >= I.happyAt) { gain += I.happy; why.push('民心'); }
      if (hasGarrison(pid)) { gain += I.garrison; why.push('驻军'); }
    }
    it.gain = gain;
    it.why = why;
    it.v = AO.clamp(it.v + gain, 0, I.max);

    if (it.v >= I.max) {
      /* 整合完成：这一省归附。OCCUPY 一删，产出乘数自动回到 ×1.0，
       * 科研与传教资格也跟着回来（那两处判的就是 OCCUPY） */
      delete OCCUPY[pid];
      delete INTEG[pid];
      var owner = prov ? prov.owner : 0;
      var txt = '🏛 ' + (prov ? prov.name : '?') + '：' + I.doneText + '（整合完成，恢复全产出）';
      WARLOG.unshift({ turn: turnNo, cls: 'ok', text: txt });
      if (PLAYER && owner === PLAYER) {
        NOTES.push({ owner: PLAYER, pid: pid | 0, cls: 'ok', text: txt });
      } else if (PLAYER) {
        worldNews(txt.replace('🏛 ', ''), 'ok', { parties: [owner], kind: 'other' });
      }
      return null;
    }
    return it;
  }
  AO.resSettleInteg = settleInteg;

  function integTitle(pid) {
    var I = AO.INTEG, it = integOf(pid);
    if (!it) return '这一省不是占领省 —— 已经是正式国土（产出 ×1.0）';
    var lines = ['整合 ' + Math.round(it.v) + ' / ' + I.max +
      '（未整合省产出 ×' + I.prodMul(it.v).toFixed(2) + '，完成即正式国土 ×1.00）'];
    lines.push('本回合 +' + (it.gain || 0) + (it.why && it.why.length ? '（' + it.why.join(' / ') + '）' : ''));
    lines.push('加速项：基础 +' + I.base + ' · 同信仰 +' + I.sameFaith + ' · 有官 +' + I.officer +
      ' · 民心≥' + I.happyAt + ' +' + I.happy + ' · 驻军 +' + I.garrison);
    lines.push('民心 < ' + I.stallHappy + ' → 停摆；被敌国夺回 → 归零重算');
    lines.push('「安抚」花 ' + I.pacify.cost + ' 金：整合 +' + I.pacify.integ +
      '、不安 −' + I.pacify.unrest + '（冷却 ' + I.pacify.cd + ' 回合）');
    return lines.join('\n');
  }
  AO.resIntegTitle = integTitle;

  /* ---------------- 安抚金（B3） ----------------
   * 玩家：省库优先 → 中央 → 同国富裕省调拨（走 payCost 那条链，和建造同一个付款口径）
   * AI  ：只花**中央**金（silent）—— 理由和「赏赐」一样：不惊动提示条、不推纪要。
   *       权相 / 宰相**不自动安抚**（v1 留给玩家：这是"人"该做的判断）。
   *
   * 两段效果（互斥）：
   *   未整合省 → INTEG +15、UNREST −15（先安抚再消化）
   *   高不安省 → UNREST −25（买平安）
   * 冷却 3 回合同样按 pid 记（换主张子之后也得等 —— 否则两个邻国轮流安抚等于没有冷却）。 */
  function pacify(pid, silent) {
    var P = AO.INTEG.pacify;
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (!prov) return { ok: false, msg: '没有这个省' };
    var owner = prov.owner | 0;
    if (!silent && !canAct(owner)) return { ok: false, msg: lockTitle() };
    var occ = !!OCCUPY[pid];
    var u = unrestOf(pid);
    if (!occ && u.v < P.at) {
      return { ok: false, msg: '这一省既不是未整合省、不安也只有 ' + Math.round(u.v) +
        '（低于 ' + P.at + '）—— 不用安抚' };
    }
    var last = PACIFY[pid | 0];
    if (last && turnNo - last < P.cd) {
      return { ok: false, msg: '刚安抚过：还要等 ' + (P.cd - (turnNo - last)) + ' 回合' };
    }

    /* 付款：玩家走整条 payCost；AI 只掏中央 */
    if (silent) {
      var cen = ensureCentral(owner);
      if ((cen.gold || 0) < P.cost) return { ok: false, msg: '中央金不足' };
      cen.gold -= P.cost;
    } else {
      var r = payCost(prov, { gold: P.cost });
      if (!r.ok) return { ok: false, msg: '凑不齐 ' + P.cost + ' 金（省库 → 中央 → 同国各省）' };
    }

    PACIFY[pid | 0] = turnNo;
    var parts = ['金 −' + P.cost];
    if (occ) {
      var it = integOf(pid) || (INTEG[pid] = { v: 0 });
      it.v = AO.clamp(it.v + P.integ, 0, AO.INTEG.max);
      u.v = AO.clamp(u.v - P.unrest, 0, AO.UNREST.max);
      u.target = Math.max(0, Math.min(u.target, u.v));
      parts.push('整合 +' + P.integ + '（' + Math.round(it.v) + '/100）', '不安 −' + P.unrest);
    } else {
      u.v = AO.clamp(u.v - P.unrestOnly, 0, AO.UNREST.max);
      u.target = Math.max(0, Math.min(u.target, u.v));
      parts.push('不安 −' + P.unrestOnly);
    }
    /* 安抚顺手把匪患标记清掉：钱能给到"招安"这个层级上（否则安抚完
     * 匪患还挂着 +10 不安，玩家会觉得钱白花了） */
    if (BANDIT[pid | 0]) { delete BANDIT[pid | 0]; parts.push('匪患平息'); }
    var msg = prov.name + ' 安抚：' + parts.join(' · ') + '（冷却 ' + P.cd + ' 回合）';
    if (!silent) {
      WARLOG.unshift({ turn: turnNo, cls: 'ok', text: '🕊 ' + msg });
      NOTES.push({ owner: owner, pid: pid | 0, cls: 'ok', text: msg });
    }
    return { ok: true, msg: msg, occ: occ };
  }
  AO.resPacify = pacify;

  /* 安抚按钮的可用性（省卡直接用这个判据，免得面板和真调用两套规则） */
  function pacifyInfo(pid) {
    var P = AO.INTEG.pacify;
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (!prov) return { ok: false, why: '没有这个省', show: false };
    var occ = !!OCCUPY[pid];
    var u = unrestOf(pid);
    if (!occ && u.v < P.at) return { ok: false, why: '不是未整合省，不安也低于 ' + P.at, show: false };
    if (!canAct(prov.owner)) return { ok: false, why: lockTitle(), show: true };
    var last = PACIFY[pid | 0];
    if (last && turnNo - last < P.cd) {
      return { ok: false, why: '冷却中：还要等 ' + (P.cd - (turnNo - last)) + ' 回合', show: true };
    }
    return { ok: true, why: '', show: true, occ: occ, cost: P.cost };
  }
  AO.resPacifyInfo = pacifyInfo;

  /* =============================================================
   * ⑤c 叛乱（A2）：全世界的省一视同仁 —— 玩家和 AI 走同一段代码
   *
   * 触发：UNREST ≥ 80 → 每回合 15% 掷一次。
   * 结果按权重：60% 匪乱 / 30% 倒戈 / 10% 独立；**有驻军时**倒戈与独立各减半
   * （15 / 5，省下的份额给匪乱）—— 驻军压的是背叛，不是治安。
   *
   * 三种结果各改一样东西，改完都清不安：
   *   匪乱  产出归零一回合 + 挂匪患标记（+10 不安，3 回合散）+ 事件系统会接着出「招安」
   *   倒戈  整省改归属（走 occupyProvince 那条既有流程 → 占领省、整合从 0 开始）
   *   独立  这一省 + 接壤的同宗不满省抱团成**新国**（军队带走在驻军）
   * ============================================================= */

  /* 掷结果：返回 'bandit' | 'defect' | 'secede' */
  function rollRevoltKind(garrisoned) {
    var U = AO.UNREST;
    var wB = U.wBandit, wD = U.wDefect, wS = U.wSecede;
    if (garrisoned) { wD = wD / 2; wS = wS / 2; wB = 100 - wD - wS; }
    var r = Math.random() * (wB + wD + wS);
    if (r < wB) return 'bandit';
    if (r < wB + wD) return 'defect';
    return 'secede';
  }
  AO.resRollRevolt = rollRevoltKind;      // 测试要能直接掷 1000 次验概率

  function revoltNote(txt, cls, owner, pid) {
    WARLOG.unshift({ turn: turnNo, cls: cls || 'bad', text: txt });
    if (PLAYER && (owner === PLAYER)) {
      NOTES.push({ owner: PLAYER, pid: pid || 0, cls: cls || 'warn', text: txt });
    } else if (PLAYER) {
      /* AI 国的事走「遥远的」这一条路（每回合 ≤ AIWAR.newsPerTurn 条）——
       * 36 国一起叛乱的话，玩家的提示条会被刷成滚动条 */
      worldNews(txt.replace(/^\S+\s/, ''), cls || 'warn', { parties: [owner], kind: 'revolt' });
    }
  }

  /* 匪乱：产出归零一回合（匪患标记）+ 不安 −30 */
  function riotAt(pid, prov, owner) {
    var U = AO.UNREST;
    BANDIT[pid] = { turn: turnNo, left: U.banditTurns };
    var u = unrestOf(pid);
    u.v = AO.clamp(u.v - U.banditDrop, 0, U.max);
    u.target = Math.min(u.target, u.v);
    UNWARN[pid] = 0;                       // 炸过一次，预警档复位（下次攒上去再报）
    var txt = '🔥 ' + prov.name + ' 匪乱：仓储被抢、工地停摆（本回合产出归零，' +
      U.banditTurns + ' 回合内不安 +' + U.banditAdd + '）';
    revoltNote(txt, 'bad', owner, pid);
    return txt;
  }

  /* 倒戈：整省改投"接壤、REL 最高的邻国"。
   * 走 occupyProvince 是为了复用那一整套易主（成员表、颜色、战争分、缓存失效、编年史）——
   * 唯一的补充是把 INTEG 从 0 开始、不安清零（举城投过去，怨气跟着散了）。 */
  function defectTo(pid, prov) {
    var oldOwner = prov.owner | 0;
    var nb = prov.neighbors || [], best = 0, bestRel = -Infinity;
    for (var i = 0; i < nb.length; i++) {
      var q = state.world.provinces[nb[i] - 1];
      if (!q || !q.owner || q.owner === oldOwner) continue;
      if (countryDead(q.owner)) continue;
      var r = relOf(oldOwner, q.owner);
      if (r > bestRel) { bestRel = r; best = q.owner; }
    }
    if (!best) return null;
    var oldC = coOf(oldOwner), newC = coOf(best);
    occupyProvince(pid, best, '倒戈');
    INTEG[pid | 0] = { v: 0 };
    var u = unrestOf(pid);
    u.v = 0; u.target = 0;
    delete UNWARN[pid | 0];
    addRel(oldOwner, best, AO.UNREST.defectRel);
    var txt = '🏳 ' + prov.name + ' 举城投' + (newC ? newC.name : '?') +
      '（原属' + (oldC ? oldC.name : '?') + '，关系 ' + bestRel + '）';
    revoltNote(txt, 'bad', oldOwner, pid);
    return txt;
  }

  /* 独立：这一省 + 接壤的同宗不满省抱团成新国。
   * "同宗" = 同信仰（faithIdx 相同）且不安 ≥ secedeUnrest —— 只有同宗才会一起走，
   * 否则一个省内几个教派互相看不顺眼，抱团是编不出来的。 */
  function secedeAt(pid, prov) {
    var U = AO.UNREST, w = state.world;
    var oldOwner = prov.owner | 0;
    var group = [pid], nb = prov.neighbors || [], i;
    for (i = 0; i < nb.length && group.length < U.secedeMax; i++) {
      var q = w.provinces[nb[i] - 1];
      if (!q || q.owner !== oldOwner) continue;
      if (q.faithIdx !== prov.faithIdx) continue;
      if (unrestOf(q.id).v < U.secedeUnrest) continue;
      if (group.indexOf(q.id) < 0) group.push(q.id);
    }
    var nc = createRebelCountry(prov, group);
    if (!nc) return null;
    /* 复用一个空的军队位：新国自己的军队表是空的，先把本省驻军的旗号换掉 */
    var gar = armiesIn(pid);
    for (i = 0; i < gar.length; i++) {
      var a = gar[i];
      if (a.owner !== oldOwner) continue;
      a.owner = nc.id;
      a.rebelFrom = oldOwner;
      a.order = { type: 'defend', cid: nc.id, pid: pid, tactic: 'assault' };
    }
    addRel(oldOwner, nc.id, U.secedeRel);
    var oldC = coOf(oldOwner);
    var txt = '⚑ ' + prov.name + ' 独立，立' + nc.name + '（带走 ' + group.length +
      ' 省' + (gar.length ? '、驻军 ' + gar.length + ' 支' : '') + '），原属' + (oldC ? oldC.name : '?');
    revoltNote(txt, 'bad', oldOwner, pid);
    return txt;
  }

  /* 建一个"叛乱新国"：任务书要求复用国家生成里的分国逻辑**最小集** ——
   * 名字从命名器取、PERSONA 掷一个、其余（人口/面积/信仰/邻国/首都/资源）
   * 全部交给 AO.recomputeCountry 从成员省复算，和改归属后那条路一模一样。
   *
   * 为什么不做完整的 08b（政体/头像/王朝）：那套要一整套 rng 支流，
   * 中途插入会打乱后续所有随机数；这里用 seed+pid+turn 的散列取名字与头像，
   * 同一个种子 + 同一个回合永远得到同一个国名（可复现）。 */
  function createRebelCountry(capProv, group) {
    var w = state.world;
    if (!w) return null;
    var id = w.countries.length + 1;
    var rng = new AO.RNG(AO.hashString('rebel|' + w.meta.seed + '|' + capProv.id + '|' + turnNo));

    /* 名字：从命名器取，撞名就重掷（最多 40 次，兜底加序号） */
    var ng = new AO.NameGen(rng), nm = null, used = Object.create(null), i;
    for (i = 0; i < w.countries.length; i++) {
      if (w.countries[i] && w.countries[i].name) used[w.countries[i].name] = 1;
    }
    for (i = 0; i < 40; i++) {
      var cand = ng.country();
      if (!used[cand.name]) { nm = cand; break; }
    }
    if (!nm) { nm = ng.country(); nm.name = nm.name + '（新）'; }

    /* 颜色：从国家色盘里挑一个"邻国都没用过"的（和 07-politics 的图着色同一条纪律） */
    var pal = AO.COUNTRY_PALETTE || ['#8a8f98'];
    var nbCol = Object.create(null);
    var nbSet = Object.create(null);
    for (i = 0; i < group.length; i++) {
      var pp = w.provinces[group[i] - 1];
      if (!pp || !pp.neighbors) continue;
      for (var k = 0; k < pp.neighbors.length; k++) {
        var q = w.provinces[pp.neighbors[k] - 1];
        if (q && q.owner && q.owner !== (capProv.owner | 0)) nbSet[q.owner] = 1;
      }
    }
    for (var cid2 in nbSet) {
      var oc = w.countries[cid2 - 1];
      if (oc && oc.color) nbCol[oc.color] = 1;
    }
    var color = pal[0], colorIndex = 0;
    for (i = 0; i < pal.length; i++) {
      var ci2 = (rng.int(pal.length) + i) % pal.length;
      if (!nbCol[pal[ci2]]) { color = pal[ci2]; colorIndex = ci2; break; }
    }

    var person = ng.person();
    var leader = {
      name: person.name, name_en: person.name_en, gender: person.gender,
      title: person.gender === 'f' ? '女王' : '国王',
      age: 26 + rng.int(22), reign: 1
    };
    var nc = {
      id: id,
      name: nm.name, name_en: nm.name_en,
      gov: nm.gov, govKey: nm.gov, govCn: '王国',
      color: color, colorIndex: colorIndex,
      capital: capProv.id,
      provinces: [],
      area: 0, provinceCount: 0,
      neighbors: [],
      population: 0, density: 0, areaKm2: 0,
      economy: '农耕', house: ng.house(),
      leader: leader,
      portraitHat: 'crown',
      portrait: AO.makePortrait
        ? AO.makePortrait((AO.hashString('rebelp|' + nm.name_en + '|' + turnNo)) >>> 0,
            { color: color, hat: 'crown', gender: person.gender })
        : '',
      rebelFrom: capProv.owner | 0,
      rebelTurn: turnNo
    };
    w.countries.push(nc);

    /* 逐省易主：走 occupyProvince（成员表/颜色/缓存/编年史全由它管），
     * 完事**立刻删掉 OCCUPY** —— 独立出来的国，这一省是它的**本土**，
     * 不是"被它占领的省"（否则新国一开局全国都是占领省，×0.4 产出 +15 不安，
     * 出生即叛乱，两回合就自己散架）。 */
    var list = group.slice();
    for (i = 0; i < list.length; i++) {
      var p2 = w.provinces[list[i] - 1];
      if (!p2 || p2.owner !== nc.rebelFrom) continue;
      occupyProvince(p2.id, id, '独立');
      delete OCCUPY[p2.id];
      delete INTEG[p2.id];
      var u2 = unrestOf(p2.id);
      u2.v = 0; u2.target = 0;
      delete UNWARN[p2.id];
    }
    if (AO.recomputeCountry) AO.recomputeCountry(w, nc);
    /* 性格（PERSONA）不用在这里掷：18-ai 的 personaOf 是**惰性**的，
     * 第一次被问到时按 seed+cid 的散列补上 —— 新国天然走同一条路，
     * 老档里"多出来的那个 cid"也不需要迁移。 */
    CAPS = null; CPROV.w = null;
    invalidateGeo();
    return nc;
  }

  /* 每回合结算尾跑一次：所有 UNREST ≥ 80 的省各自掷 */
  function settleRevolt() {
    var U = AO.UNREST, w = state.world;
    if (!w) return 0;
    var fired = 0;
    /* 先收集再处理：处理过程中会新增/删除 UNREST 条目（倒戈清零、独立清表），
     * 边遍历边改 for-in 会漏省 */
    var list = [];
    for (var k in UNREST) {
      var pid = +k;
      if (unrestOf(pid).v >= U.revoltAt) list.push(pid);
    }
    for (var i = 0; i < list.length; i++) {
      var pid2 = list[i], p = w.provinces[pid2 - 1];
      if (!p || !p.owner || countryDead(p.owner)) continue;
      var owner = p.owner | 0, gar = hasGarrison(pid2);

      /* PLAYER 的省：先给一次「危急」警告（比爆发早一档 —— 这是唯一的反应窗口） */
      if (PLAYER && owner === PLAYER) warnPlayerProv(pid2, p);

      if (Math.random() >= U.revoltChance) continue;
      var kind = rollRevoltKind(gar);
      if (kind === 'bandit') riotAt(pid2, p, owner);
      else if (kind === 'defect') { if (!defectTo(pid2, p)) riotAt(pid2, p, owner); }
      else if (!secedeAt(pid2, p)) riotAt(pid2, p, owner);
      fired++;
    }
    return fired;
  }
  AO.resSettleRevolt = settleRevolt;

  /* 危急预警：只在档位**抬升**时报一次（70 警戒 / 80 危急），
   * 已经报过的不重复刷屏；不安回落到 70 以下则复位（下次攒上去还会再报）。
   *
   * 两档的用意（"提前一回合"就靠这个）：
   *   70 警戒 —— 还在爆发线以下，这一回合安抚 / 派官 / 调兵都来得及；
   *   80 危急 —— 已经到了爆发线，每回合 15% 掷骰，说的是"这一回合就可能炸"。 */
  function warnPlayerProv(pid, p) {
    var U = AO.UNREST, u = unrestOf(pid);
    var lv = u.v >= U.warnAt2 ? 2 : (u.v >= U.warnAt ? 1 : 0);
    if (!lv) { delete UNWARN[pid]; return false; }
    var had = UNWARN[pid] | 0;
    if (had >= lv) return false;
    UNWARN[pid] = lv;
    var txt = lv === 2
      ? '🚨 危急：' + p.name + ' 不安 ' + Math.round(u.v) + '，随时可能倒戈或独立 —— 立刻派兵弹压或花金安抚'
      : '⚠ 警戒：' + p.name + ' 不安 ' + Math.round(u.v) + '（' + U.revoltAt +
        ' 即爆发）—— 下一回合还有机会安抚、派官或驻军';
    NOTES.push({ owner: PLAYER, pid: pid | 0, cls: 'warn', text: txt });
    return true;
  }
  AO.resWarnPlayerProv = warnPlayerProv;

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
      /* 军工科技（制式装备 / 淬火 / 量产）没有 fx 也没有 mil，效果写在 desc 上 */
      var what = t.desc ? t.desc
        : t.fx ? fxDesc(t) : t.mil ? milEffectText(t.mil)
          : (d ? d.build : t.for) + ' 可以盖/升 Lv2 了';
      NOTES.push({ owner: +owner, cls: 'ok', text: '「' + t.cn + '」研究完成：' + what });
      /* 装备材质换代（拍板⑥）：这条科技把材质推上新高 → 旧库存折半回炉。
       * 判定用"研完之后 matIdxOf 的顶格正好是它"，所以重复研 / 研低档都不会误触发。 */
      if (t.mat) {
        var mi = matIdxOf(owner);
        if (AO.EQUIP.mat[mi].key === t.mat) {
          equipRecycle(owner, '新材质「' + AO.EQUIP.mat[mi].cn + '」');
        }
      }
      /* 兵刃换代回收（v19，任务书第七节）：工艺链往前一档 → 全国所有**更低代**
       * 的兵刃队份折半回炉，每份返 0.5 铁，战报一条「换代回收」。
       * 武器库存永远只有一代 —— 不留旧货，是因为"征兵吃库存最高代"这条规则
       * 会让旧货变成永远用不掉的死库存。炮与舰不回收（拍板项）。 */
      if (t.craft && !t.free) gearRecycle(owner, '「' + t.cn + '」');
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
    if (!reqOk(t, R)) return 'wait';
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
    var off = { id: GOV_ID++, name: pickOffName(), traitKey: tr.key, owed: 0,
      rank: 0, ten: 0, griev: 0, salAcc: 0, warned: 0 };
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

  /* 派一位候选去某省上任。一省一位：原来那位自动回池。
   * v11：被顶替的那位按"卸任"处理（资历减半、怨气清零），和点「撤」一个待遇 ——
   * 否则"换个人顶上"就成了免费洗怨气的后门。 */
  function assignOfficial(pid, offId, silent) {
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (!prov) return { ok: false, msg: '没有这个省' };
    if (!silent && !canAct(prov.owner)) return { ok: false, msg: lockTitle() };
    var T = talentOf(prov.owner), idx = -1, i;
    for (i = 0; i < T.pool.length; i++) if (T.pool[i].id === offId) { idx = i; break; }
    if (idx < 0) return { ok: false, msg: '这位不在候选池里（可能已经上任了）' };
    var cur = OFFICIAL[pid | 0];
    if (cur) {
      retireNote(cur, prov, silent);
      T.pool.push(retireOff(cur));
    }
    var off = T.pool.splice(idx, 1)[0];
    offNorm(off);
    off.at = turnNo;                 // 上任回合：贪墨官的"3 回合窗口"从这里算
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
    retireNote(off, prov || pv0, silent);
    talentOf(prov ? prov.owner : 0).pool.push(retireOff(off));
    return off;
  }

  /* 资历 ≥2 的老臣卸任 → 一条"荣休"纪要（只对玩家国）。
   * 记录的是**卸任前**的资历 —— retireOff 之后已经减半了。 */
  function retireNote(off, prov, silent) {
    if (!off || silent) return;
    offNorm(off);
    if (off.rank < 2) return;
    var owner = prov ? prov.owner : 0;
    if (!PLAYER || owner !== PLAYER) return;
    NOTES.push({ owner: PLAYER, pid: prov ? prov.id : 0, cls: 'ok',
      text: '荣休：' + off.name + '（' + (prov ? prov.name : '') + '，资历 ' + off.rank +
        '「' + AO.GOV.rankCn[off.rank] + '」）卸任还乡，回候选池候用' });
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

  /* ---------------- 人口承载力（v18.2）：这省现在能养多少人 ----------------
   * 公式全在 15-resources 的 POPCAP（纯函数，可单测），这里只负责**读表**：
   * 地形 / 是不是首都 / 三种建筑几座（农场分 Lv1、Lv2）/ 铁犁深耕研没研。
   * 每回合现算、**不写进 POP** —— 建筑一拆、科技一研，上限立刻跟着变，
   * 存档里也就不会出现"上限和面板上的建筑对不上"这种鬼。 */
  function popCapCtx(pid) {
    pid = pid | 0;
    var bag = SIM[pid] || {};
    var farm = bag.grain, fish = bag.fish, horse = bag.horse;
    var g = GRANARY[pid];
    var prov = state.world ? state.world.provinces[pid - 1] : null;
    var owner = prov ? prov.owner : 0;
    var c = owner ? coOf(owner) : null;
    return {
      /* 首都：`c.capital` 是那个国现在的首都 id，而这块地的 owner 就是这个国 ——
       * 首都被人打下来之后 owner 变了，这里自然就不再算 1.5（不用另写判断）。 */
      capital: !!(c && c.capital === pid),
      farm1: (farm && farm.tiers && farm.tiers[1]) || 0,
      farm2: (farm && farm.tiers && farm.tiers[2]) || 0,
      /* 渔港 / 牧场不分档：加成表里只有一档（+8 / +4），所以按**总座数**算。
       * 停产（halted）照样算 —— 房子还在，塌不了；停的只是产出。 */
      fish: (fish && fish.built) || 0,
      horse: (horse && horse.built) || 0,
      granary: (g && g.n) || 0,
      plow: techDone(owner, AO.POPCAP.plowTech),
      /* 面积：只在 POPCAP.areaRef 打开时才进公式（默认关，见常量区） */
      area: prov ? prov.area : 0
    };
  }
  /* 科技研没研 —— 按**科技键**查（'plow2'）。
   * 注意别拿 researched() 顶：它收的是**资源键**（'grain'），内部要经 AO.techFor
   * 转一次；把科技键喂进去会 techFor('plow2') → null → 永远 false
   * （这个坑 test/pop.js 的"铁犁深耕 ×1.25"当场就抓到了）。 */
  function techDone(owner, techKey) {
    var R = RESEARCH[owner | 0];
    return !!(R && R.done && R.done[techKey]);
  }
  function popCapOf(pid) {
    var prov = state.world ? state.world.provinces[(pid | 0) - 1] : null;
    if (!prov || !AO.POPCAP) return 0;
    return AO.POPCAP.capOf(prov.terrain, popCapCtx(pid));
  }
  /* AI（18-ai 的 provScore）和测试都从这两个口进 */
  AO.resPopCap = popCapOf;
  AO.resPopCapCtx = popCapCtx;

  /* ---------------- 人口：吃粮、涨落 ----------------
   * 口粮：**每 200 万人每回合吃 1 单位**（先粮食、再渔获）。
   * 涨落看的是"本回合产出 vs 口粮"，不是库存 —— 这样人口不会一路涨到把存粮吃光：
   *   产出 − 口粮 ≥ 3 → +1.2%/回合
   *   产出 − 口粮 ≥ 1 → +0.4%/回合
   *   产出刚够吃（差 0~1）→ 不涨不跌，人口停在这儿
   *   产出不够吃 → 先吃存粮；存粮也见底才 −1.5%（真饥荒）
   * 于是"每回合净余 1 单位"就是人口的天然上限：想让人口再涨，就多盖农场/渔港。
   *
   * v18.2 加了一道**硬天花板**（承载力，见 15-resources 的 POPCAP）：
   *   pop < cap → 上面那套分档照旧
   *   pop ≥ cap → 增长归零（不回落；面板写「人丁兴旺」）
   *   pop > cap → −1%/回合往 cap 回落（吞地 / 事件涌入的人慢慢流走）
   * 两把刀各管各的：口粮管"今年够不够吃"（饥荒 −1.5%），
   * 承载力管"这块地最多住多少"。饥荒比拥挤更狠，所以两个都在时取 −1.5%。 */
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
    /* 承载力（v18.2）：现算一次，三个分支都看它 */
    var cap = popCapOf(pid);
    var over = cap > 0 && s.v > cap;          // 人满为患（吞地 / 事件涌入）
    var rate;
    if (eat < need) rate = -0.015;            // 连存粮都吃不上（饥荒比拥挤更狠）
    else if (over) rate = -AO.POPCAP.overRate; // 超限：每回合 −1% 往 cap 回落
    else if (cap > 0 && s.v >= cap) rate = 0;  // 摸顶：增长归零，**不回落**
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
    /* 回落**不许穿过 cap**：-1% 一步踩到 cap 以下的话，下一回合又变成"没到顶，
     * 可以继续涨"，人口就会在 cap 上下反复抖 —— 落到底就停住。 */
    if (over && rate < 0 && s.v < cap) s.v = Math.round(cap);
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
    /* lack 记**第一处凑不齐的资源**（键 + 还差多少），缺多少种都写进 lack 表：
     * 调用方只读 r.lack / r.need（老写法），面板能拿到整张表。 */
    var lack = Object.create(null), lackKey = null, lackNeed = 0;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!short[k]) continue;
      need[k] = Math.ceil(short[k] / (1 - loss));    // 路上会损耗，得多调一点
      var avail = 0;
      for (var j = 0; j < list.length; j++) {
        if (list[j].id !== p.id) avail += stockOf(list[j].id, k);
      }
      if (avail < need[k]) {
        lack[k] = need[k] - avail;
        if (!lackKey) { lackKey = k; lackNeed = lack[k]; }
      }
    }
    if (lackKey) return { ok: false, lack: lackKey, need: lackNeed, lacks: lack, loss: loss };

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

  /* 一次性扣款（维修面板用）：本省库存 → 中央国库，**不调拨**。
   * 和 payCost 的差别有三条，都是维修特有的：
   *   ① 不允许"从同国富裕省调拨" —— 修个房子要先在几十个省之间调货，
   *      玩家根本算不过来这钱最后是谁出的；维修只花本省和中央。
   *   ② 走同一套"凑齐才扣"：缺一分都不扣，避免付了钱没修好的中间态。
   *   ③ 记账用 FLOW / FLOWC 的两本流水（和 payMaint 同一套口径），
   *      省卡的"收支"里能看出"这回合我花在维修上的铁金"。
   * 返回 { ok, spent:{iron,gold}, lack:{iron,gold} }。 */
  function drawStock(pid, owner, cost) {
    var keys = Object.keys(cost || {}), i, k;
    var bag = SIM[pid], cen = ensureCentral(owner);
    var have = {}, lack = {}, any = false;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!(cost[k] > 0)) continue;
      have[k] = (bag && bag[k] ? bag[k].stock : 0) + (cen[k] || 0);
      if (have[k] < cost[k]) { lack[k] = Math.ceil(cost[k] - have[k]); any = true; }
    }
    if (any) return { ok: false, lack: lack, spent: {} };
    var spent = {}, F = FLOW[pid], FC = FLOWC[owner];
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      var need = cost[k] | 0;
      if (need <= 0) continue;
      var t1 = bag && bag[k] ? Math.min(bag[k].stock, need) : 0;
      if (t1 > 0) {
        bag[k].stock -= t1;
        if (F) { F.loss[k] = (F.loss[k] || 0) + t1; F.d.maint[k] = (F.d.maint[k] || 0) + t1; }
      }
      var t2 = need - t1;
      if (t2 > 0) {
        cen[k] = (cen[k] || 0) - t2;
        if (FC) { FC.loss[k] = (FC.loss[k] || 0) + t2; FC.d.maint[k] = (FC.d.maint[k] || 0) + t2; }
        if (F) F.d.maintC[k] = (F.d.maintC[k] || 0) + t2;
      }
      spent[k] = t1 + t2;
    }
    return { ok: true, spent: spent };
  }

  /* 19-repair.js 里"这一处现在是什么状态"的统一视图。
   * 资源建筑和通用设施形状不一样（built/tiers vs n），在这里抹平，
   * 维修层只认 { halted, built, n, active, off, site, due, repair() }。
   *   built  已建座数（面板"已建"列）
   *   active 在跑座数（保留座数裁过之后）—— 维护费与产量都按它算
       *   off    玩家主动停的（保留 0 座）：不是失修，不算欠费 */
  function repLive(pid, kind) {
    if (kind === 'wall') {
      var w = WALL[pid];
      if (!w || !(w.lv > 0)) return null;
      var woff = keepOff(pid, 'wall');
      return {
        halted: !!w.halted, built: w.lv, n: w.lv, active: woff ? 0 : w.lv,
        off: woff, site: w.site | 0, mAcc: w.mAcc,
        due: woff ? { iron: 0, gold: 0 } : wallMaintDue(w, pOf(pid) ? pOf(pid).owner : 0),
        repair: function () { w.hp = AO.WALL.maxHp(w.lv); w.halted = false; }
      };
    }
    var owner = pOf(pid) ? pOf(pid).owner : 0;
    var def = AO.RESOURCE_BY_KEY[kind];
    if (def) {
      var s = SIM[pid] && SIM[pid][kind];
      if (!s) return null;
      var built = s.built | 0;
      return {
        halted: !!s.halted, built: built, n: built,
        active: AO.rep && AO.rep.effKeep ? AO.rep.effKeep(pid, kind, built) : built,
        off: keepOff(pid, kind),
        site: s.site | 0,
        gone: !!s.gone,
        /* 干跑预测（20-balance）要的三组数，和结算同源：
         * tiers = 按当前保留座数裁出来的档位（先保 Lv2）；
         * gross = 这一类这回合的毛产（simPerTurn 已按保留座数算）；
         * mAcc  = 维护费的攒整零头（预测要逐回合 floor，不能用平均值糊）。 */
        tiers: activeTiers(pid, kind, s),
        gross: simPerTurn(s, def, pid, kind),
        mAcc: s.mAcc,
        due: maintDue(s, def, owner, pid, kind),
        /* 修好 = 清失修标记 + 清欠账零头（不清零头的话，修好下一回合
         * 那笔 39 的欠账会立刻把人再拖回停产） */
        repair: function () {
          s.halted = false;
          if (s.mAcc) { s.mAcc.iron = 0; s.mAcc.gold = 0; }
        }
      };
    }
    var st = UNIV[kind] && UNIV[kind][pid];
    if (!st) return null;
    var ud = univDef(kind);
    var uoff = keepOff(pid, kind);
    return {
      halted: !!st.halted, built: st.n | 0, n: st.n | 0,
      active: uoff ? 0 : (st.n | 0), off: uoff, site: st.site | 0, mAcc: st.mAcc,
      due: uoff ? { iron: 0, gold: 0 }
        : { iron: (ud.maint.iron || 0) * st.n, gold: (ud.maint.gold || 0) * st.n },
      repair: function () {
        st.halted = false;
        if (st.mAcc) { st.mAcc.iron = 0; st.mAcc.gold = 0; }
      }
    };
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
    /* 铁矿深层休眠：48 回合里一座都挖不出东西，加盖只是白花钱 */
    if (key === 'iron' && s.cool > 0) {
      return say(def.build + ' 的矿脉休眠中（还剩 ' + s.cool + ' 回合），先改建熔旧坊', 'warn');
    }
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
    if (key === 'iron' && s.cool > 0) {
      return bldMsg(def.build + ' 的矿脉休眠中（还剩 ' + s.cool + ' 回合），醒了再升', 'warn');
    }
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
    /* 市场每省一座（v18 追加三）：它是"换金的口"，不是产能建筑 ——
     * 多盖一座只是把同一个口开两次。要吞吐量该去修货运。 */
    if (kind === 'market' && st.n >= AO.MARKET.maxPer) {
      return say('每省一座市场——要吞吐量就去修货运（本省已有 ' + st.n + ' 座）', 'warn');
    }
    var r = payCost(p, D.cost);
    if (!r.ok) {
      return say('资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need + '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    st.site = effectiveTurns(p.id, p.owner, D.turnsAt());
    var tail = kind === 'school' ? '（每座每回合 +' + AO.SCHOOL.per + ' 科研点）'
      : kind === 'market' ? '（每座可把 ' + AO.MARKET.rate + ' 单位资源换成金，价随物价浮动）'
        : kind === 'granary' ? '（每座 +' + AO.GRANARY.capBonus + ' 粮/渔上限）'
          : kind === 'university' ? '（每座每回合 +' + AO.UNIVERSITY.perSci + ' 科研点 · +' +
            AO.UNIVERSITY.perTalent + ' 人才点）'
            : '（有它才能冲刺工期：' + costText(AO.BUILDER.sprintCost) + ' 砍 1 回合）';
    say(D.cn + '开工：' + costText(D.cost) + '，' + st.site + ' 回合后完工' + tail, 'ok');
  }
  function buildMarket(p) { return buildUniv(p, 'market'); }
  function buildBuilder(p) { return buildUniv(p, 'builder'); }

  /* =============================================================
   * 动态市场（① 物价指数）
   * =============================================================
   * 状态：PRICES[cid][key] = { v, target, trend }
   *   v       现价（1 = 卖 5 单位得 1 金），钳在 [cfg.lo, cfg.hi]
   *   target  由"库存 / 需求"的比值分档算出来（见 PRICES_CFG.ratio / tier）
   *   trend   和上回合的差：1 涨 / −1 跌 / 0 平（价格板画箭头用）
   *
   * 还有两张辅助表：
   *   PRICESHOCK[cid][key] = { target, turns, jump }  事件冲击（旱情 / 商队）
   *   PNEED[cid]           = { key: need }            上回合算出来的需求（面板只读）
   *
   * **为什么价格要按"国"算而不是按"省"算**：省是一天一地的集市，
   * 玩家不可能盯 1100 个价；国是决策单位（税率、建筑、出口都在国这一层）。
   * 省里的库存仍然真实（出口要落到具体某个省），只是价格是全国一个数。
   * ============================================================= */

  var PNEED = Object.create(null);

  /* 惰性创建一条价格记录。初始 target = v = base（1.0）—— 开局不该有任何
   * 资源"一上来就贵"，那是给人添堵；第一次 settlePrices 之后才分档。 */
  function priceRow(cid, key) {
    var C = AO.PRICES_CFG, row = PRICES[cid | 0];
    if (!row) row = PRICES[cid | 0] = Object.create(null);
    var it = row[key];
    if (!it) it = row[key] = { v: C.base, target: C.base, trend: 0 };
    return it;
  }
  function priceV(cid, key) { return priceRow(cid, key).v; }
  function priceTrend(cid, key) { return priceRow(cid, key).trend | 0; }
  AO.resPriceOf = priceV;

  /* 箭头 + 数字，三处（价格板 / 货源行 / 国库总览）共用一套写法，
   * 免得一处写「↑」一处写「涨」。 */
  function priceArrow(t) { return t > 0 ? '↑' : t < 0 ? '↓' : '—'; }
  function priceNum(v) { return (Math.round((v || 0) * 100) / 100).toFixed(2); }
  AO.resPriceNum = priceNum;

  /* 全国库存（含中央国库）：中央的粮也是这个国的粮，
   * 不算进来的话"国库囤了一仓粮、各省却报高价"，玩家会觉得价格板在骗人。 */
  function countryStock(cid, key) {
    var list = countryProvinces(cid), out = 0, i;
    for (i = 0; i < list.length; i++) out += stockOf(list[i].id, key);
    var cen = CENTRAL[cid | 0];
    if (cen) out += (cen[key] || 0);
    return out;
  }
  AO.resCountryStock = countryStock;

  /* 一个省这回合的维护需求（铁 / 金）。价格只拿它当"军需需求的尺子"，
   * 所以不必精确到分 —— 但也不能凭空拍一个数，否则"盖了军械坊铁就贵"
   * 这条因果玩家感受不到。这里复用的就是真正扣维护的那张表（maintDue），
   * 所以"价格板上的铁价涨了"和"维护真的多扣了铁"永远同源。 */
  function provMaintNeed(pid, owner) {
    var out = { iron: 0, gold: 0 }, k, s, d, m, i;
    var bag = SIM[pid | 0];
    if (bag) {
      for (k in bag) {
        s = bag[k]; d = AO.RESOURCE_BY_KEY[k];
        if (!d || !s) continue;
        /* 按"在跑的座数"算：停掉的那几座不缴维护，价格板上的"军需需求"
         * 也该跟着降 —— 否则玩家停了半个国家的矿，铁价还挂在天上 */
        m = maintDue(s, d, owner, pid | 0, k);
        out.iron += m.iron; out.gold += m.gold;
      }
    }
    for (i = 0; i < UNIV_KINDS.length; i++) {
      var ud = univDef(UNIV_KINDS[i]), us = UNIV[UNIV_KINDS[i]][pid | 0];
      if (!ud || !us) continue;
      m = maintDue(us, ud, owner);
      out.iron += m.iron; out.gold += m.gold;
    }
    var w = WALL[pid | 0];
    if (w && w.lv > 0) {
      var wm = wallMaintDue(w, owner);
      out.iron += wm.iron || 0; out.gold += wm.gold || 0;
    }
    return out;
  }

  /* 一国的七种需求（七种一次算完 —— 逐种算会把省表扫七遍）。 */
  function needOf(cid) {
    var C = AO.PRICES_CFG, out = Object.create(null);
    var list = countryProvinces(cid), rs = AO.RESOURCES || [], i, ki;
    var food = 0, iron = 0, gold = 0, n = 0;
    /* 打仗的时候军械消耗上去了 → 铁/金需求 ×warNeedMul（"战时铁贵"的来历） */
    var warMul = 1;
    for (var wk in WARSET) {
      if (!WARSET[wk]) continue;
      var ab = wk.split('|');
      if ((ab[0] | 0) === (cid | 0) || (ab[1] | 0) === (cid | 0)) { warMul = C.need.warNeedMul; break; }
    }
    for (i = 0; i < list.length; i++) {
      var p = list[i], pop = POP[p.id];
      /* 口粮：优先用 settlePop 算好的 need（和吃饭用的是同一个数）；
       * 它还没算过（读档后第一回合）就按人口现推一遍。 */
      food += (pop && pop.need) ? pop.need
        : Math.max(1, Math.round((p.population || 0) / 2000000));
      var md = provMaintNeed(p.id, cid | 0);
      iron += md.iron; gold += md.gold;
      n++;
    }
    for (ki = 0; ki < rs.length; ki++) {
      var key = rs[ki].key;
      var v;
      if (C.need.foodShare[key] !== undefined) v = food * C.need.foodShare[key];
      else if (key === 'iron') v = iron * warMul;
      else if (key === 'gold') v = gold * warMul;
      else v = n * C.need.otherPer;
      /* cover：把"每回合用量"换算成"想囤多少回合"（见 PRICES_CFG.need 的注释） */
      out[key] = Math.max(C.need.floor, v * (C.need.cover || 1));
    }
    return out;
  }
  AO.resNeedOf = needOf;

  /* 目标价：库存 / 需求 的比值分四档。 */
  function priceTarget(stock, need) {
    var C = AO.PRICES_CFG;
    var r = stock / Math.max(need || 1, C.need.floor);
    if (r < C.ratio.scarce) return C.tier.scarce;   // 半够吃都不到 → 1.8
    if (r < C.ratio.tight) return C.tier.tight;     // 刚够 → 1.3
    if (r < C.ratio.glut) return C.tier.ok;         // 三倍以内 → 1.0
    return C.tier.glut;                             // 三倍以上 → 0.7（积压）
  }

  /* 事件冲击：把某国某种资源的目标价**接管** turns 回合。
   * jump=1 表示"这一回合就大幅反应"（走 shockLerp），用于旱情 / 商队这种
   * "消息一出市场立刻动"的事；普通冲击不传 jump，按 25% 慢慢挪。
   * 接管而不是叠加是刻意的：叠乘会变成"旱情 × 缺粮"两个数相乘，
   * 玩家在面板上只能看到一个结果，猜不出它是怎么来的。 */
  function priceNudge(cid, key, target, turns, jump) {
    var C = AO.PRICES_CFG;
    if (!cid || !key) return null;
    var row = PRICESHOCK[cid | 0] || (PRICESHOCK[cid | 0] = Object.create(null));
    row[key] = { target: AO.clamp(target, C.lo, C.hi), turns: Math.max(1, turns | 0), jump: jump ? 1 : 0 };
    return row[key];
  }
  AO.resPriceNudge = priceNudge;

  /* 结算：每国每种资源各走一步。放在**结算尾**（事件之后）——
   * 这样旱情/丰收这些事当回合就能进价格，而不是隔一回合才反应；
   * AI 与面板读的是**上一回合结算出来的价**（和"人看着昨天的行情做决定"一致）。 */
  function settlePrices() {
    var C = AO.PRICES_CFG, w = state.world;
    if (!w) return 0;
    var rs = AO.RESOURCES || [], i, ki, n = 0;
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || !c.provinces || !c.provinces.length) continue;
      if (countryDead(c.id)) continue;
      var need = needOf(c.id);
      PNEED[c.id] = need;
      for (ki = 0; ki < rs.length; ki++) {
        var key = rs[ki].key;
        var it = priceRow(c.id, key);
        var tgt = priceTarget(countryStock(c.id, key), need[key]);
        /* 冲击接管目标价 */
        var lp = C.lerp, sh = PRICESHOCK[c.id] && PRICESHOCK[c.id][key];
        if (sh) {
          tgt = sh.target;
          if (sh.jump) lp = C.shockLerp;
          sh.jump = 0;
          if (--sh.turns <= 0) delete PRICESHOCK[c.id][key];
        }
        it.target = tgt;
        var nv = AO.clamp(it.v + (tgt - it.v) * lp, C.lo, C.hi);
        it.trend = Math.abs(nv - it.v) < 0.005 ? 0 : (nv > it.v ? 1 : -1);
        it.v = nv;
        n++;
      }
    }
    return n;
  }
  AO.resSettlePrices = settlePrices;

  /* 卖价 / 买价 —— 三处（卖、世界市场买、外国买）都从这里取，不许各写一份。
   *   sellGold  卖一手（MARKET.rate 单位）到手多少金（可能带小数 → 攒整）
   *   buyGold   世界市场进货一手要多少金（贵，是应急口；v18 追加三前叫"中央价"）
   *   fBuyGold  跟外国买一手要多少金（对方 PI × premium） */
  function sellGold(cid, key) { return priceV(cid, key); }
  function buyGold(cid, key) { return Math.ceil(AO.GOV.buyLot().gold * priceV(cid, key)); }
  function fBuyGold(cid, key) {
    var P = AO.DIPLO.trade;
    return Math.ceil(AO.GOV.buyLot().gold * P.premium * priceV(cid, key));
  }
  function expGold(cid, key) {
    var C = AO.PRICES_CFG;
    return priceV(cid, key) * C.exportCut * (C.exportLot / (AO.MARKET.rate || 5));
  }
  AO.resSellGold = sellGold;
  AO.resBuyGold = buyGold;
  AO.resFBuyGold = fBuyGold;
  AO.resExpGold = expGold;

  /* 卖资源换金：本省库存直接扣 rate 份、加 1 金。库存不够 → 调用方把按钮置灰。
   * **只做手动**：v1 不做自动交易（那会把沙盒变成挂机游戏）。
   *
   * v18（B）：加 silent 参数 —— AI 卖货走**同一个函数**（家法同 buildOne）：
   * silent=true 时不写 bldMsg、不查 canAct，成功/失败用 { ok, got, why } 回话。 */
  function sellResource(p, key, silent) {
    var say = silent ? noop : bldMsg;
    if (!p) return silent ? { ok: false, why: '没有这个省' } : undefined;
    if (!silent && !canAct(p.owner)) return say(lockTitle(), 'warn');
    var M = AO.MARKET, mk = MARKET[p.id];
    if (!mk || !(mk.n > 0)) return say('本省还没有市场', 'warn');
    if (mk.halted) return say('市场维护欠费，停产中（卖不了货）', 'warn');
    var s = SIM[p.id] && SIM[p.id][key];
    if (!s) return silent ? { ok: false, why: '本省没有这种资源' } : undefined;
    if (s.stock < M.rate) {
      return say(cnOf(key) + ' 不够：要 ' + M.rate + '，只有 ' + s.stock, 'warn');
    }

    s.stock -= M.rate;
    var g = SIM[p.id].gold;
    /* 卖价 = 本国这一种资源的物价指数（一手 = rate 单位 = PI 金）。
     * PI 带小数（1.3 金），所以走**攒整**：账上 +1.3，落袋 1，零头 0.3 留在
     * SELLACC 里等下一笔。不攒整的话 round(1.3)=1、round(0.7)=1 —— 物价指数
     * 就被四舍五入吃没了，价格板写得再准也没用。 */
    var raw = sellGold(p.owner, key);
    SELLACC[p.id] = (SELLACC[p.id] || 0) + raw;
    var whole = Math.floor(SELLACC[p.id] + 1e-9);
    SELLACC[p.id] = SELLACC[p.id] - whole;
    /* 卖货的金也吃上限（满仓 → 钱白赚了，记 d.cap 让玩家看得见） */
    if (g && whole > 0) gainStock(p.id, 'gold', whole, flowOf(p.id));
    var tr = priceTrend(p.owner, key);
    say('卖 ' + M.rate + ' ' + cnOf(key) + ' → +' + priceNum(raw) + ' 金（' + cnOf(key) +
      '价 ' + priceNum(raw) + ' ' + priceArrow(tr) + '）' +
      (whole < raw - 1e-9 ? '　零头 ' + priceNum(SELLACC[p.id]) + ' 攒到下一笔' : '') +
      (g ? '　金 ' + g.stock + ' / 上限 ' + capOf(p.id, 'gold') : ''), 'ok');
    return silent ? { ok: true, got: whole, raw: raw } : undefined;
  }

  /* 买货：省库金 → **世界市场** → 进本省库存（v18 追加三：国库不是商店）。
   * 这是省库的**第二种花法**（第一种是发俸禄、建东西）。
   *
   * 旧版是"从中央国库调货"（buyCentral），等于把国库当商店：中央的粮铁既要
   * 维护拨款、又要建造调拨、还要应付全国进货，最后必然是"中央没货 → 全国
   * 买不了"，而玩家还以为是自己缺粮。现在改成**虚空来货**：
   *   · 货从世界市场来 —— 供给无限，不扣任何一方的库存；
   *   · 钱从省库出、进世界市场 —— **金沉没**，不落到任何账上。
   * 所以买货不再是"搬仓库"，而是一台通胀阀门：想补货就得真金白银往外掏，
   * 掏不起才是真稀缺。中央国库从此只剩三个去处：维护拨款、建造调拨、
   * 科技国家工程 —— **国库不是商店**。
   *
   * 价格 = `ceil(lot.gold × 本国 PI)`（贵是故意的）：本国缺什么，买什么就贵
   * （缺粮时进粮要 8 × 1.8 = 15 金）。缺货 → PI 涨 → 价涨 → 买到买不起为止，
   * 这条负反馈就是"无限供给"的刹车。所以按钮**永不为"中央没货"变灰**，
   * 唯一的闸是省库金够不够。
   *
   * 拆成 buyWorld(p, key, asAi) 是为了让 AI 走**同一条账**（④ 比价要用）：
   * asAi=true 时不写 bldMsg、不查 canAct，失败统一返回 { ok:false, msg }。 */
  function buyWorld(p, key, asAi) {
    var fail = asAi ? function (t) { return { ok: false, msg: t }; }
      : function (t) { return bldMsg(t, 'warn'); };
    if (!asAi && !canAct(p.owner)) return fail(lockTitle());
    if (BLOCKADE[p.id]) return fail('本省被舰队封锁，买不了货');
    var lot = AO.GOV.buyLot(), price = buyGold(p.owner, key);
    var bag = SIM[p.id], g = bag && bag.gold, s = bag && bag[key];
    if (!g || !s) return fail('本省没有金库');
    /* 唯一的闸：省库有没有钱。世界市场永远有货 —— 这里不再读中央库存 */
    if (g.stock < price) {
      return fail('省库金不够：进货要 ' + price + '，省库只有 ' + g.stock);
    }
    g.stock -= price;               // 金沉没：付给世界市场，谁都不记这笔进项
    /* 进货进省库：同样受上限约束（满仓再买 = 白花钱，提示里说清楚） */
    var got = gainStock(p.id, key, lot.n, FLOW[p.id]);
    if (!asAi) {
      bldMsg('买 ' + lot.n + ' ' + cnOf(key) + ' ← ' + price + ' 金（世界市场 · ' + cnOf(key) + '价 ' +
        priceNum(priceV(p.owner, key)) + ' ' + priceArrow(priceTrend(p.owner, key)) +
        ' · 省库 ' + g.stock + ' 金）' +
        (got < lot.n ? '　⚠ 省库满仓，只收下 ' + got + '（上限 ' + capOf(p.id, key) + '）' : ''), 'ok');
    }
    fogInvalidate();
    return { ok: true, got: got, paid: price, from: 'world' };
  }
  function buyResource(p, key) { return buyWorld(p, key, false); }
  AO.resBuy = buyResource;
  AO.resBuyWorld = function (p, key) { return buyWorld(p, key, true); };

  /* ---------------- 省库买铁付维护（v18.4） ----------------
   * 上解把金搬出去了，可维护吃的是**铁** —— 于是"有金没铁"的省照样停产。
   * 这一条把世界市场那条口子接到维护上：这一回合**真有**建筑因为没铁停下来，
   * 省库就自己去买几单位铁补上，然后当场补缴。
   *
   * 价格和玩家点「买货」同源（`buyGold` 那一把尺子），只是**按单位零买**：
   *   单位价 = ceil(lot.gold / lot.n × PI)   （≈ 整手价的 1/5，进位取整、无批发价）
   * 为什么零买而不是整手（5 单位）：维护一回合只缺 0.2~1 铁，整手买进来
   * 四分之三躺在省库里，下一回合被建造吃掉，然后再买 —— 探针实测：整手预买
   * 100 回合买掉 2660 铁（4668 金），停产只从 192 降到 151；改成"缺几单位买
   * 几单位"之后，同一批停产只花 1/4 的金。**金是这局的稀缺资源**（上解、俸禄、
   * 建造都排在它后面），能少花就少花。
   *
   * 四道闸（AO.GOV.selfBuy）：
   *   at          省库铁 < 它才买（铁还够的时候不许囤）
   *   keepGold    省库付完还得剩这么多金（不把开工钱花在买铁上）
   *   lotsPerTurn 每国每回合至多几"手"（1 手 = 5 单位）—— 换算成单位配额
   *   usePool     省库不够时，从**中央拨款**里补（和 payMaint 同一条两段付款）
   *   封锁 / 满仓 / 没金：买不了就不买（和 buyWorld 同一条）
   *
   * 它和 buyWorld 走**同一条账**：金沉没进世界市场、货从虚空来、受上限约束，
   * 只是发起人从"玩家点按钮"换成"结算时的自救"。所以不会出现两个价，
   * AI 也不能偷偷便宜进货。
   * 返回值：这一笔花了几金（0 = 没买）。测试靠它定点验。 */
  var SELFBUY = Object.create(null);   // owner -> 本回合已买几单位
  var SELFBUY_TURN = -1;
  /* 只读统计（bench / 测试回答"这条规则有没有在动"）：
   * 光看某一回合的库存变化会被"这一回合刚好没缺"骗过去。 */
  var SELFSTAT = { n: 0, gold: 0, iron: 0, pool: 0 };
  function selfBuyStat() { return SELFSTAT; }
  AO.resSelfBuyStat = selfBuyStat;
  /* 一单位铁多少钱（面板 / 测试 / 结算三处共用这一个函数，别各算一份） */
  function selfBuyUnit(owner) {
    var lot = AO.GOV.buyLot(), n = lot.n || 1;
    var p = Math.ceil(lot.gold / n * priceV(owner | 0, 'iron') - 1e-9);
    return p > 0 ? p : 1;
  }
  AO.resSelfBuyUnit = selfBuyUnit;
  /* 买 want 单位（可以做不满：配额 / 现金 / 仓位哪一项不够就少买几单位） */
  function selfBuyIron(pid, owner, F, want) {
    var S = AO.GOV && AO.GOV.selfBuy;
    owner = owner | 0;
    if (!S || !owner) return 0;
    want = Math.floor(want === undefined ? 1 : want);
    if (!(want > 0)) return 0;
    var bag = SIM[pid | 0], s = bag && bag.iron, g = bag && bag.gold;
    if (!s || !g) return 0;                       // 没有铁袋的省（理论上不存在）
    var at = S.at === undefined ? 2 : S.at;
    if ((s.stock || 0) >= at) return 0;           // 还够用：不囤铁
    if (BLOCKADE[pid | 0]) return 0;              // 被封锁的省买不了货（和 buyWorld 同一条）
    if (SELFBUY_TURN !== turnNo) { SELFBUY_TURN = turnNo; SELFBUY = Object.create(null); }
    var lot = AO.GOV.buyLot();
    var qmax = Math.floor((S.lotsPerTurn === undefined ? 1 : S.lotsPerTurn) * (lot.n || 5));
    var left = qmax - (SELFBUY[owner] || 0);
    if (left <= 0) return 0;                      // 本国的配额用完了
    if (want > left) want = left;
    var room = Math.floor(capOf(pid | 0, 'iron') - (s.stock || 0));
    if (want > room) want = room;                 // 满仓：买了也白买
    if (want <= 0) return 0;
    var up = selfBuyUnit(owner), keep = S.keepGold === undefined ? 6 : S.keepGold;
    /* 两段付款（和 payMaint 同一条家法）：**省库先掏**，不够的从中央拨款里划。
     * 为什么必须给中央这一段：维护本来就是"省库 → 中央拨款"两段付的，买铁
     * 却只认省库的话，正好把最需要续命的那批穷省挡在门外（探针：停产省里
     * 90% 的省库金不足 5，它们连一单位铁都买不起）。中央的钱本来也是这个国的钱。 */
    var mine = Math.floor(((g.stock || 0) - keep) / up);
    if (mine < 0) mine = 0;
    if (mine > want) mine = want;
    var cenN = 0, cenPay = 0;
    if (mine < want && S.usePool !== false) {
      var R = AO.rep, cen = ensureCentral(owner);
      var poolLeft = (R && R.reserve) ? R.reserve() : 0;
      cenN = Math.min(want - mine, Math.floor((cen.gold || 0) / up),
        Math.floor(poolLeft / up));
      if (cenN > 0) {
        cenPay = cenN * up;
        if (R && R.takePool) R.takePool(cenPay);
        cen.gold = (cen.gold || 0) - cenPay;
        if (R && R.noteSpent) R.noteSpent(owner, cenPay);
      }
    }
    var units = mine + cenN;
    if (units <= 0) return 0;
    var price = units * up;
    var own = mine * up;
    if (own > 0) g.stock -= own;                  // 金沉没：付给世界市场，谁都不记进项
    var got = gainStock(pid | 0, 'iron', units, F);
    if (F) {
      if (own > 0) F.loss.gold = (F.loss.gold || 0) + own;
      F.gain.iron = (F.gain.iron || 0) + got;
      F.d.buyIron = (F.d.buyIron || 0) + price;   // 省卡收支：「买铁 −N 金」
      F.d.buyIronN = (F.d.buyIronN || 0) + got;   //                「买铁 +N 铁」
      /* 中央垫的那一份单列 —— 省库库存没少那么多，混在一起账就对不上了 */
      if (cenPay > 0) F.d.buyIronC = (F.d.buyIronC || 0) + cenPay;
    }
    SELFBUY[owner] = (SELFBUY[owner] || 0) + got;
    SELFSTAT.gold += price; SELFSTAT.iron += got; SELFSTAT.n++;
    SELFSTAT.pool += cenPay;
    return price;
  }

  /* ---------------- 兑换（以物易物，v18 / B2） ----------------
   * 市场的第三条腿：卖货是"资源 → 金"，买货是"金 → 资源"，
   * 兑换是**资源 → 资源**（粮换铁、金换铁、鱼换盐…七种两两可换）。
   *
   * 汇率：换回 = floor(付出 × PI(付出) / PI(换回) × (1 − MARKET.xchg.spread))
   *   · 用**卖价（PI）**折算，两边同一把尺子 —— 所以"缺什么就贵什么"自动生效：
   *     铁荒（PI 1.8）时 5 粮（PI 1.0）只换得到 2 铁；粮荒时反过来。
   *   · 抽一成（spread 0.10）：不抽的话"粮换铁再换回粮"零损耗，市场就成了
   *     一台免费搬运机；抽一成之后倒手是亏的，兑换只用于"真的缺这一种"。
   *   · 一手 = MARKET.rate（5 单位），和卖货同一把尺子。
   *
   * 三条闸：市场要在营（n>0 且未停产）、同种不换、**目标仓装不下就不换**
   * （不白扣付出 —— 换一半比不换更难看懂）。 */
  function xchgOut(owner, give, get, n) {
    var pv = priceV(owner, give), pw = priceV(owner, get);
    if (!(pv > 0) || !(pw > 0)) return 0;
    var cut = 1 - ((AO.MARKET.xchg && AO.MARKET.xchg.spread) || 0);
    return Math.floor(n * pv / pw * cut + 1e-9);
  }
  function exchangeResource(p, give, get, silent) {
    var say = silent ? noop : bldMsg;
    /* 失败统一走 fail()：silent 时回 { ok:false, why }，面板上照旧是一条提示 */
    var fail = function (t) {
      say(t, 'warn');
      return silent ? { ok: false, why: t } : undefined;
    };
    if (!p) return fail('没有这个省');
    if (!silent && !canAct(p.owner)) return fail(lockTitle());
    var mk = MARKET[p.id];
    if (!mk || !(mk.n > 0)) return fail('本省还没有市场');
    if (mk.halted) return fail('市场维护欠费，停产中（换不了货）');
    if (!give || !get || give === get) return fail('同一种东西不用换');
    var bag = SIM[p.id], gs = bag && bag[give], ss = bag && bag[get];
    if (!gs || !ss) return fail('本省没有这种资源');
    var lot = AO.MARKET.rate;
    if (gs.stock < lot) {
      return fail(cnOf(give) + ' 不够：要 ' + lot + '，只有 ' + gs.stock);
    }
    var out = xchgOut(p.owner, give, get, lot);
    if (out <= 0) {
      return fail('按现在的物价，' + lot + ' ' + cnOf(give) + ' 换不到 1 ' + cnOf(get) +
        '（' + cnOf(give) + '价 ' + priceNum(priceV(p.owner, give)) + ' · ' +
        cnOf(get) + '价 ' + priceNum(priceV(p.owner, get)) + '）');
    }
    var cap = capOf(p.id, get);
    if (ss.stock + out > cap) {
      return fail(cnOf(get) + ' 装不下 ' + out + '（现有 ' + ss.stock + ' / 上限 ' + cap +
        '）—— 先腾地方');
    }
    gs.stock -= lot;
    var got = gainStock(p.id, get, out, FLOW[p.id]);
    var F = FLOW[p.id];
    if (F) {
      F.loss[give] = (F.loss[give] || 0) + lot;
      F.gain[get] = (F.gain[get] || 0) + got;
      if (!F.d.xchg) F.d.xchg = Object.create(null);
      F.d.xchg[give] = (F.d.xchg[give] || 0) + lot;
      F.d.xchg[get] = (F.d.xchg[get] || 0) - got;
    }
    say('兑换：' + lot + ' ' + cnOf(give) + ' → ' + got + ' ' + cnOf(get) +
      '（' + cnOf(give) + '价 ' + priceNum(priceV(p.owner, give)) + ' · ' +
      cnOf(get) + '价 ' + priceNum(priceV(p.owner, get)) +
      ' · 市场抽 ' + Math.round((AO.MARKET.xchg.spread || 0) * 100) + '%）', 'ok');
    return silent ? { ok: true, got: got, paid: lot } : undefined;
  }
  AO.resXchgOut = xchgOut;
  AO.resExchange = exchangeResource;

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
    if (!reqOk(t, R)) {
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

  /* ---------------- 熔旧坊（枯竭铁矿场的改建） ----------------
   * **不新增建筑行**：它住在铁矿场那一行里，n>0 时行内变身（见 renderBldList）。
   * 状态形状照 UNIV 小状态（n / site / halted / mAcc），另加一个 iAcc 攒铁零头。
   *
   * 三条账必须分清：
   *   ① 改建价（木材 10 · 金 14）走 payCost —— 和别的建筑同一条付款路
   *   ② 每回合产铁 → bag.iron.stock（省库），吃 CAP 上限，记 FLOW gain(.smelt)
   *   ③ 金耗 = 产量 × 0.5 —— **省库 → 中央**（维护那条路），但**不欠账**：
   *      付不起就是这一炉少炼一半，mAcc 只留小数零头，不挂欠款。
   * 枯竭矿本身照旧不收维护（① 段里 `if (!s.built || s.gone) continue` 已经跳过了），
   * 所以熔旧坊没有铁/金维护，只有"每炼一块铁要付半块钱"这一笔。 */
  function smeltOf(pid) { return SMELT[pid | 0] || null; }
  /* 惰性创建：只有真的要改建（或已经在产）的省才留记录 */
  function smeltNew(pid) {
    var k = pid | 0;
    return SMELT[k] || (SMELT[k] = {
      n: 0, site: 0, halted: false,
      mAcc: { iron: 0, gold: 0 }, iAcc: 0
    });
  }
  /* 存档用的瘦身版（照 sparseUniv）：没炉、没工地的省不存 */
  function sparseSmelt() {
    var out = {}, k, st;
    for (k in SMELT) {
      st = SMELT[k];
      if (st && ((st.n | 0) > 0 || (st.site | 0) > 0)) out[k] = st;
    }
    return out;
  }
  /* 完工：一座改建落地 */
  function finishSmelt(pid) {
    var st = SMELT[pid | 0];
    if (!st) return false;
    st.site = 0;
    st.n = Math.min(AO.SMELT.maxPer, (st.n | 0) + 1);
    return true;
  }
  /* 熔旧坊付金：省库 → 中央，**付得多少算多少、不记欠账**。
   * 和 payMaint 的差别只有一条：维护欠费要记在建筑身上（下回合接着补），
   * 熔旧坊欠费就是"这一炉少炼一半"，账当场结清。 */
  function payGold(pid, owner, need) {
    if (!(need > 0)) return 0;
    var bag = SIM[pid], cen = ensureCentral(owner);
    var F = (CUR.pid === (pid | 0)) ? CUR.F : null;
    var FC = (CUR.owner === (owner | 0)) ? CUR.FC : null;
    var got = 0;
    if (bag && bag.gold && bag.gold.stock > 0) {
      var t1 = Math.min(bag.gold.stock, need);
      bag.gold.stock -= t1; got += t1;
      if (F) { F.loss.gold = (F.loss.gold || 0) + t1; F.d.smeltGold = (F.d.smeltGold || 0) + t1; }
    }
    if (got < need) {
      var t2 = Math.min(cen.gold || 0, need - got);
      if (t2 > 0) {
        cen.gold = (cen.gold || 0) - t2; got += t2;
        if (FC) { FC.loss.gold = (FC.loss.gold || 0) + t2; FC.d.smeltGold = (FC.d.smeltGold || 0) + t2; }
        /* 中央替这一省垫的金：只作说明，不进省侧 F.loss（否则省库存对不上账） */
        if (F) F.d.smeltC = (F.d.smeltC || 0) + t2;
      }
    }
    return got;
  }
  /* 一回合的熔旧坊结算（settleTurn ③a 调用）
   *   产量 = perAt(人口) × 座数        （小数进 iAcc，攒整入库）
   *   金耗 = 产量 × goldPerIron        （小数进 mAcc，攒整扣款）
   * 付不起 → **当回合产量减半**，且不欠账；连一半都付不起 → 停炉（halted）。 */
  function settleSmelt(pid, owner) {
    var st = SMELT[pid | 0], D = AO.SMELT;
    if (!st || !(st.n > 0)) return 0;
    var bag = SIM[pid];
    /* 没有铁矿资源的省开不了炉（理论上七种资源每省都有，这里只是防御） */
    if (!bag || !bag.iron) return 0;
    var pop = (POP[pid] && POP[pid].v) || 0;
    var per = D.perAt(pop);
    st.iAcc = (st.iAcc || 0) + per * st.n;
    var out = Math.floor(st.iAcc);
    if (out <= 0) { st.halted = false; return 0; }   // 还没攒够一块铁
    st.iAcc -= out;
    /* 满仓：熔出来也放不下 —— 这一炉先不炼，**也不扣金**。
     * 照抄 gainStock 的口径记一笔"满仓损耗"（省卡收支小结看得见），
     * 否则"熔旧坊满仓之后每回合白吃半块钱"会变成一笔隐形亏损。 */
    var room = capOf(pid, 'iron') - bag.iron.stock;
    if (room <= 0) {
      var F0 = FLOW[pid];
      if (F0) F0.d.cap.iron = (F0.d.cap.iron || 0) + out;
      return 0;
    }
    if (out > room) out = room;

    /* 这一回合真能掏出的金：省库 + 中央（和 payGold 同一顺序） */
    var cen = ensureCentral(owner);
    var budget = ((bag.gold && bag.gold.stock) || 0) + (cen.gold || 0);
    var m0 = st.mAcc.gold || 0;
    var need = Math.floor(m0 + out * D.goldPerIron + 1e-9);
    var got = out;
    if (need > budget) {
      got = Math.floor(out / 2);                      // 付不起 → 当回合减半
      need = Math.floor(m0 + got * D.goldPerIron + 1e-9);
      if (need > budget) got = 0;                     // 连一半都付不起 → 停炉
    }
    if (got <= 0) {
      /* 停炉只在**刚停的那一回合**报一条：连着几十回合没钱的话，
       * 每回合刷一句会把纪要冲干净（和"维护欠费停产"同一条纪律） */
      if (!st.halted) {
        NOTES.push({ owner: owner | 0, pid: pid | 0, cls: 'warn',
          text: '熔旧坊缺金停炉（1 铁 = 0.5 金，付不起就少炼一半）—— 省库与国库都没金了' });
      }
      st.halted = true;
      return 0;
    }
    st.halted = false;
    /* 金：攒整才扣（1 铁 = 0.5 金，单回合的零头留到下一回合），扣完不留欠账 */
    st.mAcc.gold = m0 + got * D.goldPerIron - need;
    if (need > 0) payGold(pid, owner, need);

    var kept = gainStock(pid, 'iron', got, FLOW[pid]);
    var F = FLOW[pid];
    if (F) {
      F.gain.iron = (F.gain.iron || 0) + kept;
      F.d.smelt = (F.d.smelt || 0) + kept;
    }
    return kept;
  }
  AO.resSettleSmelt = settleSmelt;

  /* 改建：唯一入口是「铁矿场」那一行在**矿脉枯竭后**变出来的「改建」钮。
   * 不新增建筑行 —— 熔旧坊就是这一行的下半辈子。 */
  function buildSmelt(p, silent) {
    var say = silent ? noop : bldMsg;
    var D = AO.SMELT;
    var bag = SIM[p.id], s = bag && bag.iron;
    if (!s) return say('本省没有铁矿脉，开不了炉', 'warn');
    if (!silent && !canAct(p.owner)) return say(lockTitle(), 'warn');
    var st = smeltNew(p.id);
    var ck = D.check(p, {
      bag: bag, smeltN: st.n, site: st.site,
      edu: talentOf(p.owner).total || 0
    });
    if (!ck.ok) return say(ck.why, 'warn');
    var r = payCost(p, D.cost);
    if (!r.ok) {
      return say('改建资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need +
        '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    st.site = effectiveTurns(p.id, p.owner, D.turns);
    var pop = (POP[p.id] && POP[p.id].v) || 0;
    say('熔旧坊改建开工：' + costText(D.cost) + '，' + st.site + ' 回合后完工' +
      '（第 ' + (st.n + 1) + ' 座 · 每座每回合约 +' + D.perAt(pop).toFixed(2) + ' 铁）', 'ok');
  }

  /* ---------------- 淘金场（枯竭金矿场的改建，v18 / A） ----------------
   * **逐条镜像熔旧坊**：不新增建筑行（住在金矿场那一行里，n>0 时行内变身）、
   * 唯一入口是矿脉枯竭后的「改建」、封顶 2 座、无门槛、不吃维护、吃满仓上限。
   *
   * 三条账（和 SMELT 一一对应，只有付的东西不同）：
   *   ① 改建价（木材 10 · 金 12）走 payCost —— 和别的建筑同一条付款路
   *   ② 每回合产金 → bag.gold.stock（省库），吃 CAP 上限，记 FLOW gain(.wash)
   *   ③ 木耗 = 产量 × 2 —— **省库木材现付**；没木就这一回合不出金，
   *      不扣木、不倒扣、也不把产量攒到下回合（账当场结清）
   * 枯竭矿本身照旧不收维护（产出循环里 `if (!s.built || s.gone) continue` 已跳过）。 */
  function washOf(pid) { return WASH[pid | 0] || null; }
  function washNew(pid) {
    var k = pid | 0;
    return WASH[k] || (WASH[k] = {
      n: 0, site: 0, halted: false,
      mAcc: { iron: 0, gold: 0 }, iAcc: 0, tAcc: 0
    });
  }
  /* 存档用的瘦身版（照 sparseSmelt）：没场、没工地的省不存 */
  function sparseWash() {
    var out = {}, k, st;
    for (k in WASH) {
      st = WASH[k];
      if (st && ((st.n | 0) > 0 || (st.site | 0) > 0)) out[k] = st;
    }
    return out;
  }
  function finishWash(pid) {
    var st = WASH[pid | 0];
    if (!st) return false;
    st.site = 0;
    st.n = Math.min(AO.WASH.maxPer, (st.n | 0) + 1);
    return true;
  }
  /* 一回合的淘金场结算（settleTurn ③a 紧跟 settleSmelt）
   *   产量 = perAt(人口) × 座数        （小数进 iAcc，攒整入库）
   *   木耗 = 产量 × timberPerGold(2)   （省库木材现付）
   * 没木 → 这一回合不出金：不扣木、不倒扣，也不攒产量（下一回合从零再算）。 */
  function settleWash(pid, owner) {
    var st = WASH[pid | 0], D = AO.WASH;
    if (!st || !(st.n > 0)) return 0;
    var bag = SIM[pid];
    if (!bag || !bag.gold) return 0;
    var pop = (POP[pid] && POP[pid].v) || 0;
    var per = D.perAt(pop);
    st.iAcc = (st.iAcc || 0) + per * st.n;
    var out = Math.floor(st.iAcc);
    if (out <= 0) { st.halted = false; return 0; }   // 还没攒够一块金
    st.iAcc -= out;
    /* 满仓：淘出来也放不下 —— 这一趟不淘，**也不扣木**（照抄 settleSmelt 的口径） */
    var room = capOf(pid, 'gold') - bag.gold.stock;
    if (room <= 0) {
      var F0 = FLOW[pid];
      if (F0) F0.d.cap.gold = (F0.d.cap.gold || 0) + out;
      return 0;
    }
    if (out > room) out = room;

    var wood = (bag.timber && bag.timber.stock) || 0;
    var need = Math.ceil(out * D.timberPerGold - 1e-9);   // 1 金 = 2 木
    if (need > wood) {
      /* 停淘只在**刚停的那一回合**报一条（和熔旧坊同一条纪律） */
      if (!st.halted) {
        NOTES.push({ owner: owner | 0, pid: pid | 0, cls: 'warn',
          text: '淘金场缺木停淘（1 金 = 2 木，没木就不出金）—— 省库木材见底' });
      }
      st.halted = true;
      return 0;
    }
    st.halted = false;
    bag.timber.stock -= need;
    var F = FLOW[pid];
    if (F) {
      F.loss.timber = (F.loss.timber || 0) + need;
      F.d.washWood = (F.d.washWood || 0) + need;
    }
    var kept = gainStock(pid, 'gold', out, F);
    if (F) {
      F.gain.gold = (F.gain.gold || 0) + kept;
      F.d.wash = (F.d.wash || 0) + kept;
    }
    return kept;
  }
  AO.resSettleWash = settleWash;

  /* 改建：唯一入口是「金矿场」那一行在**矿脉枯竭后**变出来的「改建」钮。
   * 和 buildSmelt 逐条对齐（连 canAct / payCost / effectiveTurns 都一样）。 */
  function buildWash(p, silent) {
    var say = silent ? noop : bldMsg;
    var D = AO.WASH;
    var bag = SIM[p.id], s = bag && bag.gold;
    if (!s) return say('本省没有金矿脉，淘不了金', 'warn');
    if (!silent && !canAct(p.owner)) return say(lockTitle(), 'warn');
    var st = washNew(p.id);
    var ck = D.check(p, { bag: bag, washN: st.n, site: st.site });
    if (!ck.ok) return say(ck.why, 'warn');
    var r = payCost(p, D.cost);
    if (!r.ok) {
      return say('改建资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need +
        '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    st.site = effectiveTurns(p.id, p.owner, D.turns);
    var pop = (POP[p.id] && POP[p.id].v) || 0;
    say('淘金场改建开工：' + costText(D.cost) + '，' + st.site + ' 回合后完工' +
      '（第 ' + (st.n + 1) + ' 座 · 每座每回合约 +' + D.perAt(pop).toFixed(2) + ' 金）', 'ok');
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

  /* ---------------- 枯竭矿的再就业（熔旧坊 / 淘金场） ----------------
   * v18：这两座建筑的规则**逐条镜像**（同一套 check / build / settle / 存档 /
   * 面板写法），面板上只有"产什么、付什么"两处不同。所以行渲染、? 面板、
   * ＋钮统统读这一份描述子 —— 写两遍的话，下次改一处必然漏另一处。 */
  function refitOf(key) {
    if (key === 'iron') {
      return {
        key: 'smelt', def: AO.SMELT, of: smeltOf, mk: smeltNew, build: buildSmelt,
        nKey: 'smeltN', icon: 'item-smelt-bld.png',
        outCn: '铁', payCn: '金', payPer: AO.SMELT.goldPerIron,
        tag: '熔炉', btnAttr: 'data-smelt'
      };
    }
    if (key === 'gold') {
      return {
        key: 'wash', def: AO.WASH, of: washOf, mk: washNew, build: buildWash,
        nKey: 'washN', icon: 'item-wash-bld.png',
        outCn: '金', payCn: '木', payPer: AO.WASH.timberPerGold,
        tag: '淘金', btnAttr: 'data-wash'
      };
    }
    return null;
  }
  /* check 的上下文：两种建筑除了座数字段名不同，其余一样 */
  function refitCtx(rf, bag, n, site) {
    var o = { bag: bag, site: site };
    o[rf.nKey] = n;
    return o;
  }
  /* 这一行现在能不能改建（熔旧坊 / 淘金场）——
   *   铁 → 矿"睡了"（永久枯竭 gone，或深层休眠 cool>0），规则在 AO.SMELT.dormant
   *   金 → 只认 gone（金矿 cool 仍是 0，不会休眠，淘金场入口不变）
   * ＋钮、? 面板、AI 的 trySmelt 都读这一份，别再各写一遍 `s.gone`。 */
  function refitReady(rf, s) {
    if (!rf || !s) return false;
    return rf.key === 'smelt' ? AO.SMELT.dormant(s) : !!s.gone;
  }
  /* 行图标：assets/res/item-<key>-bld.png。
   * 缺图就退回原矿场那一行的图（imgFallback 的第一级是 -bld.png，第二级是内联 SVG）——
   * 这一行本来就是矿场变来的，借它的图不算错。 */
  function refitIconTag(rf, size) {
    return '<img class="bart-img" src="assets/res/' + rf.icon + '" data-refit="' + rf.key + '"' +
      ' style="width:' + size + 'px;height:' + size + 'px"' +
      ' onerror="AO.imgFallback(this,\'' + (rf.key === 'wash' ? 'gold' : 'iron') + '\',1,' + size + ')">';
  }

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
    /* 行内变身后，? 面板的标题也得跟着变 —— 否则玩家点开「熔旧坊」那一行，
     * 第一行却写着「铁矿场」，会以为点错了行 */
    var rfH = refitOf(r.key);
    var rfHst = rfH ? rfH.of(p.id) : null;
    var smHead = !!(rfH && rfHst && (rfHst.n | 0) > 0);
    var h = '<div class="h">' + (smHead ? rfH.def.cn + ' · 原' + def.build : def.build) +
      '<span>已建 ' + s.built + ' 座' +
      (s.site > 0 ? ' · ' + (s.siteKind === 'up' ? '升档中' : '在建') + '（' + s.site + ' 回合）' : '') + '</span></div>';
    /* 居民消耗是建筑属性，任何状态下都写出来 */
    var eatLine = def.eat > 0
      ? '<div class="l"><i>居民</i> 本地吃掉 ' + Math.round(def.eat * 100) + '%' +
        (s.built ? '（每回合约 ' + (simPerTurn(s, def, p.id, r.key) * def.eat).toFixed(1) + ' 个）' : '') +
        '，剩下才入库</div>'
      : '';

    /* 档位区：两档并排 + 座数 + 升级价 + 自愿原则。
     * 矿枯了 / 睡了就不画档位卡 —— 那两张卡写的是"活着的时候产多少、吃多少维护"，
     * 挂在一条死矿（或一条睡了 48 回合的矿）上只会和下面那句"不产不收维护"打架。 */
    var ironSleep = r.key === 'iron' && s.cool > 0 && !s.gone;
    if (s.gone || ironSleep) {
      h += '<div class="l ' + (ironSleep ? 'cool' : 'gone') + '"><i>矿场</i> ' +
        (ironSleep
          ? '矿脉深层休眠：' + s.built + ' 座' + def.build + '全部停摆（不产、不收维护），还剩 ' +
            s.cool + ' 回合回满'
          : '矿脉已采空：' + s.built + ' 座' + def.build + '全部停摆（不产、不收维护）') + '</div>';
    } else {
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
    }

    /* 枯竭 / 休眠矿的再就业（熔旧坊 / 淘金场）：只在对应资源那一行出现。
     *   矿睡了  → 写"还有一条活路"（改建价 / 每座产多少 / 料耗怎么算）
     *   已改过  → 写产量与料耗对账，矿醒过来之后还要写"两份收入叠加" */
    if (rfH) {
      var rfD = rfH.def;
      var rfN2 = rfHst ? (rfHst.n | 0) : 0, rfS2 = rfHst ? (rfHst.site | 0) : 0;
      var rfPop = (POP[p.id] && POP[p.id].v) || 0, rfPer = rfD.perAt(rfPop);
      if (rfN2 > 0 || rfS2 > 0) {
        h += '<div class="l"><i>' + rfH.tag + '</i> ×' + rfN2 +
          (rfS2 > 0 ? '　<span class="muted">改建中（' + rfS2 + ' 回合）</span>' : '') +
          '　每座 +' + rfPer.toFixed(2) + ' ' + rfH.outCn + '/回合' +
          (rfN2 > 0 ? '（合计 +' + (rfPer * rfN2).toFixed(2) + '）' : '') + '</div>';
        h += '<div class="l"><i>料耗</i> 产量 × ' + rfH.payPer + ' ' + rfH.payCn +
          '（' + (rfN2 > 0 ? '约 ' + (rfPer * rfN2 * rfH.payPer).toFixed(2) + ' ' + rfH.payCn + '/回合，' : '') +
          (rfH.key === 'wash' ? '省库木材；没木当回合不出金，不倒扣）' : '省库 → 中央；付不起当回合产量减半，不欠账）') +
          '</div>';
        if (!s.gone && !(s.cool > 0) && s.built > 0) {
          h += '<div class="l"><i>叠加</i> <em class="ok">矿脉已复活</em>：' + def.build + ' ' + s.built +
            ' 座照常出产 + ' + rfD.cn + ' ' + rfN2 + ' 座 —— 两份收入叠加</div>';
        }
      }
      if (refitReady(rfH, s)) {
        var ck2 = rfD.check(p, refitCtx(rfH, SIM[p.id], rfN2, rfS2));
        h += '<div class="l' + (ck2.ok ? '' : ' gone') + '"><i>改建</i> ' +
          (ck2.ok
            ? rfD.cn + ' ' + costText(rfD.cost) + ' · ' +
              effectiveTurns(p.id, p.owner, rfD.turns) + ' 回合 · 封顶 ' +
              rfD.maxPer + ' 座'
            : ck2.why) + '</div>';
        h += '<div class="l"><i>汇率</i> ' + rfD.note + '</div>';
      }
    }

    if (s.gone) {
      h += '<div class="l gone"><i>枯竭</i> 想再出' + (r.key === 'gold' ? '金' : '铁') + '，只能改建' +
        (r.key === 'gold' ? '淘金场' : '熔旧坊') + '；' +
        '若勘探「矿脉新发现」命中，矿脉会复活（与' + (r.key === 'gold' ? '淘金场' : '熔旧坊') + '并存）</div>';
      h += '<div class="l"><i>已产</i> ' + s.stock + ' ' + prod + '</div>';
      h += eatLine;
      return h;
    }
    if (s.cool > 0) {
      var pct = Math.max(0, Math.min(100, (1 - s.cool / (def.cool || 1)) * 100));
      /* 铁矿的 48 回合是"深层休眠"（v18 追加一补课），其余资源是短休耕。
       * 同一套倒计时，只是说法不同 —— 玩家得知道"48 回合后这条矿会自己醒"。 */
      h += '<div class="l cool"><i>' + (r.key === 'iron' ? '休眠' : '冷静') + '</i> 还剩 ' + s.cool + ' 回合' +
           (r.key === 'timber' ? '（林地慢慢长回来）'
             : r.key === 'iron' ? '（深层休眠：到点储量回满，矿场自己复产）'
               : '（资源慢慢恢复）') + '</div>';
      h += '<div class="bar cool"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      h += '<div class="l"><i>已产</i> ' + s.stock + ' ' + prod + '　' +
           (r.key === 'iron' ? '休眠完' : '冷静完') + '剩余回满 ' + s.n + '</div>';
      h += eatLine;
      return h;
    }
    if (!s.built) {
      h += '<div class="l"><i>产出</i> 还没建 —— 点上面的 ＋ 建一座</div>';
      h += '<div class="l"><i>单座</i> 每回合 +' + def.per + ' ' + prod +
           '，储量 ' + s.n + (def.cool > 0
             ? '，采空后' + (r.key === 'iron' ? '休眠 ' : '冷静 ') + def.cool + ' 回合'
             : '，采空即枯竭') + '</div>';
      h += '<div class="l"><i>造价</i> ' + costText(costOf(def, lv2)) +
           (lv2 ? '（科技已研，新盖直接 Lv2）' : '') + '（本省 → 中央 → 同国各省）</div>';
      return h;
    }

    var per = simPerTurn(s, def, p.id, r.key);
    var popCls = (Date.now() - s.pop < 420) ? ' num pop' : ' num';
    var turns = per > 0 ? Math.ceil(s.left / per) : 0;
    /* 座数写法：全开就只写座数；有停着的座就写"在跑 6 / 14 座" ——
     * 否则玩家看到产量变少了却找不到原因（那是他自己在维修面板里停的） */
    var at = activeTiers(p.id, r.key, s);
    var actN = (at[1] || 0) + (at[2] || 0);
    var seatTxt = !s.built ? '' : (actN < s.built
      ? '（在跑 ' + actN + ' / ' + s.built + ' 座）' : (s.built > 1 ? '（' + s.built + ' 座）' : ''));
    h += '<div class="l"><i>产出</i> 每回合 +' + per + ' ' + prod + seatTxt +
         (s.halted ? '　<em class="halted">已停产</em>' : '') + '</div>';
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
  /* 失修的那一行，悬停时多两句：现在欠了多少、去哪儿修。
   * 单独拆出来是因为资源建筑和通用设施两处都要用同一句话 ——
   * 写两遍迟早会有一边忘了改。 */
  function repHint(p, kind) {
    if (!AO.rep) return '';
    var t = '\n欠账 ' + panelNeed(p.id, kind) + '（铁/金各按整数计）';
    t += '\n修复：右上「维修」里点「修」，或把这一类的保留座数减下来（停掉的座不缴维护）';
    var lv = repLive(p.id, kind);
    if (lv && lv.built > 0) {
      t += '\n本省在跑 ' + lv.active + ' / ' + lv.built + ' 座' +
        (lv.off ? '（整类已停）' : '');
    }
    return t;
  }
  /* 欠账在人话里的样子：封顶显示 40+（账本身不封顶，封顶只是别让 title 长得离谱） */
  function panelNeed(pid, kind) {
    var lv = repLive(pid, kind);
    if (!lv) return '—';
    var s = SIM[pid] && SIM[pid][kind];
    var acc = s && s.mAcc ? s.mAcc : null;
    if (!acc) return '—';
    var i = Math.max(0, acc.iron || 0), g = Math.max(0, acc.gold || 0);
    var f = function (v) { return v > 40 ? '40+' : v.toFixed(1); };
    return f(i) + ' 铁 / ' + f(g) + ' 金';
  }

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
      /* 枯竭矿的再就业（熔旧坊 / 淘金场）：只挂在对应资源那一行上（不新增行）。
       *   n > 0    → 行内变身：名字/图标/×n 都换成它
       *   s.gone   → ＋ 钮变成「改建」（唯一入口）
       * 复活（lode 命中枯竭矿）之后两样并存：这一行仍是它，
       * 但名字旁边挂一个「矿×N」的小字，两份收入叠加。 */
      var rf = refitOf(r.key);
      var smt = rf ? rf.of(p.id) : null;
      var smN = smt ? (smt.n | 0) : 0;
      var smSite = smt ? (smt.site | 0) : 0;
      var asSmelt = smN > 0;
      var popNow = (POP[p.id] && POP[p.id].v) || 0;
      var smPer = rf ? rf.def.perAt(popNow) : 0;
      /* 矿睡了就能改建：铁认 dormant（gone 或 cool>0），金只认 gone */
      var refitOn = refitReady(rf, s);
      var smCk = refitOn ? rf.def.check(p, refitCtx(rf, bag, smN, smSite)) : null;
      /* 铁矿的 48 回合深层休眠：行上挂一个蓝标，把倒计时摆在明面上 */
      var ironSleep = r.key === 'iron' && s.cool > 0 && !s.gone;

      var row = doc.createElement('div');
      row.className = 'rr bld';
      /* data-key：行内变身后名字会变成「熔旧坊」，靠名字找行就不可靠了
       * （测试和调试都按资源键取行） */
      row.setAttribute('data-key', r.key);
      row.title = def.build + '：已建 ' + s.built + ' 座' +
        (n2 ? '（Lv2 ×' + n2 + '）' : '') + (n1 ? '（Lv1 ×' + n1 + '）' : '') +
        (s.site > 0 ? '，' + (s.siteKind === 'up' ? '升档中' : '在建') + '（剩 ' + s.site + ' 回合）' : '') +
        '，' + (ironSleep
          ? '休眠中（还剩 ' + s.cool + ' 回合，不产不收维护）'
          : '每回合 +' + simPerTurn(s, def, p.id, r.key) + ' ' + prod) +
        '\n造价 ' + costText(costOf(def, lv2)) + '（本省 → 中央 → 同国各省）' +
        (lv2 ? '\n升档 ' + costText(def.cost2) + ' / 座' : '\n升 Lv2 要先研究「' + ((tech && tech.cn) || '对应科技') + '」') +
        '\n维护 ' + maintText(def.maint, p.owner) + ' / 座·回合' +
        '\n工期 ' + effectiveTurns(p.id, p.owner) + ' 回合' +
        '\n剩余储量 ' + s.left + (s.gone ? '，已枯竭'
          : s.cool > 0 ? (r.key === 'iron' ? '，休眠 ' : '，冷静 ') + s.cool + ' 回合' : '');
      if (s.halted) row.title += '\n维护欠费，停产中' + repHint(p, r.key);
      /* 它的账：行 title 里必须写清"产多少、付多少料、为什么值得" ——
       * 这一行在矿枯之后是唯一的来源，玩家得能一眼算出来。 */
      if (rf && (asSmelt || smSite > 0)) {
        row.title += '\n—— ' + rf.def.cn + ' ×' + smN +
          (smSite > 0 ? '（改建中，剩 ' + smSite + ' 回合）' : '') + ' ——' +
          '\n每座每回合 +' + smPer.toFixed(2) + ' ' + rf.outCn + '（人口 ' + AO.formatPop(popNow) + '）' +
          '\n' + rf.def.payNote +
          '\n' + rf.def.note;
      }

      /* 行图标：行内变身 → 手绘图（Lv2 有专属图就用专属图，没有就先借 Lv1 的） */
      if (asSmelt) row.insertAdjacentHTML('beforeend', refitIconTag(rf, 22));
      else row.insertAdjacentHTML('beforeend', bldVisual(r.key, n2 > 0 ? 2 : 1, 22));

      var nmb = doc.createElement('span');
      nmb.className = 'nm';
      nmb.textContent = asSmelt ? rf.def.cn : def.build;
      row.appendChild(nmb);

      var q = doc.createElement('span');
      /* 枯竭 = 红字（金）；休眠 = 蓝字（铁，48 回合后会醒）—— 两种"没铁可挖"不是一回事 */
      q.className = 'qty' + (asSmelt ? '' : s.gone ? ' gone' : ironSleep ? ' cool' : '');
      q.textContent = '×' + (asSmelt ? smN : s.built);
      q.title = asSmelt
        ? rf.def.cn + ' ' + smN + ' 座（每座每回合 +' + smPer.toFixed(2) + ' ' + rf.outCn +
          ' · 料耗 ×' + rf.payPer + ' ' + rf.payCn + '）'
        : '已建 ' + s.built + ' 座（Lv2 ×' + n2 + ' · Lv1 ×' + n1 + '）';
      row.appendChild(q);

      /* 铁矿深层休眠：把倒计时摆在行上（蓝标），不点开 ? 也看得见。
       * 48 回合是一段很长的等待 —— 玩家必须一眼知道"这条矿会自己醒"。 */
      if (ironSleep) {
        var slp = doc.createElement('span');
        slp.className = 'sleep';
        slp.textContent = '休眠 ' + s.cool;
        slp.title = '矿脉深层休眠：还剩 ' + s.cool + ' 回合回满储量（' + s.built +
          ' 座铁矿场停摆，不产不收维护）\n这段时间想有铁：改建熔旧坊，或者靠人口铁税';
        row.appendChild(slp);
      }

      /* 矿被 lode 复活之后：这一行还是它，但矿场的收入也在，
       * 所以挂一个小字「矿×N」——两份收入叠加，玩家得看得见两份。 */
      if (asSmelt && !s.gone && !(s.cool > 0) && s.built > 0) {
        var mn = doc.createElement('span');
        mn.className = 'old';
        mn.textContent = '矿×' + s.built;
        mn.title = '矿脉已复活：' + def.build + ' ' + s.built + ' 座照常出产，和' + rf.def.cn + '两份收入叠加';
        row.appendChild(mn);
      }
      /* 改建工地（和矿场自己的工地不会同时出现） */
      if (smSite > 0) {
        var smb = doc.createElement('span');
        smb.className = 'site';
        smb.textContent = '改' + smSite;
        smb.title = rf.def.cn + '改建中：还要 ' + smSite + ' 回合';
        row.appendChild(smb);
      }

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

      /* ＋ 钮：矿"睡了"（枯竭 / 深层休眠）就变成「改建」（熔旧坊 / 淘金场）——
       * 这是它们唯一的入口（不新增建筑行，也不在别处开口子）。
       * 矿还在产的、非矿行，一律还是原来的「再建一座」。 */
      var add = doc.createElement('button');
      var addSmelt = refitOn;
      add.className = 'add' + (addSmelt ? ' smelt' : '');
      add.type = 'button';
      if (addSmelt) {
        add.setAttribute(rf.btnAttr, '1');
        add.textContent = '改建';
        add.disabled = !smCk.ok;
        add.title = smCk.ok
          ? '改建' + rf.def.cn + '（第 ' + (smN + 1) + ' 座 / 封顶 ' + rf.def.maxPer + '）：' +
            costText(rf.def.cost) + '，' + effectiveTurns(p.id, p.owner, rf.def.turns) +
            ' 回合完工' +
            '\n每座每回合 +' + smPer.toFixed(2) + ' ' + rf.outCn +
            '\n' + rf.def.payNote +
            '\n' + rf.def.note
          : '改建不了：' + smCk.why;
      } else {
        add.textContent = '＋';
        add.disabled = s.gone || s.site > 0 || ironSleep;
        add.title = s.gone ? '已枯竭，不能再建'
          : ironSleep ? '矿脉休眠中（还剩 ' + s.cool + ' 回合），先改建熔旧坊'
            : s.site > 0 ? '还有工地，等完工'
              : '再建一座（' + costText(costOf(def, lv2)) + (lv2 ? '，Lv2' : '') + '）';
      }
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

      /* 「升」：科技已研 + 还有旧建筑 + 没有工地 + 矿醒着，才出现 */
      var up = null;
      if (lv2 && n1 > 0 && !(s.site > 0) && !s.gone && !(r.key === 'iron' && s.cool > 0)) {
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
      /* 行内变身后，状态灯读的是**熔旧坊**的账（矿本身已经枯了）：
       * 停炉 = 红灯，改建中 = 黄灯，在产 = 绿灯 */
      dot.className = 'dot' + (asSmelt
        ? ((smt && smt.halted) ? ' halt' : smSite > 0 ? ' site' : ' on')
        : (s.halted ? ' halt' : s.gone ? ' gone' : s.cool > 0 ? ' cool' :
          s.site > 0 ? ' site' : s.built ? ' on' : ''));
      row.appendChild(dot);

      var qb = doc.createElement('button');
      qb.className = 'qbtn';
      qb.type = 'button';
      qb.textContent = '?';
      qb.title = asSmelt ? rf.def.cn + '：产量 / 料耗 / 汇率 / 座数' : '档位 / 产出 / 维护 / 造价 / 剩余';
      row.appendChild(qb);

      box.appendChild(row);

      var panel = doc.createElement('div');
      panel.className = 'qinfo' + (state.openKey === r.key ? ' on' : '');
      panel.innerHTML = buildInfoHtml(r, def, s, p);
      box.appendChild(panel);
      if (state.openKey === r.key) qb.classList.add('on');

      (function (btn, pn, key, addBtn, upBtn, pp, spBtn, rf2) {
        btn.addEventListener('click', function () {
          state.openKey = (state.openKey === key) ? null : key;
          var on = pn.classList.toggle('on');
          btn.classList.toggle('on', on);
          if (on) renderBldList(pp);
        });
        addBtn.addEventListener('click', function () {
          /* 枯竭矿的 ＋ 是「改建」—— 同一个钮、两条路（熔旧坊 / 淘金场），
           * 别处不开第二个口子 */
          if (rf2 && addBtn.getAttribute(rf2.btnAttr) === '1') rf2.build(pp);
          else buildOne(pp, key);
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
      })(qb, panel, r.key, add, up, p, sprint, rf);
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
      row.title += '\n每座可把 ' + AO.MARKET.rate + ' 单位资源换成金，也能拿金去世界市场进货（点 ? 手动交易）' +
        '\n每省一座（' + AO.MARKET.maxPer + ' 座封顶）—— 要吞吐量就去修货运';
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
    if (st.halted) row.title += '\n维护欠费，' + (kind === 'school' ? '停课' : kind === 'market' ? '停产（卖不了货）' : '停产（冲不了工）') + ' 中' + repHint(p, kind);

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
    /* 市场每省一座（v18 追加三）：置灰不隐藏，title 直接给替代方案 */
    if (kind === 'market' && st.n >= AO.MARKET.maxPer) {
      gateWhy = '每省一座市场——要吞吐量就去修货运';
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
      /* 外国货源（v9）：和上面的"买"同一排按钮，只是多了个卖家 */
      var fbs = panel.querySelectorAll('button[data-fbuy]');
      for (var fj = 0; fj < fbs.length; fj++) {
        fbs[fj].addEventListener('click', function () {
          buyForeign(p, this.getAttribute('data-fbuy'), +this.getAttribute('data-fcid'));
          renderInfoLists(p);
        });
      }
      /* 兑换（v18 / B2）：两排小钮选"付出 / 换回"，再点「兑换」。
       * 选完要重画（高亮和"这一手"的账都跟着变），所以 chip 也走 renderInfoLists。 */
      var xgiv = panel.querySelectorAll('button[data-xgive]');
      for (var xgi = 0; xgi < xgiv.length; xgi++) {
        xgiv[xgi].addEventListener('click', function () {
          state.xgive = this.getAttribute('data-xgive');
          renderInfoLists(p);
        });
      }
      var xgetb = panel.querySelectorAll('button[data-xget]');
      for (var xgi2 = 0; xgi2 < xgetb.length; xgi2++) {
        xgetb[xgi2].addEventListener('click', function () {
          state.xget = this.getAttribute('data-xget');
          renderInfoLists(p);
        });
      }
      var xdo = panel.querySelector('button[data-xdo]');
      if (xdo) xdo.addEventListener('click', function () {
        exchangeResource(p, state.xgive, state.xget);
        renderInfoLists(p);
      });
      /* 出口（v14）：卖到外国 —— 和 fbuy 反过来的一笔，绑法一样 */
      var exb = panel.querySelectorAll('button[data-exp]');
      for (var ej = 0; ej < exb.length; ej++) {
        exb[ej].addEventListener('click', function () {
          exportForeign(p, this.getAttribute('data-exp'), +this.getAttribute('data-ecid'));
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
      h += '<div class="l"><i>换金</i> 每座可把 ' + AO.MARKET.rate +
        ' 单位资源换成金（按本国物价指数：缺则贵、积压则贱）</div>' +
        '<div class="l"><i>进货</i> 走<b>世界市场</b>：价随本国物价走，越缺越贵；供给无限，' +
        '付出去的金沉没（<b>国库不是商店</b>）</div>' +
        '<div class="l"><i>一座</i> 每省只建一座市场 —— 要吞吐量就去修货运' +
        (st.n >= AO.MARKET.maxPer ? '　<em class="ok">已建满</em>' : '') + '</div>';
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
      var rs = p.resources || [], bag = SIM[p.id] || {};
      var cid = p.owner | 0;

      /* ---- 价格板（v14）：七种资源 现价 / 趋势 / 本国库存一句话 ----
       * 放在卖货钮**上面**是刻意的：玩家先看见"粮 1.8 ↑"，再决定卖不卖。
       * 一行读法：`粮食 1.80 ↑ · 全国 12 / 需 20（紧）`。 */
      var needAll = PNEED[cid] || needOf(cid);
      h += '<div class="pboard">';
      h += '<div class="pbhead"><span>物价</span><span>现价 · 趋势</span><span>库存 / 需求</span></div>';
      for (var pi2 = 0; pi2 < rs.length; pi2++) {
        var pk = rs[pi2].key, pv = priceV(cid, pk), ptr = priceTrend(cid, pk);
        var cst = countryStock(cid, pk), nd = needAll[pk] || 1;
        var rr = cst / nd;
        var tag = rr < AO.PRICES_CFG.ratio.scarce ? '紧缺' : rr < AO.PRICES_CFG.ratio.tight ? '偏紧'
          : rr < AO.PRICES_CFG.ratio.glut ? '充足' : '积压';
        h += '<div class="pbrow' + (pv >= AO.PRICES_CFG.tier.tight ? ' up' : pv <= AO.PRICES_CFG.tier.glut ? ' down' : '') +
          '"><span class="nm">' + cnOf(pk) + '</span>' +
          '<b>' + priceNum(pv) + ' ' + priceArrow(ptr) + '</b>' +
          '<em>' + Math.round(cst) + ' / ' + Math.round(nd) + '（' + tag + '）</em></div>';
      }
      h += '</div>';

      h += '<div class="l"><i>卖货</i> 一手 ' + AO.MARKET.rate +
        ' 单位，按本国现价换金（缺则贵、积压则贱）；小数攒整，不会白扣</div>';
      if (!st.n) h += '<div class="l gone"><i>提示</i> 先盖一座市场，才有地方卖货</div>';
      else if (st.halted) h += '<div class="l gone"><i>停产</i> 维护欠费，本回合卖不了货（建造不受影响）</div>';
      h += '<div class="sellbox">';
      for (var i = 0; i < rs.length; i++) {
        var rk = rs[i].key, ss = bag[rk];
        var have = ss ? ss.stock : 0;
        var pg = sellGold(cid, rk), ptr2 = priceTrend(cid, rk);
        var off = !st.n || st.halted || have < AO.MARKET.rate || !canAct(p.owner);
        h += '<div class="srow"><span>' + cnOf(rk) + '</span><em>' + have + '</em>' +
          '<button type="button" data-sell="' + rk + '"' + (off ? ' disabled' : '') +
          ' title="' + (!canAct(p.owner) ? lockTitle() : off ? (st.halted ? '市场停产中' : '库存不足 ' + AO.MARKET.rate) :
            '扣本省 ' + AO.MARKET.rate + ' ' + cnOf(rk) + '，+' + priceNum(pg) + ' 金（本国' +
            cnOf(rk) + '价 ' + priceNum(pg) + ' ' + priceArrow(ptr2) + '）') + '">' +
          '卖 ' + AO.MARKET.rate + ' → +' + priceNum(pg) + ' 金</button></div>';
      }
      h += '</div>';

      /* ---- 买货：省库金 → 世界市场 → 进本省库存（v18 追加三） ----
       * 和上面的卖货是**两条反向的腿**：卖是把省里的东西换成金，
       * 买是拿省库的金去世界市场进货（应急口：缺粮救荒、缺铁复工）。
       * **货不来自中央国库**：供给无限，所以这一排钮永不为"中央没货"变灰，
       * 唯一的闸是省库金够不够；付出去的金沉没（进世界市场，不落任何账）。
       * 价格 = 基准 × 本国 PI：本国缺什么，补什么就贵 —— 越缺越贵，
       * 贵到买不起才是真稀缺（这就是"无限供给"的刹车）。
       * 行首那个数字是**本国现价**（PI），不是库存：库存已经没有意义了。 */
      var lot = AO.GOV.buyLot();
      var gold = bag.gold ? bag.gold.stock : 0;
      h += '<div class="l"><i>买货</i> 省库金 <b>' + gold + '</b> · 世界市场每手 ' + lot.n +
        ' 单位，价 = 基准 ' + lot.gold + ' × 本国物价（越缺越贵 · 供给无限 · 金沉没）</div>';
      h += '<div class="sellbox buy">';
      for (var bi2 = 0; bi2 < rs.length; bi2++) {
        var bk = rs[bi2].key;
        var bprice = buyGold(cid, bk);
        var boff = !st.n || gold < bprice || !canAct(p.owner) || !!BLOCKADE[p.id];
        h += '<div class="srow"><span>' + cnOf(bk) + '</span><em>' + priceNum(priceV(cid, bk)) + '</em>' +
          '<button type="button" data-buy="' + bk + '"' + (boff ? ' disabled' : '') +
          ' title="' + (!canAct(p.owner) ? lockTitle()
            : BLOCKADE[p.id] ? '本省被舰队封锁，买不了货'
              : !st.n ? '先盖一座市场'
                : gold < bprice ? '省库金不足 ' + bprice
                  : '世界市场进货：价随本国物价走，越缺越贵（扣省库 ' + bprice + ' 金，进 ' +
                    lot.n + ' ' + cnOf(bk) + '）') + '">' +
          '买 ' + lot.n + ' ← ' + bprice + ' 金</button></div>';
      }
      h += '</div>';

      /* ---- 兑换（v18 / B2）：以物易物，七种两两可换 ----
       * 上面两条腿是"资源 ↔ 金"，这一条是"资源 ↔ 资源"：
       * 粮换铁、金换铁、鱼换盐…汇率 = 两边物价之比（再抽一成），
       * 所以"缺什么就贵什么"自动生效，不需要另立一张兑换表。
       * 选法：两排小钮（付出 / 换回），选中项高亮；下面一行写这一手的账。
       * 状态存在 state.xgive / state.xget（不进档，换局重新默认 粮→铁）。 */
      if (!state.xgive || !bag[state.xgive]) state.xgive = 'grain';
      if (!state.xget || !bag[state.xget]) state.xget = 'iron';
      if (state.xgive === state.xget) state.xget = state.xgive === 'iron' ? 'gold' : 'iron';
      var xg = state.xgive, xt = state.xget;
      var xlot = AO.MARKET.rate, xout = xchgOut(cid, xg, xt, xlot);
      var xhave = (bag[xg] && bag[xg].stock) || 0;
      var xroom = capOf(p.id, xt) - ((bag[xt] && bag[xt].stock) || 0);
      var xoff = !st.n || st.halted || xhave < xlot || xout <= 0 ||
        xout > xroom || !canAct(p.owner);
      var chips = function (which) {
        var s2 = '';
        for (var ci = 0; ci < rs.length; ci++) {
          var ck = rs[ci].key;
          var on = (which === 'give' ? xg : xt) === ck;
          s2 += '<button type="button" data-x' + which + '="' + ck + '"' + (on ? ' class="on"' : '') +
            '>' + cnOf(ck) + '</button>';
        }
        return s2;
      };
      h += '<div class="l"><i>兑换</i> 以物易物：一手 ' + xlot +
        ' 单位，按两边物价折算（市场抽 ' +
        Math.round((AO.MARKET.xchg.spread || 0) * 100) + '%）· 同种不换</div>';
      h += '<div class="xchgbox">' +
        '<div class="srow"><span>付出</span><div class="chips">' + chips('give') + '</div></div>' +
        '<div class="srow"><span>换回</span><div class="chips">' + chips('get') + '</div></div>' +
        '<div class="srow"><span>这一手</span><em>' + xlot + ' ' + cnOf(xg) + ' → ' +
        (xout > 0 ? xout + ' ' + cnOf(xt) : '换不到 1 ' + cnOf(xt)) + '</em>' +
        '<button type="button" data-xdo="1"' + (xoff ? ' disabled' : '') +
        ' title="' + escHtml(!canAct(p.owner) ? lockTitle()
          : !st.n ? '先盖一座市场' : st.halted ? '市场停产中'
            : xhave < xlot ? cnOf(xg) + ' 不够 ' + xlot
              : xout <= 0 ? '按现在物价换不到 1 单位，换个目标'
                : xout > xroom ? cnOf(xt) + ' 装不下 ' + xout + '（上限 ' + capOf(p.id, xt) + '）'
                  : '扣本省 ' + xlot + ' ' + cnOf(xg) + '，换回 ' + xout + ' ' + cnOf(xt)) + '">' +
        '兑换</button></div></div>';

      /* ---- 外国货源（v9 + v14 比价）：REL ≥ 20 的存续外国 ----
       * 三条和"中央进货"不同的规矩，都写在按钮 title 里：
       *   ① 价格 = 基准 × 溢价 × **对方 PI** —— 对方缺什么，你去买就贵；
       *   ② 钱进**对方那个省的省库**（不是它的国库）—— 你付的是那家商人的账；
       *   ③ 不走调拨，所以没有损耗；每笔关系 +0.5（累计上限 +20）。
       * 封锁省断供（和中央进货同一条闸）。
       * 货源行右侧写"比本国贱 N%" —— **跨国价差在面板上直接可见**，
       * 便宜的在前面（sort 在 foreignSources 里做）。 */
      var anyForeign = false;
      for (var fi = 0; fi < rs.length; fi++) {
        if (foreignSources(p, rs[fi].key).length) { anyForeign = true; break; }
      }
      if (anyForeign) {
        h += '<div class="l"><i>外购</i> 外国货源：关系 ≥ ' + AO.DIPLO.trade.minRel +
          ' 的国家可直接买，价 = 基准 × 溢价 ' + AO.DIPLO.trade.premium +
          ' × 对方物价；钱进对方省库（无损耗），比本国便宜的排前面</div>';
        h += '<div class="sellbox buy fbuy">';
        for (var fk = 0; fk < rs.length; fk++) {
          var fkey = rs[fk].key, srcs = foreignSources(p, fkey);
          if (!srcs.length) continue;
          var s0 = srcs[0];
          var foff = !st.n || st.halted || gold < s0.price || !canAct(p.owner) || !!BLOCKADE[p.id];
          var gapTxt = s0.gap > 0.005 ? '比本国贱 ' + Math.round(s0.gap * 100) + '%'
            : s0.gap < -0.005 ? '比本国贵 ' + Math.round(-s0.gap * 100) + '%' : '与本国同价';
          h += '<div class="srow"><span>' + cnOf(fkey) + '<i>' + escHtml(s0.name) + ' · ' +
            priceNum(s0.pi) + ' ' + priceArrow(priceTrend(s0.cid, fkey)) + '</i></span>' +
            '<em class="gap' + (s0.gap > 0.005 ? ' good' : '') + '">' + gapTxt + '</em>' +
            '<button type="button" data-fbuy="' + fkey + '" data-fcid="' + s0.cid + '"' +
            (foff ? ' disabled' : '') + ' title="' + escHtml(
              !canAct(p.owner) ? lockTitle()
                : BLOCKADE[p.id] ? '本省被舰队封锁，买不了货'
                  : !st.n ? '先盖一座市场' : st.halted ? '市场停产中'
                    : gold < s0.price ? '省库金不足 ' + s0.price
                      : '从 ' + s0.name + '·' + s0.prov + ' 买 ' + s0.n + ' ' + cnOf(fkey) +
                        '，付 ' + s0.price + ' 金（对方价 ' + priceNum(s0.pi) + '，本国价 ' +
                        priceNum(s0.myPi) + '，关系 ' + s0.rel + '）') + '">' +
            '买 ' + s0.n + ' ← ' + s0.price + ' 金</button></div>';
        }
        h += '</div>';
      }

      /* ---- 出口（v14）：把本国贱、对方贵的东西卖出去 ----
       * 这是"倒卖闭环"的另一半：上面那一节是缺了去买，这一节是多了去卖。
       * 只列价差 ≥ minSpread 的国家 —— 价差太薄的列出来是白让玩家点。
       * 每省每回合 1 笔（EXP1），已在货源行下面写清。 */
      var anyExp = false, expH = '';
      for (var xk = 0; xk < rs.length; xk++) {
        var xkey = rs[xk].key, exs = exportSources(p, xkey);
        if (!exs.length) continue;
        var x0 = exs[0], xhave = stockOf(p.id, xkey);
        var xoff = !st.n || st.halted || xhave < AO.PRICES_CFG.exportLot ||
          !canAct(p.owner) || !!BLOCKADE[p.id] || (EXP1[p.id] | 0) === turnNo;
        anyExp = true;
        expH += '<div class="srow"><span>' + cnOf(xkey) + '<i>' + escHtml(x0.name) +
          ' · ' + priceNum(x0.pi) + ' ' + priceArrow(priceTrend(x0.cid, xkey)) + '</i></span>' +
          '<em class="gap good">价差 +' + priceNum(x0.spread) + '</em>' +
          '<button type="button" data-exp="' + xkey + '" data-ecid="' + x0.cid + '"' +
          (xoff ? ' disabled' : '') + ' title="' + escHtml(
            !canAct(p.owner) ? lockTitle()
              : BLOCKADE[p.id] ? '本省被舰队封锁，出不了货'
                : !st.n ? '先盖一座市场' : st.halted ? '市场停产中'
                  : (EXP1[p.id] | 0) === turnNo ? '本省这回合已经出过一笔了'
                    : xhave < AO.PRICES_CFG.exportLot ? '本省库存不足 ' + AO.PRICES_CFG.exportLot
                      : '卖 ' + x0.n + ' ' + cnOf(xkey) + ' 给 ' + x0.name + '，到手 ' +
                        priceNum(x0.gain) + ' 金（对方价 ' + priceNum(x0.pi) + ' × ' +
                        AO.PRICES_CFG.exportCut + '；本国价 ' + priceNum(x0.myPi) + '）') + '">' +
          '出口 ' + x0.n + ' → +' + priceNum(x0.gain) + ' 金</button></div>';
      }
      if (anyExp) {
        h += '<div class="l"><i>出口</i> 卖给外国（关系 ≥ ' + AO.DIPLO.trade.minRel +
          '、对方价高于本国）：到手 = 对方价 × ' + AO.PRICES_CFG.exportCut +
          '（那两成是运费与中间商）· 货进对方库存，对方价随后回落 · 每省每回合 ' +
          AO.PRICES_CFG.exportPerTurn + ' 笔</div>';
        h += '<div class="sellbox exp">' + expH + '</div>';
      }
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
      qrow.textContent = '征兵中 · 剩 ' + q.left + ' 回合成军（成军后去武库发装备）';
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
      (st.halted ? '\n维护欠费，停产中' : '');
    if (!mine) row.title += '\n（非你的国家：只能看）';
    /* 产能中心（v17）：这一坊每回合几点、怎么用掉的、有没有匠人 —— 行 title 上就要能读到 */
    if (MILL_KINDS.indexOf(kind) >= 0) {
      var MG = AO.MILL, pool = MG.poolOf[kind];
      var art = artisanOf(p.id);
      row.title += '\n本省产能贡献 ' + millCap(p.id, kind) + ' 点/回合 → ' +
        MG.poolCn[pool] + '池（全国合计 ' + poolCap(p.owner, pool) + ' 点）';
      row.title += '\n产线怎么分：顶栏「产能」（全国一张表，20 条线）';
      if (art) row.title += '\n匠人：' + art.name + '（' + artisanLv(art).cn + '，产能 +' +
        Math.round(artisanLv(art).bonus * 100) + '%，品质看全国最高那位）';
      else row.title += '\n匠人：空缺 —— 产能加成 0、品质按学徒档（匠人是加成者，不是钥匙）';
    }
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
    /* 产能中心的当前摆法直接写在行上（不用点开 ? 才知道在产什么）：
     * 兵刃线优先显示"在产哪种"，其余写"已分配 2/2 点"。 */
    if (MILL_KINDS.indexOf(kind) >= 0) {
      var capN = millCap(p.id, kind);
      var od = doc.createElement('span');
      od.className = 'old';
      od.textContent = '产能 +' + capN;
      od.title = '本省给' + AO.MILL.poolCn[AO.MILL.poolOf[kind]] + '池贡献 ' + capN + ' 点/回合';
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
    /* v19：省卡上不再有产线 ±（分配表搬到顶栏「产能」的全国表） */
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
      /* v19：招的全是步兵 —— 扣金 + 人口，不扣装备；兵种靠武库发装备 */
      var info0 = recruitInfo(p.id, 'inf');
      var need0 = info0.need || { gold: AO.RECRUIT.goldPerUnit, pop: AO.RECRUIT.popPerUnit };
      h += '<div class="l"><i>征兵</i> 一回合一支步兵 ' + AO.RECRUIT.menPerUnit + ' 人：人口 ' +
        AO.RECRUIT.popPerUnit + ' · 金 ' + AO.RECRUIT.goldPerUnit +
        '　<b>不扣装备</b>（兵种是武库发出来的）</div>';
      h += '<div class="sellbox">';
      h += '<div class="srow"><span>步兵（裸兵）</span><em class="halted">赤手空拳 · 战力 0.5</em>' +
        '<button type="button" data-rec="inf"' + (info0.ok && mine ? '' : ' disabled') +
        ' title="' + escHtml(!mine ? lockTitle() : info0.ok
          ? ('征一支步兵：金 ' + need0.gold + ' · 人口 ' + need0.pop +
            '。成军后去顶栏「武库」发兵刃/马/炮 —— 有炮=炮兵、有马=骑兵')
          : info0.why) + '">征 ' + AO.RECRUIT.menPerUnit + ' 人</button></div>';
      h += '</div>';
      h += '<div class="l"><i>说明</i> 裸兵能守不能攻（pow 0.5）；AI 也不拿裸兵进攻</div>';
      if (st.n && !mine) h += '<div class="l gone"><i>锁</i> 非你的国家：只能看，不能征</div>';
    } else if (kind === 'stable') {
      h += '<div class="l"><i>产能</i> 每座每回合 ' + (D.per || 1) + ' 点 → <b>马厩池</b>' +
        '（四个品种共用这一池）</div>' +
        '<div class="l"><i>本省</i> 贡献 <b>' + millCap(p.id, 'stable') + '</b> 点 / 回合' +
        '（全国马厩池 ' + poolCap(p.owner, 'stable') + ' 点）</div>' +
        '<div class="l"><i>产出</i> 马是**队份**（×1000 匹）：发一份给部队 = 骑兵</div>';
    } else if (kind === 'factory') {
      /* 工厂：不产东西，只放大本省的产能 */
      var fm = (st.n > 0 && !st.halted) ? (D.prodMul || 2) : 1;
      h += '<div class="l"><i>效果</i> 本省军械坊 / 造船厂 的 <b>产能点数 ×' +
        (D.prodMul || 2) + '</b>（驯马场产出也 ×' + (D.prodMul || 2) + '；料不变 —— 工业化解放产能，不解放原料）</div>' +
        '<div class="l"><i>本省</i> ' + (st.n ? (st.halted ? '工厂停产中 → 产能 ×1' : '产能 ×' + fm)
          : '还没有工厂 → 产能 ×1') + '</div>' +
        '<div class="l"><i>范围</i> 只放大 <b>本省</b> 的厂；科技只解锁产线，不提高每点产出</div>';
    } else {
      /* 三个产能中心：产线分配卡（每线一行：名 / 吃点 / 产出预览 / ±） */
      h += millCardHtml(p, kind, mine);
      /* v19：成品不进省库了，进**全国武库**（队份）。这里只报武库里有多少。 */
      var wN = arsTotal(p.owner, 'wpn'), mN = arsTotal(p.owner, 'mount');
      var gN = arsTotal(p.owner, 'gun'), sN = arsTotal(p.owner, 'ship');
      h += '<div class="l"><i>武库</i> 兵刃 ' + wN + ' 队份 · 马 ' + mN + ' 队份 · 炮 ' + gN +
        ' 门 · 舰 ' + sN + ' 艘（顶栏「武库」看明细）</div>';
    }
    return h;
  }

  /* 本省产能贡献（v19）—— 分配表搬到全国「产能」面板了，这里只报一件事：
   * 这一省给三个池各贡献几点。为什么省卡上不再放 ±：
   * 全国口径下"给刀 +1 点"不是一个省的决定，逐省调会让同一个问题回答 20 遍。 */
  function millCardHtml(p, kind, mine) {
    var M = AO.MILL, pool = M.poolOf[kind];
    var raw = provCapRaw(p.id, kind), cap = Math.floor(raw);
    var art = artisanOf(p.id), artLv = art ? artisanLv(art) : null;
    var D = AO.FACTORY[kind];
    var src = [];
    src.push(UNIV[kind][p.id].n + ' 座 × ' + (M.base[kind] || 1) + ' 点');
    if (kind === 'armory' && hasTech(p.owner, 'mil_std')) src.push('制式装备 +' + M.stdBonus.armory + '/座');
    var fm = armProdMul(p.id);
    if (fm > 1) src.push('工厂 ×' + fm);
    if (art) src.push('匠人 ' + artLv.cn + ' +' + Math.round(artLv.bonus * 100) + '%');
    var h = '<div class="l"><i>本省产能</i> <b>' + cap + '</b> 点/回合 → <b>' +
      M.poolCn[pool] + '池</b>' + (raw > cap ? '（零头 ' + (raw - cap).toFixed(1) + '，攒着）' : '') +
      '<br><span class="millsrc">' + src.join(' · ') + '</span></div>' +
      '<div class="l"><i>全国</i> ' + M.poolCn[pool] + '池合计 <b>' + poolCap(p.owner, pool) +
      '</b> 点（' + M.lines[pool].length + ' 条线共用这一池）</div>' +
      '<div class="l"><i>在哪调</i> 顶栏「产能」：全国一张表，20 条线三段分组</div>' +
      '<div class="l"><i>要人</i> 匠人是**加成者**不是钥匙：驻在本省 → 产能 +' +
      '0/10/20/40%；品质 roll 看全国最高的那一位</div>';
    if (!(UNIV[kind][p.id].n > 0)) {
      h += '<div class="l gone"><i>没建</i> 这一省还没有' + escHtml(D.cn) + '</div>';
    } else if (UNIV[kind][p.id].halted) {
      h += '<div class="l gone"><i>停产</i> 维护欠费 → 本省产能 0（修好或减座数就恢复）</div>';
    }
    return h;
  }

  function recipeText(recipe) {
    var a = [], k;
    for (k in recipe) a.push((AO.RES_SHORT[k] || k) + recipe[k]);
    return a.join('+') || '无';
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
    /* 安定 / 整合 / 安抚（A、B 两批）：和民心一样是"每回合都会变的数"，
     * 所以挂在这里而不是 showInfo 那一处 —— 结算之后省卡开着也照样刷。 */
    renderUnrestRows(p);
    renderResList(p);
    renderUniversalList(p);
    renderBldList(p);
    renderFreightList(p);
    renderMilList(p);          // 军备（兵营/军械坊/驯马场/铸炮厂/造船厂 + 本省驻军）
    renderFlow(p);
    /* 四个建筑组收尾：摘要 / 红点 / 该自动展开的展开（纯读刚画出来的 DOM） */
    renderGroups();
    updateDetSum();
    /* 顶栏「维修」的红点跟着刷新（这个省的失修数刚变过）；
     * 面板开着也一起重画 —— 否则点「修」之后清单里那一行还赖着不走。 */
    if (typeof refreshRepBadge === 'function') refreshRepBadge();
    if (REPU && REPU.open) renderRepPanel();
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

  /* ---------------- 省卡「安定 / 整合 / 安抚」三行（A、B 两批） ----------------
   * 安定行永远显示（这一省稳不稳是基本信息）；整合行只有占领省才有；
   * 安抚钮只在"未整合 或 不安 ≥ 40"时出现 —— 其余省份给它整行隐藏，
   * 免得每张卡上都挂着一个永远按不动的钮。
   *
   * 迷雾遮蔽（seen / unknown）时三行一起收：不安与整合都是**真实数据**，
   * 不该从一份旧情报里漏出来（和城防、驻军数同一条纪律）。 */
  function renderUnrestRows(p) {
    var U = AO.UNREST, I = AO.INTEG;
    var rowU = $('kvUnrest'), elU = $('iUnrest');
    if (!rowU || !elU || !p) return;
    var u = unrestOf(p.id), v = Math.round(u.v);
    rowU.style.display = '';
    elU.className = v >= U.warnAt ? 'bad' : (v >= U.riotLine ? 'warn' : '');
    elU.innerHTML = '<b>' + v + '</b>' +
      '<span class="ubar"><i style="width:' + Math.round(AO.clamp(v, 0, 100)) + '%"></i></span>';
    elU.title = unrestTitle(p.id);

    /* 整合：只有占领省才有（OCCUPY + INTEG） */
    var rowI = $('kvInteg'), elI = $('iInteg');
    if (rowI && elI) {
      var it = integOf(p.id);
      if (!OCCUPY[p.id] || !it) {
        rowI.style.display = 'none';
        elI.innerHTML = '';
        elI.title = '';
      } else {
        rowI.style.display = '';
        elI.innerHTML = '<b>' + Math.round(it.v) + '</b>' +
          '<span class="ubar"><i style="width:' + Math.round(AO.clamp(it.v, 0, 100)) + '%"></i></span>';
        elI.title = integTitle(p.id);
      }
    }

    /* 安抚钮 */
    var rowP = $('kvPacify'), boxP = $('iPacifyBox');
    if (rowP && boxP) {
      var info = pacifyInfo(p.id);
      if (!info.show) {
        rowP.style.display = 'none';
        boxP.innerHTML = '';
      } else {
        rowP.style.display = '';
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.id = 'iPacify';
        btn.textContent = '安抚';
        btn.disabled = !info.ok;
        btn.title = (info.ok ? '花 ' + I.pacify.cost + ' 金（省库 → 中央 → 同国各省）\n' : info.why + '\n') +
          (info.occ
            ? '未整合省：整合 +' + I.pacify.integ + '、不安 −' + I.pacify.unrest
            : '不安 ≥' + I.pacify.at + ' 的省：不安 −' + I.pacify.unrestOnly) +
          '\n冷却 ' + I.pacify.cd + ' 回合（金能买人心，但买不了连年）';
        btn.addEventListener('click', function () {
          var r = pacify(p.id, false);
          toast(r.msg, r.ok ? 2600 : 2400);
          if (r.ok) { renderUnrestRows(p); if (state.renderer) state.renderer.requestDraw(); }
        });
        boxP.innerHTML = '';
        boxP.appendChild(btn);
        var cost = doc.createElement('span');
        cost.className = 'pcost';
        cost.textContent = I.pacify.cost + ' 金';
        boxP.appendChild(cost);
      }
    }
  }
  function hideUnrestRows() {
    var ids = ['kvUnrest', 'kvInteg', 'kvPacify'];
    for (var i = 0; i < ids.length; i++) {
      var r = $(ids[i]);
      if (r) r.style.display = 'none';
    }
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
    if (F.d.ironTax) parts.push('铁税 +' + F.d.ironTax + ' 铁（民间铁器熔缴，进省库）');
    /* 熔旧坊两笔：产铁进省库、耗金出省库（中央垫的那份另记一格） */
    if (F.d.smelt) parts.push('熔旧坊 +' + F.d.smelt + ' 铁');
    if (F.d.smeltGold) parts.push('熔旧坊耗金 −' + F.d.smeltGold + ' 金' +
      (F.d.smeltC ? '（其中中央垫 ' + F.d.smeltC + '）' : ''));
    /* 淘金场（v18）：产金进省库、耗省库木材 */
    if (F.d.wash) parts.push('淘金场 +' + F.d.wash + ' 金');
    if (F.d.washWood) parts.push('淘金场耗木 −' + F.d.washWood + ' 木');
    /* 省库上解（v18 / D）：省库 → 中央。单列一行 —— 不然玩家只会看到
     * "省库金少了 17"，找不到是谁搬走的。 */
    if (F.d.remit) parts.push('上解 −' + F.d.remit + ' 金（省库 → 中央）');
    /* 买铁续命（v18.4）：金出省库、铁进省库。它是"花金买铁"，
     * 和上解方向相反，所以单独一行 —— 两笔都记在省库账上，混起来会看不懂。 */
    if (F.d.buyIron) parts.push('买铁 −' + F.d.buyIron + ' 金（世界市场 · 维护缺铁' +
      (F.d.buyIronC ? '，其中中央垫 ' + F.d.buyIronC : '') + '）');
    if (F.d.buyIronN) parts.push('买铁 +' + F.d.buyIronN + ' 铁（世界市场进货）');
    /* 兑换（v18 / B2）：以物易物，一进一出。d.xchg 里正数是"付出"、负数是"换回" */
    if (F.d.xchg) {
      var xs = [];
      for (k in F.d.xchg) {
        if (!F.d.xchg[k]) continue;
        xs.push((F.d.xchg[k] > 0 ? '−' : '＋') + Math.abs(F.d.xchg[k]) + ' ' + (AO.RES_SHORT[k] || k));
      }
      if (xs.length) parts.push('兑换 ' + xs.join(' · '));
    }
    if (F.d.salary) parts.push('官员俸禄 −' + F.d.salary + ' 金');
    /* 怨气 ≥90 的官会从省库伸手（v11）：这笔真的流出去了，所以单列一行 ——
     * 不然玩家只会看到"省库金莫名其妙少 1"，找不到原因。 */
    if (F.d.steal) parts.push('官员侵吞 −' + F.d.steal + ' 金（怨气 ≥' + AO.GOV.griev.steal + '）');
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
    if (!el) return;
    /* 王国历：一回合一个月、一年 12 回合。玩家关心的是"过了几年"，
     * 不是"第几回合" —— 回合数挪进 title，那是调数值和看 bench 时才要的坐标。
     * 必须带「月」：只写年的话，点十二次按钮那个字都不动，像卡住。 */
    el.textContent = AO.calLabel(turnNo);
    el.title = '第 ' + turnNo + ' 回合 · ' + AO.calLabel(turnNo) +
      '\n每一回合 = 一个月、一年 12 回合';
  }

  function nextTurn() {
    /* 事件弹窗开着 = 这一回合的账还没处置完，不许往下走（回合制不抢戏）。
     * 六个入口（右上角 / 科技树 / 治理 / 纪要 / 维修 / 编年史）和空格键都汇到这里，
     * 所以只守这一处 —— 每块常驻面板都自带一颗钮，谁也别想绕过去。 */
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
    /* 维修面板开着就跟着刷（失修清单/拨款额度每回合都变），徽标也重算一次 */
    if (typeof refreshRepBadge === 'function') refreshRepBadge();
    if (REPU && REPU.open) renderRepPanel();
    /* 平衡分析（20-balance.js）：**必须排在 settleTurn 之后** ——
     * 它读的是这一回合刚记完的两本流水；排前面采到的会是上一回合的账。 */
    if (AO.balStep) AO.balStep();
    flushNotes();
    /* 纪要卡开着就跟着刷（这一回合新攒的提示 / 邸报都在里面） */
    var np = $('notesPanel');
    if (np && np.classList.contains('on')) renderNotes();
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

  /* =============================================================
   * 界面收敛（v16）：把"偶尔要看"的东西收进抽屉
   * -------------------------------------------------------------
   * 三条纪律（都是"为什么"，不是"是什么"）：
   *
   *   ① **只搬容器**。所有 id 一个不删不改名，renderXXX 照旧往原 id 写 ——
   *      收纳是版面的手术，不是数据的手术。任何一处 render 都不必知道抽屉存在。
   *   ② **状态记在 localStorage**，四个键集中列在 LS 里，读写一律 try/catch：
   *      file:// 下有些浏览器直接抛（隐私模式），读失败就当没记过。
   *   ③ **警告优先于整洁**。迷雾快照、迷雾黄条这类"情报有出入"的提示
   *      永远在最上面，任何折叠都吞不掉它们（CSS 里另有 !important 兜底）。
   * ============================================================= */
  var LS = {
    detail: 'sj.cardDetail',        // 省卡「测绘详情」是否展开
    grp: 'sj.grp.',                 // + 组名：bld / gen / mil / frt
    countryTab: 'sj.countryTab',    // 国家卡页签：ov / gov / dip
    notesTab: 'sj.notesTab'         // 纪要过滤：all / mine / world
  };
  function lsGet(k, dft) {
    try {
      var v = window.localStorage.getItem(k);
      return v === null ? dft : v;
    } catch (e) { return dft; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* 记不住就算了，不影响这一局 */ }
  }

  /* ---------------- ① 省卡：概要 / 测绘详情 ---------------- */
  function detailOn() { return lsGet(LS.detail, '0') === '1'; }
  function applyDetail() {
    var info = $('info');
    if (info) info.classList.toggle('det-open', detailOn());
    var car = $('detBar') ? $('detBar').querySelector('.dcar') : null;
    if (car) car.textContent = detailOn() ? '▾' : '▸';
  }
  function toggleDetail() {
    lsSet(LS.detail, detailOn() ? '0' : '1');
    applyDetail();
  }
  /* 折叠时也给一句"里面有什么"：地形 + 邻接数够回答"值得展开吗" */
  function updateDetSum() {
    var el = $('detSum');
    if (!el) return;
    var t = $('iTerrain') ? $('iTerrain').textContent : '';
    var d = $('iDeg') ? $('iDeg').textContent : '';
    el.textContent = t ? ('· ' + t + (d ? ' · 邻接 ' + d : '')) : '';
  }

  /* ---------------- ② 建筑：四组各自折叠 ----------------
   * 默认 建筑（资源）+ 通用 展开 —— 这两组每回合都可能动；
   * 军备 + 货运 收起 —— 它们在，但不是每次都要看。
   * 组头红点 / 自动展开只认四件事：在建、维护欠费、可改建（熔旧坊）、能征兵。
   * 「能征兵」只对军备组生效：别的组里的 .upg 是「升 Lv2」，不是征。 */
  var GRP_KEYS = ['gen', 'bld', 'mil', 'frt'];
  var GRP_DEF = { gen: 1, bld: 1, mil: 0, frt: 0 };
  var GRP_DOM = { gen: 'iSchoolList', bld: 'iBldList', mil: 'iMilList', frt: 'iFreightList' };
  var GRP_SUM = { gen: 'gsumGen', bld: 'gsumBld', mil: 'gsumMil', frt: 'gsumFrt' };
  /* 上一次报警时这一组的"形态"。同形态不再弹开 —— 否则每回合重画都会把
   * 玩家刚收起的那一组顶回来（"同事件不反复弹开"）。 */
  var GRPSIG = { gen: '', bld: '', mil: '', frt: '' };

  function grpOpen(k) {
    var v = lsGet(LS.grp + k, null);
    return v === null ? !!GRP_DEF[k] : v === '1';
  }
  function grpHead(k) {
    return document.querySelector('#info .gsec[data-grp="' + k + '"]');
  }
  function applyGroups() {
    for (var i = 0; i < GRP_KEYS.length; i++) {
      var k = GRP_KEYS[i], on = grpOpen(k);
      var sec = grpHead(k), box = $(GRP_DOM[k]);
      var car = sec ? sec.querySelector('.gcar') : null;
      if (sec) sec.classList.toggle('grp-open', on);
      if (car) car.textContent = on ? '▾' : '▸';
      if (box) box.classList.toggle('off', !on);
    }
  }
  /* 读刚画出来的 DOM 数"要在意的"。纯读界面：不碰结算，也不缓存任何世界状态。
   * 世界被换掉（重新生成 / 读档）时 DOM 自然变了，这里也就自然跟着变。 */
  function grpProbe(k) {
    var box = $(GRP_DOM[k]);
    if (!box) return null;
    var site = box.querySelectorAll('.site, .site-row').length;
    var halt = box.querySelectorAll('.dot.halt').length;
    var smelt = 0, rec = 0, i, arr;
    arr = box.querySelectorAll('button.add.smelt');
    for (i = 0; i < arr.length; i++) if (!arr[i].disabled) smelt++;
    if (k === 'mil') {
      arr = box.querySelectorAll('button.upg');
      for (i = 0; i < arr.length; i++) if (!arr[i].disabled) rec++;
    }
    return {
      n: box.querySelectorAll('.rr.bld, .rr.army').length,
      site: site, halt: halt, smelt: smelt, rec: rec,
      hot: (site + halt + smelt + rec) > 0,
      sig: site + '|' + halt + '|' + smelt + '|' + rec
    };
  }
  /* 每次重画建筑栏之后调一次：算摘要、点红点、该弹开的弹开 */
  function renderGroups() {
    for (var i = 0; i < GRP_KEYS.length; i++) {
      var k = GRP_KEYS[i], pr = grpProbe(k);
      if (!pr) continue;
      var sec = grpHead(k), sum = $(GRP_SUM[k]);
      var bits = [pr.n + ' 行'];
      if (pr.site) bits.push(pr.site + ' 在建');
      if (pr.halt) bits.push(pr.halt + ' 欠费');
      if (sum) sum.textContent = ' · ' + bits.join(' · ');
      if (sec) sec.classList.toggle('grp-new', pr.hot);
      if (pr.hot && pr.sig !== GRPSIG[k]) {
        lsSet(LS.grp + k, '1');     // 新事 → 本回合替你展开（玩家随后可以再收起）
        GRPSIG[k] = pr.sig;
      } else if (!pr.hot) {
        GRPSIG[k] = '';             // 事情过去了 → 下次再来算新事
      }
    }
    applyGroups();
  }

  /* ---------------- ③ 国家卡：概览 / 内政 / 外交 ---------------- */
  function countryTab() {
    var t = lsGet(LS.countryTab, 'ov');
    return (t === 'gov' || t === 'dip') ? t : 'ov';
  }
  function applyCountryTab() {
    var box = $('country');
    if (!box) return;
    var t = countryTab();
    box.classList.toggle('ctab-ov', t === 'ov');
    box.classList.toggle('ctab-gov', t === 'gov');
    box.classList.toggle('ctab-dip', t === 'dip');
    var tabs = $('cTabs') ? $('cTabs').querySelectorAll('.itab') : [];
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-ctab') === t);
    }
  }

  /* ---------------- ④ 顶栏：☰ 菜单 ---------------- */
  function openMenu(on) {
    var pop = $('menuPop'), btn = $('menuBtn');
    if (!pop) return;
    if (on === undefined) on = !pop.classList.contains('on');
    pop.classList.toggle('on', !!on);
    if (btn) {
      btn.classList.toggle('on', !!on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  }

  /* ---------------- ⑤ 纪要：三档过滤 ----------------
   * 过滤只影响**显示循环**：不清数据、不改 NOTES，也不动提示条那一行的选法。
   * 世界新闻靠 src（flushWorldNews / deliverNews 推的带 'world'）；
   * 老档 / 老调用点没有 src，一律按 'mine' 读 —— 结构向后兼容。
   * 另加一条兜底：🌍 开头的都算世界新闻（v15 起邸报就带这个前缀）。 */
  function notesFilter() {
    var f = lsGet(LS.notesTab, 'all');
    return (f === 'mine' || f === 'world') ? f : 'all';
  }
  function noteIsWorld(n) {
    return !!(n && (n.src === 'world' || /^🌍/.test(n.text || '')));
  }
  function renderNotes() {
    var box = $('npList');
    if (!box) return;
    var f = notesFilter(), list = [], i, n, world = 0;
    for (i = 0; i < NOTES.length; i++) {
      n = NOTES[i];
      if (!n || !n.text) continue;
      var w = noteIsWorld(n);
      if (w) world++;
      if (f === 'world' && !w) continue;
      if (f === 'mine' && w) continue;
      list.push(n);
    }
    var cnt = $('npN');
    if (cnt) cnt.textContent = list.length + ' / ' + NOTES.length + ' 条 · 世界 ' + world;
    var tabs = $('npTabs') ? $('npTabs').querySelectorAll('button[data-nf]') : [];
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-nf') === f);
    }
    if (!list.length) {
      box.innerHTML = '<div class="nempty">' + (NOTES.length ? '这一档没有记录' : '这一回合还没有纪事') + '</div>';
      return;
    }
    var h = '';
    /* 新的在上：NOTES 是"越攒越后"，读邸报却是"先看最新的" */
    for (i = list.length - 1; i >= 0; i--) {
      n = list[i];
      var cls = 'nrow';
      if (n.rumour) cls += ' rumour';
      else if (n.late) cls += ' late';
      else if (n.cls) cls += ' ' + n.cls;
      h += '<div class="' + cls + '">' + escHtml(n.text) + '</div>';
    }
    box.innerHTML = h;
  }
  function openNotes(on) {
    var box = $('notesPanel');
    if (!box) return;
    if (on === undefined) on = !box.classList.contains('on');
    box.classList.toggle('on', !!on);
    if (on) { narrowSingleSurface('notes'); renderNotes(); }
  }

  /* 承载力的悬停明细：地形 + 逐项建筑（只列真的有的）+ 科技倍率。
   * 只列非零项 —— 七项全列（"农场 Lv2×0 +0"之类）会把明细撑成一堵墙，
   * 玩家要回答的是"我这 40 万是怎么来的"，不是看一张空表。 */
  function capTitle(p, pc) {
    if (!pc) return '';
    var P = AO.POPCAP, t = [];
    t.push('地形「' + ((AO.TERRAIN_CN || {})[p.terrain] || p.terrain) + '」' + pc.base +
      (pc.capMul !== 1 ? ' ×' + pc.capMul + '（首都）' : ''));
    if (pc.farm1) t.push('农场 Lv1×' + pc.farm1 + ' +' + pc.farm1 * P.add.farm1);
    if (pc.farm2) t.push('农场 Lv2×' + pc.farm2 + ' +' + pc.farm2 * P.add.farm2);
    if (pc.fishN) t.push('渔港×' + pc.fishN + ' +' + pc.fish);
    if (pc.granaryN) t.push('粮仓×' + pc.granaryN + ' +' + pc.granary);
    if (pc.horseN) t.push('牧场×' + pc.horseN + ' +' + pc.horse);
    if (pc.plowMul !== 1) t.push('铁犁深耕 ×' + pc.plowMul);
    if (pc.areaMul && pc.areaMul !== 1) t.push('面积 ×' + pc.areaMul.toFixed(2));
    return t.join(' ＋ ');
  }

  /* 人口行：数值 / 上限 + 涨跌箭头；悬停给密度、承载力明细、口粮、上回合涨跌 */
  function renderPop(p) {
    var el = $('iPop');
    if (!el) return;
    var s = POP[p.id] || { v: p.population || 0, rate: 0, need: 0 };
    var ppl = Math.round(s.v);
    /* 承载力：现算（不进 POP 表），悬停要拆明细所以取 parts 而不是 capOf */
    var pc = AO.POPCAP ? AO.POPCAP.parts(p.terrain, popCapCtx(p.id)) : null;
    var capv = pc ? Math.round(pc.cap) : 0;
    var load = capv > 0 ? ppl / capv : 0;
    var over = capv > 0 && ppl > capv;
    var atCap = capv > 0 && ppl >= capv;
    var arrow = s.rate > 0 ? '<i class="up">↑</i>' : s.rate < 0 ? '<i class="down">↓</i>' : '';
    /* 摸顶写「人丁兴旺」（绿）、超限写「人满为患」（红）——
     * 两句话都是**状态**，不是箭头：到顶以后箭头永远该是"不动"，
     * 玩家却更想知道"为什么不涨了"，所以用一枚小签把原因说出来。 */
    el.innerHTML = AO.formatPop(ppl) +
      (capv > 0 ? ' <em class="pcap">/ ' + AO.formatPop(capv) + '</em>' : '') +
      (atCap ? '<span class="pcapt ' + (over ? 'over' : 'full') + '">' +
        (over ? '人满为患' : '人丁兴旺') + '</span>' : arrow);
    var w = state.world;
    var cty = w ? w.countries[p.owner - 1] : null;
    var km2 = cty && cty.kmPerPx ? p.area * cty.kmPerPx : 0;
    var rateTxt = s.rate > 0 ? '+' + (s.rate * 100).toFixed(1) + '%/回合'
      : s.rate < 0
        ? (over ? '−' + Math.round(AO.POPCAP.overRate * 100) + '%/回合（人满为患，人往外走）'
                : '−1.5%/回合（闹饥荒）')
        : (atCap ? '人丁兴旺（已到上限，不再涨）' : '人口稳定');
    el.title = ppl.toLocaleString() + ' 人' +
      (km2 ? '　密度 ' + Math.round(ppl / km2) + ' 人/km²' : '') +
      (pc ? '\n承载力 ' + AO.formatPop(capv) + '（负载 ' + Math.round(load * 100) + '%）＝ ' +
        capTitle(p, pc) + '（单位：万）' : '') +
      '\n口粮 ' + (s.need || 0) + ' 单位/回合（每 200 万人 1 单位，先粮食、再渔获）' +
      '\n本回合产出 ' + Math.round(s.prod || 0) + ' 单位 → 富余 ' +
      Math.round((s.prod || 0) - (s.need || 0)) + ' → ' + rateTxt +
      (s.happyMul && s.happyMul !== 1
        ? '\n民心修正：×' + s.happyMul + '（民心 ' +
          Math.round((HAPPY[p.id] ? HAPPY[p.id].v : AO.GOV.happyStart)) +
          (s.happyMul < 1 ? ' ≤ ' + AO.GOV.happyLow + '，增速打折' : ' ≥ ' + AO.GOV.happyHigh + '，增速加成') + '）'
        : '') +
      (atCap
        ? '\n地养满了：想再多人，只能先扩承载力 —— 农场（+10/座，Lv2 +20）、渔港 +8、粮仓 +6、牧场 +4，' +
          '或者研「铁犁深耕」（全境 ×' + AO.POPCAP.plowMul + '）。'
        : '\n想让人口涨快些，就多盖农场 / 渔港。');
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

  /* 官员的完整说明（省卡与治理面板共用一份）。
   * v11 起它得回答三个新问题：这人干了多久（ten）、升到哪一级（rank）、
   * 怨不怨（griev）—— 以及最重要的：这些加起来把词条效果打了多少折（offMul）。
   * 面板上显示的倍率就是结算真正乘的那个数，两边同一个函数，不会各说各话。 */
  function offTitle(off, provName) {
    var G = AO.GOV, tr = AO.traitOf(off.traitKey), m = offMul(off), fx = offFx(off);
    offNorm(off);
    var L = [], bits = [], k;
    L.push(tr.cn + '：' + tr.desc);
    if (fx.taxMul && Math.abs(fx.taxMul - 1) > 1e-6) bits.push('税 ×' + fx.taxMul.toFixed(2));
    if (fx.happyAdd) bits.push('幸福 ' + (fx.happyAdd > 0 ? '+' : '') + fx.happyAdd.toFixed(1));
    if (fx.turnCut) bits.push('工期 −' + fx.turnCut);
    if (fx.prodMul) for (k in fx.prodMul) bits.push((AO.RES_SHORT[k] || k) + ' ×' + fx.prodMul[k].toFixed(2));
    L.push((bits.length ? '实效果：' + bits.join(' · ') : '实效果：无词条加成') +
      '（倍率 ×' + m.toFixed(2) + '）');
    L.push('倍率 = 资历 ×' + (1 + off.rank * G.rankFx).toFixed(2) +
      '（rank ' + off.rank + '）· 怨气 ×' + (1 - off.griev * G.grievFx).toFixed(2) +
      '（' + Math.round(off.griev) + '/100）');
    L.push('资历 ' + off.rank + '「' + G.rankCn[off.rank] + '」· 在任 ' + off.ten + ' 回合');
    L.push('俸禄 ' + (G.salary * (G.rankPay[off.rank] || 1)).toFixed(2) + ' 金/回合（省库发）' +
      (off.owed ? '　欠俸 ' + off.owed + ' 金（下回合补，不罚）' : ''));
    if (off.griev >= G.griev.steal) {
      L.push('⚠ 怨气 ≥' + G.griev.steal + '：每回合从省库侵吞 1 金');
    } else if (off.griev >= G.griev.warn) {
      L.push('⚠ 怨望：怨气 ≥' + G.griev.warn + '，再涨会被撤换 —— 赏赐可降 ' +
        G.griev.rewardCut + '（' + G.griev.reward + ' 金，中央出）');
    }
    L.push('怨气 +1/' + G.griev.base + ' 回合（民心 <' + G.griev.lowHappy + ' 时 +1/' +
      G.griev.lowEvery + '，欠饷 +' + G.griev.owedPer + '/回合）');
    L.push('点击打开治理面板（赏赐 / 撤换）');
    return L.join('\n');
  }
  AO.resOffTitle = offTitle;

  /* 资历星 + 怨气小标（省卡与治理面板共用）。怨气 ≥60 变红 ——
   * 玩家扫一眼面板就知道"哪几个省在冒烟"，不用一个个悬停。 */
  function offBadge(off) {
    if (!off) return '';
    offNorm(off);
    var G = AO.GOV, s = '';
    if (off.rank > 0) {
      s += '<i class="ork" title="资历 ' + off.rank + '「' + G.rankCn[off.rank] +
        '」· 效果 +' + Math.round(off.rank * G.rankFx * 100) + '%">' +
        '★★★'.slice(0, off.rank) + '</i>';
    }
    var g = Math.round(off.griev);
    if (g > 0) {
      s += '<i class="ogv' + (g >= G.griev.warn ? ' bad' : '') +
        '" title="怨气 ' + g + '（≥' + G.griev.warn + ' 怨望 · ≥' + G.griev.steal +
        ' 侵吞）· 效果 −' + Math.round(g * G.grievFx * 100) + '%">怨' + g + '</i>';
    }
    return s;
  }
  AO.resOffBadge = offBadge;

  /* 官员一行：在任 → 名字 · 词条（点开治理面板撤换）；空缺 → 去派一位 */
  function renderOfficial(p) {
    var el = $('iOfficial');
    if (!el) return;
    var off = OFFICIAL[p.id];
    if (off) {
      var tr = AO.traitOf(off.traitKey);
      el.innerHTML = '<b>' + off.name + '</b><span class="otag ' + tr.rar + '">' + tr.cn + '</span>' +
        offBadge(off);
      el.title = offTitle(off, p.name);
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
    state.infoId = 0;
    /* 页签不清（v17）：手上正开着「建筑」，一不小心点到海面，再点回陆地
     * 应该还在「建筑」—— 这是玩家的习惯，不是某一块地的属性。 */
    applyInfoTab();
    hideWallRow();              // 城防行跟着省卡一起收起（别把上一省的墙留在版面上）
    hideUnrestRows();           // 安定/整合/安抚三行同理
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
      /* 页签**不重置**（v17）：正开着「建筑」去点另一块地，就该直接给我看那个省的建筑。
       * 换一个省不是"退出省卡" —— 以前这里把 infoTab 清成 null，点一下就缩回两个词，
       * 想看邻省的同一种建筑得重新点两次。 */
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
    /* 迷雾快照是 seen 态的产物：回到实时态就得把上一省的快照擦掉，
     * 否则它会留在概要区顶部，看着像"这个省也是旧情报"。 */
    var snap0 = $('iFogSnap');
    if (snap0) snap0.innerHTML = '';
    applyInfoTab();
    applyDetail();             // 测绘详情：收起 / 展开（跨刷新记在 localStorage）
    applyGroups();             // 建筑四组：各开各的
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
  /* 前置满足了吗：免费的根（皮革工艺）恒为真 —— 它不进 done 表，
   * 但它是"开局人人有"，所以挂在它下面的节点不该锁着。 */
  function reqOk(t, R) {
    if (!t.req) return true;
    var pa = AO.TECH_BY_KEY[t.req];
    if (pa && pa.free) return true;
    return !!R.done[t.req];
  }
  function techState(t, R) {
    /* 免费的根（皮革工艺）：树上画成**已点亮**，不进研究队列 —— 开局人人有 */
    if (t.free) return 'done';
    if (R.done[t.key]) return 'done';
    if (R.cur && R.cur.key === t.key) return 'cur';
    if (!R.unlocked) return 'lock';
    if (!reqOk(t, R)) return 'lock';
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
  function milBadge(key, size, mini) {
    var it = AO.MIL_ITEM[key];
    if (!it) return '';
    var s = size || 32;
    var txt = String(it.cn || '').replace(/[·]/g, '').slice(0, 2);
    /* mini = 叠在真图标右下的小角标：字号占满芯片（16/44），
     * 16px 显示时字也有 ~5.8px 高，两字立得住不糊 */
    var fs = mini ? 16 : 13, fy = mini ? 27.5 : 27;
    return '<svg class="bart mbadge" viewBox="0 0 44 44" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="3" y="9" width="38" height="26" rx="5" fill="' + (it.color || '#8d8d8d') +
      '" fill-opacity=".9" stroke="#2f353b" stroke-width="2"/>' +
      '<text x="22" y="' + fy + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="#fdfbf6" ' +
      'font-family="system-ui,-apple-system,sans-serif">' + txt + '</text></svg>';
  }
  /* 一条线的"一炉要几点产能"。v19 把 MILL.pt 改成了 MILL.work（工作量语义没变：
   * 攒够这么多点出一单），文案这边漏改，读到 undefined['catapult'] 会当场炸 ——
   * 任何一国研完军事科技就崩在 settleResearch 里。只此一处，两个读点都走它。 */
  function millPtOf(line) {
    var M = AO.MILL;
    var v = (M.work && M.work[line]) || (M.pt && M.pt[line]);
    return v || 1;
  }
  /* 军事科技的一句话效果（节点副标题、完成提示共用一份）。
   * v17 起措辞改成**产线语汇**：科技解锁的是"这一条产线能不能开"，
   * 不是"这一坊产什么" —— 加点（+1/座）、×1.5、品质上移都在别的科技上。 */
  function milEffectText(key) {
    var it = AO.MIL_ITEM[key];
    if (!it) return '解锁新装备';
    /* v19：炮线并进军械坊（铸炮厂没了），所以炮/舰两条都写"哪一池的第几条线" */
    var kindCn = it.kind === 'gun' ? '军械坊（炮线）' : it.kind === 'ship' ? '造船厂' : '军械坊';
    var pt = millPtOf(it.key);
    var per = it.kind === 'gun' ? '1 门' : it.kind === 'ship' ? '1 艘' : ('1 队份 ×' + (AO.MILL.batch.blade || 1000));
    var s = '解锁' + kindCn + '产线「' + it.cn + '」：' + pt + ' 点产能 → ' + per +
      (it.siege ? ' · 攻城 ' + it.siege : '') + (it.range ? ' · 射程 ' + it.range : '') +
      (it.pow ? ' · 战力 ×' + it.pow : '');
    /* 时代节点另外推一份装备材质（拍板④：皮革→gw 的节点要写"同时解锁 XX 材质装备"）。
     * 材质挂在**科技**上，所以这里顺着装备反查它那条科技。 */
    var t = it.tech ? AO.TECH_BY_KEY[it.tech] : null;
    if (t && t.mat) {
      var mat = null, i;
      for (i = 0; i < AO.EQUIP.mat.length; i++) if (AO.EQUIP.mat[i].key === t.mat) mat = AO.EQUIP.mat[i];
      if (mat) s += '；同时解锁「' + mat.cn + '」材质装备（每槽 ' + Math.round(mat.base * 100) + '%）';
    }
    return s;
  }
  AO.milEffectText = milEffectText;
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
        milBadge(t.mil, Math.round(s * 0.4), true) + '</span>';
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
    /* 一句话效果：军工科技写在 desc 上（它们没有 fx、也没有 mil 装备），
     * 全局科技走 fxDesc，军事科技走 milEffectText —— 三套语汇不能混。 */
    var sub = t.desc ? t.desc
      : t.fx ? fxDesc(t)
        : t.mil ? ((AO.MIL_ITEM[t.mil] || {}).cn + (t.mat ? ' · 材质「' + matCn(t.mat) + '」' :
          ' · 战力 ×' + ((AO.MIL_ITEM[t.mil] || {}).pow || 1)))
          : (d ? d.build : t.for) + ' 可升 Lv2';
    if (st === 'lock') {
      foot = R.unlocked ? '需先研「' + (parent ? parent.cn : t.req) + '」' : '建学校开始科研';
    } else if (st === 'cur') {
      var tp = t.turns ? Math.max(0, Math.min(100, (1 - R.cur.left / t.turns) * 100)) : 0;
      foot = '<span class="pbar"><i style="width:' + tp.toFixed(0) + '%"></i></span>' +
        '<em>剩 ' + R.cur.left + ' 回合</em>' +
        (canSprint ? '<button class="ttsprint" type="button" title="冲刺：' +
          costText(AO.BUILDER.sprintCost) + '（中央国库）砍 1 回合">＋</button>' : '');
    } else if (st === 'done') {
      foot = '研成 · ' + (t.desc ? shortDesc(t.desc) : t.fx ? fxDesc(t)
        : t.mil ? milEffectText(t.mil).replace(/^解锁/, '') : (d ? d.build : t.for) + ' Lv2 开放');
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
    var turnsNow = effectiveTurns(0, TT.owner, t.turns);
    return '<div class="ttnode ' + st + (qi >= 0 ? ' queued' : '') + '" data-tech="' + t.key + '"' +
      ' style="left:' + p.x + 'px;top:' + p.y + 'px"' +
      ' title="' + t.cn + '：' + t.pts + ' 科研点 · ' + costText(t.cost) + ' · ' + turnsNow + ' 回合">' +
      '<div class="h">' + techIcon(t, t.mil ? 40 : 32) +
        '<div class="tx"><b>' + t.cn + '</b>' +
        '<span>' + sub + '</span></div>' +
      '</div>' +
      '<div class="cost">' + t.pts + ' 科研点 · ' + costText(t.cost) + ' · ' + turnsNow + ' 回合</div>' +
      '<div class="ft">' + foot + '</div>' + extra + badge +
      '</div>';
  }
  /* 材质键 → 中文（科技节点副标题用） */
  function matCn(key) {
    for (var i = 0; i < AO.EQUIP.mat.length; i++) if (AO.EQUIP.mat[i].key === key) return AO.EQUIP.mat[i].cn;
    return key;
  }
  /* 节点的 done 脚注只放得下一行：desc 里取前 12 个字，剩下的在 title 里 */
  function shortDesc(s) {
    var t = String(s || '');
    var i = t.search(/[（(]/);
    if (i > 6) t = t.slice(0, i);
    return t.length > 22 ? t.slice(0, 22) + '…' : t;
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
    var t0 = AO.TECH_BY_KEY[key];
    if (t0 && t0.free) return;                 // 免费的根：点它没有任何事发生
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
  var GP = { open: false, owner: 0, sel: 0, tab: 'gov', selArmy: 0, selArt: 0 };
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

  /* ---------------- 内阁（v12）：宰相 ----------------
   * 这一节只做三件事：显示在任者（或可拜的人）、拜相/罢相、四项权限开关。
   * 权限开关的**唯一**判定在 chPerms()，这里只负责画：权相那一档开关全部置灰，
   * 下面写一句红字"他自作主张" —— 玩家必须一眼看出"这个人不听我的"。 */
  function renderCabinet(c) {
    var row = $('gpCabRow'), perm = $('gpCabPerm');
    if (!row) return;
    var owner = c.id, ch = CHANCELLOR[owner];
    var title = chTitleOf(owner);
    var T = talentOf(owner);
    var pool = (T.pool || []).filter(function (o) {
      return o && AO.traitOf(o.traitKey).isChancellor;
    });
    var nEl = $('gpCabN');
    if (nEl) nEl.textContent = ch ? '· 在任' : (pool.length ? '· ' + pool.length + ' 位可拜' : '');
    var h = '', i;
    if (ch) {
      var tr = AO.traitOf(ch.traitKey), L = chLv(ch);
      var state = ch.paused === 'owed' ? '欠俸停摆' : ch.paused === 'strike' ? '撂挑子' : '视事';
      h += '<div class="chcard g' + ch.grade + (ch.paused ? ' paused' : '') + '">' +
        '<span class="chav">' + escHtml(ch.name.charAt(0)) + '</span>' +
        '<div class="chm"><div class="chn"><b>' + escHtml(ch.name) + '</b>' +
          '<span class="cht">' + title + '</span>' +
          '<span class="otag gold">' + tr.cn + '</span>' +
          '<span class="chst' + (ch.paused ? ' bad' : '') + '">' + state + '</span></div>' +
        '<div class="chd">' + escHtml(L.desc) + '</div>' +
        (ch.owed > 0 ? '<div class="chw">欠俸 ' + Math.round(ch.owed) + ' 金 —— 补上即复工</div>' : '') +
        '</div>' +
        '<button type="button" class="pgo out chbtn" data-ch="out"' +
        ' title="罢相：致仕还乡（不回候选池），自动化全停">罢相</button>' +
        '</div>';
    } else if (pool.length) {
      h += '<div class="chlist">';
      for (i = 0; i < pool.length; i++) {
        var o = pool[i], t2 = AO.traitOf(o.traitKey);
        var L2 = AO.CHANCELLOR_LV[t2.grade] || {};
        h += '<div class="chcand"><b>' + escHtml(o.name) + '</b>' +
          '<span class="otag gold">' + t2.cn + '</span>' +
          '<em>' + escHtml(L2.desc || '') + '</em>' +
          '<button type="button" class="pgo chbtn" data-ch="in" data-oid="' + o.id + '">拜相</button></div>';
      }
      h += '</div>';
    } else {
      h += '<div class="chempty">尚未拜相 —— 开科取士有约 3.8% 的概率抽到宰相之才' +
        '（守成之才 / 干练能臣 / 一代贤相 / 权倾朝野）。拜相之后，本国每回合由他代劳' +
        '你还没做的事；他只做你没做的，不会推翻你的决定。</div>';
    }
    row.innerHTML = h;

    /* 权限开关：四颗。没有宰相时整排置灰（先拜相才有意义） */
    if (perm) {
      var L3 = ch && chLv(ch), eff = ch ? chPerms(ch) : null;
      var ph = '<span class="pl">权限</span>';
      for (i = 0; i < AO.CH_PERMS.length; i++) {
        var pk = AO.CH_PERMS[i];
        var own = L3 ? (L3.perms[pk.key] ? 1 : 0) : 0;
        var on = eff ? eff[pk.key] : 0;
        var dis = !ch || (L3 && (L3.ignorePerms || !own));
        ph += '<button type="button" class="permtog' + (on ? ' on' : '') + '"' +
          ' data-perm="' + pk.key + '"' + (dis ? ' disabled' : '') +
          ' title="' + (L3 && L3.ignorePerms ? '他自作主张：权限开关对他无效'
            : (!ch ? '先拜相' : (own ? '许可宰相做这一类决策（即时生效）'
              : '这一级宰相不会做这件事（开关点了也不生效）'))) + '">' + pk.cn + '</button>';
      }
      if (L3 && L3.ignorePerms) ph += '<em class="pbad">他自作主张：四项开关全部失效</em>';
      else if (!ch) ph += '<em>拜相后可调</em>';
      perm.innerHTML = ph;
    }
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

  /* ---------------- 工匠（v17）：候选池 + 派驻 ----------------
   * 交互照官员派遣抄：先在池里点一位选中（GP.selArt），再点省行的「派」。
   * 为什么不用下拉框：一屏十几个有坊的省，下拉里选"第 37 号省"没人认得；
   * 而"点人 → 点省"和官员/将领是同一个手感，玩家不用学第三遍。
   * 一省一匠、一匠一省：派到已有匠人的省会顶替（旧的回池，免费）。 */
  function renderArtSec(cid) {
    var box = $('gpArtPool');
    if (!box) return;
    var A = artisanPoolOf(cid), mine = canAct(cid);
    var cost = AO.ARTISAN.examCost || AO.GOV.examCost;
    var T = talentOf(cid);
    var postN = 0, pk;
    for (pk in A.post) if (A.post[pk]) postN++;
    var nEl = $('gpArtN');
    if (nEl) nEl.textContent = '· 驻场 ' + postN + ' 位 / 待命 ' + A.pool.length + ' 位';

    var ev = $('gpArtExam');
    if (ev) {
      ev.disabled = T.pts < cost || !mine;
      ev.title = !mine ? lockTitle()
        : T.pts < cost ? ('人才点不够：还差 ' + fmtPts(cost - T.pts) + ' 点')
          : ('花 ' + cost + ' 点抽一位匠人（学徒 50 / 巧手 30 / 名师 15 / 宗师 5）。' +
            '有匠人驻场，这个省的装备三线（盔/甲/靴）才开得起来');
      lockBtn(ev, cid);
    }

    if (!A.pool.length) {
      box.innerHTML = '<div class="pempty">没有待命的匠人 —— ' +
        (T.pts >= cost ? '点「开工科」抽一位。' : '攒够 ' + cost + ' 点人才点后点「开工科」抽一位。') +
        '<br>匠人是**装备线**的钥匙：盔 / 甲 / 靴 只在有匠人驻场的省打得出来。</div>';
    } else {
      var h = '';
      for (var i = 0; i < A.pool.length; i++) {
        var a = A.pool[i], L = artisanLv(a);
        h += '<div class="ocard rar-' + (a.lv >= 2 ? 'gold' : 'plain') + (GP.selArt === a.id ? ' sel' : '') +
          '" data-aid2="' + a.id + '" title="' + escHtml(L.cn + '：' + L.desc +
            '\n俸禄 ' + L.pay + ' 金/回合（省库发）\n点一下选中，再点下面省行的「派」驻场') + '">' +
          '<span class="av ' + (a.lv >= 2 ? 'gold' : 'plain') + '">' + escHtml(a.name.charAt(0)) + '</span>' +
          '<div class="om"><b>' + escHtml(a.name) + '</b>' +
          '<span class="ot ' + (a.lv >= 2 ? 'gold' : 'plain') + '">' + L.cn + '</span>' +
          '<span class="od">' + escHtml(L.desc) + '</span></div></div>';
      }
      box.innerHTML = h;
    }

    /* 省行：只列"有坊"的省（没坊的省派了也没活干） */
    var tab = $('gpArtTable');
    if (!tab) return;
    var c = coOf(cid), rows = [], j;
    if (c) {
      for (j = 0; j < c.provinces.length; j++) {
        var p = pOf(c.provinces[j]);
        if (!p) continue;
        if (!artisanSpot(p.id)) continue;
        rows.push(p);
      }
    }
    /* 有匠人的排前面（要撤/换的时候找得快），其余按人口 */
    rows.sort(function (x, y) {
      var ax = A.post[x.id] ? 1 : 0, ay = A.post[y.id] ? 1 : 0;
      if (ax !== ay) return ay - ax;
      return ((POP[y.id] && POP[y.id].v) || 0) - ((POP[x.id] && POP[x.id].v) || 0);
    });
    if (!rows.length) {
      tab.innerHTML = '<div class="pempty">本国还没有军械坊 / 铸炮厂 / 造船厂 —— ' +
        '匠人得有活干的地方（先盖一座坊，再派人）。</div>';
      return;
    }
    var hh = '<div class="prow head art"><span class="an">省名</span><span class="aw">有坊</span>' +
      '<span class="aa">驻场匠人</span><span class="ax">派遣</span></div>';
    for (j = 0; j < rows.length; j++) {
      var rp = rows[j], ar = A.post[rp.id], sp = artisanSpot(rp.id);
      var shopCn = (AO.FACTORY[sp] || {}).cn || '—';
      hh += '<div class="prow art" data-pid="' + rp.id + '">' +
        '<span class="an">' + escHtml(rp.name) + '</span>' +
        '<span class="aw">' + escHtml(shopCn) + '</span>' +
        (ar
          ? '<span class="aa has" title="' + escHtml(artisanLv(ar).cn + '：' + artisanLv(ar).desc +
            '\n俸禄 ' + artisanLv(ar).pay + ' 金/回合') + '">' + escHtml(ar.name) +
            '<em class="otag ' + (ar.lv >= 2 ? 'gold' : 'plain') + '">' + artisanLv(ar).cn + '</em></span>'
          : '<span class="aa none">空缺</span>') +
        '<span class="ax">' +
        (ar ? '<button type="button" class="pgo out" data-art="out" data-pid="' + rp.id +
          '" title="撤回候选池（免费，随时可换）">撤</button>'
          : '<button type="button" class="pgo' + (GP.selArt ? ' ready' : '') + '" data-art="in" data-pid="' + rp.id +
            '"' + (GP.selArt ? '' : ' disabled') + ' title="' +
            (GP.selArt ? '把选中的匠人派驻这一省（三坊产能按他的等级加成）' : '先在左边候选池里选一位匠人') +
            '">派</button>') +
        '</div>';
    }
    tab.innerHTML = hh;
    if (!mine) {
      var bs = tab.querySelectorAll('button.pgo');
      for (var bi = 0; bi < bs.length; bi++) lockBtn(bs[bi], cid);
    }
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
      '<span class="px">派遣 · 传教 · 赏赐</span></div>';
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
          ? '<span class="po has" title="' + escHtml(offTitle(off, p.name)) + '">' +
            escHtml(off.name) + '<em class="otag ' + tr.rar + '">' + tr.cn + '</em>' +
            offBadge(off) + '</span>'
          : '<span class="po none">空缺</span>') +
        (off
          ? '<span class="pm"><button type="button" class="pgo out" data-pid="' + pid +
            '" title="撤换回候选池（免费，随时可换；资历减半、怨气清零）">撤</button>' +
            '<button type="button" class="pgo rew" data-pid="' + pid +
            '" title="赏赐：中央金 −' + G.griev.reward + ' → 怨气 −' + G.griev.rewardCut +
            '（现在 ' + Math.round(off.griev) + '）">赏</button>' +
            missionBtn(p) + '</span>'
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
    var w = state.world;
    var cid = GP.owner || 1;
    var c = w.countries[cid - 1];
    if (!c) { closeGovPanel(); return; }
    var G = AO.GOV, i;

    $('gpFlag').style.background = c.color;
    $('gpName').textContent = c.name;
    $('gpNameEn').textContent = c.name_en + ' · #' + c.id;

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
    renderArtSec(cid);              // 工匠（v17）：候选池 + 派驻（装备线的钥匙）
    renderCabinet(c);               // 内阁（v12）：拜相 / 罢相 / 四项权限
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

  /* 税率切换：**即时生效**，下一个回合的税就按新档收。
   * 民心不立刻跳（它是每回合 lerp 的），所以切到"横征暴敛"的当回合
   * 税就涨上去了、民心下回合才慢慢掉下来 —— 这个时序是故意的：
   * 先甜后苦，玩家才会去权衡。 */
  function setTaxRate(owner, r) {
    if (r !== 0 && r !== 1 && r !== 2) return;
    if (!canAct(owner)) return govMsg(lockTitle(), 'warn');
    TAXRATE[owner] = r;
    TAXMAN[owner | 0] = turnNo;        // v12：宰相 3 回合内不许动税率（见 CH_TAX_HOLD）
    var G = AO.GOV;
    govMsg('税率改为「' + G.rateCn[r] + '」：每 ' + G.popCn() + ' ' + G.goldPerUnit[r] +
      ' 金 · 每 ' + G.ironCn() + ' ' + G.ironPer2M[r] + ' 铁/回合，民心压力 ' +
      (G.happyHit[r] > 0 ? '+' : '') + G.happyHit[r] +
      '（民心每回合慢慢靠过去）', 'ok');
  }

  function bindGovPanel() {
    $('gpClose').addEventListener('click', closeGovPanel);
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

    /* 开工科（v17）：和文/武共用人才点、同一次消耗，只是抽的池子不同 */
    var artExam = $('gpArtExam');
    if (artExam) artExam.addEventListener('click', function () {
      var r = examArtisan(GP.owner);
      if (!r.ok) return govMsg(r.msg, 'warn');
      govMsg('开工科：' + r.artisan.name + ' —— 「' + r.lv.cn + '」' + r.lv.desc, 'ok');
      renderGovPanel();
      flushNotes();
    });
    /* 匠人候选池：点卡 = 选中 / 取消 */
    var artPool = $('gpArtPool');
    if (artPool) artPool.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.ocard') : null;
      if (!el) return;
      var id = +el.getAttribute('data-aid2');
      GP.selArt = (GP.selArt === id) ? 0 : id;
      renderGovPanel();
    });
    /* 匠人派驻 / 撤回 */
    var artTab = $('gpArtTable');
    if (artTab) artTab.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-art]') : null;
      if (!b || b.disabled) return;
      var pid = +b.getAttribute('data-pid');
      if (b.getAttribute('data-art') === 'in') {
        if (!GP.selArt) return govMsg('先在候选池里点一位匠人', 'warn');
        var r = postArtisan(pid, GP.selArt);
        if (!r.ok) return govMsg(r.msg, 'warn');
        govMsg(r.artisan.name + ' 进驻 ' + (pOf(pid) || {}).name + '：' +
          artisanLv(r.artisan).cn + '（三坊产能 +' + Math.round(artisanLv(r.artisan).bonus * 100) +
          '%，装备线开）' + (r.replaced ? '；' + r.replaced.name + ' 回池' : ''), 'ok');
        GP.selArt = 0;
      } else {
        var a = unpostArtisan(pid);
        if (a) govMsg(a.name + ' 撤回候选池：本省装备线（盔/甲/靴）随之锁死', 'warn');
      }
      renderGovPanel();
      /* 省卡开着的话跟着刷（产能预览变了） */
      var pv = pOf(pid);
      if (pv && state.renderer && state.renderer.selected === pid) renderInfoLists(pv);
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
      if (b && b.classList.contains('rew')) {
        /* 赏赐（v11）：和 AI 吏部同一个函数，扣的是中央金 */
        var rr = rewardOfficial(pid);
        govMsg(rr.msg, rr.ok ? 'ok' : 'warn');
      } else if (b && !b.classList.contains('out')) {
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
          AO.GOV.noOfficerMul + '；资历减半、怨气清零）', 'warn');
      }
      renderGovPanel();
      /* 省卡开着的话跟着刷（民心/官员两行要变） */
      if (state.renderer && state.renderer.selected === pid) renderInfoLists(prov);
      if ($('country').classList.contains('on')) {
        var cc = state.world.countries[prov.owner - 1];
        if (cc) renderGovern(cc);
      }
    });

    /* 内阁（v12）：拜相 / 罢相 / 四项权限开关。整节一个委托，
     * 因为候选人与在任者是两种卡片，重画频繁。 */
    var cab = $('gpCabSec');
    if (cab) cab.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      var act = b.getAttribute('data-ch');
      if (act === 'in') {
        var r = appointChancellor(GP.owner, +b.getAttribute('data-oid'));
        govMsg(r.ok ? ('拜相：' + r.ch.name + ' 为' + chTitleOf(GP.owner) + ' —— 「' +
          AO.traitOf(r.ch.traitKey).cn + '」') : r.msg, r.ok ? 'ok' : 'warn');
      } else if (act === 'out') {
        var ch = dismissChancellor(GP.owner);
        if (ch) govMsg('罢相：' + ch.name + ' 致仕还乡（自动化全停；他不回候选池）', 'warn');
      } else if (b.getAttribute('data-perm')) {
        var ch2 = chOf(GP.owner);
        if (!ch2) return;
        var k = b.getAttribute('data-perm'), cn = k;
        for (var pi = 0; pi < AO.CH_PERMS.length; pi++) {
          if (AO.CH_PERMS[pi].key === k) cn = AO.CH_PERMS[pi].cn;
        }
        ch2.perms[k] = ch2.perms[k] ? 0 : 1;
        govMsg('宰相权限「' + cn + '」：' + (ch2.perms[k] ? '开' : '关'), 'ok');
      } else {
        return;
      }
      renderGovPanel();
      flushNotes();
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
      it: it, name: unitNameOf(a), gen: gen, p: p, c: c,
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
          '先在兵营省（兵营 ＋ 建）征一支：花金 + 人口，<b>不扣装备</b>；' +
          '成军后去顶栏「武库」发兵刃 / 马 / 炮 —— 有炮=炮兵、有马=骑兵。</div>';
      } else {
        var h = '<div class="prow head war">' +
          '<span class="wn">军队</span><span class="wm">兵数</span><span class="wg">将领</span>' +
          '<span class="wo">命令</span><span class="wp">驻地</span><span class="wx">状态</span></div>';
        for (i = 0; i < list.length; i++) {
          var a = list[i], info = warPageOfArmy(a);
          h += '<div class="prow war' + (GP.selArmy === a.id ? ' sel' : '') + '" data-aid="' + a.id + '">' +
            '<span class="wn"><i style="background:' + (info.c ? info.c.color : '#888') + '"></i>' +
            (a.type === 'navy' ? '⚓ ' : '') + escHtml(info.name) +
            (a.type === 'navy' ? '' : ' · ' + unitKindCn(a)) + '</span>' +
            '<span class="wm">' + a.men.toLocaleString() + (a.ships ? ' / ' + a.ships + ' 舰' : '') + '</span>' +
            '<span class="wg">' + (info.gen ? escHtml(info.gen.name) + '<em class="otag ' +
              genTrait(info.gen).rar + '">' + genTrait(info.gen).cn + '</em>' : '<em class="none">无将</em>') + '</span>' +
            '<span class="wo">' + info.orderCn + (info.tacCn ? '<em>' + info.tacCn + '</em>' : '') + '</span>' +
            '<span class="wp">' + (info.p ? escHtml(info.p.name) : '—') +
              (info.p && OCCUPY[info.p.id] ? '<em>占领</em>' : '') + '</span>' +
            '<span class="wx">' + (a.starved ? '<em class="bad">断粮</em>' : '') +
              (a.sup ? '<em class="bad">被压制</em>' : '') +
              (a.order && a.order.type === 'train' ? '<em>练兵</em>' : '') +
              (a.type === 'navy' ? '' : eqChips(a)) + '</span>' +
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

  /* 军队行上的装备小芯片：三件各一个色点 + 合计乘数（没有装备就不占位） */
  function eqChips(a) {
    if (!a || !a.equip) return '';
    var E = AO.EQUIP, out = '', n = 0, i;
    for (i = 0; i < E.slots.length; i++) {
      var q = a.equip[E.slots[i]];
      if (!q) continue;
      n++;
      out += '<i class="eqd q-' + q + '" title="' + E.slotCn[E.slots[i]] + ' · ' +
        E.qLong[q] + '">' + E.slotCn[E.slots[i]] + '</i>';
    }
    if (!n) return '';
    return '<em class="eqtag" title="装备合计：战力 ×' + equipMulOf(a).toFixed(3) + '">' +
      out + '×' + equipMulOf(a).toFixed(2) + '</em>';
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

    /* 武装（v19）：兵种是发出来的 —— 这里只报"现在穿什么"，换装在顶栏「武库」 */
    if (!isNavy) {
      var u0 = unitOf(a);
      h += '<div class="werow"><span>武装</span><em style="flex:1">' + escHtml(gearText(a)) +
        '　<span class="none">攻 ' + u0.atk.toFixed(2) + ' · 防 ' + u0.def.toFixed(2) +
        ' · 机动 ' + u0.mov + ' · 攻城 ' + u0.siege + '</span></em>' +
        (a.weapon ? '' : '<em class="halted" title="没有兵刃：战力只有 0.5，能守不能攻">赤手空拳</em>') +
        '</div>';
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

    /* 装备三槽（v17）：盔 / 甲 / 靴，各手动选一件或一键配齐。
     * 换装撤下来的那件回国库（equipArmy 里做），所以玩家可以放心来回试。 */
    if (!isNavy) {
      var E = AO.EQUIP, inv = equipOf(a.owner);
      if (!a.equip) a.equip = { helm: null, chest: null, boots: null };
      h += '<div class="werow eqrow"><span>装备</span><div class="eqslots">';
      for (var e1 = 0; e1 < E.slots.length; e1++) {
        var slot = E.slots[e1], curQ = a.equip[slot];
        h += '<label class="eqslot' + (curQ ? ' q-' + curQ : '') + '" title="' +
          escHtml(E.slotCn[slot] + '：一件的加成 = 材质底 × 品质倍（现在材质「' +
            matOf(a.owner).cn + '」' + Math.round(matOf(a.owner).base * 100) + '%）') +
          '"><span>' + E.slotCn[slot] + '</span><select data-eqslot="' + slot + '"' +
          (mine ? '' : ' disabled') + '><option value="">— 空 —</option>';
        for (var e2 = E.q.length - 1; e2 >= 0; e2--) {
          var qk = E.q[e2], have = (inv[slot] && inv[slot][qk]) || 0;
          /* 身上那件也算"可选"（数量 0 也列出来，不然换装时看不见自己穿着什么） */
          if (!have && curQ !== qk) continue;
          h += '<option value="' + qk + '"' + (curQ === qk ? ' selected' : '') + '>' +
            E.qLong[qk] + '（库存 ' + have + '）</option>';
        }
        h += '</select></label>';
      }
      h += '</div><button type="button" data-eqfit="1"' + (mine ? '' : ' disabled') +
        ' title="三槽各取国库里最好的一件（已有的更好就不动）">一键配齐</button>' +
        '<em class="eqmul" title="战力乘数 = 1 + Σ(材质底 × 品质倍)，攻防同乘">战力 ×' +
        equipMulOf(a).toFixed(3) + '</em></div>';
    }

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
      if (t.closest('#gpMilExam')) {        var r = examGeneral(GP.owner);
        if (!r.ok) return govMsg(r.msg, 'warn');
        govMsg('开武科：' + r.gen.name + ' —— 「' + r.trait.cn + '」' + r.trait.desc, r.trait.rar === 'bad' ? 'warn' : 'ok');
        renderGovPanel();
        flushNotes();
        return;
      }
      /* 一键配齐（装备） */
      if (t.closest('button[data-eqfit]')) {
        var af = ARMY[GP.selArmy];
        if (!af) return;
        var rf = equipAutoFit(af);
        govMsg(rf.ok ? rf.msg : rf.msg, rf.ok ? 'ok' : 'warn');
        renderGovPanel();
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
      /* 装备槽（v17）：换一件 → 撤下的回国库、选中的出库 */
      if (t.getAttribute && t.getAttribute('data-eqslot')) {
        var ae = ARMY[GP.selArmy];
        if (!ae) return;
        var r = equipArmy(ae, t.getAttribute('data-eqslot'), t.value || null);
        govMsg(r.ok ? (r.q ? ('换上「' + AO.EQUIP.slotCn[t.getAttribute('data-eqslot')] +
          ' · ' + AO.EQUIP.qLong[r.q] + '」，战力 ×' + equipMulOf(ae).toFixed(3)) : '卸下这件，回库')
          : r.msg, r.ok ? 'ok' : 'warn');
        renderGovPanel();
        return;
      }
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
   * 宣战钮只有 PLAYER 能用（别国的卡上也画，但置灰 —— 让玩家知道那儿有个钮）。
   *
   * v9 追加：关系值 + 五档词、条约（同盟 / 互不侵犯）、战争分对比条、求和（谈判桌）。
   * 条约动作以 PLAYER 身份发起，所以它们在**对方的卡上**是可点的 ——
   * 「打开一个国家的卡」本来就是"看我和它怎么了"。 */

  /* 缔约钮：门槛（REL）与冷却（被拒 10 回合）先在这里判一次，
   * 点下去仍然走 proposePact（它自己再判一次 —— 面板只负责"先告诉你行不行"）。 */
  function pactBtnHtml(toCid, kind) {
    var D = AO.DIPLO;
    var need = kind === 'ally' ? D.ally.need : D.nap.need;
    var rel = relOf(PLAYER, toCid);
    var left = Math.max(0, (DIPCD[cdKey(PLAYER, toCid, kind)] || 0) - turnNo);
    /* 外交锁（v13）：玩家自己是傀儡 → 一颗都按不动。理由写在 title 里，
     * 而不是只把钮变灰 —— 玩家得知道"为什么"，不然会以为是 bug。 */
    var suzMe = PLAYER ? suzerainOf(PLAYER) : 0;
    var off = !!suzMe || rel < need || left > 0;
    /* 上一次提议的结果也写进 title —— 玩家隔了几回合回来，至少知道"上次是被拒了"，
     * 而不是只看到一颗灰钮。 */
    var prop = DIPPROP[warKey(PLAYER, toCid)];
    var last = (prop && prop.kind === kind && !prop.ok && prop.turn)
      ? '\n上次提议（第 ' + prop.turn + ' 回合）：被拒' : '';
    var tip = suzMe ? '听命于宗主 ' + nameOf(suzMe) + '：傀儡不能对外缔约'
      : left > 0 ? '对方刚拒绝过：还要等 ' + left + ' 回合'
      : rel < need ? '关系 ' + rel + ' 不到门槛 ' + need + '（' + pactCn(kind) + '）'
        : '提议' + pactCn(kind) + '：关系 ' + rel + '，AI 按 关系 + 性格 + 共同敌人 评估（≥' +
          D.eval.accept + ' 才答应）';
    return '<button type="button" class="warbtn pact" data-pact="' + kind + '"' +
      (off ? ' disabled' : '') + ' title="' + escHtml(tip + last) + '">' + pactCn(kind) + '</button>';
  }

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

    /* 关系值（v9）：只显示"玩家 ↔ 这个国家"这一对 —— 关系值是双向的一格，
     * 站在你的位置上读它才有意义。工坊模式（没选国）不显示这一行。 */
    if (PLAYER && PLAYER !== c.id && !countryDead(c.id)) {
      var rv = relOf(PLAYER, c.id), rt = relTier(rv);
      h += '<div class="gvrow"><span>关系</span><em class="rel ' + rt.key + '" title="' +
        escHtml('关系值 ' + rv + '（-100 敌对 ~ 100 亲睦）\n每回合无事件时向 0 走 ' +
          AO.DIPLO.rel.drift + '；同盟有 ' + AO.DIPLO.rel.allyFloor + ' 的地板') +
        '">' + rv + ' · ' + rt.cn + '</em></div>';
    }
    /* 条约（v9）：两国卡都显示 —— 表是双向的一张（warKey 无序），所以天然一致 */
    if (isAlly(PLAYER || 0, c.id)) {
      h += '<div class="gvrow"><span>条约</span><em class="pact">同盟 · 互不宣战</em></div>';
    } else if (isNap(PLAYER || 0, c.id)) {
      h += '<div class="gvrow"><span>条约</span><em class="pact">互不侵犯 · 互不宣战</em></div>';
    }

    /* 傀儡与朝贡（v13）：这张卡是傀儡 → 一行"奉表称臣于 ×"，顺手把
     * "已 N 回合 / 距可并入 M 回合"一起报出来（那是宗主最关心的两个数）。
     * 这张卡是宗主 → 每个属国一行。两种身份在同一条关系里只可能出现一种。 */
    var P13 = AO.DIPLO.puppet || {};
    var suzOf = suzerainOf(c.id);
    if (suzOf) {
      var recS = puppetRecOf(c.id);
      var held = recS ? Math.max(0, turnNo - recS.since) : 0;
      var leftA = recS ? Math.max(0, (recS.annexCd || 0) - turnNo) : 0;
      h += '<div class="gvrow"><span>臣属</span><em class="puppet" title="' +
        escHtml('奉表称臣于 ' + nameOf(suzOf) + '：每回合上贡中央金入的 ' +
          Math.round((P13.tribute || 0.2) * 100) + '%，宣战随宗主、外交不得自专。\n' +
          '满 ' + (P13.annexCd | 0) + ' 回合后宗主可提「和平并入」；每 ' +
          (P13.indepEvery | 0) + ' 回合有一次机会揭竿而起。') +
        '">奉表称臣于 ' + escHtml(nameOf(suzOf)) + ' · 已 ' + held + ' 回合 / 距可并入 ' +
        (leftA > 0 ? leftA + ' 回合' : '已可并入') + '</em></div>';
    }
    var vsOf = vassalsOf(c.id);
    for (i = 0; i < vsOf.length; i++) {
      var recV = PUPPET[warKey(c.id, vsOf[i])];
      var heldV = recV ? Math.max(0, turnNo - recV.since) : 0;
      var leftV = recV ? Math.max(0, (recV.annexCd || 0) - turnNo) : 0;
      h += '<div class="gvrow"><span>属国</span><em class="vassal" title="' +
        escHtml('每回合上贡它的中央金入 ' + Math.round((P13.tribute || 0.2) * 100) +
          '%；你宣战它自动同宣（它被宣你不参战）') +
        '">' + escHtml(nameOf(vsOf[i])) + ' 奉表 · 已 ' + heldV + ' 回合 · 岁贡' +
        (leftV > 0 ? ' · 距可并入 ' + leftV + ' 回合' : ' · 可并入') + '</em></div>';
    }

    /* 战争分（v9）：每场仗一条对比条。分从宣战那一刻开始记，
     * 占领省 +10 / 会战胜 +5 / 围城陷城 +8 / 首都易手 +30 / 轰击小胜 +1。 */
    for (i = 0; i < wars.length; i++) {
      var wsc = wsScoreOf(c.id, wars[i]), wsc2 = wsScoreOf(wars[i], c.id);
      var wsum = Math.max(1, wsc + wsc2);
      /* 左 = 本卡国、右 = 对手（和下面那条对比条同序）。
       * 不用"我方"：这张卡也可能是别国的 —— 站在谁的位置上，就得说谁的话。 */
      h += '<div class="gvrow"><span>战争分</span><em class="ws" title="' +
        escHtml('左＝' + nameOf(c.id) + ' ' + wsc + ' 分 · 右＝' + nameOf(wars[i]) + ' ' + wsc2 +
          ' 分\n占领省 +10 · 会战胜 +5 · 围城陷城 +8 · 首都易手 +30 · 轰击 +1') +
        '">' + wsc + ' : ' + wsc2 + '<i class="vs">vs ' + escHtml(nameOf(wars[i])) + '</i></em></div>' +
        '<div class="wsbar"><i class="wsA" style="flex:' + (wsc / wsum) + '"></i>' +
        '<i class="wsB" style="flex:' + (wsc2 / wsum) + '"></i></div>';
    }

    /* 性格（v7 完整版）：**吃情报档** —— 0 档 "？？"、1 档只有性格词、
     * 2 档性格 + 主导怪癖。识人也是情报战：不了解对手的脾气，
     * 就看不懂它为什么宁可饿着百姓也要把兵营盖起来。
     * 文案与判定都在 18-ai.js（AO.aiPersonaView），这里只负责放到格子里。 */
    if (AO.aiPersonaView) {
      var pv = AO.aiPersonaView(c.id, intelTier(c.id));
      h += '<div class="gvrow"><span>性格</span><em class="' + (pv.known ? 'pv' : 'none') +
        '" title="' + escHtml(pv.title) + '">' + escHtml(pv.text) + '</em></div>';
    }

    /* 宣战 / 停战：两种钮各一排，按"跟邻国打没打仗"分 */
    h += '<div class="diplobtns">';
    /* 外交动作（v9）：**在对方的卡上**发起 —— 打开一个国家的卡，就是"我和它的关系"。
     * 这些钮以 PLAYER 的身份出手，所以不受 canAct(c.id) 管（那管的是"别国的内政"，
     * 缔约/求和恰恰是"我和你"的事）。 */
    var canDiplo = !!PLAYER && c.id !== PLAYER && !countryDead(c.id);
    if (canDiplo && !wars.length) {
      var pk = pactOf(PLAYER, c.id);
      var pkCd = Math.max(0,
        (DIPCD[cdKey(PLAYER, c.id, 'ally')] || 0) - turnNo,
        (DIPCD[cdKey(PLAYER, c.id, 'nap')] || 0) - turnNo);
      if (pk === 'ally') {
        h += '<button type="button" class="warbtn pact" data-break="ally" title="' +
          escHtml('撕毁同盟：关系 −' + Math.abs(AO.DIPLO.rel.breakAlly) + '，战报记一条「背信」') +
          '">毁约 · 同盟</button>';
      } else if (pk === 'nap') {
        h += '<button type="button" class="warbtn pact" data-break="nap" title="' +
          escHtml('作废互不侵犯：关系 ' + AO.DIPLO.rel.napEnd) + '">毁约 · 互不侵犯</button>' +
          pactBtnHtml(c.id, 'ally');
      } else {
        h += pactBtnHtml(c.id, 'ally') + pactBtnHtml(c.id, 'nap');
        if (pkCd > 0) h += '<em class="none">刚被拒：还要等 ' + pkCd + ' 回合</em>';
      }
      /* 宣战（v18.5）：入口**搬到对方的卡上** —— 点谁打谁，目标就是这张卡的国家。
       * 原来那排"宣战 · 邻国"长在自家卡上，入口和目标分了家：邻国一多，
       * 得先认"哪块地是谁的"再回自己卡里找钮。declareWar 一行没动，
       * 傀儡/属国/已交战/毁约背信那些硬闸全在函数里，这里只搬 UI。
       * 置灰矩阵与原来那排一字不差，**包括"必须陆上接壤"** ——
       * declareWar 本身不查相邻，以前全靠 UI 挡"隔空宣战"，这层闸不能弄丢。 */
      var pkD = pactOf(PLAYER, c.id);
      var suzMe2 = suzerainOf(PLAYER);
      var isVasC = suzerainOf(c.id) === PLAYER;
      var adjC = ((coOf(PLAYER) || {}).neighbors || []).indexOf(c.id) >= 0;
      var offD = !!suzMe2 || !!pkD || isVasC || !adjC;
      h += '<button type="button" class="warbtn" data-declare="' + c.id + '"' +
        (offD ? ' disabled' : '') + ' title="' +
        escHtml(suzMe2 ? ('听命于宗主 ' + nameOf(suzMe2) + '：傀儡不能自行宣战')
          : isVasC ? (c.name + ' 是你的属国：要收地走「强并入」，不能宣战自己的属国')
          : pkD ? ('与 ' + c.name + ' 有' + pactCn(pkD) + '：先毁约才能宣战')
          : !adjC ? '不相邻：跨海的敌国要等舰队'
          : '向 ' + c.name + ' 宣战：宣战后双方军队才会交战、才能占领对方省份') +
        '">宣战</button>';
    }
    if (!wars.length) {
      /* 自家卡上不再列邻国（v18.5）：入口在对方的卡上，这里只留一句指路。
       * 「四周皆海」那句也随之消失 —— 不相邻现在由对方卡上那枚钮的置灰态解释。 */
      if (mine && PLAYER) {
        h += '<em class="none">宣战：点对方国土，在它的国家卡上宣</em>';
      } else if (!canDiplo) {
        h += '<em class="none">宣战只能由玩家国发起</em>';
      }
    } else {
      for (i = 0; i < wars.length; i++) {
        var wc2 = coOf(wars[i]);
        if (!wc2) continue;
        var foe = (wars[i] === PLAYER) ? c.id : wars[i];
        var withPlayer = !!PLAYER && (wars[i] === PLAYER || c.id === PLAYER);
        if (withPlayer) {
          /* 求和（v9）：谈判桌就是"想停又没到投降线"的那扇门。
           * 白和 = 原来的停战（现状承认），赔款要战争分领先。
           * 工坊模式（没选国）没有谈判桌，下面那排「停战」保留。 */
          var left2 = talkCdLeft(foe);
          h += '<button type="button" class="warbtn talk" data-talk="' + foe + '"' +
            (left2 > 0 ? ' disabled' : '') + ' title="' + escHtml(left2 > 0
              ? '对方刚拒过一次：还要等 ' + left2 + ' 回合'
              : '开谈判桌：白和（现状承认）/ 赔款 ' + AO.DIPLO.talk.payTiers.join(' / ') +
                ' 金（要战争分领先 ' + AO.DIPLO.talk.payLead + '）') +
            '">求和 · ' + escHtml(wc2.name) + '</button>';
        } else {
          h += '<button type="button" class="warbtn peace" data-peace="' + wars[i] + '"' +
            (mine ? '' : ' disabled') + ' title="' +
            escHtml(mine ? ('与 ' + wc2.name + ' 停战：围城解除、封锁解除，已占领的省不归还')
              : lockTitle()) + '">停战 · ' + escHtml(wc2.name) + '</button>';
        }
      }
    }
    h += '</div>';
    /* 属国的归属（v13）：两个钮，一条快一条慢。
     * 「和平并入」要满 60 回合 + 它民心 ≥55 + 最近没被拖着打仗，掷 60%；
     * 「强并入」随时能按 —— 但宗主全国民心 −8、并入各省不安 +30。
     * 这一排只出现在**自己的卡**上（mine）：受表是宗主的事，打工仔看不见这两个钮。 */
    if (mine && vsOf.length) {
      h += '<div class="diplobtns">';
      for (i = 0; i < vsOf.length; i++) {
        var rd = puppetAnnexReady(c.id, vsOf[i]);
        var vn3 = nameOf(vsOf[i]);
        var tipP = rd.ok
          ? '和平并入：省全归你并且直接算正式国土（不整合）· 它掷 ' +
            Math.round((P13.annexAccept || 0.6) * 100) + '% 答应'
          : '还不能提：' + rd.why;
        h += '<button type="button" class="warbtn pact" data-annex="' + vsOf[i] + '"' +
          (rd.ok ? '' : ' disabled') + ' title="' + escHtml(tipP) + '">和平并入 · ' + escHtml(vn3) + '</button>';
        h += '<button type="button" class="warbtn" data-force="' + vsOf[i] + '" title="' +
          escHtml('强并入：立刻吞掉它（省直接是正式国土），代价是全国民心 −' + (P13.forceHappy || 8) +
            '、并入各省不安 +' + (P13.forceUnrest || 30)) +
          '">强并入 · ' + escHtml(vn3) + '</button>';
      }
      h += '</div>';
    }
    /* 玩家国自己的卡上给一个"去军务"的入口 —— 宣战之后下一步一定是下命令 */
    if (mine) h += '<button class="gopen" type="button" id="cGoWar">打开军务面板 →</button>';
    box.innerHTML = h;
    var gw = $('cGoWar');
    if (gw) gw.addEventListener('click', function () { openWarPanel(c.id); });
    /* 并入的两个钮（v13）：都是"我的国 × 属国"，所以结果重画的是**我的卡** */
    var ans = box.querySelectorAll('button[data-annex]');
    for (i = 0; i < ans.length; i++) {
      ans[i].addEventListener('click', function () {
        var r = tryAnnexPuppet(c.id, +this.getAttribute('data-annex'));
        toast(r.msg, 3600);
        refreshAfterAnnex(c.id);
      });
    }
    var fns = box.querySelectorAll('button[data-force]');
    for (i = 0; i < fns.length; i++) {
      fns[i].addEventListener('click', function () {
        var r = forceAnnexPuppet(c.id, +this.getAttribute('data-force'));
        toast(r.msg, 3600);
        refreshAfterAnnex(c.id);
      });
    }
    /* 宣战（v18.5）：钮在这张卡上，出手的永远是玩家 —— declareWar(PLAYER, 这张卡) */
    var ds = box.querySelectorAll('button[data-declare]');
    for (i = 0; i < ds.length; i++) {
      ds[i].addEventListener('click', function () {
        var r = declareWar(PLAYER, c.id);
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
    /* 缔约 / 毁约 / 求和（v9）。三个都以 PLAYER 身份出手，
     * 所以重画的是**这张卡**（c.id），不是 PLAYER 的卡。 */
    var pks = box.querySelectorAll('button[data-pact]');
    for (i = 0; i < pks.length; i++) {
      pks[i].addEventListener('click', function () {
        var r = proposePact(PLAYER, c.id, this.getAttribute('data-pact'));
        toast(r.msg, 3400);
        showCountry(c.id);
      });
    }
    var bks = box.querySelectorAll('button[data-break]');
    for (i = 0; i < bks.length; i++) {
      bks[i].addEventListener('click', function () {
        var r = breakPact(PLAYER, c.id, this.getAttribute('data-break'));
        toast(r.msg, 3400);
        showCountry(c.id);
      });
    }
    var tks = box.querySelectorAll('button[data-talk]');
    for (i = 0; i < tks.length; i++) {
      tks[i].addEventListener('click', function () {
        openTalk(+this.getAttribute('data-talk'));
      });
    }
    box.title = '外交：宣战之后两国军队才会交战、才能占领对方省份；\n' +
      '剩省降到投降线以下就全境并入对方（群龙无首时线放宽）。\n' +
      'v9：关系值决定能不能缔约（同盟 ≥' + AO.DIPLO.ally.need + ' / 互不侵犯 ≥' +
      AO.DIPLO.nap.need + '），同盟与互不侵犯都禁止互宣；\n' +
      '「求和」开谈判桌 —— 白和永远可选，赔款要战争分领先 ' + AO.DIPLO.talk.payLead + '。\n' +
      'v13：领先 ' + AO.DIPLO.puppet.talkLead + ' 还能扶植傀儡（不割地、收租）；' +
      '傀儡上贡中央金入的 ' + Math.round(AO.DIPLO.puppet.tribute * 100) + '%，兵随宗主，外交不得自专。';
  }

  /* 并入之后的收尾：版图变了（省易主、首都可能丢、INTEG 删了），
   * 所以底图要重烘、面板要重画 —— 这三件事在占领里已经做过一次，
   * 但那是"逐省"的，这里补上"整国"那一层（首都表、维修红点、国家卡）。 */
  function refreshAfterAnnex(cid) {
    if (typeof refreshRepBadge === 'function') refreshRepBadge();
    if (state.renderer) {
      state.renderer.fogRefresh();
      state.renderer.requestDraw();
    }
    if ($('country').classList.contains('on')) showCountry(cid);
    if (GP.open) renderGovPanel();
    saveGame(true);
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
        '<i>（' + G.goldPerUnit[rate] + ' 金 + ' + G.ironPer2M[rate] + ' 铁 / ' +
          G.popCn() + '）</i></em></div>' +
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
      /* 物价（v14）：国库总览加一列迷你价板 —— 现价 + 箭头。
       * 放在"库存"和"净流"之间，读法是"这类东西我还有多少、值多少、在涨还是在跌"。 */
      var pvv = priceV(c.id, r.key), ptr = priceTrend(c.id, r.key);
      var pcls = ptr > 0 ? ' up' : ptr < 0 ? ' down' : '';
      html += '<div class="trrow"><span class="nm">' + (r.prod || r.cn) + '</span>' +
        '<b>' + Math.round(cen[r.key] || 0) + '</b>' +
        '<i class="pi' + pcls + '">' + priceNum(pvv) + priceArrow(ptr) + '</i>' +
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
    applyCountryTab();          // 概览 / 内政 / 外交：只切容器类名，下面的渲染照旧

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
    /* 承载（v18.2）：总人口取**活的** POP 表 —— c.population 是开局的静态数，
     * 而人口每回合都在涨落；总上限把各省现算的承载力加起来（同一份公式，
     * 省卡上写多少、这里就加多少，不会两处对不上）。 */
    var capEl = $('cPopCap');
    if (capEl) {
      var tPop = 0, tCap = 0, fullN = 0, overN = 0, pi, q2;
      for (pi = 0; pi < c.provinces.length; pi++) {
        q2 = w.provinces[c.provinces[pi] - 1];
        if (!q2) continue;
        var pv2 = POP[q2.id] ? POP[q2.id].v : (q2.population || 0);
        var cv2 = popCapOf(q2.id);
        tPop += pv2; tCap += cv2;
        if (cv2 > 0 && pv2 > cv2) overN++;
        else if (cv2 > 0 && pv2 >= cv2) fullN++;
      }
      var ld = tCap > 0 ? Math.round(tPop / tCap * 100) : 0;
      capEl.innerHTML = AO.formatPop(Math.round(tPop)) + ' / ' + AO.formatPop(Math.round(tCap)) +
        (overN ? ' <b style="color:#b5563f">' + overN + ' 省溢出</b>'
          : fullN ? ' <em style="color:#4f9d78">' + fullN + ' 省满员</em>' : '');
      capEl.title = '总人口 ' + Math.round(tPop).toLocaleString() + ' 人 / 总承载力 ' +
        Math.round(tCap).toLocaleString() + ' 人（负载 ' + ld + '%）' +
        '\n满员 ' + fullN + ' 省 · 人满为患 ' + overN + ' 省' +
        '\n每省上限 = （地形基础 × 首都 ' + AO.POPCAP.capMul + ' ＋ 农场/渔港/粮仓/牧场加成）' +
        ' × 铁犁深耕 ' + AO.POPCAP.plowMul +
        '\n到顶就不再涨（人丁兴旺）；溢出的每回合 −' +
        Math.round(AO.POPCAP.overRate * 100) + '% 往回落，并扣民心 ' + AO.POPCAP.overHappy;
    }
    $('cArea').textContent = c.areaKm2.toLocaleString() + ' km²';
    var cap = w.provinces[c.capital - 1];
    $('cCapital').textContent = cap ? cap.name : '—';
    $('cProv').textContent = c.provinces.length + ' 个';
    /* 安定（A 批）：几省在骚动 / 几省随时爆发。数字小但信息量大 ——
     * 一个国"3 省骚动"意味着它正在失血（产出打折、税收不上来）。 */
    var cu = $('cUnrest');
    if (cu) {
      var U = AO.UNREST, riot = 0, hot = 0, i2;
      for (i2 = 0; i2 < c.provinces.length; i2++) {
        var vv = unrestOf(c.provinces[i2]).v;
        if (vv >= U.revoltAt) hot++;
        else if (vv >= U.riotLine) riot++;
      }
      cu.innerHTML = (hot ? '<b style="color:#a8523b">' + hot + ' 省叛乱在即</b>　' : '') +
        (riot ? '<b style="color:#8a6d34">' + riot + ' 省骚动</b>' : (hot ? '' : '太平'));
      cu.title = '不安 ≥' + U.riotLine + ' = 骚动（再往上就该安抚、派官或驻军了）；≥' + U.revoltAt +
        ' = 每回合 ' + Math.round(U.revoltChance * 100) + '% 爆发叛乱（匪乱 / 倒戈 / 独立）';
    }

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

  /* =============================================================
   * 二、军工产线（MILL v19）—— **全国三池 + 19 条产线 + 订单制 + 武库**
   *
   * 四张状态表（都要进档，但**不升 SAVE_VER**：读旧档缺什么补什么）：
   *   MILLS[owner]   = { alloc:{线:点}, prog:{线:进度}, form:{类型:形制}, acc:{池:零头}, wait:{线:1} }
   *   ARSENAL[owner] = { wpn:{'代|类型|形制|品质':份}, mount:{'品种|品质':份}, gun:{'代|品质':门}, ship:{舰键:艘} }
   *   EQUIPS[owner]  = { helm:{plain,good,fine,rare}, chest:…, boots:… }   （队份，内部 1 份）
   *   ARTISANS[owner]= { pool:[匠人], post:{pid:匠人} }
   *
   * 三条账要分清：
   *   池容量  每回合按"Σ每省(座数 × 基准 × 工厂 × 匠人)"算出来的**可用点数**（三池各自封顶）
   *   工作量  每条线出一单要几点（兵刃/装备/马 5 · 炮 2 · 舰 1~4）
   *   进度    prog = **当前这一单已经攒了多少点**（不是"零头"，是订单进度）
   *
   * 为什么口径从"每省"抬到"全国"（v19）：玩家要回答的是"这回合全国这几点产能
   * 打刀还是浇炮"，逐省分配时同一个问题要回答 20 遍，而答案往往一样。
   * 省里只保留一个数：**本省产能贡献 N 点**。
   * ============================================================= */
  var MILLS = Object.create(null);     // owner -> 全国分配 / 进度 / 形制
  var ARSENAL = Object.create(null);   // owner -> 武库（兵刃 / 马 / 炮 / 舰）
  var EQUIPS = Object.create(null);    // owner -> 盔甲靴三槽（队份，按品质分档）
  var ARTISANS = Object.create(null);  // owner -> { pool, post }
  var ARTISAN_ID = 1;

  /* 三个池对应的坊（顺序就是面板上的段序） */
  var MILL_POOLS = ['arm', 'hor', 'syd'];
  var MILL_KINDS = ['armory', 'stable', 'shipyard'];

  function newMill() {
    var m = {
      alloc: Object.create(null),
      prog: Object.create(null),
      wait: Object.create(null),
      acc: { arm: 0, hor: 0, syd: 0 },
      /* 兵刃五类型各自的**形制**（默认平平无奇）。品种就是线本身，不用另存。 */
      form: { dao: 'plain', fu: 'plain', gong: 'plain', qiang: 'plain' }
    };
    var M = AO.MILL, i, j;
    for (i = 0; i < MILL_POOLS.length; i++) {
      var lines = M.lines[MILL_POOLS[i]];
      for (j = 0; j < lines.length; j++) { m.alloc[lines[j]] = 0; m.prog[lines[j]] = 0; }
    }
    return m;
  }
  function millOf(owner) {
    owner = owner | 0;
    var m = MILLS[owner];
    if (!m) m = MILLS[owner] = newMill();
    if (!m.alloc) m.alloc = Object.create(null);
    if (!m.prog) m.prog = Object.create(null);
    if (!m.wait) m.wait = Object.create(null);
    if (!m.acc) m.acc = { arm: 0, hor: 0, syd: 0 };
    if (!m.form) m.form = { dao: 'plain', fu: 'plain', gong: 'plain', qiang: 'plain' };
    var M = AO.MILL, i, j;
    for (i = 0; i < MILL_POOLS.length; i++) {
      var lines = M.lines[MILL_POOLS[i]];
      for (j = 0; j < lines.length; j++) {
        var l = lines[j];
        if (typeof m.alloc[l] !== 'number' || !isFinite(m.alloc[l])) m.alloc[l] = 0;
        if (typeof m.prog[l] !== 'number' || !isFinite(m.prog[l])) m.prog[l] = 0;
      }
      if (typeof m.acc[MILL_POOLS[i]] !== 'number' || !isFinite(m.acc[MILL_POOLS[i]])) {
        m.acc[MILL_POOLS[i]] = 0;
      }
    }
    return m;
  }
  /* 一国已研成的科技（军工批的三条判定全走这里，不另建缓存） */
  function hasTech(owner, key) {
    var R = RESEARCH[owner];
    return !!(R && R.done && R.done[key]);
  }
  /* 一国研到工艺链第几档（0 = 只有皮革） */
  function craftIdxOf(owner) {
    var R = RESEARCH[owner];
    /* craftIdx 返回的就是 CRAFT.order 的下标（-1 = 只有皮革）；
     * v19 这里多加了 1，面板会把"铁器"写成"火器"—— 一次 off-by-one。 */
    return Math.max(0, AO.craftIdx(R && R.done));
  }
  /* 时代加成：精密 / 工业 各 +15%（全兵种三维） */
  function craftMulOf(owner) {
    var R = RESEARCH[owner];
    return AO.craftMul(R && R.done);
  }

  /* ---------------- 工匠 ---------------- */
  function artisanPoolOf(owner) {
    var A = ARTISANS[owner];
    if (!A) A = ARTISANS[owner] = { pool: [], post: {} };
    if (!A.pool) A.pool = [];
    if (!A.post) A.post = {};
    return A;
  }
  function artisanOf(pid) {
    var p = pOf(pid);
    if (!p || !p.owner) return null;
    return artisanPoolOf(p.owner).post[pid | 0] || null;
  }
  function artisanLv(a) {
    var L = AO.ARTISAN.lv;
    return L[AO.clamp((a && a.lv) | 0, 0, L.length - 1)];
  }
  /* 这一省的匠人加成（三坊共享）：没有匠人 → 0 */
  function artisanBonus(pid) {
    var a = artisanOf(pid);
    return a ? artisanLv(a).bonus : 0;
  }
  /* 全国最高那一位匠人的等级（-1 = 一个都没有）。品质 roll 看它 ——
   * "大师要驻在产能大省"：产能加成按驻场省算，品质只认全国最高的那一位。 */
  function bestArtisanLv(owner) {
    var A = ARTISANS[owner | 0], best = -1, k;
    if (!A || !A.post) return -1;
    for (k in A.post) {
      var a = A.post[k];
      if (a && (a.lv | 0) > best) best = a.lv | 0;
    }
    return best;
  }
  /* 开局/读档都要保证 id 不撞（撞了"派驻/撤回"会认错人） */
  function usedArtisanNames() {
    var set = Object.create(null), k, i;
    for (k in ARTISANS) {
      var A = ARTISANS[k];
      if (!A) continue;
      for (i = 0; i < (A.pool || []).length; i++) if (A.pool[i]) set[A.pool[i].name] = 1;
      for (var pk in (A.post || {})) if (A.post[pk]) set[A.post[pk].name] = 1;
    }
    return set;
  }
  function pickArtisanName() {
    var N = AO.OFF_NAMES, used = usedArtisanNames(), t, nm, i;
    /* 和文官/武将共用一个名字池，并且互相避开 —— 一国里两个"王守仁"很出戏 */
    var off = usedOffNames(), gen = usedGenNames(), k;
    for (k in off) used[k] = 1;
    for (k in gen) used[k] = 1;
    function rnd() {
      return N.surnames[(Math.random() * N.surnames.length) | 0] +
        N.givens[(Math.random() * N.givens.length) | 0];
    }
    for (t = 0; t < 60; t++) {
      nm = rnd();
      if (!used[nm]) return nm;
    }
    var tail = ['匠', '工', '师傅'], n = 2;
    for (i = 0; i < tail.length; i++) if (!used[nm + tail[i]]) return nm + tail[i];
    while (used[nm + n]) n++;
    return nm + n;
  }
  function rollArtisanLv() {
    var L = AO.ARTISAN.lv, total = 0, i, r;
    for (i = 0; i < L.length; i++) total += L[i].w || 0;
    r = Math.random() * total;
    for (i = 0; i < L.length; i++) {
      r -= L[i].w || 0;
      if (r <= 0) return i;
    }
    return L.length - 1;
  }
  /* 开工科：和文/武共用人才点、同一次消耗，区别只是抽的池子不同 */
  function examArtisan(owner, silent) {
    var G = AO.GOV, T = talentOf(owner);
    var cost = AO.ARTISAN.examCost || G.examCost;
    if (!silent && !canAct(owner)) return { ok: false, msg: lockTitle() };
    if (T.pts < cost) {
      return { ok: false, msg: '人才点不够：开工科要 ' + cost + '，现在只有 ' + fmtPts(T.pts) +
        '（学校每座 +' + G.talentPerSchool + ' / 回合）' };
    }
    T.pts -= cost;
    var lv = rollArtisanLv();
    var a = { id: ARTISAN_ID++, name: pickArtisanName(), lv: lv, pid: 0 };
    artisanPoolOf(owner).pool.push(a);
    if (!silent) {
      var L = artisanLv(a);
      NOTES.push({ owner: +owner, cls: lv >= 2 ? 'ok' : '',
        text: '工科放榜：' + a.name + ' —— 「' + L.cn + '」' + L.desc + '（派驻有坊的省才生效）' });
    }
    return { ok: true, artisan: a, lv: AO.ARTISAN.lv[lv] };
  }
  /* 这一省能不能驻匠：得有（建成的）军械坊 / 驯马场 / 造船厂 */
  function artisanSpot(pid) {
    for (var i = 0; i < MILL_KINDS.length; i++) {
      var st = UNIV[MILL_KINDS[i]][pid | 0];
      if (st && st.n > 0) return MILL_KINDS[i];
    }
    return null;
  }
  /* 派驻：一省一匠。原来那位自动回池（免费，随时换）。 */
  function postArtisan(pid, aid, silent) {
    var p = pOf(pid);
    if (!p) return { ok: false, msg: '没有这个省' };
    if (!silent && !canAct(p.owner)) return { ok: false, msg: lockTitle() };
    if (!artisanSpot(pid)) return { ok: false, msg: '这个省没有军械坊 / 驯马场 / 造船厂 —— 匠人去了没活干' };
    var A = artisanPoolOf(p.owner), idx = -1, i;
    for (i = 0; i < A.pool.length; i++) if (A.pool[i] && A.pool[i].id === aid) { idx = i; break; }
    if (idx < 0) return { ok: false, msg: '这位匠人不在候选池里（可能已经驻场了）' };
    var cur = A.post[pid | 0] || null;
    if (cur) { cur.pid = 0; A.pool.push(cur); }
    var a = A.pool.splice(idx, 1)[0];
    a.pid = pid | 0;
    A.post[pid | 0] = a;
    return { ok: true, artisan: a, replaced: cur };
  }
  function unpostArtisan(pid, silent) {
    var p = pOf(pid);
    if (!p || !p.owner) return null;
    if (!silent && !canAct(p.owner)) return null;
    var A = artisanPoolOf(p.owner), a = A.post[pid | 0];
    if (!a) return null;
    delete A.post[pid | 0];
    a.pid = 0;
    A.pool.push(a);
    return a;
  }
  /* 匠人俸禄（金/回合，从省库发，和官员同一条链）。缺钱就欠着不罚。 */
  function settleArtisans(owner) {
    var A = ARTISANS[owner];
    if (!A || !A.post) return;
    for (var pid in A.post) {
      var a = A.post[pid];
      if (!a) continue;
      var pay = artisanLv(a).pay || 0;
      if (!(pay > 0)) continue;
      var bag = SIM[pid];
      if (!bag || !bag.gold) continue;
      var take = Math.min(bag.gold.stock, pay);
      bag.gold.stock -= take;
      var F = FLOW[pid];
      if (F) {
        F.loss.gold = (F.loss.gold || 0) + take;
        F.d.ind = (F.d.ind || 0) + take;
        F.d.wage = (F.d.wage || 0) + take;
      }
    }
  }

  /* 本省军工产能的乘数：有一座**不停产**的工厂就 ×2，否则 ×1。
   * 抽成函数是为了「结算的实际产能」和「面板上写的 ×2」读同一个数。 */
  function armProdMul(pid) {
    var fb = FACTORY_BLD[pid];
    return (fb && fb.n > 0 && !fb.halted) ? (AO.FACTORY.factory.prodMul || 2) : 1;
  }
  AO.resArmProdMul = armProdMul;

  /* ---------------- 产能（三池，全国口径） ---------------- */
  /* 一省对某个池的**原始**产能（可能是小数，零头在结算里攒） */
  function provCapRaw(pid, kind) {
    var st = UNIV[kind][pid | 0];
    if (!st || !(st.n > 0) || st.halted) return 0;
    var p = pOf(pid);
    if (!p) return 0;
    var M = AO.MILL, n = st.n * (M.base[kind] || 1);
    /* 「制式装备」：军械坊每座 +1 点 */
    if (kind === 'armory' && hasTech(p.owner, 'mil_std')) n += st.n * (M.stdBonus.armory || 0);
    n *= armProdMul(pid);              // 工厂 ×2（停产则 ×1）
    n *= 1 + artisanBonus(pid);        // 匠人 +0/10/20/40%
    return n;
  }
  /* 一省这回合的产能（面板用整数）—— 省卡只显这个数 */
  function millCap(pid, kind) { return Math.floor(provCapRaw(pid, kind)); }
  /* 池键 / 坊键都能收：'arm' 与 'armory' 指的是同一口锅（面板两边都写） */
  function poolKeyOf(x) {
    var M = AO.MILL;
    if (M.poolBld[x]) return x;
    if (M.poolOf[x]) return M.poolOf[x];
    return x;
  }
  /* 全国某个池的原始容量 */
  function poolCapRaw(owner, pool) {
    var M = AO.MILL, kind = M.poolBld[poolKeyOf(pool)], c = coOf(owner | 0);
    if (!c) return 0;
    var n = 0, list = c.provinces || [];
    for (var i = 0; i < list.length; i++) n += provCapRaw(list[i], kind);
    return n;
  }
  /* 面板 / 结算读的整数容量（零头存在 acc[pool]） */
  function poolCap(owner, pool) {
    var m = millOf(owner), pk = poolKeyOf(pool);
    return Math.floor(poolCapRaw(owner, pk) + (m.acc[pk] || 0));
  }
  function poolOfLine(line) {
    var M = AO.MILL;
    for (var i = 0; i < MILL_POOLS.length; i++) {
      if (M.lines[MILL_POOLS[i]].indexOf(line) >= 0) return MILL_POOLS[i];
    }
    return '';
  }
  /* 这条线的工作量（「量产工艺」把兵刃线 5 → 4） */
  function lineWork(owner, line) {
    var M = AO.MILL, w = M.work[line] || 1;
    if (M.kindOf[line] === 'blade' && hasTech(owner, 'mil_massline')) w = M.massWork;
    return w;
  }
  function allocSum(owner, pool) {
    var M = AO.MILL, lines = M.lines[pool], m = millOf(owner), s = 0, i;
    for (i = 0; i < lines.length; i++) s += Math.max(0, m.alloc[lines[i]] | 0);
    return s;
  }
  /* 一条线的状态：分配 / 进度 / 工作量 / 是否卡料 / 还剩几回合 */
  function lineStatus(owner, line) {
    var m = millOf(owner), work = lineWork(owner, line);
    var alloc = Math.max(0, m.alloc[line] | 0);
    var prog = Math.min(work, m.prog[line] || 0);
    var left = Math.max(0, work - prog);
    var turns = alloc > 0 ? Math.ceil(left / alloc) : null;
    return {
      line: line, pool: poolOfLine(line), kind: AO.MILL.kindOf[line],
      work: work, alloc: alloc, prog: prog, wait: !!m.wait[line],
      left: left, turns: turns,
      full: alloc >= work,
      done: prog >= work
    };
  }
  /* 设一条线的分配点数。**溢出无效**：超过工作量就封顶（返回 clamped）。
   * 池子合计也不能超容量 —— 超了就把这条线压到"池里还剩下的点"。 */
  function setLineAlloc(owner, line, pts, silent) {
    owner = owner | 0;
    if (!silent && !canAct(owner)) return { ok: false, msg: lockTitle(), pts: 0 };
    var M = AO.MILL;
    if (!M.kindOf[line]) return { ok: false, msg: '没有这条产线', pts: 0 };
    var pool = poolOfLine(line), m = millOf(owner);
    var work = lineWork(owner, line), cap = poolCap(owner, pool);
    var others = allocSum(owner, pool) - Math.max(0, m.alloc[line] | 0);
    var max = Math.min(work, Math.max(0, cap - others));
    var want = Math.round(pts | 0);
    if (want < 0) want = 0;
    var clamped = false;
    if (want > max) { want = max; clamped = true; }
    m.alloc[line] = want;
    return { ok: true, pts: want, clamped: clamped, work: work, cap: cap,
      msg: (M.lineCn[line] || line) + ' ' + want + ' 点' + (clamped ? '（已封顶）' : '') };
  }
  /* 一条线 ±1 点（面板 ＋ / − 钮） */
  function bumpLine(owner, line, delta, silent) {
    var m = millOf(owner);
    return setLineAlloc(owner, line, Math.max(0, (m.alloc[line] | 0) + (delta | 0)), silent);
  }
  /* 形制（线内单选）：刀/斧/弓/枪 各一个，默认平平无奇 */
  function setLineForm(owner, line, formKey, silent) {
    owner = owner | 0;
    if (!silent && !canAct(owner)) return { ok: false, msg: lockTitle() };
    if (AO.MILL.kindOf[line] !== 'blade') return { ok: false, msg: '只有兵刃线有形制' };
    var F = AO.gearOf(AO.GEAR.forms, formKey);
    millOf(owner).form[line] = F.key;
    return { ok: true, form: F.key, msg: (AO.MILL.lineCn[line] || line) + ' · ' + F.cn };
  }

  /* ---------------- 武库（ARSENAL） ----------------
   * 队份 = 武装一个千人队（UI 写 ×1000，内部记 1 份）。
   * 兵刃按 '代|类型|形制|品质' 分格，马按 '品种|品质'，炮按 '代|品质'，舰按舰键。 */
  function arsOf(owner) {
    var A = ARSENAL[owner | 0];
    if (!A) A = ARSENAL[owner | 0] = { wpn: {}, mount: {}, gun: {}, ship: {} };
    if (!A.wpn) A.wpn = {};
    if (!A.mount) A.mount = {};
    if (!A.gun) A.gun = {};
    if (!A.ship) A.ship = {};
    return A;
  }
  function arsKey(kind, parts) { return parts.join('|'); }
  function arsAdd(owner, kind, key, n) {
    if (!n) return 0;
    var A = arsOf(owner);
    var v = (A[kind][key] | 0) + n;
    if (v <= 0) delete A[kind][key]; else A[kind][key] = v;
    return n;
  }
  function arsTake(owner, kind, key, n) {
    var A = arsOf(owner), have = A[kind][key] | 0;
    if (have < n) return false;
    A[kind][key] = have - n;
    if (A[kind][key] <= 0) delete A[kind][key];
    return true;
  }
  function arsTotal(owner, kind) {
    var A = arsOf(owner), n = 0, k;
    for (k in A[kind]) n += A[kind][k] | 0;
    return n;
  }
  /* 武库里**最高材质**的兵刃（同材质里挑品质最高的）。征兵 / AI 默认读它。 */
  function arsBestWeapon(owner) {
    var A = arsOf(owner), best = null, bestIdx = -1, bestQ = -1, k;
    for (k in A.wpn) {
      if (!(A.wpn[k] > 0)) continue;
      var p = k.split('|'), idx = AO.MIL_ORDER.indexOf(p[0]), qi = AO.GEAR.q.indexOf(p[3]);
      if (idx > bestIdx || (idx === bestIdx && qi > bestQ)) {
        bestIdx = idx; bestQ = qi;
        best = { tier: p[0], type: p[1], form: p[2], q: p[3], n: A.wpn[k] };
      }
    }
    return best;
  }
  /* 工艺链决定的"能造什么材质"—— 兵刃线**产什么材质**读它。
   * 为什么不读库存：库存里那批是**上一单**的产物，用它当产线目标会永远
   * 停在旧材质上（研了新工艺也不换代）。 */
  function craftWeapon(owner) {
    var list = unlockedItems(owner, 'weapon');
    return list.length ? list[list.length - 1] : AO.MIL_ITEM.leather;
  }
  /* 一国当前"最高材质"的军械（**库存最高材质**，任务书第七节）。
   * 征兵 / 民兵 / AI 读它；库存为空时退回工艺链那一档。 */
  function bestMaterial(owner) {
    var bw = arsBestWeapon(owner);
    if (bw && AO.MIL_ITEM[bw.tier]) return AO.MIL_ITEM[bw.tier];
    return craftWeapon(owner);
  }
  /* 旧名保留：任务书第八节把 bestWeapon 改成 bestMaterial，但外部脚本还在用旧名 */
  function bestWeapon(owner) { return bestMaterial(owner); }
  /* 武库一行一行读出来（面板用）：按"代新→旧、品质高→低"排 */
  function arsRows(owner, kind) {
    var A = arsOf(owner), out = [], k, i;
    var Q = AO.GEAR.q;
    for (k in A[kind]) {
      var n = A[kind][k] | 0;
      if (!(n > 0)) continue;
      var p = k.split('|'), row = { key: k, n: n, parts: p };
      if (kind === 'wpn') {
        var it = AO.MIL_ITEM[p[0]] || AO.MIL_ITEM.leather;
        row.tier = p[0]; row.type = p[1]; row.form = p[2]; row.q = p[3];
        row.cn = it.cn + ' · ' + typeCnOf({ type: p[1], tier: p[0] }) + ' · ' +
          AO.gearOf(AO.GEAR.forms, p[2]).cn;
        row.color = it.color || '#888';
        row.icon = wpnIcon(p[1], p[0]);
        row.ord = (AO.MIL_ORDER.indexOf(p[0]) * 10) + Q.indexOf(p[3]);
      } else if (kind === 'mount') {
        row.breed = p[0]; row.q = p[1];
        row.cn = AO.gearOf(AO.GEAR.breeds, p[0]).cn;
        row.ord = (AO.GEAR.breeds.findIndex(function (b) { return b.key === p[0]; }) * 10) + Q.indexOf(p[1]);
      } else if (kind === 'gun') {
        var gi = AO.MIL_ITEM[p[0]] || {};
        row.tier = p[0]; row.q = p[1];
        row.cn = (gi.cn || p[0]);
        row.ord = (AO.GUN_ORDER.indexOf(p[0]) * 10) + Q.indexOf(p[1]);
      } else {
        var si = AO.MIL_ITEM[p[0]] || {};
        row.cn = si.cn || p[0];
        row.ord = AO.SHIP_ORDER.indexOf(p[0]);
      }
      out.push(row);
    }
    out.sort(function (a, b) { return b.ord - a.ord; });
    return out;
  }
  /* 武库里的"最优一份"：给一键配齐 / AI 用（同代里挑品质最高、词条最优） */
  function arsBest(owner, kind) {
    var rows = arsRows(owner, kind);
    return rows.length ? rows[0] : null;
  }

  /* ---------------- 二b、装备袋（盔甲靴） ----------------
   * 装备是**资产**：打造一次，永久叠在那支部队身上（不像兵刃会被换掉回库）。 */
  function equipOf(owner) {
    var e = EQUIPS[owner];
    if (!e) e = EQUIPS[owner] = {};
    for (var i = 0; i < AO.EQUIP.slots.length; i++) {
      var s = AO.EQUIP.slots[i];
      if (!e[s]) e[s] = { plain: 0, good: 0, fine: 0, rare: 0 };
      for (var q = 0; q < AO.EQUIP.q.length; q++) {
        var k = AO.EQUIP.q[q];
        if (typeof e[s][k] !== 'number' || !isFinite(e[s][k])) e[s][k] = 0;
      }
    }
    return e;
  }
  function equipStockOf(owner, slot) {
    var e = equipOf(owner)[slot], n = 0;
    if (!e) return 0;
    for (var i = 0; i < AO.EQUIP.q.length; i++) n += e[AO.EQUIP.q[i]] || 0;
    return n;
  }
  function equipTotal(owner) {
    var n = 0;
    for (var i = 0; i < AO.EQUIP.slots.length; i++) n += equipStockOf(owner, AO.EQUIP.slots[i]);
    return n;
  }
  /* 一国当前的装备材质（按工艺链爬到哪一档） */
  function matOf(owner) {
    var M = AO.EQUIP.mat, idx = 0;
    for (var i = 0; i < M.length; i++) {
      if (!M[i].tech || hasTech(owner, M[i].tech)) idx = i;
    }
    return M[idx];
  }
  function matIdxOf(owner) {
    var M = AO.EQUIP.mat, idx = 0;
    for (var i = 0; i < M.length; i++) if (!M[i].tech || hasTech(owner, M[i].tech)) idx = i;
    return idx;
  }
  /* 品质 roll：看**全国最高**那位匠人（没有匠人就按学徒档），
   * 「淬火工艺」再上移一档。整队同品质 —— 一单只 roll 一次。 */
  function rollQuality(owner) {
    var A = AO.ARTISAN;
    var idx = bestArtisanLv(owner);
    if (idx < 0) idx = 0;
    if (hasTech(owner, 'mil_quench')) idx++;
    idx = AO.clamp(idx, 0, A.roll.length - 1);
    var w = A.roll[idx], total = 0, i, r;
    for (i = 0; i < w.length; i++) total += w[i];
    r = Math.random() * total;
    for (i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return AO.EQUIP.q[i];
    }
    return 'plain';
  }
  /* 一件装备的加成：材质底 × 品质倍率 */
  function equipPieceBonus(owner, q) {
    return matOf(owner).base * (AO.EQUIP.qMul[q] || 1);
  }
  /* 一支部队的三件装备合计加成（加算：1 + Σ） */
  function equipMulOf(a) {
    if (!a || a.type === 'navy' || !a.equip) return 1;
    var sum = 0, E = AO.EQUIP;
    for (var i = 0; i < E.slots.length; i++) {
      var q = a.equip[E.slots[i]];
      if (!q) continue;
      sum += equipPieceBonus(a.owner, q);
    }
    return 1 + sum;
  }
  /* 配发一件（换下来的回库）。q 为空 = 卸下。 */
  function equipArmy(a, slot, q, silent) {
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle() };
    if (a.type === 'navy') return { ok: false, msg: '舰队不吃盔甲靴（船上没有列阵的地方）' };
    if (AO.EQUIP.slots.indexOf(slot) < 0) return { ok: false, msg: '没有这个槽' };
    if (!a.equip) a.equip = { helm: null, chest: null, boots: null };
    var inv = equipOf(a.owner), old = a.equip[slot] || null;
    if (q) {
      if (!inv[slot] || !(inv[slot][q] > 0)) {
        return { ok: false, msg: '武库里没有「' + AO.EQUIP.slotCn[slot] + ' · ' +
          AO.EQUIP.qCn[q] + '」了（先下产线）' };
      }
      inv[slot][q]--;
    }
    if (old) inv[slot][old]++;
    a.equip[slot] = q || null;
    return { ok: true, old: old, q: q || null };
  }
  /* 一键配齐：三槽各取库存里**最优**的一件（已有的更好就不动）。 */
  function equipAutoFit(a, silent) {
    if (!a) return { ok: false, msg: '没有这支军队', n: 0 };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle(), n: 0 };
    if (a.type === 'navy') return { ok: false, msg: '舰队不吃盔甲靴', n: 0 };
    if (!a.equip) a.equip = { helm: null, chest: null, boots: null };
    var E = AO.EQUIP, inv = equipOf(a.owner), n = 0, i, j;
    for (i = 0; i < E.slots.length; i++) {
      var slot = E.slots[i];
      var curRank = a.equip[slot] ? E.q.indexOf(a.equip[slot]) : -1;
      for (j = E.q.length - 1; j > curRank; j--) {
        var q = E.q[j];
        if (!(inv[slot][q] > 0)) continue;
        if (a.equip[slot]) inv[slot][a.equip[slot]]++;
        inv[slot][q]--;
        a.equip[slot] = q;
        n++;
        break;
      }
    }
    return { ok: true, n: n, msg: n ? ('配齐 ' + n + ' 件，战力 ×' + equipMulOf(a).toFixed(3)) : '已经是库存里最好的了' };
  }
  function equipClear(a) {
    if (!a || !a.equip) return 0;
    var inv = equipOf(a.owner), n = 0, i;
    for (i = 0; i < AO.EQUIP.slots.length; i++) {
      var slot = AO.EQUIP.slots[i], q = a.equip[slot];
      if (!q) continue;
      inv[slot][q]++;
      a.equip[slot] = null;
      n++;
    }
    return n;
  }
  /* 军队覆没：随军装备销毁（胜者不缴获） */
  function equipDestroy(a) {
    if (!a || !a.equip) return 0;
    var n = 0, i;
    for (i = 0; i < AO.EQUIP.slots.length; i++) if (a.equip[AO.EQUIP.slots[i]]) n++;
    a.equip = { helm: null, chest: null, boots: null };
    return n;
  }
  /* 换代回收（装备）：新材质研成的那一刻，旧库存折半回炉换铁。 */
  function equipRecycle(owner, why) {
    owner = owner | 0;
    var E = AO.EQUIP, inv = equipOf(owner), lost = 0, i, j;
    for (i = 0; i < E.slots.length; i++) {
      var slot = E.slots[i];
      for (j = 0; j < E.q.length; j++) {
        var q = E.q[j], n = inv[slot][q] | 0;
        if (n <= 0) continue;
        var keep = Math.ceil(n / 2);
        lost += n - keep;
        inv[slot][q] = keep;
      }
    }
    if (!lost) return 0;
    var iron = Math.floor(lost * (E.recycle.iron || 0));
    var cen = ensureCentral(owner);
    cen.iron = (cen.iron || 0) + iron;
    if (PLAYER && owner === PLAYER) {
      NOTES.push({ owner: PLAYER, cls: 'ok',
        text: (why || '新材质') + '：旧装备库存折半回炉（' + lost + ' 件 → ' + iron +
          ' 铁）。库存只剩一代，往后打的都按新材质算' });
    }
    return lost;
  }
  /* 换代回收（兵刃）：研出新工艺那一刻，**全国所有更低材质**的兵刃队份
   * 折半回炉，每份返 0.5 铁 —— 武器库存永远只有当前材质。
   * 发放不做选择题：玩家不用自己挑"哪些旧货不要了"，换代那一刻统一清。
   * 炮与舰不回收（拍板项：炮是重资产，舰是船台上的东西，换代了也还能用）。 */
  function gearRecycle(owner, why) {
    owner = owner | 0;
    var A = arsOf(owner), cur = craftWeapon(owner).key;
    var curIdx = AO.MIL_ORDER.indexOf(cur), lost = 0, k;
    var keys = Object.keys(A.wpn);
    for (var i = 0; i < keys.length; i++) {
      k = keys[i];
      var tier = k.split('|')[0];
      if (AO.MIL_ORDER.indexOf(tier) >= curIdx) continue;
      var n = A.wpn[k] | 0;
      if (n <= 0) continue;
      var keep = Math.ceil(n / 2);
      lost += n - keep;
      if (keep > 0) A.wpn[k] = keep; else delete A.wpn[k];
    }
    if (!lost) return 0;
    var iron = Math.floor(lost * (AO.EQUIP.recycle.iron || 0));
    var cen = ensureCentral(owner);
    cen.iron = (cen.iron || 0) + iron;
    var txt = '换代回收：' + (why || '新工艺') + ' 研成 —— 旧兵刃 ' + lost + ' 队份折半回炉 → 铁锭 ×' + iron +
      '（库存只留「' + (AO.MIL_ITEM[cur] || {}).cn + '」这一档材质）';
    WARLOG.unshift({ turn: turnNo, cls: 'ok', text: txt });
    if (PLAYER && owner === PLAYER) NOTES.push({ owner: PLAYER, cls: 'ok', text: txt });
    return lost;
  }

  /* ---------------- 三、军队的三维（装备决定兵种） ----------------
   * 招的全是步兵：兵种是武库里发装备发出来的 ——
   *   发了炮 = 炮兵（接触段打 5 折、攻城值最高）
   *   发了马 = 骑兵
   *   否则   = 步兵
   * 三维 = **类型基准 × 材质倍率 × 品质 × 形制词条** × 时代加成（占位）。
   * 类型是绝对基准（刀 1.00/0.80/2），材质是唯一的数值乘数（皮 1.0 → 火器 1.55），
   * 品质与形制是在这上面乘/加 —— 这就是"科技只卖材质、兵器全靠工匠打"。
   * 弓在**火器材质**下显示「铳」、射程 +1（同一件东西换名字与射程，不是新类型）。 */
  function unitOf(a) {
    var G = AO.GEAR;
    if (!a) return { atk: G.bare.atk, def: G.bare.def, mov: G.bare.mov, range: 0, siege: 0, pow: G.bare.atk };
    if (a.type === 'navy') {
      var sh = AO.MIL_ITEM[a.tier] || AO.MIL_ITEM.galley;
      return { atk: sh.pow, def: sh.pow, mov: 2, range: 1, siege: 0, pow: sh.pow };
    }
    var w = a.weapon, mt = a.mount, g = a.gun;
    var atk = G.bare.atk, def = G.bare.def, mov = G.bare.mov, range = 0, siege = 0;
    if (w) {
      var T = AO.gearOf(G.types, w.type), F = AO.gearOf(G.forms, w.form);
      var M = AO.MIL_ITEM[w.tier] || AO.MIL_ITEM.leather;
      var qm = G.qMul[w.q] || 1, mm = M.mul || 1;
      atk = T.atk * mm * qm * (1 + (F.atk || 0) / 100);
      def = T.def * mm * qm * (1 + (F.def || 0) / 100);
      mov = (T.mov || 2) + (F.mov || 0);
      range = (T.range || 0) + (isChong(w) ? 1 : 0);
    }
    if (mt) {
      var B = AO.gearOf(G.breeds, mt.breed), bm = G.qMul[mt.q] || 1;
      atk *= (1 + B.atk / 100) * bm;
      def *= (1 + B.def / 100) * bm;
      mov += (B.mov || 0);
    }
    if (g) {
      var gi = AO.MIL_ITEM[g.tier];
      if (gi) {
        siege = Math.max(siege, gi.siege || 0);
        range = Math.max(range, gi.range || 0);
      }
    }
    var cm = craftMulOf(a.owner);
    atk *= cm; def *= cm;
    mov = AO.clamp(Math.round(mov), 1, 3);
    return { atk: atk, def: def, mov: mov, range: range, siege: siege, pow: atk };
  }
  /* 兵器图标：**形状 × 材质色**批量导出（tools/res-icons.html 的矩阵），
   * id 免映射表 —— item-wpn-<类型>-<材质>.png 直接拼出来。
   * 弓在火器下画的是"铳身"变体，但文件名仍是 wpn-gong-powder（同一格）。 */
  function wpnIcon(type, mat) {
    return 'assets/res/item-wpn-' + (type || 'dao') + '-' + (mat || 'leather') + '.png';
  }
  /* 弓在火器材质下就是「铳」：名字与射程都换，类型仍是弓（图标走 gong 的铳身变体） */
  function isChong(w) { return !!w && w.type === 'gong' && w.tier === 'powder'; }
  function typeCnOf(w) {
    if (!w) return '';
    if (isChong(w)) return '铳';
    return AO.gearOf(AO.GEAR.types, w.type).cn;
  }
  /* 部队的名字（战报 / 面板）：材质 + 类型 + 兵种，例如「铁刀步兵」 */
  function unitNameOf(a) {
    if (!a) return '部队';
    if (a.type === 'navy') return (AO.MIL_ITEM[a.tier] || {}).cn || '舰队';
    if (a.weapon) {
      var it = AO.MIL_ITEM[a.weapon.tier] || {};
      return (it.cn || '') + typeCnOf(a.weapon) + unitKindCn(a);
    }
    return unitKindCn(a);
  }
  /* 兵种（有炮=炮兵、有马=骑兵、否则步兵） */
  function unitKindOf(a) {
    if (!a) return 'inf';
    if (a.type === 'navy') return 'navy';
    if (a.gun) return 'art';
    if (a.mount) return 'cav';
    return 'inf';
  }
  function unitKindCn(a) {
    var k = unitKindOf(a);
    return k === 'art' ? '炮兵' : k === 'cav' ? '骑兵' : k === 'navy' ? '舰队' : '步兵';
  }
  /* 军队卡上那行话术：「铁 · 刀 · 锋锐（良）」，骑兵再加「马：具装马（上）」 */
  function gearText(a) {
    var G = AO.GEAR, out = [];
    if (a.weapon) {
      var it = AO.MIL_ITEM[a.weapon.tier] || AO.MIL_ITEM.leather;
      out.push(it.cn + ' · ' + typeCnOf(a.weapon) + ' · ' +
        AO.gearOf(G.forms, a.weapon.form).cn + '（' + G.qCn[a.weapon.q] + '）');
    } else out.push('赤手空拳');
    if (a.mount) out.push('马：' + AO.gearOf(G.breeds, a.mount.breed).cn + '（' + G.qCn[a.mount.q] + '）');
    if (a.gun) out.push('炮：' + (AO.MIL_ITEM[a.gun.tier] || {}).cn + '（' + G.qCn[a.gun.q] + '）');
    return out.join(' · ');
  }
  /* 发武器：从武库取一份（换下的回库）。key = '代|类型|形制|品质' */
  function issueWeapon(a, key, silent) {
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle() };
    if (a.type === 'navy') return { ok: false, msg: '舰队不吃兵刃' };
    if (!key) {                                   // 卸下
      if (a.weapon) arsAdd(a.owner, 'wpn', a.weapon.key, 1);
      a.weapon = null;
      syncArms(a);
      return { ok: true, msg: '卸下兵刃，回武库' };
    }
    var A = arsOf(a.owner);
    if (!(A.wpn[key] > 0)) return { ok: false, msg: '武库里没有这一份了' };
    if (a.weapon) arsAdd(a.owner, 'wpn', a.weapon.key, 1);
    arsTake(a.owner, 'wpn', key, 1);
    var p = key.split('|');
    a.weapon = { key: key, tier: p[0], type: p[1], form: p[2], q: p[3] };
    syncArms(a);
    return { ok: true, msg: '换装：' + gearText(a) };
  }
  function issueMount(a, key, silent) {
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle() };
    if (a.type === 'navy') return { ok: false, msg: '舰队不骑马' };
    if (!key) {
      if (a.mount) arsAdd(a.owner, 'mount', a.mount.key, 1);
      a.mount = null;
      syncArms(a);
      return { ok: true, msg: '卸下马，回武库' };
    }
    var A = arsOf(a.owner);
    if (!(A.mount[key] > 0)) return { ok: false, msg: '武库里没有这一份马了' };
    if (a.mount) arsAdd(a.owner, 'mount', a.mount.key, 1);
    arsTake(a.owner, 'mount', key, 1);
    var p = key.split('|');
    a.mount = { key: key, breed: p[0], q: p[1] };
    syncArms(a);
    return { ok: true, msg: '发马：' + gearText(a) + '（兵种 → ' + unitKindCn(a) + '）' };
  }
  function issueGun(a, key, silent) {
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle() };
    if (a.type === 'navy') return { ok: false, msg: '舰炮不算陆军的炮' };
    if (!key) {
      if (a.gun) arsAdd(a.owner, 'gun', a.gun.key, 1);
      a.gun = null;
      syncArms(a);
      return { ok: true, msg: '卸下炮，回武库' };
    }
    var A = arsOf(a.owner);
    if (!(A.gun[key] > 0)) return { ok: false, msg: '武库里没有这一门炮了' };
    if (a.gun) arsAdd(a.owner, 'gun', a.gun.key, 1);
    arsTake(a.owner, 'gun', key, 1);
    var p = key.split('|');
    a.gun = { key: key, tier: p[0], q: p[1] };
    syncArms(a);
    return { ok: true, msg: '发炮：' + gearText(a) + '（兵种 → ' + unitKindCn(a) + '）' };
  }
  /* a.arms 是给战报 / 面板读的派生字段，和 unitKindOf 永远同源 */
  function syncArms(a) {
    if (!a) return;
    a.arms = unitKindOf(a);
  }
  /* 一键配齐（武器 / 马 / 炮 / 盔甲靴 一起）：取武库里最优的一套 */
  function armyFitAll(a, silent) {
    if (!a) return { ok: false, msg: '没有这支军队' };
    if (!silent && !canAct(a.owner)) return { ok: false, msg: lockTitle() };
    if (a.type === 'navy') return { ok: false, msg: '舰队不用配装' };
    var n = 0, i;
    if (!a.weapon) { var w = arsBest(a.owner, 'wpn'); if (w) { issueWeapon(a, w.key, true); n++; } }
    if (!a.mount) { var m = arsBest(a.owner, 'mount'); if (m) { issueMount(a, m.key, true); n++; } }
    if (!a.gun) { var g = arsBest(a.owner, 'gun'); if (g) { issueGun(a, g.key, true); n++; } }
    var e = equipAutoFit(a, true);
    n += e.n || 0;
    return { ok: true, n: n, msg: n ? ('配齐 ' + n + ' 项：' + gearText(a)) : '武库里没有能配的东西' };
  }

  /* ---------------- 四、装备袋与产线（兼容层） ---------------- */
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
  /* 面板上"这支部队叫什么"：陆军的名字由 材质+类型+兵种 拼出来（「铁刀步兵」），
   * 舰队直接用舰种名。返回的是**显示用**的小对象，不是库存表里的那一行。 */
  function itemOf(a) {
    if (!a) return AO.MIL_ITEM.leather;
    if (a.type === 'navy') return AO.MIL_ITEM[a.tier] || AO.MIL_ITEM.galley;
    return {
      cn: unitNameOf(a),
      color: (a.weapon && (AO.MIL_ITEM[a.weapon.tier] || {}).color) || '#888'
    };
  }
  /* 一国已解锁的装备（该 kind：weapon / gun / ship） */
  function unlockedItems(owner, kind) {
    var order = kind === 'gun' ? AO.GUN_ORDER : kind === 'ship' ? AO.SHIP_ORDER : AO.MIL_ORDER;
    var out = [], R = RESEARCH[owner], done = R && R.done;
    for (var i = 0; i < order.length; i++) {
      var it = AO.MIL_ITEM[order[i]];
      if (!it) continue;
      if (kind === 'weapon') {
        if (AO.craftHave(done, it.craft)) out.push(it);
      } else if (!it.tech || (done && done[it.tech])) out.push(it);
    }
    return out;
  }
  function lastUnlocked(owner, kind) {
    var list = unlockedItems(owner, kind);
    return list.length ? list[list.length - 1] : null;
  }

  /* ---------------- 四b、建厂（＋ 钮与真建厂读同一份规则） ---------------- */
  function factoryCtx(p) {
    /* edu = 累计教育（只加不减，解锁用）；talent = 能花的人才点（抽卡会扣）。 */
    var T = talentOf(p.owner);
    return { bag: SIM[p.id], edu: T.total || 0, talent: T.pts || 0 };
  }
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

  /* ---------------- 五、订单结算（全国，每国一次） ---------------- */
  /* 一国这一回合的料：先中央、再各省（从库存多的省开始）—— 全国口径的生产
   * 没有"本省"这个概念，所以不能只吃一个省。 */
  function millPay(owner, recipe) {
    var k, cen = ensureCentral(owner), need = {}, total = 0;
    for (k in recipe) { need[k] = recipe[k]; total += recipe[k]; }
    if (!total) return true;
    var have = 0;
    for (k in need) have += (cen[k] || 0) + 0;
    var provs = (coOf(owner) || {}).provinces || [], i;
    for (i = 0; i < provs.length; i++) {
      var bag = SIM[provs[i]];
      if (!bag) continue;
      for (k in need) if (bag[k]) have += bag[k].stock || 0;
    }
    for (k in need) {
      var got = Math.min(need[k], Math.max(0, cen[k] || 0));
      cen[k] = (cen[k] || 0) - got;
      need[k] -= got;
      if (need[k] <= 0) continue;
      /* 省里凑：按库存从多到少（大省先出，小省留着过日子） */
      var list = provs.slice().sort(function (a, b) {
        var ba = SIM[a], bb = SIM[b];
        return ((bb && bb[k] && bb[k].stock) || 0) - ((ba && ba[k] && ba[k].stock) || 0);
      });
      for (i = 0; i < list.length && need[k] > 0; i++) {
        var b2 = SIM[list[i]];
        if (!b2 || !b2[k]) continue;
        var take = Math.min(need[k], b2[k].stock || 0);
        if (take <= 0) continue;
        b2[k].stock -= take;
        need[k] -= take;
        var F = FLOW[list[i]];
        if (F) { F.loss[k] = (F.loss[k] || 0) + take; F.d.ind = (F.d.ind || 0) + take; }
      }
      if (need[k] > 0) return false;          // 缺料：整单不成立（不烧半份料）
    }
    var FC = FLOWC[owner];
    if (FC) for (k in recipe) FC.d.ind = (FC.d.ind || 0) + recipe[k];
    return true;
  }
  /* 一单的料 */
  function orderCost(owner, line) {
    var M = AO.MILL, kind = M.kindOf[line], k, out = {};
    if (kind === 'blade') {
      var it = craftWeapon(owner);
      for (k in it.recipe) out[k] = it.recipe[k] * (M.bladeMul || 1);
    } else if (kind === 'equip') {
      for (k in M.equipRecipe) out[k] = M.equipRecipe[k];
    } else if (kind === 'mount') {
      for (k in M.mountRecipe) out[k] = M.mountRecipe[k];
    } else {
      var gi = AO.MIL_ITEM[line];
      if (gi && gi.recipe) for (k in gi.recipe) out[k] = gi.recipe[k];
    }
    return out;
  }
  /* 出一单：把这一单的东西放进武库（兵刃/马/炮/舰）或装备库（盔甲靴） */
  function makeOrder(owner, line) {
    var M = AO.MILL, kind = M.kindOf[line], q = rollQuality(owner);
    if (kind === 'blade') {
      var it = craftWeapon(owner), form = millOf(owner).form[line] || 'plain';
      var key = [it.key, line, form, q].join('|');
      arsAdd(owner, 'wpn', key, 1);
      return { kind: kind, key: key, q: q, n: 1 };
    }
    if (kind === 'equip') {
      var inv = equipOf(owner);
      inv[line][q] = (inv[line][q] || 0) + 1;
      return { kind: kind, key: line + '|' + q, q: q, n: 1 };
    }
    if (kind === 'mount') {
      var mk = line + '|' + q;
      arsAdd(owner, 'mount', mk, 1);
      return { kind: kind, key: mk, q: q, n: 1 };
    }
    if (kind === 'gun') {
      var gk = line + '|' + q;
      arsAdd(owner, 'gun', gk, 1);
      return { kind: kind, key: gk, q: q, n: 1 };
    }
    arsAdd(owner, 'ship', line, 1);
    return { kind: kind, key: line, q: q, n: 1 };
  }
  /* 全国产能结算：每国一次（放在省循环之后、人口税之前那一位）。
   * 顺序：算池 → 分配 clamp → 逐线推进 → 满工作量就出单（缺料卡在 100%）。 */
  function settleIndustry(owner) {
    owner = owner | 0;
    if (!owner || countryDead(owner)) return;
    var M = AO.MILL, m = millOf(owner), i, j;
    for (i = 0; i < MILL_POOLS.length; i++) {
      var pool = MILL_POOLS[i], kind = M.poolBld[pool];
      var raw = poolCapRaw(owner, pool) + (m.acc[pool] || 0);
      var cap = Math.floor(raw);
      m.acc[pool] = raw - cap;
      var lines = M.lines[pool], sum = 0;
      for (j = 0; j < lines.length; j++) sum += Math.max(0, m.alloc[lines[j]] | 0);
      /* 产能缩水（工厂停产 / 匠人被撤）：**从工作量最高的线往下扣** */
      while (sum > cap) {
        var hi = -1, hiW = -1;
        for (j = 0; j < lines.length; j++) {
          var ln = lines[j], a0 = Math.max(0, m.alloc[ln] | 0);
          if (!a0) continue;
          if (lineWork(owner, ln) > hiW) { hiW = lineWork(owner, ln); hi = j; }
        }
        if (hi < 0) break;
        m.alloc[lines[hi]]--; sum--;
      }
      for (j = 0; j < lines.length; j++) {
        var line = lines[j];
        var alloc = Math.min(Math.max(0, m.alloc[line] | 0), lineWork(owner, line));
        var work = lineWork(owner, line);
        var prog = Math.min(work, (m.prog[line] || 0) + alloc);
        if (prog >= work) {
          if (millPay(owner, orderCost(owner, line))) {
            makeOrder(owner, line);
            prog = 0;
            m.wait[line] = 0;
          } else {
            m.wait[line] = 1;               // 卡在 100% 等料：不烧料、不丢进度
          }
        } else {
          m.wait[line] = 0;
        }
        m.prog[line] = prog;
      }
    }
  }
  /* 一国的产线总览（面板 / AI 读同一份） */
  function millReport(owner) {
    var M = AO.MILL, out = [], i, j;
    for (i = 0; i < MILL_POOLS.length; i++) {
      var pool = MILL_POOLS[i];
      out.push({ pool: pool, cap: poolCap(owner, pool), used: allocSum(owner, pool), lines: [] });
      var lines = M.lines[pool];
      for (j = 0; j < lines.length; j++) out[out.length - 1].lines.push(lineStatus(owner, lines[j]));
    }
    return out;
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
  /* 兼容入口：把"装备代"（旧键）或材质键读成一份**凡品刀**
   * （旧脚本/老档里 newArmy(..., {tier:'ironwp'}) 的写法照旧能用）。 */
  function weaponFromTier(t) {
    if (!t) return null;
    var m = AO.MAT_ALIAS[t] ? AO.matKeyOf(t)
      : (AO.MIL_ITEM[t] && AO.MIL_ITEM[t].kind === 'weapon' ? t : null);
    if (!m) return null;
    return { key: m + '|dao|plain|plain', tier: m, type: 'dao', form: 'plain', q: 'plain' };
  }
  function newArmy(owner, pid, opt) {
    opt = opt || {};
    var id = ARMY_ID++;
    var a = {
      id: id, owner: owner | 0, type: opt.type || 'army',
      /* tier：舰队存舰种键；陆军存**材质**键（旧档的"代"读进来先折算，见 AO.matKeyOf） */
      tier: opt.type === 'navy' ? (opt.tier || 'galley') : AO.matKeyOf(opt.tier || 'leather'),
      men: Math.max(100, opt.men || AO.RECRUIT.menPerUnit),
      ships: opt.type === 'navy' ? (opt.ships || 1) : 0, cargo: null,
      generalId: opt.generalId || 0, order: null, pid: pid | 0, sup: false, starved: false,
      /* 装备三槽（盔/甲/靴，存品质键；材质不入件，见 AO.EQUIP）。
       * 新军默认空手 —— 配发是武库面板上的一个动作，不是征兵附送的。 */
      equip: { helm: null, chest: null, boots: null },
      /* v19：兵刃 / 马 / 炮三份"队份"（各存武库的键）。
       * **兵种是从这里派生的**：有炮=炮兵、有马=骑兵、否则步兵。
       * opt.tier 是**兼容入口**（旧脚本 / 测试 / 存档里"建一支铁甲军"的写法）：
       * 旧键（ironwp / crossbow / musket…）先折算成材质，再发一份该材质的刀
       * （平平无奇 · 凡品）—— 不用调用方改口。 */
      weapon: opt.weapon || weaponFromTier(opt.tier),
      mount: opt.mount || null,
      /* 炮也一样：opt.tier 给的是炮键 → 当成"发了一门炮"（炮兵） */
      gun: opt.gun || (opt.tier && (AO.MIL_ITEM[opt.tier] || {}).kind === 'gun'
        ? { key: opt.tier + '|plain', tier: opt.tier, q: 'plain' } : null)
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
    /* 覆没的军队把随军装备一起带走（拍板⑥：胜者不缴获）。
     * 为什么放在这个唯一出口上：全歼 / 断粮溃散 / 装船沉没 / 解散 都走 disbandArmy，
     * 在这里销毁一次就够，各调用点不用各记一遍。 */
    equipDestroy(a);
    delete ARMY[id];
    if (why) WARLOG.unshift({ turn: turnNo, cls: 'bad', text: why });
  }

  /* 征兵（v19）：**只出步兵** —— 扣金 + 人口，不扣装备。
   * 兵种是武库里发装备发出来的（有炮=炮兵、有马=骑兵），所以征兵这一步
   * 只回答"有没有人、有没有钱"，不回答"穿什么"。
   * 裸兵 pow 0.5（见 GEAR.bare）：能守不能攻，AI 也不拿裸兵进攻。 */
  function recruitInfo(pid, arms, tierKey) {
    var p = pOf(pid), out = { ok: false, why: '', tier: null, arms: 'inf' };
    if (!p) { out.why = '没有这个省'; return out; }
    var bq = BARRACKS[pid];
    if (!bq || !(bq.n > 0)) { out.why = '本省没有兵营'; return out; }
    if (bq.halted) { out.why = '兵营维护欠费，停产中'; return out; }
    var it = bestWeapon(p.owner);
    out.tier = it;
    var R = AO.RECRUIT;
    out.need = { pop: R.popPerUnit, gold: R.goldPerUnit, wpn: 0, horse: 0, gun: 0 };
    var gold = (SIM[pid].gold && SIM[pid].gold.stock) || 0;
    var cen = CENTRAL[p.owner] || {};
    if (gold + (cen.gold || 0) < out.need.gold) {
      out.why = '金不够：要 ' + out.need.gold + '（省库 ' + gold + ' · 中央 ' + Math.floor(cen.gold || 0) + '）';
      return out;
    }
    var popv = (POP[pid] && POP[pid].v) || 0;
    if (popv < out.need.pop) { out.why = '人口不够：要 ' + out.need.pop + ' 人，本省只有 ' + Math.round(popv); return out; }
    if (RECRUITQ[pid]) { out.why = '本省正在征兵（剩 ' + RECRUITQ[pid].left + ' 回合）'; return out; }
    /* 裸兵提醒：不是闸，是让玩家知道"还得去武库发装备" */
    out.bare = true;
    out.ok = true;
    return out;
  }
  function hasCavTech(owner) {
    var R = RESEARCH[owner];
    return !!(R && R.done && R.done.mil_iron);
  }

  function recruit(pid, arms, tierKey) {
    var p = pOf(pid);
    if (!p) return { ok: false, msg: '没有这个省' };
    if (!canAct(p.owner)) return { ok: false, msg: lockTitle() };
    var info = recruitInfo(pid, 'inf', tierKey);
    if (!info.ok) return { ok: false, msg: info.why };
    var R = AO.RECRUIT, need = info.need;

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
      var a0 = spawnArmy(p.owner, pid);
      return { ok: true, msg: p.name + ' 成军：步兵 ' + AO.RECRUIT.menPerUnit + ' 人（金 ' +
        need.gold + ' · 人口 ' + need.pop + '）—— 赤手空拳，去「武库」发装备', army: a0, instant: true };
    }
    RECRUITQ[pid] = { left: delay, owner: p.owner | 0 };
    return { ok: true, msg: p.name + ' 征兵中：步兵 ' + delay + ' 回合后成军（金 ' +
      need.gold + ' · 人口 ' + need.pop + '）' };
  }

  /* 成军：同省同国 → 并进去（避免一个省堆十支小军） */
  function spawnArmy(owner, pid) {
    var list = armiesIn(pid), i;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.owner === (owner | 0) && a.type === 'army' && !a.weapon && !a.mount && !a.gun &&
        a.men < AO.RECRUIT.maxMen) {
        a.men = Math.min(AO.RECRUIT.maxMen, a.men + AO.RECRUIT.menPerUnit);
        return a;
      }
    }
    var na = newArmy(owner, pid, { type: 'army', men: AO.RECRUIT.menPerUnit });
    syncArms(na);
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
      spawnArmy(q.owner, +pid);
      WARLOG.unshift({ turn: turnNo, cls: 'ok', text: p.name + ' 新军成军（步兵，待发装备）' });
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
    var defSum = 0, movSum = 0;
    var hasNight = false, hasWall = false, hasAmbush = false, first = 1;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], u = armyUnits(a);
      var tr = genTrait(generalOf(a)), fx = (tr && tr.fx) || {};
      var m = 1;
      if (fx.powMul) m *= fx.powMul;
      if (isDef && fx.defMul) m *= fx.defMul;
      /* 装备三件（v17）：战力 ×(1 + Σ(材质底 × 品质倍))，攻防同乘 ——
       * 乘在 v 上，所以射击相位（shoot += v）也一起吃到，不用乘两次。 */
      m *= equipMulOf(a);
      if (a.sup) m *= B.suppress;                    // 被轰击压制
      if (a.starved) m *= 0.85;                      // 断粮
      if (isDecap(a.owner)) m *= B.decap;            // 群龙无首
      var v = u.base * m;
      pow += v; men += a.men; ships += a.ships || 0;
      defSum += (u.def || 1) * a.men; movSum += (u.mov || 2) * a.men;
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
      /* 三维（v19）：def / mov 按兵数加权 —— 一支混编军队的"防御"不是一个整数，
       * 而是"每个兵的那一档乘他的人数"再除总兵数。 */
      def: men > 0 ? defSum / men : 1,
      mov: men > 0 ? movSum / men : 2,
      first: first, dice: rnd(B.diceLo, B.diceHi), n: list.length
    };
  }
  function armyUnits(a) {
    if (a.type === 'navy') {
      var sh = AO.MIL_ITEM[a.tier] || AO.MIL_ITEM.galley;
      return { pow: sh.pow, base: (a.ships || 0) * sh.pow, range: 1, siege: 0,
        def: sh.pow, mov: 2 };
    }
    /* v19：三维由**装备**算出来（unitOf），不是查兵种表 ——
     * 招的都是步兵，兵种是武库发出来的。 */
    var u = unitOf(a);
    return { pow: u.atk, base: (a.men / 1000) * u.atk, range: u.range, siege: u.siege,
      def: u.def, mov: u.mov };
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
      /* v19：武器不再按人头从省库扣 —— 装备是**部队身上的**东西（武库发下来的
       * 队份），死的是人不是装备；整支打光了才在 disbandArmy 里随军销毁。 */
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

    /* ---- 三维（v19）：def 减伤 + mov 先手 ----
     * 减伤 = (def守 / def攻)^0.5，封顶 defMitCap（1.3）：
     *   守方吃到的伤亡**除以**它。铁器(def2.0) 挨 皮甲(def1.0) 打 = ÷1.41，
     *   反过来只有 ÷1（下限 1，防御再差也不会"受伤加倍"）。
     * 先手 = mov 差每高一档，射击相位 +5%（封顶 ±15%）—— 骑兵先撞上枪线，
     * 弓手先放一轮，这都在"射击"这一段里体现，不另开相位。 */
    var mit = Math.pow(Math.max(0.01, D.def) / Math.max(0.01, A.def), B.defMitExp);
    mit = AO.clamp(mit, 1, B.defMitCap);
    var movDiff = (A.mov || 2) - (D.mov || 2);
    var init = AO.clamp(movDiff * B.initPerStep, -B.initCap, B.initCap);
    if (init > 0) A.shoot *= (1 + init);
    else if (init < 0) D.shoot *= (1 - init);

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
      shootRec.deadD = hurtWall(wallSt, wallRec, defList, dMen0 * rateA / mit);
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
      meleeRec.deadD = hurtWall(wallSt, wallRec, defList, Math.max(0, dMen1) * mrA / mit);
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
      three: { mit: mit, movA: A.mov, movD: D.mov, init: init, defA: A.def, defD: D.def },
      gA: gA ? gA.name : '', gD: gD ? gD.name : '',
      deadA: aMen0 - aLeft, deadD: dMen0 - dLeft,
      wall: wallRec
    };
    /* 压制只吃一次：这场会战用过了就清掉（没打起来的部队继续留着，下回合还有效） */
    for (var ci2 = 0; ci2 < atkList.length; ci2++) atkList[ci2].sup = false;
    for (var ci3 = 0; ci3 < defList.length; ci3++) defList[ci3].sup = false;
    if (winner === 'atk') { winList = atkList; loserList = defList; }
    else { winList = defList; loserList = atkList; }
    /* ---- 三维（v19）：追击 ----
     * 败方机动每低一档，多损 5%（B.pursuePerStep）。打崩了跑不掉才是真崩 ——
     * 这条只加在**已经判负**的一方身上，不影响胜负判定本身。 */
    var wMov = winner === 'atk' ? A.mov : D.mov, lMov = winner === 'atk' ? D.mov : A.mov;
    var pursueMul = Math.max(0, (wMov || 2) - (lMov || 2)) * B.pursuePerStep;
    rep.pursue = 0;
    if (pursueMul > 0) {
      rep.pursue = hurt(loserList, sumMen(loserList) * pursueMul);
      aLeft = sumMen(atkList); dLeft = sumMen(defList);
      rep.atk.men1 = aLeft; rep.def.men1 = dLeft;
      rep.deadA = aMen0 - aLeft; rep.deadD = dMen0 - dLeft;
    }
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
      /* 装备（v17）：接触相位是**另一段**独立算的战力，装备必须在这里再乘一次 ——
       * sideStat 里那份只喂给射击相位和战报。冷兵器没有射程，全部伤害走这一段，
       * 漏了这行的话"盔甲靴"就只影响战报上那个数字，一点血都不少吃。 */
      m *= equipMulOf(a);
      var base = u.base * m;
      if (a.type === 'army' && unitKindOf(a) === 'art') base *= 0.5;
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
    var txt = '⚔ ' + rep.prov + ' · ' + AO.calTag(turnNo) +
      '（' + tcn + '·守 ×' + rep.def.terr.toFixed(2) + '）：' +
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
    /* 只有玩家参与的会战才进纪要（v10）：AI 互战的战报在战报面板里，
     * 不往玩家的提示条里塞 —— 36 国混战一回合能打十几场。 */
    if (!PLAYER || rep.atk.owner === PLAYER || rep.def.owner === PLAYER) {
      NOTES.push({ owner: PLAYER || rep.atk.owner, pid: rep.pid, cls: 'warn', text: txt });
    }
    /* 战争分（v9）：会战获胜 +5，败方另外吃一次 REL −5。
     * REL 那条在**战时看不出来** —— 宣战已经把它钉在 −100，缓释又跳过交战对，
     * 所以 −5 会被地板吃掉。仍然照驱动表记一笔，理由有两条：
     *   ① REL 的驱动表是唯一出处，少记一条以后就对不上账；
     *   ② 下一批 AI 互战 / 第三方调停一旦放开"交战期 REL"，这条立刻生效。 */
    if (rep.winner === 'atk') {
      wsAdd(rep.atk.owner, rep.def.owner, 'battle');
      if ((rep.def.owner | 0) > 0) addRel(rep.def.owner, rep.atk.owner, AO.DIPLO.rel.battleLoss);
    } else if (rep.winner === 'def') {
      wsAdd(rep.def.owner, rep.atk.owner, 'battle');
      if ((rep.atk.owner | 0) > 0) addRel(rep.atk.owner, rep.def.owner, AO.DIPLO.rel.battleLoss);
    }
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
    /* 整合（B1）：刚打下来 = 未整合。这一行同时管两件事：
     *   ① 首次占领 → INTEG 从 0 开始；
     *   ② **被对方夺回去**（原来是你整合好的省）→ 直接归零重算。
     * 所以"被夺回 INTEG 清零"不需要在别处再判一次，易主就是清零。 */
    INTEG[pid | 0] = { v: 0 };
    /* 不安：换主子等于重新洗牌 —— 旧怨跟着旧朝廷散了，但"占领"本身
     * 那 +15 立刻接上（下一回合 settleUnrest 会算出来）。上限压到 30，
     * 否则一个 90 不安的省会带着 90 投到新主门下，新主开局就爆。 */
    var uo = unrestOf(pid);
    uo.v = Math.min(uo.v, 30); uo.target = uo.v;
    delete UNWARN[pid | 0];
    delete SIEGE[pid];
    /* 战争分（v9）：占领 +10，围城开城 +8（省了攻城的血，分也少一点），
     * 拿下对方首都再 +30 —— 首都易手是这一仗的胜负手，值得单独记一笔。 */
    var wsGain = 0;
    if (before && atWar(by, before)) {
      var viaSiege = !!via && String(via).indexOf('围城') >= 0;
      wsGain += wsAdd(by, before, viaSiege ? 'siege' : 'occupy');
      if (oldC && oldC.capital === pid) wsGain += wsAdd(by, before, 'capital');
    }
    CPROV.w = null;                            // 同国省列表缓存作废
    CAPS = null;                               // 首都表缓存作废（首都可能易手）
    invalidateGeo();
    /* 攻方贴脸进了这座城：立刻刷新一次所见（v6） */
    see(by, pid, false);
    if (before) see(before, pid, false);
    WARLOG.unshift({ turn: turnNo, cls: 'ok',
      text: '🚩 ' + p.name + ' 易主：' + (oldC ? oldC.name : '?') + ' → ' + (newC ? newC.name : '?') +
        (via ? '（' + via + '）' : '') + '；未整合省产出 ×' + AO.INTEG.prodAt0 +
        '（整合满 ×' + AO.BATTLE.occupyProd + '，完成归附 ×1）、民心 ' + AO.BATTLE.occupyHappy +
        (wsGain ? '；战争分 +' + wsGain : '') });
    /* 编年史（v5）：只读一次状态 —— 玩家刚把最后一块地打下来时，
     * 史记要当场翻到"天下归一"那一页，而不是等下一回合结算。 */
    if (AO.chronoCheck) AO.chronoCheck();
    /* 「世界消息」（v15）：都城易手是远方最值得知道的那一条 ——
     * 但它同样要走情报渠道（灭国级的消息最容易被传走样，见 0 档的「夸大其词」） */
    if (oldC && oldC.capital === pid && PLAYER !== by && PLAYER !== before) {
      worldNews('都城易手：' + (newC ? newC.name : '?') + ' 攻下 ' + p.name +
        '（' + oldC.name + ' 的都城）', 'warn',
        { parties: [by, before], kind: 'capital' });
    }
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

    /* 投降线的三分支（v13）：全吞 / 傀儡 / 被 AI 要求称臣。
     *
     * 为什么不是"全都收成傀儡"：朝贡是**收租**，但一个已经崩掉的国家，租子也
     * 收不上来（它的省被打烂、民心见底）。所以全吞仍然是默认的解，傀儡是
     * 概率分支 —— 40% 是"AI 也懂留个收租的"和"别让世界只剩灭国一种结局"的折中。
     *
     * 顺序不能反：
     *   ① 已经是别人的属国 → 直接全吞（没有"傀儡的傀儡"，表上也没法表达）
     *   ② 玩家是胜方 → 弹卡，让玩家自己选（这一批要给的就是这个决定）
     *   ③ 玩家是败方 → AI 掷点（40% 要称臣）
     *   ④ AI 对 AI → 同上。
     * 判定本身在 surrenderBranch 里（纯函数 + 一次掷点），这里只负责落地。 */
    var branch = surrenderBranch(loser, winner);
    if (branch === 'card') {
      /* 已经弹着一张受降卡 → 不重复弹（一次只能选一件事，第二仗下一回合再说） */
      if (SURR.open) return;
      openSurrender(loser, winner);
      return;
    }
    if (branch === 'puppet') {
      var pr = makePuppet(winner, loser);
      if (pr.ok) return;
    }
    annex(loser, winner);
  }
  /* 投降线的三分支判定（**纯函数**，掷点在里面）。
   * 单独拎出来是为了能对"玩家是败方 40% 被要求称臣"统计掷点频率 ——
   * 埋在 trySurrender 里就只能靠造 200 次灭国来验，那验的是别的代码。
   *
   * 顺序不能反：
   *   ① 已经是别人的属国 → annex（没有"傀儡的傀儡"，表上也表达不了）
   *   ② 玩家是胜方 → card（这一批要给的就是"全吞还是收租"这个决定）
   *   ③ 其余（玩家败方 / AI 对 AI）→ 40% 收成朝贡国，否则全吞 */
  function surrenderBranch(loser, winner) {
    var P = AO.DIPLO.puppet;
    if (suzerainOf(loser)) return 'annex';
    if (PLAYER && PLAYER === (winner | 0)) return 'card';
    if (Math.random() < (P.surrenderP || 0.4) && canTakeVassal(winner, loser)) return 'puppet';
    return 'annex';
  }
  /* 全境并入：省全给赢家、军队/官员/科技清空、NOTES 宣布灭亡。
   *
   * v13 起多了第三个参数 opt（**不传就是原来的行为**，投降那条路一行没变）：
   *   integrated     省直接算正式国土（删 OCCUPY / INTEG，产出 ×1.0）
   *   keepOfficials  官员留任（不删 OFFICIAL）
   *   armyKeep       军队转编比例（其余解散）
   *   via            战报里的动词（'投降并入' / '和平并入' / '强并入'）
   *   puppet         'peace' | 'force' | ''（只影响战报文案）
   * 傀儡用得到这四项，投降用不到 —— 所以是"加参数"，不是"改流程"。 */
  function annex(loser, winner, opt) {
    opt = opt || {};
    var lc = coOf(loser), wc = coOf(winner);
    if (!lc || !wc) return { ok: false, list: [] };
    var list = lc.provinces.slice(), i;
    /* 它自己的属国先放生（v13）：宗主亡了，附庸自动解除臣属 ——
     * 新主子不继承附庸（继承会让"吞一个国顺带接管一片"成为最强的扩张方式）。
     * 放生之后它们对赢家的态度是"刚被解除的敌国属国"，不带任何自动参战。 */
    var vs = vassalsOf(loser);
    for (i = 0; i < vs.length; i++) {
      dropPuppetRec(loser, vs[i]);
      var vt = '⚑ ' + nameOf(vs[i]) + ' 的宗主 ' + lc.name + ' 已亡 —— 臣属关系自动解除';
      WARLOG.unshift({ turn: turnNo, cls: 'warn', text: vt });
      if (PLAYER === vs[i] || PLAYER === loser || PLAYER === winner) {
        NOTES.push({ owner: PLAYER, cls: 'warn', text: vt });
      } else {
        worldNews(vt.replace('⚑ ', ''), 'warn', { parties: [vs[i], loser], kind: 'puppet' });
      }
    }
    for (i = 0; i < list.length; i++) {
      occupyProvince(list[i], winner, opt.via || '投降并入');
      if (opt.integrated) {
        /* 傀儡并入：这些省本来就是它的地（只是腰包和兵不归自己），
         * 一进门就是正式国土 —— 不删 OCCUPY 的话玩家拿回自己的省还要再整合
         * 25~100 回合，"和平并入"就成了另一种全吞，等于白做一条路。 */
        delete OCCUPY[list[i]];
        delete INTEG[list[i]];
      }
    }
    lc.provinces = [];
    /* 军队 / 将领：默认全解散；傀儡并入按 armyKeep 转编一部分（其余就地解散）。
     * 转编的兵留在原省（那省已经易主），如果它现在不在赢家手里（被第三方占着），
     * 那支部队无处可去 —— 就地解散。 */
    var ids = armyIds(), keepN = 0;
    for (i = 0; i < ids.length; i++) {
      var a = ARMY[ids[i]];
      if (!a || a.owner !== loser) continue;
      var keep = opt.armyKeep > 0 ? Math.round((a.men || 0) * opt.armyKeep) : 0;
      if (keep >= 100) {
        var ap = pOf(a.pid);
        if (!ap || ap.owner !== (winner | 0)) { disbandArmy(a.id); continue; }
        a.men = keep;
        a.owner = winner | 0;
        a.order = { type: 'defend', cid: winner | 0, pid: a.pid, tactic: 'assault' };
        a.aiMen0 = 0;
        var g0 = GENERALS[a.generalId];
        if (g0) g0.owner = winner | 0;       // 将领跟着部队改换门庭
        keepN++;
      } else {
        disbandArmy(a.id);
      }
    }
    for (var gid in GENERALS) if (GENERALS[gid] && GENERALS[gid].owner === loser) delete GENERALS[gid];
    /* 官员：投降并入时清空（并入的省由赢家重新派官，老的跟着旧朝廷一起没了）；
     * 傀儡并入时留任 —— 它本来就是你的地，官不用重新派。 */
    if (!opt.keepOfficials) for (i = 0; i < list.length; i++) delete OFFICIAL[list[i]];
    var T = talentOf(loser);
    T.pool = []; T.milPool = []; T.pts = 0;
    RESEARCH[loser] = newResearch();
    DEAD[loser] = { turn: turnNo, by: winner, puppet: opt.puppet || '' };
    /* 把跟它的战争状态全部撤掉 */
    for (var k in WARSET) {
      var ab = k.split('|');
      if (+ab[0] === loser || +ab[1] === loser) delete WARSET[k];
    }
    /* 傀儡表里跟它有关的记录（自己是傀儡的那条在 annexPuppet 里已经删了，
     * 这里兜底：投降被吞的国如果还是某人的傀儡，那条记录也该没了） */
    for (k in PUPPET) {
      var pr = PUPPET[k];
      if (pr && ((pr.s | 0) === (loser | 0) || (pr.p | 0) === (loser | 0))) delete PUPPET[k];
    }
    CAPS = null; CPROV.w = null;
    invalidateGeo();
    var txt = opt.puppet
      ? '🏳 ' + lc.name + ' 归附 ' + wc.name + '（' + list.length + ' 省，' + (opt.via || '并入') +
        (keepN ? ' · 转编 ' + keepN + ' 支' : '') + '）'
      : '💀 ' + lc.name + ' 灭亡 —— 全境并入 ' + wc.name + '（剩省 ' + list.length + '，投降线 ' +
        Math.round(frac100(loser) * 100) + '%）';
    WARLOG.unshift({ turn: turnNo, cls: opt.puppet ? 'ok' : 'bad', text: txt });
    if (PLAYER === loser || PLAYER === winner) NOTES.push({ owner: PLAYER, cls: 'warn', text: txt });
    /* 「世界消息」（v15）：灭国是最大的那种远方大事 —— 也最经不起传话，
     * 0 档会把"某国挨打"传成"某国已亡"，所以它同样走情报渠道 */
    if (PLAYER !== loser && PLAYER !== winner) {
      worldNews(txt.replace(opt.puppet ? '🏳 ' : '💀 ', ''), 'bad',
        { parties: [loser, winner], kind: opt.puppet ? 'puppet' : 'fall' });
    }
    if (PLAYER === loser) toast('你被灭了 —— ' + wc.name + ' 吞并了 ' + lc.name + '。可以「退出游戏」回到工坊模式。', 6000);
    return { ok: true, list: list, n: list.length, keep: keepN, text: txt };
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
      /* v11 护栏优先（§9 ① / §10）：名义军费已经吃掉 60% 岁入的国家不再动员新军 ——
       * "少征兵，不掏空国库"。判据在 18-ai 的 milRatioOf 里，和 guardMil 同一份算法，
       * 所以"护栏说超了"和"这里不许征兵"永远是同一句话。 */
      if (AO.aiDebug && AO.aiDebug.canRecruit && !AO.aiDebug.canRecruit(c.id)) continue;
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
      /* v19：装备从**武库**发（不是省库）—— 有兵刃发兵刃、有炮发炮，都没有就是裸兵。
       * 裸兵能守不能攻，AI 也不会拿它去进攻（见 18-ai 的 aiEquipFit）。 */
      var pick = bestWeapon(c.id);
      var bw = arsBestWeapon(c.id), bg = arsBest(c.id, 'gun');
      var cen = ensureCentral(c.id);
      /* 与玩家同价：AI 的民兵动员也付同一个单价 —— 同规则，不是两套账 */
      cen.gold = Math.max(0, (cen.gold || 0) - AO.RECRUIT.goldPerUnit);
      var a = newArmy(c.id, spot, { type: 'army', men: AO.RECRUIT.aiMen });
      if (bw) issueWeapon(a, bw.key, true);
      if (bg) issueGun(a, bg.key, true);
      syncArms(a);
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
      var p = pOf(a.pid), it = unitOf(a);
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
      /* 战争分（v9）：轰击"小胜" +1 —— 只有真打出伤害（削墙或杀伤）才算，
       * 空放一轮不加分，否则只要摆一门炮就能刷分。 */
      if (tp && (wallCut > 0 || dead > 0)) wsAdd(a.owner, tp.owner, 'bombard');
      WARLOG.unshift({ turn: turnNo, cls: 'warn',
        text: '💥 ' + (pOf(a.pid) || {}).name + ' 的' + unitNameOf(a) + '轰击 ' + (tp ? tp.name : '?') + '：' +
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
      /* 三维（v19）：快档（mov ≥ 3）一回合行军 2 省 —— 轻装疾行的那一份装备
       * 在这一行兑现。将领的「奔袭」仍然叠加（取大的那个）。 */
      if (unitOf(a).mov >= AO.BATTLE.fastMove) steps = Math.max(steps, AO.BATTLE.fastMoveHops);
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
  function declareWar(a, b, opt) {
    opt = opt || {};
    if (!a || !b || a === b) return { ok: false, msg: '不能对自己宣战' };
    if (countryDead(a) || countryDead(b)) return { ok: false, msg: '对方已经灭亡了' };
    /* 外交锁（v13）：傀儡不能宣战 —— 它的兵是宗主的，仗也该由宗主去开。
     * force 只给"揭竿而起"用：那一下是它**唯一**能自己决定的开战。 */
    if (!opt.force) {
      var suz = suzerainOf(a);
      if (suz) {
        return { ok: false, msg: nameOf(a) + ' 听命于宗主 ' + nameOf(suz) + '，不能自行宣战' };
      }
      /* 反过来也不行：宣战自己的属国是自相矛盾（它的兵本来就要跟着你打）。
       * 想要那块地走「强并入」—— 那才是这一档关系的最后一个动作。 */
      if (suzerainOf(b) === (a | 0)) {
        return { ok: false, msg: nameOf(b) + ' 是你的属国 —— 要收地走「强并入」，不必宣战' };
      }
    }
    var k = warKey(a, b);
    if (WARSET[k]) return { ok: false, msg: '已经在交战' };
    /* 条约禁止互宣：同盟 / 互不侵犯的国家之间，宣战钮是置灰的（面板层），
     * 这里再挡一次 —— 挡的是"绕过面板直接调"的路径（AI、测试、将来的快捷键）。
     * 想打就先毁约：毁约那一下才记"背信"，宣战本身不额外罚。 */
    var wasAlly = isAlly(a, b), wasNap = isNap(a, b);
    if (wasAlly) breakPact(a, b, 'ally', true);
    else if (wasNap) breakPact(a, b, 'nap', true);
    WARSET[k] = true;
    /* 战争分从零开始（v9）：上一仗的分不能带进这一仗。
     * 缔约冷却 / 求和冷却也一并清掉 —— 那是上一段关系的账。 */
    WSCORE[k] = { a: 0, b: 0 };
    delete TALKCD[k];
    delete DIPCD[cdKey(a, b, 'ally')];
    delete DIPCD[cdKey(a, b, 'nap')];
    warBaseOf(a, b);
    /* 宣战把关系打到谷底（v6）：交战国边境立刻降级为 seen/unknown ——
     * 昨天还能看见的邻居，今天隔着一道战线 */
    setRel(a, b, FOG.relWar);
    var ca = coOf(a), cb = coOf(b);
    var txt = '📜 ' + (ca ? ca.name : '?') + ' 向 ' + (cb ? cb.name : '?') + ' 宣战' +
      (wasAlly ? '（撕毁同盟 —— 背信）' : wasNap ? '（撕毁互不侵犯条约 —— 背信）' : '');
    WARLOG.unshift({ turn: turnNo, cls: 'bad', text: txt });
    /* v10：只有**玩家参与**的仗才直接进纪要。AI 之间的宣战走世界纪要
     * （带 🌍 前缀、每回合限量 2 条）—— 不然 36 国一开打，玩家的提示条就废了。 */
    if (PLAYER === a || PLAYER === b) NOTES.push({ owner: PLAYER, cls: 'warn', text: txt });
    if (wasAlly || wasNap) {
      /* 「背信」一条要让全世界都看见（战报是天下共读的那份记录），
       * 所以除了上面那条宣战，再单独记一条背信 —— 战报里读起来是两件事。 */
      WARLOG.unshift({ turn: turnNo, cls: 'bad',
        text: '⚑ 背信：' + (ca ? ca.name : '?') + ' 撕毁与 ' + (cb ? cb.name : '?') + ' 的' +
          (wasAlly ? '同盟' : '互不侵犯') + '并宣战' });
    }
    /* 盟友对同一国宣战：提示玩家"可以跟牌"（军事跟进不强制，见 spec ②） */
    if (PLAYER && PLAYER !== a && PLAYER !== b && isAlly(PLAYER, a)) {
      NOTES.push({ owner: PLAYER, cls: 'ok',
        text: '🤝 盟友 ' + (ca ? ca.name : '?') + ' 已对 ' + (cb ? cb.name : '?') +
          ' 宣战 —— 跟不跟？（同盟不强制参战）' });
    }
    /* 「世界消息」（v15）：两边都不是玩家 → 攒进邸报（结算尾只放**到期**的那几条） */
    if (PLAYER !== a && PLAYER !== b) {
      worldNews(txt.replace('📜 ', '') + (wasAlly || wasNap ? '（背信）' : ''),
        'warn', { parties: [a, b], kind: 'war' });
    }
    /* 兵随宗主（v13）：**单向** leash —— 宗主开战，属国自动同宣（走 WARSET）。
     * 反过来不成立：属国被宣，宗主不流血。这条是"朝贡"比"同盟"硬的那一档：
     * 盟友只是提示你去跟牌，属国不用问，直接上。 */
    leashVassals(a, b);
    /* 宣战后给双方边境军一个默认命令：不然刚宣战谁都不动，玩家会以为没生效 */
    return { ok: true, msg: txt };
  }
  function makePeace(a, b) {
    var k = warKey(a, b);
    if (!WARSET[k]) return { ok: false, msg: '本来就没打' };
    delete WARSET[k];
    /* 停战冷却（v10）：AI 那边读它，停完 20 回合内不重新宣战 ——
     * 不设这条，同一对邻居会变成"打一回合、和、再打"的永动机。
     * 玩家不受限（按钮在玩家手里，爱打就打）。 */
    PEACECD[k] = turnNo + ((AO.AIWAR && AO.AIWAR.peaceCd) || 20);
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
    /* 宗主停战 → 属国跟着停（v13）：它的仗本来就是被拖进来的，宗主收手它没有
     * 单独打下去的理由；而且它自己也媾不了和（AI 侧 tryPeace 对傀儡关掉）。
     * 单向：属国停战不会把宗主一起带走。 */
    var vs = vassalsOf(a), vn;
    for (vn = 0; vn < vs.length; vn++) {
      if (!endWarOneSide(vs[vn], b)) continue;
      var vt = '🕊 ' + nameOf(vs[vn]) + ' 随宗主 ' + nameOf(a) + ' 停战';
      if (PLAYER === a || PLAYER === b || PLAYER === vs[vn]) {
        NOTES.push({ owner: PLAYER, cls: 'ok', text: vt });
      } else {
        worldNews(vt.replace('🕊 ', ''), 'ok', { parties: [vs[vn], a, b], kind: 'peace' });
      }
    }
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
    /* 换了国 → 「维修」面板看的是另一个国家：红点和面板一起重算 */
    if (typeof refreshRepBadge === 'function') refreshRepBadge();
    if (REPU && REPU.open) renderRepPanel();
    /* 工坊段（尺寸 / 种子 / 生成 / 涂色 / 自检）：
     * 选了国就整段收起 —— 对局中按「生成新世界」等于把刚选的国换掉。
     * 这是选国 / 退出唯一的副作用处（choosePlayer 和 exitGame 都走这里）。 */
    var wb = $('workshopBar');
    if (wb) wb.style.display = PLAYER ? 'none' : '';
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
    /* 世界消息（v15）的"耳目圈"= 自国省 + 已探省的邻国 —— 迷雾一变它就变，
     * 所以挂在同一个入口上清，不另找地方（漏一处就是"探了新地界，消息还是听不见"）。 */
    newsFogTouch();
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
  function addRel(a, b, d) {
    if (!a || !b || a === b) return;
    RELHIT[warKey(a, b)] = turnNo;          // 这一回合有事件 → 缓释跳过它
    setRel(a, b, relOf(a, b) + d);
  }

  /* =============================================================
   * 外交层（v9）：条约 / 战争分 / 谈判桌 / 跨国贸易
   *
   * REL 还是那张 -100~100 的无序对表（键 warKey），这一层只做三件事：
   *   ① 给 REL 加**驱动**与**缓释**（见 settleDiplo）；
   *   ② 在它上面长出条约（同盟 / 互不侵犯）与战争分；
   *   ③ 谈判桌 + 外国货源两个"用得上关系值"的地方。
   *
   * 一条贯穿始终的原则：**面板上写的每个数都能从存档里复算**。
   * 关系值、战争分、冷却、贸易累计全是普通数字表，没有隐藏状态。
   * ============================================================= */

  /* ---------------- 一、关系值的读法 ---------------- */
  function relTier(v) {
    var t = (AO.DIPLO && AO.DIPLO.rel.tiers) || [];
    for (var i = 0; i < t.length; i++) if (v >= t[i].min) return t[i];
    return { key: 'plain', cn: '普通', min: 0 };
  }
  function relCn(v) { return relTier(v).cn; }
  AO.resRelTier = relTier;
  AO.resRelCn = relCn;

  /* ---------------- 二、条约（同盟 / 互不侵犯） ---------------- */
  function isAlly(a, b) { return !!(a && b && a !== b && ALLIES[warKey(a, b)]); }
  function isNap(a, b) { return !!(a && b && a !== b && NAPS[warKey(a, b)]); }
  function pactOf(a, b) { return isAlly(a, b) ? 'ally' : isNap(a, b) ? 'nap' : ''; }
  function pactCn(kind) { return kind === 'ally' ? '同盟' : kind === 'nap' ? '互不侵犯' : '无'; }
  /* 缔约冷却的键：**带 kind**。同盟被拒不该把互不侵犯也一起锁住 ——
   * 那是两件事（"不想跟你结盟"不等于"不想跟你互不侵犯"）。 */
  function cdKey(a, b, kind) { return warKey(a, b) + '|' + kind; }
  AO.resIsAlly = isAlly;
  AO.resIsNap = isNap;
  AO.resPactOf = pactOf;

  /* 性格权重：军国 −10（谁都不信）/ 均衡 0 / 经营 +10（和气生财）。
   * 读的是 18-ai.js 已经算好的性格（personaOf 是纯读，不会替它掷新值）——
   * 这一批**不改 18-ai.js**，只借它的结果用。 */
  function personaKeyOf(cid) {
    var key = 'balanced', dbg = AO.aiDebug;
    if (dbg && dbg.personaOf) {
      try { key = dbg.personaOf(cid | 0) || 'balanced'; } catch (e) { key = 'balanced'; }
    }
    return key;
  }
  function personaWeightOf(cid) {
    var m = (AO.DIPLO.eval.persona) || {};
    var key = personaKeyOf(cid);
    return typeof m[key] === 'number' ? m[key] : 0;
  }
  /* 共同敌人：和 cid 交战、同时也和 other 交战的国家有几个（有就算"敌人的敌人"） */
  function commonEnemyOf(a, b) {
    var n = 0;
    for (var k in WARSET) {
      if (!WARSET[k]) continue;
      var ab = k.split('|'), x = +ab[0], y = +ab[1];
      var o = x === (a | 0) ? y : (y === (a | 0) ? x : 0);
      if (o && atWar(b, o)) n++;
    }
    return n;
  }

  /* AI 对外缔约的评估（**本批只提供接口**，消费在 18-ai.js 的下一批）。
   * 公式就是任务书那一条：REL + 性格权重 + 共同敌人加成，≥ accept 才答应；
   * 另外还有一道硬门槛（同盟 REL≥60 / 互不侵犯 REL≥20）——
   * 分数够了但交情没到，一样不签：那是"信任"，不是"算账"。 */
  function aiDiploEval(cid, kind, other) {
    cid = cid | 0; other = other | 0;
    /* 扶植傀儡（v13）：**另一套账**（分差/性格/快顶不住了），不在缔约这套里，
     * 但入口留在一起 —— 上层（谈判桌 / AI / 测试）只需要记一个名字。 */
    if (kind === 'puppet') return aiPuppetEval(cid, other);
    var D = AO.DIPLO;
    var need = kind === 'ally' ? D.ally.need : D.nap.need;
    var rel = relOf(cid, other);
    var pw = personaWeightOf(cid);
    var ce = commonEnemyOf(cid, other) ? D.eval.commonEnemy : 0;
    var score = rel + pw + ce;
    var dead = countryDead(cid) || countryDead(other);
    var war = atWar(cid, other);
    var why = '';
    if (dead) why = '对方已经灭亡';
    else if (war) why = '两国还在交战';
    else if (rel < need) why = '关系 ' + rel + ' 没到 ' + need + '（' + pactCn(kind) + '门槛）';
    else if (score < D.eval.accept) why = '评估 ' + score + ' 低于 ' + D.eval.accept +
      '（关系 ' + rel + ' + 性格 ' + (pw >= 0 ? '+' : '') + pw + (ce ? ' + 共同敌人 ' + ce : '') + '）';
    return {
      cid: cid, kind: kind, other: other,
      rel: rel, persona: pw, common: ce, score: score, need: need,
      accept: !why, why: why
    };
  }
  AO.aiDiploEval = aiDiploEval;

  function nameOf(cid) { var c = coOf(cid | 0); return c ? c.name : '?'; }

  /* 提议缔约（玩家在国家卡上按的钮走这里；AI 下一批也走这里）。
   * 被拒 → 记 10 回合冷却（DIPLO.ally.cd / nap.cd），不是"永久记仇"。 */
  function proposePact(from, to, kind) {
    from = from | 0; to = to | 0;
    var D = AO.DIPLO;
    if (!from || !to) return { ok: false, msg: '要指定一个国家' };
    if (from === to) return { ok: false, msg: '不能和自己缔约' };
    if (kind !== 'ally' && kind !== 'nap') return { ok: false, msg: '没有这种条约' };
    if (countryDead(from) || countryDead(to)) return { ok: false, msg: '对方已经灭亡了' };
    if (atWar(from, to)) return { ok: false, msg: '交战中不能缔约 —— 先求和' };
    /* 外交锁（v13）：傀儡不能对外缔约 —— 它的外交权在宗主手里。
     * 两侧都判：自己是傀儡不能签，对方是傀儡也签不了（那张表上没有它说话的份）。 */
    var suzF = suzerainOf(from), suzT = suzerainOf(to);
    if (suzF) return { ok: false, msg: nameOf(from) + ' 听命于宗主 ' + nameOf(suzF) + '，不能对外缔约' };
    if (suzT) return { ok: false, msg: nameOf(to) + ' 听命于宗主 ' + nameOf(suzT) + '，不能对外缔约' };
    if (isAlly(from, to)) return { ok: false, msg: '已经是同盟了' };
    if (isNap(from, to)) return { ok: false, msg: '已经有互不侵犯条约了' };
    var k = warKey(from, to), ck = cdKey(from, to, kind), cd = DIPCD[ck] || 0;
    if (turnNo < cd) return { ok: false, msg: '对方刚拒绝过，还要等 ' + (cd - turnNo) + ' 回合' };
    var ev = aiDiploEval(to, kind, from);
    if (!ev.accept) {
      DIPCD[ck] = turnNo + (kind === 'ally' ? D.ally.cd : D.nap.cd);
      DIPPROP[k] = { kind: kind, ok: false, turn: turnNo };
      var no = '🕊 ' + nameOf(to) + ' 拒绝了 ' + nameOf(from) + ' 的' + pactCn(kind) + '提议：' + ev.why;
      NOTES.push({ owner: from, cls: 'warn', text: no });
      return { ok: false, msg: no, ev: ev };
    }
    if (kind === 'ally') ALLIES[k] = true; else NAPS[k] = true;
    addRel(from, to, kind === 'ally' ? D.rel.ally : D.rel.nap);
    /* 同盟的地板：结盟那一刻就把关系托到 60（+40 之后通常还不够） */
    if (kind === 'ally' && relOf(from, to) < D.rel.allyFloor) {
      setRel(from, to, D.rel.allyFloor);
    }
    DIPPROP[k] = { kind: kind, ok: true, turn: turnNo };
    var txt = '🤝 ' + nameOf(from) + ' 与 ' + nameOf(to) + ' 缔结' + pactCn(kind) +
      '（关系 ' + relOf(from, to) + ' · ' + relCn(relOf(from, to)) + '）';
    WARLOG.unshift({ turn: turnNo, cls: 'ok', text: txt });
    NOTES.push({ owner: from, cls: 'ok', text: txt });
    NOTES.push({ owner: to, cls: 'ok', text: txt });
    fogInvalidate();
    return { ok: true, msg: txt, ev: ev };
  }
  AO.resProposePact = proposePact;

  /* 毁约（玩家按「毁约」钮，或者宣战前自动走一遍）。
   * 毁盟 −50（背信），作废互不侵犯 −20。silent = 由宣战顺手触发时不重复刷提示。 */
  function breakPact(a, b, kind, silent) {
    a = a | 0; b = b | 0;
    var D = AO.DIPLO, k = warKey(a, b);
    kind = kind || pactOf(a, b);
    if (!kind) return { ok: false, msg: '本来就没有条约' };
    if (kind === 'ally') {
      if (!ALLIES[k]) return { ok: false, msg: '本来就不是同盟' };
      delete ALLIES[k];
      addRel(a, b, D.rel.breakAlly);
    } else {
      if (!NAPS[k]) return { ok: false, msg: '本来就没有互不侵犯条约' };
      delete NAPS[k];
      addRel(a, b, D.rel.napEnd);
    }
    DIPPROP[k] = { kind: kind, ok: false, turn: turnNo };
    /* 「背信」一条进战报 —— 战报是**天下共读**的那份记录，
     * 所以"全世界都知道你撕了约"不用给 64 个国家各推一条纪要。
     * silent（宣战顺手毁约）时不写：那条路自己会写一条"撕毁并宣战"，
     * 两条一起上，战报里就是同一件事说两遍。 */
    var txt = '⚑ 背信：' + nameOf(a) + ' 撕毁与 ' + nameOf(b) + ' 的' + pactCn(kind) +
      '（关系 ' + relOf(a, b) + '）';
    if (!silent) {
      WARLOG.unshift({ turn: turnNo, cls: 'bad', text: txt });
      NOTES.push({ owner: a, cls: 'warn', text: txt });
      NOTES.push({ owner: b, cls: 'warn', text: txt });
    }
    fogInvalidate();
    return { ok: true, msg: txt };
  }
  AO.resBreakPact = breakPact;

  /* ---------------- 三、战争分 ---------------- */
  function wsOf(a, b) {
    var k = warKey(a, b);
    var s = WSCORE[k];
    if (!s || typeof s !== 'object') s = WSCORE[k] = { a: 0, b: 0 };
    if (typeof s.a !== 'number' || !isFinite(s.a)) s.a = 0;
    if (typeof s.b !== 'number' || !isFinite(s.b)) s.b = 0;
    return s;
  }
  /* 某一方在这对关系里的分（a 是小 id 那一方，所以要先看自己在哪边） */
  function wsScoreOf(cid, other) {
    cid = cid | 0;
    var k = warKey(cid, other), s = wsOf(cid, other);
    return (+k.split('|')[0] === cid) ? s.a : s.b;
  }
  /* 记分：只在**两国真的在打**的时候记 —— 打叛军、打路人都不算战功。 */
  function wsAdd(a, b, kind) {
    a = a | 0; b = b | 0;
    if (!a || !b || a === b) return 0;
    if (!atWar(a, b)) return 0;
    var add = (AO.DIPLO.score || {})[kind] || 0;
    if (!add) return 0;
    var k = warKey(a, b), s = wsOf(a, b);
    if ((+k.split('|')[0]) === a) s.a += add; else s.b += add;
    return add;
  }
  AO.resWsScoreOf = wsScoreOf;
  AO.resWsOf = wsOf;

  /* ---------------- 四、每回合的缓释与清理 ---------------- */
  /* 关系值缓释：无事件时每回合向 0 走 1。
   * 三条例外，每条都有理由：
   *   ① 交战中的两国**不缓释** —— 战线在那儿，关系没有"自然回暖"这回事；
   *   ② 这一回合被事件动过的不缓释 —— 刚结的盟不该当场被扣回 1；
   *   ③ 同盟有 60 的地板 —— 盟友之间关系再淡也淡不到翻脸。 */
  function settleDiplo() {
    var w = state.world;
    if (!w) return;
    var D = AO.DIPLO, cs = w.countries, i, j, k;
    /* 灭亡国的条约/冷却/战争分清掉：不清的话同盟表里会躺着一个死国，
     * 面板上就是"与 ? 结盟"，而且那张表永远不会自己干净。 */
    function deadKey(kk) {
      var ab = kk.split('|');
      return countryDead(+ab[0]) || countryDead(+ab[1]);
    }
    for (k in ALLIES) if (deadKey(k)) delete ALLIES[k];
    for (k in NAPS) if (deadKey(k)) delete NAPS[k];
    for (k in WSCORE) if (deadKey(k)) delete WSCORE[k];
    for (k in DIPCD) if (deadKey(k)) delete DIPCD[k];
    for (k in TALKCD) if (deadKey(k)) delete TALKCD[k];
    for (k in DIPPROP) if (deadKey(k)) delete DIPPROP[k];
    for (k in TRADEACC) if (deadKey(k)) delete TRADEACC[k];
    for (k in RELACC) if (deadKey(k)) delete RELACC[k];
    /* 傀儡表同样清死国（v13）：不清的话"奉表于 ?"会永远躺在面板上 */
    for (k in PUPPET) if (deadKey(k)) delete PUPPET[k];
    /* 宗主 ⇄ 傀儡的关系锁（v13）：钉在 −80（貌合神离）。
     * 缓释在这里**不适用** —— 一层"称臣"的关系不会因为几年没打仗就回暖；
     * 想回暖只有一条路：散伙（独立或者并入）。 */
    var PLOCK = (AO.DIPLO.puppet && AO.DIPLO.puppet.relLock) || -80;
    for (k in PUPPET) {
      if (!PUPPET[k]) continue;
      if (REL[k] !== PLOCK) REL[k] = PLOCK;
    }

    for (i = 0; i < cs.length; i++) {
      var ca = cs[i];
      if (!ca) continue;
      for (j = i + 1; j < cs.length; j++) {
        var cb = cs[j];
        if (!cb) continue;
        var a = ca.id, b = cb.id, kk = warKey(a, b);
        if (countryDead(a) || countryDead(b)) continue;
        if (atWar(a, b)) continue;
        /* 傀儡与宗主之间不缓释（关系锁由上面那段直接写死） */
        if (PUPPET[kk]) continue;
        if (RELHIT[kk] === turnNo) continue;
        var v = relOf(a, b);
        if (v > 0) v -= D.rel.drift;
        else if (v < 0) v += D.rel.drift;
        if (isAlly(a, b) && v < D.rel.allyFloor) v = D.rel.allyFloor;
        /* 直接写 REL（不走 setRel）：缓释本身不该把 RELHIT 又标一次，
         * 否则"没事件"这条判据下回合永远不成立 */
        if (v !== relOf(a, b)) REL[kk] = AO.clamp(Math.round(v), -100, 100);
      }
    }
    fogInvalidate();
  }
  AO.resSettleDiplo = settleDiplo;

  /* ---------------- 五、跨国贸易（关系值的最小消费点） ---------------- */
  /* 一笔生意 +0.5 关系，累计上限 +20。
   * REL 是整数表（setRel 会 round），+0.5 直接加会被抹平 —— 攒整（RELACC）
   * 是老套路（TAXACC / IRONACC 一个道理）：攒够 1 才真落袋。 */
  function addTradeRel(a, b) {
    var D = AO.DIPLO, k = warKey(a, b);
    var acc = TRADEACC[k] || 0;
    if (acc >= D.rel.tradeCap) return 0;
    var d = Math.min(D.rel.trade, D.rel.tradeCap - acc);
    TRADEACC[k] = acc + d;
    RELACC[k] = (RELACC[k] || 0) + d;
    var whole = Math.floor(RELACC[k]);
    if (whole > 0) { RELACC[k] -= whole; addRel(a, b, whole); }
    return d;
  }
  AO.resAddTradeRel = addTradeRel;

  /* 外国货源：REL ≥ 20 的存续外国，各自"该资源最富的省"有货才算一个来源。
   * 为什么按最富省取货：那是它真有货的地方；挑一个空省挂个"有货"的牌子
   * 只会让玩家点了才发现买不到。
   *
   * 价格（v14）：`buyLot.gold × premium × 对方 PI` —— 对方缺这种资源，
   * 你去买就贵；对方积压，你去买就便宜。**这就是跨国价差**，
   * 也是"货源行显示对方价与本国价对比"的依据（gap 是差多少百分比）。
   * 排序：便宜的在前面（同一个 key 里按 price 升序）——
   * 价格板上看见谁家便宜，货源表第一条就该是谁家。 */
  function foreignSources(p, key) {
    var D = AO.DIPLO, out = [];
    var w = state.world;
    if (!w || !p) return out;
    var lot = AO.GOV.buyLot(), myPi = priceV(p.owner, key);
    for (var i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === p.owner) continue;
      if (countryDead(c.id)) continue;
      if (atWar(p.owner, c.id)) continue;
      if (relOf(p.owner, c.id) < D.trade.minRel) continue;
      var best = null, bestN = 0;
      for (var j = 0; j < c.provinces.length; j++) {
        var q = pOf(c.provinces[j]);
        if (!q) continue;
        var st = stockOf(q.id, key);
        if (st > bestN) { bestN = st; best = q; }
      }
      if (!best || bestN < lot.n) continue;
      var pi = priceV(c.id, key);
      out.push({
        cid: c.id, name: c.name, pid: best.id, prov: best.name,
        stock: bestN, n: lot.n, price: fBuyGold(c.id, key), pi: pi, myPi: myPi,
        gap: myPi > 0 ? (1 - pi / myPi) : 0,
        rel: relOf(p.owner, c.id)
      });
    }
    out.sort(function (x, y) { return x.price - y.price || y.stock - x.stock; });
    return out;
  }
  AO.resForeignSources = foreignSources;

  /* 买外国货：扣本省省库金 → 金进对方该资源最富省的省库 → 货进本省。
   * **不走调拨**，所以没有损耗 —— 这是"直接跟外国人买"，不是"从国内运"。
   * 封锁省断供（和世界市场进货同一条闸）。 */
  /* asAi=true：AI 走同一条账，但**不写 bldMsg、不受 canAct 锁**
   * （那不是"按玩家的东西"，是 AI 自己的省在买货）。
   * 所有失败分支统一返回 { ok:false, msg }，AI 侧静默跳过。 */
  function buyForeign(p, key, cid, asAi) {
    var fail = asAi
      ? function (t) { return { ok: false, msg: t }; }
      : function (t) { return bldMsg(t, 'warn'); };
    if (!asAi && !canAct(p.owner)) return fail(lockTitle());
    if (BLOCKADE[p.id]) return fail('本省被舰队封锁，买不了货');
    var mk = MARKET[p.id];
    if (!mk || !(mk.n > 0)) return fail('本省还没有市场');
    if (mk.halted) return fail('市场维护欠费，停产中（买不了货）');
    var bag = SIM[p.id], g = bag && bag.gold;
    if (!g) return fail('本省没有金库');
    var src = null, list = foreignSources(p, key);
    for (var i = 0; i < list.length; i++) if (list[i].cid === (cid | 0)) { src = list[i]; break; }
    if (!src) return fail('这家现在没货（或关系不到 ' + AO.DIPLO.trade.minRel + '）');
    if (g.stock < src.price) {
      return fail('省库金不够：外国货要 ' + src.price + ' 金（省库 ' + g.stock + '）');
    }
    var fbag = SIM[src.pid];
    if (!fbag || !fbag[key] || fbag[key].stock < src.n) {
      return fail(nameOf(cid) + ' 的货已经被人买走了');
    }
    /* 真扣：钱从本省省库出，进对方那个省的省库（同样吃它的库存上限） */
    g.stock -= src.price;
    fbag[key].stock -= src.n;
    gainStock(src.pid, 'gold', src.price, FLOW[src.pid]);
    var got = gainStock(p.id, key, src.n, FLOW[p.id]);
    var d = addTradeRel(p.owner, cid);
    if (!asAi) {
      bldMsg('买 ' + src.n + ' ' + cnOf(key) + ' ← ' + nameOf(cid) + '·' + src.prov +
        '（' + src.price + ' 金 = 基准 × 溢价 ' + AO.DIPLO.trade.premium +
        ' × 对方' + cnOf(key) + '价 ' + priceNum(src.pi) + '）' +
        (got < src.n ? '　⚠ 省库满仓，只收下 ' + got : '') +
        (d > 0 ? '　关系 +' + d : '　关系已到贸易上限'), 'ok');
    }
    fogInvalidate();
    return { ok: true, got: got, paid: src.price, rel: d };
  }
  AO.resBuyForeign = buyForeign;
  /* AI 的买货入口（18-ai 的 tryTrade）：同一个函数，只是不带玩家那套提示 */
  AO.resAiBuy = function (p, key, cid) { return buyForeign(p, key, cid, true); };

  /* ---------------- 出口（③：倒卖闭环的另外半边） ----------------
   * 买是"缺了去外面买"，卖到外国是"多了卖给外面" —— 一边是救急，一边是生意。
   *
   * 规则（全部写在按钮 title 里）：
   *   ① 只列 REL ≥ minRel、不在交战、且**对方这种资源比本国贵**的国家
   *      （价差小于 minSpread 也列出来没意义 —— 那是白搬货）；
   *   ② 卖一手 exportLot 单位 → 到手 `对方 PI × exportCut` 金（八折，
   *      那两成是运费 + 中间商）；
   *   ③ 货从**本省**库存出，进对方该资源最富省的库存；
   *   ④ 每省每回合最多 exportPerTurn 笔（EXP1 存回合号）。
   *
   * **为什么这条链不会变成印钞机**：货进了对方库存 → 对方比值上去 →
   * 对方目标价下来 → 价差收窄。所以"一直卖同一家"会自己赚不到钱，
   * 玩家得去找下一个缺货的邻国 —— 这正是我们要的经济行为。
   *
   * 记账：己方 FLOW.gain.export 记**货量**（不是金额，金额走 gain.gold，
   * 因为金真的进了省库）；对方 FLOW.gain.import 记同一批货量。
   * 两边记同一个单位，所以 bench 里"对账相等"可以直接比数。 */

  /* 出口对象：谁愿意出高价。按**价差**降序（赚得最多的排第一）。
   *
   * 收货省怎么挑：**对方这种资源最富的省**（那是它真有仓的地方），
   * 但如果那个省已经顶到库存上限（cap 150），货就白送了 —— 换个"装得下"的省。
   * 一个国家所有省都装满，就不出现在列表里（送过去也是烂在路上）。
   * 这一步同时保证了两边记账能对上：出口 n = 进口 n（下面 exportForeign 里）。 */
  function exportSources(p, key) {
    var D = AO.DIPLO, C = AO.PRICES_CFG, out = [];
    var w = state.world;
    if (!w || !p) return out;
    var myPi = priceV(p.owner, key);
    for (var i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      if (!c || c.id === p.owner || !c.provinces || !c.provinces.length) continue;
      if (countryDead(c.id)) continue;
      if (atWar(p.owner, c.id)) continue;
      if (relOf(p.owner, c.id) < D.trade.minRel) continue;
      var pi = priceV(c.id, key);
      if (pi - myPi < C.minSpread) continue;
      /* 先按库存挑最富的省；装不下就退到"空位最多"的省 */
      var best = null, bestN = -1, roomy = null, roomMax = 0;
      for (var j = 0; j < c.provinces.length; j++) {
        var q = pOf(c.provinces[j]);
        if (!q) continue;
        var st = stockOf(q.id, key), room = capOf(q.id, key) - st;
        if (st > bestN) { bestN = st; best = q; }
        if (room > roomMax) { roomMax = room; roomy = q; }
      }
      if (!best) continue;
      var target = best;
      if (capOf(best.id, key) - bestN < C.exportLot) {
        if (roomMax < C.exportLot) continue;    // 全境装满 → 不列
        target = roomy;
      }
      out.push({
        cid: c.id, name: c.name, pid: target.id, prov: target.name,
        stock: stockOf(target.id, key),
        n: C.exportLot, pi: pi, myPi: myPi, gain: expGold(c.id, key),
        spread: pi - myPi, rel: relOf(p.owner, c.id)
      });
    }
    out.sort(function (x, y) { return y.spread - x.spread; });
    return out;
  }
  AO.resExportSources = exportSources;

  function exportForeign(p, key, cid, asAi) {
    var C = AO.PRICES_CFG;
    var fail = asAi ? function (t) { return { ok: false, msg: t }; }
      : function (t) { return bldMsg(t, 'warn'); };
    if (!asAi && !canAct(p.owner)) return fail(lockTitle());
    if (BLOCKADE[p.id]) return fail('本省被舰队封锁，出不了货');
    var mk = MARKET[p.id];
    if (!mk || !(mk.n > 0)) return fail('本省还没有市场');
    if (mk.halted) return fail('市场维护欠费，停产中（出不了货）');
    if ((EXP1[p.id] | 0) === turnNo) {
      return fail('本省这回合已经出过一笔了（每省每回合 ' + C.exportPerTurn + ' 笔）');
    }
    var n = C.exportLot, s = SIM[p.id] && SIM[p.id][key];
    if (!s || s.stock < n) return fail(cnOf(key) + ' 不够：出口一手要 ' + n);
    var src = null, list = exportSources(p, key);
    for (var i = 0; i < list.length; i++) if (list[i].cid === (cid | 0)) { src = list[i]; break; }
    if (!src) return fail('这家现在不出这个价（对方' + cnOf(key) + '价没比本国高）');
    var q = pOf(src.pid);
    if (!q) return fail('对方的收货省没了');
    /* 真扣：货出本省、进对方最富省；钱进本省省库（攒整，见 sellResource） */
    s.stock -= n;
    var raw = expGold(cid, key);
    SELLACC[p.id] = (SELLACC[p.id] || 0) + raw;
    var whole = Math.floor(SELLACC[p.id] + 1e-9);
    SELLACC[p.id] = SELLACC[p.id] - whole;
    if (whole > 0) gainStock(p.id, 'gold', whole, flowOf(p.id));
    var took = gainStock(q.id, key, n, flowOf(q.id));
    /* 双方对账：己方记"出口了多少货"，对方记"进口了多少货"（同单位） */
    var F = flowOf(p.id), FQ = flowOf(q.id);
    F.gain.export = (F.gain.export || 0) + (took > 0 ? n : 0);
    FQ.gain.import = (FQ.gain.import || 0) + took;
    EXP1[p.id] = turnNo;
    var d = addTradeRel(p.owner, cid);
    if (!asAi) {
      bldMsg('出口 ' + n + ' ' + cnOf(key) + ' → ' + nameOf(cid) + '·' + src.prov +
        '：+' + priceNum(raw) + ' 金（对方价 ' + priceNum(src.pi) + ' × ' + C.exportCut +
        '，本国价 ' + priceNum(src.myPi) + '）' +
        (whole < raw - 1e-9 ? '　零头攒整' : '') +
        (d > 0 ? '　关系 +' + d : ''), 'ok');
    }
    fogInvalidate();
    return { ok: true, got: whole, raw: raw, qty: n, to: src.pid, rel: d };
  }
  AO.resExportForeign = exportForeign;
  /* AI 的出口入口（18-ai 的 trySell）：同一条账，不带玩家提示 */
  AO.resAiExport = function (p, key, cid) { return exportForeign(p, key, cid, true); };

  /* 「商队到访」（⑤ 新事件）的落地：外国商人以 ×mul 价收本省 10 单位土产。
   * 为什么"挑最富的那样"：商队收的是这地方拿得出手的货，不是随便一样；
   * 而且库存最多的那种卖起来最不心疼，玩家不会因为一个随机事件被抽走命根子。
   * 钱走 SELLACC 攒整（和卖货同一个零头池），所以"卖 2.6 金"能真的到手 2.6。 */
  function caravanDeal(pid, key, mul) {
    var C = AO.PRICES_CFG, bag = SIM[pid | 0];
    var p = pOf(pid);
    if (!bag || !p) return null;
    if (!key) {
      var bestN = 0;
      for (var k in bag) {
        if (k === 'gold') continue;
        var s = bag[k];
        if (s && s.stock > bestN) { bestN = s.stock; key = k; }
      }
    }
    if (!key) return null;
    var s2 = bag[key];
    var n = Math.min(10, s2 ? Math.floor(s2.stock) : 0);
    if (!(n > 0)) return null;
    var lots = n / (AO.MARKET.rate || 5);
    var raw = priceV(p.owner, key) * (mul || 1.3) * lots;
    s2.stock -= n;
    SELLACC[pid | 0] = (SELLACC[pid | 0] || 0) + raw;
    var whole = Math.floor(SELLACC[pid | 0] + 1e-9);
    SELLACC[pid | 0] -= whole;
    if (whole > 0) gainStock(pid | 0, 'gold', whole, flowOf(pid));
    if (PLAYER && (p.owner | 0) === PLAYER) {
      NOTES.push({ owner: PLAYER, pid: pid | 0, cls: 'ok',
        text: '🐫 商队收走 ' + n + ' ' + cnOf(key) + '，付 ' + priceNum(raw) + ' 金（物价 ×' +
          (mul || 1.3) + '，当时' + cnOf(key) + '价 ' + priceNum(priceV(p.owner, key)) + '）' });
    }
    return { key: key, n: n, gold: raw };
  }
  AO.resCaravan = caravanDeal;

  /* ---------------- 六、谈判桌 ----------------
   * 只有 PLAYER 能开（交战国卡上的「求和」钮），对象必须是正在交战的国。
   * 三条条款：
   *   白和        永远可选 —— 双方就地停手、现状承认。**必被接受**：
   *               输的一方连停都停不下来，投降线就成了唯一出口。
   *   赔款 50/150 要求己方战争分领先 ≥ payLead(20)，钱从**中央国库**出；
   *               走 AI 的反向评估（对方分 − 己方分 + 性格 + 民心压力 ≥ 0）。
   * 被拒 → 5 回合冷却（TALKCD），期间「求和」钮置灰并写清还要等几回合。 */

  /* AI 愿不愿意接受和议（含赔款）。公式见 DIPLO.talk 的注释：
   *   (对方分 − 己方分) + 性格 + 民心压力 − 要价 ≥ 0
   * 三个输入都能在面板上读到：战争分（谈判卡）、性格（国卡「性格」行）、
   * 民心（国卡「治理」摘要）—— 所以玩家能自己算出对方会不会点头。 */
  function aiPeaceEval(cid, other) {
    cid = cid | 0; other = other | 0;
    var D = AO.DIPLO.talk;
    var mine = wsScoreOf(cid, other), theirs = wsScoreOf(other, cid);
    var pw = personaWeightOf(cid);
    var h = countryHappy(coOf(cid));
    var press = Math.min(D.happyMax, Math.max(0, (D.happyRef - h) / D.happyPer));
    var demand = D.demand || 0;
    var score = (theirs - mine) + pw + press - demand;
    var why = '';
    if (score < 0) {
      why = '战况 ' + mine + ' : ' + theirs + '（对方分 − 己方分 = ' + (theirs - mine) + '）' +
        ' + 性格 ' + (pw >= 0 ? '+' : '') + pw + ' + 民心压力 ' + press.toFixed(1) +
        ' − 要价 ' + demand + ' = ' + score.toFixed(1) + ' < 0';
    }
    return { cid: cid, other: other, mine: mine, theirs: theirs, persona: pw,
      press: press, demand: demand, score: score, accept: score >= 0, why: why };
  }
  AO.aiPeaceEval = aiPeaceEval;

  function talkLead() {
    var to = TALK.to | 0;
    if (!to) return 0;
    return wsScoreOf(PLAYER, to) - wsScoreOf(to, PLAYER);
  }
  function talkCdLeft(cid) {
    var cd = TALKCD[warKey(PLAYER, cid | 0)] || 0;
    return Math.max(0, cd - turnNo);
  }
  function openTalk(cid) {
    cid = cid | 0;
    if (!PLAYER) return toast('先选一个国家（顶栏「开始游戏」）', 2600);
    if (!cid || cid === PLAYER) return toast('不能和自己谈判', 2400);
    if (!atWar(PLAYER, cid)) return toast('两国没在交战', 2400);
    var left = talkCdLeft(cid);
    if (left > 0) return toast('对方刚拒过一次：还要等 ' + left + ' 回合才能再谈', 2800);
    TALK.open = true; TALK.to = cid;
    renderTalk();
    var el = $('talkModal');
    if (el) {
      el.classList.add('on');
      var card = el.querySelector('.evcard');
      if (card) card.focus();
    }
    return { ok: true };
  }
  function closeTalk() {
    TALK.open = false; TALK.to = 0;
    var el = $('talkModal');
    if (el) el.classList.remove('on');
  }
  function renderTalk() {
    var box = $('tkOpts');
    if (!box) return;
    var to = TALK.to | 0, D = AO.DIPLO, c = coOf(to);
    var s = { mine: wsScoreOf(PLAYER, to), theirs: wsScoreOf(to, PLAYER) };
    var lead = s.mine - s.theirs;
    var cen = ensureCentral(PLAYER), gold = Math.floor(cen.gold || 0);
    var tot = Math.max(1, s.mine + s.theirs);
    $('tkTitle').textContent = '谈判桌 · 与 ' + (c ? c.name : '?');
    $('tkWhere').textContent = '第 ' + turnNo + ' 回合 · 战争分 我方 ' + s.mine +
      ' : ' + s.theirs + '（' + (lead >= 0 ? '领先 ' + lead : '落后 ' + (-lead)) + '）· 国库 ' + gold + ' 金';
    /* 战争分对比条：两条按比例分宽度。我方在左、对方在右 ——
     * 和下面的数字同一顺序，不用再找图例。 */
    var bar = $('tkBar');
    if (bar) {
      bar.innerHTML =
        '<i class="tkA" style="flex:' + (s.mine / tot) + '"></i>' +
        '<i class="tkB" style="flex:' + (s.theirs / tot) + '"></i>';
    }
    $('tkText').textContent = lead >= D.talk.payLead
      ? '战争分领先 ' + lead + '（≥ ' + D.talk.payLead + '）：可以提赔款' +
        (lead >= (D.puppet ? D.puppet.talkLead : 40)
          ? '，也可以扶植傀儡（≥ ' + D.puppet.talkLead + '）' : '') +
        '。白和永远可选。'
      : '战争分领先 ' + lead + '（不到 ' + D.talk.payLead + '，提不了赔款）：只能白和 —— 现状承认。';
    var h = '';
    h += '<button type="button" class="evopt" data-term="white">' +
      '<b>白和 · 就地停手</b><em>现状承认：谁占着的地就归谁，不赔不割。必被接受</em></button>';
    /* 赔款按钮上给一句"对方会不会点头"的软判断 —— 不报数字，
     * 只说口气（这是谈判桌该有的信息：你能看出对面在硬撑还是撑不住了）。
     * 判断读的就是 AO.aiPeaceEval，和真点下去用的是同一份账。 */
    var ev0 = aiPeaceEval(to, PLAYER);
    var mood = ev0.accept
      ? (ev0.score >= 5 ? '对方战况不利，多半会点头' : '对方还能接受，但不会痛快')
      : '对方还有底气，多半会拒（拒了要等 ' + D.talk.cd + ' 回合）';
    for (var i = 0; i < D.talk.payTiers.length; i++) {
      var amt = D.talk.payTiers[i];
      var off = lead < D.talk.payLead || gold < amt;
      var tip = lead < D.talk.payLead ? '战争分要领先 ' + D.talk.payLead + ' 才能提赔款'
        : gold < amt ? '国库只有 ' + gold + ' 金，赔不起 ' + amt : '从国库赔 ' + amt + ' 金，换对方点头';
      h += '<button type="button" class="evopt" data-term="pay' + amt + '"' + (off ? ' disabled' : '') +
        ' title="' + escHtml(tip) + '"><b>赔款 ' + amt + ' 金 · 停战</b><em>' +
        (off ? escHtml(tip) : escHtml(mood)) + '</em></button>';
    }
    /* 扶植傀儡（v13）：比赔款更重的胜利 —— 不割地，收租。
     * 解锁线比赔款高一倍（40 对 20），因为它换来的是一条长期关系，不是一笔现钱。
     * 按钮上的口气同样读真账（aiPuppetEval），和点下去用的是同一个分数。 */
    var P = D.puppet;
    if (P && lead >= P.talkLead) {
      var evP = aiPuppetEval(to, PLAYER);
      var moodP = evP.accept
        ? (evP.score >= 8 ? '对方已经撑不住，多半会奉表' : '对方还在算账，但这一笔谈得成')
        : '对方宁死不屈，多半会拒（拒了要等 ' + D.talk.cd + ' 回合）';
      h += '<button type="button" class="evopt" data-term="puppet">' +
        '<b>扶植傀儡 · 称臣停战</b><em>' + escHtml(moodP) +
        '　不割地：它留着自己的省，每回合上贡两成岁入，兵随你调</em></button>';
    }
    h += '<button type="button" class="evopt" data-term="cancel"><b>先不谈</b><em>关掉谈判桌，仗接着打</em></button>';
    box.innerHTML = h;
    var btns = box.querySelectorAll('button[data-term]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        var term = this.getAttribute('data-term');
        if (term === 'cancel') { closeTalk(); return; }
        var r = talkDeal(term);
        if (r && r.msg) toast(r.msg, 3200);
        if (!TALK.open) {
          if (state.renderer && state.renderer.selectedCountry) showCountry(state.renderer.selectedCountry);
        }
      });
    }
  }
  /* 成交 / 被拒都从这里走，返回 { ok, msg }。
   * 赔款：先评估再转账 —— 顺序反了的话"被拒还扣了钱"是最难解释的那种 bug。 */
  function talkDeal(kind) {
    var to = TALK.to | 0, D = AO.DIPLO;
    if (!PLAYER || !to) return { ok: false, msg: '没有正在进行的谈判' };
    if (!atWar(PLAYER, to)) { closeTalk(); return { ok: false, msg: '两国已经不在交战' }; }
    var k = warKey(PLAYER, to);
    var lead = talkLead(), pay = 0;
    /* 扶植傀儡（v13）：单独一条路 —— 它不走赔款/白和那套转账，成交就是"停战 + 立表"。 */
    if (kind === 'puppet') return talkPuppet(to, lead);
    if (kind === 'white') {
      pay = 0;
    } else if (/^pay\d+$/.test(kind)) {
      pay = +kind.slice(3);
      if (D.talk.payTiers.indexOf(pay) < 0) return { ok: false, msg: '没有这一档赔款' };
      if (lead < D.talk.payLead) {
        return { ok: false, msg: '战争分领先 ' + lead + '，不到 ' + D.talk.payLead + '，提不了赔款' };
      }
      var cen = ensureCentral(PLAYER);
      if ((cen.gold || 0) < pay) {
        return { ok: false, msg: '国库只有 ' + Math.floor(cen.gold || 0) + ' 金，赔不起 ' + pay };
      }
    } else {
      return { ok: false, msg: '没有这一条' };
    }
    if (pay > 0) {
      var ev = aiPeaceEval(to, PLAYER);
      if (!ev.accept) {
        TALKCD[k] = turnNo + D.talk.cd;
        closeTalk();
        var no = '🕊 ' + nameOf(to) + ' 拒绝了赔款和议：' + ev.why +
          '（' + D.talk.cd + ' 回合后可再谈）';
        NOTES.push({ owner: PLAYER, cls: 'warn', text: no });
        return { ok: false, msg: no, ev: ev };
      }
    }
    var r = applyPeaceDeal(PLAYER, to, pay);
    closeTalk();
    return r;
  }

  /* 谈判桌上的「扶植傀儡」（v13）。
   * 三道闸：领先分够（40）、这层关系立得起来（它不能已经有主）、AI 点头。
   * **地不吐**：已经占下的省留在占领方手里（这里一行都不动归属）——
   * 傀儡交出来的是腰包和兵，不是已经打下来的地。 */
  function talkPuppet(to, lead) {
    var D = AO.DIPLO, P = D.puppet;
    to = to | 0;
    if (lead < P.talkLead) {
      return { ok: false, msg: '战争分领先 ' + lead + '，不到 ' + P.talkLead + '，提不了扶植傀儡' };
    }
    if (!canTakeVassal(PLAYER, to)) {
      return { ok: false, msg: suzerainOf(PLAYER) ? '你正在称臣于 ' + nameOf(suzerainOf(PLAYER)) + '，受不了表'
        : suzerainOf(to) ? (nameOf(to) + ' 已经奉表于 ' + nameOf(suzerainOf(to)))
          : (nameOf(to) + ' 自己还有属国，不能称臣') };
    }
    var ev = aiPuppetEval(to, PLAYER);
    if (!ev.accept) {
      TALKCD[warKey(PLAYER, to)] = turnNo + D.talk.cd;
      closeTalk();
      var no = '🏳 ' + nameOf(to) + ' 拒绝了称臣：' + ev.why +
        '（' + D.talk.cd + ' 回合后可再谈）';
      NOTES.push({ owner: PLAYER, cls: 'warn', text: no });
      return { ok: false, msg: no, ev: ev };
    }
    var r = makePuppet(PLAYER, to);
    closeTalk();
    return r;
  }

  /* 停战成交（含赔款转账）：**玩家谈判桌与 AI 求和共用这一段** ——
   * 两边的账必须走同一条路，否则"AI 的赔款到不了账"这种 bug 只会在一边出现。
   * 赔款从 from 的中央国库出（扣不起就按有的给，不欠账），进 to 的中央国库。 */
  /* 从一国**全境**抽金（中央 → 各省省库，先抽最富的省）。
   * 赔款为什么要能抽省库：AI 的中央国库常年是空的（钱都在省里），
   * 只认中央的话"求和"在 AI 之间永远成不了 —— 一个连 50 金都掏不出的败方
   * 只能等亡国。玩家这边同理：赔款是国家掏钱，不是某一本账掏钱。 */
  function drawGold(owner, need) {
    need = Math.max(0, Math.round(need || 0));
    if (!need) return 0;
    var cen = ensureCentral(owner), got = 0;
    var t0 = Math.min(cen.gold || 0, need);
    if (t0 > 0) { cen.gold -= t0; got += t0; }
    if (got >= need) return got;
    var list = countryProvinces(owner).slice().sort(function (x, y) {
      return stockOf(y.id, 'gold') - stockOf(x.id, 'gold');
    });
    for (var i = 0; i < list.length && got < need; i++) {
      var g = SIM[list[i].id] && SIM[list[i].id].gold;
      if (!g || !(g.stock > 0)) continue;
      var t = Math.min(g.stock, need - got);
      g.stock -= t;
      got += t;
    }
    return got;
  }
  AO.resDrawGold = drawGold;

  function applyPeaceDeal(from, to, pay) {
    from = from | 0; to = to | 0;
    pay = Math.max(0, Math.round(pay || 0));
    if (pay > 0) {
      pay = drawGold(from, pay);
      var c2 = ensureCentral(to);
      c2.gold = (c2.gold || 0) + pay;
    }
    makePeace(from, to);                              // 停战 + REL 重置 −30 + 战报一条
    if (pay > 0) addRel(from, to, AO.DIPLO.rel.peacePay);   // 和谈赔款 +10
    var txt = '📜 条约：' + nameOf(from) + ' 与 ' + nameOf(to) + ' 停战' +
      (pay > 0 ? '（赔款 ' + pay + ' 金，关系 ' + relOf(from, to) + '）' : '（白和，现状承认）');
    NOTES.push({ owner: from, cls: 'ok', text: txt });
    NOTES.push({ owner: to, cls: 'ok', text: txt });
    /* 两边都不是玩家 → 这是一件"远方的事"，进邸报（v15：要等它走到你耳朵里） */
    if (PLAYER !== from && PLAYER !== to) {
      worldNews(txt.replace('📜 ', ''), 'warn', { parties: [from, to], kind: 'peace' });
    }
    return { ok: true, msg: txt, pay: pay };
  }
  AO.resApplyPeace = applyPeaceDeal;
  /* AI 求和的落手点（18-ai 的 warTick 调它）：走同一段成交逻辑 */
  AO.resAiPeace = function (a, b, pay) { return applyPeaceDeal(a, b, pay); };
  AO.resOpenTalk = openTalk;
  AO.resCloseTalk = closeTalk;
  AO.resTalkDeal = talkDeal;
  AO.resTalk = TALK;

  /* =============================================================
   * 七、傀儡与朝贡（v13）—— 战争的第三种结局
   *
   * 问题：一仗打到"只剩 3 个省"，玩家只有两条路 —— 白和（白打）或者啃到它投降、
   * 然后每省 25~100 回合整合。后期的乐趣就被"一格一格啃"吃掉了。
   *
   * 于是补中间档：**不吞地，收租**。对方交出的是三样东西，不是土地：
   *   ① 腰包 —— 每回合中央金入的 20%（FLOWC 双方各记一笔，国家卡上能对账）
   *   ② 兵   —— 宗主宣战它自动同宣；出兵权重 = 宗主 warBias × 0.5
   *   ③ 外交 —— 不能缔约、不能宣战（卡上置灰"听命于宗主"）
   * 它还是个国家：内政、官员、整合都照跑，只是这三样不归它自己。
   *
   * 退出这条路有三条，各有各的价：
   *   和平并入（满 60 回合 + 民心 ≥55 + 没被拖着打 → 60%）：省白得，还是正式国土
   *   强并入（随时）：快，但宗主全国民心 −8、并入各省不安 +30
   *   揭竿而起（傀儡自己掷）：宗主陷 2 场战争 / 它兵够多 / 民心思变，凑够 40 分独立
   *
   * 一仗只能有一个结果，所以这张表和 WARSET 互斥：称臣那一刻战争结束，
   * 独立那一刻战争重开 —— 三张表（WARSET / WSCORE / PUPPET）之间不留中间态。
   * ============================================================= */

  /* ---------------- 7.1 读表 ---------------- */
  /* 一国当傀儡的那份记录（没有就是 null）。表很小（≤ 64 条），线性找足够快，
   * 而且"一国只能当一家的属国"这条不变量靠的就是"按 p 找唯一"。 */
  function puppetRecOf(cid) {
    cid = cid | 0;
    if (!cid) return null;
    for (var k in PUPPET) {
      var r = PUPPET[k];
      if (r && (r.p | 0) === cid) return r;
    }
    return null;
  }
  function suzerainOf(cid) {
    var r = puppetRecOf(cid);
    return r ? (r.s | 0) : 0;
  }
  function vassalsOf(cid) {
    cid = cid | 0;
    var out = [], k, r;
    if (!cid) return out;
    for (k in PUPPET) {
      r = PUPPET[k];
      if (r && (r.s | 0) === cid) out.push(r.p | 0);
    }
    return out.sort(function (a, b) { return a - b; });
  }
  /* 两国之间的那条记录（不分方向） */
  function puppetRec(a, b) {
    a = a | 0; b = b | 0;
    if (!a || !b || a === b) return null;
    var r = PUPPET[warKey(a, b)];
    if (!r) return null;
    return ((r.s | 0) === a && (r.p | 0) === b) || ((r.s | 0) === b && (r.p | 0) === a) ? r : null;
  }
  /* 能不能收它当属国：不能自己已经是傀儡、不能自己还有属国（没有"傀儡的傀儡"） */
  function canTakeVassal(suz, pup) {
    suz = suz | 0; pup = pup | 0;
    if (!suz || !pup || suz === pup) return false;
    if (countryDead(suz) || countryDead(pup)) return false;
    if (suzerainOf(suz) || suzerainOf(pup)) return false;   // 自己称臣的人不能受表
    if (vassalsOf(pup).length) return false;                // 它自己还带着附庸
    var sc = coOf(suz), pc = coOf(pup);
    if (!sc || !pc || !sc.provinces.length || !pc.provinces.length) return false;
    return true;
  }
  /* 傀儡不能有条约：称臣那一刻把旧的清掉（同盟 / 互不侵犯 / 缔约冷却全清）。
   * 不清的话"我和 A 是同盟，A 又是 B 的属国"会同时成立 —— 面板上两张卡各说各话。 */
  function stripPacts(a, b) {
    var k = warKey(a, b);
    delete ALLIES[k];
    delete NAPS[k];
    delete DIPCD[cdKey(a, b, 'ally')];
    delete DIPCD[cdKey(a, b, 'nap')];
    delete DIPPROP[k];
  }
  /* 投降线（省数）：和 trySurrender / 国家卡上那一行**同一个算法**，
   * 免得"卡上写 ≤4 省、实际 ≤3 省触发"。有 WARBASE 就按开战时的省数，
   * 没有（还没打过的关系）就按现省数。 */
  function surrenderLineOf(cid, other) {
    cid = cid | 0;
    var c = coOf(cid), base = c ? c.provinces.length : 0;
    if (other) {
      var wb = WARBASE[warKey(cid, other)];
      if (wb) base = (warKey(cid, other).split('|')[0] | 0) === cid ? wb.a : wb.b;
    }
    var frac = isDecap(cid) ? AO.BATTLE.surrenderFracDecap : AO.BATTLE.surrenderFrac;
    return Math.max(1, Math.ceil((base || 1) * frac));
  }
  function warsOfCid(cid) {
    var n = 0, k;
    cid = cid | 0;
    for (k in WARSET) {
      if (!WARSET[k]) continue;
      var ab = k.split('|');
      if (+ab[0] === cid || +ab[1] === cid) n++;
    }
    return n;
  }
  function menOfCid(cid) {
    var list = armiesOf(cid | 0), sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i].men || 0;
    return sum;
  }

  /* ---------------- 7.2 立傀儡／废傀儡 ---------------- */
  /* 称臣：停战 + 清条约 + 立表 + REL 锁死。
   * 走 makePeace 而不是"自己删 WARSET"：那是唯一会顺手解围城、解封锁、
   * 把军队从"进攻"改成"驻防"的地方 —— 少这一步，称臣当天它的围城军还在你城下。 */
  function makePuppet(suz, pup, opt) {
    suz = suz | 0; pup = pup | 0;
    opt = opt || {};
    var D = AO.DIPLO.puppet;
    if (!suz || !pup || suz === pup) return { ok: false, msg: '不能对自己称臣' };
    if (countryDead(suz) || countryDead(pup)) return { ok: false, msg: '对方已经灭亡了' };
    if (suzerainOf(pup)) {
      return { ok: false, msg: nameOf(pup) + ' 已经奉表于 ' + nameOf(suzerainOf(pup)) };
    }
    if (!canTakeVassal(suz, pup)) {
      return { ok: false, msg: vassalsOf(pup).length
        ? nameOf(pup) + ' 自己还有属国，不能称臣'
        : nameOf(suz) + ' 现在受不了表（它自己也在称臣）' };
    }
    if (atWar(suz, pup)) makePeace(suz, pup);
    stripPacts(suz, pup);
    var k = warKey(suz, pup);
    PUPPET[k] = {
      s: suz, p: pup,
      since: turnNo,
      /* 绝对回合号（和 TALKCD 同一种写法）：到这个回合之后才允许提「和平并入」 */
      annexCd: turnNo + (opt.annexCd || D.annexCd || 60),
      warT: -999
    };
    delete WSCORE[k];
    delete TALKCD[k];
    setRel(suz, pup, D.relLock);
    fogInvalidate();
    var txt = '🏳 ' + nameOf(pup) + ' 奉表称臣于 ' + nameOf(suz) +
      '（岁贡两成 · 兵随宗主 · 不得自专外交）';
    WARLOG.unshift({ turn: turnNo, cls: 'ok', text: txt });
    if (PLAYER === pup) {
      NOTES.push({ owner: PLAYER, cls: 'warn', text: txt + ' —— 你成了属国：外交被锁，兵随宗主，' +
        '每 10 回合有一次机会揭竿而起（主角光环 +' + D.indepPlayer + ' 分）' });
      toast('你被迫称臣于 ' + nameOf(suz) + '。内政照旧，但外交被锁、兵随宗主 —— 等机会独立。', 6000);
    } else if (PLAYER === suz) {
      NOTES.push({ owner: PLAYER, cls: 'ok', text: txt + ' —— 每回合上贡它的中央金入 ' +
        Math.round(D.tribute * 100) + '%，' + (D.annexCd | 0) + ' 回合后可和平并入' });
    } else {
      worldNews(txt.replace('🏳 ', ''), 'ok', { parties: [pup, suz], kind: 'puppet' });
    }
    return { ok: true, msg: txt };
  }
  /* 废表（独立 / 并入前的一步）。REL 不在这里重置：独立要走 declareWar（它自己会打到 −100），
   * 并入则整国都没了，关系值跟着 deadKey 一起清。 */
  function dropPuppetRec(suz, pup) {
    delete PUPPET[warKey(suz, pup)];
  }

  /* ---------------- 7.3 朝贡 ---------------- */
  /* 每回合把傀儡**中央金收入**的两成划给宗主。
   * 为什么按"本回合收入"而不是"库存"：按库存分的话，一个攒了 400 金的属国
   * 会在称臣第一回合被一次抽走 80 金 —— 那不是岁贡，是抄家。按收入分是细水长流，
   * 也让"傀儡中央见底就少付、不欠账"这条自然成立（收入高但花光了，就是付不出）。 */
  function puppetTribute() {
    var D = AO.DIPLO.puppet, out = { paid: 0, n: 0 }, k, r;
    for (k in PUPPET) {
      r = PUPPET[k];
      if (!r) continue;
      var s = r.s | 0, p = r.p | 0;
      if (!s || !p || countryDead(s) || countryDead(p)) continue;
      var FC = FLOWC[p] || ensureFlowC(p);
      var inc = (FC.gain && FC.gain.gold) || 0;
      if (!(inc > 0)) continue;
      /* 攒整（和 TAXACC / IRONACC 同一套办法）：一个小国的中央金入常常只有
       * 2~4 金/回合，直接 floor(2×0.2)=0 会让"朝贡"在整局里一次都不落袋，
       * 玩家看到的是一条永远为 0 的账。攒着零头，攒够 1 金才真划过去 ——
       * 长期平均仍然是两成，但每四五回合能看见一次钱。 */
      r.acc = (r.acc || 0) + inc * (D.tribute || 0);
      var want = Math.floor(r.acc);
      if (want <= 0) continue;
      r.acc -= want;
      var cenP = ensureCentral(p), cenS = ensureCentral(s);
      /* 中央见底 → 少付不欠：能付多少付多少，剩下的**不记欠账**（acc 已经扣掉）。
       * 记欠账的话，一个破产的属国会攒出一笔永远还不上的天文数字。 */
      var pay = Math.min(want, Math.floor(cenP.gold || 0));
      if (pay <= 0) {
        r.short = true;
        continue;
      }
      r.short = false;
      cenP.gold = (cenP.gold || 0) - pay;
      cenS.gold = (cenS.gold || 0) + pay;
      FC.loss.gold = (FC.loss.gold || 0) + pay;
      FC.d.tribute = (FC.d.tribute || 0) + pay;
      var FS = FLOWC[s] || ensureFlowC(s);
      FS.gain.gold = (FS.gain.gold || 0) + pay;
      FS.d.tribute = (FS.d.tribute || 0) + pay;
      out.paid += pay; out.n++;
    }
    return out;
  }

  /* ---------------- 7.4 强制参战（单向 leash） ---------------- */
  /* 宗主宣战 → 傀儡自动同宣。**单向**：傀儡被宣，宗主不参战 ——
   * 这是"护主"和"卖命"的区别，也是玩家愿意当宗主的原因（属国挨打不用我流血）。
   * 走的是"直接写 WARSET"而不是再调一次 declareWar：那边会做条约撕毁、纪要、
   * 盟友跟牌提示，而傀儡这几样一个都不适用（它没有条约，也不该上报"宣战"）。 */
  function leashOne(suz, v, foe) {
    suz = suz | 0; v = v | 0; foe = foe | 0;
    if (!suz || !v || !foe || v === foe) return false;
    if (countryDead(v) || countryDead(foe) || atWar(v, foe)) return false;
    var k = warKey(v, foe);
    WARSET[k] = true;
    WSCORE[k] = { a: 0, b: 0 };
    delete TALKCD[k];
    warBaseOf(v, foe);
    setRel(v, foe, FOG.relWar);
    var rec = PUPPET[warKey(suz, v)];
    if (rec) rec.warT = turnNo;
    var txt = '⚑ ' + nameOf(v) + ' 随宗主 ' + nameOf(suz) + ' 出征，讨伐 ' + nameOf(foe);
    WARLOG.unshift({ turn: turnNo, cls: 'warn', text: txt });
    if (PLAYER === v || PLAYER === foe || PLAYER === suz) {
      NOTES.push({ owner: PLAYER, cls: 'warn', text: txt });
    } else {
      worldNews(txt.replace('⚑ ', ''), 'warn', { parties: [v, foe], kind: 'war' });
    }
    return true;
  }
  function leashVassals(suz, foe) {
    var vs = vassalsOf(suz), n = 0, i;
    for (i = 0; i < vs.length; i++) if (leashOne(suz, vs[i], foe)) n++;
    return n;
  }
  /* 宗主停战 → 属国跟着停（它的仗本来就是被拖进来的） */
  function endWarOneSide(x, y) {
    x = x | 0; y = y | 0;
    var k = warKey(x, y), pid;
    if (!WARSET[k]) return false;
    delete WARSET[k];
    PEACECD[k] = turnNo + ((AO.AIWAR && AO.AIWAR.peaceCd) || 20);
    setRel(x, y, FOG.relPeace);
    for (pid in SIEGE) if (SIEGE[pid].by === x || SIEGE[pid].by === y) delete SIEGE[pid];
    for (pid in BLOCKADE) if (BLOCKADE[pid] === x || BLOCKADE[pid] === y) delete BLOCKADE[pid];
    var ids = armyIds(), i;
    for (i = 0; i < ids.length; i++) {
      var ar = ARMY[ids[i]];
      if (!ar) continue;
      if ((ar.owner === x || ar.owner === y) && ar.order &&
          (ar.order.type === 'attack' || ar.order.type === 'siege')) {
        ar.order = { type: 'defend', cid: ar.owner, pid: ar.pid, tactic: 'assault' };
      }
    }
    return true;
  }

  /* ---------------- 7.5 独立（傀儡的挣扎） ---------------- */
  /* 独立分：宗主陷 2+ 场战争 +30 / 军力 ≥ 宗主一半 +20 / 民心 < 35 +10；
   * 玩家当傀儡恒 +15（主角光环 —— 玩家已经没什么可玩的了，给条出路）。
   * 每 10 回合掷一次（按 cid 错开），过 40 分就揭竿而起：自动宣战宗主。
   * 为什么不在过线之前给提示：一次就成的独立太廉价，而"沉默攒着"本身就是
   * 悬念 —— 宗主看得见关系值 −80，看不见它哪天翻脸。 */
  function puppetIndepRoll() {
    var D = AO.DIPLO.puppet, fired = [], k, r;
    var every = D.indepEvery || 10;
    for (k in PUPPET) {
      r = PUPPET[k];
      if (!r) continue;
      var s = r.s | 0, p = r.p | 0;
      if (!s || !p || countryDead(s) || countryDead(p)) continue;
      if ((turnNo + p) % every !== 0) continue;         // 各国错开，免得同回合集体造反
      var sd = indepScoreOf(s, p);
      if (sd.score < (D.indepNeed || 40)) continue;
      var score = sd.score;
      /* 揭竿而起：先删表（不然 declareWar 会被外交锁挡回来），再宣战 */
      dropPuppetRec(s, p);
      declareWar(p, s, { force: true });
      var txt = '🔥 ' + nameOf(p) + ' 揭竿而起，脱离 ' + nameOf(s) + ' 的臣属' +
        '（独立分 ' + score + ' —— 宗主 ' + warsOfCid(s) + ' 场战事）';
      WARLOG.unshift({ turn: turnNo, cls: 'bad', text: txt });
      if (PLAYER === p || PLAYER === s) NOTES.push({ owner: PLAYER, cls: 'warn', text: txt });
      else worldNews(txt.replace('🔥 ', ''), 'bad', { parties: [p, s], kind: 'war' });
      fired.push(p);
    }
    return fired;
  }
  /* 独立分（纯读，不掷点）：三项相加 + 玩家光环。
   * 拎出来是为了测试能直接验"宗主陷战争时明显更易过""玩家 +15"，
   * 而不用等 10 回合一次的掷点。 */
  function indepScoreOf(suz, pup) {
    var D = AO.DIPLO.puppet, out = { war: 0, army: 0, happy: 0, player: 0, score: 0 };
    suz = suz | 0; pup = pup | 0;
    if (warsOfCid(suz) >= (D.indepWars || 2)) out.war = D.indepWar;
    var mp = menOfCid(pup), ms = menOfCid(suz);
    if (mp > 0 && (ms <= 0 || mp >= ms * (D.indepArmyRatio || 0.5))) out.army = D.indepArmy;
    if (countryHappy(coOf(pup)) < (D.indepHappyRef || 35)) out.happy = D.indepHappy;
    if (PLAYER === pup) out.player = D.indepPlayer;
    out.score = out.war + out.army + out.happy + out.player;
    return out;
  }

  /* ---------------- 7.6 每回合的傀儡小节（结算尾） ---------------- */
  function settlePuppets() {
    var out = { tribute: 0, n: 0, indep: [] }, k, r, i;
    if (!state.world) return out;
    /* ① 清表：一方灭亡 / 省空了 → 关系作废。
     * 不清理的话，灭亡国的 PUPPET 记录会永远躺在表里，面板上就是"奉表于 ?"。 */
    for (k in PUPPET) {
      r = PUPPET[k];
      if (!r || countryDead(r.s) || countryDead(r.p)) { delete PUPPET[k]; continue; }
      var sc = coOf(r.s), pc = coOf(r.p);
      if (!sc || !pc || !sc.provinces.length || !pc.provinces.length) delete PUPPET[k];
    }
    /* ② 朝贡 */
    var tr = puppetTribute();
    out.tribute = tr.paid; out.n = tr.n;
    /* ③ 兜底跟战：宗主这一回合打完后的敌国名单里，属国必须都在。
     * 宣战路径（declareWar → leashVassals）已经跟过一遍，但读档、事件宣战、
     * 属国自己被别人拖进来这几条路都不经过它 —— 这里补齐，代价是 O(属国 × 敌国)。 */
    for (k in PUPPET) {
      r = PUPPET[k];
      if (!r) continue;
      var foes = [];
      for (var wk in WARSET) {
        if (!WARSET[wk]) continue;
        var ab = wk.split('|');
        if (+ab[0] === (r.s | 0)) foes.push(+ab[1]);
        else if (+ab[1] === (r.s | 0)) foes.push(+ab[0]);
      }
      for (i = 0; i < foes.length; i++) leashOne(r.s | 0, r.p | 0, foes[i]);
    }
    /* ④ 独立掷点 */
    out.indep = puppetIndepRoll();
    return out;
  }

  /* ---------------- 7.7 AI 接受"扶植傀儡"的评估 ---------------- */
  /* 公式（任务书 ②）：接受分 = 领先分 − evalBase(50) + 性格 + (快顶不住了 ? +20)
   * 和 aiPeaceEval 是两张表：那边算的是"停不停"，这边算的是"服不服"。
   * 性格换了一套权重（军国 −20 宁死不屈 / 经营 +15 识时务）—— 军国宁可亡国也不称臣，
   * 这不是"算错"，是这一型的定义。 */
  function aiPuppetEval(cid, other) {
    cid = cid | 0; other = other | 0;
    var P = AO.DIPLO.puppet;
    var mine = wsScoreOf(cid, other), theirs = wsScoreOf(other, cid);
    var lead = theirs - mine;                        // 提出方（other）领先多少
    var pw = personaWeightPuppetOf(cid);
    var c = coOf(cid), n = c ? c.provinces.length : 0;
    var line = surrenderLineOf(cid, other);
    var near = (line > 0 && n <= Math.ceil(line * (P.nearLine || 1.2))) ? P.nearAdd : 0;
    var score = lead - P.evalBase + pw + near;
    var why = '';
    if (countryDead(cid) || countryDead(other)) why = '对方已经灭亡';
    else if (suzerainOf(other)) why = nameOf(other) + ' 自己也在称臣，受不了表';
    else if (vassalsOf(cid).length) why = nameOf(cid) + ' 自己还有属国，不能称臣';
    else if (suzerainOf(cid)) why = nameOf(cid) + ' 已经奉表于 ' + nameOf(suzerainOf(cid));
    else if (score < 0) {
      why = '领先 ' + lead + ' − ' + P.evalBase + ' + 性格 ' + (pw >= 0 ? '+' : '') + pw +
        (near ? ' + 快顶不住了 ' + near : '') + ' = ' + score + ' < 0';
    }
    return {
      cid: cid, kind: 'puppet', other: other, mine: mine, theirs: theirs, lead: lead,
      persona: pw, near: near, line: line, left: n, score: score,
      need: P.evalBase, accept: !why, why: why
    };
  }
  /* 性格权重的第二张表（见 DIPLO.puppet.persona） */
  function personaWeightPuppetOf(cid) {
    var key = personaKeyOf(cid);
    var m = (AO.DIPLO.puppet && AO.DIPLO.puppet.persona) || {};
    return typeof m[key] === 'number' ? m[key] : 0;
  }

  /* ---------------- 7.8 并入（傀儡的终点） ---------------- */
  /* 复用投降的全并流程，四处不同：
   *   省 = 正式国土（INTEG/OCCUPY 直接删，产出 ×1.0）
   *   官员留任（它本来就是你的地，官不用重新派）
   *   军队解散 70% / 转编 30%
   *   不写「灭亡」，写「归附」*/
  function annexPuppet(suz, pup, mode) {
    var P = AO.DIPLO.puppet, i;
    var rec = puppetRec(suz, pup);
    if (!rec) return { ok: false, msg: '它不是你的属国' };
    var pc = coOf(pup);
    var name = pc ? pc.name : nameOf(pup);
    var merged = pc ? pc.provinces.slice() : [];
    var sProvs = (coOf(suz) ? coOf(suz).provinces.slice() : []);
    dropPuppetRec(suz, pup);
    var r = annex(pup, suz, {
      integrated: true, keepOfficials: true, armyKeep: P.armyKeep,
      via: mode === 'force' ? '强并入' : '和平并入', puppet: mode
    });
    if (mode === 'force') {
      /* 强并入的价（任务书 ④）：宗主全国民心 −8（随后自然回暖 —— 民心本来就
       * 每回合往 target 靠 30%，所以"一回合"不用额外记账）+ 并入各省不安 +30。
       * 快，但会让一个刚打完仗的国家立刻进入"消化不良"的状态。 */
      for (i = 0; i < sProvs.length; i++) {
        var hp = happyOf(sProvs[i]);
        hp.v = AO.clamp(hp.v - P.forceHappy, 0, 100);
      }
      for (i = 0; i < merged.length; i++) {
        var uo = unrestOf(merged[i]);
        uo.v = AO.clamp(Math.max(uo.v, 0) + P.forceUnrest, 0, 100);
      }
      var ft = '⚔ ' + name + ' 被 ' + nameOf(suz) + ' 强行并入 —— 吞并恐慌：并入各省不安 +' +
        P.forceUnrest + '，' + nameOf(suz) + ' 全国民心 −' + P.forceHappy;
      WARLOG.unshift({ turn: turnNo, cls: 'warn', text: ft });
      if (PLAYER === suz || PLAYER === pup) NOTES.push({ owner: PLAYER, cls: 'warn', text: ft });
      else worldNews(ft.replace('⚔ ', ''), 'warn', { parties: [pup, suz], kind: 'annex' });
    }
    return { ok: true, msg: (mode === 'force' ? '强并入' : '和平并入') + '：' + name +
      ' 并入 ' + nameOf(suz) + '（' + merged.length + ' 省，直接算正式国土）', annex: r, n: merged.length };
  }
  /* 和平并入的可用性（面板判一次、真点再判一次 —— 同一份判断） */
  function puppetAnnexReady(suz, pup) {
    var rec = puppetRec(suz, pup);
    if (!rec) return { ok: false, why: '它不是你的属国' };
    var left = Math.max(0, (rec.annexCd || 0) - turnNo);
    if (left > 0) return { ok: false, left: left, why: '还要 ' + left + ' 回合（奉表未满 ' + AO.DIPLO.puppet.annexCd + '）' };
    var P = AO.DIPLO.puppet;
    var h = countryHappy(coOf(pup));
    if (h < P.annexHappy) return { ok: false, happy: h, why: '它民心 ' + Math.round(h) + ' 不到 ' + P.annexHappy + '（人心不服）' };
    var sinceWar = turnNo - ((rec.warT === undefined ? -999 : rec.warT));
    if (sinceWar < P.annexPeace) {
      return { ok: false, why: '它刚被卷进战事（' + sinceWar + ' 回合前），要静 ' + P.annexPeace + ' 回合才肯谈' };
    }
    return { ok: true };
  }
  function tryAnnexPuppet(suz, pup) {
    var P = AO.DIPLO.puppet;
    var rec = puppetRec(suz, pup);
    if (!rec) return { ok: false, msg: '它不是你的属国' };
    var rd = puppetAnnexReady(suz, pup);
    if (!rd.ok) {
      /* 条件不满足也重掷 30 回合：不然玩家每回合都能点一下，
       * "过得好不好"就退化成"点多少次" */
      if (rd.left === undefined) rec.annexCd = turnNo + P.annexRetry;
      return { ok: false, msg: '和平并入被搁置：' + rd.why + '（' + P.annexRetry + ' 回合后可再提）', why: rd.why };
    }
    if (Math.random() >= P.annexAccept) {
      rec.annexCd = turnNo + P.annexRetry;
      var no = '🏳 ' + nameOf(pup) + ' 婉拒了 ' + nameOf(suz) + ' 的并入 —— ' +
        '（' + P.annexRetry + ' 回合后可再提）';
      NOTES.push({ owner: suz, cls: 'warn', text: no });
      if (PLAYER !== suz) worldNews(no.replace('🏳 ', ''), 'warn', { parties: [pup, suz], kind: 'puppet' });
      return { ok: false, msg: no, rejected: true };
    }
    return annexPuppet(suz, pup, 'peace');
  }
  function forceAnnexPuppet(suz, pup) {
    var rec = puppetRec(suz, pup);
    if (!rec) return { ok: false, msg: '它不是你的属国' };
    return annexPuppet(suz, pup, 'force');
  }

  /* ---------------- 7.9 受降选择卡（玩家是胜方时） ----------------
   * 和谈判桌共用同一个弹窗（同一套纸面语汇、同一套 CSS），所以这里只换内容。
   * 为什么不是"自动选"：全吞和收租的取舍正是这一批想给玩家的那个决定 ——
   * 一张立刻见钱的租约 vs 一块要慢慢消化的地。 */
  function openSurrender(loser, winner) {
    SURR.open = true; SURR.loser = loser | 0; SURR.winner = winner | 0;
    TALK.open = true; TALK.to = loser | 0;      // 弹窗里的"对面"就是受降的这一方
    renderSurrender();
    var el = $('talkModal');
    if (el) {
      el.classList.add('on');
      var card = el.querySelector('.evcard');
      if (card) card.focus();
    }
    return { ok: true };
  }
  function closeSurrender() {
    SURR.open = false; SURR.loser = 0; SURR.winner = 0;
    TALK.open = false; TALK.to = 0;
    var el = $('talkModal');
    if (el) el.classList.remove('on');
  }
  function renderSurrender() {
    var box = $('tkOpts');
    if (!box) return;
    var P = AO.DIPLO.puppet, loser = SURR.loser | 0, c = coOf(loser);
    var n = c ? c.provinces.length : 0;
    var mine = wsScoreOf(PLAYER, loser), theirs = wsScoreOf(loser, PLAYER);
    var tot = Math.max(1, mine + theirs);
    var integEst = Math.ceil((AO.INTEG.max || 100) / Math.max(1, AO.INTEG.base || 1));
    $('tkTitle').textContent = '受降 · ' + (c ? c.name : '?');
    $('tkWhere').textContent = '第 ' + turnNo + ' 回合 · 它只剩 ' + n + ' 省（投降线 ≤ ' +
      surrenderLineOf(loser, PLAYER) + '）· 战争分 ' + mine + ' : ' + theirs;
    var bar = $('tkBar');
    if (bar) {
      bar.innerHTML = '<i class="tkA" style="flex:' + (mine / tot) + '"></i>' +
        '<i class="tkB" style="flex:' + (theirs / tot) + '"></i>';
    }
    $('tkText').textContent = '全吞：省全归你，但每一省都要从头整合（最慢约 ' + integEst +
      ' 回合才回满产，期间产出只有四成）。扶植傀儡：省留在它手里，每回合上贡两成岁入，' +
      '兵随你调 —— ' + (P.annexCd | 0) + ' 回合后还能和平并入（省直接算正式国土）。';
    var gold = Math.floor((ensureCentral(loser).gold || 0));
    var h = '';
    h += '<button type="button" class="evopt" data-term="annex"><b>全吞 · 灭其国</b><em>' +
      escHtml('省全归你，逐省整合（约 ' + integEst + ' 回合回满产）· 它的国库 ' + gold + ' 金也归你') +
      '</em></button>';
    h += '<button type="button" class="evopt" data-term="puppet"><b>扶植傀儡 · 收租</b><em>' +
      escHtml('它保留 ' + n + ' 省，每回合上贡两成岁入，兵随你调 —— 立刻见钱，国土以后再说') +
      '</em></button>';
    box.innerHTML = h;
    var btns = box.querySelectorAll('button[data-term]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        var r = surrenderChoose(this.getAttribute('data-term'));
        if (r && r.msg) toast(r.msg, 3600);
      });
    }
  }
  function surrenderChoose(term) {
    var loser = SURR.loser | 0, winner = SURR.winner | 0;
    if (!SURR.open || !loser || !winner) return { ok: false, msg: '没有待决的受降' };
    var c = coOf(loser), name = c ? c.name : nameOf(loser);
    closeSurrender();
    if (term === 'puppet') {
      var r0 = makePuppet(winner, loser);
      if (r0.ok) return r0;
      /* 兜底：称不了臣（比如它已经有主）就按全吞处理 —— 这个国家已经名存实亡，
       * 不能因为"表立不起来"就让它带着 0 个省永远活着。 */
      toast(r0.msg + '　→ 按全吞处理', 3600);
    }
    var r = annex(loser, winner);
    return { ok: true, msg: '💀 ' + name + ' 全境并入（' + (r && r.list ? r.list.length : 0) + ' 省）', annex: r };
  }

  AO.resPuppetOf = suzerainOf;
  AO.resVassalsOf = vassalsOf;
  AO.resPuppetRec = puppetRec;
  AO.resPuppetRecOf = puppetRecOf;
  AO.resMakePuppet = makePuppet;
  AO.resSettlePuppets = settlePuppets;
  AO.resPuppetTribute = puppetTribute;
  AO.resAiPuppetEval = aiPuppetEval;
  AO.resLeashVassals = leashVassals;
  AO.resAnnexPuppet = annexPuppet;
  AO.resTryAnnexPuppet = tryAnnexPuppet;
  AO.resForceAnnexPuppet = forceAnnexPuppet;
  AO.resPuppetAnnexReady = puppetAnnexReady;
  AO.resIndepScore = indepScoreOf;
  AO.resIndepRoll = puppetIndepRoll;
  AO.resSurrenderBranch = surrenderBranch;
  AO.resSurrender = SURR;
  AO.resOpenSurrender = openSurrender;
  AO.resSurrenderChoose = surrenderChoose;
  AO.resSurrenderLine = surrenderLineOf;
  /* 地图注记（14-labels.js）用：傀儡国名后面挂一个"（臣）"。
   * 用函数而不是直接读表，是因为 14-labels 在 Node 自检里也会被单独加载 ——
   * 那种场合没有 11-ui，读表会炸。 */
  AO.puppetTagOf = function (cid) { return suzerainOf(cid) ? '（臣）' : ''; };



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
      /* v15：密探亲眼看过了 —— 之前关于这个国家的那条"风闻"当场更正。
       * 放在这里而不是放在 revealCountry 里：那是"看得见"，这里才是"有人回报"。 */
      newsProbeCorrect(cid);
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
    /* 安定 / 整合 / 安抚同理：不安是"这一刻的真实状态"，旧情报里没有 */
    hideUnrestRows();
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
    maskRow($('cPopCap'), masked);
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
      /* v15：把"世界消息要不要钱"说清楚 —— 这是玩家第一次真正为情报档掏钱的理由 */
      var NW = newsCfg().delay || [[5, 8], [3, 4], [1, 1]];
      var nwTxt = [];
      for (i = 0; i < 3; i++) {
        var rr = NW[i] || [1, 1];
        nwTxt.push(FOG.cn[i] + ' ' + (rr[0] === rr[1] ? rr[0] : rr[0] + '~' + rr[1]));
      }
      tip.innerHTML = '每回合开销 <b>' + FOG.cost[b] + ' 金</b>（国库扣）　·　反谍：抓到密探 ' +
        Math.round(FOG.exposeP[b] * 100) + '%　·　自动织网 ' +
        (FOG.autoEvery[b] ? ('每 ' + FOG.autoEvery[b] + ' 回合 ' + FOG.autoN[b] + ' 省' +
          (FOG.deep[b] ? '（含建筑与驻军）' : '')) : '不织网') +
        '<br>世界大事按情报档延迟送达：' + nwTxt.join(' / ') + ' 回合' +
        (b === 0 ? '（只听得见边境的事，且会传来走样的风闻）' :
          b === 1 ? '（已知国家的事）' : '（已知国家的事 + 战况一行）');
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

  /* ---------------- 外交层的存档（v9，不升 SAVE_VER） ----------------
   * 条约 / 战争分 / 冷却 / 提案状态 / 贸易累计，全是"无序对 → 值"的普通对象，
   * JSON 原样进出。**老档没有这一块** → diploLoad(undefined) 只清空表，
   * 等于"这一局还没人签过条约"，和"新开一局"同一条路（和 WALL / SMELT 一个套路）。
   *
   * REL 本身存在 FOG 里（v6 起），但那份只在 PLAYER>0 时才写 ——
   * 工坊模式存读一次，关系值会整表归零。所以这里**在没选国时**再存一份 REL，
   * 选了国就不重复存（同一份数据存两遍没有意义，64 国约 30KB）。 */
  function diploSave() {
    var out = {
      allies: ALLIES, naps: NAPS, score: WSCORE, cd: DIPCD, talkCd: TALKCD,
      prop: DIPPROP, trade: TRADEACC, relAcc: RELACC,
      /* v10：停战冷却（AI 互战读它，不存的话读档后同一对邻居立刻又能开打） */
      peaceCd: PEACECD,
      /* v13：傀儡表（不升版本号）。存的是"谁向谁称臣 + 什么时候能并"，
       * 朝贡金额不存 —— 那是每回合现算的数，存了反而会跟收入变化打架。 */
      puppet: PUPPET,
      rel: PLAYER ? null : REL
    };
    return out;
  }
  function diploLoad(d) {
    var k;
    for (k in ALLIES) delete ALLIES[k];
    for (k in NAPS) delete NAPS[k];
    for (k in WSCORE) delete WSCORE[k];
    for (k in DIPCD) delete DIPCD[k];
    for (k in TALKCD) delete TALKCD[k];
    for (k in DIPPROP) delete DIPPROP[k];
    for (k in TRADEACC) delete TRADEACC[k];
    for (k in RELACC) delete RELACC[k];
    for (k in RELHIT) delete RELHIT[k];
    for (k in PEACECD) delete PEACECD[k];
    for (k in PUPPET) delete PUPPET[k];
    /* 世界消息（v15）：队列 / 待更正 / 耳目圈都是"这一局"的 ——
     * 清空之后由 newsLoad(d.NEWS) 灌回来（旧档没有那一块 → 空队起步）。 */
    PNEWS.length = 0; RUMOURS.length = 0; newsFogTouch();
    TALK.open = false; TALK.to = 0;
    /* 受降卡是弹窗状态，不进档：读档时那场仗还在，下一回合会重新弹一次 */
    SURR.open = false; SURR.loser = 0; SURR.winner = 0;
    if (!d || typeof d !== 'object') return;
    /* 只认"世界里真有的国家 id"：手改过的档、或者读一份别的种子的档，
     * 会带进来一堆不存在的 cid —— 留着它们面板上就是"与 ? 结盟"。 */
    var ok = function (kk) {
      var ab = String(kk).split('|');
      /* 缔约冷却的键是 'a|b|kind'（三段），其余是两段 —— 只看前两段 */
      if (ab.length < 2) return false;
      var a = +ab[0], b = +ab[1];
      if (!(a > 0) || !(b > 0) || a === b) return false;
      if (!state.world) return true;
      return !!(state.world.countries[a - 1] && state.world.countries[b - 1]);
    };
    var norm = function (src, dst, fn) {
      if (!src || typeof src !== 'object') return;
      for (var kk in src) if (ok(kk)) dst[kk] = fn(src[kk]);
    };
    norm(d.allies, ALLIES, function (v) { return !!v; });
    norm(d.naps, NAPS, function (v) { return !!v; });
    /* 同盟和互不侵犯不可能同时存在：真出现了（手改的档）以同盟为准 */
    for (k in NAPS) if (ALLIES[k]) delete NAPS[k];
    norm(d.score, WSCORE, function (v) {
      v = v || {};
      return {
        a: (typeof v.a === 'number' && isFinite(v.a)) ? Math.round(v.a) : 0,
        b: (typeof v.b === 'number' && isFinite(v.b)) ? Math.round(v.b) : 0
      };
    });
    var turnOf = function (v) { return (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.round(v)) : 0; };
    norm(d.cd, DIPCD, turnOf);
    norm(d.talkCd, TALKCD, turnOf);
    norm(d.peaceCd, PEACECD, turnOf);
    /* 傀儡表（v13）：字段容错 —— 缺 since / annexCd / warT 一律补默认，
     * 手改过的档也不会读出 annexCd=NaN（那会让"距可并入"变成 NaN 回合）。
     * 另外剔掉"自己称臣于自己"这种脏记录。 */
    norm(d.puppet, PUPPET, function (v) {
      v = v || {};
      var s = v.s | 0, p = v.p | 0;
      if (!(s > 0) || !(p > 0) || s === p) return null;
      var since = turnOf(v.since);
      return {
        s: s, p: p, since: since,
        annexCd: Math.max(since, turnOf(v.annexCd) || (since + 60)),
        warT: (typeof v.warT === 'number' && isFinite(v.warT)) ? Math.round(v.warT) : -999,
        /* 朝贡的零头（攒整用）：0~1 之间的小数，缺了就当 0 */
        acc: (typeof v.acc === 'number' && isFinite(v.acc)) ? AO.clamp(v.acc, 0, 1) : 0
      };
    });
    for (k in PUPPET) if (!PUPPET[k]) delete PUPPET[k];
    /* 一国只能当一家的属国：手改的档里出现两条 → 留较早的那条 */
    var seenPup = Object.create(null);
    for (k in PUPPET) {
      var rp = PUPPET[k], pp = rp.p | 0;
      if (seenPup[pp]) { delete PUPPET[k]; continue; }
      seenPup[pp] = 1;
    }
    norm(d.prop, DIPPROP, function (v) {
      v = v || {};
      return {
        kind: (v.kind === 'ally' || v.kind === 'nap') ? v.kind : '',
        ok: !!v.ok, turn: turnOf(v.turn)
      };
    });
    norm(d.trade, TRADEACC, function (v) {
      var x = (typeof v === 'number' && isFinite(v)) ? v : 0;
      return AO.clamp(x, 0, AO.DIPLO.rel.tradeCap);
    });
    norm(d.relAcc, RELACC, function (v) {
      var x = (typeof v === 'number' && isFinite(v)) ? v : 0;
      return AO.clamp(x, 0, 1);
    });
    /* 工坊模式的那份 REL（选了国的档里是 null，REL 由 fogLoad 负责） */
    if (d.rel && typeof d.rel === 'object') {
      for (k in REL) delete REL[k];
      for (k in d.rel) {
        if (!ok(k)) continue;
        var v = d.rel[k];
        if (typeof v === 'number' && isFinite(v)) REL[k] = AO.clamp(Math.round(v), -100, 100);
      }
      fogInvalidate();
    }
  }
  AO.resDiploSave = diploSave;
  AO.resDiploLoad = diploLoad;


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
  /* 不安表的**稀疏 + 瘦身**存档：
   *   ① 只存真的闹过事的省（v 或 target ≥ 0.5）—— 0 是默认值，不该占档；
   *   ② 只存 { v, target }，**丢掉 drivers** —— 那八项每回合都重算，
   *      存下来纯属浪费（1100 省 × 150 字节 ≈ 160 KB，正好把
   *      localStorage 的配额顶到边上：test/gov.js 写第二份存档就撞 QuotaExceeded）。
   * 代价：读档后**第一次 settleUnrest 之前**，省卡的悬停明细是空的
   * （显示"还没结算过"）。一回合就补上了，比存档写不进去划算得多。 */
  function sparseUnrest() {
    var out = Object.create(null);
    for (var k in UNREST) {
      var u = UNREST[k];
      if (!u) continue;
      if ((u.v || 0) < 0.5 && (u.target || 0) < 0.5) continue;
      out[k] = { v: Math.round((u.v || 0) * 10) / 10, target: Math.round((u.target || 0) * 10) / 10 };
    }
    return out;
  }

  /* 物价的瘦身存档：只留"不是基准价"的条目（PRICES_CFG.base 1.0 + 无趋势）。
   * 64 国 × 7 种 = 448 条，全存约 30 KB；把"没动过的"剔掉通常只剩几十条。
   * 数值保留两位小数（cfg.round）—— 三位小数对玩家没意义，对存档配额有意义。 */
  function sparsePrices() {
    var C = AO.PRICES_CFG, r = Math.pow(10, C.round), out = Object.create(null);
    for (var cid in PRICES) {
      var row = PRICES[cid], o = Object.create(null), any = false;
      for (var k in row) {
        var it = row[k];
        if (!it) continue;
        var v = Math.round((it.v || 0) * r) / r, t = Math.round((it.target || 0) * r) / r;
        if (v === C.base && t === C.base && !it.trend) continue;
        o[k] = { v: v, target: t, trend: it.trend | 0 };
        any = true;
      }
      if (any) out[cid] = o;
    }
    return out;
  }

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
      /* 熔旧坊 + 铁税零头（本批新增，不升 SAVE_VER）：
       * SMELT 只存**有炉或有工地**的省（sparseSmelt，1100 省里通常只有几十条）；
       * IRONACC 和 TAXACC 一个道理 —— 不存的话读档后每省的铁税零头归零。 */
      SMELT: sparseSmelt(), IRONACC: IRONACC,
      /* 上解零头（v18.3，**不升 SAVE_VER**）：pid → 小数，只有累进那两段
       * 乘出零头的省才有值；旧档缺这个键 → 空表，零头从 0 起。 */
      REMITACC: REMITACC,
      /* 淘金场（v18 / A，**不升 SAVE_VER**）：和 SMELT 一个瘦身法（sparseWash），
       * 旧档没有这个键 → 读进来是空表，等于"这一局还没人改建过"。 */
      WASH: sparseWash(),
      /* 治理层（v2 新增）：官员池、在任、税率、民心 + 人口税零头。
       * TAXACC 也存 —— 不存的话读档后每省的小数零头归零，
       * 长期看只是慢一点点，但"存档前后税入不一样"会被玩家当成 bug。 */
      TALENT: TALENT, OFFICIAL: OFFICIAL, TAXRATE: TAXRATE, HAPPY: HAPPY,
      /* 宰相（v12，**不升 SAVE_VER**）：owner -> { id,name,traitKey,grade,perms,owed,paused,… }。
       * 旧档没有这个键 → fill 之后是空表，等于"还没拜相"，和新开一局同一条路。 */
      CHANCELLOR: CHANCELLOR,
      TAXACC: TAXACC, GOV_ID: GOV_ID,
      /* 战争层（v3）：五座装备厂（和学校同形状）+ 军队 / 将领 / 外交 / 占领 / 围城 /
       * 封锁 / 灭亡 / 战报 / 征兵队列 + 两个 id 计数器 + 玩家国。
       * 全部是"按 id 挂的普通对象"，JSON 原样进出；id 计数器必须存 ——
       * 不存的话读档后新征的军队会拿到已经用过的 id，两支军队会互相覆盖。 */
      BARRACKS: BARRACKS, ARMORY: ARMORY, STABLE: STABLE, SHIPYARD: SHIPYARD,
      /* 军工产线（v17，**不升 SAVE_VER**）：产线分配 / 装备库存 / 工匠池与派驻。
       * MILLS 只存"有过分配或零头"的省（一间空坊不占档）；
       * EQUIPS 只存有货的国；ARTISANS 只存有人的国 —— 三张表都按需落笔。 */
      MILL: sparseMill(), MILLV: 19, ARSENAL: sparseArsenal(),
      EQUIP: EQUIPS, ARTISAN: ARTISANS, ARTISAN_ID: ARTISAN_ID,
      ARMY: ARMY, GENERALS: GENERALS, ARMY_ID: ARMY_ID, GEN_ID: GEN_ID,
      PLAYER: PLAYER, WARSET: WARSET, WARBASE: WARBASE,
      OCCUPY: OCCUPY, SIEGE: SIEGE, BLOCKADE: BLOCKADE, DEAD: DEAD,
      /* 不安 / 整合 / 匪患 / 安抚冷却 / 预警档（A、B 两批，**不升 SAVE_VER**）。
       * 旧档没有这五块 → fill 之后是空表：不安 0、没有整合记录、没有匪患 ——
       * 等于"这一局还没人闹过事"，和新开一局走同一条路，不写迁移函数。
       * 唯一的例外是**旧档里已经有 OCCUPY 的省**：它们没有 INTEG，
       * 读档后按"刚打下来"（×0.4）算，见产出那一处的兜底。 */
      INTEG: INTEG, UNREST: sparseUnrest(), BANDIT: BANDIT, PACIFY: PACIFY, UNWARN: UNWARN,
      /* 动态市场（v14，**不升 SAVE_VER**）：物价指数 / 事件冲击 / 卖货零头 / 出口闸。
       * 旧档没有这四块 → fill 之后是空表：物价一律回基准 1.0（等价于"这一局还没
       * 交易过"），出口闸 EXP1 空 → 本回合谁都能出口一笔，和"新开一局"同一条路。 */
      PRICES: sparsePrices(), PRICESHOCK: PRICESHOCK, SELLACC: SELLACC, EXP1: EXP1,
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
      AI: AO.aiEconSave ? AO.aiEconSave() : null,
      /* v9：外交层（条约 / 战争分 / 冷却 / 提案状态 / 贸易累计）。
       * **不升版本号**，老档缺这一块 → diploLoad(undefined) 全补默认，
       * 等于"这一局还没人签过条约"，和"新开一局"同一条路。 */
      DIPLO: diploSave(),
      /* 维修档（19-repair.js）：每类建筑每个城的保留座数 / 停修名单。
       * **不升版本号**，老档缺这一块 → repLoad(undefined) 全补默认（= 全开）。 */
      REP: AO.repSave ? AO.repSave() : null,
      /* 平衡分析（20-balance.js）：每回合的收支采样（一国最多 160 点，几十 KB）。
       * **不升版本号** —— 老档缺这一块就从空曲线开始，走几回合又有线了。 */
      BAL: AO.balSave ? AO.balSave() : null,
      /* 世界消息（v15）：待送达队列 + 待更正的账 + bench 统计。
       * **不升版本号** —— 老档缺这一块 → newsLoad(undefined) 空队起步，
       * 和"新开一局"同一条路；存了它才能做到"存档前在路上的一条消息，
       * 读档后还在路上，而且不会凭空变快"。 */
      NEWS: newsSave()
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

  /* 产线分配表的稀疏版：只留"有分配 / 有零头 / 选过品种"的省。
   * 1100 个省的空记录加起来也有几十 KB，而玩家真正摆过产线的通常只有十几省。
   * 零头（prog / acc）也算信息 —— 攒到一半的一炉货不能读档就清零。 */
  function sparseMill() {
    var out = Object.create(null), M = AO.MILL, ow, k, i, has;
    for (ow in MILLS) {
      var m = MILLS[ow];
      if (!m) continue;
      has = false;
      for (k in m.alloc) if ((m.alloc[k] | 0) > 0) has = true;
      for (k in m.prog) if ((m.prog[k] || 0) > 0) has = true;
      if (has) out[ow] = m;
    }
    return out;
  }
  /* 武库：只存有货的国（一张空表不进档） */
  function sparseArsenal() {
    var out = Object.create(null), ow;
    for (ow in ARSENAL) {
      var A = ARSENAL[ow];
      if (!A) continue;
      var has = false, k;
      for (k in A.wpn) if (A.wpn[k] > 0) has = true;
      for (k in A.mount) if (A.mount[k] > 0) has = true;
      for (k in A.gun) if (A.gun[k] > 0) has = true;
      for (k in A.ship) if (A.ship[k] > 0) has = true;
      if (has) out[ow] = A;
    }
    return out;
  }

  /* 旧档迁移（v19，**不升 SAVE_VER**）：v17 的 MILLS 是 **pid 级**的，
   * v19 起是 **owner 级**。折算规则（任务书第九节）：
   *   · 按线合计：同国所有省的 alloc[线] 加起来（封顶到当时的池容量）
   *   · prog 随线走：取同国最大值（同一国只有一条进度）
   *   · 旧 st.order（单订单制）：那一坊没有任何分配时，按"全产能给原产线"折
   * 另外 foundry.n 折进军械坊 1:1（铸炮厂整条删了，它的产能并进同一口锅）。 */
  function millMigrateOld(d) {
    if (!state.world) return 0;
    var n = 0, old = d && d.MILL, pid, i, j, k, g;
    /* foundry → armory 1:1 */
    var fd = d && d.FOUNDRY;
    if (fd) {
      for (pid in fd) {
        var f0 = fd[pid];
        if (!f0 || !(f0.n > 0)) continue;
        var a0 = ARMORY[pid];
        if (!a0) a0 = ARMORY[pid] = newSchool();
        a0.n = (a0.n | 0) + (f0.n | 0);
        if (!n) n = 0;
        n++;
      }
    }
    if (!old) return n;
    var per = Object.create(null);       // owner -> { alloc:{}, prog:{} }
    for (pid in old) {
      var mr = old[pid];
      if (!mr || typeof mr !== 'object') continue;
      var p = pOf(+pid);
      if (!p || !p.owner) continue;
      var ow = p.owner | 0;
      var acc = per[ow] || (per[ow] = { alloc: {}, prog: {} });
      for (k in AO.MILL.poolOf) {
        g = AO.MILL.poolOf[k];
        var src = mr[g] || mr[k] || null;
        if (!src) continue;
        var lines = AO.MILL.lines[g];
        for (j = 0; j < lines.length; j++) {
          var ln = lines[j], v = Math.max(0, src[ln] | 0);
          if (v > 0) acc.alloc[ln] = (acc.alloc[ln] || 0) + v;
        }
        /* 旧线名 → 新线名：v17 的「兵刃」是一条线（wpn），v19 拆成四种类型；
         * 旧档那一份统统算成「刀」（默认类型，AI 也是这么选的）。 */
        var oldWpn = Math.max(0, src.wpn | 0);
        if (oldWpn > 0) acc.alloc.dao = (acc.alloc.dao || 0) + oldWpn;
      }
      for (k in (mr.prog || {})) {
        var pv = +(mr.prog[k] || 0);
        if (!(pv > 0)) continue;
        var short = k.split('.').pop();
        if (short === 'wpn') short = 'dao';
        if (!AO.MILL.kindOf[short]) continue;
        acc.prog[short] = Math.max(acc.prog[short] || 0, pv);
      }
      /* 旧铸炮厂的线（fnd）并进军械池：炮线在 v19 是军械池里的四条线 */
      if (mr.fnd) {
        for (j = 0; j < AO.GUN_ORDER.length; j++) {
          var gl = AO.GUN_ORDER[j], gv = Math.max(0, mr.fnd[gl] | 0);
          if (gv > 0) acc.alloc[gl] = (acc.alloc[gl] || 0) + gv;
        }
      }
      /* 单订单：这一坊没分配 → 全产能给原来那条线 */
      for (i = 0; i < MILL_KINDS.length; i++) {
        var kind = MILL_KINDS[i], st = UNIV[kind][pid];
        if (!st || !st.order) continue;
        var line0 = kind === 'armory' ? 'dao' : st.order;
        if (!AO.MILL.kindOf[line0]) continue;
        if (acc.alloc[line0] > 0) continue;
        acc.alloc[line0] = Math.max(1, millCap(pid, kind));
      }
    }
    for (var ow2 in per) {
      var mm = millOf(+ow2), src2 = per[ow2];
      for (k in src2.alloc) {
        if (!AO.MILL.kindOf[k]) continue;
        mm.alloc[k] = Math.max(0, src2.alloc[k] | 0);
      }
      for (k in src2.prog) {
        if (!AO.MILL.kindOf[k]) continue;
        mm.prog[k] = Math.min(lineWork(+ow2, k), src2.prog[k]);
      }
      /* 封顶到当时的池容量（按工作量从高到低扣） */
      for (i = 0; i < MILL_POOLS.length; i++) {
        var pool = MILL_POOLS[i], cap = poolCap(+ow2, pool), sum = 0;
        var lines2 = AO.MILL.lines[pool];
        for (j = 0; j < lines2.length; j++) sum += mm.alloc[lines2[j]] | 0;
        while (sum > cap) {
          var hi = -1, hiW = -1;
          for (j = 0; j < lines2.length; j++) {
            var l2 = lines2[j], a2 = mm.alloc[l2] | 0;
            if (!a2) continue;
            if (lineWork(+ow2, l2) > hiW) { hiW = lineWork(+ow2, l2); hi = j; }
          }
          if (hi < 0) break;
          mm.alloc[lines2[hi]]--; sum--;
        }
      }
      n++;
    }
    if (n && PLAYER) {
      NOTES.push({ owner: PLAYER, cls: 'ok',
        text: '军工产线已改制（全国口径）：' + n + ' 个国家的旧分配按线合计搬进了新表 —— 打开顶栏「产能」重新分配' });
    }
    return n;
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
    /* 铁矿「深层休眠」迁移（v18 追加一补课，不升存档号）：
     * cool 0 → 48 之后，旧档里那些 `gone: true` 的铁袋读进来就是"刚睡下"——
     *   gone 清掉、cool 起 48、left 留 0（到点由产出循环把 left 回满）。
     * 不在读档时直接补满 left：那等于凭空白送 48 回合的矿，是"回溯重算"。
     * **金袋不动**：金矿 cool 仍是 0，gone 就是永久枯竭（淘金场那一条闭环）。 */
    for (var simPid in SIM) {
      var simBag = SIM[simPid];
      if (!simBag || !simBag.iron || typeof simBag.iron !== 'object') continue;
      var ironS = simBag.iron;
      if (ironS.gone) {
        ironS.gone = false;
        ironS.cool = AO.RESOURCE_BY_KEY.iron.cool;
        ironS.left = 0;
      }
      if (typeof ironS.cool !== 'number' || !isFinite(ironS.cool)) ironS.cool = 0;
    }
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
    /* 熔旧坊（本批新增，不升 SAVE_VER）：旧档没有 SMELT → fill 之后是空表，
     * 等于"这一局还没人改建过"。有的话逐条归一化（n 夹紧、零头补 0），
     * 手改过的档也不炸；空记录顺手剔掉，别让一张 1100 省的空表进档。 */
    fill(SMELT, d.SMELT);
    for (var spid in SMELT) {
      var sr = SMELT[spid];
      if (!sr || typeof sr !== 'object') { delete SMELT[spid]; continue; }
      sr.n = AO.clamp(sr.n | 0, 0, AO.SMELT.maxPer);
      sr.site = Math.max(0, sr.site | 0);
      sr.halted = !!sr.halted;
      if (!sr.mAcc || typeof sr.mAcc !== 'object') sr.mAcc = { iron: 0, gold: 0 };
      if (typeof sr.mAcc.gold !== 'number' || !isFinite(sr.mAcc.gold)) sr.mAcc.gold = 0;
      if (typeof sr.mAcc.iron !== 'number' || !isFinite(sr.mAcc.iron)) sr.mAcc.iron = 0;
      if (typeof sr.iAcc !== 'number' || !isFinite(sr.iAcc)) sr.iAcc = 0;
      if (!sr.n && !sr.site) delete SMELT[spid];
    }
    /* 淘金场（v18 / A，不升 SAVE_VER）：旧档没有 WASH → fill 之后是空表，
     * 等于"这一局还没人改建过"。有的话逐条归一化（和 SMELT 同一套写法）。 */
    fill(WASH, d.WASH);
    for (var wpid2 in WASH) {
      var wr2 = WASH[wpid2];
      if (!wr2 || typeof wr2 !== 'object') { delete WASH[wpid2]; continue; }
      wr2.n = AO.clamp(wr2.n | 0, 0, AO.WASH.maxPer);
      wr2.site = Math.max(0, wr2.site | 0);
      wr2.halted = !!wr2.halted;
      if (!wr2.mAcc || typeof wr2.mAcc !== 'object') wr2.mAcc = { iron: 0, gold: 0 };
      if (typeof wr2.mAcc.gold !== 'number' || !isFinite(wr2.mAcc.gold)) wr2.mAcc.gold = 0;
      if (typeof wr2.mAcc.iron !== 'number' || !isFinite(wr2.mAcc.iron)) wr2.mAcc.iron = 0;
      if (typeof wr2.iAcc !== 'number' || !isFinite(wr2.iAcc)) wr2.iAcc = 0;
      if (typeof wr2.tAcc !== 'number' || !isFinite(wr2.tAcc)) wr2.tAcc = 0;
      if (!wr2.n && !wr2.site) delete WASH[wpid2];
    }
    /* 铁税零头：和 TAXACC 一样存回来，否则读档后"税入比存档前少一点"会被当成 bug */
    fill(IRONACC, d.IRONACC);    for (var ipid in IRONACC) {
      if (typeof IRONACC[ipid] !== 'number' || !isFinite(IRONACC[ipid])) IRONACC[ipid] = 0;
    }
    /* 上解零头（v18.3）：同一套 —— 缺键就是空表，读档后从 0 攒起 */
    fill(REMITACC, d.REMITACC);  for (var rmpid in REMITACC) {
      var rmv = +REMITACC[rmpid];
      REMITACC[rmpid] = (isFinite(rmv) && rmv > 0) ? rmv : 0;
    }
    fill(CENTRAL, d.CENTRAL);
    fill(RESEARCH, d.RESEARCH);
    /* 工艺链折算（v19）：兵器名节点全下树，已研的旧键折成对应的工艺 ——
     * 高级覆盖低级、**不退点数**（那笔账已经花掉了，退回去等于白送科研点）。
     * 映射表只有一份：AO.CRAFT.alias。 */
    for (var row in RESEARCH) {
      var Rd = RESEARCH[row];
      if (!Rd || !Rd.done) continue;
      for (var ok3 in AO.CRAFT.alias) {
        if (!Rd.done[ok3]) continue;
        Rd.done[AO.CRAFT.alias[ok3]] = true;
        delete Rd.done[ok3];
      }
      /* 队列里挂着的旧键也一起折（不然队头永远研不成） */
      if (Rd.queue) {
        for (var qi3 = 0; qi3 < Rd.queue.length; qi3++) {
          var qk3 = AO.CRAFT.alias[Rd.queue[qi3]];
          if (qk3) Rd.queue[qi3] = qk3;
        }
      }
    }
    fill(POP, d.POP);
    fill(TALENT, d.TALENT);
    fill(OFFICIAL, d.OFFICIAL);
    /* 宰相（v12）：旧档没有 CHANCELLOR → 空表；有的话把缺的键补齐
     * （perms / owed / paused 都是后加的字段，读到旧档不能是 undefined） */
    fill(CHANCELLOR, d.CHANCELLOR);
    for (var chk in CHANCELLOR) {
      var ch0 = CHANCELLOR[chk];
      if (!ch0 || typeof ch0 !== 'object') { delete CHANCELLOR[chk]; continue; }
      if (typeof ch0.grade !== 'number' || !AO.CHANCELLOR_LV[ch0.grade]) {
        var g0 = (AO.traitOf(ch0.traitKey) || {}).grade;
        ch0.grade = AO.CHANCELLOR_LV[g0] ? g0 : 1;
      }
      if (!ch0.perms || typeof ch0.perms !== 'object') {
        ch0.perms = { build: 1, research: 1, tax: 1, officials: 1 };
      }
      if (typeof ch0.owed !== 'number' || !isFinite(ch0.owed) || ch0.owed < 0) ch0.owed = 0;
      if (typeof ch0.paused !== 'string') ch0.paused = '';
      if (typeof ch0.adviseAt !== 'number') ch0.adviseAt = turnNo;
    }
    /* 官员的资历 / 怨气 / 俸禄零头（v11 新增字段，**不升版本号**）：
     * 旧档里的官没有这四个键 —— 逐个补默认，和"新开一局"走同一条路。
     * 不补的话 PMOD 里 off.rank 是 undefined，倍率会算出 NaN，整省产出归零。 */
    for (var opid in OFFICIAL) if (OFFICIAL[opid]) offNorm(OFFICIAL[opid]);
    fill(TAXRATE, d.TAXRATE);
    fill(HAPPY, d.HAPPY);
    fill(TAXACC, d.TAXACC);
    /* 战争层（v3）。老档（v1/v2）没有这些键 → fill 之后是空表，
     * 和"新开一局"完全一样，所以不需要写迁移函数。 */
    fill(BARRACKS, d.BARRACKS);
    fill(ARMORY, d.ARMORY);
    fill(STABLE, d.STABLE);
    fill(SHIPYARD, d.SHIPYARD);
    /* 军工产线（v17）：旧档缺这三块 → 空表（= 还没摆过产线 / 还没打过装备 / 还没抽过匠人）。
     * 读进来的记录要逐条归一化：手改过的档 / 别的版本的档可能带 NaN 或越界，
     * 留着会让"产能 2 点"变成"产能 NaN 点"，然后整座坊静默停产。 */
    /* 军工产线（v19：**owner 级**全国表）。MILLV 是"表结构版本"：
     * 没有它（v17/v18 的档）→ 走 millMigrateOld 把 pid 级旧表按线合计搬过来；
     * 有它 → 直接读，逐国归一化（手改过的档带 NaN / 越界也不炸）。 */
    if (d.MILLV === 19) {
      fill(MILLS, d.MILL);
      for (var mow in MILLS) {
        var mr1 = MILLS[mow];
        if (!mr1 || typeof mr1 !== 'object') { delete MILLS[mow]; continue; }
        var mfix = millOf(mow), Mk = AO.MILL, kk2, gg;
        for (kk2 in mfix.alloc) {
          var lv0 = +mr1.alloc[kk2];
          mfix.alloc[kk2] = isFinite(lv0) && lv0 > 0 ? Math.min(99, Math.floor(lv0)) : 0;
        }
        for (kk2 in mfix.prog) {
          var pv1 = +mr1.prog[kk2];
          mfix.prog[kk2] = isFinite(pv1) && pv1 > 0 ? Math.min(99, pv1) : 0;
        }
        for (kk2 in (mr1.form || {})) {
          if (AO.MILL.kindOf[kk2] !== 'blade') continue;
          mfix.form[kk2] = AO.gearOf(AO.GEAR.forms, mr1.form[kk2]).key;
        }
        for (kk2 in (mr1.acc || {})) {
          var av = +(mr1.acc[kk2] || 0);
          mfix.acc[kk2] = isFinite(av) ? Math.max(0, Math.min(0.999, av)) : 0;
        }
        gg = null;
      }
    } else {
      wipe(MILLS);
      millMigrateOld(d);
    }
    /* 武库（v19）：旧档没有 ARSENAL → 空表（= 还没有成品），和"新开一局"同一条路 */
    fill(ARSENAL, d.ARSENAL);
    for (var aow2 in ARSENAL) {
      var ar0 = ARSENAL[aow2];
      if (!ar0 || typeof ar0 !== 'object') { delete ARSENAL[aow2]; continue; }
      var afix = arsOf(aow2), kk3;
      for (var gk in afix) {
        for (kk3 in afix[gk]) {
          var nv = +(ar0[gk] || {})[kk3];
          if (!isFinite(nv) || nv <= 0) delete afix[gk][kk3];
          else afix[gk][kk3] = Math.floor(nv);
        }
      }
      /* v19 返工（任务书第九节）：武库里的旧键 '代|类型|形制|品质' 折算成
       * '材质|类型|形制|品质'（ironwp/crossbow → 铁，matchlock…gw → 火器）。
       * 折完撞键就**合并件数** —— 铁兵器与强弩·具装都并成"铁 · 刀/…"，不能丢。 */
      if (afix.wpn) {
        var wmerged = Object.create(null), wk;
        for (wk in afix.wpn) {
          var wp = wk.split('|'), wm = AO.matKeyOf(wp[0]);
          var nk = [wm, wp[1] || 'dao', wp[2] || 'plain', wp[3] || 'plain'].join('|');
          wmerged[nk] = (wmerged[nk] | 0) + (afix.wpn[wk] | 0);
        }
        afix.wpn = wmerged;
      }
    }
    fill(EQUIPS, d.EQUIP);
    for (var eoid in EQUIPS) {
      var e0 = EQUIPS[eoid];
      if (!e0 || typeof e0 !== 'object') { delete EQUIPS[eoid]; continue; }
      equipOf(eoid);                    // 补槽、把非法数归零
    }
    fill(ARTISANS, d.ARTISAN);
    for (var aoid in ARTISANS) {
      var A0 = ARTISANS[aoid];
      if (!A0 || typeof A0 !== 'object') { delete ARTISANS[aoid]; continue; }
      var A1 = artisanPoolOf(aoid), i0;
      A1.pool = (A0.pool || []).filter(function (x) { return x && typeof x === 'object'; });
      A1.post = {};
      for (i0 in (A0.post || {})) {
        var pa = (A0.post || {})[i0];
        if (!pa || typeof pa !== 'object') continue;
        pa.lv = AO.clamp(pa.lv | 0, 0, AO.ARTISAN.lv.length - 1);
        pa.pid = i0 | 0;
        A1.post[i0 | 0] = pa;
      }
      for (i0 = 0; i0 < A1.pool.length; i0++) A1.pool[i0].lv = AO.clamp(A1.pool[i0].lv | 0, 0, AO.ARTISAN.lv.length - 1);
    }
    /* 匠人 id 计数器：接着存档最大值往后走（撞了"派/撤"会认错人） */
    var maxArt = 0, ak3, ai3;
    for (ak3 in ARTISANS) {
      var A2 = ARTISANS[ak3];
      if (!A2) continue;
      for (ai3 = 0; ai3 < (A2.pool || []).length; ai3++) if (A2.pool[ai3] && A2.pool[ai3].id > maxArt) maxArt = A2.pool[ai3].id;
      for (var apk in (A2.post || {})) if (A2.post[apk] && A2.post[apk].id > maxArt) maxArt = A2.post[apk].id;
    }
    ARTISAN_ID = Math.max(d.ARTISAN_ID || 1, maxArt + 1);
    fill(ARMY, d.ARMY);
    /* v19 返工：军队身上的"代"折算成材质（weapon.tier 也要跟着改，
     * 否则面板按旧键查不到材质，会退回"皮"）。 */
    for (var aid2 in ARMY) {
      var a2 = ARMY[aid2];
      if (!a2 || a2.type === 'navy') continue;
      var oldTier2 = a2.tier;
      a2.tier = AO.matKeyOf(a2.tier);
      if (a2.weapon) {
        var wm2 = AO.matKeyOf(a2.weapon.tier);
        var wty2 = a2.weapon.type || 'dao', wfo2 = a2.weapon.form || 'plain', wq2 = a2.weapon.q || 'plain';
        a2.weapon = { key: [wm2, wty2, wfo2, wq2].join('|'),
          tier: wm2, type: wty2, form: wfo2, q: wq2 };
      } else if (a2.weapon === undefined && oldTier2) {
        /* v18 及更早的档：军队只有 tier / arms，没有 weapon 槽 —— 按"已发对应队份"补上
         * （arms:'art' 的补一门投石机）。新档的裸兵是 `weapon: null`，不会被这条碰到。 */
        if (a2.arms === 'art') a2.gun = { key: 'catapult|plain', tier: 'catapult', q: 'plain' };
        a2.weapon = { key: [a2.tier, 'dao', 'plain', 'plain'].join('|'),
          tier: a2.tier, type: 'dao', form: 'plain', q: 'plain' };
      }
    }
    fill(GENERALS, d.GENERALS);
    fill(WARSET, d.WARSET);
    fill(WARBASE, d.WARBASE);
    fill(OCCUPY, d.OCCUPY);
    /* 不安 / 整合 / 匪患 / 安抚冷却 / 预警档：旧档缺这五块 → 空表（见 save 里的说明）。
     * 有个细节要补：旧档里 OCCUPY 有、INTEG 没有的省，直接补一条 v:0 ——
     * 否则它在存档里"没有整合记录"，而产出那边按 0 算，两边看着是同一个数，
     * 但省卡的「整合」行会整行消失（判据是 integOf 非空），玩家会以为坏了。 */
    fill(INTEG, d.INTEG);
    fill(UNREST, d.UNREST);
    fill(BANDIT, d.BANDIT);
    fill(PACIFY, d.PACIFY);
    fill(UNWARN, d.UNWARN);
    /* 动态市场（v14）：旧档缺这四块 → 空表（物价回基准、没有冲击、没有零头）。
     * 读进来的价格要逐条归一化：手改过的档 / 别的版本的档可能带 NaN 或越界值，
     * 留着会让价格板显示 "NaN" 并传染到所有买卖。 */
    fill(PRICES, d.PRICES);
    var PCFG = AO.PRICES_CFG;
    for (var pcid in PRICES) {
      var prow = PRICES[pcid];
      if (!prow || typeof prow !== 'object') { delete PRICES[pcid]; continue; }
      for (var pkey in prow) {
        var pit = prow[pkey];
        if (!pit || typeof pit !== 'object') { delete prow[pkey]; continue; }
        pit.v = AO.clamp(isFinite(+pit.v) ? +pit.v : PCFG.base, PCFG.lo, PCFG.hi);
        pit.target = AO.clamp(isFinite(+pit.target) ? +pit.target : PCFG.base, PCFG.lo, PCFG.hi);
        pit.trend = pit.trend > 0 ? 1 : pit.trend < 0 ? -1 : 0;
      }
    }
    fill(PRICESHOCK, d.PRICESHOCK);
    fill(SELLACC, d.SELLACC);
    fill(EXP1, d.EXP1);
    for (var sak in SELLACC) {
      if (!isFinite(+SELLACC[sak]) || +SELLACC[sak] < 0) SELLACC[sak] = 0;
      else SELLACC[sak] = +SELLACC[sak];
    }
    for (var exk in EXP1) { if (!isFinite(+EXP1[exk])) delete EXP1[exk]; else EXP1[exk] = +EXP1[exk]; }
    for (var ocp in OCCUPY) {
      if (!INTEG[ocp]) INTEG[ocp] = { v: 0 };
      unrestOf(ocp);
    }
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
    /* 外交层（v9）：排在迷雾之后 —— 工坊模式那份 REL 要能盖住 fogLoad 清空的表，
     * 而选了国的档里 REL 归 fogLoad 管（d.DIPLO.rel 是 null）。
     * 旧档没有 d.DIPLO → 全补默认（空条约表）。 */
    diploLoad(d.DIPLO);
    /* 世界消息（v15）：排在迷雾与外交之后 —— PLAYER / turnNo / INTELB 都定完了，
     * "在路上的一条消息还差几回合"才是拿这两个数算出来的。
     * 旧档 d.NEWS 是 undefined → 空队起步（和"新开一局"同一条路）。 */
    newsLoad(d.NEWS);
    /* 维修档（19-repair.js）：SIM / WALL 都灌完了才补 —— 它要按 pid 剔掉
     * 已经不存在的省。老档 d.REP 是 undefined → 全补默认。 */
    if (AO.repLoad) AO.repLoad(d.REP);
    /* 平衡分析：曲线随档走（老档没有 d.BAL → 空曲线起步） */
    if (AO.balLoad) AO.balLoad(d.BAL);
    /* 军工产线（v17）：必须排在 RESEARCH / UNIV / PLAYER 都落定之后 ——
     * 迁移要按"研到哪一档"判断产线开不开，也要按产能算出该迁多少点。
     * 旧档的 st.order 在这一步被翻译成"全产能 → 原产线"（拍板③）。 */
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
    /* 维修面板：换了一局就重画（档位/失修都换了），徽标跟着重算 */
    if (typeof refreshRepBadge === 'function') refreshRepBadge();
    if (REPU && REPU.open) renderRepPanel();
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
    var ids = ['nextTurn', 'ttTurn', 'gpTurn', 'npTurn', 'rpTurn', 'chTurn'];
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
      refresh: evtRefresh,
      /* v13（A3）：匪患事件改成看不安值之后，事件层要能读不安、改不安、
       * 挂匪患标记、给招安的驻防军。四个都是薄壳 —— 真正的规则在 11-ui 里，
       * 事件层只负责"什么时候调"（和 happyOf / official 同一套做法）。 */
      unrestOf: unrestOf,
      unwarnClear: function (pid) { delete UNWARN[pid | 0]; },
      banditSet: function (pid) {
        BANDIT[pid | 0] = { turn: turnNo, left: AO.UNREST.banditTurns };
      },
      garrisonAdd: function (pid, n) {
        var p = pOf(pid);
        if (!p || !p.owner) return 0;
        var made = 0;
        for (var i = 0; i < (n || 1); i++) {
          var a = newArmy(p.owner, p.id, { type: 'army', men: AO.RECRUIT.menPerUnit });
          syncArms(a);
          a.order = { type: 'defend', cid: p.owner, pid: p.id, tactic: 'assault' };
          made++;
        }
        return made;
      }
    });
  }

  /* =============================================================
   * 十八b、产能 / 武库面板（v19）
   *
   * 两张都是**全国口径**的页（和「经营」同一套全屏纸面）：
   *   产能 —— 三个池 + 20 条线，点数怎么分是这一局最核心的取舍
   *   武库 —— 成品（队份）与发配；兵种是发出来的
   * 面板只做两件事：读（lineStatus / arsRows）+ 写（setLineAlloc / issue*），
   * 规则一律在下面那几个函数里，面板不自己算第二遍。
   * ============================================================= */
  var MPU = { open: false }, APU = { open: false };

  /* 面板看哪个国：选了国就是自己；工坊模式跟着地图上选中的省走 */
  function panelOwner() {
    if (PLAYER) return PLAYER;
    var sel = state.renderer && state.renderer.selected;
    var p = sel ? pOf(sel) : null;
    if (p && p.owner) return p.owner;
    var w = state.world;
    return (w && w.countries[0]) ? w.countries[0].id : 0;
  }

  function openMillPanel() {
    MPU.open = true;
    $('millPanel').classList.add('on');
    renderMillPanel();
  }
  function closeMillPanel() {
    MPU.open = false;
    $('millPanel').classList.remove('on');
  }
  function openArsPanel() {
    APU.open = true;
    $('arsPanel').classList.add('on');
    renderArsPanel();
  }
  function closeArsPanel() {
    APU.open = false;
    $('arsPanel').classList.remove('on');
  }

  /* 一条线的进度条（纯 inline，免得为它加一堆 CSS） */
  function lineBarHtml(st) {
    var pct = st.work ? Math.round((st.prog / st.work) * 100) : 0;
    var col = st.wait ? '#a8523b' : st.done ? '#4a7a4a' : '#8a6d34';
    return '<i style="display:inline-block;width:76px;height:6px;background:#e6ddc9;' +
      'border-radius:3px;overflow:hidden;vertical-align:middle">' +
      '<i style="display:block;height:6px;width:' + pct + '%;background:' + col + '"></i></i>';
  }

  function renderMillPanel() {
    if (!MPU.open || !state.world) return;
    var owner = panelOwner(), c = coOf(owner), M = AO.MILL;
    if (!c) { $('mpBody').innerHTML = '<div class="l">还没有世界</div>'; return; }
    $('mpWho').textContent = c.name + ' · 工艺：' + (AO.CRAFT.cn[AO.CRAFT.order[craftIdxOf(owner)]] || '皮革工艺');
    var h = '', i, j;
    var rep = millReport(owner);
    /* 三池一览 */
    h += '<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
    for (i = 0; i < rep.length; i++) {
      var r = rep[i];
      h += '<div style="flex:1;min-width:180px;border:1px solid #e0d6c1;border-radius:8px;' +
        'padding:8px 10px;background:#fbf7ee">' +
        '<b>' + M.poolCn[r.pool] + '池</b>　' + r.used + ' / <b>' + r.cap + '</b> 点' +
        (r.used < r.cap ? '<span style="color:#8a6d34"> · 空转 ' + (r.cap - r.used) + ' 点</span>' : '') +
        '<br><span style="font-size:11.5px;color:#8b8272">' +
        (r.pool === 'arm' ? '军械坊 2 点/座' : r.pool === 'hor' ? '驯马场 1 点/座' : '造船厂 1 点/座') +
        ' × 工厂 × 匠人</span></div>';
    }
    h += '</div>';

    for (i = 0; i < rep.length; i++) {
      var pool = rep[i];
      if (!pool.cap && !pool.used) {
        h += '<div class="l" style="color:#8b8272"><i>' + M.poolCn[pool.pool] + '</i> ' +
          '本国还没有对应的厂（' + (pool.pool === 'arm' ? '军械坊' : pool.pool === 'hor' ? '驯马场' : '造船厂') +
          '）—— 盖起来就有产能了</div>';
        continue;
      }
      h += '<div style="margin:12px 0 6px;border-top:1px solid #e2d8c4;padding-top:8px">' +
        '<b>' + M.poolCn[pool.pool] + '池</b>　' + pool.used + ' / ' + pool.cap + ' 点' +
        '<span style="font-size:11.5px;color:#8b8272">　每线一单，一回合至多完成一单；分超过工作量就进不去</span></div>';
      h += '<div class="sellbox" style="display:block">';
      for (j = 0; j < pool.lines.length; j++) {
        var st = pool.lines[j], line = st.line;
        var full = st.alloc >= st.work;
        var status = '';
        if (st.wait) status = '<em style="color:#a8523b">等料（卡在 100%）</em>';
        else if (full) status = '<em style="color:#4a7a4a">已满速 · 1 回合/单</em>';
        else if (st.turns) status = '<em>' + st.turns + ' 回合/单</em>';
        else status = '<em style="color:#8b8272">未分配</em>';
        var formSel = '';
        if (M.kindOf[line] === 'blade') {
          var cur = millOf(owner).form[line] || 'plain';
          formSel = '<select data-form="' + line + '" style="margin-left:6px">' +
            AO.GEAR.forms.map(function (f) {
              return '<option value="' + f.key + '"' + (f.key === cur ? ' selected' : '') + '>' +
                f.cn + '</option>';
            }).join('') + '</select>';
        }
        var lineName = M.lineCn[line], lineIcon = '';
        if (M.kindOf[line] === 'blade') {
          var cm = craftWeapon(owner);
          lineName += '（' + cm.cn + '）';
          lineIcon = '<img src="' + wpnIcon(line, cm.key) + '" style="width:18px;height:18px;vertical-align:-4px">';
        }
        h += '<div class="srow" style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
          '<span style="width:110px">' + lineIcon + escHtml(lineName) + '</span>' +
          '<em style="width:96px;color:#8b8272">工作量 ' + st.work + ' 点</em>' +
          '<button type="button" data-mline="' + line + '" data-mdelta="-1"' +
          (st.alloc <= 0 ? ' disabled' : '') + '>−</button>' +
          '<b style="width:26px;text-align:center">' + st.alloc + '</b>' +
          '<button type="button" data-mline="' + line + '" data-mdelta="1"' +
          (full ? ' disabled' : '') + '>＋</button>' +
          lineBarHtml(st) + '　' + status + formSel + '</div>';
      }
      h += '</div>';
    }
    h += '<div class="l" style="margin-top:10px;color:#8b8272"><i>说明</i> ' +
      '兵刃 / 装备 / 马 一单 = 1 队份（×1000）· 炮一单 = 1 门 · 舰一单 = 1 艘。' +
      '兵刃的**材质**跟着工艺链走（研到哪一档就造哪一档），类型 / 形制在这里选，' +
      '品质按单 roll（看全国最高那位匠人）。二十条线一律**没有解锁条件** —— ' +
      '教育 0、没有匠人也能开炮线、养具装马、选锋锐。</div>';
    $('mpBody').innerHTML = h;
  }

  function renderArsPanel() {
    if (!APU.open || !state.world) return;
    var owner = panelOwner(), c = coOf(owner);
    if (!c) { $('apBody').innerHTML = '<div class="l">还没有世界</div>'; return; }
    $('apWho').textContent = c.name;
    var h = '', i, j;
    var kinds = [['wpn', '兵刃', '队份'], ['mount', '马', '队份'], ['gun', '炮', '门'], ['ship', '舰', '艘']];
    h += '<div style="margin:4px 0 8px"><b>库存</b>' +
      '<span style="font-size:11.5px;color:#8b8272">　队份 = 武装一个千人队（×1000）</span></div>';
    h += '<div class="sellbox" style="display:block">';
    for (i = 0; i < kinds.length; i++) {
      var rows = arsRows(owner, kinds[i][0]);
      if (!rows.length) {
        h += '<div class="srow" style="display:flex;gap:8px;padding:2px 0"><span style="width:64px">' +
          kinds[i][1] + '</span><em style="color:#8b8272">空</em></div>';
        continue;
      }
      for (j = 0; j < rows.length; j++) {
        var r0 = rows[j];
        h += '<div class="srow" style="display:flex;gap:8px;padding:2px 0;align-items:center">' +
          '<span style="width:64px">' + kinds[i][1] + '</span>' +
          (r0.icon ? '<img src="' + r0.icon + '" style="width:18px;height:18px">' : '') +
          '<span style="flex:1;color:' + (r0.color || 'inherit') + '">' + escHtml(r0.cn) +
          (r0.q ? '（' + AO.GEAR.qCn[r0.q] + '）' : '') + '</span>' +
          '<b>×' + r0.n + ' ' + kinds[i][2] + '</b></div>';
      }
    }
    /* 盔甲靴 */
    var E = AO.EQUIP;
    for (i = 0; i < E.slots.length; i++) {
      var slot = E.slots[i], parts = [];
      for (j = 0; j < E.q.length; j++) {
        var n = equipOf(owner)[slot][E.q[j]] | 0;
        if (n > 0) parts.push(E.qCn[E.q[j]] + ' ×' + n);
      }
      h += '<div class="srow" style="display:flex;gap:8px;padding:2px 0">' +
        '<span style="width:64px">' + E.slotCn[slot] + '</span>' +
        '<span style="flex:1">' + (parts.length ? parts.join(' · ') : '<em style="color:#8b8272">空</em>') +
        '</span></div>';
    }
    h += '</div>';

    /* 驻军清单 */
    var list = armiesOf(owner).filter(function (a) { return a.type === 'army'; });
    h += '<div style="margin:14px 0 6px;border-top:1px solid #e2d8c4;padding-top:8px"><b>驻军</b>' +
      '<span style="font-size:11.5px;color:#8b8272">　' + list.length +
      ' 支 · 换装即换兵种，换下的回库</span></div>';
    if (!list.length) h += '<div class="l" style="color:#8b8272">本国还没有陆军（兵营里征一支）</div>';
    var wOpts = arsRows(owner, 'wpn'), mOpts = arsRows(owner, 'mount'), gOpts = arsRows(owner, 'gun');
    for (i = 0; i < list.length; i++) {
      var a = list[i], p = pOf(a.pid);
      var u = unitOf(a);
      h += '<div class="srow" style="display:flex;align-items:center;gap:8px;padding:5px 0;' +
        'border-bottom:1px dashed #e8dfcc;flex-wrap:wrap">' +
        '<span style="width:120px">' + escHtml(p ? p.name : '?') + '</span>' +
        '<span style="width:74px">' + unitKindCn(a) + ' · ' + a.men + ' 人</span>' +
        '<span style="flex:1;min-width:180px' + (a.weapon ? '' : ';color:#a8523b') + '">' + escHtml(gearText(a)) +
        '　<em style="color:#8b8272">攻 ' + u.atk.toFixed(2) + ' · 防 ' + u.def.toFixed(2) +
        ' · 机动 ' + u.mov + '</em></span>' +
        '<button type="button" data-fit="' + a.id + '">一键配齐</button>' +
        '<select data-issue="wpn" data-army="' + a.id + '">' + selHtml(wOpts, a.weapon) + '</select>' +
        '<select data-issue="mount" data-army="' + a.id + '">' + selHtml(mOpts, a.mount) + '</select>' +
        '<select data-issue="gun" data-army="' + a.id + '">' + selHtml(gOpts, a.gun) + '</select>' +
        '</div>';
    }
    h += '<div class="l" style="margin-top:10px;color:#8b8272"><i>说明</i> ' +
      '招的都是步兵；发一份马 = 骑兵、发一门炮 = 炮兵（炮也吃攻城值）。' +
      '盔甲靴三槽走「一键配齐」取库存最优。</div>';
    $('apBody').innerHTML = h;

    function selHtml(opts, cur) {
      var out = '<option value="">卸下</option>';
      for (var k = 0; k < opts.length; k++) {
        var o = opts[k];
        out += '<option value="' + escHtml(o.key) + '"' +
          (cur && cur.key === o.key ? ' selected' : '') + '>' +
          escHtml(o.cn + (o.q ? '（' + AO.GEAR.qCn[o.q] + '）' : '') + '×' + o.n) + '</option>';
      }
      return out;
    }
  }

  function millPanelActions() {
    var mp = $('millPanel'), ap = $('arsPanel');
    if (!mp || !ap) return;
    $('millBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (MPU.open) closeMillPanel(); else { closeArsPanel(); openMillPanel(); }
    });
    $('arsBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (APU.open) closeArsPanel(); else { closeMillPanel(); openArsPanel(); }
    });
    $('mpClose').addEventListener('click', closeMillPanel);
    $('apClose').addEventListener('click', closeArsPanel);
    mp.addEventListener('click', function (e) {
      if (e.target === mp) return closeMillPanel();
      var b = e.target.closest('button[data-mline]');
      if (!b) return;
      var owner = panelOwner();
      if (!canAct(owner)) return toast(lockTitle(), 2600);
      var r = bumpLine(owner, b.getAttribute('data-mline'), +b.getAttribute('data-mdelta'));
      if (!r.ok) toast(r.msg, 2400);
      renderMillPanel();
    });
    mp.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-form]');
      if (!sel) return;
      var owner = panelOwner();
      if (!canAct(owner)) return;
      setLineForm(owner, sel.getAttribute('data-form'), sel.value);
      renderMillPanel();
    });
    ap.addEventListener('click', function (e) {
      if (e.target === ap) return closeArsPanel();
      var b = e.target.closest('button[data-fit]');
      if (!b) return;
      var owner = panelOwner();
      if (!canAct(owner)) return toast(lockTitle(), 2600);
      var a = ARMY[+b.getAttribute('data-fit')];
      var r = armyFitAll(a);
      toast(r.msg, 3000);
      renderArsPanel();
    });
    ap.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-issue]');
      if (!sel) return;
      var owner = panelOwner();
      if (!canAct(owner)) return;
      var a = ARMY[+sel.getAttribute('data-army')];
      if (!a) return;
      var kind = sel.getAttribute('data-issue'), key = sel.value || '';
      var r = kind === 'wpn' ? issueWeapon(a, key) : kind === 'mount' ? issueMount(a, key) : issueGun(a, key);
      if (!r.ok) toast(r.msg, 2600);
      renderArsPanel();
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
    talentOf: talentOf, researchOf: researchOf,
    /* 维护单价（逐座、逐类，可复算） */
    maintDue: maintDue,
    buildOne: buildOne,
    buildSchool: buildSchool,
    buildMarket: buildMarket,
    buildBuilder: buildBuilder,
    buildUniv: buildUniv,
    startResearch: startResearch,
    sprintSite: sprintSite,
    sprintResearch: sprintResearch,
    sell: function (x, key, silent) { return sellResource(asProv(x), key, silent); },
    /* v18 / B2：以物易物（任何两种资源互换）。test/lifeline.js 的 B2 段从这里进 */
    exchange: function (x, give, get, silent) { return exchangeResource(asProv(x), give, get, silent); },
    xchgOut: xchgOut,
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
    /* v11：吏部（AI 与测试都从这里进）—— 赏赐 / 资历倍率 / 怨气结算 */
    reward: rewardOfficial,
    offMul: offMul,
    offNorm: offNorm,
    offTitle: offTitle,
    settleOfficials: settleOfficials,
    /* v12：宰相（test/chancellor.js 只从这里进） */
    chancellor: CHANCELLOR,
    chOf: chOf,
    chLv: chLv,
    chTitle: chTitleOf,
    chPerms: chPerms,
    chHappy: chHappyOf,
    appoint: appointChancellor,
    dismissCh: dismissChancellor,
    settleChancellor: settleChancellor,
    chancellorAct: chancellorAct,
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
    /* 改回合号（测试 / bench 想直接跳到某一年时用），顺手请求一次重绘 ——
     * 年表与回合标签都从它派生，不重绘的话画面会停在上一格。 */
    setTurn: function (n) {
      turnNo = n; updateTurnLabel();
      if (state.renderer) state.renderer.requestDraw();
    },

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
    setLineAlloc: setLineAlloc, bumpLine: bumpLine, setLineForm: setLineForm,
    openMillPanel: openMillPanel, closeMillPanel: closeMillPanel,
    openArsPanel: openArsPanel, closeArsPanel: closeArsPanel, craftMulOf: craftMulOf,
    lineStatus: lineStatus, millReport: millReport, poolCap: poolCap,
    arsOf: arsOf, arsAdd: arsAdd, arsTake: arsTake, arsTotal: arsTotal,
    arsRows: arsRows, arsBestWeapon: arsBestWeapon,
    unitOf: unitOf, unitKindOf: unitKindOf, unitKindCn: unitKindCn, gearText: gearText,
    issueWeapon: issueWeapon, issueMount: issueMount, issueGun: issueGun,
    armyFitAll: armyFitAll, gearRecycle: gearRecycle, syncArms: syncArms,
    /* ---- 军工产线（v17）：test/mill.js 与 bench 策略 N 只从这里进 ----
     * 三张表直接暴露（读），动作走函数（写）—— 和治理层同一个口径。 */
    mill: MILLS,
    millOf: millOf,
    millCap: millCap,
    provCapRaw: provCapRaw, poolCapRaw: poolCapRaw, lineWork: lineWork,
    allocSum: allocSum, orderCost: orderCost, makeOrder: makeOrder,
    setMillLine: bumpLine,

    millMigrateOld: millMigrateOld, arsBest: arsBest, sparseArsenal: sparseArsenal,
    millPt: function (line) { return millPtOf(line); },
    hasTech: hasTech,
    equip: EQUIPS,
    equipOf: equipOf,
    equipStockOf: equipStockOf,
    equipTotal: equipTotal,
    equipArmy: equipArmy,
    equipAutoFit: equipAutoFit,
    equipClear: equipClear,
    equipMulOf: equipMulOf,
    equipRecycle: equipRecycle,
    matOf: matOf,
    rollQuality: rollQuality,
    qualityOf: function (owner, pid) { return rollQuality(owner, pid); },
    artisan: ARTISANS,
    artisanPoolOf: artisanPoolOf,
    artisanOf: artisanOf,
    artisanLv: artisanLv,
    artisanBonus: artisanBonus,
    artisanSpot: artisanSpot,
    examArtisan: examArtisan,
    postArtisan: postArtisan,
    unpostArtisan: unpostArtisan,
    settleIndustry: settleIndustry,
    bestWeapon: bestWeapon, craftWeapon: craftWeapon,
    mills: MILLS, arsenal: ARSENAL, artisansOf: artisanPoolOf, millsOf: millOf,
    bestArtisanLv: bestArtisanLv, rollQuality: rollQuality, artisanBonus: artisanBonus,
    postArtisan: postArtisan, unpostArtisan: unpostArtisan, examArtisan: examArtisan,
    unlockedItems: unlockedItems,
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
    /* ---- 不安 / 整合 / 叛乱（A、B 两批）：test/unrest.js 与 bench 策略 I/J 只从这里进 ----
     * 三张表直接暴露（读），四个动作走函数（写）。叛乱三选一单独给出来，
     * 是为了能对 1000 次掷骰验概率（60/30/10，驻军时 80/15/5）。 */
    unrest: AO.UNREST,
    integ: AO.INTEG,
    integMap: INTEG,
    unrestMap: UNREST,
    banditMap: BANDIT,
    pacifyMap: PACIFY,
    unrestOf: unrestOf,
    integOf: integOf,
    hasGarrison: hasGarrison,
    settleUnrest: settleUnrest,
    settleInteg: settleInteg,
    settleRevolt: settleRevolt,
    rollRevolt: rollRevoltKind,
    pacify: pacify,
    pacifyInfo: pacifyInfo,
    integProdMul: function (v) { return AO.INTEG.prodMul(v); },
    warnPlayerProv: warnPlayerProv,
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

    /* ---- 维护与维修（19-repair.js）：test/repair.js 只从这里进 ----
     * rep 给出纯规则（保留座数/价格/行为），live/draw/counts 给出内部状态，
     * 两者分开是为了测试能一条条对着"规则"验，而不是验一堆 DOM。 */
    rep: function () { return AO.rep; },
    repLive: repLive,
    repDraw: drawStock,
    repUI: function () { return AO.repUI; },
    repCount: function (owner, kind, pid) { return kindCount(owner, kind, pid); },
    repOwner: function () { return repOwner(); },
    /* 保留座数的"算出来是什么"：测试要验"停了 N 座，维护费和产量是不是真的按 N 算"。
     * activeTiers / activeN 是结算和面板共用的那一份裁剪逻辑，所以只能验它。 */
    activeTiers: activeTiers,
    activeN: activeN,
    keepOff: keepOff,
    maintPair: maintPair,
    /* ---- 平衡分析（20-balance.js）：test/balance.js 只从这里进 ---- */
    balUI: function () { return AO.balUI; },
    balStep: function () { if (AO.balStep) AO.balStep(); },
    balSave: function () { return AO.balSave ? AO.balSave() : null; },
    balLoad: function (d) { if (AO.balLoad) AO.balLoad(d); },
    flush: function () { flushNotes(); },
    notesList: function () { return NOTES.slice(); },

    /* ---- 熔旧坊 + 人口铁税（本批）：test/smelt.js 只从这里进 ---- */
    smelt: SMELT,
    smeltOf: smeltOf,
    buildSmelt: buildSmelt,
    settleSmelt: settleSmelt,
    finishSmelt: finishSmelt,
    smeltPer: function (pop) { return AO.SMELT.perAt(pop || 0); },
    smeltCheck: function (pid) {
      var p = pOf(pid | 0), st = smeltOf(pid | 0);
      return AO.SMELT.check(p, { bag: SIM[pid | 0], smeltN: st ? st.n : 0, site: st ? st.site : 0 });
    },
    ironAcc: IRONACC,
    /* ---- 淘金场（v18 / A）：test/lifeline.js 只从这里进 ---- */
    wash: WASH,
    washOf: washOf,
    buildWash: buildWash,
    settleWash: settleWash,
    finishWash: finishWash,
    washPer: function (pop) { return AO.WASH.perAt(pop || 0); },
    washCheck: function (pid) {
      var p = pOf(pid | 0), st = washOf(pid | 0);
      return AO.WASH.check(p, { bag: SIM[pid | 0], washN: st ? st.n : 0, site: st ? st.site : 0 });
    },
    /* 省库上解（v18.3）：定点验"50 → 搬 2、150 → 搬 3（cap）、35 两回合攒 1" */
    settleRemit: settleRemit,
    remitStat: REMIT,
    remitAcc: REMITACC,
    /* 省库买铁付维护（v18.4）：定点验"铁见底 + 金够 → 买几单位" */
    selfBuyIron: selfBuyIron,
    selfBuyUnit: selfBuyUnit,
    selfBuyStat: SELFSTAT,
    /* 养得起几座就养几座（v18.5）：定点验"2 铁 4 座 → 保留 2 座、欠账减半" */
    trimKeep: trimKeep,
    trimStat: TRIMSTAT,
    autoKeep: AUTOK,
    popOf: function (pid) { return (POP[pid | 0] && POP[pid | 0].v) || 0; },
    goldOf: function (pid) { return (SIM[pid | 0] && SIM[pid | 0].gold) ? SIM[pid | 0].gold.stock : 0; },
    setGold: function (pid, v) { if (SIM[pid | 0] && SIM[pid | 0].gold) SIM[pid | 0].gold.stock = v; },
    stockOf: stockOf,
    capOf2: capOf,

    /* ---- 外交层（v9）：test/diplo.js 只从这里进 ----
     * 名字带 rel* / ws* 前缀，避免和已有的 fogRelOf / wars 混起来读。 */
    diplo: AO.resDiplo,
    relOf: relOf,
    relSet: setRel,
    relAdd: addRel,
    relTier: relTier,
    relCn: relCn,
    relHit: RELHIT,
    atWar: atWar,
    isAlly: isAlly,
    isNap: isNap,
    pactOf: pactOf,
    proposePact: proposePact,
    breakPact: breakPact,
    aiDiploEval: aiDiploEval,
    aiPeaceEval: aiPeaceEval,
    wsOf: wsOf,
    wsScoreOf: wsScoreOf,
    wsAdd: wsAdd,
    settleDiplo: settleDiplo,
    talkOpen: openTalk,
    talkClose: closeTalk,
    talkDeal: talkDeal,
    talkState: TALK,
    foreignSources: foreignSources,
    buyForeign: buyForeign,
    addTradeRel: addTradeRel,
    /* v14：动态市场（test/prices.js 与 bench 策略 L 只从这里进）
     * 价格读写 / 需求 / 结算 / 冲击 / 出口 / 中央买（AI 比价用）/ 商队 */
    prices: PRICES,
    priceShock: PRICESHOCK,
    priceOf: priceV,
    priceTrend: priceTrend,
    priceNudge: priceNudge,
    priceTarget: priceTarget,
    priceNum: priceNum,
    settlePrices: settlePrices,
    needOf: needOf,
    countryStock: countryStock,
    sellGold: sellGold,
    buyGold: buyGold,
    fBuyGold: fBuyGold,
    expGold: expGold,
    buyWorld: function (p, key) { return buyWorld(p, key, true); },
    exportSources: exportSources,
    exportForeign: exportForeign,
    aiExport: function (p, key, cid) { return exportForeign(p, key, cid, true); },
    caravan: caravanDeal,
    sellAcc: SELLACC,
    expTurn: EXP1,
    pricesCfg: function () { return AO.PRICES_CFG; },
    diploSave: diploSave,
    diploLoad: diploLoad,
    nameOf: nameOf,
    /* v13：傀儡与朝贡（test/puppet.js 与 bench 策略 K 只从这里进） */
    puppetMap: PUPPET,
    suzerainOf: suzerainOf,
    vassalsOf: vassalsOf,
    puppetRec: puppetRec,
    puppetRecOf: puppetRecOf,
    makePuppet: makePuppet,
    dropPuppetRec: dropPuppetRec,
    settlePuppets: settlePuppets,
    puppetTribute: puppetTribute,
    aiPuppetEval: aiPuppetEval,
    leashVassals: leashVassals,
    annexPuppet: annexPuppet,
    tryAnnexPuppet: tryAnnexPuppet,
    forceAnnexPuppet: forceAnnexPuppet,
    puppetAnnexReady: puppetAnnexReady,
    indepScore: indepScoreOf,
    indepRoll: puppetIndepRoll,
    surrenderBranch: surrenderBranch,
    surrenderLine: surrenderLineOf,
    surrenderState: SURR,
    openSurrender: openSurrender,
    surrenderChoose: surrenderChoose,
    coOf: coOf,
    countryHappyOf: function (cid) { return countryHappy(coOf(cid | 0)); },
    menOf: menOfCid,
    warsOf: warsOfCid,
    /* v10：AI 互战要读的三样 —— AI 的已探集 / 停战冷却 / 世界消息
     * （v15 起 worldNewsQueue 是**待送达**队列：evtTurn/delay 都在条目里） */
    fogAiKnow: AIKNOW,
    peaceCd: PEACECD,
    worldNewsQueue: PNEWS,
    newsQueue: PNEWS,
    newsRumours: RUMOURS,
    newsStat: function () { return NSTAT; },
    worldNews: worldNews,
    flushWorldNews: flushWorldNews,
    applyPeace: applyPeaceDeal,
    aiPeace: function (a, b, pay) { return applyPeaceDeal(a, b, pay); },
    aiBuy: function (p, key, cid) { return buyForeign(p, key, cid, true); },

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
    /* 涂色模式（上帝工坊里改归属）：AI 的回合要暂停，免得一边涂一边有人动土 */
    paintMode: function () { return !!(state.renderer && state.renderer.mode === 'paint'); },
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
    if (open) narrowSingleSurface('panel');
  }

  /* ---------------- 窄屏：同一时刻只留一张浮层 ----------------
   * 窄屏（<= 760px，见 index.html 末尾的 @media）下左栏是铺满整屏的抽屉，
   * 纪要和省卡是底部整幅 sheet —— 同时开着就是互相盖住，玩家看到的是
   * "消息被面板挡住"。z-index 只能决定谁在上面，挡住的还是挡住了，
   * 所以这里做互斥：**刚打开的那张留下，另一张收起来**（只动显隐，不动数据）。
   *
   * 桌面上它们各占一个角，不需要这条规矩 —— 一收反而让人以为点了没反应。 */
  function isNarrowUI() { return (window.innerWidth || 999) <= 760; }

  function narrowSingleSurface(who) {
    if (!isNarrowUI()) return;
    if (who === 'panel') {
      var np = $('notesPanel');
      if (np && np.classList.contains('on')) openNotes(false);
    } else if (who === 'notes') {
      if (!doc.body.classList.contains('panel-collapsed')) setPanel(false);
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('gen').addEventListener('click', generate);
    /* 谈判桌：点背板（卡片外面）就当"先不谈"。事件弹窗是"必须选一个"，
     * 谈判桌不是 —— 关掉它随时可以再打开，不该逼玩家去找取消钮。 */
    var tkm = $('talkModal');
    if (tkm) tkm.addEventListener('click', function (e) { if (e.target === this) closeTalk(); });
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
    /* ---- 界面收敛（v16）的四组交互 ---- */
    /* ① 省卡「测绘详情」开关：整行可点，键盘也能按 */
    var db = $('detBar');
    if (db) {
      var detHit = function (e) { if (e) e.preventDefault(); toggleDetail(); };
      db.addEventListener('click', detHit);
      db.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') detHit(e);
      });
    }
    /* ② 建筑四组：点组头 = 收起 / 展开（各记各的，不联动） */
    var gsecs = document.querySelectorAll('#info .gsec');
    for (var gi = 0; gi < gsecs.length; gi++) {
      gsecs[gi].addEventListener('click', function () {
        var k = this.getAttribute('data-grp');
        if (!k) return;
        lsSet(LS.grp + k, grpOpen(k) ? '0' : '1');
        applyGroups();
      });
    }
    /* ③ 国家卡三个页签：只切类名，内容由各 renderXXX 写好了 */
    var ctabs = $('cTabs') ? $('cTabs').querySelectorAll('.itab') : [];
    for (var ci = 0; ci < ctabs.length; ci++) {
      ctabs[ci].addEventListener('click', function () {
        lsSet(LS.countryTab, this.getAttribute('data-ctab') || 'ov');
        applyCountryTab();
      });
    }
    /* ④ ☰ 菜单：点钮开合，点外面 / ESC 关。菜单项自己照旧走原来的绑定 ——
     * 它们只是搬了容器，click 监听在下面那几段里挂，一行都不用改。 */
    var mb = $('menuBtn');
    if (mb) mb.addEventListener('click', function (e) {
      e.stopPropagation();
      openMenu();
    });
    document.addEventListener('click', function (e) {
      var pop = $('menuPop');
      if (!pop || !pop.classList.contains('on')) return;
      if (e.target && e.target.closest && e.target.closest('#menuWrap')) return;
      openMenu(false);
    });
    /* 点了菜单里的任何一项都收起（readers 不必各自记得关） */
    var mp = $('menuPop');
    if (mp) mp.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) openMenu(false);
    });
    /* ⑤ 纪要：入口（菜单 + 点提示条）+ 三档过滤 */
    var nb = $('notesBtn');
    if (nb) nb.addEventListener('click', function () { openNotes(); });
    var ncl = $('npClose');
    if (ncl) ncl.addEventListener('click', function () { openNotes(false); });
    /* 纪要卡里也有一颗「下一回合」：卡片挡不住右上角那颗主线钮，
     * 但手已经在这张卡上读新闻了，非要把视线挪到角上再点一次没道理。
     * 走完 nextTurn 会把这张卡重画（新攒的提示 / 邸报都进来）。 */
    var ntn = $('npTurn');
    if (ntn) ntn.addEventListener('click', nextTurn);
    var npTabs = $('npTabs') ? $('npTabs').querySelectorAll('button[data-nf]') : [];
    for (var ni = 0; ni < npTabs.length; ni++) {
      npTabs[ni].addEventListener('click', function () {
        lsSet(LS.notesTab, this.getAttribute('data-nf') || 'all');
        renderNotes();
      });
    }
    /* 提示条那一行本身就是"最新一条纪要"：点它就看全的 */
    var bm = $('bldMsg');
    if (bm) {
      bm.style.cursor = 'pointer';
      bm.title = '点一下看全部纪要（全部 / 我的 / 世界）';
      bm.addEventListener('click', function () {
        if (!this.textContent) return;
        openNotes(true);
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
    /* 窄屏互斥还有个"事后"的入口：手机上转屏 / 拖窗口跨过断点时，
     * 两张浮层可能已经同时开着了 —— 这时让纪要留下（它是玩家刚点开的那张），
     * 左栏收回去，别让它们叠着糊成一片。 */
    window.addEventListener('resize', function () {
      if (!isNarrowUI()) return;
      var np = $('notesPanel');
      if (np && np.classList.contains('on') &&
          !doc.body.classList.contains('panel-collapsed')) setPanel(false);
    });
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
        /* 先收抽屉：☰ 菜单 / 纪要卡（它们是最轻的一层，开着时 ESC 只关它们） */
        var pop0 = $('menuPop');
        if (pop0 && pop0.classList.contains('on')) { openMenu(false); return; }
        var np0 = $('notesPanel');
        if (np0 && np0.classList.contains('on')) { openNotes(false); return; }
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
    bindTouchTips();
  }

  /* =============================================================
   * 触摸提示（v17）：手机没有 hover，可全游戏几百处说明都写在 title 里
   *
   * 「鼠标悬浮才有提示」在手机上等于没有。做法是**长按 450ms**：
   * 把当前元素那句 title 原样塞进 toast（z=70，压在所有全屏面板之上），
   * 松手时吞掉补发的那一次 click —— 想"看一眼说明"不该顺手把事也办了。
   *
   * 轻点、滑动、滚动一律不打扰：手指移动超过 10px 就取消，
   * 所以翻列表、拖动地图都不会误触发。
   * 桌面（hover:hover）不装这套，鼠标悬浮照旧。
   * ============================================================= */
  function bindTouchTips() {
    if (!root.matchMedia || !root.matchMedia('(hover: none)').matches) return;
    var timer = 0, sx = 0, sy = 0, swallow = false;
    function stop() { if (timer) { clearTimeout(timer); timer = 0; } }
    root.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { stop(); return; }
      var el = e.target && e.target.closest ? e.target.closest('[title]') : null;
      if (!el) { stop(); return; }
      var txt = el.getAttribute('title');
      if (!txt) { stop(); return; }
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      stop();
      timer = setTimeout(function () {
        timer = 0;
        swallow = true;
        toast(txt, 4600);
        try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(10); } catch (err) { }
      }, 450);
    }, { passive: true });
    root.addEventListener('touchmove', function (e) {
      if (!timer) return;
      var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) stop();
    }, { passive: true });
    root.addEventListener('touchcancel', function () { stop(); swallow = false; });
    root.addEventListener('touchend', function (e) {
      stop();
      if (!swallow) return;
      swallow = false;
      e.preventDefault();          // 吞掉长按之后补的那一次 click
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

  /* =============================================================
   * 十七、维修面板（js/19-repair.js 的界面）
   *
   * 逻辑全在 19-repair.js：保留几座（KEEP）、多少钱（维修价）。
   * 这里只做三件事：画、绑、把点击翻译成一次 rep 调用。
   *
   * 面板的主轴是**"这一类这一省留几座在跑"**：
   *   一行 = 一类建筑（已建 / 在跑），点行首的 ▾ 展开就是这一类的**分城明细**，
   *   每个城市一个「− 数字 +」，想停几座就减几座。资源建筑能精确到座；
   *   学校/市场/兵营这类产出是离散的，只有「开 / 停」两态（见 settleTurn ①）。
   *
   * 为什么挂在右上角顶栏下面而不是全屏：调这个数是**回合中的高频小操作**
   * （"这回合先把渔港保下来、铁矿停一半"），铺满一屏会让人找不到刚才看的那块地。
   * ============================================================= */
  /* 面板状态：open + 维修栏的「本省/全国」+ 展开到哪几类。
   * 左栏（平衡）不需要状态：它每回合都整块重画，只有"看多少回合"记在 20-balance 里。 */
  var REPU = { open: false, scope: 'prov', exp: Object.create(null) };

  /* 面板上看的是哪个国家：选了国就是自己，工坊模式（PLAYER=0）看当前选中的省 */
  function repOwner() {
    if (PLAYER) return PLAYER;
    var pid = state.renderer ? state.renderer.selected : 0;
    var p = pid ? pOf(pid) : null;
    if (p) return p.owner;
    return (state.renderer && state.renderer.selectedCountry) || 1;
  }

  /* 这一类在这个国家/这个省里有几座、在跑几座、几处失修、几处主动停。
   * sites 只收"真的失修"的（欠费停产），主动停的不算 —— 那是玩家的决定，
   * 不该在顶栏亮红点催他。 */
  function kindCount(owner, kind, onlyPid) {
    var w = state.world;
    if (!w) return { all: 0, keep: 0, bad: 0, off: 0, sites: [] };
    var c = coOf(owner);
    var list = onlyPid ? [onlyPid] : (c ? c.provinces : []);
    var all = 0, keep = 0, bad = 0, off = 0, sites = [];
    for (var i = 0; i < list.length; i++) {
      var lv = repLive(list[i], kind);
      if (!lv) continue;
      var n = lv.built | 0;
      if (n > 0) all += n;
      keep += lv.active | 0;
      if (lv.off) { if (n > 0) off++; continue; }
      if (lv.halted && (lv.built || lv.n)) { bad++; sites.push(list[i]); }
    }
    return { all: all, keep: keep, bad: bad, off: off, sites: sites };
  }

  /* 这一类这一省：满额维护 vs 现在（按保留座数）的维护。
   * 面板上"停掉 X 座能省多少"就用它算 —— 数字必须和结算扣的是同一份，
   * 否则玩家按面板上的数省钱，结果国库掉得更多，就再也不信这个面板了。 */
  function maintPair(pid, kind, owner) {
    var zero = { iron: 0, gold: 0 };
    var s = SIM[pid] && SIM[pid][kind];
    if (s && AO.RESOURCE_BY_KEY[kind]) {
      var def = AO.RESOURCE_BY_KEY[kind];
      return { all: maintDue(s, def, owner), now: maintDue(s, def, owner, pid, kind) };
    }
    var st = UNIV[kind] && UNIV[kind][pid];
    if (st) {
      var ud = univDef(kind), n = st.n | 0;
      var all = { iron: (ud.maint.iron || 0) * n, gold: (ud.maint.gold || 0) * n };
      return { all: all, now: keepOff(pid, kind) ? zero : all };
    }
    if (kind === 'wall') {
      var w = WALL[pid];
      if (!w || !(w.lv > 0)) return { all: zero, now: zero };
      var wm = wallMaintDue(w, owner);
      return { all: wm, now: keepOff(pid, 'wall') ? zero : wm };
    }
    return { all: zero, now: zero };
  }

  /* 一类建筑在这个国家（或这个省）里的分城明细：只收"真的盖了"的城。
   * 按座数降序 —— 玩家最想停的永远是那几座最大的。
   * 1100 个省时这里每个国家只有几十个城，逐类重算一遍也就几毫秒。 */
  function cityRows(owner, kind, onlyPid) {
    var c = coOf(owner), out = [];
    if (!state.world || !c) return out;
    var list = onlyPid ? [onlyPid] : c.provinces;
    for (var i = 0; i < list.length; i++) {
      var pid = list[i], lv = repLive(pid, kind);
      if (!lv || !(lv.built > 0)) continue;
      var pp = pOf(pid);
      out.push({
        pid: pid, name: pp ? pp.name : ('#' + pid), color: pp ? pp.ownerColor : '#999',
        built: lv.built | 0, active: lv.active | 0, off: !!lv.off, halted: !!lv.halted
      });
    }
    out.sort(function (a, b) { return b.built - a.built || a.pid - b.pid; });
    return out;
  }

  /* 一处失修的状态说明（清单里"为什么停着"那一列）：
   * 停修比"欠费"更能解释问题，所以先判它。 */
  function badWhy(owner, pid, kind) {
    if (AO.rep.stopped(pid, kind)) return { txt: '停修', cls: 'mute' };
    return { txt: '欠费', cls: '' };
  }

  function openRepPanel() {
    if (!AO.rep) return toast('维修层没加载（缺少 js/19-repair.js）', 2600);
    REPU.open = true;
    $('repPanel').classList.add('on');
    $('repBtn').classList.add('open');
    renderRepPanel();
  }
  function closeRepPanel() {
    REPU.open = false;
    $('repPanel').classList.remove('on');
    $('repBtn').classList.remove('open');
  }
  function toggleRepPanel() { if (REPU.open) closeRepPanel(); else openRepPanel(); }

  /* 顶栏按钮上的红点数：本国（或工坊模式下的当前国）有几处失修。
   * 每次刷顶栏都调一次 —— 它只是几个省循环，别为它专门做一个脏标记。 */
  function refreshRepBadge() {
    var b = $('repBadge');
    if (!b || !AO.rep || !state.world) return;
    var owner = repOwner();
    var ks = AO.rep.kinds(), n = 0;
    for (var i = 0; i < ks.length; i++) n += kindCount(owner, ks[i]).bad;
    b.textContent = n > 99 ? '99+' : n;
    b.classList.toggle('on', n > 0);
    $('repBtn').title = '经营：' + (n > 0 ? n + ' 处失修 · ' : '') +
      '维修（按城决定每类建筑留几座在跑）+ 平衡（收支折线图与外推）';
  }

  function renderRepPanel() {
    if (!REPU.open || !state.world || !AO.rep) return;
    var R = AO.rep, owner = repOwner(), c = coOf(owner);
    /* 记住滚动位置：这张表每点一下都整块重画，不记住的话
     * 玩家滚到第 12 个城点一下「−」，列表会跳回顶部 —— 每次都从头找。 */
    var listEl = $('rpPrioList'), bodyEl = $('rpBody');
    var keepTop = listEl ? listEl.scrollTop : 0;
    var keepBody = bodyEl ? bodyEl.scrollTop : 0;
    var selPid = state.renderer ? state.renderer.selected : 0;
    var only = (REPU.scope === 'prov' && selPid && pOf(selPid) && pOf(selPid).owner === owner) ? selPid : 0;
    $('rpWho').textContent = (c ? c.name : '—') + (only ? ' · ' + pOf(only).name : '');
    /* 高亮跟着**实际生效的范围**走：切到「本省」但地图上没选中省时，
     * 面板其实在按全国算 —— 这时候还亮着「本省」就是在骗人。 */
    var scopeOn = (REPU.scope === 'prov' && !only) ? 'all' : REPU.scope;
    var sc = $('rpScope').querySelectorAll('button');
    for (var si = 0; si < sc.length; si++) sc[si].classList.toggle('on', sc[si].getAttribute('data-scope') === scopeOn);

    /* 左栏（平衡）先画：它读的是同一份数据，先画完再看右栏的改动，
     * 玩家减一座渔港的**下一次**重画里，左边的线就已经跟着变了。 */
    if (AO.balUI) AO.balUI.render();

    /* ---- 国库条 ---- */
    var cen = ensureCentral(owner);
    var res = R.reserve();
    $('rpTreasury').innerHTML = '<span>中央 · 铁 <b>' + Math.floor(cen.iron || 0) +
      '</b> · 金 <b>' + Math.floor(cen.gold || 0) + '</b></span>' +
      '<span class="' + (res > 0 ? 'ok' : 'warn') + '">本回合可拨维护 <b>' + Math.round(res) + '</b></span>' +
      (only ? '<span>本省 · 铁 <b>' + Math.floor((SIM[only] && SIM[only].iron) ? SIM[only].iron.stock : 0) +
        '</b> · 金 <b>' + Math.floor((SIM[only] && SIM[only].gold) ? SIM[only].gold.stock : 0) + '</b></span>' : '');
    $('rpTreasury').title = '维护先扣本省库存，不够的部分由中央的维护拨款补（拨款花完就停产）。\n' +
      '「本回合可拨维护」= 结算开始时按上回合实付批的一笔钱（见 js/19-repair.js 中央配给）。\n' +
      '想让铁金花得慢一点：把某一类某个城的「保留座数」减下来。';

    /* ---- ① 保留座数表 ---- */
    var ks = R.kinds(), h = '', i, totalBad = 0, totalAll = 0, totalKeep = 0, anyCut = false;
    for (i = 0; i < ks.length; i++) {
      var k = ks[i], st = kindCount(owner, k, only);
      totalBad += st.bad; totalAll += st.all; totalKeep += st.keep;
      if (st.all && st.keep < st.all) anyCut = true;
      var open = !!REPU.exp[k];
      h += '<div class="rprow' + (st.all ? '' : ' empty') + (open ? ' open' : '') +
          (st.all && st.keep < st.all ? ' cut' : '') + '" data-kind="' + k + '">' +
        '<span class="rn" title="' + escHtml(kindTip(k)) + '"><i class="i" style="background:' + kindColor(k) + '"></i>' +
          escHtml(R.kindCn(k)) + (R.food[k] ? '<span class="tg" title="断它就是断口粮：民心与人口一起掉">口粮</span>' : '') +
          /* ✓够用 / ▲过量：平衡栏干跑完顺手算的（AO.balUI.mark），两边同一份数 */
          (AO.balUI && AO.balUI.mark ? AO.balUI.mark(k) : '') +
        '</span>' +
        '<span class="nc">' + (st.all || '—') + '</span>' +
        '<span class="nc kp">' + (st.all ? st.keep + '/' + st.all : '—') + '</span>' +
        '<button type="button" class="rx" data-act="exp" title="展开：每个城留几座在跑">' +
          (open ? '▴' : '▾') + '</button>' +
        '</div>';
      if (open) h += cityBlock(owner, k, only);
    }
    $('rpPrioList').innerHTML = h;
    $('rpPrioN').textContent = '· 在跑 ' + totalKeep + ' / ' + totalAll + ' 座' +
      (totalBad ? ' · ' + totalBad + ' 处失修' : '');

    /* ---- ② 失修清单（主动停的不算失修，所以这里过滤掉 lv.off） ---- */
    var rows = [];
    var provList = only ? [only] : (c ? c.provinces : []);
    for (i = 0; i < provList.length; i++) {
      var pid = provList[i];
      for (var kj = 0; kj < ks.length; kj++) {
        var kk2 = ks[kj], lv = repLive(pid, kk2);
        if (!lv || !lv.halted || lv.off || !(lv.built || lv.n)) continue;
        var cost = R.cost(pid, kk2);
        var why = badWhy(owner, pid, kk2);
        var pp = pOf(pid);
        rows.push({ pid: pid, kind: kk2, name: pp ? pp.name : ('#' + pid), color: pp ? pp.ownerColor : '#999',
          why: why, cost: cost, total: cost ? (cost.iron + cost.gold) : 0 });
      }
    }
    /* 便宜的排前面：玩家一眼看到的就是"最该先修的" */
    rows.sort(function (a, b) { return a.total - b.total || a.pid - b.pid; });
    var hb = '';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      hb += '<div class="rpbad" data-pid="' + r.pid + '" data-kind="' + r.kind + '">' +
        '<span class="pn2" title="' + escHtml(r.name) + '"><i style="background:' + r.color + '"></i>' +
          escHtml(r.name) + '</span>' +
        '<span class="pk">' + escHtml(R.kindCn(r.kind)) + '</span>' +
        '<span class="pc ' + r.why.cls + '" title="' + escHtml(r.why.txt +
          '：' + (r.why.txt === '停修' ? '你点了「停修」，它不再自动缴费' : '铁/金没凑齐，这回合没交上')) + '">' +
          escHtml(r.why.txt) + '</span>' +
        '<span class="pc' + (r.total ? '' : ' mute') + '">' + (r.cost ? R.costText(r.cost) : '—') + '</span>' +
        '<button type="button" class="go" data-act="fix" title="立刻修好：' +
          (r.cost ? R.costText(r.cost) + '（本省 → 中央，一次性付清）' : '免费') + '">修</button>' +
        '<button type="button" class="stop" data-act="stop" title="停修 / 恢复">停</button>' +
        '</div>';
    }
    $('rpBadList').innerHTML = hb || '<div class="rpEmpty">没有失修的 —— 该缴的维护都缴上了。' +
      (anyCut ? '' : '<br>要是嫌铁金花得太快，点上面任一行的 ▾，把那个城的「保留座数」减下来：' +
        '停掉的座不缴维护、也不产出。') + '</div>';
    $('rpBadN').textContent = rows.length ? '· ' + rows.length + ' 处' : '· 0 处';

    /* 把滚动位置放回去（见函数开头） */
    if (listEl) listEl.scrollTop = keepTop;
    if (bodyEl) bodyEl.scrollTop = keepBody;
  }

  /* 一类的**分城明细**：每个有这类建筑的城一行。
   * 资源建筑给「− 数字 +」（能精确到座）；学校/市场/兵营这类产出是离散的，
   * 只有「开 / 停」两态 —— 留半所学校没有意义，硬做成滑块只会骗人。
   * 底部小计写清两件事：在跑几座、停掉那些每回合省下多少铁金（数字和结算同源）。 */
  function cityBlock(owner, kind, only) {
    var rows = cityRows(owner, kind, only);
    if (!rows.length) return '<div class="rpcity"><div class="rpcnone">这一类还没有建成的城</div></div>';
    var def = AO.RESOURCE_BY_KEY[kind];
    var h = '<div class="rpcity" data-kind="' + kind + '">';
    var sIron = 0, sGold = 0, lost = 0, act = 0, all = 0, i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], mp = maintPair(r.pid, kind, owner);
      act += r.active; all += r.built;
      sIron += Math.max(0, (mp.all.iron || 0) - (mp.now.iron || 0));
      sGold += Math.max(0, (mp.all.gold || 0) - (mp.now.gold || 0));
      if (def) {
        var s0 = SIM[r.pid] && SIM[r.pid][kind];
        if (s0) lost += simPerTurn(s0, def) - simPerTurn(s0, def, r.pid, kind);
      }
      h += '<div class="rpc" data-pid="' + r.pid + '">' +
        '<span class="pn" title="' + escHtml(r.name) + '"><i style="background:' + r.color + '"></i>' +
          escHtml(r.name) + '</span>' +
        '<span class="nn">' + r.built + ' 座</span>';
      /* 只有一座的城（大多数省就是这样）没有"留几座"的余地：开或停。
       * 硬给它画一个两边都是灰的步进器，只会让整张表看起来全是废按钮。 */
      if (!def || r.built <= 1) {
        var on = r.active > 0;
        h += '<button type="button" class="sw' + (on ? ' on' : '') + '" data-act="onoff" ' +
          'title="' + (on ? '停掉：不缴维护、不产出（座数不掉，随时开回来）' : '开回来：恢复缴维护与产出') + '">' +
          (on ? '开' : '停') + '</button>';
      } else {
        h += '<span class="stp">' +
          '<button type="button" data-d="-1" title="少留一座"' + (r.active <= 0 ? ' disabled' : '') + '>−</button>' +
          '<b>' + r.active + '</b>' +
          '<button type="button" data-d="1" title="多留一座"' + (r.active >= r.built ? ' disabled' : '') + '>+</button>' +
          '</span>' +
          '<button type="button" class="q" data-q="0" title="这个城全停">停</button>' +
          '<button type="button" class="q" data-q="1" title="这个城全开">全</button>';
      }
      h += '</div>';
    }
    h += '<div class="rpcsum">在跑 <b>' + act + '</b> / ' + all + ' 座' +
      (def && lost > 0 ? ' · 少产 <b>' + fmt1(lost) + '</b> ' + (def.prod || '') : '') +
      (sIron + sGold > 0.05 ? ' · 省 <b>' + fmt1(sIron) + '</b> 铁 <b>' + fmt1(sGold) + '</b> 金／回合' : '') +
      '</div></div>';
    return h;
  }
  /* 一位小数：维护费本来就是 0.2 一级的零头，取整会让"省了多少"看不出差别 */
  function fmt1(v) { return (Math.round((v || 0) * 10) / 10).toString(); }

  /* 类别的一行说明（悬停）：为什么要单独拆出来 —— 面板上每行只有四个字的名字 */
  function kindTip(k) {
    var d = AO.RESOURCE_BY_KEY[k];
    if (d) return d.build + '：每座每回合产 ' + d.per + '／Lv2 ' + (d.per2 || d.per) +
      '，维护 ' + ((d.maint.iron || 0) + (d.maint.gold || 0)) + ' 铁金';
    if (k === 'wall') return '城墙：按耐久算维护；欠费就年久失修（每回合 −' + AO.WALL.decay + '）';
    var u = univDef(k);
    return (u && u.cn ? u.cn : k) + '：维护 ' + (((u.maint || {}).iron || 0) + ((u.maint || {}).gold || 0)) + ' 铁金／座·回合';
  }
  function kindColor(k) {
    var d = AO.RESOURCE_BY_KEY[k];
    if (d && d.color) return d.color;
    if (k === 'wall') return '#8a8f96';
    return '#b9b2a6';
  }

  /* 上一次点「修」没修成（钱不够）：把还差多少直接写在按钮上，
   * 这样玩家不用去翻 toast 就能知道"差什么、差多少"。 */
  function repFail(r) {
    if (!r) return;
    toast(r.why || '修不了', 3000);
  }

  function repBuildActions() {
    var panel = $('repPanel');
    if (!panel) return;

    $('repBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleRepPanel(); });
    millPanelActions();
    $('rpClose').addEventListener('click', closeRepPanel);
    /* 维修卡里同样挂一颗（和纪要一致）：调完优先级顺手就能结算，
     * 不用伸手去右上角 —— nextTurn 会顺手重画失修清单和徽标。 */
    var rtn = $('rpTurn');
    if (rtn) rtn.addEventListener('click', nextTurn);
    $('rpScope').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-scope]');
      if (!b) return;
      REPU.scope = b.getAttribute('data-scope');
      renderRepPanel();
    });

    /* 保留座数：**点一下就生效**（不需要确认）—— 它随时能改回来，
     * 而且改完立刻能看见"在跑 6/14 · 省 3.2 铁"。
     * 三个动作共用一个入口：展开分城 / 加减一座 / 全开全停。 */
    $('rpPrioList').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var owner = repOwner();
      if (!canAct(owner)) return toast(lockTitle(), 2600);

      /* ① 展开 / 收起分城明细 */
      if (b.getAttribute('data-act') === 'exp') {
        var row0 = b.closest('.rprow');
        if (!row0) return;
        var k0 = row0.getAttribute('data-kind');
        if (REPU.exp[k0]) delete REPU.exp[k0]; else REPU.exp[k0] = 1;
        renderRepPanel();
        return;
      }

      var city = b.closest('.rpc');
      if (!city) return;
      var pid = +city.getAttribute('data-pid');
      var box = city.closest('.rpcity');
      var kind = box ? box.getAttribute('data-kind') : null;
      if (!kind || !pOf(pid)) return;
      var lv = repLive(pid, kind);
      if (!lv) return;
      var built = lv.built | 0;

      /* ② 通用设施：开 / 停 */
      if (b.getAttribute('data-act') === 'onoff') {
        var off = keepOff(pid, kind);
        AO.rep.setKeep(pid, kind, off ? null : 0);
        toast(AO.rep.kindCn(kind) + (off ? ' 恢复（照常缴维护、出产）' : ' 已停（不缴维护、不产出，座数不掉）'), 2200);
        repAfterEdit(owner);
        return;
      }

      /* ③ 资源建筑：− / + 一座，或整城全开全停 */
      var q = b.getAttribute('data-q');
      if (q !== null) {
        AO.rep.setKeep(pid, kind, q === '1' ? null : 0);
        repAfterEdit(owner);
        return;
      }
      var d = +(b.getAttribute('data-d') || 0);
      if (!d) return;
      var cur = lv.active | 0;
      var next = Math.max(0, Math.min(built, cur + d));
      /* 留满 = 直接清掉这一格（"全开"要跟着以后新盖的房子一起走） */
      AO.rep.setKeep(pid, kind, next >= built ? null : next);
      repAfterEdit(owner);
    });

    /* 改完保留座数之后统一收尾：重画面板 + 重算顶栏红点。
     * 平衡页的预测是"按当前设置外推"，改了座数就得立刻重算 ——
     * 所以 renderRepPanel 在平衡页签下会转手让 20-balance 重画（见那里的分派）。 */
    function repAfterEdit(owner) {
      renderRepPanel();
      refreshRepBadge();
    }

    /* 失修行：修 / 停 */
    $('rpBadList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var row = b.closest('.rpbad');
      if (!row) return;
      var pid = +row.getAttribute('data-pid'), kind = row.getAttribute('data-kind');
      var p = pOf(pid);
      if (!p) return;
      if (!canAct(p.owner)) return toast(lockTitle(), 2600);
      if (b.getAttribute('data-act') === 'stop') {
        var on = !AO.rep.stopped(pid, kind);
        AO.rep.setStopped(pid, kind, on);
        toast(AO.rep.kindCn(kind) + (on ? ' 已「停修」：不再自动缴费（想恢复点一下「停」）'
          : ' 恢复缴费'), 2600);
        renderRepPanel();
        return;
      }
      var r = AO.rep.repair(pid, p.owner, kind);
      if (!r.ok) { repFail(r); return; }
      toast('修好 ' + AO.rep.kindCn(kind) + '：' + AO.rep.costText(r.cost) +
        '（' + p.name + '）', 2600);
      renderRepPanel();
      refreshRepBadge();
      if (state.renderer && state.renderer.selected === pid) showInfo(pid);
    });

    /* ESC 关面板：和科技树 / 治理面板同一套习惯。
     * 用捕获阶段，免得那三个全屏面板的 ESC 处理器先吃掉按键。 */
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !REPU.open) return;
      closeRepPanel();
      e.stopPropagation();
    }, true);
  }
  /* repUI 是这一层对外的把手（测试 / 20-balance 都用它）：
   *   isOpen() —— 全屏「经营」页开着没有。20-balance 用它决定要不要重画，
   *              这样"什么时候画图"只有一处判断，不会两边各记一份状态。 */
  AO.repUI = { open: openRepPanel, close: closeRepPanel, toggle: toggleRepPanel,
    render: renderRepPanel, badge: refreshRepBadge, state: REPU,
    isOpen: function () { return !!REPU.open; } };

  /* 维修层（js/19-repair.js）拿内部件：它只管"谁先付、修哪个、多少钱"，
   * 真正的库存表和建筑状态还留在这个闭包里 —— 所以只能把读写的把手递出去。
   * 递的东西刻意做得少：几个查询 + 三个动作（缴费 / 扣款 / 拆墙）+ 一条纪要。 */
  function repBoot() {
    if (!AO.repAttach) return;
    AO.repAttach({
      world: function () { return state.world; },
      prov: pOf,
      sim: SIM,
      central: ensureCentral,
      wall: function (pid) { return WALL[pid] || null; },
      turn: function () { return turnNo; },
      live: repLive,
      /* 缴费：单据形状和 payMaint 一样。canPool / takePool 由
       * 19-repair 自己回填（repAttach 里挂上去），payMaint 从 AO.rep 上取。 */
      pay: function (pid, owner, demand, acc, kind) { return payMaint(pid, owner, demand, acc, kind); },
      draw: drawStock,
      razeWall: function (pid) { delete WALL[pid]; },
      note: function (owner, text, cls) { NOTES.push({ owner: owner, cls: cls || 'ok', text: text }); }
    });
    repBuildActions();                 // 面板的点击都绑在这里（DOM 早就有了）
  }

  /* 平衡分析（20-balance.js）拿内部件。
   * 它要的东西很少：一张世界、一份流水、一份口粮数、一份保留座数 ——
   * 都是"读"，一个"写"都不给：分析面板不该能改模拟。 */
  function balBoot() {
    if (!AO.balAttach) return;
    AO.balAttach({
      world: function () { return state.world; },
      player: function () { return PLAYER; },
      viewOwner: repOwner,
      flow: FLOW, flowc: FLOWC, pop: POP,
      central: ensureCentral,
      rep: AO.rep,
      live: repLive,
      turn: function () { return turnNo; },
      /* ---- 干跑预测（DESIGN-FORECAST）递的只读件：预测要逐回合重演结算的
       * 产出/维护算路，闭包里的战争标记和整合度表拿不到就只能抄公式 ——
       * 抄出来的数一旦和结算分叉，那张图就再也没人信。所以一律走钩子。 */
      sim: SIM,
      wall: function (pid) { return WALL[pid | 0] || null; },
      /* 战争态门（围城全归零 / 封锁断渔 / 匪乱断产一回合）：照 settleTurn ③
       * 的判断写。匪乱那条看的是"下一次结算的 turnNo−1"，也就是当前的 turnNo。 */
      prodGate: function (pid, key) {
        pid = pid | 0;
        if (SIEGE[pid]) return 0;
        if (key === 'fish' && BLOCKADE[pid]) return 0;
        var b = BANDIT[pid];
        if (b && b.turn === turnNo) return 0;
        return 1;
      },
      /* 产量乘数：官员词条 × 占领整合度 × 事件（渔汛/大旱），与 ③ 段同一链 */
      prodMulOf: function (pid, key, owner) {
        var pmod = PMOD(pid | 0, owner);
        var mul = (pmod.prodMul && pmod.prodMul[key]) || 1;
        if (OCCUPY[pid | 0]) {
          var itg = INTEG[pid | 0];
          mul *= AO.INTEG.prodMul(itg ? itg.v : 0);
        }
        if (AO.evtProdMul) mul *= AO.evtProdMul(pid | 0, key);
        return mul;
      },
      /* 通用设施的单座维护（repLive 只给合计，干跑要按座数重算） */
      univMaint: function (kind) { return univDef(kind).maint; },
      /* 「去看看」：选中那省 + 打开省卡（和测试用的 showInfo 同一条路） */
      gotoProv: function (pid) {
        pid = pid | 0;
        if (!pid || !pOf(pid)) return;
        if (state.renderer) state.renderer.select(pid);
        showInfo(pid);
      }
    });
  }

  function boot() {
    bind();
    /* 抽屉的初始位（v16）：这四个只读 localStorage，跨刷新记得住玩家上次怎么摆的 */
    applyDetail();
    applyGroups();
    applyCountryTab();
    updateTurnLabel();
    evtBoot();                         // 事件层拿内部件（必须在第一次 generate 之前）
    chronoBoot();                      // 编年史层拿内部件（同上）
    repBoot();                         // 维修层拿内部件（同上）
    balBoot();                         // 平衡分析拿内部件（同上，只读）
    var savedOpen = null;
    try { savedOpen = localStorage.getItem('sj.panelOpen'); } catch (e) { /* 忽略 */ }
    setPanel(savedOpen === '1');       // 没记录过 → 默认收起
    generate();
    refreshLocks();                    // 顶栏那颗「开始游戏 / 退出游戏」的文字
    refreshRepBadge();                 // 顶栏「维修」的红点（开局就有失修的话立刻亮）
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
