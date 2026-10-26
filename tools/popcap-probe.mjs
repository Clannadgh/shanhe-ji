/* 一次性体检：默认世界（1100 省 / 64 国）的人口负载分布
 * 跑法：node tools/popcap-probe.mjs
 */
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(import.meta.dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'load' });
await sleep(1200);

async function probe(provN, ctryN, seed, areaRef) {
  await page.evaluate((a) => {
    document.getElementById('prov').value = a.p;
    document.getElementById('ctry').value = a.c;
    document.getElementById('seed').value = a.s;
    document.getElementById('gen').click();
  }, { p: provN, c: ctryN, s: seed });
  await sleep(2800);
  return page.evaluate((a) => {
    const AO = window.AO, w = window.__world;
    AO.POPCAP.areaRef = a.ref;        // 0 = 关（任务书的"按省定额"）
    const rows = [];
    for (const p of w.provinces) {
      if (!p || !p.owner) continue;
      const cap = AO.resPopCap(p.id) || 0;
      const pop = (AO.resPop[p.id] || {}).v || 0;
      rows.push({ t: p.terrain, pop, cap, load: cap > 0 ? pop / cap : 0 });
    }
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] || 0; };
    const over = rows.filter(r => r.load > 1).length;
    const full = rows.filter(r => r.load >= 0.999 && r.load <= 1.0001).length;
    const bands = [0.5, 0.85, 1].map(k => rows.filter(r => r.load < k).length);
    return {
      n: rows.length,
      popMed: med(rows.map(r => r.pop)),
      capMed: med(rows.map(r => r.cap)),
      loadMed: med(rows.map(r => r.load)),
      over, full, bands,
      popSum: rows.reduce((a, r) => a + r.pop, 0),
      capSum: rows.reduce((a, r) => a + r.cap, 0),
      byT: (() => {
        const m = {};
        for (const r of rows) { (m[r.t] = m[r.t] || []).push(r.load); }
        const o = {};
        for (const k in m) o[k] = (m[k].reduce((a, b) => a + b, 0) / m[k].length * 100).toFixed(0) + '%';
        return o;
      })()
    };
  }, { ref: areaRef });
}

for (const [p, c] of [[1100, 64], [260, 10], [80, 6]]) {
  const r = await probe(p, c, 'probe-' + p, +(process.env.AREA_REF || 0));
  console.log('');
  console.log('=== ' + p + ' 省 / ' + c + ' 国（areaRef ' + (process.env.AREA_REF || 0) + '）===');
  console.log('  省数 ' + r.n + ' · 人口中位 ' + (r.popMed / 1e4).toFixed(1) + ' 万 · 承载力中位 ' + (r.capMed / 1e4).toFixed(1) + ' 万');
  console.log('  负载中位 ' + (r.loadMed * 100).toFixed(0) + '% · 超限 ' + r.over + ' 省（' + (r.over / r.n * 100).toFixed(0) + '%）· 正好摸顶 ' + r.full);
  console.log('  总人口 ' + (r.popSum / 1e8).toFixed(2) + ' 亿 / 总承载 ' + (r.capSum / 1e8).toFixed(2) + ' 亿');
  console.log('  <50% ' + r.bands[0] + ' · 50~85% ' + (r.bands[1] - r.bands[0]) + ' · 85~100% ' + (r.bands[2] - r.bands[1]) + ' · >100% ' + (r.n - r.bands[2]));
  console.log('  按地形平均负载 ' + JSON.stringify(r.byT));
}
await browser.close();
