import admin from 'firebase-admin';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

let initialized = false;

function getApp(): admin.app.App {
  if (initialized) return admin.app();

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    resolve(process.cwd(), '..', 'skills', 'planning-task-mcp', 'serviceAccountKey.json');

  const databaseURL = process.env.FIREBASE_DATABASE_URL || '';

  if (!existsSync(credPath)) {
    throw new Error(`Firebase credentials not found at: ${credPath}`);
  }

  const serviceAccount = JSON.parse(readFileSync(credPath, 'utf-8'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL,
  });

  initialized = true;
  return admin.app();
}

export function getDb(): admin.database.Database {
  return getApp().database();
}
