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
    for (var rar in REMITACC_R) delete REMITACC_R[rar];
    for (var rsk in RESACC) delete RESACC[rsk];
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
    /* 官员 id 计数也归零（v19.3）：开局铺底那 500 多位要拿 1..N，
     * 不归零的话同一颗种子在"重新生成"之后 id 会一直往上爬。 */
    GOV_ID = 1;
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
    for (var cq in CONQ) delete CONQ[cq];
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
    state.openKey = null;
    state.infoId = 0;
    state.moveFrom = 0;
    // 让浏览器先把"生成中"画出来，再释放一次垃圾，最后才做重活
    setTimeout(function () {
      try {
        var t0 = root.performance.now();
        var world = AO.generate(opts);
        var ms = root.performance.now() - t0;
        state.opts = opts;
        state.world = world;
        root.__world = world;                    // 调试用
        /* AoC2 数据模型已经由 AO.generate 挂好（15-aoc2 的 initWorld）。
         * 旧的 seedAllSims（每省铺资源 / 建筑 / 官员）随七种资源一起退役 ——
         * 现在一个省只有人口、经济、发展度、稳定、幸福、革命风险这几项。 */
        /* 事件 / 信仰（v4）：换世界必须全清 —— 冷却表、传教中、政策、国教
         * 都是"这一局"的，留着会让新世界的第 3 回合突然跳出上一局的旧事件。 */

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
  /* 物资上解的零头（v19.1）：键是 `pid|key`（和 RESACC 一个形状），10%/20% 两段
   * 乘出来都是小数，floor 掉就永远搬不动 —— 一个 40 铁的省会一直"上解 0"。
   * 和 REMITACC 一样**进档**：存的是零头，不存的话读档后那点零头归零。 */
  var REMITACC_R = Object.create(null);
  /* 生产抽税的零头（v18.12）：按比例抽之后每笔都是小数（产出 3 × 1/3 = 1），
   * 逐笔 floor 会把零头全丢掉。键是 `pid|key`，**不进存档**：
   * 最多丢每种不到 1 单位，换个世界的代价也一样。 */
  var RESACC = Object.create(null);
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
  /* CONQ：省 id → 易主的回合号（v19.4）。**只记"官跟着旧朝廷一起没了"的那些省**。
   * 为什么要单独记：v19.3 起每省开局都坐一位"吏"，所以"无官"只会出现在易主之后；
   * 而用户定的口径是"占领省不给吏 —— 打下来的省必须派真官"。判据不能看 OCCUPY
   * （整合完就删了），也不能看 p.owner（世界重生成后原始归属就没了），所以记一张表。
   * 旧档没有这块 → 空表：那些省会被当成老国土（能补吏），只影响补吏的松紧，不影响存量。 */
  var CONQ = Object.create(null);
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
































  AO.resWar = {
    army: ARMY, generals: GENERALS, wars: WARSET, occupy: OCCUPY, siege: SIEGE,
    blockade: BLOCKADE, dead: DEAD, recruitQ: RECRUITQ, base: WARBASE
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
      seedPlainOfficials(c);          // v19.3：每省先坐一位 plain（无加成、不领俸禄）
      seedPlainGeneral(c);            // v19.5：每国先有一位 plain 将（没将不能宣战）
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


  /* 结算一回合：所有省的资源与工地各走一步 */
  /* =============================================================
   * 结算一回合（AoC2 口径，阶段一）
   *
   * 旧制的四百行逐省循环（维护 / 停产 / 产出 / 抽税 / 上解 / 官员 / 科研 /
   * 战争 / 叛乱 / 情报 / 外交 / 事件 / 物价）整体退役 —— 换血不是"把新规则
   * 插进旧循环"，那会得到一套两本账互相打架的怪物。
   *
   * 现在的顺序全在 AO.aoc2.settle 里（规则书第三、八章）：
   *   省收入 → 国库 → 行政费/军费/利息 → 物资 → 幸福 → 稳定 → 增长
   * 这里只做三件事：推进回合号、给玩家一条能读的反馈、归档编年史。
   *
   * 本阶段**没有军队、没有战争** —— 世界是纯经济沙盒，这是刻意的中间态
   * （任务书阶段一末句）。军队与战争在阶段二回来。
   * ============================================================= */
  function settleTurn() {
    turnNo++;
    var w = state.world;
    if (!w) return;
    var transfers0 = AO.aoc2.transfers || 0;
    /* 必须把 PLAYER 传进去：不传的话玩家国也会被 AI 接管（自动征兵 / 自动宣战），
     * 实测第 21 回合国库被自己的"AI 政府"花掉三分之一。 */
    AO.aoc2.settle(w, { player: PLAYER });
    /* 和约割地会改归属：路径缓存得重建，否则地图还画着旧国界 */
    if ((AO.aoc2.transfers || 0) !== transfers0 && state.renderer && state.renderer.refreshGeometry) {
      state.renderer.refreshGeometry();
    }

    /* 给玩家一条能读的反馈：自己国这一回合的钱怎么来的、怎么没的 */
    var me = PLAYER ? w.countries[PLAYER - 1] : null;
    if (me && me.aoc && me.aoc.last) {
      var L = me.aoc.last;
      var sign = L.net >= 0 ? '+' : '−';
      NOTES.push({
        owner: me.id, cls: L.net >= 0 ? '' : 'warn',
        text: '国库 ' + (L.net >= 0 ? '+' : '−') + Math.abs(Math.round(L.net)) + ' 金' +
          '（毛收入 ' + Math.round(L.gross) + ' · 入库 ' + Math.round(L.taxIn) +
          ' · 行政 ' + Math.round(L.admin) + '）'
      });
    }
    /* 编年史归档（平台层，保留） */
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


  /* 整合度：**只有占领省才有**（没占领就是 0，不建记录 —— 1100 个省全建一份
   * 会让存档凭空胖一圈，而"没占领"这个状态本身就是默认值） */
  function integOf(pid) {
    var it = INTEG[pid | 0];
    if (!it) return null;
    if (typeof it.v !== 'number' || !isFinite(it.v)) it.v = 0;
    return it;
  }




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

      // 测试要能直接掷 1000 次验概率







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

  /* 付账：**谁的钱先出**由 from / pull 决定（v19.2 建造分工）。
   *   from = 'central' → 中央国库 → 本省 → 同国调拨   （AI 建造/养兵走这条）
   *   from = null      → 本省 → 中央 → 同国调拨       （玩家，老口径）
   *   pull = false     → 中央 + 本省凑不齐就不办（不向邻近省伸手）
   * 先全部核算，凑齐了才真扣，避免"扣了一半又失败"。 */
  function payCost(p, cost, from, pull, useProv, useCen) {
    var keys = Object.keys(cost), i, k;
    var cen = ensureCentral(p.owner);
    var cenFirst = (from === 'central');
    var canPull = (pull !== false);
    var canProv = (useProv !== false);
    var canCen = (useCen !== false);
    var fromCen = {}, fromProv = {}, short = {};
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      var need0 = cost[k];
      var provPay = 0, cenPay = 0;
      if (cenFirst) {
        cenPay = canCen ? Math.min(cen[k] || 0, need0) : 0;
        if (canProv) provPay = Math.min(stockOf(p.id, k), need0 - cenPay);
      } else {
        provPay = canProv ? Math.min(stockOf(p.id, k), need0) : 0;
        cenPay = canCen ? Math.min(cen[k] || 0, need0 - provPay) : 0;
      }
      fromCen[k] = cenPay;
      fromProv[k] = provPay;
      short[k] = Math.max(0, need0 - provPay - cenPay);
    }
    var loss = effectiveLoss(p.id, p.owner);
    var need = {}, list = canPull ? countryProvinces(p.owner) : [];
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

    /* 真扣：本省（按上面算好的份额，顺序无所谓，份额已经定死） */
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (fromProv[k] > 0) SIM[p.id][k].stock -= fromProv[k];
    }
    /* 真扣：中央 */
    for (k in fromCen) if (fromCen[k] > 0) cen[k] -= fromCen[k];
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

  /* 建造付款的唯一入口（v19.2）：**两条账分开**（见 GOV.buildPay）。
   *   local（省里经营：资源建筑 / 升档 / 熔旧坊 / 淘金场）
   *       → 只掏省库；掏不出就不建（不许向中央要，也不向邻省伸手）
   *   nat（国家工程：学校 / 市场 / 粮仓 / 兵营 / 大学 / 工厂）
   *       → 只掏中央；中央没有就不建（这才是"中央自己要建"）
   *   玩家 → 仍是 省库 → 中央 → 调拨（他要看得见自己付了什么）。
   * 分成一个函数是为了"只改这一处" —— 建造有七个入口，漏一个就出现
   * "省 AI 又从中央掏钱盖房"。 */
  function payBuild(p, cost, silent, nat) {
    var B = (AO.GOV && AO.GOV.buildPay) || {};
    if (!silent) return payCost(p, cost, null, true, true, true);
    var R = (nat ? B.nat : B.local) || {};
    return payCost(p, cost, R.from || (nat ? 'central' : 'prov'),
      R.pull === true, R.useProv !== false, R.useCen !== false);
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
   * nat=true 表示这一座是**中央自己决定要建的**（缺矿 / 人挤 / 开新矿），
   * 钱从中央出；不传就是"省里自己经营"，只掏省库（见 GOV.buildPay）。
   * 为什么同一个函数走两遍而不是另写一套"AI 建造"：付账顺序、工期、调拨损耗
   * 全在这里，抄一份出去迟早两边对不上账。
   * AI 也不该弹提示条 —— 36 个国家每回合各盖一座，弹一次就吃掉玩家的界面。 */
  function buildOne(p, key, silent, nat) {
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
    var r = payBuild(p, cost, silent, nat);
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
    /* 国家工程（学校/市场/粮仓/兵营/大学/工厂）→ nat 那条账：中央出 */
    var r = payBuild(p, D.cost, silent, true);
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


  /* 箭头 + 数字，三处（价格板 / 货源行 / 国库总览）共用一套写法，
   * 免得一处写「↑」一处写「涨」。 */
  function priceArrow(t) { return t > 0 ? '↑' : t < 0 ? '↓' : '—'; }
  function priceNum(v) { return (Math.round((v || 0) * 100) / 100).toFixed(2); }


  /* 全国库存（含中央国库）：中央的粮也是这个国的粮，
   * 不算进来的话"国库囤了一仓粮、各省却报高价"，玩家会觉得价格板在骗人。 */
  function countryStock(cid, key) {
    var list = countryProvinces(cid), out = 0, i;
    for (i = 0; i < list.length; i++) out += stockOf(list[i].id, key);
    var cen = CENTRAL[cid | 0];
    if (cen) out += (cen[key] || 0);
    return out;
  }


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

  /* 这一级墙每回合的维护（铁 + 金），吃「标准工料」的折扣 */
  function wallMaintDue(w, owner) {
    var m = AO.WALL.maintAt(w ? w.lv : 0);
    var cut = owner ? 1 - (MODS(owner).maintCut || 0) : 1;
    return { iron: (m.iron || 0) * cut, gold: (m.gold || 0) * cut };
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
    /* 改建是省里自己的事（local 那条账）：只掏省库，掏不出就等 */
    var r = payBuild(p, D.cost, silent, false);
    if (!r.ok) {
      return say('改建资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need +
        '（本省省库没这么多料）', 'warn');
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
    /* 改建是省里自己的事（local 那条账）：只掏省库，掏不出就等 */
    var r = payBuild(p, D.cost, silent, false);
    if (!r.ok) {
      return say('改建资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need +
        '（本省省库没这么多料）', 'warn');
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
          // 预览/调试用

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
    /* 物资上解（v19.1）：和上面同一件事，只是换了个"单位"。
     * 合并成一行（"上解 −2 铁 · 1 木"）—— 一种资源一行会把小结撑成十行。 */
    if (F.d.remitRes) {
      var rs2 = [];
      for (k in F.d.remitRes) {
        if (!F.d.remitRes[k]) continue;
        rs2.push(F.d.remitRes[k] + ' ' + (AO.RES_SHORT[k] || k));
      }
      if (rs2.length) parts.push('上解 −' + rs2.join(' · ') + '（省库 → 中央）');
    }
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
          showInfo(id);
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
    /* 开局铺底的"吏"不领俸禄（v19.3），别在 tooltip 里写一个不会扣的数 */
    var payNow = (off.seed && !(G.seedOff && G.seedOff.grow))
      ? 0 : G.salary * (G.rankPay[off.rank] || 1);
    if (payNow > 0) {
      L.push('俸禄 ' + payNow.toFixed(2) + ' 金/回合（省库发）' +
        (off.owed ? '　欠俸 ' + off.owed + ' 金（下回合补，不罚）' : ''));
    } else {
      L.push('开局属吏：不领俸禄、不升迁 —— 加成要靠开科取士换人');
    }
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

  /* =============================================================
   * 省份卡（AoC2 口径，阶段一）
   *
   * 信息区只放规则书第一章的省字段：人口 / 经济 / 发展度 / 稳定 / 幸福 / 增长
   * + 核心 / 价值。旧制的七种资源、建筑、军备、货运整块下掉 —— 那些是"省里
   * 有几座矿、几座坊"的世界，AoC2 的省只有一个数字（经济）和一群人（人口）。
   *
   * 卡上唯一的操作是三条敕令（规则书第二十一章），都花移动点。
   * ============================================================= */
  function fmtGold(n) { return Math.round(n || 0).toLocaleString(); }

  function coreText(w, p) {
    var out = [], k;
    for (k in p.aoc.core) {
      var cc = w.countries[(k | 0) - 1];
      if (cc) out.push(cc.name);
    }
    return out.length ? out.join('、') : '无主';
  }

  function renderAocDecree(p) {
    var box = $('iDecree');
    if (!box) return;
    box.innerHTML = '';
    var w = state.world, c = w.countries[p.owner - 1];
    if (!c || !c.aoc) return;
    var mine = canAct(p.owner);
    var kinds = [
      { k: 'festival', cn: '节日', d: '幸福 +0.1 / 2 万人口' },
      { k: 'econ', cn: '投资经济', d: '上限 = 人口' },
      { k: 'dev', cn: '投资发展', d: '发展度 +0.02' }
    ];
    for (var i = 0; i < kinds.length; i++) {
      var kd = kinds[i];
      var cost = AO.aoc2.decreeCost(w, p.id, kd.k) || 0;
      var mp = AO.AOC2.MP_COST[kd.k] || 0;
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<b>' + kd.cn + '</b><em>' + kd.d + '</em><em>' +
        fmtGold(cost) + ' 金 · ' + mp + ' 点</em>';
      var why = '';
      if (!mine) why = '不是你的国家';
      else if (c.aoc.mp < mp) why = '移动点不够';
      else if (c.aoc.treasury < cost) why = '国库不足';
      else if (kd.k === 'econ' && p.aoc.econ >= AO.aoc2.totalPop(p) - 0.5) why = '经济已到人口上限';
      else if (kd.k === 'dev' && p.aoc.dev >= AO.AOC2.DEV_MAX - 1e-9) why = '发展度已到 2.0';
      btn.disabled = !!why;
      btn.title = (why ? why + '　／　' : '') + '花 ' + mp + ' 移动点';
      if (!why) {
        (function (kind) {
          btn.addEventListener('click', function () {
            var r = AO.aoc2.decree(state.world, p.owner, kind, p.id);
            toast(r.msg, r.ok ? 2200 : 3000);
            if (r.ok) {
              AO.aoc2.recomputeCountry(state.world, c);
              showInfo(p.id);
              if ($('country').classList.contains('on')) showCountry(p.owner);
            }
          });
        })(kd.k);
      }
      box.appendChild(btn);
    }
    var mpEl = $('iMP');
    if (mpEl) mpEl.textContent = '移动点 ' + c.aoc.mp + ' / ' + c.aoc.mpMax;
  }

  /* ---------------- 军务行（省卡）：征兵 / 移动 / 掠夺 / 解散 ---------------- */
  function renderAocArmy(p) {
    var box = $('iArmy');
    if (!box) return;
    box.innerHTML = '';
    var w = state.world, c = w.countries[p.owner - 1];
    if (!c || !c.aoc) return;
    var troops = p.aoc.army | 0;
    var owner = troops > 0 ? (p.aoc.armyOf || p.owner) : 0;
    var mine = owner ? canAct(owner) : canAct(p.owner);
    var info = $('iArmyInfo');
    if (info) {
      info.textContent = troops > 0
        ? (owner === p.owner ? '驻军 ' : '占领军 ') + troops.toLocaleString()
        : '无驻军';
    }
    function mk(label, sub, ok, fn, title) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.innerHTML = '<b>' + label + '</b>' + (sub ? '<em>' + sub + '</em>' : '');
      b.disabled = !ok;
      if (title) b.title = title;
      if (ok) b.addEventListener('click', fn);
      box.appendChild(b);
    }
    var cap = AO.aoc2.recruitCap(p, c.id);
    var gov = AO.aoc2.govOf(c);
    var unit = Math.round(AO.AOC2.RECRUIT_GOLD * gov.recruit);

    /* 征兵（正常价，下一回合到位） */
    var nNormal = Math.min(AO.AOC2.RECRUIT_BATCH, cap);
    mk('征兵 ' + nNormal, (nNormal * unit).toLocaleString() + ' 金 · 下回合到',
      mine && nNormal > 0 && !p.aoc.occupied && c.aoc.treasury >= nNormal * unit,
      function () {
        var r = AO.aoc2.recruit(w, c.id, p.id, nNormal, false);
        toast(r.msg, 2600);
        if (r.ok) { AO.aoc2.recomputeCountry(w, c); showInfo(p.id); if ($('country').classList.contains('on')) showCountry(c.id); }
      },
      '单省上限 = 人口 1/10~1/5；同时扣金和人口');

    /* 即时征（×2 价，立刻到位，花移动点） */
    var nInst = Math.min(AO.AOC2.RECRUIT_BATCH, cap);
    var costI = nInst * unit * AO.AOC2.INSTANT_MUL;
    mk('即时征 ' + nInst, costI.toLocaleString() + ' 金 · ×2',
      mine && nInst > 0 && !p.aoc.occupied && c.aoc.treasury >= costI && c.aoc.mp >= AO.AOC2.MP_COST.recruit,
      function () {
        var r = AO.aoc2.recruit(w, c.id, p.id, nInst, true);
        toast(r.msg, 2600);
        if (r.ok) { AO.aoc2.recomputeCountry(w, c); showInfo(p.id); if ($('country').classList.contains('on')) showCountry(c.id); }
      },
      '征兵敕令：即时到位，正常价 ×2，花 ' + AO.AOC2.MP_COST.recruit + ' 移动点');

    /* 移动：进入"点相邻省"的模式 */
    mk('移动', troops > 0 ? '点相邻省' : '没有兵',
      mine && troops > 0,
      function () {
        state.moveFrom = p.id;
        toast('移动：点一个相邻省（全部 ' + troops.toLocaleString() + ' 兵一起走）', 3200);
      },
      '移动花移动点，按地形倍率');

    /* 掠夺（只在"我占领的省"出现） */
    if (p.aoc.occupied === c.id) {
      mk('掠夺', '+' + Math.round(troops * AO.AOC2.PLUNDER_GOLD).toLocaleString() + ' 金',
        mine && troops > 0 && c.aoc.mp >= AO.AOC2.MP_COST.plunder,
        function () {
          var r = AO.aoc2.plunder(w, c.id, p.id);
          toast(r.msg, 2800);
          if (r.ok) { AO.aoc2.recomputeCountry(w, c); showInfo(p.id); if ($('country').classList.contains('on')) showCountry(c.id); }
        },
        '掠夺占领省：人口 / 经济 / 幸福下降 → 国库进金（军越多抢越多）');
    }

    /* 同化（第十章）：只在"自己的省 + 有异族"时出现 */
    var foreignN = AO.aoc2.totalPop(p) - (p.aoc.pop[p.owner] || 0);
    if (foreignN > 1 && p.owner === c.id && !p.aoc.occupied) {
      var acost = AO.aoc2.assimCost(w, c.id, p.id);
      mk('同化', acost.toLocaleString() + ' 金 · ' + Math.round(foreignN / AO.aoc2.totalPop(p) * 100) + '% 异族',
        mine && c.aoc.treasury >= acost && c.aoc.mp >= AO.AOC2.MP_COST.assimilate,
        function () {
          var r = AO.aoc2.assimilate(w, c.id, p.id);
          toast(r.msg, 3000);
          if (r.ok) { AO.aoc2.recomputeCountry(w, c); showInfo(p.id); if ($('country').classList.contains('on')) showCountry(c.id); }
        },
        '渐进转国籍：一次转掉剩下的 8%；旧核心不删');
    }

    /* 解散（只回填 1/20 人口，规则书第二章） */
    mk('解散', '回填 1/20 人口', mine && troops > 0,
      function () {
        var r = AO.aoc2.disband(w, owner || c.id, p.id, troops);
        toast(r.msg, 2600);
        if (r.ok) { AO.aoc2.recomputeCountry(w, c); showInfo(p.id); if ($('country').classList.contains('on')) showCountry(c.id); }
      },
      '撤编损耗人口：只回填约 1/20');
  }


  /* ---------------- 政体（国卡内政页顶部） ----------------
   * 九种全表；点一下就换（花金、受时代门槛限制）。
   * 为什么做成九宫格而不是下拉：这一页是"看着系数做选择"的地方，
   * 下拉会把八个选项藏起来，玩家只记得住自己现在是什么。 */
  /* ---------------- 建筑（省卡，规则书第五章） ----------------
   * 九格：八种建筑 + 大学（图书馆 2 级的升级）。
   * 一格两行：上面"名字 + 现有等级"，下面"造价 · 工期"。
   * 在建的格子画虚线 —— 造价那一条最反直觉（在建不计入递增），
   * 所以排队中的格子要能一眼认出来。 */
  function renderAocBld(p) {
    var box = $('iBld');
    if (!box) return;
    box.innerHTML = '';
    var w = state.world, c = w.countries[p.owner - 1];
    if (!c || !c.aoc || !AO.aoc2.court) return;
    var C = AO.aoc2.court;
    var mine = canAct(p.owner);
    var q = C.queueOf(p);
    var info = $('iBldInfo');
    if (info) {
      if (q.length) {
        var head = C.BLD[q[0].k];
        info.textContent = '在建 ' + head.cn + '（' + q[0].t + ' 回合）' +
          (q.length > 1 ? ' · 排队 ' + (q.length - 1) : '');
      } else {
        var sum = C.summaryOf(p);
        info.textContent = sum.length ? sum.join(' · ') : '还没有建筑';
      }
    }
    var queued = {};
    for (var qi = 0; qi < q.length; qi++) queued[q[qi].k] = (queued[q[qi].k] || 0) + 1;

    for (var i = 0; i < C.ORDER.length; i++) {
      (function (k) {
        var def = C.BLD[k];
        var lv = C.lv(p, k);
        var chk = C.canBuild(w, c, p, k);
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.innerHTML = '<b>' + def.cn + '<i>' + lv + '/' + def.max + '</i></b>' +
          '<em>' + (chk.ok ? fmtGold(chk.cost) + ' 金 · ' + def.turns + ' 回合' : def.cn1) + '</em>';
        if (lv) btn.className = 'done';
        if (queued[k]) btn.className += ' queued';
        var why = '';
        if (!mine) why = '不是你的国家';
        else if (!chk.ok) why = chk.why;
        btn.disabled = !!why;
        btn.title = (why ? why + '　／　' : '') + def.cn1 +
          (queued[k] ? '　／　在建 ' + queued[k] + ' 个（不计入造价递增）' : '');
        if (!why) {
          btn.addEventListener('click', function () {
            var r = AO.aoc2.court.build(state.world, c.id, p.id, k);
            toast(r.msg, 3000);
            if (r.ok) {
              AO.aoc2.recomputeCountry(state.world, c);
              showInfo(p.id);
              if ($('country').classList.contains('on')) showCountry(c.id);
            }
          });
        }
        box.appendChild(btn);
      })(C.ORDER[i]);
    }
  }

  /* ---------------- 科技（国卡内政页） ----------------
   * 研究进度 → 科技点（100:1）→ 科技等级（每级越贵）。
   * 这里不给"一次点满"的按钮：科技是长期取舍，点一下升一级就够。 */
  function renderAocTech(c) {
    var box = $('cTechBox');
    if (!box) return;
    box.innerHTML = '';
    if (!AO.aoc2.court) return;
    var C = AO.aoc2.court;
    var lvl = C.techOf(c);
    var tp = C.techPoints(c);
    var cost = C.techCost(c);
    var mine = canAct(c.id);
    var row = doc.createElement('div');
    row.className = 'aocslider';
    row.innerHTML = '<span>等级</span><span style="font-variant-numeric:tabular-nums">' +
      lvl.toFixed(2) + ' / 50　科技点 ' + tp.toFixed(2) + '</span>' +
      '<span class="v">' + (lvl >= C.T.TECH_MAX ? '满' : cost + ' 点/级') + '</span>';
    box.appendChild(row);
    var b = doc.createElement('button');
    b.type = 'button';
    b.innerHTML = '<b>研究</b><em>科技 +' + C.T.TECH_STEP + ' · −' + cost + ' 点</em>';
    var why = '';
    if (!mine) why = '不是你的国家';
    else if (lvl >= C.T.TECH_MAX) why = '已经满级';
    else if (tp < cost) why = '科技点不够（' + tp.toFixed(2) + ' / ' + cost + '）';
    b.disabled = !!why;
    b.title = (why ? why + '　／　' : '') +
      '科技每级 +1% 收入 / +1% 战力 / +0.5 省防御 / 每 5 级 +1 移动点';
    if (!why) b.addEventListener('click', function () {
      var r = AO.aoc2.court.techUp(state.world, c.id);
      toast(r.msg, 3000);
      if (r.ok) {
        AO.aoc2.recomputeCountry(state.world, c);
        showCountry(c.id);
      }
    });
    var wrap = doc.createElement('div');
    wrap.className = 'aocrow';
    wrap.appendChild(b);
    box.appendChild(wrap);
  }

  /* 全国建筑合计（内政页一行） */
  function renderAocBldSum(c) {
    var el = $('cBldSum');
    if (!el) return;
    if (!AO.aoc2.court) { el.textContent = ''; return; }
    var C = AO.aoc2.court, cnt = {}, total = 0, i, k;
    for (i = 0; i < c.provinces.length; i++) {
      var p = state.world.provinces[c.provinces[i] - 1];
      if (!p || !p.aoc || !p.aoc.bld) continue;
      for (k in p.aoc.bld) {
        if (!p.aoc.bld[k]) continue;
        cnt[k] = (cnt[k] || 0) + p.aoc.bld[k];
        total += p.aoc.bld[k];
      }
    }
    if (!total) { el.textContent = '还没有建筑 —— 选中自己的省，在省卡「建筑」里建'; return; }
    var parts = [];
    for (i = 0; i < C.ORDER.length; i++) {
      k = C.ORDER[i];
      if (cnt[k]) parts.push(C.BLD[k].cn + ' ' + cnt[k]);
    }
    el.textContent = total + ' 座：' + parts.join(' · ');
  }

  function renderAocGov(c) {
    var box = $('cGovBox');
    if (!box) return;
    box.innerHTML = '';
    var w = state.world;
    var mine = canAct(c.id) && !c.aoc.rebel;
    var cost = AO.aoc2.govSwitchCost(c);
    var era = c.aoc.era || 0;
    var eraCn = ['启蒙', '工业', '现代'][era] || '启蒙';
    var keys = ['monarchy', 'democracy', 'republic', 'communism', 'fascism', 'citystate', 'tribe', 'nomad'];
    for (var i = 0; i < keys.length; i++) {
      (function (key) {
        var g = AO.AOC2.GOV[key];
        var need = AO.aoc2.govEra(key);
        var cur = c.aoc.gov === key;
        var b = doc.createElement('button');
        b.type = 'button';
        b.innerHTML = '<b>' + g.cn + '</b><em>税 ' + g.taxCap + '% · 募 ×' + g.recruit.toFixed(1) +
          ' · 防 +' + g.defense + '%</em>';
        var why = '';
        if (cur) why = '当前政体';
        else if (!mine) why = c.aoc.rebel ? '叛军只有一种活法' : '不是你的国家';
        else if (era < need) why = '要' + ['启蒙', '工业', '现代'][need] + '时代';
        else if (c.aoc.treasury < cost) why = '国库不足（需 ' + cost.toLocaleString() + ' 金）';
        b.disabled = !!why;
        b.title = (why ? why + '　／　' : '') + (cur ? '' : '换政体 ' + cost.toLocaleString() + ' 金');
        if (cur) b.style.borderColor = '#8a6d34';
        if (!why) b.addEventListener('click', function () {
          var r = AO.aoc2.setGov(w, c.id, key);
          toast(r.msg, 3200);
          if (r.ok) {
            AO.aoc2.recomputeCountry(w, c);
            showCountry(c.id);
            if (state.renderer && state.renderer.selected) showInfo(state.renderer.selected);
          }
        });
        box.appendChild(b);
      })(keys[i]);
    }
    var tip = doc.createElement('div');
    tip.className = 'hint';
    tip.textContent = '当前 ' + AO.aoc2.govOf(c).cn + ' · ' + eraCn + '时代 · 换政体 ' +
      cost.toLocaleString() + ' 金';
    box.appendChild(tip);
  }

  /* ---------------- 战争页（国卡） ---------------- */
  function renderAocWar(c) {
    var w = state.world;
    var armyEl = $('cArmy'), wearEl = $('cWear');
    if (armyEl) armyEl.textContent = AO.aoc2.armyOf(w, c.id).toLocaleString() + ' 人';
    if (wearEl) {
      var wr = Math.round((c.aoc.wear || 0) * 100);
      wearEl.textContent = wr + '%' + (wr >= 70 ? '（军费膨胀中）' : '');
    }
    var box = $('cWars');
    if (!box) return;
    box.innerHTML = '';
    var wars = AO.aoc2.warsOf(w, c.id);
    if (!wars.length) {
      box.innerHTML = '<div class="hint">没有交战国。宣战要花 ' + AO.AOC2.WAR_DIP_COST +
        ' 外交点，开局 ' + AO.AOC2.WAR_BAN_TURNS + ' 回合内不能打。</div>';
    }
    var mine = canAct(c.id);
    for (var i = 0; i < wars.length; i++) {
      (function (eid) {
        var e = w.countries[eid - 1];
        if (!e) return;
        var score = AO.aoc2.warScore(w, c.id, eid);
        var row = doc.createElement('div');
        row.className = 'aocwar';
        row.innerHTML = '<b>' + e.name + '</b><em>战争分 ' + Math.round(score) + '</em>';
        var terms = [
          { k: 'white', cn: '白和平' },
          { k: 'land', cn: '割地' },
          { k: 'reparations', cn: '赔款' }
        ];
        for (var t = 0; t < terms.length; t++) {
          (function (term) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.textContent = term.cn;
            b.disabled = !mine;
            b.title = term.k === 'white' ? '停战，占着的省还回去'
              : term.k === 'land' ? '割让被占领的省（战争分 100 或对方厌战 ≥70% 才接受）'
                : '索取赔款（战争分 50+）';
            b.addEventListener('click', function () {
              var tr0 = AO.aoc2.transfers || 0;
              var r = AO.aoc2.peace(w, c.id, eid, term.k);
              toast(r.msg, 3600);
              if (r.ok) {
                AO.aoc2.recomputeCountry(w, c);
                showCountry(c.id);
                /* 割地会改归属：路径缓存必须重建，否则地图还画着旧国界 */
                if (state.renderer) {
                  if ((AO.aoc2.transfers || 0) !== tr0 && state.renderer.refreshGeometry) {
                    state.renderer.refreshGeometry();
                  } else {
                    state.renderer.requestDraw();
                  }
                  state.renderer.select(state.renderer.selected);
                }
              }
            });
            row.appendChild(b);
          })(terms[t]);
        }
        box.appendChild(row);
      })(wars[i]);
    }

    /* 邻国：宣战 */
    var tb = $('cWarTargets');
    if (!tb) return;
    tb.innerHTML = '';
    var nbs = (c.neighbors || []).slice();
    if (!nbs.length) { tb.innerHTML = '<div class="hint">没有陆上邻国</div>'; return; }
    for (var k = 0; k < nbs.length; k++) {
      (function (nid) {
        var n = w.countries[nid - 1];
        if (!n || !n.aoc || !n.aoc.alive) return;
        var at = AO.aoc2.atWar(w, c.id, nid);
        var tl = AO.aoc2.truceLeft(w, c.id, nid);
        var row = doc.createElement('div');
        row.className = 'aocwar';
        row.innerHTML = '<b>' + n.name + '</b><em>' + (at ? '交战中' :
          tl > 0 ? '停战 ' + tl + ' 回合' : '关系 ' + AO.aoc2.rel(c, nid)) + '</em>';
        var b = doc.createElement('button');
        b.type = 'button';
        b.textContent = at ? '已交战' : '宣战';
        var why = '';
        if (!mine) why = '不是你的国家';
        else if (at) why = '已经在交战';
        else if (tl > 0) why = '停战期内';
        else if ((w.turn || 1) <= AO.AOC2.WAR_BAN_TURNS) why = '开局 ' + AO.AOC2.WAR_BAN_TURNS + ' 回合内不能宣战';
        else if (c.aoc.dip < AO.AOC2.WAR_DIP_COST) why = '外交点不够';
        b.disabled = !!why;
        b.title = why || ('花 ' + AO.AOC2.WAR_DIP_COST + ' 外交点');
        if (!why) b.addEventListener('click', function () {
          var r = AO.aoc2.declareWar(w, c.id, nid);
          toast(r.msg, 3200);
          if (r.ok) showCountry(c.id);
        });
        row.appendChild(b);
        tb.appendChild(row);
      })(nbs[k]);
    }
  }

  function showInfo(id) {
    var w = state.world;
    if (!id) { clearInfo(); return; }
    var p = w.provinces[id - 1];
    if (!p || !p.aoc) { clearInfo(); return; }

    /* 移动模式：上一次点了「移动」，这一次点的省就是目的地。
     * 放在最前面 —— 点相邻省是"下命令"，不是"查看这个省"。 */
    if (state.moveFrom && state.moveFrom !== id) {
      var srcPid = state.moveFrom;
      state.moveFrom = 0;
      var src = w.provinces[srcPid - 1];
      if (src && src.aoc && src.neighbors.indexOf(id) >= 0) {
        var mvOwner = src.aoc.armyOf || src.owner;
        var mv = AO.aoc2.move(w, mvOwner, srcPid, id, src.aoc.army);
        toast(mv.msg, 3600);
        if (mv.ok) {
          var mc = w.countries[mvOwner - 1];
          if (mc) AO.aoc2.recomputeCountry(w, mc);
          if (state.renderer) state.renderer.requestDraw();
        }
      } else {
        toast('只能移到相邻省', 2400);
      }
    } else if (state.moveFrom === id) {
      state.moveFrom = 0;
    }
    /* 换省份时收起上一省的问号面板；同一省重绘（计时器刷新）则保持展开 */
    if (state.infoId !== id) {
      state.infoId = id;
      state.openKey = null;
      state.selKey = null;
      bldMsg('');
    }
    $('info').classList.add('on');
    $('info').classList.remove('fog-seen', 'fog-unknown');
    $('infoEmpty').style.display = 'none';
    $('infoBody').style.display = '';
    /* 省卡只剩一页：CSS 里 .info-col 只在 .tab-info 下显示（原来靠两个页签切），
     * 页签拆掉之后这里必须把类名钉死，否则整块信息区是空的。 */
    $('infoBody').classList.add('tab-info');
    $('infoBody').classList.remove('tab-bld');
    var snap0 = $('iFogSnap');
    if (snap0) snap0.innerHTML = '';
    applyDetail();

    $('iSw').style.background = p.ownerColor;
    $('iName').textContent = p.name;
    $('iNameEn').textContent = p.name_en;
    var occBy = p.aoc.occupied ? w.countries[p.aoc.occupied - 1] : null;
    $('iOwner').textContent = p.ownerName + ' (#' + p.owner + ')' +
      (occBy ? ' · 被 ' + occBy.name + ' 占领' : '');
    $('iOwner').style.color = occBy ? '#a8523b' : '';

    var tp = AO.aoc2.totalPop(p);
    $('iPop').textContent = AO.formatPop(tp);
    $('iPop').title = Math.round(tp).toLocaleString() + ' 人（本国 ' +
      Math.round(p.aoc.pop[p.owner] || 0).toLocaleString() + '）';
    $('iEcon').textContent = fmtGold(p.aoc.econ) + ' / ' + AO.formatPop(tp);
    $('iEcon').title = '经济 = 岗位：' + fmtGold(p.aoc.econ) + '，人口 ' +
      Math.round(tp).toLocaleString() + '；上限 = 人口';
    $('iDev').textContent = p.aoc.dev.toFixed(2);
    $('iStab').textContent = p.aoc.stab.toFixed(0) + '%';
    $('iHappy').textContent = p.aoc.happy.toFixed(0) + '%';
    $('iGrowth').textContent = (p.aoc.growth * 100).toFixed(2) + '% / 回合';
    /* 国籍构成：人数最多的两三个国籍 + 本国占比（同化程度） */
    var parts = AO.aoc2.popParts(w, p);
    var own = p.aoc.pop[p.owner] || 0;
    var ownPct = tp > 0 ? Math.round(own / tp * 100) : 100;
    var natTxt = '本国 ' + ownPct + '%';
    if (parts.length > 1) {
      var others = [];
      for (var pi = 0; pi < parts.length && others.length < 2; pi++) {
        if (parts[pi].cid === p.owner) continue;
        others.push(parts[pi].name + ' ' + Math.round(parts[pi].n / tp * 100) + '%');
      }
      if (others.length) natTxt += ' · ' + others.join(' · ');
    }
    $('iNat').textContent = natTxt;
    $('iNat').title = parts.map(function (x) {
      return x.name + ' ' + Math.round(x.n).toLocaleString() + ' 人';
    }).join('\n');
    $('iRevolt').textContent = p.aoc.revolt.toFixed(0) + '%';
    $('iRevolt').title = '革命风险（目标值 ' + AO.aoc2.revoltTarget(w, p.id).toFixed(0) +
      '%）：≥' + AO.AOC2.REVOLT_TRIGGER + '% 每回合 ' +
      Math.round(AO.AOC2.REVOLT_CHANCE * 100) + '% 概率举旗';
    $('iRevolt').style.color = p.aoc.revolt >= AO.AOC2.REVOLT_TRIGGER ? '#a8523b' : '';

    $('iCore').textContent = coreText(w, p);
    $('iValue').textContent = p.aoc.value.toFixed(1);

    $('iTerrain').textContent = (AO.TERRAIN_CN[p.terrain] || p.terrain) + ' · ' + p.terrain;
    var wt = waterText(p);
    $('iWater').textContent = wt;
    $('iWater').title = wt;
    $('iArea').textContent = p.area.toLocaleString() + ' px²';
    $('iCentroid').textContent = p.centroid[0].toFixed(1) + ', ' + p.centroid[1].toFixed(1);
    $('iDeg').textContent = p.neighbors.length + ' 个';
    updateDetSum();

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

    renderAocArmy(p);
    renderAocBld(p);
    renderAocDecree(p);

    /* 国家卡开着的时候，点省份也跟着换成该省所属国 */
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

  /* =============================================================
   * 国家卡（AoC2 口径，阶段一）
   *
   * 概览：政体 / 人口 / 经济 / 发展度 / 幸福 / 稳定 / 国库 / 面积 / 首都 / 省份
   * 内政：国库（含上回合收支）+ 四条预算滑条 + 税率滑条 + 点数
   *
   * 滑条为什么"即时生效"而不是等下一回合：规则书第三章 —— 预算滑条是玩家
   * 每回合的手动项，改完立刻按新比例结算。所以滑条只改状态，不弹确认。
   * 合计超过 100% 时从"投资"往回砍（AO.aoc2.setSliders 里那条顺序），
   * 玩家看到的是"推这根，那根自己退"—— 比弹一句"不能超过 100"好用。
   * ============================================================= */
  function sliderRow(label, key, val, max, title, onInput) {
    var row = doc.createElement('div');
    row.className = 'aocslider';
    var lb = doc.createElement('span'); lb.textContent = label;
    var inp = doc.createElement('input');
    inp.type = 'range'; inp.min = '0'; inp.max = String(max); inp.step = '1'; inp.value = String(val);
    inp.title = title || '';
    var vv = doc.createElement('span'); vv.className = 'v'; vv.textContent = val + '%';
    inp.addEventListener('input', function () {
      vv.textContent = this.value + '%';
      onInput(+this.value);
    });
    row.appendChild(lb); row.appendChild(inp); row.appendChild(vv);
    return row;
  }

  function renderAocSliders(c) {
    var box = $('cSliders');
    if (!box) return;
    box.innerHTML = '';
    var sl = c.aoc.sliders;
    var mine = canAct(c.id);
    var lock = function (inp) { if (!mine) inp.disabled = true; };
    var sumRow = doc.createElement('div');
    sumRow.className = 'aocslider sum';
    var updateSum = function () {
      var sum = AO.aoc2.sliderSum(c);
      sumRow.innerHTML = '<span>合计</span><span></span><span class="v">' + sum + '%</span>';
      sumRow.title = sum > 100 ? '超过 100% 的部分会被从"投资"往回砍' : '没分配的部分自动进国库';
    };
    var mk = function (label, key, title) {
      var r = sliderRow(label, key, sl[key], 100, title, function (v) {
        var o = { tax: sl.tax, goods: sl.goods, research: sl.research, invest: sl.invest };
        o[key] = v;
        AO.aoc2.setSliders(c, o);
        /* 归一化可能把别的滑条也压下去 → 整块重画（滑条只有四根，重画很便宜） */
        renderAocSliders(c);
        renderAocTreasury(c);
      });
      lock(r.querySelector('input'));
      return r;
    };
    box.appendChild(mk('税收', 'tax', '直接进国库的比例'));
    box.appendChild(mk('物资', 'goods', '补给人口的消费品；充足 → 幸福高（社区推荐 65%~85%）'));
    box.appendChild(mk('科研', 'research', '转成研究点（阶段四接科技）'));
    box.appendChild(mk('投资', 'invest', '转成投资款（投资敕令用）'));
    updateSum();
    box.appendChild(sumRow);

    var tr = $('cTaxRow');
    if (tr) {
      tr.innerHTML = '';
      var g = AO.aoc2.govOf(c);
      var row = sliderRow('税率', 'taxRate', c.aoc.taxRate, g.taxCap,
        '上限 ' + g.taxCap + '%（' + g.cn + '）；抬税降幸福、压人口增长',
        function (v) {
          AO.aoc2.setTaxRate(c, v);
          renderAocTreasury(c);
        });
      lock(row.querySelector('input'));
      tr.appendChild(row);
      var tip = doc.createElement('div');
      tip.className = 'hint';
      tip.textContent = g.cn + '：税收上限 ' + g.taxCap + '% · 行政费 ' +
        (g.admin >= 0 ? '+' : '') + g.admin + '% · 研究成本 +' + g.research + '%';
      tr.appendChild(tip);
    }
  }

  function renderAocTreasury(c) {
    var box = $('cTreasury');
    if (!box) return;
    var L = c.aoc.last;
    var html = '<div class="kv"><span>国库</span><span>' + fmtGold(c.aoc.treasury) + ' 金</span></div>' +
      '<div class="kv"><span>贷款</span><span>' + fmtGold(c.aoc.loans) + ' 金' +
      (c.aoc.loans > 0 ? '（利息 ' + fmtGold(c.aoc.loans * AO.AOC2.LOAN_RATE) + '/回合）' : '') +
      '</span></div>';
    if (L) {
      html += '<div class="kv"><span>毛收入</span><span>' + fmtGold(L.gross) + '</span></div>' +
        '<div class="kv"><span>入库</span><span>' + fmtGold(L.taxIn) + '</span></div>' +
        '<div class="kv"><span>行政费</span><span>−' + fmtGold(L.admin) + '</span></div>' +
        '<div class="kv"><span>军费</span><span>−' + fmtGold(L.upkeep) + '</span></div>' +
        '<div class="kv"><span>利息</span><span>−' + fmtGold(L.interest) + '</span></div>' +
        '<div class="kv"><span>净额</span><span><b>' + (L.net >= 0 ? '+' : '') + fmtGold(L.net) +
        '</b> / 回合</span></div>';
    } else {
      html += '<div class="hint">还没结算过：点「下一回合」看第一笔账</div>';
    }
    box.innerHTML = html;
    var shortEl = $('cTreasuryShort');
    if (shortEl) shortEl.textContent = fmtGold(c.aoc.treasury) + ' 金';
  }

  function showCountry(cid) {
    var w = state.world;
    var c = w && w.countries[cid - 1];
    if (!c || !c.aoc) { clearCountry(); return; }
    $('country').classList.add('on');
    applyCountryTab();

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

    var g = AO.aoc2.govOf(c);
    $('cGov').textContent = g.cn;
    $('cPop').textContent = AO.formatPop(c.aoc.pop) + '（' + c.provinces.length + ' 省）';
    $('cEcon').textContent = fmtGold(c.aoc.econ);
    $('cDev').textContent = c.aoc.dev.toFixed(2);
    $('cHappy').textContent = c.aoc.happy.toFixed(0) + '%';
    $('cStab').textContent = c.aoc.stab.toFixed(0) + '%';
    var maxR = 0, hotN = 0;
    for (var ri = 0; ri < c.provinces.length; ri++) {
      var rq = w.provinces[c.provinces[ri] - 1];
      if (!rq || !rq.aoc) continue;
      if (rq.aoc.revolt > maxR) maxR = rq.aoc.revolt;
      if (rq.aoc.revolt >= AO.AOC2.REVOLT_TRIGGER) hotN++;
    }
    var rvEl = $('cRevolt');
    if (rvEl) {
      rvEl.textContent = maxR.toFixed(0) + '%' + (hotN ? '（' + hotN + ' 省随时举旗）' : '');
      rvEl.style.color = hotN ? '#a8523b' : '';
    }
    $('cArea').textContent = c.areaKm2.toLocaleString() + ' km²';
    var cap = w.provinces[c.capital - 1];
    $('cCapital').textContent = cap ? cap.name : '—';
    $('cProv').textContent = c.provinces.length + ' 个';

    var bar = $('cBar'), leg = $('cLegend');
    if (bar && leg) {
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
    }

    var nb = $('cNeighbors');
    if (nb) {
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
    }

    renderAocTreasury(c);
    renderAocSliders(c);
    renderAocGov(c);
    renderAocTech(c);
    renderAocBldSum(c);
    renderAocWar(c);
    $('cMP').textContent = c.aoc.mp + ' / ' + c.aoc.mpMax;
    $('cDIP').textContent = c.aoc.dip + ' / ' + c.aoc.dipMax;
    var rp = c.aoc.rp || 0;
    $('cRP').textContent = rp.toFixed(1) + '（' + Math.floor(rp % 100) + '/100）';
    $('cIP').textContent = fmtGold(c.aoc.investPool) + ' 金';
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





  /* 这一省能不能驻匠：得有（建成的）军械坊 / 驯马场 / 造船厂 */
  function artisanSpot(pid) {
    for (var i = 0; i < MILL_KINDS.length; i++) {
      var st = UNIV[MILL_KINDS[i]][pid | 0];
      if (st && st.n > 0) return MILL_KINDS[i];
    }
    return null;
  }




  /* 本省军工产能的乘数：有一座**不停产**的工厂就 ×2，否则 ×1。
   * 抽成函数是为了「结算的实际产能」和「面板上写的 ×2」读同一个数。 */
  function armProdMul(pid) {
    var fb = FACTORY_BLD[pid];
    return (fb && fb.n > 0 && !fb.halted) ? (AO.FACTORY.factory.prodMul || 2) : 1;
  }


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


  /* 一国当前的装备材质（按工艺链爬到哪一档） */
  function matOf(owner) {
    var M = AO.EQUIP.mat, idx = 0;
    for (var i = 0; i < M.length; i++) {
      if (!M[i].tech || hasTech(owner, M[i].tech)) idx = i;
    }
    return M[idx];
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



  /* a.arms 是给战报 / 面板读的派生字段，和 unitKindOf 永远同源 */
  function syncArms(a) {
    if (!a) return;
    a.arms = unitKindOf(a);
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
    /* 国家工程（学校/市场/粮仓/兵营/大学/工厂）→ nat 那条账：中央出 */
    var r = payBuild(p, D.cost, silent, true);
    if (!r.ok) {
      return say('资源不够：' + cnOf(r.lack) + ' 还差 ' + r.need + '（本省 → 中央 → 同国各省都没凑齐）', 'warn');
    }
    st.site = effectiveTurns(p.id, p.owner, D.turnsAt());
    say(D.cn + '开工：' + costText(D.cost) + '，' + st.site + ' 回合后完工（' + D.desc + '）', 'ok');
  }





  function milPoolOf(owner) {
    var T = talentOf(owner);
    if (!T.milPool) T.milPool = [];
    return T.milPool;
  }



  function generalOf(a) { return (a && a.generalId && GENERALS[a.generalId]) || null; }

  function genTrait(g) { return g ? AO.milTraitOf(g.traitKey) : null; }



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


  function recruit(pid, arms, tierKey) {
    var p = pOf(pid);
    if (!p) return { ok: false, msg: '没有这个省' };
    if (!canAct(p.owner)) return { ok: false, msg: lockTitle() };
    var info = recruitInfo(pid, 'inf', tierKey);
    if (!info.ok) return { ok: false, msg: info.why };
    var R = AO.RECRUIT, need = info.need;

    /* 扣金：**先中央、再省库**（v19.2 的分工，和建造同一条家法）：
     * 养兵是国家的钱，省库那点铁金留给下一回合的维修费。
     * 老口径反过来（省库先掏），穷省征一次兵就把维护钱花光，房子跟着失修。 */
    var cen0 = ensureCentral(p.owner), left = need.gold;
    var tc0 = Math.min(cen0.gold || 0, left);
    cen0.gold = (cen0.gold || 0) - tc0; left -= tc0;
    if (left > 0) {
      var g = SIM[pid].gold;
      var t1 = Math.min(g.stock, left);
      g.stock -= t1; left -= t1;
    }
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



  /* 海路：沿海省两两质心距离 < D 视为通航（**没有独立海图**）。
   * 世界级缓存 —— 500 个沿海省两两比一次就够，之后每回合只查表。 */
  var SEA = { w: null, map: null };









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
     * 傀儡并入时留任 —— 它本来就是你的地，官不用重新派。
     * v19.4：清官的同时记一笔 CONQ —— 这些省**从此只认真官**，补吏的兜底不给它们。
     * 口径是用户定的："占领省不给吏，打下来的省必须派真官"。 */
    if (!opt.keepOfficials) {
      for (i = 0; i < list.length; i++) {
        delete OFFICIAL[list[i]];
        CONQ[list[i]] = turnNo;
      }
    }
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

  /* 迷雾三档是阶段五的事。这一阶段先整层关掉：否则选了国之后省卡会走
   * "旧情报"分支（showFogInfo），而新卡没有那一套字段。 */
  function fogOn() { return false; }
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





  /* ---------------- 二、条约（同盟 / 互不侵犯） ---------------- */
  function isAlly(a, b) { return !!(a && b && a !== b && ALLIES[warKey(a, b)]); }
  function isNap(a, b) { return !!(a && b && a !== b && NAPS[warKey(a, b)]); }
  function pactOf(a, b) { return isAlly(a, b) ? 'ally' : isNap(a, b) ? 'nap' : ''; }
  function pactCn(kind) { return kind === 'ally' ? '同盟' : kind === 'nap' ? '互不侵犯' : '无'; }
  /* 缔约冷却的键：**带 kind**。同盟被拒不该把互不侵犯也一起锁住 ——
   * 那是两件事（"不想跟你结盟"不等于"不想跟你互不侵犯"）。 */
  function cdKey(a, b, kind) { return warKey(a, b) + '|' + kind; }



  function nameOf(cid) { var c = coOf(cid | 0); return c ? c.name : '?'; }



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


  function closeTalk() {
    TALK.open = false; TALK.to = 0;
    var el = $('talkModal');
    if (el) el.classList.remove('on');
  }










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






























  /* 地图注记（14-labels.js）用：傀儡国名后面挂一个"（臣）"。
   * 用函数而不是直接读表，是因为 14-labels 在 Node 自检里也会被单独加载 ——
   * 那种场合没有 11-ui，读表会炸。 */
  AO.puppetTagOf = function (cid) { return suzerainOf(cid) ? '（臣）' : ''; };



  /* ---------------- 预算档 ---------------- */
  function budgetOf(owner) {
    var b = INTELB[owner];
    return (b === 1 || b === 2) ? b : 0;
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

  function lastSeenOf(pid) {
    if (!PLAYER) return null;
    return LASTSEEN[PLAYER + '|' + (pid | 0)] || null;
  }

  /* 泛黄档：0 微黄 / 1 中黄 / 2 深黄 */
  function staleBucket(pid) {
    var n = staleOf(pid);
    return n < FOG.staleMid ? 0 : n < FOG.staleOld ? 1 : 2;
  }


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




  /* ---------------- AI 的情报活动（运行时，不进存档） ----------------
   * AI 也花同样的钱、有同样的预算档；差别只在"玩家看得见结果，AI 的认知只影响它自己"。
   * v1 的 AI 决策不看迷雾，但"玩家反谍重金能抓到 AI 密探"这条必须真的能触发 ——
   * 所以这里照样掷暴露概率，被抓就双方纪要 + REL −15。 */
  var AI_PROBE_T = Object.create(null);




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



  /* 给 10-render.js / 14-labels.js 的钩子。渲染层不认识 PLAYER / 情报署，
   * 只认这四个函数 —— 所以换世界时把 fogOn 一拍两散即可。 */
  AO.fogOn = fogOn;
  AO.fogVersion = function () { return FOGVER; };
  AO.fogPlayer = function () { return PLAYER; };
  AO.fogVis = visCode;


  AO.fogStaleBucket = staleBucket;

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





  /* ---------------- 存档 / 读档（手动，绝不自动读） ----------------
   * 为什么手动：index.html 兼职"世界工坊"，自动读档会把工坊劫持成
   * "永远继续上局" —— 想换个种子看新世界都做不到。
   * 存的是**状态**，不是地图：世界由 seed + 三个滑杆重新生成，
   * 所以读回来的世界和存的那一刻完全一致（1100 省约 1.8 MB，别的地方省不了 ——
   * 每省七种资源各有库存/储量/工地/维护零头，压缩不了多少）。
   * FLOW / FLOWC 不存：那是"上一回合"的流水，读回来应该从零开始。 */
  var SAVE_KEY = AO.SAVE_KEY || 'sj.save';
  var SAVE_KEY_V1 = AO.SAVE_KEY_V1 || 'sj.save.v1';
  var SAVE_VER = (AO.AOC2 && AO.AOC2.SAVE_VER) || 7;

  /* file:// 下有些浏览器会禁 localStorage。探一次，禁了就把两个钮置灰。 */
  function lsOK() {
    try {
      localStorage.setItem('sj.__probe', '1');
      localStorage.removeItem('sj.__probe');
      return true;
    } catch (e) { return false; }
  }




  /* =============================================================
   * 存档（v7）
   *
   * 换血 = 升版。旧档里的 SIM / CENTRAL / OFFICIAL / ARMY 在新模型里没有对应物，
   * 迁移它们只会把玩家送进一个两套账都算不清的世界 —— 所以 v6 及以下直接拒读，
   * 并告诉他去哪儿找旧版（legacy-v19）。这条判断在 15-aoc2 的
   * checkSaveVersion 里，UI 和测试共用同一句话。
   *
   * 存什么：seed + 滑杆（重建同一个世界）+ 回合数 + AO.aoc2.save 的那两张表。
   * 不存地图（地图由 seed 重建，这是这套引擎一贯的做法）。
   * ============================================================= */
  function saveGame(silent) {
    if (!state.world) { if (!silent) toast('还没有世界可以存', 2200); return; }
    var payload = {
      v: SAVE_VER,
      seed: $('seed').value,
      opt: { prov: +$('prov').value, ctry: +$('ctry').value, land: +$('land').value, size: state.size },
      turnNo: turnNo,
      player: PLAYER,
      aoc2: AO.aoc2.save(state.world),
      /* 编年史是平台层（不随规则退役）：年表 / 定稿快照 / 称号随档走 */
      CHRONO: AO.chronoState ? AO.chronoState() : null
    };
    var text;
    try { text = JSON.stringify(payload); }
    catch (e) { return toast('存档序列化失败：' + e.message, 3200); }
    try {
      localStorage.setItem(SAVE_KEY, text);
      if (!silent) toast('已存档（v' + SAVE_VER + '，' + Math.round(text.length / 1024) + ' KB）', 2200);
    } catch (e) {
      toast('存档写不进去：' + (e && e.name === 'QuotaExceededError' ? 'localStorage 配额满了' : e.message), 3400);
    }
  }

  /* 读档：世界按 seed 重建，然后把 AoC2 那两张表灌回去 */
  function applySave(d, keepPid, keepCid) {
    if (!d || !d.aoc2 || !state.world) return;
    AO.aoc2.load(state.world, d.aoc2);
    if (AO.chronoLoad) AO.chronoLoad(d.CHRONO);
    turnNo = d.turnNo || 1;
    PLAYER = d.player | 0;
    updateTurnLabel();
    refreshLocks();
    if (keepPid) { state.renderer.select(keepPid); showInfo(keepPid); }
    if (keepCid && $('country').classList.contains('on')) showCountry(keepCid);
    toast('读档完成：第 ' + turnNo + ' 回合', 2200);
  }

  function loadGame() {
    var raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      if (!raw) raw = localStorage.getItem(SAVE_KEY_V1);
    }
    catch (e) { return toast('这个环境不允许读 localStorage（file:// 被禁），读不了存档', 3400); }
    if (!raw) return toast('还没有存档 —— 先点「存档」', 2600);
    var d = null;
    try { d = JSON.parse(raw); }
    catch (e) { return toast('存档损坏，读不出来', 3200); }

    var chk = AO.aoc2.checkSaveVersion(d && d.v);
    if (!chk.ok) return toast(chk.msg, 4200);

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










  /* =============================================================
   * 探针 / 测试入口（阶段三起只剩这一份）
   *
   * 旧的那 460 行 debug API（抽官 / 派官 / 建坊 / 科研 / 迷雾 / 情报 / 军队）
   * 全跟着退役的模块一起删了 —— 探针只该有一条稳定的入口，
   * 而不是把内部表整张端出去（那样每个模块退役都要回来改一遍这里）。
   * ============================================================= */
  AO.resDebug = {
    /* AoC2：探针从这里进 —— 连跑 n 回合不刷 UI */
    aoc2: {
      turn: function (n) {
        n = n | 0 || 1;
        for (var i = 0; i < n; i++) settleTurn();
        updateTurnLabel();
        return AO.aoc2.summary(state.world);
      },
      summary: function () { return state.world ? AO.aoc2.summary(state.world) : []; },
      world: function () { return state.world; },
      cfg: function () { return AO.AOC2; }
    },
    world: function () { return state.world; },
    turn: function () { return turnNo; },
    player: function () { return PLAYER; },
    notes: function () { return NOTES; },
    log: function () { return WARLOG; },
    nextTurn: nextTurn,
    save: saveGame,
    load: loadGame,
    choosePlayer: choosePlayer,
    /* 直接把一个省划给某国（编年史的"亡国"用例靠它） */
    occupy: function (pid, cid) {
      if (!state.world) return;
      AO.aoc2.transferProvince(state.world, pid, cid);
      /* 改完归属要顺手判一次"统一 / 亡国"（旧 paint 也是这么做的） */
      if (AO.chronoCheck) AO.chronoCheck();
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
    /* 省卡的「信息 / 建筑」两个入口随建筑一起退役（阶段一）：
     * 现在省卡只有一页（人口 / 经济 / 发展度 / 稳定 / 幸福 / 增长 + 三条敕令）。 */
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
    /* 科技 / 治理 / 军务 / 经营 / 产能 / 武库六个入口已随各自模块退役。
     * 阶段四（庙堂）会把科技与外交装回来 —— 到时候按新规则重写，不是把旧代码搬回来。 */

    /* ---- 战争层（v3）的三个入口 ----
     * 开始游戏（选国）/ 军务 / 退出游戏。
     * 「军务」和「治理」是同一块 overlay 的两个页签，所以这里只是切页。 */
    var pb = $('playBtn');
    if (pb) pb.addEventListener('click', function () {
      if (PLAYER) exitGame();
      else openPickPanel();
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
    /* 治理面板已退役：省卡上的"民心/官员"不再往那儿跳（阶段一） */
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
      /* 编年史现在直接读 AoC2 的省/国字段（17-chrono 的 dataOf），
       * 这里只留平台级的东西：世界 / 回合 / 种子 / 纪要 / 战报 */
      country: coOf,
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




  function boot() {
    bind();
    /* 抽屉的初始位（v16）：这四个只读 localStorage，跨刷新记得住玩家上次怎么摆的 */
    applyDetail();
    applyGroups();
    applyCountryTab();
    updateTurnLabel();
    chronoBoot();                      // 编年史层拿内部件（必须在第一次 generate 之前）
    var savedOpen = null;
    try { savedOpen = localStorage.getItem('sj.panelOpen'); } catch (e) { /* 忽略 */ }
    setPanel(savedOpen === '1');       // 没记录过 → 默认收起
    generate();
    refreshLocks();                    // 顶栏那颗「开始游戏 / 退出游戏」的文字
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
