import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module
vi.mock('../config.js', () => ({
  config: {
    defaultUserId: 'user-123',
    defaultUserName: 'Test User',
    githubIssuePollMinutes: 5,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  create: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock('../../skills/github-mcp/src/gh-cli.js', () => ({
  runGh: vi.fn(),
  runGhApi: vi.fn(),
}));

import {
  extractUserStory,
  extractAcceptanceCriteria,
  syncIssue,
  pollOnce,
  fetchLabeledIssues,
  commentOnIssue,
  swapLabel,
} from './github-issue-sync.js';
import { create, getAll } from '../../skills/planning-task-mcp/src/firebase.js';
import { runGh, runGhApi } from '../../skills/github-mcp/src/gh-cli.js';
import { logger } from '../utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractUserStory', () => {
  it('extracts Spanish user story pattern', () => {
    const body = 'Como usuario admin\nQuiero poder eliminar cuentas\nPara mantener el sistema limpio';
    const result = extractUserStory('Delete accounts', body);

    expect(result.who).toBe('usuario admin');
    expect(result.what).toBe('poder eliminar cuentas');
    expect(result.why).toBe('mantener el sistema limpio');
  });

  it('extracts English user story pattern', () => {
    const body = 'As a developer, I want to run tests in CI, So that I can catch regressions early';
    const result = extractUserStory('CI tests', body);

    expect(result.who).toBe('developer');
    expect(result.what).toBe('to run tests in CI');
    expect(result.why).toBe('I can catch regressions early');
  });

  it('falls back to title when no pattern is found', () => {
    const result = extractUserStory('Fix login bug', 'The login page crashes on submit');

    expect(result.who).toBe('a user of the application');
    expect(result.what).toBe('Fix login bug');
    expect(result.why).toBe('The login page crashes on submit');
  });

  it('handles empty body gracefully', () => {
    const result = extractUserStory('Add dark mode', '');

    expect(result.who).toBe('a user of the application');
    expect(result.what).toBe('Add dark mode');
    expect(result.why).toBe('improve the application');
  });

  it('handles undefined body gracefully', () => {
    const result = extractUserStory('Add dark mode');

    expect(result.who).toBe('a user of the application');
    expect(result.what).toBe('Add dark mode');
  });
});

describe('extractAcceptanceCriteria', () => {
  it('extracts criteria from checkbox list', () => {
    const body = `## Acceptance Criteria
- [ ] User can log in with email
- [ ] User can log in with Google
- [x] Password reset works`;

    const criteria = extractAcceptanceCriteria(body);

    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe('User can log in with email');
    expect(criteria[1]).toBe('User can log in with Google');
    expect(criteria[2]).toBe('Password reset works');
  });

  it('extracts criteria from numbered list', () => {
    const body = `## Requirements
1. Support dark mode
2. Persist preference
3. Toggle in settings`;

    const criteria = extractAcceptanceCriteria(body);

    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe('Support dark mode');
    expect(criteria[1]).toBe('Persist preference');
    expect(criteria[2]).toBe('Toggle in settings');
  });

  it('returns fallback when no lists found', () => {
    const criteria = extractAcceptanceCriteria('Just some plain text');

    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toBe('Feature implemented as described in the issue');
  });

  it('handles empty body', () => {
    const criteria = extractAcceptanceCriteria('');

    expect(criteria).toHaveLength(1);
  });

  it('prefers checkboxes over numbered lists when both present', () => {
    const body = `- [ ] Checkbox item
1. Numbered item`;

    const criteria = extractAcceptanceCriteria(body);

    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toBe('Checkbox item');
  });
});

describe('syncIssue', () => {
  const mockIssue = {
    number: 42,
    title: 'Add dark mode',
    body: 'As a user, I want dark mode, So that I can reduce eye strain',
    url: 'https://github.com/owner/repo/issues/42',
  };
  const repo = 'owner/repo';
  const projectId = 'proj-123';
  const label = 'komodo';

  it('creates a task for a new issue', async () => {
    const existingTasks = [];
    create.mockResolvedValue('task-abc');

    const result = await syncIssue(mockIssue, repo, projectId, label, existingTasks);

    expect(result).toEqual({ created: true, taskId: 'task-abc' });
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      projectId: 'proj-123',
      title: '[GH-42] Add dark mode',
      status: 'to-do',
      githubIssueNumber: 42,
      githubIssueUrl: mockIssue.url,
      source: 'github-issue-sync',
    }));
  });

  it('skips already-synced issues (deduplication)', async () => {
    const existingTasks = [
      { projectId: 'proj-123', githubIssueNumber: 42 },
    ];

    const result = await syncIssue(mockIssue, repo, projectId, label, existingTasks);

    expect(result).toEqual({ created: false, skipped: 'already-synced' });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not deduplicate issues from different projects', async () => {
    const existingTasks = [
      { projectId: 'other-project', githubIssueNumber: 42 },
    ];
    create.mockResolvedValue('task-xyz');

    const result = await syncIssue(mockIssue, repo, projectId, label, existingTasks);

    expect(result).toEqual({ created: true, taskId: 'task-xyz' });
    expect(create).toHaveBeenCalled();
  });

  it('comments on issue and swaps label after creation', async () => {
    const existingTasks = [];
    create.mockResolvedValue('task-abc');

    await syncIssue(mockIssue, repo, projectId, label, existingTasks);

    // Comment was posted
    expect(runGhApi).toHaveBeenCalledWith(
      '/repos/owner/repo/issues/42/comments',
      expect.objectContaining({ method: 'POST' }),
    );
    // Label was swapped (DELETE old + POST new)
    expect(runGhApi).toHaveBeenCalledWith(
      '/repos/owner/repo/issues/42/labels/komodo',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(runGhApi).toHaveBeenCalledWith(
      '/repos/owner/repo/issues/42/labels',
      expect.objectContaining({ method: 'POST', body: { labels: ['komodo:queued'] } }),
    );
  });

  it('handles comment failure gracefully', async () => {
    const existingTasks = [];
    create.mockResolvedValue('task-abc');
    // Make the first runGhApi call (comment) throw
    runGhApi.mockImplementationOnce(() => { throw new Error('API rate limit'); });

    const result = await syncIssue(mockIssue, repo, projectId, label, existingTasks);

    expect(result).toEqual({ created: true, taskId: 'task-abc' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not comment'),
      expect.any(String),
    );
  });

  it('handles label swap failure gracefully', async () => {
    const existingTasks = [];
    create.mockResolvedValue('task-abc');
    // Comment succeeds, label DELETE throws
    runGhApi
      .mockImplementationOnce(() => {}) // comment OK
      .mockImplementationOnce(() => { throw new Error('Not found'); }); // label DELETE fails

    const result = await syncIssue(mockIssue, repo, projectId, label, existingTasks);

    expect(result).toEqual({ created: true, taskId: 'task-abc' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not swap label'),
      expect.any(String),
    );
  });

  it('generates correct queued label with colon-namespaced label', async () => {
    const existingTasks = [];
    create.mockResolvedValue('task-abc');
    runGhApi.mockImplementation(() => {});

    await syncIssue(mockIssue, repo, projectId, 'komodo:ready', existingTasks);

    expect(runGhApi).toHaveBeenCalledWith(
      expect.stringContaining('/labels'),
      expect.objectContaining({ method: 'POST', body: { labels: ['komodo:queued'] } }),
    );
  });
});

describe('pollOnce', () => {
  const opts = { repo: 'owner/repo', projectId: 'proj-123', label: 'komodo' };

  it('returns zeros when no issues found', async () => {
    runGh.mockReturnValue([]);

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 0, skipped: 0, errors: 0 });
  });

  it('returns error count when fetchLabeledIssues throws', async () => {
    runGh.mockImplementation(() => { throw new Error('Network error'); });

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 0, skipped: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch issues'),
      expect.any(String),
    );
  });

  it('returns error count when getAll throws', async () => {
    runGh.mockReturnValue([{ number: 1, title: 'Test', body: '', url: 'url' }]);
    getAll.mockRejectedValue(new Error('Firebase down'));

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 0, skipped: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load tasks'),
      expect.any(String),
    );
  });

  it('syncs new issues and counts correctly', async () => {
    runGh.mockReturnValue([
      { number: 1, title: 'Issue 1', body: '', url: 'url1' },
      { number: 2, title: 'Issue 2', body: '', url: 'url2' },
    ]);
    getAll.mockResolvedValue([]); // no existing tasks
    create.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2');

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 2, skipped: 0, errors: 0 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('skips already-synced issues', async () => {
    runGh.mockReturnValue([
      { number: 1, title: 'Issue 1', body: '', url: 'url1' },
      { number: 2, title: 'Issue 2', body: '', url: 'url2' },
    ]);
    getAll.mockResolvedValue([
      { projectId: 'proj-123', githubIssueNumber: 1 },
    ]);
    create.mockResolvedValue('task-2');

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 1, skipped: 1, errors: 0 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('counts errors when individual syncIssue fails', async () => {
    runGh.mockReturnValue([
      { number: 1, title: 'Issue 1', body: '', url: 'url1' },
      { number: 2, title: 'Issue 2', body: '', url: 'url2' },
    ]);
    getAll.mockResolvedValue([]);
    create
      .mockRejectedValueOnce(new Error('Firebase write failed'))
      .mockResolvedValueOnce('task-2');

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 1, skipped: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error syncing issue #1'),
      expect.any(String),
    );
  });

  it('loads tasks only once for multiple issues (no O(N*M))', async () => {
    runGh.mockReturnValue([
      { number: 1, title: 'Issue 1', body: '', url: 'url1' },
      { number: 2, title: 'Issue 2', body: '', url: 'url2' },
      { number: 3, title: 'Issue 3', body: '', url: 'url3' },
    ]);
    getAll.mockResolvedValue([]);
    create.mockResolvedValue('task-id');

    await pollOnce(opts);

    // getAll should be called exactly once, not once per issue
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll).toHaveBeenCalledWith('tasks');
  });

  it('handles null return from fetchLabeledIssues', async () => {
    runGh.mockReturnValue(null);

    const result = await pollOnce(opts);

    expect(result).toEqual({ synced: 0, skipped: 0, errors: 0 });
  });
});
