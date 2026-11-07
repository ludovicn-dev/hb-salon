"""Icônes de l'appli à partir du vrai logo détouré.

Usage : python -I tools/icones.py app/logo.webp app/icons
Fond bleu nuit ; logo à 86 % de la largeur (icônes ordinaires) ou 68 % (maskable : l'ovale
tient dans le cercle de 80 % que le téléphone peut garder en découpant l'icône).
"""
import sys
from pathlib import Path
from PIL import Image

src, out = sys.argv[1], Path(sys.argv[2])
logo = Image.open(src).convert('RGBA')
BG = (0x16, 0x1D, 0x33, 255)


def icon(size, ratio):
    img = Image.new('RGBA', (size, size), BG)
    w = round(size * ratio)
    h = round(w * logo.height / logo.width)
    small = logo.resize((w, h), Image.LANCZOS)
    img.alpha_composite(small, ((size - w) // 2, (size - h) // 2))
    return img.convert('RGB')


icon(192, 0.86).save(out / 'icon-192.png', optimize=True)
icon(512, 0.86).save(out / 'icon-512.png', optimize=True)
icon(512, 0.68).save(out / 'icon-maskable-512.png', optimize=True)
print('icônes écrites dans', out)
