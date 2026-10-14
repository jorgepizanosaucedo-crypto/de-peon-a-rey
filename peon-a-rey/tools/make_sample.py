#!/usr/bin/env python3
"""Crea una partida de ejemplo simulada (dos motores debilitados) con errores típicos de nivel 600-800."""
import json
import random
import sys

import chess
import chess.engine
import chess.pgn

ENGINE = "/usr/games/stockfish"


def main(out_path, seed=7):
    rng = random.Random(seed)
    eng = chess.engine.SimpleEngine.popen_uci(ENGINE)
    ana = chess.engine.SimpleEngine.popen_uci(ENGINE)
    for attempt in range(40):
        board = chess.Board()
        blunders = 0
        ev = 30  # evaluación (punto de vista de blancas) antes de cada jugada
        while not board.is_game_over() and board.ply() < 90:
            skill = 2 if board.turn == chess.WHITE else 4
            eng.configure({"Skill Level": skill})
            mv = eng.play(board, chess.engine.Limit(depth=rng.randint(2, 4), time=0.05)).move
            mover = board.turn
            board.push(mv)
            after = ana.analyse(board, chess.engine.Limit(depth=10))["score"].pov(chess.WHITE).score(mate_score=10000)
            if mover == chess.WHITE and ev - after > 300 and -200 <= ev <= 250:
                blunders += 1
            ev = after
        if 3 <= blunders <= 5 and board.is_checkmate() and 40 <= board.ply() <= 90:
            break
    game = chess.pgn.Game.from_board(board)
    game.headers["Event"] = "Partida de ejemplo"
    game.headers["Site"] = "De Peón a Rey"
    game.headers["Date"] = "????.??.??"
    game.headers["White"] = "Tú"
    game.headers["Black"] = "Rival"
    game.headers["WhiteElo"] = "650"
    game.headers["BlackElo"] = "700"
    pgn = str(game)
    res = board.result()
    data = {"pgn": pgn, "userColor": "w", "opp": "Rival", "oppRating": 700,
            "userResult": "win" if res == "1-0" else "loss" if res == "0-1" else "draw", "date": "Ejemplo"}
    json.dump(data, open(out_path, "w"), ensure_ascii=False)
    print(pgn)
    print("blunders", blunders, "plies", board.ply(), "attempts", attempt + 1)
    eng.quit()
    ana.quit()


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 7)
