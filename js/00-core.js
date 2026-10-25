/* =============================================================
 * 00-core.js  —— 种子随机数 / 数学工具 / 栅格形态学 / 连通域
 * 全部模块都挂在全局命名空间 AO 上；用普通 <script> 加载（file:// 下
 * 不能用 ES module，会被 CORS 拦）。同时兼容 Node（供自检脚本使用）。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* ---------------- 时间 ---------------- */
  AO.now = function () {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  };

  /* ---------------- 数学 ---------------- */
  AO.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  AO.lerp = function (a, b, t) { return a + (b - a) * t; };
  AO.smoothstep = function (e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  };

  /* ---------------- 字符串散列（把 seed 文本变成 uint32） ---------------- */
  AO.hashString = function (str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  };

  /* ---------------- mulberry32：全程唯一的随机源 ----------------
   * 所有"随机"都必须来自这里，禁止 Math.random —— 否则同 seed 不可复现。
   */
  function RNG(seed) {
    this.state = seed >>> 0;
    this.seed = seed >>> 0;
  }
  RNG.prototype.next = function () {
    var a = (this.state = (this.state + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.int = function (n) { return Math.floor(this.next() * n) % n; };
  RNG.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  RNG.prototype.pick = function (arr) { return arr[this.int(arr.length)]; };
  /* 派生子流：不同阶段互不干扰，某个阶段改动不会整体位移后续随机数 */
  RNG.prototype.fork = function (label) {
    return new RNG(AO.hashString(label + '@' + this.seed));
  };
  AO.RNG = RNG;

  /* ---------------- 栅格连通域标记（8 邻接） ----------------
   * outComp / outStack 可复用外部缓冲，避免每次生成都分配十几 MB。
   * 注意：传了 outComp 时返回的 comp 就是那块缓冲，调用方不能长期持有。 */
  AO.labelComponents = function (mask, w, h, outComp, outStack) {
    var n = w * h;
    var comp = outComp || new Int32Array(n);
    var sizes = [0];
    var stack = outStack || new Int32Array(n);
    if (outComp) comp.fill(0);
    var nc = 0;
    for (var i = 0; i < n; i++) {
      if (!mask[i] || comp[i]) continue;
      nc++;
      var sp = 0;
      stack[sp++] = i;
      comp[i] = nc;
      var cnt = 0;
      while (sp > 0) {
        var p = stack[--sp];
        cnt++;
        var x = p % w, y = (p - x) / w;
        // 把 x 的合法邻域先算成一个区间，内层就没有边界分支了
        var x0 = x > 0 ? x - 1 : x;
        var x1 = x + 1 < w ? x + 1 : x;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          var base = yy * w;
          for (var q = base + x0, qe = base + x1; q <= qe; q++) {
            if (mask[q] && !comp[q]) { comp[q] = nc; stack[sp++] = q; }
          }
        }
      }
      sizes[nc] = cnt;
    }
    return { comp: comp, sizes: sizes, count: nc };
  };

  /* ---------------- 方形结构元腐蚀 / 膨胀（可分离两趟） ----------------
   * r = 半径；dilate=true 为膨胀，false 为腐蚀。
   * 分「左边缘 / 中间 / 右边缘」三段：中间段没有任何边界判断，
   * 且膨胀与腐蚀分成两个独立循环（内层没有 dilate 分支）。
   * 这样 V8 才能把内层跑成紧凑的机器码 —— 之前带分支的版本
   * 在浏览器里比 Node 慢 10 倍。
   */
  AO.morphSquare = function (mask, w, h, r, dilate, tmpBuf, outBuf) {
    var n = w * h;
    var tmp = tmpBuf || new Uint8Array(n);
    var out = outBuf || new Uint8Array(n);
    var x, y, dx, acc, row, i, v, xx, yy, lim = w - r, vlim = h - r;

    /* ---- 横向 ---- */
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < r && x < w; x++) {           // 左边缘
        acc = dilate ? 0 : 1;
        for (dx = -r; dx <= r; dx++) {
          xx = x + dx;
          if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          v = mask[row + xx];
          acc = dilate ? (acc | v) : (acc & v);
        }
        tmp[row + x] = acc;
      }
      if (dilate) {
        for (x = r; x < lim; x++) {                // 中间
          i = row + x; acc = 0;
          for (dx = -r; dx <= r; dx++) acc |= mask[i + dx];
          tmp[i] = acc;
        }
      } else {
        for (x = r; x < lim; x++) {
          i = row + x; acc = 1;
          for (dx = -r; dx <= r; dx++) acc &= mask[i + dx];
          tmp[i] = acc;
        }
      }
      for (x = lim < r ? r : lim; x < w; x++) {    // 右边缘
        acc = dilate ? 0 : 1;
        for (dx = -r; dx <= r; dx++) {
          xx = x + dx;
          if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          v = mask[row + xx];
          acc = dilate ? (acc | v) : (acc & v);
        }
        tmp[row + x] = acc;
      }
    }

    /* ---- 纵向 ---- */
    for (x = 0; x < w; x++) {
      for (y = 0; y < r && y < h; y++) {           // 上边缘
        acc = dilate ? 0 : 1;
        for (dx = -r; dx <= r; dx++) {
          yy = y + dx;
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          v = tmp[yy * w + x];
          acc = dilate ? (acc | v) : (acc & v);
        }
        out[y * w + x] = acc;
      }
      if (dilate) {
        for (y = r; y < vlim; y++) {               // 中间
          acc = 0;
          for (dx = -r; dx <= r; dx++) acc |= tmp[(y + dx) * w + x];
          out[y * w + x] = acc;
        }
      } else {
        for (y = r; y < vlim; y++) {
          acc = 1;
          for (dx = -r; dx <= r; dx++) acc &= tmp[(y + dx) * w + x];
          out[y * w + x] = acc;
        }
      }
      for (y = vlim < r ? r : vlim; y < h; y++) {  // 下边缘
        acc = dilate ? 0 : 1;
        for (dx = -r; dx <= r; dx++) {
          yy = y + dx;
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          v = tmp[yy * w + x];
          acc = dilate ? (acc | v) : (acc & v);
        }
        out[y * w + x] = acc;
      }
    }
    return out;
  };

  /* ---------------- 3x3 多数表决平滑 ----------------
   * 内部无分支版本 + 边框慢路径（边框只占 O(w+h) 个像素）。 */
  AO.majority3x3 = function (mask, w, h, outBuf) {
    var out = outBuf || new Uint8Array(w * h);
    var x, y, i, row;
    for (y = 1; y < h - 1; y++) {
      row = y * w;
      for (x = 1; x < w - 1; x++) {
        i = row + x;
        var s = mask[i - w - 1] + mask[i - w] + mask[i - w + 1]
              + mask[i - 1] + mask[i] + mask[i + 1]
              + mask[i + w - 1] + mask[i + w] + mask[i + w + 1];
        out[i] = s >= 5 ? 1 : 0;
      }
    }
    // 边框：按实际邻域大小取多数（只扫最外一圈，不碰内部）
    var edge = function (x0, y0) {
      var c = 0, t = 0;
      for (var dy = -1; dy <= 1; dy++) {
        var yy = y0 + dy;
        if (yy < 0 || yy >= h) continue;
        for (var dx = -1; dx <= 1; dx++) {
          var xx = x0 + dx;
          if (xx < 0 || xx >= w) continue;
          t++;
          if (mask[yy * w + xx]) c++;
        }
      }
      out[y0 * w + x0] = (c * 2 >= t) ? 1 : 0;
    };
    for (x = 0; x < w; x++) { edge(x, 0); if (h > 1) edge(x, h - 1); }
    for (y = 1; y < h - 1; y++) { edge(0, y); if (w > 1) edge(w - 1, y); }
    return out;
  };

  /* ---------------- 双线性上采样（源网格 → 目标网格） ---------------- */
  AO.upsampleBilinear = function (src, sw, sh, dw, dh, scale, outBuf) {
    var dst = (outBuf && outBuf.length === dw * dh) ? outBuf : new Float32Array(dw * dh);
    var x, y;
    for (y = 0; y < dh; y++) {
      var fy = (y + 0.5) / scale - 0.5;
      if (fy < 0) fy = 0;
      var y0 = Math.floor(fy);
      if (y0 > sh - 1) y0 = sh - 1;
      var y1 = y0 + 1 > sh - 1 ? sh - 1 : y0 + 1;
      var ty = fy - y0;
      var r0 = y0 * sw, r1 = y1 * sw, d0 = y * dw;
      for (x = 0; x < dw; x++) {
        var fx = (x + 0.5) / scale - 0.5;
        if (fx < 0) fx = 0;
        var x0 = Math.floor(fx);
        if (x0 > sw - 1) x0 = sw - 1;
        var x1 = x0 + 1 > sw - 1 ? sw - 1 : x0 + 1;
        var tx = fx - x0;
        var a = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * tx;
        var b = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * tx;
        dst[d0 + x] = a + (b - a) * ty;
      }
    }
    return dst;
  };

  /* ---------------- 复用缓冲池 ----------------
   * 每生成一个世界都要跑 3 次连通域标记 + 4 趟形态学 + 2 次 Lloyd，
   * 不共用缓冲的话每代会产生六七十 MB 垃圾，浏览器里每隔几代就有一次
   * 大 GC 正好砸在生成过程中，耗时从 0.6s 跳到 2.5s。
   * 池化之后每代垃圾降到二十 MB 左右。
   */
  AO.scratchBufs = function (n) {
    var s = AO._sb;
    if (!s || s.n !== n) {
      s = AO._sb = {
        n: n,
        u1: new Uint8Array(n),
        u2: new Uint8Array(n),
        u3: new Uint8Array(n),
        i1: new Int32Array(n),
        i2: new Int32Array(n),
        f1: new Float32Array(n),        // 全分辨率高程
        f2: new Float32Array(n),        // chamfer 距离场
        f3: new Float32Array(Math.ceil(n / 4)),  // 1/2 分辨率高程
        f4: new Float32Array(Math.ceil(n / 16)), // 1/4 分辨率骨架
        f5: new Float32Array(Math.ceil(n / 4)),  // 半分辨率高程（地形分带用）
        u4: new Uint16Array(n)          // Lloyd 的临时标签
      };
    }
    return s;
  };

  /* ---------------- 可分离箱式模糊（滑动窗口，O(1)/像素） ----------------
   * 用于在生成地形分带前抹掉细节噪声，只留地形的大走向。 */
  AO.boxBlur = function (src, w, h, r, tmp, dst) {
    var x, y, i, a, b;
    var pre = new Float64Array(Math.max(w, h) + 1);
    // 横向
    for (y = 0; y < h; y++) {
      var row = y * w;
      pre[0] = 0;
      for (x = 0; x < w; x++) pre[x + 1] = pre[x] + src[row + x];
      for (x = 0; x < w; x++) {
        a = x - r; if (a < 0) a = 0;
        b = x + r + 1; if (b > w) b = w;
        tmp[row + x] = (pre[b] - pre[a]) / (b - a);
      }
    }
    // 纵向
    for (x = 0; x < w; x++) {
      pre[0] = 0;
      for (y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
      for (y = 0; y < h; y++) {
        a = y - r; if (a < 0) a = 0;
        b = y + r + 1; if (b > h) b = h;
        dst[y * w + x] = (pre[b] - pre[a]) / (b - a);
      }
    }
    return dst;
  };

  /* ---------------- 用于"同 seed 结果一致"校验的整型散列 ---------------- */
  AO.hashBytes = function (arr) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < arr.length; i += 1) {
      h ^= arr[i] & 0xff;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

})(typeof window !== 'undefined' ? window : globalThis);
