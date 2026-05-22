"""Generates icon.ico and icon.png from the ASCII dance dude.

One-shot tool — run after editing the dude pose if you want to refresh the icon.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ICON_TEXT = "\\o/\n | \n/ \\"
OUT_ICO = Path(__file__).parent / "icon.ico"
OUT_PNG = Path(__file__).parent / "icon.png"
FONT_CANDIDATES = (
    "C:/Windows/Fonts/consolab.ttf",  # Consolas Bold
    "C:/Windows/Fonts/consola.ttf",   # Consolas Regular
    "C:/Windows/Fonts/arial.ttf",
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
    big = make_icon(256)
    big.save(OUT_ICO, sizes=[(16, 16), (32, 32), (48, 48), (64, 64),
                             (128, 128), (256, 256)])
    big.save(OUT_PNG)
    print(f"wrote {OUT_ICO}")
    print(f"wrote {OUT_PNG}")


if __name__ == "__main__":
    main()
