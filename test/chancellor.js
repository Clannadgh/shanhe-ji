/* =============================================================
 * test/chancellor.js —— v12 收官（决策核心抽取 + 宰相）的验收
 *
 * 对着任务书 §13 / §14 逐条过：
 *   ① 文科卡池加四级宰相词条（超稀有 ~3.8%）· 四级规则表 · 头衔随政体
 *   ② 拜相：只有 isChancellor 能拜；移出候选池；不进 OFFICIAL；拜相/罢相进纪要
 *   ③ 四级行为：守成只有营造+科研（开关点了也不生效）· 干练降税线 ×0.8 ·
 *      贤相会看账 + 幸福 <40 撂挑子 · 权相无视开关 + 偷金 + 民心 −3 + 弹劾
 *   ④ 俸禄 ×1/2/4/1 从国库出；欠饷 → 自动化停摆，补上即复工
 *   ⑤ "你手动做的他绝不推翻"（手动改税后 3 回合内他不碰税）
 *   ⑥ §13 等价性：AI 国走 aiDecide(全 true) 与旧 aiCountry 完全一致
 *   ⑦ AI 抽到宰相级当省官用，fx 正常
 *   ⑧ 存档往返（不升版本号）+ 旧档容错
 *
 * 跑法：node test/chancellor.js
 * 200 省 / 12 国的小世界，约 30 秒。
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy-ai/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
const add = (list) => { for (const c of list) out.push(c); };

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text());
  });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1200);
  await page.evaluate(() => {
    document.getElementById('prov').value = 200;
    document.getElementById('ctry').value = 12;
    document.getElementById('seed').value = 'chancellor-spec';
    document.getElementById('gen').click();
  });
  await sleep(3000);

  /* ---------------- ⓪ 定义区 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const chs = A.TRAITS.filter(t => t.isChancellor);
    ok('⓪ 文科卡池加了四条宰相级（grade 1~4）',
      chs.length === 4 && chs.map(t => t.grade).join(',') === '1,2,3,4',
      chs.map(t => t.cn + '×' + t.w).join(' / '));
    const total = A.TRAITS.reduce((s, t) => s + t.w, 0);
    const cw = chs.reduce((s, t) => s + t.w, 0);
    ok('⓪ 宰相级权重合计 ≈3.8%（4.3 / 114.3）',
      Math.abs(cw - 4.3) < 1e-9 && Math.abs(cw / total - 0.038) < 0.004,
      (cw / total * 100).toFixed(2) + '%');
    const L = A.CHANCELLOR_LV;
    ok('⓪ 四级规则表：动作 1/2/3/3 · 俸禄 1/2/4/1',
      L[1].acts === 1 && L[2].acts === 2 && L[3].acts === 3 && L[4].acts === 3 &&
      L[1].pay === 1 && L[2].pay === 2 && L[3].pay === 4 && L[4].pay === 1);
    ok('⓪ 守成只有营造+科研；权相无视开关且可横征',
      L[1].perms.build === 1 && L[1].perms.research === 1 &&
      L[1].perms.tax === 0 && L[1].perms.officials === 0 &&
      L[4].ignorePerms === true && L[4].forceMax === true && L[4].grab === 3 &&
      L[4].happy === -3 && L[4].impeach === 0.1);
    ok('⓪ 头衔表（王国 宰相 / 帝国 摄政 / 共和 副总统 / 联邦 总理）',
      A.CH_TITLE.kingdom === '宰相' && A.CH_TITLE.empire === '摄政' &&
      A.CH_TITLE.republic === '副总统' && A.CH_TITLE.federation === '总理');
    ok('⓪ 决策核心对外是一个函数（§13）', typeof A.aiDecide === 'function' &&
      typeof A.aiDebug.decide === 'function');
    return o;
  }));

  await page.evaluate(() => { window.AO.resDebug.choosePlayer(1); });

  /* ---------------- ① 抽卡概率 + 拜相 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    /* 20000 次开科抽卡：宰相级占比 */
    let hit = 0;
    for (let i = 0; i < 20000; i++) if (A.traitOf(A.resRollTrait().key).isChancellor) hit++;
    const pct = hit / 20000;
    ok('① 文科 20000 连抽出宰相级 ≈3.8%', pct > 0.030 && pct < 0.046,
      (pct * 100).toFixed(2) + '%（' + hit + '/20000）');

    const T = A.resTalentOf(1);
    /* 普通文官：拜相钮不该亮（这里直接验函数） */
    T.pool.push({ id: 88001, name: '寻常吏', traitKey: 'finance', owed: 0, rank: 0, ten: 0, griev: 0, salAcc: 0 });
    const bad = D.appoint(1, 88001);
    ok('① 普通文官拜不了相', !bad.ok && /不是宰相之才/.test(bad.msg), bad.msg);

    T.pool.push({ id: 88002, name: '管仲', traitKey: 'ch_great', owed: 0, rank: 0, ten: 0, griev: 0, salAcc: 0 });
    D.notes().length = 0;
    const r = D.appoint(1, 88002);
    const ch = D.chOf(1);
    ok('① 宰相级词条可以拜相（移出候选池、入 CHANCELLOR）',
      r.ok && ch && ch.id === 88002 && T.pool.every(x => !x || x.id !== 88002),
      ch ? (ch.name + ' · grade ' + ch.grade) : '没拜成');
    ok('① 拜相进纪要（玩家年表看得到）',
      D.notes().filter(x => /拜相/.test(x.text)).length === 1,
      D.notes().map(x => x.text).join(' | ').slice(0, 50));
    /* 硬边界：不进 OFFICIAL 表 —— §2 的资历/怨气与 §4 的 AI 巡查都碰不到他 */
    let inOff = false;
    for (const k in A.resOfficial) if (A.resOfficial[k] && A.resOfficial[k].id === 88002) inOff = true;
    ok('① 宰相不进 OFFICIAL 表（两套状态互不渗透）', !inOff);

    /* 头衔随政体 */
    const c = D.world().countries[0], bak = c.govKey;
    const got = {};
    ['kingdom', 'empire', 'republic', 'federation'].forEach(k => { c.govKey = k; got[k] = D.chTitle(1); });
    c.govKey = bak;
    ok('① 头衔随政体动态变化',
      got.kingdom === '宰相' && got.empire === '摄政' &&
      got.republic === '副总统' && got.federation === '总理',
      JSON.stringify(got));

    /* 罢相：位子空缺、致仕不回池、自动化停 */
    D.notes().length = 0;
    const gone = D.dismissCh(1);
    ok('① 罢相：位子空缺、致仕不回池、进纪要',
      !!gone && !D.chOf(1) && T.pool.every(x => !x || x.id !== 88002) &&
      D.notes().filter(x => /罢相/.test(x.text)).length === 1);
    ok('① 罢相之后自动化全停', D.chancellorAct() === 0);
    return o;
  }));

  /* ---------------- ② 四级：权限与行为 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, L = A.CHANCELLOR_LV, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const T = A.resTalentOf(1);
    const mk = (id, name, key) => ({ id: id, name: name, traitKey: key, owed: 0,
      rank: 0, ten: 0, griev: 0, salAcc: 0 });
    const boot = (key, id) => {
      if (D.chOf(1)) D.dismissCh(1);
      T.pool.push(mk(id, '相' + id, key));
      const r = D.appoint(1, id);
      return r.ok ? D.chOf(1) : null;
    };

    /* 守成之才：开关全开也只有营造+科研 */
    let ch = boot('ch_keep', 88101);
    ch.perms = { build: 1, research: 1, tax: 1, officials: 1 };
    const p1 = D.chPerms(ch);
    ok('② 守成之才：权限只有营造+科研（开关点了也不生效）',
      p1.build === 1 && p1.research === 1 && p1.tax === 0 && p1.officials === 0,
      JSON.stringify(p1));

    /* 同一场景三种权限/系数，看"守成不碰税"和"干练的线 ×0.8"两件事：
     *   a) 守成（perms.tax=0）：民心 40 也不降
     *   b) 干练（taxMul 0.8，线 45×0.8=36）：民心 40 不降（40 ≥ 36）
     *   c) 常人（taxMul 1，线 45）：民心 40 降档
     *   d) 干练 + 民心 35（< 36）：降档
     * 四次都从同一个税率 1、国库 200 起跑。 */
    const setState = (rate, happy, gold) => {
      D.setTax(1, rate);
      D.ensureCentral(1).gold = gold;
      D.country(1).provinces.forEach(x => { D.happy[x].v = happy; });
    };
    const runTax = (perms, opt, happy) => {
      setState(1, happy, 200);
      A.aiDecide(1, perms, opt);
      return A.resTaxRateOf(1);
    };
    const tKeep = runTax(p1, { slots: 1, taxMul: L[1].taxMul, noMaxTax: true }, 40);
    ch = boot('ch_able', 88102);
    const tAble40 = runTax(D.chPerms(ch), { slots: 2, taxMul: L[2].taxMul, noMaxTax: true }, 40);
    const tPlain40 = runTax({ tax: 1 }, { slots: 1, taxMul: 1, noMaxTax: true }, 40);
    const tAble35 = runTax(D.chPerms(ch), { slots: 2, taxMul: L[2].taxMul, noMaxTax: true }, 35);
    ok('② 守成不碰税（民心 40 也不降）', tKeep === 1, '税率 1 → ' + tKeep);
    ok('② 干练的降档线 ×0.8：民心 40 不降、民心 35 才降（常人 40 就降）',
      tAble40 === 1 && tAble35 === 0 && tPlain40 === 0,
      '干练@40=' + tAble40 + ' · 干练@35=' + tAble35 + ' · 常人@40=' + tPlain40);

    /* 权相：开关全关也全开 */
    ch = boot('ch_power', 88104);
    ch.perms = { build: 0, research: 0, tax: 0, officials: 0 };
    const p4 = D.chPerms(ch);
    ok('② 权倾朝野无视权限开关（四项全开）',
      p4.build === 1 && p4.research === 1 && p4.tax === 1 && p4.officials === 1,
      JSON.stringify(p4));

    /* 权相代价：偷金 3 + 俸禄 1 = 中央 −4；FLOWC 记 d.chancellor */
    D.flowc[1] = { gain: {}, loss: {}, d: {} };
    D.ensureCentral(1).gold = 100;
    ch.owed = 0;
    D.setTurn(600);
    D.settleChancellor();
    const fc = D.flowc[1];
    ok('② 权相每回合从国库拿 3 金（+ 俸禄 1）',
      Math.abs(D.ensureCentral(1).gold - 96) < 1e-9 && fc.d.chancellor === 4,
      '中央 100 → ' + D.ensureCentral(1).gold + ' · d.chancellor=' + fc.d.chancellor);

    /* 权相：全国民心常驻 −3 */
    const pid = D.country(1).provinces[0];
    D.settleHappy(pid, D.world().provinces[pid - 1]);
    ok('② 权臣在朝：民心 driver 常驻 −3',
      D.happy[pid].drivers.chancellor === -3,
      'drivers.chancellor=' + D.happy[pid].drivers.chancellor);

    /* 权相：10% 弹劾（stub 随机数，确定性验证） */
    const realRnd = Math.random;
    D.notes().length = 0;
    Math.random = () => 0.05;
    D.settleChancellor();
    const hitNote = D.notes().filter(x => /弹劾/.test(x.text)).length;
    D.notes().length = 0;
    Math.random = () => 0.5;
    D.settleChancellor();
    const missNote = D.notes().filter(x => /弹劾/.test(x.text)).length;
    Math.random = realRnd;
    ok('② 权相：10% 概率被谏官弹劾（0.05 触发 / 0.5 不触发）',
      hitNote === 1 && missNote === 0, hitNote + ' / ' + missNote);
    return o;
  }));

  /* ---------------- ③ 贤相：看账 / 撂挑子 / 进言 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, L = A.CHANCELLOR_LV, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const T = A.resTalentOf(1);
    if (D.chOf(1)) D.dismissCh(1);
    T.pool.push({ id: 88201, name: '魏征', traitKey: 'ch_great', owed: 0,
      rank: 0, ten: 0, griev: 0, salAcc: 0 });
    D.appoint(1, 88201);
    const ch = D.chOf(1);
    ok('③ 贤相每回合 3 个动作', D.chLv(ch).acts === 3 && L[3].acts === 3);

    /* 看账：贤相的两条线与常人不同 ——
     *   民心 65、国库 90（<100）→ 升回常规（和常人一样）
     *   民心 65、国库 110（>100）→ **不升**（国库宽裕，没必要加税）
     * 第二条是"会看账"真正区别于常人的地方（常人 110 > 80 就会升）。 */
    const runSmart = (gold) => {
      D.setTax(1, 0);
      D.ensureCentral(1).gold = gold;
      D.country(1).provinces.forEach(x => { D.happy[x].v = 65; });
      A.aiDecide(1, { tax: 1 }, { slots: 1, smartTax: true, noMaxTax: true });
      return A.resTaxRateOf(1);
    };
    const s90 = runSmart(90), s110 = runSmart(110);
    /* 对照：常人在国库 110 时会升 */
    D.setTax(1, 0);
    D.ensureCentral(1).gold = 110;
    D.country(1).provinces.forEach(x => { D.happy[x].v = 65; });
    A.aiDecide(1, { tax: 1 }, { slots: 1, noMaxTax: true });
    const plain110 = A.resTaxRateOf(1);
    ok('③ 贤相会看账：国库吃紧才升税（90 升 / 110 不升；常人 110 也升）',
      s90 === 1 && s110 === 0 && plain110 === 1,
      '贤相 90→' + s90 + ' · 110→' + s110 + ' · 常人 110→' + plain110);

    /* 撂挑子：平均民心 30 → 罢工；回到 50 → 复工 */
    D.country(1).provinces.forEach(x => { D.happy[x].v = 30; });
    D.notes().length = 0;
    D.setTurn(700);
    D.settleChancellor();
    const strike = ch.paused;
    const actsWhileStrike = D.chancellorAct();
    D.country(1).provinces.forEach(x => { D.happy[x].v = 50; });
    D.settleChancellor();
    const resumed = ch.paused;
    ok('③ 贤相：幸福 <40 撂挑子（自动化暂停）→ 回到 45 复工',
      strike === 'strike' && actsWhileStrike === 0 && resumed === '',
      'paused=' + (strike || '空') + ' · 罢工时动作 ' + actsWhileStrike + ' · 复工后 ' + (resumed || '空'));
    ok('③ 撂挑子与复工各进一条纪要',
      D.notes().filter(x => /撂挑子/.test(x.text)).length === 1 &&
      D.notes().filter(x => /回朝视事/.test(x.text)).length === 1,
      D.notes().map(x => x.text.slice(0, 12)).join(' | '));

    /* 进言：每 10 回合一条 */
    D.notes().length = 0;
    ch.adviseAt = D.turn() - 10;
    D.settleChancellor();
    ok('③ 贤相每 10 回合进言一条（进纪要）',
      D.notes().filter(x => /进言/.test(x.text)).length === 1,
      D.notes().filter(x => /进言/.test(x.text))[0] &&
      D.notes().filter(x => /进言/.test(x.text))[0].text);
    return o;
  }));

  /* ---------------- ④ 俸禄 / 欠饷停摆 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const T = A.resTalentOf(1);
    if (D.chOf(1)) D.dismissCh(1);
    T.pool.push({ id: 88301, name: '萧何', traitKey: 'ch_able', owed: 0,
      rank: 0, ten: 0, griev: 0, salAcc: 0 });
    D.appoint(1, 88301);
    const ch = D.chOf(1);
    D.flowc[1] = { gain: {}, loss: {}, d: {} };
    D.setTurn(800);
    D.ensureCentral(1).gold = 50;
    D.settleChancellor();
    ok('④ 干练俸禄 ×2（每回合 2 金，从国库出）',
      Math.abs(D.ensureCentral(1).gold - 48) < 1e-9 && D.flowc[1].d.chancellor === 2,
      '中央 50 → ' + D.ensureCentral(1).gold);

    /* 欠饷 → 停摆 */
    D.ensureCentral(1).gold = 0;
    D.notes().length = 0;
    D.settleChancellor();
    const owed = ch.owed, paused = ch.paused, acts = D.chancellorAct();
    ok('④ 国库发不出俸禄 → 欠饷停摆（自动化暂停）',
      owed >= 2 && paused === 'owed' && acts === 0,
      'owed=' + owed + ' · paused=' + paused + ' · 动作 ' + acts);
    ok('④ 欠饷停摆进纪要', D.notes().filter(x => /俸禄发不出/.test(x.text)).length === 1);

    /* 补上 → 复工 */
    D.ensureCentral(1).gold = 100;
    D.settleChancellor();
    ok('④ 国库补上 → 欠饷清零、复工',
      ch.owed === 0 && ch.paused === '',
      'owed=' + ch.owed + ' · paused=' + (ch.paused || '空'));
    return o;
  }));

  /* ---------------- ⑤ 不推翻玩家的手动操作 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const ch = D.chOf(1);
    /* 手动把税拉满，民心压到 30（贤相按自己的判断会立刻降档） */
    D.setTurn(900);
    D.country(1).provinces.forEach(x => { D.happy[x].v = 30; });
    D.ensureCentral(1).gold = 200;
    /* 走 UI 的 setTaxRate（它才会记 TAXMAN） */
    D.openGov();
    A.resDebug.setTax(1, 2);                 // 直写（不记 TAXMAN）
    A.resSetTaxRate ? A.resSetTaxRate(1, 2) : null;
    /* 用界面同一入口：点税率按钮 */
    const btn = document.querySelector('#gpRates button[data-rate="2"]');
    if (btn) btn.click();
    const rate0 = A.resTaxRateOf(1);
    D.chancellorAct();
    const rate1 = A.resTaxRateOf(1);
    ok('⑤ 你手动改过的税率，宰相 3 回合内不碰',
      rate0 === 2 && rate1 === 2, '手动 2 → 宰相之后 ' + rate1);
    ok('⑤ 但过了 3 回合他就按自己的判断来',
      (function () {
        D.setTurn(905);
        D.chancellorAct();
        return A.resTaxRateOf(1) !== 2;
      })(), '第 905 回合税率 ' + A.resTaxRateOf(1));
    return o;
  }));

  /* ---------------- ⑥ §13 等价性：AI 走 aiDecide 与旧路径一致 ---------------- */
  add(await page.evaluate(() => {
    const A = window.AO, D = A.resDebug, AI = A.aiDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const me = D.player();
    const c = D.world().countries.find(x => x.id !== me && x.provinces.length >= 3);
    /* 同一份状态下，aiCountry 与 decide(全 true) 必须给出同一个动作数 */
    D.ensureCentral(c.id).gold = 3000;
    D.setTurn(1000);
    const a = AI.country(c);
    D.ensureCentral(c.id).gold = 3000;
    D.setTurn(1000);
    const b = AI.decide(c.id, AI.allPerms, { slots: A.AIECON.actPerTurn });
    const z = AI.decide(c.id, {}, { slots: 2 });          // 空权限 = 一格都不做
    ok('⑥ §13 等价性：aiCountry ≡ aiDecide(全权限)；空权限 = 0 动作',
      a === b && a >= 1 && z === 0,
      'aiCountry=' + a + ' · aiDecide=' + b + ' · 空权限=' + z);
    ok('⑥ AI 国传的就是"四项全开"',
      AI.allPerms.build && AI.allPerms.research && AI.allPerms.tax && AI.allPerms.officials);

    /* AI 抽到宰相级当省官：fx 正常生效（不拜相、不受宰相规则影响） */
    const pid = c.provinces[0];
    A.resOfficial[pid] = { id: 88401, name: '权臣甲', traitKey: 'ch_power', owed: 0,
      rank: 0, ten: 0, griev: 0, salAcc: 0 };
    const mul = D.pmod(pid).taxMul;
    ok('⑦ AI 抽到宰相级当省官用，fx 正常（税 ×1.25）',
      Math.abs(mul - 1.25) < 0.01, 'taxMul=' + mul.toFixed(3));
    delete A.resOfficial[pid];
    return o;
  }));

  /* ---------------- ⑧ 存档往返 ---------------- */
  add(await page.evaluate(async () => {
    const A = window.AO, D = A.resDebug, o = [];
    const ok = (n, c, d) => o.push({ name: n, ok: !!c, detail: d === undefined ? '' : String(d) });
    const ch = D.chOf(1);
    ch.perms = { build: 1, research: 0, tax: 1, officials: 0 };
    ch.owed = 3;
    D.save(true);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('sj.save')); } catch (e) {
      return [{ name: '⑧ 读得到存档', ok: false, detail: 'no-storage' }];
    }
    const sv = (raw.CHANCELLOR || {})[1] || {};
    ok('⑧ 存档里有 CHANCELLOR（不升版本号）',
      sv.id === ch.id && sv.grade === ch.grade && sv.owed === 3 &&
      sv.perms && sv.perms.research === 0,
      JSON.stringify({ id: sv.id, grade: sv.grade, owed: sv.owed }) +
      ' · v' + raw.v + '（当前 v' + A.SAVE_VER + '）');

    /* 旧档：删掉 CHANCELLOR 再读 → 空表，不炸 */
    delete raw.CHANCELLOR;
    localStorage.setItem('sj.save', JSON.stringify(raw));
    D.load();
    await new Promise(r => setTimeout(r, 1600));
    ok('⑧ 旧档（无 CHANCELLOR）读档 = 还没拜相，不炸',
      !D.chOf(1) && typeof D.chancellorAct() === 'number',
      '拜相表 ' + Object.keys(A.resDebug.chancellor).length + ' 条');
    return o;
  }));

  /* ---------------- 汇总 ---------------- */
  let pass = 0, fail = 0;
  for (const r of out) {
    if (r.ok) { pass++; console.log('  PASS   ' + r.name + (r.detail ? '  —  ' + r.detail : '')); }
    else { fail++; console.log('  FAIL   ' + r.name + (r.detail ? '  —  ' + r.detail : '')); }
  }
  console.log('\n共 ' + out.length + ' 项：' + pass + ' 通过 / ' + fail + ' 失败');
  if (errors.length) {
    console.log('控制台错误：');
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
  } else {
    console.log('no console errors');
  }
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
