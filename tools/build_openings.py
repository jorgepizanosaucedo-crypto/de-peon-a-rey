#!/usr/bin/env python3
"""Arma data/openings.json: nombres de aperturas (lichess-org/chess-openings, CC0) y libro de teoría.

Uso: python3 tools/build_openings.py a.tsv b.tsv c.tsv d.tsv e.tsv --polyglot gm2001.bin:24 rodent.bin:24 komodo.bin:20:1
Salida: {"keys": claves de 7 caracteres concatenadas, "names": {clave: nombre}}
La clave es el hash FNV-1a (base 36) de las tres primeras partes del FEN, igual que en app.js.
"""
import io
import json
import os
import sys

import chess
import chess.pgn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FAMILIES = {
    "Sicilian Defense": "Defensa Siciliana", "French Defense": "Defensa Francesa", "Caro-Kann Defense": "Defensa Caro-Kann",
    "Italian Game": "Partida Italiana", "Ruy Lopez": "Apertura Española", "Scotch Game": "Partida Escocesa",
    "Queen's Gambit Declined": "Gambito de Dama Rehusado", "Queen's Gambit Accepted": "Gambito de Dama Aceptado",
    "Queen's Gambit": "Gambito de Dama", "King's Gambit Accepted": "Gambito de Rey Aceptado", "King's Gambit Declined": "Gambito de Rey Rehusado",
    "King's Gambit": "Gambito de Rey", "Petrov's Defense": "Defensa Petrov", "Philidor Defense": "Defensa Philidor",
    "Pirc Defense": "Defensa Pirc", "Modern Defense": "Defensa Moderna", "Scandinavian Defense": "Defensa Escandinava",
    "Alekhine Defense": "Defensa Alekhine", "English Opening": "Apertura Inglesa", "King's Indian Defense": "Defensa India de Rey",
    "King's Indian Attack": "Ataque Indio de Rey", "Nimzo-Indian Defense": "Defensa Nimzoindia", "Queen's Indian Defense": "Defensa India de Dama",
    "Bogo-Indian Defense": "Defensa Bogoindia", "Old Indian Defense": "Defensa India Antigua", "Indian Defense": "Defensa India",
    "Slav Defense": "Defensa Eslava", "Semi-Slav Defense": "Defensa Semieslava", "Dutch Defense": "Defensa Holandesa",
    "Grünfeld Defense": "Defensa Grünfeld", "Benoni Defense": "Defensa Benoni", "Benko Gambit": "Gambito Benko",
    "London System": "Sistema Londres", "Four Knights Game": "Partida de los Cuatro Caballos", "Three Knights Opening": "Apertura de los Tres Caballos",
    "Vienna Game": "Partida Vienesa", "Bishop's Opening": "Apertura de Alfil", "Center Game": "Partida del Centro",
    "Danish Gambit": "Gambito Danés", "Elephant Gambit": "Gambito del Elefante", "Latvian Gambit": "Gambito Letón",
    "Englund Gambit": "Gambito Englund", "Owen Defense": "Defensa Owen", "Nimzowitsch Defense": "Defensa Nimzowitsch",
    "Queen's Pawn Game": "Peón de Dama", "King's Pawn Game": "Peón de Rey", "Zukertort Opening": "Apertura Zukertort",
    "Réti Opening": "Apertura Réti", "Bird Opening": "Apertura Bird", "Catalan Opening": "Apertura Catalana",
    "Trompowsky Attack": "Ataque Trompowsky", "Colle System": "Sistema Colle", "Ponziani Opening": "Apertura Ponziani",
    "Tarrasch Defense": "Defensa Tarrasch", "Budapest Defense": "Defensa Budapest", "Blackmar-Diemer Gambit": "Gambito Blackmar-Diemer",
    "Damiano Defense": "Defensa Damiano", "Polish Opening": "Apertura Polaca", "Hungarian Opening": "Apertura Húngara",
    "Hungarian Defense": "Defensa Húngara", "Portuguese Opening": "Apertura Portuguesa", "Russian Game": "Defensa Petrov",
    "Van't Kruijs Opening": "Apertura Van't Kruijs", "Mieses Opening": "Apertura Mieses", "Grob Opening": "Apertura Grob",
    "Hippopotamus Defense": "Defensa Hipopótamo", "Rat Defense": "Defensa Rata", "St. George Defense": "Defensa San Jorge",
    "Czech Defense": "Defensa Checa", "Robatsch Defense": "Defensa Robatsch", "Saragossa Opening": "Apertura Zaragoza",
    "Clemenz Opening": "Apertura Clemenz", "Anderssen Opening": "Apertura Anderssen", "Amar Opening": "Apertura Amar",
    "Ware Opening": "Apertura Ware", "Sodium Attack": "Ataque Sodio", "Durkin Opening": "Apertura Durkin",
    "Kádas Opening": "Apertura Kádas", "Barnes Opening": "Apertura Barnes", "Nimzo-Larsen Attack": "Ataque Nimzo-Larsen",
    "Rapport-Jobava System": "Sistema Jobava", "Richter-Veresov Attack": "Ataque Veresov", "Torre Attack": "Ataque Torre",
    "Stonewall Attack": "Ataque Stonewall", "Australian Defense": "Defensa Australiana", "Lion Defense": "Defensa León",
    "Englund Gambit Declined": "Gambito Englund Rehusado", "Goldsmith Defense": "Defensa Goldsmith", "Carr Defense": "Defensa Carr",
    "Borg Defense": "Defensa Borg", "Mikenas Defense": "Defensa Mikenas", "Kangaroo Defense": "Defensa Canguro",
    "Horwitz Defense": "Defensa Horwitz", "Rousseau Gambit": "Gambito Rousseau", "Blumenfeld Countergambit": "Contragambito Blumenfeld",
    "Elephant Gambit Accepted": "Gambito del Elefante Aceptado", "Lemming Defense": "Defensa Lemming", "Gunderam Defense": "Defensa Gunderam",
    "Pterodactyl Defense": "Defensa Pterodáctilo", "Semi-Bononi": "Semi-Benoni", "Wade Defense": "Defensa Wade",
    "Ward Defense": "Defensa Ward", "Valencia Opening": "Apertura Valencia", "Vulture Defense": "Defensa Buitre",
}


