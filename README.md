<p align="center">
  <img src="assets/favicon.svg" width="72" alt="">
</p>

<h1 align="center">De Peón a Rey</h1>

<p align="center">
  Entrenador de táctica de ajedrez gratuito, pensado para pasar de 600 a 1500 de elo.<br>
  Mundos de puzzles por niveles, un reto diario y la revisión de tus partidas con Stockfish, todo en el navegador.
</p>

<p align="center">
  <a href="https://TU-USUARIO.github.io/de-peon-a-rey/"><strong>Abrir la app</strong></a>
</p>

<table>
  <tr>
    <td><img src="screenshots/mapa.png" alt="Mapa de niveles con la pieza de rango sobre el nivel actual"></td>
    <td><img src="screenshots/tutorial.png" alt="Karen, la mascota, explica los rangos con una corona puesta"></td>
  </tr>
  <tr>
    <td><img src="screenshots/puzzle.png" alt="Puzzle de horquilla en el tablero verde y morado"></td>
    <td><img src="screenshots/rango.png" alt="Pantalla de progreso con el rango y sus requisitos"></td>
  </tr>
</table>

<p align="center">
  <img src="screenshots/analisis.png" alt="Revisión de una partida con la clasificación de cada jugada">
</p>

## Qué hace

- **Mapa de niveles.** Siete mundos, uno por tema: mate en 1, piezas colgadas, defensa, horquillas, mate en 2, clavadas y enfiladas, y táctica mixta. Cada nivel tiene un banco de puzzles de dificultad parecida y cada intento toma 5 que no hayas visto, así que repetir trae puzzles nuevos.
- **Estrellas que cuestan.** Se pasa con 4 puntos (sin ayuda vale 1, con pista 0.5). Las 3 estrellas piden 5 de 5 sin pistas ni errores. Hay vidas y un examen para saltar mundos.
- **Rangos de Peón a Rey.** Tu pieza sube juntando rating táctico y mundos completados: Caballo pide 900 y 2 mundos; Alfil, 1050 y 3; Torre, 1200 y 5; Dama, 1350 y todos; Rey, 1500 y todos los niveles con 3 estrellas. El rating usa Elo; con pista o error no suma, y repetir un puzzle no lo mueve. El rango nunca baja.
- **Defensa: ¿qué amenaza tu rival?** Puzzles en dos pasos: primero tocas la amenaza que creó la última jugada del rival y después juegas una defensa válida.
- **Reto diario.** Cinco puzzles iguales para todos cada día, sin vidas, con un resultado para compartir (🟩🟨🟥).
- **Revisión de partidas.** Descarga tus partidas de Chess.com o Lichess (o pega el PGN), las analiza con Stockfish en tu navegador y clasifica cada jugada al estilo de Chess.com: brillante, gran jugada, mejor, excelente, buena, libro, imprecisión, error, oportunidad perdida y error grave. Reconoce la apertura.
- **Tus errores se vuelven puzzles.** Cada error grave de tus partidas aparece en "Tu entrenamiento" hasta que lo resuelves dos veces seguidas.
- **Progreso.** Rating táctico, precisión por tema y qué tipo de error te cuesta más.
- **Karen, la mascota.** Da el tutorial: sube desde abajo de la pantalla, saluda y explica cada parte. Después aparece de vez en cuando con consejos: cuando fallas un puzzle te recuerda el patrón del tema, celebra tus 3 estrellas con gorro de fiesta, se pone la corona cuando subes de rango y se duerme con gorro de dormir si te quedas sin vidas. Cambia de ánimo y de accesorios según lo que dice, y habla letra por letra con una vocecita por letra (cada globo tarda menos de 3 segundos; tocarlo lo completa).
- **Música de fondo.** Una bossa tranquila generada en el navegador (sin archivos de audio) que suena en los menús y se apaga sola en los puzzles. El botón de sonido abre un menú para apagar los efectos, la música o los consejos.
- **Foto de perfil.** Toca tu avatar en Progreso o en "Editar perfil" para elegir una foto; se guarda pequeña junto con tu progreso. Con Google se usa tu foto de Google mientras no elijas otra.
- **Cuentas opcionales.** Sin configurar nada, el progreso se guarda en el navegador. Con Firebase (gratis) se puede entrar con Google o con correo y sincronizar entre dispositivos. Ver [`FIREBASE.md`](FIREBASE.md).

## Cómo está hecho

