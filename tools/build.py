#!/usr/bin/env python3
"""Arma la app a partir de src/ y los puzzles generados.

Salidas:
  docs/                  sitio listo para GitHub Pages (index.html, motor, aperturas, íconos)
  dist/site/             la misma copia, para cualquier otro hosting estático (Netlify, Cloudflare Pages)
  dist/app.html          solo el cuerpo de la página (lo usan las pruebas)

Solo necesita Python 3 (sin paquetes extra).

Uso: python3 tools/build.py puzzles1.jsonl [puzzles2.jsonl ...] [--threats amenazas.jsonl ...]
Sin argumentos usa los puzzles revisados de data/:
  python3 tools/build.py
También acepta el CSV oficial de Lichess (lichess_db_puzzle.csv) para usar puzzles reales:
  python3 tools/build.py --lichess lichess_db_puzzle.csv
"""
import base64
import csv
import hashlib
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
ORDER = ["mate1", "hanging", "defense", "fork", "mate2", "pin", "discovered", "mix"]
CAP = 300  # hasta 20 niveles con un banco de ~15 puzzles cada uno (rotan al repetir)
# Cada puzzle conserva su id entre versiones (el repaso y los "ya vistos" de cada persona los usan).
# El registro guarda huella (fen + primera jugada) -> id; los puzzles nuevos reciben ids nuevos.
IDS = os.path.join(ROOT, "data", "puzzle-ids.json")


def huella(fen, first):
    return hashlib.sha1((fen + "|" + first).encode("utf-8")).hexdigest()[:12]


def world_of(themes):
    t = set(themes)
    if "discoveredAttack" in t:
        return "discovered"
    if t & {"pin", "skewer"}:
        return "pin"
    if "fork" in t:
        return "fork"
    if "mateIn2" in t:
        return "mate2"
    if "mateIn1" in t:
        return "mate1"
    if "hangingPiece" in t:
        return "hanging"
    return "mix"


def load_generated(paths):
    seen, out = set(), []
    for p in paths:
        for line in open(p, encoding="utf-8"):
            r = json.loads(line)
            if r["fen"] in seen:
                continue
            seen.add(r["fen"])
            out.append((r["fen"], r["moves"], r["rating"], r["themes"]))
    return out


def load_lichess(path, max_rating=1700, min_rating=500):
    keep = {"mateIn1", "mateIn2", "hangingPiece", "fork", "pin", "skewer", "discoveredAttack", "backRankMate", "advantage", "promotion", "mateIn3"}
    out = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rating = int(row["Rating"])
            if not (min_rating <= rating <= max_rating) or int(row["Popularity"]) < 80 or int(row["NbPlays"]) < 500:
                continue
            themes = [t for t in row["Themes"].split() if t in keep] or ["advantage"]
            out.append((row["FEN"], row["Moves"].split(), rating, themes))
    return out


def piece_at(fen, sq):
    """Pieza en una casilla ('e4') según el FEN, o None."""
    rows = fen.split()[0].split("/")
    row, col = rows[8 - int(sq[1])], 0
    for ch in row:
        if ch.isdigit():
            col += int(ch)
            continue
        if col == ord(sq[0]) - 97:
            return ch
        col += 1
    return None


