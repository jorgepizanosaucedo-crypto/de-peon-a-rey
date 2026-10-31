# Guía para desarrollar

Cómo correr De Peón a Rey en tu computadora, armar el sitio, generar puzzles y publicarlo.

## Probarlo en tu computadora

Los navegadores no dejan cargar el motor abriendo `index.html` con doble clic; hace falta un servidor local que sirva la carpeta `docs/`:

```bash
python -m http.server 8000 --directory docs
```

En Windows sin Python: `powershell -ExecutionPolicy Bypass -File .\servidor.ps1` desde la carpeta del proyecto.

Abre http://localhost:8000.

## Publicarlo gratis en GitHub Pages

1. Sube el proyecto a un repositorio público, por ejemplo `de-peon-a-rey`.
2. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**, rama `main`, carpeta `/docs`.
3. En uno o dos minutos queda en `https://TU-USUARIO.github.io/de-peon-a-rey/`.
4. Pon esa dirección en `config/site.json` (para la vista previa al compartir el enlace) y en el enlace "Abrir la app" del README, y vuelve a correr `python tools/build.py`.

Para activar cuentas, sigue [`FIREBASE.md`](FIREBASE.md) y edita `docs/firebase-config.js`.

## Armar el sitio

`build.py` solo necesita Python 3:

```bash
python tools/build.py
```

Sin argumentos usa los puzzles revisados de `data/` y escribe `docs/` (y una copia en `dist/`).

### Generar más puzzles

Requisitos: `pip install chess` y Stockfish instalado (`sudo apt install stockfish`). En Windows descarga el ejecutable de stockfishchess.org e indica su ruta en la variable `STOCKFISH`.

```bash
# tácticas (archivo de salida, minutos, semilla); corre uno por núcleo
python tools/gen_puzzles.py puzzles_a.jsonl 60 1
# los mates en 1 ya sobran: con GEN_SALTAR el generador no pierde tiempo en ellos
GEN_SALTAR=mate1 python tools/gen_puzzles.py puzzles_b.jsonl 60 2
# puzzles de defensa
python tools/gen_threats.py amenazas.jsonl 25 1
# revisión profunda: deja solo los de solución correcta y única (a un archivo aparte)
python tools/verify_puzzles.py tacticos puzzles_a.jsonl revisados.jsonl 2
python tools/verify_puzzles.py defensa amenazas.jsonl revisadas.jsonl 2
# súmalos a los que ya hay (build.py descarta las posiciones repetidas)
cat revisados.jsonl >> data/puzzles-generados.jsonl
cat revisadas.jsonl >> data/puzzles-defensa.jsonl
python tools/build.py
```

Cada puzzle conserva su id para siempre (`data/puzzle-ids.json` guarda la huella de la posición y su id): así el repaso y los puzzles "ya vistos" de cada persona siguen apuntando al mismo puzzle aunque agregues más. Sube ese archivo junto con los puzzles nuevos.

Cada mundo se reparte en hasta 20 niveles de dificultad creciente, con al menos 10 puzzles por nivel (`MAX_LEVELS` y `POOL_MIN` en `src/app.js`); `build.py` guarda hasta 300 por mundo (`CAP`). Un mundo con menos de 30 puzzles (3 niveles) no aparece y sus puzzles pasan a Táctica mixta. Al elegir los 300 de un mundo, los puzzles que ya se publicaron antes siempre se quedan.

### Agregar puzzles reales de Lichess

Lichess publica más de 5 millones de puzzles con licencia CC0. Este script los descarga y guarda una muestra variada en `data/puzzles-lichess.jsonl`, que `build.py` toma automáticamente:

```bash
pip install zstandard
python tools/lichess_puzzles.py
python tools/build.py
```

### Editar o agregar lecciones de la Escuela

Todo el contenido de la Escuela (bloques, títulos, lecciones, posiciones, aperturas y prácticas) y las frases de Karen están en `src/lessons.js`. Cada lección es una lista de pasos: `say` (Karen explica), `tap` (tocar una casilla), `stars` (recoger estrellas), `move` (encontrar la jugada), `line` (jugar una apertura con flechas), `quiz` (pregunta), `play` (práctica contra Karen) y `recap` (resumen). Las jugadas van en notación inglesa (`Nf3`); los textos para la persona, en española (`Cf3`).

Después de cambiar algo, revísalo con Stockfish (necesita Node.js y Stockfish en el PATH o en la variable `STOCKFISH`):

```bash
node tools/check_lessons.js            # legalidad, respuestas, notas de las aperturas y prácticas
node tools/check_lessons.js --rapido   # solo legalidad, sin motor
python tools/build.py
```

El revisor avisa si una jugada no es legal, si una respuesta pierde material, si falta aceptar un mate, si una nota dice una jugada distinta a la de la línea o si una práctica empieza en una posición que no se puede cumplir.

