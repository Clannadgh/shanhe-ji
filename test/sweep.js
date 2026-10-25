/* 参数扫描：只看地形 + 布点 + 切分 + 邻接，评估"陆地是否成块、省份是否退化" */
'use strict';
const AO = require('./load').load();

const SEEDS = ['aoh-2026', 'alpha', 'terra-7', 'zzz', 'k2'];
const base = { width: 1600, height: 800, provinces: 420, countries: 24 };

const grid = [];
for (const contScale of [700, 900, 1150]) {
  for (const detAmp of [0.16, 0.24, 0.34]) {
    for (const edgeF of [0.7, 0.95]) {
      grid.push({ continentScale: contScale, detailAmp: detAmp, edgeFalloff: edgeF });
    }
  }
}

function metrics(cfg) {
  let degSum = 0, runs = 0, low = 0, comps = 0, landRatio = 0, largest = 0, err = '';
  const hist = {};
  for (const seed of SEEDS) {
    try {
      const terr = AO.buildTerrain(Object.assign({}, base, cfg, { seed: AO.hashString(seed) }));
      const rng = new AO.RNG(AO.hashString(seed));
      const si = AO.placeSeeds(terr, base.provinces, rng.fork('sp'), 2);
      const part = AO.voronoiRaster(terr.land, base.width, base.height, si.seeds);
      const adj = AO.buildAdjacency(part.label, base.width, base.height, si.seeds.length);
      let s = 0, c = 0;
      for (let i = 1; i <= si.seeds.length; i++) {
        const d = adj.neighbors[i].length;
        hist[d] = (hist[d] || 0) + 1;
        s += d; c++; if (d <= 1) low++;
      }
      degSum += s / c; runs++;
      comps += terr.compCount;
      landRatio += terr.landRatio;
      const sz = terr.compSizes.slice(1).sort((a, b) => b - a);
      largest += sz[0] / terr.landCount;
    } catch (e) { err = e.message; }
  }
  return {
    avgDeg: degSum / runs, lowPct: low / (runs * 420) * 100,
    comps: comps / runs, landRatio: landRatio / runs,
    largest: largest / runs, hist, err
  };
}

console.log('contScale detAmp edgeF | avgDeg low<=1% comps largest landRatio');
for (const cfg of grid) {
  const m = metrics(cfg);
  console.log(
    String(cfg.continentScale).padStart(6),
    String(cfg.detailAmp).padStart(6),
    String(cfg.edgeFalloff).padStart(5), '|',
    m.avgDeg.toFixed(2).padStart(6),
    m.lowPct.toFixed(1).padStart(6),
    m.comps.toFixed(1).padStart(5),
    m.largest.toFixed(2).padStart(5),
    m.landRatio.toFixed(3),
    m.err || ''
  );
}
