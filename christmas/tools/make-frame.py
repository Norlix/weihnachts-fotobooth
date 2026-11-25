"""Erzeugt den Fotorahmen christmas/ui/assets/frame-christmas.png in einer wählbaren Breite.

Der Rahmen wird beim Speichern eines Fotos auf dessen Größe skaliert. Je höher die Kameraauflösung, desto größer sollte
der Rahmen sein, damit Rand und Schrift scharf bleiben. Die Proportionen entsprechen den Prozentwerten in
christmas/config/my.config.inc.php.example (links und rechts 6, oben 7, unten 14 Prozent) und dem Seitenverhältnis 16 zu 10.

Aufruf  python3 christmas/tools/make-frame.py --width 4320
Voraussetzungen  Pillow und fontTools (pip install pillow fonttools)
"""
import argparse
import io
import math
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / "christmas" / "vendor" / "ibm-plex-sans"
OUTPUT = ROOT / "christmas" / "ui" / "assets" / "frame-christmas.png"
BASE_WIDTH, BASE_HEIGHT = 1920, 1200
BORDER_LEFT = BORDER_RIGHT = 115
BORDER_TOP, BORDER_BOTTOM = 80, 170
LIGHT_COLORS = [(218, 30, 40), (241, 194, 27), (36, 161, 72), (120, 169, 255), (255, 131, 137)]


def load_font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    font = TTFont(FONT_DIR / f"ibm-plex-sans-latin-{weight}-normal.woff")
    font.flavor = None
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return ImageFont.truetype(buffer, size)


def build(width: int) -> Image.Image:
    scale = width / BASE_WIDTH
    w, h = width, round(BASE_HEIGHT * scale)
    left, top = round(BORDER_LEFT * scale), round(BORDER_TOP * scale)
    right, bottom = w - round(BORDER_RIGHT * scale), h - round(BORDER_BOTTOM * scale)

    image = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in range(h):
        t = y / h
        draw.line([(0, y), (w, y)], fill=(int(15 * t), int(17 + 85 * t), int(65 + 189 * t), 255))
    draw.rectangle([left, top, right - 1, bottom - 1], fill=(0, 0, 0, 0))

    thick, step = round(14 * scale), round(28 * scale)
    box = (right - left + 2 * thick, bottom - top + 2 * thick)
    stripes = Image.new("RGBA", box, (255, 255, 255, 255))
    stripe_draw = ImageDraw.Draw(stripes)
    for k in range(-box[1], box[0] + box[1], step * 2):
        stripe_draw.polygon(
            [(k, 0), (k + step, 0), (k + step + box[1], box[1]), (k + box[1], box[1])], fill=(218, 30, 40, 255)
        )
    mask = Image.new("L", box, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rectangle([0, 0, box[0] - 1, box[1] - 1], fill=255)
    mask_draw.rectangle([thick, thick, box[0] - thick - 1, box[1] - thick - 1], fill=0)
    image.paste(stripes, (left - thick, top - thick), mask)

    draw = ImageDraw.Draw(image)
    drift = [(0, h)] + [
        (x, h - (34 + 18 * math.sin(x / (140 * scale)) + 10 * math.sin(x / (47 * scale))) * scale)
        for x in range(0, w + 20, max(1, round(20 * scale)))
    ] + [(w, h)]
    draw.polygon(drift, fill=(244, 248, 255, 255))

    def wire_y(x: float) -> float:
        return (26 + 22 * math.sin(x / w * math.pi * 12) ** 2) * scale

    previous = None
    for x in range(0, w + 8, max(1, round(8 * scale))):
        point = (x, wire_y(x))
        if previous:
            draw.line([previous, point], fill=(20, 20, 20, 255), width=max(1, round(4 * scale)))
        previous = point
    for index in range(24):
        x = (index + 0.5) * w / 24
        y = wire_y(x)
        color = LIGHT_COLORS[index % 5]
        draw.rectangle([x - 5 * scale, y, x + 5 * scale, y + 12 * scale], fill=(25, 25, 25, 255))
        draw.ellipse([x - 12 * scale, y + 8 * scale, x + 12 * scale, y + 42 * scale], fill=color + (255,))
        draw.ellipse([x - 6 * scale, y + 14 * scale, x - 1 * scale, y + 24 * scale], fill=(255, 255, 255, 120))

    size = round(62 * scale)
    light, semibold = load_font("300", size), load_font("600", size)
    parts = [
        ("IBM ", semibold, (255, 255, 255)),
        ("Muccenter ", light, (255, 255, 255)),
        ("Christmas ", semibold, (241, 194, 27)),
        ("Fotobooth", light, (255, 255, 255)),
    ]
    total = sum(draw.textlength(text, font=font) for text, font, _ in parts)
    x, y = (w - total) / 2, h - round(BORDER_BOTTOM * scale) + round(38 * scale)
    for text, font, color in parts:
        draw.text((x, y), text, font=font, fill=color + (255,))
        x += draw.textlength(text, font=font)
    return image


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--width", type=int, default=BASE_WIDTH, help="Breite des Rahmens in Pixeln")
    arguments = parser.parse_args()
    result = build(arguments.width)
    result.save(OUTPUT, optimize=True)
    print(f"{OUTPUT.relative_to(ROOT)} {result.size[0]}x{result.size[1]}")
