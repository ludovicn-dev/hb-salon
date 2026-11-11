"""Polices des thèmes, auto-hébergées pour le hors-ligne (pas de Google Fonts en ligne dans l'appli).

Usage : python -I tools/polices.py   (depuis la racine du projet)
Télécharge chaque famille de FAMILIES depuis Google Fonts (woff2, sous-ensembles latin et latin-ext),
range les fichiers dans app/fonts/, réécrit la partie « thèmes » de app/fonts/fonts.css (Cormorant
Garamond et Manrope, en tête, ne bougent pas) et la liste FONTS de app/sw.js. Affiche le poids total.
Une police variable donne un fichier par sous-ensemble ; une police statique, un par graisse.
"""
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'app' / 'fonts'
CSS = FONTS / 'fonts.css'
SW = ROOT / 'app' / 'sw.js'
MARK = '/* ---------- Polices des thèmes (tools/polices.py, ne pas modifier à la main) ---------- */'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
SUBSETS = ('latin-ext', 'latin')

# Famille → axes demandés à l'API css2 (graisses utilisées par les thèmes : texte 400 à 700, titres selon le thème).
FAMILIES = {
    'Oswald': 'wght@500',
    'Work Sans': 'wght@400;500;600;700',
    'Bodoni Moda': 'ital,wght@0,500;1,500',
    'Archivo': 'wght@400;500;600;700',
    'DM Serif Display': '',
    'DM Sans': 'wght@400;500;600;700',
    'Marcellus': '',
    'Josefin Sans': 'wght@400;500;600;700',
    'Space Grotesk': 'wght@500;600',
    'IBM Plex Sans': 'wght@400;500;600;700',
    'Barlow Condensed': 'wght@600',
    'Barlow': 'wght@400;500;600;700',
    'Playfair Display': 'wght@500',
    'Source Sans 3': 'wght@400;500;600;700',
    'Gilda Display': '',
    'Figtree': 'wght@400;500;600;700',
}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def faces(family, axes):
    """Les @font-face latin et latin-ext d'une famille : (sous-ensemble, style, graisse, url, unicode-range)."""
    q = family.replace(' ', '+') + (f':{axes}' if axes else '')
    css = get(f'https://fonts.googleapis.com/css2?family={q}&display=swap').decode('utf-8')
    out = []
    for subset, body in re.findall(r'/\* ([\w-]+) \*/\s*@font-face \{(.*?)\}', css, re.S):
        if subset not in SUBSETS:
            continue
        val = lambda k: re.search(rf'{k}:\s*([^;]+);', body).group(1).strip()
        url = re.search(r'url\((https://[^)]+\.woff2)\)', body).group(1)
        out.append((subset, val('font-style'), int(val('font-weight')), url, val('unicode-range')))
    return out


def main():
    blocks, files, total = [], [], 0
    for family, axes in FAMILIES.items():
        slug = family.lower().replace(' ', '-')
        # Une même url pour plusieurs graisses = police variable : un seul fichier, graisses en intervalle.
        by_url = {}
        for subset, style, weight, url, urange in faces(family, axes):
            by_url.setdefault((subset, style, url, urange), []).append(weight)
        per_subset = {}
        for (subset, style, url, urange), weights in by_url.items():
            per_subset.setdefault((subset, style), []).append((url, urange, weights))
        for (subset, style), entries in per_subset.items():
            for url, urange, weights in entries:
                lo, hi = min(weights), max(weights)
                tag = '' if len(entries) == 1 and style == 'normal' else f'-{lo}' + ('i' if style == 'italic' else '')
                name = f'{slug}{tag}-{subset}.woff2'
                data = get(url)
                (FONTS / name).write_bytes(data)
                total += len(data)
                files.append(name)
                weight = f'{lo}' if lo == hi else f'{lo} {hi}'
                blocks.append(
                    f"/* {subset} */\n@font-face {{\n  font-family: '{family}';\n  font-style: {style};\n"
                    f"  font-weight: {weight};\n  font-display: swap;\n  src: url({name}) format('woff2');\n"
                    f"  unicode-range: {urange};\n}}"
                )
        print(f'{family} : ok')

    css = CSS.read_text(encoding='utf-8').replace('\r\n', '\n')
    head = css.split(MARK)[0].rstrip('\n')
    CSS.write_text(head + '\n\n' + MARK + '\n' + '\n'.join(blocks) + '\n', encoding='utf-8', newline='\r\n')

    base = [f.name for f in sorted(FONTS.glob('*.woff2')) if f.name.split('-')[0] in ('cormorant', 'manrope')]
    listing = ',\n'.join(f"  'fonts/{f}'" for f in base + files)
    sw = SW.read_text(encoding='utf-8').replace('\r\n', '\n')
    sw = re.sub(r'const FONTS = [\s\S]*?\];\n', f'const FONTS = [\n{listing}\n];\n', sw, count=1)
    SW.write_text(sw, encoding='utf-8', newline='\r\n')

    allsize = sum(f.stat().st_size for f in FONTS.glob('*.woff2'))
    print(f'{len(files)} fichiers ajoutés, {total / 1024:.0f} Ko ; toutes les polices : {allsize / 1024:.0f} Ko')


if __name__ == '__main__':
    main()
