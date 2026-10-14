#!/usr/bin/env python3
"""Revisa puzzles con Stockfish a mayor profundidad y deja solo los buenos.

Tácticos (fen, moves, rating, themes):
  - en cada jugada del que resuelve, la solución debe ser la mejor jugada del motor
  - y debe ser ÚNICA: la segunda mejor tiene que ser claramente peor
    (excepto la jugada final de un mate: la app acepta cualquier mate)
  - al final de la línea, el que resuelve debe quedar ganando
Defensa (fen, last, threat, ok):
  - la amenaza sigue siendo real a más profundidad
  - se recalculan las defensas válidas; debe haber pocas (si casi todo sirve, no es ejercicio)

Uso:
  python3 verify_puzzles.py tacticos ENTRADA.jsonl SALIDA.jsonl [procesos]
  python3 verify_puzzles.py defensa  ENTRADA.jsonl SALIDA.jsonl [procesos]
"""
import json
import math
import multiprocessing as mp
import os
import shutil
import sys

import chess
import chess.engine

# ruta de Stockfish: variable STOCKFISH, o el que esté en el PATH
ENGINE = os.environ.get("STOCKFISH") or shutil.which("stockfish") or "/usr/games/stockfish"
MATE = 100000
TACTIC_DEPTH = 18
THREAT_DEPTH = 16


def cp_of(score, pov):
    s = score.pov(pov)
    if s.is_mate():
        m = s.mate()
        return MATE - abs(m) * 100 if m > 0 else -MATE + abs(m) * 100
    return s.score()


def wc(cp):
    cp = max(-2000, min(2000, cp))
    return 2 / (1 + math.exp(-0.00368208 * cp)) - 1


def winp(cp):
    return 50 + 50 * wc(cp)


_eng = None


def eng():
    global _eng
    if _eng is None:
        _eng = chess.engine.SimpleEngine.popen_uci(ENGINE)
        _eng.configure({"Hash": 64, "Threads": 1})
    return _eng


def verify_tactic(rec):
    try:
        e = eng()
        b = chess.Board(rec["fen"])
        moves = [chess.Move.from_uci(u) for u in rec["moves"]]
        if moves[0] not in b.legal_moves:
            return None
        b.push(moves[0])
        solver = b.turn
        mate_puzzle = any(t.startswith("mateIn") for t in rec["themes"])
        for i in range(1, len(moves), 2):
            sol = moves[i]
            if sol not in b.legal_moves:
                return None
            final = i == len(moves) - 1
            infos = e.analyse(b, chess.engine.Limit(depth=TACTIC_DEPTH), multipv=2)
            s1 = cp_of(infos[0]["score"], solver)
            m1 = infos[0]["pv"][0]
            s2 = cp_of(infos[1]["score"], solver) if len(infos) > 1 else -MATE
            after = b.copy(stack=False)
            after.push(sol)
            if final and after.is_checkmate():
                pass  # la app acepta cualquier mate en la última jugada
            else:
                if m1 != sol:
                    return None
                if s1 >= MATE - 5000:  # línea de mate: la segunda no puede ser mate también
                    if s2 >= MATE - 5000 and not final:
                        return None
                elif wc(s1) - wc(s2) < 0.35:
                    return None
            b.push(sol)
            if i + 1 < len(moves):
                if moves[i + 1] not in b.legal_moves:
                    return None
                b.push(moves[i + 1])
        if not b.is_checkmate():
            end = e.analyse(b, chess.engine.Limit(depth=14))
            if cp_of(end["score"], solver) < 200:
                return None
        return rec
    except Exception:
        return None


def verify_threat(rec):
    try:
        e = eng()
        b = chess.Board(rec["fen"])
        last = chess.Move.from_uci(rec["last"])
        if last not in b.legal_moves:
            return None
        b.push(last)
        d = b.turn
        if b.is_check():
            return None
        now = cp_of(e.analyse(b, chess.engine.Limit(depth=THREAT_DEPTH))["score"], d)
        nb = b.copy(stack=False)
        nb.push(chess.Move.null())
        info = e.analyse(nb, chess.engine.Limit(depth=THREAT_DEPTH))
        if not info.get("pv") or info["pv"][0].uci() != rec["threat"]:
            return None
        null_ev = -cp_of(info["score"], nb.turn)
        if now - null_ev < 250:
            return None
        legal = list(b.legal_moves)
        infos = e.analyse(b, chess.engine.Limit(depth=14), multipv=len(legal))
        scored = sorted(((cp_of(i["score"], d), i["pv"][0]) for i in infos if i.get("pv")), key=lambda x: -x[0])
        best = scored[0][0]
        if best < -150:
            return None
        ok = [m.uci() for (s, m) in scored if winp(best) - winp(s) <= 8]
        if not ok or len(ok) > max(3, int(0.35 * len(legal))):
            return None
        out = dict(rec)
        out["ok"] = ok
        return out
    except Exception:
        return None


def main():
    kind, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    procs = int(sys.argv[4]) if len(sys.argv) > 4 else 2
    recs, seen = [], set()
    for line in open(src):
        r = json.loads(line)
        key = (r["fen"], r.get("last"))
        if key in seen:
            continue
        seen.add(key)
        recs.append(r)
    fn = verify_tactic if kind.startswith("t") else verify_threat
    kept = 0
    with mp.Pool(procs) as pool, open(dst, "w") as out:
        for n, r in enumerate(pool.imap_unordered(fn, recs, chunksize=4), 1):
            if r:
                out.write(json.dumps(r) + "\n")
                kept += 1
            if n % 50 == 0:
                print(f"{n}/{len(recs)} revisados, {kept} aprobados", flush=True)
    print(f"listo: {kept} de {len(recs)} aprobados ({100 * kept // max(1, len(recs))}%)")


if __name__ == "__main__":
    main()
