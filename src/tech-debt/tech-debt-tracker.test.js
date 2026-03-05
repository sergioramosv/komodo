import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    techDebtTracking: true,
    defaultUserId: 'user-1',
    defaultUserName: 'Test User',
  },
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
  EVENT_TYPES: { TECH_DEBT_CREATED: 'tech-debt:created' },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
  create: vi.fn(),
}));

import {
  extractMinorIssues,
  estimateDevPoints,
  deduplicationKey,
  createTechDebtTasks,
} from './tech-debt-tracker.js';

import { getAll, create } from '../../skills/planning-task-mcp/src/firebase.js';
import { eventBus } from '../events/event-bus.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.techDebtTracking = true;
  mockConfig.defaultUserId = 'user-1';
  mockConfig.defaultUserName = 'Test User';
});

// --- extractMinorIssues ---

describe('extractMinorIssues', () => {
  it('filters only suggestion and minor issues', () => {
    const issues = [
      { severity: 'critical', file: 'a.js', description: 'Critical bug' },
      { severity: 'major', file: 'b.js', description: 'Major issue' },
      { severity: 'minor', file: 'c.js', description: 'Minor thing' },
      { severity: 'suggestion', file: 'd.js', description: 'Suggestion' },
    ];

    const result = extractMinorIssues(issues);
    expect(result).toHaveLength(2);
    expect(result[0].severity).toBe('minor');
    expect(result[1].severity).toBe('suggestion');
  });

  it('returns empty for null/undefined input', () => {
    expect(extractMinorIssues(null)).toEqual([]);
    expect(extractMinorIssues(undefined)).toEqual([]);
  });

  it('returns empty when no minor issues exist', () => {
    const issues = [
      { severity: 'critical', file: 'a.js', description: 'Critical' },
    ];
    expect(extractMinorIssues(issues)).toEqual([]);
  });
});

// --- estimateDevPoints ---

describe('estimateDevPoints', () => {
  it('returns 1 for suggestion severity', () => {
    expect(estimateDevPoints('suggestion')).toBe(1);
  });

  it('returns 2 for minor severity', () => {
    expect(estimateDevPoints('minor')).toBe(2);
  });
});

// --- deduplicationKey ---

describe('deduplicationKey', () => {
  it('creates case-insensitive key from file and description', () => {
    const key = deduplicationKey('src/App.js', 'Missing null check');
    expect(key).toBe('src/app.js::missing null check');
  });

  it('handles empty/null values', () => {
    expect(deduplicationKey('', '')).toBe('::');
    expect(deduplicationKey(null, null)).toBe('::');
  });
});

// --- createTechDebtTasks ---

describe('createTechDebtTasks', () => {
  it('skips when techDebtTracking is disabled', async () => {
    mockConfig.techDebtTracking = false;

    const result = await createTechDebtTasks({
      issues: [{ severity: 'minor', file: 'a.js', description: 'Fix it' }],
      prNumber: 42,
      projectId: 'proj-1',
    });

    expect(result).toEqual({ created: 0, skipped: 0, tasks: [] });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns empty when no minor/suggestion issues', async () => {
    const result = await createTechDebtTasks({
      issues: [{ severity: 'critical', file: 'a.js', description: 'Critical' }],
      prNumber: 42,
      projectId: 'proj-1',
    });

    expect(result).toEqual({ created: 0, skipped: 0, tasks: [] });
  });

  it('creates tech-debt tasks from suggestion and minor issues', async () => {
    getAll.mockResolvedValue([]);
    create.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2');

    const issues = [
      { severity: 'critical', file: 'a.js', description: 'Critical bug' },
      { severity: 'suggestion', file: 'b.js', description: 'Add comment', line: 10 },
      { severity: 'minor', file: 'c.js', description: 'Rename variable', line: 25 },
    ];

    const result = await createTechDebtTasks({
      issues,
      prNumber: 42,
      projectId: 'proj-1',
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.tasks).toHaveLength(2);

    // Verify first task creation
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      projectId: 'proj-1',
      title: '[Tech Debt] Add comment (from PR #42)',
      bizPoints: 2,
      devPoints: 1, // suggestion → 1
      status: 'to-do',
      source: 'tech-debt',
      techDebtFile: 'b.js',
      techDebtDescription: 'Add comment',
      techDebtSeverity: 'suggestion',
      techDebtLine: 10,
      originPrNumber: 42,
    }));

    // Verify second task
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      devPoints: 2, // minor → 2
      techDebtFile: 'c.js',
      techDebtSeverity: 'minor',
    }));

    // Verify event emitted
    expect(eventBus.emitEvent).toHaveBeenCalledWith('tech-debt:created', expect.objectContaining({
      metadata: expect.objectContaining({
        created: 2,
        skipped: 0,
        prNumber: 42,
      }),
    }));
  });

  it('deduplicates against existing tech-debt tasks', async () => {
    getAll.mockResolvedValue([
      {
        source: 'tech-debt',
        techDebtFile: 'b.js',
        techDebtDescription: 'Add comment',
      },
    ]);
    create.mockResolvedValue('task-new');

    const issues = [
      { severity: 'suggestion', file: 'b.js', description: 'Add comment' }, // duplicate
      { severity: 'minor', file: 'c.js', description: 'New issue' }, // new
    ];

    const result = await createTechDebtTasks({
      issues,
      prNumber: 10,
      projectId: 'proj-1',
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      techDebtFile: 'c.js',
    }));
  });

  it('deduplicates within same batch (two issues with same file+description)', async () => {
    getAll.mockResolvedValue([]);
    create.mockResolvedValue('task-id');

    const issues = [
      { severity: 'minor', file: 'a.js', description: 'Same issue' },
      { severity: 'suggestion', file: 'a.js', description: 'Same issue' }, // same key
    ];

    const result = await createTechDebtTasks({
      issues,
      prNumber: 5,
      projectId: 'proj-1',
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('handles Firebase getAll errors gracefully', async () => {
    getAll.mockRejectedValue(new Error('Firebase down'));
    create.mockResolvedValue('task-id');

    const issues = [
      { severity: 'minor', file: 'a.js', description: 'Fix it' },
    ];

    const result = await createTechDebtTasks({
      issues,
      prNumber: 1,
      projectId: 'proj-1',
    });

    // Should still create tasks (no dedup possible)
    expect(result.created).toBe(1);
  });

  it('handles create errors gracefully without stopping other tasks', async () => {
    getAll.mockResolvedValue([]);
    create
      .mockRejectedValueOnce(new Error('Create failed'))
      .mockResolvedValueOnce('task-2');

    const issues = [
      { severity: 'minor', file: 'a.js', description: 'Issue 1' },
      { severity: 'suggestion', file: 'b.js', description: 'Issue 2' },
    ];

    const result = await createTechDebtTasks({
      issues,
      prNumber: 3,
      projectId: 'proj-1',
    });

    expect(result.created).toBe(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskId).toBe('task-2');
  });

  it('does not emit event when no tasks were created', async () => {
    getAll.mockResolvedValue([
      { source: 'tech-debt', techDebtFile: 'a.js', techDebtDescription: 'Exists' },
    ]);

    const issues = [
      { severity: 'minor', file: 'a.js', description: 'Exists' },
    ];

    await createTechDebtTasks({
      issues,
      prNumber: 1,
      projectId: 'proj-1',
    });

    expect(eventBus.emitEvent).not.toHaveBeenCalled();
  });
});
