# -*- coding: utf-8 -*-
"""把 AI 生成的插画（RGB，背景是画出来的棋盘格 + 撕边纹理）处理成透明底 PNG。

思路：棋盘格的两种底色都是「暖白/浅灰」且低饱和，据此构造背景判定，
再用扫描线（span）填充从画布四边连通的背景区域，最后收缩 1px + 羽化去白边。
"""
import glob, os
from PIL import Image, ImageFilter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(BASE, 'assets')
src = glob.glob(os.path.join(ASSETS, 'Q版*.png'))[0]
print('src:', os.path.basename(src))

im = Image.open(src).convert('RGB')
w, h = im.size
px = im.tobytes()

MIN_CH = 204      # 背景最暗通道下限
MAX_SPREAD = 34   # 背景最大通道差（低饱和）

isbg = bytearray(w * h)
for i in range(w * h):
    r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]
    mx = r if r > g else g
    if b > mx: mx = b
    mn = r if r < g else g
    if b < mn: mn = b
    if mn >= MIN_CH and mx - mn <= MAX_SPREAD:
        isbg[i] = 1

filled = bytearray(w * h)
stack = []
for x in range(w):
    for y in (0, h - 1):
        if isbg[y * w + x]:
            stack.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if isbg[y * w + x]:
            stack.append((x, y))

while stack:
    x, y = stack.pop()
    idx = y * w + x
    if filled[idx] or not isbg[idx]:
        continue
    x1 = x
    while x1 > 0 and isbg[y * w + x1 - 1] and not filled[y * w + x1 - 1]:
        x1 -= 1
    x2 = x
    while x2 < w - 1 and isbg[y * w + x2 + 1] and not filled[y * w + x2 + 1]:
        x2 += 1
    base = y * w
    for i in range(x1, x2 + 1):
        filled[base + i] = 1
    for ny in (y - 1, y + 1):
        if 0 <= ny < h:
            nb = ny * w
            for i in range(x1, x2 + 1):
                if isbg[nb + i] and not filled[nb + i]:
                    stack.append((i, ny))

alpha = Image.frombytes('L', (w, h), bytes(255 if not f else 0 for f in filled))
alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))

out = im.convert('RGBA')
out.putalpha(alpha)

bbox = out.getbbox()
if bbox:
    pad = 6
    out = out.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                    min(w, bbox[2] + pad), min(h, bbox[3] + pad)))

dst = os.path.join(ASSETS, 'master.png')
out.save(dst, optimize=True)

ratio = 100.0 * sum(filled) / (w * h)
print('transparent %.1f%% | out: %s %s %s' % (ratio, os.path.basename(dst), out.size, out.mode))

# 预览图（洋红底，方便肉眼检查残留）
bg = Image.new('RGB', out.size, (255, 0, 255))
bg.paste(out, (0, 0), out)
bg.resize((out.width // 2, out.height // 2)).save(os.path.join(BASE, 'tools', '_preview.jpg'), quality=88)
print('preview: tools/_preview.jpg')
