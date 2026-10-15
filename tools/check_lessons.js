#!/usr/bin/env node
/* Revisa la Escuela (src/lessons.js): que cada posición y jugada sea legal, que las respuestas sean buenas
   según Stockfish, que no falte ningún mate en 1 cuando se pide mate, que las notas de las aperturas
   coincidan con las jugadas y que las prácticas empiecen en posiciones que se pueden cumplir.

   Uso: node tools/check_lessons.js            (necesita Stockfish en el PATH o en la variable STOCKFISH)
        node tools/check_lessons.js --rapido   (solo legalidad, sin motor) */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { Chess } = require(path.join(ROOT, 'assets/vendor/chess.js'));
const { SCHOOL, KAREN_LINES, START } = require(path.join(ROOT, 'src/lessons.js'));
const FAST = process.argv.includes('--rapido');

let errors = 0, warns = 0;
const err = (where, msg) => { errors++; console.log('  ERROR ' + where + ': ' + msg); };
const warn = (where, msg) => { warns++; console.log('  aviso ' + where + ': ' + msg); };

// ------------------------------------------------------------------ motor
function findStockfish() {
  if (process.env.STOCKFISH) return process.env.STOCKFISH;
  for (const d of (process.env.PATH || '').split(path.delimiter).concat(['/usr/games', '/usr/local/bin'])) {
    for (const n of ['stockfish', 'stockfish.exe']) { const p = path.join(d, n); if (fs.existsSync(p)) return p; }
  }
  return null;
}
class Engine {
  constructor(bin) {
    this.p = spawn(bin); this.buf = ''; this.waiters = [];
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.lines.push(l); this.waiters = this.waiters.filter(w => !w(l)); } });
    this.lines = [];
    this.send('uci'); this.send('setoption name Threads value 2'); this.send('setoption name Hash value 64');
  }
  send(s) { this.p.stdin.write(s + '\n'); }
  until(pred) { return new Promise(res => this.waiters.push(l => { if (pred(l)) { res(l); return true; } return false; })); }
  async analyse(fen, depth, multipv = 1) {
    this.send('setoption name MultiPV value ' + multipv); this.send('isready'); await this.until(l => l === 'readyok');
    this.lines = []; this.send('position fen ' + fen); this.send('go depth ' + depth);
    await this.until(l => l.startsWith('bestmove'));
    const out = {};
    for (const l of this.lines) {
      const m = l.match(/ depth (\d+) .*multipv (\d+) score (cp|mate) (-?\d+).* pv (.+)$/); if (!m) continue;
      out[m[2]] = { depth: +m[1], cp: m[3] === 'cp' ? +m[4] : (+m[4] > 0 ? 100000 - +m[4] : -100000 - +m[4]), mate: m[3] === 'mate' ? +m[4] : null, pv: m[5].split(' ') };
    }
    return Object.keys(out).sort((a, b) => a - b).map(k => out[k]); // puntaje desde el bando que mueve
  }
  quit() { this.send('quit'); }
}

// ------------------------------------------------------------------ utilidades
const ES = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };
const toEs = san => san.replace(/^[KQRBN]/, c => ES[c]).replace(/=([QRBN])/, (m, c) => '=' + ES[c]);
function playLine(fen, sans, where) {
  const g = new Chess(fen || START); const fens = [g.fen()], moves = [];
  for (const s of (sans || '').split(' ').filter(Boolean)) {
    const mv = g.move(s, { sloppy: true }); if (!mv) { err(where, 'jugada ilegal "' + s + '" en ' + g.fen()); return null; }
    moves.push(mv); fens.push(g.fen());
  }
  return { g, fens, moves };
}
function posOf(step, where) {
  if (step.from) { const r = playLine(START, step.from, where); return r ? r.g.fen() : null; }
  const f = step.fen || (typeof step.move === 'string' && step.move) || (typeof step.stars === 'string' && step.stars) || null;
  return f;
}
function validFen(fen, where) {
  const g = new Chess(); if (!g.load(fen)) { err(where, 'FEN inválido: ' + fen); return false; } return true;
}
const uci = m => m.from + m.to + (m.promotion || '');

