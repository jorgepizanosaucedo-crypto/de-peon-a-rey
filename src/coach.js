// ---------------------------------------------------------------- Karen entrenadora
// Karen comenta cada jugada del análisis, te explica tus errores cuando los practicas y revisa muchas partidas
// de tu perfil para hacerte un diagnóstico. Todo sale de lo que ya calculó el motor: la evaluación, la mejor
// jugada y su línea; aquí solo se convierte en palabras.

// errores de tus partidas guardados para practicar (se usa al leer el progreso guardado, antes que el resto)
const MINE_MAX = 200;

// ---------- piezas y palabras
const C_NAME = { p: 'peón', n: 'caballo', b: 'alfil', r: 'torre', q: 'dama', k: 'rey' };
const C_LO = { p: 'lo', n: 'lo', b: 'lo', r: 'la', q: 'la', k: 'lo' };
const C_PLURAL = { p: 'peones', n: 'caballos', b: 'alfiles', r: 'torres', q: 'damas', k: 'reyes' };
const C_GOOD = new Set(['brilliant', 'great', 'best', 'excellent', 'good']);
// la misma jugada siempre recibe la misma frase (al ir y volver no cambia)
const cPick = (list, seed) => list[Math.abs(Math.floor(seed)) % list.length];
const cSeed = (A, k) => (parseInt(hash(String(A.id || 'x')), 36) % 97) + k * 7;
const cJoin = xs => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]);
const cUp = t => (t ? t[0].toUpperCase() + t.slice(1) : t);
const cSplit = s => (typeof s === 'string' && s ? s.split(' ').filter(u => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) : []);
// evaluación para mostrar: +1.3, −0.4, +M3 (mate en 3) y 1-0 / 0-1 cuando ya hay mate en el tablero
function fmtEval(cp) {
  if (Math.abs(cp) >= 10000) return cp > 0 ? '1-0' : '0-1';
  if (Math.abs(cp) >= 9000) return (cp > 0 ? '+M' : '−M') + Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
  return (cp > 0 ? '+' : cp < 0 ? '−' : '') + (Math.abs(cp) / 100).toFixed(1);
}
// cómo está tu posición según tu probabilidad de ganar
const cStand = w => (w >= 95 ? 'ganadora' : w >= 75 ? 'mucho mejor' : w >= 58 ? 'un poco mejor' : w > 42 ? 'igualada' : w > 25 ? 'un poco peor' : w > 5 ? 'mucho peor' : 'perdida');
const cMateIn = cp => Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));

// "12.Cxe5 dxe5 13.Dh5+": una línea en notación española con sus números de jugada
function cLineSan(fen, ucis, max = 4) {
  const g = new Chess(fen), parts = [];
  let n = +fen.split(' ')[5] || 1, white = fen.split(' ')[1] === 'w';
  for (const u of (ucis || []).slice(0, max)) {
    const m = g.move(uciObj(u)); if (!m) break;
    parts.push((white ? n + '.' : parts.length ? '' : n + '…') + es(m.san));
    if (!white) n++;
    white = !white;
  }
  return parts.join(' ');
}
// Juega una línea y cuenta cuánto material gana `color` cuando la línea se calma (sin cortar un cambio a la mitad).
function cLine(fen, ucis, color) {
  const g = new Chess(fen), b0 = balanceFor(fen, color), list = (ucis || []).slice(0, PV_KEEP), moves = [];
  const won = [], lost = [];
  let res = { delta: 0, won: [], lost: [] };
  for (let k = 0; k < list.length; k++) {
    const m = g.move(uciObj(list[k])); if (!m) break;
    moves.push(m);
    if (m.captured) (m.color === color ? won : lost).push(m.captured);
    let quiet = k === list.length - 1;
    if (!quiet) { const nx = g.move(uciObj(list[k + 1])); if (nx) { g.undo(); quiet = !nx.captured; } else quiet = true; }
    if (quiet) res = { delta: balanceFor(g.fen(), color) - b0, won: won.slice(), lost: lost.slice() };
  }
  return Object.assign(res, { moves, mate: g.in_checkmate() });
}
// Lo ganado en palabras: "la dama", "una torre", "la calidad", "un caballo", "un peón"…
function cWords(delta, taken, given) {
  if (!(delta >= 0.5)) return null;
  const has = t => taken.includes(t), gave = t => given.includes(t);
  if (delta >= 6 && has('q')) return 'la dama';
  if (delta >= 4 && has('r')) return 'una torre';
  if (delta >= 1.5 && has('r') && (gave('n') || gave('b'))) return 'la calidad';
  if (delta >= 2.5 && (has('n') || has('b'))) return has('n') && has('b') ? 'una pieza' : has('n') ? 'un caballo' : 'un alfil';
  if (delta >= 2.5) return 'material';
  if (delta >= 1.5) return 'dos peones';
  return 'un peón';
}
// Qué hace una jugada, con la jugada como sujeto: "captura su alfil", "da jaque y ataca tu dama", "enroca…".
// mine: la jugada es tuya (tus piezas son "tu…" y las de tu rival "su…"); al revés si es de tu rival.
// self: el rival fue Karen (partidas del duelo), así que sus piezas son "mi…".
function cIdea(fen, uci, mine, ply, prevTo, self) {
  let g, m;
  try { g = new Chess(fen); m = g.move(uciObj(uci)); } catch (e) { return null; }
  if (!m) return null;
  if (g.in_checkmate()) return 'da jaque mate';
  if (m.flags.includes('k') || m.flags.includes('q')) return 'enroca y pone a salvo al rey';
  const own = mine ? 'tu' : self ? 'mi' : 'su', their = mine ? (self ? 'mi' : 'su') : 'tu';
  const me = m.color, op = me === 'w' ? 'b' : 'w', before = parseFen(fen), after = parseFen(g.fen());
  const out = [];
  if (m.promotion) out.push(m.promotion === 'q' ? 'corona una dama' : 'corona un peón');
  if (m.captured) {
    if (prevTo && prevTo === m.to) out.push('recupera la pieza');
    else out.push(`captura ${their} ${C_NAME[m.captured]}` + (!attackers(before, m.to, op).length ? ' que estaba sin defensa' : ''));
  }
  // lo que ataca ahora: piezas del rival que podría ganar en la siguiente jugada
  const hit = [], disc = [];
  for (const [sq, p] of Object.entries(after)) {
    if (p[0] !== op || p[1] === 'k' || sq === m.to) continue;
    if (enPriseLoss(after, sq) < 2) continue;
    if (attackers(after, sq, me).includes(m.to)) hit.push(p[1]);
    else if (enPriseLoss(before, sq) < 2) disc.push(p[1]);
  }
  hit.sort((a, b) => VAL[b] - VAL[a]); disc.sort((a, b) => VAL[b] - VAL[a]);
  const check = g.in_check();
  if (check && hit.length) out.push(`da jaque y ataca ${their} ${C_NAME[hit[0]]}`);
  else if (check) out.push('da jaque');
  else if (hit.length >= 2) out.push(`ataca ${their} ${C_NAME[hit[0]]} y ${their} ${C_NAME[hit[1]]} a la vez`);
  else if (hit.length && !m.captured) out.push(`ataca ${their} ${C_NAME[hit[0]]}`);
  if (disc.length && out.length < 2) out.push(`destapa un ataque contra ${their} ${C_NAME[disc[0]]}`);
  if (out.length < 2 && !m.captured && enPriseLoss(before, m.from) >= 2 && enPriseLoss(after, m.to) < 2) out.push(`pone a salvo ${own} ${C_NAME[m.piece]}`);
  if (out.length < 2) {
    const saved = Object.entries(before).find(([sq, p]) => p[0] === me && sq !== m.from && p[1] !== 'k' && enPriseLoss(before, sq) >= 2 && after[sq] === p && enPriseLoss(after, sq) < 2);
    if (saved) out.push(`defiende ${own} ${C_NAME[saved[1][1]]}`);
  }
  if (!out.length && ply < 24 && (m.piece === 'n' || m.piece === 'b') && m.from[1] === (me === 'w' ? '1' : '8')) out.push(`desarrolla ${own} ${C_NAME[m.piece]}`);
  if (!out.length && ply < 16 && m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to)) out.push('ocupa el centro');
  if (!out.length) return null;
  // "captura su dama, da jaque y ataca su alfil" (sin dos "y" seguidas)
  return out.length > 1 && out[1].includes(' y ') ? out[0] + ', ' + out[1] : out.slice(0, 2).join(' y ');
}

// ---------- los hechos de una jugada (sirven igual para el análisis y para la práctica)
// o: { fen, played, best, pvBest, pvAfter, cpB, cpA, color, mine, ply, prevSan, prevTo, cls }
function cFacts(o) {
  const sgn = o.color === 'w' ? 1 : -1, f = { o };
  f.wB = o.cpB == null ? null : wp(sgn * o.cpB); f.wA = o.cpA == null ? null : wp(sgn * o.cpA);
  const g = new Chess(o.fen), pm = g.move(uciObj(o.played));
  f.playedSan = pm ? es(pm.san) : o.played; f.fenAfter = g.fen(); f.pm = pm;
  f.mated = !!pm && g.in_checkmate();
  f.bestList = o.pvBest && o.pvBest.length && o.pvBest[0] === o.best ? o.pvBest : o.best ? [o.best] : [];
  f.bestSan = o.best ? es(sanOf(o.fen, o.best)) : null;
  f.bestIdea = o.best && o.best !== o.played ? cIdea(o.fen, o.best, o.mine, o.ply, o.prevTo, o.self) : null;
  f.bestLine = cLine(o.fen, f.bestList, o.color);
  f.bestGain = cWords(f.bestLine.delta, f.bestLine.won, f.bestLine.lost);
  const bm = f.bestLine.moves[0];
  // la ganancia solo se dice si es más de lo que la mejor jugada captura de inmediato
  f.gainExtra = f.bestGain && (!bm || !bm.captured || f.bestLine.delta >= VAL[bm.captured] + 1.5);
  // lo que pasaba después de la jugada: la mejor respuesta del rival y su línea
  f.after = o.pvAfter || [];
  f.reply = f.after[0] || null;
  f.refLine = cLine(o.fen, [o.played, ...f.after], o.color);
  f.refLoss = cWords(-f.refLine.delta, f.refLine.lost, f.refLine.won);
  f.refGain = cWords(f.refLine.delta, f.refLine.won, f.refLine.lost);
  if (f.reply && pm) {
    const r = new Chess(f.fenAfter).move(uciObj(f.reply));
    if (r) {
      f.replySan = es(r.san); f.replyCap = r.captured || null; f.replySq = r.to;
      f.replyIdea = cIdea(f.fenAfter, f.reply, !o.mine, o.ply + 1, pm.captured ? pm.to : null, o.self);
      // la pieza que se come no tenía quién la defendiera
      f.hanging = !!r.captured && r.captured !== 'p' && !attackers(parseFen(f.fenAfter), r.to, o.color).length && f.refLine.delta <= -2;
    }
  }
  f.mateAfter = o.cpA != null && sgn * o.cpA <= -9000 && !f.mated ? cMateIn(o.cpA) : 0;   // tu rival te da mate
  f.mateBest = o.cpB != null && sgn * o.cpB >= 9000 ? cMateIn(o.cpB) : 0;                 // tú dabas mate
  f.mateKept = f.mated || (o.cpA != null && sgn * o.cpA >= 9000);
  return f;
}
// lo mejor, en una frase: "Cxe5, que captura su caballo (y ganabas una torre)"
function cBestText(f) {
  return f.bestSan + (f.bestIdea ? `, que ${f.bestIdea}` : '') + (f.gainExtra ? ` (así ganabas ${f.bestGain})` : '');
}

