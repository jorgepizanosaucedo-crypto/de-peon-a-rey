'use strict';
/* De Peón a Rey — entrenador táctico gratuito.
   Todo corre en el navegador: puzzles incluidos en la página, Stockfish en un Web Worker,
   progreso guardado en localStorage. */

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
// La app no funciona dentro de un iframe de otro sitio (evita que la "tapen" para engañar clics).
const FRAMED = (() => { try { return window.top !== window.self && window.top.location.origin !== window.location.origin; } catch (e) { return true; } })();
if (FRAMED) {
  document.documentElement.classList.add('framed');
  document.body.append(h('div', { class: 'framed-msg' }, h('p', null, 'Por seguridad, De Peón a Rey solo funciona en su propia pestaña.'),
    h('a', { class: 'btn primary', href: location.href, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir en una pestaña nueva')));
}
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}
function icon(id, cls) {
  const s = svgEl('svg', { 'aria-hidden': 'true' });
  if (cls) s.setAttribute('class', cls);
  s.append(svgEl('use', { href: '#' + id }));
  return s;
}
function pieceSvg(code) {
  const s = svgEl('svg', { viewBox: '0 0 40 40', class: 'pc', fill: 'none', 'fill-rule': 'evenodd', stroke: 'none' });
  s.append(svgEl('use', { href: '#' + code }));
  return s;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const todayStr = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function hash(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const uciObj = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
function sanOf(fen, uci) { try { const g = new Chess(fen); const m = g.move(uciObj(uci)); return m ? m.san : uci; } catch (e) { return uci; } }
const SAN_ES = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };
const es = san => san ? san.replace(/[KQRBN]/g, c => SAN_ES[c]) : san; // notación en español
const colorName = c => c === 'w' ? 'blancas' : 'negras';

function parseFen(fen) {
  const map = {}; const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map['abcdefgh'[f] + (8 - r)] = color + ch.toLowerCase();
      f++;
    }
  }
  return map;
}
function checkSquare(fen) {
  const g = new Chess(fen);
  if (!g.in_check()) return null;
  const k = g.turn() + 'k'; const map = parseFen(fen);
  return Object.keys(map).find(s => map[s] === k) || null;
}
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function balanceFor(fen, color) {
  const map = parseFen(fen); let s = 0;
  for (const p of Object.values(map)) s += (p[0] === color ? 1 : -1) * VAL[p[1]];
  return s;
}
function nonPawnMaterial(fen) {
  return Object.values(parseFen(fen)).reduce((s, p) => s + (p[1] !== 'p' && p[1] !== 'k' ? VAL[p[1]] : 0), 0);
}

// ---------------------------------------------------------------- estado
const KEY = 'peonarey.v1';
const MAX_LIVES = 5, LIFE_MS = 20 * 60 * 1000;
// Rangos: la pieza asciende con el rating táctico. El rango alcanzado nunca baja.
// Cada rango pide rating Y mundos completados; Rey además pide todos los niveles con 3 estrellas.
const RANKS = [
  { p: 'p', name: 'Peón', sym: '♟', min: 0, worlds: 0 },
  { p: 'n', name: 'Caballo', sym: '♞', min: 900, worlds: 2 },
  { p: 'b', name: 'Alfil', sym: '♝', min: 1050, worlds: 3 },
  { p: 'r', name: 'Torre', sym: '♜', min: 1200, worlds: 5 },
  { p: 'q', name: 'Dama', sym: '♛', min: 1350, worlds: 'all' },
  { p: 'k', name: 'Rey', sym: '♚', min: 1500, worlds: 'all', perfect: true },
];
function rankIndex(r) { let k = 0; RANKS.forEach((x, i) => { if (r >= x.min) k = i; }); return k; }
function defaultState() {
  return { v: 1, lives: MAX_LIVES, livesTs: Date.now(), levels: {}, rating: 800, ratingN: 0, ratingHist: [],
    themeStats: {}, review: [], mine: [], games: [], streak: { last: null, days: 0 }, solved: 0,
    settings: { platform: 'chesscom', user: '', depth: 16 }, lessonsOpen: {}, savedAt: 0, rankMax: 0, daily: {},
    school: { done: {}, needBasics: false, skip: false, titles: [] } };
}
function normalizeState(d) {
  const base = defaultState();
  const st = Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) });
  if (![12, 16, 18].includes(st.settings.depth)) st.settings.depth = 16;
  st.games = (st.games || []).filter(g => g.v === 2);
  st.daily = st.daily || {};
  // Escuela: lecciones terminadas (con sus estrellas), si empezó desde cero y los títulos ya celebrados
  const sc = st.school && typeof st.school === 'object' ? st.school : {};
  const done = {};
  if (sc.done && typeof sc.done === 'object') for (const [k, v] of Object.entries(sc.done)) if (/^[a-z0-9-]{1,40}$/.test(k) && v >= 1) done[k] = Math.min(3, Math.round(v));
  st.school = { done, needBasics: !!sc.needBasics, skip: !!sc.skip, titles: Array.isArray(sc.titles) ? sc.titles.filter(t => typeof t === 'string').slice(0, 40) : [], last: typeof sc.last === 'string' ? sc.last : null };
  return st;
}
// JSON.parse que descarta claves peligrosas (__proto__, constructor, prototype) de datos guardados
const safeParse = txt => JSON.parse(txt, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v));
let S = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeState(safeParse(raw));
  } catch (e) { /* almacenamiento no disponible */ }
  return defaultState();
}
function localSave() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* sin almacenamiento local */ } }
function save() { S.savedAt = Date.now(); localSave(); scheduleCloud(); }

// Sincronización con la nube (solo con cuentas activadas). Sin cuenta basta con localStorage.
let cloud = null, cloudTimer = null;
function scheduleCloud() { if (!cloud) return; clearTimeout(cloudTimer); cloudTimer = setTimeout(cloudSave, 1200); }
async function cloudSave() {
  if (!cloud) return;
  if (cloud.busy) { cloud.pending = true; return; }
  cloud.busy = true;
  try { await cloud.ref.set({ v: 1, savedAt: S.savedAt || Date.now(), state: JSON.stringify(S) }); }
  catch (e) {
    if (e && ['permission-denied', 'unauthenticated', 'invalid-argument', 'resource-exhausted'].includes(e.code)) {
      cloud = null; toast('No se pudo guardar en tu cuenta. Tu progreso sigue en este navegador.'); return;
    }
  }
  cloud.busy = false;
  if (cloud.pending) { cloud.pending = false; cloudSave(); }
}
window.addEventListener('pagehide', () => { if (cloud) { clearTimeout(cloudTimer); cloudSave(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && cloud) { clearTimeout(cloudTimer); cloudSave(); } });
function syncLives() {
  if (S.lives >= MAX_LIVES) { S.lives = MAX_LIVES; S.livesTs = Date.now(); return; }
  const n = Math.floor((Date.now() - S.livesTs) / LIFE_MS);
  if (n > 0) {
    S.lives = Math.min(MAX_LIVES, S.lives + n);
    S.livesTs = S.lives >= MAX_LIVES ? Date.now() : S.livesTs + n * LIFE_MS;
    save();
  }
}
let hurtAt = 0;
function loseLife() { syncLives(); if (S.lives >= MAX_LIVES) S.livesTs = Date.now(); S.lives = Math.max(0, S.lives - 1); hurtAt = Date.now(); save(); renderChips(); }
function nextLifeIn() { return Math.max(0, LIFE_MS - (Date.now() - S.livesTs)); }
function fmtMs(ms) { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function touchStreak() {
  const t = todayStr(); if (S.streak.last === t) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  S.streak.days = S.streak.last === todayStr(y) ? S.streak.days + 1 : 1;
  S.streak.last = t;
}
function streakDays() {
  if (!S.streak.last) return 0;
  const y = new Date(); y.setDate(y.getDate() - 1);
  return (S.streak.last === todayStr() || S.streak.last === todayStr(y)) ? S.streak.days : 0;
}

// ---------------------------------------------------------------- datos
const DATA = JSON.parse($('#puzzle-data').textContent);
const PUZ = {}; // id -> puzzle
const WORLD_PUZ = {};
for (const key of DATA.order) {
  WORLD_PUZ[key] = DATA.worlds[key].map(r => {
    let p;
    if (r[4] === 'defense') {
      const [last, threat] = r[2].split(' ');
      p = { id: r[0], fen: r[1], type: 'threat', last, threat, moves: [last], ok: r[5].split(' '), mate: !!r[6], rating: r[3], themes: ['defense'], world: key };
    } else p = { id: r[0], fen: r[1], moves: r[2].split(' '), rating: r[3], themes: r[4].split(' '), world: key };
    PUZ[p.id] = p; return p;
  });
}
const PIECE_ES = { p: 'peón', n: 'caballo', b: 'alfil', r: 'torre', q: 'dama', k: 'rey' };
const THEME_ES = { defense: 'Ver la amenaza', mateIn1: 'Mate en 1', mateIn2: 'Mate en 2', mateIn3: 'Mate en 3', hangingPiece: 'Pieza colgada', fork: 'Horquilla',
  pin: 'Clavada', skewer: 'Enfilada', discoveredAttack: 'Ataque descubierto', backRankMate: 'Mate del pasillo', promotion: 'Coronación', advantage: 'Ganar material' };
const WORLD_META = {
  mate1: { piece: 'k', name: 'Mate en 1', color: 'var(--w-mate1)', blurb: 'Encuentra el jaque que el rey ya no puede esquivar.',
    lesson: ['Revisa todos los jaques, incluso los que parecen absurdos o regalan una pieza.',
      'Hay mate cuando el rey está en jaque, no tiene casillas libres y no puedes capturar ni tapar la pieza que da jaque.',
      'Los reyes encerrados por sus propios peones son el blanco favorito.'] },
  hanging: { piece: 'p', name: 'Piezas colgadas', color: 'var(--w-hanging)', blurb: 'Captura lo que el rival dejó sin defensa.',
    lesson: ['Una pieza cuelga cuando está atacada y nadie la defiende, o la defiende algo que vale más.',
      'Antes de cada jugada pregúntate: ¿qué atacó mi rival con su último movimiento?',
      'Y después: ¿qué dejo yo sin defensa con la jugada que voy a hacer?'] },
  defense: { piece: 'r', name: 'Defensa', color: 'var(--w-defense)', blurb: '¿Qué amenaza tu rival? Encuéntralo y defiéndete a tiempo.',
    lesson: ['Después de cada jugada de tu rival pregúntate: ¿qué quiere hacer ahora?',
      'Mira qué ataca la pieza que se movió, y también qué quedó destapado detrás de ella.',
      'Para defenderte: mueve la pieza atacada, defiéndela, tapa la línea o captura al atacante.'] },
  fork: { piece: 'n', name: 'Horquillas', color: 'var(--w-fork)', blurb: 'Una pieza ataca dos objetivos y el rival solo puede salvar uno.',
    lesson: ['El caballo es el rey de las horquillas: busca casillas desde donde toque rey y dama, o dos torres.',
      'Los jaques son la mejor horquilla: el rival está obligado a atender al rey.',
      'Peones y damas también hacen horquillas. Busca piezas sin defensa alineadas.'] },
  mate2: { piece: 'q', name: 'Mate en 2', color: 'var(--w-mate2)', blurb: 'Fuerza primero, remata después.',
    lesson: ['Empieza por las jugadas forzadas: jaques, capturas y amenazas de mate.',
      'Si el primer jaque no es mate, mira qué casillas le quedan al rey y cómo quitárselas.',
      'A veces hay que sacrificar material para abrir el camino.'] },
  pin: { piece: 'b', name: 'Clavadas y enfiladas', color: 'var(--w-pin)', blurb: 'Ataca en línea: lo de adelante no puede moverse sin perder lo de atrás.',
    lesson: ['Clavada: la pieza atacada no puede moverse porque detrás está el rey o algo más valioso.',
      'Enfilada: atacas una pieza valiosa y, al apartarse, queda expuesta la que estaba detrás.',
      'La señal: rey y dama en la misma línea, diagonal o columna que tus alfiles, torres o dama.'] },
  discovered: { piece: 'r', name: 'Ataques descubiertos', color: 'var(--w-discovered)', blurb: 'Mueve una pieza y destapa el ataque de la que estaba detrás.',
    lesson: ['Si la pieza que mueves también amenaza algo, el rival no puede atender las dos cosas.',
      'El jaque descubierto es el más fuerte: la pieza que se mueve puede ir a donde quiera.',
      'Busca tus alfiles, torres y dama tapados por una pieza propia.'] },
  mix: { piece: 'k', name: 'Táctica mixta', color: 'var(--w-mix)', blurb: 'Ya no te decimos el tema. Como en una partida real.',
    lesson: ['Haz el chequeo completo en orden: jaques, capturas y amenazas.',
      'Calcula la respuesta del rival antes de jugar. La mejor jugada suele ser forzante.',
      'Si nada funciona, busca qué pieza del rival está sin defensa.'] },
};
const MAX_LEVELS = 12, POOL_MIN = 10;
const LEVEL_CACHE = {};
// Cada nivel es un banco de puzzles de dificultad parecida; cada intento toma 5 que no hayas visto.
function levelsOf(key) {
  if (LEVEL_CACHE[key]) return LEVEL_CACHE[key];
  const list = WORLD_PUZ[key] || [];
  let L = Math.min(MAX_LEVELS, Math.floor(list.length / POOL_MIN));
  if (!L && list.length >= 5) L = 1;
  const out = [];
  for (let i = 0; i < L; i++) out.push(list.slice(Math.floor(i * list.length / L), Math.floor((i + 1) * list.length / L)));
  return (LEVEL_CACHE[key] = out);
}
function pickPuzzles(pool, k = 5) {
  const seen = S.seen || {};
  const order = shuffle(pool).sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0));
  return order.slice(0, Math.min(k, order.length)).sort((a, b) => a.rating - b.rating);
}
function markSeen(p) {
  if (!p || p.personal) return;
  S.seen = S.seen || {}; S.seenN = (S.seenN || 0) + 1;
  st.seenBefore = !!S.seen[p.id];
  S.seen[p.id] = S.seenN;
}
const WORLDS = DATA.order.filter(k => levelsOf(k).length > 0);
function worldState() {
  // devuelve estado de cada mundo y el nivel actual
  let prevDone = !schoolGated(); const res = [];
  const hasProgress = k => !schoolGated() && levelsOf(k).some((_, i) => S.levels[k + '-' + i]);
  WORLDS.forEach((key, wi) => {
    const lv = levelsOf(key);
    const stars = lv.map((_, i) => S.levels[key + '-' + i] || 0);
    const unlocked = prevDone || WORLDS.slice(wi).some(hasProgress);
    const done = stars.every(s => s > 0);
    let current = -1;
    if (unlocked && !done) current = stars.findIndex(s => s === 0);
    res.push({ key, lv, stars, unlocked, done, current });
    prevDone = unlocked && done;
  });
  return res;
}
function totalStars() { return Object.values(S.levels).reduce((a, b) => a + b, 0); }

// ---------------------------------------------------------------- tablero
class Board {
  constructor(host) {
    this.orient = 'w'; this.fen = '8/8/8/8/8/8/8/8 w - - 0 1'; this.interactive = false; this.sel = null; this.targets = []; this.onMove = null;
    this.wrap = h('div', { class: 'board-wrap' });
    this.el = h('div', { class: 'board', role: 'img', 'aria-label': 'Tablero de ajedrez' });
    this.svg = svgEl('svg', { class: 'arrows', viewBox: '0 0 8 8', 'aria-hidden': 'true' });
    this.wrap.append(this.el, this.svg); host.append(this.wrap);
    this.build();
    this.el.addEventListener('pointerdown', e => this.down(e));
  }
  build() {
    this.el.textContent = ''; this.sqs = {};
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const file = this.orient === 'w' ? c : 7 - c, rank = this.orient === 'w' ? 7 - r : r;
      const name = 'abcdefgh'[file] + (rank + 1);
      const d = h('div', { class: 'sq' + ((file + rank) % 2 === 0 ? ' dk' : ''), 'data-sq': name });
      if (r === 7) d.append(h('span', { class: 'coord f' }, 'abcdefgh'[file]));
      if (c === 0) d.append(h('span', { class: 'coord r' }, String(rank + 1)));
      this.el.append(d); this.sqs[name] = d;
    }
  }
  setPick(fn) { this.pickMode = fn || null; this.el.classList.toggle('picking', !!fn); }
  setInteractive(on) { this.interactive = on; this.el.classList.toggle('interactive', on); if (!on) this.deselect(); }
  flip(color) { if (color === this.orient) return; this.orient = color; this.build(); this.setPosition(this.fen, { last: this.last }); }
  setPosition(fen, { last = null, animate = null } = {}) {
    const prev = parseFen(this.fen);
    this.fen = fen; this.last = last; const map = parseFen(fen);
    // jugada hacia adelante con captura: la pieza capturada se desvanece debajo de la que llega
    let capSq = null;
    if (last && !reduceMotion) {
      const [f, t] = last;
      if (prev[f] && map[t] && !map[f] && prev[f][0] === map[t][0] && prev[t] && prev[t][0] !== map[t][0]) capSq = t;
    }
    for (const [sq, d] of Object.entries(this.sqs)) {
      for (const old of d.querySelectorAll('.pc')) {
        if (sq === capSq && !old.classList.contains('cap-out')) { old.classList.add('cap-out'); setTimeout(() => old.remove(), 340); }
        else old.remove();
      }
      if (map[sq]) d.append(pieceSvg(map[sq]));
    }
    this.clearMarks(['last', 'check', 'sel', 'dot', 'cap', 'good', 'bad', 'hint']);
    for (const b of this.el.querySelectorAll('.sqb')) b.remove();
    this.sel = null; this.targets = [];
    if (last) { this.mark(last[0], 'last'); this.mark(last[1], 'last'); }
    const chk = checkSquare(fen); if (chk) this.mark(chk, 'check');
    if (animate && !reduceMotion) this.animate(animate[0], animate[1]);
    this.arrows([]);
  }
  animate(from, to) {
    const pc = this.sqs[to] && this.sqs[to].querySelector('.pc:not(.cap-out)'); if (!pc) return;
    const a = this.sqs[from].getBoundingClientRect(), b = this.sqs[to].getBoundingClientRect();
    pc.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
    pc.getBoundingClientRect();
    pc.classList.add('anim'); pc.style.transform = '';
    setTimeout(() => pc.classList.remove('anim'), 260);
  }
  mark(sq, cls) { if (this.sqs[sq]) this.sqs[sq].classList.add(cls); }
  badge(sq, text, color) { if (!this.sqs[sq] || !text) return; this.sqs[sq].append(h('span', { class: 'sqb', style: { background: color }, 'aria-hidden': 'true' }, text)); }
  clearMarks(list) { for (const d of Object.values(this.sqs)) d.classList.remove(...list); }
  shake() { this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake'); }
  down(e) {
    if (this.pickMode) { const sqEl = e.target.closest('.sq'); if (sqEl) { e.preventDefault(); this.pickMode(sqEl.dataset.sq); } return; }
    if (!this.interactive) return;
    const sqEl = e.target.closest('.sq'); if (!sqEl) return;
    const sq = sqEl.dataset.sq; const map = parseFen(this.fen); const p = map[sq]; const turn = this.fen.split(' ')[1];
    if (this.sel && this.targets.includes(sq)) { e.preventDefault(); this.tryMove(this.sel, sq); return; }
    if (p && p[0] === turn) { e.preventDefault(); this.select(sq); this.startDrag(e, sq); }
    else this.deselect();
  }
  select(sq) {
    this.deselect(); this.sel = sq; this.mark(sq, 'sel');
    const g = new Chess(this.fen);
    this.targets = [...new Set(g.moves({ square: sq, verbose: true }).map(m => m.to))];
    const map = parseFen(this.fen);
    for (const t of this.targets) this.mark(t, map[t] ? 'cap' : 'dot');
  }
  deselect() { this.sel = null; this.targets = []; this.clearMarks(['sel', 'dot', 'cap']); }
  startDrag(e, sq) {
    const pc = this.sqs[sq].querySelector('.pc:not(.cap-out)'); if (!pc) return;
    const size = this.sqs[sq].getBoundingClientRect().width;
    const sx = e.clientX, sy = e.clientY; let dragging = false, ghost = null;
    const move = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        dragging = true; ghost = pc.cloneNode(true); ghost.classList.add('drag');
        Object.assign(ghost.style, { width: size + 'px', height: size + 'px', inset: 'auto' });
        document.body.append(ghost); pc.style.opacity = '.25';
      }
      if (dragging) { ghost.style.left = (ev.clientX - size / 2) + 'px'; ghost.style.top = (ev.clientY - size / 2) + 'px'; }
    };
    const up = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!dragging) return;
      ghost.remove(); pc.style.opacity = '';
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const t = el && el.closest ? el.closest('.sq') : null;
      if (t && this.el.contains(t) && t.dataset.sq !== sq && this.targets.includes(t.dataset.sq)) this.tryMove(sq, t.dataset.sq, true);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  async tryMove(from, to, dragged) {
    const g = new Chess(this.fen); const p = g.get(from); let promo = null;
    if (p && p.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promo = await this.askPromotion(p.color);
      if (!promo) { this.deselect(); return; }
    }
    this.deselect();
    if (this.onMove) this.onMove(from, to, promo, dragged);
  }
  askPromotion(color) {
    return new Promise(res => {
      const box = h('div', { class: 'promo-box' });
      const ov = h('div', { class: 'promo', onclick: e => { if (e.target === ov) { ov.remove(); res(null); } } }, box);
      for (const t of ['q', 'r', 'b', 'n']) {
        const b = h('button', { 'aria-label': { q: 'Dama', r: 'Torre', b: 'Alfil', n: 'Caballo' }[t], onclick: () => { ov.remove(); res(t); } });
        const s = pieceSvg(color + t); s.style.position = 'static'; b.append(s); box.append(b);
      }
      this.wrap.append(ov);
    });
  }
  center(sq) {
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
    return this.orient === 'w' ? [f + .5, 7 - r + .5] : [7 - f + .5, r + .5];
  }
  arrows(list) {
    this.svg.textContent = '';
    for (const a of list) {
      const [x1, y1] = this.center(a.from), [x2, y2] = this.center(a.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const hl = .42, hw = .26, ex = x2 - ux * .18, ey = y2 - uy * .18, bx = ex - ux * hl, by = ey - uy * hl;
      const g = svgEl('g', { opacity: '.85' });
      g.append(svgEl('line', { x1: x1 + ux * .1, y1: y1 + uy * .1, x2: bx, y2: by, stroke: a.color, 'stroke-width': '.17', 'stroke-linecap': 'round' }));
      g.append(svgEl('polygon', { points: `${ex},${ey} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`, fill: a.color }));
      this.svg.append(g);
    }
  }
}

// ---------------------------------------------------------------- motor
class Engine {
  constructor() { this.w = null; this.ready = null; this.queue = Promise.resolve(); this.listeners = []; this.name = ''; }
  init() {
    if (!this.ready) {
      this.ready = this._start('engine/stockfish-17.1-lite-single-03e3232.js', 'Stockfish 17.1')
        .catch(() => this._start('engine/stockfish-10-asm.js', 'Stockfish 10'));
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }
  _start(url, name) {
    return new Promise((res, rej) => {
      let w;
      try { w = new Worker(url); } catch (e) { rej(e); return; }
      const t = setTimeout(() => { w.terminate(); rej(new Error('timeout')); }, 20000);
      w.onmessage = e => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line === 'uciok') {
          clearTimeout(t); this.w = w; this.name = name;
          w.onmessage = ev => { const l = typeof ev.data === 'string' ? ev.data : ''; for (const fn of this.listeners.slice()) fn(l); };
          w.postMessage('setoption name Hash value 32'); w.postMessage('ucinewgame'); w.postMessage('isready');
          res(this);
        }
      };
      w.onerror = err => { clearTimeout(t); try { w.terminate(); } catch (e) { /* ya cerrado */ } rej(err); };
      w.postMessage('uci');
    });
  }
  analyze(fen, depth, multipv = 1) {
    const run = () => this._analyze(fen, depth, multipv);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  _analyze(fen, depth, multipv) {
    // posiciones terminales: sin motor
    const g = new Chess(fen);
    if (g.game_over()) {
      const white = g.turn() === 'w';
      const cp = g.in_checkmate() ? (white ? -10000 : 10000) : 0;
      return Promise.resolve({ cp, mate: g.in_checkmate() ? 0 : null, best: null, pv: [], cp2: null, lines: [] });
    }
    return new Promise(res => {
      const turnW = fen.split(' ')[1] === 'w'; const lines = {};
      const fn = line => {
        if (line.startsWith('info') && line.includes(' score ') && line.includes(' pv ') && !/ (lower|upper)bound/.test(line)) {
          const k = +((line.match(/ multipv (\d+)/) || [0, 1])[1]);
          const m = line.match(/score (cp|mate) (-?\d+)/); const pv = line.split(' pv ')[1].trim().split(/\s+/);
          if (m) {
            const v = +m[2];
            if (m[1] === 'cp') lines[k] = { cp: turnW ? v : -v, mate: null, pv };
            else { const mate = turnW ? v : -v; lines[k] = { cp: mate > 0 ? 10000 - Math.abs(mate) * 10 : -10000 + Math.abs(mate) * 10, mate, pv }; }
          }
        } else if (line.startsWith('bestmove')) {
          this.listeners = this.listeners.filter(x => x !== fn);
          const best = line.split(/\s+/)[1]; const l1 = lines[1] || { cp: 0, mate: null, pv: [] };
          // lines: todas las variantes pedidas (MultiPV), en orden y con el puntaje desde las blancas
          res({ cp: l1.cp, mate: l1.mate, best: best && best !== '(none)' ? best : (l1.pv[0] || null), pv: l1.pv, cp2: lines[2] ? lines[2].cp : null,
            lines: Object.keys(lines).map(Number).sort((a, b) => a - b).map(k => lines[k]) });
        }
      };
      this.listeners.push(fn);
      this.w.postMessage('setoption name MultiPV value ' + multipv);
      this.w.postMessage('position fen ' + fen);
      this.w.postMessage('go depth ' + depth);
    });
  }
}
const engine = new Engine();
const APP_VERSION = '2.3';

// ---------------------------------------------------------------- sonido y celebraciones
// Sonidos sintetizados con Web Audio: no hay archivos que descargar y funcionan sin conexión.
const Sound = {
  ctx: null, noise: null,
  on() { return S.settings.sound !== false; },
  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        this.ctx = new AC();
        const len = Math.floor(this.ctx.sampleRate * 0.08), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
        this.noise = buf;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) { return null; }
  },
  click(t, freq, gain) { // golpe de pieza sobre madera
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.3;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(bp); bp.connect(g); g.connect(c.destination); src.start(t); src.stop(t + 0.08);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq / 8, t); o.frequency.exponentialRampToValueAtTime(freq / 13, t + 0.06);
    const g2 = c.createGain(); g2.gain.setValueAtTime(gain * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g2); g2.connect(c.destination); o.start(t); o.stop(t + 0.09);
  },
  tone(t, freq, dur, gain, type, endFreq) {
    const c = this.ctx; const o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t); if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  play(kind, delay = 0, n = 0) {
    if (!this.on()) return; const c = this.ensure(); if (!c) return;
    const t = c.currentTime + 0.01 + delay;
    try {
      switch (kind) {
        case 'move': this.click(t, 1500, 0.55); break;
        case 'capture': this.click(t, 1150, 0.75); this.click(t + 0.045, 850, 0.5); break;
        case 'castle': this.click(t, 1500, 0.5); this.click(t + 0.11, 1300, 0.45); break;
        case 'check': this.click(t, 1500, 0.55); this.tone(t + 0.02, 1320, 0.18, 0.07, 'triangle', 990); break;
        case 'promote': this.click(t, 1500, 0.55); this.tone(t + 0.03, 880, 0.12, 0.07, 'triangle'); this.tone(t + 0.11, 1320, 0.16, 0.07, 'triangle'); break;
        case 'correct': this.tone(t, 784, 0.16, 0.11, 'triangle'); this.tone(t + 0.09, 1175, 0.3, 0.11, 'triangle'); break;
        case 'wrong': this.tone(t, 196, 0.24, 0.13, 'triangle', 140); this.tone(t, 98, 0.24, 0.08, 'sine'); break;
        case 'hint': this.tone(t, 1047, 0.22, 0.05, 'sine'); break;
        case 'star': this.tone(t, [988, 1319, 1760][n] || 1760, 0.32, 0.09, 'triangle'); this.tone(t, ([988, 1319, 1760][n] || 1760) * 2, 0.2, 0.025, 'sine'); break;
        case 'lose': this.tone(t, 392, 0.22, 0.08, 'triangle'); this.tone(t + 0.17, 294, 0.4, 0.08, 'triangle'); break;
        case 'done': this.tone(t, 659, 0.14, 0.07, 'triangle'); this.tone(t + 0.08, 988, 0.24, 0.07, 'triangle'); break;
        case 'brilliant': [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(t + i * 0.055, f, 0.26, 0.06, 'sine')); break;
        case 'voice': { // vocecita de la mascota: un pulso cuadrado cortito por letra
          const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
          o.type = 'square'; o.frequency.value = 560 * (0.95 + Math.random() * 0.1);
          f.type = 'lowpass'; f.frequency.value = 2400;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.024, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.034);
          o.connect(f); f.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.05); break;
        }
        case 'pop': this.tone(t, 520, 0.12, 0.05, 'sine', 990); break;
      }
    } catch (e) { /* audio no disponible */ }
  },
};

