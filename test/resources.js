/* =============================================================
 * test/resources.js —— 资源层专项自检
 *
 * 3 个尺寸 × 3 个 seed，每个配置生成两次（验证逐省可复现），断言：
 *   1. 每省七种资源齐全（地形只影响多少，不影响有无）
 *   2. 每条储量是 1~100 的整数，且按储量降序
 *   3. 同 seed 两次生成，逐省（种类 + 储量）完全一致
 *   4. 山地省的主资源为铁/金 的比例 > 平原省
 *   5. 海岸省的主资源以渔场为最多
 *   6. Σ countries[].resources[].n === Σ provinces[].resources[].n
 * 汇总后再按「岸线类别」校验渔获的地理成因：
 *   7. 内陆：大河 > 小溪 > 无河（河鲜）
 *   8. 同面数：缓岸 > 陡岸（陡岸建不了港）
 *   9. 缓岸：多面临海 > 单面临海
 *   10. 河口 > 同岸型的非河口省
 * 最后打印「主资源构成」「地形 × 资源 平均储量」「岸线类别 × 渔获」三张表。
 * ============================================================= */
'use strict';
const AO = require('./load').load([]);

const SIZES = [
  { key: 's',  width: 1600, height: 800,  provinces: 520,  countries: 36 },
  { key: 'l',  width: 2400, height: 1200, provinces: 1100, countries: 64 },
  { key: 'xl', width: 3200, height: 1600, provinces: 1900, countries: 90 }
];
const SEEDS = ['aoh-2026', 'res-01', 'fog-77'];
const KEYS = AO.RESOURCES.map(r => r.key);
const CN = {};
AO.RESOURCES.forEach(r => { CN[r.key] = r.cn; });
const RICH = AO.RES_RICH;
const FULL = (1 << KEYS.length) - 1;
const TERRAINS = ['plains', 'grassland', 'forest', 'coast', 'hills', 'mountains', 'desert', 'tundra', 'swamp'];

let fails = 0;
const aggTop = {};
const terrainSum = {};    // terrain -> {key: [sum, n]}
let aggProv = 0, aggRich = 0, gCoast = 0, gSteep = 0;

function padL(s, w) { s = String(s); while (s.length < w) s = ' ' + s; return s; }
function padR(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }
function pct(a, b) { return b ? (a * 100 / b) : 0; }

/* 岸线类别：几面临海 × 陡/缓 × 有没有河口 —— 决定渔获高低的那三件事 */
function fishBucket(p) {
  const d = p.coastDirs | 0;
  let s;
  if (!d) {
    s = '内陆·' + (!p.riverLen ? '无河' : (p.riverRel > 0.28 ? '大河' : '小溪'));
  } else {
    s = (d >= 2 ? '多面' : '单面') + '·' + ((p.coastSteep || 0) > 0.5 ? '陡岸' : '缓岸');
    if (p.riverMouth) s += '·河口';
  }
  return s;
}
const fishAgg = {};   // bucket -> [sum, n]（跨 9 个配置汇总，样本才够）
function fishPut(bucket, v) {
  if (!fishAgg[bucket]) fishAgg[bucket] = [0, 0];
  fishAgg[bucket][0] += v;
  fishAgg[bucket][1]++;
}
function fishAvg(bucket) {
  const b = fishAgg[bucket];
  return b && b[1] ? b[0] / b[1] : NaN;
}

function check(name, ok, detail) {
  if (!ok) fails++;
  console.log('   ' + (ok ? 'PASS ' : 'FAIL ') + padR(name, 26) + detail);
}

function profile(w) {
  const st = {
    tot: 0, missing: 0, badN: 0, unsorted: 0, sumN: 0, rich: 0,
    topBy: {}, mtn: [0, 0], pln: [0, 0], coastN: 0, coastBy: {}, sig: [],
    tsum: {}, fishBy: {}, coastSide: [0, 0], steepN: 0
  };
  for (const p of w.provinces) {
    if (!p) continue;
    st.tot++;
    const rs = p.resources || [];
    let mask = 0, prev = 101, sig = '', fv = -1;
    for (const r of rs) {
      st.sumN += r.n;
      if (r.key === 'fish') fv = r.n;
      if (!(r.n >= 1 && r.n <= 100) || r.n !== Math.round(r.n)) st.badN++;
      if (r.n > prev) st.unsorted++;
      prev = r.n;
      mask |= 1 << AO.RESOURCE_INDEX[r.key];
      sig += r.key + r.n + ';';
      const t = p.terrain;
      if (!st.tsum[t]) st.tsum[t] = {};
      if (!st.tsum[t][r.key]) st.tsum[t][r.key] = [0, 0];
      st.tsum[t][r.key][0] += r.n;
      st.tsum[t][r.key][1]++;
    }
    if (mask !== FULL) st.missing++;
    st.sig.push(sig);
    if (fv >= 0) {
      const bk = fishBucket(p);
      if (!st.fishBy[bk]) st.fishBy[bk] = [0, 0];
      st.fishBy[bk][0] += fv;
      st.fishBy[bk][1]++;
      const d = p.coastDirs | 0;
      if (d) {
        st.coastSide[d >= 2 ? 1 : 0]++;
        if ((p.coastSteep || 0) > 0.5) st.steepN++;
      }
    }

    const top = rs[0];
    if (!top) continue;
    st.topBy[top.key] = (st.topBy[top.key] || 0) + 1;
    if (top.n >= RICH) st.rich++;
    const precious = (top.key === 'iron' || top.key === 'gold');
    if (p.terrain === 'mountains') { st.mtn[0]++; if (precious) st.mtn[1]++; }
    if (p.terrain === 'plains') { st.pln[0]++; if (precious) st.pln[1]++; }
    if (p.terrain === 'coast') { st.coastN++; st.coastBy[top.key] = (st.coastBy[top.key] || 0) + 1; }
  }
  st.countrySum = 0;
  for (const c of w.countries) {
    for (const r of (c.resources || [])) st.countrySum += r.n;
  }
  st.coastTop = null;
  st.coastMax = -1;
  for (const k in st.coastBy) if (st.coastBy[k] > st.coastMax) { st.coastMax = st.coastBy[k]; st.coastTop = k; }
  return st;
}

