# tools/make-cover.py —— 把 cover-raw.png + cover-card.png 合成 1600×1200 的参赛封面
# 用法：D:/anaconda/python.exe tools/make-cover.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1600, 1200

SERIF = 'C:/Windows/Fonts/STXINGKA.TTF'        # 华文行楷：标题
SONG = 'C:/Windows/Fonts/STZHONGS.TTF'         # 华文中宋：副标
SANS = 'C:/Windows/Fonts/msyh.ttc'             # 微软雅黑：说明
SANSB = 'C:/Windows/Fonts/msyhbd.ttc'

INK = (253, 248, 238)
INK_DIM = (236, 228, 212)
ACCENT = (176, 73, 47)


def load(p):
    return Image.open(os.path.join(ROOT, p)).convert('RGB')


base = load('shots/cover-raw.png').resize((W, H), Image.LANCZOS)

# ---- 墨色渐变：左上重、右下轻（只压标题那一块，地图本身要透气）----
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
vy = np.clip(1.0 - yy / 720.0, 0.0, 1.0) ** 1.45
vx = np.clip(1.0 - (xx - 260.0) / 1000.0, 0.0, 1.0)
alpha = 232.0 * vy * (0.30 + 0.70 * vx)
mask = Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8), 'L')
dark = Image.new('RGB', (W, H), (17, 23, 29))
base = Image.composite(dark, base, mask)
# 左下也压一点，给"种子 / 回合"那行字留底
vb = np.clip((yy - 1000.0) / 200.0, 0.0, 1.0) ** 1.2
alphab = 150.0 * vb * np.clip(1.0 - (xx - 700.0) / 900.0, 0.0, 1.0)
maskb = Image.fromarray(np.clip(alphab, 0, 255).astype(np.uint8), 'L')
base = Image.composite(dark, base, maskb)

draw = ImageDraw.Draw(base)


def track_text(d, xy, text, font, fill, tracking=0.0, stroke=0, stroke_fill=None):
    x, y = xy
    for ch in text:
        if stroke:
            d.text((x, y), ch, font=font, fill=fill, stroke_width=stroke,
                   stroke_fill=stroke_fill)
        else:
            d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + tracking
    return x


# ---- 标题 ----
f_title = ImageFont.truetype(SERIF, 168)
x_end = track_text(draw, (88, 46), '山河纪', f_title, INK, tracking=16,
                   stroke=4, stroke_fill=(101.0 and (24, 30, 36)))

# 标题下：一条短rule + 方形印章（朱红），像一册书的扉页
rule_y = 250
draw.line([(94, rule_y), (94 + 210, rule_y)], fill=(238, 228, 208), width=2)
draw.line([(94, rule_y + 3), (94 + 210, rule_y + 3)], fill=(24, 30, 36), width=2)
draw.rectangle([94 + 224, rule_y - 11, 94 + 246, rule_y + 11], fill=ACCENT)

# ---- 副标 ----
f_sub = ImageFont.truetype(SONG, 42)
track_text(draw, (92, rule_y + 34), '一个种子，一个世界，一百年', f_sub, INK_DIM,
           tracking=2, stroke=3, stroke_fill=(14, 20, 26))

# ---- 卖点（三小段，用中点隔开，字距放宽）----
f_tag = ImageFont.truetype(SANS, 22)
track_text(draw, (94, rule_y + 108),
           '程序化生成 1100 省 / 64 国', f_tag, (216, 208, 192), tracking=0.6,
           stroke=2, stroke_fill=(14, 20, 26))
track_text(draw, (94 + 322, rule_y + 108),
           '·', f_tag, (170, 162, 148), stroke=2, stroke_fill=(14, 20, 26))
track_text(draw, (94 + 350, rule_y + 108),
           '战争迷雾与情报署', f_tag, (216, 208, 192), tracking=0.6,
           stroke=2, stroke_fill=(14, 20, 26))
track_text(draw, (94 + 562, rule_y + 108),
           '·', f_tag, (140, 132, 118))
track_text(draw, (94 + 590, rule_y + 108),
           '属于你自己的一本编年史', f_tag, (216, 208, 192), tracking=0.6,
           stroke=2, stroke_fill=(14, 20, 26))

# ---- 左下角：这一局的参数 ----
f_small = ImageFont.truetype(SANS, 19)
draw.text((96, H - 68), '种子 shanhe-2026　·　1099 省　·　64 国　·　第 40 回合',
          font=f_small, fill=(212, 205, 190))

# ---- 右下角：泛黄省卡的小插图 ----
card = load('shots/cover-card.png')
cw = 404
ch = int(card.height * cw / card.width)
card = card.resize((cw, ch), Image.LANCZOS)

pad = 10
frame = Image.new('RGB', (cw + pad * 2, ch + pad * 2), (252, 250, 246))
frame.paste(card, (pad, pad))

shadow = Image.new('RGBA', (frame.width + 80, frame.height + 80), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle([40, 44, frame.width + 36, frame.height + 38], radius=16,
                     fill=(0, 0, 0, 150))
shadow = shadow.filter(ImageFilter.GaussianBlur(16))

cx = W - frame.width - 70
cy = H - frame.height - 66
base = base.convert('RGBA')
base.alpha_composite(shadow, (cx - 40, cy - 34))
base.paste(frame, (cx, cy))
draw = ImageDraw.Draw(base)

# 插图上方的一行说明（半透明墨条，直接写"这一版在做什么"）
f_cap = ImageFont.truetype(SANSB, 20)
cap = '看过的省，情报会泛黄'
tw = draw.textlength(cap, font=f_cap)
draw.rectangle([cx - 4, cy - 48, cx + tw + 24, cy - 8], fill=(20, 26, 32, 205))
draw.rectangle([cx - 4, cy - 48, cx - 1, cy - 8], fill=ACCENT)
draw.text((cx + 12, cy - 43), cap, font=f_cap, fill=(242, 224, 176))

# ---- 内框：一圈很淡的暖白线，像纸本的图廓 ----
d2 = ImageDraw.Draw(base)
d2.rectangle([26, 26, W - 27, H - 27], outline=(255, 255, 255, 48), width=2)

out = os.path.join(ROOT, 'shots', 'cover-1600x1200.png')
base.convert('RGB').save(out, 'PNG', optimize=True)
print('saved', out, base.size, os.path.getsize(out) // 1024, 'KB')