// ---------------------------------------------------------------- música de fondo
// Bossa tranquila tipo "elevador" generada con Web Audio: piano eléctrico, vibráfono, bajo y escobillas.
// Solo suena en los menús, baja hasta apagarse en los puzzles y arranca con el primer toque (regla de los navegadores).
const SONG = (() => {
  // acordes por compás: voces del piano (sin fundamental) y bajo
  const A = [
    { v: [52, 55, 59, 62], b: 36 }, // Cmaj9
    { v: [55, 59, 60, 64], b: 45 }, // Am9
    { v: [53, 57, 60, 64], b: 38 }, // Dm9
    { v: [53, 57, 59, 64], b: 43 }, // G13
    { v: [55, 59, 62, 66], b: 40 }, // Em9
    { v: [55, 59, 61, 64], b: 45 }, // A9
    { v: [53, 57, 60, 64], b: 38 }, // Dm9
    { v: [53, 57, 60, 62], b: 43 }, // G9sus
  ];
  const B = [
    { v: [52, 55, 57, 60], b: 41 }, // Fmaj9
    { v: [51, 55, 56, 60], b: 41 }, // Fm9
    { v: [55, 59, 62, 64], b: 40 }, // Em7
    { v: [55, 58, 61, 64], b: 45 }, // A7b9
    { v: [53, 57, 60, 64], b: 38 }, // Dm9
    { v: [53, 57, 59, 64], b: 43 }, // G13
    { v: [52, 55, 59, 62], b: 36 }, // Cmaj9
    { v: [53, 57, 60, 62], b: 43 }, // G9sus
  ];
  // melodía (vibráfono): [paso de semicorchea, nota MIDI, duración en pasos]
  const mA = [
    [[0, 76, 6], [6, 74, 2], [8, 76, 4], [12, 79, 4]],
    [[0, 81, 6], [6, 79, 2], [8, 76, 8]],
    [[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
    [[0, 71, 6], [6, 72, 2], [8, 74, 8]],
    [[0, 79, 6], [6, 76, 2], [8, 74, 4], [12, 71, 4]],
    [[0, 73, 6], [6, 76, 2], [8, 79, 8]],
    [[0, 77, 4], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 76, 4]],
    [[0, 74, 10], [12, 74, 2], [14, 74, 2]],
  ];
  const mB = [
    [[0, 81, 6], [6, 79, 2], [8, 76, 8]],
    [[0, 80, 6], [6, 79, 2], [8, 75, 8]],
    [[0, 79, 4], [4, 76, 4], [8, 74, 4], [12, 71, 4]],
    [[0, 73, 6], [6, 76, 2], [8, 79, 6], [14, 77, 2]],
    [[0, 76, 6], [6, 77, 2], [8, 81, 8]],
    [[0, 79, 4], [4, 77, 2], [6, 76, 2], [8, 74, 8]],
    [[0, 76, 12]],
    [[8, 72, 4], [12, 74, 4]],
  ];
  // forma: intro sin melodía, A, B, A (32 compases, ~1.5 min)
  return { form: [[A, null], [A, mA], [B, mB], [A, mA]], bars: 32 };
})();
// Lo-fi para estudiar en la Escuela: Rhodes, bajo redondo, batería suave con swing, kalimba y crujido de vinilo.
// Progresión en Do: Fmaj9, Em9, Dm9, Cmaj9 / Sibmaj9, Am9, Gm9, C9sus.
const LOFI = (() => {
  const C = [
    { v: [57, 60, 64, 67], b: 41 }, // Fmaj9
    { v: [55, 59, 62, 66], b: 40 }, // Em9
    { v: [53, 57, 60, 64], b: 38 }, // Dm9
    { v: [52, 55, 59, 62], b: 36 }, // Cmaj9
    { v: [57, 60, 62, 65], b: 46 }, // Sibmaj9
    { v: [55, 59, 60, 64], b: 45 }, // Am9
    { v: [53, 57, 58, 62], b: 43 }, // Gm9
    { v: [53, 58, 62, 67], b: 36 }, // C9sus
  ];
  const m1 = [
    [[0, 76, 4], [4, 79, 2], [6, 81, 4], [12, 79, 4]],
    [[2, 76, 2], [4, 74, 4], [10, 72, 6]],
    [[0, 74, 4], [6, 76, 2], [8, 81, 4], [14, 79, 2]],
    [[0, 76, 8], [12, 72, 4]],
    [[0, 74, 2], [2, 77, 2], [4, 81, 4], [10, 79, 2], [12, 77, 4]],
    [[0, 76, 4], [6, 72, 2], [8, 74, 6]],
    [[2, 74, 2], [4, 77, 2], [6, 74, 2], [8, 70, 6]],
    [[0, 72, 4], [8, 74, 2], [10, 77, 2], [12, 79, 4]],
  ];
  const m2 = [
    [[0, 84, 4], [6, 81, 2], [8, 79, 4], [12, 76, 4]],
    [[0, 79, 6], [8, 76, 4], [12, 74, 4]],
    [[0, 77, 2], [2, 76, 2], [4, 74, 4], [8, 72, 8]],
    [[4, 79, 2], [6, 81, 2], [8, 84, 8]],
    [[0, 86, 4], [6, 84, 2], [8, 81, 4], [12, 77, 4]],
    [[0, 79, 8], [10, 76, 6]],
    [[0, 77, 4], [4, 74, 4], [8, 70, 4], [12, 74, 4]],
    [[0, 72, 12]],
  ];
  return { form: [[C, null], [C, m1], [C, m2], [C, m1]], bars: 32 };
})();
const Music = {
  vol: 0.4, playing: false, gesture: false, view: 'map', timer: null, stopT: null, swapT: null, step: 0, nextT: 0, bus: null, song: 'bossa', vinyl: null,
  get bpm() { return this.song === 'lofi' ? 72 : 84; },
  level() { return this.vol * (this.song === 'lofi' ? 1.2 : 1); }, // las dos canciones suenan igual de fuerte
  enabled() { return S.settings.music !== false; },
  songFor(view) { return view === 'school' || view === 'lesson' ? 'lofi' : 'bossa'; },
  wanted() { return this.enabled() && this.gesture && !document.hidden && this.view !== 'play'; },
  update() {
    const w = this.wanted();
    if (w && !this.playing) this.start();
    else if (!w && this.playing) this.stop();
    else if (w && this.playing && this.songFor(this.view) !== (this.swapTo || this.song)) this.swap();
  },
  midi: n => 440 * Math.pow(2, (n - 69) / 12),
  build(c) {
    const master = c.createGain(); master.gain.value = 0;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5200;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(tone); tone.connect(comp); comp.connect(c.destination);
    const len = Math.floor(c.sampleRate * 2.4), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const rev = c.createConvolver(); rev.buffer = ir; const wet = c.createGain(); wet.gain.value = 0.32; rev.connect(wet); wet.connect(master);
    const trem = (rate, depth) => {
      const g = c.createGain(); g.gain.value = 1 - depth;
      const l = c.createOscillator(); l.frequency.value = rate; const lg = c.createGain(); lg.gain.value = depth;
      l.connect(lg); lg.connect(g.gain); l.start(); return g;
    };
    const ep = trem(4.2, 0.16), vib = trem(5.4, 0.28), pad = c.createGain(), bass = c.createGain(), perc = c.createGain(), kal = c.createGain(), vin = c.createGain();
    for (const g of [ep, vib, pad, kal]) { g.connect(master); g.connect(rev); }
    bass.connect(master); perc.connect(master); vin.connect(master); vin.gain.value = 0;
    const pr = c.createGain(); pr.gain.value = 0.25; perc.connect(pr); pr.connect(rev);
    this.bus = { master, tone, ep, vib, pad, bass, perc, kal, vin };
  },
  ep(c, t, n, dur, vel) { // piano eléctrico (FM)
    const f = this.midi(n), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), a = c.createGain();
    car.frequency.value = f; mod.frequency.value = f;
    if (this.song === 'lofi') car.detune.value = (Math.random() - 0.5) * 14; // cinta un poco desafinada
    mg.gain.setValueAtTime(f * 1.3, t); mg.gain.exponentialRampToValueAtTime(f * 0.1, t + 0.8);
    mod.connect(mg); mg.connect(car.frequency);
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(vel, t + 0.008);
    a.gain.exponentialRampToValueAtTime(vel * 0.4, t + 0.45); a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.45);
    car.connect(a); a.connect(this.bus.ep);
    const end = t + dur + 0.5; car.start(t); mod.start(t); car.stop(end); mod.stop(end);
  },
  vib(c, t, n, dur, vel) { // vibráfono
    const f = this.midi(n), o = c.createOscillator(), o2 = c.createOscillator(), a = c.createGain(), a2 = c.createGain();
    o.frequency.value = f; o2.frequency.value = f * 4;
    const rel = Math.max(1.1, dur * 1.3);
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(vel, t + 0.005); a.gain.exponentialRampToValueAtTime(0.0001, t + rel);
    a2.gain.setValueAtTime(0.0001, t); a2.gain.exponentialRampToValueAtTime(vel * 0.18, t + 0.004); a2.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(a); o2.connect(a2); a.connect(this.bus.vib); a2.connect(this.bus.vib);
    o.start(t); o2.start(t); o.stop(t + rel + 0.05); o2.stop(t + 0.3);
  },
  kalimba(c, t, n, vel) { // púa metálica: fundamental redonda y un parcial agudo que se apaga rápido
    const f = this.midi(n), o = c.createOscillator(), o2 = c.createOscillator(), a = c.createGain(), a2 = c.createGain();
    o.frequency.setValueAtTime(f * 1.012, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03); o2.frequency.value = f * 5.95;
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(vel, t + 0.004); a.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    a2.gain.setValueAtTime(0.0001, t); a2.gain.exponentialRampToValueAtTime(vel * 0.22, t + 0.002); a2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(a); o2.connect(a2); a.connect(this.bus.kal); a2.connect(this.bus.kal);
    o.start(t); o2.start(t); o.stop(t + 1.15); o2.stop(t + 0.12);
  },
  bass(c, t, n, dur, vel) {
    const f = this.midi(n), o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), a = c.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 650;
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(vel, t + 0.015);
    a.gain.exponentialRampToValueAtTime(vel * 0.55, t + dur * 0.8); a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(lp); o2.connect(lp); lp.connect(a); a.connect(this.bus.bass);
    o.start(t); o2.start(t); o.stop(t + dur + 0.12); o2.stop(t + dur + 0.12);
  },
  pad(c, t, notes, dur) { // colchón muy suave
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const a = c.createGain(); a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(0.018, t + 0.7); a.gain.setValueAtTime(0.018, t + dur - 0.3); a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    lp.connect(a); a.connect(this.bus.pad);
    for (const n of notes) for (const det of [-6, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.midi(n + 12); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 0.7); }
  },
  noiseHit(c, t, type, freq, q, dur, vel) {
    const src = c.createBufferSource(); src.buffer = Sound.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const a = c.createGain(); a.gain.setValueAtTime(vel, t); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(a); a.connect(this.bus.perc); src.start(t); src.stop(t + dur + 0.02);
  },
  kick(c, t, vel, lo = 48, hi = 95, dur = 0.25) {
    const o = c.createOscillator(), a = c.createGain();
    o.frequency.setValueAtTime(hi, t); o.frequency.exponentialRampToValueAtTime(lo, t + 0.12);
    a.gain.setValueAtTime(vel, t); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(this.bus.perc); o.start(t); o.stop(t + dur + 0.02);
  },
  playStep(c, k, t) { if (this.song === 'lofi') this.playLofi(c, k, t); else this.playBossa(c, k, t); },
  playBossa(c, k, t) {
    const sp = 60 / this.bpm / 4, bar = Math.floor(k / 16), s = k % 16;
    const [chords, mel] = SONG.form[Math.floor(bar / 8) % SONG.form.length], bi = bar % 8, ch = chords[bi];
    const r = () => 0.85 + Math.random() * 0.3, hum = () => Math.random() * 0.008;
    // bajo de bossa: fundamental y quinta
    const fifth = ch.b + 7 > 50 ? ch.b - 5 : ch.b + 7;
    if (s === 0 || s === 8) this.bass(c, t, ch.b, sp * 5.5, 0.1 * r());
    if (s === 6 || s === 14) this.bass(c, t, fifth, sp * 1.8, 0.075 * r());
    // piano: ritmo sincopado que cambia cada compás
    const comp = bar % 2 ? { 2: 3, 6: 3, 12: 4 } : { 0: 5, 6: 3, 10: 4 };
    if (comp[s]) { const d = comp[s] * sp, v = (s === 0 ? 0.06 : 0.045) * r(); ch.v.forEach((n, i) => this.ep(c, t + hum() + i * 0.004, n, d, v)); }
    if (s === 0) this.pad(c, t, ch.v.slice(1), sp * 16);
    // escobillas, aro y bombo suave
    if (s % 2 === 0) this.noiseHit(c, t + hum(), 'highpass', 7000, 0.7, 0.05, (s % 4 === 2 ? 0.07 : 0.035) * r());
    const rim = bar % 2 ? [2, 6, 10] : [0, 3, 6, 10, 13];
    if (rim.includes(s)) this.noiseHit(c, t + hum(), 'bandpass', 1900, 5, 0.035, 0.11 * r());
    if (s === 0 || s === 8) this.kick(c, t, 0.06);
    // melodía
    if (mel) for (const [ms, n, len] of mel[bi]) if (ms === s) this.vib(c, t + hum(), n, len * sp, 0.095 * r());
  },
  playLofi(c, k, t) {
    const sp = 60 / this.bpm / 4, bar = Math.floor(k / 16), s = k % 16;
    const [chords, mel] = LOFI.form[Math.floor(bar / 8) % LOFI.form.length], bi = bar % 8, ch = chords[bi];
    const r = () => 0.85 + Math.random() * 0.3, hum = () => Math.random() * 0.012;
    const tt = t + (s % 2 ? sp * 0.3 : 0); // swing: las semicorcheas de contratiempo llegan tarde
    // Rhodes: acorde largo, rasgueado, y un toque suave en el "y" del tres
    if (s === 0) ch.v.forEach((n, i) => this.ep(c, tt + i * 0.018 + hum(), n, sp * 13, 0.062 * r()));
    if (s === 10 && bar % 2) ch.v.slice(1).forEach((n, i) => this.ep(c, tt + i * 0.014, n, sp * 4, 0.038 * r()));
    if (s === 0 && bar % 4 === 0) this.pad(c, t, ch.v.slice(1), sp * 16);
    // bajo redondo
    if (s === 0) this.bass(c, tt, ch.b, sp * 6, 0.08 * r());
    if (s === 7) this.bass(c, tt, ch.b + 12 > 52 ? ch.b + 7 : ch.b + 12, sp * 2, 0.06 * r());
    if (s === 10) this.bass(c, tt, ch.b, sp * 4, 0.065 * r());
    // batería: bombo, tarola apagada y hi-hats con swing
    if (s === 0 || s === 10 || (s === 7 && bar % 4 === 3)) this.kick(c, tt, 0.05, 60, 125, 0.24);
    if (s === 4 || s === 12) { this.noiseHit(c, tt + hum(), 'bandpass', 1700, 0.8, 0.16, 0.12 * r()); this.kick(c, tt, 0.035, 160, 210, 0.08); }
    if (s % 2 === 0) this.noiseHit(c, tt + hum(), 'highpass', 6800, 0.8, 0.028, (s % 4 === 2 ? 0.05 : 0.028) * r());
    if (s === 14 && bar % 2) this.noiseHit(c, tt, 'highpass', 6000, 0.7, 0.14, 0.03);
    // kalimba
    if (mel) for (const [ms, n] of mel[bi]) if (ms === s) this.kalimba(c, tt + hum(), n, 0.1 * r());
  },
  // crujido de disco: siseo muy bajito con chasquidos sueltos, en bucle
  startVinyl(c) {
    if (this.vinyl || !this.bus) return;
    const len = Math.floor(c.sampleRate * 3), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.05;
    for (let k = 0; k < 26; k++) { const at = Math.floor(Math.random() * (len - 200)), amp = 0.3 + Math.random() * 0.7; for (let j = 0; j < 60; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.pow(1 - j / 60, 2); }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    src.connect(hp); hp.connect(this.bus.vin); src.start();
    this.vinyl = src;
  },
  stopVinyl() { if (this.vinyl) { try { this.vinyl.stop(); } catch (e) { /* ya parado */ } this.vinyl = null; } },
  setSong(c, song) {
    this.song = song; this.step = 0; this.nextT = c.currentTime + 0.08;
    const lofi = song === 'lofi', now = c.currentTime;
    this.bus.tone.frequency.setTargetAtTime(lofi ? 2400 : 5200, now, 0.05);
    this.bus.vin.gain.setTargetAtTime(lofi ? 0.09 : 0, now, 0.1);
    if (lofi) this.startVinyl(c); else this.stopVinyl();
  },
  tick() {
    const c = Sound.ctx; if (!c) return;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.35) {
      try { this.playStep(c, this.step, this.nextT); } catch (e) { /* nada */ }
      const form = this.song === 'lofi' ? LOFI : SONG;
      this.nextT += 60 / this.bpm / 4; this.step = (this.step + 1) % (form.bars * 16);
    }
  },
  start() {
    const c = Sound.ensure(); if (!c) return;
    if (!this.bus) this.build(c);
    clearTimeout(this.stopT); clearTimeout(this.swapT); this.swapTo = null;
    const want = this.songFor(this.view);
    if (want !== this.song) this.setSong(c, want);
    else if (!this.timer) { this.step = Math.floor(this.step / 128) * 128; this.nextT = c.currentTime + 0.1; if (want === 'lofi') this.startVinyl(c); }
    if (!this.timer) this.timer = setInterval(() => this.tick(), 60);
    this.playing = true;
    const g = this.bus.master.gain, now = c.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(this.level(), now + 2.5);
    this.tick();
  },
  // cambio de canción: baja la que suena y sube la otra
  swap() {
    const c = Sound.ctx; if (!c || !this.bus) return;
    const to = this.songFor(this.view); this.swapTo = to;
    const g = this.bus.master.gain, now = c.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.7);
    clearTimeout(this.swapT);
    this.swapT = setTimeout(() => {
      this.swapTo = null;
      if (!this.playing) return;
      this.setSong(c, this.songFor(this.view));
      const t = c.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(this.level(), t + 1.6);
    }, 720);
  },
  stop(fast) {
    this.playing = false;
    clearTimeout(this.swapT); this.swapTo = null;
    const c = Sound.ctx; if (!c || !this.bus) return;
    const g = this.bus.master.gain, now = c.currentTime, T = fast ? 0.3 : 1.2;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + T);
    clearTimeout(this.stopT);
    this.stopT = setTimeout(() => { if (!this.playing) { clearInterval(this.timer); this.timer = null; this.stopVinyl(); } }, T * 1000 + 400);
  },
};
{
  const unlock = () => {
    Music.gesture = true; Music.update();
    window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => Music.update());
}

// ---------------------------------------------------------------- mascota
// Personaje ilustrado por Karen. Se anima por capas: el cuerpo respira, salta y se inclina; encima va la cara
// (ojos y boca, hechos a partir de su dibujo), luego los accesorios (corona, lentes…) y las reacciones
// estilo manga (gota, brillos, "!", idea…). Ojos y boca son capas separadas: así parpadea y mueve la boca
// al hablar sin perder la expresión. Cada capa es un PNG transparente del mismo tamaño que base.png
// (assets/mascota/ojos-*.png y boca-*.png); null en una cara quiere decir "como en el dibujo original".
//
// Los brazos también se mueven: cuerpo.png es Karen sin antebrazos y cada antebrazo (con su mano) es otra capa
// que gira en el codo, con una transición de CSS. Con los brazos abajo se ve igual que el dibujo original
// (base.png, del que salen todas las capas). Las capas de brazo tienen arms.pad px extra a cada lado, porque
// los dedos pueden salir del dibujo original.
const MASCOT = {
  name: 'Karen',
  w: 420, h: 1102, // tamaño del dibujo base en sus unidades (pixeles del PNG)
  body: 'mascota/cuerpo.png',
  eyes: ['cerrados', 'feliz', 'guino', 'sorprendida', 'pensando', 'preocupada'],
  mouths: ['sonrisa', 'abierta', 'grande', 'o', 'dormida', 'hmm', 'ondulada', 'habla'],
  faces: { // ánimo: [ojos, boca]
    idle: [null, null], point: [null, 'sonrisa'], happy: ['feliz', 'abierta'], cheer: ['feliz', 'grande'],
    wave: ['guino', null], think: ['pensando', 'hmm'], surprise: ['sorprendida', 'o'], worry: ['preocupada', 'ondulada'],
    angry: ['preocupada', 'ondulada'], sleepy: ['cerrados', 'dormida'],
  },
  blink: 'cerrados', talk: 'habla',
  openEyes: [null, 'sorprendida', 'pensando', 'preocupada'], // las que pueden parpadear
  arms: {
    pad: 100,
    pivot: { izq: [74, 440], der: [285, 444] }, // codos, en unidades del dibujo
    hands: { izq: { puno: 'brazo-izq', paz: 'brazo-izq-paz' }, der: { puno: 'brazo-der', indice: 'brazo-der-indice' } },
  },
  // Gesto de cada ánimo: { lado: [ángulo del antebrazo, mano] }. Ángulo en grados, + = como las manecillas del
  // reloj (izq: + sube hacia afuera; der: − sube hacia afuera). El lado que no aparece se queda colgando.
  poses: {
    point: { der: [-95, 'indice'] },          // señala hacia el globo o el tablero
    happy: { izq: [145] },                    // puño arriba
    cheer: { izq: [155], der: [-155] },       // los dos puños arriba
    wave: { izq: [160, 'paz'] },              // ✌ junto a la cara (con guiño), y la mano se mueve
    think: { izq: [-80], der: [165] },        // un brazo cruzado y el puño en el pecho
    surprise: { izq: [34], der: [-34] },      // brazos hacia afuera
    worry: { izq: [-95], der: [95] },         // manos juntas en el pecho, nerviosa
    angry: { izq: [-14], der: [14] },         // puños apretados
  },
  // Movimiento corto que hace cada brazo al llegar a la pose (una clase de CSS en el antebrazo): saluda, insiste
  // al señalar, sacude el puño al festejar y mueve las manos inquieta cuando está preocupada.
  anims: { wave: { izq: 'waving' }, point: { der: 'nudge' }, happy: { izq: 'pump' }, cheer: { izq: 'pump', der: 'pump-r' }, worry: { izq: 'fidget', der: 'fidget-r' } },
  lupa: 170, // ángulo del brazo izquierdo cuando sostiene la lupa: junto a la cara, sin salirse de la pantalla
  src: (kind, name) => `mascota/${kind}-${name}.png`,
  file: name => `mascota/${name}.png`,
  all() {
    const hands = Object.values(this.arms.hands).flatMap(h => Object.values(h)).map(this.file);
    return [this.body, ...hands, this.file('codo-izq'), this.file('codo-der'),
      ...this.eyes.map(n => this.src('ojos', n)), ...this.mouths.map(n => this.src('boca', n))];
  },
};
// Se cargan una sola vez para que el primer parpadeo o el primer gesto no tarden.
let mascotLoaded = false;
function preloadMascot() {
  if (mascotLoaded) return; mascotLoaded = true;
  for (const src of MASCOT.all()) { const im = new Image(); im.decoding = 'async'; im.src = src; }
}
const MV = { x: -90, y: -210, w: 620, h: 1312 }; // lienzo con espacio para reacciones arriba y a los lados
const KHEAD = { x: 30, y: -6, w: 310, h: 310 };   // solo la cara, para el circulito junto al tablero
const INK = '#1b1424', RED = '#e3141b';
const star4 = (x, y, r, fill, d = 0) => `<path class="tw" style="animation-delay:${d}s" d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`;
const zpath = (x, y, w) => `<path d="M${x} ${y}h${w}l${-w} ${w}h${w}" fill="none" stroke="${INK}" stroke-width="${Math.max(7, w / 5)}" stroke-linecap="round" stroke-linejoin="round"/>`;
const note = (x, y, fill) => `<g><ellipse cx="${x}" cy="${y}" rx="17" ry="12" transform="rotate(-20 ${x} ${y})" fill="${fill}" stroke="${INK}" stroke-width="5"/><path d="M${x + 14} ${y - 4}V${y - 70}q18 10 26 30" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/></g>`;
const EMOTES = { // todas del lado izquierdo y arriba de la cabeza: a la derecha va el globo
  sparkle: star4(46, -44, 34, '#fff', 0) + star4(112, -150, 44, RED, .25) + star4(36, 176, 24, '#fff', .5) + star4(240, -176, 26, '#fff', .7),
  sweat: `<g class="drip"><path d="M84 28C66 68 60 90 74 104c15 14 38 2 32-22-3-14-12-32-22-54z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M78 80c-2 7 0 13 5 16" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/></g>`,
  exclaim: `<g class="popin"><g transform="translate(96 0)"><path d="M42 -196h36l-10 86h-16z" fill="${RED}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><circle cx="60" cy="-84" r="13" fill="${RED}" stroke="${INK}" stroke-width="6"/><path d="M118 -66l14-28M8 -84l-24-18M112 -140l26-14" stroke="${INK}" stroke-width="7" stroke-linecap="round"/></g></g>`,
  question: `<g class="popin"><g transform="translate(110 -20)"><path d="M30 -160c0-40 66-44 66-6 0 26-30 26-30 54" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"/><path d="M30 -160c0-40 66-44 66-6 0 26-30 26-30 54" fill="none" stroke="${RED}" stroke-width="9" stroke-linecap="round"/><circle cx="66" cy="-76" r="12" fill="${RED}" stroke="${INK}" stroke-width="6"/></g></g>`,
  vein: `<g class="throb" fill="none" stroke-linecap="round"><g stroke="${INK}" stroke-width="16"><path d="M18 8q12 12 0 26"/><path d="M54 8q-12 12 0 26"/><path d="M22 2q14 12 28 0"/><path d="M22 40q14-12 28 0"/></g><g stroke="${RED}" stroke-width="8"><path d="M18 8q12 12 0 26"/><path d="M54 8q-12 12 0 26"/><path d="M22 2q14 12 28 0"/><path d="M22 40q14-12 28 0"/></g></g>`,
  think: `<g class="popin"><circle cx="196" cy="-22" r="10" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="178" cy="-62" r="16" fill="#fff" stroke="${INK}" stroke-width="6"/><g transform="translate(-214 -44)"><path d="M300 -112c-6-34 34-50 54-30 14-26 62-20 64 12 30 4 34 46 6 54-4 26-44 30-58 14-18 18-56 12-60-14-28-4-30-40-6-36z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><g class="dots"><circle cx="336" cy="-104" r="8" fill="${INK}"/><circle cx="364" cy="-104" r="8" fill="${INK}"/><circle cx="392" cy="-104" r="8" fill="${RED}"/></g></g></g>`,
  idea: `<g class="popin"><g transform="translate(-170 -16)"><path d="M300 -60c-34-16-40-70-6-90 30-18 72 4 70 40-1 22-14 30-20 48z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M302 -58h40l-4 22h-32z" fill="${INK}"/><path d="M318 -120q10 18 0 36" fill="none" stroke="${RED}" stroke-width="6" stroke-linecap="round"/><g stroke="${RED}" stroke-width="8" stroke-linecap="round" class="rays"><path d="M266 -152l-18-14"/><path d="M322 -182v-24"/><path d="M380 -152l18-14"/><path d="M392 -104h22"/></g></g></g>`,
  zzz: `<g class="float">${zpath(96, -72, 30)}${zpath(54, -142, 42)}${zpath(12, -204, 50)}</g>`, // a un lado del gorro de dormir
  heart: `<g class="beat"><g transform="translate(-150 -60)"><path d="M300 -40c-48-34-44-80-12-80 16 0 24 12 26 20 2-8 10-20 26-20 32 0 36 46-12 80l-14 10z" fill="${RED}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/></g></g>`,
  notes: `<g class="float">${note(170, -50, INK)}${note(96, -130, RED)}</g>`,
};
const PROPS = {
  crown: `<g class="prop-drop"><g transform="translate(180 18) rotate(-9)"><path d="M-70 0l-8-66 40 34 38-82 38 82 40-34-8 66z" fill="${RED}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><rect x="-72" y="-8" width="144" height="20" rx="4" fill="${INK}"/><circle cx="-36" cy="2" r="5" fill="#fff"/><circle cx="0" cy="2" r="5" fill="#fff"/><circle cx="36" cy="2" r="5" fill="#fff"/><circle cx="-78" cy="-66" r="10" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="0" cy="-82" r="10" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="78" cy="-66" r="10" fill="#fff" stroke="${INK}" stroke-width="5"/></g></g>`,
  glasses: `<g class="prop-pop"><g fill="rgba(255,255,255,.18)" stroke="${INK}" stroke-width="7"><circle cx="154" cy="116" r="27"/><circle cx="210" cy="123" r="27"/></g><path d="M180 116q3-6 6 2" fill="none" stroke="${INK}" stroke-width="6"/><path d="M128 110l-26-8M236 120l26-6" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M140 104q8-8 18-6M196 112q8-8 18-6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></g>`,
  partyhat: `<g class="prop-drop"><g transform="translate(196 14) rotate(16)"><path d="M-50 0L0 -128 50 0z" fill="#fff" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="M-30 -52L18 -36M-16 -88L10 -80M-42 -20L36 -2" stroke="${RED}" stroke-width="12" stroke-linecap="round"/><path d="M-52 0q52 18 104 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><circle cx="0" cy="-132" r="15" fill="${RED}" stroke="${INK}" stroke-width="6"/></g></g>`,
  nightcap: `<g class="prop-drop"><path d="M92 50C96 -30 210 -64 268 -6c30 30 50 74 74 120l-34 6c-16-40-30-62-46-74l-6 30C200 34 140 38 92 50z" fill="${RED}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="M90 46q90-34 176-10l2 26q-90-22-176 10z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><circle cx="330" cy="126" r="22" fill="#fff" stroke="${INK}" stroke-width="7"/></g>`,
};
// La lupa va en la mano izquierda: está dibujada con el brazo colgando (apunta hacia abajo) y queda arriba,
// junto a la cara, cuando el brazo sube.
const HAND_LUPA = `<g class="prop-pop"><path d="M36 566L22 640" stroke="${INK}" stroke-width="18" stroke-linecap="round"/><path d="M36 566L22 640" stroke="${RED}" stroke-width="7" stroke-linecap="round"/><circle cx="13" cy="688" r="46" fill="rgba(255,255,255,.45)" stroke="${INK}" stroke-width="11"/><path d="M38 706q-8 18-28 22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/></g>`;
// En modo oscuro las líneas de tinta se perderían contra el fondo: cada reacción lleva debajo una copia con
// contorno claro, como una estampa (la copia solo se ve en modo oscuro).
const halo = svg => `<g class="m-halo">${svg}</g>${svg}`;
const THEME_WORLD = t => t.includes('defense') ? 'defense' : t.includes('mateIn1') ? 'mate1' : t.includes('mateIn2') ? 'mate2' : t.includes('fork') ? 'fork'
  : t.some(x => x === 'pin' || x === 'skewer') ? 'pin' : t.includes('discoveredAttack') ? 'discovered' : t.includes('hangingPiece') ? 'hanging' : 'mix';
