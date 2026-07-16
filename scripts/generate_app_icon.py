"""Generate kilne-git K-monogram app icons for Expo/Android."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "images"
SIZE = 1024

BG = (15, 31, 26, 255)  # #0F1F1A
CREAM = (245, 243, 231, 255)  # #F5F3E7
GOLD = (212, 160, 68, 255)  # #D4A044
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)


def draw_rounded_line(
    draw: ImageDraw.ImageDraw,
    p0: tuple[float, float],
    p1: tuple[float, float],
    width: float,
    fill: tuple[int, int, int, int],
) -> None:
    """Draw a thick line with round caps."""
    x0, y0 = p0
    x1, y1 = p1
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    hw = width / 2
    polygon = [
        (x0 + nx * hw, y0 + ny * hw),
        (x1 + nx * hw, y1 + ny * hw),
        (x1 - nx * hw, y1 - ny * hw),
        (x0 - nx * hw, y0 - ny * hw),
    ]
    draw.polygon(polygon, fill=fill)
    r = hw
    draw.ellipse((x0 - r, y0 - r, x0 + r, y0 + r), fill=fill)
    draw.ellipse((x1 - r, y1 - r, x1 + r, y1 + r), fill=fill)


def draw_k(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    scale: float,
    body: tuple[int, int, int, int],
    accent: tuple[int, int, int, int] | None,
) -> None:
    """
    Geometric lowercase k matching the approved concept:
    vertical stem + two diagonal arms; upper arm ends in a gold node.
    """
    stroke = 118 * scale
    # Stem
    stem_x = cx - 145 * scale
    stem_top = cy - 250 * scale
    stem_bot = cy + 250 * scale
    draw_rounded_line(draw, (stem_x, stem_top), (stem_x, stem_bot), stroke, body)

    # Junction near mid-stem
    jx = stem_x + 8 * scale
    jy = cy + 10 * scale

    # Upper arm (short of the gold dot center)
    upper_end = (cx + 145 * scale, cy - 205 * scale)
    # Stop the arm just before the accent circle so it reads as a branch tip
    ux, uy = upper_end
    dx, dy = ux - jx, uy - jy
    length = math.hypot(dx, dy)
    stop = (stroke * 0.55) if accent else 0
    ux2 = ux - dx / length * stop
    uy2 = uy - dy / length * stop
    draw_rounded_line(draw, (jx, jy), (ux2, uy2), stroke, body)

    # Lower arm
    lower_end = (cx + 175 * scale, cy + 235 * scale)
    draw_rounded_line(draw, (jx, jy), lower_end, stroke, body)

    # Branch-tip accent
    if accent is not None:
        r = 72 * scale
        draw.ellipse((ux - r, uy - r, ux + r, uy + r), fill=accent)


def render(
    *,
    background: tuple[int, int, int, int] | None,
    body: tuple[int, int, int, int],
    accent: tuple[int, int, int, int] | None,
    scale: float = 1.0,
) -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_k(draw, SIZE / 2, SIZE / 2, scale, body, accent)
    return img


def solid(color: tuple[int, int, int, int]) -> Image.Image:
    return Image.new("RGBA", (SIZE, SIZE), color)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # Full app icon (store / general)
    icon = render(background=BG, body=CREAM, accent=GOLD, scale=1.0)
    icon.convert("RGB").save(OUT / "icon.png", "PNG", optimize=True)

    # Favicon — same mark, smaller file still 1024 then Expo downscales; keep RGB
    icon.convert("RGB").save(OUT / "favicon.png", "PNG", optimize=True)

    # Android adaptive layers
    # Slightly smaller for adaptive safe zone (~66% of canvas)
    fg = render(background=None, body=CREAM, accent=GOLD, scale=0.86)
    fg.save(OUT / "android-icon-foreground.png", "PNG", optimize=True)

    solid(BG).convert("RGB").save(OUT / "android-icon-background.png", "PNG", optimize=True)

    mono = render(background=None, body=BLACK, accent=BLACK, scale=0.86)
    mono.save(OUT / "android-icon-monochrome.png", "PNG", optimize=True)

    # Splash mark
    splash = render(background=None, body=WHITE, accent=WHITE, scale=0.72)
    splash.save(OUT / "splash-icon.png", "PNG", optimize=True)

    print("Wrote icons to", OUT)
    for name in [
        "icon.png",
        "favicon.png",
        "android-icon-foreground.png",
        "android-icon-background.png",
        "android-icon-monochrome.png",
        "splash-icon.png",
    ]:
        path = OUT / name
        print(f"  {name}: {path.stat().st_size} bytes, {Image.open(path).mode} {Image.open(path).size}")


if __name__ == "__main__":
    main()