const t0 = Date.now();
const rows = [];

for (const sz of SIZES) {
  for (const seed of SEEDS) {
    const opts = { seed, width: sz.width, height: sz.height, provinces: sz.provinces, countries: sz.countries };
    const w1 = AO.generate(opts);
    const w2 = AO.generate(opts);
    const a = profile(w1), b = profile(w2);

    let same = a.sig.length === b.sig.length;
    for (let i = 0; same && i < a.sig.length; i++) if (a.sig[i] !== b.sig[i]) same = false;

    const mtnPct = a.mtn[0] ? a.mtn[1] / a.mtn[0] : -1;
    const plnPct = a.pln[0] ? a.pln[1] / a.pln[0] : -1;
    const coastOK = !(a.coastN > 0) || a.coastTop === 'fish';

    console.log('\n[' + sz.key + ' / ' + seed + ']  ' + sz.width + '×' + sz.height +
      ' · 省 ' + a.tot + ' · 资源条 ' + (a.tot * KEYS.length) +
      ' · 远景富集省 ' + a.rich + '（主资源储量 ≥ ' + RICH + '）');

    check('七种资源齐全', a.missing === 0, '缺项省 ' + a.missing + ' / ' + a.tot);
    check('储量 1~100 且降序', a.badN === 0 && a.unsorted === 0,
      '越界 ' + a.badN + ' 条、乱序 ' + a.unsorted + ' 条，均值 ' + (a.sumN / (a.tot * KEYS.length)).toFixed(1));
    check('同 seed 逐省一致', same,
      same ? a.sig.length + ' 省（七种储量）完全相同' :
        '第 ' + a.sig.findIndex((v, i) => v !== b.sig[i]) + ' 省起分歧');
    check('山地主导(铁+金) > 平原', mtnPct > plnPct,
      '山地 ' + (mtnPct < 0 ? 'n/a' : (mtnPct * 100).toFixed(1) + '%') +
      '（' + a.mtn[1] + '/' + a.mtn[0] + '） > 平原 ' +
      (plnPct < 0 ? 'n/a' : (plnPct * 100).toFixed(1) + '%') + '（' + a.pln[1] + '/' + a.pln[0] + '）');
    check('海岸主导以渔场最多', coastOK,
      a.coastN ? (CN[a.coastTop] || a.coastTop) + ' ' + a.coastMax + '/' + a.coastN +
        '（' + pct(a.coastMax, a.coastN).toFixed(1) + '%）' : '无海岸省');
    check('Σ国家储量 = Σ省储量', a.countrySum === a.sumN,
      a.countrySum + ' / ' + a.sumN);

    rows.push({ size: sz.key, seed, tot: a.tot, sumN: a.sumN, rich: a.rich, topBy: a.topBy });
    aggProv += a.tot;
    aggRich += a.rich;
    for (const k of KEYS) aggTop[k] = (aggTop[k] || 0) + (a.topBy[k] || 0);
    for (const bk in a.fishBy) {
      fishPut(bk, a.fishBy[bk][0]);
      fishAgg[bk][1] += a.fishBy[bk][1] - 1;
    }
    gCoast += a.coastSide[0] + a.coastSide[1];
    gSteep += a.steepN;
    for (const t in a.tsum) {
      if (!terrainSum[t]) terrainSum[t] = {};
      for (const k in a.tsum[t]) {
        if (!terrainSum[t][k]) terrainSum[t][k] = [0, 0];
        terrainSum[t][k][0] += a.tsum[t][k][0];
        terrainSum[t][k][1] += a.tsum[t][k][1];
      }
    }
  }
}

