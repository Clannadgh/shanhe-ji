/* 山体阴影参数扫描 / 截图 / 性能测量
 *
 * 用法：
 *   node test/hill.js shot  <out.png> <view> [zoom] [focus]   单张截图
 *   node test/hill.js sweep <outdir>                           参数矩阵，逐档出图 + 指标
 *   node test/hill.js perf  [xl]                               生成 / 底图重绘耗时与内存
 *
 * 扫描时只重算 hillshade 灰度场（不重跑整条管线）：第一次生成世界时
 * 临时包一层 AO.buildHillshade 把 (elev, label) 截下来，
 * 之后每种参数组合都拿这份高程直接重算 —— 保证各档之间只有参数差异。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const fileUrl = 'file://' + path.join(root, 'index.html').replace(/\\/g, '/');

/* CLIP=400,300,700,420 时只截这块（1:1 看字用，避免被查看器缩放） */
function clipRect() {
  if (!process.env.CLIP) return undefined;
  const [x, y, width, height] = process.env.CLIP.split(',').map(Number);
  return { x, y, width, height };
}

async function boot(browser, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('ERR: ' + m.text()); });
  await page.goto(fileUrl, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 300));

  // 截图时不想要面板
  await page.evaluate(() => document.body.classList.add('panel-collapsed'));

  // 在 UI 生成世界之前先包一层，把高程截下来（只影响本次测试进程）
  await page.evaluate(() => {
    const AO = window.AO;
    const orig = AO.buildHillshade;
    AO.buildHillshade = function (elev, label, w, h, cfg) {
      window.__hillArgs = { elev, label, w, h };
      return orig.apply(this, arguments);
    };
  });

  // 走真实 UI 路径生成（点尺寸按钮 → applySize → generate → setWorld）
  const size = (opts && opts.size) || 'l';
  await page.evaluate((size) => {
    const b = document.querySelector('#sizeSeg button[data-size="' + size + '"]');
    if (b) b.click(); else document.getElementById('gen').click();
  }, size);

  const want = { s: 1600, l: 2400, xl: 3200 }[size];
  for (let i = 0; i < 120; i++) {
    const ok = await page.evaluate((want) => !!(window.__world && window.__hillArgs &&
      window.__world.meta.width === want && window.__renderer &&
      window.__renderer.world === window.__world), want);
    if (ok) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await page.evaluate(() => window.__renderer.setView('terrain'));
  await new Promise(r => setTimeout(r, 400));
  return { page, errors };
}

/* 对比图里不需要小地图和"面板"按钮，挡视线 */
async function cleanFrame(page) {
  await page.evaluate(() => {
    const R = window.__renderer;
    if (R && !R.__mmStub) { R._drawMinimap = function () {}; R.__mmStub = 1; }
    const po = document.getElementById('panelOpen');
    if (po) po.style.display = 'none';
    const p = document.getElementById('panel');
    if (p) { p.style.transition = 'none'; p.style.display = 'none'; }
  });
}

/* 把镜头对准"阴影起伏最剧烈"的一块：按 48×48 窗口统计灰度场标准差，
 * 取最高的窗口中心 —— 这样每张近景都在山地上，不是碰巧落在平原。 */
async function focus(page, zoom) {
  return page.evaluate((z) => {
    const R = window.__renderer, w = R.world;
    const hs = w.hillshade.data, W = w.meta.width, H = w.meta.height;
    let best = null, bv = -1;
    const R2 = 24;
    for (let cy = 60; cy < H - 60; cy += 40) {
      for (let cx = 60; cx < W - 60; cx += 40) {
        let s = 0, s2 = 0, n = 0;
        for (let y = cy - R2; y < cy + R2; y += 2) {
          for (let x = cx - R2; x < cx + R2; x += 2) {
            const v = hs[y * W + x]; s += v; s2 += v * v; n++;
          }
        }
        const mean = s / n, va = s2 / n - mean * mean;
        if (va > bv) { bv = va; best = [cx, cy]; }
      }
    }
    if (best) { R.cam.x = best[0]; R.cam.y = best[1]; }
    R.cam.scale = z;
    R.clampCam();
    R._needBase = true;
    R.draw();
    return best;
  }, zoom);
}

