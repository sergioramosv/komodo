import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig, mockExecFileSync } = vi.hoisted(() => ({
  mockConfig: {
    autoImprove: true,
    autoImproveMaxProposals: 5,
    autoImproveCategories: '',
  },
  mockExecFileSync: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: { AUTO_IMPROVE_PROPOSALS_GENERATED: 'auto-improve:proposals-generated' },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
  create: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import {
  CATEGORIES,
  getEnabledCategories,
  findDuplicateCandidates,
  findLongFunctions,
  findMissingTests,
  findTodoFixme,
  findVulnerableDeps,
  analyzeCodebase,
  generateProposals,
  runAutoImprove,
} from './codebase-analyzer.js';

import { getAll, create } from '../../skills/planning-task-mcp/src/firebase.js';
import { eventBus } from '../events/event-bus.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.autoImprove = true;
  mockConfig.autoImproveMaxProposals = 5;
  mockConfig.autoImproveCategories = '';
});

// --- getEnabledCategories ---

describe('getEnabledCategories', () => {
  it('returns all categories when config is empty', () => {
    const cats = getEnabledCategories();
    expect(cats).toEqual(Object.values(CATEGORIES));
  });

  it('returns only specified categories', () => {
    mockConfig.autoImproveCategories = 'duplicate,todo-fixme';
    const cats = getEnabledCategories();
    expect(cats).toEqual(['duplicate', 'todo-fixme']);
  });

  it('filters out invalid categories', () => {
    mockConfig.autoImproveCategories = 'duplicate,invalid-cat,todo-fixme';
    const cats = getEnabledCategories();
    expect(cats).toEqual(['duplicate', 'todo-fixme']);
  });
});

// --- findDuplicateCandidates ---

describe('findDuplicateCandidates', () => {
  it('detects files with same name in different directories', () => {
    mockExecFileSync.mockReturnValue('src/utils/logger.js\nsrc/server/logger.js\nsrc/index.js\n');

    const results = findDuplicateCandidates('/repo');
    expect(results).toHaveLength(1);
    expect(results[0].reason).toContain('logger.js');
  });

  it('ignores test files', () => {
    mockExecFileSync.mockReturnValue('src/foo.js\nsrc/foo.test.js\nlib/foo.test.js\n');

    const results = findDuplicateCandidates('/repo');
    expect(results).toHaveLength(0);
  });

  it('returns empty on error', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('fail'); });

    const results = findDuplicateCandidates('/repo');
    expect(results).toEqual([]);
  });
});

// --- findLongFunctions ---

describe('findLongFunctions', () => {
  it('detects functions exceeding threshold', () => {
    mockExecFileSync
      .mockReturnValueOnce('src/big.js\n') // git ls-files
      .mockReturnValueOnce(
        'function bigFunc() {\n' +
        Array(55).fill('  const x = 1;').join('\n') + '\n' +
        '}\n',
      ); // git show

    const results = findLongFunctions('/repo');
    expect(results).toHaveLength(1);
    expect(results[0].reason).toContain('bigFunc');
  });

  it('ignores short functions', () => {
    mockExecFileSync
      .mockReturnValueOnce('src/small.js\n')
      .mockReturnValueOnce('function small() {\n  return 1;\n}\n');

    const results = findLongFunctions('/repo');
    expect(results).toHaveLength(0);
  });
});

// --- findMissingTests ---

describe('findMissingTests', () => {
  it('detects source files without tests', () => {
    mockExecFileSync.mockReturnValue('src/foo.js\nsrc/bar.js\nsrc/bar.test.js\n');

    const results = findMissingTests('/repo');
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('src/foo.js');
  });

  it('returns empty when all files have tests', () => {
    mockExecFileSync.mockReturnValue('src/foo.js\nsrc/foo.test.js\n');

    const results = findMissingTests('/repo');
    expect(results).toHaveLength(0);
  });
});

// --- findTodoFixme ---

describe('findTodoFixme', () => {
  it('finds TODO and FIXME comments', () => {
    mockExecFileSync.mockReturnValue(
      'src/app.js:10:// TODO: refactor this\nsrc/utils.js:5:// FIXME: broken\n',
    );

    const results = findTodoFixme('/repo');
    expect(results).toHaveLength(2);
    expect(results[0].reason).toContain('TODO');
    expect(results[1].reason).toContain('FIXME');
  });

  it('returns empty when git grep finds no matches (exit code 1)', () => {
    const err = new Error('no matches');
    err.status = 1;
    mockExecFileSync.mockImplementation(() => { throw err; });

    const results = findTodoFixme('/repo');
    expect(results).toEqual([]);
  });
});

