"""Logo H&B vectoriel (app/logo.svg), refait une fois depuis l'image d'origine (tools/logo-origine.webp).

- Ovale, « & » et panses du B : tracés (potrace) depuis la luminosité de l'image d'origine.
- H : dessiné en géométrie exacte, mesures prises sur l'image (fûts, barre, empattements, congés) ;
  l'image a un reflet clair au-dessus de chaque empattement qui laissait des éclats au tracé.
- Fût et empattements gauches du B : redessinés de même, raccords en douceur vers les panses.
- « SALON » : Cormorant Garamond semi-gras, aux positions des lettres d'origine (trop floues pour le tracé).
- Un seul dégradé doux (or rose clair en haut, plus soutenu en bas) pour tout le dessin.

Dépendances (hors appli) : numpy, pillow, fonttools, brotli, potracer
  python -m pip install --target <dossier> potracer fonttools brotli   puis PYTHONPATH=<dossier>
Usage : python tools/logo-vectoriel.py tools/logo-origine.webp app/fonts/cormorant-latin.woff2 app/logo.svg
Icônes : rendre app/logo.svg en PNG à fond transparent (navigateur, 1708 px de large), puis
  python -I tools/icones.py <logo.png> app/icons
"""
import sys
from pathlib import Path

import numpy as np
import potrace
from PIL import Image, ImageDraw, ImageFilter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

src, font_path, dst = sys.argv[1], sys.argv[2], sys.argv[3]
SCALE = 4
TOP, TOP_IN = 115.6, 119.6      # empattements du haut : bord, dessous
BOT, BOT_IN = 312.4, 308.4      # empattements du bas : bord, dessus


