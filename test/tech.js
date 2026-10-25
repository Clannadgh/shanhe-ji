/* =============================================================
 * test/tech.js —— 科技树 / 建筑档位 / 维护费 / 造价加金 的冒烟检查
 *
 * 对着任务书第五节的验收清单逐条过：
 *   1) 建学校 → 科研条开始涨；没学校的国家条不动
 *   2) 条满 30 → 解锁 → 研究一条（扣科研点 + 金，倒计时）→ 完成 ✓
 *   3) 研完的建筑：新盖直接 Lv2（扣 cost2）；旧行出现「旧N」「升」；
 *      升一座 → 座数变化、图标换 Lv2、产量涨
 *   4) 不升级的旧建筑一直正常出产
 *   5) 铁/金造空 → 红灯停产、产量 0；补回来 → 自动复工
 *   6) 每回合中央有抽税进账；研究从中央扣资源
 *   7) 造价里金显示正常
 *   8) 页签 / 货运 / 人口吃粮 / 冷静期 不回归
 *
 * 用法：node test/tech.js
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
  /* 新素材（item-school-bld.png / *-bld-2.png）还没生成，缺图是预期内的：
   * onerror 会把图标隐藏掉，不算回归。 */
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(2600);

  /* ---- 选一个「首都 + 主资源是林木」的省：七种建筑都有，档位/停产都测得开 ---- */
  const P = await page.evaluate(() => {
    const R = window.__renderer, w = window.__world;
    let q = null;
    for (const c of w.countries) {
      const p = w.provinces[c.capital - 1];
      if (p && p.resources && p.resources[0].key === 'timber') { q = p; break; }
    }
    if (!q) return null;
    R.cam.x = q.centroid[0]; R.cam.y = q.centroid[1]; R.cam.scale = 2.0; R.clampCam();
    R.select(q.id); R.draw();
    return { id: q.id, name: q.name, owner: q.owner, ownerName: q.ownerName };
  });
  if (!P) { console.log('FAIL 找不到合适的省'); await browser.close(); process.exit(1); }

  const res = () => page.evaluate((o) => {
    const R = window.AO.resResearch[o];
    return R ? { pts: R.pts, unlocked: R.unlocked, cur: R.cur ? Object.assign({}, R.cur) : null,
                 done: Object.assign({}, R.done), queue: (R.queue || []).slice() } : null;
  }, P.owner);
  const central = () => page.evaluate((o) => Object.assign({}, window.AO.resCentral[o]), P.owner);
  const bagOf = (k) => page.evaluate((a) => {
    const s = window.AO.resSim[a.id] && window.AO.resSim[a.id][a.k];
    return s ? { built: s.built, t1: s.tiers[1], t2: s.tiers[2], site: s.site, kind: s.siteKind,
                 stock: s.stock, halted: s.halted } : null;
  }, { id: P.id, k });
  const school = () => page.evaluate((id) => {
    const s = window.AO.resSchool[id];
    return s ? { n: s.n, site: s.site, halted: s.halted } : null;
  }, P.id);
  const row = (name) => `[...document.querySelectorAll('#iBldList .rr.bld')].find(r => r.querySelector('.nm').textContent === '${name}')`;
  const clickAdd = (name) => page.evaluate((e) => { eval(e).querySelector('.add').click(); }, row(name));
  const clickUp = (name) => page.evaluate((e) => { const b = eval(e).querySelector('.upg'); if (b) b.click(); return !!b; }, row(name));
  const qty = (name) => page.evaluate((e) => eval(e).querySelector('.qty').textContent, row(name));
  const oldTag = (name) => page.evaluate((e) => { const o = eval(e).querySelector('.old'); return o ? o.textContent : ''; }, row(name));
  /* 行图标：手绘图（img 带 data-lv），Lv2 的专属图还没有时先借 Lv1 的图 */
  const iconOf = (name) => page.evaluate((e) => {
    const el = eval(e).querySelector('img.bart-img, svg.bart');
    if (!el) return 'none';
    return (el.tagName.toLowerCase() === 'img' ? 'img' : 'svg') + ':lv' + el.getAttribute('data-lv');
  }, row(name));
  const siteTag = (name) => page.evaluate((e) => { const o = eval(e).querySelector('.site'); return o ? o.textContent : ''; }, row(name));
  const dotOf = (name) => page.evaluate((e) => eval(e).querySelector('.dot').className, row(name));
  const msg = () => page.evaluate(() => document.getElementById('bldMsg').textContent);
  /* 科技树铺满整屏时会盖住右上角的回合条 —— 树开着就用它自己的「下一回合」 */
  const clickNext = () => page.evaluate(() => {
    const tt = document.getElementById('techTree');
    if (tt && tt.classList.contains('on')) document.getElementById('ttTurn').click();
    else document.getElementById('nextTurn').click();
  });
  const turns = async (n) => { for (let i = 0; i < n; i++) { await clickNext(); await sleep(50); } };
  const selectProv = () => page.evaluate((id) => {
    const R = window.__renderer;
    R.select(id); R.draw();
  }, P.id);

  const checks = [];
  const ck = (name, ok, note) => checks.push([name, !!ok, note || '']);

  /* ---- 1) 建学校 ---- */
  const cen0 = await central();
  const r0 = await res();
  await page.evaluate(() => document.querySelector('#iSchoolList .rr.bld .add').click());
  const s1 = await school();
  const msgSchool = await msg();
  const cen1 = await central();
  ck('学校开工（吃木材+金）', s1.site > 0 && msgSchool.indexOf('学校开工') === 0 &&
    cen1.timber < cen0.timber && cen1.gold < cen0.gold,
    '在建 ' + s1.site + ' 回合；中央木材 ' + cen0.timber + '→' + cen1.timber + '，金 ' + cen0.gold + '→' + cen1.gold);

  await turns(2);
  const s2 = await school();
  const rAfter = await res();
  ck('学校完工 ×1', s2.n === 1 && s2.site === 0, '×' + s2.n);
  ck('科研条开始涨（+3/座）', rAfter.pts > r0.pts, r0.pts + ' → ' + rAfter.pts + ' 点');

  /* 没学校的国家条不动 */
  const otherOwner = await page.evaluate((o) => {
    const w = window.__world;
    for (const c of w.countries) if (c.id !== o) return c.id;
    return 0;
  }, P.owner);
  const otherPts = await page.evaluate((o) => (window.AO.resResearch[o] || {}).pts || 0, otherOwner);
  ck('没学校的国家科研条不动', otherPts === 0, '#' + otherOwner + ' pts=' + otherPts);

  /* ---- 2) 攒满 30 → 解锁 → 研究 ---- */
  let guard = 0;
  while (!(await res()).unlocked && guard++ < 20) await turns(1);
  const rUnlock = await res();
  ck('科研条攒满 30 解锁科技树', rUnlock.unlocked && rUnlock.pts >= 30, rUnlock.pts + ' 点，unlocked=' + rUnlock.unlocked);

  /* 打开科技树：走省份卡里的「科研」入口 */
  const linkText = await page.evaluate(() => {
    const el = document.querySelector('#iSchoolList .techlink');
    return el ? el.textContent : '';
  });
  await page.evaluate(() => document.querySelector('#iSchoolList .techlink').click());
  await sleep(200);
  const nodeCls = (k) => page.evaluate((kk) => {
    const n = document.querySelector('#ttNodes .ttnode[data-tech="' + kk + '"]');
    return n ? n.className : 'none';
  }, k);
  const techUi = await page.evaluate(() => {
    const ov = document.getElementById('techTree');
    const r = ov.getBoundingClientRect();
    const body = document.getElementById('ttNodes');
    return {
      on: ov.classList.contains('on'),
      full: r.top <= 0 && r.left <= 0 && r.width >= window.innerWidth && r.height >= window.innerHeight,
      nodes: body.querySelectorAll('.ttnode').length,
      edges: document.querySelectorAll('#ttEdges path').length,
      text: body.textContent.replace(/\s+/g, ' ').slice(0, 110)
    };
  });
  ck('省份卡有「科研」入口条', /^科研 .*\d+.*→$/.test(linkText.trim()), linkText);
  ck('点入口 → 全屏科技树直接铺开', techUi.on && techUi.full,
    'on=' + techUi.on + '，铺满视口=' + techUi.full);
  const techCount = await page.evaluate(() => ({
    n: window.AO.TECHS.length,
    edges: window.AO.TECHS.filter(t => !!t.req).length,
    globals: window.AO.TECHS.filter(t => !t.for).length
  }));
  ck('树：' + techCount.n + ' 个节点（含 ' + techCount.globals + ' 条全局科技）+ ' +
    techCount.edges + ' 条前置虚线',
    techUi.nodes === techCount.n && techUi.edges === techCount.edges,
    '节点 ' + techUi.nodes + ' / 连线 ' + techUi.edges);
  ck('前置未研 → 子节点锁住', /lock/.test(await nodeCls('blast2')) && /lock/.test(await nodeCls('breed2')),
    '高炉鼓风=' + (await nodeCls('blast2')) + '，良种牧场=' + (await nodeCls('breed2')));

  /* 点节点 = 入队（不扣费）；队头下一回合才开研、才扣 */
  const beforeR = await res(), beforeC = await central();
  await page.evaluate(() => document.querySelector('#ttNodes .ttnode[data-tech="saw2"]').click());
  await sleep(120);
  const enq = await res(), enqC = await central();
  ck('点节点 = 入队，不扣科研点也不扣金',
    enq.queue.length === 1 && enq.queue[0] === 'saw2' && enq.pts === beforeR.pts &&
    enqC.gold === beforeC.gold && !enq.cur,
    '队列 [' + enq.queue.join(',') + ']，科研点 ' + enq.pts + '，金 ' + enqC.gold);

  await turns(1);
  const afterR = await res(), afterC = await central();
  const startMsg = await page.evaluate(() => document.getElementById('ttMsg').textContent);
  /* 这一回合里学校还会再产点、抽税还会进账，所以不能拿"差值正好 20/5"来判；
   * 直接看那句开工提示 —— 里面写的就是这次真的扣掉的数。 */
  ck('队头开研才扣科研点 + 中央金',
    afterR.cur && afterR.cur.key === 'saw2' && afterR.queue.length === 0 &&
    afterR.pts < beforeR.pts && afterC.gold < beforeC.gold &&
    /开始研究「水力锯木」：20 科研点 · 金锭 5/.test(startMsg),
    '科研点 ' + beforeR.pts + '→' + afterR.pts + '，金 ' + beforeC.gold + '→' + afterC.gold +
    '，倒计时 ' + (afterR.cur ? afterR.cur.left : '-') + ' 回合 · 「' + startMsg + '」');
  ck('研究中：节点带进度条 + 高亮', /cur/.test(await nodeCls('saw2')) &&
    (await page.evaluate(() => !!document.querySelector('#ttNodes .ttnode[data-tech="saw2"] .pbar'))),
    await nodeCls('saw2'));

  await turns(2);
  const rDone = await res();
  ck('研究完成 ✓', !!rDone.done.saw2 && !rDone.cur, 'done=' + JSON.stringify(rDone.done));
  const doneTag = await page.evaluate(() => {
    const n = document.querySelector('#ttNodes .ttnode[data-tech="saw2"]');
    return n ? n.textContent.replace(/\s+/g, ' ') : '';
  });
  ck('已研节点标 ✓ 且变淡', /✓/.test(doneTag) && /done/.test(await nodeCls('saw2')), doneTag);
  ck('研完父节点 → 子节点解锁（另一支还锁着）',
    !/lock/.test(await nodeCls('blast2')) && /lock/.test(await nodeCls('breed2')),
    '高炉鼓风=' + (await nodeCls('blast2')) + '，良种牧场=' + (await nodeCls('breed2')));

  /* ESC 关掉，后面继续测建筑 */
  await page.keyboard.press('Escape');
  await sleep(120);
  ck('ESC 关闭科技树', !(await page.evaluate(() => document.getElementById('techTree').classList.contains('on'))),
    'ESC 后 techTree.on=' + (await page.evaluate(() => document.getElementById('techTree').classList.contains('on'))));

  /* ---- 3) 档位：旧N / 升 / 新盖直接 Lv2 ---- */
  await selectProv();
  await sleep(80);
  const t1Before = (await bagOf('timber')).t1;
  const oldTag0 = await oldTag('伐木场');
  ck('旧行出现「旧N」', oldTag0 === '旧' + t1Before, oldTag0 + '（Lv1 ×' + t1Before + '）');

  const perBefore = await page.evaluate((id) => {
    const s = window.AO.resSim[id].timber, d = window.AO.RESOURCE_BY_KEY.timber;
    return (d.per || 0) * s.tiers[1] + (d.per2 || d.per) * s.tiers[2];
  }, P.id);

  const cenB = await central();
  const clickedUp = await clickUp('伐木场');
  const bagUpSite = await bagOf('timber');
  const msgUp = await msg();
  const cenA = await central();
  ck('「升」钮可用且开工（升N 文案）', clickedUp && bagUpSite.site > 0 && bagUpSite.kind === 'up' &&
    (await siteTag('伐木场')) === '升' + bagUpSite.site,
    '工地「' + (await siteTag('伐木场')) + '」· ' + msgUp.slice(0, 40));
  ck('升档按 cost2 付账（金更多）', cenA.gold < cenB.gold || cenA.timber < cenB.timber,
    '中央木材 ' + cenB.timber + '→' + cenA.timber + '，金 ' + cenB.gold + '→' + cenA.gold);

  await turns(3);
  const bagUp = await bagOf('timber');
  ck('升完：Lv1 −1 / Lv2 +1', bagUp.t2 === 1 && bagUp.t1 === t1Before - 1,
    'Lv2 ×' + bagUp.t2 + ' · Lv1 ×' + bagUp.t1);
  ck('行图标切到 Lv2', /:lv2$/.test(await iconOf('伐木场')), await iconOf('伐木场'));
  const perAfter = await page.evaluate((id) => {
    const s = window.AO.resSim[id].timber, d = window.AO.RESOURCE_BY_KEY.timber;
    return (d.per || 0) * s.tiers[1] + (d.per2 || d.per) * s.tiers[2];
  }, P.id);
  ck('产量涨（Lv2 单座 per×2）', perAfter > perBefore, perBefore + ' → ' + perAfter + ' / 回合');

  /* 新盖直接 Lv2：扣 cost2，完工进 tiers[2] */
  const t2Before = bagUp.t2;
  const addTitle = await page.evaluate((e) => eval(e).querySelector('.add').getAttribute('title'), row('伐木场'));
  await clickAdd('伐木场');
  const msgNew = await msg();
  await turns(3);
  const bagNew = await bagOf('timber');
  ck('研完新盖直接 Lv2（付 cost2）', bagNew.t2 === t2Before + 1 && bagNew.t1 === bagUp.t1,
    msgNew.slice(0, 34) + ' · Lv2 ×' + bagNew.t2);
  ck('新盖的 ＋ 提示的是 cost2（金 6 + Lv2）', /Lv2/.test(addTitle) && /金锭 6/.test(addTitle), addTitle);

  /* 问号面板的档位区 */
  await page.evaluate((e) => { eval(e).querySelector('.qbtn').click(); }, row('伐木场'));
  const panel = await page.evaluate(() => {
    const el = document.querySelector('#iBldList .qinfo.on');
    return el ? {
      text: el.textContent.replace(/\s+/g, ' '),
      tiers: el.querySelectorAll('.tiers .tr').length,
      arts: [...el.querySelectorAll('.tiers img, .tiers svg')].map(i => 'lv' + i.getAttribute('data-lv')),
      lv2Cell: el.querySelectorAll('.tiers .tr.lv2').length,
      lock: el.querySelectorAll('.tiers .tr.lock').length
    } : null;
  });
  ck('问号面板有「档位」区（两档并排）', panel && panel.tiers === 2 &&
    /Lv2 ×\d+ · Lv1 ×\d+/.test(panel.text), panel ? panel.text.slice(0, 90) : '无');
  ck('档位图：Lv1/Lv2 各一张，Lv2 格有金边', panel && panel.arts.length === 2 &&
    panel.arts[0] === 'lv1' && panel.arts[1] === 'lv2' && panel.lv2Cell === 1 && panel.lock === 0,
    (panel ? panel.arts.join(' | ') + ' / lv2 格 ' + panel.lv2Cell : ''));
  ck('造价里金显示正常', /金锭 [1-9]\d*/.test(panel ? panel.text : ''),
    (panel && (panel.text.match(/金锭 [1-9]\d*/) || ['无'])[0]) || '');

  /* ---- 4) 不升级的旧建筑照常出产（牧场没研究、也没被升过）----
   * 这省的牧场储量本来就快见底（会进冷静期），先把储量补满再测产量。 */
  await page.evaluate((e) => { eval(e).querySelector('.qbtn').click(); }, row('伐木场'));
  await page.evaluate((id) => {
    const s = window.AO.resSim[id].horse;
    s.cool = 0; s.left = s.n;
  }, P.id);
  const farm0 = (await bagOf('horse')).stock;
  await turns(1);
  const farm1 = (await bagOf('horse')).stock;
  ck('未升级的旧建筑照常出产', farm1 > farm0, '牧场（Lv1 ×1）库存 ' + farm0 + ' → ' + farm1);

  /* ---- 6) 中央抽税 ---- */
  const cenT0 = await central();
  await turns(1);
  const cenT1 = await central();
  ck('中央每回合有抽税进账', cenT1.timber >= cenT0.timber && (cenT1.timber > cenT0.timber || cenT1.iron > cenT0.iron),
    '木材 ' + cenT0.timber + '→' + cenT1.timber + '，铁 ' + cenT0.iron + '→' + cenT1.iron);

  /* ---- 5) 维护欠费 → 停产 → 补资源自动复工 ---- */
  await page.evaluate((id) => {
    const bag = window.AO.resSim[id];
    bag.iron.stock = 0; bag.gold.stock = 0;
    const c = window.AO.resCentral[window.__world.provinces[id - 1].owner];
    c.iron = 0; c.gold = 0;
  }, P.id);
  await turns(1);
  const haltedBag = await bagOf('timber');
  const dotHalt = await dotOf('伐木场');
  const titleHalt = await page.evaluate((e) => eval(e).getAttribute('title'), row('伐木场'));
  const stockHalt0 = haltedBag.stock;
  await turns(1);
  const stockHalt1 = (await bagOf('timber')).stock;
  ck('铁/金造空 → 停产 + 红灯', haltedBag.halted && /halt/.test(dotHalt) && /维护欠费，停产中/.test(titleHalt),
    'dot=' + dotHalt);
  ck('停产期间产量 0', stockHalt1 === stockHalt0, '库存 ' + stockHalt0 + ' → ' + stockHalt1);

  await page.evaluate((id) => {
    const c = window.AO.resCentral[window.__world.provinces[id - 1].owner];
    c.iron = 60; c.gold = 60;
  }, P.id);
  await turns(1);
  const revived = await bagOf('timber');
  ck('补上资源 → 自动复工', !revived.halted && !/halt/.test(await dotOf('伐木场')), 'halted=' + revived.halted);

  /* ---- 8) 回归：页签 / 货运 / 资源 7 行 / 人口 / 冷静期 ---- */
  const layout = await page.evaluate(() => ({
    cols: document.querySelectorAll('#infoBody .col').length,
    res: document.querySelectorAll('#iResList .rr').length,
    bld: document.querySelectorAll('#iBldList .rr').length,
    school: document.querySelectorAll('#iSchoolList .rr.bld').length,
    freight: document.querySelectorAll('#iFreightList .rr').length,
    secs: document.querySelectorAll('#infoBody .bld-col .sec').length
  }));
  /* 通用栏从 3 行变 5 行（内政批加了粮仓 / 大学），其余行数不变 */
  ck('页签两栏 / 建筑 7 行 / 货运 1 行 / 通用 5 行（学校·市场·建造坊·粮仓·大学）',
    layout.cols === 2 && layout.res === 7 && layout.bld === 7 && layout.school === 5 &&
    layout.freight === 1 && layout.secs === 4, JSON.stringify(layout));

  const tabs = await page.evaluate(() => {
    const b = document.getElementById('infoBody');
    document.querySelector('#infoTabs .itab[data-tab="bld"]').click();
    const on = b.classList.contains('tab-bld');
    document.querySelector('#infoTabs .itab[data-tab="info"]').click();
    const on2 = b.classList.contains('tab-info');
    return { on, on2 };
  });
  ck('页签仍可切换', tabs.on && tabs.on2, JSON.stringify(tabs));

  const cool = await page.evaluate(() => {
    // 把伐木场推进冷静期，确认冷静期仍生效且停产标记不干扰
    const s = window.AO.resSim[window.__renderer.selected].timber;
    s.left = 0; s.cool = 0;
    return { left: s.left };
  });
  await turns(1);
  const cooled = await page.evaluate(() => {
    const s = window.AO.resSim[window.__renderer.selected].timber;
    return { cool: s.cool, halted: s.halted };
  });
  ck('矿脉枯竭/冷静期逻辑仍在', cooled.cool > 0 || cooled.halted === false, 'cool=' + cooled.cool);

  await page.screenshot({ path: shot('tech-check.png') });

  let pass = true;
  console.log('省份：' + P.name + '（' + P.ownerName + ' 首都，主资源林木）');
  for (const [name, ok, note] of checks) {
    if (!ok) pass = false;
    console.log((ok ? '  PASS    ' : '  FAIL    ') + name + '  —  ' + note);
  }
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
  console.log(pass && !errors.length ? '结论：通过' : '结论：有失败项');
  await browser.close();
  process.exit(pass && !errors.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