/* ---------------- 表 1：主资源构成 ---------------- */
console.log('\n每省"主资源"构成（分母 = 该世界省数）：');
let head = padR('尺寸', 5) + padR('seed', 10) + padL('省', 6) + padL('均储量', 8) + padL('富集省', 8);
for (const k of KEYS) head += padL(CN[k], 7);
console.log(head);
console.log('-'.repeat(head.length));
for (const r of rows) {
  let line = padR(r.size, 5) + padR(r.seed, 10) + padL(r.tot, 6) +
    padL((r.sumN / (r.tot * KEYS.length)).toFixed(1), 8) + padL(r.rich, 8);
  for (const k of KEYS) line += padL(pct(r.topBy[k] || 0, r.tot).toFixed(1) + '%', 7);
  console.log(line);
}
console.log('-'.repeat(head.length));
let tail = padR('合计', 5) + padR('×' + rows.length, 10) + padL(aggProv, 6) + padL('', 8) + padL(aggRich, 8);
for (const k of KEYS) tail += padL(pct(aggTop[k] || 0, aggProv).toFixed(1) + '%', 7);
console.log(tail);

/* ---------------- 表 2：地形 × 资源 平均储量 ---------------- */
console.log('\n地形 × 资源 平均储量（每省每种的平均值，证明"平原也有盐/金"）：');
let head2 = padR('地形', 11) + padL('省', 6);
for (const k of KEYS) head2 += padL(CN[k], 7);
console.log(head2);
console.log('-'.repeat(head2.length));
for (const t of TERRAINS) {
  const row = terrainSum[t];
  if (!row) continue;
  const nProv = row[KEYS[0]] ? row[KEYS[0]][1] : 0;
  let line = padR(t, 11) + padL(nProv, 6);
  for (const k of KEYS) {
    const s = row[k];
    line += padL(s ? (s[0] / s[1]).toFixed(1) : '-', 7);
  }
  console.log(line);
}

/* ---------------- 表 3：岸线类别 × 渔获 ---------------- */
console.log('\n岸线类别 × 渔获平均储量（9 个配置汇总；n = 省数）：');
const bks = Object.keys(fishAgg).sort((x, y) => fishAvg(y) - fishAvg(x));
let head3 = padR('岸线类别', 20) + padL('n', 7) + padL('渔获均值', 10);
console.log(head3);
console.log('-'.repeat(head3.length));
for (const bk of bks) {
  const b = fishAgg[bk];
  console.log(padR(bk, 20) + padL(b[1], 7) + padL(fishAvg(bk).toFixed(1), 10));
}
console.log('-'.repeat(head3.length));
console.log('沿海省 ' + gCoast + ' 个，其中陡岸 ' + gSteep + ' 个（' + pct(gSteep, gCoast).toFixed(1) + '%）—— 陡岸建不了渔港');

/* ---------------- 断言 7~10：渔获的地理成因 ---------------- */
console.log('\n渔获地理成因（汇总校验）：');
const cIn0 = fishAvg('内陆·无河'), cIn1 = fishAvg('内陆·小溪'), cIn2 = fishAvg('内陆·大河');
const c1g = fishAvg('单面·缓岸'), c1s = fishAvg('单面·陡岸');
const cMg = fishAvg('多面·缓岸'), cMs = fishAvg('多面·陡岸');
const cMouth = fishAvg('单面·缓岸·河口');
function ck2(name, a, b, la, lb) {
  const ok = isFinite(a) && isFinite(b) && a > b;
  check(name, ok, (isFinite(a) ? a.toFixed(1) : 'n/a') + ' > ' + (isFinite(b) ? b.toFixed(1) : 'n/a') +
    '　（' + la + ' vs ' + lb + '）');
}
ck2('内陆：大河 > 无河', cIn2, cIn0, '内陆·大河', '内陆·无河');
ck2('内陆：小溪 > 无河', cIn1, cIn0, '内陆·小溪', '内陆·无河');
ck2('内陆大河 ≥ 单面秃岸', cIn2, c1s, '内陆·大河', '单面·陡岸');
ck2('单面：缓岸 > 陡岸', c1g, c1s, '单面·缓岸', '单面·陡岸');
ck2('多面：缓岸 > 陡岸', cMg, cMs, '多面·缓岸', '多面·陡岸');
ck2('缓岸：多面 > 单面', cMg, c1g, '多面·缓岸', '单面·缓岸');
ck2('河口 > 同岸型无河口', cMouth, c1g, '单面·缓岸·河口', '单面·缓岸');
check('陡岸确实存在（惩罚不是摆设）', gSteep > 0 && gSteep < gCoast,
  '陡岸 ' + gSteep + ' / 沿海 ' + gCoast + '（' + pct(gSteep, gCoast).toFixed(1) + '%）');

console.log('\n主资源合计：' + KEYS.map(k => CN[k] + ' ' + (aggTop[k] || 0)).join(' / '));
console.log('耗时 ' + (Date.now() - t0) + ' ms');
console.log('\n结论：' + (fails ? fails + ' 项失败'
  : '全部通过（' + rows.length + ' 个配置 × 6 条断言 + 渔获成因 8 条）'));
process.exit(fails ? 1 : 0);