// ---------- contexto de una jugada del análisis
function cCtxA(A, k) {
  const color = A.fens[k].split(' ')[1];
  const pvB = cSplit(A.pvs && A.pvs[k]), pvA = cSplit(A.pvs && A.pvs[k + 1]);
  return { fen: A.fens[k], played: A.ucis[k], best: A.best[k], pvBest: pvB, pvAfter: pvA.length ? pvA : A.best[k + 1] ? [A.best[k + 1]] : [],
    cpB: A.cps[k], cpA: A.cps[k + 1], color, mine: color === A.userColor, ply: k, self: cSelf(A),
    prevSan: k > 0 ? es(A.sans[k - 1]) : '', prevTo: k > 0 && A.sans[k - 1].includes('x') ? A.ucis[k - 1].slice(2, 4) : null, cls: A.cls[k] };
}
// contexto de un error guardado para practicar (los de versiones viejas no traen las líneas del motor)
function cCtxMine(p) {
  const color = p.fen.split(' ')[1];
  return { fen: p.fen, played: p.played, best: p.best, pvBest: cSplit(p.pv), pvAfter: cSplit(p.ref),
    cpB: Number.isFinite(p.bestCp) ? p.bestCp : null, cpA: Number.isFinite(p.cpA) ? p.cpA : null, color, mine: true, self: /^duelo-/.test(p.gameId || ''),
    ply: Number.isFinite(p.ply) ? p.ply : ((p.moveNo || 1) - 1) * 2 + (color === 'b' ? 1 : 0),
    prevSan: p.ps ? es(p.ps) : '', prevTo: p.prev && p.ps && p.ps.includes('x') ? p.prev.slice(2, 4) : null, cls: p.cls };
}

// ---------- cómo se nombra al rival
// En las partidas del duelo el rival fue Karen, así que habla de sí misma.
const cSelf = A => A.timeClass === 'duelo' || /^duelo-/.test(String(A.id || ''));
const C_RIV = {
  other: { mate1: 'Con esto tu rival te da mate en una', mateNow: n => `Con esto tu rival tiene mate en ${n}`, erred: 'Tu rival acababa de equivocarse', gain: 'le ganabas',
    punish: 'castigarlo', takes: lo => `tu rival ${lo} captura`, replies: 'Tu rival responde', follow: 'Tu rival puede seguir con', canReply: 'Tu rival puede responder',
    play: 'le das algo de juego a tu rival', erredPast: 'Tu rival se había equivocado', hadMate: 'tu rival tenía mate en', couldTake: lo => `tu rival podía capturar${lo}`,
    couldReply: 'tu rival podía responder', notPunish: 'no castigaste su error', vs: (n, opp) => `Jugada ${n} contra ${opp || 'tu rival'}.` },
  self: { mate1: 'Con esto te doy mate en una', mateNow: n => `Con esto tengo mate en ${n}`, erred: 'Yo acababa de equivocarme', gain: 'me ganabas',
    punish: 'castigarme', takes: lo => `yo ${lo} capturo`, replies: 'Respondo', follow: 'Puedo seguir con', canReply: 'Puedo responder',
    play: 'me das algo de juego', erredPast: 'Me había equivocado', hadMate: 'yo tenía mate en', couldTake: lo => `yo podía capturar${lo}`,
    couldReply: 'yo podía responder', notPunish: 'no castigaste mi error', vs: n => `Jugada ${n} de nuestro duelo.` },
};
const cRiv = o => C_RIV[o.self ? 'self' : 'other'];

