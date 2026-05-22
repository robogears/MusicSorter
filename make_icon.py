"""Generates icon.ico, icon.icns, and icon.png from the ASCII dance dude.

Run this on any OS — fonts are tried in order, falling back to PIL's default.
The generated files get checked into the repo and consumed at build time.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ICON_TEXT = "\\o/\n | \n/ \\"
HERE = Path(__file__).parent
OUT_ICO = HERE / "icon.ico"
OUT_ICNS = HERE / "icon.icns"
OUT_PNG = HERE / "icon.png"
FONT_CANDIDATES = (
    # Windows
    "C:/Windows/Fonts/consolab.ttf",
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/arial.ttf",
    # macOS
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
    "/Library/Fonts/Menlo.ttc",
    # Linux
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
)


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    px = max(8, int(size * 0.22))
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, px)
        except OSError:
            continue
    return ImageFont.load_default()


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _load_font(size)
    spacing = max(1, int(size * 0.03))
    bb = draw.multiline_textbbox((0, 0), ICON_TEXT, font=font,
                                 spacing=spacing, align="center")
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    x = (size - tw) / 2 - bb[0]
    y = (size - th) / 2 - bb[1]
    draw.multiline_text((x, y), ICON_TEXT, font=font, fill="white",
                        align="center", spacing=spacing)
    return img


def main():
    # Windows .ico with embedded multi-resolution
    big = make_icon(256)
    big.save(OUT_ICO, sizes=[(16, 16), (32, 32), (48, 48), (64, 64),
                             (128, 128), (256, 256)])
    print(f"wrote {OUT_ICO}")

    # PNG (used as the cross-platform Tk window icon at runtime)
    big.save(OUT_PNG)
    print(f"wrote {OUT_PNG}")

    # macOS .icns — PIL needs a square image; it picks the included sizes itself.
    big_icns = make_icon(1024)
    big_icns.save(OUT_ICNS, format="ICNS")
    print(f"wrote {OUT_ICNS}")


if __name__ == "__main__":
    main()
