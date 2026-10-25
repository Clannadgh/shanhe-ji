/* tools/fog-visual.mjs —— 视觉检查：整幅世界视图下的三态（未测绘 / 泛黄 / 实时）
 * 用法：node tools/fog-visual.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const browser = await puppeteer.launch({ headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.join(root, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => {
  document.getElementById('prov').value = 140;
  document.getElementById('ctry').value = 8;
  document.getElementById('seed').value = 'fog-visual-1';
  document.getElementById('gen').click();
});
await new Promise(r => setTimeout(r, 2800));

const step = await page.evaluate(() => {
  const D = window.AO.resDebug, R = window.__renderer;
  let best = null;
  for (const c of D.world().countries) if (!best || c.provinces.length > best.provinces.length) best = c;
  D.choosePlayer(best.id);
  document.getElementById('country').classList.remove('on');
  /* 关掉国家卡，铺满整幅世界 */
  R.fit();
  R.fogRefresh();
  return { id: best.id, name: best.name, plan: D.fogPlan() };
});
console.log('开局', JSON.stringify(step));
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: path.join(root, 'shots', 'fog-v1-start.png') });

/* 走 12 回合，看"自动织网 + 泛黄" */
await page.evaluate(() => { window.AO.resDebug.fogSetBudget(window.AO.resDebug.player(), 1); });
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => {
    const D = window.AO.resDebug;
    /* 事件弹窗会挡住下一回合：测试里一律选第一个选项 */
    if (D.evtPending && D.evtPending()) D.evtPick(0);
    D.nextTurn();
  });
  await new Promise(r => setTimeout(r, 90));
}
const mid = await page.evaluate(() => {
  const D = window.AO.resDebug;
  const buckets = [0, 0, 0, 0];
  for (let i = 1; i <= D.world().provinces.length; i++) {
    if (D.fogVis(i) === 1) buckets[D.fogBucket(i)]++;
  }
  return { plan: D.fogPlan(), buckets, turn: D.turn() };
});
console.log('12 回合（常规档）', JSON.stringify(mid));
await page.evaluate(() => window.__renderer.fogRefresh());
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(root, 'shots', 'fog-v2-seen.png') });

/* 重金档 + 定向探测一次 */
const probe = await page.evaluate(() => {
  const D = window.AO.resDebug;
  D.fogSetBudget(D.player(), 2);
  const known = D.fogKnown().filter(c => c !== D.player());
  const r = known.length ? D.fogProbe(known[0]) : null;
  window.__renderer.fogRefresh();
  return { known: known.length, r };
});
console.log('定向探测', JSON.stringify(probe));
const after = await page.evaluate(() => {
  const D = window.AO.resDebug;
  const buckets = [0, 0, 0, 0];
  for (let i = 1; i <= D.world().provinces.length; i++) {
    if (D.fogVis(i) === 1) buckets[D.fogBucket(i)]++;
  }
  return { plan: D.fogPlan(), buckets, turn: D.turn() };
});
console.log('探测后', JSON.stringify(after));

/* 断供（预算归零）跑 8 回合：seen 会越来越黄 —— 老地图永远泛黄 */
await page.evaluate(() => { window.AO.resDebug.fogSetBudget(window.AO.resDebug.player(), 0); });
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => {
    const D = window.AO.resDebug;
    if (D.evtPending && D.evtPending()) D.evtPick(0);
    D.nextTurn();
  });
  await new Promise(r => setTimeout(r, 90));
}
const aged = await page.evaluate(() => {
  const D = window.AO.resDebug;
  const buckets = [0, 0, 0, 0];
  for (let i = 1; i <= D.world().provinces.length; i++) {
    if (D.fogVis(i) === 1) buckets[D.fogBucket(i)]++;
  }
  return { plan: D.fogPlan(), buckets, turn: D.turn() };
});
console.log('断供 8 回合后', JSON.stringify(aged));
await page.evaluate(() => window.__renderer.fogRefresh());
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: path.join(root, 'shots', 'fog-v4-aged.png') });

/* 点一个 seen 省：看泛黄省卡 */
const seenCard = await page.evaluate(() => {
  const D = window.AO.resDebug;
  for (let i = 1; i <= D.world().provinces.length; i++) {
    if (D.fogVis(i) === 1) {
      window.__renderer.select(i);
      return { pid: i, name: D.world().provinces[i - 1].name, stale: D.fogStale(i) };
    }
  }
  return null;
});
await new Promise(r => setTimeout(r, 350));
console.log('seen 省卡', JSON.stringify(seenCard), await page.evaluate(() =>
  (document.getElementById('iFogBar') || {}).textContent));
await page.screenshot({ path: path.join(root, 'shots', 'fog-v5-seen-card.png') });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(root, 'shots', 'fog-v3-probe.png') });

await browser.close();
