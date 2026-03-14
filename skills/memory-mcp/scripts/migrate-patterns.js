#!/usr/bin/env node
/**
 * Script de migración idempotente: lee memory/patterns.json y migra cada pattern
 * a Firebase con embeddings Vertex AI.
 *
 * Uso:
 *   node scripts/migrate-patterns.js --projectId=<id>
 *
 * El script verifica si cada entry ya existe (por texto) antes de crear.
 * Es seguro ejecutarlo múltiples veces.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..', '..');

// Cargar variables de entorno desde la raíz del proyecto
loadEnv({ path: resolve(ROOT_DIR, '.env') });

// Parsear argumentos CLI
const args = process.argv.slice(2);
const projectIdArg = args.find(a => a.startsWith('--projectId='));
const projectId = projectIdArg ? projectIdArg.split('=')[1] : null;

if (!projectId) {
  console.error('Error: se requiere --projectId=<id>');
  console.error('Uso: node scripts/migrate-patterns.js --projectId=<id>');
  process.exit(1);
}

// Importar módulos después de cargar dotenv
const { embed } = await import('../src/vertex-embeddings.js');
const { createMemoryEntry, getMemoryEntries } = await import('../src/firebase-memory.js');
const { PATTERNS_FILE } = await import('../src/config.js');

async function main() {
  console.log(`[migrate-patterns] Iniciando migración para projectId="${projectId}"...`);

  // Leer patterns.json
  if (!existsSync(PATTERNS_FILE)) {
    console.log('[migrate-patterns] No existe patterns.json. Nada que migrar.');
    return;
  }

  let patternsData;
  try {
    const raw = readFileSync(PATTERNS_FILE, 'utf-8');
    patternsData = JSON.parse(raw);
  } catch (err) {
    console.error('[migrate-patterns] Error leyendo patterns.json:', err.message);
    process.exit(1);
  }

  const patterns = Array.isArray(patternsData.patterns) ? patternsData.patterns : [];

  if (patterns.length === 0) {
    console.log('[migrate-patterns] patterns.json está vacío. Nada que migrar.');
    return;
  }

  console.log(`[migrate-patterns] ${patterns.length} patterns encontrados en patterns.json.`);

  // Cargar entries existentes en Firebase para verificar duplicados (idempotencia)
  let existingEntries = [];
  try {
    existingEntries = await getMemoryEntries(projectId, 'patterns');
    console.log(`[migrate-patterns] ${existingEntries.length} entries ya existen en Firebase.`);
  } catch (err) {
    console.error('[migrate-patterns] Error leyendo entries existentes de Firebase:', err.message);
    process.exit(1);
  }

  // Crear un set de textos existentes para búsqueda rápida
  const existingTexts = new Set(
    existingEntries.map(e => (e.text || e.description || '').trim().toLowerCase())
  );

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const pattern of patterns) {
    const text = (pattern.description || '').trim();

    if (!text) {
      console.warn('[migrate-patterns] Pattern sin descripción, saltando:', pattern.id);
      skipped++;
      continue;
    }

    // Verificar idempotencia: si ya existe por texto, saltar
    if (existingTexts.has(text.toLowerCase())) {
      console.log(`[migrate-patterns] Ya existe: "${text.slice(0, 60)}..." — saltando.`);
      skipped++;
      continue;
    }

    try {
      console.log(`[migrate-patterns] Migrando: "${text.slice(0, 60)}..."`);

      const embedding = await embed(text);
      const isZeroVector = embedding.every(v => v === 0);
      if (isZeroVector) {
        console.warn('[migrate-patterns] Embedding no disponible (Vertex AI no configurado). Guardando sin embedding.');
      }

      const today = pattern.lastSeen || new Date().toISOString().split('T')[0];

      await createMemoryEntry(projectId, 'patterns', {
        text,
        embedding: isZeroVector ? null : embedding,
        severity: pattern.severity || null,
        frequency: pattern.frequency || 1,
        relatedFiles: [],
        lastSeen: today,
        type: pattern.type || null,
      });

      // Añadir al set para evitar duplicados en la misma ejecución
      existingTexts.add(text.toLowerCase());
      created++;
    } catch (err) {
      console.error(`[migrate-patterns] Error migrando "${text.slice(0, 40)}...":`, err.message);
      errors++;
    }
  }

  console.log('\n[migrate-patterns] Migración completada:');
  console.log(`  ✓ Creados: ${created}`);
  console.log(`  - Saltados (ya existían): ${skipped}`);
  if (errors > 0) {
    console.log(`  ✗ Errores: ${errors}`);
  }
}

main().catch(err => {
  console.error('[migrate-patterns] Error fatal:', err.message);
  process.exit(1);
});
