import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig, mockExecFileSync, mockReadFileSync, mockExistsSync, mockGetById, mockUpdate, mockEmitEvent } = vi.hoisted(() => ({
  mockConfig: {
    codebaseLearningEnabled: true,
    codebaseLearningForceRefresh: false,
  },
  mockExecFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockGetById: vi.fn(),
  mockUpdate: vi.fn(),
  mockEmitEvent: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: mockEmitEvent },
  EVENT_TYPES: {
    CODEBASE_LEARNING_STARTED: 'codebase-learning:started',
    CODEBASE_LEARNING_COMPLETED: 'codebase-learning:completed',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getById: mockGetById,
  update: mockUpdate,
}));

import {
  learnFromCodebase,
  detectArchitecturePatterns,
  detectDependencyProfile,
  detectApiStyle,
  detectTestingPatterns,
} from './codebase-learner.js';

beforeEach(() => {
  vi.resetAllMocks();
  mockConfig.codebaseLearningEnabled = true;
  mockConfig.codebaseLearningForceRefresh = false;
  mockExistsSync.mockReturnValue(false);
  mockUpdate.mockResolvedValue(undefined);
});

// --- detectArchitecturePatterns ---

describe('detectArchitecturePatterns', () => {
  it('detects Service-Controller pattern', () => {
    const files = [
      'src/controllers/user.js',
      'src/services/user-service.js',
      'src/routes/index.js',
    ];
    expect(detectArchitecturePatterns(files)).toBe('Service-Controller');
  });

  it('detects Repository pattern', () => {
    const files = [
      'src/controllers/order.js',
      'src/services/order-service.js',
      'src/repositories/order-repo.js',
    ];
    expect(detectArchitecturePatterns(files)).toBe('Repository');
  });

  it('detects Hexagonal pattern', () => {
    const files = [
      'src/domain/order.js',
      'src/adapters/http.js',
      'src/ports/order-port.js',
    ];
    expect(detectArchitecturePatterns(files)).toBe('Hexagonal');
  });

  it('returns Flat for small projects', () => {
    const files = ['index.js', 'utils.js'];
    expect(detectArchitecturePatterns(files)).toBe('Flat');
  });

  it('returns Unknown for unrecognized structure', () => {
    const files = ['a/b.js', 'c/d.js', 'e/f.js', 'g/h.js', 'i/j.js', 'k/l.js'];
    // None of the known directory patterns → Unknown
    const result = detectArchitecturePatterns(files);
    expect(result).toBe('Unknown');
  });
});

// --- detectDependencyProfile ---

describe('detectDependencyProfile', () => {
  it('extracts runtime and dev dependencies', () => {
    const configFiles = {
      'package.json': {
        dependencies: { express: '^4.0.0', lodash: '^4.0.0' },
        devDependencies: { vitest: '^1.0.0', eslint: '^8.0.0' },
      },
    };
    const result = detectDependencyProfile(configFiles);
    expect(result.runtime).toContain('express');
    expect(result.runtime).toContain('lodash');
    expect(result.dev).toContain('vitest');
    expect(result.dev).toContain('eslint');
  });

  it('returns empty arrays when no package.json', () => {
    const result = detectDependencyProfile({});
    expect(result.runtime).toEqual([]);
    expect(result.dev).toEqual([]);
  });
});

// --- detectApiStyle ---

describe('detectApiStyle', () => {
  it('detects express from dependencies', () => {
    const configFiles = { 'package.json': { dependencies: { express: '^4.0.0' } } };
    expect(detectApiStyle(configFiles, [])).toBe('express');
  });

  it('detects fastify from dependencies', () => {
    const configFiles = { 'package.json': { dependencies: { fastify: '^4.0.0' } } };
    expect(detectApiStyle(configFiles, [])).toBe('fastify');
  });

  it('detects mcp from dependencies', () => {
    const configFiles = { 'package.json': { dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } } };
    expect(detectApiStyle(configFiles, [])).toBe('mcp');
  });

  it('detects graphql from file contents when not in deps', () => {
    const configFiles = {};
    const sampledFiles = [{ path: 'src/schema.js', content: "import { graphql } from 'graphql';" }];
    expect(detectApiStyle(configFiles, sampledFiles)).toBe('graphql');
  });

  it('returns null when no API style detected', () => {
    expect(detectApiStyle({}, [])).toBeNull();
  });
});

// --- detectTestingPatterns ---

