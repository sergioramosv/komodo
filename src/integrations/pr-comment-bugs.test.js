import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    defaultUserId: 'user-123',
    defaultUserName: 'Test User',
    prCommentBugsPollMinutes: 3,
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
}));

vi.mock('../../skills/github-mcp/src/gh-cli.js', () => ({
  runGh: vi.fn(),
  runGhApi: vi.fn(),
}));

import {
  detectSeverity,
  fetchOpenPRs,
  fetchPRComments,
  fetchPRReviewComments,
  processComment,
  pollOnce,
  getProcessedComments,
  clearProcessedComments,
} from './pr-comment-bugs.js';
import { create } from '../../skills/planning-task-mcp/src/firebase.js';
import { runGh, runGhApi } from '../../skills/github-mcp/src/gh-cli.js';
import { logger } from '../utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  clearProcessedComments();
});

describe('detectSeverity', () => {
  it('detects critical severity', () => {
    expect(detectSeverity('App crash on login')).toBe('critical');
    expect(detectSeverity('Security vulnerability in auth')).toBe('critical');
    expect(detectSeverity('Data loss when saving')).toBe('critical');
  });

  it('detects high severity', () => {
    expect(detectSeverity('Error in payment flow')).toBe('high');
    expect(detectSeverity('Cannot submit form')).toBe('high');
    expect(detectSeverity('Wrong calculation in total')).toBe('high');
  });

  it('detects medium severity', () => {
    expect(detectSeverity('Unexpected behavior in modal')).toBe('medium');
    expect(detectSeverity('Missing validation on field')).toBe('medium');
    expect(detectSeverity('Page loads slow')).toBe('medium');
  });

  it('detects low severity', () => {
    expect(detectSeverity('Typo in button label')).toBe('low');
    expect(detectSeverity('Cosmetic problem with spacing')).toBe('low');
    expect(detectSeverity('Minor formatting problem')).toBe('low');
  });

  it('defaults to medium when no keywords match', () => {
    expect(detectSeverity('Something needs attention')).toBe('medium');
  });

  it('is case-insensitive', () => {
    expect(detectSeverity('CRASH on startup')).toBe('critical');
    expect(detectSeverity('TYPO in header')).toBe('low');
  });

  it('matches first severity found (critical > high > medium > low)', () => {
    // "crash" is critical, "error" is high - critical wins
    expect(detectSeverity('crash with error')).toBe('critical');
  });
});

