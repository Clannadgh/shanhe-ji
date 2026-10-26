/* =============================================================
 * test/bench-mill.js —— 军工产线的**数值 bench**（策略 N）
 *
 * ★ 拍板就看这张表。★
 * 两条流各跑 100 回合，条件完全相同（同样的坊 / 同样的补贴 / 同样的兵营），
 * 只有**产能怎么分**不一样：
 *   爆兵流  全产能 → 兵刃，能征就征，一件装备都不打
 *   精兵流  2 点 → 兵刃，其余 → 盔/甲/靴，每一支都「一键配齐」
 * 每 20 回合记一行。最后两张表：
 *   ① 家底对照（军数 / 总兵力 / 总战力 / 装备倍率 / 配装件 / 余军械 / 国库装备）
 *   ② 两军对撞（同省 · 同兵种铁甲步卒 · 30 局）
 *
 * 关于"以少胜多"的口径（实测结论，写在这里免得下次再踩）：
 *   本作的胜负判据是 **兵力比**（BATTLE.routRatio：剩兵不到对方的 70% 判负），
 *   而伤亡是"按兵数比例摊"的，所以装备倍率只能**慢速**改变兵力比 ——
 *   1.48 倍装上 1.4 倍兵力，一场打下来兵力比只从 0.714 挪到 0.720，仍然判负。
 *   故"少"的正确读法是**少军数、同兵力**（少军高配 vs 多军低配，正是拍板原文
 *   的说法）：5 支满编对 10 支半编，精兵流稳赢。兵力本身少 15% 以上时靠装备
 *   翻盘不成立 —— 这是会战公式决定的，不是这一层能改的（"不动会战"是硬约束）。
 *
 * 跑法：node test/bench-mill.js
 * ============================================================= */
'use strict';
const path = require('path');
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SEED = 'bench-mill-1';
const PROV = 120, CTRY = 8;
const TURNS = 100, STEP = 20;

function dw(s) {
  let n = 0;
  for (const ch of String(s)) n += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return n;
}
function pad(s, w, right) {
  s = String(s);
  const gap = Math.max(0, w - dw(s));
  return right ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}
