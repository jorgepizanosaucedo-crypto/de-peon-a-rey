/* De Peón a Rey — El duelo de Karen: el nivel secreto que se abre al terminar todos los mundos y todas las lecciones.
   Una cinemática presenta a Karen maestra y luego se juega una partida completa contra ella, sin pistas, sin deshacer
   y sin reloj. Tus estrellas deciden en qué escalón empiezas (de 1000 a 2000 de elo) y cada victoria abre el siguiente.
   Este archivo solo declara funciones y datos: se carga antes que app.js y usa lo de app.js cuando la página ya cargó. */

// Escalones de Karen. elo: la fuerza con la que juega; range: lo que se muestra. title: lo que ganas al vencerla.
const DUEL_TIERS = [
  { name: 'Aprendiz', range: '1000–1250', elo: 1125, title: 'Mano firme' },
  { name: 'Estudiosa', range: '1250–1500', elo: 1375, title: 'Mente táctica' },
  { name: 'Experta', range: '1500–1750', elo: 1625, title: 'Estratega' },
  { name: 'Campeona', range: '1750', elo: 1750, title: 'Gran rival' },
  { name: 'Maestra', range: '2000', elo: 2000, title: 'Leyenda del tablero' },
];
// Debajo de 1320 Stockfish no se puede limitar con UCI_Elo: la Aprendiz busca poco, elige entre varias jugadas
// buenas y a veces juega como principiante. Calibrada con partidas automáticas contra Stockfish con UCI_Elo 1320.
const DUEL_APRENDIZ = { d: 5, k: 4, r: 0.17, tol: 180 };
// Si el navegador solo tiene el motor viejo (sin UCI_Elo), cada escalón se debilita a mano.
const DUEL_FALLBACK = [DUEL_APRENDIZ, { d: 6, k: 3, r: 0.06, tol: 100 }, { d: 8, k: 2, r: 0.03, tol: 50 }, { d: 10, k: 2, r: 0.01, tol: 25 }, { d: 13, k: 1, r: 0, tol: 0 }];
const DUEL_MOVETIME = 700;  // lo que piensa Stockfish por jugada (con la fuerza limitada no le hace falta más)
let DU = null;              // pantalla del duelo abierta (portada, partida o resultado)
let DUEL_CINE = null;       // cinemática en curso

// ---------------------------------------------------------------- condiciones y escalones
function duelData() { return S.duel; }
function duelSave() { save(); }
// todos los niveles de todos los mundos (con al menos una estrella) y todas las lecciones de la Escuela
function duelReady() {
  const ws = worldState();
  return ws.length > 0 && ws.every(w => w.done) && SCHOOL.blocks.every(blockDone);
}
// estrellas ganadas sobre las posibles, contando mapa y Escuela
function duelStars() {
  let got = 0, max = 0;
  for (const k of WORLDS) levelsOf(k).forEach((_, i) => { got += Math.min(3, S.levels[k + '-' + i] || 0); max += 3; });
  const done = schState().done;
  for (const { l } of schAll()) { got += Math.min(3, done[l.id] || 0); max += 3; }
  return { got, max, pct: max ? got / max : 0 };
}
const duelPct = st => Math.floor(100 * (st || duelStars()).pct);
// menos de 60 %: Aprendiz · 60–69: Estudiosa · 70–79: Experta · 80–99: Campeona · 100: Maestra
function duelStarTier(st) { const p = (st || duelStars()).pct; return p >= 1 ? 4 : p >= 0.8 ? 3 : p >= 0.7 ? 2 : p >= 0.6 ? 1 : 0; }
// el escalón más alto que puedes retar: el de tus estrellas o el siguiente al último que venciste
function duelOpenTier() { return Math.min(4, Math.max(duelStarTier(), duelData().best + 1)); }
const duelName = i => 'Karen ' + DUEL_TIERS[i].name;
const duelElo = i => DUEL_TIERS[i].range + ' de elo';

// ---------------------------------------------------------------- la jugada de Karen
// Devuelve la jugada y la evaluación de su búsqueda (en centipeones, desde las blancas; null si no hay).
async function duelPick(fen, tier) {
  const g = new Chess(fen); if (g.game_over()) return null;
  let ok = true;
  try { await engine.init(); } catch (e) { ok = false; }
  if (!ok) return { mv: beginnerMove(g, 1), cp: null };
  if (tier > 0 && engine.hasElo) {
    try {
      const r = await engine.play(fen, DUEL_TIERS[tier].elo, DUEL_MOVETIME);
      if (r.best) return { mv: uciObj(r.best), cp: r.cp };
    } catch (e) { /* sigue con la búsqueda normal */ }
  }
  const cfg = tier === 0 ? DUEL_APRENDIZ : DUEL_FALLBACK[tier];
  try {
    const res = await engine.analyze(fen, cfg.d, cfg.k);
    if (Math.random() < cfg.r) return { mv: beginnerMove(g, 1), cp: res.cp };
    const white = g.turn() === 'w', sc = l => (white ? l.cp : -l.cp);
    const lines = (res.lines || []).filter(l => l.pv && l.pv[0]);
    if (!lines.length) return { mv: res.best ? uciObj(res.best) : beginnerMove(g, 1), cp: res.cp };
    const best = sc(lines[0]), good = lines.filter(l => best - sc(l) <= cfg.tol);
    return { mv: uciObj(good[Math.floor(Math.random() * good.length)].pv[0]), cp: res.cp };
  } catch (e) { return { mv: beginnerMove(g, 1), cp: null }; }
}