## Estructura

```
src/app.template.html    estructura de la página
src/styles.css           estilos
src/app.js               lógica: tablero, niveles, rangos, motor, análisis, progreso, cuentas, música, Karen
src/school.js            Escuela: portada, lecciones, prácticas contra Karen y títulos
src/duel.js              el duelo de Karen (nivel secreto): cinemática, escalones, partida y resultado
src/coach.js             Karen entrenadora: comentarios del análisis, práctica con tus errores y diagnóstico
src/lessons.js           contenido de la Escuela y frases de Karen
src/pieces-sprite.svg    piezas
assets/                  ícono, manifest, vista previa para redes y dibujos de la mascota
assets/vendor/           chess.js y Firebase servidos desde el sitio (licencias en LICENSES.md)
assets/fonts/            tipografías (SIL OFL)
engine/                  Stockfish (WASM y respaldo asm.js)
data/                    puzzles revisados, registro de ids (puzzle-ids.json) y libro de aperturas
config/                  site.json y plantilla de firebase-config.js
tools/                   build, revisor de lecciones y generadores de puzzles, aperturas y partida de ejemplo
docs/                    sitio listo para publicar (lo genera build.py)
screenshots/             capturas del README
```

## Detalles técnicos

- `tools/build.py` junta `src/app.template.html`, `src/styles.css`, `src/lessons.js`, `src/school.js`, `src/duel.js`, `src/coach.js`, `src/app.js` (en ese orden, en un solo script) y los puzzles en `docs/index.html`, calcula la política de seguridad (CSP) y copia `assets/`, `engine/` y `data/openings.json`.
- En las prácticas, Karen juega como principiante en el nivel 0 (le gustan las capturas y a veces deja piezas) y con Stockfish en los niveles 1 a 4, eligiendo entre sus mejores jugadas con un margen que se achica en cada nivel.
- La clasificación de jugadas usa la probabilidad de ganar y la fórmula de precisión de Lichess.
- **Karen entrenadora** (`src/coach.js`): convierte en palabras lo que ya calculó el motor (evaluación, mejor jugada y las primeras 8 jugadas de su línea, que el análisis guarda en `A.pvs`).
  - `cIdea` describe una jugada con la jugada como sujeto ("captura su alfil que estaba sin defensa", "da jaque y ataca tu dama", "desarrolla tu caballo"); `cLine` juega una línea y cuenta el material cuando se calma (sin cortar un cambio a la mitad); `cWords` lo pone en palabras ("la dama", "la calidad", "un peón").
  - En el análisis (`cMoveComment`) comenta las jugadas tuyas y las de tu rival, con botones para ver en el tablero qué pasaba y cuál era la mejor línea. En las partidas del duelo habla Karen maestra en primera persona.
  - Los errores guardados para practicar (`S.mine`, hasta 200) llevan además la línea de la mejor jugada (`pv`), la respuesta del rival (`ref`), la evaluación después de tu jugada (`cpA`), la jugada anterior del rival (`ps`) y la jugada de la partida (`ply`); con eso Karen presenta el puzzle (`minePrompt`) y lo explica al terminar (`mineExplain`). Los errores de versiones anteriores, sin esas líneas, se explican de forma más simple.
  - **Diagnóstico:** trae hasta 100 partidas, las analiza a profundidad 12 (una línea) y de cada una guarda solo un resumen en `S.diag` (resultado, precisión, apertura, jugadas por fase y sus errores con tipo, fase y pieza perdida). Lo revisado se guarda partida por partida, así que se puede pausar o cerrar la app y seguir después; "Revisar partidas nuevas" solo analiza las que faltan. Al unir copias de la nube se queda el diagnóstico más reciente.
  - Fases: final cuando quedan 6 piezas o menos (sin contar peones ni reyes); antes de la jugada 12, apertura; lo demás, medio juego.