/* 对准"背光侧"的海岸：海面像素沿光源方向能打到陆地的那种岸边 */
async function focusCoast(page, zoom) {
  return page.evaluate((z) => {
    const R = window.__renderer, w = R.world;
    const lab = w.labels, W = w.meta.width, H = w.meta.height;
    // 光源方向（与 AO.HILL.az 一致）：az=315 → 朝西北
    const az = (w.hillshade.cfg.az || 315) * Math.PI / 180;
    const sx = Math.sin(az) * Math.cos(Math.PI / 4), sy = -Math.cos(az) * Math.cos(Math.PI / 4);
    const hl = Math.hypot(sx, sy) || 1;
    const ux = sx / hl, uy = sy / hl;
    let best = null, bv = -1;
    for (let y = 140; y < H - 140; y += 11) {
      for (let x = 140; x < W - 140; x += 11) {
        if (lab[y * W + x]) continue;              // 只看海面
        let score = 0;
        for (let s = 2; s <= 10; s += 2) {
          const xx = (x + ux * s) | 0, yy = (y + uy * s) | 0;
          if (lab[yy * W + xx]) score++;
        }
        if (score > bv) { bv = score; best = [x, y]; }
      }
    }
    if (best) { R.cam.x = best[0]; R.cam.y = best[1]; }
    R.cam.scale = z;
    R.clampCam();
    R._needBase = true;
    R.draw();
    return { at: best, score: bv };
  }, zoom);
}

async function fitWorld(page) {
  await page.evaluate(() => {
    const R = window.__renderer;
    R.fit();
    R.draw();
  });
  await new Promise(r => setTimeout(r, 120));
}

/* 应用一组参数：重算灰度场 → 重建 canvas → 重绘底图 */
async function applyCfg(page, cfg) {
  return page.evaluate((cfg) => {
    const R = window.__renderer, AO = window.AO, a = window.__hillArgs;
    const full = Object.assign({}, AO.HILL, cfg);
    const t0 = performance.now();
    R.world.hillshade = AO.buildHillshade(a.elev, a.label, a.w, a.h, full);
    const t1 = performance.now();
    R._buildHillCanvas();
    const t2 = performance.now();
    R._needBase = true;
    // 单独计时底图重绘
    const t3 = performance.now();
    R._renderBase();
    R._needBase = false;
    R.draw();
    const t4 = performance.now();
    const hs = R.world.hillshade;
    // 从叠加后的底图取样，只统计陆地像素：看有没有死黑 / 死白
    const c = R.base, ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = R.world.meta.width, H = R.world.meta.height, lab = R.world.labels;
    let n = 0, sum = 0, hi = 0, lo = 0, deadK = 0, deadW = 0;
    const step = 2;
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        const wp = R.toWorld(x / R.dpr, y / R.dpr);
        const wx = wp.x | 0, wy = wp.y | 0;
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
        if (!lab[wy * W + wx]) continue;                 // 只看陆地
        const j = (y * c.width + x) * 4;
        const l = 0.299 * img[j] + 0.587 * img[j + 1] + 0.114 * img[j + 2];
        n++; sum += l;
        if (l > hi) hi = l;
        if (l < lo) lo = l;
        if (l < 30) deadK++;                             // 近死黑
        if (img[j] > 246 && img[j + 1] > 246 && img[j + 2] > 246) deadW++;
      }
    }
    return {
      hillMs: +(t1 - t0).toFixed(1),
      canvasMs: +(t2 - t1).toFixed(1),
      baseMs: +(t4 - t3).toFixed(1),
      stats: hs.stats,
      pixels: {
        n, mean: +(sum / n).toFixed(1), max: +hi.toFixed(1), min: +lo.toFixed(1),
        blackPct: +(deadK / n * 100).toFixed(2), whitePct: +(deadW / n * 100).toFixed(2)
      }
    };
  }, cfg);
}

const VARIANTS = [
  // 1) 垂直夸张
  { name: 'ex100', cfg: { ex: 100, az: 315, base: 128, gain: 300, blend: 'overlay', alpha: 0.85, offshore: 0 } },
  { name: 'ex150', cfg: { ex: 150, az: 315, base: 128, gain: 300, blend: 'overlay', alpha: 0.85, offshore: 0 } },
  { name: 'ex220', cfg: { ex: 220, az: 315, base: 128, gain: 300, blend: 'overlay', alpha: 0.85, offshore: 0 } },
  // 2) 混合方式（暂用 ex 从上面选，这里先按 150 出，选定后重跑）
  { name: 'bl-soft', cfg: { ex: 150, az: 315, base: 128, gain: 300, blend: 'soft-light', alpha: 1.0, offshore: 0 } },
  { name: 'bl-mult', cfg: { ex: 150, az: 315, base: 255, gain: 520, blend: 'multiply', alpha: 0.55, offshore: 0 } },
  // 3) 光源方位
  { name: 'az225', cfg: { ex: 150, az: 225, base: 128, gain: 300, blend: 'overlay', alpha: 0.85, offshore: 0 } }
];

