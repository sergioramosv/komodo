import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the prompt-building logic by importing the actual modules
// and verifying the user prompts contain/exclude codingGuidelines.

// Mock the dependencies that would cause side effects
vi.mock('./base-agent.js', () => ({
  runAgent: vi.fn(async () => ({
    success: true,
    result: { prNumber: 1, branchName: 'test', prUrl: '', filesChanged: [], summary: '' },
    cost: null,
    duration: 0,
  })),
}));

vi.mock('../config.js', () => ({
  config: {
    enableBrowserMcp: false,
    codebaseIndexEnabled: false,
    styleDetectorEnabled: false,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    taskHeader: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../utils/parser.js', () => ({
  validateAgentResponse: vi.fn(() => ({ valid: true, missing: [] })),
}));

vi.mock('../intelligence/codebase-indexer.js', () => ({
  getCodebaseContext: vi.fn(() => ({ summary: '' })),
}));

vi.mock('../intelligence/style-detector.js', () => ({
  getStyleContext: vi.fn(() => ({ summary: '' })),
}));

vi.mock('../intelligence/review-feedback.js', () => ({
  getReviewFeedbackContext: vi.fn(() => ({ summary: '' })),
}));

vi.mock('../prompts/coder-system.js', () => ({
  getCoderSystemPrompt: vi.fn(() => 'system-prompt'),
  getCoderFixSystemPrompt: vi.fn(() => 'fix-system-prompt'),
}));

vi.mock('../prompts/reviewer-system.js', () => ({
  getReviewerSystemPrompt: vi.fn(() => 'reviewer-system-prompt'),
}));

import { runAgent } from './base-agent.js';
import { implementTask, fixReviewIssues } from './coder.js';
import { reviewPR } from './reviewer.js';

const baseTaskSpec = {
  taskId: 'test-123',
  title: 'Test task',
  userStory: { who: 'developer', what: 'test feature', why: 'testing' },
  acceptanceCriteria: ['It works'],
  branchName: 'feature/test',
  repoUrl: 'https://github.com/test/repo',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('codingGuidelines injection — Coder implementTask', () => {
  it('includes codingGuidelines in user prompt when provided', async () => {
    const guidelines = 'Always use Zod. Never use any. Use vitest.';
    await implementTask(baseTaskSpec, '/tmp', { codingGuidelines: guidelines });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).toContain('## Project Coding Guidelines (MANDATORY)');
    expect(call.userPrompt).toContain(guidelines);
  });

  it('does NOT include codingGuidelines section when empty', async () => {
    await implementTask(baseTaskSpec, '/tmp', { codingGuidelines: '' });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).not.toContain('Project Coding Guidelines');
  });

  it('does NOT include codingGuidelines section when undefined', async () => {
    await implementTask(baseTaskSpec, '/tmp', {});

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).not.toContain('Project Coding Guidelines');
  });
});

describe('codingGuidelines injection — Coder fixReviewIssues', () => {
  it('includes codingGuidelines in fix prompt when provided', async () => {
    const guidelines = 'Prefer named exports. No default exports.';
    const feedback = { summary: 'Fix issues', issues: ['bug 1'] };

    await fixReviewIssues(baseTaskSpec, 42, feedback, '/tmp', { codingGuidelines: guidelines });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).toContain('## Project Coding Guidelines (MANDATORY)');
    expect(call.userPrompt).toContain(guidelines);
  });

  it('does NOT include codingGuidelines section when empty', async () => {
    const feedback = { summary: 'Fix issues', issues: [] };
    await fixReviewIssues(baseTaskSpec, 42, feedback, '/tmp', { codingGuidelines: '' });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).not.toContain('Project Coding Guidelines');
  });
});

describe('codingGuidelines injection — Reviewer reviewPR', () => {
  it('includes codingGuidelines in reviewer prompt when provided', async () => {
    const guidelines = 'Use Tailwind. No inline styles.';

    await reviewPR({
      prNumber: 42,
      repo: 'test/repo',
      taskSpec: baseTaskSpec,
      cwd: '/tmp',
      codingGuidelines: guidelines,
    });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).toContain('## Project Coding Guidelines (MANDATORY');
    expect(call.userPrompt).toContain(guidelines);
  });

  it('does NOT include codingGuidelines section when empty', async () => {
    await reviewPR({
      prNumber: 42,
      repo: 'test/repo',
      taskSpec: baseTaskSpec,
      cwd: '/tmp',
      codingGuidelines: '',
    });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).not.toContain('Project Coding Guidelines');
  });

  it('does NOT include codingGuidelines section when undefined', async () => {
    await reviewPR({
      prNumber: 42,
      repo: 'test/repo',
      taskSpec: baseTaskSpec,
      cwd: '/tmp',
    });

    const call = runAgent.mock.calls[0][0];
    expect(call.userPrompt).not.toContain('Project Coding Guidelines');
  });
});
