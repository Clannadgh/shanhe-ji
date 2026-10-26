/* =============================================================
 * tools/normalize-icons-pup.mjs —— tools/normalize-icons.py 的浏览器版
 *
 * 为什么有这一个：本机 python 没装 Pillow，而图标管线本来就要 puppeteer。
 * 做的事和那份 py 一模一样：裁到 alpha 外框 → 长边缩到 96×0.92 → 居中到
 * 96×96 透明画布 → 写回 assets/res/item-<key>.png。
 *
 * 用法：node tools/normalize-icons-pup.mjs [key ...]（不给 key = 处理全部）
 * ============================================================= */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/21921/.workbuddy/binaries/node/workspace/node_modules/puppeteer');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'assets', 'res', 'raw-svg');
const OUT = path.join(root, 'assets', 'res');
const SIZE = 96;
const FILL = 0.92;

const only = new Set(process.argv.slice(2));
const files = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith('.png'))
  .filter(f => !only.size || only.has(path.basename(f, '.png')));

if (!files.length) {
  console.error('没有找到 assets/res/raw-svg/*.png（先跑 tools/gen-res-icons.mjs）');
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--allow-file-access-from-files', '--disable-gpu', '--no-sandbox']
});
const page = await browser.newPage();
await page.goto('data:text/html,<body></body>', { waitUntil: 'load' });

for (const f of files) {
  const key = path.basename(f, '.png');
  const b64 = fs.readFileSync(path.join(SRC, f)).toString('base64');
  const outB64 = await page.evaluate(async (dataUrl, SIZE, FILL) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c0 = document.createElement('canvas');
    c0.width = img.width; c0.height = img.height;
    const g0 = c0.getContext('2d');
    g0.drawImage(img, 0, 0);
    const d = g0.getImageData(0, 0, img.width, img.height).data;
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (d[(y * img.width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const side = Math.max(cw, ch);
    const target = Math.round(SIZE * FILL);
    const scale = target / side;
    const w = Math.max(1, Math.round(cw * scale));
    const h = Math.max(1, Math.round(ch * scale));
    const c1 = document.createElement('canvas');
    c1.width = SIZE; c1.height = SIZE;
    const g1 = c1.getContext('2d');
    g1.imageSmoothingEnabled = true;
    g1.imageSmoothingQuality = 'high';
    g1.drawImage(c0, x0, y0, cw, ch, Math.round((SIZE - w) / 2), Math.round((SIZE - h) / 2), w, h);
    return c1.toDataURL('image/png').split(',')[1];
  }, 'data:image/png;base64,' + b64, SIZE, FILL);
  if (!outB64) { console.log('空图:', f); continue; }
  fs.writeFileSync(path.join(OUT, 'item-' + key + '.png'), Buffer.from(outB64, 'base64'));
  console.log('normalized', 'item-' + key + '.png');
}
await browser.close();
