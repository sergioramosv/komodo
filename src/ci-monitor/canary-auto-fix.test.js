import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    forceModel_CODER: undefined,
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

vi.mock('../agents/coder.js', () => ({
  fixReviewIssues: vi.fn(),
}));

const { config } = await import('../config.js');
const { logger } = await import('../utils/logger.js');
const { fixReviewIssues } = await import('../agents/coder.js');
const { runCanaryAutoFix } = await import('./canary-auto-fix.js');

const BASE_OPTS = {
  taskSpec: {
    branchName: 'staging',
    acceptanceCriteria: ['AC1'],
    implementationPlan: 'plan',
  },
  branchName: 'staging',
  repo: 'owner/repo',
  cwd: '/fake/komodo',
  errorLog: 'Error: test failed\n  at foo.js:10',
  coderModel: undefined,
  codingGuidelines: undefined,
};

describe('runCanaryAutoFix', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns fixed:true when fixReviewIssues succeeds', async () => {
    fixReviewIssues.mockResolvedValue({ success: true });

    const result = await runCanaryAutoFix(BASE_OPTS);

    expect(result.fixed).toBe(true);
    expect(logger.success).toHaveBeenCalled();
  });

  it('returns fixed:false when fixReviewIssues returns success:false', async () => {
    fixReviewIssues.mockResolvedValue({ success: false, error: 'agent gave up' });

    const result = await runCanaryAutoFix(BASE_OPTS);

    expect(result.fixed).toBe(false);
    expect(result.error).toContain('agent gave up');
  });

  it('returns fixed:false when fixReviewIssues returns null', async () => {
    fixReviewIssues.mockResolvedValue(null);

    const result = await runCanaryAutoFix(BASE_OPTS);

    expect(result.fixed).toBe(false);
  });

  it('returns fixed:false and logs error when fixReviewIssues throws', async () => {
    fixReviewIssues.mockRejectedValue(new Error('network error'));

    const result = await runCanaryAutoFix(BASE_OPTS);

    expect(result.fixed).toBe(false);
    expect(result.error).toContain('network error');
    expect(logger.error).toHaveBeenCalled();
  });

  it('truncates errorLog to MAX_LOG_CHARS (5000 chars) in fixTaskSpec.ciErrorLog', async () => {
    const longLog = 'x'.repeat(10_000);
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix({ ...BASE_OPTS, errorLog: longLog });

    const [fixTaskSpec] = fixReviewIssues.mock.calls[0];
    expect(fixTaskSpec.ciErrorLog.length).toBeLessThanOrEqual(5000);
  });

  it('truncates errorLog in fixContext passed to fixReviewIssues', async () => {
    const longLog = 'y'.repeat(10_000);
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix({ ...BASE_OPTS, errorLog: longLog });

    // fixReviewIssues is called with (fixTaskSpec, null, { issues: [fixContext] }, ...)
    const [, , reviewResult] = fixReviewIssues.mock.calls[0];
    const fixContext = reviewResult.issues[0];
    // fixContext contains the log between ``` fences — check total length is reasonable
    expect(fixContext.length).toBeLessThan(6000);
  });

  it('merges taskSpec.acceptanceCriteria with the canary fix criteria', async () => {
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix(BASE_OPTS);

    const [fixTaskSpec] = fixReviewIssues.mock.calls[0];
    expect(fixTaskSpec.acceptanceCriteria).toContain('AC1');
    expect(fixTaskSpec.acceptanceCriteria).toContain(
      'Fix the CI failure so the pipeline passes on the staging branch',
    );
  });

  it('passes branchName as fixTaskSpec.branchName', async () => {
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix({ ...BASE_OPTS, branchName: 'canary-staging' });

    const [fixTaskSpec] = fixReviewIssues.mock.calls[0];
    expect(fixTaskSpec.branchName).toBe('canary-staging');
  });

  it('passes maxTurns:5 to fixReviewIssues', async () => {
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix(BASE_OPTS);

    const [, , , , opts] = fixReviewIssues.mock.calls[0];
    expect(opts.maxTurns).toBe(5);
  });

  it('uses coderModel when provided', async () => {
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix({ ...BASE_OPTS, coderModel: 'claude-opus-4-6' });

    const [, , , , opts] = fixReviewIssues.mock.calls[0];
    expect(opts.model).toBe('claude-opus-4-6');
  });

  it('falls back to config.forceModel_CODER when coderModel is undefined', async () => {
    config.forceModel_CODER = 'claude-haiku-4-5-20251001';
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix({ ...BASE_OPTS, coderModel: undefined });

    const [, , , , opts] = fixReviewIssues.mock.calls[0];
    expect(opts.model).toBe('claude-haiku-4-5-20251001');
    config.forceModel_CODER = undefined;
  });

  it('sets implementationPlan to null so agent reasons from error log', async () => {
    fixReviewIssues.mockResolvedValue({ success: true });

    await runCanaryAutoFix(BASE_OPTS);

    const [fixTaskSpec] = fixReviewIssues.mock.calls[0];
    expect(fixTaskSpec.implementationPlan).toBeNull();
  });
});