// Elige una frase de Karen sin repetir hasta agotar la lista, y nunca la misma dos veces seguidas.
// {name}, {n}, {rank}, {rating}, {lesson}, {move} y {streak} se cambian por sus valores.
const LINE_BAG = {};
function karenLine(pool, vars = {}) {
  const list = KAREN_LINES[pool]; if (!list || !list.length) return '';
  let bag = LINE_BAG[pool];
  if (!bag || !bag.left.length) {
    const last = bag ? bag.last : -1, idx = shuffle(list.map((_, i) => i));
    if (idx.length > 1 && idx[0] === last) idx.push(idx.shift());
    bag = LINE_BAG[pool] = { left: idx, last };
  }
  const i = bag.left.shift(); bag.last = i;
  const fill = t => t.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null && vars[k] !== '' ? String(vars[k]) : '').replace(/,\s*([!?.¡¿])/g, '$1').replace(/¡\s*!\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  const item = list[i];
  return typeof item === 'string' ? fill(item) : Object.assign({}, item, { text: fill(item.text) });
}
// Un dibujo de Karen con sus capas: cuerpo que respira, ánimo, accesorios y reacciones.
// Lo usan la mascota flotante, la Escuela y las celebraciones; vb recorta el dibujo (MV = completo).
class KarenFig {
  constructor(vb = MV) {
    preloadMascot();
    this.timers = {}; this.mood = 'idle'; this.face = MASCOT.faces.idle; this.shown = [null, null]; this.talking = false;
    this.svg = svgEl('svg', { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, preserveAspectRatio: 'xMidYMin meet', class: 'm-svg', 'aria-hidden': 'true' });
    const layer = () => svgEl('image', { x: 0, y: 0, width: MASCOT.w, height: MASCOT.h, display: 'none' });
    // cuerpo sin antebrazos + un antebrazo por lado que gira en el codo
    this.rig = svgEl('g', { class: 'm-rig' });
    this.rig.append(svgEl('image', { href: MASCOT.body, x: 0, y: 0, width: MASCOT.w, height: MASCOT.h }));
    this.arm = {};
    const pad = MASCOT.arms.pad, wide = { x: -pad, y: 0, width: MASCOT.w + 2 * pad, height: MASCOT.h };
    for (const side of ['izq', 'der']) {
      const [px, py] = MASCOT.arms.pivot[side];
      const outer = svgEl('g', { class: 'm-arm' }), inner = svgEl('g', { class: 'm-arm-in' }), held = svgEl('g');
      for (const g of [outer, inner]) g.style.transformOrigin = `${px}px ${py}px`;
      const file = MASCOT.arms.hands[side].puno;
      const img = svgEl('image', Object.assign({ href: MASCOT.file(file) }, wide));
      const codo = svgEl('image', Object.assign({ href: MASCOT.file('codo-' + side), class: 'm-codo' }, wide));
      inner.append(held, img, codo); outer.append(inner); this.rig.append(outer);
      this.arm[side] = { outer, inner, img, held, file, ang: 0 };
    }
    this.eyes = layer(); this.mouth = layer();
    this.props = svgEl('g', { class: 'm-props' }); this.emote = svgEl('g', { class: 'm-emote' });
    this.svg.append(this.rig, this.eyes, this.mouth, this.props, this.emote);
    this.body = h('div', { class: 'm-body' }); this.body.append(this.svg);
    // parpadea sola mientras esté en la página (la mascota flotante lo controla ella misma al mostrarse)
    const born = Date.now();
    this.startBlink(() => this.body.isConnected || Date.now() - born < 4000);
  }
  // pone una capa de la cara; si el nombre es null se ve la del dibujo original
  setLayer(i, name) {
    if (this.shown[i] === name) return;
    this.shown[i] = name;
    const el = i ? this.mouth : this.eyes;
    if (!name) { el.setAttribute('display', 'none'); return; }
    el.setAttribute('href', MASCOT.src(i ? 'boca' : 'ojos', name)); el.removeAttribute('display');
  }
  pose({ mood = 'idle', prop = null, emote = null } = {}, bigEmote = false) {
    this.mood = mood; this.face = MASCOT.faces[mood] || MASCOT.faces.idle;
    clearTimeout(this.timers.unblink);
    this.setLayer(0, this.face[0]);
    if (!this.talking) this.setLayer(1, this.face[1]); // si está hablando, la boca nueva entra en el siguiente movimiento
    this.body.removeAttribute('data-mood'); void this.body.offsetWidth; this.body.setAttribute('data-mood', mood);
    const props = [].concat(prop || []);
    this.setArms(mood, props.includes('magnifier'));
    this.props.innerHTML = props.map(p => (PROPS[p] ? (p === 'glasses' ? PROPS[p] : halo(PROPS[p])) : '')).join('');
    this.emote.innerHTML = emote && EMOTES[emote] ? halo(EMOTES[emote]) : '';
    // en pantallas chicas las reacciones se dibujan un poco más grandes para que se lean
    this.emote.setAttribute('transform', bigEmote ? 'translate(170 0) scale(1.3) translate(-170 0)' : '');
  }
  // Gestos con los brazos: cada antebrazo gira en su codo y la transición de CSS lo mueve suave (con un rebotito).
  // La mano cambia al empezar el movimiento (puño, ✌, dedo que señala) y la lupa, si la trae, va en la mano.
  setArms(mood, lupa) {
    const P = Object.assign({}, MASCOT.poses[mood]);
    if (lupa) P.izq = [MASCOT.lupa];
    for (const side in this.arm) {
      const [ang = 0, hand = 'puno'] = P[side] || [], A = this.arm[side];
      const file = MASCOT.arms.hands[side][hand] || MASCOT.arms.hands[side].puno;
      A.outer.style.transform = ang ? `rotate(${ang}deg)` : '';
      A.outer.classList.toggle('bent', !!ang);
      if (A.file !== file) { A.file = file; A.img.setAttribute('href', MASCOT.file(file)); }
    }
    const L = this.arm.izq;
    L.held.innerHTML = lupa ? halo(HAND_LUPA) : '';
    const anims = MASCOT.anims[mood] || {};
    for (const side in this.arm) {
      const A = this.arm[side], cls = reduceMotion || (lupa && side === 'izq') ? null : anims[side];
      if (A.anim) A.inner.classList.remove(A.anim);
      A.anim = cls;
      if (cls) { void A.inner.getBoundingClientRect(); A.inner.classList.add(cls); }
    }
  }
  // Al hablar la boca se abre y se cierra a un ritmo un poco irregular, como al decir sílabas.
  // Con movimiento reducido solo se queda abierta mientras escribe.
  startTalk() {
    this.body.classList.add('talking'); this.talking = true;
    clearTimeout(this.timers.talk);
    if (reduceMotion) { this.setLayer(1, MASCOT.talk); return; }
    let open = false;
    const flap = () => {
      open = !open; this.setLayer(1, open ? MASCOT.talk : this.face[1]);
      this.timers.talk = setTimeout(flap, open ? 100 + Math.random() * 70 : 70 + Math.random() * 60);
    };
    flap();
  }
  // en comas y puntos la boca se cierra un momento, como al tomar aire
  rest(ms) {
    if (!this.talking || reduceMotion) return;
    clearTimeout(this.timers.talk); this.setLayer(1, this.face[1]);
    this.timers.talk = setTimeout(() => { if (this.talking) this.startTalk(); }, ms);
  }
  stopTalk() {
    this.body.classList.remove('talking'); this.talking = false;
    clearTimeout(this.timers.talk); this.setLayer(1, this.face[1]);
  }
  startBlink(alive) {
    clearTimeout(this.timers.blink);
    if (reduceMotion) return;
    const blink = then => {
      if (!MASCOT.openEyes.includes(this.face[0])) return;
      this.setLayer(0, MASCOT.blink);
      this.timers.unblink = setTimeout(() => { this.setLayer(0, this.face[0]); if (then) this.timers.unblink = setTimeout(then, 140); }, 120);
    };
    const go = () => {
      if (!alive()) return;
      blink(Math.random() < 0.18 ? () => blink() : null); // a veces parpadea dos veces seguidas
      this.timers.blink = setTimeout(go, 2600 + Math.random() * 3600);
    };
    this.timers.blink = setTimeout(go, 1400 + Math.random() * 1200);
  }
  stopBlink() { clearTimeout(this.timers.blink); clearTimeout(this.timers.unblink); this.setLayer(0, this.face[0]); }
}
// Escribe letra por letra con una vocecita por letra, como en los juegos de rol. Cada globo tarda 2.6 s como máximo:
// los textos largos van más rápido. El globo ya tiene su tamaño final desde el principio, así no "brinca".
class Typer {
  constructor() { this.cur = null; this.t = null; }
  type(el, text, fig, done) {
    this.stop();
    const shown = h('span', { class: 'ty-text', 'aria-hidden': 'true' });
    el.textContent = '';
    el.append(h('span', { class: 'ty-ghost', 'aria-hidden': 'true' }, text), shown, h('span', { class: 'visually-hidden' }, text));
    const pause = { '.': 4, '!': 4, '?': 4, ',': 2.5, ':': 2.5, ';': 2.5, '…': 4 };
    const chars = [...text], weight = chars.reduce((a, c) => a + (pause[c] || 1), 0);
    const step = clamp(2600 / weight, 8, 34);
    let i = 0, lastSnd = 0;
    const cur = this.cur = { text, shown, done, fig };
    if (fig) fig.startTalk();
    const tick = () => {
      if (this.cur !== cur) return;
      if (i >= chars.length) return this.finish();
      const c = chars[i++]; shown.textContent = chars.slice(0, i).join('');
      if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(c)) { const now = performance.now(); if (now - lastSnd > 18) { lastSnd = now; Sound.play('voice'); } }
      else if (fig && (pause[c] || 1) >= 2.5 && i < chars.length) fig.rest(step * pause[c] + 40);
      this.t = setTimeout(tick, step * (pause[c] || 1));
    };
    tick();
  }
  finish() {
    const c = this.cur; if (!c) return;
    clearTimeout(this.t); this.cur = null;
    c.shown.textContent = c.text; if (c.fig) c.fig.stopTalk();
    if (c.done) c.done();
  }
  stop() { const c = this.cur; clearTimeout(this.t); this.cur = null; if (c && c.fig) c.fig.stopTalk(); }
}
const Mascot = {
  el: null, mode: null, shown: false, lastAt: 0, lastIdle: Date.now(), lastPuzzle: 0, timers: {}, ty: new Typer(),
  get typing() { return this.ty.cur; },
  enabled() { return S.settings.mascot !== false; },
  mount() {
    if (this.el) return;
    this.f = new KarenFig(MV);
    const hit = svgEl('rect', { class: 'm-hit', x: 30, y: 0, width: 300, height: 760, fill: 'transparent' });
    hit.addEventListener('click', () => this.tap());
    this.f.svg.append(hit);
    this.body = this.f.body;
    this.fig = h('div', { class: 'm-fig' }); this.fig.append(this.body);
    this.bub = h('div', { class: 'm-bubble speech', role: 'status', 'aria-live': 'polite', onclick: () => (this.ty.cur ? this.finishType() : this.hide()) });
    this.el = h('div', { class: 'mascot' }, this.fig, this.bub);
    document.body.append(this.el);
    window.addEventListener('resize', () => { if (this.shown) this.layout(this.mode); });
  },
  // tamaño y posición: 'tour' grande, 'tip' mediana, 'play' chica (para no tapar el tablero)
  layout(mode) {
    this.mount(); this.mode = mode;
    const W = innerWidth, Hv = innerHeight;
    const H = mode === 'tour' ? clamp(Hv * 0.5, 280, 480) : mode === 'play' ? clamp(Hv * 0.3, 200, 290) : clamp(Hv * 0.4, 240, 380);
    const vis = H * (mode === 'play' ? 0.5 : 0.6), s = H / MASCOT.h;
    const col = $('#app').classList.contains('wide') ? 1120 : 560, colLeft = (W - Math.min(W, col)) / 2;
    const L = W > 900 ? Math.max(8, colLeft - 12 - (MASCOT.w + 40) * s) : 2 + 48 * s; // espacio para el puño o la lupa cuando levanta el brazo
    Object.assign(this.fig.style, { left: (L + MV.x * s) + 'px', bottom: -(MASCOT.h * s - vis) + 'px', width: MV.w * s + 'px', height: MV.h * s + 'px' });
    this.fig.style.setProperty('--out', (vis + 40 + 210 * s) + 'px');
    // globo a la derecha de la cara; si no cabe, arriba de la cabeza
    let left = L + 272 * s, bottom = Math.max(14, vis - 196 * s), above = false;
    if (W - left - 12 < 210) { left = 12; bottom = vis + 24; above = true; }
    const maxW = Math.min(360, W - left - 12);
    this.geo = { left, bottom, maxW, above, s, vis };
    Object.assign(this.bub.style, { left: left + 'px', bottom: bottom + 'px', maxWidth: maxW + 'px' });
    this.bub.classList.toggle('above', above);
    return this.geo;
  },
  pose(o = {}) {
    this.mount();
    this.mood = o.mood || 'idle';
    this.f.pose(o, !!(this.geo && this.geo.s < 0.36));
  },
  show() {
    this.mount();
    if (!this.shown) { this.shown = true; void this.fig.offsetWidth; Sound.play('pop'); }
    this.el.classList.add('show');
    this.f.startBlink(() => this.shown);
  },
  hide(now) {
    if (!this.el) return;
    clearTimeout(this.timers.auto); clearTimeout(this.timers.bub); this.stopType();
    this.bub.classList.remove('on');
    if (tour) return;
    this.shown = false; this.f.stopBlink();
    if (now) { this.el.classList.add('instant'); setTimeout(() => this.el && this.el.classList.remove('instant'), 60); }
    this.el.classList.remove('show');
  },
  tap() {
    if (this.ty.cur) return this.finishType();
    if (!tour) return this.hide();
    this.pose({ mood: 'happy', emote: 'heart' }); haptic(15);
    clearTimeout(this.timers.tap);
    this.timers.tap = setTimeout(() => { if (tour) this.pose(tour.steps[tour.i]); }, 1400);
  },
  type(el, text, done) { this.mount(); this.ty.type(el, text, this.f, done); },
  finishType() { this.ty.finish(); },
  stopType() { this.ty.stop(); },
  // consejo con globo; se cierra solo o al tocarlo
  say(text, o = {}) {
    if (tour || !text) return false;
    if (!o.force && (!this.enabled() || document.body.classList.contains('gated'))) return false;
    if (!o.force && Date.now() - this.lastAt < (o.gap == null ? 15000 : o.gap)) return false;
    this.lastAt = Date.now();
    if (!o.mode && Music.view === 'play') return this.sayInline(text, o);
    const was = this.shown;
    this.layout(o.mode || 'tip');
    this.pose(o); this.show();
    const p = h('p'); this.bub.textContent = '';
    this.bub.append(h('span', { class: 'm-name' }, MASCOT.name), p, h('span', { class: 'm-close', 'aria-hidden': 'true' }, '×'));
    clearTimeout(this.timers.bub); this.bub.classList.remove('on');
    this.timers.bub = setTimeout(() => { this.bub.classList.add('on'); this.type(p, text); }, was ? 60 : 420);
    clearTimeout(this.timers.auto);
    this.timers.auto = setTimeout(() => this.hide(), o.ms || clamp(3200 + text.length * 55, 4500, 11000));
    return true;
  },
  // En los puzzles Karen no flota encima: aparece junto al tablero (o en el resultado) y empuja lo demás hacia abajo.
  noteTy: new Typer(),
  sayInline(text, o = {}) {
    const anchor = $('#view-play .result .stat-grid') || $('#view-play #status');
    if (!anchor || $('#view-play').hidden) return false;
    this.clearNote(true);
    const fig = new KarenFig(KHEAD), p = h('p');
    const close = () => { this.noteTy.stop(); note.classList.add('out'); setTimeout(() => note.remove(), 220); };
    const note = h('div', { class: 'k-note', role: 'status', 'aria-live': 'polite', onclick: () => (this.noteTy.cur ? this.noteTy.finish() : close()) },
      h('div', { class: 'k-face', 'aria-hidden': 'true' }, fig.body),
      h('div', { class: 'speech k-say' }, h('span', { class: 'm-name' }, MASCOT.name), p, h('span', { class: 'm-close', 'aria-hidden': 'true' }, '×')));
    const acts = $('#view-play #actions');
    if (anchor.id === 'status' && acts && innerHeight < 700 && !matchMedia('(orientation: landscape)').matches) acts.after(note);
    else if (anchor.id === 'status') anchor.after(note); else anchor.before(note);
    fig.pose(o); Sound.play('pop');
    this.noteTy.type(p, text, fig);
    return true;
  },
  clearNote(now) { this.noteTy.stop(); for (const n of $$('.k-note')) { if (now) n.remove(); else { n.classList.add('out'); setTimeout(() => n.remove(), 220); } } },
  react(kind, d = {}) {
    const name = (S.profile && S.profile.name) || '';
    const say = (text, o) => this.say(text, o);
    switch (kind) {
      case 'greet': {
        const day = todayStr(), rec = S.daily[day], hr = new Date().getHours(), sd = streakDays();
        const back = d.prevVisit && Date.now() - d.prevVisit > 3 * 864e5;
        const first = karenLine(back ? 'greetBack' : hr >= 5 && hr < 12 ? 'greetMorning' : hr >= 12 && hr < 19 ? 'greetAfternoon' : 'greetNight', { name });
        const second = sd >= 3 && Math.random() < 0.5 ? karenLine('greetStreak', { streak: sd })
          : schoolGated() ? 'Hoy toca seguir en mi escuela: ¡ya casi sabes jugar!'
            : rec && rec.done ? karenLine('greetDailyDone') : karenLine('greetDaily', { n: dailyNumber(day) });
        return say(first + ' ' + second, { mood: 'wave', emote: 'sparkle', gap: 0 });
      }
      case 'idle': { const t = karenLine('idle'); return say(t.text, t); }
      case 'puzzle-fail': {
        if (Date.now() - this.lastPuzzle < 90000) return false;
        const meta = WORLD_META[THEME_WORLD(d.themes || [])] || WORLD_META.mix;
        const text = Math.random() < 0.5 ? meta.lesson[Math.floor(Math.random() * meta.lesson.length)] : karenLine('puzzleFail');
        const ok = say(text, { mood: 'worry', emote: 'sweat', gap: 0, ms: 7000 });
        if (ok) this.lastPuzzle = Date.now(); return ok;
      }
      case 'streak': return say(karenLine('streak'), { mood: 'cheer', emote: Math.random() < 0.5 ? 'sparkle' : 'heart', gap: 0, ms: 3600 });
      case 'level-perfect': return say(karenLine('perfect', { name, rating: Math.round(S.rating) }), { mood: 'cheer', prop: 'partyhat', emote: 'sparkle', gap: 0 });
      case 'level-pass': return Math.random() < 0.5 && say(karenLine('pass'), { mood: 'happy', emote: 'sparkle', gap: 0 });
      case 'level-fail': return say(karenLine('fail'), { mood: 'worry', emote: 'sweat', gap: 0 });
      case 'no-lives': return say(karenLine('noLives'), { mood: 'sleepy', prop: 'nightcap', emote: 'zzz', gap: 0, ms: 9000 });
      case 'daily-done': return say(karenLine(d.perfect ? 'dailyPerfect' : 'daily'), { mood: 'cheer', emote: 'sparkle', prop: d.perfect ? 'partyhat' : null, gap: 0 });
      case 'rank-up': return say(d.k === RANKS.length - 1 ? karenLine('rankTop') : karenLine('rankUp', { rank: RANKS[d.k].name }), { mood: 'cheer', prop: 'crown', emote: 'sparkle', gap: 0, force: this.enabled() });
      case 'analysis': return say(d.n > 1 ? karenLine('analysisSome', { n: d.n }) : d.n === 1 ? karenLine('analysisOne') : karenLine('analysisNone'),
        d.n ? { mood: 'think', prop: ['glasses', 'magnifier'], emote: 'idea', gap: 0 } : { mood: 'cheer', prop: 'glasses', emote: 'sparkle', gap: 0 });
    }
    return false;
  },
};
// consejos cuando la persona se queda quieta en el mapa
let lastInput = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
setInterval(() => {
  if (Music.view !== 'map' || session || tour || document.hidden || document.body.classList.contains('gated')) return;
  if (Date.now() - lastInput > 25000 && Date.now() - Mascot.lastIdle > 240000) { Mascot.lastIdle = Date.now(); Mascot.react('idle'); }
}, 5000);
function miniPiece(code, cls, color = 'w') {
  const s = svgEl('svg', { viewBox: '0 0 40 40', class: cls || 'mini-pc', fill: 'none', 'fill-rule': 'evenodd', 'aria-hidden': 'true' });
  s.append(svgEl('use', { href: '#' + color + code })); return s;
}
const reqWorlds = R => R.worlds === 'all' ? WORLDS.length : Math.min(R.worlds, WORLDS.length);
function worldsCompleted() { return worldState().filter(w => w.done).length; }
function levelStarCounts() {
  let total = 0, three = 0;
  for (const k of WORLDS) levelsOf(k).forEach((_, i) => { total++; if ((S.levels[k + '-' + i] || 0) >= 3) three++; });
  return { total, three };
}
function rankEligible(rating = S.rating) {
  const done = worldsCompleted(), lv = levelStarCounts(); let k = 0;
  RANKS.forEach((R, i) => { if (rating >= R.min && done >= reqWorlds(R) && (!R.perfect || lv.three >= lv.total)) k = i; });
  return k;
}
function rankShown() {
  // las reglas cambiaron en la versión 0.6: el rango se recalcula una vez con las reglas nuevas
  if (S.rankRules !== 2) { S.rankMax = rankEligible(); S.rankRules = 2; }
  return Math.max(S.rankMax || 0, rankEligible());
}
function rankOf() { return RANKS[rankShown()]; }
// qué falta para el siguiente rango: lista de requisitos y un porcentaje global
function rankProgress(rating = S.rating) {
  const k = rankShown(), R = RANKS[k], next = RANKS[k + 1];
  if (!next) return { pct: 100, next: null, R, items: [], missing: [] };
  const done = worldsCompleted(), need = reqWorlds(next), lv = levelStarCounts();
  const rFrac = clamp((rating - R.min) / (next.min - R.min), 0, 1);
  const items = [
    { ok: rating >= next.min, label: `Rating táctico de ${next.min}`, have: String(Math.round(rating)), frac: rFrac, short: `${Math.max(0, Math.ceil(next.min - rating))} de rating` },
    { ok: done >= need, label: need >= WORLDS.length ? 'Completar todos los mundos' : `Completar ${need} mundos`, have: `${Math.min(done, need)}/${need}`, frac: need ? Math.min(1, done / need) : 1, short: `${need - done} mundo${need - done === 1 ? '' : 's'} más` },
  ];
  if (next.perfect) items.push({ ok: lv.three >= lv.total, label: 'Todos los niveles con 3 estrellas', have: `${lv.three}/${lv.total}`, frac: lv.total ? lv.three / lv.total : 1, short: `${lv.total - lv.three} niveles a 3 estrellas` });
  const pct = 100 * items.reduce((a, x) => a + x.frac, 0) / items.length;
  return { pct, next, R, items, missing: items.filter(x => !x.ok) };
}
function rankNeedsText(rp) {
  if (!rp.next) return 'Rango máximo';
  if (!rp.missing.length) return `Listo para ${rp.next.name}`;
  return `Para ${rp.next.name}: ${rp.missing.map(x => x.short).join(' y ')}`;
}
function ladder(k) {
  return h('div', { class: 'ladder', 'aria-hidden': 'true' }, RANKS.map((x, i) => h('span', { class: 'lad' + (i < k ? ' past' : '') + (i === k ? ' now' : ''), title: x.name }, miniPiece(x.p))));
}
function showAscension(k) {
  for (const old of $$('.ascend')) old.remove();
  const R = RANKS[k], next = RANKS[k + 1];
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); setTimeout(() => Mascot.react('rank-up', { k }), 300); };
  const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
  const btn = h('button', { class: 'btn primary', onclick: close }, 'Seguir');
  const ov = h('div', { class: 'ascend', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'asc-t', onclick: e => { if (e.target === ov) close(); } },
    h('div', { class: 'ascend-card' },
      ladder(k),
      h('div', { class: 'ascend-piece' }, miniPiece(R.p, 'big-pc')),
      h('div', { class: 'section-title', style: { margin: 0 } }, k === RANKS.length - 1 ? '¡Coronado!' : '¡Ascendiste!'),
      h('h2', { id: 'asc-t' }, k === RANKS.length - 1 ? 'Llegaste a Rey' : `Ahora eres ${R.name}`),
      h('p', { class: 'muted' }, next ? `Lo lograste con ${Math.round(S.rating)} de rating táctico. Para ${next.name} necesitas ${next.min} de rating y ${reqWorlds(next) >= WORLDS.length ? 'todos los mundos completos' : reqWorlds(next) + ' mundos completos'}${next.perfect ? ', con 3 estrellas en todos los niveles' : ''}.` : `Rating táctico ${Math.round(S.rating)} y todos los niveles con 3 estrellas. Llegaste a lo más alto.`),
      btn));
  document.body.append(ov); document.addEventListener('keydown', onKey); btn.focus();
  Sound.play('promote'); Sound.play('brilliant', 0.3); haptic(40);
  setTimeout(() => celebrate(['--brass', '--sq-light', '--sq-dark', '--good']), 250);
}

