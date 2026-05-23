"""Generate icon.{png,ico,icns} + sibling copies for in-window and README use.

Design: outlined file-folder silhouette with a filled quarter-note inside —
the most direct "music sorter" metaphor (folders are the destination, music is
the content). Monochrome white on the app's dark surface. Scales legibly from
16 px through 1024 px.

Run with the Python in the project venv (or any 3.10+ with Pillow installed):
    python app/build/make_icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
BUILD_PNG = HERE / "icon.png"
BUILD_ICO = HERE / "icon.ico"
BUILD_ICNS = HERE / "icon.icns"
RESOURCES_PNG = HERE.parent / "resources" / "icon.png"
ROOT_PNG = HERE.parent.parent / "icon.png"

BG_COLOR = (14, 14, 14, 255)        # surface-2
FG_COLOR = (255, 255, 255, 255)     # text/accent white


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-square background.
    radius = max(2, size // 5)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=radius,
        fill=BG_COLOR,
    )

    # Stroke thickness scales with icon size; floor at 2 px so 16-px renders.
    stroke = max(2, int(size * 0.035))

    # Folder body (the big rounded rectangle).
    body_left = size * 0.16
    body_right = size * 0.84
    body_top = size * 0.36
    body_bot = size * 0.80
    body_r = size * 0.045

    # Tab on the upper-left of the folder. The body overlaps the tab's bottom
    # so they read as one continuous folder shape.
    tab_left = body_left
    tab_right = body_left + (body_right - body_left) * 0.40
    tab_top = size * 0.26
    tab_bot = body_top + stroke  # bury the seam under the body's top stroke
    tab_r = size * 0.03

    draw.rounded_rectangle(
        (tab_left, tab_top, tab_right, tab_bot),
        radius=tab_r,
        outline=FG_COLOR,
        width=stroke,
    )
    draw.rounded_rectangle(
        (body_left, body_top, body_right, body_bot),
        radius=body_r,
        outline=FG_COLOR,
        width=stroke,
    )

    # Quarter note inside the folder body — filled head + vertical stem.
    head_w = size * 0.17
    head_h = head_w * 0.78
    head_cx = size * 0.46
    head_cy = size * 0.66
    draw.ellipse(
        (head_cx - head_w / 2, head_cy - head_h / 2,
         head_cx + head_w / 2, head_cy + head_h / 2),
        fill=FG_COLOR,
    )

    stem_w = max(2, int(size * 0.035))
    stem_x = head_cx + head_w / 2 - stem_w / 2
    stem_top_y = size * 0.46
    draw.rectangle(
        (stem_x - stem_w / 2, stem_top_y, stem_x + stem_w / 2, head_cy),
        fill=FG_COLOR,
    )

    return img


def main() -> None:
    # 1024 px master gets downsampled by PIL into every smaller embedded size.
    master = make_icon(1024)

    master.save(BUILD_PNG)
    print(f"wrote {BUILD_PNG}")

    master.save(
        BUILD_ICO,
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {BUILD_ICO}")

    master.save(BUILD_ICNS, format="ICNS")
    print(f"wrote {BUILD_ICNS}")

    master.save(RESOURCES_PNG)
    print(f"wrote {RESOURCES_PNG}")

    master.save(ROOT_PNG)
    print(f"wrote {ROOT_PNG}")


if __name__ == "__main__":
    main()
