/* =============================================================
 * 04-partition.js —— 测地 Voronoi（两遍 chamfer 距离变换）
 *
 * 距离只在「陆地像素」之间传播：8 邻域，直边权重 1、对角 √2。
 * 两遍扫描（正向 + 反向）就得到多源最短路，复杂度 O(N)，与源点个数无关。
 * 坑位 #6：距离没覆盖到的陆地像素会变成空洞（省份图里出现"洞"），
 *         最后必须做一个多源 BFS 修补。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  var D2 = Math.SQRT2;

  /**
   * @param land   Uint8Array(w*h)  1=陆地
   * @param seeds  Int32Array       种子像素下标，label = 下标+1
   * @return {label:Uint16Array, dist:Float32Array, repaired, unreached}
   */
  AO.voronoiRaster = function (land, width, height, seeds, optDist, optLabel) {
    var n = width * height, i, x, y, k;
    var inf = 1e18;
    var dist = optDist || new Float32Array(n);
    var label = optLabel || new Uint16Array(n);

    for (i = 0; i < n; i++) { dist[i] = inf; label[i] = 0; }
    for (k = 0; k < seeds.length; k++) {
      var sp = seeds[k];
      if (sp >= 0 && sp < n && land[sp]) { dist[sp] = 0; label[sp] = k + 1; }
    }

    /* ---------- 正向扫描：只看左 / 上 / 左上 / 左下 ---------- */
    for (y = 0; y < height; y++) {
      var row = y * width;
      for (x = 0; x < width; x++) {
        i = row + x;
        if (!land[i]) continue;
        var best = dist[i], bl = label[i], nd, j;
        if (x > 0) {
          j = i - 1;
          if (land[j]) { nd = dist[j] + 1; if (nd < best) { best = nd; bl = label[j]; } }
          if (y > 0) { j = i - width - 1; if (land[j]) { nd = dist[j] + D2; if (nd < best) { best = nd; bl = label[j]; } } }
          if (y + 1 < height) { j = i + width - 1; if (land[j]) { nd = dist[j] + D2; if (nd < best) { best = nd; bl = label[j]; } } }
        }
        if (y > 0) { j = i - width; if (land[j]) { nd = dist[j] + 1; if (nd < best) { best = nd; bl = label[j]; } } }
        dist[i] = best; label[i] = bl;
      }
    }

    /* ---------- 反向扫描：只看右 / 下 / 右下 / 右上 ---------- */
    for (y = height - 1; y >= 0; y--) {
      var row2 = y * width;
      for (x = width - 1; x >= 0; x--) {
        i = row2 + x;
        if (!land[i]) continue;
        var best2 = dist[i], bl2 = label[i], nd2, j2;
        if (x + 1 < width) {
          j2 = i + 1;
          if (land[j2]) { nd2 = dist[j2] + 1; if (nd2 < best2) { best2 = nd2; bl2 = label[j2]; } }
          if (y + 1 < height) { j2 = i + width + 1; if (land[j2]) { nd2 = dist[j2] + D2; if (nd2 < best2) { best2 = nd2; bl2 = label[j2]; } } }
          if (y > 0) { j2 = i - width + 1; if (land[j2]) { nd2 = dist[j2] + D2; if (nd2 < best2) { best2 = nd2; bl2 = label[j2]; } } }
        }
        if (y + 1 < height) { j2 = i + width; if (land[j2]) { nd2 = dist[j2] + 1; if (nd2 < best2) { best2 = nd2; bl2 = label[j2]; } } }
        dist[i] = best2; label[i] = bl2;
      }
    }

    /* ---------- 修补：未被任何省份覆盖的陆地像素，用多源 BFS 补上 ---------- */
    var queue = new Int32Array(n);
    var qh = 0, qt = 0, repaired = 0, unreached = 0;
    // 起点：所有已标记、且 4 邻域里有未标记陆地的像素
    for (y = 0; y < height; y++) {
      var row3 = y * width;
      for (x = 0; x < width; x++) {
        i = row3 + x;
        if (!land[i] || !label[i]) continue;
        var touch = false;
        if (x > 0 && land[i - 1] && !label[i - 1]) touch = true;
        else if (x + 1 < width && land[i + 1] && !label[i + 1]) touch = true;
        else if (y > 0 && land[i - width] && !label[i - width]) touch = true;
        else if (y + 1 < height && land[i + width] && !label[i + width]) touch = true;
        if (touch) queue[qt++] = i;
      }
    }
    while (qh < qt) {
      var p = queue[qh++];
      var pl = label[p], pd = dist[p];
      var px = p % width, py = (p / width) | 0;
      for (var d = 0; d < 4; d++) {
        var qq = d === 0 ? p - 1 : d === 1 ? p + 1 : d === 2 ? p - width : p + width;
        if (d === 0 && px === 0) continue;
        if (d === 1 && px === width - 1) continue;
        if (d === 2 && py === 0) continue;
        if (d === 3 && py === height - 1) continue;
        if (!land[qq] || label[qq]) continue;
        label[qq] = pl;
        dist[qq] = pd + 1;
        repaired++;
        queue[qt++] = qq;
      }
    }
    // 仍然为 0 的陆地像素 = 完全孤立的区域（理论上不该出现）
    for (i = 0; i < n; i++) if (land[i] && !label[i]) unreached++;

    return { label: label, dist: dist, repaired: repaired, unreached: unreached };
  };

  /* Lloyd 一步：把每个 cell 的种子挪到「离质心最近的该 cell 像素」。
   * 两趟扫描完成，O(N)。质心四舍五入后可能落在海里或别的 cell 里，
   * 所以必须回到像素集合内部去找，不能直接用质心坐标。 */
  AO.relaxSeeds = function (label, width, height, count) {
    var n = width * height, i, l, x, y;
    var sx = new Float64Array(count + 1);
    var sy = new Float64Array(count + 1);
    var cnt = new Int32Array(count + 1);
    for (i = 0; i < n; i++) {
      l = label[i];
      if (!l) continue;
      sx[l] += i % width;
      sy[l] += (i / width) | 0;
      cnt[l]++;
    }
    var tx = new Float64Array(count + 1);
    var ty = new Float64Array(count + 1);
    for (var k = 1; k <= count; k++) {
      tx[k] = cnt[k] ? sx[k] / cnt[k] : -1;
      ty[k] = cnt[k] ? sy[k] / cnt[k] : -1;
    }
    var bestP = new Int32Array(count + 1);
    var bestD = new Float64Array(count + 1);
    for (k = 1; k <= count; k++) { bestP[k] = -1; bestD[k] = Infinity; }
    for (i = 0; i < n; i++) {
      l = label[i];
      if (!l || cnt[l] === 0) continue;
      x = i % width; y = (i / width) | 0;
      var dx = x - tx[l], dy = y - ty[l];
      var d = dx * dx + dy * dy;
      if (d < bestD[l]) { bestD[l] = d; bestP[l] = i; }
    }
    return { seeds: bestP, area: cnt, cx: tx, cy: ty };
  };

})(typeof window !== 'undefined' ? window : globalThis);
