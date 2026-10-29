/* =============================================================
 * test/chrono.js —— 编年史（v5）的验收
 *
 * 对着任务书的验收清单逐条过：
 *   1) 顶栏「编年史」随时开合；年表随回合增长，战报按年份并入不重复
 *   2) 统一全图 / 被灭自动弹一次，不重复触发；定稿后可继续经营、可重新定稿
 *   3) 三张快照与当前地图视图一致（政治/地形/信仰各对一遍），打开时主视图不闪不切
 *   4) 终版称号符合条件表（手造一个统一局验"千古一帝"）；印章为程序绘制
 *   5) 导出 PNG：长卷内容完整、文字清晰、可下载；种子码复制成功，失败走手动兜底
 *   6) 存档升版往返含 YEARLOG；读旧档空年表不炸
 *
 * 跑法：node test/chrono.js
 * 小世界（140 省 / 8 国），全程约 40 秒。
 * ============================================================= */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const shot = (n) => path.join(root, 'shots', n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
const ck = (name, ok, note) => { out.push([name, !!ok, note || '']); };

/* 画布"有内容"：统计不重复颜色数（纯色/空白会是个位数） */
const COLOR_COUNT = `(cv) => {
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4 * 53) set.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return set.size;
}`;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2400);

  async function smallWorld(seed) {
    await page.evaluate((s) => {
      document.getElementById('prov').value = 140;
      document.getElementById('ctry').value = 8;
      document.getElementById('seed').value = s;
      document.getElementById('gen').click();
    }, seed);
    await sleep(2600);
  }

  /* ================= ① 顶栏入口 / 开合 ================= */
  ck('顶部有「编年史」文字钮', await page.$eval('#chronoBtn', b => b.textContent.trim() === '编年史' &&
    getComputedStyle(b).display !== 'none'));

  await smallWorld('chrono-spec-1');
  await page.evaluate(() => AO.resDebug.choosePlayer(AO.resDebug.world().countries[0].id));

  /* v16：存档/读档/科技/治理/编年史 收进了 ☰ 菜单，先把菜单打开再点 */
  await page.click('#menuBtn');
  await sleep(150);
  await page.click('#chronoBtn');
  await sleep(700);
  const opened = await page.evaluate(() => {
    const el = document.getElementById('chrono');
    return {
      on: el.classList.contains('on'),
      z: +getComputedStyle(el).zIndex,
      secs: ['chMaps', 'chYears', 'chData', 'chTitles', 'chPng', 'chSeed', 'chFinal']
        .every(id => !!document.getElementById(id)),
      scroll: getComputedStyle(document.getElementById('chScroll')).overflow,
      bgs: getComputedStyle(el).backgroundImage.indexOf('gradient') >= 0
    };
  });
  ck('点开 → 史书页上屏（全屏层）', opened.on && opened.z >= 40, 'z=' + opened.z);
  ck('六个版块 + 底部按钮条齐全', opened.secs);
  ck('页面可滚动（不是一屏塞死）', /auto|scroll/.test(opened.scroll), opened.scroll);
  ck('暖白纸底（纸面语汇）', opened.bgs);

  /* 打开时：不切视图、不闪、滚轮不缩放地图 */
  const viewBefore = await page.evaluate(() => window.__renderer.viewMode);
  const mapPixBefore = await page.evaluate(() => {
    const cv = document.getElementById('map');
    const d = cv.getContext('2d').getImageData(cv.width >> 2, cv.height >> 2, 60, 60).data;
    return Array.from(d.slice(0, 240)).join(',');
  });
  const wheelRes = await page.evaluate(() => {
    const cv = document.getElementById('map');
    const before = window.__renderer.cam.scale;
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -420, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    return [before, window.__renderer.cam.scale];
  });
  ck('史书开着时滚轮不平移地图', wheelRes[0] === wheelRes[1], wheelRes.join('→'));
  ck('打开面板不改当前地图视图', await page.evaluate(() => window.__renderer.viewMode) === viewBefore, viewBefore);
  const mapPixAfter = await page.evaluate(() => {
    const cv = document.getElementById('map');
    const d = cv.getContext('2d').getImageData(cv.width >> 2, cv.height >> 2, 60, 60).data;
    return Array.from(d.slice(0, 240)).join(',');
  });
  ck('主画布一个像素都没动（不闪屏）', mapPixBefore === mapPixAfter);

  await page.keyboard.press('Escape');
  await sleep(200);
  ck('ESC 关闭', await page.evaluate(() => !document.getElementById('chrono').classList.contains('on')));

  /* ================= ② 三图快照 ================= */
  /* v16：存档/读档/科技/治理/编年史 收进了 ☰ 菜单，先把菜单打开再点 */
  await page.click('#menuBtn');
  await sleep(150);
  await page.click('#chronoBtn');
  await sleep(600);
  const maps = await page.evaluate((fnSrc) => {
    const count = eval('(' + fnSrc + ')');
    const cvs = [...document.querySelectorAll('#chMaps canvas')];
    return cvs.map(cv => ({ w: cv.width, h: cv.height, colors: count(cv), url: cv.toDataURL().slice(-260) }));
  }, COLOR_COUNT);
  ck('三张缩略图都在（政治/地形/信仰）', maps.length === 3, maps.map(m => m.w + '×' + m.h).join(' '));
  ck('三张图都有实际绘制内容', maps.every(m => m.colors > 60), maps.map(m => m.colors).join('/'));
  ck('三张图互不相同（视图真的换了）',
    new Set(maps.map(m => m.url)).size === 3);

  const mapView = await page.evaluate(() => window.__renderer.viewMode);
  ck('快照不抢玩家的视图（写完恢复）', mapView === viewBefore, mapView);

  /* 点图放大 */
  await page.click('#chMaps figure');
  await sleep(300);
  const zoomed = await page.evaluate(() => {
    const z = document.getElementById('chZoom');
    const cv = document.getElementById('chZoomCv');
    return [z.classList.contains('on'), cv.width > 900];
  });
  ck('点缩略图可放大', zoomed[0] && zoomed[1], zoomed.join(' '));
  await page.click('#chZoom');
  await sleep(150);
  ck('再点关闭放大', await page.evaluate(() => !document.getElementById('chZoom').classList.contains('on')));

  await page.keyboard.press('Escape');
  await sleep(150);

  /* ================= ③ 年表：随回合增长 + 战报合并去重 ================= */
  /* 小世界头几回合本来就"无事可记"（没战争、事件也没掷到），
   * 所以这里既走真回合，也顺手往即时流里塞两条纪要 —— 测的是**归档链**，
   * 不是这一局恰好有没有事发生。 */
  for (let i = 0; i < 5; i++) {
    await page.evaluate((k) => {
      if (AO.evtPending()) AO.evtPick(0);
      AO.resDebug.notes().push({
        owner: AO.resDebug.player(), cls: 'ok',
        text: k === 0 ? '⚑ 测试：天有异象，史官记之' : '测试纪要 ' + k
      });
      AO.resDebug.nextTurn();
    }, i);
    await sleep(240);
  }
  const yl = await page.evaluate(() => AO.chronoYearLog().map(r => ({ turn: r.turn, n: r.entries.length })));
  const asc = yl.every((r, i) => i === 0 || yl[i - 1].turn < r.turn);
  ck('年表随回合增长（有记录、按年升序）', yl.length >= 3 && asc, JSON.stringify(yl.slice(0, 8)));

  /* 手工塞一条战报：它同时出现在 WARLOG（不进 NOTES），年表应并入且只一次 */
  const merge = await page.evaluate(() => {
    const t = AO.resDebug.turn();
    const txt = '⚔ 测试林地（丘陵·守 ×1.32）：甲国 张三 7200 人 攻 乙国 李四 5100 人｜甲国胜，6410 : 3398';
    AO.resDebug.log().unshift({ turn: t, cls: 'ok', text: txt });
    AO.chronoArchive();
    AO.chronoArchive();                                  // 再来一次也不能重复
    const recs = AO.chronoYearLog().filter(r => r.turn === t);
    const hit = recs.reduce((a, r) => a + r.entries.filter(e => /测试林地/.test(e.text)).length, 0);
    const tag = recs[0] && recs[0].entries.find(e => /测试林地/.test(e.text));
    return [hit, tag && tag.tag, AO.resDebug.log().filter(e => /测试林地/.test(e.text)).length];
  });
  ck('战报按年份并入年表且不重复', merge[0] === 1 && merge[2] === 1, '年表 ' + merge[0] + ' 条 / 战报 ' + merge[2] + ' 条');
  ck('战报条目带地点、归到 battle 类', merge[1] === 'battle', String(merge[1]));

  /* 事件（同时进 NOTES + WARLOG）也只能有一条 */
  const dup = await page.evaluate(() => {
    const recs = AO.chronoYearLog();
    let bad = 0, total = 0;
    for (const r of recs) {
      const seen = new Set();
      for (const e of r.entries) {
        total++;
        if (seen.has(e.text)) bad++;
        seen.add(e.text);
      }
    }
    return [bad, total];
  });
  ck('年表内没有重复条目', dup[0] === 0, dup[1] + ' 条 / 重 ' + dup[0]);

  /* 年表渲染：出现「第 N 年」小节 */
  /* v16：存档/读档/科技/治理/编年史 收进了 ☰ 菜单，先把菜单打开再点 */
  await page.click('#menuBtn');
  await sleep(150);
  await page.click('#chronoBtn');
  await sleep(500);
  const years = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('#chYears .chy h4 span')].map(e => e.textContent);
    return { n: hs.length, first: hs[0] || '', ms: document.querySelectorAll('#chYears .ent.ms').length };
  });
  ck('页面按年分节（第 N 年）', years.n >= 2 && /^第 \d+ 年$/.test(years.first), years.n + ' 节 · ' + years.first);
  ck('里程碑条目前置标记', years.ms >= 1, years.ms + ' 条');

  await page.screenshot({ path: shot('chrono-spec-live.png') });
  await page.keyboard.press('Escape');
  await sleep(150);

  /* ================= ④ 自动触发：统一全图 ================= */
  const unify = await page.evaluate(() => {
    const w = AO.resDebug.world(), cid = AO.resDebug.player();
    const ids = w.provinces.map(p => p.id);
    for (const pid of ids) AO.resDebug.occupy(pid, cid, '测试');
    return {
      mode: AO.chronoFlags().unified,
      open: document.getElementById('chrono').classList.contains('on'),
      note: AO.resDebug.notes().filter(n => /天下归一/.test(n.text)).length,
      wt: AO.chronoYearLog().reduce((a, r) => a + r.entries.filter(e => /天下归一/.test(e.text)).length, 0)
    };
  });
  await sleep(500);
  ck('统一全图 → 记 flag 并自动弹史书', unify.mode === 1 && unify.open, 'flag=' + unify.mode + ' open=' + unify.open);
  ck('「天下归一」进 NOTES 且进年表', unify.note === 1 && unify.wt === 1, 'NOTES ' + unify.note + ' / 年表 ' + unify.wt);

  /* 折叠：这一年条目远超 14 条 —— 应该有「展卷」 */
  const fold = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('#chYears .chy')].find(s => s.classList.contains('cut'));
    if (!sec) return [false, 0, 0];
    return [true, sec.querySelectorAll('.ent').length, sec.querySelectorAll('.ent.fold').length];
  });
  ck('超长年份折叠成「展卷」', fold[0] && fold[2] > 0, '共 ' + fold[1] + ' 条 / 折 ' + fold[2] + ' 条');
  const unfold = await page.evaluate(() => {
    const sec = document.querySelector('#chYears .chy.cut');
    const b = sec && sec.querySelector('.chmore');
    if (!b) return null;
    b.click();
    return [sec.classList.contains('cut'), getComputedStyle(sec.querySelector('.ent.fold')).display];
  });
  ck('点「展卷」展开其余条目', unfold && unfold[0] === false && unfold[1] === 'flex', unfold && unfold.join(' '));

  /* 再判一次：不重复触发（按年表计，NOTE 每次 nextTurn 都会被清空） */
  const twice = await page.evaluate(() => {
    const count = () => AO.chronoYearLog().reduce((a, r) =>
      a + r.entries.filter(e => /天下归一/.test(e.text)).length, 0);
    const before = count();
    AO.chronoCheck();
    AO.resDebug.nextTurn();
    return [before, count()];
  });
  ck('统一只播报一次（不重复触发）', twice[0] === 1 && twice[1] === 1, twice.join('→'));

  /* ================= ⑤ 定稿 + 称号 + 印章 ================= */
  await page.evaluate(() => { if (AO.evtPending()) AO.evtPick(0); });
  await page.evaluate(() => { if (!AO.chronoIsOpen()) AO.chronoOpen(); });
  await sleep(400);
  const fin = await page.evaluate(() => {
    const f = AO.chronoFinalize();
    return {
      turn: f.turn, now: AO.resDebug.turn(),
      titles: f.titles.map(t => t.cn),
      shots: Object.keys(f.shots)
    };
  });
  ck('定稿：快照当前年 + 算出称号', fin.turn === fin.now && fin.titles.length >= 1,
    '第 ' + fin.turn + ' 年 · ' + fin.titles.join(' / '));
  ck('统一局 → 千古一帝', fin.titles[0] === '千古一帝', fin.titles.join(' / '));
  ck('定稿时三张图都存进快照', fin.shots.length === 3, fin.shots.join(','));

  const seal = await page.evaluate(() => {
    const cvs = [...document.querySelectorAll('#chTitles canvas')];
    const info = cvs.map(cv => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let red = 0, cream = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
        if (a < 30) continue;
        if (r > 120 && g < 110 && b < 100) red++;
        if (r > 225 && g > 210 && b > 185) cream++;
      }
      return [red, cream];
    });
    return { n: cvs.length, info, top: document.querySelectorAll('#chMark .chtopseal').length };
  });
  ck('称号是程序画的朱红圆章（红底 + 纸色字）',
    seal.n >= 1 && seal.info.every(v => v[0] > 300 && v[1] > 60), JSON.stringify(seal.info));
  ck('顶部也有定稿章（定稿年份 + 称号章）', seal.top === seal.n, seal.top + '/' + seal.n);
  await page.screenshot({ path: shot('chrono-spec-final.png') });

  /* 定稿后继续经营 → 终版数据不跟着变，可再定稿刷新 */
  const after = await page.evaluate(() => {
    AO.chronoClose();
    AO.resDebug.nextTurn();
    AO.chronoOpen();
    const sealed = AO.chronoFinal().turn;
    const later = !!document.querySelector('#chMark .later');
    AO.chronoFinalize();
    return [sealed, AO.chronoFinal().turn, later, AO.resDebug.turn()];
  });
  ck('定稿后可继续经营，终版仍盖章在定稿年', after[2] && after[0] < after[3], JSON.stringify(after));
  ck('重新定稿刷新到当前年', after[1] === after[3], after[1] + '/' + after[3]);

  /* ================= ⑥ 导出 PNG + 种子码 ================= */
  const png = await page.evaluate(() => {
    const cv = AO.chronoBuildPNG(1200);
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 907) set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    window.__exp = cv.toDataURL('image/png');
    return { w: cv.width, h: cv.height, colors: set.size, url: window.__exp };
  });
  ck('导出 PNG：1200 宽、按内容自适应高', png.w === 1200 && png.h > 900, png.w + '×' + png.h);
  ck('长卷有实际内容（纸底/图廓/文字）', png.colors > 200, png.colors + ' 色');
  fs.writeFileSync(shot('chrono-spec-export.png'),
    Buffer.from(png.url.split(',')[1], 'base64'));
  ck('导出的 data URL 可落盘成 PNG', fs.existsSync(shot('chrono-spec-export.png')) &&
    fs.statSync(shot('chrono-spec-export.png')).size > 40000,
    Math.round(fs.statSync(shot('chrono-spec-export.png')).size / 1024) + ' KB');

  /* 种子码：正常路径（execCommand 成功）不弹 prompt */
  const cp1 = await page.evaluate(() => {
    window.__prompt = [];
    const old = window.prompt, oldExec = document.execCommand;
    window.prompt = (m, v) => { window.__prompt.push(v); return null; };
    document.execCommand = () => true;
    const nav = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch (e) {}
    const ok = AO.chronoCopySeed();
    Object.defineProperty(navigator, 'clipboard', nav || { value: undefined, configurable: true });
    document.execCommand = oldExec; window.prompt = old;
    return [ok, window.__prompt.length];
  });
  ck('复制种子码：成功路径直接写剪贴板', cp1[0] === true && cp1[1] === 0, cp1.join('/'));

  /* file:// 下 clipboard + execCommand 都失败 → 弹原生 prompt 兜底 */
  const cp2 = await page.evaluate(() => {
    window.__prompt = [];
    const oldPrompt = window.prompt, oldExec = document.execCommand;
    window.prompt = (m, v) => { window.__prompt.push(v); return null; };
    document.execCommand = () => false;
    try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch (e) {}
    const ok = AO.chronoCopySeed();
    document.execCommand = oldExec; window.prompt = oldPrompt;
    return [ok, window.__prompt[0] || '', document.getElementById('seed').value];
  });
  ck('剪贴板被禁 → 走 prompt 手动复制兜底', cp2[0] === false && cp2[1] === cp2[2],
    '种子码 ' + cp2[1]);

  /* ================= ⑦ 存档升版往返 ================= */
  const save = await page.evaluate(() => {
    AO.chronoClose();
    AO.resDebug.save();
    const raw = JSON.parse(localStorage.getItem(AO.SAVE_KEY));
    return {
      v: raw.v, ver: AO.SAVE_VER,
      hasChrono: !!raw.CHRONO,
      years: (raw.CHRONO.YEARLOG || []).length,
      fin: !!(raw.CHRONO.FINAL && raw.CHRONO.FINAL.data),

      bytes: JSON.stringify(raw).length
    };
  });
  /* 版本号只验"≥ v5"：v5 引入编年史，之后每加一层（v6 迷雾…）都会 +1，
   * 硬写 === 5 会让每次升版都误报一次 */
  ck('存档升到 v5+ 且含 YEARLOG / 定稿', save.v >= 5 && save.ver === save.v && save.hasChrono && save.years > 0 && save.fin,
    'v' + save.v + ' · 年表 ' + save.years + ' 年 · ' + Math.round(save.bytes / 1024) + ' KB');

  /* 换一个世界（清空年表）再读档 → 年表回来 */
  await smallWorld('chrono-spec-2');
  const emptied = await page.evaluate(() => AO.chronoYearLog().length);
  await page.evaluate(() => AO.resDebug.load());
  await sleep(3000);
  const loaded = await page.evaluate(() => ({
    years: AO.chronoYearLog().length,
    turn: AO.resDebug.turn(),
    fin: !!AO.chronoFinal(),
    seed: document.getElementById('seed').value
  }));
  ck('换世界清空年表（chronoReset）', emptied === 0, String(emptied));
  ck('读档把 YEARLOG / 定稿一起带回来', loaded.years === save.years && loaded.fin && loaded.seed === 'chrono-spec-1',
    JSON.stringify(loaded));

  /* 定稿后的三图在存档里是 dataURL：读回来仍能画出来 */
  const restored = await page.evaluate(() => {
    AO.chronoOpen();
    return new Promise(res => setTimeout(() => {
      const cvs = [...document.querySelectorAll('#chMaps canvas')];
      const count = (cv) => {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        const set = new Set();
        for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
        return set.size;
      };
      res(cvs.map(count));
    }, 400));
  });
  ck('读档后定稿三图仍能画出来', restored.length === 3 && restored.every(n => n > 60), restored.join('/'));

  /* 旧档（v6 及以下）→ **拒读**并提示 legacy-v19（阶段一换血后的新政策） */
  const old = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem(AO.SAVE_KEY));
    raw.v = 4;
    delete raw.CHRONO;
    localStorage.setItem(AO.SAVE_KEY, JSON.stringify(raw));
    AO.chronoClose();
    AO.resDebug.load();
    return true;
  });
  await sleep(3200);
  const oldLoad = await page.evaluate(() => ({
    years: AO.chronoYearLog().length,
    fin: !!AO.chronoFinal(),
    flags: AO.chronoFlags(),
    turn: AO.resDebug.turn()
  }));
  ck('读 v6 旧档：拒读，年表保持原样、世界不重建',
    old && oldLoad.years === 8 && oldLoad.turn === 8,
    JSON.stringify(oldLoad) + '（旧档被挡在版本闸门外）');

  /* ================= ⑧ 灭亡：亡国史书 + 悲情末帝 ================= */
  await smallWorld('chrono-spec-3');
  const dead = await page.evaluate(() => {
    const w = AO.resDebug.world();
    const cid = w.countries[0].id, other = w.countries[1].id;
    AO.resDebug.choosePlayer(cid);
    const mine = w.provinces.filter(p => p.owner === cid).map(p => p.id);
    for (const pid of mine) AO.resDebug.occupy(pid, other, '测试');
    const mode = AO.chronoFlags().dead;
    const open = document.getElementById('chrono').classList.contains('on');
    const f = AO.chronoFinalize();
    return {
      mode, open,
      deadCls: document.getElementById('chrono').classList.contains('dead'),
      note: AO.resDebug.notes().filter(n => /亡国/.test(n.text)).length,
      titles: f.titles.map(t => t.cn)
    };
  });
  await sleep(400);
  ck('被灭 → 记 flag 并自动弹「亡国史书」', dead.mode === 1 && dead.open, 'flag=' + dead.mode);
  ck('亡国史书有独立版式（.dead）', dead.deadCls);
  ck('亡国称号 → 悲情末帝', dead.titles[0] === '悲情末帝', dead.titles.join(' / '));
  await page.screenshot({ path: shot('chrono-spec-dead.png') });

  /* ================= 汇总 ================= */
  console.log('\n================ 编年史（v5）验收 ================\n');
  let fail = 0;
  for (const [name, ok, note] of out) {
    if (!ok) fail++;
    console.log((ok ? '  PASS  ' : '> FAIL <') + '  ' + name + (note ? '  —  ' + note : ''));
  }
  console.log('\n' + (fail ? '存在 ' + fail + ' 项失败' : '全部 ' + out.length + ' 项通过'));
  if (errors.length) {
    console.log('\n页面报错：');
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
  }
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
