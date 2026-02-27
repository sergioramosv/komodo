import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/komodo-mcp/src/ → skills/komodo-mcp → skills → komodo (root)
const ROOT_DIR = resolve(__dirname, '..', '..', '..');

dotenv.config({ path: resolve(ROOT_DIR, '.env') });

export const config = {
  rootDir: ROOT_DIR,
  defaultProjectId: process.env.DEFAULT_PROJECT_ID || '',
  defaultUserId: process.env.DEFAULT_USER_ID || '',
  defaultUserName: process.env.DEFAULT_USER_NAME || '',
  cliPlanner: process.env.CLI_PLANNER || 'claude',
  cliCoder: process.env.CLI_CODER || 'claude',
  cliReviewer: process.env.CLI_REVIEWER || 'claude',
  autoMerge: process.env.AUTO_MERGE !== 'false',
  maxReviewCycles: parseInt(process.env.MAX_REVIEW_CYCLES || '5', 10),
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || '',
  githubToken: process.env.GITHUB_TOKEN || '',
};

export function validateConfig() {
  const errors = [];

  const envPath = resolve(ROOT_DIR, '.env');
  if (!existsSync(envPath)) {
    errors.push(`No se encontro .env en ${ROOT_DIR}`);
    return errors;
  }

  if (!config.defaultUserId) {
    errors.push('DEFAULT_USER_ID no configurado en .env');
  }

  if (!config.googleCredentials) {
    errors.push('GOOGLE_APPLICATION_CREDENTIALS no configurada en .env');
  }

  if (!config.firebaseDatabaseUrl) {
    errors.push('FIREBASE_DATABASE_URL no configurada en .env');
  }

  return errors;
}
