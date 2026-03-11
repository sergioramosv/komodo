import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We'll override config.knowledgeDir to a temp directory for tests
const TEST_DIR = join(tmpdir(), `kg-test-${Date.now()}`);

vi.mock('../config.js', () => ({
  config: {
    knowledgeDir: TEST_DIR,
  },
}));

// Import after mock setup
const {
  saveSection,
  loadSection,
  buildCoderContext,
  buildReviewerContext,
  extractAndSaveLessons,
  loadModuleLessons,
} = await import('./knowledge-graph.js');

const PROJECT_ID = 'test-project';
const TASK_ID = 'test-task-001';

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('saveSection / loadSection', () => {
  it('saves and loads a section round-trip', () => {
    const data = { filesToCreate: [{ path: 'src/foo.js', purpose: 'test' }] };
    saveSection(PROJECT_ID, TASK_ID, 'architect', data);
    const loaded = loadSection(PROJECT_ID, TASK_ID, 'architect');
    expect(loaded).not.toBeNull();
    expect(loaded.filesToCreate[0].path).toBe('src/foo.js');
    expect(loaded._savedAt).toBeDefined();
  });

  it('returns null for a missing section', () => {
    const result = loadSection(PROJECT_ID, TASK_ID, 'nonexistent');
    expect(result).toBeNull();
  });

  it('overwrites an existing section on re-save', () => {
    saveSection(PROJECT_ID, TASK_ID, 'coder', { prNumber: 1 });
    saveSection(PROJECT_ID, TASK_ID, 'coder', { prNumber: 2 });
    const loaded = loadSection(PROJECT_ID, TASK_ID, 'coder');
    expect(loaded.prNumber).toBe(2);
  });
});

describe('buildCoderContext', () => {
  it('returns null when no architect section exists', () => {
    const result = buildCoderContext(PROJECT_ID, TASK_ID);
    expect(result).toBeNull();
  });

  it('returns compact brief when architect section exists', () => {
    const plan = {
      filesToCreate: [{ path: 'src/a.js', purpose: 'module A', exports: ['fnA'] }],
      filesToModify: [{ path: 'src/b.js', changes: 'Add method foo' }],
      implementationOrder: ['1. Create src/a.js', '2. Modify src/b.js'],
    };
    saveSection(PROJECT_ID, TASK_ID, 'architect', plan);
    const result = buildCoderContext(PROJECT_ID, TASK_ID);
    expect(result).not.toBeNull();
    expect(result.coderBrief).toContain('src/a.js');
    expect(result.coderBrief).toContain('src/b.js');
    expect(result.coderBrief).toContain('fnA');
  });

  it('enforces ~8000 char token budget', () => {
    const longChanges = 'x'.repeat(500);
    const plan = {
      filesToCreate: [],
      filesToModify: Array.from({ length: 50 }, (_, i) => ({
        path: `src/file${i}.js`,
        changes: longChanges,
      })),
    };
    saveSection(PROJECT_ID, TASK_ID, 'architect', plan);
    const result = buildCoderContext(PROJECT_ID, TASK_ID);
    expect(result.coderBrief.length).toBeLessThanOrEqual(8050); // small buffer for truncation marker
  });
});

describe('buildReviewerContext', () => {
  it('returns null when no sections exist', () => {
    const result = buildReviewerContext(PROJECT_ID, TASK_ID);
    expect(result).toBeNull();
  });

  it('builds reviewer brief from available sections', () => {
    saveSection(PROJECT_ID, TASK_ID, 'architect', {
      filesToCreate: [{ path: 'src/new.js' }],
      filesToModify: [{ path: 'src/old.js' }],
    });
    saveSection(PROJECT_ID, TASK_ID, 'coder', {
      prNumber: 42,
      filesChanged: ['src/new.js'],
      summary: 'Implemented feature X',
    });
    saveSection(PROJECT_ID, TASK_ID, 'security', {
      qualityGate: 'OK',
      issueCount: { BLOCKER: 0 },
    });

    const result = buildReviewerContext(PROJECT_ID, TASK_ID);
    expect(result).not.toBeNull();
    expect(result.reviewerBrief).toContain('Prior Agent Context');
    expect(result.reviewerBrief).toContain('src/new.js');
    expect(result.reviewerBrief).toContain('Implemented feature X');
    expect(result.reviewerBrief).toContain('OK');
  });

  it('handles missing security section gracefully', () => {
    saveSection(PROJECT_ID, TASK_ID, 'coder', { prNumber: 7, summary: 'done' });
    const result = buildReviewerContext(PROJECT_ID, TASK_ID);
    expect(result).not.toBeNull();
    expect(result.reviewerBrief).not.toContain('Quality Gate');
  });
});

describe('loadModuleLessons', () => {
  it('returns empty string when no lessons file exists', () => {
    const result = loadModuleLessons(PROJECT_ID, 'nonexistent-module');
    expect(result).toBe('');
  });

  it('returns formatted lessons after extractAndSaveLessons', () => {
    saveSection(PROJECT_ID, TASK_ID, 'architect', {
      risks: ['Use path.join() on Windows'],
    });
    saveSection(PROJECT_ID, TASK_ID, 'reviewer', {
      issues: [{ severity: 'critical', description: 'Missing null check' }],
      positives: ['Good test coverage'],
    });
    saveSection(PROJECT_ID, TASK_ID, 'coder', { summary: 'Added auth module' });

    extractAndSaveLessons(PROJECT_ID, TASK_ID, 'auth');
    const lessons = loadModuleLessons(PROJECT_ID, 'auth');
    expect(lessons).toContain('Missing null check');
    expect(lessons).toContain('Good test coverage');
    expect(lessons).toContain('Use path.join() on Windows');
    expect(lessons).toContain('Added auth module');
  });

  it('caps lessons entries at 20 per module', async () => {
    // Save 25 tasks worth of lessons
    for (let i = 0; i < 25; i++) {
      const tid = `task-${i}`;
      saveSection(PROJECT_ID, tid, 'reviewer', {
        issues: [{ severity: 'major', description: `Issue ${i}` }],
        positives: [],
      });
      extractAndSaveLessons(PROJECT_ID, tid, 'shared-module');
    }

    const data = JSON.parse(
      readFileSync(join(TEST_DIR, PROJECT_ID, 'lessons', 'shared-module.json'), 'utf-8'),
    );
    expect(data.lessons.length).toBeLessThanOrEqual(20);
  });
});