- **Modo infinito** (`startInfinite` en `src/app.js`): toma puzzles de todos los mundos sin repetir en la partida, nunca dos seguidos del mismo mundo y, si se puede, que no hayas visto. Empieza unos 250 puntos debajo de tu rating táctico (entre 550 y 1350) y la dificultad sube 22 puntos con cada acierto. Tres corazones por partida (no gasta las vidas del mapa); cada 5 resueltos subes de nivel y recuperas uno. Mueve el rating táctico igual que los niveles y guarda récord, nivel, mejor racha y total en `S.inf`.
- **El duelo de Karen** (`src/duel.js`): se abre cuando todos los niveles del mapa tienen al menos una estrella y todas las lecciones están hechas. La cinemática se ve una vez (`S.duel.seen`) y luego el duelo queda al final del mapa como nivel secreto. Las estrellas del mapa y de la Escuela sobre las posibles deciden el escalón de inicio: menos de 60 % Aprendiz (1000–1250), 60–69 % Estudiosa (1250–1500), 70–79 % Experta (1500–1750), 80–99 % Campeona (1750) y 100 % Maestra (2000). Vencer un escalón abre el siguiente; se puede practicar en los de abajo.
  - Fuerza: de Estudiosa para arriba, Stockfish con `UCI_LimitStrength` y `UCI_Elo` (`engine.play`, que deja el motor otra vez a fuerza completa en cuanto responde). La Aprendiz (debajo de 1320, el mínimo de Stockfish) busca a profundidad 5, elige entre sus 4 mejores jugadas con margen de 180 cp y el 17 % de las veces juega como principiante; en 60 partidas contra Stockfish con UCI_Elo 1320 sacó 24 % (unos 1120 de elo). Con el motor viejo (sin `UCI_Elo`) cada escalón se debilita a mano (`DUEL_FALLBACK`).
  - `S.duel` guarda el escalón vencido más alto, victorias/derrotas/tablas por escalón, la partida en curso (se puede salir y continuar) y las últimas 3 partidas en PGN para analizarlas. Al unir copias de la nube solo sube.
  - Karen maestra son las poses `pose-maestra-*.png` (blazer, falda y lentes rectangulares) con las caras serias `ojos-seria/orgullosa/concentrada` y `boca-recta/media-sonrisa/habla-seria`; los ánimos `m-…` de `MASCOT.master` dicen qué pose y qué cara lleva cada momento. Solo se cargan cuando el duelo está abierto.
- La música se genera en el navegador: en los menús, un loop de bossa con piano eléctrico (síntesis FM), vibráfono, bajo, escobillas y reverberación; en la Escuela, un lo-fi para estudiar (Rhodes, bajo, batería con swing, kalimba y crujido de vinilo); en el duelo, un tema en re menor (cuerdas, arpegio grave de piano, timbales y campana) que baja de volumen mientras juegas. Al cambiar de pestaña una baja y entra la otra.
- Las frases de Karen salen de listas en `src/lessons.js` y no se repiten hasta agotar cada lista.
- La mascota es el dibujo `assets/mascota/base.png` (o la pose del gesto) con capas encima, en este orden: ojos, boca, lentes, accesorios y reacciones (estas dos últimas en SVG), más animaciones CSS para el cuerpo.
  - Los ojos (`ojos-*.png`) y la boca (`boca-*.png`) son PNG transparentes **del mismo tamaño que `base.png`**: solo tienen pixeles donde cambia la cara, así que se ponen en (0, 0) sin calcular posiciones.
  - `MASCOT.faces` en `src/app.js` dice qué ojos y qué boca lleva cada ánimo (`null` = como en el dibujo original). Como ojos y boca van separados, Karen parpadea (`ojos-cerrados`) y mueve la boca al hablar (`boca-habla`, con pausas en comas y puntos) sin perder la expresión. Con movimiento reducido no parpadea y la boca solo se queda abierta mientras escribe.
  - Para una expresión nueva: agrega el PNG con el mismo tamaño, su nombre en `MASCOT.eyes` o `MASCOT.mouths` y úsalo en `MASCOT.faces`.
  - **Gestos:** cada gesto es una pose de cuerpo completo (`pose-*.png`) dibujada a partir del dibujo de Karen, con su cabeza original pegada en el mismo lugar que en `base.png`, así que ojos, boca, parpadeo y lentes encajan igual en todas. Miden 620 × 1162 y empiezan en (−100, −60) del dibujo (`MASCOT.posebox`): los brazos pueden salirse del dibujo original.
  - `MASCOT.poses` dice qué pose lleva cada ánimo; si hay varias se turnan sin repetir (feliz: puño de un lado, del otro o pulgar arriba). "Explica" (`point`) usa `pose-explica-arriba` o `pose-explica-abajo` según si lo que explica (lo resaltado del tutorial, el tablero, el botón de la tarjeta) queda arriba o abajo del hombro. La lupa (`magnifier`) usa `pose-lupa`.
  - Al cambiar de gesto la pose nueva entra con un fundido corto (0.12 s) y luego se desvanece la anterior, junto con el saltito o el balanceo del cuerpo de cada ánimo. Con movimiento reducido cambia sin fundido.
  - Los generadores de estas capas no van en el repositorio (el dibujo de Karen no es GPL).
  - Los lentes son una capa (`lentes.png`) inclinada igual que la cabeza, con el puente y las patitas por detrás del pelo. En modo oscuro, las reacciones y accesorios llevan debajo una copia con contorno claro (`halo`), para que la tinta no se pierda contra el fondo.
  - Las piernas no se mueven: en la app Karen siempre se ve de los muslos para arriba.
