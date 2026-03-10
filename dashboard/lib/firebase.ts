import admin from 'firebase-admin';
import { resolve } from 'path';
import { readFileSync, existsSync, readdirSync } from 'fs';

/**
 * Finds the Firebase service account key file.
 * Searches multiple locations to be robust regardless of Next.js cwd.
 */
function findCredentials(): string {
  const cwd = process.cwd();
  const parentDir = resolve(cwd, '..');

  const candidates: string[] = [];

  // 1. Env var (try resolving from multiple bases)
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath) {
    if (existsSync(resolve(envPath))) candidates.push(resolve(envPath));
    candidates.push(
      resolve(cwd, envPath),
      resolve(parentDir, envPath),
    );
  }

  // 2. Well-known filenames in cwd and parent
  candidates.push(
    resolve(cwd, 'serviceAccountKey.json'),
    resolve(parentDir, 'serviceAccountKey.json'),
  );

  // Check direct candidates first
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // 3. Glob: planning-task-firebase-adminsdk-*.json
  for (const dir of [cwd, parentDir]) {
    try {
      const files = readdirSync(dir);
      const match = files.find(f => f.startsWith('planning-task-firebase-adminsdk') && f.endsWith('.json'));
      if (match) return resolve(dir, match);
    } catch { /* ignore */ }
  }

  // 4. Legacy path
  for (const dir of [cwd, parentDir]) {
    const legacy = resolve(dir, 'skills', 'planning-task-mcp', 'serviceAccountKey.json');
    if (existsSync(legacy)) return legacy;
  }

  throw new Error(
    `Firebase credentials not found. cwd=${cwd}. ` +
    `Place serviceAccountKey.json in project root or set GOOGLE_APPLICATION_CREDENTIALS.`,
  );
}

/**
 * Finds FIREBASE_DATABASE_URL from env or from .env files as fallback.
 */
function findDatabaseUrl(): string {
  if (process.env.FIREBASE_DATABASE_URL) return process.env.FIREBASE_DATABASE_URL;

  const cwd = process.cwd();
  for (const dir of [cwd, resolve(cwd, '..'), resolve(cwd, 'dashboard')]) {
    const envFile = resolve(dir, '.env');
    if (existsSync(envFile)) {
      try {
        const content = readFileSync(envFile, 'utf-8');
        const match = content.match(/^FIREBASE_DATABASE_URL=(.+)$/m);
        if (match) return match[1].trim();
      } catch { /* ignore */ }
    }
  }

  return '';
}

function getApp(): admin.app.App {
  if (admin.apps.length > 0) return admin.app();

  const credPath = findCredentials();
  const databaseURL = findDatabaseUrl();

  if (!databaseURL) {
    throw new Error('FIREBASE_DATABASE_URL not found in env or .env files');
  }

  const serviceAccount = JSON.parse(readFileSync(credPath, 'utf-8'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL,
  });

  return admin.app();
}

export function getDb(): admin.database.Database {
  return getApp().database();
}
