#!/usr/bin/env python3
"""Agrega puzzles reales de Lichess (licencia CC0) al proyecto.

Descarga la base oficial (https://database.lichess.org/#puzzles, unos 300 MB comprimida),
la lee sin descomprimirla a disco y se queda con una muestra variada: puzzles populares,
jugados muchas veces, entre 500 y 1800 de rating, repartidos por tema y dificultad.

Requisitos (en tu computadora):
    pip install zstandard

Uso:
    python tools/lichess_puzzles.py                 # descarga y crea data/puzzles-lichess.jsonl
    python tools/lichess_puzzles.py archivo.csv.zst # usa un archivo ya descargado (.csv o .csv.zst)
    python tools/lichess_puzzles.py --por-grupo 40  # cuántos puzzles por tema y franja de 100 de rating

Después arma el sitio incluyéndolos:
    python tools/build.py data/puzzles-generados.jsonl data/puzzles-lichess.jsonl --threats data/puzzles-defensa.jsonl
"""
import csv
import io
import json
import os
import random
import sys
import urllib.request

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "puzzles-lichess.jsonl")
KEEP = ["mateIn1", "mateIn2", "mateIn3", "hangingPiece", "fork", "pin", "skewer", "discoveredAttack", "backRankMate", "promotion", "advantage"]
# tema principal que decide el mundo (mismo orden de prioridad que build.py)
PRIMARY = ["discoveredAttack", "pin", "skewer", "fork", "mateIn2", "mateIn1", "hangingPiece", "mateIn3", "backRankMate", "promotion", "advantage"]


def open_source(path):
    if path is None:
        print("Descargando", URL, "(puede tardar unos minutos)…", flush=True)
        raw = urllib.request.urlopen(URL)
    else:
        raw = open(path, "rb")
    name = (path or URL).lower()
    if name.endswith(".zst"):
        try:
            import zstandard
        except ImportError:
            sys.exit("Falta el módulo zstandard. Instálalo con: pip install zstandard")
        raw = zstandard.ZstdDecompressor().stream_reader(raw)
    return io.TextIOWrapper(raw, encoding="utf-8", newline="")


def main(argv):
    per_group, path = 40, None
    if "--por-grupo" in argv:
        i = argv.index("--por-grupo"); per_group = int(argv[i + 1]); del argv[i:i + 2]
    if argv:
        path = argv[0]
    rng = random.Random(2026)
    groups = {}  # (tema, franja) -> reservorio
    seen = 0
    for row in csv.DictReader(open_source(path)):
        seen += 1
        if seen % 500000 == 0:
            print(f"{seen:,} puzzles leídos…", flush=True)
        try:
            rating, pop, plays, rd = int(row["Rating"]), int(row["Popularity"]), int(row["NbPlays"]), int(row["RatingDeviation"])
        except (KeyError, ValueError):
            continue
        if not (500 <= rating <= 1800) or pop < 85 or plays < 1000 or rd > 90:
            continue
        themes = row["Themes"].split()
        main_theme = next((t for t in PRIMARY if t in themes), None)
        if not main_theme:
            continue
        key = (main_theme, rating // 100)
        bucket = groups.setdefault(key, [0, []])
        bucket[0] += 1
        rec = {"fen": row["FEN"], "moves": row["Moves"].split(), "rating": rating,
               "themes": [t for t in themes if t in KEEP] or ["advantage"], "src": "lichess", "id": row["PuzzleId"]}
        # muestreo de reservorio: cada puzzle válido tiene la misma probabilidad de quedar
        if len(bucket[1]) < per_group:
            bucket[1].append(rec)
        else:
            j = rng.randrange(bucket[0])
            if j < per_group:
                bucket[1][j] = rec
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    n = 0
    with open(OUT, "w") as out:
        for key in sorted(groups):
            for rec in groups[key][1]:
                out.write(json.dumps(rec) + "\n"); n += 1
    print(f"Listo: {n} puzzles de Lichess en {OUT} (de {seen:,} leídos)")


if __name__ == "__main__":
    main(sys.argv[1:])
