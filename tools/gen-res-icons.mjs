/* =============================================================
 * tools/gen-res-icons.mjs —— 把 tools/res-icons.html 里的 7 个矢量图标
 * 截成 assets/res/item-<key>.png（透明底，192px，之后由
 * tools/normalize-icons.py 裁边缩到 96px）。
 *
 * 用矢量而不是 AI 生图：不花积分、20~30px 下比写实图更认得出、
 * 描边和地图的墨线是同一个色（#2b3238）。
 *
 * 用法：node tools/gen-res-icons.mjs
 * ============================================================= */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const OUT = path.join(root, 'assets', 'res', 'raw-svg');
const KEYS = [
  'iron', 'gold', 'grain', 'horse', 'timber', 'fish', 'salt',
  // 已开发形态：同一套画法，画"开发之后变成什么"（铁锭/金锭/粮袋/木板/盐砖/渔获/备鞍马）
  'iron-dev', 'gold-dev', 'grain-dev', 'horse-dev', 'timber-dev', 'fish-dev', 'salt-dev',
  // 建筑形态：开发这块地要盖的东西（矿场/农场/牧场/伐木场/渔港/盐场）
  'iron-bld', 'gold-bld', 'grain-bld', 'horse-bld', 'timber-bld', 'fish-bld', 'salt-bld',
  // 物流
  'freight-bld',
  // 建筑 Lv2（升级后是另一个东西）
  'iron-bld-2', 'gold-bld-2', 'grain-bld-2', 'horse-bld-2',
  'timber-bld-2', 'fish-bld-2', 'salt-bld-2',
  // 通用设施（市场 / 建造坊）
  'market-bld', 'builder-bld',
  // 全局科技（for:null 那四条，树节点上单独一张图）
  'tech-ledger', 'tech-gauge', 'tech-road', 'tech-apprent',
  // 治理层（v2）：官员（乌纱帽）/ 科举（考卷+毛笔）
  'official', 'exam',
  // 战争层（v3）：五座装备厂（兵营 / 军械坊 / 驯马场 / 铸炮厂 / 造船厂）
  'barracks-bld', 'armory-bld', 'stable-bld', 'foundry-bld', 'shipyard-bld',
  // 城墙（城防值）：一段带雉堞的墙
  'wall-bld',
  // 内政批：粮仓（高脚谷仓）/ 工厂（烟囱厂房）/ 大学（穹顶柱式）
  'granary-bld', 'factory-bld', 'university-bld',
  // 军事科技（v4）：17 条军事科技 + 皮甲（皮甲无科技键，图给军械坊订单/装备行大尺寸处用）。
  // id 命名 tech-<tech key>，normalize 自动落成 item-tech-<key>.png —— techIcon 的
  // PNG 回退链找的就是这个名字，不需要额外映射表
  'tech-leather', 'tech-mil_bronze', 'tech-mil_iron', 'tech-mil_crossbow',
  'tech-mil_matchlock', 'tech-mil_musket', 'tech-mil_flintlock', 'tech-mil_percussion',
  'tech-mil_breech', 'tech-mil_gw', 'tech-mil_catapult', 'tech-mil_bronze_gun',
  'tech-mil_field_gun', 'tech-mil_heavy_gun', 'tech-mil_galley', 'tech-mil_galleon',
  'tech-mil_ship74', 'tech-mil_ironclad'
];

fs.mkdirSync(OUT, { recursive: true });

const ONLY = new Set(process.argv.slice(2));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--no-sandbox']
});
const page = await browser.newPage();
// dpr 2 → 96px 的 svg 截出 192px，够清晰又不臃肿
await page.setViewport({ width: 900, height: 200, deviceScaleFactor: 2 });
await page.goto('file://' + path.join(here, 'res-icons.html').replace(/\\/g, '/'), { waitUntil: 'load' });

for (const key of KEYS) {
  /* 可选：命令行只传一部分 key（改一套图时别把别的图一起重截一遍）
   *   node tools/gen-res-icons.mjs grain-bld-2 horse-bld-2 ... */
  if (ONLY.size && !ONLY.has(key)) continue;
  const el = await page.$('#' + key);
  if (!el) { console.log('缺图标:', key); continue; }
  const file = path.join(OUT, key + '.png');
  await el.screenshot({ path: file, omitBackground: true });
  console.log('saved', path.relative(root, file));
}

await browser.close();
