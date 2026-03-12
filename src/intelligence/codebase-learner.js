import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getById, update } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'CODEBASE-LEARNER';

const SUPPORTED_EXTENSIONS = new Set(['js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'go']);

const MAX_SAMPLE_FILES = 10;

/**
 * Lists all tracked files matching SUPPORTED_EXTENSIONS using git ls-files.
 *
 * @param {string} cwd - Repository root
 * @returns {string[]} Array of relative file paths
 */
function listAllFiles(cwd) {
  const args = ['ls-files'];
  for (const ext of SUPPORTED_EXTENSIONS) {
    args.push('--', `*.${ext}`);
  }

  const output = execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return output.trim().split('\n').filter(Boolean);
}

/**
 * Lists tracked source files using git ls-files (excludes test files and node_modules).
 *
 * @param {string} cwd - Repository root
 * @returns {string[]} Array of relative file paths
 */
function listSourceFiles(cwd) {
  try {
    return listAllFiles(cwd).filter(f => !f.includes('node_modules') && !f.includes('.test.') && !f.includes('/test/'));
  } catch (err) {
    logger.warn(`Could not list source files: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Reads config files (package.json, tsconfig*.json, .eslintrc*, .prettierrc).
 *
 * @param {string} cwd - Repository root
 * @returns {Object} Parsed config data
 */
function readConfigFiles(cwd) {
  const result = {};

  const candidates = [
    'package.json',
    'tsconfig.json',
    'tsconfig.base.json',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.prettierrc',
    '.prettierrc.json',
  ];

  for (const name of candidates) {
    const filePath = resolve(cwd, name);
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        if (name === 'package.json' || name.endsWith('.json')) {
          try {
            result[name] = JSON.parse(content);
          } catch {
            result[name] = content;
          }
        } else {
          result[name] = content;
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return result;
}

/**
 * Reads up to MAX_SAMPLE_FILES representative source files.
 *
 * @param {string} cwd - Repository root
 * @param {string[]} files - All source files
 * @returns {Array<{ path: string, content: string }>}
 */
function sampleRepresentativeFiles(cwd, files) {
  const sampled = files.length > MAX_SAMPLE_FILES
    ? [...files].sort(() => 0.5 - Math.random()).slice(0, MAX_SAMPLE_FILES)
    : files;

  const result = [];
  for (const file of sampled) {
    try {
      const content = readFileSync(resolve(cwd, file), 'utf-8');
      result.push({ path: file, content });
    } catch {
      // skip unreadable files
    }
  }

  return result;
}

/**
 * Detects architecture patterns from directory names and file structure.
 *
 * @param {string[]} files - Source file paths
 * @returns {string} Detected pattern: 'MVC' | 'Service-Controller' | 'Repository' | 'Hexagonal' | 'Flat' | 'Unknown'
 */
export function detectArchitecturePatterns(files) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1) dirs.add(parts[0].toLowerCase());
    if (parts.length > 2) dirs.add(parts[1].toLowerCase());
  }

  const hasControllers = dirs.has('controllers') || dirs.has('controller');
  const hasServices = dirs.has('services') || dirs.has('service');
  const hasRepositories = dirs.has('repositories') || dirs.has('repository') || dirs.has('repos');
  const hasModels = dirs.has('models') || dirs.has('model') || dirs.has('entities') || dirs.has('domain');
  const hasRoutes = dirs.has('routes') || dirs.has('route') || dirs.has('routers');
  const hasAdapters = dirs.has('adapters') || dirs.has('ports') || dirs.has('infrastructure');
  const hasViews = dirs.has('views') || dirs.has('view') || dirs.has('templates');

  if (hasAdapters && (hasModels || dirs.has('domain'))) return 'Hexagonal';
  if (hasControllers && hasServices && hasRepositories) return 'Repository';
  if (hasControllers && hasServices) return 'Service-Controller';
  if (hasControllers && hasModels && hasViews) return 'MVC';
  if (hasRoutes && hasModels) return 'MVC';
  if (files.length < 5) return 'Flat';
  return 'Unknown';
}

/**
 * Detects testing patterns from package.json and file structure.
 *
 * @param {string} cwd - Repository root
 * @param {Object} configFiles - Parsed config files
 * @param {string[]} allFiles - All tracked files (including test files)
 * @returns {Object} Testing pattern info
 */
export function detectTestingPatterns(cwd, configFiles, allFiles) {
  const pkg = configFiles['package.json'] || {};
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  let framework = null;
  if (allDeps?.vitest) framework = 'vitest';
  else if (allDeps?.jest) framework = 'jest';
  else if (allDeps?.mocha) framework = 'mocha';
  else if (allDeps?.jasmine) framework = 'jasmine';

  // Check for Python test frameworks if no JS framework found
  if (!framework) {
    const pyproject = resolve(cwd, 'pyproject.toml');
    const setupCfg = resolve(cwd, 'setup.cfg');
    try {
      if (existsSync(pyproject) && readFileSync(pyproject, 'utf-8').includes('pytest')) framework = 'pytest';
      else if (existsSync(setupCfg) && readFileSync(setupCfg, 'utf-8').includes('pytest')) framework = 'pytest';
    } catch {
      // ignore
    }
  }

  // Detect test file pattern
  const testFiles = allFiles.filter(f => f.includes('.test.') || f.includes('.spec.') || f.includes('/test/') || f.includes('/tests/') || f.includes('/__tests__/'));
  const colocated = testFiles.filter(f => f.includes('.test.') || f.includes('.spec.')).length;
  const separated = testFiles.filter(f => f.includes('/test/') || f.includes('/tests/') || f.includes('/__tests__/')).length;
  const filePattern = colocated >= separated ? 'colocated (*.test.js)' : 'separated (test/ dir)';

  // Check test script
  const testScript = pkg.scripts?.test || null;

  return {
    framework,
    filePattern,
    testScript,
    testFileCount: testFiles.length,
  };
}

/**
 * Detects API style from dependencies and file contents.
 *
 * @param {Object} configFiles - Parsed config files
 * @param {Array<{ path: string, content: string }>} sampledFiles - Sample of source files
 * @returns {string|null} 'express' | 'fastify' | 'graphql' | 'mcp' | 'rest' | null
 */
export function detectApiStyle(configFiles, sampledFiles) {
  const pkg = configFiles['package.json'] || {};
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (allDeps?.['@modelcontextprotocol/sdk'] || allDeps?.['@anthropic-ai/mcp']) return 'mcp';
  if (allDeps?.fastify) return 'fastify';
  if (allDeps?.express) return 'express';
  if (allDeps?.['apollo-server'] || allDeps?.['graphql']) return 'graphql';

  // Check file contents for clues
  for (const { content } of sampledFiles) {
    if (content.includes('@modelcontextprotocol') || content.includes('McpServer')) return 'mcp';
    if (content.includes('fastify') || content.includes('Fastify')) return 'fastify';
    if (content.includes("require('express')") || content.includes("from 'express'")) return 'express';
    if (content.includes('graphql') || content.includes('gql`')) return 'graphql';
  }

  return null;
}

/**
 * Detects top dependencies from package.json.
 *
 * @param {Object} configFiles - Parsed config files
 * @returns {Object} { runtime: string[], dev: string[] }
 */
export function detectDependencyProfile(configFiles) {
  const pkg = configFiles['package.json'] || {};

  const runtime = Object.keys(pkg.dependencies || {}).slice(0, 20);
  const dev = Object.keys(pkg.devDependencies || {}).slice(0, 20);

  return { runtime, dev };
}

/**
 * Detects naming conventions from sampled source files.
 *
 * @param {Array<{ path: string, content: string }>} sampledFiles
 * @returns {string} 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed'
 */
function detectNamingConventions(sampledFiles) {
  let camel = 0;
  let snake = 0;
  let pascal = 0;

  for (const { path: filePath, content } of sampledFiles) {
    const ext = extname(filePath).slice(1);
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      let funcMatch;

      if (ext === 'py') {
        funcMatch = trimmed.match(/^def\s+(\w+)/);
      } else if (ext === 'go') {
        funcMatch = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/);
      } else {
        funcMatch = trimmed.match(/(?:function|const|let|var)\s+(\w+)/);
      }

      if (funcMatch) {
        const name = funcMatch[1];
        if (name === name.toUpperCase() && name.length > 1) continue;
        if (name.includes('_')) snake++;
        else if (name[0] === name[0].toUpperCase()) pascal++;
        else camel++;
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
 * Main entry point: analyzes the codebase and persists the results in Firebase.
 *
 * Result is stored under /learning/{projectId}/ with sections:
 * architecture, testing, api, naming, dependencies
 *
 * @param {Object} options
 * @param {string} options.projectId - Firebase project ID
 * @param {string} options.cwd - Repository root directory
 * @returns {Promise<Object>} The learning data persisted to Firebase
 */
export async function learnFromCodebase({ projectId, cwd }) {
  logger.info(`Starting codebase learning for project ${projectId}`, AGENT_TAG);

  eventBus.emitEvent(EVENT_TYPES.CODEBASE_LEARNING_STARTED, {
    metadata: { projectId, cwd },
  });

  // Check cache in Firebase unless forceRefresh
  if (!config.codebaseLearningForceRefresh) {
    try {
      const cached = await getById('learning', projectId);
      if (cached) {
        logger.info('Codebase learning: cache hit — using existing data', AGENT_TAG);
        eventBus.emitEvent(EVENT_TYPES.CODEBASE_LEARNING_COMPLETED, {
          metadata: { projectId, cacheHit: true },
        });
        return cached;
      }
    } catch (err) {
      logger.warn(`Could not check learning cache: ${err.message}`, AGENT_TAG);
    }
  }

  // Run analysis
  const files = listSourceFiles(cwd);
  const configFiles = readConfigFiles(cwd);

  // All files including test files for testing pattern detection
  let allFiles = [];
  try {
    allFiles = listAllFiles(cwd);
  } catch {
    allFiles = files;
  }

  const sampledFiles = sampleRepresentativeFiles(cwd, files);

  const architecture = {
    pattern: detectArchitecturePatterns(files),
    topDirectories: [...new Set(files.map(f => f.split('/')[0]))].slice(0, 10),
    fileCount: files.length,
  };

  const testing = detectTestingPatterns(cwd, configFiles, allFiles);
  const api = { style: detectApiStyle(configFiles, sampledFiles) };
  const naming = { convention: detectNamingConventions(sampledFiles) };
  const dependencies = detectDependencyProfile(configFiles);

  const pkg = configFiles['package.json'] || {};
  const hasTypeScript = !!(configFiles['tsconfig.json'] || configFiles['tsconfig.base.json']);

  const learningData = {
    projectId,
    generatedAt: new Date().toISOString(),
    architecture,
    testing,
    api,
    naming,
    dependencies,
    language: hasTypeScript ? 'typescript' : (pkg.type === 'module' ? 'esm' : 'javascript'),
    packageManager: existsSync(resolve(cwd, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(resolve(cwd, 'yarn.lock')) ? 'yarn'
      : 'npm',
  };

  // Persist to Firebase
  try {
    await update('learning', projectId, learningData);
    logger.info('Codebase learning data saved to Firebase', AGENT_TAG);
  } catch (err) {
    logger.warn(`Could not persist learning data: ${err.message}`, AGENT_TAG);
  }

  eventBus.emitEvent(EVENT_TYPES.CODEBASE_LEARNING_COMPLETED, {
    metadata: { projectId, cacheHit: false, architecture: architecture.pattern },
  });

  logger.info(`Codebase learning complete: pattern=${architecture.pattern}, testing=${testing.framework}`, AGENT_TAG);

  return learningData;
}
