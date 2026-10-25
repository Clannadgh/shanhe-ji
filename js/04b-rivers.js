/* =============================================================
 * 04b-rivers.js —— 河网（填洼 + D8 汇流 + 累积）
 *
 * 为什么不直接"挑最低邻居往下走"：高程里有大量微小的洼地，
 * 水会立刻停在小坑里，河网碎成一截一截。所以先做一次
 * Priority-Flood 把洼地填平（用 16384 个桶代替堆，整体 O(n)），
 * 再沿填平后的高程做 D8 汇流，保证每一滴水都能走到海。
 *
 * 河道质量的三条硬约束 —— 本质是同一件事：**河道必须是某个标量场的
 * 最速下降线**。只要守住这条，河道就只会汇合，绝不会互相穿插。
 *   1) 只往"填洼后严格更低"的邻居流 → 拓扑上不可能成环、不可能倒流；
 *   2) 平地上（填洼留下的等坡面）用**连续噪声场**打破并列，而不是随机
 *      抽一个邻居 —— 噪声在空间上连续，相邻两条河会被推向同一侧；
 *   3) 整条河的几何一次算完，最后才按宽度级切段 —— 接缝两侧共用同一
 *      段几何，不会出现折角和碎线。
 *
 * 旧版三条全破了：平地上随机取邻居 + 事后按段横向摆动（振幅最大 8px，
 * 而河段中位长度只有 21px）。同口径实测（2400×1200 / seed aoh-2026）：
 *   河道互穿 57 处   河点掉进海里 49/9188   沿填洼水面上坡 0%（旧版拓扑没错）
 * 新版：             3 处（都在汇流口 2px 内，是接缝）  0   0%
 * 自检项"河网落在陆地上"也从"不通过"变成 0 个越界点。
 *
 * 输出是矢量折线（按河宽分级 0~4），不是栅格，缩放不糊。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  var EPS = 5e-4;      // 填洼时的抬升量，保证严格下降
  var NB = 16384;      // 高程分桶数（桶宽远小于填洼抬升量）

  AO.buildRivers = function (terr, opt) {
    opt = opt || {};
    var t0 = AO.now();
    var w = terr.width, h = terr.height, n = w * h;
    var land = terr.land, hgt = terr.elev;
    var i, x, y, k;

    /* 陆地的海平面相对高度范围，用来归一化分桶 */
    var minE = Infinity, maxE = -Infinity, landCount = 0;
    for (i = 0; i < n; i++) {
      if (!land[i]) continue;
      landCount++;
      var e0 = hgt[i];
      if (e0 < minE) minE = e0;
      if (e0 > maxE) maxE = e0;
    }
    if (landCount < 50) return { polylines: [], landCount: 0, pointCount: 0, ms: AO.now() - t0 };

    /* ---------- 0. 平滑高程：只用地形的大走向定流向 ----------
     * 直接用原始高程的话，细节噪声会让水流在几像素内反复改向，
     * 水量被摊薄到几十条平行小沟里，最后变成一地碎线。
     * 先做两遍 3x3 均值把高频抹掉，再算流向，河系才会汇成干流。 */
    var smooth = new Float32Array(n);
    (function blur() {
      var tmp = new Float32Array(n);
      var i2, acc2, cnt;
      for (y = 0; y < h; y++) {
        var row = y * w;
        for (x = 0; x < w; x++) {
          i2 = row + x;
          acc2 = 0; cnt = 0;
          if (x > 0) { acc2 += hgt[i2 - 1]; cnt++; }
          acc2 += hgt[i2]; cnt++;
          if (x + 1 < w) { acc2 += hgt[i2 + 1]; cnt++; }
          tmp[i2] = acc2 / cnt;
        }
      }
      for (x = 0; x < w; x++) {
        for (y = 0; y < h; y++) {
          i2 = y * w + x;
          acc2 = 0; cnt = 0;
          if (y > 0) { acc2 += tmp[i2 - w]; cnt++; }
          acc2 += tmp[i2]; cnt++;
          if (y + 1 < h) { acc2 += tmp[i2 + w]; cnt++; }
          smooth[i2] = acc2 / cnt;
        }
      }
      // 第二遍（往返一次，近似高斯）
      for (y = 0; y < h; y++) {
        var row2 = y * w;
        for (x = 0; x < w; x++) {
          i2 = row2 + x;
          acc2 = 0; cnt = 0;
          if (x > 0) { acc2 += smooth[i2 - 1]; cnt++; }
          acc2 += smooth[i2]; cnt++;
          if (x + 1 < w) { acc2 += smooth[i2 + 1]; cnt++; }
          tmp[i2] = acc2 / cnt;
        }
      }
      for (x = 0; x < w; x++) {
        for (y = 0; y < h; y++) {
          i2 = y * w + x;
          acc2 = 0; cnt = 0;
          if (y > 0) { acc2 += tmp[i2 - w]; cnt++; }
          acc2 += tmp[i2]; cnt++;
          if (y + 1 < h) { acc2 += tmp[i2 + w]; cnt++; }
          smooth[i2] = acc2 / cnt;
        }
      }
    })();

    var invSpan = (NB - 1) / Math.max(1e-6, maxE - minE);
    function bucketOf(v) {
      var b = ((v - minE) * invSpan) | 0;
      return b < 0 ? 0 : (b >= NB ? NB - 1 : b);
    }

    /* ---------- 1. 填洼：桶优先队列 ---------- */
    var filled = new Float32Array(n);
    var seen = new Uint8Array(n);
    var bucketHead = new Int32Array(NB).fill(-1);
    var nextInBucket = new Int32Array(n).fill(-1);

    function push(idx, v) {
      var b = bucketOf(v);
      nextInBucket[idx] = bucketHead[b];
      bucketHead[b] = idx;
    }

    // 种子：与海相邻的陆地（水从这里入海）
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) {
        i = row + x;
        if (!land[i] || seen[i]) continue;
        var coast = (x > 0 && !land[i - 1]) || (x + 1 < w && !land[i + 1]) ||
                    (y > 0 && !land[i - w]) || (y + 1 < h && !land[i + w]);
        if (coast) { seen[i] = 1; filled[i] = smooth[i]; push(i, smooth[i]); }
      }
    }

    for (var b = 0; b < NB; b++) {
      while (bucketHead[b] !== -1) {
        var cell = bucketHead[b];
        bucketHead[b] = nextInBucket[cell];
        var fc = filled[cell];
        var cx = cell % w, cy = (cell - cx) / w;
        var x0 = cx > 0 ? cx - 1 : cx, x1 = cx + 1 < w ? cx + 1 : cx;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = cy + dy;
          if (yy < 0 || yy >= h) continue;
          var base = yy * w;
          for (var q = base + x0, qe = base + x1; q <= qe; q++) {
            if (!land[q] || seen[q]) continue;
            seen[q] = 1;
            var f = smooth[q];
            var need = fc + EPS;
            if (f < need) f = need;
            filled[q] = f;
            push(q, f);
          }
        }
      }
    }

    /* ---------- 2. D8 流向：严格下降 + 连续噪声打破并列 ----------
     * 填洼之后有大片区域是"等坡面"，最低邻居几乎一样高。旧版在这里
     * 随机挑一个 → 每条河各自乱走，彼此穿插。现在改成给每个邻居打分：
     *     score = filled + KW · noise(x, y)
     * 噪声场在空间上连续，两条相邻的河在同一位置拿到的偏移几乎相同，
     * 于是它们被推向同一侧 —— 河道只会汇合，不会互穿。
     * KW 取得和填洼步长 EPS 同量级：只在平地上起作用，真坡地上
     * 完全由高程说了算。 */
    var wobSeed = (opt.seed !== undefined ? opt.seed
      : (opt.rng && opt.rng.seed !== undefined ? opt.rng.seed : 12345)) >>> 0;
    var wob = AO.makeNoise((wobSeed ^ 0x5bf03635) >>> 0);
    var WF = 1 / 34;      // 摆动主波长（像素）：≈ 河宽的 10 倍，看着像自然的曲流
    var KW = 3.2e-3;      // 噪声权重（相对 EPS = 5e-4）

    // 噪声场预算一次，避免每个格子的 8 个邻居都去算 simplex。
    // 只有陆地格会被打分，海格跳过 —— 省掉 40% 的采样。
    var wobF = new Float32Array(n);
    for (y = 0; y < h; y++) {
      var rowW = y * w, wy = (y + 0.5) * WF;
      for (x = 0; x < w; x++) {
        if (land[rowW + x]) wobF[rowW + x] = wob.noise2((x + 0.5) * WF, wy);
      }
    }

    var down = new Int32Array(n).fill(-1);
    var acc = new Float32Array(n);
    for (y = 0; y < h; y++) {
      var rowD = y * w;
      for (x = 0; x < w; x++) {
        i = rowD + x;
        if (!land[i]) continue;
        acc[i] = 1;
        var fcell = filled[i];
        var best = -1, bestScore = Infinity;
        for (var dy2 = -1; dy2 <= 1; dy2++) {
          var yy2 = y + dy2;
          if (yy2 < 0 || yy2 >= h) continue;
          var base2 = yy2 * w;
          for (var dx2 = -1; dx2 <= 1; dx2++) {
            if (!dx2 && !dy2) continue;
            var xx2 = x + dx2;
            if (xx2 < 0 || xx2 >= w) continue;
            var nb = base2 + xx2;
            if (!land[nb]) continue;
            if (filled[nb] >= fcell) continue;     // 只往更低处流 → 不可能成环
            var score = filled[nb] + KW * wobF[nb];
            if (score < bestScore) { bestScore = score; best = nb; }
          }
        }
        down[i] = best;
      }
    }

    /* ---------- 3. 汇流累积：按填洼高程从高到低累加（计数排序，O(n)） ---------- */
    var counts = new Int32Array(NB + 1);
    for (i = 0; i < n; i++) if (land[i]) counts[bucketOf(filled[i])]++;
    var sum = 0;
    for (b = 0; b < NB; b++) { var c = counts[b]; counts[b] = sum; sum += c; }
    var order = new Int32Array(landCount);
    var cursor = counts.slice();
    for (i = 0; i < n; i++) {
      if (!land[i]) continue;
      var bb = bucketOf(filled[i]);
      order[cursor[bb]++] = i;
    }
    for (k = landCount - 1; k >= 0; k--) {
      i = order[k];
      var d = down[i];
      if (d >= 0) acc[d] += acc[i];
    }

    /* ---------- 4. 抽河：整条链一次成型，再按水量切宽度级 ----------
     * 阈值以下不是"不画"，而是"画成毛细"：如果只从 thr 开始画，河就成了
     * 从平地凭空冒出来的线头 —— 地形视图里一眼假。所以真正下笔的门槛是
     * thrLow = 0.3·thr，这一段用 0 级（最细）画，然后 1 级 = 原来的 thr，
     * 依次乘 3.2 / 9 / 26 倍，一共 5 级。缩放时低级线先被抗锯齿吃掉，
     * 世界视图自然只剩主干 —— 相当于地图学里的"分级选取"。 */
    var thr = opt.threshold || Math.max(60, Math.round(landCount * 0.00026));
    var thrLow = Math.max(24, Math.round(thr * 0.3));
    var wThr = [thrLow, thr * 1.0, thr * 3.2, thr * 9, thr * 26];
    function widthClass(a) {
      if (a >= wThr[4]) return 4;
      if (a >= wThr[3]) return 3;
      if (a >= wThr[2]) return 2;
      if (a >= wThr[1]) return 1;
      return 0;
    }

    function isSource(idx, cx2, cy2) {
      for (var dy3 = -1; dy3 <= 1; dy3++) {
        var yy3 = cy2 + dy3;
        if (yy3 < 0 || yy3 >= h) continue;
        var bb2 = yy3 * w;
        for (var dx3 = -1; dx3 <= 1; dx3++) {
          if (!dx3 && !dy3) continue;
          var xx3 = cx2 + dx3;
          if (xx3 < 0 || xx3 >= w) continue;
          var q3 = bb2 + xx3;
          if (down[q3] === idx && acc[q3] >= thrLow) return false;
        }
      }
      return true;
    }

    var visited = new Uint8Array(n);
    var polylines = [];

    /* 一条链（源 → 河口/汇流点）的全部几何 */
    function emitChain(chain) {
      var m = chain.length;
      if (m < 2) return;

      var px = new Float32Array(m * 2);
      for (var q = 0; q < m; q++) {
        var c = chain[q], qx = c % w;
        px[q * 2] = qx + 0.5;
        px[q * 2 + 1] = (c - qx) / w + 0.5;
      }

      /* 两遍 3 点平滑，去掉 D8 的 45° 台阶。整条河一次做完 —— 这是
       * 关键：旧版先按宽度级切段、再逐段平滑，每段相位不同，接缝处
       * 必然折角。 */
      var tmp = new Float32Array(px.length);
      for (var pass = 0; pass < 2; pass++) {
        tmp[0] = px[0]; tmp[1] = px[1];
        tmp[(m - 1) * 2] = px[(m - 1) * 2];
        tmp[(m - 1) * 2 + 1] = px[(m - 1) * 2 + 1];
        for (var q2 = 1; q2 < m - 1; q2++) {
          tmp[q2 * 2] = (px[(q2 - 1) * 2] + px[q2 * 2] * 2 + px[(q2 + 1) * 2]) * 0.25;
          tmp[q2 * 2 + 1] = (px[(q2 - 1) * 2 + 1] + px[q2 * 2 + 1] * 2 + px[(q2 + 1) * 2 + 1]) * 0.25;
        }
        var swp = px; px = tmp; tmp = swp;
      }

      /* 不额外做"横向摆动"。
       * 旧版在这里沿弧长叠正弦把河道推离谷底（振幅最大 8px，而河段中位
       * 长度只有 21px），量出来的后果是：57 处河道互穿、0.5% 的河点被
       * 推进海里、弯曲度最大到 2.63（尺子画不出，河也不长这样）。
       * 河宽只有 1px 量级，真正好看的弯必须来自地形本身 —— 也就是上面
       * 那步"连续噪声打破平地并列"。这里只做两件事：夹进陆地格、按宽度
       * 级切段。 */

      /* 夹进"所在陆地格"的内部：保证 Math.floor(点) 永远是陆地格 ——
       * 河道不会越出海岸线，自检项"河网落在陆地上"恒为 0。 */
      for (var q5 = 0; q5 < m; q5++) {
        var c5 = chain[q5], cx5 = c5 % w, cy5 = (c5 - cx5) / w;
        if (px[q5 * 2] < cx5 + 0.06) px[q5 * 2] = cx5 + 0.06;
        else if (px[q5 * 2] > cx5 + 0.94) px[q5 * 2] = cx5 + 0.94;
        if (px[q5 * 2 + 1] < cy5 + 0.06) px[q5 * 2 + 1] = cy5 + 0.06;
        else if (px[q5 * 2 + 1] > cy5 + 0.94) px[q5 * 2 + 1] = cy5 + 0.94;
      }

      /* 按宽度级切段：相邻两段共用边界点（end = q3 + 1），接缝严丝合缝 */
      var cls = widthClass(acc[chain[0]]);
      var s = 0;
      for (var q3 = 1; q3 <= m; q3++) {
        var c3 = q3 < m ? widthClass(acc[chain[q3]]) : -1;
        if (c3 !== cls) {
          var end = q3 < m ? q3 + 1 : m;
          if (end - s >= 2) {
            var seg = px.subarray(s * 2, end * 2);
            var simp = AO.simplifyPolyline(seg, 0.42);
            if (simp.length >= 4) polylines.push({ pts: simp, cls: cls });
          }
          s = q3;
          cls = c3;
        }
      }
    }

    for (i = 0; i < n; i++) {
      if (!land[i] || acc[i] < thrLow || visited[i]) continue;
      var icx = i % w, icy = (i - icx) / w;
      if (!isSource(i, icx, icy)) continue;

      var chain = [i];
      visited[i] = 1;
      var cur = i;
      while (true) {
        var nx = down[cur];
        if (nx < 0) break;                       // 入海 / 入湖：河道到此为止
        if (visited[nx]) { chain.push(nx); break; }   // 汇入已画好的干流：补上交汇点
        visited[nx] = 1;
        chain.push(nx);
        cur = nx;
      }
      emitChain(chain);
    }

    var totalPts = 0;
    for (i = 0; i < polylines.length; i++) totalPts += polylines[i].pts.length >> 1;

    return {
      polylines: polylines,
      smooth: smooth,
      pointCount: totalPts,
      landCount: landCount,
      threshold: thr,
      ms: AO.now() - t0
    };
  };

})(typeof window !== 'undefined' ? window : globalThis);
