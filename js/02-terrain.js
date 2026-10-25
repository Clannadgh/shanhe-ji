/* =============================================================
 * 02-terrain.js —— 高程场 / 大陆骨架 / 陆地掩膜
 *
 * 管线顺序（严格）：
 *   1) 低频噪声 → 大陆骨架（决定"哪里是大块陆地"）
 *   2) 细节噪声（Simplex + 域扭曲）只在骨架为正处起作用
 *   3) 直方图定海平面 → 3x3 平滑 → 形态学开运算 → 去碎岛
 *
 * 关于"为什么细节不能直接参与阈值判定"：
 *   如果骨架和细节是两个幅度相当的独立场，二者相加后在阈值附近会
 *   反复翻转，陆地碎成迷宫/群岛，省份退化成链状（平均邻接度掉到 2 左右）。
 *   正确做法是：骨架幅度远大于细节，且细节只在骨架已经明确是陆地的
 *   地方叠加 —— 于是细节只负责"啃海岸"，不负责"决定海陆"。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* 直方图取阈值：让 elev > thr 的像素比例 ≈ target */
  function percentileThreshold(arr, target) {
    var n = arr.length, i;
    var min = Infinity, max = -Infinity;
    for (i = 0; i < n; i++) {
      var v = arr[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!(max > min)) return min;
    var BINS = 4096;
    var hist = new Float64Array(BINS);
    var sc = (BINS - 1) / (max - min);
    for (i = 0; i < n; i++) {
      var b = ((arr[i] - min) * sc) | 0;
      if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
      hist[b]++;
    }
    var need = n * target, acc = 0, pick = BINS - 1;
    for (i = BINS - 1; i >= 0; i--) {
      acc += hist[i];
      if (acc >= need) { pick = i; break; }
    }
    return min + pick / sc;
  }
  AO.percentileThreshold = percentileThreshold;

  /* -------------------------------------------------------------
   * 主入口
   * ----------------------------------------------------------- */
  AO.buildTerrain = function (o) {
    var t0 = AO.now();
    var width = o.width, height = o.height, n = width * height;
    var nz = AO.makeNoise((o.seed ^ 0x9E3779B9) >>> 0);

    var landRatio = o.landRatio === undefined ? 0.33 : o.landRatio;
    var contScale = o.continentScale || 780;    // 骨架波长（像素）
    var detScale = o.detailScale || 62;         // 细节点波长（像素）
    var detAmp = o.detailAmp === undefined ? 0.26 : o.detailAmp;
    var warpAmp = o.warpAmp === undefined ? 0.18 : o.warpAmp;
    var edgeF = o.edgeFalloff === undefined ? 0.95 : o.edgeFalloff;
    /* 边缘留白（像素）：距画布边界这么近的地方一律压成海。
     * 原来的椭圆衰减只是"大概率是海"，噪声一推还是会有陆地顶到边界上，
     * 被画布硬切出一条直边；这种贴边地块又细又难点，还会长出贴边的国家。 */
    var mSea = o.edgeSea === undefined ? 0 : o.edgeSea;

    /* 两级分辨率：
     *   大陆骨架在 1/4 分辨率上算（波长 1000+ px，1/4 采样绰绰有余），
     *   细节在 1/2 分辨率上算，最后放到全分辨率。
     * 骨架从 1/2 降到 1/4，噪声调用直接少了 4 倍 —— 这一层占的算力最多。 */
    var HS = 2, BS = 4;
    var hw = Math.ceil(width / HS), hh = Math.ceil(height / HS);
    var bw = Math.ceil(width / BS), bh = Math.ceil(height / BS);
    var skf = 1 / contScale;
    var df = 1 / detScale;
    var hx, hy, idx, x, y;

    var mark = { skeleton: 0 }, mprev = AO.now();
    function tick(k2) { var t2 = AO.now(); mark[k2] = Math.round(t2 - mprev); mprev = t2; }

    /* ---------- 第一层：大陆骨架（低频，幅度大） ---------- */
    var sbT = AO.scratchBufs(n);
    var coarse = sbT.f4.length >= bw * bh ? sbT.f4 : new Float32Array(bw * bh);
    for (hy = 0; hy < bh; hy++) {
      y = (hy + 0.5) * BS;
      var ny = y * skf;
      for (hx = 0; hx < bw; hx++) {
        idx = hy * bw + hx;
        x = (hx + 0.5) * BS;
        var nx = x * skf;
        // 低频域扭曲：把噪声固有的圆滑团块揉成大陆/海盆
        var qx = nx + warpAmp * nz.noise2(nx * 2.2 + 11.3, ny * 2.2 - 4.7);
        var qy = ny + warpAmp * nz.noise2(nx * 2.2 - 8.1, ny * 2.2 + 6.2);
        var s = nz.fbm(qx, qy, 4);
        // 边缘衰减：四边大概率是海，避免大陆被硬切成方块
        var fx = (x / width) * 2 - 1, fy = (y / height) * 2 - 1;
        var d = Math.sqrt(fx * fx * 0.80 + fy * fy);
        var e = s - AO.smoothstep(0.55, 1.10, d) * edgeF;
        if (mSea > 0) {
          // 留白：进入边界的 mSea 像素内曲线式压到底，保证这里一定是海
          var wE = AO.smoothstep(0, mSea, Math.min(x, width - x)) *
                   AO.smoothstep(0, mSea, Math.min(y, height - y));
          e -= (1 - wE) * 1.7;
        }
        coarse[idx] = e;
      }
    }
    tick('skeleton');

    var v = AO.upsampleBilinear(coarse, bw, bh, hw, hh, BS / HS, sbT.f3);
    tick('upsample0');

    var thr0 = percentileThreshold(coarse, landRatio);
    tick('thr0');
    var gateLo = thr0 - 0.06, gateHi = thr0 + 0.34;

    /* ---------- 第二层：细节（高频，幅度小，只在骨架明确是陆地处） ---------- */
    for (hy = 0; hy < hh; hy++) {
      y = (hy + 0.5) * HS;
      var ny2 = y * df;
      for (hx = 0; hx < hw; hx++) {
        idx = hy * hw + hx;
        var s0 = v[idx];
        if (s0 <= gateLo) continue;                   // 深海：不加细节 → 不可能凭空冒岛
        x = (hx + 0.5) * HS;
        var nx2 = x * df;
        var wg = AO.smoothstep(gateLo, gateHi, s0);
        // 细节自身的域扭曲：海岸被"啃"出海湾、岬角、小半岛
        var ax = nx2 + 0.10 * nz.noise2(nx2 * 0.42 + 41.7, ny2 * 0.42 - 12.9);
        var ay = ny2 + 0.10 * nz.noise2(nx2 * 0.42 - 27.3, ny2 * 0.42 + 33.1);
        v[idx] = s0 + detAmp * wg * nz.fbm(ax, ay, 3);
      }
    }
    tick('detail');
    var elev = AO.upsampleBilinear(v, hw, hh, width, height, HS, sbT.f1);
    tick('upsample');

    /* ---------- 直方图定海平面 ---------- */
    var thr = percentileThreshold(elev, landRatio);
    var land = new Uint8Array(n);
    var i;
    for (i = 0; i < n; i++) land[i] = elev[i] > thr ? 1 : 0;

    /* ---------- 掩膜清理 ---------- */
    var sb = AO.scratchBufs(n);
    tick('hist+mask');
    land = AO.majority3x3(land, width, height, sb.u1);
    tick('majority');          // 3x3 平滑，去椒盐
    var r = o.openRadius === undefined ? 2 : o.openRadius;
    if (r > 0) {
      land = AO.morphSquare(land, width, height, r, false, sb.u2, sb.u3); // 腐蚀：断开细长地峡
      land = AO.morphSquare(land, width, height, r, true, sb.u2, sb.u3);  // 膨胀：恢复主体轮廓
      tick('morph');
    }

    /* ---------- 填掉细小的"噪点湖"（只有几像素宽的水洼） ----------
     * 留着它们，政治视图上会变成一堆扎眼的蓝点。真正的大湖保留。
     * 顺序有讲究：先填洞、后去碎岛，这样最后那次陆地连通域标记
     * 就是"最终"的标签图，不需要为了去碎岛再跑一遍全图。 */
    var minHole = o.minHole === undefined ? Math.max(10, Math.round(n * 0.00002)) : o.minHole;
    if (minHole > 0) {
      var sea = sb.u2;
      for (i = 0; i < n; i++) sea[i] = land[i] ? 0 : 1;
      var sc = AO.labelComponents(sea, width, height, sb.i1, sb.i2);
      var touchesBorder = new Uint8Array(sc.count + 1);
      for (x = 0; x < width; x++) {
        touchesBorder[sc.comp[x]] = 1;
        touchesBorder[sc.comp[(height - 1) * width + x]] = 1;
      }
      for (y = 0; y < height; y++) {
        touchesBorder[sc.comp[y * width]] = 1;
        touchesBorder[sc.comp[y * width + width - 1]] = 1;
      }
      for (i = 0; i < n; i++) {
        if (!sea[i]) continue;
        var cid = sc.comp[i];
        if (!touchesBorder[cid] && sc.sizes[cid] < minHole) land[i] = 1;
      }
    }
    tick('holes');

    // 去碎岛：这一次连通域标记的结果就是最终标签图
    var cc = AO.labelComponents(land, width, height, sb.i1, sb.i2);
    var minIsland = o.minIsland === undefined ? Math.round(n * 0.00055) : o.minIsland;
    var removed = 0;
    for (i = 0; i < n; i++) {
      if (land[i] && cc.sizes[cc.comp[i]] < minIsland) {
        cc.sizes[cc.comp[i]] = 0;      // 整块作废，comp id 不动（其余陆块仍然有效）
        land[i] = 0;
        removed++;
      }
    }
    tick('islands');

    // 与复用缓冲解耦：否则下一代生成会把这一代的 land 覆盖掉
    land = land.slice();

    var landCount = 0;
    for (i = 0; i < n; i++) landCount += land[i];

    // Sanity check：世界不能"静默失败"
    if (!isFinite(thr) || landCount < n * 0.02 || landCount > n * 0.85) {
      throw new Error('地形生成异常：陆地占比 ' + (landCount / n).toFixed(3) + '，请换一个 seed');
    }

    return {
      width: width, height: height,
      elev: elev,
      land: land,
      comp: cc.comp,
      compSizes: cc.sizes,
      compCount: cc.count,
      seaLevel: thr,
      landCount: landCount,
      landRatio: landCount / n,
      removedIslands: removed,
      ms: AO.now() - t0
    };
  };

})(typeof window !== 'undefined' ? window : globalThis);