// ---------------------------------------------------------------- nivel secreto en el mapa
function duelSecretSection() {
  preloadMaster();
  const D = duelData(), open = duelOpenTier(), fig = new KarenFig(KHEAD);
  fig.pose({ mood: 'm-idle' });
  const beat = D.best + 1;
  const node = h('button', { class: 'node secret current', style: { left: '50%', top: '6px' }, 'aria-label': `El duelo de Karen. Tu escalón: ${duelName(open)}`, onclick: () => duelLobby() },
    h('span', { class: 'disc' }, h('span', { class: 'dk-face', 'aria-hidden': 'true' }, fig.body)),
    h('span', { class: 'secret-lbl' }, D.cur ? 'Partida pendiente' : `${duelName(open)} · ${DUEL_TIERS[open].range}`));
  const pips = h('div', { class: 'secret-pips', 'aria-label': `Escalones vencidos: ${beat} de 5` },
    DUEL_TIERS.map((T, i) => h('span', { class: i < beat ? 'got' : i <= open ? 'open' : '', title: T.name })));
  return h('section', { class: 'world secret', id: 'world-secret', style: { '--wc': '#1b1424' } },
    h('div', { class: 'world-banner secret-banner' },
      h('div', { class: 'wb-top' }, h('span', null, 'Nivel secreto'), h('span', { class: 'wb-count' }, `${beat} de 5`)),
      h('h2', null, 'El duelo de Karen'),
      h('p', null, 'Una partida completa contra Karen maestra. Sin pistas, sin deshacer y sin reloj.'),
      pips),
    h('div', { class: 'trail secret-trail' }, node));
}