const SHOTS = [
  { name: 'world', preparer: 'fit' },
  { name: 'zoom', preparer: 'focus', zoom: 3.2 },
  { name: 'coast', preparer: 'coast', zoom: 7 }
];

(async () => {
  const mode = process.argv[2] || 'shot';
  const browser = await puppeteer.launch({
    headless: 'new',
    args: process.env.HILL_GPU === '1'
      ? ['--allow-file-access-from-files', '--no-sandbox', '--font-render-hinting=none',
        '--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader']
      : ['--allow-file-access-from-files', '--no-sandbox', '--font-render-hinting=none']
  });
  try {
    if (mode === 'shot') {
      const out = process.argv[3] || 'hill.png';
      const spec = (process.argv[4] || 'terrain').split(':');
      const view = spec[0], special = spec[1] || '';
      const zoom = process.argv[5] ? parseFloat(process.argv[5]) : 0;
      const { page, errors } = await boot(browser);
      if (!process.env.RAW) await cleanFrame(page);
      // 走 UI 的视图按钮（而不是直接调 Renderer.setView），这样图例也会跟着更新
      await page.evaluate((v) => {
        const b = document.querySelector('#viewSeg button[data-view="' + v + '"]');
        if (b) b.click(); else window.__renderer.setView(v);
      }, view);
      if (special === 'coast') await focusCoast(page, zoom || 6);
      else if (zoom) await focus(page, zoom);
      else await fitWorld(page);
      await new Promise(r => setTimeout(r, 200));
      await page.screenshot({ path: path.join(root, out), clip: clipRect() });
      const info = await page.evaluate(() => {
        const R = window.__renderer, hs = R.world.hillshade;
        return { stats: hs.stats, cfg: hs.cfg, cam: R.cam, scale: R.cam.scale, blend: R.hillBlend, alpha: R.hillAlpha };
      });
      console.log('saved', out, 'hill', JSON.stringify(info.stats),
        'cam', info.cam.scale.toFixed(4), info.cam.x.toFixed(1), info.cam.y.toFixed(1), info.blend, info.alpha,
        errors.length ? errors : '');
      return;
    }

    if (mode === 'raw') {
      /* 抠一块山地的原始灰度场，1:1 放大 2 倍（最近邻）落盘，
       * 用来看清"场"本身有没有脊线，排除叠加与缩放的影响 */
      const { page } = await boot(browser);
      await cleanFrame(page);
      const b64 = await page.evaluate((cfg) => {
        const R = window.__renderer, AO = window.AO, a = window.__hillArgs;
        const hs = AO.buildHillshade(a.elev, a.label, a.w, a.h, Object.assign({}, AO.HILL, cfg || {}));
        const W = a.w, H = a.h, d = hs.data;
        // 找起伏最剧烈的位置
        let bx = 0, by = 0, bv = -1;
        for (let cy = 100; cy < H - 100; cy += 20) {
          for (let cx = 100; cx < W - 100; cx += 20) {
            let s = 0, s2 = 0, n = 0;
            for (let y = cy - 20; y < cy + 20; y += 2) for (let x = cx - 20; x < cx + 20; x += 2) {
              const v = d[y * W + x]; s += v; s2 += v * v; n++;
            }
            const va = s2 / n - (s / n) * (s / n);
            if (va > bv) { bv = va; bx = cx; by = cy; }
          }
        }
        const CW = 400, CH = 300, Z = 2;
        const c = document.createElement('canvas');
        c.width = CW * Z; c.height = CH * Z;
        const cx2 = c.getContext('2d');
        const img = cx2.createImageData(CW, CH);
        for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
          const v = d[(by - CH / 2 + y) * W + (bx - CW / 2 + x)];
          const j = (y * CW + x) * 4;
          img.data[j] = img.data[j + 1] = img.data[j + 2] = v; img.data[j + 3] = 255;
        }
        const tmp = document.createElement('canvas');
        tmp.width = CW; tmp.height = CH;
        tmp.getContext('2d').putImageData(img, 0, 0);
        cx2.imageSmoothingEnabled = false;
        cx2.drawImage(tmp, 0, 0, CW * Z, CH * Z);
        return { url: c.toDataURL('image/png'), at: [bx, by], stats: hs.stats };
      }, null);
      const out = path.join(root, process.argv[3] || '_raw.png');
      fs.writeFileSync(out, Buffer.from(b64.url.split(',')[1], 'base64'));
      console.log('saved', out, 'at', b64.at, 'min/mean/max', b64.stats.min, b64.stats.mean.toFixed(1), b64.stats.max,
        'satLo', b64.stats.satLo, 'hist', b64.stats.hist.join(','));
      return;
    }

    if (mode === 'sweep') {
      const dir = path.join(root, process.argv[3] || 'shots');
      const list = process.argv[4] ? JSON.parse(process.argv[4]) : VARIANTS;
      fs.mkdirSync(dir, { recursive: true });
      const { page, errors } = await boot(browser);
      await cleanFrame(page);
      for (const v of list) {
        await fitWorld(page);          // 统一取景，指标才有可比性
        const m = await applyCfg(page, v.cfg);
        console.log('\n== ' + v.name + ' ==', JSON.stringify(v.cfg));
        console.log('   hill ' + m.hillMs + 'ms  canvas ' + m.canvasMs + 'ms  base ' + m.baseMs + 'ms',
          '| land min/mean/max', m.stats.min, m.stats.mean.toFixed(1), m.stats.max,
          '| satHi', m.stats.satHi, 'satLo', m.stats.satLo);
        console.log('   composite luma', JSON.stringify(m.pixels));
        for (const s of SHOTS) {
          if (s.preparer === 'fit') await fitWorld(page);
          else if (s.preparer === 'coast') await focusCoast(page, s.zoom);
          else await focus(page, s.zoom);
          await new Promise(r => setTimeout(r, 160));
          const out = path.join(dir, v.name + '-' + s.name + '.png');
          await page.screenshot({ path: out });
        }
      }
      if (errors.length) console.log('\nERRORS\n' + errors.join('\n'));
      console.log('\n输出目录', dir);
      return;
    }

    if (mode === 'verify') {
      /* 政治视图必须完全不受阴影影响：同一世界分别带阴影画一次、把
       * hillCanvas 清空再画一次，比对底图像素校验和。地形视图作为对照。 */
      const { page, errors } = await boot(browser, { size: process.argv[3] === 'xl' ? 'xl' : 'l' });
      const r = await page.evaluate(() => {
        const R = window.__renderer;
        function sum() {
          const c = R.base, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let h = 0;
          for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
          return h;
        }
        const out = {};
        for (const view of ['political', 'faith', 'terrain']) {
          R.setView(view);
          R._renderBase();
          const withHill = sum();
          const keep = R.hillCanvas;
          R.hillCanvas = null;
          R._renderBase();
          const without = sum();
          R.hillCanvas = keep;
          out[view] = { withHill, without, same: withHill === without };
        }
        return out;
      });
      for (const k in r) {
        console.log(k.padEnd(10), r[k].same ? '两者完全一致（阴影不参与）' : '有差异（阴影参与绘制）',
          r[k].withHill.toString(16), r[k].without.toString(16));
      }
      if (errors.length) console.log('ERRORS\n' + errors.join('\n'));
      return;
    }

    if (mode === 'drag') {
      /* 真实拖动帧率：每帧平移 + 重绘底图，用 rAF 间隔衡量。
       * 比 getImageData 同步准 —— 后者要把 GPU 表面读回来，本身就是几十毫秒开销。 */
      const size = process.argv[3] === 'xl' ? 'xl' : 'l';
      const view = process.argv[4] || 'terrain';
      const { page, errors } = await boot(browser, { size });
      await cleanFrame(page);
      const r = await page.evaluate(async (view) => {
        const R = window.__renderer;
        R.setView(view);
        R.fit();
        R.draw();
        const cx = R.cam.x, cy = R.cam.y;
        const gaps = [];
        let last = 0, i = 0;
        await new Promise(res => {
          function step(t) {
            if (last) gaps.push(t - last);
            last = t;
            R.cam.x = cx + (i % 60) * 4 - 120;
            R.cam.y = cy + ((i % 40) - 20) * 3;
            R.clampCam();
            R._needBase = true;
            R.draw();
            if (++i < 90) requestAnimationFrame(step); else res();
          }
          requestAnimationFrame(step);
        });
        const s = gaps.slice(1).sort((a, b) => a - b);
        const q = p => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
        return { view, size: [R.world.meta.width, R.world.meta.height], frames: s.length,
          med: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(1),
          fps: +(1000 / q(0.5)).toFixed(0) };
      }, view);
      console.log(JSON.stringify(r));
      if (errors.length) console.log('ERRORS\n' + errors.join('\n'));
      return;
    }

    if (mode === 'perf') {
      const xl = process.argv[3] === 'xl';
      const { page, errors } = await boot(browser, { size: xl ? 'xl' : 'l' });
      /* 交错采样四个变体，抵消机器负载漂移：
       *   noHill    只画底图（≈ 政治视图的成本）
       *   oldClip   底图 + clip 全部省界 + overlay（改动前的写法）
       *   newNoClip 底图 + overlay（改动后：海面中性，不必 clip）
       *   hillOnly  只画 overlay 这一层
       * 每轮结束都 getImageData(1,1) 强制同步，量到的是真实光栅化耗时。 */
      const r = await page.evaluate(() => {
        const R = window.__renderer, w = R.world;
        const c2 = R.base.getContext('2d');
        const sync = () => c2.getImageData(0, 0, 1, 1);
        const out = {
          timing: w.meta.timing, size: [w.meta.width, w.meta.height],
          hillBytes: w.hillshade.data.length,
          hillCanvasMB: +((R.hillCanvas.width * R.hillCanvas.height * 4) / 1048576).toFixed(1)
        };
        R.setView('terrain');
        const s = R.cam.scale, dpr = R.dpr;
        const setWorld = () => c2.setTransform(dpr * s, 0, 0, dpr * s,
          dpr * (R.cssW / 2 - R.cam.x * s), dpr * (R.cssH / 2 - R.cam.y * s));

        const acc = { noHill: [], oldClip: [], newNoClip: [], hillOnly: [] };
        for (let round = 0; round < 12; round++) {
          // noHill
          sync();
          let t0 = performance.now();
          const keep = R.hillCanvas;
          R.hillCanvas = null; R._needBase = true; R._renderBase(); R.hillCanvas = keep;
          sync(); acc.noHill.push(performance.now() - t0);

          // newNoClip（_renderBase 内部就是"填完再绘阴影"，与最终一致）
          sync();
          t0 = performance.now();
          R._needBase = true; R._renderBase();
          sync(); acc.newNoClip.push(performance.now() - t0);

          // oldClip：再补一次 clip + overlay，模拟改动前的额外开销
          sync();
          t0 = performance.now();
          setWorld();
          c2.save();
          c2.clip(R.allRingPath);
          c2.globalCompositeOperation = 'overlay';
          c2.globalAlpha = 0.85;
          c2.drawImage(keep, 0, 0, w.meta.width, w.meta.height);
          c2.restore();
          sync(); acc.oldClip.push(performance.now() - t0);

          // hillOnly：只画 overlay 这一层
          sync();
          t0 = performance.now();
          setWorld();
          c2.save();
          c2.globalCompositeOperation = R.hillBlend;
          c2.globalAlpha = R.hillAlpha;
          c2.drawImage(keep, 0, 0, w.meta.width, w.meta.height);
          c2.restore();
          sync(); acc.hillOnly.push(performance.now() - t0);
        }
        for (const k in acc) {
          const a = acc[k].sort((x, y) => x - y);
          out[k] = { med: +a[a.length >> 1].toFixed(1), min: +a[0].toFixed(1), max: +a[a.length - 1].toFixed(1) };
        }
        out.mem = performance.memory ? {
          usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
          limitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)
        } : null;
        // 判断这份耗时是不是软件光栅（SwiftShader）测出来的
        try {
          const gl = document.createElement('canvas').getContext('webgl');
          const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
          out.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
        } catch (e) { out.gpu = 'error'; }
        return out;
      });
      console.log(JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v, 2));
      if (errors.length) console.log('ERRORS\n' + errors.join('\n'));
      return;
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
