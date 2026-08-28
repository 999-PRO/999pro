#!/usr/bin/env python3
"""Generate 4 vertical story posters (1080x1920 PNG) into public/uploads/stories/.
Cyrillic-safe: DejaVu Sans Bold. Gradients + big typography, brand style 999PRO."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os, math

OUT = '/home/z/my-project/public/uploads/stories'
os.makedirs(OUT, exist_ok=True)
W, H = 1080, 1920

FONTS = {
    'black': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'reg': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
}

def font(sz, which='black'):
    return ImageFont.truetype(FONTS[which], sz)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(c1, c2):
    img = Image.new('RGB', (W, H))
    px = img.load()
    for y in range(H):
        c = lerp(c1, c2, y / H)
        for x in range(W):
            px[x, y] = c
    return img

def diag_grad(c1, c2, c3):
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    step = 24
    for i in range(0, W + H + step, step):
        t = i / (W + H)
        col = lerp(c1, c2, min(t / 0.6, 1)) if t < 0.6 else lerp(c2, c3, (t - 0.6) / 0.4)
        d.polygon([(i - 200, 0), (i + 200, 0), (i - H + 200, H), (i - H - 200, H)], fill=col)
    return img

def glow_blobs(img, blobs):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for (cx, cy, r, col, alpha) in blobs:
        for i in range(int(r / 6)):
            rr = r - i * 6
            a = int(alpha * (1 - i / (r / 6)))
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col + (a,))
    layer = layer.filter(ImageFilter.GaussianBlur(40))
    img.paste(layer, (0, 0), layer)
    return img

def text_center(d, y, s, f, fill, ls=0):
    if ls:
        total = sum(d.textlength(ch, font=f) + ls for ch in s) - ls
    else:
        total = d.textlength(s, font=f)
    x = (W - total) / 2
    if ls:
        for ch in s:
            d.text((x, y), ch, font=f, fill=fill)
            x += d.textlength(ch, font=f) + ls
    else:
        d.text((x, y), s, font=f, fill=fill)

def rounded(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

# ---------- 1. Акция: СКИДКИ ДО −40% ----------
img = diag_grad((244, 63, 94), (249, 115, 22), (251, 191, 36))
img = glow_blobs(img, [(200, 380, 320, (255, 220, 160), 90), (880, 1500, 360, (255, 240, 200), 70)])
d = ImageDraw.Draw(img)
text_center(d, 300, '999PRO', font(64), (255, 255, 255, 255), ls=18)
d.rectangle([140, 430, W - 140, 436], fill=(255, 255, 255))
text_center(d, 560, 'СКИДКИ', font(190), (255, 255, 255))
text_center(d, 800, 'ДО −40%', font(150), (255, 244, 214))
rounded(d, (240, 1090, W - 240, 1300), 105, outline=(255, 255, 255), width=8)
text_center(d, 1140, 'летняя', font(72, 'reg'), (255, 255, 255))
text_center(d, 1420, 'распродажа', font(72, 'reg'), (255, 255, 255))
text_center(d, 1650, '999.pro · успей до конца месяца', font(40, 'reg'), (255, 250, 235))
img.save(f'{OUT}/sale-40.jpg', quality=88)

# ---------- 2. Новости: НОВИНКИ КАТАЛОГА ----------
img = diag_grad((56, 130, 246), (59, 130, 246), (99, 102, 241))
img = glow_blobs(img, [(880, 420, 300, (140, 200, 255), 90), (220, 1560, 340, (170, 180, 255), 80)])
d = ImageDraw.Draw(img)
text_center(d, 330, 'НОВОЕ', font(170), (255, 255, 255))
text_center(d, 560, 'В КАТАЛОГЕ', font(96), (222, 240, 255))
# product cards motif
for i, y in enumerate((900, 1090, 1280)):
    rounded(d, (200 + (i % 2) * 60, y, W - 200 - ((i + 1) % 2) * 60, y + 150), 40, fill=(255, 255, 255, 30), outline=(255, 255, 255), width=4)
    d.ellipse([240 + (i % 2) * 60, y + 35, 320 + (i % 2) * 60, y + 115], fill=(255, 255, 255))
    rounded(d, (360 + (i % 2) * 60, y + 45, W - 280 + (i % 2) * 60, y + 70), 12, fill=(255, 255, 255))
    rounded(d, (360 + (i % 2) * 60, y + 90, W - 420 + (i % 2) * 60, y + 108), 9, fill=(210, 230, 255))
text_center(d, 1560, 'каждую неделю — что-то новое', font(44, 'reg'), (230, 242, 255))
text_center(d, 1660, '999.pro', font(56), (255, 255, 255), ls=10)
img.save(f'{OUT}/new-catalog.jpg', quality=88)

# ---------- 3. Мастер-класс: печать на футболках ----------
img = diag_grad((124, 58, 237), (192, 38, 211), (236, 72, 153))
img = glow_blobs(img, [(240, 460, 300, (250, 200, 255), 85), (900, 1450, 330, (255, 180, 230), 75)])
d = ImageDraw.Draw(img)
text_center(d, 300, 'МАСТЕР-КЛАСС', font(86), (255, 255, 255), ls=8)
text_center(d, 470, 'печать', font(120), (255, 240, 252))
text_center(d, 650, 'на футболках', font(96), (250, 220, 255))
# t-shirt
cx, cy = W // 2, 1150
d.polygon([(cx - 250, cy - 200), (cx - 110, cy - 280), (cx + 110, cy - 280), (cx + 250, cy - 200),
           (cx + 180, cy - 60), (cx + 120, cy - 100), (cx + 120, cy + 260), (cx - 120, cy + 260),
           (cx - 120, cy - 100), (cx - 180, cy - 60)], fill=(255, 255, 255))
d.ellipse([cx - 95, cy - 305, cx + 95, cy - 215], fill=(90, 30, 160))
d.polygon([(cx - 95, cy - 262), (cx - 110, cy - 280), (cx + 110, cy - 280), (cx + 95, cy - 262),
           (cx + 60, cy - 225), (cx - 60, cy - 225)], fill=(230, 205, 255))
text_center(d, cy - 60, 'LOVE', font(90), (214, 60, 140))
text_center(d, cy + 70, 'PRINT', font(60), (120, 60, 200))
text_center(d, 1620, 'суббота · 15:00 · студия 999PRO', font(42, 'reg'), (255, 235, 250))
img.save(f'{OUT}/masterclass.jpg', quality=88)

# ---------- 4. Команда 999PRO ----------
img = vgrad((17, 24, 39), (30, 41, 59))
img = glow_blobs(img, [(540, 300, 320, (80, 120, 255), 60), (540, 1650, 380, (250, 190, 80), 45)])
d = ImageDraw.Draw(img)
text_center(d, 300, 'НАША', font(150), (255, 255, 255))
text_center(d, 500, 'КОМАНДА', font(150), (253, 200, 90))
avatars = [(540, 900), (300, 1130), (780, 1130), (540, 1360)]
cols = [(244, 114, 182), (56, 189, 248), (52, 211, 153), (251, 146, 60)]
inits = ['M', 'D', 'K', 'I']
for (ax, ay), col, ch in zip(avatars, cols, inits):
    for i in range(14):
        rr = 110 - i * 4
        a = int(255 * (i / 14))
        d.ellipse([ax - rr, ay - rr, ax + rr, ay + rr], fill=col + (a,))
    d.ellipse([ax - 96, ay - 96, ax + 96, ay + 96], fill=(25, 33, 48))
    f = font(84)
    tw = d.textlength(ch, font=f)
    d.text((ax - tw / 2, ay - 62), ch, font=f, fill=col)
text_center(d, 1580, 'реклама · печать · дизайн · мебель', font(44, 'reg'), (200, 210, 230))
text_center(d, 1680, '999.pro', font(56), (255, 255, 255), ls=10)
img.save(f'{OUT}/team.jpg', quality=90)

print('OK:', os.listdir(OUT))
