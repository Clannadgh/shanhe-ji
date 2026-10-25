# -*- coding: utf-8 -*-
"""把"任意来源"的资源图标整理成地图用的精灵 assets/res/item-<key>.png。

放图位置：**assets/res/user/**（默认只认这一个目录，把你自己生图的图丢进去即可）
也可以用参数指定目录：python tools/build-res-icons.py assets/res/raw2
文件名里带 key（iron/gold/grain/horse/timber/fish/salt）或中文
（铁/金/粮食/马/木材/渔获/盐，以及铁锭/木板/麻布袋/盐砖 这些具体形态词）都认。

两种输入自动判断：
  · 已经有透明底（alpha 有 0）→ 只裁边、居中、缩到 96px，颜色不动
  · 不透明（白底/浅色底）→ 边缘泛洪抠底：
      从图边出发，把「浅色」连通区当背景清掉（浅色 = 近白/贴纸白边/淡暖灰阴影），
      被描边包在物体内部的浅色够不到，原样保留；
      之后只保留最大连通体（甩掉影子孤岛、散落颗粒），1px 羽化边缘。

用法：python tools/build-res-icons.py [目录]
"""
import glob
import os
import sys
from collections import deque

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIR = os.path.join(ROOT, 'assets', 'res', 'user')
OUT = os.path.join(ROOT, 'assets', 'res')
SIZE = 96
FILL = 0.9
WORK = 512          # 泛洪在这个分辨率上做，输出只有 96px，足够

# key → 文件名里可能出现的词（长词在前，避免互相抢）
ALIASES = {
    'iron':   ['iron', '铁锭', '铁矿', '铁'],
    'gold':   ['gold', '金锭', '金矿', '金'],
    'grain':  ['grain', '粮食', '麻布袋', '粮袋', '麦穗', '粮', '麦'],
    'horse':  ['horse', '马'],
    'timber': ['timber', '木板', '木材', '原木', '木'],
    'fish':   ['fish', '鱼', '渔'],
    'salt':   ['salt', '盐砖', '盐场', '盐'],
}


def key_of(path):
    name = os.path.basename(path).lower()
    for key, words in ALIASES.items():
        for w in words:
            if w.lower() in name:
                return key
    return None


def bg_candidates(w, rgb):
    """浅色判定：min>=155 且 max-min<=80（近白 + 淡暖灰阴影，饱和色都不命中）。
    155 按实测定的：原木图地面阴影 (231,192,161) 的 min=161，放宽到 155 才兜住；
    马肚皮浅橙 min≈130、铁矿石光晕 spread>100，都在线内不受影响。"""
    cand = bytearray(w * w)
    for i in range(w * w):
        r = rgb[3 * i]
        g = rgb[3 * i + 1]
        b = rgb[3 * i + 2]
        lo = r if r < g else g
        if b < lo:
            lo = b
        hi = r if r > g else g
        if b > hi:
            hi = b
        if lo >= 155 and hi - lo <= 80:
            cand[i] = 1
    return cand


def flood_bg(w, cand):
    """从四边漫过候选像素，返回背景掩膜（1 = 背景）。"""
    bg = bytearray(w * w)
    q = deque()
    for i in range(w):
        for j in (i, (w - 1) * w + i, i * w, i * w + w - 1):
            if cand[j] and not bg[j]:
                bg[j] = 1
                q.append(j)
    while q:
        i = q.popleft()
        x = i % w
        for j in (i - 1 if x > 0 else -1,
                  i + 1 if x < w - 1 else -1,
                  i - w if i >= w else -1,
                  i + w if i < w * (w - 1) else -1):
            if j >= 0 and cand[j] and not bg[j]:
                bg[j] = 1
                q.append(j)
    return bg


def keep_largest(w, fg):
    """前景只留最大连通体。返回 0/255 掩膜。"""
    lab = bytearray(w * w)
    best = []
    for start in range(w * w):
        if fg[start] and not lab[start]:
            comp = []
            lab[start] = 1
            q = deque([start])
            while q:
                i = q.popleft()
                comp.append(i)
                x = i % w
                for j in (i - 1 if x > 0 else -1,
                          i + 1 if x < w - 1 else -1,
                          i - w if i >= w else -1,
                          i + w if i < w * (w - 1) else -1):
                    if j >= 0 and fg[j] and not lab[j]:
                        lab[j] = 1
                        q.append(j)
            if len(comp) > len(best):
                best = comp
    out = bytearray(w * w)
    for i in best:
        out[i] = 255
    return out


def key_out_background(im):
    """不透明底 → 透明：边缘泛洪 + 只留最大连通体。"""
    im = im.convert('RGB').resize((WORK, WORK), Image.LANCZOS)
    cand = bg_candidates(WORK, im.tobytes())
    bg = flood_bg(WORK, cand)
    fg = bytearray(WORK * WORK)
    for i in range(WORK * WORK):
        if not bg[i]:
            fg[i] = 1
    mask = Image.frombytes('L', (WORK, WORK), bytes(keep_largest(WORK, fg)))
    sprite = im.convert('RGBA')
    sprite.putalpha(mask.filter(ImageFilter.GaussianBlur(1)))
    return sprite


def process(src, key):
    im = Image.open(src).convert('RGBA')
    if im.split()[3].getextrema()[0] < 250:
        sprite = im                       # 已有透明底：什么都不抠
    else:
        sprite = key_out_background(im)   # 白底/浅底：泛洪抠底

    alpha = sprite.split()[3]
    box = alpha.point(lambda v: 255 if v > 64 else 0).getbbox()
    if not box:
        raise SystemExit('空图标: ' + src)
    sprite = sprite.crop(box)

    side = max(sprite.size)
    target = int(SIZE * FILL)
    scale = target / side
    w = max(1, round(sprite.width * scale))
    h = max(1, round(sprite.height * scale))
    sprite = sprite.resize((w, h), Image.LANCZOS)

    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(sprite, ((SIZE - w) // 2, (SIZE - h) // 2), sprite)
    dst = os.path.join(OUT, 'item-' + key + '.png')
    canvas.save(dst)
    print('%-7s <- %-38s -> %s' % (key, os.path.basename(src)[:38], os.path.basename(dst)))


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DIR
    src_dir = os.path.abspath(src_dir)
    files = sorted(glob.glob(os.path.join(src_dir, '*.png')) +
                   glob.glob(os.path.join(src_dir, '*.jpg')) +
                   glob.glob(os.path.join(src_dir, '*.jpeg')) +
                   glob.glob(os.path.join(src_dir, '*.webp')))
    if not files:
        print('目录里没有图片:', src_dir)
        print('把你自己生成的 7 张图丢进 assets/res/user/ 再跑一次；')
        print('文件名带 iron/gold/grain/horse/timber/fish/salt 或 铁/金/粮食/马/木材/渔获/盐 都认。')
        return
    seen = {}
    for f in files:
        k = key_of(f)
        if not k:
            print('跳过（认不出是哪种资源）:', os.path.basename(f)[:40])
            continue
        if k in seen:
            print('跳过（重复，保留先出现的）:', os.path.basename(f)[:40])
            continue
        seen[k] = f
    for k in ALIASES:
        if k in seen:
            process(seen[k], k)
        else:
            print('缺图:', k)


if __name__ == '__main__':
    main()
