# Activar las cuentas (Google y correo)

La app funciona sin esto: cada persona crea un perfil y su progreso se guarda en su navegador.
Con Firebase, la gente puede entrar con Google o con correo y su progreso se guarda en la nube,
así que lo recupera en cualquier dispositivo. El plan gratuito (Spark) alcanza de sobra.

Tiempo: unos 10 minutos.

## 1. Crear el proyecto

1. Entra a https://console.firebase.google.com con tu cuenta de Google.
2. **Crear un proyecto** → nombre: `de-peon-a-rey` → puedes desactivar Google Analytics → Crear.

## 2. Activar los métodos de acceso

1. Menú izquierdo: **Compilación → Authentication → Comenzar**.
2. Pestaña **Método de acceso**:
   - **Google** → Habilitar → elige tu correo de soporte → Guardar.
   - **Correo electrónico/contraseña** → Habilitar (solo el primer interruptor) → Guardar.
3. Pestaña **Configuración → Dominios autorizados**: `localhost` ya viene. Cuando publiques en
   GitHub Pages, agrega `jorgepizanosaucedo-crypto.github.io`.

## 3. Crear la base de datos

1. Menú izquierdo: **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: la que te sugiera (por ejemplo `nam5`). Modo: **producción**.
3. Pestaña **Reglas**, reemplaza todo por esto y **Publicar** (es el mismo texto que `config/firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Cada persona solo puede leer, escribir y borrar su propio documento.
    match /users/{uid} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      // Y solo con la forma que guarda la app: tres campos y un tamaño máximo.
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['v', 'savedAt', 'state'])
        && request.resource.data.v is int
        && request.resource.data.savedAt is int
        && request.resource.data.state is string
        && request.resource.data.state.size() < 800000;
    }
    // Todo lo demás queda cerrado.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Con estas reglas nadie puede leer el progreso de otra persona, y nadie puede usar tu base de datos
para guardar otras cosas o archivos enormes (lo que podría acabarse el plan gratuito).

## 4. Conectar la app

1. En la página principal del proyecto, toca el ícono **</>** (Web) → apodo `web` → Registrar app.
   No hace falta Firebase Hosting.
2. Copia el objeto `firebaseConfig` que te muestra.
3. Abre `docs/firebase-config.js` (la copia que publica GitHub Pages y que también usa el servidor local) y cambia `null` por tu configuración:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "de-peon-a-rey-e34b8.firebaseapp.com",
  projectId: "de-peon-a-rey-e34b8",
  appId: "1:...:web:..."
};
```

Esta configuración no es secreta: está hecha para ir en el sitio público. La seguridad la dan las
reglas del paso 3 y los ajustes del paso 6.

## 5. Probar

1. Arranca el servidor local (`python -m http.server 8000 --directory docs`) y abre http://localhost:8000.
2. Borra los datos del sitio para ver la bienvenida otra vez (F12 → Aplicación → Almacenamiento →
   Borrar datos del sitio) y recarga.
3. Deben aparecer **Continuar con Google** y **Entrar con correo**.
4. Entra, pasa un nivel, y en Firebase → Firestore verás un documento en `users/` con tu progreso.

Si algo falla, la app muestra el motivo en español (por ejemplo, "Este sitio no está autorizado en
Firebase" si falta el dominio del paso 2).

## 6. Seguridad extra (recomendado)

1. **Limita tu clave a tu sitio.** En https://console.cloud.google.com, con tu proyecto elegido:
   **APIs y servicios → Credenciales** → abre la clave "Browser key (auto created by Firebase)".
   - **Restricciones de aplicaciones → Sitios web**, agrega:
     `https://jorgepizanosaucedo-crypto.github.io/*`, `https://de-peon-a-rey-e34b8.firebaseapp.com/*` y `http://localhost:8000/*`.
   - **Restricciones de API → Restringir clave**, marca solo: *Identity Toolkit API*, *Token Service API*
     y *Cloud Firestore API*.
   Así, aunque alguien copie tu configuración, no puede usarla desde otro sitio.
2. **Dominios autorizados** (Authentication → Configuración): deja solo `localhost`, el de
   `firebaseapp.com` y `jorgepizanosaucedo-crypto.github.io`.
3. **Contraseñas más fuertes** (Authentication → Configuración → Política de contraseñas): pide al menos
   8 caracteres. La app ya lo pide al crear cuenta.
4. **Protección contra enumeración de correos** (Authentication → Configuración → Acciones del usuario):
   déjala activada, así nadie puede averiguar qué correos tienen cuenta.
5. **Alertas de cobro**: aunque el plan Spark no cobra, en Uso y facturación puedes ver el consumo y
   detectar abusos.

Si después de limitar la clave el inicio de sesión falla, revisa que la dirección de tu sitio esté
escrita igual (con `https://` y `/*` al final).