// Reto diario: los mismos 5 puzzles para todos cada día (semilla = fecha).
const DAILY_EPOCH = '2026-10-14';
function dailyNumber(d = todayStr()) { return Math.round((new Date(d + 'T12:00:00') - new Date(DAILY_EPOCH + 'T12:00:00')) / 864e5) + 1; }
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function dailyPuzzles(d) {
  const rnd = mulberry32(parseInt(hash('reto:' + d), 36) >>> 0);
  const all = Object.values(PUZ);
  const tactic = all.filter(p => p.type !== 'threat'), threat = all.filter(p => p.type === 'threat');
  const plan = [[650, tactic], [850, tactic], [950, threat.length ? threat : tactic], [1100, tactic], [1300, tactic]];
  const used = new Set(), out = [];
  for (const [t, pool] of plan) {
    let c = pool.filter(p => Math.abs(p.rating - t) <= 120 && !used.has(p.id));
    if (c.length < 3) c = pool.filter(p => !used.has(p.id)).sort((a, b) => Math.abs(a.rating - t) - Math.abs(b.rating - t)).slice(0, 8);
    const pick = c[Math.floor(rnd() * c.length)]; used.add(pick.id); out.push(pick);
  }
  return out;
}
function dailyStreak() {
  let n = 0; const d = new Date();
  if (!(S.daily[todayStr(d)] && S.daily[todayStr(d)].done)) d.setDate(d.getDate() - 1);
  while (S.daily[todayStr(d)] && S.daily[todayStr(d)].done) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function fmtClock(ms) { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function untilMidnight() { const n = new Date(), m = new Date(n); m.setHours(24, 0, 0, 0); const s = Math.max(0, Math.floor((m - n) / 1000)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x, i) => i ? String(x).padStart(2, '0') : String(x)).join(':'); }
const resEmoji = r => r === 1 ? '🟩' : r === .5 ? '🟨' : '🟥';
const resClass = r => r === 1 ? 'r1' : r === .5 ? 'r5' : r === 0 ? 'r0' : '';
function publicLink() {
  const hn = location.hostname;
  if (location.protocol === 'file:' || !hn || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(hn)) return null;
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
function shareText(d) {
  const rec = S.daily[d]; if (!rec) return '';
  const pts = rec.res.reduce((a, b) => a + (b || 0), 0), R = rankOf(), streak = dailyStreak();
  let t = `De Peón a Rey · Reto #${rec.n}\n${rec.res.map(resEmoji).join('')}  ${pts}/5 · ${fmtClock(rec.ms || 0)}\n${R.sym} ${R.name}`;
  if (streak > 1) t += ` · 🔥 ${streak} días seguidos`;
  const link = publicLink(); if (link) t += `\n${link}`;
  return t;
}
function shareResult(d, boxHost) {
  const text = shareText(d);
  const showBox = () => {
    if (!boxHost) { toast('No se pudo copiar automáticamente.'); return; }
    boxHost.textContent = '';
    const ta = h('textarea', { class: 'share-box', readonly: true, rows: 4, 'aria-label': 'Resultado para copiar' }); ta.value = text;
    boxHost.append(h('div', { class: 'muted', style: { fontSize: '14px' } }, 'Selecciona el texto y cópialo:'), ta);
    ta.focus(); ta.select();
  };
  try {
    if (navigator.share && window.top === window && matchMedia('(pointer: coarse)').matches) { navigator.share({ text }).catch(() => {}); return; }
    navigator.clipboard.writeText(text).then(() => { toast('Resultado copiado. Pégalo donde quieras.'); Sound.play('hint'); }, showBox);
  } catch (e) { showBox(); }
}
function startDaily() {
  const d = todayStr(), rec = S.daily[d];
  if (rec && rec.done) return;
  const done = rec ? rec.res.length : 0;
  startSession({ kind: 'daily', date: d, kicker: `Reto diario #${dailyNumber(d)}`, title: 'Reto del día', puzzles: dailyPuzzles(d), hideTheme: true,
    i: Math.min(done, 4), results: rec ? rec.res.slice() : [], msBefore: rec ? rec.ms || 0 : 0 });
}
setInterval(() => {
  const el = $('#daily-cd'); if (el) el.textContent = untilMidnight();
  if (el && el.dataset.day && el.dataset.day !== todayStr() && !session && currentTab === 'map') renderMap(false);
}, 1000);
function sfxForSan(san) {
  if (!san) return 'move';
  if (/[+#]/.test(san)) return 'check';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('=')) return 'promote';
  if (san.includes('x')) return 'capture';
  return 'move';
}
function haptic(ms) { try { if (S.settings.sound !== false && navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(ms); } catch (e) { /* sin vibración */ } }
function celebrate(colors) {
  if (reduceMotion) return;
  const cv = h('canvas', { class: 'confetti', 'aria-hidden': 'true' }); document.body.append(cv);
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  let ctx = null; try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) { cv.remove(); return; }
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const pal = colors.map(c => c.startsWith('--') ? cs.getPropertyValue(c).trim() : c).filter(Boolean);
  const parts = Array.from({ length: 90 }, () => ({ x: W / 2 + (Math.random() - .5) * 140, y: H * .3, vx: (Math.random() - .5) * 10, vy: -Math.random() * 9 - 4, s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: pal[Math.floor(Math.random() * pal.length)] }));
  const t0 = performance.now();
  const step = now => {
    const t = now - t0; ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - t / 1900); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); ctx.restore();
    }
    if (t < 1900) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}
function countUp(el, to, fmt, ms = 700) {
  if (!el) return; if (reduceMotion || !to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / ms); const e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(to * e)); if (k < 1) requestAnimationFrame(step); };
  el.textContent = fmt(0); requestAnimationFrame(step);
}
const wp = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -10000, 10000))) - 1);

// ---------------------------------------------------------------- interfaz general
let currentTab = 'map';
function showView(name) {
  Music.view = name; Music.update();
  if (SCH_TY && name !== 'school') SCH_TY.stop();
  if (!tour && Mascot.shown) Mascot.hide();
  for (const v of $$('.view')) v.hidden = v.dataset.view !== name;
  $('#tabbar').hidden = name === 'play' || name === 'lesson';
  document.body.classList.toggle('in-school', name === 'school' || name === 'lesson');
  document.body.classList.toggle('in-lesson', name === 'lesson');
  document.body.classList.toggle('in-play', name === 'play');
  if (name === 'lesson') $('#app').classList.add('wide');
  window.scrollTo({ top: 0 });
}
function setTab(name) {
  if (LS) schClose(true);
  currentTab = name;
  $('#app').classList.remove('wide');
  for (const t of $$('.tab')) t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  const ti = ['map', 'school', 'analyze', 'progress'].indexOf(name);
  if (ti >= 0) $('.tabbar-inner').style.setProperty('--ti', ti);
  showView(name);
  if (name === 'map') renderMap(true);
  if (name === 'school') renderSchool();
  if (name === 'analyze') renderAnalyze();
  if (name === 'progress') renderProgress();
}
for (const t of $$('.tab')) t.addEventListener('click', () => setTab(t.dataset.tab));

function renderChips() {
  syncLives();
  const c = $('#chips'); c.textContent = '';
  const life = h('span', { class: 'chip', title: 'Vidas' }, icon('i-heart', 'heart'), String(S.lives));
  if (S.lives < MAX_LIVES) life.append(h('span', { class: 'sub' }, fmtMs(nextLifeIn())));
  const since = Date.now() - hurtAt;
  if (since < 700) { life.classList.add('hurt'); life.style.animationDelay = -since + 'ms'; life.firstChild.style.animationDelay = -since + 'ms'; }
  c.append(life,
    h('span', { class: 'chip', title: 'Estrellas' }, icon('i-star', 'star'), String(totalStars())),
    h('button', { class: 'chip chip-btn rank-chip', type: 'button', title: `Rango: ${rankOf().name} · rating táctico ${Math.round(S.rating)}`, 'aria-label': `Rango ${rankOf().name}, rating táctico ${Math.round(S.rating)}. Ver progreso`, onclick: () => { if (!session) setTab('progress'); } }, miniPiece(rankOf().p), String(Math.round(S.rating))),
    h('button', { class: 'chip chip-btn me-chip', type: 'button', id: 'me-chip', title: (S.profile && S.profile.name) || 'Tu perfil', 'aria-label': 'Tu perfil: sonido, consejos y cerrar sesión', 'aria-haspopup': 'dialog', onclick: e => toggleQuickMenu(e.currentTarget) },
      avatarEl('me-av'), S.settings.sound === false && S.settings.music === false ? icon('i-sound-off', 'me-mute') : null));
}
// Menú de tu foto: cuenta, efectos, música, consejos de la mascota y cerrar sesión.
function toggleQuickMenu(btn) {
  const old = $('.qmenu'); if (old) { old._off(); return; }
  const P = S.profile || {}, A = S.account || {}, signed = A.provider === 'firebase' && !!Auth.user;
  const row = (label, sub, on, apply) => {
    const inp = h('input', { type: 'checkbox', role: 'switch', class: 'switch' }); inp.checked = on;
    inp.addEventListener('change', () => { apply(inp.checked); save(); renderChips(); });
    return h('label', { class: 'qrow' }, h('span', null, h('strong', null, label), h('small', null, sub)), inp);
  };
  const go = fn => () => { m._off(); fn(); };
  const m = h('div', { class: 'qmenu', role: 'dialog', 'aria-label': 'Tu perfil' },
    h('div', { class: 'qhead' }, avatarEl(), h('div', { class: 'qwho' }, h('strong', null, P.name || 'Jugador'), h('small', null, signed ? (A.email || 'Cuenta conectada') : 'Perfil en este navegador'))),
    row('Efectos', 'Piezas, aciertos y errores', S.settings.sound !== false, v => { S.settings.sound = v; if (v) Sound.play('move'); }),
    row('Música', 'Fondo tranquilo en los menús', S.settings.music !== false, v => { S.settings.music = v; Music.gesture = true; Music.update(); }),
    row(`Consejos de ${MASCOT.name}`, 'Aparece de vez en cuando', S.settings.mascot !== false, v => {
      S.settings.mascot = v;
      if (!v) Mascot.hide(); else Mascot.say('¡Aquí sigo! Te daré un consejo de vez en cuando.', { mood: 'wave', emote: 'sparkle', force: true });
    }),
    h('div', { class: 'qacts' },
      h('button', { class: 'qbtn', type: 'button', onclick: go(() => { if (session) exitSession(); gate('profile', { edit: true }); }) }, 'Editar perfil'),
      h('button', { class: 'qbtn', type: 'button', onclick: go(() => startTour()) }, 'Ver tutorial'),
      h('button', { class: 'qbtn danger', type: 'button', onclick: go(() => askLogout()) }, 'Cerrar sesión')));
  const close = e => { if (!m.contains(e.target) && !(e.target.closest && e.target.closest('#me-chip'))) m._off(); };
  const key = e => { if (e.key === 'Escape') { m._off(); const b = $('#me-chip'); if (b) b.focus(); } };
  m._off = () => { m.remove(); document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', key); };
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 8) + 'px'; m.style.right = Math.max(12, innerWidth - r.right) + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', key); }, 0);
  const first = $('input', m); if (first) first.focus({ preventScroll: true });
}
setInterval(() => { if (S.lives < MAX_LIVES) renderChips(); }, 1000);

