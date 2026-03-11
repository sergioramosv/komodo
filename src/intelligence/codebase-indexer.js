import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, relative, extname, basename } from 'path';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

const AGENT_TAG = 'CODEBASE-INDEX';

/** Cache TTL: regenerate index after 5 minutes regardless of checksum */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Language-specific parsers for extracting exports, imports, and functions.
 * Each parser receives file content and returns structured data.
 */
const PARSERS = {
  js: parseJavaScript,
  mjs: parseJavaScript,
  ts: parseTypeScript,
  tsx: parseTypeScript,
  jsx: parseJavaScript,
  py: parsePython,
  go: parseGo,
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(PARSERS));

/**
 * Parses JavaScript/JSX files for exports, imports, and public functions.
 *
 * @param {string} content - File content
 * @returns {{ exports: string[], imports: string[], functions: string[] }}
 */
function parseJavaScript(content) {
  const exports = [];
  const imports = [];
  const functions = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Imports
    const importMatch = trimmed.match(/^import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/);
    if (importMatch) {
      imports.push(importMatch[1]);
      continue;
    }

    // Named export function
    const exportFuncMatch = trimmed.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (exportFuncMatch) {
      exports.push(exportFuncMatch[1]);
      functions.push(`${exportFuncMatch[1]}(${exportFuncMatch[2].trim()})`);
      continue;
    }

    // Export const/let/var (arrow functions or values)
    const exportConstMatch = trimmed.match(/^export\s+(?:const|let|var)\s+(\w+)/);
    if (exportConstMatch) {
      exports.push(exportConstMatch[1]);
      continue;
    }

    // Export class
    const exportClassMatch = trimmed.match(/^export\s+class\s+(\w+)/);
    if (exportClassMatch) {
      exports.push(exportClassMatch[1]);
      continue;
    }

    // Export default
    const exportDefaultMatch = trimmed.match(/^export\s+default\s+(?:function\s+)?(\w+)?/);
    if (exportDefaultMatch) {
      exports.push(exportDefaultMatch[1] || 'default');
      continue;
    }

    // Non-exported public functions (top-level, not indented)
    if (!trimmed.startsWith('export')) {
      const funcMatch = trimmed.match(/^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
      if (funcMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
        functions.push(`${funcMatch[1]}(${funcMatch[2].trim()})`);
      }
    }
  }

  return { exports, imports, functions };
}

/**
 * Parses TypeScript/TSX files (extends JS parser with type-specific patterns).
 *
 * @param {string} content - File content
 * @returns {{ exports: string[], imports: string[], functions: string[] }}
 */
function parseTypeScript(content) {
  const result = parseJavaScript(content);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Export interface/type
    const typeMatch = trimmed.match(/^export\s+(?:interface|type)\s+(\w+)/);
    if (typeMatch && !result.exports.includes(typeMatch[1])) {
      result.exports.push(typeMatch[1]);
    }

    // Export enum
    const enumMatch = trimmed.match(/^export\s+enum\s+(\w+)/);
    if (enumMatch && !result.exports.includes(enumMatch[1])) {
      result.exports.push(enumMatch[1]);
    }
  }

  return result;
}

/**
 * Parses Python files for exports, imports, and public functions.
 *
 * @param {string} content - File content
 * @returns {{ exports: string[], imports: string[], functions: string[] }}
 */
