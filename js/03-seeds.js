/* =============================================================
 * 03-seeds.js —— 省份种子布点
 *
 * 抖动网格保证覆盖均匀（纯随机会在局部堆积 / 局部空窗），
 * 每个连通陆块至少补一个种子（否则那块陆地没人认领 → 空洞），
 * 再做 2 轮 Lloyd 松弛让 cell 大小更均匀（质心用测地 Voronoi 的 cell 质心）。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  AO.placeSeeds = function (terr, target, rng, relaxIters) {
    var width = terr.width, height = terr.height, n = width * height;
    var land = terr.land;
    var landCount = terr.landCount;
    if (landCount < 100) throw new Error('陆地太少，无法布点');

    var seeds = [];
    var spacing = Math.sqrt(landCount / Math.max(4, target));

    /* ---------- 1. 抖动网格 ---------- */
    var nx = Math.max(1, Math.round(width / spacing));
    var ny = Math.max(1, Math.round(height / spacing));
    var sxStep = width / nx, syStep = height / ny;
    for (var gy = 0; gy < ny; gy++) {
      for (var gx = 0; gx < nx; gx++) {
        var px = Math.round((gx + 0.5 + (rng.next() - 0.5) * 0.92) * sxStep);
        var py = Math.round((gy + 0.5 + (rng.next() - 0.5) * 0.92) * syStep);
        if (px < 0) px = 0; else if (px >= width) px = width - 1;
        if (py < 0) py = 0; else if (py >= height) py = height - 1;
        var idx = py * width + px;
        if (land[idx]) seeds.push(idx);
      }
    }

    /* ---------- 2. 每个连通陆块至少一个种子 ---------- */
    var comp = terr.comp, compCount = terr.compCount;
    var perComp = new Int32Array(compCount + 1);
    for (var i = 0; i < seeds.length; i++) perComp[comp[seeds[i]]]++;

    // 找出没有种子的陆块（被"去碎岛"作废的 compSizes=0 不算）
    var missing = [];
    for (var c = 1; c <= compCount; c++) {
      if (perComp[c] === 0 && terr.compSizes[c] > 0) missing.push(c);
    }
    if (missing.length) {
      var sumX = new Float64Array(compCount + 1);
      var sumY = new Float64Array(compCount + 1);
      for (i = 0; i < n; i++) {
        if (!land[i]) continue;
        var cc = comp[i];
        if (perComp[cc] !== 0) continue;    // 只需要给缺种子的块找中心
        sumX[cc] += i % width;
        sumY[cc] += (i / width) | 0;
      }
      // 第二趟：离质心最近的陆地像素
      var bestP = new Int32Array(compCount + 1).fill(-1);
      var bestD = new Float64Array(compCount + 1).fill(Infinity);
      var cx = new Float64Array(compCount + 1), cy = new Float64Array(compCount + 1);
      var m, k;
      for (m = 0; m < missing.length; m++) {
        k = missing[m];
        cx[k] = sumX[k] / Math.max(1, terr.compSizes[k]);
        cy[k] = sumY[k] / Math.max(1, terr.compSizes[k]);
      }
      for (i = 0; i < n; i++) {
        if (!land[i]) continue;
        var cc2 = comp[i];
        if (perComp[cc2] !== 0) continue;
        var xx = i % width, yy = (i / width) | 0;
        var dx = xx - cx[cc2], dy = yy - cy[cc2];
        var d2 = dx * dx + dy * dy;
        if (d2 < bestD[cc2]) { bestD[cc2] = d2; bestP[cc2] = i; }
      }
      for (m = 0; m < missing.length; m++) {
        if (bestP[missing[m]] >= 0) seeds.push(bestP[missing[m]]);
      }
    }

    /* ---------- 3. 去重（同一像素只能有一个种子） ---------- */
    seeds = uniquePixels(seeds);

    /* ---------- 4. 测地 Lloyd 松弛 ---------- */
    var scr = AO.scratchBufs(width * height);
    var iters = relaxIters === undefined ? 2 : relaxIters;
    for (var it = 0; it < iters; it++) {
      var part = AO.voronoiRaster(land, width, height, seeds, scr.f2, scr.u4);
      var rel = AO.relaxSeeds(part.label, width, height, seeds.length);
      var next = [];
      for (var s = 1; s <= seeds.length; s++) {
        if (rel.area[s] > 0 && rel.seeds[s] >= 0) next.push(rel.seeds[s]);
        else next.push(seeds[s - 1]);
      }
      next = uniquePixels(next);
      if (next.length === 0) break;
      seeds = next;
    }

    return { seeds: Int32Array.from(seeds), spacing: spacing };

    function uniquePixels(arr) {
      var seen = new Set(), out = [];
      for (var q = 0; q < arr.length; q++) {
        if (seen.has(arr[q])) continue;
        seen.add(arr[q]);
        out.push(arr[q]);
      }
      return out;
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