describe('processComment', () => {
  const repo = 'owner/repo';
  const projectId = 'proj-123';
  const prNumber = 10;
  const prTitle = 'Add login feature';

  const makeComment = (id, body, login = 'reviewer1') => ({
    id,
    body,
    user: { login },
    html_url: `https://github.com/owner/repo/pull/10#issuecomment-${id}`,
  });

  it('creates a bug from @komodo bug: comment', async () => {
    const comment = makeComment(100, '@komodo bug: Button does not respond to clicks');
    create.mockResolvedValue('bug-abc');

    const result = await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(result).toEqual({ created: true, bugId: 'bug-abc' });
    expect(create).toHaveBeenCalledWith('bugs', expect.objectContaining({
      projectId: 'proj-123',
      title: '[PR-10] Button does not respond to clicks',
      severity: 'medium',
      status: 'open',
      source: 'pr-comment',
      prNumber: 10,
      prCommentId: 100,
    }));
  });

  it('skips comments without the trigger', async () => {
    const comment = makeComment(101, 'Looks good to me!');

    const result = await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(result).toEqual({ created: false, skipped: 'no-trigger' });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not process the same comment twice', async () => {
    const comment = makeComment(102, '@komodo bug: Duplicate test');
    create.mockResolvedValue('bug-dup');

    const result1 = await processComment(comment, prNumber, prTitle, repo, projectId);
    const result2 = await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(result1).toEqual({ created: true, bugId: 'bug-dup' });
    expect(result2).toEqual({ created: false, skipped: 'already-processed' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('auto-detects severity from description', async () => {
    const comment = makeComment(103, '@komodo bug: App crash on startup');
    create.mockResolvedValue('bug-crit');

    await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(create).toHaveBeenCalledWith('bugs', expect.objectContaining({
      severity: 'critical',
    }));
  });

  it('replies to the comment confirming creation', async () => {
    const comment = makeComment(104, '@komodo bug: Missing field validation');
    create.mockResolvedValue('bug-reply');
    runGhApi.mockImplementation(() => {});

    await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(runGhApi).toHaveBeenCalledWith(
      '/repos/owner/repo/issues/10/comments',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          body: expect.stringContaining('bug-reply'),
        }),
      }),
    );
  });

  it('handles reply failure gracefully', async () => {
    const comment = makeComment(105, '@komodo bug: Some issue here');
    create.mockResolvedValue('bug-fail');
    runGhApi.mockImplementation(() => { throw new Error('API error'); });

    const result = await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(result).toEqual({ created: true, bugId: 'bug-fail' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not reply'),
      expect.any(String),
    );
  });

  it('includes PR context in bug description', async () => {
    const comment = makeComment(106, '@komodo bug: NullPointerException in handler');
    create.mockResolvedValue('bug-ctx');

    await processComment(comment, prNumber, prTitle, repo, projectId);

    const bugData = create.mock.calls[0][1];
    expect(bugData.description).toContain('@reviewer1');
    expect(bugData.description).toContain('#10');
    expect(bugData.description).toContain('Add login feature');
    expect(bugData.description).toContain('NullPointerException in handler');
  });

  it('handles multiline @komodo bug trigger', async () => {
    const comment = makeComment(107, '@komodo bug: The form crashes when\nsubmitting empty data');
    create.mockResolvedValue('bug-multi');

    const result = await processComment(comment, prNumber, prTitle, repo, projectId);

    expect(result).toEqual({ created: true, bugId: 'bug-multi' });
    expect(create).toHaveBeenCalledWith('bugs', expect.objectContaining({
      title: expect.stringContaining('The form crashes when'),
    }));
  });

  it('truncates long descriptions in title to 100 chars', async () => {
    const longDesc = 'A'.repeat(150);
    const comment = makeComment(108, `@komodo bug: ${longDesc}`);
    create.mockResolvedValue('bug-long');

    await processComment(comment, prNumber, prTitle, repo, projectId);

    const bugData = create.mock.calls[0][1];
    expect(bugData.title.length).toBeLessThanOrEqual(100 + '[PR-10] '.length);
  });
});

describe('pollOnce', () => {
  const opts = { repo: 'owner/repo', projectId: 'proj-123' };

  it('returns zeros when no open PRs', async () => {
    runGh.mockReturnValue([]);

    const result = await pollOnce(opts);

    expect(result).toEqual({ bugsCreated: 0, commentsScanned: 0, errors: 0 });
  });

  it('returns error when fetchOpenPRs throws', async () => {
    runGh.mockImplementation(() => { throw new Error('Network error'); });

    const result = await pollOnce(opts);

    expect(result).toEqual({ bugsCreated: 0, commentsScanned: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch PRs'),
      expect.any(String),
    );
  });

  it('scans comments across multiple PRs', async () => {
    runGh.mockReturnValue([
      { number: 1, title: 'PR 1', url: 'url1' },
      { number: 2, title: 'PR 2', url: 'url2' },
    ]);
    // Issue comments for PR 1, then review comments for PR 1, then PR 2 comments
    runGhApi
      .mockReturnValueOnce([{ id: 10, body: 'LGTM', user: { login: 'u1' } }]) // PR1 issue comments
      .mockReturnValueOnce([]) // PR1 review comments
      .mockReturnValueOnce([{ id: 20, body: '@komodo bug: crash here', user: { login: 'u2' }, html_url: 'url' }]) // PR2 issue comments
      .mockReturnValueOnce([]) // PR2 review comments
      .mockReturnValue(null); // reply
    create.mockResolvedValue('bug-1');

    const result = await pollOnce(opts);

    expect(result.bugsCreated).toBe(1);
    expect(result.commentsScanned).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('handles null return from fetchOpenPRs', async () => {
    runGh.mockReturnValue(null);

    const result = await pollOnce(opts);

    expect(result).toEqual({ bugsCreated: 0, commentsScanned: 0, errors: 0 });
  });

  it('counts errors when processComment throws', async () => {
    runGh.mockReturnValue([{ number: 1, title: 'PR 1', url: 'url1' }]);
    runGhApi
      .mockReturnValueOnce([{ id: 30, body: '@komodo bug: test error', user: { login: 'u1' }, html_url: 'url' }]) // issue comments
      .mockReturnValueOnce([]); // review comments
    create.mockRejectedValue(new Error('Firebase write failed'));

    const result = await pollOnce(opts);

    expect(result.errors).toBe(1);
    expect(result.bugsCreated).toBe(0);
  });

  it('processes review comments (inline code comments)', async () => {
    runGh.mockReturnValue([{ number: 5, title: 'PR 5', url: 'url5' }]);
    runGhApi
      .mockReturnValueOnce([]) // issue comments empty
      .mockReturnValueOnce([{ id: 50, body: '@komodo bug: wrong logic in parser', user: { login: 'reviewer' }, html_url: 'url', path: 'src/parser.js', line: 42 }]) // review comments
      .mockReturnValue(null); // reply
    create.mockResolvedValue('bug-review');

    const result = await pollOnce(opts);

    expect(result.bugsCreated).toBe(1);
    expect(create).toHaveBeenCalledWith('bugs', expect.objectContaining({
      title: '[PR-5] wrong logic in parser',
    }));
  });
});

describe('deduplication across polls', () => {
  it('does not reprocess comments between poll cycles', async () => {
    const opts = { repo: 'owner/repo', projectId: 'proj-123' };
    const comment = { id: 999, body: '@komodo bug: persistent bug', user: { login: 'u1' }, html_url: 'url' };

    runGh.mockReturnValue([{ number: 1, title: 'PR 1', url: 'url1' }]);
    runGhApi
      .mockReturnValueOnce([comment]) // first poll - issue comments
      .mockReturnValueOnce([]) // first poll - review comments
      .mockReturnValue(null); // reply
    create.mockResolvedValue('bug-persist');

    // First poll
    const result1 = await pollOnce(opts);
    expect(result1.bugsCreated).toBe(1);

    // Second poll with same comment
    runGhApi
      .mockReturnValueOnce([comment]) // same comment
      .mockReturnValueOnce([]);
    const result2 = await pollOnce(opts);
    expect(result2.bugsCreated).toBe(0);

    // create should only have been called once
    expect(create).toHaveBeenCalledTimes(1);
  });
});