def load_threats(paths, cap=CAP):
    """Puzzles de defensa: sin repetidos, con variedad (pocas amenazas de peón) y repartidos por dificultad."""
    seen_fen, seen_sig, out = set(), set(), []
    for p in paths:
        for line in open(p, encoding="utf-8"):
            r = json.loads(line)
            sig = (r["last"], r["threat"])
            if r["fen"] in seen_fen or sig in seen_sig:
                continue
            seen_fen.add(r["fen"]); seen_sig.add(sig)
            mover = piece_at(r["fen"], r["last"][:2])
            r["pawn"] = bool(mover and mover in "pP" and r["threat"][:2] == r["last"][2:4])
            out.append(r)
    # variedad: algunas amenazas de mate y de ataque descubierto siempre entran
    reg = registro()
    key = lambda r: huella(r["fen"], r["last"])
    special = [r for r in out if r["mate"]][:24] + [r for r in out if r.get("disc") and not r["mate"]][:24]
    rest = [r for r in out if r not in special]
    pawns = [r for r in rest if r["pawn"]]
    others = [r for r in rest if not r["pawn"]]
    keep_pawns = int(cap * 0.3)
    pool = others + keep_spread(sorted(pawns, key=lambda r: r["rating"]), keep_pawns, reg, key)
    pool = special + keep_spread(sorted(pool, key=lambda r: r["rating"]), cap - len(special), reg, key)
    return [(r["fen"], [r["last"], r["threat"]], r["rating"], ["defense"], r["ok"], r["mate"]) for r in pool]


def spread(items, k):
    """k elementos repartidos por todo el rango de dificultad."""
    if len(items) <= k:
        return items
    step = len(items) / k
    return [items[int(i * step)] for i in range(k)]


def registro():
    return json.load(open(IDS, encoding="utf-8")) if os.path.exists(IDS) else {}


def keep_spread(items, k, reg, key):
    """Como spread, pero los puzzles que ya se publicaron antes (tienen id) se quedan siempre:
    el repaso y los "ya vistos" de cada persona los siguen encontrando. Los nuevos llenan el resto."""
    if len(items) <= k:
        return items
    old = [x for x in items if key(x) in reg]
    if len(old) >= k:
        return sorted(spread(old, k), key=lambda x: x[2] if isinstance(x, tuple) else x["rating"])
    new = [x for x in items if key(x) not in reg]
    out = old + spread(new, k - len(old))
    return sorted(out, key=lambda x: x[2] if isinstance(x, tuple) else x["rating"])


def build_worlds(puzzles, threats=()):
    reg = registro()
    key = lambda p: huella(p[0], p[1][0])
    buckets = {k: [] for k in ORDER}
    for p in puzzles:
        buckets[world_of(p[3])].append(p)
    overflow = []
    for k in ORDER[:-1]:
        if k == "defense":
            continue
        b = sorted(buckets[k], key=lambda p: p[2])
        if len(b) > CAP:
            chosen = keep_spread(b, CAP, reg, key)
            ids = {id(x) for x in chosen}
            overflow += [x for x in b if id(x) not in ids]
            b = chosen
        if len(b) < 30:  # muy pocos para un mundo propio (al menos 3 niveles)
            overflow += b
            b = []
        buckets[k] = b
    mix = sorted(buckets["mix"] + [p for p in overflow if p[2] >= 900], key=lambda p: p[2])
    buckets["mix"] = keep_spread(mix, CAP, reg, key)
    buckets["defense"] = sorted(threats, key=lambda p: p[2])
    n = max([int(v[1:], 16) for v in reg.values()] or [0])
    worlds = {}
    for k in ORDER:
        b = buckets[k]
        # múltiplo de 5 (cada intento son 5): sobran a lo más 4, y se quitan de los nuevos para no perder ninguno publicado
        extra = len(b) % 5
        if extra:
            drop = [i for i in range(len(b) - 1, -1, -1) if key(b[i]) not in reg][:extra]
            drop += [i for i in range(len(b) - 1, -1, -1) if i not in drop][: extra - len(drop)]
            b = [x for i, x in enumerate(b) if i not in set(drop)]
        rows = []
        for item in b:
            fen, moves, rating, themes = item[:4]
            h = huella(fen, moves[0])
            if h not in reg:
                n += 1
                reg[h] = "p" + format(n, "x")
            row = [reg[h], fen, " ".join(moves), int(rating), " ".join(themes)]
            if k == "defense":
                row += [" ".join(item[4]), 1 if item[5] else 0]
            rows.append(row)
        worlds[k] = rows
    order = [k for k in ORDER if worlds[k]]
    with open(IDS, "w", encoding="utf-8") as f:
        json.dump(reg, f, separators=(",", ":"))
    return {"order": order, "worlds": worlds}


