/* De Peón a Rey — Escuela de Karen: lecciones paso a paso, títulos por bloque y prácticas contra Karen.
   El contenido (lecciones y frases) está en lessons.js. Este archivo solo declara funciones: se carga antes que app.js
   y todo lo que usa de app.js (tablero, motor, sonidos, Karen) se llama cuando la página ya terminó de cargar. */

// recorte del dibujo de Karen para la Escuela: de la cabeza a la cintura, con espacio para sus reacciones
const KV = { x: -40, y: -215, w: 500, h: 815 };
let LS = null;        // lección abierta
let SCH_TY = null;    // escritura del globo en la portada de la Escuela
const SCH_FEN = {};   // posiciones ya calculadas a partir de jugadas

// ---------------------------------------------------------------- estado y orden
function schState() {
  if (!S.school || typeof S.school !== 'object') S.school = {};
  const s = S.school;
  if (!s.done || typeof s.done !== 'object') s.done = {};
  if (!Array.isArray(s.titles)) s.titles = [];
  return s;
}
function schAll() { return SCHOOL.blocks.flatMap(b => b.lessons.map(l => ({ b, l }))); }
function lessonDone(id) { return (schState().done[id] || 0) > 0; }
function blockDone(b) { return b.lessons.every(l => lessonDone(l.id)); }
function basicsDone() { return SCHOOL.blocks.filter(b => b.kind === 'basic').every(blockDone); }
// quien empezó desde cero tiene cerrados los mundos de táctica hasta terminar lo básico (o decir que ya sabe jugar)
function schoolGated() { const s = schState(); return !!s.needBasics && !s.skip && !basicsDone(); }
function schTheoryOpen() { const s = schState(); return !s.needBasics || !!s.skip || basicsDone(); }
// Dos caminos en orden: lo básico y la teoría. Una lección está lista si las anteriores de su camino ya están hechas;
// si no, Karen recomienda seguir el orden, pero se puede abrir igual.
function schLessonState(b, l) {
  const s = schState();
  if (s.done[l.id]) return 'done';
  if (b.kind === 'theory' && !schTheoryOpen()) return 'closed';
  const path = schAll().filter(x => x.b.kind === b.kind);
  const i = path.findIndex(x => x.l === l);
  return path.slice(0, i).every(x => s.done[x.l.id]) ? 'ready' : 'later';
}
function schRecommended() {
  const s = schState(), L = schAll();
  const basic = L.filter(x => x.b.kind === 'basic'), theory = L.filter(x => x.b.kind === 'theory');
  const order = s.needBasics && !s.skip ? basic.concat(theory) : theory.concat(basic);
  return order.find(x => !s.done[x.l.id] && schLessonState(x.b, x.l) !== 'closed') || null;
}
// título actual: el del último bloque terminado (en el orden del temario)
function schTitle() {
  const B = SCHOOL.blocks;
  if (B.every(blockDone)) return { name: SCHOOL.final.name, piece: SCHOOL.final.piece, final: true };
  const last = B.slice().reverse().find(blockDone);
  return last ? { name: last.title, piece: last.piece, block: last } : { name: SCHOOL.start.name, piece: SCHOOL.start.piece };
}
function schFenOf(line) {
  if (SCH_FEN[line]) return SCH_FEN[line];
  const g = new Chess(); for (const m of line.split(' ').filter(Boolean)) g.move(m, { sloppy: true });
  return (SCH_FEN[line] = g.fen());
}
function schLineMoves(line) { const g = new Chess(); return line.split(' ').filter(Boolean).map(m => g.move(m, { sloppy: true })); }
function schStepFen(s) {
  if (s.from) return schFenOf(s.from);
  if (typeof s.move === 'string' && s.move) return s.move;
  if (typeof s.stars === 'string') return s.stars;
  return s.fen || null;
}
// de qué lado se ve el tablero en una lección: el del bando que juega la persona
function schSideOf(l) {
  for (const s of l.steps) {
    if (s.line) return s.side;
    if (s.play) return s.play.side;
    if ('move' in s) { const f = schStepFen(s); if (f) return f.split(' ')[1]; }
  }
  return 'w';
}
const bareSan = x => x.replace(/[+#!?]/g, '');

// ---------------------------------------------------------------- portada de la Escuela
function renderSchool() {
  renderChips();
  const root = $('#view-school'); root.textContent = '';
  const s = schState(), T = schTitle(), L = schAll(), doneN = L.filter(x => lessonDone(x.l.id)).length, rec = schRecommended();
  const fig = new KarenFig(KV), p = h('p');
  const bubble = h('div', { class: 'speech sc-say', role: 'status', 'aria-live': 'polite', onclick: () => SCH_TY && SCH_TY.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p);
  const earned = SCHOOL.blocks.filter(blockDone);
  const ladder = h('div', { class: 'sc-ladder', 'aria-label': `Títulos: ${earned.length} de ${SCHOOL.blocks.length}` },
    SCHOOL.blocks.map(b => h('span', { class: 'sc-lad' + (blockDone(b) ? ' got' : '') + (T.block === b ? ' now' : ''), title: b.title }, miniPiece(b.piece, 'sc-lad-pc', blockDone(b) ? 'w' : 'b'))));
  root.append(h('div', { class: 'sc-hero' },
    h('div', { class: 'sc-karen' }, h('div', { class: 'kf' }, fig.body), bubble),
    h('div', { class: 'sc-title' },
      h('div', { class: 'sc-medal', 'aria-hidden': 'true' }, miniPiece(T.piece, 'sc-medal-pc')),
      h('div', { class: 'sc-tt' }, h('div', { class: 'section-title' }, 'Tu título en la Escuela'), h('h2', null, T.name),
        h('div', { class: 'sc-count' }, `${doneN} de ${L.length} lecciones`))),
    h('div', { class: 'sc-bar', role: 'progressbar', 'aria-label': 'Lecciones terminadas', 'aria-valuemin': 0, 'aria-valuemax': L.length, 'aria-valuenow': doneN }, h('i', { style: { width: (100 * doneN / L.length) + '%' } })),
    ladder,
    rec ? h('button', { class: 'btn primary big sc-go', onclick: () => schOpen(rec.l.id) }, doneN ? `Seguir: ${rec.l.name}` : `Empezar: ${rec.l.name}`)
      : h('div', { class: 'notice good' }, h('strong', null, '¡Terminaste la Escuela completa! '), 'Repite las lecciones que quieras para conseguir 3 estrellas.')));
  // Karen saluda en la portada
  let text;
  if (!rec) text = SCHOOL.final.lines[1];
  else if (!doneN) text = s.needBasics && !s.skip ? '¡Hola! Aquí te enseño ajedrez desde cero. Empezamos por el tablero y las piezas, poquito a poquito.'
    : '¡Hola! Como ya sabes jugar, te recomiendo empezar por la teoría. Si quieres repasar lo básico, también está aquí.';
  else text = karenLine('schoolHello') + ' ' + karenLine('lessonStart', { lesson: rec.l.name });
  fig.pose({ mood: 'wave', emote: 'sparkle' });
  if (!SCH_TY) SCH_TY = new Typer();
  setTimeout(() => { if (p.isConnected) SCH_TY.type(p, text, fig); }, reduceMotion ? 0 : 350);

  const blocks = SCHOOL.blocks;
  let num = 0;
  root.append(h('div', { class: 'sc-sec' }, h('h2', null, 'Lo básico'),
    h('p', null, s.needBasics && !s.skip ? 'Desde cero: el tablero, las piezas, las reglas y tus primeros mates.' : 'Si ya sabes jugar es opcional, pero cada bloque también te da su título.')));
  for (const b of blocks.filter(x => x.kind === 'basic')) root.append(schBlockCard(b, ++num, rec));
  root.append(h('div', { class: 'sc-sec' }, h('h2', null, 'Teoría'),
    h('p', null, 'En el orden que recomiendan entrenadores y libros: primero los principios y los finales, luego las aperturas y al final los planes del medio juego.')));
  if (!schTheoryOpen()) {
    root.append(h('div', { class: 'sc-lock' },
      h('strong', null, 'Se abre al terminar lo básico'),
      h('p', null, 'Las aperturas tienen más sentido cuando ya sabes mover las piezas y dar mate. Si ya sabes jugar, ábrela ahora.'),
      h('button', { class: 'btn small', onclick: () => schSkipBasics() }, 'Ya sé jugar')));
  }
  for (const b of blocks.filter(x => x.kind === 'theory')) root.append(schBlockCard(b, ++num, rec));
  root.append(h('p', { class: 'credits' }, 'Cada posición y cada jugada de las lecciones se revisó con Stockfish. Las aperturas siguen las líneas principales de la teoría; sus nombres vienen del libro de aperturas de Lichess.'));
}
function schBlockCard(b, num, rec) {
  const done = blockDone(b), closed = b.kind === 'theory' && !schTheoryOpen();
  const n = b.lessons.filter(l => lessonDone(l.id)).length;
  return h('section', { class: 'sb' + (done ? ' done' : '') + (closed ? ' closed' : ''), id: 'sb-' + b.id },
    h('div', { class: 'sb-head' },
      h('div', { class: 'sb-top' }, h('span', { class: 'sb-tag' }, `Bloque ${num}`), h('span', { class: 'sb-n' }, `${n} de ${b.lessons.length}`)),
      h('h3', null, b.name), h('p', null, b.blurb)),
    h('ol', { class: 'sl' }, b.lessons.map(l => {
      const st = schLessonState(b, l), stars = schState().done[l.id] || 0, isRec = rec && rec.l === l;
      const sub = isRec ? (stars ? '' : 'Te toca') : st === 'closed' ? 'Termina lo básico' : st === 'later' ? 'Más adelante' : '';
      return h('li', null, h('button', { class: 'sl-row ' + st + (isRec ? ' cur' : ''), type: 'button', onclick: () => schTap(b, l, st),
        'aria-label': `${l.name}${stars ? `, ${stars} estrellas` : ''}${isRec ? ', te toca' : st === 'closed' ? ', bloqueada' : ''}` },
        h('span', { class: 'sl-node', 'aria-hidden': 'true' }, st === 'closed' ? icon('i-lock') : miniPiece(l.piece, 'sl-pc', isRec || stars ? 'w' : 'b')),
        h('span', { class: 'sl-txt' }, h('strong', null, l.name), sub ? h('small', null, sub) : null),
        stars ? h('span', { class: 'sl-stars', 'aria-hidden': 'true' }, [0, 1, 2].map(k => icon('i-star', k < stars ? 'on' : 'off'))) : null));
    })),
    h('div', { class: 'sb-title' + (done ? ' got' : '') }, miniPiece(b.piece, 'sb-title-pc', done ? 'w' : 'b'),
      h('span', null, done ? 'Título ganado: ' : 'Al terminar ganas el título ', h('strong', null, b.title))));
}
function schSkipBasics() { schState().skip = true; save(); renderSchool(); toast('Listo: la teoría y los mundos de táctica quedaron abiertos.'); }
function schTap(b, l, st) {
  if (st === 'closed') {
    return schModal('La teoría se abre después de lo básico', 'Termina los tres bloques de lo básico. Si ya sabes jugar, puedes abrirla ahora.',
      [['Ya sé jugar', () => schSkipBasics(), 'primary'], ['Seguir con lo básico', null]]);
  }
  if (st === 'later') {
    const path = schAll().filter(x => x.b.kind === b.kind), prev = path.find(x => !lessonDone(x.l.id));
    return schModal(`Antes viene «${prev.l.name}»`, 'Te recomiendo seguir el orden: cada lección usa lo de la anterior. Pero si ya lo sabes, ábrela.',
      [[`Ir a «${prev.l.name}»`, () => schOpen(prev.l.id), 'primary'], ['Abrirla de todos modos', () => schOpen(l.id)], ['Cancelar', null, 'ghost']]);
  }
  schOpen(l.id);
}
function schModal(title, text, buttons) {
  for (const old of $$('.modal')) old.remove();
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sm-t', onclick: e => { if (e.target === ov) close(); } },
    h('div', { class: 'modal-card' }, h('h2', { id: 'sm-t' }, title), h('p', { class: 'muted' }, text),
      h('div', { class: 'stack' }, buttons.map(([label, fn, cls]) => h('button', { class: 'btn' + (cls ? ' ' + cls : ''), onclick: () => { close(); if (fn) fn(); } }, label)))));
  document.body.append(ov); document.addEventListener('keydown', onKey);
  setTimeout(() => { const b = $('.modal .btn'); if (b) b.focus(); }, 30);
}
// tarjeta del mapa para quien empieza desde cero
function schoolCta() {
  const rec = schRecommended(), fig = new KarenFig(KV);
  // señala al botón para empezar (cuando la tarjeta ya está en la página)
  fig.pointAt = () => card.querySelector('.btn.primary');
  const card = h('div', { class: 'school-cta' },
    h('div', { class: 'kf' }, fig.body),
    h('div', { class: 'cta-txt' },
      h('h3', null, 'Primero, lo básico'),
      h('p', null, 'Aprende a mover las piezas en la Escuela de Karen. Los mundos de táctica se abren al terminar lo básico.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onclick: () => (rec ? schOpen(rec.l.id) : setTab('school')) }, rec && lessonDone(SCHOOL.blocks[0].lessons[0].id) ? 'Seguir aprendiendo' : 'Empezar a aprender'),
        h('button', { class: 'linkbtn', onclick: () => { schState().skip = true; save(); renderMap(); toast('Listo: los mundos de táctica quedaron abiertos.'); } }, 'Ya sé jugar'))));
  fig.pose({ mood: 'idle' });
  requestAnimationFrame(() => requestAnimationFrame(() => { if (card.isConnected) fig.pose({ mood: 'point', emote: 'idea' }); }));
  return card;
}
// tarjeta en Progreso
function schoolProgressCard() {
  const T = schTitle(), L = schAll(), n = L.filter(x => lessonDone(x.l.id)).length;
  return h('div', { class: 'card sc-pcard' },
    h('div', { class: 'sc-medal', 'aria-hidden': 'true' }, miniPiece(T.piece, 'sc-medal-pc')),
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Escuela de Karen'),
      h('h3', null, T.name),
      h('div', { class: 'muted', style: { fontSize: '14px' } }, `${n} de ${L.length} lecciones, ${SCHOOL.blocks.filter(blockDone).length} de ${SCHOOL.blocks.length} títulos`)),
    h('button', { class: 'btn small', onclick: () => setTab('school') }, 'Ir a la Escuela'));
}

// ---------------------------------------------------------------- lección
function schOpen(id) {
  const x = schAll().find(y => y.l.id === id); if (!x) return;
  if (session) { session = null; if (board) { board.setInteractive(false); board.setPick(null); } }
  if (LS) schClose(true);
  if (tour) finishTour(false, true);
  Mascot.hide(true); if (SCH_TY) SCH_TY.stop();
  const root = $('#view-lesson'); root.textContent = '';
  LS = { b: x.b, l: x.l, i: -1, mistakes: 0, forced: false, tok: {}, side: schSideOf(x.l), ty: new Typer(), fig: new KarenFig(KV) };
  const p = h('p');
  const bub = h('div', { class: 'speech ls-say', role: 'status', 'aria-live': 'polite', onclick: () => LS && LS.ty.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p);
  const prog = h('div', { class: 'ls-prog', role: 'progressbar', 'aria-label': 'Avance de la lección', 'aria-valuemin': 0, 'aria-valuemax': x.l.steps.length, 'aria-valuenow': 0 }, h('i'));
  const host = h('div', { class: 'ls-board' }), panel = h('div', { class: 'ls-panel', hidden: true }), info = h('div', { class: 'ls-info', 'aria-live': 'polite' });
  const acts = h('div', { class: 'ls-acts' });
  root.append(
    h('div', { class: 'ls-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Salir de la lección', onclick: () => schAskExit() }, icon('i-close')),
      h('div', { class: 't' }, h('div', { class: 'ls-tl' }, h('h2', null, x.l.name), h('span', null, x.b.name)), prog)),
    h('div', { class: 'ls-grid' },
      h('div', { class: 'ls-karen' }, h('div', { class: 'kf' }, LS.fig.body), bub),
      h('div', { class: 'ls-stage' }, host, panel, info),
      acts));
  Object.assign(LS, { p, bub, prog, host, panel, info, acts });
  LS.board = new Board(host);
  LS.fig.pointAt = () => (LS && LS.host && !LS.host.hidden ? LS.board.wrap : null); // al explicar, señala al tablero
  if (LS.side === 'b') LS.board.flip('b');
  currentTab = 'school';
  for (const t of $$('.tab')) t.setAttribute('aria-selected', t.dataset.tab === 'school' ? 'true' : 'false');
  showView('lesson');
  LS.onKey = e => { if (e.key === 'Escape' && !$('.modal') && !$('.title-ov')) schAskExit(); };
  document.addEventListener('keydown', LS.onKey);
  schNext();
}
function schClose(silent) {
  if (!LS) return;
  LS.ty.stop(); LS.tok = {}; LS.fig.stopTalk();
  if (LS.board) { LS.board.setInteractive(false); LS.board.setPick(null); LS.board.onMove = null; }
  document.removeEventListener('keydown', LS.onKey);
  LS = null;
  if (!silent) setTab('school');
}
function schAskExit() {
  if (!LS) return;
  if (LS.i <= 0 || LS.finished) return schClose();
  schModal('¿Salir de la lección?', 'Lo que llevas de esta lección se pierde. Las estrellas que ya tenías se quedan.',
    [['Seguir aprendiendo', null, 'primary'], ['Salir', () => schClose()]]);
}
// Karen habla en el globo de la lección; la promesa se cumple cuando termina de escribir
function schSay(text, o) {
  if (!LS) return Promise.resolve();
  if (o) LS.fig.pose(o);
  const L0 = LS;
  return new Promise(res => L0.ty.type(L0.p, text, L0.fig, res));
}
const SCH_RIGHT = [{ mood: 'happy', emote: 'sparkle' }, { mood: 'cheer', emote: 'heart' }, { mood: 'happy' }, { mood: 'cheer', emote: 'sparkle' }];
const SCH_WRONG = [{ mood: 'worry', emote: 'sweat' }, { mood: 'think', emote: 'question' }, { mood: 'worry' }];
const schPick = a => a[Math.floor(Math.random() * a.length)];
function schActs(...nodes) {
  if (!LS) return;
  LS.acts.textContent = ''; LS.acts.append(...nodes.flat().filter(Boolean));
  const nx = $('.ls-next', LS.acts); if (nx) setTimeout(() => { if (nx.isConnected) nx.focus({ preventScroll: true }); }, 30);
  // en pantallas chicas: si los botones quedaron abajo de la pantalla, se suben a la vista
  const last = LS.acts.lastElementChild;
  if (last) setTimeout(() => { if (last.isConnected && last.getBoundingClientRect().bottom > innerHeight - 4) last.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' }); }, 60);
}
function schNextBtn(label, fn) { return h('button', { class: 'btn primary ls-next', onclick: fn || (() => schNext()) }, label || 'Siguiente'); }
function schInfo(text) { if (LS) LS.info.textContent = text || ''; }
function schBoard(fen, side) {
  const B = LS.board; B.setPick(null); B.setInteractive(false); B.onMove = null;
  LS.host.hidden = false; LS.panel.hidden = true;
  if (side && B.orient !== side) B.flip(side);
  B.setPosition(fen); schDeco([], []); schStarsOn([]);
}
function schDeco(marks, arrows) {
  const B = LS.board;
  for (const el of B.el.querySelectorAll('.sq-mk')) el.remove();
  for (const sq of marks || []) if (B.sqs[sq]) B.sqs[sq].append(h('span', { class: 'sq-mk', 'aria-hidden': 'true' }));
  B.arrows((arrows || []).map(a => {
    const t = typeof a === 'string' ? a : a.a, c = typeof a === 'string' ? null : a.c;
    return { from: t.slice(0, 2), to: t.slice(2, 4), color: c === 'bad' ? 'var(--bad)' : c === 'good' ? 'var(--good)' : RED };
  }));
}
function schStarsOn(squares) {
  const B = LS.board;
  for (const el of B.el.querySelectorAll('.sq-star')) el.remove();
  for (const sq of squares) if (B.sqs[sq]) B.sqs[sq].append(h('span', { class: 'sq-star', 'aria-hidden': 'true' }, icon('i-star')));
}
function schMiss(from, to) {
  LS.mistakes++;
  const B = LS.board; B.shake();
  if (from) B.mark(from, 'bad'); if (to) B.mark(to, 'bad');
  setTimeout(() => B.clearMarks(['bad']), 650);
  Sound.play('wrong'); haptic(60);
}
function schProg() {
  const n = LS.l.steps.length, k = Math.min(n, Math.max(0, LS.i));
  $('i', LS.prog).style.width = (100 * k / n) + '%'; LS.prog.setAttribute('aria-valuenow', k);
}
async function schAnim(sans, tok) {
  for (const san of sans.split(' ').filter(Boolean)) {
    await sleep(reduceMotion ? 200 : 650);
    if (!LS || LS.tok !== tok) return false;
    const g = new Chess(LS.board.fen), m = g.move(san, { sloppy: true }); if (!m) return false;
    LS.board.setPosition(g.fen(), { last: [m.from, m.to], animate: [m.from, m.to] }); Sound.play(sfxForSan(m.san));
  }
  return true;
}
function schNext() {
  if (!LS) return;
  LS.i++; LS.tok = {}; LS.sm = 0; schProg(); schInfo('');
  const B = LS.board; B.setPick(null); B.setInteractive(false); B.onMove = null; B.clearMarks(['hint', 'good', 'bad']);
  const s = LS.l.steps[LS.i];
  if (!s) return schFinish();
  if ('recap' in s) return schRecap(s);
  if ('tap' in s) return schTapStep(s);
  if ('stars' in s) return schStarsStep(s);
  if ('move' in s) return schMoveStep(s);
  if ('line' in s) return schLineStep(s);
  if ('quiz' in s) return schQuizStep(s);
  if ('play' in s) return schPlayStep(s);
  return schSayStep(s);
}

// Karen explica (uno o varios globos), con posición, casillas marcadas, flechas o jugadas animadas
async function schSayStep(s) {
  const tok = LS.tok, texts = [].concat(s.say), fen = schStepFen(s);
  if (fen) schBoard(fen, LS.side); else schDeco([], []);
  const pose = { mood: s.mood || 'idle', prop: s.prop || null, emote: s.emote || null };
  let k = 0;
  const show = () => {
    if (!LS || LS.tok !== tok) return;
    schSay(texts[k], k === 0 ? pose : null);
    const last = k === texts.length - 1;
    schActs(schNextBtn('Siguiente', () => { if (!LS || LS.tok !== tok) return; if (LS.ty.cur) { LS.ty.finish(); return; } if (last) schNext(); else { k++; show(); } }));
  };
  show();
  if (fen && s.anim) { const ok = await schAnim(s.anim, tok); if (!ok) return; }
  if (LS && LS.tok === tok) schDeco(s.marks, s.arrows);
}
// tocar una casilla
function schTapStep(s) {
  const tok = LS.tok, fen = schStepFen(s);
  if (fen) schBoard(fen, LS.side); else schDeco([], []);
  schSay(s.say, { mood: 'point' });
  schActs();
  const B = LS.board;
  B.setPick(sq => {
    if (!LS || LS.tok !== tok) return;
    if (sq === s.tap) {
      B.setPick(null); B.clearMarks(['hint']); B.mark(sq, 'good');
      Sound.play('correct'); haptic(15);
      schSay(karenLine('right'), schPick(SCH_RIGHT));
      schActs(schNextBtn());
    } else {
      schMiss(sq); LS.sm++;
      if (LS.sm >= 2) B.mark(s.tap, 'hint');
      schSay(`Esa es ${sq}. Busca la columna ${s.tap[0]} (las letras de abajo) y la fila ${s.tap[1]} (los números del lado).`, schPick(SCH_WRONG));
    }
  });
}
// recoger estrellas o capturar todo: solo mueven tus piezas
function schStarsStep(s) {
  const tok = LS.tok, B = LS.board;
  schBoard(s.stars, 'w');
  const left = new Set(s.goal || []);
  const blacks = fen => Object.values(parseFen(fen)).filter(p => p[0] === 'b').length;
  schStarsOn([...left]);
  schSay(s.say, { mood: 'point', emote: s.eat ? 'exclaim' : 'sparkle' });
  let moves = 0;
  const target = s.eat ? blacks(s.stars) : left.size;
  schInfo(s.eat ? `Faltan ${target}` : `Estrellas: 0 de ${target}`);
  schActs();
  B.setInteractive(true);
  B.onMove = (from, to, promo, dragged) => {
    if (!LS || LS.tok !== tok) return;
    const g = new Chess(B.fen), mv = g.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
    const parts = g.fen().split(' '); parts[1] = 'w'; parts[3] = '-';
    B.setPosition(parts.join(' '), { last: [from, to], animate: dragged ? null : [from, to] });
    Sound.play(sfxForSan(mv.san)); moves++;
    let got = false;
    if (left.has(to)) { left.delete(to); got = true; Sound.play('star', 0.05, Math.min(2, target - left.size - 1)); }
    schStarsOn([...left]);
    const remain = s.eat ? blacks(B.fen) : left.size;
    schInfo(s.eat ? (remain ? `Faltan ${remain}` : '') : `Estrellas: ${target - remain} de ${target}`);
    if (got) B.mark(to, 'good');
    if (!remain) {
      B.setInteractive(false); B.onMove = null; B.mark(to, 'good');
      Sound.play('correct', 0.15); haptic(18);
      schSay(karenLine('starsDone') + (moves <= target ? ' ¡Y sin pasos de más!' : ''), schPick(SCH_RIGHT));
      schActs(schNextBtn());
    }
  };
}
// encontrar la jugada
function schMoveStep(s) {
  const tok = LS.tok, fen = schStepFen(s), B = LS.board, g = new Chess(fen), side = g.turn();
  schBoard(fen, side);
  schDeco(s.marks, s.arrows);
  schSay(s.say, { mood: 'think', emote: s.emote || null });
  const ans0 = s.ans[0], show0 = () => { const h0 = new Chess(fen), m = h0.move(ans0, { sloppy: true }); return m; };
  const hint = h('button', { class: 'btn', onclick: () => {
    if (!LS || LS.tok !== tok) return;
    const m = show0(); if (!m) return;
    LS.mistakes++; B.clearMarks(['hint']); B.mark(m.from, 'hint'); Sound.play('hint');
    schSay('Pista: mueve esta pieza.', { mood: 'point', emote: 'idea' });
  } }, icon('i-bulb'), 'Pista');
  schActs(hint);
  B.setInteractive(true);
  B.onMove = async (from, to, promo, dragged) => {
    if (!LS || LS.tok !== tok) return;
    const before = g.fen(), mv = g.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
    const ok = s.ans.some(a => bareSan(a) === bareSan(mv.san)) || (s.mate && g.in_checkmate());
    B.setPosition(g.fen(), { last: [from, to], animate: dragged ? null : [from, to] }); Sound.play(sfxForSan(mv.san));
    if (ok) {
      B.setInteractive(false); B.onMove = null; B.mark(to, 'good');
      Sound.play('correct', 0.12); haptic(18);
      schSay(s.ok || karenLine('right'), schPick(SCH_RIGHT));
      schActs();
      if (s.reply) {
        await sleep(reduceMotion ? 200 : 750); if (!LS || LS.tok !== tok) return;
        const r = g.move(s.reply, { sloppy: true }); if (r) { B.setPosition(g.fen(), { last: [r.from, r.to], animate: [r.from, r.to] }); Sound.play(sfxForSan(r.san)); }
      }
      schActs(schNextBtn());
      return;
    }
    g.undo(); B.setInteractive(false);
    await sleep(reduceMotion ? 80 : 320); if (!LS || LS.tok !== tok) return;
    B.setPosition(before); schDeco(s.marks, s.arrows);
    schMiss(from, to); LS.sm++;
    if (LS.sm >= 2) {
      const m = show0();
      B.onMove = null;
      schDeco([], [{ a: m.from + m.to, c: 'good' }]);
      schSay(karenLine('wrong2', { move: es(m.san) }), { mood: 'worry', emote: 'sweat' });
      await sleep(reduceMotion ? 300 : 1400); if (!LS || LS.tok !== tok) return;
      g.move(m); B.setPosition(g.fen(), { last: [m.from, m.to], animate: [m.from, m.to] }); Sound.play(sfxForSan(m.san));
      schActs(schNextBtn());
    } else {
      B.setInteractive(true);
      schSay(s.no || karenLine('wrong'), schPick(SCH_WRONG));
    }
  };
}
// jugar una apertura con Karen: tú sigues la flecha y ella te explica cada jugada
async function schLineStep(s) {
  const tok = LS.tok, B = LS.board, moves = schLineMoves(s.line), g = new Chess(), notes = s.notes || {};
  schBoard(g.fen(), s.side);
  let ply = 0;
  schActs();
  const guide = () => { const m = moves[ply]; schDeco([], [m.from + m.to]); B.setInteractive(true); schInfo(`Juega ${schMoveNo(ply)}${es(m.san)}`); };
  const finish = async () => {
    B.setInteractive(false); B.onMove = null; schDeco([], []); schInfo('');
    await sleep(reduceMotion ? 100 : 500); if (!LS || LS.tok !== tok) return;
    schSay(`¡Listo! Esa es la línea de ${LS.l.name}. En la práctica la vas a jugar de memoria.`, { mood: 'cheer', emote: 'sparkle' });
    schActs(schNextBtn());
  };
  const advance = async () => {
    while (LS && LS.tok === tok && ply < moves.length) {
      if (g.turn() === s.side) return guide();
      await sleep(reduceMotion ? 150 : 650); if (!LS || LS.tok !== tok) return;
      const m = moves[ply]; g.move(m);
      B.setPosition(g.fen(), { last: [m.from, m.to], animate: [m.from, m.to] }); Sound.play(sfxForSan(m.san));
      const note = notes[ply]; ply++;
      if (note) { schDeco([], []); const p = schSay(note, { mood: 'point' }); if (ply < moves.length && g.turn() !== s.side) await p; }
    }
    if (LS && LS.tok === tok && ply >= moves.length) finish();
  };
  B.onMove = async (from, to, promo, dragged) => {
    if (!LS || LS.tok !== tok || ply >= moves.length) return;
    const exp = moves[ply], before = g.fen(), mv = g.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
    if (mv.san !== exp.san) {
      g.undo(); B.setPosition(before, { last: B.last }); schMiss(from, to);
      schDeco([], [exp.from + exp.to]);
      schSay(`Sigue la flecha: ${es(exp.san)}.`, { mood: 'think', emote: 'question' });
      return;
    }
    B.setInteractive(false);
    B.setPosition(g.fen(), { last: [from, to], animate: dragged ? null : [from, to] }); Sound.play(sfxForSan(mv.san)); schInfo('');
    const note = notes[ply]; ply++;
    if (note) { await schSay(note, { mood: 'happy' }); if (!LS || LS.tok !== tok) return; await sleep(reduceMotion ? 100 : 500); }
    advance();
  };
  await schSay(s.say, { mood: 'point', emote: 'sparkle' });
  if (!LS || LS.tok !== tok) return;
  advance();
}
const schMoveNo = ply => Math.floor(ply / 2) + 1 + (ply % 2 ? '...' : '.');
// pregunta con opciones
function schQuizStep(s) {
  const tok = LS.tok, fen = schStepFen(s);
  if (fen) schBoard(fen, LS.side); else schDeco([], []);
  schDeco(s.marks, s.arrows);
  schSay(s.quiz, { mood: 'think', emote: 'question' });
  const btns = s.opts.map((o, i) => h('button', { class: 'btn ls-opt', onclick: () => answer(i) }, o));
  const answer = i => {
    if (!LS || LS.tok !== tok) return;
    btns.forEach(b => { b.disabled = true; });
    btns[s.ans].classList.add('ok');
    if (i === s.ans) { Sound.play('correct'); haptic(15); schSay(karenLine('right') + ' ' + s.why, schPick(SCH_RIGHT)); }
    else { btns[i].classList.add('ko'); LS.mistakes++; Sound.play('wrong'); haptic(60); schSay(`Era «${s.opts[s.ans]}». ${s.why}`, schPick(SCH_WRONG)); }
    schActs(h('div', { class: 'ls-opts' }, btns), schNextBtn());
  };
  schActs(h('div', { class: 'ls-opts' }, btns));
}
// resumen final de la lección: una hoja de cuaderno en lugar del tablero
function schRecap(s) {
  LS.host.hidden = true; LS.panel.hidden = false; LS.panel.textContent = '';
  LS.panel.append(h('div', { class: 'ls-recap' }, h('h3', null, 'Lo que aprendiste'), h('ul', null, s.recap.map(t => h('li', null, t)))));
  schSay(schPick(['Repasemos lo más importante.', 'Resumen rápido, para que no se te olvide.', 'Esto es lo que te llevas de esta lección.', 'Antes de terminar, lo más importante.']), { mood: 'happy', prop: 'glasses' });
  schActs(schNextBtn('Terminar lección'));
}

// ---------------------------------------------------------------- práctica contra Karen
// Metas: mate | promote (coronar) | hold (aguantar n jugadas) | opening (jugar la línea de memoria y seguir n jugadas)
//        principles (n jugadas con desarrollo, enroque y sin regalar material) | game (partida completa)
async function schPlayStep(s) {
  const tok = LS.tok, B = LS.board, p = s.play;
  const P = LS.P = { p, side: p.side, g: new Chess(p.fen || START), user: 0, line: p.line ? schLineMoves(p.line) : null, li: 0, over: false, castled: false, startEval: null, fails: LS.P && LS.P.p === p ? LS.P.fails : 0, said: 0 };
  schBoard(P.g.fen(), p.side);
  const hint = h('button', { class: 'btn', onclick: () => schPlayHint(tok) }, icon('i-bulb'), 'Pista');
  const quit = p.goal === 'game' ? h('button', { class: 'btn', onclick: () => { if (LS && LS.tok === tok && !P.over) schPlayEnd(tok, 'lose', 'Te rendiste. No pasa nada: la próxima partida la ganas tú.'); } }, 'Rendirse') : null;
  schActs(hint, quit);
  schPlayInfo();
  B.onMove = (from, to, promo, dragged) => schPlayUser(tok, from, to, promo, dragged);
  await schSay(s.say, { mood: 'cheer', emote: 'sparkle' });
  if (!LS || LS.tok !== tok) return;
  schPlayTurn(tok);
}
function schPlayInfo() {
  const P = LS.P, p = P.p, n = p.n;
  let t = '';
  if (P.line && P.li < P.line.length) t = `Juega la línea de memoria: ${Math.ceil(P.li / 2)} de ${Math.ceil(P.line.length / 2)}`;
  else if (p.goal === 'mate') t = `Tus jugadas: ${P.user} de ${n} como máximo`;
  else if (p.goal === 'promote') t = `Tus jugadas: ${P.user} de ${n} como máximo`;
  else if (p.goal === 'hold' || p.goal === 'opening' || p.goal === 'principles') t = `Tus jugadas: ${P.user} de ${n}`;
  else if (p.goal === 'game') t = P.g.history().length ? `Jugada ${Math.floor(P.g.history().length / 2) + 1}` : '';
  schInfo(t);
}
function schPlayTurn(tok) {
  if (!LS || LS.tok !== tok || LS.P.over) return;
  const P = LS.P;
  if (P.g.turn() === P.side) { LS.board.setInteractive(true); LS.fig.pose({ mood: 'idle' }); return; }
  schKarenTurn(tok);
}
async function schKarenTurn(tok) {
  const P = LS.P, B = LS.board; B.setInteractive(false);
  const book = P.line && P.li < P.line.length;
  const t0 = Date.now();
  let mv = null;
  if (book) mv = P.line[P.li];
  else {
    const slow = setTimeout(() => { if (LS && LS.tok === tok) LS.fig.pose({ mood: 'think', emote: 'think' }); }, 400);
    mv = await karenMove(P.g.fen(), P.p.level);
    clearTimeout(slow);
  }
  await sleep(Math.max(0, (reduceMotion ? 150 : 550) - (Date.now() - t0)));
  if (!LS || LS.tok !== tok || P.over || !mv) return;
  const r = P.g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' }); if (!r) return;
  if (book) P.li++;
  B.setPosition(P.g.fen(), { last: [r.from, r.to], animate: [r.from, r.to] }); Sound.play(sfxForSan(r.san));
  LS.fig.pose({ mood: 'idle' });
  P.said++;
  if (!book && !P.g.game_over() && P.said >= 3 && Math.random() < 0.3 && !LS.ty.cur) { P.said = 0; schSay(karenLine('karenMove'), { mood: 'point' }); }
  P.lastKaren = r;
  schPlayAfter(tok, false);
}
async function schPlayUser(tok, from, to, promo, dragged) {
  if (!LS || LS.tok !== tok) return;
  const P = LS.P, B = LS.board; if (P.over || P.g.turn() !== P.side) return;
  const before = P.g.fen(), mv = P.g.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
  if (P.line && P.li < P.line.length) {
    const exp = P.line[P.li];
    if (mv.san !== exp.san) {
      P.g.undo(); B.setPosition(before, { last: B.last }); schMiss(from, to);
      schDeco([], [exp.from + exp.to]);
      schSay(`En ${LS.l.name.replace(/^(La|El|Los|Las) /, m => m.toLowerCase())} aquí se juega ${es(exp.san)}. Sigue la flecha.`, schPick(SCH_WRONG));
      return;
    }
    P.li++;
  } else P.user++;
  if (mv.flags.includes('k') || mv.flags.includes('q')) P.castled = true;
  B.setInteractive(false);
  B.setPosition(P.g.fen(), { last: [from, to], animate: dragged ? null : [from, to] }); Sound.play(sfxForSan(mv.san));
  if (P.line && P.li === P.line.length && P.startEval === null) {
    P.startEval = 'pending';
    schEvalFor(P.g.fen(), P.side).then(v => { if (LS && LS.P === P) P.startEval = v; });
    schSay(`¡Línea completa! Ahora seguimos jugando: ${P.p.n} jugadas más.`, { mood: 'cheer', emote: 'sparkle' });
  } else if (mv.captured && VAL[mv.captured] >= 3 && !LS.ty.cur) LS.fig.pose({ mood: 'surprise', emote: 'exclaim' });
  P.lastUser = mv;
  schPlayAfter(tok, true);
}
async function schPlayAfter(tok, byUser) {
  const P = LS.P, g = P.g, p = P.p, n = p.n;
  schPlayInfo();
  if (g.in_checkmate()) return schPlayEnd(tok, byUser ? 'win' : 'lose', byUser ? null : 'Te di mate. ¡Revancha!');
  if (g.in_draw() || g.in_stalemate() || g.in_threefold_repetition()) {
    if (p.goal === 'hold') return schPlayEnd(tok, 'win', '¡Tablas! Aguantaste: eso era lo que había que hacer.');
    return schPlayEnd(tok, 'draw', g.in_stalemate() ? 'Ahogado: el rey no tenía jugadas y no estaba en jaque. Eso es tablas. Déjale siempre una casilla libre.' : karenLine('playDraw'));
  }
  if (p.goal === 'promote') {
    if (byUser && P.lastUser.promotion) return schPlayEnd(tok, 'win', '¡Coronaste!');
    if (!byUser && P.lastKaren && P.lastKaren.captured === 'p' && !Object.values(parseFen(g.fen())).includes(P.side + 'p')) return schPlayEnd(tok, 'lose', 'Me comí tu peón. Revisa la técnica e inténtalo de nuevo.');
    if (byUser && P.user >= n) return schPlayEnd(tok, 'lose', `Se acabaron las ${n} jugadas. Inténtalo otra vez, más directo.`);
  }
  if (p.goal === 'mate' && byUser && P.user >= n) return schPlayEnd(tok, 'lose', `Se acabaron las ${n} jugadas. Recuerda: encierra al rey en una caja cada vez más chica.`);
  if (p.goal === 'hold') {
    if (!byUser && P.lastKaren && P.lastKaren.promotion) return schPlayEnd(tok, 'lose', 'Coroné mi peón. Recuerda: tu torre en la sexta fila mientras el peón no avance.');
    if (byUser && P.user >= n) {
      LS.board.setInteractive(false); schInfo('Revisando la posición…');
      const v = await schEvalFor(g.fen(), P.side); if (!LS || LS.tok !== tok) return;
      return v === null || v > -250 ? schPlayEnd(tok, 'win', `¡Aguantaste las ${n} jugadas!`) : schPlayEnd(tok, 'lose', 'Aguantaste, pero tu posición quedó perdida. Inténtalo otra vez.');
    }
  }
  if (p.goal === 'opening' && byUser && (!P.line || P.li >= P.line.length) && P.user >= n) {
    LS.board.setInteractive(false); schInfo('Revisando la posición…');
    const v = await schEvalFor(g.fen(), P.side); if (!LS || LS.tok !== tok) return;
    const base = typeof P.startEval === 'number' ? P.startEval : 0;
    if (v === null || v >= base - 150) return schPlayEnd(tok, 'win', v !== null && v > base + 80 ? '¡Y hasta mejoraste la posición!' : 'Saliste de la apertura con una buena posición.');
    return schPlayEnd(tok, 'lose', 'Saliste de la apertura, pero perdiste material o la posición se complicó. Inténtalo con calma.');
  }
  if (p.goal === 'principles' && byUser && P.user >= n) {
    LS.board.setInteractive(false); schInfo('Revisando tus jugadas…');
    const v = await schEvalFor(g.fen(), P.side); if (!LS || LS.tok !== tok) return;
    const map = parseFen(g.fen()), home = P.side === 'w' ? { b1: 'n', g1: 'n', c1: 'b', f1: 'b' } : { b8: 'n', g8: 'n', c8: 'b', f8: 'b' };
    const dev = Object.entries(home).filter(([sq, t]) => map[sq] !== P.side + t).length;
    const material = v === null ? balanceFor(g.fen(), P.side) >= -1 : v >= -150;
    const miss = [];
    if (dev < 3) miss.push('sacar más caballos y alfiles');
    if (!P.castled) miss.push('enrocar');
    if (!material) miss.push('no regalar material');
    if (!miss.length) return schPlayEnd(tok, 'win', `Sacaste ${dev} piezas, enrocaste y no regalaste nada.`);
    return schPlayEnd(tok, 'lose', 'Te faltó ' + miss.join(', ').replace(/, ([^,]*)$/, ' y $1') + '. ¡Otra vez!');
  }
  schPlayTurn(tok);
}
function schPlayEnd(tok, result, msg) {
  if (!LS || LS.tok !== tok) return;
  const P = LS.P; P.over = true;
  const B = LS.board; B.setInteractive(false); schInfo('');
  if (result === 'win') {
    Sound.play('correct', 0.1); Sound.play('brilliant', 0.35); haptic(30);
    schSay(karenLine('playWin') + (msg ? ' ' + msg : ''), { mood: 'cheer', emote: 'sparkle', prop: P.p.goal === 'game' ? 'crown' : null });
    if (P.p.goal === 'game') setTimeout(() => celebrate(['#e3141b', '#1b1424', '#ffffff', '--brass']), 300);
    schActs(schNextBtn());
    return;
  }
  P.fails++; LS.mistakes++;
  Sound.play('lose', 0.1);
  schSay(msg || karenLine(result === 'draw' ? 'playDraw' : 'playFail'), { mood: 'worry', emote: 'sweat' });
  const step = LS.l.steps[LS.i];
  schActs(
    h('button', { class: 'btn primary ls-next', onclick: () => { if (!LS) return; LS.tok = {}; schPlayStep(step); } }, 'Intentar otra vez'),
    h('button', { class: 'btn', onclick: () => { if (!LS) return; LS.forced = true; schNext(); } }, 'Seguir sin pasarla'));
}
async function schPlayHint(tok) {
  if (!LS || LS.tok !== tok) return;
  const P = LS.P, B = LS.board; if (P.over || P.g.turn() !== P.side || P.hinting) return;
  let m = null;
  if (P.line && P.li < P.line.length) m = P.line[P.li];
  else {
    P.hinting = true; schInfo('Karen está pensando la pista…');
    try { await engine.init(); const r = await engine.analyze(P.g.fen(), 12); if (r.best) m = uciObj(r.best); } catch (e) { m = null; }
    P.hinting = false; if (!LS || LS.tok !== tok) return; schPlayInfo();
    if (!m) { const mv = beginnerMove(new Chess(P.g.fen())); m = mv; }
  }
  if (!m) return;
  LS.mistakes++; B.clearMarks(['hint']); B.mark(m.from, 'hint'); Sound.play('hint');
  schSay(karenLine('hint'), { mood: 'point', emote: 'idea' });
}
// evaluación desde el bando de la persona (centipeones), o null si el motor no está disponible
async function schEvalFor(fen, side) {
  try { await engine.init(); const r = await engine.analyze(fen, 12); return side === 'w' ? r.cp : -r.cp; } catch (e) { return null; }
}

// Karen como rival. Nivel 0: juega como principiante (a veces deja piezas). Niveles 1 a 4: Stockfish cada vez más fino.
async function karenMove(fen, level) {
  const g = new Chess(fen); if (g.game_over()) return null;
  let ok = level > 0;
  if (ok) { try { await engine.init(); } catch (e) { ok = false; } }
  if (!ok) return beginnerMove(g, level);
  const cfg = [null, { d: 4, k: 4, r: 0.3, tol: 250 }, { d: 6, k: 3, r: 0.15, tol: 120 }, { d: 9, k: 2, r: 0.05, tol: 60 }, { d: 12, k: 1, r: 0, tol: 0 }][Math.min(4, level)];
  if (Math.random() < cfg.r) return beginnerMove(g, level);
  try {
    const res = await engine.analyze(fen, cfg.d, cfg.k);
    const white = g.turn() === 'w', sc = l => (white ? l.cp : -l.cp);
    const lines = (res.lines || []).filter(l => l.pv && l.pv[0]);
    if (!lines.length) return res.best ? uciObj(res.best) : beginnerMove(g, level);
    const best = sc(lines[0]), good = lines.filter(l => best - sc(l) <= cfg.tol);
    return uciObj(good[Math.floor(Math.random() * good.length)].pv[0]);
  } catch (e) { return beginnerMove(g, level); }
}
// Principiante: le gustan las capturas, los jaques y coronar; a veces revisa si deja su pieza colgada y a veces no.
function beginnerMove(g, level = 0) {
  const fen = g.fen(), moves = g.moves({ verbose: true }); if (!moves.length) return null;
  const care = level > 0 ? 0.85 : 0.6;
  let best = null, bestS = -1e9;
  for (const m of moves) {
    const h2 = new Chess(fen); h2.move(m);
    let s = Math.random() * 2.2;
    if (h2.in_checkmate()) s += Math.random() < 0.7 ? 20 : 0;
    if (m.captured) s += VAL[m.captured] * 1.2;
    if (m.promotion) s += 7;
    if (h2.in_check()) s += 0.6;
    if (m.flags.includes('k') || m.flags.includes('q')) s += 1.2;
    if (h2.in_draw()) s -= 3;
    if (Math.random() < care && h2.moves({ verbose: true }).some(r => r.to === m.to)) s -= VAL[m.piece] * 1.1;
    if (s > bestS) { bestS = s; best = m; }
  }
  return { from: best.from, to: best.to, promotion: best.promotion };
}

// ---------------------------------------------------------------- fin de la lección y títulos
function schFinish() {
  const { b, l } = LS, s = schState();
  const stars = LS.forced ? 1 : LS.mistakes === 0 ? 3 : LS.mistakes <= 2 ? 2 : 1;
  s.done[l.id] = Math.max(s.done[l.id] || 0, stars); s.last = l.id;
  touchStreak();
  const newTitle = blockDone(b) && !s.titles.includes(b.id);
  if (newTitle) s.titles.push(b.id);
  const finalNow = SCHOOL.blocks.every(blockDone) && !s.titles.includes('final');
  if (finalNow) s.titles.push('final');
  save();
  LS.finished = true; LS.tok = {}; LS.board.setInteractive(false); LS.ty.stop();
  const rec = schRecommended(), fig = LS.fig, p = h('p'), L0 = LS;
  const root = $('#view-lesson'); root.textContent = '';
  const starRow = h('div', { class: 'big-stars', 'aria-label': `${stars} de 3 estrellas` });
  for (let i = 0; i < 3; i++) starRow.append(icon('i-star', i < stars ? 'on' : 'off'));
  const btns = h('div', { class: 'stack' });
  if (rec && rec.l !== l) btns.append(h('button', { class: 'btn primary', onclick: () => schOpen(rec.l.id) }, `Siguiente: ${rec.l.name}`));
  btns.append(h('button', { class: 'btn' + (rec && rec.l !== l ? '' : ' primary'), onclick: () => schOpen(l.id) }, 'Repetir lección'),
    h('button', { class: 'btn ghost', onclick: () => schClose() }, 'Volver a la Escuela'));
  root.append(h('div', { class: 'result ls-result' },
    h('div', { class: 'ls-karen solo' }, h('div', { class: 'kf full' }, fig.body), h('div', { class: 'speech ls-say', onclick: () => L0.ty.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p)),
    h('div', { class: 'section-title' }, `${b.name}: ${l.name}`),
    starRow,
    h('h2', null, stars === 3 ? '¡Lección perfecta!' : 'Lección terminada'),
    h('p', { class: 'muted' }, LS.forced ? 'Pasaste sin la práctica. Repítela cuando quieras para ganar más estrellas.'
      : stars === 3 ? 'Sin errores ni pistas.' : `Errores y pistas: ${LS.mistakes}. Sin ninguno ganas 3 estrellas.`),
    btns));
  fig.pose({ mood: stars === 3 ? 'cheer' : 'happy', emote: 'sparkle', prop: stars === 3 ? 'partyhat' : null });
  setTimeout(() => { if (p.isConnected) L0.ty.type(p, karenLine(stars === 3 ? 'lessonDone3' : 'lessonDone'), fig); }, 250);
  for (let i = 0; i < stars; i++) Sound.play('star', 0.08 + i * 0.15, i);
  if (stars === 3) { setTimeout(() => celebrate(['#e3141b', '#1b1424', '--brass', '#ffffff']), 400); Sound.play('brilliant', 0.55); } else Sound.play('done', 0.5);
  window.scrollTo({ top: 0 });
  const canShow = () => !document.body.classList.contains('gated') && !tour;
  if (newTitle) setTimeout(() => { if (canShow()) schShowTitle(b, finalNow); }, 1500);
  else if (finalNow) setTimeout(() => { if (canShow()) schShowTitle(null, false); }, 1500);
}
function schShowTitle(b, thenFinal) {
  for (const old of $$('.title-ov')) old.remove();
  const T = b ? { name: b.title, piece: b.piece, lines: b.titleLines } : { name: SCHOOL.final.name, piece: SCHOOL.final.piece, lines: SCHOOL.final.lines };
  const fig = new KarenFig(KV), ty = new Typer(), p = h('p');
  const close = () => { ty.stop(); ov.remove(); document.removeEventListener('keydown', onKey); if (thenFinal) setTimeout(() => schShowTitle(null, false), 350); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const btn = h('button', { class: 'btn primary', onclick: close }, '¡Gracias, Karen!');
  const ov = h('div', { class: 'title-ov', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tt-t' },
    h('div', { class: 'title-card' },
      h('div', { class: 'tt-kicker' }, b ? karenLine('titleEarned') : '¡Escuela completa!'),
      h('div', { class: 'tt-stamp' }, miniPiece(T.piece, 'tt-pc')),
      h('h2', { id: 'tt-t' }, T.name),
      h('div', { class: 'ls-karen solo' }, h('div', { class: 'kf full' }, fig.body), h('div', { class: 'speech ls-say', onclick: () => ty.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p)),
      btn));
  document.body.append(ov); document.addEventListener('keydown', onKey);
  fig.pose({ mood: 'cheer', prop: 'crown', emote: 'sparkle' });
  setTimeout(() => { if (p.isConnected) ty.type(p, T.lines.join(' '), fig); }, reduceMotion ? 0 : 600);
  setTimeout(() => btn.focus({ preventScroll: true }), 50);
  Sound.play('promote'); Sound.play('brilliant', 0.3); haptic(40);
  setTimeout(() => celebrate(['#e3141b', '#1b1424', '#ffffff', '--brass']), 250);
}
