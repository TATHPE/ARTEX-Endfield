"""Render the ARTEX app icon: PNG -> multi-size .ico (+ a size preview strip).

Usage: python icon-make.py <src.png> <out.ico>
"""
import sys

from PIL import Image

SIZES = [256, 128, 64, 48, 32, 24, 16]


def main() -> int:
    src, out = sys.argv[1], sys.argv[2]
    img = Image.open(src).convert("RGBA")
    if img.size != (1024, 1024):
        img = img.resize((1024, 1024), Image.LANCZOS)
    img.save(out, format="ICO", sizes=[(s, s) for s in SIZES])

    pad = 8
    strip_w = sum(SIZES) + pad * (len(SIZES) + 1)
    strip = Image.new("RGBA", (strip_w, 256), (17, 20, 22, 255))
    x = pad
    for s in SIZES:
        thumb = img.resize((s, s), Image.LANCZOS)
        strip.paste(thumb, (x, 0), thumb)
        x += s + pad
    strip.save(out.replace(".ico", "-sizes.png"))
    print(f"ico written: {out} (sizes: {SIZES})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
