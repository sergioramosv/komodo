import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { config } from './config.js';

let db = null;

/**
 * Lazy singleton for Firebase Admin RTDB.
 * Uses the same credentials Komodo already has in .env.
 */
export function getDb() {
  if (db) return db;

  const serviceAccount = JSON.parse(
    readFileSync(config.googleCredentials, 'utf-8'),
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.firebaseDatabaseUrl,
  });

  db = admin.database();
  return db;
}