describe('detectTestingPatterns', () => {
  it('detects vitest from package.json', () => {
    mockExistsSync.mockReturnValue(false);
    const configFiles = {
      'package.json': {
        devDependencies: { vitest: '^1.0.0' },
        scripts: { test: 'vitest run' },
      },
    };
    const result = detectTestingPatterns('/repo', configFiles, ['src/foo.test.js']);
    expect(result.framework).toBe('vitest');
    expect(result.testScript).toBe('vitest run');
    expect(result.testFileCount).toBe(1);
  });

  it('detects jest from devDependencies', () => {
    mockExistsSync.mockReturnValue(false);
    const configFiles = { 'package.json': { devDependencies: { jest: '^29.0.0' } } };
    const result = detectTestingPatterns('/repo', configFiles, []);
    expect(result.framework).toBe('jest');
  });

  it('detects colocated test file pattern', () => {
    mockExistsSync.mockReturnValue(false);
    const configFiles = {};
    const allFiles = ['src/foo.test.js', 'src/bar.test.js', 'src/baz.spec.js'];
    const result = detectTestingPatterns('/repo', configFiles, allFiles);
    expect(result.filePattern).toContain('colocated');
  });

  it('returns null framework when no test framework found', () => {
    mockExistsSync.mockReturnValue(false);
    const result = detectTestingPatterns('/repo', {}, []);
    expect(result.framework).toBeNull();
  });
});

// --- learnFromCodebase ---

describe('learnFromCodebase', () => {
  it('returns cached data on cache hit', async () => {
    const cachedData = {
      projectId: 'proj-1',
      architecture: { pattern: 'Service-Controller' },
      generatedAt: '2024-01-01T00:00:00.000Z',
    };
    mockGetById.mockResolvedValue(cachedData);

    const result = await learnFromCodebase({ projectId: 'proj-1', cwd: '/repo' });

    expect(result).toEqual(cachedData);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'codebase-learning:started',
      expect.any(Object),
    );
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'codebase-learning:completed',
      expect.objectContaining({ metadata: expect.objectContaining({ cacheHit: true }) }),
    );
  });

  it('runs full analysis on cache miss', async () => {
    mockGetById.mockResolvedValue(null);

    // listSourceFiles (first call)
    mockExecFileSync.mockReturnValueOnce('src/controllers/user.js\nsrc/services/user-service.js\n');
    // allFiles (second call)
    mockExecFileSync.mockReturnValueOnce('src/controllers/user.js\nsrc/services/user-service.js\nsrc/services/user-service.test.js\n');

    // readConfigFiles — existsSync returns true only for package.json
    mockExistsSync.mockImplementation((p) => p.endsWith('package.json'));

    // First call: readConfigFiles reads package.json
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }));
    // Subsequent calls: sampleRepresentativeFiles reads source files
    mockReadFileSync.mockReturnValue("import express from 'express';\nexport function handler() {}");

    const result = await learnFromCodebase({ projectId: 'proj-2', cwd: '/repo' });

    expect(result.projectId).toBe('proj-2');
    expect(result.architecture).toBeDefined();
    expect(result.testing).toBeDefined();
    expect(result.dependencies).toBeDefined();
    expect(mockUpdate).toHaveBeenCalledWith('learning', 'proj-2', expect.objectContaining({ projectId: 'proj-2' }));
  });

  it('forces refresh when codebaseLearningForceRefresh is true', async () => {
    mockConfig.codebaseLearningForceRefresh = true;

    // Should not call getById
    mockExecFileSync.mockReturnValue('src/index.js\n');
    mockReadFileSync.mockReturnValue('const x = 1;');
    mockExistsSync.mockReturnValue(false);

    await learnFromCodebase({ projectId: 'proj-3', cwd: '/repo' });

    expect(mockGetById).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('emits CODEBASE_LEARNING_COMPLETED with cacheHit false on fresh analysis', async () => {
    mockGetById.mockResolvedValue(null);
    mockExecFileSync.mockReturnValue('src/index.js\n');
    mockReadFileSync.mockReturnValue('const x = 1;');
    mockExistsSync.mockReturnValue(false);

    await learnFromCodebase({ projectId: 'proj-4', cwd: '/repo' });

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'codebase-learning:completed',
      expect.objectContaining({ metadata: expect.objectContaining({ cacheHit: false }) }),
    );
  });

  it('continues gracefully when Firebase getById throws', async () => {
    mockGetById.mockRejectedValue(new Error('Firebase unavailable'));
    mockExecFileSync.mockReturnValue('src/index.js\n');
    mockReadFileSync.mockReturnValue('const x = 1;');
    mockExistsSync.mockReturnValue(false);

    // Should not throw
    const result = await learnFromCodebase({ projectId: 'proj-5', cwd: '/repo' });
    expect(result).toBeDefined();
  });
});
