/* =============================================================
 * 14-labels.js —— 地图注记（文字标注）
 *
 * 分两件事：
 *   AO.computeLabels(world, view, opt)  选出该画哪些注记、放在哪、多大
 *   AO.labelTier(scale)                 缩放分级（越近标得越细）
 *
 * 为什么分两步：computeLabels 只吃"世界 + 视图 + 相机"，跟画布无关，
 * 所以 Node 里也能跑、能单独测；绘制（描边光晕 + 填充）在 10-render.js。
 *
 * 三条制图学原则写在这里：
 *   1) **选取**比"全画出来"重要。1100 个省名同时画就是一张噪点图，
 *      所以按缩放分级，放不下的直接丢掉，而不是缩小字号硬塞。
 *   2) 面积越大的要素越值得标 —— 排序权重用面积，碰撞时大国先占位。
 *   3) 注记点必须落在陆地上：国家名不取"几何质心"（可能在海湾里），
 *      而是取离它最近的那个省的质心。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  var FONT = '-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
  AO.LABEL_FONT = FONT;

  /* 文字色一律深灰（不用纯黑，纯黑在深色块上像挖洞），
   * 描边用暖白 —— 和地图纸色同一支，压在深色国家/海洋上都读得出来。 */
  var INK_COUNTRY = 'rgba(26,32,38,0.95)';
  var INK_CAPITAL = 'rgba(34,42,50,0.92)';
  var INK_PROV = 'rgba(40,48,56,0.86)';
  var INK_SUB = 'rgba(44,52,60,0.66)';
  AO.LABEL_HALO = 'rgba(250,247,240,0.9)';

  /* ---------------- 缩放分级 ----------------
   * countryFrac: 只标面积前这一比例的国家（1 = 全标）
   * capital    : 是否标首都
   * provFrac   : 省名只标面积前这一比例（0 = 不标）
   * provAll    : 是否补上"当前视野内的所有省"（近景才这么干）
   * provNb     : 是否补上首都所在省的邻省
   * sub        : 是否带英文副标 */
  /* 字号也跟缩放档走：世界视图上 22px 的国名会占掉小半个国家、还会互相顶掉，
   * 所以远景用 11~17，越近才越敢放到 22。省名同理（9~13）。
   * 全局仍然封在"国名 11~22 / 省名 9~13"这两条线里。 */
  var TIERS = [
    { max: 0.80, countryFrac: 0.40, capital: false, provFrac: 0,    provAll: false, provNb: false,
      cLo: 11, cHi: 17,   pLo: 9,   pHi: 11.5, subCountry: true,  subCapital: false, subProv: false },
    { max: 1.60, countryFrac: 1,    capital: true,  provFrac: 0,    provAll: false, provNb: false,
      cLo: 11, cHi: 19,   pLo: 9,   pHi: 12,   subCountry: true,  subCapital: true,  subProv: false },
    { max: 3.50, countryFrac: 1,    capital: true,  provFrac: 0.25, provAll: false, provNb: false,
      cLo: 12, cHi: 21,   pLo: 9.5, pHi: 12.5, subCountry: true,  subCapital: true,  subProv: false },
    { max: Infinity, countryFrac: 1, capital: true, provFrac: 0.25, provAll: true,  provNb: true,
      cLo: 13, cHi: 22,   pLo: 10,  pHi: 13,   subCountry: true,  subCapital: true,  subProv: true }
  ];
  AO.LABEL_TIERS = TIERS;

  AO.labelTier = function (scale) {
    for (var i = 0; i < TIERS.length; i++) if (scale < TIERS[i].max) return i;
    return TIERS.length - 1;
  };

  /* ---------------- 尺寸 ----------------
   * 字号 ∝ sqrt(面积)：面积差 10 倍 → 字号只差 3.2 倍，不会出现
   * "巨国占满屏幕、小国看不见"。上下限卡死，保证任何缩放都能读。 */
  function sizeFor(area, maxArea, lo, hi) {
    var t = maxArea > 0 ? Math.sqrt(area / maxArea) : 1;
    return Math.round((lo + (hi - lo) * AO.clamp(t, 0, 1)) * 10) / 10;
  }

  /* 没有 ctx 时的宽度估算（Node 里跑测试用）：CJK 按 1em、其余按 0.55em */
  function estimateWidth(text, size) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += text.charCodeAt(i) > 0x2e80 ? size : size * 0.55;
    }
    return w;
  }
  AO.estimateLabelWidth = estimateWidth;

  /* ---------------- 主函数 ---------------- */
  /* @param world  世界对象
   * @param view   'political' | 'terrain' | 'faith'
   * @param opt    { scale, width, height, cx, cy, pad, measure }
   * @return [{ kind, id, text, sub, x, y, size, weight, color, w, h, sym }]
   *         x/y 是世界坐标；w/h 是屏幕像素（碰撞与绘制都用它）。 */
  AO.computeLabels = function (world, view, opt) {
    opt = opt || {};
    if (!world || !world.countries) return [];
    var scale = opt.scale || 1;
    var cw = opt.width || 1440, ch = opt.height || 900;
    var cx = opt.cx === undefined ? world.meta.width / 2 : opt.cx;
    var cy = opt.cy === undefined ? world.meta.height / 2 : opt.cy;
    var pad = opt.pad === undefined ? 220 : opt.pad;
    var measure = opt.measure || function (t, sz) { return estimateWidth(t, sz); };
    var tier = TIERS[AO.labelTier(scale)];
    var isFaith = view === 'faith';
    var halfW = cw / 2, halfH = ch / 2;
    var i, j, k, p, c, item;

    /* 视口范围先算成世界坐标，后面按它剔除 —— 
     * 碰撞是按"世界距离 × scale"算的，所以平移不会改变结果，缓存才站得住。 */
    var vx0 = cx - halfW / scale - pad / scale;
    var vx1 = cx + halfW / scale + pad / scale;
    var vy0 = cy - halfH / scale - pad / scale;
    var vy1 = cy + halfH / scale + pad / scale;
    function inView(x, y) { return x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1; }

    var raws = [];

    /* ---------- 1. 国家名 ---------- */
    var countries = world.countries.filter(function (cc) { return cc && cc.area > 0; });
    countries.sort(function (a, b) { return b.area - a.area; });
    var cMax = countries.length ? countries[0].area : 1;
    var cKeep = Math.max(1, Math.ceil(countries.length * tier.countryFrac));

    /* 首都 → 所属国家，一次建表，省得每个省都去线性找 */
    var capitalOf = {};
    for (i = 0; i < world.countries.length; i++) {
      c = world.countries[i];
      if (c && c.capital) capitalOf[c.capital] = c;
    }

    for (i = 0; i < countries.length; i++) {
      c = countries[i];
      if (i >= cKeep) continue;
      /* 战争迷雾（v6）：一个国家**一省未探** → 国名不出现。
       * 探过一省 = "听说过这个国家"，国名才配写在地图上。 */
      if (opt.countryKnown && !opt.countryKnown(c.id)) continue;
      var pt = labelPoint(world, c);
      if (!pt || !inView(pt.x, pt.y)) continue;
      /* 代表点落在没测绘的地方：地图上还是羊皮纸，名字无从落笔 */
      if (opt.vis && opt.vis(pt.id) === 0) continue;
      var size = sizeFor(c.area, cMax, tier.cLo, tier.cHi);
      /* 傀儡国（v13）：国名后面挂"（臣）"。用函数探一下而不是直接读表 ——
       * 这个文件在 Node 自检里会被单独加载（那会儿没有 11-ui，没有那张表）。 */
      var pvTag = (typeof AO.puppetTagOf === 'function') ? AO.puppetTagOf(c.id) : '';
      item = {
        kind: 'country', id: c.id, pid: pt.id, text: c.name + pvTag,
        sub: tier.subCountry ? c.name_en : '',
        x: pt.x, y: pt.y, size: size, subSize: size - 1.5, weight: 700,
        color: INK_COUNTRY, priority: c.area * 4
      };
      if (isFaith && c.faith && c.faith.sym) item.sym = c.faith.sym;
      raws.push(item);
    }

    /* ---------- 2. 首都 ---------- */
    if (tier.capital) {
      for (i = 0; i < world.countries.length; i++) {
        c = world.countries[i];
        if (!c || !c.capital) continue;
        p = world.provinces[c.capital - 1];
        if (!p || p.owner !== c.id) continue;          // 首都被涂到别国去了就跳过
        if (opt.vis && opt.vis(p.id) === 0) continue;   // 迷雾：没探过就不标
        var cpt = snapToLand(world, p.centroid[0], p.centroid[1]);
        if (!cpt || !inView(cpt.x, cpt.y)) continue;
        var csz = AO.clamp(sizeFor(c.area, cMax, tier.cLo, tier.cHi) * 0.72, 9, 13.5);
        item = {
          kind: 'capital', id: p.id, text: p.name,
          sub: tier.subCapital && csz >= 10 ? p.name_en : '',
          x: cpt.x, y: cpt.y, size: csz, subSize: csz - 1,
          weight: 600, color: INK_CAPITAL, priority: c.area * 2
        };
        raws.push(item);
      }
    }

    /* ---------- 3. 省名 ---------- */
    var provs = world.provinces, PN = provs.length;
    var rank = provRank(world);
    var pMax = rank.pMax;

    var provSet = tier.provFrac > 0 ? topSet(rank, tier.provFrac) : new Set();

    /* 首都所在省的邻省：近景时把这一圈名字补上，方便对照 */
    if (tier.provNb) {
      for (i = 0; i < world.countries.length; i++) {
        c = world.countries[i];
        if (!c || !c.capital) continue;
        p = world.provinces[c.capital - 1];
        if (!p) continue;
        for (k = 0; k < p.neighbors.length; k++) provSet.add(p.neighbors[k]);
      }
    }

    var provSizeMax = (tier.provAll || tier.provNb) ? tier.pHi : tier.pLo + (tier.pHi - tier.pLo) * 0.7;
    for (i = 0; i < PN; i++) {
      p = provs[i];
      if (!p || !p.area) continue;
      var want = provSet.has(p.id);
      // 近景（>3.5）：视野内的省全部标，靠碰撞去淘汰，读起来才像一张详图
      if (!want && tier.provAll && inView(p.centroid[0], p.centroid[1])) want = 1;
      if (!want) continue;
      if (!inView(p.centroid[0], p.centroid[1])) continue;
      /* 迷雾：没测绘过的省不写名（写了就等于免费送地图） */
      if (opt.vis && opt.vis(p.id) === 0) continue;
      var sp = snapToLand(world, p.centroid[0], p.centroid[1]);
      if (!sp) continue;
      var psz = sizeFor(p.area, pMax, tier.pLo, provSizeMax);
      item = {
        kind: 'province', id: p.id, text: p.name,
        sub: tier.subProv ? p.name_en : '',
        x: sp.x, y: sp.y, size: psz, subSize: psz - 1,
        weight: 500, color: INK_PROV, priority: p.area
      };
      raws.push(item);
    }

    /* ---------- 4. 量宽高（只量一次，绘制时直接用） ---------- */
    for (i = 0; i < raws.length; i++) {
      item = raws[i];
      var tw = measure(item.text, item.size, item.weight, false);
      var sw = item.sub ? measure(item.sub, item.subSize, 400, true) : 0;
      item.icon = item.sym ? Math.round(item.size * 0.9) : 0;
      item.tw = Math.ceil(Math.max(tw, sw));
      item.w = item.tw + item.icon + (item.icon ? 4 : 0);
      item.h = Math.ceil(item.size + (item.sub ? item.subSize + 2.5 : 0));
      item.textW = Math.ceil(tw);
    }

    /* 首都注记要躲开自己的五角星：整块往下挪半个高度 + 星半径 */
    for (i = 0; i < raws.length; i++) {
      if (raws[i].kind !== 'capital') continue;
      raws[i].y += (raws[i].h / 2 + 4) / scale;
    }

    /* 同一个省既是国家的"代表点"又是首都时，把首都名再往下推，避免和国名叠住 */
    for (i = 0; i < raws.length; i++) {
      item = raws[i];
      if (item.kind !== 'capital') continue;
      for (j = 0; j < raws.length; j++) {
        var cb = raws[j];
        if (cb.kind !== 'country' || cb.pid !== item.id) continue;
        item.y = cb.y + (cb.h / 2 + item.h / 2 + 4) / scale;
        break;
      }
    }

    /* ---------- 5. 碰撞避让（网格哈希，格子 24px） ----------
     * 先按权重从大到小排，占到的格子被标记，后面的放不下就丢弃。
     * 这就是地图学的"选取"：宁可不标，也不能叠字。 */
    raws.sort(function (a, b) { return b.priority - a.priority; });
    var CELL = 24;
    var grid = new Set();
    var placed = [];
    for (i = 0; i < raws.length; i++) {
      item = raws[i];
      var sx = (item.x - cx) * scale + halfW;
      var sy = (item.y - cy) * scale + halfH;
      var x0 = sx - item.w / 2 - 2, x1 = sx + item.w / 2 + 2;
      var y0 = sy - item.h / 2 - 1, y1 = sy + item.h / 2 + 1;
      var gx0 = Math.floor(x0 / CELL), gx1 = Math.floor(x1 / CELL);
      var gy0 = Math.floor(y0 / CELL), gy1 = Math.floor(y1 / CELL);
      var hit = false;
      for (var gx = gx0; gx <= gx1 && !hit; gx++) {
        for (var gy = gy0; gy <= gy1; gy++) {
          if (grid.has(gx * 8192 + gy)) { hit = true; break; }
        }
      }
      if (hit) continue;
      for (gx = gx0; gx <= gx1; gx++) for (gy = gy0; gy <= gy1; gy++) grid.add(gx * 8192 + gy);
      item.px = sx; item.py = sy;     // 记录算碰撞时的屏幕位置，绘制时用来判是否出屏
      placed.push(item);
    }

    /* 画的时候从"小到大"画，大国的名字压在上面更稳 */
    placed.sort(function (a, b) { return a.priority - b.priority; });
    return placed;
  };

  /* 省的面积排名只跟世界数据有关（涂色不改省面积），算一次挂在 world 上。
   * 1100 个省排一次 ~0.3ms，每帧重算就白白吃掉预算的一大块。 */
  function provRank(world) {
    var c = world._lblRank;
    if (c && c.n === world.provinces.length) return c;
    var arr = [], pMax = 0, i, p;
    for (i = 0; i < world.provinces.length; i++) {
      p = world.provinces[i];
      if (!p || !(p.area > 0)) continue;
      arr.push(p);
      if (p.area > pMax) pMax = p.area;
    }
    arr.sort(function (a, b) { return b.area - a.area; });
    c = { n: world.provinces.length, pMax: pMax, sorted: arr, sets: {} };
    world._lblRank = c;
    return c;
  }

  /* 前 frac 比例（按面积）的 id 集合，同样按比例缓存 */
  function topSet(rank, frac) {
    var key = frac;
    if (rank.sets[key]) return rank.sets[key];
    var keep = Math.max(1, Math.ceil(rank.sorted.length * frac));
    var s = new Set();
    for (var i = 0; i < keep; i++) s.add(rank.sorted[i].id);
    rank.sets[key] = s;
    return s;
  }

  function snapToLand(world, x, y) {
    var W = world.meta.width, H = world.meta.height;
    var xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    if (world.labels[yi * W + xi]) return { x: x, y: y };
    for (var r = 1; r <= 14; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if ((dx > -r && dx < r) && (dy > -r && dy < r)) continue;
          var nx = xi + dx, ny = yi + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (world.labels[ny * W + nx]) return { x: nx + 0.5, y: ny + 0.5 };
        }
      }
    }
    return null;
  }
  AO.snapToLand = snapToLand;

  /* 国家的注记点：面积加权质心最近的那个省的质心。
   * 直接用几何质心的话，遇到环形国家会落到海里去。 */
  function labelPoint(world, c) {
    var sx = 0, sy = 0, sa = 0, i, p;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || !p.area) continue;
      sx += p.centroid[0] * p.area;
      sy += p.centroid[1] * p.area;
      sa += p.area;
    }
    if (!sa) return null;
    var gx = sx / sa, gy = sy / sa;
    var best = null, bd = Infinity;
    for (i = 0; i < c.provinces.length; i++) {
      p = world.provinces[c.provinces[i] - 1];
      if (!p || !p.area) continue;
      var dx = p.centroid[0] - gx, dy = p.centroid[1] - gy;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    var sp = snapToLand(world, best.centroid[0], best.centroid[1]);
    return sp ? { x: sp.x, y: sp.y, id: best.id } : null;
  }

  /* ---------------- 信仰小图标 ----------------
   * FAITHS[].sym 是 24×24 的 SVG 片段，里面用 currentColor 描边；
   * 包一层带 color/fill 的 <svg> 再转 data URI，就能当图片贴到 canvas 上。 */
  var iconCache = {};
  AO.faithIcon = function (sym) {
    if (!sym || typeof root.document === 'undefined') return null;
    if (iconCache[sym]) return iconCache[sym];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ' +
      'fill="rgba(26,32,38,0.95)" style="color:rgba(26,32,38,0.95)">' + sym + '</svg>';
    var img = new root.Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    iconCache[sym] = img;
    return img;
  };

})(typeof window !== 'undefined' ? window : globalThis);