let toastTimer = null;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', style: { position: 'fixed', left: '50%', bottom: 'calc(var(--tabbar) + 18px + env(safe-area-inset-bottom, 0px))', transform: 'translateX(-50%)', background: 'var(--ink)', color: 'var(--bg)', padding: '10px 16px', borderRadius: '12px', zIndex: 60, maxWidth: 'calc(100% - 32px)', boxShadow: 'var(--shadow)', fontWeight: 700 } }); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------------------------------------------------------------- mapa
let mapScrolled = false;
function renderMap(scroll) {
  renderChips();
  const root = $('#view-map'); root.textContent = '';
  const ws = worldState(), gated = schoolGated();
  if (gated) root.append(schoolCta());

  // reto diario
  {
    const d = todayStr(), rec = S.daily[d], n = dailyNumber(d);
    const sq = h('div', { class: 'daily-sq', 'aria-hidden': 'true' });
    for (let i = 0; i < 5; i++) sq.append(h('span', { class: rec ? resClass(rec.res[i]) : '' }));
    const pts = rec ? rec.res.reduce((a, b) => a + (b || 0), 0) : 0;
    const shareHost = h('div', { class: 'share-host' });
    const card = h('div', { class: 'card daily' },
      h('div', { class: 'dl' },
        h('div', { class: 'section-title', style: { margin: 0 } }, `Reto diario #${n}`),
        h('h3', null, rec && rec.done ? `${pts}/5 en ${fmtClock(rec.ms || 0)}` : rec ? 'Te faltan ' + (5 - rec.res.length) : 'Cinco puzzles, los mismos para todos'),
        sq),
      rec && rec.done
        ? h('button', { class: 'btn small primary', onclick: () => shareResult(d, shareHost) }, 'Compartir')
        : h('button', { class: 'btn small primary', onclick: () => startDaily() }, rec ? 'Continuar' : 'Jugar'),
      h('div', { class: 'meta' }, rec && rec.done
        ? ['Siguiente reto en ', h('span', { id: 'daily-cd', class: 'mono', 'data-day': d }, untilMidnight()), dailyStreak() > 1 ? `. Racha de ${dailyStreak()} días.` : '']
        : 'No gasta vidas. Un intento por día.'),
      shareHost);
    root.append(card);
  }

  // entrenamiento personal
  const minePending = S.mine.filter(m => !m.mastered);
  const train = h('div', { class: 'train' });
  root.append(h('p', { class: 'section-title' }, 'Tu entrenamiento'), train);
  if (minePending.length || S.review.length) {
    train.append(
      h('div', { class: 'card' },
        h('div', { class: 'big', style: { color: 'var(--mine)' } }, String(minePending.length)),
        h('div', { class: 'lbl' }, 'errores de tus partidas por corregir'),
        h('button', { class: 'btn small', disabled: !minePending.length, onclick: () => startMine() }, 'Practicar')),
      h('div', { class: 'card' },
        h('div', { class: 'big' }, String(S.review.length)),
        h('div', { class: 'lbl' }, 'puzzles fallados para repasar'),
        h('button', { class: 'btn small', disabled: !S.review.length, onclick: () => startReview() }, 'Repasar')));
  } else {
    train.append(h('div', { class: 'card train-empty' },
      h('strong', null, 'Convierte tus errores en puzzles'),
      h('div', { class: 'lbl' }, 'Analiza una de tus partidas y cada error grave aparecerá aquí para practicarlo. Repasar no gasta vidas.'),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => setTab('analyze') }, 'Analizar una partida'))));
  }
  if (S.lives === 0) {
    root.append(h('div', { class: 'notice bad', style: { marginBottom: '20px' } },
      h('strong', null, 'Sin vidas por ahora. '), `Recuperas una en ${fmtMs(nextLifeIn())}. Jugar en racha de errores baja tu nivel; mientras tanto, repasa tus errores (no gasta vidas).`));
  }

  let currentNode = null;
  ws.forEach((w, wi) => {
    const meta = WORLD_META[w.key];
    const sec = h('section', { class: 'world' + (w.unlocked ? '' : ' locked'), id: 'world-' + w.key, style: { '--wc': meta.color } });
    const doneCount = w.stars.filter(s => s > 0).length;
    const banner = h('div', { class: 'world-banner' },
      miniPiece(meta.piece, 'wb-piece'),
      h('div', { class: 'wb-top' }, h('span', null, `Mundo ${wi + 1}`),
        h('span', { class: 'wb-count', title: 'Niveles superados' }, w.done ? (w.stars.every(x => x === 3) ? '3 estrellas en todo' : 'Completo') : `${doneCount} de ${w.lv.length}`)),
      h('h2', null, meta.name), h('p', null, meta.blurb));
    const rowBtns = h('div', { class: 'wb-row' });
    const open = !!S.lessonsOpen[w.key];
    rowBtns.append(h('button', { class: 'btn small', 'aria-expanded': open ? 'true' : 'false', onclick: () => { S.lessonsOpen[w.key] = !open; save(); renderMap(); } }, open ? 'Ocultar lección' : 'Ver lección'));
    if (w.unlocked && !w.done && w.current >= 0 && w.lv.length >= 3) {
      rowBtns.append(h('button', { class: 'btn small', onclick: () => startSkip(w.key) }, 'Examen para saltar'));
    }
    if (!w.unlocked) rowBtns.append(h('span', { class: 'prog' }, gated ? 'Se abre al terminar lo básico en la Escuela' : 'Completa el mundo anterior para abrirlo'));
    banner.append(rowBtns, h('div', { class: 'wb-bar', role: 'progressbar', 'aria-label': 'Niveles superados', 'aria-valuemin': 0, 'aria-valuemax': w.lv.length, 'aria-valuenow': doneCount },
      h('i', { style: { width: (100 * doneCount / w.lv.length) + '%' } })));
    sec.append(banner);
    if (open) {
      sec.append(h('div', { class: 'card lesson' }, h('h3', null, 'Cómo detectarla'),
        h('ul', null, meta.lesson.map(t => h('li', null, t)))));
    }

    // sendero de niveles
    const ROW = 96, OFF = [0, .55, .85, .55, 0, -.55, -.85, -.55];
    const n = w.lv.length; const H = n * ROW + 10;
    const trail = h('div', { class: 'trail', style: { height: H + 'px' } });
    const pts = w.lv.map((_, i) => [50 + OFF[i % 8] * 30, i * ROW + 36]);
    const path = svgEl('svg', { class: 'path', viewBox: `0 0 100 ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; d += ` C${x0} ${y0 + ROW / 2} ${x1} ${y1 - ROW / 2} ${x1} ${y1}`; }
    path.append(svgEl('path', { d, 'vector-effect': 'non-scaling-stroke' }));
    trail.append(path);
    w.lv.forEach((lv, i) => {
      const stars = w.stars[i];
      const locked = !w.unlocked || (!stars && i !== w.current);
      const isCur = i === w.current;
      const avg = Math.round(lv.reduce((a, p) => a + p.rating, 0) / lv.length / 50) * 50;
      const node = h('button', { class: 'node' + (stars ? ' done' : '') + (isCur ? ' current' : '') + (locked ? ' locked' : ''),
        style: { left: pts[i][0] + '%', top: (pts[i][1] - (isCur ? 36 : 30)) + 'px' },
        'aria-label': `Nivel ${i + 1}${stars ? ', ' + stars + ' estrellas' : ''}${locked ? ', bloqueado' : ''}`,
        disabled: locked ? true : null,
        onclick: () => startLevel(w.key, i) });
      node.append(h('span', { class: 'disc' }, locked ? icon('i-lock') : isCur ? '' : String(i + 1)));
      const st = h('span', { class: 'stars' });
      if (stars) for (let k = 0; k < 3; k++) { const s = icon('i-star'); s.style.color = k < stars ? 'var(--brass)' : 'var(--line)'; st.append(s); }
      else if (!locked) st.append(h('span', { class: 'diff' }, '≈' + avg));
      node.append(st);
      trail.append(node);
      if (isCur) currentNode = node;
    });
    if (w.current >= 0) placeToken(trail, w.key, pts, w.current);
    sec.append(trail);
    root.append(sec);
  });
  const allDone = ws.length && ws.every(w => w.done);
  if (allDone) root.append(h('div', { class: 'notice good' }, h('strong', null, '¡Completaste todos los mundos! '), 'Sigue con tus errores personales y repasa los niveles para conseguir 3 estrellas.'));
  root.append(h('p', { class: 'credits' }, 'Los números junto a cada nivel son la dificultad estimada (escala de rating). Las vidas se recuperan solas: una cada 20 minutos.'));
  if (tokenHopPending && currentNode) {
    const go = tokenHopPending; tokenHopPending = null; mapScrolled = true;
    setTimeout(() => { if (Music.view !== 'map' || !currentNode.isConnected) return; currentNode.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(go, 520); }, 60);
  } else if (scroll && currentNode && !mapScrolled && Object.keys(S.levels).length) { mapScrolled = true; setTimeout(() => { if (Music.view === 'map' && currentNode.isConnected) currentNode.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }, 60); }
  tokenHopPending = null;
}

// Tu pieza de rango se para en la casilla del siguiente nivel; cuando avanzas, salta hasta ella.
const TOKEN_AT = {};
let tokenHopPending = null;
function placeToken(trail, key, pts, cur) {
  const at = (i, el) => { el.style.left = pts[i][0] + '%'; el.style.top = (pts[i][1] - 30) + 'px'; };
  const tok = h('div', { class: 'token', 'aria-hidden': 'true' }, h('div', { class: 'tk' }, miniPiece(rankOf().p, 'tk-pc')));
  const from = TOKEN_AT[key];
  TOKEN_AT[key] = cur;
  trail.append(tok);
  if (from == null || reduceMotion) { at(cur, tok); if (from == null && !reduceMotion) tok.classList.add('drop'); return; }
  if (from === cur) { at(cur, tok); return; }
  at(from, tok);
  tokenHopPending = () => {
    if (!tok.isConnected) return;
    tok.classList.add('hop'); at(cur, tok); Sound.play('move');
    setTimeout(() => tok.classList.remove('hop'), 800);
  };
}

function startLevel(key, i) {
  syncLives();
  if (S.lives <= 0) { toast(`Sin vidas. La próxima llega en ${fmtMs(nextLifeIn())}.`); renderMap(); return; }
  const meta = WORLD_META[key];
  startSession({ kind: 'level', worldKey: key, levelIdx: i, kicker: `Nivel ${i + 1} de ${levelsOf(key).length}`, title: meta.name, puzzles: pickPuzzles(levelsOf(key)[i]), hideTheme: key === 'mix' });
}
function startSkip(key) {
  syncLives();
  if (S.lives <= 0) { toast(`Sin vidas. La próxima llega en ${fmtMs(nextLifeIn())}.`); return; }
  const lv = levelsOf(key); const hard = pickPuzzles(lv.slice(-3).flat());
  startSession({ kind: 'skip', worldKey: key, kicker: 'Examen para saltar', title: WORLD_META[key].name, puzzles: hard, hideTheme: key === 'mix' });
}
function startReview() {
  const list = shuffle(S.review.map(id => PUZ[id]).filter(Boolean)).slice(0, 5);
  if (!list.length) return;
  startSession({ kind: 'review', kicker: 'Repaso', title: 'Puzzles fallados', puzzles: list, hideTheme: true });
}
function startMine(only) {
  const pool = only || shuffle(S.mine.filter(m => !m.mastered)).slice(0, 5);
  if (!pool.length) return;
  startSession({ kind: 'mine', kicker: 'Tus partidas', title: 'Corrige tus errores', puzzles: pool.map(m => Object.assign({ personal: true }, m)), hideTheme: true });
}

// ---------------------------------------------------------------- sesión de puzzles
let session = null, board = null, game = null, st = null;
function startSession(opts) {
  session = Object.assign({ i: 0, results: [], ratingStart: S.rating, rankStart: rankShown(), rankProgress0: rankProgress(), t0: Date.now(), msBefore: 0 }, opts);
  $('#app').classList.remove('wide');
  showView('play');
  const root = $('#view-play'); root.textContent = '';
  const head = h('div', { class: 'play-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Salir al mapa', onclick: () => exitSession() }, icon('i-close')),
    h('div', { class: 't' }, h('div', { class: 'k' }, session.kicker), h('h2', null, session.title)),
    session.kind === 'level' || session.kind === 'skip' ? h('span', { class: 'chip' }, icon('i-heart', 'heart'), String(S.lives)) : null);
  const pips = h('div', { class: 'pips', id: 'pips' });
  const host = h('div', { id: 'board-host' });
  const status = h('div', { class: 'status', id: 'status', 'aria-live': 'polite' });
  const actions = h('div', { class: 'play-actions', id: 'actions' });
  root.append(head, pips, host, status, actions);
  board = new Board(host);
  board.onMove = (f, t, pr, dragged) => onUserMove(f, t, pr, dragged);
  loadPuzzle();
}
function exitSession() {
  Mascot.clearNote(true);
  session = null; if (board) { board.setInteractive(false); board.setPick(null); }
  setTab(currentTab === 'play' ? 'map' : currentTab);
}
function renderPips() {
  const el = $('#pips'); if (!el) return; el.textContent = '';
  session.puzzles.forEach((_, i) => {
    const r = session.results[i];
    el.append(h('span', { class: 'pip' + (r === 1 ? ' ok' : r === .5 ? ' half' : r === 0 ? ' ko' : i === session.i ? ' on' : '') }));
  });
}
function setStatus(kind, title, sub, color) {
  const el = $('#status'); el.className = 'status' + (kind ? ' ' + kind : ''); el.textContent = '';
  el.append(h('span', { class: 'who', title: colorName(color || 'w') }, miniPiece('k', null, color || 'w')), h('div', { class: 'msg' }, h('strong', null, title), sub ? h('span', null, sub) : null));
}
function setActions(...btns) { const el = $('#actions'); el.textContent = ''; el.append(...btns.filter(Boolean)); }

function loadPuzzle() {
  const p = session.puzzles[session.i];
  Mascot.clearNote(true);
  if (session.cheerNext) { session.cheerNext = false; const s0 = session; setTimeout(() => { if (session === s0 && st && st.p === p) Mascot.react('streak'); }, 1200); }
  st = { p, step: 0, mistakes: 0, hint: false, over: false, busy: false };
  markSeen(p);
  renderPips();
  game = new Chess(p.fen);
  board.setPick(null);
  if (p.type === 'threat') return loadThreat(p);
  if (p.personal) {
    st.solver = game.turn();
    board.flip(st.solver); board.setPosition(p.fen, { last: p.prev ? [p.prev.slice(0, 2), p.prev.slice(2, 4)] : null });
    setStatus('', `Juegan ${colorName(st.solver)}`, p.cls === 'miss'
      ? `Jugada ${p.moveNo} contra ${p.opp || 'tu rival'}. Tu rival acababa de equivocarse y no lo aprovechaste: encuentra cómo castigarlo.`
      : `Jugada ${p.moveNo} contra ${p.opp || 'tu rival'}. Aquí te equivocaste: encuentra una jugada mejor.`, st.solver);
    board.setInteractive(true);
    setActions(hintBtn());
    return;
  }
  st.solver = game.turn() === 'w' ? 'b' : 'w';
  board.flip(st.solver); board.setPosition(p.fen); board.setInteractive(false);
  setStatus('', `Juegan ${colorName(st.solver)}`, 'Mira la jugada de tu rival…', st.solver);
  setActions();
  setTimeout(() => {
    if (!session || st.p !== p) return;
    const m = game.move(uciObj(p.moves[0]));
    board.setPosition(game.fen(), { last: [m.from, m.to], animate: [m.from, m.to] });
    Sound.play(sfxForSan(m.san));
    st.step = 1; board.setInteractive(true);
    setStatus('', `Juegan ${colorName(st.solver)}`, 'Encuentra la mejor jugada.', st.solver);
    setActions(hintBtn(), themeTag());
  }, reduceMotion ? 250 : 700);
}
function themeTag() {
  if (session.hideTheme) return null;
  const t = [...new Set(st.p.themes.map(x => THEME_ES[x]).filter(Boolean))];
  return t.length ? h('span', { class: 'theme-tags', 'aria-label': 'Tema: ' + t.join(', ') }, t.map(x => h('span', { class: 'theme-tag' }, x))) : null;
}
function hintBtn() {
  return h('button', { class: 'btn', onclick: () => {
    if (st.over) return; st.hint = true;
    const spot = st.p.type === 'threat' && st.phase === 'spot';
    const target = st.p.personal ? st.p.best : st.p.type === 'threat' ? (spot ? st.p.threat : st.p.ok[0]) : st.p.moves[st.step];
    board.clearMarks(['hint']); board.mark(target.slice(0, 2), 'hint'); Sound.play('hint');
    setStatus('', 'Pista', spot ? 'La amenaza viene de esta pieza. ¿Qué puede capturar?' : 'Esta es la pieza que tienes que mover.', st.solver);
  } }, icon('i-bulb'), 'Pista');
}

// ---------- puzzles de defensa: 1) ver la amenaza, 2) defenderse
function loadThreat(p) {
  st.solver = game.turn() === 'w' ? 'b' : 'w'; st.phase = 'wait'; st.spotMiss = 0; st.defMiss = 0;
  board.flip(st.solver); board.setPosition(p.fen); board.setInteractive(false);
  setStatus('', `Juegan ${colorName(st.solver)}`, 'Mira la jugada de tu rival…', st.solver);
  setActions();
  setTimeout(() => {
    if (!session || st.p !== p) return;
    const m = game.move(uciObj(p.last));
    board.setPosition(game.fen(), { last: [m.from, m.to], animate: [m.from, m.to] });
    Sound.play(sfxForSan(m.san));
    const parts = game.fen().split(' '); parts[1] = parts[1] === 'w' ? 'b' : 'w'; parts[3] = '-';
    const ng = new Chess(parts.join(' ')); const tm = ng.move(uciObj(p.threat));
    st.threatSan = tm ? tm.san : p.threat; st.threatCap = tm ? tm.captured : null;
    st.threatMate = p.mate || ng.in_checkmate(); st.threatCheck = tm ? /[+#]/.test(tm.san) : false;
    const map = parseFen(game.fen()); st.kingSq = Object.keys(map).find(s => map[s] === st.solver + 'k');
    st.lastSan = m.san; st.phase = 'spot';
    board.setPick(sq => onPick(sq));
    setStatus('', '¿Qué amenaza tu rival?', `Jugó ${es(m.san)}. Toca tu pieza que está en peligro, o la pieza con la que te amenaza.`, st.solver);
    setActions(hintBtn(), themeTag());
  }, reduceMotion ? 250 : 700);
}
function threatWhat() {
  if (st.threatMate) return 'darte mate';
  if (st.threatCap) return `ganar tu ${PIECE_ES[st.threatCap]}`;
  return 'ganar material';
}
function onPick(sq) {
  if (!session || st.phase !== 'spot' || st.over) return;
  const t = st.p.threat, okSq = [t.slice(0, 2), t.slice(2, 4)];
  if (st.threatMate || st.threatCheck) okSq.push(st.kingSq);
  if (okSq.includes(sq)) return spotted(true);
  st.mistakes++; st.spotMiss++;
  board.shake(); board.mark(sq, 'bad'); setTimeout(() => board.clearMarks(['bad']), 650);
  Sound.play('wrong'); haptic(60);
  if (st.spotMiss >= 2) return spotted(false);
  setStatus('ko', 'No es eso', 'Fíjate en la pieza que se acaba de mover: ¿qué ataca ahora? ¿Y qué quedó destapado detrás de ella?', st.solver);
}
function spotted(found) {
  st.phase = 'defend'; board.setPick(null); board.clearMarks(['hint']);
  const t = st.p.threat;
  st.threatArrow = [{ from: t.slice(0, 2), to: t.slice(2, 4), color: 'var(--bad)' }];
  board.arrows(st.threatArrow);
  if (found) { Sound.play('correct'); board.mark(t.slice(2, 4), 'bad'); setTimeout(() => board.clearMarks(['bad']), 900); }
  setStatus(found ? 'ok' : 'ko', found ? '¡Eso es!' : 'Esta era la amenaza',
    `Tu rival amenaza ${es(st.threatSan)} para ${threatWhat()}. Ahora defiéndete: haz una jugada que lo evite.`, st.solver);
  board.setInteractive(true);
}
async function onThreatMove(from, to, promo, dragged) {
  if (st.phase !== 'defend') return;
  const p = st.p, before = game.fen();
  const mv = game.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
  const uci = from + to + (mv.promotion || '');
  board.setPosition(game.fen(), { last: [from, to], animate: dragged ? null : [from, to] });
  Sound.play(sfxForSan(mv.san));
  if (p.ok.includes(uci)) { board.mark(to, 'good'); return puzzleSolved(uci === p.ok[0] ? 'Era la mejor defensa.' : `La defensa del motor era ${es(sanOf(before, p.ok[0]))}.`); }
  const still = (() => { const g2 = new Chess(game.fen()); const r = g2.move(uciObj(p.threat)); return r ? r.san : null; })();
  game.undo();
  board.setInteractive(false);
  await sleep(reduceMotion ? 120 : 380);
  if (!session || st.p !== p) return;
  board.setPosition(before, { last: [p.last.slice(0, 2), p.last.slice(2, 4)] }); board.arrows(st.threatArrow);
  st.mistakes++; st.defMiss++;
  board.shake(); board.mark(from, 'bad'); board.mark(to, 'bad'); setTimeout(() => board.clearMarks(['bad']), 700);
  Sound.play('wrong'); haptic(70);
  if (st.defMiss >= 2) return failPuzzle();
  board.setInteractive(true);
  setStatus('ko', 'Eso no lo evita', (still ? `Tu rival seguiría con ${es(still)}. ` : 'Tu rival ganaría material de otra forma. ') + 'Mueve la pieza atacada, defiéndela, tapa la línea o captura al atacante.', st.solver);
}

async function onUserMove(from, to, promo, dragged) {
  if (!session || st.over || st.busy) return;
  if (st.p.type === 'threat') return onThreatMove(from, to, promo, dragged);
  const p = st.p; const before = game.fen();
  const mv = game.move({ from, to, promotion: promo || 'q' });
  if (!mv) return;
  const uci = from + to + (mv.promotion || '');
  if (p.personal) {
    board.setPosition(game.fen(), { last: [from, to], animate: dragged ? null : [from, to] });
    Sound.play(sfxForSan(mv.san));
    board.setInteractive(false);
    let good = uci === p.best;
    if (!good && uci !== p.played) {
      st.busy = true;
      setStatus('', 'Comprobando…', 'El motor está revisando tu jugada.', st.solver);
      try {
        await engine.init();
        const ev = await engine.analyze(game.fen(), 11);
        const mover = st.solver === 'w' ? 1 : -1;
        good = wp(mover * p.bestCp) - wp(mover * ev.cp) <= 6;
      } catch (e) { good = false; }
      st.busy = false;
    }
    if (!session || st.p !== p) return;
    if (good) return puzzleSolved(uci === p.best ? null : `También vale. El motor prefería ${es(sanOf(before, p.best))}.`);
    game.undo(); board.setPosition(before, { last: p.prev ? [p.prev.slice(0, 2), p.prev.slice(2, 4)] : null });
    return wrongMove(from, to);
  }
  const expected = p.moves[st.step];
  if (uci === expected || game.in_checkmate()) {
    board.setPosition(game.fen(), { last: [from, to], animate: dragged ? null : [from, to] });
    Sound.play(sfxForSan(mv.san)); board.mark(to, 'good');
    st.step++;
    if (st.step >= p.moves.length || game.in_checkmate()) return puzzleSolved();
    board.setInteractive(false);
    setStatus('ok', '¡Bien!', 'Sigue así…', st.solver);
    await sleep(reduceMotion ? 200 : 520);
    if (!session || st.p !== p) return;
    const r = game.move(uciObj(p.moves[st.step]));
    board.setPosition(game.fen(), { last: [r.from, r.to], animate: [r.from, r.to] });
    Sound.play(sfxForSan(r.san));
    st.step++; board.setInteractive(true);
    setStatus('', 'Tu turno otra vez', 'Remata la idea.', st.solver);
  } else {
    game.undo();
    board.setPosition(before, { last: board.last });
    wrongMove(from, to);
  }
}
function wrongMove(from, to) {
  st.mistakes++;
  board.shake(); board.mark(from, 'bad'); board.mark(to, 'bad');
  Sound.play('wrong'); haptic(70);
  setTimeout(() => board.clearMarks(['bad']), 700);
  if (st.mistakes === 1) {
    board.setInteractive(true);
    setStatus('ko', 'No es eso', 'Te queda un intento. Revisa jaques, capturas y amenazas.', st.solver);
  } else {
    failPuzzle();
  }
}
async function failPuzzle() {
  st.over = true; board.setInteractive(false); board.setPick(null);
  const p = st.p;
  setTimeout(() => { if (session && st && st.p === p) Mascot.react('puzzle-fail', { themes: p.themes || [] }); }, 1100);
  if (p.type === 'threat') {
    const best = p.ok[0];
    board.arrows([...(st.threatArrow || []), { from: best.slice(0, 2), to: best.slice(2, 4), color: 'var(--good)' }]);
    setStatus('ko', `Una defensa era ${es(sanOf(game.fen(), best))}`, `Tu rival amenazaba ${es(st.threatSan)} para ${threatWhat()}. Lo verás de nuevo en Repaso.`, st.solver);
  } else if (p.personal) {
    const san = es(sanOf(game.fen(), p.best));
    board.arrows([{ from: p.best.slice(0, 2), to: p.best.slice(2, 4), color: 'var(--good)' }]);
    setStatus('ko', `La mejor era ${san}`, `En la partida jugaste ${es(sanOf(p.fen, p.played))}. Volverá a salir en tu próxima práctica.`, st.solver);
  } else {
    setStatus('ko', 'Así se resolvía', 'Mira la solución completa.', st.solver);
    const sans = [];
    while (st.step < p.moves.length) {
      await sleep(reduceMotion ? 150 : 600);
      if (!session || st.p !== p) return;
      const m = game.move(uciObj(p.moves[st.step]));
      if (st.step % 2 === 1) sans.push(es(m.san));
      board.setPosition(game.fen(), { last: [m.from, m.to], animate: [m.from, m.to] });
      Sound.play(sfxForSan(m.san));
      st.step++;
    }
    setStatus('ko', 'Así se resolvía', `Solución: ${sans.join(', ')}. Lo verás de nuevo en Repaso.`, st.solver);
  }
  record(0);
  setActions(nextBtn());
}
function puzzleSolved(extra) {
  st.over = true; board.setInteractive(false);
  const clean = st.mistakes === 0 && !st.hint;
  const sc = clean ? 1 : .5;
  const p = st.p;
  let sub = clean ? 'Resuelto a la primera.' : 'Resuelto con ayuda: cuenta como medio punto.';
  if (p.personal) sub = (extra ? extra + ' ' : '') + `En tu partida jugaste ${es(sanOf(p.fen, p.played))}.`;
  else if (p.type === 'threat') sub = (clean ? 'Viste la amenaza y te defendiste. ' : 'Resuelto con ayuda: cuenta como medio punto. ') + (extra || '');
  else if (session.hideTheme) sub += ' Tema: ' + p.themes.map(x => THEME_ES[x]).filter(Boolean).join(', ') + '.';
  setStatus('ok', clean ? '¡Correcto!' : 'Resuelto', sub, st.solver);
  if (board.last) board.mark(board.last[1], 'good');
  Sound.play('correct', 0.12); haptic(18);
  record(sc);
  setActions(nextBtn());
  if (clean && !p.personal && !reduceMotion) setTimeout(() => { if (session && st.p === p && st.over) nextPuzzle(); }, p.type === 'threat' ? 2400 : 1500);
}
function nextBtn() {
  const last = session.i >= session.puzzles.length - 1;
  return h('button', { class: 'btn primary', onclick: () => nextPuzzle() }, last ? 'Ver resultado' : 'Siguiente');
}
function nextPuzzle() {
  if (!session || !st.over) return;
  if (session.i >= session.puzzles.length - 1) return finishSession();
  session.i++; loadPuzzle();
}
function record(sc) {
  const p = st.p;
  session.results[session.i] = sc;
  if (!p.personal) {
    // Elo con K bajo. Con pista o con un error cuenta como fallo para el rating.
    // Puzzles repetidos o de repaso no mueven el rating (no se puede subir memorizando).
    const K = S.ratingN < 20 ? 24 : 12;
    const exp = 1 / (1 + Math.pow(10, (p.rating - S.rating) / 400));
    const wgt = session.kind === 'review' || st.seenBefore ? 0 : 1;
    if (wgt) { S.rating = clamp(S.rating + K * ((sc === 1 ? 1 : 0) - exp), 100, 3000); S.ratingN++; }
    for (const t of p.themes) { const ts = S.themeStats[t] || [0, 0]; ts[0] += sc; ts[1] += 1; S.themeStats[t] = ts; }
    if (sc < 1 && !S.review.includes(p.id)) S.review.push(p.id);
    if (sc === 1 && session.kind === 'review') S.review = S.review.filter(id => id !== p.id);
    if (S.review.length > 60) S.review = S.review.slice(-60);
  } else {
    const m = S.mine.find(x => x.id === p.id);
    if (m) { m.seen = (m.seen || 0) + 1; if (sc === 1) { m.wins = (m.wins || 0) + 1; if (m.wins >= 2) m.mastered = true; } else m.wins = 0; }
  }
  if (sc > 0) { S.solved++; touchStreak(); }
  // tres seguidos sin ayuda: Karen festeja (una vez por sesión)
  session.run = sc === 1 ? (session.run || 0) + 1 : 0;
  if (session.run === 3 && !session.cheered && session.i < session.puzzles.length - 1) { session.cheered = true; session.cheerNext = true; }
  if (session.kind === 'daily') {
    S.daily[session.date] = { n: dailyNumber(session.date), res: session.results.slice(0, session.i + 1), ms: session.msBefore + (Date.now() - session.t0), done: false };
    const keys = Object.keys(S.daily).sort(); while (keys.length > 60) delete S.daily[keys.shift()];
  }
  save(); renderPips();
}
// 3 estrellas: 5 de 5 sin ayuda. 2: 4.5 puntos. 1 (pasar): 4 puntos. Con ayuda un puzzle vale 0.5.
function starsFor(pts) { return pts >= 5 ? 3 : pts >= 4.5 ? 2 : pts >= 4 ? 1 : 0; }
function finishSession() {
  const pts = session.results.reduce((a, b) => a + (b || 0), 0);
  const n = session.puzzles.length;
  let stars = 0, passed = true, headline = '', note = '';
  if (session.kind === 'level' || session.kind === 'skip') {
    stars = starsFor(pts);
    if (session.kind === 'skip') {
      passed = pts >= 4.5;
      if (passed) { levelsOf(session.worldKey).forEach((_, i) => { const k = session.worldKey + '-' + i; S.levels[k] = Math.max(S.levels[k] || 0, 1); }); headline = '¡Mundo superado!'; note = 'Desbloqueaste el siguiente mundo. Puedes volver por las 3 estrellas cuando quieras.'; }
      else { loseLife(); headline = 'Todavía no'; note = 'Para saltar el mundo necesitas 4.5 puntos. Juega sus niveles: ahí se aprende el patrón.'; stars = 0; }
    } else {
      passed = stars > 0;
      const k = session.worldKey + '-' + session.levelIdx;
      if (passed) { S.levels[k] = Math.max(S.levels[k] || 0, stars); headline = stars === 3 ? '¡Perfecto!' : '¡Nivel superado!'; note = stars === 3 ? 'Cinco de cinco sin ayuda.' : 'Para 3 estrellas necesitas 5 de 5 sin pistas ni errores. Si repites, te tocan puzzles nuevos.'; }
      else { loseLife(); headline = 'Casi'; note = 'Para pasar necesitas 4 puntos (cada puzzle sin ayuda vale 1, con ayuda 0.5). Perdiste una vida. Al repetir te tocan puzzles nuevos.'; }
    }
  } else if (session.kind === 'daily') {
    const rec = S.daily[session.date]; rec.done = true;
    headline = pts >= 5 ? '¡Reto perfecto!' : `Reto #${rec.n} completado`;
    note = 'Comparte tu resultado y vuelve mañana por un reto nuevo.';
    stars = starsFor(pts);
  } else {
    headline = session.kind === 'mine' ? 'Práctica terminada' : 'Repaso terminado';
    note = session.kind === 'mine' ? 'Cada error que resuelves dos veces seguidas sale de tu lista.' : 'Los puzzles que resolviste a la primera salen del repaso.';
    stars = starsFor(pts);
  }
  S.ratingHist.push([Date.now(), Math.round(S.rating)]); if (S.ratingHist.length > 200) S.ratingHist = S.ratingHist.slice(-200);
  save();
  const delta = Math.round(S.rating - session.ratingStart);
  const rankBefore = Math.max(session.rankStart || 0, S.rankMax || 0), rankNow = rankEligible(), rankUp = rankNow > rankBefore;
  const rp0 = session.rankProgress0 || rankProgress();
  if (rankUp) { S.rankMax = rankNow; save(); }
  const rp = rankProgress();
  const root = $('#view-play'); root.textContent = '';
  const starRow = h('div', { class: 'big-stars', 'aria-label': `${stars} de 3 estrellas` });
  for (let i = 0; i < 3; i++) starRow.append(icon('i-star', i < stars ? 'on' : 'off'));
  const btns = h('div', { class: 'stack' });
  const shareHost = h('div', { class: 'share-host' });
  const s0 = session;
  if (s0.kind === 'level') {
    const lvCount = levelsOf(s0.worldKey).length;
    const ws = worldState();
    if (passed) {
      let nk = s0.worldKey, ni = s0.levelIdx + 1;
      if (ni >= lvCount) { const wi = WORLDS.indexOf(s0.worldKey); nk = WORLDS[wi + 1]; ni = 0; }
      const nextW = ws.find(w => w.key === nk);
      if (nk && nextW && nextW.unlocked) btns.append(h('button', { class: 'btn primary', onclick: () => startLevel(nk, ni) }, nk === s0.worldKey ? `Siguiente nivel` : `Empezar ${WORLD_META[nk].name}`));
    }
    btns.append(h('button', { class: 'btn', onclick: () => startLevel(s0.worldKey, s0.levelIdx) }, 'Repetir nivel'));
  } else if (s0.kind === 'daily') {
    btns.append(h('button', { class: 'btn primary', onclick: () => shareResult(s0.date, shareHost) }, 'Compartir resultado'), shareHost);
  } else if (s0.kind === 'mine' && S.mine.some(m => !m.mastered)) {
    btns.append(h('button', { class: 'btn primary', onclick: () => startMine() }, 'Otra ronda'));
  } else if (s0.kind === 'review' && S.review.length) {
    btns.append(h('button', { class: 'btn primary', onclick: () => startReview() }, 'Seguir repasando'));
  }
  btns.append(h('button', { class: 'btn', onclick: () => exitSession() }, 'Volver al mapa'));
  root.append(h('div', { class: 'result' },
    h('div', { class: 'section-title' }, s0.kind === 'level' ? `${s0.title}, nivel ${s0.levelIdx + 1}` : s0.kicker), starRow, h('h2', null, headline), h('p', { class: 'muted' }, note),
    h('div', { class: 'stat-grid' },
      h('div', { class: 'card' }, h('div', { class: 'v' }, `${pts}/${n}`), h('div', { class: 'l' }, 'Puntos')),
      h('div', { class: 'card' }, h('div', { class: 'v', id: 'rating-delta', style: { color: delta > 0 ? 'var(--good)' : delta < 0 ? 'var(--bad)' : 'var(--ink)' } }, delta ? (delta > 0 ? '+' : '') + delta : '0'), h('div', { class: 'l' }, 'Rating táctico')),
      s0.kind === 'daily'
        ? h('div', { class: 'card' }, h('div', { class: 'v' }, fmtClock(S.daily[s0.date].ms || 0)), h('div', { class: 'l' }, 'Tiempo'))
        : h('div', { class: 'card' }, h('div', { class: 'v' }, String(S.lives)), h('div', { class: 'l' }, 'Vidas'))),
    s0.kind === 'daily' ? h('div', { class: 'daily-sq big', 'aria-label': 'Resultado: ' + s0.results.map(r => r === 1 ? 'bien' : r === .5 ? 'con ayuda' : 'fallado').join(', ') }, s0.results.map(r => h('span', { class: resClass(r) }))) : null,
    h('div', { class: 'rank-line' }, miniPiece(rp.R.p),
      h('div', { class: 'track' }, h('div', { class: 'fill', id: 'rank-fill', style: { width: (rankUp ? 0 : rp0.pct) + '%' } })),
      h('span', null, rankNeedsText(rp))),
    btns));
  requestAnimationFrame(() => requestAnimationFrame(() => { const f = $('#rank-fill'); if (f) f.style.width = rp.pct + '%'; }));
  if (rankUp) setTimeout(() => showAscension(rankNow), 1100);
  else setTimeout(() => {
    if (session || Music.view !== 'play' || !$('#view-play .result')) return; // ya salió de la pantalla de resultado
    if (s0.kind === 'daily') Mascot.react('daily-done', { perfect: pts >= 5 });
    else if (s0.kind === 'level' || s0.kind === 'skip') Mascot.react(!passed ? (S.lives === 0 ? 'no-lives' : 'level-fail') : stars === 3 ? 'level-perfect' : 'level-pass');
  }, 1700);
  if (delta) countUp($('#rating-delta'), delta, v => (delta > 0 ? '+' : '−') + Math.abs(v));
  if (stars > 0 && passed) {
    for (let i = 0; i < stars; i++) Sound.play('star', 0.08 + i * 0.15, i);
    if (stars === 3 || (s0.kind === 'skip' && passed)) { setTimeout(() => celebrate(['--brass', '--sq-light', '--sq-dark', s0.worldKey ? WORLD_META[s0.worldKey].color.slice(4, -1) : '--good']), 420); Sound.play('brilliant', 0.55); }
  } else if (s0.kind === 'level' || s0.kind === 'skip') Sound.play('lose', 0.1);
  else Sound.play('done', 0.1);
  session = null;
  renderChips();
}

// ---------------------------------------------------------------- analizador
let AZ = { view: 'home', list: [], fetchErr: null, loading: false, analysis: null, idx: 0, running: null, pasteColor: 'auto' };
const DEPTHS = [[12, 'Rápido'], [16, 'Normal'], [18, 'Profundo']];

// Clasificación de jugadas (estilo Chess.com, umbrales en % de probabilidad de ganar)
const CLS = {
  brilliant: { sym: '!!', name: 'Brillante', color: 'var(--c-brill)' },
  great: { sym: '!', name: 'Gran jugada', color: 'var(--c-great)' },
  best: { sym: '★', name: 'Mejor', color: 'var(--c-best)' },
  excellent: { sym: '✓', name: 'Excelente', color: 'var(--c-excellent)' },
  good: { sym: '✓', name: 'Buena', color: 'var(--c-good)' },
  book: { sym: '▤', name: 'Libro', color: 'var(--c-book)' },
  forced: { sym: '→', name: 'Forzada', color: 'var(--muted)' },
  inaccuracy: { sym: '?!', name: 'Imprecisión', color: 'var(--c-inacc)' },
  mistake: { sym: '?', name: 'Error', color: 'var(--c-mistake)' },
  miss: { sym: '✕', name: 'Oportunidad perdida', color: 'var(--c-miss)' },
  blunder: { sym: '??', name: 'Error grave', color: 'var(--c-blunder)' },
};
const CLS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const TRAIN = new Set(['mistake', 'miss', 'blunder']);
const SHINE = new Set(['brilliant', 'great']);
const MARKED = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);
const CAT_ES = { hanging: 'Dejaste una pieza sin defensa', mate_allowed: 'Permitiste un mate', mate_missed: 'No viste un mate', missed_tactic: 'Se te pasó una táctica', allowed_tactic: 'Le diste una táctica a tu rival', plan: 'Había una jugada mejor' };

// libro de aperturas (lichess-org/chess-openings, CC0), cargado cuando hace falta
let OPENINGS = null, openingsP = null;
const posKey = fen => hash(fen.split(' ').slice(0, 3).join(' '));
function loadOpenings() {
  if (!openingsP) openingsP = (async () => {
    try {
      const r = await fetch('data/openings.json'); if (!r.ok) return null; const d = await r.json();
      let book;
      if (d.keys) { book = new Set(); for (let i = 0; i < d.keys.length; i += 7) book.add(d.keys.slice(i, i + 7).replace(/^0+(?=.)/, '')); }
      else book = new Set(d.book);
      OPENINGS = { book, names: d.names }; return OPENINGS;
    }
    catch (e) { return null; }
  })();
  return openingsP;
}

// casillas desde las que `color` ataca `sq` (sin tener en cuenta clavadas)
function attackers(map, sq, color) {
  const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1, out = [];
  const at = (ff, rr) => (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) ? 'abcdefgh'[ff] + (rr + 1) : null;
  const pawnDir = color === 'w' ? -1 : 1;
  for (const df of [-1, 1]) { const s = at(f + df, r + pawnDir); if (s && map[s] === color + 'p') out.push(s); }
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) { const s = at(f + df, r + dr); if (s && map[s] === color + 'n') out.push(s); }
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) { if (!df && !dr) continue; const s = at(f + df, r + dr); if (s && map[s] === color + 'k') out.push(s); }
  for (const [df, dr, kinds] of [[1, 0, 'rq'], [-1, 0, 'rq'], [0, 1, 'rq'], [0, -1, 'rq'], [1, 1, 'bq'], [1, -1, 'bq'], [-1, 1, 'bq'], [-1, -1, 'bq']]) {
    let ff = f + df, rr = r + dr;
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
      const s = 'abcdefgh'[ff] + (rr + 1), p = map[s];
      if (p) { if (p[0] === color && kinds.includes(p[1])) out.push(s); break; }
      ff += df; rr += dr;
    }
  }
  return out;
}
// material que se puede perder en `sq` de inmediato
function enPriseLoss(map, sq) {
  const p = map[sq]; if (!p || p[1] === 'k') return 0;
  const me = p[0], opp = me === 'w' ? 'b' : 'w', v = VAL[p[1]];
  let atk = attackers(map, sq, opp); if (!atk.length) return 0;
  const def = attackers(map, sq, me);
  if (def.length) atk = atk.filter(s => map[s][1] !== 'k');
  if (!atk.length) return 0;
  if (!def.length) return v;
  const minAtk = Math.min(...atk.map(s => VAL[map[s][1]]));
  return Math.max(0, v - minAtk);
}
function isSacrifice(A, i, color) {
  const mb = parseFen(A.fens[i]), ma = parseFen(A.fens[i + 1]); const u = A.ucis[i];
  const captured = mb[u.slice(2, 4)] ? VAL[mb[u.slice(2, 4)][1]] : 0;
  let risk = 0;
  for (const [sq, p] of Object.entries(ma)) {
    if (p[0] !== color || p[1] === 'p' || p[1] === 'k') continue;
    const after = enPriseLoss(ma, sq);
    const before = sq === u.slice(2, 4) ? 0 : (mb[sq] === p ? enPriseLoss(mb, sq) : 0);
    risk = Math.max(risk, after - before);
  }
  return risk - captured >= 1;
}
function isTrivialOnlyMove(A, i, prevErr) {
  const u = A.ucis[i], g = new Chess(A.fens[i]);
  if (g.in_check()) return true;
  if (i > 0) { const pu = A.ucis[i - 1]; const pm = parseFen(A.fens[i - 1]); if (pm[pu.slice(2, 4)] && pu.slice(2, 4) === u.slice(2, 4)) return true; } // recaptura
  const mb = parseFen(A.fens[i]); if (enPriseLoss(mb, u.slice(0, 2)) >= 2 && !mb[u.slice(2, 4)]) return true; // salvar una pieza atacada
  // capturar una pieza que ya colgaba es trivial, salvo que castigue un error del rival (Chess.com lo marca como "!")
  if (!prevErr && mb[u.slice(2, 4)] && enPriseLoss(mb, u.slice(2, 4)) >= 2) return true;
  return false;
}