- Una sola página estática, sin framework ni servidor propio. `tools/build.py` junta `src/app.template.html`, `src/styles.css`, `src/app.js` y los puzzles en `docs/index.html`.
- Tablero propio en SVG con arrastrar y soltar, flechas y animaciones. Reglas con [chess.js](https://github.com/jhlywa/chess.js).
- Stockfish 17.1 lite (WebAssembly) en un Web Worker, con Stockfish 10 en asm.js como respaldo. La clasificación de jugadas usa la probabilidad de ganar y la fórmula de precisión de Lichess.
- Sonidos y música generados con Web Audio, sin archivos de audio: la música es un loop de bossa con piano eléctrico (síntesis FM), vibráfono, bajo, escobillas y reverberación.
- La mascota es un PNG con capas SVG encima (reacciones y accesorios) y animaciones CSS. Si se agregan más dibujos del mismo tamaño (`feliz`, `pensando`, `sorprendida`, `preocupada`, `habla`, `parpadeo`, `saludo`) en `assets/mascota/` y en `MASCOT.frames` de `src/app.js`, los usa sola: cambia de cara según el ánimo, parpadea y mueve la boca mientras habla.
- 1145 puzzles generados con Stockfish a partir de partidas motor contra motor y revisados a mayor profundidad: solo quedan los que tienen una solución correcta y única.

## Seguridad y privacidad

- Política de seguridad de contenido (CSP) con hash: solo corre el código del sitio.
- Sin CDNs, analíticas, anuncios ni cookies; chess.js, Firebase y las tipografías se sirven desde el propio sitio.
- Sin cuenta, tu progreso nunca sale de tu navegador. Con cuenta, cada quien solo puede leer y escribir lo suyo (reglas en [`FIREBASE.md`](FIREBASE.md)).
- Entradas validadas, fotos de perfil sin metadatos y la app no se deja incrustar en otras páginas.

Detalles y cómo reportar un problema: [`SECURITY.md`](SECURITY.md).

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
4. Pon esa dirección en `config/site.json` (para la vista previa al compartir el enlace) y en el enlace de arriba, y vuelve a correr `python tools/build.py`.

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
# puzzles de defensa
python tools/gen_threats.py amenazas.jsonl 25 1
# revisión profunda: deja solo los de solución correcta y única
python tools/verify_puzzles.py tacticos puzzles_a.jsonl data/puzzles-generados.jsonl 2
python tools/verify_puzzles.py defensa amenazas.jsonl data/puzzles-defensa.jsonl 2
python tools/build.py
```

### Agregar puzzles reales de Lichess

Lichess publica más de 5 millones de puzzles con licencia CC0. Este script los descarga y guarda una muestra variada en `data/puzzles-lichess.jsonl`, que `build.py` toma automáticamente:

```bash
pip install zstandard
python tools/lichess_puzzles.py
python tools/build.py
```

## Estructura

```
src/app.template.html    estructura de la página
src/styles.css           estilos
src/app.js               lógica: tablero, niveles, rangos, motor, análisis, progreso, cuentas
src/pieces-sprite.svg    piezas
assets/                  ícono, manifest, vista previa para redes y dibujos de la mascota
assets/vendor/           chess.js y Firebase servidos desde el sitio (licencias en LICENSES.md)
assets/fonts/            tipografías (SIL OFL)
engine/                  Stockfish (WASM y respaldo asm.js)
data/                    puzzles revisados y libro de aperturas
config/                  site.json y plantilla de firebase-config.js
tools/                   build y generadores de puzzles, aperturas y partida de ejemplo
docs/                    sitio listo para publicar (lo genera build.py)
screenshots/             capturas para este README
```

## Créditos y licencias

- Código de De Peón a Rey: GPLv3 (ver [`LICENSE`](LICENSE)), la misma licencia de Stockfish, que se distribuye junto con la app.
- [Stockfish](https://stockfishchess.org/) y [stockfish.js](https://github.com/nmrugg/stockfish.js): GPLv3.
- [chess.js](https://github.com/jhlywa/chess.js): BSD-2.
- Piezas Cburnett, vía cm-chessboard: CC BY-SA 3.0.
- Nombres de aperturas: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0. Puzzles de Lichess: CC0.
- Karen, la mascota: personaje y dibujo originales de este proyecto. **No** están bajo la GPLv3: todos los derechos reservados (ver [`assets/mascota/LICENSE.txt`](assets/mascota/LICENSE.txt)).
- [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk): Apache-2.0.
- Tipografías Bricolage Grotesque, Atkinson Hyperlegible e IBM Plex Mono: SIL Open Font License (`assets/fonts/OFL.txt`).
