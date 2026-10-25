/* =============================================================
 * 01-noise.js —— 2D Simplex 噪声 + fBm + 域扭曲
 *
 * 坑位 #1：permMod12 的取值是 0..11，所以梯度表必须准备 12 组。
 *         只放 8 组时 gi 可能为 8..11，取到 undefined，
 *         后面 undefined * x → NaN，最终整张高程图变 NaN，世界静默失败。
 *         这里用运行期断言把这个问题钉死。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;

  /* 经典 grad3 的 12 个梯度（Gustavson 表）。
   * 2D 只用到 x/y 分量，后 4 组在 2D 下退化为 (0,±1)，
   * 但它们必须存在，否则 permMod12 命中 8..11 时就是 undefined。 */
  var GX = [1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 0, 0];
  var GY = [1, 1, -1, -1, 0, 0, 1, -1, 1, -1, 1, -1];

  /* ---------------- 构建一个带种子的噪声实例 ---------------- */
  AO.makeNoise = function (seed) {
    var rnd = new AO.RNG(seed >>> 0);
    var p = new Uint8Array(256);
    var i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {          // Fisher–Yates，种子决定置换表
      j = rnd.int(i + 1);
      t = p[i]; p[i] = p[j]; p[j] = t;
    }
    var perm = new Uint8Array(512);
    var permMod12 = new Uint8Array(512);
    for (i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      permMod12[i] = perm[i] % 12;
    }

    /* ------- 单个 2D Simplex 采样，返回值约在 [-1, 1] ------- */
    function noise2(xin, yin) {
      var s = (xin + yin) * F2;
      var ii = Math.floor(xin + s);
      var jj = Math.floor(yin + s);
      var tt = (ii + jj) * G2;
      var x0 = xin - (ii - tt);
      var y0 = yin - (jj - tt);
      var i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      var x1 = x0 - i1 + G2;
      var y1 = y0 - j1 + G2;
      var x2 = x0 - 1 + 2 * G2;
      var y2 = y0 - 1 + 2 * G2;
      var ip = ii & 255, jp = jj & 255;
      var n0 = 0, n1 = 0, n2 = 0;

      var t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 > 0) {
        var g0 = permMod12[ip + perm[jp]];
        t0 *= t0;
        n0 = t0 * t0 * (GX[g0] * x0 + GY[g0] * y0);
      }
      var t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 > 0) {
        var g1 = permMod12[ip + i1 + perm[jp + j1]];
        t1 *= t1;
        n1 = t1 * t1 * (GX[g1] * x1 + GY[g1] * y1);
      }
      var t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 > 0) {
        var g2 = permMod12[ip + 1 + perm[jp + 1]];
        t2 *= t2;
        n2 = t2 * t2 * (GX[g2] * x2 + GY[g2] * y2);
      }
      return 70 * (n0 + n1 + n2);
    }

    /* ------- 分形叠加：octaves 层，lacunarity=2，gain=0.5 ------- */
    function fbm(x, y, octaves, gain, lac) {
      gain = gain === undefined ? 0.5 : gain;
      lac = lac === undefined ? 2 : lac;
      var amp = 1, freq = 1, sum = 0, norm = 0;
      for (var o = 0; o < octaves; o++) {
        sum += amp * noise2(x * freq, y * freq);
        norm += amp;
        amp *= gain;
        freq *= lac;
      }
      return sum / norm;
    }

    return { noise2: noise2, fbm: fbm };
  };

  /* 运行期自检：确认 12 组梯度表被完整命中，没有 undefined */
  AO.assertNoiseTable = function () {
    for (var i = 0; i < 12; i++) {
      if (typeof GX[i] !== 'number' || typeof GY[i] !== 'number' || !isFinite(GX[i]) || !isFinite(GY[i])) {
        throw new Error('Simplex 梯度表第 ' + i + ' 组缺失 → 会产生 NaN');
      }
    }
    var nz = AO.makeNoise(1);
    for (var k = 0; k < 5000; k++) {
      if (!isFinite(nz.noise2(k * 0.37, k * 0.11))) throw new Error('Simplex 输出 NaN');
    }
    return true;
  };

})(typeof window !== 'undefined' ? window : globalThis);