def pieces_defs():
    sprite = open(os.path.join(SRC, "pieces-sprite.svg"), encoding="utf-8").read()
    groups = []
    for code in ["wk", "wq", "wb", "wn", "wr", "wp", "bk", "bq", "bb", "bn", "br", "bp"]:
        m = re.search(r'(<g id="%s"[\s\S]*?)(?=\n\s*<g id="(?:[wb][kqbnrp]|marker\w*)")' % code, sprite)
        g = m.group(1).rstrip()
        g = re.sub(r'\s+id="(?:Shape|Group|Oval|Path|Rectangle)[^"]*"', "", g)
        groups.append("    " + re.sub(r"\n\s+", " ", g))
    return "\n".join(groups)


def csp_for(page):
    """Política de seguridad de contenido (CSP).

    Solo deja ejecutar el código propio: los scripts del sitio y el script en línea de la app (por su hash
    SHA-256, que cambia si alguien lo altera). Lo externo permitido es lo mínimo: las APIs de Chess.com y
    Lichess, y los servicios de Google/Firebase que usan las cuentas. Si agregas otro servicio, súmalo aquí.
    """
    inline = re.findall(r"<script>([\s\S]*?)</script>", page)
    hashes = " ".join("'sha256-%s'" % base64.b64encode(hashlib.sha256(x.encode("utf-8")).digest()).decode() for x in inline)
    firebase = {
        "script": "https://apis.google.com https://www.gstatic.com",
        "connect": "https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://apis.google.com",
        "frame": "https://*.firebaseapp.com https://*.web.app https://accounts.google.com https://apis.google.com",
    }
    rules = [
        "default-src 'self'",
        f"script-src 'self' {hashes} {firebase['script']}",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: blob: https://*.googleusercontent.com",
        f"connect-src 'self' https://api.chess.com https://lichess.org {firebase['connect']}",
        f"frame-src {firebase['frame']}",
        "worker-src 'self'",
        "manifest-src 'self'",
        "media-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
    return "; ".join(rules)


def head_html(page=""):
    """<head> del sitio: seguridad, metadatos, íconos y vista previa para redes."""
    cfg = json.load(open(os.path.join(ROOT, "config", "site.json"), encoding="utf-8"))
    url = cfg.get("url", "")
    base = url if url.startswith("http") and "TU-USUARIO" not in url else ""
    esc = lambda t: t.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    title, desc = esc(cfg["title"]), esc(cfg["description"])
    tags = [
        '<!doctype html>', '<html lang="es">', '<head>', '<meta charset="utf-8">',
        f'<meta http-equiv="Content-Security-Policy" content="{csp_for(page)}">',
        '<meta name="referrer" content="strict-origin-when-cross-origin">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        f'<meta name="description" content="{desc}">',
        '<meta name="theme-color" content="#f4f2f8" media="(prefers-color-scheme: light)">',
        '<meta name="theme-color" content="#141020" media="(prefers-color-scheme: dark)">',
        '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
        '<link rel="icon" href="icon-192.png" type="image/png" sizes="192x192">',
        '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
        '<link rel="manifest" href="manifest.webmanifest">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{title}">',
        f'<meta property="og:description" content="{desc}">',
        f'<meta property="og:image" content="{base}og.png">',
        '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
        '<meta property="og:locale" content="es_MX">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    if base:
        tags += [f'<meta property="og:url" content="{base}">', f'<link rel="canonical" href="{base}">']
    tags.append('<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>')
    tags.append('<script src="firebase-config.js"></script>')
    return "\n".join(tags) + "\n"


def main(argv):
    if not argv:
        argv = [os.path.join(ROOT, "data", "puzzles-generados.jsonl"), "--threats", os.path.join(ROOT, "data", "puzzles-defensa.jsonl")]
        extra = os.path.join(ROOT, "data", "puzzles-lichess.jsonl")
        if os.path.exists(extra):
            argv.insert(1, extra)
    threat_files = []
    if "--threats" in argv:
        i = argv.index("--threats"); threat_files = argv[i + 1:]; argv = argv[:i]
    if argv and argv[0] == "--lichess":
        puzzles = load_lichess(argv[1])
    else:
        puzzles = load_generated(argv)
    data = build_worlds(puzzles, load_threats(threat_files) if threat_files else ())
    counts = {k: len(v) for k, v in data["worlds"].items()}
    print("puzzles por mundo:", counts, "total", sum(counts.values()))
    rd = lambda name: open(os.path.join(SRC, name), encoding="utf-8").read()
    # un solo script: contenido de la Escuela, funciones de la Escuela y la app (en ese orden)
    app_js = rd("lessons.js") + "\n" + rd("school.js") + "\n" + rd("app.js")
    tpl, sample, css = rd("app.template.html"), rd("sample.json"), rd("styles.css")
    page = (tpl.replace("{{STYLES}}", css.strip())
               .replace("{{PIECES}}", pieces_defs())
               .replace("{{PUZZLES}}", json.dumps(data, separators=(",", ":")))
               .replace("{{SAMPLE}}", sample.replace("</", "<\\/"))
               .replace("{{APPJS}}", app_js))
    os.makedirs(os.path.join(DIST, "site", "engine"), exist_ok=True)
    open(os.path.join(DIST, "app.html"), "w", encoding="utf-8").write(page)
    head = head_html(page)
    title_end = page.index("</style>") + len("</style>")
    site = head + page[:title_end] + "\n</head>\n<body>\n" + page[title_end:] + "\n</body>\n</html>\n"
    open(os.path.join(DIST, "site", "index.html"), "w", encoding="utf-8").write(site)
    # íconos, vista previa y dibujos de la mascota (con subcarpetas)
    shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(DIST, "site"), dirs_exist_ok=True)
    for f in os.listdir(os.path.join(ROOT, "engine")):
        shutil.copy(os.path.join(ROOT, "engine", f), os.path.join(DIST, "site", "engine", f))
    # la configuración de cuentas se edita directo en dist/site: nunca se sobrescribe
    cfg = os.path.join(DIST, "site", "firebase-config.js")
    if not os.path.exists(cfg):
        shutil.copy(os.path.join(ROOT, "config", "firebase-config.js"), cfg)
    os.makedirs(os.path.join(DIST, "site", "data"), exist_ok=True)
    shutil.copy(os.path.join(ROOT, "data", "openings.json"), os.path.join(DIST, "site", "data", "openings.json"))
    # sitio estático puro: GitHub Pages no necesita procesarlo con Jekyll (publica más rápido)
    open(os.path.join(DIST, "site", ".nojekyll"), "w").close()
    # copia para GitHub Pages (rama main, carpeta /docs); firebase-config.js de docs nunca se sobrescribe
    docs = os.path.join(ROOT, "docs")
    for base, _, files in os.walk(os.path.join(DIST, "site")):
        rel = os.path.relpath(base, os.path.join(DIST, "site"))
        os.makedirs(os.path.join(docs, rel), exist_ok=True)
        for f in files:
            dst = os.path.join(docs, rel, f)
            if f == "firebase-config.js" and os.path.exists(dst):
                continue
            shutil.copy(os.path.join(base, f), dst)
    # dibujos de la mascota que ya no están en assets/ (capas viejas): fuera del sitio, para no publicarlos
    keep = set(os.listdir(os.path.join(ROOT, "assets", "mascota")))
    for folder in (os.path.join(DIST, "site", "mascota"), os.path.join(docs, "mascota")):
        for f in os.listdir(folder):
            if f not in keep:
                os.remove(os.path.join(folder, f))
    print("listo: docs/index.html,", len(site) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1:])