// ---------- comentarios del análisis
// Un error tuyo: qué pasó y qué era mejor.
function cErrText(f, seed) {
  const o = f.o, c = o.cls, parts = [], R = cRiv(o);
  parts.push(cPick({ inaccuracy: ['Imprecisión.', 'Mmm, no es lo más preciso.', 'Se podía jugar mejor.'],
    mistake: ['Error.', 'Aquí hay un error.', 'Esta jugada es un error.'],
    blunder: ['¡Uy, error grave!', '¡Error grave!', 'Esta duele: error grave.'],
    miss: ['¡Oportunidad perdida!', '¡Se te escapó!', '¡Aquí había premio!'] }[c] || ['Mmm.'], seed));
  let betterDone = false;
  if (f.mateAfter && !f.mateBest) {
    parts.push(f.mateAfter === 1 ? `${R.mate1}: ${f.replySan || ''}.` : `${R.mateNow(f.mateAfter)}: ${cLineSan(f.fenAfter, f.after, 2 * f.mateAfter - 1)}.`);
  } else if (f.mateBest && !f.mateKept) {
    parts.push(f.mateBest === 1 ? `¡Tenías mate en una con ${f.bestSan}!` : `¡Tenías mate en ${f.mateBest}! Empezaba con ${f.bestSan}: ${cLineSan(o.fen, f.bestList, 2 * f.mateBest - 1)}.`);
    betterDone = true;
  } else if (c === 'miss') {
    parts.push(`${R.erred}${o.prevSan ? ' con ' + o.prevSan : ''}` + (f.bestGain ? ` y con ${f.bestSan} ${R.gain} ${f.bestGain}.` : ` y podías ${R.punish} con ${f.bestSan}${f.bestIdea ? ', que ' + f.bestIdea : ''}.`));
    betterDone = true;
  } else if (f.refLoss && f.replySan) {
    if (f.hanging) parts.push(`Tu ${C_NAME[f.replyCap]} de ${f.replySq} se queda sin defensa y ${R.takes(C_LO[f.replyCap])} con ${f.replySan}` + (f.refLine.delta <= -VAL[f.replyCap] - 1.5 ? `: pierdes ${f.refLoss}.` : '.'));
    else if (f.replyCap) parts.push(`${R.replies} ${f.replySan} y pierdes ${f.refLoss}.`);
    else parts.push(`${R.replies} ${f.replySan}` + (f.replyIdea ? `, que ${f.replyIdea},` : '') + ` y pierdes ${f.refLoss}.`);
  } else if (f.wB != null && f.wA != null && cStand(f.wB) !== cStand(f.wA)) {
    parts.push(`No pierdes material, pero tu posición pasa de ${cStand(f.wB)} a ${cStand(f.wA)}.`);
    if (c !== 'inaccuracy' && f.replySan && f.replyIdea) parts.push(`${R.follow} ${f.replySan}, que ${f.replyIdea}.`);
  } else if (c !== 'inaccuracy' && f.replySan) {
    parts.push(`${R.canReply} ${f.replySan}` + (f.replyIdea ? `, que ${f.replyIdea},` : '') + ' y tu posición empeora.');
  } else {
    parts.push(c === 'inaccuracy' ? `No pierdes nada todavía, pero ${R.play}.` : 'Tu posición empeora.');
  }
  if (!betterDone && f.bestSan && o.best !== o.played) parts.push(`${c === 'inaccuracy' ? 'Lo más preciso era' : 'Lo mejor era'} ${cBestText(f)}.`);
  return parts.join(' ');
}
// Una jugada buena tuya.
function cGoodText(f, A, k, seed) {
  const o = f.o, c = o.cls;
  if (f.mated) return cPick(['¡Jaque mate!', '¡Mate!', '¡Y es mate!'], seed) + ` ${f.playedSan} termina la partida.`;
  const idea = cIdea(o.fen, o.played, true, o.ply, o.prevTo, o.self);
  const what = idea ? ` ${f.playedSan} ${idea}.` : '';
  const sb = f.wB == null ? 50 : f.wB;
  switch (c) {
    case 'brilliant': return cPick(['¡Brillante!', '¡Jugadón!', '¡Brillante, de verdad!'], seed) + ' Entregas material a propósito y es de lo mejor.' + what;
    case 'great': return cPick(['¡Gran jugada!', '¡Muy bien visto!', '¡Esa era!'], seed) + ` Era la única que ${sb >= 62 ? 'mantenía tu ventaja' : sb <= 38 ? 'te mantenía en la partida' : 'mantenía el equilibrio'}: las demás eran peores.` + what;
    case 'best': return cPick(['¡Exacto!', 'Perfecto.', 'Eso es.', '¡Bien visto!'], seed) + ' ' + cPick(['La mejor jugada.', 'Es justo lo que yo habría jugado.', 'La jugada del motor.'], seed + 3) + what;
    case 'excellent': return cPick(['Muy bien.', '¡Bien!', 'Buena idea.'], seed) + ` Casi tan buena como la mejor, que era ${f.bestSan}.` + what;
    case 'good': return cPick(['Está bien.', 'Buena jugada.', 'Correcta.'], seed) + ` Aunque ${cBestText(f)} era un poco mejor.`;
    case 'book': {
      const last = A.cls[k + 1] !== 'book' && A.cls[k + 2] !== 'book' && A.opening;
      return cPick(['Jugada de libro: es teoría de aperturas.', 'Teoría pura: así se juega.', 'Todo en orden: seguimos en la teoría.'], seed) + (last ? ` Apertura: ${A.opening}.` : '');
    }
    case 'forced': return 'No había otra jugada: era la única legal.';
  }
  return '';
}
// Una jugada de tu rival.
function cOppText(f, A, k, seed) {
  const o = f.o, c = o.cls, nm = A.opp && A.opp !== 'Rival' ? A.opp : 'Tu rival', me = o.self;
  if (c === 'inaccuracy' || c === 'mistake' || c === 'blunder') {
    const parts = [cPick((me ? { inaccuracy: ['Aquí no jugué lo más preciso.', 'Imprecisión mía.'], mistake: ['Aquí me equivoqué.', 'Error mío.'], blunder: ['¡Uy, me equivoqué feo!', '¡Error grave mío!'] }
      : { inaccuracy: ['Imprecisión de tu rival.', 'Tu rival no juega lo más preciso.'], mistake: ['Tu rival se equivoca.', 'Error de tu rival.'], blunder: ['¡Error grave de tu rival!', '¡Tu rival se equivocó feo!'] })[c], seed)];
    const ub = f.after[0];
    if (ub) {
      const ubSan = es(sanOf(f.fenAfter, ub)), ubIdea = cIdea(f.fenAfter, ub, true, o.ply + 1, f.pm && f.pm.captured ? f.pm.to : null, me);
      // la línea se cuenta desde tu rival: lo que él pierde es lo que tú ganas
      if (f.mateAfter) parts.push(f.mateAfter === 1 ? `¡Ahora tienes mate en una con ${ubSan}!` : `¡Ahora tienes mate en ${f.mateAfter}! Empieza con ${ubSan}.`);
      else if (f.refLoss && c !== 'inaccuracy') {
        // si lo que captura vale más que lo que ganas al final (hay cambios), se dicen las dos cosas
        const um = f.refLine.moves[1];
        if (um && um.captured && -f.refLine.delta < VAL[um.captured] - 0.5) parts.push(`Ahora lo mejor para ti es ${ubSan}` + (ubIdea ? `, que ${ubIdea}` : '') + `; al final ganas ${f.refLoss}.`);
        else parts.push(`Ahora puedes ganar ${f.refLoss} con ${ubSan}` + (ubIdea && !(um && um.captured) ? `, que ${ubIdea}.` : '.'));
      }
      else parts.push(`Ahora lo mejor para ti es ${ubSan}` + (ubIdea ? `, que ${ubIdea}.` : '.'));
    }
    const nx = A.cls[k + 1];
    if (nx && c !== 'inaccuracy') parts.push(C_GOOD.has(nx) ? '¡Y lo aprovechaste!' : nx === 'book' || nx === 'forced' ? '' : 'Mira qué jugaste tú.');
    return parts.filter(Boolean).join(' ');
  }
  if (c === 'miss') return (me ? 'No aproveché tu error de antes. ¡Te salvaste!' : 'Tu rival no aprovechó tu error de antes. ¡Te salvaste!') + (f.bestSan ? ` Lo que te dolía era ${f.bestSan}.` : '');
  const idea = cIdea(o.fen, o.played, false, o.ply, o.prevTo, me);
  const lead = me ? (c === 'brilliant' || c === 'great' ? 'Buena jugada mía. ' : c === 'book' ? 'Yo también sigo la teoría. ' : c === 'forced' ? 'No tenía otra jugada. ' : '')
    : c === 'brilliant' || c === 'great' ? 'Buena jugada de tu rival. ' : c === 'book' ? 'Tu rival también sigue la teoría. ' : c === 'forced' ? 'Tu rival no tenía otra jugada. ' : '';
  if (f.mated) return me ? `Te doy jaque mate con ${f.playedSan}.` : `${nm} te da jaque mate con ${f.playedSan}.`;
  const warn = idea && /ataca tu|da jaque|contra tu/.test(idea) ? ' ' + cPick(['¡Cuidado!', 'Ojo con eso.', 'Atención ahí.'], seed) : '';
  return `${lead}${me ? 'Juego' : nm + ' juega'} ${f.playedSan}` + (idea ? `, que ${idea}.` : '.') + warn;
}
// Resumen de la partida (posición inicial).
function cIntro(A) {
  const idx = A.ucis.map((_, i) => i).filter(i => A.fens[i].split(' ')[1] === A.userColor);
  const n = c => idx.filter(i => A.cls[i] === c).length;
  const bl = n('blunder'), mi = n('mistake'), ms = n('miss'), sh = idx.filter(i => SHINE.has(A.cls[i])).length;
  const sg = A.userColor === 'w' ? 1 : -1;
  let worst = null, wd = 0;
  for (const i of idx) { const d = wp(sg * A.cps[i]) - wp(sg * A.cps[i + 1]); if (TRAIN.has(A.cls[i]) && d > wd) { wd = d; worst = i; } }
  const parts = [`Jugaste con ${A.userColor === 'w' ? 'blancas' : 'negras'}${cSelf(A) ? ' contra mí' : ''} y tu precisión fue de ${A.accuracy}%.`];
  const errs = [bl && `${bl} ${bl > 1 ? 'errores graves' : 'error grave'}`, mi && `${mi} ${mi > 1 ? 'errores' : 'error'}`, ms && `${ms} ${ms > 1 ? 'oportunidades perdidas' : 'oportunidad perdida'}`].filter(Boolean);
  if (errs.length) parts.push(`Encontré ${cJoin(errs)}` + (worst != null ? `; el que más te costó fue en la jugada ${Math.floor(worst / 2) + 1}.` : '.'));
  else parts.push('Sin errores graves: ¡muy bien jugado!');
  if (sh) parts.push(sh > 1 ? `Y tuviste ${sh} jugadas de las que se celebran.` : 'Y tuviste una jugada de las que se celebran.');
  parts.push('Pulsa ▶ y te comento cada jugada.');
  return parts.join(' ');
}
const C_MOOD = { brilliant: 'cheer', great: 'happy', best: 'happy', excellent: 'point', good: 'point', book: 'point', forced: 'idle', inaccuracy: 'think', mistake: 'worry', blunder: 'surprise', miss: 'surprise' };
// El comentario de Karen para la jugada k: texto, ánimo y líneas que se pueden ver en el tablero.
function cMoveComment(A, k) {
  const o = cCtxA(A, k), f = cFacts(o), seed = cSeed(A, k), lines = [];
  let text, mood;
  if (o.mine) {
    if (ERRISH.has(o.cls)) {
      text = cErrText(f, seed); mood = C_MOOD[o.cls];
      if (f.after.length) lines.push({ label: 'Qué pasaba', fen: o.fen, ucis: [o.played, ...f.after].slice(0, 6) });
      if (f.bestList.length >= 2 && o.best !== o.played) lines.push({ label: 'La mejor', fen: o.fen, ucis: f.bestList.slice(0, 6), good: true });
    } else {
      text = cGoodText(f, A, k, seed); mood = C_MOOD[o.cls] || 'idle';
      if (SHINE.has(o.cls) && f.bestList.length >= 3 && f.bestList[0] === o.played) lines.push({ label: 'Ver la idea', fen: o.fen, ucis: f.bestList.slice(0, 6), good: true });
    }
  } else {
    text = cOppText(f, A, k, seed);
    const err = o.cls === 'mistake' || o.cls === 'blunder' || o.cls === 'inaccuracy';
    mood = err ? 'wave' : o.cls === 'miss' ? 'happy' : SHINE.has(o.cls) ? 'think' : /¡Cuidado!|Ojo|Atención/.test(text) ? 'surprise' : 'idle';
    if (err && f.after.length >= 2) lines.push({ label: o.cls === 'inaccuracy' ? 'Tu mejor respuesta' : 'Cómo castigarlo', fen: f.fenAfter, ucis: f.after.slice(0, 6), good: true });
  }
  if (o.self) mood = o.mine ? (o.cls === 'brilliant' || o.cls === 'great' ? 'm-shock' : o.cls === 'best' ? 'm-respect' : o.cls === 'inaccuracy' ? 'm-think' : ERRISH.has(o.cls) ? 'm-winning' : 'm-idle')
    : (ERRISH.has(o.cls) ? 'm-shock' : SHINE.has(o.cls) ? 'm-winning' : 'm-idle');
  if (k === A.ucis.length - 1) {
    text += f.mated ? (o.mine ? ' Ganaste la partida.' : ' Así terminó la partida.')
      : ` Fin de la partida: ${A.userResult === 'win' ? 'ganaste' : A.userResult === 'loss' ? 'perdiste' : 'tablas'}.`;
    if (f.mated) mood = o.self ? (o.mine ? 'm-lose' : 'm-win') : o.mine ? 'cheer' : 'worry';
  }
  return { text, mood, lines };
}

// ---------- Karen en el análisis: carita y globo debajo del tablero
let AZK = null;
function azCoachBox() {
  const on = Mascot.enabled(), fig = on ? new KarenFig(KHEAD) : null;
  const head = h('span', { class: 'cap-head' }), p = h('p'), acts = h('div', { class: 'az-acts' }), line = h('div', { class: 'az-line mono', hidden: true });
  const say = h('div', { class: (on ? 'speech k-say' : 'caption') + ' az-say', role: 'status', 'aria-live': 'polite',
    onclick: e => { if (!e.target.closest('button') && AZK && AZK.ty.cur) AZK.ty.finish(); } },
  on ? h('span', { class: 'm-name' }, MASCOT.name) : null, head, p, line, acts);
  // debajo del globo, qué significa cada flecha del tablero
  const legend = h('div', { class: 'cmp' }, h('span', null, h('i', { style: { background: 'var(--bad)' } }), 'Jugada hecha'), h('span', null, h('i', { style: { background: 'var(--good)' } }), 'Mejor jugada'), h('span', { class: 'muted kbd-hint' }, 'Usa ← y → en el teclado'));
  const box = h('div', { class: 'az-coach' + (on ? '' : ' plain'), id: 'az-coach' },
    h('div', { class: 'az-coach-row' }, on ? h('div', { class: 'k-face', 'aria-hidden': 'true' }, fig.body) : null, say), legend);
  AZK = { fig, ty: new Typer(), say, head, p, acts, line, at: 0, key: null, box };
  // en las partidas del duelo comenta Karen maestra (la que jugó contigo)
  if (fig && AZ.analysis && cSelf(AZ.analysis)) { preloadMaster(); fig.pose({ mood: 'm-idle' }); }
  else if (fig) fig.pose({ mood: 'idle', prop: 'glasses' });
  return box;
}
function azCoach(k, before) {
  const A = AZ.analysis, K = AZK; if (!A || !K || !K.box.isConnected) return;
  K.ty.stop(); azLineStop(false);
  K.head.textContent = ''; K.acts.textContent = ''; K.line.hidden = true;
  let r;
  if (k < 0) r = { text: cIntro(A), mood: cSelf(A) ? 'm-hello' : 'wave', lines: [] };
  else {
    try { r = cMoveComment(A, k); } catch (e) { r = { text: '', mood: 'idle', lines: [] }; }
    const c = A.cls[k];
    K.head.append(clsChip(c), h('strong', null, `${Math.floor(k / 2) + 1}${k % 2 === 0 ? '.' : '…'} ${es(A.sans[k])}`), h('span', { class: 'cls-word', style: { color: CLS[c].color } }, CLS[c].name), h('span', { class: 'mono muted' }, fmtEval(A.cps[k + 1])));
  }
  let text = r.text;
  if (AZ.coachIntro && k >= 0) text = AZ.coachIntro + ' ' + text;
  AZ.coachIntro = null;
  for (const L of r.lines) K.acts.append(h('button', { class: 'btn small' + (L.good ? ' good' : ''), onclick: e => azLinePlay(L, e.currentTarget) }, icon('i-play'), L.label));
  if (K.fig) K.fig.pose({ mood: r.mood, prop: 'glasses' });
  // al pasar rápido de jugada en jugada (o al volver a la misma) el texto aparece de una vez
  const key = k + (before ? 'b' : ''), quick = Date.now() - K.at < 450 || key === K.key;
  K.at = Date.now(); K.key = key;
  if (quick || !K.fig) { K.p.textContent = text; if (K.fig) K.fig.stopTalk(); }
  else K.ty.type(K.p, text, K.fig);
}
// Muestra una línea en el tablero, jugada por jugada. Cualquier otra navegación la detiene.
function azLinePlay(L, btn) {
  const K = AZK; if (!azBoard || !K) return;
  if (AZ.line && AZ.line.btn === btn) { azLineStop(true); return; }
  azLineStop(false);
  const tok = AZ.line = { btn, label: L.label }, g = new Chess(L.fen), sans = [];
  { const t = new Chess(L.fen); for (const u of L.ucis) { const m = t.move(uciObj(u)); if (!m) break; sans.push(m); } }
  const start = +L.fen.split(' ')[5] || 1, w0 = L.fen.split(' ')[1] === 'w';
  K.line.textContent = ''; K.line.hidden = false;
  const spans = sans.map((m, j) => { const ply = j + (w0 ? 0 : 1), n = start + Math.floor(ply / 2); return h('span', null, (ply % 2 === 0 ? n + '.' : j === 0 ? n + '…' : '') + es(m.san)); });
  K.line.append(...spans);
  for (const b of $$('button', K.acts)) b.classList.toggle('on', b === btn);
  btn.lastChild.textContent = 'Volver';
  azBoard.arrows([]); azBoard.setPosition(L.fen, {});
  (async () => {
    for (let j = 0; j < sans.length; j++) {
      await sleep(j ? (reduceMotion ? 380 : 820) : 350);
      if (AZ.line !== tok) return;
      const m = g.move(uciObj(L.ucis[j])); if (!m) break;
      azBoard.setPosition(g.fen(), { last: [m.from, m.to], animate: [m.from, m.to] }); Sound.play(sfxForSan(m.san));
      spans.forEach((s, x) => s.classList.toggle('cur', x === j));
    }
  })();
}
function azLineStop(restore) {
  const L = AZ.line; if (!L) return;
  AZ.line = null;
  if (L.btn && L.btn.isConnected) { L.btn.classList.remove('on'); L.btn.lastChild.textContent = L.label; }
  if (restore && AZ.analysis) { const i = AZ.idx, b = AZ.before; AZK.key = null; goto(i, b); }
}

