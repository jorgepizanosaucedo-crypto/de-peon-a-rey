# Código de terceros incluido en el sitio

Se sirven desde el propio sitio (no desde un CDN) para no depender de servidores ajenos ni cargar código que pueda cambiar sin aviso.

| Archivo | Proyecto | Versión | Licencia |
|---|---|---|---|
| `chess.js` | [chess.js](https://github.com/jhlywa/chess.js) | 0.10.3 | BSD-2-Clause (texto completo al inicio del archivo) |
| `firebase/firebase-app-compat.js`, `firebase/firebase-auth-compat.js`, `firebase/firebase-firestore-compat.js` | [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) | 10.14.1 | Apache-2.0 |
| `../fonts/*.woff2` | Bricolage Grotesque, Atkinson Hyperlegible, IBM Plex Mono (vía Fontsource) | — | SIL Open Font License 1.1 (`../fonts/OFL.txt`) |

Para actualizar alguno: `npm pack <paquete>@<versión>` y copia el archivo correspondiente aquí.