function renderAnalyze() {
  const root = $('#view-analyze'); root.textContent = '';
  $('#app').classList.toggle('wide', AZ.view === 'analysis' && !!AZ.analysis && !!AZ.analysis.done);
  if (AZ.view === 'analysis' && AZ.analysis) return renderAnalysis(root);
  if (AZ.view === 'list') return renderGameList(root);
  // formulario
  const set = S.settings;
  const openSample = () => { const sg = JSON.parse($('#sample-game').textContent); openGame(Object.assign({ id: 'sample', label: 'Partida de ejemplo' }, sg)); };
  root.append(h('h2', { style: { fontSize: '28px', fontWeight: 800, marginBottom: '6px' } }, 'Analiza tus partidas'),
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'Stockfish revisa cada jugada en tu navegador, la clasifica (de brillante a error grave) y convierte tus errores en puzzles para practicar.'),
    h('div', { class: 'row', style: { marginBottom: '16px' } }, h('button', { class: 'btn small', onclick: openSample }, 'Ver un análisis de ejemplo'), h('span', { class: 'muted', style: { fontSize: '14px' } }, 'Una partida simulada de nivel 650.')));
  const plat = h('div', { class: 'seg', role: 'group', 'aria-label': 'Plataforma' });
  for (const [k, label] of [['chesscom', 'Chess.com'], ['lichess', 'Lichess']]) plat.append(h('button', { type: 'button', 'aria-pressed': set.platform === k ? 'true' : 'false', onclick: () => { set.platform = k; save(); renderAnalyze(); } }, label));
  const user = h('input', { type: 'text', id: 'az-user', value: set.user, placeholder: 'Tu usuario', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const form = h('form', { class: 'card stack', onsubmit: e => { e.preventDefault(); fetchGames(user.value.trim()); } },
    h('div', { class: 'row' }, plat),
    h('label', { class: 'field', for: 'az-user' }, 'Usuario', user),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', disabled: AZ.loading ? true : null }, AZ.loading ? 'Buscando…' : 'Buscar mis partidas')),
    AZ.fetchErr ? h('div', { class: 'notice bad' }, AZ.fetchErr) : null);
  root.append(form);

  // PGN
  const ta = h('textarea', { id: 'az-pgn', placeholder: '[Event "Live Chess"]\n1. e4 e5 2. Nf3 …', 'aria-label': 'PGN de la partida' });
  const col = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tu color' });
  for (const [k, label] of [['auto', 'Detectar'], ['w', 'Blancas'], ['b', 'Negras']]) col.append(h('button', { type: 'button', 'aria-pressed': AZ.pasteColor === k ? 'true' : 'false', onclick: () => { AZ.pasteColor = k; $$('button', col).forEach(b => b.setAttribute('aria-pressed', b.textContent === label ? 'true' : 'false')); } }, label));
  const fileLbl = h('label', { class: 'btn small', for: 'az-file' }, 'Subir archivo .pgn');
  const fileIn = h('input', { type: 'file', accept: '.pgn,text/plain', id: 'az-file', class: 'visually-hidden', onchange: async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 1e6) { toast('Ese archivo pesa demasiado para ser un PGN.'); e.target.value = ''; return; } ta.value = await f.text(); fileLbl.textContent = f.name; } });
  root.append(h('p', { class: 'section-title', style: { marginTop: '24px' } }, 'O pega el PGN'),
    h('div', { class: 'card stack' },
      h('div', { class: 'muted', style: { fontSize: '14px' } }, 'En Chess.com: abre la partida → Compartir → PGN → Copiar. En Lichess: Compartir y exportar → PGN.'),
      ta, h('div', { class: 'row' }, fileIn, fileLbl),
      h('div', { class: 'row' }, h('span', { style: { fontWeight: 700, fontSize: '14px' } }, 'Jugaste con'), col),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => analyzePasted(ta.value) }, 'Analizar PGN'))));

  // profundidad
  const dseg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Profundidad del análisis' });
  for (const [d, label] of DEPTHS) dseg.append(h('button', { type: 'button', 'aria-pressed': set.depth === d ? 'true' : 'false', onclick: () => { set.depth = d; save(); renderAnalyze(); } }, label));
  root.append(h('p', { class: 'section-title', style: { marginTop: '24px' } }, 'Profundidad del motor'),
    h('div', { class: 'row' }, dseg, h('span', { class: 'muted', style: { fontSize: '14px' } },
      set.depth >= 18 ? 'El más preciso. Puede tardar varios minutos en el celular.' : set.depth <= 12 ? 'Rápido, pero se le escapan algunos errores.' : 'Recomendado: casi igual de preciso que Stockfish completo.')));

  // historial
  const hist = S.games.filter(g => g.v === 2);
  if (hist.length) {
    root.append(h('p', { class: 'section-title', style: { marginTop: '24px' } }, 'Partidas analizadas'));
    const box = h('div', { class: 'games' });
    for (const g of hist.slice().reverse()) {
      const c = g.counts[g.userColor] || {};
      box.append(gameRow(g, () => { AZ.analysis = hydrate(g); AZ.idx = 0; AZ.view = 'analysis'; renderAnalyze(); }, `Precisión ${g.accuracy}% · ${c.blunder || 0} graves · ${c.mistake || 0} errores${c.brilliant ? ' · ' + c.brilliant + ' brillante' + (c.brilliant > 1 ? 's' : '') : ''}`));
    }
    root.append(box);
  }
}
function gameRow(g, onOpen, metaText) {
  const res = g.userResult || 'draw';
  return h('div', { class: 'card game' },
    h('span', { class: 'res ' + res, 'aria-hidden': 'true' }),
    h('div', { class: 'info' },
      h('div', { class: 'vs' }, `vs ${g.opp || '?'}${g.oppRating ? ' (' + g.oppRating + ')' : ''}`),
      h('div', { class: 'meta' }, metaText || [g.userResult === 'win' ? 'Ganaste' : g.userResult === 'loss' ? 'Perdiste' : 'Tablas', g.timeClass, g.date].filter(Boolean).join(' · '))),
    h('button', { class: 'btn small', onclick: onOpen }, metaText ? 'Ver' : 'Analizar'));
}
const USER_RE = /^[A-Za-z0-9_-]{2,30}$/; // usuarios de Chess.com y Lichess
async function fetchGames(user) {
  user = (user || '').trim();
  if (!user) { AZ.fetchErr = 'Escribe tu usuario.'; return renderAnalyze(); }
  if (!USER_RE.test(user)) { AZ.fetchErr = 'Ese usuario no es válido: solo letras, números, guion y guion bajo.'; return renderAnalyze(); }
  S.settings.user = user; save();
  AZ.loading = true; AZ.fetchErr = null; renderAnalyze();
  try {
    AZ.list = S.settings.platform === 'lichess' ? await fetchLichess(user) : await fetchChessCom(user);
    if (!AZ.list.length) throw userErr('No encontramos partidas recientes de ajedrez estándar para ese usuario.');
    AZ.view = 'list';
  } catch (e) {
    AZ.fetchErr = e && e.userMsg ? e.userMsg : (e instanceof TypeError ? 'No se pudo conectar con ' + (S.settings.platform === 'lichess' ? 'Lichess' : 'Chess.com') + '. Revisa tu internet o pega el PGN abajo.' : (e.message || 'Algo falló al buscar tus partidas.'));
  }
  AZ.loading = false; renderAnalyze();
}
function userErr(msg) { const e = new Error(msg); e.userMsg = msg; return e; }
async function fetchChessCom(user) {
  const u = user.toLowerCase();
  const a = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  if (a.status === 404) throw userErr(`No existe el usuario "${user}" en Chess.com.`);
  if (!a.ok) throw userErr('Chess.com no respondió. Intenta de nuevo en un momento.');
  const { archives = [] } = await a.json();
  const out = [];
  // solo se siguen direcciones de la API de Chess.com
  for (const url of archives.filter(x => typeof x === 'string' && x.startsWith('https://api.chess.com/pub/player/')).slice(-3).reverse()) {
    const r = await fetch(url); if (!r.ok) continue;
    const j = await r.json();
    for (const g of (j.games || []).slice().reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      const white = g.white.username.toLowerCase() === u;
      const me = white ? g.white : g.black, op = white ? g.black : g.white;
      out.push({ id: g.url || hash(g.pgn), pgn: g.pgn, userColor: white ? 'w' : 'b', opp: op.username, oppRating: op.rating, userRating: me.rating,
        userResult: me.result === 'win' ? 'win' : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(me.result) ? 'draw' : 'loss',
        timeClass: { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', daily: 'Diaria' }[g.time_class] || g.time_class,
        date: g.end_time ? new Date(g.end_time * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '' });
      if (out.length >= 25) return out;
    }
  }
  return out;
}
async function fetchLichess(user) {
  const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=25&pgnInJson=true&opening=true`, { headers: { Accept: 'application/x-ndjson' } });
  if (r.status === 404) throw userErr(`No existe el usuario "${user}" en Lichess.`);
  if (!r.ok) throw userErr('Lichess no respondió. Intenta de nuevo en un momento.');
  const text = await r.text(); const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g; try { g = JSON.parse(line); } catch (e) { continue; }
    if (g.variant !== 'standard' || !g.pgn) continue;
    const wn = (g.players.white.user && g.players.white.user.name || '').toLowerCase();
    const white = wn === user.toLowerCase(); const me = white ? g.players.white : g.players.black, op = white ? g.players.black : g.players.white;
    out.push({ id: 'li-' + g.id, pgn: g.pgn, userColor: white ? 'w' : 'b', opp: op.user ? op.user.name : (op.aiLevel ? 'Stockfish nivel ' + op.aiLevel : 'Anónimo'), oppRating: op.rating, userRating: me.rating,
      userResult: !g.winner ? 'draw' : (g.winner === (white ? 'white' : 'black') ? 'win' : 'loss'),
      timeClass: { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', classical: 'Clásica', correspondence: 'Correspondencia', ultraBullet: 'UltraBullet' }[g.speed] || g.speed,
      date: new Date(g.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) });
  }
  return out;
}
function renderGameList(root) {
  root.append(h('div', { class: 'play-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => { AZ.view = 'home'; renderAnalyze(); } }, icon('i-close')),
    h('div', { class: 't' }, h('div', { class: 'k' }, S.settings.platform === 'lichess' ? 'Lichess' : 'Chess.com'), h('h2', null, 'Partidas de ' + S.settings.user))));
  root.append(h('p', { class: 'muted', style: { marginTop: 0 } }, 'Empieza por una derrota: ahí están los errores que más puntos te cuestan.'));
  const box = h('div', { class: 'games' });
  for (const g of AZ.list) box.append(gameRow(g, () => openGame(g)));
  root.append(box);
}
const PGN_MAX = 200000;
function analyzePasted(pgn) {
  pgn = (pgn || '').trim();
  if (pgn.length > PGN_MAX) { toast('Ese PGN es demasiado largo. Pega una sola partida.'); return; }
  const c = new Chess();
  if (!pgn || !c.load_pgn(pgn, { sloppy: true }) || !c.history().length) { toast('No pude leer ese PGN. Revisa que esté completo.'); return; }
  const hd = c.header();
  let color = AZ.pasteColor;
  const u = (S.settings.user || '').toLowerCase();
  if (color === 'auto') color = u && (hd.Black || '').toLowerCase() === u ? 'b' : 'w';
  const opp = color === 'w' ? hd.Black : hd.White;
  const res = hd.Result === '1/2-1/2' ? 'draw' : hd.Result === '1-0' ? (color === 'w' ? 'win' : 'loss') : hd.Result === '0-1' ? (color === 'b' ? 'win' : 'loss') : 'draw';
  openGame({ id: 'pgn-' + hash(pgn), pgn, userColor: color, opp: opp || 'Rival', oppRating: color === 'w' ? hd.BlackElo : hd.WhiteElo, userResult: res, date: hd.Date && hd.Date !== '????.??.??' ? hd.Date : '' });
}
// reconstruye jugadas y posiciones a partir del PGN
function hydrate(G) {
  const c = new Chess();
  if (!c.load_pgn(G.pgn, { sloppy: true })) return null;
  const hd = c.header(); const hist = c.history({ verbose: true });
  const start = new Chess(hd.FEN || undefined);
  const fens = [start.fen()], ucis = [], sans = [];
  for (const m of hist) { start.move(m); fens.push(start.fen()); ucis.push(m.from + m.to + (m.promotion || '')); sans.push(m.san); }
  return Object.assign({}, G, { fens, ucis, sans });
}
const stripComments = pgn => pgn.replace(/\{[^}]*\}/g, '').replace(/\$\d+/g, '').replace(/[ \t]+/g, ' ');
async function openGame(g) {
  const prev = S.games.find(x => x.v === 2 && x.id === g.id && x.depth >= S.settings.depth);
  if (prev) { AZ.analysis = hydrate(prev); AZ.idx = 0; AZ.view = 'analysis'; return renderAnalyze(); }
  const base = hydrate({ v: 2, id: g.id, pgn: stripComments(g.pgn), userColor: g.userColor, opp: g.opp, oppRating: g.oppRating, userResult: g.userResult, timeClass: g.timeClass, date: g.date, depth: S.settings.depth });
  if (!base || !base.ucis.length) { toast('No pude leer esa partida.'); return; }
  const A = Object.assign(base, { cps: [], best: [], cps2: [], done: false });
  AZ.analysis = A; AZ.idx = 0; AZ.view = 'analysis';
  const token = {}; AZ.running = token;
  renderAnalyze();
  loadOpenings();
  try { await engine.init(); }
  catch (e) { AZ.running = null; A.error = 'No se pudo iniciar Stockfish en este navegador. Prueba con Chrome, Edge, Firefox o Safari actualizados.'; return renderAnalyze(); }
  const t0 = Date.now();
  for (let i = 0; i < A.fens.length; i++) {
    if (AZ.running !== token) return;
    const ev = await engine.analyze(A.fens[i], A.depth, 2);
    A.cps[i] = Math.round(ev.cp); A.best[i] = ev.best; A.cps2[i] = ev.cp2 == null ? null : Math.round(ev.cp2);
    updateProgress(i + 1, A.fens.length, Date.now() - t0);
  }
  await loadOpenings();
  if (AZ.running !== token) return;
  AZ.running = null;
  const mine0 = S.mine.length;
  finalizeAnalysis(A);
  Sound.play('done');
  if (A.id !== 'sample') setTimeout(() => { if (AZ.analysis === A) Mascot.react('analysis', { n: Math.max(0, S.mine.length - mine0) }); }, 900);
  renderAnalyze();
}
function updateProgress(done, total, ms) {
  const bar = $('#az-progress'); const txt = $('#az-progress-txt');
  if (bar) bar.style.width = (100 * done / total) + '%';
  if (txt) {
    const left = done > 3 ? Math.round((ms / done) * (total - done) / 1000) : null;
    txt.textContent = `Analizando posición ${done} de ${total}…` + (left != null ? ` Faltan unos ${left < 60 ? left + ' s' : Math.ceil(left / 60) + ' min'}.` : '');
  }
}
function finalizeAnalysis(A) {
  const n = A.ucis.length; A.cls = []; A.cats = [];
  const accs = [];
  let inBook = !!OPENINGS; A.opening = null;
  for (let i = 0; i < n; i++) {
    const color = A.fens[i].split(' ')[1]; const sgn = color === 'w' ? 1 : -1;
    const wb = wp(sgn * A.cps[i]), wa = wp(sgn * A.cps[i + 1]);
    const isBest = A.ucis[i] === A.best[i];
    const prevErr = i > 0 && ['mistake', 'blunder', 'miss'].includes(A.cls[i - 1]);
    const drop = isBest ? 0 : Math.max(0, wb - wa);
    accs[i] = clamp(103.1668100711649 * Math.exp(-0.04354415386753951 * drop) - 3.166924740191411 + 1, 0, 100);
    let c = null;
    if (inBook) {
      const k = posKey(A.fens[i + 1]);
      if (OPENINGS.book.has(k)) { c = 'book'; if (OPENINGS.names[k]) A.opening = OPENINGS.names[k]; } else inBook = false;
    }
    if (!c) {
      if (new Chess(A.fens[i]).moves().length === 1) c = 'forced';
      else if (drop >= 20) c = 'blunder';
      else if (drop >= 10) c = 'mistake';
      else if (drop >= 5) c = 'inaccuracy';
      // Oportunidad perdida: no aprovechaste el error del rival, pero quedaste más o menos como antes de ese error.
      // Si además empeoraste la posición, cuenta como error o error grave (igual que Chess.com).
      if (c && c !== 'forced' && drop >= 10 && prevErr && wb >= 60 && wa >= wp(sgn * A.cps[i - 1]) - 5) c = 'miss';
      if (!c) {
        if ((isBest || drop <= 2) && wa >= 50 && wb <= 97 && isSacrifice(A, i, color)) c = 'brilliant';
        else if (isBest && A.cps2[i] != null && wb - wp(sgn * A.cps2[i]) >= 15 && wb > 8 && wb <= 92 && !isTrivialOnlyMove(A, i, prevErr)) c = 'great';
        else if (isBest || drop <= 1) c = 'best';
        else if (drop < 2.5) c = 'excellent';
        else c = 'good';
      }
    }
    A.cls[i] = c;
    A.cats[i] = TRAIN.has(c) ? categorize(A, i, color) : null;
  }
  // Precisión como la calcula Lichess: media ponderada por volatilidad + media armónica
  const wps = A.cps.map(cp => wp(cp));
  const win = clamp(Math.floor(wps.length / 10), 2, 8);
  const windows = [];
  for (let k = 0; k < win - 2; k++) windows.push(wps.slice(0, win));
  for (let k = 0; k + win <= wps.length; k++) windows.push(wps.slice(k, k + win));
  const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length); };
  const weights = windows.map(xs => clamp(sd(xs), .5, 12));
  const gameAcc = color => {
    const idx = []; for (let i = 0; i < n; i++) if (A.fens[i].split(' ')[1] === color) idx.push(i);
    if (!idx.length) return 0;
    let ws = 0, wsum = 0; for (const i of idx) { const wgt = weights[i] || 1; ws += accs[i] * wgt; wsum += wgt; }
    const harm = idx.length / idx.reduce((a, i) => a + 1 / Math.max(accs[i], 1), 0);
    return Math.round((ws / wsum + harm) / 2);
  };
  A.accuracy = gameAcc(A.userColor); A.oppAccuracy = gameAcc(A.userColor === 'w' ? 'b' : 'w');
  A.counts = { w: {}, b: {} }; const cats = {};
  A.ucis.forEach((_, i) => {
    const color = A.fens[i].split(' ')[1]; const c = A.cls[i];
    A.counts[color][c] = (A.counts[color][c] || 0) + 1;
    if (color === A.userColor && A.cats[i]) cats[A.cats[i]] = (cats[A.cats[i]] || 0) + 1;
  });
  A.catCounts = cats; A.done = true;
  if (A.id === 'sample') return;
  // puzzles personales
  A.ucis.forEach((u, i) => {
    if (A.fens[i].split(' ')[1] !== A.userColor || !TRAIN.has(A.cls[i]) || !A.best[i]) return;
    const id = A.id + '#' + i;
    if (S.mine.some(m => m.id === id)) return;
    S.mine.push({ id, fen: A.fens[i], best: A.best[i], bestCp: A.cps[i], played: u, prev: i > 0 ? A.ucis[i - 1] : null, moveNo: Math.floor(i / 2) + 1, opp: A.opp, cat: A.cats[i], cls: A.cls[i], gameId: A.id });
  });
  if (S.mine.length > 150) S.mine = S.mine.filter(m => !m.mastered).slice(-150);
  const slim = Object.assign({}, A); delete slim.fens; delete slim.ucis; delete slim.sans; delete slim.error;
  S.games = S.games.filter(g => g.v === 2 && g.id !== A.id); S.games.push(slim);
  if (S.games.length > 12) S.games = S.games.slice(-12);
  save();
}
function categorize(A, i, color) {
  const sgn = color === 'w' ? 1 : -1;
  const before = sgn * A.cps[i], after = sgn * A.cps[i + 1];
  if (after <= -9000 && before > -9000) return 'mate_allowed';
  if (before >= 9000 && after < 9000) return 'mate_missed';
  const reply = A.best[i + 1];
  if (reply) {
    const g = new Chess(A.fens[i + 1]); const r = g.move(uciObj(reply));
    if (r && r.captured && balanceFor(A.fens[i], color) - balanceFor(g.fen(), color) >= 2) return 'hanging';
  }
  if (A.best[i]) {
    const g2 = new Chess(A.fens[i]); const b = g2.move(uciObj(A.best[i]));
    if (b && (/[+#]/.test(b.san) || (b.captured && (VAL[b.captured] >= 3 || enPriseLoss(parseFen(A.fens[i]), b.to) >= 1)))) return 'missed_tactic';
  }
  if (reply) { const g3 = new Chess(A.fens[i + 1]); const r3 = g3.move(uciObj(reply)); if (r3 && (r3.captured || /[+#]/.test(r3.san))) return 'allowed_tactic'; }
  return 'plan';
}
function clsChip(c) { const k = CLS[c]; return h('span', { class: 'cls-chip', style: { background: k.color } }, k.sym); }
let azBoard = null;
function renderAnalysis(root) {
  const A = AZ.analysis;
  const userName = A.userColor === 'w' ? 'blancas' : 'negras';
  root.append(h('div', { class: 'play-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => { AZ.running = null; AZ.view = AZ.list.length ? 'list' : 'home'; renderAnalyze(); } }, icon('i-close')),
    h('div', { class: 't' }, h('div', { class: 'k' }, `Tú con ${userName}${A.date ? ' · ' + A.date : ''}`), h('h2', null, `vs ${A.opp || 'Rival'}`))));
  if (A.error) { root.append(h('div', { class: 'notice bad' }, A.error)); return; }
  if (!A.done) {
    root.append(h('div', { class: 'card stack' },
      h('strong', null, 'Stockfish está revisando la partida'),
      h('div', { class: 'progress' }, h('div', { id: 'az-progress', style: { width: (100 * A.cps.length / A.fens.length) + '%' } })),
      h('div', { class: 'muted', id: 'az-progress-txt', style: { fontSize: '14px' } }, engine.name ? `Analizando posición ${A.cps.length} de ${A.fens.length}…` : 'Cargando el motor…'),
      h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Todo se calcula en tu dispositivo. No cierres esta pestaña.')));
    return;
  }
  const grid = h('div', { class: 'az-grid' });
  const left = h('div', { class: 'az-left' });
  const right = h('div', { class: 'az-right' });
  grid.append(left, right); root.append(grid);

  // izquierda: tablero, navegación y explicación
  const host = h('div'); left.append(host);
  azBoard = new Board(host); azBoard.flip(A.userColor);
  left.append(h('div', { class: 'navrow' },
    h('button', { class: 'btn', 'aria-label': 'Inicio', onclick: () => goto(0) }, '⏮'),
    h('button', { class: 'btn', 'aria-label': 'Jugada anterior', onclick: () => goto(AZ.idx - 1) }, '◀'),
    h('button', { class: 'btn', 'aria-label': 'Jugada siguiente', onclick: () => goto(AZ.idx + 1) }, '▶'),
    h('button', { class: 'btn', 'aria-label': 'Final', onclick: () => goto(A.ucis.length) }, '⏭')),
    h('div', { id: 'az-caption', class: 'caption', 'aria-live': 'polite' }),
    h('div', { class: 'cmp' }, h('span', null, h('i', { style: { background: 'var(--bad)' } }), 'Jugada hecha'), h('span', null, h('i', { style: { background: 'var(--good)' } }), 'Mejor jugada'), h('span', { class: 'muted kbd-hint' }, 'Usa ← y → en el teclado')));

  // derecha: resumen
  if (A.opening) right.append(h('div', { class: 'opening' }, h('span', { class: 'section-title' }, 'Apertura'), h('div', null, A.opening)));
  right.append(h('div', { class: 'acc-row' },
    h('div', { class: 'card' }, h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Tu precisión'), h('div', { class: 'v' }, A.accuracy + '%')),
    h('div', { class: 'card' }, h('div', { class: 'muted', style: { fontSize: '13px' } }, `Precisión de ${A.opp || 'tu rival'}`), h('div', { class: 'v' }, A.oppAccuracy + '%'))));
  const me = A.counts[A.userColor] || {}, op = A.counts[A.userColor === 'w' ? 'b' : 'w'] || {};
  const tbl = h('div', { class: 'card cls-table', role: 'table', 'aria-label': 'Resumen de la revisión' },
    h('div', { class: 'cls-row head', role: 'row' }, h('span', null, ''), h('span', null, 'Tú'), h('span', null, 'Rival')));
  for (const c of CLS_ORDER) {
    tbl.append(h('div', { class: 'cls-row', role: 'row' },
      h('span', { class: 'cls-name' }, clsChip(c), CLS[c].name),
      h('span', { class: 'mono' + (me[c] ? '' : ' zero'), style: me[c] ? { color: CLS[c].color } : null }, String(me[c] || 0)),
      h('span', { class: 'mono' + (op[c] ? '' : ' zero') }, String(op[c] || 0))));
  }
  right.append(h('p', { class: 'section-title', style: { marginTop: '18px' } }, 'Resumen de la revisión'), tbl);
  right.append(h('p', { class: 'section-title', style: { marginTop: '18px' } }, 'Ventaja durante la partida'), evalGraph(A));

  // momentos
  const mine = i => A.fens[i].split(' ')[1] === A.userColor;
  const shines = A.ucis.map((u, i) => i).filter(i => mine(i) && SHINE.has(A.cls[i]));
  const errs = A.ucis.map((u, i) => i).filter(i => mine(i) && TRAIN.has(A.cls[i]));
  const moment = i => {
    const c = A.cls[i];
    return h('button', { class: 'moment', 'data-i': i, onclick: () => { goto(i, !SHINE.has(c)); if (window.innerWidth < 960) azBoard.wrap.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }); } },
      h('span', { class: 'sym', style: { background: CLS[c].color } }, CLS[c].sym),
      h('span', { class: 't1' }, `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'} ${es(A.sans[i])} · ${CLS[c].name}`),
      h('span', { class: 't2' }, SHINE.has(c) ? (c === 'brilliant' ? 'Sacrificaste material y era de las mejores jugadas.' : 'Era la única jugada buena en esa posición.') : `${reasonOf(A, i)}Mejor: ${es(sanOf(A.fens[i], A.best[i]))}`));
  };
  const mbox = h('div', { class: 'stack', id: 'az-moments' });
  if (shines.length) { mbox.append(h('p', { class: 'section-title', style: { margin: '12px 0 0' } }, `Tus mejores jugadas (${shines.length})`)); shines.forEach(i => mbox.append(moment(i))); }
  mbox.append(h('p', { class: 'section-title', style: { margin: '12px 0 0' } }, `Tus errores (${errs.length})`));
  if (!errs.length) mbox.append(h('div', { class: 'notice good' }, 'Sin errores en esta partida. Revisa las imprecisiones en la lista de jugadas.'));
  errs.forEach(i => mbox.append(moment(i)));
  right.append(mbox);
  if (A.id === 'sample' && errs.length) right.append(h('div', { class: 'notice', style: { marginTop: '12px' } }, 'Con tus partidas reales, cada uno de estos errores se convierte en un puzzle en "Tu entrenamiento".'));
  const pend = S.mine.filter(m => m.gameId === A.id && !m.mastered);
  if (pend.length) right.append(h('div', { class: 'row', style: { marginTop: '12px' } },
    h('button', { class: 'btn brass', onclick: () => startMine(shuffle(pend).slice(0, 5)) }, `Entrenar estos errores (${pend.length})`),
    h('span', { class: 'muted', style: { fontSize: '14px' } }, 'También quedan en "Tu entrenamiento".')));

  // jugadas
  const ml = h('div', { class: 'card movelist', id: 'az-moves' });
  A.sans.forEach((s, i) => {
    if (i % 2 === 0) ml.append(h('span', { class: 'mn' }, (Math.floor(i / 2) + 1) + '.'));
    const c = A.cls[i]; const mark = MARKED.has(c);
    ml.append(h('button', { 'data-i': i + 1, style: mark ? { color: CLS[c].color } : null, title: CLS[c].name, onclick: () => goto(i + 1) }, es(s) + (mark ? CLS[c].sym : '')));
  });
  right.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Jugadas'), ml,
    h('p', { class: 'credits' }, `Analizado con ${engine.name || 'Stockfish'} a profundidad ${A.depth}. Categorías al estilo Chess.com; la precisión usa la fórmula de Lichess. Aperturas: base abierta de Lichess.`));
  const first = errs[0] != null ? errs[0] : null;
  if (first != null) goto(first, true); else goto(0);
}
function goto(i, showBefore) {
  const A = AZ.analysis; if (!A || !azBoard) return;
  if (showBefore) {
    // posición antes de la jugada i, con la jugada hecha (roja) y la mejor (verde)
    AZ.idx = i; AZ.before = true;
    azBoard.setPosition(A.fens[i], { last: i > 0 ? [A.ucis[i - 1].slice(0, 2), A.ucis[i - 1].slice(2, 4)] : null });
    const arr = [{ from: A.ucis[i].slice(0, 2), to: A.ucis[i].slice(2, 4), color: 'var(--bad)' }];
    if (A.best[i] && A.best[i] !== A.ucis[i]) arr.push({ from: A.best[i].slice(0, 2), to: A.best[i].slice(2, 4), color: 'var(--good)' });
    azBoard.arrows(arr);
    setCaption(i, true);
    markCurrent(i + 1, i);
    return;
  }
  i = clamp(i, 0, A.ucis.length);
  const prevIdx = AZ.idx; AZ.idx = i; AZ.before = false;
  const last = i > 0 ? [A.ucis[i - 1].slice(0, 2), A.ucis[i - 1].slice(2, 4)] : null;
  // un paso: se anima la pieza (hacia adelante o de regreso) y suena según la jugada
  let anim = null;
  if (i === prevIdx + 1) anim = [A.ucis[i - 1].slice(0, 2), A.ucis[i - 1].slice(2, 4)];
  else if (i === prevIdx - 1) anim = [A.ucis[i].slice(2, 4), A.ucis[i].slice(0, 2)];
  azBoard.setPosition(A.fens[i], { last, animate: anim });
  if (i === prevIdx + 1) { Sound.play(sfxForSan(A.sans[i - 1])); if (A.cls[i - 1] === 'brilliant') Sound.play('brilliant', 0.12); }
  else if (i !== prevIdx) Sound.play('move');
  if (i > 0) {
    const c = A.cls[i - 1];
    azBoard.badge(A.ucis[i - 1].slice(2, 4), CLS[c].sym, CLS[c].color);
    if (!SHINE.has(c) && c !== 'best' && c !== 'book' && c !== 'forced' && A.best[i - 1] && A.best[i - 1] !== A.ucis[i - 1]) {
      azBoard.arrows([{ from: A.best[i - 1].slice(0, 2), to: A.best[i - 1].slice(2, 4), color: 'var(--good)' }]);
    }
  }
  setCaption(i, false);
  markCurrent(i, null);
}
function reasonOf(A, i) {
  if (A.cls[i] === 'miss') return 'No aprovechaste el error de tu rival. ';
  const cat = A.cats[i];
  return cat && cat !== 'plan' ? CAT_ES[cat] + '. ' : '';
}
function moveText(A, k) {
  const c = A.cls[k], better = A.best[k] && A.best[k] !== A.ucis[k] ? es(sanOf(A.fens[k], A.best[k])) : null;
  const mineMove = A.fens[k].split(' ')[1] === A.userColor;
  switch (c) {
    case 'brilliant': return mineMove ? '¡Brillante! Sacrificaste material y era de las mejores jugadas.' : 'Brillante: sacrificio correcto de tu rival.';
    case 'great': return 'Gran jugada: era la única buena en esta posición.';
    case 'best': return 'La mejor jugada.';
    case 'excellent': return 'Excelente: casi tan buena como la mejor.' + (better ? ` La del motor era ${better}.` : '');
    case 'good': return 'Buena jugada.' + (better ? ` Lo mejor era ${better}.` : '');
    case 'book': return 'Jugada de libro: teoría de aperturas.';
    case 'forced': return 'Jugada forzada: era la única legal.';
    case 'inaccuracy': return `Imprecisión. Lo mejor era ${better}.`;
    case 'mistake': return `Error${mineMove && A.cats[k] && A.cats[k] !== 'plan' ? ': ' + CAT_ES[A.cats[k]].toLowerCase() : ''}. Lo mejor era ${better}.`;
    case 'miss': return `Oportunidad perdida: ${mineMove ? 'tu rival se había equivocado y no lo aprovechaste' : 'no aprovechó tu error'}. Lo mejor era ${better}.`;
    case 'blunder': return `Error grave${mineMove && A.cats[k] && A.cats[k] !== 'plan' ? ': ' + CAT_ES[A.cats[k]].toLowerCase() : ''}. Lo mejor era ${better}.`;
  }
  return '';
}
function setCaption(i, before) {
  const A = AZ.analysis; const el = $('#az-caption'); if (!el) return; el.textContent = '';
  const fmt = cp => Math.abs(cp) >= 9000 ? (cp > 0 ? '+M' + Math.round((10000 - cp) / 10) : '−M' + Math.round((10000 + cp) / 10)) : (cp > 0 ? '+' : cp < 0 ? '−' : '') + (Math.abs(cp) / 100).toFixed(1);
  const k = before ? i : i - 1;
  if (k < 0) { el.append('Posición inicial. Toca una jugada o un momento clave para revisarlo.'); return; }
  const c = A.cls[k];
  el.append(h('span', { class: 'cap-head' }, clsChip(c), h('strong', null, `${Math.floor(k / 2) + 1}${k % 2 === 0 ? '.' : '…'} ${es(A.sans[k])}`), h('span', { class: 'mono muted' }, fmt(A.cps[k + 1]))),
    h('span', null, moveText(A, k)));
  if (before) el.append(h('span', { class: 'muted', style: { fontSize: '14px' } }, 'Ves la posición antes de la jugada. Pulsa ▶ para ver qué pasó.'));
}
function markCurrent(posIdx, momentIdx) {
  for (const b of $$('#az-moves button')) b.setAttribute('aria-current', +b.dataset.i === posIdx ? 'true' : 'false');
  for (const b of $$('#az-moments .moment')) b.setAttribute('aria-current', +b.dataset.i === momentIdx ? 'true' : 'false');
  // desplaza solo la lista de jugadas, nunca la página
  const ml = $('#az-moves'), cur = $('#az-moves button[aria-current="true"]');
  if (ml && cur) ml.scrollTop = Math.max(0, cur.offsetTop - ml.clientHeight / 2 + cur.offsetHeight / 2);
  const dot = $('#eg-cursor'); const A = AZ.analysis;
  if (dot && A) { const x = (posIdx / Math.max(1, A.fens.length - 1)) * 1000; dot.setAttribute('x1', x); dot.setAttribute('x2', x); }
}
document.addEventListener('keydown', e => {
  if (currentTab !== 'analyze' || AZ.view !== 'analysis' || !AZ.analysis || !AZ.analysis.done || session) return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); goto(AZ.idx + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); goto(AZ.idx - 1); }
  else if (e.key === 'Home') { e.preventDefault(); goto(0); }
  else if (e.key === 'End') { e.preventDefault(); goto(AZ.analysis.ucis.length); }
});
function evalGraph(A) {
  const W = 1000, H = 220, n = A.fens.length;
  const svg = svgEl('svg', { class: 'evalgraph', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Gráfica de ventaja: arriba blancas, abajo negras' });
  const x = i => (i / Math.max(1, n - 1)) * W;
  const y = cp => H - (wp(cp) / 100) * H;
  let d = `M0 ${H / 2}`;
  A.cps.forEach((cp, i) => { d += ` L${x(i)} ${y(cp)}`; });
  d += ` L${W} ${H / 2} Z`;
  svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: H / 2, fill: 'var(--surface-2)' }));
  svg.append(svgEl('path', { d, fill: 'var(--sq-dark)', opacity: '.55' }));
  let line = ''; A.cps.forEach((cp, i) => { line += (i ? ' L' : 'M') + x(i) + ' ' + y(cp); });
  svg.append(svgEl('path', { d: line, fill: 'none', stroke: 'var(--ink)', 'stroke-width': '2.5', 'vector-effect': 'non-scaling-stroke' }));
  svg.append(svgEl('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: 'var(--muted)', 'stroke-width': '1', 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke' }));
  A.ucis.forEach((u, i) => {
    if (A.fens[i].split(' ')[1] !== A.userColor) return;
    const c = A.cls[i];
    if (TRAIN.has(c) || SHINE.has(c)) svg.append(svgEl('line', { x1: x(i + 1), x2: x(i + 1), y1: 0, y2: H, stroke: CLS[c].color, 'stroke-width': '2', opacity: '.85', 'vector-effect': 'non-scaling-stroke' }));
  });
  svg.append(svgEl('line', { id: 'eg-cursor', x1: 0, x2: 0, y1: 0, y2: H, stroke: 'var(--brass)', 'stroke-width': '3', 'vector-effect': 'non-scaling-stroke' }));
  svg.addEventListener('click', e => { const r = svg.getBoundingClientRect(); goto(Math.round(((e.clientX - r.left) / r.width) * (n - 1))); });
  return svg;
}

