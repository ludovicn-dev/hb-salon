# Carte des gestes d'app.js : chaque data-action affiché à l'écran, l'action qui le traite et les fonctions
# appelées en cascade, plus les écouteurs du module. Réécrit seulement le bloc généré de
# docs/carte-des-gestes.md ; les parcours rédigés à la main, sous le bloc, sont gardés.
# Usage (à la racine) : python -I -X utf8 tools/carte_gestes.py   (il faut tree_sitter et tree_sitter_javascript)
import re
from collections import defaultdict
from pathlib import Path

import tree_sitter_javascript as tsjs
from tree_sitter import Language, Parser

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'app' / 'app.js'
OUT = ROOT / 'docs' / 'carte-des-gestes.md'
BEGIN, END = '<!-- début du bloc généré par tools/carte_gestes.py -->', '<!-- fin du bloc généré -->'

src = SRC.read_bytes()
tree = Parser(Language(tsjs.language())).parse(src)
text = lambda n: src[n.start_byte:n.end_byte].decode('utf-8')
line = lambda n: n.start_point[0] + 1
FUNCS = ('function_declaration', 'function_expression', 'arrow_function', 'method_definition')

# Fonctions nommées de premier niveau (déclarées, ou const f = () => …).
named = {}
for n in tree.root_node.children:
    if n.type == 'function_declaration':
        named[text(n.child_by_field_name('name'))] = n
    if n.type in ('lexical_declaration', 'variable_declaration'):
        for d in n.named_children:
            v = d.child_by_field_name('value')
            if d.type == 'variable_declarator' and v is not None and v.type in FUNCS:
                named[text(d.child_by_field_name('name'))] = v


def callees(node):
    """Fonctions nommées appelées dans `node`, dans l'ordre du texte, sans doublon."""
    found, stack = [], [node]
    while stack:
        n = stack.pop()
        if n.type == 'call_expression':
            f = n.child_by_field_name('function')
            if f is not None and f.type == 'identifier' and text(f) in named:
                found.append((n.start_byte, text(f)))
        stack.extend(n.children)
    out = []
    for _, name in sorted(found):
        if name not in out:
            out.append(name)
    return out


graph = {name: callees(body) for name, body in named.items()}


def owner_name(node):
    cur = node.parent
    while cur is not None:
        if cur.type == 'function_declaration':
            return text(cur.child_by_field_name('name'))
        if cur.type in FUNCS and cur.parent is not None and cur.parent.type == 'variable_declarator':
            decl = cur.parent.parent
            if decl is not None and decl.parent is not None and decl.parent.type == 'program':
                return text(cur.parent.child_by_field_name('name'))
        cur = cur.parent
    return None


# L'objet `actions` : clé → fonctions appelées (ou fonction passée telle quelle).
actions, action_line = {}, {}
for n in tree.root_node.children:
    if n.type not in ('lexical_declaration', 'variable_declaration'):
        continue
    for d in n.named_children:
        if d.type == 'variable_declarator' and text(d.child_by_field_name('name')) == 'actions':
            for p in d.child_by_field_name('value').named_children:
                if p.type != 'pair':
                    continue
                key = text(p.child_by_field_name('key')).strip("'\"")
                v = p.child_by_field_name('value')
                actions[key] = [text(v)] if v.type == 'identifier' and text(v) in named else callees(v)
                action_line[key] = line(p)

# Fonction de rendu qui affiche chaque data-action.
emitters = defaultdict(set)
stack = [tree.root_node]
while stack:
    n = stack.pop()
    stack.extend(n.children)
    if n.type in ('template_string', 'string'):
        for m in re.finditer(r'data-action="([\w-]+)"', text(n)):
            emitters[m.group(1)].add(owner_name(n) or '(module)')

# Écouteurs posés au niveau du module (une boucle sur des noms d'évènements est dépliée).
listeners = []
stack = [tree.root_node]
while stack:
    n = stack.pop()
    stack.extend(n.children)
    if n.type != 'call_expression':
        continue
    f = n.child_by_field_name('function')
    if f is None or f.type != 'member_expression' or text(f.child_by_field_name('property')) != 'addEventListener' or owner_name(n) is not None:
        continue
    args = n.child_by_field_name('arguments').named_children
    if len(args) < 2:
        continue
    ev = text(args[0])
    if args[0].type == 'identifier':
        loop = n.parent
        while loop is not None and loop.type != 'for_in_statement':
            loop = loop.parent
        right = loop.child_by_field_name('right') if loop is not None else None
        ev = ', '.join(f'`{s.strip(chr(39))}`' for s in re.findall(r"'[^']+'", text(right))) + ' (boucle)' if right is not None else ev
    else:
        ev = f'`{ev.strip(chr(39))}`'
    h = args[1]
    calls = [text(h)] if h.type == 'identifier' and text(h) in named else callees(h)
    listeners.append((line(n), text(f.child_by_field_name('object')), ev, calls))

# Utilitaires d'affichage, omis de la colonne « Puis » pour la garder lisible.
UTIL = {'esc', 'icon', 'render', 'announce', 'toast', 'fmtTime', 'fmtPhone', 'fmtDayShort', 'fmtDayTitle', 'cap', 'nb', 'nbDay',
        'digits', 'norm', 'selectorOf', 'closeModal', 'openModal', 'go', 'fullName', 'apptName', 'atMinutes', 'addDays', 'hasFormula'}

rows = []
for key in sorted(actions, key=lambda k: action_line[k]):
    direct = actions[key]
    after = [f"{c} → {', '.join(s)}" for c in direct if c not in UTIL for s in [[x for x in graph.get(c, []) if x not in UTIL]] if s]
    shown = ', '.join(sorted(emitters.get(key, []))) or '—'
    rows.append(f"| `{key}` | {shown} | L{action_line[key]} | {', '.join(direct) or '—'} | {'; '.join(after) or '—'} |")

orphans = sorted(set(emitters) - set(actions))
unused = sorted(set(actions) - set(emitters))
block = '\n'.join([
    BEGIN, '',
    f'{len(actions)} actions, {len(emitters)} gestes distincts affichés à l\'écran, {len(listeners)} écouteurs.', '',
    '## Actions (`data-action`)', '',
    '| Geste | Affiché par | Action (ligne) | Appelle | Puis (utilitaires d\'affichage omis) |', '|---|---|---|---|---|',
    *rows, '',
    '## Écouteurs du module', '', '| Ligne | Cible | Évènement | Appelle |', '|---|---|---|---|',
    *[f"| L{ln} | `{t}` | {ev} | {', '.join(c) or '—'} |" for ln, t, ev, c in sorted(listeners)], '',
    '## Contrôles', '',
    f"- Gestes affichés sans action correspondante : {', '.join(orphans) or 'aucun'}",
    f"- Actions jamais affichées par un `data-action` littéral : {', '.join(unused) or 'aucune'}", '',
    END,
])

page = OUT.read_text(encoding='utf-8') if OUT.exists() else f'# Carte des gestes\n\n{BEGIN}\n{END}\n'
start, end = page.index(BEGIN), page.index(END) + len(END)
OUT.write_text(page[:start] + block + page[end:], encoding='utf-8')
print(f'{len(actions)} actions, {len(emitters)} gestes, {len(listeners)} écouteurs → {OUT.relative_to(ROOT)}')
if orphans or unused:
    print('À vérifier :', orphans, unused)
