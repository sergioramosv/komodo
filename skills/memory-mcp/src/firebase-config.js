/**
 * Firebase config para memory-mcp.
 * Opt-in: solo activo si USE_FIREBASE_MEMORY=true está en el entorno.
 */

export const firebaseMemoryConfig = {
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || null,
  databaseURL: process.env.FIREBASE_DATABASE_URL || null,
  useFirebase: process.env.USE_FIREBASE_MEMORY === 'true',
};

/**
 * Retorna true si Firebase está habilitado y configurado.
 * @returns {boolean}
 */
export function isFirebaseEnabled() {
  return firebaseMemoryConfig.useFirebase;
}

/**
 * Valida que las variables requeridas estén presentes cuando Firebase está habilitado.
 * @returns {string[]} Array de errores (vacío si todo OK)
 */
export function validateFirebaseConfig() {
  const errors = [];

  if (!isFirebaseEnabled()) {
    return errors;
  }

  if (!firebaseMemoryConfig.credentialsPath) {
    errors.push('GOOGLE_APPLICATION_CREDENTIALS no está definida');
  }

  if (!firebaseMemoryConfig.databaseURL) {
    errors.push('FIREBASE_DATABASE_URL no está definida');
  }

  return errors;
}