// --- findVulnerableDeps ---

describe('findVulnerableDeps', () => {
  it('parses npm audit json output from stderr/stdout on non-zero exit', () => {
    const auditResult = {
      vulnerabilities: {
        lodash: { severity: 'high' },
        minimist: { severity: 'moderate' },
      },
    };
    const err = new Error('audit failed');
    err.stdout = JSON.stringify(auditResult);
    mockExecFileSync.mockImplementation(() => { throw err; });

    const results = findVulnerableDeps('/repo');
    expect(results).toHaveLength(2);
    expect(results[0].reason).toContain('lodash');
  });

  it('parses clean npm audit output', () => {
    mockExecFileSync.mockReturnValue(JSON.stringify({ vulnerabilities: {} }));

    const results = findVulnerableDeps('/repo');
    expect(results).toHaveLength(0);
  });
});

// --- analyzeCodebase ---

describe('analyzeCodebase', () => {
  it('runs selected categories and aggregates findings', () => {
    // Only run missing-tests category
    mockExecFileSync.mockReturnValue('src/app.js\n');

    const findings = analyzeCodebase('/repo', { categories: ['missing-tests'] });
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].category).toBe('missing-tests');
  });

  it('skips unknown categories', () => {
    const findings = analyzeCodebase('/repo', { categories: ['unknown-cat'] });
    expect(findings).toEqual([]);
  });
});

// --- generateProposals ---

describe('generateProposals', () => {
  it('creates proposals in Firebase and deduplicates', async () => {
    getAll.mockResolvedValue([
      { category: 'duplicate', file: 'a.js', reason: 'existing' },
    ]);
    create.mockResolvedValue('proposal-1');

    const findings = [
      { category: 'duplicate', file: 'a.js', reason: 'existing' }, // duplicate
      { category: 'todo-fixme', file: 'b.js', reason: 'TODO: fix' }, // new
    ];

    const proposals = await generateProposals(findings, 'proj-1');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].category).toBe('todo-fixme');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('limits to maxProposals', async () => {
    mockConfig.autoImproveMaxProposals = 2;
    getAll.mockResolvedValue([]);
    create.mockResolvedValue('id');

    const findings = Array.from({ length: 10 }, (_, i) => ({
      category: 'todo-fixme',
      file: `file${i}.js`,
      reason: `TODO #${i}`,
    }));

    const proposals = await generateProposals(findings, 'proj-1');
    expect(proposals).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('handles getAll errors gracefully', async () => {
    getAll.mockRejectedValue(new Error('Firebase down'));
    create.mockResolvedValue('id');

    const findings = [{ category: 'todo-fixme', file: 'a.js', reason: 'TODO' }];
    const proposals = await generateProposals(findings, 'proj-1');

    // Should still create proposals (no dedup possible)
    expect(proposals).toHaveLength(1);
  });
});

// --- runAutoImprove ---

describe('runAutoImprove', () => {
  it('skips when autoImprove is disabled', async () => {
    mockConfig.autoImprove = false;

    const result = await runAutoImprove({ projectId: 'p1', cwd: '/repo' });
    expect(result).toEqual({ findings: 0, proposals: [] });
  });

  it('runs analysis and emits event', async () => {
    mockExecFileSync.mockReturnValue('src/app.js\n');
    getAll.mockResolvedValue([]);
    create.mockResolvedValue('prop-id');

    const result = await runAutoImprove({
      projectId: 'p1',
      cwd: '/repo',
      categories: ['missing-tests'],
    });

    expect(result.findings).toBeGreaterThanOrEqual(1);
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'auto-improve:proposals-generated',
      expect.objectContaining({
        metadata: expect.objectContaining({
          findingsCount: expect.any(Number),
          proposalsCount: expect.any(Number),
        }),
      }),
    );
  });

  it('returns empty when no findings', async () => {
    // All categories will fail or return empty
    mockExecFileSync.mockReturnValue('\n');

    const result = await runAutoImprove({
      projectId: 'p1',
      cwd: '/repo',
      categories: ['missing-tests'],
    });

    expect(result).toEqual({ findings: 0, proposals: [] });
  });
});
