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
screenshots/             capturas del README
```

## Detalles técnicos

- `tools/build.py` junta `src/app.template.html`, `src/styles.css`, `src/app.js` y los puzzles en `docs/index.html`, calcula la política de seguridad (CSP) y copia `assets/`, `engine/` y `data/openings.json`.
- La clasificación de jugadas usa la probabilidad de ganar y la fórmula de precisión de Lichess.
- La música es un loop de bossa con piano eléctrico (síntesis FM), vibráfono, bajo, escobillas y reverberación.
- La mascota es un PNG con capas SVG encima (reacciones y accesorios) y animaciones CSS. Si se agregan más dibujos del mismo tamaño (`feliz`, `pensando`, `sorprendida`, `preocupada`, `habla`, `parpadeo`, `saludo`) en `assets/mascota/` y en `MASCOT.frames` de `src/app.js`, los usa sola: cambia de cara según el ánimo, parpadea y mueve la boca mientras habla.
