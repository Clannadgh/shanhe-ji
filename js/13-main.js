/* =============================================================
 * 13-main.js —— 管线编排
 * 01 高程 → 02 陆地掩膜 → 03 种子 → 04 测地 Voronoi → 05 几何
 *   → 06 邻接 → 07 国家 → 08 命名 → 组装世界对象
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  var DEFAULTS = {
    seed: 'aoh-2026',
    width: 2400,
    height: 1200,
    provinces: 1100,
    countries: 64,
    landRatio: 0.38,
    continentScale: 620,
    detailScale: 105,
    detailAmp: 0.62,
    edgeFalloff: 0.55,
    /* 地图四周的留白（占短边的比例）：这一圈一定是海。
     * 否则大陆会被画布边界硬切出一条直边，还会长出贴边的细碎地块。
     * 世界是 2:1、屏幕是 16:10，fit 之后左右只剩 29px —— 所以横向特别紧，
     * 留白按短边算（0.06×1200 = 72px），屏幕上约 41px 的海面。 */
    edgeSea: 0.06,
    /* 首都离地图边界的最小距离（占短边的比例）。
     * 最远点采样天生爱挑边界上的点，于是会有国家贴着画布边缘生成 ——
     * 那儿既容易被面板按钮压住、又难缩放对准，点选体验很差。 */
    edgeMargin: 0.09,
    openRadius: 2,
    lloyd: 2,
    simplifyEps: 0.52
  };

  AO.DEFAULTS = DEFAULTS;

  /* ---------- 山体阴影参数 ----------
   * 集中放在这里，test/hill.js 直接改 AO.HILL 再重算就能做参数扫描。
   *
   * 光源方位角 az 以正北为 0°、顺时针增大（制图学惯例）：
   *   315° = 西北光（北半球地形图的标准打光，山体南坡亮、北坡暗）
   *   225° = 西南光
   * 高度角 alt 固定 45°：角太低阴影拉长（像阴天航拍），太高则没有立体感。
   *
   * base 是"中性值"—— 这张灰度图叠上去时，base 处的像素颜色不变。
   * overlay / soft-light 的中性是 128，multiply 的中性是 255（白）。
   * gain 把 (shade - sin(alt)) 放大到 0~255 的可见区间。
   * softClip 是软拐点：没有它，最陡的沟壁会直接撞到 0 变成死黑，
   * 在世界视图里表现为一层"盐粒"（EX=40 时约 3.4% 的陆地像素）。 */
  AO.HILL = {
    /* EX 40 不是随手取的：EX=150 时平均坡度 58°、43% 的陆地像素撞到 0，
     * 山体只剩大团饱和明暗、细纹理全被冲掉 —— 这正是原先"肉"的来源。
     * 实测 100 / 150 / 220 三档分别在 35% / 43% / 48% 处压黑，都在饱和区；
     * 40 对应平均坡度 29°，山脊与支脉才留得住。 */
    ex: 40,                // 垂直夸张
    az: 315,               // 光源方位角（度）：西北光，制图惯例
    alt: 45,               // 光源高度角（度）
    base: 128,             // 中性灰度
    gain: 300,             // 明暗增益
    softClip: 62,          // 软拐点：|Δ| 超过它之后斜率降到 0.3，阴影不死黑
    blend: 'overlay',      // 叠加混合方式
    alpha: 0.80,           // 叠加不透明度
    offshore: 0.65,        // 离岸阴影强度 0~1，0 = 关
    offshoreRadius: 12     // 离岸阴影最大进深（世界像素）
  };

  /* 山体阴影灰度场。
   * 陆地：原始高程的坡度 → 明暗；海面：中性值（保证不叠阴影处颜色不变）。
   *
   * 离岸阴影：先用海底坡度算过一版，出来是一块块污渍 —— 水下坡面又碎又平，
   * 和岸线形状没关系。改成方向性投影：从贴着水的陆地点向背光方向投一条
   * 逐渐变淡的影线，只有背光侧的海面会接到影线。阴影严格贴着岸线走，
   * 像墨迹压边，把大陆边缘压住。 */
  AO.buildHillshade = function (elev, label, width, height, cfg) {
    cfg = cfg || AO.HILL;
    var n = width * height;
    var out = new Uint8ClampedArray(n);
    var base = cfg.base === undefined ? 128 : cfg.base;
    var ex = cfg.ex, gain = cfg.gain;
    var alt = (cfg.alt === undefined ? 45 : cfg.alt) * Math.PI / 180;
    var az = (cfg.az === undefined ? 315 : cfg.az) * Math.PI / 180;
    var ca = Math.cos(alt);
    /* 光向量：x 向东、y 向南（屏幕坐标）、z 向上。
     * az=315 → (-0.5, -0.5, 0.7071)：光从西北方来。 */
    var LX = Math.sin(az) * ca, LY = -Math.cos(az) * ca, LZ = Math.sin(alt);
    var off = cfg.offshore || 0;
    var shR = cfg.offshoreRadius || 9;
    var knee = cfg.softClip === undefined ? 0 : cfg.softClip;
    // 阴影落在背光侧：从像素朝光源方向回退即可命中陆地
    var hl = Math.sqrt(LX * LX + LY * LY) || 1;
    var sx = LX / hl, sy = LY / hl;

    var lo = 255, hi = 0, sum = 0, landN = 0, satHi = 0, satLo = 0;
    var hist = new Uint32Array(16);

    for (var y = 0; y < height; y++) {
      var row = y * width;
      var yu = y > 0 ? y - 1 : y, yd = y + 1 < height ? y + 1 : y;
      for (var x = 0; x < width; x++) {
        var xl = x > 0 ? x - 1 : x, xr = x + 1 < width ? x + 1 : x;
        var i = row + x;
        if (label[i] === 0) { out[i] = base; continue; }

        var dzdx = (elev[row + xr] - elev[row + xl]) * 0.5 * ex;
        var dzdy = (elev[yd * width + x] - elev[yu * width + x]) * 0.5 * ex;
        var nl = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        var shade = (-dzdx * LX - dzdy * LY + LZ) * nl;

        var t = (shade - LZ) * gain;
        /* 软拐点：|t| 超过 knee 之后斜率降到 0.3，把最陡的沟壁压成深灰而不是纯黑。
         * 硬裁剪会让阴影变成一块块死黑，在世界视图里就是一片盐粒；
         * 软拐点保留了阴影内部的层次，观感更接近印刷地形图的"淡墨"。 */
        if (knee > 0) {
          var at2 = t < 0 ? -t : t;
          if (at2 > knee) {
            at2 = knee + (at2 - knee) * 0.3;
            if (at2 > 127) at2 = 127;
          }
          t = t < 0 ? -at2 : at2;
        }
        var v = base + t;
        if (v < 0) { v = 0; satLo++; } else if (v > 255) { v = 255; satHi++; }
        out[i] = v;
        var q = out[i];            // 取回 Uint8ClampedArray 舍入后的真值

        landN++;
        sum += q;
        if (q < lo) lo = q;
        if (q > hi) hi = q;
        hist[q >> 4]++;
      }
    }

    /* 离岸阴影：从"贴着水"的陆地点往背光方向投一条影线。
     * 只从海岸像素出发，所以代价只跟海岸线长度有关（不是跟海面面积），
     * 2400×1200 下约 3ms。同一片水可能被多条影线命中，取最深的那条。 */
    if (off > 0) {
      var dx2 = -sx, dy2 = -sy;
      for (var sy2 = 0; sy2 < height; sy2++) {
        var row2 = sy2 * width;
        for (var sx2 = 0; sx2 < width; sx2++) {
          if (!label[row2 + sx2]) continue;
          var ax = Math.round(sx2 + dx2), ay = Math.round(sy2 + dy2);
          if (ax < 0 || ay < 0 || ax >= width || ay >= height) continue;
          if (label[ay * width + ax]) continue;             // 不是岸：影线落不到水里
          for (var st = 1; st <= shR; st++) {
            var px = Math.round(sx2 + dx2 * st), py = Math.round(sy2 + dy2 * st);
            if (px < 0 || py < 0 || px >= width || py >= height) break;
            var j = py * width + px;
            if (label[j]) break;                              // 撞上别的陆地
            var f = 1 - (st - 1) / shR;
            var sv = base - off * 62 * f * f;
            if (sv < out[j]) out[j] = sv;
          }
        }
      }
    }

    return {
      width: width, height: height, data: out, cfg: cfg,
      stats: {
        min: landN ? lo : base, max: landN ? hi : base,
        mean: landN ? sum / landN : base,
        satHi: satHi, satLo: satLo, land: landN,
        // 0~255 分 16 档的分布，用来判断对比度是否集中在中灰
        hist: Array.prototype.slice.call(hist)
      }
    };
  };

  AO.generate = function (options) {
    var opt = {};
    for (var k in DEFAULTS) opt[k] = DEFAULTS[k];
    if (options) for (var k2 in options) if (options[k2] !== undefined && options[k2] !== null) opt[k2] = options[k2];

    var seedText = String(opt.seed);
    var seedInt = AO.hashString(seedText);
    var width = opt.width | 0, height = opt.height | 0;

    var t0 = AO.now();
    var marks = {};

    AO.assertNoiseTable();

    /* 世界尺寸不固定：大陆波长 / 细节波长按宽度等比放大，
     * 这样 1600 宽和 3200 宽看到的是"同一个世界观的放大版"，
     * 而不是"同样的噪声铺到更大的画布上"。 */
    var kScale = width / 1600;

    /* ---------- 1. 高程场 + 陆地掩膜 ---------- */
    var terr = AO.buildTerrain({
      width: width, height: height, seed: seedInt,
      landRatio: opt.landRatio,
      continentScale: opt.continentScale * kScale,
      detailScale: opt.detailScale * kScale,
      detailAmp: opt.detailAmp,
      edgeFalloff: opt.edgeFalloff,
      edgeSea: opt.edgeSea === undefined ? 0 : Math.min(width, height) * opt.edgeSea,
      openRadius: opt.openRadius
    });
    marks.terrain = AO.now() - t0;

    /* ---------- 2. 河网（填洼 + D8 汇流） ---------- */
    var tR = AO.now();
    var rng = new AO.RNG(seedInt);
    var riv = AO.buildRivers(terr, { rng: rng.fork('rivers') });
    marks.rivers = AO.now() - tR;


    /* ---------- 2. 种子布点（含 2 轮测地 Lloyd） ---------- */
    var t1 = AO.now();
    var seedInfo = AO.placeSeeds(terr, opt.provinces, rng.fork('seed-placement'), opt.lloyd);
    marks.seeds = AO.now() - t1;

    /* ---------- 3. 测地 Voronoi 切分 ---------- */
    var t2 = AO.now();
    var scr = AO.scratchBufs(width * height);
    var part = AO.voronoiRaster(terr.land, width, height, seedInfo.seeds, scr.f2);
    var count = seedInfo.seeds.length;
    marks.partition = AO.now() - t2;

    /* ---------- 4. 邻接表（直接扫栅格，天然对称） ---------- */
    var t3 = AO.now();
    var adj = AO.buildAdjacency(part.label, width, height, count);
    var stats = AO.provinceStats(part.label, width, height, count, terr.elev);
    marks.adjacency = AO.now() - t3;

    /* ---------- 5. 几何提取 ----------
     * 顺便把海面按"比海平面低多少"分成 3 段，用 32001~32003 这些伪标签
     * 一起丢进矢量化：这样大陆架是**跟着地形走的不规则等深线**，
     * 而不是沿岸等宽外扩的光晕（那种看着像描边，不像海）。 */
    var t4 = AO.now();
    var n = width * height;
    var geoLabels = new Uint16Array(n);
    var bandThr = [0.15, 0.062, 0.020];      // 深海 → 浅滩
    for (var gi = 0; gi < n; gi++) {
      var gl = part.label[gi];
      if (gl) { geoLabels[gi] = gl; continue; }
      var dd = terr.seaLevel - terr.elev[gi];
      geoLabels[gi] = dd < bandThr[2] ? 32003 : dd < bandThr[1] ? 32002 : dd < bandThr[0] ? 32001 : 0;
    }
    var geo = AO.extractGeometry(geoLabels, width, height, { simplifyEps: opt.simplifyEps });
    var seaBandRings = [geo.rings.get(32001) || [], geo.rings.get(32002) || [], geo.rings.get(32003) || []];
    marks.geometry = AO.now() - t4;

    /* ---------- 5b. 地形分带（地形视图用）----------
     * 用**平滑后**的高程 + 分位数切分：直接拿原始高程切，会被细节噪声
     * 割成一地碎白点；分位数则保证低地/山地/高山各占合理比例，
     * 山脊也因此连成片而不是棉花团。 */
    var tB = AO.now();
    var sElev = riv.smooth || terr.elev;
    /* 全程在半分辨率上做：地形带本来就是大块区域，1/2 采样 + 半径 6 的模糊
     * 等价于全分辨率半径 12，扫描量却只有 1/4。（超大世界省 ~400ms） */
    var hw2 = Math.max(1, width >> 1), hh2 = Math.max(1, height >> 1);
    var eHalf = scr.f5;
    for (var by2 = 0; by2 < hh2; by2++) {
      var srow = (by2 * 2) * width;
      for (var bx2 = 0; bx2 < hw2; bx2++) {
        eHalf[by2 * hw2 + bx2] = sElev[srow + bx2 * 2];
      }
    }
    // 两道 r=6 箱式模糊，抹掉细节噪声，只留山脉走向
    AO.boxBlur(eHalf, hw2, hh2, 6, scr.f3, eHalf);
    AO.boxBlur(eHalf, hw2, hh2, 6, scr.f3, eHalf);

    // 分位数切分：保证低地 / 丘陵 / 山地 / 高山 各占合理比例
    var landH = 0, tMax = -Infinity, tMin = Infinity;
    for (by2 = 0; by2 < hh2; by2++) {
      for (bx2 = 0; bx2 < hw2; bx2++) {
        if (!part.label[(by2 * 2) * width + bx2 * 2]) continue;
        var ev = eHalf[by2 * hw2 + bx2];
        landH++;
        if (ev > tMax) tMax = ev;
        if (ev < tMin) tMin = ev;
      }
    }
    var HB = 1024;
    var hScale = (HB - 1) / Math.max(1e-6, tMax - tMin);
    var hist = new Int32Array(HB);
    for (by2 = 0; by2 < hh2; by2++) {
      for (bx2 = 0; bx2 < hw2; bx2++) {
        if (!part.label[(by2 * 2) * width + bx2 * 2]) continue;
        var hb = ((eHalf[by2 * hw2 + bx2] - tMin) * hScale) | 0;
        hist[hb < 0 ? 0 : (hb >= HB ? HB - 1 : hb)]++;
      }
    }
    var bandCut = [], qAcc = 0, qk = 0, qs = [0.30, 0.58, 0.82, 0.94];
    for (var gi2 = 0; gi2 < HB; gi2++) {
      qAcc += hist[gi2];
      while (qk < 4 && qAcc >= landH * qs[qk]) { bandCut.push(gi2 / hScale + tMin); qk++; }
    }
    while (bandCut.length < 4) bandCut.push(tMax);

    var bandHalf = new Uint16Array(hw2 * hh2);
    for (by2 = 0; by2 < hh2; by2++) {
      for (bx2 = 0; bx2 < hw2; bx2++) {
        if (!part.label[(by2 * 2) * width + bx2 * 2]) continue;
        var tr = eHalf[by2 * hw2 + bx2];
        bandHalf[by2 * hw2 + bx2] = 33001 +
          (tr < bandCut[0] ? 0 : tr < bandCut[1] ? 1 : tr < bandCut[2] ? 2 : tr < bandCut[3] ? 3 : 4);
      }
    }
    var geoB = AO.extractGeometry(bandHalf, hw2, hh2, { simplifyEps: 0.6 });
    var terrainBands = [];
    for (var bi = 0; bi < 5; bi++) {
      var br = geoB.rings.get(33001 + bi) || [];
      for (var bi2 = 0; bi2 < br.length; bi2++) {
        var cc2 = br[bi2].coords;
        for (var ci2 = 0; ci2 < cc2.length; ci2++) cc2[ci2] *= 2;   // 放大回全分辨率
      }
      terrainBands.push(br);
    }
    marks.terrainBands = AO.now() - tB;

    /* ---------- 5c. 山体阴影（地形视图用） ----------
     * 高程分带本身是"平"的：每座山都是一圈圈同心环，像等高线模型。
     * 叠一层 45° 光源的明暗，山才立得起来。
     * 必须用**原始高程**算坡度 —— 平滑过的高程只剩大缓坡，阴影会糊成
     * 一团云。原始高程里那层 62px 的细节，正是"地形质感"的来源。 */
    var tH = AO.now();
    var hs = AO.buildHillshade(terr.elev, part.label, width, height, AO.HILL);
    marks.hillshade = AO.now() - tH;

    /* ---------- 6. 国家划分 ---------- */
    var t5 = AO.now();
    var pol = AO.buildCountries({
      count: count,
      neighbors: adj.neighbors,
      stats: stats,
      target: opt.countries,
      rng: rng.fork('countries'),
      bounds: { w: width, h: height },
      edge: Math.round(Math.min(width, height) * (opt.edgeMargin === undefined ? 0.07 : opt.edgeMargin))
    });
    marks.politics = AO.now() - t5;

    /* ---------- 7. 沿海标记 + 海岸/河流画像 + 湿度 + 地形 ----------
     * 除了"是不是沿海省"，这里还顺手量三件给资源层用的事：
     *   cdirs —— 海出现在几个方向（每 22.5° 一个扇区，相邻扇区并成一段）：
     *            一面海 = 普通海岸，两面 = 半岛/地峡，三面以上 = 岬角
     *   cmean —— 沿岸陆地点的高程均值：高 = 陡岸，站不住码头
     *   rlen  —— 省内河道总长（按水量加权）；mouth = 河口在省内
     * 全部只读栅格，不改任何随机数，世界指纹不变。 */
    var i;
    var coastal = new Uint8Array(count + 1);
    var cdirs = new Uint8Array(count + 1);
    var cbins = new Uint16Array((count + 1) * 16);      // 16 个 22.5° 扇区

    var markSea = function (l, sx, sy) {
      var st0 = stats[l];
      var cx0 = st0 && st0.area ? st0.centroid[0] : sx, cy0 = st0 && st0.area ? st0.centroid[1] : sy;
      var ang = Math.atan2(sy - cy0, sx - cx0);
      var bin = Math.round((ang + Math.PI) / (Math.PI / 8)) & 15;
      cbins[l * 16 + bin]++;
    };

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var idx = y * width + x, l = part.label[idx];
        if (!l) continue;
        if (x > 0 && !part.label[idx - 1]) markSea(l, x - 1, y);
        if (x + 1 < width && !part.label[idx + 1]) markSea(l, x + 1, y);
        if (y > 0 && !part.label[idx - width]) markSea(l, x, y - 1);
        if (y + 1 < height && !part.label[idx + width]) markSea(l, x, y + 1);
        if ((x > 0 && !part.label[idx - 1]) || (x + 1 < width && !part.label[idx + 1]) ||
            (y > 0 && !part.label[idx - width]) || (y + 1 < height && !part.label[idx + width])) {
          coastal[l] = 1;
        }
      }
    }

    /* 扇区 → "几面临海"：占比 ≥8% 的扇区才算一面，相邻扇区并成一段 */
    for (i = 1; i <= count; i++) {
      var totB = 0, b;
      for (b = 0; b < 16; b++) totB += cbins[i * 16 + b];
      if (!totB) continue;
      var on = new Array(16);
      for (b = 0; b < 16; b++) on[b] = cbins[i * 16 + b] >= totB * 0.08;
      var segs = 0, prev = on[15];
      for (b = 0; b < 16; b++) { if (on[b] && !prev) segs++; prev = on[b]; }
      cdirs[i] = Math.min(4, Math.max(1, segs));
    }

    /* 河流：按折线逐段累加到所在省，顺便找河口（离海 1px 以内的河点） */
    var rlen = new Float32Array(count + 1);
    var mouth = new Uint8Array(count + 1);
    (function () {
      var list = riv.polylines || [];
      for (var ri = 0; ri < list.length; ri++) {
        var pts = list[ri].pts, wgt = 1 + (list[ri].cls || 0) * 0.5;
        for (var pi = 0; pi + 3 < pts.length; pi += 2) {
          var ax = pts[pi], ay = pts[pi + 1], bx = pts[pi + 2], by = pts[pi + 3];
          var mxp = (ax + bx) * 0.5, myp = (ay + by) * 0.5;
          var li = part.label[(myp | 0) * width + (mxp | 0)];
          if (!li) continue;
          rlen[li] += Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) * wgt;
          if (!mouth[li]) {
            /* 4 邻域里只要有海，就认定这条河在这省入海 */
            var xi = mxp | 0, yi = myp | 0;
            if ((xi > 0 && !part.label[yi * width + xi - 1]) ||
                (xi + 1 < width && !part.label[yi * width + xi + 1]) ||
                (yi > 0 && !part.label[(yi - 1) * width + xi]) ||
                (yi + 1 < height && !part.label[(yi + 1) * width + xi])) mouth[li] = 1;
          }
        }
      }
    })();

    var coastInfo = {
      dirs: cdirs,
      rlen: rlen,
      mouth: mouth,
      seaLevel: terr.seaLevel
    };

    // 高程排名（0=最低，1=最高）：用排名而不是绝对值，保证地形谱稳定
    var order = [];
    for (i = 1; i <= count; i++) if (stats[i] && stats[i].area > 0) order.push(i);
    order.sort(function (a, b) { return stats[a].elevMean - stats[b].elevMean; });
    var rankOf = new Float32Array(count + 1);
    for (var rk = 0; rk < order.length; rk++) {
      rankOf[order[rk]] = order.length > 1 ? rk / (order.length - 1) : 0.5;
    }

    var moist = AO.makeNoise((seedInt ^ 0x51ED270B) >>> 0);
    var terrainOf = new Array(count + 1);
    for (i = 1; i <= count; i++) {
      var st = stats[i];
      if (!st || !st.area) { terrainOf[i] = 'plains'; continue; }
      var mx = st.centroid[0] / width, my = st.centroid[1] / height;
      var m = moist.fbm(mx * 2.6 + 3.1, my * 2.6 - 1.7, 3);
      m = AO.clamp((m + 1) * 0.5, 0, 1);
      var latAbs = Math.abs(my - 0.5) * 2;
      var cold = latAbs > 0.80;                 // 只在地图最上 / 最下 10% 出现冻原
      terrainOf[i] = AO.classifyTerrain(rankOf[i], m, cold, !!coastal[i]);
    }

    /* ---------- 8. 命名 ---------- */
    var t6 = AO.now();
    var ng = new AO.NameGen(rng.fork('names'));
    var countries = [];
    for (i = 0; i < pol.countries.length; i++) {
      var c = pol.countries[i];
      var nm = ng.country();
      c.name = nm.name;
      c.name_en = nm.name_en;
      c.gov = nm.gov;                 // 政体 key：08b 用它定政体 / 头衔 / 头饰
      c.provinces = [];
      countries.push(c);
    }

    var provinces = new Array(count);
    for (i = 1; i <= count; i++) {
      var st2 = stats[i];
      if (!st2 || !st2.area) continue;
      var pn = ng.province(terrainOf[i], !!coastal[i]);
      var own = pol.owner[i] || 1;
      var cobj = countries[own - 1];
      provinces[i - 1] = {
        id: i,
        name: pn.name,
        name_en: pn.name_en,
        owner: own,
        ownerName: cobj ? cobj.name : '',
        ownerColor: cobj ? cobj.color : '#999999',
        terrain: terrainOf[i],
        area: st2.area,
        centroid: st2.centroid,
        elevMean: st2.elevMean,
        neighbors: adj.neighbors[i] ? adj.neighbors[i].slice() : [],
        rings: geo.rings.get(i) || []
      };
      if (cobj) cobj.provinces.push(i);
    }
    // 成员表排序，方便比对
    for (i = 0; i < countries.length; i++) countries[i].provinces.sort(function (a, b) { return a - b; });

    /* ---------- 8b. 国家资料（政体 / 信仰 / 人口 / 领导人 / 头像） ----------
     * 单独一条 rng 支流：加这一段不会位移前面任何随机数，
     * 同一个 seed 生成的大陆形状和以前完全一致。 */
    var tS = AO.now();
    AO.buildSociety({
      countries: countries,
      provinces: provinces,
      rng: rng.fork('society'),
      seedInt: seedInt,
      width: width
    });
    marks.society = AO.now() - tS;

    /* ---------- 8c. 资源发牌（省挂了 resource / 国家汇总 resources） ----------
     * 独立支流：fork 只做哈希派生、不消耗父流，所以加这一段不会位移
     * 前面任何随机数 —— 大陆形状、国家、名字、世界指纹全部保持不变。
     * 资源是新增字段，不进 worldHash。 */
    var tRs = AO.now();
    AO.assignResources({ provinces: provinces, countries: countries, coast: coastInfo }, rng.fork('resources'));
    marks.resources = AO.now() - tRs;

    /* ---------- 9. 环方向规范化 ----------
     * 外环正向、洞反向。渲染时用 nonzero 填充整国路径：
     * 同国相邻两省共享的那条边在两侧方向相反、绕数相加而不是相消，
     * 因此不会出现 evenodd 那样的发丝接缝。 */
    var revCount = 0;
    for (i = 0; i < provinces.length; i++) {
      var pv = provinces[i];
      if (!pv) continue;
      var polys = AO.buildPolygons(pv.rings);
      pv.polygons = polys;
      for (var pi = 0; pi < polys.length; pi++) {
        if (orientRing(polys[pi].outer, 1)) revCount++;
        for (var hi = 0; hi < polys[pi].holes.length; hi++) {
          if (orientRing(polys[pi].holes[hi], -1)) revCount++;
        }
      }
    }

    function orientRing(ring, sign) {
      if (ring.area * sign >= 0) return false;
      var c = ring.coords;
      var n = c.length >> 1;
      for (var a = 0, b = n - 1; a < b; a++, b--) {
        var t0 = c[a * 2], t1 = c[a * 2 + 1];
        c[a * 2] = c[b * 2]; c[a * 2 + 1] = c[b * 2 + 1];
        c[b * 2] = t0; c[b * 2 + 1] = t1;
      }
      ring.area = -ring.area;
      return true;
    }
    marks.naming = AO.now() - t6;

    var totalMs = AO.now() - t0;
    marks.total = totalMs;

    return {
      meta: {
        seed: seedText,
        seedInt: seedInt,
        width: width,
        height: height,
        provinceCount: count,
        countryCount: countries.length,
        landRatio: terr.landRatio,
        landPixels: terr.landCount,
        seaLevel: terr.seaLevel,
        repairedPixels: part.repaired,
        unreachedPixels: part.unreached,
        riverCount: riv.polylines.length,
      riverPoints: riv.pointCount,
      segmentCount: geo.segmentCount,
        runCount: geo.runCount,
        adjacencyEdges: adj.edges.length,
        timing: marks
      },
      labels: part.label,
      land: terr.land,
      provinces: provinces,
      countries: countries,
      adjacency: adj.edges,
      seaBandRings: seaBandRings,
      rivers: riv.polylines,
      terrainBands: terrainBands,
      /* 整个对象（含 cfg / stats）一起交给渲染层：
       * canvas 的中性值是按 blend 定的，混合方式必须跟灰度场配套，
       * 各自取默认值会错配（alpha 0.85 vs 0.80 这种差异肉眼能看出来）。 */
      hillshade: hs,
      stats: stats
    };
  };

  /* 命中检测：直接查栅格标签。
   * 不用多边形内点判断 —— DP 简化会在边界外留约 0.35px 的死区，
   * 用多边形判定会漏点击/串到邻省。
   * 坐标约定：像素 (x,y) 覆盖 [x,x+1)×[y,y+1)，中心 (x+0.5,y+0.5)，
   * 与陆地掩膜完全一致，不会整体偏移半像素。 */
  AO.pickProvince = function (world, wx, wy) {
    var x = Math.floor(wx), y = Math.floor(wy);
    var W = world.meta.width, H = world.meta.height;
    if (!(x >= 0 && y >= 0 && x < W && y < H)) return 0;
    return world.labels[y * W + x];
  };

})(typeof window !== 'undefined' ? window : globalThis);