def num(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


# ---------- Tracé de l'image ----------
im = Image.open(src).convert('RGB')
W, H = im.size
L = im.convert('L').resize((W * SCALE, H * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(SCALE * 0.5))
bw = L.point(lambda v: 255 if v > 105 else 0)
arr = np.array(bw) > 128


def flatten(x0, x1, inside, edge):
    xs = slice(int(x0 * SCALE), int(x1 * SCALE))
    ri, re = int(inside * SCALE), int(edge * SCALE)
    row = arr[ri, xs].copy()
    if re < ri:
        arr[int(106 * SCALE):re, xs] = False  # sans toucher l'ovale au-dessus
        arr[re:ri, xs] = row
    else:
        arr[ri:re, xs] = row
        arr[re:re + 12 * SCALE, xs] = False


# B : haut et bas redressés, côté gauche (empattements + fût) redessiné.
flatten(575, 640, 117.5, TOP)
flatten(575, 640, 309.5, BOT)


def cubic(p0, p1, p2, p3, n=24):
    out = []
    for i in range(1, n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


B_STEM, B_TOP_END, B_BOT_END = 575.1, 553.0, 553.25
arr[int(105 * SCALE):int(320 * SCALE), int(545 * SCALE):int(579 * SCALE)] = False
poly = [(B_TOP_END, TOP), (579, TOP), (579, BOT), (B_BOT_END, BOT), (B_BOT_END, BOT_IN), (B_STEM - 19, BOT_IN)]
poly += cubic((B_STEM - 19, BOT_IN), (B_STEM - 8, BOT_IN), (B_STEM, BOT_IN - 7), (B_STEM, BOT_IN - 20))
poly += [(B_STEM, TOP_IN + 17)]
poly += cubic((B_STEM, TOP_IN + 17), (B_STEM, TOP_IN + 6), (B_STEM - 7, TOP_IN), (B_STEM - 18, TOP_IN))
poly += [(B_TOP_END, TOP_IN)]
mask = Image.fromarray((arr * 255).astype('uint8'))
ImageDraw.Draw(mask).polygon([(x * SCALE, y * SCALE) for x, y in poly], fill=255)
arr = np.array(mask) > 128

# Raccord en douceur entre le haut (et le bas) redressés du B et la courbe d'origine de la panse.
def edge_y(x, top=True):
    col = arr[int(106 * SCALE):int(320 * SCALE), int(x * SCALE)]
    ys = np.where(col)[0]
    if not len(ys):
        return None
    return 106 + (ys.min() if top else ys.max() + 1) / SCALE


def blend(top):
    flat = TOP if top else BOT
    sign = 1 if top else -1
    x0 = 640.0
    xs = np.arange(x0, 705, 0.25)
    ys = [edge_y(x, top) for x in xs]
    # point de jonction : là où la courbe s'écarte de 6 px du bord droit
    j = next(i for i, y in enumerate(ys) if y is not None and sign * (y - flat) >= 6)
    xj, yj = xs[j], ys[j]
    k = max(j - 8, 0)
    slope = (yj - ys[k]) / (xj - xs[k])  # pente de la courbe d'origine au raccord
    dx = (xj - x0) * 0.45
    pts = [(x0, flat)] + cubic((x0, flat), (x0 + (xj - x0) * 0.55, flat), (xj - dx, yj - slope * dx), (xj, yj), 40)
    # rien ne dépasse au-delà de la courbe de raccord
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        for xi in range(int(xa * SCALE), int(xb * SCALE) + 1):
            yc = ya + (yb - ya) * ((xi / SCALE - xa) / ((xb - xa) or 1))
            if top:
                arr[int(106 * SCALE):int(yc * SCALE), xi] = False
            else:
                arr[int(yc * SCALE):int(318 * SCALE), xi] = False
    pts += [(xj - 2, yj + sign * 4), (x0, flat + sign * 4)]
    m = Image.fromarray((arr * 255).astype('uint8'))
    ImageDraw.Draw(m).polygon([(x * SCALE, y * SCALE) for x, y in pts], fill=255)
    return np.array(m) > 128, xj, yj


arr, xj, yj = blend(True)
print('raccord haut', round(xj, 2), round(yj, 2))
arr, xj, yj = blend(False)
print('raccord bas', round(xj, 2), round(yj, 2))

# H : retiré du tracé, dessiné plus bas en vectoriel.
arr[int(105 * SCALE):int(320 * SCALE), int(146 * SCALE):int(358 * SCALE)] = False
# « SALON » : retiré, redessiné en police.
arr[355 * SCALE:410 * SCALE, 200 * SCALE:660 * SCALE] = False

bm = potrace.Bitmap(~arr)  # potracer : sombre = forme
plist = bm.trace(turdsize=60, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.3)
parts = []
for c in plist:
    pts = [(c.start_point.x, c.start_point.y)]
    d = [f'M{num(c.start_point.x / SCALE)} {num(c.start_point.y / SCALE)}']
    for s in c:
        if s.is_corner:
            pts += [(s.c.x, s.c.y), (s.end_point.x, s.end_point.y)]
            d.append(f'L{num(s.c.x / SCALE)} {num(s.c.y / SCALE)}L{num(s.end_point.x / SCALE)} {num(s.end_point.y / SCALE)}')
        else:
            pts += [(s.c1.x, s.c1.y), (s.c2.x, s.c2.y), (s.end_point.x, s.end_point.y)]
            d.append(
                f'C{num(s.c1.x / SCALE)} {num(s.c1.y / SCALE)} {num(s.c2.x / SCALE)} {num(s.c2.y / SCALE)} {num(s.end_point.x / SCALE)} {num(s.end_point.y / SCALE)}'
            )
    xs = [p[0] / SCALE for p in pts]
    ys = [p[1] / SCALE for p in pts]
    if min(max(xs) - min(xs), max(ys) - min(ys)) < 4 or (max(xs) - min(xs)) * (max(ys) - min(ys)) < 60:
        continue  # éclats
    d.append('Z')
    parts.append(''.join(d))
traced = ''.join(parts)

# ---------- H dessiné ----------
def stem(xl, xr, sl, sr):
    """Fût de xl à xr, empattements de sl à sr en haut et en bas, congés arrondis."""
    return (
        f'M{num(sl)} {num(TOP)}H{num(sr)}V{num(TOP_IN)}H{num(xr + 18)}'
        f'C{num(xr + 7)} {num(TOP_IN)} {num(xr)} {num(TOP_IN + 6)} {num(xr)} {num(TOP_IN + 17)}'
        f'V{num(BOT_IN - 20)}'
        f'C{num(xr)} {num(BOT_IN - 7)} {num(xr + 8)} {num(BOT_IN)} {num(xr + 19)} {num(BOT_IN)}'
        f'H{num(sr)}V{num(BOT)}H{num(sl)}V{num(BOT_IN)}H{num(xl - 19)}'
        f'C{num(xl - 8)} {num(BOT_IN)} {num(xl)} {num(BOT_IN - 7)} {num(xl)} {num(BOT_IN - 20)}'
        f'V{num(TOP_IN + 17)}'
        f'C{num(xl)} {num(TOP_IN + 6)} {num(xl - 7)} {num(TOP_IN)} {num(xl - 18)} {num(TOP_IN)}'
        f'H{num(sl)}Z'
    )


h_path = stem(179.0, 204.7, 152.0, 231.9) + stem(302.25, 327.75, 280.3, 351.7) + 'M204 204.6H303V212.1H204Z'

# ---------- SALON ----------
font = instantiateVariableFont(TTFont(font_path), {'wght': 600})
gs = font.getGlyphSet()
cmap = font.getBestCmap()
scale = 36.0 / font['OS/2'].sCapHeight
salon = []
for ch, cx in zip('SALON', [265, 345, 425, 505, 585]):
    name = cmap[ord(ch)]
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    mid = (bp.bounds[0] + bp.bounds[2]) / 2
    pen = SVGPathPen(gs, ntos=num)
    gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cx - mid * scale, 398.5)))
    salon.append(pen.getCommands())

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 854 502" role="img" aria-label="H&amp;B Salon">
<defs><linearGradient id="or-rose" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="502"><stop offset="0" stop-color="#F2D4C2"/><stop offset="1" stop-color="#D9A386"/></linearGradient></defs>
<g fill="url(#or-rose)">
<path fill-rule="evenodd" d="{traced}"/>
<path d="{h_path}"/>
<path d="{''.join(salon)}"/>
</g>
</svg>
'''
Path(dst).write_text(svg, encoding='utf-8')
print(dst, len(svg), 'octets,', len(parts), 'contours tracés')
