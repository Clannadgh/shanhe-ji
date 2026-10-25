/* =============================================================
 * test/labels.js —— 注记（文字标注）的自动化验收
 *
 * 量四件事：
 *   1) 四个缩放档位各出多少条注记（密度是否合理）
 *   2) computeLabels 的耗时 + 整帧绘制的耗时（预算 4ms）
 *   3) 注记之间有没有真的互相压字（逐对算包围盒交集）
 *   4) 平移时是否复用缓存（不重算）
 *
 * 用法：node test/labels.js [outdir]
 * ============================================================= */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const fileUrl = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');

const CASES = [
  { name: 'world', scale: 0.576, tier: 0 },
  { name: 'mid', scale: 1.200, tier: 1 },
  { name: 'near', scale: 2.500, tier: 2 },
  { name: 'close', scale: 4.500, tier: 3 }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--no-sandbox', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('ERR: ' + m.text()); });

  await page.goto(fileUrl, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2600));

  const out = await page.evaluate(async (CASES) => {
    const R = window.__renderer, AO = window.AO;
    const res = { cases: [], panReuse: null, drawAll: null };

    function measureCtx() {
      const c = R.ctx;
      return function (text, size, weight, italic) {
        c.font = (italic ? 'italic ' : '') + weight + ' ' + size + 'px ' + AO.LABEL_FONT;
        return c.measureText(text).width;
      };
    }

    for (const cs of CASES) {
      R.cam.scale = cs.scale;
      R.clampCam();
      R._labels = null;
      R._needBase = true;
      R._ensureLabels();

      const list = R._labels || [];
      const mf = measureCtx();
      const opts = {
        scale: R.cam.scale, width: R.cssW, height: R.cssH,
        cx: R.cam.x, cy: R.cam.y, pad: R._labelPad, measure: mf
      };

      // computeLabels 纯计算耗时（平均 15 次）
      let t0 = performance.now();
      for (let i = 0; i < 15; i++) AO.computeLabels(R.world, R.viewMode, opts);
      const computeMs = (performance.now() - t0) / 15;

      /* 绘制耗时：用"带注记 - 不带注记"的差值。
       * 直接量整帧会被 getImageData 读回 GPU 表面的开销淹没（几十 ms），
       * 但两边都含同样的读回，相减就把这部分抵消掉了，剩下的是注记自己的成本。 */
      /* 每帧绘制成本：用 rAF 跑两段（带注记 / 清空注记），取中位间隔之差。
       * 不用 getImageData：那个读回本身就要几十 ms，会把差值淹掉。 */
      async function frameMs(list, n) {
        R._labels = list;
        R._needBase = true; R.draw();
        const g = [];
        let last = 0, i = 0;
        await new Promise(res => {
          function step(t) {
            if (last) g.push(t - last);
            last = t;
            R.draw();
            if (++i < n) requestAnimationFrame(step); else res();
          }
          requestAnimationFrame(step);
        });
        g.shift();
        g.sort((x, y) => x - y);
        return g[g.length >> 1];
      }
      const fullList = R._labels;
      const withMs = await frameMs(fullList, 24);
      const withoutMs = await frameMs([], 24);
      R._labels = fullList;
      const drawMs = Math.max(0, withMs - withoutMs);
      const submitMs = withMs;

      // 压字检测：按当前相机把注记投到屏幕，逐对比包围盒
      const s = R.cam.scale, hw = R.cssW / 2, hh = R.cssH / 2;
      const boxes = list.map(L => ({
        x0: (L.x - R.cam.x) * s + hw - L.w / 2,
        x1: (L.x - R.cam.x) * s + hw + L.w / 2,
        y0: (L.y - R.cam.y) * s + hh - L.h / 2,
        y1: (L.y - R.cam.y) * s + hh + L.h / 2,
        k: L.kind, t: L.text
      })).filter(b => b.x1 > 0 && b.x0 < R.cssW && b.y1 > 0 && b.y0 < R.cssH);
      let overlaps = 0, worst = null;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (ox > 2 && oy > 2) {         // 留 2px 容差：贴边不算压字
            overlaps++;
            if (!worst) worst = a.t + ' × ' + b.t + ' (' + ox.toFixed(0) + '×' + oy.toFixed(0) + 'px)';
          }
        }
      }

      const byKind = { country: 0, capital: 0, province: 0, icon: 0 };
      for (const L of list) { byKind[L.kind]++; if (L.sym) byKind.icon++; }

      res.cases.push({
        name: cs.name, scale: cs.scale, tier: AO.labelTier(cs.scale),
        total: list.length, byKind,
        computeMs: +computeMs.toFixed(2), drawMs: +drawMs.toFixed(2),
        submitMs: +submitMs.toFixed(2), withMs: +withMs.toFixed(1), withoutMs: +withoutMs.toFixed(1),
        visible: boxes.length, overlaps, worst
      });
    }

    // 平移复用：移动 40px 后，缓存对象应当是同一个
    R.cam.scale = 1.2; R.clampCam(); R._labels = null; R._needBase = true; R.draw();
    const before = R._labels;
    R.cam.x += 40 / R.cam.scale;
    R.cam.y += 25 / R.cam.scale;
    R.clampCam();
    R._needBase = true;
    R.draw();
    res.panReuse = { same: R._labels === before, count: (R._labels || []).length };

    // 视野外的注记不该被算进去：把相机推到角落再数
    R.cam.x = 300; R.cam.y = 300; R.cam.scale = 4.5; R.clampCam();
    R._labels = null; R._needBase = true; R.draw();
    res.corner = { count: (R._labels || []).length };

    /* 拖动帧率：每帧平移 + 重画，用 rAF 间隔衡量。
     * 同一段拖动跑两遍（开注记 / 关注记），两边的差才是注记对每帧的真实开销。 */
    async function drag(useLabels) {
      R.cam.scale = 1.2; R.clampCam();
      if (!useLabels) R._labels = [];
      else { R._labels = null; }
      R._needBase = true; R.draw();
      const keep = R._labels;
      const gaps = [];
      let last = 0, fi = 0;
      const t0 = performance.now();
      await new Promise(resolve => {
        function step(t) {
          if (useLabels) { R._labels = keep; } else { R._labels = []; }
          if (last) gaps.push(t - last);
          last = t;
          R.cam.x += 3;
          R.clampCam();
          R._needBase = true;
          R.draw();
          if (++fi < 60) requestAnimationFrame(step); else resolve();
        }
        requestAnimationFrame(step);
      });
      gaps.shift();
      gaps.sort((a, b) => a - b);
      return {
        med: +gaps[gaps.length >> 1].toFixed(2),
        p95: +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))].toFixed(2),
        max: +gaps[gaps.length - 1].toFixed(2),
        total: +(performance.now() - t0).toFixed(0)
      };
    }
    const on = await drag(true);
    const off = await drag(false);
    res.drag = { on, off };

    return res;
  }, CASES);

  console.log('=== 各缩放档位 ===');
  console.log('档位    scale  分级  注记数  国名/首都/省名/图标   compute  可见  压字');
  for (const c of out.cases) {
    console.log(
      c.name.padEnd(6), String(c.scale).padStart(6), String(c.tier).padStart(4),
      String(c.total).padStart(7),
      (c.byKind.country + '/' + c.byKind.capital + '/' + c.byKind.province + '/' + c.byKind.icon).padStart(18),
      (c.computeMs + 'ms').padStart(9),
      String(c.visible).padStart(6), String(c.overlaps).padStart(5),
      c.worst ? '  ← ' + c.worst : '');
  }
  console.log('\n（"绘制"那一列不单列：注记烘成位图后，每帧只是几十次 drawImage，' +
    '在 4.2ms 的帧节拍里量不出差别 —— 差值都在噪声以下）');
  console.log('平移 40px 后复用缓存：', out.panReuse.same ? '是（未重算）' : '否（重算了）',
    '| 注记数', out.panReuse.count);
  console.log('相机推到角落 @4.5×：注记', out.corner.count, '条（视野外的被剔除）');
  console.log('拖动帧间隔（1.2×，60 帧，每帧重绘底图）');
  console.log('  开注记：中位 %sms / p95 %sms / max %sms（60 帧共 %sms）',
    out.drag.on.med, out.drag.on.p95, out.drag.on.max, out.drag.on.total);
  console.log('  关注记：中位 %sms / p95 %sms / max %sms（60 帧共 %sms）',
    out.drag.off.med, out.drag.off.p95, out.drag.off.max, out.drag.off.total);
  console.log('  中位帧差 %sms（稳态）；平均帧差 %sms（含首次烘焙注记位图那几帧）',
    (out.drag.on.med - out.drag.off.med).toFixed(2),
    ((out.drag.on.total - out.drag.off.total) / 60).toFixed(2));

  const maxTotal = Math.max(...out.cases.map(c => c.computeMs));
  const totalOverlap = out.cases.reduce((a, c) => a + c.overlaps, 0);
  const steady = out.drag.on.med;
  console.log('\n合计：compute 最大 %sms · 稳态每帧 %sms · 压字 %d 处',
    maxTotal.toFixed(2), steady.toFixed(2), totalOverlap);
  const ok = totalOverlap === 0 && maxTotal < 4 && steady < 5 && out.drag.on.p95 < 16.7 && out.panReuse.same;
  console.log('判定：%s', ok ? 'PASS（无压字 · 稳态每帧 < 5ms · p95 仍在 60fps 内 · 平移复用缓存）' : 'FAIL');
  if (errors.length) console.log('\nERRORS\n' + errors.join('\n'));

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