// ---------- práctica con tus errores: qué jugaste y por qué estaba mal (en pasado)
// Frase corta para presentar el puzzle: "y dejaste tu caballo sin defensa".
function cShortWhy(f) {
  const o = f.o;
  if (o.cls === 'miss') return 'y ' + cRiv(o).notPunish;
  if (f.mateAfter) return f.mateAfter === 1 ? 'y te daban mate en una' : `y te daban mate en ${f.mateAfter}`;
  if (f.mateBest && !f.mateKept) return 'y se te escapó un mate';
  if (f.hanging) return `y dejaste tu ${C_NAME[f.replyCap]} sin defensa`;
  if (f.refLoss) return `y perdías ${f.refLoss}`;
  if (f.wB != null && f.wA != null && cStand(f.wB) !== cStand(f.wA)) return `y tu posición pasó de ${cStand(f.wB)} a ${cStand(f.wA)}`;
  return '';
}
// Lo que pasó en la partida, completo.
function cStory(f) {
  const o = f.o, R = cRiv(o), P = `En la partida jugaste ${f.playedSan}`;
  if (o.cls === 'miss') return `${R.erredPast}${o.prevSan ? ' con ' + o.prevSan : ''}, pero jugaste ${f.playedSan} y lo dejaste pasar.`;
  if (f.mateAfter) return `${P} y ${R.hadMate} ${f.mateAfter === 1 ? 'una' : f.mateAfter}: ${cLineSan(f.fenAfter, f.after, 2 * f.mateAfter - 1)}.`;
  if (f.mateBest && !f.mateKept) return `${P} y se te escapó el mate.`;
  if (f.hanging) return `${P} y tu ${C_NAME[f.replyCap]} de ${f.replySq} se quedó sin defensa: ${R.couldTake(C_LO[f.replyCap])} con ${f.replySan}.`;
  if (f.refLoss && f.replySan) return `${P} y ${R.couldReply} ${f.replySan}` + (f.replyIdea && !f.replyCap ? `, que ${f.replyIdea},` : '') + ` y ganarte ${f.refLoss}.`;
  if (f.wB != null && f.wA != null && cStand(f.wB) !== cStand(f.wA)) return `${P} y tu posición pasó de ${cStand(f.wB)} a ${cStand(f.wA)}.`;
  return `${P}, que no era lo mejor.`;
}
function minePrompt(p) {
  try {
    const f = cFacts(cCtxMine(p)), R = cRiv(f.o), why = cShortWhy(f), who = R.vs(p.moveNo, p.opp);
    if (p.cls === 'miss') return `${who} ${R.erred}${f.o.prevSan ? ' con ' + f.o.prevSan : ''} y jugaste ${f.playedSan}: encuentra cómo ${R.punish}.`;
    return `${who} En la partida jugaste ${f.playedSan}${why ? ' ' + why : ''}. Encuentra una jugada mejor.`;
  } catch (e) { return `Jugada ${p.moveNo} contra ${p.opp || 'tu rival'}. Aquí te equivocaste: encuentra una jugada mejor.`; }
}
// Karen explica el error después de resolverlo (solved) o de fallarlo.
function mineExplain(p, solved, uci) {
  try {
    const f = cFacts(cCtxMine(p)), seed = (parseInt(hash(p.id), 36) % 97);
    const parts = [];
    if (solved) parts.push(cPick(['¡Eso es!', '¡Muy bien!', '¡Esa era!'], seed) + (uci === p.best ? ` ${cBestText(f)}.` : ` Tu jugada también sirve; yo jugaba ${cBestText(f)}.`));
    else parts.push(`La buena era ${cBestText(f)}.`);
    parts.push(cStory(f));
    if (!solved) parts.push('Volverá a salir en tu próxima práctica.');
    return { text: parts.join(' '), mood: solved ? 'happy' : 'think' };
  } catch (e) { return { text: solved ? '¡Eso es!' : `La buena era ${es(sanOf(p.fen, p.best))}.`, mood: solved ? 'happy' : 'think' }; }
}

// ---------- tipos de error (diagnóstico y práctica)
const DG_ORDER = ['hanging', 'allowed_tactic', 'missed_tactic', 'mate_allowed', 'mate_missed', 'miss', 'plan'];
const DG_CLS = ['blunder', 'mistake', 'miss'];
const DG_NAME = { hanging: 'Piezas sin defensa', allowed_tactic: 'La amenaza de tu rival', missed_tactic: 'Tácticas que no ves', mate_allowed: 'Mates en tu contra',
  mate_missed: 'Mates a tu favor', miss: 'Castigar sus errores', plan: 'Jugadas que empeoran' };
const DG_LONG = { hanging: 'Dejar piezas sin defensa', allowed_tactic: 'No ver lo que planea tu rival', missed_tactic: 'No ver tus propias tácticas', mate_allowed: 'Permitir jaques mate',
  mate_missed: 'No ver mates a tu favor', miss: 'No castigar los errores de tu rival', plan: 'Jugadas que empeoran tu posición' };
const DG_TIP = {
  hanging: 'Antes de soltar la pieza, revisa qué queda sin defensa: la que mueves y las que estaba cuidando.',
  allowed_tactic: 'Después de cada jugada de tu rival pregúntate qué quiere hacer: revisa sus jaques, capturas y amenazas.',
  missed_tactic: 'En tu turno busca primero jaques, capturas y amenazas. La mejor jugada casi siempre es una de esas.',
  mate_allowed: 'Cuida a tu rey: enroca pronto, no muevas sin motivo sus peones y revisa los jaques que te pueden dar.',
  mate_missed: 'Cuando el rey rival está encerrado, revisa todos tus jaques, aunque parezcan imposibles.',
  miss: 'Cuando tu rival se equivoque, detén tu plan un momento: ¿qué dejó sin defensa? ¿Cómo lo castigo?',
  plan: 'Sin perder material, tu posición empeoró: busca casillas activas para tus piezas y no cambies sin motivo.',
};
// Mundos y lecciones que ayudan con cada tipo de error
const DG_WORLDS = { hanging: ['hanging', 'defense'], allowed_tactic: ['defense', 'fork', 'pin'], missed_tactic: ['fork', 'pin', 'discovered'], mate_allowed: ['defense', 'mate1'],
  mate_missed: ['mate1', 'mate2'], miss: ['hanging', 'mix'], plan: ['mix'] };
const DG_LESSON = { mate_allowed: 'enroca', plan: 'plan' };
const mineKey = m => (m.cls === 'miss' ? 'miss' : DG_ORDER.includes(m.cat) ? m.cat : 'plan');