// ------------------------------------------------------------------ revisión
async function main() {
  const bin = FAST ? null : findStockfish();
  if (!FAST && !bin) { console.log('No encontré Stockfish. Pon la ruta en la variable STOCKFISH o usa --rapido.'); process.exit(2); }
  const eng = bin ? new Engine(bin) : null;
  const ids = new Set(); let nLessons = 0, nSteps = 0;
  if (!SCHOOL.blocks.length) err('escuela', 'sin bloques');
  for (const b of SCHOOL.blocks) {
    console.log('\n' + b.name + ' (' + b.title + ')');
    if (!b.title || !b.titleLines || !b.titleLines.length) err(b.id, 'falta título o frases del título');
    for (const L of b.lessons) {
      nLessons++;
      const W = b.id + '/' + L.id;
      if (ids.has(L.id)) err(W, 'id repetido'); ids.add(L.id);
      if (!L.steps.length || !L.steps[L.steps.length - 1].recap) warn(W, 'no termina con resumen');
      let lastFen = null;
      for (let si = 0; si < L.steps.length; si++) {
        const s = L.steps[si]; nSteps++;
        const w = W + '#' + si;
        const kinds = ['say', 'tap', 'stars', 'move', 'line', 'quiz', 'play', 'recap'].filter(k => k in s && !(k === 'say' && ('tap' in s || 'stars' in s || 'move' in s || 'line' in s || 'play' in s)));
        if (!kinds.length) { err(w, 'paso sin tipo'); continue; }
        const kind = kinds[0];
        let fen = posOf(s, w);
        if (s.fen && !validFen(s.fen, w)) continue;
        if (kind === 'say') {
          if (fen) lastFen = fen;
          if (s.anim) { if (!(fen || lastFen)) err(w, 'animación sin posición'); else playLine(fen || lastFen, s.anim, w + ' (animación)'); }
          for (const sq of (s.marks || [])) if (!/^[a-h][1-8]$/.test(sq)) err(w, 'casilla rara ' + sq);
          for (const a of (s.arrows || [])) { const t = typeof a === 'string' ? a : a.a; if (!/^[a-h][1-8][a-h][1-8]$/.test(t)) err(w, 'flecha rara ' + t); }
        } else if (kind === 'tap') {
          if (!/^[a-h][1-8]$/.test(s.tap)) err(w, 'casilla rara ' + s.tap);
        } else if (kind === 'stars') {
          if (!validFen(s.stars, w)) continue;
          const g = new Chess(s.stars);
          const targets = s.eat ? g.board().flat().filter(Boolean).filter(p => p.color === 'b').length : (s.goal || []).length;
          if (!targets) err(w, 'no hay nada que recoger');
          // ¿se puede? búsqueda en anchura moviendo solo las blancas
          const ok = solveStars(s.stars, s.goal || [], !!s.eat, 12);
          if (ok < 0) err(w, 'no encontré cómo recoger todo en 12 jugadas'); else console.log('    estrellas ' + L.id + ': mínimo ' + ok + ' jugadas');
        } else if (kind === 'move') {
          if (!fen) { err(w, 'move sin posición'); continue; }
          if (!validFen(fen, w)) continue;
          const g = new Chess(fen); const legal = g.moves(); const bare = x => x.replace(/[+#]/g, '');
          for (const a of s.ans) if (!legal.map(bare).includes(bare(a))) err(w, 'respuesta "' + a + '" no es legal (legales: ' + legal.join(' ') + ')');
          if (s.mate && !legal.some(m => m.endsWith('#'))) err(w, 'pide mate pero no hay mate en 1');
          if (eng && g.board().flat().some(p => p && p.type === 'k')) {
            const res = await eng.analyse(fen, 16, Math.min(8, legal.length));
            const best = res[0];
            const mates1 = legal.filter(m => { const h = new Chess(fen); h.move(m); return h.in_checkmate(); });
            if (mates1.length && !s.mate) for (const m of mates1) if (!s.ans.includes(m)) warn(w, 'hay mate con ' + m + ' y no se acepta');
            for (const a of s.ans) {
              const h = new Chess(fen); const mv = h.move(a); if (!mv) continue;
              const r = h.in_checkmate() ? [{ cp: -100000 }] : await eng.analyse(h.fen(), 14);
              const sc = -(r[0] ? r[0].cp : 0);
              const loss = best.cp - sc;
              if (loss > 150 && sc < 300) warn(w, a + ' pierde ' + loss + ' cp frente a la mejor (' + best.pv[0] + ', ' + best.cp + ')');
              console.log('    ' + L.id + ' ' + a + ': ' + fmt(sc) + ' (mejor ' + best.pv[0] + ' ' + fmt(best.cp) + ')');
            }
          }
        } else if (kind === 'line') {
          const r = playLine(START, s.line, w); if (!r) continue;
          const side = s.side; if (!['w', 'b'].includes(side)) err(w, 'side debe ser w o b');
          for (const [k, note] of Object.entries(s.notes || {})) {
            const i = +k; if (i >= r.moves.length) { err(w, 'nota en la jugada ' + i + ' pero la línea tiene ' + r.moves.length); continue; }
            const m = note.match(/^(\d+)\.(\.\.)?([^:\s]+?)[:!?]*(?::|$|\s)/);
            if (m) {
              const num = Math.floor(i / 2) + 1, black = i % 2 === 1;
              const want = toEs(r.moves[i].san).replace(/[+#]/g, '');
              const got = m[3].replace(/[+#!?]/g, '');
              if (+m[1] !== num || !!m[2] !== black || got !== want) err(w, 'nota ' + i + ' dice "' + m[0].trim() + '" pero la jugada es ' + num + (black ? '...' : '.') + want);
            }
          }
          if (eng) { const e = await eng.analyse(r.g.fen(), 16); const cpW = r.g.turn() === 'w' ? e[0].cp : -e[0].cp; console.log('    ' + L.id + ' línea final: ' + fmt(cpW) + ' (blancas)'); if (Math.abs(cpW) > 120) warn(w, 'la línea termina desequilibrada: ' + cpW); }
          await openingName(r.fens, w);
        } else if (kind === 'quiz') {
          if (!Array.isArray(s.opts) || s.ans == null || s.ans >= s.opts.length) err(w, 'quiz con respuesta fuera de rango');
          if (fen && !validFen(fen, w)) continue;
          if (!s.why) warn(w, 'quiz sin explicación');
        } else if (kind === 'play') {
          const p = s.play;
          let pf = p.fen;
          if (p.line) { const r = playLine(START, p.line, w); if (!r) continue; pf = r.g.fen(); }
          if (!pf || !validFen(pf, w)) { err(w, 'práctica sin posición'); continue; }
          const g = new Chess(pf);
          if (g.turn() !== p.side && p.goal !== 'opening') err(w, 'la práctica empieza con el turno de Karen (' + g.turn() + ') y no del alumno (' + p.side + ')');
          if (!['mate', 'promote', 'hold', 'opening', 'principles', 'game'].includes(p.goal)) err(w, 'meta desconocida ' + p.goal);
          if (p.level == null || p.level < 0 || p.level > 4) err(w, 'nivel fuera de rango');
          if (eng && ['mate', 'promote', 'hold', 'opening'].includes(p.goal)) {
            const e = await eng.analyse(pf, 20);
            const mine = g.turn() === p.side ? e[0].cp : -e[0].cp; // desde el alumno
            console.log('    ' + L.id + ' práctica ' + p.goal + ': ' + fmt(mine) + ' para el alumno');
            if ((p.goal === 'mate' || p.goal === 'promote') && mine < 400) err(w, 'la práctica de ganar no está ganada (' + mine + ')');
            if (p.goal === 'mate' && e[0].mate && Math.abs(e[0].mate) > p.n) err(w, 'el mate más rápido (' + e[0].mate + ') pasa del límite de ' + p.n);
            if (p.goal === 'hold' && mine < -150) err(w, 'la práctica de aguantar ya está perdida (' + mine + ')');
            if (p.goal === 'opening' && mine < -120) warn(w, 'la práctica de apertura empieza mal para el alumno (' + mine + ')');
          }
        } else if (kind === 'recap') {
          if (!Array.isArray(s.recap) || !s.recap.length) err(w, 'resumen vacío');
        }
        if (fen) lastFen = fen;
        if (kind === 'say' && s.say == null) err(w, 'say vacío');
      }
    }
  }
  // diálogos
  for (const [k, v] of Object.entries(KAREN_LINES)) {
    if (!Array.isArray(v) || !v.length) err('diálogos', k + ' vacío');
    for (const t of v) { const txt = typeof t === 'string' ? t : t.text; if (txt.length > 190) warn('diálogos', k + ' tiene una frase de ' + txt.length + ' letras'); }
  }
  // textos largos en lecciones (el globo debe salir en < 3 s)
  for (const b of SCHOOL.blocks) for (const L of b.lessons) for (const s of L.steps) for (const t of [].concat(s.say || [], s.quiz || [])) if (typeof t === 'string' && t.length > 210) warn(b.id + '/' + L.id, 'globo de ' + t.length + ' letras: ' + t.slice(0, 40) + '…');
  if (eng) eng.quit();
  console.log('\n' + SCHOOL.blocks.length + ' bloques, ' + nLessons + ' lecciones, ' + nSteps + ' pasos, ' + Object.values(KAREN_LINES).reduce((a, v) => a + v.length, 0) + ' frases de Karen.');
  console.log(errors + ' errores, ' + warns + ' avisos.');
  process.exit(errors ? 1 : 0);
}
const fmt = cp => Math.abs(cp) > 50000 ? (cp > 0 ? '+M' : '-M') : (cp > 0 ? '+' : '') + (cp / 100).toFixed(2);

// recoger estrellas: solo mueven las blancas; devuelve el mínimo de jugadas o -1
function solveStars(fen, goal, eat, maxDepth) {
  const base = new Chess(fen);
  const blackCount = b => b.board().flat().filter(p => p && p.color === 'b').length;
  const keyOf = (g, left) => g.fen().split(' ')[0] + '|' + left.join(',');
  let frontier = [{ fen, left: goal.slice().sort() }], seen = new Set([keyOf(base, goal.slice().sort())]);
  for (let d = 0; d <= maxDepth; d++) {
    const next = [];
    for (const st of frontier) {
      const g = new Chess(st.fen);
      if (eat ? blackCount(g) === 0 : st.left.length === 0) return d;
      for (const m of g.moves({ verbose: true })) {
        const h = new Chess(st.fen); h.move(m);
        const parts = h.fen().split(' '); parts[1] = 'w'; parts[3] = '-';
        const nf = parts.join(' ');
        const left = st.left.filter(s => s !== m.to);
        const k = nf.split(' ')[0] + '|' + left.join(',');
        if (seen.has(k)) continue; seen.add(k); next.push({ fen: nf, left });
      }
    }
    frontier = next; if (!frontier.length) break;
  }
  return -1;
}

// nombre de apertura según el libro (para revisar que la línea sea la que decimos)
let BOOK = null;
function hash(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }
async function openingName(fens, w) {
  if (!BOOK) BOOK = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/openings.json'), 'utf8'));
  let name = null, last = -1, inBook = 0;
  const keys = new Set(BOOK.keys.match(/.{7}/g));
  for (let i = 1; i < fens.length; i++) {
    const k = hash(fens[i].split(' ').slice(0, 3).join(' '));
    if (BOOK.names[k]) { name = BOOK.names[k]; last = i; }
    if (keys.has(k.padStart(7, '0'))) inBook = i;
  }
  console.log('    apertura: ' + (name || '¿?') + ' (nombre hasta la jugada ' + last + ', teoría hasta ' + inBook + ' de ' + (fens.length - 1) + ')');
  if (!name) warn(w, 'la línea no tiene nombre en el libro');
}

main().catch(e => { console.error(e); process.exit(1); });