// ---------------------------------------------------------------- cinemática
// Aparece una vez, cuando terminas todo: "¡Felicidades!… pero…" y Karen se transforma en tu rival final.
function duelMaybeIntro() {
  if (DUEL_CINE || DU) return;
  if (!duelReady() || S.duel.seen) return;
  clearTimeout(duelMaybeIntro.t);
  duelMaybeIntro.t = setTimeout(() => {
    if (DUEL_CINE || DU || session || LS || tour || document.body.classList.contains('gated') || !['map', 'school'].includes(Music.view)) return;
    if ($('.ascend, .title-ov, .modal, .qmenu')) { duelMaybeIntro(); return; } // espera a que cierres lo que está abierto
    if (!duelReady() || S.duel.seen) return;
    duelIntro();
  }, 900);
}
// chispas que suben (doradas al felicitar, rojas cuando aparece la maestra)
function duelFx(canvas) {
  const st = { mode: null, parts: [], run: false };
  if (reduceMotion) return { set() {}, stop() {} };
  let ctx = null; try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return { set() {}, stop() {} };
  const pal = { gold: ['#e1ac48', '#ffd77a', '#fff3c4', '#c38c22'], red: ['#e3141b', '#ff5a5f', '#ffffff', '#ff8a8f'] };
  const resize = () => { const dpr = Math.min(2, devicePixelRatio || 1); canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize(); addEventListener('resize', resize);
  const spawn = () => {
    const W = innerWidth, H = innerHeight, c = pal[st.mode];
    return { x: Math.random() * W, y: H + 10, vx: (Math.random() - .5) * .5, vy: -(0.6 + Math.random() * 1.6), r: 1 + Math.random() * 2.6, life: 0, max: 160 + Math.random() * 160, c: c[Math.floor(Math.random() * c.length)], tw: Math.random() * 6 };
  };
  const step = () => {
    if (!st.run || !canvas.isConnected) { removeEventListener('resize', resize); return; }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (st.mode && st.parts.length < (st.mode === 'red' ? 70 : 90)) st.parts.push(spawn(), spawn());
    st.parts = st.parts.filter(p => p.life < p.max);
    for (const p of st.parts) {
      p.life++; p.x += p.vx + Math.sin((p.life + p.tw * 30) / 26) * .35; p.y += p.vy;
      const a = Math.sin(Math.PI * p.life / p.max);
      ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(p.life / 7 + p.tw)); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(step);
  };
  return { set(mode) { st.mode = mode; if (!st.run && mode) { st.run = true; requestAnimationFrame(step); } }, stop() { st.run = false; } };
}
// escalera de los cinco escalones de Karen (sel: el tuyo)
function duelLadder(sel, { beat = -1, open = sel, onPick = null, big = false } = {}) {
  return h('div', { class: 'dladder' + (big ? ' big' : ''), role: onPick ? 'radiogroup' : null, 'aria-label': 'Escalones de Karen' },
    DUEL_TIERS.map((T, i) => {
      const st = i <= beat ? 'beat' : i <= open ? 'open' : 'locked';
      const attrs = { class: `dstep ${st}${i === sel ? ' sel' : ''}`, style: { '--i': i } };
      const kids = [h('span', { class: 'dbar', 'aria-hidden': 'true' }, i <= beat ? '✓' : i === 4 ? '♛' : String(i + 1)),
        h('span', { class: 'dname' }, T.name), h('span', { class: 'delo' }, T.range.includes('–') ? [T.range.split('–')[0] + '–', h('wbr'), T.range.split('–')[1]] : T.range)];
      if (!onPick) return h('div', attrs, kids);
      return h('button', Object.assign(attrs, { type: 'button', role: 'radio', 'aria-checked': i === sel ? 'true' : 'false', disabled: st === 'locked' ? true : null,
        'aria-label': `${duelName(i)}, ${duelElo(i)}${st === 'beat' ? ', vencida' : st === 'locked' ? ', bloqueada' : ''}`, onclick: () => onPick(i) }), kids);
    }));
}
async function duelIntro() {
  if (DUEL_CINE) return;
  const st = duelStars(), pct = duelPct(st), tier = duelStarTier(st), T = DUEL_TIERS[tier];
  const name = (S.profile && S.profile.name) || '';
  Mascot.hide(true); if (SCH_TY) SCH_TY.stop();
  const loaded = preloadMaster();
  const tok = DUEL_CINE = { skip: false, res: null, t: null };
  const figN = new KarenFig(MV), figM = new KarenFig(MV), ty = new Typer();
  const fxEl = h('canvas', { class: 'dc-fx', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'dc-flash', 'aria-hidden': 'true' });
  const kN = h('div', { class: 'dc-k dc-normal', 'aria-hidden': 'true' }, figN.body), kM = h('div', { class: 'dc-k dc-master', 'aria-hidden': 'true' }, figM.body);
  const puffs = h('div', { class: 'dc-puffs', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6, 7].map(i => h('i', { style: { '--a': (i * 45) + 'deg' } })));
  const stage = h('div', { class: 'dc-stage' }, h('div', { class: 'dc-rays', 'aria-hidden': 'true' }), h('div', { class: 'dc-spot', 'aria-hidden': 'true' }), kN, kM, puffs);
  const title = h('h1', { class: 'dc-title' }), sub = h('p', { class: 'dc-sub' }), stats = h('div', { class: 'dc-stats' });
  const head = h('div', { class: 'dc-head' }, title, sub, stats);
  const pero = h('div', { class: 'dc-pero' });
  const p = h('p'), bub = h('div', { class: 'speech dc-say' }, h('span', { class: 'm-name' }, MASCOT.name), p);
  // la escalera y los botones existen desde el principio (invisibles): así Karen no brinca cuando aparecen
  const ladderHost = h('div', { class: 'dc-ladder' }, duelLadder(tier, { beat: duelData().best, open: duelOpenTier() })), acts = h('div', { class: 'dc-acts' });
  const skipBtn = h('button', { class: 'dc-skip', type: 'button' }, 'Saltar');
  const live = h('div', { class: 'visually-hidden', 'aria-live': 'polite' });
  const ov = h('div', { class: 'dcine', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'El duelo de Karen' }, fxEl, stage, head, pero, bub, ladderHost, acts, flash, skipBtn, live);
  document.body.append(ov);
  const de = document.documentElement, ovf = de.style.overflow; de.style.overflow = 'hidden'; // el mapa de atrás no se mueve
  const fx = duelFx(fxEl);
  const SKIP = {};
  const chk = () => { if (tok.skip || !ov.isConnected) throw SKIP; };
  // espera: se acaba sola o al tocar la pantalla
  const wait = ms => new Promise(res => { tok.res = res; tok.t = setTimeout(() => { tok.res = null; res(); }, reduceMotion ? Math.min(ms, 400) : ms); });
  const next = () => { if (ty.cur) return ty.finish(); if (tok.res) { clearTimeout(tok.t); const r = tok.res; tok.res = null; r(); } };
  ov.addEventListener('click', e => { if (!e.target.closest('button')) next(); });
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); skipAll(); } else if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) { e.preventDefault(); next(); } };
  document.addEventListener('keydown', onKey);
  const say = (fig, text, o) => new Promise(res => { fig.pose(o); bub.classList.add('on'); live.textContent = text; ty.type(p, text, fig, res); });
  const fl = cls => { if (reduceMotion) return; ov.classList.remove(cls); void ov.offsetWidth; ov.classList.add(cls); };
  const skipAll = () => { if (tok.skip) return; tok.skip = true; ty.stop(); if (tok.res) { clearTimeout(tok.t); const r = tok.res; tok.res = null; r(); } };
  skipBtn.addEventListener('click', skipAll);
  const finish = async how => {
    if (!ov.isConnected) return;
    document.removeEventListener('keydown', onKey);
    S.duel.seen = true; save();
    fx.stop(); ty.stop(); figM.stopBlink(); figN.stopBlink();
    ov.classList.add('out');
    setTimeout(() => { ov.remove(); de.style.overflow = ovf; DUEL_CINE = null; }, reduceMotion ? 0 : 450);
    if (how === 'go') { Music.setOverride(null); duelLobby(); }
    else {
      Music.setOverride(null);
      if (currentTab === 'map') renderMap(false); else setTab('map');
      setTimeout(() => { const s = $('#world-secret'); if (s) s.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }, 120);
      toast('El duelo de Karen te espera al final del mapa.');
    }
  };
  const finalState = () => {
    ov.classList.add('final', 'karen-in'); head.classList.add('out'); pero.classList.remove('on');
    kN.classList.remove('on'); kM.classList.add('on'); stage.classList.add('reveal');
    figM.pose({ mood: 'm-hello' }); fx.set('red');
    Music.setOverride('duel');
    ladderHost.classList.add('on');
    bub.classList.add('on'); ty.type(p, '¿Aceptas el reto?', figM);
    skipBtn.hidden = true;
    acts.textContent = '';
    acts.append(h('button', { class: 'btn brass big', onclick: () => finish('go') }, 'Aceptar el reto'),
      h('button', { class: 'btn ghost dc-later', onclick: () => finish('later') }, 'Después'));
    acts.classList.add('on');
    setTimeout(() => { const b = $('.btn', acts); if (b) b.focus({ preventScroll: true }); }, 60);
  };
  try {
    // si la página acaba de abrir, el navegador no deja sonar nada hasta el primer toque
    if (!Music.gesture) {
      pero.classList.add('on', 'tap'); pero.textContent = 'Algo te espera… toca para continuar';
      await new Promise(res => { tok.res = res; }); chk();
      pero.classList.remove('on', 'tap'); pero.textContent = '';
    }
    Music.setOverride('silence');
    await wait(500); chk();
    // 1) ¡Felicidades!
    Sound.play('riser'); await wait(1300); chk();
    title.textContent = '¡Felicidades!';
    sub.textContent = `Completaste los ${WORLDS.length} mundos y las ${schAll().length} lecciones de la Escuela.`;
    const starV = h('b', null, '0'), pctV = h('b', null, '0 %');
    stats.append(h('span', null, icon('i-star'), starV, ` de ${st.max}`), h('span', null, pctV, ' de estrellas'), h('span', null, miniPiece(rankOf().p, 'dc-rank'), rankOf().name));
    head.classList.add('on'); Sound.play('fanfare'); fx.set('gold'); haptic(30);
    setTimeout(() => celebrate(['#e1ac48', '#ffd77a', '#ffffff', '#c38c22'], 120), 450);
    countUp(starV, st.got, v => String(v), 1400); countUp(pctV, pct, v => v + ' %', 1400);
    await wait(4600); chk();
    // 2) Pero…
    head.classList.add('out'); fx.set(null);
    await wait(900); chk();
    pero.classList.add('on'); Sound.play('drone');
    for (const ch of ['P', 'e', 'r', 'o', '…']) { pero.textContent += ch; await wait(ch === '…' ? 700 : 230); chk(); }
    await wait(900); chk();
    fl('flicker'); Sound.play('boom'); haptic(60); stage.classList.add('shake');
    await wait(1300); chk();
    pero.classList.remove('on'); stage.classList.remove('shake');
    // 3) Karen (la de siempre) aparece en el foco
    await loaded;
    ov.classList.add('karen-in'); figN.pose({ mood: 'point' }); kN.classList.add('on'); Sound.play('pop');
    await wait(700); chk();
    await say(figN, `¿Creíste que ya era todo${name ? ', ' + name : ''}? Todavía falta tu examen final.`, { mood: 'point' }); chk();
    await wait(2600); chk();
    // 4) ¡se transforma en la maestra!
    bub.classList.remove('on'); Sound.play('whoosh'); kN.classList.add('spin');
    await wait(520); chk();
    fl('flash-on'); Sound.play('reveal'); haptic(80);
    kN.classList.remove('on', 'spin'); figM.pose({ mood: 'm-winning' }); kM.classList.add('on'); stage.classList.add('reveal', 'shake-s');
    if (!reduceMotion) puffs.classList.add('on');
    fx.set('red'); Music.setOverride('duel');
    await wait(1700); chk();
    stage.classList.remove('shake-s');
    // 5) la maestra explica el duelo
    await say(figM, 'Ahora soy tu rival.', { mood: 'm-winning' }); chk(); await wait(1900); chk();
    await say(figM, 'Te enseñé todo lo que sé. Pero aprender no es lo mismo que ganar.', { mood: 'm-idle' }); chk(); await wait(3000); chk();
    await say(figM, 'Tu examen final: una partida completa contra mí. Sin pistas, sin deshacer y sin reloj.', { mood: 'm-focus' }); chk(); await wait(3200); chk();
    ladderHost.classList.add('on'); Sound.play('levelup');
    await say(figM, tier === 4 ? `Con todas las estrellas vas directo contra mi mejor versión: la Maestra, de 2000 de elo.`
      : `Tus estrellas deciden contra qué versión de mí empiezas. Con ${pct} % te toca ${duelName(tier)}: ${duelElo(tier)}.`, { mood: 'm-offer' }); chk();
    await wait(3600); chk();
    await say(figM, tier === 4 ? 'Gánale y serás leyenda.' : 'Si me ganas, subes un escalón. En lo más alto te espera la Maestra: 2000 de elo.', { mood: 'm-respect' }); chk();
    await wait(3000); chk();
    finalState();
  } catch (e) {
    if (e !== SKIP) throw e;
    if (!ov.isConnected) return;
    await loaded; finalState();
  }
}