function parsePython(content) {
  const exports = [];
  const imports = [];
  const functions = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Imports
    const importMatch = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
    if (importMatch) {
      imports.push(importMatch[1] || importMatch[2].split(',')[0].trim());
      continue;
    }

    // Top-level functions (not indented = public)
    const funcMatch = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      const name = funcMatch[1];
      if (!name.startsWith('_')) {
        functions.push(`${name}(${funcMatch[2].trim()})`);
        exports.push(name);
      }
    }

    // Top-level classes
    const classMatch = trimmed.match(/^class\s+(\w+)/);
    if (classMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      exports.push(classMatch[1]);
    }

    // __all__ list (explicit exports)
    const allMatch = trimmed.match(/^__all__\s*=\s*\[([^\]]+)\]/);
    if (allMatch) {
      const items = allMatch[1].match(/['"](\w+)['"]/g);
      if (items) {
        for (const item of items) {
          const name = item.replace(/['"]/g, '');
          if (!exports.includes(name)) exports.push(name);
        }
      }
    }
  }

  return { exports, imports, functions };
}

/**
 * Parses Go files for exports, imports, and public functions.
 *
 * @param {string} content - File content
 * @returns {{ exports: string[], imports: string[], functions: string[] }}
 */
function parseGo(content) {
  const exports = [];
  const imports = [];
  const functions = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Imports (single line)
    const importMatch = trimmed.match(/^import\s+"([^"]+)"/);
    if (importMatch) {
      imports.push(importMatch[1]);
      continue;
    }

    // Imports inside block
    const blockImportMatch = trimmed.match(/^\s*"([^"]+)"/);
    if (blockImportMatch && !trimmed.startsWith('//')) {
      // Only count as import if we're likely in an import block
      // (heuristic: line starts with quote in a Go file)
    }

    // Exported functions (PascalCase = exported in Go)
    const funcMatch = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w*)\s*\(([^)]*)\)/);
    if (funcMatch) {
      exports.push(funcMatch[1]);
      functions.push(`${funcMatch[1]}(${funcMatch[2].trim()})`);
      continue;
    }

    // Exported types
    const typeMatch = trimmed.match(/^type\s+([A-Z]\w+)\s+/);
    if (typeMatch) {
      exports.push(typeMatch[1]);
    }
  }

  // Parse import blocks
  const importBlock = content.match(/import\s*\(([\s\S]*?)\)/);
  if (importBlock) {
    const blockLines = importBlock[1].split('\n');
    for (const bl of blockLines) {
      const match = bl.trim().match(/^(?:\w+\s+)?"([^"]+)"/);
      if (match) imports.push(match[1]);
    }
  }

  return { exports, imports, functions };
}

/**
 * Lists tracked source files in the repository using git ls-files.
 *
 * @param {string} cwd - Repository root
 * @returns {string[]} Array of file paths relative to cwd
 */
