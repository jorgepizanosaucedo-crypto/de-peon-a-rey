# Seguridad

## Reportar un problema

Si encuentras una vulnerabilidad, repórtala en privado desde la pestaña **Security → Report a vulnerability**
de este repositorio. Por favor no la publiques en un issue abierto hasta que esté corregida.

## Cómo está protegida la app

- **Solo se ejecuta código propio.** La página trae una política de seguridad de contenido (CSP) que
  permite únicamente los scripts del sitio y el script de la app, identificado por su hash SHA-256
  (lo calcula `tools/build.py` en cada build). Un script inyectado o traído de otro sitio no corre.
- **Sin CDNs ni rastreadores.** chess.js, el SDK de Firebase y las tipografías se sirven desde el propio
  sitio (`docs/vendor`, `docs/fonts`). No hay analíticas, anuncios ni cookies.
- **Conexiones limitadas.** La CSP solo deja hablar con las APIs públicas de Chess.com y Lichess y, si
  hay cuentas activadas, con Firebase/Google.
- **No se deja meter en otras páginas.** Si alguien carga la app dentro de un iframe de otro sitio, no
  se muestra (protección contra clickjacking).
- **Texto seguro.** Todo lo que viene de afuera (nombres de rivales, PGN, nombres de perfil) se muestra
  como texto, nunca como HTML. Los usuarios de Chess.com/Lichess se validan antes de usarlos en una
  dirección, y solo se siguen direcciones de la API de Chess.com.
- **Límites de tamaño** para PGN pegados o subidos y para las fotos de perfil.
- **Fotos sin metadatos.** La foto de perfil se recorta y se vuelve a dibujar, así que no conserva datos
  EXIF como la ubicación GPS.
- **Datos guardados** se leen descartando claves peligrosas (`__proto__`, `constructor`, `prototype`).
- **Cuentas (opcional).** Las reglas de Firestore de `FIREBASE.md` hacen que cada persona solo lea y
  escriba su propio documento, con forma y tamaño limitados. Al crear cuenta se piden 8 caracteres de
  contraseña, y los mensajes de error no revelan si un correo tiene cuenta.

## Límites conocidos

- GitHub Pages no permite cabeceras HTTP propias, por eso la CSP va en una etiqueta `<meta>` y la
  protección contra iframes se hace con código.
- El progreso sin cuenta vive en el navegador: quien quiera puede editarlo en su propio equipo. No hay
  ranking público, así que solo se afecta a sí mismo.
- La configuración de Firebase es pública por diseño; lo que protege los datos son las reglas.

## Para quien mantiene el repositorio

- Activa la verificación en dos pasos (2FA) en tu cuenta de GitHub.
- Settings → Pages: marca **Enforce HTTPS**.
- Settings → Code security: activa **Private vulnerability reporting**, **Dependabot alerts** y
  **Secret scanning** con **Push protection**.
- Settings → Rules → Rulesets: crea una regla para `main` con **Restrict deletions** y
  **Block force pushes**.
- Nunca subas contraseñas ni claves privadas. `firebase-config.js` sí puede ir (es pública).
