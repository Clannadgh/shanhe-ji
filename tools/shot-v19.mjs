/* 一次性验收截图（v19 制造工艺）：产能面板 + 武库面板
 * 跑法：node tools/shot-v19.mjs
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
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(1200);
await page.evaluate(() => {
  document.getElementById('prov').value = 260;
  document.getElementById('ctry').value = 10;
  document.getElementById('seed').value = 'craft-shot-1';
  document.getElementById('gen').click();
});
await sleep(2600);
await page.evaluate(() => {
  const AO = window.AO, D = AO.resDebug, w = D.world();
  let pid = 0, owner = 0;
  for (const p of w.provinces) {
    const bag = AO.resSim[p.id];
    if (!bag || !bag.iron || !bag.iron.built) continue;
    pid = p.id; owner = p.owner; break;
  }
  D.choosePlayer(owner);
  /* 研到铁器：产能面板的兵刃行才会写「刀（铁）」并套铁色图标 */
  const R = AO.resResearch[owner];
  R.done.mil_bronze = true; R.done.mil_iron = true;
  const p = w.provinces[pid - 1];
  D.buildFactory(p, 'armory');
  const ar = AO.resMil.armory[pid]; ar.site = 0; ar.n = 4;
  const fb = AO.resMil.factory[pid]; if (fb) { fb.n = 1; fb.site = 0; }
  /* 一点存货，武库面板才不空 */
  const A = D.arsOf(owner);
  /* v19 返工：键的第一段是**材质**（铁/青铜/火器），不再是"代" */
  A.wpn['iron|dao|keen|good'] = 3;
  A.wpn['iron|fu|heavy|plain'] = 1;
  A.wpn['powder|gong|swift|fine'] = 2;
  A.wpn['bronze|qiang|plain|plain'] = 4;
  A.mount['nag|plain'] = 6;
  A.mount['barded|good'] = 2;
  A.gun['catapult|plain'] = 2;
  A.ship['galley'] = 1;
  const inv = D.equipOf(owner);
  inv.helm.good = 8; inv.chest.fine = 4; inv.boots.plain = 12;
  D.setLineAlloc(owner, 'dao', 5, true);
  D.setLineAlloc(owner, 'gong', 3, true);
  D.setLineAlloc(owner, 'helm', 5, true);
  D.setLineAlloc(owner, 'catapult', 2, true);
  D.setLineAlloc(owner, 'nag', 5, true);
  D.setLineAlloc(owner, 'galley', 1, true);
  D.millOf(owner).form.dao = 'keen';
  /* 一支有装备的军队，一支裸兵 */
  const a1 = D.newArmy(owner, pid, { type: 'army', men: 3000 });
  D.issueWeapon(a1, 'iron|dao|keen|good', true);
  D.issueMount(a1, 'barded|good', true);
  D.equipArmy(a1, 'helm', 'good', true);
  D.newArmy(owner, pid, { type: 'army', men: 1000 });
  D.openMillPanel();
});
await sleep(600);
await page.screenshot({ path: path.join(root, 'shots', 'v19-mill.png') });
await page.evaluate(() => { window.AO.resDebug.closeMillPanel(); window.AO.resDebug.openArsPanel(); });
await sleep(600);
await page.screenshot({ path: path.join(root, 'shots', 'v19-arsenal.png') });

/* 第三张：兵器矩阵（5 类型 × 4 材质）—— 形状 × 颜色分离的那张总表 */
const p2 = await browser.newPage();
await p2.setViewport({ width: 520, height: 700, deviceScaleFactor: 2 });
await p2.goto('file://' + path.join(root, 'tools', 'res-icons.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await sleep(500);
const box = await p2.evaluate(() => {
  const r = document.getElementById('wpn-matrix').getBoundingClientRect();
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width + 24, 520), height: Math.min(r.height + 16, 700) };
});
await p2.screenshot({ path: path.join(root, 'shots', 'v19-wpn-matrix.png'), clip: box });
await browser.close();
console.log('ok');
