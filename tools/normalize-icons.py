# -*- coding: utf-8 -*-
"""把 tools/gen-res-icons.mjs 截出来的透明底图标裁边、居中、缩到 96px。

和 build-res-icons.py 的区别：那些是 AI 生图（白底/实色底），需要抠底；
矢量图标自带 alpha，这里只做"裁到内容 → 长边归一化 → 居中"，不动颜色。

输出：assets/res/item-<key>.png（RGBA 96px）
"""
import glob
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'res', 'raw-svg')
OUT = os.path.join(ROOT, 'assets', 'res')
SIZE = 96
FILL = 0.92


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.png')))
    if not files:
        raise SystemExit('没有找到 assets/res/raw-svg/*.png，先跑 tools/gen-res-icons.mjs')
    only = set(sys.argv[1:])          # 可选：只处理这几个 key
    for f in files:
        key = os.path.splitext(os.path.basename(f))[0]
        if only and key not in only:
            continue
        im = Image.open(f).convert('RGBA')
        box = im.split()[3].getbbox()
        if not box:
            print('空图:', f)
            continue
        im = im.crop(box)
        side = max(im.size)
        target = int(SIZE * FILL)
        scale = target / side
        w = max(1, round(im.width * scale))
        h = max(1, round(im.height * scale))
        im = im.resize((w, h), Image.LANCZOS)
        canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        canvas.paste(im, ((SIZE - w) // 2, (SIZE - h) // 2), im)
        dst = os.path.join(OUT, 'item-' + key + '.png')
        canvas.save(dst)
        print('%-7s -> %s' % (key, os.path.basename(dst)))


if __name__ == '__main__':
    main()
