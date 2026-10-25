/* =============================================================
 * 06-adjacency.js —— 栅格邻接统计 + 省份基础统计
 *
 * 直接扫栅格统计"相邻标签"，天然保证对称（A 扫到 B 的瞬间也写 B）。
 * 不用多边形做邻接判断 —— 简化后的多边形可能擦边、留缝，不可靠。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  AO.buildAdjacency = function (labels, width, height, count) {
    var sets = new Array(count + 1);
    for (var i = 0; i <= count; i++) sets[i] = new Set();
    var lengths = new Array(count + 1);
    for (i = 0; i <= count; i++) lengths[i] = new Map();

    var x, y, idx, a, b;
    for (y = 0; y < height; y++) {
      var row = y * width;
      for (x = 0; x < width; x++) {
        idx = row + x;
        a = labels[idx];
        if (!a) continue;
        if (x + 1 < width) {
          b = labels[idx + 1];
          if (b && b !== a) {
            sets[a].add(b); sets[b].add(a);
            lengths[a].set(b, (lengths[a].get(b) || 0) + 1);
            lengths[b].set(a, (lengths[b].get(a) || 0) + 1);
          }
        }
        if (y + 1 < height) {
          b = labels[idx + width];
          if (b && b !== a) {
            sets[a].add(b); sets[b].add(a);
            lengths[a].set(b, (lengths[a].get(b) || 0) + 1);
            lengths[b].set(a, (lengths[b].get(a) || 0) + 1);
          }
        }
      }
    }

    var neighbors = new Array(count + 1);
    var edges = [];
    for (i = 1; i <= count; i++) {
      var arr = Array.from(sets[i]);
      arr.sort(function (p, q) { return p - q; });
      neighbors[i] = arr;
      for (var k = 0; k < arr.length; k++) {
        if (i < arr[k]) edges.push([i, arr[k], lengths[i].get(arr[k]) || 0]);
      }
    }
    return { neighbors: neighbors, edges: edges };
  };

  /* 省份基础统计：像素面积、质心、平均高程 */
  AO.provinceStats = function (labels, width, height, count, elev) {
    var n = width * height;
    var area = new Int32Array(count + 1);
    var sx = new Float64Array(count + 1);
    var sy = new Float64Array(count + 1);
    var se = new Float64Array(count + 1);
    var minx = new Int32Array(count + 1).fill(width);
    var miny = new Int32Array(count + 1).fill(height);
    var maxx = new Int32Array(count + 1).fill(-1);
    var maxy = new Int32Array(count + 1).fill(-1);

    for (var i = 0; i < n; i++) {
      var l = labels[i];
      if (!l) continue;
      var x = i % width, y = (i / width) | 0;
      area[l]++;
      sx[l] += x; sy[l] += y;
      se[l] += elev[i];
      if (x < minx[l]) minx[l] = x;
      if (x > maxx[l]) maxx[l] = x;
      if (y < miny[l]) miny[l] = y;
      if (y > maxy[l]) maxy[l] = y;
    }

    var out = new Array(count + 1);
    for (var k = 1; k <= count; k++) {
      out[k] = {
        id: k,
        area: area[k],
        centroid: area[k] ? [sx[k] / area[k] + 0.5, sy[k] / area[k] + 0.5] : [0, 0],
        elevMean: area[k] ? se[k] / area[k] : 0,
        bbox: [minx[k], miny[k], maxx[k], maxy[k]]
      };
    }
    return out;
  };

  /* 邻接度直方图（验收用） */
  AO.degreeHistogram = function (neighbors, count) {
    var hist = {};
    var sum = 0, n = 0;
    for (var i = 1; i <= count; i++) {
      var d = neighbors[i] ? neighbors[i].length : 0;
      hist[d] = (hist[d] || 0) + 1;
      sum += d; n++;
    }
    return { hist: hist, mean: n ? sum / n : 0, min: 0, max: 0 };
  };

})(typeof window !== 'undefined' ? window : globalThis);
