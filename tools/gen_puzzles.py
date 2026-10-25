#!/usr/bin/env python3
"""Generador de puzzles tácticos con Stockfish.

Juega partidas entre motores debilitados (cometen errores como jugadores de
600-1400), detecta las jugadas que regalan ventaja y convierte cada una en un
puzzle con solución única. Cada puzzle sigue el formato de la base de Lichess:
  fen   = posición ANTES del error del rival
  moves = [error_rival, solución1, respuesta1, solución2, ...] en UCI

Uso: python3 gen_puzzles.py SALIDA.jsonl MINUTOS SEMILLA
     GEN_SALTAR=mate1 python3 gen_puzzles.py ...   # no buscar más mates en 1 (ya hay de sobra)
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
QUICK = chess.engine.Limit(depth=10)
DEEP = chess.engine.Limit(depth=14)
# temas que ya sobran y no vale la pena seguir buscando (variable GEN_SALTAR, p. ej. "mate1")
SKIP = set(filter(None, os.environ.get("GEN_SALTAR", "").split(",")))
MATE_CP = 100000


def cp_of(score, pov):
    s = score.pov(pov)
    if s.is_mate():
        m = s.mate()
        return MATE_CP - abs(m) * 100 if m > 0 else -MATE_CP + abs(m) * 100
    return s.score()


def wc(cp):
    cp = max(-2000, min(2000, cp))
    return 2 / (1 + math.exp(-0.00368208 * cp)) - 1


def material(board, color):
    return sum(VAL[p.piece_type] for p in board.piece_map().values() if p.color == color)


def balance(board, color):
    return material(board, color) - material(board, not color)


def multipv2(eng, board, limit=DEEP):
    infos = eng.analyse(board, limit, multipv=2)
    pov = board.turn
    best = infos[0]
    s1 = cp_of(best["score"], pov)
    m1 = best["pv"][0]
    s2 = cp_of(infos[1]["score"], pov) if len(infos) > 1 else -MATE_CP
    return m1, s1, s2, best


def unique_enough(s1, s2, slack=0.0):
    if s1 >= MATE_CP - 5000:  # mate for solver
        return s2 < MATE_CP - 5000 and (s2 < 600 or wc(s1) - wc(s2) > 0.2 - slack)
    return s1 >= 250 and wc(s1) - wc(s2) >= 0.45 - slack


def build_solution(eng, board, pre_blunder):
    """Returns (moves, kind) or None. board: solver to move, right after blunder.
    Material gain is measured against the position BEFORE the blunder, so a plain
    recapture does not count as winning material."""
    solver = board.turn
    start_bal = balance(pre_blunder, solver)
    # filtro rápido: si a poca profundidad ya hay dos jugadas buenas, no vale la pena el análisis profundo
    _, q1, q2, _ = multipv2(eng, board, QUICK)
    if not unique_enough(q1, q2, slack=0.12):
        return None
    b = board.copy()
    moves = []
    for step in range(4):
        m, s1, s2, info = multipv2(eng, b)
        if not unique_enough(s1, s2):
            return None
        b.push(m)
        moves.append(m)
        if b.is_checkmate():
            return moves, "mate"
        if b.is_game_over():
            return None
        # opponent best reply
        r_info = eng.analyse(b, DEEP)
        r = r_info["pv"][0]
        is_mate_line = s1 >= MATE_CP - 5000
        if not is_mate_line:
            gain_now = balance(b, solver) - start_bal
            rb = b.copy()
            rb.push(r)
            gain_after = balance(rb, solver) - start_bal
            # stop when the gain sticks after the best reply
            if gain_after >= 2 and not (b.is_capture(r) and gain_now > gain_after) and not b.gives_check(r):
                # make sure the solver isn't just trading down: eval still winning
                return moves, "material"
        b.push(r)
        moves.append(r)
        if b.is_game_over():
            return None
    return None


# ---------- theme tagging ----------

def attacked_valuable(board, sq, mover_color):
    """Squares of enemy pieces attacked by piece on sq that are worth attacking."""
    piece = board.piece_at(sq)
    out = []
    for t in board.attacks(sq):
        tp = board.piece_at(t)
        if tp and tp.color != mover_color:
            if tp.piece_type == chess.KING:
                out.append(t)
            elif VAL[tp.piece_type] > VAL[piece.piece_type] or not board.is_attacked_by(not mover_color, t):
                out.append(t)
    return out


def tag(fen, ucis, kind):
    board = chess.Board(fen)
    board.push(chess.Move.from_uci(ucis[0]))
    solver = board.turn
    sol = [chess.Move.from_uci(u) for u in ucis[1:]]
    solver_moves = sol[0::2]
    themes = []
    n = len(solver_moves)
    if kind == "mate":
        themes.append("mateIn%d" % n)
        b = board.copy()
        for m in sol:
            b.push(m)
        k = b.king(not solver)
        back = 0 if (not solver) == chess.WHITE else 7
        if chess.square_rank(k) == back:
            mater = b.piece_at(sol[-1].to_square)
            if mater and mater.piece_type in (chess.ROOK, chess.QUEEN) and chess.square_rank(sol[-1].to_square) == back:
                step = 1 if back == 0 else -1
                front = [chess.square(f, back + step) for f in range(max(0, chess.square_file(k) - 1), min(7, chess.square_file(k) + 1) + 1)]
                if all((b.piece_at(s) and b.piece_at(s).color == (not solver)) for s in front if True):
                    themes.append("backRankMate")
        return themes, n

    b = board.copy()
    m1 = sol[0]
    pre = b.copy()
    captured = pre.piece_at(m1.to_square)
    b.push(m1)
    # hanging piece: one move, free capture
    if n == 1 and captured and not pre.is_attacked_by(not solver, m1.to_square):
        themes.append("hangingPiece")
    elif n == 1 and captured and VAL[captured.piece_type] > VAL[pre.piece_at(m1.from_square).piece_type]:
        themes.append("hangingPiece")
    # fork
    targets = attacked_valuable(b, m1.to_square, solver)
    later_caps = []
    bb = b.copy()
    for i, m in enumerate(sol[1:], start=1):
        if i % 2 == 0:
            later_caps.append((m.from_square, m.to_square, bb.is_capture(m)))
        bb.push(m)
    if len(targets) >= 2 and not themes:
        if any(cap for (_, _, cap) in later_caps):
            themes.append("fork")
    # discovered attack / check
    if b.is_check():
        checkers = b.checkers()
        if any(c != m1.to_square for c in checkers):
            themes.append("discoveredAttack")
    else:
        for s in chess.SquareSet(b.occupied_co[solver]):
            if s == m1.to_square:
                continue
            p = b.piece_at(s)
            if p.piece_type not in (chess.BISHOP, chess.ROOK, chess.QUEEN):
                continue
            before = pre.attacks(s)
            after = b.attacks(s)
            new = after & ~before & b.occupied_co[not solver]
            for t in new:
                tp = b.piece_at(t)
                if tp.piece_type == chess.QUEEN or (tp.piece_type == chess.ROOK and p.piece_type != chess.QUEEN):
                    if any(to == t for (_, to, cap) in later_caps):
                        themes.append("discoveredAttack")
                        break
            if "discoveredAttack" in themes:
                break
    # pin: moved slider pins a piece to king/queen and pinned piece captured later
    mp = b.piece_at(m1.to_square)
    if mp and mp.piece_type in (chess.BISHOP, chess.ROOK, chess.QUEEN):
        for s in chess.SquareSet(b.occupied_co[not solver]):
            if b.is_pinned(not solver, s) and m1.to_square in b.pin(not solver, s):
                pp = b.piece_at(s)
                if pp.piece_type != chess.PAWN:
                    themes.append("pin")
                    break
        # skewer: attack king/queen with something behind on the ray
        if "pin" not in themes and len(sol) >= 3:
            for t in b.attacks(m1.to_square):
                tp = b.piece_at(t)
                if tp and tp.color != solver and tp.piece_type in (chess.KING, chess.QUEEN):
                    ray = chess.ray(m1.to_square, t)
                    # squares beyond t along the ray (t lies between the attacker and them)
                    beyond = [x for x in chess.SquareSet(ray)
                              if x not in (m1.to_square, t) and t in chess.SquareSet(chess.between(m1.to_square, x))]
                    beyond.sort(key=lambda x: chess.square_distance(x, t))
                    for x in beyond:
                        bp = b.piece_at(x)
                        if bp:
                            if bp.color != solver and VAL[bp.piece_type] >= 3 and any(to == x for (_, to, cap) in later_caps):
                                themes.append("skewer")
                            break
    # promotion
    if any(m.promotion for m in solver_moves):
        themes.append("promotion")
    if not themes:
        themes.append("advantage")
    return themes, n


def difficulty(themes, n, fen, ucis):
    board = chess.Board(fen)
    board.push(chess.Move.from_uci(ucis[0]))
    m1 = chess.Move.from_uci(ucis[1])
    base = {"mateIn1": 650, "hangingPiece": 700, "fork": 1000, "mateIn2": 1100, "mateIn3": 1450,
            "discoveredAttack": 1150, "pin": 1100, "skewer": 1150, "backRankMate": 900,
            "promotion": 1150, "advantage": 1200}
    d = max(base.get(t, 1100) for t in themes)
    d += (n - 1) * 120
    if not board.is_capture(m1) and not board.gives_check(m1):
        d += 180  # quiet first move is harder
    pieces = len(board.piece_map())
    d += (pieces - 16) * 6
    return int(d)


seen = set()


def play_and_mine(player, ana, rng, out, stats):
    board = chess.Board()
    skills = {chess.WHITE: rng.randint(0, 8), chess.BLACK: rng.randint(0, 8)}
    opening_plies = rng.randint(2, 8)
    prev_eval = None  # eval from side to move POV
    history_fens = []
    for ply in range(160):
        if board.is_game_over():
            break
        # choose move
        if ply < opening_plies:
            infos = player.analyse(board, chess.engine.Limit(depth=6), multipv=4)
            cands = [i["pv"][0] for i in infos if "pv" in i]
            mv = rng.choice(cands)
        else:
            player.configure({"Skill Level": skills[board.turn]})
            res = player.play(board, chess.engine.Limit(depth=rng.randint(1, 4), time=0.03))
            mv = res.move
        fen_before = board.fen()
        mover = board.turn
        board.push(mv)
        if board.is_game_over():
            break
        info = ana.analyse(board, SCAN)
        ev = cp_of(info["score"], board.turn)  # POV solver (side to move now)
        # prev_eval was from mover POV before the move; from solver POV it's -prev_eval
        if prev_eval is not None and ply >= opening_plies:
            before_solver = -prev_eval
            if ev >= 280 and before_solver <= 120 and abs(ev) < MATE_CP or ev >= MATE_CP - 5000 and before_solver < MATE_CP - 5000:
                if "mate1" in SKIP and ev >= MATE_CP - 150:  # mate en 1: ya hay de sobra
                    prev_eval = ev
                    continue
                stats["cand"] += 1
                sol = build_solution(ana, board, chess.Board(fen_before)) if fen_before not in seen else None
                seen.add(fen_before)
                if sol:
                    moves, kind = sol
                    ucis = [mv.uci()] + [m.uci() for m in moves]
                    themes, n = tag(fen_before, ucis, kind)
                    rec = {"fen": fen_before, "moves": ucis, "themes": themes, "n": n,
                           "rating": difficulty(themes, n, fen_before, ucis)}
                    out.write(json.dumps(rec) + "\n")
                    out.flush()
                    stats["ok"] += 1
        prev_eval = ev
        # stop games that are totally decided to save time
        if abs(ev) > 1500 and ply > 30 and rng.random() < 0.15:
            break


def main():
    out_path, minutes, seed = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
    rng = random.Random(seed)
    player = chess.engine.SimpleEngine.popen_uci(ENGINE)
    ana = chess.engine.SimpleEngine.popen_uci(ENGINE)
    ana.configure({"Hash": 128, "Threads": 1})
    player.configure({"Hash": 16, "Threads": 1})
    stats = {"cand": 0, "ok": 0, "games": 0}
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
