/* =============================================================
 * 07-politics.js —— 国家划分（团块生长）+ 图着色
 *
 * 团块生长：每个国家从首都出发，沿省份邻接图做"公平优先"的 BFS/Dijkstra：
 *   每一轮都挑「当前面积最小的国家」扩张一格，
 *   于是大国会主动让位给小国，最终各国面积接近、形状紧凑成块。
 * 着色：对国家邻接图做贪心图着色 —— 邻国绝不同色；在允许的颜色里
 *   优先挑「色相离邻国最远」的，所以相邻国不只是一色之差，而是明显不同色系。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* =============================================================
   * 配色：全部由 HSL 生成，不再硬编码十六进制
   *
   * 三套色走同一个生成器（同一个 hslToHex、同一组饱和度上限），
   * 区别只在"色相怎么排"：
   *   国家色 色相沿黄金角 137.5° 递增（任意两个索引都拉得很开）
   *   信仰色 色相按语义定点，彼此至少 30°（宗教视图是数据图，必须一眼分得开）
   *   高程带 色相 86→30 单调走一趟（绿→黄→褐），末档压到灰白
   * 饱和度的天花板决定"糖果感"：国家色实际落在 0.32~0.47，信仰色 ≤0.52，
   * 地形/高程带更低。荧光色在这个区间里出不来。
   * ============================================================= */

  /* 明度 3 档（0.52 / 0.62 / 0.71）循环取，饱和度由明度档位派生 ——
   * 这样"浅色 + 高饱和"这种最容易出糖果的组合根本不会出现。
   * 抖动有 4 档，与 3 档明度互质，所以组合以 12 为周期错开，
   * 不会出现"同一明度一路到底"。 */
  var L_STEPS = [0.52, 0.62, 0.71];
  var S_BY_L = [0.44, 0.38, 0.33];
  var S_JIT = [0.00, 0.02, -0.02, 0.03];

  function chan(v) {
    var n = Math.round(AO.clamp(v, 0, 1) * 255);
    return (n < 16 ? '0' : '') + n.toString(16);
  }

  AO.hslToHex = function (h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = AO.clamp(s, 0, 1);
    l = AO.clamp(l, 0, 1);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    return '#' + chan(r + m) + chan(g + m) + chan(b + m);
  };

  /* 国家色盘：色相 = h0 + i×137.5°，明度/饱和度按互质周期循环。
   * 起始色相与两个档位相位都由 RNG 给（固定 seed），换 seed 常量就是另一套盘，
   * 但同一份代码永远得到同一组颜色 —— 不用 Math.random。 */
  AO.buildCountryPalette = function (n) {
    n = n || 48;
    var rng = new AO.RNG(AO.hashString('palette:countries:v2'));
    var h0 = rng.next() * 360;
    var lo = rng.int(L_STEPS.length);
    var so = rng.int(S_JIT.length);
    var colors = [], hues = [];
    for (var i = 0; i < n; i++) {
      var hue = (h0 + i * 137.50776) % 360;
      var li = (i + lo) % L_STEPS.length;
      var lit = L_STEPS[li];
      var s = AO.clamp(S_BY_L[li] + S_JIT[(i + so) % S_JIT.length], 0.32, 0.55);
      hues.push(hue);
      colors.push(AO.hslToHex(hue, s, lit));
    }
    return { colors: colors, hues: hues, h0: h0 };
  };

  /* 数据色（信仰 / 地形构成）：每项自带 hue（语义定点），s/l 可覆盖，
   * 缺省就从上面两组档位里循环取。色相不用黄金角 —— 这些是"分类图"，
   * 邻居色相差 30° 以上比"全局最优散布"更重要。 */
  AO.buildDataPalette = function (items, opts) {
    opts = opts || {};
    var sMax = opts.sMax === undefined ? 0.55 : opts.sMax;
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var li = i % L_STEPS.length;
      var s = it.s === undefined ? S_BY_L[li] : it.s;
      var l = it.l === undefined ? L_STEPS[li] : it.l;
      out.push(AO.hslToHex(it.hue, Math.min(s, sMax), l));
    }
    return out;
  };

  /* 高程 5 档（地形视图的分层设色）：绿 → 黄绿 → 沙黄 → 褐 → 灰白。
   * 数值刻意贴近上一版手调的结果（那版已经和山体阴影配过、验证过），
   * 但改成 HSL 之后每档的明度关系是明确的：先升（越干越亮）、
   * 到山地回落、最高档再抬到近白 —— 这是等高线分层的读图顺序。 */
  AO.buildTerrainRamp = function () {
    var A = [
      [86, 0.26, 0.57],   // 低地：草绿
      [71, 0.32, 0.64],   // 平原：黄绿
      [45, 0.40, 0.69],   // 丘陵：沙黄
      [30, 0.30, 0.56],   // 山地：褐
      [33, 0.24, 0.74]    // 高山：灰白
    ];
    var out = [];
    for (var i = 0; i < A.length; i++) out.push(AO.hslToHex(A[i][0], A[i][1], A[i][2]));
    return out;
  };

  /* 48 色：国家数上限 140，够用；相邻不同色由下面的图着色保证 */
  var CP = AO.buildCountryPalette(48);
  var PALETTE = CP.colors;
  var PALETTE_HUE = CP.hues;
  AO.COUNTRY_PALETTE = PALETTE;
  AO.COUNTRY_HUE = PALETTE_HUE;

  /* ---------------- 简易二叉最小堆 ---------------- */
  function Heap() { this.c = []; this.p = []; }
  Heap.prototype.push = function (cost, p) {
    var c = this.c, v = this.p, i = c.length;
    c.push(cost); v.push(p);
    while (i > 0) {
      var par = (i - 1) >> 1;
      if (c[par] <= c[i]) break;
      var tc = c[par]; c[par] = c[i]; c[i] = tc;
      var tv = v[par]; v[par] = v[i]; v[i] = tv;
      i = par;
    }
  };
  Heap.prototype.pop = function () {
    if (!this.c.length) return -1;
    var c = this.c, v = this.p;
    var top = v[0];
    var lc = c.pop(), lv = v.pop();
    if (c.length) {
      c[0] = lc; v[0] = lv;
      var i = 0, n = c.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, s = i;
        if (l < n && c[l] < c[s]) s = l;
        if (r < n && c[r] < c[s]) s = r;
        if (s === i) break;
        var tc = c[s]; c[s] = c[i]; c[i] = tc;
        var tv = v[s]; v[s] = v[i]; v[i] = tv;
        i = s;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.c.length; };

  /* =============================================================
   * @param o {count, neighbors, stats, target, rng}
   * @return {owner:Int32Array, countries:[...], adjacency}
   * =========================================================== */
  AO.buildCountries = function (o) {
    var K = o.count, nb = o.neighbors, stats = o.stats;
    var rng = o.rng;
    var target = Math.max(1, Math.min(K, o.target || 24));

    /* ---------- 1. 首都：最远点采样，保证彼此分散 ---------- */
    /* 先排除"贴边"的省：最远点采样会把首都一路推到画布边缘，
     * 边境上的国家又细又不好点，所以只在距边界 edge 像素以内的范围之外选点。 */
    var edge = o.edge || 0, bd = o.bounds;
    var okCap = null, edgeCut = 0;
    if (edge > 0 && bd) {
      okCap = new Uint8Array(K + 1);
      for (i = 1; i <= K; i++) {
        var ct = stats[i].centroid;
        if (ct[0] >= edge && ct[1] >= edge &&
            ct[0] <= bd.w - edge && ct[1] <= bd.h - edge) okCap[i] = 1;
        else edgeCut++;
      }
      // 万一界内可用省太少（小世界 + 大边距），宁可不限也不要不生成国家
      if (K - edgeCut < target * 2) okCap = null;
    }

    var capitals = [];
    var minD = new Float64Array(K + 1).fill(Infinity);
    var first = 0;
    for (var tryN = 0; tryN < 200 && !first; tryN++) {
      var cand = 1 + rng.int(K);
      if (!okCap || okCap[cand]) first = cand;
    }
    if (!first) first = 1 + rng.int(K);          // 兜底：界内真的一个都没有
    capitals.push(first);
    for (var i = 1; i <= K; i++) minD[i] = dist2(i, first);
    while (capitals.length < target) {
      var best = -1, bestD = -1;
      for (i = 1; i <= K; i++) {
        if (okCap && !okCap[i]) continue;
        if (minD[i] > bestD) { bestD = minD[i]; best = i; }
      }
      if (best < 0) break;
      capitals.push(best);
      for (i = 1; i <= K; i++) {
        var d = dist2(i, best);
        if (d < minD[i]) minD[i] = d;
      }
    }
    var C = capitals.length;

    function dist2(a, b) {
      var ax = stats[a].centroid[0], ay = stats[a].centroid[1];
      var bx = stats[b].centroid[0], by = stats[b].centroid[1];
      var dx = ax - bx, dy = ay - by;
      return dx * dx + dy * dy;
    }
    function dist(a, b) { return Math.sqrt(dist2(a, b)); }

    /* ---------- 2. 团块生长 ---------- */
    var owner = new Int32Array(K + 1);   // 0 = 未认领
    var area = new Float64Array(C + 1);
    var size = new Int32Array(C + 1);
    var heaps = new Array(C + 1);
    var capOf = new Int32Array(C + 1);
    var c, p, k;

    for (c = 1; c <= C; c++) {
      capOf[c] = capitals[c - 1];
      heaps[c] = new Heap();
      owner[capOf[c]] = c;
      area[c] = stats[capOf[c]].area;
      size[c] = 1;
      var nbs = nb[capOf[c]];
      for (k = 0; k < nbs.length; k++) {
        if (!owner[nbs[k]]) heaps[c].push(dist(capOf[c], nbs[k]) * (1 + 0.35 * rng.next()), nbs[k]);
      }
    }

    var remaining = K - C;
    var guard = 0;
    while (remaining > 0 && guard++ < K * 40) {
      // 挑当前面积最小的、还有前沿的国家
      var pick = -1, minArea = Infinity;
      for (c = 1; c <= C; c++) {
        if (!heaps[c].size()) continue;
        if (area[c] < minArea) { minArea = area[c]; pick = c; }
      }
      if (pick < 0) break;
      var got = -1;
      while (heaps[pick].size()) {
        var q = heaps[pick].pop();
        if (!owner[q]) { got = q; break; }
      }
      if (got < 0) continue;
      owner[got] = pick;
      area[pick] += stats[got].area;
      size[pick]++;
      remaining--;
      var nn = nb[got];
      for (k = 0; k < nn.length; k++) {
        if (!owner[nn[k]]) {
          heaps[pick].push(dist(got, nn[k]) * (0.6 + 0.9 * rng.next()), nn[k]);
        }
      }
    }

    /* ---------- 3. 兜底：极少数没被认领的省份 ---------- */
    var orphans = 0;
    for (p = 1; p <= K; p++) {
      if (owner[p]) continue;
      orphans++;
      var bestC = -1, bestCnt = -1;
      var pp = nb[p];
      for (k = 0; k < pp.length; k++) {
        var oc = owner[pp[k]];
        if (!oc) continue;
        var cnt = 0;
        for (var t = 0; t < pp.length; t++) if (owner[pp[t]] === oc) cnt++;
        if (cnt > bestCnt) { bestCnt = cnt; bestC = oc; }
      }
      if (bestC < 0) {
        // 完全孤立：找最近的首都
        var bd = Infinity;
        for (c = 1; c <= C; c++) {
          var dd = dist2(p, capOf[c]);
          if (dd < bd) { bd = dd; bestC = c; }
        }
      }
      owner[p] = bestC > 0 ? bestC : 1;
      area[owner[p]] += stats[p].area;
      size[owner[p]]++;
    }

    /* ---------- 4. 国家邻接图 + 图着色 ---------- */
    var cadj = new Array(C + 1);
    for (c = 0; c <= C; c++) cadj[c] = new Set();
    for (p = 1; p <= K; p++) {
      var pa = nb[p];
      for (k = 0; k < pa.length; k++) {
        var o1 = owner[p], o2 = owner[pa[k]];
        if (o1 && o2 && o1 !== o2) { cadj[o1].add(o2); cadj[o2].add(o1); }
      }
    }

    var order = [];
    for (c = 1; c <= C; c++) order.push(c);
    order.sort(function (x, y) { return cadj[y].size - cadj[x].size; });

    var colors = new Int32Array(C + 1).fill(-1);
    var usage = new Int32Array(PALETTE.length);   // 每个颜色被用过几次
    var PN = PALETTE.length;
    for (i = 0; i < order.length; i++) {
      var cc = order[i];
      var usedC = new Set();
      cadj[cc].forEach(function (x) { var v = colors[x]; if (v >= 0) usedC.add(v); });
      /* 在"邻国都没用"的颜色里挑：**色相离邻国越远越好**，
       * 同分时优先全局还没上过场的（让整张图铺开、不挤在前几个色）。
       * 只按索引差挑是不够的 —— 黄金角序列里相隔 21 步的两色色相只差 7.7°，
       * 必须真的算一次色相距离，才能保证相邻国颜色在视觉上分得开。 */
      var start = rng.int(PN);
      var pick = -1, pickScore = -Infinity;
      for (var t = 0; t < PN; t++) {
        var idx = (start + t) % PN;
        if (usedC.has(idx)) continue;
        var dh = 180;
        usedC.forEach(function (v) {
          var d = Math.abs(PALETTE_HUE[idx] - PALETTE_HUE[v]);
          if (d > 180) d = 360 - d;
          if (d < dh) dh = d;
        });
        var score = dh + (usage[idx] ? 0 : 30);
        if (score > pickScore) { pickScore = score; pick = idx; }
      }
      if (pick < 0) pick = rng.int(PN);           // 兜底：色盘被邻国占满（48 色下不会发生）
      colors[cc] = pick;
      usage[pick]++;
    }

    var countries = [];
    for (c = 1; c <= C; c++) {
      countries.push({
        id: c,
        capital: capOf[c],
        colorIndex: colors[c],
        color: PALETTE[colors[c] % PALETTE.length],
        area: area[c],
        provinceCount: size[c],
        neighbors: Array.from(cadj[c]).sort(function (a, b) { return a - b; })
      });
    }

    return { owner: owner, countries: countries, capitalOf: capOf, orphans: orphans };
  };

})(typeof window !== 'undefined' ? window : globalThis);
