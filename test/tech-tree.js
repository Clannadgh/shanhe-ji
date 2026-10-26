/* =============================================================
 * test/tech-tree.js —— 全屏科技树的验收
 *
 * 对着任务书第五节逐条过：
 *   1) 国家卡里只有摘要 + 按钮；点按钮全屏树铺开，× / ESC 能关
 *   2) 无前置的科技在第 1 列；「良种牧场」因 req「铁犁深耕」排在下一列且有虚线连过去
 *   3) 四态切换：锁定灰、可研能点开研、研究中带进度、完成 ✓ 变淡
 *   4) 科研条没攒满的国家：除**免费根（皮革工艺）**之外全锁（提示"建学校开始科研"）
 *      —— 旧用例跟改：v19 返工后树上多了一枚开局就点亮的根，"全锁"不再成立，
 *      改成"19 锁 + 1 亮"。
 *   5) 树宽超屏时能横向拖；地图滚轮缩放在 overlay 开着时不起作用
 *
 * 用法：node test/tech-tree.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const shot = (n) => path.join(root, 'shots', n);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  await sleep(2600);

  const checks = [];
  const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

  /* ---- 0) 选一个国家，打开国家卡 ---- */
  const C = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    const p = w.provinces[w.countries[0].capital - 1];
    R.cam.x = p.centroid[0]; R.cam.y = p.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(p.id); R.draw();
    R.selectCountry(p.owner);
    return { owner: p.owner, name: p.name };
  });
  await sleep(200);

  /* ---- 1) 国家卡瘦身 ---- */
  const card = await page.evaluate(() => {
    const box = document.getElementById('cTech');
    return {
      nodes: box.querySelectorAll('.tnode, .ttnode').length,
      researchBtns: box.querySelectorAll('.tbtn').length,
      hasBar: !!box.querySelector('.bar.tech'),
      hasOpen: !!box.querySelector('.topen'),
      status: (box.querySelector('.trow') || {}).textContent || '',
      text: box.textContent.replace(/\s+/g, ' ')
    };
  });
  ck('国家卡「科技」只有摘要（无内联列表 / 无研究钮）',
    card.nodes === 0 && card.researchBtns === 0 && card.hasBar && card.hasOpen,
    '列表 ' + card.nodes + ' / 研究钮 ' + card.researchBtns + ' / 进度条 ' + card.hasBar + ' / 按钮 ' + card.hasOpen);
  ck('未解锁时状态行是「未解锁 · 建学校开始科研」',
    /未解锁/.test(card.status) && /建学校开始科研/.test(card.status), card.status.replace(/\s+/g, ' '));

  /* ---- 2) 点按钮 → 全屏铺开 ---- */
  await page.evaluate(() => document.querySelector('#cTech .topen').click());
  await sleep(250);
  const opened = await page.evaluate(() => {
    const ov = document.getElementById('techTree'), r = ov.getBoundingClientRect();
    const cs = getComputedStyle(ov);
    return {
      on: ov.classList.contains('on'),
      z: +cs.zIndex,
      full: r.top <= 0 && r.left <= 0 && r.width >= window.innerWidth && r.height >= window.innerHeight,
      paper: cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
      frame: !!document.getElementById('ttFrame'),
      flag: document.getElementById('ttFlag').style.background,
      name: document.getElementById('ttName').textContent,
      id: document.getElementById('ttNameEn').textContent,
      meter: document.getElementById('ttPts').textContent,
      stage: document.getElementById('ttStage').clientHeight
    };
  });
  ck('点「打开科技树」→ 全屏 overlay 铺开（z-index 盖过卡片）',
    opened.on && opened.full && opened.z > 12 && opened.paper && opened.frame,
    'z=' + opened.z + '，铺满=' + opened.full + '，图廓=' + opened.frame + '，舞台高 ' + opened.stage);
  ck('顶栏：国旗色块 + 国名 · 编号 + 科研条',
    /rgb|#/.test(opened.flag) && opened.name.length > 0 && /#\d+/.test(opened.id) && /\d+ \/ 30/.test(opened.meter),
    opened.name + ' ' + opened.id + ' · ' + opened.meter);

  /* ---- 4) 没攒满科研条 → 除免费根之外全锁 ----
   * **旧用例跟改**（v19 返工）：原来断言"20 个节点全锁"，但树上有一枚**免费根**
   * （皮革工艺，t.free）—— 设计上它开局就是已点亮的根（任务书原话"树上画成
   * 已点亮的根"），所以锁定的判定要把它排除：19 锁 + 1 亮。 */
  const locked = await page.evaluate(() => {
    const ns = [...document.querySelectorAll('#ttNodes .ttnode')];
    const lockNs = ns.filter(n => n.classList.contains('lock'));
    const freeNs = ns.filter(n => n.classList.contains('done'));
    const txt = (n) => (n.querySelector('.ft') || {}).textContent || '';
    return {
      n: ns.length,
      lock: lockNs.length,
      free: freeNs.length,
      freeKeys: freeNs.map(n => n.getAttribute('data-tech')),
      freeNotes: [...new Set(freeNs.map(txt))],
      notes: [...new Set(lockNs.map(txt))]
    };
  });
  const techN = await page.evaluate(() => ({
    n: window.AO.TECHS.length,
    edges: window.AO.TECHS.filter(t => !!t.req).length
  }));
  ck('科研条没攒满 → ' + (techN.n - 1) + ' 个节点锁着（免费根已点亮），提示「建学校开始科研」',
    locked.n === techN.n && locked.lock === techN.n - 1 && locked.free === 1 &&
    locked.freeKeys.indexOf('leather') >= 0 &&
    locked.notes.length === 1 && /建学校开始科研/.test(locked.notes[0]),
    locked.lock + '/' + locked.n + ' 锁 · 亮点 ' + locked.freeKeys.join(',') +
    '（' + locked.freeNotes.join('|') + '），锁定文案「' + locked.notes.join('|') + '」');

  /* 点锁定节点 → 顶部提示行（不弹 alert） */
  await page.evaluate(() => document.querySelector('#ttNodes .ttnode[data-tech="plow2"]').click());
  await sleep(120);
  const lockMsg = await page.evaluate(() => {
    const m = document.getElementById('ttMsg');
    return { text: m.textContent, on: m.classList.contains('on') };
  });
  ck('点不动的节点 → 顶栏下提示行给一句话', lockMsg.on && /建学校开始科研/.test(lockMsg.text), lockMsg.text);
  await page.screenshot({ path: shot('tt-a-locked.png') });

  /* ---- 5a) 地图滚轮在 overlay 开着时不起作用 ---- */
  const wheel = await page.evaluate(() => {
    const R = window.__renderer;
    const before = R.cam.scale;
    document.getElementById('map').dispatchEvent(new WheelEvent('wheel', {
      deltaY: -420, clientX: 700, clientY: 500, bubbles: true, cancelable: true
    }));
    return { before, after: R.cam.scale };
  });
  ck('overlay 开着 → 地图滚轮不缩放', wheel.before === wheel.after,
    'scale ' + wheel.before + ' → ' + wheel.after);

  /* ---- 2) 布局：列 = 前置深度 ---- */
  /* 先给这个国家把科研条点满，好看到「可研」态 */
  await page.evaluate((o) => { const R = window.AO.resResearch[o]; R.pts = 30; R.unlocked = true; }, C.owner);
  await page.evaluate(() => { document.getElementById('ttClose').click(); });
  await sleep(120);
  await page.evaluate(() => document.querySelector('#cTech .topen').click());
  await sleep(250);

  const geo = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#ttNodes .ttnode').forEach(n => {
      out[n.getAttribute('data-tech')] = {
        left: Math.round(parseFloat(n.style.left)),
        top: Math.round(parseFloat(n.style.top)),
        cls: n.className.replace('ttnode ', '')
      };
    });
    const edges = [...document.querySelectorAll('#ttEdges path')].map(p => p.getAttribute('d'));
    const svg = document.getElementById('ttEdges');
    return { pos: out, edges, svgW: +svg.getAttribute('width'), svgH: +svg.getAttribute('height') };
  });
  const P = geo.pos;
  const roots = ['plow2', 'saw2', 'net2'];
  const col1 = roots.every(k => P[k].left === P[roots[0]].left);
  ck('无前置的三条（铁犁深耕/水力锯木/远洋渔网）都在第 1 列',
    col1 && P.plow2.left < P.breed2.left, 'x = ' + roots.map(k => P[k].left).join(' / ') + '，良种牧场 x = ' + P.breed2.left);
  ck('「良种牧场」因 req「铁犁深耕」排在下一列',
    P.breed2.left > P.plow2.left && Math.abs(P.breed2.top - P.plow2.top) <= P.saw2.top - P.plow2.top,
    '铁犁深耕 (' + P.plow2.left + ',' + P.plow2.top + ') → 良种牧场 (' + P.breed2.left + ',' + P.breed2.top + ')');
  ck('三列深度正确（精炼提金在最右列）',
    P.mint2.left > P.blast2.left && P.blast2.left > P.saw2.left,
    '水力锯木 ' + P.saw2.left + ' → 高炉鼓风 ' + P.blast2.left + ' → 精炼提金 ' + P.mint2.left);
  ck('同列上下均匀分布（第 1 列三行等距）',
    (P.saw2.top - P.plow2.top) === (P.net2.top - P.saw2.top) && P.saw2.top > P.plow2.top,
    P.plow2.top + ' / ' + P.saw2.top + ' / ' + P.net2.top);
  ck('前置虚线 = 有 req 的科技条数', geo.edges.length === techN.edges,
    geo.edges.length + ' 条（应为 ' + techN.edges + '）');

  /* ---- 3) 四态 ---- */
  const states0 = await page.evaluate(() => {
    const o = {};
    document.querySelectorAll('#ttNodes .ttnode').forEach(n => {
      o[n.getAttribute('data-tech')] = n.className.replace('ttnode ', '');
    });
    return o;
  });
  ck('四态：根节点可研、子节点仍锁',
    states0.plow2 === 'avail' && states0.saw2 === 'avail' && states0.net2 === 'avail' &&
    states0.breed2 === 'lock' && states0.blast2 === 'lock' && states0.pan2 === 'lock',
    JSON.stringify(states0));

  await page.screenshot({ path: shot('tt-b-avail.png') });

  /* 点可研节点 → 入队（v2：入队不扣费，队头下一回合才开研） */
  const before = await page.evaluate((o) => {
    const R = window.AO.resResearch[o];
    return { pts: R.pts, gold: window.AO.resCentral[o].gold };
  }, C.owner);
  await page.evaluate(() => document.querySelector('#ttNodes .ttnode[data-tech="plow2"]').click());
  await sleep(200);
  const queued = await page.evaluate((o) => {
    const R = window.AO.resResearch[o];
    const n = document.querySelector('#ttNodes .ttnode[data-tech="plow2"]');
    return {
      pts: R.pts, gold: window.AO.resCentral[o].gold, cur: R.cur && R.cur.key,
      q: (R.queue || []).slice(),
      badge: n.querySelector('.qbadge') ? n.querySelector('.qbadge').textContent : '',
      msg: document.getElementById('ttMsg').textContent
    };
  }, C.owner);
  ck('点可研节点 = 入队（不扣费）+ 序号角标',
    queued.q.length === 1 && queued.q[0] === 'plow2' && !queued.cur &&
    queued.pts === before.pts && queued.gold === before.gold && queued.badge === '1',
    '队列 [' + queued.q.join(',') + ']，角标 ' + queued.badge +
    '，科研点/金未动（' + queued.pts + ' / ' + queued.gold + '）');

  /* 再点一次 = 取消（还没扣费，不损失任何东西） */
  await page.evaluate(() => document.querySelector('#ttNodes .ttnode[data-tech="plow2"]').click());
  await sleep(150);
  const cancelled = await page.evaluate((o) => ({
    q: (window.AO.resResearch[o].queue || []).slice(),
    msg: document.getElementById('ttMsg').textContent
  }), C.owner);
  ck('再点一次 = 取消（未扣费直接移除）',
    cancelled.q.length === 0 && /从队列移除/.test(cancelled.msg), cancelled.msg);

  /* 重新入队，然后过一回合让它真的开工 */
  await page.evaluate(() => document.querySelector('#ttNodes .ttnode[data-tech="plow2"]').click());
  await sleep(150);
  const turns = async (n) => { for (let i = 0; i < n; i++) { await page.evaluate(() => document.getElementById('ttTurn').click()); await sleep(80); } };
  await turns(1);
  const after = await page.evaluate((o) => {
    const R = window.AO.resResearch[o];
    const n = document.querySelector('#ttNodes .ttnode[data-tech="plow2"]');
    return {
      pts: R.pts, gold: window.AO.resCentral[o].gold, cur: R.cur && R.cur.key,
      cls: n.className.replace('ttnode ', ''),
      pbar: !!n.querySelector('.pbar'),
      ft: (n.querySelector('.ft') || {}).textContent || '',
      head: document.getElementById('ttCur').textContent.replace(/\s+/g, ' ')
    };
  }, C.owner);
  ck('队头下一回合开研（扣科研点 + 金）',
    after.cur === 'plow2' && after.pts < before.pts && after.gold < before.gold,
    '科研点 ' + before.pts + '→' + after.pts + '，金 ' + before.gold + '→' + after.gold);
  ck('研究中：高亮描边 + 节点内进度条 + 剩 N 回合',
    after.cls === 'cur' && after.pbar && /剩 \d+ 回合/.test(after.ft) && /正在研究/.test(after.head),
    after.cls + ' · ' + after.ft + ' · 顶栏「' + after.head + '」');

  /* 研究中再点别的节点 → 进队列排第二位，不动当前研究 */
  await page.evaluate(() => document.querySelector('#ttNodes .ttnode[data-tech="saw2"]').click());
  await sleep(150);
  const busy = await page.evaluate((o) => ({
    cur: window.AO.resResearch[o].cur && window.AO.resResearch[o].cur.key,
    q: (window.AO.resResearch[o].queue || []).slice(),
    msg: document.getElementById('ttMsg').textContent
  }), C.owner);
  ck('研究中点别的节点 → 排进队列，不改当前研究',
    busy.cur === 'plow2' && busy.q.length === 1 && busy.q[0] === 'saw2', busy.msg);
  await page.screenshot({ path: shot('tt-c-cur.png') });

  /* 过回合 → 完成（研完自动拉队列下一条） */
  await turns(2);
  const done = await page.evaluate(() => {
    const n = document.querySelector('#ttNodes .ttnode[data-tech="plow2"]');
    return {
      cls: n.className.replace('ttnode ', ''),
      seal: (n.querySelector('.seal') || {}).textContent || '',
      opacity: getComputedStyle(n).opacity,
      child: document.querySelector('#ttNodes .ttnode[data-tech="breed2"]').className.replace('ttnode ', '')
    };
  });
  ck('完成：右上角 ✓、整体变淡、子节点解锁',
    done.cls === 'done' && done.seal === '✓' && +done.opacity < 1 && done.child === 'avail',
    'cls=' + done.cls + ' 章=' + done.seal + ' 透明度=' + done.opacity + ' 子节点=' + done.child);
  await page.screenshot({ path: shot('tt-d-done.png') });

  /* 已完成的节点点不动 */
  const doneMsg = await page.evaluate(async () => {
    document.querySelector('#ttNodes .ttnode[data-tech="plow2"]').click();
    return document.getElementById('ttMsg').textContent;
  });
  ck('已完成节点点不动（只给提示）', /已经研究过/.test(doneMsg), doneMsg);

  /* ---- 5b) 横向拖拽 / 滚轮平移（窄屏） ---- */
  await page.setViewport({ width: 820, height: 700, deviceScaleFactor: 2 });
  await sleep(200);
  const beforeDrag = await page.evaluate((o) => {
    const R = window.AO.resResearch[o];
    return { cur: R.cur ? R.cur.key : null, q: (R.queue || []).slice() };
  }, C.owner);
  await page.evaluate(() => document.getElementById('ttClose').click());
  await page.evaluate(() => document.querySelector('#cTech .topen').click());
  await sleep(250);
  const overflow = await page.evaluate(() => {
    const cv = document.getElementById('ttCanvas');
    return { cw: cv.getBoundingClientRect().width, stage: document.getElementById('ttStage').clientWidth };
  });
  ck('窄屏时树比舞台宽（可横向平移）', overflow.cw > overflow.stage,
    '树宽 ' + Math.round(overflow.cw) + ' > 舞台 ' + overflow.stage);

  const before2 = await page.evaluate(() => document.getElementById('ttCanvas').style.transform);
  const box = await page.evaluate(() => {
    const r = document.getElementById('ttStage').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 160, box.y, { steps: 8 });
  await page.mouse.up();
  await sleep(120);
  const after2 = await page.evaluate(() => {
    const cv = document.getElementById('ttCanvas');
    const m = /translate3d\((-?[\d.]+)px/.exec(cv.style.transform);
    return { tr: cv.style.transform, x: m ? +m[1] : null };
  });
  ck('横向拖拽能平移树', after2.tr !== before2 && after2.x < 0,
    before2 + ' → ' + after2.tr);

  /* 滚轮也平移（不缩放）。树现在有 7 行、比窄屏舞台高，所以滚轮走竖向：
   * 往上滚一格，panY 应该往下走。 */
  const w0 = await page.evaluate(() => document.getElementById('ttCanvas').style.transform);
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaY: 200 });
  await sleep(120);
  const w1 = await page.evaluate(() => document.getElementById('ttCanvas').style.transform);
  ck('滚轮平移（不缩放）', w1 !== w0, w0 + ' → ' + w1);

  /* 拖拽后松手不能误入队（对比拖拽前后的队列与当前研究，别管"是不是刚好空闲"） */
  const noAccident = await page.evaluate((o) => {
    const R = window.AO.resResearch[o];
    return { cur: R.cur ? R.cur.key : null, q: (R.queue || []).slice(), done: Object.keys(R.done) };
  }, C.owner);
  ck('拖拽不会误开研究 / 误入队',
    JSON.stringify(noAccident.q) === JSON.stringify(beforeDrag.q) &&
    noAccident.cur === beforeDrag.cur,
    '当前研究 ' + noAccident.cur + '，队列 [' + noAccident.q.join(',') + ']');
  await page.screenshot({ path: shot('tt-e-narrow.png') });

  /* ---- 关闭：× 与 ESC ---- */
  await page.evaluate(() => document.getElementById('ttClose').click());
  await sleep(100);
  const closedByX = await page.evaluate(() => !document.getElementById('techTree').classList.contains('on'));
  await page.evaluate(() => document.querySelector('#cTech .topen').click());
  await sleep(150);
  await page.keyboard.press('Escape');
  await sleep(120);
  const closedByEsc = await page.evaluate(() => ({
    tt: !document.getElementById('techTree').classList.contains('on'),
    country: document.getElementById('country').classList.contains('on')
  }));
  ck('× 能关；ESC 也能关（且只关树，不顺手关国家卡）',
    closedByX && closedByEsc.tt && closedByEsc.country,
    '×=' + closedByX + '，ESC 后 树关=' + closedByEsc.tt + ' 国家卡仍在=' + closedByEsc.country);

  /* ---- 沙盒：换个国家，顶栏数据跟着切 ---- */
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  await sleep(150);
  await page.evaluate(() => document.querySelector('#cTech .topen').click());
  await sleep(200);
  const sw1 = await page.evaluate(() => ({
    name: document.getElementById('ttName').textContent,
    owner: document.getElementById('ttOwner').textContent
  }));
  await page.evaluate(() => document.getElementById('ttNext').click());
  await sleep(200);
  const sw2 = await page.evaluate(() => ({
    name: document.getElementById('ttName').textContent,
    owner: document.getElementById('ttOwner').textContent,
    locked: [...document.querySelectorAll('#ttNodes .ttnode.lock')].length
  }));
  ck('沙盒：翻到下一个国家，顶栏与树跟着切',
    sw1.name !== sw2.name && /第 \d+ \//.test(sw2.owner) && sw2.locked > 0,
    sw1.name + ' → ' + sw2.name + '（' + sw2.owner + '，锁定 ' + sw2.locked + ' 个）');
  await page.screenshot({ path: shot('tt-f-other.png') });

  /* 地图滚轮恢复 */
  const wheel2 = await page.evaluate(() => {
    document.getElementById('ttClose').click();
    const R = window.__renderer;
    const before = R.cam.scale;
    document.getElementById('map').dispatchEvent(new WheelEvent('wheel', {
      deltaY: -420, clientX: 700, clientY: 500, bubbles: true, cancelable: true
    }));
    return { before, after: R.cam.scale };
  });
  ck('关掉树之后地图滚轮恢复缩放', wheel2.before !== wheel2.after,
    'scale ' + wheel2.before + ' → ' + wheel2.after);

  let pass = true;
  for (const [name, ok, note] of checks) {
    if (!ok) pass = false;
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + note);
  }
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
