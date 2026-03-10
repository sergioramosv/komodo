import { logger } from './logger.js';

/**
 * Lee el body JSON de una petición HTTP.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Object>} Body parseado (o {} si vacío o inválido)
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/**
 * Detiene un servidor HTTP de forma segura.
 *
 * @param {import('http').Server|null} server
 * @returns {Promise<void>}
 */
export function stopHttpServer(server) {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

/**
 * Agrega headers CORS básicos a una respuesta.
 *
 * @param {import('http').ServerResponse} res
 * @param {Object} [options]
 * @param {string} [options.origin='*']
 * @param {string} [options.methods='GET, POST, OPTIONS']
 * @param {string} [options.headers='Content-Type, X-Komodo-Key']
 */
export function setCorsHeaders(res, options = {}) {
  res.setHeader('Access-Control-Allow-Origin', options.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', options.methods || 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', options.headers || 'Content-Type, X-Komodo-Key');
}

/**
 * Envía una respuesta JSON.
 *
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {Object} data
 */
export function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
