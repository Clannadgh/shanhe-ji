# -*- coding: utf-8 -*-
"""把 assets/res/raw/ 里生成的字图整理成地图用的字形精灵。

生成的图是「黑墨 + 白底」（个别是透明底），这里统一成：
  白底按亮度抠成 alpha（墨越黑越不透明），裁到字形包围盒，
  按长边归一化后居中放进正方形，缩到 96px。
输出：assets/res/<key>.png（RGBA，黑墨 + 透明底）。

用法：python tools/build-res-glyphs.py
"""
import glob
import os
from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets', 'res', 'raw')
OUT = os.path.join(ROOT, 'assets', 'res')
SIZE = 96
FILL = 0.88          # 字形长边占画布比例
FLOOR = 40           # 抠底阈值（反相亮度，0~255）

# key → 汉字（与 js/15-resources.js 的 RESOURCES 表一致）
CHARS = {
    'iron': '铁', 'gold': '金', 'grain': '粮', 'horse': '马',
    'timber': '木', 'fish': '渔', 'salt': '盐',
}

def key_of(path):
    name = os.path.basename(path)
    for k, cn in CHARS.items():
        if cn in name:
            return k
    return None

def process(src, key):
    im = Image.open(src).convert('RGBA')
    lum = im.convert('L')
    src_a = im.split()[3]
    # 墨量 = 反相亮度；再乘上原图 alpha（透明底也安全：白底图 alpha 全 255）
    ink = ImageChops.multiply(ImageChops.invert(lum), src_a)
    # 抠底：有的生成图把「透明棋盘格」直接烘进了 RGB（马那张是 221/243 两种灰），
    # 反相后留下 12~34 的噪声。低于 FLOOR 的一律清零，其余按剩余量程拉满，
    # 这样既杀掉棋盘格，又保留笔画边缘的抗锯齿。
    ink = ink.point(lambda v: 0 if v <= FLOOR else min(255, int((v - FLOOR) * 255 / (255 - FLOOR))))

    glyph = Image.new('RGBA', im.size, (0, 0, 0, 0))
    glyph.putalpha(ink)
    # 包围盒另用一张硬阈值掩膜取：软 alpha 里还留着棋盘格的余量（十几灰阶），
    # 直接 getbbox() 会把整张图框进去，字形就被缩得偏小。
    mask = ink.point(lambda v: 255 if v > 96 else 0)
    box = mask.getbbox()
    if not box:
        raise SystemExit('空字形: ' + src)
    glyph = glyph.crop(box)

    side = max(glyph.size)
    target = int(SIZE * FILL)
    scale = target / side
    w = max(1, round(glyph.width * scale))
    h = max(1, round(glyph.height * scale))
    glyph = glyph.resize((w, h), Image.LANCZOS)

    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(glyph, ((SIZE - w) // 2, (SIZE - h) // 2), glyph)
    dst = os.path.join(OUT, key + '.png')
    canvas.save(dst)
    print('%-7s <- %-10s bbox=%s -> %s' % (key, os.path.basename(src)[:6], box, os.path.basename(dst)))

def main():
    files = sorted(glob.glob(os.path.join(RAW, '*.png')))
    if not files:
        raise SystemExit('没有找到 assets/res/raw/*.png')
    seen = set()
    for f in files:
        k = key_of(f)
        if not k:
            print('跳过（认不出汉字）:', os.path.basename(f))
            continue
        if k in seen:
            print('跳过（重复）:', os.path.basename(f))
            continue
        seen.add(k)
        process(f, k)
    missing = set(CHARS) - seen
    if missing:
        print('缺图:', ', '.join(sorted(missing)))

if __name__ == '__main__':
    main()
