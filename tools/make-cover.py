# tools/make-cover.py —— 把 cover-raw.png + cover-card.png 合成 1600×1200 的参赛封面
# 用法：D:/anaconda/python.exe tools/make-cover.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1600, 1200

SERIF = 'C:/Windows/Fonts/STXINGKA.TTF'        # 华文行楷：标题
SONG = 'C:/Windows/Fonts/STZHONGS.TTF'         # 华文中宋：副标
SANS = 'C:/Windows/Fonts/msyh.ttc'             # 微软雅黑：说明
SANSB = 'C:/Windows/Fonts/msyhbd.ttc'

INK = (253, 248, 238)
INK_DIM = (238, 230, 214)


def load(p):
    return Image.open(os.path.join(ROOT, p)).convert('RGB')


base = load('shots/cover-raw.png').resize((W, H), Image.LANCZOS)

# ---- 顶部压暗，给标题留出可读性（不是纯黑块，是一道"墨"渐变）----
shade = Image.new('L', (1, H), 0)
for y in range(560):
    v = int(215 * (1 - y / 560) ** 1.55)
    shade.putpixel((0, y), v)
mask = shade.resize((W, H))
dark = Image.new('RGB', (W, H), (18, 24, 30))
base = Image.composite(dark, base, mask)

draw = ImageDraw.Draw(base)


def track_text(d, xy, text, font, fill, tracking=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        w = d.textlength(ch, font=font)
        x += w + tracking
    return x


# ---- 标题 ----
f_title = ImageFont.truetype(SERIF, 150)
x = 92
y = 62
x = track_text(draw, (x, y), '山河纪', f_title, INK, tracking=18)

# 标题下的一道细线（从标题末端拖到右边）
draw.rectangle([x + 26, y + 96, x + 26, y + 100], fill=INK)
line_y = y + 98
draw.line([(x + 26, line_y), (x + 300, line_y)], fill=(INK[0], INK[1], INK[2], 255), width=2)

# 副标
f_sub = ImageFont.truetype(SONG, 40)
track_text(draw, (96, y + 132), '一个种子，一个世界，一百年', f_sub, INK_DIM, tracking=3)

# 一行卖点
f_tag = ImageFont.truetype(SANS, 23)
track_text(draw, (98, y + 204),
           '程序化生成 1100 省 / 64 国　·　战争迷雾与情报署　·　你自己的一本编年史',
           f_tag, (206, 198, 182), tracking=1)

# ---- 左下角：种子信息 ----
f_small = ImageFont.truetype(SANS, 19)
draw.text((98, H - 62), '种子 shanhe-2026　·　1099 省　·　64 国　·　第 40 回合',
          font=f_small, fill=(214, 208, 194))

# ---- 右下角：泛黄省卡的小插图 ----
card = load('shots/cover-card.png')
cw = 372
ch = int(card.height * cw / card.width)
card = card.resize((cw, ch), Image.LANCZOS)

pad = 10
frame = Image.new('RGB', (cw + pad * 2, ch + pad * 2), (252, 250, 246))
frame.paste(card, (pad, pad))

shadow = Image.new('RGBA', (frame.width + 60, frame.height + 60), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle([30, 34, frame.width + 26, frame.height + 30], radius=14,
                     fill=(0, 0, 0, 130))
shadow = shadow.filter(ImageFilter.GaussianBlur(14))

cx = W - frame.width - 74
cy = H - frame.height - 74
base = base.convert('RGBA')
base.alpha_composite(shadow, (cx - 30, cy - 26))
base.paste(frame, (cx, cy))
draw = ImageDraw.Draw(base)

# 插图说明（贴在卡片上方）
f_cap = ImageFont.truetype(SANSB, 19)
cap = '情报截止第 16 回合 · 陈旧 24 回合'
tw = draw.textlength(cap, font=f_cap)
draw.rectangle([cx - 6, cy - 44, cx + tw + 18, cy - 8], fill=(20, 26, 32, 190))
draw.text((cx + 6, cy - 40), cap, font=f_cap, fill=(242, 224, 176))

# ---- 内框：一圈很淡的暖白线，像纸本的图廓 ----
d2 = ImageDraw.Draw(base)
d2.rectangle([26, 26, W - 27, H - 27], outline=(255, 255, 255, 46), width=2)

out = os.path.join(ROOT, 'shots', 'cover-1600x1200.png')
base.convert('RGB').save(out, 'PNG', optimize=True)
print('saved', out, base.size, os.path.getsize(out) // 1024, 'KB')
