#!/usr/bin/env python3
"""
999 PRO — Mobile app icon generator
====================================
Takes the uploaded "999" logo and generates all the mobile app icon sizes
needed for iOS and Android:
  - 1024×1024 — App Store / Google Play hero icon
  - 512×512   — PWA icon, Google Play listing
  - 192×192   — PWA icon (Android)
  - 180×180   — iOS apple-touch-icon (iPhone)
  - 167×167   — iPad Pro
  - 152×152   — iPad
  - 120×120   — iPhone Spotlight
  - 87×87     — iPhone Settings
  - 76×76     — iPad
  - 32×32     — favicon

The source image (1254×1254 PNG with the "999" neon logo on a blue gradient)
is processed:
  1. Resized to each target size with LANCZOS resampling (high quality)
  2. Saved as PNG with transparency preservation
  3. Optionally with iOS rounded corners (squircle) — separate variant

No new design, no AI generation — just proper resizing of the user's image.
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

# ─── Configuration ────────────────────────────────────────────────────────
SOURCE = "/home/z/my-project/upload/30157A5F-E63C-4C81-88D1-9E331F18165F.png"
OUTPUT_DIR = Path("/home/z/my-project/download/app-icons")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# All icon sizes needed for a mobile app + PWA
# (size, filename, purpose)
ICONS = [
    (1024, "icon-1024.png",            "App Store / Google Play hero"),
    (512,  "icon-512.png",             "PWA icon, Google Play listing"),
    (192,  "icon-192.png",             "PWA icon (Android Chrome)"),
    (180,  "apple-touch-icon.png",     "iOS apple-touch-icon (iPhone)"),
    (167,  "apple-icon-167.png",       "iPad Pro"),
    (152,  "apple-icon-152.png",       "iPad"),
    (120,  "apple-icon-120.png",       "iPhone Spotlight"),
    (87,   "apple-icon-87.png",        "iPhone Settings"),
    (76,   "apple-icon-76.png",        "iPad"),
    (60,   "apple-icon-60.png",        "iPhone Notification"),
    (32,   "favicon-32.png",           "Browser favicon"),
    (16,   "favicon-16.png",           "Browser favicon (small)"),
]

# Maskable icons need extra padding (safe zone ~80% of canvas)
MASKABLE_ICONS = [
    (512, "icon-512-maskable.png",  "PWA maskable (Android adaptive)"),
    (192, "icon-192-maskable.png",  "PWA maskable (Android adaptive)"),
]


def resize_icon(src_img: Image.Image, size: int) -> Image.Image:
    """Resize image to the target size using LANCZOS resampling."""
    # Convert to RGBA to preserve any transparency
    if src_img.mode != "RGBA":
        src_img = src_img.convert("RGBA")
    return src_img.resize((size, size), Image.LANCZOS)


def make_maskable(src_img: Image.Image, size: int) -> Image.Image:
    """Create a maskable icon with extra padding (safe zone ~80%).
    
    Maskable icons on Android get cropped to a circle/squircle by the launcher.
    The "safe zone" is the central 80% of the canvas — content outside may
    be cropped. We scale the source logo to 75% of the canvas size and
    center it, filling the background with the edge color of the gradient
    so the cropped result looks intentional.
    """
    if src_img.mode != "RGBA":
        src_img = src_img.convert("RGBA")
    
    # Create a new canvas filled with a dark navy color (matches the
    # bottom of the source gradient — looks intentional when cropped).
    canvas = Image.new("RGBA", (size, size), (15, 23, 42, 255))  # #0f172a
    
    # Scale the source logo to 75% of the canvas (safe zone)
    logo_size = int(size * 0.75)
    logo = src_img.resize((logo_size, logo_size), Image.LANCZOS)
    
    # Center the logo on the canvas
    offset = (size - logo_size) // 2
    canvas.paste(logo, (offset, offset), logo)
    
    return canvas


def add_ios_rounded_corners(img: Image.Image, size: int) -> Image.Image:
    """Apply iOS-style squircle mask (superellipse) to the icon.
    
    iOS automatically applies rounded corners to app icons, so the source
    PNG should be square. But for preview purposes and for use in places
    that DON'T auto-round (e.g. websites, favicons), we provide a pre-rounded
    variant.
    
    The corner radius follows Apple's squircle curve (~22.37% of icon size).
    """
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    
    # Create a mask with rounded corners
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    # iOS corner radius is roughly 22.37% of the icon size
    radius = int(size * 0.2237)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    
    # Apply the mask
    result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    result.paste(img, (0, 0), mask)
    return result


def main():
    if not os.path.exists(SOURCE):
        print(f"ERROR: source image not found: {SOURCE}", file=sys.stderr)
        sys.exit(1)
    
    print(f"Source: {SOURCE}")
    src = Image.open(SOURCE)
    print(f"Source dimensions: {src.size[0]}×{src.size[1]} ({src.mode})")
    print()
    
    # ─── Generate standard icons ─────────────────────────────────────────
    print("Generating standard icons:")
    for size, filename, purpose in ICONS:
        out_path = OUTPUT_DIR / filename
        icon = resize_icon(src, size)
        icon.save(out_path, "PNG", optimize=True)
        print(f"  ✓ {filename:30s} {size:4d}×{size:<4d}  ({purpose})")
    
    print()
    
    # ─── Generate maskable icons ─────────────────────────────────────────
    print("Generating maskable icons (Android adaptive, with safe zone):")
    for size, filename, purpose in MASKABLE_ICONS:
        out_path = OUTPUT_DIR / filename
        icon = make_maskable(src, size)
        icon.save(out_path, "PNG", optimize=True)
        print(f"  ✓ {filename:30s} {size:4d}×{size:<4d}  ({purpose})")
    
    print()
    
    # ─── Generate iOS rounded variant (1024, 512, 180) ───────────────────
    print("Generating iOS pre-rounded variants (for non-iOS contexts):")
    ios_rounded = [
        (1024, "icon-1024-ios-rounded.png"),
        (512,  "icon-512-ios-rounded.png"),
        (180,  "apple-touch-icon-rounded.png"),
    ]
    for size, filename in ios_rounded:
        out_path = OUTPUT_DIR / filename
        icon = resize_icon(src, size)
        icon = add_ios_rounded_corners(icon, size)
        icon.save(out_path, "PNG", optimize=True)
        print(f"  ✓ {filename:30s} {size:4d}×{size:<4d}")
    
    print()
    print(f"All icons saved to: {OUTPUT_DIR}")
    print(f"Total files: {len(ICONS) + len(MASKABLE_ICONS) + len(ios_rounded)}")


if __name__ == "__main__":
    main()
