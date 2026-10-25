/* =============================================================
 * 10-render.js —— Canvas 渲染 + 平移/缩放/悬停/选中/涂色
 *
 * 复刻《文明时代2》观感的三条硬规则：
 *   1) 每个省一块平涂色，无渐变、无阴影（fillStyle 纯色 + 一次性 fill）
 *   2) 省界是细而锐利的深炭灰线
 *   3) **同一国家的相邻省之间一根线都不画**，整国用一个 Path2D 一次填完，
 *      这样连抗锯齿的接缝都不会出现 —— 整块就是一个纯色形状
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* 海洋四级色阶：深海 → 大陆架浅水。
   * 全部是纯色平涂（不用渐变），靠"沿海岸的等高带"读出深度，
   * 这样既有海的感觉，又保持矢量地图那种硬边风格。 */
  var OCEAN = '#3d6883';        // 深海
  var OCEAN_MID = '#46728d';    // 大陆架外缘
  var OCEAN_LIGHT = '#507d98';  // 大陆架
  var OCEAN_SHORE = '#5c8aa4';  // 近岸浅滩
  var COAST = '#2b3238';
  var RIVER = '#356a93';
  var RIVER_STRONG = '#26567d';
  /* 地形视图的高程配色：低地 → 平原 → 丘陵 → 山地 → 高山。
   * 由 AO.buildTerrainRamp() 按 HSL 生成（绿→黄→褐→灰白），
   * 和国旗、信仰色是同一套模型，但色相单调走一趟，所以一眼就能看出
   * "这是高程带"而不是"这是哪个国家"。 */
  var TERRAIN_COLORS = AO.buildTerrainRamp();
  var BORDER = '#3a4249';
  var SELECT = '#ffd257';
  var HOVER_FILL = 'rgba(255,255,255,0.22)';
  var Unowned = '#8e9384';
  /* 资源徽记：菱形是"印章"，所以描边用和海岸线同一支墨色，不跟着资源色走；
   * 首字填充用深灰 + 暖白描边，与地图注记同一套读法（14-labels）。 */
  var RES_INK = '#2b3238';
  var RES_TXT = 'rgba(26,32,38,0.92)';
  var RES_HALO = 'rgba(252,250,245,0.92)';
  /* 菱形边长（屏幕像素）→ 半对角线 = 边长/√2。
   * 远景 8px（纯色块，方案原值）；近景要叠 10px 首字，8px 的色块会被字的光晕
   * 整个吃掉（实测只剩四个角尖），所以近景放大到 14px —— 色块才读得出来。 */
  var RES_SIDE_FAR = 8;
  /* 近景徽记里放的是什么：'item' = 生图的实物图标（默认），'glyph' = 生图墨字，
   * 'font' = canvas 字体。ASSETS 缺图时会逐级退回。 */
  var RES_ICON_PX = 28;       // 实物图标烘焙尺寸（屏幕像素，绘制时再缩）
  var RES_ICON_HALO = 1.8;    // 图标外面的暖白描边（贴纸边）
  var RES_GLYPH_PX = 11;      // 墨字字号（'glyph' / 'font' 模式）
  var RES_GLYPH_HALO = 2;
  var RES_BAKE = 4;           // 烘焙倍率

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---------------- 战争迷雾（v6）的纸面语汇 ----------------
   * 未测绘区 = 一张没上色的羊皮纸：底色 + 纸纹 + 稀疏斜线（"这张图还没画完"）。
   * 已探但过时 = 国色上叠一层暖黄，越旧越黄 —— 做旧是**信息**，不是滤镜：
   * 一眼看过去，暖黄越重，那块地方的上一次测绘越久远。
   *
   * 这里只放"长什么样"，判断谁是哪一态全在 11-ui.js 的 AO.fogVis：
   * 渲染层不认识 PLAYER / 情报署，也不该认识。 */
  var PAPER = '#efe6d2';                          // 未测绘区：羊皮纸底色（暖、浅）
  var TINT = [201, 168, 96];                       // 泛黄的目标色（旧纸）
  var TINT_A = [0.10, 0.22, 0.35];                 // 三档陈旧度
  var TINT_CSS = ['rgba(201,168,96,0.10)', 'rgba(196,158,84,0.22)', 'rgba(186,144,70,0.35)'];
  var _tintCache = Object.create(null);
  function tintHex(hex, b) {
    var key = hex + '|' + b, v = _tintCache[key];
    if (v) return v;
    var c = hexToRgb(hex || '#b9b09a'), a = TINT_A[b] || 0;
    v = 'rgb(' + Math.round(c[0] * (1 - a) + TINT[0] * a) + ',' +
      Math.round(c[1] * (1 - a) + TINT[1] * a) + ',' +
      Math.round(c[2] * (1 - a) + TINT[2] * a) + ')';
    _tintCache[key] = v;
    return v;
  }
  function tintRgb(rgb, b) {
    var a = TINT_A[b] || 0;
    return [Math.round(rgb[0] * (1 - a) + TINT[0] * a),
      Math.round(rgb[1] * (1 - a) + TINT[1] * a),
      Math.round(rgb[2] * (1 - a) + TINT[2] * a)];
  }
  function fogActive() { return !!(AO.fogOn && AO.fogOn()); }
  function fogVis(pid) { return AO.fogVis ? AO.fogVis(pid) : 2; }
  function fogBucket(pid) { return AO.fogStaleBucket ? AO.fogStaleBucket(pid) : 0; }

  function Renderer(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: world.meta.width / 2, y: world.meta.height / 2, scale: 1 };
    this.hover = 0;
    this.selected = 0;
    this.hoverCountry = 0;
    this.selectedCountry = 0;
    this.mode = 'view';
    this.viewMode = 'political';
    this.paintOwner = 1;
    this.dpr = Math.min(2, root.devicePixelRatio || 1);
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.minimap = document.createElement('canvas');
    this.minimapCtx = this.minimap.getContext('2d');
    this.mmScale = 0.2;   // 实际在 _buildMinimap 里按世界宽度重算
    this._raf = 0;
    this._needBase = true;
    this._needDraw = true;
    /* 注记缓存：选取结果只在视图/缩放档/相机移动过大时重算，平移直接复用 */
    this._labels = null;
    this._labelView = '';
    this._labelTier = -1;
    this._labelScale = 0;
    this._labelCamX = 0;
    this._labelCamY = 0;
    this._labelPad = 320;
    this._dragging = false;
    this._moved = 0;
    this.onSelect = null;
    this.onHover = null;
    this._loadResIcons();
    this._buildGeometry();
    this.resize();
    this.fit();
    this._bind();
  }
  AO.Renderer = Renderer;

  /* ---------------- 几何缓存 ---------------- */
  Renderer.prototype._buildGeometry = function () {
    var w = this.world;
    this.countryPaths = new Map();
    this.provPaths = new Map();
    this.coastPath = new Path2D();
    this.borderPath = new Path2D();

    var i, k, r;

    /* 每个国家一个 Path2D；同国所有省的环全部塞进同一个 path，
     * 只 fill 一次 → 内部绝对没有接缝 */
    for (i = 0; i < w.countries.length; i++) {
      var c = w.countries[i];
      var p = new Path2D();
      for (k = 0; k < c.provinces.length; k++) {
        var prov = w.provinces[c.provinces[k] - 1];
        if (!prov) continue;
        for (r = 0; r < prov.rings.length; r++) addRing(p, prov.rings[r].coords);
      }
      this.countryPaths.set(c.id, p);
    }

    var cls = AO.collectRuns(w);
    for (i = 0; i < cls.coast.length; i++) addPolyline(this.coastPath, cls.coast[i].pts);
    for (i = 0; i < cls.border.length; i++) addPolyline(this.borderPath, cls.border[i].pts);

    /* 海深分带：由深到浅三个 Path2D，用 evenodd 填充（每段都是"环"） */
    this.seaPaths = [];
    var bands = w.seaBandRings || [];
    for (i = 0; i < bands.length; i++) {
      var sp = new Path2D();
      for (k = 0; k < bands[i].length; k++) addRing(sp, bands[i][k].coords);
      this.seaPaths.push(sp);
    }

    /* 河网：按水量分的 5 个宽度级各建一条 Path2D（0 级 = 源头毛细） */
    this.riverPaths = [];
    for (i = 0; i < 5; i++) this.riverPaths.push(new Path2D());
    var rivers = w.rivers || [];
    for (i = 0; i < rivers.length; i++) {
      var rv = rivers[i];
      addSmoothPolyline(this.riverPaths[rv.cls] || this.riverPaths[0], rv.pts);
    }

    /* 宗教视图：按信仰分组，每个信仰一条 Path2D */
    this.faithPaths = [];
    for (i = 0; i < 10; i++) this.faithPaths.push(new Path2D());
    for (i = 0; i < w.provinces.length; i++) {
      var pvF = w.provinces[i];
      if (!pvF || pvF.faithIdx === undefined || pvF.faithIdx < 0) continue;
      var fp = this.faithPaths[pvF.faithIdx];
      if (!fp) continue;
      for (k = 0; k < pvF.rings.length; k++) addRing(fp, pvF.rings[k].coords);
    }

    /* 资源视图：按"主资源"分组，每种资源一条 Path2D（和宗教视图同一个做法）。
     * 每省的七种储量在省份卡里看，地图上不画图标也不写数字。 */
    this.resPaths = Object.create(null);
    var RES = AO.RESOURCES || [];
    for (i = 0; i < RES.length; i++) this.resPaths[RES[i].key] = new Path2D();
    for (i = 0; i < w.provinces.length; i++) {
      var pvR = w.provinces[i];
      if (!pvR || !pvR.resources || !pvR.resources.length) continue;
      var rp = this.resPaths[pvR.resources[0].key];
      if (!rp) continue;
      for (k = 0; k < pvR.rings.length; k++) addRing(rp, pvR.rings[k].coords);
    }

    /* 山体阴影：把灰度场包成一张 canvas。
     * 灰色场里海面填的是"中性值"，所以叠上去时海洋颜色不变 ——
     * 不需要 clip 到陆地（在 3200×1600 上裁几千个环和叠阴影本身一个量级）。 */
    this._buildHillCanvas();

    /* 地形分带（地形视图） */
    this.terrainPaths = [];
    var tb = w.terrainBands || [];
    for (i = 0; i < tb.length; i++) {
      var tp = new Path2D();
      for (k = 0; k < tb[i].length; k++) addRing(tp, tb[i][k].coords);
      this.terrainPaths.push(tp);
    }

    /* 所有省界（地形视图里用细线显示，便于对照） */
    this.allRingPath = new Path2D();
    for (i = 0; i < w.provinces.length; i++) {
      var pv2 = w.provinces[i];
      if (!pv2) continue;
      for (k = 0; k < pv2.rings.length; k++) addRing(this.allRingPath, pv2.rings[k].coords);
    }

    this._buildMinimap();
  };

  /* 灰度场 → canvas。整张一次 putImageData，之后每帧只是一次 drawImage。
   * blend / alpha 跟着世界一起存（hs.cfg），换参数重算阴影不会和旧画布错配。 */
  Renderer.prototype._buildHillCanvas = function () {
    this.hillCanvas = null;
    this.hillBlend = 'overlay';
    this.hillAlpha = 0.85;
    var hs = this.world && this.world.hillshade;
    if (!hs || !hs.data || !hs.width || !hs.height) return;
    var hc = document.createElement('canvas');
    hc.width = hs.width; hc.height = hs.height;
    var hctx = hc.getContext('2d');
    var himg = hctx.createImageData(hs.width, hs.height);
    var hd = himg.data, src = hs.data;
    for (var i = 0, j = 0; i < src.length; i++, j += 4) {
      var hv = src[i];
      hd[j] = hv; hd[j + 1] = hv; hd[j + 2] = hv; hd[j + 3] = 255;
    }
    hctx.putImageData(himg, 0, 0);
    this.hillCanvas = hc;
    if (hs.cfg) {
      if (hs.cfg.blend) this.hillBlend = hs.cfg.blend;
      if (hs.cfg.alpha !== undefined) this.hillAlpha = hs.cfg.alpha;
    }
  };

  function addRing(path, pts) {
    var n = pts.length >> 1;
    if (n < 3) return;
    path.moveTo(pts[0], pts[1]);
    for (var i = 1; i < n; i++) path.lineTo(pts[i * 2], pts[i * 2 + 1]);
    path.closePath();
  }

  function addPolyline(path, pts) {
    var n = pts.length >> 1;
    if (n < 2) return;
    path.moveTo(pts[0], pts[1]);
    for (var i = 1; i < n; i++) path.lineTo(pts[i * 2], pts[i * 2 + 1]);
  }

  /* 河流专用：中点二次曲线。
   * D8 出来的路径是 45° 台阶，直接 lineTo 在高倍缩放下是一串锯齿。
   * 这里用相邻两点的中点作曲线端点、原顶点作控制点 —— 曲线恒在控制点
   * 邻域的凸包内，不会冲出河道、也不会被拉成圆弧过度。 */
  function addSmoothPolyline(path, pts) {
    var n = pts.length >> 1;
    if (n < 2) return;
    path.moveTo(pts[0], pts[1]);
    if (n === 2) { path.lineTo(pts[2], pts[3]); return; }
    for (var i = 1; i < n - 1; i++) {
      path.quadraticCurveTo(
        pts[i * 2], pts[i * 2 + 1],
        (pts[i * 2] + pts[i * 2 + 2]) * 0.5, (pts[i * 2 + 1] + pts[i * 2 + 3]) * 0.5
      );
    }
    path.lineTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
  }

  /* 纸纹：128×128 的灰度噪点，用 overlay 混合铺满整张图。
   * 用固定 seed，避免每次重绘纹理都不一样（那样拖动时画面会"沙沙"抖）。 */
  function makePaperPattern(ctx) {
    var N = 256;
    var c = document.createElement('canvas');
    c.width = c.height = N;
    var g = c.getContext('2d');
    var img = g.createImageData(N, N);
    var r = new AO.RNG(20261024);
    for (var i = 0; i < N * N; i++) {
      var v = 128 + (r.next() - 0.5) * 22;
      var o = i * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  }

  /* ---------------- 资源图标：生图精灵 → 烘焙 ----------------
   * 生图给的是「实物 + 白底」，tools/build-res-icons.py 抠掉白底、按长边归一化，
   * 输出 assets/res/item-<key>.png（96px，透明底）。这里烘成带暖白描边的一张小位图：
   * 先把剪影用 source-in 灌成暖白，在 8 个方向各画一次（膨胀出白边），
   * 再把原图压上面 —— 贴到彩色菱形上时，图标和底片之间才有一道干净的缝。
   * 烘焙一次、运行时一次 drawImage，底图重绘不额外付钱。 */
  /* 把图标的 alpha 剪影灌成指定颜色，用来做外发光/描边 */
  function silhouette(img, S, off, gpx, color) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, off, off, gpx, gpx);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  var spriteCache = Object.create(null);
  function bakeSprite(img, px, haloPx) {
    var key = img.src + '|' + px + '|' + haloPx;
    if (spriteCache[key]) return spriteCache[key];
    var side = px + haloPx * 2;
    var S = Math.max(8, Math.round(side * RES_BAKE));
    var ipx = Math.round(px * RES_BAKE);
    var off = Math.round((S - ipx) / 2);

    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    /* 两层底：外圈暖白发光（压在任意省色上都分得开），
     * 里圈一道极细的墨边 —— 鱼、盐晶这种浅色物件在浅绿省上否则会"化掉"。 */
    var halo = silhouette(img, S, off, ipx, RES_HALO);
    var rim = silhouette(img, S, off, ipx, 'rgba(43,50,56,0.5)');
    var rHalo = haloPx * RES_BAKE;
    var rRim = Math.max(0.8, haloPx * 0.45) * RES_BAKE;
    var a, th;
    for (a = 0; a < 8; a++) {
      th = a * Math.PI / 4;
      g.drawImage(halo, Math.cos(th) * rHalo, Math.sin(th) * rHalo);
    }
    for (a = 0; a < 8; a++) {
      th = a * Math.PI / 4;
      g.drawImage(rim, Math.cos(th) * rRim, Math.sin(th) * rRim);
    }
    g.drawImage(img, off, off, ipx, ipx);

    var rec = { cv: cv, size: side };
    spriteCache[key] = rec;
    return rec;
  }

  /* 菱形路径（世界坐标） */
  function diamondPath(ctx, cx, cy, half) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
  }

  /* 五角星路径：首都标记用。圆点在地图上看像"打了个洞"或一粒灰尘，
   * 星形才是地图学里约定俗成的首都符号，缩到 4~5px 也认得出。 */
  function starPath(ctx, cx, cy, outer) {
    var inner = outer * 0.44;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 ? inner : outer;
      var px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  Renderer.prototype._buildMinimap = function () {
    var w = this.world, m = w.meta;
    this.mmScale = Math.min(0.22, 340 / m.width);
    var mw = Math.round(m.width * this.mmScale);
    var mh = Math.round(m.height * this.mmScale);
    this.minimap.width = mw;
    this.minimap.height = mh;
    var img = this.minimapCtx.createImageData(mw, mh);
    var data = img.data;
    var step = m.width / mw;
    var ownerRgb = [null];
    for (var i = 0; i < w.countries.length; i++) ownerRgb.push(hexToRgb(w.countries[i].color));
    var ocean = hexToRgb(OCEAN);
    /* 迷雾（v6）：小地图和主图走**同一套判定**（AO.fogVis），
     * 否则会出现"大地图一片空白、小地图却五颜六色"的分裂感。 */
    var fog = fogActive();
    var paperRgb = hexToRgb(PAPER), unownedRgb = hexToRgb(Unowned);
    var seenRgb = Object.create(null);
    for (var y = 0; y < mh; y++) {
      var sy = Math.min(m.height - 1, (y * step) | 0);
      for (var x = 0; x < mw; x++) {
        var sx = Math.min(m.width - 1, (x * step) | 0);
        var l = w.labels[sy * m.width + sx];
        var col = ocean;
        if (l) {
          var pr = w.provinces[l - 1];
          if (!pr) col = unownedRgb;
          else if (fog) {
            var fv = fogVis(pr.id);
            if (fv === 0) col = paperRgb;
            else if (fv === 1) {
              var hx = (AO.fogSeenColor && AO.fogSeenColor(pr.id)) || Unowned;
              var bk = fogBucket(pr.id), ck = hx + '|' + bk;
              col = seenRgb[ck] || (seenRgb[ck] = tintRgb(hexToRgb(hx), bk));
            } else col = ownerRgb[pr.owner] || unownedRgb;
          } else col = ownerRgb[pr.owner] || unownedRgb;
        }
        var o = (y * mw + x) * 4;
        data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
      }
    }
    this.minimapCtx.putImageData(img, 0, 0);
    this._minimapDirty = true;
  };

  /* 未测绘区的"羊皮纸瓦片"：底色 + 纸纹 + 一条 45° 细线，96×96 平铺。
   * 为什么要做成瓦片：整块未测绘区有上千个环，用 clip + 逐条斜线去铺，
   * 实测一次烘焙 85ms（滚轮每滚一格就重烘一次，直接卡成幻灯片）；
   * 改成"一次 pattern 填充"之后，同一张图只要 10ms 上下。
   * 斜线间距 24px 横向 → 法向 17px，平铺时首尾接得上（96 是 24 的整数倍）。 */
  function makeFogTile() {
    var N = 96;
    var c = document.createElement('canvas');
    c.width = c.height = N;
    var g = c.getContext('2d');
    g.fillStyle = PAPER;
    g.fillRect(0, 0, N, N);
    /* 纸纹：和全图纸纹同一支灰噪，只是这里低对比地"印在纸上" */
    var r = new AO.RNG(20261025);
    var img = g.getImageData(0, 0, N, N), d = img.data;
    for (var i = 0; i < N * N; i++) {
      var v = (r.next() - 0.5) * 16;
      var o = i * 4;
      d[o] = AO.clamp(d[o] + v, 0, 255);
      d[o + 1] = AO.clamp(d[o + 1] + v, 0, 255);
      d[o + 2] = AO.clamp(d[o + 2] + v * 0.9, 0, 255);
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(120,104,74,0.15)';
    g.lineWidth = 1;
    g.beginPath();
    for (var x = -N; x < N * 2; x += 24) {
      g.moveTo(x, 0);
      g.lineTo(x + N, N);
    }
    g.stroke();
    return c;
  }

  /* 迷雾的图层缓存。
   * 关键教训：**建 Path2D 才是贵的**（1100 个省、十万个点，一次 75ms），
   * 填充本身只要几毫秒。所以路径按"迷雾版本号"缓存，只在迷雾真的变了（每回合一次 /
   * 探测成功 / 换国）时重建；缩放、平移只是重新烘焙底图，路径直接复用。
   * 版本号由 11-ui 的 fogInvalidate 递增，渲染层只比较数字。 */
  Renderer.prototype._fogCache = function () {
    var ver = AO.fogVersion ? AO.fogVersion() : 0;
    if (this._fogC && this._fogC.ver === ver) return this._fogC;
    var w = this.world, groups = Object.create(null), order = [], i, k, b;
    var unk = null, seen = [null, null, null];
    for (i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (!p) continue;
      var v = fogVis(p.id);
      if (v === 0) {
        if (!unk) unk = new Path2D();
        for (k = 0; k < p.rings.length; k++) addRing(unk, p.rings[k].coords);
        continue;
      }
      if (v === 1) {
        b = fogBucket(p.id);
        if (!seen[b]) seen[b] = new Path2D();
        for (k = 0; k < p.rings.length; k++) addRing(seen[b], p.rings[k].coords);
      }
      /* 政治视图的填色：实时用现行国色，已探用**当时**那个旧主的颜色 + 做旧 */
      var col = v === 2
        ? (p.ownerColor || ((w.countries[p.owner - 1] || {}).color) || Unowned)
        : tintHex((AO.fogSeenColor && AO.fogSeenColor(p.id)) || Unowned, b === undefined ? fogBucket(p.id) : b);
      var g = groups[col];
      if (!g) { g = groups[col] = new Path2D(); order.push(col); }
      for (k = 0; k < p.rings.length; k++) addRing(g, p.rings[k].coords);
    }
    this._fogC = { ver: ver, groups: groups, order: order, unk: unk, seen: seen };
    return this._fogC;
  };

  /* 迷雾：政治视图按"显示色"分组填（路径来自 _fogCache，不再逐帧重建）。 */
  Renderer.prototype._fillFogPolitical = function (ctx) {
    var C = this._fogCache(), i;
    for (i = 0; i < C.order.length; i++) {
      ctx.fillStyle = C.order[i];
      ctx.fill(C.groups[C.order[i]], 'nonzero');
    }
  };

  /* 迷雾覆盖层：未测绘区铺羊皮纸 + 稀疏斜线；非政治视图里再给"已探"叠泛黄。
   * （政治视图的泛黄已经在填色时混进颜色了 —— 只叠一次，
   *   否则同一块地方会被黄两层，陈旧度分档就看不出来了。） */
  Renderer.prototype._paintFog = function (ctx, s) {
    var C = this._fogCache(), b;
    /* 非政治视图：只做旧、不遮色（地形/信仰/资源是"自然事实"，
     * 探过一次就记住地形了，和归属无关） */
    if (this.viewMode !== 'political') {
      for (b = 0; b < 3; b++) {
        if (!C.seen[b]) continue;
        ctx.fillStyle = TINT_CSS[b];
        ctx.fill(C.seen[b], 'nonzero');
      }
    }
    /* 「换旗」补盖：已探省的现行归属和当时不同时，国界线是按今天的版图画的 ——
     * 那条线正好会告诉玩家"这里已经不是当年那个国了"。把这几块省在国界之后
     * 重涂一次（数量通常是个位数，用的还是缓存好的省路径，很便宜）。 */
    if (this.viewMode === 'political' && AO.fogOwnerChanged) {
      var w2 = this.world;
      for (var i2 = 0; i2 < w2.provinces.length; i2++) {
        var p2 = w2.provinces[i2];
        if (!p2 || fogVis(p2.id) !== 1 || !AO.fogOwnerChanged(p2.id)) continue;
        var pp = this._provPath(p2.id);
        if (!pp) continue;
        ctx.fillStyle = tintHex((AO.fogSeenColor && AO.fogSeenColor(p2.id)) || Unowned,
          fogBucket(p2.id));
        ctx.fill(pp, 'nonzero');
      }
    }
    if (!C.unk) return;
    /* 一次 pattern 填完：底色 + 纸纹 + 斜线都在瓦片里（见 makeFogTile 的注释） */
    if (!this._fogPat) {
      var tile = makeFogTile();
      this._fogPat = ctx.createPattern(tile, 'repeat');
    }
    ctx.fillStyle = this._fogPat || PAPER;
    ctx.fill(C.unk, 'nonzero');
  };

  /* 迷雾状态变了：底图要重烘、注记要重选（国名可能正因为"一省未探"而不该出现）、
   * 小地图要重采样。一回合一次 —— 别在每帧里调。 */
  Renderer.prototype.fogRefresh = function () {
    this._labels = null;
    this._needBase = true;
    if (this.world) this._buildMinimap();
    this.requestDraw();
  };

  /* 重新计算几何（涂色改归属后调用） */
  Renderer.prototype.rebuild = function () {
    this._buildGeometry();
    this._labels = null;        // 归属变了，国家面积和排序都变了，注记得重选
    this._needBase = true;
    this.requestDraw();
  };

  /* 换一整个世界 */
  Renderer.prototype.setWorld = function (world) {
    this.world = world;
    this._labels = null;
    this._labelMeasure = null;
    this._spriteCache = null;
    this._spriteCount = 0;
    this.hover = 0;
    this.selected = 0;
    this.hoverCountry = 0;
    this.selectedCountry = 0;
    if (this.paintOwner > world.countries.length) this.paintOwner = 1;
    this.provPaths.clear();
    this._buildGeometry();
    this.fit();
    this._needBase = true;
    this.requestDraw();
  };

  /* 重算前先把上一个世界的引用和 Path2D 全丢掉。
   * 一个 2400×1200 / 1100 省的世界在渲染层持有几十 MB（Path2D 是原生对象），
   * 不清掉的话下一次生成要在这个大堆里做分配和标记，耗时直接翻 3 倍。 */
  Renderer.prototype.releaseWorld = function () {
    this.world = null;
    this._labels = null;
    this._labelMeasure = null;
    this._spriteCache = null;
    this._spriteCount = 0;
    this.hover = 0;
    this.selected = 0;
    this.hoverCountry = 0;
    this.selectedCountry = 0;
    this.countryPaths = new Map();
    this.provPaths = new Map();
    this.coastPath = null;
    this.borderPath = null;
    this.faithPaths = null;
    this.resPaths = null;
    this.terrainPaths = [];
    this.hillCanvas = null;
    this.minimap.width = 1;
    this.minimap.height = 1;
    this._needBase = true;
  };

  /* ---------------- 尺寸 / 视图 ---------------- */
  Renderer.prototype.resize = function () {
    var cw = this.canvas.clientWidth || this.canvas.parentNode.clientWidth || 800;
    var ch = this.canvas.clientHeight || this.canvas.parentNode.clientHeight || 600;
    this.cssW = cw;
    this.cssH = ch;
    this.dpr = Math.min(2, root.devicePixelRatio || 1);
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this._needBase = true;
    this.requestDraw();
  };

  Renderer.prototype.fit = function () {
    var m = this.world.meta;
    var s = Math.min(this.cssW / m.width, this.cssH / m.height) * 0.96;
    this.cam.scale = s;
    this.cam.x = m.width / 2;
    this.cam.y = m.height / 2;
    this._needBase = true;
    this.requestDraw();
  };

  Renderer.prototype.clampCam = function () {
    var m = this.world.meta;
    this.cam.scale = AO.clamp(this.cam.scale, 0.12, 24);
    var halfW = this.cssW / 2 / this.cam.scale, halfH = this.cssH / 2 / this.cam.scale;
    if (halfW * 2 >= m.width) this.cam.x = m.width / 2;
    else this.cam.x = AO.clamp(this.cam.x, halfW, m.width - halfW);
    if (halfH * 2 >= m.height) this.cam.y = m.height / 2;
    else this.cam.y = AO.clamp(this.cam.y, halfH, m.height - halfH);
  };

  Renderer.prototype.toWorld = function (sx, sy) {
    return {
      x: (sx - this.cssW / 2) / this.cam.scale + this.cam.x,
      y: (sy - this.cssH / 2) / this.cam.scale + this.cam.y
    };
  };

  Renderer.prototype.toScreen = function (wx, wy) {
    return {
      x: (wx - this.cam.x) * this.cam.scale + this.cssW / 2,
      y: (wy - this.cam.y) * this.cam.scale + this.cssH / 2
    };
  };

  /* ---------------- 绘制 ---------------- */
  Renderer.prototype.requestDraw = function () {
    var self = this;
    if (this._raf) return;
    this._raf = root.requestAnimationFrame(function () {
      self._raf = 0;
      self.draw();
    });
  };

  Renderer.prototype.draw = function () {
    if (!this.world) return;                 // 正在重算，世界暂时为空
    if (this._needBase) { this._renderBase(); this._needBase = false; }
    var ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    this._drawOverlays(ctx);
    this._drawLabels(ctx);
    this._drawMinimap(ctx);
    this._drawFurniture(ctx);
    this._needDraw = false;
  };

  /* ---------------- 注记 ----------------
   * 选取（谁该被标、多大字号、初始落点）只在缩放档变化、视图切换或相机
   * 走出预留区时重算；平移是纯位移，碰撞结论不变，所以缓存可以直接复用。
   * 每帧只做"投影 + 画字"，几十条注记的开销在 1ms 量级。 */
  Renderer.prototype._ensureLabels = function () {
    if (!AO.computeLabels || !this.world) return;
    var c = this.cam;
    var tier = AO.labelTier(c.scale);
    var stale = !this._labels ||
      this._labelView !== this.viewMode ||
      this._labelTier !== tier ||
      c.scale > this._labelScale * 1.08 ||
      c.scale < this._labelScale * 0.92 ||
      Math.abs(c.x - this._labelCamX) * c.scale > this._labelPad * 0.6 ||
      Math.abs(c.y - this._labelCamY) * c.scale > this._labelPad * 0.6;
    if (!stale) return;

    var pad = Math.round(Math.min(this.cssW, this.cssH) * 0.24) + 120;
    var ctx = this.ctx;
    var cache = this._labelMeasure || (this._labelMeasure = Object.create(null));
    this._labelPad = pad;
    this._labels = AO.computeLabels(this.world, this.viewMode, {
      scale: c.scale,
      width: this.cssW,
      height: this.cssH,
      cx: c.x,
      cy: c.y,
      pad: pad,
      /* 文本宽度是要量的里最贵的一步（measureText），同一串字同一字号只会量一次：
       * 缩放时反复重算标签，但字号和文字的组合是有限的。 */
      measure: function (text, size, weight, italic) {
        var key = (italic ? 'i' : 'n') + weight + '|' + size + '|' + text;
        var v = cache[key];
        if (v !== undefined) return v;
        ctx.font = (italic ? 'italic ' : '') + weight + ' ' + size + 'px ' + AO.LABEL_FONT;
        v = ctx.measureText(text).width;
        cache[key] = v;
        return v;
      },
      /* 迷雾（v6）：注记也要按"你知不知道这块地方"来选。
       * 一个国家一省未探 → 国名不出现（"听说过的国家"才配写在地图上）。 */
      vis: (AO.fogOn && AO.fogOn()) ? function (pid) { return AO.fogVis(pid); } : null,
      countryKnown: (AO.fogOn && AO.fogOn()) ? AO.fogCountryKnown : null
    });
    this._labelView = this.viewMode;
    this._labelTier = tier;
    this._labelScale = c.scale;
    this._labelCamX = c.x;
    this._labelCamY = c.y;
    this._labelCount = this._labels.length;
  };

  /* 一条注记烘成一张小位图。
   * 描边文字每帧重新光栅化一次，笔画多、字又多，实测能吃掉 4ms；
   * 注记本身是静态的，所以烘一次、之后每帧只贴图（一次 drawImage ≈ 几个微秒）。
   * key 里带 dpr：位图按设备像素烘，Retina 上才不会糊。 */
  Renderer.prototype._labelSprite = function (L) {
    var dpr = this.dpr;
    var key = dpr + '|' + L.size + '|' + L.subSize + '|' + L.weight + '|' +
      L.color + '|' + L.sub + '|' + L.text;
    var cache = this._spriteCache || (this._spriteCache = Object.create(null));
    var hit = cache[key];
    if (hit) return hit;
    if (this._spriteCount > 240) {              // 封顶：一张 ~120×30 的位图约 57KB(dpr2)
      this._spriteCache = cache = Object.create(null);
      this._spriteCount = 0;
    }

    var padX = 3, padY = 2;
    var w = L.tw + padX * 2, h = L.h + padY * 2;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(w * dpr);
    cv.height = Math.ceil(h * dpr);
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';

    var cx = padX + L.tw / 2;
    var cy = padY + L.h / 2;
    var halfSub = L.sub ? (L.subSize + 2.5) / 2 : 0;
    var y1 = cy - halfSub;
    var y2 = cy - halfSub + L.size / 2 + 1.25 + L.subSize / 2;

    g.font = L.weight + ' ' + L.size + 'px ' + AO.LABEL_FONT;
    g.lineWidth = 2;
    g.strokeStyle = AO.LABEL_HALO;
    g.strokeText(L.text, cx, y1);
    g.fillStyle = L.color;
    g.fillText(L.text, cx, y1);
    if (L.sub) {
      g.font = 'italic ' + L.subSize + 'px ' + AO.LABEL_FONT;
      g.lineWidth = 2.2;
      g.strokeStyle = 'rgba(250,247,240,0.82)';
      g.strokeText(L.sub, cx, y2);
      g.fillStyle = 'rgba(44,52,60,0.66)';
      g.fillText(L.sub, cx, y2);
    }
    var rec = { cv: cv, w: w, h: h, padX: padX, padY: padY };
    cache[key] = rec;
    this._spriteCount = (this._spriteCount || 0) + 1;
    return rec;
  };

  Renderer.prototype._drawLabels = function (ctx) {
    if (!AO.computeLabels) return;
    this._ensureLabels();
    var list = this._labels;
    if (!list || !list.length) return;

    var dpr = this.dpr, s = this.cam.scale;
    var hw = this.cssW / 2, hh = this.cssH / 2;
    var camx = this.cam.x, camy = this.cam.y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (var i = 0; i < list.length; i++) {
      var L = list[i];
      var x = (L.x - camx) * s + hw;
      var y = (L.y - camy) * s + hh;
      if (x < -L.w || x > this.cssW + L.w || y < -L.h || y > this.cssH + L.h) continue;

      if (L.icon && L.sym) {
        var img = AO.faithIcon(L.sym);
        if (img && img.complete && img.naturalWidth) {
          var halfSub0 = L.sub ? (L.subSize + 2.5) / 2 : 0;
          var ix = x - L.w / 2 + 1;
          var iy = y - halfSub0 - L.icon / 2;
          /* 图标底下垫一个和文字同色的淡色小圆：
           * 不然深色图标压在深色信仰块上会糊掉，也和带光晕的文字不成一体。 */
          ctx.beginPath();
          ctx.arc(ix + L.icon / 2, iy + L.icon / 2, L.icon * 0.62, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250,247,240,0.82)';
          ctx.fill();
          ctx.drawImage(img, ix, iy, L.icon, L.icon);
        }
      }
      var sp = this._labelSprite(L);
      var textCx = x + (L.icon ? (L.icon + 4) / 2 : 0);
      ctx.drawImage(sp.cv, textCx - L.tw / 2 - sp.padX, y - L.h / 2 - sp.padY, sp.w, sp.h);
    }
  };

  Renderer.prototype._renderBase = function () {
    var ctx = this.baseCtx, dpr = this.dpr, w = this.world;
    var s = this.cam.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);

    // 海洋：先铺一层底色兜底，再在世界坐标系里叠一层径向渐变
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, this.base.width, this.base.height);

    // 世界坐标系
    var ox = dpr * (this.cssW / 2 - this.cam.x * s);
    var oy = dpr * (this.cssH / 2 - this.cam.y * s);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, ox, oy);

    /* 海洋渐变：中心浅、外圈深。跟着地图一起平移（世界坐标），
     * 所以拖动时它是"海的一部分"，不是屏幕上的打光。
     * 画到 3 倍世界范围，避免缩小时世界边缘出现接缝。 */
    var mW = w.meta.width, mH = w.meta.height;
    var ogr = ctx.createRadialGradient(mW / 2, mH / 2, 0, mW / 2, mH / 2, Math.max(mW, mH) * 0.72);
    ogr.addColorStop(0, '#46748f');
    ogr.addColorStop(0.60, '#3d6883');
    ogr.addColorStop(1, '#36596f');
    ctx.fillStyle = ogr;
    ctx.fillRect(-mW, -mH, mW * 3, mH * 3);

    /* 大陆架：三层等深带，纯色平涂 + evenodd，边缘在任意缩放下都锐利。
     * 它们是跟着海底地形走的，所以海湾里宽、陡岸处窄，不是贴着海岸的等宽光晕。 */
    var seaCols = [OCEAN_MID, OCEAN_LIGHT, OCEAN_SHORE];
    if (this.coastPath) {
      var kk = w.meta.width / 2400;
      // 陡岸处等深线会贴得极窄，补一条固定宽度的近岸浅水，保证每条海岸都有浅滩
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = OCEAN_SHORE;
      ctx.lineWidth = 26 * kk;
      ctx.stroke(this.coastPath);
    }
    if (this.seaPaths) {
      for (var si = 0; si < this.seaPaths.length; si++) {
        ctx.fillStyle = seaCols[si] || OCEAN_LIGHT;
        ctx.fill(this.seaPaths[si], 'evenodd');
      }
    }

    /* 经纬网：极淡的白色细线，只在海上露出来 —— 陆地会盖住它。
     * 它不给地图增加任何信息，但一下子就有"制图"的味道。 */
    var gstep = Math.max(mW, mH) / 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.075)';
    ctx.lineWidth = 0.7 / s;
    ctx.beginPath();
    for (var gx = gstep; gx < mW; gx += gstep) { ctx.moveTo(gx, 0); ctx.lineTo(gx, mH); }
    for (var gy = gstep; gy < mH; gy += gstep) { ctx.moveTo(0, gy); ctx.lineTo(mW, gy); }
    ctx.stroke();

    /* 1) 陆地：资源视图按主资源填色 / 宗教视图按信仰 / 地形视图按高程带 / 其余政治 */
    var i;
    if (fogActive() && this.viewMode === 'political') {
      /* 迷雾下的政治视图不能按国家一次填完 —— 同一个国可能一半实时、一半泛黄，
       * 边界那一条还没探过。所以按"显示色"分组填：实时用现行国色，
       * 已探用 LASTSEEN 里那个旧主的颜色，没探过的一律留白（后面铺纸纹）。 */
      this._fillFogPolitical(ctx);
    } else if (this.viewMode === 'resources' && this.resPaths) {
      var RESL = AO.RESOURCES || [];
      for (i = 0; i < RESL.length; i++) {
        var rpath = this.resPaths[RESL[i].key];
        if (!rpath) continue;
        ctx.fillStyle = RESL[i].color;
        ctx.fill(rpath, 'nonzero');
      }
    } else if (this.viewMode === 'faith' && this.faithPaths && this.faithPaths.length) {
      var FTH = AO.FAITHS || [];
      for (i = 0; i < this.faithPaths.length; i++) {
        ctx.fillStyle = (FTH[i] && FTH[i].color) || '#cccccc';
        ctx.fill(this.faithPaths[i], 'nonzero');
      }
    } else if (this.viewMode === 'terrain' && this.terrainPaths.length) {
      for (i = 0; i < this.terrainPaths.length; i++) {
        ctx.fillStyle = TERRAIN_COLORS[i] || TERRAIN_COLORS[0];
        ctx.fill(this.terrainPaths[i], 'evenodd');
      }
      /* 叠山体阴影：灰度场里海面是中性值，所以整张直接叠、不用 clip ——
       * overlay / soft-light 让明暗只改亮度不改色相，山才"立"起来而不是变脏。 */
      if (this.hillCanvas) {
        ctx.save();
        ctx.globalCompositeOperation = this.hillBlend;
        ctx.globalAlpha = this.hillAlpha;
        ctx.drawImage(this.hillCanvas, 0, 0, w.meta.width, w.meta.height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
      }
    } else {
      for (i = 0; i < w.countries.length; i++) {
        var c = w.countries[i];
        var path = this.countryPaths.get(c.id);
        if (!path) continue;
        ctx.fillStyle = c.color;
        ctx.fill(path, 'nonzero');
      }
    }

    // 2) 河流：细蓝线，按水量分四档粗细
    if (this.riverPaths && this.viewMode !== 'faith') {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.viewMode === 'terrain' ? RIVER_STRONG : RIVER;
      /* 五档宽度：0.55 / 1.05 / 1.75 / 2.75 / 4.0。
       * 不做统一的"最小可见宽度"——那会把毛细也撑成主干，远近一个样。
       * 这里让每档按 s^0.34 自己缩放，低档在世界视图下自然被抗锯齿吃掉，
       * 只剩主干可见，等于地图学里的分级选取。 */
      var rw = [0.55, 1.05, 1.75, 2.75, 4.0];
      for (var ri = 0; ri < this.riverPaths.length; ri++) {
        var lw = AO.clamp(rw[ri] * Math.pow(s, 0.34), rw[ri] * 0.9, rw[ri] * 1.9);
        ctx.lineWidth = Math.max(lw, ri >= 3 ? 1.15 : 0.5) / s;
        ctx.stroke(this.riverPaths[ri]);
      }
    }

    /* 3) 边界：地形视图先铺一层细省界，再叠加国界 */
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (this.viewMode !== 'political' && this.allRingPath) {
      ctx.strokeStyle = 'rgba(38,46,52,0.50)';
      ctx.lineWidth = AO.clamp(0.55 * Math.pow(s, 0.34), 0.5, 1.2) / s;
      ctx.stroke(this.allRingPath);
    }
    /* 国界：单根深线。试过先铺一层浅色"压痕"，但在世界视图下整张图
     * 会糊出一圈白边，像贴纸 —— 这里保持干净的一笔。 */
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = AO.clamp(0.95 * Math.pow(s, 0.34), 0.85, 1.9) / s;
    ctx.stroke(this.borderPath);

    /* 3b) 迷雾覆盖（v6）。
     * 必须压在线界之后、海岸线之前：
     *   在线界之前铺，国界会从羊皮纸里透出来（等于把没探过的地方的国界白送了）；
     *   在海岸线之后铺，会把海岸线削掉一半（纸盖到海上）。
     * 覆盖内容 = 未测绘区的羊皮纸 + 斜线阴影（政治视图另在填色时把泛黄叠进颜色里）。 */
    if (fogActive()) this._paintFog(ctx, s);

    /* 4) 海岸线：最重的一笔，压在所有陆地线条之上（同样双层） */
    var cw = AO.clamp(1.65 * Math.pow(s, 0.34), 1.45, 2.9) / s;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = cw * 2.4;
    ctx.stroke(this.coastPath);
    ctx.strokeStyle = COAST;
    ctx.lineWidth = cw;
    ctx.stroke(this.coastPath);

    /* 5) 首都：小五角星，压在所有线条之上。
     * 半径按屏幕像素算（世界半径 = 屏幕半径 / s），远景不糊、近景不缩成针尖。 */
    var capR = AO.clamp(2.15 * Math.pow(s, 0.18), 2.0, 3.6) / s;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.85 / s, 0.3);
    ctx.fillStyle = '#2b3238';
    ctx.strokeStyle = 'rgba(252,250,245,0.95)';
    for (i = 0; i < w.countries.length; i++) {
      var cc = w.countries[i];
      var cp = w.provinces[cc.capital - 1];
      if (!cp || cp.owner !== cc.id) continue;   // 被涂色改掉归属的首都不画
      if (fogActive() && fogVis(cp.id) === 0) continue;   // 迷雾：没探过的首都当然不标
      starPath(ctx, cp.centroid[0], cp.centroid[1], capR * 1.28);
      ctx.fill();
      ctx.stroke();
    }

    /* 5b) 资源徽记（资源视图）：省质心上一枚 45° 菱形。
     * 这是**静态层** —— 画在缓存底图里，进每帧 overlay 的只有悬停/选中。 */
    /* 5b) 资源标记：默认不画（资源按主资源填色，储量在省份卡里看）。
     * 想在省上再垫图标，把 15-resources.js 的 AO.RES_MARKS 改成 'icon'。 */
    if (this.viewMode === 'resources' && AO.RES_MARKS === 'icon') this._drawResourceMarks(ctx, s);

    /* 6) 纸纹 + 暗角：回到屏幕坐标铺在最上层。
     * 纸纹用 overlay 混合，只改明暗不动色相，像印在纸上；
     * 暗角把四角压下去，视线自然收到大陆上。 */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this._paperPat) this._paperPat = makePaperPattern(this.baseCtx);
    if (this._paperPat) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = this._paperPat;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    var vg = ctx.createRadialGradient(
      this.cssW / 2, this.cssH / 2, Math.min(this.cssW, this.cssH) * 0.52,
      this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.92);
    vg.addColorStop(0, 'rgba(16,24,32,0)');
    vg.addColorStop(1, 'rgba(16,24,32,0.065)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  };

  /* 载入 7 张图标并烘焙。图片是异步的：加载完一张就置一次脏标记，
   * 底图会自然重绘一次，不需要在别处再触发。缺图（onerror）先退到墨字，
   * 再失败就保持空表 —— 渲染端会退回 canvas 字体，功能不受影响。 */
  Renderer.prototype._loadResIcons = function () {
    this.resIcons = Object.create(null);
    var mode = AO.RES_ICON || 'item';
    if (mode === 'font' || !AO.RESOURCES || typeof root.Image === 'undefined') return;
    var px = mode === 'glyph' ? RES_GLYPH_PX : RES_ICON_PX;
    var halo = mode === 'glyph' ? RES_GLYPH_HALO : RES_ICON_HALO;
    var prefix = mode === 'glyph' ? '' : 'item-';
    var self = this;
    var list = AO.RESOURCES;
    for (var i = 0; i < list.length; i++) {
      (function (res) {
        var img = new root.Image();
        img.onload = function () {
          if (!img.naturalWidth) return;
          self.resIcons[res.key] = bakeSprite(img, px, halo);
          self._needBase = true;
          self.requestDraw();
        };
        if (prefix) {
          img.onerror = function () {           // 实物图标缺失 → 退到墨字
            img.onerror = null;
            img.src = 'assets/res/' + res.key + '.png';
          };
        }
        img.src = 'assets/res/' + prefix + res.key + '.png';
      })(list[i]);
    }
  };

  /* 可选的资源标记层（默认关闭，见 AO.RES_MARKS）。
   * 资源视图本身按主资源填色；这一层只用于"想在省上再垫个图标"的场合：
   *   scale <  1.0 → 只标富集省（储量 ≥ AO.RES_RICH）的 8px 色块
   *   scale >= 1.0 → 每省标主资源的实物图标
   * 尺寸全部除以 s（屏幕恒定），画在 base 缓存里。 */
  Renderer.prototype._drawResourceMarks = function (ctx, s) {
    var w = this.world;
    if (!AO.RESOURCE_BY_KEY) return;
    var showIcon = s >= 1.0;
    var rich = AO.RES_RICH || 85;
    var iconPx = showIcon ? AO.clamp(10 + s * 6, 14, 32) : RES_SIDE_FAR;
    var half = RES_SIDE_FAR / Math.SQRT1_2 / s;
    var i, p;

    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';

    /* 视口剔除：每省都有标记，不剔的话每次重绘底图都要摸一遍全图 */
    var padW = 48 / s;
    var vx0 = this.cam.x - this.cssW / 2 / s - padW, vx1 = this.cam.x + this.cssW / 2 / s + padW;
    var vy0 = this.cam.y - this.cssH / 2 / s - padW, vy1 = this.cam.y + this.cssH / 2 / s + padW;

    for (i = 0; i < w.provinces.length; i++) {
      p = w.provinces[i];
      var top = p && p.resources && p.resources[0];
      if (!top) continue;
      if (fogActive() && fogVis(p.id) === 0) continue;   // 没测绘过的地方没有徽记
      if (!showIcon && top.n < rich) continue;      // 远景只标富集省

      var cx = p.centroid[0], cy = p.centroid[1];
      if (cx < vx0 || cx > vx1 || cy < vy0 || cy > vy1) continue;

      if (!showIcon) {
        diamondPath(ctx, cx, cy, half);
        ctx.fillStyle = top.color;
        ctx.fill();
        ctx.lineWidth = 1 / s;
        ctx.strokeStyle = RES_INK;
        ctx.stroke();
        continue;
      }

      var sp = (AO.RES_ICON !== 'font' && this.resIcons) ? this.resIcons[top.key] : null;
      if (!sp) {
        /* 没有图标资源（或 AO.RES_ICON='font'）：退回 canvas 字体 */
        var ch = top.cn.charAt(0);
        ctx.font = '600 ' + (iconPx * 0.46 / s) + 'px ' + AO.LABEL_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1.4 / s;
        ctx.strokeStyle = RES_HALO;
        ctx.strokeText(ch, cx, cy);
        ctx.fillStyle = RES_TXT;
        ctx.fillText(ch, cx, cy);
        continue;
      }

      var iw = iconPx / s;
      ctx.drawImage(sp.cv, cx - iw / 2, cy - iw / 2, iw, iw);
    }
  };

  /* 切换视图 */
  Renderer.prototype.setView = function (mode) {
    if (mode !== 'terrain' && mode !== 'faith' && mode !== 'resources') mode = 'political';
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this._needBase = true;
    this.requestDraw();
  };

  Renderer.prototype._drawOverlays = function (ctx) {
    var dpr = this.dpr, s = this.cam.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s,
      dpr * (this.cssW / 2 - this.cam.x * s), dpr * (this.cssH / 2 - this.cam.y * s));

    if (this.hover && this.hover !== this.selected) {
      var hp = this._provPath(this.hover);
      if (hp) {
        ctx.fillStyle = HOVER_FILL;
        ctx.fill(hp, 'nonzero');
      }
    }

    /* 国家模式：整国高亮。
     * 直接复用 countryPaths（整国所有省的环塞进同一个 Path2D）：
     * 填充 = 提亮；描边 = 顺带把该国的省界显出来（平时同国省界是不画的），
     * 正好是"点开一个国家"该有的观感。
     * 迷雾下只给自己的国高亮：整国高亮等于把别国的版图边界白描一遍。 */
    var fogOwn = fogActive() ? (AO.fogPlayer ? AO.fogPlayer() : 0) : 0;
    var allowHl = function (cid) { return !fogActive() || cid === fogOwn; };
    if (this.hoverCountry && this.hoverCountry !== this.selectedCountry && allowHl(this.hoverCountry)) {
      var hcp = this.countryPaths.get(this.hoverCountry);
      if (hcp) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill(hcp, 'nonzero');
      }
    }
    if (this.selectedCountry) {
      var scp = this.countryPaths.get(this.selectedCountry);
      if (scp && allowHl(this.selectedCountry)) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fill(scp, 'nonzero');
        ctx.strokeStyle = 'rgba(24,30,36,0.62)';
        ctx.lineWidth = AO.clamp(1.1 / s, 0.35, 3 / s);
        ctx.stroke(scp);
      }
      // 选中该国时，它的首都画成砖红色的星，比其余大一号
      var selC = allowHl(this.selectedCountry) ? this.world.countries[this.selectedCountry - 1] : null;
      var selP = selC ? this.world.provinces[selC.capital - 1] : null;
      if (selP && selP.owner === selC.id) {
        var cr = AO.clamp(3.1 * Math.pow(s, 0.18), 2.9, 5.0) / s;
        ctx.lineJoin = 'round';
        starPath(ctx, selP.centroid[0], selP.centroid[1], cr * 1.28);
        ctx.fillStyle = '#b0492f';
        ctx.strokeStyle = '#fdfbf6';
        ctx.lineWidth = Math.max(1.1 / s, 0.35);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (this.selected) {
      var sp = this._provPath(this.selected);
      if (sp) {
        ctx.fillStyle = 'rgba(255,210,87,0.18)';
        ctx.fill(sp, 'nonzero');
        ctx.strokeStyle = SELECT;
        ctx.lineWidth = AO.clamp(2.4 / s, 0.5, 6 / s);
        ctx.stroke(sp);
      }
    }

    if (this.hover) {
      var hp2 = this._provPath(this.hover);
      if (hp2) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = AO.clamp(1.6 / s, 0.3, 5 / s);
        ctx.stroke(hp2);
      }
    }

    /* 战争层（军旗 / 占领斜线 / 战火）：由 11-ui.js 挂上来。
     * 放在最后画 —— 军旗要压在所有高亮之上，不然选中的省一填色旗就看不见了。
     * 用回调而不是在这里直写：渲染层不该知道"军队"这个概念（它只管画）。 */
    if (AO.drawWarLayer) AO.drawWarLayer(ctx, this);
  };

  Renderer.prototype._provPath = function (id) {
    if (this.provPaths.has(id)) return this.provPaths.get(id);
    var p = this.world.provinces[id - 1];
    if (!p) return null;
    var path = new Path2D();
    for (var i = 0; i < p.rings.length; i++) addRing(path, p.rings[i].coords);
    this.provPaths.set(id, path);
    return path;
  };

  /* 指北针：简单的双色指针 + 外圈，20px 就够认 */
  function drawCompass(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250,247,240,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(32,40,48,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    var t = r * 0.80, wd = r * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx, cy - t); ctx.lineTo(cx - wd, cy); ctx.lineTo(cx + wd, cy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(30,38,46,0.88)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy + t); ctx.lineTo(cx - wd, cy); ctx.lineTo(cx + wd, cy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(30,38,46,0.26)';
    ctx.fill();
  }

  /* 地图家具：比例尺（底部居中）+ 指北针（小地图上方） */
  Renderer.prototype._drawFurniture = function (ctx) {
    var dpr = this.dpr, s = this.cam.scale, m = this.world.meta;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* 比例尺：世界宽度按 6000 km 折算（和人口那套换算同一个假设） */
    var kmPerPx = 6000 / m.width;
    var cands = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    var km = 1000, barPx = 1000 * s / kmPerPx;
    for (var ci = 0; ci < cands.length; ci++) {
      var px = cands[ci] * s / kmPerPx;
      if (px >= 64 && px <= 150) { km = cands[ci]; barPx = px; break; }
    }
    barPx = Math.round(barPx);
    var bx = Math.round((this.cssW - barPx) / 2), by = this.cssH - 25, bh = 5;

    ctx.fillStyle = 'rgba(250,247,240,0.9)';
    ctx.fillRect(bx, by, barPx / 2, bh);
    ctx.fillStyle = 'rgba(32,40,48,0.86)';
    ctx.fillRect(bx + barPx / 2, by, barPx / 2, bh);
    ctx.strokeStyle = 'rgba(32,40,48,0.86)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, barPx - 1, bh - 1);

    var label = km + ' km';
    ctx.font = '600 11px -apple-system,"Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var tx = bx + barPx / 2, ty = by - 5;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = 'rgba(250,247,240,0.9)';
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = 'rgba(30,38,46,0.92)';
    ctx.fillText(label, tx, ty);

    if (this._mmRect) drawCompass(ctx, this._mmRect.x + this._mmRect.w - 15, this._mmRect.y - 26, 12);
  };

  Renderer.prototype._drawMinimap = function (ctx) {
    var mw = this.minimap.width, mh = this.minimap.height;
    var pad = 12;
    var mx = this.cssW - mw - pad, my = this.cssH - mh - pad;
    this._mmRect = { x: mx, y: my, w: mw, h: mh };
    var dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 底板
    ctx.fillStyle = 'rgba(24,28,32,0.55)';
    ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    ctx.drawImage(this.minimap, mx, my);

    // 视口框
    var m = this.world.meta;
    var kx = mw / m.width, ky = mh / m.height;
    var vw = this.cssW / this.cam.scale, vh = this.cssH / this.cam.scale;
    var vx = this.cam.x - vw / 2, vy = this.cam.y - vh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + vx * kx, my + vy * ky, vw * kx, vh * ky);
  };

  /* ---------------- 交互 ---------------- */
  Renderer.prototype._bind = function () {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      /* 全屏层（科技树 / 治理总览 / 编年史）开着时滚轮归它，地图不缩放 */
      if (AO.techTreeOpen && AO.techTreeOpen()) return;
      if (AO.govOpen && AO.govOpen()) return;
      if (AO.chronoIsOpen && AO.chronoIsOpen()) return;
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var before = self.toWorld(mx, my);
      var factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      self.cam.scale = AO.clamp(self.cam.scale * factor, 0.12, 24);
      var after = self.toWorld(mx, my);
      self.cam.x += before.x - after.x;
      self.cam.y += before.y - after.y;
      self.clampCam();
      self._needBase = true;
      self.requestDraw();
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      self._dragging = true;
      self._moved = 0;
      self._last = [e.clientX, e.clientY];
      canvas.style.cursor = 'grabbing';
    });

    root.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      var inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;

      if (self._dragging) {
        var dx = e.clientX - self._last[0], dy = e.clientY - self._last[1];
        self._last = [e.clientX, e.clientY];
        self._moved += Math.abs(dx) + Math.abs(dy);
        self.cam.x -= dx / self.cam.scale;
        self.cam.y -= dy / self.cam.scale;
        self.clampCam();
        self._needBase = true;
        self.requestDraw();
        return;
      }
      if (!inside || !self.world) return;

      var wp = self.toWorld(mx, my);
      var id = AO.pickProvince(self.world, wp.x, wp.y);

      /* 国家模式：整国作为一个热区，不追踪单个省 */
      if (self.mode === 'country') {
        var pr = id ? self.world.provinces[id - 1] : null;
        var cid = pr ? pr.owner : 0;
        if (cid !== self.hoverCountry) {
          self.hoverCountry = cid;
          self.hover = 0;
          canvas.style.cursor = cid ? 'pointer' : 'default';
          self.requestDraw();
          if (self.onHover) self.onHover(id);
        }
        return;
      }

      if (id !== self.hover) {
        self.hover = id;
        self.hoverCountry = 0;
        canvas.style.cursor = id ? (self.mode === 'paint' ? 'cell' : 'pointer') : 'default';
        self.requestDraw();
        if (self.onHover) self.onHover(id);
      }
    });

    root.addEventListener('mouseup', function (e) {
      if (!self._dragging) return;
      self._dragging = false;
      canvas.style.cursor = 'default';
      if (self._moved > 5) return;           // 拖动不算点击
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) return;
      var wp = self.toWorld(mx, my);
      var id = AO.pickProvince(self.world, wp.x, wp.y);
      if (!id || !self.world) return;
      if (self.mode === 'paint') self.paint(id);
      else if (self.mode === 'country') {
        var pp = self.world.provinces[id - 1];
        if (pp) self.selectCountry(pp.owner);
      } else self.select(id);
    });

    canvas.addEventListener('mouseleave', function () {
      if (self.hover) { self.hover = 0; self.requestDraw(); if (self.onHover) self.onHover(0); }
    });

    root.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      var step = 60 / self.cam.scale;
      if (e.key === '+' || e.key === '=') { self.cam.scale *= 1.25; self.clampCam(); self._needBase = true; self.requestDraw(); }
      else if (e.key === '-' || e.key === '_') { self.cam.scale /= 1.25; self.clampCam(); self._needBase = true; self.requestDraw(); }
      else if (e.key === 'f' || e.key === 'F') self.fit();
      else if (e.key === 'ArrowLeft') { self.cam.x -= step; self.clampCam(); self._needBase = true; self.requestDraw(); }
      else if (e.key === 'ArrowRight') { self.cam.x += step; self.clampCam(); self._needBase = true; self.requestDraw(); }
      else if (e.key === 'ArrowUp') { self.cam.y -= step; self.clampCam(); self._needBase = true; self.requestDraw(); }
      else if (e.key === 'ArrowDown') { self.cam.y += step; self.clampCam(); self._needBase = true; self.requestDraw(); }
    });

    root.addEventListener('resize', function () { self.resize(); self.clampCam(); });
    if (root.ResizeObserver) {
      var ro = new ResizeObserver(function () { self.resize(); self.clampCam(); });
      ro.observe(canvas.parentNode || canvas);
    }
  };

  Renderer.prototype.select = function (id) {
    this.selected = id;
    this.requestDraw();
    if (this.onSelect) this.onSelect(id);
  };

  /* 选中整个国家：省选中态清掉，免得两个高亮叠在一起 */
  Renderer.prototype.selectCountry = function (cid) {
    this.selectedCountry = cid || 0;
    this.selected = 0;
    this.requestDraw();
    if (this.onSelectCountry) this.onSelectCountry(this.selectedCountry);
  };

  /* 涂色：改归属 → 重算国家成员表 → 重建几何与配色 */
  Renderer.prototype.paint = function (id) {
    var w = this.world;
    var p = w.provinces[id - 1];
    if (!p) return;
    var target = this.paintOwner;
    if (!target || target > w.countries.length || p.owner === target) { this.select(id); return; }
    var nc = w.countries[target - 1];
    if (!nc) { this.select(id); return; }

    var old = w.countries[p.owner - 1];
    /* 不许把一国涂空：0 省的国家没有首都、没有人口，
     * 国家卡会显示一堆 0，自检里"无空国家"也会红。宁可挡住并说一句。 */
    if (old && old.provinces.length <= 1) {
      if (this.onPaintBlocked) this.onPaintBlocked(id, old.id);
      this.select(id);
      return;
    }

    if (old) {
      var ix = old.provinces.indexOf(id);
      if (ix >= 0) old.provinces.splice(ix, 1);
    }
    p.owner = target;
    if (nc.provinces.indexOf(id) < 0) nc.provinces.push(id);
    p.ownerName = nc.name;
    p.ownerColor = nc.color;

    /* 两个国家的派生量都要重算（人口 / 面积 / 地形 / 信仰 / 邻国 / 首都 / 资源汇总）。
     * 只搬 id 不重算的话，国家卡上的数字会一直停在改之前 ——
     * 自检里"各省人口之和 = 国人口"就是这么破的。 */
    if (AO.recomputeCountry) {
      AO.recomputeCountry(w, nc);
      if (old) AO.recomputeCountry(w, old);
    }

    this.provPaths.delete(id);
    this.rebuild();
    this.select(id);
    /* 通知 UI 层：治理面板的省列表、科技树的国名都得跟着刷 */
    if (this.onPaint) this.onPaint(id, old ? old.id : 0, target);
  };

})(typeof window !== 'undefined' ? window : globalThis);
