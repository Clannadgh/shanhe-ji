/* =============================================================
 * 05-geometry.js —— Marching Squares 提环 + Douglas-Peucker 简化
 *
 * 做法：把"标签图"看成对角网格（每个 2x2 像素块中心是一个格点），
 * 相邻像素标签不同时，在该 2x2 块内切出线段，再把线段连成闭合环。
 *
 * 坑位 #2：连环时必须把线段"反向半边"一起标记已用，
 *         否则同一个环会被正反各描一遍，面积正好是像素数的 2 倍。
 *         这里的实现方式是——每条线段归属两个 label（左右各一个），
 *         对每个 label 单独建邻接、单独连环，天然不会重复走。
 * 坑位 #3：一个格子里出现 3 个以上标签（三岔口）时，必须在该格中心补
 *         一个顶点，把边界拆成多条"辐条"，否则线段两侧的标签会串标。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* ---------- Douglas–Peucker（对开放折线；闭合环由首尾相同保证） ----------
   * 关键：DP 在"多个点到弦等距"时，取谁取决于遍历方向。
   * 一条共享边界从 A 侧和从 B 侧是反方向的，若不规范化就会简化出不同顶点，
   * 两省之间出现亚像素缝。所以先把折线按端点字典序规范成一个固定方向，
   * 简化完再翻回去 —— 两侧必然得到完全相同的点集。 */
  function forwardIsCanonical(pts) {
    var n = pts.length >> 1;
    var i = 0, j = n - 1;
    while (i < j) {
      var ax = pts[i * 2], ay = pts[i * 2 + 1];
      var bx = pts[j * 2], by = pts[j * 2 + 1];
      if (ax !== bx) return ax < bx;
      if (ay !== by) return ay < by;
      i++; j--;
    }
    return true;   // 完全对称，两个方向等价
  }

  function reversePts(pts) {
    var n = pts.length >> 1;
    var out = new Float64Array(pts.length);
    for (var i = 0; i < n; i++) {
      out[i * 2] = pts[(n - 1 - i) * 2];
      out[i * 2 + 1] = pts[(n - 1 - i) * 2 + 1];
    }
    return out;
  }

  function simplifyPolyline(pts, eps) {
    var n = pts.length >> 1;
    if (n <= 2) return pts.slice();
    if (forwardIsCanonical(pts)) return dp(pts, eps);
    return reversePts(dp(reversePts(pts), eps));
  }

  function dp(pts, eps) {
    var n = pts.length >> 1;
    var keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    var stack = [0, n - 1];
    var eps2 = eps * eps;
    while (stack.length) {
      var b = stack.pop(), a = stack.pop();
      if (b - a < 2) continue;
      var ax = pts[a * 2], ay = pts[a * 2 + 1];
      var bx = pts[b * 2], by = pts[b * 2 + 1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var bestI = -1, bestD = -1;
      for (var i = a + 1; i < b; i++) {
        var px = pts[i * 2], py = pts[i * 2 + 1];
        var d;
        if (len2 < 1e-12) {
          var ex = px - ax, ey = py - ay;
          d = ex * ex + ey * ey;
        } else {
          var t = ((px - ax) * dx + (py - ay) * dy) / len2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          var qx = ax + t * dx - px, qy = ay + t * dy - py;
          d = qx * qx + qy * qy;
        }
        if (d > bestD) { bestD = d; bestI = i; }
      }
      if (bestD > eps2 && bestI > 0) {
        keep[bestI] = 1;
        stack.push(a, bestI, bestI, b);
      }
    }
    var cnt = 0, k;
    for (k = 0; k < n; k++) if (keep[k]) cnt++;
    var out = new Float64Array(cnt * 2);
    var w = 0;
    for (k = 0; k < n; k++) {
      if (!keep[k]) continue;
      out[w * 2] = pts[k * 2];
      out[w * 2 + 1] = pts[k * 2 + 1];
      w++;
    }
    return out;
  }
  AO.simplifyPolyline = simplifyPolyline;

  /* ---------- 环面积（有符号，shoelace） ---------- */
  AO.ringSignedArea = function (pts) {
    var n = pts.length >> 1, s = 0;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      s += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
    }
    return s * 0.5;
  };

  /* ---------- 点在环内（射线法，用于判断洞/独立块） ---------- */
  AO.pointInRing = function (x, y, pts) {
    var n = pts.length >> 1, inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = pts[i * 2], yi = pts[i * 2 + 1];
      var xj = pts[j * 2], yj = pts[j * 2 + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  /* =============================================================
   * 主入口：labels(1..K，0=海) → 每个省份的多边形环
   * 返回 Map<label, ring[]>
   * ring = { coords: Float64Array(闭合), runs:[{other, pts}], area, bbox }
   * =========================================================== */
  AO.extractGeometry = function (labels, width, height, opts) {
    var EPS = (opts && opts.simplifyEps) || 0.52;
    var w = width, h = height;
    var padW = w + 2;
    var P = new Uint16Array(padW * (h + 2));   // 默认 0 = 海（边界外也是海）
    var x, y;
    for (y = 0; y < h; y++) {
      var src = y * w, dst = (y + 1) * padW + 1;
      for (x = 0; x < w; x++) P[dst + x] = labels[src + x];
    }

    var KY = 2 * w + 3;   // key 的行宽
    function keyOf(x2, y2) { return (y2 + 1) * KY + (x2 + 1); }

    /* ---- 线段表（扁平数组，比对象快很多） ---- */
    var segK1 = [], segK2 = [], segL1 = [], segL2 = [];
    var labelSegs = new Map();

    function addSeg(k1, k2, l1, l2) {
      var si = segK1.length;
      segK1.push(k1); segK2.push(k2); segL1.push(l1); segL2.push(l2);
      if (l1 > 0) {
        var a = labelSegs.get(l1);
        if (!a) { a = []; labelSegs.set(l1, a); }
        a.push(si);
      }
      if (l2 > 0 && l2 !== l1) {
        var b = labelSegs.get(l2);
        if (!b) { b = []; labelSegs.set(l2, b); }
        b.push(si);
      }
    }

    /* ---- 逐格点扫描 2x2 块 ---- */
    for (var j = 0; j <= h; j++) {
      var r0 = j * padW, r1 = (j + 1) * padW;
      var yC = 2 * j;
      var baseN = (yC) * KY, baseC = (yC + 1) * KY, baseS = (yC + 2) * KY;
      for (var i = 0; i <= w; i++) {
        var a = P[r0 + i], b = P[r0 + i + 1], c = P[r1 + i], d = P[r1 + i + 1];
        if (a === b && b === c && c === d) continue;

        var xC = 2 * i;
        var kN = baseN + (xC + 1);
        var kE = baseC + (xC + 2);
        var kS = baseS + (xC + 1);
        var kW = baseC + xC;

        var cN = a !== b, cE = b !== d, cS = c !== d, cW = a !== c;
        var k = (cN ? 1 : 0) + (cE ? 1 : 0) + (cS ? 1 : 0) + (cW ? 1 : 0);

        if (k === 2) {
          var l1 = a, l2 = (b !== a ? b : (c !== a ? c : d));
          var p1, p2;
          if (cN && cE) { p1 = kN; p2 = kE; }
          else if (cN && cS) { p1 = kN; p2 = kS; }
          else if (cN && cW) { p1 = kN; p2 = kW; }
          else if (cE && cS) { p1 = kE; p2 = kS; }
          else if (cE && cW) { p1 = kE; p2 = kW; }
          else { p1 = kS; p2 = kW; }
          addSeg(p1, p2, l1, l2);
        } else if (k === 4 && a === d) {
          // 对角同标签：a(=d) 从中心"细腰"穿过，切掉 b 角与 c 角。
          // 注意 b 与 c 可以不同（三色蝴蝶结），这时也必须走这条分支，
          // 否则会退化成一个 4 度顶点，导致相邻两省对同一条边界的切分不一致。
          addSeg(kN, kE, b, a);
          addSeg(kS, kW, c, a);
        } else if (k === 4 && b === c) {
          // 另一种对角：b(=c) 相通，切掉 a 角与 d 角
          addSeg(kN, kW, a, b);
          addSeg(kE, kS, d, b);
        } else {
          // k===3 或 四色交汇：在块中心补顶点，边界拆成辐条（坑位 #3）
          var kC = baseC + (xC + 1);
          if (cN) addSeg(kN, kC, a, b);
          if (cE) addSeg(kE, kC, b, d);
          if (cS) addSeg(kS, kC, c, d);
          if (cW) addSeg(kW, kC, a, c);
        }
      }
    }

    /* ---- 逐标签连环 ---- */
    var rings = new Map();
    var totalRuns = 0;

    labelSegs.forEach(function (list, lb) {
      var inc = new Map();
      var q, si, e;
      for (q = 0; q < list.length; q++) {
        si = list[q];
        e = inc.get(segK1[si]);
        if (e === undefined) inc.set(segK1[si], si);
        else if (typeof e === 'number') inc.set(segK1[si], [e, si]);
        else e.push(si);
        e = inc.get(segK2[si]);
        if (e === undefined) inc.set(segK2[si], si);
        else if (typeof e === 'number') inc.set(segK2[si], [e, si]);
        else e.push(si);
      }

      var used = new Set();
      var out = [];

      for (q = 0; q < list.length; q++) {
        if (used.has(list[q])) continue;
        var s0 = list[q];
        var startKey = segK1[s0];
        var nextKey = segK2[s0];
        var keys = [startKey];
        var others = [];
        used.add(s0);
        var closed = false, guard = 0;

        while (guard++ < 2000000) {
          others.push(segL1[s0] === lb ? segL2[s0] : segL1[s0]);
          keys.push(nextKey);
          if (nextKey === startKey) { closed = true; break; }
          var lst = inc.get(nextKey);
          var nxt = -1;
          if (typeof lst === 'number') { if (!used.has(lst)) nxt = lst; }
          else if (lst) {
            for (var t = 0; t < lst.length; t++) if (!used.has(lst[t])) { nxt = lst[t]; break; }
          }
          if (nxt < 0) break;
          used.add(nxt);
          s0 = nxt;
          var a2 = segK1[s0], b2 = segK2[s0];
          nextKey = (a2 === nextKey) ? b2 : a2;
        }
        if (!closed || keys.length < 4) continue;

        var m = others.length;   // == keys.length - 1

        /* 首尾如果同标签，把环旋转到第一个标签变化处，
         * 保证相邻两省对同一条共享边界的切分点完全一致（DP 结果才能重合）。 */
        if (m > 1 && others[0] === others[m - 1]) {
          var t0 = 1;
          while (t0 < m && others[t0] === others[0]) t0++;
          if (t0 < m) {
            var nk = new Array(m + 1), no = new Array(m);
            for (var u = 0; u < m; u++) {
              no[u] = others[(t0 + u) % m];
              nk[u] = keys[(t0 + u) % m];
            }
            nk[m] = nk[0];
            keys = nk; others = no;
          }
        }

        /* 按"对面标签"切成 runs */
        var runs = [];
        var st = 0;
        for (var e2 = 1; e2 <= m; e2++) {
          if (e2 === m || others[e2] !== others[st]) {
            var cnt = e2 - st + 1;
            var pts = new Float64Array(cnt * 2);
            for (var v = st; v <= e2; v++) {
              var kk = keys[v];
              pts[(v - st) * 2] = ((kk % KY) - 1) * 0.5;
              pts[(v - st) * 2 + 1] = (((kk / KY) | 0) - 1) * 0.5;
            }
            runs.push({ other: others[st], pts: simplifyPolyline(pts, EPS) });
            st = e2;
          }
        }
        totalRuns += runs.length;

        /* 拼成闭合坐标串 */
        var totalPts = 0;
        for (var r = 0; r < runs.length; r++) totalPts += (runs[r].pts.length >> 1) - (r === 0 ? 0 : 1);
        var coords = new Float64Array(totalPts * 2);
        var wpos = 0;
        for (r = 0; r < runs.length; r++) {
          var rp = runs[r].pts;
          var startI = r === 0 ? 0 : 1;
          for (var pi = startI; pi < (rp.length >> 1); pi++) {
            coords[wpos * 2] = rp[pi * 2];
            coords[wpos * 2 + 1] = rp[pi * 2 + 1];
            wpos++;
          }
        }

        var area = AO.ringSignedArea(coords);
        if (Math.abs(area) < 0.5) continue;   // 退化小环

        var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (pi = 0; pi < totalPts; pi++) {
          var cx = coords[pi * 2], cy = coords[pi * 2 + 1];
          if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
          if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
        }
        out.push({ coords: coords, runs: runs, area: area, bbox: [minx, miny, maxx, maxy] });
      }

      if (out.length) rings.set(lb, out);
    });

    return { rings: rings, segmentCount: segK1.length, runCount: totalRuns };
  };

})(typeof window !== 'undefined' ? window : globalThis);
