# Generates the app's PNG icons from the logo geometry (the same shapes as web/icons/logo.svg):
# a smiling speech bubble with curly yellow hair and a pink cap, on the app's blue.
#
#   python scripts/make-icons.py        (needs Pillow; writes web/icons/*.png)
#
# Pillow can't read SVG, so the shapes are drawn directly here at 4x and scaled down.
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "icons")
BLUE, WHITE, HAIR, CAP = (37, 99, 235, 255), (255, 255, 255, 255), (245, 184, 46, 255), (236, 72, 153, 255)

SIDE_CURLS = [(22, 42, 6), (17, 48, 5.5), (20, 54, 5), (16, 60, 4.5), (19, 65, 3.6),
              (78, 42, 6), (83, 48, 5.5), (80, 54, 5), (84, 60, 4.5), (81, 65, 3.6)]
FRINGE = [(27, 40, 5.5), (33.5, 42, 5.5), (40, 40, 5.5), (46.5, 42, 5.5), (53, 40, 5.5), (59.5, 42, 5.5), (66, 40, 5.5), (72, 42, 5.5),
          (30, 47, 4), (38, 48, 4), (46, 47, 4), (54, 48, 4), (62, 47, 4), (70, 48, 4)]


def rot(x, y, deg=-7, cx=48, cy=34):
    """SVG rotate(deg cx cy) in y-down coordinates."""
    a = math.radians(deg)
    dx, dy = x - cx, y - cy
    return cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)


def cubic(p0, p1, p2, p3, n=40):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))
            for t in (i / n for i in range(n + 1))]


def quad(p0, p1, p2, n=30):
    return [tuple((1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c for a, b, c in zip(p0, p1, p2)) for t in (i / n for i in range(n + 1))]


def draw_glyph(d, ox, oy, k):
    """Draws the logo's 100x100 artwork with its top-left at (ox, oy), k pixels per unit."""
    P = lambda x, y: (ox + x * k, oy + y * k)
    circle = lambda x, y, r, fill: d.ellipse((ox + (x - r) * k, oy + (y - r) * k, ox + (x + r) * k, oy + (y + r) * k), fill=fill)

    d.rounded_rectangle((*P(15, 36), *P(85, 82)), radius=21 * k, fill=WHITE)
    d.polygon([P(30, 76), P(25, 92), P(46, 79)], fill=WHITE)
    for x, y, r in SIDE_CURLS:
        circle(x, y, r, HAIR)
    for x, y, r in FRINGE:
        circle(*rot(x, y), r, HAIR)
    dome = cubic((25, 37), (25, 15), (71, 15), (71, 37))
    d.polygon([P(*rot(x, y)) for x, y in dome], fill=CAP)
    brim = [(64, 33.5), (88, 33.5)] + [(88 + 4 * math.cos(a), 37.5 + 4 * math.sin(a)) for a in (math.radians(-90 + i * 9) for i in range(21))] + [(64, 41.5)]
    d.polygon([P(*rot(x, y)) for x, y in brim], fill=CAP)
    circle(*rot(48, 17), 2.6, CAP)
    circle(40, 58, 4, BLUE)
    circle(60, 58, 4, BLUE)
    smile = [P(x, y) for x, y in quad((39, 67), (50, 75), (61, 67))]
    d.line(smile, fill=BLUE, width=max(1, round(4 * k)), joint="curve")
    for end in (smile[0], smile[-1]):
        r = 2 * k
        d.ellipse((end[0] - r, end[1] - r, end[0] + r, end[1] + r), fill=BLUE)


def icon(size, name, art, radius):
    """art: share of the tile the 100-unit artwork spans; radius: tile corner as a share (0 = square, the OS rounds it)."""
    big = size * 4
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if radius:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * radius), fill=BLUE)
    else:
        d.rectangle((0, 0, big, big), fill=BLUE)
    k = big * art / 100
    off = (big - 100 * k) / 2
    draw_glyph(d, off, off, k)
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    print(name)


icon(192, "icon-192.png", 1.0, 0.22)
icon(512, "icon-512.png", 1.0, 0.22)
icon(512, "icon-maskable-512.png", 0.78, 0)  # artwork inside the maskable safe zone
icon(180, "apple-touch-icon.png", 0.94, 0)
icon(32, "favicon-32.png", 1.0, 0.22)
