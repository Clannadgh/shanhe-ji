/* Node 侧调试驱动：生成 + 统计 + ASCII 地图 */
'use strict';
const AO = require('./load').load();

const args = process.argv.slice(2);
const seed = args[0] || 'aoh-2026';
const provinces = parseInt(args[1] || '420', 10);
const countries = parseInt(args[2] || '24', 10);
const opt = { seed, provinces, countries };
if (args[3]) opt.continentScale = +args[3];
if (args[4]) opt.detailAmp = +args[4];
if (args[5]) opt.edgeFalloff = +args[5];

const t0 = Date.now();
const w = AO.generate(opt);
const total = Date.now() - t0;

const m = w.meta;
console.log('\n=== META ===');
console.log('seed', m.seed, '| 省份', m.provinceCount, '| 国家', m.countryCount, '| 总耗时', total, 'ms');
console.log('陆地占比', m.landRatio.toFixed(3), '| 陆地像素', m.landPixels, '| 海平面', m.seaLevel.toFixed(4));
console.log('修补像素', m.repairedPixels, '| 未覆盖', m.unreachedPixels);
console.log('轮廓段', m.segmentCount, '| runs', m.runCount, '| 邻接边', m.adjacencyEdges);
console.log('分步(ms)', JSON.stringify(m.timing, (k, v) => typeof v === 'number' ? Math.round(v) : v));

const nbMap = [1];
for (const p of w.provinces) if (p) nbMap[p.id] = p.neighbors;
const dh = AO.degreeHistogram(nbMap, m.provinceCount);
const histStr = Object.keys(dh.hist).sort((a, b) => a - b).map(k => k + ':' + dh.hist[k]).join(' ');
console.log('\n邻接度', histStr, '| 均值', dh.mean.toFixed(2));

let asym = 0;
for (const p of w.provinces) {
  if (!p) continue;
  for (const q of p.neighbors) {
    const qp = w.provinces[q - 1];
    if (!qp || qp.neighbors.indexOf(p.id) < 0) asym++;
  }
}
let bi = 0;
for (const c of w.countries) for (const pid of c.provinces) {
  const p = w.provinces[pid - 1];
  if (!p || p.owner !== c.id) bi++;
}
console.log('邻接不对称:', asym, '| 归属不一致:', bi);

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const COLS = 112, ROWS = 46;
let art = '';
for (let ry = 0; ry < ROWS; ry++) {
  let line = '';
  for (let rx = 0; rx < COLS; rx++) {
    const x = Math.min(m.width - 1, Math.floor((rx + 0.5) / COLS * m.width));
    const y = Math.min(m.height - 1, Math.floor((ry + 0.5) / ROWS * m.height));
    const l = w.labels[y * m.width + x];
    if (!l) { line += '.'; continue; }
    const p = w.provinces[l - 1];
    line += p ? chars[(p.owner - 1) % chars.length] : '?';
  }
  art += line + '\n';
}
console.log('\n' + art);

const areas = w.provinces.filter(Boolean).map(p => p.area).sort((a, b) => a - b);
console.log('省份面积 min/med/max', areas[0], areas[areas.length >> 1], areas[areas.length - 1]);
let ringCount = 0, ringPts = 0, noRing = 0, maxErr = 0;
for (const p of w.provinces) {
  if (!p) continue;
  if (!p.rings.length) noRing++;
  let a = 0;
  for (const r of p.rings) { ringCount++; ringPts += r.coords.length / 2; a += r.area; }
  if (p.area) maxErr = Math.max(maxErr, Math.abs(Math.abs(a) - p.area) / p.area);
}
console.log('环数', ringCount, '总点数', ringPts, '无环省份', noRing, '面积误差max', maxErr.toFixed(4));

const csz = w.countries.map(c => c.provinceCount).sort((a, b) => a - b);
console.log('国家省份数 min/med/max', csz[0], csz[csz.length >> 1], csz[csz.length - 1]);
console.log('国家名样例:', w.countries.slice(0, 5).map(c => c.name + '/' + c.name_en).join('  '));
console.log('省名样例:', w.provinces.filter(Boolean).slice(0, 6).map(p => p.name + '[' + p.terrain + ']').join('  '));
