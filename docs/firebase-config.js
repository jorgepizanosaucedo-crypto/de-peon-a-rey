// Configuración de cuentas (Firebase). Mientras sea null, la app funciona sin cuentas:
// cada persona juega con un perfil guardado en su navegador.
// Esta configuración no es secreta: está hecha para ir en el sitio público.
// La seguridad la dan las reglas de Firestore (config/firestore.rules) y las restricciones de la clave (FIREBASE.md, paso 6).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDuLAvNWXPUcZ_ddSghtradgnhtFOZTPfU",
  authDomain: "de-peon-a-rey-e34b8.firebaseapp.com",
  projectId: "de-peon-a-rey-e34b8",
  storageBucket: "de-peon-a-rey-e34b8.firebasestorage.app",
  messagingSenderId: "731833326922",
  appId: "1:731833326922:web:c18dd3fadc7941e78e75b3"
};
