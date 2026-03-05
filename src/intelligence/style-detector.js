import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

const AGENT_TAG = 'STYLE-DETECTOR';

/**
 * Supported file extensions for style analysis.
 */
const SUPPORTED_EXTENSIONS = new Set(['js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'go']);

/**
 * Maximum number of files to sample for style analysis.
 */
const MAX_SAMPLE_FILES = 30;

/**
 * Lists tracked source files using git ls-files (same as codebase-indexer).
 *
 * @param {string} cwd - Repository root
 * @returns {string[]} Array of relative file paths
 */
function listSourceFiles(cwd) {
  try {
    const args = ['ls-files'];
    for (const ext of SUPPORTED_EXTENSIONS) {
      args.push('--', `*.${ext}`);
    }

    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return output
      .trim()
      .split('\n')
      .filter(f => f && !f.includes('node_modules') && !f.includes('.test.') && !f.includes('/test/'));
  } catch (err) {
    logger.warn(`Could not list source files: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Reads a file safely, returning null on error.
 *
 * @param {string} cwd - Repository root
 * @param {string} filePath - Relative file path
 * @returns {string|null}
 */
function readSourceFile(cwd, filePath) {
  try {
    return readFileSync(resolve(cwd, filePath), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Computes a checksum of source files to detect codebase changes.
 *
 * @param {string} cwd - Repository root
 * @param {string[]} files - List of file paths
 * @returns {string} SHA-256 hex hash
 */
export function computeStyleChecksum(cwd, files) {
  const hash = createHash('sha256');

  for (const file of files) {
    try {
      const stat = execFileSync('git', ['log', '-1', '--format=%H', '--', file], {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      hash.update(`${file}:${stat.trim()}`);
    } catch {
      hash.update(`${file}:unknown`);
    }
  }

  return hash.digest('hex');
}

/**
 * Detects indentation style from file contents.
 *
 * @param {string[]} contents - Array of file contents
 * @returns {{ style: string, size: number|null }}
 */
export function detectIndentation(contents) {
  let spaces = 0;
  let tabs = 0;
  const spaceCounts = {};

  for (const content of contents) {
    for (const line of content.split('\n')) {
      if (line.length === 0 || line.trim().length === 0) continue;

      const match = line.match(/^(\s+)/);
      if (!match) continue;

      const indent = match[1];
      if (indent.includes('\t')) {
        tabs++;
      } else {
        spaces++;
        const len = indent.length;
        // Count the smallest meaningful indent unit
        if (len >= 2 && len <= 8) {
          spaceCounts[len] = (spaceCounts[len] || 0) + 1;
        }
      }
    }
  }

  if (tabs > spaces) {
    return { style: 'tabs', size: null };
  }

  // Find most common indent size (2 or 4 are the usual suspects)
  let bestSize = 2;
  let bestCount = 0;
  for (const [size, count] of Object.entries(spaceCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestSize = parseInt(size, 10);
    }
  }

  // Normalize: if best is 4 but 2 also has high count, check for 2-space
  if (bestSize === 4 && spaceCounts[2] && spaceCounts[2] > bestCount * 0.5) {
    bestSize = 2;
  }

  return { style: 'spaces', size: bestSize };
}

/**
 * Detects quote style preference (single vs double).
 *
 * @param {string[]} contents - Array of JS/TS file contents
 * @returns {string} 'single' | 'double' | 'mixed'
 */
export function detectQuoteStyle(contents) {
  let single = 0;
  let double = 0;

  for (const content of contents) {
    // Count string literals (simple heuristic: quotes not inside comments)
    const singleMatches = content.match(/(?<!\\)'/g);
    const doubleMatches = content.match(/(?<!\\)"/g);

    if (singleMatches) single += singleMatches.length;
    if (doubleMatches) double += doubleMatches.length;
  }

  if (single === 0 && double === 0) return 'single';

  const ratio = single / (single + double);
  if (ratio > 0.65) return 'single';
  if (ratio < 0.35) return 'double';
  return 'mixed';
}

/**
 * Detects semicolon usage (always, never, mixed).
 *
 * @param {string[]} contents - Array of JS/TS file contents
 * @returns {string} 'always' | 'never' | 'mixed'
 */
export function detectSemicolons(contents) {
  let withSemi = 0;
  let withoutSemi = 0;

  for (const content of contents) {
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip empty lines, comments, blocks, imports handled separately
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      if (trimmed.endsWith('{') || trimmed.endsWith('}') || trimmed.endsWith('(') || trimmed.endsWith(',')) continue;
      if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) continue;

      // Check statements that typically end with or without semicolons
      if (trimmed.match(/^(const|let|var|return|throw)\s/)) {
        if (trimmed.endsWith(';')) {
          withSemi++;
        } else {
          withoutSemi++;
        }
      }
    }
  }

  if (withSemi === 0 && withoutSemi === 0) return 'always';

  const ratio = withSemi / (withSemi + withoutSemi);
  if (ratio > 0.7) return 'always';
  if (ratio < 0.3) return 'never';
  return 'mixed';
}

/**
 * Detects naming conventions used for functions and variables.
 *
 * @param {string[]} contents - Array of file contents
 * @param {string} language - 'js' | 'py' | 'go'
 * @returns {string} 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed'
 */
export function detectNamingConvention(contents, language) {
  let camel = 0;
  let snake = 0;
  let pascal = 0;

  for (const content of contents) {
    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Extract function names
      let funcMatch;
      if (language === 'py') {
        funcMatch = trimmed.match(/^def\s+(\w+)/);
      } else if (language === 'go') {
        funcMatch = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/);
      } else {
        funcMatch = trimmed.match(/(?:function|const|let|var)\s+(\w+)/);
      }

      if (funcMatch) {
        const name = funcMatch[1];
        // Skip ALL_CAPS constants
        if (name === name.toUpperCase() && name.length > 1) continue;

        if (name.includes('_') && name !== name.toUpperCase()) {
          snake++;
        } else if (name[0] === name[0].toUpperCase() && name.length > 1) {
          pascal++;
        } else if (name[0] === name[0].toLowerCase()) {
          camel++;
        }
      }
    }
  }

  const total = camel + snake + pascal;
  if (total === 0) return 'camelCase';

  if (camel / total > 0.6) return 'camelCase';
  if (snake / total > 0.6) return 'snake_case';
  if (pascal / total > 0.6) return 'PascalCase';
  return 'mixed';
}

/**
 * Detects the import style used in JS/TS files.
 *
 * @param {string[]} contents - Array of JS/TS file contents
 * @returns {string} 'esm' | 'commonjs' | 'mixed'
 */
export function detectImportStyle(contents) {
  let esm = 0;
  let cjs = 0;

  for (const content of contents) {
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.match(/^import\s+/)) esm++;
      if (trimmed.match(/require\s*\(/)) cjs++;
    }
  }

  if (esm === 0 && cjs === 0) return 'esm';
  if (esm > 0 && cjs === 0) return 'esm';
  if (cjs > 0 && esm === 0) return 'commonjs';
  return 'mixed';
}

/**
 * Detects the test framework used in the project.
 *
 * @param {string} cwd - Repository root
 * @returns {string|null} 'vitest' | 'jest' | 'mocha' | 'pytest' | null
 */
export function detectTestFramework(cwd) {
  try {
    const pkgPath = resolve(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps.vitest) return 'vitest';
      if (allDeps.jest) return 'jest';
      if (allDeps.mocha) return 'mocha';
    }
  } catch {
    // Fall through
  }

  // Check for Python test frameworks
  try {
    const setupCfg = resolve(cwd, 'setup.cfg');
    const pyproject = resolve(cwd, 'pyproject.toml');

    if (existsSync(pyproject)) {
      const content = readFileSync(pyproject, 'utf-8');
      if (content.includes('pytest')) return 'pytest';
    }
    if (existsSync(setupCfg)) {
      const content = readFileSync(setupCfg, 'utf-8');
      if (content.includes('pytest')) return 'pytest';
    }
  } catch {
    // Fall through
  }

  return null;
}

/**
 * Detects validation library usage.
 *
 * @param {string[]} contents - Array of file contents
 * @returns {string|null} 'zod' | 'joi' | 'yup' | 'ajv' | null
 */
export function detectValidationLibrary(contents) {
  const libs = { zod: 0, joi: 0, yup: 0, ajv: 0 };

  for (const content of contents) {
    if (content.match(/from\s+['"]zod['"]/)) libs.zod++;
    if (content.match(/from\s+['"]joi['"]/)) libs.joi++;
    if (content.match(/from\s+['"]yup['"]/)) libs.yup++;
    if (content.match(/from\s+['"]ajv['"]/)) libs.ajv++;
  }

  let best = null;
  let bestCount = 0;
  for (const [lib, count] of Object.entries(libs)) {
    if (count > bestCount) {
      bestCount = count;
      best = lib;
    }
  }

  return bestCount > 0 ? best : null;
}

/**
 * Detects the error handling pattern used in the codebase.
 *
 * @param {string[]} contents - Array of file contents
 * @returns {string} 'try-catch' | 'promises' | 'callbacks' | 'mixed'
 */
export function detectErrorHandling(contents) {
  let tryCatch = 0;
  let promiseCatch = 0;
  let callbacks = 0;

  for (const content of contents) {
    const promiseCatchMatches = content.match(/\.catch\s*\(/g);
    // try-catch: match "} catch (" but not ".catch("
    const tryCatchMatches = content.match(/(?<!\.)catch\s*\(/g);
    const callbackMatches = content.match(/\(err(?:or)?\s*[,)]/g);

    if (promiseCatchMatches) promiseCatch += promiseCatchMatches.length;
    if (tryCatchMatches) tryCatch += tryCatchMatches.length;
    if (callbackMatches) callbacks += callbackMatches.length;
  }

  const total = tryCatch + promiseCatch + callbacks;
  if (total === 0) return 'try-catch';

  if (tryCatch / total > 0.5) return 'try-catch';
  if (promiseCatch / total > 0.5) return 'promises';
  if (callbacks / total > 0.5) return 'callbacks';
  return 'mixed';
}

/**
 * Detects the primary language of the codebase.
 *
 * @param {string[]} files - File paths
 * @returns {string} Primary language identifier
 */
function detectPrimaryLanguage(files) {
  const counts = {};

  for (const file of files) {
    const ext = extname(file).slice(1);
    const lang = ext === 'mjs' || ext === 'jsx' ? 'js' : ext === 'tsx' ? 'ts' : ext;
    counts[lang] = (counts[lang] || 0) + 1;
  }

  let best = 'js';
  let bestCount = 0;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      best = lang;
    }
  }

  return best;
}

/**
 * Runs all style detection analyses on sampled files.
 *
 * @param {string} cwd - Repository root
 * @param {string[]} files - Source file paths
 * @returns {Object} Detected style conventions
 */
export function analyzeStyle(cwd, files) {
  // Sample files if too many
  const sampled = files.length > MAX_SAMPLE_FILES
    ? files.sort(() => 0.5 - Math.random()).slice(0, MAX_SAMPLE_FILES)
    : files;

  // Read all sampled files
  const contents = [];
  for (const file of sampled) {
    const content = readSourceFile(cwd, file);
    if (content) contents.push(content);
  }

  if (contents.length === 0) {
    return null;
  }

  const primaryLang = detectPrimaryLanguage(files);

  return {
    indentation: detectIndentation(contents),
    quotes: detectQuoteStyle(contents),
    semicolons: detectSemicolons(contents),
    naming: detectNamingConvention(contents, primaryLang),
    imports: detectImportStyle(contents),
    testFramework: detectTestFramework(cwd),
    validation: detectValidationLibrary(contents),
    errorHandling: detectErrorHandling(contents),
    primaryLanguage: primaryLang,
  };
}

/**
 * Formats the style analysis into a compact, prompt-ready summary string.
 *
 * @param {Object} analysis - Result from analyzeStyle
 * @returns {string} Compact style guide summary
 */
export function formatStyleGuide(analysis) {
  if (!analysis) return '';

  const parts = [];

  // Naming convention
  parts.push(`${analysis.naming} functions`);

  // Indentation
  if (analysis.indentation.style === 'tabs') {
    parts.push('tab indent');
  } else {
    parts.push(`${analysis.indentation.size}-space indent`);
  }

  // Quotes
  parts.push(`${analysis.quotes} quotes`);

  // Semicolons
  if (analysis.semicolons === 'always') {
    parts.push('semicolons');
  } else if (analysis.semicolons === 'never') {
    parts.push('no semicolons');
  }

  // Imports
  if (analysis.imports === 'esm') {
    parts.push('ES modules (import/export)');
  } else if (analysis.imports === 'commonjs') {
    parts.push('CommonJS (require/module.exports)');
  }

  // Test framework
  if (analysis.testFramework) {
    parts.push(`${analysis.testFramework} for tests`);
  }

  // Validation
  if (analysis.validation) {
    parts.push(`${analysis.validation} for validation`);
  }

  // Error handling
  parts.push(`${analysis.errorHandling} error handling`);

  return `Style: ${parts.join(', ')}`;
}

/**
 * Loads a cached style guide from .komodo/style-guide.json if checksum matches.
 *
 * @param {string} cwd - Repository root
 * @param {string} currentChecksum - Current file checksum
 * @returns {Object|null} Cached style guide or null
 */
export function loadCachedStyleGuide(cwd, currentChecksum) {
  const cachePath = resolve(cwd, '.komodo', 'style-guide.json');

  try {
    if (!existsSync(cachePath)) return null;

    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (cached.checksum === currentChecksum) {
      logger.info('Using cached style guide', AGENT_TAG);
      return cached;
    }

    logger.info('Codebase changed — regenerating style guide', AGENT_TAG);
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves the style guide to .komodo/style-guide.json.
 *
 * @param {string} cwd - Repository root
 * @param {Object} guide - The style guide object
 */
export function saveCachedStyleGuide(cwd, guide) {
  const komodoDir = resolve(cwd, '.komodo');
  const cachePath = resolve(komodoDir, 'style-guide.json');

  try {
    if (!existsSync(komodoDir)) {
      mkdirSync(komodoDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify(guide, null, 2), 'utf-8');
    logger.info('Style guide cached to .komodo/style-guide.json', AGENT_TAG);
  } catch (err) {
    logger.warn(`Could not cache style guide: ${err.message}`, AGENT_TAG);
  }
}

/**
 * Estimates token count (1 token ~ 4 chars).
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Main entry point: detects code style conventions and returns a prompt-ready summary.
 *
 * @param {string} cwd - Repository root
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate=false] - Force regeneration even if cached
 * @returns {{ analysis: Object|null, summary: string }}
 */
export function getStyleContext(cwd, options = {}) {
  logger.info('Detecting code style conventions...', AGENT_TAG);

  const files = listSourceFiles(cwd);
  if (files.length === 0) {
    logger.warn('No source files found for style analysis', AGENT_TAG);
    return { analysis: null, summary: '' };
  }

  const checksum = computeStyleChecksum(cwd, files);

  // Try cache first
  if (!options.forceRegenerate) {
    const cached = loadCachedStyleGuide(cwd, checksum);
    if (cached) {
      const summary = cached.summary || formatStyleGuide(cached.analysis);
      return { analysis: cached.analysis, summary };
    }
  }

  // Analyze fresh
  const analysis = analyzeStyle(cwd, files);
  if (!analysis) {
    logger.warn('Could not analyze code style', AGENT_TAG);
    return { analysis: null, summary: '' };
  }

  const summary = formatStyleGuide(analysis);

  // Cache the result
  const guide = {
    analysis,
    summary,
    checksum,
    generatedAt: new Date().toISOString(),
  };
  saveCachedStyleGuide(cwd, guide);

  logger.info(`Style guide ready: ~${estimateTokens(summary)} tokens`, AGENT_TAG);

  eventBus.emitEvent(EVENT_TYPES.STYLE_GUIDE_GENERATED, {
    metadata: {
      summary,
      filesSampled: Math.min(files.length, MAX_SAMPLE_FILES),
      checksum,
    },
  });

  return { analysis, summary };
}