def key(fen):
    s = " ".join(fen.split(" ")[:3])
    x = 2166136261
    for ch in s:
        x ^= ord(ch)
        x = (x * 16777619) & 0xFFFFFFFF
    return base36(x)


def base36(n):
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = chars[r] + out
    return out


def es_name(name):
    fam, _, var = name.partition(":")
    fam_es = FAMILIES.get(fam.strip(), fam.strip())
    return fam_es + (" · " + var.strip() if var else "")


def walk_polyglot(path, max_ply=24, min_weight=0):
    """Todas las posiciones del árbol de un libro polyglot hasta max_ply jugadas."""
    import chess.polyglot
    keys, seen, stack = set(), set(), [(chess.Board(), 0)]
    with chess.polyglot.open_reader(path) as r:
        while stack:
            b, ply = stack.pop()
            epd = b.epd()
            if epd in seen or ply >= max_ply:
                continue
            seen.add(epd)
            for e in r.find_all(b, minimum_weight=min_weight):
                nb = b.copy(stack=False)
                nb.push(e.move)
                keys.add(key(nb.fen()))
                stack.append((nb, ply + 1))
    return keys


def main(argv):
    """argv: archivos .tsv de lichess-org/chess-openings y, opcionalmente, --polyglot libro.bin[:max_ply[:peso_min]] ..."""
    paths, books = [], []
    mode = "tsv"
    for a in argv:
        if a == "--polyglot":
            mode = "bin"; continue
        (books if mode == "bin" else paths).append(a)
    book, names = set(), {}
    for spec in books:
        parts = spec.split(":")
        found = walk_polyglot(parts[0], int(parts[1]) if len(parts) > 1 else 24, int(parts[2]) if len(parts) > 2 else 0)
        print(os.path.basename(parts[0]), len(found), "posiciones")
        book |= found
    for p in paths:
        for line in open(p, encoding="utf-8").read().splitlines()[1:]:
            eco, name, pgn = line.split("\t")[:3]
            game = chess.pgn.read_game(io.StringIO(pgn))
            b = game.board()
            for mv in game.mainline_moves():
                b.push(mv)
                book.add(key(b.fen()))
            k = key(b.fen())
            # nombre más corto gana si dos líneas llegan a la misma posición
            nm = es_name(name)
            if k not in names or len(nm) < len(names[k]):
                names[k] = nm
    # claves de 7 caracteres pegadas en una sola cadena: ocupa la mitad que una lista JSON
    out = {"keys": "".join(k.rjust(7, "0") for k in sorted(book)), "names": names}
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    path = os.path.join(ROOT, "data", "openings.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(book), "posiciones de libro,", len(names), "nombres,", os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1:])