// ---------- pantalla "Practica con tus errores"
function minePending(key) { return S.mine.filter(m => !m.mastered && (!key || mineKey(m) === key)); }
function startMineKey(key) {
  const pool = minePending(key); if (!pool.length) return;
  startMine(shuffle(pool).slice(0, 5), key);
}
function goWorld(wk) {
  S.lessonsOpen[wk] = true; save(); setTab('map');
  setTimeout(() => { const el = $('#world-' + wk); if (el) el.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }); }, 80);
}
// una nota de Karen (carita y globo) que escribe su texto al aparecer
function coachNote(text, mood = 'point', extra) {
  if (!Mascot.enabled()) return h('div', { class: 'notice coach-plain' }, text, extra || null);
  const fig = new KarenFig(KHEAD), p = h('p'), ty = new Typer();
  const note = h('div', { class: 'k-note coach-note', onclick: e => { if (!e.target.closest('button, a') && ty.cur) ty.finish(); } },
    h('div', { class: 'k-face', 'aria-hidden': 'true' }, fig.body),
    h('div', { class: 'speech k-say', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'm-name' }, MASCOT.name), p, extra || null));
  fig.pose({ mood, prop: 'glasses' });
  requestAnimationFrame(() => { if (note.isConnected) ty.type(p, text, fig); else p.textContent = text; });
  return note;
}
function renderMineView(root) {
  const pend = minePending(), done = S.mine.filter(m => m.mastered).length;
  root.append(h('div', { class: 'play-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => { AZ.view = 'home'; renderAnalyze(); } }, icon('i-close')),
    h('div', { class: 't' }, h('div', { class: 'k' }, 'Practica con'), h('h2', null, 'Tus errores'))));
  if (!pend.length) {
    root.append(coachNote(done ? `¡Corregiste los ${done} errores que tenía guardados! Analiza más partidas o pídeme un diagnóstico y te preparo más.`
      : 'Aquí van a aparecer los errores de tus partidas para que los practiques. Analiza una partida o pídeme un diagnóstico de tu perfil.', done ? 'cheer' : 'point'),
    h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: () => { AZ.view = 'home'; renderAnalyze(); } }, 'Analizar mis partidas')));
    return;
  }
  const groups = DG_ORDER.map(k => ({ k, list: pend.filter(m => mineKey(m) === k) })).filter(g => g.list.length).sort((a, b) => b.list.length - a.list.length);
  root.append(coachNote(`Tienes ${pend.length} ${pend.length > 1 ? 'errores' : 'error'} de tus partidas por corregir. Te pongo la posición y buscas lo que no viste; al final te explico qué pasó. Cuando resuelves uno dos veces seguidas, sale de la lista.`, 'point'));
  root.append(h('div', { class: 'mine-kpi' },
    h('div', { class: 'card' }, h('div', { class: 'v', style: { color: 'var(--mine)' } }, String(pend.length)), h('div', { class: 'l' }, 'Por corregir')),
    h('div', { class: 'card' }, h('div', { class: 'v', style: { color: 'var(--good)' } }, String(done)), h('div', { class: 'l' }, 'Corregidos')),
    h('button', { class: 'btn brass mine-go', onclick: () => startMineKey(null) }, icon('i-play'), 'Practicar 5 al azar')));
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Por tipo de error'));
  const box = h('div', { class: 'stack mine-types' });
  for (const g of groups) {
    box.append(h('div', { class: 'card mine-type' },
      h('div', { class: 'mt-top' }, h('strong', null, DG_LONG[g.k]), h('span', { class: 'mt-n' }, String(g.list.length))),
      h('div', { class: 'mt-tip' }, DG_TIP[g.k]),
      h('button', { class: 'btn small', onclick: () => startMineKey(g.k) }, `Practicar ${Math.min(5, g.list.length)}`)));
  }
  root.append(box);
  // los más recientes, explicados
  const recent = pend.slice(-8).reverse();
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Tus errores más recientes'));
  const lst = h('div', { class: 'stack' });
  for (const m of recent) {
    let why = '';
    try { const f = cFacts(cCtxMine(m)), w = cShortWhy(f).replace(/^y /, ''); why = `Jugaste ${f.playedSan}` + (w ? ': ' + w : '') + '.'; } catch (e) { why = ''; }
    const c = CLS[m.cls] || CLS.mistake;
    lst.append(h('button', { class: 'moment', onclick: () => startMine([m]) },
      h('span', { class: 'sym', style: { background: c.color } }, c.sym),
      h('span', { class: 't1' }, `vs ${m.opp || 'tu rival'} · jugada ${m.moveNo}${m.date ? ' · ' + m.date : ''}`),
      h('span', { class: 't2' }, why || DG_LONG[mineKey(m)])));
  }
  root.append(lst);
}
// tarjeta para el inicio del Analizador
function mineCard() {
  const pend = minePending(); if (!pend.length) return null;
  const top = DG_ORDER.map(k => [k, pend.filter(m => mineKey(m) === k).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return h('div', { class: 'card mine-card' },
    h('div', { class: 'mc-n' }, String(pend.length)),
    h('div', { class: 'mc-t' }, h('strong', null, 'Practica con tus errores'),
      h('div', { class: 'muted' }, 'Posiciones reales de tus partidas, con la explicación de Karen.'),
      h('div', { class: 'mc-tags' }, top.map(([k, n]) => h('span', { class: 'theme-tag' }, `${DG_NAME[k]} · ${n}`)))),
    h('button', { class: 'btn brass', onclick: () => { AZ.view = 'mine'; renderAnalyze(); } }, 'Practicar'));
}

// ---------------------------------------------------------------- diagnóstico de Karen
// Revisa muchas partidas de tu perfil con el motor (más rápido que el análisis normal) y guarda de cada una solo
// un resumen: resultado, precisión, apertura y sus errores (tipo, fase y pieza perdida). Los errores también
// entran a tu práctica. Lo ya revisado queda guardado aunque cierres la app.
const DG_DEPTH = 12, DG_MAX = 100, DG_COUNTS = [20, 50, 100];
let DG = null; // la revisión en curso
function normalizeDiag(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.games)) return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const games = x.games.filter(g => g && typeof g === 'object' && typeof g.id === 'string' && g.id).slice(-DG_MAX).map(g => ({
    id: str(g.id, 200), opp: str(g.opp, 40), ts: num(g.ts, 0, 9e15), date: str(g.date, 24), tc: str(g.tc, 20),
    res: ['win', 'loss', 'draw'].includes(g.res) ? g.res : 'draw', color: g.color === 'b' ? 'b' : 'w', acc: Math.round(num(g.acc, 0, 100)),
    op: str(g.op, 140), mw: Math.round(num(g.mw, 0, 100, 50)), lw: Math.round(num(g.lw, 0, 100, 50)), inac: Math.round(num(g.inac, 0, 999)),
    mv: [0, 1, 2].map(i => Math.round(num(Array.isArray(g.mv) ? g.mv[i] : 0, 0, 999))),
    e: (Array.isArray(g.e) ? g.e : []).filter(e => Array.isArray(e) && DG_CLS.includes(e[0]) && DG_ORDER.includes(e[1])).slice(0, 60)
      .map(e => [e[0], e[1], ['o', 'm', 'e'].includes(e[2]) ? e[2] : 'm', Math.round(num(e[3], 0, 999)), typeof e[4] === 'string' && /^[pnbrq]$/.test(e[4]) ? e[4] : '']),
  }));
  return { user: str(x.user, 30), platform: x.platform === 'lichess' ? 'lichess' : 'chesscom', at: num(x.at, 0, 9e15), want: DG_COUNTS.includes(+x.want) ? +x.want : 50, games };
}
const dgPhase = (fen, ply) => (Object.values(parseFen(fen)).filter(p => p[1] !== 'p' && p[1] !== 'k').length <= 6 ? 'e' : ply < 24 ? 'o' : 'm');
const DG_PH = { o: 0, m: 1, e: 2 }, DG_PH_NAME = ['la apertura', 'el medio juego', 'el final'], DG_PH_TITLE = ['Apertura', 'Medio juego', 'Final'];
function dgSummary(A, g) {
  const me = A.userColor, sg = me === 'w' ? 1 : -1, mv = [0, 0, 0], e = [];
  let inac = 0, mw = 50, lw = 50;
  A.ucis.forEach((u, i) => {
    if (A.fens[i].split(' ')[1] !== me) return;
    const ph = dgPhase(A.fens[i], i); mv[DG_PH[ph]]++;
    if (A.cls[i] === 'inaccuracy') inac++;
    if (TRAIN.has(A.cls[i])) {
      let lp = '';
      try { const f = cFacts(cCtxA(A, i)); if (f.refLoss) lp = f.refLine.lost.slice().sort((a, b) => VAL[b] - VAL[a])[0] || ''; } catch (err) { lp = ''; }
      e.push([A.cls[i], A.cls[i] === 'miss' ? 'miss' : DG_ORDER.includes(A.cats[i]) ? A.cats[i] : 'plan', ph, i, lp]);
    }
  });
  for (let j = 6; j < A.cps.length; j++) { const w = wp(sg * A.cps[j]); mw = Math.max(mw, w); lw = Math.min(lw, w); }
  return { id: A.id, opp: A.opp || '', ts: g.ts || Date.now(), date: A.date || '', tc: A.timeClass || '', res: A.userResult || 'draw', color: me,
    acc: A.accuracy, op: A.opening || '', mw: Math.round(mw), lw: Math.round(lw), inac, mv, e };
}
// ¿Hay revisión en curso para este perfil?
const dgRunning = () => !!(DG && DG.tok);
async function dgStart(user, platform, want, force) {
  user = (user || '').trim();
  if (!USER_RE.test(user)) { toast(user ? 'Ese usuario no es válido: solo letras, números, guion y guion bajo.' : 'Escribe tu usuario de Chess.com o Lichess.'); return; }
  if (dgRunning()) { AZ.view = 'diag-run'; renderAnalyze(); return; }
  const same = S.diag && S.diag.user.toLowerCase() === user.toLowerCase() && S.diag.platform === platform;
  if (!same && !force && S.diag && S.diag.games.length) {
    schModal('¿Revisar otro perfil?', `Tu diagnóstico es de ${S.diag.user} (${S.diag.platform === 'lichess' ? 'Lichess' : 'Chess.com'}). Si sigues, lo cambio por el de ${user}. Tus errores para practicar se quedan.`,
      [['Sí, cambiarlo', () => dgStart(user, platform, want, true), 'primary'], ['Cancelar']]);
    return;
  }
  S.settings.user = user; save();
  const tok = {};
  DG = { tok, user, platform, want, phase: 'fetch', done: 0, total: 0, found: {}, games: 0, t0: Date.now(), last: null, err: null };
  AZ.view = 'diag-run'; renderAnalyze();
  let list;
  try { list = platform === 'lichess' ? await fetchLichess(user, want) : await fetchChessCom(user, want); }
  catch (e) {
    if (DG && DG.tok === tok) { DG.tok = null; DG.err = e && e.userMsg ? e.userMsg : 'No se pudo conectar. Revisa tu internet e intenta de nuevo.'; dgRender(); }
    return;
  }
  if (!DG || DG.tok !== tok) return;
  if (!list.length) { DG.tok = null; DG.err = 'No encontré partidas de ajedrez estándar para ese usuario.'; dgRender(); return; }
  if (!same) S.diag = { user, platform, at: Date.now(), want, games: [] };
  S.diag.want = want; S.diag.user = user; save();
  const have = new Set(S.diag.games.map(g => g.id));
  DG.todo = list.filter(g => !have.has(g.id)).reverse(); // de la más vieja a la más nueva
  DG.total = DG.todo.length; DG.phase = 'run';
  dgRun(tok);
}
async function dgRun(tok) {
  dgRender();
  try { await engine.init(); } catch (e) { if (DG && DG.tok === tok) { DG.tok = null; DG.err = 'No se pudo iniciar Stockfish en este navegador.'; dgRender(); } return; }
  await loadOpenings();
  while (DG && DG.tok === tok && DG.todo.length) {
    const g = DG.todo[0];
    DG.cur = g; DG.pos = 0; DG.posN = 0; dgTick();
    const A = await dgAnalyze(g, tok);
    if (!DG || DG.tok !== tok) return;
    DG.todo.shift(); DG.done++;
    if (A) {
      const sum = dgSummary(A, g);
      S.diag.games = S.diag.games.filter(x => x.id !== sum.id).concat(sum).sort((a, b) => a.ts - b.ts).slice(-DG_MAX);
      S.diag.at = Date.now(); save();
      DG.games++; DG.last = sum;
      for (const e of sum.e) DG.found[e[1]] = (DG.found[e[1]] || 0) + 1;
    }
    dgTick(true);
  }
  if (!DG || DG.tok !== tok) return;
  const n = DG.games; DG = null;
  Sound.play('done');
  if (currentTab === 'analyze' && AZ.view === 'diag-run') { AZ.view = 'diag'; AZ.diagFresh = true; renderAnalyze(); if (!n) toast('No había partidas nuevas: tu diagnóstico ya está al día.'); }
  else { AZ.diagReady = !!n; toast(n ? 'Karen terminó tu diagnóstico. Míralo en Analizar.' : 'No había partidas nuevas: tu diagnóstico ya está al día.'); if (currentTab === 'analyze' && AZ.view === 'home') renderAnalyze(); }
}
async function dgAnalyze(g, tok) {
  const A = hydrate({ v: 2, id: g.id, pgn: stripComments(g.pgn), userColor: g.userColor, opp: g.opp, oppRating: g.oppRating, userResult: g.userResult, timeClass: g.timeClass, date: g.date, depth: DG_DEPTH });
  if (!A || A.ucis.length < 10) return null; // partidas abandonadas al empezar
  Object.assign(A, { cps: [], best: [], cps2: [], pvs: [], done: false });
  DG.posN = A.fens.length;
  for (let i = 0; i < A.fens.length; i++) {
    if (!DG || DG.tok !== tok) return null;
    const ev = await engine.analyze(A.fens[i], DG_DEPTH, 1);
    A.cps[i] = Math.round(ev.cp); A.best[i] = ev.best; A.cps2[i] = null; A.pvs[i] = pvStr(ev.pv);
    if (DG && DG.tok === tok) { DG.pos = i + 1; if (i % 4 === 3) dgTick(); }
  }
  classifyAnalysis(A); pushMine(A);
  // en memoria para abrirla al instante desde el reporte (solo en esta sesión)
  AZ.cache[A.id] = A;
  const ks = Object.keys(AZ.cache); if (ks.length > DG_MAX) delete AZ.cache[ks[0]];
  return A;
}
function dgPause() { if (!DG) return; DG.tok = null; DG.paused = true; dgRender(); }
function dgResume() {
  if (!DG || !DG.paused) return;
  DG.paused = false; DG.t0 = Date.now(); DG.frac0 = DG.total ? DG.done / DG.total : 0;
  const tok = DG.tok = {}; dgRun(tok);
}
function dgRender() { if (currentTab === 'analyze' && AZ.view === 'diag-run') renderAnalyze(); }
// Lo que dice Karen mientras revisa
function dgLine() {
  if (!DG) return '';
  if (DG.err) return DG.err;
  if (DG.phase === 'fetch') return `Estoy trayendo tus partidas de ${DG.platform === 'lichess' ? 'Lichess' : 'Chess.com'}…`;
  if (DG.paused) return `Pausé la revisión en la partida ${DG.done + 1} de ${DG.total}. Lo que ya revisé está guardado.`;
  if (!DG.total) return 'No hay partidas nuevas desde tu último diagnóstico.';
  const g = DG.cur, L = DG.last;
  let t = g ? `Partida ${Math.min(DG.done + 1, DG.total)} de ${DG.total}: contra ${g.opp || 'tu rival'}${g.userResult === 'win' ? ', que ganaste' : g.userResult === 'loss' ? ', que perdiste' : ''}.` : '';
  if (L) {
    const bl = L.e.filter(e => e[0] === 'blunder').length;
    t += L.e.length === 0 ? ` En la anterior no encontré errores: ¡bien!` : bl ? ` En la anterior encontré ${bl} ${bl > 1 ? 'errores graves' : 'error grave'}.` : ` En la anterior encontré ${L.e.length} ${L.e.length > 1 ? 'errores' : 'error'}.`;
  }
  return t;
}
function dgTick(gameDone) {
  const bar = $('#dg-bar'), txt = $('#dg-txt'), chips = $('#dg-chips');
  if (!DG) return;
  const frac = DG.total ? (DG.done + (DG.posN ? DG.pos / DG.posN : 0)) / DG.total : 0;
  if (bar) bar.style.width = (100 * frac) + '%';
  if (txt) {
    // lo que falta se calcula con lo revisado desde que empezó (o se reanudó) esta vuelta
    const run = frac - (DG.frac0 || 0), ms = Date.now() - DG.t0, left = !DG.paused && run > 0.04 ? Math.round(ms / run * (1 - frac) / 1000) : null;
    txt.textContent = `${DG.done} de ${DG.total} partidas` + (left != null ? ` · faltan unos ${left < 60 ? left + ' s' : Math.ceil(left / 60) + ' min'}` : '');
  }
  // los tipos de error que va encontrando: los nuevos aparecen y los que suben dan un saltito
  if (chips && gameDone) {
    for (const k of DG_ORDER) {
      if (!DG.found[k]) continue;
      const t = `${DG_NAME[k]} · ${DG.found[k]}`;
      let el = chips.querySelector(`[data-k="${k}"]`);
      if (!el) chips.append(h('span', { class: 'theme-tag pop', 'data-k': k }, t));
      else if (el.textContent !== t) { el.textContent = t; el.classList.remove('pop', 'bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
  }
  if (gameDone && AZ.dgSay) AZ.dgSay(dgLine());
}
function renderDiagRun(root) {
  const D = DG;
  root.append(h('div', { class: 'play-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => { AZ.view = 'home'; AZ.dgSay = null; renderAnalyze(); } }, icon('i-close')),
    h('div', { class: 't' }, h('div', { class: 'k' }, 'Diagnóstico de Karen'), h('h2', null, D ? 'Partidas de ' + D.user : 'Diagnóstico'))));
  if (!D) { AZ.view = S.diag ? 'diag' : 'home'; return renderAnalyze(); }
  const on = Mascot.enabled(), fig = on ? new KarenFig(DG_VIEW) : null, p = h('p'), ty = new Typer();
  if (fig) fig.pose(D.err ? { mood: 'worry', prop: 'glasses' } : D.paused ? { mood: 'idle', prop: 'glasses' } : { mood: 'think', prop: ['glasses', 'magnifier'] });
  // si llega otra frase mientras escribe, la dice al terminar (no se corta a media palabra)
  let pending = null;
  const say = text => {
    if (!fig || !p.isConnected) { p.textContent = text; return; }
    if (ty.cur) { pending = text; return; }
    ty.type(p, text, fig, () => { if (pending) { const t = pending; pending = null; setTimeout(() => say(t), 700); } });
  };
  AZ.dgSay = say;
  root.append(h('div', { class: 'dg-run' + (on ? '' : ' plain') },
    on ? h('div', { class: 'dg-fig', 'aria-hidden': 'true' }, fig.body) : null,
    h('div', { class: (on ? 'speech ' : 'caption ') + 'dg-say', role: 'status', 'aria-live': 'polite', onclick: () => ty.cur && ty.finish() }, on ? h('span', { class: 'm-name' }, MASCOT.name) : null, p)));
  if (!D.err) {
    root.append(h('div', { class: 'card stack dg-prog' },
      h('div', { class: 'progress' }, h('div', { id: 'dg-bar' })),
      h('div', { class: 'muted', id: 'dg-txt', style: { fontSize: '14px' } }, D.phase === 'fetch' ? 'Buscando partidas…' : ''),
      h('div', { class: 'dg-chips', id: 'dg-chips' }, DG_ORDER.filter(k => D.found[k]).map(k => h('span', { class: 'theme-tag', 'data-k': k }, `${DG_NAME[k]} · ${D.found[k]}`))),
      h('div', { class: 'row' }, D.phase === 'run' ? (D.paused ? h('button', { class: 'btn primary', onclick: () => dgResume() }, 'Continuar') : h('button', { class: 'btn', onclick: () => dgPause() }, 'Pausar')) : null,
        S.diag && S.diag.games.length && D.phase === 'run' ? h('button', { class: 'btn', onclick: () => { AZ.view = 'diag'; renderAnalyze(); } }, 'Ver lo que llevo') : null),
      h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Todo se calcula en tu dispositivo. Puedes usar el resto de la app mientras reviso; lo que ya revisé queda guardado.')));
  } else root.append(h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => { DG = null; AZ.view = 'home'; renderAnalyze(); } }, 'Volver')));
  requestAnimationFrame(() => { say(dgLine()); dgTick(true); });
}
const DG_VIEW = { x: -40, y: -30, w: 500, h: 470 }; // Karen de la cintura para arriba, con su lupa

// ---------- el reporte
// Aperturas con lección en la Escuela
const DG_OPENING_LESSON = [[/Smith-Morra/, 'morra'], [/^Defensa Siciliana/, 'siciliana'], [/^Apertura Española/, 'espanola'], [/^Defensa Francesa/, 'francesa'],
  [/^Gambito de Dama Rehusado/, 'gd-rehusado'], [/^Gambito de Dama Aceptado/, 'gd-aceptado'], [/Evans/, 'evans'], [/Two Knights Defense|Dos Caballos/, 'dos-caballos'],
  [/^Partida Italiana/, 'italiana'], [/^Apertura Inglesa/, 'inglesa'], [/^Gambito de Rey/, 'gambito-rey'], [/India de Rey/, 'india-rey'], [/Caro-Kann/, 'caro-kann'],
  [/Nimzoindia/, 'nimzo'], [/Holandesa/, 'holandesa'], [/Escocesa/, 'escocesa'], [/Eslava|Semieslava/, 'eslava'], [/Petrov/, 'petrov'], [/Escandinava/, 'escandinava'],
  [/Réti/, 'reti'], [/Pirc/, 'pirc'], [/Londres|London System/, 'londres'], [/Dan(ish|és)/, 'danes']];
function dgLessonFor(name) {
  for (const [re, id] of DG_OPENING_LESSON) if (re.test(name) && schAll().some(x => x.l.id === id)) return id;
  return null;
}
function dgStats(D) {
  const G = D.games, n = G.length;
  const st = { n, w: 0, l: 0, d: 0, acc: 0, errs: 0, bl: 0, by: {}, ph: [[0, 0], [0, 0], [0, 0]], lost: {}, winLost: [], saves: [], ops: {}, tc: {} };
  for (const g of G) {
    st[g.res === 'win' ? 'w' : g.res === 'loss' ? 'l' : 'd']++; st.acc += g.acc;
    g.mv.forEach((m, i) => { st.ph[i][0] += m; });
    for (const e of g.e) {
      st.errs++; if (e[0] === 'blunder') st.bl++;
      st.by[e[1]] = (st.by[e[1]] || 0) + 1; st.ph[DG_PH[e[2]]][1]++;
      if (e[4]) st.lost[e[4]] = (st.lost[e[4]] || 0) + 1;
    }
    if (g.mw >= 85 && g.res !== 'win') st.winLost.push(g);
    if (g.lw <= 15 && g.res !== 'loss') st.saves.push(g);
    const fam = (g.op || '').split(' · ')[0];
    if (fam) { const k = g.color + '|' + fam, o = st.ops[k] = st.ops[k] || { fam, color: g.color, n: 0, w: 0, l: 0, d: 0, acc: 0, full: g.op }; o.n++; o[g.res === 'win' ? 'w' : g.res === 'loss' ? 'l' : 'd']++; o.acc += g.acc; }
    if (g.tc) { const t = st.tc[g.tc] = st.tc[g.tc] || { n: 0, acc: 0, w: 0 }; t.n++; t.acc += g.acc; if (g.res === 'win') t.w++; }
  }
  st.acc = n ? Math.round(st.acc / n) : 0;
  st.keys = DG_ORDER.filter(k => st.by[k]).sort((a, b) => st.by[b] - st.by[a]);
  // fase: errores cada cuántas jugadas (solo si hay suficientes jugadas en esa fase)
  st.rate = st.ph.map(([m, e]) => (m >= 20 ? e / m : null));
  const rated = st.rate.map((r, i) => [r, i]).filter(x => x[0] != null);
  st.worstPh = rated.length >= 2 ? rated.sort((a, b) => b[0] - a[0])[0][1] : null;
  if (st.worstPh != null && st.rate[st.worstPh] === 0) st.worstPh = null;
  return st;
}
function dgKarenSays(st) {
  const kinds = [st.w, st.l, st.d].filter(Boolean).length;
  const res = st.n === 1 ? (st.w ? 'la ganaste' : st.l ? 'la perdiste' : 'terminó en tablas')
    : kinds === 1 ? (st.w ? '¡las ganaste todas!' : st.l ? 'las perdiste todas, pero de ahí se aprende mucho' : 'todas terminaron en tablas')
      : cJoin([st.w && `ganaste ${st.w}`, st.l && `perdiste ${st.l}`, st.d && `empataste ${st.d}`].filter(Boolean));
  const parts = [`Revisé ${st.n} ${st.n > 1 ? 'partidas' : 'partida'}: ${res}${/!$/.test(res) ? '' : '.'} Tu precisión media es de ${st.acc}%.`];
  const top = st.keys[0];
  if (top && st.errs >= 3) parts.push(`Lo que más te cuesta: ${DG_LONG[top].toLowerCase()} (${Math.round(100 * st.by[top] / st.errs)}% de tus errores).`);
  else if (!st.errs) parts.push('No encontré errores graves. ¡Impresionante!');
  if (st.worstPh != null) parts.push(`Te equivocas más en ${DG_PH_NAME[st.worstPh]}.`);
  if (st.winLost.length >= 2) parts.push(`Y ojo: en ${st.winLost.length} partidas ibas ganando y se te escaparon.`);
  parts.push('Abajo está tu plan.');
  return parts.join(' ');
}
function dgBar(label, n, total, color, sub, extra) {
  const pct = total ? Math.round(100 * n / total) : 0;
  // sin consejo, el botón va en la misma línea que el nombre
  return h('div', { class: 'dg-row' },
    h('div', { class: 'dg-row-top' }, h('strong', null, label), h('span', { class: 'dg-row-r' }, h('span', { class: 'mono' }, `${n} · ${pct}%`), sub ? null : extra || null)),
    h('div', { class: 'dg-track' }, h('i', { style: { width: Math.max(3, pct) + '%', background: color || 'var(--mine)' } })),
    sub ? h('div', { class: 'dg-row-bot' }, h('div', { class: 'dg-sub' }, sub), extra || null) : null);
}
function dgGameRow(g) {
  const can = AZ.cache[g.id] || S.games.some(x => x.id === g.id);
  const href = /^https:\/\/www\.chess\.com\//.test(g.id) ? g.id : /^li-[A-Za-z0-9]{8}$/.test(g.id) ? 'https://lichess.org/' + g.id.slice(3) : null;
  const bl = g.e.filter(e => e[0] === 'blunder').length;
  const meta = [`Precisión ${g.acc}%`, bl ? `${bl} ${bl > 1 ? 'graves' : 'grave'}` : g.e.length ? `${g.e.length} ${g.e.length > 1 ? 'errores' : 'error'}` : 'sin errores', g.tc, g.date].filter(Boolean).join(' · ');
  const res = g.res || 'draw';
  return h('div', { class: 'card game' },
    h('span', { class: 'res ' + res, 'aria-hidden': 'true' }),
    h('div', { class: 'info' }, h('div', { class: 'vs' }, `vs ${g.opp || '?'}`), h('div', { class: 'meta' }, meta)),
    can ? h('button', { class: 'btn small', onclick: () => { const A = AZ.cache[g.id] || hydrate(S.games.find(y => y.id === g.id)); if (!A) return; AZ.analysis = A; AZ.idx = 0; AZ.view = 'analysis'; AZ.back = 'diag'; renderAnalyze(); } }, 'Ver')
      : href ? h('a', { class: 'btn small', href, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir') : null);
}
// precisión partida por partida (barras del color del resultado)
function dgTrend(G) {
  const W = 1000, H = 160, n = G.length, bw = W / Math.max(n, 1);
  const svg = svgEl('svg', { class: 'dg-trend', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Precisión en cada partida, de la más vieja a la más nueva' });
  const avg = G.reduce((a, g) => a + g.acc, 0) / Math.max(1, n);
  G.forEach((g, i) => {
    const hh = Math.max(4, (g.acc / 100) * (H - 8));
    svg.append(svgEl('rect', { x: i * bw + bw * 0.14, y: H - hh, width: bw * 0.72, height: hh, rx: Math.min(6, bw * 0.2), fill: g.res === 'win' ? 'var(--good)' : g.res === 'loss' ? 'var(--bad)' : 'var(--muted)', opacity: '.85' }));
  });
  const y = H - (avg / 100) * (H - 8);
  svg.append(svgEl('line', { x1: 0, x2: W, y1: y, y2: y, stroke: 'var(--brass)', 'stroke-width': '2.5', 'stroke-dasharray': '8 6', 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}
function renderDiag(root) {
  const D = S.diag;
  root.append(h('div', { class: 'play-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => { AZ.view = 'home'; renderAnalyze(); } }, icon('i-close')),
    h('div', { class: 't' }, h('div', { class: 'k' }, 'Diagnóstico de Karen'), h('h2', null, D ? 'Partidas de ' + D.user : 'Diagnóstico'))));
  if (!D || !D.games.length) {
    root.append(coachNote('Todavía no reviso tus partidas. Escribe tu usuario en el Analizador y pídeme un diagnóstico.', 'point'));
    return;
  }
  const st = dgStats(D), G = D.games;
  const first = G[0], last = G[G.length - 1];
  root.append(h('p', { class: 'muted', style: { marginTop: 0 } }, `${G.length} ${G.length > 1 ? 'partidas' : 'partida'} de ${D.platform === 'lichess' ? 'Lichess' : 'Chess.com'}`
    + (first.date && last.date ? (first.date === last.date ? `, del ${first.date}` : `, del ${first.date} al ${last.date}`) : '') + '.'));
  if (dgRunning()) root.append(h('div', { class: 'notice' }, h('strong', null, 'Sigo revisando. '), `Llevo ${DG.done} de ${DG.total}. `, h('button', { class: 'btn small', onclick: () => { AZ.view = 'diag-run'; renderAnalyze(); } }, 'Ver')));
  root.append(coachNote(dgKarenSays(st), st.errs && st.keys[0] ? 'think' : 'cheer'));
  AZ.diagFresh = false;
  // números grandes
  root.append(h('div', { class: 'dg-kpi' },
    h('div', { class: 'card' }, h('div', { class: 'v' }, String(st.n)), h('div', { class: 'l' }, st.n > 1 ? 'Partidas' : 'Partida')),
    h('div', { class: 'card' }, h('div', { class: 'v' }, st.acc + '%'), h('div', { class: 'l' }, 'Precisión media')),
    h('div', { class: 'card' }, h('div', { class: 'v', style: { color: 'var(--c-blunder)' } }, (st.n ? st.bl / st.n : 0).toFixed(1)), h('div', { class: 'l' }, 'Errores graves por partida'))),
  h('div', { class: 'dg-wld', role: 'img', 'aria-label': `${st.w} ganadas, ${st.l} perdidas y ${st.d} tablas` },
    h('div', { class: 'dg-wld-bar' }, [['w', st.w], ['l', st.l], ['d', st.d]].filter(x => x[1]).map(([k, n]) => h('i', { class: k, style: { flexGrow: n } }))),
    h('div', { class: 'dg-wld-t' }, h('span', { class: 'w' }, `${st.w} ${st.w === 1 ? 'ganada' : 'ganadas'}`), h('span', { class: 'l' }, `${st.l} ${st.l === 1 ? 'perdida' : 'perdidas'}`), h('span', { class: 'd' }, `${st.d} tablas`))));
  if (G.length >= 3) root.append(h('p', { class: 'section-title', style: { marginTop: '20px' } }, 'Tu precisión, partida por partida'), dgTrend(G),
    h('div', { class: 'cmp' }, h('span', null, h('i', { style: { background: 'var(--good)' } }), 'Ganada'), h('span', null, h('i', { style: { background: 'var(--bad)' } }), 'Perdida'), h('span', null, h('i', { style: { background: 'var(--muted)' } }), 'Tablas'), h('span', null, h('i', { style: { background: 'var(--brass)' } }), 'Tu media')));

  // errores más comunes
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Tus errores más comunes'));
  if (!st.errs) root.append(h('div', { class: 'notice good' }, 'Ningún error grave en estas partidas. Revisa las imprecisiones en cada análisis.'));
  else {
    const box = h('div', { class: 'card dg-bars' });
    st.keys.forEach((k, j) => {
      const pend = minePending(k).length;
      box.append(dgBar(DG_LONG[k], st.by[k], st.errs, j === 0 ? 'var(--mine)' : 'var(--violet)', j < 2 ? DG_TIP[k] : null,
        pend ? h('button', { class: 'btn tiny', onclick: () => startMineKey(k), 'aria-label': `Practicar: ${DG_LONG[k]} (${pend})` }, icon('i-play'), 'Practicar') : null));
    });
    root.append(box);
  }
  // fases
  if (st.rate.some(r => r != null)) {
    root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, '¿Cuándo te equivocas?'));
    const max = Math.max(...st.rate.filter(r => r != null), 0.0001);
    root.append(h('div', { class: 'dg-phases' }, st.rate.map((r, i) => h('div', { class: 'card' + (i === st.worstPh ? ' worst' : '') },
      h('div', { class: 'l' }, DG_PH_TITLE[i]),
      h('div', { class: 'v' }, r == null ? '—' : r > 0 && r < 0.01 ? '<1%' : Math.round(100 * r) + '%'),
      h('div', { class: 'l' }, r == null ? 'pocas jugadas' : r === 0 ? 'sin errores' : 'de tus jugadas son errores'),
      h('div', { class: 'dg-track' }, h('i', { style: { width: r == null ? '0' : Math.max(4, 100 * r / max) + '%', background: i === st.worstPh ? 'var(--mine)' : 'var(--violet)' } }))))));
  }
  // piezas que más pierdes
  const lost = Object.entries(st.lost).sort((a, b) => b[1] - a[1]);
  if (lost.length) {
    root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Lo que más pierdes por tus errores'),
      h('div', { class: 'card dg-lost' }, lost.map(([p, n]) => h('div', { class: 'dg-pc' }, miniPiece(p, 'big-pc', 'w'), h('strong', null, String(n)), h('span', null, n > 1 ? C_PLURAL[p] : C_NAME[p])))));
  }
  // el plan de Karen
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'El plan de Karen'));
  const plan = h('div', { class: 'stack' });
  const worldBtn = wk => WORLD_META[wk] ? h('button', { class: 'btn small', onclick: () => goWorld(wk) }, WORLD_META[wk].name) : null;
  const lessonBtn = (id, label) => schAll().some(x => x.l.id === id) ? h('button', { class: 'btn small', onclick: () => schOpen(id) }, label || schAll().find(x => x.l.id === id).l.name) : null;
  const step = (n, title, text, btns) => h('div', { class: 'card dg-step' }, h('span', { class: 'dg-n' }, String(n)), h('div', null, h('strong', null, title), h('p', null, text), h('div', { class: 'row' }, btns)));
  let k = 1;
  if (st.keys[0] && st.errs >= 2) {
    const key = st.keys[0], pend = minePending(key).length;
    plan.append(step(k++, DG_LONG[key], DG_TIP[key], [pend ? h('button', { class: 'btn small brass', onclick: () => startMineKey(key) }, `Tus errores (${pend})`) : null,
      ...(DG_WORLDS[key] || []).slice(0, 2).map(worldBtn), DG_LESSON[key] ? lessonBtn(DG_LESSON[key]) : null]));
  }
  if (st.worstPh === 0) plan.append(step(k++, 'Abre mejor tus partidas', 'Tus primeras jugadas te cuestan más que el resto. Repasa los principios: centro, desarrollo y rey a salvo.', [lessonBtn('centro'), lessonBtn('desarrollo'), lessonBtn('trampas')]));
  else if (st.worstPh === 2) plan.append(step(k++, 'Practica los finales', 'Cuando quedan pocas piezas te equivocas más. Con unas cuantas reglas los finales se vuelven fáciles.', [lessonBtn('cuadrado'), lessonBtn('oposicion'), lessonBtn('ruptura')]));
  else if (st.worstPh === 1) plan.append(step(k++, 'Calcula antes de jugar', 'En el medio juego es donde más fallas. Antes de mover, revisa jaques, capturas y amenazas de los dos lados.', [worldBtn('mix'), lessonBtn('plan')]));
  if (st.winLost.length >= 2) plan.append(step(k++, 'Remata tus partidas ganadas', `En ${st.winLost.length} partidas ibas ganando y no ganaste. Cuando vayas arriba: cambia piezas, cuida a tu rey y no te apresures.`, [worldBtn('mate1'), worldBtn('defense')]));
  else if (st.keys[1] && st.by[st.keys[1]] >= 2) { const key = st.keys[1], pend = minePending(key).length; plan.append(step(k++, DG_LONG[key], DG_TIP[key], [pend ? h('button', { class: 'btn small', onclick: () => startMineKey(key) }, `Tus errores (${pend})`) : null, ...(DG_WORLDS[key] || []).slice(0, 2).map(worldBtn)])); }
  if (k === 1) plan.append(step(k++, 'Sigue así', 'No encontré un error que se repita. Sube de nivel en el mapa y juega el modo infinito para seguir afilando tu táctica.', [worldBtn('mix')]));
  root.append(plan);
  // aperturas
  const ops = Object.values(st.ops).sort((a, b) => b.n - a.n).slice(0, 6);
  if (ops.length) {
    root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Tus aperturas'));
    const tb = h('div', { class: 'card dg-ops' });
    for (const o of ops) {
      const les = dgLessonFor(o.fam);
      tb.append(h('div', { class: 'dg-op' },
        h('span', { class: 'dg-dot ' + o.color, title: o.color === 'w' ? 'Con blancas' : 'Con negras' }),
        h('div', { class: 'dg-op-t' }, h('strong', null, o.fam), h('span', { class: 'muted' }, `Con ${o.color === 'w' ? 'blancas' : 'negras'} · ${o.n} ${o.n > 1 ? 'partidas' : 'partida'} · ${o.w}-${o.l}-${o.d} · ${Math.round(o.acc / o.n)}%`)),
        les ? h('button', { class: 'btn small', onclick: () => schOpen(les) }, 'Lección') : null));
    }
    root.append(tb, h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '6px' } }, 'Ganadas-perdidas-tablas y tu precisión media con cada apertura.'));
  }
  // ritmos
  const tcs = Object.entries(st.tc);
  if (tcs.length >= 2) {
    root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Por ritmo de juego'),
      h('div', { class: 'dg-kpi' }, tcs.sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([t, x]) => h('div', { class: 'card' }, h('div', { class: 'v' }, Math.round(x.acc / x.n) + '%'), h('div', { class: 'l' }, `${t} · ${x.n} ${x.n > 1 ? 'partidas' : 'partida'}`)))));
  }
  if (st.winLost.length) {
    root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Ventajas que se escaparon'));
    const b = h('div', { class: 'games' }); st.winLost.slice(-5).reverse().forEach(g => b.append(dgGameRow(g))); root.append(b);
  }
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Partidas revisadas'));
  // las 10 más recientes; las demás con un botón
  const gl = h('div', { class: 'games' }), all = G.slice().reverse();
  all.slice(0, 10).forEach(g => gl.append(dgGameRow(g))); root.append(gl);
  if (all.length > 10) {
    const more = h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: () => { all.slice(10).forEach(g => gl.append(dgGameRow(g))); more.remove(); } }, `Ver las ${all.length}`);
    root.append(more);
  }
  root.append(h('div', { class: 'row', style: { marginTop: '16px' } },
    h('button', { class: 'btn', disabled: dgRunning() ? true : null, onclick: () => dgStart(D.user, D.platform, D.want || 50) }, 'Revisar partidas nuevas'),
    h('button', { class: 'btn danger-btn', onclick: () => schModal('¿Borrar el diagnóstico?', 'Se borra el resumen de tus partidas. Tus errores para practicar se quedan.', [
      ['Borrar', () => { if (DG) DG.tok = null; DG = null; S.diag = null; save(); AZ.view = 'home'; renderAnalyze(); }, 'danger-btn'], ['Cancelar', null, 'primary']]) }, 'Borrar diagnóstico')),
  h('p', { class: 'credits' }, `Revisado con ${engine.name || 'Stockfish'} a profundidad ${DG_DEPTH}. Para ver una partida con todo detalle, ábrela desde "Buscar mis partidas".`));
}
// tarjeta del diagnóstico en el inicio del Analizador
function diagCard(userInput) {
  const D = S.diag, run = dgRunning() || (DG && DG.paused);
  const fig = Mascot.enabled() ? new KarenFig(KHEAD) : null;
  if (fig) fig.pose({ mood: run ? 'think' : 'point', prop: 'glasses' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Cuántas partidas' });
  const want = AZ.dgWant || (D && D.want) || 50;
  for (const n of DG_COUNTS) seg.append(h('button', { type: 'button', 'aria-pressed': want === n ? 'true' : 'false', onclick: () => { AZ.dgWant = n; $$('button', seg).forEach(b => b.setAttribute('aria-pressed', b.textContent === String(n) ? 'true' : 'false')); } }, String(n)));
  const go = () => dgStart(userInput ? userInput.value : S.settings.user, S.settings.platform, AZ.dgWant || (D && D.want) || 50);
  let body;
  if (run) body = [h('p', null, DG.paused ? `Pausé la revisión de las partidas de ${DG.user} (${DG.done} de ${DG.total}).` : `Estoy revisando las partidas de ${DG.user}: llevo ${DG.done} de ${DG.total || '…'}.`),
    h('div', { class: 'row' }, h('button', { class: 'btn brass', onclick: () => { AZ.view = 'diag-run'; renderAnalyze(); } }, DG.paused ? 'Continuar' : 'Ver cómo voy'))];
  else if (D && D.games.length) {
    const st = dgStats(D), top = st.keys[0];
    body = [h('p', null, (AZ.diagReady ? '¡Listo! ' : '') + `Revisé ${st.n} partidas de ${D.user}.` + (top ? ` Tu error más común: ${DG_LONG[top].toLowerCase()}.` : '')),
      h('div', { class: 'row' }, h('button', { class: 'btn brass', onclick: () => { AZ.diagReady = false; AZ.view = 'diag'; renderAnalyze(); } }, 'Ver mi diagnóstico'),
        h('button', { class: 'btn small', onclick: () => dgStart(D.user, D.platform, D.want || 50) }, 'Revisar nuevas'))];
  } else body = [h('p', null, 'Reviso de una vez tus últimas partidas y te digo qué errores repites, en qué parte de la partida fallas más y qué practicar.'),
    h('div', { class: 'row' }, h('span', { style: { fontWeight: 700, fontSize: '14px' } }, 'Partidas'), seg),
    h('div', { class: 'row' }, h('button', { class: 'btn brass', onclick: go }, 'Hacer mi diagnóstico'), userInput ? h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Con el usuario de arriba.') : null)];
  return h('div', { class: 'card diag-card' + (fig ? '' : ' plain') },
    fig ? h('div', { class: 'k-face', 'aria-hidden': 'true' }, fig.body) : null,
    h('div', { class: 'dgc-body' }, h('strong', { class: 'dgc-title' }, 'Diagnóstico de Karen'), body));
}