// ---------------------------------------------------------------- portada del duelo
function duelClose() {
  if (!DU) return;
  if (DU.ty) DU.ty.stop();
  if (DU.fig) DU.fig.stopTalk();
  if (DU.board) { DU.board.setInteractive(false); DU.board.onMove = null; }
  if (DU.onKey) document.removeEventListener('keydown', DU.onKey);
  DU.tok = {}; DU = null;
  Music.setDuck(1);
}
function duelShell(cls) {
  if (session) { session = null; if (board) { board.setInteractive(false); board.setPick(null); } }
  if (LS) schClose(true);
  duelClose(); Mascot.hide(true);
  preloadMaster();
  currentTab = 'map';
  for (const t of $$('.tab')) t.setAttribute('aria-selected', t.dataset.tab === 'map' ? 'true' : 'false');
  showView('duel');
  const root = $('#view-duel'); root.textContent = ''; root.className = 'view ' + cls;
  return root;
}
function duelLobby() {
  const D = duelData(), root = duelShell('du-lobby'), open = duelOpenTier();
  const st = duelStars(), starTier = duelStarTier(st);
  let sel = D.tier >= 0 && D.tier <= open ? D.tier : open;
  DU = { mode: 'lobby', tok: {}, ty: new Typer(), fig: new KarenFig(KV) };
  const L0 = DU, p = h('p');
  const bub = h('div', { class: 'speech ls-say', role: 'status', 'aria-live': 'polite', onclick: () => L0.ty.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p);
  const ladderHost = h('div', { class: 'du-ladder-host' }), goHost = h('div', { class: 'du-go' });
  const colors = [['w', 'Blancas'], ['r', 'Al azar'], ['b', 'Negras']];
  const colorRow = h('div', { class: 'du-colors', role: 'radiogroup', 'aria-label': 'Tu color' });
  const draw = () => {
    ladderHost.textContent = '';
    ladderHost.append(duelLadder(sel, { beat: D.best, open, big: true, onPick: i => { sel = i; Sound.play('move'); draw(); } }));
    colorRow.textContent = '';
    for (const [c, label] of colors) colorRow.append(h('button', { type: 'button', role: 'radio', class: 'du-color' + (D.color === c ? ' on' : ''), 'aria-checked': D.color === c ? 'true' : 'false',
      onclick: () => { D.color = c; duelSave(); draw(); } }, c === 'r' ? h('span', { class: 'du-dot rnd', 'aria-hidden': 'true' }) : miniPiece('k', 'du-pc', c), label));
    goHost.textContent = '';
    if (D.cur) {
      goHost.append(h('button', { class: 'btn brass big', onclick: () => duelStart(D.cur.tier, D.cur.color, D.cur) }, `Continuar la partida contra ${duelName(D.cur.tier)}`),
        h('button', { class: 'btn ghost', onclick: () => schModal('¿Abandonar la partida pendiente?', 'Cuenta como derrota.',
          [['Seguir jugándola', null, 'primary'], ['Abandonarla', () => { duelRecord(D.cur.tier, 'loss', 'Abandonaste la partida.', null, D.cur.color); duelLobby(); }]]) }, 'Abandonarla'));
    } else {
      goHost.append(h('button', { class: 'btn brass big', onclick: () => { D.tier = sel; duelSave(); duelStart(sel, D.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : D.color); } }, `Retar a ${duelName(sel)}`));
    }
  };
  const W = D.w.reduce((a, b) => a + b, 0), Lz = D.l.reduce((a, b) => a + b, 0), Dz = D.d.reduce((a, b) => a + b, 0);
  const titles = DUEL_TIERS.slice(0, D.best + 1).map(T => T.title);
  root.append(
    h('div', { class: 'ls-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Volver al mapa', onclick: () => setTab('map') }, icon('i-close')),
      h('div', { class: 't' }, h('div', { class: 'ls-tl' }, h('h2', null, 'El duelo de Karen'), h('span', null, 'Nivel secreto')))),
    h('div', { class: 'du-hero' }, h('div', { class: 'ls-karen' }, h('div', { class: 'kf' }, L0.fig.body), bub)),
    h('div', { class: 'du-card' },
      h('div', { class: 'du-meta' },
        h('span', { class: 'du-pct' }, icon('i-star'), h('span', null, `${duelPct(st)} % de estrellas`, h('small', null, ` · empiezas en ${DUEL_TIERS[starTier].name}`))),
        h('span', null, `${W} ${W === 1 ? 'victoria' : 'victorias'} · ${Lz} ${Lz === 1 ? 'derrota' : 'derrotas'} · ${Dz} tablas`)),
      ladderHost,
      titles.length ? h('div', { class: 'du-titles' }, titles.map(t => h('span', { class: 'du-title' }, t))) : null,
      h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, 'Tu color'), colorRow,
      goHost,
      D.last.length ? h('button', { class: 'btn du-az', onclick: () => duelAnalyze(D.last[0]) }, icon('i-scan'), 'Analizar tu última partida') : null,
      h('p', { class: 'muted du-rules' }, 'Sin pistas, sin deshacer y sin reloj. Puedes ofrecer tablas o rendirte. Si sales a la mitad, la partida se guarda.')));
  draw();
  L0.fig.pose({ mood: D.cur ? 'm-offer' : 'm-hello' });
  const text = D.cur ? karenLine('duelBack') : D.lossRun >= 2 && sel > 0 ? karenLine('duelDown', { tier: duelName(sel - 1) }) : karenLine('duelLobby');
  setTimeout(() => { if (DU === L0 && p.isConnected) L0.ty.type(p, text, L0.fig); }, reduceMotion ? 0 : 350);
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- partida
async function duelStart(tier, color, resume) {
  const D = duelData(), root = duelShell('du-game');
  const g = new Chess();
  if (resume) for (const u of resume.moves.split(' ').filter(Boolean)) { if (!g.move(uciObj(u))) break; }
  const G = DU = { mode: 'game', tier, color, g, tok: {}, over: false, kadv: null, said: 0, lastLine: 0, drawAt: resume ? resume.drawAt : -99, ty: new Typer(), fig: new KarenFig(KV) };
  if (!resume) D.cur = { tier, color, moves: '', t0: Date.now(), drawAt: -99 };
  duelSave();
  const p = h('p');
  const bub = h('div', { class: 'speech ls-say', role: 'status', 'aria-live': 'polite', onclick: () => G.ty.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p);
  const host = h('div', { class: 'ls-board' }), info = h('div', { class: 'ls-info du-info', 'aria-live': 'polite' }), mat = h('div', { class: 'du-mat', 'aria-hidden': 'true' });
  const acts = h('div', { class: 'ls-acts' });
  root.append(
    h('div', { class: 'ls-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Salir del duelo', onclick: () => duelAskExit() }, icon('i-close')),
      h('div', { class: 't' }, h('div', { class: 'ls-tl' }, h('h2', null, duelName(tier)), h('span', null, 'elo ' + DUEL_TIERS[tier].range))),
      h('button', { class: 'icon-btn', 'aria-label': 'Girar el tablero', onclick: () => { G.board.flip(G.board.orient === 'w' ? 'b' : 'w'); duelMat(); } }, icon('i-flip'))),
    h('div', { class: 'ls-grid' },
      h('div', { class: 'ls-karen' }, h('div', { class: 'kf' }, G.fig.body), bub),
      h('div', { class: 'ls-stage' }, host, mat, info),
      acts));
  Object.assign(G, { p, bub, info, mat, acts });
  G.board = new Board(host);
  if (color === 'b') G.board.flip('b');
  G.board.setPosition(g.fen(), { last: duelLast(g) });
  if (!resume && !reduceMotion) G.board.intro();
  G.board.onMove = (from, to, promo, dragged) => duelUserMove(G.tok, from, to, promo, dragged);
  acts.append(h('button', { class: 'btn', onclick: () => duelOfferDraw(G.tok) }, '½ Ofrecer tablas'),
    h('button', { class: 'btn', onclick: () => duelResign(G.tok) }, 'Rendirse'));
  G.onKey = e => { if (e.key === 'Escape' && !$('.modal')) duelAskExit(); };
  document.addEventListener('keydown', G.onKey);
  duelMat(); duelInfo();
  Music.setDuck(0.55);
  // Karen habla mientras el motor termina de cargar
  const tok = G.tok, ready = engine.init().then(() => engine.newGame()).catch(() => { /* se juega con el principiante */ });
  await Promise.all([duelSay(resume ? karenLine('duelBack') : karenLine('duelStart'), { mood: resume ? 'm-offer' : 'm-focus' }), ready]);
  if (DU !== G || G.tok !== tok) return;
  duelTurn(tok);
}
function duelLast(g) { const hst = g.history({ verbose: true }); const m = hst[hst.length - 1]; return m ? [m.from, m.to] : null; }
// Karen habla en su globo; la promesa se cumple cuando termina de escribir
function duelSay(text, o) {
  const G = DU; if (!G || !G.ty) return Promise.resolve();
  if (o) G.fig.pose(o);
  G.lastLine = G.g ? G.g.history().length : 0; G.said = 0;
  return new Promise(res => G.ty.type(G.p, text, G.fig, res));
}
function duelInfo(text) {
  const G = DU; if (!G || !G.info) return;
  const n = Math.floor(G.g.history().length / 2) + 1;
  G.info.textContent = text != null ? text : G.over ? '' : G.g.turn() === G.color ? `Jugada ${n} · tu turno` : `Jugada ${n} · ${duelName(G.tier)} piensa…`;
}
// material capturado: lo que te comiste y lo que te comió Karen
function duelMat() {
  const G = DU; if (!G || !G.mat) return;
  const full = { p: 8, n: 2, b: 2, r: 2, q: 1 }, have = { w: {}, b: {} };
  for (const pc of Object.values(parseFen(G.g.fen()))) have[pc[0]][pc[1]] = (have[pc[0]][pc[1]] || 0) + 1;
  const row = side => { // piezas del color "side" que ya no están
    const out = h('span', { class: 'du-cap' });
    for (const t of ['q', 'r', 'b', 'n', 'p']) for (let k = Math.max(0, full[t] - (have[side][t] || 0)); k > 0; k--) out.append(miniPiece(t, 'du-cap-pc', side));
    return out;
  };
  const opp = G.color === 'w' ? 'b' : 'w', bal = balanceFor(G.g.fen(), G.color);
  G.mat.textContent = '';
  G.mat.append(h('span', { class: 'du-side' }, h('em', null, 'Tú'), row(opp), bal > 0 ? h('b', null, '+' + bal) : null),
    h('span', { class: 'du-side' }, h('em', null, 'Karen'), row(G.color), bal < 0 ? h('b', null, '+' + -bal) : null));
}
function duelTurn(tok) {
  const G = DU; if (!G || G.tok !== tok || G.over) return;
  duelInfo();
  if (G.g.turn() === G.color) {
    G.board.setInteractive(true);
    if (!G.ty.cur) G.fig.pose({ mood: G.kadv != null && G.kadv >= 250 ? 'm-winning' : G.kadv != null && G.kadv <= -250 ? 'm-focus' : 'm-idle' });
    return;
  }
  duelKarenTurn(tok);
}
function duelPersist() {
  const G = DU, D = duelData(); if (!G || !D.cur) return;
  D.cur.moves = G.g.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')).join(' ');
  D.cur.drawAt = G.drawAt;
  duelSave();
}
async function duelKarenTurn(tok) {
  const G = DU, B = G.board; B.setInteractive(false);
  const t0 = Date.now(), prev = G.kadv;
  const slow = setTimeout(() => { if (DU === G && G.tok === tok && !G.ty.cur) G.fig.pose({ mood: Math.random() < 0.5 ? 'm-think' : 'm-focus' }); }, 500);
  const pick = await duelPick(G.g.fen(), G.tier);
  clearTimeout(slow);
  if (DU !== G || G.tok !== tok || G.over || !pick || !pick.mv) return;
  const kc = G.color === 'w' ? 'b' : 'w';
  if (pick.cp != null) G.kadv = Math.round(kc === 'w' ? pick.cp : -pick.cp);
  // ¿tu última jugada la sorprendió? (su evaluación bajó mucho desde su turno anterior)
  const last = G.g.history({ verbose: true }).slice(-1)[0];
  const ply = G.g.history().length;
  if (prev != null && G.kadv != null && last && last.color === G.color && prev - G.kadv >= 180 && !G.ty.cur) {
    const big = last.captured && VAL[last.captured] >= 3;
    duelSay(karenLine(big ? 'duelOuch' : 'duelUserGood'), { mood: big || prev - G.kadv >= 400 ? 'm-shock' : 'm-respect' });
    Sound.play(big ? 'wrong' : 'hint');
    await sleep(reduceMotion ? 300 : 1500);
    if (DU !== G || G.tok !== tok || G.over) return;
  }
  await sleep(Math.max(0, (reduceMotion ? 200 : 900) - (Date.now() - t0)));
  if (DU !== G || G.tok !== tok || G.over) return;
  const r = G.g.move({ from: pick.mv.from, to: pick.mv.to, promotion: pick.mv.promotion || 'q' }); if (!r) return;
  B.setPosition(G.g.fen(), { last: [r.from, r.to], animate: [r.from, r.to] }); Sound.play(sfxForSan(r.san));
  duelPersist(); duelMat();
  G.said++;
  if (!G.g.game_over() && !G.ty.cur) {
    if (G.kadv != null && G.kadv >= 300 && (prev == null || prev < 300)) duelSay(karenLine('duelAhead'), { mood: 'm-winning' });
    else if (G.g.in_check() && Math.random() < 0.45) duelSay(karenLine('duelCheck'), { mood: 'm-offer' });
    else if (G.said >= 4 && ply - G.lastLine >= 8 && Math.random() < 0.35) duelSay(karenLine('duelMove'), { mood: G.kadv != null && G.kadv >= 150 ? 'm-winning' : 'm-idle' });
    else G.fig.pose({ mood: G.kadv != null && G.kadv >= 250 ? 'm-winning' : G.kadv != null && G.kadv <= -250 ? 'm-focus' : 'm-idle' });
  }
  duelAfter(tok, false);
}
async function duelUserMove(tok, from, to, promo, dragged) {
  const G = DU; if (!G || G.tok !== tok || G.over || G.g.turn() !== G.color) return;
  const mv = G.g.move({ from, to, promotion: promo || 'q' }); if (!mv) return;
  G.board.setInteractive(false);
  G.board.setPosition(G.g.fen(), { last: [from, to], animate: dragged ? null : [from, to] }); Sound.play(sfxForSan(mv.san));
  duelPersist(); duelMat();
  duelAfter(tok, true);
}
function duelAfter(tok, byUser) {
  const G = DU; if (!G || G.tok !== tok) return;
  const g = G.g;
  if (g.in_checkmate()) return duelEnd(tok, byUser ? 'win' : 'loss', byUser ? 'Jaque mate.' : 'Jaque mate de Karen.');
  if (g.in_stalemate()) return duelEnd(tok, 'draw', 'Tablas por ahogado.');
  if (g.in_threefold_repetition()) return duelEnd(tok, 'draw', 'Tablas por repetición.');
  if (g.insufficient_material()) return duelEnd(tok, 'draw', 'Tablas: no queda material para dar mate.');
  if (g.in_draw()) return duelEnd(tok, 'draw', 'Tablas por la regla de las 50 jugadas.');
  duelTurn(tok);
}
async function duelOfferDraw(tok) {
  const G = DU; if (!G || G.tok !== tok || G.over || G.asking) return;
  const ply = G.g.history().length;
  if (ply < 20) return duelSay(karenLine('duelDrawEarly'), { mood: 'm-winning' });
  if (ply - G.drawAt < 16) return duelSay('Ya me ofreciste tablas hace poco. Sigamos jugando.', { mood: 'm-idle' });
  G.drawAt = ply; duelPersist();
  G.asking = true; duelInfo('Karen lo está pensando…'); G.fig.pose({ mood: 'm-think' });
  let adv = null;
  try { await engine.init(); const r = await engine.analyze(G.g.fen(), 12); const kc = G.color === 'w' ? 'b' : 'w'; adv = kc === 'w' ? r.cp : -r.cp; } catch (e) { adv = null; }
  G.asking = false;
  if (DU !== G || G.tok !== tok || G.over) return;
  duelInfo();
  // acepta si va perdiendo, o si la posición está pareja y la partida ya va avanzada
  const accept = adv != null && (adv <= -150 || (ply >= 60 && Math.abs(adv) <= 40) || (nonPawnMaterial(G.g.fen()) <= 10 && Math.abs(adv) <= 80));
  if (accept) return duelEnd(tok, 'draw', 'Tablas de común acuerdo.');
  duelSay(karenLine('duelDrawNo'), { mood: 'm-winning' });
  if (G.g.turn() === G.color) G.board.setInteractive(true);
}
function duelResign(tok) {
  const G = DU; if (!G || G.tok !== tok || G.over) return;
  schModal('¿Te rindes?', 'La partida cuenta como derrota. Después puedes analizarla para ver qué pasó.',
    [['Seguir jugando', null, 'primary'], ['Rendirme', () => { if (DU === G && G.tok === tok && !G.over) duelEnd(tok, 'loss', 'Te rendiste.', true); }]]);
}
function duelAskExit() {
  const G = DU; if (!G) return setTab('map');
  if (G.mode !== 'game' || G.over) return setTab('map');
  schModal('¿Salir del duelo?', 'La partida se guarda: la puedes continuar desde el nivel secreto del mapa.',
    [['Seguir jugando', null, 'primary'], ['Salir', () => setTab('map')]]);
}
function duelPgn(g, tier, color, res) {
  const d = new Date(), date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const me = (S.profile && S.profile.name) || 'Tú', karen = `${duelName(tier)} (${DUEL_TIERS[tier].elo})`;
  const result = res === 'draw' ? '1/2-1/2' : (res === 'win') === (color === 'w') ? '1-0' : '0-1';
  const c = new Chess(); for (const m of g.history()) c.move(m);
  c.header('Event', 'El duelo de Karen', 'Site', 'De Peón a Rey', 'Date', date, 'White', color === 'w' ? me : karen, 'Black', color === 'w' ? karen : me,
    'WhiteElo', color === 'w' ? '?' : String(DUEL_TIERS[tier].elo), 'BlackElo', color === 'w' ? String(DUEL_TIERS[tier].elo) : '?', 'Result', result);
  return c.pgn() + (c.pgn().endsWith(result) ? '' : ' ' + result);
}
// guarda el resultado: partidas por escalón, el escalón vencido más alto y las derrotas seguidas
function duelRecord(tier, res, why, g, color) {
  const D = duelData(), before = D.best;
  if (res === 'win') { D.w[tier]++; D.best = Math.max(D.best, tier); D.lossRun = 0; }
  else if (res === 'loss') { D.l[tier]++; D.lossRun = D.tier === tier || D.lossRun === 0 ? D.lossRun + 1 : 1; }
  else { D.d[tier]++; D.lossRun = 0; }
  D.tier = tier; D.cur = null;
  if (g && g.history().length) {
    D.last.unshift({ pgn: duelPgn(g, tier, color, res), res, tier, color, date: Date.now(), why });
    D.last = D.last.slice(0, 3);
  }
  touchStreak(); duelSave();
  return { newBest: D.best > before, D };
}
function duelEnd(tok, res, why, resigned) {
  const G = DU; if (!G || G.tok !== tok || G.over) return;
  G.over = true; G.board.setInteractive(false); G.ty.stop();
  const rec = duelRecord(G.tier, res, why, G.g, G.color);
  const tier = G.tier, color = G.color, moves = Math.ceil(G.g.history().length / 2);
  setTimeout(() => { if (DU === G) duelResult({ res, why, tier, color, moves, resigned, newBest: rec.newBest, game: rec.D.last[0] }); }, res === 'loss' && !resigned ? 900 : 700);
  if (res === 'win') Sound.play('correct'); else if (res === 'loss') Sound.play('lose'); else Sound.play('done');
}
function duelResult({ res, why, tier, color, moves, resigned, newBest, game }) {
  const D = duelData(), root = duelShell('du-result'), T = DUEL_TIERS[tier], open = duelOpenTier();
  DU = { mode: 'result', tok: {}, ty: new Typer(), fig: new KarenFig(KV) };
  const R = DU, p = h('p');
  const top = res === 'win' && tier === 4;
  const btns = h('div', { class: 'stack' });
  if (game) btns.append(h('button', { class: 'btn primary', onclick: () => duelAnalyze(game) }, icon('i-scan'), 'Analizar la partida'));
  if (res === 'win' && tier < 4) btns.append(h('button', { class: 'btn brass', onclick: () => { D.tier = tier + 1; duelSave(); duelStart(tier + 1, color === 'w' ? 'b' : 'w'); } }, `Retar a ${duelName(tier + 1)}`));
  btns.append(h('button', { class: 'btn', onclick: () => duelStart(tier, color === 'w' ? 'b' : 'w') }, 'Revancha (con el otro color)'));
  if (res === 'loss' && D.lossRun >= 2 && tier > 0) btns.append(h('button', { class: 'btn', onclick: () => { D.tier = tier - 1; D.lossRun = 0; duelSave(); duelStart(tier - 1, color); } }, `Practicar con ${duelName(tier - 1)}`));
  btns.append(h('button', { class: 'btn ghost', onclick: () => duelLobby() }, 'Ver los escalones'), h('button', { class: 'btn ghost', onclick: () => setTab('map') }, 'Volver al mapa'));
  const stamp = newBest ? h('div', { class: 'du-stamp' + (top ? ' top' : '') }, h('small', null, top ? '¡Venciste a la Maestra!' : 'Nuevo título'), h('strong', null, T.title),
    tier < 4 ? h('span', null, `Se abrió ${duelName(tier + 1)} · ${DUEL_TIERS[tier + 1].range}`) : null) : null;
  root.append(h('div', { class: 'result ls-result du-res-' + res },
    h('div', { class: 'ls-karen solo' }, h('div', { class: 'kf full' }, R.fig.body),
      h('div', { class: 'speech ls-say', onclick: () => R.ty.finish() }, h('span', { class: 'm-name' }, MASCOT.name), p)),
    h('div', { class: 'section-title' }, `Duelo · ${duelName(tier)} · ${T.range}`),
    h('h2', null, res === 'win' ? '¡Ganaste!' : res === 'loss' ? 'Ganó Karen' : 'Tablas'),
    h('p', { class: 'muted' }, `${why} ${moves} ${moves === 1 ? 'jugada' : 'jugadas'}.`),
    stamp,
    h('div', { class: 'stat-grid du-stats' },
      h('div', { class: 'card' }, h('div', { class: 'v' }, String(D.w[tier])), h('div', { class: 'l' }, 'Victorias')),
      h('div', { class: 'card' }, h('div', { class: 'v' }, String(D.d[tier])), h('div', { class: 'l' }, 'Tablas')),
      h('div', { class: 'card' }, h('div', { class: 'v' }, String(D.l[tier])), h('div', { class: 'l' }, 'Derrotas'))),
    btns));
  R.fig.pose({ mood: res === 'win' ? 'm-lose' : res === 'loss' ? 'm-win' : 'm-offer' });
  const line = res === 'win' ? karenLine(top ? 'duelWinTop' : 'duelWin') : res === 'draw' ? karenLine('duelDraw') : resigned ? karenLine('duelResign')
    : D.lossRun >= 2 && tier > 0 ? karenLine('duelDown', { tier: duelName(tier - 1) }) : karenLine('duelLose');
  setTimeout(() => { if (DU === R && p.isConnected) R.ty.type(p, line + (newBest && tier < 4 ? ' ' + karenLine('duelUp', { tier: duelName(tier + 1) }) : ''), R.fig); }, reduceMotion ? 0 : 450);
  if (res === 'win') {
    Sound.play(top || newBest ? 'victory' : 'fanfare', 0.15); haptic(50);
    setTimeout(() => celebrate(['#e3141b', '#1b1424', '#ffffff', '--brass'], top ? 160 : 100), 350);
    if (top) setTimeout(() => celebrate(['#e1ac48', '#ffd77a', '#ffffff', '#e3141b'], 140), 1500);
  } else if (res === 'loss') Sound.play('gong', 0.2);
  window.scrollTo({ top: 0 });
  void open;
}
// La partida del duelo pasa al analizador: tus errores se vuelven puzzles en "Tu entrenamiento".
function duelAnalyze(game) {
  if (!game) return;
  setTab('analyze');
  const hd = (() => { const c = new Chess(); c.load_pgn(game.pgn); return c.header(); })();
  const res = game.res === 'win' ? 'win' : game.res === 'loss' ? 'loss' : 'draw';
  const d = new Date(game.date || Date.now());
  openGame({ id: 'duelo-' + hash(game.pgn), pgn: game.pgn, userColor: game.color, opp: duelName(game.tier), oppRating: String(DUEL_TIERS[game.tier].elo), userResult: res,
    timeClass: 'duelo', date: hd.Date || `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` });
}
