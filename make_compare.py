# -*- coding: utf-8 -*-
"""合成最终对比图：基准 / 红点清零 / 最近红点核查。"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))

items = [
    ('shot_base.png', '#7b8794', '基准 · 不避让   15.49 km',
     '100 米走廊内 15 个红点 —— 全程沿立汤路行驶，穿过北京摄像头最密集的路段'),
    ('shot_best.png', '#1e9e63', '红点清零方案   23.34 km（1.51×，不计里程）',
     '100 米走廊内 0 个红点 —— 最近的一个红点也在 114 米外，全程绕开立汤路走廊'),
    ('shot_verify.png', '#c0392b', '核查 · 最近的红点   114 米',
     '放大到「郑平路与北清路交口 北向南」：蓝色带是 100 米走廊，红点明显在走廊之外'),
]

TITLE_H, GAP = 78, 12
W = 1128
imgs = [(Image.open(os.path.join(BASE, f)).convert('RGB'), c, t1, t2) for f, c, t1, t2 in items]
H = GAP + sum(TITLE_H + im.height + GAP for im, *_ in imgs)
canvas = Image.new('RGB', (W + 24, H), '#eef1f6')
d = ImageDraw.Draw(canvas)


def font(sz, bold=False):
    cands = ([r'C:\Windows\Fonts\msyhbd.ttc'] if bold else []) + \
            [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


f1, f2 = font(25, True), font(15)
y = GAP
for im, color, t1, t2 in imgs:
    d.rectangle([0, y, canvas.width, y + TITLE_H], fill=color)
    d.text((26, y + 13), t1, font=f1, fill='#ffffff')
    d.text((26, y + 46), t2, font=f2, fill='#eef3ff')
    canvas.paste(im, (12, y + TITLE_H))
    y += TITLE_H + im.height + GAP

out = os.path.join(BASE, '避让方案对比.png')
canvas.save(out, quality=93)
print('已生成:', out, canvas.size)