function row(cells, widths, rights) {
  return cells.map((c, i) => pad(c, widths[i], rights && rights[i])).join(' ');
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(1600);

  async function regen() {
    await page.evaluate((s, pv, ct) => {
      document.getElementById('seed').value = s;
      document.getElementById('prov').value = pv;
      document.getElementById('ctry').value = ct;
      document.getElementById('provVal').textContent = pv;
      document.getElementById('ctryVal').textContent = ct;
      document.getElementById('gen').click();
    }, SEED, PROV, CTRY);
    await sleep(2400);
  }

  /* 把一国改造成"军工作坊"：4 座兵营省、2 座军械坊、1 座工厂、1 位宗师匠人、
   * 军械研到铁兵器。两条流共用这一份底子。 */
  async function setup() {
    return page.evaluate(() => {
      const AO = window.AO, D = AO.resDebug, w = D.world();
      let best = null;
      for (const c of w.countries) {
        const ironN = c.provinces.filter(pid => {
          const bag = AO.resSim[pid];
          return bag && bag.iron && bag.iron.n >= 40;
        }).length;
        if (!best || ironN > best.ironN) best = { id: c.id, ironN: ironN, provs: c.provinces.slice() };
      }
      D.choosePlayer(best.id);
      const owner = best.id;
      const R = AO.resResearch[owner] || (AO.resResearch[owner] = { pts: 0, unlocked: true, cur: null, done: {}, queue: [] });
      R.unlocked = true;
      R.done.mil_bronze = true; R.done.mil_iron = true;

      const barracks = best.provs.slice(0, 4);
      for (const pid of barracks) {
        AO.resMil.barracks[pid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
        const bag = AO.resSim[pid];
        bag.iron.built = Math.max(1, bag.iron.built);
        bag.iron.tiers[1] = Math.max(1, bag.iron.tiers[1] || 0);
      }
      const shopPid = barracks[0];
      AO.resMil.armory[shopPid] = { n: 2, site: 0, halted: false, mAcc: { iron: 0, gold: 0 }, order: null };
      AO.resFactory[shopPid] = { n: 1, site: 0, halted: false, mAcc: { iron: 0, gold: 0 } };
      D.addTalent(owner, 400);
      for (let i = 0; i < 3; i++) {
        const ex = D.examArtisan(owner);
        if (ex.ok) { ex.artisan.lv = 3; D.postArtisan(shopPid, ex.artisan.id); }
      }
      return { owner: owner, barracks: barracks, shop: shopPid, cap: D.millCap(shopPid, 'armory') };
    });
  }

  /* 一回合：补贴 → 排产线 → 结算 → 征兵 → （精兵）配装 → 强制和平 */
  async function step(strat) {
    return page.evaluate((S) => {
      const AO = window.AO, D = AO.resDebug;
      const ctx = window.__benchCtx;
      const owner = ctx.owner, shop = ctx.shop;
      /* 战争补贴：料 / 金 / 粮都管够 —— 这张 bench 比的是"产能怎么分"，
       * 不是"矿够不够"，资源断供会把两条流都压成 0，什么也看不出来。 */
      const all = ctx.barracks.concat([shop]);
      for (const pid of all) {
        const bag = AO.resSim[pid];
        if (!bag) continue;
        bag.iron.stock = 400; bag.timber.stock = 400; bag.gold.stock = 400;
        bag.horse.stock = 200; bag.salt.stock = 200;
        bag.grain.stock = 4000; bag.fish.stock = 2000;
      }
      const cen = D.ensureCentral(owner);
      cen.iron = 400; cen.gold = 400; cen.timber = 400; cen.grain = 4000;

      const cap = D.millCap(shop, 'armory');
      const plan = {};
      if (S === 'wave') {
        plan.wpn = cap;
      } else {
        plan.wpn = Math.min(2, cap);                 // 1 炉 = 2 件兵刃
        const left = cap - plan.wpn;
        plan.helm = Math.ceil(left / 3);
        plan.chest = Math.ceil(left / 3);
        plan.boots = Math.max(0, left - plan.helm - plan.chest);
      }
      D.millOf(shop).pick.wpn = 'ironwp';
      D.setMillPlan(shop, 'armory', plan, true);

      D.settleTurn();

      for (const pid of ctx.barracks) D.recruit(pid, 'inf');

      if (S === 'elite') {
        for (const a of D.armiesOf(owner)) {
          if (a.type !== 'navy') D.equipAutoFit(a, true);
        }
      }
      /* 强制和平：不然 AI 打过来把军队全歼，这张表测的就不是经济了 */
      const wars = AO.resWar.wars;
      for (const k of Object.keys(wars)) {
        if (!wars[k]) continue;
        const ab = k.split('|').map(Number);
        if (ab[0] === owner || ab[1] === owner) D.makePeace(owner, ab[0] === owner ? ab[1] : ab[0]);
      }
      return true;
    }, strat);
  }

  async function snapshot() {
    return page.evaluate(() => {
      const AO = window.AO, D = AO.resDebug, ctx = window.__benchCtx;
      const list = D.armiesOf(ctx.owner).filter(a => a.type !== 'navy');
      let men = 0, pow = 0, mulSum = 0, eq = 0;
      for (const a of list) {
        men += a.men;
        pow += (a.men / 1000) * (AO.MIL_ITEM[a.tier] || {}).pow * D.equipMulOf(a);
        mulSum += D.equipMulOf(a);
        eq += (a.equip && a.equip.helm ? 1 : 0) + (a.equip && a.equip.chest ? 1 : 0) + (a.equip && a.equip.boots ? 1 : 0);
      }
      const bag = AO.resSim[ctx.shop];
      return {
        turn: D.turn(), n: list.length, men: men,
        pow: Math.round(pow * 10) / 10,
        mul: list.length ? mulSum / list.length : 1,
        eq: eq,
        wpn: bag ? (bag.ironwp ? bag.ironwp.stock : 0) : 0,
        equipStock: D.equipTotal(ctx.owner)
      };
    });
  }

  const results = {};
  for (const strat of ['wave', 'elite']) {
    await regen();
    const ctx = await setup();
    await page.evaluate((c) => { window.__benchCtx = c; }, ctx);
    const rows = [];
    for (let t = 1; t <= TURNS; t++) {
      await step(strat);
      if (t % STEP === 0) rows.push(await snapshot());
    }
    results[strat] = { ctx: ctx, rows: rows, final: await snapshot() };
  }

  await page.evaluate((w, e) => { window.__benchWave = w; window.__benchElite = e; },
    results.wave, results.elite);

  /* ---------------- 两军对撞 ----------------
   * 精兵侧：铁甲步卒 + 三件珍品（铁材质 8% × 2.0 → ×1.48）
   * 爆兵侧：同兵种、不配装（×1.00）
   * "少" = 少军数：5 支 × 2000 人对 10 支 × 1000 人（同兵力、半军数）。 */
  const duel = await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world();
    const wave = window.__benchWave, elite = window.__benchElite;
    const A = elite.ctx.owner, B = wave.ctx.owner;          // A = 精兵国
    const prov = w.provinces.find(p => p.owner !== A && p.owner !== B && p.terrain === 'plains') || w.provinces[0];
    D.declareWar(A, B);
    /* 装备库存：对撞要的是"配得上装"，所以直接塞满（这一格测的是会战，不是产线） */
    const inv = D.equipOf(A);
    inv.helm.rare = 999; inv.chest.rare = 999; inv.boots.rare = 999;
    AO.resResearch[A].done.mil_iron = true;
    AO.resResearch[A].done.mil_bronze = true;

    function run(nElite, menElite, nWave, menWave, trials) {
      let win = 0, loss = 0, draw = 0, eSurv = 0, wSurv = 0;
      for (let t = 0; t < trials; t++) {
        const ea = [], wa = [];
        for (let i = 0; i < nElite; i++) {
          const a = D.newArmy(A, prov.id, { tier: 'ironwp', men: menElite });
          D.equipArmy(a, 'helm', 'rare'); D.equipArmy(a, 'chest', 'rare'); D.equipArmy(a, 'boots', 'rare');
          ea.push(a);
        }
        for (let i = 0; i < nWave; i++) wa.push(D.newArmy(B, prov.id, { tier: 'ironwp', men: menWave }));
        const rep = D.fight(ea, wa, prov, {});
        const eLeft = ea.reduce((s, a) => s + Math.max(0, a.men), 0);
        const wLeft = wa.reduce((s, a) => s + Math.max(0, a.men), 0);
        eSurv += eLeft; wSurv += wLeft;
        if (rep.winner === 'atk') win++;
        else if (eLeft === wLeft) draw++;
        else loss++;
        for (const a of ea) if (D.army[a.id]) D.fogDisband(a.id);
        for (const a of wa) if (D.army[a.id]) D.fogDisband(a.id);
      }
      return { win: win, loss: loss, draw: draw, trials: trials,
        eSurv: eSurv / trials, wSurv: wSurv / trials };
    }
    return [
      Object.assign({ case: '5 支×2000 精兵 vs 10 支×1000 爆兵（同兵力·半军数）' }, run(5, 2000, 10, 1000, 30)),
      Object.assign({ case: '10 支×1000 精兵 vs 10 支×1000 爆兵（同数同兵）' }, run(10, 1000, 10, 1000, 30)),
      Object.assign({ case: '5 支×1700 精兵 vs 10 支×1000 爆兵（少 15% 兵力）' }, run(5, 1700, 10, 1000, 30)),
      Object.assign({ case: '5 支×1400 精兵 vs 10 支×1000 爆兵（少 30% 兵力）' }, run(5, 1400, 10, 1000, 30))
    ];
  });

  /* ---------------- 出表 ---------------- */
  const W = [7, 6, 9, 8, 9, 7, 8, 9], R = [0, 1, 1, 1, 1, 1, 1, 1];
  console.log('\n=== 策略 N：爆兵流 vs 精兵流（同条件 ' + TURNS + ' 回合） ===');
  console.log('（军数 / 总兵力 / 总战力 / 装备倍率 / 配装件 / 余军械 / 国库装备）\n');
  for (const strat of ['wave', 'elite']) {
    const R2 = results[strat];
    console.log((strat === 'wave' ? '【爆兵流】全产能 → 兵刃，能征就征，不配装' :
      '【精兵流】2 点兵刃 + 其余装备，每一支一键配齐') + '　产能 ' + R2.ctx.cap + ' 点/回合');
    console.log('  ' + row(['回合', '军数', '总兵力', '总战力', '装备×', '配装件', '余军械', '国库装备'], W, R));
    for (const r of R2.rows) {
      console.log('  ' + row([r.turn, r.n, r.men, r.pow, r.mul.toFixed(3), r.eq, r.wpn, r.equipStock], W, R));
    }
    console.log('');
  }

  const wv = results.wave.final, el = results.elite.final;
  console.log('=== 家底对照（第 ' + wv.turn + ' 回合） ===');
  const C = [10, 8, 10, 10, 9, 11], CR = [0, 1, 1, 1, 1, 1];
  const perK = (s) => (s.men ? (s.pow / (s.men / 1000)) : 0).toFixed(3);
  console.log(row(['流', '军数', '总兵力', '总战力', '装备×', '每千战力'], C, CR));
  console.log(row(['爆兵', wv.n, wv.men, wv.pow, wv.mul.toFixed(3), perK(wv)], C, CR));
  console.log(row(['精兵', el.n, el.men, el.pow, el.mul.toFixed(3), perK(el)], C, CR));
  console.log('（每千战力 = 1000 人打出去的战力：装备倍率直接乘在这一列上）');

  console.log('\n=== 两军对撞（同省 · 铁甲步卒 · 30 局） ===');
  const D2 = [42, 6, 6, 6, 13], DR = [0, 1, 1, 1, 1];
  console.log(row(['情形', '胜', '负', '平', '精兵存活均值'], D2, DR));
  for (const d of duel) {
    console.log(row([d.case, d.win, d.loss, d.draw, Math.round(d.eSurv)], D2, DR));
  }

  const okElite = duel[0].win >= duel[0].trials * 0.8;
  const okBoth = wv.n > 0 && el.n > 0 && el.men > 0;
  console.log('\n验收：两流均 viable ' + (okBoth ? '✔' : '✘') +
    '（爆兵 ' + wv.n + ' 军 / ' + wv.men + ' 人 · 精兵 ' + el.n + ' 军 / ' + el.men + ' 人）');
  console.log('　　　精兵流以少（军数）胜多 80%+ 可复现 ' + (okElite ? '✔' : '✘') +
    '（' + duel[0].win + '/' + duel[0].trials + ' 胜）');
  if (errors.length) console.log('\nerrors:\n' + errors.join('\n'));
  await browser.close();
  process.exit(okBoth && okElite ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
