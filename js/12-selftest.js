/* =============================================================
 * 12-selftest.js —— 验收自检
 * 每条都对应需求里的一条验收标准，返回结构化结果供 UI 展示。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* 世界指纹：标签图 + 归属 + 名字 + 邻接全打包，用来验证可复现性 */
  AO.worldHash = function (w) {
    var parts = [String(w.meta.provinceCount), String(w.meta.countryCount)];
    var h = AO.hashBytes(w.labels);
    parts.push(h);
    for (var i = 0; i < w.provinces.length; i++) {
      var p = w.provinces[i];
      if (!p) continue;
      parts.push(p.id + ':' + p.owner + ':' + p.name + ':' + p.area + ':' + p.neighbors.join(','));
    }
    for (i = 0; i < w.countries.length; i++) {
      parts.push(w.countries[i].name + '/' + w.countries[i].provinces.join(','));
    }
    return AO.hashString(parts.join('|'));
  };

  /* 相邻省多边形之间的几何间隙 */
  function measureGap(world) {
    var prov = world.provinces;
    var gaps = [];
    var i, k, r, q;
    var limit = 4000;   // 采样上限，避免极端情况卡死

    for (i = 0; i < prov.length; i++) {
      var a = prov[i];
      if (!a) continue;
      var pairDone = {};
      for (k = 0; k < a.rings.length; k++) {
        var runs = a.rings[k].runs;
        for (r = 0; r < runs.length; r++) {
          var bId = runs[r].other;
          if (!bId || bId <= a.id) continue;      // 每对只算一次
          if (pairDone[bId]) continue;
          pairDone[bId] = 1;
          var b = prov[bId - 1];
          if (!b) continue;

          var ptsA = collectRunPoints(a, bId);
          var ptsB = collectRunPoints(b, a.id);
          if (!ptsA.length || !ptsB.length) continue;

          var med = medianMinDist(ptsA, ptsB);
          gaps.push(med);
          if (gaps.length >= limit) break;
        }
      }
    }
    gaps.sort(function (x, y) { return x - y; });
    var bad = 0;
    for (var gi = 0; gi < gaps.length; gi++) if (gaps[gi] > 0.01) bad++;
    return {
      n: gaps.length,
      median: gaps.length ? gaps[gaps.length >> 1] : -1,
      max: gaps.length ? gaps[gaps.length - 1] : -1,
      p95: gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))] : -1,
      bad: bad
    };
  }

  function collectRunPoints(p, otherId) {
    var out = [];
    for (var k = 0; k < p.rings.length; k++) {
      var runs = p.rings[k].runs;
      for (var r = 0; r < runs.length; r++) {
        if (runs[r].other !== otherId) continue;
        var pts = runs[r].pts;
        for (var i = 0; i < pts.length; i += 2) out.push(pts[i], pts[i + 1]);
      }
    }
    return out;
  }

  /* 对 A 的每个点，求到 B 点集的最近距离，取中位数 */
  function medianMinDist(a, b) {
    var ds = [];
    for (var i = 0; i < a.length; i += 2) {
      var bx = a[i], by = a[i + 1];
      var best = Infinity;
      for (var j = 0; j < b.length; j += 2) {
        var dx = bx - b[j], dy = by - b[j + 1];
        var d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      ds.push(Math.sqrt(best));
    }
    ds.sort(function (x, y) { return x - y; });
    return ds[ds.length >> 1];
  }

  AO.selfTest = function (world, opts) {
    var checks = [];
    function add(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail }); }
    var m = world.meta;
    var i, k;
    var rep = null;      // 第 8 条顺手生成的两个世界，留给第 17 条资源可复现校验复用

    /* 1. 生成耗时 */
    var ms = m.timing.total;
    add('生成耗时 < 3s', ms < 3000, Math.round(ms) + ' ms（地形 ' + Math.round(m.timing.terrain) +
      ' / 布点 ' + Math.round(m.timing.seeds) + ' / 切分 ' + Math.round(m.timing.partition) +
      ' / 几何 ' + Math.round(m.timing.geometry) + '）');

    /* 2. 相邻多边形几何间隙 */
    var gap = measureGap(world);
    add('相邻省多边形中位间隙 < 0.01 px', gap.median >= 0 && gap.median < 0.01 && gap.bad === 0,
      '中位 ' + (gap.median < 0 ? 'n/a' : gap.median.toFixed(5)) + ' px，p95 ' +
      (gap.p95 < 0 ? 'n/a' : gap.p95.toFixed(4)) + '，最大 ' + (gap.max < 0 ? 'n/a' : gap.max.toFixed(4)) +
      '；超标对数 ' + gap.bad + '/' + gap.n);

    /* 3. 邻接表对称 */
    var asym = [];
    for (i = 0; i < world.provinces.length; i++) {
      var p = world.provinces[i];
      if (!p) continue;
      for (k = 0; k < p.neighbors.length; k++) {
        var q = world.provinces[p.neighbors[k] - 1];
        if (!q || q.neighbors.indexOf(p.id) < 0) asym.push(p.id + '→' + p.neighbors[k]);
      }
    }
    add('邻接表对称', asym.length === 0, asym.length ? '不对称 ' + asym.length + ' 条：' + asym.slice(0, 5).join(' ') : '全部双向一致');

    /* 4. 邻接度分布 */
    var hist = {}, sum = 0, cnt = 0, low = 0, maxDeg = 0;
    for (i = 0; i < world.provinces.length; i++) {
      var pp = world.provinces[i];
      if (!pp) continue;
      var d = pp.neighbors.length;
      hist[d] = (hist[d] || 0) + 1;
      sum += d; cnt++;
      if (d <= 2) low++;
      if (d > maxDeg) maxDeg = d;
    }
    var mean = cnt ? sum / cnt : 0;
    var lowPct = cnt ? low / cnt : 1;
    var histStr = Object.keys(hist).sort(function (a, b) { return a - b; })
      .map(function (k2) { return k2 + ':' + hist[k2]; }).join(' ');
    add('平均邻接度在 3~7', mean >= 3 && mean <= 7, '均值 ' + mean.toFixed(2) + '，直方图 ' + histStr);
    // 省份很少时碎岛比例天然偏高，阈值相应放宽
    var lowLimit = m.provinceCount < 200 ? 0.26 : 0.15;
    add('邻接度二维分布（不成链）', lowPct < lowLimit && maxDeg >= 6,
      '≤2 度占比 ' + (lowPct * 100).toFixed(1) + '%（上限 ' + (lowLimit * 100).toFixed(0) +
      '%），最大度 ' + maxDeg + '，不同度值 ' + Object.keys(hist).length + ' 种');

    /* 5. 陆地像素全部命中省份 / 海面不误命中 */
    var W = m.width, H = m.height;
    var missLand = 0, seaHit = 0, landN = 0;
    for (i = 0; i < world.labels.length; i++) {
      var l = world.labels[i];
      var isLand = world.land[i];
      if (isLand) { landN++; if (!l) missLand++; }
      else if (l) seaHit++;
    }
    add('陆地上每个像素都命中省份', missLand === 0, '陆地像素 ' + landN + '，未命中 ' + missLand);
    add('海面不会误命中省份', seaHit === 0, '海面误命中 ' + seaHit + ' 个像素');

    /* 5b. 用渲染同款命中函数抽测 */
    var badPick = 0, tested = 0;
    for (i = 0; i < 20000; i++) {
      var wx = (i * 7919 % W) + 0.5, wy = ((i * 104729) % H) + 0.5;
      var id = AO.pickProvince(world, wx, wy);
      tested++;
      var gx = Math.floor(wx), gy = Math.floor(wy);
      if (id !== world.labels[gy * W + gx]) badPick++;
      if (id && !world.provinces[id - 1]) badPick++;
    }
    add('命中检测与标签图一致', badPick === 0, tested + ' 次抽样，不一致 ' + badPick);

    /* 6. 同国相邻省之间没有边界线段 */
    var cls = AO.collectRuns(world);
    var internal = 0;
    var borderPairs = {};
    for (i = 0; i < cls.border.length; i++) {
      borderPairs[cls.border[i].a + ':' + cls.border[i].b] = 1;
    }
    // collectRuns 里已经按 owner 过滤，这里再拿邻接表反查一遍：
    // 凡是"同国 + 相邻"的省对，都不应该出现在省界集合里
    for (i = 0; i < world.provinces.length; i++) {
      var pa = world.provinces[i];
      if (!pa) continue;
      for (k = 0; k < pa.neighbors.length; k++) {
        var qb = world.provinces[pa.neighbors[k] - 1];
        if (!qb || qb.owner !== pa.owner) continue;
        if (borderPairs[pa.id + ':' + qb.id] || borderPairs[qb.id + ':' + pa.id]) internal++;
      }
    }
    add('同国相邻省之间无分界线', internal === 0 && cls.border.length > 0,
      '同国相邻对被画线的数量 ' + internal + '；可见省界 run ' + cls.border.length + '；海岸 run ' + cls.coast.length);

    /* 7. 归属双向一致 */
    var bad = 0;
    for (i = 0; i < world.countries.length; i++) {
      var c = world.countries[i];
      for (k = 0; k < c.provinces.length; k++) {
        var pv = world.provinces[c.provinces[k] - 1];
        if (!pv || pv.owner !== c.id) bad++;
      }
    }
    var listed = 0;
    for (i = 0; i < world.provinces.length; i++) if (world.provinces[i]) listed++;
    var totalMembers = world.countries.reduce(function (a, c2) { return a + c2.provinces.length; }, 0);
    add('省份归属与国家成员表双向一致', bad === 0 && totalMembers === listed,
      '省份 ' + listed + ' / 成员条目 ' + totalMembers + ' / 冲突 ' + bad);

    /* 8. 同 seed 可复现 & 不同 seed 有差异 */
    if (opts && typeof AO.generate === 'function') {
      var liveHash = AO.worldHash(world);
      try {
        var w2 = AO.generate(opts);
        var h2 = AO.worldHash(w2);
        var w2b = AO.generate(opts);
        var h2b = AO.worldHash(w2b);
        rep = { a: w2, b: w2b };
        var edited = liveHash !== h2;
        add('同 seed 两次生成完全一致', h2 === h2b,
          '指纹 ' + h2.toString(16) + ' vs ' + h2b.toString(16) +
          (edited ? '（当前画面已被手动涂色修改，指纹 ' + liveHash.toString(16) + '）' : ''));

        var opts2 = {};
        for (var kk in opts) opts2[kk] = opts[kk];
        opts2.seed = String(opts.seed) + '-different';
        var w3 = AO.generate(opts2);
        var h3 = AO.worldHash(w3);
        // 陆地掩膜 IoU：真正衡量"大陆形状是否不同"
        var inter = 0, uni = 0;
        for (var mi = 0; mi < world.land.length; mi++) {
          var la = world.land[mi], lb = w3.land[mi];
          if (la && lb) inter++;
          if (la || lb) uni++;
        }
        var iou = uni ? inter / uni : 1;
        add('换 seed 得到不同大陆', h3 !== h2 && iou < 0.9,
          '指纹 ' + h3.toString(16) + '，陆地掩膜重合度 IoU ' + iou.toFixed(3) + '（越低越不同）');
      } catch (e) {
        add('可复现性检查', false, '异常：' + e.message);
      }
    }

    /* 9. 多边形面积 vs 像素面积（几何自洽）
     * 用带符号求和：外环正、洞（湖）负，环方向已在生成末尾规范化。
     * Marching Squares 会在边界像素上切角，小省会因此损失几个百分点。 */
    var maxErr = 0, sumPoly = 0, sumPix = 0;
    for (i = 0; i < world.provinces.length; i++) {
      var pz = world.provinces[i];
      if (!pz || !pz.area) continue;
      var sumA = 0;
      for (k = 0; k < pz.rings.length; k++) sumA += pz.rings[k].area;
      sumPoly += sumA;
      sumPix += pz.area;
      var err = Math.abs(sumA - pz.area) / pz.area;
      if (err > maxErr) maxErr = err;
    }
    var gErr = sumPix ? Math.abs(sumPoly - sumPix) / sumPix : 1;
    add('多边形面积与像素面积一致', gErr < 0.03 && maxErr < 0.10,
      '总面积偏差 ' + (gErr * 100).toFixed(2) + '%，单省最大偏差 ' + (maxErr * 100).toFixed(2) + '%');

    /* 10. 没有空省份 / 空国家 */
    var emptyP = 0, emptyC = 0;
    for (i = 0; i < world.provinces.length; i++) {
      var p4 = world.provinces[i];
      if (p4 && (!p4.rings.length || !p4.area)) emptyP++;
    }
    for (i = 0; i < world.countries.length; i++) if (!world.countries[i].provinces.length) emptyC++;
    add('无空省份 / 空国家', emptyP === 0 && emptyC === 0, '空省份 ' + emptyP + '，空国家 ' + emptyC);

    /* 11. 国家资料完整性（08b-society） */
    var badC = 0, badP = 0, noFace = 0;
    for (i = 0; i < world.countries.length; i++) {
      var cc = world.countries[i];
      if (!cc.govCn || !cc.economy || !cc.faith || !cc.faith.cn ||
          !cc.leader || !cc.leader.name || !cc.leader.title) badC++;
      if (!(cc.population > 0) || !(cc.areaKm2 > 0)) badP++;
      // 信仰构成：至少两种、合计 100%、主信仰与列表首项一致
      var fsum = 0, fl = cc.faiths || [];
      for (var fq = 0; fq < fl.length; fq++) fsum += fl[fq].pct;
      if (fl.length < 2 || Math.abs(fsum - 1) > 0.002 || fl[0] !== cc.faith) badP++;
      if (!cc.portrait || cc.portrait.indexOf('<svg') !== 0) noFace++;
      var pctSum = 0, tc = cc.terrainComp || [];
      for (var q = 0; q < tc.length; q++) pctSum += tc[q].pct;
      if (!tc.length || Math.abs(pctSum - 1) > 0.01) badP++;
      /* 省人口：每省都得有人，且各省之和 = 国人口（08b 按面积×地形密度摊下去的） */
      var pSum = 0, pMiss = 0;
      for (var pp = 0; pp < cc.provinces.length; pp++) {
        var pvq = world.provinces[cc.provinces[pp] - 1];
        if (!pvq || !(pvq.population > 0)) { pMiss++; continue; }
        pSum += pvq.population;
      }
      if (pMiss || Math.abs(pSum - cc.population) > Math.max(1000, cc.population * 0.005)) badP++;
    }
    add('国家资料完整', badC === 0 && badP === 0 && noFace === 0,
      world.countries.length + ' 国：政体/经济/信仰/领导人缺失 ' + badC +
      '；人口/面积/地形占比/省人口合计异常 ' + badP + '；头像缺失 ' + noFace);

    /* 12. 河网 */
    var rvs = world.rivers || [];
    var offLand = 0, rvPts = 0;
    for (i = 0; i < rvs.length; i++) {
      var pts = rvs[i].pts;
      for (k = 0; k < pts.length; k += 2) {
        rvPts++;
        var rx = Math.floor(pts[k]), ry = Math.floor(pts[k + 1]);
        if (rx < 0 || ry < 0 || rx >= W || ry >= H) { offLand++; continue; }
        if (!world.labels[ry * W + rx]) offLand++;
      }
    }
    add('河网落在陆地上', rvs.length > 0 && offLand === 0,
      rvs.length + ' 条河 / ' + rvPts + ' 个点，不在陆地上的点 ' + offLand);

    /* 17. 资源层（15-resources）—— 七种齐全 / 储量合法 / 地形偏好 / 汇总一致 / 可复现 */
    var rTot = 0, rBadN = 0, rMissing = 0, rUnsorted = 0, rKinds = 0, rSumP = 0;
    var rMtnN = 0, rMtnG = 0, rPlnN = 0, rPlnG = 0;
    var rCoastN = 0, rCoastBy = {}, rSeq = [];
    var rFull = (1 << (AO.RESOURCES ? AO.RESOURCES.length : 7)) - 1;
    for (i = 0; i < world.provinces.length; i++) {
      var pr = world.provinces[i];
      if (!pr) continue;
      rTot++;
      var rs = pr.resources || [];
      var topK = rs.length ? rs[0].key : null;
      /* 逐省签名：种类 + 储量，用于同 seed 比对 */
      var sig = '', mask = 0, prev = 101;
      for (k = 0; k < rs.length; k++) {
        sig += rs[k].key + rs[k].n + ';';
        rSumP += rs[k].n;
        if (!(rs[k].n >= 1 && rs[k].n <= 100) || rs[k].n !== Math.round(rs[k].n)) rBadN++;
        if (rs[k].n > prev) rUnsorted++;              // 必须按储量降序
        prev = rs[k].n;
        mask |= 1 << (AO.RESOURCE_INDEX[rs[k].key] || 0);
        rKinds++;
      }
      if (mask !== rFull) rMissing++;                 // 七种资源必须齐全
      rSeq.push(sig);
      if (pr.terrain === 'mountains') {
        rMtnN++;
        if (topK === 'iron' || topK === 'gold') rMtnG++;
      }
      if (pr.terrain === 'plains') {
        rPlnN++;
        if (topK === 'iron' || topK === 'gold') rPlnG++;
      }
      /* 岸线类别用 coastDirs 判，不看 terrain —— 地形里已经没有"沿海"这种东西，
       * "临不临海"是岸线画像（几面临海 / 陡岸 / 河口）的事。 */
      if (pr.coastDirs > 0) {
        rCoastN++;
        rCoastBy[topK] = (rCoastBy[topK] || 0) + 1;
      }
    }
    var rMtnPct = rMtnN ? rMtnG / rMtnN : -1;
    var rPlnPct = rPlnN ? rPlnG / rPlnN : -1;
    var rCoastTop = null, rCoastMax = -1;
    for (var rck in rCoastBy) if (rCoastBy[rck] > rCoastMax) { rCoastMax = rCoastBy[rck]; rCoastTop = rck; }
    var rSumC = 0;
    for (i = 0; i < world.countries.length; i++) {
      var crs = world.countries[i].resources || [];
      for (k = 0; k < crs.length; k++) rSumC += crs[k].n;
    }
    /* 逐省可复现：拿第 8 条已经生成好的两个世界比，不再多算一遍 */
    var rSame = true, rSameNote = '（未复现：缺少 opts）';
    if (rep) {
      var rSeq2 = [];
      for (i = 0; i < rep.a.provinces.length; i++) {
        var pa2 = rep.a.provinces[i];
        if (!pa2) continue;
        var sig2 = '', rs2 = pa2.resources || [];
        for (k = 0; k < rs2.length; k++) sig2 += rs2[k].key + rs2[k].n + ';';
        rSeq2.push(sig2);
      }
      rSame = rSeq2.length === rSeq.length;
      for (i = 0; rSame && i < rSeq2.length; i++) if (rSeq2[i] !== rSeq[i]) rSame = false;
      rSameNote = rSame ? '同 seed 逐省一致' : '同 seed 出现分歧';
    }
    var coastOK = !(rCoastN > 0) || rCoastTop === 'fish';
    add('资源层（七种齐全 / 储量 / 地形偏好 / 汇总 / 可复现）',
      rMissing === 0 && rBadN === 0 && rUnsorted === 0 && rMtnPct > rPlnPct && coastOK &&
      rSumC === rSumP && rSame,
      rTot + ' 省 × ' + AO.RESOURCES.length + ' 种（缺项 ' + rMissing + '）；' +
      '储量越界 ' + rBadN + ' 条、乱序 ' + rUnsorted + ' 条（应 1~100 且降序）' +
      '；山地主导铁金 ' + (rMtnPct < 0 ? 'n/a' : (rMtnPct * 100).toFixed(1) + '%') +
      ' vs 平原 ' + (rPlnPct < 0 ? 'n/a' : (rPlnPct * 100).toFixed(1) + '%') +
      '；海岸主导 ' + (rCoastTop || 'n/a') + (rCoastN ? '（' + rCoastMax + '/' + rCoastN + '）' : '') +
      '；国家储量合计 ' + rSumC + ' / 省合计 ' + rSumP + '；' + rSameNote);

    var pass = checks.every(function (c) { return c.ok; });
    return { pass: pass, checks: checks, meta: m };
  };

})(typeof window !== 'undefined' ? window : globalThis);
