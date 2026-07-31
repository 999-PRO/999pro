#!/usr/bin/env python3
"""Generate iOS apple-touch-startup-image (splash screens) + PWA screenshots.

iOS requires per-device splash images. We generate a brand splash for the
most common iOS device classes — solid #2563eb background with a centered
white "999 PRO" mark — and equivalent Android screenshots for the manifest.

These are minimal placeholders; for production you should replace them with
real screenshots of the actual app.
"""
import struct
import zlib
import os
from pathlib import Path

OUT_DIR = Path('/home/z/my-project/public/icons')
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Brand colours
BG = (0x25, 0x63, 0xeb)  # #2563eb brand blue
FG = (0xff, 0xff, 0xff)  # white

# iOS splash sizes (most common, modern iPhones + iPads).
# Apple will scale the closest available image, so covering these is enough
# for a decent splash on >95% of in-use devices.
IOS_SPLASHES = [
    # iPhone 16 Pro Max / 15 Plus / 14 Plus (1242x2688)
    ('apple-splash-1242x2688.png', 1242, 2688),
    # iPhone 16 Pro / 15 Pro / 14 Pro / 13 Pro / 12 Pro (1170x2532)
    ('apple-splash-1170x2532.png', 1170, 2532),
    # iPhone 8 Plus / 7 Plus / 6s Plus (1242x2208)
    ('apple-splash-1242x2208.png', 1242, 2208),
    # iPhone 16 / 15 / 14 / 13 / 12 / 11 / XR (828x1792)
    ('apple-splash-828x1792.png', 828, 1792),
    # iPhone 8 / 7 / 6s / SE (750x1334)
    ('apple-splash-750x1334.png', 750, 1334),
    # iPad Pro 12.9" (2048x2732)
    ('apple-splash-2048x2732.png', 2048, 2732),
    # iPad Pro 11" / 10.5" / iPad 10.2" (1668x2388)
    ('apple-splash-1668x2388.png', 1668, 2388),
    # iPad mini (1536x2048)
    ('apple-splash-1536x2048.png', 1536, 2048),
]

# Android screenshots for manifest.screenshots
ANDROID_SCREENSHOTS = [
    ('screenshot-phone-1.png', 1080, 1920, 'Каталог товаров'),
    ('screenshot-phone-2.png', 1080, 1920, 'Чат с продавцом'),
    ('screenshot-tablet-1.png', 1920, 1080, 'Лента публикаций'),
]


def make_png(width: int, height: int, pixels: list[tuple[int, int, int]]) -> bytes:
    """Build a minimal PNG (RGB, no alpha) from a pixel list."""
    # PNG signature
    out = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    out += b'IHDR' + ihdr
    out += struct.pack('>I', len(ihdr))
    out += ihdr
    out += struct.pack('>I', zlib.crc32(b'IHDR' + ihdr) & 0xffffffff)

    # IDAT chunk — raw scanlines (filter byte 0 + RGB triplets)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type: none
        row_start = y * width
        for x in range(width):
            r, g, b = pixels[row_start + x]
            raw.append(r)
            raw.append(g)
            raw.append(b)
    idat = zlib.compress(bytes(raw), 9)
    out += b'IDAT' + idat
    out += struct.pack('>I', len(idat))
    out += idat
    out += struct.pack('>I', zlib.crc32(b'IDAT' + idat) & 0xffffffff)

    # IEND chunk
    out += b'IEND' + b''
    out += struct.pack('>I', 0)
    out += struct.pack('>I', zlib.crc32(b'IEND') & 0xffffffff)

    return out


def draw_splash(width: int, height: int) -> list[tuple[int, int, int]]:
    """Brand-blue background with a centered white disc + 3 stripes (logo mark)."""
    pixels = [BG] * (width * height)
    cx, cy = width // 2, height // 2
    # White disc
    disc_r = min(width, height) // 6
    disc_r2 = disc_r * disc_r
    # Three vertical stripes inside the disc (suggesting "999" without text)
    stripe_w = max(8, disc_r // 4)
    stripe_offsets = [-disc_r // 2 - stripe_w // 2, -stripe_w // 2, disc_r // 2 - stripe_w // 2]
    for y in range(height):
        for x in range(width):
            dx = x - cx
            dy = y - cy
            d2 = dx * dx + dy * dy
            if d2 <= disc_r2:
                # Inside disc — white, unless in a stripe (which stays blue)
                in_stripe = False
                for off in stripe_offsets:
                    if off <= dx <= off + stripe_w:
                        in_stripe = True
                        break
                pixels[y * width + x] = BG if in_stripe else FG
    return pixels


def draw_screenshot(width: int, height: int, label: str) -> list[tuple[int, int, int]]:
    """Light-grey background with a coloured header bar — placeholder screenshot."""
    header_color = BG
    body_color = (0xf8, 0xf8, 0xf8)  # near-white body
    card_color = (0xff, 0xff, 0xff)
    pixels = [body_color] * (width * height)
    header_h = max(120, height // 8)
    # Header
    for y in range(header_h):
        for x in range(width):
            pixels[y * width + x] = header_color
    # Cards (3 vertical cards in the body)
    card_margin = max(40, width // 20)
    card_h = max(180, height // 6)
    card_w = width - 2 * card_margin
    card_y = header_h + card_margin
    for i in range(3):
        y0 = card_y + i * (card_h + card_margin // 2)
        if y0 + card_h >= height:
            break
        for y in range(y0, y0 + card_h):
            for x in range(card_margin, card_margin + card_w):
                pixels[y * width + x] = card_color
        # Card accent bar (left edge, blue)
        accent_w = max(8, width // 80)
        for y in range(y0, y0 + card_h):
            for x in range(card_margin, card_margin + accent_w):
                pixels[y * width + x] = header_color
    return pixels


def main():
    print(f'Output directory: {OUT_DIR}')
    for name, w, h in IOS_SPLASHES:
        pixels = draw_splash(w, h)
        data = make_png(w, h, pixels)
        (OUT_DIR / name).write_bytes(data)
        print(f'  iOS splash: {name}  ({w}x{h}, {len(data):,} bytes)')
    for name, w, h, label in ANDROID_SCREENSHOTS:
        pixels = draw_screenshot(w, h, label)
        data = make_png(w, h, pixels)
        (OUT_DIR / name).write_bytes(data)
        print(f'  Screenshot: {name}  ({w}x{h}, {len(data):,} bytes) — {label}')


if __name__ == '__main__':
    main()