export function listSourceFiles(cwd) {
  try {
    const extensions = [...SUPPORTED_EXTENSIONS].map(ext => `*.${ext}`).join('\n');
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
 * Reads a file's content from the working tree.
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
 * Computes a checksum of all source files to detect changes.
 *
 * @param {string} cwd - Repository root
 * @param {string[]} files - List of file paths
 * @returns {string} SHA-256 hash
 */
export function computeChecksum(cwd, files) {
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
 * Builds the directory structure tree from file paths.
 *
 * @param {string[]} files - Relative file paths
 * @returns {Object} Nested directory structure
 */
export function buildDirectoryTree(files) {
  const tree = {};

  for (const file of files) {
    const parts = file.split('/');
    let current = tree;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }

    // Mark leaf as file
    current[parts[parts.length - 1]] = null;
  }

  return tree;
}

/**
 * Formats the directory tree as a compact string for context injection.
 *
 * @param {Object} tree - Directory tree object
 * @param {string} [prefix=''] - Indentation prefix
 * @returns {string}
 */
function formatDirectoryTree(tree, prefix = '') {
  const lines = [];

  const entries = Object.entries(tree).sort(([a, va], [b, vb]) => {
    // Directories first
    const aIsDir = va !== null;
    const bIsDir = vb !== null;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  for (const [name, value] of entries) {
    if (value === null) {
      lines.push(`${prefix}${name}`);
    } else {
      lines.push(`${prefix}${name}/`);
      lines.push(formatDirectoryTree(value, prefix + '  '));
    }
  }

  return lines.join('\n');
}

/**
 * Analyzes a single file and returns its index entry.
 *
 * @param {string} cwd - Repository root
 * @param {string} filePath - Relative file path
 * @returns {{ exports: string[], imports: string[], functions: string[] } | null}
 */
export function analyzeFile(cwd, filePath) {
  const ext = extname(filePath).slice(1);
  const parser = PARSERS[ext];
  if (!parser) return null;

  const content = readSourceFile(cwd, filePath);
  if (!content) return null;

  try {
    return parser(content);
  } catch (err) {
    logger.warn(`Failed to parse ${filePath}: ${err.message}`, AGENT_TAG);
    return null;
  }
}

/**
 * Generates the full codebase index.
 *
 * @param {string} cwd - Repository root
 * @returns {{ files: Object, directoryTree: Object, checksum: string, generatedAt: string }}
 */
export function generateIndex(cwd) {
  const sourceFiles = listSourceFiles(cwd);
  const checksum = computeChecksum(cwd, sourceFiles);
  const files = {};

  for (const filePath of sourceFiles) {
    const analysis = analyzeFile(cwd, filePath);
    if (analysis) {
      files[filePath] = analysis;
    }
  }

  const directoryTree = buildDirectoryTree(sourceFiles);

  return {
    files,
    directoryTree,
    checksum,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Loads a cached index from .komodo/codebase-index.json if it exists and is fresh.
 *
 * @param {string} cwd - Repository root
 * @param {string} currentChecksum - Current file checksum
 * @returns {Object|null} Cached index or null if stale/missing
 */
export function loadCachedIndex(cwd, currentChecksum) {
  const cachePath = resolve(cwd, '.komodo', 'codebase-index.json');

  try {
    if (!existsSync(cachePath)) {
      logger.info('Cache MISS: no codebase index found', AGENT_TAG);
      return null;
    }

    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));

    // TTL check: expire after CACHE_TTL_MS regardless of checksum
    if (cached.generatedAt) {
      const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
      if (ageMs > CACHE_TTL_MS) {
        logger.info(`Cache MISS: index expired (age ${Math.round(ageMs / 1000)}s > TTL ${CACHE_TTL_MS / 1000}s) — regenerating`, AGENT_TAG);
        return null;
      }
    }

    if (cached.checksum === currentChecksum) {
      logger.info('Cache HIT: using cached codebase index', AGENT_TAG);
      return cached;
    }

    logger.info('Cache MISS: codebase changed — regenerating index', AGENT_TAG);
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves the index to .komodo/codebase-index.json.
 *
 * @param {string} cwd - Repository root
 * @param {Object} index - The codebase index
 */
export function saveCachedIndex(cwd, index) {
  const komodoDir = resolve(cwd, '.komodo');
  const cachePath = resolve(komodoDir, 'codebase-index.json');

  try {
    if (!existsSync(komodoDir)) {
      mkdirSync(komodoDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify(index, null, 2), 'utf-8');
    logger.info('Codebase index cached to .komodo/codebase-index.json', AGENT_TAG);
  } catch (err) {
    logger.warn(`Could not cache index: ${err.message}`, AGENT_TAG);
  }
}

/**
 * Estimates token count using a simple heuristic (1 token ~ 4 chars).
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Summarizes the codebase index into a compact context string for prompt injection.
 * Respects the CODEBASE_CONTEXT_MAX_TOKENS limit.
 *
 * @param {Object} index - The codebase index
 * @param {number} [maxTokens] - Maximum token budget
 * @returns {string} Compact summary for prompt injection
 */
export function summarizeForPrompt(index, maxTokens) {
  const limit = maxTokens || config.codebaseContextMaxTokens || 2000;
  const sections = [];

  // 1. Directory structure (always include, compact)
  const treeStr = formatDirectoryTree(index.directoryTree);
  sections.push(`## Directory structure\n${treeStr}`);

  // 2. Key files with exports and functions
  const fileEntries = Object.entries(index.files);
  const fileLines = [];

  for (const [filePath, data] of fileEntries) {
    const parts = [];
    if (data.exports.length > 0) {
      parts.push(`exports: ${data.exports.join(', ')}`);
    }
    if (data.functions.length > 0) {
      parts.push(`fn: ${data.functions.join(', ')}`);
    }
    if (data.imports.length > 0) {
      parts.push(`imports: ${data.imports.join(', ')}`);
    }

    if (parts.length > 0) {
      fileLines.push(`- ${filePath}: ${parts.join(' | ')}`);
    }
  }

  sections.push(`## Files\n${fileLines.join('\n')}`);

  // Trim to fit token budget
  let summary = sections.join('\n\n');

  if (estimateTokens(summary) > limit) {
    // Drop imports to save space
    const trimmedLines = [];
    for (const [filePath, data] of fileEntries) {
      const parts = [];
      if (data.exports.length > 0) {
        parts.push(`exports: ${data.exports.join(', ')}`);
      }
      if (data.functions.length > 0) {
        parts.push(`fn: ${data.functions.join(', ')}`);
      }
      if (parts.length > 0) {
        trimmedLines.push(`- ${filePath}: ${parts.join(' | ')}`);
      }
    }

    summary = `## Directory structure\n${treeStr}\n\n## Files\n${trimmedLines.join('\n')}`;
  }

  // If still too long, truncate directory tree and keep only file summaries
  if (estimateTokens(summary) > limit) {
    const topDirs = Object.keys(index.directoryTree).sort().join(', ');
    summary = `## Top directories: ${topDirs}\n\n## Files\n${fileLines.slice(0, Math.floor(fileLines.length / 2)).join('\n')}`;
  }

  // Final hard truncation if needed
  while (estimateTokens(summary) > limit && summary.length > 100) {
    const lines = summary.split('\n');
    lines.pop();
    summary = lines.join('\n');
  }

  return summary;
}

/**
 * Main entry point: generates or loads cached index and returns a prompt-ready summary.
 *
 * @param {string} cwd - Repository root
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate=false] - Force regeneration even if cached
 * @param {number} [options.maxTokens] - Override token limit
 * @returns {{ index: Object, summary: string }}
 */
export function getCodebaseContext(cwd, options = {}) {
  logger.info('Building codebase knowledge index...', AGENT_TAG);

  const sourceFiles = listSourceFiles(cwd);
  if (sourceFiles.length === 0) {
    logger.warn('No source files found', AGENT_TAG);
    return { index: null, summary: '' };
  }

  const checksum = computeChecksum(cwd, sourceFiles);

  // Try cache first
  let index = null;
  let cacheHit = false;
  if (!options.forceRegenerate) {
    index = loadCachedIndex(cwd, checksum);
    cacheHit = index !== null;
  }

  // Generate fresh index if needed
  if (!index) {
    index = generateIndex(cwd);
    saveCachedIndex(cwd, index);
  }

  const summary = summarizeForPrompt(index, options.maxTokens);

  const fileCount = Object.keys(index.files).length;
  const estimatedTokens = estimateTokens(summary);
  logger.info(`Index ready: ${fileCount} files analyzed, ~${estimatedTokens} tokens (cache ${cacheHit ? 'HIT' : 'MISS'})`, AGENT_TAG);

  eventBus.emitEvent(EVENT_TYPES.CODEBASE_INDEX_GENERATED, {
    metadata: {
      fileCount,
      checksum: index.checksum,
      estimatedTokens,
      cacheHit,
    },
  });

  eventBus.emitEvent(cacheHit ? EVENT_TYPES.CACHE_HIT : EVENT_TYPES.CACHE_MISS, {
    metadata: { source: 'codebase-index', fileCount, estimatedTokens },
  });

  return { index, summary };
}