// ---------------------------------------------------------------- progreso
function renderProgress() {
  renderChips();
  const root = $('#view-progress'); root.textContent = '';
  root.append(h('h2', { style: { fontSize: '28px', fontWeight: 800, marginBottom: '14px' } }, 'Tu progreso'), accountCard());
  {
    const k = rankShown(), rp = rankProgress();
    root.append(h('div', { class: 'card rank-card' },
      h('div', { class: 'piece' }, miniPiece(RANKS[k].p, 'big-pc')),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Tu rango'),
        h('h3', null, RANKS[k].name),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: rp.pct + '%' } })),
        h('div', { class: 'muted', style: { fontSize: '14px', marginTop: '6px' } }, rp.next ? `Para ascender a ${rp.next.name}:` : 'Llegaste al rango más alto.')),
      rp.next ? h('ul', { class: 'req-list' }, rp.items.map(x => h('li', { class: x.ok ? 'ok' : '' },
        h('span', { class: 'req-mark', 'aria-hidden': 'true' }, x.ok ? '✓' : ''), h('span', null, x.label), h('span', { class: 'mono req-have' }, x.have)))) : null,
      h('div', { class: 'rank-foot' }, ladder(k), h('span', { class: 'muted' }, 'Tu rango nunca baja. Rey pide 1500 de rating y todos los niveles con 3 estrellas.'))));
  }
  root.append(schoolProgressCard());
  root.append(h('div', { class: 'kpi' },
    h('div', { class: 'card' }, h('div', { class: 'v' }, String(Math.round(S.rating))), h('div', { class: 'l' }, 'Rating táctico estimado')),
    h('div', { class: 'card' }, h('div', { class: 'v' }, String(S.solved)), h('div', { class: 'l' }, 'Puzzles resueltos')),
    h('div', { class: 'card' }, h('div', { class: 'v', style: { display: 'flex', alignItems: 'center', gap: '4px' } }, icon('i-flame'), String(streakDays())), h('div', { class: 'l' }, 'Días seguidos'))));
  $('.kpi svg', root) && Object.assign($('.kpi svg', root).style, { width: '22px', height: '22px', color: 'var(--w-mate2)' });

  // evolución
  const hist = S.ratingHist.slice(-60);
  const card = h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'section-title' }, 'Evolución del rating táctico'));
  if (hist.length >= 2) card.append(sparkline(hist.map(x => x[1])));
  else card.append(h('div', { class: 'muted' }, 'Termina un par de niveles y aquí verás tu curva.'));
  card.append(h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '6px' } }, 'Se calcula como en el ajedrez: sube más al resolver puzzles difíciles. Es una estimación de tu fuerza en táctica, no tu elo oficial.'));
  root.append(card);

  // temas
  const themes = Object.entries(S.themeStats).filter(([, v]) => v[1] > 0);
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Precisión por tema'));
  if (!themes.length) root.append(h('div', { class: 'notice' }, 'Todavía no hay datos. Juega algunos niveles.'));
  else {
    const weakest = themes.filter(([, v]) => v[1] >= 5).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1])[0];
    const box = h('div', { class: 'card bars' });
    for (const [t, v] of themes.sort((a, b) => b[1][1] - a[1][1])) {
      const pct = Math.round(100 * v[0] / v[1]);
      box.append(h('div', { class: 'bar-row' }, h('span', null, THEME_ES[t] || t),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: pct + '%', background: pct >= 75 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)' } })),
        h('span', { class: 'pct' }, pct + '% · ' + v[1])));
    }
    root.append(box);
    if (weakest) {
      const wk = { defense: 'defense', mateIn1: 'mate1', hangingPiece: 'hanging', fork: 'fork', mateIn2: 'mate2', pin: 'pin', skewer: 'pin', discoveredAttack: 'discovered' }[weakest[0]];
      root.append(h('div', { class: 'card weak', style: { marginTop: '10px' } },
        h('strong', null, `Tu punto débil: ${THEME_ES[weakest[0]]}`),
        h('div', { class: 'muted', style: { fontSize: '15px', margin: '4px 0 10px' } }, `Aciertas ${Math.round(100 * weakest[1][0] / weakest[1][1])}% de estos puzzles. Repasa la lección de ese mundo y repite sus niveles.`),
        wk && WORLDS.includes(wk) ? h('button', { class: 'btn small', onclick: () => { S.lessonsOpen[wk] = true; save(); setTab('map'); setTimeout(() => { const el = $('#world-' + wk); if (el) el.scrollIntoView({ block: 'start' }); }, 80); } }, 'Ir a ese mundo') : null));
    }
  }

  // partidas
  root.append(h('p', { class: 'section-title', style: { marginTop: '22px' } }, 'Lo que dicen tus partidas'));
  const games = S.games.filter(g => g.done && g.id !== 'sample');
  if (!games.length) root.append(h('div', { class: 'notice' }, 'Analiza tus partidas para ver qué tipo de error te cuesta más puntos.'));
  else {
    const tot = {}; let n = 0;
    for (const g of games) for (const [k, v] of Object.entries(g.catCounts || {})) { tot[k] = (tot[k] || 0) + v; n += v; }
    const avg = Math.round(games.reduce((a, g) => a + g.accuracy, 0) / games.length);
    const box = h('div', { class: 'card bars' }, h('div', { class: 'muted', style: { fontSize: '14px' } }, `${games.length} partida${games.length > 1 ? 's' : ''} · precisión media ${avg}% · ${n} errores graves o normales`));
    for (const [k, v] of Object.entries(tot).sort((a, b) => b[1] - a[1])) {
      const pct = Math.round(100 * v / n);
      box.append(h('div', { class: 'bar-row' }, h('span', null, CAT_ES[k]), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: pct + '%', background: 'var(--bad)' } })), h('span', { class: 'pct' }, v + '')));
    }
    root.append(box);
    const top = Object.entries(tot).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const advice = {
        hanging: 'Antes de soltar la pieza, revisa: ¿qué queda sin defensa después de mi jugada? Juega el mundo "Piezas colgadas" para entrenar el ojo.',
        mate_allowed: 'Antes de mover, mira todos los jaques que tendría tu rival. Los mundos de mate te enseñan a verlos desde el otro lado.',
        mate_missed: 'Revisa siempre tus jaques primero, aunque parezcan raros. Practica "Mate en 1" y "Mate en 2".',
        missed_tactic: 'Tu rival te dejó oportunidades. Haz el chequeo: jaques, capturas y amenazas. Las horquillas y clavadas son las más comunes.',
        allowed_tactic: 'Antes de mover, ponte en el lugar de tu rival: ¿qué jaques y capturas tendría después de mi jugada? Los mundos de horquillas y clavadas entrenan ese ojo.',
        plan: 'Tus errores son más de plan que de táctica: juega partidas más lentas (15+10) y revisa tus aperturas.',
      }[top[0]];
      root.append(h('div', { class: 'card weak', style: { marginTop: '10px' } }, h('strong', null, 'Recomendación'), h('div', { style: { fontSize: '15px', marginTop: '4px' } }, advice)));
    }
  }

  // reinicio
  const resetBox = h('div', { class: 'confirm', style: { marginTop: '26px' } });
  const askReset = () => {
    resetBox.textContent = '';
    resetBox.append(h('span', { style: { fontWeight: 700 } }, '¿Borrar todo tu progreso?'),
      h('button', { class: 'btn small', style: { borderColor: 'var(--bad)', color: 'var(--bad)' }, onclick: () => { const keep = { profile: S.profile, account: S.account, owner: S.owner, settings: S.settings }; S = Object.assign(defaultState(), keep); save(); mapScrolled = false; renderProgress(); toast('Progreso reiniciado.'); } }, 'Sí, borrar'),
      h('button', { class: 'btn small', onclick: () => { resetBox.textContent = ''; resetBox.append(resetBtn); } }, 'Cancelar'));
  };
  const resetBtn = h('button', { class: 'btn small', onclick: askReset }, 'Reiniciar progreso');
  resetBox.append(resetBtn);
  root.append(resetBox);
  root.append(h('p', { class: 'credits' },
    'Hecho por Jorge Luis Pizano Saucedo. Karen, la mascota, fue ilustrada por Karen. ',
    `Versión ${APP_VERSION}. `, cloud ? 'Tu progreso se guarda en tu cuenta. ' : 'Tu progreso se guarda en este navegador. ',
    'Puzzles generados con Stockfish a partir de partidas simuladas. Motor: ', h('a', { href: 'https://github.com/nmrugg/stockfish.js', target: '_blank', rel: 'noopener noreferrer' }, 'Stockfish.js'), ' (GPLv3). ',
    'Reglas: ', h('a', { href: 'https://github.com/jhlywa/chess.js', target: '_blank', rel: 'noopener noreferrer' }, 'chess.js'), ' (BSD). ',
    'Piezas: Cburnett vía cm-chessboard (CC BY-SA 3.0).'));
}
function sparkline(vals) {
  const W = 600, H = 120, pad = 8;
  const lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
  const x = i => pad + (i / (vals.length - 1)) * (W - 2 * pad), y = v => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const svg = svgEl('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Rating de ${vals[0]} a ${vals[vals.length - 1]}` });
  for (let k = 1; k < 4; k++) svg.append(svgEl('line', { x1: 0, x2: W, y1: (H / 4) * k, y2: (H / 4) * k, stroke: 'var(--line)', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke' }));
  let d = ''; vals.forEach((v, i) => { d += (i ? ' L' : 'M') + x(i) + ' ' + y(v); });
  svg.append(svgEl('path', { d: d + ` L${x(vals.length - 1)} ${H} L${x(0)} ${H} Z`, fill: 'var(--brass)', opacity: '.15' }));
  svg.append(svgEl('path', { d, fill: 'none', stroke: 'var(--brass)', 'stroke-width': '2.5', 'vector-effect': 'non-scaling-stroke' }));
  svg.append(svgEl('circle', { cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: '5', fill: 'var(--brass)' }));
  const wrap = h('div', { style: { position: 'relative' } }, svg,
    h('div', { class: 'mono', style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted)' } }, h('span', null, String(vals[0])), h('span', null, 'ahora: ' + vals[vals.length - 1])));
  return wrap;
}

// ---------------------------------------------------------------- cuenta, bienvenida y tutorial
// Cuentas reales con Firebase (Google o correo) cuando el sitio tiene configuración en firebase-config.js.
// Sin configuración, el perfil y el progreso viven en este navegador.
const FB_VER = '10.14.1';
const Auth = {
  fb: null, user: null, loading: null, listening: false,
  available() { const c = window.FIREBASE_CONFIG; return !!(c && c.apiKey && c.projectId); },
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        for (const m of ['app', 'auth', 'firestore']) await loadScript(`vendor/firebase/firebase-${m}-compat.js`); // v${FB_VER}, servido desde el sitio
        const fb = window.firebase; if (!fb.apps.length) fb.initializeApp(window.FIREBASE_CONFIG);
        fb.auth().languageCode = 'es';
        this.fb = fb; return fb;
      })();
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  },
};
function loadScript(src) {
  return new Promise((res, rej) => {
    const abs = new URL(src, location.href).href;
    if ([...document.scripts].some(x => x.src === abs)) return res();
    const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.append(el);
  });
}
const AUTH_ERR = {
  'auth/invalid-email': 'Ese correo no es válido.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Entra con tu contraseña.',
  'auth/weak-password': 'Esa contraseña es muy débil. Usa al menos 8 caracteres.',
  'auth/password-does-not-meet-requirements': 'Esa contraseña no cumple los requisitos. Usa al menos 8 caracteres con letras y números.',
  'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
  'auth/cancelled-popup-request': 'Cerraste la ventana de Google antes de terminar.',
  'auth/network-request-failed': 'Sin conexión. Revisa tu internet e intenta de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase. Agrégalo en Authentication → Configuración → Dominios autorizados.',
  'auth/operation-not-allowed': 'Ese método de acceso no está activado en Firebase.',
};
const authMsg = e => AUTH_ERR[e && e.code] || 'No se pudo entrar. Intenta de nuevo.';
function refreshAll() {
  renderChips();
  if (session) return;
  if (LS) return;
  if (currentTab === 'map') renderMap(false); else if (currentTab === 'progress') renderProgress(); else if (currentTab === 'school') renderSchool(); else if (AZ.view === 'home') renderAnalyze();
}
function fbRef(uid) {
  const doc = Auth.fb.firestore().collection('users').doc(uid);
  return { set: o => doc.set(o), get: async () => { const x = await doc.get(); return { exists: x.exists, data: () => x.data() }; } };
}
function attachAuthListener(fb) {
  if (Auth.listening) return; Auth.listening = true;
  fb.auth().onAuthStateChanged(u => { onFbUser(u); });
  fb.auth().getRedirectResult().catch(e => { if (e && e.code) gate('welcome', { err: authMsg(e) }); });
}
async function onFbUser(user) {
  if (!user) {
    const had = Auth.user || (S.account && S.account.provider === 'firebase' && S.owner);
    Auth.user = null; if (cloud && cloud.kind === 'firebase') cloud = null;
    if (had && S.owner) gate('welcome', { info: 'Tu sesión terminó. Vuelve a entrar para seguir guardando tu progreso en tu cuenta.' });
    return;
  }
  if (Auth.user && Auth.user.uid === user.uid && cloud) return;
  Auth.user = user;
  const ref = fbRef(user.uid);
  let d = null;
  try { const x = await ref.get(); d = x.exists ? x.data() : null; }
  catch (e) { toast('No se pudo leer tu cuenta. Por ahora tu progreso se guarda en este navegador.'); return; }
  if (d && d.state) {
    // La cuenta ya tenía progreso: manda la nube, salvo que este navegador sea del mismo usuario y vaya más adelante.
    if (!(S.owner === user.uid && (S.savedAt || 0) > (d.savedAt || 0))) S = normalizeState(safeParse(d.state));
  } else if (S.owner && S.owner !== user.uid) {
    S = defaultState(); // progreso de otra cuenta en este navegador: no se mezcla
  } // cuenta nueva: se queda con el progreso de invitado de este navegador
  S.owner = user.uid;
  S.account = { provider: 'firebase', email: user.email || '', name: user.displayName || '', photo: user.photoURL || '' };
  cloud = { ref, busy: false, pending: false, kind: 'firebase' };
  save();
  if (!S.profile) return gate('profile');
  if (document.body.classList.contains('gated')) closeGate();
  refreshAll();
  if (!S.profile.tutorialDone) setTimeout(startTour, 350);
}
async function signInGoogle() {
  gate(gateState.step, { busy: 'google' });
  try {
    const fb = await Auth.load(); attachAuthListener(fb);
    const provider = new fb.auth.GoogleAuthProvider();
    try { await fb.auth().signInWithPopup(provider); }
    catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) { await fb.auth().signInWithRedirect(provider); return; }
      throw e;
    }
  } catch (e) { gate(gateState.step, { err: e && e.code ? authMsg(e) : 'No se pudo conectar con el servicio de cuentas. Revisa tu internet.' }); }
}
async function signInEmail(email, pass) {
  if (!email || !pass) return gate('email', { email, err: 'Escribe tu correo y tu contraseña.' });
  if (gateState.mode === 'signup' && pass.length < 8) return gate('email', { email, err: 'La contraseña necesita al menos 8 caracteres.' });
  gate('email', { email, busy: true });
  try {
    const fb = await Auth.load(); attachAuthListener(fb);
    if (gateState.mode === 'signup') await fb.auth().createUserWithEmailAndPassword(email, pass);
    else await fb.auth().signInWithEmailAndPassword(email, pass);
  } catch (e) { gate('email', { email, err: e && e.code ? authMsg(e) : 'No se pudo conectar con el servicio de cuentas. Revisa tu internet.' }); }
}
async function resetPassword(email) {
  if (!email) return gate('email', { err: 'Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".' });
  try { const fb = await Auth.load(); await fb.auth().sendPasswordResetEmail(email); gate('email', { email, info: `Si hay una cuenta con ${email}, te llegará un correo para cambiar tu contraseña.` }); }
  catch (e) { gate('email', { email, err: authMsg(e) }); }
}
// ---------- perfiles de este navegador: varias personas pueden usar la misma computadora.
// Al cerrar sesión, el progreso se guarda aparte y el perfil aparece en la pantalla de inicio para volver a entrar.
const PKEY = 'peonarey.profiles', pslot = id => 'peonarey.p.' + id;
const Profiles = {
  list() {
    try { const l = safeParse(localStorage.getItem(PKEY) || '[]'); return Array.isArray(l) ? l.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') : []; }
    catch (e) { return []; }
  },
  saveList(l) { try { localStorage.setItem(PKEY, JSON.stringify(l)); } catch (e) { /* sin almacenamiento */ } },
  logout(wipe) {
    if (S.profile) {
      const id = S.profile.id || (S.profile.id = Math.random().toString(36).slice(2, 10));
      const l = this.list().filter(p => p.id !== id);
      try {
        if (wipe) localStorage.removeItem(pslot(id));
        else {
          localStorage.setItem(pslot(id), JSON.stringify(S));
          l.unshift({ id, name: S.profile.name || 'Jugador', photo: S.profile.photo || '', rating: Math.round(S.rating), rank: rankShown(), at: Date.now() });
        }
      } catch (e) { toast('No hay espacio en este navegador para guardar tu perfil. No se cerró la sesión.'); return; }
      this.saveList(l.slice(0, 8));
    }
    if (session) { session = null; if (board) { board.setInteractive(false); board.setPick(null); } }
    if (LS) schClose(true);
    S = defaultState(); localSave(); mapScrolled = false; Mascot.hide(true); Music.update();
    gate('welcome', { info: wipe ? 'Cerraste sesión y se borraron tus datos de este navegador.' : 'Cerraste sesión. Tu perfil quedó guardado en este navegador.' });
  },
  enter(id) {
    let st = null;
    try { const raw = localStorage.getItem(pslot(id)); if (raw) st = normalizeState(safeParse(raw)); } catch (e) { /* dañado */ }
    if (!st || !st.profile) { this.remove(id); gate('welcome', { err: 'Ese perfil ya no está en este navegador.' }); return; }
    S = st; S.profile.id = id; localSave(); mapScrolled = false;
    closeGate(); setTab('map'); renderChips(); toast(`¡Hola de nuevo, ${S.profile.name}!`);
  },
  remove(id) { try { localStorage.removeItem(pslot(id)); } catch (e) { /* nada */ } this.saveList(this.list().filter(p => p.id !== id)); },
};
function askLogout() {
  for (const old of $$('.modal')) old.remove();
  const signed = S.account && S.account.provider === 'firebase' && !!Auth.user;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  let armed = false;
  const wipeBtn = signed ? null : h('button', { class: 'btn danger-btn', onclick: () => {
    if (!armed) { armed = true; wipeBtn.textContent = 'Sí, borrar mis datos de aquí'; return; }
    close(); Profiles.logout(true);
  } }, 'Salir y borrar mis datos');
  const ov = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lo-t', onclick: e => { if (e.target === ov) close(); } },
    h('div', { class: 'modal-card' },
      h('h2', { id: 'lo-t' }, '¿Cerrar sesión?'),
      h('p', { class: 'muted' }, signed
        ? 'Tu progreso está guardado en tu cuenta. Para volver, entra otra vez con Google o con tu correo.'
        : 'Tu perfil y tu progreso se quedan guardados en este navegador; para volver, elígelo en la pantalla de inicio. Si esta computadora no es tuya, mejor borra tus datos.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => { close(); if (signed) logout(); else Profiles.logout(false); } }, 'Cerrar sesión'),
        wipeBtn,
        h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'))));
  document.body.append(ov); document.addEventListener('keydown', onKey);
  setTimeout(() => { const b = $('.modal .btn.primary'); if (b) b.focus(); }, 30);
}
async function logout() {
  try { if (Auth.fb) await Auth.fb.auth().signOut(); } catch (e) { /* sin conexión: se cierra igual en este navegador */ }
  cloud = null; Auth.user = null; S = defaultState(); localSave(); mapScrolled = false;
  gate('welcome', { info: 'Cerraste sesión. Tu progreso quedó guardado en tu cuenta.' });
}

// ---------- pantallas de bienvenida, correo y perfil
let gateState = { step: 'welcome', mode: 'login', email: '', busy: false, err: '', info: '', upgrade: false, edit: false };
function gate(step, opts = {}) {
  gateState = Object.assign({}, gateState, { err: '', info: '', busy: false }, opts, { step });
  if (step !== 'profile') { gateState.platform = undefined; gateState.level = undefined; }
  document.body.classList.add('gated');
  if (tour) finishTour(false, true);
  if (LS) schClose(true);
  Mascot.hide(true);
  renderGate();
}
function closeGate() { document.body.classList.remove('gated'); $('#gate').textContent = ''; Object.assign(gateState, { upgrade: false, edit: false, _photo: undefined, _name: undefined, _user: undefined }); }
function gateNotices() {
  return [gateState.err ? h('div', { class: 'notice bad', role: 'alert' }, gateState.err) : null, gateState.info ? h('div', { class: 'notice good', role: 'status' }, gateState.info) : null].filter(Boolean);
}
function renderGate() {
  const g = $('#gate'); g.textContent = ''; window.scrollTo(0, 0);
  const G = gateState, box = h('div', { class: 'gate' });
  g.append(box);
  if (G.step === 'welcome') {
    box.append(
      h('div', { class: 'hero-steps', 'aria-hidden': 'true' }, RANKS.map((r, i) => h('div', { class: 'hstep', style: { '--i': i } }, miniPiece(r.p, 'hpc'), h('span', { class: 'hblock' + (i % 2 ? ' dk' : '') })))),
      h('div', null,
        h('div', { class: 'section-title', style: { margin: 0 } }, 'Entrenador de ajedrez gratuito'),
        h('h1', { class: 'gate-title' }, 'De Peón a Rey'),
        h('p', { class: 'gate-lead' }, 'Aprende desde cero con Karen, entrena táctica por niveles y revisa tus partidas con Stockfish. Tus errores se vuelven tus próximos ejercicios.')),
      ...gateNotices());
    const saved = G.upgrade ? [] : Profiles.list();
    if (saved.length) {
      const list = h('div', { class: 'who-list' });
      for (const p of saved) {
        const R = RANKS[p.rank] || RANKS[0];
        const row = h('div', { class: 'who-row' });
        const fill = () => {
          row.textContent = '';
          row.append(
            h('button', { class: 'who-btn', type: 'button', onclick: () => Profiles.enter(p.id) },
              avatarEl('avatar', p.photo || '', p.name), h('span', { class: 'who-txt' }, h('strong', null, p.name), h('small', null, `${R.name}, ${p.rating} de rating`)), icon('i-back', 'who-go')),
            h('button', { class: 'icon-btn who-del', type: 'button', 'aria-label': `Borrar el perfil de ${p.name}`, onclick: () => {
              row.textContent = '';
              row.append(h('div', { class: 'who-confirm' }, h('span', null, `¿Borrar a ${p.name} de este navegador?`),
                h('button', { class: 'btn small danger-btn', onclick: () => { Profiles.remove(p.id); renderGate(); } }, 'Borrar'),
                h('button', { class: 'btn small', onclick: fill }, 'Cancelar')));
            } }, icon('i-close')));
        };
        fill(); list.append(row);
      }
      box.append(h('div', { class: 'stack' }, h('div', { class: 'gate-kicker' }, '¿Quién va a jugar?'), list));
    }
    const acts = h('div', { class: 'stack' });
    if (Auth.available()) {
      acts.append(
        h('button', { class: 'btn primary big', disabled: !!G.busy, onclick: signInGoogle }, G.busy === 'google' ? 'Abriendo Google…' : 'Continuar con Google'),
        h('button', { class: 'btn big', disabled: !!G.busy, onclick: () => gate('email', { mode: 'login' }) }, 'Entrar con correo'));
      if (G.upgrade) acts.append(h('button', { class: 'btn ghost', onclick: () => { closeGate(); refreshAll(); } }, 'Volver'),
        h('p', { class: 'gate-note' }, 'Al crear tu cuenta, el progreso de este navegador pasa a tu cuenta.'));
      else acts.append(h('div', { class: 'or' }, 'o'),
        h('button', { class: 'btn ghost', onclick: () => gate('profile', { guest: true }) }, 'Probar sin cuenta'),
        h('p', { class: 'gate-note' }, 'Sin cuenta, tu progreso se guarda solo en este navegador. Puedes crear tu cuenta después.'));
    } else {
      acts.append(h('button', { class: saved.length ? 'btn big' : 'btn primary big', onclick: () => gate('profile') }, saved.length ? 'Crear perfil nuevo' : 'Empezar'),
        h('p', { class: 'gate-note' }, 'Tu progreso se guarda en este navegador.'));
    }
    box.append(acts);
    return;
  }
  if (G.step === 'email') {
    const isNew = G.mode === 'signup';
    const email = h('input', { type: 'email', id: 'gate-email', autocomplete: 'email', value: G.email || '', required: true, inputmode: 'email' });
    const pass = h('input', { type: 'password', id: 'gate-pass', autocomplete: isNew ? 'new-password' : 'current-password', minlength: isNew ? '8' : '6', required: true });
    box.append(
      h('div', { class: 'gate-head' },
        h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => gate('welcome') }, icon('i-back')),
        h('div', null, h('div', { class: 'section-title', style: { margin: 0 } }, 'Tu cuenta'), h('h2', null, isNew ? 'Crea tu cuenta' : 'Entra con tu correo'))),
      h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); signInEmail(email.value.trim(), pass.value); } },
        h('label', { class: 'field', for: 'gate-email' }, 'Correo', email),
        h('label', { class: 'field', for: 'gate-pass' }, isNew ? 'Crea una contraseña (mínimo 8 caracteres)' : 'Contraseña', pass),
        ...gateNotices(),
        h('button', { class: 'btn primary big', type: 'submit', disabled: !!G.busy }, G.busy ? (isNew ? 'Creando tu cuenta…' : 'Entrando…') : (isNew ? 'Crear cuenta' : 'Entrar')),
        h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          h('button', { type: 'button', class: 'linkbtn', onclick: () => gate('email', { email: email.value, mode: isNew ? 'login' : 'signup' }) }, isNew ? 'Ya tengo cuenta' : 'Crear una cuenta nueva'),
          isNew ? null : h('button', { type: 'button', class: 'linkbtn', onclick: () => resetPassword(email.value.trim()) }, 'Olvidé mi contraseña'))));
    setTimeout(() => (G.email ? pass : email).focus({ preventScroll: true }), 50);
    return;
  }
  // perfil
  const P = S.profile || {};
  if (G.platform === undefined) G.platform = P.platform || (S.settings.user ? S.settings.platform : 'chesscom');
  if (G.level === undefined) G.level = P.level || null;
  const name = h('input', { type: 'text', id: 'pf-name', autocomplete: 'nickname', maxlength: '24', value: P.name || (S.account && S.account.name ? S.account.name.split(' ')[0] : ''), placeholder: 'Tu nombre o apodo' });
  const user = h('input', { type: 'text', id: 'pf-user', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: P.chessUser || S.settings.user || '', placeholder: 'Tu usuario' });
  const plat = h('div', { class: 'seg', role: 'group', 'aria-label': 'Dónde juegas' });
  for (const [k, label] of [['chesscom', 'Chess.com'], ['lichess', 'Lichess'], ['none', 'En ningún lado']]) {
    plat.append(h('button', { type: 'button', 'aria-pressed': G.platform === k ? 'true' : 'false', onclick: () => { G.platform = k; G._name = name.value; G._user = user.value; renderGate(); } }, label));
  }
  if (G._name !== undefined) { name.value = G._name; user.value = G._user; }
  const keep = () => { G._name = name.value; G._user = user.value; };
  const curPhoto = G._photo !== undefined ? G._photo : P.photo !== undefined ? P.photo : ((S.account && S.account.photo) || '');
  const photoField = h('div', { class: 'field' }, h('span', null, 'Tu foto (opcional)'),
    h('div', { class: 'photo-row' }, avatarEl('avatar', curPhoto),
      h('button', { type: 'button', class: 'btn small', onclick: async () => { const d = await pickPhoto(); if (d) { keep(); G._photo = d; renderGate(); } } }, curPhoto ? 'Cambiar foto' : 'Elegir foto'),
      curPhoto ? h('button', { type: 'button', class: 'linkbtn', onclick: () => { keep(); G._photo = ''; renderGate(); } }, 'Quitar') : null));
  const LEVELS = [['new', 'Todavía no sé jugar', 'Karen te enseña desde cero, pieza por pieza'], ['lt600', 'Empezando', 'menos de 600'], ['600', 'Intermedio', '600 a 1000'], ['1000', 'Avanzado', '1000 a 1400'], ['1400', 'Fuerte', 'más de 1400']];
  const lv = h('div', { class: 'choice-grid', role: 'group', 'aria-label': 'Tu nivel' },
    LEVELS.map(([k, t, sub]) => h('button', { type: 'button', class: 'choice' + (k === 'new' ? ' wide' : ''), 'aria-pressed': G.level === k ? 'true' : 'false', onclick: () => { G.level = k; G._name = name.value; G._user = user.value; renderGate(); } }, t, h('small', null, sub))));
  box.append(
    h('div', { class: 'gate-head' },
      G.edit ? h('button', { class: 'icon-btn', 'aria-label': 'Cancelar', onclick: () => { closeGate(); refreshAll(); } }, icon('i-close')) : null,
      h('div', null, h('div', { class: 'section-title', style: { margin: 0 } }, G.edit ? 'Tu perfil' : 'Paso 1 de 2'), h('h2', null, G.edit ? 'Edita tu perfil' : 'Cuéntanos de ti'))),
    h('p', { class: 'muted', style: { margin: 0 } }, 'Con esto ajustamos los puzzles a tu nivel y traemos tus partidas.'),
    h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); saveProfile(name.value.trim(), G.platform, user.value.trim(), G.level); } },
      h('label', { class: 'field', for: 'pf-name' }, '¿Cómo te llamamos?', name),
      photoField,
      h('div', { class: 'field' }, h('span', null, '¿Dónde juegas?'), plat),
      G.platform === 'none' ? null : h('label', { class: 'field', for: 'pf-user' }, `Tu usuario de ${G.platform === 'lichess' ? 'Lichess' : 'Chess.com'} (opcional)`, user),
      h('div', { class: 'field' }, h('span', null, '¿Cuál es tu nivel?'), lv),
      ...gateNotices(),
      h('button', { class: 'btn primary big', type: 'submit' }, G.edit ? 'Guardar' : 'Continuar')));
  if (!name.value) setTimeout(() => name.focus({ preventScroll: true }), 50);
}
function saveProfile(name, platform, chessUser, level) {
  name = (name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  chessUser = (chessUser || '').trim();
  if (!name) return gate('profile', { err: 'Escribe cómo te llamamos.', platform, level, _name: name, _user: chessUser, edit: gateState.edit });
  if (platform !== 'none' && chessUser && !USER_RE.test(chessUser)) return gate('profile', { err: 'Ese usuario no es válido: solo letras, números, guion y guion bajo.', platform, level, _name: name, _user: chessUser, edit: gateState.edit });
  const isNew = !S.profile;
  S.profile = Object.assign({}, S.profile, { name, platform, chessUser: platform === 'none' ? '' : chessUser, level: level || '600', createdAt: (S.profile && S.profile.createdAt) || Date.now() });
  if (gateState._photo !== undefined) S.profile.photo = gateState._photo;
  if (platform !== 'none' && chessUser) { S.settings.platform = platform; S.settings.user = chessUser; }
  if (isNew && !S.ratingN) {
    S.rating = { new: 600, lt600: 700, '600': 800, '1000': 1000, '1400': 1200 }[S.profile.level] || 800;
    S.rankMax = 0; S.rankRules = 2;
  }
  // quien todavía no sabe jugar empieza por lo básico en la Escuela; los mundos de táctica esperan
  schState().needBasics = S.profile.level === 'new';
  if (!S.account) S.account = { provider: 'local' };
  save();
  const wasEdit = gateState.edit;
  closeGate(); mapScrolled = false;
  if (wasEdit) { refreshAll(); toast('Perfil guardado.'); return; }
  setTab('map');
  if (!S.profile.tutorialDone) setTimeout(startTour, 350);
}

// ---------- tutorial guiado sobre el mapa
let tour = null;
function tourSteps() {
  const name = (S.profile && S.profile.name) || '', N = MASCOT.name, gated = schoolGated();
  return [
    { sel: null, title: name ? `¡Hola, ${name}!` : '¡Hola!', text: `Soy ${N} y voy a acompañarte de peón a rey. Te enseño cómo funciona todo en menos de un minuto.`, mood: 'wave', emote: 'sparkle' },
    { sel: '.daily', title: 'Reto diario', text: 'Cinco puzzles al día, los mismos para todos. No gasta vidas y al terminar puedes compartir tu resultado.', mood: 'point', emote: 'sparkle' },
    { sel: '.world-banner', title: 'Mundos', text: 'Cada mundo entrena un tipo de táctica. Toca "Ver lección" para aprender el patrón antes de jugar.', mood: 'think', prop: 'glasses', emote: 'idea' },
    gated
      ? { sel: '.school-cta', title: 'Primero, lo básico', text: 'Los mundos de táctica se abren cuando sepas mover las piezas. Para eso está mi escuela: empezamos desde cero, sin prisa.', mood: 'point', emote: 'exclaim' }
      : { sel: '.node.current', title: 'Niveles', text: 'Cada intento son 5 puzzles. Pasas con 4 puntos y ganas 3 estrellas con 5 de 5 sin pistas. Si repites, te tocan puzzles nuevos. Si no pasas pierdes una vida; se recuperan cada 20 minutos.', mood: 'point', emote: 'exclaim' },
    { sel: '.rank-chip', fixed: true, title: 'Tu rango', text: 'Tu pieza asciende de Peón a Rey juntando rating táctico y mundos completados. Para Rey necesitas 1500 y todos los niveles con 3 estrellas. El rango nunca baja.', mood: 'cheer', prop: 'crown', emote: 'sparkle' },
    { sel: '.tab[data-tab="school"]', fixed: true, title: 'Mi escuela', text: 'Aquí te enseño de todo: desde mover las piezas hasta aperturas, finales y planes, con prácticas contra mí. Cada bloque te da un título.', mood: 'happy', prop: 'glasses', emote: 'idea' },
    { sel: '.tab[data-tab="analyze"]', fixed: true, title: 'Analiza tus partidas', text: 'Trae tus partidas de Chess.com o Lichess. Stockfish revisa cada jugada y tus errores se vuelven puzzles en "Tu entrenamiento".', mood: 'think', prop: ['glasses', 'magnifier'] },
    { sel: '.tab[data-tab="progress"]', fixed: true, title: 'Tu progreso', text: `Aquí ves tu rango, tus temas débiles y tu cuenta. También puedes repetir este tutorial. Tocando tu foto, arriba a la derecha, apagas la música o mis consejos y cierras sesión.`, mood: 'happy', emote: 'heart' },
    gated
      ? { sel: '.tab[data-tab="school"]', fixed: true, title: '¡Listo!', text: 'Vamos a tu primera lección: el tablero. Te explico todo y luego practicas. ¡Yo te echo porras!', mood: 'cheer', prop: 'partyhat', emote: 'sparkle', cta: 'Ir a la primera lección' }
      : { sel: '.node.current', title: '¡Listo!', text: 'Empieza por el primer nivel. Cada puzzle que resuelves te acerca al siguiente rango. ¡Yo te echo porras!', mood: 'cheer', prop: 'partyhat', emote: 'sparkle', cta: 'Jugar el primer nivel' },
  ];
}
// Mientras el tutorial está abierto la página no se mueve: ni rueda, ni dedo, ni teclado.
let scrollLock = null;
function lockScroll(on) {
  const de = document.documentElement;
  if (on && !scrollLock) {
    const stop = e => { e.preventDefault(); };
    const keys = e => {
      const t = e.target, isBtn = t && t.closest && t.closest('button');
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key) || (e.key === ' ' && !isBtn)) e.preventDefault();
    };
    // Solo el <html>: si también se bloquea <body>, éste se vuelve el contenedor de la barra "sticky"
    // de arriba y la barra se va con el contenido (por eso el tutorial no encontraba el chip de rango).
    scrollLock = { stop, keys, de: de.style.overflow, ob: de.style.overscrollBehavior };
    de.style.overflow = 'hidden'; de.style.overscrollBehavior = 'none';
    window.addEventListener('wheel', stop, { passive: false });
    window.addEventListener('touchmove', stop, { passive: false });
    window.addEventListener('keydown', keys, { passive: false });
  } else if (!on && scrollLock) {
    de.style.overflow = scrollLock.de; de.style.overscrollBehavior = scrollLock.ob;
    window.removeEventListener('wheel', scrollLock.stop); window.removeEventListener('touchmove', scrollLock.stop); window.removeEventListener('keydown', scrollLock.keys);
    scrollLock = null;
  }
}
function startTour() {
  if (tour) finishTour(false, true);
  if (document.body.classList.contains('gated')) return;
  if (session) exitSession();
  setTab('map'); window.scrollTo(0, 0);
  Mascot.hide(true);
  const ov = h('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tutorial' });
  const hole = h('div', { class: 'tour-hole none' }), bub = h('div', { class: 'tour-bubble speech first', 'aria-live': 'polite' });
  ov.append(hole); document.body.append(ov, bub);
  lockScroll(true);
  tour = { i: 0, steps: tourSteps(), ov, hole, bub };
  // la mascota sube desde abajo de la pantalla y saluda
  Mascot.layout('tour'); Mascot.el.classList.add('in-tour'); Mascot.pose({ mood: 'idle' });
  requestAnimationFrame(() => requestAnimationFrame(() => { Mascot.show(); setTimeout(() => { if (tour && tour.i === 0) Mascot.pose(tour.steps[0]); }, 520); }));
  tour.onKey = e => {
    if (!tour) return;
    if (e.key === 'Escape') finishTour(false);
    else if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tourGo(tour.i - 1); }
  };
  tour.onResize = () => { Mascot.layout('tour'); placeTour(); };
  document.addEventListener('keydown', tour.onKey); window.addEventListener('resize', tour.onResize);
  tourGo(0);
}
function tourGo(i) {
  if (!tour) return;
  tour.i = clamp(i, 0, tour.steps.length - 1);
  const st0 = tour.steps[tour.i], el = st0.sel ? $(st0.sel) : null;
  // lo señalado queda en la parte de arriba; abajo están la mascota y su globo
  if (el && !st0.fixed) { const r = el.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - Math.max(76, innerHeight * 0.14)); }
  renderTourBubble();
  if (tour.i > 0 || Mascot.shown) Mascot.pose(st0);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    placeTour();
    // pantallas bajitas: si el globo alcanza lo señalado, se sube un poco la página
    if (!tour || !el || st0.fixed) return;
    const r = el.getBoundingClientRect(), b = tour.bub.getBoundingClientRect(), over = r.bottom + 10 - b.top;
    if (over > 0) { const room = Math.max(0, r.top - 58); if (room > 0) { window.scrollTo(0, window.scrollY + Math.min(over, room)); placeTour(); } }
  }));
  if (tour.i > 0) Sound.play('hint');
}
function renderTourBubble() {
  const { i, steps, bub } = tour, st0 = steps[i], last = i === steps.length - 1;
  const p = h('p');
  bub.textContent = '';
  if (i > 0) bub.classList.remove('first');
  bub.append(
    h('div', { class: 'tour-top' }, h('span', { class: 'm-name' }, MASCOT.name),
      h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, steps.map((_, k) => h('i', { class: k === i ? 'on' : '' })))),
    h('h3', null, st0.title), p,
    h('div', { class: 'tour-actions' },
      last ? h('span') : h('button', { class: 'linkbtn', onclick: () => finishTour(false) }, 'Saltar'),
      h('div', { class: 'row', style: { gap: '8px' } },
        i > 0 ? h('button', { class: 'btn small', onclick: () => tourGo(i - 1) }, 'Atrás') : null,
        h('button', { class: 'btn small primary', id: 'tour-next', onclick: tourNext }, last ? st0.cta || 'Empezar' : i === 0 ? 'Empezar' : 'Siguiente'))));
  p.addEventListener('click', () => Mascot.finishType());
  setTimeout(() => { if (tour && tour.bub === bub && bub.contains(p)) Mascot.type(p, st0.text); }, i === 0 ? 650 : 0);
  setTimeout(() => { const b = $('#tour-next'); if (b) b.focus({ preventScroll: true }); }, 30);
}
function placeTour() {
  if (!tour) return;
  const st0 = tour.steps[tour.i], el = st0.sel ? $(st0.sel) : null, { hole, bub } = tour, pad = 6;
  const g = Mascot.geo || Mascot.layout('tour');
  Object.assign(bub.style, { left: g.left + 'px', bottom: g.bottom + 'px', width: Math.min(360, g.maxW) + 'px' });
  bub.classList.toggle('above', g.above);
  // pantallas chicas: si el globo alcanza lo señalado, baja (sin salirse de la pantalla)
  if (el && !g.above) {
    const r = el.getBoundingClientRect(), b = bub.getBoundingClientRect(), over = r.bottom + 10 - b.top;
    if (over > 0 && r.top < b.top) bub.style.bottom = Math.max(8, g.bottom - over) + 'px';
  }
  if (!el) {
    hole.classList.add('none');
    Object.assign(hole.style, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' });
    return;
  }
  hole.classList.remove('none');
  const r = el.getBoundingClientRect();
  // el recuadro no se sale de la pantalla (las pestañas de abajo quedan pegadas al borde)
  const top = Math.max(2, r.top - pad), bottom = Math.min(innerHeight - 2, r.bottom + pad), left = Math.max(2, r.left - pad), right = Math.min(innerWidth - 2, r.right + pad);
  Object.assign(hole.style, { left: left + 'px', top: top + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
}
function tourNext() { if (!tour) return; if (tour.i >= tour.steps.length - 1) finishTour(true); else tourGo(tour.i + 1); }
function finishTour(play, silent) {
  if (!tour) return;
  document.removeEventListener('keydown', tour.onKey); window.removeEventListener('resize', tour.onResize);
  tour.ov.remove(); tour.bub.remove(); tour = null; lockScroll(false);
  Mascot.hide(!!silent); if (Mascot.el) Mascot.el.classList.remove('in-tour');
  if (S.profile && !S.profile.tutorialDone) { S.profile.tutorialDone = true; save(); }
  if (silent) return;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  if (play) {
    if (schoolGated()) { const r = schRecommended(); if (r) schOpen(r.l.id); return; }
    const w = worldState().find(x => x.unlocked && x.current >= 0); if (w) startLevel(w.key, w.current);
  }
}

// ---------- foto de perfil: se recorta cuadrada y se guarda pequeña (unos 10 KB) junto con el progreso
function pickPhoto() {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept: 'image/*', style: { position: 'fixed', left: '-9999px' } });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return res(null);
      try { res(await shrinkPhoto(f)); } catch (e) { toast(e && e.message === 'grande' ? 'Esa imagen pesa más de 15 MB. Prueba con otra.' : 'No pude leer esa imagen. Prueba con una foto JPG o PNG.'); res(null); }
    });
    document.body.append(inp); inp.click();
  });
}
async function shrinkPhoto(file, size = 192) {
  if (!/^image\//.test(file.type || 'image/')) throw new Error('tipo');
  if (file.size > 15e6) throw new Error('grande');
  // se vuelve a dibujar en un canvas: la foto guardada no conserva metadatos (EXIF, ubicación GPS)
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    let d = cv.toDataURL('image/webp', 0.82);
    if (!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', 0.85);
    return d;
  } finally { URL.revokeObjectURL(url); }
}
// photo: undefined = la del perfil (o la de Google), '' = sin foto
function avatarEl(cls = 'avatar', photo, name) {
  const P = S.profile || {}, A = S.account || {};
  const src = photo !== undefined ? photo : P.photo !== undefined ? P.photo : (A.photo || '');
  const initial = ((name || P.name || A.name || '?').trim().charAt(0) || '?').toUpperCase();
  const el = h('span', { class: cls, 'aria-hidden': 'true' });
  if (src) {
    const im = h('img', { src, alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
    im.addEventListener('error', () => { im.remove(); el.textContent = initial; });
    el.append(im);
  } else el.textContent = initial;
  return el;
}
async function changePhoto() {
  const d = await pickPhoto(); if (!d) return;
  S.profile = Object.assign({}, S.profile, { photo: d }); save();
  renderProgress(); toast('Foto actualizada.');
}

// ---------- tarjeta de cuenta (en Progreso)
function accountCard() {
  const P = S.profile || {}, A = S.account || {};
  const signed = A.provider === 'firebase' && !!Auth.user;
  const sub = signed ? (A.email || 'Cuenta conectada')
    : A.provider === 'firebase' ? 'Conectando con tu cuenta…'
        : 'Sin cuenta: tu progreso se guarda en este navegador';
  const acts = h('div', { class: 'acc-actions' },
    h('button', { class: 'btn small', onclick: () => gate('profile', { edit: true }) }, 'Editar perfil'),
    h('button', { class: 'btn small', onclick: () => startTour() }, 'Ver tutorial'));
  if (signed) {
    const out = h('button', { class: 'btn small', onclick: () => {
      out.replaceWith(h('span', { class: 'confirm' }, h('span', { style: { fontWeight: 700 } }, '¿Cerrar sesión?'),
        h('button', { class: 'btn small', style: { borderColor: 'var(--bad)', color: 'var(--bad)' }, onclick: logout }, 'Sí, salir'),
        h('button', { class: 'btn small', onclick: () => renderProgress() }, 'Cancelar')));
    } }, 'Cerrar sesión');
    acts.append(out);
  } else {
    if (Auth.available()) acts.append(h('button', { class: 'btn small primary', onclick: () => gate('welcome', { upgrade: true }) }, 'Crear cuenta'));
    acts.append(h('button', { class: 'btn small', onclick: askLogout }, 'Cerrar sesión'));
  }
  return h('div', { class: 'card account' },
    h('button', { class: 'avatar-btn', type: 'button', 'aria-label': 'Cambiar foto de perfil', title: 'Cambiar foto', onclick: changePhoto }, avatarEl(), h('span', { class: 'cam' }, icon('i-camera'))),
    h('div', { class: 'acc-info' }, h('strong', null, P.name || 'Jugador'), h('span', { class: 'muted' }, sub)),
    acts);
}
function initAccount() {
  if (!S.profile) gate('welcome');
  if (Auth.available()) {
    const returning = S.account && S.account.provider === 'firebase';
    setTimeout(() => Auth.load().then(fb => attachAuthListener(fb)).catch(() => {
      if (returning) toast('No se pudo conectar con tu cuenta. Tu progreso se guarda en este navegador.');
    }), returning ? 0 : 1500);
  }
}

// ---------------------------------------------------------------- inicio
syncLives();
renderChips();
renderMap(true);
initAccount();
const prevVisit = S.lastVisit || 0;
if (S.profile) { S.lastVisit = Date.now(); localSave(); }
setTimeout(() => {
  if (!S.profile || !S.profile.tutorialDone || S.mascotDay === todayStr() || session || tour || Music.view !== 'map') return;
  if (Mascot.react('greet', { prevVisit })) { S.mascotDay = todayStr(); save(); }
}, 2600);
console.info('De Peón a Rey ' + APP_VERSION);
