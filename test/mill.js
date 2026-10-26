/* =============================================================
 * test/mill.js —— 军工产线（v19 口径的"遗留项"）
 *
 * 旧断言跟着改了（v19 制造工艺批 + 终版返工）：
 *   v17 的"三坊 / 每省分配 / 接单 / 一炉 2 件 / 铸炮厂"整套没了 ——
 *   产能改成**全国三池**、产线改成**20 条**（兵刃五类型）、炮线并进军械坊；
 *   兵器不再是"代"而是**材质**（品质倍率 1.0/1.2/1.5/2.0）。
 *   订单制 / 武库 / 三维 / 换代回收的验收搬到 **test/craft.js**；
 *   这个文件只留 v17 里**仍然成立**的那几块：
 *   ① 定义区（池 / 19 线 / 工作量 / 词条表 / 品质倍率 / 工匠四等 / 铸炮厂已删）
 *   ② 产能：本省贡献 + 全国合计 + 工厂 ×2 + 匠人加成 + 停产
 *   ③ 工科：抽匠人 / 派驻 / 加成 / 品质 roll
 *   ④ 装备：下产线 → EQUIPS → 配发 → 战力乘数；卸下回库
 *   ⑤ 旧档迁移：pid 级 MILL 按线合计 / foundry 折军械坊 / prog 随线走
 *
 * 跑法：node test/mill.js
 * 小世界（140 省 / 8 国），约半分钟。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
function add(list) {
  for (const c of list) {
    out.push(c);
    console.log((c.ok ? '  PASS    ' : '  FAIL    ') + c.name + '  —  ' + (c.detail || ''));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  /* file:// 的 localStorage 是**跨测试共享**的：上一个测试存过档，这一局一进来
   * 就会被自动读档，种子/玩家国全变。所以先清干净再重进一次。 */
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.reload({ waitUntil: 'load' });
  await sleep(1400);
  await page.evaluate(() => {
    document.getElementById('prov').value = 140;
    document.getElementById('ctry').value = 8;
    document.getElementById('seed').value = 'mill-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2400);

  /* ---------------- ① 定义区 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, M = AO.MILL, E = AO.EQUIP, A = AO.ARTISAN, G = AO.GEAR, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });

    ok('① 三个产能池：军械 / 马厩 / 船坞',
      M.poolBld.arm === 'armory' && M.poolBld.hor === 'stable' && M.poolBld.syd === 'shipyard',
      JSON.stringify(M.poolBld));
    ok('① 每座基准 军械 2 / 马厩 1 / 船坞 1',
      M.base.armory === 2 && M.base.stable === 1 && M.base.shipyard === 1, JSON.stringify(M.base));
    const all = M.lines.arm.concat(M.lines.hor, M.lines.syd);
    ok('① 20 条线（12 + 4 + 4）', all.length === 20 &&
      M.lines.arm.length === 12 && M.lines.hor.length === 4 && M.lines.syd.length === 4, all.length + ' 条');
    ok('① 兵刃五类型 + 装备三线 + 炮四线',
      M.lines.arm.join(',') === 'dao,jian,qiang,fu,gong,helm,chest,boots,catapult,bronze_gun,field_gun,heavy_gun',
      M.lines.arm.join(','));
    ok('① 工作量：兵刃/装备/马 5 · 炮 2 · 舰 1/2/3/4',
      M.work.dao === 5 && M.work.helm === 5 && M.work.nag === 5 && M.work.heavy_gun === 2 &&
      M.work.galley === 1 && M.work.ironclad === 4,
      [M.work.dao, M.work.helm, M.work.nag, M.work.heavy_gun, M.work.ironclad].join('/'));
    ok('① 单量：队份 1000 / 炮 1 / 舰 1',
      M.batch.blade === 1000 && M.batch.equip === 1000 && M.batch.mount === 1000 &&
      M.batch.gun === 1 && M.batch.ship === 1, JSON.stringify(M.batch));
    ok('① 料：兵刃 recipe×2 / 装备 铁4 / 马 粮2',
      M.bladeMul === 2 && M.equipRecipe.iron === 4 && M.mountRecipe.grain === 2,
      JSON.stringify([M.bladeMul, M.equipRecipe, M.mountRecipe]));
    ok('① 品质四档倍率 1.0/1.2/1.5/2.0（任务书第二节·3）',
      G.qMul.plain === 1 && G.qMul.good === 1.2 && G.qMul.fine === 1.5 && G.qMul.rare === 2.0,
      JSON.stringify(G.qMul));
    ok('① 词条：类型 5 / 形制 4 / 品种 4，且都**没有解锁条件**',
      G.types.length === 5 && G.forms.length === 4 && G.breeds.length === 4 &&
      !G.forms.some(f => f.need) && !G.breeds.some(b => b.need) && !G.types.some(t => t.need),
      G.types.map(t => t.cn).join('/'));
    ok('① 形制数值：重装 def+30 mov−1 / 疾行 mov+1 atk−10 / 锋锐 atk+25 def−15',
      G.forms[1].def === 30 && G.forms[1].mov === -1 &&
      G.forms[2].mov === 1 && G.forms[2].atk === -10 &&
      G.forms[3].atk === 25 && G.forms[3].def === -15);
    ok('① 材质底 皮3/青铜5/铁8/火器12',
      E.mat[0].base === 0.03 && E.mat[1].base === 0.05 && E.mat[2].base === 0.08 && E.mat[3].base === 0.12,
      E.mat.map(m => m.cn + Math.round(m.base * 100) + '%').join(' '));
    ok('① 工科四等权重 50/30/15/5',
      A.lv[0].w === 50 && A.lv[1].w === 30 && A.lv[2].w === 15 && A.lv[3].w === 5,
      A.lv.map(l => l.cn + l.w).join(' '));
    ok('① 匠人产能加成 +0/10/20/40%',
      A.lv[0].bonus === 0 && A.lv[1].bonus === 0.1 && A.lv[2].bonus === 0.2 && A.lv[3].bonus === 0.4);
    ok('① 铸炮厂整条删掉（定义 / 教育档）',
      !AO.FACTORY.foundry && !AO.TIER.some(t => t.at === 35),
      Object.keys(AO.FACTORY).join(','));
    ok('① 「量产工艺」改成工作量 5→4',
      M.massWork === 4 && /工作量/.test(AO.TECH_BY_KEY.mil_massline.desc),
      AO.TECH_BY_KEY.mil_massline.desc.slice(0, 30));
    return o;
  }));

  /* ---------------- ② 产能：本省贡献 + 全国合计 + 工厂/匠人 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const w = D.world();
    let pid = 0, owner = 0;
    for (const p of w.provinces) {
      const bag = AO.resSim[p.id];
      if (!bag || !bag.iron || !bag.iron.built) continue;
      pid = p.id; owner = p.owner; break;
    }
    ok('② 找到一个有铁矿的省', !!pid, 'pid=' + pid);
    D.choosePlayer(owner);
    const p = w.provinces[pid - 1];
    D.buildFactory(p, 'armory');
    const ar = AO.resMil.armory[pid];
    ar.site = 0; ar.n = 2;
    const c2 = D.millCap(pid, 'armory');
    ok('② 2 座军械坊 = 4 点（本省贡献）', c2 === 4, c2);
    const poolA = D.poolCap(owner, 'arm');
    ok('② 全国军械池 ≥ 本省贡献', poolA >= c2, 'pool=' + poolA);

    /* 工厂 ×2 */
    const fb = AO.resMil.factory[pid] || (AO.resMil.factory[pid] = { n: 0, site: 0, halted: false });
    fb.n = 1; fb.halted = false;
    const c3 = D.millCap(pid, 'armory');
    ok('② 工厂 ×2：4 → 8 点', c3 === 8, c2 + '→' + c3);

    /* 匠人 +40% */
    const art = { id: 99001, name: '测试匠', lv: 3, pid: pid };
    D.artisansOf(owner).post[pid] = art;
    const c4 = D.millCap(pid, 'armory');
    ok('② 宗师驻场 +40%：8 → 11 点', c4 === Math.floor(8 * 1.4), c3 + '→' + c4);
    delete D.artisansOf(owner).post[pid];

    /* 停产：产能归零 */
    ar.halted = true;
    ok('② 停产 → 本省产能 0', D.millCap(pid, 'armory') === 0);
    ar.halted = false;
    ok('② 复工 → 产能回来', D.millCap(pid, 'armory') === c3);
    return o;
  }));

  /* ---------------- ③ 工科 / 品质 roll ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    const T = D.talentOf(owner);
    T.pts = 40;
    const r = D.examArtisan(owner, true);
    ok('③ 开工科扣人才点、得一位匠人', r.ok && T.pts === 40 - AO.GOV.examCost, T.pts);
    ok('③ 匠人四等之一', !!r.lv && AO.ARTISAN.lv.indexOf(r.lv) >= 0, r.lv && r.lv.cn);

    const w = D.world();
    let pid = 0;
    for (const p of w.provinces) {
      if (p.owner !== owner) continue;
      const st = AO.resMil.armory[p.id];
      if (st && st.n > 0) { pid = p.id; break; }
    }
    ok('③ 找得到一座已建成的军械坊', !!pid, 'pid=' + pid);
    const post = D.postArtisan(pid, r.artisan.id, true);
    ok('③ 派驻成功', post.ok, post.msg);
    ok('③ 驻场加成生效', D.artisanBonus(pid) === AO.ARTISAN.lv[r.artisan.lv].bonus,
      Math.round(D.artisanBonus(pid) * 100) + '%');
    ok('③ 全国最高匠人 = 这位', D.bestArtisanLv(owner) === r.artisan.lv, D.bestArtisanLv(owner));

    const seen = {};
    for (let i = 0; i < 200; i++) seen[D.rollQuality(owner)] = 1;
    ok('③ 品质 roll 落在凡/良/上/珍里',
      Object.keys(seen).every(k => AO.GEAR.q.indexOf(k) >= 0), Object.keys(seen).join(','));

    D.unpostArtisan(pid, true);
    ok('③ 撤下 → 加成归零', D.artisanBonus(pid) === 0);
    return o;
  }));

  /* ---------------- ④ 装备：下产线 → 配发 → 战力 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    const w = D.world();
    let pid = 0;
    for (const p of w.provinces) {
      if (p.owner !== owner) continue;
      const st = AO.resMil.armory[p.id];
      if (st && st.n > 0) { pid = p.id; break; }
    }
    const bag = AO.resSim[pid];
    bag.iron.stock += 40;

    D.setLineAlloc(owner, 'helm', Math.min(5, D.poolCap(owner, 'arm')), true);
    const e0 = D.equipTotal(owner);
    D.nextTurn();
    const e1 = D.equipTotal(owner);
    ok('④ 装备线出一单（1 队份 = 1000 件）', e1 > e0, e0 + '→' + e1);
    ok('④ 一单的料 = 铁 4', D.orderCost(owner, 'helm').iron === 4, JSON.stringify(D.orderCost(owner, 'helm')));

    const a = D.newArmy(owner, pid, { type: 'army', men: 1000 });
    const inv = D.equipOf(owner);
    let q = 'plain';
    for (const k of AO.EQUIP.q) if (inv.helm[k] > 0) q = k;
    const mul0 = D.equipMulOf(a);
    const r = D.equipArmy(a, 'helm', q, true);
    ok('④ 配发一件盔', r.ok && a.equip.helm === q, r.msg || q);
    ok('④ 战力乘数上升（1 + 材质底×品质倍）', D.equipMulOf(a) > mul0,
      mul0.toFixed(3) + '→' + D.equipMulOf(a).toFixed(3));

    const before = inv.helm[q] || 0;
    D.equipArmy(a, 'helm', null, true);
    ok('④ 卸下回库', (D.equipOf(owner).helm[q] || 0) === before + 1 && !a.equip.helm);
    return o;
  }));

  /* ---------------- ⑤ 旧档迁移 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    const w = D.world();
    let pid = 0;
    for (const p of w.provinces) {
      if (p.owner !== owner) continue;
      const st = AO.resMil.armory[p.id];
      if (st && st.n > 0) { pid = p.id; break; }
    }
    /* 造一份 v17 形状的旧档片段：pid 级 MILL + foundry + st.order */
    const oldMill = {};
    oldMill[pid] = {
      arm: { wpn: 2, helm: 1, chest: 0, boots: 0 },
      fnd: { catapult: 1, bronze_gun: 0, field_gun: 0, heavy_gun: 0 },
      syd: { galley: 0, galleon: 0, ship74: 0, ironclad: 0 },
      prog: { 'arm.wpn': 1 }, acc: { arm: 0.4, fnd: 0, syd: 0 }, pick: { wpn: 'bronze' }
    };
    const oldFoundry = {};
    oldFoundry[pid] = { n: 2, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
    const arm0 = AO.resMil.armory[pid].n | 0;
    for (const k in D.mills) delete D.mills[k];
    D.millMigrateOld({ MILL: oldMill, FOUNDRY: oldFoundry });
    const m = D.millOf(owner);
    ok('⑤ foundry.n 折进军械坊 1:1', (AO.resMil.armory[pid].n | 0) === arm0 + 2,
      arm0 + ' → ' + AO.resMil.armory[pid].n);
    ok('⑤ 旧 pid 级分配按线合计进 owner 表（dao = 旧 wpn 点数）',
      m.alloc.dao === 2, 'dao=' + m.alloc.dao + ' · helm=' + m.alloc.helm);
    ok('⑤ prog 随线走', m.prog.dao === 1, m.prog.dao);
    ok('⑤ 旧铸炮线折成对应炮线（catapult 1 点）', m.alloc.catapult === 1, m.alloc.catapult);
    ok('⑤ 封顶到当时的池容量', D.allocSum(owner, 'arm') <= D.poolCap(owner, 'arm'),
      D.allocSum(owner, 'arm') + ' / ' + D.poolCap(owner, 'arm'));
    return o;
  }));

  if (errors.length) {
    out.push({ name: '页面无 JS 错误', ok: false, detail: errors.slice(0, 3).join(' | ') });
  } else {
    out.push({ name: '页面无 JS 错误', ok: true, detail: '' });
  }
  let bad = 0;
  for (const c of out) if (!c.ok) bad++;
  console.log('');
  console.log(bad ? `❌ ${bad} 项失败 / 共 ${out.length} 项` : `✅ 全部通过（${out.length} 项）`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
