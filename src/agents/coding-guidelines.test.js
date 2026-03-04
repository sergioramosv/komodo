import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('./base-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue({
    success: true,
    result: {
      prNumber: 1,
      prUrl: 'https://github.com/test/repo/pull/1',
      branchName: 'feature/test',
      filesChanged: ['src/index.js'],
      summary: 'test',
    },
    cost: null,
    duration: 1,
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    enableBrowserMcp: false,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    taskHeader: vi.fn(),
  },
}));

vi.mock('../utils/parser.js', () => ({
  validateAgentResponse: vi.fn().mockReturnValue({ valid: true, missing: [] }),
}));

import { implementTask, fixReviewIssues } from './coder.js';
import { reviewPR } from './reviewer.js';
import { runAgent } from './base-agent.js';

const baseTaskSpec = {
  taskId: 'task-123',
  title: 'Test task',
  userStory: { who: 'developer', what: 'add feature', why: 'improve UX' },
  acceptanceCriteria: ['Works correctly'],
  branchName: 'feature/test',
  repoUrl: 'https://github.com/test/repo',
};

describe('codingGuidelines injection in Coder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects codingGuidelines into the Coder user prompt when provided', async () => {
    const guidelines = 'Use TypeScript strict mode. Always add JSDoc comments.';

    await implementTask(baseTaskSpec, '/tmp', { codingGuidelines: guidelines });

    expect(runAgent).toHaveBeenCalledTimes(1);
    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('## Coding Guidelines del proyecto');
    expect(callArgs.userPrompt).toContain(guidelines);
  });

  it('does NOT inject codingGuidelines section when empty', async () => {
    await implementTask(baseTaskSpec, '/tmp', { codingGuidelines: '' });

    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).not.toContain('## Coding Guidelines del proyecto');
  });

  it('does NOT inject codingGuidelines section when undefined', async () => {
    await implementTask(baseTaskSpec, '/tmp', {});

    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).not.toContain('## Coding Guidelines del proyecto');
  });

  it('injects codingGuidelines into fixReviewIssues user prompt', async () => {
    runAgent.mockResolvedValueOnce({
      success: true,
      result: { fixed: true, issuesResolved: ['fix1'], filesChanged: ['a.js'], summary: 'fixed' },
      cost: null,
      duration: 1,
    });

    const guidelines = 'Follow ESLint rules strictly.';
    const reviewFeedback = { summary: 'Issues found', issues: ['Missing error handling'] };

    await fixReviewIssues(baseTaskSpec, 42, reviewFeedback, '/tmp', { codingGuidelines: guidelines });

    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('## Coding Guidelines del proyecto');
    expect(callArgs.userPrompt).toContain(guidelines);
  });

  it('does NOT inject into fixReviewIssues when codingGuidelines is empty', async () => {
    runAgent.mockResolvedValueOnce({
      success: true,
      result: { fixed: true, issuesResolved: ['fix1'], filesChanged: ['a.js'], summary: 'fixed' },
      cost: null,
      duration: 1,
    });

    const reviewFeedback = { summary: 'Issues found', issues: ['Missing error handling'] };

    await fixReviewIssues(baseTaskSpec, 42, reviewFeedback, '/tmp', { codingGuidelines: '' });

    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).not.toContain('## Coding Guidelines del proyecto');
  });
});

describe('codingGuidelines injection in Reviewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runAgent.mockResolvedValue({
      success: true,
      result: {
        verdict: 'APPROVED',
        score: 9,
        issues: [],
        positives: ['Good code'],
        summary: 'All good',
      },
      cost: null,
      duration: 1,
    });
  });

  it('injects codingGuidelines into the Reviewer user prompt when provided', async () => {
    const guidelines = 'All functions must have error handling.';

    await reviewPR({
      prNumber: 10,
      repo: 'test/repo',
      taskSpec: baseTaskSpec,
      cwd: '/tmp',
      codingGuidelines: guidelines,
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('## Coding Guidelines del proyecto');
    expect(callArgs.userPrompt).toContain(guidelines);
  });

  it('does NOT inject codingGuidelines section when empty', async () => {
    await reviewPR({
      prNumber: 10,
      repo: 'test/repo',
      taskSpec: baseTaskSpec,
      cwd: '/tmp',
      codingGuidelines: '',
    });

    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).not.toContain('## Coding Guidelines del proyecto');
  });

  it('does NOT inject codingGuidelines section when undefined', async () => {
    await reviewPR({
      prNumber: 10,
      repo: 'test/repo',
      taskSpec: baseTaskSpec,
      cwd: '/tmp',
    });

    const callArgs = runAgent.mock.calls[0][0];
    expect(callArgs.userPrompt).not.toContain('## Coding Guidelines del proyecto');
  });
});
