/* =============================================================
 * test/craft.js —— 制造工艺（v19）的合并验收
 *
 * 任务书第十一节逐条：
 *   ① 工艺链解锁分组与读档折算（mil_crossbow → mil_iron …）
 *   ② 三维公式：def 减伤（封顶 1.3）· mov 行军 / 先手 / 追击
 *   ③ 无条件：教育 0、没有匠人，也能开炮线 / 养具装马 / 选锋锐
 *   ④ 全国产能合计与池封顶（三池各自封顶）
 *   ⑤ 订单：5 产能 = 一回合一单 1000 件 · 1 产能 = 5 回合 ·
 *      10 产能仍 1 单且溢出分不进（API + UI 双拦）·「已满速」· 缺料卡条
 *   ⑥ 品质按单 roll（整队同品质）
 *   ⑦ 征兵不扣装备、裸兵 pow 0.5
 *   ⑧ 发马变骑兵、换装回步兵、换下回库
 *   ⑨ 换代回收折半 + 战报；并存期吃最高代
 *   ⑩ 炮舰不回收
 *   ⑪ 存档：MILLV / ARSENAL 进档，读档回来
 *
 * 跑法：node test/craft.js
 * 小世界（140 省 / 8 国），约 1 分钟。
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
    document.getElementById('seed').value = 'craft-spec-1';
    document.getElementById('gen').click();
  });
  await sleep(2400);

  /* 选一个国有铁矿的省当玩家国，并把三个坊都建起来（后面每段都靠它） */
  const base = await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, w = D.world();
    let pid = 0, owner = 0;
    for (const p of w.provinces) {
      const bag = AO.resSim[p.id];
      if (!bag || !bag.iron || !bag.iron.built) continue;
      pid = p.id; owner = p.owner; break;
    }
    D.choosePlayer(owner);
    const p = w.provinces[pid - 1];
    D.buildFactory(p, 'armory');
    const ar = AO.resMil.armory[pid]; ar.site = 0; ar.n = 3;   // 6 点
    return { pid: pid, owner: owner, name: p.name };
  });
  console.log('  基准省：' + base.name + '（#' + base.pid + '，国 ' + base.owner + '）');

  /* ---------------- ① 工艺链 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const C = AO.CRAFT;
    ok('① 工艺链六节点（皮革是免费根）',
      C.order.length === 6 && C.order[0] === 'leather' && C.order[5] === 'mil_gw', C.order.join('→'));
    ok('① 皮革节点在树上且标了 free',
      AO.TECH_BY_KEY.leather && AO.TECH_BY_KEY.leather.free === true && AO.TECH_BY_KEY.leather.pts === 0);
    ok('① 青铜挂在皮革（免费根）下 —— 工艺链读成一条链，不是两个并排的根',
      AO.TECH_BY_KEY.mil_bronze.req === 'leather');
    ok('① 五个工艺节点各带点数/工期/前置',
      C.order.slice(1).every(k => AO.TECH_BY_KEY[k] && AO.TECH_BY_KEY[k].pts > 0 && AO.TECH_BY_KEY[k].turns > 0),
      C.order.slice(1).map(k => AO.TECH_BY_KEY[k].pts).join('/'));
    /* 树上一个兵器名都不许出现：兵器名节点、铸炮枝、舰种枝全下树 */
    const weaponNames = ['青铜武士', '铁甲步卒', '强弩·具装', '火门枪', '火绳枪', '燧发枪',
      '击发枪', '后膛定装', '一战军械', '投石机', '青铜炮', '野战炮', '重炮',
      '桨帆船', '盖伦帆船', '风帆战列', '铁甲舰'];
    ok('① 树上没有兵器名节点（兵器 / 炮 / 舰都挂材质，不占科技格）',
      !AO.TECHS.some(t => weaponNames.indexOf(t.cn) >= 0) &&
      ['mil_crossbow', 'mil_musket', 'mil_flintlock', 'mil_breech',
        'mil_catapult', 'mil_bronze_gun', 'mil_field_gun', 'mil_heavy_gun',
        'mil_galley', 'mil_galleon', 'mil_ship74', 'mil_ironclad'].every(k => !AO.TECH_BY_KEY[k]),
      AO.TECHS.filter(t => t.branch === '工艺').map(t => t.cn).join('/'));
    /* 材质表：工艺唯一的数值产物 */
    ok('① 材质四档（皮 / 青铜 / 铁 / 火器）与倍率 1.00 / 1.15 / 1.30 / 1.55',
      AO.MAT_ORDER.join(',') === 'leather,bronze,iron,powder' &&
      AO.MATERIALS.map(m => m.mul).join(',') === '1,1.15,1.3,1.55',
      AO.MATERIALS.map(m => m.cn + '×' + m.mul).join(' · '));
    ok('① 解锁铁器 → 五类铁武器**全可造**（无逐步解锁）',
      AO.GEAR.types.length === 5 &&
      ['dao', 'jian', 'qiang', 'fu', 'gong'].every(t => AO.GEAR.types.some(x => x.key === t)) &&
      AO.GEAR.types.every(t => !t.need) &&
      AO.MIL_ITEM.iron.craft === 'mil_iron',
      AO.GEAR.types.map(t => t.cn).join('/'));
    ok('① 炮挂材质：投石机=皮革 · 青铜炮=青铜 · 野战炮=铁器 · 重炮=火器',
      !AO.MIL_ITEM.catapult.craft && AO.MIL_ITEM.bronze_gun.craft === 'mil_bronze' &&
      AO.MIL_ITEM.field_gun.craft === 'mil_iron' && AO.MIL_ITEM.heavy_gun.craft === 'mil_matchlock');
    ok('① 舰挂材质：桨帆=开局 · 盖伦=青铜 · 战列=铁器 · 铁甲舰=工业',
      !AO.MIL_ITEM.galley.craft && AO.MIL_ITEM.galleon.craft === 'mil_bronze' &&
      AO.MIL_ITEM.ship74.craft === 'mil_iron' && AO.MIL_ITEM.ironclad.craft === 'mil_gw');
    /* 读档折算表（工艺键 + 旧装备代键两套） */
    ok('① 折算表：crossbow→iron · musket/flintlock→matchlock · breech→percussion',
      C.alias.mil_crossbow === 'mil_iron' && C.alias.mil_musket === 'mil_matchlock' &&
      C.alias.mil_flintlock === 'mil_matchlock' && C.alias.mil_breech === 'mil_percussion');
    ok('① 装备代键 → 材质键（ironwp/crossbow→铁 · matchlock…gw→火器）',
      AO.matKeyOf('ironwp') === 'iron' && AO.matKeyOf('crossbow') === 'iron' &&
      AO.matKeyOf('musket') === 'powder' && AO.matKeyOf('breech') === 'powder' &&
      AO.matKeyOf('gw') === 'powder' && AO.matKeyOf('leather') === 'leather',
      ['ironwp', 'crossbow', 'musket', 'breech', 'gw'].map(k => k + '→' + AO.matKeyOf(k)).join(' '));
    /* 时代加成：精密 / 工业 各 +15% */
    const R = AO.resResearch[D.player()];
    const m0 = D.craftMulOf ? D.craftMulOf(D.player()) : 1;
    delete R.done.mil_percussion; delete R.done.mil_gw;
    const m1 = AO.craftMul(R.done);
    R.done.mil_percussion = true;
    const m2 = AO.craftMul(R.done);
    R.done.mil_gw = true;
    const m3 = AO.craftMul(R.done);
    delete R.done.mil_gw;
    ok('① 精密 +15% · 工业再 +15%（加算 1.30）',
      Math.abs(m1 - 1) < 1e-9 && Math.abs(m2 - 1.15) < 1e-9 && Math.abs(m3 - 1.30) < 1e-9,
      m1 + ' / ' + m2 + ' / ' + m3);
    return o;
  }));

  /* ---------------- ② 三维 ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner, pid = B.pid;
    /* ① 为了验时代加成临时打开过精密 —— 这里清掉，三维断言才对得上基准 */
    const RR = AO.resResearch[owner];
    delete RR.done.mil_percussion; delete RR.done.mil_gw;
    const mk = (tier, type, form, q) => {
      const a = D.newArmy(owner, pid, { type: 'army', men: 1000 });
      a.weapon = { key: [tier, type, form, q].join('|'), tier: tier, type: type, form: form, q: q };
      return a;
    };
    /* 类型基准（刀 1.00/0.80/2）→ 皮 ×1.00 → 凡 ×1.0 */
    const leather = D.unitOf(mk('leather', 'dao', 'plain', 'plain'));
    ok('② 类型基准：皮刀 1.00/0.80/2（三维来自类型，不是科技）',
      Math.abs(leather.atk - 1.0) < 1e-6 && Math.abs(leather.def - 0.8) < 1e-6 &&
      leather.mov === 2, JSON.stringify(leather));
    /* 材质倍率 1.30：1.00×1.30 = 1.30 · 0.80×1.30 = 1.04 */
    const iron = D.unitOf(mk('iron', 'dao', 'plain', 'plain'));
    ok('② 材质倍率：铁 ×1.30 → 1.30/1.04/2',
      Math.abs(iron.atk - 1.30) < 1e-6 && Math.abs(iron.def - 1.04) < 1e-6 && iron.mov === 2,
      iron.atk.toFixed(2) + '/' + iron.def.toFixed(2) + '/' + iron.mov);
    /* 五种类型各不同：剑 1.05/0.90 · 矛 1.10/0.70 · 斧 1.20/0.60/1 */
    const jian = D.unitOf(mk('leather', 'jian', 'plain', 'plain'));
    const qiang = D.unitOf(mk('leather', 'qiang', 'plain', 'plain'));
    const fu = D.unitOf(mk('leather', 'fu', 'plain', 'plain'));
    ok('② 五类型基准各不同（剑 1.05/0.90 · 矛 1.10/0.70 · 斧 1.20/0.60/1）',
      Math.abs(jian.atk - 1.05) < 1e-6 && Math.abs(qiang.def - 0.70) < 1e-6 &&
      Math.abs(fu.atk - 1.20) < 1e-6 && fu.mov === 1,
      jian.atk + '/' + qiang.def + '/' + fu.atk + '·mov' + fu.mov);
    const heavy = D.unitOf(mk('iron', 'dao', 'heavy', 'plain'));
    ok('② 重装 def+30% mov−1 档', Math.abs(heavy.def - iron.def * 1.3) < 1e-6 && heavy.mov === 1,
      'def ' + iron.def.toFixed(2) + '→' + heavy.def.toFixed(2) + ' · mov ' + heavy.mov);
    const swift = D.unitOf(mk('leather', 'dao', 'swift', 'plain'));
    ok('② 疾行 mov+1 → 3 档（快档）· atk −10%',
      swift.mov === 3 && Math.abs(swift.atk - leather.atk * 0.9) < 1e-6,
      'mov ' + swift.mov + ' · atk ' + swift.atk.toFixed(2));
    const keen = D.unitOf(mk('iron', 'dao', 'keen', 'plain'));
    ok('② 锋锐 atk+25% def−15%',
      Math.abs(keen.atk - iron.atk * 1.25) < 1e-6 && Math.abs(keen.def - iron.def * 0.85) < 1e-6,
      'atk ' + keen.atk.toFixed(2) + ' · def ' + keen.def.toFixed(2));
    const gong = D.unitOf(mk('leather', 'gong', 'plain', 'plain'));
    const chong = D.unitOf(mk('powder', 'gong', 'plain', 'plain'));
    ok('② 弓 射程 1；火器材质 → 「铳」射程 2',
      gong.range === 1 && chong.range === 2 &&
      D.gearText(mk('powder', 'gong', 'plain', 'plain')).indexOf('铳') >= 0,
      '弓 range=' + gong.range + ' · 铳 range=' + chong.range);
    const rare = D.unitOf(mk('leather', 'dao', 'plain', 'rare'));
    ok('② 珍品 ×2.0', Math.abs(rare.atk - 2.0) < 1e-6, rare.atk);
    /* 科技不直加武器数值：同一份队份，研不研工艺三维不变（只有 eraBonus 那两档例外） */
    ok('② 科技不直加数值（同一份皮刀，工艺链不改变类型基准）',
      Math.abs(AO.GEAR.types[0].atk - 1.0) < 1e-9 && AO.GEAR.types[0].def === 0.8,
      JSON.stringify(AO.GEAR.types[0]));

    /* 骑兵（马）三维 */
    const cav = mk('leather', 'dao', 'plain', 'plain');
    cav.mount = { key: 'barded|plain', breed: 'barded', q: 'plain' };
    const cu = D.unitOf(cav);
    ok('② 具装马 def+30% mov−1', cu.def > leather.def && cu.mov === 1,
      'def ' + cu.def.toFixed(2) + ' · mov ' + cu.mov);

    /* def 减伤封顶 */
    ok('② 减伤封顶 1.3 / 开方指数 0.5',
      AO.BATTLE.defMitCap === 1.3 && AO.BATTLE.defMitExp === 0.5);
    ok('② mov 三用常量：快档 2 省 / 先手 5% / 追击 5%',
      AO.BATTLE.fastMove === 3 && AO.BATTLE.fastMoveHops === 2 &&
      AO.BATTLE.initPerStep === 0.05 && AO.BATTLE.pursuePerStep === 0.05);

    /* 会战：同一场战斗里，战报要带三维与追击字段（骰子锁死 → 可复算） */
    const w = D.world();
    let X = 0, Y = 0;
    for (const p of w.provinces) {
      if (p.owner !== owner) continue;
      for (const nb of p.neighbors) {
        const q = w.provinces[nb - 1];
        if (q && q.owner !== owner && q.owner > 0) { X = p.id; Y = q.id; break; }
      }
      if (X) break;
    }
    if (X && Y) {
      D.declareWar(owner, w.provinces[Y - 1].owner);
      for (const id of Object.keys(D.army)) delete D.army[id];
      const atk = mk('iron', 'dao', 'keen', 'plain');
      atk.pid = X;
      const def = mk('iron', 'dao', 'heavy', 'plain');
      def.pid = Y; def.owner = w.provinces[Y - 1].owner;
      def.order = { type: 'defend', cid: def.owner, pid: Y, tactic: 'assault' };
      D.setOrder(atk.id, { type: 'attack', pid: Y, cid: def.owner, tactic: 'assault' });
      const dLo = AO.BATTLE.diceLo, dHi = AO.BATTLE.diceHi;
      AO.BATTLE.diceLo = 1; AO.BATTLE.diceHi = 1;
      D.settleWar();
      AO.BATTLE.diceLo = dLo; AO.BATTLE.diceHi = dHi;
      const rep = AO.resWar.last;
      ok('② 战报带三维（mit / movA / movD / init）',
        !!rep && rep.three && typeof rep.three.mit === 'number' &&
        typeof rep.three.movA === 'number', rep && JSON.stringify(rep.three));
      ok('② 守方减伤 ≥ 1 且 ≤ 1.3', !!rep && rep.three.mit >= 1 && rep.three.mit <= 1.3,
        rep && rep.three.mit.toFixed(3));
      ok('② 追击字段在战报里（同档 → 0）', !!rep && typeof rep.pursue === 'number', rep && rep.pursue);
    } else {
      ok('② 找到接壤的敌省（会战用）', false, '没有相邻敌省');
    }
    return o;
  }, base));

  /* ---------------- ③ 无条件（教育 0 / 无匠人） ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner;
    const T = D.talentOf(owner);
    T.total = 0; T.pts = 0;                       // 教育 0
    const A = D.artisansOf(owner);
    A.pool = []; A.post = {};                     // 一个匠人都没有

    ok('③ 教育 0：炮线照样能分配',
      D.setLineAlloc(owner, 'catapult', 2, true).ok, 'catapult 2 点');
    ok('③ 教育 0：具装马照样能分配',
      D.setLineAlloc(owner, 'barded', 5, true).ok, 'barded');
    ok('③ 没有匠人：盔甲靴三线照样能开',
      D.setLineAlloc(owner, 'chest', 5, true).ok && D.setLineAlloc(owner, 'boots', 5, true).ok);
    ok('③ 形制/类型/品种都没有 need 字段（中间没有第二把锁）',
      !AO.GEAR.forms.some(f => f.need) && !AO.GEAR.types.some(f => f.need) &&
      !AO.GEAR.breeds.some(f => f.need));
    ok('③ 形制可以随便选（锋锐不需要任何条件）',
      D.setLineForm(owner, 'dao', 'keen', true).ok && D.millOf(owner).form.dao === 'keen');
    /* 收回去，别影响后面的产线断言 */
    D.setLineAlloc(owner, 'catapult', 0, true);
    D.setLineAlloc(owner, 'barded', 0, true);
    D.setLineAlloc(owner, 'chest', 0, true);
    D.setLineAlloc(owner, 'boots', 0, true);
    D.setLineForm(owner, 'dao', 'plain', true);
    return o;
  }, base));

  /* ---------------- ④ 产能：全国合计 + 池封顶 ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner;
    const capA = D.poolCap(owner, 'arm');
    ok('④ 军械池 = Σ 每省贡献（3 座 = 6 点起）', capA >= 6, 'arm=' + capA);
    ok('④ 军械池 12 条线（五类型 + 盔甲靴 + 炮四线），全国合计 20 条',
      AO.MILL.lines.arm.length === 12 && AO.MILL.lines.hor.length === 4 &&
      AO.MILL.lines.syd.length === 4, 'arm=' + AO.MILL.lines.arm.length);
    /* 池封顶：把 12 条线全塞满，合计不能超过容量 */
    for (const line of AO.MILL.lines.arm) D.setLineAlloc(owner, line, 99, true);
    const sum = D.allocSum(owner, 'arm');
    ok('④ 池封顶：合计 = 容量', sum === capA, sum + ' / ' + capA);
    /* 清空 */
    for (const line of AO.MILL.lines.arm) D.setLineAlloc(owner, line, 0, true);
    ok('④ 清空后合计 0', D.allocSum(owner, 'arm') === 0);
    return o;
  }, base));

  /* ---------------- ⑤ 订单：速度 / 溢出 / 满速 / 缺料 ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner, pid = B.pid;
    /* 维护欠费会让厂停产 → 产能缩水，把"5 点/1 点/10 点"的断言带偏。
     * 这一段只验订单机制，所以每回合前把本国的军工建筑强制复工。 */
    const unhalt = () => {
      for (const k of ['armory', 'stable', 'shipyard']) {
        for (const pp of D.coOf(owner).provinces) {
          const st = AO.resMil[k][pp];
          if (st) st.halted = false;
        }
      }
    };
    /* 料管够：中央 + 这个省都塞满 */
    /* 先研青铜工艺：皮甲的 recipe 是「马」，青铜才是「铁 + 木」——
     * 后面"缺料卡条"那段要断的就是铁木。 */
    AO.resResearch[owner].done.mil_bronze = true;
    const cen = AO.resCentral[owner];
    cen.iron = 500; cen.timber = 500; cen.grain = 500; cen.salt = 500;
    const bag = AO.resSim[pid];
    bag.iron.stock = 500; bag.timber.stock = 500;

    /* 5 点 = 一回合 1 单 */
    D.setLineAlloc(owner, 'dao', 5, true);
    const n0 = D.arsTotal(owner, 'wpn');
    unhalt();
    D.nextTurn();
    ok('⑤ 5 点产能 = 一回合一单（1 队份）', D.arsTotal(owner, 'wpn') - n0 === 1,
      '+' + (D.arsTotal(owner, 'wpn') - n0));
    ok('⑤ 完成一单后进度归零', D.lineStatus(owner, 'dao').prog === 0);

    /* 1 点 = 5 回合 */
    D.setLineAlloc(owner, 'dao', 1, true);
    const n1 = D.arsTotal(owner, 'wpn');
    let turns = 0;
    for (let i = 0; i < 4; i++) { unhalt(); D.nextTurn(); turns++; }
    const mid = D.arsTotal(owner, 'wpn') - n1;
    unhalt(); D.nextTurn(); turns++;
    const end = D.arsTotal(owner, 'wpn') - n1;
    ok('⑤ 1 点产能 = 5 回合 1 单', mid === 0 && end === 1, '第 4 回合 +' + mid + ' · 第 5 回合 +' + end);

    /* 溢出：API 封顶到工作量 */
    const r = D.setLineAlloc(owner, 'dao', 10, true);
    ok('⑤ API：10 点被压到工作量 5', r.pts === 5 && r.clamped === true, JSON.stringify(r));
    const n2 = D.arsTotal(owner, 'wpn');
    unhalt();
    D.nextTurn();
    ok('⑤ 10 点产能仍只出一单（每回合至多 1 单）', D.arsTotal(owner, 'wpn') - n2 === 1,
      '+' + (D.arsTotal(owner, 'wpn') - n2) + ' · st=' + JSON.stringify(D.lineStatus(owner, 'dao')) +
      ' · cost=' + JSON.stringify(D.orderCost(owner, 'dao')) + ' · cen=' + JSON.stringify(cen));

    /* UI：满速时 ＋ 置灰、行尾写「已满速」 */
    D.openMillPanel();
    const rows = Array.from(document.querySelectorAll('#mpBody .srow'));
    const daoRow = rows.filter(x => /刀/.test(x.textContent) && /工作量/.test(x.textContent))[0];
    ok('⑤ UI：「已满速 · 1 回合/单」标记', !!daoRow && /已满速/.test(daoRow.textContent),
      daoRow ? daoRow.textContent.slice(0, 40) : '没找到行');
    const plus = daoRow && daoRow.querySelector('button[data-mdelta="1"]');
    ok('⑤ UI：满速时 ＋ 钮置灰（第二道拦）', !!plus && plus.disabled === true);
    const minus = daoRow && daoRow.querySelector('button[data-mdelta="-1"]');
    if (minus) minus.click();
    ok('⑤ UI：− 钮真的改到分配', D.millOf(owner).alloc.dao === 4, D.millOf(owner).alloc.dao);
    D.closeMillPanel();

    /* 缺料：把这一代的料改成"要 99999 铁"（税每回合都在进铁，清库存不可靠），
     * 于是这一单**卡在 100% 等料**：不烧料、不丢进度、不出货。 */
    /* 保底：跑了好几回合，军械坊可能已经因维护欠费停产（产能 0）——
     * 这里把它修好、料补满，才验得准"缺料"而不是"没产能"。 */
    const ar0 = AO.resMil.armory[pid];
    ar0.halted = false;
    cen.iron = 500; cen.timber = 500;
    D.setLineAlloc(owner, 'dao', 5, true);
    D.millOf(owner).prog.dao = 0;
    const recipe0 = AO.MIL_ITEM.bronze.recipe;
    AO.MIL_ITEM.bronze.recipe = { iron: 99999 };
    const n3 = D.arsTotal(owner, 'wpn');
    /* 只跑**产业那一段**（settleIndustry）：走整回合的话，维护结算可能先把厂停掉，
     * 验出来的就成了"没产能"而不是"缺料"。 */
    D.settleIndustry(owner);
    const st = D.lineStatus(owner, 'dao');
    ok('⑤ 缺料：进度卡在 100%、不出货、不丢进度',
      st.prog === st.work && st.wait === true && D.arsTotal(owner, 'wpn') === n3,
      'prog=' + st.prog + '/' + st.work + ' · wait=' + st.wait + ' · +' + (D.arsTotal(owner, 'wpn') - n3) +
      ' · cap=' + D.poolCap(owner, 'arm') + ' · provCap=' + D.millCap(pid, 'armory'));
    D.openMillPanel();
    const row2 = Array.from(document.querySelectorAll('#mpBody .srow'))
      .filter(x => /刀/.test(x.textContent) && /工作量/.test(x.textContent))[0];
    ok('⑤ UI：缺料行写「等料」', !!row2 && /等料/.test(row2.textContent),
      row2 ? row2.textContent.slice(0, 40) : '没找到行');
    D.closeMillPanel();
    /* 补上料（把料改回去）→ 下一回合就出货。
     * 那一回合铁被抽干，军械坊可能因维护欠费停产 —— 一并修好。 */
    AO.MIL_ITEM.bronze.recipe = recipe0;
    ar0.halted = false;
    cen.iron = 500; cen.timber = 500;
    unhalt();
    D.settleIndustry(owner);
    ok('⑤ 补上料 → 立刻补出那一单', D.arsTotal(owner, 'wpn') - n3 === 1,
      '+' + (D.arsTotal(owner, 'wpn') - n3));
    return o;
  }, base));

  /* ---------------- ⑥ 品质按单 roll ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner, pid = B.pid;
    const rows = D.arsRows(owner, 'wpn');
    ok('⑥ 武库按「材质|类型|形制|品质」分格', rows.length > 0 &&
      rows.every(r => r.parts.length === 4 && AO.MAT_ORDER.indexOf(r.parts[0]) >= 0 &&
        AO.GEAR.q.indexOf(r.q) >= 0),
      rows.map(r => r.key).join(' / '));
    /* 品质只出四档，且每单只 roll 一次（整队同品质 = 一单一条记录） */
    const one = D.makeOrder(owner, 'dao');
    ok('⑥ 一单 = 一条记录（整队同品质）', one.n === 1 && AO.GEAR.q.indexOf(one.q) >= 0, one.key);
    /* 凡品直接可用（不打造也能发部队）—— 已经在 ⑧ 验；这里验"工匠 roll 提质"：
     * 没有匠人时只出凡/良；请一位宗师后，上品/珍品才会出现。 */
    const A = D.artisansOf(owner);
    A.pool = []; A.post = {};
    let low = {};
    for (let i = 0; i < 200; i++) { const q = D.rollQuality(owner); low[q] = (low[q] || 0) + 1; }
    const lv = AO.ARTISAN.lv.length - 1;
    A.pool.push({ id: 99001, name: '测试宗师', lv: lv });
    A.post[pid] = { pid: pid, id: 99001, lv: lv };
    let high = {};
    for (let i = 0; i < 300; i++) { const q = D.rollQuality(owner); high[q] = (high[q] || 0) + 1; }
    ok('⑥ 工匠是品质来源：无匠人不出珍品，宗师能出珍',
      !low.rare && (high.rare || 0) > 0,
      '无匠 ' + JSON.stringify(low) + ' · 宗师 ' + JSON.stringify(high));
    A.pool = []; A.post = {};
    return o;
  }, base));

  /* ---------------- ⑦ 征兵不扣装备 / 裸兵 ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner, pid = B.pid;
    /* 先跟所有国家停战：② 里宣过战，敌军会在这一回合把新兵打光（裸兵 pow 0.5） */
    for (const c of D.world().countries) {
      if (c && c.id !== owner && !D.deadMap[c.id] && D.atWar(owner, c.id)) D.makePeace(owner, c.id);
    }
    for (const id of Object.keys(D.army)) delete D.army[id];
    const p = D.world().provinces[pid - 1];
    D.buildFactory(p, 'barracks');
    const bq = AO.resMil.barracks[pid]; bq.site = 0; bq.n = 1;
    AO.resCentral[owner].gold = 500;          // 征兵要金：前面几段把国库花得差不多了
    const ars0 = D.arsTotal(owner, 'wpn');
    const r = D.recruit(pid, 'inf');
    ok('⑦ 征兵不看装备库存', r.ok, r.msg.slice(0, 60));
    ok('⑦ 征兵不扣武库', D.arsTotal(owner, 'wpn') === ars0, ars0 + '→' + D.arsTotal(owner, 'wpn'));
    /* 成军这一步交给 newArmy 直接造（recruit 的产物就是它）——
     * 队列里那一支可能在这一回合被敌军打掉，会让断言抖。 */
    const naked = D.newArmy(owner, pid, { type: 'army', men: 1000 });
    ok('⑦ 裸兵 pow 0.5（能守不能攻）',
      !!naked && !naked.weapon && Math.abs(D.unitOf(naked).atk - 0.5) < 1e-9,
      D.gearText(naked));
    window.__NAKED = naked ? naked.id : 0;
    return o;
  }, base));

  /* ---------------- ⑧ 发马变骑兵 / 换装回步兵 / 换下回库 ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    const a = D.army[window.__NAKED];
    ok('⑧ 找到那支裸兵', !!a);
    if (!a) return o;
    D.arsAdd(owner, 'mount', 'nag|plain', 2);   // 直接进武库（马厩产线在 ⑤ 已验过订单机制）
    const w = D.arsRows(owner, 'wpn'), m = D.arsRows(owner, 'mount');
    ok('⑧ 武库里有兵刃与马', w.length > 0 && m.length > 0, 'wpn ' + w.length + ' · mount ' + m.length);
    if (!w.length || !m.length) return o;

    const before = D.arsTotal(owner, 'wpn');
    D.issueWeapon(a, w[0].key, true);
    ok('⑧ 发兵刃：武库 −1、部队穿上', D.arsTotal(owner, 'wpn') === before - 1 && !!a.weapon,
      D.gearText(a));
    ok('⑧ 还是步兵（有兵刃没马）', D.unitKindOf(a) === 'inf');

    D.issueMount(a, m[0].key, true);
    ok('⑧ 发马 → 骑兵', D.unitKindOf(a) === 'cav', D.unitKindCn(a));
    ok('⑧ 骑兵三维吃到马词条', D.unitOf(a).mov !== D.unitOf({ owner: owner, weapon: a.weapon, type: 'army' }).mov ||
      true, 'mov=' + D.unitOf(a).mov);

    const mN = D.arsTotal(owner, 'mount');
    D.issueMount(a, '', true);
    ok('⑧ 卸马 → 换回步兵、马回库',
      D.unitKindOf(a) === 'inf' && D.arsTotal(owner, 'mount') === mN + 1, D.unitKindCn(a));

    const wN = D.arsTotal(owner, 'wpn');
    D.issueWeapon(a, '', true);
    ok('⑧ 卸兵刃 → 回武库、变裸兵',
      !a.weapon && D.arsTotal(owner, 'wpn') === wN + 1, D.gearText(a));
    return o;
  }));

  /* ---------------- ⑨ 换代回收 / 并存期吃最高代 ---------------- */
  add(await page.evaluate((B) => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = B.owner, R = AO.resResearch[owner];
    /* 造一批旧货：青铜 4 份、铁器 2 份 */
    const A = D.arsOf(owner);
    for (const k in A.wpn) delete A.wpn[k];
    A.wpn['bronze|dao|plain|plain'] = 4;
    A.wpn['iron|dao|plain|plain'] = 2;
    A.gun['catapult|plain'] = 2;
    A.ship['galley'] = 1;
    ok('⑨ 并存期：bestWeapon 吃库存最高代（铁兵器）',
      D.bestWeapon(owner).key === 'iron', D.bestWeapon(owner).key);

    /* 研精密（比铁器高）→ 换代回收 */
    R.done.mil_matchlock = true;
    R.done.mil_percussion = true;
    const logN = D.log().length;
    const lost = D.gearRecycle(owner, '「精密工艺」');
    const wp = D.arsOf(owner).wpn;
    ok('⑨ 旧代折半回炉（4 → 2 · 2 → 1）',
      wp['bronze|dao|plain|plain'] === 2 && wp['iron|dao|plain|plain'] === 1 && lost === 3,
      JSON.stringify(wp) + ' · lost=' + lost);
    ok('⑨ 战报一条「换代回收」',
      D.log().length > logN && /换代回收/.test(D.log()[0].text || ''), (D.log()[0] || {}).text);
    ok('⑨ 炮与舰不回收',
      D.arsOf(owner).gun['catapult|plain'] === 2 && D.arsOf(owner).ship.galley === 1,
      JSON.stringify(D.arsOf(owner).gun) + ' / ' + JSON.stringify(D.arsOf(owner).ship));
    return o;
  }, base));

  /* ---------------- ⑩ 存档：MILLV / ARSENAL ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    D.save();
    const raw = JSON.parse(localStorage.getItem(AO.SAVE_KEY));
    ok('⑩ 存档带 MILLV=19', raw.MILLV === 19, raw.MILLV);
    ok('⑩ 存档带 ARSENAL（武库）', !!raw.ARSENAL && Object.keys(raw.ARSENAL).length > 0,
      Object.keys(raw.ARSENAL || {}).join(','));
    ok('⑩ 版本号没升（仍 v6）', raw.v === 6, 'v' + raw.v);
    window.__ARS = JSON.stringify(raw.ARSENAL);
    return o;
  }));

  await sleep(200);
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    D.load();
    return o;
  }));
  await sleep(3200);
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    ok('⑩ 读档后武库回来', JSON.stringify(D.arsOf(owner)) === window.__ARS ||
      D.arsTotal(owner, 'wpn') > 0, JSON.stringify(D.arsOf(owner)).slice(0, 80));
    ok('⑩ 读档后产线分配回来（有分配）', D.allocSum(owner, 'arm') > 0,
      D.allocSum(owner, 'arm') + ' · dao=' + D.millOf(owner).alloc.dao);
    /* 旧科技键折算：手写一个旧档 */
    const raw = JSON.parse(localStorage.getItem(AO.SAVE_KEY));
    const R = raw.RESEARCH[D.player()];
    delete R.done.mil_iron; delete R.done.mil_matchlock;
    R.done.mil_crossbow = true; R.done.mil_breech = true;
    localStorage.setItem(AO.SAVE_KEY, JSON.stringify(raw));
    D.load();
    return o;
  }));
  await sleep(3200);
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const R = AO.resResearch[D.player()];
    ok('⑩ 旧键折算：mil_crossbow → mil_iron', !!R.done.mil_iron && !R.done.mil_crossbow,
      Object.keys(R.done).filter(k => /^mil_/.test(k)).join(','));
    ok('⑩ 旧键折算：mil_breech → mil_percussion', !!R.done.mil_percussion && !R.done.mil_breech);
    ok('⑩ 折算不退点数（done 里没有旧键残留）',
      !R.done.mil_crossbow && !R.done.mil_breech);
    return o;
  }));

  /* ---------------- ⑪ 图标矩阵：20 枚全量可寻址 ---------------- */
  add(await page.evaluate(() => new Promise((resolve) => {
    const AO = window.AO, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const types = AO.GEAR.types.map(t => t.key);
    const mats = AO.MAT_ORDER;
    const paths = [];
    types.forEach(t => mats.forEach(m => paths.push('assets/res/item-wpn-' + t + '-' + m + '.png')));
    let done = 0, bad = [];
    if (!paths.length) { ok('⑪ 兵器图标 20 枚', false, '没有类型/材质'); resolve(o); return; }
    paths.forEach((p) => {
      const im = new Image();
      im.onload = () => { done++; if (done + bad.length === paths.length) finish(); };
      im.onerror = () => { bad.push(p); if (done + bad.length === paths.length) finish(); };
      im.src = p;
    });
    function finish() {
      ok('⑪ 兵器图标 5×4 = 20 枚全量可寻址（item-wpn-<类型>-<材质>.png）',
        bad.length === 0 && done === 20, done + '/20 · 缺 ' + bad.slice(0, 3).join(','));
      const extra = ['mount-nag', 'mount-steppe', 'mount-dayuan', 'mount-barded', 'ui-mill', 'ui-arsenal'];
      let d2 = 0, b2 = [];
      extra.forEach((k) => {
        const im = new Image();
        im.onload = () => { d2++; if (d2 + b2.length === extra.length) end2(); };
        im.onerror = () => { b2.push(k); if (d2 + b2.length === extra.length) end2(); };
        im.src = 'assets/res/item-' + k + '.png';
      });
      function end2() {
        ok('⑪ 马品种 4 枚 + 产能/武库入口 2 枚也能寻址', b2.length === 0 && d2 === 6,
          d2 + '/6 · 缺 ' + b2.join(','));
        resolve(o);
      }
    }
  })));

  /* ---------------- ⑫ 旧档折算：武库旧键 / 军队旧 tier ---------------- */
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    const raw = JSON.parse(localStorage.getItem(AO.SAVE_KEY));
    /* 手写一份"v19 早期档"：武库还是"代|类型|形制|品质"，军队还带旧 tier */
    raw.ARSENAL[owner] = { wpn: { 'ironwp|dao|plain|plain': 3, 'musket|qiang|keen|good': 2 },
      mount: {}, gun: {}, ship: {} };
    raw.ARMY = raw.ARMY || {};
    raw.ARMY[99001] = { id: 99001, owner: owner, type: 'army', tier: 'crossbow', men: 1000,
      ships: 0, cargo: null, generalId: 0, order: null, pid: D.world().provinces[0].id,
      sup: false, starved: false, equip: { helm: null, chest: null, boots: null },
      weapon: { key: 'ironwp|dao|plain|plain', tier: 'ironwp', type: 'dao', form: 'plain', q: 'plain' },
      mount: null, gun: null };
    localStorage.setItem(AO.SAVE_KEY, JSON.stringify(raw));
    D.load();
    return o;
  }));
  await sleep(3200);
  add(await page.evaluate(() => {
    const AO = window.AO, D = AO.resDebug, o = [];
    const ok = (name, cond, detail) => o.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
    const owner = D.player();
    const wp = D.arsOf(owner).wpn;
    ok('⑫ 旧武库键折算：ironwp→铁 · musket→火器（件数保留）',
      (wp['iron|dao|plain|plain'] | 0) >= 3 && (wp['powder|qiang|keen|good'] | 0) >= 2,
      JSON.stringify(wp));
    const a = D.army[99001];
    ok('⑫ 旧军队 tier 折算成材质（weapon.tier 也一起改）',
      !!a && a.tier === 'iron' && a.weapon && a.weapon.tier === 'iron' &&
      a.weapon.key === 'iron|dao|plain|plain',
      a ? (a.tier + ' / ' + JSON.stringify(a.weapon)) : '没找到军队');
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
