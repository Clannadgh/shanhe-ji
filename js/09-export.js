/* =============================================================
 * 09-export.js —— GeoJSON / 紧凑游戏 JSON
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* 把一个省的所有环整理成 [outer, ...holes] 结构 */
  function buildPolygons(rings) {
    var sorted = rings.slice().sort(function (a, b) { return Math.abs(b.area) - Math.abs(a.area); });
    var polys = [];
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      var host = null;
      for (var p = polys.length - 1; p >= 0; p--) {
        if (AO.pointInRing(r.coords[0], r.coords[1], polys[p].outer.coords)) { host = polys[p]; break; }
      }
      if (host) host.holes.push(r);
      else polys.push({ outer: r, holes: [] });
    }
    return polys;
  }
  AO.buildPolygons = buildPolygons;

  /* 环 → 坐标数组，并把方向规范成「外环正向 / 洞反向」 */
  function ringToCoords(ring, wantPositive) {
    var pts = ring.coords;
    var n = pts.length >> 1;
    var positive = ring.area > 0;
    var out = [];
    var i;
    if (n > 1 && pts[0] === pts[(n - 1) * 2] && pts[1] === pts[(n - 1) * 2 + 1]) n--;  // 去掉重复闭合点
    if (positive === wantPositive) {
      for (i = 0; i < n; i++) out.push([r3(pts[i * 2]), r3(pts[i * 2 + 1])]);
    } else {
      for (i = n - 1; i >= 0; i--) out.push([r3(pts[i * 2]), r3(pts[i * 2 + 1])]);
    }
    out.push([out[0][0], out[0][1]]);
    return out;
  }

  /* ---------------- 边界段分类（渲染与自检共用同一套判定） ----------------
   * coast  : 陆 / 海 之间的 run → 画粗一点的海岸线
   * border : 两个"不同国家"的省之间的 run → 画细省界
   * 同国相邻省之间**不产生任何线段**，这正是 AoH2 的关键观感。
   */
  AO.collectRuns = function (world) {
    var coast = [], border = [];
    var prov = world.provinces;
    for (var i = 0; i < prov.length; i++) {
      var p = prov[i];
      if (!p) continue;
      for (var k = 0; k < p.rings.length; k++) {
        var runs = p.rings[k].runs;
        for (var r = 0; r < runs.length; r++) {
          var run = runs[r];
          if (run.other === 0 || run.other >= 32000) { coast.push({ pts: run.pts, a: p.id, b: 0 }); continue; }
          if (run.other < p.id) continue;          // 共享边只画一次
          var q = prov[run.other - 1];
          if (!q) continue;
          if (q.owner !== p.owner) border.push({ pts: run.pts, a: p.id, b: run.other });
        }
      }
    }
    return { coast: coast, border: border };
  };

  /* ---------------- GeoJSON ---------------- */
  AO.worldToGeoJSON = function (world) {
    var feats = [];
    for (var i = 0; i < world.provinces.length; i++) {
      var p = world.provinces[i];
      if (!p) continue;
      var country = world.countries[p.owner - 1];
      var polys = buildPolygons(p.rings);
      var coords = [];
      for (var k = 0; k < polys.length; k++) {
        var poly = [ringToCoords(polys[k].outer, true)];
        for (var h = 0; h < polys[k].holes.length; h++) poly.push(ringToCoords(polys[k].holes[h], false));
        coords.push(poly);
      }
      feats.push({
        type: 'Feature',
        id: p.id,
        properties: {
          id: p.id,
          name: p.name,
          name_en: p.name_en,
          owner: p.owner,
          owner_name: country ? country.name : '',
          owner_color: country ? country.color : '#999999',
          terrain: p.terrain,
          area: p.area,
          centroid: [r3(p.centroid[0]), r3(p.centroid[1])],
          neighbors: p.neighbors.slice()
        },
        geometry: { type: 'MultiPolygon', coordinates: coords }
      });
    }
    return {
      type: 'FeatureCollection',
      name: 'fictional-world-' + world.meta.seed,
      crs: {
        type: 'name',
        properties: {
          name: 'urn:ogc:def:crs:AOH::map-pixel',
          note: '平面地图坐标（非经纬度）：原点左上角，+x 向右，+y 向下，单位 = 1 地图像素；像素 (x,y) 中心为 (x+0.5, y+0.5)'
        }
      },
      bbox: [0, 0, world.meta.width, world.meta.height],
      features: feats
    };
  };

  /* ---------------- 紧凑游戏 JSON ---------------- */
  AO.worldToGameJSON = function (world) {
    var provinces = [];
    var i;
    for (i = 0; i < world.provinces.length; i++) {
      var p = world.provinces[i];
      if (!p) continue;
      provinces.push({
        id: p.id,
        name: p.name,
        name_en: p.name_en,
        owner: p.owner,
        terrain: p.terrain,
        faith: p.faithKey || null,
        /* 地图上画的是"主资源"（储量最高那条）；完整清单见 resources */
        resource: p.resource ? p.resource.key : null,
        resources: (p.resources || []).map(function (r) { return { key: r.key, n: r.n }; }),
        /* 岸线画像：游戏侧判断"能不能建港 / 有没有河口"用（不进 worldHash） */
        water: {
          sides: p.coastDirs | 0,                       // 0=内陆，1/2/3+=几面临海
          steep: p.coastDirs ? r3(p.coastSteep || 0) : 0, // 0=缓岸可建港，1=陡岸
          river: p.riverLen | 0,                        // 省内河道长度（按水量加权）
          mouth: !!p.riverMouth                         // 河流在本省入海
        },
        area: p.area,
        centroid: [r3(p.centroid[0]), r3(p.centroid[1])],
        neighbors: p.neighbors.slice()
      });
    }
    var countries = [];
    for (i = 0; i < world.countries.length; i++) {
      var c = world.countries[i];
      countries.push({
        id: c.id,
        name: c.name,
        name_en: c.name_en,
        color: c.color,
        capital: c.capital,
        area: c.area,
        provinces: c.provinces.slice(),
        borderCountries: c.neighbors.slice(),
        /* 08b 生成的社会资料（同样是 seed 派生的，可直接当存档用） */
        government: c.govCn,
        economy: c.economy,
        house: c.house || '',
        faith: c.faith ? {
          key: c.faith.key, name: c.faith.cn, name_en: c.faith.en,
          tenet: c.faith.tenet, state: c.faith.state
        } : null,
        /* 信仰构成：按占比降序，pct 为 0~1，合计 1。key='none' 表示无神论/世俗 */
        faiths: (c.faiths || []).map(function (f) {
          return { key: f.key, name: f.cn, name_en: f.en, pct: r3(f.pct), state: !!f.state };
        }),
        leader: c.leader ? {
          name: c.leader.name, name_en: c.leader.name_en,
          title: c.leader.title, gender: c.leader.gender, age: c.leader.age
        } : null,
        population: c.population,
        areaKm2: c.areaKm2,
        /* 资源汇总：七种资源按储量合计降序；n = 全国合计，maxN = 单省最高，provinces = 省数 */
        resources: (c.resources || []).map(function (r) {
          return { key: r.key, name: r.cn, n: r.n, maxN: r.max, provinces: r.prov };
        }),
        terrain: (c.terrainComp || []).map(function (t) {
          return { key: t.key, name: t.cn, pct: Math.round(t.pct * 1000) / 10 };
        })
      });
    }
    var adj = [];
    for (i = 0; i < world.adjacency.length; i++) {
      var e = world.adjacency[i];
      adj.push([e[0], e[1], e[2]]);
    }
    /* 河网：点列 + 宽度级（0 最窄 = 源头毛细，4 最宽 = 干流）。河流不按省切分，
     * 因为它本来就是跨省的连续要素。 */
    var rivers = [];
    var src = world.rivers || [];
    for (i = 0; i < src.length; i++) {
      var rv = src[i];
      var pts = [];
      for (var k2 = 0; k2 < rv.pts.length; k2++) pts.push(Math.round(rv.pts[k2] * 10) / 10);
      rivers.push({ w: rv.cls, pts: pts });
    }
    return {
      meta: {
        format: 'aoh-fictional-world',
        version: 1,
        seed: world.meta.seed,
        width: world.meta.width,
        height: world.meta.height,
        provinceCount: provinces.length,
        countryCount: countries.length,
        landRatio: r3(world.meta.landRatio),
        coordinateSystem:
          '平面直角坐标，非经纬度。原点在地图左上角，+x 向右，+y 向下，单位 = 1 地图像素；' +
          '像素 (x, y) 覆盖 [x, x+1) × [y, y+1)，其中心为 (x+0.5, y+0.5)。' +
          '海岸线与省界均以像素中心为基准，命中检测请直接查栅格标签，不要用多边形内点判断。',
        adjacencyEncoding: '[provinceA, provinceB, sharedBorderLengthInPixels]，无向，已去重且双向对称',
        riverEncoding: 'rivers: [{w: 宽度级 0~4, pts: [x0,y0,x1,y1,...]}]，折线不按省切分；上游→下游方向',
        resourceEncoding: 'provinces[].resources = [{key, n}]，**每省七种资源都有**，' +
          'n = 1~100 的储量（地形决定丰度上限，不决定有无），按储量降序；' +
          'provinces[].resource = 主资源 key（即 resources[0].key，地图上画的就是它）；' +
          'countries[].resources = 全国按 key 汇总（n = 合计，maxN = 单省最高，provinces = 省数）；' +
          '同 seed 确定性生成，不进世界指纹。' +
          'provinces[].water = 岸线画像：sides 几面临海（0=内陆）、steep 0~1 陡岸系数' +
          '（越高越难建港，渔获越低）、river 省内河道长度、mouth 是否有河口',
        areaUnit: 'pixels^2（陆地像素计数）',
        countryEncoding: 'countries[].terrain = 按面积占比排序的地形构成；population 为人；' +
          'areaKm2 由 world 宽度视作 6000 km 换算；' +
          'countries[].faiths = 信仰构成（pct 合计 1，key=none 为无神论/世俗）；' +
          'provinces[].faith = 该省所属信仰的 key'
      },
      terrainTypes: Object.keys(AO.TERRAIN_CN),
      provinces: provinces,
      countries: countries,
      adjacency: adj,
      rivers: rivers
    };
  };

  /* 生成下载用的字符串（不带 DOM 依赖，便于 Node 侧自检） */
  AO.serialize = function (obj) { return JSON.stringify(obj); };

})(typeof window !== 'undefined' ? window : globalThis);
