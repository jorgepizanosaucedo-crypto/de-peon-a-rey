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
src/lessons.js           contenido de la Escuela y frases de Karen
src/pieces-sprite.svg    piezas
assets/                  ícono, manifest, vista previa para redes y dibujos de la mascota
assets/vendor/           chess.js y Firebase servidos desde el sitio (licencias en LICENSES.md)
assets/fonts/            tipografías (SIL OFL)
engine/                  Stockfish (WASM y respaldo asm.js)
data/                    puzzles revisados y libro de aperturas
config/                  site.json y plantilla de firebase-config.js
tools/                   build, revisor de lecciones y generadores de puzzles, aperturas y partida de ejemplo
docs/                    sitio listo para publicar (lo genera build.py)
screenshots/             capturas del README
```

## Detalles técnicos

- `tools/build.py` junta `src/app.template.html`, `src/styles.css`, `src/lessons.js`, `src/school.js`, `src/app.js` (en ese orden, en un solo script) y los puzzles en `docs/index.html`, calcula la política de seguridad (CSP) y copia `assets/`, `engine/` y `data/openings.json`.
- En las prácticas, Karen juega como principiante en el nivel 0 (le gustan las capturas y a veces deja piezas) y con Stockfish en los niveles 1 a 4, eligiendo entre sus mejores jugadas con un margen que se achica en cada nivel.
- La clasificación de jugadas usa la probabilidad de ganar y la fórmula de precisión de Lichess.
- La música se genera en el navegador: en los menús, un loop de bossa con piano eléctrico (síntesis FM), vibráfono, bajo, escobillas y reverberación; en la Escuela, un lo-fi para estudiar (Rhodes, bajo, batería con swing, kalimba y crujido de vinilo). Al cambiar de pestaña una baja y entra la otra.
- Las frases de Karen salen de listas en `src/lessons.js` y no se repiten hasta agotar cada lista.
- La mascota es el dibujo `assets/mascota/base.png` con capas encima, en este orden: ojos, boca, accesorios y reacciones (estas dos últimas en SVG), más animaciones CSS para el cuerpo.
  - Los ojos (`ojos-*.png`) y la boca (`boca-*.png`) son PNG transparentes **del mismo tamaño que `base.png`**: solo tienen pixeles donde cambia la cara, así que se ponen en (0, 0) sin calcular posiciones.
  - `MASCOT.faces` en `src/app.js` dice qué ojos y qué boca lleva cada ánimo (`null` = como en el dibujo original). Como ojos y boca van separados, Karen parpadea (`ojos-cerrados`) y mueve la boca al hablar (`boca-habla`, con pausas en comas y puntos) sin perder la expresión. Con movimiento reducido no parpadea y la boca solo se queda abierta mientras escribe.
  - Para una expresión nueva: agrega el PNG con el mismo tamaño, su nombre en `MASCOT.eyes` o `MASCOT.mouths` y úsalo en `MASCOT.faces`.
  - Para una pose de cuerpo completo (por ejemplo, saludando): PNG del mismo tamaño con la cabeza en el mismo lugar, en `MASCOT.poses` con el ánimo que la usa.
