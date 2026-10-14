#!/usr/bin/env python3
"""Generador de puzzles de defensa: "¿Qué amenaza tu rival?".

Simula partidas entre motores debilitados y busca posiciones donde la ÚLTIMA jugada del
rival crea una amenaza seria (ganar una pieza de 3 o más, o dar mate), ya sea con la pieza
que se movió o destapando una línea. Para cada una guarda las defensas que mantienen la
posición (calculadas con Stockfish revisando todas las jugadas legales).

Formato (una línea JSON por puzzle):
  fen     posición ANTES de la jugada del rival
  last    jugada del rival (UCI) que crea la amenaza
  threat  lo que amenaza (UCI, desde la posición tras `last` si fuera su turno)
  ok      defensas válidas (UCI), la primera es la mejor
  mate    true si la amenaza es de mate
  rating  dificultad estimada

Uso: python3 gen_threats.py SALIDA.jsonl MINUTOS SEMILLA
"""
import json
import math
import os
import random
import shutil
import sys
import time

import chess
import chess.engine

# ruta de Stockfish: variable STOCKFISH, o el que esté en el PATH
ENGINE = os.environ.get("STOCKFISH") or shutil.which("stockfish") or "/usr/games/stockfish"
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
SCAN = chess.engine.Limit(depth=9)
DEEP = chess.engine.Limit(depth=12)
MATE_CP = 100000


def cp_of(score, pov):
    s = score.pov(pov)
    if s.is_mate():
        m = s.mate()
        return MATE_CP - abs(m) * 100 if m > 0 else -MATE_CP + abs(m) * 100
    return s.score()


def winp(cp):
    cp = max(-2000, min(2000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def threat_of(eng, board, limit):
    """Si el bando que mueve 'pasara', ¿qué haría el rival? Devuelve (jugada, eval_nula) desde el punto de vista del que mueve."""
    nb = board.copy(stack=False)
    nb.push(chess.Move.null())
    info = eng.analyse(nb, limit)
    if "pv" not in info or not info["pv"]:
        return None, None
    return info["pv"][0], -cp_of(info["score"], nb.turn)


def check_position(ana, board, last, fen_before):
    """board: defensor al turno, justo después de `last`."""
    if board.is_check() or board.is_game_over():
        return None
    # si el rival acaba de capturar, lo natural es recapturar: no es un ejercicio de "ver la amenaza"
    pre = chess.Board(fen_before)
    if pre.is_capture(last):
        return None
    d = board.turn
    now = cp_of(ana.analyse(board, SCAN)["score"], d)
    if not (-250 <= now <= 450):
        return None
    thr, null_ev = threat_of(ana, board, SCAN)
    if thr is None or now - null_ev < 250:
        return None
    nb = board.copy(stack=False)
    nb.push(chess.Move.null())
    # la amenaza debe venir de la última jugada: la pieza movida, o una línea que se destapó
    direct = thr.from_square == last.to_square
    discovered = last.from_square in chess.SquareSet(chess.between(thr.from_square, thr.to_square))
    if not (direct or discovered):
        return None
    after = nb.copy(stack=False)
    after.push(thr)
    is_mate = after.is_checkmate() or null_ev <= -MATE_CP + 2000
    captured = nb.piece_at(thr.to_square)
    if not is_mate and (not captured or VAL[captured.piece_type] < 3):
        return None
    # confirmar con más profundidad
    thr2, null2 = threat_of(ana, board, DEEP)
    if thr2 != thr:
        return None
    legal = list(board.legal_moves)
    if len(legal) < 4:
        return None
    infos = ana.analyse(board, DEEP, multipv=len(legal))
    scored = [(cp_of(i["score"], d), i["pv"][0]) for i in infos if "pv" in i and i["pv"]]
    scored.sort(key=lambda x: -x[0])
    best_cp = scored[0][0]
    if best_cp < -150 or best_cp - null2 < 200:
        return None
    ok = [m for (s, m) in scored if winp(best_cp) - winp(s) <= 8]
    if not ok or len(ok) > max(3, int(0.35 * len(legal))):
        return None
    mover = nb.piece_at(thr.from_square)
    rating = 680
    if discovered and not direct:
        rating += 250
    if is_mate:
        rating += 200
    if len(ok) <= 1:
        rating += 150
    elif len(ok) == 2:
        rating += 80
    if captured and captured.piece_type == chess.QUEEN:
        rating -= 40
    if mover and mover.piece_type == chess.PAWN:
        rating -= 50
    rating += (len(board.piece_map()) - 16) * 5
    return {"fen": fen_before, "last": last.uci(), "threat": thr.uci(), "ok": [m.uci() for m in ok],
            "mate": bool(is_mate), "disc": bool(discovered and not direct), "rating": int(max(600, min(1400, rating)))}


seen = set()


def play_and_mine(player, ana, rng, out, stats):
    board = chess.Board()
    skills = {chess.WHITE: rng.randint(0, 8), chess.BLACK: rng.randint(0, 8)}
    opening = rng.randint(2, 8)
    found_in_game = 0
    for ply in range(140):
        if board.is_game_over():
            break
        if ply < opening:
            infos = player.analyse(board, chess.engine.Limit(depth=6), multipv=4)
            mv = rng.choice([i["pv"][0] for i in infos if "pv" in i])
        else:
            player.configure({"Skill Level": skills[board.turn]})
            mv = player.play(board, chess.engine.Limit(depth=rng.randint(1, 4), time=0.03)).move
        fen_before = board.fen()
        board.push(mv)
        if ply >= max(opening, 6) and found_in_game < 3 and fen_before not in seen:
            seen.add(fen_before)
            stats["checked"] += 1
            rec = check_position(ana, board, mv, fen_before)
            if rec:
                out.write(json.dumps(rec) + "\n")
                out.flush()
                stats["ok"] += 1
                found_in_game += 1
        if len(board.piece_map()) < 8:
            break


def main():
    out_path, minutes, seed = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
    rng = random.Random(seed)
    player = chess.engine.SimpleEngine.popen_uci(ENGINE)
    ana = chess.engine.SimpleEngine.popen_uci(ENGINE)
    ana.configure({"Hash": 64, "Threads": 1})
    player.configure({"Hash": 16, "Threads": 1})
    stats = {"checked": 0, "ok": 0, "games": 0}
    end = time.time() + minutes * 60
    with open(out_path, "a") as out:
        while time.time() < end:
            try:
                play_and_mine(player, ana, rng, out, stats)
            except chess.engine.EngineError as e:
                print("engine error", e, file=sys.stderr)
            stats["games"] += 1
            print(json.dumps(stats), file=sys.stderr, flush=True)
    player.quit()
    ana.quit()


if __name__ == "__main__":
    main()
